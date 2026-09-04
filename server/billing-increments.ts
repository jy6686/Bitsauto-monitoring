/**
 * billing-increments.ts — what a call of N seconds SHOULD cost.
 *
 * The reference implementation of standard telecom billing increments,
 * specified by the owner on 2026-09-04. Nothing imports this yet: it exists so
 * that the correct answer is written down, executable and tested BEFORE the
 * rating engine is touched. Changing how calls are priced is a commercial act,
 * and the safety net has to exist first.
 *
 * ── The rule ───────────────────────────────────────────────────────────────
 * A tariff carries two increments, written `interval1/intervalN`:
 *
 *   interval1   the MINIMUM billable duration. Any call at all is billed for
 *               at least this many seconds.
 *   intervalN   the granularity AFTER that first block. Every started unit of
 *               intervalN is billed whole.
 *
 *   billed = duration <= interval1
 *              ? interval1
 *              : interval1 + ceil((duration - interval1) / intervalN) * intervalN
 *
 * The five patterns this platform sees, and what they mean in words:
 *
 *   1/1     per second. 10s bills 10s.
 *   6/6     round up to the next 6.  1-6s → 6s,  7-12s → 12s.
 *   30/30   round up to the next 30. 1-30s → 30s, 31-60s → 60s.
 *   60/1    first minute mandatory, then per second. 1-60s → 60s, 75s → 75s.
 *   60/60   first minute mandatory, then whole minutes. 61-120s → 120s.
 *
 * ── Money ──────────────────────────────────────────────────────────────────
 * `price1` and `priceN` are prices PER MINUTE, not per interval. That
 * distinction is the entire defect this file exists to pin: the current engine
 * charges the per-minute price once per interval, so it over-bills by
 * 60/interval — invisible on 60/60, where an interval happens to be a minute,
 * and 60x on 1/1.
 *
 *   cost = (interval1 / 60) * price1
 *        + (subsequentIntervals * intervalN / 60) * priceN
 *
 * Pure: no DB, no clock, no engine. This is the arithmetic, stated once.
 */

export interface Increment {
  /** Minimum billable duration, seconds. */
  interval1: number;
  /** Granularity after the first block, seconds. */
  intervalN: number;
}

export interface IncrementPrice extends Increment {
  /** Price per MINUTE for the first interval. */
  price1: number;
  /** Price per MINUTE for each subsequent interval. */
  priceN: number;
}

/**
 * Seconds actually billed for a call of `durationSecs`.
 *
 * A zero-or-negative duration bills nothing. A call that never connected is
 * not a short call, and charging it the minimum interval would invent revenue
 * — the opposite of the error this module exists to prevent, but an error
 * all the same.
 */
export function billedSeconds(durationSecs: number, inc: Increment): number {
  const i1 = Math.max(0, Number(inc.interval1) || 0);
  const iN = Math.max(0, Number(inc.intervalN) || 0);
  const d  = Number(durationSecs);

  if (!Number.isFinite(d) || d <= 0) return 0;
  if (i1 <= 0 && iN <= 0) return Math.ceil(d);   // no increments declared: per second
  if (d <= i1) return i1;
  if (iN <= 0) return i1;                        // no tail granularity: first block only

  const overflow = d - i1;
  return i1 + Math.ceil(overflow / iN) * iN;
}

/** How many whole `intervalN` blocks are billed after the first. */
export function subsequentIntervals(durationSecs: number, inc: Increment): number {
  const i1 = Math.max(0, Number(inc.interval1) || 0);
  const iN = Math.max(0, Number(inc.intervalN) || 0);
  const d  = Number(durationSecs);
  if (!Number.isFinite(d) || d <= i1 || iN <= 0) return 0;
  return Math.ceil((d - i1) / iN);
}

/**
 * What the call costs, in the tariff's currency.
 *
 * Prices are per MINUTE. Billed seconds are converted to minutes before the
 * price is applied — which is the step the current engine omits.
 */
export function chargeFor(durationSecs: number, rate: IncrementPrice): number {
  const d = Number(durationSecs);
  if (!Number.isFinite(d) || d <= 0) return 0;

  const i1 = Math.max(0, Number(rate.interval1) || 0);
  const iN = Math.max(0, Number(rate.intervalN) || 0);
  const p1 = Number(rate.price1) || 0;
  const pN = Number(rate.priceN) || 0;

  // Degenerate tariff: no increments declared, bill the whole duration at p1.
  if (i1 <= 0 && iN <= 0) return (Math.ceil(d) / 60) * p1;

  const firstBlock = (Math.min(i1, billedSeconds(d, rate)) / 60) * p1;
  const tail       = (subsequentIntervals(d, rate) * iN / 60) * pN;
  return firstBlock + tail;
}

/** Human name for an increment pair, for report lines and test titles. */
export function describeIncrement(inc: Increment): string {
  const { interval1: i1, intervalN: iN } = inc;
  if (i1 === 1 && iN === 1)   return '1/1 (per second)';
  if (i1 === iN)              return `${i1}/${iN} (round up to the next ${iN}s)`;
  if (i1 === 60 && iN === 1)  return '60/1 (first minute, then per second)';
  return `${i1}/${iN} (first ${i1}s, then whole ${iN}s blocks)`;
}

/**
 * The factor by which a per-interval engine over-charges a per-minute tariff.
 *
 * Charging the minute price once per interval multiplies the bill by
 * 60/intervalN — which is 1 when intervalN is 60, and that is precisely why
 * this survived: every 60/60 tariff reproduces correctly.
 */
export function perIntervalOvercharge(inc: Increment): number {
  const iN = Math.max(0, Number(inc.intervalN) || 0);
  return iN > 0 ? 60 / iN : Infinity;
}
