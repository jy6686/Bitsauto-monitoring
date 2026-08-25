/**
 * Billing periods — the owner's rule, pinned.
 *
 *   No customer invoice may span two accounting months.
 *
 * Dates are real 2026/2028 calendar dates, not invented ones: 17 Aug 2026 is a
 * Monday (it is the billing week that appears in the switch reports), so
 * 31 Aug 2026 is also a Monday and its week straddles into September — the
 * exact case the owner described.
 */

import { describe, it, expect } from 'vitest';
import {
  splitAtMonthEnd, closedPeriods, latestClosedPeriods, normalizeTerm,
} from './billing-periods';

describe('splitAtMonthEnd', () => {
  it('splits a week that straddles month-end', () => {
    expect(splitAtMonthEnd('2026-08-31', '2026-09-06')).toEqual([
      { start: '2026-08-31', end: '2026-08-31' },   // one day, closing August
      { start: '2026-09-01', end: '2026-09-06' },
    ]);
  });

  it('leaves a period inside one month untouched', () => {
    expect(splitAtMonthEnd('2026-08-24', '2026-08-30'))
      .toEqual([{ start: '2026-08-24', end: '2026-08-30' }]);
  });

  it('a period ending exactly on month-end is not split', () => {
    expect(splitAtMonthEnd('2026-08-01', '2026-08-31')).toHaveLength(1);
  });

  it('splits a span crossing several months into one piece per month', () => {
    const p = splitAtMonthEnd('2026-07-28', '2026-09-03');
    expect(p).toEqual([
      { start: '2026-07-28', end: '2026-07-31' },
      { start: '2026-08-01', end: '2026-08-31' },
      { start: '2026-09-01', end: '2026-09-03' },
    ]);
  });

  it('handles February in a leap year', () => {
    expect(splitAtMonthEnd('2028-02-28', '2028-03-01')).toEqual([
      { start: '2028-02-28', end: '2028-02-29' },
      { start: '2028-03-01', end: '2028-03-01' },
    ]);
  });

  it('an inverted span yields nothing rather than looping', () => {
    expect(splitAtMonthEnd('2026-09-01', '2026-08-01')).toEqual([]);
  });
});

describe('weekly', () => {
  it('bills Monday–Sunday weeks that have closed', () => {
    // 17 Aug 2026 is a Monday; as of Mon 24 Aug the 17–23 week has closed.
    const p = closedPeriods('weekly', '2026-08-24', '2026-08-17');
    expect(p).toEqual([{
      start: '2026-08-17', end: '2026-08-23',
      accountingMonth: '2026-08', partial: false,
    }]);
  });

  it('does not bill a week still in progress', () => {
    // As of Fri 21 Aug, the week 17–23 has not closed.
    expect(closedPeriods('weekly', '2026-08-21', '2026-08-17')).toEqual([]);
  });

  it("closes August on 1 September, without waiting for the week to end", () => {
    // The natural week is 31 Aug – 6 Sep. On 1 Sep the August fragment is
    // closed and must be invoiced so August closes in August.
    const p = closedPeriods('weekly', '2026-09-01', '2026-08-31');
    expect(p).toEqual([{
      start: '2026-08-31', end: '2026-08-31',
      accountingMonth: '2026-08', partial: true,
    }]);
  });

  it('bills the straddling week as two invoices, one per accounting month', () => {
    const p = closedPeriods('weekly', '2026-09-07', '2026-08-31');
    expect(p).toEqual([
      { start: '2026-08-31', end: '2026-08-31', accountingMonth: '2026-08', partial: true },
      { start: '2026-09-01', end: '2026-09-06', accountingMonth: '2026-09', partial: true },
    ]);
  });

  it('every period belongs to exactly one accounting month', () => {
    for (const p of closedPeriods('weekly', '2026-10-01', '2026-07-01')) {
      expect(p.start.slice(0, 7)).toBe(p.end.slice(0, 7));
      expect(p.accountingMonth).toBe(p.start.slice(0, 7));
    }
  });

  it('returns every missed period, so a late schedule loses no revenue', () => {
    // Three weeks unbilled: the generator's duplicate guard skips any already
    // invoiced, so back-billing needs no separate code path.
    const p = closedPeriods('weekly', '2026-08-31', '2026-08-10');
    expect(p.map(x => `${x.start}→${x.end}`)).toEqual([
      '2026-08-10→2026-08-16', '2026-08-17→2026-08-23', '2026-08-24→2026-08-30',
    ]);
  });
});

describe('bi_monthly', () => {
  it('bills 1–15 and 16–end of month, not a rolling fortnight', () => {
    const p = closedPeriods('bi_monthly', '2026-09-01', '2026-08-01');
    expect(p).toEqual([
      { start: '2026-08-01', end: '2026-08-15', accountingMonth: '2026-08', partial: false },
      { start: '2026-08-16', end: '2026-08-31', accountingMonth: '2026-08', partial: false },
    ]);
  });

  it('the second half of February ends on the 29th in a leap year', () => {
    const p = closedPeriods('bi_monthly', '2028-03-01', '2028-02-01');
    expect(p[1]).toMatchObject({ start: '2028-02-16', end: '2028-02-29' });
  });

  it('does not bill the second half before the month has ended', () => {
    const p = closedPeriods('bi_monthly', '2026-08-20', '2026-08-01');
    expect(p).toEqual([
      { start: '2026-08-01', end: '2026-08-15', accountingMonth: '2026-08', partial: false },
    ]);
  });
});

describe('monthly', () => {
  it('bills the whole calendar month once it has closed', () => {
    expect(closedPeriods('monthly', '2026-09-01', '2026-08-01')).toEqual([
      { start: '2026-08-01', end: '2026-08-31', accountingMonth: '2026-08', partial: false },
    ]);
  });

  it('does not bill the current month', () => {
    expect(closedPeriods('monthly', '2026-08-31', '2026-08-01')).toEqual([]);
  });
});

describe('latestClosedPeriods', () => {
  it('returns the single most recent period in the ordinary case', () => {
    const p = latestClosedPeriods('weekly', '2026-08-24');
    expect(p).toEqual([{
      start: '2026-08-17', end: '2026-08-23', accountingMonth: '2026-08', partial: false,
    }]);
  });

  it('returns BOTH halves when a month boundary split the latest week', () => {
    const p = latestClosedPeriods('weekly', '2026-09-07');
    expect(p.map(x => x.accountingMonth)).toEqual(['2026-08', '2026-09']);
    expect(p[0]).toMatchObject({ start: '2026-08-31', end: '2026-08-31' });
  });

  it('never returns a period that has not closed', () => {
    for (const term of ['weekly', 'bi_monthly', 'monthly'] as const) {
      for (const p of latestClosedPeriods(term, '2026-08-21')) {
        expect(p.end < '2026-08-21').toBe(true);
      }
    }
  });
});

describe('normalizeTerm', () => {
  it('maps the vocabulary schedules actually store', () => {
    expect(normalizeTerm('weekly')).toBe('weekly');
    expect(normalizeTerm('Monthly')).toBe('monthly');
    expect(normalizeTerm('bi_monthly')).toBe('bi_monthly');
  });

  it('legacy rolling-fortnight names become bi-monthly, the commercial term', () => {
    expect(normalizeTerm('fortnightly')).toBe('bi_monthly');
    expect(normalizeTerm('bi_weekly')).toBe('bi_monthly');
  });

  it('an unknown or missing term falls back to monthly, never to nothing', () => {
    expect(normalizeTerm(null)).toBe('monthly');
    expect(normalizeTerm('something-else')).toBe('monthly');
  });
});
