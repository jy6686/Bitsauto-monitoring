/**
 * Vendor Health Engine — Unified 0–100 Health Score
 *
 * Scoring model:
 *   Quality     (35%): ASR (50%) + ACD (30%) + PDD (20%)
 *   Reliability (30%): OPTIONS uptime (60%) + SIP 503/408 inverse (40%)
 *   Fraud       (20%): FAS event inverse (60%) + blacklist hit inverse (40%)
 *   Margin      (15%): actual margin vs 20% target
 *
 * Trend: computed by comparing current score to prior score >20h but <28h ago.
 *   Improving  : delta > +5
 *   Declining  : delta < -5
 *   Stable     : within ±5
 *
 * Runs every 15 minutes. Writes to vendor_health_scores (latest + history).
 * Also writes route_health_scores keyed to routing_groups_cache entries.
 */

import { db } from './db';
import {
  carrierQualityScores,
  vendorProbeResults,
  sipErrorStats,
  fasEvents,
  blacklistRules,
  dailyMinutesReports,
  vendorHealthScores,
  routeHealthScores,
  routingGroupsCache,
} from '../shared/schema';
import { desc, eq, gte, and, sql as drizzleSql, lte } from 'drizzle-orm';
import { getVendorAcd } from './vendor-acd-cache';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VendorHealthBreakdown {
  vendorName: string;
  overallScore: number;
  qualityScore: number;
  reliabilityScore: number;
  fraudScore: number;
  marginScore: number;
  trend: 'improving' | 'stable' | 'declining';
  trendDelta: number;
  scoredAt: string;
  details: {
    asr: number | null;
    acd: number | null;
    pddMs: number | null;
    optionsUptimePct: number | null;
    sipErrorRate503: number | null;
    sipErrorRate408: number | null;
    fasCount24h: number | null;
    blacklistHits: number | null;
    marginPct: number | null;
  };
}

export interface RouteHealthBreakdown {
  routingGroupId: string;
  routingGroupName: string;
  overallScore: number;
  vendorCount: number;
  lowestVendorScore: number | null;
  scoredAt: string;
  details: Array<{ vendorName: string; score: number; weight: number }>;
}

// ── Score normalisers ─────────────────────────────────────────────────────────

function clamp(v: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, v));
}

function scoreAsr(asr: number | null): number {
  if (asr == null) return 50; // neutral when no data
  // Target 75% ASR = 100 pts. Below 25% = 0 pts.
  return clamp(((asr - 25) / (75 - 25)) * 100);
}

function scoreAcd(acdSecs: number | null): number {
  if (acdSecs == null) return 50;
  // Target 60s = 100, 0s = 0. Capped at 100.
  return clamp((acdSecs / 60) * 100);
}

function scorePdd(pddMs: number | null): number {
  if (pddMs == null) return 50;
  // Lower is better. 800ms = 100, 6000ms = 0.
  return clamp(((6000 - pddMs) / (6000 - 800)) * 100);
}

function scoreUptime(reachablePct: number | null): number {
  if (reachablePct == null) return 70; // neutral
  return clamp(reachablePct);
}

function scoreSipErrors(rate503: number | null, rate408: number | null): number {
  const combined = (rate503 ?? 0) + (rate408 ?? 0);
  // 0% errors = 100, 20%+ errors = 0
  return clamp(100 - (combined / 20) * 100);
}

function scoreFraud(fasCount: number | null, blacklistHits: number | null): number {
  const fas = fasCount ?? 0;
  const bl  = blacklistHits ?? 0;
  const fasScore = clamp(100 - fas * 4);        // each FAS event costs 4 pts, max 25 events = 0
  const blScore  = clamp(100 - bl * 8);         // each blacklist hit costs 8 pts
  return fasScore * 0.6 + blScore * 0.4;
}

function scoreMargin(marginPct: number | null): number {
  if (marginPct == null) return 50; // neutral when no data
  if (marginPct < 0) return 0;      // negative margin = 0
  // Target 20% margin = 100. Scale linearly.
  return clamp((marginPct / 20) * 100);
}

// ── Main computation ──────────────────────────────────────────────────────────

