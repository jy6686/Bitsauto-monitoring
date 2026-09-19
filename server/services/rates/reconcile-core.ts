/**
 * Boot-time reconciliation — the PURE decision core (no DB, no Sippy, no clock of its own).
 *
 * A rate push writes its `rate_push_jobs` row BEFORE the first mutation-capable request, so a
 * process death between the upload and the read-back leaves the row non-terminal
 * (`processing` on the batch/change-client-rates path, `pending` on the older insert). Nothing
 * reconciles those today: `boundary.crossed` is an in-process flag that dies with the process,
 * and the in-run `indeterminate` machinery only ever sees a job a live handler is holding.
 *
 * This core answers three questions, each a pure function so a test can pin it without a
 * database or a switch:
 *   1. is a non-terminal row stale enough to be an orphan (vs one an instance is still running)?
 *   2. given a read-back of the target tariff, did the mutation land — success, failure, or
 *      genuinely indeterminate?
 *   3. when Sippy could not be reached at all, how does the unavailable-attempt counter advance,
 *      and when does it escalate to human review?
 *
 * The invariants it exists to hold (owner, 2026-09-18):
 *   - VERIFY, NEVER RETRY. Nothing here re-issues a mutation. A prior upload may have SUCCEEDED
 *     even though the process died before recording it, so a retry is a second uncontrolled write.
 *   - READ-BACK IS AUTHORITATIVE AT EVERY AGE. `getUploadStatus` is a hint the orchestrator may
 *     carry, but it can never, on its own, produce `success` here.
 *   - "SIPPY WAS UNAVAILABLE" IS NOT "THE MUTATION IS INDETERMINATE." The first describes the
 *     verification mechanism; the second describes evidence about the write. They get distinct,
 *     distinguishable terminal shapes, and an outage never consumes the ability to verify later.
 */

/** Non-terminal statuses a boot may find and must reconcile. Terminal states are never swept. */
export const NON_TERMINAL_STATUSES = ['pending', 'processing'] as const;

/**
 * THE stale floor for a non-terminal rate-push job: 2× the 15-minute upload-token processing
 * window, so a job Sippy may still be processing is never read back mid-flight.
 *
 * One constant, two consumers that must never disagree: the boot sweep treats a job OLDER than
 * this as an orphan to reconcile, and the submit-time in-flight guard treats a job YOUNGER than
 * this as a live push to refuse behind. A guard with its own floor could let a push start on a
 * tariff the sweep is about to read back — or refuse behind a job the sweep has already settled.
 * Import it; never re-type the duration.
 */
export const RATE_JOB_STALE_MS = 30 * 60_000;
export type NonTerminalStatus = (typeof NON_TERMINAL_STATUSES)[number];

export type ReconcileVerdict = 'success' | 'failure' | 'indeterminate';

/** The terminal shapes the orchestrator writes. Kept here so the distinctions are one source. */
export const RECONCILE_STATE = {
  /** Read-back positively found the mutation. */
  success:       { status: 'completed',    verificationResult: 'reconciled_confirmed' },
  /** Read-back positively established the mutation did NOT land. */
  failure:       { status: 'failed',       verificationResult: 'reconciled_absent' },
  /** We queried Sippy but the evidence cannot establish either outcome. Terminal, human review. */
  indeterminate: { status: 'indeterminate', verificationResult: 'reconciled_indeterminate' },
  /** Sippy unreachable for too many boots. NOT indeterminate — the mutation was never queried. */
  escalated:     { status: 'needs_review',  verificationResult: 'unavailable_escalated' },
} as const;

const EPSILON = 1e-9;
const rateEquals = (a: number, b: number) => Math.abs(a - b) <= EPSILON;

// ── 1. Orphan eligibility ──────────────────────────────────────────────────────────────────

export interface OrphanCandidate {
  status: string;
  /** Position clock on the current change-client-rates / push-batch path. NULL on legacy rows. */
  lastStepAt: Date | null;
  /** Always present. The fallback clock for legacy rows written before the progress instrumentation. */
  createdAt: Date;
}

