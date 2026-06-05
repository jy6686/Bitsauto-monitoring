/**
 * SIP Error Aggregator — computes per-vendor SIP error telemetry from real CDR data.
 *
 * Driven by computeSipErrorFromCdrs() called from routes.ts after each CDR cache refresh.
 * Maps Q.850/Q.931 cause codes and numeric SIP result codes to the 6 monitored error codes.
 *
 * Monitored SIP error codes:
 *   503 Service Unavailable  (congestion / network failure)
 *   486 Busy Here
 *   480 Temporarily Unavailable
 *   408 Request Timeout
 *   404 Not Found / Wrong Number
 *   403 Forbidden
 *
 * Results are written to sip_error_stats with three rolling windows:
 *   15 min, 60 min, 240 min
 *   dest_prefix = NULL  →  vendor-level aggregate row
 *   dest_prefix = 'XXXXX' →  prefix-level row (15-min window only, for heatmap)
 *
 * History: each aggregation run writes a new time_bucket row (5-min rounded).
 * Rows older than 24 hours are pruned on each run. This gives sparklines up to
 * 12 samples per vendor+code (one per 5-min run over a 1-hour lookback).
 * sip_error_history stores 60-min snapshots over 8 days for:
 *   - Baseline detection (24h rolling avg per vendor+code)
 *   - 7-day trend charts
 *   - Spike flagging (current rate ≥ 2× baseline AND ≥ 2%)
 *
 * Reference: RFC 3398 (ISUP → SIP mapping), ITU-T Q.850
 */

import { db } from "../../db";
import { sipErrorStats } from "../../../shared/schema";
import { Pool } from "pg";
import { runSipErrorRateCheck } from "../../incident-engine";
import { storage } from "../../storage";
import { sendWhatsAppAlert, formatSipErrorAlert } from "../../whatsapp";
import { EventEmitter } from "events";
import { broadcastSipSpikeDetected } from "../../noc-ws";

export const SIP_ERROR_CODES = [503, 486, 480, 408, 404, 403] as const;
export type SipErrorCode = typeof SIP_ERROR_CODES[number];

export const CODE_LABELS: Record<number, string> = {
  503: "503 Unavailable",
  486: "486 Busy",
  480: "480 Temp. Unavail.",
  408: "408 Timeout",
  404: "404 Not Found",
  403: "403 Forbidden",
};

// Q.850/Q.931 cause code → SIP error code mapping (RFC 3398)
// Tracked codes: 503, 486, 480, 408, 404, 403
const Q850_TO_SIP: Record<number, SipErrorCode> = {
  1:   404, // Unallocated/unassigned number
  2:   404, // No route to transit network
  3:   404, // No route to destination
  17:  486, // User busy
  18:  408, // No user responding (timeout)
  19:  408, // No answer from user (timeout, alerted)
  20:  480, // Subscriber absent
  21:  403, // Call rejected (forbidden)
  22:  404, // Number changed
  27:  503, // Destination out of order
  28:  404, // Invalid number format
  29:  403, // Facility rejected
  31:  480, // Normal, unspecified → temp. unavail.
  34:  503, // No circuit/channel available
  38:  503, // Network out of order
  41:  503, // Temporary failure
  42:  503, // Switching equipment congestion
  44:  503, // Requested circuit unavailable
  47:  503, // Resource unavailable, unspecified
  50:  403, // Requested facility not subscribed
  55:  403, // Incoming calls barred
  57:  403, // Bearer capability not authorized
  58:  503, // Bearer capability not presently available
  65:  503, // Bearer capability not implemented
  69:  503, // Requested facility not implemented
  79:  503, // Service/option not implemented
  87:  403, // User not a member
  88:  503, // Incompatible destination
  95:  503, // Invalid message, unspecified
  96:  503, // Mandatory IE missing
  97:  503, // Message type non-existent
  99:  503, // IE non-existent
  100: 503, // Invalid IE contents
  101: 503, // Message not compatible with call state
  102: 408, // Recovery on timer expiry → timeout
  111: 503, // Protocol error, unspecified
  127: 503, // Interworking, unspecified
};

const WINDOWS_MS: Array<{ minutes: number; ms: number }> = [
  { minutes: 5,  ms:  5  * 60 * 1000 },
  { minutes: 15,  ms: 15  * 60 * 1000 },
  { minutes: 60,  ms: 60  * 60 * 1000 },
];

// Sentinel code used to track total CDR count per vendor-window bucket
const SENTINEL_TOTAL = 0;

// History retention: 24 hours of rows
const HISTORY_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * Round a timestamp down to the nearest 5-minute boundary.
 * Used as the time_bucket key so each aggregation run produces exactly one row
 * per (vendor, window, code, bucket) without duplicates.
 */
function to5MinBucket(ts: number): Date {
  const fiveMin = 5 * 60 * 1000;
  return new Date(Math.floor(ts / fiveMin) * fiveMin);
}

