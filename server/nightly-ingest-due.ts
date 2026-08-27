/**
 * nightly-ingest-due.ts — deciding whether forward CDR capture owes a day.
 *
 * The nightly collector was scheduled with `setTimeout(fn, msUntilMidnightUtc())`
 * — a timer of up to twenty-four hours. This process runs on autoscale: it is
 * recycled, and it sleeps when idle. A timer that long has essentially never
 * fired, which is why the repository only ever contained rows an operator
 * imported by hand.
 *
 * The house rule (memory: "long timers never fire"): schedule by ASKING
 * PERSISTED STATE on a short interval, never by counting down to a distant
 * instant. A tick every ten minutes asks "which day do we still owe?", so a
 * process that starts at 14:00 having missed midnight collects immediately
 * instead of waiting for the next one it will not survive to see.
 *
 * The ledger already exists: _runNightlyReconciliation labels each per-account
 * run `recon-<date>-<iAccount>`, and that label is the seed_jobs primary key.
 * No new table.
 *
 * Backlog draining is deliberate. Returning the OLDEST owed day rather than
 * only yesterday means a process that was down for three days fills all three
 * over successive ticks. A collector that only ever looks one day back can
 * never repair a gap it slept through — and a gap in the repository is not
 * visible in any comparison that reads only the repository.
 *
 * Dependency-free so the date arithmetic is pinned by tests.
 */

/** One recorded attempt at collecting a date, read from seed_jobs. */
export interface ReconAttempt {
  /** The collected day, YYYY-MM-DD (seed_jobs.period_start). */
  date:   string;
  /** seed_jobs.status — 'done' | 'error' | 'running'. */
  status: string;
  /**
   * seed_jobs.started_at. Only consulted for a 'running' row: this process is
   * killed mid-run routinely (autoscale recycles it, a republish stops it), and
   * such a row stays 'running' forever. Without an age, one killed run would
   * mark its day permanently in-flight and the day would never be collected
   * again — a silent, permanent gap.
   */
  startedAtIso?: string;
}

export interface NightlyDecision {
  due:        boolean;
  /** The day to collect, or null when nothing is owed. */
  targetDate: string | null;
  reason:     string;
  /** How many days inside the lookback are still owed, including the target. */
  backlog:    number;
}

export const DEFAULT_EARLIEST_HOUR_UTC = 1;
export const DEFAULT_LOOKBACK_DAYS     = 7;
export const DEFAULT_MAX_ATTEMPTS      = 3;
/** A 'running' row older than this is treated as a dead attempt, not as work
 *  in progress. Generous: a real day's collection is minutes, not hours. */
export const DEFAULT_STALE_RUNNING_MS  = 90 * 60 * 1000;

const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const DAY_MS = 24 * 60 * 60 * 1000;

export function decideNightlyIngest(opts: {
  nowIso:              string;
  attempts:            ReconAttempt[];
  earliestHourUtc?:    number;
  lookbackDays?:       number;
  maxAttemptsPerDate?: number;
  staleRunningMs?:     number;
}): NightlyDecision {
  const nowMs = Date.parse(opts.nowIso);
  if (!Number.isFinite(nowMs)) {
    return { due: false, targetDate: null, reason: 'unparseable clock', backlog: 0 };
  }
  const earliestHour = opts.earliestHourUtc    ?? DEFAULT_EARLIEST_HOUR_UTC;
  const lookback     = Math.max(1, opts.lookbackDays ?? DEFAULT_LOOKBACK_DAYS);
  const maxAttempts  = Math.max(1, opts.maxAttemptsPerDate ?? DEFAULT_MAX_ATTEMPTS);
  const staleMs      = opts.staleRunningMs ?? DEFAULT_STALE_RUNNING_MS;

  /** In flight only while it is plausibly still alive. */
  const isLiveRun = (t: ReconAttempt): boolean => {
    if (t.status !== 'running') return false;
    const started = t.startedAtIso ? Date.parse(t.startedAtIso) : NaN;
    // No timestamp: trust the status rather than invent an age.
    if (!Number.isFinite(started)) return true;
    return nowMs - started < staleMs;
  };

  // Yesterday UTC — the last day that is CLOSED. Collecting today would read a
  // day still in progress and record it as complete.
  const todayMs     = Date.parse(`${dayKey(nowMs)}T00:00:00Z`);
  const yesterday   = dayKey(todayMs - DAY_MS);

  const byDate = new Map<string, ReconAttempt[]>();
  for (const a of opts.attempts) {
    if (!byDate.has(a.date)) byDate.set(a.date, []);
    byDate.get(a.date)!.push(a);
  }

  // A day is only OWED if forward capture was already running when it closed.
  // An empty ledger is a cold start, not a gap: without this, first boot would
  // silently backfill a week against a production switch, unattended. Filling
  // history is an operator decision — this job's remit is to keep up, and to
  // repair what it slept through.
  const known = opts.attempts.map(a => a.date).filter(Boolean).sort();
  const collectingSince = known.length > 0 ? known[0] : dayKey(todayMs - DAY_MS);

  // Oldest first, so a backlog drains in order rather than repeatedly
  // re-collecting the newest day while older gaps stay open.
  const owed: string[] = [];
  let exhausted = 0;
  for (let back = lookback; back >= 1; back--) {
    const date = dayKey(todayMs - back * DAY_MS);
    if (date < collectingSince) continue;
    const tries = byDate.get(date) ?? [];
    if (tries.some(t => t.status === 'done'))    continue;   // collected
    if (tries.some(isLiveRun)) continue;                     // in flight
    if (tries.length >= maxAttempts) { exhausted++; continue; }
    owed.push(date);
  }

  if (owed.length === 0) {
    return {
      due: false, targetDate: null, backlog: 0,
      reason: exhausted > 0
        ? `nothing collectable — ${exhausted} day(s) gave up after ${maxAttempts} attempts`
        : `every day since ${collectingSince} through ${yesterday} collected`,
    };
  }

  const target = owed[0];

  // Yesterday is closed at 00:00 UTC, but the switch is still settling its own
  // records then. Older days carry no such doubt, so the delay applies only to
  // the newest day — a backlog is never held back by it.
  if (target === yesterday && new Date(nowMs).getUTCHours() < earliestHour) {
    return {
      due: false, targetDate: target, backlog: owed.length,
      reason: `${target} is owed but the switch is still settling — collecting after ` +
              `${String(earliestHour).padStart(2, '0')}:00 UTC`,
    };
  }

  return {
    due: true, targetDate: target, backlog: owed.length,
    reason: owed.length > 1
      ? `${target} owed (oldest of ${owed.length} day(s) missing through ${yesterday})`
      : `${target} owed`,
  };
}
