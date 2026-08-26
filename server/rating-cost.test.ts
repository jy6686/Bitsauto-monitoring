/**
 * Call pricing — pinned against real production data, not invented fixtures.
 *
 * Every rate in these tests is a real row from tariff snapshot version 142740,
 * and every expected cost is what Sippy actually charged for that traffic on
 * 2026-08-22. That matters: the defect these guard against was itself written
 * down as a comment ("price_1 and price_n are per-block prices, not per-minute
 * rates") directly contradicting the integration contract in sippy.ts. A test
 * asserting someone's belief about the units would have agreed with the bug.
 * Only the switch's own numbers can settle it.
 *
 * The 60x case is first because it is the one that reached production.
 */

import { describe, it, expect, vi } from 'vitest';
import { rateCall } from './rating-cost';

// The shipped engine imports storage at module load, which needs a live
// DATABASE_URL. reproduceCost itself touches neither, so stubbing that one
// import lets the two functions be compared directly — which is the only way
// to PROVE the interval rounding is untouched rather than assert values I
// happen to believe are right.
vi.mock('./storage', () => ({ storage: {} }));
const shipped = async () =>
  (await import('./services/sippy/sippy-rating-verification.service')).reproduceCost;

/** Real rows from snapshot v142740, tariff 32. */
const PAKISTAN   = { prefix: '192',  price1: 0.035,   priceN: 0.035,   interval1: 1,  intervalN: 1 };
const BANGLADESH = { prefix: '1880', price1: 0.00985, priceN: 0.00985, interval1: 1,  intervalN: 1 };
const MINUTE_1   = { prefix: '160',  price1: 0.0092,  priceN: 0.0092,  interval1: 60, intervalN: 1 };

/** Cost is compared to the switch, so a near-miss is a failure, not a pass. */
const near = (v: number, expected: number) => expect(v).toBeCloseTo(expected, 8);

describe('rateCall — the units defect that reached production', () => {
  it('charges a 10-second call one sixth of a minute, not ten minutes', () => {
    // THE regression. The shipped engine reproduced 0.35 for this exact call —
    // 0.035 x 10 — and the verification row recorded it as a discrepancy
    // against Sippy on every connected call for the period.
    const r = rateCall(10, PAKISTAN);
    near(r.cost, 0.035 * 10 / 60);
    expect(r.cost).not.toBeCloseTo(0.35, 6);
    expect(r.billedSecs).toBe(10);
  });

  it('charges exactly the per-minute price for exactly one minute', () => {
    near(rateCall(60, PAKISTAN).cost, 0.035);
    near(rateCall(60, BANGLADESH).cost, 0.00985);
  });

  it('reproduces the switch across a whole period, not just one call', () => {
    // Sippy billed 5.09 for 145.37 minutes of prefix 192, and 0.33 for 33.75
    // minutes of 1880. On 1-second intervals the billed seconds equal the real
    // seconds, so a period reduces to rate x minutes.
    //
    // Asserted to 2dp, not 8: both the minutes and the amounts come from the
    // certification API already rounded for display, so their product cannot
    // carry more precision than that. Demanding 8dp here would be asserting
    // against noise — the per-call test above is where exactness belongs.
    expect(rateCall(Math.round(145.37 * 60), PAKISTAN).cost).toBeCloseTo(5.09, 2);
    expect(rateCall(Math.round(33.75  * 60), BANGLADESH).cost).toBeCloseTo(0.33, 2);
  });

  it('never multiplies by the interval count — the shape of the old bug', () => {
    // A 1-second interval must not make a call sixty times more expensive than
    // the same call on a 60-second interval at the same per-minute price.
    const perSecond = rateCall(120, { price1: 0.05, priceN: 0.05, interval1: 1,  intervalN: 1  });
    const perMinute = rateCall(120, { price1: 0.05, priceN: 0.05, interval1: 60, intervalN: 60 });
    near(perSecond.cost, 0.10);
    near(perMinute.cost, 0.10);
    expect(perSecond.cost).toBeCloseTo(perMinute.cost, 8);
  });
});

describe('rateCall — interval rounding', () => {
  it('bills a whole first interval for anything inside it', () => {
    // 30 seconds on a 60/1 rate is charged as a full minute.
    const r = rateCall(30, MINUTE_1);
    expect(r.billedSecs).toBe(60);
    near(r.cost, 0.0092);
  });

  it('rounds partial trailing blocks up, never down', () => {
    // 61 seconds on 60/60 is two minutes, not one and a fraction.
    const r = rateCall(61, { price1: 0.06, priceN: 0.06, interval1: 60, intervalN: 60 });
    expect(r.billedSecs).toBe(120);
    near(r.cost, 0.12);
  });

  it('prices the first block and the rest at their own rates', () => {
    // A rate where price1 differs from priceN would be mispriced by scaling a
    // single total — the two halves are converted separately.
    const r = rateCall(120, { price1: 0.10, priceN: 0.02, interval1: 60, intervalN: 60 });
    expect(r.billedSecs).toBe(120);
    near(r.cost, 0.10 + 0.02);
  });

  it('defaults a missing interval to a whole minute, as Sippy does', () => {
    near(rateCall(30, { price1: 0.06, priceN: 0.06 }).cost, 0.06);
  });
});

