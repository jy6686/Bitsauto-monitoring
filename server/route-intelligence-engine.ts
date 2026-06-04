/**
 * Route Intelligence Engine
 *
 * Background job that runs every 15 minutes, reads the in-memory CDR cache,
 * and produces per-vendor + per-prefix quality snapshots (ASR, ACD, PDD,
 * call count, cost) for 1h / 4h / 24h rolling windows.
 *
 * Snapshots are persisted to `route_quality_snapshots` so the AI Copilot
 * and Route Intelligence UI can query pre-computed signals without
 * re-processing the entire CDR cache on demand.
 */

import { db } from "./db";
import { routeQualitySnapshots, nocIncidents } from "../shared/schema";
import { sql, and, eq, isNull } from "drizzle-orm";
import { isAnswered, cdrTs } from "./analytics-engine";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CdrLike {
  startTime?: string | null;
  connectTime?: string | null;
  result?: string | number | null;
  duration?: string | number | null;
  pdd1xx?: string | number | null;
  pdd?: string | number | null;
  /** CDR cost field = customer-charged amount (revenue) per Sippy convention */
  cost?: string | number | null;
  /** vendorCost = what we pay the vendor; set by Mera CDR enrichment (may be missing) */
  vendorCost?: string | number | null;
  vendor?: string | null;
  iConnection?: string | number | null;
  callee?: string | null;
  i_callee?: string | null;
}

export interface VendorSummaryRow {
  vendorId: string;
  vendorName: string;
  windowHours: number;
  callCount: number;
  answeredCount: number;
  asr: number | null;
  acdSeconds: number | null;
  pddMs: number | null;
  totalCostUsd: number | null;
  revenueUsd: number | null;
  marginUsd: number | null;
  computedAt: string;
}

export interface PrefixRow {
  prefix: string;
  callCount: number;
  answeredCount: number;
  asr: number | null;
  acdSeconds: number | null;
  pddMs: number | null;
  totalCostUsd: number | null;
  revenueUsd: number | null;
  marginUsd: number | null;
}

// ── State ─────────────────────────────────────────────────────────────────────

let _lastRunAt: Date | null = null;
let _running = false;

export function getRouteIntelligenceLastRun(): Date | null {
  return _lastRunAt;
}

// ── Prefix extraction ─────────────────────────────────────────────────────────

function extractPrefix(callee: string | null | undefined): string {
  if (!callee) return "unknown";
  const digits = callee.replace(/\D/g, "");
  if (!digits) return "unknown";
  // Use 4-digit prefix for E.164 numbers (covers most country+area combinations)
  if (digits.startsWith("0")) return digits.slice(0, 3);
  if (digits.length >= 11) return digits.slice(0, 4);
  if (digits.length >= 8)  return digits.slice(0, 3);
  return digits.slice(0, 2) || "unknown";
}

// ── Aggregation ───────────────────────────────────────────────────────────────

interface AggBucket {
  callCount: number;
  answeredCount: number;
  totalDurSec: number;
  pddSamples: number[];
  /** totalRevenue: sum of CDR cost field (customer-charged amount / revenue) */
  totalRevenue: number;
  /** totalVendorCost: sum of vendorCost field from Mera enrichment (what we pay) */
  totalVendorCost: number;
  /** vendorCostCdrs: number of CDRs with a Mera-enriched vendorCost (for margin confidence) */
  vendorCostCdrs: number;
}

function emptyBucket(): AggBucket {
  return { callCount: 0, answeredCount: 0, totalDurSec: 0, pddSamples: [], totalRevenue: 0, totalVendorCost: 0, vendorCostCdrs: 0 };
}

