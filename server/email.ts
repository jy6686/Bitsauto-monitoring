
import nodemailer from 'nodemailer';
import { storage } from './storage';

export type AlertEmailPayload = {
  subject: string;
  bodyHtml: string;
  clientEmail?: string | null; // optional per-client recipient
  includeWatcherRecipients?: boolean; // also CC all active watcher_recipients
};

let _transporter: nodemailer.Transporter | null = null;
let _fromAddress = '';

// ── Notification audit ring buffer (last 200 delivery attempts) ──────────────
export type NotificationAuditEntry = {
  ts:         number;
  subject:    string;
  recipients: string[];
  status:     'sent' | 'retry_sent' | 'failed' | 'skipped';
  attempts:   number;
  error?:     string;
};
const _notificationAuditLog: NotificationAuditEntry[] = [];
const AUDIT_MAX = 200;

function _audit(entry: NotificationAuditEntry) {
  _notificationAuditLog.unshift(entry);
  if (_notificationAuditLog.length > AUDIT_MAX) _notificationAuditLog.length = AUDIT_MAX;
}

/** Returns a snapshot of the last 200 notification delivery attempts. */
export function getNotificationAuditLog(): NotificationAuditEntry[] {
  return [..._notificationAuditLog];
}

async function getTransporter(): Promise<{ transporter: nodemailer.Transporter; from: string } | null> {
  const settings = await storage.getSettings();
  if (!settings.alertEnabled) return null;
  if (!settings.alertGmailUser || !settings.alertGmailAppPass) return null;

  // Re-create if creds changed
  const needsNew = !_transporter || _fromAddress !== settings.alertGmailUser;
  if (needsNew) {
    _transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: settings.alertGmailUser,
        pass: settings.alertGmailAppPass,
      },
      // Prevent indefinite hangs on network issues
      connectionTimeout: 10_000,
      socketTimeout:     12_000,
      greetingTimeout:    8_000,
    } as any);
    _fromAddress = settings.alertGmailUser;
  }
  return { transporter: _transporter!, from: settings.alertGmailUser };
}

/**
 * Build a transporter from a specific SMTP sender profile.
 * Used by the Commercial Notifications dispatch engine.
 */
export async function buildProfileTransporter(profile: {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  smtpSecure: boolean | null;
  emailAddress: string;
  name: string;
}): Promise<nodemailer.Transporter> {
  return nodemailer.createTransport({
    host: profile.smtpHost,
    port: profile.smtpPort,
    secure: profile.smtpSecure ?? false,
    auth: { user: profile.smtpUser, pass: profile.smtpPass },
    connectionTimeout: 10_000,
    socketTimeout:     12_000,
    greetingTimeout:    8_000,
  } as any);
}

/**
 * Send a single email via a specific SMTP sender profile.
 * Falls back to the default system transporter if profile is null.
 */
