/**
 * sippy-invoice.service.ts
 *
 * Layer 5B — Invoice Engine
 *
 * CRITICAL CONSTRAINT:
 *   Invoices MUST source data from invoice_cdr_snapshots ONLY.
 *   NEVER from live tariffs or live CDR cache.
 *   This is what makes invoices financially reproducible.
 *
 * Deployment flow (MANDATORY on first deploy):
 *   draft → review → approved → sent
 *
 *   Do NOT implement auto-send. Human approval is required.
 *
 * All functions are queue-safe. No global state.
 */

import { storage } from '../../storage';
import type {
  Invoice, InsertInvoice,
  InvoiceLineItem, InsertInvoiceLineItem,
  InvoiceCdrSnapshot, ClientBrandingProfile,
} from '@shared/schema';

// ── Invoice number generation ─────────────────────────────────────────────────

function generateInvoiceNumber(year: number, month: number, seq: number): string {
  const yy = String(year).slice(-2);
  const mm = String(month).padStart(2, '0');
  const nn = String(seq).padStart(4, '0');
  return `C-${yy}${mm}-${nn}`;
}

// ── Date helpers ──────────────────────────────────────────────────────────────

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const dt = typeof d === 'string' ? new Date(d.includes('T') || d.includes(' ') ? d : d + 'T00:00:00Z') : d;
  return `${String(dt.getUTCDate()).padStart(2,'0')}-${MONTHS[dt.getUTCMonth()]}-${dt.getUTCFullYear()}`;
}

function fmtDateDisplay(s: string): string {
  // e.g. "2026-05-18" → "18-May-2026"
  const parts = s.split('-');
  if (parts.length !== 3) return s;
  const [y, m, d] = parts;
  return `${d}-${MONTHS[+m - 1]}-${y}`;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return fmtDate(d);
}

// ── Number formatters ─────────────────────────────────────────────────────────

