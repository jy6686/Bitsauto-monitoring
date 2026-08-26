/**
 * cdr-completeness.service.ts
 *
 * Counts one account's calls at each stage of ingestion for one period, so the
 * question "did we import everything?" is answered by measurement rather than
 * by reading server logs after the fact.
 *
 * Read-only. Touches nothing.
 *
 * ── Two things worth knowing before reading the numbers ──────────────────────
 *
 * 1. Stages 2 and 3 are counted THROUGH the repository, joined on the cdr id.
 *    The seeder deliberately continues when the repository write fails ("a
 *    storage failure does NOT stop billing"), so verifications and snapshots
 *    can outlive their evidence. When that has happened the repository stage
 *    reads low and the loss is attributed to sippy_reference → repository,
 *    which is the correct place: the evidence is missing, whatever else
 *    survived.
 *
 * 2. The Sippy reference is supplied by the caller, not fetched. The adapter
 *    that will fetch it is specified in BILLING-RECONCILIATION-CONTRACT.md §3
 *    and not built; until it is, an operator reads the two figures off the
 *    Customer Summary. Omitting them yields `no_reference` rather than a pass —
 *    a pipeline agreeing with itself proves nothing about what it never saw.
 *
 * Money is summed as `numeric`, never `real`. Postgres sums `real` in `real`,
 * and at this customer's scale that measured $3.55 of error over 1.65M rows.
 * See BILLING-RECONCILIATION-CONTRACT.md §10.
 */

import { sql } from 'drizzle-orm';
import { db } from '../../db';
import {
  assessCompleteness,
  type CompletenessVerdict,
  type IdentityCollision,
  type StageCount,
} from '../../cdr-completeness';

export interface CompletenessQuery {
  iAccount: number;
  /** Inclusive, YYYY-MM-DD at 00:00 UTC. */
  from: string;
  /** EXCLUSIVE, YYYY-MM-DD at 00:00 UTC — per BILLING-POLICY.md §1.1. */
  to: string;
  /** Sippy's billed minutes for the period, if the operator has them. */
  referenceMinutes?: number | null;
  /** Sippy's call count. Attempts — carried for information only. */
  referenceCalls?: number | null;
  /** Sippy's charged amount for the period. Its "Charged Amount", not "Cost". */
  referenceCost?: number | null;
  tolerancePct?: number;
}

export interface CompletenessReport {
  account: number;
  period: { from: string; to: string; convention: '[from, to)' };
  repository: {
    calls: number;
    billedMinutes: number;
    cost: number;
    distinctCallIds: number;
    distinctICdr: number;
    importRuns: number;
    firstCall: string | null;
    lastCall: string | null;
  };
  verified:    { calls: number; billedMinutes: number; sippyCost: number; ourCost: number };
  snapshotted: { calls: number; billedMinutes: number; actualCost: number };
  verdict: CompletenessVerdict;
}

