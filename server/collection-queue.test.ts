import { describe, it, expect } from 'vitest';
import {
  planCollectionQueue, learnAccountCost, planFromHistory,
  detectRuntimeRegression, planConfidence,
  DEFAULT_COST_MS, MAX_WORKERS, MIN_WORKERS,
  type QueueAccount,
} from './collection-queue';

const heavy = (i: number, priority?: number): QueueAccount =>
  ({ iAccount: i, weight: 'heavy', priority });
const light = (i: number): QueueAccount => ({ iAccount: i, weight: 'light' });
const unknown = (i: number): QueueAccount => ({ iAccount: i, weight: 'unknown' });

/** Today's production shape: 2 heavy, 23 light. */
const PRODUCTION = [heavy(315), heavy(588), ...Array.from({ length: 23 }, (_, k) => light(k + 1))];

describe('longest-first is what makes the window', () => {
  /**
   * The failure it removes is the one the sequential collector has now: 21
   * empty accounts run first, then asterisk, then internal-ptcl — so with five
   * workers four sit idle through the lights and the heavies land at the end.
   */
  it('puts heavy accounts at the front', () => {
    const p = planCollectionQueue({ accounts: PRODUCTION, maxWorkers: 5 });
    expect(p.order.slice(0, 2).map(a => a.iAccount)).toEqual([315, 588]);
  });

  it('beats arrival order on the same accounts', () => {
    const arrival = [...Array.from({ length: 23 }, (_, k) => light(k + 1)), heavy(315), heavy(588)];
    // Simulate arrival order by pinning every weight to 'unknown' cost? No —
    // compare the planner against a hand-rolled FIFO makespan on real costs.
    const fifoMakespan = (accts: QueueAccount[], workers: number) => {
      const free = new Array(workers).fill(0);
      for (const a of accts) {
        let e = 0;
        for (let i = 1; i < workers; i++) if (free[i] < free[e]) e = i;
        free[e] += DEFAULT_COST_MS[a.weight];
      }
      return Math.max(...free);
    };
    const planned = planCollectionQueue({ accounts: arrival, maxWorkers: 5 }).estimateMs;
    expect(planned).toBeLessThan(fifoMakespan(arrival, 5));
  });

  it('orders unknown between heavy and light', () => {
    // Optimistic enough to start early if it turns out heavy; not so
    // optimistic that it displaces a known-heavy account.
    const p = planCollectionQueue({ accounts: [light(1), unknown(2), heavy(3)], maxWorkers: 2 });
    expect(p.order.map(a => a.weight)).toEqual(['heavy', 'unknown', 'light']);
  });

  it('breaks ties by revenue priority, so an interrupted run keeps the money', () => {
    const p = planCollectionQueue({
      accounts: [heavy(100, 3), heavy(200, 1), heavy(300, 2)], maxWorkers: 1,
    });
    expect(p.order.map(a => a.iAccount)).toEqual([200, 300, 100]);
  });

  it('is deterministic, so a resumed run repeats the same sequence', () => {
    const a = planCollectionQueue({ accounts: PRODUCTION, maxWorkers: 5 }).order.map(x => x.iAccount);
    const b = planCollectionQueue({ accounts: [...PRODUCTION].reverse(), maxWorkers: 5 }).order.map(x => x.iAccount);
    expect(a).toEqual(b);
  });
});

