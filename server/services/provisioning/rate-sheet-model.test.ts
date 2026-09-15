import { describe, it, expect } from 'vitest';
import { buildRateSheetRows, countryOf, formatSheetDate, technicalPrefix, changeEffectiveDates, type PricedRate } from './rate-sheet-model';
import type { Expansion } from '../rates/rate-prefix-expansion';

const price = (over: Partial<PricedRate>): PricedRate => ({
  productCode: 'FC', productDigit: '1', rate: '0.04', currency: 'USD', effectiveFrom: '2026-09-14',
  destinationId: 886, prefix: null, catalogueVersionId: 1, productId: 1, ...over,
});
const exp = (row: PricedRate, verdict: Expansion<PricedRate>['verdict'], prefixes: string[], name: string | null, reason: string | null = null): Expansion<PricedRate> =>
  ({ row, verdict, prefixes, destinationName: name, reason });

describe('buildRateSheetRows', () => {
  it('turns a catalogue-keyed price into one named row per prefix — the +null rows of 2026-09-14 cannot occur', () => {
    const r = buildRateSheetRows({
      expansions: [
        exp(price({ destinationId: 3, rate: '0.173' }), 'catalogue', ['9370', '9371'], 'AFGHANISTAN - MOBILE AWCC'),
        exp(price({ destinationId: 886 }), 'catalogue', ['9230'], 'PAKISTAN - MOBILE MOBILINK'),
      ],
      increments: new Map([['9370', '60/1'], ['9371', '60/1'], ['9230', '1/1']]),
      legacyNames: new Map(),
    });
    expect(r.excluded).toEqual([]);
    expect(r.rows.map(x => [x.country, x.destination, x.prefix, x.rate, x.billingIncrement, x.effectiveDate, x.status])).toEqual([
      ['AFGHANISTAN', 'AFGHANISTAN - MOBILE AWCC', '9370', 0.173, '60/1', '14-Sep-2026', 'N'],
      ['AFGHANISTAN', 'AFGHANISTAN - MOBILE AWCC', '9371', 0.173, '60/1', '14-Sep-2026', 'N'],
      ['PAKISTAN', 'PAKISTAN - MOBILE MOBILINK', '9230', 0.04, '1/1', '14-Sep-2026', 'N'],
    ]);
    for (const row of r.rows) { expect(row.destination).not.toMatch(/null/i); expect(row.prefix).not.toMatch(/null/i); }
  });

  it('refuses what the catalogue refuses, naming it, and never emits an empty row', () => {
    const r = buildRateSheetRows({
      expansions: [
        exp(price({ destinationId: 999 }), 'not_eligible', [], null, 'First Class is not declared eligible'),
        exp(price({ destinationId: 5, catalogueVersionId: 0 }), 'stale_version', [], 'SOMEWHERE', 'priced against version 0, active is 1'),
        exp(price({ destinationId: 7 }), 'catalogue', [], 'NO PREFIXES'),
      ],
      increments: new Map(), legacyNames: new Map(),
    });
    expect(r.rows).toEqual([]);
    expect(r.excluded).toHaveLength(3);
    expect(r.excluded[0]).toMatch(/not_eligible/);
    expect(r.excluded[1]).toMatch(/stale_version/);
    expect(r.excluded[2]).toMatch(/no prefixes/);
  });

  it('keeps a legacy prefix-keyed price, named from the legacy table or by its prefix', () => {
    const r = buildRateSheetRows({
      expansions: [
        exp(price({ destinationId: null, catalogueVersionId: null, prefix: '92' }), 'legacy_prefix', ['92'], null),
        exp(price({ destinationId: null, catalogueVersionId: null, prefix: '93' }), 'legacy_prefix', ['93'], null),
      ],
      increments: new Map([['92', '1/1']]),
      legacyNames: new Map([['92', 'Pakistan']]),
    });
    expect(r.rows.map(x => [x.destination, x.prefix, x.billingIncrement])).toEqual([['93', '93', ''], ['Pakistan', '92', '1/1']]);
  });

  it('ignores a second price for the same product and prefix, and says so', () => {
    const r = buildRateSheetRows({
      expansions: [
        exp(price({ destinationId: 1 }), 'catalogue', ['9230'], 'PAKISTAN - MOBILE MOBILINK'),
        exp(price({ destinationId: 2, rate: '0.05' }), 'catalogue', ['9230'], 'PAKISTAN - MOBILE MOBILINK (DUP)'),
      ],
      increments: new Map(), legacyNames: new Map(),
    });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].rate).toBe(0.04);
    expect(r.excluded[0]).toMatch(/duplicate prefix/);
  });

  it('sorts by country, destination, then prefix numerically', () => {
    const r = buildRateSheetRows({
      expansions: [
        exp(price({ destinationId: 2 }), 'catalogue', ['9235', '92310', '9231'], 'PAKISTAN - MOBILE ZONG'),
        exp(price({ destinationId: 3 }), 'catalogue', ['9370'], 'AFGHANISTAN - MOBILE AWCC'),
      ],
      increments: new Map(), legacyNames: new Map(),
    });
    expect(r.rows.map(x => x.prefix)).toEqual(['9370', '9231', '9235', '92310']);
  });
});

describe('helpers', () => {
  it('formats dates the way the reference prints them', () => {
    expect(formatSheetDate('2026-09-14')).toBe('14-Sep-2026');
    expect(formatSheetDate('2015-12-02')).toBe('02-Dec-2015');
    expect(formatSheetDate(null)).toBe('');
  });
  it('derives the country label from the catalogue name', () => {
    expect(countryOf('PAKISTAN - MOBILE MOBILINK')).toBe('PAKISTAN');
    expect(countryOf('NEPAL')).toBe('NEPAL');
  });
  it('composes the technical prefix like the authentication rules do', () => {
    expect(technicalPrefix('1019', '1')).toBe('10191');
    expect(technicalPrefix(null, '1')).toBe('1');
  });
  it('leaves the increase/decrease dates blank on a first sheet', () => {
    expect(changeEffectiveDates([{ country: '', destination: '', prefix: '', rate: 1, status: 'N', billingIncrement: '', effectiveDate: '14-Sep-2026', effectiveTime: '' }])).toEqual({ increase: '', decrease: '' });
  });
});