/**
 * Map a raw result string or q850Code string to one of the 6 target SIP error codes.
 * Returns null for answered calls (SIP 200) or when no mapping is possible.
 */
function mapToSipCode(
  result: string | number | undefined,
  q850: string | number | undefined,
): SipErrorCode | null {
  // 1. Try result as a numeric SIP code
  const resultNum = typeof result === 'number' ? result : parseInt(String(result ?? ''), 10);
  if (!isNaN(resultNum) && resultNum > 0) {
    if (resultNum === 200) return null; // answered
    if ((SIP_ERROR_CODES as readonly number[]).includes(resultNum)) return resultNum as SipErrorCode;
    // Map adjacent SIP codes to our 6 tracked codes: 503, 486, 480, 408, 404, 403
    if (resultNum === 487 || resultNum === 488 || resultNum === 491) return 480; // other 4xx → temp unavail
    if (resultNum === 410 || resultNum === 414 || resultNum === 484) return 404;
    if (resultNum === 406 || resultNum === 415 || resultNum === 420 || resultNum === 423) return 403;
    if (resultNum >= 400 && resultNum < 500) return 403; // generic 4xx → Forbidden
    if (resultNum >= 500 && resultNum < 600) return 503;
    if (resultNum >= 600) return 403; // 6xx Decline → Forbidden
  }

  // 2. Try result as named string
  const resultStr = String(result ?? '').toLowerCase().trim();
  if (resultStr === 'success' || resultStr === 'ok' || resultStr === 'answered' || resultStr === '0') return null;
  // "failed"/"failure" with no code — fall through to Q.850

  // 3. Try Q.850 code
  const q850Num = typeof q850 === 'number' ? q850 : parseInt(String(q850 ?? ''), 10);
  if (!isNaN(q850Num) && q850Num > 0) {
    if (q850Num === 16) return null; // Normal call clearing = answered
    return Q850_TO_SIP[q850Num] ?? 480; // Default to 480 for unknown Q.850 codes
  }

  return null;
}

/**
 * Extract a 4-5 digit destination prefix from callee/prefix fields.
 * Strips leading + and non-digit characters. Returns null for empty/short values.
 */
function toDestPrefix(callee: string | undefined, prefix?: string | undefined): string | null {
  const raw = (prefix || callee || '').replace(/^\+/, '').replace(/\D/g, '');
  if (raw.length < 3) return null;
  return raw.slice(0, Math.min(5, raw.length));
}

// ── Sustained-503 event emitter ──────────────────────────────────────────────
// Tracks 503 rates across consecutive 15-min windows per vendor.
// Emits 'sustained-503' when a vendor's 503 rate exceeds the configured
// threshold for the configured number of consecutive windows.
//
// Event payload: { vendorName: string; rate: number; windows: number }

export const sipErrorEmitter = new EventEmitter();

// Settings (overridden at runtime by routes-ai-copilot.ts)
export let sustained503ThresholdPct = 15;  // default 15%
export let sustained503Windows      = 2;   // default 2 consecutive windows

export function updateSustained503Settings(thresholdPct: number, windows: number) {
  sustained503ThresholdPct = thresholdPct;
  sustained503Windows      = windows;
  console.log(`[sip-error-agg] sustained-503 settings updated: threshold=${thresholdPct}%, windows=${windows}`);
}

// Tracks how many consecutive 15-min windows each vendor has been above threshold
const _consecutiveHighWindows = new Map<string, number>();

function checkSustained503(vendor503Rates: Map<string, number>): void {
  for (const [vendor, rate] of vendor503Rates) {
    if (rate >= sustained503ThresholdPct) {
      const consecutive = (_consecutiveHighWindows.get(vendor) ?? 0) + 1;
      _consecutiveHighWindows.set(vendor, consecutive);
      if (consecutive >= sustained503Windows) {
        console.warn(
          `[sip-error-agg] sustained-503 detected: ${vendor} ${rate.toFixed(1)}% ` +
          `(${consecutive}+ consecutive windows ≥${sustained503ThresholdPct}%)`,
        );
        sipErrorEmitter.emit('sustained-503', { vendorName: vendor, rate, windows: consecutive });
      }
    } else {
      // Reset consecutive count when vendor drops below threshold
      if (_consecutiveHighWindows.has(vendor)) {
        _consecutiveHighWindows.delete(vendor);
      }
    }
  }
  // Remove vendors no longer present in this window
  for (const vendor of _consecutiveHighWindows.keys()) {
    if (!vendor503Rates.has(vendor)) {
      _consecutiveHighWindows.delete(vendor);
    }
  }
}

let _isRunning = false;

