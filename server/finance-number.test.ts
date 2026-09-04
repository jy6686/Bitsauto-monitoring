import { describe, it, expect, vi } from 'vitest';
import {
  readNumber, requireNumber, checkFields, assertFields, numberOrDash, sumField,
  FieldFaultCollector, MissingFinanceFieldError, reportFaults,
} from './finance-number';

/**
 * The four production defects are the fixtures. Each test names the one it
 * would have caught, because the value of this module is not that it is
 * correct in the abstract — it is that these specific four could not have
 * shipped through it.
 */

describe('the distinction Number(x) || 0 erases', () => {
  it('separates a real zero from every way of failing to find one', () => {
    const T = 'invoice_line_items';
    // The only honest zero: the field exists and holds one.
    expect(readNumber({ amount: 0 }, 'amount', T)).toMatchObject({ ok: true, value: 0 });
    // pg returns numeric columns as strings. "0.00" is also a real zero.
    expect(readNumber({ amount: '0.00' }, 'amount', T)).toMatchObject({ ok: true, value: 0 });

    // Everything below coerces to 0 under `Number(x) || 0` and means nothing.
    expect(readNumber({}, 'amount', T).fault).toBe('field-absent');
    expect(readNumber({ amount: null }, 'amount', T).fault).toBe('field-null');
    expect(readNumber({ amount: '' }, 'amount', T).fault).toBe('not-numeric');
    expect(readNumber({ amount: '  ' }, 'amount', T).fault).toBe('not-numeric');
    expect(readNumber({ amount: [] }, 'amount', T).fault).toBe('not-numeric');
    expect(readNumber({ amount: {} }, 'amount', T).fault).toBe('not-numeric');
    expect(readNumber(null, 'amount', T).fault).toBe('row-missing');
    expect(readNumber(undefined, 'amount', T).fault).toBe('row-missing');

    // None of them returns a number. That is the whole contract.
    for (const bad of [{}, { amount: null }, { amount: '' }, { amount: [] }, null]) {
      expect(readNumber(bad, 'amount', T).value).toBeNull();
    }
  });

  it('proves the coercions it guards against really do produce zero', () => {
    // Stated explicitly so nobody has to trust the header comment. These are
    // the expressions that manufactured money out of nothing.
    expect(Number(undefined) || 0).toBe(0);
    expect(Number(null)      || 0).toBe(0);
    expect(Number('')        || 0).toBe(0);
    expect(Number('   ')     || 0).toBe(0);
    expect(Number([])        || 0).toBe(0);
    expect((undefined as any) ?? 0).toBe(0);
    expect((null as any)      ?? 0).toBe(0);
  });

  it('accepts negatives and fractions — a delta is a legitimate number', () => {
    expect(readNumber({ delta: -1.75 }, 'delta', 'x')).toMatchObject({ ok: true, value: -1.75 });
    expect(readNumber({ delta: '-1.75' }, 'delta', 'x')).toMatchObject({ ok: true, value: -1.75 });
  });

  it('rejects NaN and Infinity, which are not money either', () => {
    expect(readNumber({ amount: NaN }, 'amount', 'x').fault).toBe('not-numeric');
    expect(readNumber({ amount: Infinity }, 'amount', 'x').fault).toBe('not-numeric');
    expect(readNumber({ amount: 'abc' }, 'amount', 'x').fault).toBe('not-numeric');
  });
});

describe('the message names where to look', () => {
  it('lists what the row actually has when a field is absent', () => {
    // The live invoice renderer's exact situation.
    const row = { id: 1, prefix: '192', durationSecs: 429, reproducedCost: 0.25, actualCost: 0.25 };
    const read = readNumber(row, 'amount', 'invoice_line_items');

    expect(read.fault).toBe('field-absent');
    expect(read.path).toBe('invoice_line_items.amount');
    expect(read.detail).toContain('does not exist on the row');
    expect(read.detail).toContain('reproducedCost');   // the field it should have read
    expect(read.detail).toContain('durationSecs');
  });

  it('suggests a near-miss when the names nearly match', () => {
    // The Finance Cockpit defect: read `totalRevenue`, row had `totalSell`.
    const read = readNumber({ totalSell: 500 }, 'totalSales', 'cockpit_summary');
    expect(read.detail).toMatch(/Did you mean totalSell/);
  });

  it('distinguishes null from absent, because they need different fixes', () => {
    // Absent is a code defect. Null is a data state — actual_cost is nullable
    // by design when the switch has not rated the call yet.
    expect(readNumber({ actualCost: null }, 'actualCost', 't').detail)
      .toContain('present, but no value recorded');
    expect(readNumber({}, 'actualCost', 't').detail)
      .toContain('does not exist on the row');
  });
});

