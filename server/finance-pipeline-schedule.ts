/**
 * finance-pipeline-schedule.ts
 *
 * When the nightly finance pipeline should run — as pure arithmetic over the
 * clock and the run ledger. No database, no Sippy, no imports at all, so the
 * decision can be tested exhaustively rather than observed in production.
 *
 * Kept out of daily-pipeline.service.ts for the same reason billing-periods.ts
 * is kept out of the invoice engine: the service cannot be imported without a
 * live DATABASE_URL, and rules this consequential should not need one.
 *
 * ── Why the schedule is a catch-up, not a clock ──────────────────────────────
 * The deployed process restarts frequently and sleeps for hours: in
 * materialization_runs, 24 Aug 19:02 -> 25 Aug 08:34 is a single gap, and it
 * swallows 07:00 UTC. A timer set 24 hours ahead only fires if the process
 * survives 24 hours, which this one does not — so the DMR email's daily
 * setTimeout could go weeks without firing while looking correctly registered
 * in the boot log.
 *
 * The rule here instead asks, every few minutes, "has this business date been
 * processed yet?" Whenever the process is awake past the scheduled hour, the
 * day gets processed. The pipeline can therefore run LATE, but it cannot be
 * silently skipped — and lateness is visible as started_at against target_date.
 */

/**
 * Default hour (UTC) after which a business day is ready to process.
 *
 * 02:00 rather than 00:05: the target date is yesterday, and at 00:05 it ended
 * five minutes ago — Sippy is still flushing late CDRs, rotating daily tables
 * and closing rating batches, so a midnight run risks billing a short day. Two
 * hours clears that without pushing the finance team's reconciliation into
 * their working morning (02:00 UTC is 06:00 Gulf, 07:00 Pakistan).
 *
 * It was 07:00, inherited from the old DMR email rather than reasoned about.
 * Override with FINANCE_PIPELINE_HOUR_UTC.
 */
export const DEFAULT_SCHEDULED_HOUR_UTC = 2;

/** Attempts per business date before the scheduler stops and waits for a human. */
export const DEFAULT_MAX_ATTEMPTS = 3;

/** A 'running' row older than this belonged to a process that died mid-run. */
export const DEFAULT_STALE_RUNNING_MS = 30 * 60 * 1000;

// ── Stage dependencies ────────────────────────────────────────────────────────

export type StageName =
  | 'dmr' | 'snapshot' | 'dmr-email' | 'margin' | 'assurance' | 'billing-cycles';

/**
 * What each stage needs to have SUCCEEDED before it can mean anything.
 *
 * Derived from what the code actually reads, not from the order the stages
 * happen to run in — the two are easy to confuse and the difference decides
 * whether billing stops:
 *
 *   snapshot     reads daily_minutes_reports          -> dmr
 *   dmr-email    reads daily_minutes_reports          -> dmr
 *   margin       reads daily_minutes_reports          -> dmr   (NOT snapshot)
 *   assurance    reads DMR + invoices + recon + notes -> dmr   (NOT snapshot,
 *                                                               NOT margin)
 *   billing-cycles reads sippy accounts + invoices    -> nothing
 *
 * So this is a STAR with dmr at the centre, not a chain. A linear chain would
 * have two costs, both real: a snapshot failure would block margin and
 * assurance, which never read the snapshot; and an AI-assurance failure would
 * block invoice job creation, even though assurance is advisory by design
 * (its own UI says "AI suggests, humans approve") and billing-cycle detection
 * reads none of its output. Stopping billing because an advisory scan errored
 * would be a worse failure than the scan itself.
 */
export const STAGE_PREREQUISITES: Record<StageName, StageName[]> = {
  'dmr':            [],
  'snapshot':       ['dmr'],
  'dmr-email':      ['dmr'],
  'margin':         ['dmr'],
  'assurance':      ['dmr'],
  'billing-cycles': [],
};

/** Just enough of a finished stage to decide whether its dependents may run. */
export interface StageStatus {
  stage:  StageName;
  status: 'success' | 'failed' | 'skipped';
}

/**
 * Names the failed prerequisite blocking a stage, or null if it may run.
 *
 * Only 'failed' blocks. 'skipped' does NOT — a skip means the work was
 * unnecessary, not that it went wrong: the DMR stage skips when rows for the
 * date already exist, which is the single most common case and leaves every
 * dependent perfectly satisfied. Treating skip as failure would stall the
 * whole pipeline on its healthiest path.
 *
 * A prerequisite that has not run at all also does not block, so the function
 * stays correct if stages are ever reordered or run selectively.
 */
export function blockedBy(stage: StageName, completed: StageStatus[]): StageName | null {
  for (const prereq of STAGE_PREREQUISITES[stage] ?? []) {
    const outcome = completed.find(c => c.stage === prereq);
    if (outcome?.status === 'failed') return prereq;
  }
  return null;
}

/** The subset of a ledger row the due decision depends on. */
export interface AttemptRow {
  id:        number;
  status:    string;
  startedAt: string | Date;
}

export interface DueDecision {
  due:        boolean;
  targetDate: string;
  reason:     string;
}

/**
 * Yesterday UTC — the most recent complete business day.
 *
 * UTC throughout: the business date must not depend on the container's
 * timezone, and DMR windows are already defined as full GMT calendar days.
 */
export function defaultTargetDate(now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  return d.toISOString().slice(0, 10);
}

/**
 * Whether the pipeline should run now, given the clock and this date's attempts.
 *
 * Each branch prevents a specific production failure: double-running a date
 * (duplicate DMR email, duplicate invoice jobs), stalling forever behind a
 * 'running' row whose process was killed, and retrying a structural failure
 * every ten minutes with nobody watching.
 */
export function decideDue(
  rows: AttemptRow[],
  now: Date,
  opts: { scheduledHourUtc?: number; maxAttempts?: number; staleRunningMs?: number } = {},
): DueDecision {
  const hour        = opts.scheduledHourUtc ?? DEFAULT_SCHEDULED_HOUR_UTC;
  const maxAttempts = opts.maxAttempts      ?? DEFAULT_MAX_ATTEMPTS;
  const staleMs     = opts.staleRunningMs   ?? DEFAULT_STALE_RUNNING_MS;
  const targetDate  = defaultTargetDate(now);

  if (now.getUTCHours() < hour) {
    return { due: false, targetDate, reason: `before ${String(hour).padStart(2, '0')}:00 UTC` };
  }

  if (rows.some(r => r.status === 'success')) {
    return { due: false, targetDate, reason: 'already completed successfully' };
  }

  const live = rows.find(r =>
    r.status === 'running' &&
    now.getTime() - new Date(r.startedAt).getTime() < staleMs,
  );
  if (live) return { due: false, targetDate, reason: `run #${live.id} in progress` };

  if (rows.length >= maxAttempts) {
    return { due: false, targetDate, reason: `${rows.length} attempts already made — needs investigation` };
  }

  return {
    due: true,
    targetDate,
    reason: rows.length === 0 ? 'no run yet' : `retry ${rows.length + 1}/${maxAttempts}`,
  };
}
