/**
 * reconciliation-export.ts
 *
 * Billing Reconciliation Export Service
 * Generates CSV and PDF exports for carrier and client reconciliation data.
 * Large exports (>5000 rows) are stored as temp files with 10-minute TTL.
 */

import PDFDocument from 'pdfkit';
import * as XLSX from 'xlsx';
import { storage } from '../../storage';
import { db } from '../../db';
import { invoiceCdrSnapshots, fasEvents } from '@shared/schema';
import { and, eq, gte, lte } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ── XLSX helper ────────────────────────────────────────────────────────────────

function buildXLSXBuffer(sheets: Array<{ name: string; headers: string[]; rows: any[][] }>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const ws = XLSX.utils.aoa_to_sheet([sheet.headers, ...sheet.rows]);
    // Auto-width columns
    const colWidths = sheet.headers.map((h, i) => {
      const maxLen = Math.max(h.length, ...sheet.rows.map(r => String(r[i] ?? '').length));
      return { wch: Math.min(Math.max(maxLen + 2, 10), 50) };
    });
    ws['!cols'] = colWidths;
    XLSX.utils.book_append_sheet(wb, ws, sheet.name.substring(0, 31));
  }
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

export const LARGE_EXPORT_THRESHOLD = 5000;
const TEMP_FILE_TTL_MS = 10 * 60 * 1000;

interface TempEntry {
  path: string;
  expiresAt: number;
  filename: string;
  mimeType: string;
}

const tempFileStore = new Map<string, TempEntry>();

function cleanupExpiredTokens(): void {
  const now = Date.now();
  for (const [token, entry] of tempFileStore) {
    if (entry.expiresAt < now) {
      try { unlinkSync(entry.path); } catch { /* best-effort */ }
      tempFileStore.delete(token);
    }
  }
}

export function getTempFile(token: string): TempEntry | null {
  cleanupExpiredTokens();
  return tempFileStore.get(token) ?? null;
}

export function storeTempFile(data: Buffer | string, filename: string, mimeType: string): string {
  cleanupExpiredTokens();
  const token = randomBytes(16).toString('hex');
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const tmpPath = join(tmpdir(), `recon_export_${token}_${safeName}`);
  if (typeof data === 'string') {
    writeFileSync(tmpPath, data, 'utf-8');
  } else {
    writeFileSync(tmpPath, data);
  }
  tempFileStore.set(token, {
    path: tmpPath,
    expiresAt: Date.now() + TEMP_FILE_TTL_MS,
    filename,
    mimeType,
  });
  return token;
}

