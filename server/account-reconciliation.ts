/**
 * account-reconciliation.ts — Tier 1 of the Finance Certification Engine.
 *
 * Contract §15.3b. The reference already exists: getSippyPerAccountStats has
 * been fetching the switch's own per-account totals every day for months, and
 * the DMR copies them into BOTH columns:
 *
 *     const platDur = sipDur;   // start with same — drift is detected via amount
 *     const platAmt = sipAmt;   // will diverge when tariff snapshot comparison is wired
 *
 * So "DMR reports zero discrepancies" was never a bug in a comparison. It is a
 * comparison that was never finished. This module finishes it: the platform
 * side comes from the REPOSITORY, computed independently, and the two are
 * compared.
 *
 * Tier 1 identity is (customer, currency) — coarser than the contract's §4
 * identity of (customer, prefix, rate, currency), deliberately. Tier 1 answers
 * "WHICH account is wrong"; Tier 2, over the Customer Summary report, answers
 * "why". Tier 1 alone would have caught every dollar of the 2026-08-24 week:
 * internal-ptcl absent ($295.97), internal-eritrea absent ($20.78), asterisk
 * short ($199.14).
 *
 * IDENTITY IS THE HARD PART, and it is why this module exists rather than a
 * few lines inside the DMR. SippyAccountStatRow carries a NAME and no account
 * id, while production holds `Internal-ptcl` (account 76) and `internal-ptcl`
 * (account 588) — DIFFERENT customers differing only in case. Matching
 * case-insensitively merges two customers' money into one line and reports it
 * as agreement. Matching case-sensitively turns a display-name edit into a
 * false FAIL. Neither is acceptable in a financial control, so a name that
 * cannot be resolved to exactly one account is REFUSED rather than guessed.
 *
 * Dependency-free; the comparison itself delegates to billing-reconciliation.ts
 * so there is one comparison core, per the no-second-pipeline rule.
 */
import {
  reconcileAgainstReference, MONEY_TOLERANCE_USD,
  type ReconRow, type ReconOutcome,
} from './billing-reconciliation';

/**
 * Stands in for prefix at account grain. Never blank: a blank prefix reads as
 * "prefix unknown", and this is "prefix not compared at this tier".
 */
export const ACCOUNT_GRAIN_PREFIX = '(account total)';

export interface AccountFigures {
  name:    string;
  calls:   number;
  minutes: number;
  amount:  number;
}

export type AccountStatus =
  | 'certified'
  /** The switch billed it and the platform did not. */
  | 'missing_from_platform'
  /** The platform billed it and the switch did not. */
  | 'missing_from_reference'
  | 'amount_differs'
  /** The name maps to more than one account — cannot be attributed. */
  | 'ambiguous_identity';

export interface AccountVerdict {
  customer:     string;
  status:       AccountStatus;
  reference:    AccountFigures | null;
  platform:     AccountFigures | null;
  /** platform − reference. Negative means the platform under-billed. */
  amountDelta:  number;
  minutesDelta: number;
  callsDelta:   number;
  reason:       string;
}

export interface AccountReconResult {
  outcome:  ReconOutcome;
  reason:   string;
  accounts: AccountVerdict[];
  /** Only the accounts that are not certified, worst money first. */
  failing:  AccountVerdict[];
  summary: {
    accountsInReference: number;
    certified:           number;
    failed:              number;
    referenceTotal:      number;
    platformTotal:       number;
    delta:               number;
  };
  toleranceUsd: number;
}

const norm  = (n: string) => n.trim().toLowerCase();
const money = (n: number) => Math.round(n * 1e6) / 1e6;

/** Names appearing more than once under case-folding — cannot be attributed. */
function ambiguousNames(rows: AccountFigures[]): Set<string> {
  const seen = new Map<string, Set<string>>();
  for (const r of rows) {
    const k = norm(r.name);
    if (!seen.has(k)) seen.set(k, new Set());
    seen.get(k)!.add(r.name.trim());
  }
  const out = new Set<string>();
  for (const [k, variants] of seen) if (variants.size > 1) out.add(k);
  return out;
}

