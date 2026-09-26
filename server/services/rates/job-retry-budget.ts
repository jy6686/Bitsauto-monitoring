/**
 * job-retry-budget.ts — when a push job stops being retried, and what the record says afterwards.
 *
 * THE GAP THIS CLOSES, ESTABLISHED BY AUDIT RATHER THAN BY ANALOGY WITH LEGACY.
 *
 * Three facts about the current lifecycle, each fine alone:
 *
 *   1. `rate_push_operations` carries `attempts`. `rate_push_jobs` carries no attempt count at
 *      all — 36 columns, and the only failure surface is a free-text `errorMessage`.
 *   2. `job-terminalization.ts` holds the invariant `terminal job ⇒ zero pending operations`, so a
 *      job whose operations never settle CORRECTLY stays non-terminal. That is deliberate: a job
 *      recovery cannot see is worse than one it re-examines.
 *   3. `reconcile-boot.ts` sweeps `inArray(status, ['pending','processing'])` on every boot.
 *
 * Together they are an unbounded loop. A job that can never settle is swept again at every single
 * restart, and restarts in this deployment are frequent and not yet explained. Nothing counts the
 * sweeps, nothing gives up, and nothing records why it keeps failing — so the tenth attempt is
 * indistinguishable from the first, and an operator has no way to find the job that has been
 * quietly failing since a Tuesday in August.
 *
 * WHAT THIS DELIBERATELY DOES NOT COPY. Legacy's `3 attempts → rj` is the right shape for legacy,
 * where a job is one row and one write. Here a job owns many operations that each carry their own
 * attempts, so a job-level budget counts something different: how many times the JOB has been
 * picked up and failed to reach a settled state — not how many times a prefix was written.
 *
 * ABANDONMENT MUST NOT IMPERSONATE COMPLETION. This is the one place where going terminal breaks
 * fact 2 above on purpose, so the record has to say so. An abandoned job carries
 * `unsettledOperations`, which is the difference between "this push finished" and "we stopped
 * looking at this push while some of it was still unaccounted for". Losing that distinction would
 * be the `Sippy mutated · operation UPDATE failed · job = completed` state that
 * job-terminalization.ts exists to prevent — reintroduced through the back door.
 *
 * THE CLASSES COME FROM stage-failure.ts AND ARE NOT RESTATED. Types only; this module is itself
 * unwired, so importing them makes neither module reachable from production.
 *
 *   data           retrying runs the same query and gets the same answer  → terminal at once
 *   infrastructure the work never got a fair attempt                      → retry, up to budget
 *   control        deliberately not attempted                             → terminal, no attempt spent
 */
import type { FailureClass, StageCode } from './stage-failure';

/**
 * Three pickups. Chosen to match `READBACK_MAX_ATTEMPTS` in readback-outcome.ts, whose reasoning
 * applies unchanged here: enough to ride out a single reset, not enough to hide a real fault.
 */
export const JOB_RETRY_BUDGET = 3;

export const NON_TERMINAL_JOB_STATES = ['queued', 'pending', 'processing'] as const;
/** `held` and `abandoned` are new; `completed` and `failed` already exist in the data. */
export const TERMINAL_JOB_STATES = ['completed', 'failed', 'abandoned', 'held'] as const;

export type NonTerminalJobState = (typeof NON_TERMINAL_JOB_STATES)[number];
export type TerminalJobState = (typeof TERMINAL_JOB_STATES)[number];

/** Why a job stopped. Distinct from the stage code, which says what went wrong. */
export type TerminalReasonCode =
  /** The failure cannot be fixed by running it again. */
  | 'PERMANENT_FAILURE'
  /** Retryable, but the budget ran out. */
  | 'BUDGET_EXHAUSTED'
  /** Never attempted — held behind a control state such as an ordering barrier. */
  | 'HELD_NOT_ATTEMPTED';

export interface JobFailureInput {
  readonly code: StageCode;
  readonly cls: FailureClass;
  readonly retryable: boolean;
  readonly message: string;
}

export type JobDisposition =
  | { readonly kind: 'RETRY'; readonly attemptsUsed: number; readonly remaining: number }
  | {
      readonly kind: 'TERMINAL';
      readonly status: TerminalJobState;
      readonly reasonCode: TerminalReasonCode;
      /** The stage code that ended it, kept so the terminal record names the original fault. */
      readonly code: StageCode;
      /** For people. Persisted, not derived at read time. */
      readonly message: string;
      readonly attemptsUsed: number;
      /** True when operations were still unsettled. NEVER true for a clean completion. */
      readonly unsettledOperations: boolean;
    };

export function decideJobDisposition(input: {
  /** Attempts already recorded on the job, before this outcome. */
  readonly attempts: number;
  readonly failure: JobFailureInput;
  /** Whether this job still owns operations that have not settled. */
  readonly unsettledOperations: boolean;
  readonly budget?: number;
}): JobDisposition {
  const budget = input.budget ?? JOB_RETRY_BUDGET;
  if (!Number.isInteger(budget) || budget < 1) throw new Error(`job-retry-budget: budget must be a positive integer, got ${budget}`);
  if (!Number.isInteger(input.attempts) || input.attempts < 0) throw new Error(`job-retry-budget: attempts must be a non-negative integer, got ${input.attempts}`);

  const { failure } = input;

  // A control state was never attempted, so it spends nothing and is never retried automatically.
  if (failure.cls === 'control') {
    return {
      kind: 'TERMINAL', status: 'held', reasonCode: 'HELD_NOT_ATTEMPTED',
      code: failure.code, message: failure.message,
      attemptsUsed: input.attempts, unsettledOperations: input.unsettledOperations,
    };
  }

  const attemptsUsed = input.attempts + 1;

  // Not retryable: the same run produces the same answer. Stop now rather than spend the budget.
  if (!failure.retryable) {
    return {
      kind: 'TERMINAL', status: 'failed', reasonCode: 'PERMANENT_FAILURE',
      code: failure.code, message: failure.message,
      attemptsUsed, unsettledOperations: input.unsettledOperations,
    };
  }

  if (attemptsUsed < budget) {
    return { kind: 'RETRY', attemptsUsed, remaining: budget - attemptsUsed };
  }

  return {
    kind: 'TERMINAL', status: 'abandoned', reasonCode: 'BUDGET_EXHAUSTED',
    code: failure.code,
    message: `${failure.message} (gave up after ${attemptsUsed} attempts)`,
    attemptsUsed, unsettledOperations: input.unsettledOperations,
  };
}

/**
 * Structural prevention of further automatic retry. A sweep must consult this rather than testing
 * statuses itself, so adding a terminal state cannot silently widen what gets picked up again.
 */
export function mayAutoRetry(status: string): boolean {
  return (NON_TERMINAL_JOB_STATES as readonly string[]).includes(status);
}

export function isTerminalJobState(status: string): boolean {
  return (TERMINAL_JOB_STATES as readonly string[]).includes(status);
}

/** An abandoned job with unsettled operations still needs a human. Terminal is not the same as resolved. */
export function needsOperatorReview(d: JobDisposition): boolean {
  return d.kind === 'TERMINAL' && d.unsettledOperations;
}
