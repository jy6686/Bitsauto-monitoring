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
} from "../../../shared/schema";
import { desc, eq, gte, and } from "drizzle-orm";

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
  vendorPrefixData?: any,
): AiRouteRecommendation[] {
  const degradedScores  = scores.filter(isDegraded);
  const healthyScores   = scores.filter(isHealthy);
  const recoveringScores = scores.filter(isRecovering);

  const recs: AiRouteRecommendation[] = [];

  // ── Rule 1: Traffic shift degraded→healthy ──────────────────────────────────
  for (const bad of degradedScores) {
    const fraud = fraudProfiles.get(bad.carrierName);
    const alternatives = healthyScores
      .filter(h => h.carrierName !== bad.carrierName)
      .sort((a, b) => (b.stabilityScore ?? 0) - (a.stabilityScore ?? 0));

    if (alternatives.length > 0) {
      const best = alternatives[0];
      const stabilityGain = (best.stabilityScore ?? 0) - (bad.stabilityScore ?? 0);
      const asrGain = (best.rollingAsr ?? 0) - (bad.rollingAsr ?? 0);
      const critical = isCritical(bad);

      const fraudBonus = fraud && (fraud.fasCount + fraud.irsfCount) > 3 ? 8 : 0;
      const confidence = Math.round(Math.min(
        95,
        critical ? 80 + Math.min(stabilityGain * 0.4, 12) + fraudBonus
                 : 58 + Math.min(stabilityGain * 0.5, 22) + fraudBonus,
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
        risk: critical ? "low" : (bad.stabilityScore ?? 100) < 48 ? "low" : "medium",
        expectedImpact: [
          stabilityGain > 0 ? `Stability +${stabilityGain.toFixed(0)} pts` : null,
          asrGain > 0 ? `ASR +${asrGain.toFixed(1)}%` : null,
          fraud && fraud.fasCount > 0 ? `Reduces FAS exposure` : null,
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
      const fraud = fraudProfiles.get(bad.carrierName);
      const reasons: string[] = [];
      if (bad.stabilityScore != null) reasons.push(`Stability: ${bad.stabilityScore.toFixed(0)}/100`);
      if (bad.rollingAsr != null)      reasons.push(`ASR: ${bad.rollingAsr.toFixed(1)}%`);
      if (bad.trend === "degrading")   reasons.push("Trend: actively degrading");
      if (bad.failureRate != null && bad.failureRate > 25)
        reasons.push(`High failure rate: ${bad.failureRate.toFixed(1)}%`);
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

  // Merge simulate data from baseline (OpenAI doesn't touch simulate fields)
  return raw.map((item: any, i: number) => ({
    ...item,
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
  const [allScores, pendingSuggestions, fraudProfiles] = await Promise.all([
    db.select().from(carrierQualityScores).orderBy(desc(carrierQualityScores.lastComputedAt)),
    db.select().from(routingSuggestions).where(
      and(eq(routingSuggestions.status, "pending"), gte(routingSuggestions.createdAt, since6h))
    ),
    loadFraudProfilesPerVendor(since24h),
  ]);

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

  // ── Rule engine: build baseline recommendations ─────────────────────────────
  const baseline = buildRuleBasedRecommendations(scores, pendingSuggestions, fraudProfiles, vendorPrefixData);

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
        analysisNote: `Analysed ${scores.length} carrier${scores.length > 1 ? "s" : ""}, ${fraudProfiles.size} vendor fraud profiles · Rule-based preview · ${baseline.length} recommendation${baseline.length !== 1 ? "s" : ""}`,
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

  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const systemPrompt = `You are an expert VoIP network operations advisor for a telecom carrier platform.
You receive route recommendations computed by a rule-based system and must:
1. Rewrite the "action" as a clear, specific, operator-ready instruction (max 12 words).
2. Keep "reasons" as an array of 2–4 concise factual bullet strings.
3. Keep "expectedImpact" as one short sentence.
4. Preserve all other fields (id, confidence, risk, currentVendor, targetVendor, destination) exactly as given.
5. Return a JSON object: { "recommendations": [ ...same schema... ] }

Output MUST be valid JSON. The "recommendations" array MUST have ${baseline.length} items (same order).
Risk values: only "low", "medium", or "high".
Confidence: integer 0–100 (you may adjust ±5 based on telecom best-practice judgement).`;

  const userContent = JSON.stringify(baseline.map(r => ({
    id: r.id, action: r.action, confidence: r.confidence, reasons: r.reasons,
    risk: r.risk, expectedImpact: r.expectedImpact,
    currentVendor: r.currentVendor, targetVendor: r.targetVendor, destination: r.destination,
    fraudSignals: r.fraudSignals,
  })));

  let rawContent: string;
  try {
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
    if (!rawContent) throw new AiContractError("OpenAI returned empty response");
  } catch (err: any) {
    if (err instanceof AiContractError) throw err;
    // Rate-limit, timeout, network error
    throw new AiContractError(`OpenAI API error: ${err.message ?? "unknown error"}`);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    throw new AiContractError("OpenAI returned malformed JSON — cannot parse response");
  }

  if (!parsed.recommendations) {
    throw new AiContractError("OpenAI response missing 'recommendations' key");
  }

  const validated = validateAiOutput(parsed.recommendations, baseline);

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
