/**
 * F2 — Invoice Batch Generation Service
 *
 * Period-first workflow:
 *   1. User selects billing cycle (monthly/weekly/biweekly/custom)
 *   2. System calculates period_start / period_end automatically
 *   3. System scans financial_snapshot (F1) for eligible clients
 *   4. Gates on F3 reconciliation certification if available
 *   5. Creates invoice_batch + invoice_job rows (one per eligible client)
 *
 * Source of truth: financial_snapshot ONLY (F1 contract)
 * F3 gate: advisory — uses latest recon_run if available, non-blocking if not
 */

import { db } from '../../db.ts';
import { sql } from 'drizzle-orm';

export type BillingCycle = 'monthly' | 'weekly' | 'biweekly' | 'custom';

export interface PeriodDates {
  start: string;  // YYYY-MM-DD
  end:   string;  // YYYY-MM-DD
  label: string;  // "July 2026" / "14–20 Jul 2026"
}

export interface BatchScope {
  type:       'all' | 'selected';
  clientIds?: string[];   // account_id values from financial_snapshot
}

export interface BatchPreview {
  periodStart:      string;
  periodEnd:        string;
  periodLabel:      string;
  snapshotRunId:    number | null;
  reconRunId:       number | null;
  reconCertified:   boolean;
  clientsFound:     number;
  estimatedRevenue: number;
  clients: Array<{
    accountId:   string;
    accountName: string;
    revenue:     number;
    eligible:    boolean;
  }>;
}

export interface BatchResult {
  status:       'success' | 'failed';
  batchId?:     number;
  batchRef?:    string;
  clientsFound: number;
  jobsCreated:  number;
  error?:       string;
}

// ─── Period calculation ───────────────────────────────────────────────────────

export function calculatePeriod(cycle: BillingCycle, customStart?: string, customEnd?: string): PeriodDates {
  const now = new Date();
  const pad  = (n: number) => String(n).padStart(2, '0');
  const ymd  = (d: Date)   => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  if (cycle === 'custom') {
    if (!customStart || !customEnd) throw new Error('custom cycle requires customStart and customEnd');
    const s = new Date(customStart);
    const e = new Date(customEnd);
    return {
      start: customStart,
      end:   customEnd,
      label: `${s.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} – ${e.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`,
    };
  }

  if (cycle === 'monthly') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end   = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return {
      start: ymd(start),
      end:   ymd(end),
      label: now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
    };
  }

  // Find Monday of current week
  const dow = now.getDay(); // 0=Sun
  const daysToMon = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(now); monday.setDate(now.getDate() + daysToMon);
  monday.setHours(0, 0, 0, 0);

  if (cycle === 'weekly') {
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
    return {
      start: ymd(monday),
      end:   ymd(sunday),
      label: `${monday.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${sunday.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`,
    };
  }

  // biweekly: Monday 2 weeks ago → Sunday this week
  const twoWeeksAgo = new Date(monday); twoWeeksAgo.setDate(monday.getDate() - 7);
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
  return {
    start: ymd(twoWeeksAgo),
    end:   ymd(sunday),
    label: `${twoWeeksAgo.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${sunday.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`,
  };
}

// ─── Batch ref generator ─────────────────────────────────────────────────────

async function nextBatchRef(periodStart: string): Promise<string> {
  const d     = new Date(periodStart);
  const mon   = d.toLocaleString('en-GB', { month: 'short' }).toUpperCase();
  const year  = d.getFullYear();
  const prefix = `${mon}-${year}`;

  const row = await db.execute(sql.raw(
    `SELECT COUNT(*) AS cnt FROM invoice_batches WHERE batch_ref LIKE '${prefix}%'`
  ));
  const n = parseInt((row as any).rows?.[0]?.cnt ?? '0') + 1;
  return `${prefix}-${String(n).padStart(3, '0')}`;
}

// ─── F3 gate: get latest certified recon run that has actual snapshot data ────

