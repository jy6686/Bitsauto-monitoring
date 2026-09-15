/**
 * The rate-change validation engine.
 *
 * `docs/RATE-CHANGE-POLICY.md` is the authority. What is guarded here is as much what the engine
 * REFUSES to decide as what it decides: six things in that policy are recorded as unresolved, and
 * an engine that quietly picked an answer for any of them would be deciding real money by guess
 * while reading as certainty.
 *
 * The 1GLOBAL / Wholesale configuration below is the one actually observed on the old system.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assessRateChange, validateRateChanges, AUTO_ADJUST_ALLOWED_ON,
  type RateChange, type Thresholds, type RuleConfig,
} from "./rate-validation";

/** Configuration Values, Vendor tab, read from the old system 2026-09-10. */
const GLOBAL: Thresholds = {
  rateDecreaseAlertPct: 50,
  rateIncreaseAlertPct: 50,
  increaseNoticePeriodDays: 7,
  futureEffectiveDateDays: 14,
  oldEffectiveDateDays: 7,
  acceptablePendingIncreases: 3,
};

/** The observed 1GLOBAL / Wholesale rules. */
const ONEGLOBAL: RuleConfig = {
  clientName: '1GLOBAL', department: 'Wholesale',
  outcomes: {
    rate_increase_notice_violation: 'IGNORE',
    suspect_rate_increase: 'IGNORE',
    suspect_rate_decrease: 'REJECT_DESTINATION',
    pending_increases_exceeded: 'IGNORE',
    effective_date_greater_than_limit: 'REJECT_DESTINATION',
    effective_date_older_than_limit: 'IGNORE',
  },
};

const change = (o: Partial<RateChange> = {}): RateChange => ({
  key: 'k1', destinationId: 3, destinationName: 'AFGHANISTAN - MOBILE AWCC', country: 'AFGHANISTAN',
  newRate: 0.03, priorRate: 0.05, priorRateSource: 'product_rates',
  effectiveDate: '2026-09-14', today: '2026-09-14',
  ...o,
});

describe("THE THINGS IT REFUSES TO DECIDE", () => {
  it("EXACTLY on the threshold is UNDECIDABLE — >50% and >=50% disagree precisely there", () => {
    // 0.05 → 0.025 is −50.00%. The policy records the boundary as unresolved, and this is the one
    // input where the two readings give opposite answers for real money.
    const a = assessRateChange(change({ newRate: 0.025 }), GLOBAL, ONEGLOBAL);
    const f = a.findings.find(x => x.rule === 'suspect_rate_decrease')!;
    expect(f.undecidable).toBe(true);
    expect(f.undecidedBecause).toMatch(/greater than 50%.*or.*50% or more/i);

    // And it must NOT come out as proceeding.
    const v = validateRateChanges([change({ newRate: 0.025 })], GLOBAL, ONEGLOBAL);
    expect(v.rows[0].disposition).toBe('undecided');
    expect(v.proceeding).toEqual([]);
  });

  it("does not invent RELEASE — the word appears nowhere in the implementation", () => {
    // The owner stated release must come from the old system rather than be invented, and there
    // is evidence AGAINST equating it with the Pending status codes or REJECT DESTINATION.
    const src = readFileSync(join(__dirname, 'rate-validation.ts'), 'utf8');
    const code = src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    expect(code).not.toMatch(/\brelease[ds]?\b/i);
    expect(code).not.toMatch(/pending_(in|de)crease\b/i);
  });

  it("never chooses the comparison base — it reports the one the caller stated", () => {
    const a = assessRateChange(change({ priorRateSource: 'sippy_tariff' }), GLOBAL, ONEGLOBAL);
    expect(a.priorRateSource).toBe('sippy_tariff');
    const code = readFileSync(join(__dirname, 'rate-validation.ts'), 'utf8')
      .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    // It must not GO AND GET a rate. The source names appear as labels in the priorRateSource
    // union, which is the point — the caller declares its base — so the assertion is about
    // ACCESS, not about the words.
    for (const forbidden of ['getTariffRatesList', 'db.execute', 'db.select', 'drizzle', 'from \'./db\'', 'require(']) {
      expect(code, forbidden).not.toContain(forbidden);
    }
    // And it imports nothing at all: a pure module with no dependencies cannot acquire one.
    expect(code).not.toMatch(/^import /m);
  });

  it("a FIRST rate is undecidable, not silently unconstrained", () => {
    // Policy gap 5: whether a rate with no prior is constrained is not stated.
    const a = assessRateChange(change({ priorRate: null, priorRateSource: 'none' }), GLOBAL, ONEGLOBAL);
    expect(a.direction).toBe('first_rate');
    expect(a.changePct).toBeNull();
    // Reported under its own subject: this is not one of the six rules failing, it is the
    // precondition for asking any of them being absent.
    const f = a.findings.find(x => x.rule === 'no_comparison_base');
    expect(f, 'a first rate must produce a finding rather than silently proceeding').toBeDefined();
    expect(f!.undecidable).toBe(true);
    expect(validateRateChanges([change({ priorRate: null, priorRateSource: 'none' })], GLOBAL, ONEGLOBAL)
      .rows[0].disposition).toBe('undecided');
  });

  it("a ZERO prior rate is undecidable rather than an infinite percentage", () => {
    // (x - 0) / 0 is Infinity, which compares as beyond every threshold — refusing on arithmetic
    // rather than on policy.
    const a = assessRateChange(change({ priorRate: 0 }), GLOBAL, ONEGLOBAL);
    expect(a.changePct).toBeNull();
    expect(a.findings.some(f => f.rule === 'no_comparison_base' && f.undecidable)).toBe(true);
  });

  it("an UNCONFIGURED client is not the most permissive client on the platform", () => {
    // Silence is not IGNORE. A rule that fires with no configured outcome is an open question.
    const v = validateRateChanges([change({ newRate: 0.01 })], GLOBAL, null);
    expect(v.rows[0].disposition).toBe('undecided');
    expect(v.rows[0].reason).toMatch(/No validation rules are configured/i);
  });
});

