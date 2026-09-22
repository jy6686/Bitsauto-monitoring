/**
 * The Commercial P&L's arithmetic, tested without a database.
 *
 * Each block pins one of the rules in pnl.ts. The rules exist because of production evidence
 * from 2026-09-22 — 6 of 33 accounts covered, half the account-days missing, margin near zero —
 * and each one is a way the report could quietly say something false while looking fine.
 */
import { describe, it, expect } from 'vitest';
import {
  marginPercent, intersectScope, parseDateRange, calendarDays, shapePnl,
  type PnlDailyRow, type PnlClientRow,
} from './pnl';

const day = (date: string, revenue: number, cost: number, accounts = 1): PnlDailyRow => ({
  date, revenue, cost, margin: revenue - cost, calls: 10, billedSeconds: 600, accounts,
});
const client = (accountId: string, revenue: number, cost: number, accountName: string | null = `acct ${accountId}`): PnlClientRow => ({
  accountId, accountName, revenue, cost, margin: revenue - cost, calls: 10, days: 1,
});

describe('marginPercent is recomputed from aggregates, never summed', () => {
  it('is margin over revenue, as a percentage', () => {
    expect(marginPercent(25, 100)).toBe(25);
    expect(marginPercent(-2.3719, 110.8601)).toBeCloseTo(-2.1395, 3);
  });

  /**
   * Zero revenue has no defined margin percentage. 0 would read as "broke even"; Infinity and
   * NaN would break the UI. Only null says "not computable".
   */
  it('is null when revenue is zero — not 0, not Infinity, not NaN', () => {
    expect(marginPercent(5, 0)).toBeNull();
    expect(marginPercent(0, 0)).toBeNull();
    expect(marginPercent(-5, 0)).toBeNull();
  });

  it('is null for non-finite inputs', () => {
    expect(marginPercent(NaN, 100)).toBeNull();
    expect(marginPercent(5, Infinity)).toBeNull();
  });
});

describe('intersectScope — the caller narrows the scope and can never widen it', () => {
  const SCOPE = ['1067', '1069', '76'];

  it('no filter requested → the whole scope', () => {
    expect(intersectScope(undefined, SCOPE).sort()).toEqual([...SCOPE].sort());
    expect(intersectScope([], SCOPE).sort()).toEqual([...SCOPE].sort());
    expect(intersectScope('not-an-array', SCOPE).sort()).toEqual([...SCOPE].sort());
  });

  it('keeps only the requested ids that are in scope', () => {
    expect(intersectScope(['1067'], SCOPE)).toEqual(['1067']);
  });

  /**
   * THE SECURITY INVARIANT. A foreign id is silently absent — never an error, because an error
   * would confirm which ids exist outside the caller's scope. This is the push-scope-guard
   * posture: the body proves nothing.
   */
  it('drops a foreign id silently rather than refusing or admitting it', () => {
    const out = intersectScope(['1067', '9999'], SCOPE);
    expect(out).toEqual(['1067']);
    expect(out).not.toContain('9999');
  });

  it('a request made ENTIRELY of foreign ids yields an empty set — not the whole scope', () => {
    // The dangerous inversion: "nothing matched, so no filter" would return everything.
    expect(intersectScope(['9999', '8888'], SCOPE)).toEqual([]);
  });

  it('compares as strings: 1067 and "1067" are the same account', () => {
    expect(intersectScope([1067], SCOPE)).toEqual(['1067']);
  });

  it('deduplicates', () => {
    expect(intersectScope(['1067', '1067', 1067], SCOPE)).toEqual(['1067']);
  });
});