describe('the makespan estimate', () => {
  /**
   * Dividing total work by worker count understates whenever one account
   * outlasts everything else — exactly this workload, where a single
   * 20-minute account sets the floor no matter how many workers exist.
   */
  it('never predicts less than the longest single account', () => {
    const p = planCollectionQueue({ accounts: PRODUCTION, maxWorkers: 10 });
    expect(p.estimateMs).toBeGreaterThanOrEqual(DEFAULT_COST_MS.heavy);
  });

  it('shortens as workers are added, then stops at the floor', () => {
    const one  = planCollectionQueue({ accounts: PRODUCTION, maxWorkers: 1 }).estimateMs;
    const five = planCollectionQueue({ accounts: PRODUCTION, maxWorkers: 5 }).estimateMs;
    const ten  = planCollectionQueue({ accounts: PRODUCTION, maxWorkers: 10 }).estimateMs;
    expect(five).toBeLessThan(one);
    expect(ten).toBeLessThanOrEqual(five);
    expect(ten).toBe(DEFAULT_COST_MS.heavy);   // one heavy account is the floor
  });

  /**
   * THE SIZING RESULT, and it does not say what I expected. At measured costs
   * 500 accounts is 40 heavy × 20m + 460 light × 1m = 1,260 worker-minutes.
   * Ten workers gives 126 minutes — 2.1 hours, which OVERSHOOTS the
   * 02:00–03:00 window rather than fitting inside it.
   *
   * So concurrency alone does not buy the business requirement at today's
   * per-account cost. Either the window widens, or the workers go beyond ten
   * (each one holding its own working set, on an instance already killed by
   * ONE heavy account), or the 20 minutes comes down — which is what fixing
   * the fetch and streaming the pages are for. Pinned here so the trade-off is
   * a number rather than an assumption.
   */
  it('shows ten workers OVERSHOOTING a two-hour window at measured costs', () => {
    const five_hundred: QueueAccount[] = [
      ...Array.from({ length: 40 }, (_, k) => heavy(1000 + k)),
      ...Array.from({ length: 460 }, (_, k) => light(2000 + k)),
    ];
    const seq = planCollectionQueue({ accounts: five_hundred, maxWorkers: 1 }).estimateMs;
    const ten = planCollectionQueue({ accounts: five_hundred, maxWorkers: 10 }).estimateMs;
    expect(seq).toBe(75_600_000);                    // 21 hours sequential
    expect(ten).toBe(7_560_000);                     // 2.1 hours — over the window
    expect(ten).toBeGreaterThan(2 * 3600_000);
  });

  /** And what WOULD fit: the same 500 accounts once a heavy account costs 8
   *  minutes instead of 20. Concurrency and per-account cost multiply. */
  it('fits the window at ten workers once heavy accounts cost 8 minutes', () => {
    const five_hundred: QueueAccount[] = [
      ...Array.from({ length: 40 }, (_, k) => heavy(1000 + k)),
      ...Array.from({ length: 460 }, (_, k) => light(2000 + k)),
    ];
    const ten = planCollectionQueue({
      accounts: five_hundred, maxWorkers: 10, costMs: { heavy: 8 * 60_000 },
    }).estimateMs;
    expect(ten).toBeLessThanOrEqual(2 * 3600_000);
  });

  it('accepts measured costs rather than assuming the defaults', () => {
    const p = planCollectionQueue({
      accounts: [heavy(1)], maxWorkers: 1, costMs: { heavy: 90_000 },
    });
    expect(p.estimateMs).toBe(90_000);
  });

  it('is zero for an empty queue', () => {
    expect(planCollectionQueue({ accounts: [], maxWorkers: 5 }).estimateMs).toBe(0);
  });
});

describe('resume, not restart', () => {
  it('skips accounts already collected for the date', () => {
    const p = planCollectionQueue({
      accounts: PRODUCTION, maxWorkers: 5, completed: [315, 1, 2, 3],
    });
    expect(p.skipped.sort((a, b) => a - b)).toEqual([1, 2, 3, 315]);
    expect(p.order.map(a => a.iAccount)).not.toContain(315);
    expect(p.order).toHaveLength(PRODUCTION.length - 4);
  });

  it('reports a shorter estimate once the heavy work is done', () => {
    const full = planCollectionQueue({ accounts: PRODUCTION, maxWorkers: 5 }).estimateMs;
    const part = planCollectionQueue({ accounts: PRODUCTION, maxWorkers: 5, completed: [315, 588] }).estimateMs;
    expect(part).toBeLessThan(full);
  });

  it('handles every account already collected', () => {
    const p = planCollectionQueue({
      accounts: PRODUCTION, maxWorkers: 5, completed: PRODUCTION.map(a => a.iAccount),
    });
    expect(p.order).toEqual([]);
    expect(p.estimateMs).toBe(0);
    expect(p.basis).toContain('already collected and skipped');
  });
});

describe('worker bounds are enforced, not trusted', () => {
  it('clamps above the ceiling', () => {
    // Each concurrent account holds its own working set, and ONE heavy account
    // has already been enough to get the instance killed.
    expect(planCollectionQueue({ accounts: PRODUCTION, maxWorkers: 500 }).workers).toBe(MAX_WORKERS);
  });

  it('clamps below one', () => {
    expect(planCollectionQueue({ accounts: PRODUCTION, maxWorkers: 0 }).workers).toBe(MIN_WORKERS);
    expect(planCollectionQueue({ accounts: PRODUCTION, maxWorkers: -3 }).workers).toBe(MIN_WORKERS);
  });

  it('defaults to five when unspecified', () => {
    expect(planCollectionQueue({ accounts: PRODUCTION }).workers).toBe(5);
  });

  it('rejects a fractional worker count rather than half-scheduling', () => {
    expect(planCollectionQueue({ accounts: PRODUCTION, maxWorkers: 4.9 }).workers).toBe(4);
  });
});

