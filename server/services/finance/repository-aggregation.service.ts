/**
 * repository-aggregation.service.ts — the PLATFORM side of certification.
 *
 * Owner contract, 2026-08-31: one row per (i_account, period), computed from
 * raw_sippy_cdrs and nothing else. Not from the DMR, not from a snapshot, not
 * from a materialised table, and never from a display name.
 *
 * That last part is now possible. Identity was verified against production the
 * same day — clients 5/5, coverage 100%, ids read from the portal's own account
 * links — so this groups by `i_account` and no fallback exists anywhere in it.
 *
 * WHY THE ::numeric CASTS ARE NOT COSMETIC. `cost` is declared REAL (float4),
 * which BILLING-RECONCILIATION-CONTRACT §10 records as a blocking prerequisite.
 * Postgres sums `real` IN `real`: as the running total grows, small addends stop
 * changing it, and the measured production error was +$0.072 over 165k rows and
 * −$3.552 over 1.65M. The reconciliation gate's tolerance is ONE CENT, so an
 * uncast SUM would fail periods that are correct and pass periods that are not
 * — at the larger scale it is 355 times the tolerance. Casting each value to
 * numeric before summing makes the addition exact with respect to what is
 * stored.
 *
 * Residual, stated rather than assumed away: the stored values are still
 * float4, so they carry ~7 significant digits. At observed per-call amounts
 * (~$0.00075) that is roughly 1e-11 absolute per row and immaterial across a
 * week. Migrating the column to numeric remains §10's outstanding item; the
 * cast removes the summation error, not the storage limit.
 */
import { db } from '../../db';
import { sql } from 'drizzle-orm';

export interface AccountAggregate {
  iAccount:      number;
  /** Every CDR in the period for this account. */
  calls:         number;
  /** Calls the switch actually billed for — comparable to Sippy's billable count. */
  billableCalls: number;
  durationSec:   number;
  billedSec:     number;
  /** Σ cost, the switch's own charge. The only figure here that is money. */
  amount:        number;
  firstCall:     string | null;
  lastCall:      string | null;
}

export interface RepositoryAggregation {
  periodStart: string;
  periodEnd:   string;
  /** Half-open [from, to) in UTC — BILLING-POLICY §1.1. */
  convention:  string;
  accounts:    AccountAggregate[];
  totals:      { accounts: number; calls: number; billedSec: number; amount: number };
  generatedAt: string;
}

const n = (v: any) => (v == null ? 0 : Number(v));

/**
 * @param periodStart YYYY-MM-DD, inclusive
 * @param periodEnd   YYYY-MM-DD, EXCLUSIVE — the first instant not billed
 */
export async function aggregateRepositoryByAccount(opts: {
  periodStart: string;
  periodEnd:   string;
  iAccount?:   number | null;
}): Promise<RepositoryAggregation> {
  const from = `${opts.periodStart}T00:00:00Z`;
  const to   = `${opts.periodEnd}T00:00:00Z`;

  const rows: any = await db.execute(sql`
    SELECT
      i_account                                              AS i_account,
      count(*)::int                                          AS calls,
      count(*) FILTER (WHERE coalesce(billed_secs, 0) > 0)::int AS billable_calls,
      coalesce(sum(coalesce(total_secs,  0)::numeric), 0)    AS duration_sec,
      coalesce(sum(coalesce(billed_secs, 0)::numeric), 0)    AS billed_sec,
      -- ::numeric BEFORE the sum. See the note at the top of this file: an
      -- uncast SUM over float4 loses small addends into a growing total and
      -- has produced dollars of error against a one-cent tolerance.
      coalesce(sum(coalesce(cost, 0)::numeric), 0)           AS amount,
      min(started_at)                                        AS first_call,
      max(started_at)                                        AS last_call
    FROM raw_sippy_cdrs
    WHERE started_at >= ${from}::timestamptz
      AND started_at <  ${to}::timestamptz
      -- An account id is the identity. A row without one cannot be attributed
      -- to a customer and must not be silently folded into another's total.
      AND i_account IS NOT NULL
      ${opts.iAccount ? sql`AND i_account = ${Number(opts.iAccount)}` : sql``}
    GROUP BY i_account
    ORDER BY amount DESC
  `);

  const accounts: AccountAggregate[] = ((rows.rows ?? []) as any[]).map(r => ({
    iAccount:      Number(r.i_account),
    calls:         n(r.calls),
    billableCalls: n(r.billable_calls),
    durationSec:   n(r.duration_sec),
    billedSec:     n(r.billed_sec),
    amount:        n(r.amount),
    firstCall:     r.first_call ? new Date(r.first_call).toISOString() : null,
    lastCall:      r.last_call  ? new Date(r.last_call).toISOString()  : null,
  }));

  return {
    periodStart: opts.periodStart,
    periodEnd:   opts.periodEnd,
    convention:  '[periodStart, periodEnd) UTC',
    accounts,
    totals: {
      accounts:  accounts.length,
      calls:     accounts.reduce((s, a) => s + a.calls, 0),
      billedSec: accounts.reduce((s, a) => s + a.billedSec, 0),
      amount:    Math.round(accounts.reduce((s, a) => s + a.amount, 0) * 1e6) / 1e6,
    },
    generatedAt: new Date().toISOString(),
  };
}