/**
 * The clock a candidate is judged by: `lastStepAt` when the row carries it (every row written
 * since the progress instrumentation), else `createdAt` for legacy rows that never recorded a
 * step. A legacy row with a NULL `lastStepAt` must fall back, NOT be read as "fresh".
 */
export function effectiveStaleClock(job: OrphanCandidate): Date {
  return job.lastStepAt ?? job.createdAt;
}

/**
 * Eligible only when BOTH: the row is non-terminal, AND its effective clock is older than the
 * floor. The floor exists to exclude a job a sibling Autoscale instance is still actively
 * running — its `lastStepAt` is refreshed at every phase, so a live push is never stale.
 *
 * `staleMs` is set by the caller to at least 2× the upload-token processing window, so a row
 * that Sippy may still be PROCESSING is never read back mid-flight.
 */
export function isOrphanEligible(job: OrphanCandidate, now: Date, staleMs: number): boolean {
  if (!(NON_TERMINAL_STATUSES as readonly string[]).includes(job.status)) return false;
  const clock = effectiveStaleClock(job);
  return now.getTime() - clock.getTime() >= staleMs;
}

// ── 2. Classification from a read-back ───────────────────────────────────────────────────────

export interface RateIntent {
  prefix: string;
  newRate: number;
  /** The rate before this change. NULL means this job CREATED a new prefix (no prior rate). */
  oldRate: number | null;
}

/**
 * Does a job carry enough recorded intent to be verified by a read-back? Reconciliation exists
 * for a push that recorded WHAT it was doing (target tariff + prefix + rate) and then died before
 * confirming it. A row that recorded none of that — a pre-instrumentation `job-*` orphan with a
 * NULL `i_tariff` and no rate, or a refusal that never reached the write — is NOT that class.
 *
 * The sweep must leave such a row untouched: never call Sippy for it, never write a terminal
 * verdict, never overwrite its existing diagnostic. Fabricating `indeterminate` ("may have
 * landed, needs review") from a job that recorded no mutation intent is a false verdict — worst
 * of all for a row already marked `mismatch`/`skip`, which is a KNOWN refusal that landed nothing.
 *
 * `intents.length > 0` already implies a prefix and a parseable rate (parseIntents drops the row
 * otherwise); this adds the tariff the read-back needs.
 */
export function hasVerifiableIntent(iTariff: number | null, intents: RateIntent[]): boolean {
  return iTariff != null && intents.length > 0;
}

export interface Readback {
  /** The read itself succeeded (no fault, no transport error). */
  ok: boolean;
  /** The read saw the WHOLE tariff — false when it was truncated at the page limit. */
  complete: boolean;
  rows: { prefix: string; price1: number }[];
}

const hasPrefixAtRate = (rb: Readback, prefix: string, rate: number) =>
  rb.rows.some(r => String(r.prefix) === String(prefix) && rateEquals(r.price1, rate));

const hasPrefixAtAll = (rb: Readback, prefix: string) =>
  rb.rows.some(r => String(r.prefix) === String(prefix));

/**
 * Did the recorded mutation land? Conservative by construction — `failure` is only ever returned
 * when absence is POSITIVELY establishable on a COMPLETE read; every ambiguity is `indeterminate`.
 *
 *   - read failed or truncated                          → indeterminate (we could not see the tariff)
 *   - every intent present at its new rate              → success
 *   - none present, and absence is positively confirmed → failure
 *       · new-prefix intents: the prefix is absent entirely
 *       · edit intents: the OLD rate is still there and the new rate is not
 *   - anything mixed or unexplained                     → indeterminate
 */
