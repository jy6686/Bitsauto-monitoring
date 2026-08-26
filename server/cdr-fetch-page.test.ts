import { describe, it, expect } from 'vitest';
import { classifyCdrPage } from './cdr-fetch-page';

const PAGE = 500;

describe('classifyCdrPage — an error is never end-of-data', () => {
  /**
   * The owner's rule, and the defect it pins: the fetch returned [] for auth
   * failures, HTTP errors, faults and timeouts, and [] is shorter than a page,
   * so a fault at page 800 of 900 read as "no more records" and the period was
   * certified on a partial month.
   */
  it('classifies a failed fetch as error regardless of its count', () => {
    expect(classifyCdrPage({ ok: false, count: 0 },    PAGE)).toBe('error');
    expect(classifyCdrPage({ ok: false, count: 499 },  PAGE)).toBe('error');
    // Even a "full-looking" failed page is an error — its count means nothing.
    expect(classifyCdrPage({ ok: false, count: PAGE }, PAGE)).toBe('error');
  });

  it('never lets ok:false reach end_of_data for any count', () => {
    for (let count = 0; count <= PAGE; count += 50) {
      expect(classifyCdrPage({ ok: false, count }, PAGE)).toBe('error');
    }
  });
});

describe('classifyCdrPage — a successful short page is the end, in-band', () => {
  it('classifies a successful empty page as end_of_data', () => {
    expect(classifyCdrPage({ ok: true, count: 0 }, PAGE)).toBe('end_of_data');
  });

  it('classifies a successful partial page as end_of_data', () => {
    expect(classifyCdrPage({ ok: true, count: 1 },   PAGE)).toBe('end_of_data');
    expect(classifyCdrPage({ ok: true, count: 499 }, PAGE)).toBe('end_of_data');
  });

  it('classifies a full page as continue — there may be more', () => {
    expect(classifyCdrPage({ ok: true, count: PAGE }, PAGE)).toBe('continue');
  });

  it('treats an over-full page as continue, not end_of_data', () => {
    // Should not happen; if a server over-delivers, the only safe reading is
    // "keep going" — anything else truncates.
    expect(classifyCdrPage({ ok: true, count: PAGE + 1 }, PAGE)).toBe('continue');
  });
});
