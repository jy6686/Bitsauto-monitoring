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

// Same resolution problem as the PDF renderer: __dirname does not exist under
// ESM and points at dist/ once bundled, so this quietly returned '' and every
// invoice email went out with the text fallback instead of the logo.
function loadEmailLogoDataUri(): string {
  for (const rel of ['server/assets/ichibaan-logo.png', 'assets/ichibaan-logo.png']) {
    try {
      const p = path.join(process.cwd(), rel);
      if (fs.existsSync(p)) {
        return `data:image/png;base64,${fs.readFileSync(p).toString('base64')}`;
      }
    } catch { /* try the next candidate */ }
  }
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
    // Send as the account that actually authenticated. This previously claimed
    // a fixed billing@ address regardless of which mailbox was logged in —
    // an address Gmail rewrites when it does not belong to the authenticated
    // account, so the delivery audit recorded a sender the recipient never saw.
    // The display name stays configurable; the address must be the real one.
    const fallbackName = settings.invoiceSmtpFromName ?? 'Ichibaan Logic Billing';
    return { transporter, from: `"${fallbackName}" <${settings.alertGmailUser}>` };
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

  // Currency comes from the client record, never assumed. The summary below
  // stated USD unconditionally, which misreports the amount for any client
  // billed in another currency.
  let currency = 'USD';
  try {
    const { db: database } = await import('../../db');
    const { sql: rawSql } = await import('drizzle-orm');
    const r = await database.execute(rawSql`
      SELECT coalesce(nullif(sippy_tariff_currency, ''), nullif(currency, ''), 'USD') AS cur
        FROM companies WHERE lower(name) = lower(${String(invoice.customerName ?? '')}) LIMIT 1`);
    const c = ((r as any).rows ?? [])[0]?.cur;
    if (c) currency = String(c).toUpperCase();
  } catch { /* default stands */ }

  // Total minutes billed, for the summary. Read from the line items rather than
  // stated, so the email cannot disagree with the attached invoice.
  let totalMinutes: string | null = null;
  try {
    const { db: database } = await import('../../db');
    const { sql: rawSql } = await import('drizzle-orm');
    const r = await database.execute(rawSql`
      SELECT coalesce(sum(duration_secs), 0)::int AS secs
        FROM invoice_line_items WHERE invoice_id = ${invoiceId}`);
    const secs = Number(((r as any).rows ?? [])[0]?.secs ?? 0);
    totalMinutes = (secs / 60).toFixed(2);
  } catch { /* omit the row rather than guess */ }

  // Due date from the same shared rule the PDF uses, so the email and the
  // attached invoice can never state different deadlines.
  let dueLabel: string | null = null;
  let termLabel: string | null = null;
  try {
    // The stamp written at generation (076) wins — an issued invoice's terms
    // don't drift with the profile. Older rows resolve through the same
    // shared lookup the PDF and the generation stamp use, so the email and
    // the attachment can never state different deadlines.
    if ((invoice as any).dueDate || (invoice as any).paymentTermsLabel) {
      dueLabel  = (invoice as any).dueDate ? String((invoice as any).dueDate).slice(0, 10) : '—';
      termLabel = (invoice as any).paymentTermsLabel ?? null;
    } else {
      const { invoiceTermsForCustomer } = await import('../../invoice-terms-db');
      const terms = await invoiceTermsForCustomer(
        invoice.customerName,
        String(invoice.generatedAt ?? invoice.createdAt ?? new Date().toISOString()).slice(0, 10),
      );
      // Unconfigured terms are stated, not omitted — hiding the row would let
      // the gap survive review; the PDF prints the same dash (owner rule).
      dueLabel  = terms.basis === 'prepaid' ? 'On receipt' : (terms.dueDate ?? '—');
      termLabel = terms.termLabel;
    }
  } catch { /* omit the row rather than state a deadline we cannot justify */ }

  // Issuer identity for the footer — the same profile the PDF prints, so the
  // email cannot sign as a different company than its attachment.
  let issuer: any = {};
  try {
    const s: any = (await storage.getSettings()) ?? {};
    issuer = {
      ...s,
      // Displayed and used inside an https:// href — store it scheme-less.
      billingWebsite: s.billingWebsite ? String(s.billingWebsite).replace(/^https?:\/\//i, '') : null,
    };
  } catch { /* unconfigured → the fallback literals below */ }

  // Billing contact separation (owner spec): To = the client's billing
  // recipients; CC = the issuer's own billing CC (finance keeps a copy of
  // every outgoing invoice); BCC likewise; Reply-To = the dispute mailbox,
  // so a customer hitting Reply lands in dispute handling, not a send-only
  // SMTP identity.
  const splitAddresses = (s: unknown): string[] =>
    String(s ?? '').split(/[,;]+/).map((x) => x.trim()).filter((x) => x.includes('@'));
  for (const addr of splitAddresses(issuer.billingCc)) {
    if (!cc.includes(addr) && !recipients.includes(addr)) cc.push(addr);
  }
  // A BCC address already on To/CC would just duplicate the delivery.
  let bcc: string[] = splitAddresses(issuer.billingBcc)
    .filter((a) => !recipients.includes(a) && !cc.includes(a));
  const replyTo: string | undefined =
    String(issuer.billingDisputeEmail ?? '').trim() || undefined;

  // Settings values are operator-configured, but they land inside HTML text
  // and attribute contexts below — escape them so a legal name containing
  // '&' or quotes cannot break the markup (or worse).
  const esc = (s: unknown): string => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

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
      bcc = []; // issuer copies are real deliveries — test mode suppresses them too
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

    // Attach the invoice under a name the customer can file.
    // "C-2608-0006.html" tells a recipient nothing and collides in a downloads
    // folder holding several suppliers' invoices; the client, the number and
    // the period belong in the filename.
    // A PDF is what a customer expects and what the legacy system sent. If
    // rendering fails the invoice still goes out with the HTML version rather
    // than not at all — a delivered invoice in the wrong format beats a
    // customer waiting on one — but the fallback is logged, because silently
    // reverting to HTML is how the regression would return unnoticed.
    const attachments: any[] = [];
    try {
      const { renderInvoicePdf } = await import('../invoice-pdf.service');
      const { buffer, filename } = await renderInvoicePdf(invoiceId);
      attachments.push({ filename, content: buffer, contentType: 'application/pdf' });
    } catch (pdfErr: any) {
      console.error(`[invoice-email] PDF render failed for ${invoice.invoiceNumber}, falling back to HTML: ${pdfErr.message}`);
      if (invoice.htmlContent) {
        const slug = (s: string) => String(s).trim().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const period = invoice.periodStart && invoice.periodEnd
          ? `_${String(invoice.periodStart).slice(0, 10)}_to_${String(invoice.periodEnd).slice(0, 10)}`
          : '';
        attachments.push({
          filename:    `Ichibaan_${slug(invoice.customerName ?? 'Client')}_Invoice_${slug(invoice.invoiceNumber)}${period}.html`,
          content:     invoice.htmlContent,
          contentType: 'text/html',
        });
      }
    }

    // Email body: operator's message as primary content. Configured logo
    // (settings data-URI) wins over the built-in asset, same rule as the PDF.
    const logoUri = issuer.invoiceLogo || EMAIL_LOGO_URI;
    const logoHtml = logoUri
      ? `<img src="${logoUri}" alt="${esc(issuer.billingLegalName ?? 'Ichibaan Logic')}" style="height:48px;width:auto;object-fit:contain;">`
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

  <!-- Invoice summary — the recipient should not have to open an attachment
       to learn what they are being billed and for when. -->
  <div style="margin:0 32px 20px;border:1px solid #e8e8e8;border-radius:4px;overflow:hidden">
    <div style="background:#f8f8f8;padding:8px 16px;font-size:11px;font-weight:bold;color:#1a1a2e;letter-spacing:0.06em;text-transform:uppercase">Invoice summary</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;color:#222">
      <tr><td style="padding:7px 16px;color:#666;width:45%">Invoice number</td><td style="padding:7px 16px;text-align:right;font-weight:bold">${invoice.invoiceNumber}</td></tr>
      <tr><td style="padding:7px 16px;color:#666;border-top:1px solid #f0f0f0">Customer</td><td style="padding:7px 16px;text-align:right;border-top:1px solid #f0f0f0">${invoice.customerName ?? ''}</td></tr>
      ${invoice.periodStart ? `<tr><td style="padding:7px 16px;color:#666;border-top:1px solid #f0f0f0">Billing period</td><td style="padding:7px 16px;text-align:right;border-top:1px solid #f0f0f0">${String(invoice.periodStart).slice(0, 10)} &ndash; ${String(invoice.periodEnd ?? '').slice(0, 10)}</td></tr>` : ''}
      ${invoice.generatedAt ? `<tr><td style="padding:7px 16px;color:#666;border-top:1px solid #f0f0f0">Invoice date</td><td style="padding:7px 16px;text-align:right;border-top:1px solid #f0f0f0">${String(invoice.generatedAt).slice(0, 10)}</td></tr>` : ''}
      <tr><td style="padding:7px 16px;color:#666;border-top:1px solid #f0f0f0">Currency</td><td style="padding:7px 16px;text-align:right;border-top:1px solid #f0f0f0">${currency}</td></tr>
      ${invoice.lineCount != null ? `<tr><td style="padding:7px 16px;color:#666;border-top:1px solid #f0f0f0">Calls billed</td><td style="padding:7px 16px;text-align:right;border-top:1px solid #f0f0f0">${Number(invoice.lineCount).toLocaleString()}</td></tr>` : ''}
      ${totalMinutes != null ? `<tr><td style="padding:7px 16px;color:#666;border-top:1px solid #f0f0f0">Total minutes</td><td style="padding:7px 16px;text-align:right;border-top:1px solid #f0f0f0">${totalMinutes}</td></tr>` : ''}
      ${termLabel ? `<tr><td style="padding:7px 16px;color:#666;border-top:1px solid #f0f0f0">Payment terms</td><td style="padding:7px 16px;text-align:right;border-top:1px solid #f0f0f0">${termLabel}</td></tr>` : ''}
      ${dueLabel ? `<tr><td style="padding:7px 16px;color:#666;border-top:1px solid #f0f0f0">Payment due</td><td style="padding:7px 16px;text-align:right;border-top:1px solid #f0f0f0;font-weight:bold">${dueLabel}</td></tr>` : ''}
      <tr><td style="padding:9px 16px;color:#1a1a2e;font-weight:bold;border-top:2px solid #1a1a2e">Total amount</td><td style="padding:9px 16px;text-align:right;font-weight:bold;font-size:15px;color:#1a1a2e;border-top:2px solid #1a1a2e">${currency} ${Number(invoice.totalActual ?? 0).toFixed(2)}</td></tr>
    </table>
  </div>

  ${invoice.htmlContent ? `
  <div style="margin:0 32px 20px;font-size:12px;color:#555;line-height:1.7">
    The attached invoice contains the charge summary by country, the destination-wise call
    detail, and the payment instructions. Please review it and arrange payment by the due date.
  </div>` : ''}

  <!-- Footer: issuer identity from the company profile; literals are the
       unconfigured fallback so an unconfigured install still signs its mail. -->
  <div style="padding:16px 32px;background:#f8f8f8;border-top:1px solid #e8e8e8">
    <div style="font-size:11px;color:#555;line-height:1.7">
      <strong style="color:#1a1a2e">${esc(issuer.billingLegalName ?? 'Ichibaan Logic Private Limited')}</strong>
      ${issuer.billingLegalName ? '' : '<span style="color:#999;font-style:italic"> (formerly Bhaoo Private Limited)</span>'}<br>
      ${esc(issuer.billingRegisteredAddress ?? 'Unit Level 11(A), Main Office Tower, Jalan Merdeka, Financial Park Labuan, 87000 Labuan, Malaysia')}<br>
      Tel: ${esc(issuer.billingPhone ?? '+60 11 1426 1581')} &nbsp;&bull;&nbsp;
      <a href="mailto:${esc(issuer.billingContactEmail ?? 'billing@ichibaanlogic.com')}" style="color:#c0392b;text-decoration:none;">${esc(issuer.billingContactEmail ?? 'billing@ichibaanlogic.com')}</a> &nbsp;&bull;&nbsp;
      ${issuer.billingSupportEmail ? `Support: <a href="mailto:${esc(issuer.billingSupportEmail)}" style="color:#c0392b;text-decoration:none;">${esc(issuer.billingSupportEmail)}</a> &nbsp;&bull;&nbsp;` : ''}
      <a href="https://${esc(issuer.billingWebsite ?? 'www.ichibaanlogic.com')}" style="color:#c0392b;text-decoration:none;">${esc(issuer.billingWebsite ?? 'www.ichibaanlogic.com')}</a>
    </div>
  </div>

</div>
</body>
</html>`;

    const smtpInfo = await conn.transporter.sendMail({
      from:        conn.from,
      to:          recipients.join(', '),
      cc:          cc.length > 0 ? cc.join(', ') : undefined,
      bcc:         bcc.length > 0 ? bcc.join(', ') : undefined,
      replyTo,
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
      bccAddresses: JSON.stringify(bcc),
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

/**
 * Authenticate against the mail server without sending anything.
 *
 * Reports WHICH identity it authenticated as, and whether that is the dedicated
 * invoice SMTP or the alert-Gmail fallback. A 535 rejection almost always means
 * the app password belongs to a different Google account than the username —
 * a mistake invisible from a bare pass/fail, and one that otherwise only
 * surfaces when a real invoice fails to send.
 */
export async function testInvoiceSmtp(): Promise<{
  ok: boolean; error?: string; from?: string; user?: string; host?: string; usingFallback?: boolean;
}> {
  let identity: { from?: string; user?: string; host?: string; usingFallback?: boolean } = {};
  try {
    const settings = await storage.getSettings();
    const dedicated = !!(settings.invoiceSmtpHost && settings.invoiceSmtpUser && settings.invoiceSmtpPass);
    identity = {
      user: dedicated ? settings.invoiceSmtpUser ?? undefined : (settings as any).alertGmailUser ?? undefined,
      host: dedicated ? settings.invoiceSmtpHost ?? undefined : 'smtp.gmail.com',
      usingFallback: !dedicated,
    };

    const conn = await buildInvoiceTransporter();
    if (!conn) {
      // Name the empty fields. "Not configured" sent an operator hunting for a
      // credential problem when the actual cause was a blank host field whose
      // placeholder text reads exactly like a filled-in value.
      const missing = [
        !settings.invoiceSmtpHost && 'SMTP Host',
        !settings.invoiceSmtpUser && 'SMTP Username',
        !settings.invoiceSmtpPass && 'SMTP Password',
      ].filter(Boolean);
      return {
        ok: false, ...identity,
        error: missing.length
          ? `Invoice SMTP is incomplete — ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} empty. Fill ${missing.length === 1 ? 'it' : 'them'} in and save, then test again.`
          : 'Invoice SMTP not configured and no fallback Gmail config available',
      };
    }
    identity.from = conn.from;
    await conn.transporter.verify();
    return { ok: true, ...identity };
  } catch (err: any) {
    const hint = /535|invalid login|not accepted/i.test(String(err.message))
      ? ' — the server rejected these credentials. A Gmail app password is only valid for the account that generated it, so the username above must be that same mailbox.'
      : '';
    return { ok: false, error: `${err.message}${hint}`, ...identity };
  }
}
