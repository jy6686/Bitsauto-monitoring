/**
 * sippy-snapshot.service.ts
 *
 * F1 — Financial Snapshot Materialization Engine
 *
 * Transforms Daily Minutes Report (DMR) rows into the canonical
 * financial_snapshot table. This is the single source of truth for
 * all downstream Finance analytical modules.
 *
 * Architecture rule: No Finance UI reads daily_minutes_reports or
 * margin_analytics_daily directly after F1. All consumers use
 * financial_snapshot or APIs backed by it.
 *
 * Scheduler: every 30 minutes
 * Advisory lock key: 42001 (pg_try_advisory_lock — non-blocking)
 * Transaction: single, rollback on any failure
 * Audit: materialization_runs row written on both success and failure
 */

import { db } from '../../db';
import { sql } from 'drizzle-orm';
import { storage } from '../../storage';

const ADVISORY_LOCK_KEY = 42001;
const SNAPSHOT_VERSION  = 1; // bump on any breaking schema change

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SnapshotRow {
  snapshotRunId:  number;
  snapshotTime:   Date;
  reportDate:     string;
  accountId:      string | null;
  accountName:    string | null;
  vendorId:       string | null;
  vendorName:     string | null;
  destination:    string | null;
  prefix:         string | null;
  sellAmount:     number;
  buyAmount:      number;
  marginAmount:   number;
  marginPercent:  number;
  calls:          number | null;
  billedSeconds:  number | null;
  currency:       string;
  rowType:        'client' | 'vendor' | 'aggregate';
}

export interface MaterializationResult {
  runId:           number;
  status:          'success' | 'failed';
  rowsWritten:     number;
  clientsProcessed:number;
  vendorsProcessed:number;
  durationMs:      number;
  reportDates:     string[];
  error?:          string;
}

// ── DMR → Snapshot transform ──────────────────────────────────────────────────

export async function buildSnapshotRows(
  dateStr: string,
  runId: number,
  snapshotTime: Date,
): Promise<SnapshotRow[]> {
  const dmrRows = await storage.listDMRReports({
    reportDate: dateStr,
    latestVersionOnly: true,
  });

  if (!dmrRows.length) return [];

  const clientRows  = dmrRows.filter(r => r.accountName && r.accountName !== '__AGGREGATE__' && !r.vendorName);
  const vendorRows  = dmrRows.filter(r => r.vendorName && !r.accountName);
  const aggRow      = dmrRows.find(r => r.accountName === '__AGGREGATE__');

  const totalSell   = aggRow?.sellAmount ?? clientRows.reduce((s, r) => s + (r.sippyAmount ?? 0), 0);
  const totalBuy    = aggRow?.buyAmount  ?? vendorRows.reduce((s, r) => s + (r.sippyAmount ?? 0), 0);
  const totalMargin = totalSell - totalBuy;
  const totalMarginPct = totalSell > 0 ? (totalMargin / totalSell) * 100 : 0;

  const rows: SnapshotRow[] = [];

  for (const c of clientRows) {
    const sell  = c.sippyAmount ?? 0;
    const buy   = totalSell > 0 ? (sell / totalSell) * totalBuy : 0;
    const margin = sell - buy;
    const marginPct = sell > 0 ? (margin / sell) * 100 : 0;
    rows.push({
      snapshotRunId: runId,
      snapshotTime,
      reportDate:   dateStr,
      accountId:    c.accountId ?? null,
      accountName:  c.accountName ?? null,
      vendorId:     null,
      vendorName:   null,
      destination:  c.destination ?? null,
      prefix:       c.prefix ?? null,
      sellAmount:   +sell.toFixed(4),
      buyAmount:    +buy.toFixed(4),
      marginAmount: +margin.toFixed(4),
      marginPercent:+marginPct.toFixed(4),
      calls:        c.sippyCalls ?? null,
      billedSeconds:c.sippyDuration ? Math.round(c.sippyDuration) : null,
      currency:     'USD',
      rowType:      'client',
    });
  }

  for (const v of vendorRows) {
    const cost = v.sippyAmount ?? 0;
    rows.push({
      snapshotRunId: runId,
      snapshotTime,
      reportDate:   dateStr,
      accountId:    null,
      accountName:  null,
      vendorId:     v.vendorId ?? null,
      vendorName:   v.vendorName ?? null,
      destination:  v.destination ?? null,
      prefix:       v.prefix ?? null,
      sellAmount:   0,
      buyAmount:    +cost.toFixed(4),
      marginAmount: +(0 - cost).toFixed(4),
      marginPercent:0,
      calls:        v.sippyCalls ?? null,
      billedSeconds:v.sippyDuration ? Math.round(v.sippyDuration) : null,
      currency:     'USD',
      rowType:      'vendor',
    });
  }

  // Aggregate row
  rows.push({
    snapshotRunId: runId,
    snapshotTime,
    reportDate:   dateStr,
    accountId:    null,
    accountName:  '__AGGREGATE__',
    vendorId:     null,
    vendorName:   null,
    destination:  null,
    prefix:       null,
    sellAmount:   +totalSell.toFixed(4),
    buyAmount:    +totalBuy.toFixed(4),
    marginAmount: +totalMargin.toFixed(4),
    marginPercent:+totalMarginPct.toFixed(4),
    calls:        aggRow?.sippyCalls ?? clientRows.reduce((s, r) => s + (r.sippyCalls ?? 0), 0),
    billedSeconds:aggRow?.sippyDuration
      ? Math.round(aggRow.sippyDuration)
      : clientRows.reduce((s, r) => s + Math.round(r.sippyDuration ?? 0), 0),
    currency:     'USD',
    rowType:      'aggregate',
  });

  return rows;
}

