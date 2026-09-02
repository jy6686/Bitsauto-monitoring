/**
 * nightly-sla.ts — did Finance have its reports before the workday started?
 *
 * The business question, and until now nothing answered it. On 2026-09-02 the
 * collection for 09-01 began at 15:46 UTC against an 02:00 target — thirteen
 * hours and forty-six minutes late — and every surface reported success,
 * because every surface was measuring whether the work COMPLETED, not whether
 * it completed IN TIME. A run that finishes at 16:00 is a successful run and a
 * failed obligation, and only one of those was visible.
 *
 * TWO DEADLINES, NOT ONE, and the difference decides who is woken up.
 *
 *   targetFinish     the operational window (03:00). Overrunning it is a
 *                    capacity signal: the run is growing, look at workers.
 *   businessDeadline when staff start work (08:00). Missing THIS is the
 *                    failure the business feels — Finance opens the dashboard
 *                    and the reports are not there.
 *
 * Collapsing them into one threshold produces either an alarm that fires on
 * every slightly-long night, or one that stays silent until the morning is
 * already ruined. A 03:37 finish is worth noticing and is not worth waking
 * anyone for; an 08:30 finish is the opposite.
 *
 * AND "DID NOT RUN" IS NOT "LATE". A run that has not started at 07:00 is a
 * different fault from one that started at 02:03 and is still going, needs a
 * different response, and until today produced the same silence. See
 * [[long-timers-never-fire]] — the process was simply absent at 02:00.
 *
 * Dependency-free so the clock arithmetic is pinned by tests.
 */

export type SlaOutcome =
  /** Started on time and finished before the operational target. */
  | 'PASS'
  /** Finished after the target but before the business deadline. */
  | 'OVERRAN'
  /** Started late — the run itself may still be fine. */
  | 'LATE_START'
  /** Not finished by the business deadline. The failure that is felt. */
  | 'MISSED_BUSINESS_DEADLINE'
  /** Never started, and the deadline has passed. */
  | 'DID_NOT_RUN'
  /** Started, still going, deadline not yet reached. */
  | 'IN_PROGRESS';

export interface SlaAssessment {
  outcome:  SlaOutcome;
  /** Minutes after the target start. Negative means early. */
  startDelayMin:  number | null;
  /** Minutes after the operational target finish. */
  finishOverrunMin: number | null;
  /** Minutes to spare before the business deadline. Negative means missed. */
  marginToBusinessMin: number | null;
  /** True only for PASS and IN_PROGRESS — everything else needs a person. */
  acceptable: boolean;
  reason:   string;
}

const MIN = 60_000;
/** The instant an hour-of-day falls on, for the business date being collected. */
function targetAt(businessDate: string, hourUtc: number, dayOffset = 1): number {
  // Offset 1 because the run for business date D happens on D+1: the day must
  // close before it can be collected.
  return Date.parse(`${businessDate}T00:00:00Z`) + dayOffset * 86_400_000 + hourUtc * 3_600_000;
}

