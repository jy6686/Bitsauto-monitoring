/**
 * stage-liveness.ts — telling "nothing arrived" apart from "a stage stopped".
 *
 * THE FAILURE THIS IS THE INSTRUMENT FOR. Legacy BitsAuto's invoicing design is sound and its
 * production behaviour was broken for five weeks: `generate_client_invoice` ran every 30 minutes
 * while `generate_client_invoice_details` — the pricing engine — and `recalculate_invoices` — the
 * queue consumer — were not in cron at all. Nothing alarmed, because nothing was watching for a
 * stage that produces no output. 47 invoices worth 15,637.33 sat unpriced for one week alone, and
 * the estate looked healthy throughout.
 *
 * The new platform's chain is built end to end, certification and advisory assurance included. What
 * it has never had is an authoritative input — so the FIRST real-traffic run is the one that
 * matters, and without this a stall at rating would look exactly like traffic not having arrived.
 * Building the alarm before the traffic means that run is observed rather than reconstructed.
 *
 * ONE TAXONOMY, NOT TWO. The stages and failure classes come from `stage-failure.ts`; nothing here
 * redefines them. An unregistered stage is refused rather than accepted.
 *
 * THE FIVE DISTINCTIONS THAT MAKE THIS WORTH BUILDING. Collapsing any of them turns the alarm into
 * noise, and an alarm that cries during normal operation is worse than none:
 *
 *   awaiting_input      upstream has produced nothing for this period. NOT this stage's problem.
 *   blocked_upstream    an earlier stage is unhealthy. Reporting this one too multiplies one fault.
 *   no_evidence         expected to run, and there is no sign it ran. THE legacy failure.
 *   ran_without_output  it ran and produced nothing — which may be correct (an empty period) or
 *                       may be the pricing engine silently reaching zero invoices.
 *   failed              it ran and failed, carrying a real stage code.
 *
 * plus `healthy`, `not_expected` (nothing is owed for this period) and `held` (a control state —
 * deliberately not attempted).
 *
 * ADVISORY ONLY, AND STRUCTURALLY SO. This decides nothing about money. It creates no invoice, no
 * snapshot, no payment; it does not retry, reschedule or resolve anything. It is a pure function of
 * observations — no database, no clock of its own, no network — and its test asserts the source
 * performs no write. Same governance line the AI assurance layer states for itself: detect and
 * report, never act.
 *
 * STALENESS IS PER STAGE AND MUST BE SUPPLIED. There is no default, because a collection that has
 * not run for an hour and an invoice stage that has not run for an hour mean entirely different
 * things, and a guessed threshold is how an alarm earns the reputation that gets it muted.
 */
import { STAGES, type Stage, type StageCode, type FailureClass } from './stage-failure';

/** The pipeline order. Upstream blocking is decided by this, not by the caller's array order. */
export const STAGE_ORDER: readonly Stage[] = [
  'collection', 'verification', 'rating', 'snapshot', 'reconciliation', 'invoice',
] as const;

export type LivenessState =
  | 'healthy'
  | 'not_expected'
  | 'awaiting_input'
  | 'blocked_upstream'
  | 'no_evidence'
  | 'ran_without_output'
  | 'failed'
  | 'held'
  | 'stalled';

/** What an owner must be able to say about its stage. Every field is evidence, not inference. */
export interface StageObservation {
  readonly stage: Stage;
  /** Which service or job owns this stage. Recorded so an alarm names someone. */
  readonly owner: string;
  /** Is this stage owed anything for this period at all? */
  readonly expected: boolean;
  /** Did upstream give it something to work on? */
  readonly inputPresent: boolean;
  /** Execution evidence: when it last ran. null = no evidence it ever ran. */
  readonly lastRunAt: number | null;
  /** What it produced on that run. null = not known, which is NOT the same as zero. */
  readonly outputCount: number | null;
  /** An actual failure, when there is one. */
  readonly failure?: { readonly code: StageCode; readonly cls: FailureClass } | null;
  /** How long without a run makes absence actionable FOR THIS STAGE. Required. */
  readonly stalenessMs: number;
  readonly period?: string;
  readonly runId?: string;
  readonly jobId?: string;
  readonly accountId?: string;
}

export interface StageLiveness {
  readonly stage: Stage;
  readonly owner: string;
  readonly state: LivenessState;
  /** Whether a human should be told. False for every benign state. */
  readonly alarm: boolean;
  /** A control state was never attempted, so it spends no retry. Mirrors job-retry-budget. */
  readonly countsAgainstRetryBudget: boolean;
  readonly detail: string;
  readonly code?: StageCode;
  readonly context: {
    readonly period?: string; readonly runId?: string;
    readonly jobId?: string; readonly accountId?: string;
  };
}

const ctxOf = (o: StageObservation) => ({
  ...(o.period ? { period: o.period } : {}),
  ...(o.runId ? { runId: o.runId } : {}),
  ...(o.jobId ? { jobId: o.jobId } : {}),
  ...(o.accountId ? { accountId: o.accountId } : {}),
});

