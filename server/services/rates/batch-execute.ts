/**
 * batch-execute.ts
 *
 * Runs a plan from `batch-plan.ts`: lanes in parallel, operations within a lane strictly one at a
 * time, every outcome recorded, nothing retried that we cannot prove did not happen.
 *
 * THE THREE VERDICTS, AND WHY THERE ARE THREE.
 *
 * Sippy's rate form is `method="GET"`, so the request that asks is the request that changes. By
 * the time there is a response to read, the tariff has already moved or it has not. Job #43 was
 * told "this rate was not applied" by a lock banner while the tariff had in fact been rewritten
 * and a live rate destroyed. A two-valued success/failure model has no way to say that.
 *
 *   success        the tariff was read back and holds what we wrote
 *   failure        the tariff was read back and does NOT hold it — nothing was applied
 *   indeterminate  we could not establish either. The write may or may not have landed.
 *
 * WHAT THE ENGINE DOES WITH THEM.
 *
 *  1. `indeterminate` is never retried. A retry of a mutation whose outcome is unknown is a second
 *     write, and on the add path a second write is not a repeat — it can edit a different rate.
 *     Only `failure`, which means the read-back positively showed nothing was applied, is eligible.
 *
 *  2. `indeterminate` halts its own lane. The tariff's state is unknown and Sippy may still be
 *     processing a file against it; the next operation would either trip the lock or write on top
 *     of something we cannot see. Other lanes are unaffected — different tariffs are different
 *     locks. Remaining operations in the halted lane are reported `not_attempted` with the reason,
 *     never as failures, because they were never tried.
 *
 * The Sippy call is injected. This module owns ordering, verdicts and stopping rules; it performs
 * no I/O of its own, so all of that is provable without a switch.
 */
import type { BatchPlan, RateOperation, RefusedOperation } from "./batch-plan";

export type Verdict = 'success' | 'failure' | 'indeterminate';

/** What the injected Sippy call must report back. */
export interface OperationOutcome {
  verdict: Verdict;
  message: string;
  /** Optional detail carried straight through to the operation record. */
  method?: string;
  iRate?: number;
  /** 'confirmed' | 'mismatch' | 'skip' as the primitive reported it. */
  verificationResult?: string;
  /** The primitive's mutation-boundary signal. Undefined means it was never established. */
  refusedBeforeWrite?: boolean;
}

export type OperationRunner = (
  operation: RateOperation,
  ctx: { attempt: number; iTariff: number },
) => Promise<OperationOutcome>;

export interface OperationResult {
  operationKey: string;
  iTariff: number;
  prefix: string;
  accountName: string;
  /** `not_attempted` is a fourth reporting state: the operation never ran. */
  verdict: Verdict | 'not_attempted';
  message: string;
  method?: string;
  iRate?: number;
  verificationResult?: string;
  refusedBeforeWrite?: boolean;
  attempts: number;
  ms: number;
}

export interface BatchOutcome {
  results: OperationResult[];
  refused: RefusedOperation[];
  counts: {
    success: number;
    failure: number;
    indeterminate: number;
    not_attempted: number;
    refused: number;
  };
  /** Lanes stopped early because an operation's outcome could not be established. */
  haltedLanes: Array<{ iTariff: number; atOperationKey: string; remaining: number }>;
  /** True only when every submitted operation was attempted and succeeded. */
  complete: boolean;
}

export interface ExecuteOptions {
  /**
   * Attempts per operation. Applies ONLY to `failure`; an `indeterminate` outcome is terminal at
   * one attempt regardless of this value.
   */
  maxAttempts?: number;
  /**
   * Called after every operation settles, for progress persistence. Awaited, so a durable record
   * exists before the lane continues; a rejection is contained and never fails the batch.
   */
  onResult?: (result: OperationResult, progress: { done: number; total: number }) => void | Promise<void>;
  /** Injected clock, so elapsed-time assertions do not depend on real time. */
  now?: () => number;
}

const RETRYABLE: ReadonlySet<Verdict> = new Set<Verdict>(['failure']);

