import { describe, it, expect } from 'vitest';
import {
  assessBudget, describeSpend, DEFAULT_BUDGET_MS, BACKOFF_SHARE_WARN,
  MIN_SLICES_TO_ABORT,
} from './collection-budget';

const MIN = 60_000;
const HOUR = 3_600_000;

/**
 * The measured run, 2026-09-03. Account internal-ptcl: 33 of 48 slices in
 * 1h30m, nothing fetched, still going when the process died at 07:00. Three
 * other accounts did 48 slices in about a minute each the same night.
 *
 * A slice that fails twice sleeps 30s then 60s, so 33 slices of that is ~50
 * minutes of pure backoff inside the 90.
 */
const THE_RUN = {
  slicesDone: 33, slicesTotal: 48,
  elapsedMs: 90 * MIN,
  backoffMs: 49.5 * MIN,   // 33 slices x 90s
  retries: 66,             // two failed attempts each
  normalSliceMs: 1_250,    // the peers: 48 slices in ~1m
};

describe('the run nothing noticed', () => {
  it('flags it as mostly-retrying, and the reason carries the numbers', () => {
    const d = assessBudget(THE_RUN);
    // 90min / 33 slices = 163s each; x48 = 2.2h, past the 4h budget? No —
    // it projects 2.2h, INSIDE 4h. So the budget alone does not catch it.
    expect(d.projectedTotalMs).toBeGreaterThan(2 * HOUR);
    expect(d.projectedTotalMs).toBeLessThan(DEFAULT_BUDGET_MS);
    // What catches it is that more than half the wall clock was sleep.
    expect(d.verdict).toBe('warn');
    expect(d.reason).toContain('Mostly retrying');
    expect(d.reason).toContain('66 failed attempt');
  });

  it('aborts once the window itself cannot be met', () => {
    // Same pace, but judged against the four-hour collection window it has to
    // finish inside — a job that outruns the window has failed at its purpose
    // even if it would eventually return rows.
    const d = assessBudget({ ...THE_RUN, budgetMs: 2 * HOUR });
    expect(d.verdict).toBe('abort');
    expect(d.reason).toContain('Cannot finish in budget');
    expect(d.projectedOverrunMs).toBeGreaterThan(0);
  });

  it('measures the slowdown against its own peers', () => {
    const d = assessBudget(THE_RUN);
    // 163s a slice against 1.25s is not "a bit slow".
    expect(Math.round(d.slowdownFactor!)).toBeGreaterThan(100);
  });
});

describe('a healthy run is left alone', () => {
  it('continues a fast job without comment', () => {
    const d = assessBudget({ slicesDone: 40, slicesTotal: 48, elapsedMs: 50_000,
                             normalSliceMs: 1_250 });
    expect(d.verdict).toBe('continue');
    expect(d.reason).toContain('On pace');
    expect(d.projectedOverrunMs).toBe(0);
  });

  it('does not judge a pace from one slice', () => {
    // One slow slice at the start is not a pace, and aborting on it would
    // kill jobs for a single transient fault — the thing retries exist for.
    //
    // It does WARN: 1 of 48 slices in 10 minutes projects 8 hours against a
    // one-hour budget, and the module used to call that "On pace". Not
    // aborting is the guarantee; pretending the projection is fine is not.
    const d = assessBudget({ slicesDone: 1, slicesTotal: 48, elapsedMs: 10 * MIN,
                             backoffMs: 9 * MIN, retries: 2, budgetMs: HOUR });
    expect(d.verdict).not.toBe('abort');
    expect(d.reason).not.toContain('On pace');
  });

  it('starts with no pace at all', () => {
    const d = assessBudget({ slicesDone: 0, slicesTotal: 48, elapsedMs: 0 });
    expect(d.msPerSlice).toBeNull();
    expect(d.projectedTotalMs).toBeNull();
    expect(d.verdict).toBe('continue');
    expect(d.reason).toContain('Starting');
  });
});

