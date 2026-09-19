/**
 * The reconciliation run record — pure mapping from a sweep summary to the row that makes the run
 * observable. Kept separate from the sweep so it CANNOT influence a reconciliation decision: the
 * sweep returns its summary first, and only then is this called to shape a record for persistence.
 *
 * It carries provenance (the gitCommit + deploymentId it ran under) so a reader can verify the
 * record came from the deployment currently serving `/api/build`, and it carries nothing else —
 * no credential, no setting, no connection string. The allowlist is the whole surface.
 */
import { type ReconcileSummary } from './reconcile-sweep';

export interface ReconcileRunRecord {
  gitCommit: string | null;
  deploymentId: string | null;
  sippyReachable: boolean;
  examined: number;
  success: number;
  failure: number;
  indeterminate: number;
  deferred: number;
  escalated: number;
  skippedNoIntent: number;
  circuitTripped: boolean;
  /** The no-intent jobs left untouched this run — evidence, not decision input. */
  skippedJobIds: string | null;
  /** The jobs that received a verdict this run. */
  verdictJobIds: string | null;
}

export function buildRunRecord(
  summary: ReconcileSummary,
  build: { gitCommit: string | null; deploymentId: string | null },
  skippedJobIds: string[],
  verdictJobIds: string[],
): ReconcileRunRecord {
  return {
    gitCommit: build.gitCommit ?? null,
    deploymentId: build.deploymentId ?? null,
    sippyReachable: summary.sippyReachable,
    examined: summary.examined,
    success: summary.success,
    failure: summary.failure,
    indeterminate: summary.indeterminate,
    deferred: summary.deferred,
    escalated: summary.escalated,
    // Both kinds of "left untouched", so the count agrees with skippedJobIds (no schema change).
    skippedNoIntent: summary.skippedNoIntent + (summary.skippedAmbiguous ?? 0),
    circuitTripped: summary.circuitTripped,
    skippedJobIds: skippedJobIds.length ? skippedJobIds.join(',') : null,
    verdictJobIds: verdictJobIds.length ? verdictJobIds.join(',') : null,
  };
}
