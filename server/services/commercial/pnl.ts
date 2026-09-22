/**
 * pnl.ts — shaping the Commercial P&L, and the rules that keep it honest.
 *
 * The source is `financial_snapshot`, client rows only: EXECUTED financial results. It is never
 * `product_rates`, which is commercial INTENT — a price someone wanted to charge, whether or
 * not it ever reached the switch. This report answers "what happened", not "what was meant".
 *
 * What the production evidence established on 2026-09-22, and what each rule below answers:
 *
 *   - 132 client rows across 43 of 64 days, and only 6 of 33 linked accounts appear at all.
 *     So this is NOT a portfolio P&L. Coverage is computed per request and shown, never assumed.
 *   - Even the covered accounts miss about half their days. A missing day is NULL in the series,
 *     never zero: "$0.00" says nothing was earned, "no data" says nothing was recorded, and the
 *     Countries KPI and the tariff-identity nulls both went wrong by conflating them.
 *   - `margin_percent` is a per-row ratio and cannot be summed. Aggregates recompute it, and
 *     when revenue is zero the answer is null, not 0 and not Infinity.
 *   - Two companies claim account 76, so names are not identity. Grouping is by account id;
 *     the name is a label.
 *   - The caller may name accounts (`accountIds[]`), but the caller's list is a FILTER over the
 *     resolved scope, never an assertion about it. Foreign ids are dropped silently — the same
 *     posture as push-scope-guard: what the body says proves nothing.
 *
 * Pure. The route does the SQL and the scope resolution; this file does the arithmetic, so the
 * arithmetic can be tested without a database.
 */

export interface PnlDailyRow {
  /** YYYY-MM-DD */
  date:          string;
  revenue:       number;
  cost:          number;
  margin:        number;
  calls:         number | null;
  billedSeconds: number | null;
  /** distinct accounts contributing to this day */
  accounts:      number;
}

export interface PnlClientRow {
  accountId:   string;
  accountName: string | null;
  revenue:     number;
  cost:        number;
  margin:      number;
  calls:       number | null;
  /** distinct report days this account has rows for, inside the range */
  days:        number;
}

export interface PnlSeriesPoint {
  date:          string;
  /** null = no snapshot row for this day. NEVER 0. */
  revenue:       number | null;
  cost:          number | null;
  margin:        number | null;
  marginPercent: number | null;
  calls:         number | null;
  billedSeconds: number | null;
  accounts:      number;
}

export interface PnlResponse {
  range: {
    from: string;
    to:   string;
    /** earliest client report_date available to this scope, or null if none at all */
    earliestAvailable: string | null;
  };
  summary: {
    revenue:       number;
    cost:          number;
    margin:        number;
    marginPercent: number | null;
    daysWithData:  number;
    daysInRange:   number;
  };
  coverage: {
    /** accounts with at least one client row in the range */
    accountsWithData: number;
    /** the caller's resolved scope — the denominator is THEIR scope, never the estate */
    accountsInScope:  number;
  };
  series:  PnlSeriesPoint[];
  clients: Array<PnlClientRow & { marginPercent: number | null }>;
  /** Fixed, so the UI cannot quietly drop one. */
  notices: {
    marginQuality: string;
    costBasis:     string;
    coverage:      string;
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SPAN_DAYS = 400;
const DEFAULT_SPAN_DAYS = 30;

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/**
 * Margin as a percentage of revenue, recomputed from aggregates.
 * Zero revenue has no defined margin percentage — null, not 0, not Infinity, not NaN.
 */
export function marginPercent(margin: number, revenue: number): number | null {
  if (!Number.isFinite(margin) || !Number.isFinite(revenue) || revenue === 0) return null;
  return round4((margin / revenue) * 100);
}

/**
 * requested ∩ scope. The caller's list narrows the scope and can never widen it.
 *
 * - not an array, or empty → the whole scope (no filter was asked for)
 * - otherwise → only the requested ids that are IN scope, as strings, deduplicated
 *
 * A foreign id is simply absent from the result. It is not an error, because an error would
 * confirm to the caller which ids exist outside their scope.
 */
export function intersectScope(requested: unknown, scope: readonly string[]): string[] {
  const scopeSet = new Set(scope.map(String));
  if (!Array.isArray(requested) || requested.length === 0) return [...scopeSet];
  const out = new Set<string>();
  for (const r of requested) {
    const id = String(r);
    if (scopeSet.has(id)) out.add(id);
  }
  return [...out];
}

/** UTC calendar arithmetic on YYYY-MM-DD strings; no timezone in, none out. */
function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function spanDays(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4),   +to.slice(5, 7) - 1,   +to.slice(8, 10));
  return Math.round((b - a) / 86_400_000) + 1;
}