function escapeCSV(v: string | null | undefined): string {
  if (v == null) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function fmtNum(v: number | null | undefined, decimals = 6): string {
  if (v == null) return '';
  return v.toFixed(decimals);
}

async function fetchSnapshotRows(opts: {
  iTariff?: string;
  periodStart?: string;
  periodEnd?: string;
  snapStatus?: string;
  limit?: number;
}) {
  const conditions: any[] = [];
  if (opts.iTariff) conditions.push(eq(invoiceCdrSnapshots.iTariff, opts.iTariff));
  if (opts.snapStatus && opts.snapStatus !== 'all') {
    conditions.push(eq(invoiceCdrSnapshots.verificationStatus, opts.snapStatus));
  }
  if (opts.periodStart) conditions.push(gte(invoiceCdrSnapshots.cdrStartTime, opts.periodStart));
  if (opts.periodEnd) conditions.push(lte(invoiceCdrSnapshots.cdrStartTime, opts.periodEnd + 'T23:59:59'));

  const q = db.select().from(invoiceCdrSnapshots);
  const filtered = conditions.length > 0 ? q.where(and(...conditions)) : q;
  return filtered
    .orderBy(invoiceCdrSnapshots.cdrStartTime)
    .limit(opts.limit ?? 100000);
}

/** Build a cdrId→caller lookup from fas_events for best-effort CLI population */
async function buildCdrCallerMap(): Promise<Map<string, string>> {
  const rows = await db
    .select({ callId: fasEvents.callId, caller: fasEvents.caller })
    .from(fasEvents)
    .limit(200000);
  const m = new Map<string, string>();
  for (const r of rows) {
    if (r.callId && r.caller) m.set(r.callId, r.caller);
  }
  return m;
}

// ── Carrier Reconciliation — CDR-level CSV ─────────────────────────────────────

export async function buildCarrierSnapshotCSV(opts: {
  iTariff?: string;
  periodStart?: string;
  periodEnd?: string;
  snapStatus?: string;
  reconStatus?: string;
  vendor?: string;
}): Promise<{ csv: string; rowCount: number }> {
  const [rows, reconRuns, callerMap] = await Promise.all([
    fetchSnapshotRows(opts),
    storage.listCarrierReconciliations({}),
    buildCdrCallerMap(),
  ]);

  // Build iTariff → carrierName lookup so vendor_name is populated for every row
  const tariffToVendor = new Map<string, string>();
  for (const r of reconRuns) {
    if (r.iTariff && r.carrierName) {
      tariffToVendor.set(r.iTariff, r.carrierName);
    }
  }

  // Narrow by vendor: keep only cuts whose resolved carrier matches the vendor filter
  let filtered = rows;
  if (opts.vendor && opts.vendor.trim()) {
    const v = opts.vendor.toLowerCase();
    filtered = filtered.filter(r => {
      const cn = r.iTariff ? (tariffToVendor.get(r.iTariff) ?? '').toLowerCase() : '';
      return cn.includes(v) || (r.iTariff ?? '').toLowerCase().includes(v);
    });
  }

  // Narrow by reconStatus: keep only cuts whose iTariff belongs to recon runs matching that status.
  // If the status filter yields no matching tariffs, return empty (not unfiltered dataset).
  if (opts.reconStatus && opts.reconStatus !== 'all') {
    const allowedTariffs = new Set(
      reconRuns
        .filter(r => r.status === opts.reconStatus && r.iTariff)
        .map(r => r.iTariff!)
    );
    // Always apply filter — empty set → zero rows (correct, filter is active)
    filtered = filtered.filter(r => r.iTariff && allowedTariffs.has(r.iTariff));
  }

  const headers = [
    'cut_id', 'start_time', 'cli', 'cld', 'duration',
    'our_cost', 'vendor_billed', 'discrepancy_usd', 'match_status',
    'cdr_id', 'vendor_name', 'tariff', 'prefix',
  ];

  const lines = [headers.join(',')];
  for (const r of filtered) {
    // Always resolve vendor_name from the per-row iTariff→carrierName mapping
    const vendorName = (r.iTariff ? tariffToVendor.get(r.iTariff) ?? '' : '');
    // cli: best-effort lookup via fas_events.callId matching snapshot cdrId
    const cli = r.cdrId ? (callerMap.get(r.cdrId) ?? '') : '';
    lines.push([
      escapeCSV(String(r.id)),
      escapeCSV(r.cdrStartTime ?? ''),
      escapeCSV(cli),
      escapeCSV(r.callee ?? ''),
      String(r.durationSecs ?? ''),
      fmtNum(r.reproducedCost),
      fmtNum(r.actualCost),
      fmtNum(r.delta),
      escapeCSV(r.verificationStatus),
      escapeCSV(r.cdrId ?? ''),
      escapeCSV(vendorName),
      escapeCSV(r.iTariff ?? ''),
      escapeCSV(r.prefix ?? ''),
    ].join(','));
  }

  return { csv: lines.join('\n'), rowCount: filtered.length };
}

// ── Carrier Reconciliation — Full Report CSV (summary block + CDR rows) ────────

export async function buildCarrierFullReportCSV(opts: {
  reconId: number;
}): Promise<{ csv: string; rowCount: number; filename: string }> {
  const [run, callerMap] = await Promise.all([
    storage.getCarrierReconciliation(opts.reconId),
    buildCdrCallerMap(),
  ]);

  if (!run) throw new Error(`Reconciliation run #${opts.reconId} not found`);

  const snapRows = await fetchSnapshotRows({
    iTariff:     run.iTariff     ?? undefined,
    periodStart: run.periodStart ?? undefined,
    periodEnd:   run.periodEnd   ?? undefined,
  });

  const lines: string[] = [];

  lines.push('# RECONCILIATION SUMMARY');
  lines.push(`# Generated: ${new Date().toISOString()}`);
  lines.push('field,value');
  lines.push(`id,${run.id}`);
  lines.push(`carrier_name,${escapeCSV(run.carrierName)}`);
  lines.push(`period_start,${escapeCSV(run.periodStart ?? '')}`);
  lines.push(`period_end,${escapeCSV(run.periodEnd ?? '')}`);
  lines.push(`invoice_ref,${escapeCSV(run.invoiceRef ?? '')}`);
  lines.push(`invoice_date,${escapeCSV(run.invoiceDate ?? '')}`);
  lines.push(`carrier_total,${fmtNum(run.carrierTotal, 4)}`);
  lines.push(`sippy_total,${fmtNum(run.sippyTotal, 4)}`);
  lines.push(`reproduced_total,${fmtNum(run.reproducedTotal, 4)}`);
  lines.push(`snapshot_total,${fmtNum(run.snapshotTotal, 4)}`);
  lines.push(`delta_carrier_vs_reproduced,${fmtNum(run.deltaCarrierVsReproduced, 4)}`);
  lines.push(`delta_carrier_vs_sippy,${fmtNum(run.deltaCarrierVsSippy, 4)}`);
  lines.push(`discrepancy_count,${run.discrepancyCount ?? 0}`);
  lines.push(`status,${escapeCSV(run.status)}`);
  lines.push(`notes,${escapeCSV(run.notes ?? '')}`);
  lines.push(`created_at,${run.createdAt ? new Date(run.createdAt).toISOString() : ''}`);

  lines.push('');
  lines.push('# CDR SNAPSHOT');

  const headers = [
    'cut_id', 'start_time', 'cli', 'cld', 'duration',
    'our_cost', 'vendor_billed', 'discrepancy_usd', 'match_status',
    'cdr_id', 'vendor_name', 'tariff', 'prefix',
  ];
  lines.push(headers.join(','));

  for (const r of snapRows) {
    const cli = r.cdrId ? (callerMap.get(r.cdrId) ?? '') : '';
    lines.push([
      escapeCSV(String(r.id)),
      escapeCSV(r.cdrStartTime ?? ''),
      escapeCSV(cli),
      escapeCSV(r.callee ?? ''),
      String(r.durationSecs ?? ''),
      fmtNum(r.reproducedCost),
      fmtNum(r.actualCost),
      fmtNum(r.delta),
      escapeCSV(r.verificationStatus),
      escapeCSV(r.cdrId ?? ''),
      escapeCSV(run.carrierName),
      escapeCSV(r.iTariff ?? ''),
      escapeCSV(r.prefix ?? ''),
    ].join(','));
  }

  const carrierSlug = run.carrierName.replace(/[^a-zA-Z0-9]/g, '-');
  const periodSlug  = run.periodStart ?? 'all';
  const filename    = `recon-full-${carrierSlug}-${periodSlug}-id${run.id}.csv`;

  return { csv: lines.join('\n'), rowCount: snapRows.length, filename };
}

// ── Carrier Reconciliation — Summary-level CSV ─────────────────────────────────

export async function buildCarrierReconSummaryCSV(opts: {
  status?: string;
  iTariff?: string;
  carrierName?: string;
}): Promise<{ csv: string; rowCount: number }> {
  const rows = await storage.listCarrierReconciliations({
    status: opts.status && opts.status !== 'all' ? opts.status : undefined,
    iTariff: opts.iTariff || undefined,
    limit: 100000,
  });

  const filtered = opts.carrierName
    ? rows.filter(r => r.carrierName.toLowerCase().includes(opts.carrierName!.toLowerCase()))
    : rows;

  const headers = [
    'id', 'carrier_name', 'period_start', 'period_end', 'invoice_ref',
    'carrier_total', 'sippy_total', 'reproduced_total', 'snapshot_total',
    'delta_carrier_vs_reproduced', 'delta_carrier_vs_sippy',
    'discrepancy_count', 'status', 'notes', 'created_at',
  ];

  const lines = [headers.join(',')];
  for (const r of filtered) {
    lines.push([
      String(r.id),
      escapeCSV(r.carrierName),
      escapeCSV(r.periodStart ?? ''),
      escapeCSV(r.periodEnd ?? ''),
      escapeCSV(r.invoiceRef ?? ''),
      fmtNum(r.carrierTotal, 4),
      fmtNum(r.sippyTotal, 4),
      fmtNum(r.reproducedTotal, 4),
      fmtNum(r.snapshotTotal, 4),
      fmtNum(r.deltaCarrierVsReproduced, 4),
      fmtNum(r.deltaCarrierVsSippy, 4),
      String(r.discrepancyCount ?? 0),
      escapeCSV(r.status),
      escapeCSV(r.notes ?? ''),
      escapeCSV(r.createdAt ? new Date(r.createdAt).toISOString() : ''),
    ].join(','));
  }

  return { csv: lines.join('\n'), rowCount: filtered.length };
}

// ── Client Reconciliation — CSV ────────────────────────────────────────────────

export async function buildClientReconCSV(opts: {
  period?: string;
  status?: string;
  severity?: string;
  excludeClean?: boolean;
}): Promise<{ csv: string; rowCount: number }> {
  let rows = await storage.listClientReconciliations({
    billingPeriod: opts.period || undefined,
    status: opts.status && opts.status !== 'all' ? opts.status : undefined,
    severity: opts.severity && opts.severity !== 'all' ? opts.severity : undefined,
    latestVersionOnly: true,
  });
  if (opts.excludeClean) rows = rows.filter(r => r.severity !== 'clean');

  const headers = [
    'id', 'billing_period', 'version', 'client_name', 'client_account_id',
    'client_duration_min', 'client_amount_usd', 'client_calls',
    'bitsauto_duration_min', 'bitsauto_amount_usd', 'bitsauto_calls',
    'dmr_duration_min', 'dmr_amount_usd',
    'delta_duration_min', 'delta_amount_usd', 'delta_pct',
    'discrepancy_type', 'severity', 'status', 'notes', 'created_at',
  ];

  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push([
      String(r.id),
      escapeCSV(r.billingPeriod),
      String(r.version ?? 1),
      escapeCSV(r.clientName),
      escapeCSV(r.clientAccountId ?? ''),
      fmtNum(r.clientDurationSec != null ? r.clientDurationSec / 60 : null, 2),
      fmtNum(r.clientAmountUsd, 4),
      String(r.clientCalls ?? ''),
      fmtNum(r.bitsautoDurationSec != null ? r.bitsautoDurationSec / 60 : null, 2),
      fmtNum(r.bitsautoAmountUsd, 4),
      String(r.bitsautoCalls ?? ''),
      fmtNum(r.dmrDurationSec != null ? r.dmrDurationSec / 60 : null, 2),
      fmtNum(r.dmrAmountUsd, 4),
      fmtNum(r.deltaDurationSec != null ? r.deltaDurationSec / 60 : null, 2),
      fmtNum(r.deltaAmountUsd, 4),
      fmtNum(r.deltaPct, 2),
      escapeCSV(r.discrepancyType),
      escapeCSV(r.severity),
      escapeCSV(r.status),
      escapeCSV(r.notes ?? ''),
      escapeCSV(r.createdAt ? new Date(r.createdAt).toISOString() : ''),
    ].join(','));
  }

  return { csv: lines.join('\n'), rowCount: rows.length };
}