describe('parseDateRange', () => {
  const TODAY = '2026-09-22';

  it('defaults to a 30-day window ending today', () => {
    expect(parseDateRange(undefined, undefined, TODAY)).toEqual({ ok: true, from: '2026-08-24', to: '2026-09-22' });
  });

  it('accepts an explicit range', () => {
    expect(parseDateRange('2026-07-19', '2026-09-21', TODAY)).toEqual({ ok: true, from: '2026-07-19', to: '2026-09-21' });
  });

  it('refuses a malformed date', () => {
    expect(parseDateRange('19/07/2026', undefined, TODAY)).toMatchObject({ ok: false });
    expect(parseDateRange(undefined, 'yesterday', TODAY)).toMatchObject({ ok: false });
  });

  it('refuses an inverted range', () => {
    expect(parseDateRange('2026-09-21', '2026-07-19', TODAY)).toMatchObject({ ok: false });
  });

  /** One request must not be able to ask for years of rows. */
  it('refuses a span over 400 days', () => {
    expect(parseDateRange('2025-01-01', '2026-09-22', TODAY)).toMatchObject({ ok: false });
    expect(parseDateRange('2025-09-01', '2026-09-22', TODAY)).toMatchObject({ ok: true });
  });
});

describe('calendarDays', () => {
  it('is inclusive at both ends and crosses month boundaries', () => {
    expect(calendarDays('2026-07-30', '2026-08-02')).toEqual(['2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02']);
  });
  it('a single day is a single entry', () => {
    expect(calendarDays('2026-09-21', '2026-09-21')).toEqual(['2026-09-21']);
  });
});

describe('shapePnl — a missing day is NULL, never zero', () => {
  const base = {
    from: '2026-09-14', to: '2026-09-17', earliestAvailable: '2026-07-19',
    scopeAccountIds: ['1067', '1069', '76', '1'],
  };

  it('emits every calendar day in the range, with data where it exists', () => {
    const r = shapePnl({ ...base, daily: [day('2026-09-14', 110.86, 113.23), day('2026-09-16', 126.67, 124.45)], clients: [] });
    expect(r.series.map(p => p.date)).toEqual(['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17']);
    expect(r.series[0].revenue).toBeCloseTo(110.86, 4);
    expect(r.series[2].revenue).toBeCloseTo(126.67, 4);
  });

  /**
   * THE RULE. "$0.00" claims nothing was earned; null says nothing was recorded. On an estate
   * where half the account-days are missing, a zero-filled chart would draw a business that
   * earns nothing most days — which is false.
   */
  it('a day with no snapshot row is null on every measure — not 0', () => {
    const r = shapePnl({ ...base, daily: [day('2026-09-14', 100, 90)], clients: [] });
    const gap = r.series[1];
    expect(gap.date).toBe('2026-09-15');
    expect(gap.revenue).toBeNull();
    expect(gap.cost).toBeNull();
    expect(gap.margin).toBeNull();
    expect(gap.marginPercent).toBeNull();
    expect(gap.calls).toBeNull();
    expect(gap.accounts).toBe(0);
    // And specifically not zero — the mutation this guards against.
    expect(gap.revenue).not.toBe(0);
  });

  it('counts days with data against days in range, so the UI can say "3 of 64"', () => {
    const r = shapePnl({ ...base, daily: [day('2026-09-14', 1, 1), day('2026-09-16', 1, 1)], clients: [] });
    expect(r.summary.daysWithData).toBe(2);
    expect(r.summary.daysInRange).toBe(4);
  });

  it('negative margin survives untouched — it is the truth, not an error', () => {
    const r = shapePnl({ ...base, daily: [day('2026-09-14', 110.8601, 113.232)], clients: [] });
    expect(r.summary.margin).toBeLessThan(0);
    expect(r.series[0].margin).toBeLessThan(0);
    expect(r.summary.marginPercent).toBeLessThan(0);
  });
});

describe('shapePnl — summary and margin percent', () => {
  const base = { from: '2026-09-14', to: '2026-09-15', earliestAvailable: null, scopeAccountIds: ['1'] };

  it('sums revenue, cost and margin across the days that have data', () => {
    const r = shapePnl({ ...base, daily: [day('2026-09-14', 100, 80), day('2026-09-15', 50, 45)], clients: [] });
    expect(r.summary).toMatchObject({ revenue: 150, cost: 125, margin: 25 });
  });

  it('recomputes the summary margin percent from the sums', () => {
    const r = shapePnl({ ...base, daily: [day('2026-09-14', 100, 80), day('2026-09-15', 50, 45)], clients: [] });
    // 25 / 150 — NOT the average of the two daily percentages (20% and 10% → 15%).
    expect(r.summary.marginPercent).toBeCloseTo(16.6667, 3);
    expect(r.summary.marginPercent).not.toBeCloseTo(15, 3);
  });

  it('an empty range has zero sums and a NULL margin percent', () => {
    const r = shapePnl({ ...base, daily: [], clients: [] });
    expect(r.summary).toMatchObject({ revenue: 0, cost: 0, margin: 0, marginPercent: null, daysWithData: 0 });
  });
});