function bucketMetrics(b: AggBucket): {
  asr: number | null;
  acdSeconds: number | null;
  pddMs: number | null;
  totalCostUsd: number | null;
  revenueUsd: number | null;
  marginUsd: number | null;
} {
  const asr = b.callCount > 0 ? parseFloat((b.answeredCount / b.callCount * 100).toFixed(2)) : null;
  const acdSeconds = b.answeredCount > 0 ? parseFloat((b.totalDurSec / b.answeredCount).toFixed(1)) : null;
  const pddMs = b.pddSamples.length > 0
    ? parseFloat((b.pddSamples.reduce((a, v) => a + v, 0) / b.pddSamples.length).toFixed(0))
    : null;
  // Vendor cost (what we pay): use Mera-enriched vendorCost when ≥10% CDRs have it
  const totalCostUsd = b.vendorCostCdrs > 0 && b.vendorCostCdrs >= Math.ceil(b.callCount * 0.1)
    ? parseFloat(b.totalVendorCost.toFixed(4))
    : null;
  // Revenue (what we charge): CDR cost field
  const revenueUsd = b.totalRevenue > 0 ? parseFloat(b.totalRevenue.toFixed(4)) : null;
  // Margin = revenue - vendor cost (only when both are available)
  const marginUsd = revenueUsd != null && totalCostUsd != null
    ? parseFloat((revenueUsd - totalCostUsd).toFixed(4))
    : null;
  return { asr, acdSeconds, pddMs, totalCostUsd, revenueUsd, marginUsd };
}

// ── Main aggregation function ─────────────────────────────────────────────────

export async function runRouteIntelligenceAggregation(
  cdrValues: CdrLike[],
): Promise<void> {
  if (_running) {
    console.log("[route-intelligence] aggregation skipped — already running");
    return;
  }
  _running = true;
  const t0 = Date.now();

  try {
    const WINDOWS = [1, 4, 24] as const;
    const now = Date.now();

    const rows: (typeof routeQualitySnapshots.$inferInsert)[] = [];
    const computedAt = new Date();

    for (const windowHours of WINDOWS) {
      const cutoff = now - windowHours * 3600 * 1000;

      // Filter CDRs within this window
      const windowCdrs = cdrValues.filter(c => cdrTs(c as any) >= cutoff);

      if (windowCdrs.length === 0) continue;

      // Group by vendorId → prefix → bucket
      // vendorId key = iConnection string or vendor name
      const vendorBuckets = new Map<string, { name: string; all: AggBucket; prefixes: Map<string, AggBucket> }>();

      for (const cdr of windowCdrs) {
        const vendorId = String(cdr.iConnection ?? cdr.vendor ?? "unknown");
        const vendorName = String(cdr.vendor ?? cdr.iConnection ?? "Unknown");
        const calleeRaw = String(cdr.callee ?? (cdr as any).i_callee ?? "");
        const prefix = extractPrefix(calleeRaw);

        if (!vendorBuckets.has(vendorId)) {
          vendorBuckets.set(vendorId, { name: vendorName, all: emptyBucket(), prefixes: new Map() });
        }
        const vb = vendorBuckets.get(vendorId)!;
        if (!vb.prefixes.has(prefix)) vb.prefixes.set(prefix, emptyBucket());

        const allBkt = vb.all;
        const pfxBkt = vb.prefixes.get(prefix)!;

        const answered = isAnswered(cdr as any);
        const dur = Number(cdr.duration) || 0;
        const pddRaw = Number(cdr.pdd1xx ?? cdr.pdd) || 0;
        // revenue = what we charge the customer (CDR cost field per Sippy convention)
        const revenue = Number(cdr.cost) || 0;
        // vendorCost = what we pay the vendor (set by Mera enrichment, may be undefined)
        const vendorCostRaw = cdr.vendorCost !== undefined && cdr.vendorCost !== null
          ? Number(cdr.vendorCost) : null;

        for (const bkt of [allBkt, pfxBkt]) {
          bkt.callCount++;
          if (answered) {
            bkt.answeredCount++;
            bkt.totalDurSec += dur;
          }
          if (pddRaw > 0) bkt.pddSamples.push(pddRaw * 1000); // convert seconds → ms
          if (revenue > 0) bkt.totalRevenue += revenue;
          if (vendorCostRaw !== null) {
            bkt.totalVendorCost += vendorCostRaw;
            bkt.vendorCostCdrs++;
          }
        }
      }

      // Build insert rows
      for (const [vendorId, vb] of vendorBuckets) {
        // Vendor-level aggregate row (prefix = '__all__')
        const allMetrics = bucketMetrics(vb.all);
        rows.push({
          vendorId,
          vendorName: vb.name,
          prefix: "__all__",
          windowHours,
          computedAt,
          callCount: vb.all.callCount,
          answeredCount: vb.all.answeredCount,
          ...allMetrics,
        });

        // Per-prefix rows (limit to top 50 prefixes by call volume per vendor)
        const sortedPrefixes = [...vb.prefixes.entries()]
          .sort((a, b) => b[1].callCount - a[1].callCount)
          .slice(0, 50);

        for (const [prefix, pfxBkt] of sortedPrefixes) {
          if (pfxBkt.callCount < 2) continue; // skip low-volume noise
          const pfxMetrics = bucketMetrics(pfxBkt);
          rows.push({
            vendorId,
            vendorName: vb.name,
            prefix,
            windowHours,
            computedAt,
            callCount: pfxBkt.callCount,
            answeredCount: pfxBkt.answeredCount,
            ...pfxMetrics,
          });
        }
      }
    }

    if (rows.length === 0) {
      console.log("[route-intelligence] no CDR data — snapshots not written");
      _lastRunAt = new Date();
      return;
    }

    // Purge old snapshots older than 25h to keep the table trim
    await db.execute(
      sql`DELETE FROM route_quality_snapshots WHERE computed_at < NOW() - INTERVAL '25 hours'`
    );

    // Batch-insert in chunks of 500
    const CHUNK = 500;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      await db.insert(routeQualitySnapshots).values(chunk);
      inserted += chunk.length;
    }

    _lastRunAt = new Date();
    console.log(`[route-intelligence] snapshot complete: ${inserted} rows in ${Date.now() - t0}ms (${cdrValues.length} CDRs)`);

    // ── Anomaly detection: open NOC incidents for degraded vendors ─────────────
    await detectCdrSnapshotAnomalies(rows, computedAt);
  } catch (err: any) {
    console.error("[route-intelligence] aggregation error:", err.message);
  } finally {
    _running = false;
  }
}

