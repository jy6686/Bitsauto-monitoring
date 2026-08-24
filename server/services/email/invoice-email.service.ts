/**
 * invoice-email.service.ts
 *
 * Sends finalized invoices to customers via email.
 * Uses dedicated invoice SMTP credentials from settings (password stored AES-256-GCM
 * encrypted at rest; see server/utils/crypto.ts).
 * Falls back to the system Gmail transporter if invoice SMTP is not configured.
 *
 * Logs each attempt to invoice_email_deliveries table.
 */

import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import { storage } from '../../storage';
import { db } from '../../db';
import { invoiceEmailDeliveries } from '@shared/schema';
import { decryptSecret, isEncrypted } from '../../utils/crypto';

function loadEmailLogoDataUri(): string {
  try {
    const p = path.join(__dirname, '../../assets/ichibaan-logo.png');
    if (fs.existsSync(p)) {
      return `data:image/png;base64,${fs.readFileSync(p).toString('base64')}`;
    }
  } catch { /* non-fatal */ }
  return '';
}
const EMAIL_LOGO_URI = loadEmailLogoDataUri();

export interface SendInvoiceEmailOpts {
  invoiceId:  number;
  recipients: string[];   // To: addresses
  cc:         string[];   // CC: addresses
  subject:    string;
  body:       string;     // Plain-text / simple HTML body written by operator
  sentBy:     string;     // user id / name for audit
  /**
   * Who this invoice SHOULD have gone to, per the client master. Supplied when
   * the operator typed a different address than the client record holds, so the
   * delivery row records the override rather than only its result. Test Mode
   * fills this in itself when the caller does not.
   */
  intendedRecipients?: string[];
}

export interface SendInvoiceEmailResult {
  ok:      boolean;
  error?:  string;
}

function resolveSmtpPass(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (isEncrypted(raw)) {
    const decrypted = decryptSecret(raw);
    if (!decrypted) {
      console.warn('[invoice-email] SMTP password could not be decrypted — check AUTH_SECRET');
    }
    return decrypted;
  }
  // Legacy or manually-set plaintext (not yet encrypted). Accept as-is.
  return raw;
}

async function buildInvoiceTransporter(): Promise<{
  transporter: nodemailer.Transporter;
  from: string;
} | null> {
  const settings = await storage.getSettings();

  if (
    settings.invoiceSmtpHost &&
    settings.invoiceSmtpUser &&
    settings.invoiceSmtpPass
  ) {
    const pass = resolveSmtpPass(settings.invoiceSmtpPass);
    if (!pass) return null;

    const transporter = nodemailer.createTransport({
      host:   settings.invoiceSmtpHost,
      port:   settings.invoiceSmtpPort ?? 587,
      secure: settings.invoiceSmtpSecure ?? false,
      auth: {
        user: settings.invoiceSmtpUser,
        pass,
      },
      connectionTimeout: 15_000,
      socketTimeout:     15_000,
      greetingTimeout:   10_000,
    } as any);

    const fromName  = settings.invoiceSmtpFromName  ?? 'Ichibaan Logic Billing';
    const fromEmail = settings.invoiceSmtpFromEmail ?? settings.invoiceSmtpUser;
    return { transporter, from: `"${fromName}" <${fromEmail}>` };
  }

  // Fall back to system Gmail transporter if alerts are configured
  if (settings.alertEnabled && settings.alertGmailUser && settings.alertGmailAppPass) {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: settings.alertGmailUser,
        pass: settings.alertGmailAppPass,
      },
      connectionTimeout: 15_000,
      socketTimeout:     15_000,
      greetingTimeout:   10_000,
    } as any);
    return { transporter, from: `"Ichibaan Logic Billing" <billing@ichibaanlogic.com>` };
  }

  return null;
}

