/**
 * invoice-pdf.service.ts
 *
 * Renders an invoice as a real PDF.
 *
 * The platform previously served HTML from a URL ending in /pdf and attached
 * HTML to customer emails. The legacy billing system sent genuine PDFs, so
 * that was a regression in what the customer receives — this closes it.
 *
 * Built on pdfkit rather than headless-browser HTML-to-PDF. Rendering the
 * existing HTML template would keep one layout instead of two, which is the
 * better architecture in the abstract; it needs Chromium, which is neither
 * installed nor declared in this deployment's nix packages, and adding ~300MB
 * to a working production image is a bigger risk than maintaining a second
 * layout. pdfkit is already a dependency and already renders the DMR export
 * here, so it is the path that ships.
 *
 * Page structure:
 *   header — brand, invoice number, customer
 *   parties — bill-to and issuer
 *   summary — period, calls, totals
 *   detail — charges grouped by destination, paginated
 *   footer — company details, page numbers
 */

import fs from 'fs';
import path from 'path';
import { db } from '../db';
import { sql } from 'drizzle-orm';
import { fmtInvoiceDate } from '../invoice-terms';

const DARK  = '#1a1a2e';
const BRICK = '#c0392b';
const GRAY  = '#666666';
const RULE  = '#dddddd';

/**
 * Locate the brand logo.
 *
 * __dirname is unavailable under ESM (the dev server) and points at dist/ in the
 * bundled CJS build, where the asset does not exist — so the logo silently never
 * loaded and the invoice fell back to plain text in BOTH environments. Resolved
 * from the working directory instead, which is the project root in each.
 */
function logoPath(): string | null {
  for (const rel of ['server/assets/ichibaan-logo.png', 'assets/ichibaan-logo.png']) {
    try {
      const p = path.join(process.cwd(), rel);
      if (fs.existsSync(p)) return p;
    } catch { /* try the next candidate */ }
  }
  return null;
}

export interface InvoicePdfResult { buffer: Buffer; filename: string; }

/** Filename a customer can file: client, invoice number, period. */
export function invoicePdfFilename(inv: {
  invoiceNumber: string; customerName?: string | null;
  periodStart?: string | null; periodEnd?: string | null;
}): string {
  const slug = (s: string) => String(s).trim().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const period = inv.periodStart && inv.periodEnd
    ? `_${String(inv.periodStart).slice(0, 10)}_to_${String(inv.periodEnd).slice(0, 10)}`
    : '';
  return `Ichibaan_${slug(inv.customerName ?? 'Client')}_Invoice_${slug(inv.invoiceNumber)}${period}.pdf`;
}

