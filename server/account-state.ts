/**
 * Account State Engine
 *
 * Computes persistent operational state for every active Sippy account using
 * rule-based weighted signal accumulation. Runs after each anomaly engine cycle.
 *
 * Signal sources:
 *   - CDR cache   : traffic patterns, ASR, ACD, destination entropy, short calls
 *   - FAS events  : fraud detections linked to this account (last 24h)
 *
 * Output: upserted rows in account_state table — one row per active account.
 */

import { db } from "./db";
import { fasEvents, accountState } from "@shared/schema";
import { gte } from "drizzle-orm";
import type { SippyCDR } from "./sippy";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function shannonEntropy(items: string[]): number {
  const freq: Record<string, number> = {};
  for (const d of items) { freq[d] = (freq[d] || 0) + 1; }
  const n = items.length;
  if (n === 0) return 0;
  return -Object.values(freq).reduce((s, c) => {
    const p = c / n;
    return s + p * Math.log2(p);
  }, 0);
}

function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface AccountBucket {
  iAccount:     string;
  accountName:  string;
  totalCalls:   number;
  answeredCalls:number;
  totalDuration:number;
  destinations: string[];
  shortCalls:   number;   // answered calls < 5s
  fasHits:      number;
  maxFraudScore:number;
}

// ─── Main exported function ───────────────────────────────────────────────────

