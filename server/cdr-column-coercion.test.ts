import { describe, it, expect } from 'vitest';
import { decimalOrNull, intOrNull, wouldRound } from './cdr-column-coercion';

describe('decimalOrNull — a measurement is never narrowed', () => {
  /**
   * The exact production value that failed every repository write for four
   * days: Sippy's fractional call duration against an INTEGER column.
   */
  it('keeps the full precision of a fractional duration', () => {
    expect(decimalOrNull('7.697271466')).toBe(7.697271466);
    expect(decimalOrNull(7.697271466)).toBe(7.697271466);
  });

  it('distinguishes absent from zero — a missing measurement is not 0', () => {
    expect(decimalOrNull(null)).toBeNull();
    expect(decimalOrNull(undefined)).toBeNull();
    expect(decimalOrNull('')).toBeNull();
    expect(decimalOrNull(0)).toBe(0);
    expect(decimalOrNull('0')).toBe(0);
  });

  it('returns null rather than NaN for unparseable input', () => {
    expect(decimalOrNull('n/a')).toBeNull();
    expect(decimalOrNull('abc')).toBeNull();
    expect(decimalOrNull(NaN)).toBeNull();
    expect(decimalOrNull(Infinity)).toBeNull();
  });
});

describe('intOrNull — an integer column is never handed a fraction', () => {
  it('rounds instead of throwing, because a rejected row loses its whole chunk', () => {
    expect(intOrNull('7.697271466')).toBe(8);
    expect(intOrNull(59.4)).toBe(59);
    expect(intOrNull(60)).toBe(60);
  });

  /** Math.round(-0.5) is -0 and Math.round(-1.5) is -1: both biased toward
   *  +∞. Rounding is symmetric here so a negative correction is not skewed. */
  it('rounds symmetrically about zero', () => {
    expect(intOrNull(-0.5)).toBe(-1);
    expect(intOrNull(0.5)).toBe(1);
    expect(intOrNull(-1.5)).toBe(-2);
    expect(intOrNull(1.5)).toBe(2);
    expect(Object.is(intOrNull(-0.5), -0)).toBe(false);
  });

  it('preserves the absent/zero distinction', () => {
    expect(intOrNull(null)).toBeNull();
    expect(intOrNull('')).toBeNull();
    expect(intOrNull(0)).toBe(0);
  });
});

describe('wouldRound — a fraction in a configuration field is a misclassification', () => {
  it('flags exactly the values intOrNull would change', () => {
    expect(wouldRound('7.697271466')).toBe(true);
    expect(wouldRound(60)).toBe(false);
    expect(wouldRound('1')).toBe(false);
  });

  it('never flags an absent or unparseable value', () => {
    expect(wouldRound(null)).toBe(false);
    expect(wouldRound('')).toBe(false);
    expect(wouldRound('abc')).toBe(false);
  });
});
