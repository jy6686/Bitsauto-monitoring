/**
 * sippy-reconciliation.service.ts
 *
 * Layer 5C — Carrier Invoice Reconciliation
 *
 * DEPLOYMENT MODE: Shadow verification only on first deploy.
 *   - Detect discrepancies
 *   - Produce intelligence
 *   - NO automatic accounting actions
 *   - NO finance mutations
 *
 * Compares four sources:
 *   1. Carrier Invoice Total    — manually entered vendor bill
 *   2. Sippy Actual Total       — what Sippy recorded (CDR cache)
 *   3. BitsAuto Reproduced Total — rating verification records
 *   4. Immutable Snapshot Total — invoice_cdr_snapshots (ground truth)
 *
 * This becomes the foundation for 5C dispute defense and revenue assurance.
 */

import { storage } from '../../storage';
import type { CarrierReconciliation, InsertCarrierReconciliation } from '@shared/schema';
import { matchCdr, type CdrRecord } from '../billing/cdr-match';

// ── Discrepancy classification ─────────────────────────────────────────────────

export type ReconciliationDiscrepancyType =
  | 'exact_match'
  | 'overbilled_by_carrier'
  | 'underbilled_by_carrier'
  | 'sippy_vs_reproduced_drift'
  | 'large_discrepancy'
  | 'missing_snapshots';

export interface ReconciliationAnalysis {
  carrierTotal:             number | null;
  sippyTotal:               number | null;
  reproducedTotal:          number | null;
  snapshotTotal:            number | null;
  deltaCarrierVsReproduced: number | null;
  deltaCarrierVsSippy:      number | null;
  deltaSippyVsReproduced:   number | null;
  discrepancyType:          ReconciliationDiscrepancyType;
  severity:                 'none' | 'minor' | 'major' | 'critical';
  snapshotCount:            number;
  recommendations:          string[];
}

const MINOR_THRESHOLD    = 0.5;    // $0.50
const MAJOR_THRESHOLD    = 5.0;    // $5.00
const CRITICAL_THRESHOLD = 50.0;   // $50.00

function classifySeverity(absDelta: number): 'none' | 'minor' | 'major' | 'critical' {
  if (absDelta < MINOR_THRESHOLD)    return 'none';
  if (absDelta < MAJOR_THRESHOLD)    return 'minor';
  if (absDelta < CRITICAL_THRESHOLD) return 'major';
  return 'critical';
}

// ── Core reconciliation logic ─────────────────────────────────────────────────

/**
 * Run a reconciliation between a carrier invoice and BitsAuto's economics.
 * Shadow mode: analysis only, no accounting actions.
 */
export async function runReconciliation(opts: {
  carrierName:    string;
  iTariff?:       string;
  invoiceRef?:    string;
  invoiceDate?:   string;
  periodStart:    string;
  periodEnd:      string;
  carrierTotal:   number;
  notes?:         string;
}): Promise<{ reconciliation: CarrierReconciliation; analysis: ReconciliationAnalysis }> {

  // 1. Get immutable snapshot totals (ground truth from 4C)
  const snapshots = await storage.listInvoiceCdrSnapshots({
    iTariff: opts.iTariff,
    limit:   100000,
  });

  const inPeriod = snapshots.filter(s => {
    if (!s.cdrStartTime) return false;
    return s.cdrStartTime >= opts.periodStart && s.cdrStartTime <= opts.periodEnd;
  });

  let snapshotTotal    = 0;
  let reproducedTotal  = 0;
  let sippyTotal       = 0;

  for (const s of inPeriod) {
    snapshotTotal   += s.reproducedCost ?? 0;
    reproducedTotal += s.reproducedCost ?? 0;
    sippyTotal      += s.actualCost ?? 0;
  }

  snapshotTotal   = +snapshotTotal.toFixed(6);
  reproducedTotal = +reproducedTotal.toFixed(6);
  sippyTotal      = +sippyTotal.toFixed(6);

  // 2. Compute deltas
  const deltaCarrierVsReproduced = +(opts.carrierTotal - reproducedTotal).toFixed(6);
  const deltaCarrierVsSippy      = +(opts.carrierTotal - sippyTotal).toFixed(6);
  const deltaSippyVsReproduced   = +(sippyTotal - reproducedTotal).toFixed(6);

  const absDelta = Math.abs(deltaCarrierVsReproduced);

  // 3. Classify discrepancy type
  let discrepancyType: ReconciliationDiscrepancyType;
  if (inPeriod.length === 0) {
    discrepancyType = 'missing_snapshots';
  } else if (absDelta < 0.0001) {
    discrepancyType = 'exact_match';
  } else if (Math.abs(deltaSippyVsReproduced) > 0.01 && absDelta > MINOR_THRESHOLD) {
    discrepancyType = 'sippy_vs_reproduced_drift';
  } else if (deltaCarrierVsReproduced > CRITICAL_THRESHOLD) {
    discrepancyType = 'large_discrepancy';
  } else if (deltaCarrierVsReproduced > 0) {
    discrepancyType = 'overbilled_by_carrier';
  } else {
    discrepancyType = 'underbilled_by_carrier';
  }

  // 4. Build recommendations (intelligence, not actions)
  const recommendations: string[] = [];

  if (discrepancyType === 'missing_snapshots') {
    recommendations.push('No locked snapshots found for this period. Run Rating Verification + Lock Batch before reconciliation.');
  }
  if (discrepancyType === 'overbilled_by_carrier' || discrepancyType === 'large_discrepancy') {
    recommendations.push(`Carrier billed $${absDelta.toFixed(4)} more than BitsAuto reproduced. Investigate interval or rate discrepancy.`);
  }
  if (discrepancyType === 'underbilled_by_carrier') {
    recommendations.push(`Carrier billed $${absDelta.toFixed(4)} less than BitsAuto reproduced. May indicate missing CDRs in carrier invoice.`);
  }
  if (discrepancyType === 'sippy_vs_reproduced_drift') {
    recommendations.push(`Sippy vs BitsAuto reproduced drift: $${Math.abs(deltaSippyVsReproduced).toFixed(4)}. Run full rating verification to identify interval mismatches.`);
  }
  if (Math.abs(deltaCarrierVsSippy) > MAJOR_THRESHOLD && Math.abs(deltaCarrierVsReproduced) <= MINOR_THRESHOLD) {
    recommendations.push('Carrier and BitsAuto agree but Sippy shows drift — possible Sippy rounding or billing interval difference.');
  }

  // 5. Persist reconciliation record
  const data: InsertCarrierReconciliation = {
    carrierName:              opts.carrierName,
    iTariff:                  opts.iTariff,
    invoiceRef:               opts.invoiceRef,
    invoiceDate:              opts.invoiceDate,
    periodStart:              opts.periodStart,
    periodEnd:                opts.periodEnd,
    carrierTotal:             opts.carrierTotal,
    sippyTotal,
    reproducedTotal,
    snapshotTotal,
    deltaCarrierVsReproduced,
    deltaCarrierVsSippy,
    discrepancyCount:         inPeriod.filter(s => Math.abs(s.delta ?? 0) > 0.0001).length,
    status:                   'shadow',
    notes:                    opts.notes,
  };

  const reconciliation = await storage.createCarrierReconciliation(data);

  const analysis: ReconciliationAnalysis = {
    carrierTotal:             opts.carrierTotal,
    sippyTotal,
    reproducedTotal,
    snapshotTotal,
    deltaCarrierVsReproduced,
    deltaCarrierVsSippy,
    deltaSippyVsReproduced,
    discrepancyType,
    severity:                 classifySeverity(absDelta),
    snapshotCount:            inPeriod.length,
    recommendations,
  };

  return { reconciliation, analysis };
}