describe('shapePnl — coverage is the caller\'s scope, never the estate', () => {
  it('numerator = accounts with rows, denominator = accounts in scope', () => {
    const r = shapePnl({
      from: '2026-09-14', to: '2026-09-14', earliestAvailable: null,
      scopeAccountIds: ['1067', '1069', '76', '1'],
      daily: [day('2026-09-14', 10, 8, 1)],
      clients: [client('1067', 10, 8)],
    });
    expect(r.coverage).toEqual({ accountsWithData: 1, accountsInScope: 4 });
    expect(r.notices.coverage).toContain('1 of 4 accounts');
  });

  /** A four-account KAM must never see "6 of 33" — that is the estate, and not theirs. */
  it('the denominator is the scope handed in, whatever the estate holds', () => {
    const r = shapePnl({
      from: '2026-09-14', to: '2026-09-14', earliestAvailable: null,
      scopeAccountIds: ['1067', '1069'],
      daily: [], clients: [],
    });
    expect(r.coverage.accountsInScope).toBe(2);
    expect(r.notices.coverage).not.toContain('33');
  });

  it('deduplicates ids in both numerator and denominator', () => {
    const r = shapePnl({
      from: '2026-09-14', to: '2026-09-14', earliestAvailable: null,
      scopeAccountIds: ['1', '1', 1 as any],
      daily: [], clients: [client('1', 5, 4), client('1', 5, 4)],
    });
    expect(r.coverage).toEqual({ accountsWithData: 1, accountsInScope: 1 });
  });
});

describe('shapePnl — clients are keyed by account id, labelled by name', () => {
  it('keeps distinct accounts distinct even when their names collide', () => {
    // Account 76 is claimed by two companies in production; the id is the identity.
    const r = shapePnl({
      from: '2026-09-14', to: '2026-09-14', earliestAvailable: null, scopeAccountIds: ['76', '588'],
      daily: [], clients: [client('76', 10, 8, 'ptcl'), client('588', 20, 15, 'ptcl')],
    });
    expect(r.clients.map(c => c.accountId)).toEqual(['588', '76']);
  });

  it('sorts by revenue descending and recomputes each client\'s margin percent', () => {
    const r = shapePnl({
      from: '2026-09-14', to: '2026-09-14', earliestAvailable: null, scopeAccountIds: ['a', 'b'],
      daily: [], clients: [client('a', 10, 9), client('b', 100, 50)],
    });
    expect(r.clients[0].accountId).toBe('b');
    expect(r.clients[0].marginPercent).toBe(50);
    expect(r.clients[1].marginPercent).toBe(10);
  });

  it('a client with zero revenue has a null margin percent', () => {
    const r = shapePnl({
      from: '2026-09-14', to: '2026-09-14', earliestAvailable: null, scopeAccountIds: ['a'],
      daily: [], clients: [client('a', 0, 3)],
    });
    expect(r.clients[0].marginPercent).toBeNull();
  });
});

describe('the three notices are always present', () => {
  it('margin quality, cost basis and coverage — none can be dropped by omission', () => {
    const r = shapePnl({ from: '2026-09-14', to: '2026-09-14', earliestAvailable: null, scopeAccountIds: [], daily: [], clients: [] });
    expect(r.notices.marginQuality).toMatch(/rate-card duplication/);
    expect(r.notices.costBasis).toMatch(/not direct vendor-side truth/);
    expect(r.notices.coverage).toMatch(/not the complete portfolio/);
  });
});
