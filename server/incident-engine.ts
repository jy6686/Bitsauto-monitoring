// server/incident-engine.ts
// Unified incident engine: normalizes signals from account_state + fasEvents into incidents table.

import { db } from "./db";
import { incidents, accountState, fasEvents } from "@shared/schema";
import { eq, and, gte, inArray } from "drizzle-orm";

export const INC_TYPES = {
  ACCOUNT_HEALTH: 'ACCOUNT_HEALTH',
  FAS_SPIKE:      'FAS_SPIKE',
} as const;

// ── Upsert helper ─────────────────────────────────────────────────────────────
async function upsertIncident(data: {
  entityType:       string;
  entityId:         string;
  entityName?:      string;
  incidentType:     string;
  severity:         string;
  confidence:       number;
  title:            string;
  summary?:         string;
  reasons:          string[];
  suggestedAction?: string;
  source:           string;
}): Promise<'opened' | 'updated'> {
  const now = new Date();

  const [existing] = await db.select().from(incidents).where(
    and(
      eq(incidents.entityType,   data.entityType),
      eq(incidents.entityId,     data.entityId),
      eq(incidents.incidentType, data.incidentType),
      eq(incidents.status,       'active'),
    )
  );

  if (existing) {
    await db.update(incidents)
      .set({
        severity:        data.severity,
        confidence:      data.confidence,
        title:           data.title,
        summary:         data.summary ?? null,
        reasons:         data.reasons,
        suggestedAction: data.suggestedAction ?? null,
        updatedAt:       now,
      })
      .where(eq(incidents.id, existing.id));
    return 'updated';
  }

  await db.insert(incidents).values({
    entityType:      data.entityType,
    entityId:        data.entityId,
    entityName:      data.entityName,
    incidentType:    data.incidentType,
    severity:        data.severity,
    confidence:      data.confidence,
    title:           data.title,
    summary:         data.summary,
    reasons:         data.reasons,
    suggestedAction: data.suggestedAction,
    status:          'active',
    source:          data.source,
    openedAt:        now,
    updatedAt:       now,
  });
  return 'opened';
}

// ── Main engine function ──────────────────────────────────────────────────────
export async function runIncidentEngine(): Promise<{ opened: number; updated: number; resolved: number }> {
  let opened   = 0;
  let updated  = 0;
  let resolved = 0;

  try {
    const now    = new Date();
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // ── 1. Account health incidents ──────────────────────────────────────────
    const allStates = await db.select().from(accountState);

    const nonHealthyIds: string[] = [];

    for (const acct of allStates) {
      if (acct.state === 'healthy') continue;

      nonHealthyIds.push(acct.accountId);

      const severity   = acct.state === 'critical' ? 'critical' : 'medium';
      const reasons    = (acct.reasons as string[]) ?? [];
      const topReasons = reasons.slice(0, 3).join('. ');
      const delta      = acct.scoreDelta24h ?? 0;
      const trendNote  = acct.trendDirection === 'worsening'
        ? ` Trending down (${delta > 0 ? '+' : ''}${delta} pts/24h).`
        : acct.trendDirection === 'improving'
        ? ` Trending up (+${Math.abs(delta)} pts/24h).`
        : '';

      const suggestedAction = acct.fraudRisk > 50
        ? 'Review account traffic for fraud patterns; consider rate-limiting high-risk destinations.'
        : (acct.qualityScore ?? 100) < 60
        ? 'Investigate ASR/ACD degradation; check routing and interconnect quality.'
        : 'Monitor account closely; check for unusual traffic patterns.';

      const confidence = Math.min(95, 70 + Math.round((100 - acct.healthScore) / 4));

      const result = await upsertIncident({
        entityType:      'account',
        entityId:        acct.accountId,
        entityName:      acct.accountName ?? acct.accountId,
        incidentType:    INC_TYPES.ACCOUNT_HEALTH,
        severity,
        confidence,
        title:           `${acct.accountName ?? acct.accountId}: ${acct.state === 'critical' ? 'Critical' : 'Degraded'} health (score ${acct.healthScore}/100)`,
        summary:         topReasons ? `${topReasons}${trendNote}` : undefined,
        reasons,
        suggestedAction,
        source:          'account_state',
      });

      if (result === 'opened') opened++;
      else updated++;
    }

    // Auto-resolve ACCOUNT_HEALTH for accounts now healthy
    const healthyIds = allStates.filter(a => a.state === 'healthy').map(a => a.accountId);
    if (healthyIds.length > 0) {
      const toResolve = await db.select().from(incidents).where(
        and(
          eq(incidents.incidentType, INC_TYPES.ACCOUNT_HEALTH),
          eq(incidents.status,       'active'),
          inArray(incidents.entityId, healthyIds),
        )
      );
      for (const inc of toResolve) {
        await db.update(incidents)
          .set({ status: 'resolved', resolvedAt: now, updatedAt: now })
          .where(eq(incidents.id, inc.id));
        resolved++;
      }
    }

    // ── 2. FAS spike incidents ────────────────────────────────────────────────
    const recentFas = await db.select().from(fasEvents).where(gte(fasEvents.detectedAt, dayAgo));

    const fasMap = new Map<string, { count: number; maxScore: number }>();
    for (const ev of recentFas) {
      const key = (ev.clientName ?? '').toLowerCase().trim();
      if (!key) continue;
      const cur = fasMap.get(key) ?? { count: 0, maxScore: 0 };
      cur.count++;
      cur.maxScore = Math.max(cur.maxScore, Number((ev as any).fraudScore ?? 0));
      fasMap.set(key, cur);
    }

    const activeFasKeys: string[] = [];
    for (const [clientName, stats] of fasMap) {
      if (stats.count < 3) continue;

      activeFasKeys.push(clientName);
      const severity   = stats.count >= 10 || stats.maxScore >= 80 ? 'critical'
        : stats.count >= 5 ? 'high' : 'medium';
      const confidence = Math.min(95, 60 + stats.count * 3);

      const result = await upsertIncident({
        entityType:      'account',
        entityId:        clientName,
        entityName:      clientName,
        incidentType:    INC_TYPES.FAS_SPIKE,
        severity,
        confidence,
        title:           `${clientName}: FAS spike — ${stats.count} events in 24h`,
        summary:         `False Answer Supervision detected ${stats.count} times in the last 24 hours. Peak fraud score: ${stats.maxScore.toFixed(0)}/100.`,
        reasons:         [
          `${stats.count} FAS events in last 24h`,
          `Peak fraud score: ${stats.maxScore.toFixed(0)}/100`,
        ],
        suggestedAction: 'Review account for call padding patterns. Consider temporary rate limiting on suspicious destinations.',
        source:          'fas_engine',
      });

      if (result === 'opened') opened++;
      else updated++;
    }

    // Auto-resolve FAS incidents with no recent events
    const activeFasIncidents = await db.select().from(incidents).where(
      and(eq(incidents.incidentType, INC_TYPES.FAS_SPIKE), eq(incidents.status, 'active'))
    );
    for (const inc of activeFasIncidents) {
      if (!activeFasKeys.includes(inc.entityId ?? '')) {
        await db.update(incidents)
          .set({ status: 'resolved', resolvedAt: now, updatedAt: now })
          .where(eq(incidents.id, inc.id));
        resolved++;
      }
    }

    if (opened + updated + resolved > 0) {
      console.log(`[incident-engine] opened=${opened} updated=${updated} resolved=${resolved}`);
    }
    return { opened, updated, resolved };

  } catch (e: any) {
    console.error('[incident-engine] Error:', e.message);
    return { opened, updated, resolved };
  }
}
