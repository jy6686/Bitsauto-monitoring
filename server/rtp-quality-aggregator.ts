/**
 * RTP / MOS Quality Aggregation Engine
 *
 * Runs every 5 minutes. Reads CDRs from the in-memory CDR cache (via a
 * provider function registered by routes.ts after cache warmup), groups by
 * vendor AND by 3-digit destination prefix, and upserts per-vendor-prefix
 * MOS / jitter / packet-loss averages into rtp_quality_stats for three
 * windows: 60 min (1h), 240 min (4h), 1440 min (24h).
 *
 * MOS extraction priority:
 *   1. cdr.i_vq_term_mos  — termination-leg VQ MOS reported by Sippy
 *   2. cdr.i_vq_orig_mos  — origination-leg VQ MOS
 *   3. No value if neither field is present / populated
 *
 * Jitter / packet-loss fields: cdr.jitter (ms), cdr.pkt_loss (%).
 * These are only populated on Sippy builds that have VQ reporting enabled.
 * The aggregator handles absent data gracefully (no-op for that metric).
 *
 * destination_prefix: 3-digit dial prefix extracted from the CDR's called
 * number (cld). The vendor-level row uses prefix = NULL. Each unique
 * 3-digit prefix gets its own row alongside the vendor-level aggregate.
 */

import { db, pool } from './db';
import { rtpQualityStats } from '../shared/schema';

// ── CDR provider ──────────────────────────────────────────────────────────────
// routes.ts registers this after CDR cache warmup (same pattern as carrier-scoring-engine).

export type RtpCdrRecord = {
  vendor?: string;
  vendorName?: string;
  connect_time?: string | number | null;
  connectTime?: string | number | null;
  i_vq_term_mos?: number | null;
  i_vq_orig_mos?: number | null;
  jitter?: number | null;
  pkt_loss?: number | null;
  /** Network latency in milliseconds (Sippy `delay` field — total one-way path delay) */
  delay?: number | null;
  /** Called number / destination — used to extract destination prefix */
  cld?: string | null;
  calledNumber?: string | null;
  [key: string]: any;
};

type RtpCdrProviderFn = (cutoffMs: number) => RtpCdrRecord[];

let _rtpCdrProvider: RtpCdrProviderFn | null = null;

export function setRtpCdrProvider(fn: RtpCdrProviderFn): void {
  _rtpCdrProvider = fn;
}

// ── Timer ─────────────────────────────────────────────────────────────────────
let _timer: ReturnType<typeof setInterval> | null = null;

export function initRtpQualityAggregator(): void {
  if (_timer) clearInterval(_timer);
  _timer = setInterval(_run, 5 * 60_000);
  // First run at T+120s to let the CDR cache warm up first
  setTimeout(_run, 120_000);
  console.log('[rtp-quality] Aggregator started — running every 5 min (first run at T+120s)');
}

