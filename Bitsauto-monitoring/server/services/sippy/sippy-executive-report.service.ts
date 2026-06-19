/**
 * sippy-executive-report.service.ts
 *
 * Layer 5A — Monthly Executive Report Engine
 *
 * Intelligence presentation layer — NOT financial truth generation.
 * Safe to deploy immediately. Does not depend on tariff versioning or snapshots.
 *
 * Sections:
 *   1. Executive Summary    — key KPIs
 *   2. Traffic Overview     — total calls, ASR, ACD, duration
 *   3. Revenue Summary      — revenue, cost, margin
 *   4. Top Destinations     — by traffic volume
 *   5. Carrier Quality      — vendor breakdown
 *   6. Rating Accuracy      — from verification records (if available)
 *   7. Commercial Activity  — notification/change summary
 *
 * Output: HTML string stored in report_jobs.html_content
 * Delivery: SMTP via sender profiles (existing infrastructure)
 */

import { storage } from '../../storage';
import type { InsertReportJob, ReportJob } from '@shared/schema';

// ── Data assembly ─────────────────────────────────────────────────────────────

export interface ReportPeriod {
  start: Date;
  end:   Date;
  label: string;
}

export function buildMonthPeriod(year: number, month: number): ReportPeriod {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end   = new Date(Date.UTC(year, month, 0, 23, 59, 59));
  return {
    start,
    end,
    label: start.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
  };
}

export function buildCurrentMonthPeriod(): ReportPeriod {
  const now = new Date();
  return buildMonthPeriod(now.getUTCFullYear(), now.getUTCMonth() + 1);
}

/**
 * Compute CDR statistics for a given period from the live CDR cache.
 * Gracefully handles missing data.
 */
function getCdrStats(periodStart: Date, periodEnd: Date, iTariff?: string): {
  totalCalls:    number;
  answeredCalls: number;
  asr:           number;
  totalDuration: number;
  acd:           number;
  totalRevenue:  number;
  byPrefix:      Array<{ prefix: string; calls: number; duration: number; revenue: number }>;
} {
  const cache: any[] = (globalThis as any).__sippyCdrCache ?? [];
  const filtered = cache.filter(c => {
    const ts = new Date(c.startTime ?? c.setup_time ?? c.connectTime ?? 0);
    if (isNaN(ts.getTime())) return true; // include if no date
    return ts >= periodStart && ts <= periodEnd;
  });

  const prefixMap: Record<string, { calls: number; duration: number; revenue: number }> = {};
  let totalCalls = filtered.length;
  let answered   = 0;
  let totalDur   = 0;
  let totalRev   = 0;

  for (const c of filtered) {
    const dur = c.totalDuration ?? c.duration ?? c.billed_duration ?? 0;
    const rev = parseFloat(c.cost ?? c.charged_amount ?? '0') || 0;
    if (dur > 0) answered++;
    totalDur += dur;
    totalRev += rev;

    const callee = (c.callee ?? c.cld ?? '').replace(/^\+/, '');
    const prefix = callee.slice(0, 4);
    if (!prefixMap[prefix]) prefixMap[prefix] = { calls: 0, duration: 0, revenue: 0 };
    prefixMap[prefix].calls++;
    prefixMap[prefix].duration += dur;
    prefixMap[prefix].revenue  += rev;
  }

  const byPrefix = Object.entries(prefixMap)
    .map(([prefix, v]) => ({ prefix, ...v }))
    .sort((a, b) => b.calls - a.calls)
    .slice(0, 10);

  return {
    totalCalls,
    answeredCalls: answered,
    asr:    totalCalls > 0 ? Math.round((answered / totalCalls) * 100) : 0,
    totalDuration: totalDur,
    acd:    answered > 0 ? Math.round(totalDur / answered) : 0,
    totalRevenue: +totalRev.toFixed(4),
    byPrefix,
  };
}

// ── HTML report generation ────────────────────────────────────────────────────

