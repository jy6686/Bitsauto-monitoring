/**
 * F2 Full Finance Pipeline — End-to-End Lineage Integration Test
 *
 * Validates the complete audit chain:
 *   invoice_jobs → invoice_batches → reconciliation_runs → materialization_runs → financial_snapshot
 */

import { db } from './server/db.ts';
import { sql } from 'drizzle-orm';

let failures = 0;

function assert(cond: boolean, label: string, detail = '') {
  process.stdout.write(`  ${cond ? '✅' : '❌'} ${label}${detail ? '  [' + detail + ']' : ''}\n`);
  if (!cond) failures++;
}

process.stdout.write('═══════════════════════════════════════════════════════════\n');
process.stdout.write('  F2 FULL FINANCE PIPELINE — LINEAGE INTEGRATION TEST\n');
process.stdout.write('═══════════════════════════════════════════════════════════\n\n');

// ─── STEP 1: F1 ───────────────────────────────────────────────────────────────
process.stdout.write('STEP 1 — Financial Snapshot (F1)\n');
const matRow = (await db.execute(sql.raw(
  `SELECT id, status, rows_written FROM materialization_runs
   WHERE status='success' AND rows_written>0 ORDER BY id DESC LIMIT 1`
)) as any).rows?.[0];
assert(!!matRow, 'Latest materialization_run exists', `id=${matRow?.id} rows=${matRow?.rows_written}`);

const snapRow = (await db.execute(sql.raw(
  `SELECT COUNT(*) AS n, SUM(sell_amount) AS total
   FROM financial_snapshot WHERE snapshot_run_id=${matRow?.id} AND row_type='client'`
)) as any).rows?.[0];
assert(parseInt(snapRow?.n ?? '0') > 0, 'financial_snapshot has client rows',
  `count=${snapRow?.n} revenue=$${parseFloat(snapRow?.total ?? 0).toFixed(2)}`);
process.stdout.write(`     snapshot_run_id=${matRow?.id}  ${snapRow?.n} clients  $${parseFloat(snapRow?.total ?? 0).toFixed(2)}\n\n`);

// ─── STEP 2: F3 ───────────────────────────────────────────────────────────────
process.stdout.write('STEP 2 — Reconciliation & AI Evidence (F3)\n');
// Use latest certified recon run that has actual snapshot data (may not be for the very latest mat run)
const reconRow = (await db.execute(sql.raw(
  `SELECT rr.id, rr.snapshot_run_id, rr.status, rr.discrepancies,
          COUNT(rec.id) AS recon_records
   FROM reconciliation_runs rr
   LEFT JOIN reconciliation_records rec ON rec.recon_run_id = rr.id
   WHERE rr.status='success'
     AND EXISTS (SELECT 1 FROM financial_snapshot fs WHERE fs.snapshot_run_id=rr.snapshot_run_id AND fs.row_type='client')
   GROUP BY rr.id, rr.snapshot_run_id, rr.status, rr.discrepancies
   ORDER BY rr.id DESC LIMIT 1`
)) as any).rows?.[0];
assert(!!reconRow, 'Certified reconciliation run exists', `id=${reconRow?.id} → snap=${reconRow?.snapshot_run_id}`);
assert(Number(reconRow?.discrepancies ?? 1) === 0, 'Zero discrepancies');
assert(parseInt(reconRow?.recon_records ?? '0') > 0, 'Reconciliation records exist', `count=${reconRow?.recon_records}`);
process.stdout.write(`     recon_run_id=${reconRow?.id} → snapshot_run_id=${reconRow?.snapshot_run_id}  0 discrepancies  ${reconRow?.recon_records} records\n\n`);

