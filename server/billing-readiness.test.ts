import { describe, it, expect } from 'vitest';
import { assessBillingReadiness, type BillableCompany } from './billing-readiness';

const co = (over: Partial<BillableCompany> = {}): BillableCompany => ({
  id: 1, name: 'acme', iAccount: 315, iTariff: '32', lifecycle: 'active',
  billingCycle: 'weekly', invoiceEmail: 'billing@acme.test', hasTraffic: true,
  hasSchedule: true, scheduleNextRun: '2026-09-07T06:00:00.000Z', ...over,
});

/** Monday 2026-09-07 — the day the week 31 Aug–6 Sep is first closed. */
const MONDAY = '2026-09-07';

describe('the production case: revenue customers with nothing to invoice them', () => {
  /**
   * 2026-09-02, measured: invoice_schedules holds two rows, keyed to tariffs 2
   * and 7. asterisk is tariff 32; internal-ptcl and internal-eritrea are absent
   * entirely. So the three accounts carrying the revenue have nothing that
   * would ever start an invoice, and nothing anywhere said so.
   */
  it('names a customer with traffic that cannot be invoiced', () => {
    const r = assessBillingReadiness({
      asOf: MONDAY,
      companies: [co({ id: 18, name: 'internal-ptcl', iAccount: 588, iTariff: null, hasTraffic: true })],
    });
    expect(r.summary.blockedWithTraffic).toBe(1);
    expect(r.urgent[0].name).toBe('internal-ptcl');
    expect(r.urgent[0].blockers.join(' ')).toContain('tariff');
  });

  it('reports EVERY blocker, not just the first', () => {
    // An operator fixing 500 customers one field at a time needs the whole
    // list per customer, not a queue of one-at-a-time discoveries.
    const r = assessBillingReadiness({
      asOf: MONDAY,
      companies: [co({ iAccount: null, iTariff: null, billingCycle: null,
                       invoiceEmail: null, hasSchedule: false })],
    });
    expect(r.companies[0].blockers).toHaveLength(5);
    expect(r.companies[0].blockers[0]).toContain('No Sippy account');
  });

  it('counts blockedWithTraffic as the number that must reach zero', () => {
    const r = assessBillingReadiness({
      asOf: MONDAY,
      companies: [
        co({ id: 1, name: 'asterisk',        iAccount: 315, iTariff: '32', hasTraffic: true }),
        co({ id: 2, name: 'internal-ptcl',   iAccount: 588, iTariff: null, hasTraffic: true }),
        co({ id: 3, name: 'internal-eritrea', iAccount: 60, iTariff: null, hasTraffic: true }),
      ],
    });
    expect(r.summary.ready).toBe(1);
    expect(r.summary.blockedWithTraffic).toBe(2);
  });
});

describe('lifecycle belongs to the Rate Manager, not to Finance', () => {
  /**
   * The correction made 2026-09-02. The first version DERIVED "dormant" from
   * "no account and no traffic" — a second, Finance-local definition of a
   * customer's lifecycle, which is exactly what lets two screens disagree
   * about the same customer. companies.status is the authority.
   */
  it('reports a non-active customer as not_billable, whatever its fields', () => {
    const r = assessBillingReadiness({
      asOf: MONDAY,
      companies: [co({ name: 'Test-307', lifecycle: 'dormant', iAccount: null,
                       iTariff: null, billingCycle: null, invoiceEmail: null, hasTraffic: false })],
    });
    expect(r.companies[0].status).toBe('not_billable');
    expect(r.companies[0].lifecycle).toBe('dormant');
    expect(r.summary.blocked).toBe(0);
  });

  it('raises no blockers for an inactive customer', () => {
    // An inactive customer legitimately has no tariff. Listing that as work to
    // do would fill the queue with work nobody should perform.
    const r = assessBillingReadiness({
      asOf: MONDAY,
      companies: [co({ lifecycle: 'inactive', iTariff: null, invoiceEmail: null })],
    });
    expect(r.companies[0].blockers).toEqual([]);
    expect(r.companies[0].status).toBe('not_billable');
  });

  /**
   * The dangerous inverse: an ACTIVE customer with traffic and no account is
   * money arriving with nobody to bill. Lifecycle does not excuse it.
   */
  it('still blocks an active company with traffic and no account', () => {
    const r = assessBillingReadiness({
      asOf: MONDAY,
      companies: [co({ name: 'mystery', lifecycle: 'active', iAccount: null, hasTraffic: true })],
    });
    expect(r.companies[0].status).toBe('blocked');
    expect(r.summary.blockedWithTraffic).toBe(1);
  });

  it('counts lifecycles verbatim so both modules report the same customer alike', () => {
    const r = assessBillingReadiness({
      asOf: MONDAY,
      companies: [co({ id: 1, lifecycle: 'active' }), co({ id: 2, lifecycle: 'Inactive' }),
                  co({ id: 3, lifecycle: 'dormant' }), co({ id: 4, lifecycle: null })],
    });
    expect(r.summary.byLifecycle.active).toBe(1);
    expect(r.summary.byLifecycle.inactive).toBe(1);   // case-folded for counting
    expect(r.summary.byLifecycle.dormant).toBe(1);
    expect(r.summary.byLifecycle.unset).toBe(1);
  });

  it('treats a missing lifecycle as active rather than silently unbillable', () => {
    // Failing OPEN here is deliberate: a null status must not quietly remove a
    // customer from billing. It is reported as active and judged on its fields.
    const r = assessBillingReadiness({ asOf: MONDAY, companies: [co({ lifecycle: null })] });
    expect(r.companies[0].status).toBe('ready');
  });
});

