/**
 * daily-reconciliation.ts — which account-days actually disagree?
 *
 * The period gate answers "may this invoice be generated". This answers the
 * operator's next question: WHERE is the money missing, and what is the
 * smallest amount of work that would fix it.
 *
 * Owner's recovery strategy, 2026-09-01, and it is a better one than re-running
 * the week: compare every (day, account) cell against the switch, re-fetch ONLY
 * the cells that disagree, reconcile again, and stop when they match. Most
 * cells need no work; a few need one retry; the stubborn ones are the actual
 * defect and deserve investigation rather than a fourth pass.
 *
 * That is only possible with a cell-level comparison, because a period total
 * hides which day and which customer went wrong. The week 08-24 → 08-30 is
 * $331.78 against $683.39; that single number cannot tell you whether one day
 * is catastrophic or all seven are mediocre — and those need different fixes.
 *
 * A DELIBERATE DIFFERENCE FROM THE GATE. reference-coverage.ts makes a period
 * with any missing reference day return REFERENCE_UNAVAILABLE, because a
 * partial reference understates the total it is compared against and biases a
 * verdict toward PASS. Here the opposite is correct: a day without a reference
 * is marked `no_reference` and the other days are still compared. Refusing to
 * report six knowable days because a seventh is unknowable would withhold
 * exactly the information the operator needs. The gate must be conservative;
 * a diagnostic must be complete.
 *
 * Dependency-free so the comparison arithmetic is pinned by tests.
 */

/** Money-only tolerance, matching BILLING-RECONCILIATION-CONTRACT §4. */
export const CELL_TOLERANCE_USD = 0.01;

export interface Cell {
  day:     string;   // YYYY-MM-DD
  account: string;   // customer name as the switch reports it
  amount:  number;
  minutes: number;
  calls:   number;
}

export type CellStatus =
  /** Within tolerance. Nothing to do. */
  | 'match'
  /** The switch billed MORE than the platform holds — under-collection. */
  | 'short'
  /** The platform holds MORE than the switch billed. Investigate; never bill. */
  | 'over'
  /** The switch billed this account-day; the platform has nothing at all. */
  | 'missing_from_platform'
  /** The platform has rows the switch's reference does not mention. */
  | 'missing_from_reference'
  /** No reference exists for this day — unknowable, NOT a pass. */
  | 'no_reference';

export interface CellVerdict {
  day:       string;
  account:   string;
  reference: number | null;
  platform:  number | null;
  /** platform − reference. Negative means under-collected. */
  delta:     number;
  /** Fraction of the reference actually held, 0..1. null when unknowable. */
  ratio:     number | null;
  status:    CellStatus;
  /** True when re-fetching this cell could plausibly help. */
  actionable: boolean;
  reason:    string;
}

export interface DailyReconResult {
  cells: CellVerdict[];
  /** Cells worth re-fetching, worst money first — the work list. */
  actions: CellVerdict[];
  summary: {
    cells: number;
    matched: number;
    short: number;
    over: number;
    missingFromPlatform: number;
    missingFromReference: number;
    noReference: number;
    /** Σ of shortfalls only. The money a successful recovery would restore. */
    recoverableUsd: number;
    referenceTotal: number;
    platformTotal: number;
  };
  daysWithoutReference: string[];
  toleranceUsd: number;
}

const money = (n: number) => Math.round(n * 1e6) / 1e6;
const key   = (day: string, account: string) => `${day}::${account.trim().toLowerCase()}`;

