/**
 * request-status.ts — the status of a SUBMISSION, now that a submission is more than one job.
 *
 * WHY THIS EXISTS AT ALL. The operator's Submit button is unlocked by a status. Until now one
 * submission was one job row, so "the job is terminal" and "the submission is over" were the same
 * sentence. Splitting by account makes them different sentences, and believing the old one would
 * re-enable Submit while another customer's rates were still being written — the precise condition
 * that produced the 2026-09-19 double-submit. So the roll-up is written down once, here, rather
 * than being re-derived at each screen that happens to need it.
 *
 * TWO LAYERS, AND THE ORDER MATTERS.
 *   1. THE JOB ROWS decide whether the submission is finished. A sibling that is queued, pending or
 *      processing has work owed, and no reading of operation rows can overrule that — a job nobody
 *      has started yet has NO operation rows, so an operations-only roll-up would see a finished
 *      first account, count zero rows for the rest, and report the whole submission complete.
 *   2. ONLY THEN do the siblings' own statuses combine, by the ranking `deriveJobStatus` already
 *      uses one level down: `needs_review` outranks everything, because an outcome nobody
 *      established must never be averaged into `partial`.
 *
 * `rankRequestStatus` is pure and is where that rule lives; the database function below is a thin
 * read around it. Nothing here writes.
 */
import { sql } from 'drizzle-orm';
import { NON_TERMINAL_JOB_STATES } from './job-queue';

/** The job vocabulary, unchanged and unrenamed. `queued` joined it; nothing left it. */
export type RequestStatus =
  | 'pending' | 'processing' | 'needs_review' | 'completed' | 'partial' | 'failed';

export interface QueryableDb {
  execute(query: any): Promise<any>;
}

const rows = (res: any): any[] => (Array.isArray(res) ? res : (res?.rows ?? []));

const isNonTerminal = (status: string): boolean =>
  (NON_TERMINAL_JOB_STATES as readonly string[]).includes(status);

/**
 * One status for a whole submission, from its siblings' statuses.
 *
 * Deliberately mirrors `deriveJobStatus`'s ranking rather than inventing a second one:
 *
 *   nothing yet        → pending        (no sibling has been recorded)
 *   any work owed      → processing     (queued · pending · processing — see the note above)
 *   any needs_review   → needs_review   (a person must look; never averaged away)
 *   every one complete → completed
 *   any progress       → partial
 *   otherwise          → failed
 *
 * An unrecognised status is treated as owed work, not as success: a word this function does not
 * know is a word it cannot certify as finished.
 */
export function rankRequestStatus(statuses: readonly string[]): RequestStatus {
  const list = (statuses ?? []).map(s => String(s ?? '').trim()).filter(Boolean);
  if (list.length === 0) return 'pending';

  const known: readonly string[] = ['needs_review', 'completed', 'partial', 'failed'];
  if (list.some(s => isNonTerminal(s) || !known.includes(s))) return 'processing';
  if (list.includes('needs_review')) return 'needs_review';
  if (list.every(s => s === 'completed')) return 'completed';
  if (list.some(s => s === 'completed' || s === 'partial')) return 'partial';
  return 'failed';
}

export interface RequestSibling {
  jobId: string;
  /** The single account this job pushes. `client_names` holds exactly one name after the split. */
  accountName: string | null;
  status: string;
  totalClients: number;
  pushedClients: number;
  failedClients: number;
}

export interface RequestSummary {
  requestId: string;
  /** No sibling owes work. The same question `requestIsTerminal` answers, kept beside the status. */
  terminal: boolean;
  status: RequestStatus;
  jobs: RequestSibling[];
  /** Operation totals summed across siblings, so one number describes the whole submission. */
  counts: { total: number; pushed: number; failed: number };
}

/**
 * The operation evidence of a whole submission, in `deriveJobStatus`'s counts shape.
 *
 * Counts ONLY — deliberately no status. A submission's status comes from its JOB rows, because a
 * sibling nobody has started has no operation rows at all and would otherwise be invisible here.
 * Read the two together: the jobs say whether it is over, the operations say what happened.
 */
export async function deriveRequestOperations(db: QueryableDb, requestId: string): Promise<{
  counts: { pending: number; running: number; succeeded: number; failed: number;
            indeterminate: number; not_attempted: number; total: number };
  tariffsNeedingReview: number[];
  unresolvedCount: number;
}> {
  const counted = rows(await db.execute(sql`
    SELECT o.status, COUNT(*)::int AS n
      FROM rate_push_operations o
      JOIN rate_push_jobs j ON j.job_id = o.job_id
     WHERE j.request_id = ${requestId}
     GROUP BY o.status`));

  const counts = { pending: 0, running: 0, succeeded: 0, failed: 0,
                   indeterminate: 0, not_attempted: 0, total: 0 };
  for (const r of counted) {
    const key = String(r.status);
    const n = Number(r.n ?? 0);
    if (key in counts) (counts as any)[key] = n;
    counts.total += n;
  }

  // Same filter as `deriveJobStatus`: an operation an operator has already settled no longer
  // needs review, even though `status` still records what historically happened.
  const unknown = rows(await db.execute(sql`
    SELECT DISTINCT o.i_tariff
      FROM rate_push_operations o
      JOIN rate_push_jobs j ON j.job_id = o.job_id
     WHERE j.request_id = ${requestId}
       AND o.status = 'indeterminate'
       AND o.resolution IS NULL
       AND o.i_tariff IS NOT NULL
     ORDER BY o.i_tariff`));

  return {
    counts,
    tariffsNeedingReview: unknown.map(r => Number(r.i_tariff)),
    unresolvedCount: unknown.length === 0 ? 0 : Number(
      (rows(await db.execute(sql`
        SELECT COUNT(*)::int AS n
          FROM rate_push_operations o
          JOIN rate_push_jobs j ON j.job_id = o.job_id
         WHERE j.request_id = ${requestId}
           AND o.status = 'indeterminate' AND o.resolution IS NULL`))[0]?.n ?? 0)),
  };
}

/** Every job of one submission, in the order they were created, plus the roll-up. */
export async function deriveRequestStatus(db: QueryableDb, requestId: string): Promise<RequestSummary | null> {
  const found = rows(await db.execute(sql`
    SELECT job_id, client_names, status, total_clients, pushed_clients, failed_clients
      FROM rate_push_jobs
     WHERE request_id = ${requestId}
     ORDER BY id`));

  if (found.length === 0) return null;

  const jobs: RequestSibling[] = found.map(r => ({
    jobId: String(r.job_id),
    accountName: r.client_names == null ? null : String(r.client_names),
    status: String(r.status ?? ''),
    totalClients:  Number(r.total_clients  ?? 0),
    pushedClients: Number(r.pushed_clients ?? 0),
    failedClients: Number(r.failed_clients ?? 0),
  }));

  const status = rankRequestStatus(jobs.map(j => j.status));
  return {
    requestId,
    // Derived FROM the status rather than recomputed beside it, so the two can never disagree —
    // including about a status word this build does not recognise, which ranks as owed work.
    terminal: status !== 'processing',
    status,
    jobs,
    counts: {
      total:  jobs.reduce((a, j) => a + j.totalClients, 0),
      pushed: jobs.reduce((a, j) => a + j.pushedClients, 0),
      failed: jobs.reduce((a, j) => a + j.failedClients, 0),
    },
  };
}