describe('the diagnostic is structured, so nothing has to parse prose', () => {
  // The first version of this module put the row's available keys inside the
  // `detail` string, which recreated the very problem it was written to solve:
  // a consumer wanting the column list had to parse English.
  const ROW = { id: 1, prefix: '192', durationSecs: 429, reproducedCost: 0.25025 };

  it('exposes field and table separately, not only as a joined path', () => {
    const r = readNumber(ROW, 'amount', 'invoice_line_items');
    expect(r.field).toBe('amount');
    expect(r.table).toBe('invoice_line_items');
    expect(r.path).toBe('invoice_line_items.amount');
  });

  it('exposes availableFields as an ARRAY', () => {
    const r = readNumber(ROW, 'amount', 'invoice_line_items');
    expect(r.availableFields).toEqual(['id', 'prefix', 'durationSecs', 'reproducedCost']);
    // The fix a reader needs is now a value, not a substring of a sentence.
    expect(r.availableFields).toContain('reproducedCost');
  });

  it('exposes suggestions as an ARRAY, best match first', () => {
    // Both share the "total" stem, so both are candidates — but totalSell
    // agrees for six characters and totalBuy for five, so the useful one leads
    // and suggestions[0] is worth reading.
    const r = readNumber({ totalSell: 500, totalBuy: 400 }, 'totalSales', 'cockpit');
    expect(r.suggestions).toEqual(['totalSell', 'totalBuy']);
    expect(r.suggestions[0]).toBe('totalSell');
  });

  it('offers nothing when nothing is close, rather than a coincidence', () => {
    // Under four shared leading characters, a "match" is noise. The invoice
    // row has no field resembling `amount`, and saying so is the honest answer.
    expect(readNumber(ROW, 'amount', 'invoice_line_items').suggestions).toEqual([]);
    expect(readNumber({ delta: 1, prefix: '9' }, 'duration', 't').suggestions).toEqual([]);
  });

  it('reports what it received, typed, for the non-absent faults', () => {
    expect(readNumber({ a: '' },   'a', 't').received).toEqual({ type: 'string',  preview: '""' });
    expect(readNumber({ a: null }, 'a', 't').received).toEqual({ type: 'null',    preview: 'null' });
    expect(readNumber({ a: [] },   'a', 't').received).toEqual({ type: 'array',   preview: '' });
    expect(readNumber({ a: true }, 'a', 't').received).toEqual({ type: 'boolean', preview: 'true' });
    expect(readNumber({ a: 'abc' },'a', 't').received).toEqual({ type: 'string',  preview: '"abc"' });
    // Absent has nothing to report as received; availableFields is its evidence.
    expect(readNumber({}, 'a', 't').received).toBeNull();
    expect(readNumber({ a: 1 }, 'a', 't').received).toBeNull();
  });

  it('truncates a huge value rather than carrying it into a log line', () => {
    const r = readNumber({ a: 'x'.repeat(500) }, 'a', 't');
    expect(r.received!.preview.length).toBeLessThanOrEqual(120);
    expect(r.received!.preview.endsWith('...')).toBe(true);
  });

  it('keeps the whole verdict JSON-safe', () => {
    // It has to survive res.json() without a replacer.
    const r = readNumber({}, 'amount', 'invoice_line_items');
    expect(() => JSON.stringify(r)).not.toThrow();
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });

  it('a test asserts on the discriminant, never on the message', () => {
    // The property the suggestion asked for, stated as a test.
    expect(readNumber({}, 'a', 't').fault).toBe('field-absent');
    expect(readNumber({ a: null }, 'a', 't').fault).toBe('field-null');
    expect(readNumber({ a: '' }, 'a', 't').fault).toBe('not-numeric');
    expect(readNumber(null, 'a', 't').fault).toBe('row-missing');
  });
});

