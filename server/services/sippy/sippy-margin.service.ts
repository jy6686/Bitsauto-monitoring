/**
 * sippy-margin.service.ts
 *
 * Margin Intelligence Engine
 *
 * Materializes telecom commercial profitability analytics from DMR data.
 * Provides per-client, per-vendor, and aggregate margin truth.
 *
 * Cost allocation strategy:
 *   - Client revenue: directly from DMR per-client sippyAmount (sell-side)
 *   - Vendor cost: directly from DMR per-vendor sippyAmount (buy-side)
 *   - Per-client cost: pro-rata allocation (client revenue share × total buy)
 *   - Aggregate margin: authoritative from DMR __AGGREGATE__ row
 *
 * Alert thresholds:
 *   negative_margin   — margin% < 0
 *   threshold_breach  — margin% < MIN_MARGIN_PCT (default 5%)
 *   margin_drop       — margin% dropped > 8pp vs prior day
 *   vendor_cost_spike — vendor cost increased > 20% vs prior day
 */

import { storage } from '../../storage';
import type { InsertMarginAnalyticsDaily, InsertMarginAlert } from '@shared/schema';

// ── Alert thresholds ──────────────────────────────────────────────────────────
const MIN_MARGIN_PCT      =  5.0;   // below 5% → threshold_breach
const MARGIN_DROP_PP      =  8.0;   // dropped 8 percentage points → margin_drop
const VENDOR_COST_SPIKE   = 20.0;   // vendor cost up >20% → vendor_cost_spike

// ── Materialize margin for a specific date ─────────────────────────────────────

export interface MaterializeResult {
  date:            string;
  clientRows:      number;
  vendorRows:      number;
  alertsGenerated: number;
  aggregateMargin: number | null;
  errors:          string[];
}

export async function materializeMargin(
  targetDate: Date,
): Promise<MaterializeResult> {
  const dateStr = targetDate.toISOString().slice(0, 10);
  const errors: string[] = [];

  // ── Read DMR data for the date ────────────────────────────────────────────
  const dmrRows = await storage.listDMRReports({
    reportDate: dateStr,
    latestVersionOnly: true,
  });

  const clientRows = dmrRows.filter(r => r.accountName && r.accountName !== '__AGGREGATE__' && !r.vendorName);
  const vendorRows = dmrRows.filter(r => r.vendorName && !r.accountName);
  const aggRow     = dmrRows.find(r => r.accountName === '__AGGREGATE__');

  // ── Totals from aggregate row or summation ────────────────────────────────
  const totalSell = aggRow?.sellAmount
    ?? clientRows.reduce((s, r) => s + (r.sippyAmount ?? 0), 0);
  const totalBuy = aggRow?.buyAmount
    ?? vendorRows.reduce((s, r) => s + (r.sippyAmount ?? 0), 0);
  const totalMargin = totalSell - totalBuy;
  const totalMarginPct = totalSell > 0 ? (totalMargin / totalSell) * 100 : 0;

  // ── Delete existing analytics for this date (re-materialize) ─────────────
  await storage.deleteMarginAnalyticsForDate(dateStr);

  const toInsert: InsertMarginAnalyticsDaily[] = [];

  // ── Client rows (sell-side, pro-rata cost allocation) ─────────────────────
  for (const c of clientRows) {
    const rev = c.sippyAmount ?? 0;
    const costShare = totalSell > 0 ? (rev / totalSell) : 0;
    const cost = totalBuy * costShare;
    const margin = rev - cost;
    const marginPct = rev > 0 ? (margin / rev) * 100 : 0;

    toInsert.push({
      date:           dateStr,
      dimensionType:  'client',
      dimensionId:    c.accountId ?? undefined,
      dimensionName:  c.accountName!,
      revenueUsd:     +rev.toFixed(4),
      costUsd:        +cost.toFixed(4),
      marginUsd:      +margin.toFixed(4),
      marginPct:      +marginPct.toFixed(2),
      durationSec:    c.sippyDuration ?? undefined,
      calls:          c.sippyCalls ?? undefined,
      asr:            c.asr ?? undefined,
      acd:            c.acd ?? undefined,
      source:         'dmr',
    });
  }

  // ── Vendor rows (buy-side cost centers) ───────────────────────────────────
  for (const v of vendorRows) {
    const cost = v.sippyAmount ?? 0;
    // Vendors are pure cost; margin shown as negative of cost (they have no revenue)
    toInsert.push({
      date:           dateStr,
      dimensionType:  'vendor',
      dimensionId:    v.vendorId ?? undefined,
      dimensionName:  v.vendorName!,
      revenueUsd:     0,
      costUsd:        +cost.toFixed(4),
      marginUsd:      +(-cost).toFixed(4),
      marginPct:      null,
      durationSec:    v.sippyDuration ?? undefined,
      calls:          v.sippyCalls ?? undefined,
      asr:            v.asr ?? undefined,
      acd:            v.acd ?? undefined,
      source:         'dmr',
    });
  }

  // ── Aggregate row ─────────────────────────────────────────────────────────
  toInsert.push({
    date:          dateStr,
    dimensionType: 'aggregate',
    dimensionName: 'Platform Total',
    revenueUsd:    +totalSell.toFixed(4),
    costUsd:       +totalBuy.toFixed(4),
    marginUsd:     +totalMargin.toFixed(4),
    marginPct:     +totalMarginPct.toFixed(2),
    durationSec:   aggRow?.sippyDuration ?? undefined,
    calls:         aggRow?.sippyCalls ?? undefined,
    source:        'dmr',
  });

  const inserted = await storage.bulkInsertMarginAnalytics(toInsert);

  // ── Generate alerts ───────────────────────────────────────────────────────
  const alerts: InsertMarginAlert[] = [];

  // Aggregate alerts
  if (totalMarginPct < 0) {
    alerts.push({
      alertType:    'negative_margin',
      dimensionType: 'aggregate',
      dimensionName: 'Platform Total',
      date:          dateStr,
      thresholdPct:  0,
      actualPct:     +totalMarginPct.toFixed(2),
      amountUsd:     +totalMargin.toFixed(2),
      severity:      'critical',
      message:       `Platform margin is negative at ${totalMarginPct.toFixed(1)}% (${totalMargin.toFixed(2)} USD)`,
    });
  } else if (totalMarginPct < MIN_MARGIN_PCT) {
    alerts.push({
      alertType:    'threshold_breach',
      dimensionType: 'aggregate',
      dimensionName: 'Platform Total',
      date:          dateStr,
      thresholdPct:  MIN_MARGIN_PCT,
      actualPct:     +totalMarginPct.toFixed(2),
      amountUsd:     +totalMargin.toFixed(2),
      severity:      'high',
      message:       `Platform margin ${totalMarginPct.toFixed(1)}% is below ${MIN_MARGIN_PCT}% threshold`,
    });
  }

  // Per-client alerts (negative margin)
  for (const row of inserted.filter(r => r.dimensionType === 'client')) {
    const mp = row.marginPct ?? 0;
    if (mp < 0) {
      alerts.push({
        alertType:    'negative_margin',
        dimensionType: 'client',
        dimensionName: row.dimensionName,
        date:          dateStr,
        thresholdPct:  0,
        actualPct:     mp,
        amountUsd:     row.marginUsd ?? 0,
        severity:      'high',
        message:       `Client ${row.dimensionName} has negative margin: ${mp.toFixed(1)}%`,
      });
    }
  }

  // Check margin drop vs prior day
  const priorDate = new Date(targetDate.getTime() - 86400000).toISOString().slice(0, 10);
  const priorAggRows = await storage.getMarginAnalytics({ date: priorDate, dimensionType: 'aggregate' });
  const priorAgg = priorAggRows[0] ?? null;
  if (priorAgg && priorAgg.marginPct != null && totalMarginPct < priorAgg.marginPct - MARGIN_DROP_PP) {
    const drop = priorAgg.marginPct - totalMarginPct;
    alerts.push({
      alertType:    'margin_drop',
      dimensionType: 'aggregate',
      dimensionName: 'Platform Total',
      date:          dateStr,
      thresholdPct:  MARGIN_DROP_PP,
      actualPct:     +totalMarginPct.toFixed(2),
      deltaPct:      +drop.toFixed(2),
      amountUsd:     +totalMargin.toFixed(2),
      severity:      drop > 15 ? 'critical' : 'high',
      message:       `Margin dropped ${drop.toFixed(1)}pp vs prior day (${priorAgg.marginPct.toFixed(1)}% → ${totalMarginPct.toFixed(1)}%)`,
    });
  }

  if (alerts.length > 0) {
    await storage.bulkInsertMarginAlerts(alerts);
  }

  return {
    date:            dateStr,
    clientRows:      clientRows.length,
    vendorRows:      vendorRows.length,
    alertsGenerated: alerts.length,
    aggregateMargin: totalMargin,
    errors,
  };
}

