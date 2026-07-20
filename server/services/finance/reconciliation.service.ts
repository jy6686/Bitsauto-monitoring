/**
 * F3 Reconciliation & AI Evidence Service
 *
 * Contract rules (from f3-pre-sprint-architecture-contract.md):
 * - Read financial_snapshot ONLY — never reads daily_minutes_reports or margin_analytics_daily
 * - Append-only: no UPDATE to reconciliation_records or ai_findings
 * - Every discrepancy has reason_code (not null)
 * - Every AI finding links both snapshot_run_id and recon_record_id
 * - Evidence reproducibility: same snapshot + same detector version → identical findings
 */

import { db } from '../../db';
import { sql } from 'drizzle-orm';

const RECON_ENGINE_VERSION = 1;
const AI_DETECTOR_VERSION  = 1;

export interface ReconResult {
  status: 'success' | 'failed';
  reconRunId?: number;
  aiScanRunId?: number;
  recordsCreated?: number;
  discrepancies?: number;
  findingsCreated?: number;
  durationMs?: number;
  error?: string;
}

interface SnapshotRow {
  id: number;
  reportDate: string;
  rowType: string;
  accountId: string | null;
  accountName: string | null;
  vendorId: string | null;
  vendorName: string | null;
  sellAmount: number;
  buyAmount: number;
  marginAmount: number;
  marginPercent: number;
  calls: number;
  billedSeconds: number;
  snapshotRunId: number;
}

// ── Internal helpers ────────────────────────────────────────────────────────

function pct(value: number, base: number): number {
  if (!base || base === 0) return 0;
  return parseFloat(((value / base) * 100).toFixed(4));
}

function numericDiff(a: number, b: number): { difference: number; differencePct: number; status: string } {
  const diff = parseFloat((a - b).toFixed(4));
  const diffPct = parseFloat(pct(diff, b).toFixed(4));
  const ABS_THRESHOLD = 0.01;   // $0.01 absolute tolerance (float precision)
  const PCT_THRESHOLD = 0.5;    // 0.5% relative tolerance
  const status = Math.abs(diff) <= ABS_THRESHOLD || Math.abs(diffPct) <= PCT_THRESHOLD
    ? 'matched' : 'discrepancy';
  return { difference: diff, differencePct: diffPct, status };
}

// ── Reconciliation detectors ────────────────────────────────────────────────

interface ReconRecord {
  entityType: string;
  entityId: string | null;
  entityName: string | null;
  metric: string;
  snapshotValue: number;
  expectedValue: number;
  difference: number;
  differencePct: number;
  status: string;
  reasonCode: string;
  reasonDetail: string;
}