export function classifyReadback(intents: RateIntent[], rb: Readback): ReconcileVerdict {
  if (!rb.ok || !rb.complete) return 'indeterminate';
  if (intents.length === 0) return 'indeterminate';

  const landed = intents.map(i => hasPrefixAtRate(rb, i.prefix, i.newRate));
  if (landed.every(Boolean)) return 'success';
  if (landed.some(Boolean)) return 'indeterminate'; // partial application — a human must look

  // None landed. Only positive absence is failure; otherwise indeterminate.
  const everyIntentAbsentByEvidence = intents.every(i => {
    if (i.oldRate == null) {
      // New-prefix create: it did not land iff the prefix does not appear at all.
      return !hasPrefixAtAll(rb, i.prefix);
    }
    // Edit: it did not land iff the old rate is still present and the new rate is not.
    return hasPrefixAtRate(rb, i.prefix, i.oldRate) && !hasPrefixAtRate(rb, i.prefix, i.newRate);
  });
  return everyIntentAbsentByEvidence ? 'failure' : 'indeterminate';
}

// ── 2b. Intent from OPERATION rows — the second source, for push-batch orphans ───────────────
//
// push-batch never stamps `newRate` on its job row at insert (only the finalise UPDATE does), so a
// push-batch job the process died on parses to NO job-level intent and was skipped. Its intent is
// not lost: `rate_push_operations` holds one row per operation, written BEFORE the first upload,
// with the tariff, the full prefix and the requested rate. This source is consulted ONLY when the
// job-row source yields nothing — the job-level guard above is unchanged.
//
// What the row statuses mean for recovery (batch-runner.ts):
//   running  markOperationRunning ran, so the primitive was handed the row → a mutation MAY have
//            been sent. Verified by read-back, each row on its own.
//   pending  the runner never marked it, and every push path marks BEFORE it pushes → nothing was
//            sent for it. Settled as not_attempted; that is position-in-code evidence, the same
//            class as refusedBeforeWrite, never an inference that a mutation occurred.
//   terminal already recorded by the run; left exactly as it is.

export interface OperationRow {
  operationKey: string;
  iTariff: number | null;
  fullPrefix: string | null;
  requestedRate: number | null;
  status: string;
}

export interface VerifiableOperation {
  operationKey: string;
  iTariff: number;
  intent: RateIntent;
}

export type OperationIntentSet =
  /** No operation rows at all (pre-511 jobs, and the five legacy orphans). */
  | { kind: 'none' }
  /** A running row lacks what a read-back needs. Nothing is reconstructed from a set like this. */
  | { kind: 'ambiguous'; reason: string }
  /** Every running row can be verified; pending rows are named so they can be settled. */
  | { kind: 'verifiable'; running: VerifiableOperation[]; pending: string[] };

/**
 * Derive a job's intent from its operation rows. All-or-nothing on the running set: one
 * unverifiable running row makes the whole job ambiguous, because reconciling the rows beside it
 * would leave a job half-settled with a row nobody can establish anything about.
 */
export function deriveOperationIntent(rows: ReadonlyArray<OperationRow>): OperationIntentSet {
  if (rows.length === 0) return { kind: 'none' };
  const running: VerifiableOperation[] = [];
  const pending: string[] = [];
  for (const r of rows) {
    if (r.status === 'pending') { pending.push(r.operationKey); continue; }
    if (r.status !== 'running') continue;   // terminal rows were recorded by the run itself
    const prefix = (r.fullPrefix ?? '').trim();
    const rate = r.requestedRate;
    if (r.iTariff == null || !Number.isFinite(r.iTariff)) return { kind: 'ambiguous', reason: `${r.operationKey}: running with no tariff` };
    if (!prefix)                                          return { kind: 'ambiguous', reason: `${r.operationKey}: running with no prefix` };
    if (rate == null || !Number.isFinite(rate))           return { kind: 'ambiguous', reason: `${r.operationKey}: running with no parseable rate` };
    // No prior rate is recorded on an operation row, so every intent is judged as a create: absent
    // on a complete read is failure; present at another rate is indeterminate (see classifyReadback).
    running.push({ operationKey: r.operationKey, iTariff: r.iTariff, intent: { prefix, newRate: rate, oldRate: null } });
  }
  return { kind: 'verifiable', running, pending };
}

