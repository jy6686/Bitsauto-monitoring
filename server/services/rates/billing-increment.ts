/**
 * billing-increment.ts
 *
 * `commercial_destination_prefixes.billing_increment` holds the increment EXACTLY as the
 * supplier wrote it — '1/1', '60/1', '60/60', '30/6', '6/6'. Sippy's workbook wants two
 * integers, Interval 1 and Interval N. This turns one into the other, and refuses anything
 * it cannot read rather than guessing.
 *
 * NOT WIRED INTO THE WORKBOOK YET. `buildBulkRateXlsx` still emits a hardcoded 1/1; this
 * module exists so the dry-run report can measure the blast radius of changing that before
 * a single row of live billing moves. Wiring is step 3.
 *
 * Why refusing beats defaulting: a workbook row built from an unreadable increment is not
 * incomplete, it is WRONG — it silently asserts per-second billing on a contract that says
 * 60/60, and the customer is billed on that assertion until someone reads a CDR.
 */

export interface BillingIncrement {
  /** Seconds charged for the first interval. Sippy column "Interval 1". */
  interval1: number;
  /** Seconds charged for every subsequent interval. Sippy column "Interval N". */
  intervalN: number;
}

/** What the workbook builder emits today, for every row, regardless of contract. */
export const CURRENT_HARDCODED_INCREMENT: BillingIncrement = { interval1: 1, intervalN: 1 };

/**
 * An interval is a count of seconds. One hour is already absurd for a billing increment;
 * anything beyond it is a parsing accident (a date, a rate, a concatenated field) rather
 * than a contract term, so it is rejected instead of pushed to a live switch.
 */
const MAX_INTERVAL_SECONDS = 3600;

/** `60 / 1` and `60/1` are the same supplier intent; nothing else is accepted. */
const INCREMENT_PATTERN = /^(\d{1,4})\s*\/\s*(\d{1,4})$/;

/**
 * Returns null for anything unusable — absent, blank, malformed, zero, or out of range.
 * Null means "this row has no readable increment", which the caller must handle explicitly.
 * It never falls back to 1/1 on its own; that decision belongs to the caller and is the
 * thing the dry run is measuring.
 */
export function parseBillingIncrement(raw: string | null | undefined): BillingIncrement | null {
  if (raw === null || raw === undefined) return null;

  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  const match = INCREMENT_PATTERN.exec(trimmed);
  if (!match) return null;

  const interval1 = Number(match[1]);
  const intervalN = Number(match[2]);

  // A zero interval is not "bill nothing", it is a division by zero on the switch.
  if (interval1 < 1 || intervalN < 1) return null;
  if (interval1 > MAX_INTERVAL_SECONDS || intervalN > MAX_INTERVAL_SECONDS) return null;

  return { interval1, intervalN };
}

/**
 * Does emitting the real increment change what this row currently sends?
 * Unreadable increments are not "different" — they are unknown, and the report counts them
 * separately, because "we would bill this differently" and "we cannot tell" are different
 * problems with different fixes.
 */
export function differsFromCurrentBehaviour(raw: string | null | undefined): boolean {
  const parsed = parseBillingIncrement(raw);
  if (!parsed) return false;
  return parsed.interval1 !== CURRENT_HARDCODED_INCREMENT.interval1
      || parsed.intervalN !== CURRENT_HARDCODED_INCREMENT.intervalN;
}

/** Canonical `N/M` form, for grouping a report by increment without duplicate spellings. */
export function formatBillingIncrement(inc: BillingIncrement): string {
  return `${inc.interval1}/${inc.intervalN}`;
}
