/**
 * collection-queue.ts — the order 500 accounts should be collected in.
 *
 * Owner requirement 2026-09-02: process 4–5 accounts at a time so the nightly
 * run fits the 02:00–03:00 window at 500+ customers. At today's measured rates
 * a sequential run of 500 accounts takes ~21 hours (40 busy × 20 min + 460
 * empty × 1 min); with five workers it lands near four, with ten near two.
 *
 * THE ORDER MATTERS MORE THAN THE ASSIGNMENT, and that is the useful result
 * here. With a PULL queue — each worker takes the next account when it frees
 * up — no static allocation is needed, and no worker can be handed two heavy
 * accounts while another idles. Ordering longest-first is the classic LPT
 * heuristic and is provably within 4/3 of the optimal makespan; the failure
 * mode it removes is the one that actually bites:
 *
 *   arrival order   [light ×23, heavy, heavy]   → 5 workers idle for 23 min,
 *                                                  then 20 min on the tail
 *   heavy first     [heavy, heavy, light ×23]   → heavies run in parallel
 *                                                  from t=0, lights fill in
 *
 * On today's list that is the difference between ~43 minutes and ~25. The
 * naive order is exactly what the sequential collector does now: 21 empty
 * accounts, then asterisk, then internal-ptcl.
 *
 * WEIGHT IS EVIDENCE, NOT A GUESS. An account is heavy because it has
 * returned CDRs before, read from the repository. An account nobody has
 * collected yet is 'unknown' and is ordered between the two — optimistic
 * enough to start early if it turns out to be heavy, not so optimistic that it
 * displaces a known-heavy account.
 *
 * RESUME IS THE SAME MECHANISM AS THE DAY SEAL: accounts already collected for
 * the date are skipped, so a killed run resumes rather than restarting. Proven
 * in production on 2026-09-01, where a re-run fetched 1,033 rows and stored
 * zero.
 *
 * Dependency-free so the ordering is pinned by tests.
 */

/** Bounds, not preferences. One worker is the current behaviour; the ceiling
 *  exists because each concurrent account holds its own working set and the
 *  instance has already been killed by ONE heavy account's footprint. */
export const MIN_WORKERS = 1;
export const MAX_WORKERS = 10;
export const DEFAULT_WORKERS = 5;

export type Weight = 'heavy' | 'light' | 'unknown';

export interface QueueAccount {
  iAccount: number;
  name?:    string | null;
  weight:   Weight;
  /** Revenue rank, lower first. Ties inside a weight class break on this, so
   *  an interrupted run has collected the money that matters most. */
  priority?: number;
}

export interface QueuePlan {
  /** The pull order. Workers take from the front. */
  order:     QueueAccount[];
  /** Already collected for this date — skipped, not re-run. */
  skipped:   number[];
  workers:   number;
  /** Rough makespan in ms, from the supplied per-class costs. */
  estimateMs: number;
  /** How the estimate was reached, so it is checkable rather than trusted. */
  basis:     string;
}

/** Observed on 2026-08/09: ~60s for an account with no CDRs, ~20 min for one
 *  with real traffic. Overridable — these are measurements, not constants. */
export const DEFAULT_COST_MS: Record<Weight, number> = {
  heavy:   20 * 60_000,
  light:        60_000,
  unknown:  5 * 60_000,
};

const RANK: Record<Weight, number> = { heavy: 0, unknown: 1, light: 2 };

export function planCollectionQueue(opts: {
  accounts:   QueueAccount[];
  maxWorkers?: number;
  /** Accounts already done for this date. Resume, not restart. */
  completed?: number[];
  costMs?:    Partial<Record<Weight, number>>;
}): QueuePlan {
  const cost = { ...DEFAULT_COST_MS, ...(opts.costMs ?? {}) };
  const workers = Math.min(MAX_WORKERS, Math.max(MIN_WORKERS,
    Math.floor(opts.maxWorkers ?? DEFAULT_WORKERS)));

  const done = new Set(opts.completed ?? []);
  const skipped = opts.accounts.filter(a => done.has(a.iAccount)).map(a => a.iAccount);
  const todo = opts.accounts.filter(a => !done.has(a.iAccount));

  // Heavy first, then unknown, then light; revenue priority breaks ties; the
  // account id breaks those, so the order is deterministic and a resumed run
  // produces the same sequence as the run it replaces.
  const order = [...todo].sort((a, b) =>
    RANK[a.weight] - RANK[b.weight] ||
    (a.priority ?? Number.MAX_SAFE_INTEGER) - (b.priority ?? Number.MAX_SAFE_INTEGER) ||
    a.iAccount - b.iAccount);

  // Makespan by simulating the pull queue: each worker takes the next account
  // when it frees. Cheaper and more honest than dividing total work by worker
  // count, which understates whenever one account outlasts everything else —
  // the exact case here, since a single 20-minute account sets the floor.
  const free = new Array(workers).fill(0);
  for (const a of order) {
    let earliest = 0;
    for (let i = 1; i < workers; i++) if (free[i] < free[earliest]) earliest = i;
    free[earliest] += cost[a.weight];
  }
  const estimateMs = order.length ? Math.max(...free) : 0;

  const heavy = order.filter(a => a.weight === 'heavy').length;
  const unknown = order.filter(a => a.weight === 'unknown').length;
  return {
    order, skipped, workers, estimateMs,
    basis: `${order.length} account(s) across ${workers} worker(s) — ${heavy} heavy ` +
           `(${Math.round(cost.heavy / 60000)}m each), ${unknown} unknown ` +
           `(${Math.round(cost.unknown / 60000)}m), ${order.length - heavy - unknown} light ` +
           `(${Math.round(cost.light / 1000)}s)` +
           (skipped.length ? `; ${skipped.length} already collected and skipped` : '') +
           '. Longest-first, pull queue — no worker can hold two heavy accounts while another idles.',
  };
}
