/**
 * reconciliation-report.service.ts — the investigable form of the gate.
 *
 * The gate in _runBillingChain answers one question for one customer: may this
 * invoice be generated. That is the correct scope for a gate and the wrong
 * scope for an investigation. A refusal that says only FAIL sends an operator
 * to find the figures by hand — which, on 2026-08-31, took a day of tracing
 * through five surfaces to reach a single NULL column.
 *
 * So this reports the same comparison at full width: which days have a
 * reference, which accounts agree, and for those that do not, both figures and
 * the difference. Same modules as the gate (dmrReferenceFor, reconcileAccounts)
 * so the report and the refusal can never disagree — a diagnostic that
 * contradicts the gate it explains is worse than none.
 *
 * IDENTITY IS NOT ASSUMED. The platform side is keyed by i_account and named
 * from companies. Account 76 is claimed by BOTH `Internal-ptcl` (id 2) and
 * `ptcl` (id 32) in production, so a naive join emits that account's money
 * TWICE, once under each name, and inflates the platform total against the
 * reference. Shared accounts are therefore reported as unattributable and
 * their money is held in its own bucket rather than being attributed to a
 * customer that may not own it, or silently dropped.
 *
 * Read-only.
 */
import { db } from '../../db';
import { sql } from 'drizzle-orm';
import { dmrReferenceFor } from './dmr-reference.service';
import { reconcileAccounts, type AccountFigures, type AccountReconResult } from '../../account-reconciliation';
import type { ReferenceCoverage } from '../../reference-coverage';

export interface IdentityWarning {
  iAccount:  number;
  claimants: string[];
  amount:    number;
  calls:     number;
  reason:    string;
}

export interface ReconciliationReport {
  periodStart: string;
  periodEnd:   string;
  convention:  string;
  /** Per-day ✓/✗ — the first thing to look at when the outcome is unavailable. */
  referenceCoverage: ReferenceCoverage;
  referenceSource:   string;
  /** null when the reference was refused; `recon` is then REFERENCE_UNAVAILABLE. */
  recon:             AccountReconResult;
  /** Accounts whose traffic cannot be attributed to one customer. */
  identityWarnings:  IdentityWarning[];
  /** Money on shared accounts, excluded from the platform total above. */
  unattributableAmount: number;
  generatedAt: string;
}

const n = (v: any) => (v == null ? 0 : Number(v));

export async function reconciliationReport(opts: {
  periodStart: string;
  periodEnd:   string;
}): Promise<ReconciliationReport> {
  const ref = await dmrReferenceFor(opts);

  // Platform side, computed from raw_sippy_cdrs and nothing else — never the
  // DMR's platform_* columns, which would make this a self-comparison.
  // ::numeric before SUM: `cost` is REAL and an uncast sum loses small addends
  // into a growing total against a one-cent tolerance.
  const rows: any = await db.execute(sql`
    WITH agg AS (
      SELECT i_account,
             count(*)::int                                        AS calls,
             coalesce(sum(coalesce(billed_secs, 0)::numeric), 0)  AS billed_sec,
             coalesce(sum(coalesce(cost, 0)::numeric), 0)         AS amount
        FROM raw_sippy_cdrs
       WHERE started_at >= ${`${opts.periodStart}T00:00:00Z`}::timestamptz
         AND started_at <  ${`${opts.periodEnd}T00:00:00Z`}::timestamptz
         AND i_account IS NOT NULL
       GROUP BY i_account
    )
    SELECT a.i_account, a.calls, a.billed_sec, a.amount,
           coalesce(array_agg(c.name ORDER BY c.name)
                    FILTER (WHERE c.name IS NOT NULL), '{}') AS claimants
      FROM agg a
      LEFT JOIN companies c ON c.sippy_i_account = a.i_account
     GROUP BY a.i_account, a.calls, a.billed_sec, a.amount
     ORDER BY a.amount DESC
  `);

  const platform: AccountFigures[] = [];
  const identityWarnings: IdentityWarning[] = [];
  let unattributableAmount = 0;

  for (const r of ((rows.rows ?? []) as any[])) {
    const iAccount  = Number(r.i_account);
    const claimants = ((r.claimants ?? []) as any[]).map(String);
    const figures   = {
      calls:   n(r.calls),
      minutes: Math.round((n(r.billed_sec) / 60) * 1e6) / 1e6,
      amount:  Math.round(n(r.amount) * 1e6) / 1e6,
    };

    if (claimants.length === 1) {
      platform.push({ name: claimants[0], ...figures });
      continue;
    }

    // Zero claimants: collected traffic on an account no company owns. One
    // claimant is the normal case above. More than one means the money cannot
    // be attributed — emitting it under either name would assert an ownership
    // the platform cannot support.
    unattributableAmount = Math.round((unattributableAmount + figures.amount) * 1e6) / 1e6;
    identityWarnings.push({
      iAccount, claimants, amount: figures.amount, calls: figures.calls,
      reason: claimants.length === 0
        ? `Account ${iAccount} has collected traffic but no company is linked to it, so its ` +
          'money cannot be attributed to a customer. Link the account, or confirm it is not billable.'
        : `Account ${iAccount} is claimed by ${claimants.length} companies (${claimants.join(', ')}). ` +
          'Attributing its traffic to either would assert an ownership the platform cannot support, ' +
          'so it is excluded from the comparison and reported here instead. Settle the ownership first.',
    });
  }

  const recon = reconcileAccounts({
    reference:   ref.accounts,   // null ⇒ REFERENCE_UNAVAILABLE, handled inside
    platform,
    periodLabel: `${opts.periodStart} → ${opts.periodEnd}`,
  });

  return {
    periodStart: opts.periodStart,
    periodEnd:   opts.periodEnd,
    convention:  '[periodStart, periodEnd) UTC',
    referenceCoverage: ref.coverage,
    referenceSource:   ref.source,
    recon,
    identityWarnings,
    unattributableAmount,
    generatedAt: new Date().toISOString(),
  };
}
