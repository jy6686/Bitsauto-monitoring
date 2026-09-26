/**
 * account-job-plan.ts — turning one submission into one job per account.
 *
 * WHAT THIS FIXES. A submission produces a single `rate_push_jobs` row today, so one status, one
 * Retry and one error message have to stand for outcomes that are already independent in
 * execution. `job-1790249867200` pushed to two accounts: aura succeeded 6/6 with every operation
 * verified, test-31 failed 0/6 — and Push History showed one row reading
 * `aura, test-31 · 6 failed · Partial`. An operator could not see that aura was perfectly fine.
 * The isolation was never missing; the RECORD was.
 *
 * PURE ON PURPOSE. No database, no clock, no id generation of its own — the caller supplies the
 * request id and the id base, so a test can assert exact ids and the route stays responsible for
 * when the work happens. Same reasoning as job-queue.ts beside it.
 *
 * This module decides the shape of the records. It does not decide when they run: Commit A keeps
 * execution synchronous and only changes what is written down.
 */

/** The only field this needs from an operation. Generic so the runner's type stays in the route. */
export interface HasAccountName {
  accountName: string;
}

export interface AccountJob<Op extends HasAccountName> {
  jobId: string;
  accountName: string;
  operations: Op[];
}

export interface AccountJobPlan<Op extends HasAccountName> {
  requestId: string;
  jobs: Array<AccountJob<Op>>;
  /** Accounts submitted more than once, named so the drop is visible rather than silent. */
  duplicatesDropped: string[];
  /** Submitted accounts that no operation mentions — nothing to push, so no job is created. */
  accountsWithoutOperations: string[];
}

/**
 * Job ids for one submission's siblings.
 *
 * `job-<base>` was unique while a submission produced one row. N rows created inside the same
 * millisecond would collide on `rate_push_jobs.job_id`'s unique constraint, so the index is part
 * of the id rather than the timestamp alone. The suffix also makes a sibling set obvious at a
 * glance in Push History, which is the screen this whole change exists to fix.
 */
export function accountJobId(base: string | number, index: number): string {
  return `job-${base}-${index}`;
}

/**
 * One submission → one job per distinct account, each owning only its own operations.
 *
 * ACCOUNTS COME FROM THE OPERATIONS, not from the submitted list alone. An account the operator
 * named but that produced no operation — every destination refused before an operation was built,
 * say — gets no job, because a job with nothing to execute would sit in the queue forever and
 * report a status about work that does not exist. It is reported instead.
 *
 * Order follows the deduplicated submission, so the queue runs in the order the operator typed
 * rather than in map-iteration order.
 */
export function planAccountJobs<Op extends HasAccountName>(input: {
  accountNames: readonly string[];
  operations: readonly Op[];
  requestId: string;
  /** Usually Date.now(); supplied so ids are the caller's decision and a test can pin them. */
  idBase: string | number;
}): AccountJobPlan<Op> {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const duplicatesDropped: string[] = [];

  for (const raw of input.accountNames ?? []) {
    const name = String(raw ?? '').trim();
    if (!name) continue;
    // Exact comparison: account names are Sippy identifiers, and folding case here would merge
    // two accounts the switch considers distinct.
    if (seen.has(name)) { duplicatesDropped.push(name); continue; }
    seen.add(name);
    ordered.push(name);
  }

  const byAccount = new Map<string, Op[]>();
  for (const op of input.operations ?? []) {
    const name = String(op?.accountName ?? '').trim();
    if (!name) continue;
    const list = byAccount.get(name) ?? [];
    list.push(op);
    byAccount.set(name, list);
  }

  const jobs: Array<AccountJob<Op>> = [];
  const accountsWithoutOperations: string[] = [];

  for (const accountName of ordered) {
    const operations = byAccount.get(accountName) ?? [];
    if (operations.length === 0) { accountsWithoutOperations.push(accountName); continue; }
    jobs.push({ jobId: accountJobId(input.idBase, jobs.length), accountName, operations });
  }

  return { requestId: input.requestId, jobs, duplicatesDropped, accountsWithoutOperations };
}