describe('reportFaults — one shape for APIs, banners, logs and health checks', () => {
  it('groups repeated faults so 362 rows are one row with a count', () => {
    // The live invoice renderer's exact situation: the same field absent on
    // every line. A consumer wants the fact once, with a count.
    const reads = Array.from({ length: 362 }, () =>
      readNumber({ durationSecs: 1, reproducedCost: 2 }, 'amount', 'invoice_line_items'));
    const rep = reportFaults(reads);

    expect(rep.ok).toBe(false);
    expect(rep.faultCount).toBe(362);
    expect(rep.groups).toHaveLength(1);
    expect(rep.groups[0]).toMatchObject({
      path: 'invoice_line_items.amount',
      field: 'amount',
      table: 'invoice_line_items',
      fault: 'field-absent',
      occurrences: 362,
    });
    expect(rep.groups[0].availableFields).toContain('reproducedCost');
  });

  it('counts by fault kind, so a health check can alert on field-absent alone', () => {
    // field-absent is a code defect and should page someone. field-null is a
    // data state and usually should not. A single "N faults" number conflates
    // them, which is why byFault exists.
    const rep = reportFaults([
      readNumber({}, 'a', 't'),
      readNumber({}, 'b', 't'),
      readNumber({ c: null }, 'c', 't'),
    ]);
    expect(rep.byFault).toEqual({ 'field-absent': 2, 'field-null': 1 });
  });

  it('orders groups by occurrence, worst first', () => {
    const rep = reportFaults([
      readNumber({ x: null }, 'rare', 't'),
      ...Array.from({ length: 5 }, () => readNumber({}, 'common', 't')),
    ]);
    expect(rep.groups[0].field).toBe('common');
    expect(rep.groups[0].occurrences).toBe(5);
  });

  it('is clean and honest when nothing failed', () => {
    const rep = reportFaults([readNumber({ a: 1 }, 'a', 't')]);
    expect(rep).toMatchObject({ ok: true, faultCount: 0, groups: [], byFault: {} });
    expect(rep.summary).toBe('All fields read.');
  });

  it('the collector and a caught error produce the SAME shape', () => {
    // A caller that collects and a caller that catches must report
    // identically, or a health check has to handle two formats.
    const c = new FieldFaultCollector();
    c.record(readNumber({ totalSell: 1 }, 'totalRevenue', 'cockpit'));

    let caught: MissingFinanceFieldError;
    try { requireNumber({ totalSell: 1 }, 'totalRevenue', 'cockpit'); throw new Error('x'); }
    catch (e) { caught = e as MissingFinanceFieldError; }

    expect(caught!.toJSON()).toEqual(c.report());
    expect(JSON.parse(JSON.stringify(c))).toEqual(c.report());   // toJSON on the collector
  });

  it('assertFields carries every failure into one structured report', () => {
    try {
      assertFields({ durationSecs: 1 }, ['minutes', 'ratePerMin', 'amount'], 'invoice_line_items');
      expect.unreachable('should have thrown');
    } catch (e) {
      const rep = (e as MissingFinanceFieldError).toJSON();
      expect(rep.faultCount).toBe(3);
      expect(rep.groups.map(g => g.field)).toEqual(['minutes', 'ratePerMin', 'amount']);
      expect(rep.byFault).toEqual({ 'field-absent': 3 });
    }
  });
});

describe('requireNumber — for figures a customer pays', () => {
  it('returns the number when it is there', () => {
    expect(requireNumber({ reproducedCost: 0.25025 }, 'reproducedCost', 'snap')).toBeCloseTo(0.25025, 8);
    expect(requireNumber({ reproducedCost: 0 }, 'reproducedCost', 'snap')).toBe(0);
  });

  it('throws rather than invent a zero', () => {
    expect(() => requireNumber({}, 'amount', 'invoice_line_items'))
      .toThrow(MissingFinanceFieldError);
    expect(() => requireNumber({ amount: null }, 'amount', 'invoice_line_items'))
      .toThrow(/is null/);
  });

  it('carries the failed read on the error for the caller to log', () => {
    try {
      requireNumber({ totalSell: 1 }, 'totalRevenue', 'cockpit');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(MissingFinanceFieldError);
      const err = e as MissingFinanceFieldError;
      expect(err.reads).toHaveLength(1);
      expect(err.reads[0].path).toBe('cockpit.totalRevenue');
      expect(err.reads[0].fault).toBe('field-absent');
    }
  });
});

describe('assertFields — the whole contract in one round', () => {
  const RENDERER_READS = ['minutes', 'ratePerMin', 'amount'] as const;

  it('names EVERY missing field, not just the first', () => {
    // The live invoice renderer read five fields off invoice_line_items and
    // none existed. One exception at a time would have been five deploys.
    const row = { id: 1, prefix: '192', durationSecs: 429, reproducedCost: 0.25 };
    try {
      assertFields(row, RENDERER_READS, 'invoice_line_items');
      expect.unreachable('should have thrown');
    } catch (e) {
      const err = e as MissingFinanceFieldError;
      expect(err.reads).toHaveLength(3);
      expect(err.message).toContain('3 of 3');
      for (const f of RENDERER_READS) expect(err.message).toContain(f);
    }
  });

  it('passes silently when the contract holds', () => {
    expect(() => assertFields(
      { minutes: 7.15, ratePerMin: 0.035, amount: 0.25 }, RENDERER_READS, 'x',
    )).not.toThrow();
  });

  it('checkFields reports without throwing, for probes', () => {
    const reads = checkFields({ minutes: 1 }, RENDERER_READS, 'x');
    expect(reads.filter(r => r.ok)).toHaveLength(1);
    expect(reads.filter(r => !r.ok).map(r => r.path))
      .toEqual(['x.ratePerMin', 'x.amount']);
  });
});