function buildRecords(rows: SnapshotRow[], snapshotRunId: number): ReconRecord[] {
  const records: ReconRecord[] = [];

  const clients   = rows.filter(r => r.rowType === 'client');
  const vendors   = rows.filter(r => r.rowType === 'vendor');
  const aggregate = rows.find(r => r.rowType === 'aggregate');

  // ── Check 1: Aggregate sell = Σ client sells ──────────────────────────────
  if (aggregate) {
    const sumClientSell = clients.reduce((s, c) => s + (c.sellAmount ?? 0), 0);
    const { difference, differencePct, status } = numericDiff(aggregate.sellAmount, sumClientSell);
    records.push({
      entityType:   'aggregate',
      entityId:     null,
      entityName:   'Platform Aggregate',
      metric:       'Revenue',
      snapshotValue: aggregate.sellAmount,
      expectedValue: parseFloat(sumClientSell.toFixed(4)),
      difference, differencePct, status,
      reasonCode:   status === 'matched' ? 'INTERNAL_CONSISTENCY' : 'AGGREGATE_CLIENT_MISMATCH',
      reasonDetail: status === 'matched'
        ? `Aggregate sell ($${aggregate.sellAmount}) matches sum of ${clients.length} client sell amounts ($${sumClientSell.toFixed(4)}) within tolerance.`
        : `Aggregate sell ($${aggregate.sellAmount}) differs from sum of ${clients.length} client sells ($${sumClientSell.toFixed(4)}) by $${difference} (${differencePct}%).`,
    });
  }

  // ── Check 2: Aggregate buy = Σ vendor buys ───────────────────────────────
  if (aggregate) {
    const sumVendorBuy = vendors.reduce((s, v) => s + (v.buyAmount ?? 0), 0);
    const { difference, differencePct, status } = numericDiff(aggregate.buyAmount, sumVendorBuy);
    records.push({
      entityType:   'aggregate',
      entityId:     null,
      entityName:   'Platform Aggregate',
      metric:       'Cost',
      snapshotValue: aggregate.buyAmount,
      expectedValue: parseFloat(sumVendorBuy.toFixed(4)),
      difference, differencePct, status,
      reasonCode:   status === 'matched' ? 'INTERNAL_CONSISTENCY' : 'AGGREGATE_VENDOR_MISMATCH',
      reasonDetail: status === 'matched'
        ? `Aggregate buy ($${aggregate.buyAmount}) matches sum of ${vendors.length} vendor buy amounts ($${sumVendorBuy.toFixed(4)}) within tolerance.`
        : `Aggregate buy ($${aggregate.buyAmount}) differs from sum of ${vendors.length} vendor buys ($${sumVendorBuy.toFixed(4)}) by $${difference} (${differencePct}%).`,
    });
  }

  // ── Check 3: Aggregate margin = sell − buy ────────────────────────────────
  if (aggregate) {
    const computedMargin = parseFloat((aggregate.sellAmount - aggregate.buyAmount).toFixed(4));
    const { difference, differencePct, status } = numericDiff(aggregate.marginAmount, computedMargin);
    records.push({
      entityType:   'aggregate',
      entityId:     null,
      entityName:   'Platform Aggregate',
      metric:       'Margin',
      snapshotValue: aggregate.marginAmount,
      expectedValue: computedMargin,
      difference, differencePct, status,
      reasonCode:   status === 'matched' ? 'MARGIN_FORMULA' : 'MARGIN_ARITHMETIC_ERROR',
      reasonDetail: status === 'matched'
        ? `Margin ($${aggregate.marginAmount}) correctly equals sell ($${aggregate.sellAmount}) − buy ($${aggregate.buyAmount}) = $${computedMargin}.`
        : `Margin arithmetic error: stored $${aggregate.marginAmount} but sell−buy = $${computedMargin} (diff $${difference}).`,
    });
  }

  // ── Check 4: Per-client margin = sell − buy ───────────────────────────────
  for (const client of clients) {
    const computedMargin = parseFloat(((client.sellAmount ?? 0) - (client.buyAmount ?? 0)).toFixed(4));
    const { difference, differencePct, status } = numericDiff(client.marginAmount ?? 0, computedMargin);
    if (status !== 'matched') {
      records.push({
        entityType:   'client',
        entityId:     client.accountId,
        entityName:   client.accountName,
        metric:       'Margin',
        snapshotValue: client.marginAmount ?? 0,
        expectedValue: computedMargin,
        difference, differencePct, status,
        reasonCode:   'MARGIN_ARITHMETIC_ERROR',
        reasonDetail: `Client ${client.accountName}: stored margin $${client.marginAmount} but sell−buy = $${computedMargin} (diff $${difference}).`,
      });
    }
  }

  // ── Check 5: Aggregate margin_pct = (margin/sell)×100 ────────────────────
  if (aggregate && aggregate.sellAmount > 0) {
    const computedPct = pct(aggregate.marginAmount, aggregate.sellAmount);
    const { difference, differencePct, status } = numericDiff(aggregate.marginPercent ?? 0, computedPct);
    records.push({
      entityType:   'aggregate',
      entityId:     null,
      entityName:   'Platform Aggregate',
      metric:       'MarginPercent',
      snapshotValue: aggregate.marginPercent ?? 0,
      expectedValue: computedPct,
      difference, differencePct, status,
      reasonCode:   status === 'matched' ? 'MARGIN_PCT_FORMULA' : 'MARGIN_PCT_ERROR',
      reasonDetail: status === 'matched'
        ? `Margin % (${aggregate.marginPercent}%) correctly computed as ${computedPct}%.`
        : `Margin % error: stored ${aggregate.marginPercent}% but (${aggregate.marginAmount}/${aggregate.sellAmount})×100 = ${computedPct}%.`,
    });
  }

  // ── Check 6: Negative margin detection (per-client) ───────────────────────
  for (const client of clients) {
    if ((client.marginAmount ?? 0) < -0.01) {
      records.push({
        entityType:   'client',
        entityId:     client.accountId,
        entityName:   client.accountName,
        metric:       'Margin',
        snapshotValue: client.marginAmount ?? 0,
        expectedValue: 0,
        difference:   parseFloat((client.marginAmount ?? 0).toFixed(4)),
        differencePct: pct(client.marginAmount ?? 0, client.sellAmount ?? 1),
        status:       'discrepancy',
        reasonCode:   'NEGATIVE_MARGIN',
        reasonDetail: `Client ${client.accountName} has negative margin $${client.marginAmount} on revenue $${client.sellAmount}.`,
      });
    }
  }

  // ── Check 7: Zero-revenue clients with positive buy cost ─────────────────
  for (const client of clients) {
    if ((client.sellAmount ?? 0) <= 0 && (client.buyAmount ?? 0) > 0.01) {
      records.push({
        entityType:   'client',
        entityId:     client.accountId,
        entityName:   client.accountName,
        metric:       'Revenue',
        snapshotValue: client.sellAmount ?? 0,
        expectedValue: 0,
        difference:   0,
        differencePct: 0,
        status:       'discrepancy',
        reasonCode:   'ZERO_REVENUE_WITH_COST',
        reasonDetail: `Client ${client.accountName} has $0 revenue but $${client.buyAmount} allocated vendor cost.`,
      });
    }
  }

  return records;
}