/**
 * Validate and default the requested range. `today` is injected so the default is testable.
 * Defaults: to = today, from = to − 29 days (a 30-day window). Refuses a malformed date, an
 * inverted range, and a span over MAX_SPAN_DAYS — the last so one request cannot ask the
 * database for years of rows.
 */
export function parseDateRange(
  from: unknown, to: unknown, today: string,
): { ok: true; from: string; to: string } | { ok: false; error: string } {
  const toStr   = to   == null || to   === '' ? today : String(to);
  if (!DATE_RE.test(toStr)) return { ok: false, error: `to must be YYYY-MM-DD, got ${JSON.stringify(to)}` };
  const fromStr = from == null || from === '' ? addDays(toStr, -(DEFAULT_SPAN_DAYS - 1)) : String(from);
  if (!DATE_RE.test(fromStr)) return { ok: false, error: `from must be YYYY-MM-DD, got ${JSON.stringify(from)}` };
  if (fromStr > toStr) return { ok: false, error: `from (${fromStr}) is after to (${toStr})` };
  const span = spanDays(fromStr, toStr);
  if (span > MAX_SPAN_DAYS) return { ok: false, error: `range spans ${span} days; the maximum is ${MAX_SPAN_DAYS}` };
  return { ok: true, from: fromStr, to: toStr };
}

/** Every calendar day from `from` to `to` inclusive. */
export function calendarDays(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export interface ShapePnlInput {
  from: string;
  to:   string;
  earliestAvailable: string | null;
  /** the caller's resolved Commercial scope (after intersection with any requested filter) */
  scopeAccountIds: readonly string[];
  daily:   readonly PnlDailyRow[];
  clients: readonly PnlClientRow[];
}

export function shapePnl(input: ShapePnlInput): PnlResponse {
  const { from, to, earliestAvailable, scopeAccountIds, daily, clients } = input;

  const byDate = new Map(daily.map(r => [r.date, r]));

  // The full calendar, so an absent day is VISIBLE as a gap rather than silently skipped —
  // and visible as null, not as a zero bar.
  const series: PnlSeriesPoint[] = calendarDays(from, to).map(date => {
    const r = byDate.get(date);
    if (!r) {
      return { date, revenue: null, cost: null, margin: null, marginPercent: null,
               calls: null, billedSeconds: null, accounts: 0 };
    }
    return {
      date,
      revenue:       round4(r.revenue),
      cost:          round4(r.cost),
      margin:        round4(r.margin),
      marginPercent: marginPercent(r.margin, r.revenue),
      calls:         r.calls,
      billedSeconds: r.billedSeconds,
      accounts:      r.accounts,
    };
  });

  let revenue = 0, cost = 0, margin = 0;
  for (const r of daily) { revenue += r.revenue; cost += r.cost; margin += r.margin; }
  revenue = round4(revenue); cost = round4(cost); margin = round4(margin);

  const shapedClients = [...clients]
    .map(c => ({ ...c, revenue: round4(c.revenue), cost: round4(c.cost), margin: round4(c.margin),
                 marginPercent: marginPercent(c.margin, c.revenue) }))
    .sort((a, b) => b.revenue - a.revenue);

  const accountsWithData = new Set(clients.map(c => String(c.accountId))).size;
  const accountsInScope  = new Set(scopeAccountIds.map(String)).size;

  return {
    range: { from, to, earliestAvailable },
    summary: {
      revenue, cost, margin,
      marginPercent: marginPercent(margin, revenue),
      daysWithData:  daily.length,
      daysInRange:   series.length,
    },
    coverage: { accountsWithData, accountsInScope },
    series,
    clients: shapedClients,
    notices: {
      marginQuality:
        'Margin quality: current margin may be affected by known client/vendor rate-card duplication. ' +
        'Review rate-card alignment before using margin as a commercial performance measure.',
      costBasis:
        'Cost basis: client cost is derived from the financial-snapshot allocation and is not ' +
        'direct vendor-side truth.',
      coverage:
        `Coverage: ${accountsWithData} of ${accountsInScope} accounts in your scope have financial ` +
        `data in this period. Totals represent available snapshot data, not the complete portfolio.`,
    },
  };
}