describe('the basis is checkable', () => {
  it('states the counts and costs it used', () => {
    const p = planCollectionQueue({ accounts: PRODUCTION, maxWorkers: 5 });
    expect(p.basis).toContain('2 heavy');
    expect(p.basis).toContain('5 worker(s)');
    expect(p.basis).toContain('no worker can hold two heavy accounts');
  });
});

describe('learned costs — the planner must not carry today defect into tomorrow', () => {
  /**
   * MEDIAN, NOT MEAN. During the degradation windows on 2026-08-31 and 09-01,
   * accounts that normally take ~60s took 260s and 403s. A mean drags every
   * future estimate toward the worst night the platform has had; a median
   * ignores it unless it becomes the norm.
   */
  it('ignores a degradation outlier that a mean would absorb', () => {
    const l = learnAccountCost({
      iAccount: 64,
      runs: [{ durationMs: 60_000, fetched: 0 }, { durationMs: 62_000, fetched: 0 },
             { durationMs: 403_000, fetched: 0 }],   // the 09-01 outlier
    });
    expect(l.costMs).toBe(62_000);                    // median, not the 175s mean
    expect(l.weight).toBe('light');
  });

  /**
   * Volume classifies, duration predicts. Classifying by duration would be
   * circular — duration is the thing being estimated, and it depends on the
   * platform's health as much as on the customer.
   */
  it('classifies by rows returned, never by how long the run took', () => {
    const slowButEmpty = learnAccountCost({
      iAccount: 75, runs: [{ durationMs: 260_000, fetched: 0 }],
    });
    expect(slowButEmpty.weight).toBe('light');

    const fastButBusy = learnAccountCost({
      iAccount: 315, runs: [{ durationMs: 30_000, fetched: 5_000 }],
    });
    expect(fastButBusy.weight).toBe('heavy');
  });

  it('marks an account with no history unknown rather than guessing', () => {
    const l = learnAccountCost({ iAccount: 999, runs: [] });
    expect(l.weight).toBe('unknown');
    expect(l.costMs).toBeNull();
    expect(l.basis).toContain('no completed run');
  });

  it('uses each account own cost instead of the class default', () => {
    // 315 has learned 8 minutes. The class default is 20. If the planner still
    // used the class constant the estimate would be 2.5x too high — which is
    // exactly how a hardcoded figure outlives the defect that produced it.
    const p = planFromHistory({
      maxWorkers: 1,
      history: [{ iAccount: 315, runs: [{ durationMs: 8 * 60_000, fetched: 9_000 }] }],
    });
    expect(p.estimateMs).toBe(8 * 60_000);
    expect(p.basis).toContain('1 costed from their own history');
  });

  it('falls back to the class default only where nothing is known', () => {
    const p = planFromHistory({
      maxWorkers: 1,
      history: [{ iAccount: 1, runs: [] }],
    });
    expect(p.estimateMs).toBe(DEFAULT_COST_MS.unknown);
    expect(p.basis).toContain('1 from class defaults');
  });

  it('reports live capacity for the operations panel', () => {
    const p = planFromHistory({
      maxWorkers: 5,
      nowIso: '2026-09-03T02:00:00.000Z',
      history: [
        { iAccount: 315, runs: [{ durationMs: 18 * 60_000, fetched: 9_000 }] },
        { iAccount: 588, runs: [{ durationMs: 17 * 60_000, fetched: 8_000 }] },
        ...Array.from({ length: 20 }, (_, k) => ({
          iAccount: 100 + k, runs: [{ durationMs: 55_000, fetched: 0 }],
        })),
        { iAccount: 999, runs: [] },
      ],
    });
    expect(p.capacity.workersConfigured).toBe(5);
    expect(p.capacity.remainingHeavy).toBe(2);
    expect(p.capacity.remainingLight).toBe(20);
    expect(p.capacity.remainingUnknown).toBe(1);
    expect(p.capacity.remaining).toBe(23);
    // 18 minutes of heaviest work sets the floor, so the finish is after 02:18.
    expect(Date.parse(p.capacity.finishEstimateIso!))
      .toBeGreaterThanOrEqual(Date.parse('2026-09-03T02:18:00.000Z'));
  });

  it('offers no finish time without a start time', () => {
    const p = planFromHistory({ history: [{ iAccount: 1, runs: [] }] });
    expect(p.capacity.finishEstimateIso).toBeNull();
  });

  it('still resumes: a completed account leaves the queue and the estimate', () => {
    const history = [
      { iAccount: 315, runs: [{ durationMs: 18 * 60_000, fetched: 9_000 }] },
      { iAccount: 588, runs: [{ durationMs: 17 * 60_000, fetched: 8_000 }] },
    ];
    const full = planFromHistory({ history, maxWorkers: 1 });
    const part = planFromHistory({ history, maxWorkers: 1, completed: [315] });
    expect(part.capacity.remaining).toBe(1);
    expect(part.estimateMs).toBeLessThan(full.estimateMs);
    expect(part.skipped).toEqual([315]);
  });
});

