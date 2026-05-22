// server/incident-engine.ts
// Unified incident engine: normalizes signals from account_state + fasEvents into incidents table.

import { db } from "./db";
import { incidents, incidentLifecycleEvents, accountState, fasEvents } from "@shared/schema";
import { eq, and, gte, inArray } from "drizzle-orm";

export const INC_TYPES = {
  ACCOUNT_HEALTH:   'ACCOUNT_HEALTH',
  FAS_SPIKE:        'FAS_SPIKE',
  ACCOUNT_EXPOSURE: 'ACCOUNT_EXPOSURE',
} as const;

// ── Lifecycle event logger ─────────────────────────────────────────────────────
async function logLifecycle(
  incidentId: number,
  fromState: string | null,
  toState: string,
  note: string,
): Promise<void> {
  await db.insert(incidentLifecycleEvents).values({
    incidentId,
    fromState,
    toState,
    actor: 'system',
    note,
  }).catch(() => {});
}

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
    const severityChanged = existing.severity !== data.severity;
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
    if (severityChanged) {
      await logLifecycle(existing.id, existing.severity, data.severity, `Severity escalated by ${data.source}`);
    }
    return 'updated';
  }

  const [inserted] = await db.insert(incidents).values({
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
  }).returning({ id: incidents.id }).catch(() => [] as { id: number }[]);

  if (inserted?.id) {
    await logLifecycle(inserted.id, null, 'active', `Opened by ${data.source}`);
  }
  return 'opened';
}

// ── Entity ID normalizer ───────────────────────────────────────────────────────
// Builds a map from lowercased accountName → accountId (Sippy numeric ID).
// Both engines must use the numeric accountId as the canonical entityId so that
// ACCOUNT_HEALTH and FAS_SPIKE incidents for the same physical account share
// the same entityId and can be cross-referenced.
async function buildNameToAccountIdMap(): Promise<Map<string, string>> {
  const rows = await db.select({
    accountId:   accountState.accountId,
    accountName: accountState.accountName,
  }).from(accountState);
  const m = new Map<string, string>();
  for (const r of rows) {
    if (r.accountName) m.set(r.accountName.toLowerCase().trim(), r.accountId);
    // Also map accountId → accountId so numeric keys pass through unchanged
    m.set(r.accountId.toLowerCase().trim(), r.accountId);
  }
  return m;
}

// ── One-time migration: normalize pre-existing FAS_SPIKE entityIds ─────────────
// Historic FAS_SPIKE incidents used clientName (string) as entityId. After this
// migration they will use the canonical numeric accountId where available, so
// auto-resolution and cross-engine correlation work correctly.
async function migrateFasEntityIds(nameToId: Map<string, string>): Promise<void> {
  const activeFas = await db.select().from(incidents).where(
    and(eq(incidents.incidentType, INC_TYPES.FAS_SPIKE), eq(incidents.status, 'active'))
  );
  for (const inc of activeFas) {
    const canonical = nameToId.get((inc.entityId ?? '').toLowerCase().trim());
    if (canonical && canonical !== inc.entityId) {
      await db.update(incidents)
        .set({ entityId: canonical, updatedAt: new Date() })
        .where(eq(incidents.id, inc.id))
        .catch(() => {});
      await logLifecycle(inc.id, inc.entityId, canonical, 'entityId normalized to canonical accountId by migration');
    }
  }
}