/**
 * Compute SIP error stats from real CDR data.
 * Called from routes.ts after each CDR cache refresh (every 5 min).
 *
 * Each CDR record is expected to have:
 *   - vendor / vendorName / vendorResolved: string (from Mera enrichment)
 *   - startTime / start_time: string (ISO or Sippy date)
 *   - result: string | number (disconnect reason or numeric SIP code)
 *   - q850Code: string | number (Q.850/Q.931 cause code from Mera)
 *   - callee: string (dialled number, for prefix)
 *   - prefix: string (rate prefix used, for prefix)
 */
export async function computeSipErrorFromCdrs(cdrs: ReadonlyArray<any>): Promise<void> {
  if (_isRunning) return;
  _isRunning = true;
  try {
    const now = Date.now();
    const maxAgeMs = 240 * 60 * 1000 + 60_000;

    // ── Bucket structures ──────────────────────────────────────────────────────
    // vendor-level: windowMs → vendorName → (errorCode | SENTINEL_TOTAL) → count
    type VendorBucket = Map<string, Map<number, number>>;
    const windowBuckets = new Map<number, VendorBucket>();
    for (const { ms } of WINDOWS_MS) windowBuckets.set(ms, new Map());

    // prefix-level (15-min only): "prefix|vendor" → errorCode → count
    const prefixBucket = new Map<string, Map<number, number>>();

    let cdrsProcessed = 0;

    for (const cdr of cdrs) {
      const vendor: string =
        cdr.vendor ||
        (cdr as any).vendorName ||
        (cdr as any).vendorResolved ||
        '';
      if (!vendor) continue;

      const startStr: string = cdr.startTime ?? cdr.start_time ?? '';
      if (!startStr) continue;

      let cdrTs: number;
      try {
        const d = new Date(startStr);
        cdrTs = isNaN(d.getTime()) ? 0 : d.getTime();
      } catch { cdrTs = 0; }
      if (cdrTs === 0 || now - cdrTs < 0 || now - cdrTs > maxAgeMs) continue;

      const ageMs = now - cdrTs;
      const sipCode = mapToSipCode(cdr.result, (cdr as any).q850Code);
      cdrsProcessed++;

      // Vendor-level buckets
      for (const { ms } of WINDOWS_MS) {
        if (ageMs > ms) continue;
        let vb = windowBuckets.get(ms)!;
        if (!vb.has(vendor)) vb.set(vendor, new Map([[SENTINEL_TOTAL, 0]]));
        const codes = vb.get(vendor)!;

        // Always increment total
        codes.set(SENTINEL_TOTAL, (codes.get(SENTINEL_TOTAL) ?? 0) + 1);

        // Increment error code if applicable
        if (sipCode !== null) {
          codes.set(sipCode, (codes.get(sipCode) ?? 0) + 1);
        }
      }

      // Prefix bucket (15-min only)
      if (ageMs <= 15 * 60 * 1000 && sipCode !== null) {
        const pfx = toDestPrefix(cdr.callee, (cdr as any).prefix);
        if (pfx) {
          const key = `${pfx}|${vendor}`;
          if (!prefixBucket.has(key)) prefixBucket.set(key, new Map([[SENTINEL_TOTAL, 0]]));
          const pb = prefixBucket.get(key)!;
          pb.set(SENTINEL_TOTAL, (pb.get(SENTINEL_TOTAL) ?? 0) + 1);
          pb.set(sipCode, (pb.get(sipCode) ?? 0) + 1);
        }
      }
    }

    if (cdrsProcessed === 0) {
      console.log('[sip-error-agg] No enriched CDRs with vendor info — skipping write');
      return;
    }

    // ── Compute time_bucket for this run (5-min rounded) ──────────────────────
    const timeBucket = to5MinBucket(now);
    const computedAt = new Date().toISOString();

    // ── Build DB rows ──────────────────────────────────────────────────────────
    const rows: {
      vendor_name: string;
      window_minutes: number;
      code: number;
      count: number;
      rate: number;
      dest_prefix: string | null;
      computed_at: string;
      time_bucket: string;
    }[] = [];

    // History rows (60-min window only — stable signal for baseline)
    const historyRows: {
      vendor_name: string;
      code: number;
      count: number;
      rate: number;
    }[] = [];

    for (const { minutes, ms } of WINDOWS_MS) {
      const vb = windowBuckets.get(ms)!;
      for (const [vendor, codes] of vb) {
        const total = codes.get(SENTINEL_TOTAL) ?? 0;
        for (const code of SIP_ERROR_CODES) {
          const count = codes.get(code) ?? 0;
          const rate  = total > 0 ? Math.round((count / total) * 10000) / 100 : 0;
          rows.push({ vendor_name: vendor, window_minutes: minutes, code, count, rate, dest_prefix: '', computed_at: computedAt, time_bucket: timeBucket.toISOString() });

          // Also collect 60-min window rows for history
          if (minutes === 60) {
            historyRows.push({ vendor_name: vendor, code, count, rate });
          }
        }
      }
    }

    // Prefix rows (15-min only)
    for (const [key, pb] of prefixBucket) {
      const [pfx, vendor] = key.split('|');
      const total = pb.get(SENTINEL_TOTAL) ?? 0;
      for (const [code, count] of pb) {
        if (code === SENTINEL_TOTAL) continue;
        const rate = total > 0 ? Math.round((count / total) * 10000) / 100 : 0;
        rows.push({ vendor_name: vendor, window_minutes: 15, code, count, rate, dest_prefix: pfx, computed_at: computedAt, time_bucket: timeBucket.toISOString() });
      }
    }

    // ── Atomic DB write using pg Pool ─────────────────────────────────────────
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      // Prune history older than 24 hours
      const cutoff = new Date(now - HISTORY_RETENTION_MS).toISOString();
      await pool.query(`DELETE FROM sip_error_stats WHERE time_bucket < $1`, [cutoff]);

      // Also prune legacy rows that have no time_bucket (written before history support)
      // so they don't accumulate indefinitely
      await pool.query(`DELETE FROM sip_error_stats WHERE time_bucket IS NULL`);

      if (rows.length > 0) {
        const CHUNK = 200;
        for (let i = 0; i < rows.length; i += CHUNK) {
          const chunk = rows.slice(i, i + CHUNK);
          const vals: any[] = [];
          const placeholders = chunk.map((r, j) => {
            const b = j * 8;
            vals.push(r.vendor_name, r.window_minutes, r.code, r.count, r.rate, r.computed_at, r.dest_prefix, r.time_bucket);
            return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8})`;
          }).join(',');
          await pool.query(
            `INSERT INTO sip_error_stats (vendor_name, window_minutes, code, count, rate, computed_at, dest_prefix, time_bucket)
             VALUES ${placeholders}
             ON CONFLICT (vendor_name, window_minutes, code, time_bucket, dest_prefix)
             DO UPDATE SET count = EXCLUDED.count, rate = EXCLUDED.rate, computed_at = EXCLUDED.computed_at`,
            vals,
          );
        }
      }

      // ── Append 60-min snapshot to sip_error_history ────────────────────────
      if (historyRows.length > 0) {
        try {
          const histVals: any[] = [];
          const histPlaceholders = historyRows.map((r, j) => {
            const b = j * 4;
            histVals.push(r.vendor_name, r.code, r.count, r.rate);
            return `($${b+1},$${b+2},$${b+3},$${b+4},NOW())`;
          }).join(',');
          await pool.query(
            `INSERT INTO sip_error_history (vendor_name, code, count, rate, snapshot_at) VALUES ${histPlaceholders}`,
            histVals,
          );
          // Prune records older than 8 days
          await pool.query(`DELETE FROM sip_error_history WHERE snapshot_at < NOW() - INTERVAL '8 days'`);
        } catch (histErr: any) {
          console.warn('[sip-error-agg] History write failed (non-fatal):', histErr.message);
        }
      }
    } finally {
      await pool.end();
    }

    const vendorCount = new Set(rows.filter(r => r.dest_prefix === '').map(r => r.vendor_name)).size;
    const prefixCount = new Set(rows.filter(r => r.dest_prefix !== '').map(r => r.dest_prefix)).size;

    console.log(`[sip-error-agg] Bucket ${timeBucket.toISOString()} — ${rows.length} rows for ${vendorCount} vendor(s), ${prefixCount} prefix(es) from ${cdrsProcessed} CDRs`);

    // ── Post-aggregation alert check ──────────────────────────────────────────
    // Build a flat list of 15-min vendor×code stats for the incident check
    const vendorStats15m: Array<{ vendorName: string; code: number; rate: number; codeLabel: string }> = [];
    for (const row of rows) {
      if (row.window_minutes === 15 && row.dest_prefix === '') {
        vendorStats15m.push({
          vendorName: row.vendor_name,
          code:       row.code,
          rate:       row.rate,
          codeLabel:  CODE_LABELS[row.code] ?? String(row.code),
        });
      }
    }

    if (vendorStats15m.length > 0) {
      const settings = await storage.getSettings().catch(() => null);
      const threshold = settings?.sipErrorAlertThreshold ?? 15;

      const newlyOpened = await runSipErrorRateCheck(vendorStats15m, threshold);

      // Dispatch WhatsApp for each newly-opened vendor (group alerts per vendor)
      if (newlyOpened.length > 0) {
        const byVendor = new Map<string, Array<{ codeLabel: string; rate: number }>>();
        for (const s of newlyOpened) {
          if (!byVendor.has(s.vendorName)) byVendor.set(s.vendorName, []);
          byVendor.get(s.vendorName)!.push({ codeLabel: s.codeLabel, rate: s.rate });
        }
        for (const [vendorName, alerts] of byVendor) {
          const msg = formatSipErrorAlert({ vendorName, alerts, threshold });
          sendWhatsAppAlert('sip_error', msg).catch((e: any) =>
            console.warn('[sip-error-agg] WhatsApp alert error:', e.message)
          );
        }
      }
    }

    // ── Sustained-503 check ──────────────────────────────────────────────────
    // Extract 15-min 503 rate per vendor and fire sustained-503 if threshold met
    const vendor503Rates = new Map<string, number>();
    for (const row of rows) {
      if (row.window_minutes === 15 && row.code === 503 && !row.dest_prefix) {
        vendor503Rates.set(row.vendor_name, row.rate);
      }
    }
    if (vendor503Rates.size > 0) {
      checkSustained503(vendor503Rates);
    }

    // ── SIP spike incident detection & NOC broadcast ──────────────────────────
    processSpikesAfterAggregation(rows).catch((e: any) =>
      console.warn('[sip-error-agg] Spike processing error (non-fatal):', e.message)
    );
  } catch (err: any) {
    console.warn('[sip-error-agg] Aggregation error (non-fatal):', err.message);
  } finally {
    _isRunning = false;
  }
}

// ── In-memory spike state: key = `${vendorName}:${code}` → noc_incident id ───
const _activeSpikeIncidents = new Map<string, number>();

/**
 * Detect new SIP spikes and resolve cleared ones.
 * Called asynchronously from computeSipErrorFromCdrs() after each aggregation run.
 *
 * Spike criteria (60-min window):  currentRate ≥ 2% AND ≥ 2× 24h baseline
 * Resolution criteria:             currentRate < 1.5× baseline (hysteresis gap)
 *
 * New spikes → noc_incidents row (type: sip_spike) + NOC WebSocket broadcast
 * Cleared spikes → noc_incidents resolved + in-memory state removed
 */
async function processSpikesAfterAggregation(
  rows: Array<{ vendor_name: string; window_minutes: number; code: number; rate: number; dest_prefix: string | null }>,
): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    // Query 24h baseline from sip_error_history
    const baselineRes = await pool.query(`
      SELECT vendor_name, code, AVG(rate) AS baseline_rate
      FROM sip_error_history
      WHERE snapshot_at > NOW() - INTERVAL '24 hours'
      GROUP BY vendor_name, code
    `).catch(() => ({ rows: [] as any[] }));

    const baselineMap = new Map<string, number>();
    for (const row of baselineRes.rows) {
      baselineMap.set(`${row.vendor_name}:${row.code}`, parseFloat(row.baseline_rate ?? '0'));
    }

    // Identify currently spiking vendor+code pairs (60-min window, no prefix)
    const currentSpikeRows = new Map<string, { vendorName: string; code: number; rate: number; baselineRate: number; multiplier: number }>();
    for (const row of rows) {
      if (row.window_minutes !== 60 || row.dest_prefix !== '') continue;
      const key = `${row.vendor_name}:${row.code}`;
      const baselineRate = baselineMap.get(key) ?? 0;
      const isSpiking = row.rate >= 2 && baselineRate > 0 && row.rate >= 2 * baselineRate;
      if (isSpiking) {
        const multiplier = row.rate / baselineRate;
        currentSpikeRows.set(key, { vendorName: row.vendor_name, code: row.code, rate: row.rate, baselineRate, multiplier });
      }
    }

    // ── Open incidents for new spikes ─────────────────────────────────────────
    for (const [key, spike] of currentSpikeRows) {
      if (_activeSpikeIncidents.has(key)) continue; // already tracked

      const codeLabel = CODE_LABELS[spike.code] ?? String(spike.code);
      const severity  = spike.multiplier >= 3 ? 'high' : 'medium';
      const description = `${codeLabel} error rate is ${spike.rate.toFixed(1)}% — ${spike.multiplier.toFixed(1)}× the 24h baseline of ${spike.baselineRate.toFixed(1)}%. Window: 60 min.`;
      const suggestedAction = spike.code === 503
        ? 'Check carrier congestion; consider route failover to an alternate vendor.'
        : spike.code === 486
        ? 'High busy rate — check destination capacity and trunk group limits.'
        : 'Investigate vendor routing and SIP signalling for this error pattern.';

      try {
        const incRes = await pool.query(
          `INSERT INTO noc_incidents (title, type, severity, status, entity_type, entity_id, entity_name, description, suggested_action, source, tags, opened_at, updated_at)
           VALUES ($1, 'sip_spike', $2, 'open', 'vendor', $3, $4, $5, $6, 'sip_error_aggregator', '{}', NOW(), NOW())
           RETURNING id`,
          [
            `SIP spike: ${spike.vendorName} — ${codeLabel} ${spike.rate.toFixed(1)}% (${spike.multiplier.toFixed(1)}× baseline)`,
            severity,
            key,
            spike.vendorName,
            description,
            suggestedAction,
          ],
        );
        const incId: number | undefined = incRes.rows[0]?.id;
        if (incId) {
          _activeSpikeIncidents.set(key, incId);
          broadcastSipSpikeDetected({
            vendorName:   spike.vendorName,
            code:         spike.code,
            codeLabel,
            currentRate:  spike.rate,
            baselineRate: spike.baselineRate,
            multiplier:   spike.multiplier,
            severity,
            incidentId:   incId,
            detectedAt:   new Date().toISOString(),
          });
          console.warn(
            `[sip-error-agg] SIP spike detected: ${key} → ` +
            `${spike.rate.toFixed(1)}% (${spike.multiplier.toFixed(1)}× baseline) — incident #${incId}`,
          );
        }
      } catch (e: any) {
        console.warn(`[sip-error-agg] Failed to create spike incident for ${key}:`, e.message);
      }
    }

    // ── Auto-resolve incidents where spike has cleared ─────────────────────────
    for (const [key, incId] of Array.from(_activeSpikeIncidents)) {
      if (currentSpikeRows.has(key)) continue; // still active

      const [vendorName, codeStr] = key.split(':');
      const code = parseInt(codeStr, 10);
      const baselineRate = baselineMap.get(key) ?? 0;
      const row = rows.find(r => r.vendor_name === vendorName && r.code === code && r.window_minutes === 60 && r.dest_prefix === '');
      const currentRate = row?.rate ?? 0;

      // Only resolve when rate has dropped below 1.5× baseline (hysteresis)
      const belowThreshold = baselineRate === 0 || currentRate < 1.5 * baselineRate;
      if (!belowThreshold) continue;

      try {
        await pool.query(
          `UPDATE noc_incidents SET status='resolved', resolved_at=NOW(), updated_at=NOW() WHERE id=$1 AND resolved_at IS NULL`,
          [incId],
        );
        _activeSpikeIncidents.delete(key);
        console.log(`[sip-error-agg] SIP spike auto-resolved: ${key} (incident #${incId}, rate now ${currentRate.toFixed(1)}%)`);
      } catch (e: any) {
        console.warn(`[sip-error-agg] Failed to resolve spike incident #${incId}:`, e.message);
      }
    }
  } finally {
    await pool.end();
  }
}

