/**
 * AI Route Copilot — Intelligent Route Recommendation Engine
 *
 * Analyses carrier scores, Q-scores, ASR/ACD, degradation signals, and
 * vendor prefix intelligence to generate ranked, human-readable route
 * recommendations. Phase 1: observe + recommend only (no auto-reroute).
 *
 * OpenAI is optional — the engine works entirely from your own telemetry.
 * If OPENAI_API_KEY is set, GPT-4o enriches the recommendation text;
 * otherwise the rule-based engine produces full recommendations on its own.
 */

import { db } from "../../db";
import { carrierQualityScores, routingSuggestions } from "../../../shared/schema";
import { desc, eq, gte, and } from "drizzle-orm";

// ── Types ─────────────────────────────────────────────────────────────────────

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
  simulate: {
    asrDelta: number | null;
    stabilityDelta: number | null;
    projectedAsr: number | null;
    projectedStability: number | null;
  };
}

export interface CopilotResult {
  generatedAt: string;
  aiEnhanced: boolean;
  recommendations: AiRouteRecommendation[];
  summary: {
    totalCarriers: number;
    degradedCarriers: number;
    criticalCarriers: number;
    topSignal: string;
    analysisNote: string;
  };
}

type CarrierRow = typeof carrierQualityScores.$inferSelect;

// ── Helpers ───────────────────────────────────────────────────────────────────

function isCritical(s: CarrierRow) {
  return (s.stabilityScore ?? 100) < 35 || (s.rollingAsr ?? 100) < 25;
}
function isDegraded(s: CarrierRow) {
  return (s.stabilityScore ?? 100) < 58 || (s.rollingAsr ?? 100) < 42;
}
function isHealthy(s: CarrierRow) {
  return (s.stabilityScore ?? 0) >= 70 && (s.rollingAsr ?? 0) >= 58;
}
function isRecovering(s: CarrierRow) {
  return (s.stabilityScore ?? 0) > 76 && s.trend === "improving" && (s.rollingAsr ?? 0) > 70;
}

// ── Main engine ───────────────────────────────────────────────────────────────

