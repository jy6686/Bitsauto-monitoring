/**
 * A push job may only go terminal once every operation it owns has settled.
 *
 * THE INVARIANT:  terminal job  ⇒  zero pending operations for that job.
 *
 * Without it, one failed per-operation UPDATE produces a job row that says `completed` over
 * operations still marked `pending` — and that combination is invisible to recovery, because
 * boot reconciliation only examines jobs in a NON-terminal status (`reconcile-boot.ts`:
 * `inArray(ratePushJobs.status, ['pending', 'processing'])`). The audit record would be
 * permanently wrong rather than merely incomplete, which is the worse of the two failures:
 *
 *     Sippy mutated · operation UPDATE failed · job = completed   → nothing ever looks again
 *     Sippy mutated · operation UPDATE failed · job = pending     → reconciliation sees it
 *
 * The second is what this produces. A job that cannot be shown to be settled simply stays where
 * recovery can find it, which is the mechanism the system already has rather than a new one.
 *
 * Deliberately NOT the alternative — having the job's terminal write settle its own leftovers.
 * That would stamp an operation terminal without knowing whether its own per-prefix update ever
 * persisted, inventing an outcome to tidy a row. An unsettled operation is a real fact about a
 * push, and the record should keep saying so until someone establishes what happened.
 */
import { sql } from 'drizzle-orm';

/**
 * SQL predicate: this job has no operation still pending.
 *
 * Exported so the route and its test use the SAME predicate — a test that re-wrote this SQL
 * would only be proving that a copy of it behaves as the copy says.
 *
 * NOTE ON THE EMPTY CASE: a job with no operation rows at all also satisfies this, because
 * nothing is pending. That is not sufficient on its own, so the caller pairs it with in-process
 * knowledge of whether the operation rows were actually recorded — see `change-client-rates`.
 */
export const noPendingOperations = (jobId: string) =>
  sql`NOT EXISTS (
        SELECT 1 FROM rate_push_operations o
         WHERE o.job_id = ${jobId}
           AND o.status = 'pending')`;
