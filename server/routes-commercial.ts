/**
 * routes-commercial.ts
 *
 * Commercial Portal API — hierarchy-scoped endpoints.
 *
 * Every endpoint resolves commercial scope via resolveCommercialScope(req)
 * before touching any data.  Admin / super_admin users receive the full
 * platform scope (getAllAccountIds); everyone else gets the subtree visible
 * through their KAM hierarchy (getVisibleAccountIds).
 *
 * Registered via registerCommercialRoutes(app) from routes.ts.
 *
 * CH-1 pattern (canonical — all future modules must follow):
 *   1. resolveCommercialScope(req)   — single call, handles admin override
 *   2. early-return on scopeError    — consistent error shape
 *   3. WHERE account_id IN (...)     — parameterised, never string-concat
 *   4. return scope metadata         — scopeError, kamIds, orgRole alongside data
 */

import { Express } from 'express';
import { pool, db } from './db';
import { rateNotificationJobs } from '../shared/schema';
import { inArray } from 'drizzle-orm';
import {
  getVisibleAccountIds,
  getAllAccountIds,
  type CommercialScope,
} from './services/commercial/hierarchy-scope';
import { sharedLiveCallsCache } from './live-calls-cache';
import { storage } from './storage';
import { listSippyAccounts } from './sippy';

