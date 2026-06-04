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
    return { transporter, from: `"Ichibaan Logic Billing" <${settings.alertGmailUser}>` };
  }

  return null;
}

export async function sendInvoiceEmail(
  opts: SendInvoiceEmailOpts,
): Promise<SendInvoiceEmailResult> {
  const { invoiceId, recipients, cc, subject, body, sentBy } = opts;

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

  let status: 'sent' | 'failed' = 'failed';
  let errorMessage: string | null = null;

  try {
    const conn = await buildInvoiceTransporter();
    if (!conn) {
      errorMessage = 'SMTP not configured — set up Invoice Email Delivery in Settings → Alerts first.';
      throw new Error(errorMessage);
    }

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

    await conn.transporter.sendMail({
      from:        conn.from,
      to:          recipients.join(', '),
      cc:          cc.length > 0 ? cc.join(', ') : undefined,
      subject,
      html:        htmlBody,
      attachments,
    });

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