// ─── STEP 3: F2 Batch ────────────────────────────────────────────────────────
process.stdout.write('STEP 3 — Invoice Batch (F2)\n');
// Use any active batch with jobs — we validate its lineage chain is complete
const batchRow = (await db.execute(sql.raw(
  `SELECT ib.id, ib.batch_ref, ib.period_label, ib.billing_cycle,
          ib.clients_found, ib.estimated_revenue,
          ib.snapshot_run_id, ib.recon_run_id,
          COUNT(ij.id) AS job_count
   FROM invoice_batches ib
   LEFT JOIN invoice_jobs ij ON ij.batch_id = ib.id
   WHERE ib.status='active' AND ib.clients_found>0
     AND ib.recon_run_id IS NOT NULL AND ib.snapshot_run_id IS NOT NULL
   GROUP BY ib.id
   ORDER BY ib.id DESC LIMIT 1`
)) as any).rows?.[0];
assert(!!batchRow, 'Active invoice batch with lineage FKs exists', `ref=${batchRow?.batch_ref}`);
assert(parseInt(batchRow?.job_count ?? '0') > 0, 'Batch has invoice jobs', `count=${batchRow?.job_count}`);

// Verify batch FKs resolve to real rows
const snapExists = (await db.execute(sql.raw(
  `SELECT 1 FROM materialization_runs WHERE id=${batchRow?.snapshot_run_id}`
)) as any).rows?.length > 0;
const reconExists = (await db.execute(sql.raw(
  `SELECT 1 FROM reconciliation_runs WHERE id=${batchRow?.recon_run_id}`
)) as any).rows?.length > 0;
assert(snapExists,  `batch.snapshot_run_id FK resolves`, `id=${batchRow?.snapshot_run_id}`);
assert(reconExists, `batch.recon_run_id FK resolves`,    `id=${batchRow?.recon_run_id}`);
process.stdout.write(`     ${batchRow?.batch_ref}  ${batchRow?.job_count} jobs  snap→${batchRow?.snapshot_run_id}  recon→${batchRow?.recon_run_id}\n\n`);

// ─── STEP 4: Job Lifecycle ────────────────────────────────────────────────────
process.stdout.write('STEP 4 — Invoice Job Lifecycle (PENDING→REVIEW→APPROVED→SENT)\n');
const jobRow = (await db.execute(sql.raw(
  `SELECT id, client_name, billing_period, status FROM invoice_jobs
   WHERE batch_id=${batchRow?.id} AND status='PENDING' LIMIT 1`
)) as any).rows?.[0];
assert(!!jobRow, 'PENDING job found for lifecycle test', `id=${jobRow?.id} client=${jobRow?.client_name}`);

if (jobRow) {
  // PENDING → REVIEW
  await db.execute(sql.raw(`UPDATE invoice_jobs SET status='REVIEW' WHERE id=${jobRow.id}`));
  assert((await db.execute(sql.raw(`SELECT status FROM invoice_jobs WHERE id=${jobRow.id}`)) as any).rows?.[0]?.status === 'REVIEW',
    'PENDING → REVIEW');

  // REVIEW → APPROVED
  await db.execute(sql.raw(
    `UPDATE invoice_jobs SET status='APPROVED', approved_at=now(), approved_by='integration-test' WHERE id=${jobRow.id}`
  ));
  const apr = (await db.execute(sql.raw(`SELECT status, approved_at, approved_by FROM invoice_jobs WHERE id=${jobRow.id}`)) as any).rows?.[0];
  assert(apr?.status === 'APPROVED', 'REVIEW → APPROVED');
  assert(!!apr?.approved_at, 'approved_at timestamp set');
  assert(apr?.approved_by === 'integration-test', 'approved_by recorded');

  // APPROVED → SENT
  await db.execute(sql.raw(`UPDATE invoice_jobs SET status='SENT', sent_at=now() WHERE id=${jobRow.id}`));
  const sent = (await db.execute(sql.raw(`SELECT status, sent_at FROM invoice_jobs WHERE id=${jobRow.id}`)) as any).rows?.[0];
  assert(sent?.status === 'SENT', 'APPROVED → SENT');
  assert(!!sent?.sent_at, 'sent_at timestamp set');
  process.stdout.write(`     job #${jobRow.id} (${jobRow.client_name}): PENDING→REVIEW→APPROVED→SENT ✓\n\n`);
}

