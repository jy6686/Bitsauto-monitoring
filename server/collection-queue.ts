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

// ── Learned weights ──────────────────────────────────────────────────────────
/**
 * Per-account cost from OBSERVED history, not from a class constant.
 *
 * Owner requirement 2026-09-02: do not lock the planner around today's
 * 20-minute figure, because that is a symptom of the current fetch, not a
 * property of the account. When streaming and the fetch fix land, a heavy
 * account may cost eight minutes — and a planner carrying a hardcoded twenty
 * would keep sizing the pool for a defect that no longer exists.
 *
 * MEDIAN, NOT MEAN, and the reason is in the measurements. During the
 * degradation windows on 2026-08-31 and 09-01, accounts that normally take
 * ~60s took 260s and 403s. Those are episodes of an unhealthy instance, not
 * the cost of the work: a mean drags every estimate toward the worst night the
 * platform has had, a median ignores it unless it becomes the norm. The same
 * argument that kept a wrong ETA off the panel applies to a wrong estimate
 * inside the planner.
 */
export interface AccountHistory {
  iAccount: number;
  name?:    string | null;
  /** Completed runs, any order. Durations in ms. */
  runs: Array<{ durationMs: number; fetched: number }>;
  priority?: number;
}

const median = (ns: number[]): number => {
  if (ns.length === 0) return 0;
  const s = [...ns].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

/**
 * @param heavyIfFetchedOver rows above which an account counts as heavy. Not a
 *        duration threshold on purpose: duration is what we are trying to
 *        predict, and classifying by it would make the estimate circular.
 */
export function learnAccountCost(h: AccountHistory, opts?: {
  heavyIfFetchedOver?: number;
}): QueueAccount & { costMs: number | null; basis: string } {
  const threshold = opts?.heavyIfFetchedOver ?? 100;
  const done = h.runs.filter(r => Number.isFinite(r.durationMs) && r.durationMs > 0);

  if (done.length === 0) {
    return { iAccount: h.iAccount, name: h.name ?? null, weight: 'unknown',
             priority: h.priority, costMs: null,
             basis: 'no completed run on record — ordered between heavy and light' };
  }

  // Heavy is about VOLUME, which is a property of the customer. Duration is a
  // property of the customer AND the platform's current health, so it predicts
  // and must not classify.
  const everBusy = done.some(r => r.fetched > threshold);
  const cost = median(done.map(r => r.durationMs));

  return {
    iAccount: h.iAccount, name: h.name ?? null,
    weight: everBusy ? 'heavy' : 'light',
    priority: h.priority,
    costMs: cost,
    basis: `median of ${done.length} run(s): ${Math.round(cost / 1000)}s` +
           (done.length > 2 ? ` (range ${Math.round(Math.min(...done.map(r => r.durationMs)) / 1000)}–` +
                              `${Math.round(Math.max(...done.map(r => r.durationMs)) / 1000)}s)` : '') +
           `; ${everBusy ? 'has returned CDRs' : 'has never returned CDRs'}`,
  };
}

export interface LearnedPlan extends QueuePlan {
  /** Live capacity view for the operations panel. */
  capacity: {
    workersConfigured: number;
    remaining: number;
    remainingHeavy: number;
    remainingLight: number;
    remainingUnknown: number;
    /** null when no start time was supplied. */
    finishEstimateIso: string | null;
  };
}

/**
 * The planner, using each account's own measured cost where one exists and the
 * class default only where it does not.
 */
export function planFromHistory(opts: {
  history:     AccountHistory[];
  maxWorkers?: number;
  completed?:  number[];
  /** For the projected finish time. */
  nowIso?:     string;
  costMs?:     Partial<Record<Weight, number>>;
}): LearnedPlan {
  const learned = opts.history.map(h => learnAccountCost(h));
  const perAccount = new Map(learned.map(l => [l.iAccount, l.costMs]));
  const classCost = { ...DEFAULT_COST_MS, ...(opts.costMs ?? {}) };

  const base = planCollectionQueue({
    accounts: learned.map(({ costMs, basis, ...a }) => a),
    maxWorkers: opts.maxWorkers, completed: opts.completed, costMs: opts.costMs,
  });

  // Re-simulate the pull queue with per-account costs. planCollectionQueue's
  // own estimate uses class costs, which is right when nothing is known and
  // needlessly coarse once something is.
  const free = new Array(base.workers).fill(0);
  for (const a of base.order) {
    let earliest = 0;
    for (let i = 1; i < base.workers; i++) if (free[i] < free[earliest]) earliest = i;
    free[earliest] += perAccount.get(a.iAccount) ?? classCost[a.weight];
  }
  const estimateMs = base.order.length ? Math.max(...free) : 0;

  const measured = base.order.filter(a => perAccount.get(a.iAccount) != null).length;
  const startMs = opts.nowIso ? Date.parse(opts.nowIso) : NaN;

  return {
    ...base,
    estimateMs,
    basis: `${base.order.length} account(s) across ${base.workers} worker(s); ` +
           `${measured} costed from their own history, ${base.order.length - measured} from class ` +
           'defaults. Longest-first, pull queue.' +
           (base.skipped.length ? ` ${base.skipped.length} already collected.` : ''),
    capacity: {
      workersConfigured: base.workers,
      remaining:        base.order.length,
      remainingHeavy:   base.order.filter(a => a.weight === 'heavy').length,
      remainingLight:   base.order.filter(a => a.weight === 'light').length,
      remainingUnknown: base.order.filter(a => a.weight === 'unknown').length,
      finishEstimateIso: Number.isFinite(startMs)
        ? new Date(startMs + estimateMs).toISOString() : null,
    },
  };
}
