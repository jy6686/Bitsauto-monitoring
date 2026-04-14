
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
    });
    _fromAddress = settings.alertGmailUser;
  }
  return { transporter: _transporter!, from: settings.alertGmailUser };
}

export async function sendAlertEmail(payload: AlertEmailPayload): Promise<boolean> {
  try {
    const conn = await getTransporter();
    if (!conn) return false;

    const settings = await storage.getSettings();
    const recipients = new Set<string>();
    if (settings.alertAdminEmail) recipients.add(settings.alertAdminEmail);
    if (payload.clientEmail) recipients.add(payload.clientEmail);

    // Optionally include all active watcher recipients
    if (payload.includeWatcherRecipients) {
      const watcherList = await storage.getWatcherRecipients();
      for (const r of watcherList) {
        if (r.active && r.email) recipients.add(r.email);
      }
    }

    if (recipients.size === 0) return false;

    await conn.transporter.sendMail({
      from: `"VoIP Monitor" <${conn.from}>`,
      to: Array.from(recipients).join(', '),
      subject: payload.subject,
      html: payload.bodyHtml,
    });
    console.log(`[email] Alert sent: ${payload.subject} → ${Array.from(recipients).join(', ')}`);
    return true;
  } catch (err: any) {
    console.error('[email] Failed to send alert:', err.message);
    return false;
  }
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
      <h1 style="margin:0;font-size:18px;color:#fff">📡 VoIP Monitor — ${title}</h1>
    </div>
    <div style="padding:24px">
      ${content}
    </div>
    <div style="padding:12px 24px;background:#111;font-size:12px;color:#666">
      VoIP Monitor &bull; Alert generated at ${new Date().toUTCString()}
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
