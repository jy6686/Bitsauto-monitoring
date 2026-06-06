/**
 * sippy-ai-assurance.service.ts
 *
 * AI Revenue Assurance Layer — Advisory-Only Anomaly Detection
 *
 * GOVERNANCE RULE: AI must remain advisory only.
 *   AI suggests → Human approves → Platform acts.
 *   Never autonomous finance actions.
 *
 * Detectors:
 *   1. margin_collapse      — DMR-based margin compression (current vs prior window)
 *   2. asr_drop             — unusual ASR decline pattern
 *   3. revenue_drop         — period-over-period revenue fall
 *   4. reconciliation_drift — unusual variance rate in reconciliation data
 *   5. credit_note_clustering — abnormal credit note accumulation for a client
 *
 * All detectors:
 *   - Read from stable stored data (DMR, invoices, reconciliation, credit notes)
 *   - Compute anomaly_score 0-100 (higher = more anomalous)
 *   - Store evidence as JSON for full audit traceability
 *   - Are idempotent (won't re-create identical OPEN alerts within 24h)
 */

import { storage } from '../../storage';
import type { AiRevenueAlert, InsertAiRevenueAlert, AiScanRun } from '@shared/schema';
import { matchCdrBatch, type CdrRecord } from '../billing/cdr-match';

// ── CDR pool provider (injected from routes.ts after cache is warm) ───────────
type CdrPoolFn = () => CdrRecord[];
let _cdrPoolFn: CdrPoolFn | null = null;
export function setAssuranceCdrProvider(fn: CdrPoolFn) { _cdrPoolFn = fn; }

function sampleImplicatedCdrs(
  iAccount: number | null | undefined,
  windowFrom: string,
  windowTo: string,
  topN = 10,
): string[] {
  if (!_cdrPoolFn) return [];
  try {
    const pool = _cdrPoolFn();
    const fromMs = new Date(windowFrom).getTime();
    const toMs   = new Date(windowTo).getTime();
    const candidates = pool.filter(c => {
      const ts = c.startTime ? new Date(c.startTime as any).getTime() : null;
      if (!ts || ts < fromMs || ts > toMs) return false;
      if (iAccount && (c as any).iAccount && (c as any).iAccount !== iAccount) return false;
      return true;
    });
    candidates.sort((a, b) => Number(b.cost ?? 0) - Number(a.cost ?? 0));
    return candidates.slice(0, topN).map(c => c.callId ?? '').filter(Boolean);
  } catch { return []; }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DetectorResult {
  alertsCreated: number;
  detectorName:  string;
  durationMs:    number;
  summary:       string;
}

export interface ScanResult {
  scanRunId:      number;
  totalAlerts:    number;
  detectorResults: DetectorResult[];
  durationMs:     number;
}

// ── Severity from anomaly score ────────────────────────────────────────────────

function scoreSeverity(score: number): string {
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 35) return 'medium';
  return 'low';
}

// ── Idempotency check — don't re-create same open alert within 24h ─────────────

async function alertAlreadyOpen(alertType: string, clientName?: string): Promise<boolean> {
  const existing = await storage.listAiAlerts({ status: 'OPEN', alertType });
  const cutoff   = Date.now() - 86400000;
  return existing.some(a =>
    a.alertType === alertType &&
    (a.clientName ?? null) === (clientName ?? null) &&
    new Date(a.detectedOn).getTime() > cutoff,
  );
}

// ── Create an alert ────────────────────────────────────────────────────────────

async function createAlert(data: Omit<InsertAiRevenueAlert, 'status'>): Promise<AiRevenueAlert | null> {
  if (await alertAlreadyOpen(data.alertType, data.clientName ?? undefined)) return null;
  return storage.createAiAlert({ ...data, status: 'OPEN' });
}

// ─────────────────────────────────────────────────────────────────────────────
// DETECTOR 1: Margin Collapse
// Compares total revenue vs cost from DMR reports over last 7 days vs prior 7.
// Triggers if current margin rate drops > 20% vs baseline.
// ─────────────────────────────────────────────────────────────────────────────

