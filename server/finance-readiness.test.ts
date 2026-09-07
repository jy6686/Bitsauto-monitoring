import { describe, it, expect } from 'vitest';
import { assessCustomer, summariseReadiness, type CustomerFacts } from './finance-readiness';

const DAYS = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06'];

const facts = (over: Partial<CustomerFacts> = {}): CustomerFacts => ({
  companyId: 17, name: 'PUSHTOTALK', iAccount: 1, iTariff: 2, invoiceEmail: 'ap@example.com',
  hasSchedule: true,
  coverage: { days: DAYS, uncovered: [], emptyButCollected: [] },
  repository: { calls: 1984, minutes: 1176.08, cost: 32.34229 },
  verified: 1984, snapshotted: 1984,
  certification: { state: 'certified', reasons: [] },
  reconciliation: { status: 'certified', referenceAmount: 32.3423, platformAmount: 32.34229, amountDelta: -0.00001 },
  invoice: null,
  ...over,
});

describe('the four production customers, as they stood on 2026-09-07', () => {
  it('PUSHTOTALK: data perfect, blocked by configuration only → configure', () => {
    // Reconciles to the cent, no tariff, no schedule, no email.
    const r = assessCustomer(facts({ iTariff: null, invoiceEmail: null, hasSchedule: false,
                                     verified: 0, snapshotted: 0, certification: null }));
    expect(r.columns).toMatchObject({ collection: 'ok', repository: 'ok', reconciliation: 'ok', rating: 'fail', snapshots: 'fail' });
    expect(r.blockers.map(b => b.code)).toEqual(['no-tariff', 'no-email', 'no-schedule', 'not-generated']);
    expect(r.action).toBe('configure');
    expect(r.ready).toBe(false);
  });

  it('asterisk: collected, tariff set, zero snapshots → rate from the repository', () => {
    // 2,941 stored, 635 verified, 0 snapshotted. Coverage: 09-01 and 09-02 only.
    const r = assessCustomer(facts({
      companyId: 15, name: 'asterisk', iAccount: 315, iTariff: 32, hasSchedule: false,
      coverage: { days: DAYS, uncovered: DAYS.slice(2), emptyButCollected: [] },
      repository: { calls: 2941, minutes: 559.8, cost: 13.294261 },
      verified: 635, snapshotted: 0,
      certification: { state: 'exceptions', reasons: ['2077 call(s) priced differently from the switch'] },
      reconciliation: { status: 'amount_differs', referenceAmount: 104.048, platformAmount: 13.294261, amountDelta: -90.753739 },
    }));
    expect(r.columns).toMatchObject({ collection: 'warn', repository: 'warn', rating: 'warn', snapshots: 'fail', reconciliation: 'warn' });
    // Config first (no schedule — advisory), then the missing days, then rating.
    expect(r.blockers.map(b => b.code)).toEqual(['no-schedule', 'days-uncollected', 'rating-pending', 'snapshot-pending', 'amount-differs', 'not-generated']);
    // The ACTION is the first thing that blocks, and a missing schedule does not.
    expect(r.action).toBe('collect');
    expect(r.blockers[1].detail).toContain('2026-09-03');
  });

  it('asterisk after the repository recovery: certified, no email, no schedule → READY, generate', () => {
    // Production 2026-09-07 11:31, run 17: 2941 verified, 0 discrepancies.
    // The owner's rule: a missing email sends a review copy to the fallback;
    // it does not hold a certified period back.
    const r = assessCustomer(facts({
      companyId: 15, name: 'asterisk', iAccount: 315, iTariff: 32, invoiceEmail: null, hasSchedule: false,
      coverage: { days: ['2026-09-02'], uncovered: [], emptyButCollected: [] },
      repository: { calls: 2941, minutes: 559.8, cost: 13.294261 },
      verified: 2941, snapshotted: 2941,
      certification: { state: 'certified', reasons: [] },
      reconciliation: { status: 'certified', referenceAmount: 13.2943, platformAmount: 13.294261, amountDelta: -0.00004 },
    }));
    expect(r.blockers.map(b => [b.code, b.severity])).toEqual([
      ['no-email', 'advisory'], ['no-schedule', 'advisory'], ['not-generated', 'blocks'],
    ]);
    expect(r.ready).toBe(true);
    expect(r.action).toBe('generate');
    expect(r.blockers[0].detail).toContain('REVIEW COPY');
  });

  it('internal-ptcl: never reached by the collector → collect', () => {
    const r = assessCustomer(facts({
      companyId: 18, name: 'internal-ptcl', iAccount: 588, iTariff: 33, invoiceEmail: null,
      coverage: { days: DAYS, uncovered: DAYS, emptyButCollected: [] },
      repository: { calls: 0, minutes: 0, cost: 0 }, verified: 0, snapshotted: 0,
      certification: { state: 'uncertified', reasons: ['No call has been verified'] },
      reconciliation: { status: 'missing_from_platform', referenceAmount: 66.0613, platformAmount: 0, amountDelta: -66.0613 },
    }));
    expect(r.columns.collection).toBe('fail');
    expect(r.columns.repository).toBe('fail');
    expect(r.blockers.map(b => b.code)).toEqual(['no-email', 'days-uncollected', 'missing-from-platform', 'not-generated']);
    // The email is listed first (config), but it is advisory: the first thing
    // that BLOCKS is collection, and that is the action.
    expect(r.blockers[0].severity).toBe('advisory');
    expect(r.action).toBe('collect');
  });

  it('noman: collected, no traffic, not in the switch reference → nothing to bill, no false alarms', () => {
    const r = assessCustomer(facts({
      companyId: 7, name: 'noman', iAccount: 96, iTariff: 2, invoiceEmail: null,
      coverage: { days: DAYS, uncovered: [], emptyButCollected: DAYS },
      repository: { calls: 0, minutes: 0, cost: 0 }, verified: 0, snapshotted: 0,
      certification: { state: 'uncertified', reasons: [] }, reconciliation: null,
    }));
    expect(r.columns).toMatchObject({ collection: 'ok', repository: 'none', rating: 'none', snapshots: 'none', reconciliation: 'none' });
    expect(r.blockers.map(b => b.code)).toEqual(['no-email', 'not-generated']);
    expect(r.ready).toBe(false);   // nothing to invoice is not "ready"
  });
});