export function assessNightlySla(opts: {
  /** The business date being collected, YYYY-MM-DD. */
  businessDate:  string;
  startedAtIso:  string | null;
  finishedAtIso: string | null;
  nowIso:        string;
  /** UTC hour the run should begin. */
  targetStartHour?:  number;
  /** UTC hour the run should be finished by. */
  targetFinishHour?: number;
  /** UTC hour staff begin work — the deadline that is actually felt. */
  businessDeadlineHour?: number;
  /**
   * Minutes after the target start that still count as on time.
   *
   * Not politeness — arithmetic. The scheduler ticks every 10 minutes and its
   * first tick is 60s after boot, so a start a few minutes past the hour is
   * NORMAL OPERATION, not a deviation. Flagging 02:01 against an 02:00 target
   * would make LATE_START fire on almost every healthy night, and an alarm
   * that fires on healthy nights is the defect this file was written to
   * replace, not to reproduce.
   */
  startGraceMin?: number;
}): SlaAssessment {
  const startHour    = opts.targetStartHour ?? 2;
  const finishHour   = opts.targetFinishHour ?? 3;
  const businessHour = opts.businessDeadlineHour ?? 8;

  const tStart    = targetAt(opts.businessDate, startHour);
  const tFinish   = targetAt(opts.businessDate, finishHour);
  const tBusiness = targetAt(opts.businessDate, businessHour);

  const now      = Date.parse(opts.nowIso);
  const started  = opts.startedAtIso  ? Date.parse(opts.startedAtIso)  : NaN;
  const finished = opts.finishedAtIso ? Date.parse(opts.finishedAtIso) : NaN;

  const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);
  const mins = (a: number, b: number) => Math.round((a - b) / MIN);

  // Never started.
  if (!Number.isFinite(started)) {
    if (Number.isFinite(now) && now >= tBusiness) {
      return {
        outcome: 'DID_NOT_RUN', startDelayMin: null, finishOverrunMin: null,
        marginToBusinessMin: mins(tBusiness, now), acceptable: false,
        reason: `No collection ran for ${opts.businessDate}. It was due to start at ` +
                `${hhmm(tStart)} UTC and the ${hhmm(tBusiness)} business deadline has passed — ` +
                'Finance has no reports for this day. A run that never started is not a late run: ' +
                'check that the process was alive at the scheduled hour.',
      };
    }
    return {
      outcome: 'IN_PROGRESS', startDelayMin: null, finishOverrunMin: null,
      marginToBusinessMin: Number.isFinite(now) ? mins(tBusiness, now) : null,
      acceptable: true,
      reason: `Not started yet; due at ${hhmm(tStart)} UTC.`,
    };
  }

  const graceMin = opts.startGraceMin ?? 15;
  const startDelayMin = mins(started, tStart);
  const lateStart = startDelayMin > graceMin;

  // Started but not finished.
  if (!Number.isFinite(finished)) {
    if (Number.isFinite(now) && now >= tBusiness) {
      return {
        outcome: 'MISSED_BUSINESS_DEADLINE', startDelayMin,
        finishOverrunMin: mins(now, tFinish), marginToBusinessMin: mins(tBusiness, now),
        acceptable: false,
        reason: `Still running at the ${hhmm(tBusiness)} UTC business deadline, ` +
                `${mins(now, started)} minutes in. Finance is starting work without ` +
                `${opts.businessDate}'s reports.`,
      };
    }
    return {
      outcome: 'IN_PROGRESS', startDelayMin, finishOverrunMin: null,
      marginToBusinessMin: Number.isFinite(now) ? mins(tBusiness, now) : null,
      acceptable: true,
      reason: lateStart
        ? `Running, started ${startDelayMin} min after the ${hhmm(tStart)} UTC target.`
        : `Running, started on time at ${hhmm(started)} UTC.`,
    };
  }

  const finishOverrunMin = mins(finished, tFinish);
  const marginToBusinessMin = mins(tBusiness, finished);

  // Missing the business deadline outranks everything: it is the only outcome
  // the business actually experiences.
  if (finished > tBusiness) {
    return {
      outcome: 'MISSED_BUSINESS_DEADLINE', startDelayMin, finishOverrunMin, marginToBusinessMin,
      acceptable: false,
      reason: `Finished ${hhmm(finished)} UTC, ${Math.abs(marginToBusinessMin)} minutes AFTER the ` +
              `${hhmm(tBusiness)} business deadline. Finance began work without ${opts.businessDate}'s ` +
              'reports — this is the failure the business feels, whatever the run itself did.',
    };
  }

  if (lateStart) {
    return {
      outcome: 'LATE_START', startDelayMin, finishOverrunMin, marginToBusinessMin,
      acceptable: false,
      reason: `Started ${startDelayMin} minutes late (${hhmm(started)} vs ${hhmm(tStart)} UTC, ` +
              `${graceMin} min grace) but ` +
              `finished ${hhmm(finished)}, ${marginToBusinessMin} minutes inside the business ` +
              'deadline. The reports arrived; the schedule did not hold.',
    };
  }

  if (finished > tFinish) {
    return {
      outcome: 'OVERRAN', startDelayMin, finishOverrunMin, marginToBusinessMin,
      acceptable: false,
      reason: `Ran ${finishOverrunMin} minutes past the ${hhmm(tFinish)} UTC target, finishing ` +
              `${hhmm(finished)} with ${marginToBusinessMin} minutes to spare before staff start. ` +
              'A capacity signal, not a missed obligation — look at worker count before it becomes one.',
    };
  }

  return {
    outcome: 'PASS', startDelayMin, finishOverrunMin, marginToBusinessMin, acceptable: true,
    reason: `Started ${hhmm(started)}, finished ${hhmm(finished)} UTC — inside the ` +
            `${hhmm(tStart)}–${hhmm(tFinish)} window, ${marginToBusinessMin} minutes before staff start.`,
  };
}
