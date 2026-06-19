// server/vendor-rca.ts
// Vendor RCA (Root Cause Analysis) — aggregates all intelligence layers for a single vendor.
// Zero new Sippy calls. Pure in-memory CDR + DB aggregation.

import { db } from "./db";
import {
  fasEvents, incidents, incidentLifecycleEvents,
  vendorStabilitySnapshots,
} from "@shared/schema";
import { desc, eq, gte, ilike, and } from "drizzle-orm";
import { computeVendorPrefixIntelligence } from "./vendor-prefix-intelligence";
import { getVendorTimelines } from "./vendor-stability";
import type { SippyCDR } from "./sippy";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RcaMetrics {
  tc: number;   // total calls
  bc: number;   // billed / answered
  rna: number;  // ring-no-answer (answered 0s)
  fas: number;  // short-duration fraud indicators
  pddSum: number;
  pddN: number;
}

export interface RcaDecomposition {
  asr:  { cur: number; prev: number | null; pts: number; prevPts: number | null; delta: number | null };
  ner:  { cur: number; prev: number | null; pts: number; prevPts: number | null; delta: number | null };
  fas:  { cur: number; prev: number | null; pts: number; prevPts: number | null; delta: number | null };
  pdd:  { cur: number; prev: number | null; pts: number; prevPts: number | null; delta: number | null };
}

export interface RcaVerdict {
  currentQ:       number;
  previousQ:      number | null;
  deltaQ:         number;
  stability:      string;
  trend:          'up' | 'down' | 'flat';
  trendPts:       number;
  callCount:      number;
  prevCallCount:  number;
  severity:       'critical' | 'warning' | 'info' | 'ok';
  urgency:        'immediate' | 'today' | 'monitor' | 'healthy';
  signals:        string[];
}

export interface RcaRecommendation {
  type:            string;
  title:           string;
  confidence:      number;
  confidencePct:   number;
  ruleDescription: string;
  urgency:         string;
}

export interface RcaIncidentSummary {
  incidentId: number;
  type:       string;
  severity:   string;
  title:      string;
  state:      string | null;
  events:     Array<{ ts: string | null; fromState: string | null; toState: string; note: string | null }>;
}

export interface RcaFasSummary {
  totalEvents:      number;
  last24h:          number;
  affectedPrefixes: string[];
  topCallee:        string | null;
}

export interface VendorRcaPayload {
  vendor:        string;
  generatedAt:   string;
  hasData:       boolean;
  verdict:       RcaVerdict;
  decomposition: RcaDecomposition | null;
  prefixes:      any[];  // PrefixBucketResult[]
  timeline:      any[];  // VendorTimelinePoint[]
  recommendation: RcaRecommendation | null;
  incidents:     RcaIncidentSummary[];
  fas:           RcaFasSummary;
}

// ── CDR helpers ───────────────────────────────────────────────────────────────
function tsOf(c: SippyCDR): number {
  const v = (c as any).startTime ?? (c as any).connectTime;
  if (!v) return 0;
  return typeof v === 'number' ? v * 1000 : new Date(v).getTime();
}

function vendorOf(c: SippyCDR): string {
  return ((c as any).vendor as string | undefined) ?? '';
}

function aggregateCdrs(cdrs: SippyCDR[]): RcaMetrics {
  let tc = 0, bc = 0, rna = 0, fas = 0, pddSum = 0, pddN = 0;
  for (const c of cdrs) {
    const dur = Number((c as any).totalDuration ?? (c as any).duration ?? 0);
    const pdd = Number((c as any).pdd1xx ?? (c as any).pdd ?? 0);
    const ok  = String(c.result) === '0';
    tc++;
    if (ok && dur > 0)       { bc++; if (dur <= 5) fas++; }
    if (ok && dur === 0)      rna++;
    if (pdd > 0 && pdd < 60) { pddSum += pdd; pddN++; }
  }
  return { tc, bc, rna, fas, pddSum, pddN };
}

