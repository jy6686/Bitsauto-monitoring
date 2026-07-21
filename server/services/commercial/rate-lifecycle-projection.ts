/**
 * Rate Lifecycle Projection  (D1.1)
 * ===================================
 * The ONLY component authorised to update rate_notification_jobs.status.
 *
 * Governance rule (permanent):
 *   Business modules must never update rate_notification_jobs.status directly.
 *   All lifecycle state changes MUST go through this module, called from
 *   within the execution engine's projectFn callback.
 *
 * Today this updates:
 *   • rate_notification_jobs.status
 *
 * Tomorrow it may also update (without changing the execution engine):
 *   • dashboard counters
 *   • notification queues
 *   • materialized views
 *   • analytics projections
 *
 * Usage (always called from executeWorkflowAction's projectFn):
 *
 *   await executeWorkflowAction(opts, async (client) =>
 *     projectRateLifecycle(jobId, 'approved', client)
 *   );
 */

import { pool } from '../../db';
import type { PoolClient } from 'pg';
import { RATE_LIFECYCLE_TERMINAL } from './event-taxonomy';

// ── Projection function ───────────────────────────────────────────────────────

/**
 * Update the rate job's lifecycle projection.
 *
 * @param jobId   The rate_notification_jobs.id primary key
 * @param state   The new lifecycle state string
 * @param client  Optional pool client — MUST be provided when called inside a
 *                transaction (i.e. from executeWorkflowAction's projectFn).
 *                When omitted, uses the pool directly (recovery path only).
 */
export async function projectRateLifecycle(
  jobId:   number,
  state:   string,
  client?: PoolClient
): Promise<void> {
  const exec = client ?? pool;

  await exec.query(
    `UPDATE rate_notification_jobs
     SET    status = $1
     WHERE  id     = $2`,
    [state, jobId]
  );

  // Future projection hooks go here.
  // Each can use the same `exec` (client or pool) to stay in the same txn.
  //
  // Example (when dashboard counters are added):
  //   await exec.query(`UPDATE rate_lifecycle_counters SET ... WHERE ...`);
  //
  // Example (when notification queue is added):
  //   if (state === 'approved') await enqueueActivationNotification(jobId, exec);
}

// ── Recovery / Repair ─────────────────────────────────────────────────────────

/**
 * Repair a single job's projection by reading its derived state from the
 * event stream and applying it via projectRateLifecycle().
 *
 * This is an ADMINISTRATIVE function — not part of normal runtime.
 * Call it when workflow_events and rate_notification_jobs.status disagree.
 */
export async function repairRateProjection(
  jobId:        number,
  derivedState: string
): Promise<{ repaired: boolean; newState: string }> {
  // Refuse to apply an unknown state
  const knownStates = new Set([
    'pending_rates', 'awaiting_approval', 'approved',
    'rejected', 'activated', 'verification_passed',
    'verification_failed', 'complete', 'dismissed',
  ]);

  if (!knownStates.has(derivedState)) {
    throw new Error(
      `repairRateProjection: unknown state "${derivedState}" for job ${jobId}`
    );
  }

  await projectRateLifecycle(jobId, derivedState);
  return { repaired: true, newState: derivedState };
}

/**
 * Fetch the current projected state for a job (from the DB, not the event stream).
 * Used to determine the `from` state before calling validateRateTransition().
 */
export async function getRateProjectedState(jobId: number): Promise<string | null> {
  const res = await pool.query<{ status: string }>(
    `SELECT status FROM rate_notification_jobs WHERE id = $1`,
    [jobId]
  );
  return res.rows[0]?.status ?? null;
}

/**
 * Returns true if the job is in a terminal state (complete or dismissed).
 * Terminal jobs cannot transition further.
 */
export async function isRateJobTerminal(jobId: number): Promise<boolean> {
  const state = await getRateProjectedState(jobId);
  return state !== null && RATE_LIFECYCLE_TERMINAL.has(state);
}
