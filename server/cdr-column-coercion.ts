/**
 * cdr-column-coercion.ts — turning a switch's field into a storable value.
 *
 * Production 2026-08-26 (job sj-1787842082071-moe8dx): EVERY repository write
 * for four days failed with
 *
 *     invalid input syntax for type integer: "7.697271466"
 *
 * Sippy reports a call's real duration fractionally. `total_secs` was declared
 * INTEGER, so Postgres rejected the whole 500-row chunk — and the seeder's
 * billing-continues contract swallowed the exception, so the job reported
 * "done, errors 0" while storing nothing. Days of evidence were lost to a
 * column type.
 *
 * Two rules come out of that, and this module exists to make them explicit
 * rather than implicit in a mapping expression:
 *
 * 1. A MEASUREMENT is never narrowed at ingestion. The Raw CDR Repository is
 *    the switch's own record, and reconciliation compares against it; rounding
 *    7.697271466 to 8 on the way in edits the evidence before anyone has read
 *    it. Measured columns are decimal — see migration 083.
 *
 * 2. A column that genuinely IS an integer must never be handed a fraction.
 *    free_seconds, grace_period, interval_1 and interval_n echo tariff
 *    CONFIGURATION, which Sippy models as whole seconds. But "should always be
 *    whole" is exactly the assumption that just cost four days, so they are
 *    rounded deliberately and reported, instead of being trusted and throwing.
 *
 * Dependency-free so the arithmetic is pinned by tests.
 */

/**
 * A measured quantity, kept at full precision. Returns null for absent or
 * unparseable input — a missing measurement is not zero.
 */
export function decimalOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * A value bound for an integer column. Rounds rather than throwing, because a
 * rejected row loses the entire chunk it travels in — and losing a call's whole
 * record to preserve one decimal place on a tariff parameter is the wrong
 * trade. Rounding is half-away-from-zero and symmetric about zero, so a
 * negative correction is not silently biased upward the way Math.round would
 * make it (Math.round(-0.5) === -0).
 */
export function intOrNull(v: unknown): number | null {
  const n = decimalOrNull(v);
  if (n === null) return null;
  return n < 0 ? -Math.round(-n) : Math.round(n);
}

/**
 * True when `intOrNull` would change the value — i.e. an integer column was
 * handed a fraction. Callers report this rather than discarding it: it means
 * a field we classified as configuration is actually a measurement, and the
 * classification, not the value, is what needs fixing.
 */
export function wouldRound(v: unknown): boolean {
  const n = decimalOrNull(v);
  return n !== null && !Number.isInteger(n);
}