const num = (v: any): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export async function measureCompleteness(
  q: CompletenessQuery,
): Promise<CompletenessReport> {
  const from = `${q.from}T00:00:00Z`;
  const to   = `${q.to}T00:00:00Z`;

  const [repoRes, verRes, snapRes] = await Promise.all([
    db.execute(sql`
      SELECT count(*)::int                                   AS calls,
             coalesce(sum(billed_secs), 0)::numeric / 60.0   AS billed_minutes,
             coalesce(sum(cost::numeric), 0)                 AS cost,
             count(DISTINCT cdr_call_id)::int                AS distinct_call_ids,
             count(DISTINCT i_cdr)::int                      AS distinct_i_cdr,
             count(DISTINCT import_run_id)::int              AS import_runs,
             min(started_at)                                 AS first_call,
             max(started_at)                                 AS last_call
        FROM raw_sippy_cdrs
       WHERE i_account = ${q.iAccount}
         AND started_at >= ${from}::timestamptz
         AND started_at <  ${to}::timestamptz`),

    // EXISTS, not JOIN — deliberately, and this is load-bearing.
    //
    // Call ids repeat in the repository (that is the leading explanation for
    // the loss this endpoint measures). A join on the id fans out: one
    // verification matching four repository rows counts four times. Measured on
    // a fixture of 1,000 verifications against 4,000 repository rows sharing
    // 1,000 ids, the join returned 4,000 verified and 4x the cost — reporting
    // NO loss precisely in the case the endpoint exists to detect. EXISTS
    // counts each row once however many repository rows share its id.
    db.execute(sql`
      SELECT count(*)::int                                       AS calls,
             coalesce(sum(v.billed_secs), 0)::numeric / 60.0     AS billed_minutes,
             coalesce(sum(v.sippy_actual_cost::numeric), 0)      AS sippy_cost,
             coalesce(sum(v.reproduced_cost::numeric), 0)        AS our_cost
        FROM rating_verifications v
       WHERE EXISTS (
         SELECT 1 FROM raw_sippy_cdrs r
          WHERE coalesce(r.cdr_call_id, r.i_cdr) = v.cdr_call_id
            AND r.i_account = ${q.iAccount}
            AND r.started_at >= ${from}::timestamptz
            AND r.started_at <  ${to}::timestamptz)`),

    db.execute(sql`
      SELECT count(*)::int                                       AS calls,
             coalesce(sum(s.duration_secs), 0)::numeric / 60.0   AS billed_minutes,
             coalesce(sum(s.actual_cost::numeric), 0)            AS actual_cost
        FROM invoice_cdr_snapshots s
       WHERE EXISTS (
         SELECT 1 FROM raw_sippy_cdrs r
          WHERE coalesce(r.cdr_call_id, r.i_cdr) = s.cdr_id
            AND r.i_account = ${q.iAccount}
            AND r.started_at >= ${from}::timestamptz
            AND r.started_at <  ${to}::timestamptz)`),
  ]);

  const repo = ((repoRes as any).rows ?? [])[0] ?? {};
  const ver  = ((verRes  as any).rows ?? [])[0] ?? {};
  const snap = ((snapRes as any).rows ?? [])[0] ?? {};

  const repository = {
    calls:           num(repo.calls),
    billedMinutes:   +num(repo.billed_minutes).toFixed(4),
    cost:            +num(repo.cost).toFixed(6),
    distinctCallIds: num(repo.distinct_call_ids),
    distinctICdr:    num(repo.distinct_i_cdr),
    importRuns:      num(repo.import_runs),
    firstCall:       repo.first_call ? new Date(repo.first_call).toISOString() : null,
    lastCall:        repo.last_call  ? new Date(repo.last_call).toISOString()  : null,
  };
  const verified = {
    calls:         num(ver.calls),
    billedMinutes: +num(ver.billed_minutes).toFixed(4),
    sippyCost:     +num(ver.sippy_cost).toFixed(6),
    ourCost:       +num(ver.our_cost).toFixed(6),
  };
  const snapshotted = {
    calls:         num(snap.calls),
    billedMinutes: +num(snap.billed_minutes).toFixed(4),
    actualCost:    +num(snap.actual_cost).toFixed(6),
  };

  // Every stage's cost is the SWITCH's figure — repository.cost, the
  // verification's sippy_actual_cost, the snapshot's actual_cost. Never
  // `reproduced_cost`, which the rating engine currently over-reports by up to
  // 60x on tariffs whose intervals are not 60/60: a stage measured on it shows
  // a money GAIN while losing 99% of its calls, so the money check silently
  // stops working. `ourCost` is returned alongside for comparison, and is not
  // fed to the classifier.
  const stages: StageCount[] = [
    { stage: 'repository',  calls: repository.calls,  billedMinutes: repository.billedMinutes,  cost: repository.cost },
    { stage: 'verified',    calls: verified.calls,    billedMinutes: verified.billedMinutes,    cost: verified.sippyCost },
    { stage: 'snapshotted', calls: snapshotted.calls, billedMinutes: snapshotted.billedMinutes, cost: snapshotted.actualCost },
  ];
  if (q.referenceMinutes != null) {
    stages.unshift({
      stage: 'sippy_reference',
      calls: q.referenceCalls ?? null,
      billedMinutes: q.referenceMinutes,
      cost: q.referenceCost ?? null,
    });
  }

  // Repeated call ids predict the snapshot stage's skip, which is keyed on the
  // call id and bounded by tariff rather than by period.
  const identity: IdentityCollision | null = repository.calls > 0
    ? {
        rows:             repository.calls,
        distinctCallIds:  repository.distinctCallIds,
        duplicateCallIds: repository.calls - repository.distinctCallIds,
        duplicatePct: +(
          ((repository.calls - repository.distinctCallIds) / repository.calls) * 100
        ).toFixed(4),
      }
    : null;

  return {
    account: q.iAccount,
    period: { from: q.from, to: q.to, convention: '[from, to)' },
    repository,
    verified,
    snapshotted,
    verdict: assessCompleteness(stages, { tolerancePct: q.tolerancePct, identity }),
  };
}
