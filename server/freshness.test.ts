import { describe, it, expect } from 'vitest';
import {
  dailyFreshness, timestampFreshness, dayKeyUtc, DEFAULT_GRACE_HOURS,
} from './freshness';

const at = (iso: string) => Date.parse(iso);

/**
 * The measured case, 2026-09-03 08:22Z. Data Freshness read 55% and the DMR
 * card read stale with a perfectly healthy DMR behind it, because the newest
 * DMR covered 2026-09-02 and midnight of 09-02 is 32.4 hours before 08:22 on
 * 09-03. Under a 26h minute-based SLA that is stale; by coverage it is exactly
 * the day that was owed.
 */
describe('the defect this replaces', () => {
  it('calls yesterday-covered healthy where a 26h SLA called it stale', () => {
    const now = at('2026-09-03T08:22:00Z');

    // The old arithmetic, reproduced so the difference is on the record.
    const ageMins = (now - at('2026-09-02T00:00:00Z')) / 60_000;
    expect(ageMins).toBeGreaterThan(26 * 60);          // stale, by 6+ hours
    expect(timestampFreshness('2026-09-02', now, 26 * 60)).toBe('stale');

    const f = dailyFreshness({ latestDate: '2026-09-02', nowMs: now, scheduledHourUtc: 2 });
    expect(f.status).toBe('healthy');
    expect(f.coveredDay).toBe('2026-09-02');
    expect(f.expectedDay).toBe('2026-09-02');
    expect(f.daysBehind).toBe(0);
  });

  it('no minute count could have separated the two cases', () => {
    // Same covered day, twelve hours apart. A minute-based SLA must call these
    // differently; coverage calls them the same, which is the correct answer.
    const early = dailyFreshness({ latestDate: '2026-09-02', nowMs: at('2026-09-03T09:00:00Z'), scheduledHourUtc: 2 });
    const late  = dailyFreshness({ latestDate: '2026-09-02', nowMs: at('2026-09-03T21:00:00Z'), scheduledHourUtc: 2 });
    expect(early.status).toBe('healthy');
    expect(late.status).toBe('healthy');
  });
});

describe('the morning grace window', () => {
  // Between midnight and the pipeline's run, yesterday's report does not exist
  // yet. Demanding it would make every night a false alarm — the same failure
  // this module removes, pointing the other way.
  it('does not owe yesterday before the scheduled hour', () => {
    const f = dailyFreshness({
      latestDate: '2026-09-01', nowMs: at('2026-09-03T01:00:00Z'), scheduledHourUtc: 2,
    });
    expect(f.expectedDay).toBe('2026-09-01');
    expect(f.status).toBe('healthy');
  });

  it('owes yesterday once the hour and the grace have passed', () => {
    const f = dailyFreshness({
      latestDate: '2026-09-01', nowMs: at('2026-09-03T08:01:00Z'), scheduledHourUtc: 2,
    });
    expect(f.expectedDay).toBe('2026-09-02');
    expect(f.status).toBe('stale');
    expect(f.daysBehind).toBe(1);
  });

  it('places the boundary at hour + grace, exactly', () => {
    const base = { latestDate: '2026-09-01', scheduledHourUtc: 2, graceHours: DEFAULT_GRACE_HOURS };
    // 02:00 + 6h = 08:00.
    expect(dailyFreshness({ ...base, nowMs: at('2026-09-03T07:59:59Z') }).status).toBe('healthy');
    expect(dailyFreshness({ ...base, nowMs: at('2026-09-03T08:00:00Z') }).status).toBe('stale');
  });

  it('honours a caller-supplied grace', () => {
    const base = { latestDate: '2026-09-01', nowMs: at('2026-09-03T05:00:00Z'), scheduledHourUtc: 2 };
    expect(dailyFreshness({ ...base, graceHours: 1 }).status).toBe('stale');   // owed since 03:00
    expect(dailyFreshness({ ...base, graceHours: 6 }).status).toBe('healthy'); // not until 08:00
  });
});

describe('genuine staleness still surfaces', () => {
  it('reports a day that never arrived, with its magnitude', () => {
    const f = dailyFreshness({
      latestDate: '2026-08-29', nowMs: at('2026-09-03T08:22:00Z'), scheduledHourUtc: 2,
    });
    expect(f.status).toBe('stale');
    expect(f.daysBehind).toBe(4);
    expect(f.detail).toContain('2026-08-29');
    expect(f.detail).toContain('4 business days behind');
  });

  it('says which days, never a minute count', () => {
    // The point of the rewrite: an operator is told what is missing, not how
    // long ago something happened.
    const f = dailyFreshness({
      latestDate: '2026-09-01', nowMs: at('2026-09-03T08:22:00Z'), scheduledHourUtc: 2,
    });
    expect(f.detail).toMatch(/2026-09-01.*2026-09-02.*1 business day behind/);
    expect(f.detail).not.toMatch(/min|hour/);
  });

  it('an empty table is never, not stale', () => {
    // "Nothing was ever produced" and "production stopped" call for different
    // actions, and collapsing them is how a broken pipeline reads as a late one.
    const f = dailyFreshness({ latestDate: null, nowMs: at('2026-09-03T08:22:00Z'), scheduledHourUtc: 2 });
    expect(f.status).toBe('never');
    expect(f.coveredDay).toBeNull();
    expect(f.daysBehind).toBeNull();
  });

  it('an unparseable value is never, and quotes what it saw', () => {
    const f = dailyFreshness({ latestDate: 'not-a-date', nowMs: at('2026-09-03T08:22:00Z'), scheduledHourUtc: 2 });
    expect(f.status).toBe('never');
    expect(f.detail).toContain('not-a-date');
  });
});

