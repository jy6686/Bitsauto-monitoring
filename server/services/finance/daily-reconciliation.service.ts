/**
 * daily-reconciliation.service.ts — the recovery work list.
 *
 * Feeds reconcileDaily() from the two independent sides: the DMR's `sippy_*`
 * columns (the switch's own figures, stored verbatim) and raw_sippy_cdrs (the
 * platform's evidence, computed from nothing else).
 *
 * Owner's recovery strategy: compare every (day, account) cell, re-fetch ONLY
 * the cells that disagree, reconcile again, stop when they match. This
 * produces the list of cells to re-fetch, ranked by money, so a recovery does
 * the smallest amount of work that could possibly help instead of re-running
 * the week and hoping.
 *
 * IDENTITY. The reference speaks in account NAMES, the repository in i_account.
 * The join is companies.sippy_i_account → companies.name, and it runs in the
 * direction that is safe: name → account is unambiguous even for account 76,
 * which two companies claim. The reverse would not be. A platform row whose
 * account matches no company is reported under a synthetic label rather than
 * dropped — money the platform holds and cannot attribute is exactly the kind
 * of thing that must not disappear from a reconciliation.
 *
 * Read-only.
 */
import { db } from '../../db';
import { sql } from 'drizzle-orm';
import { reconcileDaily, type Cell, type DailyReconResult } from '../../daily-reconciliation';

export interface DailyReconReport extends DailyReconResult {
  periodStart: string;
  periodEnd:   string;
  convention:  string;
  referenceSource: string;
  generatedAt: string;
}

const n = (v: any) => (v == null ? 0 : Number(v));
const DAY_MS = 24 * 60 * 60 * 1000;

export async function dailyReconciliationReport(opts: {
  periodStart: string;
  periodEnd:   string;   // EXCLUSIVE
}): Promise<DailyReconReport> {
  const days: string[] = [];
  for (let ms = Date.parse(`${opts.periodStart}T00:00:00Z`);
       ms < Date.parse(`${opts.periodEnd}T00:00:00Z`); ms += DAY_MS) {
    days.push(new Date(ms).toISOString().slice(0, 10));
  }

  // ── Reference: the switch's own figures, per day per account ─────────────
  // DISTINCT ON keeps the latest DMR version per (date, account): the table
  // holds supersession history, and summing every version would multiply a
  // day's money by the number of times it was regenerated.
  const refRows: any = await db.execute(sql`
    SELECT DISTINCT ON (report_date, account_name)
           report_date::text AS day, account_name AS account,
           coalesce(sippy_amount, 0)::numeric   AS amount,
           coalesce(sippy_duration, 0)::numeric AS duration_sec,
           coalesce(sippy_calls, 0)             AS calls
      FROM daily_minutes_reports
     WHERE report_date >= ${opts.periodStart}::date
       AND report_date <  ${opts.periodEnd}::date
       AND account_name IS NOT NULL
     ORDER BY report_date, account_name, dmr_version DESC NULLS LAST, id DESC
  `);

  // ── Platform: computed from raw_sippy_cdrs, per UTC day per account ──────
  // ::numeric before SUM — `cost` is REAL and an uncast sum loses small
  // addends into a growing total against a one-cent tolerance.
  const platRows: any = await db.execute(sql`
    SELECT to_char(r.started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')     AS day,
           r.i_account                                                AS i_account,
           min(c.name)                                                AS name,
           count(DISTINCT c.name)::int                                AS claimants,
           count(*)::int                                              AS calls,
           coalesce(sum(coalesce(r.billed_secs, 0)::numeric), 0)      AS billed_sec,
           coalesce(sum(coalesce(r.cost, 0)::numeric), 0)             AS amount
      FROM raw_sippy_cdrs r
      LEFT JOIN companies c ON c.sippy_i_account = r.i_account
     WHERE r.started_at >= ${`${opts.periodStart}T00:00:00Z`}::timestamptz
       AND r.started_at <  ${`${opts.periodEnd}T00:00:00Z`}::timestamptz
       AND r.i_account IS NOT NULL
     GROUP BY 1, 2
  `);

  const reference: Cell[] = ((refRows.rows ?? []) as any[]).map(r => ({
    day:     String(r.day).slice(0, 10),
    account: String(r.account),
    amount:  n(r.amount),
    minutes: Math.round((n(r.duration_sec) / 60) * 1e6) / 1e6,
    calls:   n(r.calls),
  }));

  const platform: Cell[] = ((platRows.rows ?? []) as any[]).map(r => {
    const claimants = n(r.claimants);
    // One company: use its name, which is how the reference speaks.
    // None, or more than one: label it so the money is still visible and
    // still comparable, but never silently attributed to a customer that may
    // not own it. Such a cell will surface as missing_from_reference, which is
    // correct — it is not something re-fetching can fix.
    const account = claimants === 1 && r.name
      ? String(r.name)
      : `(account ${r.i_account}${claimants > 1 ? `, shared by ${claimants} companies` : ', unlinked'})`;
    return {
      day:     String(r.day).slice(0, 10),
      account,
      amount:  n(r.amount),
      minutes: Math.round((n(r.billed_sec) / 60) * 1e6) / 1e6,
      calls:   n(r.calls),
    };
  });

  return {
    ...reconcileDaily({ reference, platform, days }),
    periodStart: opts.periodStart,
    periodEnd:   opts.periodEnd,
    convention:  '[periodStart, periodEnd) UTC',
    referenceSource: 'dmr',
    generatedAt: new Date().toISOString(),
  };
}