function fmtMins(secs: number | null | undefined): string {
  const mins = (secs ?? 0) / 60;
  return mins.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtAmt(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtRate(r: number): string {
  return r.toFixed(5);
}

// ── Country prefix lookup ─────────────────────────────────────────────────────

const COUNTRY_PREFIX: [string, string][] = [
  ['1',   'United States'],
  ['7',   'Russia'],
  ['20',  'Egypt'],
  ['27',  'South Africa'],
  ['30',  'Greece'],
  ['31',  'Netherlands'],
  ['32',  'Belgium'],
  ['33',  'France'],
  ['34',  'Spain'],
  ['36',  'Hungary'],
  ['39',  'Italy'],
  ['40',  'Romania'],
  ['41',  'Switzerland'],
  ['43',  'Austria'],
  ['44',  'United Kingdom'],
  ['45',  'Denmark'],
  ['46',  'Sweden'],
  ['47',  'Norway'],
  ['48',  'Poland'],
  ['49',  'Germany'],
  ['51',  'Peru'],
  ['52',  'Mexico'],
  ['54',  'Argentina'],
  ['55',  'Brazil'],
  ['56',  'Chile'],
  ['57',  'Colombia'],
  ['58',  'Venezuela'],
  ['60',  'Malaysia'],
  ['61',  'Australia'],
  ['62',  'Indonesia'],
  ['63',  'Philippines'],
  ['64',  'New Zealand'],
  ['65',  'Singapore'],
  ['66',  'Thailand'],
  ['81',  'Japan'],
  ['82',  'South Korea'],
  ['84',  'Vietnam'],
  ['86',  'China'],
  ['90',  'Turkey'],
  ['91',  'India'],
  ['92',  'Pakistan'],
  ['93',  'Afghanistan'],
  ['94',  'Sri Lanka'],
  ['95',  'Myanmar'],
  ['98',  'Iran'],
  ['212', 'Morocco'],
  ['213', 'Algeria'],
  ['216', 'Tunisia'],
  ['218', 'Libya'],
  ['234', 'Nigeria'],
  ['237', 'Cameroon'],
  ['249', 'Sudan'],
  ['250', 'Rwanda'],
  ['251', 'Ethiopia'],
  ['254', 'Kenya'],
  ['255', 'Tanzania'],
  ['256', 'Uganda'],
  ['260', 'Zambia'],
  ['263', 'Zimbabwe'],
  ['351', 'Portugal'],
  ['352', 'Luxembourg'],
  ['353', 'Ireland'],
  ['354', 'Iceland'],
  ['355', 'Albania'],
  ['358', 'Finland'],
  ['370', 'Lithuania'],
  ['371', 'Latvia'],
  ['372', 'Estonia'],
  ['373', 'Moldova'],
  ['374', 'Armenia'],
  ['375', 'Belarus'],
  ['380', 'Ukraine'],
  ['381', 'Serbia'],
  ['385', 'Croatia'],
  ['386', 'Slovenia'],
  ['387', 'Bosnia and Herzegovina'],
  ['420', 'Czech Republic'],
  ['421', 'Slovakia'],
  ['502', 'Guatemala'],
  ['503', 'El Salvador'],
  ['504', 'Honduras'],
  ['505', 'Nicaragua'],
  ['506', 'Costa Rica'],
  ['507', 'Panama'],
  ['509', 'Haiti'],
  ['591', 'Bolivia'],
  ['593', 'Ecuador'],
  ['595', 'Paraguay'],
  ['598', 'Uruguay'],
  ['670', 'East Timor'],
  ['673', 'Brunei'],
  ['675', 'Papua New Guinea'],
  ['679', 'Fiji'],
  ['852', 'Hong Kong'],
  ['853', 'Macau'],
  ['855', 'Cambodia'],
  ['856', 'Laos'],
  ['880', 'Bangladesh'],
  ['886', 'Taiwan'],
  ['960', 'Maldives'],
  ['961', 'Lebanon'],
  ['962', 'Jordan'],
  ['963', 'Syria'],
  ['964', 'Iraq'],
  ['965', 'Kuwait'],
  ['966', 'Saudi Arabia'],
  ['967', 'Yemen'],
  ['968', 'Oman'],
  ['971', 'United Arab Emirates'],
  ['972', 'Israel'],
  ['973', 'Bahrain'],
  ['974', 'Qatar'],
  ['975', 'Bhutan'],
  ['976', 'Mongolia'],
  ['977', 'Nepal'],
  ['992', 'Tajikistan'],
  ['993', 'Turkmenistan'],
  ['994', 'Azerbaijan'],
  ['995', 'Georgia'],
  ['996', 'Kyrgyzstan'],
  ['998', 'Uzbekistan'],
];

// Sort longest-first so more specific matches win
const SORTED_PREFIXES = [...COUNTRY_PREFIX].sort((a, b) => b[0].length - a[0].length);

function getCountryFromPrefix(prefix: string): string {
  const digits = (prefix ?? '').replace(/\D/g, '');
  if (!digits) return 'Unknown';
  for (const [code, name] of SORTED_PREFIXES) {
    if (digits.startsWith(code)) return name;
  }
  return `Unknown (${digits.slice(0, 3)})`;
}

// ── Destination grouping ──────────────────────────────────────────────────────

interface DestRow {
  country:     string;
  destination: string;
  durationSecs: number;
  amount:      number;
  rate:        number;
}

interface CountrySummaryRow {
  country:      string;
  durationSecs: number;
  amount:       number;
}

function buildDestRows(snapshots: InvoiceCdrSnapshot[]): {
  destRows: DestRow[];
  countryRows: CountrySummaryRow[];
} {
  // Group by (country, prefix, rate_rounded_5)
  const groups = new Map<string, DestRow>();

  for (const s of snapshots) {
    const prefix  = s.prefix ?? s.callee ?? '';
    const country = getCountryFromPrefix(prefix);
    const mins    = (s.durationSecs ?? 0) / 60;
    const cost    = s.reproducedCost ?? 0;
    const rate    = mins > 0 ? +(cost / mins).toFixed(5) : 0;
    const key     = `${country}||${prefix}||${rate.toFixed(5)}`;

    const existing = groups.get(key);
    if (existing) {
      existing.durationSecs += s.durationSecs ?? 0;
      existing.amount       += cost;
    } else {
      groups.set(key, { country, destination: prefix, durationSecs: s.durationSecs ?? 0, amount: cost, rate });
    }
  }

  // Sort: country asc, then destination asc, then rate asc
  const destRows = [...groups.values()].sort((a, b) =>
    a.country.localeCompare(b.country) || a.destination.localeCompare(b.destination) || a.rate - b.rate
  );

  // Country summary
  const countryMap = new Map<string, CountrySummaryRow>();
  for (const row of destRows) {
    const existing = countryMap.get(row.country);
    if (existing) {
      existing.durationSecs += row.durationSecs;
      existing.amount       += row.amount;
    } else {
      countryMap.set(row.country, { country: row.country, durationSecs: row.durationSecs, amount: row.amount });
    }
  }
  const countryRows = [...countryMap.values()].sort((a, b) => a.country.localeCompare(b.country));

  return { destRows, countryRows };
}

// ── Billing cycle display ─────────────────────────────────────────────────────

function detectBillingCycle(periodStart: string, periodEnd: string): string {
  const start = new Date(periodStart + 'T00:00:00Z');
  const end   = new Date(periodEnd   + 'T00:00:00Z');
  const days  = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  if (days <= 8)  return 'Weekly - Cutoff';
  if (days <= 16) return 'Fortnightly - Cutoff';
  return 'Monthly - Cutoff';
}

// ── HTML invoice generation ───────────────────────────────────────────────────

export function generateInvoiceHtml(opts: {
  invoice:      Invoice;
  lineItems:    InvoiceLineItem[];
  snapshots:    InvoiceCdrSnapshot[];
  customerName: string;
  periodLabel:  string;
  branding?:    ClientBrandingProfile | null;
  customerBranding?: ClientBrandingProfile | null;
}): string {
  const { invoice, snapshots, branding, customerBranding } = opts;
  const { destRows, countryRows } = buildDestRows(snapshots);

  const totalDurationSecs = countryRows.reduce((s, r) => s + r.durationSecs, 0);
  const totalAmount       = countryRows.reduce((s, r) => s + r.amount, 0);

  const billingCycle  = detectBillingCycle(invoice.periodStart, invoice.periodEnd);
  const paymentDays   = branding?.paymentTermsDays ?? 6;
  const dueDate       = addDays(invoice.periodEnd, paymentDays);
  const invoiceDate   = fmtDate(invoice.generatedAt ?? new Date());
  const periodDisplay = `${fmtDateDisplay(invoice.periodStart)} - ${fmtDateDisplay(invoice.periodEnd)}`;

  // Biller (our company) info from global branding profile
  const billerName    = branding?.companyName ?? 'Billing Company';
  const billerAddr1   = branding?.addressLine1 ?? '';
  const billerAddr2   = [branding?.addressLine2, branding?.city, branding?.country].filter(Boolean).join(', ');

  // Customer (bill-to) info from customer-specific branding profile
  const custAddr1 = customerBranding?.addressLine1 ?? '';
  const custAddr2 = customerBranding?.addressLine2 ?? '';
  const custCity  = [customerBranding?.city, customerBranding?.country].filter(Boolean).join(', ');

  // Banking details
  const bankName       = branding?.bankName ?? '';
  const beneficiary    = branding?.companyName ?? billerName;
  const bankAddrInstr  = branding?.paymentInstructions ?? '';  // bank's physical address
  const accountNo      = branding?.accountNumber ?? '';
  const swiftCode      = branding?.swift ?? '';
  const ibanNo         = branding?.iban ?? '';
  const hasBanking     = !!(bankName || accountNo || swiftCode);

  // Banking detail rows (structured)
  const bankRows: [string, string][] = [];
  if (bankName)       bankRows.push(['', bankName]);
  if (beneficiary)    bankRows.push(['Beneficiary Name:', beneficiary]);
  if (bankAddrInstr)  bankRows.push(['Bank Address:', bankAddrInstr]);
  if (ibanNo)         bankRows.push(['IBAN / Account Number:', ibanNo]);
  else if (accountNo) bankRows.push(['Account Number:', accountNo]);
  bankRows.push(['Account Currency:', 'USD']);
  if (swiftCode)      bankRows.push(['Bank Swift Code:', swiftCode]);

  // Free-text banking details block (if set)
  const freeTextBanking = branding?.bankingDetails ?? '';

  const bankingHtml = hasBanking ? `
  <div class="section banking-section">
    <div class="section-title">BANKING DETAIL</div>
    <p class="banking-intro">Payments to <strong>${billerName}</strong> shall be only transferred to one of our below stated bank accounts:</p>
    <table class="banking-table">
      <tbody>
        ${bankRows.map(([label, value]) => `
          <tr>
            <td class="bk-label">${label}</td>
            <td class="bk-value"><strong>${value}</strong></td>
          </tr>`).join('')}
      </tbody>
    </table>
    ${freeTextBanking ? `<div class="banking-freetext">${freeTextBanking.replace(/\n/g,'<br>')}</div>` : ''}
  </div>` : '';

  // Country summary rows
  const countrySummaryHtml = countryRows.map(r => `
    <tr>
      <td class="col-country">${r.country}</td>
      <td class="col-num">${fmtMins(r.durationSecs)}</td>
      <td class="col-num">${fmtAmt(r.amount)}</td>
    </tr>`).join('');

  // Detailed breakdown rows — show country only on first row for that country
  let lastCountry = '';
  const detailHtml = destRows.map(r => {
    const showCountry = r.country !== lastCountry;
    lastCountry = r.country;
    return `
    <tr>
      <td class="col-country-det">${showCountry ? r.country : ''}</td>
      <td class="col-dest">${r.destination}</td>
      <td class="col-num">${fmtMins(r.durationSecs)}</td>
      <td class="col-num">${fmtRate(r.rate)}</td>
      <td class="col-num">${fmtAmt(r.amount)}</td>
    </tr>`;
  }).join('');

  const customerType = 'Postpaid';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Invoice ${invoice.invoiceNumber}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 11px;
    color: #000;
    background: #fff;
    padding: 32px 40px;
    line-height: 1.4;
  }

  /* ── Header ── */
  .inv-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 28px;
    border-bottom: 1px solid #ccc;
    padding-bottom: 20px;
  }
  .inv-title {
    font-size: 22px;
    font-weight: bold;
    letter-spacing: 2px;
    color: #1a1a2e;
    margin-bottom: 12px;
    text-align: right;
  }
  .bill-to {
    flex: 1;
    padding-right: 24px;
  }
  .bill-to-name {
    font-size: 14px;
    font-weight: bold;
    margin-bottom: 4px;
  }
  .bill-to-addr {
    font-size: 10px;
    color: #444;
    line-height: 1.6;
  }
  .meta-block {
    min-width: 280px;
    text-align: right;
  }
  .meta-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 10.5px;
    margin-top: 6px;
  }
  .meta-table td {
    padding: 2px 4px;
    vertical-align: top;
  }
  .meta-label {
    color: #555;
    text-align: left;
    white-space: nowrap;
  }
  .meta-value {
    font-weight: bold;
    text-align: right;
    padding-left: 12px;
  }

  /* ── Sections ── */
  .section {
    margin-bottom: 24px;
  }
  .section-title {
    font-size: 11px;
    font-weight: bold;
    text-align: center;
    letter-spacing: 1px;
    padding: 5px 0;
    margin-bottom: 8px;
    border-top: 1px solid #555;
    border-bottom: 1px solid #555;
  }

  /* ── Summary & Detail tables ── */
  .data-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 10.5px;
  }
  .data-table thead tr {
    background: #e8e8e8;
  }
  .data-table th {
    padding: 5px 8px;
    text-align: left;
    font-weight: bold;
    border: 1px solid #ccc;
    font-size: 10px;
    letter-spacing: 0.03em;
  }
  .data-table th.col-num,
  .data-table td.col-num {
    text-align: right;
  }
  .data-table tbody tr:nth-child(even) { background: #f9f9f9; }
  .data-table tbody tr:hover { background: #f0f4ff; }
  .data-table td {
    padding: 4px 8px;
    border: 1px solid #e0e0e0;
    vertical-align: top;
  }
  .col-country     { width: 28%; }
  .col-num         { text-align: right !important; width: 18%; font-variant-numeric: tabular-nums; }
  .col-country-det { width: 18%; }
  .col-dest        { width: 35%; }
  .total-row td {
    border-top: 2px solid #555;
    font-weight: bold;
    background: #f0f0f0 !important;
  }
  .total-label {
    text-align: right !important;
    padding-right: 12px;
  }

  /* ── Banking ── */
  .banking-section { margin-bottom: 28px; }
  .banking-intro { font-size: 10px; margin-bottom: 8px; color: #333; }
  .banking-table {
    width: 60%;
    border-collapse: collapse;
    font-size: 10.5px;
    margin: 0 auto;
  }
  .banking-table td { padding: 3px 8px; vertical-align: top; }
  .bk-label { color: #555; width: 38%; }
  .bk-value { }
  .banking-freetext { margin-top: 10px; font-size: 10px; color: #444; white-space: pre-line; }

  /* ── Footer ── */
  .invoice-footer {
    margin-top: 24px;
    padding-top: 10px;
    border-top: 1px solid #ccc;
    font-size: 9px;
    color: #777;
    text-align: center;
  }

  /* ── Print ── */
  @media print {
    body { padding: 16px 24px; }
    .banking-table { width: 70%; }
  }
</style>
</head>
<body>

<!-- ── Header ────────────────────────────────────────────────────────── -->
<div class="inv-header">
  <div class="bill-to">
    <div class="bill-to-name">${opts.customerName}</div>
    ${custAddr1 ? `<div class="bill-to-addr">${[custAddr1, custAddr2, custCity].filter(Boolean).join('<br>')}</div>` : ''}
  </div>
  <div class="meta-block">
    <div class="inv-title">INVOICE</div>
    <table class="meta-table">
      <tbody>
        <tr><td class="meta-label">Invoice #:</td>            <td class="meta-value">${invoice.invoiceNumber}</td></tr>
        <tr><td class="meta-label">Invoice Created:</td>      <td class="meta-value">${invoiceDate}</td></tr>
        <tr><td class="meta-label">Due Date:</td>             <td class="meta-value">${dueDate}</td></tr>
        <tr><td class="meta-label">Customer Type:</td>        <td class="meta-value">${customerType}</td></tr>
        <tr><td class="meta-label">Billing Cycle:</td>        <td class="meta-value">${billingCycle}</td></tr>
        <tr><td class="meta-label">Billing Time Zone:</td>    <td class="meta-value">GMT 0</td></tr>
        <tr><td class="meta-label">Billing Period:</td>       <td class="meta-value">${periodDisplay}</td></tr>
      </tbody>
    </table>
  </div>
</div>

<!-- ── Country Summary ────────────────────────────────────────────────── -->
<div class="section">
  <table class="data-table">
    <thead>
      <tr>
        <th class="col-country">Country</th>
        <th class="col-num">Minutes</th>
        <th class="col-num">Amount (USD)</th>
      </tr>
    </thead>
    <tbody>
      ${countrySummaryHtml}
      <tr class="total-row">
        <td class="total-label" colspan="1">Total</td>
        <td class="col-num">${fmtMins(totalDurationSecs)}</td>
        <td class="col-num">${fmtAmt(totalAmount)}</td>
      </tr>
    </tbody>
  </table>
</div>

<!-- ── Banking Detail ─────────────────────────────────────────────────── -->
${bankingHtml}

<!-- ── Destination Breakdown ─────────────────────────────────────────── -->
<div class="section">
  <table class="data-table">
    <thead>
      <tr>
        <th class="col-country-det">Country</th>
        <th class="col-dest">Destination</th>
        <th class="col-num">Minutes</th>
        <th class="col-num">Rate/Min</th>
        <th class="col-num">Amount (USD)</th>
      </tr>
    </thead>
    <tbody>
      ${detailHtml}
      <tr class="total-row">
        <td class="total-label" colspan="2">Total</td>
        <td class="col-num">${fmtMins(totalDurationSecs)}</td>
        <td class="col-num"></td>
        <td class="col-num">${fmtAmt(totalAmount)}</td>
      </tr>
    </tbody>
  </table>
</div>

<!-- ── Footer ────────────────────────────────────────────────────────── -->
<div class="invoice-footer">
  ${invoice.status === 'draft' ? '<strong>⚠ DRAFT — NOT APPROVED FOR PAYMENT</strong> · ' : ''}
  ${invoice.status === 'review' ? '<strong>REVIEW COPY — PENDING APPROVAL</strong> · ' : ''}
  Generated by BitsAuto Platform · Invoice ${invoice.invoiceNumber}
  ${invoice.notes ? ` · Notes: ${invoice.notes}` : ''}
</div>

</body>
</html>`;
}

// ── Core invoice operations ───────────────────────────────────────────────────

/**
 * Generate an invoice from immutable rating snapshots.
 * Sources ONLY from invoice_cdr_snapshots — never live tariffs.
 */
export async function generateInvoice(opts: {
  iTariff:      string;
  periodStart:  string;
  periodEnd:    string;
  customerName: string;
  notes?:       string;
}): Promise<{ invoice: Invoice; lineCount: number }> {
  const snapshots = await storage.listInvoiceCdrSnapshots({
    iTariff: opts.iTariff,
    limit:   50000,
  });

  // Filter to period — normalize to YYYY-MM-DD so timestamps with time components
  // ("2026-05-24 14:23:45") compare correctly against bare date strings.
  const inPeriod = snapshots.filter(s => {
    if (!s.cdrStartTime) return true;
    const d = String(s.cdrStartTime).slice(0, 10);
    return d >= opts.periodStart && d <= opts.periodEnd;
  });

  if (inPeriod.length === 0) {
    throw new Error(
      `No locked snapshots for tariff ${opts.iTariff} in period ${opts.periodStart}–${opts.periodEnd}. ` +
      'Run Rating Verification + Lock Batch first.'
    );
  }

  let totalReproduced = 0;
  let totalActual     = 0;
  let totalDelta      = 0;

  for (const s of inPeriod) {
    totalReproduced += s.reproducedCost ?? 0;
    totalActual     += s.actualCost ?? 0;
    totalDelta      += s.delta ?? 0;
  }

  // Generate invoice number
  const d   = new Date();
  const seq = await storage.countInvoices() + 1;
  const invoiceNumber = generateInvoiceNumber(d.getUTCFullYear(), d.getUTCMonth() + 1, seq);

  const invoiceData: InsertInvoice = {
    invoiceNumber,
    iTariff:         opts.iTariff,
    customerName:    opts.customerName,
    periodStart:     opts.periodStart,
    periodEnd:       opts.periodEnd,
    totalReproduced: +totalReproduced.toFixed(6),
    totalActual:     +totalActual.toFixed(6),
    totalDelta:      +totalDelta.toFixed(6),
    lineCount:       inPeriod.length,
    status:          'draft',
    notes:           opts.notes,
    generatedAt:     new Date(),
  };

  const invoice = await storage.createInvoice(invoiceData);

  // Insert line items in batches
  const lineItemBatch: InsertInvoiceLineItem[] = inPeriod.map(s => ({
    invoiceId:      invoice.id,
    snapshotId:     s.id,
    cdrCallId:      s.cdrId,
    prefix:         s.prefix,
    durationSecs:   s.durationSecs,
    reproducedCost: s.reproducedCost,
    actualCost:     s.actualCost,
    delta:          s.delta,
  }));

  for (let i = 0; i < lineItemBatch.length; i += 500) {
    await storage.bulkCreateInvoiceLineItems(lineItemBatch.slice(i, i + 500));
  }

  // Fetch branding profiles for HTML generation
  let branding:         ClientBrandingProfile | null = null;
  let customerBranding: ClientBrandingProfile | null = null;
  try {
    const [globalProfiles, customerProfiles] = await Promise.all([
      storage.listBrandingProfiles({ isGlobal: true }),
      storage.listBrandingProfiles({ clientName: opts.customerName }),
    ]);
    branding         = globalProfiles[0]   ?? null;
    customerBranding = customerProfiles[0] ?? null;
  } catch (_) {
    // non-fatal — invoice still generates without branding
  }

  // Generate HTML and update
  const lineItems = await storage.listInvoiceLineItems(invoice.id);
  const html = generateInvoiceHtml({
    invoice,
    lineItems,
    snapshots:       inPeriod,
    customerName:    opts.customerName,
    periodLabel:     `${opts.periodStart} — ${opts.periodEnd}`,
    branding,
    customerBranding,
  });
  await storage.updateInvoice(invoice.id, { htmlContent: html });

  return { invoice: { ...invoice, htmlContent: html }, lineCount: inPeriod.length };
}

export async function approveInvoice(id: number): Promise<Invoice> {
  const invoice = await storage.getInvoice(id);
  if (!invoice) throw new Error(`Invoice #${id} not found`);
  if (invoice.status === 'sent') throw new Error('Cannot approve a sent invoice');
  return storage.updateInvoice(id, { status: 'approved', approvedAt: new Date() });
}

export async function voidInvoice(id: number): Promise<Invoice> {
  return storage.updateInvoice(id, { status: 'void' });
}

export async function getInvoiceWithLineItems(id: number): Promise<{
  invoice: Invoice;
  lineItems: InvoiceLineItem[];
} | null> {
  const invoice = await storage.getInvoice(id);
  if (!invoice) return null;
  const lineItems = await storage.listInvoiceLineItems(invoice.id);
  return { invoice, lineItems };
}
