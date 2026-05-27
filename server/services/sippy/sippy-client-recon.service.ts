/**
 * sippy-client-recon.service.ts
 *
 * Client Revenue Reconciliation Engine
 *
 * Compares client-submitted billing data against:
 *   1. BitsAuto invoice (computed figures)
 *   2. DMR (Sippy-verified operational truth)
 *
 * Completes bilateral finance triangulation:
 *   Vendor ← BitsAuto → Customer
 *
 * Governance rule (IMMUTABLE):
 *   Append-only. Recalculation creates a new version row (parentId → previous).
 *   Historical reconciliation records are never silently mutated.
 *
 * Comparison hierarchy:
 *   Client says: X minutes at $Y
 *   BitsAuto invoice says: X' minutes at $Y'  ← primary comparison target
 *   DMR says: X'' minutes at $Y''             ← neutral Sippy arbiter
 *
 *   If BitsAuto ≈ DMR but Client disagrees → client-side data issue
 *   If BitsAuto ≠ DMR → calculation error on our side → fix invoice first
 *   If all three disagree → billing dispute → escalate
 */

import { storage } from '../../storage';
import type {
  InsertClientRevenueReconciliation,
  ClientRevenueReconciliation,
} from '@shared/schema';

// ── Tolerance model (consistent with DMR) ─────────────────────────────────────
const EXACT_MATCH_THRESHOLD_PCT = 0.02;   // 2%
const LOW_THRESHOLD_PCT         = 0.05;   // 5%
const MEDIUM_THRESHOLD_PCT      = 0.10;   // 10%
const HIGH_THRESHOLD_PCT        = 0.20;   // 20%
const CRITICAL_AMOUNT_USD       = 50.00;  // absolute: >$50 delta = critical

// ── Helpers ───────────────────────────────────────────────────────────────────

function pct(client: number, bitsauto: number): number {
  if (bitsauto === 0) return client === 0 ? 0 : 100;
  return Math.abs(client - bitsauto) / bitsauto;
}

type DiscrepancyType = 'exact_match' | 'duration_drift' | 'amount_drift' | 'both_drift' | 'no_client_data' | 'no_bitsauto_data';
type Severity = 'clean' | 'low' | 'medium' | 'high' | 'critical';

function classify(
  clientDur: number | null,
  baDur: number | null,
  clientAmt: number | null,
  baAmt: number | null,
): { type: DiscrepancyType; severity: Severity } {
  if (clientDur == null && clientAmt == null) return { type: 'no_client_data', severity: 'low' };
  if (baDur == null && baAmt == null)         return { type: 'no_bitsauto_data', severity: 'high' };

  const cd = clientDur ?? 0;
  const bd = baDur ?? 0;
  const ca = clientAmt ?? 0;
  const ba = baAmt ?? 0;

  const durPct = pct(cd, bd);
  const amtPct = pct(ca, ba);
  const amtDelta = Math.abs(ca - ba);

  let type: DiscrepancyType;
  if (durPct <= EXACT_MATCH_THRESHOLD_PCT && amtPct <= EXACT_MATCH_THRESHOLD_PCT) {
    type = 'exact_match';
  } else if (durPct > EXACT_MATCH_THRESHOLD_PCT && amtPct <= EXACT_MATCH_THRESHOLD_PCT) {
    type = 'duration_drift';
  } else if (durPct <= EXACT_MATCH_THRESHOLD_PCT && amtPct > EXACT_MATCH_THRESHOLD_PCT) {
    type = 'amount_drift';
  } else {
    type = 'both_drift';
  }

  if (type === 'exact_match') return { type, severity: 'clean' };

  // Severity from amount delta
  let severity: Severity;
  if (amtDelta >= CRITICAL_AMOUNT_USD || amtPct >= HIGH_THRESHOLD_PCT) {
    severity = 'critical';
  } else if (amtPct >= MEDIUM_THRESHOLD_PCT) {
    severity = 'high';
  } else if (amtPct >= LOW_THRESHOLD_PCT) {
    severity = 'medium';
  } else {
    severity = 'low';
  }

  return { type, severity };
}

// ── Import payload (from API or CSV) ─────────────────────────────────────────

export interface ClientBillingImport {
  billingPeriod:    string;   // YYYY-MM
  clientAccountId?: string;
  clientName:       string;
  durationMinutes:  number;   // client reports in minutes; we convert to seconds
  amountUsd:        number;
  calls?:           number;
  notes?:           string;
  source?:          'manual' | 'csv' | 'api';
  invoiceId?:       number;
}

// ── Core operations ───────────────────────────────────────────────────────────

/**
 * Import client billing data and run reconciliation comparison.
 * Looks up BitsAuto invoice + DMR aggregates for the period automatically.
 * Appends new row — never overwrites existing records.
 */
