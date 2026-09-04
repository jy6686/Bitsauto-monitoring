/**
 * invoice-restatement.ts — what would regenerating an invoice actually change?
 *
 * WHY THIS EXISTS. The rating engine was corrected on 2026-09-04: it had been
 * charging the per-minute price once per billing interval, over-stating every
 * tariff finer than 60/60 by 60/intervalN. Invoices generated before that date
 * hold the inflated figure, frozen, in their snapshots and their stored HTML.
 *
 * Regenerating them is a WRITE against financial artefacts, and nobody should
 * authorise one from a description. This module computes the restatement
 * without performing it, so the decision is made against numbers.
 *
 * ── The tariff does not change. The arithmetic does. ───────────────────────
 * `invoice_cdr_snapshots` stores the rate parameters that were used at
 * generation — price1Used, intervalNUsed, connectFeeUsed and the rest. The
 * restatement re-rates each line from THOSE frozen values through the
 * corrected engine. It never reads a live tariff.
 *
 * That distinction is the whole safety argument. A restatement that consulted
 * today's tariffs would silently re-price historical traffic at today's rates,
 * which is a different and much worse operation wearing the same name.
 *
 * ── A sent invoice is not editable ─────────────────────────────────────────
 * Drafts may be rewritten in place; they have not been asserted to anyone. An
 * approved or sent invoice is a commercial document, and correcting one is a
 * credit note, not an edit. This module refuses to classify those as
 * regenerable no matter how wrong the figure is — the arithmetic being wrong
 * is exactly why someone would be tempted, and exactly why the rule exists.
 *
 * ── The number that authorises the decision ────────────────────────────────
 * `correctedVsActual`. Sippy's own actual_cost is on every snapshot row, so
 * the restatement can be checked against the switch before it is applied: if
 * the corrected total lands on the switch's figure, regeneration produces a
 * correct invoice. If it does not, something other than the units is wrong and
 * regenerating would freeze a second bad number.
 *
 * Pure: no DB, no clock. The caller supplies rows.
 */

import { rateCall } from './rating-cost';
import { readNumber, type FieldRead } from './finance-number';

const TBL = 'invoice_cdr_snapshots';

/** The frozen snapshot row this module needs. Extra fields are ignored. */
export interface SnapshotRow {
  id?: number | null;
  durationSecs?: number | null;
  reproducedCost?: number | null;
  actualCost?: number | null;
  prefix?: string | null;
  interval1Used?: number | null;
  intervalNUsed?: number | null;
  price1Used?: number | null;
  priceNUsed?: number | null;
  connectFeeUsed?: number | null;
  gracePeriodUsed?: number | null;
  freeSecondsUsed?: number | null;
  postCallSurchargeUsed?: number | null;
  [k: string]: unknown;
}

export interface InvoiceRow {
  id: number;
  invoiceNumber?: string | null;
  customerName?: string | null;
  status?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  totalReproduced?: number | null;
  totalActual?: number | null;
  lineCount?: number | null;
  [k: string]: unknown;
}

export type Eligibility =
  /** Already correct — the corrected total matches what is stored. */
  | 'no_change'
  /** A draft. Safe to rewrite in place. */
  | 'regenerate'
  /** Asserted to someone. Correcting it is a credit note, not an edit. */
  | 'credit_note_required'
  /** Cannot be restated — the snapshot does not carry what re-rating needs. */
  | 'blocked';

export interface LineRestatement {
  snapshotId: number | null;
  prefix: string | null;
  durationSecs: number;
  storedCost: number;
  correctedCost: number;
  actualCost: number | null;
  /** storedCost / correctedCost. 60 on a 1/1 line generated before the fix. */
  overstatement: number | null;
  changed: boolean;
}

export interface InvoiceRestatement {
  invoiceId: number;
  invoiceNumber: string | null;
  customerName: string | null;
  status: string;
  period: string;

  lineCount: number;
  linesRestated: number;
  linesChanged: number;
  /** Lines that could not be re-rated, with the reason. */
  linesBlocked: Array<{ snapshotId: number | null; reason: string }>;

  storedTotal: number;
  correctedTotal: number;
  /** Sippy's own figure, summed over the lines that carry one. */
  actualTotal: number | null;
  actualCoverage: number;