export async function sendViaProfile(opts: {
  to: string;
  subject: string;
  html: string;
  profile: {
    smtpHost: string; smtpPort: number; smtpUser: string;
    smtpPass: string; smtpSecure: boolean | null;
    emailAddress: string; name: string; replyTo?: string | null;
  } | null;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!opts.profile) {
      // Fall back to system default transport
      return sendDirectEmail({ to: opts.to, subject: opts.subject, html: opts.html });
    }
    const transport = await buildProfileTransporter(opts.profile);
    const fromLine  = `"${opts.profile.name}" <${opts.profile.emailAddress}>`;
    await transport.sendMail({
      from:    fromLine,
      to:      opts.to,
      subject: opts.subject,
      html:    opts.html,
      ...(opts.profile.replyTo ? { replyTo: opts.profile.replyTo } : {}),
    });
    console.log(`[email-profile] Sent via ${opts.profile.emailAddress}: ${opts.subject} → ${opts.to}`);
    return { ok: true };
  } catch (err: any) {
    console.error(`[email-profile] Failed ${opts.to}: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

/**
 * Send a single email directly to a specific address.
 * Used by the Email Centre bulk-send feature.
 */
export async function sendDirectEmail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const conn = await getTransporter();
    if (!conn) return { ok: false, error: 'Email not configured — enable alerts in Settings first.' };
    await conn.transporter.sendMail({
      from: `"Bitsauto Monitoring" <${conn.from}>`,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    });
    console.log(`[email] Direct send: ${opts.subject} → ${opts.to}`);
    return { ok: true };
  } catch (err: any) {
    console.error(`[email] Direct send failed → ${opts.to}: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

const EMAIL_MAX_ATTEMPTS  = 2;
const EMAIL_RETRY_DELAY   = 5_000; // ms between attempts

export async function sendAlertEmail(payload: AlertEmailPayload): Promise<boolean> {
  const settings = await storage.getSettings();
  const recipients = new Set<string>();
  if (settings.alertAdminEmail) recipients.add(settings.alertAdminEmail);
  if (payload.clientEmail) recipients.add(payload.clientEmail);
  if (payload.includeWatcherRecipients) {
    const watcherList = await storage.getWatcherRecipients();
    for (const r of watcherList) { if (r.active && r.email) recipients.add(r.email); }
  }

  const recipList = Array.from(recipients);
  if (recipList.length === 0) {
    _audit({ ts: Date.now(), subject: payload.subject, recipients: [], status: 'skipped', attempts: 0, error: 'no recipients configured' });
    return false;
  }

  let lastErr = '';
  for (let attempt = 1; attempt <= EMAIL_MAX_ATTEMPTS; attempt++) {
    try {
      // Force transporter re-creation on retry (clears bad connection state)
      if (attempt > 1) { _transporter = null; await new Promise(r => setTimeout(r, EMAIL_RETRY_DELAY)); }

      const conn = await getTransporter();
      if (!conn) {
        _audit({ ts: Date.now(), subject: payload.subject, recipients: recipList, status: 'skipped', attempts: attempt, error: 'email not enabled or credentials missing' });
        return false;
      }

      await conn.transporter.sendMail({
        from:    `"Bitsauto Monitoring" <${conn.from}>`,
        to:      recipList.join(', '),
        subject: payload.subject,
        html:    payload.bodyHtml,
      });

      const status = attempt > 1 ? 'retry_sent' : 'sent';
      console.log(`[email] ${status} (attempt ${attempt}): ${payload.subject} → ${recipList.join(', ')}`);
      _audit({ ts: Date.now(), subject: payload.subject, recipients: recipList, status, attempts: attempt });
      return true;

    } catch (err: any) {
      lastErr = err.message ?? String(err);
      console.warn(`[email] Attempt ${attempt}/${EMAIL_MAX_ATTEMPTS} failed: ${lastErr}`);
    }
  }

  console.error(`[email] All ${EMAIL_MAX_ATTEMPTS} attempts failed for: ${payload.subject}`);
  _audit({ ts: Date.now(), subject: payload.subject, recipients: recipList, status: 'failed', attempts: EMAIL_MAX_ATTEMPTS, error: lastErr });
  return false;
}

export async function testEmailConfig(): Promise<{ ok: boolean; error?: string }> {
  try {
    const conn = await getTransporter();
    if (!conn) return { ok: false, error: 'Email alerts not enabled or credentials missing' };
    await conn.transporter.verify();
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// ── Email template builders ────────────────────────────────────────────────

function baseTemplate(title: string, content: string): string {
  return `
<!DOCTYPE html>
<html>
<body style="font-family:Arial,sans-serif;background:#0f0f0f;color:#e0e0e0;padding:24px">
  <div style="max-width:600px;margin:0 auto;background:#1a1a2e;border-radius:12px;overflow:hidden">
    <div style="background:#4f46e5;padding:20px 24px">
      <h1 style="margin:0;font-size:18px;color:#fff">📡 Bitsauto Monitoring — ${title}</h1>
    </div>
    <div style="padding:24px">
      ${content}
    </div>
    <div style="padding:12px 24px;background:#111;font-size:12px;color:#666">
      Bitsauto Monitoring &bull; Alert generated at ${new Date().toUTCString()}
    </div>
  </div>
</body>
</html>`;
}

export function buildBalanceAlertEmail(opts: {
  accountName: string;
  balance: number;
  creditLimit: number;
  threshold: number;
}): { subject: string; bodyHtml: string } {
  const pct = opts.creditLimit > 0 ? ((opts.balance / opts.creditLimit) * 100).toFixed(1) : 'N/A';
  return {
    subject: `⚠️ Low Balance Alert — ${opts.accountName} ($${opts.balance.toFixed(2)})`,
    bodyHtml: baseTemplate('Low Balance Alert', `
      <p>Account <strong>${opts.accountName}</strong> has dropped below the balance threshold.</p>
      <table style="width:100%;border-collapse:collapse;margin-top:16px">
        <tr><td style="padding:8px;color:#aaa">Current Balance</td><td style="padding:8px;color:#f87171;font-weight:bold">$${opts.balance.toFixed(2)}</td></tr>
        <tr><td style="padding:8px;color:#aaa">Credit Limit</td><td style="padding:8px">$${opts.creditLimit.toFixed(2)}</td></tr>
        <tr><td style="padding:8px;color:#aaa">Usage</td><td style="padding:8px">${pct}%</td></tr>
        <tr><td style="padding:8px;color:#aaa">Alert Threshold</td><td style="padding:8px">$${opts.threshold.toFixed(2)}</td></tr>
      </table>
      <p style="margin-top:16px;color:#fbbf24">⚡ Action Required: Please top up the account to avoid service disruption.</p>
    `),
  };
}

export function buildAuthAlertEmail(opts: {
  accountName: string;
  action: 'added' | 'deleted';
  ipAddress?: string;
  username?: string;
}): { subject: string; bodyHtml: string } {
  const icon = opts.action === 'added' ? '🔐' : '🗑️';
  return {
    subject: `${icon} Auth Rule ${opts.action === 'added' ? 'Added' : 'Deleted'} — ${opts.accountName}`,
    bodyHtml: baseTemplate('Authentication Change', `
      <p>An authentication rule was <strong>${opts.action}</strong> for account <strong>${opts.accountName}</strong>.</p>
      <table style="width:100%;border-collapse:collapse;margin-top:16px">
        <tr><td style="padding:8px;color:#aaa">Action</td><td style="padding:8px;color:${opts.action === 'added' ? '#4ade80' : '#f87171'};font-weight:bold">${opts.action.toUpperCase()}</td></tr>
        ${opts.ipAddress ? `<tr><td style="padding:8px;color:#aaa">IP Address</td><td style="padding:8px;font-family:monospace">${opts.ipAddress}</td></tr>` : ''}
        ${opts.username ? `<tr><td style="padding:8px;color:#aaa">Username</td><td style="padding:8px;font-family:monospace">${opts.username}</td></tr>` : ''}
        <tr><td style="padding:8px;color:#aaa">Timestamp</td><td style="padding:8px">${new Date().toUTCString()}</td></tr>
      </table>
      <p style="margin-top:16px;color:#fbbf24">If this was not expected, investigate immediately.</p>
    `),
  };
}

export function buildFasAlertEmail(opts: {
  callId: string;
  caller: string;
  callee: string;
  vendor: string;
  pddSecs: number;
  billSecs: number;
  reason: string;
}): { subject: string; bodyHtml: string } {
  return {
    subject: `🚨 FAS Detected — ${opts.vendor} | ${opts.caller} → ${opts.callee}`,
    bodyHtml: baseTemplate('FAS Fraud Detection', `
      <p style="color:#f87171;font-weight:bold">False Answer Supervision (FAS) detected on the following call:</p>
      <table style="width:100%;border-collapse:collapse;margin-top:16px">
        <tr><td style="padding:8px;color:#aaa">Call ID</td><td style="padding:8px;font-family:monospace">${opts.callId}</td></tr>
        <tr><td style="padding:8px;color:#aaa">Caller</td><td style="padding:8px">${opts.caller}</td></tr>
        <tr><td style="padding:8px;color:#aaa">Callee</td><td style="padding:8px">${opts.callee}</td></tr>
        <tr><td style="padding:8px;color:#aaa">Vendor</td><td style="padding:8px">${opts.vendor}</td></tr>
        <tr><td style="padding:8px;color:#aaa">PDD</td><td style="padding:8px;color:#fb923c">${opts.pddSecs.toFixed(1)}s</td></tr>
        <tr><td style="padding:8px;color:#aaa">Billed Duration</td><td style="padding:8px;color:#fb923c">${opts.billSecs}s</td></tr>
        <tr><td style="padding:8px;color:#aaa">Detection Reason</td><td style="padding:8px;color:#f87171">${opts.reason}</td></tr>
      </table>
      <p style="margin-top:16px;color:#fbbf24">Recommend: review vendor ${opts.vendor} routing and billing patterns.</p>
    `),
  };
}

// Severity → accent colour (inline CSS hex)
const SEVERITY_COLOR: Record<string, string> = {
  critical: '#ef4444',
  high:     '#f97316',
  medium:   '#f59e0b',
  low:      '#3b82f6',
};

export function buildIncidentAlertEmail(opts: {
  title:           string;
  summary:         string;
  severity:        string;
  metric:          string;
  entityName:      string;
  entityType:      string;
  metricValue?:    number | null;
  threshold?:      number | null;
  suggestedAction: string;
  openedAt:        Date | string;
}): { subject: string; bodyHtml: string } {
  const color   = SEVERITY_COLOR[opts.severity.toLowerCase()] ?? '#6366f1';
  const sev     = opts.severity.toUpperCase();
  const metricLabel: Record<string, string> = {
    asr_drop:     'ASR (Answer-Seizure Ratio)',
    traffic_gone: 'Concurrent Calls',
    cps_spike:    'Calls-Per-Second',
  };
  const ts = new Date(opts.openedAt).toUTCString();

  return {
    subject: `[${sev}] ${opts.title}`,
    bodyHtml: baseTemplate(opts.title, `
      <div style="display:inline-block;padding:4px 10px;border-radius:4px;background:${color}22;border:1px solid ${color};color:${color};font-size:12px;font-weight:bold;letter-spacing:.5px;margin-bottom:16px">${sev}</div>

      <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#ccc">${opts.summary}</p>

      <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
        <tr style="border-bottom:1px solid #2a2a3e">
          <td style="padding:8px 4px;color:#888;font-size:12px;width:36%">Entity</td>
          <td style="padding:8px 4px;font-weight:bold;font-size:13px">${opts.entityName} <span style="color:#888;font-weight:normal;font-size:11px">(${opts.entityType})</span></td>
        </tr>
        <tr style="border-bottom:1px solid #2a2a3e">
          <td style="padding:8px 4px;color:#888;font-size:12px">Metric</td>
          <td style="padding:8px 4px;font-size:13px">${metricLabel[opts.metric] ?? opts.metric}</td>
        </tr>
        ${opts.metricValue != null ? `
        <tr style="border-bottom:1px solid #2a2a3e">
          <td style="padding:8px 4px;color:#888;font-size:12px">Current Value</td>
          <td style="padding:8px 4px;font-weight:bold;color:${color};font-size:13px">${opts.metric === 'asr_drop' ? `${opts.metricValue}%` : opts.metric === 'cps_spike' ? `+${opts.metricValue}% above baseline` : `${opts.metricValue} idle cycles`}</td>
        </tr>` : ''}
        ${opts.threshold != null ? `
        <tr style="border-bottom:1px solid #2a2a3e">
          <td style="padding:8px 4px;color:#888;font-size:12px">Threshold</td>
          <td style="padding:8px 4px;font-size:13px">${opts.metric === 'asr_drop' ? `< ${opts.threshold}%` : `> ${opts.threshold}`}</td>
        </tr>` : ''}
        <tr>
          <td style="padding:8px 4px;color:#888;font-size:12px">Detected At</td>
          <td style="padding:8px 4px;font-size:13px;font-family:monospace">${ts}</td>
        </tr>
      </table>

      <div style="background:#1e2235;border-left:3px solid ${color};padding:12px 16px;border-radius:0 6px 6px 0;margin-top:8px">
        <p style="margin:0;font-size:12px;color:#aaa;font-weight:bold;letter-spacing:.3px;text-transform:uppercase;margin-bottom:4px">Suggested Action</p>
        <p style="margin:0;font-size:13px;color:#e0e0e0;line-height:1.5">${opts.suggestedAction}</p>
      </div>
    `),
  };
}

export function buildWrongNumberAlertEmail(opts: {
  caller: string;
  callee: string;
  sipCode: number;
  type: string;
  count: number;
}): { subject: string; bodyHtml: string } {
  return {
    subject: `📵 ${opts.type} Alert — ${opts.count} calls to ${opts.callee}`,
    bodyHtml: baseTemplate('Invalid Destination Detection', `
      <p>Multiple calls have been routed to an <strong>${opts.type.toLowerCase()}</strong> destination.</p>
      <table style="width:100%;border-collapse:collapse;margin-top:16px">
        <tr><td style="padding:8px;color:#aaa">Caller</td><td style="padding:8px">${opts.caller}</td></tr>
        <tr><td style="padding:8px;color:#aaa">Destination</td><td style="padding:8px">${opts.callee}</td></tr>
        <tr><td style="padding:8px;color:#aaa">SIP Code</td><td style="padding:8px;color:#f87171">${opts.sipCode}</td></tr>
        <tr><td style="padding:8px;color:#aaa">Type</td><td style="padding:8px">${opts.type}</td></tr>
        <tr><td style="padding:8px;color:#aaa">Occurrences</td><td style="padding:8px;color:#fb923c;font-weight:bold">${opts.count}</td></tr>
      </table>
      <p style="margin-top:16px;color:#fbbf24">Review routing rules or prefix lists for this destination.</p>
    `),
  };
}
