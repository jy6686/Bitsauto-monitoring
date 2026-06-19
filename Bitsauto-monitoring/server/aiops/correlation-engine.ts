/**
 * Correlation Engine
 *
 * Runs every 5 minutes. Two passes:
 *
 * Pass 1 — Entity-based grouping (existing behaviour)
 *   Groups recent ai_ops_events + anomaly_events by shared entity/vendor key
 *   within a 30-minute window into ai_ops_incidents.
 *
 * Pass 2 — Cross-campaign carrier correlation (Phase 3)
 *   Groups SYNTHETIC_FAILURE + ROUTE_DEGRADATION_SIGNAL + HIGH_PDD events by
 *   carrier entity ("carrier:<name>") across ALL campaigns within a 15-minute
 *   window.  Produces a single CARRIER_INCIDENT when ≥2 signals hit the same
 *   carrier, instead of N campaign-level alerts.  Confidence is weighted by
 *   signal count, type diversity, and individual signal confidence.
 *
 * Rules:
 *   - infra_failure classification signals are skipped in Pass 2
 *   - Auto-resolve: incidents with last_seen > 2 hours become 'resolved'
 *   - Purely deterministic — no ML, no external calls.
 */

import { Pool } from "pg";
import { db } from "../db";
import { aiOpsEvents, anomalyEvents, aiOpsIncidents } from "../../shared/schema";
import { gte, eq, and, lt } from "drizzle-orm";

function groupKey(item: any): string {
  // anomalyEvents use `metric` (asr|acd|cps) not `type` — include it before the "unknown" fallback
  return item.entity || item.vendor || item.metric || item.type || "unknown";
}