describe('the budget is a hard ceiling once reached', () => {
  it('aborts on elapsed alone, whatever the projection says', () => {
    const d = assessBudget({ slicesDone: 47, slicesTotal: 48,
                             elapsedMs: DEFAULT_BUDGET_MS + 1, retries: 3, backoffMs: 2 * MIN });
    expect(d.verdict).toBe('abort');
    expect(d.reason).toContain('Budget exhausted');
    // Even one slice from the end. Being nearly finished is not a reason to
    // keep running past the window; the window is when the switch is quiet.
    expect(d.reason).toContain('47/48');
  });
});

describe('backoff share', () => {
  it('warns at the threshold and not below it', () => {
    const base = { slicesDone: 10, slicesTotal: 48, elapsedMs: 100 * 1000, retries: 5 };
    const under = assessBudget({ ...base, backoffMs: (BACKOFF_SHARE_WARN * 100 - 1) * 1000 });
    const over  = assessBudget({ ...base, backoffMs: (BACKOFF_SHARE_WARN * 100 + 1) * 1000 });
    expect(under.verdict).toBe('continue');
    expect(over.verdict).toBe('warn');
  });

  it('never reports a share above 1, whatever the caller passes', () => {
    const d = assessBudget({ slicesDone: 5, slicesTotal: 48, elapsedMs: 1000, backoffMs: 9999 });
    expect(d.backoffShare).toBe(1);
  });

  it('is 0 when no time has passed, rather than NaN', () => {
    expect(assessBudget({ slicesDone: 0, slicesTotal: 48, elapsedMs: 0, backoffMs: 5 }).backoffShare).toBe(0);
  });
});

describe('describeSpend separates work from sleep', () => {
  it('splits the wall clock the panel could not', () => {
    // "33/48 · 0 stored · 1h 30m" gave an operator no way to tell 90 minutes
    // of work from 90 minutes of sleep. Those need opposite responses.
    const s = describeSpend(THE_RUN);
    expect(s).toContain('33/48');
    expect(s).toContain('asleep in backoff');
    expect(s).toContain('66 failed attempt');
    expect(s).toMatch(/41m fetching/);   // 90 - 49.5 = 40.5, rounds to 41
  });

  it('says so plainly when there were no retries', () => {
    const s = describeSpend({ slicesDone: 48, slicesTotal: 48, elapsedMs: 69_000 });
    expect(s).toContain('no retries');
    expect(s).not.toContain('backoff');
  });
});

describe('a projection must not contradict itself, and must not abort on a burst', () => {
  it('never says "On pace" while projecting an overrun', () => {
    // 2 of 48 slices in 20 minutes projects 8 hours against a 1-hour budget,
    // and reported "On pace: ... projected 8.0h total".
    const d = assessBudget({ slicesDone: 2, slicesTotal: 48, elapsedMs: 20 * MIN, budgetMs: HOUR });
    expect(d.projectedTotalMs!).toBeGreaterThan(HOUR);
    expect(d.reason).not.toContain('On pace');
    expect(d.verdict).toBe('warn');
    expect(d.reason).toContain('too few to act on');
  });

  it('still says "On pace" when the projection genuinely fits', () => {
    const d = assessBudget({ slicesDone: 2, slicesTotal: 48, elapsedMs: 2_000, budgetMs: HOUR });
    expect(d.verdict).toBe('continue');
    expect(d.reason).toContain('On pace');
  });

  it('does not abort a job on a three-slice burst of heavy backoff', () => {
    // Three auth-flavoured retries early (16.5 min of backoff each) projected
    // 13 hours and killed a job whose remaining 45 slices might run in a
    // minute. It must be loudly visible, but not fatal.
    const burst = { slicesDone: 3, slicesTotal: 48, elapsedMs: 50 * MIN,
                    backoffMs: 49 * MIN, retries: 6, budgetMs: 4 * HOUR };
    const d = assessBudget(burst);
    expect(d.verdict).not.toBe('abort');
    expect(d.verdict).toBe('warn');
  });

  it('does abort once the bad pace is confirmed over more slices', () => {
    const sustained = { slicesDone: MIN_SLICES_TO_ABORT, slicesTotal: 48,
                        elapsedMs: 85 * MIN, backoffMs: 80 * MIN, retries: 10,
                        budgetMs: 4 * HOUR };
    const d = assessBudget(sustained);
    expect(d.verdict).toBe('abort');
    // And it states that the projection is an assumption, not a certainty.
    expect(d.reason).toContain('assuming the observed rate continues');
  });
})
