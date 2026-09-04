import { describe, it, expect, vi } from 'vitest';
import {
  readNumber, requireNumber, checkFields, assertFields, numberOrDash, sumField,
  FieldFaultCollector, MissingFinanceFieldError,
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