export async function updateAccountState(
  cdrCache: Map<string, SippyCDR>,
  accountNameCache: Map<string, string>,
): Promise<void> {
  try {
    const now       = Date.now();
    const dayMs     = 24 * 60 * 60 * 1000;
    const sinceTs   = now - dayMs;

    // ── Step 1: Bucket CDRs per account (last 24h) ────────────────────────
    const buckets = new Map<string, AccountBucket>();

    for (const c of cdrCache.values()) {
      const ts = c.startTime
        ? (typeof c.startTime === 'number' ? c.startTime * 1000 : new Date(c.startTime as any).getTime())
        : 0;
      if (!ts || ts < sinceTs) continue;

      const iAccount   = String((c as any).iAccount ?? '');
      if (!iAccount || iAccount === 'unknown') continue;

      const accountName = String((c as any).clientName ?? accountNameCache.get(iAccount) ?? iAccount);
      const isAnswered  = String((c as any).result) === '0' || Number((c as any).result) === 0;
      const duration    = Number((c as any).duration ?? (c as any).totalDuration ?? 0);
      const callee      = String((c as any).callee ?? '').slice(0, 8);

      if (!buckets.has(iAccount)) {
        buckets.set(iAccount, {
          iAccount, accountName,
          totalCalls: 0, answeredCalls: 0, totalDuration: 0,
          destinations: [], shortCalls: 0, fasHits: 0, maxFraudScore: 0,
        });
      }
      const b = buckets.get(iAccount)!;
      b.totalCalls++;
      if (isAnswered) {
        b.answeredCalls++;
        b.totalDuration += duration;
        if (callee) b.destinations.push(callee);
        if (duration < 5) b.shortCalls++;
      }
    }

    if (buckets.size === 0) return;

    // ── Step 2: Fetch recent FAS events and match to accounts ─────────────
    const recentFas = await db
      .select()
      .from(fasEvents)
      .where(gte(fasEvents.detectedAt, new Date(sinceTs)));

    const fasMap = new Map<string, { count: number; maxScore: number }>();
    for (const ev of recentFas) {
      const key = (ev.clientName ?? '').toLowerCase().trim();
      if (!key) continue;
      const cur = fasMap.get(key) ?? { count: 0, maxScore: 0 };
      cur.count++;
      cur.maxScore = Math.max(cur.maxScore, ev.fraudScore ?? 0);
      fasMap.set(key, cur);
    }

    for (const b of buckets.values()) {
      const fas = fasMap.get(b.accountName.toLowerCase().trim());
      if (fas) { b.fasHits = fas.count; b.maxFraudScore = fas.maxScore; }
    }

    // ── Step 3: Score each account ────────────────────────────────────────
    const records: typeof accountState.$inferInsert[] = [];

    for (const b of buckets.values()) {
      if (b.totalCalls === 0) continue;

      const reasons: string[] = [];

      // ── fraudRisk ─────────────────────────────────────────────────────
      let fraudRisk = 0;

      if (b.fasHits > 0) {
        fraudRisk += clamp(b.fasHits * 20, 0, 60);
        reasons.push(`${b.fasHits} FAS event${b.fasHits > 1 ? 's' : ''} in last 24h`);
      }
      if (b.maxFraudScore > 80) {
        fraudRisk += 15;
        reasons.push(`High fraud score (${b.maxFraudScore.toFixed(0)}) on FAS event`);
      }

      const shortRatio = b.answeredCalls > 0 ? b.shortCalls / b.answeredCalls : 0;
      if (shortRatio > 0.30) {
        fraudRisk += 15;
        reasons.push(`Short-call spike: ${(shortRatio * 100).toFixed(0)}% of calls <5s`);
      }

      const uniqueDests  = [...new Set(b.destinations)];
      const destEntropy  = shannonEntropy(b.destinations);
      if (uniqueDests.length > 30 && destEntropy > 4.0) {
        fraudRisk += 20;
        reasons.push(`Abnormal destination diversity (${uniqueDests.length} unique prefixes)`);
      }

      fraudRisk = clamp(fraudRisk);

      // ── qualityScore ──────────────────────────────────────────────────
      let qualityScore = 100;
      const asr = b.totalCalls > 0 ? b.answeredCalls / b.totalCalls : 0;
      const acd = b.answeredCalls > 0 ? b.totalDuration / b.answeredCalls : 0;

      if (asr < 0.30) {
        qualityScore -= 25;
        reasons.push(`Low ASR: ${(asr * 100).toFixed(0)}%`);
      } else if (asr < 0.50) {
        qualityScore -= 10;
        reasons.push(`Below-average ASR: ${(asr * 100).toFixed(0)}%`);
      }
      if (b.answeredCalls >= 5 && acd < 30) {
        qualityScore -= 15;
        reasons.push(`Low average call duration: ${acd.toFixed(0)}s`);
      }
      if (shortRatio > 0.20 && fraudRisk === 0) {
        qualityScore -= 10;
        reasons.push(`Elevated short-call ratio: ${(shortRatio * 100).toFixed(0)}%`);
      }
      qualityScore = clamp(qualityScore);

      // ── anomalyScore ──────────────────────────────────────────────────
      let anomalyScore = 0;
      if (shortRatio > 0.25) anomalyScore += 30;
      if (uniqueDests.length > 20 && destEntropy > 3.5) anomalyScore += 25;
      if (b.totalCalls >= 5 && asr < 0.20) anomalyScore += 35;
      anomalyScore = clamp(anomalyScore);

      // ── healthScore ───────────────────────────────────────────────────
      const healthScore = clamp(
        100 - fraudRisk * 0.35 - anomalyScore * 0.35 - (100 - qualityScore) * 0.30
      );

      // ── derived fields ────────────────────────────────────────────────
      const state = healthScore >= 80 ? 'healthy' : healthScore >= 50 ? 'warning' : 'critical';
      const activeIncidentCount =
        (fraudRisk  > 30 ? 1 : 0) +
        (anomalyScore > 30 ? 1 : 0) +
        (qualityScore < 70 ? 1 : 0);

      records.push({
        accountId:          b.iAccount,
        accountName:        b.accountName,
        healthScore,
        fraudRisk,
        anomalyScore,
        qualityScore,
        balanceTrend:       'stable',
        activeIncidentCount,
        state,
        reasons,
        updatedAt:          new Date(),
      });
    }

    if (records.length === 0) return;

    // ── Step 4: Upsert ───────────────────────────────────────────────────
    for (const r of records) {
      await db.insert(accountState)
        .values(r)
        .onConflictDoUpdate({
          target: accountState.accountId,
          set: {
            accountName:         r.accountName,
            healthScore:         r.healthScore,
            fraudRisk:           r.fraudRisk,
            anomalyScore:        r.anomalyScore,
            qualityScore:        r.qualityScore,
            balanceTrend:        r.balanceTrend,
            activeIncidentCount: r.activeIncidentCount,
            state:               r.state,
            reasons:             r.reasons,
            updatedAt:           r.updatedAt,
          },
        });
    }

    console.log(`[account-state] Upserted ${records.length} account state records`);
  } catch (e: any) {
    console.error('[account-state] Update failed:', e.message);
  }
}