export async function runCorrelationEngine(): Promise<{
  created: number;
  updated: number;
  resolved: number;
}> {
  const windowMs = 30 * 60 * 1000;
  const since    = new Date(Date.now() - windowMs);
  const now      = new Date();
  let created = 0, updated = 0, resolved = 0;

  // ── Fetch recent events from both planes ──────────────────────────────────
  const [signals, anomalies] = await Promise.all([
    db.select().from(aiOpsEvents).where(gte(aiOpsEvents.createdAt, since)),
    db.select().from(anomalyEvents).where(gte(anomalyEvents.detectedAt, since)),
  ]);

  // ── Pass 1: entity-based grouping (non-carrier entities) ──────────────────
  if (signals.length > 0 || anomalies.length > 0) {
    const groups: Record<string, { signals: any[]; anomalies: any[] }> = {};

    for (const s of signals) {
      const k = groupKey(s);
      if (!groups[k]) groups[k] = { signals: [], anomalies: [] };
      groups[k].signals.push(s);
    }
    for (const a of anomalies) {
      const k = groupKey(a);
      if (!groups[k]) groups[k] = { signals: [], anomalies: [] };
      groups[k].anomalies.push(a);
    }

    for (const [entity, group] of Object.entries(groups)) {
      if (group.signals.length === 0 && group.anomalies.length === 0) continue;

      // Carrier-prefixed entities are handled by Pass 2
      if (entity.startsWith('carrier:')) continue;

      const severity =
        group.signals.some(s  => s.severity === "high") ||
        group.anomalies.some(a => a.severity === "critical" || a.severity === "high")
          ? "high" : "medium";

      const title = _buildTitle(entity, group);

      const [existing] = await db
        .select({ id: aiOpsIncidents.id })
        .from(aiOpsIncidents)
        .where(and(eq(aiOpsIncidents.entity, entity), eq(aiOpsIncidents.status, "active")))
        .limit(1);

      if (existing) {
        await db.update(aiOpsIncidents)
          .set({ title, lastSeen: now, signalsCount: group.signals.length, anomaliesCount: group.anomalies.length, severity })
          .where(eq(aiOpsIncidents.id, existing.id));
        updated++;
      } else {
        await db.insert(aiOpsIncidents).values({
          title, entity, severity,
          startTime: now, lastSeen: now,
          signalsCount:   group.signals.length,
          anomaliesCount: group.anomalies.length,
          status: "active",
        });
        created++;
      }
    }
  }

  // ── Pass 2: cross-campaign carrier correlation ─────────────────────────────
  const carrierWindow  = new Date(Date.now() - 15 * 60 * 1000);
  const carrierSignals = signals.filter(s =>
    typeof s.entity === 'string' &&
    s.entity.startsWith('carrier:') &&
    ['SYNTHETIC_FAILURE', 'ROUTE_DEGRADATION_SIGNAL', 'HIGH_PDD'].includes(s.type) &&
    s.classification !== 'infra_failure'   // exclude infra noise from carrier incidents
  );

  if (carrierSignals.length > 0) {
    const byCarrier: Record<string, any[]> = {};
    for (const s of carrierSignals) {
      const k = s.entity as string;
      if (!byCarrier[k]) byCarrier[k] = [];
      byCarrier[k].push(s);
    }

    for (const [carrierEntity, csigs] of Object.entries(byCarrier)) {
      // Need ≥2 signals on the same carrier before creating a CARRIER_INCIDENT
      if (csigs.length < 2) continue;

      const carrierName    = carrierEntity.replace('carrier:', '');
      const hasFailures    = csigs.some(s => s.type === 'SYNTHETIC_FAILURE');
      const hasDegradation = csigs.some(s => s.type === 'ROUTE_DEGRADATION_SIGNAL');
      const hasHighPdd     = csigs.some(s => s.type === 'HIGH_PDD');

      const parts: string[] = [];
      if (hasFailures)    parts.push('call failures');
      if (hasDegradation) parts.push('route degradation');
      if (hasHighPdd)     parts.push('high PDD');

      const confidence = _carrierIncidentConfidence(csigs);
      const severity   = csigs.some(s => s.severity === 'high') ? 'high' : 'medium';
      const title      = `Carrier Incident — ${carrierName}: ${parts.join(', ')} (confidence: ${(confidence * 100).toFixed(0)}%)`;

      const [existing] = await db
        .select({ id: aiOpsIncidents.id })
        .from(aiOpsIncidents)
        .where(and(eq(aiOpsIncidents.entity, carrierEntity), eq(aiOpsIncidents.status, 'active')))
        .limit(1);

      if (existing) {
        await db.update(aiOpsIncidents)
          .set({ lastSeen: now, signalsCount: csigs.length, severity, title })
          .where(eq(aiOpsIncidents.id, existing.id));
        updated++;
      } else {
        await db.insert(aiOpsIncidents).values({
          title, entity: carrierEntity, severity,
          startTime: now, lastSeen: now,
          signalsCount: csigs.length, anomaliesCount: 0,
          status: 'active',
        });
        created++;
        console.log(`[correlation] CARRIER_INCIDENT created for "${carrierName}" — ${csigs.length} signals, confidence: ${confidence.toFixed(2)}`);
      }
    }
  }

  // ── Pass 3: ledger mutation cluster detection ──────────────────────────────
  // Scans action_ledger for entities that received ≥2 distinct action threads
  // (ledger_ids) within a 30-minute window. Creates/updates LEDGER_MUTATION_CLUSTER
  // incidents so operators see when an entity is undergoing rapid concurrent
  // mutation — a strong signal for either coordinated remediation or instability.
  try {
    const ledgerPool     = new Pool({ connectionString: process.env.DATABASE_URL });
    const ledgerWindow   = new Date(Date.now() - 30 * 60 * 1000);
    const ledgerResult   = await ledgerPool.query(
      `SELECT ledger_id, entity_id, entity_name, source_system
       FROM action_ledger
       WHERE created_at >= $1 AND entity_id IS NOT NULL`,
      [ledgerWindow.toISOString()],
    );
    await ledgerPool.end();

    // Group by entity_id → count distinct ledger_ids and source systems
    const byEntity = new Map<string, { ledgerIds: Set<string>; systems: Set<string>; entityName: string }>();
    for (const row of ledgerResult.rows) {
      const k = row.entity_id as string;
      if (!byEntity.has(k)) byEntity.set(k, { ledgerIds: new Set(), systems: new Set(), entityName: row.entity_name ?? k });
      const e = byEntity.get(k)!;
      e.ledgerIds.add(row.ledger_id as string);
      e.systems.add(row.source_system as string);
    }

    for (const [entityId, data] of byEntity.entries()) {
      // Only raise when ≥2 distinct action threads touched the same entity
      if (data.ledgerIds.size < 2) continue;

      const systemStr  = [...data.systems].join('+');
      const severity   = data.ledgerIds.size >= 5 ? 'high' : 'medium';
      const entityKey  = `ledger:${entityId}`;
      const title      = `Mutation cluster — ${data.entityName}: ${data.ledgerIds.size} action threads in 30 min (${systemStr})`;

      const [existing] = await db
        .select({ id: aiOpsIncidents.id })
        .from(aiOpsIncidents)
        .where(and(eq(aiOpsIncidents.entity, entityKey), eq(aiOpsIncidents.status, 'active')))
        .limit(1);

      if (existing) {
        await db.update(aiOpsIncidents)
          .set({ lastSeen: now, signalsCount: data.ledgerIds.size, severity, title })
          .where(eq(aiOpsIncidents.id, existing.id));
        updated++;
      } else {
        await db.insert(aiOpsIncidents).values({
          title, entity: entityKey, severity,
          startTime: now, lastSeen: now,
          signalsCount: data.ledgerIds.size, anomaliesCount: 0,
          status: 'active',
        });
        created++;
        console.log(`[correlation] LEDGER_CLUSTER for "${data.entityName}" — ${data.ledgerIds.size} threads (${systemStr})`);
      }
    }

    // Auto-resolve stale LEDGER_MUTATION_CLUSTER incidents when the entity is
    // no longer receiving concurrent mutations
    const activeClusterIncidents = await db
      .select({ id: aiOpsIncidents.id, entity: aiOpsIncidents.entity })
      .from(aiOpsIncidents)
      .where(and(
        eq(aiOpsIncidents.status, 'active'),
        // entity key uses "ledger:" prefix
        // Use raw SQL prefix match instead of ORM contains
      ))
      .limit(100);
    for (const inc of activeClusterIncidents) {
      if (!inc.entity?.startsWith('ledger:')) continue;
      const eid = inc.entity.replace('ledger:', '');
      if (!byEntity.has(eid) || (byEntity.get(eid)!.ledgerIds.size < 2)) {
        await db.update(aiOpsIncidents)
          .set({ status: 'resolved', lastSeen: now })
          .where(eq(aiOpsIncidents.id, inc.id));
        resolved++;
      }
    }
  } catch (ledgerErr: any) {
    // Pass 3 is non-critical — never fail the whole engine on ledger issues
    console.warn('[correlation] Pass 3 ledger scan error (non-fatal):', ledgerErr.message);
  }

  // ── Auto-resolve stale incidents (no new events in 2 hours) ───────────────
  const staleThreshold = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const staleCount = await db
    .update(aiOpsIncidents)
    .set({ status: "resolved" })
    .where(and(eq(aiOpsIncidents.status, "active"), lt(aiOpsIncidents.lastSeen, staleThreshold)));
  resolved = (staleCount as any)?.rowCount ?? 0;

  return { created, updated, resolved };
}

