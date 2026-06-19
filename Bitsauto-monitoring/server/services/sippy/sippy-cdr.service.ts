/**
 * sippy-cdr.service.ts
 *
 * CDR (Call Detail Record) sync, normalization, caching, and aggregation.
 * Owns: CDR retrieval (XML-RPC + portal fallback), normalization pipeline,
 * prefix matching, timezone normalization, and aggregation helpers.
 *
 * Design for future queue-safe use:
 *   - syncCdrs() is idempotent — safe to call from cron/queue
 *   - All methods accept SippyConfig — no global state
 *   - Normalization is deterministic — same input → same output
 */

import * as sippy from '../../sippy';
import { SippyConfig, SippyCDR, ServiceResult } from './types';
import { normalizeSippyError, SippyCdrError } from './errors';
import {
  CDR_FETCH_TIMEOUT_MS, MAX_CDR_FETCH_ROWS, CDR_DEFAULT_WINDOW_HOURS,
} from './constants';
import { withTimeout, withRetry, normalizePrefix, parseSippyDateStr, toSippyDateStr, hoursAgo } from './utils';
import { auditLog } from './sippy-audit.service';

// ── CDR retrieval ─────────────────────────────────────────────────────────────

/**
 * Fetch CDRs via XML-RPC with portal scraping fallback.
 * Returns normalized SippyCDR records.
 *
 * Primary source: XML-RPC getAccountCDRs
 * Fallback source: Portal /c1/ customer CDR scrape
 *
 * This is the canonical entry point for all CDR data access.
 */
export async function syncCdrs(
  config: SippyConfig,
  opts: {
    maxRows?:    number;
    startDate?:  Date;
    endDate?:    Date;
    iAccount?:   string | number;
    portalUrl?:  string;
  } = {},
): Promise<{ cdrs: SippyCDR[]; source: 'xmlrpc' | 'portal'; count: number }> {
  const t0       = Date.now();
  const maxRows  = opts.maxRows   ?? MAX_CDR_FETCH_ROWS;
  const start    = opts.startDate ?? hoursAgo(CDR_DEFAULT_WINDOW_HOURS);
  const end      = opts.endDate   ?? new Date();
  const startStr = toSippyDateStr(start);
  const endStr   = toSippyDateStr(end);
  const portalUrl = opts.portalUrl ?? config.portalUrl;

  try {
    const raw = await withRetry(
      () => withTimeout(
        () => sippy.getSippyCDRs(
          config.username, config.password, maxRows,
          { startDate: startStr, endDate: endStr },
          portalUrl,
        ),
        CDR_FETCH_TIMEOUT_MS,
      ),
      { maxAttempts: 2 },
    );

    const cdrs = (raw ?? []).map(normalizeCdr);
    await auditLog({
      operationType: 'cdr_sync',
      portalUrl: config.portalUrl,
      params: { count: cdrs.length, source: 'xmlrpc' },
      result: 'success',
      durationMs: Date.now() - t0,
    });
    return { cdrs, source: 'xmlrpc', count: cdrs.length };

  } catch (xmlrpcErr) {
    // Fallback to portal scraping
    try {
      const scraped = await withTimeout(
        () => sippy.scrapePortalCDRsAll(portalUrl, config.username, config.password),
        CDR_FETCH_TIMEOUT_MS,
      );
      const cdrs = (scraped ?? []).map(normalizeCdr);
      await auditLog({
        operationType: 'cdr_sync',
        portalUrl: config.portalUrl,
        params: { count: cdrs.length, source: 'portal', fallbackReason: (xmlrpcErr as Error).message },
        result: 'success',
        durationMs: Date.now() - t0,
      });
      return { cdrs, source: 'portal', count: cdrs.length };
    } catch (portalErr) {
      const err = normalizeSippyError(portalErr, 'syncCdrs[portal]');
      await auditLog({
        operationType: 'cdr_sync',
        portalUrl: config.portalUrl,
        result: 'failure',
        errorMessage: err.message,
        durationMs: Date.now() - t0,
      });
      throw new SippyCdrError(`CDR sync failed (both XML-RPC and portal): ${err.message}`);
    }
  }
}

/**
 * Fetch Mera (vendor CDR) records for vendor cost enrichment.
 */
export async function syncVendorCdrs(
  config: SippyConfig,
  opts: {
    startDate?: Date;
    endDate?:   Date;
  } = {},
): Promise<unknown[]> {
  const start = opts.startDate ?? hoursAgo(CDR_DEFAULT_WINDOW_HOURS);
  const end   = opts.endDate   ?? new Date();
  try {
    const result = await withTimeout(
      () => sippy.exportVendorsCDRsMera(
        config.username, config.password, toSippyDateStr(start), toSippyDateStr(end), config.portalUrl,
      ),
      CDR_FETCH_TIMEOUT_MS,
    );
    return result ?? [];
  } catch (err) {
    throw normalizeSippyError(err, 'syncVendorCdrs');
  }
}

// ── CDR normalization ─────────────────────────────────────────────────────────

/**
 * Normalize a raw Sippy CDR object to a consistent SippyCDR shape.
 * This is the canonical normalization pipeline — deterministic.
 */
