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
 *   404 Not Found / Wrong Number
 *   603 Decline / Rejected
 *   487 Request Terminated / Cancelled
 *
 * Results are written to sip_error_stats with three rolling windows:
 *   15 min, 60 min, 240 min
 *   dest_prefix = NULL  →  vendor-level aggregate row
 *   dest_prefix = 'XXXXX' →  prefix-level row (15-min window only, for heatmap)
 *
 * Reference: RFC 3398 (ISUP → SIP mapping), ITU-T Q.850
 */

import { db } from "../../db";
import { sipErrorStats } from "../../../shared/schema";
import { Pool } from "pg";

export const SIP_ERROR_CODES = [503, 486, 480, 404, 603, 487] as const;
export type SipErrorCode = typeof SIP_ERROR_CODES[number];

export const CODE_LABELS: Record<number, string> = {
  503: "503 Unavailable",
  486: "486 Busy",
  480: "480 Temp. Unavail.",
  404: "404 Not Found",
  603: "603 Decline",
  487: "487 Cancelled",
};

// Q.850/Q.931 cause code → SIP error code mapping (RFC 3398)
const Q850_TO_SIP: Record<number, SipErrorCode> = {
  1:   404, // Unallocated/unassigned number
  2:   404, // No route to transit network
  3:   404, // No route to destination
  17:  486, // User busy
  18:  480, // No user responding
  19:  480, // No answer from user (alerted)
  20:  480, // Subscriber absent
  21:  603, // Call rejected
  22:  404, // Number changed
  27:  603, // Destination out of order
  28:  404, // Invalid number format
  29:  603, // Facility rejected
  31:  487, // Normal, unspecified
  34:  503, // No circuit/channel available
  38:  503, // Network out of order
  41:  503, // Temporary failure
  42:  503, // Switching equipment congestion
  44:  503, // Requested circuit unavailable
  47:  503, // Resource unavailable, unspecified
  50:  603, // Requested facility not subscribed
  55:  603, // Incoming calls barred
  57:  603, // Bearer capability not authorized
  58:  503, // Bearer capability not presently available
  65:  503, // Bearer capability not implemented
  69:  503, // Requested facility not implemented
  79:  503, // Service/option not implemented
  87:  603, // User not a member
  88:  503, // Incompatible destination
  95:  503, // Invalid message, unspecified
  96:  503, // Mandatory IE missing
  97:  503, // Message type non-existent
  99:  503, // IE non-existent
  100: 503, // Invalid IE contents
  101: 503, // Message not compatible with call state
  102: 503, // Recovery on timer expiry
  111: 503, // Protocol error, unspecified
  127: 503, // Interworking, unspecified
};

const WINDOWS_MS: Array<{ minutes: number; ms: number }> = [
  { minutes: 15,  ms: 15  * 60 * 1000 },
  { minutes: 60,  ms: 60  * 60 * 1000 },
  { minutes: 240, ms: 240 * 60 * 1000 },
];