/** Whether the operation source, on its own, makes a job reconcilable. */
export function hasOperationIntent(ops: OperationIntentSet | undefined): ops is Extract<OperationIntentSet, { kind: 'verifiable' }> {
  return ops?.kind === 'verifiable';
}

/** One running row, judged on its own from the read-back of its tariff. */
export function classifyOperation(op: VerifiableOperation, rb: Readback): ReconcileVerdict {
  return classifyReadback([op.intent], rb);
}

export interface OperationVerdict { operationKey: string; verdict: ReconcileVerdict }

/** The terminal shapes written per OPERATION row. Mirrors RECONCILE_STATE at row granularity. */
export const OPERATION_RECONCILE_STATE = {
  success:       { status: 'succeeded',     verificationResult: 'reconciled_confirmed' },
  failure:       { status: 'failed',        verificationResult: 'reconciled_absent' },
  indeterminate: { status: 'indeterminate', verificationResult: 'reconciled_indeterminate' },
} as const;

/**
 * The job's verdict for the run summary, from its rows. `partial` (some landed, some positively
 * did not) is counted as indeterminate: an established mixed outcome still needs a person, exactly
 * as a partially-applied job-level intent does in classifyReadback.
 */
export function jobVerdictFromOperations(verdicts: ReadonlyArray<OperationVerdict>, notAttempted: number): ReconcileVerdict {
  const n = { success: 0, failure: 0, indeterminate: 0 };
  for (const v of verdicts) n[v.verdict]++;
  if (n.indeterminate > 0) return 'indeterminate';
  if (n.success > 0 && (n.failure > 0 || notAttempted > 0)) return 'indeterminate';   // partial
  if (n.success > 0) return 'success';
  return 'failure';   // only failures and/or never-started rows: nothing landed
}

// ── 3. The unavailable-attempt counter (encoded in verification_result, no schema change) ─────

const UNAVAILABLE_PREFIX = 'unavailable:';

/** Read the unavailable-attempt count a prior boot recorded. Absent / unparsable → 0. */
export function parseUnavailableCount(verificationResult: string | null | undefined): number {
  if (!verificationResult) return 0;
  if (!verificationResult.startsWith(UNAVAILABLE_PREFIX)) return 0;
  const n = parseInt(verificationResult.slice(UNAVAILABLE_PREFIX.length), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export interface UnavailableOutcome {
  /** true → the job leaves the eligible set for human review; false → it stays eligible. */
  escalate: boolean;
  /** The value to write to verification_result. */
  verificationResult: string;
  /** The status to set: unchanged when staying eligible, `needs_review` on escalation. */
  status: NonTerminalStatus | 'needs_review';
  attempts: number;
}

/**
 * Advance the counter after a boot where Sippy was unreachable. The job was NOT queried, so its
 * status stays non-terminal (still eligible for the next boot) until the ceiling is reached, at
 * which point it escalates to `needs_review` — a terminal state that is deliberately NOT
 * `indeterminate`, because nothing was ever established about the mutation.
 *
 * Idempotent under concurrent boots: two instances that both read the same prior count compute
 * the same next value, so a simultaneous double-boot converges rather than double-counting.
 */
export function advanceUnavailable(
  currentStatus: NonTerminalStatus,
  priorVerificationResult: string | null | undefined,
  ceiling: number,
): UnavailableOutcome {
  const attempts = parseUnavailableCount(priorVerificationResult) + 1;
  if (attempts >= ceiling) {
    return {
      escalate: true,
      status: 'needs_review',
      verificationResult: `${RECONCILE_STATE.escalated.verificationResult}:${attempts}`,
      attempts,
    };
  }
  return {
    escalate: false,
    status: currentStatus,
    verificationResult: `${UNAVAILABLE_PREFIX}${attempts}`,
    attempts,
  };
}
