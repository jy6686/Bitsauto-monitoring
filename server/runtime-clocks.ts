/**
 * runtime-clocks.ts — which clock is this process actually keeping?
 *
 * WHY THIS EXISTS. Every business day, every collection window and every slice
 * boundary in this platform is UTC, and an audit of the collection path found
 * zero local-time accessors. And yet for two days the dashboard reported every
 * daily artefact one business day stale, with a false "Run DMR" warning
 * attached. The defect was in none of that code: node-postgres materialises a
 * DATE column into a JS Date at the PROCESS's local midnight, this host runs
 * PKT (+0500), and 2026-09-02 came back as 2026-09-01T19:00Z.
 *
 * Reading the source could not have found it, because the source was correct.
 * Only asking the running process would have.
 *
 * So this module does not report configuration — it reports a MEASUREMENT. The
 * caller pushes a known date through the real driver, both as a DATE and cast
 * ::text, normalises both through the exact function the defect travelled
 * through, and hands the results here. If the two disagree, the driver is
 * shifting days right now, on this host, whatever the settings claim.
 *
 * A page that listed "Process TZ: UTC" would have said nothing useful. This
 * one can say: a DATE round-trip is losing a day.
 *
 * Pure: no clock, no DB, no environment. The caller measures; this judges.
 */

export type ClockSeverity = 'critical' | 'warning' | 'info';

export interface ClockFinding {
  severity: ClockSeverity;
  /** One sentence naming what is wrong, or confirming what was checked. */
  claim: string;
  /** The evidence, with the values that produced the verdict. */
  detail: string;
}

/**
 * A known date pushed through the driver and back.
 *
 * `viaDate` is what a bare `SELECT DATE 'x'` becomes after normalisation —
 * the path that broke. `viaText` is the same value cast `::text` — the path
 * the queries use now. Both are the caller's OBSERVATION, not an assumption.
 */
export interface DateRoundTrip {
  /** The day put in, e.g. '2026-09-02'. */
  expected: string;
  /** Normalised result of the uncast DATE column. null when unavailable. */
  viaDate: string | null;
  /** Normalised result of the ::text cast. null when unavailable. */
  viaText: string | null;
}

export interface ClockInputs {
  /** Intl's resolved zone for this process, e.g. 'UTC' or 'Asia/Karachi'. */
  processTz?: string | null;
  /** process.env.TZ verbatim — undefined means it was never pinned. */
  envTz?: string | null;
  /** Postgres `current_setting('TimeZone')`. */
  databaseTz?: string | null;
  /** Current instant, ISO. */
  nowIso: string;
  collectionWindowUtc: { startHour: number; endHour: number };
  pipelineHourUtc: number;
  roundTrip?: DateRoundTrip | null;
  /** Why the round-trip could not be measured, when it could not. */
  roundTripError?: string | null;
}

export interface ClockReport {
  /** False when anything is actively wrong, not merely unpinned. */
  ok: boolean;
  businessDayBasis: 'UTC';
  processTz: string;
  envTz: string;
  databaseTz: string;
  nowUtc: string;
  /** The business day the platform would collect right now. */
  businessDayNow: string;
  collectionWindowUtc: string;
  pipelineHourUtc: string;
  roundTrip: DateRoundTrip | null;
  findings: ClockFinding[];
  /** One line for the top of the panel. */
  summary: string;
}

const UTC_ALIASES = new Set(['utc', 'etc/utc', 'gmt', 'etc/gmt', 'z', '+00', '+00:00', 'utc+0']);

export function isUtcZone(tz?: string | null): boolean {
  return UTC_ALIASES.has(String(tz ?? '').trim().toLowerCase());
}