export async function importAndReconcile(
  payload: ClientBillingImport,
  importedBy?: string,
): Promise<ClientRevenueReconciliation> {
  const { billingPeriod, clientAccountId, clientName } = payload;

  const clientDurSec = payload.durationMinutes * 60;
  const clientAmt    = payload.amountUsd;
  const clientCalls  = payload.calls ?? null;

  // ── Pull BitsAuto invoice figures ────────────────────────────────────────
  let baDurSec: number | null = null;
  let baAmt:    number | null = null;
  let baCalls:  number | null = null;
  let invoiceId = payload.invoiceId ?? null;

  try {
    const invoices = await storage.listInvoices?.({
      accountId: clientAccountId,
      period:    billingPeriod,
    });
    const inv = invoices?.[0];
    if (inv) {
      baDurSec  = inv.totalDurationSec ?? null;
      baAmt     = inv.totalAmountUsd   ?? null;
      baCalls   = inv.totalCalls       ?? null;
      invoiceId = invoiceId ?? inv.id;
    }
  } catch { /* invoice lookup is best-effort */ }

  // ── Pull DMR aggregate for this client/period ────────────────────────────
  let dmrDurSec: number | null = null;
  let dmrAmt:    number | null = null;

  try {
    const [yearStr, monthStr] = billingPeriod.split('-');
    const year  = parseInt(yearStr,  10);
    const month = parseInt(monthStr, 10);
    const fromDate = `${billingPeriod}-01`;
    const lastDay  = new Date(year, month, 0).getDate();
    const toDate   = `${billingPeriod}-${String(lastDay).padStart(2, '0')}`;

    const dmrRows = await storage.listDMRReports({
      fromDate, toDate,
      latestVersionOnly: true,
    });

    const clientRows = dmrRows.filter(r =>
      r.accountName !== '__AGGREGATE__' &&
      (clientAccountId
        ? (r.accountId === clientAccountId || r.accountName === clientName)
        : r.accountName === clientName)
    );

    if (clientRows.length > 0) {
      dmrDurSec = clientRows.reduce((s, r) => s + (r.sippyDuration ?? 0), 0);
      dmrAmt    = clientRows.reduce((s, r) => s + (r.sippyAmount ?? 0), 0);
    }
  } catch { /* DMR lookup is best-effort */ }

  // ── Classify ──────────────────────────────────────────────────────────────
  const { type, severity } = classify(clientDurSec, baDurSec, clientAmt, baAmt);

  const deltaDur = clientDurSec != null && baDurSec != null ? clientDurSec - baDurSec : null;
  const deltaAmt = clientAmt != null && baAmt != null ? clientAmt - baAmt : null;
  const deltaPct = baAmt != null && baAmt !== 0 && deltaAmt != null
    ? (deltaAmt / baAmt) * 100
    : null;

  // ── Determine version ─────────────────────────────────────────────────────
  const existing = await storage.listClientReconciliations({
    billingPeriod,
    clientAccountId: clientAccountId ?? clientName,
  });
  const maxVer = existing.reduce((m, r) => Math.max(m, r.version), 0);
  const version = maxVer + 1;
  const parentId = existing.find(r => r.version === maxVer)?.id ?? null;

  const row: InsertClientRevenueReconciliation = {
    billingPeriod,
    version,
    parentId,
    clientAccountId: clientAccountId ?? null,
    clientName,
    clientDurationSec: clientDurSec,
    clientAmountUsd:   clientAmt,
    clientCalls,
    bitsautoDurationSec: baDurSec,
    bitsautoAmountUsd:   baAmt,
    bitsautoCalls:       baCalls,
    dmrDurationSec:  dmrDurSec,
    dmrAmountUsd:    dmrAmt,
    deltaDurationSec: deltaDur,
    deltaAmountUsd:   deltaAmt,
    deltaPct,
    discrepancyType: type,
    severity,
    status:          type === 'exact_match' ? 'reconciled' : 'pending',
    invoiceId,
    source:          payload.source ?? 'manual',
    rawImport:       payload as any,
    notes:           payload.notes ?? null,
    reviewedBy:      importedBy ?? null,
  };

  return storage.createClientReconciliation(row);
}

/**
 * Re-run reconciliation for an existing record using latest BitsAuto + DMR data.
 * Creates a new version row — never mutates history.
 */
export async function recalculateReconciliation(
  id: number,
  recalculatedBy?: string,
): Promise<ClientRevenueReconciliation> {
  const existing = await storage.getClientReconciliation(id);
  if (!existing) throw new Error(`Reconciliation #${id} not found`);

  const durationMinutes = (existing.clientDurationSec ?? 0) / 60;

  return importAndReconcile(
    {
      billingPeriod:   existing.billingPeriod,
      clientAccountId: existing.clientAccountId ?? undefined,
      clientName:      existing.clientName,
      durationMinutes,
      amountUsd:       existing.clientAmountUsd ?? 0,
      calls:           existing.clientCalls ?? undefined,
      notes:           existing.notes ?? undefined,
      source:          existing.source as any,
    },
    recalculatedBy ?? 'system',
  );
}

/**
 * Summary stats for a billing period — for trend and dashboard KPIs.
 */
export async function getReconciliationSummary(period?: string): Promise<{
  total:       number;
  clean:       number;
  low:         number;
  medium:      number;
  high:        number;
  critical:    number;
  reconciled:  number;
  pending:     number;
  disputed:    number;
}> {
  const opts: any = {};
  if (period) opts.billingPeriod = period;
  const rows = await storage.listClientReconciliations({ ...opts, latestVersionOnly: true });

  return {
    total:      rows.length,
    clean:      rows.filter(r => r.severity === 'clean').length,
    low:        rows.filter(r => r.severity === 'low').length,
    medium:     rows.filter(r => r.severity === 'medium').length,
    high:       rows.filter(r => r.severity === 'high').length,
    critical:   rows.filter(r => r.severity === 'critical').length,
    reconciled: rows.filter(r => r.status === 'reconciled' || r.status === 'approved').length,
    pending:    rows.filter(r => r.status === 'pending').length,
    disputed:   rows.filter(r => r.status === 'disputed').length,
  };
}