// ── PDF builder ────────────────────────────────────────────────────────────────

function buildPdfBuffer(
  title: string,
  subtitle: string,
  summaryItems: [string, string][],
  tableHeaders: string[],
  tableRows: string[][],
  colWidths: number[],
  analysisLines: string[],
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });

    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width - 80;
    const DARK = '#1a1a2e';
    const GRAY = '#666666';

    doc.fontSize(18).fillColor(DARK).font('Helvetica-Bold').text(title, 40, 40);
    doc.fontSize(9).fillColor(GRAY).font('Helvetica').text(subtitle, 40, doc.y + 4);

    const summaryY = doc.y + 14;
    const colW = W / Math.max(summaryItems.length, 1);
    summaryItems.forEach(([label, value], i) => {
      const x = 40 + i * colW;
      doc.fillColor(GRAY).fontSize(8).font('Helvetica').text(label, x, summaryY, { width: colW - 6 });
      doc.fillColor(DARK).fontSize(10).font('Helvetica-Bold').text(value, x, doc.y + 1, { width: colW - 6 });
    });

    const ruleY = doc.y + 10;
    doc.moveTo(40, ruleY).lineTo(40 + W, ruleY).strokeColor('#cccccc').lineWidth(0.5).stroke();

    let curY = ruleY + 12;
    const rowH = 15;
    const headerH = 18;

    const colX = colWidths.reduce<number[]>((acc, w, i) => {
      acc.push(i === 0 ? 40 : acc[i - 1] + colWidths[i - 1]);
      return acc;
    }, []);

    const drawTableHeader = () => {
      doc.rect(40, curY, W, headerH).fill('#e8ecf5');
      doc.fillColor(DARK).font('Helvetica-Bold').fontSize(7.5);
      tableHeaders.forEach((h, i) => {
        doc.text(h, colX[i] + 2, curY + 5, { width: colWidths[i] - 4, lineBreak: false });
      });
      curY += headerH;
    };

    drawTableHeader();

    const STATUS_COLORS: Record<string, string> = {
      verified: '#0d7a3e', pending: '#b06a00', failed: '#c00020',
      matched: '#0d7a3e', unmatched: '#c00020',
      clean: '#0d7a3e', critical: '#c00020', high: '#b06a00',
      medium: '#9a6400', low: '#555555', shadow: '#555555',
      resolved: '#0d7a3e', disputed: '#c00020',
    };

    const MAX_ROWS = Math.min(tableRows.length, 2000);
    doc.font('Helvetica').fontSize(7);

    for (let ri = 0; ri < MAX_ROWS; ri++) {
      if (ri % 2 === 0) {
        doc.rect(40, curY, W, rowH).fill('#f8f9fb');
      }
      const row = tableRows[ri];
      row.forEach((cell, ci) => {
        const key = String(cell).toLowerCase();
        const color = STATUS_COLORS[key] ?? DARK;
        doc.fillColor(color).text(cell, colX[ci] + 2, curY + 4, { width: colWidths[ci] - 4, lineBreak: false });
      });
      curY += rowH;

      if (curY > doc.page.height - 70) {
        doc.addPage();
        curY = 40;
        drawTableHeader();
        doc.font('Helvetica').fontSize(7);
      }
    }

    if (MAX_ROWS < tableRows.length) {
      if (curY > doc.page.height - 50) { doc.addPage(); curY = 40; }
      doc.fillColor(GRAY).fontSize(8).font('Helvetica')
        .text(`… and ${(tableRows.length - MAX_ROWS).toLocaleString()} more rows (use CSV export for full dataset)`, 40, curY + 8, { width: W });
      curY = doc.y + 6;
    }

    if (analysisLines.length > 0) {
      if (curY > doc.page.height - 100) { doc.addPage(); curY = 40; }
      const aY = curY + 16;
      doc.moveTo(40, aY).lineTo(40 + W, aY).strokeColor('#cccccc').lineWidth(0.5).stroke();
      doc.fillColor(DARK).fontSize(11).font('Helvetica-Bold').text('Discrepancy Analysis', 40, aY + 10);
      doc.fillColor('#333333').fontSize(8.5).font('Helvetica');
      for (const line of analysisLines) {
        doc.text(`• ${line}`, 48, doc.y + 4, { width: W - 8 });
      }
    }

    doc.fontSize(7.5).fillColor('#aaaaaa').font('Helvetica')
      .text(`Generated by BitsAuto Platform · ${new Date().toUTCString()}`, 40, doc.page.height - 28, { width: W });

    doc.end();
  });
}

