/**
 * sippy-invoice-templates.service.ts
 *
 * Multi-Template Invoice Rendering Engine
 *
 * Manages invoice rendering templates and client branding profiles.
 * Templates control:
 *   - Detail level (full | summary | minimal)
 *   - Prefix/destination breakdown visibility
 *   - Filename and email subject patterns
 *   - Branding profile linkage
 *
 * Branding profiles control:
 *   - Company name, logo, colors
 *   - Banking details and payment terms
 *   - Invoice footer text
 *
 * Key operations:
 *   resolveTemplate(clientName)    — find best template for a client (client > default)
 *   renderFilename(template, job)  — expand filename pattern tokens
 *   renderSubjectLine(template, job) — expand subject line tokens
 *   renderInvoiceHtml(template, branding, job, invoice) — full HTML rendering
 */

import { storage } from '../../storage';
import type { InvoiceTemplate, ClientBrandingProfile } from '@shared/schema';

// ── Token expansion ────────────────────────────────────────────────────────────

function expandTokens(pattern: string, vars: Record<string, string>): string {
  return pattern.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`);
}

// ── Resolve best template for a client ────────────────────────────────────────

export async function resolveTemplate(clientName: string): Promise<InvoiceTemplate | null> {
  const templates = await storage.listInvoiceTemplates({ clientName });
  if (templates.length > 0) return templates[0];
  // Fall back to global default
  const defaults = await storage.listInvoiceTemplates({ isDefault: true });
  return defaults[0] ?? null;
}

// ── Resolve branding profile for a client ─────────────────────────────────────

export async function resolveBrandingProfile(clientName: string): Promise<ClientBrandingProfile | null> {
  const profiles = await storage.listBrandingProfiles({ clientName });
  if (profiles.length > 0) return profiles[0];
  const globals = await storage.listBrandingProfiles({ isGlobal: true });
  return globals[0] ?? null;
}

// ── Render filename from template pattern ─────────────────────────────────────

export function renderFilename(template: InvoiceTemplate | null, vars: {
  clientName: string;
  billingPeriod: string;
  invoiceId?: number;
}): string {
  const pattern = template?.filenamePattern ?? 'INV_{PERIOD}_{CLIENT}';
  const date = new Date().toISOString().slice(0, 10);
  const expanded = expandTokens(pattern, {
    PERIOD:  vars.billingPeriod,
    CLIENT:  vars.clientName.replace(/[^a-zA-Z0-9]/g, '_'),
    DATE:    date,
    ID:      String(vars.invoiceId ?? ''),
    YEAR:    vars.billingPeriod.slice(0, 4),
    MONTH:   vars.billingPeriod.slice(5, 7),
  });
  return `${expanded}.pdf`;
}

// ── Render email subject from template pattern ────────────────────────────────

export function renderSubjectLine(template: InvoiceTemplate | null, vars: {
  clientName: string;
  billingPeriod: string;
  invoiceId?: number;
}): string {
  const pattern = template?.subjectLinePattern ?? 'Invoice {PERIOD} — {CLIENT}';
  return expandTokens(pattern, {
    PERIOD:  vars.billingPeriod,
    CLIENT:  vars.clientName,
    DATE:    new Date().toISOString().slice(0, 10),
    ID:      String(vars.invoiceId ?? ''),
  });
}

// ── Full HTML invoice rendering ────────────────────────────────────────────────

export function renderInvoiceHtml(
  template:  InvoiceTemplate | null,
  branding:  ClientBrandingProfile | null,
  invoice:   any,
  job:       any,
): string {
  const primary    = branding?.primaryColor  ?? '#1a6e3c';
  const secondary  = branding?.secondaryColor ?? '#0f4c2a';
  const company    = branding?.companyName   ?? 'BitsAuto';
  const footer     = branding?.invoiceFooterText ?? 'Thank you for your business.';
  const terms      = branding?.paymentTermsDays ?? 30;
  const period     = job?.billingPeriod ?? invoice?.billingPeriod ?? '';
  const client     = job?.clientName ?? invoice?.clientName ?? '';
  const amount     = invoice?.totalAmountUsd != null ? `$${Number(invoice.totalAmountUsd).toFixed(2)}` : 'See attached';
  const invoiceNum = invoice?.invoiceNumber ?? invoice?.id ?? '';
  const dueDate    = invoice?.dueDate
    ? new Date(invoice.dueDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
    : '';

  const detailLevel  = template?.detailLevel  ?? 'full';
  const showPrefix   = template?.showPrefixBreakdown    ?? false;
  const showDest     = template?.showDestinationSummary ?? false;

  const bankingHtml = branding?.bankingDetails ? `
    <div style="background:#f9f9f9; border:1px solid #e5e5e5; border-radius:4px; padding:16px; margin-top:16px;">
      <h4 style="color:${secondary}; margin:0 0 8px;">Banking Details</h4>
      <pre style="font-family:monospace; font-size:12px; white-space:pre-wrap; color:#333;">${branding.bankingDetails}</pre>
    </div>` : (branding?.bankName ? `
    <div style="background:#f9f9f9; border:1px solid #e5e5e5; border-radius:4px; padding:16px; margin-top:16px;">
      <h4 style="color:${secondary}; margin:0 0 8px;">Payment Details</h4>
      <table style="font-size:13px; color:#333;">
        ${branding.bankName    ? `<tr><td style="padding:3px 12px 3px 0;color:#666;">Bank:</td><td>${branding.bankName}</td></tr>` : ''}
        ${branding.accountNumber ? `<tr><td style="padding:3px 12px 3px 0;color:#666;">Account:</td><td>${branding.accountNumber}</td></tr>` : ''}
        ${branding.iban         ? `<tr><td style="padding:3px 12px 3px 0;color:#666;">IBAN:</td><td>${branding.iban}</td></tr>` : ''}
        ${branding.swift        ? `<tr><td style="padding:3px 12px 3px 0;color:#666;">SWIFT:</td><td>${branding.swift}</td></tr>` : ''}
      </table>
    </div>` : '');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Invoice ${period} — ${client}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; color: #333; max-width: 800px; margin: 0 auto; padding: 32px 24px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid ${primary}; padding-bottom: 20px; margin-bottom: 24px; }
  .company-name { font-size: 24px; font-weight: bold; color: ${primary}; }
  .invoice-title { text-align: right; }
  .invoice-title h2 { color: ${secondary}; margin: 0; font-size: 20px; }
  .invoice-title .ref { font-size: 13px; color: #666; margin-top: 4px; }
  .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px; }
  .meta-box h4 { margin: 0 0 8px; font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; }
  .amount-box { background: ${primary}; color: white; border-radius: 8px; padding: 16px 20px; display: flex; justify-content: space-between; align-items: center; margin: 20px 0; }
  .amount-box .label { font-size: 13px; opacity: 0.85; }
  .amount-box .value { font-size: 28px; font-weight: bold; }
  table.items { width: 100%; border-collapse: collapse; font-size: 13px; margin: 16px 0; }
  table.items th { background: ${secondary}; color: white; padding: 8px 12px; text-align: left; }
  table.items td { padding: 8px 12px; border-bottom: 1px solid #f0f0f0; }
  table.items tr:nth-child(even) td { background: #fafafa; }
  .footer-text { border-top: 1px solid #e5e5e5; margin-top: 32px; padding-top: 16px; font-size: 12px; color: #888; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="company-name">${company}</div>
      ${branding?.addressLine1 ? `<div style="font-size:12px;color:#666;margin-top:4px;">${[branding.addressLine1, branding.addressLine2, branding.city, branding.country].filter(Boolean).join(', ')}</div>` : ''}
      ${branding?.taxId ? `<div style="font-size:12px;color:#888;">Tax ID: ${branding.taxId}</div>` : ''}
    </div>
    <div class="invoice-title">
      <h2>INVOICE</h2>
      ${invoiceNum ? `<div class="ref">No. ${invoiceNum}</div>` : ''}
      <div class="ref">Period: ${period}</div>
      ${dueDate ? `<div class="ref">Due: ${dueDate}</div>` : ''}
    </div>
  </div>

  <div class="meta-grid">
    <div class="meta-box">
      <h4>Bill To</h4>
      <div style="font-weight:bold;">${client}</div>
    </div>
    <div class="meta-box">
      <h4>Invoice Date</h4>
      <div>${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
      <div style="font-size:12px;color:#666;margin-top:4px;">Payment Terms: Net ${terms} days</div>
    </div>
  </div>

  <div class="amount-box">
    <div><div class="label">Billing Period</div><div style="font-weight:bold;">${period}</div></div>
    <div style="text-align:right;"><div class="label">Total Amount Due</div><div class="value">${amount}</div></div>
  </div>

  ${detailLevel === 'full' && invoice ? `
  <table class="items">
    <thead><tr><th>Description</th><th>Minutes</th><th>Calls</th><th>Amount</th></tr></thead>
    <tbody>
      <tr>
        <td>Telecom Services — ${period}</td>
        <td>${invoice.durationMinutes != null ? Number(invoice.durationMinutes).toFixed(1) : '—'}</td>
        <td>${invoice.callCount ?? '—'}</td>
        <td><strong>${amount}</strong></td>
      </tr>
    </tbody>
  </table>` : ''}

  ${branding?.paymentInstructions ? `<div style="margin-top:16px;"><h4 style="color:${secondary};">Payment Instructions</h4><p style="font-size:13px;">${branding.paymentInstructions}</p></div>` : ''}

  ${bankingHtml}

  <div class="footer-text">${footer}</div>
</body>
</html>`;
}

// ── Convenience: create default global template + branding ────────────────────

export async function ensureDefaultTemplate(): Promise<InvoiceTemplate> {
  const existing = await storage.listInvoiceTemplates({ isDefault: true });
  if (existing.length > 0) return existing[0];
  return storage.createInvoiceTemplate({
    templateName:   'Standard Invoice',
    templateType:   'standard',
    detailLevel:    'full',
    isDefault:      true,
    attachPdfEnabled: true,
    filenamePattern:    'INV_{PERIOD}_{CLIENT}',
    subjectLinePattern: 'Invoice {PERIOD} — {CLIENT}',
  });
}
