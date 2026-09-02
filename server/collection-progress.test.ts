import { describe, it, expect } from 'vitest';
import { summariseCollection, type AccountRun } from './collection-progress';

const T0 = '2026-09-02T15:46:00.000Z';
const at = (mins: number) => new Date(Date.parse(T0) + mins * 60_000).toISOString();

const empty = (i: number, startMin: number, secs = 60): AccountRun => ({
  iAccount: i, status: 'done', fetched: 0, stored: 0,
  startedAt: at(startMin), finishedAt: new Date(Date.parse(at(startMin)) + secs * 1000).toISOString(),
});
const busy = (i: number, startMin: number, mins = 20, fetched = 2000): AccountRun => ({
  iAccount: i, status: 'done', fetched, stored: fetched,
  startedAt: at(startMin), finishedAt: at(startMin + mins),
});

describe('the counts an operator actually asked for', () => {
  it('reports completed / running / pending / failed against the intended total', () => {
    const p = summariseCollection({
      totalAccounts: 25,
      runs: [...Array.from({ length: 9 }, (_, k) => empty(k + 1, k)),
             { iAccount: 315, status: 'running', fetched: 418, stored: 291,
               startedAt: at(10), finishedAt: null }],
      startedAtIso: T0, nowIso: at(12),
    });
    expect(p.total).toBe(25);
    expect(p.completed).toBe(9);
    expect(p.running).toBe(1);
    expect(p.pending).toBe(15);
    expect(p.failed).toBe(0);
    expect(p.pct).toBe(36);
  });

  it('counts an errored account as failed, not pending', () => {
    const p = summariseCollection({
      totalAccounts: 3,
      runs: [empty(1, 0), { iAccount: 2, status: 'error', fetched: 0, stored: 0,
                            startedAt: at(1), finishedAt: at(2) }],
      startedAtIso: T0, nowIso: at(3),
    });
    expect(p.failed).toBe(1);
    expect(p.pending).toBe(1);
  });

  it('never reports negative pending when more runs exist than expected', () => {
    // The collector's account list can grow between runs; the panel must not
    // print "-2 pending" when it does.
    const p = summariseCollection({
      totalAccounts: 2,
      runs: [empty(1, 0), empty(2, 1), empty(3, 2), empty(4, 3)],
      startedAtIso: T0, nowIso: at(5),
    });
    expect(p.pending).toBe(0);
    expect(p.total).toBe(4);
    expect(p.pct).toBe(100);
  });

  it('separates duplicates from stored rather than implying loss', () => {
    // A re-run fetches everything and stores almost nothing. That is dedup
    // working, and the panel must not present it as missing data.
    const p = summariseCollection({
      totalAccounts: 1,
      runs: [{ iAccount: 315, status: 'done', fetched: 1033, stored: 0,
               startedAt: at(0), finishedAt: at(16) }],
      startedAtIso: T0, nowIso: at(17),
    });
    expect(p.cdrs).toEqual({ fetched: 1033, stored: 0, duplicates: 1033 });
  });
});

describe('the ETA refuses to invent a number', () => {
  /**
   * This panel has already misled twice: a slice ETA said "≈ 14 min left" on
   * an account that finished in 58 seconds. A confident wrong ETA is worse
   * than none — it is why someone stops trusting the panel.
   */
  it('offers no estimate before anything has finished', () => {
    const p = summariseCollection({
      totalAccounts: 25,
      runs: [{ iAccount: 76, status: 'running', fetched: 0, stored: 0,
               startedAt: at(0), finishedAt: null }],
      startedAtIso: T0, nowIso: at(1),
    });
    expect(p.etaMs).toBeNull();
    expect(p.etaBasis).toContain('no basis');
  });

  /**
   * THE CASE THAT MATTERS. 21 empty accounts usually run before asterisk. An
   * average over those predicts the whole day in minutes — and then it reaches
   * an account that takes twenty of them.
   */
  it('refuses to estimate from empty accounts alone, and says why', () => {
    const p = summariseCollection({
      totalAccounts: 25,
      runs: Array.from({ length: 6 }, (_, k) => empty(k + 1, k)),
      startedAtIso: T0, nowIso: at(6),
    });
    expect(p.etaMs).toBeNull();
    expect(p.etaBasis).toContain('no account with traffic has finished yet');
    expect(p.etaBasis).toContain('dominate the total');
  });

  it('estimates once BOTH populations have been observed', () => {
    const p = summariseCollection({
      totalAccounts: 25,
      runs: [...Array.from({ length: 6 }, (_, k) => empty(k + 1, k)), busy(315, 6, 20)],
      startedAtIso: T0, nowIso: at(26),
    });
    expect(p.etaMs).not.toBeNull();
    expect(p.etaBasis).toContain('account(s) with traffic');
    // 18 pending, ~1/7 of which are assumed busy: minutes, not seconds.
    expect(p.etaMs!).toBeGreaterThan(20 * 60_000);
  });

  it('counts down a running account rather than charging it in full', () => {
    const mid = summariseCollection({
      totalAccounts: 8,
      runs: [...Array.from({ length: 6 }, (_, k) => empty(k + 1, k)), busy(315, 6, 20),
             { iAccount: 588, status: 'running', fetched: 500, stored: 500,
               startedAt: at(26), finishedAt: null }],
      startedAtIso: T0, nowIso: at(36),   // 10 min into a ~20 min account
    });
    const early = summariseCollection({
      totalAccounts: 8,
      runs: [...Array.from({ length: 6 }, (_, k) => empty(k + 1, k)), busy(315, 6, 20),
             { iAccount: 588, status: 'running', fetched: 500, stored: 500,
               startedAt: at(26), finishedAt: null }],
      startedAtIso: T0, nowIso: at(28),   // 2 min in
    });
    expect(mid.etaMs!).toBeLessThan(early.etaMs!);
  });

  it('reports zero and complete when every account is done', () => {
    const p = summariseCollection({
      totalAccounts: 3,
      runs: [empty(1, 0), empty(2, 1), busy(315, 2, 20)],
      startedAtIso: T0, nowIso: at(23),
    });
    expect(p.complete).toBe(true);
    expect(p.etaMs).toBe(0);
    expect(p.etaBasis).toBe('complete');
    expect(p.pct).toBe(100);
  });

  it('is not complete while an account is still running', () => {
    const p = summariseCollection({
      totalAccounts: 2,
      runs: [empty(1, 0), { iAccount: 315, status: 'running', fetched: 10, stored: 10,
                            startedAt: at(1), finishedAt: null }],
      startedAtIso: T0, nowIso: at(2),
    });
    expect(p.complete).toBe(false);
  });
});

describe('degenerate input', () => {
  it('does not divide by zero on an empty day', () => {
    const p = summariseCollection({ totalAccounts: 0, runs: [], startedAtIso: T0, nowIso: at(1) });
    expect(p.pct).toBe(0);
    expect(p.complete).toBe(false);   // nothing to collect is not a completed collection
    expect(p.etaMs).toBe(0);
  });

  it('survives unparseable timestamps rather than emitting NaN', () => {
    const p = summariseCollection({
      totalAccounts: 1,
      runs: [{ iAccount: 1, status: 'done', fetched: 0, stored: 0,
               startedAt: 'not-a-date', finishedAt: 'also-not' }],
      startedAtIso: T0, nowIso: at(1),
    });
    expect(Number.isFinite(p.elapsedMs)).toBe(true);
    expect(p.etaMs === null || Number.isFinite(p.etaMs)).toBe(true);
  });
});