export async function executeRateBatch(
  plan: BatchPlan,
  run: OperationRunner,
  opts: ExecuteOptions = {},
): Promise<BatchOutcome> {
  const now = opts.now ?? Date.now;
  const maxAttempts = Math.max(1, Math.trunc(opts.maxAttempts ?? 1));
  const results: OperationResult[] = [];
  const haltedLanes: BatchOutcome['haltedLanes'] = [];
  const total = plan.executableCount;
  let done = 0;

  const record = async (r: OperationResult) => {
    results.push(r);
    done += 1;
    try { await opts.onResult?.(r, { done, total }); } catch { /* progress reporting is not load-bearing */ }
  };

  /** One lane: strictly sequential, and it stops the moment an outcome cannot be established. */
  const runLane = async (lane: BatchPlan['lanes'][number]): Promise<void> => {
    for (let i = 0; i < lane.operations.length; i++) {
      const operation = lane.operations[i];
      const startedAt = now();
      let outcome: OperationOutcome | null = null;
      let attempts = 0;

      while (attempts < maxAttempts) {
        attempts += 1;
        try {
          outcome = await run(operation, { attempt: attempts, iTariff: lane.iTariff });
        } catch (e: any) {
          // A thrown call is the definition of an unknown outcome: the request may well have
          // reached Sippy. It is never retried and never called a failure.
          outcome = {
            verdict: 'indeterminate',
            message: `Push threw before an outcome could be established: ${e?.message ?? String(e)}. The write may still have been applied — read the tariff before any further action.`,
          };
          break;
        }
        if (!RETRYABLE.has(outcome.verdict) || attempts >= maxAttempts) break;
      }

      const settled = outcome ?? {
        verdict: 'indeterminate' as Verdict,
        message: 'The push returned no outcome.',
      };

      await record({
        operationKey: operation.operationKey,
        iTariff: lane.iTariff,
        prefix: operation.prefix,
        accountName: operation.accountName,
        verdict: settled.verdict,
        message: settled.message,
        method: settled.method,
        iRate: settled.iRate,
        verificationResult: settled.verificationResult,
        refusedBeforeWrite: settled.refusedBeforeWrite,
        attempts,
        ms: now() - startedAt,
      });

      if (settled.verdict === 'indeterminate') {
        const remaining = lane.operations.slice(i + 1);
        if (remaining.length) {
          haltedLanes.push({ iTariff: lane.iTariff, atOperationKey: operation.operationKey, remaining: remaining.length });
          for (const skipped of remaining) {
            await record({
              operationKey: skipped.operationKey,
              iTariff: lane.iTariff,
              prefix: skipped.prefix,
              accountName: skipped.accountName,
              verdict: 'not_attempted',
              message: `Not attempted: tariff ${lane.iTariff} was left in an unknown state by ${operation.operationKey}, so no further write to it is safe until that is resolved by reading the tariff.`,
              attempts: 0,
              ms: 0,
            });
          }
        }
        return;   // this lane stops; other lanes are unaffected
      }
    }
  };

  // Bounded worker pool over lanes. Each worker takes the next lane and owns it to completion,
  // which is what keeps a tariff's operations on a single thread of execution.
  const queue = [...plan.lanes];
  const workers = Array.from({ length: Math.max(1, plan.concurrency) }, async () => {
    for (;;) {
      const lane = queue.shift();
      if (!lane) return;
      await runLane(lane);
    }
  });
  await Promise.all(workers);

  const counts = {
    success:       results.filter(r => r.verdict === 'success').length,
    failure:       results.filter(r => r.verdict === 'failure').length,
    indeterminate: results.filter(r => r.verdict === 'indeterminate').length,
    not_attempted: results.filter(r => r.verdict === 'not_attempted').length,
    refused:       plan.refused.length,
  };

  return {
    results,
    refused: plan.refused,
    counts,
    haltedLanes,
    complete: counts.success === plan.submittedCount,
  };
}

/** One line an operator can read without opening the operation list. */
export function summariseBatch(outcome: BatchOutcome): string {
  const c = outcome.counts;
  const parts = [`${c.success} applied`];
  if (c.failure)       parts.push(`${c.failure} failed`);
  if (c.indeterminate) parts.push(`${c.indeterminate} UNVERIFIED — read the tariff`);
  if (c.not_attempted) parts.push(`${c.not_attempted} not attempted`);
  if (c.refused)       parts.push(`${c.refused} refused before execution`);
  const halted = outcome.haltedLanes.length
    ? ` Halted tariff(s): ${outcome.haltedLanes.map(h => h.iTariff).join(', ')}.`
    : '';
  return `${parts.join(' · ')}.${halted}`;
}
