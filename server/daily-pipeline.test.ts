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
import {
  decideDue, defaultTargetDate, blockedBy, STAGE_PREREQUISITES,
  DEFAULT_SCHEDULED_HOUR_UTC,
  type AttemptRow, type StageName, type StageStatus,
} from './finance-pipeline-schedule';

/** 26 Aug 2026, 09:00 UTC — well after the 02:00 scheduled hour. */
const AFTER_HOUR  = new Date('2026-08-26T09:00:00Z');
/** 26 Aug 2026, 01:00 UTC — before it. */
const BEFORE_HOUR = new Date('2026-08-26T01:00:00Z');

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
    expect(d.reason).toContain('02:00 UTC');
  });

  it('starts at 02:00 UTC by default', () => {
    // Pinned deliberately. The hour trades Sippy's CDR settling window against
    // how early finance sees the reconciliation, so moving it should be a
    // decision someone makes, not a constant someone edits.
    expect(DEFAULT_SCHEDULED_HOUR_UTC).toBe(2);
    expect(decideDue([], new Date('2026-08-26T01:59:00Z')).due).toBe(false);
    expect(decideDue([], new Date('2026-08-26T02:00:00Z')).due).toBe(true);
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

/**
 * Stage dependencies.
 *
 * The graph is a STAR around `dmr`, not a chain, because every middle stage
 * reads daily_minutes_reports and none reads the snapshot or the margin
 * tables. Verified against the source: margin makes 1 DMR read and 0 snapshot
 * reads; the assurance detectors make 4 DMR reads and 0 snapshot/margin reads.
 *
 * A linear chain would cost two things that matter, and both are pinned below:
 * a snapshot failure would block margin and assurance, which never read it;
 * and an assurance failure would block invoice job creation, even though
 * assurance is advisory ("AI suggests, humans approve") and billing-cycle
 * detection reads none of its output. Stopping billing because an advisory
 * scan errored is a worse failure than the scan itself.
 */
describe('blockedBy — stage prerequisites', () => {
  const failed  = (s: StageName): StageStatus => ({ stage: s, status: 'failed' });
  const ok      = (s: StageName): StageStatus => ({ stage: s, status: 'success' });
  const skipped = (s: StageName): StageStatus => ({ stage: s, status: 'skipped' });

  it('lets everything run when nothing has failed', () => {
    const done = [ok('dmr'), ok('snapshot')];
    for (const s of Object.keys(STAGE_PREREQUISITES) as StageName[]) {
      expect(blockedBy(s, done)).toBeNull();
    }
  });

  it('blocks every DMR dependent when DMR fails', () => {
    const done = [failed('dmr')];
    expect(blockedBy('snapshot',  done)).toBe('dmr');
    expect(blockedBy('dmr-email', done)).toBe('dmr');
    expect(blockedBy('margin',    done)).toBe('dmr');
    expect(blockedBy('assurance', done)).toBe('dmr');
  });

  it('still runs billing-cycle detection when DMR fails', () => {
    // It reads sippy accounts and invoices, not DMR. Traffic-independent work
    // must not stop because a report did.
    expect(blockedBy('billing-cycles', [failed('dmr')])).toBeNull();
  });

  it('does NOT block margin or assurance on a snapshot failure', () => {
    // The regression a linear chain would introduce. Both read DMR directly.
    const done = [ok('dmr'), failed('snapshot')];
    expect(blockedBy('margin',    done)).toBeNull();
    expect(blockedBy('assurance', done)).toBeNull();
  });

  it('does NOT let an advisory assurance failure stop billing', () => {
    const done = [ok('dmr'), ok('snapshot'), ok('margin'), failed('assurance')];
    expect(blockedBy('billing-cycles', done)).toBeNull();
  });

  it('does NOT let a failed margin stop anything', () => {
    const done = [ok('dmr'), failed('margin')];
    expect(blockedBy('assurance',      done)).toBeNull();
    expect(blockedBy('billing-cycles', done)).toBeNull();
  });

  it('does NOT let a failed email stop the computation stages', () => {
    // An SMTP outage is not a data problem.
    const done = [ok('dmr'), failed('dmr-email')];
    expect(blockedBy('margin',         done)).toBeNull();
    expect(blockedBy('assurance',      done)).toBeNull();
    expect(blockedBy('billing-cycles', done)).toBeNull();
  });

  it('treats a SKIPPED prerequisite as satisfied, not as failed', () => {
    // The most common healthy path: DMR skips because rows for the date
    // already exist. Treating that as failure would stall the whole pipeline
    // exactly when nothing is wrong.
    const done = [skipped('dmr')];
    expect(blockedBy('snapshot',  done)).toBeNull();
    expect(blockedBy('margin',    done)).toBeNull();
    expect(blockedBy('assurance', done)).toBeNull();
  });

  it('does not block on a prerequisite that has not run yet', () => {
    // Keeps the rule correct if stages are ever reordered or run selectively.
    expect(blockedBy('margin', [])).toBeNull();
  });

  it('dmr itself is never blocked — it is the root', () => {
    expect(blockedBy('dmr', [failed('snapshot'), failed('margin')])).toBeNull();
  });

  it('every declared prerequisite is itself a real stage', () => {
    // A typo'd prerequisite would silently never match and never block.
    const names = Object.keys(STAGE_PREREQUISITES) as StageName[];
    for (const prereqs of Object.values(STAGE_PREREQUISITES)) {
      for (const p of prereqs) expect(names).toContain(p);
    }
  });

  it('has no stage depending on itself', () => {
    for (const [stage, prereqs] of Object.entries(STAGE_PREREQUISITES)) {
      expect(prereqs).not.toContain(stage as StageName);
    }
  });
});
