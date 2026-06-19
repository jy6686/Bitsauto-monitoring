/**
 * Carrier Quality Scoring Engine
 *
 * Runs every 30 minutes. Two data sources:
 *   1. route_decision_traces — synthetic test call outcomes (simulation mode)
 *   2. CDR cache provider    — real live-traffic CDRs grouped by vendor name
 *
 * Upserts into carrier_quality_scores so trends accumulate over time even
 * when simulation is disabled.  Fires ROUTE_DEGRADATION_SIGNAL AI Ops events
 * when a carrier's stability score drops below 50 with sufficient samples.
 */

import { eq, gte, desc } from 'drizzle-orm';
import { db } from './db';
import { routeDecisionTraces, carrierQualityScores, aiOpsEvents } from '../shared/schema';
import { invalidateCopilotSummaryCache } from './routes-ai-copilot';

// ── CDR provider ──────────────────────────────────────────────────────────────
// Routes.ts registers this after the CDR cache is warm.  The function accepts
// a cutoff timestamp (ms) and returns pre-filtered, vendor-enriched CDRs.

export interface CdrRecord {
  vendor?: string;
  duration: number;
  totalDuration?: number;
  pdd?: number;
  result?: string;
}

type CdrProviderFn = (cutoffMs: number) => CdrRecord[];

let _cdrProvider: CdrProviderFn | null = null;

export function setCdrProvider(fn: CdrProviderFn): void {
  _cdrProvider = fn;
}

// ── Timer ─────────────────────────────────────────────────────────────────────
let _timer: ReturnType<typeof setInterval> | null = null;

export function initCarrierScoringEngine(): void {
  if (_timer) clearInterval(_timer);
  _timer = setInterval(_run, 30 * 60_000);
  // Delay initial run until after CDR cache warmup (60 s) + 30 s buffer
  setTimeout(_run, 90_000);
  console.log('[carrier-scoring] Engine started — scoring every 30 min (first run at T+90s)');
}

// ── Run ───────────────────────────────────────────────────────────────────────
async function _run(): Promise<void> {
  try {
    await _computeWindow(24);
    await _computeWindow(168);
    await _computeFromCdrs(24);
    await _computeFromCdrs(168);
    console.log('[carrier-scoring] Scores updated');
    invalidateCopilotSummaryCache();
  } catch (e: any) {
    console.warn('[carrier-scoring] error:', e.message);
  }
}

export async function recomputeCarrierScores(): Promise<void> {
  await _computeWindow(24);
  await _computeWindow(168);
  await _computeFromCdrs(24);
  await _computeFromCdrs(168);
  invalidateCopilotSummaryCache();
}

// ── Trace-based computation (simulation mode) ─────────────────────────────────
async function _computeWindow(hours: number): Promise<void> {
  const cutoff = new Date(Date.now() - hours * 3_600_000);

  const traces = await db.select().from(routeDecisionTraces)
    .where(gte(routeDecisionTraces.createdAt, cutoff));

  if (traces.length === 0) return;

  const groups = new Map<string, typeof traces>();
  for (const t of traces) {
    const key = t.selectedCarrier ?? 'unknown';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }

  for (const [carrier, rows] of groups.entries()) {
    const connected = rows.filter(r => r.outcome === 'connected').length;
    const failed    = rows.length - connected;
    const asr       = rows.length > 0 ? (connected / rows.length) * 100 : 0;
    const pddRows   = rows.filter(r => r.pddMs != null && r.pddMs > 0).map(r => r.pddMs!);
    const avgPdd    = pddRows.length > 0 ? pddRows.reduce((a, b) => a + b, 0) / pddRows.length : null;
    const p95Pdd    = pddRows.length > 0 ? _percentile(pddRows, 95) : null;
    const failRate  = rows.length > 0 ? (failed / rows.length) * 100 : 0;
    const pddScore  = avgPdd != null ? Math.max(0, 100 - (avgPdd / 50)) : 50;
    const stability = Math.round(asr * 0.6 + pddScore * 0.2 + (100 - failRate) * 0.2);
    // ACD: traces don't carry a duration field; leave null (CDR path is authoritative for ACD)
    const avgAcd: number | null = null;

    await _upsertScore({
      carrierId: `${carrier}:${hours}h`,
      carrierName: carrier,
      hours, rows: rows.length, connected, failed,
      asr, avgAcd, avgPdd, p95Pdd, failRate, stability,
    });

    if (hours === 24 && stability < 50 && rows.length >= 3) {
      await _maybeFireSignal(carrier, stability, asr, avgPdd, failRate, rows.length);
    }
  }
}

