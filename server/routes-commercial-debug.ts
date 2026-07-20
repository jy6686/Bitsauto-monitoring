/**
 * routes-commercial-debug.ts
 *
 * GET /api/commercial/debug/scope
 *
 * Diagnostic endpoint for validating the Hierarchy Scope Service against live
 * data. Returns the full resolved scope for the authenticated user, enriched
 * with KAM details, subtree membership, and account names from the identity map.
 *
 * USE:  Verify hierarchy independently of any Commercial module during rollout.
 * REMOVE OR RESTRICT: Once Phase 2 endpoints are integrated and validated,
 *   restrict this to users with the 'admin' role or remove it entirely.
 */

import type { Express } from 'express';
import { pool } from './db';
import {
  getVisibleAccountIds,
  getAllAccountIds,
} from './services/commercial/hierarchy-scope';

export function registerCommercialDebugRoutes(app: Express) {
  /**
   * GET /api/commercial/debug/scope
   *
   * Returns the hierarchy scope for the authenticated user.
   *
   * Query params:
   *   ?userId=<id>   Override to inspect a specific user (admin use only).
   *                  Without this param, uses the calling user's ID.
   *   ?all=true      Return the unrestricted full-system scope instead.
   */
  app.get('/api/commercial/debug/scope', async (req: any, res) => {
    try {
      const callerId: string = req.user?.claims?.sub ?? 'unknown';

      // Allow admin override for inspecting any userId
      const targetUserId: string =
        typeof req.query.userId === 'string' ? req.query.userId : callerId;

      // Unrestricted full-system view
      if (req.query.all === 'true') {
        const scope = await getAllAccountIds();
        const enriched = await _enrichAccounts(scope.accountIds);
        return res.json({
          mode:             'unrestricted',
          callerUserId:     callerId,
          visibleKamIds:    scope.kamIds,
          visibleAccountIds: scope.accountIds,
          accounts:         enriched,
        });
      }

      // Per-user hierarchy scope
      const scope = await getVisibleAccountIds(targetUserId);

      // Enrich: fetch KAM details for the whole subtree
      const kamDetails = scope.kamIds.length
        ? await _enrichKams(scope.kamIds)
        : [];

      // Enrich: fetch account names from client_identity_map
      const accountDetails = scope.accountIds.length
        ? await _enrichAccounts(scope.accountIds)
        : [];

      // Fetch the user row so the email is visible in the response
      const userRow = await pool.query<{ email: string; first_name: string; last_name: string }>(
        `SELECT email, first_name, last_name FROM users WHERE id = $1 LIMIT 1`,
        [targetUserId]
      );
      const user = userRow.rows[0] ?? null;

      return res.json({
        callerUserId:      callerId,
        targetUserId,
        user: user
          ? { email: user.email, name: `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() }
          : null,
        scopeError:        scope.scopeError ?? null,
        orgRole:           scope.orgRole,
        rootKamId:         scope.kamId,
        visibleKamIds:     scope.kamIds,
        visibleAccountIds: scope.accountIds,
        kamTree:           kamDetails,
        accounts:          accountDetails,
      });
    } catch (err: any) {
      console.error('[commercial-debug] scope error:', err);
      return res.status(500).json({ error: 'Scope resolution failed', detail: err.message });
    }
  });
}

// ── Private enrichment helpers ────────────────────────────────────────────────

async function _enrichKams(kamIds: number[]) {
  const placeholders = kamIds.map((_, i) => `$${i + 1}`).join(', ');
  const result = await pool.query<{
    id: number; name: string; email: string; org_role: string; reports_to: number | null;
  }>(
    `SELECT id, name, email, org_role, reports_to
     FROM   kams
     WHERE  id IN (${placeholders})
     ORDER  BY id`,
    kamIds
  );
  return result.rows.map(r => ({
    kamId:     r.id,
    name:      r.name,
    email:     r.email,
    orgRole:   r.org_role,
    reportsTo: r.reports_to,
  }));
}

async function _enrichAccounts(accountIds: string[]) {
  if (!accountIds.length) return [];
  const placeholders = accountIds.map((_, i) => `$${i + 1}`).join(', ');
  const result = await pool.query<{
    i_account: string; billing_name: string | null; display_name: string | null;
  }>(
    `SELECT i_account, billing_name, display_name
     FROM   client_identity_map
     WHERE  i_account = ANY($1::text[])
     ORDER  BY i_account`,
    [accountIds]
  );

  // Accounts that appear in kamAccounts but have no identity-map entry get a
  // placeholder so they're still visible (unresolved, not silently dropped).
  const mapped = new Map(result.rows.map(r => [r.i_account, r]));
  return accountIds.map(id => {
    const row = mapped.get(id);
    return row
      ? { accountId: id, billingName: row.billing_name, displayName: row.display_name }
      : { accountId: id, billingName: null, displayName: null, note: 'not in identity map' };
  });
}
