/**
 * Carrier Quality Scoring Engine
 *
 * Runs every 30 minutes.  Reads route_decision_traces from the last 24 h
 * (and 168 h), groups by selectedCarrier, computes rolling metrics, and
 * upserts into carrier_quality_scores.  Fires a ROUTE_DEGRADATION_SIGNAL
 * AI Ops event when a carrier's stability score drops below 50.
 */

import { eq, gte, desc } from 'drizzle-orm';
import { db } from './db';
import { routeDecisionTraces, carrierQualityScores, aiOpsEvents } from '../shared/schema';

let _timer: ReturnType<typeof setInterval> | null = null;

// ── Public init ───────────────────────────────────────────────────────────────
export function initCarrierScoringEngine(): void {
  if (_timer) clearInterval(_timer);
  _timer = setInterval(_run, 30 * 60_000);
  setTimeout(_run, 15_000);          // initial run 15 s after startup
  console.log('[carrier-scoring] Engine started — scoring every 30 min');
}

// ── Run ───────────────────────────────────────────────────────────────────────
async function _run(): Promise<void> {
  try {
    await _computeWindow(24);
    await _computeWindow(168);
    console.log('[carrier-scoring] Scores updated');
  } catch (e: any) {
    console.warn('[carrier-scoring] error:', e.message);
  }
}

export async function recomputeCarrierScores(): Promise<void> {
  await _computeWindow(24);
  await _computeWindow(168);
}

// ── Per-window computation ────────────────────────────────────────────────────
async function _computeWindow(hours: number): Promise<void> {
  const cutoff = new Date(Date.now() - hours * 3_600_000);

  const traces = await db.select().from(routeDecisionTraces)
    .where(gte(routeDecisionTraces.createdAt, cutoff));

  // Group by selectedCarrier
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

    // Stability score: ASR weighted 60%, low PDD weighted 20%, low failure 20%
    const pddScore  = avgPdd != null ? Math.max(0, 100 - (avgPdd / 50)) : 50;
    const stability = Math.round(asr * 0.6 + pddScore * 0.2 + (100 - failRate) * 0.2);

    // Trend: compare to previous score
    const [prev] = await db.select({ stabilityScore: carrierQualityScores.stabilityScore })
      .from(carrierQualityScores)
      .where(eq(carrierQualityScores.carrierId, carrier))
      .limit(1);
    const prevScore = prev?.stabilityScore ?? null;
    const trend = prevScore == null ? 'stable'
      : stability >= prevScore + 5 ? 'improving'
      : stability <= prevScore - 5 ? 'degrading'
      : 'stable';

    // Upsert
    const existing = await db.select({ id: carrierQualityScores.id })
      .from(carrierQualityScores)
      .where(eq(carrierQualityScores.carrierId, `${carrier}:${hours}h`))
      .limit(1);

    const payload = {
      carrierId:      `${carrier}:${hours}h`,
      carrierName:    carrier,
      windowHours:    hours,
      sampleCount:    rows.length,
      connectedCount: connected,
      failedCount:    failed,
      rollingAsr:     asr,
      avgPddMs:       avgPdd,
      p95PddMs:       p95Pdd,
      failureRate:    failRate,
      stabilityScore: stability,
      trend,
      lastComputedAt: new Date(),
    };

    if (existing.length > 0) {
      await db.update(carrierQualityScores)
        .set(payload)
        .where(eq(carrierQualityScores.carrierId, `${carrier}:${hours}h`));
    } else {
      await db.insert(carrierQualityScores).values(payload);
    }

    // AI Ops: fire ROUTE_DEGRADATION_SIGNAL if stability < 50 and 24h window
    if (hours === 24 && stability < 50 && rows.length >= 3) {
      const recentSignal = await db.select({ id: aiOpsEvents.id })
        .from(aiOpsEvents)
        .where(eq(aiOpsEvents.entity, `carrier:${carrier}`))
        .orderBy(desc(aiOpsEvents.createdAt))
        .limit(1);

      const lastFired = recentSignal[0];
      const tooRecent = lastFired != null; // simple debounce: one signal per scoring run per carrier

      if (!tooRecent) {
        await db.insert(aiOpsEvents).values({
          type:     'ROUTE_DEGRADATION_SIGNAL',
          severity: stability < 30 ? 'high' : 'medium',
          message:  `Carrier "${carrier}" stability score dropped to ${stability}/100. ASR: ${asr.toFixed(1)}%, Avg PDD: ${avgPdd?.toFixed(0) ?? 'n/a'}ms, Failure rate: ${failRate.toFixed(1)}%. Based on ${rows.length} synthetic test calls in last 24h.`,
          entity:   `carrier:${carrier}`,
          value:    String(stability),
          source:   'carrier_scoring_engine',
        });
        console.warn(`[carrier-scoring] ROUTE_DEGRADATION_SIGNAL fired for "${carrier}" (stability=${stability})`);
      }
    }
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function _percentile(sorted: number[], p: number): number {
  const arr = [...sorted].sort((a, b) => a - b);
  const idx = Math.floor((p / 100) * arr.length);
  return arr[Math.min(idx, arr.length - 1)];
}
