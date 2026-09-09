/**
 * batch-runner.ts
 *
 * The one place the five layers are composed:
 *
 *   preflight  -> deterministic refusals, decided without contacting Sippy
 *   planner    -> one serial lane per tariff, concurrent across tariffs
 *   persistence-> a durable row per operation before anything is attempted
 *   executor   -> lane ordering, three verdicts, no retry of an unknown outcome
 *   primitive  -> the existing single-operation push, injected
 *
 * The push is a parameter, not an import. That is what lets the whole batch path be exercised —
 * ordering, refusals, verdicts, persistence, recovery — with no switch, no network and no
 * possibility of a production write from a test run.
 *
 * WHAT THIS CHANGES ABOUT BATCH SEMANTICS.
 *
 * The push-batch route refuses the entire request when any account fails a tariff-integrity check.
 * That is right for one push and wrong for a batch: one misprovisioned account would cancel every
 * sound operation beside it. Here a deterministic refusal is recorded against its own operation
 * and the rest proceed. Nothing is lost — a refused operation is persisted and reported like any
 * other outcome, so the batch still cannot quietly do less than it was asked to.
 *
 * WHAT IT DELIBERATELY DOES NOT DO.
 *
 * It does not retry an indeterminate outcome, does not resume a previous run, and does not decide
 * a tariff's state. Recovery from an interrupted run is `reconcileInterruptedOperations`, called
 * separately, because reclassifying a crash is a different decision from executing a batch.
 */
import { preflightOperations, type PreflightOperation } from './preflight';
import { planRateBatch, type BatchPlan, type RateOperation, type RefusedOperation } from './batch-plan';
import { executeRateBatch, type OperationRunner, type OperationResult } from './batch-execute';
import { verdictFromPush, type PushPrimitiveResult } from './verdict';
import {
  persistPlan, markOperationRunning, recordOperationResult, deriveJobStatus,
  type OperationQueryable, type PersistContext, type JobSummary,
} from './operation-store';
import { acquireTariff, type TariffLockProvider, type AcquireOptions } from './tariff-lock';

/** One operation as the route knows it: what preflight needs, plus what the record should carry. */
export interface RunnerOperation extends PreflightOperation {
  dialPrefix?: string | null;
  destinationName?: string | null;
  iAccount?: number | null;
  effectiveFrom?: string;
  effectiveTill?: string;
}

/** The single-operation push, injected. Shaped to what `pushRateToSippy` already returns. */
export type InjectedPush = (
  op: {
    operationKey: string;
    accountName: string;
    iTariff: number;
    prefix: string;
    rate: number;
    interval1?: number;
    intervalN?: number;
    effectiveFrom?: string;
    effectiveTill?: string;
  },
  ctx: { attempt: number },
) => Promise<PushPrimitiveResult>;

export interface BatchRunnerDeps {
  db: OperationQueryable;
  push: InjectedPush;
  /**
   * Cross-BATCH exclusion on a tariff. The planner already serialises a tariff within one batch;
   * this is what stops a second batch, in another request or process, writing the same tariff at
   * the same time — which is exactly what jobs 46 and 47 did on tariff 65 on 2026-09-09.
   * Omitted leaves behaviour unchanged: no cross-batch exclusion.
   */
  lock?: TariffLockProvider;
  lockOptions?: AcquireOptions;
}

export interface BatchRunInput {
  jobId: string;
  operations: ReadonlyArray<RunnerOperation>;
  productName?: string | null;
  trunkPrefix?: string | null;
  concurrency?: number;
  /** Applies only to a proven non-write; an unknown outcome is terminal at one attempt. */
  maxAttempts?: number;
}

/** One line per operation, in submission order, shaped for the existing push-batch response. */
export interface BatchRunLine {
  operationKey: string;
  accountName: string;
  prefix: string;
  rate: number;
  success: boolean;
  message: string;
  method?: string;
  /** success | failure | indeterminate | not_attempted | refused */
  verdict: string;
  ms: number;
}

export interface BatchRunOutcome {
  jobId: string;
  results: BatchRunLine[];
  ok: number;
  total: number;
  /** Derived from the persisted rows, never from the in-memory results. */
  summary: JobSummary;
  /** Tariffs left in an unknown state. Nothing further may be written to them without a read. */
  tariffsNeedingReview: number[];
  haltedLanes: Array<{ iTariff: number; atOperationKey: string; remaining: number }>;
}

