/**
 * rating-cost.ts — what a call SHOULD cost under a Sippy tariff rate.
 *
 * ⚠️ NOT WIRED IN. Nothing calls this yet. It exists so the correct semantics
 * are written down and executable before the rating engine is changed, and so
 * the units defect below can never return silently once it is.
 *
 * ── The defect this pins ─────────────────────────────────────────────────────
 * The codebase contained two contradictory declarations of the same fields:
 *
 *   server/sippy.ts:5844  (SippyTariffRate, the integration contract)
 *     price1  // price_1 — price per minute (first interval)
 *     priceN  // price_n — price per minute (subsequent intervals)
 *
 *   server/services/sippy/sippy-rating-verification.service.ts:161
 *     "price_1 and price_n are per-block prices (not per-minute rates)."
 *
 * Production settles it. For tariff 32 prefix 192 (price1 0.035, interval1 1,
 * intervalN 1) Sippy charged 5.09 over 145.37 minutes — 0.035 PER MINUTE — while
 * the verifier reproduced 305.27, exactly 60x, because it treats price1 as the
 * cost of one 1-second block. A single call shows it undivided: 10 seconds
 * reproduced as 0.35, which is 0.035 x 10.
 *
 * `priceN === price1` in every rate row is the tell. Under per-block pricing
 * that would mean each additional second costs as much as the entire first
 * minute — which no tariff means.
 *
 * ── What is and is not different here ────────────────────────────────────────
 * This mirrors reproduceCost() exactly — grace period, free seconds, connect
 * fee, surcharge, the interval-rounding branches, and billedSecs are all
 * unchanged, deliberately. ONLY the conversion from price to money differs, so
 * that a diff between the two shows the units and nothing else. A fix that
 * quietly altered rounding at the same time would be impossible to verify.
 *
 * No customer was ever overcharged by this: invoices bill actual_cost, the
 * switch's own figure. The reproduced cost exists to be COMPARED against the
 * switch, which is why the damage is to certification rather than to billing.
 */

/** The subset of a Sippy tariff rate that pricing depends on. */
export interface RateInputs {
  /** Price per MINUTE for the first interval. Not the price OF the interval. */
  price1?:            number | null;
  /** Price per MINUTE for each subsequent interval. */
  priceN?:            number | null;
  /** First billing interval, in SECONDS. */
  interval1?:         number | null;
  /** Subsequent billing interval, in SECONDS. */
  intervalN?:         number | null;
  connectFee?:        number | null;
  freeSeconds?:       number | null;
  gracePeriod?:       number | null;
  postCallSurcharge?: number | null;
}

export interface RatedCall {
  cost:       number;
  /** Seconds actually charged after interval rounding — NOT the raw duration. */
  billedSecs: number;
  /** How the figure was reached, for the verification record. */
  formula:    string;
}

const SECONDS_PER_MINUTE = 60;

/** Sippy defaults a missing interval to a full minute. */
function num(v: number | null | undefined, fallback = 0): number {
  const n = Number(v ?? fallback);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Cost of one call, from its duration and the rate that applies to it.
 *
 * The interval fields decide HOW MANY SECONDS are charged; the price fields
 * decide what a minute of those seconds costs. Keeping those two jobs separate
 * is the whole point — conflating them is the defect.
 */
export function rateCall(durationSecs: number, rate: RateInputs): RatedCall {
  const interval1   = num(rate.interval1, SECONDS_PER_MINUTE);
  const intervalN   = num(rate.intervalN, SECONDS_PER_MINUTE);
  const price1      = num(rate.price1);
  const priceN      = num(rate.priceN);
  const connectFee  = num(rate.connectFee);
  const freeSecs    = num(rate.freeSeconds);
  const gracePeriod = num(rate.gracePeriod);
  const surcharge   = num(rate.postCallSurcharge);

  // A call inside the grace period is not a chargeable event at all — no
  // connect fee, no surcharge.
  if (gracePeriod > 0 && durationSecs <= gracePeriod) {
    return { cost: 0, billedSecs: 0, formula: `grace(${gracePeriod}s)` };
  }

  const billable = Math.max(0, durationSecs - freeSecs);

  if (billable === 0) {
    return {
      cost: round8(connectFee + surcharge),
      billedSecs: 0,
      formula: 'connect_fee_only',
    };
  }

  // Interval rounding — identical to the existing engine. A call is charged
  // for whole blocks: the first interval1 seconds, then whole intervalN blocks.
  let billedSecs: number;
  let mainCost:   number;

  if (billable <= interval1) {
    billedSecs = interval1;
    mainCost   = price1 * (interval1 / SECONDS_PER_MINUTE);
  } else {
    const nExtra = Math.ceil((billable - interval1) / intervalN);
    billedSecs = interval1 + nExtra * intervalN;
    // Each block costs its share of a minute at that block's per-minute price.
    // The first block and the rest can carry different prices, so they are
    // converted separately rather than by scaling one total.
    mainCost = price1 * (interval1 / SECONDS_PER_MINUTE)
             + nExtra * priceN * (intervalN / SECONDS_PER_MINUTE);
  }

  return {
    cost: round8(connectFee + mainCost + surcharge),
    billedSecs,
    formula: `${connectFee ? 'connect+' : ''}${billedSecs}s @ per-minute`,
  };
}

/** Money is compared for exact equality against the switch; 8dp matches the
 *  precision the existing verification record already stores. */
function round8(n: number): number {
  return +n.toFixed(8);
}
