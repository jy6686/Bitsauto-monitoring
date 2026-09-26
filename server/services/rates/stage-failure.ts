/**
 * stage-failure.ts — the canonical vocabulary for "what went wrong, and where".
 *
 * THE DEFECT THIS REPLACES. Push History showed `aura, test-31 · 6 failed · Partial` for a run in
 * which aura succeeded 6/6 and test-31 failed 0/6. One generic "failed" had to stand for outcomes
 * that were already independent, and an operator could not tell which stage broke, whether
 * retrying would help, or whether anything had been attempted at all. Legacy BitsAuto avoids this
 * with per-stage codes — `e4` vs `e5` vs `e6`, never one generic failure — and that is the one
 * thing its notification machine does better than ours.
 *
 * WHAT THIS DOES NOT REPLACE. `readback-outcome.ts` already distinguishes transport / timeout /
 * fault / unsupported, and already draws the line that matters most: `unavailable` means the tariff
 * could not be read and is NOT a claim about the tariff, where `absent` IS one. That taxonomy is
 * correct and is reused here, not restated. This module adds the dimension it lacks — WHICH STAGE —
 * and the classification that tells an operator what to do next.
 *
 * THREE CLASSES, AND WHY CONFLATING THEM IS THE ACTUAL BUG.
 *
 *   data            The input is wrong or missing. Retrying runs the same query and gets the same
 *                   answer. Someone must change the data. (NO_RATE, AMBIGUOUS_RATE.)
 *   infrastructure  The work never got a fair attempt. Sippy reset, a read timed out, the database
 *                   was unreachable. Retrying is exactly the right response. (TIMEOUT, TRANSPORT.)
 *   control         Not a failure at all. The work was deliberately not attempted — held behind an
 *                   ordering barrier, or awaiting certification.
 *
 * A control state recorded as an execution failure is the specific error the pair-barrier contract
 * forbids: a skipped job never ran, so it must not consume a retry attempt and must not appear in a
 * failure count. `isExecutionFailure` and `countsAgainstRetryBudget` are the enforcement, and both
 * answer false for every control code by construction rather than by the caller remembering to.
 *
 * CODES ARE DETERMINISTIC AND CARRY THEIR STAGE. Every code reads `<STAGE>_<REASON>`, so the stage
 * is recoverable from the code alone — in a log line, a database column, or a support ticket, with
 * no lookup. An invariant test asserts the prefix matches the registered stage for every entry, so
 * the two cannot drift.
 *
 * THE MESSAGE IS KEPT, NOT REPLACED. A code is for machines and a message is for people; a system
 * that keeps only the code loses the one detail that makes a failure diagnosable. Both travel
 * together, alongside whichever entity ids were available.
 */

export const STAGES = ['collection', 'verification', 'rating', 'snapshot', 'reconciliation', 'invoice'] as const;
export type Stage = (typeof STAGES)[number];

export type FailureClass = 'data' | 'infrastructure' | 'control';

export interface CodeSpec {
  readonly stage: Stage;
  readonly cls: FailureClass;
  /** Whether re-running the same work unchanged could plausibly succeed. */
  readonly retryable: boolean;
  readonly summary: string;
}

/**
 * The registry. Adding a stage failure means adding it HERE — a code that is not registered is
 * refused at construction, so an ad-hoc string cannot enter the vocabulary by being typed into a
 * caller. Extend deliberately.
 */