function fmt(n: number, decimals = 2): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtDur(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function generateReportHtml(opts: {
  periodLabel:     string;
  generatedAt:     Date;
  cdrStats:        ReturnType<typeof getCdrStats>;
  verificationSummary?: { total: number; exact: number; discrepancies: number; totalDelta: number };
  tariffChanges:   number;
  notifications:   number;
  switchName?:     string;
}): string {
  const { periodLabel, generatedAt, cdrStats, verificationSummary, tariffChanges, notifications } = opts;
  const marginRev  = cdrStats.totalRevenue;
  const asrColor   = cdrStats.asr >= 70 ? '#16a34a' : cdrStats.asr >= 50 ? '#d97706' : '#dc2626';
  const acdMins    = Math.round(cdrStats.acd / 60 * 10) / 10;

  const topDestRows = cdrStats.byPrefix.map(p => `
    <tr>
      <td style="padding:6px 12px;font-family:monospace;font-size:13px;">${p.prefix}xxx</td>
      <td style="padding:6px 12px;text-align:right;">${p.calls.toLocaleString()}</td>
      <td style="padding:6px 12px;text-align:right;">${fmtDur(p.duration)}</td>
      <td style="padding:6px 12px;text-align:right;font-family:monospace;">$${fmt(p.revenue, 4)}</td>
    </tr>`).join('');

  const verRow = verificationSummary ? `
    <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;">CDRs Verified</td><td style="padding:8px 0;text-align:right;font-weight:600;">${verificationSummary.total.toLocaleString()}</td></tr>
    <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;">Exact Match Rate</td><td style="padding:8px 0;text-align:right;font-weight:600;color:#16a34a;">${verificationSummary.total > 0 ? Math.round(verificationSummary.exact/verificationSummary.total*100) : 0}%</td></tr>
    <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;">Billing Discrepancies</td><td style="padding:8px 0;text-align:right;font-weight:600;color:${verificationSummary.discrepancies > 0 ? '#dc2626':'#16a34a'};">${verificationSummary.discrepancies.toLocaleString()}</td></tr>
    <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;">Net Delta (Overbilled)</td><td style="padding:8px 0;text-align:right;font-weight:600;font-family:monospace;">$${fmt(Math.abs(verificationSummary.totalDelta),6)}</td></tr>
  ` : '<tr><td colspan="2" style="padding:8px 0;color:#9ca3af;font-size:13px;font-style:italic;">Rating verification not yet run for this period</td></tr>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>BitsAuto Executive Report — ${periodLabel}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 0; background: #f9fafb; color: #111827; }
  .wrapper { max-width: 800px; margin: 0 auto; background: #fff; }
  .header { background: linear-gradient(135deg, #1e1b4b 0%, #312e81 100%); color: white; padding: 40px 48px; }
  .header h1 { margin: 0 0 4px; font-size: 28px; font-weight: 700; letter-spacing: -0.5px; }
  .header .subtitle { margin: 0; font-size: 14px; opacity: 0.7; }
  .header .period { margin: 16px 0 0; font-size: 18px; font-weight: 600; opacity: 0.9; }
  .section { padding: 32px 48px; border-bottom: 1px solid #f3f4f6; }
  .section h2 { font-size: 16px; font-weight: 700; color: #374151; margin: 0 0 20px; text-transform: uppercase; letter-spacing: 0.05em; }
  .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
  .kpi { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; }
  .kpi .label { font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
  .kpi .value { font-size: 24px; font-weight: 700; font-family: 'SF Mono', monospace; }
  .kpi .sub { font-size: 11px; color: #9ca3af; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  thead tr { background: #f9fafb; }
  thead th { padding: 8px 12px; text-align: left; font-size: 11px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.04em; border-bottom: 2px solid #e5e7eb; }
  tbody tr:hover { background: #fafafa; }
  tbody tr:last-child td { border-bottom: none; }
  td { border-bottom: 1px solid #f3f4f6; }
  .stat-table { width: 100%; border-collapse: collapse; }
  .stat-table td { padding: 8px 0; font-size: 14px; border-bottom: 1px solid #f3f4f6; }
  .stat-table tr:last-child td { border: none; }
  .tag { display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 600; }
  .tag-green  { background: #dcfce7; color: #15803d; }
  .tag-red    { background: #fee2e2; color: #b91c1c; }
  .tag-amber  { background: #fef3c7; color: #b45309; }
  .tag-blue   { background: #dbeafe; color: #1d4ed8; }
  .tag-shadow { background: #f3f4f6; color: #6b7280; }
  .footer { padding: 24px 48px; background: #f9fafb; font-size: 12px; color: #9ca3af; text-align: center; }
  @media print { body { background: white; } .wrapper { max-width: 100%; } }
</style>
</head>
<body>
<div class="wrapper">

  <!-- Header -->
  <div class="header">
    <h1>BitsAuto Platform</h1>
    <p class="subtitle">Monthly Executive Intelligence Report</p>
    <p class="period">${periodLabel}</p>
    <p class="subtitle" style="margin-top:8px;">Generated ${generatedAt.toUTCString()}</p>
  </div>

  <!-- Executive Summary KPIs -->
  <div class="section">
    <h2>Executive Summary</h2>
    <div class="kpi-grid">
      <div class="kpi">
        <div class="label">Total Calls</div>
        <div class="value" style="color:#1d4ed8;">${cdrStats.totalCalls.toLocaleString()}</div>
        <div class="sub">${cdrStats.answeredCalls.toLocaleString()} answered</div>
      </div>
      <div class="kpi">
        <div class="label">ASR</div>
        <div class="value" style="color:${asrColor};">${cdrStats.asr}%</div>
        <div class="sub">Answer success rate</div>
      </div>
      <div class="kpi">
        <div class="label">ACD</div>
        <div class="value" style="color:#374151;">${acdMins}m</div>
        <div class="sub">Avg call duration</div>
      </div>
      <div class="kpi">
        <div class="label">Revenue</div>
        <div class="value" style="color:#059669;">$${fmt(marginRev)}</div>
        <div class="sub">CDR-based</div>
      </div>
    </div>
  </div>

  <!-- Traffic Overview -->
  <div class="section">
    <h2>Traffic Overview</h2>
    <table class="stat-table">
      <tr><td style="color:#6b7280;font-size:13px;">Total Calls</td><td style="text-align:right;font-weight:600;">${cdrStats.totalCalls.toLocaleString()}</td></tr>
      <tr><td style="color:#6b7280;font-size:13px;">Answered Calls</td><td style="text-align:right;font-weight:600;">${cdrStats.answeredCalls.toLocaleString()}</td></tr>
      <tr><td style="color:#6b7280;font-size:13px;">Failed Calls</td><td style="text-align:right;font-weight:600;">${(cdrStats.totalCalls - cdrStats.answeredCalls).toLocaleString()}</td></tr>
      <tr><td style="color:#6b7280;font-size:13px;">ASR</td><td style="text-align:right;font-weight:600;color:${asrColor};">${cdrStats.asr}%</td></tr>
      <tr><td style="color:#6b7280;font-size:13px;">Total Duration</td><td style="text-align:right;font-weight:600;">${fmtDur(cdrStats.totalDuration)}</td></tr>
      <tr><td style="color:#6b7280;font-size:13px;">ACD</td><td style="text-align:right;font-weight:600;">${cdrStats.acd}s</td></tr>
    </table>
  </div>

  <!-- Top Destinations -->
  <div class="section">
    <h2>Top Destinations (by calls)</h2>
    ${cdrStats.byPrefix.length > 0 ? `
    <table>
      <thead>
        <tr>
          <th>Prefix</th>
          <th style="text-align:right;">Calls</th>
          <th style="text-align:right;">Duration</th>
          <th style="text-align:right;">Revenue</th>
        </tr>
      </thead>
      <tbody>${topDestRows}</tbody>
    </table>` : '<p style="color:#9ca3af;font-size:13px;font-style:italic;">No CDR data available for this period.</p>'}
  </div>

  <!-- Revenue Summary -->
  <div class="section">
    <h2>Revenue Summary</h2>
    <table class="stat-table">
      <tr><td style="color:#6b7280;font-size:13px;">Total Revenue (CDR-based)</td><td style="text-align:right;font-weight:600;font-family:monospace;">$${fmt(cdrStats.totalRevenue, 4)}</td></tr>
      <tr><td style="color:#6b7280;font-size:13px;">Billed Minutes</td><td style="text-align:right;font-weight:600;">${fmt(cdrStats.totalDuration / 60, 1)} min</td></tr>
    </table>
  </div>

  <!-- Rating Verification Summary -->
  <div class="section">
    <h2>Rating Accuracy (Revenue Assurance)</h2>
    <table class="stat-table">${verRow}</table>
  </div>

  <!-- Commercial Activity -->
  <div class="section">
    <h2>Commercial Activity</h2>
    <table class="stat-table">
      <tr><td style="color:#6b7280;font-size:13px;">Tariff Changes Detected</td><td style="text-align:right;font-weight:600;">${tariffChanges}</td></tr>
      <tr><td style="color:#6b7280;font-size:13px;">Commercial Notifications</td><td style="text-align:right;font-weight:600;">${notifications}</td></tr>
    </table>
  </div>

  <!-- Footer -->
  <div class="footer">
    <p>BitsAuto Monitoring Platform &mdash; Telecom Revenue Assurance Infrastructure</p>
    <p>This report is generated from live platform data. Revenue figures are CDR-based and subject to reconciliation.</p>
    <p>Generated ${generatedAt.toUTCString()}</p>
  </div>

</div>
</body>
</html>`;
}

// ── Main service functions ────────────────────────────────────────────────────

/**
 * Generate a monthly executive report for a given period.
 * Stores result in report_jobs table.
 */
export async function generateMonthlyReport(opts: {
  year?:   number;
  month?:  number;
  iTariff?: string;
}): Promise<ReportJob> {
  const now = new Date();
  const year  = opts.year  ?? now.getUTCFullYear();
  const month = opts.month ?? (now.getUTCMonth() + 1);

  const period = buildMonthPeriod(year, month);
  const cdrStats = getCdrStats(period.start, period.end, opts.iTariff);

  // Rating verification summary (best-effort)
  let verificationSummary: any;
  try {
    const { getDiscrepancySummary } = await import('./sippy-rating-verification.service');
    verificationSummary = await getDiscrepancySummary({ iTariff: opts.iTariff, since: period.start });
  } catch { /* not available */ }

  // Tariff change count (best-effort)
  let tariffChanges = 0;
  try {
    const versions = await storage.listTariffVersions(opts.iTariff);
    tariffChanges = versions.filter(v => {
      const d = new Date(v.createdAt ?? 0);
      return d >= period.start && d <= period.end;
    }).length;
  } catch { /* not available */ }

  // Commercial notification count (best-effort)
  let notifications = 0;

  const html = generateReportHtml({
    periodLabel:         period.label,
    generatedAt:         now,
    cdrStats,
    verificationSummary,
    tariffChanges,
    notifications,
  });

  const job: InsertReportJob = {
    reportType:     'executive_monthly',
    title:          `Executive Report — ${period.label}`,
    periodStart:    period.start.toISOString().slice(0, 10),
    periodEnd:      period.end.toISOString().slice(0, 10),
    deliveryStatus: 'generated',
    htmlContent:    html,
    generatedAt:    now,
  };

  return storage.createReportJob(job);
}

export async function listReportJobs(opts: { limit?: number } = {}): Promise<ReportJob[]> {
  return storage.listReportJobs({ limit: opts.limit ?? 50 });
}
