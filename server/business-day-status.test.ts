import { describe, it, expect } from 'vitest';
import {
  assessBusinessDay, assessHeartbeat, targetBusinessDay,
  STAGE_ORDER, type StageKey, type StageEvidence,
} from './business-day-status';

const at = (iso: string) => Date.parse(iso);
const MORNING = at('2026-09-03T08:22:00Z');   // after 02:00 + 6h grace
const NIGHT   = at('2026-09-03T00:40:00Z');   // before the window opens

/** Every stage covering the target day. */
function allComplete(day = '2026-09-02'): Partial<Record<StageKey, StageEvidence>> {
  const e: Partial<Record<StageKey, StageEvidence>> = {};
  for (const k of STAGE_ORDER) e[k] = { coveredDay: day };
  return e;
}

describe('the question the percentage could not answer', () => {
  it('names the stage that is missing, not a score', () => {
    // 55% told nobody what was wrong. This says exactly what is wrong.
    const ev = allComplete();
    delete ev.reconcile; delete ev.invoice_draft; delete ev.invoice_send;
    const r = assessBusinessDay({ nowMs: MORNING, scheduledHourUtc: 2, evidence: ev });

    expect(r.verdict).toBe('blocked');
    expect(r.firstBlocker?.key).toBe('reconcile');
    expect(r.headline).toContain('2026-09-02');
    expect(r.headline).toContain('Reconciliation');
    // The headline must never reduce to a number.
    expect(r.headline).not.toMatch(/\d+%/);
  });

  it('reports a fully complete day plainly', () => {
    const r = assessBusinessDay({ nowMs: MORNING, scheduledHourUtc: 2, evidence: allComplete() });
    expect(r.verdict).toBe('complete');
    expect(r.firstBlocker).toBeNull();
    expect(r.completed).toBe(r.automatedTotal);
    expect(r.stages.every(s => s.state === 'complete')).toBe(true);
  });
});

describe('blocked is not failed', () => {
  it('marks everything downstream of a gap as blocked, naming the culprit', () => {
    // The distinction that keeps someone from debugging the wrong component.
    const ev = allComplete();
    ev.dmr = { coveredDay: null, failed: true, note: 'switch timeout' };
    delete ev.snapshot; delete ev.margin; delete ev.reconcile;
    delete ev.invoice_draft; delete ev.invoice_send;

    const r = assessBusinessDay({ nowMs: MORNING, scheduledHourUtc: 2, evidence: ev });
    const by = Object.fromEntries(r.stages.map(s => [s.key, s]));

    expect(by.dmr.state).toBe('failed');
    expect(by.dmr.detail).toContain('switch timeout');
    for (const k of ['snapshot', 'margin', 'reconcile', 'invoice_draft'] as StageKey[]) {
      expect(by[k].state).toBe('blocked');
      expect(by[k].blockedBy).toBe('dmr');
      expect(by[k].detail).toContain('Daily Minutes Report');
    }
    // Only the stage that actually ran and failed is red-for-failure.
    expect(r.stages.filter(s => s.state === 'failed')).toHaveLength(1);
  });

  it('does not invent a failure for a stage that simply has not run', () => {
    const ev = allComplete();
    delete ev.margin; delete ev.reconcile; delete ev.invoice_draft; delete ev.invoice_send;
    const r = assessBusinessDay({ nowMs: MORNING, scheduledHourUtc: 2, evidence: ev });
    const by = Object.fromEntries(r.stages.map(s => [s.key, s]));
    expect(by.margin.state).toBe('waiting');
    // Downstream of a stage that merely has not run is WAITING, not blocked —
    // red is reserved for an upstream that actually failed.
    expect(by.reconcile.state).toBe('waiting');
    expect(by.reconcile.blockedBy).toBe('margin');
    expect(r.stages.some(s => s.state === 'failed')).toBe(false);
    expect(r.stages.some(s => s.tone === 'bad')).toBe(false);
  });
});

describe('nothing is late before it is owed', () => {
  it('reads not_due before the scheduled hour, with no red anywhere', () => {
    // An amber board at 00:40 for work scheduled at 02:00 teaches people to
    // stop reading the board.
    const r = assessBusinessDay({ nowMs: NIGHT, scheduledHourUtc: 2, evidence: {} });
    expect(r.verdict).toBe('not_due');
    expect(r.headline).toContain('not due yet');
    expect(r.stages.every(s => s.tone !== 'bad')).toBe(true);
    expect(r.stages[0].state).toBe('not_due');
  });

  it('agrees with dailyFreshness about which day is owed', () => {
    // Two modules disagreeing here would put a red stage beside a green
    // artefact describing the same day.
    expect(targetBusinessDay(NIGHT,   2)).toBe('2026-09-01');
    expect(targetBusinessDay(MORNING, 2)).toBe('2026-09-02');
  });
});