describe("the observed 1GLOBAL / Wholesale configuration behaves as read", () => {
  it("a −60% decrease drops that destination and nothing else", () => {
    const v = validateRateChanges([
      change({ key: 'a', newRate: 0.02 }),                                            // −60%
      change({ key: 'b', destinationId: 891, destinationName: 'PAKISTAN - MOBILE ZONG',
               country: 'PAKISTAN', priorRate: 0.05, newRate: 0.045 }),               // −10%
    ], GLOBAL, ONEGLOBAL);

    expect(v.rows[0].disposition).toBe('dropped_destination');
    expect(v.rows[1].disposition).toBe('proceed');
    expect(v.rateSheetRejected).toBe(false);
    // The point of the per-destination radius: one bad rate does not fail the push.
    expect(v.proceeding.map(r => r.assessment.key)).toEqual(['b']);
  });

  it("a −40% decrease proceeds", () => {
    const v = validateRateChanges([change({ newRate: 0.03 })], GLOBAL, ONEGLOBAL);
    expect(v.rows[0].disposition).toBe('proceed');
  });

  it("a +60% increase proceeds, because this client configures IGNORE for it", () => {
    // Symmetric threshold, asymmetric consequence. The same magnitude that drops a destination on
    // the way down is ignored on the way up — which is why outcomes cannot be a platform constant.
    const v = validateRateChanges([change({ newRate: 0.08 })], GLOBAL, ONEGLOBAL);
    expect(v.rows[0].assessment.findings.some(f => f.rule === 'suspect_rate_increase')).toBe(true);
    expect(v.rows[0].disposition).toBe('proceed');
  });

  it("an effective date beyond 14 days drops the destination", () => {
    const v = validateRateChanges([change({ effectiveDate: '2026-10-14' })], GLOBAL, ONEGLOBAL);
    expect(v.rows[0].disposition).toBe('dropped_destination');
    expect(v.rows[0].reason).toMatch(/30 days ahead; the limit is 14/);
  });

  it("an effective date older than 7 days fires but is IGNOREd", () => {
    const v = validateRateChanges([change({ effectiveDate: '2026-09-01' })], GLOBAL, ONEGLOBAL);
    expect(v.rows[0].assessment.findings.some(f => f.rule === 'effective_date_older_than_limit')).toBe(true);
    expect(v.rows[0].disposition).toBe('proceed');
  });
});

