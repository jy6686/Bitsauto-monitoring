/**
 * pipeline-disposition.service.ts — where does each customer stop, and why?
 *
 * Owner requirement, 2026-08-31: "instead of silently not generating invoices,
 * every billing run should produce a disposition for every active customer."
 *
 * The week that produced this: invoice C-2608-0009 billed asterisk and nobody
 * else, and finding out why took a day of tracing — through Sippy's Customer
 * Summary, the repository aggregate, the seed-job ledger, the collector's
 * account selection, and finally the companies table. The answer was one NULL
 * column, and every stage in between had behaved correctly. None of them was
 * lying; none of them was asked.
 *
 * A customer that produces no invoice must produce a REASON instead. Absence is
 * not a result. This turns "why is internal-ptcl missing?" from a day of
 * archaeology into one row.
 *
 * Read-only. Reports; changes nothing.
 */
import { db } from '../../db';
import { sql } from 'drizzle-orm';

/** Ordered by how early the customer stops. */
export type DispositionStage =
  | 'no_sippy_account'   // never linked to a switch account
  | 'no_tariff'          // linked, but the collector requires a tariff to price
  | 'not_collected'      // collectible, yet no CDRs landed for this period
  | 'collected';         // data is present and downstream can proceed

export interface CustomerDisposition {
  companyId:   number;
  name:        string;
  iAccount:    number | null;
  iTariff:     string | null;
  billingCycle: string | null;
  stage:       DispositionStage;
  collectible: boolean;
  calls:       number;
  amount:      number;
  invoices:    number;
  /** Plain language, and it names the fix rather than the symptom. */
  reason:      string;
}

const n = (v: any) => (v == null ? 0 : Number(v));

export async function customerDispositions(opts: {
  periodStart: string;
  /** EXCLUSIVE, per BILLING-POLICY §1.1. */
  periodEnd:   string;
}): Promise<{
  periodStart: string; periodEnd: string;
  customers: CustomerDisposition[];
  summary: Record<DispositionStage | 'total' | 'invoiced', number>;
  generatedAt: string;
}> {
  const from = `${opts.periodStart}T00:00:00Z`;
  const to   = `${opts.periodEnd}T00:00:00Z`;

  const rows: any = await db.execute(sql`
    WITH repo AS (
      SELECT i_account,
             count(*)::int                              AS calls,
             coalesce(sum(coalesce(cost,0)::numeric),0) AS amount
        FROM raw_sippy_cdrs
       WHERE started_at >= ${from}::timestamptz
         AND started_at <  ${to}::timestamptz
         AND i_account IS NOT NULL
       GROUP BY i_account
    ), inv AS (
      SELECT lower(trim(customer_name)) AS cname, count(*)::int AS n
        FROM invoices
       WHERE period_start = ${opts.periodStart}
         AND status <> 'void'
       GROUP BY lower(trim(customer_name))
    )
    SELECT c.id, c.name, c.sippy_i_account, c.sippy_i_tariff, c.client_billing_cycle,
           coalesce(r.calls, 0) AS calls, coalesce(r.amount, 0) AS amount,
           coalesce(i.n, 0)     AS invoices
      FROM companies c
      LEFT JOIN repo r ON r.i_account = c.sippy_i_account
      LEFT JOIN inv  i ON i.cname     = lower(trim(c.name))
     ORDER BY coalesce(r.amount, 0) DESC, c.name
  `);

  const customers: CustomerDisposition[] = (((rows.rows ?? []) as any[])).map(r => {
    const iAccount = r.sippy_i_account == null ? null : Number(r.sippy_i_account);
    const iTariff  = r.sippy_i_tariff == null || String(r.sippy_i_tariff) === ''
      ? null : String(r.sippy_i_tariff);
    const calls  = n(r.calls);
    const amount = n(r.amount);

    // The order matters: report the FIRST gate a customer fails, not the last.
    // "not collected" on an account that has no tariff sends an operator to
    // look at the importer, when the fix is one column in this very row.
    let stage: DispositionStage;
    let reason: string;
    if (iAccount == null) {
      stage = 'no_sippy_account';
      reason = 'Not linked to a Sippy account. Nothing can be collected or invoiced for this company.';
    } else if (iTariff == null) {
      stage = 'no_tariff';
      reason = `Sippy account ${iAccount} has no tariff mapping, so the collector excludes it before ` +
               'any CDRs are fetched (routes.ts _accountsForCollection). Link a tariff — the mapping ' +
               'sync at POST /api/sippy/commercial-mappings/preview reads it from Sippy.';
    } else if (calls === 0) {
      stage = 'not_collected';
      reason = `Collectible (account ${iAccount}, tariff ${iTariff}) but no CDRs are in the repository ` +
               'for this period. Either the account genuinely had no traffic, or the import has not run ' +
               'for these days — the two are different and the seed-job ledger distinguishes them.';
    } else {
      stage = 'collected';
      reason = '';
    }

    return {
      companyId: Number(r.id), name: String(r.name),
      iAccount, iTariff, billingCycle: r.client_billing_cycle ?? null,
      stage, collectible: iAccount != null && iTariff != null,
      calls, amount: Math.round(amount * 1e6) / 1e6, invoices: n(r.invoices),
      reason,
    };
  });

  const summary = {
    total: customers.length,
    no_sippy_account: customers.filter(c => c.stage === 'no_sippy_account').length,
    no_tariff:        customers.filter(c => c.stage === 'no_tariff').length,
    not_collected:    customers.filter(c => c.stage === 'not_collected').length,
    collected:        customers.filter(c => c.stage === 'collected').length,
    invoiced:         customers.filter(c => c.invoices > 0).length,
  };

  return { periodStart: opts.periodStart, periodEnd: opts.periodEnd, customers, summary,
           generatedAt: new Date().toISOString() };
}