export function assessRuntimeClocks(input: ClockInputs): ClockReport {
  const findings: ClockFinding[] = [];
  const processTz  = String(input.processTz ?? '').trim() || 'unknown';
  const envTz      = String(input.envTz ?? '').trim() || '(not set)';
  const databaseTz = String(input.databaseTz ?? '').trim() || 'unknown';
  const rt         = input.roundTrip ?? null;

  // ── The measurement, first, because it is the only thing here that can
  // prove a live defect rather than describe a risk. ─────────────────────
  if (input.roundTripError) {
    findings.push({
      severity: 'warning',
      claim: 'The DATE round-trip could not be measured.',
      detail: `${input.roundTripError} — this page cannot confirm whether the ` +
              'driver is shifting business days on this host.',
    });
  } else if (!rt) {
    findings.push({
      severity: 'warning',
      claim: 'No DATE round-trip was attempted.',
      detail: 'Without it, the timezone rows below are configuration, not evidence.',
    });
  } else {
    const dateOk = rt.viaDate === rt.expected;
    const textOk = rt.viaText === rt.expected;

    if (!textOk) {
      // The path the queries actually use. If this is wrong, business days are
      // wrong everywhere on the dashboard right now.
      findings.push({
        severity: 'critical',
        claim: 'A ::text DATE round-trip is losing a day RIGHT NOW.',
        detail: `Put in ${rt.expected}, got back ${rt.viaText ?? 'nothing'} through the cast ` +
                'the freshness queries rely on. Every daily artefact will read the wrong ' +
                'business day until this is resolved.',
      });
    }
    if (!dateOk) {
      findings.push({
        severity: textOk ? 'warning' : 'critical',
        claim: 'An UNCAST DATE column shifts the business day on this host.',
        detail: `Put in ${rt.expected}, got back ${rt.viaDate ?? 'nothing'} without a ::text ` +
                `cast (process zone ${processTz}). This is the exact defect that made every ` +
                'daily artefact read one day stale. The queries cast, so it is contained — ' +
                'but any NEW query selecting a DATE column without ::text will reintroduce it.',
      });
    }
    if (dateOk && textOk) {
      findings.push({
        severity: 'info',
        claim: 'DATE round-trip is clean in both forms.',
        detail: `${rt.expected} survives both the raw DATE column and the ::text cast. ` +
                'A new query that forgets the cast would still be safe on this host.',
      });
    }
  }

  // ── Configuration, second. A risk, not a defect. ────────────────────────
  if (!isUtcZone(processTz)) {
    findings.push({
      severity: 'warning',
      claim: `Process timezone is ${processTz}, not UTC.`,
      detail: 'Every business day, collection window and slice boundary uses explicit UTC ' +
              'APIs, so this does not change what is collected. It does mean one ' +
              'getHours() where getUTCHours() was meant would be wrong by ' +
              `${processTz}'s offset instead of harmless. Pin TZ=UTC.`,
    });
  }
  if (!isUtcZone(input.envTz)) {
    findings.push({
      severity: 'info',
      claim: 'TZ is not pinned in the environment.',
      detail: `TZ=${envTz}. The process then inherits the host's zone, which is how this ` +
              "host's PKT reached the Postgres driver.",
    });
  }
  if (databaseTz !== 'unknown' && !isUtcZone(databaseTz)) {
    findings.push({
      severity: 'info',
      claim: `Database session timezone is ${databaseTz}.`,
      detail: 'Timestamps are stored with time zone and business days are compared as ' +
              'plain calendar dates, so this is not load-bearing — but it is worth ' +
              'knowing when reading raw SQL output.',
    });
  }

  const worst: ClockSeverity =
    findings.some(f => f.severity === 'critical') ? 'critical'
    : findings.some(f => f.severity === 'warning') ? 'warning'
    : 'info';

  const nowMs = Date.parse(input.nowIso);
  const nowUtc = Number.isFinite(nowMs)
    ? new Date(nowMs).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
    : 'unreadable';
  // The day the collector would target: yesterday UTC. Stated so the page
  // answers "which day are we on" without anyone deriving it by hand.
  const businessDayNow = Number.isFinite(nowMs)
    ? new Date(nowMs - 86_400_000).toISOString().slice(0, 10)
    : 'unreadable';

  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    ok: worst !== 'critical',
    businessDayBasis: 'UTC',
    processTz, envTz, databaseTz, nowUtc, businessDayNow,
    collectionWindowUtc:
      `${pad(input.collectionWindowUtc.startHour)}:00–${pad(input.collectionWindowUtc.endHour)}:00 UTC`,
    pipelineHourUtc: `${pad(input.pipelineHourUtc)}:00 UTC`,
    roundTrip: rt,
    findings,
    summary:
      worst === 'critical'
        ? 'Business days are being read incorrectly on this host — see below.'
        : worst === 'warning'
          ? 'Business days read correctly, but the process is not pinned to UTC.'
          : 'All clocks agree: business days are UTC and round-trip cleanly.',
  };
}
