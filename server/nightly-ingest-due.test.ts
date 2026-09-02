import { describe, it, expect } from 'vitest';
import { decideNightlyIngest, type ReconAttempt } from './nightly-ingest-due';

/** A per-ACCOUNT completion — proves that account ran, and nothing more. */
const done    = (date: string): ReconAttempt => ({ date, status: 'done' });
const errored = (date: string): ReconAttempt => ({ date, status: 'error' });
const running = (date: string): ReconAttempt => ({ date, status: 'running' });
/** The DAY-COMPLETION sentinel — the only row that marks a date collected.
 *  Written by the collector after visiting every account with zero failures. */
const sealed  = (date: string): ReconAttempt => ({ date, status: 'done', daySentinel: true });

/** Every day of the lookback SEALED, so nothing is owed. */
const allCollected = (through: string, days: number): ReconAttempt[] => {
  const end = Date.parse(`${through}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) =>
    sealed(new Date(end - i * 86400000).toISOString().slice(0, 10)));
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
  /**
   * SUPERSEDED 2026-09-02, and the conflict is worth recording rather than
   * quietly editing. The original rule was "collect the moment you notice,
   * because the process may not survive to the next window" — a reasonable
   * fear given [[long-timers-never-fire]]. The owner then required collection
   * to stay inside the off-peak window because a daytime fetch loads a switch
   * carrying live calls.
   *
   * The two only conflict if the process is NOT alive in the window. Evidence
   * says it is: on 2026-09-02 the daily pipeline ran at 02:13 and
   * materialisation at 03:02, both unattended. So the day is deferred, not
   * lost — and if the process ever does miss every window, the day stays owed
   * and NAMED rather than silently skipped, which is the property that
   * actually mattered.
   */
  it('DEFERS a 14:00 tick to the window, while still naming what is owed', () => {
    const d = decideNightlyIngest({ nowIso: '2026-08-28T14:00:00Z', attempts: [] });
    expect(d.due).toBe(false);
    expect(d.targetDate).toBe('2026-08-27');      // still knows, still reports
    expect(d.reason).toContain('collection window');
  });

  it('collects that same day once the window opens', () => {
    const d = decideNightlyIngest({ nowIso: '2026-08-28T02:30:00Z', attempts: [] });
    expect(d.due).toBe(true);
    expect(d.targetDate).toBe('2026-08-27');
  });

  it('drains a backlog oldest-first so a slept-through gap is repaired', () => {
    // Down for three days: 25, 26, 27 all missing.
    const d = decideNightlyIngest({
      nowIso: '2026-08-28T03:00:00Z',
      attempts: [sealed('2026-08-24'), sealed('2026-08-23'), sealed('2026-08-22'), sealed('2026-08-21')],
    });
    expect(d.due).toBe(true);
    expect(d.targetDate).toBe('2026-08-25'); // oldest owed, not yesterday
    expect(d.backlog).toBe(3);
  });

  /**
   * A backlog is still exempt from the SETTLING delay — that rule is about the
   * switch finishing yesterday's records, and an older day carries no such
   * doubt. It is NOT exempt from the collection window, which is about load.
   * Two different gates for two different reasons.
   */
  it('is not held by the settling hour, but is held by the window', () => {
    const early = decideNightlyIngest({
      nowIso: '2026-08-28T00:05:00Z',                 // before settling AND before window
      attempts: [sealed('2026-08-24'), sealed('2026-08-27')], // 25 and 26 missing
    });
    expect(early.due).toBe(false);
    expect(early.reason).toContain('collection window');   // window, not settling
    expect(early.targetDate).toBe('2026-08-25');

    const inWindow = decideNightlyIngest({
      nowIso: '2026-08-28T02:05:00Z',                 // still before settling+1h? no: 02:05 > 01:00
      attempts: [sealed('2026-08-24'), sealed('2026-08-27')],
    });
    expect(inWindow.due).toBe(true);
    expect(inWindow.targetDate).toBe('2026-08-25');
  });

  /**
   * An empty ledger is a COLD START, not a seven-day gap. Without this guard
   * first boot would backfill a week against a production switch, unattended.
   * Filling history stays an operator decision.
   */
  it('collects only yesterday on a cold start, never a week of history', () => {
    const d = decideNightlyIngest({ nowIso: '2026-08-28T03:00:00Z', attempts: [] });
    expect(d.due).toBe(true);
    expect(d.targetDate).toBe('2026-08-27');
    expect(d.backlog).toBe(1);
  });

  /** Nor does it reach back past the day capture actually began. */
  it('never collects a day that closed before forward capture started', () => {
    const d = decideNightlyIngest({
      nowIso: '2026-08-28T03:00:00Z',
      attempts: [sealed('2026-08-26')], // capture began on the 26th
    });
    expect(d.targetDate).toBe('2026-08-27');
    expect(d.backlog).toBe(1);
  });
});

describe('attempts, not optimism, decide when to stop', () => {
  it('does not re-collect a day already sealed', () => {
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
      // 05:00 is inside the window; 3h after the run started, so past the
      // 90-minute stale threshold and correctly read as a corpse.
      nowIso: '2026-08-28T05:00:00Z',
      attempts: [...allCollected('2026-08-26', 6),
                 { date: '2026-08-27', status: 'running', startedAtIso: '2026-08-28T02:00:00Z' }],
    });
    expect(d.due).toBe(true);
    expect(d.targetDate).toBe('2026-08-27');
  });

  it('leaves a genuinely live run alone', () => {
    const d = decideNightlyIngest({
      nowIso: '2026-08-28T03:00:00Z',
      attempts: [...allCollected('2026-08-26', 6),
                 { date: '2026-08-27', status: 'running', startedAtIso: '2026-08-28T08:55:00Z' }],
    });
    expect(d.due).toBe(false);
  });

  it('trusts the status when a running row carries no timestamp', () => {
    const d = decideNightlyIngest({
      nowIso: '2026-08-28T03:00:00Z',
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

describe('a partial day is not a collected day — the nights of 2026-08-30/31', () => {
  /**
   * Both incidents, verbatim from production. The ledger is one row per
   * account, and the old rule accepted ANY done row as "date collected".
   *
   * Night 1 (08-30): the run died silently after 7 of ~25 accounts — no error
   * row, no stale row, the process went away between accounts. Night 2
   * (08-31): the run died at account 5, leaving a stale 'running' row. Both
   * days showed done rows; both were declared collected; both were missing
   * the two accounts that carry the money. 08-31 had ZERO repository rows
   * while the panel read "Nothing owed — every day collected".
   */
  it('re-owes the 08-30 shape: done rows, no sentinel, no corpse', () => {
    const d = decideNightlyIngest({
      nowIso: '2026-09-01T03:00:00Z',
      attempts: [
        ...allCollected('2026-08-29', 5),
        // 7 accounts finished cleanly, then the process vanished mid-day.
        done('2026-08-30'), done('2026-08-30'), done('2026-08-30'),
        done('2026-08-30'), done('2026-08-30'), done('2026-08-30'), done('2026-08-30'),
      ],
    });
    expect(d.due).toBe(true);
    expect(d.targetDate).toBe('2026-08-30');
  });

  it('re-owes the 08-31 shape: done rows plus a dead running row', () => {
    const d = decideNightlyIngest({
      nowIso: '2026-09-01T05:00:00Z',
      attempts: [
        ...allCollected('2026-08-30', 6),
        done('2026-08-31'), done('2026-08-31'), done('2026-08-31'), done('2026-08-31'),
        { date: '2026-08-31', status: 'running', startedAtIso: '2026-09-01T01:52:18Z' },
      ],
    });
    expect(d.due).toBe(true);
    expect(d.targetDate).toBe('2026-08-31');
  });

  it('a sealed day with a leftover corpse stays collected', () => {
    // The retry that sealed the day overwrites the per-account rows it re-runs,
    // but a corpse for an account no longer in the list could survive. The
    // sentinel is the assertion of completeness; the corpse is history.
    const d = decideNightlyIngest({
      nowIso: '2026-09-01T03:00:00Z',
      attempts: [
        ...allCollected('2026-08-31', 7),
        { date: '2026-08-31', status: 'running', startedAtIso: '2026-08-31T01:00:00Z' },
      ],
    });
    // The precedence matters: if the corpse outranked the seal, a complete
    // day would re-run forever. The seal wins.
    expect(d.due).toBe(false);
    expect(d.backlog).toBe(0);
  });

  it('per-account done rows never count toward exhaustion', () => {
    // Old rule: tries.length >= 3, so two clean accounts plus one corpse read
    // as "3 attempts" and the day was abandoned on its FIRST failure —
    // exhaustion fired hardest at the days that most needed retrying.
    const d = decideNightlyIngest({
      nowIso: '2026-09-01T05:00:00Z',
      attempts: [
        ...allCollected('2026-08-30', 6),
        done('2026-08-31'), done('2026-08-31'), done('2026-08-31'), done('2026-08-31'),
        { date: '2026-08-31', status: 'running', startedAtIso: '2026-09-01T01:52:18Z' },
      ],
      maxAttemptsPerDate: 3,
    });
    expect(d.exhaustedDates).not.toContain('2026-08-31');
    expect(d.due).toBe(true);
  });
});

describe('an abandoned day must never go unmentioned', () => {
  const at = (date: string, iso: string) => ({ date, status: 'error', startedAtIso: iso });

  /**
   * The gap the owner identified for an unattended weekend. A day that
   * exhausted its attempts used to disappear from the decision entirely once a
   * LATER day became owed — the scheduler would report "2026-08-29 owed" and
   * say nothing about having given up on 08-28.
   */
  it('reports an abandoned day even while a later day is owed', () => {
    const d = decideNightlyIngest({
      nowIso: '2026-08-30T03:00:00Z',
      attempts: [
        ...allCollected('2026-08-27', 5),
        at('2026-08-28', '2026-08-29T01:00:00Z'),
        at('2026-08-28', '2026-08-29T03:00:00Z'),
        at('2026-08-28', '2026-08-29T05:00:00Z'),
      ],
      maxAttemptsPerDate: 3,
    });
    expect(d.due).toBe(true);
    expect(d.targetDate).toBe('2026-08-29');       // moves on, as it must
    expect(d.exhaustedDates).toContain('2026-08-28'); // but SAYS what it left behind
  });

  it('names the abandoned days when nothing at all is collectable', () => {
    const d = decideNightlyIngest({
      nowIso: '2026-08-29T03:00:00Z',
      attempts: [
        ...allCollected('2026-08-27', 5),
        at('2026-08-28', '2026-08-29T01:00:00Z'),
        at('2026-08-28', '2026-08-29T03:00:00Z'),
        at('2026-08-28', '2026-08-29T05:00:00Z'),
      ],
      maxAttemptsPerDate: 3,
    });
    expect(d.due).toBe(false);
    expect(d.reason).toMatch(/2026-08-28/);
  });

  it('carries exhaustedDates on every decision shape, never undefined', () => {
    expect(decideNightlyIngest({ nowIso: 'nonsense', attempts: [] }).exhaustedDates).toEqual([]);
    expect(decideNightlyIngest({ nowIso: '2026-08-28T02:00:00Z', attempts: [] }).exhaustedDates).toEqual([]);
  });
});

describe('retry pacing — an attempt budget must span hours, not minutes', () => {
  /**
   * Ticks are ten minutes apart. Without pacing, a Friday-night failure could
   * burn all three attempts in half an hour and leave the day abandoned for the
   * whole weekend with nobody watching.
   */
  it('waits before retrying a day that just failed', () => {
    const d = decideNightlyIngest({
      nowIso: '2026-08-28T02:10:00Z',
      attempts: [...allCollected('2026-08-26', 6),
                 { date: '2026-08-27', status: 'error', startedAtIso: '2026-08-28T02:00:00Z' }],
    });
    expect(d.due).toBe(false);
    expect(d.targetDate).toBe('2026-08-27');   // still owed
    expect(d.reason).toMatch(/next retry in/);
  });

  it('retries once the gap has passed', () => {
    const d = decideNightlyIngest({
      nowIso: '2026-08-28T03:30:00Z',
      attempts: [...allCollected('2026-08-26', 6),
                 { date: '2026-08-27', status: 'error', startedAtIso: '2026-08-28T02:00:00Z' }],
    });
    expect(d.due).toBe(true);
    expect(d.targetDate).toBe('2026-08-27');
  });

  /** Cooling down must not skip ahead — that would abandon oldest-first order. */
  it('waits on the oldest owed day rather than collecting a newer one', () => {
    const d = decideNightlyIngest({
      nowIso: '2026-08-30T03:10:00Z',
      attempts: [...allCollected('2026-08-27', 5),
                 { date: '2026-08-28', status: 'error', startedAtIso: '2026-08-30T03:00:00Z' }],
    });
    expect(d.due).toBe(false);
    expect(d.targetDate).toBe('2026-08-28');
    expect(d.backlog).toBe(2);
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

describe('the off-peak collection window (owner requirement 2026-09-02)', () => {
  /**
   * "CDR fetch only on off peak time GMT 00 ... it makes SIPPY high load."
   *
   * The tick was already cheap — it asks the ledger a question and fetches
   * nothing when nothing is owed. But when a day WAS owed it collected at
   * whatever hour the tick noticed, and on 2026-09-02 that pulled 09-01 from
   * Sippy between 15:46 and 17:08: the middle of the business day, against a
   * switch carrying live traffic.
   */
  const owedYesterday = [{ date: '2026-08-30', status: 'done', daySentinel: true }];

  it('refuses to collect at 15:46, the hour that caused this', () => {
    const d = decideNightlyIngest({
      nowIso: '2026-09-02T15:46:00Z', attempts: owedYesterday,
    });
    expect(d.due).toBe(false);
    expect(d.reason).toContain('DEFERRED until the 02:00–06:00 UTC collection window');
    expect(d.reason).toContain('business hours');
    // Still NAMES what is owed — refusing to collect is not refusing to report.
    expect(d.targetDate).not.toBeNull();
    expect(d.backlog).toBeGreaterThan(0);
  });

  it('collects inside the window', () => {
    const d = decideNightlyIngest({
      nowIso: '2026-09-02T02:30:00Z', attempts: owedYesterday,
    });
    expect(d.due).toBe(true);
  });

  /**
   * The reversal that matters. Backlog days were EXEMPT from the hour gate so
   * a gap would drain fast; they are not exempt from the window. Sippy's
   * daytime load outranks closing a gap six hours sooner, and a day that is
   * already late loses little by waiting for tonight.
   */
  it('holds a BACKLOG day too, which the old hour gate did not', () => {
    const d = decideNightlyIngest({
      nowIso: '2026-09-02T14:00:00Z',
      attempts: [{ date: '2026-08-27', status: 'done', daySentinel: true }],
    });
    expect(d.due).toBe(false);
    expect(d.reason).toContain('collection window');
  });

  it('lets an operator override it — an explicit human decision', () => {
    const d = decideNightlyIngest({
      nowIso: '2026-09-02T15:46:00Z', attempts: owedYesterday, ignoreWindow: true,
    });
    expect(d.due).toBe(true);
  });

  it('honours a configured window', () => {
    const at = (h: string) => decideNightlyIngest({
      nowIso: `2026-09-02T${h}:00:00Z`, attempts: owedYesterday,
      windowStartHourUtc: 22, windowEndHourUtc: 23,
    });
    expect(at('22').due).toBe(true);
    expect(at('21').due).toBe(false);
    expect(at('23').due).toBe(false);
  });

  it('handles a window that crosses midnight', () => {
    const at = (h: string) => decideNightlyIngest({
      nowIso: `2026-09-02T${h}:00:00Z`, attempts: owedYesterday,
      windowStartHourUtc: 23, windowEndHourUtc: 3,
    });
    expect(at('23').due).toBe(true);
    expect(at('01').due).toBe(true);
    expect(at('04').due).toBe(false);
  });

  it('still reports nothing owed as nothing owed, not as out-of-window', () => {
    // The window must never disguise a healthy state as a deferred one.
    const d = decideNightlyIngest({
      nowIso: '2026-09-02T15:46:00Z',
      attempts: [
        { date: '2026-09-01', status: 'done', daySentinel: true },
        { date: '2026-08-31', status: 'done', daySentinel: true },
        { date: '2026-08-30', status: 'done', daySentinel: true },
        { date: '2026-08-29', status: 'done', daySentinel: true },
        { date: '2026-08-28', status: 'done', daySentinel: true },
        { date: '2026-08-27', status: 'done', daySentinel: true },
        { date: '2026-08-26', status: 'done', daySentinel: true },
      ],
    });
    expect(d.due).toBe(false);
    expect(d.reason).toContain('collected');
    expect(d.reason).not.toContain('window');
  });
});

describe('deferred work says WHEN, not just that it is waiting', () => {
  /**
   * "Nothing is happening" and "nothing is happening for another 12h 20m" are
   * different messages, and only one of them stops an operator investigating a
   * system that is working correctly. This week produced three false "the
   * scheduler has stopped" reports from exactly that ambiguity.
   */
  it('names the next window opening and the wait', () => {
    const d = decideNightlyIngest({
      nowIso: '2026-09-02T13:40:00Z',
      attempts: [{ date: '2026-08-30', status: 'done', daySentinel: true }],
    });
    expect(d.due).toBe(false);
    expect(d.nextWindowIso).toBe('2026-09-03T02:00:00.000Z');   // tomorrow's opening
    expect(d.reason).toContain('12h 20m away');
    expect(d.reason).toContain('DEFERRED');
    expect(d.reason).toContain('recovery mode');
  });

  it('points at today when the window has not opened yet', () => {
    const d = decideNightlyIngest({
      nowIso: '2026-09-02T00:30:00Z',
      attempts: [{ date: '2026-08-30', status: 'done', daySentinel: true }],
    });
    expect(d.nextWindowIso).toBe('2026-09-02T02:00:00.000Z');
    expect(d.reason).toContain('1h 30m away');
  });

  it('offers no window time when work is actually due', () => {
    const d = decideNightlyIngest({
      nowIso: '2026-09-02T02:30:00Z',
      attempts: [{ date: '2026-08-30', status: 'done', daySentinel: true }],
    });
    expect(d.due).toBe(true);
    expect(d.nextWindowIso).toBeUndefined();
  });
});