describe('runtime regression — the signal the degradation nights never raised', () => {
  /**
   * On 2026-08-31 account 75 took 260s and account 64 took 403s against a ~60s
   * norm. A 4–7x deviation, present in the ledger the whole time, reported by
   * nothing: the runs completed, the day sealed, and the only trace was a slow
   * clock nobody was watching.
   */
  const steady = (i: number, ms: number, n = 5) => ({
    iAccount: i, name: `acct-${i}`,
    runs: Array.from({ length: n }, () => ({ durationMs: ms, fetched: 0 })),
  });

  it('catches the 403s night against a 60s norm', () => {
    const r = detectRuntimeRegression({
      history: [steady(64, 60_000)],
      actual: [{ iAccount: 64, durationMs: 403_000 }],
    });
    expect(r).toHaveLength(1);
    expect(r[0].deviationPct).toBe(572);
    expect(r[0].detail).toContain('fetch telemetry');
  });

  it('says nothing about ordinary variance', () => {
    expect(detectRuntimeRegression({
      history: [steady(64, 60_000)],
      actual: [{ iAccount: 64, durationMs: 75_000 }],   // +25%
    })).toEqual([]);
  });

  /**
   * One sample is not an expectation. Warning on it is how an alert becomes
   * noise and then becomes ignored — which is what happened to the panel's
   * "scheduler may have stopped".
   */
  it('refuses to warn without enough history to have an expectation', () => {
    expect(detectRuntimeRegression({
      history: [{ iAccount: 64, runs: [{ durationMs: 60_000, fetched: 0 }] }],
      actual: [{ iAccount: 64, durationMs: 600_000 }],
    })).toEqual([]);
  });

  it('uses the median so one bad night cannot become the new expectation', () => {
    // Four normal runs and one 400s outlier: the median stays 60s, so the NEXT
    // slow run is still reported. A mean would have absorbed it.
    const withOutlier = {
      iAccount: 64, name: 'acct-64',
      runs: [60_000, 61_000, 59_000, 60_000, 400_000].map(d => ({ durationMs: d, fetched: 0 })),
    };
    const r = detectRuntimeRegression({
      history: [withOutlier], actual: [{ iAccount: 64, durationMs: 300_000 }],
    });
    expect(r).toHaveLength(1);
    expect(r[0].expectedMs).toBe(60_000);
  });

  it('ranks the worst deviation first', () => {
    const r = detectRuntimeRegression({
      history: [steady(1, 60_000), steady(2, 60_000)],
      actual: [{ iAccount: 1, durationMs: 180_000 }, { iAccount: 2, durationMs: 600_000 }],
    });
    expect(r.map(x => x.iAccount)).toEqual([2, 1]);
  });

  it('ignores an account it has never seen', () => {
    expect(detectRuntimeRegression({
      history: [], actual: [{ iAccount: 999, durationMs: 999_000 }],
    })).toEqual([]);
  });
});

describe('prediction confidence', () => {
  /**
   * An estimate from one run and an estimate from twenty are not the same
   * claim. Showing a finish time without that distinction invites the
   * misplaced trust the panel's old ETA earned.
   */
  it('is the share of the queue costed from real history', () => {
    const c = planConfidence({
      order: [heavy(1), heavy(2), light(3), light(4)],
      history: [
        { iAccount: 1, runs: Array.from({ length: 5 }, () => ({ durationMs: 1000, fetched: 9 })) },
        { iAccount: 2, runs: Array.from({ length: 3 }, () => ({ durationMs: 1000, fetched: 9 })) },
        { iAccount: 3, runs: [{ durationMs: 1000, fetched: 0 }] },   // too few
      ],
    });
    expect(c.costed).toBe(2);
    expect(c.total).toBe(4);
    expect(c.pct).toBe(50);
  });

  it('is zero for an empty queue rather than a misleading 100', () => {
    const c = planConfidence({ order: [], history: [] });
    expect(c.pct).toBe(0);
    expect(c.basis).toBe('nothing queued');
  });

  it('reaches 100 only when every queued account has real history', () => {
    const c = planConfidence({
      order: [heavy(1)],
      history: [{ iAccount: 1, runs: Array.from({ length: 9 }, () => ({ durationMs: 1000, fetched: 9 })) }],
    });
    expect(c.pct).toBe(100);
  });
});
