import { describe, it, expect } from 'vitest';
import {
  billedSeconds, subsequentIntervals, chargeFor, perIntervalOvercharge,
  describeIncrement, type IncrementPrice,
} from './billing-increments';
import { reproduceCost } from './services/sippy/sippy-rating-verification.service';

/**
 * THE FINANCIAL REGRESSION SUITE.
 *
 * Two halves, and the split is the point.
 *
 *   1. THE CONTRACT — every case in the owner's specification of 2026-09-04,
 *      transcribed verbatim, asserted against the reference implementation.
 *      These are what a call SHOULD cost. They must pass forever.
 *
 *   2. THE ENGINE — the same cases run through the production rating engine.
 *      These originally documented a DEFECT (the engine charged the per-minute
 *      price once per interval, over-billing by 60/intervalN) and were written
 *      to fail the moment it was fixed. It was fixed on 2026-09-04, they
 *      failed, and they are now the straight equality assertions against half 1
 *      that this comment promised.
 *
 * The suite was built BEFORE the engine was touched — the order the owner
 * asked for, and the right one for the part of the platform with a customer at
 * the end of it. Half 1 never changed while the fix landed, which is what makes
 * half 2 passing mean anything.
 */

const RATE = 0.035;                       // $/minute, the worked example throughout
const at = (i1: number, iN: number): IncrementPrice =>
  ({ interval1: i1, intervalN: iN, price1: RATE, priceN: RATE });

/** duration → billed seconds → charge, from the owner's tables. */
type Case = [durationSecs: number, billedSecs: number, charge: number];

const SPEC: Array<{ inc: [number, number]; cases: Case[] }> = [
  // 1/1 — per second. Every second billed individually.
  { inc: [1, 1], cases: [
    [1,   1,  0.000583], [10, 10, 0.005833], [30, 30, 0.017500],
    [59, 59,  0.034417], [60, 60, 0.035000], [61, 61, 0.035583],
    [90, 90,  0.052500],
  ]},
  // 6/6 — round up to the next multiple of 6.
  { inc: [6, 6], cases: [
    [1,  6, 0.003500], [5,  6, 0.003500], [6,  6, 0.003500],
    [7, 12, 0.007000], [12, 12, 0.007000], [13, 18, 0.010500],
  ]},
  // 30/30 — round up to the next multiple of 30.
  { inc: [30, 30], cases: [
    [1,  30, 0.017500], [15, 30, 0.017500], [30, 30, 0.017500],
    [31, 60, 0.035000], [60, 60, 0.035000], [61, 90, 0.052500],
    [75, 90, 0.052500],
  ]},
  // 60/1 — first minute mandatory, then per second.
  { inc: [60, 1], cases: [
    [1,   60, 0.035000], [30,  60, 0.035000], [60,  60, 0.035000],
    [61,  61, 0.035583], [75,  75, 0.043750], [120, 120, 0.070000],
  ]},
  // 60/60 — first minute mandatory, then whole started minutes.
  { inc: [60, 60], cases: [
    [1,   60,  0.035000], [45,  60,  0.035000], [60,  60,  0.035000],
    [61,  120, 0.070000], [119, 120, 0.070000], [120, 120, 0.070000],
    [121, 180, 0.105000],
  ]},
];

// ── 1. THE CONTRACT ─────────────────────────────────────────────────────────

