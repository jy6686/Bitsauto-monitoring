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

// ── SIP error code mapping ─────────────────────────────────────────────────────
// Tracked codes: 503, 486, 480, 408, 404, 403 (per task #146 spec)

const SIP_TRACKED = [503, 486, 480, 408, 404, 403] as const;
type SipCode = typeof SIP_TRACKED[number];

function mapResultToSipCode(
  result: string | number | null | undefined,
  q850: string | number | null | undefined,
): SipCode | null {
  const n = typeof result === 'number' ? result : parseInt(String(result ?? ''), 10);
  if (!isNaN(n) && n > 0) {
    if (n === 200) return null; // answered
    if ((SIP_TRACKED as readonly number[]).includes(n)) return n as SipCode;
    if (n === 487 || n === 488 || n === 491) return 480;
    if (n === 410 || n === 414 || n === 484) return 404;
    if (n >= 400 && n < 500) return 403;
    if (n >= 500 && n < 600) return 503;
    if (n >= 600) return 403;
  }
  const q = typeof q850 === 'number' ? q850 : parseInt(String(q850 ?? ''), 10);
  if (!isNaN(q) && q > 0) {
    if (q === 16) return null; // Normal clearing
    const Q850_MAP: Record<number, SipCode> = {
      1:404, 2:404, 3:404, 17:486, 18:408, 19:408, 20:480, 21:403,
      22:404, 27:503, 28:404, 29:403, 31:480, 34:503, 38:503,
      41:503, 42:503, 44:503, 47:503, 50:403, 55:403, 57:403,
      58:503, 65:503, 69:503, 79:503, 87:403, 88:503, 95:503,
      96:503, 97:503, 99:503, 100:503, 101:503, 102:408, 111:503, 127:503,
    };
    return Q850_MAP[q] ?? 480;
  }
  return null;
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
  /** SIP error code counts: code → count of CDRs with that error */
  sipErrors: Map<SipCode, number>;
}

function emptyBucket(): AggBucket {
  return { callCount: 0, answeredCount: 0, totalDurSec: 0, pddSamples: [], totalRevenue: 0, totalVendorCost: 0, vendorCostCdrs: 0, sipErrors: new Map() };
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

        const sipCode = mapResultToSipCode((cdr as any).result, (cdr as any).q850Code);

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
          if (sipCode !== null) {
            bkt.sipErrors.set(sipCode, (bkt.sipErrors.get(sipCode) ?? 0) + 1);
          }
        }
      }

      // Build insert rows
      for (const [vendorId, vb] of vendorBuckets) {
        // Helper: compute SIP error rates from bucket
        const sipRates = (bkt: AggBucket) => {
          const total = bkt.callCount;
          if (total === 0) return { rate503: null, rate486: null, rate480: null, rate408: null, rate404: null, rate403: null };
          const r = (code: SipCode) => {
            const cnt = bkt.sipErrors.get(code);
            return cnt ? Math.round((cnt / total) * 10000) / 100 : null;
          };
          return { rate503: r(503), rate486: r(486), rate480: r(480), rate408: r(408), rate404: r(404), rate403: r(403) };
        };

        // Vendor-level aggregate row (prefix = '__all__')
        const allMetrics = bucketMetrics(vb.all);
        const allRates = sipRates(vb.all);
        rows.push({
          vendorId,
          vendorName: vb.name,
          prefix: "__all__",
          windowHours,
          computedAt,
          callCount: vb.all.callCount,
          answeredCount: vb.all.answeredCount,
          ...allMetrics,
          ...allRates,
          // spike_flags computed after all windows are written (requires history baseline)
          // Will be updated via a separate UPDATE pass below
          spikeFlags: null,
        });

        // Per-prefix rows (limit to top 50 prefixes by call volume per vendor)
        const sortedPrefixes = [...vb.prefixes.entries()]
          .sort((a, b) => b[1].callCount - a[1].callCount)
          .slice(0, 50);

        for (const [prefix, pfxBkt] of sortedPrefixes) {
          if (pfxBkt.callCount < 2) continue; // skip low-volume noise
          const pfxMetrics = bucketMetrics(pfxBkt);
          const pfxRates = sipRates(pfxBkt);
          rows.push({
            vendorId,
            vendorName: vb.name,
            prefix,
            windowHours,
            computedAt,
            callCount: pfxBkt.callCount,
            answeredCount: pfxBkt.answeredCount,
            ...pfxMetrics,
            ...pfxRates,
            spikeFlags: null,
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

    // ── Spike flag computation (UPDATE pass) ───────────────────────────────────
    // For vendor-level rows (__all__), compare current 1h-window SIP rates against
    // 24h rolling average from sip_error_history. Flag codes with current ≥ 2× avg AND ≥ 2%.
    try {
      // Load 24h baseline per vendor per code from sip_error_history (if table exists)
      const baselineRes = await db.execute(sql`
        SELECT vendor_name, code, AVG(rate) AS avg_rate
        FROM sip_error_history
        WHERE snapshot_at > NOW() - INTERVAL '24 hours'
        GROUP BY vendor_name, code
      `).catch(() => ({ rows: [] as any[] }));

      if (baselineRes.rows.length > 0) {
        // Build baseline map
        const baseMap = new Map<string, number>(); // vendorName:code → avg_rate
        for (const r of baselineRes.rows) {
          baseMap.set(`${r.vendor_name}:${r.code}`, parseFloat(r.avg_rate ?? '0'));
        }

        // For each latest 1h-window vendor row, compute spike_flags and update
        const latestRows = rows.filter(r => r.prefix === '__all__' && r.windowHours === 1);
        for (const row of latestRows) {
          const spikeCodes: number[] = [];
          const rateFields: Array<[number, keyof typeof row]> = [
            [503, 'rate503'], [486, 'rate486'], [480, 'rate480'],
            [408, 'rate408'], [404, 'rate404'], [403, 'rate403'],
          ];
          for (const [code, field] of rateFields) {
            const currentRate = (row[field] as number | null) ?? 0;
            const baseline = baseMap.get(`${row.vendorName}:${code}`) ?? 0;
            if (currentRate >= 2 && baseline > 0 && currentRate >= 2 * baseline) {
              spikeCodes.push(code);
            }
          }
          if (spikeCodes.length > 0) {
            await db.execute(sql`
              UPDATE route_quality_snapshots
              SET spike_flags = ${JSON.stringify(spikeCodes)}::jsonb
              WHERE vendor_name = ${row.vendorName}
                AND prefix = '__all__'
                AND window_hours = 1
                AND computed_at = ${computedAt}
            `);
          }
        }
      }
    } catch (spikeErr: any) {
      console.warn("[route-intelligence] spike flag update skipped (non-fatal):", spikeErr.message);
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

// Bulk trend: fetch 24h hourly ASR + call volume for multiple vendors in one call.
// Reuses queryVendorTrend internally (parallel) for maintainability.
export async function queryVendorTrendBulk(
  vendorIds: string[],
): Promise<Record<string, { hour: string; asr: number | null; callCount: number }[]>> {
  if (vendorIds.length === 0) return {};
  const entries = await Promise.all(
    vendorIds.map(async (vid) => ({ vid, trend: await queryVendorTrend(vid) })),
  );
  const out: Record<string, { hour: string; asr: number | null; callCount: number }[]> = {};
  for (const { vid, trend } of entries) {
    out[vid] = trend;
  }
  return out;
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