export async function detectMarginCollapse(): Promise<DetectorResult> {
  const t0 = Date.now();
  let alertsCreated = 0;

  try {
    const today    = new Date();
    const d7ago    = new Date(today.getTime() - 7 * 86400000).toISOString().slice(0, 10);
    const d14ago   = new Date(today.getTime() - 14 * 86400000).toISOString().slice(0, 10);
    const todayStr = today.toISOString().slice(0, 10);

    const recentReports = await storage.listDMRReports({ fromDate: d7ago,  toDate: todayStr }).catch(() => []);
    const priorReports  = await storage.listDMRReports({ fromDate: d14ago, toDate: d7ago   }).catch(() => []);

    if (recentReports.length < 2 || priorReports.length < 2) {
      return { alertsCreated: 0, detectorName: 'margin_collapse', durationMs: Date.now() - t0, summary: 'Insufficient DMR data' };
    }

    const sumDMR = (reports: any[]) => reports.reduce((acc, r) => ({
      revenue: acc.revenue + (r.totalRevenue ?? 0),
      cost:    acc.cost    + (r.totalCost    ?? 0),
    }), { revenue: 0, cost: 0 });

    const recent = sumDMR(recentReports);
    const prior  = sumDMR(priorReports);

    const recentMargin = recent.revenue > 0 ? (recent.revenue - recent.cost) / recent.revenue : 0;
    const priorMargin  = prior.revenue  > 0 ? (prior.revenue  - prior.cost)  / prior.revenue  : 0;

    if (priorMargin <= 0) {
      return { alertsCreated: 0, detectorName: 'margin_collapse', durationMs: Date.now() - t0, summary: 'No positive baseline margin' };
    }

    const deviationPct = ((priorMargin - recentMargin) / Math.abs(priorMargin)) * 100;

    if (deviationPct >= 20) {
      const anomalyScore = Math.min(100, Math.round(40 + deviationPct * 1.5));
      const alert = await createAlert({
        alertType:     'margin_collapse',
        severity:      scoreSeverity(anomalyScore),
        anomalyScore,
        billingPeriod: d7ago.slice(0, 7),
        baselineValue: +(priorMargin  * 100).toFixed(2),
        currentValue:  +(recentMargin * 100).toFixed(2),
        deviationPct:  +deviationPct.toFixed(2),
        evidence: {
          priorWindow:   { from: d14ago, to: d7ago,   revenue: prior.revenue,  cost: prior.cost,   margin_pct: +(priorMargin * 100).toFixed(2) },
          recentWindow:  { from: d7ago,  to: todayStr, revenue: recent.revenue, cost: recent.cost,  margin_pct: +(recentMargin * 100).toFixed(2) },
          reportCount:   { recent: recentReports.length, prior: priorReports.length },
          implicatedCdrIds: sampleImplicatedCdrs(null, d7ago, todayStr, 10),
        },
        recommendedAction: `Margin compressed ${deviationPct.toFixed(1)}% vs prior window. Investigate: vendor cost spike, rate erosion, or traffic mix shift. Check carrier reconciliation and tariff versions.`,
      });
      if (alert) alertsCreated++;
    }
  } catch (err: any) {
    console.error('[ai-assurance] margin_collapse error:', err.message);
  }

  return { alertsCreated, detectorName: 'margin_collapse', durationMs: Date.now() - t0, summary: alertsCreated > 0 ? 'Margin collapse detected' : 'Within normal range' };
}

// ─────────────────────────────────────────────────────────────────────────────
// DETECTOR 2: ASR Drop
// Reads from stored DMR ASR field. Compares 7-day vs prior 7-day average ASR.
// Triggers if current ASR drops > 15% vs baseline.
// ─────────────────────────────────────────────────────────────────────────────