describe('billing increments — the contract every change must preserve', () => {
  for (const { inc: [i1, iN], cases } of SPEC) {
    const rate = at(i1, iN);
    describe(describeIncrement(rate), () => {
      for (const [secs, billed, charge] of cases) {
        it(`${secs}s bills ${billed}s at $${charge.toFixed(6)}`, () => {
          expect(billedSeconds(secs, rate)).toBe(billed);
          expect(chargeFor(secs, rate)).toBeCloseTo(charge, 6);
        });
      }
    });
  }

  it('never bills a call that did not connect', () => {
    // A zero-duration call is not a short call. Charging it the minimum
    // interval would invent revenue — the mirror image of the defect this
    // suite exists to pin, but an error just the same.
    for (const [i1, iN] of [[1, 1], [6, 6], [60, 60], [60, 1]] as const) {
      expect(billedSeconds(0, at(i1, iN))).toBe(0);
      expect(chargeFor(0, at(i1, iN))).toBe(0);
      expect(billedSeconds(-5, at(i1, iN))).toBe(0);
    }
  });

  it('bills the minimum interval for any connected call, however short', () => {
    expect(billedSeconds(0.4, at(30, 30))).toBe(30);
    expect(billedSeconds(1, at(60, 60))).toBe(60);
  });

  it('counts tail intervals, not tail seconds', () => {
    expect(subsequentIntervals(61, at(60, 60))).toBe(1);
    expect(subsequentIntervals(120, at(60, 60))).toBe(1);
    expect(subsequentIntervals(121, at(60, 60))).toBe(2);
    expect(subsequentIntervals(60, at(60, 60))).toBe(0);
    expect(subsequentIntervals(75, at(60, 1))).toBe(15);
  });

  it('charges price1 and priceN independently when they differ', () => {
    // Sippy tariffs may price the first minute above the rest. 60/60 at
    // $0.10 then $0.02: a 121s call is one first minute plus two tail minutes.
    const split: IncrementPrice = { interval1: 60, intervalN: 60, price1: 0.10, priceN: 0.02 };
    expect(chargeFor(60, split)).toBeCloseTo(0.10, 6);
    expect(chargeFor(61, split)).toBeCloseTo(0.12, 6);
    expect(chargeFor(121, split)).toBeCloseTo(0.14, 6);
  });

  it('states the over-charge factor a per-interval engine produces', () => {
    // 60/intervalN — which is exactly the pattern measured on the engine.
    expect(perIntervalOvercharge(at(1, 1))).toBe(60);
    expect(perIntervalOvercharge(at(6, 6))).toBe(10);
    expect(perIntervalOvercharge(at(30, 30))).toBe(2);
    expect(perIntervalOvercharge(at(60, 60))).toBe(1);
  });
});

// ── 2. THE ENGINE ───────────────────────────────────────────────────────────

/**
 * FIXED 2026-09-04. This block used to assert the defect — that the engine
 * over-charged by 60/intervalN — and was written to fail the day someone
 * corrected it. It did. These are now straight equality assertions against
 * half 1, which is what the comment above promised they would become.
 *
 * `reproduceCost` no longer contains any arithmetic: it delegates to
 * `rateCall`, which delegates to `chargeFor`. So every case in THE CONTRACT
 * above is now also a test of the production engine, and the two cannot drift
 * apart without one of them being edited on purpose.
 */