describe("THE THREE BLAST RADII", () => {
  const withOutcome = (rule: any, outcome: any): RuleConfig =>
    ({ clientName: 'X', department: 'Wholesale', outcomes: { ...ONEGLOBAL.outcomes, [rule]: outcome } });

  const batch = () => [
    change({ key: 'af1', newRate: 0.02 }),                                              // violating
    change({ key: 'af2', destinationId: 4, destinationName: 'AFGHANISTAN - FIXED',
             country: 'AFGHANISTAN', newRate: 0.049 }),                                 // clean, same country
    change({ key: 'pk1', destinationId: 891, destinationName: 'PAKISTAN - MOBILE ZONG',
             country: 'PAKISTAN', newRate: 0.049 }),                                    // clean, elsewhere
  ];

  it("REJECT DESTINATION drops one row", () => {
    const v = validateRateChanges(batch(), GLOBAL, withOutcome('suspect_rate_decrease', 'REJECT_DESTINATION'));
    expect(v.rows.map(r => r.disposition)).toEqual(['dropped_destination', 'proceed', 'proceed']);
  });

  it("REJECT COUNTRY drops the violating row's whole country, and only that country", () => {
    const v = validateRateChanges(batch(), GLOBAL, withOutcome('suspect_rate_decrease', 'REJECT_COUNTRY'));
    expect(v.rows.map(r => r.disposition)).toEqual(['dropped_country', 'dropped_country', 'proceed']);
    expect(v.rejectedCountries).toEqual(['AFGHANISTAN']);
  });

  it("REJECT RATE-SHEET drops everything, including rows in other countries", () => {
    const v = validateRateChanges(batch(), GLOBAL, withOutcome('suspect_rate_decrease', 'REJECT_RATE_SHEET'));
    expect(v.rows.every(r => r.disposition === 'dropped_rate_sheet')).toBe(true);
    expect(v.rateSheetRejected).toBe(true);
    expect(v.proceeding).toEqual([]);
  });

  it("a country-wide rejection with NO recorded country is undecided, not narrowed", () => {
    // Narrowing it to the one destination would let the rest of the country through on a rule
    // that said to drop it — a silent widening of what is sold.
    const v = validateRateChanges(
      [change({ key: 'x', country: null, newRate: 0.02 })],
      GLOBAL, withOutcome('suspect_rate_decrease', 'REJECT_COUNTRY'));
    expect(v.rows[0].disposition).toBe('undecided');
    expect(v.rows[0].reason).toMatch(/no country is recorded/i);
  });

  it("APPROVAL REQD withholds without dropping — approval is a configurable outcome", () => {
    const v = validateRateChanges([change({ newRate: 0.02 })], GLOBAL, withOutcome('suspect_rate_decrease', 'APPROVAL_REQD'));
    expect(v.rows[0].disposition).toBe('approval_required');
    expect(v.withheld.length).toBe(1);
  });
});

describe("AUTO ADJUST EFFECTIVE DATE", () => {
  const adjuster: RuleConfig = {
    clientName: 'Y', department: 'Wholesale',
    outcomes: { ...ONEGLOBAL.outcomes, rate_increase_notice_violation: 'AUTO_ADJUST_EFFECTIVE_DATE' },
  };

  it("moves an increase out to the earliest date the notice period allows", () => {
    const a = assessRateChange(change({ newRate: 0.08, effectiveDate: '2026-09-14', today: '2026-09-14' }), GLOBAL, adjuster);
    expect(a.adjustedEffectiveDate).toEqual({ from: '2026-09-14', to: '2026-09-21', rule: 'rate_increase_notice_violation' });
    // The assessment carries the ADJUSTED date, because that is the date that will be applied.
    expect(a.effectiveDate).toBe('2026-09-21');
  });

  it("is offered on the notice rule ONLY, and is a configuration error elsewhere", () => {
    expect(AUTO_ADJUST_ALLOWED_ON).toEqual(['rate_increase_notice_violation']);
    const wrong: RuleConfig = {
      clientName: 'Z', department: 'Wholesale',
      outcomes: { ...ONEGLOBAL.outcomes, suspect_rate_decrease: 'AUTO_ADJUST_EFFECTIVE_DATE' },
    };
    const v = validateRateChanges([change({ newRate: 0.02 })], GLOBAL, wrong);
    // Not silently applied, and not silently downgraded to IGNORE either.
    expect(v.rows[0].disposition).toBe('undecided');
    expect(v.rows[0].reason).toMatch(/configuration error/i);
  });

  it("does not move a date when the notice period is already satisfied", () => {
    const a = assessRateChange(change({ newRate: 0.08, effectiveDate: '2026-09-30', today: '2026-09-14' }), GLOBAL, adjuster);
    expect(a.adjustedEffectiveDate).toBeNull();
    expect(a.effectiveDate).toBe('2026-09-30');
  });
});