function pddPts(pdd: number): number {
  return (pdd <= 1 ? 100 : pdd <= 3 ? 85 : pdd <= 6 ? 65 : pdd <= 10 ? 40 : 20);
}

function computeQ(m: RcaMetrics): number {
  if (m.tc === 0) return 0;
  const asr = m.tc > 0 ? m.bc / m.tc * 100 : 0;
  const ner = m.tc > 0 ? (m.bc + m.rna) / m.tc * 100 : 0;
  const fr  = m.bc > 0 ? m.fas / m.bc * 100 : 0;
  const pdd = m.pddN > 0 ? m.pddSum / m.pddN : 0;
  return Math.round(
    Math.min(asr, 100) * 0.40 +
    Math.min(ner, 100) * 0.30 +
    Math.max(0, 100 - fr * 4) * 0.20 +
    pddPts(pdd) * 0.10
  );
}

function decompose(cur: RcaMetrics, prev: RcaMetrics | null): RcaDecomposition {
  const cAsr = cur.tc > 0 ? cur.bc / cur.tc * 100 : 0;
  const cNer = cur.tc > 0 ? (cur.bc + cur.rna) / cur.tc * 100 : 0;
  const cFas = cur.bc > 0 ? cur.fas / cur.bc * 100 : 0;
  const cPdd = cur.pddN > 0 ? cur.pddSum / cur.pddN : 0;

  const cAsrPts = Math.min(cAsr, 100) * 0.40;
  const cNerPts = Math.min(cNer, 100) * 0.30;
  const cFasPts = Math.max(0, 100 - cFas * 4) * 0.20;
  const cPddPts = pddPts(cPdd) * 0.10;

  const pAsr = prev && prev.tc > 0 ? prev.bc / prev.tc * 100 : null;
  const pNer = prev && prev.tc > 0 ? (prev.bc + prev.rna) / prev.tc * 100 : null;
  const pFas = prev && prev.bc > 0 ? prev.fas / prev.bc * 100 : null;
  const pPdd = prev && prev.pddN > 0 ? prev.pddSum / prev.pddN : null;

  const pAsrPts = pAsr !== null ? Math.min(pAsr, 100) * 0.40 : null;
  const pNerPts = pNer !== null ? Math.min(pNer, 100) * 0.30 : null;
  const pFasPts = pFas !== null ? Math.max(0, 100 - pFas * 4) * 0.20 : null;
  const pPddPts = pPdd !== null ? pddPts(pPdd) * 0.10 : null;

  const r1 = (v: number) => Math.round(v * 10) / 10;
  const r2 = (v: number) => Math.round(v * 100) / 100;

  return {
    asr: { cur: r1(cAsr), prev: pAsr !== null ? r1(pAsr) : null, pts: r1(cAsrPts), prevPts: pAsrPts !== null ? r1(pAsrPts) : null, delta: pAsrPts !== null ? r1(cAsrPts - pAsrPts) : null },
    ner: { cur: r1(cNer), prev: pNer !== null ? r1(pNer) : null, pts: r1(cNerPts), prevPts: pNerPts !== null ? r1(pNerPts) : null, delta: pNerPts !== null ? r1(cNerPts - pNerPts) : null },
    fas: { cur: r1(cFas), prev: pFas !== null ? r1(pFas) : null, pts: r1(cFasPts), prevPts: pFasPts !== null ? r1(pFasPts) : null, delta: pFasPts !== null ? r1(cFasPts - pFasPts) : null },
    pdd: { cur: r2(cPdd), prev: pPdd !== null ? r2(pPdd) : null, pts: r1(cPddPts), prevPts: pPddPts !== null ? r1(pPddPts) : null, delta: pPddPts !== null ? r1(cPddPts - pPddPts) : null },
  };
}