describe('the marks say what is true, not what is red', () => {
  it('a fully ready customer has only generation left', () => {
    const r = assessCustomer(facts());
    expect(r.blockers.map(b => b.code)).toEqual(['not-generated']);
    expect(r.action).toBe('generate');
    expect(r.ready).toBe(true);
  });

  it('is done once the draft exists', () => {
    const r = assessCustomer(facts({ invoice: { invoiceNumber: 'C-2609-0012', status: 'draft' } }));
    expect(r.blockers).toEqual([]);
    expect(r.action).toBe('done');
    expect(r.columns.invoice).toBe('ok');
  });

  it('rates partial verification as warn and none as fail', () => {
    expect(assessCustomer(facts({ verified: 10, snapshotted: 0 })).columns.rating).toBe('warn');
    expect(assessCustomer(facts({ verified: 0, snapshotted: 0 })).columns.rating).toBe('fail');
  });

  it('does not report certification until rating is complete — it would be about the wrong calls', () => {
    const r = assessCustomer(facts({ verified: 5, snapshotted: 5, certification: { state: 'exceptions', reasons: ['x'] } }));
    expect(r.blockers.map(b => b.code)).not.toContain('exceptions');
    expect(r.blockers.map(b => b.code)).toContain('rating-pending');
  });

  it('reports certification exceptions once rating is complete', () => {
    const r = assessCustomer(facts({ certification: { state: 'exceptions', reasons: ['2077 priced differently'] } }));
    expect(r.blockers.map(b => b.code)).toContain('exceptions');
    expect(r.action).toBe('review');
    expect(r.ready).toBe(false);
  });

  it('orders blockers in pipeline order whatever order they were found', () => {
    const r = assessCustomer(facts({ invoiceEmail: null, verified: 0, snapshotted: 0,
      reconciliation: { status: 'amount_differs', referenceAmount: 1, platformAmount: 0.5, amountDelta: -0.5 } }));
    const stages = r.blockers.map(b => b.stage);
    expect(stages).toEqual([...stages].sort((a, b) =>
      ['config','collection','rating','snapshot','certification','reconciliation','invoice'].indexOf(a) -
      ['config','collection','rating','snapshot','certification','reconciliation','invoice'].indexOf(b)));
  });

  it('is JSON-safe — it is served to the page', () => {
    const r = assessCustomer(facts());
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });
});

