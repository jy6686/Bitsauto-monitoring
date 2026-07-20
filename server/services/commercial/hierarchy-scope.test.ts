/**
 * hierarchy-scope.test.ts
 *
 * Unit tests for getVisibleAccountIds() — the Commercial Hierarchy Scope Service.
 * All DB calls are mocked; no live database required.
 *
 * Test matrix (from COMMERCIAL-HIERARCHY-FRAMEWORK.md):
 *   1.  KAM               → own assigned accounts only
 *   2.  Team Lead         → own accounts + all AEs beneath them
 *   3.  Manager           → entire reporting team accounts
 *   4.  VP                → entire VP org accounts
 *   5.  HOD/CEO           → entire hierarchy (root node)
 *   6.  No KAM mapping    → controlled failure (scopeError: no_kam_link)
 *   7.  Circular reports  → graceful termination (UNION deduplication)
 *   8.  Inactive KAM node → inactive nodes excluded, no scope expansion
 *   9.  Duplicate accounts → deduplicated results
 *  10.  Admin override    → getAllAccountIds() returns unrestricted set
 *  11.  Cache hit         → second call does not re-query DB
 *  12.  Cache invalidation → invalidateCommercialScope clears the entry
 *  13.  KAM with no accounts → scopeError: no_accounts (not no_kam_link)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock DB before importing the service ─────────────────────────────────────
// vi.mock() is hoisted above all imports. To share a reference, declare the
// mock fn via vi.hoisted() — it also runs before imports, so the reference is
// valid when the factory executes.

const mockQuery = vi.hoisted(() => vi.fn());

vi.mock('../../db', () => ({
  pool: { query: mockQuery },
  db:   {},
}));

import {
  getVisibleAccountIds,
  getAllAccountIds,
  invalidateCommercialScope,
  flushCommercialScopeCache,
  getScopeCacheStats,
} from './hierarchy-scope';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Simulates the three DB calls getVisibleAccountIds() makes in order. */
function setupPoolCalls(
  kamRow:      object | null,           // kams WHERE user_id = $1
  subtreeRows: { id: number }[],        // recursive CTE result
  accountRows: { account_id: string }[] // kam_accounts result
) {
  mockQuery.mockReset();

  if (kamRow === null) {
    // Only the first query fires (no KAM found → early return)
    mockQuery.mockResolvedValueOnce({ rows: [] });
    return;
  }

  mockQuery
    .mockResolvedValueOnce({ rows: [kamRow] })
    .mockResolvedValueOnce({ rows: subtreeRows })
    .mockResolvedValueOnce({ rows: accountRows });
}