export async function detectASRDrop(): Promise<DetectorResult> {
  const t0 = Date.now();
  let alertsCreated = 0;

  try {
    const today    = new Date();
    const d7ago    = new Date(today.getTime() - 7  * 86400000).toISOString().slice(0, 10);
    const d14ago   = new Date(today.getTime() - 14 * 86400000).toISOString().slice(0, 10);
    const todayStr = today.toISOString().slice(0, 10);

    const recentReports = await storage.listDMRReports({ fromDate: d7ago,  toDate: todayStr }).catch(() => []);
    const priorReports  = await storage.listDMRReports({ fromDate: d14ago, toDate: d7ago   }).catch(() => []);

    const avgASR = (reports: any[]) => {
      const valid = reports.filter(r => r.asr != null);
      return valid.length > 0 ? valid.reduce((s, r) => s + r.asr, 0) / valid.length : null;
    };

    const recentASR = avgASR(recentReports);
    const priorASR  = avgASR(priorReports);

    if (recentASR == null || priorASR == null || priorASR <= 0) {
      return { alertsCreated: 0, detectorName: 'asr_drop', durationMs: Date.now() - t0, summary: 'Insufficient ASR data' };
    }

    const deviationPct = ((priorASR - recentASR) / priorASR) * 100;

    if (deviationPct >= 15) {
      const anomalyScore = Math.min(100, Math.round(35 + deviationPct * 2));
      const alert = await createAlert({
        alertType:     'asr_drop',
        severity:      scoreSeverity(anomalyScore),
        anomalyScore,
        baselineValue: +priorASR.toFixed(2),
        currentValue:  +recentASR.toFixed(2),
        deviationPct:  +deviationPct.toFixed(2),
        evidence: {
          priorWindow:  { from: d14ago, to: d7ago,   avg_asr: +priorASR.toFixed(2),  sample_size: priorReports.length  },
          recentWindow: { from: d7ago,  to: todayStr, avg_asr: +recentASR.toFixed(2), sample_size: recentReports.length },
        },
        recommendedAction: `ASR dropped ${deviationPct.toFixed(1)}% vs prior window (${recentASR.toFixed(1)}% vs ${priorASR.toFixed(1)}%). Check network health, routing changes, and vendor quality. Review RTP quality metrics.`,
      });
      if (alert) alertsCreated++;
    }
  } catch (err: any) {
    console.error('[ai-assurance] asr_drop error:', err.message);
  }

  return { alertsCreated, detectorName: 'asr_drop', durationMs: Date.now() - t0, summary: alertsCreated > 0 ? 'ASR anomaly detected' : 'Within normal range' };
}

// ─────────────────────────────────────────────────────────────────────────────
// DETECTOR 3: Revenue Drop
// Compares current month invoice totals vs previous month.
// Triggers if revenue drops > 25%.
// ─────────────────────────────────────────────────────────────────────────────

export async function detectRevenueDrop(): Promise<DetectorResult> {
  const t0 = Date.now();
  let alertsCreated = 0;

  try {
    const now          = new Date();
    const curYear      = now.getFullYear();
    const curMonth     = now.getMonth() + 1;
    const prevMonth    = curMonth === 1 ? 12 : curMonth - 1;
    const prevYear     = curMonth === 1 ? curYear - 1 : curYear;
    const curPeriod    = `${curYear}-${String(curMonth).padStart(2, '0')}`;
    const prevPeriod   = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;

    const allInvoices  = await storage.listInvoices({}).catch(() => []);
    const curInvoices  = allInvoices.filter((i: any) => i.billingPeriod === curPeriod  && i.status !== 'cancelled');
    const prevInvoices = allInvoices.filter((i: any) => i.billingPeriod === prevPeriod && i.status !== 'cancelled');

    if (prevInvoices.length === 0) {
      return { alertsCreated: 0, detectorName: 'revenue_drop', durationMs: Date.now() - t0, summary: 'No prior period invoices' };
    }

    const sumRevenue = (invs: any[]) => invs.reduce((s: number, i: any) => s + (i.totalAmountUsd ?? 0), 0);
    const curRevenue  = sumRevenue(curInvoices);
    const prevRevenue = sumRevenue(prevInvoices);

    if (prevRevenue <= 0) {
      return { alertsCreated: 0, detectorName: 'revenue_drop', durationMs: Date.now() - t0, summary: 'No positive prior revenue' };
    }

    const deviationPct = ((prevRevenue - curRevenue) / prevRevenue) * 100;

    if (deviationPct >= 25) {
      // Per-client breakdown
      const clientRevenue: Record<string, { cur: number; prev: number }> = {};
      [...curInvoices, ...prevInvoices].forEach((i: any) => {
        if (!clientRevenue[i.clientName]) clientRevenue[i.clientName] = { cur: 0, prev: 0 };
        if (i.billingPeriod === curPeriod)  clientRevenue[i.clientName].cur  += i.totalAmountUsd ?? 0;
        if (i.billingPeriod === prevPeriod) clientRevenue[i.clientName].prev += i.totalAmountUsd ?? 0;
      });

      const anomalyScore = Math.min(100, Math.round(40 + deviationPct));
      const alert = await createAlert({
        alertType:     'revenue_drop',
        severity:      scoreSeverity(anomalyScore),
        anomalyScore,
        billingPeriod: curPeriod,
        baselineValue: +prevRevenue.toFixed(2),
        currentValue:  +curRevenue.toFixed(2),
        deviationPct:  +deviationPct.toFixed(2),
        evidence: {
          currentPeriod:  { period: curPeriod,  invoiceCount: curInvoices.length,  totalUsd: +curRevenue.toFixed(2)  },
          previousPeriod: { period: prevPeriod, invoiceCount: prevInvoices.length, totalUsd: +prevRevenue.toFixed(2) },
          clientBreakdown: Object.entries(clientRevenue).map(([name, v]) => ({
            client: name, curUsd: +v.cur.toFixed(2), prevUsd: +v.prev.toFixed(2),
            delta: +(v.cur - v.prev).toFixed(2),
          })).sort((a, b) => a.delta - b.delta).slice(0, 5),
        },
        recommendedAction: `Revenue down ${deviationPct.toFixed(1)}% ($${curRevenue.toFixed(2)} vs $${prevRevenue.toFixed(2)}). Identify clients with reduced billing. Check for churn, volume decline, or pricing changes.`,
      });
      if (alert) alertsCreated++;
    }
  } catch (err: any) {
    console.error('[ai-assurance] revenue_drop error:', err.message);
  }

  return { alertsCreated, detectorName: 'revenue_drop', durationMs: Date.now() - t0, summary: alertsCreated > 0 ? 'Revenue anomaly detected' : 'Within normal range' };
}