// ── Carrier Reconciliation — PDF ───────────────────────────────────────────────

export async function buildCarrierReconPDF(opts: {
  iTariff?: string;
  periodStart?: string;
  periodEnd?: string;
  snapStatus?: string;
  reconStatus?: string;
  vendor?: string;
}): Promise<{ buf: Buffer; rowCount: number }> {
  const [snapRows, reconRows] = await Promise.all([
    fetchSnapshotRows({ ...opts }),  // no row limit — full dataset; temp-file if >5000
    storage.listCarrierReconciliations({
      iTariff: opts.iTariff || undefined,
      status: opts.reconStatus && opts.reconStatus !== 'all' ? opts.reconStatus : undefined,
    }),
  ]);

  // Build iTariff → carrierName lookup for vendor resolution
  const tariffToVendorPdf = new Map<string, string>();
  for (const r of reconRows) {
    if (r.iTariff && r.carrierName) tariffToVendorPdf.set(r.iTariff, r.carrierName);
  }

  // Apply vendor filter: keep only cuts whose resolved carrier matches
  let filteredSnap = snapRows;
  if (opts.vendor && opts.vendor.trim()) {
    const v = opts.vendor.toLowerCase();
    filteredSnap = filteredSnap.filter(r => {
      const cn = r.iTariff ? (tariffToVendorPdf.get(r.iTariff) ?? '').toLowerCase() : '';
      return cn.includes(v) || (r.iTariff ?? '').toLowerCase().includes(v);
    });
  }

  // Apply reconStatus filter: keep cuts whose iTariff belongs to runs with matching status.
  // If the status filter yields no matching tariffs, return empty (not unfiltered dataset).
  if (opts.reconStatus && opts.reconStatus !== 'all') {
    const allowedTariffs = new Set(
      reconRows
        .filter(r => r.status === opts.reconStatus && r.iTariff)
        .map(r => r.iTariff!)
    );
    // Always apply filter — empty set → zero rows (correct, filter is active)
    filteredSnap = filteredSnap.filter(r => r.iTariff && allowedTariffs.has(r.iTariff));
  }

  const total = filteredSnap.length;
  const matched = filteredSnap.filter(r => r.verificationStatus === 'verified').length;
  const matchPct = total > 0 ? ((matched / total) * 100).toFixed(1) : '0.0';
  const totalDiscrep = filteredSnap.reduce((s, r) => s + Math.abs(r.delta ?? 0), 0);
  const dateRange = opts.periodStart && opts.periodEnd
    ? `${opts.periodStart} – ${opts.periodEnd}`
    : 'All periods';

  const summaryItems: [string, string][] = [
    ['Date Range', dateRange],
    ['Total CDR Cuts', total.toLocaleString()],
    ['Verified %', `${matchPct}%`],
    ['Total Discrepancy', `$${totalDiscrep.toFixed(4)}`],
    ['Filter', opts.vendor || opts.iTariff || 'All'],
    ['Status Filter', opts.reconStatus && opts.reconStatus !== 'all' ? opts.reconStatus : 'All'],
  ];

  const analysisLines: string[] = reconRows.slice(0, 8).map(r => {
    const d = r.deltaCarrierVsReproduced ?? 0;
    const sign = d > 0 ? '+' : '';
    return `${r.carrierName} (${r.periodStart ?? '?'}–${r.periodEnd ?? '?'}): carrier=$${(r.carrierTotal ?? 0).toFixed(4)}, reproduced=$${(r.reproducedTotal ?? 0).toFixed(4)}, Δ=${sign}$${d.toFixed(4)} [${r.status}]`;
  });
  if (analysisLines.length === 0) {
    analysisLines.push('No reconciliation runs found matching current filters.');
  }

  const colWidths = [40, 90, 60, 90, 55, 70, 70, 70, 65, 100, 80];
  const tableHeaders = ['Cut ID', 'Start Time', 'Duration (s)', 'CLD', 'Prefix', 'Our Cost', 'Vendor Billed', 'Discrepancy', 'Status', 'CDR ID', 'Tariff'];
  const tableRows = filteredSnap.map(r => [
    String(r.id),
    r.cdrStartTime ?? '—',
    String(r.durationSecs ?? '—'),
    r.callee ?? '—',
    r.prefix ?? '—',
    r.reproducedCost != null ? `$${r.reproducedCost.toFixed(6)}` : '—',
    r.actualCost != null ? `$${r.actualCost.toFixed(6)}` : '—',
    r.delta != null ? `$${r.delta.toFixed(6)}` : '—',
    r.verificationStatus,
    r.cdrId ?? '—',
    r.iTariff ?? '—',
  ]);

  const buf = await buildPdfBuffer(
    'Billing Reconciliation Report',
    `Generated: ${new Date().toUTCString()} · ${dateRange}`,
    summaryItems,
    tableHeaders,
    tableRows,
    colWidths,
    analysisLines,
  );
  return { buf, rowCount: total };
}