describe("it reports what a decision was made from", () => {
  it("carries direction, both rates, the base, and the percentage", () => {
    const a = assessRateChange(change({ newRate: 0.02 }), GLOBAL, ONEGLOBAL);
    expect(a.direction).toBe('decrease');
    expect(a.priorRate).toBe(0.05);
    expect(a.newRate).toBe(0.02);
    expect(a.priorRateSource).toBe('product_rates');
    expect(a.changePct).toBeCloseTo(-60, 6);
    // The source is in the message too: a decision against an unstated base cannot be audited.
    expect(a.findings[0].detail).toContain('base: product_rates');
  });

  it("carries a billing-increment change alongside the rate change", () => {
    const a = assessRateChange(change({ incrementChange: { from: '1/1', to: '60/1' } }), GLOBAL, ONEGLOBAL);
    expect(a.incrementChange).toEqual({ from: '1/1', to: '60/1' });
  });

  it("EVERY refusal is pre-write, structurally — this module cannot send anything", () => {
    const v = validateRateChanges([change({ newRate: 0.02 })], GLOBAL, ONEGLOBAL);
    expect(v.refusedBeforeWrite).toBe(true);
    for (const r of v.rows) expect(r.assessment.refusedBeforeWrite).toBe(true);

    const code = readFileSync(join(__dirname, 'rate-validation.ts'), 'utf8')
      .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    for (const forbidden of ['fetch(', 'axios', 'pushRate', 'uploadRates', 'import(']) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it("is PURE — no clock of its own, so the same inputs always give the same answer", () => {
    const code = readFileSync(join(__dirname, 'rate-validation.ts'), 'utf8')
      .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    // `today` is injected. A module that read the machine clock would decide differently
    // depending on when a retry happened.
    expect(code).not.toContain('Date.now()');
    expect(code).not.toMatch(/new Date\(\)/);
  });
});

describe("EFFECTIVE DATES WITH A TIME — day-granular rules must still fire", () => {
  it("a datetime effective date reaches the notice rule exactly as the bare day does", () => {
    // Found 2026-09-15: "2026-09-15 10:00" parsed to NaN and every date rule quietly skipped —
    // permission by arithmetic. Same day as today ⇒ 0 days' notice ⇒ the rule must fire.
    const a = assessRateChange(change({ newRate: 0.08, effectiveDate: '2026-09-14 10:00', today: '2026-09-14' }), GLOBAL, ONEGLOBAL);
    expect(a.findings.map(f => f.rule)).toContain('rate_increase_notice_violation');
    const b = assessRateChange(change({ newRate: 0.08, effectiveDate: '2026-09-14T10:00:00Z', today: '2026-09-14' }), GLOBAL, ONEGLOBAL);
    expect(b.findings.map(f => f.rule)).toContain('rate_increase_notice_violation');
  });

  it("an UNPARSEABLE effective date is undecidable, never a pass", () => {
    const v = validateRateChanges([change({ newRate: 0.08, effectiveDate: '15/09/2026' })], GLOBAL, ONEGLOBAL);
    expect(v.rows[0].disposition).toBe('undecided');
    expect(v.rows[0].reason).toMatch(/not a YYYY-MM-DD date/);
    expect(v.rows[0].assessment.findings.some(f => f.rule === 'unparseable_effective_date')).toBe(true);
  });

  it("a timed date 16 days out still breaches the 15-day future limit", () => {
    const v = validateRateChanges([change({ newRate: 0.049, effectiveDate: '2026-09-30 09:00', today: '2026-09-14' })], GLOBAL, ONEGLOBAL);
    expect(v.rows[0].disposition).toBe('dropped_destination');
  });
});