// ── Bulk insert helper ────────────────────────────────────────────────────────

async function insertSnapshotRows(rows: SnapshotRow[]): Promise<void> {
  if (!rows.length) return;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values = chunk.map(r =>
      `(${r.snapshotRunId}, '${r.snapshotTime.toISOString()}', '${r.reportDate}',` +
      `${r.accountId  ? `'${r.accountId.replace(/'/g, "''")}'`  : 'NULL'},` +
      `${r.accountName? `'${r.accountName.replace(/'/g, "''")}'`: 'NULL'},` +
      `${r.vendorId   ? `'${r.vendorId.replace(/'/g, "''")}'`   : 'NULL'},` +
      `${r.vendorName ? `'${r.vendorName.replace(/'/g, "''")}'` : 'NULL'},` +
      `${r.destination? `'${r.destination.replace(/'/g, "''")}'`: 'NULL'},` +
      `${r.prefix     ? `'${r.prefix.replace(/'/g, "''")}'`     : 'NULL'},` +
      `${r.sellAmount},${r.buyAmount},${r.marginAmount},${r.marginPercent},` +
      `${r.calls ?? 'NULL'},${r.billedSeconds ?? 'NULL'},` +
      `'${r.currency}','${r.rowType}')`
    ).join(',');
    await db.execute(sql.raw(
      `INSERT INTO financial_snapshot
       (snapshot_run_id,snapshot_time,report_date,account_id,account_name,vendor_id,vendor_name,
        destination,prefix,sell_amount,buy_amount,margin_amount,margin_percent,
        calls,billed_seconds,currency,row_type)
       VALUES ${values}`
    ));
  }
}

// ── Core materialization cycle ────────────────────────────────────────────────

