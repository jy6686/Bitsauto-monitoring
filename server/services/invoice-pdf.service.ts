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

const DARK  = '#1a1a2e';
const BRICK = '#c0392b';
const GRAY  = '#666666';
const RULE  = '#dddddd';

function logoPath(): string | null {
  const p = path.join(__dirname, '../assets/ichibaan-logo.png');
  return fs.existsSync(p) ? p : null;
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
    const money = (n: any) => Number(n ?? 0).toFixed(4);
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
    doc.fontSize(9).fillColor(DARK).font('Helvetica')
      .text('Ichibaan Logic Private Limited', L + colW + 20, doc.y + 3, { width: colW })
      .fontSize(8).fillColor(GRAY)
      .text('Unit Level 11(A), Main Office Tower, Jalan Merdeka,\nFinancial Park Labuan, 87000 Labuan, Malaysia', { width: colW })
      .text('billing@ichibaanlogic.com', { width: colW });

    y = doc.y + 16;

    // ── Summary strip ───────────────────────────────────────────────────────
    const period = inv.period_start
      ? `${String(inv.period_start).slice(0, 10)}  to  ${String(inv.period_end ?? '').slice(0, 10)}`
      : '—';
    const totalSecs = rows.reduce((s, r) => s + Number(r.seconds ?? 0), 0);
    const items: [string, string][] = [
      ['Billing period', period],
      ['Calls billed',   Number(inv.line_count ?? 0).toLocaleString()],
      ['Total minutes',  mins(totalSecs)],
      ['Invoice date',   String(inv.generated_at ?? inv.created_at ?? '').slice(0, 10)],
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

    // ── Detail table ────────────────────────────────────────────────────────
    const cols = [
      { label: 'Destination', w: W * 0.40, align: 'left'  as const },
      { label: 'Prefix',      w: W * 0.12, align: 'left'  as const },
      { label: 'Calls',       w: W * 0.12, align: 'right' as const },
      { label: 'Minutes',     w: W * 0.16, align: 'right' as const },
      { label: 'Amount (USD)',w: W * 0.20, align: 'right' as const },
    ];

    const drawHead = (yy: number) => {
      let x = L;
      doc.fontSize(7.5).fillColor(GRAY).font('Helvetica-Bold');
      for (const c of cols) { doc.text(c.label.toUpperCase(), x, yy, { width: c.w - 6, align: c.align }); x += c.w; }
      doc.moveTo(L, yy + 12).lineTo(L + W, yy + 12).strokeColor(RULE).lineWidth(0.5).stroke();
      return yy + 18;
    };

    y = drawHead(y);

    for (const r of rows) {
      // Leave room for the totals block and footer rather than orphaning them.
      if (y > doc.page.height - 130) {
        doc.addPage();
        y = 50;
        y = drawHead(y);
      }
      let x = L;
      const cells = [
        String(r.destination), String(r.prefix),
        Number(r.calls).toLocaleString(), mins(r.seconds), money(r.amount),
      ];
      doc.fontSize(8.5).fillColor(DARK).font('Helvetica');
      cells.forEach((cell, i) => {
        doc.text(cell, x, y, { width: cols[i].w - 6, align: cols[i].align, lineBreak: false });
        x += cols[i].w;
      });
      y += 15;
    }

    if (rows.length === 0) {
      doc.fontSize(9).fillColor(GRAY).font('Helvetica')
        .text('No billable calls in this period.', L, y);
      y += 20;
    }

    // ── Total ───────────────────────────────────────────────────────────────
    if (y > doc.page.height - 120) { doc.addPage(); y = 50; }
    doc.moveTo(L, y).lineTo(L + W, y).strokeColor(DARK).lineWidth(1.5).stroke();
    y += 10;
    doc.fontSize(11).fillColor(DARK).font('Helvetica-Bold')
      .text('TOTAL DUE', L, y, { width: W * 0.6 })
      .fontSize(14)
      .text(`USD ${Number(inv.total_actual ?? 0).toFixed(2)}`, L + W * 0.6, y - 2, { width: W * 0.4, align: 'right' });
    y += 26;
    doc.fontSize(8).fillColor(GRAY).font('Helvetica')
      .text('Payment is due in accordance with the agreed commercial terms. For queries contact billing@ichibaanlogic.com; disputes to dispute@ichibaanlogic.com.',
        L, y, { width: W });

    // ── Footer on every page ────────────────────────────────────────────────
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const fy = doc.page.height - 46;
      doc.moveTo(L, fy).lineTo(L + W, fy).strokeColor(RULE).lineWidth(0.5).stroke();
      doc.fontSize(7).fillColor(GRAY).font('Helvetica')
        .text('Ichibaan Logic Private Limited (formerly Bhaoo Private Limited) · www.ichibaanlogic.com',
          L, fy + 6, { width: W * 0.7 })
        .text(`Page ${i - range.start + 1} of ${range.count}`,
          L + W * 0.7, fy + 6, { width: W * 0.3, align: 'right' });
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