// ── Client Reconciliation — PDF ────────────────────────────────────────────────

export async function buildClientReconPDF(opts: {
  period?: string;
  status?: string;
  severity?: string;
  excludeClean?: boolean;
}): Promise<{ buf: Buffer; rowCount: number }> {
  let rows = await storage.listClientReconciliations({
    billingPeriod: opts.period || undefined,
    status: opts.status && opts.status !== 'all' ? opts.status : undefined,
    severity: opts.severity && opts.severity !== 'all' ? opts.severity : undefined,
    latestVersionOnly: true,
  });
  if (opts.excludeClean) rows = rows.filter(r => r.severity !== 'clean');

  const total = rows.length;
  const clean = rows.filter(r => r.severity === 'clean').length;
  const matchPct = total > 0 ? ((clean / total) * 100).toFixed(1) : '0.0';
  const totalDelta = rows.reduce((s, r) => s + Math.abs(r.deltaAmountUsd ?? 0), 0);

  const summaryItems: [string, string][] = [
    ['Billing Period', opts.period ?? 'All'],
    ['Total Clients', total.toLocaleString()],
    ['Clean Match', `${matchPct}%`],
    ['Total Δ Amount', `$${totalDelta.toFixed(2)}`],
    ['Status Filter', opts.status ?? 'All'],
  ];

  const analysisLines = rows
    .filter(r => r.severity !== 'clean')
    .slice(0, 10)
    .map(r => `${r.clientName} (${r.billingPeriod}): Δ=$${(r.deltaAmountUsd ?? 0).toFixed(2)}, severity=${r.severity}, status=${r.status}, type=${r.discrepancyType}`);

  const colWidths = [30, 90, 55, 60, 65, 65, 65, 60, 45, 55, 55, 75];
  const tableHeaders = ['ID', 'Client', 'Period', 'Cli. Dur (m)', 'Cli. Amt', 'BA Dur (m)', 'BA Amt', 'Δ Amt', 'Δ %', 'Severity', 'Status', 'Type'];
  const tableRows = rows.map(r => [
    String(r.id),
    r.clientName,
    r.billingPeriod,
    r.clientDurationSec != null ? (r.clientDurationSec / 60).toFixed(1) : '—',
    r.clientAmountUsd != null ? `$${r.clientAmountUsd.toFixed(2)}` : '—',
    r.bitsautoDurationSec != null ? (r.bitsautoDurationSec / 60).toFixed(1) : '—',
    r.bitsautoAmountUsd != null ? `$${r.bitsautoAmountUsd.toFixed(2)}` : '—',
    r.deltaAmountUsd != null ? `$${r.deltaAmountUsd.toFixed(2)}` : '—',
    r.deltaPct != null ? `${r.deltaPct.toFixed(1)}%` : '—',
    r.severity,
    r.status,
    r.discrepancyType,
  ]);

  const buf = await buildPdfBuffer(
    'Client Billing Reconciliation Report',
    `Period: ${opts.period ?? 'All'} · Generated: ${new Date().toUTCString()}`,
    summaryItems,
    tableHeaders,
    tableRows,
    colWidths,
    analysisLines,
  );
  return { buf, rowCount: rows.length };
}