export async function runMaterialization(
  triggeredBy: 'scheduler' | 'manual' | 'api' = 'scheduler',
  targetDates?: string[],
): Promise<MaterializationResult> {
  const t0 = Date.now();

  // ── Advisory lock ────────────────────────────────────────────────────────
  const lockResult = await db.execute(sql.raw(`SELECT pg_try_advisory_lock(${ADVISORY_LOCK_KEY}) AS locked`));
  const locked = (lockResult as any).rows?.[0]?.locked ?? false;
  if (!locked) {
    throw new Error('Materialization already in progress — advisory lock held by another process');
  }

  // ── Determine target dates ───────────────────────────────────────────────
  const now      = new Date();
  const today    = now.toISOString().slice(0, 10);
  const yday     = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
  const dates    = targetDates ?? (now.getUTCHours() < 6 ? [today, yday] : [today]);

  // ── Create the run record (status = running) ─────────────────────────────
  const runInsert = await db.execute(sql.raw(
    `INSERT INTO materialization_runs (started_at, status, report_dates, snapshot_version, triggered_by)
     VALUES (now(), 'running', ARRAY[${dates.map(d => `'${d}'`).join(',')}], ${SNAPSHOT_VERSION}, '${triggeredBy}')
     RETURNING id`
  ));
  const runId: number = (runInsert as any).rows[0].id;

  let rowsWritten     = 0;
  let clientsProcessed = 0;
  let vendorsProcessed = 0;

  try {
    const snapshotTime = new Date();

    // ── Single transaction: delete existing + insert new ──────────────────
    await db.execute(sql.raw('BEGIN'));

    for (const dateStr of dates) {
      await db.execute(sql.raw(
        `DELETE FROM financial_snapshot WHERE report_date = '${dateStr}'`
      ));
      const rows = await buildSnapshotRows(dateStr, runId, snapshotTime);
      await insertSnapshotRows(rows);
      rowsWritten      += rows.length;
      clientsProcessed += rows.filter(r => r.rowType === 'client').length;
      vendorsProcessed += rows.filter(r => r.rowType === 'vendor').length;
    }

    // ── Validate: if DMR had data, snapshot must have rows ────────────────
    const checkResult = await db.execute(sql.raw(
      `SELECT COUNT(*) AS cnt FROM financial_snapshot WHERE report_date = ANY(ARRAY[${dates.map(d => `'${d}'`).join(',')}]::date[])`
    ));
    const snapshotCount = parseInt((checkResult as any).rows[0]?.cnt ?? '0');
    if (snapshotCount === 0 && rowsWritten > 0) {
      throw new Error('Snapshot validation failed: rows built but none persisted');
    }

    await db.execute(sql.raw('COMMIT'));

    const durationMs = Date.now() - t0;

    // ── Update run record: success ─────────────────────────────────────────
    await db.execute(sql.raw(
      `UPDATE materialization_runs SET
         status = 'success', completed_at = now(),
         rows_written = ${rowsWritten}, clients_processed = ${clientsProcessed},
         vendors_processed = ${vendorsProcessed}, duration_ms = ${durationMs}
       WHERE id = ${runId}`
    ));

    return { runId, status: 'success', rowsWritten, clientsProcessed, vendorsProcessed, durationMs, reportDates: dates };
  } catch (err: any) {
    try { await db.execute(sql.raw('ROLLBACK')); } catch {}

    const durationMs = Date.now() - t0;
    const errorMsg   = String(err?.message ?? err).slice(0, 2000);

    await db.execute(sql.raw(
      `UPDATE materialization_runs SET
         status = 'failed', completed_at = now(),
         duration_ms = ${durationMs}, error = '${errorMsg.replace(/'/g, "''")}'
       WHERE id = ${runId}`
    ));

    return { runId, status: 'failed', rowsWritten: 0, clientsProcessed: 0, vendorsProcessed: 0, durationMs, reportDates: dates, error: errorMsg };
  } finally {
    // ── Release advisory lock ─────────────────────────────────────────────
    try { await db.execute(sql.raw(`SELECT pg_advisory_unlock(${ADVISORY_LOCK_KEY})`)); } catch {}
  }
}

// ── Snapshot query helpers (used by migrated /api/margin/* and /api/finance/snapshot) ──

export async function querySnapshotClients(date: string, limit = 50): Promise<SnapshotRow[]> {
  const r = await db.execute(sql.raw(
    `SELECT * FROM financial_snapshot
     WHERE report_date = '${date}' AND row_type = 'client'
     ORDER BY margin_amount DESC NULLS LAST
     LIMIT ${limit}`
  ));
  return ((r as any).rows ?? []).map(dbRowToSnapshot);
}

export async function querySnapshotVendors(date: string, limit = 50): Promise<SnapshotRow[]> {
  const r = await db.execute(sql.raw(
    `SELECT * FROM financial_snapshot
     WHERE report_date = '${date}' AND row_type = 'vendor'
     ORDER BY buy_amount ASC NULLS LAST
     LIMIT ${limit}`
  ));
  return ((r as any).rows ?? []).map(dbRowToSnapshot);
}

export async function querySnapshotAggregate(date: string): Promise<SnapshotRow | null> {
  const r = await db.execute(sql.raw(
    `SELECT * FROM financial_snapshot
     WHERE report_date = '${date}' AND row_type = 'aggregate'
     LIMIT 1`
  ));
  const row = (r as any).rows?.[0];
  return row ? dbRowToSnapshot(row) : null;
}