// ── Confidence model for carrier incidents ─────────────────────────────────
function _carrierIncidentConfidence(signals: any[]): number {
  let c = 0.35;
  const types = new Set(signals.map((s: any) => s.type));
  if (types.size >= 2) c += 0.20;           // multi-type evidence
  if (signals.length >= 5)      c += 0.20;
  else if (signals.length >= 3) c += 0.10;
  const maxSigConf = Math.max(...signals.map((s: any) => s.confidence ?? 0));
  c += maxSigConf * 0.25;                    // inherit upstream confidence
  return Math.min(0.95, c);
}

// ── Entity label — converts raw group key to human-readable prefix ─────────
export function resolveEntityLabel(entity: string | null | undefined): string {
  if (!entity || entity === "unknown") return "Platform";
  if (entity.startsWith("carrier:"))  return `Carrier: ${entity.replace("carrier:", "")}`;
  if (entity.startsWith("ledger:"))   return `Account: ${entity.replace("ledger:", "")}`;
  // Metric-based anomaly-only incidents (asr / acd / cps from anomalyEvents.metric)
  if (entity === "asr") return "ASR Monitoring";
  if (entity === "acd") return "ACD Monitoring";
  if (entity === "cps") return "CPS Monitoring";
  if (entity === "mos") return "MOS Monitoring";
  // Raw signal-type keys that leaked through before the groupKey fix
  if (entity === "ROUTING_FAILURE" || entity === "EXECUTION_LATENCY_HIGH") return "Platform";
  if (entity === "VENDOR_DEGRADATION_SIGNAL" || entity === "SYNTHETIC_TEST_ASR_DROP") return "Platform";
  if (entity === "PLATFORM" || entity === "platform") return "Platform";
  // Everything else is treated as a vendor / account name
  return `Vendor: ${entity}`;
}

// ── Title builder ──────────────────────────────────────────────────────────
function _buildTitle(entity: string, group: { signals: any[]; anomalies: any[] }): string {
  const parts: string[] = [];
  if (group.signals.some(s  => s.type === "ROUTING_FAILURE"))           parts.push("routing failure");
  if (group.signals.some(s  => s.type === "EXECUTION_LATENCY_HIGH"))    parts.push("latency spike");
  if (group.signals.some(s  => s.type === "VENDOR_DEGRADATION_SIGNAL")) parts.push("vendor degradation");
  if (group.signals.some(s  => s.type === "SYNTHETIC_TEST_ASR_DROP"))   parts.push("ASR drop");
  if (group.signals.some(s  => s.type === "HIGH_PDD"))                  parts.push("high PDD");
  if (group.anomalies.some(a => a.metric === "asr"))                    parts.push("ASR anomaly");
  if (group.anomalies.some(a => a.metric === "cps"))                    parts.push("CPS spike");
  if (group.anomalies.some(a => a.metric === "acd"))                    parts.push("ACD deviation");
  if (group.anomalies.some(a => a.metric === "mos"))                    parts.push("MOS degradation");
  const detail       = parts.length > 0 ? parts.join(", ") : "degradation";
  const entityLabel  = resolveEntityLabel(entity);
  return `${entityLabel} — ${detail}`;
}
