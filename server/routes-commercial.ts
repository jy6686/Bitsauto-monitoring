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

}