// Sentinel code used to track total CDR count per vendor-window bucket
const SENTINEL_TOTAL = 0;

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
    // Map adjacent SIP codes to our 6
    if (resultNum === 408) return 480;
    if (resultNum === 410 || resultNum === 414) return 404;
    if (resultNum === 403 || resultNum === 423 || resultNum === 491) return 603;
    if (resultNum >= 400 && resultNum < 500) return 404;
    if (resultNum >= 500 && resultNum < 600) return 503;
    if (resultNum === 600 || resultNum === 606) return 603;
    if (resultNum >= 600) return 603;
  }

  // 2. Try result as named string
  const resultStr = String(result ?? '').toLowerCase().trim();
  if (resultStr === 'success' || resultStr === 'ok' || resultStr === 'answered' || resultStr === '0') return null;
  if (resultStr === 'failed' || resultStr === 'failure') {
    // No specific code — use Q.850 if available, else skip
  }

  // 3. Try Q.850 code
  const q850Num = typeof q850 === 'number' ? q850 : parseInt(String(q850 ?? ''), 10);
  if (!isNaN(q850Num) && q850Num > 0) {
    if (q850Num === 16) return null; // Normal call clearing = answered
    return Q850_TO_SIP[q850Num] ?? 487; // Default to 487 for unknown Q.850 codes
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

    // ── Build DB rows ──────────────────────────────────────────────────────────
    const rows: {
      vendor_name: string;
      window_minutes: number;
      code: number;
      count: number;
      rate: number;
      dest_prefix: string | null;
      computed_at: string;
    }[] = [];

    const computedAt = new Date().toISOString();

    for (const { minutes, ms } of WINDOWS_MS) {
      const vb = windowBuckets.get(ms)!;
      for (const [vendor, codes] of vb) {
        const total = codes.get(SENTINEL_TOTAL) ?? 0;
        for (const code of SIP_ERROR_CODES) {
          const count = codes.get(code) ?? 0;
          const rate  = total > 0 ? Math.round((count / total) * 10000) / 100 : 0;
          rows.push({ vendor_name: vendor, window_minutes: minutes, code, count, rate, dest_prefix: null, computed_at: computedAt });
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
        rows.push({ vendor_name: vendor, window_minutes: 15, code, count, rate, dest_prefix: pfx, computed_at: computedAt });
      }
    }

    // ── Atomic DB write using pg Pool ─────────────────────────────────────────
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      await pool.query('DELETE FROM sip_error_stats');
      if (rows.length > 0) {
        const CHUNK = 200;
        for (let i = 0; i < rows.length; i += CHUNK) {
          const chunk = rows.slice(i, i + CHUNK);
          const vals: any[] = [];
          const placeholders = chunk.map((r, j) => {
            const b = j * 7;
            vals.push(r.vendor_name, r.window_minutes, r.code, r.count, r.rate, r.computed_at, r.dest_prefix);
            return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7})`;
          }).join(',');
          await pool.query(
            `INSERT INTO sip_error_stats (vendor_name, window_minutes, code, count, rate, computed_at, dest_prefix) VALUES ${placeholders}`,
            vals,
          );
        }
      }
    } finally {
      await pool.end();
    }

    const vendorCount = new Set(rows.filter(r => !r.dest_prefix).map(r => r.vendor_name)).size;
    const prefixCount = new Set(rows.filter(r => r.dest_prefix).map(r => r.dest_prefix)).size;
    console.log(`[sip-error-agg] Computed ${rows.length} rows for ${vendorCount} vendor(s), ${prefixCount} prefix(es) from ${cdrsProcessed} CDRs`);
  } catch (err: any) {
    console.warn('[sip-error-agg] Aggregation error (non-fatal):', err.message);
  } finally {
    _isRunning = false;
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

export async function loadSipErrorSnapshot(): Promise<SipErrorSnapshot[]> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const res = await pool.query(`SELECT * FROM sip_error_stats WHERE dest_prefix IS NULL`);
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

export async function loadSipPrefixSnapshot(): Promise<SipPrefixRow[]> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    // For each (prefix, vendor) find dominant code by highest rate
    const res = await pool.query(`
      SELECT
        dest_prefix,
        vendor_name,
        code AS dominant_code,
        rate AS dominant_rate,
        count AS total_failures
      FROM sip_error_stats
      WHERE dest_prefix IS NOT NULL AND window_minutes = 15
      ORDER BY dest_prefix, vendor_name, rate DESC
    `);

    // Deduplicate: take highest-rate code per prefix+vendor
    const seen = new Set<string>();
    const out: SipPrefixRow[] = [];
    for (const row of res.rows) {
      const key = `${row.dest_prefix}:${row.vendor_name}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({
          destPrefix:    row.dest_prefix,
          vendorName:    row.vendor_name,
          dominantCode:  row.dominant_code,
          dominantRate:  parseFloat(row.dominant_rate),
          totalFailures: row.total_failures,
        });
      }
    }
    return out;
  } finally {
    await pool.end();
  }
}
