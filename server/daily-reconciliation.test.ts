import { describe, it, expect } from 'vitest';
import { reconcileDaily, type Cell } from './daily-reconciliation';

const c = (day: string, account: string, amount: number): Cell =>
  ({ day, account, amount, minutes: 0, calls: 0 });

const WEEK = ['2026-08-24','2026-08-25','2026-08-26','2026-08-27',
              '2026-08-28','2026-08-29','2026-08-30'];

describe('the production week, cell by cell', () => {
  /**
   * Measured 2026-09-01. The point of the cell grain: the week total of
   * $331.78 against $683.39 cannot say whether one day is catastrophic or all
   * seven are mediocre, and those need different fixes.
   */
  const result = reconcileDaily({
    days: ['2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30'],
    reference: [
      c('2026-08-27', 'asterisk', 47.3515),
      c('2026-08-27', 'internal-eritrea', 15.4321),
      c('2026-08-28', 'asterisk', 60.0627),
      c('2026-08-28', 'internal-ptcl', 49.5896),
      // 08-29 deliberately absent — no DMR row exists for that date.
      c('2026-08-30', 'asterisk', 84.8992),
      c('2026-08-30', 'internal-ptcl', 77.2257),
    ],
    platform: [
      c('2026-08-27', 'asterisk', 47.3515),          // exact
      c('2026-08-27', 'internal-eritrea', 15.4321),  // exact
      c('2026-08-28', 'asterisk', 15.7578),          // 26%
      c('2026-08-28', 'internal-ptcl', 16.6877),     // 34%
      c('2026-08-29', 'asterisk', 6.2474),           // unknowable
      c('2026-08-30', 'asterisk', 43.2176),          // 51%
      c('2026-08-30', 'internal-ptcl', 36.4579),     // 47%
    ],
  });

  it('passes the two cells that match the switch exactly', () => {
    const ok = result.cells.filter(x => x.status === 'match');
    expect(ok.map(x => x.account).sort()).toEqual(['asterisk', 'internal-eritrea']);
    expect(ok.every(x => x.day === '2026-08-27')).toBe(true);
    expect(ok.every(x => !x.actionable)).toBe(true);
  });

  it('marks the shortfalls actionable and ranks them by money', () => {
    // Worst first: 08-28 asterisk −44.30, then 08-30 asterisk −41.68,
    // 08-30 internal-ptcl −40.77, 08-28 internal-ptcl −32.90. Worth pinning,
    // because the WORST cell is not on the worst-looking day — 08-30 has the
    // larger reference, but 08-28 lost more money.
    expect(result.actions.map(x => `${x.day}/${x.account}`)).toEqual([
      '2026-08-28/asterisk',
      '2026-08-30/asterisk',
      '2026-08-30/internal-ptcl',
      '2026-08-28/internal-ptcl',
    ]);
    expect(Math.abs(result.actions[0].delta)).toBeCloseTo(44.3049, 3);
    expect(result.actions.every(x => x.actionable)).toBe(true);
  });

  it('reports the ratio, so 26% and 51% are distinguishable at a glance', () => {
    const a28 = result.cells.find(x => x.day === '2026-08-28' && x.account === 'asterisk')!;
    const a30 = result.cells.find(x => x.day === '2026-08-30' && x.account === 'asterisk')!;
    expect(a28.ratio).toBeCloseTo(0.2623, 3);
    expect(a30.ratio).toBeCloseTo(0.5090, 3);
    expect(a28.reason).toContain('26.2%');
  });

  it('sums only the shortfalls into recoverable money', () => {
    // 08-28: 44.3049 + 32.9019 ; 08-30: 41.6816 + 40.7678
    expect(result.summary.recoverableUsd).toBeCloseTo(159.6562, 2);
  });

  it('does not let the unknowable day contaminate the knowable ones', () => {
    const d29 = result.cells.filter(x => x.day === '2026-08-29');
    expect(d29).toHaveLength(1);
    expect(d29[0].status).toBe('no_reference');
    expect(d29[0].actionable).toBe(false);
    expect(result.daysWithoutReference).toEqual(['2026-08-29']);
    // …and the other six days still produced verdicts.
    expect(result.summary.matched).toBe(2);
    expect(result.summary.short).toBe(4);
  });

  it('never counts an unknowable cell as verified', () => {
    const d29 = result.cells.find(x => x.day === '2026-08-29')!;
    expect(d29.reference).toBeNull();
    expect(d29.reason).toContain('cannot be judged');
    expect(d29.reason).toContain('Run DMR');
  });
});