// ── CDR snapshot anomaly detection ────────────────────────────────────────────
// Thresholds
const ASR_DROP_THRESHOLD_PP  = 15;  // percentage-points drop vs previous slot
const PDD_SPIKE_THRESHOLD_MS = 4000; // ms

async function detectCdrSnapshotAnomalies(
  newRows: (typeof routeQualitySnapshots.$inferInsert)[],
  computedAt: Date,
): Promise<void> {
  try {
    // Work only with the 1-hour window vendor-level rows for anomaly comparison
    const newVendorRows = newRows.filter(r => r.prefix === "__all__" && r.windowHours === 1);
    if (newVendorRows.length === 0) return;

    // Fetch the most recent previous snapshot for each vendor (before this run)
    const prevResult = await db.execute(sql`
      SELECT DISTINCT ON (vendor_id)
        vendor_id, asr, pdd_ms, computed_at
      FROM route_quality_snapshots
      WHERE prefix = '__all__'
        AND window_hours = 1
        AND computed_at < ${computedAt}
      ORDER BY vendor_id, computed_at DESC
    `);
    const prevByVendor = new Map<string, { asr: number | null; pddMs: number | null }>();
    for (const row of prevResult.rows as any[]) {
      prevByVendor.set(String(row.vendor_id), {
        asr:   row.asr   != null ? Number(row.asr)   : null,
        pddMs: row.pdd_ms != null ? Number(row.pdd_ms) : null,
      });
    }

    const now = new Date();

    for (const snap of newVendorRows) {
      const vendorId   = String(snap.vendorId ?? "");
      const vendorName = String(snap.vendorName ?? snap.vendorId ?? "Unknown");
      const newAsr     = snap.asr   != null ? Number(snap.asr)   : null;
      const newPdd     = snap.pddMs != null ? Number(snap.pddMs) : null;
      const prev       = prevByVendor.get(vendorId);

      const reasons: string[] = [];
      let asrDrop: number | null = null;

      // ASR degradation
      if (newAsr !== null && prev?.asr != null) {
        asrDrop = prev.asr - newAsr;
        if (asrDrop > ASR_DROP_THRESHOLD_PP) {
          reasons.push(`ASR dropped ${asrDrop.toFixed(1)}pp (${prev.asr.toFixed(1)}% → ${newAsr.toFixed(1)}%)`);
        }
      }

      // PDD spike
      if (newPdd !== null && newPdd > PDD_SPIKE_THRESHOLD_MS) {
        reasons.push(`PDD spiked to ${Math.round(newPdd)}ms (threshold: ${PDD_SPIKE_THRESHOLD_MS}ms)`);
      }

      if (reasons.length === 0) continue;

      // De-duplicate: skip if an open incident already exists for this vendor+type
      const entityId = `cdr-anomaly-${vendorId}`;
      const existing = await db.select({ id: nocIncidents.id })
        .from(nocIncidents)
        .where(
          and(
            eq(nocIncidents.entityId, entityId),
            eq(nocIncidents.type, "cdr_anomaly"),
            isNull(nocIncidents.resolvedAt),
          )
        )
        .limit(1);

      if (existing.length > 0) {
        console.log(`[route-intelligence] anomaly for ${vendorName} already has open incident — skipping`);
        continue;
      }

      const description = `Automated CDR snapshot analysis detected quality degradation on vendor ${vendorName}: ${reasons.join("; ")}.`;
      const suggestedAction = `Review live calls and routing for vendor ${vendorName}. Consider activating a backup route or deprioritising this carrier until quality recovers.`;

      await db.insert(nocIncidents).values({
        title:           `CDR Anomaly — ${vendorName}: ${reasons.join("; ")}`,
        type:            "cdr_anomaly",
        severity:        "high",
        status:          "open",
        entityType:      "vendor",
        entityId,
        entityName:      vendorName,
        description,
        suggestedAction,
        source:          "cdr_snapshot_engine",
        tags:            ["cdr", "auto-detected", "vendor-quality", ...reasons.map(r => r.split(" ")[0].toLowerCase())],
        assigneeName:    "on-call",
        openedAt:        now,
        updatedAt:       now,
      });

      console.log(`[route-intelligence] NOC incident created for ${vendorName}: ${reasons.join("; ")}`);
    }
  } catch (err: any) {
    console.error("[route-intelligence] anomaly detection error:", err.message);
  }
}

