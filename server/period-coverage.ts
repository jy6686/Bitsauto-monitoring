/**
 * period-coverage.ts — does this billing period actually have its days?
 *
 * Production 2026-08-31: invoice C-2608-0009 was generated for
 * 2026-08-24 → 2026-08-30 from four days of CDRs. 08-28, 08-29 and 08-30 were
 * never collected (forward capture was left disarmed), and the invoice's 20,454
 * lines are exactly the four days that existed. Nothing refused it.
 *
 * Every gate in the chain passed, and each was working as designed:
 *   · FREEZE asks whether the period has ENDED. It had.
 *   · CERTIFICATION, in its own words, "certifies by the absence of
 *     discrepancies among the calls it HAS" — a day that was never fetched
 *     produces no discrepancy, because it produces nothing at all.
 *
 * So the period was closed, certified and three-sevenths empty. This module is
 * the missing question: not "are the calls I have correct" but "am I missing
 * whole days".
 *
 * THE HARD PART — an empty day is not the same as an uncollected day. A
 * customer with no traffic on a Sunday is a legitimate zero, and refusing to
 * invoice them would be its own defect. The discriminator is the seed_jobs
 * ledger: a day is covered when it was COLLECTED, whatever that collection
 * found. Absence of data is not evidence; absence of collection is.
 *
 * Dependency-free so the date arithmetic is pinned by tests.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** A completed collection run, from seed_jobs. Inclusive of both bounds. */
export interface CollectedRange {
  periodStart: string;
  periodEnd:   string;
}

export interface CoverageResult {
  /** Every day in the period, inclusive of both ends. */
  days:      string[];
  /** Days with neither repository rows nor a completed collection. */
  uncovered: string[];
  /** Days collected but genuinely empty — reported, never treated as missing. */
  emptyButCollected: string[];
  covered:   boolean;
  /** Operator-facing, names the days. Empty when covered. */
  reason:    string;
}

/**
 * @param daysWithRows      days the repository holds at least one CDR for
 * @param collectedRanges   completed collection runs (seed_jobs, status done)
 */
export function assessPeriodCoverage(opts: {
  periodStart:      string;
  periodEnd:        string;
  daysWithRows:     string[];
  collectedRanges:  CollectedRange[];
}): CoverageResult {
  const startMs = Date.parse(`${opts.periodStart}T00:00:00Z`);
  const endMs   = Date.parse(`${opts.periodEnd}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return {
      days: [], uncovered: [], emptyButCollected: [], covered: false,
      reason: `Unusable billing period ${opts.periodStart} – ${opts.periodEnd}.`,
    };
  }

  const days: string[] = [];
  for (let ms = startMs; ms <= endMs; ms += DAY_MS) days.push(dayKey(ms));

  const withRows = new Set(opts.daysWithRows);
  const collected = (day: string) => opts.collectedRanges.some(r =>
    r.periodStart <= day && day <= (r.periodEnd || r.periodStart));

  const uncovered: string[] = [];
  const emptyButCollected: string[] = [];
  for (const day of days) {
    if (withRows.has(day)) continue;          // has evidence
    if (collected(day)) { emptyButCollected.push(day); continue; } // real zero
    uncovered.push(day);                       // never asked
  }

  if (uncovered.length === 0) {
    return {
      days, uncovered, emptyButCollected, covered: true,
      reason: '',
    };
  }

  // Name the days. "The period is incomplete" sends an operator hunting; the
  // dates tell them exactly what to collect.
  return {
    days, uncovered, emptyButCollected, covered: false,
    reason:
      `Billing period ${opts.periodStart} – ${opts.periodEnd} has no CDR data for ` +
      `${uncovered.length} of its ${days.length} day(s): ${uncovered.join(', ')}. ` +
      'These days were never collected, so certification cannot see them — it checks ' +
      'the calls present, and a day that was never fetched produces no discrepancy. ' +
      'Collect the missing days, then regenerate.',
  };
}
