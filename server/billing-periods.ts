/**
 * billing-periods.ts
 *
 * Which period a customer's invoice covers, from their billing term.
 *
 * ONE rule outranks the cadence, set by the owner:
 *
 *     No customer invoice may span two accounting months.
 *
 * A Monday–Sunday week that straddles month-end is therefore split, and the
 * August fragment is invoiced as its own short period so August closes in
 * August. That is the whole point: a general ledger where every invoice
 * belongs entirely to one accounting month, so month-end close, VAT and
 * account reconciliation never have to apportion a document across two.
 *
 * Everything is UTC. The scheduler this replaces used local-time getters
 * (getDay/getMonth/setDate), so on a server outside UTC the boundaries drifted
 * by a day — a silent revenue-cutoff error on a document that states its own
 * period. The owner specified GMT 00; this module has no other timezone.
 *
 * Dependency-free so the rule is pinned by tests and cannot drift between the
 * scheduler, the trace and whatever reads periods next.
 */

export type BillingTerm = 'weekly' | 'bi_monthly' | 'monthly';

export interface BillingPeriod {
  /** YYYY-MM-DD, inclusive. */
  start: string;
  /** YYYY-MM-DD, inclusive. */
  end: string;
  /** YYYY-MM — the single accounting month this period belongs to. */
  accountingMonth: string;
  /** True when a month boundary cut the term's natural period short. */
  partial: boolean;
}

// ── UTC date helpers ─────────────────────────────────────────────────────────
const at   = (isoDate: string) => new Date(`${isoDate}T00:00:00Z`);
const fmt  = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (isoDate: string, n: number) => {
  const d = at(isoDate); d.setUTCDate(d.getUTCDate() + n); return fmt(d);
};
const endOfMonth = (isoDate: string) => {
  const d = at(isoDate);
  return fmt(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
};
const startOfMonth = (isoDate: string) => `${isoDate.slice(0, 7)}-01`;
const addMonths = (isoDate: string, n: number) => {
  const d = at(isoDate);
  return fmt(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)));
};
/** Monday of the week containing this date. Weeks run Monday–Sunday. */
const mondayOf = (isoDate: string) => {
  const dow = at(isoDate).getUTCDay();          // 0 = Sunday
  return addDays(isoDate, dow === 0 ? -6 : 1 - dow);
};

/**
 * Cut a span at every month boundary it crosses.
 *
 * A week of 31 Aug – 6 Sep becomes 31 Aug (one day, closing August) and
 * 1–6 Sep. The one-day invoice is intended, not a degenerate case: the
 * alternative is an invoice carrying revenue from two accounting months.
 */
export function splitAtMonthEnd(start: string, end: string): Array<{ start: string; end: string }> {
  if (end < start) return [];
  const out: Array<{ start: string; end: string }> = [];
  let cursor = start;
  while (cursor <= end) {
    const monthEnd = endOfMonth(cursor);
    const stop = monthEnd < end ? monthEnd : end;
    out.push({ start: cursor, end: stop });
    cursor = addDays(stop, 1);
  }
  return out;
}

/**
 * The term's natural spans overlapping [since, until], BEFORE month splitting.
 *
 *   weekly     Monday–Sunday
 *   bi_monthly 1st–15th and 16th–end of month (NOT a rolling fortnight, which
 *              is what the previous scheduler implemented under this name)
 *   monthly    1st–end of month
 */
function naturalSpans(term: BillingTerm, since: string, until: string): Array<{ start: string; end: string }> {
  const spans: Array<{ start: string; end: string }> = [];
  if (term === 'weekly') {
    let cursor = mondayOf(since);
    while (cursor <= until) {
      spans.push({ start: cursor, end: addDays(cursor, 6) });
      cursor = addDays(cursor, 7);
    }
    return spans;
  }
  let month = startOfMonth(since);
  while (month <= until) {
    const eom = endOfMonth(month);
    if (term === 'bi_monthly') {
      spans.push({ start: month, end: `${month.slice(0, 7)}-15` });
      spans.push({ start: `${month.slice(0, 7)}-16`, end: eom });
    } else {
      spans.push({ start: month, end: eom });
    }
    month = addMonths(month, 1);
  }
  return spans;
}

/**
 * Every period for this term that has fully CLOSED as of `asOf`, from `since`.
 *
 * Splitting happens before the closed test, deliberately: on 1 September the
 * August fragment of a straddling week is closed and billable even though the
 * natural week runs to the 6th. Waiting for the week would push August revenue
 * into a September invoice, which is the thing the rule forbids.
 *
 * Returning the whole window rather than only the newest period is what makes
 * a late-created schedule harmless — every missed period comes back and the
 * generator's duplicate guard skips the ones already invoiced.
 *
 * @param asOf  today (YYYY-MM-DD, UTC). A period is closed when it ends before this.
 */
export function closedPeriods(
  term: BillingTerm, asOf: string, since: string,
): BillingPeriod[] {
  const out: BillingPeriod[] = [];
  for (const span of naturalSpans(term, since, asOf)) {
    const pieces = splitAtMonthEnd(span.start, span.end);
    for (const p of pieces) {
      if (p.end >= asOf) continue;              // not closed yet
      if (p.end < since) continue;              // entirely before the window
      out.push({
        start: p.start, end: p.end,
        accountingMonth: p.start.slice(0, 7),
        partial: pieces.length > 1,
      });
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

/**
 * The most recent closed period(s) — what a scheduler run should invoice now.
 * Returns two when a month boundary split the latest natural period and both
 * halves have closed.
 */
export function latestClosedPeriods(term: BillingTerm, asOf: string): BillingPeriod[] {
  // 70 days covers the longest natural span (a month) plus slack for a run
  // that was missed; anything older is back-billing, which callers request
  // explicitly through closedPeriods().
  const all = closedPeriods(term, asOf, addDays(asOf, -70));
  if (all.length === 0) return [];
  const last = all[all.length - 1];
  // A split pair shares an adjacent boundary: include the sibling fragment
  // so the month-closing short invoice is never left behind.
  const prev = all[all.length - 2];
  if (prev && last.partial && prev.partial && addDays(prev.end, 1) === last.start) {
    return [prev, last];
  }
  return [last];
}

/** Accepts what schedules actually store, including legacy vocabulary. */
export function normalizeTerm(frequency: string | null | undefined): BillingTerm {
  const f = String(frequency ?? '').trim().toLowerCase();
  if (f === 'weekly') return 'weekly';
  if (f === 'monthly') return 'monthly';
  // 'fortnightly' and 'bi_weekly' were a rolling 14 days. Bi-monthly is the
  // commercial term the owner named: 1–15 and 16–end of month.
  if (f === 'bi_monthly' || f === 'bimonthly' || f === 'semi_monthly'
      || f === 'fortnightly' || f === 'bi_weekly') return 'bi_monthly';
  return 'monthly';
}
