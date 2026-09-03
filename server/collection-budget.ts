/**
 * collection-budget.ts — when should a collection job give up and say why?
 *
 * WHAT THIS IS FOR. On 2026-09-03 the job for one account ran for 1 hour 30
 * minutes, reached slice 33 of 48, fetched nothing, and was still going when
 * the process died. Three accounts collected the same night finished 48 slices
 * in about a minute each. Nothing in the platform noticed a run taking ninety
 * times its normal duration, because there was no wall-clock budget of any
 * kind — the loop would have kept retrying until something outside it stopped
 * the process.
 *
 * The arithmetic is not mysterious. A slice that fails twice and succeeds on
 * the third attempt sleeps 30s then 60s: ninety seconds of backoff for one
 * slice. Thirty-three of those is an hour and a half of a job whose successful
 * peers take sixty seconds. The backoff is correct in itself — a transient
 * switch fault deserves a retry — but a per-slice policy with no total budget
 * has no idea what it is costing in aggregate.
 *
 * So this module answers one question per slice boundary: given what has been
 * spent and what remains, is finishing still plausible? It distinguishes three
 * outcomes, because they call for different reactions:
 *
 *   continue   on pace, or slow but within budget
 *   abort      cannot finish in the time available — stop and report
 *   warn       will finish, but far outside normal; worth surfacing now
 *
 * ── Why abort at all ─────────────────────────────────────────────────────
 * Being killed by a process restart and stopping deliberately produce the same
 * partial data, but they leave completely different evidence. The restart left
 * "Run died mid-day (process restarted or recycled)" — which named the symptom
 * and nothing else. A deliberate abort can say: 33 of 48 slices, 47 minutes of
 * that spent in retry backoff across 31 failed attempts, projected finish
 * 02:14 — well past the collection window. That is a diagnosis rather than an
 * obituary.
 *
 * Pure: no clock, no DB. The caller passes elapsed time.
 */

export interface BudgetInput {
  /** Slices finished so far. */
  slicesDone: number;
  slicesTotal: number;
  /** Wall-clock milliseconds since the job started. */
  elapsedMs: number;
  /** Milliseconds spent asleep in retry backoff. Time bought, not worked. */
  backoffMs?: number;
  /** Slice attempts that failed and were retried. */
  retries?: number;
  /**
   * Hard ceiling for the whole job. Default four hours — the width of the
   * off-peak collection window, because a job that cannot finish inside the
   * window has already failed at its purpose even if it would eventually
   * return rows.
   */
  budgetMs?: number;
  /**
   * What a slice normally costs. Used only to describe how far outside normal
   * a run is; it never on its own aborts anything, because "slower than usual"
   * and "cannot finish" are different claims.
   */
  normalSliceMs?: number;
}

export type BudgetVerdict = 'continue' | 'warn' | 'abort';

export interface BudgetDecision {
  verdict: BudgetVerdict;
  /** Mean wall-clock per completed slice, ms. null before the first slice. */
  msPerSlice: number | null;
  /** Projected total run time at the observed pace, ms. */
  projectedTotalMs: number | null;
  /** Projected overshoot past the budget, ms. 0 when within it. */
  projectedOverrunMs: number;
  /** Share of elapsed time spent asleep in backoff, 0–1. */
  backoffShare: number;
  /** How many times slower than normal, when a normal is supplied. */
  slowdownFactor: number | null;
  /** One line naming the numbers that produced the verdict. */
  reason: string;
}

export const DEFAULT_BUDGET_MS = 4 * 60 * 60 * 1000;   // the collection window
/** Above this share of elapsed time spent sleeping, the run is mostly waiting. */
export const BACKOFF_SHARE_WARN = 0.5;