// ── Query helpers (used by API routes) ────────────────────────────────────────

export async function queryVendorSummary(windowHours: number): Promise<VendorSummaryRow[]> {
  // Get the latest snapshot per vendor for the requested window
  const result = await db.execute(sql`
    SELECT DISTINCT ON (vendor_id)
      vendor_id, vendor_name, window_hours,
      call_count, answered_count,
      asr, acd_seconds, pdd_ms, total_cost_usd,
      revenue_usd, margin_usd,
      computed_at
    FROM route_quality_snapshots
    WHERE prefix = '__all__'
      AND window_hours = ${windowHours}
    ORDER BY vendor_id, computed_at DESC
  `);

  return (result.rows as any[]).map(r => ({
    vendorId:     r.vendor_id,
    vendorName:   r.vendor_name,
    windowHours:  r.window_hours,
    callCount:    r.call_count ?? 0,
    answeredCount: r.answered_count ?? 0,
    asr:          r.asr != null ? Number(r.asr) : null,
    acdSeconds:   r.acd_seconds != null ? Number(r.acd_seconds) : null,
    pddMs:        r.pdd_ms != null ? Number(r.pdd_ms) : null,
    totalCostUsd: r.total_cost_usd != null ? Number(r.total_cost_usd) : null,
    revenueUsd:   r.revenue_usd != null ? Number(r.revenue_usd) : null,
    marginUsd:    r.margin_usd != null ? Number(r.margin_usd) : null,
    computedAt:   r.computed_at instanceof Date ? r.computed_at.toISOString() : String(r.computed_at),
  }));
}

