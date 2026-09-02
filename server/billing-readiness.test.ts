import { describe, it, expect } from 'vitest';
import { assessBillingReadiness, type BillableCompany } from './billing-readiness';

const co = (over: Partial<BillableCompany> = {}): BillableCompany => ({
  id: 1, name: 'acme', iAccount: 315, iTariff: '32',
  billingCycle: 'weekly', invoiceEmail: 'billing@acme.test', hasTraffic: true, ...over,
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
      companies: [co({ iAccount: null, iTariff: null, billingCycle: null, invoiceEmail: null })],
    });
    expect(r.companies[0].blockers).toHaveLength(4);
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

describe('dormant is not blocked', () => {
  /**
   * Production holds 24 companies with no Sippy account — "Test-307", "Japan",
   * "75 rupees". Listing those beside a live customer missing a tariff buries
   * the one that costs money.
   */
  it('classifies a no-account, no-traffic row as dormant', () => {
    const r = assessBillingReadiness({
      asOf: MONDAY,
      companies: [co({ name: 'Test-307', iAccount: null, iTariff: null,
                       billingCycle: null, invoiceEmail: null, hasTraffic: false })],
    });
    expect(r.companies[0].status).toBe('dormant');
    expect(r.summary.blocked).toBe(0);
    expect(r.summary.blockedWithTraffic).toBe(0);
  });

  /**
   * The dangerous inverse: traffic on an account no company claims. That is
   * money arriving with nobody to bill, and it must NOT be filed as dormant.
   */
  it('does not call an unlinked company with traffic dormant', () => {
    const r = assessBillingReadiness({
      asOf: MONDAY,
      companies: [co({ name: 'mystery', iAccount: null, hasTraffic: true })],
    });
    expect(r.companies[0].status).toBe('blocked');
    expect(r.summary.blockedWithTraffic).toBe(1);
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
                  co({ id: 3, billingCycle: null, hasTraffic: false, iAccount: null })],
    });
    expect(r.summary.byTerm.weekly).toBe(2);
    expect(r.summary.byTerm.unset).toBe(1);
    expect(r.summary.byTerm.monthly).toBeUndefined();
  });

  it('totals every company exactly once across the three statuses', () => {
    const r = assessBillingReadiness({
      asOf: MONDAY,
      companies: [co({ id: 1 }), co({ id: 2, iTariff: null }),
                  co({ id: 3, iAccount: null, hasTraffic: false })],
    });
    const { total, ready, blocked, dormant } = r.summary;
    expect(ready + blocked + dormant).toBe(total);
  });

  it('handles an empty customer list without dividing by anything', () => {
    const r = assessBillingReadiness({ asOf: MONDAY, companies: [] });
    expect(r.summary.total).toBe(0);
    expect(r.urgent).toEqual([]);
    expect(r.dueToday).toEqual([]);
  });
});