export function reconcileAccounts(opts: {
  /** From getSippyPerAccountStats. null when the switch could not be reached. */
  reference:     AccountFigures[] | null | undefined;
  /** Computed from raw_sippy_cdrs — never from DMR, snapshot or cache. */
  platform:      AccountFigures[];
  currency?:     string;
  toleranceUsd?: number;
  periodLabel?:  string;
}): AccountReconResult {
  const tol = opts.toleranceUsd ?? MONEY_TOLERANCE_USD;
  const currency = opts.currency ?? 'USD';
  const period = opts.periodLabel ? ` for ${opts.periodLabel}` : '';

  if (opts.reference == null) {
    return {
      outcome: 'REFERENCE_UNAVAILABLE',
      reason:
        `The switch's per-account totals were not available${period}. Certification did not run. ` +
        'The local CDR cache must NOT be substituted here — comparing the platform against its own ' +
        'data would certify it against itself.',
      accounts: [], failing: [],
      summary: { accountsInReference: 0, certified: 0, failed: 0,
                 referenceTotal: 0, platformTotal: 0, delta: 0 },
      toleranceUsd: tol,
    };
  }

  // Identity first. A name that resolves to more than one account is refused,
  // never merged — merging two customers reports their combined figure as
  // agreement and hides both.
  const ambiguous = new Set([
    ...ambiguousNames(opts.reference),
    ...ambiguousNames(opts.platform),
  ]);

  const usableRef  = opts.reference.filter(r => !ambiguous.has(norm(r.name)));
  const usablePlat = opts.platform.filter(r => !ambiguous.has(norm(r.name)));

  const toRow = (f: AccountFigures): ReconRow => ({
    customer: f.name, prefix: ACCOUNT_GRAIN_PREFIX, rate: 0, currency,
    calls: f.calls, minutes: f.minutes, amount: f.amount,
  });

  const cmp = reconcileAgainstReference({
    reference: usableRef.map(toRow),
    platform:  usablePlat.map(toRow),
    toleranceUsd: tol,
    periodLabel: opts.periodLabel,
  });

  const byName = (rows: AccountFigures[], n: string) =>
    rows.find(r => norm(r.name) === n) ?? null;

  const accounts: AccountVerdict[] = cmp.lines.map(l => ({
    customer:     l.key.customer,
    status:       l.status === 'match' ? 'certified' : (l.status as AccountStatus),
    reference:    l.reference ? byName(usableRef,  norm(l.key.customer)) : null,
    platform:     l.platform  ? byName(usablePlat, norm(l.key.customer)) : null,
    amountDelta:  l.amountDelta,
    minutesDelta: l.minutesDelta,
    callsDelta:   l.callsDelta,
    reason:
      l.status === 'match' ? ''
      : l.status === 'missing_from_platform'
        ? `The switch billed $${(l.reference?.amount ?? 0).toFixed(4)} and the platform billed nothing. ` +
          'No internal check can see this — an account absent from the platform produces no discrepancy.'
      : l.status === 'missing_from_reference'
        ? `The platform billed $${(l.platform?.amount ?? 0).toFixed(4)} and the switch billed nothing.`
        : `Differs by $${l.amountDelta.toFixed(4)} (reference $${(l.reference?.amount ?? 0).toFixed(4)}, ` +
          `platform $${(l.platform?.amount ?? 0).toFixed(4)}).`,
  }));

  for (const n of ambiguous) {
    const ref = opts.reference.filter(r => norm(r.name) === n);
    const plt = opts.platform.filter(r => norm(r.name) === n);
    accounts.push({
      customer: (ref[0] ?? plt[0])!.name,
      status: 'ambiguous_identity',
      reference: null, platform: null,
      amountDelta: 0, minutesDelta: 0, callsDelta: 0,
      reason:
        `"${n}" matches ${ref.length + plt.length} rows whose names differ only in case or spacing. ` +
        'These are different accounts in Sippy. Attributing money by display name would merge them ' +
        'and report the merge as agreement, so this account is refused until it is identified by a ' +
        'stable account id rather than a name.',
    });
  }

  const failing = accounts
    .filter(a => a.status !== 'certified')
    .sort((a, b) => Math.abs(b.amountDelta) - Math.abs(a.amountDelta));

  const referenceTotal = money(opts.reference.reduce((s, r) => s + r.amount, 0));
  const platformTotal  = money(opts.platform.reduce((s, r) => s + r.amount, 0));
  const summary = {
    accountsInReference: opts.reference.length,
    certified: accounts.filter(a => a.status === 'certified').length,
    failed:    failing.length,
    referenceTotal, platformTotal, delta: money(platformTotal - referenceTotal),
  };

  if (failing.length === 0) {
    return {
      outcome: 'PASS',
      reason: `All ${summary.certified} account(s) agree with the switch${period} within $${tol.toFixed(2)}.`,
      accounts, failing, summary, toleranceUsd: tol,
    };
  }

  return {
    outcome: 'FAIL',
    reason:
      `${summary.failed} of ${accounts.length} account(s) do not agree with the switch${period}. ` +
      `Reference $${referenceTotal.toFixed(4)}, platform $${platformTotal.toFixed(4)}, ` +
      `difference $${summary.delta.toFixed(4)}.`,
    accounts, failing, summary, toleranceUsd: tol,
  };
}
