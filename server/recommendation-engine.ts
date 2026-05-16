/**
 * C1 — Recommendation Engine
 *
 * Pure computation layer (no side effects, no DB reads).
 * Consumes account state signals, outputs a ranked, explainable action queue.
 *
 * Runner function (runRecommendationEngine) handles DB I/O separately.
 */

import { db } from "./db";
import { accountState } from "@shared/schema";
import { eq } from "drizzle-orm";

// ── Types ────────────────────────────────────────────────────────────────────

export interface AccountInput {
  accountId:          string;
  accountName:        string | null;
  healthScore:        number;
  fraudRisk:          number;
  authExposureScore:  number;
  anomalyScore:       number;
  activeIncidentCount: number;
}

export interface AccountRecommendation {
  riskScore:      number;
  priority:       number;
  urgency:        'immediate' | 'today' | 'monitor';
  dominantSignal: 'exposure' | 'fraud' | 'health' | 'anomaly';
  primaryAction:  string;
  actionReason:   string[];
  confidence:     number;
  signalSummary: {
    healthScore:       number;
    fraudRisk:         number;
    authExposureScore: number;
    anomalyScore:      number;
    activeIncidents:   number;
  };
  computedAt: string;
}

export interface RankedRecommendation extends AccountRecommendation {
  accountId:   string;
  accountName: string | null;
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function computeRiskScore(a: AccountInput): number {
  return clamp(
    (a.fraudRisk          * 0.35) +
    (a.authExposureScore  * 0.35) +
    ((100 - a.healthScore) * 0.20) +
    (a.anomalyScore        * 0.10),
    0, 100,
  );
}

function computeDominantSignal(a: AccountInput): 'exposure' | 'fraud' | 'health' | 'anomaly' {
  const contributions: Array<{ signal: 'exposure' | 'fraud' | 'health' | 'anomaly'; value: number }> = [
    { signal: 'fraud',    value: a.fraudRisk          * 0.35 },
    { signal: 'exposure', value: a.authExposureScore  * 0.35 },
    { signal: 'health',   value: (100 - a.healthScore) * 0.20 },
    { signal: 'anomaly',  value: a.anomalyScore        * 0.10 },
  ];
  return contributions.sort((x, y) => y.value - x.value)[0].signal;
}

type ActionTemplate = (a: AccountInput) => { action: string; reasons: string[]; confidence: number };

const ACTION_TEMPLATES: Record<'exposure' | 'fraud' | 'health' | 'anomaly', ActionTemplate> = {
  exposure: (a) => ({
    action:     'Restrict authentication to specific IPs and enable CLI/CLD validation',
    reasons:    [
      a.authExposureScore >= 75 ? 'Critical auth exposure score' : 'Elevated auth exposure score',
      ...(a.activeIncidentCount > 0 ? [`${a.activeIncidentCount} active exposure incident(s)`] : []),
      ...(a.fraudRisk > 30 ? ['Co-occurring fraud risk detected'] : []),
    ],
    confidence: Math.round(clamp(60 + a.authExposureScore * 0.35, 0, 95)),
  }),
  fraud: (a) => ({
    action:     'Apply rate limits and audit recent call destinations for FAS/IRSF patterns',
    reasons:    [
      a.fraudRisk >= 75 ? 'High fraud risk score' : 'Elevated fraud risk',
      ...(a.activeIncidentCount > 0 ? [`${a.activeIncidentCount} active fraud incident(s)`] : []),
      ...(a.authExposureScore > 40 ? ['Structural exposure amplifies fraud risk'] : []),
    ],
    confidence: Math.round(clamp(55 + a.fraudRisk * 0.40, 0, 95)),
  }),
  health: (a) => ({
    action:     'Escalate to KAM and review routing configuration for performance degradation',
    reasons:    [
      `Health score at ${a.healthScore}/100`,
      ...(a.anomalyScore > 30 ? ['Concurrent anomaly activity detected'] : []),
      ...(a.activeIncidentCount > 0 ? [`${a.activeIncidentCount} active incident(s)`] : []),
    ],
    confidence: Math.round(clamp(50 + (100 - a.healthScore) * 0.35, 0, 90)),
  }),
  anomaly: (a) => ({
    action:     'Investigate destination entropy and flag account for manual review',
    reasons:    [
      `Anomaly score at ${a.anomalyScore}/100`,
      ...(a.activeIncidentCount > 0 ? [`${a.activeIncidentCount} active incident(s)`] : []),
      ...(a.fraudRisk > 20 ? ['Low-level fraud signal present'] : []),
    ],
    confidence: Math.round(clamp(40 + a.anomalyScore * 0.45, 0, 85)),
  }),
};

// ── Pure engine ───────────────────────────────────────────────────────────────

/**
 * Pure, deterministic ranking function.
 * Input: any array of account signal records.
 * Output: ranked recommendations (priority 1 = highest risk).
 * No DB reads, no side effects.
 */
export function computeRecommendations(accounts: AccountInput[]): RankedRecommendation[] {
  const now = new Date().toISOString();

  const scored = accounts.map(a => ({
    account:        a,
    riskScore:      computeRiskScore(a),
    dominantSignal: computeDominantSignal(a),
  }));

  scored.sort((a, b) => b.riskScore - a.riskScore);

  return scored.map(({ account: a, riskScore, dominantSignal }, idx) => {
    const urgency: 'immediate' | 'today' | 'monitor' =
      riskScore >= 70 ? 'immediate' : riskScore >= 40 ? 'today' : 'monitor';
    const { action, reasons, confidence } = ACTION_TEMPLATES[dominantSignal](a);
    return {
      accountId:      a.accountId,
      accountName:    a.accountName,
      riskScore:      Math.round(riskScore * 10) / 10,
      priority:       idx + 1,
      urgency,
      dominantSignal,
      primaryAction:  action,
      actionReason:   reasons.filter(Boolean),
      confidence,
      signalSummary: {
        healthScore:       a.healthScore,
        fraudRisk:         a.fraudRisk,
        authExposureScore: a.authExposureScore,
        anomalyScore:      a.anomalyScore,
        activeIncidents:   a.activeIncidentCount,
      },
      computedAt: now,
    };
  });
}

// ── Runner (DB I/O wrapper) ───────────────────────────────────────────────────

/**
 * Reads all account state rows, runs the pure engine, persists per-account
 * recommendation objects back to account_state.
 */
export async function runRecommendationEngine(): Promise<{
  ranked: number; immediate: number; today: number; monitor: number;
}> {
  const rows = await db.select().from(accountState);
  if (rows.length === 0) return { ranked: 0, immediate: 0, today: 0, monitor: 0 };

  const inputs: AccountInput[] = rows.map(r => ({
    accountId:           r.accountId,
    accountName:         r.accountName,
    healthScore:         r.healthScore,
    fraudRisk:           r.fraudRisk,
    authExposureScore:   r.authExposureScore,
    anomalyScore:        r.anomalyScore,
    activeIncidentCount: r.activeIncidentCount,
  }));

  const recommendations = computeRecommendations(inputs);

  for (const rec of recommendations) {
    const { accountId, accountName: _n, ...recFields } = rec;
    await db.update(accountState)
      .set({ recommendation: recFields })
      .where(eq(accountState.accountId, accountId));
  }

  const immediate = recommendations.filter(r => r.urgency === 'immediate').length;
  const today     = recommendations.filter(r => r.urgency === 'today').length;
  const monitor   = recommendations.filter(r => r.urgency === 'monitor').length;

  return { ranked: recommendations.length, immediate, today, monitor };
}