export async function renderInvoicePdf(invoiceId: number): Promise<InvoicePdfResult> {
  const invRes = await db.execute(sql`SELECT * FROM invoices WHERE id = ${invoiceId} LIMIT 1`);
  const inv: any = ((invRes as any).rows ?? [])[0];
  if (!inv) throw new Error(`Invoice #${invoiceId} not found`);

  // Charges grouped by destination. The rating engine resolves a destination
  // and prefix per call, so the customer sees where their money went rather
  // than a wall of call ids. Calls ingested before that engine carry neither,
  // and are grouped as unattributed rather than silently dropped.
  const detailRes = await db.execute(sql`
    SELECT coalesce(s.callee, 'Unattributed')  AS destination,
           coalesce(s.prefix, '—')             AS prefix,
           count(*)::int                        AS calls,
           coalesce(sum(li.duration_secs), 0)::int      AS seconds,
           coalesce(sum(li.actual_cost), 0)::numeric    AS amount
      FROM invoice_line_items li
      LEFT JOIN invoice_cdr_snapshots s ON s.id = li.snapshot_id
     WHERE li.invoice_id = ${invoiceId}
     GROUP BY 1, 2
     ORDER BY amount DESC`);
  const rows: any[] = (detailRes as any).rows ?? [];

  // Country rollup for the summary page. Sippy destination names carry the
  // country ahead of a dash ("PAKISTAN - MOBILE MOBILINK"), so the country is
  // the leading segment; anything without one groups under its own name rather
  // than being discarded.
  const countryRows: any[] = rows.reduce((acc: any[], r: any) => {
    const name = String(r.destination ?? '');
    const country = name.includes(' - ') ? name.split(' - ')[0].trim() : name;
    const hit = acc.find(a => a.country === country);
    if (hit) {
      hit.calls   += Number(r.calls ?? 0);
      hit.seconds += Number(r.seconds ?? 0);
      hit.amount  += Number(r.amount ?? 0);
    } else {
      acc.push({ country, calls: Number(r.calls ?? 0), seconds: Number(r.seconds ?? 0), amount: Number(r.amount ?? 0) });
    }
    return acc;
  }, []).sort((a: any, b: any) => b.amount - a.amount);

  // Issuer identity and remittance (migration 075). One authoritative record;
  // absent values are reported as unconfigured, never invented.
  let profile: any = {};
  try {
    const p = await db.execute(sql`
      SELECT billing_legal_name, billing_registered_address, billing_tax_id,
             billing_contact_email, billing_website,
             billing_trading_name, billing_registration_number, billing_vat_number,
             billing_support_email, billing_dispute_email, billing_default_currency,
             remit_beneficiary_name, remit_bank_name, remit_bank_branch,
             remit_bank_address, remit_account_number, remit_iban, remit_swift,
             remit_correspondent_bank, remit_currency, remit_notes,
             invoice_decimal_places, invoice_date_format,
             invoice_footer_note, invoice_terms_note
        FROM settings LIMIT 1`);
    profile = ((p as any).rows ?? [])[0] ?? {};
  } catch { /* an unconfigured profile is handled below */ }

  // Document formatting preferences (076). Money and date rendering follow the
  // profile so customer formatting requests are configuration, not code.
  // Unconfigured preserves today's exact rendering: 4dp lines, 2dp totals, ISO dates.
  const rawDp = Number(profile.invoice_decimal_places);
  const cfgDecimals = Number.isInteger(rawDp) && rawDp >= 0 && rawDp <= 6 ? rawDp : null;
  const dateFmt = (s: string | null | undefined) => fmtInvoiceDate(s, profile.invoice_date_format);

  // When the invoice falls due — the ONE shared lookup + rule (invoice-terms-db),
  // same as the email, the generation stamp and the invoice API. A due date
  // stamped at generation (076) outranks a live resolve: an issued document's
  // terms don't drift with the profile.
  const invoiceDate = String(inv.generated_at ?? inv.created_at ?? new Date().toISOString()).slice(0, 10);
  const { invoiceTermsForCustomer } = await import('../invoice-terms-db');
  const liveTerms = await invoiceTermsForCustomer(inv.customer_name, invoiceDate);
  const terms = inv.due_date
    ? {
        ...liveTerms,
        dueDate: String(inv.due_date).slice(0, 10),
        termLabel: inv.payment_terms_label ?? liveTerms.termLabel,
        basis: liveTerms.basis === 'prepaid' ? liveTerms.basis : 'postpaid' as const,
        dueLabel: liveTerms.basis === 'prepaid'
          ? liveTerms.dueLabel
          : `${inv.payment_terms_label ?? 'Payment'} — due ${String(inv.due_date).slice(0, 10)}`,
      }
    : liveTerms;

  // Currency belongs to the customer, not to this renderer. The document
  // previously printed USD unconditionally, which is simply wrong for a client
  // billed in anything else — a correctness fault on a customer-facing
  // document, not a presentation detail. Falls back to USD only when the
  // client record says nothing.
  // Last-resort default is the profile's configured currency, then USD.
  let currency = String(profile.billing_default_currency ?? '').trim().toUpperCase() || 'USD';
  try {
    const cur = await db.execute(sql`
      SELECT coalesce(nullif(sippy_tariff_currency, ''), nullif(currency, '')) AS cur
        FROM companies
       WHERE lower(name) = lower(${String(inv.customer_name ?? '')})
       LIMIT 1`);
    const c = ((cur as any).rows ?? [])[0]?.cur;
    if (c) currency = String(c).toUpperCase();
  } catch { /* keep the default rather than fail the render */ }

  // Stamped into the footer so a historical document identifies its renderer.
  let buildVersion = 'unknown';
  try {
    const { getBuildInfo } = await import('../build-info');
    buildVersion = getBuildInfo().version;
  } catch { /* the invoice matters more than its provenance line */ }

  const PDFDocument = (await import('pdfkit')).default;
  const chunks: Buffer[] = [];

  await new Promise<void>((resolve, reject) => {
    // bufferPages is required for the footer pass: without it
    // bufferedPageRange() reports only the current page, so a multi-page
    // invoice would carry a footer on its last page and read "Page 1 of 1".
    const doc = new PDFDocument({
      margin: 40, size: 'A4', bufferPages: true,
      // Document properties, so the file identifies itself in a reader, a
      // search index or a customer's document management system rather than
      // showing only a filename.
      info: {
        Title:    `Invoice ${inv.invoice_number}`,
        Author:   'Ichibaan Logic Private Limited',
        Subject:  inv.period_start
          ? `Invoice for ${inv.customer_name ?? 'customer'} — ${String(inv.period_start).slice(0, 10)} to ${String(inv.period_end ?? '').slice(0, 10)}`
          : `Invoice for ${inv.customer_name ?? 'customer'}`,
        Keywords: ['Invoice', inv.invoice_number, inv.customer_name ?? '', 'Ichibaan Logic', 'Billing']
          .filter(Boolean).join(', '),
        Creator:  'BitsAuto Billing',
      },
    });
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve());
    doc.on('error', reject);

    const L = 40;
    const W = doc.page.width - 80;
    const money = (n: any) => Number(n ?? 0).toFixed(cfgDecimals ?? 4);
    const mins  = (secs: any) => (Number(secs ?? 0) / 60).toFixed(2);

    // ── Header ──────────────────────────────────────────────────────────────
    const lp = logoPath();
    if (lp) {
      try { doc.image(lp, L, 36, { height: 34 }); } catch { /* non-fatal */ }
    } else {
      doc.fontSize(15).fillColor(DARK).font('Helvetica-Bold').text('ICHIBAAN LOGIC', L, 40);
    }
    doc.fontSize(20).fillColor(DARK).font('Helvetica-Bold')
      .text('INVOICE', L, 38, { width: W, align: 'right' });
    doc.fontSize(10).fillColor(BRICK).font('Helvetica-Bold')
      .text(inv.invoice_number, L, doc.y + 2, { width: W, align: 'right' });

    let y = 84;
    doc.moveTo(L, y).lineTo(L + W, y).strokeColor(BRICK).lineWidth(2).stroke();
    y += 18;

    // ── Parties ─────────────────────────────────────────────────────────────
    const colW = W / 2 - 10;
    doc.fontSize(7.5).fillColor(GRAY).font('Helvetica-Bold').text('BILL TO', L, y);
    doc.fontSize(11).fillColor(DARK).font('Helvetica-Bold')
      .text(inv.customer_name ?? '', L, doc.y + 3, { width: colW });

    doc.fontSize(7.5).fillColor(GRAY).font('Helvetica-Bold').text('FROM', L + colW + 20, y);
    // Issuer identity from the configured profile, falling back to the values
    // that were previously hardcoded here so an unconfigured install still
    // produces a complete invoice.
    doc.fontSize(9).fillColor(DARK).font('Helvetica')
      .text(profile.billing_legal_name ?? 'Ichibaan Logic Private Limited', L + colW + 20, doc.y + 3, { width: colW })
      .fontSize(8).fillColor(GRAY);
    if (profile.billing_trading_name) {
      doc.text(`Trading as ${profile.billing_trading_name}`, { width: colW });
    }
    doc.text(profile.billing_registered_address
        ?? 'Unit Level 11(A), Main Office Tower, Jalan Merdeka,\nFinancial Park Labuan, 87000 Labuan, Malaysia',
        { width: colW })
      .text(profile.billing_contact_email ?? 'billing@ichibaanlogic.com', { width: colW });
    if (profile.billing_registration_number) {
      doc.text(`Reg. No: ${profile.billing_registration_number}`, { width: colW });
    }
    if (profile.billing_tax_id) {
      doc.text(`Tax ID: ${profile.billing_tax_id}`, { width: colW });
    }
    if (profile.billing_vat_number) {
      doc.text(`VAT: ${profile.billing_vat_number}`, { width: colW });
    }

    y = doc.y + 16;

    // ── Section renderers ───────────────────────────────────────────────────
    // Each knows its own height, returns the Y it finished at, and asks for a
    // page only when it needs one. Layout drift — a section overflowing into
    // whatever follows — is what produced the blank-page bug, so nothing here
    // writes at a position it did not compute.

    type Col = { label: string; w: number; align: 'left' | 'right' };

    function renderTable(startY: number, title: string, cols: Col[], data: string[][]): number {
      let yy = startY;

      const head = (at: number) => {
        let x = L;
        doc.fontSize(7.5).fillColor(GRAY).font('Helvetica-Bold');
        for (const c of cols) {
          doc.text(c.label.toUpperCase(), x, at, { width: c.w - 6, align: c.align, lineBreak: false });
          x += c.w;
        }
        doc.moveTo(L, at + 12).lineTo(L + W, at + 12).strokeColor(RULE).lineWidth(0.5).stroke();
        return at + 18;
      };

      if (title) {
        doc.fontSize(9).fillColor(DARK).font('Helvetica-Bold')
          .text(title, L, yy, { width: W, lineBreak: false });
        yy += 16;
      }
      yy = head(yy);

      for (const cells of data) {
        // Break before writing, never after: the footer occupies the last 60pt.
        if (yy > doc.page.height - 110) {
          doc.addPage();
          yy = head(50);
        }
        let x = L;
        doc.fontSize(8.5).fillColor(DARK).font('Helvetica');
        cells.forEach((cell, i) => {
          doc.text(cell, x, yy, { width: cols[i].w - 6, align: cols[i].align, lineBreak: false });
          x += cols[i].w;
        });
        yy += 15;
      }

      if (data.length === 0) {
        doc.fontSize(9).fillColor(GRAY).font('Helvetica')
          .text('No billable calls in this period.', L, yy, { width: W });
        yy += 20;
      }
      return yy;
    }

    function renderPaymentInstructions(startY: number): number {
      let yy = startY;
      doc.fontSize(13).fillColor(DARK).font('Helvetica-Bold')
        .text('PAYMENT INSTRUCTIONS', L, yy, { width: W });
      yy += 6;
      doc.moveTo(L, yy + 12).lineTo(L + W, yy + 12).strokeColor(BRICK).lineWidth(2).stroke();
      yy += 26;

      const pairs: [string, string | null][] = [
        ['Beneficiary',    profile.remit_beneficiary_name ?? null],
        ['Bank',           profile.remit_bank_name        ?? null],
        ['Branch',         profile.remit_bank_branch      ?? null],
        ['Bank address',   profile.remit_bank_address     ?? null],
        ['Account number', profile.remit_account_number   ?? null],
        ['IBAN',           profile.remit_iban             ?? null],
        ['SWIFT / BIC',    profile.remit_swift            ?? null],
        ['Correspondent bank', profile.remit_correspondent_bank ?? null],
        ['Currency',       profile.remit_currency ?? currency],
        ['Payment reference', String(inv.invoice_number)],
      ];
      const configured = pairs.some(([k, v]) => v && k !== 'Currency' && k !== 'Payment reference');

      if (!configured) {
        // Say so rather than print an empty block a customer might try to pay into.
        doc.fontSize(9).fillColor(BRICK).font('Helvetica-Bold')
          .text('Remittance details are not configured.', L, yy, { width: W });
        yy += 14;
        doc.fontSize(8.5).fillColor(GRAY).font('Helvetica')
          .text('Please contact the billing department for payment instructions before remitting funds.',
            L, yy, { width: W });
        yy += 24;
      } else {
        for (const [label, value] of pairs) {
          if (!value) continue;
          doc.fontSize(8).fillColor(GRAY).font('Helvetica-Bold')
            .text(label.toUpperCase(), L, yy, { width: W * 0.3, lineBreak: false });
          doc.fontSize(9.5).fillColor(DARK).font('Helvetica')
            .text(String(value), L + W * 0.3, yy - 1, { width: W * 0.7 });
          yy = Math.max(yy + 16, doc.y + 4);
        }
      }

      if (profile.remit_notes) {
        yy += 8;
        doc.fontSize(8).fillColor(GRAY).font('Helvetica')
          .text(String(profile.remit_notes), L, yy, { width: W });
        yy = doc.y + 8;
      }

      // Terms
      yy += 10;
      doc.moveTo(L, yy).lineTo(L + W, yy).strokeColor(RULE).lineWidth(0.5).stroke();
      yy += 12;
      // Dates inside the sentence follow the configured date format.
      const dueSentence = terms.dueLabel.replace(/\d{4}-\d{2}-\d{2}/g, (m) => dateFmt(m));
      doc.fontSize(8).fillColor(GRAY).font('Helvetica')
        .text(`${dueSentence}. Quote invoice ${inv.invoice_number} as the payment reference.`,
          L, yy, { width: W });
      yy = doc.y + 8;
      if (profile.invoice_terms_note) {
        doc.text(String(profile.invoice_terms_note), L, yy, { width: W });
        yy = doc.y + 8;
      }
      // Dispute contact from the profile; unset falls back to the billing
      // email — the previous literal predated the configurable profile.
      const queriesEmail = profile.billing_contact_email ?? 'billing@ichibaanlogic.com';
      const disputeEmail = profile.billing_dispute_email ?? queriesEmail;
      doc.text(`Queries: ${queriesEmail} · Disputes: ${disputeEmail}`, L, yy, { width: W });
      return doc.y + 8;
    }

    // ── Summary strip ───────────────────────────────────────────────────────
    const period = inv.period_start
      ? `${String(inv.period_start).slice(0, 10)}  to  ${String(inv.period_end ?? '').slice(0, 10)}`
      : '—';
    const totalSecs = rows.reduce((s, r) => s + Number(r.seconds ?? 0), 0);
    const items: [string, string][] = [
      ['Billing period', period],
      ['Invoice date',   dateFmt(invoiceDate)],
      ['Payment terms',  terms.termLabel],
      // Unconfigured terms print as such — a dash Finance sees at review beats
      // a default deadline the customer never agreed to (owner rule).
      ['Payment due',
        terms.basis === 'prepaid' ? 'On receipt' : (terms.dueDate ? dateFmt(terms.dueDate) : '—')],
    ];
    const iw = W / items.length;
    items.forEach(([label, val], i) => {
      const x = L + i * iw;
      doc.fontSize(7).fillColor(GRAY).font('Helvetica-Bold').text(label.toUpperCase(), x, y, { width: iw - 6 });
      doc.fontSize(9.5).fillColor(DARK).font('Helvetica').text(val, x, y + 11, { width: iw - 6 });
    });
    y += 34;
    doc.moveTo(L, y).lineTo(L + W, y).strokeColor(RULE).lineWidth(0.5).stroke();
    y += 14;

    // ── Country summary (page 1) ────────────────────────────────────────────
    // What the customer wants first: where the money went, by country. The
    // call-level breakdown follows on its own page.
    y = renderTable(y, 'Charges by country', [
      { label: 'Country',              w: W * 0.44, align: 'left'  as const },
      { label: 'Calls',                w: W * 0.14, align: 'right' as const },
      { label: 'Minutes',              w: W * 0.20, align: 'right' as const },
      { label: `Amount (${currency})`, w: W * 0.22, align: 'right' as const },
    ], countryRows.map(c => [
      String(c.country),
      Number(c.calls).toLocaleString(),
      mins(c.seconds),
      money(c.amount),
    ]));

    // ── Total due ───────────────────────────────────────────────────────────
    y += 6;
    doc.moveTo(L, y).lineTo(L + W, y).strokeColor(DARK).lineWidth(1.5).stroke();
    y += 10;
    doc.fontSize(11).fillColor(DARK).font('Helvetica-Bold')
      .text('TOTAL DUE', L, y, { width: W * 0.6 })
      .fontSize(14)
      .text(`${currency} ${Number(inv.total_actual ?? 0).toFixed(cfgDecimals ?? 2)}`, L + W * 0.6, y - 2, { width: W * 0.4, align: 'right' });
    y += 24;
    doc.fontSize(8).fillColor(GRAY).font('Helvetica')
      .text(terms.dueLabel.replace(/\d{4}-\d{2}-\d{2}/g, (m) => dateFmt(m)), L, y, { width: W });

    // ── Call detail (page 2+) ───────────────────────────────────────────────
    // Destination level, never product identifiers: what the customer bought is
    // termination to a destination, not a row from an internal catalogue.
    doc.addPage();
    y = 50;
    y = renderTable(y, 'Call detail by destination', [
      { label: 'Destination',              w: W * 0.34, align: 'left'  as const },
      { label: 'Prefix',                   w: W * 0.10, align: 'left'  as const },
      { label: 'Calls',                    w: W * 0.11, align: 'right' as const },
      { label: 'Minutes',                  w: W * 0.15, align: 'right' as const },
      { label: `Rate/min (${currency})`,   w: W * 0.14, align: 'right' as const },
      { label: `Amount (${currency})`,     w: W * 0.16, align: 'right' as const },
    ], rows.map(r => {
      const m = Number(r.seconds ?? 0) / 60;
      return [
        String(r.destination), String(r.prefix),
        Number(r.calls).toLocaleString(), mins(r.seconds),
        m > 0 ? (Number(r.amount ?? 0) / m).toFixed(5) : '—',
        money(r.amount),
      ];
    }));

    if (rows.length === 0) {
      doc.fontSize(9).fillColor(GRAY).font('Helvetica')
        .text('No billable calls in this period.', L, y);
      y += 20;
    }

    // ── Payment instructions (final page) ───────────────────────────────────
    // Its own page: remittance details are fixed while the usage pages grow, so
    // they must never be pushed around by a long call detail.
    doc.addPage();
    y = 50;
    y = renderPaymentInstructions(y);

    // ── Footer on every page ────────────────────────────────────────────────
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      // The footer sits below the bottom margin, and pdfkit inserts a new page
      // whenever text is written past it. Each of the three lines below spawned
      // one — a one-page invoice came out as four, with three blank. Dropping
      // the bottom margin for the footer pass writes into that space instead of
      // paginating away from it. Reproduced and verified: 4 pages before, 1 after.
      const bottomMargin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      const fy = doc.page.height - 46;
      doc.moveTo(L, fy).lineTo(L + W, fy).strokeColor(RULE).lineWidth(0.5).stroke();
      // Configured footer text wins; the literal is the unconfigured fallback.
      const footerLine = profile.invoice_footer_note
        ?? `${profile.billing_legal_name ?? 'Ichibaan Logic Private Limited (formerly Bhaoo Private Limited)'} · ${profile.billing_website ?? 'www.ichibaanlogic.com'}`;
      doc.fontSize(7).fillColor(GRAY).font('Helvetica')
        .text(String(footerLine), L, fy + 6, { width: W * 0.7, lineBreak: false })
        .text(`Page ${i - range.start + 1} of ${range.count}`,
          L + W * 0.7, fy + 6, { width: W * 0.3, align: 'right', lineBreak: false });
      // Which build rendered this page. When a customer questions a historical
      // invoice, this identifies the renderer that produced it — otherwise the
      // only way to reason about an old document is to guess which version of
      // the layout was live at the time.
      doc.fontSize(6).fillColor('#999999')
        .text(`Generated by BitsAuto ${buildVersion}`, L, fy + 16, { width: W * 0.7, lineBreak: false });
      doc.page.margins.bottom = bottomMargin;
    }

    doc.end();
  });

  return {
    buffer: Buffer.concat(chunks),
    filename: invoicePdfFilename({
      invoiceNumber: inv.invoice_number,
      customerName:  inv.customer_name,
      periodStart:   inv.period_start,
      periodEnd:     inv.period_end,
    }),
  };
}
