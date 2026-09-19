/**
 * Boot-time reconciliation — the orchestrator. All I/O is injected, so this file has no DB and
 * no Sippy import and its whole behaviour is testable with fakes; the real dependencies are wired
 * in reconcile-boot.ts.
 *
 * DESIGN NOTE — no status-flip claim (changed from the first sketch, owner flagged 2026-09-18).
 * The plan floated claiming a job by flipping its status to `reconciling` before probing. That
 * has a failure mode: if the process dies (or Sippy goes down) after the claim and before the
 * verdict, the row is stuck at `reconciling` — outside the (pending|processing) eligible set —
 * and no later boot re-sweeps it. Instead the "claim" is the terminal write itself, made
 * CONDITIONAL on the row still being non-terminal (`WHERE status IN ('pending','processing')`).
 * Two Autoscale instances may both read back the same job — wasteful but safe: read-back is
 * idempotent, both classify the same tariff to the same verdict, and the first conditional write
 * wins while the second no-ops. There is no intermediate state to get stuck in, and a job left
 * unprocessed (Sippy died mid-sweep) is simply still eligible next boot.
 */
import {
  classifyReadback,
  classifyOperation,
  advanceUnavailable,
  hasVerifiableIntent,
  hasOperationIntent,
  jobVerdictFromOperations,
  type RateIntent,
  type Readback,
  type ReconcileVerdict,
  type NonTerminalStatus,
  type OperationIntentSet,
  type OperationVerdict,
} from './reconcile-core';

export interface ReconcileJob {
  jobId: string;
  status: NonTerminalStatus;
  verificationResult: string | null;
  /** The target tariff for the read-back. NULL means the job never resolved one → unverifiable. */
  iTariff: number | null;
  intents: RateIntent[];
  /**
   * The SECOND intent source, from `rate_push_operations` — loaded only when `intents` is empty,
   * and consulted only then. A push-batch job never stamps newRate at insert, so its intent lives
   * on its operation rows; a change-client-rates job has job-level intent and never reaches this.
   */
  operations?: OperationIntentSet;
}

/** Job-level intent first; operation-row intent only when the job row yields none. */
export function isReconcilable(job: ReconcileJob): boolean {
  return hasVerifiableIntent(job.iTariff, job.intents) || (job.intents.length === 0 && hasOperationIntent(job.operations));
}

/** A read-back that distinguishes "reachable but ambiguous" from "could not reach Sippy". */
export type ReadbackResult =
  | { reachable: true; readback: Readback }
  | { reachable: false };

export interface ReconcileDeps {
  now(): Date;
  staleMs: number;
  unavailableCeiling: number;
  /** One availability probe — the circuit breaker for the whole sweep. */
  probeSippy(): Promise<boolean>;
  /** Stale, non-terminal jobs, oldest first. No claim/flip — see the design note above. */
  listStaleJobs(now: Date, staleMs: number): Promise<ReconcileJob[]>;
  /** Read back the target tariff for a job; reachable:false when Sippy could not be reached. */
  readbackTariff(job: ReconcileJob): Promise<ReadbackResult>;
  /** Read back ONE tariff by id — the operation path reads each distinct tariff of a job once. */
  readbackByTariff(iTariff: number): Promise<ReadbackResult>;
  /** Write a terminal verdict — CONDITIONAL on the row still being non-terminal (the real claim). */
  writeVerdict(jobId: string, verdict: ReconcileVerdict): Promise<void>;
  /**
   * Write per-operation verdicts and settle never-started rows — each CONDITIONAL on the row's
   * current status — then stamp the parent from its rows, conditional on non-terminal.
   */
  writeOperationOutcome(jobId: string, outcome: { verdicts: OperationVerdict[]; notAttempted: string[] }): Promise<void>;
  /** Record an unavailable outcome — CONDITIONAL on non-terminal, so an escalation is not resurrected. */
  writeUnavailable(job: ReconcileJob, outcome: ReturnType<typeof advanceUnavailable>): Promise<void>;
  log(msg: string): void;
}

export interface ReconcileSummary {
  sippyReachable: boolean;
  /** Jobs with enough recorded intent to reconcile — the ones actually probed and read back. */
  examined: number;
  success: number;
  failure: number;
  indeterminate: number;
  /** Jobs left eligible because Sippy was unreachable (at probe, or mid-sweep). */
  deferred: number;
  /** Jobs escalated to human review after too many unavailable boots. */
  escalated: number;
  /** Stale non-terminal jobs that recorded no verifiable intent — left entirely untouched. */
  skippedNoIntent: number;
  /**
   * Jobs whose operation rows exist but cannot be verified as a set (a running row with no tariff,
   * prefix or rate). Left entirely untouched, like no-intent — reported separately so the log
   * says which it was.
   */
  skippedAmbiguous: number;
  /** Of `examined`, how many were reconciled from operation rows rather than the job row. */
  viaOperations: number;
  /** True when a mid-sweep read-back revealed Sippy had gone down and the sweep stopped early. */
  circuitTripped: boolean;
}

const empty = (): ReconcileSummary => ({
  sippyReachable: false, examined: 0, success: 0, failure: 0,
  indeterminate: 0, deferred: 0, escalated: 0, skippedNoIntent: 0, skippedAmbiguous: 0,
  viaOperations: 0, circuitTripped: false,
});