  /** storedTotal / actualTotal — the over-statement as invoiced. */
  storedVsActual: number | null;
  /**
   * correctedTotal / actualTotal. THE NUMBER TO READ. ~1.0 means regenerating
   * produces an invoice that agrees with the switch.
   */
  correctedVsActual: number | null;

  eligibility: Eligibility;
  reason: string;
  /** Money that would come off this invoice. Negative means it would go up. */
  reduction: number;
  /** The consolidated answer. See CorrectionImpact. */
  correctionImpact: CorrectionImpact;
}

/** What a correction is worth paying attention to. */
export type Materiality = 'none' | 'minor' | 'major' | 'critical';

/** Above this, a correction is worth a person's time. */
export const MATERIALITY_MINOR_USD    = 0.01;
export const MATERIALITY_MAJOR_USD    = 1;
export const MATERIALITY_CRITICAL_USD = 100;

/** The one-word answer to "what do I do about this invoice?" */
export type CorrectionAction = 'none' | 'regenerate' | 'credit_note' | 'investigate';

/**
 * Everything Finance needs to triage one invoice, pre-computed.
 *
 * The five questions this exists to answer without further arithmetic:
 * which invoices changed, by how much, is it a regeneration, is it a credit
 * note, or is no action required. A caller doing its own subtraction is a
 * caller that can get the sign wrong.
 *
 * SIGN CONVENTION, stated because it is the one thing here that can be
 * misread: `delta` is corrected MINUS previous, so a bill that comes down is
 * NEGATIVE. That matches how a correction reads in a ledger. `reduction` on
 * the parent object is the opposite sign, kept because it is what the summary
 * totals and the sort order use; the two are documented rather than reconciled
 * so neither caller has to invert anything.
 */
export interface CorrectionImpact {
  invoice: string | null;
  status: string;
  previousTotal: number;
  correctedTotal: number;
  /** corrected − previous. Negative when the invoice comes down. */
  delta: number;
  /**
   * How wrong the previous figure was, as a percentage of the corrected one.
   * 5900 for a 60x over-statement. null when the corrected total is zero and
   * a percentage would be meaningless rather than infinite.
   */
  relativeErrorPct: number | null;
  /** previous / corrected. 60.0 on an invoice of 1/1 rates. null at zero. */
  overstatementFactor: number | null;
  action: CorrectionAction;
  actionReason: string;
  /**
   * Whether the CORRECTED figure agrees with the switch. null when no line
   * carried an actual_cost to check against. A false here means the
   * restatement is not trustworthy and `action` is 'investigate'.
   */
  agreesWithSwitch: boolean | null;
  materiality: Materiality;
}

/**
 * Statuses whose documents have not been asserted to anyone yet.
 *
 * Deliberately a whitelist. An unrecognised status is treated as NOT
 * rewritable, because the failure directions are not symmetric: refusing to
 * regenerate a draft costs a conversation, silently rewriting a sent invoice
 * costs an audit trail.
 */
export const REWRITABLE_STATUSES = new Set(['draft', 'review', 'pending']);

/** Money is compared at the cent; below this the two totals are the same. */
export const RESTATEMENT_TOLERANCE_USD = 0.005;

const round8 = (n: number) => +n.toFixed(8);

/**
 * Re-rate one snapshot line through the corrected engine, from its own frozen
 * rate parameters.
 */