export async function queryVendorPrefixes(vendorId: string, windowHours: number): Promise<PrefixRow[]> {
  const result = await db.execute(sql`
    SELECT DISTINCT ON (prefix)
      prefix, call_count, answered_count,
      asr, acd_seconds, pdd_ms, total_cost_usd,
      revenue_usd, margin_usd
    FROM route_quality_snapshots
    WHERE vendor_id = ${vendorId}
      AND prefix != '__all__'
      AND window_hours = ${windowHours}
    ORDER BY prefix, computed_at DESC
  `);

  return (result.rows as any[])
    .map(r => ({
      prefix:        r.prefix,
      callCount:     r.call_count ?? 0,
      answeredCount: r.answered_count ?? 0,
      asr:           r.asr != null ? Number(r.asr) : null,
      acdSeconds:    r.acd_seconds != null ? Number(r.acd_seconds) : null,
      pddMs:         r.pdd_ms != null ? Number(r.pdd_ms) : null,
      totalCostUsd:  r.total_cost_usd != null ? Number(r.total_cost_usd) : null,
      revenueUsd:    r.revenue_usd != null ? Number(r.revenue_usd) : null,
      marginUsd:     r.margin_usd != null ? Number(r.margin_usd) : null,
    }))
    .sort((a, b) => b.callCount - a.callCount);
}

// Trend sparkline: hourly ASR + call volume for the vendor over last 24h (max 24 data points).
// Uses window_hours = 1 snapshots exclusively so each point covers exactly one hour.
export async function queryVendorTrend(vendorId: string): Promise<{ hour: string; asr: number | null; callCount: number }[]> {
  // Each hour bucket may contain multiple overlapping window_hours=1 snapshots
  // (the engine runs every ~15 min). We pick the most-recent snapshot per
  // calendar-hour slot so call_count and asr reflect one canonical measurement,
  // not a sum/average of several overlapping windows.
  const result = await db.execute(sql`
    SELECT DISTINCT ON (date_trunc('hour', computed_at))
      date_trunc('hour', computed_at) AS hour,
      asr,
      call_count
    FROM route_quality_snapshots
    WHERE vendor_id = ${vendorId}
      AND prefix = '__all__'
      AND window_hours = 1
      AND computed_at > NOW() - INTERVAL '24 hours'
    ORDER BY date_trunc('hour', computed_at) ASC, computed_at DESC
    LIMIT 24
  `);

  return (result.rows as any[]).map(r => ({
    hour:      r.hour instanceof Date ? r.hour.toISOString() : String(r.hour),
    asr:       r.asr != null ? parseFloat(Number(r.asr).toFixed(1)) : null,
    callCount: r.call_count != null ? parseInt(String(r.call_count), 10) : 0,
  }));
}

// For AI Copilot: get latest 4h vendor summary as enrichment signal
export async function getCopilotVendorSignals(): Promise<Map<string, { asr: number | null; acdSeconds: number | null; callCount: number }>> {
  const rows = await queryVendorSummary(4);
  const out = new Map<string, { asr: number | null; acdSeconds: number | null; callCount: number }>();
  for (const r of rows) {
    out.set(r.vendorName, { asr: r.asr, acdSeconds: r.acdSeconds, callCount: r.callCount });
  }
  return out;
}