async function getLatestReconRun(): Promise<{ reconRunId: number; snapshotRunId: number } | null> {
  // Join to financial_snapshot to confirm the snapshot_run_id has actual rows
  const row = await db.execute(sql.raw(
    `SELECT rr.id, rr.snapshot_run_id
     FROM reconciliation_runs rr
     WHERE rr.status = 'success'
       AND EXISTS (
         SELECT 1 FROM financial_snapshot fs
         WHERE fs.snapshot_run_id = rr.snapshot_run_id
         AND fs.row_type = 'client'
       )
     ORDER BY rr.id DESC LIMIT 1`
  ));
  if ((row as any).rows?.length > 0) {
    const r = (row as any).rows[0];
    return { reconRunId: r.id, snapshotRunId: r.snapshot_run_id };
  }

  // Fallback: use the latest materialization_run that has client-level snapshot data
  const fallback = await db.execute(sql.raw(
    `SELECT fs.snapshot_run_id
     FROM financial_snapshot fs
     WHERE fs.row_type = 'client' AND fs.account_id IS NOT NULL AND fs.sell_amount > 0
     ORDER BY fs.snapshot_run_id DESC LIMIT 1`
  ));
  const fb = (fallback as any).rows?.[0];
  if (!fb) return null;
  return { reconRunId: 0, snapshotRunId: fb.snapshot_run_id }; // 0 = no certified recon run yet
}

// ─── Scan eligible clients from financial_snapshot ───────────────────────────

async function scanEligibleClients(
  periodStart: string,
  periodEnd:   string,
  snapshotRunId: number | null,
  scope: BatchScope,
): Promise<Array<{ accountId: string; accountName: string; revenue: number; eligible: boolean }>> {
  // Use the specific snapshot_run_id if we have one, otherwise scan all rows in the date range
  let whereClause: string;
  if (snapshotRunId) {
    whereClause = `snapshot_run_id = ${snapshotRunId} AND row_type = 'client'`;
  } else {
    whereClause = `report_date BETWEEN '${periodStart}' AND '${periodEnd}' AND row_type = 'client'`;
  }

  const rows = await db.execute(sql.raw(
    `SELECT account_id, account_name, SUM(sell_amount) AS revenue
     FROM financial_snapshot
     WHERE ${whereClause}
       AND account_id IS NOT NULL
     GROUP BY account_id, account_name
     ORDER BY revenue DESC`
  ));

  const allClients = (rows as any).rows?.map((r: any) => ({
    accountId:   r.account_id,
    accountName: r.account_name ?? r.account_id,
    revenue:     parseFloat(r.revenue ?? '0'),
    eligible:    parseFloat(r.revenue ?? '0') > 0,
  })) ?? [];

  if (scope.type === 'selected' && scope.clientIds?.length) {
    const selectedSet = new Set(scope.clientIds);
    return allClients.filter((c: any) => selectedSet.has(c.accountId));
  }

  return allClients;
}

// ─── Preview (no DB writes) ───────────────────────────────────────────────────

export async function previewBatch(
  cycle:       BillingCycle,
  scope:       BatchScope,
  customStart?: string,
  customEnd?:   string,
): Promise<BatchPreview> {
  const period = calculatePeriod(cycle, customStart, customEnd);
  const recon  = await getLatestReconRun();

  const clients = await scanEligibleClients(
    period.start, period.end,
    recon?.snapshotRunId ?? null,
    scope,
  );

  const estimatedRevenue = clients.filter(c => c.eligible).reduce((s, c) => s + c.revenue, 0);

  return {
    periodStart:    period.start,
    periodEnd:      period.end,
    periodLabel:    period.label,
    snapshotRunId:  recon?.snapshotRunId ?? null,
    reconRunId:     recon?.reconRunId    ?? null,
    reconCertified: !!recon,
    clientsFound:   clients.filter(c => c.eligible).length,
    estimatedRevenue,
    clients,
  };
}

// ─── Generate batch (DB writes) ───────────────────────────────────────────────

