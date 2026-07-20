/**
 * hierarchy-scope.ts — Commercial Hierarchy Scope Service
 *
 * Single authoritative function for resolving which Sippy accounts a
 * Commercial Portal user is permitted to see, based on their position in
 * the KAM org tree.
 *
 * Architecture:
 *   Portal → Role → Hierarchy Scope → Data Filter → Module
 *
 * This service owns Layer 3 (Hierarchy Scope). Every Commercial module
 * that needs account-level filtering calls getVisibleAccountIds() and
 * uses the returned accountIds. No module implements its own access control.
 *
 * Frozen rules (per COMMERCIAL-HIERARCHY-FRAMEWORK.md):
 *   1. Single code path for all roles — CEO/HOD naturally returns the full org.
 *   2. No userId bypass — always resolve through the tree walk.
 *   3. Admin override via commercial.view_all_accounts permission (not role name).
 *   4. Graceful degradation — no KAM link → scopeError, never a 500.
 *   5. Cache-first — 5-min TTL per userId to avoid per-request DB hits.
 *   6. Invalidate on KAM assignment changes via invalidateCommercialScope().
 */

import { pool } from '../../db';

// ── Types ─────────────────────────────────────────────────────────────────────

export type OrgRole = 'HOD' | 'SVP' | 'VP' | 'Manager' | 'TeamLead' | 'KAM';

export type ScopeError = 'no_kam_link' | 'no_accounts';

/**
 * The resolved commercial data scope for one authenticated user.
 *
 * accountIds → Sippy iAccount strings (filter for all data queries)
 * kamIds     → all KAM node IDs in the visible subtree (filter for team views)
 * kamId      → the user's own KAM node (null if unlinked)
 * orgRole    → the user's org role (null if unlinked)
 * scopeError → set when the scope could not be fully resolved; accountIds will
 *              be an empty array in that case
 */
export interface CommercialScope {
  kamId:      number | null;
  orgRole:    OrgRole | null;
  accountIds: string[];
  kamIds:     number[];
  scopeError?: ScopeError;
}

// ── Cache ─────────────────────────────────────────────────────────────────────

interface CacheEntry {
  scope:     CommercialScope;
  expiresAt: number;
}

const SCOPE_CACHE   = new Map<string, CacheEntry>();
const CACHE_TTL_MS  = 5 * 60 * 1000; // 5 minutes

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Returns the CommercialScope for a given auth userId.
 *
 * Algorithm:
 *   1. Return cached result if still fresh (5-min TTL).
 *   2. Look up the KAM record linked to this userId in the `kams` table.
 *   3. If not found → { scopeError: 'no_kam_link', accountIds: [] }.
 *   4. Run a recursive CTE to collect all descendant KAM IDs from this node.
 *   5. Query kamAccounts for all Sippy accountIds across the subtree.
 *   6. Cache the result and return CommercialScope.
 *
 * CEO/HOD path: no special case. Their node is the root of the tree, so the
 * recursive CTE naturally returns all descendants → all accounts visible.
 *
 * Admin override: callers that have checked for commercial.view_all_accounts
 * permission should call getAllAccountIds() instead of this function.
 */
export async function getVisibleAccountIds(userId: string): Promise<CommercialScope> {
  // ── 1. Cache check ───────────────────────────────────────────────────────
  const cached = SCOPE_CACHE.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.scope;
  }

  // ── 2. Resolve the KAM node for this user ────────────────────────────────
  const kamRow = await pool.query<{
    id:         number;
    org_role:   string;
    reports_to: number | null;
  }>(
    `SELECT id, org_role, reports_to
     FROM   kams
     WHERE  user_id = $1
       AND  (active IS NULL OR active = true)
     LIMIT  1`,
    [userId]
  );

  if (kamRow.rows.length === 0) {
    return _cache(userId, {
      kamId:      null,
      orgRole:    null,
      accountIds: [],
      kamIds:     [],
      scopeError: 'no_kam_link',
    });
  }

  const root    = kamRow.rows[0];
  const kamId   = root.id;
  const orgRole = root.org_role as OrgRole;

  // ── 3. Walk the tree downward — collect all KAM IDs in the subtree ───────
  // Recursive CTE: start at this node, follow reports_to in reverse
  // (child.reports_to = parent.id → we find all nodes whose ancestor is kamId)
  const subtreeResult = await pool.query<{ id: number }>(
    `WITH RECURSIVE subtree(id) AS (
       SELECT id
       FROM   kams
       WHERE  id = $1
     UNION ALL
       SELECT k.id
       FROM   kams       k
       JOIN   subtree    s ON k.reports_to = s.id
       WHERE  k.active IS NULL OR k.active = true
     )
     SELECT id FROM subtree`,
    [kamId]
  );

  const kamIds = subtreeResult.rows.map(r => r.id);

  if (kamIds.length === 0) {
    return _cache(userId, {
      kamId,
      orgRole,
      accountIds: [],
      kamIds:     [],
      scopeError: 'no_accounts',
    });
  }

  // ── 4. Collect all Sippy accountIds for the subtree ──────────────────────
  const placeholders = kamIds.map((_, i) => `$${i + 1}`).join(', ');
  const acctResult = await pool.query<{ account_id: string }>(
    `SELECT DISTINCT account_id
     FROM   kam_accounts
     WHERE  kam_id IN (${placeholders})`,
    kamIds
  );

  const accountIds = acctResult.rows.map(r => r.account_id);

  return _cache(userId, { kamId, orgRole, accountIds, kamIds });
}

/**
 * Returns ALL Sippy accountIds in the system (no hierarchy filter).
 * Use this ONLY for users that have passed a commercial.view_all_accounts
 * permission check. Never use it for ordinary Commercial Portal users.
 */
export async function getAllAccountIds(): Promise<CommercialScope> {
  const result = await pool.query<{ account_id: string; kam_id: number }>(
    `SELECT DISTINCT account_id, kam_id FROM kam_accounts`
  );
  return {
    kamId:      null,
    orgRole:    null,
    accountIds: result.rows.map(r => r.account_id),
    kamIds:     [...new Set(result.rows.map(r => r.kam_id))],
  };
}

/**
 * Invalidates the cached scope for a userId.
 * Must be called whenever a KAM record is updated, created, or deactivated,
 * or when a kamAccounts assignment changes for any KAM in that user's subtree.
 */
export function invalidateCommercialScope(userId: string): void {
  SCOPE_CACHE.delete(userId);
}

/**
 * Clears the entire scope cache.
 * Use after bulk KAM assignment operations.
 */
export function flushCommercialScopeCache(): void {
  SCOPE_CACHE.clear();
}

/**
 * Returns the current cache size (for diagnostics / health checks).
 */
export function getScopeCacheStats(): { entries: number; userIds: string[] } {
  const now = Date.now();
  const live = [...SCOPE_CACHE.entries()].filter(([, v]) => v.expiresAt > now);
  return { entries: live.length, userIds: live.map(([k]) => k) };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _cache(userId: string, scope: CommercialScope): CommercialScope {
  SCOPE_CACHE.set(userId, { scope, expiresAt: Date.now() + CACHE_TTL_MS });
  return scope;
}