export const STAGE_CODES = {
  // ── collection ─────────────────────────────────────────────────────────────
  COLLECTION_TRANSPORT:        { stage: 'collection',     cls: 'infrastructure', retryable: true,  summary: 'connection reset, refused or hung up' },
  COLLECTION_TIMEOUT:          { stage: 'collection',     cls: 'infrastructure', retryable: true,  summary: 'the collection window elapsed' },
  COLLECTION_FAULT:            { stage: 'collection',     cls: 'infrastructure', retryable: true,  summary: 'the switch answered with a fault' },
  COLLECTION_UNSUPPORTED:      { stage: 'collection',     cls: 'infrastructure', retryable: false, summary: 'no method on this build answered' },
  COLLECTION_INCOMPLETE:       { stage: 'collection',     cls: 'data',           retryable: false, summary: 'a gap remains in the collected period' },
  COLLECTION_NOT_ATTEMPTED:    { stage: 'collection',     cls: 'control',        retryable: false, summary: 'collection was not attempted' },

  // ── verification ───────────────────────────────────────────────────────────
  /** A claim about the target: it was read, and it does not hold what was written. */
  VERIFICATION_ABSENT:         { stage: 'verification',   cls: 'data',           retryable: false, summary: 'read back, and the value is not there' },
  /** NOT a claim about the target: it could not be read. Never record this as ABSENT. */
  VERIFICATION_UNAVAILABLE:    { stage: 'verification',   cls: 'infrastructure', retryable: true,  summary: 'the target could not be read' },
  VERIFICATION_TIMEOUT:        { stage: 'verification',   cls: 'infrastructure', retryable: true,  summary: 'the read exceeded its window' },
  VERIFICATION_NOT_ATTEMPTED:  { stage: 'verification',   cls: 'control',        retryable: false, summary: 'verification was not attempted' },

  // ── rating ─────────────────────────────────────────────────────────────────
  RATING_NO_RATE:              { stage: 'rating',         cls: 'data',           retryable: false, summary: 'no rate applies for the key at that time' },
  RATING_AMBIGUOUS_RATE:       { stage: 'rating',         cls: 'data',           retryable: false, summary: 'more than one rate applies for the key' },
  RATING_TARIFF_UNRESOLVED:    { stage: 'rating',         cls: 'data',           retryable: false, summary: 'the target tariff did not resolve' },
  RATING_SOURCE_UNAVAILABLE:   { stage: 'rating',         cls: 'infrastructure', retryable: true,  summary: 'the rate source could not be read' },
  /** Held by the (client, product) ordering barrier. Never ran; not a failure. */
  RATING_PAIR_BLOCKED:         { stage: 'rating',         cls: 'control',        retryable: false, summary: 'an earlier change for this pair has not been resolved' },

  // ── snapshot ───────────────────────────────────────────────────────────────
  SNAPSHOT_EMPTY_PERIOD:       { stage: 'snapshot',       cls: 'data',           retryable: false, summary: 'the period holds nothing to snapshot' },
  SNAPSHOT_HASH_MISMATCH:      { stage: 'snapshot',       cls: 'data',           retryable: false, summary: 'the snapshot no longer matches what it locked' },
  SNAPSHOT_SOURCE_UNAVAILABLE: { stage: 'snapshot',       cls: 'infrastructure', retryable: true,  summary: 'the snapshot source could not be read' },
  SNAPSHOT_NOT_ATTEMPTED:      { stage: 'snapshot',       cls: 'control',        retryable: false, summary: 'the snapshot was not attempted' },

  // ── reconciliation ─────────────────────────────────────────────────────────
  RECONCILIATION_DELTA_EXCEEDED:    { stage: 'reconciliation', cls: 'data',           retryable: false, summary: 'the delta is outside tolerance' },
  RECONCILIATION_SOURCE_UNAVAILABLE:{ stage: 'reconciliation', cls: 'infrastructure', retryable: true,  summary: 'a side of the comparison could not be read' },
  RECONCILIATION_NOT_ATTEMPTED:     { stage: 'reconciliation', cls: 'control',        retryable: false, summary: 'reconciliation was not attempted' },

  // ── invoice ────────────────────────────────────────────────────────────────
  INVOICE_NO_SNAPSHOT:         { stage: 'invoice',        cls: 'data',           retryable: false, summary: 'no locked snapshot to invoice from' },
  INVOICE_NOT_CERTIFIED:       { stage: 'invoice',        cls: 'control',        retryable: false, summary: 'awaiting certification before issue' },
  INVOICE_DELIVERY_FAILED:     { stage: 'invoice',        cls: 'infrastructure', retryable: true,  summary: 'the invoice was produced but not delivered' },
  INVOICE_TEMPLATE_MISSING:    { stage: 'invoice',        cls: 'data',           retryable: false, summary: 'no template resolved for the recipient' },
} as const satisfies Record<string, CodeSpec>;

export type StageCode = keyof typeof STAGE_CODES;

/** Whichever ids were available. Every field optional: a failure is never withheld for lack of one. */
export interface FailureEntity {
  readonly requestId?: string;
  readonly jobId?: string;
  readonly accountId?: string;
  readonly operationId?: string;
  readonly clientId?: string;
  readonly productId?: string;
  readonly invoiceId?: string;
  readonly period?: string;
}

export interface StageFailure {
  readonly code: StageCode;
  readonly stage: Stage;
  readonly cls: FailureClass;
  readonly retryable: boolean;
  /** For people. Never replaced by the code. */
  readonly message: string;
  readonly entity: FailureEntity;
  /** The underlying reason, when something lower down produced one. */
  readonly cause?: string;
}

export function stageFailure(
  code: StageCode,
  detail: { message: string; entity?: FailureEntity; cause?: string },
): StageFailure {
  const spec = STAGE_CODES[code] as CodeSpec | undefined;
  if (!spec) throw new Error(`stage-failure: ${String(code)} is not a registered code`);
  if (!detail.message?.trim()) {
    throw new Error(`stage-failure: ${code} needs a human-readable message; the code alone is not diagnosable`);
  }
  return {
    code, stage: spec.stage, cls: spec.cls, retryable: spec.retryable,
    message: detail.message, entity: detail.entity ?? {}, ...(detail.cause ? { cause: detail.cause } : {}),
  };
}

/** The stage, recoverable from a bare code with no registry lookup. */
export function stageOfCode(code: string): Stage | null {
  return STAGES.find(s => code.startsWith(`${s.toUpperCase()}_`)) ?? null;
}

/** True only for work that was actually attempted and did not succeed. Control states are not failures. */
export function isExecutionFailure(f: StageFailure): boolean {
  return f.cls !== 'control';
}

/** A job that never ran must not consume a retry attempt. */
export function countsAgainstRetryBudget(f: StageFailure): boolean {
  return isExecutionFailure(f);
}

/** One line for a log or a Push History row: code, stage, ids, then the human message. */
export function describeFailure(f: StageFailure): string {
  const ids = Object.entries(f.entity).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${v}`).join(' ');
  return [`${f.code}`, `[${f.cls}${f.retryable ? ' retryable' : ''}]`, ids, `— ${f.message}`]
    .filter(Boolean).join(' ');
}