export async function runRouteCopilot(
  vendorPrefixData?: any,
): Promise<CopilotResult> {
  const now = new Date().toISOString();

  // ── Load carrier scores (24h window) ─────────────────────────────────────────
  const allScores = await db
    .select()
    .from(carrierQualityScores)
    .orderBy(desc(carrierQualityScores.lastComputedAt));

  const latestByCarrier = new Map<string, CarrierRow>();
  for (const row of allScores) {
    if (row.windowHours === 24 && !latestByCarrier.has(row.carrierName)) {
      latestByCarrier.set(row.carrierName, row);
    }
  }
  const scores = [...latestByCarrier.values()];

  // ── Load pending routing suggestions (last 6h) ────────────────────────────
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const pendingSuggestions = await db
    .select()
    .from(routingSuggestions)
    .where(and(eq(routingSuggestions.status, "pending"), gte(routingSuggestions.createdAt, sixHoursAgo)));

  const degradedScores  = scores.filter(isDegraded);
  const criticalScores  = scores.filter(isCritical);
  const healthyScores   = scores.filter(isHealthy);
  const recoveringScores = scores.filter(isRecovering);

  const recommendations: AiRouteRecommendation[] = [];

  // ── Rule 1: Traffic shift — degraded → better alternative ────────────────
  for (const bad of degradedScores) {
    const alternatives = healthyScores
      .filter(h => h.carrierName !== bad.carrierName)
      .sort((a, b) => (b.stabilityScore ?? 0) - (a.stabilityScore ?? 0));

    if (alternatives.length > 0) {
      const best = alternatives[0];
      const stabilityGain = (best.stabilityScore ?? 0) - (bad.stabilityScore ?? 0);
      const asrGain = (best.rollingAsr ?? 0) - (bad.rollingAsr ?? 0);
      const critical = isCritical(bad);

      const confidence = Math.round(Math.min(
        95,
        critical ? 78 + Math.min(stabilityGain * 0.5, 17) : 58 + Math.min(stabilityGain * 0.6, 27),
      ));

      const reasons: string[] = [];
      if (bad.stabilityScore != null)
        reasons.push(`${bad.carrierName} stability: ${bad.stabilityScore.toFixed(0)}/100 (${bad.trend ?? "stable"} trend)`);
      if (bad.rollingAsr != null && bad.rollingAsr < 65)
        reasons.push(`Rolling ASR ${bad.rollingAsr.toFixed(1)}% — below 65% threshold`);
      if (bad.avgPddMs != null && bad.avgPddMs > 2800)
        reasons.push(`Avg PDD ${(bad.avgPddMs / 1000).toFixed(1)}s — elevated latency`);
      if (bad.failureRate != null && bad.failureRate > 30)
        reasons.push(`Failure rate ${bad.failureRate.toFixed(1)}% — high`);
      if (stabilityGain > 5)
        reasons.push(`${best.carrierName} stability: ${best.stabilityScore?.toFixed(0)}/100 (+${stabilityGain.toFixed(0)} pts superior)`);
      if (asrGain > 0)
        reasons.push(`ASR gain if rerouted: +${asrGain.toFixed(1)}%`);
      if (best.trend === "improving")
        reasons.push(`${best.carrierName} is on an improving trajectory`);
      if (best.sampleCount > 20)
        reasons.push(`${best.carrierName} score based on ${best.sampleCount} call samples`);

      recommendations.push({
        id: `shift-${bad.carrierName}-to-${best.carrierName}`,
        action: `Shift traffic: ${bad.carrierName} → ${best.carrierName}`,
        confidence,
        reasons,
        risk: critical ? "low" : (bad.stabilityScore ?? 100) < 48 ? "low" : "medium",
        expectedImpact: [
          stabilityGain > 0 ? `Stability +${stabilityGain.toFixed(0)} pts` : null,
          asrGain > 0 ? `ASR +${asrGain.toFixed(1)}%` : null,
          `Reduced ${critical ? "critical" : "degraded"} exposure`,
        ].filter(Boolean).join(", "),
        currentVendor: bad.carrierName,
        targetVendor: best.carrierName,
        simulate: {
          asrDelta: asrGain,
          stabilityDelta: stabilityGain,
          projectedAsr: best.rollingAsr,
          projectedStability: best.stabilityScore,
        },
      });
    } else {
      // No healthy alternative — deprioritise
      const reasons: string[] = [];
      if (bad.stabilityScore != null)
        reasons.push(`Stability score: ${bad.stabilityScore.toFixed(0)}/100`);
      if (bad.rollingAsr != null)
        reasons.push(`ASR: ${bad.rollingAsr.toFixed(1)}%`);
      if (bad.trend === "degrading")
        reasons.push("Trend is actively degrading");
      if (bad.failureRate != null && bad.failureRate > 25)
        reasons.push(`High failure rate: ${bad.failureRate.toFixed(1)}%`);

      recommendations.push({
        id: `deprioritise-${bad.carrierName}`,
        action: `Deprioritise ${bad.carrierName} routing by 20%`,
        confidence: Math.round(Math.min(85, 52 + (100 - (bad.stabilityScore ?? 100)) * 0.35)),
        reasons: [...reasons, "No healthy alternative available — reduce exposure"],
        risk: "medium",
        expectedImpact: "Reduces degraded traffic until carrier recovers",
        currentVendor: bad.carrierName,
        simulate: { asrDelta: null, stabilityDelta: null, projectedAsr: null, projectedStability: null },
      });
    }
  }

  // ── Rule 2: Re-enable recovering carriers ────────────────────────────────
  for (const r of recoveringScores) {
    const hadIssue = pendingSuggestions.some(sg => sg.carrierName === r.carrierName);
    if (hadIssue || (r.stabilityScore ?? 0) > 82) {
      recommendations.push({
        id: `restore-${r.carrierName}`,
        action: `Restore ${r.carrierName} to full priority`,
        confidence: 74,
        reasons: [
          `Stability recovered: ${(r.stabilityScore ?? 0).toFixed(0)}/100`,
          `ASR now: ${(r.rollingAsr ?? 0).toFixed(1)}%`,
          "Trend: improving — carrier is performing well",
          r.sampleCount > 10 ? `Based on ${r.sampleCount} recent samples` : "",
        ].filter(Boolean),
        risk: "low",
        expectedImpact: "Restores full capacity on a recovered, healthy carrier",
        targetVendor: r.carrierName,
        simulate: {
          asrDelta: (r.rollingAsr ?? 0) - 60,
          stabilityDelta: (r.stabilityScore ?? 0) - 70,
          projectedAsr: r.rollingAsr,
          projectedStability: r.stabilityScore,
        },
      });
    }
  }

  // ── Rule 3: Vendor-prefix Q-Score based routing ───────────────────────────
  if (vendorPrefixData?.vendors && vendorPrefixData.vendors.length >= 2) {
    for (const vendor of vendorPrefixData.vendors) {
      const failPrefixes = (vendor.prefixes ?? []).filter(
        (p: any) => p.status === "fail" && !p.insufficient && p.calls >= 12
      );
      for (const fp of failPrefixes.slice(0, 2)) {
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
          if (!recommendations.some(r => r.id === key)) {
            recommendations.push({
              id: key,
              action: `Route ${fp.label} via ${best.vendor} instead of ${vendor.vendor}`,
              confidence: Math.round(Math.min(88, 58 + qDiff * 0.7)),
              reasons: [
                `Q-Score on ${fp.label}: ${fp.q}/100 via ${vendor.vendor}`,
                `ASR: ${fp.asr?.toFixed(1)}%, NER: ${fp.ner?.toFixed(1)}% (${fp.calls} calls)`,
                `${best.vendor} Q-Score same route: ${best.q}/100 (+${qDiff} pts)`,
                `ASR via ${best.vendor}: ${best.asr?.toFixed(1)}%`,
              ],
              risk: "low",
              expectedImpact: `+${qDiff} Q-Score points on ${fp.label}`,
              currentVendor: vendor.vendor,
              targetVendor: best.vendor,
              destination: fp.label,
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

  // ── Rule 4: High PDD investigation ─────────────────────────────────────────
  const highPdd = scores
    .filter(s => (s.avgPddMs ?? 0) > 4500 && (s.stabilityScore ?? 100) < 72 && s.sampleCount >= 5)
    .sort((a, b) => (b.avgPddMs ?? 0) - (a.avgPddMs ?? 0));
  for (const s of highPdd.slice(0, 2)) {
    const idKey = `pdd-${s.carrierName}`;
    if (!recommendations.some(r => r.id === idKey)) {
      recommendations.push({
        id: idKey,
        action: `Investigate ${s.carrierName} for SIP routing delay — consider failover`,
        confidence: 65,
        reasons: [
          `Avg PDD: ${((s.avgPddMs ?? 0) / 1000).toFixed(2)}s — exceeds 4.5s threshold`,
          `Stability: ${(s.stabilityScore ?? 0).toFixed(0)}/100`,
          s.p95PddMs != null ? `P95 PDD: ${(s.p95PddMs / 1000).toFixed(2)}s` : "",
          "High PDD increases perceived call quality issues",
        ].filter(Boolean),
        risk: "medium",
        expectedImpact: "Identifies SIP network congestion or misconfigured routes",
        currentVendor: s.carrierName,
        simulate: { asrDelta: null, stabilityDelta: null, projectedAsr: null, projectedStability: null },
      });
    }
  }

  // ── Deduplicate by currentVendor (keep highest confidence per vendor) ──────
  const seenVendors = new Map<string, number>();
  const deduped: AiRouteRecommendation[] = [];
  for (const rec of recommendations.sort((a, b) => b.confidence - a.confidence)) {
    const key = rec.currentVendor ?? rec.id;
    if (!seenVendors.has(key)) {
      seenVendors.set(key, rec.confidence);
      deduped.push(rec);
    }
  }

  // ── Optional: OpenAI enhancement ─────────────────────────────────────────
  let aiEnhanced = false;
  if (process.env.OPENAI_API_KEY && deduped.length > 0) {
    try {
      const { default: OpenAI } = await import("openai");
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const context = deduped.slice(0, 5).map(r => ({
        action: r.action,
        confidence: r.confidence,
        reasons: r.reasons,
        risk: r.risk,
      }));
      const completion = await client.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 600,
        messages: [
          {
            role: "system",
            content: "You are an expert VoIP network operations advisor. Given route recommendations from a telecom monitoring system, add brief (1-2 sentence) operational context to each action. Be concise and specific to telecom operations. Return JSON array with same length as input, each with 'id' (0-indexed) and 'context' string.",
          },
          {
            role: "user",
            content: JSON.stringify(context),
          },
        ],
        response_format: { type: "json_object" },
      });
      const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}");
      if (Array.isArray(parsed.recommendations)) {
        for (const item of parsed.recommendations) {
          if (typeof item.id === "number" && deduped[item.id] && item.context) {
            deduped[item.id].reasons.push(`AI: ${item.context}`);
          }
        }
        aiEnhanced = true;
      }
    } catch (e: any) {
      console.warn("[route-copilot] OpenAI enhancement failed (non-fatal):", e.message);
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const topSignal = criticalScores.length > 0
    ? `${criticalScores.length} critical carrier${criticalScores.length > 1 ? "s" : ""} — immediate action recommended`
    : degradedScores.length > 0
    ? `${degradedScores.length} degraded carrier${degradedScores.length > 1 ? "s" : ""} — rerouting advised`
    : recoveringScores.length > 0
    ? `${recoveringScores.length} carrier${recoveringScores.length > 1 ? "s" : ""} recovering — consider restoration`
    : "All carriers within acceptable performance range";

  const analysisNote = scores.length === 0
    ? "No carrier score data available yet — run recompute or wait for the scoring engine to warm up."
    : aiEnhanced
    ? `Analysed ${scores.length} carrier${scores.length > 1 ? "s" : ""} · AI-enhanced reasoning · ${deduped.length} recommendation${deduped.length !== 1 ? "s" : ""}`
    : `Analysed ${scores.length} carrier${scores.length > 1 ? "s" : ""} · Rule-based intelligence · ${deduped.length} recommendation${deduped.length !== 1 ? "s" : ""}`;

  return {
    generatedAt: now,
    aiEnhanced,
    recommendations: deduped.slice(0, 8),
    summary: {
      totalCarriers: scores.length,
      degradedCarriers: degradedScores.length,
      criticalCarriers: criticalScores.length,
      topSignal,
      analysisNote,
    },
  };
}