// ── Auth guard ────────────────────────────────────────────────────────────────
function requireAuth(req: any, res: any, next: any) {
  if (!req.user?.claims?.sub) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ── resolveCommercialScope ────────────────────────────────────────────────────
//
// Single call per endpoint.  Encapsulates the admin-override check and the
// hierarchy tree walk so every route stays thin.
//
// Returns CommercialScope augmented with an isAdmin flag.
//
interface ResolvedScope extends CommercialScope {
  isAdmin: boolean;
}

async function resolveCommercialScope(req: any): Promise<ResolvedScope> {
  const userId   = req.user.claims.sub as string;
  const userRole = req.user?.claims?.role ?? req.user?.claims?.org_role ?? '';
  const isAdmin  = ['admin', 'super_admin'].includes(userRole);

  const scope = isAdmin
    ? await getAllAccountIds()
    : await getVisibleAccountIds(userId);

  return { ...scope, isAdmin };
}

// ── SQL helpers ───────────────────────────────────────────────────────────────
//
// Build a postgres $1,$2,... placeholder string and corresponding params array
// for an IN clause.  Returns null when the list is empty so callers can bail
// early before issuing a query.
//
function buildInClause(ids: string[]): { placeholders: string; params: string[] } | null {
  if (ids.length === 0) return null;
  return {
    placeholders: ids.map((_, i) => `$${i + 1}`).join(', '),
    params:       [...ids],
  };
}

// ── Route registration ────────────────────────────────────────────────────────
export function registerCommercialRoutes(app: Express) {

  // ── GET /api/commercial/scope ─────────────────────────────────────────────
  //
  // Returns the authenticated user's complete commercial scope — account IDs,
  // KAM IDs, org role — without any module-specific data.
  //
  // Used by frontend modules that need the full accountIds list for client-side
  // filtering (e.g. CH-2 live calls: fetch all calls, keep only scoped accounts).
  //
  // Hierarchy resolution is always server-side.  The frontend never computes
  // which accounts are in scope — it only uses this list as a lookup key.
  //
  // Response: { accountIds, kamIds, orgRole, isAdmin, scopeError }
  app.get('/api/commercial/scope', requireAuth, async (req: any, res: any) => {
    try {
      const scope = await resolveCommercialScope(req);
      res.json({
        accountIds: scope.accountIds,
        kamIds:     scope.kamIds,
        orgRole:    scope.orgRole,
        isAdmin:    scope.isAdmin,
        scopeError: scope.scopeError ?? null,
      });
    } catch (err: any) {
      console.error('[commercial/scope]', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/commercial/dashboard/kpis ─────────────────────────────────────
  //
  // Returns cross-table KPIs scoped to the caller's commercial hierarchy.
  //
  // Response: { accountCount, pendingFirstRate, pendingApproval, scopeError }
  app.get('/api/commercial/dashboard/kpis', requireAuth, async (req: any, res: any) => {
    try {
      const scope = await resolveCommercialScope(req);

      if (scope.scopeError) {
        return res.json({ scopeError: scope.scopeError, accountCount: 0, pendingFirstRate: 0, pendingApproval: 0 });
      }

      const accountIds = scope.accountIds
        .map(id => (typeof id === 'string' ? parseInt(id, 10) : Number(id)))
        .filter(n => !isNaN(n) && n > 0);

      let pendingFirstRate = 0;
      let pendingApproval  = 0;

      if (accountIds.length > 0) {
        const jobs = await db
          .select({ id: rateNotificationJobs.id, status: rateNotificationJobs.status })
          .from(rateNotificationJobs)
          .where(inArray(rateNotificationJobs.iAccount, accountIds));

        pendingFirstRate = jobs.filter(j => j.status === 'pending_rates').length;
        pendingApproval  = jobs.filter(j => j.status === 'pending_approval').length;
      }

      res.json({ accountCount: accountIds.length, pendingFirstRate, pendingApproval, scopeError: null });

    } catch (err: any) {
      console.error('[commercial/kpis]', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/commercial/clients ─────────────────────────────────────────────
  //
  // Returns the hierarchy-scoped client list with KAM attribution.
  //
  // Query params: search (ILIKE on name/accountId), page (1-based), limit (max 200)
  //
  // Response: { clients[], total, scopeError, kamIds, orgRole }
  app.get('/api/commercial/clients', requireAuth, async (req: any, res: any) => {
    try {
      const scope = await resolveCommercialScope(req);

      if (scope.scopeError) {
        return res.json({ clients: [], total: 0, scopeError: scope.scopeError, kamIds: [], orgRole: scope.orgRole });
      }

      const inClause = buildInClause(scope.accountIds);
      if (!inClause) {
        return res.json({ clients: [], total: 0, scopeError: null, kamIds: scope.kamIds, orgRole: scope.orgRole });
      }

      const search = (req.query.search as string | undefined)?.trim() ?? '';
      const page   = Math.max(1, parseInt(req.query.page  as string) || 1);
      const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));
      const offset = (page - 1) * limit;

      const { placeholders, params: baseParams } = inClause;

      let whereSearch = '';
      if (search) {
        baseParams.push(`%${search}%`);
        const si = baseParams.length;
        whereSearch = `AND (ka.client_name ILIKE $${si} OR ka.account_id::text ILIKE $${si})`;
      }

      const countResult = await pool.query<{ count: string }>(
        `SELECT COUNT(*) AS count
         FROM   kam_accounts ka
         WHERE  ka.account_id IN (${placeholders})
         ${whereSearch}`,
        baseParams
      );
      const total = parseInt(countResult.rows[0]?.count ?? '0', 10);

      const dataParams = [...baseParams, limit, offset];
      const limitIdx   = dataParams.length - 1;
      const offsetIdx  = dataParams.length;

      const rows = await pool.query<{
        account_id:  string;
        client_name: string | null;
        kam_id:      number;
        kam_name:    string | null;
        org_role:    string | null;
      }>(
        `SELECT
           ka.account_id,
           ka.client_name,
           ka.kam_id,
           k.name    AS kam_name,
           k.org_role
         FROM   kam_accounts ka
         LEFT   JOIN kams k ON k.id = ka.kam_id
         WHERE  ka.account_id IN (${placeholders})
         ${whereSearch}
         ORDER  BY COALESCE(ka.client_name, ka.account_id::text) ASC
         LIMIT  $${limitIdx} OFFSET $${offsetIdx}`,
        dataParams
      );

      res.json({
        clients: rows.rows.map(r => ({
          accountId:  r.account_id,
          clientName: r.client_name ?? `Account ${r.account_id}`,
          kamId:      r.kam_id,
          kamName:    r.kam_name ?? '—',
          orgRole:    r.org_role ?? null,
        })),
        total,
        scopeError: null,
        kamIds:     scope.kamIds,
        orgRole:    scope.orgRole,
      });

    } catch (err: any) {
      console.error('[commercial/clients]', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/commercial/live-calls ──────────────────────────────────────────
  //
  // Server-side hierarchy-filtered live calls.
  // Source: sharedLiveCallsCache — populated every ~15 s by background poller.
  // Callers receive ONLY calls belonging to accounts in their hierarchy scope.
  //
  // Response: { calls[], total, totalOnSwitch, scopeError, orgRole, lastUpdated }
  app.get('/api/commercial/live-calls', requireAuth, async (req: any, res: any) => {
    try {
      const scope = await resolveCommercialScope(req);

      if (scope.scopeError) {
        return res.json({
          calls: [], total: 0, totalOnSwitch: 0,
          scopeError: scope.scopeError, orgRole: scope.orgRole, lastUpdated: null,
        });
      }

      const { calls: allCalls, ts } = sharedLiveCallsCache;

      const filteredCalls = scope.isAdmin
        ? allCalls
        : (() => {
            const scopeSet = new Set(scope.accountIds.map(String));
            return allCalls.filter(c => c.accountId && scopeSet.has(String(c.accountId)));
          })();

      res.json({
        calls:         filteredCalls,
        total:         filteredCalls.length,
        totalOnSwitch: allCalls.length,
        scopeError:    null,
        orgRole:       scope.orgRole,
        kamIds:        scope.kamIds,
        lastUpdated:   ts || null,
      });

    } catch (err: any) {
      console.error('[commercial/live-calls]', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/commercial/live-traffic ────────────────────────────────────────
  //
  // Per-account live traffic breakdown for the BitsEye2-style portfolio view.
  // Groups sharedLiveCallsCache by accountId within the caller's hierarchy scope.
  //
  // Response: {
  //   accounts:            AccountTrafficSummary[]  (sorted by liveCallCount desc)
  //   totalPortfolioCalls: number
  //   uniqueDestinations:  number
  //   scopeError:          string | null
  //   orgRole:             string | null
  //   lastUpdated:         number | null
  // }
  app.get('/api/commercial/live-traffic', requireAuth, async (req: any, res: any) => {
    try {
      const scope = await resolveCommercialScope(req);

      if (scope.scopeError) {
        return res.json({
          accounts: [], totalPortfolioCalls: 0, uniqueDestinations: 0,
          scopeError: scope.scopeError, orgRole: scope.orgRole, lastUpdated: null,
        });
      }

      const { calls: allCalls, ts } = sharedLiveCallsCache;

      // Filter to scope
      const filteredCalls = scope.isAdmin
        ? allCalls
        : (() => {
            const s = new Set(scope.accountIds.map(String));
            return allCalls.filter(c => c.accountId && s.has(String(c.accountId)));
          })();

      // Group by accountId
      const accountMap = new Map<string, {
        accountId:  string;
        clientName: string;
        calls:      any[];
      }>();

      for (const call of filteredCalls) {
        const id = String(call.accountId ?? 'unknown');
        if (!accountMap.has(id)) {
          accountMap.set(id, {
            accountId:  id,
            clientName: call.clientName ?? `Account ${id}`,
            calls:      [],
          });
        }
        accountMap.get(id)!.calls.push(call);
      }

      // Build per-account summaries
      const accounts = [...accountMap.values()].map(({ accountId, clientName, calls }) => {
        const connected = calls.filter(c => c.callStatus === 'connected').length;
        const avgDuration = calls.length > 0
          ? Math.round(calls.reduce((s: number, c: any) => s + (c.duration ?? 0), 0) / calls.length)
          : 0;

        const countryCounts = new Map<string, number>();
        for (const c of calls) {
          const country = c.destCountry ?? 'Unknown';
          countryCounts.set(country, (countryCounts.get(country) ?? 0) + 1);
        }
        const topDestinations = [...countryCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 4)
          .map(([country, count]) => ({ country, count }));

        return {
          accountId,
          clientName,
          liveCallCount:  calls.length,
          connectedCalls: connected,
          routingCalls:   calls.length - connected,
          topDestinations,
          avgDuration,
        };
      }).sort((a, b) => b.liveCallCount - a.liveCallCount);

      const uniqueDestinations = new Set(
        filteredCalls.map((c: any) => c.destCountry).filter(Boolean)
      ).size;

      res.json({
        accounts,
        totalPortfolioCalls: filteredCalls.length,
        uniqueDestinations,
        scopeError:          null,
        orgRole:             scope.orgRole,
        lastUpdated:         ts || null,
      });

    } catch (err: any) {
      console.error('[commercial/live-traffic]', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/commercial/balance ──────────────────────────────────────────────
  //
  // Server-side hierarchy-filtered account balances.
  // Calls Sippy listSippyAccounts then filters to scope.accountIds.
  // Replaces the client-side filter pattern on /api/sippy/balance-monitor.
  //
  // Response: { accounts[], total, totalBalance, lowCount, scopeError, orgRole }
  app.get('/api/commercial/balance', requireAuth, async (req: any, res: any) => {
    try {
      const scope = await resolveCommercialScope(req);

      if (scope.scopeError) {
        return res.json({
          accounts: [], total: 0, totalBalance: 0, lowCount: 0,
          scopeError: scope.scopeError, orgRole: scope.orgRole,
        });
      }

      const settings = await storage.getSippySettings();
      if (!settings) {
        return res.json({
          accounts: [], total: 0, totalBalance: 0, lowCount: 0,
          scopeError: 'sippy_not_configured', orgRole: scope.orgRole,
        });
      }

      const portalUrl = settings.sippyUrl?.replace(/\/+$/, '') ?? undefined;
      const u = settings.apiAdminUsername ?? '';
      const p = settings.apiAdminPassword ?? '';

      const { accounts: allAccounts } = await listSippyAccounts(u, p, {}, portalUrl);

      // Account name cache (set by routes.ts background poller)
      const nameCache = (global as any).__bitsautoAccountCache as Map<string, string> | undefined;

      const scopeSet = new Set(scope.accountIds.map(String));
      const source   = scope.isAdmin ? allAccounts : allAccounts.filter(a => scopeSet.has(String(a.iAccount)));

      const accounts = source.map(a => {
        const bal  = a.balance      ?? 0;
        const lim  = a.creditLimit  ?? null;
        const isLow = lim !== null && bal < lim * 0.1;
        return {
          iAccount:    a.iAccount,
          name:        nameCache?.get(String(a.iAccount)) ?? a.username ?? `Account ${a.iAccount}`,
          balance:     bal,
          creditLimit: lim,
          balanceFlag: isLow ? 'low' : 'ok',
          blocked:     a.blocked    ?? false,
        };
      }).sort((a, b) => a.balance - b.balance); // lowest balance first

      const totalBalance = accounts.reduce((s, a) => s + a.balance, 0);
      const lowCount     = accounts.filter(a => a.balanceFlag === 'low').length;

      res.json({
        accounts,
        total:        accounts.length,
        totalBalance,
        lowCount,
        scopeError:   null,
        orgRole:      scope.orgRole,
      });

    } catch (err: any) {
      console.error('[commercial/balance]', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/commercial/intelligence ─────────────────────────────────────────
  //
  // Portfolio intelligence data — the 60-second morning brief for KAMs.
  // Three data sources, one endpoint:
  //   hourlyTrend   — concurrent_snapshots (dim=client, last 24h by hour)
  //   qualityMetrics— mos_hourly + rtp_quality_history (last 24h aggregate)
  //   revenueTrend  — financial_snapshot (last 7d, scope-filtered by accountId)
  //
  // Risk and Commercial panels are computed client-side from the portfolio
  // context which is already loaded — no redundant scope round-trip.
  //
  app.get('/api/commercial/intelligence', requireAuth, async (req: any, res: any) => {
    try {
      const scope = await resolveCommercialScope(req);

      if (scope.scopeError) {
        return res.json({
          hourlyTrend: [], qualityMetrics: null, revenueTrend: [],
          scopeError: scope.scopeError, orgRole: scope.orgRole,
        });
      }

      const h24AgoMs = Date.now() - 24 * 60 * 60 * 1_000;

      // ── 1. Hourly traffic trend from concurrent_snapshots ──────────────────
      const trendRows = await pool.query<{ hour: Date; calls: string }>(`
        SELECT
          date_trunc('hour', to_timestamp(ts / 1000.0)) AS hour,
          SUM(active)                                   AS calls
        FROM concurrent_snapshots
        WHERE ts  >= $1
          AND dim = 'client'
        GROUP BY 1
        ORDER BY 1
      `, [h24AgoMs]);

      const hourlyTrend = trendRows.rows.map(r => ({
        hour:  r.hour instanceof Date ? r.hour.toISOString() : String(r.hour),
        calls: Number(r.calls),
      }));

      // ── 2. Quality metrics from mos_hourly + rtp_quality_history ──────────
      const mosRows = await pool.query<{
        avg_mos_24h: string | null;
        avg_mos_4h:  string | null;
        avg_mos_p4h: string | null;
        calls_24h:   string | null;
      }>(`
        SELECT
          AVG(avg_mos) FILTER (WHERE hour >= NOW() - INTERVAL '24 hours')                                              AS avg_mos_24h,
          AVG(avg_mos) FILTER (WHERE hour >= NOW() - INTERVAL '4 hours')                                               AS avg_mos_4h,
          AVG(avg_mos) FILTER (WHERE hour >= NOW() - INTERVAL '8 hours' AND hour < NOW() - INTERVAL '4 hours')         AS avg_mos_p4h,
          SUM(call_count) FILTER (WHERE hour >= NOW() - INTERVAL '24 hours')                                           AS calls_24h
        FROM mos_hourly
        WHERE hour >= NOW() - INTERVAL '24 hours'
      `);

      const rtpRows = await pool.query<{
        avg_jitter:   string | null;
        avg_pkt_loss: string | null;
      }>(`
        SELECT
          AVG(avg_jitter_ms)::numeric(8,2)   AS avg_jitter,
          AVG(avg_pkt_loss_pct)::numeric(6,3) AS avg_pkt_loss
        FROM rtp_quality_history
        WHERE snapped_at >= NOW() - INTERVAL '24 hours'
      `);

      const mRow = mosRows.rows[0];
      const rRow = rtpRows.rows[0];

      let qualTrend: 'improving' | 'stable' | 'declining' = 'stable';
      if (mRow?.avg_mos_4h && mRow?.avg_mos_p4h) {
        const delta = Number(mRow.avg_mos_4h) - Number(mRow.avg_mos_p4h);
        if (delta >  0.1) qualTrend = 'improving';
        if (delta < -0.1) qualTrend = 'declining';
      }

      const qualityMetrics = {
        avgMos:    mRow?.avg_mos_24h ? Number(mRow.avg_mos_24h) : null,
        avgJitter: rRow?.avg_jitter  ? Number(rRow.avg_jitter)  : null,
        avgPktLoss:rRow?.avg_pkt_loss? Number(rRow.avg_pkt_loss): null,
        callCount: Number(mRow?.calls_24h ?? 0),
        trend:     qualTrend,
      };

      // ── 3. Revenue trend from financial_snapshot (last 7 days) ────────────
      let revenueTrend: { date: string; revenue: number; margin: number }[] = [];

      const accountIdStrs = scope.accountIds.map(String);

      if (scope.isAdmin || accountIdStrs.length > 0) {
        const revRows = await pool.query<{
          date:    string;
          revenue: string;
          margin:  string;
        }>(
          scope.isAdmin
            ? `SELECT
                 report_date::text            AS date,
                 SUM(sell_amount::numeric)    AS revenue,
                 SUM(margin_amount::numeric)  AS margin
               FROM financial_snapshot
               WHERE report_date >= CURRENT_DATE - 7
                 AND row_type = 'client'
               GROUP BY 1
               ORDER BY 1`
            : `SELECT
                 report_date::text            AS date,
                 SUM(sell_amount::numeric)    AS revenue,
                 SUM(margin_amount::numeric)  AS margin
               FROM financial_snapshot
               WHERE report_date >= CURRENT_DATE - 7
                 AND row_type = 'client'
                 AND account_id = ANY($1)
               GROUP BY 1
               ORDER BY 1`,
          scope.isAdmin ? [] : [accountIdStrs],
        );

        revenueTrend = revRows.rows.map(r => ({
          date:    r.date,
          revenue: Number(r.revenue ?? 0),
          margin:  Number(r.margin  ?? 0),
        }));
      }

      res.json({
        hourlyTrend,
        qualityMetrics,
        revenueTrend,
        scopeError: null,
        orgRole:    scope.orgRole,
        scoredAt:   new Date().toISOString(),
      });

    } catch (err: any) {
      console.error('[commercial/intelligence]', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/commercial/actions ──────────────────────────────────────────────
  //
  // Sprint C — Commercial Action Center.
  // Returns a prioritised work queue computed from four signal sources:
  //
  //   1. Traffic drops  — concurrent_snapshots (last 3h vs prior 3h, per account)
  //   2. Quality alerts — mos_hourly (avgMos < 3.0 in last 2h, per vendor)
  //   3. Revenue drops  — financial_snapshot (today vs 7d avg, scoped by accountId)
  //   4. Rate job alerts— rate_notification_jobs (awaiting approval / failed)
  //
  // Risk, zero-traffic, and balance items are cheaply computed client-side from
  // the portfolio context and balance data already loaded — they are NOT repeated
  // here to avoid re-calling Sippy.
  //
  app.get('/api/commercial/actions', requireAuth, async (req: any, res: any) => {
    try {
      const scope = await resolveCommercialScope(req);

      if (scope.scopeError) {
        return res.json({
          actions: [], total: 0, criticalCount: 0, highCount: 0,
          scopeError: scope.scopeError, orgRole: scope.orgRole,
        });
      }

      const nameCache = (global as any).__bitsautoAccountCache as Map<string, string> | undefined;
      const scopeSet  = new Set(scope.accountIds.map(String));

      // Account names visible in this scope (for concurrent_snapshots entityName filter)
      const scopeNames = nameCache
        ? Array.from(nameCache.entries())
            .filter(([id]) => scope.isAdmin || scopeSet.has(id))
            .map(([, name]) => name)
        : [];

      const actions: Array<{
        id:              string;
        priority:        'critical' | 'high' | 'medium' | 'low';
        type:            'traffic' | 'quality' | 'revenue' | 'rate';
        accountId:       string | null;
        accountName:     string | null;
        title:           string;
        detail:          string;
        suggestedAction: string;
        link:            string | null;
        detectedAt:      string;
      }> = [];

      const now = new Date().toISOString();

      // ── 1. Traffic drops ────────────────────────────────────────────────────
      // Only run if we have scope names to filter on (avoids full-table scan)
      if (scopeNames.length > 0) {
        const tdRows = await pool.query<{
          entity_name:   string;
          recent_calls:  string;
          prior_calls:   string;
          drop_pct:      string;
        }>(`
          WITH recent AS (
            SELECT entity_name, SUM(active) AS calls
            FROM   concurrent_snapshots
            WHERE  ts  >= extract(epoch FROM NOW() - INTERVAL '3 hours') * 1000
              AND  dim  = 'client'
              AND  entity_name = ANY($1)
            GROUP  BY entity_name
          ),
          prior AS (
            SELECT entity_name, SUM(active) AS calls
            FROM   concurrent_snapshots
            WHERE  ts  >= extract(epoch FROM NOW() - INTERVAL '6 hours') * 1000
              AND  ts   < extract(epoch FROM NOW() - INTERVAL '3 hours') * 1000
              AND  dim  = 'client'
              AND  entity_name = ANY($1)
            GROUP  BY entity_name
          )
          SELECT
            r.entity_name,
            r.calls                                                                  AS recent_calls,
            p.calls                                                                  AS prior_calls,
            ROUND(((p.calls - r.calls)::numeric / NULLIF(p.calls, 0)) * 100, 1)     AS drop_pct
          FROM   recent r
          JOIN   prior  p USING (entity_name)
          WHERE  p.calls > 5 AND r.calls < p.calls * 0.7
          ORDER  BY drop_pct DESC
          LIMIT  10
        `, [scopeNames]);

        for (const row of tdRows.rows) {
          const pct = Number(row.drop_pct);
          const priority = pct >= 70 ? 'critical' : pct >= 50 ? 'high' : 'medium';
          actions.push({
            id:              `traffic_drop_${row.entity_name}`,
            priority,
            type:            'traffic',
            accountId:       null,
            accountName:     row.entity_name,
            title:           `Traffic drop — ${row.entity_name}`,
            detail:          `${pct}% reduction in the last 3h (${row.prior_calls} → ${row.recent_calls} concurrent)`,
            suggestedAction: 'Review live traffic and check route configuration',
            link:            '/commercial',
            detectedAt:      now,
          });
        }
      }

      // ── 2. Quality alerts ───────────────────────────────────────────────────
      const qaRows = await pool.query<{
        vendor:   string | null;
        avg_mos:  string;
        mos_drop: string;
      }>(`
        WITH recent AS (
          SELECT vendor, AVG(avg_mos) AS mos
          FROM   mos_hourly
          WHERE  hour >= NOW() - INTERVAL '2 hours'
          GROUP  BY vendor
        ),
        prior AS (
          SELECT vendor, AVG(avg_mos) AS mos
          FROM   mos_hourly
          WHERE  hour >= NOW() - INTERVAL '6 hours'
            AND  hour  < NOW() - INTERVAL '2 hours'
          GROUP  BY vendor
        )
        SELECT
          COALESCE(r.vendor, 'System') AS vendor,
          ROUND(r.mos::numeric, 2)     AS avg_mos,
          ROUND(((COALESCE(p.mos, r.mos) - r.mos) / NULLIF(COALESCE(p.mos, r.mos), 0) * 100)::numeric, 1) AS mos_drop
        FROM   recent r
        LEFT   JOIN prior p USING (vendor)
        WHERE  r.mos < 3.5
        ORDER  BY r.mos ASC
        LIMIT  5
      `);

      for (const row of qaRows.rows) {
        const mos  = Number(row.avg_mos);
        const priority = mos < 2.5 ? 'critical' : mos < 3.0 ? 'high' : 'medium';
        actions.push({
          id:              `quality_${row.vendor ?? 'system'}`,
          priority,
          type:            'quality',
          accountId:       null,
          accountName:     null,
          title:           `MOS degradation — ${row.vendor ?? 'System-wide'}`,
          detail:          `Avg MOS ${mos.toFixed(2)} in last 2h${Number(row.mos_drop) > 5 ? ` (↓${row.mos_drop}% vs prior 4h)` : ''}`,
          suggestedAction: 'Check vendor route health and switch to backup if available',
          link:            '/noc',
          detectedAt:      now,
        });
      }

      // ── 3. Revenue drops ────────────────────────────────────────────────────
      const accountIdStrs = scope.isAdmin ? [] : scope.accountIds.map(String);
      const revFilter = scope.isAdmin
        ? ''
        : `AND account_id = ANY($1)`;
      const revParams = scope.isAdmin ? [] : [accountIdStrs];

      const revRows = await pool.query<{
        account_id:   string;
        account_name: string;
        avg_7d:       string;
        today_rev:    string;
        drop_pct:     string;
      }>(`
        WITH daily_rev AS (
          SELECT account_id, account_name, report_date,
                 SUM(sell_amount::numeric) AS revenue
          FROM   financial_snapshot
          WHERE  report_date >= CURRENT_DATE - 8
            AND  row_type = 'client'
            ${revFilter}
          GROUP  BY account_id, account_name, report_date
        ),
        stats AS (
          SELECT account_id, account_name,
                 AVG(revenue) FILTER (WHERE report_date < CURRENT_DATE)        AS avg_7d,
                 MAX(revenue) FILTER (WHERE report_date = CURRENT_DATE)        AS today_rev
          FROM   daily_rev
          GROUP  BY account_id, account_name
        )
        SELECT
          account_id, account_name,
          ROUND(avg_7d::numeric,   2) AS avg_7d,
          ROUND(today_rev::numeric, 2) AS today_rev,
          ROUND(((avg_7d - today_rev) / NULLIF(avg_7d, 0) * 100)::numeric, 1) AS drop_pct
        FROM   stats
        WHERE  avg_7d > 0 AND today_rev < avg_7d * 0.7
        ORDER  BY drop_pct DESC
        LIMIT  8
      `, revParams);

      for (const row of revRows.rows) {
        const pct      = Number(row.drop_pct);
        const priority = pct >= 50 ? 'high' : 'medium';
        actions.push({
          id:              `revenue_${row.account_id}`,
          priority,
          type:            'revenue',
          accountId:       row.account_id,
          accountName:     row.account_name,
          title:           `Revenue drop — ${row.account_name}`,
          detail:          `Today $${Number(row.today_rev).toFixed(0)} vs 7d avg $${Number(row.avg_7d).toFixed(0)} (−${pct}%)`,
          suggestedAction: 'Review traffic levels and check for route or product changes',
          link:            '/analytics',
          detectedAt:      now,
        });
      }

      // ── 4. Rate job alerts ──────────────────────────────────────────────────
      const rateRows = await pool.query<{
        id:                integer;
        job_ref:           string;
        client_name:       string;
        product_name:      string | null;
        status:            string;
        violated_rules:    boolean;
        approval_required: boolean;
        submitted_for_approval_at: Date | null;
      }>(`
        SELECT
          id, job_ref, client_name, product_name,
          status, violated_rules, approval_required,
          submitted_for_approval_at
        FROM rate_notification_jobs
        WHERE status IN ('awaiting_approval', 'failed', 'rejected', 'pending_rates')
          AND (
            submitted_for_approval_at >= NOW() - INTERVAL '7 days'
            OR status = 'pending_rates'
            OR status = 'failed'
          )
        ORDER BY id DESC
        LIMIT 10
      `);

      for (const row of rateRows.rows) {
        const isApproval = row.status === 'awaiting_approval';
        const isFailed   = row.status === 'failed';
        const isRejected = row.status === 'rejected';
        const isPending  = row.status === 'pending_rates';
        const priority   = isApproval ? 'high' : isFailed ? 'high' : isRejected ? 'medium' : 'low';
        const title      = isApproval ? `Rate approval pending — ${row.client_name}`
                         : isFailed   ? `Rate push failed — ${row.client_name}`
                         : isRejected ? `Rate rejected — ${row.client_name}`
                         : `Rate pending push — ${row.client_name}`;
        const detail     = `${row.job_ref}${row.product_name ? ` · ${row.product_name}` : ''}`;
        const suggestion = isApproval ? 'Review and approve or reject the pending rate notification'
                         : isFailed   ? 'Retry the rate push or check Sippy credentials'
                         : isRejected ? 'Contact requester or re-submit with corrections'
                         : 'Activate the tariff update in Sippy';
        actions.push({
          id:              `rate_${row.id}`,
          priority,
          type:            'rate',
          accountId:       null,
          accountName:     row.client_name,
          title,
          detail,
          suggestedAction: suggestion,
          link:            '/rate-manager',
          detectedAt:      now,
        });
      }

      // ── Sort: critical → high → medium → low ───────────────────────────────
      const ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      actions.sort((a, b) => (ORDER[a.priority] ?? 4) - (ORDER[b.priority] ?? 4));

      const criticalCount = actions.filter(a => a.priority === 'critical').length;
      const highCount     = actions.filter(a => a.priority === 'high').length;

      res.json({
        actions,
        total:         actions.length,
        criticalCount,
        highCount,
        scopeError:    null,
        orgRole:       scope.orgRole,
        computedAt:    now,
      });

    } catch (err: any) {
      console.error('[commercial/actions]', err.message);
      res.status(500).json({ error: err.message });
    }
  });

}