/**
 * Kept for backwards compatibility.
 * The aggregation is now driven by computeSipErrorFromCdrs() from routes.ts.
 */
export function startSipErrorAggregator(): void {
  console.log('[sip-error-agg] CDR-driven aggregation registered (fires after each CDR cache refresh)');
}

// ── Snapshot loader (used by copilot engine and API route) ───────────────────

export interface SipErrorSnapshot {
  vendorName: string;
  windows: {
    [mins: number]: {
      [code: number]: { count: number; rate: number };
    };
  };
  topCode: number | null;
  maxRate: number;
  hasCongestion: boolean;   // 503 rate > 10 %
  hasCliRejection: boolean; // 486 rate > 10 %
}

export interface SipPrefixRow {
  destPrefix: string;
  vendorName: string;
  dominantCode: number;
  dominantRate: number;
  totalFailures: number;
}

export interface SipHistoryPoint {
  timeBucket: string; // ISO timestamp
  rate: number;
}

export interface SipVendorHistory {
  vendorName: string;
  windowMinutes: number;
  code: number;
  points: SipHistoryPoint[]; // ordered oldest→newest, max 12
}

export interface SipSpikeFlag {
  code: number;
  currentRate: number;
  baselineRate: number;
  multiplier: number; // currentRate / baselineRate
}

