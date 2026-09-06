/**
 * slice-timing.ts — where a slice's wall clock actually goes.
 *
 * WHY THIS EXISTS. The collector already timed each slice (`ms`) and each
 * XML-RPC page (`PageRecord.ms`), but both lived in memory and were only
 * summarised by `summariseFetch` AFTER all 48 slices completed. A job that
 * died at slice 3 therefore produced nothing at all — and dying part-way is
 * the failure mode under investigation, so the telemetry was absent from
 * precisely the runs that needed it.
 *
 * Worse, its absence was filled by a number that looked like a measurement.
 * recon-2026-09-03-685 showed "2.0h elapsed, 2/48 slices" and was read — by
 * me — as sixty minutes per slice. That figure was the reaper's sweep
 * interval, not work. The fix for the reaper is separate; this exists so the
 * real answer is recorded as the run goes, not reconstructed afterwards from
 * whatever survived.
 *
 * ── The split ──────────────────────────────────────────────────────────────
 *   fetchMs  summed from the page records — time inside XML-RPC
 *   storeMs  measured around the repository write
 *   otherMs  the remainder: filtering, dedup bookkeeping, everything else
 *
 * Three numbers answer the question one number cannot: a slow slice is either
 * the switch, our database, or our own code, and those are three different
 * investigations. `otherMs` is deliberately a REMAINDER rather than a fourth
 * measurement — it cannot silently omit an unmeasured phase, because anything
 * not attributed lands in it by construction.
 *
 * Pure: no clock, no DB. The caller measures; this accumulates and judges.
 */

export interface SliceSample {
  /** The slice's window label, e.g. "2026-09-03 01:00–01:30Z". */
  label: string;
  /** Whole-slice wall clock. */
  totalMs: number;
  /** Summed page durations — time spent inside the XML-RPC calls. */
  fetchMs: number;
  /** Measured around the repository write. */
  storeMs: number;
  pages: number;
  rows: number;
  /** Per-credential outcome for this slice, keyed by username. */
  creds?: Record<string, CredTally>;
}

/**
 * What one credential did across the pages it was asked for.
 *
 * The fetch loop tries up to four credentials before accepting an empty
 * window, as a guard against a credential that silently returns nothing
 * instead of an auth fault. That guard costs 4x on every empty slice, and
 * nobody has measured whether credentials 2-4 have EVER returned a row that
 * credential 1 did not. This tally is that measurement.
 */
export interface CredTally {
  pages: number;
  rows: number;
  /** Pages that returned ok with zero rows. */
  empty: number;
  /** Pages that returned not-ok. */
  failed: number;
  /** Total wall clock across this credential's pages. */
  ms: number;
  /** The single slowest page. Route-Inspector's was 237 seconds, for nothing. */
  maxMs: number;
}

/**
 * Mean page duration per credential, derived at read time so it is never a
 * stored figure that can drift from the counts it came from. Answers whether
 * credentials 2-4 are slow because of fallback, or whether every empty
 * XML-RPC request is inherently expensive — which decides whether the 4x
 * loop is the cost or the switch's empty query is.
 */
export function meanPageMs(c: CredTally): number | null {
  return c.pages > 0 ? Math.round(c.ms / c.pages) : null;
}

export interface SliceTimingSummary {
  slices: number;
  totalMs: number;
  fetchMs: number;
  storeMs: number;
  /** Remainder. Never measured directly, so nothing can escape it. */
  otherMs: number;
  pages: number;
  rows: number;
  /** Mean wall clock per completed slice. null before the first. */
  meanMs: number | null;
  /** The worst slice so far, which is the one worth looking at. */
  slowest: { label: string; totalMs: number; fetchMs: number; storeMs: number } | null;
  /** Share of measured time in each phase, 0–1. null when nothing is measured. */
  share: { fetch: number; store: number; other: number } | null;
  /** Which phase dominates, or null when there is nothing to dominate. */
  dominant: 'fetch' | 'store' | 'other' | null;
  /**
   * Per-credential totals across every slice so far. Read alongside
   * `share`: a credential whose `rows` is 0 across the whole job has only
   * ever confirmed emptiness, and the question is whether that confirmation
   * is worth its pages.
   */
  byCredential: Record<string, CredTally>;
  /** One line naming the numbers that produced the verdict. */
  detail: string;
}

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 1000 : 0);

export function summariseSliceTiming(samples: readonly SliceSample[]): SliceTimingSummary {
  let totalMs = 0, fetchMs = 0, storeMs = 0, pages = 0, rows = 0;
  let slowest: SliceTimingSummary['slowest'] = null;
  const byCredential: Record<string, CredTally> = {};

  for (const s of samples) {
    for (const [user, c] of Object.entries(s.creds ?? {})) {
      const acc = byCredential[user] ??
        (byCredential[user] = { pages: 0, rows: 0, empty: 0, failed: 0, ms: 0, maxMs: 0 });
      acc.pages += c.pages; acc.rows += c.rows; acc.empty += c.empty; acc.failed += c.failed;
      acc.ms += c.ms ?? 0; acc.maxMs = Math.max(acc.maxMs, c.maxMs ?? 0);
    }
    totalMs += Math.max(0, s.totalMs);
    fetchMs += Math.max(0, s.fetchMs);
    storeMs += Math.max(0, s.storeMs);
    pages   += Math.max(0, s.pages);
    rows    += Math.max(0, s.rows);
    if (!slowest || s.totalMs > slowest.totalMs) {
      slowest = { label: s.label, totalMs: s.totalMs, fetchMs: s.fetchMs, storeMs: s.storeMs };
    }
  }

  // Clamped at zero: a page timed across a boundary can exceed the slice's own
  // clock by a millisecond, and a negative remainder would read as a phase
  // that gave time back.
  const otherMs = Math.max(0, totalMs - fetchMs - storeMs);
  const meanMs  = samples.length ? Math.round(totalMs / samples.length) : null;

  const share = totalMs > 0
    ? { fetch: pct(fetchMs, totalMs), store: pct(storeMs, totalMs), other: pct(otherMs, totalMs) }
    : null;

  const dominant = !share ? null
    : (fetchMs >= storeMs && fetchMs >= otherMs) ? 'fetch'
    : (storeMs >= otherMs) ? 'store'
    : 'other';

  const secs = (ms: number) => ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;

  const detail = samples.length === 0
    ? 'No slice has completed yet.'
    : `${samples.length} slice(s) in ${secs(totalMs)} (mean ${secs(meanMs!)}) — ` +
      `${secs(fetchMs)} fetching, ${secs(storeMs)} writing, ${secs(otherMs)} elsewhere` +
      (share ? ` (${Math.round(share.fetch * 100)}/${Math.round(share.store * 100)}/` +
               `${Math.round(share.other * 100)}%)` : '') +
      `. Slowest ${slowest!.label} at ${secs(slowest!.totalMs)}. ` +
      `${pages} page(s), ${rows} row(s).`;

  return { slices: samples.length, totalMs, fetchMs, storeMs, otherMs, pages, rows,
           meanMs, slowest, share, dominant, byCredential, detail };
}