// ── Trend — 30-day margin history ─────────────────────────────────────────────

export async function getMarginTrend(
  fromDate: string,
  toDate: string,
  dimensionType: 'client' | 'vendor' | 'aggregate' = 'aggregate',
  dimensionName?: string,
): Promise<Array<{ date: string; marginPct: number | null; marginUsd: number | null; revenueUsd: number | null; costUsd: number | null }>> {
  const rows = await storage.getMarginAnalytics({
    fromDate,
    toDate,
    dimensionType,
    dimensionName,
  });

  return rows
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(r => ({
      date:       r.date,
      marginPct:  r.marginPct,
      marginUsd:  r.marginUsd,
      revenueUsd: r.revenueUsd,
      costUsd:    r.costUsd,
    }));
}

// ── Top performers ────────────────────────────────────────────────────────────

export async function getTopClients(date: string, limit = 20): Promise<MarginRankRow[]> {
  const rows = await storage.getMarginAnalytics({ date, dimensionType: 'client' });
  return rows
    .sort((a, b) => (b.marginUsd ?? 0) - (a.marginUsd ?? 0))
    .slice(0, limit)
    .map(r => toRankRow(r));
}

export async function getTopVendors(date: string, limit = 20): Promise<MarginRankRow[]> {
  const rows = await storage.getMarginAnalytics({ date, dimensionType: 'vendor' });
  return rows
    .sort((a, b) => (a.costUsd ?? 0) - (b.costUsd ?? 0))  // ascending cost = most efficient
    .slice(0, limit)
    .map(r => toRankRow(r));
}

export interface MarginRankRow {
  dimensionName: string;
  dimensionId?:  string | null;
  revenueUsd:    number | null;
  costUsd:       number | null;
  marginUsd:     number | null;
  marginPct:     number | null;
  durationMin:   number | null;
  calls:         number | null;
  asr:           number | null;
  acd:           number | null;
  costPerMin:    number | null;
}

function toRankRow(r: any): MarginRankRow {
  const costPerMin = r.durationSec && r.costUsd
    ? (r.costUsd / (r.durationSec / 60))
    : null;
  return {
    dimensionName: r.dimensionName,
    dimensionId:   r.dimensionId,
    revenueUsd:    r.revenueUsd,
    costUsd:       r.costUsd,
    marginUsd:     r.marginUsd,
    marginPct:     r.marginPct,
    durationMin:   r.durationSec ? r.durationSec / 60 : null,
    calls:         r.calls,
    asr:           r.asr,
    acd:           r.acd,
    costPerMin,
  };
}