export async function generateInvoiceBatch(
  cycle:        BillingCycle,
  scope:        BatchScope,
  triggeredBy:  string,
  notes?:       string,
  customStart?: string,
  customEnd?:   string,
): Promise<BatchResult> {
  try {
    const period = calculatePeriod(cycle, customStart, customEnd);
    const recon  = await getLatestReconRun();
    const batchRef = await nextBatchRef(period.start);

    const clients = await scanEligibleClients(
      period.start, period.end,
      recon?.snapshotRunId ?? null,
      scope,
    );

    const eligible = clients.filter(c => c.eligible);
    const estimatedRevenue = eligible.reduce((s, c) => s + c.revenue, 0);

    // Insert invoice_batch
    const batchRow = await db.execute(sql.raw(
      `INSERT INTO invoice_batches
         (batch_ref, billing_cycle, period_start, period_end, period_label, scope,
          snapshot_run_id, recon_run_id, status, clients_found,
          clients_approved, clients_blocked, estimated_revenue, notes, created_by)
       VALUES
         ('${batchRef}', '${cycle}',
          '${period.start}', '${period.end}',
          '${period.label.replace(/'/g, "''")}',
          '${scope.type}',
          ${recon?.snapshotRunId ?? 'NULL'},
          ${recon?.reconRunId    ?? 'NULL'},
          'active',
          ${eligible.length},
          ${eligible.length}, 0,
          ${estimatedRevenue.toFixed(4)},
          ${notes ? `'${notes.replace(/'/g, "''")}'` : 'NULL'},
          '${triggeredBy}')
       RETURNING id`
    ));
    const batchId: number = (batchRow as any).rows?.[0]?.id;
    if (!batchId) throw new Error('Failed to insert invoice_batch');

    // Insert invoice_job rows for each eligible client
    let jobsCreated = 0;
    const billingPeriod = `${new Date(period.start).getFullYear()}-${String(new Date(period.start).getMonth() + 1).padStart(2, '0')}`;

    for (const client of eligible) {
      try {
        await db.execute(sql.raw(
          `INSERT INTO invoice_jobs (client_name, client_id, billing_period, status, batch_id, notes, created_by)
           VALUES (
             '${client.accountName.replace(/'/g, "''")}',
             '${client.accountId}',
             '${billingPeriod}',
             'PENDING',
             ${batchId},
             ${notes ? `'${notes.replace(/'/g, "''")}'` : 'NULL'},
             '${triggeredBy}'
           )`
        ));
        jobsCreated++;
      } catch (err: any) {
        console.error(`[invoice-batch] failed to create job for ${client.accountId}:`, err.message);
      }
    }

    // Update batch with actual job count
    await db.execute(sql.raw(
      `UPDATE invoice_batches SET clients_approved = ${jobsCreated} WHERE id = ${batchId}`
    ));

    console.log(`[invoice-batch] ${batchRef} created: ${jobsCreated} jobs for period ${period.label}`);

    return { status: 'success', batchId, batchRef, clientsFound: eligible.length, jobsCreated };
  } catch (err: any) {
    console.error('[invoice-batch] generateInvoiceBatch error:', err.message);
    return { status: 'failed', clientsFound: 0, jobsCreated: 0, error: err.message };
  }
}

// ─── List batches ─────────────────────────────────────────────────────────────

export async function listInvoiceBatches(limit = 50): Promise<unknown[]> {
  const rows = await db.execute(sql.raw(
    `SELECT ib.*,
       COUNT(ij.id) AS total_jobs,
       COUNT(ij.id) FILTER (WHERE ij.status = 'SENT')     AS sent_jobs,
       COUNT(ij.id) FILTER (WHERE ij.status = 'FAILED')   AS failed_jobs,
       COUNT(ij.id) FILTER (WHERE ij.status = 'PENDING')  AS pending_jobs,
       COUNT(ij.id) FILTER (WHERE ij.status = 'APPROVED') AS approved_jobs
     FROM invoice_batches ib
     LEFT JOIN invoice_jobs ij ON ij.batch_id = ib.id
     GROUP BY ib.id
     ORDER BY ib.created_at DESC
     LIMIT ${limit}`
  ));
  return (rows as any).rows ?? [];
}

export async function getInvoiceBatch(id: number): Promise<unknown | null> {
  const batchRow = await db.execute(sql.raw(
    `SELECT * FROM invoice_batches WHERE id = ${id}`
  ));
  const batch = (batchRow as any).rows?.[0];
  if (!batch) return null;

  const jobRows = await db.execute(sql.raw(
    `SELECT * FROM invoice_jobs WHERE batch_id = ${id} ORDER BY created_at DESC`
  ));

  return { ...batch, jobs: (jobRows as any).rows ?? [] };
}
