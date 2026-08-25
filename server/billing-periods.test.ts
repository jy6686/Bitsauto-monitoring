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
  billingPolicyFor, calculateClosedBillingPeriods,
  isPeriodClosed, isAccountingMonthClosed,
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
      start: '2026-08-17', end: '2026-08-23', endExclusive: '2026-08-24',
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
      start: '2026-08-31', end: '2026-08-31', endExclusive: '2026-09-01',
      accountingMonth: '2026-08', partial: true,
    }]);
  });

  it('bills the straddling week as two invoices, one per accounting month', () => {
    const p = closedPeriods('weekly', '2026-09-07', '2026-08-31');
    expect(p).toEqual([
      { start: '2026-08-31', end: '2026-08-31', endExclusive: '2026-09-01', accountingMonth: '2026-08', partial: true },
      { start: '2026-09-01', end: '2026-09-06', endExclusive: '2026-09-07', accountingMonth: '2026-09', partial: true },
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

describe('semi_monthly', () => {
  it('bills 1–15 and 16–end of month, not a rolling fortnight', () => {
    const p = closedPeriods('semi_monthly', '2026-09-01', '2026-08-01');
    expect(p).toEqual([
      { start: '2026-08-01', end: '2026-08-15', endExclusive: '2026-08-16', accountingMonth: '2026-08', partial: false },
      { start: '2026-08-16', end: '2026-08-31', endExclusive: '2026-09-01', accountingMonth: '2026-08', partial: false },
    ]);
  });

  it('the second half of February ends on the 29th in a leap year', () => {
    const p = closedPeriods('semi_monthly', '2028-03-01', '2028-02-01');
    expect(p[1]).toMatchObject({ start: '2028-02-16', end: '2028-02-29' });
  });

  it('does not bill the second half before the month has ended', () => {
    const p = closedPeriods('semi_monthly', '2026-08-20', '2026-08-01');
    expect(p).toEqual([
      { start: '2026-08-01', end: '2026-08-15', endExclusive: '2026-08-16', accountingMonth: '2026-08', partial: false },
    ]);
  });
});

describe('monthly', () => {
  it('bills the whole calendar month once it has closed', () => {
    expect(closedPeriods('monthly', '2026-09-01', '2026-08-01')).toEqual([
      { start: '2026-08-01', end: '2026-08-31', endExclusive: '2026-09-01', accountingMonth: '2026-08', partial: false },
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
      start: '2026-08-17', end: '2026-08-23', endExclusive: '2026-08-24',
      accountingMonth: '2026-08', partial: false,
    }]);
  });

  it('returns BOTH halves when a month boundary split the latest week', () => {
    const p = latestClosedPeriods('weekly', '2026-09-07');
    expect(p.map(x => x.accountingMonth)).toEqual(['2026-08', '2026-09']);
    expect(p[0]).toMatchObject({ start: '2026-08-31', end: '2026-08-31' });
  });

  it('never returns a period that has not closed', () => {
    for (const term of ['weekly', 'semi_monthly', 'monthly'] as const) {
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
    expect(normalizeTerm('bi_monthly')).toBe('semi_monthly');
  });

  it('legacy rolling-fortnight names become semi-monthly, the accounting term', () => {
    expect(normalizeTerm('fortnightly')).toBe('semi_monthly');
    expect(normalizeTerm('bi_weekly')).toBe('semi_monthly');
  });

  it('an unknown or missing term falls back to monthly, never to nothing', () => {
    expect(normalizeTerm(null)).toBe('monthly');
    expect(normalizeTerm('something-else')).toBe('monthly');
  });
});

/**
 * The owner's accounting-boundary rule: a period runs [00:00 GMT, 00:00 GMT).
 * `end` stays inclusive because that is what the invoice prints and what every
 * existing query compares (all of them truncate the CDR timestamp to a date);
 * `endExclusive` is the boundary proper, for comparisons against raw timestamps.
 */
describe('00:00 GMT accounting boundary', () => {
  it('endExclusive is always the day after the last billed day', () => {
    for (const term of ['weekly', 'semi_monthly', 'monthly'] as const) {
      for (const p of closedPeriods(term, '2026-10-01', '2026-07-01')) {
        const next = new Date(`${p.end}T00:00:00Z`);
        next.setUTCDate(next.getUTCDate() + 1);
        expect(p.endExclusive).toBe(next.toISOString().slice(0, 10));
      }
    }
  });

  it('a month runs 1 Aug 00:00 GMT to 1 Sep 00:00 GMT', () => {
    const [aug] = closedPeriods('monthly', '2026-09-02', '2026-08-01');
    expect(aug.start).toBe('2026-08-01');
    expect(aug.endExclusive).toBe('2026-09-01');
  });

  it('a week is exactly seven days wide on the exclusive boundary', () => {
    const [w] = closedPeriods('weekly', '2026-08-24', '2026-08-17');
    const days = (Date.parse(`${w.endExclusive}T00:00:00Z`) - Date.parse(`${w.start}T00:00:00Z`)) / 86400000;
    expect(days).toBe(7);
  });

  it('consecutive periods meet exactly — no gap, no overlap', () => {
    const p = closedPeriods('weekly', '2026-10-01', '2026-08-17');
    for (let i = 1; i < p.length; i++) expect(p[i].start).toBe(p[i - 1].endExclusive);
  });

  it('the untruncated comparison this field exists to prevent', () => {
    // The obvious timestamp query drops the last day, because a timestamp
    // string sorts AFTER the bare date it falls on.
    const lastDayCall = '2026-08-31 14:00:00';
    expect(lastDayCall <= '2026-08-31').toBe(false);            // the trap
    expect(lastDayCall < '2026-09-01').toBe(true);              // endExclusive
  });
});

/**
 * Policy separated from calculation: the scheduler holds a policy and asks for
 * closed periods. Sourced from the company, because the billing cycle is a
 * commercial term and those live on the company profile.
 */
describe('billingPolicyFor', () => {
  it("recognises the company field's own vocabulary", () => {
    expect(billingPolicyFor({ clientBillingCycle: 'weekly_cutoff' }).frequency).toBe('weekly');
    expect(billingPolicyFor({ clientBillingCycle: 'monthly' }).frequency).toBe('monthly');
    expect(billingPolicyFor({ clientBillingCycle: 'daily' }).frequency).toBe('daily');
    expect(billingPolicyFor({ clientBillingCycle: 'bi_weekly' }).frequency).toBe('semi_monthly');
  });

  it("'weekly_cutoff' is the DEFAULT on every company — it must not fall back to monthly", () => {
    // Silently billing a weekly customer monthly is the failure this pins.
    expect(normalizeTerm('weekly_cutoff')).toBe('weekly');
    expect(normalizeTerm('weekly_cutoff')).not.toBe('monthly');
  });

  it('the company outranks the schedule; the schedule is only a fallback', () => {
    expect(billingPolicyFor({ clientBillingCycle: 'monthly' }, 'weekly').frequency).toBe('monthly');
    expect(billingPolicyFor({ clientBillingCycle: null }, 'weekly').frequency).toBe('weekly');
    expect(billingPolicyFor(null, 'weekly').frequency).toBe('weekly');
  });

  it('is always GMT — no local zone, no daylight saving', () => {
    expect(billingPolicyFor({ clientBillingCycle: 'weekly_cutoff' }).timezone).toBe('Etc/UTC');
  });
});

describe('calculateClosedBillingPeriods', () => {
  it('gives the scheduler closed periods without exposing how they are computed', () => {
    const policy = billingPolicyFor({ clientBillingCycle: 'weekly_cutoff' });
    const p = calculateClosedBillingPeriods(policy, new Date('2026-08-24T09:15:00Z'));
    expect(p).toEqual([{
      start: '2026-08-17', end: '2026-08-23', endExclusive: '2026-08-24',
      accountingMonth: '2026-08', partial: false,
    }]);
  });

  it('the time of day within the UTC instant does not shift the period', () => {
    const policy = billingPolicyFor({ clientBillingCycle: 'weekly_cutoff' });
    const early = calculateClosedBillingPeriods(policy, new Date('2026-08-24T00:00:01Z'));
    const late  = calculateClosedBillingPeriods(policy, new Date('2026-08-24T23:59:59Z'));
    expect(early).toEqual(late);
  });

  it('a daily customer is billed one closed day at a time', () => {
    const policy = billingPolicyFor({ clientBillingCycle: 'daily' });
    const p = calculateClosedBillingPeriods(policy, '2026-08-24');
    expect(p).toEqual([{
      start: '2026-08-23', end: '2026-08-23', endExclusive: '2026-08-24',
      accountingMonth: '2026-08', partial: false,
    }]);
  });

  it('back-bills every missed period when a start date is given', () => {
    const policy = billingPolicyFor({ clientBillingCycle: 'weekly_cutoff' });
    const p = calculateClosedBillingPeriods(policy, '2026-08-31', '2026-08-10');
    expect(p).toHaveLength(3);
  });
});

/**
 * The owner's generation-date table, pinned exactly.
 *
 * The invoice generation date IS endExclusive — the first instant after the
 * period closes. No separate field: a second copy of the same fact could drift
 * from it, and this way the table below is the test.
 */
describe('invoice generation dates (owner spec)', () => {
  const genDate = (term: any, asOf: string, since: string) =>
    closedPeriods(term, asOf, since).map(p => `${p.start}..${p.end} → generate ${p.endExclusive}`);

  it('weekly: Monday to Monday, generated the moment the week closes', () => {
    // 3 Aug 2026 is a Monday.
    expect(genDate('weekly', '2026-08-25', '2026-08-03')).toEqual([
      '2026-08-03..2026-08-09 → generate 2026-08-10',
      '2026-08-10..2026-08-16 → generate 2026-08-17',
      '2026-08-17..2026-08-23 → generate 2026-08-24',
    ]);
  });

  it('semi-monthly first half: 1–15, generated on the 16th', () => {
    const [first] = closedPeriods('semi_monthly', '2026-08-20', '2026-08-01');
    expect(`${first.start}..${first.end}`).toBe('2026-08-01..2026-08-15');
    expect(first.endExclusive).toBe('2026-08-16');
  });

  it('semi-monthly second half: 16–end of month, generated on the 1st of next month', () => {
    const p = closedPeriods('semi_monthly', '2026-09-02', '2026-08-01');
    expect(p[1].start).toBe('2026-08-16');
    expect(p[1].end).toBe('2026-08-31');
    expect(p[1].endExclusive).toBe('2026-09-01');
  });

  it('semi-monthly second half in February, leap and non-leap, both generate on 1 March', () => {
    const leap = closedPeriods('semi_monthly', '2028-03-02', '2028-02-01');
    expect(leap[1].end).toBe('2028-02-29');
    expect(leap[1].endExclusive).toBe('2028-03-01');
    const plain = closedPeriods('semi_monthly', '2027-03-02', '2027-02-01');
    expect(plain[1].end).toBe('2027-02-28');
    expect(plain[1].endExclusive).toBe('2027-03-01');
  });

  it('monthly: 1st to last day, generated on the 1st of next month', () => {
    expect(genDate('monthly', '2026-10-02', '2026-08-01')).toEqual([
      '2026-08-01..2026-08-31 → generate 2026-09-01',
      '2026-09-01..2026-09-30 → generate 2026-10-01',
    ]);
  });

  it('a period is never generated before the instant it closes', () => {
    // On 31 Aug the August monthly period has not closed; on 1 Sep it has.
    expect(closedPeriods('monthly', '2026-08-31', '2026-08-01')).toHaveLength(0);
    expect(closedPeriods('monthly', '2026-09-01', '2026-08-01')).toHaveLength(1);
  });
});

/**
 * Finance freeze: a period must have FINISHED before it becomes money.
 * Certification says every collected call priced correctly; it says nothing
 * about whether more calls are still coming.
 */
describe('isPeriodClosed', () => {
  it('is closed only once the exclusive boundary has been reached', () => {
    expect(isPeriodClosed('2026-08-23', '2026-08-23')).toBe(false);  // last day, still open
    expect(isPeriodClosed('2026-08-23', '2026-08-24')).toBe(true);   // 00:00 GMT next day
    expect(isPeriodClosed('2026-08-23', '2026-09-01')).toBe(true);
  });

  it('a future period is never closed', () => {
    expect(isPeriodClosed('2026-12-31', '2026-08-24')).toBe(false);
  });

  it('a month period closes on the 1st of the next month', () => {
    expect(isPeriodClosed('2026-08-31', '2026-08-31')).toBe(false);
    expect(isPeriodClosed('2026-08-31', '2026-09-01')).toBe(true);
  });

  it('every period from closedPeriods is, by construction, closed', () => {
    for (const term of ['daily', 'weekly', 'semi_monthly', 'monthly'] as const) {
      for (const p of closedPeriods(term, '2026-09-15', '2026-07-01')) {
        expect(isPeriodClosed(p.end, '2026-09-15')).toBe(true);
      }
    }
  });

  it('malformed input is not closed, rather than throwing or passing', () => {
    expect(isPeriodClosed('', '2026-08-24')).toBe(false);
    expect(isPeriodClosed('not-a-date', '2026-08-24')).toBe(false);
  });
});

describe('isAccountingMonthClosed', () => {
  it('closes on the 1st of the following month', () => {
    expect(isAccountingMonthClosed('2026-08', '2026-08-31')).toBe(false);
    expect(isAccountingMonthClosed('2026-08', '2026-09-01')).toBe(true);
  });

  it('handles February in a leap year', () => {
    expect(isAccountingMonthClosed('2028-02', '2028-02-29')).toBe(false);
    expect(isAccountingMonthClosed('2028-02', '2028-03-01')).toBe(true);
  });

  it("a period can be closed while its accounting month is not", () => {
    // The 1–15 semi-monthly period closes on the 16th; August closes on 1 Sep.
    expect(isPeriodClosed('2026-08-15', '2026-08-16')).toBe(true);
    expect(isAccountingMonthClosed('2026-08', '2026-08-16')).toBe(false);
  });

  it('malformed input is not closed', () => {
    expect(isAccountingMonthClosed('', '2026-09-01')).toBe(false);
    expect(isAccountingMonthClosed('2026', '2026-09-01')).toBe(false);
  });
});

/**
 * Scheduler validation, as the owner framed it: at a given UTC instant, which
 * customers should produce a job — and nothing else. This proves the POLICY
 * mapping; whether the scheduler is wired to call it is a deployment check.
 */
describe('which cycles fire at a given instant', () => {
  const fires = (asOf: string) =>
    (['daily', 'weekly', 'semi_monthly', 'monthly'] as const).map(term => {
      const p = latestClosedPeriods(term, asOf);
      return `${term}: ${p.length ? p.map(x => `${x.start}..${x.end}`).join(' + ') : 'nothing'}`;
    });

  it('1 Sep 2026 00:00 GMT — month end, every cycle closes something', () => {
    // 31 Aug 2026 is a Monday, so the weekly period straddles into September
    // and only its August fragment has closed.
    expect(fires('2026-09-01')).toEqual([
      'daily: 2026-08-31..2026-08-31',
      'weekly: 2026-08-31..2026-08-31',
      'semi_monthly: 2026-08-16..2026-08-31',
      'monthly: 2026-08-01..2026-08-31',
    ]);
  });

  it('16 Aug 2026 — the semi-monthly first half closes, monthly does not', () => {
    const f = fires('2026-08-16');
    expect(f[2]).toBe('semi_monthly: 2026-08-01..2026-08-15');
    expect(f[3]).toBe('monthly: 2026-07-01..2026-07-31');   // July, not August
  });

  it('a mid-week, mid-month instant closes nothing new for month-based cycles', () => {
    // 19 Aug 2026 is a Wednesday. The week 17–23 is open; the current
    // half-month is open; August is open.
    const f = fires('2026-08-19');
    expect(f[1]).toBe('weekly: 2026-08-10..2026-08-16');      // the PREVIOUS week
    expect(f[2]).toBe('semi_monthly: 2026-08-01..2026-08-15');
    expect(f[3]).toBe('monthly: 2026-07-01..2026-07-31');
  });

  it('no cycle ever fires a period that includes the current day', () => {
    for (const asOf of ['2026-08-19', '2026-09-01', '2026-08-16', '2028-02-29']) {
      for (const term of ['daily', 'weekly', 'semi_monthly', 'monthly'] as const) {
        for (const p of latestClosedPeriods(term, asOf)) {
          expect(p.end < asOf).toBe(true);
        }
      }
    }
  });
});
