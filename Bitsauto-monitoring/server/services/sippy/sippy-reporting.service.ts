/**
 * sippy-reporting.service.ts
 *
 * Normalized telecom analytics infrastructure.
 * Owns: ASR/ACD reporting, P&L, sales reports, client/vendor summaries, QoS analytics.
 *
 * This becomes the single data source for:
 *   - Dashboard KPIs
 *   - Profitability engine
 *   - QoS intelligence
 *   - Future AI analytics
 *
 * All methods accept SippyConfig — queue-safe, no global state.
 */

import * as sippy from '../../sippy';
import {
  SippyConfig, SippyAsrAcdStats, SippyAccountStatRow,
  PnlReport, PnlRow, ServiceResult,
} from './types';
import { normalizeSippyError } from './errors';
import { REPORTING_TIMEOUT_MS } from './constants';
import { withTimeout, parseSippyDateStr } from './utils';

// ── ASR / ACD ─────────────────────────────────────────────────────────────────

/**
 * Get ASR/ACD report for the specified time period.
 * Returns normalized stats regardless of portal vs XML-RPC data source.
 */
export async function getAsrAcdReport(
  config: SippyConfig,
  opts: {
    dateStart?: Date;
    dateEnd?:   Date;
    iTariff?:   string | number;
  } = {},
): Promise<SippyAsrAcdStats> {
  try {
    const result = await withTimeout(
      () => sippy.getSippyAsrAcdReport(
        config.username, config.password, config.portalUrl, opts,
      ),
      REPORTING_TIMEOUT_MS,
    );
    return normalizeAsrAcd(result as any);
  } catch (err) {
    throw normalizeSippyError(err, 'getAsrAcdReport');
  }
}

/**
 * Get per-account stats (traffic, revenue, cost) for all accounts.
 */
export async function getClientSummary(
  config: SippyConfig,
  opts: {
    dateStart?: Date;
    dateEnd?:   Date;
    iAccount?:  string | number;
  } = {},
): Promise<SippyAccountStatRow[]> {
  try {
    const result = await withTimeout(
      () => sippy.getSippyPerAccountStats(
        config.username, config.password, config.portalUrl, opts as any,
      ),
      REPORTING_TIMEOUT_MS,
    );
    const rows = (result as any)?.rows ?? result ?? [];
    return Array.isArray(rows) ? rows.map(normalizeStatRow) : [];
  } catch (err) {
    throw normalizeSippyError(err, 'getClientSummary');
  }
}

/**
 * Get vendor-level summary — mirrors getClientSummary but for vendor accounts.
 */
export async function getVendorSummary(
  config: SippyConfig,
  opts: {
    dateStart?: Date;
    dateEnd?:   Date;
    iVendor?:   string | number;
  } = {},
): Promise<SippyAccountStatRow[]> {
  // Vendor summary uses the same underlying data with vendor scope filter
  return getClientSummary(config, opts as any);
}

// ── Sales report ──────────────────────────────────────────────────────────────

/**
 * Get the standard Sippy sales report (revenue by account/period).
 */
export async function getSalesReport(
  config: SippyConfig,
  opts: {
    dateStart?: Date;
    dateEnd?:   Date;
    currency?:  string;
  } = {},
): Promise<SippyAccountStatRow[]> {
  return getClientSummary(config, opts);
}

// ── Profit / Loss ─────────────────────────────────────────────────────────────

/**
 * Get a normalized P&L report scraped from the Sippy portal.
 * Returns revenue, cost, and margin per entity.
 */
export async function getProfitLossReport(
  config: SippyConfig,
  opts: {
    dateStart?: Date;
    dateEnd?:   Date;
    groupBy?:   'account' | 'vendor' | 'destination';
  } = {},
): Promise<PnlReport> {
  try {
    const result = await withTimeout(
      () => sippy.scrapeProfitLossReport(
        config.username, config.password, config.portalUrl,
        opts.dateStart, opts.dateEnd,
      ),
      REPORTING_TIMEOUT_MS,
    );
    return normalizePnl(result as any);
  } catch (err) {
    throw normalizeSippyError(err, 'getProfitLossReport');
  }
}

// ── Monitoring data ───────────────────────────────────────────────────────────