export async function runRateBatch(
  deps: BatchRunnerDeps,
  input: BatchRunInput,
): Promise<BatchRunOutcome> {
  const submittedOrder = new Map(input.operations.map((o, i) => [o.operationKey, i]));
  const byKey = new Map(input.operations.map(o => [o.operationKey, o]));

  // ── 1. Decide everything that can be decided without asking Sippy ───────────
  const { cleared, refused: preflightRefused } = preflightOperations(input.operations);

  const toRateOperation = (op: RunnerOperation, iTariff: number | null, i1?: number, iN?: number): RateOperation => ({
    operationKey: op.operationKey,
    accountName:  op.accountName,
    iTariff,
    prefix:       String(op.fullPrefix),
    rate:         op.rate,
    effectiveFrom: op.effectiveFrom,
    effectiveTill: op.effectiveTill,
    interval1:    i1,
    intervalN:    iN,
  });

  const executable: RateOperation[] = cleared.map(c => {
    const op = byKey.get(c.operationKey)!;
    return toRateOperation(op, c.iTariff, c.interval1, c.intervalN);
  });

  // ── 2. Lanes: one per tariff, serial within, concurrent across ──────────────
  const planned = planRateBatch(executable, { concurrency: input.concurrency });

  // Preflight's refusals join the planner's, so one batch reports every refusal in one place and
  // the conservation property still holds across the whole run.
  const carriedRefusals: RefusedOperation[] = preflightRefused.map(r => {
    const op = byKey.get(r.operationKey)!;
    return { operation: toRateOperation(op, null), code: r.code, message: r.message };
  });

  const plan: BatchPlan = {
    ...planned,
    refused: [...planned.refused, ...carriedRefusals],
    submittedCount: input.operations.length,
  };

  // ── 3. A durable row per operation, written BEFORE anything is attempted ────
  const extras: PersistContext['extras'] = {};
  for (const op of input.operations) {
    extras[op.operationKey] = {
      dialPrefix:      op.dialPrefix ?? null,
      destinationName: op.destinationName ?? null,
      iAccount:        op.iAccount ?? null,
    };
  }
  await persistPlan(deps.db, input.jobId, plan, {
    productName: input.productName ?? null,
    trunkPrefix: input.trunkPrefix ?? null,
    extras,
  });

  // ── 4. Execute ──────────────────────────────────────────────────────────────
  const runner: OperationRunner = async (operation, ctx) => {
    // Claimed BEFORE the row is marked running, so a waiting batch never sees a row in flight that
    // is only queued behind a lock.
    const release = deps.lock
      ? await acquireTariff(deps.lock, ctx.iTariff, deps.lockOptions)
      : (async () => {}) as (() => Promise<void>);

    if (!release) {
      // Nothing was sent, so the tariff is provably untouched: a failure, never an unknown outcome.
      return {
        verdict: 'failure',
        message: `Tariff ${ctx.iTariff} is being written by another push and did not become free in time. Nothing was sent for ${operation.prefix}; the tariff is unchanged by this operation.`,
        refusedBeforeWrite: true,
      };
    }

    try {
      return await runOnePush(operation, ctx);
    } finally {
      // Released even if the push threw, or Postgres would hold the tariff until the connection died.
      await release();
    }
  };

  const runOnePush = async (operation: RateOperation, ctx: { attempt: number; iTariff: number }) => {
    await markOperationRunning(deps.db, input.jobId, operation.operationKey);
    const raw = await deps.push({
      operationKey:  operation.operationKey,
      accountName:   operation.accountName,
      iTariff:       ctx.iTariff,
      prefix:        operation.prefix,
      rate:          operation.rate,
      interval1:     operation.interval1,
      intervalN:     operation.intervalN,
      effectiveFrom: operation.effectiveFrom,
      effectiveTill: operation.effectiveTill,
    }, { attempt: ctx.attempt });

    // The primitive's own report, mapped by the module that owns that mapping.
    const outcome = verdictFromPush(raw);
    return { ...outcome, verificationResult: raw.verificationResult, refusedBeforeWrite: raw.refusedBeforeWrite };
  };

  const executed = await executeRateBatch(plan, runner, {
    maxAttempts: input.maxAttempts,
    // Awaited by the executor, so an operation is durably recorded before its lane moves on.
    onResult: async (r: OperationResult) => {
      await recordOperationResult(deps.db, input.jobId, r, {
        verificationResult: r.verificationResult ?? null,
        refusedBeforeWrite: r.refusedBeforeWrite ?? null,
      });
    },
  });

  // ── 5. Report. The parent's status comes from the rows, not from the array ──
  const summary = await deriveJobStatus(deps.db, input.jobId);

  const executedLines: BatchRunLine[] = executed.results.map(r => ({
    operationKey: r.operationKey,
    accountName:  r.accountName,
    prefix:       r.prefix,
    rate:         byKey.get(r.operationKey)?.rate ?? 0,
    success:      r.verdict === 'success',
    message:      r.message,
    method:       r.method,
    verdict:      r.verdict,
    ms:           r.ms,
  }));

  const refusedLines: BatchRunLine[] = plan.refused.map(r => ({
    operationKey: r.operation.operationKey,
    accountName:  r.operation.accountName,
    prefix:       r.operation.prefix,
    rate:         r.operation.rate,
    success:      false,
    message:      r.message,
    verdict:      'refused',
    ms:           0,
  }));

  const results = [...executedLines, ...refusedLines].sort(
    (a, b) => (submittedOrder.get(a.operationKey) ?? 0) - (submittedOrder.get(b.operationKey) ?? 0),
  );

  return {
    jobId: input.jobId,
    results,
    ok: results.filter(r => r.success).length,
    total: input.operations.length,
    summary,
    tariffsNeedingReview: summary.tariffsNeedingReview,
    haltedLanes: executed.haltedLanes,
  };
}