describe('the three numbers at the top of the page', () => {
  it('counts ready customers, sums their platform revenue against the switch reference, and coverage days', () => {
    const ready = assessCustomer(facts());
    const blocked = assessCustomer(facts({ companyId: 15, name: 'asterisk', iAccount: 315, iTariff: 32,
      coverage: { days: DAYS, uncovered: DAYS.slice(2), emptyButCollected: [] },
      repository: { calls: 2941, minutes: 559.8, cost: 13.29 }, verified: 0, snapshotted: 0,
      reconciliation: { status: 'amount_differs', referenceAmount: 104.05, platformAmount: 13.29, amountDelta: -90.76 } }));
    const cov = new Map([[17, { days: DAYS, uncovered: [] }], [15, { days: DAYS, uncovered: DAYS.slice(2) }]]);
    const s = summariseReadiness([ready, blocked], DAYS, cov);
    // Both are billable; asterisk only has 09-01 and 09-02, so only those two
    // days are covered for EVERYONE who bills.
    expect(s).toMatchObject({ customersReady: 1, customersTotal: 2, coverageDays: 2, periodDays: 6 });
    expect(s.revenueReady).toBeCloseTo(32.34229, 5);
    expect(s.revenueReference).toBeCloseTo(32.3423 + 104.05, 5);
    expect(s.headline).toContain('1 of 2 customer(s) ready');
  });

  it('a day is covered only when EVERY billable customer has it', () => {
    // Production 2026-09-07: a test account with a done range for the whole
    // week made the union read 6/6 while every real customer was missing
    // four days. The intersection over billable customers is the honest number.
    const a = assessCustomer(facts({ companyId: 1, name: 'a', coverage: { days: DAYS, uncovered: DAYS.slice(2), emptyButCollected: [] } }));
    const b = assessCustomer(facts({ companyId: 2, name: 'b', coverage: { days: DAYS, uncovered: DAYS.slice(0, 1), emptyButCollected: [] } }));
    const testAcct = assessCustomer(facts({ companyId: 3, name: 'test9', iTariff: null, certification: null, reconciliation: null,
      repository: { calls: 0, minutes: 0, cost: 0 }, verified: 0, snapshotted: 0,
      coverage: { days: DAYS, uncovered: [], emptyButCollected: DAYS } }));
    const cov = new Map([
      [1, { days: DAYS, uncovered: DAYS.slice(2) }],     // has 09-01, 09-02
      [2, { days: DAYS, uncovered: DAYS.slice(0, 1) }],  // has 09-02..09-06
      [3, { days: DAYS, uncovered: [] }],                // test account, no traffic, fully "collected"
    ]);
    // a ∩ b = {09-02}; the test account is not billable and must not count.
    expect(summariseReadiness([a, b, testAcct], DAYS, cov).coverageDays).toBe(1);
    // With no billable customer at all there is nothing to cover.
    expect(summariseReadiness([testAcct], DAYS, cov).coverageDays).toBe(0);
  });

  it('says plainly when nobody can be invoiced', () => {
    const s = summariseReadiness([assessCustomer(facts({ iTariff: null, verified: 0, snapshotted: 0, certification: null }))], DAYS, new Map());
    expect(s.customersReady).toBe(0);
    expect(s.headline).toMatch(/^No customer can be invoiced today/);
  });
});