// ── AI Detectors ────────────────────────────────────────────────────────────

interface AiFindingData {
  reconRecordId: number | null;
  findingType: string;
  severity: string;
  entityType: string | null;
  entityId: string | null;
  entityName: string | null;
  metric: string | null;
  observedValue: number | null;
  expectedRange: Record<string, unknown> | null;
  confidenceScore: number;
  explanation: string;
  evidenceRefs: unknown[] | null;
}

function runDetectors(
  rows: SnapshotRow[],
  reconRecords: Array<{ id: number } & ReconRecord>,
): AiFindingData[] {
  const findings: AiFindingData[] = [];

  const clients   = rows.filter(r => r.rowType === 'client');
  const vendors   = rows.filter(r => r.rowType === 'vendor');
  const aggregate = rows.find(r => r.rowType === 'aggregate');
  const discrepancyRecords = reconRecords.filter(r => r.status === 'discrepancy');

  // D1: Revenue anomaly — client contributing >60% of total revenue
  if (aggregate && aggregate.sellAmount > 0) {
    for (const client of clients) {
      const share = (client.sellAmount ?? 0) / aggregate.sellAmount;
      if (share > 0.6) {
        findings.push({
          reconRecordId: reconRecords.find(r => r.entityId === client.accountId && r.metric === 'Revenue')?.id ?? null,
          findingType:   'REVENUE_CONCENTRATION',
          severity:      share > 0.8 ? 'critical' : 'warning',
          entityType:    'client',
          entityId:      client.accountId,
          entityName:    client.accountName,
          metric:        'Revenue',
          observedValue: parseFloat((share * 100).toFixed(2)),
          expectedRange: { max: 60, unit: 'percent_of_total' },
          confidenceScore: 0.95,
          explanation:   `${client.accountName} contributes ${(share * 100).toFixed(1)}% of total platform revenue ($${client.sellAmount?.toFixed(2)} of $${aggregate.sellAmount.toFixed(2)}). High concentration risk.`,
          evidenceRefs:  [{ snapshotRowId: client.id, sell_amount: client.sellAmount, total_sell: aggregate.sellAmount }],
        });
      }
    }
  }

  // D2: Margin compression — margin < 10% of revenue on any client
  for (const client of clients) {
    if ((client.sellAmount ?? 0) > 1) {
      const marginPct = pct(client.marginAmount ?? 0, client.sellAmount ?? 1);
      if (marginPct < 10 && marginPct >= 0) {
        findings.push({
          reconRecordId: reconRecords.find(r => r.entityId === client.accountId && r.metric === 'Margin')?.id ?? null,
          findingType:   'MARGIN_COMPRESSION',
          severity:      marginPct < 5 ? 'critical' : 'warning',
          entityType:    'client',
          entityId:      client.accountId,
          entityName:    client.accountName,
          metric:        'Margin',
          observedValue: parseFloat(marginPct.toFixed(2)),
          expectedRange: { min: 10, unit: 'percent' },
          confidenceScore: 0.90,
          explanation:   `${client.accountName} margin is ${marginPct.toFixed(1)}% (sell $${client.sellAmount?.toFixed(2)}, margin $${client.marginAmount?.toFixed(2)}). Below 10% threshold.`,
          evidenceRefs:  [{ snapshotRowId: client.id, sell_amount: client.sellAmount, margin_amount: client.marginAmount }],
        });
      }
    }
  }

  // D3: Vendor cost spike — any vendor carrying >50% of total buy cost
  if (aggregate && aggregate.buyAmount > 0) {
    for (const vendor of vendors) {
      const share = (vendor.buyAmount ?? 0) / aggregate.buyAmount;
      if (share > 0.5) {
        findings.push({
          reconRecordId: null,
          findingType:   'VENDOR_COST_CONCENTRATION',
          severity:      share > 0.7 ? 'critical' : 'warning',
          entityType:    'vendor',
          entityId:      vendor.vendorId,
          entityName:    vendor.vendorName,
          metric:        'Cost',
          observedValue: parseFloat((share * 100).toFixed(2)),
          expectedRange: { max: 50, unit: 'percent_of_total' },
          confidenceScore: 0.90,
          explanation:   `Vendor ${vendor.vendorName} carries ${(share * 100).toFixed(1)}% of total platform cost ($${vendor.buyAmount?.toFixed(2)} of $${aggregate.buyAmount.toFixed(2)}). High dependency risk.`,
          evidenceRefs:  [{ snapshotRowId: vendor.id, buy_amount: vendor.buyAmount, total_buy: aggregate.buyAmount }],
        });
      }
    }
  }

  // D4: Reconciliation discrepancy alert — elevate each discrepancy to an AI finding
  for (const rec of discrepancyRecords) {
    const existing = findings.find(f => f.reconRecordId === rec.id);
    if (!existing) {
      findings.push({
        reconRecordId: rec.id,
        findingType:   `RECON_${rec.reasonCode}`,
        severity:      Math.abs(rec.differencePct) > 5 ? 'critical' : 'warning',
        entityType:    rec.entityType,
        entityId:      rec.entityId,
        entityName:    rec.entityName,
        metric:        rec.metric,
        observedValue: parseFloat((rec.difference ?? 0).toFixed(4)),
        expectedRange: { expected: rec.expectedValue, tolerance_usd: 0.01, tolerance_pct: 0.5 },
        confidenceScore: 1.0,
        explanation:   `Reconciliation discrepancy: ${rec.reasonDetail}`,
        evidenceRefs:  [{ reconRecordId: rec.id, difference: rec.difference, differencePct: rec.differencePct }],
      });
    }
  }

  // D5: Platform-level negative margin (should never happen)
  if (aggregate && (aggregate.marginAmount ?? 0) < 0) {
    findings.push({
      reconRecordId: reconRecords.find(r => r.entityType === 'aggregate' && r.metric === 'Margin')?.id ?? null,
      findingType:   'NEGATIVE_PLATFORM_MARGIN',
      severity:      'critical',
      entityType:    'aggregate',
      entityId:      null,
      entityName:    'Platform Aggregate',
      metric:        'Margin',
      observedValue: parseFloat((aggregate.marginAmount ?? 0).toFixed(4)),
      expectedRange: { min: 0, unit: 'USD' },
      confidenceScore: 1.0,
      explanation:   `Platform aggregate margin is negative ($${aggregate.marginAmount?.toFixed(2)}). Revenue $${aggregate.sellAmount?.toFixed(2)} is insufficient to cover cost $${aggregate.buyAmount?.toFixed(2)}.`,
      evidenceRefs:  [{ snapshotRowId: aggregate.id, sell: aggregate.sellAmount, buy: aggregate.buyAmount, margin: aggregate.marginAmount }],
    });
  }

  return findings;
}

