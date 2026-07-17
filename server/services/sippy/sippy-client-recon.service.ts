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
import { db } from '../../db';
import { invoices } from '@shared/schema';
import { like } from 'drizzle-orm';
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
 * Auto-populate client_revenue_reconciliations from internal invoice + DMR data.
 *
 * Runs before scheduled report delivery so the PDF always contains data even
 * when no client has submitted billing figures via importAndReconcile().
 *
 * For each invoice in the billing period we create one reconciliation row:
 *   - bitsauto* columns  = invoice figures (what we billed)
 *   - dmr*       columns = Sippy-verified aggregate for that client/period
 *   - client*    columns = null (marked 'no_client_data' — client hasn't submitted)
 *
 * Append-only: skips clients that already have a record for the period.
 * When a client later submits via importAndReconcile(), a new version row is
 * created on top of this auto-generated baseline.
 */
export async function autoReconcileFromInvoices(billingPeriod: string): Promise<{
  created: number;
  skipped: number;
  errors:  string[];
}> {
  // Fetch all invoices whose periodStart falls in the target YYYY-MM
  const periodInvs = await db
    .select()
    .from(invoices)
    .where(like(invoices.periodStart, `${billingPeriod}%`));

  // Also fetch invoices created in this month without a periodStart (fallback)
  // so we don't miss invoices generated by Sippy-side flows
  const createdInvs = await db
    .select()
    .from(invoices)
    .where(like(invoices.createdAt as any, `${billingPeriod}%`));

  // Deduplicate by id
  const invMap = new Map<number, typeof periodInvs[number]>();
  for (const inv of [...periodInvs, ...createdInvs]) invMap.set(inv.id, inv);
  const allInvs = Array.from(invMap.values());

  if (allInvs.length === 0) {
    return { created: 0, skipped: 0, errors: [`No invoices found for period ${billingPeriod}`] };
  }

  // Build DMR aggregate for the full month, keyed by accountName (lower-case)
  const [yearStr, monthStr] = billingPeriod.split('-');
  const year  = parseInt(yearStr,  10);
  const month = parseInt(monthStr, 10);
  const fromDate = `${billingPeriod}-01`;
  const lastDay  = new Date(year, month, 0).getDate();
  const toDate   = `${billingPeriod}-${String(lastDay).padStart(2, '0')}`;

  const dmrRows = await storage.listDMRReports({ fromDate, toDate, latestVersionOnly: true });
  const dmrByAccount = new Map<string, { durationSec: number; amount: number }>();
  for (const row of dmrRows) {
    if (!row.accountName || row.accountName === '__AGGREGATE__') continue;
    const key = row.accountName.toLowerCase().trim();
    const ex  = dmrByAccount.get(key) ?? { durationSec: 0, amount: 0 };
    dmrByAccount.set(key, {
      durationSec: ex.durationSec + (row.sippyDuration ?? 0),
      amount:      ex.amount      + (row.sippyAmount   ?? 0),
    });
  }

  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  // ── Group invoices by client so multiple invoices for the same client in the
  //    same period are aggregated into ONE reconciliation row, not N rows where
  //    only the first is kept and the rest are silently skipped.
  type ClientGroup = {
    clientName:      string;
    clientAccountId: string | null;
    invoiceIds:      number[];
    invoiceNumbers:  (string | null)[];
    totalAmt:        number;
    totalCalls:      number;
  };

  const clientMap = new Map<string, ClientGroup>();
  for (const inv of allInvs) {
    const clientName      = inv.customerName ?? `Invoice#${inv.id}`;
    const clientAccountId = inv.iTariff       ?? null;
    // Stable key: prefer iTariff (account ID) so name variants don't split
    const key = (clientAccountId ?? clientName).toLowerCase().trim();

    const grp = clientMap.get(key);
    if (grp) {
      grp.invoiceIds.push(inv.id);
      grp.invoiceNumbers.push(inv.invoiceNumber ?? null);
      grp.totalAmt   += inv.totalReproduced ?? 0;
      grp.totalCalls += inv.lineCount       ?? 0;
    } else {
      clientMap.set(key, {
        clientName,
        clientAccountId,
        invoiceIds:     [inv.id],
        invoiceNumbers: [inv.invoiceNumber ?? null],
        totalAmt:       inv.totalReproduced ?? 0,
        totalCalls:     inv.lineCount       ?? 0,
      });
    }
  }

  for (const [, group] of clientMap) {
    try {
      // Skip if a reconciliation record already exists for this client+period
      const existing = await storage.listClientReconciliations({
        billingPeriod,
        clientAccountId: group.clientAccountId ?? group.clientName,
      });
      if (existing.length > 0) { skipped++; continue; }

      // Aggregate line items across ALL invoices for this client
      let baDurSec = 0;
      for (const invId of group.invoiceIds) {
        const lineItems = await storage.listInvoiceLineItems(invId);
        baDurSec += lineItems.reduce((s, li) => s + (li.durationSecs ?? 0), 0);
      }
      const baAmt   = group.totalAmt   > 0 ? group.totalAmt   : null;
      const baCalls = group.totalCalls > 0 ? group.totalCalls : null;

      // DMR Sippy-verified figures for this client
      const dmrKey    = group.clientName.toLowerCase().trim();
      const dmrData   = dmrByAccount.get(dmrKey);
      const dmrDurSec = dmrData?.durationSec ?? null;
      const dmrAmt    = dmrData?.amount      ?? null;

      const invNotes = group.invoiceNumbers.filter(Boolean).join(', ');
      const notesStr = group.invoiceIds.length > 1
        ? `Auto-generated from ${group.invoiceIds.length} invoices (${invNotes}) for period ${billingPeriod}`
        : `Auto-generated from Invoice #${invNotes} for period ${billingPeriod}`;

      const row: InsertClientRevenueReconciliation = {
        billingPeriod,
        version:  1,
        parentId: null,
        clientAccountId: group.clientAccountId,
        clientName:      group.clientName,
        // No client submission yet
        clientDurationSec: null,
        clientAmountUsd:   null,
        clientCalls:       null,
        // BitsAuto invoice figures (aggregated across all invoices for the period)
        bitsautoDurationSec: baDurSec > 0 ? baDurSec : null,
        bitsautoAmountUsd:   baAmt,
        bitsautoCalls:       baCalls,
        // Sippy-verified DMR figures
        dmrDurationSec: dmrDurSec,
        dmrAmountUsd:   dmrAmt,
        // No client→BitsAuto delta (client data absent)
        deltaDurationSec: null,
        deltaAmountUsd:   null,
        deltaPct:         null,
        discrepancyType:  'no_client_data',
        severity:         'low',
        status:           'pending',
        invoiceId:        group.invoiceIds[0],  // primary invoice reference
        source:           'auto',
        rawImport:        null,
        notes:            notesStr,
        reviewedBy:       'system',
      };

      await storage.createClientReconciliation(row);
      created++;
    } catch (err: any) {
      errors.push(`Client ${group.clientName}: ${err.message}`);
    }
  }

  return { created, skipped, errors };
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