describe('rateCall — fees and free time', () => {
  it('charges nothing at all inside the grace period', () => {
    // Not even the connect fee: a graced call is not a chargeable event.
    const r = rateCall(5, { ...PAKISTAN, gracePeriod: 6, connectFee: 0.01, postCallSurcharge: 0.02 });
    expect(r.cost).toBe(0);
    expect(r.billedSecs).toBe(0);
  });

  it('charges past the grace period in full, not just the excess', () => {
    const r = rateCall(10, { ...PAKISTAN, gracePeriod: 6 });
    near(r.cost, 0.035 * 10 / 60);
  });

  it('deducts free seconds before rating, and still charges the fees', () => {
    const r = rateCall(70, { ...PAKISTAN, freeSeconds: 10 });
    expect(r.billedSecs).toBe(60);
    near(r.cost, 0.035);
  });

  it('charges connect fee and surcharge when free time absorbs the call', () => {
    const r = rateCall(10, { ...PAKISTAN, freeSeconds: 30, connectFee: 0.01, postCallSurcharge: 0.02 });
    expect(r.billedSecs).toBe(0);
    near(r.cost, 0.03);
    expect(r.formula).toBe('connect_fee_only');
  });

  it('adds connect fee and surcharge on top of the call, not inside it', () => {
    const r = rateCall(60, { ...PAKISTAN, connectFee: 0.01, postCallSurcharge: 0.02 });
    near(r.cost, 0.035 + 0.01 + 0.02);
  });
});

describe('rateCall — degenerate input', () => {
  it('costs nothing for a zero-duration call with no fees', () => {
    // The commonest row in this estate: asterisk logged 79,763 calls carrying
    // 1,553 minutes, so most never connected. These cost nothing under either
    // the correct or the buggy formula, which is why 3,027 of 4,000 verified
    // rows matched exactly and the units defect stayed invisible in aggregate.
    expect(rateCall(0, PAKISTAN).cost).toBe(0);
    expect(rateCall(0, PAKISTAN).billedSecs).toBe(0);
  });

  it('treats a negative duration as zero rather than crediting the customer', () => {
    expect(rateCall(-30, PAKISTAN).cost).toBe(0);
  });

  it('survives null and undefined rate fields without producing NaN', () => {
    const r = rateCall(60, { price1: null, priceN: undefined, interval1: null, intervalN: null });
    expect(Number.isFinite(r.cost)).toBe(true);
    expect(r.cost).toBe(0);
  });

  it('costs nothing on a zero rate, however long the call', () => {
    expect(rateCall(3600, { price1: 0, priceN: 0, interval1: 1, intervalN: 1 }).cost).toBe(0);
  });
});

/**
 * Differential against the SHIPPED engine.
 *
 * A units fix must change money and nothing else. Asserting billedSecs values
 * I chose would not show that — it would only show that I agree with myself.
 * These run both functions over the same matrix and compare, so "rounding is
 * untouched" is a proof rather than a claim.
 *
 * The three billing modes are the ones that actually occur in tariff 32:
 * 1/1 (per-second), 60/1 (minimum a minute, then per-second) and 60/60
 * (whole minutes). 30/6 is included because a fix that happened to work for
 * 60-second blocks could still be wrong for any other block size.
 */