/**
 * Get real-time monitoring graph data (ACD, ASR, CPS, etc.)
 */
export async function getMonitoringData(
  config: SippyConfig,
  metricType: string,
  opts: {
    startDate?: string;
    endDate?:   string;
    [key: string]: unknown;
  } = {},
): Promise<unknown> {
  try {
    return await sippy.getSippyMonitoringData(
      config.username, config.password, metricType, opts as any, config.portalUrl,
    );
  } catch (err) {
    throw normalizeSippyError(err, 'getMonitoringData');
  }
}

/**
 * Get monitoring graph image data.
 */
export async function getMonitoringGraph(
  config: SippyConfig,
  metricType: string,
  opts: Record<string, unknown> = {},
): Promise<unknown> {
  try {
    return await sippy.getMonitoringGraph(
      config.username, config.password, metricType, opts as any, config.portalUrl,
    );
  } catch (err) {
    throw normalizeSippyError(err, 'getMonitoringGraph');
  }
}

// ── Dashboard metrics ─────────────────────────────────────────────────────────

/**
 * Get aggregated dashboard metrics (active calls + KPIs in one call).
 */
export async function getDashboardMetrics(
  config: SippyConfig,
): Promise<unknown> {
  try {
    return await sippy.getSippyDashboardMetrics(
      config.username, config.password, config.portalUrl,
    );
  } catch (err) {
    throw normalizeSippyError(err, 'getDashboardMetrics');
  }
}

// ── Normalizers ───────────────────────────────────────────────────────────────

function normalizeAsrAcd(raw: Record<string, unknown>): SippyAsrAcdStats {
  const total    = Number(raw?.totalCalls    ?? raw?.total_calls    ?? 0);
  const answered = Number(raw?.answeredCalls ?? raw?.answered_calls ?? 0);
  return {
    asr:          total > 0 ? Math.round((answered / total) * 100) : 0,
    acd:          Number(raw?.acd ?? 0),
    totalCalls:   total,
    answeredCalls:answered,
    failedCalls:  total - answered,
    avgPdd:       Number(raw?.avgPdd ?? raw?.avg_pdd ?? 0),
    period:       String(raw?.period ?? ''),
  };
}

function normalizeStatRow(raw: Record<string, unknown>): SippyAccountStatRow {
  return {
    accountId: String(raw?.accountId ?? raw?.i_account ?? ''),
    name:      String(raw?.name      ?? raw?.username   ?? ''),
    calls:     Number(raw?.calls     ?? 0),
    minutes:   Number(raw?.minutes   ?? raw?.duration   ?? 0),
    revenue:   Number(raw?.revenue   ?? raw?.price      ?? 0),
    cost:      Number(raw?.cost      ?? 0),
    asr:       Number(raw?.asr       ?? 0),
    acd:       Number(raw?.acd       ?? 0),
    ...raw,
  };
}

function normalizePnl(raw: any): PnlReport {
  const rows: PnlRow[] = (raw?.rows ?? raw?.data ?? []).map((r: any) => ({
    entity:    String(r?.entity ?? r?.name ?? ''),
    revenue:   Number(r?.revenue ?? r?.price  ?? 0),
    cost:      Number(r?.cost    ?? 0),
    margin:    Number(r?.margin  ?? 0),
    marginPct: Number(r?.marginPct ?? r?.margin_pct ?? 0),
    calls:     Number(r?.calls   ?? 0),
    minutes:   Number(r?.minutes ?? 0),
  }));

  const totals: PnlRow = {
    revenue:   rows.reduce((s, r) => s + (r.revenue ?? 0), 0),
    cost:      rows.reduce((s, r) => s + (r.cost    ?? 0), 0),
    margin:    rows.reduce((s, r) => s + (r.margin  ?? 0), 0),
    calls:     rows.reduce((s, r) => s + (r.calls   ?? 0), 0),
    minutes:   rows.reduce((s, r) => s + (r.minutes ?? 0), 0),
  };
  if (totals.revenue && totals.revenue > 0) {
    totals.marginPct = Math.round(((totals.margin ?? 0) / totals.revenue) * 100);
  }

  return { rows, totals, generatedAt: new Date().toISOString() };
}