function buildSignals(
  cAsr: number, pAsr: number | null,
  cNer: number, pNer: number | null,
  cFas: number, pFas: number | null,
  cPdd: number, pPdd: number | null,
  curQ: number,
): string[] {
  const signals: string[] = [];
  if (pAsr !== null && Math.abs(cAsr - pAsr) >= 5)
    signals.push(`ASR ${cAsr > pAsr ? '↑' : '↓'} ${pAsr.toFixed(0)}% → ${cAsr.toFixed(0)}%`);
  if (pNer !== null && Math.abs(cNer - pNer) >= 5)
    signals.push(`NER ${cNer > pNer ? '↑' : '↓'} ${pNer.toFixed(0)}% → ${cNer.toFixed(0)}%`);
  if (pFas !== null && cFas - pFas >= 5)
    signals.push(`FAS spike ${pFas.toFixed(0)}% → ${cFas.toFixed(0)}%`);
  else if (cFas >= 15 && pFas === null)
    signals.push(`FAS elevated: ${cFas.toFixed(0)}%`);
  if (pFas !== null && pFas - cFas >= 5)
    signals.push(`FAS eased ${pFas.toFixed(0)}% → ${cFas.toFixed(0)}%`);
  if (pPdd !== null && cPdd - pPdd >= 1.5)
    signals.push(`PDD degrading ${pPdd.toFixed(1)}s → ${cPdd.toFixed(1)}s`);
  if (pPdd !== null && pPdd - cPdd >= 1.5)
    signals.push(`PDD improved ${pPdd.toFixed(1)}s → ${cPdd.toFixed(1)}s`);
  if (pAsr !== null && pNer !== null && cAsr - pAsr <= -8 && Math.abs(cNer - pNer) < 3)
    signals.push('ASR collapse with NER stable — far-end subscriber rejection suspected');
  if (curQ < 30 && signals.length === 0)
    signals.push(`Low quality route — Q${curQ}`);
  return signals;
}

function urgencyOf(curQ: number, deltaQ: number, severity: string): 'immediate' | 'today' | 'monitor' | 'healthy' {
  if (curQ < 25 || severity === 'critical') return 'immediate';
  if (curQ < 40 || severity === 'warning')  return 'today';
  if (curQ < 60 || severity === 'info')     return 'monitor';
  return 'healthy';
}

