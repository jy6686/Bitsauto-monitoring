/**
 * dmr-email.service.ts
 *
 * Daily Minutes Report (DMR) Email Service
 *
 * Generates and emails the DMR to the finance team daily.
 * Attachment: Excel (.xlsx) — preferred by finance for data analysis.
 * Recipients: alertAdminEmail + all active watcher_recipients.
 *
 * Entry points:
 *   sendDailyDMREmail(opts?)       — generate DMR for date (defaults to yesterday UTC),
 *                                    auto-verify, build Excel, send email with attachment.
 *   buildDMRExcel(rows, dateLabel) — standalone Excel builder for other callers.
 *   startDMREmailScheduler()       — fires at 07:00 UTC daily (call once on server boot).
 */

import * as XLSX from 'xlsx';
import { storage } from '../../storage';
import { sendDirectEmailWithAttachment, sendAlertEmail } from '../../email';
import type { DailyMinutesReport } from '@shared/schema';

// ── Excel builder ─────────────────────────────────────────────────────────────

export function buildDMRExcel(rows: DailyMinutesReport[], dateLabel: string): Buffer {
  const nonAgg = rows.filter(r => r.accountName !== '__AGGREGATE__');

  // Summary sheet
  const totalAmount  = nonAgg.reduce((s, r) => s + (r.sippyAmount  ?? 0), 0);
  const totalCalls   = nonAgg.reduce((s, r) => s + (r.sippyCalls   ?? 0), 0);
  const totalDurMin  = nonAgg.reduce((s, r) => s + (r.sippyDuration ?? 0), 0) / 60;
  const matched      = nonAgg.filter(r => r.verificationStatus === 'verified').length;
  const drifted      = nonAgg.filter(r => r.verificationStatus === 'drifted').length;
  const critical     = nonAgg.filter(r => r.verificationStatus === 'critical').length;

  const summaryRows: any[][] = [
    ['Report Date',      dateLabel],
    ['Generated At',     new Date().toUTCString()],
    [''],
    ['Total Amount ($)', +totalAmount.toFixed(4)],
    ['Total Calls',      totalCalls],
    ['Duration (min)',   +totalDurMin.toFixed(2)],
    [''],
    ['Matched',          matched],
    ['Drifted',          drifted],
    ['Critical',         critical],
    ['Total Accounts',   nonAgg.length],
  ];

  // Detail sheet
  const detailHeaders = [
    'Date', 'Account', 'Vendor', 'Sippy Calls', 'Sippy Duration (min)',
    'Sippy Amount ($)', 'Platform Amount ($)', 'Delta ($)',
    'Sell Amount ($)', 'Buy Amount ($)', 'Margin ($)', 'Margin %',
    'ASR (%)', 'ACD (s)', 'Discrepancy Type', 'Status', 'Source', 'Notes',
  ];

  const detailRows: any[][] = nonAgg.map(r => {
    const delta = (r.sippyAmount ?? 0) - (r.platformAmount ?? 0);
    return [
      r.reportDate,
      r.accountName     ?? '',
      r.vendorName      ?? '',
      r.sippyCalls      ?? 0,
      +((r.sippyDuration  ?? 0) / 60).toFixed(2),
      +(r.sippyAmount   ?? 0).toFixed(4),
      +(r.platformAmount ?? 0).toFixed(4),
      +delta.toFixed(4),
      +(r.sellAmount    ?? 0).toFixed(4),
      +(r.buyAmount     ?? 0).toFixed(4),
      +(r.marginAmount  ?? 0).toFixed(4),
      r.marginPct != null ? +(r.marginPct * 100).toFixed(2) : '',
      +(r.asr ?? 0).toFixed(2),
      +(r.acd ?? 0).toFixed(3),
      r.discrepancyType    ?? '',
      r.verificationStatus ?? '',
      r.source             ?? '',
      r.notes              ?? '',
    ];
  });

  // Build workbook
  const wb = XLSX.utils.book_new();

  // Sheet 1: Summary
  const wsSummary = XLSX.utils.aoa_to_sheet([
    [`DMR — ${dateLabel}`],
    [],
    ['Metric', 'Value'],
    ...summaryRows,
  ]);
  wsSummary['!cols'] = [{ wch: 22 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

  // Sheet 2: Detail
  const wsDetail = XLSX.utils.aoa_to_sheet([detailHeaders, ...detailRows]);
  const colWidths = detailHeaders.map((h, i) => {
    const maxLen = Math.max(h.length, ...detailRows.map(r => String(r[i] ?? '').length));
    return { wch: Math.min(Math.max(maxLen + 2, 10), 40) };
  });
  wsDetail['!cols'] = colWidths;
  XLSX.utils.book_append_sheet(wb, wsDetail, 'Detail');

  // Sheet 3: Raw (full data for audit)
  const allHeaders = Object.keys(rows[0] ?? {}) as string[];
  const allRows    = rows.map(r => allHeaders.map(k => (r as any)[k] ?? ''));
  const wsRaw = XLSX.utils.aoa_to_sheet([allHeaders, ...allRows]);
  wsRaw['!cols'] = allHeaders.map(() => ({ wch: 16 }));
  XLSX.utils.book_append_sheet(wb, wsRaw, 'Raw');

  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

// ── HTML email body ───────────────────────────────────────────────────────────

function buildDMREmailHtml(rows: DailyMinutesReport[], dateLabel: string): string {
  const nonAgg      = rows.filter(r => r.accountName !== '__AGGREGATE__');
  const totalAmount = nonAgg.reduce((s, r) => s + (r.sippyAmount  ?? 0), 0);
  const totalCalls  = nonAgg.reduce((s, r) => s + (r.sippyCalls   ?? 0), 0);
  const totalDurMin = nonAgg.reduce((s, r) => s + (r.sippyDuration ?? 0), 0) / 60;
  const matched     = nonAgg.filter(r => r.verificationStatus === 'verified').length;
  const drifted     = nonAgg.filter(r => r.verificationStatus === 'drifted').length;
  const critical    = nonAgg.filter(r => r.verificationStatus === 'critical').length;

  const bannerBg    = critical > 0 ? '#dc2626' : drifted > 0 ? '#d97706' : '#16a34a';
  const statusText  = critical > 0 ? `${critical} CRITICAL` : drifted > 0 ? `${drifted} Drifted` : 'All Clear ✓';

  // Only show exception rows in the table — keeps email short for All Clear days
  const exceptionRows = nonAgg.filter(r => r.verificationStatus !== 'verified');
  const showTable     = exceptionRows.length > 0;

  const exceptionRowsHtml = exceptionRows.map(r => {
    const color = r.verificationStatus === 'critical' ? '#dc2626' : '#d97706';
    const delta = (r.sippyAmount ?? 0) - (r.platformAmount ?? 0);
    return `
      <tr style="border-bottom:1px solid #f0f0f0">
        <td style="padding:6px 10px;font-weight:500">${r.accountName ?? ''}</td>
        <td style="padding:6px 10px;text-align:right">$${(r.sippyAmount ?? 0).toFixed(2)}</td>
        <td style="padding:6px 10px;text-align:right;color:#dc2626">$${Math.abs(delta).toFixed(2)}</td>
        <td style="padding:6px 10px"><span style="color:${color};font-weight:700;font-size:11px">${(r.verificationStatus ?? '').toUpperCase()}</span></td>
        <td style="padding:6px 10px;font-size:11px;color:#6b7280">${r.discrepancyType ?? ''}</td>
      </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html>
<body style="font-family:Arial,sans-serif;color:#1a1a2e;margin:0;padding:0;background:#f8f9fa">
  <div style="max-width:600px;margin:24px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">

    <div style="background:${bannerBg};padding:20px 28px">
      <h1 style="color:#fff;margin:0;font-size:18px">DMR — ${dateLabel}</h1>
      <p style="color:rgba(255,255,255,0.85);margin:4px 0 0;font-size:13px;font-weight:600">${statusText}</p>
    </div>

    <div style="padding:20px 28px">
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><td style="padding:4px 0;color:#6b7280">Matched</td><td style="padding:4px 0;text-align:right;font-weight:700">${matched} / ${nonAgg.length}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280">Drifted</td><td style="padding:4px 0;text-align:right;font-weight:700;color:${drifted > 0 ? '#d97706' : '#6b7280'}">${drifted}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280">Critical</td><td style="padding:4px 0;text-align:right;font-weight:700;color:${critical > 0 ? '#dc2626' : '#6b7280'}">${critical}</td></tr>
        <tr><td colspan="2" style="border-top:1px solid #e5e7eb;padding:2px 0"></td></tr>
        <tr><td style="padding:4px 0;color:#6b7280">Total Amount</td><td style="padding:4px 0;text-align:right;font-weight:700">$${totalAmount.toFixed(2)}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280">Total Calls</td><td style="padding:4px 0;text-align:right">${totalCalls.toLocaleString()}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280">Duration (min)</td><td style="padding:4px 0;text-align:right">${totalDurMin.toFixed(0)}</td></tr>
      </table>

      ${showTable ? `
      <p style="margin:20px 0 8px;font-size:12px;font-weight:700;text-transform:uppercase;color:#6b7280;letter-spacing:0.05em">Exceptions</p>
      <table width="100%" style="border-collapse:collapse;font-size:13px">
        <thead><tr style="background:#f9fafb;border-bottom:2px solid #e5e7eb">
          <th style="padding:6px 10px;text-align:left;font-size:10px;color:#6b7280;text-transform:uppercase">Account</th>
          <th style="padding:6px 10px;text-align:right;font-size:10px;color:#6b7280;text-transform:uppercase">Amount</th>
          <th style="padding:6px 10px;text-align:right;font-size:10px;color:#6b7280;text-transform:uppercase">Delta</th>
          <th style="padding:6px 10px;font-size:10px;color:#6b7280;text-transform:uppercase">Status</th>
          <th style="padding:6px 10px;font-size:10px;color:#6b7280;text-transform:uppercase">Type</th>
        </tr></thead>
        <tbody>${exceptionRowsHtml}</tbody>
      </table>` : `
      <p style="margin:16px 0 0;font-size:13px;color:#16a34a">No exceptions — all accounts matched.</p>`}

      <p style="margin:20px 0 0;font-size:12px;color:#6b7280">
        Please find the attached Excel report for full details (Summary · Detail · Raw Audit sheets).
      </p>
    </div>

    <div style="background:#f9fafb;padding:12px 28px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af">
      Auto-generated by Bitsauto Monitoring at 07:00 UTC daily.
    </div>
  </div>
</body>
</html>`;
}

// ── Main send function ────────────────────────────────────────────────────────

export async function sendDailyDMREmail(opts: {
  date?: string;            // YYYY-MM-DD (defaults to yesterday UTC)
  extraRecipients?: string[];
} = {}): Promise<{ ok: boolean; date: string; rowCount: number; recipients: string[]; error?: string }> {

  // Resolve date — default: yesterday UTC (full day completed by 07:00 UTC run)
  const date = opts.date ?? (() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  })();

  console.log(`[dmr-email] Starting daily DMR email for ${date}`);

  // 1. Fetch DMR rows; auto-generate if missing
  let rows = await storage.listDMRReports({ reportDate: date, latestVersionOnly: true });

  if (rows.length === 0) {
    console.log(`[dmr-email] No DMR rows for ${date} — attempting auto-generate`);
    try {
      const settings = await storage.getSippySettings();
      if (settings?.portalUrl) {
        const { generateDMR } = await import('../sippy/index');
        const config = {
          portalUrl:        settings.portalUrl,
          username:         settings.portalUsername  ?? settings.apiAdminUsername ?? '',
          password:         settings.portalPassword  ?? settings.apiAdminPassword ?? '',
          adminWebPassword: settings.adminWebPassword ?? '',
        };
        await generateDMR(config, new Date(date + 'T00:00:00Z'), {
          notes: 'Auto-generated by DMR email scheduler',
        });
        rows = await storage.listDMRReports({ reportDate: date, latestVersionOnly: true });
      }
    } catch (genErr: any) {
      console.warn(`[dmr-email] Auto-generate failed: ${genErr.message}`);
    }
  }

  if (rows.length === 0) {
    const msg = `No DMR data available for ${date}`;
    console.warn(`[dmr-email] ${msg}`);
    return { ok: false, date, rowCount: 0, recipients: [], error: msg };
  }

  // 2. Build Excel attachment
  let xlsBuf: Buffer | null = null;
  try {
    xlsBuf = buildDMRExcel(rows, date);
    console.log(`[dmr-email] Excel built: ${xlsBuf.byteLength} bytes, ${rows.length} rows`);
  } catch (xlsErr: any) {
    console.warn(`[dmr-email] Excel build failed: ${xlsErr.message} — sending HTML-only`);
  }

  // 3. Resolve recipients (admin + active watchers + extras)
  const settings = await storage.getSettings();
  const recipSet = new Set<string>();
  if (settings.alertAdminEmail) recipSet.add(settings.alertAdminEmail);
  try {
    const watchers = await storage.getWatcherRecipients();
    for (const w of watchers) { if (w.active && w.email) recipSet.add(w.email); }
  } catch { /* non-fatal */ }
  for (const e of (opts.extraRecipients ?? [])) { if (e) recipSet.add(e); }
  const recipients = Array.from(recipSet);

  if (recipients.length === 0) {
    return {
      ok: false, date, rowCount: rows.length, recipients: [],
      error: 'No recipients — add alertAdminEmail or active watcher_recipients in Settings.',
    };
  }

  // 4. Build email content
  const nonAgg   = rows.filter(r => r.accountName !== '__AGGREGATE__');
  const critical = nonAgg.filter(r => r.verificationStatus === 'critical').length;
  const tag      = critical > 0 ? `⚠️ ${critical} CRITICAL` : '✅ All Clear';
  const subject  = `DMR ${date} — ${tag} | ${nonAgg.length} accounts`;
  const html     = buildDMREmailHtml(rows, date);

  // 5. Send to each recipient with Excel attachment
  let ok = false;
  const errors: string[] = [];

  if (xlsBuf) {
    for (const to of recipients) {
      try {
        const res = await sendDirectEmailWithAttachment({
          to,
          subject,
          html,
          attachment: {
            filename:    `DMR_${date}.xlsx`,
            content:     xlsBuf,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          },
        });
        if (!res.ok && res.error) errors.push(`${to}: ${res.error}`);
        else ok = true;
      } catch (e: any) {
        errors.push(`${to}: ${e.message}`);
      }
    }
  } else {
    // Fallback: HTML-only via bulk send
    ok = await sendAlertEmail({ subject, bodyHtml: html, includeWatcherRecipients: true });
    if (!ok) errors.push('HTML-only fallback send failed');
  }

  const status = ok ? 'Sent' : 'Failed';
  console.log(`[dmr-email] ${status}: DMR ${date} → ${recipients.join(', ')}${errors.length ? ` | errors: ${errors.join('; ')}` : ''}`);

  return {
    ok,
    date,
    rowCount: rows.length,
    recipients,
    ...(errors.length ? { error: errors.join('; ') } : {}),
  };
}

// ── Daily scheduler ───────────────────────────────────────────────────────────

/**
 * Schedules the DMR email to fire once per day at 07:00 UTC.
 * Call once from server startup (index.ts) — drift-proof via re-scheduling after each run.
 */
export function startDMREmailScheduler(): void {
  const HOUR_UTC   = 7;
  const MINUTE_UTC = 0;

  function msUntilNextRun(): number {
    const now  = new Date();
    const next = new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
      HOUR_UTC, MINUTE_UTC, 0, 0,
    ));
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    return next.getTime() - now.getTime();
  }

  async function runAndReschedule() {
    try {
      // FP-03: the timer is gated, the manual send-now endpoint is not.
      const { scheduledDispatchAllowed } = await import('../../email');
      if (!scheduledDispatchAllowed()) {
        console.warn('[dmr-scheduler] daily email suppressed — scheduled dispatch is disabled on this instance (FP-03)');
      } else {
        const result = await sendDailyDMREmail();
        console.log(`[dmr-scheduler] ok=${result.ok} rows=${result.rowCount} recipients=${result.recipients.length}`);
      }
    } catch (err: any) {
      console.error(`[dmr-scheduler] Error: ${err.message}`);
    }
    // Re-schedule exactly 24 h later (avoids drift vs. setInterval)
    setTimeout(runAndReschedule, 24 * 60 * 60 * 1000);
  }

  const delay  = msUntilNextRun();
  const nextAt = new Date(Date.now() + delay).toUTCString();
  console.log(`[dmr-scheduler] Scheduled — next run at 07:00 UTC (${nextAt})`);
  setTimeout(runAndReschedule, delay);
}
