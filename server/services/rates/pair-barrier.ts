/**
 * pair-barrier.ts — a failed rate change for a (client, product) holds back every later change
 * for that same pair, until the failure is dealt with.
 *
 * THE DEFECT THIS PREVENTS. Rate changes for one customer and one product are a sequence, not a
 * set: each card supersedes the one before it. Apply them out of order and the customer ends up
 * on a card nobody chose. Monday's change fails, Tuesday's succeeds, and the customer is now on
 * Tuesday's rates while Monday's were never applied — no error is showing, because Tuesday
 * genuinely succeeded. The billing is wrong and every status in the system says it is fine.
 *
 * Legacy BitsAuto has guarded this since before the rewrite, in five lines: jobs are read in
 * creation order, and a failure for a (client, product) appends that pair to a skip list which
 * every later job in the cycle is checked against. This module is that rule, made explicit and
 * testable. It is the cheapest correctness win in the rate path.
 *
 * WHY IT IS NOT batch-plan.ts. Those lanes stop two operations OVERLAPPING on one tariff inside a
 * single cycle. This stops two changes being applied OUT OF SEQUENCE across cycles, which is a
 * different failure on a different axis: the lanes are about concurrency, the barrier is about
 * order. A tariff resolves per account and a pair spans accounts, so neither dimension contains
 * the other and one cannot be expressed as the other.
 *
 * PURE ON PURPOSE. No database, no clock, no network. The caller reads the jobs in creation order
 * and reports each outcome back; this module only decides who is allowed to run. Same reasoning as
 * batch-plan.ts and account-job-plan.ts beside it: an ordering rule that can only be demonstrated
 * against a live switch is an ordering rule nobody can prove.
 *
 * FOUR DECISIONS WORTH KNOWING, BECAUSE EACH ONE IS A WAY TO GET THIS WRONG.
 *
 *  1. Only a FAILURE blocks. A success is the sequence advancing normally and must never hold up
 *     the pair behind it.
 *
 *  2. A blocked job is SKIPPED, not failed. It has not been attempted, so it keeps its pending
 *     state, does not consume a retry attempt, and is picked up in a later cycle once the
 *     blocking failure is resolved. Marking it failed would manufacture a failure that never
 *     happened and would burn the retry budget of a job that never ran.
 *
 *  3. Out-of-order input is REFUSED, not sorted. The whole guarantee rests on the caller reading
 *     jobs in creation order; a barrier fed an unordered list would return confident, meaningless
 *     answers. Sorting internally would hide a caller bug that matters far more than this module
 *     does — so it throws instead, in the spirit of batch-plan refusing an unresolved tariff.
 *
 *  4. The blocking job is NAMED in the decision. "Skipped" on its own is undiagnosable; an
 *     operator needs to know which earlier change is holding the pair, which is the same
 *     reasoning behind per-stage error codes.
 */

/** A pair is one customer and one product. Ordering is a property of the pair, not of a job. */
export function pairKey(clientId: string, productId: string): string {
  if (!clientId || !productId) {
    throw new Error(`pairKey requires both ids, got client=${JSON.stringify(clientId)} product=${JSON.stringify(productId)}`);
  }
  // Length-prefixed so that ('a:b','c') and ('a','b:c') cannot collide on one key.
  return `${clientId.length}:${clientId}:${productId}`;
}

export interface BarrierJob {
  readonly jobId: string;
  readonly clientId: string;
  readonly productId: string;
  /** Creation order. Milliseconds, or any monotonically non-decreasing sequence number. */
  readonly createdAt: number;
}

/** What the caller observed. Anything that is not a success is treated as a failure. */
export type JobOutcome = 'succeeded' | 'failed';

export type BarrierDecision =
  | { readonly run: true }
  | { readonly run: false; readonly reason: 'PAIR_BLOCKED'; readonly blockedBy: string; readonly pair: string };

export interface PairBarrier {
  /** May this job run? Call in creation order, once per job. */
  admit(job: BarrierJob): BarrierDecision;
  /** Report what happened to a job that `admit` allowed to run. */
  record(job: BarrierJob, outcome: JobOutcome): void;
  /** Pair keys currently held back, for reporting. */
  blockedPairs(): readonly string[];
}

export function createPairBarrier(): PairBarrier {
  /** pair key → the job whose failure closed it. First failure wins; it is the earliest. */
  const blocked = new Map<string, string>();
  /** Guards decision 3: the caller must present jobs in creation order. */
  let lastCreatedAt = Number.NEGATIVE_INFINITY;
  const admitted = new Set<string>();

  return {
    admit(job: BarrierJob): BarrierDecision {
      if (job.createdAt < lastCreatedAt) {
        throw new Error(
          `pair-barrier: jobs must arrive in creation order; job ${job.jobId} has createdAt ${job.createdAt} after ${lastCreatedAt}`,
        );
      }
      lastCreatedAt = job.createdAt;

      const key = pairKey(job.clientId, job.productId);
      const blockedBy = blocked.get(key);
      if (blockedBy !== undefined) {
        return { run: false, reason: 'PAIR_BLOCKED', blockedBy, pair: key };
      }
      admitted.add(job.jobId);
      return { run: true };
    },

    record(job: BarrierJob, outcome: JobOutcome): void {
      if (!admitted.has(job.jobId)) {
        throw new Error(`pair-barrier: job ${job.jobId} was never admitted, so it has no outcome to record`);
      }
      if (outcome === 'failed') {
        const key = pairKey(job.clientId, job.productId);
        if (!blocked.has(key)) blocked.set(key, job.jobId);
      }
    },

    blockedPairs(): readonly string[] {
      return [...blocked.keys()];
    },
  };
}