describe('numberOrDash — a dashboard shows the absence', () => {
  it('prints a dash where a fabricated zero used to go', () => {
    // "0.00" and "—" occupy the same column and mean opposite things.
    expect(numberOrDash({ amount: 16.52 }, 'amount', 't')).toBe('16.52');
    expect(numberOrDash({ amount: 0 },     'amount', 't')).toBe('0.00');   // a real zero still prints
    expect(numberOrDash({},                'amount', 't')).toBe('—');
    expect(numberOrDash({ amount: null },  'amount', 't')).toBe('—');
  });

  it('honours dp and a custom placeholder', () => {
    expect(numberOrDash({ r: 0.035 }, 'r', 't', { dp: 5 })).toBe('0.03500');
    expect(numberOrDash({}, 'r', 't', { placeholder: 'NOT RECORDED' })).toBe('NOT RECORDED');
  });

  it('reports the fault instead of swallowing it', () => {
    const onFault = vi.fn();
    const collector = new FieldFaultCollector();
    numberOrDash({}, 'amount', 'invoice_line_items', { onFault, collector });

    expect(onFault).toHaveBeenCalledOnce();
    expect(collector.ok).toBe(false);
    expect(collector.paths).toEqual(['invoice_line_items.amount']);
  });

  it('a collector summarises a whole render', () => {
    const c = new FieldFaultCollector();
    const rows = [{ amount: 1 }, {}, { amount: null }, {}];
    for (const r of rows) numberOrDash(r, 'amount', 'invoice_line_items', { collector: c });

    expect(c.faults).toHaveLength(3);
    expect(c.paths).toHaveLength(1);              // distinct paths, not occurrences
    expect(c.summary()).toContain('3 unreadable field(s)');
    expect(c.summary()).toContain('2 field-absent');
    expect(c.summary()).toContain('1 field-null');
  });
});

describe('sumField — a total is where silent zeros do most damage', () => {
  const T = 'invoice_cdr_snapshots';

  it('sums what is there', () => {
    const rows = [{ c: 0.02512 }, { c: 0.25025 }];
    expect(sumField(rows, 'c', T)).toBeCloseTo(0.27537, 8);
  });

  it('refuses to treat an unreadable row as a zero contribution', () => {
    // This is the failure mode that matters: a total that silently omits rows
    // is not merely incomplete, it ASSERTS those rows contributed nothing.
    expect(() => sumField([{ c: 1 }, {}, { c: 2 }], 'c', T)).toThrow(MissingFinanceFieldError);
  });

  it('can sum leniently while still reporting what it could not read', () => {
    const c = new FieldFaultCollector();
    const total = sumField([{ c: 1 }, {}, { c: 2 }], 'c', T, { strict: false, collector: c });

    expect(total).toBe(3);            // the readable rows
    expect(c.ok).toBe(false);         // but the caller is told, not misled
    expect(c.faults).toHaveLength(1);
  });

  it('an empty set sums to zero, which is honest', () => {
    // No rows is genuinely no money. Distinct from rows that could not be read.
    const c = new FieldFaultCollector();
    expect(sumField([], 'c', T, { collector: c })).toBe(0);
    expect(c.ok).toBe(true);
  });
});

describe('the four production defects, as regression fixtures', () => {
  it('Finance Cockpit — read totalRevenue, row had totalSell', () => {
    const row = { totalSell: 4821.55, totalBuy: 3900.10 };
    expect(readNumber(row, 'totalRevenue', 'cockpit_summary').fault).toBe('field-absent');
    expect(readNumber(row, 'totalSell',    'cockpit_summary')).toMatchObject({ ok: true, value: 4821.55 });
  });

  it('Margin Alerts — read marginDeltaUsd, row had amountUsd', () => {
    const row = { amountUsd: -120.4 };
    expect(readNumber(row, 'marginDeltaUsd', 'margin_alerts').fault).toBe('field-absent');
  });

  it('Live Invoice — read five names, table had none of them', () => {
    // The real drizzle column set for invoice_line_items.
    const row = {
      id: 1, invoiceId: 7, snapshotId: 12, cdrCallId: 'a', prefix: '192',
      durationSecs: 429, reproducedCost: 0.25025, actualCost: 0.25, delta: 0,
    };
    const reads = checkFields(row, ['minutes', 'ratePerMin', 'amount'], 'invoice_line_items');
    expect(reads.every(r => r.fault === 'field-absent')).toBe(true);
    // And the fields that DO carry the money read fine.
    expect(readNumber(row, 'reproducedCost', 'invoice_line_items').ok).toBe(true);
    expect(readNumber(row, 'durationSecs',   'invoice_line_items').ok).toBe(true);
  });
});
