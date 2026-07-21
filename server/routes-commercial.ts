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
import { db } from './db';
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

}