export function reconcileDaily(opts: {
  reference: Cell[];
  platform:  Cell[];
  /** Days the period requires. Days here with no reference row are reported
   *  as `no_reference` even when neither side has data for them. */
  days:      string[];
  toleranceUsd?: number;
}): DailyReconResult {
  const tol = opts.toleranceUsd ?? CELL_TOLERANCE_USD;

  const refByKey = new Map<string, Cell>();
  for (const c of opts.reference) refByKey.set(key(c.day, c.account), c);
  const platByKey = new Map<string, Cell>();
  for (const c of opts.platform) platByKey.set(key(c.day, c.account), c);

  const daysWithReference = new Set(opts.reference.map(c => c.day));
  const daysWithoutReference = opts.days.filter(d => !daysWithReference.has(d));

  const cells: CellVerdict[] = [];
  for (const k of new Set([...refByKey.keys(), ...platByKey.keys()])) {
    const ref  = refByKey.get(k) ?? null;
    const plat = platByKey.get(k) ?? null;
    const day     = (ref ?? plat)!.day;
    const account = (ref ?? plat)!.account;

    // A day with no reference is unknowable regardless of what the platform
    // holds. Reporting the platform's own figure as if it were verified is the
    // self-comparison the whole gate exists to remove.
    if (!daysWithReference.has(day)) {
      cells.push({
        day, account, reference: null, platform: plat ? money(plat.amount) : null,
        delta: 0, ratio: null, status: 'no_reference', actionable: false,
        reason: `No reference exists for ${day}, so this cell cannot be judged. Generate the DMR ` +
                'for that date (Run DMR) before treating it as either correct or missing.',
      });
      continue;
    }

    const refAmt  = ref  ? money(ref.amount)  : null;
    const platAmt = plat ? money(plat.amount) : null;
    const delta   = money((platAmt ?? 0) - (refAmt ?? 0));
    const ratio   = refAmt && refAmt !== 0 ? Math.round(((platAmt ?? 0) / refAmt) * 1e4) / 1e4 : null;

    if (ref && !plat) {
      cells.push({ day, account, reference: refAmt, platform: null, delta, ratio: 0,
        status: 'missing_from_platform', actionable: true,
        reason: `The switch billed $${refAmt!.toFixed(4)} for ${account} on ${day} and the platform ` +
                'holds nothing. Re-fetch this account-day.' });
      continue;
    }
    if (plat && !ref) {
      // Never actionable by re-fetching: fetching more cannot make the
      // reference mention it, and billing it would be billing something the
      // switch does not corroborate.
      cells.push({ day, account, reference: null, platform: platAmt, delta, ratio: null,
        status: 'missing_from_reference', actionable: false,
        reason: `The platform holds $${platAmt!.toFixed(4)} for ${account} on ${day} that the ` +
                'reference does not mention. Re-fetching cannot resolve this — investigate before billing.' });
      continue;
    }

    if (Math.abs(delta) <= tol) {
      cells.push({ day, account, reference: refAmt, platform: platAmt, delta, ratio,
        status: 'match', actionable: false,
        reason: `Matches within $${tol.toFixed(2)}.` });
    } else if (delta < 0) {
      cells.push({ day, account, reference: refAmt, platform: platAmt, delta, ratio,
        status: 'short', actionable: true,
        reason: `Short by $${Math.abs(delta).toFixed(4)} — the platform holds ` +
                `${ratio == null ? '?' : (ratio * 100).toFixed(1)}% of what the switch billed. ` +
                'Re-fetch this account-day.' });
    } else {
      cells.push({ day, account, reference: refAmt, platform: platAmt, delta, ratio,
        status: 'over', actionable: false,
        reason: `The platform holds $${delta.toFixed(4)} MORE than the switch billed. Re-fetching ` +
                'cannot fix an excess — investigate before billing; over-billing is the worse error.' });
    }
  }

  cells.sort((a, b) => a.day.localeCompare(b.day) || a.account.localeCompare(b.account));

  const actions = cells.filter(c => c.actionable)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const count = (s: CellStatus) => cells.filter(c => c.status === s).length;
  const recoverable = money(cells.filter(c => c.status === 'short' || c.status === 'missing_from_platform')
    .reduce((sum, c) => sum + Math.abs(c.delta), 0));

  return {
    cells, actions,
    summary: {
      cells: cells.length,
      matched: count('match'),
      short: count('short'),
      over: count('over'),
      missingFromPlatform: count('missing_from_platform'),
      missingFromReference: count('missing_from_reference'),
      noReference: count('no_reference'),
      recoverableUsd: recoverable,
      referenceTotal: money(cells.reduce((s, c) => s + (c.reference ?? 0), 0)),
      platformTotal:  money(cells.reduce((s, c) => s + (c.platform  ?? 0), 0)),
    },
    daysWithoutReference,
    toleranceUsd: tol,
  };
}
