/**
 * AI Route Copilot — Intelligent Route Recommendation Engine
 *
 * Phase 1: observe-and-recommend only (no auto-rerouting).
 *
 * Telemetry sources:
 *   - carrier_quality_scores (stability, ASR, ACD, PDD, trend)
 *   - routing_suggestions (pending rule-based signals)
 *   - fas_events (FAS/fraud per vendor — last 24h)
 *   - irsf_events (IRSF per vendor — last 24h)
 *   - vendor prefix Q-Score data (optional, via cdrCache)
 *
 * OpenAI behaviour:
 *   - If OPENAI_API_KEY is set: GPT-4o-mini formats the final recommendations
 *     into human-readable telecom-ops language and validates the JSON contract.
 *   - If OPENAI_API_KEY is missing: mode = "rule_based_preview", result contains
 *     an explicit warning — NOT a silent fallback.
 *   - If OpenAI returns malformed JSON: throws AiContractError (→ 502 upstream).
 *   - If OpenAI rate-limits or times out: throws AiContractError (→ 502 upstream).
 */

import { db } from "../../db";
import {
  carrierQualityScores,
  routingSuggestions,
  fasEvents,
  irsfEvents,
  dailyMinutesReports,
} from "../../../shared/schema";
import { desc, eq, gte, and, sql } from "drizzle-orm";
import { loadSipErrorSnapshot, CODE_LABELS, type SipErrorSnapshot } from "./sip-error-aggregator";
import { getCopilotVendorSignals } from "../../route-intelligence-engine";

// ── Error type ─────────────────────────────────────────────────────────────────

export class AiContractError extends Error {
  public readonly statusCode = 502;
  constructor(message: string) {
    super(message);
    this.name = "AiContractError";
  }
}

// ── Output types ──────────────────────────────────────────────────────────────

export interface AiRouteRecommendation {
  id: string;
  action: string;
  confidence: number;
  reasons: string[];
  risk: "low" | "medium" | "high";
  expectedImpact: string;
  aiInsight?: string;
  currentVendor?: string;
  targetVendor?: string;
  destination?: string;
  fraudSignals?: {
    fasCount: number;
    irsfCount: number;
    avgFraudScore: number | null;
  };
  simulate: {
    asrDelta: number | null;
    stabilityDelta: number | null;
    projectedAsr: number | null;
    projectedStability: number | null;
  };
}

export interface CopilotResult {
  generatedAt: string;
  mode: "ai_enhanced" | "rule_based_preview";
  warning?: string;
  recommendations: AiRouteRecommendation[];
  summary: {
    totalCarriers: number;
    degradedCarriers: number;
    criticalCarriers: number;
    fraudAlertCarriers: number;
    topSignal: string;
    analysisNote: string;
  };
}

type CarrierRow = typeof carrierQualityScores.$inferSelect;

// ── Helpers ───────────────────────────────────────────────────────────────────

function isCritical(s: CarrierRow)  { return (s.stabilityScore ?? 100) < 35 || (s.rollingAsr ?? 100) < 25; }
function isDegraded(s: CarrierRow)  { return (s.stabilityScore ?? 100) < 58 || (s.rollingAsr ?? 100) < 42; }
function isHealthy(s: CarrierRow)   { return (s.stabilityScore ?? 0) >= 70 && (s.rollingAsr ?? 0) >= 58; }
function isRecovering(s: CarrierRow){ return (s.stabilityScore ?? 0) > 76 && s.trend === "improving" && (s.rollingAsr ?? 0) > 70; }

// ── LCR margin loader ─────────────────────────────────────────────────────────

interface VendorMarginProfile {
  avgMarginPct: number | null;
  totalMarginAmount: number | null;
  totalCalls: number;
  isNegativeMargin: boolean;
}