// ── Per-row CDR reconciliation (T1·ID matching) ───────────────────────────────
// Matches each snapshot row against a CDR pool using the 3-tier shared utility.
// Returns matched/unmatched/disputed rows — far more actionable than totals-only.

export interface RowReconResult {
  snapshotId:      number;
  cdrCallId?:      string;
  tier:            0 | 1 | 2 | 3;
  matched:         boolean;
  sippyCost?:      number | null;
  reproducedCost?: number | null;
  costDelta?:      number | null;
  status:          'matched' | 'unmatched' | 'cost_drift' | 'missing_cdr';
}

export function reconcilePerRow(
  snapshots: Array<{
    id: number; cdrId?: string | null; cdrStartTime?: string | null;
    reproducedCost?: number | null; actualCost?: number | null;
    callee?: string | null; caller?: string | null;
  }>,
  cdrPool: CdrRecord[],
  opts: { windowMs?: number } = {},
): RowReconResult[] {
  const results: RowReconResult[] = [];

  for (const snap of snapshots) {
    const startMs = snap.cdrStartTime
      ? new Date(snap.cdrStartTime).getTime()
      : undefined;

    const { matched, tier } = matchCdr(cdrPool, {
      callId:  snap.cdrId  ?? undefined,
      cld:     snap.callee ?? undefined,
      cli:     snap.caller ?? undefined,
      startMs,
      windowMs: opts.windowMs,
    });

    let status: RowReconResult['status'] = 'unmatched';
    let costDelta: number | null = null;

    if (matched) {
      const cdrCost    = Number(matched.cost ?? matched.actualCost ?? 0);
      const reproduced = snap.reproducedCost ?? 0;
      costDelta = +(cdrCost - reproduced).toFixed(6);
      status = Math.abs(costDelta) > 0.0001 ? 'cost_drift' : 'matched';
    } else if (!snap.cdrId) {
      status = 'missing_cdr';
    }

    results.push({
      snapshotId:      snap.id,
      cdrCallId:       snap.cdrId ?? undefined,
      tier:            tier as 0 | 1 | 2 | 3,
      matched:         !!matched,
      sippyCost:       snap.actualCost,
      reproducedCost:  snap.reproducedCost,
      costDelta,
      status,
    });
  }

  return results;
}

export async function updateReconciliationStatus(
  id:     number,
  status: string,
  notes?: string,
): Promise<CarrierReconciliation> {
  return storage.updateCarrierReconciliation(id, { status, notes: notes ?? undefined });
}

export async function listReconciliations(opts: {
  iTariff?: string;
  status?:  string;
  limit?:   number;
} = {}): Promise<CarrierReconciliation[]> {
  return storage.listCarrierReconciliations(opts);
}
