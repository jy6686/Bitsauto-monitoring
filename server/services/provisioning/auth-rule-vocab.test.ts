import { describe, it, expect } from 'vitest';
import { canonicalCell, COUNTRY_CODE, COUNTRY_DISPLAY, PRODUCT_DIGIT_BY_NAME, PRODUCT_DISPLAY } from './auth-rule-vocab';

describe('canonicalCell', () => {
  it('accepts a resolvable country and product in any casing and returns the display spelling', () => {
    expect(canonicalCell({ country: ' afghanistan ', product: 'FIRST CLASS' })).toEqual({
      ok: true, country: 'Afghanistan', product: 'First Class', countryCode: '93', productDigit: '1',
    });
    expect(canonicalCell({ country: 'usa / canada', product: 'special bravo' })).toMatchObject({ ok: true, country: 'USA / Canada', product: 'Special Bravo', countryCode: '1', productDigit: '6' });
  });

  it('refuses a country the planners cannot turn into a dial code, naming the known ones', () => {
    const r = canonicalCell({ country: 'Narnia', product: 'First Class' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/"Narnia" is not a country .* Known: Pakistan, India, Bangladesh/);
  });

  it('refuses a product without a Sippy digit, and empty inputs', () => {
    expect(canonicalCell({ country: 'Pakistan', product: 'Platinum' })).toMatchObject({ ok: false });
    expect(canonicalCell({ country: '', product: 'First Class' })).toEqual({ ok: false, error: 'country is required.' });
    expect(canonicalCell({ country: 'Pakistan' })).toEqual({ ok: false, error: 'product is required.' });
  });

  it('every code and digit has a display spelling, so a cell can always be written', () => {
    expect(Object.keys(COUNTRY_DISPLAY).sort()).toEqual(Object.keys(COUNTRY_CODE).sort());
    expect(Object.keys(PRODUCT_DISPLAY).sort()).toEqual(Object.keys(PRODUCT_DIGIT_BY_NAME).sort());
  });
});