describe('input shapes', () => {
  it('accepts a Date and a full timestamp, truncating to the UTC day', () => {
    const now = at('2026-09-03T08:22:00Z');
    for (const v of ['2026-09-02', '2026-09-02T03:14:00.000Z', new Date('2026-09-02T03:14:00Z')]) {
      const f = dailyFreshness({ latestDate: v as any, nowMs: now, scheduledHourUtc: 2 });
      expect(f.coveredDay).toBe('2026-09-02');
      expect(f.status).toBe('healthy');
    }
  });

  it('treats coverage ahead of expectation as healthy', () => {
    // A same-day partial covers more than was owed. That is not an anomaly.
    const f = dailyFreshness({ latestDate: '2026-09-03', nowMs: at('2026-09-03T08:22:00Z'), scheduledHourUtc: 2 });
    expect(f.status).toBe('healthy');
    expect(f.daysBehind).toBe(0);
    expect(f.detail).toContain('ahead of');
  });

  it('crosses a month boundary by date arithmetic, not by day-of-month', () => {
    const f = dailyFreshness({ latestDate: '2026-08-31', nowMs: at('2026-09-01T09:00:00Z'), scheduledHourUtc: 2 });
    expect(f.expectedDay).toBe('2026-08-31');
    expect(f.status).toBe('healthy');
  });
});

describe('timestampFreshness keeps the old semantics for real timestamps', () => {
  const now = at('2026-09-03T08:22:00Z');
  it('measures elapsed minutes', () => {
    expect(timestampFreshness('2026-09-03T08:00:00Z', now, 60)).toBe('healthy');
    expect(timestampFreshness('2026-09-03T07:00:00Z', now, 60)).toBe('stale');
    expect(timestampFreshness(null, now, 60)).toBe('never');
    expect(timestampFreshness('rubbish', now, 60)).toBe('never');
  });
});

describe('dayKeyUtc', () => {
  it('is UTC, not local', () => {
    expect(dayKeyUtc(at('2026-09-03T23:59:59Z'))).toBe('2026-09-03');
    expect(dayKeyUtc(at('2026-09-04T00:00:00Z'))).toBe('2026-09-04');
  });
});

/**
 * THE DRIVER CONTRACT.
 *
 * node-postgres parses a Postgres DATE (oid 1082) into a JS Date at LOCAL
 * midnight, not UTC midnight. On any host east of UTC — this one runs PKT
 * (+0500) — `MAX(report_date)` for 2026-09-02 arrives as
 * 2026-09-01T19:00:00Z, and normaliseDay reads it back in UTC as 2026-09-01.
 * Every daily artefact then reported one business day stale, with a false
 * "Run DMR" warning attached: the exact over-reporting this module exists to
 * prevent, arriving through the driver rather than the arithmetic.
 *
 * The fix is `::text` in SQL, so the day is never a Date at all. These tests
 * pin BOTH halves: the cast output must work, and the uncast output must be
 * recognisably wrong, so nobody "simplifies" the cast away.
 */
describe('a Postgres DATE must reach this module as text, not as a Date', () => {
  const now = at('2026-09-03T09:00:00Z');
  const opts = { nowMs: now, scheduledHourUtc: 2 };

  it('is correct for the ::text form the queries now send', () => {
    const f = dailyFreshness({ latestDate: '2026-09-02', ...opts });
    expect(f.coveredDay).toBe('2026-09-02');
    expect(f.status).toBe('healthy');
    expect(f.daysBehind).toBe(0);
  });

  it('shifts a day when handed the driver\'s local-midnight Date from east of UTC', () => {
    // Reproduces what pg returns on a PKT host WITHOUT the cast. Documented as
    // a failure mode, not endorsed: the module cannot repair this, because a
    // local-midnight Date is genuinely a different instant.
    const pktLocalMidnight = new Date('2026-09-01T19:00:00Z');   // = 2026-09-02 00:00 PKT
    const f = dailyFreshness({ latestDate: pktLocalMidnight, ...opts });
    expect(f.coveredDay).toBe('2026-09-01');
    expect(f.status).toBe('stale');
    expect(f.daysBehind).toBe(1);
  });

  it('is unaffected west of UTC, which is why this hid in review', () => {
    // A US-hosted process parses the same column to 2026-09-02T05:00Z, still
    // the right UTC day. The defect only appears east of Greenwich.
    const estLocalMidnight = new Date('2026-09-02T05:00:00Z');
    expect(dailyFreshness({ latestDate: estLocalMidnight, ...opts }).coveredDay).toBe('2026-09-02');
  });
});