export interface SipErrorVendorWithSpikes extends SipErrorSnapshot {
  spikes: SipSpikeFlag[];      // active spikes (currentRate >= 2× baseline AND >= 2%)
  hasSpike: boolean;
}

export async function loadSipErrorSnapshot(): Promise<SipErrorSnapshot[]> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    // Latest snapshot: for each (vendor, window, code) get the row with the most recent time_bucket
    const res = await pool.query(`
      SELECT DISTINCT ON (vendor_name, window_minutes, code)
        vendor_name, window_minutes, code, count, rate, computed_at, time_bucket
      FROM sip_error_stats
      WHERE dest_prefix = ''
        AND time_bucket IS NOT NULL
      ORDER BY vendor_name, window_minutes, code, time_bucket DESC
    `);
    const rows = res.rows;
    if (rows.length === 0) return [];

    const byVendor = new Map<string, SipErrorSnapshot>();
    for (const row of rows) {
      if (!byVendor.has(row.vendor_name)) {
        byVendor.set(row.vendor_name, {
          vendorName: row.vendor_name,
          windows: {},
          topCode: null,
          maxRate: 0,
          hasCongestion: false,
          hasCliRejection: false,
        });
      }
      const snap = byVendor.get(row.vendor_name)!;
      if (!snap.windows[row.window_minutes]) snap.windows[row.window_minutes] = {};
      snap.windows[row.window_minutes][row.code] = { count: row.count, rate: parseFloat(row.rate) };

      const rate = parseFloat(row.rate);
      if (rate > snap.maxRate) { snap.maxRate = rate; snap.topCode = row.code; }
      if (row.code === 503 && rate > 10) snap.hasCongestion = true;
      if (row.code === 486 && rate > 10) snap.hasCliRejection = true;
    }

    return [...byVendor.values()].sort((a, b) => b.maxRate - a.maxRate);
  } finally {
    await pool.end();
  }
}