async function computeVendorScores(): Promise<VendorHealthBreakdown[]> {
  const now        = new Date();
  const since24h   = new Date(now.getTime() - 24 * 3600_000);
  const since7d    = new Date(now.getTime() - 7  * 24 * 3600_000);

  // ── 1. Quality signals from carrier_quality_scores ────────────────────────
  const qualityRows = await db
    .select()
    .from(carrierQualityScores)
    .where(eq(carrierQualityScores.windowHours, 24))
    .orderBy(desc(carrierQualityScores.lastComputedAt));

  const qualityByVendor = new Map<string, typeof qualityRows[0]>();
  for (const row of qualityRows) {
    if (!qualityByVendor.has(row.carrierName)) {
      qualityByVendor.set(row.carrierName, row);
    }
  }

  // ── 2. OPTIONS probe uptime from vendor_probe_results (last 24h) ──────────
  const probeRows = await db
    .select({
      vendorName: vendorProbeResults.vendorName,
      total:      drizzleSql<number>`count(*)`,
      reachable:  drizzleSql<number>`sum(case when ${vendorProbeResults.reachable} then 1 else 0 end)`,
    })
    .from(vendorProbeResults)
    .where(gte(vendorProbeResults.probedAt, since24h))
    .groupBy(vendorProbeResults.vendorName);

  const probeByVendor = new Map<string, { uptimePct: number }>();
  for (const row of probeRows) {
    if (!row.vendorName) continue;
    const total = Number(row.total);
    const reach = Number(row.reachable);
    probeByVendor.set(row.vendorName, {
      uptimePct: total > 0 ? (reach / total) * 100 : 100,
    });
  }

  // ── 3. SIP error rates from sip_error_stats (15-min window) ──────────────
  const sipRows = await db
    .select({
      vendorName:    sipErrorStats.vendorName,
      code:          sipErrorStats.code,
      rate:          sipErrorStats.rate,
    })
    .from(sipErrorStats)
    .where(and(
      eq(sipErrorStats.windowMinutes, 15),
      gte(sipErrorStats.computedAt, new Date(now.getTime() - 30 * 60_000)),
    ))
    .orderBy(desc(sipErrorStats.computedAt));

  const sipByVendor = new Map<string, { rate503: number; rate408: number }>();
  for (const row of sipRows) {
    if (!row.vendorName) continue;
    const existing = sipByVendor.get(row.vendorName) ?? { rate503: 0, rate408: 0 };
    if (row.code === 503) existing.rate503 = Math.max(existing.rate503, row.rate ?? 0);
    if (row.code === 408) existing.rate408 = Math.max(existing.rate408, row.rate ?? 0);
    sipByVendor.set(row.vendorName, existing);
  }

  // ── 4. FAS events in last 24h per vendor ─────────────────────────────────
  const fasRows = await db
    .select({
      vendor: fasEvents.vendor,
      count:  drizzleSql<number>`count(*)`,
    })
    .from(fasEvents)
    .where(gte(fasEvents.detectedAt, since24h))
    .groupBy(fasEvents.vendor);

  const fasByVendor = new Map<string, number>();
  for (const row of fasRows) {
    if (row.vendor) fasByVendor.set(row.vendor, Number(row.count));
  }

  // ── 5. Blacklist hit count per vendor (all-time, from blacklist_rules) ────
  let blacklistByVendor = new Map<string, number>();
  try {
    const blRows = await db
      .select({
        vendor:   blacklistRules.vendor,
        hitCount: blacklistRules.hitCount,
      })
      .from(blacklistRules)
      .where(drizzleSql`${blacklistRules.vendor} is not null`);
    for (const row of blRows) {
      if (!row.vendor) continue;
      const existing = blacklistByVendor.get(row.vendor) ?? 0;
      blacklistByVendor.set(row.vendor, existing + (row.hitCount ?? 0));
    }
  } catch { /* non-fatal — blacklist table may not have vendor column */ }

  // ── 6. Margin from daily_minutes_reports (last 7 days) ───────────────────
  const marginRows = await db
    .select({
      vendorName:   dailyMinutesReports.vendorName,
      avgMarginPct: drizzleSql<number | null>`avg(${dailyMinutesReports.marginPct})`,
    })
    .from(dailyMinutesReports)
    .where(gte(dailyMinutesReports.reportDate, drizzleSql`${since7d.toISOString().slice(0, 10)}`))
    .groupBy(dailyMinutesReports.vendorName);

  const marginByVendor = new Map<string, number | null>();
  for (const row of marginRows) {
    if (row.vendorName) marginByVendor.set(row.vendorName, row.avgMarginPct ?? null);
  }

  // ── 7. Prior scores (20–28h ago) for trend computation ───────────────────
  const priorWindow24hAgo = new Date(now.getTime() - 28 * 3600_000);
  const priorWindow20hAgo = new Date(now.getTime() - 20 * 3600_000);
  const priorScoreRows = await db
    .select({
      vendorName:   vendorHealthScores.vendorName,
      overallScore: vendorHealthScores.overallScore,
    })
    .from(vendorHealthScores)
    .where(and(
      gte(vendorHealthScores.scoredAt, priorWindow24hAgo),
      lte(vendorHealthScores.scoredAt, priorWindow20hAgo),
    ))
    .orderBy(desc(vendorHealthScores.scoredAt));

  const priorByVendor = new Map<string, number>();
  for (const row of priorScoreRows) {
    if (!priorByVendor.has(row.vendorName)) {
      priorByVendor.set(row.vendorName, row.overallScore);
    }
  }

  // ── 8. Compute scores for every vendor with quality data ─────────────────
  const vendorNames = new Set<string>([
    ...qualityByVendor.keys(),
    ...probeByVendor.keys(),
    ...sipByVendor.keys(),
    ...fasByVendor.keys(),
    ...marginByVendor.keys(),
  ]);

  const results: VendorHealthBreakdown[] = [];

  for (const vendorName of vendorNames) {
    const quality  = qualityByVendor.get(vendorName);
    const probe    = probeByVendor.get(vendorName);
    const sip      = sipByVendor.get(vendorName);
    const fasCount = fasByVendor.get(vendorName) ?? 0;
    const blHits   = blacklistByVendor.get(vendorName) ?? 0;
    const margin   = marginByVendor.get(vendorName) ?? null;

    // Sub-dimension scores
    const qAsr    = scoreAsr(quality?.rollingAsr ?? null);
    // ACD: prefer live in-memory cache; fall back to last persisted DB value so the score
    // remains accurate immediately after a server restart (before the first CDR refresh).
    const acdSecs = getVendorAcd(vendorName) ?? quality?.avgAcdSecs ?? null;
    const qAcd    = scoreAcd(acdSecs);
    const qPdd    = scorePdd(quality?.avgPddMs ?? null);
    // Quality: ASR (50%) + ACD (30%) + PDD (20%) when ACD available; fallback ASR (65%) + PDD (35%)
    const qualScore = acdSecs != null
      ? qAsr * 0.50 + qAcd * 0.30 + qPdd * 0.20
      : qAsr * 0.65 + qPdd * 0.35;

    const rUptime  = scoreUptime(probe?.uptimePct ?? null);
    const rSip     = scoreSipErrors(sip?.rate503 ?? null, sip?.rate408 ?? null);
    const relScore = rUptime * 0.60 + rSip * 0.40;

    const fScore   = scoreFraud(fasCount, blHits);

    const mScore   = scoreMargin(margin);

    const overallScore = clamp(
      qualScore * 0.35 + relScore * 0.30 + fScore * 0.20 + mScore * 0.15
    );

    // Trend
    const prior = priorByVendor.get(vendorName);
    let trend: 'improving' | 'stable' | 'declining' = 'stable';
    let trendDelta = 0;
    if (prior != null) {
      trendDelta = overallScore - prior;
      if (trendDelta > 5)  trend = 'improving';
      if (trendDelta < -5) trend = 'declining';
    }

    results.push({
      vendorName,
      overallScore: Math.round(overallScore * 10) / 10,
      qualityScore:     Math.round(qualScore * 10) / 10,
      reliabilityScore: Math.round(relScore * 10) / 10,
      fraudScore:       Math.round(fScore * 10) / 10,
      marginScore:      Math.round(mScore * 10) / 10,
      trend,
      trendDelta: Math.round(trendDelta * 10) / 10,
      scoredAt: now.toISOString(),
      details: {
        asr:              quality?.rollingAsr ?? null,
        acd:              acdSecs,
        pddMs:            quality?.avgPddMs ?? null,
        optionsUptimePct: probe?.uptimePct ?? null,
        sipErrorRate503:  sip?.rate503 ?? null,
        sipErrorRate408:  sip?.rate408 ?? null,
        fasCount24h:      fasCount > 0 ? fasCount : null,
        blacklistHits:    blHits > 0 ? blHits : null,
        marginPct:        margin,
      },
    });
  }

  return results.sort((a, b) => b.overallScore - a.overallScore);
}