export function normalizeCdr(raw: Record<string, unknown>): SippyCDR {
  return {
    callId:        String(raw?.callId       ?? raw?.call_id        ?? raw?.i_call        ?? ''),
    caller:        String(raw?.caller       ?? raw?.cli            ?? raw?.from           ?? ''),
    callee:        String(raw?.callee       ?? raw?.cld            ?? raw?.to             ?? ''),
    startTime:     String(raw?.startTime    ?? raw?.setup_time     ?? raw?.start_time     ?? ''),
    connectTime:   raw?.connectTime   ? String(raw.connectTime)   : raw?.connect_time  ? String(raw.connect_time)  : undefined,
    endTime:       raw?.endTime       ? String(raw.endTime)       : raw?.disconnect_time ? String(raw.disconnect_time) : undefined,
    duration:      Number(raw?.duration      ?? raw?.total_duration ?? 0),
    totalDuration: Number(raw?.totalDuration ?? raw?.total_duration ?? raw?.duration ?? 0),
    billDuration:  Number(raw?.billDuration  ?? raw?.bill_duration  ?? 0),
    cost:          parseFloat(String(raw?.cost   ?? 0)) || 0,
    price:         parseFloat(String(raw?.price  ?? 0)) || 0,
    result:        String(raw?.result        ?? raw?.disconnect_cause ?? ''),
    codec:         raw?.codec        ? String(raw.codec)         : undefined,
    remoteIp:      raw?.remoteIp     ? String(raw.remoteIp)     : raw?.remote_ip  ? String(raw.remote_ip) : undefined,
    iAccount:      raw?.iAccount     ? String(raw.iAccount)     : raw?.i_account  ? String(raw.i_account) : undefined,
    iCustomer:     raw?.iCustomer    ? String(raw.iCustomer)    : raw?.i_customer ? String(raw.i_customer) : undefined,
    clientName:    raw?.clientName   ? String(raw.clientName)   : undefined,
    vendorName:    raw?.vendorName   ? String(raw.vendorName)   : undefined,
    pdd:           raw?.pdd          ? Number(raw.pdd)          : undefined,
    mos:           raw?.mos          ? Number(raw.mos)          : undefined,
    jitter:        raw?.jitter       ? Number(raw.jitter)       : undefined,
    packetLoss:    raw?.packetLoss   ? Number(raw.packetLoss)   : raw?.packet_loss ? Number(raw.packet_loss) : undefined,
    dispositionSource: raw?.dispositionSource ? String(raw.dispositionSource) : undefined,
    ...Object.fromEntries(
      Object.entries(raw).filter(([k]) => !KNOWN_CDR_KEYS.has(k)),
    ),
  };
}

// ── CDR aggregation ───────────────────────────────────────────────────────────

/**
 * Aggregate CDRs by prefix — groups call volume, cost, and revenue by destination prefix.
 * Prefix matching is applied at the specified prefix length (default: 3 digits).
 */
export function aggregateCdrsByPrefix(
  cdrs: SippyCDR[],
  prefixLength = 3,
): Map<string, {
  prefix:        string;
  callCount:     number;
  answeredCount: number;
  totalDuration: number;
  totalCost:     number;
  totalPrice:    number;
  asr:           number;
}> {
  const buckets = new Map<string, {
    prefix: string; callCount: number; answeredCount: number;
    totalDuration: number; totalCost: number; totalPrice: number;
  }>();

  for (const cdr of cdrs) {
    const callee = normalizePrefix(cdr.callee ?? '');
    const prefix = callee.slice(0, prefixLength);
    if (!prefix) continue;

    const existing = buckets.get(prefix) ?? {
      prefix, callCount: 0, answeredCount: 0,
      totalDuration: 0, totalCost: 0, totalPrice: 0,
    };
    existing.callCount++;
    if ((cdr.totalDuration ?? 0) > 0) existing.answeredCount++;
    existing.totalDuration += cdr.totalDuration ?? 0;
    existing.totalCost     += cdr.cost          ?? 0;
    existing.totalPrice    += cdr.price         ?? 0;
    buckets.set(prefix, existing);
  }

  const result = new Map<string, ReturnType<typeof aggregateCdrsByPrefix> extends Map<any, infer V> ? V : never>();
  for (const [k, v] of buckets) {
    result.set(k, {
      ...v,
      asr: v.callCount > 0 ? Math.round((v.answeredCount / v.callCount) * 100) : 0,
    });
  }
  return result as any;
}

/**
 * Filter CDRs by callee prefix — used for destination-specific analytics.
 */
export function getCdrsByPrefix(cdrs: SippyCDR[], prefix: string): SippyCDR[] {
  const norm = normalizePrefix(prefix);
  return cdrs.filter(cdr => normalizePrefix(cdr.callee ?? '').startsWith(norm));
}

// ── Internal constants ────────────────────────────────────────────────────────

const KNOWN_CDR_KEYS = new Set([
  'callId', 'call_id', 'i_call', 'caller', 'cli', 'from',
  'callee', 'cld', 'to', 'startTime', 'setup_time', 'start_time',
  'connectTime', 'connect_time', 'endTime', 'disconnect_time',
  'duration', 'totalDuration', 'total_duration', 'billDuration', 'bill_duration',
  'cost', 'price', 'result', 'disconnect_cause', 'codec',
  'remoteIp', 'remote_ip', 'iAccount', 'i_account',
  'iCustomer', 'i_customer', 'clientName', 'vendorName',
  'pdd', 'mos', 'jitter', 'packetLoss', 'packet_loss',
  'dispositionSource',
]);
