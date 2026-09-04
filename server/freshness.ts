/**
 * freshness.ts — is a daily artefact current, asked the way a daily artefact
 * can actually answer.
 *
 * WHY THIS EXISTS. The Finance health endpoint measured freshness one way for
 * everything: minutes since `latest`, compared against an SLA in minutes. That
 * works for a timestamp. It does not work for the three artefacts it was
 * mostly applied to, because their `latest` is `MAX(date)` — a CALENDAR DATE
 * naming the business day the row covers, not the moment the row was written.
 *
 * Those are different quantities and the gap between them is a whole day. A
 * DMR covering 2026-09-02, written promptly at 03:00 on 09-03, parses as
 * midnight 09-02 and is therefore "32 hours old" by 08:22 on 09-03 — stale
 * under any SLA under 32h, five hours after it was successfully produced. The
 * arithmetic is measuring the age of the DAY, and the day keeps ageing no
 * matter how fresh the row is.
 *
 * Raising the number does not fix it. 26h was already the second attempt: the
 * first was 15 minutes, which left the card red 23h45m out of every 24. Both
 * are the same mistake at different magnitudes, because no minute count can
 * separate "yesterday's report is missing" from "yesterday was a while ago".
 * The comment above the constants had already written down the correct
 * question — "is there one for yesterday", not "was it written in the last N
 * minutes" — and then the code went on asking the second one.
 *
 * So a daily artefact is judged by COVERAGE: which business day does the newest
 * row describe, and is that the day we should have by now?
 *
 * The one subtlety is the morning. Between 00:00 UTC and the pipeline's run,
 * yesterday's report legitimately does not exist yet, and demanding it would
 * turn every night into a false alarm — the failure this module exists to
 * stop, inverted. Until the pipeline hour plus a grace period, the newest day
 * we can fairly expect is the day before yesterday.
 *
 * Pure: no DB, no clock, no environment. The caller passes `now`.
 */

export type FreshnessStatus = 'healthy' | 'stale' | 'never';

const DAY_MS = 86_400_000;

/** UTC calendar day as YYYY-MM-DD. */
export function dayKeyUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Midnight UTC of a YYYY-MM-DD key. NaN when unparseable. */
export function dayStartMs(key: string): number {
  return Date.parse(`${key}T00:00:00Z`);
}

export interface DailyFreshnessInput {
  /**
   * `MAX(date)` from the artefact's table: the newest business day covered.
   * Accepts a date string, a Date, or null when the table is empty. A full
   * timestamp is truncated to its UTC day — the day is the only part that
   * carries meaning here.
   */
  latestDate: string | Date | null | undefined;
  /** Evaluation time, ms. */
  nowMs: number;
  /**
   * The UTC hour the producing pipeline targets. Before this hour, yesterday's
   * report is not yet owed.
   */
  scheduledHourUtc: number;
  /**
   * How long after the scheduled hour the run may legitimately take before its
   * absence counts against freshness. The pipeline is catch-up scheduled and
   * explicitly allowed to run LATE — six hours keeps a late run from reading
   * as a missing one, while still surfacing a day that never arrives.
   */
  graceHours?: number;
}

export interface DailyFreshness {
  status: FreshnessStatus;
  /** The newest day covered, or null. */
  coveredDay: string | null;
  /** The newest day it is fair to expect by `nowMs`. */
  expectedDay: string | null;
  /** How many business days behind expectation. 0 when healthy. */
  daysBehind: number | null;
  /** Operator-facing, naming the days rather than a minute count. */
  detail: string;
}

export const DEFAULT_GRACE_HOURS = 6;

/**
 * Freshness of an artefact keyed by business day.
 *
 * Deliberately NOT symmetric about lateness: a report arriving late is not the
 * same failure as a report never arriving, and only the second is worth waking
 * anyone for. One day behind expectation is `stale`; the status does not
 * escalate beyond that, but `daysBehind` carries the magnitude so a caller can
 * escalate on its own evidence rather than on a threshold buried here.
 */
export function dailyFreshness(input: DailyFreshnessInput): DailyFreshness {
  const { latestDate, nowMs, scheduledHourUtc } = input;
  const graceHours = input.graceHours ?? DEFAULT_GRACE_HOURS;

  const coveredDay = normaliseDay(latestDate);
  const todayKey   = dayKeyUtc(nowMs);
  const todayStart = dayStartMs(todayKey);

  // What is fairly owed right now. Before the pipeline hour plus grace,
  // yesterday's report is not late — it has not been asked for yet.
  const owedThreshold = todayStart + (scheduledHourUtc + graceHours) * 3_600_000;
  const expectedMs    = nowMs >= owedThreshold ? todayStart - DAY_MS : todayStart - 2 * DAY_MS;
  const expectedDay   = dayKeyUtc(expectedMs);

  if (!coveredDay) {
    return {
      status: 'never', coveredDay: null, expectedDay, daysBehind: null,
      detail: `No rows at all. The newest expected business day is ${expectedDay}.`,
    };
  }

  const coveredMs = dayStartMs(coveredDay);
  if (!Number.isFinite(coveredMs)) {
    return {
      status: 'never', coveredDay, expectedDay, daysBehind: null,
      detail: `Newest value ${JSON.stringify(String(latestDate))} is not a date.`,
    };
  }

  const daysBehind = Math.round((expectedMs - coveredMs) / DAY_MS);

  // Ahead of expectation is healthy, not an anomaly: a run that happens early,
  // or a same-day partial, covers MORE than was owed.
  if (daysBehind <= 0) {
    return {
      status: 'healthy', coveredDay, expectedDay, daysBehind: 0,
      detail: coveredDay === expectedDay
        ? `Current — covers ${coveredDay}, the newest business day owed.`
        : `Current — covers ${coveredDay}, ahead of the ${expectedDay} owed.`,
    };
  }

  return {
    status: 'stale', coveredDay, expectedDay, daysBehind,
    detail: `Covers ${coveredDay}; ${expectedDay} is owed — ` +
            `${daysBehind} business ${daysBehind === 1 ? 'day' : 'days'} behind.`,
  };
}

/**
 * Exported so the runtime-clock self-check can push a real driver value
 * through the EXACT function the timezone defect travelled through. A probe
 * that reimplements this would prove something about the probe.
 */
export function normaliseDay(v: string | Date | null | undefined): string | null {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : dayKeyUtc(v.getTime());
  const s = String(v).trim();
  if (!s) return null;
  // A timestamp is truncated to its day; the time part is not evidence here.
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s;
}

/**
 * Freshness of an artefact keyed by a real timestamp — unchanged semantics,
 * kept here so both kinds of question live in one place and a future caller
 * has to CHOOSE which one it is asking rather than defaulting into the wrong
 * one, which is how this defect shipped.
 */
export function timestampFreshness(
  latest: string | Date | null | undefined,
  nowMs: number,
  slaMinutes: number,
): FreshnessStatus {
  if (latest == null) return 'never';
  const ms = latest instanceof Date ? latest.getTime() : Date.parse(String(latest));
  if (!Number.isFinite(ms)) return 'never';
  return (nowMs - ms) / 60_000 <= slaMinutes ? 'healthy' : 'stale';
}