export function assessBudget(input: BudgetInput): BudgetDecision {
  const budgetMs  = input.budgetMs ?? DEFAULT_BUDGET_MS;
  const backoffMs = input.backoffMs ?? 0;
  const retries   = input.retries ?? 0;
  const done      = Math.max(0, input.slicesDone);
  const total     = Math.max(1, input.slicesTotal);

  const msPerSlice = done > 0 ? input.elapsedMs / done : null;
  const projectedTotalMs = msPerSlice != null ? Math.round(msPerSlice * total) : null;
  const projectedOverrunMs = projectedTotalMs != null
    ? Math.max(0, projectedTotalMs - budgetMs) : 0;
  const backoffShare = input.elapsedMs > 0
    ? Math.min(1, backoffMs / input.elapsedMs) : 0;
  const slowdownFactor = (input.normalSliceMs && input.normalSliceMs > 0 && msPerSlice != null)
    ? msPerSlice / input.normalSliceMs : null;

  const remaining = Math.max(0, total - done);
  const pct = `${done}/${total}`;

  // Already over budget. Nothing projected about it — it has happened.
  if (input.elapsedMs >= budgetMs) {
    return {
      verdict: 'abort', msPerSlice, projectedTotalMs, projectedOverrunMs, backoffShare, slowdownFactor,
      reason: `Budget exhausted: ${fmt(input.elapsedMs)} elapsed against a ${fmt(budgetMs)} limit, ` +
              `${pct} slices done` + retryClause(retries, backoffMs) + '.',
    };
  }

  // Will not finish. Projection is only trustworthy once a few slices have
  // reported — one slow slice at the start is not a pace.
  if (done >= 3 && projectedTotalMs != null && projectedTotalMs > budgetMs) {
    return {
      verdict: 'abort', msPerSlice, projectedTotalMs, projectedOverrunMs, backoffShare, slowdownFactor,
      reason: `Cannot finish in budget: ${pct} slices in ${fmt(input.elapsedMs)} ` +
              `(${fmt(msPerSlice!)}/slice) projects ${fmt(projectedTotalMs)} for all ${total}, ` +
              `${fmt(projectedOverrunMs)} past the ${fmt(budgetMs)} limit` +
              retryClause(retries, backoffMs) + '.',
    };
  }

  // Will finish, but is mostly asleep. Worth surfacing while it is happening
  // rather than after — this is what the failed run looked like for 90 minutes
  // with nothing reporting it.
  if (done >= 3 && backoffShare >= BACKOFF_SHARE_WARN) {
    return {
      verdict: 'warn', msPerSlice, projectedTotalMs, projectedOverrunMs, backoffShare, slowdownFactor,
      reason: `Mostly retrying: ${Math.round(backoffShare * 100)}% of ${fmt(input.elapsedMs)} ` +
              `spent in retry backoff across ${retries} failed attempt(s), ${pct} slices done. ` +
              'The switch is answering slowly or intermittently.',
    };
  }

  if (done >= 3 && slowdownFactor != null && slowdownFactor >= 10) {
    return {
      verdict: 'warn', msPerSlice, projectedTotalMs, projectedOverrunMs, backoffShare, slowdownFactor,
      reason: `${Math.round(slowdownFactor)}x slower than normal: ${fmt(msPerSlice!)}/slice ` +
              `against a usual ${fmt(input.normalSliceMs!)}, ${pct} slices done` +
              retryClause(retries, backoffMs) + '.',
    };
  }

  return {
    verdict: 'continue', msPerSlice, projectedTotalMs, projectedOverrunMs, backoffShare, slowdownFactor,
    reason: msPerSlice == null
      ? `Starting — 0/${total} slices.`
      : `On pace: ${pct} slices in ${fmt(input.elapsedMs)}, ${remaining} remaining, ` +
        `projected ${fmt(projectedTotalMs!)} total.`,
  };
}

function retryClause(retries: number, backoffMs: number): string {
  if (retries <= 0 && backoffMs <= 0) return '';
  return `, ${fmt(backoffMs)} of it asleep in retry backoff across ${retries} failed attempt(s)`;
}

export function fmt(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 90_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 5_400_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

/**
 * A one-line account of where a job's wall clock went, for the panel.
 *
 * The failed run displayed "33/48 · 0 stored · 1h 30m" and an operator had no
 * way to tell ninety minutes of work from ninety minutes of sleep. Those need
 * opposite responses — one is a big account, the other is a sick switch.
 */
export function describeSpend(input: {
  elapsedMs: number; backoffMs?: number; retries?: number;
  slicesDone: number; slicesTotal: number;
}): string {
  const backoffMs = input.backoffMs ?? 0;
  const retries   = input.retries ?? 0;
  const workedMs  = Math.max(0, input.elapsedMs - backoffMs);
  if (retries === 0 && backoffMs === 0) {
    return `${input.slicesDone}/${input.slicesTotal} slices in ${fmt(input.elapsedMs)}, no retries.`;
  }
  return `${input.slicesDone}/${input.slicesTotal} slices in ${fmt(input.elapsedMs)} — ` +
         `${fmt(workedMs)} fetching, ${fmt(backoffMs)} asleep in backoff after ` +
         `${retries} failed attempt(s).`;
}
