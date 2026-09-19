/**
 * The database half of operation-row reconciliation: load the rows a stale job left behind, and
 * write what the read-back established — one conditional statement per row, then the parent from
 * the rows. Same `OperationQueryable` surface as operation-store.ts, so this is proven against
 * real Postgres (PGlite) with the real migrations and no switch.
 *
 * CONDITIONAL, ROW BY ROW. A running row is only ever moved by `WHERE status = 'running'`, a pending
 * row only by `WHERE status = 'pending'`, and the parent only while it is still non-terminal. Two
 * Autoscale instances reconciling the same job converge: the first write lands, the second matches
 * zero rows. Nothing here reads the switch, and nothing here can push.
 */
import { sql } from 'drizzle-orm';
import { deriveJobStatus, type OperationQueryable } from './operation-store';
import { OPERATION_RECONCILE_STATE, type OperationRow, type OperationVerdict } from './reconcile-core';

const rows = (r: any): any[] => (Array.isArray(r) ? r : (r?.rows ?? []));

/** Every operation row of the given jobs, keyed by job. Jobs with no rows are absent from the map. */
export async function loadOperationRows(db: OperationQueryable, jobIds: ReadonlyArray<string>): Promise<Map<string, OperationRow[]>> {
  const out = new Map<string, OperationRow[]>();
  if (jobIds.length === 0) return out;
  const list = sql.join(jobIds.map(id => sql`${id}`), sql`, `);
  const raw = rows(await db.execute(sql`
    SELECT job_id, operation_key, i_tariff, full_prefix, requested_rate, status
      FROM rate_push_operations
     WHERE job_id IN (${list})
     ORDER BY job_id, sequence`));
  for (const r of raw) {
    const jobId = String(r.job_id);
    const rate = r.requested_rate === null || r.requested_rate === undefined ? null : Number(r.requested_rate);
    const row: OperationRow = {
      operationKey: String(r.operation_key),
      iTariff: r.i_tariff === null || r.i_tariff === undefined ? null : Number(r.i_tariff),
      fullPrefix: r.full_prefix === null || r.full_prefix === undefined ? null : String(r.full_prefix),
      requestedRate: rate !== null && Number.isFinite(rate) ? rate : null,
      status: String(r.status),
    };
    const list = out.get(jobId);
    if (list) list.push(row); else out.set(jobId, [row]);
  }
  return out;
}

export interface OperationOutcome {
  verdicts: ReadonlyArray<OperationVerdict>;
  /** Pending rows: never handed to a push, so nothing was sent for them. */
  notAttempted: ReadonlyArray<string>;
}

/** How the parent is stamped from the status its rows derive. */
export const JOB_STATE_FROM_ROWS: Record<string, { verificationResult: string }> = {
  completed:    { verificationResult: 'reconciled_confirmed' },
  failed:       { verificationResult: 'reconciled_absent' },
  partial:      { verificationResult: 'reconciled_partial' },
  needs_review: { verificationResult: 'reconciled_indeterminate' },
};

/**
 * Write the outcome. Returns the parent status derived from the rows AFTER the writes, and how
 * many row statements actually matched — a second concurrent boot sees zeros.
 */
export async function writeOperationOutcome(
  db: OperationQueryable,
  jobId: string,
  outcome: OperationOutcome,
): Promise<{ jobStatus: string; rowsWritten: number; jobWritten: boolean }> {
  let written = 0;

  for (const v of outcome.verdicts) {
    const state = OPERATION_RECONCILE_STATE[v.verdict];
    const r = rows(await db.execute(sql`
      UPDATE rate_push_operations
         SET status              = ${state.status},
             verification_result = ${state.verificationResult},
             completed_at        = NOW(),
             message             = COALESCE(message || ' ', '') ||
                                   ${`[reconcile] boot read-back: ${v.verdict}. The run was interrupted while this operation was in flight; the tariff was read back and this is what it holds. Nothing was re-sent.`}
       WHERE job_id = ${jobId} AND operation_key = ${v.operationKey} AND status = 'running'
       RETURNING operation_key`));
    written += r.length;
  }

  for (const key of outcome.notAttempted) {
    const r = rows(await db.execute(sql`
      UPDATE rate_push_operations
         SET status               = 'not_attempted',
             refused_before_write = TRUE,
             completed_at         = NOW(),
             message              = COALESCE(message || ' ', '') ||
                                    '[reconcile] Not attempted: the process restarted before this operation was started, so nothing was sent for it. It was not retried.'
       WHERE job_id = ${jobId} AND operation_key = ${key} AND status = 'pending'
       RETURNING operation_key`));
    written += r.length;
  }

  // The parent from the rows, never from a counter — and only while it is still non-terminal.
  const summary = await deriveJobStatus(db, jobId);
  const state = JOB_STATE_FROM_ROWS[summary.status];
  let jobWritten = false;
  if (state) {
    const r = rows(await db.execute(sql`
      UPDATE rate_push_jobs
         SET status              = ${summary.status},
             verification_result = ${state.verificationResult},
             completed_at        = NOW(),
             error_message       = ${`boot reconciliation from operation rows: ${summary.counts.succeeded} succeeded, ${summary.counts.failed} failed, ${summary.counts.indeterminate} indeterminate, ${summary.counts.not_attempted} not attempted (in-flight rows verified by read-back; nothing re-sent)`}
       WHERE job_id = ${jobId} AND status IN ('pending', 'processing')
       RETURNING job_id`));
    jobWritten = r.length > 0;
  }
  return { jobStatus: summary.status, rowsWritten: written, jobWritten };
}