// ── CDR-based computation (real live traffic, always available) ───────────────
async function _computeFromCdrs(hours: number): Promise<void> {
  if (!_cdrProvider) return;

  const cutoffMs = Date.now() - hours * 3_600_000;
  const cdrs = _cdrProvider(cutoffMs);
  if (cdrs.length === 0) return;

  const groups = new Map<string, CdrRecord[]>();
  for (const c of cdrs) {
    const vendor = (c.vendor ?? '').trim() || 'Unknown';
    if (!groups.has(vendor)) groups.set(vendor, []);
    groups.get(vendor)!.push(c);
  }

  for (const [carrier, rows] of groups.entries()) {
    if (rows.length < 3) continue;

    const connectedRows = rows.filter(r => (r.totalDuration ?? r.duration ?? 0) > 0);
    const connected = connectedRows.length;
    const failed    = rows.length - connected;
    const asr       = rows.length > 0 ? (connected / rows.length) * 100 : 0;
    const pddRowsMs = rows.filter(r => r.pdd && r.pdd > 0).map(r => r.pdd! * 1000);
    const avgPdd    = pddRowsMs.length > 0 ? pddRowsMs.reduce((a, b) => a + b, 0) / pddRowsMs.length : null;
    const p95Pdd    = pddRowsMs.length > 0 ? _percentile(pddRowsMs, 95) : null;
    const failRate  = rows.length > 0 ? (failed / rows.length) * 100 : 0;
    const pddScore  = avgPdd != null ? Math.max(0, 100 - (avgPdd / 50)) : 50;
    const stability = Math.round(asr * 0.6 + pddScore * 0.2 + (100 - failRate) * 0.2);
    // ACD: average duration (seconds) of connected calls only
    const acdDurations = connectedRows.map(r => r.totalDuration ?? r.duration ?? 0).filter(d => d > 0);
    const avgAcd = acdDurations.length > 0
      ? acdDurations.reduce((a, b) => a + b, 0) / acdDurations.length
      : null;

    await _upsertScore({
      carrierId: `${carrier}:${hours}h`,
      carrierName: carrier,
      hours, rows: rows.length, connected, failed,
      asr, avgAcd, avgPdd, p95Pdd, failRate, stability,
    });

    if (hours === 24 && stability < 50 && rows.length >= 10) {
      await _maybeFireSignal(carrier, stability, asr, avgPdd, failRate, rows.length);
    }
  }
}

// ── Shared upsert ─────────────────────────────────────────────────────────────
async function _upsertScore(p: {
  carrierId: string; carrierName: string; hours: number;
  rows: number; connected: number; failed: number;
  asr: number; avgAcd: number | null; avgPdd: number | null; p95Pdd: number | null;
  failRate: number; stability: number;
}): Promise<void> {
  const [prev] = await db.select({ stabilityScore: carrierQualityScores.stabilityScore })
    .from(carrierQualityScores)
    .where(eq(carrierQualityScores.carrierId, p.carrierId))
    .limit(1);

  const prevScore = prev?.stabilityScore ?? null;
  const trend = prevScore == null ? 'stable'
    : p.stability >= prevScore + 5 ? 'improving'
    : p.stability <= prevScore - 5 ? 'degrading'
    : 'stable';

  const payload = {
    carrierId:      p.carrierId,
    carrierName:    p.carrierName,
    windowHours:    p.hours,
    sampleCount:    p.rows,
    connectedCount: p.connected,
    failedCount:    p.failed,
    rollingAsr:     p.asr,
    avgAcdSecs:     p.avgAcd,
    avgPddMs:       p.avgPdd,
    p95PddMs:       p.p95Pdd,
    failureRate:    p.failRate,
    stabilityScore: p.stability,
    trend,
    lastComputedAt: new Date(),
  };

  const existing = await db.select({ id: carrierQualityScores.id })
    .from(carrierQualityScores)
    .where(eq(carrierQualityScores.carrierId, p.carrierId))
    .limit(1);

  if (existing.length > 0) {
    await db.update(carrierQualityScores).set(payload)
      .where(eq(carrierQualityScores.carrierId, p.carrierId));
  } else {
    await db.insert(carrierQualityScores).values(payload);
  }
}

// ── AI Ops signal ─────────────────────────────────────────────────────────────
async function _maybeFireSignal(
  carrier: string, stability: number, asr: number,
  avgPdd: number | null, failRate: number, sampleCount: number,
): Promise<void> {
  const recentSignal = await db.select({ id: aiOpsEvents.id })
    .from(aiOpsEvents)
    .where(eq(aiOpsEvents.entity, `carrier:${carrier}`))
    .orderBy(desc(aiOpsEvents.createdAt))
    .limit(1);

  if (recentSignal[0]) return;

  await db.insert(aiOpsEvents).values({
    type:     'ROUTE_DEGRADATION_SIGNAL',
    severity: stability < 30 ? 'high' : 'medium',
    message:  `Carrier "${carrier}" stability score dropped to ${stability}/100. ASR: ${asr.toFixed(1)}%, Avg PDD: ${avgPdd?.toFixed(0) ?? 'n/a'}ms, Failure rate: ${failRate.toFixed(1)}%. Based on ${sampleCount} calls in last 24h.`,
    entity:   `carrier:${carrier}`,
    value:    String(stability),
    source:   'carrier_scoring_engine',
  });
  console.warn(`[carrier-scoring] ROUTE_DEGRADATION_SIGNAL fired for "${carrier}" (stability=${stability})`);
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function _percentile(sorted: number[], p: number): number {
  const arr = [...sorted].sort((a, b) => a - b);
  const idx = Math.floor((p / 100) * arr.length);
  return arr[Math.min(idx, arr.length - 1)];
}
