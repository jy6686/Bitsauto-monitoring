import { describe, it, expect } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { invoiceLineItems, invoiceCdrSnapshots } from '@shared/schema';

/**
 * CHARACTERISATION TEST — pins a DEFECT, not a requirement.
 *
 * GET /api/invoices/:id/html re-renders an invoice from `invoice_line_items`
 * and reads five fields per row:
 *
 *     line.country · line.destination · line.minutes · line.ratePerMin · line.amount
 *
 * NOT ONE OF THEM EXISTS on that table. Its columns are id, invoiceId,
 * snapshotId, cdrCallId, prefix, durationSecs, reproducedCost, actualCost,
 * delta. So every read is `undefined`, every `Number(undefined) || 0` is 0,
 * and `.toFixed(2)` prints "0.00".
 *
 * Rendered live for invoice C-2608-0007 on 2026-09-04: 362 rows of blank
 * country, blank destination, 0.00 minutes, 0.00000 rate/min, 0.00 amount,
 * under a total of 0.00 — while the very same invoice's stored html_content
 * shows $16.52 and its header carries totalReproduced 16.52205 over
 * lineCount 362.
 *
 * So nothing "became" zero. The value is intact in the table and the renderer
 * is asking for names that were never there. This is the defect class this
 * codebase keeps producing and that shared/finance-contracts.ts was written
 * to stop: a missing field is undefined, `?? 0` makes it zero, and zero
 * renders as money. Nothing throws and nothing logs.
 *
 * Not fixed here — invoice rendering is owner-decision territory, and the fix
 * is a real choice: either the renderer should read durationSecs/reproducedCost
 * and derive minutes and rate, or the table should carry the presentation
 * columns. Only the second would let it show a destination breakdown at all,
 * because neither country nor destination exists anywhere on the row.
 */
describe('DEFECT: the invoice re-render reads fields its table does not have', () => {
  const lineCols = new Set(Object.keys(getTableColumns(invoiceLineItems)));

  const RENDERER_READS = ['country', 'destination', 'minutes', 'ratePerMin', 'amount'] as const;

  it('confirms every field the renderer reads is absent', () => {
    for (const f of RENDERER_READS) {
      // WRONG. The correct assertion is expect(lineCols.has(f)).toBe(true).
      expect(lineCols.has(f)).toBe(false);
    }
  });

  it('confirms the row DOES carry the data, under other names', () => {
    // The money is present. Only the names the renderer uses are not.
    expect(lineCols.has('durationSecs')).toBe(true);
    expect(lineCols.has('reproducedCost')).toBe(true);
    expect(lineCols.has('actualCost')).toBe(true);
    expect(lineCols.has('prefix')).toBe(true);
  });

  it('shows why a destination breakdown cannot be rendered from this table', () => {
    // country and destination are not merely misnamed — there is nothing on
    // the row that carries them, so no rename fixes the two leftmost columns.
    expect(lineCols.has('country')).toBe(false);
    expect(lineCols.has('destination')).toBe(false);
    expect([...lineCols].some(c => /country|destination|dest/i.test(c))).toBe(false);
  });

  it('contrasts with the STORED generator, which reads real columns', () => {
    // sippy-invoice.service.ts renders from invoice_cdr_snapshots using
    // s.callee, s.durationSecs and s.reproducedCost — all of which exist.
    // That is why the stored document shows $16.52 while the live re-render
    // shows $0.00: two renderers, two tables, one of them mis-addressed.
    const snapCols = new Set(Object.keys(getTableColumns(invoiceCdrSnapshots)));
    for (const f of ['callee', 'durationSecs', 'reproducedCost']) {
      expect(snapCols.has(f)).toBe(true);
    }
  });
});