// ── Main aggregation ──────────────────────────────────────────────────────────
export async function buildVendorRca(
  vendor: string,
  cdrCache: Map<string, SippyCDR>,
): Promise<VendorRcaPayload> {
  const now  = Date.now();
  const W1   = 60 * 60_000;
  const W2   = 60 * 60_000;
  const allCdrs = Array.from(cdrCache.values());

  // ── CDR windows for this vendor ───────────────────────────────────────────
  const curCdrs  = allCdrs.filter(c => {
    const t = tsOf(c);
    return t >= now - W1 && vendorOf(c).toLowerCase() === vendor.toLowerCase();
  });
  const prevCdrs = allCdrs.filter(c => {
    const t = tsOf(c);
    return t >= now - W1 - W2 && t < now - W1 && vendorOf(c).toLowerCase() === vendor.toLowerCase();
  });

  const cur  = aggregateCdrs(curCdrs);
  const prev = prevCdrs.length >= 5 ? aggregateCdrs(prevCdrs) : null;

  const curQ    = cur.tc >= 5 ? computeQ(cur) : 0;
  const prevQ   = prev && prev.tc >= 5 ? computeQ(prev) : null;
  const deltaQ  = prevQ !== null ? curQ - prevQ : 0;

  const cAsr = cur.tc > 0 ? cur.bc / cur.tc * 100 : 0;
  const cNer = cur.tc > 0 ? (cur.bc + cur.rna) / cur.tc * 100 : 0;
  const cFas = cur.bc > 0 ? cur.fas / cur.bc * 100 : 0;
  const cPdd = cur.pddN > 0 ? cur.pddSum / cur.pddN : 0;
  const pAsr = prev && prev.tc > 0 ? prev.bc / prev.tc * 100 : null;
  const pNer = prev && prev.tc > 0 ? (prev.bc + prev.rna) / prev.tc * 100 : null;
  const pFas = prev && prev.bc > 0 ? prev.fas / prev.bc * 100 : null;
  const pPdd = prev && prev.pddN > 0 ? prev.pddSum / prev.pddN : null;

  const severity: 'critical' | 'warning' | 'info' | 'ok' =
    deltaQ <= -20 ? 'critical' : deltaQ <= -10 ? 'warning' :
    Math.abs(deltaQ) < 3 ? 'ok' : deltaQ < 0 ? 'info' : 'ok';

  const signals  = buildSignals(cAsr, pAsr, cNer, pNer, cFas, pFas, cPdd, pPdd, curQ);
  const urgency  = urgencyOf(curQ, deltaQ, severity);

  // ── Stability timeline ────────────────────────────────────────────────────
  const allTimelines = await getVendorTimelines(48).catch(() => []);
  const vtl = allTimelines.find(v => v.vendor.toLowerCase() === vendor.toLowerCase());
  const timeline  = vtl?.points ?? [];
  const stability = vtl?.stability ?? 'unknown';
  const trendPts  = vtl?.trendPts ?? 0;
  const trend     = vtl?.trend ?? 'flat';

  // ── Prefix breakdown ──────────────────────────────────────────────────────
  const prefixResult = await computeVendorPrefixIntelligence(cdrCache).catch(() => null);
  const vendorRow    = prefixResult?.vendors.find(
    v => v.vendor.toLowerCase() === vendor.toLowerCase()
  );
  // Sort worst-first for RCA relevance
  const prefixes = (vendorRow?.prefixes ?? [])
    .sort((a: any, b: any) => a.q - b.q);

  // ── Recommendation (simplified, inline rule matching) ─────────────────────
  let recommendation: RcaRecommendation | null = null;
  if (cur.tc >= 5) {
    const fasRate = cur.bc > 0 ? (cur.fas / cur.bc) * 100 : 0;
    const confidence = Math.min(1, Math.log10(cur.tc + 1) / 2);
    const confPct    = Math.round(confidence * 100);

    if (curQ < 25 || fasRate > 30) {
      recommendation = {
        type: curQ < 25 ? 'INVESTIGATE' : 'FAS_ALERT',
        title: curQ < 25 ? `Investigate ${vendor} — critically low quality` : `FAS alert on ${vendor}`,
        confidence, confidencePct: confPct,
        ruleDescription: curQ < 25
          ? `Q${curQ} is below the 25-point critical threshold with ${cur.tc} calls. Immediate investigation required.`
          : `FAS rate ${fasRate.toFixed(1)}% exceeds 30% threshold. Possible fraud or padding activity.`,
        urgency: 'immediate',
      };
    } else if (curQ < 40 || deltaQ <= -20) {
      recommendation = {
        type: 'REDUCE',
        title: `Reduce traffic on ${vendor}`,
        confidence, confidencePct: confPct,
        ruleDescription: curQ < 40
          ? `Q${curQ} below 40-point reduction threshold.`
          : `Q dropped ${Math.abs(deltaQ)} points in the last hour (Q${prevQ} → Q${curQ}).`,
        urgency: 'today',
      };
    } else if (curQ >= 80 && (trendPts >= 0)) {
      recommendation = {
        type: 'PROMOTE',
        title: `Promote ${vendor} — strong quality`,
        confidence, confidencePct: confPct,
        ruleDescription: `Q${curQ} above 80-point promote threshold with stable or improving trend.`,
        urgency: 'monitor',
      };
    } else if (curQ < 60 || deltaQ < -5) {
      recommendation = {
        type: 'MONITOR',
        title: `Monitor ${vendor} closely`,
        confidence, confidencePct: confPct,
        ruleDescription: curQ < 60
          ? `Q${curQ} in the caution zone (40–60). Continued monitoring advised.`
          : `Mild degradation: Q dropped ${Math.abs(deltaQ)} points.`,
        urgency: 'monitor',
      };
    }
  }

  // ── Incident history for this vendor ─────────────────────────────────────
  const dayAgo = new Date(now - 7 * 24 * 60 * 60 * 1000); // 7 days
  const incidentRows = await db.select({
    id:       incidents.id,
    type:     incidents.incidentType,
    severity: incidents.severity,
    title:    incidents.title,
    state:    incidents.status,
    entityId: incidents.entityId,
  }).from(incidents)
    .where(ilike(incidents.entityId, `%${vendor}%`))
    .orderBy(desc(incidents.id))
    .limit(10)
    .catch(() => []);

  const incidentSummaries: RcaIncidentSummary[] = [];
  for (const inc of incidentRows) {
    const events = await db.select({
      ts:        incidentLifecycleEvents.createdAt,
      fromState: incidentLifecycleEvents.fromState,
      toState:   incidentLifecycleEvents.toState,
      note:      incidentLifecycleEvents.note,
    })
      .from(incidentLifecycleEvents)
      .where(eq(incidentLifecycleEvents.incidentId, inc.id))
      .orderBy(incidentLifecycleEvents.createdAt)
      .catch(() => []);

    incidentSummaries.push({
      incidentId: inc.id,
      type:       inc.type ?? 'UNKNOWN',
      severity:   inc.severity ?? 'medium',
      title:      inc.title ?? `Incident #${inc.id}`,
      state:      inc.state ?? null,
      events:     events.map(e => ({
        ts:        e.ts ? e.ts.toISOString() : null,
        fromState: e.fromState,
        toState:   e.toState,
        note:      e.note,
      })),
    });
  }

  // ── FAS summary for this vendor ───────────────────────────────────────────
  const dayAgoSimple = new Date(now - 24 * 60 * 60 * 1000);
  const fasRows = await db.select({
    callee:     fasEvents.callee,
    detectedAt: fasEvents.detectedAt,
  })
    .from(fasEvents)
    .where(and(
      ilike(fasEvents.vendor, `%${vendor}%`),
      gte(fasEvents.detectedAt, dayAgoSimple),
    ))
    .orderBy(desc(fasEvents.detectedAt))
    .limit(200)
    .catch(() => []);

  const calleeCount = new Map<string, number>();
  for (const r of fasRows) {
    if (!r.callee) continue;
    calleeCount.set(r.callee, (calleeCount.get(r.callee) ?? 0) + 1);
  }

  const affectedPrefixSet = new Set<string>();
  for (const callee of calleeCount.keys()) {
    const pfx = callee.slice(0, Math.min(5, callee.length));
    affectedPrefixSet.add(pfx);
  }

  const topCallee = Array.from(calleeCount.entries())
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const allFasForVendor = await db.select({ id: fasEvents.id })
    .from(fasEvents)
    .where(ilike(fasEvents.vendor, `%${vendor}%`))
    .limit(1000)
    .catch(() => []);

  const fasSummary: RcaFasSummary = {
    totalEvents:      allFasForVendor.length,
    last24h:          fasRows.length,
    affectedPrefixes: Array.from(affectedPrefixSet).slice(0, 10),
    topCallee,
  };

  const hasData = cur.tc > 0 || timeline.length > 0 || incidentSummaries.length > 0;

  return {
    vendor,
    generatedAt:    new Date().toISOString(),
    hasData,
    verdict: {
      currentQ:      curQ,
      previousQ:     prevQ,
      deltaQ,
      stability,
      trend,
      trendPts,
      callCount:     cur.tc,
      prevCallCount: prev?.tc ?? 0,
      severity,
      urgency,
      signals,
    },
    decomposition: cur.tc >= 5 ? decompose(cur, prev) : null,
    prefixes,
    timeline,
    recommendation,
    incidents: incidentSummaries,
    fas:       fasSummary,
  };
}