/**
 * Assess one stage. `upstreamHealthy` is false when any earlier stage is in an alarming state —
 * supplied by `assessPipeline`, not guessed here.
 */
export function assessStage(
  o: StageObservation,
  now: number,
  upstreamHealthy = true,
): StageLiveness {
  if (!STAGES.includes(o.stage)) throw new Error(`stage-liveness: ${String(o.stage)} is not a registered stage`);
  if (!Number.isFinite(o.stalenessMs) || o.stalenessMs <= 0) {
    throw new Error(`stage-liveness: ${o.stage} needs a positive stalenessMs; a guessed threshold is how an alarm gets muted`);
  }
  const base = { stage: o.stage, owner: o.owner, context: ctxOf(o) };

  // A control state is not a failure and was never attempted.
  if (o.failure && o.failure.cls === 'control') {
    return { ...base, state: 'held', alarm: false, countsAgainstRetryBudget: false,
      code: o.failure.code, detail: `held, not attempted (${o.failure.code})` };
  }

  // A real failure outranks every liveness question: it ran, and it failed.
  if (o.failure) {
    return { ...base, state: 'failed', alarm: true, countsAgainstRetryBudget: true,
      code: o.failure.code, detail: `failed (${o.failure.code})` };
  }

  // Nothing is owed. Silence is correct.
  if (!o.expected) {
    return { ...base, state: 'not_expected', alarm: false, countsAgainstRetryBudget: false,
      detail: 'nothing expected for this period' };
  }

  // An earlier stage is unhealthy: reporting this one as well multiplies a single fault.
  if (!upstreamHealthy) {
    return { ...base, state: 'blocked_upstream', alarm: false, countsAgainstRetryBudget: false,
      detail: 'an upstream stage is not healthy; this stage is not at fault' };
  }

  // Upstream is fine but produced nothing for this stage to do.
  if (!o.inputPresent) {
    return { ...base, state: 'awaiting_input', alarm: false, countsAgainstRetryBudget: false,
      detail: 'no input has arrived for this period' };
  }

  // THE legacy failure: work waiting, and no sign the stage ever ran.
  if (o.lastRunAt === null) {
    return { ...base, state: 'no_evidence', alarm: true, countsAgainstRetryBudget: false,
      detail: 'input is present and there is no evidence this stage ran' };
  }

  const age = now - o.lastRunAt;
  if (age > o.stalenessMs) {
    return { ...base, state: 'stalled', alarm: true, countsAgainstRetryBudget: false,
      detail: `last ran ${Math.round(age / 1000)}s ago, threshold ${Math.round(o.stalenessMs / 1000)}s` };
  }

  // It ran recently. Did it do anything? `null` is unknown and must not be read as zero.
  if (o.outputCount === 0) {
    return { ...base, state: 'ran_without_output', alarm: true, countsAgainstRetryBudget: false,
      detail: 'ran within threshold but produced no output while input was present' };
  }

  return { ...base, state: 'healthy', alarm: false, countsAgainstRetryBudget: false,
    detail: o.outputCount === null
      ? 'ran within threshold; output not reported'
      : `ran within threshold, produced ${o.outputCount}` };
}

/** States that make a stage unfit to be an upstream dependency. */
const ALARMING: ReadonlySet<LivenessState> = new Set(['failed', 'no_evidence', 'stalled', 'ran_without_output']);

/**
 * Assess the whole chain in pipeline order, so one fault is reported once and everything behind it
 * reads `blocked_upstream` rather than inventing a second alarm. Stages not observed are skipped,
 * and a skipped stage does not block what follows — absence of an observation is not evidence.
 */
export function assessPipeline(observations: readonly StageObservation[], now: number): StageLiveness[] {
  const byStage = new Map<Stage, StageObservation>();
  for (const o of observations) {
    if (!STAGES.includes(o.stage)) throw new Error(`stage-liveness: ${String(o.stage)} is not a registered stage`);
    byStage.set(o.stage, o);
  }
  const out: StageLiveness[] = [];
  let upstreamHealthy = true;
  for (const stage of STAGE_ORDER) {
    const o = byStage.get(stage);
    if (!o) continue;
    const r = assessStage(o, now, upstreamHealthy);
    out.push(r);
    if (ALARMING.has(r.state)) upstreamHealthy = false;
  }
  return out;
}

/** The stages a human should be told about, in pipeline order. */
export function alarms(assessed: readonly StageLiveness[]): StageLiveness[] {
  return assessed.filter(a => a.alarm);
}

/** One line per stage, for a log or a status endpoint. */
export function describeLiveness(a: StageLiveness): string {
  const ids = Object.entries(a.context).map(([k, v]) => `${k}=${v}`).join(' ');
  return [a.stage, `[${a.state}${a.alarm ? ' ALARM' : ''}]`, `owner=${a.owner}`, ids, `— ${a.detail}`]
    .filter(Boolean).join(' ');
}