/** Bump the unavailable counter for a set of jobs (probe-down path, or mid-sweep tail). */
async function deferAll(deps: ReconcileDeps, jobs: ReconcileJob[], summary: ReconcileSummary): Promise<void> {
  for (const job of jobs) {
    const outcome = advanceUnavailable(job.status, job.verificationResult, deps.unavailableCeiling);
    await deps.writeUnavailable(job, outcome);
    if (outcome.escalate) summary.escalated++;
    else summary.deferred++;
  }
}

/**
 * Run one reconciliation pass. Verify, never retry; read-back authoritative; and "Sippy was
 * unavailable" never becomes "the mutation is indeterminate".
 */
export async function runReconcileSweep(deps: ReconcileDeps): Promise<ReconcileSummary> {
  const summary = empty();
  const now = deps.now();

  // Partition BEFORE any probe or write. A stale non-terminal job that recorded no verifiable
  // intent (no target tariff / no rate — the pre-instrumentation `job-*` orphans, and refusals
  // that never wrote) is left ENTIRELY untouched: not probed, not read, not deferred, not
  // verdicted. Reconciliation must not manufacture an outcome the original push never recorded.
  const all = await deps.listStaleJobs(now, deps.staleMs);
  const jobs = all.filter(isReconcilable);
  for (const s of all) {
    if (isReconcilable(s)) continue;
    if (s.intents.length === 0 && s.operations?.kind === 'ambiguous') {
      summary.skippedAmbiguous++;
      deps.log(`[rate-reconcile] ${s.jobId} → skipped (operation rows ambiguous: ${s.operations.reason} — left unchanged, nothing partially reconciled)`);
    } else {
      summary.skippedNoIntent++;
      deps.log(`[rate-reconcile] ${s.jobId} → skipped (no verifiable intent — left unchanged)`);
    }
  }
  summary.examined = jobs.length;

  // Nothing verifiable ⇒ no probe, no Sippy call at all.
  if (jobs.length === 0) {
    deps.log('[rate-reconcile] no jobs with verifiable intent — nothing to reconcile');
    return summary;
  }

  // Circuit breaker: one probe. If Sippy is down, no job is queried — each is left eligible with
  // its unavailable counter advanced (or escalated once the ceiling is reached).
  if (!(await deps.probeSippy())) {
    await deferAll(deps, jobs, summary);
    deps.log(`[rate-reconcile] Sippy unreachable — ${jobs.length} job(s) left eligible, ${summary.escalated} escalated`);
    return summary;
  }
  summary.sippyReachable = true;

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];

    // ── Operation-row path: only when the job row carries no intent ──────────────────────────
    if (!hasVerifiableIntent(job.iTariff, job.intents) && hasOperationIntent(job.operations)) {
      const { running, pending } = job.operations;

      // One read per distinct tariff. ALL reads happen before ANY write: a job that spans two
      // tariffs and loses Sippy on the second is deferred whole, never half-reconciled.
      const readbacks = new Map<number, Readback>();
      let unreachable = false;
      for (const t of [...new Set(running.map(o => o.iTariff))]) {
        const rr = await deps.readbackByTariff(t);
        if (!rr.reachable) { unreachable = true; break; }
        readbacks.set(t, rr.readback);
      }
      if (unreachable) {
        summary.circuitTripped = true;
        await deferAll(deps, jobs.slice(i), summary);
        deps.log(`[rate-reconcile] Sippy went down mid-sweep at ${job.jobId} — deferred ${jobs.length - i} remaining`);
        break;
      }

      // Each running row judged on its own from its tariff's read; the group it was uploaded in
      // is invisible here, exactly as it is invisible in the run's own records.
      const verdicts: OperationVerdict[] = running.map(o => ({
        operationKey: o.operationKey,
        verdict: classifyOperation(o, readbacks.get(o.iTariff)!),
      }));
      await deps.writeOperationOutcome(job.jobId, { verdicts, notAttempted: pending });

      const jobVerdict = jobVerdictFromOperations(verdicts, pending.length);
      summary[jobVerdict]++;
      summary.viaOperations++;
      deps.log(`[rate-reconcile] ${job.jobId} → ${jobVerdict} via ${running.length} operation row(s) read back, ${pending.length} never started`);
      continue;
    }

    const rr = await deps.readbackTariff(job);

    if (!rr.reachable) {
      // Sippy went down mid-sweep. This IS the circuit breaker tripping: stop, and defer this job
      // and every remaining one — an unreachable read is not evidence about the mutation, so it
      // must NOT become indeterminate.
      summary.circuitTripped = true;
      await deferAll(deps, jobs.slice(i), summary);
      deps.log(`[rate-reconcile] Sippy went down mid-sweep at ${job.jobId} — deferred ${jobs.length - i} remaining`);
      break;
    }

    const verdict = classifyReadback(job.intents, rr.readback);
    await deps.writeVerdict(job.jobId, verdict);
    summary[verdict]++;
    deps.log(`[rate-reconcile] ${job.jobId} → ${verdict}`);
  }

  return summary;
}
