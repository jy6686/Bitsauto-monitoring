import { describe, it, expect } from 'vitest';
import { assessNightlySla } from './nightly-sla';

/** Collecting business date 2026-09-01; the run happens on 09-02. */
const D = '2026-09-01';
const on = (hhmm: string) => `2026-09-02T${hhmm}:00.000Z`;

describe('the run that started at 15:46', () => {
  /**
   * Measured 2026-09-02. Collection for 09-01 began at 15:46 UTC against an
   * 02:00 target — 826 minutes late — and every surface reported success,
   * because every surface measured whether the work COMPLETED, not whether it
   * completed IN TIME.
   */
  it('reports the real production run as a missed business deadline', () => {
    const a = assessNightlySla({
      businessDate: D, startedAtIso: on('15:46'), finishedAtIso: on('17:08'), nowIso: on('17:30'),
    });
    expect(a.outcome).toBe('MISSED_BUSINESS_DEADLINE');
    expect(a.startDelayMin).toBe(826);
    expect(a.acceptable).toBe(false);
    expect(a.reason).toContain('began work without');
  });

  it('would have passed silently on completion alone', () => {
    // The run DID complete. Every check that asks only "did it finish?" says
    // yes — which is exactly why this module exists.
    const a = assessNightlySla({
      businessDate: D, startedAtIso: on('15:46'), finishedAtIso: on('17:08'), nowIso: on('17:30'),
    });
    expect(a.finishOverrunMin).toBeGreaterThan(0);
    expect(a.marginToBusinessMin).toBeLessThan(0);
  });
});

describe('two deadlines, because they need different responses', () => {
  it('treats a 03:37 finish as a capacity signal, not an emergency', () => {
    const a = assessNightlySla({
      businessDate: D, startedAtIso: on('02:01'), finishedAtIso: on('03:37'), nowIso: on('04:00'),
    });
    expect(a.outcome).toBe('OVERRAN');
    expect(a.finishOverrunMin).toBe(37);
    expect(a.marginToBusinessMin).toBe(263);      // still hours of slack
    expect(a.reason).toContain('capacity signal');
  });

  it('treats an 08:30 finish as the failure the business feels', () => {
    const a = assessNightlySla({
      businessDate: D, startedAtIso: on('02:01'), finishedAtIso: on('08:30'), nowIso: on('09:00'),
    });
    expect(a.outcome).toBe('MISSED_BUSINESS_DEADLINE');
    expect(a.marginToBusinessMin).toBe(-30);
    expect(a.acceptable).toBe(false);
  });

  it('passes a clean night', () => {
    const a = assessNightlySla({
      businessDate: D, startedAtIso: on('02:01'), finishedAtIso: on('02:48'), nowIso: on('03:00'),
    });
    expect(a.outcome).toBe('PASS');
    expect(a.acceptable).toBe(true);
    expect(a.startDelayMin).toBe(1);
    expect(a.marginToBusinessMin).toBe(312);
  });
});

describe('did not run is not late', () => {
  /**
   * A run that never started needs a different response from one that started
   * at 02:03 and is still going — and until now both produced the same
   * silence. On 2026-09-02 the process was simply absent at 02:00.
   */
  it('names a run that never happened once the deadline has passed', () => {
    const a = assessNightlySla({
      businessDate: D, startedAtIso: null, finishedAtIso: null, nowIso: on('09:00'),
    });
    expect(a.outcome).toBe('DID_NOT_RUN');
    expect(a.reason).toContain('check that the process was alive');
    expect(a.acceptable).toBe(false);
  });

  it('does not cry wolf before the run is even due', () => {
    const a = assessNightlySla({
      businessDate: D, startedAtIso: null, finishedAtIso: null, nowIso: on('01:00'),
    });
    expect(a.outcome).toBe('IN_PROGRESS');
    expect(a.acceptable).toBe(true);
  });

  it('is patient while a run is still going inside the deadline', () => {
    const a = assessNightlySla({
      businessDate: D, startedAtIso: on('02:01'), finishedAtIso: null, nowIso: on('03:30'),
    });
    expect(a.outcome).toBe('IN_PROGRESS');
    expect(a.acceptable).toBe(true);
  });

  it('stops being patient at the business deadline', () => {
    const a = assessNightlySla({
      businessDate: D, startedAtIso: on('02:01'), finishedAtIso: null, nowIso: on('08:15'),
    });
    expect(a.outcome).toBe('MISSED_BUSINESS_DEADLINE');
    expect(a.reason).toContain('Still running');
  });
});

describe('the grace window keeps the alarm meaningful', () => {
  /**
   * The scheduler ticks every 10 minutes and its first tick is 60s after boot,
   * so a start a few minutes past the hour is normal operation. Flagging 02:01
   * would make LATE_START fire on almost every healthy night — the defect this
   * file replaces, not one to reproduce.
   */
  it('does not call 02:01 late', () => {
    const a = assessNightlySla({
      businessDate: D, startedAtIso: on('02:01'), finishedAtIso: on('02:48'), nowIso: on('03:00'),
    });
    expect(a.outcome).toBe('PASS');
    expect(a.startDelayMin).toBe(1);
  });

  it('does call 02:20 late, with the default 15-minute grace', () => {
    const a = assessNightlySla({
      businessDate: D, startedAtIso: on('02:20'), finishedAtIso: on('02:50'), nowIso: on('03:00'),
    });
    expect(a.outcome).toBe('LATE_START');
    expect(a.startDelayMin).toBe(20);
  });

  it('honours a tighter grace when one is asked for', () => {
    const a = assessNightlySla({
      businessDate: D, startedAtIso: on('02:05'), finishedAtIso: on('02:50'),
      nowIso: on('03:00'), startGraceMin: 2,
    });
    expect(a.outcome).toBe('LATE_START');
  });
});

describe('late start with a good finish', () => {
  it('is reported, because the schedule not holding is itself the warning', () => {
    const a = assessNightlySla({
      businessDate: D, startedAtIso: on('05:00'), finishedAtIso: on('06:00'), nowIso: on('07:00'),
    });
    expect(a.outcome).toBe('LATE_START');
    expect(a.startDelayMin).toBe(180);
    expect(a.acceptable).toBe(false);
    expect(a.reason).toContain('The reports arrived; the schedule did not hold');
  });
});

describe('configurable hours', () => {
  it('honours a different window', () => {
    const a = assessNightlySla({
      businessDate: D, startedAtIso: on('04:05'), finishedAtIso: on('05:30'), nowIso: on('06:00'),
      targetStartHour: 4, targetFinishHour: 6, businessDeadlineHour: 9,
    });
    expect(a.outcome).toBe('PASS');
  });

  it('measures against the day AFTER the business date', () => {
    // The run for D happens on D+1: the day must close before it is collected.
    const a = assessNightlySla({
      businessDate: D, startedAtIso: on('02:00'), finishedAtIso: on('02:30'), nowIso: on('03:00'),
    });
    expect(a.startDelayMin).toBe(0);
  });
});
