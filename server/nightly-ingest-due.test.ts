import { describe, it, expect } from 'vitest';
import { decideNightlyIngest, type ReconAttempt } from './nightly-ingest-due';

const done    = (date: string): ReconAttempt => ({ date, status: 'done' });
const errored = (date: string): ReconAttempt => ({ date, status: 'error' });
const running = (date: string): ReconAttempt => ({ date, status: 'running' });

/** Every day of the lookback collected, so nothing is owed. */
const allCollected = (through: string, days: number): ReconAttempt[] => {
  const end = Date.parse(`${through}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) =>
    done(new Date(end - i * 86400000).toISOString().slice(0, 10)));
};

describe('decideNightlyIngest — the day is owed until the ledger says otherwise', () => {
  it('collects yesterday once the settling hour has passed', () => {
    const d = decideNightlyIngest({ nowIso: '2026-08-28T02:00:00Z', attempts: [] });
    expect(d.due).toBe(true);
    expect(d.targetDate).toBe('2026-08-27');
  });

  it('never collects today — a day still in progress is not a closed day', () => {
    const d = decideNightlyIngest({ nowIso: '2026-08-28T23:59:00Z', attempts: [] });
    expect(d.targetDate).not.toBe('2026-08-28');
  });

  it('holds yesterday back until the switch has settled', () => {
    const d = decideNightlyIngest({ nowIso: '2026-08-28T00:20:00Z', attempts: [] });
    expect(d.due).toBe(false);
    expect(d.targetDate).toBe('2026-08-27');
    expect(d.reason).toMatch(/settling/);
  });

  it('reports nothing owed when the whole lookback is collected', () => {
    const d = decideNightlyIngest({
      nowIso: '2026-08-28T02:00:00Z',
      attempts: allCollected('2026-08-27', 7),
    });
    expect(d.due).toBe(false);
    expect(d.targetDate).toBeNull();
    expect(d.backlog).toBe(0);
  });
});

describe('the defect this replaces: a process that missed midnight', () => {
  /**
   * The whole point. `setTimeout(fn, msUntilMidnightUtc())` on a process that
   * is recycled and sleeps meant the collector never ran. Asking persisted
   * state means a process that starts at 14:00 collects immediately.
   */
  it('collects on a tick at 14:00, not at the next midnight it will not survive to', () => {
    const d = decideNightlyIngest({ nowIso: '2026-08-28T14:00:00Z', attempts: [] });
    expect(d.due).toBe(true);
    expect(d.targetDate).toBe('2026-08-27');
  });

  it('drains a backlog oldest-first so a slept-through gap is repaired', () => {
    // Down for three days: 25, 26, 27 all missing.
    const d = decideNightlyIngest({
      nowIso: '2026-08-28T09:00:00Z',
      attempts: [done('2026-08-24'), done('2026-08-23'), done('2026-08-22'), done('2026-08-21')],
    });
    expect(d.due).toBe(true);
    expect(d.targetDate).toBe('2026-08-25'); // oldest owed, not yesterday
    expect(d.backlog).toBe(3);
  });

  /** A backlog is never held back by the settling delay — only yesterday is. */
  it('collects an older owed day even before the settling hour', () => {
    const d = decideNightlyIngest({
      nowIso: '2026-08-28T00:05:00Z',
      attempts: [done('2026-08-24'), done('2026-08-27')], // 25 and 26 missing
    });
    expect(d.due).toBe(true);
    expect(d.targetDate).toBe('2026-08-25');
  });

  /**
   * An empty ledger is a COLD START, not a seven-day gap. Without this guard
   * first boot would backfill a week against a production switch, unattended.
   * Filling history stays an operator decision.
   */
  it('collects only yesterday on a cold start, never a week of history', () => {
    const d = decideNightlyIngest({ nowIso: '2026-08-28T09:00:00Z', attempts: [] });
    expect(d.due).toBe(true);
    expect(d.targetDate).toBe('2026-08-27');
    expect(d.backlog).toBe(1);
  });

  /** Nor does it reach back past the day capture actually began. */
  it('never collects a day that closed before forward capture started', () => {
    const d = decideNightlyIngest({
      nowIso: '2026-08-28T09:00:00Z',
      attempts: [done('2026-08-26')], // capture began on the 26th
    });
    expect(d.targetDate).toBe('2026-08-27');
    expect(d.backlog).toBe(1);
  });
});

describe('attempts, not optimism, decide when to stop', () => {
  it('does not re-collect a day already marked done', () => {
    const d = decideNightlyIngest({
      nowIso: '2026-08-28T02:00:00Z',
      attempts: [...allCollected('2026-08-27', 7)],
    });
    expect(d.due).toBe(false);
  });

  it('treats an in-flight run as not owed, so ticks do not stack', () => {
    const d = decideNightlyIngest({
      nowIso: '2026-08-28T02:00:00Z',
      attempts: [...allCollected('2026-08-26', 6), running('2026-08-27')],
    });
    expect(d.due).toBe(false);
    expect(d.targetDate).toBeNull();
  });

  it('retries a failed day', () => {
    const d = decideNightlyIngest({
      nowIso: '2026-08-28T02:00:00Z',
      attempts: [...allCollected('2026-08-26', 6), errored('2026-08-27')],
    });
    expect(d.due).toBe(true);
    expect(d.targetDate).toBe('2026-08-27');
  });

  /**
   * This process is killed mid-run routinely — autoscale recycles it, a
   * republish stops it — leaving a 'running' row that never completes. Treating
   * that as in-flight forever would mark the day permanently unavailable and
   * produce a silent gap nothing would ever repair.
   */
  it('retries a day whose run was killed and left marked running', () => {
    const d = decideNightlyIngest({
      nowIso: '2026-08-28T09:00:00Z',
      attempts: [...allCollected('2026-08-26', 6),
                 { date: '2026-08-27', status: 'running', startedAtIso: '2026-08-28T02:00:00Z' }],
    });
    expect(d.due).toBe(true);
    expect(d.targetDate).toBe('2026-08-27');
  });

  it('leaves a genuinely live run alone', () => {
    const d = decideNightlyIngest({
      nowIso: '2026-08-28T09:00:00Z',
      attempts: [...allCollected('2026-08-26', 6),
                 { date: '2026-08-27', status: 'running', startedAtIso: '2026-08-28T08:55:00Z' }],
    });
    expect(d.due).toBe(false);
  });

  it('trusts the status when a running row carries no timestamp', () => {
    const d = decideNightlyIngest({
      nowIso: '2026-08-28T09:00:00Z',
      attempts: [...allCollected('2026-08-26', 6), running('2026-08-27')],
    });
    expect(d.due).toBe(false);
  });

  it('gives up after maxAttempts rather than retrying a broken day forever', () => {
    const d = decideNightlyIngest({
      nowIso: '2026-08-28T02:00:00Z',
      attempts: [...allCollected('2026-08-26', 6),
                 errored('2026-08-27'), errored('2026-08-27'), errored('2026-08-27')],
      maxAttemptsPerDate: 3,
    });
    expect(d.due).toBe(false);
    // and it SAYS so — a day silently abandoned is a gap nobody knows about
    expect(d.reason).toMatch(/gave up/);
  });
});

describe('degenerate input', () => {
  it('refuses to guess from an unparseable clock', () => {
    const d = decideNightlyIngest({ nowIso: 'not-a-date', attempts: [] });
    expect(d.due).toBe(false);
    expect(d.reason).toMatch(/unparseable/);
  });

  it('treats a zero or negative lookback as one day', () => {
    const d = decideNightlyIngest({ nowIso: '2026-08-28T02:00:00Z', attempts: [], lookbackDays: 0 });
    expect(d.targetDate).toBe('2026-08-27');
  });
});