async function loadMarginProfilesPerVendor(
  since: Date,
): Promise<Map<string, VendorMarginProfile>> {
  const rows = await db
    .select({
      vendorName: dailyMinutesReports.vendorName,
      avgMarginPct:        sql<number | null>`avg(${dailyMinutesReports.marginPct})`,
      totalMarginAmount:   sql<number | null>`sum(${dailyMinutesReports.marginAmount})`,
      totalCalls:          sql<number>`coalesce(sum(${dailyMinutesReports.totalCalls}), 0)`,
    })
    .from(dailyMinutesReports)
    .where(gte(dailyMinutesReports.reportDate, sql`${since.toISOString().slice(0, 10)}`))
    .groupBy(dailyMinutesReports.vendorName);

  const profiles = new Map<string, VendorMarginProfile>();
  for (const row of rows) {
    if (!row.vendorName) continue;
    const avgMarginPct = row.avgMarginPct ?? null;
    profiles.set(row.vendorName, {
      avgMarginPct,
      totalMarginAmount: row.totalMarginAmount ?? null,
      totalCalls: Number(row.totalCalls ?? 0),
      isNegativeMargin: avgMarginPct != null && avgMarginPct < 0,
    });
  }
  return profiles;
}

// ── Fraud telemetry loader ─────────────────────────────────────────────────────

interface FraudProfile {
  fasCount: number;
  irsfCount: number;
  avgFraudScore: number | null;
}

async function loadFraudProfilesPerVendor(
  since: Date,
): Promise<Map<string, FraudProfile>> {
  const [fasRows, irsfRows] = await Promise.all([
    db.select({
      vendor: fasEvents.vendor,
      fraudScore: fasEvents.fraudScore,
    }).from(fasEvents).where(gte(fasEvents.detectedAt, since)),

    db.select({
      vendor: irsfEvents.vendor,
      fraudScore: irsfEvents.fraudScore,
    }).from(irsfEvents).where(gte(irsfEvents.detectedAt, since)),
  ]);

  const profiles = new Map<string, FraudProfile>();

  for (const row of fasRows) {
    if (!row.vendor) continue;
    const p = profiles.get(row.vendor) ?? { fasCount: 0, irsfCount: 0, avgFraudScore: null };
    p.fasCount += 1;
    profiles.set(row.vendor, p);
  }
  for (const row of irsfRows) {
    if (!row.vendor) continue;
    const p = profiles.get(row.vendor) ?? { fasCount: 0, irsfCount: 0, avgFraudScore: null };
    p.irsfCount += 1;
    if (row.fraudScore != null) {
      p.avgFraudScore = p.avgFraudScore == null
        ? row.fraudScore
        : (p.avgFraudScore + row.fraudScore) / 2;
    }
    profiles.set(row.vendor, p);
  }

  return profiles;
}

// ── Rule engine ───────────────────────────────────────────────────────────────