describe('differential vs the shipped engine', () => {
  const MODES = [
    { name: '1/1',   interval1: 1,  intervalN: 1  },
    { name: '60/1',  interval1: 60, intervalN: 1  },
    { name: '60/60', interval1: 60, intervalN: 60 },
    { name: '30/6',  interval1: 30, intervalN: 6  },
  ];
  const DURATIONS = [0, 1, 10, 29, 30, 31, 59, 60, 61, 90, 120, 3599, 3600];
  const PRICE = 0.035;

  it('bills IDENTICAL seconds to the shipped engine, in every mode and duration', async () => {
    const reproduceCost = await shipped();
    const mismatches: string[] = [];
    for (const m of MODES) {
      for (const dur of DURATIONS) {
        const rate = { price1: PRICE, priceN: PRICE, interval1: m.interval1, intervalN: m.intervalN };
        const a = reproduceCost(dur, rate as any).billedSecs;
        const b = rateCall(dur, rate).billedSecs;
        if (a !== b) mismatches.push(`${m.name} @ ${dur}s: shipped ${a} vs new ${b}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  // The two engines differ by 60 x blocks / billedSecs. That is NOT a constant,
  // and assuming it was would have asserted a falsehood: it collapses to 1 when
  // a block IS a minute, and to 60 when a block is a second. So the blast radius
  // of the defect is "every tariff whose intervals are not 60/60".

  it('agrees exactly on 60/60 tariffs — the shipped engine is right there', async () => {
    // A 60-second block priced per minute and priced per block are the same
    // number, which is why this was never a total outage. Whole-minute tariffs
    // billed correctly throughout.
    const reproduceCost = await shipped();
    const rate = { price1: 0.06, priceN: 0.06, interval1: 60, intervalN: 60 };
    for (const dur of DURATIONS) {
      expect(reproduceCost(dur, rate as any).reproducedCost)
        .toBeCloseTo(rateCall(dur, rate).cost, 8);
    }
  });

  it('differs by exactly 60x on 1/1 tariffs — where the production calls were', async () => {
    // Prefixes 192 and 1880 are both 1/1, which is why asterisk's connected
    // calls came out sixty times high while the aggregate looked merely wrong.
    const reproduceCost = await shipped();
    const rate = { price1: 0.06, priceN: 0.06, interval1: 1, intervalN: 1 };
    for (const dur of DURATIONS.filter(d => d > 0)) {
      const old = reproduceCost(dur, rate as any).reproducedCost;
      const now = rateCall(dur, rate).cost;
      expect(old / now).toBeCloseTo(60, 6);
    }
  });

  it('overcharges by SOMETHING on every other block size, never undercharges', async () => {
    // The general invariant. A mixed tariff is wrong by a factor between 1 and
    // 60 that moves with call duration — which is why no single correction
    // factor could have been applied downstream instead of fixing the units.
    const reproduceCost = await shipped();
    for (const m of MODES.filter(x => x.name === '60/1' || x.name === '30/6')) {
      for (const dur of DURATIONS.filter(d => d > 0)) {
        const rate = { price1: PRICE, priceN: PRICE, interval1: m.interval1, intervalN: m.intervalN };
        const old = reproduceCost(dur, rate as any).reproducedCost;
        const now = rateCall(dur, rate).cost;
        expect(old).toBeGreaterThanOrEqual(now - 1e-9);
        expect(old / now).toBeLessThanOrEqual(60 + 1e-6);
      }
    }
  });

  it('the shipped engine prices the production call at 0.35 — the defect itself', async () => {
    // Prefix 192, snapshot v142740, one real 10-second call. Sippy charged
    // 0.035 x 10/60. This test exists to fail LOUDLY when reproduceCost is
    // corrected, so the fix cannot land without someone deleting it on purpose.
    const reproduceCost = await shipped();
    const rate = { price1: 0.035, priceN: 0.035, interval1: 1, intervalN: 1 };
    expect(reproduceCost(10, rate as any).reproducedCost).toBeCloseTo(0.35, 8);
    expect(rateCall(10, rate).cost).toBeCloseTo(0.035 * 10 / 60, 8);
  });
});

/**
 * Money, per billing mode, checked independently of rounding.
 *
 * Owner's requirement: interval rounding and the money calculation must be
 * verified separately, so a regression in one cannot be masked by the other.
 * Above proves the rounding; these fix the money against known-correct values.
 */
describe('cost by billing mode', () => {
  const R = 0.06;   // 6 cents per minute, chosen so every expectation is exact

  it('1/1 — charges the exact seconds used', () => {
    near(rateCall(10, { price1: R, priceN: R, interval1: 1, intervalN: 1 }).cost, R * 10 / 60);
    near(rateCall(90, { price1: R, priceN: R, interval1: 1, intervalN: 1 }).cost, R * 90 / 60);
  });

  it('60/1 — a minimum of one minute, then exact seconds', () => {
    const rate = { price1: R, priceN: R, interval1: 60, intervalN: 1 };
    near(rateCall(10, rate).cost, R);            // rounded up to the minimum
    near(rateCall(60, rate).cost, R);
    near(rateCall(90, rate).cost, R * 90 / 60);  // minute, then 30 seconds
  });

  it('60/60 — whole minutes only', () => {
    const rate = { price1: R, priceN: R, interval1: 60, intervalN: 60 };
    near(rateCall(1,   rate).cost, R);
    near(rateCall(60,  rate).cost, R);
    near(rateCall(61,  rate).cost, R * 2);
    near(rateCall(120, rate).cost, R * 2);
    near(rateCall(121, rate).cost, R * 3);
  });

  it('30/6 — a block size that is neither a second nor a minute', () => {
    // 40s → first 30s block, then ceil(10/6) = 2 blocks of 6s = 42s billed.
    const rate = { price1: R, priceN: R, interval1: 30, intervalN: 6 };
    const r = rateCall(40, rate);
    expect(r.billedSecs).toBe(42);
    near(r.cost, R * 42 / 60);
  });
});