// ── Main engine function ──────────────────────────────────────────────────────
export async function runIncidentEngine(): Promise<{ opened: number; updated: number; resolved: number }> {
  let opened   = 0;
  let updated  = 0;
  let resolved = 0;

  try {
    const now    = new Date();
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Build canonical name → accountId lookup (used by FAS engine and migration)
    const nameToId = await buildNameToAccountIdMap();

    // Ensure historic FAS_SPIKE incidents use the canonical entityId
    await migrateFasEntityIds(nameToId);

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
        await logLifecycle(inc.id, 'active', 'resolved', 'Auto-resolved: account health recovered to healthy state');
        resolved++;
      }
    }

    // ── 2. FAS spike incidents ────────────────────────────────────────────────
    const recentFas = await db.select().from(fasEvents).where(gte(fasEvents.detectedAt, dayAgo));

    // Group by clientName, then normalize to canonical accountId
    const fasMap = new Map<string, { count: number; maxScore: number; displayName: string }>();
    for (const ev of recentFas) {
      const rawName = (ev.clientName ?? '').toLowerCase().trim();
      if (!rawName) continue;
      // Resolve to canonical accountId; fall back to raw clientName if not in state table
      const canonicalId = nameToId.get(rawName) ?? rawName;
      const cur = fasMap.get(canonicalId) ?? { count: 0, maxScore: 0, displayName: ev.clientName ?? rawName };
      cur.count++;
      cur.maxScore = Math.max(cur.maxScore, Number((ev as any).fraudScore ?? 0));
      fasMap.set(canonicalId, cur);
    }

    // Track canonical entityIds that are currently active (for auto-resolution)
    const activeFasKeys: string[] = [];
    for (const [canonicalId, stats] of Array.from(fasMap.entries())) {
      if (stats.count < 3) continue;

      activeFasKeys.push(canonicalId);
      const severity   = stats.count >= 10 || stats.maxScore >= 80 ? 'critical'
        : stats.count >= 5 ? 'high' : 'medium';
      const confidence = Math.min(95, 60 + stats.count * 3);

      // Resolve display name: prefer accountName from accountState, else displayName
      const stateRow = allStates.find(s => s.accountId === canonicalId);
      const displayName = stateRow?.accountName ?? stats.displayName;

      const result = await upsertIncident({
        entityType:      'account',
        entityId:        canonicalId,
        entityName:      displayName,
        incidentType:    INC_TYPES.FAS_SPIKE,
        severity,
        confidence,
        title:           `${displayName}: FAS spike — ${stats.count} events in 24h`,
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

    // Auto-resolve FAS incidents whose signal has cleared
    const activeFasIncidents = await db.select().from(incidents).where(
      and(eq(incidents.incidentType, INC_TYPES.FAS_SPIKE), eq(incidents.status, 'active'))
    );
    for (const inc of activeFasIncidents) {
      if (!activeFasKeys.includes(inc.entityId ?? '')) {
        await db.update(incidents)
          .set({ status: 'resolved', resolvedAt: now, updatedAt: now })
          .where(eq(incidents.id, inc.id));
        await logLifecycle(inc.id, 'active', 'resolved', 'Auto-resolved: FAS events dropped below threshold in 24h window');
        resolved++;
      }
    }

    // ── 3. Account exposure incidents ─────────────────────────────────────────
    const exposedAccts      = allStates.filter(a => (a.authExposureScore ?? 0) > 60);
    const safeExposureIds   = allStates.filter(a => (a.authExposureScore ?? 0) <= 50).map(a => a.accountId);

    for (const acct of exposedAccts) {
      const score      = acct.authExposureScore ?? 0;
      const rawSignals = (acct.authExposureSignals as any);
      const signals    = (rawSignals?.signals as string[]) ?? [];
      const severity   = score >= 75 ? 'critical' : score >= 50 ? 'high' : 'medium';
      const confidence = Math.min(95, 60 + Math.round(score / 5));

      const result = await upsertIncident({
        entityType:      'account',
        entityId:        acct.accountId,
        entityName:      acct.accountName ?? acct.accountId,
        incidentType:    INC_TYPES.ACCOUNT_EXPOSURE,
        severity,
        confidence,
        title:           `${acct.accountName ?? acct.accountId}: Auth exposure ${score}/100 — ${acct.exposureRiskLevel ?? 'unknown'} risk`,
        summary:         signals.slice(0, 2).join('. ') || undefined,
        reasons:         signals,
        suggestedAction: score >= 75
          ? 'Immediately restrict IP to /32 and enable CLI authentication to reduce attack surface.'
          : 'Review IP restriction rules and consider enforcing CLI/CLD authentication.',
        source:          'auth_exposure',
      });

      if (result === 'opened') opened++;
      else updated++;
    }

    // Auto-resolve ACCOUNT_EXPOSURE for accounts now safe
    if (safeExposureIds.length > 0) {
      const toResolveExp = await db.select().from(incidents).where(
        and(
          eq(incidents.incidentType, INC_TYPES.ACCOUNT_EXPOSURE),
          eq(incidents.status,       'active'),
          inArray(incidents.entityId, safeExposureIds),
        )
      );
      for (const inc of toResolveExp) {
        await db.update(incidents)
          .set({ status: 'resolved', resolvedAt: now, updatedAt: now })
          .where(eq(incidents.id, inc.id));
        await logLifecycle(inc.id, 'active', 'resolved', 'Auto-resolved: auth exposure score dropped below threshold');
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