function buildRuleBasedRecommendations(
  scores: CarrierRow[],
  pendingSuggestions: (typeof routingSuggestions.$inferSelect)[],
  fraudProfiles: Map<string, FraudProfile>,
  marginProfiles: Map<string, VendorMarginProfile>,
  vendorPrefixData?: any,
): AiRouteRecommendation[] {
  const degradedScores  = scores.filter(isDegraded);
  const healthyScores   = scores.filter(isHealthy);
  const recoveringScores = scores.filter(isRecovering);

  const recs: AiRouteRecommendation[] = [];

  // ── Rule 1: Traffic shift degraded→healthy ──────────────────────────────────
  for (const bad of degradedScores) {
    const fraud  = fraudProfiles.get(bad.carrierName);
    const margin = marginProfiles.get(bad.carrierName);
    const alternatives = healthyScores
      .filter(h => h.carrierName !== bad.carrierName)
      .sort((a, b) => (b.stabilityScore ?? 0) - (a.stabilityScore ?? 0));

    if (alternatives.length > 0) {
      const best = alternatives[0];
      const stabilityGain = (best.stabilityScore ?? 0) - (bad.stabilityScore ?? 0);
      const asrGain = (best.rollingAsr ?? 0) - (bad.rollingAsr ?? 0);
      const critical = isCritical(bad);

      const fraudBonus  = fraud  && (fraud.fasCount + fraud.irsfCount) > 3 ? 8 : 0;
      const marginBonus = margin && margin.isNegativeMargin ? 10 : 0;
      const confidence  = Math.round(Math.min(
        95,
        critical ? 80 + Math.min(stabilityGain * 0.4, 12) + fraudBonus + marginBonus
                 : 58 + Math.min(stabilityGain * 0.5, 22) + fraudBonus + marginBonus,
      ));

      const reasons: string[] = [];
      if (bad.stabilityScore != null)
        reasons.push(`${bad.carrierName} stability: ${bad.stabilityScore.toFixed(0)}/100 (${bad.trend ?? "stable"} trend)`);
      if (bad.rollingAsr != null && bad.rollingAsr < 65)
        reasons.push(`Rolling ASR ${bad.rollingAsr.toFixed(1)}% — below 65% threshold`);
      if (bad.avgPddMs != null && bad.avgPddMs > 2800)
        reasons.push(`Avg PDD ${(bad.avgPddMs / 1000).toFixed(1)}s — elevated latency signal`);
      if (bad.failureRate != null && bad.failureRate > 28)
        reasons.push(`Failure rate ${bad.failureRate.toFixed(1)}% — above acceptable ceiling`);
      if (margin && margin.avgMarginPct != null && margin.avgMarginPct < 15)
        reasons.push(`LCR margin ${margin.avgMarginPct.toFixed(1)}% — below 15% minimum threshold${margin.isNegativeMargin ? " (NEGATIVE)" : ""}`);
      if (fraud && fraud.fasCount > 0)
        reasons.push(`FAS events via ${bad.carrierName}: ${fraud.fasCount} in last 24h`);
      if (fraud && fraud.irsfCount > 0)
        reasons.push(`IRSF risk events: ${fraud.irsfCount} — elevated fraud exposure`);
      if (stabilityGain > 5)
        reasons.push(`${best.carrierName} stability ${best.stabilityScore?.toFixed(0)}/100 (+${stabilityGain.toFixed(0)} pts advantage)`);
      if (asrGain > 0)
        reasons.push(`Projected ASR gain: +${asrGain.toFixed(1)}%`);
      if (best.trend === "improving")
        reasons.push(`${best.carrierName} on improving trajectory`);

      recs.push({
        id: `shift-${bad.carrierName}-to-${best.carrierName}`,
        action: `Shift traffic: ${bad.carrierName} → ${best.carrierName}`,
        confidence,
        reasons,
        risk: critical || margin?.isNegativeMargin ? "low" : (bad.stabilityScore ?? 100) < 48 ? "low" : "medium",
        expectedImpact: [
          stabilityGain > 0 ? `Stability +${stabilityGain.toFixed(0)} pts` : null,
          asrGain > 0 ? `ASR +${asrGain.toFixed(1)}%` : null,
          margin?.isNegativeMargin ? "Eliminates negative-margin exposure" : null,
          fraud && fraud.fasCount > 0 ? "Reduces FAS exposure" : null,
        ].filter(Boolean).join(", "),
        currentVendor: bad.carrierName,
        targetVendor: best.carrierName,
        fraudSignals: fraud ?? { fasCount: 0, irsfCount: 0, avgFraudScore: null },
        simulate: {
          asrDelta: asrGain,
          stabilityDelta: stabilityGain,
          projectedAsr: best.rollingAsr,
          projectedStability: best.stabilityScore,
        },
      });
    } else {
      // No healthy alternative — deprioritise
      const fraud  = fraudProfiles.get(bad.carrierName);
      const margin = marginProfiles.get(bad.carrierName);
      const reasons: string[] = [];
      if (bad.stabilityScore != null) reasons.push(`Stability: ${bad.stabilityScore.toFixed(0)}/100`);
      if (bad.rollingAsr != null)      reasons.push(`ASR: ${bad.rollingAsr.toFixed(1)}%`);
      if (bad.trend === "degrading")   reasons.push("Trend: actively degrading");
      if (bad.failureRate != null && bad.failureRate > 25)
        reasons.push(`High failure rate: ${bad.failureRate.toFixed(1)}%`);
      if (margin && margin.avgMarginPct != null && margin.avgMarginPct < 15)
        reasons.push(`LCR margin ${margin.avgMarginPct.toFixed(1)}%${margin.isNegativeMargin ? " — NEGATIVE margin" : " — below threshold"}`);
      if (fraud && fraud.fasCount + fraud.irsfCount > 0)
        reasons.push(`Fraud signals: ${fraud.fasCount} FAS + ${fraud.irsfCount} IRSF events`);

      recs.push({
        id: `deprioritise-${bad.carrierName}`,
        action: `Deprioritise ${bad.carrierName} routing by 20%`,
        confidence: Math.round(Math.min(82, 50 + (100 - (bad.stabilityScore ?? 100)) * 0.32)),
        reasons: [...reasons, "No healthy alternative available — reduce exposure"],
        risk: "medium",
        expectedImpact: "Reduces degraded traffic exposure until carrier recovers",
        currentVendor: bad.carrierName,
        fraudSignals: fraud ?? { fasCount: 0, irsfCount: 0, avgFraudScore: null },
        simulate: { asrDelta: null, stabilityDelta: null, projectedAsr: null, projectedStability: null },
      });
    }
  }

  // ── Rule 2: Fraud-only signal (carrier not yet degraded but high fraud) ──────
  for (const [vendorName, fraud] of fraudProfiles) {
    const totalFraud = fraud.fasCount + fraud.irsfCount;
    if (totalFraud < 5) continue;
    if (recs.some(r => r.currentVendor === vendorName)) continue;
    const carrierScore = scores.find(s => s.carrierName === vendorName);
    if (carrierScore && isDegraded(carrierScore)) continue; // already handled

    recs.push({
      id: `fraud-${vendorName}`,
      action: `Investigate ${vendorName} for fraud exposure — flag for review`,
      confidence: Math.round(Math.min(80, 50 + totalFraud * 2.5)),
      reasons: [
        `${fraud.fasCount} FAS events in 24h via ${vendorName}`,
        fraud.irsfCount > 0 ? `${fraud.irsfCount} IRSF risk events detected` : "",
        fraud.avgFraudScore != null ? `Avg fraud score: ${fraud.avgFraudScore.toFixed(0)}/100` : "",
        "Elevated fraud signals warrant routing review",
      ].filter(Boolean),
      risk: fraud.irsfCount > 2 ? "high" : "medium",
      expectedImpact: "Reduces fraud-originated traffic risk on this carrier",
      currentVendor: vendorName,
      fraudSignals: fraud,
      simulate: { asrDelta: null, stabilityDelta: null, projectedAsr: null, projectedStability: null },
    });
  }

  // ── Rule 3: Recovery re-enable ───────────────────────────────────────────────
  for (const r of recoveringScores) {
    const hadIssue = pendingSuggestions.some(sg => sg.carrierName === r.carrierName);
    if (!hadIssue && (r.stabilityScore ?? 0) <= 82) continue;
    if (recs.some(rec => rec.currentVendor === r.carrierName || rec.targetVendor === r.carrierName)) continue;

    recs.push({
      id: `restore-${r.carrierName}`,
      action: `Restore ${r.carrierName} to full priority`,
      confidence: 72,
      reasons: [
        `Stability recovered: ${(r.stabilityScore ?? 0).toFixed(0)}/100`,
        `ASR: ${(r.rollingAsr ?? 0).toFixed(1)}%`,
        "Trend: improving — carrier performance is now within acceptable range",
        r.sampleCount > 10 ? `Based on ${r.sampleCount} recent samples` : "",
      ].filter(Boolean),
      risk: "low",
      expectedImpact: "Restores full capacity on a recovered healthy carrier",
      targetVendor: r.carrierName,
      fraudSignals: fraudProfiles.get(r.carrierName) ?? { fasCount: 0, irsfCount: 0, avgFraudScore: null },
      simulate: {
        asrDelta: (r.rollingAsr ?? 0) - 60,
        stabilityDelta: (r.stabilityScore ?? 0) - 70,
        projectedAsr: r.rollingAsr,
        projectedStability: r.stabilityScore,
      },
    });
  }

  // ── Rule 4: Vendor-prefix Q-Score based routing ───────────────────────────
  if (vendorPrefixData?.vendors && vendorPrefixData.vendors.length >= 2) {
    for (const vendor of vendorPrefixData.vendors) {
      const failPrefixes = (vendor.prefixes ?? []).filter(
        (p: any) => p.status === "fail" && !p.insufficient && p.calls >= 12
      );
      for (const fp of failPrefixes.slice(0, 1)) {
        const betterVendors = vendorPrefixData.vendors
          .filter((v: any) => v.vendor !== vendor.vendor)
          .map((v: any) => {
            const match = (v.prefixes ?? []).find((p: any) => p.country === fp.country && !p.insufficient);
            return match ? { vendor: v.vendor, q: match.q, asr: match.asr } : null;
          })
          .filter((v: any): v is NonNullable<typeof v> => v != null && v.q > fp.q + 12)
          .sort((a: any, b: any) => b.q - a.q);

        if (betterVendors.length > 0) {
          const best = betterVendors[0];
          const qDiff = best.q - fp.q;
          const key = `qscore-${vendor.vendor}-${fp.country}`;
          if (!recs.some(r => r.id === key || r.currentVendor === vendor.vendor)) {
            recs.push({
              id: key,
              action: `Route ${fp.label} via ${best.vendor} instead of ${vendor.vendor}`,
              confidence: Math.round(Math.min(88, 56 + qDiff * 0.65)),
              reasons: [
                `Q-Score on ${fp.label}: ${fp.q}/100 via ${vendor.vendor}`,
                `ASR: ${fp.asr?.toFixed(1)}%, NER: ${fp.ner?.toFixed(1)}% (${fp.calls} calls)`,
                `${best.vendor} Q-Score same route: ${best.q}/100 (+${qDiff} pts)`,
              ],
              risk: "low",
              expectedImpact: `+${qDiff} Q-Score points on ${fp.label}`,
              currentVendor: vendor.vendor,
              targetVendor: best.vendor,
              destination: fp.label,
              fraudSignals: fraudProfiles.get(vendor.vendor) ?? { fasCount: 0, irsfCount: 0, avgFraudScore: null },
              simulate: {
                asrDelta: best.asr != null && fp.asr != null ? best.asr - fp.asr : null,
                stabilityDelta: qDiff,
                projectedAsr: best.asr ?? null,
                projectedStability: best.q,
              },
            });
          }
        }
      }
    }
  }

  // ── Rule 5: Negative / critically-low LCR margin (margin-driven, quality OK) ─
  for (const [vendorName, margin] of marginProfiles) {
    if (!margin.isNegativeMargin && (margin.avgMarginPct ?? 99) >= 8) continue;
    if (recs.some(r => r.currentVendor === vendorName)) continue;
    const carrierScore = scores.find(s => s.carrierName === vendorName);
    // Only flag if quality isn't already critical (already covered by Rule 1)
    if (carrierScore && isCritical(carrierScore)) continue;

    const fraud = fraudProfiles.get(vendorName);
    const isPureMarginalLoss = margin.isNegativeMargin;

    recs.push({
      id: `margin-${vendorName}`,
      action: `Review LCR cost on ${vendorName} — ${isPureMarginalLoss ? "negative margin detected" : "margin critically low"}`,
      confidence: Math.round(Math.min(82, 52 + (isPureMarginalLoss ? 20 : Math.abs(margin.avgMarginPct ?? 0) * 2))),
      reasons: [
        margin.avgMarginPct != null
          ? `LCR margin: ${margin.avgMarginPct.toFixed(1)}%${isPureMarginalLoss ? " (operating at a loss)" : " — critically low"}`
          : "Margin data indicates underperformance",
        margin.totalCalls > 0 ? `${margin.totalCalls.toLocaleString()} calls analysed in margin window` : "",
        carrierScore?.rollingAsr != null ? `Carrier ASR: ${carrierScore.rollingAsr.toFixed(1)}% — quality otherwise acceptable` : "",
        "Re-negotiate cost tariff or shift high-volume prefixes to better-margin carrier",
        fraud && (fraud.fasCount + fraud.irsfCount) > 0
          ? `Additional fraud signal: ${fraud.fasCount} FAS + ${fraud.irsfCount} IRSF events compound the loss`
          : "",
      ].filter(Boolean),
      risk: isPureMarginalLoss ? "high" : "medium",
      expectedImpact: isPureMarginalLoss
        ? "Eliminates operating loss on this carrier's traffic volume"
        : "Improves margin from critically low to acceptable range",
      currentVendor: vendorName,
      fraudSignals: fraud ?? { fasCount: 0, irsfCount: 0, avgFraudScore: null },
      simulate: { asrDelta: null, stabilityDelta: null, projectedAsr: null, projectedStability: null },
    });
  }

  // Sort by confidence desc, deduplicate by currentVendor
  const seen = new Set<string>();
  const deduped: AiRouteRecommendation[] = [];
  for (const rec of recs.sort((a, b) => b.confidence - a.confidence)) {
    const key = rec.currentVendor ?? rec.id;
    if (!seen.has(key)) { seen.add(key); deduped.push(rec); }
  }

  return deduped.slice(0, 5); // Max 5 ranked recommendations
}

