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
import { storage } from '../../storage';
import { db } from '../../db';
import { invoiceEmailDeliveries } from '@shared/schema';
import { decryptSecret, isEncrypted } from '../../utils/crypto';

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

    const fromName  = settings.invoiceSmtpFromName  ?? 'Bitsauto Finance';
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
    return { transporter, from: `"Bitsauto Finance" <${settings.alertGmailUser}>` };
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
    const htmlBody = `
<!DOCTYPE html>
<html>
<body style="font-family:Arial,Helvetica,sans-serif;background:#f9f9f9;margin:0;padding:24px">
<div style="max-width:700px;margin:0 auto;background:#fff;border-radius:8px;border:1px solid #e0e0e0;overflow:hidden">
  <div style="background:#1a1a2e;padding:20px 28px">
    <h2 style="margin:0;color:#fff;font-size:18px;font-weight:bold">Invoice ${invoice.invoiceNumber}</h2>
    <p style="margin:4px 0 0;color:#aaa;font-size:13px">${invoice.customerName ?? ''} · ${invoice.periodStart ?? ''} – ${invoice.periodEnd ?? ''}</p>
  </div>
  <div style="padding:24px 28px;font-size:14px;color:#333;line-height:1.7;white-space:pre-wrap">${body.replace(/\n/g, '<br>')}</div>
  ${invoice.htmlContent ? `
  <div style="padding:0 28px 24px">
    <p style="font-size:12px;color:#888;margin-bottom:8px">The full invoice is attached as an HTML file. Open it in any browser to view, print, or save as PDF.</p>
  </div>` : ''}
  <div style="padding:12px 28px;background:#f5f5f5;border-top:1px solid #e0e0e0;font-size:11px;color:#888">
    Sent via Bitsauto Finance Platform &bull; Invoice ${invoice.invoiceNumber}
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
