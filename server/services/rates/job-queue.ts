/**
 * job-queue.ts — the queue a submission becomes, before any worker touches Sippy.
 *
 * WHY A QUEUE AT ALL. `push-batch` is synchronous: the HTTP request stays open for the whole
 * push. On 2026-09-19 the gateway returned 504 while the server was still pushing, the operator's
 * Submit re-enabled, and a second click produced a second batch nine seconds behind the first.
 * Migration 525's `client_request_id` exists to make that survivable; a queue is what makes it
 * stop happening. A hundred-client submission cannot complete inside one request at all.
 *
 * THE STATUS WORD IS ADDITIVE, AND THAT IS DELIBERATE. `queued` joins the job vocabulary that
 * already exists — pending · processing · needs_review · completed · partial · failed — it does
 * not replace it. The operation layer's words (running, succeeded, indeterminate) look similar
 * and are NOT the same vocabulary; adopting them here would have renamed live job statuses,
 * broken the reconcile guard and the Push History filter, and lost `needs_review`, whose ranking
 * exists so an outcome nobody established is never averaged into `partial`.
 *
 * `deriveJobStatus` is untouched by this file. It computes from operation rows, and a queued job
 * has none — so a job stays `queued` until a worker claims it, and from then on the existing
 * derivation owns its status exactly as it does today.
 */
import { sql } from 'drizzle-orm';

/** The pre-claim state. A row exists, the work is owed, no worker has taken it. */
export const QUEUED = 'queued' as const;

/**
 * Job states that mean "this job is not finished". `queued` joins the two that were already here.
 *
 * Every guard that asked `status IN ('pending','processing')` was asking this question, and each
 * one must be reviewed against this list rather than re-typing the pair — a queued job that a
 * reconciliation sweep does not recognise as non-terminal is a job nothing will ever resume.
 */
export const NON_TERMINAL_JOB_STATES = [QUEUED, 'pending', 'processing'] as const;

/** Minimal query surface, matching the other modules in this folder. */
export interface QueueQueryable {
  execute(query: any): Promise<any>;
}

const rows = (res: any): any[] => (Array.isArray(res) ? res : (res?.rows ?? []));

/**
 * One account per job, whatever the submission said.
 *
 * A hundred-client list with the same account twice is an operator slip, not an intent to push
 * twice — and two sibling jobs for one account cannot be reported or retried independently
 * without ambiguity about which one represents that customer. Deduplicated HERE, at submission,
 * so `(request_id, account)` is unique by construction rather than by a constraint that fires
 * after the fact.
 *
 * Order is preserved and the FIRST occurrence wins, so the queue reflects the order the operator
 * actually typed. Comparison is exact: account names are identifiers from Sippy, and folding case
 * here would silently merge two accounts the switch considers distinct.
 */
export function dedupeAccounts(accounts: readonly string[] | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of accounts ?? []) {
    const name = String(raw ?? '').trim();
    if (!name) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/** How many jobs are already claimed and not yet finished, across every instance. */
export async function countActiveJobs(db: QueueQueryable): Promise<number> {
  const [row] = rows(await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM rate_push_jobs
     WHERE status IN ('pending', 'processing')`));
  return Number(row?.n ?? 0);
}

export interface ClaimedJob {
  jobId: string;
  requestId: string | null;
}

/**
 * Take the oldest queued job, if the platform has capacity for another.
 *
 * `FOR UPDATE SKIP LOCKED` is what makes this safe to call from more than one worker: a row being
 * claimed elsewhere is stepped over rather than waited on, so two workers never take the same job
 * and neither blocks the other. The claim is one statement, so a worker that dies mid-claim
 * leaves the row queued rather than half-taken.
 *
 * The concurrency cap is read from the TABLE, not held in a process, because Autoscale may run
 * more than one instance and a per-process semaphore would multiply the limit by the instance
 * count without anyone noticing.
 *
 * HONEST LIMIT: the cap is best-effort under simultaneous claims. The row lock guarantees no job
 * is claimed twice, but the count is taken at each caller's snapshot, so N workers claiming in
 * the same instant can overshoot by up to N-1. Making it exact needs a transaction-scoped
 * advisory lock around the count and the claim together, which needs a DB surface that can hold a
 * transaction across statements — this module deliberately keeps the one-statement surface the
 * rest of the folder uses. Overshoot costs a little extra Sippy concurrency; it never
 * double-claims work, which is the property that would corrupt the ledger.
 */
export async function claimNextQueuedJob(
  db: QueueQueryable,
  opts: { maxConcurrent: number },
): Promise<ClaimedJob | null> {
  const max = Number(opts?.maxConcurrent);
  // A cap of zero or less means "claim nothing". Treated as a deliberate pause rather than an
  // error, so a caller can stop the queue without tearing anything down.
  if (!Number.isFinite(max) || max <= 0) return null;

  const claimed = rows(await db.execute(sql`
    UPDATE rate_push_jobs
       SET status = 'pending', started_at = NOW()
     WHERE job_id = (
             SELECT job_id FROM rate_push_jobs
              WHERE status = ${QUEUED}
                AND (SELECT COUNT(*) FROM rate_push_jobs
                      WHERE status IN ('pending', 'processing')) < ${max}
              ORDER BY id
              FOR UPDATE SKIP LOCKED
              LIMIT 1)
    RETURNING job_id, request_id`));

  if (claimed.length === 0) return null;
  return {
    jobId: String(claimed[0].job_id),
    requestId: claimed[0].request_id ?? null,
  };
}

/**
 * Whether every job of a submission has finished.
 *
 * The response to an async submit returns immediately, so the operator's screen polls the REQUEST
 * rather than a job. A request is terminal only when no sibling is still queued, claimed or
 * running — reporting it done while one account is mid-push would tell an operator the work is
 * over while a customer's rates are still being written.
 */
export async function requestIsTerminal(db: QueueQueryable, requestId: string): Promise<boolean> {
  const [row] = rows(await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM rate_push_jobs
     WHERE request_id = ${requestId}
       AND status IN ('queued', 'pending', 'processing')`));
  return Number(row?.n ?? 0) === 0;
}