/** A minimal KAM row as returned from `pool.query`. */
function kamRow(id: number, orgRole: string, reportsTo: number | null = null) {
  return { id, org_role: orgRole, reports_to: reportsTo };
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('getVisibleAccountIds', () => {
  beforeEach(() => {
    flushCommercialScopeCache();
    mockQuery.mockReset();
  });

  // ── 1. KAM — own accounts only ─────────────────────────────────────────────

  it('KAM: returns only its own directly assigned accounts', async () => {
    setupPoolCalls(
      kamRow(10, 'KAM'),
      [{ id: 10 }],                               // subtree = self only
      [{ account_id: 'acc-100' }, { account_id: 'acc-101' }]
    );

    const scope = await getVisibleAccountIds('user-a');

    expect(scope.scopeError).toBeUndefined();
    expect(scope.orgRole).toBe('KAM');
    expect(scope.kamId).toBe(10);
    expect(scope.kamIds).toEqual([10]);
    expect(scope.accountIds).toEqual(['acc-100', 'acc-101']);
  });

  // ── 2. Team Lead — self + direct AEs ───────────────────────────────────────

  it('Team Lead: returns own accounts and all AEs in their team', async () => {
    setupPoolCalls(
      kamRow(20, 'TeamLead'),
      [{ id: 20 }, { id: 21 }, { id: 22 }, { id: 23 }], // TL + 3 AEs
      [
        { account_id: 'acc-200' },
        { account_id: 'acc-210' },
        { account_id: 'acc-220' },
        { account_id: 'acc-221' },
      ]
    );

    const scope = await getVisibleAccountIds('user-tl');

    expect(scope.orgRole).toBe('TeamLead');
    expect(scope.kamIds).toHaveLength(4);
    expect(scope.kamIds).toContain(20);
    expect(scope.kamIds).toContain(21);
    expect(scope.accountIds).toHaveLength(4);
  });

  // ── 3. Manager — entire reporting team ─────────────────────────────────────

  it('Manager: returns accounts for entire reporting team (TLs + AEs)', async () => {
    setupPoolCalls(
      kamRow(30, 'Manager'),
      [{ id: 30 }, { id: 31 }, { id: 32 }, { id: 33 }, { id: 34 }, { id: 35 }],
      [
        { account_id: 'acc-300' }, { account_id: 'acc-310' },
        { account_id: 'acc-320' }, { account_id: 'acc-330' },
        { account_id: 'acc-340' }, { account_id: 'acc-350' },
      ]
    );

    const scope = await getVisibleAccountIds('user-mgr');

    expect(scope.orgRole).toBe('Manager');
    expect(scope.kamIds).toHaveLength(6);
    expect(scope.accountIds).toHaveLength(6);
    expect(scope.scopeError).toBeUndefined();
  });

  // ── 4. VP — entire VP organisation ─────────────────────────────────────────

  it('VP: returns accounts for the entire VP organisation', async () => {
    const subtree = Array.from({ length: 15 }, (_, i) => ({ id: 50 + i }));
    const accounts = subtree.map(r => ({ account_id: `acc-${r.id}` }));

    setupPoolCalls(kamRow(50, 'VP'), subtree, accounts);

    const scope = await getVisibleAccountIds('user-vp');

    expect(scope.orgRole).toBe('VP');
    expect(scope.kamIds).toHaveLength(15);
    expect(scope.accountIds).toHaveLength(15);
  });

  // ── 5. HOD/CEO — entire hierarchy ──────────────────────────────────────────

  it('HOD: returns accounts for the entire organisation (root node)', async () => {
    const subtree = Array.from({ length: 50 }, (_, i) => ({ id: i + 1 }));
    const accounts = subtree.map(r => ({ account_id: `acc-${r.id}` }));

    setupPoolCalls(kamRow(1, 'HOD'), subtree, accounts);

    const scope = await getVisibleAccountIds('user-hod');

    expect(scope.orgRole).toBe('HOD');
    expect(scope.kamIds).toHaveLength(50);
    expect(scope.accountIds).toHaveLength(50);
    expect(scope.scopeError).toBeUndefined();
  });

  // ── 6. No KAM mapping → controlled failure ─────────────────────────────────

  it('No KAM mapping: returns scopeError no_kam_link, empty accountIds', async () => {
    setupPoolCalls(null, [], []);

    const scope = await getVisibleAccountIds('user-unlinked');

    expect(scope.scopeError).toBe('no_kam_link');
    expect(scope.accountIds).toEqual([]);
    expect(scope.kamIds).toEqual([]);
    expect(scope.kamId).toBeNull();
    expect(scope.orgRole).toBeNull();
  });

  // ── 7. Circular reporting relationship ─────────────────────────────────────
  //
  // In production, the recursive CTE uses UNION (not UNION ALL), which
  // deduplicates rows and naturally terminates a cycle:
  //   A → B → A   would try to add A again, but UNION removes the duplicate.
  //
  // This test verifies that even if PostgreSQL returns a bounded set (because
  // UNION breaks the cycle), the service returns a valid scope without hanging.
  // The DB-side safety of UNION is the primary guard; this test confirms the
  // service doesn't further explode or error on the result.

  it('Circular reports: service handles bounded CTE result without error', async () => {
    // Simulate: UNION stops after visiting each node once.
    // A (id=60) → B (id=61) → A (cycle broken by UNION → only {60, 61} returned)
    setupPoolCalls(
      kamRow(60, 'Manager'),
      [{ id: 60 }, { id: 61 }],         // UNION terminated the cycle
      [{ account_id: 'acc-600' }, { account_id: 'acc-610' }]
    );

    const scope = await getVisibleAccountIds('user-cycle');

    expect(scope.scopeError).toBeUndefined();
    expect(scope.kamIds).toEqual([60, 61]);
    expect(scope.accountIds).toHaveLength(2);
  });

  // ── 8. Inactive KAM node — no unauthorised scope expansion ─────────────────
  //
  // Inactive nodes are excluded in the CTE's WHERE clause:
  //   WHERE k.active IS NULL OR k.active = true
  // The mock simulates the SQL correctly filtering them out.

  it('Inactive KAM: inactive nodes are not included in the subtree', async () => {
    // Tree: TL(70) → AE1(71) [active] + AE2(72) [inactive — excluded by SQL]
    // SQL only returns {70, 71} because the WHERE filters out inactive nodes.
    setupPoolCalls(
      kamRow(70, 'TeamLead'),
      [{ id: 70 }, { id: 71 }],          // 72 not returned (inactive)
      [{ account_id: 'acc-700' }, { account_id: 'acc-710' }]
    );

    const scope = await getVisibleAccountIds('user-tl2');

    expect(scope.kamIds).toEqual([70, 71]);
    expect(scope.kamIds).not.toContain(72);
    expect(scope.accountIds).toHaveLength(2);
  });

  // ── 9. Duplicate account assignments → deduplicated ────────────────────────
  //
  // Multiple KAMs can be assigned the same Sippy account (e.g. inherited
  // account, joint coverage). The SQL uses DISTINCT; the mock simulates
  // what DISTINCT returns. This test verifies the service handles it correctly.

  it('Duplicate accounts: returns deduplicated accountIds', async () => {
    // Two KAMs both assigned acc-900
    setupPoolCalls(
      kamRow(80, 'Manager'),
      [{ id: 80 }, { id: 81 }],
      [{ account_id: 'acc-900' }]       // DISTINCT in SQL → only one row
    );

    const scope = await getVisibleAccountIds('user-mgr2');

    expect(scope.accountIds).toEqual(['acc-900']);
    expect(scope.accountIds).toHaveLength(1);
  });

  // ── 10. KAM with no accounts assigned ──────────────────────────────────────

  it('KAM with no accounts: returns scopeError no_accounts (not no_kam_link)', async () => {
    setupPoolCalls(
      kamRow(90, 'KAM'),
      [{ id: 90 }],
      []                               // no kamAccounts rows
    );

    const scope = await getVisibleAccountIds('user-empty');

    expect(scope.scopeError).toBe('no_accounts');
    expect(scope.accountIds).toEqual([]);
    expect(scope.kamId).toBe(90);       // KAM record was found
    expect(scope.orgRole).toBe('KAM');
  });

  // ── 11. Cache hit — second call does not re-query DB ───────────────────────

  it('Cache hit: second call returns cached scope without hitting DB again', async () => {
    setupPoolCalls(
      kamRow(100, 'KAM'),
      [{ id: 100 }],
      [{ account_id: 'acc-1000' }]
    );

    const first  = await getVisibleAccountIds('user-cache');
    const second = await getVisibleAccountIds('user-cache');

    expect(first).toBe(second);               // same object reference
    expect(mockQuery).toHaveBeenCalledTimes(3); // only 3 calls total (not 6)
  });

  // ── 12. Cache invalidation ──────────────────────────────────────────────────

  it('invalidateCommercialScope: cleared entry causes re-query on next call', async () => {
    setupPoolCalls(
      kamRow(110, 'KAM'),
      [{ id: 110 }],
      [{ account_id: 'acc-1100' }]
    );

    await getVisibleAccountIds('user-inv');
    expect(mockQuery).toHaveBeenCalledTimes(3);

    invalidateCommercialScope('user-inv');

    // Set up fresh responses for the re-query
    mockQuery
      .mockResolvedValueOnce({ rows: [kamRow(110, 'KAM')] })
      .mockResolvedValueOnce({ rows: [{ id: 110 }] })
      .mockResolvedValueOnce({ rows: [{ account_id: 'acc-1100' }] });

    await getVisibleAccountIds('user-inv');
    expect(mockQuery).toHaveBeenCalledTimes(6);  // 3 original + 3 new
  });

  // ── 13. getScopeCacheStats — diagnostics ───────────────────────────────────

  it('getScopeCacheStats: returns correct live entry count', async () => {
    setupPoolCalls(kamRow(120, 'KAM'), [{ id: 120 }], [{ account_id: 'acc-x' }]);
    await getVisibleAccountIds('user-stat');

    const stats = getScopeCacheStats();
    expect(stats.entries).toBe(1);
    expect(stats.userIds).toContain('user-stat');
  });
});

// ── getAllAccountIds ───────────────────────────────────────────────────────────

describe('getAllAccountIds', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('returns all accountIds and kamIds from the entire kam_accounts table', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { account_id: 'acc-1', kam_id: 1 },
        { account_id: 'acc-2', kam_id: 1 },
        { account_id: 'acc-3', kam_id: 2 },
        { account_id: 'acc-2', kam_id: 3 },  // duplicate account_id → deduplicated
      ],
    });

    const scope = await getAllAccountIds();

    expect(scope.kamId).toBeNull();
    expect(scope.orgRole).toBeNull();
    expect(scope.accountIds).toContain('acc-1');
    expect(scope.accountIds).toContain('acc-2');
    expect(scope.accountIds).toContain('acc-3');
    expect(scope.kamIds).toContain(1);
    expect(scope.kamIds).toContain(2);
    expect(scope.kamIds).toContain(3);
  });

  it('returns empty arrays when no accounts exist in the system', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const scope = await getAllAccountIds();

    expect(scope.accountIds).toEqual([]);
    expect(scope.kamIds).toEqual([]);
  });
});