export function restateLine(snap: SnapshotRow): LineRestatement | { blocked: string } {
  const need: Array<[string, FieldRead]> = [
    ['durationSecs',   readNumber(snap, 'durationSecs',   TBL)],
    ['reproducedCost', readNumber(snap, 'reproducedCost', TBL)],
  ];
  for (const [, r] of need) if (!r.ok) return { blocked: r.detail };

  const durationSecs = need[0][1].value!;
  const storedCost   = need[1][1].value!;

  // The rate as frozen at generation. A missing price is fatal — re-rating at
  // an assumed zero would produce a free call and call it a correction.
  const price1 = readNumber(snap, 'price1Used', TBL);
  const priceN = readNumber(snap, 'priceNUsed', TBL);
  if (!price1.ok) return { blocked: `Cannot re-rate: ${price1.detail}` };
  if (!priceN.ok) return { blocked: `Cannot re-rate: ${priceN.detail}` };

  // Intervals default to a full minute, which is Sippy's own default and the
  // only case the old engine got right — so a snapshot missing them restates
  // to the same figure rather than a surprising one.
  const num = (f: string, fallback: number) => {
    const r = readNumber(snap, f, TBL);
    return r.ok ? r.value! : fallback;
  };

  const correctedCost = rateCall(durationSecs, {
    price1:            price1.value!,
    priceN:            priceN.value!,
    interval1:         num('interval1Used', 60),
    intervalN:         num('intervalNUsed', 60),
    connectFee:        num('connectFeeUsed', 0),
    freeSeconds:       num('freeSecondsUsed', 0),
    gracePeriod:       num('gracePeriodUsed', 0),
    postCallSurcharge: num('postCallSurchargeUsed', 0),
  }).cost;

  const actual = readNumber(snap, 'actualCost', TBL);

  return {
    snapshotId:  typeof snap.id === 'number' ? snap.id : null,
    prefix:      snap.prefix == null ? null : String(snap.prefix),
    durationSecs,
    storedCost,
    correctedCost,
    actualCost:  actual.ok ? actual.value! : null,
    overstatement: correctedCost > 0 ? round8(storedCost / correctedCost) : null,
    changed: Math.abs(storedCost - correctedCost) > 1e-8,
  };
}

/**
 * What regenerating this invoice would produce, and whether it may be done.
 */
