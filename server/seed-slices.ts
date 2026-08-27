/**
 * seed-slices.ts — how a billing period is cut into fetch windows.
 *
 * Production evidence, 2026-08-27 (job sj-1787826173214-dudq9f): page times
 * against Sippy grew from ~10s near offset 0 to ~2 minutes by offset 5,500,
 * and the method faulted around offset 9,000 — and the historical week-fetch
 * died with an in-band empty page at offset 4,000. Deep OFFSET pagination
 * degrades until it fails, and a single-window day is ~500 pages. One window
 * also meant one all-or-nothing commit: a fault at page 18 discarded
 * forty-five minutes of fetched evidence.
 *
 * The owner's remedy (approved 2026-08-27): fetch the period in SHORT TIME
 * SLICES. Each slice keeps offsets shallow, commits its rows to the repository
 * immediately on completion, and a failure loses one slice, not the day. The
 * repository insert is idempotent on the switch's own CDR id, so overlapping
 * or re-run slices can never double-store — which is also why the slice bounds
 * below may safely follow the existing inclusive end-second convention.
 *
 * Slice bounds carry an EXPLICIT Z. The unsliced seeder built offsetless
 * timestamps, which parse as host-local time — latent on the UTC production
 * host, wrong anywhere else (BILLING-POLICY §1.1). New code does not inherit
 * the defect.
 *
 * Dependency-free so the arithmetic is pinned by tests.
 */

export interface SeedSlice {
  /** ISO with explicit Z, inclusive start of the slice. */
  startIso: string;
  /**
   * ISO with explicit Z — EQUAL to the next slice's start (the shared boundary
   * second). Consecutive slices deliberately OVERLAP on that second: whichever
   * inclusivity the switch applies to end_date, no instant falls between two
   * slices, and the one-second overlap is absorbed by the idempotent i_cdr
   * insert and the accumulator's dedup. The rejected alternative — ending one
   * second early — created a GAP instead: a CDR timestamped inside the boundary
   * second (Sippy carries milliseconds) was fetched by neither slice, 48
   * silent chances per day, systematic across re-runs. Dedup can absorb an
   * overlap; nothing can repair a gap.
   */
  endIso: string;
  /** 1-based position, for progress reporting. */
  index: number;
  /** Human label, e.g. "2026-08-18 10:00–10:30Z". */
  label: string;
}

export const DEFAULT_SLICE_MINUTES = 30;

/**
 * Cut [periodStart, periodEnd] (inclusive DATES, per the seeder's contract)
 * into consecutive slices of `sliceMinutes`, covering
 * [periodStart 00:00:00Z, periodEnd+1 00:00:00Z) with NO GAP: each slice's end
 * equals the next slice's start, and the shared boundary second is fetched by
 * both — an overlap the idempotent repository insert absorbs.
 */
export function computeSeedSlices(
  periodStart: string,
  periodEnd: string | null | undefined,
  sliceMinutes: number = DEFAULT_SLICE_MINUTES,
): SeedSlice[] {
  const mins = Number.isFinite(sliceMinutes) && sliceMinutes >= 1
    ? Math.floor(sliceMinutes)
    : DEFAULT_SLICE_MINUTES;

  const startMs = Date.parse(`${periodStart}T00:00:00Z`);
  const endDate = periodEnd ?? periodStart;
  // Exclusive upper bound: the first instant AFTER the last billed day.
  const endMs = Date.parse(`${endDate}T00:00:00Z`) + 24 * 60 * 60 * 1000;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return [];

  const stepMs = mins * 60 * 1000;
  const slices: SeedSlice[] = [];
  let cursor = startMs;
  let index = 1;
  while (cursor < endMs) {
    const next = Math.min(cursor + stepMs, endMs);
    const startIso = new Date(cursor).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const endIso   = new Date(next).toISOString().replace(/\.\d{3}Z$/, 'Z');
    slices.push({
      startIso,
      endIso,
      index,
      label: `${startIso.slice(0, 10)} ${startIso.slice(11, 16)}–${endIso.slice(11, 16)}Z`,
    });
    cursor = next;
    index++;
  }
  return slices;
}