describe('due periods come from the billing policy, not a parallel table', () => {
  it('gives a ready weekly customer the closed week on Monday', () => {
    const r = assessBillingReadiness({ asOf: MONDAY, companies: [co({ billingCycle: 'weekly' })] });
    const due = r.companies[0].duePeriods;
    expect(due.length).toBeGreaterThan(0);
    // The week 31 Aug – 6 Sep, split at the month boundary per policy.
    expect(due.some(p => p.start === '2026-09-01' && p.end === '2026-09-06')).toBe(true);
  });

  /**
   * The month-end rule, end to end: 31 Aug is a Monday, so its week straddles
   * into September and splits. The one-day August fragment is intended.
   */
  it('produces the 31 Aug fragment for a weekly customer on 1 Sep', () => {
    const r = assessBillingReadiness({ asOf: '2026-09-01', companies: [co({ billingCycle: 'weekly' })] });
    const due = r.companies[0].duePeriods;
    expect(due.some(p => p.start === '2026-08-31' && p.end === '2026-08-31')).toBe(true);
  });

  it('normalises legacy cycle names rather than treating them as unset', () => {
    const r = assessBillingReadiness({ asOf: MONDAY, companies: [co({ billingCycle: 'fortnightly' })] });
    expect(r.companies[0].term).toBe('semi_monthly');
    expect(r.companies[0].blockers).toEqual([]);
  });

  /**
   * A blocked customer must not be shown due periods — that would imply work
   * the platform is about to do and cannot.
   */
  it('offers no due periods for a blocked customer', () => {
    const r = assessBillingReadiness({
      asOf: MONDAY, companies: [co({ iTariff: null })],
    });
    expect(r.companies[0].duePeriods).toEqual([]);
    expect(r.summary.dueToday).toBe(0);
  });
});

describe('the summary an operator reads at 08:00', () => {
  it('counts by term so a missing monthly schedule is visible', () => {
    // Production has ZERO monthly schedules; if every customer is weekly, the
    // monthly close nobody configured shows up as an absent term.
    const r = assessBillingReadiness({
      asOf: MONDAY,
      companies: [co({ id: 1, billingCycle: 'weekly' }), co({ id: 2, billingCycle: 'weekly' }),
                  co({ id: 3, billingCycle: null, lifecycle: 'dormant' })],
    });
    expect(r.summary.byTerm.weekly).toBe(2);
    expect(r.summary.byTerm.unset).toBe(1);
    expect(r.summary.byTerm.monthly).toBeUndefined();
  });

  it('totals every company exactly once across the three statuses', () => {
    const r = assessBillingReadiness({
      asOf: MONDAY,
      companies: [co({ id: 1 }), co({ id: 2, iTariff: null }),
                  co({ id: 3, lifecycle: 'dormant' })],
    });
    const { total, ready, blocked, notBillable } = r.summary;
    expect(ready + blocked + notBillable).toBe(total);
  });

  it('handles an empty customer list without dividing by anything', () => {
    const r = assessBillingReadiness({ asOf: MONDAY, companies: [] });
    expect(r.summary.total).toBe(0);
    expect(r.urgent).toEqual([]);
    expect(r.dueToday).toEqual([]);
  });
});

