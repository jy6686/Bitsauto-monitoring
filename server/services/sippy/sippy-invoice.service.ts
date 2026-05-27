/**
 * sippy-invoice.service.ts
 *
 * Layer 5B — Invoice Engine
 *
 * CRITICAL CONSTRAINT:
 *   Invoices MUST source data from invoice_cdr_snapshots ONLY.
 *   NEVER from live tariffs or live CDR cache.
 *   This is what makes invoices financially reproducible.
 *
 * Deployment flow (MANDATORY on first deploy):
 *   draft → review → approved → sent
 *
 *   Do NOT implement auto-send. Human approval is required.
 *
 * All functions are queue-safe. No global state.
 */

import { storage } from '../../storage';
import type {
  Invoice, InsertInvoice,
  InvoiceLineItem, InsertInvoiceLineItem,
  InvoiceCdrSnapshot,
} from '@shared/schema';

// ── Invoice number generation ─────────────────────────────────────────────────

function generateInvoiceNumber(year: number, month: number, seq: number): string {
  const mm = String(month).padStart(2, '0');
  const nn = String(seq).padStart(4, '0');
  return `INV-${year}${mm}-${nn}`;
}

// ── HTML invoice generation ───────────────────────────────────────────────────

function fmt(n: number, decimals = 6): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtDur(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function generateInvoiceHtml(opts: {
  invoice:       Invoice;
  lineItems:     InvoiceLineItem[];
  customerName:  string;
  periodLabel:   string;
}): string {
  const { invoice, lineItems } = opts;
  const rows = lineItems.slice(0, 200).map(li => `
    <tr>
      <td style="padding:7px 12px;font-family:monospace;font-size:12px;">${li.cdrCallId ?? '—'}</td>
      <td style="padding:7px 12px;font-family:monospace;">${li.prefix ?? '—'}</td>
      <td style="padding:7px 12px;text-align:right;">${li.durationSecs != null ? fmtDur(li.durationSecs) : '—'}</td>
      <td style="padding:7px 12px;text-align:right;font-family:monospace;">$${fmt(li.reproducedCost ?? 0)}</td>
      <td style="padding:7px 12px;text-align:right;font-family:monospace;">${li.delta != null ? (li.delta >= 0 ? '+' : '') + fmt(li.delta) : '—'}</td>
    </tr>`).join('');

  const moreRows = lineItems.length > 200
    ? `<tr><td colspan="5" style="padding:10px 12px;text-align:center;color:#9ca3af;font-style:italic;">… ${lineItems.length - 200} additional line items not shown</td></tr>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Invoice ${invoice.invoiceNumber}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 40px; color: #111827; background: white; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; }
  .brand h1 { margin: 0; font-size: 24px; font-weight: 800; color: #1e1b4b; }
  .brand p  { margin: 4px 0 0; font-size: 13px; color: #6b7280; }
  .inv-meta { text-align: right; }
  .inv-meta .inv-number { font-size: 22px; font-weight: 700; color: #374151; }
  .inv-meta .inv-date   { font-size: 13px; color: #6b7280; }
  .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 32px; }
  .meta-box { border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; }
  .meta-box .label { font-size: 11px; font-weight: 600; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }
  .meta-box .value { font-size: 14px; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 24px; }
  thead tr { background: #f9fafb; }
  thead th { padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.04em; border-bottom: 2px solid #e5e7eb; }
  tbody tr:nth-child(even) { background: #fafafa; }
  tbody td { border-bottom: 1px solid #f3f4f6; }
  .totals { border-top: 2px solid #e5e7eb; padding-top: 16px; text-align: right; }
  .totals .row { display: flex; justify-content: flex-end; gap: 32px; font-size: 14px; margin-bottom: 6px; }
  .totals .total-row { font-weight: 700; font-size: 18px; color: #1e1b4b; }
  .notice { margin-top: 32px; padding: 16px; background: #fef3c7; border: 1px solid #fde68a; border-radius: 8px; font-size: 12px; color: #92400e; }
  .status-badge { display: inline-block; padding: 4px 12px; border-radius: 9999px; font-size: 12px; font-weight: 600; }
  .status-draft    { background: #f3f4f6; color: #374151; }
  .status-review   { background: #dbeafe; color: #1d4ed8; }
  .status-approved { background: #d1fae5; color: #065f46; }
  .status-sent     { background: #dcfce7; color: #15803d; }
  @media print { body { padding: 20px; } }
</style>
</head>
<body>

<div class="header">
  <div class="brand">
    <h1>BitsAuto Platform</h1>
    <p>Telecom Revenue Assurance Infrastructure</p>
  </div>
  <div class="inv-meta">
    <div class="inv-number">${invoice.invoiceNumber}</div>
    <div class="inv-date">Generated: ${new Date(invoice.generatedAt ?? Date.now()).toLocaleDateString()}</div>
    <div style="margin-top:6px;">
      <span class="status-badge status-${invoice.status}">${invoice.status.toUpperCase()}</span>
    </div>
  </div>
</div>

<div class="meta-grid">
  <div class="meta-box">
    <div class="label">Bill To</div>
    <div class="value">${opts.customerName}</div>
  </div>
  <div class="meta-box">
    <div class="label">Billing Period</div>
    <div class="value">${opts.periodLabel}</div>
    <div style="font-size:12px;color:#6b7280;margin-top:4px;">${invoice.periodStart} → ${invoice.periodEnd}</div>
  </div>
  <div class="meta-box">
    <div class="label">Tariff</div>
    <div class="value">${invoice.iTariff ?? '—'}</div>
  </div>
  <div class="meta-box">
    <div class="label">Line Items</div>
    <div class="value">${invoice.lineCount?.toLocaleString() ?? lineItems.length.toLocaleString()} CDRs</div>
  </div>
</div>

<table>
  <thead>
    <tr>
      <th>Call ID</th>
      <th>Prefix</th>
      <th style="text-align:right;">Duration</th>
      <th style="text-align:right;">Reproduced Cost</th>
      <th style="text-align:right;">Delta</th>
    </tr>
  </thead>
  <tbody>
    ${rows}
    ${moreRows}
  </tbody>
</table>

<div class="totals">
  <div class="row"><span style="color:#6b7280;">Subtotal (Reproduced)</span><span style="font-family:monospace;">$${fmt(invoice.totalReproduced ?? 0, 4)}</span></div>
  ${invoice.totalActual != null ? `<div class="row"><span style="color:#6b7280;">Sippy Actual</span><span style="font-family:monospace;">$${fmt(invoice.totalActual, 4)}</span></div>` : ''}
  ${invoice.totalDelta != null ? `<div class="row"><span style="color:#6b7280;">Delta</span><span style="font-family:monospace;color:${Math.abs(invoice.totalDelta) > 0.01 ? '#dc2626' : '#16a34a'};">$${fmt(invoice.totalDelta, 4)}</span></div>` : ''}
  <div class="row total-row"><span>Total Due</span><span style="font-family:monospace;">$${fmt(invoice.totalReproduced ?? 0, 4)}</span></div>
</div>

${invoice.notes ? `<div style="margin-top:24px;font-size:13px;color:#6b7280;"><strong>Notes:</strong> ${invoice.notes}</div>` : ''}

<div class="notice">
  <strong>Important:</strong> This invoice is generated from immutable telecom rating snapshots.
  All costs reflect independently reproduced BitsAuto billing calculations based on historical tariff versions.
  This is a <strong>${invoice.status === 'draft' ? 'DRAFT — NOT APPROVED FOR PAYMENT' : invoice.status === 'review' ? 'REVIEW COPY — PENDING APPROVAL' : 'FINAL'}</strong> invoice.
</div>

</body>
</html>`;
}

// ── Core invoice operations ───────────────────────────────────────────────────

/**
 * Generate an invoice from immutable rating snapshots.
 * Sources ONLY from invoice_cdr_snapshots — never live tariffs.
 */
export async function generateInvoice(opts: {
  iTariff:      string;
  periodStart:  string;
  periodEnd:    string;
  customerName: string;
  notes?:       string;
}): Promise<{ invoice: Invoice; lineCount: number }> {
  const snapshots = await storage.listInvoiceCdrSnapshots({
    iTariff: opts.iTariff,
    limit:   50000,
  });

  // Filter to period
  const inPeriod = snapshots.filter(s => {
    if (!s.cdrStartTime) return true;
    const d = s.cdrStartTime;
    return d >= opts.periodStart && d <= opts.periodEnd;
  });

  if (inPeriod.length === 0) {
    throw new Error(
      `No locked snapshots for tariff ${opts.iTariff} in period ${opts.periodStart}–${opts.periodEnd}. ` +
      'Run Rating Verification + Lock Batch first.'
    );
  }

  let totalReproduced = 0;
  let totalActual     = 0;
  let totalDelta      = 0;

  for (const s of inPeriod) {
    totalReproduced += s.reproducedCost ?? 0;
    totalActual     += s.actualCost ?? 0;
    totalDelta      += s.delta ?? 0;
  }

  // Generate invoice number
  const d   = new Date();
  const seq = await storage.countInvoices() + 1;
  const invoiceNumber = generateInvoiceNumber(d.getUTCFullYear(), d.getUTCMonth() + 1, seq);

  const invoiceData: InsertInvoice = {
    invoiceNumber,
    iTariff:         opts.iTariff,
    customerName:    opts.customerName,
    periodStart:     opts.periodStart,
    periodEnd:       opts.periodEnd,
    totalReproduced: +totalReproduced.toFixed(6),
    totalActual:     +totalActual.toFixed(6),
    totalDelta:      +totalDelta.toFixed(6),
    lineCount:       inPeriod.length,
    status:          'draft',
    notes:           opts.notes,
    generatedAt:     new Date(),
  };

  const invoice = await storage.createInvoice(invoiceData);

  // Insert line items in batches
  const lineItemBatch: InsertInvoiceLineItem[] = inPeriod.map(s => ({
    invoiceId:      invoice.id,
    snapshotId:     s.id,
    cdrCallId:      s.cdrId,
    prefix:         s.prefix,
    durationSecs:   s.durationSecs,
    reproducedCost: s.reproducedCost,
    actualCost:     s.actualCost,
    delta:          s.delta,
  }));

  for (let i = 0; i < lineItemBatch.length; i += 500) {
    await storage.bulkCreateInvoiceLineItems(lineItemBatch.slice(i, i + 500));
  }

  // Generate HTML and update
  const lineItems = await storage.listInvoiceLineItems(invoice.id);
  const html = generateInvoiceHtml({
    invoice,
    lineItems,
    customerName: opts.customerName,
    periodLabel:  `${opts.periodStart} — ${opts.periodEnd}`,
  });
  await storage.updateInvoice(invoice.id, { htmlContent: html });

  return { invoice: { ...invoice, htmlContent: html }, lineCount: inPeriod.length };
}

export async function approveInvoice(id: number): Promise<Invoice> {
  const invoice = await storage.getInvoice(id);
  if (!invoice) throw new Error(`Invoice #${id} not found`);
  if (invoice.status === 'sent') throw new Error('Cannot approve a sent invoice');
  return storage.updateInvoice(id, { status: 'approved', approvedAt: new Date() });
}

export async function voidInvoice(id: number): Promise<Invoice> {
  return storage.updateInvoice(id, { status: 'void' });
}

export async function getInvoiceWithLineItems(id: number): Promise<{
  invoice: Invoice;
  lineItems: InvoiceLineItem[];
} | null> {
  const invoice = await storage.getInvoice(id);
  if (!invoice) return null;
  const lineItems = await storage.listInvoiceLineItems(invoice.id);
  return { invoice, lineItems };
}
