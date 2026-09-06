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

/**
 * WHY the loop stopped — recorded, never inferred.
 *
 * "Rows are missing" and "the fetch stopped for reason R" are different facts,
 * and only the second one is actionable. Every exit is named, including the
 * ones that should be impossible, because an exit nobody can name is the exit
 * a bug leaves behind.
 */
export type SliceEnd =
  /** A successful page came back SHORT — the only legitimate end-of-data. */
  | 'SHORT_PAGE'
  /** A successful page came back with ZERO rows. Distinct from SHORT_PAGE on
   *  purpose: an empty first page is what a silent auth failure looks like
   *  when the transport reports success, and calling that "end of data" is the
   *  precise mistake cdr-fetch-page.ts exists to prevent. */
  | 'EMPTY_PAGE'
  /** The fetch failed. Says nothing whatever about the data. */
  | 'ERROR'
  /** The loop hit its own page ceiling — rows almost certainly remain. */
  | 'PAGE_LIMIT'
  /** Stopped from outside: shutdown, disarm, operator abort. */
  | 'MANUAL_CANCEL'
  /** Still running. */
  | 'INCOMPLETE'
  /** The loop exited and nothing recorded why. Always a defect in the
   *  instrument or the loop; never a normal outcome. */
  | 'UNKNOWN';

export interface PageRecord {
  /** 0-based offset this page was requested at. */
  offset: number;
  /** Rows the page returned. */
  rows:   number;
  ok:     boolean;
  ms?:    number;
  /** Username of the credential that made this request. The fetch loop tries
   *  up to four on an empty window; which one is answering, and whether the
   *  others ever add anything, is the question this field exists to settle. */
  cred?:  string;
}

/**
 * The decision the loop actually made, with the values it compared.
 *
 * A termination reason says WHICH branch was taken. This says WHY that branch
 * was reachable — and the two can be checked against each other, which is the
 * difference between believing the code and verifying it against production.
 * "SHORT_PAGE" is a claim; "137 < 500 → stop" is the evidence for it.
 */
export interface TerminationDecision {
  /** The values the loop compared, named as the code names them. */
  inputs:     Record<string, number | string | boolean>;
  /** The comparison in plain arithmetic, e.g. "137 < 500". */
  comparison: string;
}

