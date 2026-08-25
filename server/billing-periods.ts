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

// 'semi_monthly' is the standard accounting term for 1–15 / 16–end of month.
// 'bi-monthly' is avoided deliberately: in business English it can mean twice a
// month OR every two months, and a billing cycle cannot afford that ambiguity.
export type BillingTerm = 'daily' | 'weekly' | 'semi_monthly' | 'monthly';

/**
 * A customer's billing policy — WHEN to invoice, nothing about HOW periods
 * are computed. The scheduler holds one of these and asks for closed periods;
 * it never needs to know that weeks split at month-end or that February is
 * short. Sourced from the company record, because the billing cycle is a
 * commercial term and those live on the company profile alongside payment
 * terms and currency.
 */
export interface BillingPolicy {
  frequency: BillingTerm;
  /**
   * Locked to GMT. Sippy's CDR exports, carrier settlement periods and
   * month-end close are all GMT, and a local zone would reintroduce the
   * daylight-saving shift this module exists to remove. Present so the
   * assumption is visible rather than implied.
   */
  timezone: 'Etc/UTC';
}

export interface BillingPeriod {
  /** YYYY-MM-DD at 00:00 GMT, inclusive. The period opens here. */
  start: string;
  /**
   * YYYY-MM-DD, INCLUSIVE — the last billed day. This is what the invoice
   * prints and what the existing queries compare against, since every one of
   * them truncates the CDR timestamp to a date first.
   */
  end: string;
  /**
   * YYYY-MM-DD at 00:00 GMT, EXCLUSIVE — the accounting boundary proper,
   * per the owner's rule that a period runs [00:00 GMT, 00:00 GMT).
   *
   * Use this for any comparison against a raw TIMESTAMP, because the obvious
   * form is silently wrong: `cdr_start_time <= '2026-08-31'` is lexically
   * FALSE for '2026-08-31 14:00:00', so it drops the entire last day. The
   * correct form is `>= start AND < endExclusive`, which needs no truncation
   * and has no 23:59:59 case to get wrong.
   */
  endExclusive: string;
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
 *   weekly        Monday–Sunday
 *   semi_monthly  1st–15th and 16th–end of month — NOT a rolling fortnight,
 *                 which is what the previous scheduler implemented
 *   monthly       1st–end of month
 */
function naturalSpans(term: BillingTerm, since: string, until: string): Array<{ start: string; end: string }> {
  const spans: Array<{ start: string; end: string }> = [];
  if (term === 'daily') {
    let cursor = since;
    while (cursor <= until) { spans.push({ start: cursor, end: cursor }); cursor = addDays(cursor, 1); }
    return spans;
  }
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
    if (term === 'semi_monthly') {
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
        start: p.start, end: p.end, endExclusive: addDays(p.end, 1),
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

/**
 * Has this period finished, as of a given day?
 *
 * A period is closed once the clock passes its exclusive boundary — 00:00 GMT
 * on the day after its last billed day. Invoicing before that bills a period
 * still receiving calls: the document understates what the customer owes, and
 * the missing calls have nowhere to go afterwards, because a period is never
 * invoiced twice.
 *
 * @param end   inclusive last day, YYYY-MM-DD
 * @param asOf  today, YYYY-MM-DD (UTC)
 */
export function isPeriodClosed(end: string, asOf: string): boolean {
  const e = String(end ?? '').slice(0, 10);
  const a = String(asOf ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e) || !/^\d{4}-\d{2}-\d{2}$/.test(a)) return false;
  return addDays(e, 1) <= a;   // the exclusive boundary has been reached
}

/**
 * Has the accounting month this period belongs to finished? Month-end close
 * needs the whole month behind it, not merely the period.
 */
export function isAccountingMonthClosed(accountingMonth: string, asOf: string): boolean {
  const m = String(accountingMonth ?? '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(m)) return false;
  return addDays(endOfMonth(`${m}-01`), 1) <= String(asOf ?? '').slice(0, 10);
}

/**
 * Accepts every vocabulary in use: the company's clientBillingCycle
 * ('weekly_cutoff' | 'monthly' | 'daily' | 'bi_weekly') and the schedule's
 * frequency ('weekly' | 'monthly' | 'fortnightly').
 *
 * 'weekly_cutoff' matters most: it is the DEFAULT on every company record, so
 * failing to recognise it would bill weekly customers monthly — the kind of
 * silent fallback that looks like nothing is wrong.
 */
export function normalizeTerm(frequency: string | null | undefined): BillingTerm {
  const f = String(frequency ?? '').trim().toLowerCase();
  if (f === 'daily') return 'daily';
  if (f === 'weekly' || f === 'weekly_cutoff') return 'weekly';
  if (f === 'monthly' || f === 'monthly_cutoff') return 'monthly';
  // 'fortnightly' and 'bi_weekly' were a rolling 14 days. Bi-monthly is the
  // accounting term for what the owner described: 1–15 and 16–end of month.
  if (f === 'semi_monthly' || f === 'semimonthly' || f === 'bi_monthly'
      || f === 'bimonthly' || f === 'fortnightly' || f === 'bi_weekly') return 'semi_monthly';
  return 'monthly';
}

/**
 * The billing policy for a company. Prefers the company's own cycle — the
 * commercial agreement lives on the company profile — and accepts a schedule
 * frequency only as the fallback for records that predate it.
 */
export function billingPolicyFor(
  source: { clientBillingCycle?: string | null } | null | undefined,
  scheduleFrequency?: string | null,
): BillingPolicy {
  const cycle = source?.clientBillingCycle ?? null;
  return {
    frequency: normalizeTerm(cycle ?? scheduleFrequency),
    timezone: 'Etc/UTC',
  };
}

/**
 * The scheduler's single entry point: given a policy and the current UTC
 * instant, which periods are closed and ready to invoice.
 *
 * The caller never learns how weeks split, when February ends, or that a
 * month boundary outranks the cadence — that is the point of the seam.
 */
export function calculateClosedBillingPeriods(
  policy: BillingPolicy, nowUtc: Date | string, since?: string,
): BillingPeriod[] {
  const asOf = typeof nowUtc === 'string' ? nowUtc.slice(0, 10) : nowUtc.toISOString().slice(0, 10);
  return since
    ? closedPeriods(policy.frequency, asOf, since)
    : latestClosedPeriods(policy.frequency, asOf);
}