describe('the four statuses that are NOT a shortfall', () => {
  it('flags a cell the switch billed and the platform lacks entirely', () => {
    const r = reconcileDaily({
      days: ['2026-08-24'],
      reference: [c('2026-08-24', 'internal-eritrea', 3.92)],
      platform: [],
    });
    expect(r.cells[0].status).toBe('missing_from_platform');
    expect(r.cells[0].actionable).toBe(true);
    expect(r.cells[0].ratio).toBe(0);
    expect(r.summary.recoverableUsd).toBeCloseTo(3.92, 4);
  });

  /**
   * Over-collection is never fixed by fetching more, and it is the more
   * dangerous direction: it reads as reassuring while it would over-bill.
   */
  it('refuses to make an EXCESS actionable', () => {
    const r = reconcileDaily({
      days: ['2026-08-24'],
      reference: [c('2026-08-24', 'asterisk', 10)],
      platform:  [c('2026-08-24', 'asterisk', 12)],
    });
    expect(r.cells[0].status).toBe('over');
    expect(r.cells[0].actionable).toBe(false);
    expect(r.cells[0].reason).toContain('over-billing is the worse error');
    expect(r.actions).toEqual([]);
    expect(r.summary.recoverableUsd).toBe(0);
  });

  it('refuses to make an unreferenced platform row actionable', () => {
    const r = reconcileDaily({
      days: ['2026-08-24'],
      reference: [c('2026-08-24', 'asterisk', 10)],
      platform:  [c('2026-08-24', 'asterisk', 10), c('2026-08-24', 'ghost', 5)],
    });
    const ghost = r.cells.find(x => x.account === 'ghost')!;
    expect(ghost.status).toBe('missing_from_reference');
    expect(ghost.actionable).toBe(false);
    expect(ghost.reason).toContain('Re-fetching cannot resolve this');
  });

  it('treats a day with no reference as unknowable even when both sides are empty', () => {
    const r = reconcileDaily({ days: WEEK, reference: [], platform: [] });
    expect(r.daysWithoutReference).toEqual(WEEK);
    expect(r.cells).toEqual([]);      // nothing to compare
    expect(r.actions).toEqual([]);    // and nothing to do about it
  });
});

describe('tolerance', () => {
  it('accepts a cent of difference', () => {
    const r = reconcileDaily({
      days: ['2026-08-24'],
      reference: [c('2026-08-24', 'asterisk', 10.00)],
      platform:  [c('2026-08-24', 'asterisk', 10.01)],
    });
    expect(r.cells[0].status).toBe('match');
  });

  it('rejects more than a cent', () => {
    const r = reconcileDaily({
      days: ['2026-08-24'],
      reference: [c('2026-08-24', 'asterisk', 10.00)],
      platform:  [c('2026-08-24', 'asterisk', 9.98)],
    });
    expect(r.cells[0].status).toBe('short');
    expect(r.cells[0].actionable).toBe(true);
  });

  it('honours an explicit tolerance', () => {
    const r = reconcileDaily({
      days: ['2026-08-24'],
      reference: [c('2026-08-24', 'asterisk', 10.00)],
      platform:  [c('2026-08-24', 'asterisk', 9.50)],
      toleranceUsd: 1,
    });
    expect(r.cells[0].status).toBe('match');
  });
});

describe('identity matching', () => {
  it('matches names case-insensitively and ignores surrounding space', () => {
    const r = reconcileDaily({
      days: ['2026-08-24'],
      reference: [c('2026-08-24', 'Asterisk', 10)],
      platform:  [c('2026-08-24', '  asterisk ', 10)],
    });
    expect(r.cells).toHaveLength(1);
    expect(r.cells[0].status).toBe('match');
  });

  it('keeps two different accounts on the same day apart', () => {
    const r = reconcileDaily({
      days: ['2026-08-24'],
      reference: [c('2026-08-24', 'asterisk', 10), c('2026-08-24', 'internal-ptcl', 20)],
      platform:  [c('2026-08-24', 'asterisk', 10), c('2026-08-24', 'internal-ptcl', 5)],
    });
    expect(r.summary.matched).toBe(1);
    expect(r.summary.short).toBe(1);
    expect(r.actions[0].account).toBe('internal-ptcl');
  });

  it('keeps the same account on different days apart', () => {
    const r = reconcileDaily({
      days: ['2026-08-24', '2026-08-25'],
      reference: [c('2026-08-24', 'asterisk', 10), c('2026-08-25', 'asterisk', 10)],
      platform:  [c('2026-08-24', 'asterisk', 10), c('2026-08-25', 'asterisk', 2)],
    });
    expect(r.summary.matched).toBe(1);
    expect(r.actions).toHaveLength(1);
    expect(r.actions[0].day).toBe('2026-08-25');
  });
});

describe('ordering', () => {
  it('lists cells chronologically for reading, and actions by money for doing', () => {
    const r = reconcileDaily({
      days: ['2026-08-24', '2026-08-25'],
      reference: [c('2026-08-24', 'asterisk', 100), c('2026-08-25', 'asterisk', 10)],
      platform:  [c('2026-08-24', 'asterisk', 95),  c('2026-08-25', 'asterisk', 1)],
    });
    expect(r.cells.map(x => x.day)).toEqual(['2026-08-24', '2026-08-25']);
    // 08-25 is short by 9 and 08-24 by 5, so the work list inverts the order.
    expect(r.actions.map(x => x.day)).toEqual(['2026-08-25', '2026-08-24']);
  });
});
