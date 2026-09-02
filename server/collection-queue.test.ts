import { describe, it, expect } from 'vitest';
import {
  planCollectionQueue, DEFAULT_COST_MS, MAX_WORKERS, MIN_WORKERS,
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
