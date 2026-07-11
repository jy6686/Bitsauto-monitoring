import { describe, it, expect } from 'vitest';
import { parseFile } from '../routes-vendor-rates';
import {
  loadFixtureBase64, loadBaseline, listFixtures, normalizeRateSheet, diffBaseline,
} from './fixtures';

describe('fixture engine', () => {
  it('lists and loads synthetic fixtures', () => {
    expect(listFixtures('synthetic')).toContain('vendor-duplicate-rate.xlsx');
    const b64 = loadFixtureBase64('synthetic', 'vendor-duplicate-rate.xlsx');
    expect(typeof b64).toBe('string');
    expect(parseFile(b64).headers).toEqual(['Prefix', 'Rate', 'Rate_2', 'Dest']);
  });

  it('normalized model matches versioned baseline (order-independent)', () => {
    const { headers, dataRows } = parseFile(loadFixtureBase64('synthetic', 'vendor-duplicate-rate.xlsx'));
    const model = normalizeRateSheet(headers, dataRows, 'Prefix', 'Rate');
    expect(model.schema).toBe(1);
    expect(diffBaseline(model, loadBaseline('vendor-duplicate-rate.json'))).toEqual([]);
  });

  it('diffBaseline reports differences', () => {
    const base = loadBaseline('vendor-duplicate-rate.json');
    const changed = { ...base, rowCount: 99 };
    expect(diffBaseline(changed, base).length).toBeGreaterThan(0);
  });

  it('regression fixture keeps BUG-001 fixed', () => {
    const h = parseFile(loadFixtureBase64('regression', 'bug-001-duplicate-headers.xlsx')).headers;
    expect(h).toEqual(['Prefix', 'Rate', 'Rate_2']);
  });
});