describe('the production engine matches the contract on every specified case', () => {
  const engine = (secs: number, r: IncrementPrice) =>
    Number(reproduceCost(secs, { prefix: '192', ...r } as any).reproducedCost);

  for (const { inc: [i1, iN], cases } of SPEC) {
    const rate = at(i1, iN);
    it(`reproduces ${describeIncrement(rate)} exactly`, () => {
      for (const [secs, billed, charge] of cases) {
        expect(engine(secs, rate)).toBeCloseTo(charge, 6);
        expect(reproduceCost(secs, { prefix: '192', ...rate } as any).billedSecs).toBe(billed);
      }
    });
  }

  it('no longer over-charges any increment — the factor is 1 everywhere', () => {
    // The inverse of the assertion this block used to make. 1/1 was 60x,
    // 6/6 was 10x, 30/30 was 2x; 60/60 was always right and still is.
    //
    // Precision 5, not 6, and deliberately: the engine rounds money to 8dp to
    // match the precision the verification record stores, which on a $0.0058
    // figure is a relative difference around 1e-6. That is the rounding, not a
    // units error — and 5dp still separates 1 from 60, 10 or 2 by a mile.
    for (const [i1, iN] of [[1, 1], [6, 6], [30, 30], [60, 60], [60, 1]] as const) {
      const rate = at(i1, iN);
      for (const secs of [10, 30, 61, 90]) {
        expect(engine(secs, rate) / chargeFor(secs, rate)).toBeCloseTo(1, 5);
      }
    }
  });

  it('bills the worked example at half a cent, not thirty-five', () => {
    // A 10-second call at 3.5c/min on per-second billing. This single line is
    // the whole defect: it used to return 0.35.
    expect(engine(10, at(1, 1))).toBeCloseTo(0.005833, 6);
  });

  it('agrees with what the switch actually charged on the production case', () => {
    // Tariff 32, prefix 192, price1 0.035/min, intervals 1/1. Sippy billed
    // $5.09 for 145.37 minutes. Before the fix the engine reproduced $305.27.
    const rate = at(1, 1);
    const totalSecs = Math.round(145.37 * 60);          // 8722
    expect(engine(totalSecs, rate)).toBeCloseTo(5.09, 2);

    // Split across many calls of WHOLE seconds and the total is unchanged:
    // under 1/1 there is no rounding left to accumulate.
    const whole = [...Array(78).fill(87), ...Array(22).fill(88)];
    expect(whole.reduce((a, b) => a + b, 0)).toBe(totalSecs);
    expect(whole.reduce((s, d) => s + engine(d, rate), 0)).toBeCloseTo(5.09, 2);
  });

  it('rounds each FRACTIONAL call up to a whole second, and that accumulates', () => {
    // Sippy CDR durations are fractional. 1/1 does not mean "no rounding" —
    // it means the increment is one second, so an 87.22s call bills 88s. Over
    // many calls that is real money: 100 such calls bill 8800s where the
    // aggregate duration is 8722s, about 0.9% more.
    //
    // This is CORRECT per-call billing, not a defect — but it is the reason a
    // period total computed from summed durations will never quite equal the
    // sum of per-call charges, and anyone reconciling the two needs to know
    // which of them they are looking at.
    const rate = at(1, 1);
    const fractional = Array.from({ length: 100 }, () => 87.22);
    const summed = fractional.reduce((s, d) => s + engine(d, rate), 0);

    expect(engine(87.22, rate)).toBeCloseTo(chargeFor(88, rate), 6);
    expect(summed).toBeGreaterThan(5.09);
    expect(summed).toBeCloseTo(8800 / 60 * 0.035, 4);
    // Bounded: at most one extra second per call, never more.
    expect(summed).toBeLessThanOrEqual((8722 + 100) / 60 * 0.035 + 1e-6);
  });

  it('preserves the fee envelope it always had', () => {
    // Only the price-to-money conversion changed. Grace, free seconds, connect
    // fee and surcharge behave exactly as before — asserted here so a future
    // reader can see the fix was scoped to the units and nothing else.
    const base = { prefix: '192', ...at(1, 1) } as any;
    expect(reproduceCost(3, { ...base, gracePeriod: 5 }).reproducedCost).toBe(0);
    expect(reproduceCost(3, { ...base, gracePeriod: 5 }).formula).toBe('grace(5s)');
    expect(reproduceCost(5, { ...base, freeSeconds: 10, connectFee: 0.01 }).reproducedCost)
      .toBeCloseTo(0.01, 8);
    expect(reproduceCost(5, { ...base, freeSeconds: 10 }).formula).toBe('connect_fee_only');
    // Connect fee and surcharge sit outside the per-minute maths, additively.
    expect(reproduceCost(60, { ...base, connectFee: 0.02, postCallSurcharge: 0.03 }).reproducedCost)
      .toBeCloseTo(0.035 + 0.05, 6);
  });

  it('states its own arithmetic in the formula string', () => {
    // The old formula read `0+0.035[≤1s]+0` — a faithful description of the
    // wrong maths that reads as plausible either way. The division is now on
    // the face of it, so the units can be checked without running anything.
    expect(reproduceCost(10, { prefix: '192', ...at(1, 1) } as any).formula)
      .toBe('1s/60*0.035 + 9s/60*0.035 [10s billed]');
  });
});
