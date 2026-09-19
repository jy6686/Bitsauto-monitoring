/**
 * submit-guards.ts
 *
 * Decisions made BEFORE a push-batch job row exists — so a refusal is provably a non-event:
 * nothing was recorded, nothing was sent, the caller may simply try again later.
 *
 *   duplicate   the same submit (same clientRequestId) already produced a job. Answer with THAT
 *               job, whatever its status; never start a second one. On 2026-09-19 a double-fired
 *               Submit produced two batches 9 s apart on the same tariff; this is the rule that
 *               answers the second click with the first job.
 *
 *   in_flight   a non-terminal job on one of the target tariffs is younger than the stale floor.
 *               That is a live push; a second writer would queue behind the advisory lock and
 *               then write on top of it. Refuse, naming the job. A non-terminal job OLDER than the
 *               floor is not live — it is an orphan the boot sweep owns — and must not block
 *               submits forever, so it does not refuse.
 *
 * The floor is `RATE_JOB_STALE_MS` from reconcile-core, imported, never re-typed. The property
 * the tests hold: for any non-terminal job, guard-says-live ⇔ the sweep would NOT touch it.
 * Both sides use `isOrphanEligible` and `effectiveStaleClock`, so they cannot drift apart.
 *
 * Pure. The row reads are in job-lookup-store.ts; the route composes them.
 */
import { RATE_JOB_STALE_MS, NON_TERMINAL_STATUSES, isOrphanEligible, effectiveStaleClock } from './reconcile-core';

export const SUBMIT_IN_FLIGHT_FLOOR_MS = RATE_JOB_STALE_MS;

/** 8–64 URL-safe characters: a UUID, or any opaque id a client generates. Nothing else reaches SQL. */
const CLIENT_REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

export function isValidClientRequestId(v: unknown): v is string {
  return typeof v === 'string' && CLIENT_REQUEST_ID.test(v);
}

export interface LiveJob {
  jobId: string;
  status: string;
  iTariff: number | null;
  lastStepAt: Date | null;
  createdAt: Date;
}

export type SubmitDecision =
  | { kind: 'proceed' }
  | { kind: 'duplicate'; jobId: string; status: string }
  | { kind: 'in_flight'; jobId: string; iTariff: number; ageMs: number };

export interface SubmitGuardInput {
  clientRequestId: string | null;
  /** The job already recorded under this clientRequestId, if any. */
  existingByKey: { jobId: string; status: string } | null;
  /** Non-terminal jobs on the target tariffs (the store filters status and tariff; this re-checks). */
  liveJobs: ReadonlyArray<LiveJob>;
  targetTariffs: ReadonlyArray<number>;
  now: Date;
}

export function submitGuards(input: SubmitGuardInput): SubmitDecision {
  // Duplicate first: the honest answer to a repeated submit is the job it already produced, not a
  // refusal about some other job.
  if (input.clientRequestId && input.existingByKey) {
    return { kind: 'duplicate', jobId: input.existingByKey.jobId, status: input.existingByKey.status };
  }

  const targets = new Set(input.targetTariffs);
  if (targets.size === 0) return { kind: 'proceed' };

  let youngest: Extract<SubmitDecision, { kind: 'in_flight' }> | null = null;
  for (const job of input.liveJobs) {
    if (job.iTariff == null || !targets.has(job.iTariff)) continue;
    if (!(NON_TERMINAL_STATUSES as readonly string[]).includes(job.status)) continue;
    // Stale ⇒ the sweep's, not a live push. Exactly the sweep's own predicate, so the two agree.
    if (isOrphanEligible({ status: job.status, lastStepAt: job.lastStepAt, createdAt: job.createdAt }, input.now, SUBMIT_IN_FLIGHT_FLOOR_MS)) continue;
    const ageMs = input.now.getTime() - effectiveStaleClock({ status: job.status, lastStepAt: job.lastStepAt, createdAt: job.createdAt }).getTime();
    if (!youngest || ageMs < youngest.ageMs) youngest = { kind: 'in_flight', jobId: job.jobId, iTariff: job.iTariff, ageMs };
  }
  return youngest ?? { kind: 'proceed' };
}
