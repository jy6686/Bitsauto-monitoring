/**
 * Invoice document formatting rules — the ones an owner review caught the
 * renderer breaking, pinned so they cannot regress silently.
 *
 * These are pure-function tests over the two helpers that decide what a
 * customer sees. The full three-page render is verified separately against a
 * real PDF; this file guards the rules that were actually violated:
 *
 *   1. An unconfigured decimal-places column must not mean ZERO decimals.
 *      Number(null) is 0, not NaN, so reading the column straight into
 *      Number() rounded every amount on every invoice to whole currency
 *      units. Absence must mean "unset".
 *   2. A customer-facing destination is never an identifier. Dial strings,
 *      prefixes, product codes and routing ids must never reach a document.
 */

import { describe, it, expect } from 'vitest';
import { resolveDecimalPlaces, isCustomerFacingName } from './invoice-format';

describe('resolveDecimalPlaces', () => {
  it('an unconfigured column is UNSET, never zero', () => {
    // The bug: Number(null) === 0 → toFixed(0) → "2,200" instead of "2,199.92".
    expect(resolveDecimalPlaces(null)).toBeNull();
    expect(resolveDecimalPlaces(undefined)).toBeNull();
    expect(resolveDecimalPlaces('')).toBeNull();
  });

  it('honours a configured value, including a deliberate zero', () => {
    expect(resolveDecimalPlaces(0)).toBe(0);   // explicitly chosen
    expect(resolveDecimalPlaces(2)).toBe(2);
    expect(resolveDecimalPlaces(6)).toBe(6);
    expect(resolveDecimalPlaces('4')).toBe(4);
  });

  it('rejects values outside the sane range rather than trusting them', () => {
    expect(resolveDecimalPlaces(7)).toBeNull();
    expect(resolveDecimalPlaces(-1)).toBeNull();
    expect(resolveDecimalPlaces(2.5)).toBeNull();
    expect(resolveDecimalPlaces('abc')).toBeNull();
  });
});

describe('isCustomerFacingName', () => {
  it('rejects every identifier shape that reached a customer invoice', () => {
    expect(isCustomerFacingName('18801606527232')).toBe(false); // full dialled number
    expect(isCustomerFacingName('92300')).toBe(false);          // tariff prefix
    expect(isCustomerFacingName('+60 11 1426 1581')).toBe(false);
    expect(isCustomerFacingName('1-880-160')).toBe(false);
    expect(isCustomerFacingName('')).toBe(false);
    expect(isCustomerFacingName(null)).toBe(false);
    expect(isCustomerFacingName('   ')).toBe(false);
  });

  it('accepts real destination names', () => {
    expect(isCustomerFacingName('Pakistan - Mobile Mobilink')).toBe(true);
    expect(isCustomerFacingName('Singtel')).toBe(true);
    expect(isCustomerFacingName('Japan - Mobile')).toBe(true);
  });

  it('a name carrying digits is still a name', () => {
    // "O2", "3 UK" are real operator names; only pure identifiers are barred.
    expect(isCustomerFacingName('O2 Germany')).toBe(true);
    expect(isCustomerFacingName('UK - Mobile 3')).toBe(true);
  });
});
