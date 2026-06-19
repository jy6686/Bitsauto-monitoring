// server/vendor-stability.ts
// Vendor Stability Timeline — writes Q-score snapshots every 30 min per vendor.
// Uses CDR cache + fasEvents. Zero extra Sippy calls.

import { db } from "./db";
import { vendorStabilitySnapshots, fasEvents } from "@shared/schema";
import { gte, desc, eq, and } from "drizzle-orm";
import { matchPrefix } from "./vendor-prefix-intelligence";
import type { SippyCDR } from "./sippy";

// ── Stability classifier ───────────────────────────────────────────────────────
// Takes an ordered (oldest→newest) array of Q-scores.
type StabilityLabel = 'stable' | 'oscillating' | 'degrading' | 'recovering' | 'insufficient' | 'unknown';

function classifyStability(scores: number[]): StabilityLabel {
  if (scores.length < 4) return 'insufficient';

  const recent = scores.slice(-8); // last 8 snapshots (≤4h at 30-min intervals)
  const n = recent.length;
  const mean = recent.reduce((a, b) => a + b, 0) / n;
  const variance = recent.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const stddev = Math.sqrt(variance);

  // Trend: compare first half vs second half mean
  const mid = Math.floor(n / 2);
  const firstHalfMean = recent.slice(0, mid).reduce((a, b) => a + b, 0) / mid;
  const secondHalfMean = recent.slice(mid).reduce((a, b) => a + b, 0) / (n - mid);
  const trend = secondHalfMean - firstHalfMean;

  if (stddev <= 6)              return 'stable';
  if (trend <= -8 && stddev > 5) return 'degrading';
  if (trend >= 8  && stddev > 5) return 'recovering';
  if (stddev > 10)               return 'oscillating';
  return 'stable';
}

// ── Q-Score computation (vendor level) ────────────────────────────────────────
function computeVendorQ(
  calls: number, answered: number, nerAnswered: number,
  pddSum: number, pddCount: number, fasCount: number,
): { q: number; asr: number; ner: number; avgPdd: number; fasRate: number } {
  const asr      = calls > 0 ? (answered / calls) * 100 : 0;
  const ner      = calls > 0 ? (nerAnswered / calls) * 100 : 0;
  const avgPdd   = pddCount > 0 ? pddSum / pddCount : 0;
  const fasRate  = calls > 0 ? fasCount / calls : 0;

  const asrPts  = Math.round((asr / 100) * 40);
  const nerPts  = Math.round((ner / 100) * 30);
  const fasPts  = Math.round((1 - Math.min(1, fasRate)) * 20);
  const pddNorm = Math.max(0, Math.min(1, 1 - (avgPdd - 2) / 18));
  const pddPts  = Math.round(pddNorm * 10);
  const q       = asrPts + nerPts + fasPts + pddPts;

  return {
    q: Math.max(0, Math.min(100, q)),
    asr: Math.round(asr * 10) / 10,
    ner: Math.round(ner * 10) / 10,
    avgPdd: Math.round(avgPdd * 10) / 10,
    fasRate: Math.round(fasRate * 1000) / 10,
  };
}

