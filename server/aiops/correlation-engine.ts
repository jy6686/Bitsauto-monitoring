/**
 * Correlation Engine
 *
 * Runs every 5 minutes. Groups recent ai_ops_events (signals) and
 * anomaly_events by shared entity/vendor key within a 30-minute window
 * into ai_ops_incidents (root-cause events).
 *
 * Rules:
 *   - Group key: signal.entity | anomaly.vendor | fallback type
 *   - Upsert: update existing active incident; create new otherwise
 *   - Auto-resolve: incidents with last_seen > 2 hours become 'resolved'
 *
 * Purely deterministic — no ML, no external calls.
 */

import { db } from "../db";
import { aiOpsEvents, anomalyEvents, aiOpsIncidents } from "../../shared/schema";
import { gte, eq, and, lt } from "drizzle-orm";

function groupKey(item: any): string {
  return item.entity || item.vendor || item.type || "unknown";
}

export async function runCorrelationEngine(): Promise<{
  created: number;
  updated: number;
  resolved: number;
}> {
  const windowMs   = 30 * 60 * 1000;
  const since      = new Date(Date.now() - windowMs);
  const now        = new Date();
  let created = 0, updated = 0, resolved = 0;

  // ── Fetch recent events from both planes ──────────────────────────────────
  const [signals, anomalies] = await Promise.all([
    db.select().from(aiOpsEvents).where(gte(aiOpsEvents.createdAt, since)),
    db.select().from(anomalyEvents).where(gte(anomalyEvents.detectedAt, since)),
  ]);

  if (signals.length === 0 && anomalies.length === 0) {
    // Nothing to group — only run auto-resolve
  } else {
    // ── Group into entity buckets ───────────────────────────────────────────
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

    // ── Upsert incidents ────────────────────────────────────────────────────
    for (const [entity, group] of Object.entries(groups)) {
      if (group.signals.length === 0 && group.anomalies.length === 0) continue;

      const severity =
        group.signals.some(s  => s.severity === "high")             ||
        group.anomalies.some(a => a.severity === "critical" || a.severity === "high")
          ? "high" : "medium";

      const title = buildTitle(entity, group);

      const [existing] = await db
        .select({ id: aiOpsIncidents.id })
        .from(aiOpsIncidents)
        .where(and(eq(aiOpsIncidents.entity, entity), eq(aiOpsIncidents.status, "active")))
        .limit(1);

      if (existing) {
        await db
          .update(aiOpsIncidents)
          .set({ lastSeen: now, signalsCount: group.signals.length, anomaliesCount: group.anomalies.length, severity })
          .where(eq(aiOpsIncidents.id, existing.id));
        updated++;
      } else {
        await db.insert(aiOpsIncidents).values({
          title,
          entity,
          severity,
          startTime:      now,
          lastSeen:       now,
          signalsCount:   group.signals.length,
          anomaliesCount: group.anomalies.length,
          status:         "active",
        });
        created++;
      }
    }
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

function buildTitle(entity: string, group: { signals: any[]; anomalies: any[] }): string {
  const parts: string[] = [];
  if (group.signals.some(s => s.type === "ROUTING_FAILURE"))           parts.push("routing failure");
  if (group.signals.some(s => s.type === "EXECUTION_LATENCY_HIGH"))    parts.push("latency spike");
  if (group.signals.some(s => s.type === "VENDOR_DEGRADATION_SIGNAL")) parts.push("vendor degradation");
  if (group.anomalies.some(a => a.metric === "asr"))                   parts.push("ASR drop");
  if (group.anomalies.some(a => a.metric === "cps"))                   parts.push("CPS anomaly");
  if (group.anomalies.some(a => a.metric === "acd"))                   parts.push("ACD deviation");

  const detail = parts.length > 0 ? `: ${parts.join(", ")}` : " degradation";
  return `Incident — ${entity}${detail}`;
}