describe('the human gate is a control, not an incomplete step', () => {
  it('reads awaiting_approval when automation has finished its part', () => {
    const ev = allComplete();
    delete ev.invoice_send;
    const r = assessBusinessDay({ nowMs: MORNING, scheduledHourUtc: 2, evidence: ev });

    expect(r.verdict).toBe('awaiting_approval');
    expect(r.firstBlocker).toBeNull();          // nothing is WRONG
    expect(r.completed).toBe(r.automatedTotal); // automation is done
    const send = r.stages.find(s => s.key === 'invoice_send')!;
    expect(send.state).toBe('awaiting_approval');
    expect(send.detail).toContain('never sends an invoice by itself');
    expect(r.headline).toContain('waiting for approval');
  });

  it('does not let the human gate block anything, being last', () => {
    const r = assessBusinessDay({ nowMs: MORNING, scheduledHourUtc: 2, evidence: allComplete() });
    expect(r.stages.some(s => s.blockedBy === 'invoice_send')).toBe(false);
  });
});

describe('in progress', () => {
  it('reports running without calling anything failed', () => {
    const ev = allComplete();
    ev.snapshot = { running: true };
    delete ev.margin; delete ev.reconcile; delete ev.invoice_draft; delete ev.invoice_send;
    const r = assessBusinessDay({ nowMs: MORNING, scheduledHourUtc: 2, evidence: ev });
    expect(r.verdict).toBe('in_progress');
    expect(r.headline).toMatch(/3 of 7 stages complete/);  // collect, verify, dmr
    expect(r.stages.find(s => s.key === 'snapshot')!.state).toBe('running');
  });
});

describe('coverage comparison', () => {
  it('treats a day AHEAD of target as complete', () => {
    const r = assessBusinessDay({
      nowMs: MORNING, scheduledHourUtc: 2, evidence: allComplete('2026-09-03'),
    });
    expect(r.verdict).toBe('complete');
    expect(r.stages[0].detail).toContain('ahead of');
  });

  it('treats an older day as not covering the target', () => {
    const r = assessBusinessDay({
      nowMs: MORNING, scheduledHourUtc: 2, evidence: allComplete('2026-08-29'),
    });
    expect(r.verdict).toBe('blocked');
    expect(r.firstBlocker?.key).toBe('collect');
  });

  it('lets the caller override the day under judgement', () => {
    const r = assessBusinessDay({
      nowMs: MORNING, scheduledHourUtc: 2, targetDayOverride: '2026-08-29',
      evidence: allComplete('2026-08-29'),
    });
    expect(r.targetDay).toBe('2026-08-29');
    expect(r.verdict).toBe('complete');
  });
});

describe('heartbeats keep the age question, because they have an age', () => {
  const now = at('2026-09-03T08:22:00Z');
  it('bands up / late / down rather than a single cliff', () => {
    expect(assessHeartbeat({ key: 'api', label: 'API', lastSeenIso: '2026-09-03T08:21:30Z', toleranceSec: 60 }, now).state).toBe('up');
    expect(assessHeartbeat({ key: 'api', label: 'API', lastSeenIso: '2026-09-03T08:20:00Z', toleranceSec: 60 }, now).state).toBe('late');
    expect(assessHeartbeat({ key: 'api', label: 'API', lastSeenIso: '2026-09-03T08:00:00Z', toleranceSec: 60 }, now).state).toBe('down');
  });

  it('reports ignorance as unknown, never as down', () => {
    // A check that could not run says nothing about the service — the same
    // rule as an unreadable flag not meaning "off".
    const u = assessHeartbeat({ key: 'q', label: 'Queue', toleranceSec: 60,
                                unknownReason: 'connection refused' }, now);
    expect(u.state).toBe('unknown');
    expect(u.tone).toBe('idle');           // grey, not red
    expect(u.detail).toContain('connection refused');
    expect(assessHeartbeat({ key: 'q', label: 'Queue', lastSeenIso: null, toleranceSec: 60 }, now).state).toBe('unknown');
  });

  it('formats age at human scale', () => {
    const h = assessHeartbeat({ key: 'w', label: 'Workers', lastSeenIso: '2026-09-03T02:22:00Z', toleranceSec: 300 }, now);
    expect(h.ageSec).toBe(21600);
    expect(h.detail).toContain('6.0h');
  });
});