// ── Main snapshot function — called every 30 min ──────────────────────────────
export async function snapshotVendorStability(cdrCache: Map<string, SippyCDR>): Promise<void> {
  try {
    const now    = Date.now();
    const dayAgo = new Date(now - 24 * 60 * 60 * 1000);

    // Load recent FAS events keyed by vendor
    const recentFas = await db.select({ vendor: fasEvents.vendor, callee: fasEvents.callee })
      .from(fasEvents).where(gte(fasEvents.detectedAt, dayAgo));

    const fasPerVendor = new Map<string, number>();
    for (const ev of recentFas) {
      if (!ev.vendor) continue;
      fasPerVendor.set(ev.vendor, (fasPerVendor.get(ev.vendor) ?? 0) + 1);
    }

    // Bucket CDRs by vendor for last 24h
    interface Acc {
      calls: number; answered: number; nerAnswered: number;
      pddSum: number; pddCount: number;
    }
    const buckets = new Map<string, Acc>();
    const sinceMs = now - 24 * 60 * 60 * 1000;

    for (const c of Array.from(cdrCache.values())) {
      const ts = c.startTime
        ? (typeof (c as any).startTime === 'number'
            ? (c as any).startTime * 1000
            : new Date(c.startTime as any).getTime())
        : 0;
      if (!ts || ts < sinceMs) continue;

      const vendor = (c as any).vendor as string | undefined;
      if (!vendor || vendor === 'Unknown') continue;

      const isAnswered = String(c.result) === '0' || Number(c.result) === 0;
      const dur        = Number(c.totalDuration ?? c.duration ?? 0);
      const pdd        = Number(c.pdd1xx ?? c.pdd ?? 0);

      const acc = buckets.get(vendor) ?? { calls: 0, answered: 0, nerAnswered: 0, pddSum: 0, pddCount: 0 };
      acc.calls++;
      if (isAnswered) { acc.answered++; if (dur > 5) acc.nerAnswered++; }
      if (pdd > 0 && pdd < 60) { acc.pddSum += pdd; acc.pddCount++; }
      buckets.set(vendor, acc);
    }

    if (buckets.size === 0) return; // nothing to snapshot

    // For each vendor, compute Q and get recent history for stability classification
    const ts = new Date();

    for (const [vendor, acc] of Array.from(buckets)) {
      if (acc.calls < 5) continue; // skip very low volume vendors

      const fasCount = fasPerVendor.get(vendor) ?? 0;
      const metrics  = computeVendorQ(acc.calls, acc.answered, acc.nerAnswered, acc.pddSum, acc.pddCount, fasCount);

      // Load last 8 snapshots for stability classification
      const history = await db.select({ qScore: vendorStabilitySnapshots.qScore })
        .from(vendorStabilitySnapshots)
        .where(eq(vendorStabilitySnapshots.vendor, vendor))
        .orderBy(desc(vendorStabilitySnapshots.ts))
        .limit(8);

      const recentScores = history.map(h => h.qScore).reverse(); // oldest first
      recentScores.push(metrics.q); // append current
      const stability = classifyStability(recentScores);

      await db.insert(vendorStabilitySnapshots).values({
        vendor,
        ts,
        qScore:    metrics.q,
        asr:       metrics.asr,
        ner:       metrics.ner,
        avgPdd:    metrics.avgPdd,
        fasRate:   metrics.fasRate,
        callCount: acc.calls,
        stability,
      });
    }

    // Prune snapshots older than 7 days
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
    await db.delete(vendorStabilitySnapshots).where(
      and(
        gte(vendorStabilitySnapshots.ts, new Date(0)), // avoid full-table scan guard
        // drizzle doesn't have lt directly imported here so use raw comparison
      ) as any
    ).catch(() => {}); // best-effort pruning
    // Note: pruning via a separate raw query to avoid import complexity
    await db.execute(
      `DELETE FROM vendor_stability_snapshots WHERE ts < '${sevenDaysAgo.toISOString()}'` as any
    ).catch(() => {});

    console.log(`[vendor-stability] Snapshot written for ${buckets.size} vendor(s)`);
  } catch (e: any) {
    console.error('[vendor-stability] Snapshot error:', e.message);
  }
}

// ── Timeline query — for the API route ───────────────────────────────────────
export interface VendorTimelinePoint {
  ts: string;
  qScore: number;
  asr: number | null;
  ner: number | null;
  avgPdd: number | null;
  fasRate: number | null;
  callCount: number;
  stability: string;
}

export interface VendorTimelineSummary {
  vendor: string;
  currentQ: number;
  minQ: number;
  maxQ: number;
  avgQ: number;
  stability: string;
  trend: 'up' | 'down' | 'flat';
  trendPts: number;
  snapshotCount: number;
  points: VendorTimelinePoint[];
}

export async function getVendorTimelines(
  hours = 48,
): Promise<VendorTimelineSummary[]> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const rows = await db.select().from(vendorStabilitySnapshots)
    .where(gte(vendorStabilitySnapshots.ts, since))
    .orderBy(vendorStabilitySnapshots.vendor, vendorStabilitySnapshots.ts);

  // Group by vendor
  const vendorMap = new Map<string, typeof rows>();
  for (const row of rows) {
    const arr = vendorMap.get(row.vendor) ?? [];
    arr.push(row);
    vendorMap.set(row.vendor, arr);
  }

  const results: VendorTimelineSummary[] = [];

  for (const [vendor, pts] of Array.from(vendorMap)) {
    if (pts.length === 0) continue;

    const scores   = pts.map(p => p.qScore);
    const minQ     = Math.min(...scores);
    const maxQ     = Math.max(...scores);
    const avgQ     = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    const currentQ = pts[pts.length - 1].qScore;
    const oldQ     = pts[0].qScore;
    const trendPts = currentQ - oldQ;
    const trend: 'up' | 'down' | 'flat' = trendPts >= 3 ? 'up' : trendPts <= -3 ? 'down' : 'flat';

    const stability = pts[pts.length - 1].stability;

    results.push({
      vendor,
      currentQ,
      minQ,
      maxQ,
      avgQ,
      stability,
      trend,
      trendPts,
      snapshotCount: pts.length,
      points: pts.map(p => ({
        ts:        p.ts.toISOString(),
        qScore:    p.qScore,
        asr:       p.asr,
        ner:       p.ner,
        avgPdd:    p.avgPdd,
        fasRate:   p.fasRate,
        callCount: p.callCount,
        stability: p.stability,
      })),
    });
  }

  // Sort by current Q ascending (worst first — most attention needed)
  results.sort((a, b) => a.currentQ - b.currentQ);
  return results;
}
