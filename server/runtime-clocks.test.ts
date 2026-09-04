import { describe, it, expect } from 'vitest';
import { assessRuntimeClocks, isUtcZone, type ClockInputs } from './runtime-clocks';
import { normaliseDay } from './freshness';

const BASE: ClockInputs = {
  processTz: 'UTC', envTz: 'UTC', databaseTz: 'UTC',
  nowIso: '2026-09-04T10:15:00Z',
  collectionWindowUtc: { startHour: 2, endHour: 6 },
  pipelineHourUtc: 2,
  roundTrip: { expected: '2026-09-02', viaDate: '2026-09-02', viaText: '2026-09-02' },
};
const sev = (r: ReturnType<typeof assessRuntimeClocks>, s: string) =>
  r.findings.filter(f => f.severity === s);

/**
 * THE DEFECT THIS PAGE EXISTS TO CATCH.
 *
 * Reading the source could not find it: every business day, window and slice
 * boundary was already explicit UTC, and the collection path had zero
 * local-time accessors. The bug lived in the driver — a DATE materialised at
 * the PROCESS's local midnight — and only asking the running process could
 * have surfaced it.
 */
describe('the round-trip is the measurement, not the settings', () => {
  it('reproduces the real PKT defect from a genuine driver value', () => {
    // What node-postgres actually returns for DATE '2026-09-02' on a +0500
    // host, pushed through the SAME normaliseDay the defect travelled through.
    const driverValue = new Date('2026-09-01T19:00:00Z');   // 2026-09-02 00:00 PKT
    expect(normaliseDay(driverValue)).toBe('2026-09-01');   // a day lost

    const r = assessRuntimeClocks({
      ...BASE, processTz: 'Asia/Karachi', envTz: null,
      roundTrip: { expected: '2026-09-02',
                   viaDate: normaliseDay(driverValue), viaText: '2026-09-02' },
    });
    const shift = r.findings.find(f => f.claim.includes('UNCAST DATE'));
    expect(shift).toBeTruthy();
    expect(shift!.detail).toContain('2026-09-01');
    // Contained, because the queries cast — so a warning, not a critical.
    expect(shift!.severity).toBe('warning');
    expect(r.ok).toBe(true);
  });

  it('escalates to CRITICAL when the cast path itself is wrong', () => {
    // If ::text loses a day, every daily artefact on the dashboard is wrong
    // right now — that is not a latent risk.
    const r = assessRuntimeClocks({
      ...BASE, roundTrip: { expected: '2026-09-02', viaDate: '2026-09-01', viaText: '2026-09-01' },
    });
    expect(r.ok).toBe(false);
    expect(sev(r, 'critical')).toHaveLength(2);
    expect(r.summary).toContain('read incorrectly');
  });

  it('confirms a clean host without inventing a problem', () => {
    const r = assessRuntimeClocks(BASE);
    expect(r.ok).toBe(true);
    expect(sev(r, 'critical')).toHaveLength(0);
    expect(sev(r, 'warning')).toHaveLength(0);
    expect(r.findings[0].claim).toContain('clean in both forms');
    expect(r.summary).toContain('round-trip cleanly');
  });

  it('says it does not know rather than implying a pass', () => {
    // A page that silently omits the check reads as "checked and fine".
    const failed = assessRuntimeClocks({ ...BASE, roundTrip: null,
                                         roundTripError: 'connection refused' });
    expect(sev(failed, 'warning')[0].claim).toContain('could not be measured');
    expect(failed.findings[0].detail).toContain('connection refused');

    const absent = assessRuntimeClocks({ ...BASE, roundTrip: null });
    expect(absent.findings[0].claim).toContain('No DATE round-trip');
    expect(absent.findings[0].detail).toContain('configuration, not evidence');
  });
});

describe('configuration is reported as risk, never as defect', () => {
  it('warns on a non-UTC process without claiming collection is affected', () => {
    const r = assessRuntimeClocks({ ...BASE, processTz: 'Asia/Karachi' });
    const f = sev(r, 'warning').find(x => x.claim.includes('Process timezone'))!;
    expect(f.detail).toContain('does not change what is collected');
    expect(r.ok).toBe(true);          // a risk, not a failure
  });

  it('notes an unpinned TZ and names the consequence that actually happened', () => {
    const r = assessRuntimeClocks({ ...BASE, envTz: null });
    const f = r.findings.find(x => x.claim.includes('TZ is not pinned'))!;
    expect(f.severity).toBe('info');
    expect(f.detail).toContain('Postgres driver');
  });

  it('does not warn about an unknown database zone it never read', () => {
    const r = assessRuntimeClocks({ ...BASE, databaseTz: null });
    expect(r.databaseTz).toBe('unknown');
    expect(r.findings.some(f => f.claim.includes('Database session'))).toBe(false);
  });
});

describe('the facts the page states', () => {
  it('names the business day the collector would target', () => {
    const r = assessRuntimeClocks(BASE);
    expect(r.businessDayNow).toBe('2026-09-03');   // yesterday, UTC
    expect(r.nowUtc).toBe('2026-09-04 10:15 UTC');
    expect(r.collectionWindowUtc).toBe('02:00–06:00 UTC');
    expect(r.pipelineHourUtc).toBe('02:00 UTC');
    expect(r.businessDayBasis).toBe('UTC');
  });

  it('degrades readably on an unreadable clock rather than throwing', () => {
    const r = assessRuntimeClocks({ ...BASE, nowIso: 'not-a-date' });
    expect(r.nowUtc).toBe('unreadable');
    expect(r.businessDayNow).toBe('unreadable');
  });
});

describe('isUtcZone', () => {
  it('accepts the spellings a host or driver may report', () => {
    for (const z of ['UTC', 'utc', 'Etc/UTC', 'GMT', ' Z ', '+00:00']) {
      expect(isUtcZone(z)).toBe(true);
    }
    for (const z of ['Asia/Karachi', 'America/New_York', 'UTC+5', '', null]) {
      expect(isUtcZone(z as any)).toBe(false);
    }
  });
});
