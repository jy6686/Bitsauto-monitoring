/**
 * fetch-telemetry.ts — where did the rows go?
 *
 * MEASURED 2026-09-01, and the reason this file is scoped the way it is.
 * Five days collected unattended, every day sealed, zero errors — and the week
 * reconciled at 48.5% of Sippy's own figure. The first instinct was to suspect
 * the store: a bad row failing a 500-row chunk, a filter dropping rows, dedup
 * rejecting valid data. Production refuted all three at once:
 *
 *   recon-2026-08-31-315   fetched 1,127   stored 1,127   gap 0
 *   recon-2026-08-31-588   fetched 1,288   stored 1,288   gap 0
 *   50 jobs                lastError: none
 *
 * On a first collection, fetched === stored exactly. Nothing is lost after the
 * fetch. Sippy nevertheless billed $50.6793 for the account that returned
 * 1,127 rows. So the fetch is asking correctly and being given too little, and
 * every counter that matters is INSIDE the page loop — which, until now,
 * recorded nothing at all.
 *
 * WHAT THIS SEPARATES, and why each division earns its place:
 *
 *  · pages visited, and the row count of EACH — a loop that stops at page 3
 *    of 9 and one that genuinely reaches the end both report "done".
 *  · the TERMINATING outcome — `end_of_data` means a successful page came
 *    back short. That is only end-of-data if Sippy never returns a short page
 *    mid-stream, which is an assumption nobody has tested.
 *  · received → kept → inserted → duplicate → invalid, kept apart. A slice
 *    reporting 1000 received / 500 inserted / 480 duplicate / 20 invalid and
 *    one reporting 1000 / 500 / 0 / 500 produce the IDENTICAL repository
 *    count and demand opposite fixes. Collapsing them is how a validation bug
 *    hides behind a dedup story for a month.
 *
 * Dependency-free: pure arithmetic over recorded facts, so the accounting
 * identity is pinned by tests rather than by a database.
 */

export type SliceEnd =
  /** A successful page came back shorter than the page size. */
  | 'end_of_data'
  /** The loop stopped because a fetch failed. Says nothing about the data. */
  | 'error'
  /** The loop hit its own page ceiling — rows almost certainly remain. */
  | 'page_limit'
  /** Still running. */
  | 'incomplete';

export interface PageRecord {
  /** 0-based offset this page was requested at. */
  offset: number;
  /** Rows the page returned. */
  rows:   number;
  ok:     boolean;
  ms?:    number;
}

export interface SliceTelemetry {
  label:  string;
  pages:  PageRecord[];
  end:    SliceEnd;
  /** Σ rows across pages — what the switch handed over. */
  received: number;
  /** Survived the client-name filter. received − kept = filtered out. */
  kept:     number;
  /** Rows Postgres actually wrote. */
  inserted: number;
  /** Rejected by the unique index — already present. Not a loss. */
  duplicate: number;
  /** Rejected before the write, or lost to a failed chunk. A real loss. */
  invalid:   number;
  ms?: number;
}

export interface DispositionSummary {
  received:  number;
  filtered:  number;
  inserted:  number;
  duplicate: number;
  invalid:   number;
  /** received − (filtered + inserted + duplicate + invalid). MUST be 0. */
  unaccounted: number;
  /** False ⇒ the counters themselves are wrong and nothing below is evidence. */
  balances: boolean;
}

export interface FetchTelemetrySummary {
  slices:      number;
  pages:       number;
  disposition: DispositionSummary;
  /** Slices whose last page was full — the loop stopped with more available. */
  suspiciousSlices: string[];
  endBreakdown: Record<SliceEnd, number>;
  /** Plain language, and it names the suspect rather than the symptom. */
  verdict: string;
}

const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);

/**
 * THE ACCOUNTING IDENTITY. Every received row must land in exactly one bucket.
 *
 * This is checked rather than assumed because the whole value of the split is
 * that it is exhaustive: a residual means a row went somewhere no counter
 * knows about, and a disposition report with an unexplained remainder is a
 * story, not evidence. `balances:false` invalidates the numbers around it.
 */
export function summariseDisposition(slices: SliceTelemetry[]): DispositionSummary {
  const received  = sum(slices.map(s => s.received));
  const filtered  = sum(slices.map(s => Math.max(0, s.received - s.kept)));
  const inserted  = sum(slices.map(s => s.inserted));
  const duplicate = sum(slices.map(s => s.duplicate));
  const invalid   = sum(slices.map(s => s.invalid));
  const unaccounted = received - (filtered + inserted + duplicate + invalid);
  return { received, filtered, inserted, duplicate, invalid, unaccounted,
           balances: unaccounted === 0 };
}

/**
 * A slice whose LAST page was full stopped while the switch still had rows.
 *
 * With `classifyCdrPage`, a loop only exits on a short page, an error, or the
 * ceiling — so a full final page means the exit was NOT end-of-data, whatever
 * the slice recorded. That is the single most diagnostic fact available about
 * a truncating fetch, and it is invisible in any total.
 */
export function suspiciousSlices(slices: SliceTelemetry[], pageSize: number): string[] {
  return slices.filter(s => {
    if (s.pages.length === 0) return false;
    const last = s.pages[s.pages.length - 1];
    if (!last.ok) return false;              // an error is already reported as one
    return last.rows >= pageSize;            // full last page ⇒ more was available
  }).map(s => s.label);
}

export function summariseFetch(opts: {
  slices:   SliceTelemetry[];
  pageSize: number;
}): FetchTelemetrySummary {
  const { slices, pageSize } = opts;
  const disposition = summariseDisposition(slices);
  const suspicious  = suspiciousSlices(slices, pageSize);

  const endBreakdown: Record<SliceEnd, number> =
    { end_of_data: 0, error: 0, page_limit: 0, incomplete: 0 };
  for (const s of slices) endBreakdown[s.end]++;

  const parts: string[] = [];
  if (!disposition.balances) {
    parts.push(
      `COUNTERS DO NOT BALANCE: ${disposition.unaccounted} row(s) received but in no bucket. ` +
      'Fix the accounting before drawing any conclusion from the figures below.');
  }
  if (suspicious.length) {
    parts.push(
      `${suspicious.length} slice(s) stopped on a FULL page — the switch still had rows when the ` +
      `loop exited: ${suspicious.slice(0, 5).join(', ')}${suspicious.length > 5 ? ', …' : ''}. ` +
      'Pagination is losing data, not the store.');
  }
  if (endBreakdown.page_limit > 0) {
    parts.push(`${endBreakdown.page_limit} slice(s) hit the page ceiling — rows remain unfetched.`);
  }
  if (endBreakdown.error > 0) {
    parts.push(`${endBreakdown.error} slice(s) ended on a FETCH ERROR — incomplete, not empty.`);
  }
  if (disposition.invalid > 0) {
    parts.push(
      `${disposition.invalid} row(s) were received and never stored, and were NOT duplicates — ` +
      'this is a real loss between the switch and the repository.');
  }
  if (parts.length === 0) {
    parts.push(
      `Every slice ended on a short page with no errors, and all ${disposition.received} received ` +
      `row(s) are accounted for (${disposition.inserted} inserted, ${disposition.duplicate} already ` +
      `present, ${disposition.filtered} filtered). If the total is still below the reference, the ` +
      'switch returned less than it billed — the gap is in the REQUEST, not the loop.');
  }

  return {
    slices: slices.length,
    pages:  sum(slices.map(s => s.pages.length)),
    disposition,
    suspiciousSlices: suspicious,
    endBreakdown,
    verdict: parts.join(' '),
  };
}