// ── Excel (xlsx) export variants ───────────────────────────────────────────────

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function buildCarrierSnapshotXLSX(opts: Parameters<typeof buildCarrierSnapshotCSV>[0]): Promise<{ xlsx: Buffer; rowCount: number }> {
  const [rows, reconRuns, callerMap] = await Promise.all([
    fetchSnapshotRows(opts),
    storage.listCarrierReconciliations({}),
    buildCdrCallerMap(),
  ]);

  const tariffToVendor = new Map<string, string>();
  for (const r of reconRuns) {
    if (r.iTariff && r.carrierName) tariffToVendor.set(r.iTariff, r.carrierName);
  }

  let filtered = rows;
  if (opts.vendor?.trim()) {
    const v = opts.vendor.toLowerCase();
    filtered = filtered.filter(r => {
      const cn = r.iTariff ? (tariffToVendor.get(r.iTariff) ?? '').toLowerCase() : '';
      return cn.includes(v) || (r.iTariff ?? '').toLowerCase().includes(v);
    });
  }
  if (opts.reconStatus && opts.reconStatus !== 'all') {
    const allowed = new Set(reconRuns.filter(r => r.status === opts.reconStatus && r.iTariff).map(r => r.iTariff!));
    filtered = filtered.filter(r => r.iTariff && allowed.has(r.iTariff));
  }

  const headers = ['Cut ID', 'Start Time', 'CLI', 'CLD', 'Duration (s)', 'Our Cost', 'Vendor Billed', 'Discrepancy', 'Status', 'CDR ID', 'Vendor', 'Tariff', 'Prefix'];
  const dataRows = filtered.map(r => [
    r.id, r.cdrStartTime ?? '', r.cdrId ? (callerMap.get(r.cdrId) ?? '') : '',
    r.callee ?? '', r.durationSecs ?? '', r.reproducedCost ?? '', r.actualCost ?? '',
    r.delta ?? '', r.verificationStatus, r.cdrId ?? '',
    r.iTariff ? (tariffToVendor.get(r.iTariff) ?? '') : '', r.iTariff ?? '', r.prefix ?? '',
  ]);

  return { xlsx: buildXLSXBuffer([{ name: 'CDR Snapshot', headers, rows: dataRows }]), rowCount: filtered.length };
}

