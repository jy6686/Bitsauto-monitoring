/**
 * Daily finance pipeline — the scheduling decision.
 *
 * The pipeline itself talks to Sippy, the database and an SMTP server, so it
 * is not what these tests cover. What they cover is the decision that runs it,
 * because every wrong answer there is a production incident:
 *
 *   - saying "due" when a run already succeeded  -> a duplicate DMR emailed to
 *     the finance team, and a second set of invoice jobs
 *   - saying "not due" forever                   -> silent non-automation, the
 *     exact failure this pipeline was built to end
 *   - retrying a structural failure indefinitely -> a 10-minute loop against
 *     Sippy that nobody is watching
 *
 * The catch-up design is the reason a pure decision exists at all. A daily
 * setTimeout needs no ledger; it also never fires on a process that sleeps
 * through 07:00 UTC, which is what materialization_runs showed this deployment
 * doing. Asking the ledger is what makes lateness recoverable.
 */

import { describe, it, expect } from 'vitest';
import { decideDue, defaultTargetDate, type AttemptRow } from './finance-pipeline-schedule';

/** 26 Aug 2026, 09:00 UTC — after the 07:00 scheduled hour. */
const AFTER_HOUR  = new Date('2026-08-26T09:00:00Z');
/** 26 Aug 2026, 03:00 UTC — before it. */
const BEFORE_HOUR = new Date('2026-08-26T03:00:00Z');

function row(status: string, startedAt: string, id = 1): AttemptRow {
  return { id, status, startedAt };
}

describe('defaultTargetDate', () => {
  it('targets yesterday UTC — the most recent complete business day', () => {
    expect(defaultTargetDate(AFTER_HOUR)).toBe('2026-08-25');
  });

  it('crosses month and year boundaries by date arithmetic, not string slicing', () => {
    expect(defaultTargetDate(new Date('2026-09-01T09:00:00Z'))).toBe('2026-08-31');
    expect(defaultTargetDate(new Date('2027-01-01T09:00:00Z'))).toBe('2026-12-31');
    expect(defaultTargetDate(new Date('2028-03-01T09:00:00Z'))).toBe('2028-02-29'); // leap year
  });

  it('is decided in UTC, not local time', () => {
    // 00:30 UTC on the 26th is still the 25th in the Americas. The business
    // date must not depend on where the container happens to run.
    expect(defaultTargetDate(new Date('2026-08-26T00:30:00Z'))).toBe('2026-08-25');
    expect(defaultTargetDate(new Date('2026-08-26T23:30:00Z'))).toBe('2026-08-25');
  });
});

describe('decideDue', () => {
  it('holds off before the scheduled hour, even with no run recorded', () => {
    const d = decideDue([], BEFORE_HOUR);
    expect(d.due).toBe(false);
    expect(d.reason).toContain('07:00 UTC');
  });

  it('runs after the scheduled hour when the date has no run yet', () => {
    expect(decideDue([], AFTER_HOUR)).toEqual({
      due: true, targetDate: '2026-08-25', reason: 'no run yet',
    });
  });

  it('never runs a business date twice — the duplicate-email guard', () => {
    const d = decideDue([row('success', '2026-08-26T07:02:00Z')], AFTER_HOUR);
    expect(d.due).toBe(false);
    expect(d.reason).toBe('already completed successfully');
  });

  it('treats success as final even when later attempts failed', () => {
    // Order in the ledger is newest-first; a failed manual re-run after a
    // successful scheduled run must not reopen the date.
    const d = decideDue([
      row('failed',  '2026-08-26T08:00:00Z', 2),
      row('success', '2026-08-26T07:02:00Z', 1),
    ], AFTER_HOUR);
    expect(d.due).toBe(false);
  });

  it('waits for a run that is genuinely in flight', () => {
    const d = decideDue([row('running', '2026-08-26T08:50:00Z', 7)], AFTER_HOUR);
    expect(d.due).toBe(false);
    expect(d.reason).toBe('run #7 in progress');
  });

  it('does not let a killed process block the date forever', () => {
    // The whole premise is a process that dies unpredictably. A 'running' row
    // it never got to close would otherwise stall billing indefinitely.
    const d = decideDue([row('running', '2026-08-26T07:00:00Z', 7)], AFTER_HOUR);
    expect(d.due).toBe(true);
    expect(d.reason).toBe('retry 2/3');
  });

  it('retries a failed attempt', () => {
    expect(decideDue([row('failed', '2026-08-26T07:05:00Z')], AFTER_HOUR)).toMatchObject({
      due: true, reason: 'retry 2/3',
    });
  });

  it('retries a partial run — some stages succeeding is not the date being done', () => {
    expect(decideDue([row('partial', '2026-08-26T07:05:00Z')], AFTER_HOUR)).toMatchObject({
      due: true,
    });
  });

  it('stops after the attempt budget rather than looping every ten minutes', () => {
    const rows = [
      row('failed', '2026-08-26T07:05:00Z', 3),
      row('failed', '2026-08-26T07:15:00Z', 2),
      row('failed', '2026-08-26T07:25:00Z', 1),
    ];
    const d = decideDue(rows, AFTER_HOUR);
    expect(d.due).toBe(false);
    expect(d.reason).toContain('needs investigation');
  });

  it('catches up on a late day instead of skipping it', () => {
    // The failure this replaces: the process slept through 07:00 and the
    // 24-hour timer never fired, so the day was simply lost. Awake at 23:00
    // with nothing recorded, the answer must still be "run it".
    const late = new Date('2026-08-26T23:00:00Z');
    expect(decideDue([], late)).toMatchObject({ due: true, targetDate: '2026-08-25' });
  });

  it('honours an overridden scheduled hour', () => {
    expect(decideDue([], new Date('2026-08-26T01:00:00Z'), { scheduledHourUtc: 0 }).due).toBe(true);
    expect(decideDue([], new Date('2026-08-26T09:00:00Z'), { scheduledHourUtc: 23 }).due).toBe(false);
  });

  it('reports the same target date whatever the decision', () => {
    // The UI shows this date next to the verdict; a decision about one date
    // labelled with another would be worse than no display at all.
    for (const rows of [[], [row('success', '2026-08-26T07:00:00Z')], [row('failed', '2026-08-26T07:00:00Z')]]) {
      expect(decideDue(rows as AttemptRow[], AFTER_HOUR).targetDate).toBe('2026-08-25');
    }
  });
});