/**
 * Load current SIP error snapshot with 24h-baseline spike detection.
 * @param windowMinutes - comparison window in minutes: 15 | 60 | 240 (default 60).
 *   Controls which sip_error_stats rows are used for spike computation.
 *   All windows are returned in the `windows` field regardless.
 */
export async function loadSipErrorSnapshotWithSpikes(windowMinutes: 15 | 60 | 240 = 60): Promise<SipErrorVendorWithSpikes[]> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const [snapRes, baselineRes] = await Promise.all([
      pool.query(`SELECT * FROM sip_error_stats WHERE dest_prefix = ''`),
      pool.query(`
        SELECT vendor_name, code, AVG(rate) AS baseline_rate
        FROM sip_error_history
        WHERE snapshot_at > NOW() - INTERVAL '24 hours'
        GROUP BY vendor_name, code
      `).catch(() => ({ rows: [] as any[] })),
    ]);

    // Build baseline map: vendorName+code → avg rate
    const baselineMap = new Map<string, number>();
    for (const row of baselineRes.rows) {
      baselineMap.set(`${row.vendor_name}:${row.code}`, parseFloat(row.baseline_rate ?? '0'));
    }

    const byVendor = new Map<string, SipErrorVendorWithSpikes>();
    for (const row of snapRes.rows) {
      if (!byVendor.has(row.vendor_name)) {
        byVendor.set(row.vendor_name, {
          vendorName: row.vendor_name,
          windows: {},
          topCode: null,
          maxRate: 0,
          hasCongestion: false,
          hasCliRejection: false,
          spikes: [],
          hasSpike: false,
        });
      }
      const snap = byVendor.get(row.vendor_name)!;
      if (!snap.windows[row.window_minutes]) snap.windows[row.window_minutes] = {};
      snap.windows[row.window_minutes][row.code] = { count: row.count, rate: parseFloat(row.rate) };

      const rate = parseFloat(row.rate);
      if (rate > snap.maxRate) { snap.maxRate = rate; snap.topCode = row.code; }
      if (row.code === 503 && rate > 10) snap.hasCongestion = true;
      if (row.code === 486 && rate > 10) snap.hasCliRejection = true;

      // Spike detection: use the requested windowMinutes for comparison
      if (row.window_minutes === windowMinutes) {
        const baselineRate = baselineMap.get(`${row.vendor_name}:${row.code}`) ?? 0;
        const currentRate = rate;
        // Criteria: current ≥ 2% absolute AND ≥ 2× 24h baseline
        const isSpiking = currentRate >= 2 && baselineRate > 0 && currentRate >= 2 * baselineRate;
        if (isSpiking) {
          const multiplier = baselineRate > 0 ? currentRate / baselineRate : 0;
          snap.spikes.push({ code: row.code, currentRate, baselineRate, multiplier });
          snap.hasSpike = true;
        }
      }
    }

    return [...byVendor.values()].sort((a, b) => {
      // Sort: spikes first, then by maxRate
      if (a.hasSpike && !b.hasSpike) return -1;
      if (!a.hasSpike && b.hasSpike) return 1;
      return b.maxRate - a.maxRate;
    });
  } finally {
    await pool.end();
  }
}

