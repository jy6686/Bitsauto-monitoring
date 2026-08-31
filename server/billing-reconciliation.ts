/**
 * billing-reconciliation.ts — the financial gate.
 *
 * BILLING-RECONCILIATION-CONTRACT.md, made executable. No invoice is valid
 * because BitsAuto's own stages agree with each other; it is valid because
 * BitsAuto agrees with a reference produced INDEPENDENTLY by the switch.
 *
 * WHY THIS EXISTS, in one week's evidence (2026-08-24 → 2026-08-30):
 *
 *   Sippy Customer Summary   $683.3934
 *   BitsAuto invoiced        $167.5063
 *   ─────────────────────────────────
 *   Never billed             $515.8871      75% of the week
 *
 * Every internal check passed. The period was closed, certified, snapshotted,
 * and the DMR reported zero discrepancies — because each of those compares
 * BitsAuto against BitsAuto. $295.97 of internal-ptcl and $20.78 of
 * internal-eritrea were absent from the platform entirely, and an absence
 * cannot create a discrepancy in a comparison that only walks what it has.
 *
 * Only a reference produced outside this platform can see a customer that is
 * missing from it. That is the whole argument for this file.
 *
 * Dependency-free: the comparison arithmetic is pinned by tests, and the
 * reference is supplied by a caller (contract §3, FinancialReferenceProvider)
 * so the gate never depends on how the reference was obtained.
 */

/** Contract §4 — comparison identity. */
export interface ReconKey {
  customer: string;
  prefix:   string;
  rate:     number;
  currency: string;
}

export interface ReconMeasures {
  /** Informational only — contract §5. Never gates. */
  calls:   number;
  /** Informational only — contract §5. Never gates. */
  minutes: number;
  /** THE gated dimension. */
  amount:  number;
}

export type ReconRow = ReconKey & ReconMeasures;

export type LineStatus =
  | 'match'
  /** Both sides have the row; the money differs beyond tolerance. */
  | 'amount_differs'
  /** The switch billed it and we did not. Under-billing — revenue lost. */
  | 'missing_from_platform'
  /** We billed it and the switch did not. Over-billing — worse. */
  | 'missing_from_reference';

export interface ReconLine {
  key:          ReconKey;
  reference:    ReconMeasures | null;
  platform:     ReconMeasures | null;
  amountDelta:  number;   // platform − reference
  minutesDelta: number;   // informational
  callsDelta:   number;   // informational
  status:       LineStatus;
}

/** Contract §7 — three outcomes, and only three. */
export type ReconOutcome = 'PASS' | 'FAIL' | 'REFERENCE_UNAVAILABLE';

export interface ReconResult {
  outcome: ReconOutcome;
  reason:  string;
  totals: {
    reference: number;
    platform:  number;
    /** platform − reference. Negative means we under-billed. */
    delta:     number;
  };
  lines:   ReconLine[];
  /** Only the lines that caused a FAIL, worst money first. */
  failing: ReconLine[];
  toleranceUsd: number;
}

/**
 * Contract §5: "No percentage tolerances. Finance audits money, not ratios."
 * One cent, absolute, at every scale — a 0.5% band on a $600,000 month is
 * $3,000 of undetected error.
 */
export const MONEY_TOLERANCE_USD = 0.01;

const keyOf = (k: ReconKey) =>
  `${k.customer.trim().toLowerCase()}|${k.prefix.trim()}|${k.rate.toFixed(6)}|${k.currency.trim().toUpperCase()}`;

const ZERO: ReconMeasures = { calls: 0, minutes: 0, amount: 0 };
const money = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * Compare the platform's figures against an independently produced reference.
 *
 * `reference == null` is NOT a pass. A comparison that could not be made has
 * told you nothing, and "we could not check" must never be recorded as "we
 * checked and it was fine" — the defect this platform has produced in five
 * different forms already.
 */
export function reconcileAgainstReference(opts: {
  reference:      ReconRow[] | null | undefined;
  platform:       ReconRow[];
  toleranceUsd?:  number;
  /** For the operator-facing reason line. */
  periodLabel?:   string;
}): ReconResult {
  const tol = opts.toleranceUsd ?? MONEY_TOLERANCE_USD;
  const period = opts.periodLabel ? ` for ${opts.periodLabel}` : '';

  if (opts.reference == null) {
    return {
      outcome: 'REFERENCE_UNAVAILABLE',
      reason:
        `No independent reference${period}. The platform cannot be certified against itself — ` +
        'a comparison that did not happen is not a comparison that passed.',
      totals: { reference: 0, platform: 0, delta: 0 },
      lines: [], failing: [], toleranceUsd: tol,
    };
  }

  const refBy = new Map<string, ReconRow>();
  for (const r of opts.reference) refBy.set(keyOf(r), r);
  const platBy = new Map<string, ReconRow>();
  for (const p of opts.platform) platBy.set(keyOf(p), p);

  const lines: ReconLine[] = [];
  for (const k of new Set([...refBy.keys(), ...platBy.keys()])) {
    const r = refBy.get(k) ?? null;
    const p = platBy.get(k) ?? null;
    const rm: ReconMeasures = r ? { calls: r.calls, minutes: r.minutes, amount: r.amount } : ZERO;
    const pm: ReconMeasures = p ? { calls: p.calls, minutes: p.minutes, amount: p.amount } : ZERO;
    const amountDelta = money(pm.amount - rm.amount);

    const status: LineStatus =
      r && !p ? 'missing_from_platform'
      : p && !r ? 'missing_from_reference'
      : Math.abs(amountDelta) > tol ? 'amount_differs'
      : 'match';

    lines.push({
      key: (r ?? p)!, reference: r ? rm : null, platform: p ? pm : null,
      amountDelta,
      minutesDelta: money(pm.minutes - rm.minutes),
      callsDelta:   pm.calls - rm.calls,
      status,
    });
  }

  const refTotal  = money(opts.reference.reduce((s, r) => s + r.amount, 0));
  const platTotal = money(opts.platform.reduce((s, r) => s + r.amount, 0));
  const totals = { reference: refTotal, platform: platTotal, delta: money(platTotal - refTotal) };

  // A row missing from EITHER side fails regardless of its size — it is not a
  // small difference, it is a row nobody compared. The $0.01 band applies to
  // rows both sides have; it was never meant to excuse an absent customer.
  const failing = lines
    .filter(l => l.status !== 'match')
    .sort((a, b) => Math.abs(b.amountDelta) - Math.abs(a.amountDelta));

  if (failing.length === 0) {
    return {
      outcome: 'PASS',
      reason: `Platform agrees with the reference${period} within $${tol.toFixed(2)} on all ${lines.length} line(s).`,
      totals, lines, failing, toleranceUsd: tol,
    };
  }

  const under = failing.filter(l => l.status === 'missing_from_platform');
  const over  = failing.filter(l => l.status === 'missing_from_reference');
  const diff  = failing.filter(l => l.status === 'amount_differs');

  const parts: string[] = [];
  if (under.length) parts.push(`${under.length} line(s) billed by the switch and NOT by the platform`);
  if (over.length)  parts.push(`${over.length} line(s) billed by the platform and NOT by the switch`);
  if (diff.length)  parts.push(`${diff.length} line(s) differ by more than $${tol.toFixed(2)}`);

  return {
    outcome: 'FAIL',
    reason:
      `Platform and reference disagree${period}: reference $${refTotal.toFixed(4)}, ` +
      `platform $${platTotal.toFixed(4)}, difference $${totals.delta.toFixed(4)}. ` +
      parts.join('; ') + '.',
    totals, lines, failing, toleranceUsd: tol,
  };
}
