/**
 * routes-commercial.ts
 *
 * Commercial Portal API — hierarchy-scoped endpoints.
 *
 * Every endpoint here resolves getVisibleAccountIds(userId) before touching any
 * data, ensuring the response contains only accounts within the caller's
 * commercial hierarchy.  Admin / super_admin users receive getAllAccountIds()
 * (the full scope) so the dashboard stays useful for management.
 *
 * Registered via registerCommercialRoutes(app) from routes.ts.
 */

import { Express } from 'express';
import { pool, db } from './db';
import { rateNotificationJobs } from '../shared/schema';
import { inArray } from 'drizzle-orm';
import {
  getVisibleAccountIds,
  getAllAccountIds,
} from './services/commercial/hierarchy-scope';

// ── Auth guard (inline — avoids cross-file import issues) ────────────────────
function requireAuth(req: any, res: any, next: any) {
  if (!req.user?.claims?.sub) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function isAdminRole(role?: string): boolean {
  return ['admin', 'super_admin'].includes(role ?? '');
}

// ── Route registration ────────────────────────────────────────────────────────
export function registerCommercialRoutes(app: Express) {

  // ── GET /api/commercial/dashboard/kpis ──────────────────────────────────────
  //
  // Returns cross-table KPIs that require DB queries, scoped to the caller's
  // commercial hierarchy.  KPIs derivable purely from the portfolio response
  // (liveCallCount, calls24h, revenue24h, healthScore, state) are computed on
  // the frontend to avoid redundant Sippy round-trips.
  //
  // Response shape:
  //   accountCount     — number of Sippy accounts in hierarchy scope
  //   pendingFirstRate — rate_notification_jobs in 'pending_rates' state for scope
  //   pendingApproval  — rate_notification_jobs in 'pending_approval' state for scope
  //   scopeError       — 'no_kam_link' | 'no_accounts' | null
  app.get('/api/commercial/dashboard/kpis', requireAuth, async (req: any, res: any) => {
    try {
      const userId   = req.user.claims.sub as string;
      const userRole = req.user?.claims?.role ?? req.user?.claims?.org_role ?? '';

      // Admin / super_admin → full platform scope (no hierarchy filter)
      const scope = isAdminRole(userRole)
        ? await getAllAccountIds()
        : await getVisibleAccountIds(userId);

      // Scope error — no KAM link or no accounts assigned yet
      if (scope.scopeError) {
        return res.json({
          scopeError:      scope.scopeError,
          accountCount:    0,
          pendingFirstRate: 0,
          pendingApproval:  0,
        });
      }

      const accountIds = scope.accountIds
        .map(id => typeof id === 'string' ? parseInt(id, 10) : Number(id))
        .filter(n => !isNaN(n) && n > 0);

      let pendingFirstRate = 0;
      let pendingApproval  = 0;

      if (accountIds.length > 0) {
        const jobs = await db
          .select({
            id:     rateNotificationJobs.id,
            status: rateNotificationJobs.status,
          })
          .from(rateNotificationJobs)
          .where(inArray(rateNotificationJobs.iAccount, accountIds));

        pendingFirstRate = jobs.filter(j => j.status === 'pending_rates').length;
        pendingApproval  = jobs.filter(j => j.status === 'pending_approval').length;
      }

      res.json({
        accountCount:    accountIds.length,
        pendingFirstRate,
        pendingApproval,
        scopeError:      null,
      });

    } catch (err: any) {
      console.error('[commercial/kpis]', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/commercial/clients ─────────────────────────────────────────────
  //
  // Returns the authenticated user's portfolio client list, scoped to their
  // hierarchy.  Joins kam_accounts with kams so KAM name is available for
  // team-lead and manager views.
  //
  // Query params:
  //   search  — case-insensitive substring match on client_name or account_id
  //   page    — 1-based page number (default 1)
  //   limit   — rows per page (default 50, max 200)
  //
  // Response shape:
  //   clients      — array of { accountId, clientName, kamId, kamName, orgRole }
  //   total        — total matching rows (before pagination)
  //   scopeError   — 'no_kam_link' | 'no_accounts' | null
  //   kamIds       — KAM node IDs in scope (useful for debugging)
  //   orgRole      — caller's org role (null if admin override)
  app.get('/api/commercial/clients', requireAuth, async (req: any, res: any) => {
    try {
      const userId   = req.user.claims.sub as string;
      const userRole = req.user?.claims?.role ?? req.user?.claims?.org_role ?? '';

      const scope = isAdminRole(userRole)
        ? await getAllAccountIds()
        : await getVisibleAccountIds(userId);

      if (scope.scopeError) {
        return res.json({
          clients:    [],
          total:      0,
          scopeError: scope.scopeError,
          kamIds:     [],
          orgRole:    scope.orgRole,
        });
      }

      const search = (req.query.search as string | undefined)?.trim() ?? '';
      const page   = Math.max(1, parseInt(req.query.page  as string) || 1);
      const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));
      const offset = (page - 1) * limit;

      // Build WHERE clause: account_id IN scope + optional search
      const accountIdList = scope.accountIds;
      if (accountIdList.length === 0) {
        return res.json({ clients: [], total: 0, scopeError: null, kamIds: scope.kamIds, orgRole: scope.orgRole });
      }

      const placeholders = accountIdList.map((_, i) => `$${i + 1}`).join(', ');
      const baseParams: any[] = [...accountIdList];

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
      const limitIdx  = dataParams.length - 1;
      const offsetIdx = dataParams.length;

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

      const clients = rows.rows.map(r => ({
        accountId:  r.account_id,
        clientName: r.client_name ?? `Account ${r.account_id}`,
        kamId:      r.kam_id,
        kamName:    r.kam_name ?? '—',
        orgRole:    r.org_role ?? null,
      }));

      res.json({
        clients,
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

}