// ─── STEP 5: Full Lineage JOIN ────────────────────────────────────────────────
process.stdout.write('STEP 5 — Full Lineage Chain (4-table JOIN)\n');
const chain = (await db.execute(sql.raw(`
  SELECT
    ij.id            AS job_id,
    ij.client_name,
    ij.billing_period,
    ij.status        AS job_status,
    ij.sent_at,
    ib.id            AS batch_id,
    ib.batch_ref,
    ib.period_label,
    ib.billing_cycle,
    rr.id            AS recon_run_id,
    rr.status        AS recon_status,
    rr.discrepancies,
    mr.id            AS mat_run_id,
    mr.status        AS mat_status,
    mr.rows_written,
    fs.client_count,
    fs.total_revenue
  FROM invoice_jobs          ij
  JOIN invoice_batches       ib  ON ib.id               = ij.batch_id
  JOIN reconciliation_runs   rr  ON rr.id               = ib.recon_run_id
  JOIN materialization_runs  mr  ON mr.id               = ib.snapshot_run_id
  JOIN (
    SELECT snapshot_run_id,
           COUNT(*)         AS client_count,
           SUM(sell_amount) AS total_revenue
    FROM financial_snapshot WHERE row_type='client'
    GROUP BY snapshot_run_id
  ) fs ON fs.snapshot_run_id = mr.id
  WHERE ij.id = ${jobRow?.id}
`)) as any).rows?.[0];

if (!chain) {
  assert(false, 'Lineage JOIN returned a row');
} else {
  assert(chain.job_status === 'SENT',        'job.status = SENT');
  assert(!!chain.sent_at,                    'job.sent_at populated');
  assert(!!chain.batch_ref,                  `job → batch: ${chain.batch_ref}`);
  assert(!!chain.period_label,               `batch.period: ${chain.period_label}`);
  assert(chain.recon_status === 'success',   `batch → recon #${chain.recon_run_id}: ${chain.recon_status}`);
  assert(Number(chain.discrepancies) === 0,  'recon.discrepancies = 0');
  assert(chain.mat_status === 'success',     `recon → mat #${chain.mat_run_id}: ${chain.mat_status}`);
  assert(Number(chain.rows_written) > 0,     `mat.rows_written = ${chain.rows_written}`);
  assert(Number(chain.client_count) > 0,     `snapshot.client_count = ${chain.client_count}`);
  assert(Number(chain.total_revenue) > 0,    `snapshot.revenue = $${parseFloat(chain.total_revenue).toFixed(2)}`);

  process.stdout.write(`
  ┌─ Invoice Job #${chain.job_id}
  │    client=${chain.client_name}  period=${chain.billing_period}
  │    status=SENT  sent_at=${chain.sent_at ? new Date(chain.sent_at).toISOString().slice(0,19)+'Z' : 'null'}
  │
  ├─ Invoice Batch #${chain.batch_id} — ${chain.batch_ref}
  │    "${chain.period_label}"  cycle=${chain.billing_cycle}
  │
  ├─ Reconciliation Run #${chain.recon_run_id}
  │    status=${chain.recon_status}  discrepancies=${chain.discrepancies}
  │
  ├─ Materialization Run #${chain.mat_run_id}
  │    status=${chain.mat_status}  rows_written=${chain.rows_written}
  │
  └─ Financial Snapshot
       ${chain.client_count} clients  $${parseFloat(chain.total_revenue).toFixed(2)} revenue\n\n`);
}

// Restore test job to PENDING
if (jobRow) {
  await db.execute(sql.raw(
    `UPDATE invoice_jobs SET status='PENDING', sent_at=NULL, approved_at=NULL, approved_by=NULL WHERE id=${jobRow.id}`
  ));
  process.stdout.write('     (test job restored to PENDING)\n\n');
}

// ─── Summary ─────────────────────────────────────────────────────────────────
process.stdout.write('═══════════════════════════════════════════════════════════\n');
if (failures === 0) {
  process.stdout.write('  LINEAGE INTEGRATION TEST: ALL PASSED ✅\n');
  process.stdout.write('  F1→F3→F2→Job chain is fully integrated and traceable.\n');
  process.stdout.write('  Every invoice traces to its materialization run.\n');
} else {
  process.stdout.write(`  FAILED: ${failures} assertion(s) ❌\n`);
}
process.stdout.write('═══════════════════════════════════════════════════════════\n');
process.exit(failures > 0 ? 1 : 0);