export async function sendInvoiceEmail(
  opts: SendInvoiceEmailOpts,
): Promise<SendInvoiceEmailResult> {
  let { invoiceId, recipients, cc, subject, body, sentBy } = opts;

  // Fetch invoice for HTML attachment
  const invoice = await storage.getInvoice(invoiceId);
  if (!invoice) return { ok: false, error: `Invoice #${invoiceId} not found` };

  // Validate state
  if (!['approved', 'sent'].includes(invoice.status)) {
    return { ok: false, error: `Invoice must be approved before sending (current status: ${invoice.status})` };
  }

  if (recipients.length === 0) {
    return { ok: false, error: 'At least one recipient is required' };
  }

  let testMode = false;
  // "Who should this have gone to" — the client-master addresses when the
  // operator overrode them, otherwise filled in by Test Mode below with the
  // recipients that would have been used. One meaning, either way.
  let intendedRecipients: string | null =
    opts.intendedRecipients?.length ? opts.intendedRecipients.join(', ') : null;

  // ── Test mode ───────────────────────────────────────────────────────────────
  // Every invoice email — manual and job dispatch alike — funnels through this
  // function, so this is the ONE place the redirect lives. With test mode on,
  // the real recipients are named in the body but never mailed; the whole rest
  // of the pipeline (attachment, delivery log, retry, job states) runs exactly
  // as in production. Migration 066; toggled in Settings → Invoice Email
  // Delivery; default off.
  try {
    const settings = await storage.getSettings();
    if ((settings as any)?.invoiceEmailTestMode) {
      const testTo = ((settings as any).invoiceEmailTestRecipient ?? '').trim();
      if (!testTo) {
        return { ok: false, error: 'Test mode is ON but no test recipient is configured (Settings → Invoice Email Delivery).' };
      }
      // Keep a caller-supplied intent (an operator override) — it names the
      // customer address that was truly meant, which outranks "what this send
      // would have used" as the audit fact.
      const intended = intendedRecipients ?? [...recipients, ...cc.map(c => `cc:${c}`)].join(', ');
      testMode = true;
      intendedRecipients = intended;
      recipients = [testTo];
      cc = [];
      subject = `[TEST] ${subject}`;
      body = `*** TEST MODE — this invoice was NOT sent to the client. ***\nIntended recipients: ${intended}\n\n${body}`;
      console.log(`[invoice-email] TEST MODE: redirecting invoice #${invoiceId} to ${testTo} (intended: ${intended})`);
    }
  } catch { /* settings unavailable — proceed as production rather than block sends */ }

  let status: 'sent' | 'failed' = 'failed';
  let errorMessage: string | null = null;
  let messageId: string | null = null;
  let smtpResponse: string | null = null;
  // The From identity actually used. Captured because buildInvoiceTransporter
  // falls back to the alert Gmail account when invoice SMTP is incomplete —
  // without this the audit could not distinguish the two senders (069).
  let sender: string | null = null;

  try {
    const conn = await buildInvoiceTransporter();
    if (!conn) {
      errorMessage = 'SMTP not configured — set up Invoice Email Delivery in Settings → Alerts first.';
      throw new Error(errorMessage);
    }
    sender = conn.from;

    // Attach invoice HTML as a downloadable file
    const attachments: any[] = [];
    if (invoice.htmlContent) {
      attachments.push({
        filename:    `${invoice.invoiceNumber}.html`,
        content:     invoice.htmlContent,
        contentType: 'text/html',
      });
    }

    // Email body: operator's message as primary content
    const logoHtml = EMAIL_LOGO_URI
      ? `<img src="${EMAIL_LOGO_URI}" alt="Ichibaan Logic" style="height:48px;width:auto;object-fit:contain;">`
      : `<span style="font-size:18px;font-weight:bold;color:#fff;letter-spacing:1px;">ICHIBAAN LOGIC</span>`;

    const htmlBody = `
<!DOCTYPE html>
<html>
<body style="font-family:Arial,Helvetica,sans-serif;background:#f4f4f4;margin:0;padding:24px">
<div style="max-width:680px;margin:0 auto;background:#ffffff;border-radius:6px;border:1px solid #ddd;overflow:hidden">

  <!-- Header -->
  <div style="background:#1a1a2e;padding:20px 28px;display:flex;align-items:center;justify-content:space-between">
    <div>${logoHtml}</div>
    <div style="text-align:right">
      <div style="color:#fff;font-size:16px;font-weight:bold">Invoice ${invoice.invoiceNumber}</div>
      <div style="color:#aaa;font-size:12px;margin-top:3px">${invoice.customerName ?? ''}</div>
    </div>
  </div>

  <!-- Red accent bar -->
  <div style="height:3px;background:#c0392b;"></div>

  <!-- Body -->
  <div style="padding:28px 32px;font-size:14px;color:#222;line-height:1.8">
    ${body.replace(/\n\n/g, '</p><p style="margin:0 0 14px 0">').replace(/\n/g, '<br>').replace(/^/, '<p style="margin:0 0 14px 0">').replace(/$/, '</p>')}
  </div>

  ${invoice.htmlContent ? `
  <!-- Attachment notice -->
  <div style="margin:0 32px 20px;padding:12px 16px;background:#fff8e1;border-left:3px solid #f39c12;border-radius:3px;font-size:12px;color:#7f6003">
    📎 The full invoice is attached as an HTML file. Open it in any browser to view, print, or save as PDF.
  </div>` : ''}

  <!-- Footer -->
  <div style="padding:16px 32px;background:#f8f8f8;border-top:1px solid #e8e8e8">
    <div style="font-size:11px;color:#555;line-height:1.7">
      <strong style="color:#1a1a2e">Ichibaan Logic Private Limited</strong>
      <span style="color:#999;font-style:italic"> (formerly Bhaoo Private Limited)</span><br>
      Unit Level 11(A), Main Office Tower, Jalan Merdeka, Financial Park Labuan, 87000 Labuan, Malaysia<br>
      Tel: +60 11 1426 1581 &nbsp;&bull;&nbsp;
      <a href="mailto:billing@ichibaanlogic.com" style="color:#c0392b;text-decoration:none;">billing@ichibaanlogic.com</a> &nbsp;&bull;&nbsp;
      <a href="https://www.ichibaanlogic.com" style="color:#c0392b;text-decoration:none;">www.ichibaanlogic.com</a>
    </div>
  </div>

</div>
</body>
</html>`;

    const smtpInfo = await conn.transporter.sendMail({
      from:        conn.from,
      to:          recipients.join(', '),
      cc:          cc.length > 0 ? cc.join(', ') : undefined,
      subject,
      html:        htmlBody,
      attachments,
    });
    messageId    = smtpInfo?.messageId ?? null;
    smtpResponse = smtpInfo?.response ?? null;

    status = 'sent';
    console.log(`[invoice-email] Sent ${invoice.invoiceNumber} → ${recipients.join(', ')}`);
  } catch (err: any) {
    errorMessage = err.message ?? String(err);
    console.error(`[invoice-email] Failed ${invoice.invoiceNumber}: ${errorMessage}`);
  }

  // Log delivery attempt
  try {
    await db.insert(invoiceEmailDeliveries).values({
      invoiceId,
      recipients:   JSON.stringify(recipients),
      ccAddresses:  JSON.stringify(cc),
      subject,
      bodyText:     body,
      sentBy,
      status,
      errorMessage,
      messageId,
      smtpResponse: smtpResponse ? smtpResponse.slice(0, 512) : null,
      testMode,
      intendedRecipients,
      sender,
      sentAt:       new Date(),
    });
  } catch (logErr: any) {
    console.warn('[invoice-email] Failed to log delivery:', logErr.message);
  }

  // Update invoice status to sent on first successful delivery
  if (status === 'sent' && invoice.status !== 'sent') {
    try {
      await storage.updateInvoice(invoiceId, { status: 'sent', sentAt: new Date() });
    } catch (updateErr: any) {
      console.warn('[invoice-email] Failed to update invoice status:', updateErr.message);
    }
  }

  return status === 'sent' ? { ok: true } : { ok: false, error: errorMessage ?? 'Send failed' };
}

export async function testInvoiceSmtp(): Promise<{ ok: boolean; error?: string }> {
  try {
    const conn = await buildInvoiceTransporter();
    if (!conn) return { ok: false, error: 'Invoice SMTP not configured and no fallback Gmail config available' };
    await conn.transporter.verify();
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}
