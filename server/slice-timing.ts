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
  /** One line naming the numbers that produced the verdict. */
  detail: string;
}

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 1000 : 0);

export function summariseSliceTiming(samples: readonly SliceSample[]): SliceTimingSummary {
  let totalMs = 0, fetchMs = 0, storeMs = 0, pages = 0, rows = 0;
  let slowest: SliceTimingSummary['slowest'] = null;

  for (const s of samples) {
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
           meanMs, slowest, share, dominant, detail };
}