export async function buildCarrierFullReportXLSX(opts: { reconId: number }): Promise<{ xlsx: Buffer; rowCount: number; filename: string }> {
  const [run, callerMap] = await Promise.all([storage.getCarrierReconciliation(opts.reconId), buildCdrCallerMap()]);
  if (!run) throw new Error(`Reconciliation run #${opts.reconId} not found`);

  const snapRows = await fetchSnapshotRows({
    iTariff: run.iTariff ?? undefined,
    periodStart: run.periodStart ?? undefined,
    periodEnd: run.periodEnd ?? undefined,
  });

  const summaryData: any[][] = [
    ['Field', 'Value'],
    ['Carrier', run.carrierName], ['Period Start', run.periodStart ?? ''], ['Period End', run.periodEnd ?? ''],
    ['Invoice Ref', run.invoiceRef ?? ''], ['Invoice Date', run.invoiceDate ?? ''],
    ['Carrier Total', run.carrierTotal ?? ''], ['Sippy Total', run.sippyTotal ?? ''],
    ['Reproduced Total', run.reproducedTotal ?? ''], ['Snapshot Total', run.snapshotTotal ?? ''],
    ['Δ Carrier vs Reproduced', run.deltaCarrierVsReproduced ?? ''], ['Δ Carrier vs Sippy', run.deltaCarrierVsSippy ?? ''],
    ['Discrepancy Count', run.discrepancyCount ?? 0], ['Status', run.status], ['Notes', run.notes ?? ''],
    ['Created At', run.createdAt ? new Date(run.createdAt).toISOString() : ''],
  ];

  const headers = ['Cut ID', 'Start Time', 'CLI', 'CLD', 'Duration (s)', 'Our Cost', 'Vendor Billed', 'Discrepancy', 'Status', 'CDR ID', 'Tariff', 'Prefix'];
  const dataRows = snapRows.map(r => [
    r.id, r.cdrStartTime ?? '', r.cdrId ? (callerMap.get(r.cdrId) ?? '') : '',
    r.callee ?? '', r.durationSecs ?? '', r.reproducedCost ?? '', r.actualCost ?? '',
    r.delta ?? '', r.verificationStatus, r.cdrId ?? '', r.iTariff ?? '', r.prefix ?? '',
  ]);

  const carrierSlug = run.carrierName.replace(/[^a-zA-Z0-9]/g, '-');
  const filename = `recon-full-${carrierSlug}-${run.periodStart ?? 'all'}-id${run.id}.xlsx`;

  return {
    xlsx: buildXLSXBuffer([
      { name: 'Summary', headers: ['Field', 'Value'], rows: summaryData.slice(1) },
      { name: 'CDR Snapshot', headers, rows: dataRows },
    ]),
    rowCount: snapRows.length,
    filename,
  };
}