/**
 * Load 7-day error rate history for a vendor (grouped by day).
 * vendorName is matched case-insensitively.
 */
export async function loadVendorErrorHistory(
  vendorName: string,
  days: number = 7,
): Promise<{ date: string; rates: Record<number, number>; baselines: Record<number, number> }[]> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const safeDays = Math.min(days, 8);
    // For each (day, code) pair compute:
    //   rate     = AVG(rate) across all snapshots on that calendar day
    //   baseline = AVG(rate) across all raw rows in the 24h window
    //              *before* that day starts — identical semantics to the
    //              trailing-24h window used in loadSipErrorSnapshotWithSpikes().
    const res = await pool.query(`
      WITH daily AS (
        SELECT
          DATE(snapshot_at AT TIME ZONE 'UTC') AS day,
          code,
          AVG(rate)                             AS avg_rate
        FROM sip_error_history
        WHERE LOWER(vendor_name) = LOWER($1)
          AND snapshot_at > NOW() - INTERVAL '${safeDays} days'
        GROUP BY DATE(snapshot_at AT TIME ZONE 'UTC'), code
      )
      SELECT
        d.day,
        d.code,
        d.avg_rate   AS rate,
        (
          SELECT AVG(h.rate)
          FROM   sip_error_history h
          WHERE  LOWER(h.vendor_name) = LOWER($1)
            AND  h.code = d.code
            AND  h.snapshot_at >= (d.day::timestamp - INTERVAL '24 hours')
            AND  h.snapshot_at <   d.day::timestamp
        )            AS baseline_rate
      FROM daily d
      ORDER BY d.day ASC
    `, [vendorName]);

    // Build a date → code → rate/baseline maps
    const dateMap = new Map<string, { rates: Record<number, number>; baselines: Record<number, number> }>();
    for (const row of res.rows) {
      const day = row.day instanceof Date
        ? row.day.toISOString().slice(0, 10)
        : String(row.day).slice(0, 10);
      if (!dateMap.has(day)) dateMap.set(day, { rates: {}, baselines: {} });
      const entry = dateMap.get(day)!;
      entry.rates[row.code] = parseFloat(row.rate ?? '0');
      if (row.baseline_rate != null) {
        entry.baselines[row.code] = parseFloat(row.baseline_rate);
      }
    }

    return [...dateMap.entries()].map(([date, { rates, baselines }]) => ({ date, rates, baselines }));
  } finally {
    await pool.end();
  }
}