describe('"ready" must mean WILL be invoiced, not COULD be', () => {
  /**
   * The hole this closes, and the production shape that proves it matters:
   * invoice_schedules holds TWO rows for 49 companies, and it is the only
   * thing that ever starts an invoice. Until now a customer with an account, a
   * cycle, a tariff and an email reported "ready" while being invisible to the
   * invoice engine — ready in every respect except the one that decides
   * whether an invoice appears.
   */
  it('blocks a fully configured customer that has no schedule', () => {
    const r = assessBillingReadiness({
      asOf: MONDAY, companies: [co({ name: 'asterisk', hasSchedule: false, scheduleNextRun: null })],
    });
    expect(r.companies[0].status).toBe('blocked');
    expect(r.companies[0].blockers[0]).toContain('nothing will ever trigger an invoice');
    expect(r.summary.ready).toBe(0);
  });

  it('reports ready only when the schedule exists AND has a next run', () => {
    const r = assessBillingReadiness({ asOf: MONDAY, companies: [co()] });
    expect(r.companies[0].status).toBe('ready');
    expect(r.companies[0].hasSchedule).toBe(true);
  });

  /**
   * A schedule with no next run is not a missing thing an operator can enter —
   * it is a scheduler that has not acted. Filing it under "blocked" would put
   * an item on the work list with no work to do.
   */
  it('warns, not blocks, when a schedule exists but has never computed a next run', () => {
    const r = assessBillingReadiness({
      asOf: MONDAY, companies: [co({ hasSchedule: true, scheduleNextRun: null })],
    });
    expect(r.companies[0].status).toBe('warning');
    expect(r.companies[0].blockers).toEqual([]);
    expect(r.summary.warning).toBe(1);
    expect(r.summary.blocked).toBe(0);
  });

  it('counts a missing schedule toward blockedWithTraffic', () => {
    // Unbilled revenue is unbilled revenue whether the cause is a missing
    // tariff or a missing schedule row.
    const r = assessBillingReadiness({
      asOf: MONDAY,
      companies: [co({ name: 'asterisk', hasSchedule: false, hasTraffic: true })],
    });
    expect(r.summary.blockedWithTraffic).toBe(1);
  });

  it('still totals every company exactly once across four statuses', () => {
    const r = assessBillingReadiness({
      asOf: MONDAY,
      companies: [co({ id: 1 }), co({ id: 2, iTariff: null }),
                  co({ id: 3, hasSchedule: true, scheduleNextRun: null }),
                  co({ id: 4, lifecycle: 'dormant' })],
    });
    const { total, ready, blocked, warning, notBillable } = r.summary;
    expect(ready + blocked + warning + notBillable).toBe(total);
  });
});

describe('the morning KPI — one count per fixable thing', () => {
  it('counts each blocker independently, so progress is watchable', () => {
    const r = assessBillingReadiness({
      asOf: MONDAY,
      companies: [
        co({ id: 1, invoiceEmail: null }),                       // email only
        co({ id: 2, invoiceEmail: null, iTariff: null }),        // email + tariff
        co({ id: 3, hasSchedule: false }),                       // schedule only
        co({ id: 4 }),                                           // ready
      ],
    });
    expect(r.summary.byBlocker.no_email).toBe(2);
    expect(r.summary.byBlocker.no_tariff).toBe(1);
    expect(r.summary.byBlocker.no_schedule).toBe(1);
    expect(r.summary.byBlocker.no_account).toBe(0);
    expect(r.summary.ready).toBe(1);
  });

  /**
   * A key that disappears when it reaches zero is the one an operator most
   * wants to SEE reach zero. Every category is present even when empty.
   */
  it('reports zeroes rather than omitting solved categories', () => {
    const r = assessBillingReadiness({ asOf: MONDAY, companies: [co()] });
    expect(r.summary.byBlocker).toEqual({
      no_account: 0, no_cycle: 0, no_tariff: 0, no_email: 0, no_schedule: 0,
    });
  });

  it('does not count blockers for customers that are not billable', () => {
    // An inactive customer's missing tariff is not work anyone should do, and
    // counting it would inflate a KPI that is supposed to reach zero.
    const r = assessBillingReadiness({
      asOf: MONDAY,
      companies: [co({ lifecycle: 'inactive', iTariff: null, invoiceEmail: null, hasSchedule: false })],
    });
    expect(r.summary.byBlocker.no_tariff).toBe(0);
    expect(r.summary.byBlocker.no_schedule).toBe(0);
  });

  it('keeps codes and sentences in step', () => {
    const r = assessBillingReadiness({
      asOf: MONDAY,
      companies: [co({ iAccount: null, iTariff: null, billingCycle: null,
                       invoiceEmail: null, hasSchedule: false })],
    });
    expect(r.companies[0].blockerCodes).toHaveLength(r.companies[0].blockers.length);
    expect(r.companies[0].blockerCodes).toEqual(
      ['no_account', 'no_cycle', 'no_tariff', 'no_email', 'no_schedule']);
  });
});