export function restateInvoice(inv: InvoiceRow, snapshots: readonly SnapshotRow[]): InvoiceRestatement {
  const lines: LineRestatement[] = [];
  const linesBlocked: Array<{ snapshotId: number | null; reason: string }> = [];

  for (const s of snapshots) {
    const r = restateLine(s);
    if ('blocked' in r) {
      linesBlocked.push({ snapshotId: typeof s.id === 'number' ? s.id : null, reason: r.blocked });
      continue;
    }
    lines.push(r);
  }

  const storedTotal    = round8(lines.reduce((t, l) => t + l.storedCost, 0));
  const correctedTotal = round8(lines.reduce((t, l) => t + l.correctedCost, 0));

  const withActual = lines.filter(l => l.actualCost != null);
  const actualTotal = withActual.length ? round8(withActual.reduce((t, l) => t + l.actualCost!, 0)) : null;

  const ratio = (a: number, b: number | null) =>
    b != null && Math.abs(b) > 1e-9 ? Math.round((a / b) * 1e4) / 1e4 : null;

  const status = String(inv.status ?? 'unknown').toLowerCase();
  const changed = Math.abs(storedTotal - correctedTotal) > RESTATEMENT_TOLERANCE_USD;

  let eligibility: Eligibility;
  let reason: string;

  if (linesBlocked.length && !lines.length) {
    eligibility = 'blocked';
    reason = `None of the ${snapshots.length} snapshot line(s) could be re-rated. ` +
             `First reason: ${linesBlocked[0].reason}`;
  } else if (!changed) {
    eligibility = 'no_change';
    reason = lines.length
      ? `Already correct — ${lines.length} line(s) restate to $${correctedTotal.toFixed(5)}, ` +
        `the same figure the invoice carries.`
      : 'No snapshot lines to restate.';
  } else if (!REWRITABLE_STATUSES.has(status)) {
    eligibility = 'credit_note_required';
    reason = `Status is "${status}" — this document has been asserted to someone. ` +
             `It over-states by $${(storedTotal - correctedTotal).toFixed(5)}, but correcting a ` +
             `non-draft invoice is a credit note, not an edit. Regenerating in place would ` +
             `change a figure that has already been communicated and leave no record that it moved.`;
  } else {
    eligibility = 'regenerate';
    const agrees = correctedVsActualAgrees(correctedTotal, actualTotal);
    reason = `Draft. Restates from $${storedTotal.toFixed(5)} to $${correctedTotal.toFixed(5)} ` +
             `across ${lines.filter(l => l.changed).length} changed line(s)` +
             (actualTotal != null
               ? `, ${agrees
                    ? `landing on the switch's own $${actualTotal.toFixed(5)}`
                    : `against the switch's $${actualTotal.toFixed(5)} — WHICH IT DOES NOT MATCH, ` +
                      `so something beyond the units is wrong and regenerating would freeze a ` +
                      `second incorrect figure`}`
               : ', with no actual_cost on the lines to check it against') + '.';
  }

  if (linesBlocked.length && lines.length && eligibility !== 'blocked') {
    reason += ` ${linesBlocked.length} of ${snapshots.length} line(s) could not be re-rated and ` +
              `are excluded from these totals.`;
  }

  const invoiceNumber = inv.invoiceNumber == null ? null : String(inv.invoiceNumber);
  const agreesWithSwitch = actualTotal == null
    ? null
    : correctedVsActualAgrees(correctedTotal, actualTotal);

  return {
    invoiceId: inv.id,
    invoiceNumber,
    customerName:  inv.customerName  == null ? null : String(inv.customerName),
    status,
    period: `${inv.periodStart ?? '?'} → ${inv.periodEnd ?? '?'}`,

    lineCount:     snapshots.length,
    linesRestated: lines.length,
    linesChanged:  lines.filter(l => l.changed).length,
    linesBlocked,

    storedTotal, correctedTotal, actualTotal,
    actualCoverage: lines.length ? Math.round((withActual.length / lines.length) * 1e4) / 1e4 : 0,

    storedVsActual:    ratio(storedTotal,    actualTotal),
    correctedVsActual: ratio(correctedTotal, actualTotal),

    eligibility, reason,
    reduction: round8(storedTotal - correctedTotal),
    correctionImpact: impactOf({
      invoice: invoiceNumber, status, storedTotal, correctedTotal,
      eligibility, agreesWithSwitch,
    }),
  };
}

function impactOf(p: {
  invoice: string | null; status: string;
  storedTotal: number; correctedTotal: number;
  eligibility: Eligibility; agreesWithSwitch: boolean | null;
}): CorrectionImpact {
  const delta = round8(p.correctedTotal - p.storedTotal);
  const absDelta = Math.abs(delta);

  const usable = Math.abs(p.correctedTotal) > 1e-9;
  const relativeErrorPct = usable
    ? Math.round(((p.storedTotal / p.correctedTotal) - 1) * 1e4) / 1e2
    : null;
  const overstatementFactor = usable
    ? Math.round((p.storedTotal / p.correctedTotal) * 1e4) / 1e4
    : null;

  const materiality: Materiality =
    absDelta < MATERIALITY_MINOR_USD    ? 'none'  :
    absDelta < MATERIALITY_MAJOR_USD    ? 'minor' :
    absDelta < MATERIALITY_CRITICAL_USD ? 'major' : 'critical';

  // A restatement that does not land on the switch is not a correction anyone
  // should apply, whatever the invoice's status. Checked BEFORE eligibility,
  // because "it is only a draft" is not a reason to freeze a second bad number.
  if (p.eligibility !== 'no_change' && p.agreesWithSwitch === false) {
    return {
      invoice: p.invoice, status: p.status,
      previousTotal: p.storedTotal, correctedTotal: p.correctedTotal,
      delta, relativeErrorPct, overstatementFactor,
      action: 'investigate',
      actionReason:
        `The corrected total does not match what the switch charged. The units fix alone ` +
        `does not explain this invoice, and regenerating it would replace one wrong figure ` +
        `with another. Find the second cause first.`,
      agreesWithSwitch: p.agreesWithSwitch, materiality,
    };
  }

  const action: CorrectionAction =
    p.eligibility === 'no_change'            ? 'none' :
    p.eligibility === 'blocked'              ? 'investigate' :
    p.eligibility === 'credit_note_required' ? 'credit_note' : 'regenerate';

  const actionReason =
    action === 'none' ? 'No action required — the invoice already carries the correct figure.'
  : action === 'investigate'
      ? 'Cannot be assessed: the snapshot does not carry what re-rating needs.'
  : action === 'credit_note'
      ? `Over-stated by $${Math.abs(delta).toFixed(2)}, but status "${p.status}" means the ` +
        `document has been asserted. Issue a credit note or reissue; do not rewrite it.`
      : `Draft over-stated by $${Math.abs(delta).toFixed(2)}` +
        (overstatementFactor != null ? ` (${overstatementFactor.toFixed(1)}x)` : '') +
        `. Safe to regenerate` +
        (p.agreesWithSwitch ? ' — the corrected figure matches the switch.' : '.');

  return {
    invoice: p.invoice, status: p.status,
    previousTotal: p.storedTotal, correctedTotal: p.correctedTotal,
    delta, relativeErrorPct, overstatementFactor,
    action, actionReason,
    agreesWithSwitch: p.agreesWithSwitch, materiality,
  };
}

/** Within a cent, or within 0.5%, of the switch's figure. */
export function correctedVsActualAgrees(corrected: number, actual: number | null): boolean {
  if (actual == null) return false;
  const abs = Math.abs(corrected - actual);
  return abs <= 0.01 || (Math.abs(actual) > 0 && abs / Math.abs(actual) <= 0.005);
}

export interface RestatementSummary {
  invoices: number;
  regenerable: number;
  creditNoteRequired: number;
  noChange: number;
  blocked: number;
  /** Total money that would come off the regenerable drafts. */
  reductionOnDrafts: number;
  /** Total over-statement across every invoice, whatever its status. */
  reductionAll: number;
  /**
   * The work queue, by action. Counts and money together, because "3 invoices"
   * and "$9,882" are different arguments for doing something today.
   */
  byAction: Record<CorrectionAction, { invoices: number; delta: number }>;
  /** Counts by materiality, so a $0.01 fix is not queued beside a $9,882 one. */
  byMateriality: Record<Materiality, number>;
  /**
   * Invoices whose restatement does NOT reach the switch. Non-empty means the
   * units fix is not the whole story and this package should not be treated as
   * closing the rating question.
   */
  notReachingSwitch: string[];
  headline: string;
}

export function summariseRestatements(rs: readonly InvoiceRestatement[]): RestatementSummary {
  const by = (e: Eligibility) => rs.filter(r => r.eligibility === e);
  const regenerable = by('regenerate');
  const credit      = by('credit_note_required');

  const reductionOnDrafts = round8(regenerable.reduce((t, r) => t + r.reduction, 0));
  const reductionAll      = round8(rs.reduce((t, r) => t + r.reduction, 0));

  const byAction = {
    none:        { invoices: 0, delta: 0 },
    regenerate:  { invoices: 0, delta: 0 },
    credit_note: { invoices: 0, delta: 0 },
    investigate: { invoices: 0, delta: 0 },
  } as Record<CorrectionAction, { invoices: number; delta: number }>;

  const byMateriality = { none: 0, minor: 0, major: 0, critical: 0 } as Record<Materiality, number>;

  const notReachingSwitch: string[] = [];

  for (const r of rs) {
    const i = r.correctionImpact;
    byAction[i.action].invoices++;
    byAction[i.action].delta = round8(byAction[i.action].delta + i.delta);
    byMateriality[i.materiality]++;
    if (i.agreesWithSwitch === false) {
      notReachingSwitch.push(i.invoice ?? `#${r.invoiceId}`);
    }
  }

  const headline = rs.length === 0
    ? 'No invoices to assess.'
    : `${rs.length} invoice(s): ${regenerable.length} regenerable draft(s) worth ` +
      `$${reductionOnDrafts.toFixed(2)} of over-statement, ${credit.length} requiring a credit ` +
      `note, ${by('no_change').length} already correct, ${by('blocked').length} unassessable. ` +
      `Total over-statement $${reductionAll.toFixed(2)}.` +
      (notReachingSwitch.length
        ? ` ${notReachingSwitch.length} invoice(s) do NOT restate to the switch's figure ` +
          `(${notReachingSwitch.join(', ')}) — the units fix does not explain those, and they ` +
          `must be investigated before any regeneration.`
        : '');

  return {
    invoices: rs.length,
    regenerable: regenerable.length,
    creditNoteRequired: credit.length,
    noChange: by('no_change').length,
    blocked: by('blocked').length,
    reductionOnDrafts, reductionAll,
    byAction, byMateriality, notReachingSwitch,
    headline,
  };
}