// ── Route Health Scores ───────────────────────────────────────────────────────

async function computeRouteHealthScores(
  vendorScores: Map<string, VendorHealthBreakdown>,
): Promise<RouteHealthBreakdown[]> {
  // Load routing groups WITH raw_json (contains memberVendors populated by syncRoutingCache step 4)
  let groups: { id: number; name: string; memberVendors: string[] }[] = [];
  try {
    const rows = await db.select({
      id:      routingGroupsCache.iRoutingGroup,
      name:    routingGroupsCache.name,
      rawJson: routingGroupsCache.rawJson,
    }).from(routingGroupsCache);
    groups = rows.map(r => {
      let memberVendors: string[] = [];
      try {
        const parsed = JSON.parse(r.rawJson ?? '{}');
        if (Array.isArray(parsed.memberVendors)) memberVendors = parsed.memberVendors;
      } catch { /* use empty list */ }
      return { id: r.id, name: r.name ?? `Group #${r.id}`, memberVendors };
    });
  } catch { return []; }

  if (groups.length === 0) return [];

  // Load daily_minutes_reports to weight vendors by traffic share
  const since7d = new Date(Date.now() - 7 * 24 * 3600_000);
  const trafficRows = await db
    .select({
      vendorName:  dailyMinutesReports.vendorName,
      totalCalls:  drizzleSql<number>`coalesce(sum(${dailyMinutesReports.totalCalls}), 0)`,
    })
    .from(dailyMinutesReports)
    .where(gte(dailyMinutesReports.reportDate, drizzleSql`${since7d.toISOString().slice(0, 10)}`))
    .groupBy(dailyMinutesReports.vendorName);

  const trafficByVendor = new Map<string, number>();
  for (const row of trafficRows) {
    if (row.vendorName) trafficByVendor.set(row.vendorName, Number(row.totalCalls));
  }

  // For each routing group, find member vendors by matching names in vendorScores
  // (We don't have a live join, so we assign all scored vendors to each group equally
  //  unless there's a traffic signal to weight by)
  const results: RouteHealthBreakdown[] = [];
  const allVendors = [...vendorScores.values()];
  if (allVendors.length === 0) return [];

  const totalTraffic = [...trafficByVendor.values()].reduce((a, b) => a + b, 0);

  for (const group of groups) {
    // Filter to vendors actually assigned to this routing group.
    // When memberVendors is populated (post-sync), use it; otherwise fall back to all vendors
    // (graceful degradation before first sync or when Sippy is unreachable).
    const groupVendors = group.memberVendors.length > 0
      ? allVendors.filter(v => group.memberVendors.includes(v.vendorName))
      : allVendors;

    if (groupVendors.length === 0) continue;

    // Compute total traffic weight for THIS group's vendors only
    const groupTraffic = groupVendors.reduce((s, v) => s + (trafficByVendor.get(v.vendorName) ?? 0), 0);

    let weightedSum = 0;
    let totalWeight = 0;
    const contributions: Array<{ vendorName: string; score: number; weight: number }> = [];

    for (const vhs of groupVendors) {
      const traffic = trafficByVendor.get(vhs.vendorName) ?? 0;
      const weight = groupTraffic > 0 ? traffic / groupTraffic : 1 / groupVendors.length;
      weightedSum  += vhs.overallScore * weight;
      totalWeight  += weight;
      contributions.push({ vendorName: vhs.vendorName, score: vhs.overallScore, weight: parseFloat((weight * 100).toFixed(1)) });
    }

    const overallScore = totalWeight > 0 ? clamp(weightedSum / totalWeight) : 0;
    const lowestScore  = Math.min(...groupVendors.map(v => v.overallScore));

    results.push({
      routingGroupId:    String(group.id),
      routingGroupName:  group.name,
      overallScore:      Math.round(overallScore * 10) / 10,
      vendorCount:       groupVendors.length,
      lowestVendorScore: Math.round(lowestScore * 10) / 10,
      scoredAt:          new Date().toISOString(),
      details:           contributions.slice(0, 10), // top 10
    });
  }

  return results;
}