export async function querySnapshotTrend(
  fromDate: string,
  toDate: string,
  rowType: 'client' | 'vendor' | 'aggregate' = 'aggregate',
  name?: string,
): Promise<Array<{ date: string; sellAmount: number; buyAmount: number; marginAmount: number; marginPercent: number; calls: number }>> {
  const nameFilter = name ? `AND (account_name = '${name.replace(/'/g, "''")}' OR vendor_name = '${name.replace(/'/g, "''")}')` : '';
  const r = await db.execute(sql.raw(
    `SELECT report_date,
            SUM(sell_amount)::numeric   AS sell_amount,
            SUM(buy_amount)::numeric    AS buy_amount,
            SUM(margin_amount)::numeric AS margin_amount,
            AVG(margin_percent)::numeric AS margin_percent,
            SUM(calls)::integer         AS calls
     FROM financial_snapshot
     WHERE report_date BETWEEN '${fromDate}' AND '${toDate}'
       AND row_type = '${rowType}'
       ${nameFilter}
     GROUP BY report_date
     ORDER BY report_date ASC`
  ));
  return ((r as any).rows ?? []).map((row: any) => ({
    date:          row.report_date,
    sellAmount:    parseFloat(row.sell_amount   ?? '0'),
    buyAmount:     parseFloat(row.buy_amount    ?? '0'),
    marginAmount:  parseFloat(row.margin_amount ?? '0'),
    marginPercent: parseFloat(row.margin_percent?? '0'),
    calls:         parseInt  (row.calls         ?? '0'),
  }));
}

export async function querySnapshotSummary(date?: string): Promise<{
  latestDate: string | null;
  totalSell: number;
  totalBuy: number;
  totalMargin: number;
  marginPercent: number;
  totalCalls: number;
  clientCount: number;
  vendorCount: number;
  lastRunId: number | null;
  lastRunAt: string | null;
  lastRunStatus: string | null;
}> {
  const dateFilter = date ? `AND report_date = '${date}'` : `AND report_date = (SELECT MAX(report_date) FROM financial_snapshot)`;
  const agg = await db.execute(sql.raw(
    `SELECT
       MAX(report_date) AS latest_date,
       SUM(sell_amount)::numeric    AS total_sell,
       SUM(buy_amount)::numeric     AS total_buy,
       SUM(margin_amount)::numeric  AS total_margin,
       AVG(margin_percent)::numeric AS margin_percent,
       SUM(calls)::integer          AS total_calls,
       COUNT(*) FILTER (WHERE row_type = 'client')  AS client_count,
       COUNT(*) FILTER (WHERE row_type = 'vendor')  AS vendor_count
     FROM financial_snapshot
     WHERE row_type IN ('client','vendor')
     ${dateFilter}`
  ));
  const run = await db.execute(sql.raw(
    `SELECT id, started_at, status FROM materialization_runs
     ORDER BY started_at DESC LIMIT 1`
  ));
  const a   = (agg as any).rows?.[0]  ?? {};
  const r   = (run as any).rows?.[0]  ?? {};
  return {
    latestDate:    a.latest_date    ?? null,
    totalSell:     parseFloat(a.total_sell    ?? '0'),
    totalBuy:      parseFloat(a.total_buy     ?? '0'),
    totalMargin:   parseFloat(a.total_margin  ?? '0'),
    marginPercent: parseFloat(a.margin_percent?? '0'),
    totalCalls:    parseInt  (a.total_calls   ?? '0'),
    clientCount:   parseInt  (a.client_count  ?? '0'),
    vendorCount:   parseInt  (a.vendor_count  ?? '0'),
    lastRunId:     r.id        ?? null,
    lastRunAt:     r.started_at?.toISOString?.() ?? r.started_at ?? null,
    lastRunStatus: r.status     ?? null,
  };
}

// ── DB row → SnapshotRow ──────────────────────────────────────────────────────

function dbRowToSnapshot(row: any): SnapshotRow {
  return {
    snapshotRunId:  row.snapshot_run_id,
    snapshotTime:   new Date(row.snapshot_time),
    reportDate:     row.report_date,
    accountId:      row.account_id   ?? null,
    accountName:    row.account_name ?? null,
    vendorId:       row.vendor_id    ?? null,
    vendorName:     row.vendor_name  ?? null,
    destination:    row.destination  ?? null,
    prefix:         row.prefix       ?? null,
    sellAmount:     parseFloat(row.sell_amount    ?? '0'),
    buyAmount:      parseFloat(row.buy_amount     ?? '0'),
    marginAmount:   parseFloat(row.margin_amount  ?? '0'),
    marginPercent:  parseFloat(row.margin_percent ?? '0'),
    calls:          row.calls          != null ? parseInt(row.calls)         : null,
    billedSeconds:  row.billed_seconds != null ? parseInt(row.billed_seconds): null,
    currency:       row.currency  ?? 'USD',
    rowType:        row.row_type  as SnapshotRow['rowType'],
  };
}