// ── Main entry point ─────────────────────────────────────────────────────────

export async function runReconciliation(
  triggeredBy: 'scheduler' | 'api' | string,
  snapshotRunId?: number,
): Promise<ReconResult> {
  const startMs = Date.now();

  // Resolve which snapshot run to reconcile
  let targetRunId: number;
  if (snapshotRunId) {
    targetRunId = snapshotRunId;
  } else {
    const latest = await db.execute(sql.raw(
      `SELECT id FROM materialization_runs WHERE status = 'success' ORDER BY id DESC LIMIT 1`
    ));
    const row = (latest as any).rows?.[0];
    if (!row) return { status: 'failed', error: 'No successful materialization runs found' };
    targetRunId = row.id;
  }

  // Check if this snapshot run has already been reconciled (idempotency for same run)
  const existingRecon = await db.execute(sql.raw(
    `SELECT id FROM reconciliation_runs WHERE snapshot_run_id = ${targetRunId} AND status = 'success' LIMIT 1`
  ));
  if ((existingRecon as any).rows?.length > 0) {
    const existingId = (existingRecon as any).rows[0].id;
    // Return existing result — reproducibility requirement
    const existingStats = await db.execute(sql.raw(
      `SELECT records_created, discrepancies, duration_ms FROM reconciliation_runs WHERE id = ${existingId}`
    ));
    const s = (existingStats as any).rows?.[0] ?? {};
    return {
      status: 'success',
      reconRunId: existingId,
      recordsCreated: s.records_created,
      discrepancies: s.discrepancies,
      durationMs: Date.now() - startMs,
      error: undefined,
    };
  }

  // Create reconciliation_runs row
  const runRow = await db.execute(sql.raw(
    `INSERT INTO reconciliation_runs (snapshot_run_id, status, report_dates)
     SELECT ${targetRunId}, 'running', mr.report_dates
     FROM materialization_runs mr WHERE mr.id = ${targetRunId}
     RETURNING id`
  ));
  const reconRunId: number = (runRow as any).rows?.[0]?.id;
  if (!reconRunId) return { status: 'failed', error: 'Failed to create reconciliation_runs row' };

  try {
    // Load snapshot rows for this run (read-only — F3 contract rule 1)
    const snapRows = await db.execute(sql.raw(`
      SELECT id, report_date::text AS "reportDate", row_type AS "rowType",
             account_id AS "accountId", account_name AS "accountName",
             vendor_id AS "vendorId", vendor_name AS "vendorName",
             COALESCE(sell_amount::float, 0) AS "sellAmount",
             COALESCE(buy_amount::float, 0) AS "buyAmount",
             COALESCE(margin_amount::float, 0) AS "marginAmount",
             COALESCE(margin_percent::float, 0) AS "marginPercent",
             COALESCE(calls, 0) AS calls,
             COALESCE(billed_seconds, 0) AS "billedSeconds",
             snapshot_run_id AS "snapshotRunId"
      FROM financial_snapshot
      WHERE snapshot_run_id = ${targetRunId}
      ORDER BY row_type, sell_amount DESC NULLS LAST
    `));
    const rows: SnapshotRow[] = (snapRows as any).rows ?? [];

    if (rows.length === 0) {
      await db.execute(sql.raw(
        `UPDATE reconciliation_runs SET status='failed', completed_at=now(),
         error='No snapshot rows found for run ${targetRunId}', duration_ms=${Date.now() - startMs}
         WHERE id=${reconRunId}`
      ));
      return { status: 'failed', reconRunId, error: `No snapshot rows for materialization run ${targetRunId}` };
    }

    // Get report date from snapshot
    const reportDate: string = rows[0]?.reportDate ?? new Date().toISOString().slice(0, 10);

    // Build reconciliation records
    const rawRecords = buildRecords(rows, targetRunId);

    // Insert reconciliation_records
    const insertedRecords: Array<{ id: number } & ReconRecord> = [];
    for (const rec of rawRecords) {
      const ins = await db.execute(sql.raw(`
        INSERT INTO reconciliation_records
          (recon_run_id, snapshot_run_id, report_date, entity_type, entity_id, entity_name,
           metric, snapshot_value, expected_value, difference, difference_pct,
           status, reason_code, reason_detail)
        VALUES (
          ${reconRunId}, ${targetRunId}, '${reportDate}',
          '${rec.entityType}',
          ${rec.entityId ? `'${rec.entityId.replace(/'/g, "''")}'` : 'NULL'},
          ${rec.entityName ? `'${rec.entityName.replace(/'/g, "''")}'` : 'NULL'},
          '${rec.metric}',
          ${rec.snapshotValue}, ${rec.expectedValue},
          ${rec.difference}, ${rec.differencePct},
          '${rec.status}',
          '${rec.reasonCode}',
          '${(rec.reasonDetail ?? '').replace(/'/g, "''")}'
        ) RETURNING id
      `));
      const id: number = (ins as any).rows?.[0]?.id;
      if (id) insertedRecords.push({ id, ...rec });
    }

    const discrepancyCount = insertedRecords.filter(r => r.status === 'discrepancy').length;

    // Update reconciliation_runs with results
    await db.execute(sql.raw(`
      UPDATE reconciliation_runs
      SET status='success', completed_at=now(),
          records_created=${insertedRecords.length}, discrepancies=${discrepancyCount},
          duration_ms=${Date.now() - startMs}
      WHERE id=${reconRunId}
    `));

    // ── AI Scan ──────────────────────────────────────────────────────────────
    const aiStartMs = Date.now();
    const aiRunRow = await db.execute(sql.raw(`
      INSERT INTO ai_scan_runs (recon_run_id, snapshot_run_id, status)
      VALUES (${reconRunId}, ${targetRunId}, 'running')
      RETURNING id
    `));
    const aiScanRunId: number = (aiRunRow as any).rows?.[0]?.id;

    let findingsCreated = 0;
    try {
      const rawFindings = runDetectors(rows, insertedRecords);

      for (const f of rawFindings) {
        await db.execute(sql.raw(`
          INSERT INTO ai_findings
            (ai_scan_id, recon_record_id, snapshot_run_id,
             snapshot_version, reconciliation_version, detector_version, rule_version,
             report_date, finding_type, severity,
             entity_type, entity_id, entity_name, metric,
             observed_value, expected_range, confidence_score, explanation, evidence_refs)
          VALUES (
            ${aiScanRunId},
            ${f.reconRecordId ?? 'NULL'},
            ${targetRunId},
            1, ${RECON_ENGINE_VERSION}, ${AI_DETECTOR_VERSION}, 1,
            '${reportDate}',
            '${f.findingType}',
            '${f.severity}',
            ${f.entityType ? `'${f.entityType}'` : 'NULL'},
            ${f.entityId   ? `'${f.entityId.replace(/'/g, "''")}'` : 'NULL'},
            ${f.entityName ? `'${f.entityName.replace(/'/g, "''")}'` : 'NULL'},
            ${f.metric     ? `'${f.metric}'` : 'NULL'},
            ${f.observedValue ?? 'NULL'},
            ${f.expectedRange ? `'${JSON.stringify(f.expectedRange)}'::jsonb` : 'NULL'},
            ${f.confidenceScore ?? 'NULL'},
            '${f.explanation.replace(/'/g, "''")}',
            ${f.evidenceRefs ? `'${JSON.stringify(f.evidenceRefs)}'::jsonb` : 'NULL'}
          )
        `));
        findingsCreated++;
      }

      await db.execute(sql.raw(`
        UPDATE ai_scan_runs
        SET status='success', completed_at=now(),
            findings_created=${findingsCreated}, duration_ms=${Date.now() - aiStartMs}
        WHERE id=${aiScanRunId}
      `));
    } catch (aiErr: any) {
      await db.execute(sql.raw(`
        UPDATE ai_scan_runs
        SET status='failed', completed_at=now(),
            error='${String(aiErr.message).replace(/'/g, "''")}', duration_ms=${Date.now() - aiStartMs}
        WHERE id=${aiScanRunId}
      `));
    }

    return {
      status: 'success',
      reconRunId,
      aiScanRunId,
      recordsCreated: insertedRecords.length,
      discrepancies: discrepancyCount,
      findingsCreated,
      durationMs: Date.now() - startMs,
    };

  } catch (err: any) {
    const errMsg = String(err.message ?? 'unknown error').replace(/'/g, "''");
    await db.execute(sql.raw(`
      UPDATE reconciliation_runs
      SET status='failed', completed_at=now(),
          error='${errMsg}', duration_ms=${Date.now() - startMs}
      WHERE id=${reconRunId}
    `));
    return { status: 'failed', reconRunId, error: err.message, durationMs: Date.now() - startMs };
  }
}

// ── Query helpers ────────────────────────────────────────────────────────────

export async function getLatestReconRun(): Promise<Record<string, unknown> | null> {
  const res = await db.execute(sql.raw(`
    SELECT rr.*, mr.report_dates AS snapshot_dates
    FROM reconciliation_runs rr
    LEFT JOIN materialization_runs mr ON mr.id = rr.snapshot_run_id
    ORDER BY rr.id DESC LIMIT 1
  `));
  return (res as any).rows?.[0] ?? null;
}

export async function getReconRuns(limit = 20): Promise<Record<string, unknown>[]> {
  const res = await db.execute(sql.raw(`
    SELECT rr.*, mr.report_dates AS snapshot_dates
    FROM reconciliation_runs rr
    LEFT JOIN materialization_runs mr ON mr.id = rr.snapshot_run_id
    ORDER BY rr.id DESC LIMIT ${limit}
  `));
  return (res as any).rows ?? [];
}

export async function getReconRecords(reconRunId: number): Promise<Record<string, unknown>[]> {
  const res = await db.execute(sql.raw(`
    SELECT * FROM reconciliation_records
    WHERE recon_run_id = ${reconRunId}
    ORDER BY status DESC, entity_type, entity_name, metric
  `));
  return (res as any).rows ?? [];
}

export async function getAiFindings(snapshotRunId?: number, limit = 50): Promise<Record<string, unknown>[]> {
  const where = snapshotRunId ? `WHERE af.snapshot_run_id = ${snapshotRunId}` : '';
  const res = await db.execute(sql.raw(`
    SELECT af.*, rr.entity_name AS recon_entity_name
    FROM ai_findings af
    LEFT JOIN reconciliation_records rr ON rr.id = af.recon_record_id
    ${where}
    ORDER BY af.severity DESC, af.created_at DESC
    LIMIT ${limit}
  `));
  return (res as any).rows ?? [];
}
