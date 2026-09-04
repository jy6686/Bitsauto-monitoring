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
 *      These currently document a DEFECT: the engine charges the per-minute
 *      price once per interval, over-billing by 60/intervalN. They are written
 *      to pass while the defect stands and to FAIL the moment it is fixed, at
 *      which point they become straight equality assertions against half 1.
 *
 * Nothing here changes rating behaviour. The suite exists so that when someone
 * does, the safety net is already in place — which is the order the owner
 * asked for, and the right one for the part of the platform with a customer at
 * the end of it.
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

describe('DEFECT: the production engine charges per interval, not per minute', () => {
  const engine = (secs: number, r: IncrementPrice) =>
    Number(reproduceCost(secs, { prefix: '192', ...r } as any).reproducedCost);

  it('agrees with the contract ONLY on 60/60, where an interval is a minute', () => {
    const rate = at(60, 60);
    for (const [secs] of SPEC[4].cases) {
      expect(engine(secs, rate)).toBeCloseTo(chargeFor(secs, rate), 6);
    }
  });

  it('over-charges every finer increment by exactly 60/intervalN', () => {
    // The measured pattern, and the reason 60/60 masked it for so long.
    for (const [i1, iN, factor] of [[1, 1, 60], [6, 6, 10], [30, 30, 2]] as const) {
      const rate = at(i1, iN);
      for (const secs of [10, 30, 61, 90]) {
        const correct = chargeFor(secs, rate);
        // WRONG. The correct assertion is toBeCloseTo(correct, 6).
        expect(engine(secs, rate) / correct).toBeCloseTo(factor, 4);
      }
    }
  });

  it('names the money on the worked example', () => {
    // A 10-second call at 3.5c/min on per-second billing.
    const rate = at(1, 1);
    expect(chargeFor(10, rate)).toBeCloseTo(0.005833, 6);   // should cost this
    expect(engine(10, rate)).toBeCloseTo(0.350000, 6);      // charges this
  });

  it('is ALSO wrong on 60/1 after the first minute', () => {
    // 60/1 is the case worth stating separately: the first minute is right
    // because interval1 is 60, and every second after it is billed at a full
    // minute's price. A 75-second call should cost $0.043750.
    const rate = at(60, 1);
    expect(chargeFor(75, rate)).toBeCloseTo(0.043750, 6);
    const actual = engine(75, rate);
    expect(actual).toBeGreaterThan(chargeFor(75, rate));
    // 60s at the minute price, then 15 seconds each charged a full minute.
    expect(actual).toBeCloseTo(0.035 + 15 * 0.035, 6);
  });
});
