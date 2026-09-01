/**
 * reference-coverage.ts — does the reference cover the period it is judging?
 *
 * A reference that is silently PARTIAL is worse than no reference at all,
 * because it produces a confident verdict from an incomplete comparison — and
 * the verdict it produces is biased toward PASS.
 *
 * MEASURED 2026-09-01, the case that forced this file. Reconciling the week
 * 2026-08-24 → 08-30 against Sippy's DMR:
 *
 *   platform  $331.78     collected across all 7 days
 *   reference $683.39     but 2026-08-29 HAS NO DMR ROW AT ALL
 *
 * The reference is missing a day. Whatever traffic ran on 08-29 is absent from
 * the reference total while it is present in the platform total, so the gap
 * closes for a reason that has nothing to do with correctness. Push that
 * further and the arithmetic inverts: a reference missing enough days makes an
 * under-collecting platform look like an OVER-billing one, and a platform that
 * is genuinely short can be waved through by a reference that is shorter.
 *
 * This is the same defect as the day-seal bug one layer up — "some of it
 * arrived" being read as "all of it arrived" — so it gets the same treatment:
 * completeness is an explicit fact, checked before the comparison runs, never
 * inferred from the comparison's own result.
 *
 * The rule is therefore absolute and deliberately unforgiving: if any day of
 * the period lacks a reference, the outcome is REFERENCE_UNAVAILABLE, which
 * BILLING-RECONCILIATION-CONTRACT §7 states is NOT a pass. A missing reference
 * is a thing to go and fetch — for the DMR, one operator click per day — not a
 * thing to reason around.
 *
 * Dependency-free so the date arithmetic is pinned by tests.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export interface ReferenceCoverage {
  /** Every day the period requires, inclusive of both ends. */
  days:        string[];
  /** Days the reference actually carries a row for. */
  present:     string[];
  /** Days with no reference row. Non-empty ⇒ the gate must not compare. */
  missing:     string[];
  complete:    boolean;
  /** Operator-facing and specific: names the days and the remedy. */
  explanation: string;
}

/**
 * @param periodStart YYYY-MM-DD, inclusive
 * @param periodEnd   YYYY-MM-DD, EXCLUSIVE — the first instant not billed,
 *                    per BILLING-POLICY §1.1. A one-day period is
 *                    (D, D+1).
 * @param referenceDays the distinct days for which a reference row exists.
 *                      Duplicates and out-of-range days are ignored rather
 *                      than counted: a reference for a day outside the period
 *                      is not evidence about a day inside it.
 */
export function assessReferenceCoverage(opts: {
  periodStart:   string;
  periodEnd:     string;
  referenceDays: string[];
}): ReferenceCoverage {
  const startMs = Date.parse(`${opts.periodStart}T00:00:00Z`);
  const endMs   = Date.parse(`${opts.periodEnd}T00:00:00Z`);

  // A period that is not a period cannot be covered by anything. Saying so
  // beats returning complete:true for an empty day list, which would read as
  // "fully covered" to every caller.
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return {
      days: [], present: [], missing: [], complete: false,
      explanation: `Not a valid period: ${opts.periodStart} → ${opts.periodEnd} ` +
                   '(end is EXCLUSIVE and must be after start).',
    };
  }

  const days: string[] = [];
  for (let ms = startMs; ms < endMs; ms += DAY_MS) days.push(dayKey(ms));

  const have    = new Set(opts.referenceDays.map(d => String(d).slice(0, 10)));
  const present = days.filter(d => have.has(d));
  const missing = days.filter(d => !have.has(d));

  const complete = missing.length === 0;
  const explanation = complete
    ? `Reference covers all ${days.length} day(s) of the period.`
    : `Reference is INCOMPLETE: ${missing.length} of ${days.length} day(s) have no ` +
      `reference row — ${missing.join(', ')}. A partial reference understates the ` +
      'total it is compared against, so a shortfall in the platform would be ' +
      'hidden rather than reported. Generate the missing reference (Run DMR for ' +
      'each date) and re-run; this is not a pass.';

  return { days, present, missing, complete, explanation };
}