// ── Persistence ───────────────────────────────────────────────────────────────

async function persistVendorScores(scores: VendorHealthBreakdown[]): Promise<void> {
  for (const s of scores) {
    await db.insert(vendorHealthScores).values({
      vendorName:       s.vendorName,
      scoredAt:         new Date(s.scoredAt),
      overallScore:     s.overallScore,
      qualityScore:     s.qualityScore,
      reliabilityScore: s.reliabilityScore,
      fraudScore:       s.fraudScore,
      marginScore:      s.marginScore,
      trend:            s.trend,
      trendDelta:       s.trendDelta,
      details:          s.details,
    }).catch(e => {
      console.warn(`[vendor-health] Failed to persist score for ${s.vendorName}:`, e.message);
    });
  }
}

async function persistRouteScores(scores: RouteHealthBreakdown[]): Promise<void> {
  for (const s of scores) {
    await db.insert(routeHealthScores).values({
      routingGroupId:    s.routingGroupId,
      routingGroupName:  s.routingGroupName,
      scoredAt:          new Date(s.scoredAt),
      overallScore:      s.overallScore,
      vendorCount:       s.vendorCount,
      lowestVendorScore: s.lowestVendorScore ?? null,
      details:           s.details,
    }).catch(e => {
      console.warn(`[vendor-health] Failed to persist route score for ${s.routingGroupName}:`, e.message);
    });
  }
}