export async function runRtpQualityAggregation(): Promise<void> {
  await _run();
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function parseCdrTs(cdr: RtpCdrRecord): number {
  const raw = cdr.connect_time ?? cdr.connectTime;
  if (!raw) return 0;
  if (typeof raw === 'number') return raw;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

function extractMos(cdr: RtpCdrRecord): number | null {
  const term = cdr.i_vq_term_mos;
  const orig = cdr.i_vq_orig_mos;
  if (term != null && term > 0 && term <= 5) return term;
  if (orig != null && orig > 0 && orig <= 5) return orig;
  return null;
}

/**
 * Extract a 3-digit destination prefix from the called number.
 * Returns null if the number can't be parsed or has fewer than 3 digits.
 */
function extractDestPrefix(cdr: RtpCdrRecord): string | null {
  const raw = (cdr.cld ?? cdr.calledNumber ?? '').replace(/\D/g, '');
  if (raw.length < 3) return null;
  // Skip leading zeros (local numbers); take first 3 digits of E.164
  return raw.slice(0, 3);
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.floor((p / 100) * (sorted.length - 1));
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

interface WindowAccumulator {
  mosValues: number[];
  jitterValues: number[];
  pktLossValues: number[];
  latencyValues: number[];
  sampleCount: number;
}

async function aggregateWindow(cdrs: RtpCdrRecord[], windowMinutes: number): Promise<void> {
  const cutoffMs = Date.now() - windowMinutes * 60_000;
  const windowCdrs = cdrs.filter(c => parseCdrTs(c) >= cutoffMs);

  if (windowCdrs.length === 0) {
    // No CDRs in this window — purge all rows for this window so the UI shows empty.
    const client = await pool.connect();
    try {
      await client.query(`DELETE FROM rtp_quality_stats WHERE window_minutes = $1`, [windowMinutes]);
    } finally {
      client.release();
    }
    return;
  }
  // Snapshot the time BEFORE upserting so we can purge rows not touched in this run.
  const runStart = new Date();

  // Group by composite key: "vendorId\x00destPrefix" (NULL prefix → empty string)
  const byKey = new Map<string, WindowAccumulator>();
  const keyMeta = new Map<string, { vendorId: string; prefix: string | null }>();

  for (const cdr of windowCdrs) {
    const vendor = (cdr.vendorName ?? cdr.vendor ?? '').trim();
    if (!vendor) continue;
    const prefix = extractDestPrefix(cdr);

    // Vendor-level aggregate (prefix = NULL)
    const vendorKey = `${vendor}\x00`;
    if (!byKey.has(vendorKey)) {
      byKey.set(vendorKey, { mosValues: [], jitterValues: [], pktLossValues: [], latencyValues: [], sampleCount: 0 });
      keyMeta.set(vendorKey, { vendorId: vendor, prefix: null });
    }

    // Prefix-level aggregate
    if (prefix !== null) {
      const prefixKey = `${vendor}\x00${prefix}`;
      if (!byKey.has(prefixKey)) {
        byKey.set(prefixKey, { mosValues: [], jitterValues: [], pktLossValues: [], latencyValues: [], sampleCount: 0 });
        keyMeta.set(prefixKey, { vendorId: vendor, prefix });
      }
    }

    const mos = extractMos(cdr);

    // Accumulate into vendor-level bucket
    const vw = byKey.get(vendorKey)!;
    vw.sampleCount++;
    if (mos !== null) vw.mosValues.push(mos);
    if (cdr.jitter != null && cdr.jitter >= 0) vw.jitterValues.push(cdr.jitter);
    if (cdr.pkt_loss != null && cdr.pkt_loss >= 0 && cdr.pkt_loss <= 100) vw.pktLossValues.push(cdr.pkt_loss);
    if (cdr.delay != null && cdr.delay >= 0) vw.latencyValues.push(cdr.delay);

    // Accumulate into prefix-level bucket
    if (prefix !== null) {
      const pw = byKey.get(`${vendor}\x00${prefix}`)!;
      pw.sampleCount++;
      if (mos !== null) pw.mosValues.push(mos);
      if (cdr.jitter != null && cdr.jitter >= 0) pw.jitterValues.push(cdr.jitter);
      if (cdr.pkt_loss != null && cdr.pkt_loss >= 0 && cdr.pkt_loss <= 100) pw.pktLossValues.push(cdr.pkt_loss);
      if (cdr.delay != null && cdr.delay >= 0) pw.latencyValues.push(cdr.delay);
    }
  }

  if (byKey.size === 0) return;

  const client = await pool.connect();
  try {
    for (const [key, w] of byKey) {
      const meta = keyMeta.get(key)!;
      const sortedMos = [...w.mosValues].sort((a, b) => a - b);
      const avgMos = sortedMos.length > 0
        ? sortedMos.reduce((s, v) => s + v, 0) / sortedMos.length
        : null;
      const p10Mos = percentile(sortedMos, 10);

      const avgJitter = w.jitterValues.length > 0
        ? w.jitterValues.reduce((s, v) => s + v, 0) / w.jitterValues.length
        : null;

      const avgPktLoss = w.pktLossValues.length > 0
        ? w.pktLossValues.reduce((s, v) => s + v, 0) / w.pktLossValues.length
        : null;

      const avgLatency = w.latencyValues.length > 0
        ? w.latencyValues.reduce((s, v) => s + v, 0) / w.latencyValues.length
        : null;

      await client.query(`
        INSERT INTO rtp_quality_stats
          (vendor_id, destination_prefix, window_minutes, avg_mos, p10_mos, avg_jitter_ms, avg_pkt_loss_pct, avg_latency_ms, sample_count, computed_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        ON CONFLICT (vendor_id, COALESCE(destination_prefix, ''), window_minutes)
        DO UPDATE SET
          avg_mos          = EXCLUDED.avg_mos,
          p10_mos          = EXCLUDED.p10_mos,
          avg_jitter_ms    = EXCLUDED.avg_jitter_ms,
          avg_pkt_loss_pct = EXCLUDED.avg_pkt_loss_pct,
          avg_latency_ms   = EXCLUDED.avg_latency_ms,
          sample_count     = EXCLUDED.sample_count,
          computed_at      = NOW()
      `, [meta.vendorId, meta.prefix, windowMinutes, avgMos, p10Mos, avgJitter, avgPktLoss, avgLatency, w.sampleCount]);
    }

    // Purge rows for this window that were NOT touched in this run (stale vendor/prefix combos).
    // Any row whose computed_at is still older than runStart was not part of the current data set.
    await client.query(
      `DELETE FROM rtp_quality_stats WHERE window_minutes = $1 AND computed_at < $2`,
      [windowMinutes, runStart],
    );
  } finally {
    client.release();
  }

  const vendorCount = [...byKey.keys()].filter(k => k.endsWith('\x00')).length;
  const prefixCount = byKey.size - vendorCount;
  console.log(`[rtp-quality] window=${windowMinutes}m vendors=${vendorCount} prefixes=${prefixCount} cdrs=${windowCdrs.length}`);
}

async function _run(): Promise<void> {
  if (!_rtpCdrProvider) return; // provider not yet registered (CDR cache not warm)

  try {
    const cutoff24h = Date.now() - 24 * 60 * 60_000;
    const cdrs = _rtpCdrProvider(cutoff24h);
    if (cdrs.length === 0) return;

    await Promise.all([
      aggregateWindow(cdrs, 60),
      aggregateWindow(cdrs, 240),
      aggregateWindow(cdrs, 1440),
    ]);
  } catch (err: any) {
    console.warn('[rtp-quality] Aggregation error (non-fatal):', err.message);
  }
}

// ── Query helpers (used by API routes) ───────────────────────────────────────

export interface VendorQualitySummary {
  vendorId: string;
  /** Vendor-level windows (destination_prefix = NULL) */
  windows: {
    windowMinutes: number;
    avgMos: number | null;
    p10Mos: number | null;
    avgJitterMs: number | null;
    avgPktLossPct: number | null;
    avgLatencyMs: number | null;
    sampleCount: number;
    computedAt: string;
    qualityBadge: 'good' | 'degraded' | 'critical' | 'no_data';
  }[];
  /** Per-prefix breakdowns within this vendor */
  prefixes: {
    prefix: string;
    windows: {
      windowMinutes: number;
      avgMos: number | null;
      avgJitterMs: number | null;
      avgPktLossPct: number | null;
      avgLatencyMs: number | null;
      sampleCount: number;
      qualityBadge: 'good' | 'degraded' | 'critical' | 'no_data';
    }[];
  }[];
}

function mosBadge(avgMos: number | null): 'good' | 'degraded' | 'critical' | 'no_data' {
  if (avgMos == null) return 'no_data';
  if (avgMos >= 3.5) return 'good';
  if (avgMos >= 3.0) return 'degraded';
  return 'critical';
}

/** Max age (ms) a rtp_quality_stats row is considered fresh. 15 min = 3× the 5-min aggregation cycle. */
const ROW_MAX_AGE_MS = 15 * 60_000;

export async function getRtpQualitySummary(): Promise<VendorQualitySummary[]> {
  const allRows = await db.select().from(rtpQualityStats);
  const freshnessThreshold = new Date(Date.now() - ROW_MAX_AGE_MS);
  const rows = allRows.filter(r => r.computedAt >= freshnessThreshold);

  // Separate vendor-level rows (prefix IS NULL) from prefix rows
  const vendorRows    = rows.filter(r => r.destinationPrefix == null);
  const prefixRows    = rows.filter(r => r.destinationPrefix != null);

  // Group vendor rows by vendorId
  const byVendor = new Map<string, typeof vendorRows>();
  for (const row of vendorRows) {
    if (!byVendor.has(row.vendorId)) byVendor.set(row.vendorId, []);
    byVendor.get(row.vendorId)!.push(row);
  }

  // Group prefix rows by vendorId → prefix
  type PrefixGroup = Map<string, typeof prefixRows>;
  const byVendorPrefix = new Map<string, PrefixGroup>();
  for (const row of prefixRows) {
    if (!byVendorPrefix.has(row.vendorId)) byVendorPrefix.set(row.vendorId, new Map());
    const pfx = row.destinationPrefix!;
    if (!byVendorPrefix.get(row.vendorId)!.has(pfx)) {
      byVendorPrefix.get(row.vendorId)!.set(pfx, []);
    }
    byVendorPrefix.get(row.vendorId)!.get(pfx)!.push(row);
  }

  return [...byVendor.entries()].map(([vendorId, vRows]) => {
    const prefixMap = byVendorPrefix.get(vendorId) ?? new Map();
    const prefixes = [...prefixMap.entries()].map(([prefix, pRows]) => ({
      prefix,
      windows: pRows
        .sort((a, b) => a.windowMinutes - b.windowMinutes)
        .map(r => ({
          windowMinutes: r.windowMinutes,
          avgMos:        r.avgMos ?? null,
          avgJitterMs:   r.avgJitterMs ?? null,
          avgPktLossPct: r.avgPktLossPct ?? null,
          avgLatencyMs:  r.avgLatencyMs ?? null,
          sampleCount:   r.sampleCount,
          qualityBadge:  mosBadge(r.avgMos ?? null),
        })),
    })).sort((a, b) => a.prefix.localeCompare(b.prefix));

    return {
      vendorId,
      windows: vRows
        .sort((a, b) => a.windowMinutes - b.windowMinutes)
        .map(r => ({
          windowMinutes:  r.windowMinutes,
          avgMos:         r.avgMos ?? null,
          p10Mos:         r.p10Mos ?? null,
          avgJitterMs:    r.avgJitterMs ?? null,
          avgPktLossPct:  r.avgPktLossPct ?? null,
          avgLatencyMs:   r.avgLatencyMs ?? null,
          sampleCount:    r.sampleCount,
          computedAt:     r.computedAt.toISOString(),
          qualityBadge:   mosBadge(r.avgMos ?? null),
        })),
      prefixes,
    };
  });
}

export async function getRtpQualityForVendor(vendorId: string): Promise<VendorQualitySummary | null> {
  const { eq } = await import('drizzle-orm');
  const allRows = await db.select().from(rtpQualityStats).where(eq(rtpQualityStats.vendorId, vendorId));
  const freshnessThreshold = new Date(Date.now() - ROW_MAX_AGE_MS);
  const rows = allRows.filter(r => r.computedAt >= freshnessThreshold);
  if (rows.length === 0) return null;

  const vendorRows = rows.filter(r => r.destinationPrefix == null);
  const prefixRows = rows.filter(r => r.destinationPrefix != null);

  const prefixMap = new Map<string, typeof prefixRows>();
  for (const row of prefixRows) {
    const pfx = row.destinationPrefix!;
    if (!prefixMap.has(pfx)) prefixMap.set(pfx, []);
    prefixMap.get(pfx)!.push(row);
  }

  const prefixes = [...prefixMap.entries()].map(([prefix, pRows]) => ({
    prefix,
    windows: pRows
      .sort((a, b) => a.windowMinutes - b.windowMinutes)
      .map(r => ({
        windowMinutes: r.windowMinutes,
        avgMos:        r.avgMos ?? null,
        avgJitterMs:   r.avgJitterMs ?? null,
        avgPktLossPct: r.avgPktLossPct ?? null,
        avgLatencyMs:  r.avgLatencyMs ?? null,
        sampleCount:   r.sampleCount,
        qualityBadge:  mosBadge(r.avgMos ?? null),
      })),
  })).sort((a, b) => a.prefix.localeCompare(b.prefix));

  return {
    vendorId,
    windows: vendorRows
      .sort((a, b) => a.windowMinutes - b.windowMinutes)
      .map(r => ({
        windowMinutes:  r.windowMinutes,
        avgMos:         r.avgMos ?? null,
        p10Mos:         r.p10Mos ?? null,
        avgJitterMs:    r.avgJitterMs ?? null,
        avgPktLossPct:  r.avgPktLossPct ?? null,
        avgLatencyMs:   r.avgLatencyMs ?? null,
        sampleCount:    r.sampleCount,
        computedAt:     r.computedAt.toISOString(),
        qualityBadge:   mosBadge(r.avgMos ?? null),
      })),
    prefixes,
  };
}

// ── Voice quality digest for Copilot prompt ───────────────────────────────────

export interface VoiceQualityDigest {
  degradedVendors: Array<{ vendorId: string; avgMos: number; badge: 'degraded' | 'critical' }>;
  hasQualityData: boolean;
  summary: string;
}

export async function buildVoiceQualityDigest(): Promise<VoiceQualityDigest> {
  const { eq } = await import('drizzle-orm');
  // Only look at vendor-level rows (prefix IS NULL) for 1h window
  const allRows = await db.select().from(rtpQualityStats)
    .where(eq(rtpQualityStats.windowMinutes, 60));

  const freshnessThreshold = new Date(Date.now() - ROW_MAX_AGE_MS);
  const vendorRows = allRows.filter(r => r.destinationPrefix == null && r.computedAt >= freshnessThreshold);

  if (vendorRows.length === 0) {
    return { degradedVendors: [], hasQualityData: false, summary: 'No RTP quality data available (VQ reporting may not be enabled on this Sippy instance).' };
  }

  const degraded = vendorRows
    .filter(r => r.avgMos != null && r.avgMos < 3.5)
    .map(r => ({
      vendorId: r.vendorId,
      avgMos:   r.avgMos!,
      badge:    (r.avgMos! < 3.0 ? 'critical' : 'degraded') as 'degraded' | 'critical',
    }))
    .sort((a, b) => a.avgMos - b.avgMos);

  const good = vendorRows.filter(r => r.avgMos != null && r.avgMos >= 3.5).length;
  const totalWithMos = vendorRows.filter(r => r.avgMos != null).length;

  let summary = `Voice quality (1h window): ${totalWithMos} vendor(s) with MOS data. `;
  if (degraded.length === 0) {
    summary += `All ${good} vendor(s) are above MOS 3.5 threshold (good quality).`;
  } else {
    summary += `${degraded.length} vendor(s) below MOS 3.5: ` +
      degraded.map(d => `${d.vendorId} (avg MOS ${d.avgMos.toFixed(2)} — ${d.badge})`).join(', ') + '.';
  }

  return { degradedVendors: degraded, hasQualityData: true, summary };
}