// ─────────────────────────────────────────────────────────────────────────────
// DETECTOR 4: Reconciliation Drift
// Checks for high variance rate in recent reconciliation records.
// Triggers if total unresolved variance > 10% of billed amount.
// ─────────────────────────────────────────────────────────────────────────────

export async function detectReconciliationDrift(): Promise<DetectorResult> {
  const t0 = Date.now();
  let alertsCreated = 0;

  try {
    const allRecs = await storage.listReconciliationRecords({}).catch(() => []);
    if (allRecs.length === 0) {
      return { alertsCreated: 0, detectorName: 'reconciliation_drift', durationMs: Date.now() - t0, summary: 'No reconciliation records' };
    }

    // Focus on recent unresolved records
    const cutoff = new Date(Date.now() - 90 * 86400000);
    const recent = allRecs.filter((r: any) => r.status !== 'reconciled' && new Date(r.createdAt) > cutoff);

    if (recent.length === 0) {
      return { alertsCreated: 0, detectorName: 'reconciliation_drift', durationMs: Date.now() - t0, summary: 'No unresolved recent records' };
    }

    const totalBilled    = recent.reduce((s: number, r: any) => s + Math.abs(r.billedAmountUsd ?? r.totalAmountUsd ?? 0), 0);
    const totalVariance  = recent.reduce((s: number, r: any) => s + Math.abs(r.varianceUsd ?? r.variance ?? 0), 0);
    const varianceRate   = totalBilled > 0 ? (totalVariance / totalBilled) * 100 : 0;

    if (varianceRate >= 10) {
      const anomalyScore = Math.min(100, Math.round(30 + varianceRate * 2));

      // Top clients by variance
      const byClient: Record<string, number> = {};
      recent.forEach((r: any) => {
        const name = r.clientName ?? r.vendorName ?? 'unknown';
        byClient[name] = (byClient[name] ?? 0) + Math.abs(r.varianceUsd ?? r.variance ?? 0);
      });
      const topClients = Object.entries(byClient)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([name, variance]) => ({ name, varianceUsd: +variance.toFixed(2) }));

      const alert = await createAlert({
        alertType:     'reconciliation_drift',
        severity:      scoreSeverity(anomalyScore),
        anomalyScore,
        baselineValue: 0,
        currentValue:  +varianceRate.toFixed(2),
        deviationPct:  +varianceRate.toFixed(2),
        evidence: {
          unresolvedRecords: recent.length,
          totalBilledUsd:    +totalBilled.toFixed(2),
          totalVarianceUsd:  +totalVariance.toFixed(2),
          varianceRatePct:   +varianceRate.toFixed(2),
          topClientsByVariance: topClients,
        },
        recommendedAction: `${varianceRate.toFixed(1)}% reconciliation variance rate across ${recent.length} unresolved records ($${totalVariance.toFixed(2)} unreconciled). Review top variance clients and validate CDR snapshots.`,
      });
      if (alert) alertsCreated++;
    }
  } catch (err: any) {
    console.error('[ai-assurance] reconciliation_drift error:', err.message);
  }

  return { alertsCreated, detectorName: 'reconciliation_drift', durationMs: Date.now() - t0, summary: alertsCreated > 0 ? 'Drift anomaly detected' : 'Within normal range' };
}

// ─────────────────────────────────────────────────────────────────────────────
// DETECTOR 5: Credit Note Clustering
// Detects unusual accumulation of credit notes for a single client.
// Triggers if a client has > 3 credit notes in 30 days with significant value.
// ─────────────────────────────────────────────────────────────────────────────