// ── OpenAI contract validation ────────────────────────────────────────────────

const REC_SCHEMA_KEYS: (keyof AiRouteRecommendation)[] = [
  "id", "action", "confidence", "reasons", "risk", "expectedImpact",
];

function validateAiOutput(raw: any, baseline: AiRouteRecommendation[]): AiRouteRecommendation[] {
  if (!Array.isArray(raw)) throw new AiContractError("OpenAI returned non-array recommendations");
  if (raw.length < 1 || raw.length > 5) throw new AiContractError(`OpenAI returned ${raw.length} recommendations — expected 1–5`);

  for (const item of raw) {
    for (const key of REC_SCHEMA_KEYS) {
      if (!(key in item)) throw new AiContractError(`OpenAI output missing required field "${key}"`);
    }
    if (!["low", "medium", "high"].includes(item.risk))
      throw new AiContractError(`OpenAI output has invalid risk value: "${item.risk}"`);
    if (typeof item.confidence !== "number" || item.confidence < 0 || item.confidence > 100)
      throw new AiContractError("OpenAI output has out-of-range confidence");
    if (!Array.isArray(item.reasons) || item.reasons.length === 0)
      throw new AiContractError("OpenAI output has empty or non-array reasons");
  }

  // Merge simulate/fraudSignals from baseline (OpenAI doesn't own those fields)
  return raw.map((item: any, i: number) => ({
    ...item,
    aiInsight: typeof item.aiInsight === "string" && item.aiInsight.trim() ? item.aiInsight.trim() : undefined,
    fraudSignals: baseline[i]?.fraudSignals ?? item.fraudSignals,
    simulate: baseline[i]?.simulate ?? item.simulate ?? { asrDelta: null, stabilityDelta: null, projectedAsr: null, projectedStability: null },
  }));
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function runRouteCopilot(
  vendorPrefixData?: any,
): Promise<CopilotResult> {
  const now = new Date().toISOString();
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const since6h  = new Date(Date.now() -  6 * 60 * 60 * 1000);

  // ── Load all telemetry in parallel ─────────────────────────────────────────
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [allScores, pendingSuggestions, fraudProfiles, marginProfiles, sipErrors, snapshotSignals] = await Promise.all([
    db.select().from(carrierQualityScores).orderBy(desc(carrierQualityScores.lastComputedAt)),
    db.select().from(routingSuggestions).where(
      and(eq(routingSuggestions.status, "pending"), gte(routingSuggestions.createdAt, since6h))
    ),
    loadFraudProfilesPerVendor(since24h),
    loadMarginProfilesPerVendor(since7d),  // 7-day window for more stable margin signal
    loadSipErrorSnapshot().catch(() => [] as SipErrorSnapshot[]),
    getCopilotVendorSignals().catch(() => new Map()), // route quality snapshots — non-fatal
  ]);

  // Merge snapshot signals into carrier scores to improve copilot accuracy.
  // For each carrier, if the CDR-based ASR snapshot diverges significantly from
  // the stored synthetic-test score, override the working score with the real-traffic
  // value so the rule engine and OpenAI prompt see live traffic quality.
  const enrichmentLog: string[] = [];
  if (snapshotSignals.size > 0) {
    for (const score of allScores) {
      const signal = snapshotSignals.get(score.carrierName);
      if (!signal || signal.asr == null || signal.callCount < 10) continue;
      const storedAsr = score.rollingAsr ?? 100;
      const delta = Math.abs(storedAsr - signal.asr);
      if (delta >= 10) {
        // CDR-based signal diverges ≥10pp — use the real-traffic ASR for rule engine
        (score as any).rollingAsr = signal.asr;
        enrichmentLog.push(`${score.carrierName}: asr ${storedAsr.toFixed(1)}→${signal.asr.toFixed(1)} (${signal.callCount} live calls)`);
      }
    }
    if (enrichmentLog.length > 0) {
      console.log(`[copilot] snapshot enrichment applied to ${enrichmentLog.length} carrier(s): ${enrichmentLog.join("; ")}`);
    } else {
      console.debug(`[copilot] snapshot signals loaded (${snapshotSignals.size} vendors); no divergence ≥10pp`);
    }
  }

  // Deduplicate scores: latest 24h score per carrier
  const latestByCarrier = new Map<string, CarrierRow>();
  for (const row of allScores) {
    if (row.windowHours === 24 && !latestByCarrier.has(row.carrierName)) {
      latestByCarrier.set(row.carrierName, row);
    }
  }
  const scores = [...latestByCarrier.values()];

  const degradedScores = scores.filter(isDegraded);
  const criticalScores = scores.filter(isCritical);
  const fraudAlertCarriers = [...fraudProfiles.entries()].filter(([, v]) => v.fasCount + v.irsfCount >= 3).length;
  const negativeMarginVendors = [...marginProfiles.entries()].filter(([, v]) => v.isNegativeMargin).length;

  // ── Rule engine: build baseline recommendations ─────────────────────────────
  // Note: simulate projections are computed server-side from carrier score deltas.
  // The server has the authoritative carrier telemetry; client-side projection
  // would duplicate this work without access to the raw score data.
  const baseline = buildRuleBasedRecommendations(scores, pendingSuggestions, fraudProfiles, marginProfiles, vendorPrefixData);

  // ── Summary fields ─────────────────────────────────────────────────────────
  const topSignal = criticalScores.length > 0
    ? `${criticalScores.length} critical carrier${criticalScores.length > 1 ? "s" : ""} — immediate rerouting recommended`
    : degradedScores.length > 0
    ? `${degradedScores.length} degraded carrier${degradedScores.length > 1 ? "s" : ""} — rerouting advised`
    : fraudAlertCarriers > 0
    ? `${fraudAlertCarriers} carrier${fraudAlertCarriers > 1 ? "s" : ""} with elevated fraud signals`
    : "All carriers within acceptable performance range";

  // ── OpenAI enhancement (explicit mode, not silent) ─────────────────────────
  if (!process.env.OPENAI_API_KEY) {
    // Explicit non-silent warning: user sees "rule_based_preview" mode
    return {
      generatedAt: now,
      mode: "rule_based_preview",
      warning: "OpenAI API key not configured — showing rule-based preview. Add OPENAI_API_KEY to enable AI-enhanced recommendations.",
      recommendations: baseline,
      summary: {
        totalCarriers: scores.length,
        degradedCarriers: degradedScores.length,
        criticalCarriers: criticalScores.length,
        fraudAlertCarriers,
        topSignal,
        analysisNote: `Analysed ${scores.length} carrier${scores.length > 1 ? "s" : ""}, ${fraudProfiles.size} fraud profiles, ${marginProfiles.size} margin profiles${negativeMarginVendors > 0 ? ` (${negativeMarginVendors} negative-margin)` : ""} · Rule-based preview · ${baseline.length} recommendation${baseline.length !== 1 ? "s" : ""}`,
      },
    };
  }

  // OpenAI key present — call GPT-4o-mini to format and validate recommendations
  if (baseline.length === 0) {
    // No issues detected — no need to call OpenAI
    return {
      generatedAt: now,
      mode: "ai_enhanced",
      recommendations: [],
      summary: {
        totalCarriers: scores.length,
        degradedCarriers: 0,
        criticalCarriers: 0,
        fraudAlertCarriers,
        topSignal,
        analysisNote: `Analysed ${scores.length} carrier${scores.length > 1 ? "s" : ""} · AI-enhanced · No issues detected`,
      },
    };
  }

  // ── Shared rule-based fallback builder ────────────────────────────────────
  function ruleBasedFallback(warning: string): CopilotResult {
    return {
      generatedAt: now,
      mode: "rule_based_preview",
      warning,
      recommendations: baseline,
      summary: {
        totalCarriers: scores.length,
        degradedCarriers: degradedScores.length,
        criticalCarriers: criticalScores.length,
        fraudAlertCarriers,
        topSignal,
        analysisNote: `Analysed ${scores.length} carrier${scores.length > 1 ? "s" : ""}, ${fraudProfiles.size} fraud profiles · Rule-based fallback · ${baseline.length} recommendation${baseline.length !== 1 ? "s" : ""}`,
      },
    };
  }

  // ── OpenAI enrichment (with graceful fallback on any failure) ─────────────
  let rawContent: string;
  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const systemPrompt = `You are an expert VoIP network operations advisor for a telecom carrier platform.
You receive route recommendations computed by a rule-based system and must:
1. Rewrite the "action" as a clear, specific, operator-ready instruction (max 12 words).
2. Keep "reasons" as an array of 2–4 concise factual bullet strings.
3. Keep "expectedImpact" as one short sentence.
4. Add an "aiInsight" field: one sentence of telecom-specific operational context. If SIP error telemetry is provided, cite specific error codes (e.g. "503 congestion spike", "486 CLI screening") in your insight. This must add genuine telecom expertise beyond what the rule engine already states — do NOT just paraphrase the reasons. Max 30 words.
5. Preserve all other fields (id, confidence, risk, currentVendor, targetVendor, destination) exactly as given.
6. Return a JSON object: { "recommendations": [ ...same schema... ] }

Output MUST be valid JSON. The "recommendations" array MUST have ${baseline.length} items (same order).
Risk values: only "low", "medium", or "high".
Confidence: integer 0–100 (you may adjust ±5 based on telecom best-practice judgement).`;

    // ── Build SIP error telemetry context for the AI ──────────────────────────
    let sipContext = "";
    if (sipErrors.length > 0) {
      const congestionVendors  = sipErrors.filter(s => s.hasCongestion).map(s => s.vendorName);
      const rejectionVendors   = sipErrors.filter(s => s.hasCliRejection).map(s => s.vendorName);
      const highErrorVendors   = sipErrors.filter(s => s.maxRate > 15).map(s => `${s.vendorName} (${s.maxRate.toFixed(1)}%)`);

      const lines: string[] = ["SIP ERROR TELEMETRY (15-min rolling window):"];
      for (const snap of sipErrors.slice(0, 6)) {
        const w15 = snap.windows[15] ?? {};
        const codes = Object.entries(w15)
          .sort(([, a], [, b]) => b.rate - a.rate)
          .map(([code, v]) => `${CODE_LABELS[Number(code)] ?? code}: ${v.rate.toFixed(1)}%`)
          .join(", ");
        if (codes) lines.push(`  ${snap.vendorName}: ${codes}`);
      }
      if (congestionVendors.length > 0)
        lines.push(`CONGESTION SIGNAL (503 >10%): ${congestionVendors.join(", ")}`);
      if (rejectionVendors.length > 0)
        lines.push(`CLI REJECTION SIGNAL (486 >10%): ${rejectionVendors.join(", ")}`);
      if (highErrorVendors.length > 0)
        lines.push(`HIGH TOTAL ERROR RATE (>15%): ${highErrorVendors.join(", ")}`);

      sipContext = "\n\n" + lines.join("\n");
    }

    const userContent = JSON.stringify(baseline.map(r => ({
      id: r.id, action: r.action, confidence: r.confidence, reasons: r.reasons,
      risk: r.risk, expectedImpact: r.expectedImpact,
      currentVendor: r.currentVendor, targetVendor: r.targetVendor, destination: r.destination,
      fraudSignals: r.fraudSignals,
    }))) + sipContext;

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 1200,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userContent },
      ],
    });
    rawContent = completion.choices[0]?.message?.content ?? "";
    if (!rawContent) {
      console.warn("[ai-recommendations] OpenAI returned empty response — falling back to rule-based");
      return ruleBasedFallback("OpenAI returned an empty response — showing rule-based recommendations.");
    }
  } catch (err: any) {
    const msg = err?.message ?? "unknown error";
    console.warn("[ai-recommendations] OpenAI API error — falling back to rule-based:", msg);
    return ruleBasedFallback(`OpenAI unavailable (${msg}) — showing rule-based recommendations.`);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    console.warn("[ai-recommendations] OpenAI returned malformed JSON — falling back to rule-based");
    return ruleBasedFallback("OpenAI returned malformed output — showing rule-based recommendations.");
  }

  if (!parsed.recommendations) {
    console.warn("[ai-recommendations] OpenAI response missing 'recommendations' key — falling back");
    return ruleBasedFallback("OpenAI response was invalid — showing rule-based recommendations.");
  }

  let validated: AiRouteRecommendation[];
  try {
    validated = validateAiOutput(parsed.recommendations, baseline);
  } catch (err: any) {
    console.warn("[ai-recommendations] OpenAI output failed contract validation — falling back:", err.message);
    return ruleBasedFallback(`OpenAI output failed validation (${err.message}) — showing rule-based recommendations.`);
  }

  return {
    generatedAt: now,
    mode: "ai_enhanced",
    recommendations: validated,
    summary: {
      totalCarriers: scores.length,
      degradedCarriers: degradedScores.length,
      criticalCarriers: criticalScores.length,
      fraudAlertCarriers,
      topSignal,
      analysisNote: `Analysed ${scores.length} carrier${scores.length > 1 ? "s" : ""}, ${fraudProfiles.size} fraud profiles · AI-enhanced · ${validated.length} recommendation${validated.length !== 1 ? "s" : ""}`,
    },
  };
}
