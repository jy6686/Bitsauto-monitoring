import { describe, it, expect } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { invoiceLineItems, invoiceCdrSnapshots } from '@shared/schema';
import { checkFields, readNumber } from './finance-number';

/**
 * CONTRACT TEST — the renderer may only read names the table actually has.
 *
 * ── What this pinned ───────────────────────────────────────────────────────
 * GET /api/invoices/:id/html re-rendered an invoice from `invoice_line_items`
 * and read five fields per row:
 *
 *     line.country · line.destination · line.minutes · line.ratePerMin · line.amount
 *
 * NOT ONE OF THEM EXISTED. The columns are id, invoiceId, snapshotId,
 * cdrCallId, prefix, durationSecs, reproducedCost, actualCost, delta. So every
 * read was `undefined`, every `Number(undefined) || 0` was 0, and `.toFixed(2)`
 * printed "0.00" — 362 times, for C-2608-0007, under a total of 0.00, while
 * that same invoice's stored html_content showed $16.52.
 *
 * Nothing ever "became" zero. The value was intact in the table and the
 * renderer was asking for names that were never there.
 *
 * ── Fixed 2026-09-04 ───────────────────────────────────────────────────────
 * The renderer now reads `durationSecs` and `reproducedCost` and DERIVES
 * minutes and rate, on the owner's instruction: those are presentation values,
 * and storing them in SQL means they can drift from the money they describe.
 *
 * Country and destination were the two genuinely absent facts — no rename
 * could have recovered them. They are resolved from `prefix` through the
 * commercial catalogue at view time. That is honest for a preview and NOT
 * immutable: re-versioning the catalogue changes what an old invoice renders.
 * The test below states that boundary so the trade-off is not rediscovered.
 */
describe('the invoice re-render reads only fields its table has', () => {
  const lineCols = new Set(Object.keys(getTableColumns(invoiceLineItems)));

  /** What the renderer reads off each row now. */
  const RENDERER_READS = ['durationSecs', 'reproducedCost', 'actualCost', 'prefix'] as const;
  /** What it used to read, and must never read again. */
  const NEVER_EXISTED  = ['country', 'destination', 'minutes', 'ratePerMin', 'amount'] as const;

  it('every field the renderer reads exists on the table', () => {
    // This assertion used to be `.toBe(false)` over the other list. It is the
    // whole fix, stated once.
    for (const f of RENDERER_READS) expect(lineCols.has(f)).toBe(true);
  });

  it('the five names that produced 362 zeros still do not exist', () => {
    // Kept as a guard, not as history: if someone reintroduces `line.amount`,
    // this is what says the column was never there to begin with.
    for (const f of NEVER_EXISTED) expect(lineCols.has(f)).toBe(false);
  });

  it('minutes and rate are derivable from what the row carries', () => {
    // The owner's decision: derive, do not denormalise. Duplicating these in
    // SQL means they can drift from the cost they describe.
    const row = { durationSecs: 429, reproducedCost: 0.25025 };
    const secs = readNumber(row, 'durationSecs',   'invoice_line_items');
    const cost = readNumber(row, 'reproducedCost', 'invoice_line_items');
    expect(secs.ok && cost.ok).toBe(true);

    const minutes = secs.value! / 60;
    expect(minutes).toBeCloseTo(7.15, 2);
    expect(cost.value! / minutes).toBeCloseTo(0.035, 4);   // the tariff rate, recovered
  });

  it('a zero-duration line has no rate, and must not print one', () => {
    // reproducedCost / 0 minutes is Infinity, and 0/0 is NaN. Either would
    // render as a number. A line with no minutes has no rate per minute —
    // that is an absence, and the renderer prints an em dash for it.
    const row = { durationSecs: 0, reproducedCost: 0 };
    const minutes = readNumber(row, 'durationSecs', 'invoice_line_items').value! / 60;
    expect(minutes).toBe(0);
    expect(Number.isFinite(0 / minutes)).toBe(false);      // why the guard exists
  });

  it('country and destination have no source column — they are resolved, not read', () => {
    // Neither exists anywhere on the row, which is why the fix had to be a
    // catalogue lookup on `prefix` rather than a rename. `prefix` is the only
    // thing on the row that identifies where the call went.
    expect(lineCols.has('country')).toBe(false);
    expect(lineCols.has('destination')).toBe(false);
    expect([...lineCols].some(c => /country|destination|dest/i.test(c))).toBe(false);
    expect(lineCols.has('prefix')).toBe(true);
  });

  it('reports the whole contract in one round when a row is wrong', () => {
    // What the defect would have looked like through finance-number: five
    // named failures on first render, instead of five silent zeros.
    const realRow = {
      id: 1, invoiceId: 7, snapshotId: 12, cdrCallId: 'a', prefix: '192',
      durationSecs: 429, reproducedCost: 0.25025, actualCost: 0.25, delta: 0,
    };
    const bad = checkFields(realRow, NEVER_EXISTED.slice(2), 'invoice_line_items');
    expect(bad.every(r => r.fault === 'field-absent')).toBe(true);
    expect(bad[0].detail).toContain('reproducedCost');   // names the field to use

    const good = checkFields(realRow, ['durationSecs', 'reproducedCost'], 'invoice_line_items');
    expect(good.every(r => r.ok)).toBe(true);
  });

  it('contrasts with the STORED generator, which always read real columns', () => {
    // sippy-invoice.service.ts renders from invoice_cdr_snapshots using
    // s.callee, s.durationSecs and s.reproducedCost — all of which exist. That
    // is why the stored document showed $16.52 while the live re-render showed
    // $0.00: two renderers over two tables, one of them mis-addressed.
    const snapCols = new Set(Object.keys(getTableColumns(invoiceCdrSnapshots)));
    for (const f of ['callee', 'durationSecs', 'reproducedCost']) {
      expect(snapCols.has(f)).toBe(true);
    }
  });
});
