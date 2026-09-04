/**
 * rating-cost.ts — what a call costs under a Sippy tariff rate.
 *
 * WIRED IN as of 2026-09-04. `reproduceCost()` — the engine behind rating
 * verification, the DMR and the invoice snapshot — now delegates here, and this
 * delegates the arithmetic itself to `billing-increments`. One implementation
 * of the increment maths, one implementation of the fee envelope, and the
 * owner's specification suite tests both through this path.
 *
 * ── The defect this replaced ─────────────────────────────────────────────────
 * The codebase carried two contradictory declarations of the same fields:
 *
 *   server/sippy.ts:5844  (SippyTariffRate, the integration contract)
 *     price1  // price_1 — price per minute (first interval)
 *     priceN  // price_n — price per minute (subsequent intervals)
 *
 *   server/services/sippy/sippy-rating-verification.service.ts (former header)
 *     "price_1 and price_n are per-block prices (not per-minute rates)."
 *
 * Production settled it. For tariff 32 prefix 192 (price1 0.035, intervals 1/1)
 * Sippy charged $5.09 over 145.37 minutes — 0.035 PER MINUTE — while the
 * verifier reproduced $305.27, exactly 60x, because it charged price1 once per
 * one-second block. `priceN === price1` in every rate row is the tell: under
 * per-block pricing each extra second would cost as much as the whole first
 * minute, which no tariff means.
 *
 * The multiplier was 60/intervalN, so a 60/60 tariff reproduced correctly and
 * masked it. Of the 44 rate rows on the two live tariffs, 42 are 1/1.
 *
 * ── What this DID reach ──────────────────────────────────────────────────────
 * An earlier version of this comment said no customer was overcharged, because
 * invoices bill the switch's actual_cost. That was wrong, and the correction
 * matters: `invoices.html_content` — the document frozen at generation and
 * attached to the email — renders the REPRODUCED cost, including a per-line
 * rate column. C-2608-0007 printed "@ $2.10000/min" against a tariff of
 * $0.03500. Only Email Test Mode kept it off a customer's desk.
 *
 * Correcting the engine corrects documents generated FROM NOW ON. Invoices
 * already generated hold their inflated figures until their snapshots are
 * regenerated, which is a separate, owner-triggered act.
 */

import { billedSeconds, chargeFor, type IncrementPrice } from './billing-increments';

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
 * Two jobs, kept separate because conflating them was the defect: the INTERVAL
 * fields decide how many seconds are charged, and the PRICE fields decide what
 * a minute of those seconds costs. Both are answered by `billing-increments`,
 * which is tested directly against the owner's specification; everything this
 * function adds is the fee envelope around them.
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

  const billable = Math.max(0, num(durationSecs) - freeSecs);

  if (billable === 0) {
    return {
      cost: round8(connectFee + surcharge),
      billedSecs: 0,
      formula: 'connect_fee_only',
    };
  }

  const increment: IncrementPrice = { interval1, intervalN, price1, priceN };
  const billedSecs = billedSeconds(billable, increment);
  const mainCost   = chargeFor(billable, increment);

  return {
    cost: round8(connectFee + mainCost + surcharge),
    billedSecs,
    formula: describeCharge({
      billedSecs, interval1, intervalN, price1, priceN,
      connectFee, freeSecs, surcharge,
    }),
  };
}

/**
 * A formula string that shows the per-minute conversion on its face.
 *
 * The old one read `0+0.035[≤1s]+0` — which is a faithful description of the
 * wrong arithmetic, and reads as plausible either way. This one states the
 * billed seconds AND the division, so a reader can check the units without
 * running anything.
 */
function describeCharge(p: {
  billedSecs: number; interval1: number; intervalN: number;
  price1: number; priceN: number;
  connectFee: number; freeSecs: number; surcharge: number;
}): string {
  const parts: string[] = [];
  if (p.connectFee) parts.push(`connect ${p.connectFee}`);
  if (p.freeSecs)   parts.push(`free ${p.freeSecs}s`);

  const first = `${p.interval1}s/60*${p.price1}`;
  const tailSecs = Math.max(0, p.billedSecs - p.interval1);
  parts.push(
    tailSecs > 0
      ? `${first} + ${tailSecs}s/60*${p.priceN}`
      : first,
  );

  if (p.surcharge) parts.push(`surcharge ${p.surcharge}`);
  return `${parts.join(' + ')} [${p.billedSecs}s billed]`;
}

/** Money is compared for exact equality against the switch; 8dp matches the
 *  precision the existing verification record already stores. */
function round8(n: number): number {
  return +n.toFixed(8);
}