export interface SliceTelemetry {
  label:  string;
  pages:  PageRecord[];
  end:    SliceEnd;
  /** What the loop compared to reach `end`. Optional so existing callers keep
   *  working, but its ABSENCE is itself reported — an unexplained stop is the
   *  thing this whole module exists to eliminate. */
  decision?: TerminationDecision;
  /**
   * Did the loop ASK for another page after the last one recorded?
   *
   * This separates two states that produce identical totals and need opposite
   * fixes: "we deliberately stopped asking" (attempted=false — a termination
   * decision, possibly a wrong one) and "we asked and could not continue"
   * (attempted=true, succeeded=false — a transport or switch problem). Without
   * it, a premature stop and a failed continuation look the same from the
   * outside, which is exactly where this investigation has been stuck.
   */
  nextPageAttempted?:  boolean;
  nextPageSucceeded?:  boolean;
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
  pageSize:    number;
  disposition: DispositionSummary;
  /** Slices whose last page was full — the loop stopped with more available. */
  suspiciousSlices: string[];
  endBreakdown: Record<SliceEnd, number>;
  /** Recorded reason vs recorded pages disagreeing. Non-empty ⇒ distrust all. */
  contradictions: Contradiction[];
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

export interface Contradiction {
  slice:  string;
  end:    SliceEnd;
  detail: string;
}

/**
 * THE INSTRUMENT CHECKING ITSELF.
 *
 * Some (termination reason, last page size) pairs cannot both be true. A slice
 * that says SHORT_PAGE while its last page was full is not reporting a fetch
 * problem — it is reporting that the recorded reason and the recorded pages
 * disagree, which means one of them is wrong and neither can be trusted.
 *
 * This matters more than it looks. Telemetry is about to be the only evidence
 * for a decision to change the fetch, and an instrument that cannot detect its
 * own inconsistency will happily supply a confident wrong answer. Better to
 * find out from the instrument than from the invoice.
 */
export function contradictions(slices: SliceTelemetry[], pageSize: number): Contradiction[] {
  const out: Contradiction[] = [];
  for (const s of slices) {
    const last = s.pages.length ? s.pages[s.pages.length - 1] : null;

    if (s.end === 'SHORT_PAGE' && last && last.ok && last.rows >= pageSize) {
      out.push({ slice: s.label, end: s.end,
        detail: `recorded SHORT_PAGE but the last page returned ${last.rows} of ${pageSize} — a full ` +
                'page is not short. The termination reason and the page log disagree; neither is trustworthy.' });
    }
    if (s.end === 'EMPTY_PAGE' && last && last.rows > 0) {
      out.push({ slice: s.label, end: s.end,
        detail: `recorded EMPTY_PAGE but the last page returned ${last.rows} rows.` });
    }
    if (s.end === 'SHORT_PAGE' && last && !last.ok) {
      out.push({ slice: s.label, end: s.end,
        detail: 'recorded SHORT_PAGE but the last page FAILED. An error is never end-of-data.' });
    }
    if (s.end === 'ERROR' && last && last.ok) {
      out.push({ slice: s.label, end: s.end,
        detail: 'recorded ERROR but the last page succeeded.' });
    }
    if (s.end === 'UNKNOWN') {
      out.push({ slice: s.label, end: s.end,
        detail: 'the loop exited without recording why. Always a defect — a normal exit has a name.' });
    }
    if (s.pages.length === 0 && s.received > 0) {
      out.push({ slice: s.label, end: s.end,
        detail: `${s.received} rows received but no pages recorded.` });
    }

    // ── The decision, checked against the reason ───────────────────────────
    //
    // A stop with no recorded decision is not a contradiction in the strict
    // sense — but it is an unexplained stop, and this module exists so that no
    // stop is unexplained. Terminal reasons only: INCOMPLETE has not decided
    // anything yet, and MANUAL_CANCEL is decided from outside the loop.
    const TERMINAL: SliceEnd[] = ['SHORT_PAGE', 'EMPTY_PAGE', 'ERROR', 'PAGE_LIMIT'];
    if (TERMINAL.includes(s.end) && !s.decision) {
      out.push({ slice: s.label, end: s.end,
        detail: `stopped with reason ${s.end} but recorded no decision inputs — the reason cannot ` +
                'be verified against what the loop actually compared.' });
    }

    // ── Asked, or stopped asking? ─────────────────────────────────────────
    if (s.end === 'ERROR' && s.nextPageAttempted === false) {
      out.push({ slice: s.label, end: s.end,
        detail: 'recorded ERROR but no next page was attempted — an error arrives from a request, ' +
                'so one must have been made.' });
    }
    if (s.end === 'SHORT_PAGE' && s.nextPageAttempted === true && s.nextPageSucceeded === true) {
      // The single most valuable disproof available: the loop declared
      // end-of-data and a further page then RETURNED. End-of-data was wrong.
      out.push({ slice: s.label, end: s.end,
        detail: 'recorded SHORT_PAGE as end-of-data, but a further page was attempted AND SUCCEEDED. ' +
                'The switch had more rows. This is direct disproof of the termination rule, not a hint.' });
    }
    if (s.nextPageSucceeded === true && s.nextPageAttempted === false) {
      out.push({ slice: s.label, end: s.end,
        detail: 'a next page is recorded as succeeding while none was attempted.' });
    }
  }
  return out;
}

export function summariseFetch(opts: {
  slices:   SliceTelemetry[];
  pageSize: number;
}): FetchTelemetrySummary {
  const { slices, pageSize } = opts;
  const disposition = summariseDisposition(slices);
  const suspicious  = suspiciousSlices(slices, pageSize);
  const contras     = contradictions(slices, pageSize);

  const endBreakdown: Record<SliceEnd, number> = {
    SHORT_PAGE: 0, EMPTY_PAGE: 0, ERROR: 0, PAGE_LIMIT: 0,
    MANUAL_CANCEL: 0, INCOMPLETE: 0, UNKNOWN: 0,
  };
  for (const s of slices) endBreakdown[s.end]++;

  const parts: string[] = [];
  // Order is deliberate: anything that invalidates the numbers comes before
  // anything derived FROM the numbers.
  if (!disposition.balances) {
    parts.push(
      `COUNTERS DO NOT BALANCE: ${disposition.unaccounted} row(s) received but in no bucket. ` +
      'Fix the accounting before drawing any conclusion from the figures below.');
  }
  if (contras.length) {
    parts.push(
      `INSTRUMENT CONTRADICTS ITSELF in ${contras.length} slice(s) — ${contras[0].slice}: ` +
      `${contras[0].detail} Telemetry is the only evidence for changing the fetch, so a ` +
      'self-inconsistent instrument must be fixed before it is believed.');
  }
  if (endBreakdown.EMPTY_PAGE > 0) {
    parts.push(
      `${endBreakdown.EMPTY_PAGE} slice(s) ended on an EMPTY page. A successful call returning zero ` +
      'rows is what a silent auth failure looks like — confirm the window truly had no traffic ' +
      'before accepting it as end-of-data.');
  }
  if (endBreakdown.MANUAL_CANCEL > 0) {
    parts.push(`${endBreakdown.MANUAL_CANCEL} slice(s) were cancelled — the period is incomplete by construction.`);
  }
  // Deliberately stopped vs tried-and-failed. Identical totals, opposite fixes:
  // one is a termination rule to correct, the other is a transport to repair.
  const stoppedAsking = slices.filter(s => s.nextPageAttempted === false).length;
  const failedToGo    = slices.filter(s => s.nextPageAttempted === true && s.nextPageSucceeded === false).length;
  if (failedToGo > 0) {
    parts.push(
      `${failedToGo} slice(s) TRIED to fetch another page and could not — that is a transport or ` +
      'switch failure, not a decision to stop, and the rows behind it were never refused, only unreached.');
  }
  if (stoppedAsking > 0 && suspicious.length > 0) {
    parts.push(
      `${stoppedAsking} slice(s) stopped asking of their own accord; ${suspicious.length} of the ` +
      'recorded stops sit on a full page. Where those overlap, the termination RULE is the suspect.');
  }
  if (suspicious.length) {
    parts.push(
      `${suspicious.length} slice(s) stopped on a FULL page — the switch still had rows when the ` +
      `loop exited: ${suspicious.slice(0, 5).join(', ')}${suspicious.length > 5 ? ', …' : ''}. ` +
      'Pagination is losing data, not the store.');
  }
  if (endBreakdown.PAGE_LIMIT > 0) {
    parts.push(`${endBreakdown.PAGE_LIMIT} slice(s) hit the page ceiling — rows remain unfetched.`);
  }
  if (endBreakdown.ERROR > 0) {
    parts.push(`${endBreakdown.ERROR} slice(s) ended on a FETCH ERROR — incomplete, not empty.`);
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
    pageSize,
    disposition,
    suspiciousSlices: suspicious,
    endBreakdown,
    contradictions: contras,
    verdict: parts.join(' '),
  };
}
