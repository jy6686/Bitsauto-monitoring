/**
 * dmr-reference.service.ts — the INDEPENDENT reference, read from the DMR.
 *
 * BILLING-RECONCILIATION-CONTRACT §3 requires a reference produced OUTSIDE
 * this platform. The DMR carries exactly that and nothing else does today:
 * `sippy_amount` / `sippy_duration` / `sippy_calls` are the switch's own
 * figures, scraped from Sippy and stored verbatim, before any BitsAuto stage
 * touches them. The platform_* columns beside them are BitsAuto's reproduction
 * and are deliberately NOT read here — comparing those would be the
 * self-comparison this entire gate exists to replace.
 *
 * VERIFIED AGAINST PRODUCTION, twice, at the cent and the second:
 *   2026-08-27 asterisk          repository $47.3515 · DMR $47.3515
 *   2026-08-27 internal-eritrea  repository $15.4321 · DMR $15.4321
 * and, on a day the fetch under-collected, it correctly disagreed:
 *   2026-08-31 asterisk          repository  $5.5890 · DMR $50.6793
 * So the reference discriminates. That is the property that matters; a
 * reference which agreed with everything would be decorative.
 *
 * TWO REFUSALS, both deliberate, both returning null rather than a number:
 *
 *  1. NO ROWS AT ALL → null. Silence from the reference is not consent.
 *  2. PARTIAL DAY COVERAGE → null. 2026-08-29 has no DMR row; a week
 *     reconciled without it compares seven platform days against six
 *     reference days, which shrinks the reference and biases the verdict
 *     toward PASS. See server/reference-coverage.ts for why this is refused
 *     rather than pro-rated.
 *
 * Read-only. Touches nothing.
 */
import { db } from '../../db';
import { sql } from 'drizzle-orm';
import type { AccountFigures } from '../../account-reconciliation';
import { assessReferenceCoverage, type ReferenceCoverage } from '../../reference-coverage';

export interface DmrReference {
  /** Per-customer totals for the whole period, or null when unusable. */
  accounts:  AccountFigures[] | null;
  coverage:  ReferenceCoverage;
  /** Why `accounts` is null, when it is. Empty otherwise. */
  refusal:   string;
  /** Distinct report dates actually found, for the audit trail. */
  daysFound: string[];
  source:    'dmr';
  generatedAt: string;
}

const n = (v: any) => (v == null ? 0 : Number(v));

/**
 * @param periodStart YYYY-MM-DD inclusive
 * @param periodEnd   YYYY-MM-DD EXCLUSIVE (BILLING-POLICY §1.1)
 */
export async function dmrReferenceFor(opts: {
  periodStart: string;
  periodEnd:   string;
}): Promise<DmrReference> {
  // report_date is a DATE column holding the collected day. The period end is
  // exclusive, so `< periodEnd` is the whole comparison — no BETWEEN, which
  // would silently include the first day of the next period.
  //
  // latest version only: the DMR keeps supersession history (dmr_version,
  // parent_dmr_id) and summing every version would multiply a day's money by
  // the number of times it was regenerated.
  const rows: any = await db.execute(sql`
    WITH latest AS (
      SELECT DISTINCT ON (report_date, account_name)
             report_date, account_name, sippy_amount, sippy_duration, sippy_calls
        FROM daily_minutes_reports
       WHERE report_date >= ${opts.periodStart}::date
         AND report_date <  ${opts.periodEnd}::date
         AND account_name IS NOT NULL
       ORDER BY report_date, account_name, dmr_version DESC NULLS LAST, id DESC
    )
    SELECT account_name                                        AS name,
           -- ::numeric before SUM for the same reason as the repository
           -- aggregation: these columns are REAL, and Postgres sums real IN
           -- real, losing small addends into a growing total against a
           -- one-cent tolerance.
           coalesce(sum(coalesce(sippy_amount,   0)::numeric), 0) AS amount,
           coalesce(sum(coalesce(sippy_duration, 0)::numeric), 0) AS duration_sec,
           coalesce(sum(coalesce(sippy_calls,    0)::numeric), 0) AS calls,
           count(DISTINCT report_date)::int                     AS days
      FROM latest
     GROUP BY account_name
     ORDER BY amount DESC
  `);

  const dayRows: any = await db.execute(sql`
    SELECT DISTINCT report_date::text AS d
      FROM daily_minutes_reports
     WHERE report_date >= ${opts.periodStart}::date
       AND report_date <  ${opts.periodEnd}::date
     ORDER BY d
  `);
  const daysFound = ((dayRows.rows ?? []) as any[]).map(r => String(r.d).slice(0, 10));

  const coverage = assessReferenceCoverage({
    periodStart: opts.periodStart,
    periodEnd:   opts.periodEnd,
    referenceDays: daysFound,
  });

  const accounts: AccountFigures[] = ((rows.rows ?? []) as any[]).map(r => ({
    name:    String(r.name),
    calls:   n(r.calls),
    // AccountFigures speaks minutes; the DMR stores seconds.
    minutes: Math.round((n(r.duration_sec) / 60) * 1e6) / 1e6,
    amount:  Math.round(n(r.amount) * 1e6) / 1e6,
  }));

  if (accounts.length === 0) {
    return {
      accounts: null, coverage, daysFound, source: 'dmr',
      refusal: `No DMR rows exist for ${opts.periodStart} → ${opts.periodEnd} (end exclusive). ` +
               'There is no independent reference for this period, so nothing can be certified ' +
               'against it. Generate it with Run DMR for each date in the period.',
      generatedAt: new Date().toISOString(),
    };
  }

  if (!coverage.complete) {
    return {
      accounts: null, coverage, daysFound, source: 'dmr',
      refusal: coverage.explanation,
      generatedAt: new Date().toISOString(),
    };
  }

  return {
    accounts, coverage, daysFound, source: 'dmr', refusal: '',
    generatedAt: new Date().toISOString(),
  };
}