// ── In-memory cache (latest scores, refreshed each run) ──────────────────────

let _latestVendorScores: VendorHealthBreakdown[] = [];
let _latestRouteScores:  RouteHealthBreakdown[]  = [];
let _lastRunAt: Date | null = null;

export function getLatestVendorHealthScores(): VendorHealthBreakdown[] { return _latestVendorScores; }
export function getLatestRouteHealthScores():  RouteHealthBreakdown[]  { return _latestRouteScores; }
export function getVendorHealthLastRunAt(): Date | null { return _lastRunAt; }

// ── Main run ──────────────────────────────────────────────────────────────────

let _running = false;

async function _run(): Promise<void> {
  if (_running) return;
  _running = true;
  try {
    const vendorScores = await computeVendorScores();
    const scoreMap = new Map(vendorScores.map(s => [s.vendorName, s]));
    const routeScores  = await computeRouteHealthScores(scoreMap);

    _latestVendorScores = vendorScores;
    _latestRouteScores  = routeScores;
    _lastRunAt = new Date();

    await persistVendorScores(vendorScores);
    await persistRouteScores(routeScores);

    const critical = vendorScores.filter(s => s.overallScore < 50).length;
    console.log(`[vendor-health] Scored ${vendorScores.length} vendors (${critical} critical <50). Routes: ${routeScores.length}`);
  } catch (e: any) {
    console.warn('[vendor-health] Engine run failed:', e.message);
  } finally {
    _running = false;
  }
}

let _timer: ReturnType<typeof setInterval> | null = null;

export function initVendorHealthEngine(): void {
  if (_timer) clearInterval(_timer);
  _timer = setInterval(_run, 15 * 60_000);  // every 15 minutes
  // First run after 2 min (let CDR cache and probe data warm up)
  setTimeout(_run, 2 * 60_000);
  console.log('[vendor-health] Engine started — scoring every 15 min (first run at T+2min)');
}

export async function recomputeVendorHealthNow(): Promise<VendorHealthBreakdown[]> {
  await _run();
  return _latestVendorScores;
}

// ── 7-day history loader (for detail panel) ───────────────────────────────────

export async function loadVendorHealthHistory(vendorName: string): Promise<VendorHealthBreakdown[]> {
  const since7d = new Date(Date.now() - 7 * 24 * 3600_000);
  const rows = await db
    .select()
    .from(vendorHealthScores)
    .where(and(
      eq(vendorHealthScores.vendorName, vendorName),
      gte(vendorHealthScores.scoredAt, since7d),
    ))
    .orderBy(vendorHealthScores.scoredAt);

  return rows.map(r => ({
    vendorName:       r.vendorName,
    overallScore:     r.overallScore,
    qualityScore:     r.qualityScore ?? 0,
    reliabilityScore: r.reliabilityScore ?? 0,
    fraudScore:       r.fraudScore ?? 0,
    marginScore:      r.marginScore ?? 0,
    trend:            (r.trend as any) ?? 'stable',
    trendDelta:       r.trendDelta ?? 0,
    scoredAt:         r.scoredAt.toISOString(),
    details:          (r.details as any) ?? {},
  }));
}