export async function loadSipPrefixSnapshot(): Promise<SipPrefixRow[]> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    // For each (prefix, vendor) find the most recent time_bucket, then dominant code
    const res = await pool.query(`
      SELECT DISTINCT ON (dest_prefix, vendor_name, time_bucket)
        dest_prefix,
        vendor_name,
        code AS dominant_code,
        rate AS dominant_rate,
        count AS total_failures,
        time_bucket
      FROM sip_error_stats
      WHERE dest_prefix != '' AND window_minutes = 15
        AND time_bucket IS NOT NULL
      ORDER BY dest_prefix, vendor_name, time_bucket DESC, rate DESC
    `);

    // For each prefix+vendor pair take only the latest time_bucket, highest rate code
    const seen = new Set<string>();
    const latest = new Map<string, { timeBucket: Date; dominantCode: number; dominantRate: number; totalFailures: number }>();
    for (const row of res.rows) {
      const key = `${row.dest_prefix}:${row.vendor_name}`;
      const tb = new Date(row.time_bucket);
      const existing = latest.get(key);
      if (!existing || tb > existing.timeBucket) {
        latest.set(key, {
          timeBucket: tb,
          dominantCode: row.dominant_code,
          dominantRate: parseFloat(row.dominant_rate),
          totalFailures: row.total_failures,
        });
      }
    }

    const out: SipPrefixRow[] = [];
    for (const [key, val] of latest) {
      const [destPrefix, vendorName] = key.split(':');
      out.push({ destPrefix, vendorName, dominantCode: val.dominantCode, dominantRate: val.dominantRate, totalFailures: val.totalFailures });
    }
    return out;
  } finally {
    await pool.end();
  }
}

/**
 * Load up to 12 historical samples per (vendor, window, code) for sparkline rendering.
 * Returns vendor-level rows only (dest_prefix = '').
 */
export async function loadSipErrorHistory(windowMinutes: 15 | 60 | 240): Promise<SipVendorHistory[]> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    // Get the 12 most recent distinct time_buckets for this window
    const bucketsRes = await pool.query(`
      SELECT DISTINCT time_bucket
      FROM sip_error_stats
      WHERE dest_prefix = ''
        AND window_minutes = $1
        AND time_bucket IS NOT NULL
      ORDER BY time_bucket DESC
      LIMIT 12
    `, [windowMinutes]);

    if (bucketsRes.rows.length === 0) return [];

    const buckets: string[] = bucketsRes.rows.map((r: any) => r.time_bucket).reverse(); // oldest first

    // Fetch all rows for those buckets
    const res = await pool.query(`
      SELECT vendor_name, code, rate, time_bucket
      FROM sip_error_stats
      WHERE dest_prefix = ''
        AND window_minutes = $1
        AND time_bucket = ANY($2::timestamptz[])
      ORDER BY vendor_name, code, time_bucket
    `, [windowMinutes, buckets]);

    // Group by vendor+code
    const map = new Map<string, SipVendorHistory>();
    for (const row of res.rows) {
      const key = `${row.vendor_name}::${row.code}`;
      if (!map.has(key)) {
        map.set(key, {
          vendorName: row.vendor_name,
          windowMinutes,
          code: row.code,
          points: [],
        });
      }
      map.get(key)!.points.push({
        timeBucket: new Date(row.time_bucket).toISOString(),
        rate: parseFloat(row.rate),
      });
    }

    return [...map.values()];
  } finally {
    await pool.end();
  }
}

/**
 * Named alias for loadSipErrorSnapshot — follows the telemetry-loader
 * naming convention used by the AI Route Copilot.
 */
export const loadSipErrorProfilesPerVendor = loadSipErrorSnapshot;