export async function detectCreditNoteClustering(): Promise<DetectorResult> {
  const t0 = Date.now();
  let alertsCreated = 0;

  try {
    const year     = String(new Date().getFullYear());
    const allNotes = await storage.listCreditNotes({ year }).catch(() => []);
    const cutoff   = new Date(Date.now() - 30 * 86400000);
    const recent   = allNotes.filter((n: any) => n.status !== 'VOID' && new Date(n.createdAt) > cutoff);

    // Group by client
    const byClient: Record<string, { count: number; totalUsd: number; types: string[] }> = {};
    recent.forEach((n: any) => {
      if (!byClient[n.clientName]) byClient[n.clientName] = { count: 0, totalUsd: 0, types: [] };
      byClient[n.clientName].count++;
      byClient[n.clientName].totalUsd += n.amountUsd;
      if (!byClient[n.clientName].types.includes(n.creditType)) byClient[n.clientName].types.push(n.creditType);
    });

    for (const [clientName, stats] of Object.entries(byClient)) {
      if (stats.count >= 3 && stats.totalUsd >= 100) {
        const anomalyScore = Math.min(100, Math.round(25 + stats.count * 8 + Math.min(40, stats.totalUsd / 10)));
        const alert = await createAlert({
          alertType:     'credit_note_clustering',
          severity:      scoreSeverity(anomalyScore),
          anomalyScore,
          clientName,
          currentValue:  +stats.totalUsd.toFixed(2),
          deviationPct:  stats.count,
          evidence: {
            creditNoteCount:  stats.count,
            totalCreditedUsd: +stats.totalUsd.toFixed(2),
            creditTypes:      stats.types,
            windowDays:       30,
          },
          recommendedAction: `${clientName} has ${stats.count} credit notes ($${stats.totalUsd.toFixed(2)} total) in the last 30 days. Investigate billing accuracy, dispute patterns, and relationship health.`,
        });
        if (alert) alertsCreated++;
      }
    }
  } catch (err: any) {
    console.error('[ai-assurance] credit_note_clustering error:', err.message);
  }

  return { alertsCreated, detectorName: 'credit_note_clustering', durationMs: Date.now() - t0, summary: alertsCreated > 0 ? `${alertsCreated} client(s) flagged` : 'No clustering detected' };
}

// ─────────────────────────────────────────────────────────────────────────────
// ORCHESTRATOR: Run full scan
// ─────────────────────────────────────────────────────────────────────────────

export async function runFullScan(triggeredBy = 'operator'): Promise<ScanResult> {
  const globalStart = Date.now();
  const scanRun     = await storage.createScanRun({ triggeredBy, status: 'running' });

  const detectors = [
    detectMarginCollapse,
    detectASRDrop,
    detectRevenueDrop,
    detectReconciliationDrift,
    detectCreditNoteClustering,
  ];

  let totalAlerts     = 0;
  const detectorResults: DetectorResult[] = [];

  for (const detector of detectors) {
    const result = await detector().catch(err => ({
      alertsCreated: 0,
      detectorName:  detector.name,
      durationMs:    0,
      summary:       `Error: ${err.message}`,
    }));
    totalAlerts += result.alertsCreated;
    detectorResults.push(result);
  }

  const durationMs = Date.now() - globalStart;

  await storage.updateScanRun(scanRun.id, {
    status:       'completed',
    alertsCreated: totalAlerts,
    detectorsRan:  detectors.length,
    durationMs,
    completedAt:   new Date(),
  });

  console.log(`[ai-assurance] scan #${scanRun.id} completed in ${durationMs}ms — ${totalAlerts} alert(s) created`);
  return { scanRunId: scanRun.id, totalAlerts, detectorResults, durationMs };
}

// ── Alert lifecycle ────────────────────────────────────────────────────────────

export async function reviewAlert(id: number, reviewedBy: string): Promise<AiRevenueAlert> {
  return storage.updateAiAlert(id, { status: 'REVIEWING', reviewedBy, reviewedAt: new Date() });
}

export async function dismissAlert(id: number, reason: string, reviewedBy: string): Promise<AiRevenueAlert> {
  return storage.updateAiAlert(id, { status: 'DISMISSED', dismissedReason: reason, reviewedBy, reviewedAt: new Date() });
}

export async function resolveAlert(id: number, reviewedBy: string): Promise<AiRevenueAlert> {
  return storage.updateAiAlert(id, { status: 'RESOLVED', reviewedBy, reviewedAt: new Date(), resolvedAt: new Date() });
}