export async function buildCarrierReconSummaryXLSX(opts: Parameters<typeof buildCarrierReconSummaryCSV>[0]): Promise<{ xlsx: Buffer; rowCount: number }> {
  const rows = await storage.listCarrierReconciliations({
    status: opts.status && opts.status !== 'all' ? opts.status : undefined,
    iTariff: opts.iTariff || undefined,
    limit: 100000,
  });
  const filtered = opts.carrierName ? rows.filter(r => r.carrierName.toLowerCase().includes(opts.carrierName!.toLowerCase())) : rows;

  const headers = ['ID', 'Carrier', 'Period Start', 'Period End', 'Invoice Ref', 'Carrier Total', 'Sippy Total', 'Reproduced Total', 'Snapshot Total', 'Δ Carrier/Reproduced', 'Δ Carrier/Sippy', 'Discrepancies', 'Status', 'Notes', 'Created At'];
  const dataRows = filtered.map(r => [
    r.id, r.carrierName, r.periodStart ?? '', r.periodEnd ?? '', r.invoiceRef ?? '',
    r.carrierTotal ?? '', r.sippyTotal ?? '', r.reproducedTotal ?? '', r.snapshotTotal ?? '',
    r.deltaCarrierVsReproduced ?? '', r.deltaCarrierVsSippy ?? '',
    r.discrepancyCount ?? 0, r.status, r.notes ?? '',
    r.createdAt ? new Date(r.createdAt).toISOString() : '',
  ]);

  return { xlsx: buildXLSXBuffer([{ name: 'Reconciliation Summary', headers, rows: dataRows }]), rowCount: filtered.length };
}

export async function buildClientReconXLSX(opts: Parameters<typeof buildClientReconCSV>[0]): Promise<{ xlsx: Buffer; rowCount: number }> {
  let rows = await storage.listClientReconciliations({
    billingPeriod: opts.period || undefined,
    status: opts.status && opts.status !== 'all' ? opts.status : undefined,
    severity: opts.severity && opts.severity !== 'all' ? opts.severity : undefined,
    latestVersionOnly: true,
  });
  if (opts.excludeClean) rows = rows.filter(r => r.severity !== 'clean');

  const headers = ['ID', 'Billing Period', 'Version', 'Client Name', 'Account ID', 'Client Duration (min)', 'Client Amount (USD)', 'Client Calls', 'BA Duration (min)', 'BA Amount (USD)', 'BA Calls', 'DMR Duration (min)', 'DMR Amount', 'Δ Duration (min)', 'Δ Amount (USD)', 'Δ %', 'Discrepancy Type', 'Severity', 'Status', 'Notes', 'Created At'];
  const dataRows = rows.map(r => [
    r.id, r.billingPeriod, r.version ?? 1, r.clientName, r.clientAccountId ?? '',
    r.clientDurationSec != null ? +(r.clientDurationSec / 60).toFixed(2) : '',
    r.clientAmountUsd ?? '', r.clientCalls ?? '',
    r.bitsautoDurationSec != null ? +(r.bitsautoDurationSec / 60).toFixed(2) : '',
    r.bitsautoAmountUsd ?? '', r.bitsautoCalls ?? '',
    r.dmrDurationSec != null ? +(r.dmrDurationSec / 60).toFixed(2) : '', r.dmrAmountUsd ?? '',
    r.deltaDurationSec != null ? +(r.deltaDurationSec / 60).toFixed(2) : '',
    r.deltaAmountUsd ?? '', r.deltaPct ?? '',
    r.discrepancyType, r.severity, r.status, r.notes ?? '',
    r.createdAt ? new Date(r.createdAt).toISOString() : '',
  ]);

  return { xlsx: buildXLSXBuffer([{ name: 'Client Reconciliation', headers, rows: dataRows }]), rowCount: rows.length };
}
