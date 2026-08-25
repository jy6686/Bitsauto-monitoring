/**
 * Canonical destination matching — the one naming authority for billing.
 *
 * Pins the owner's rule: catalogue name or "Unmapped Destination", never an
 * invented name; longest prefix wins; country comes from the hierarchy.
 */

import { describe, it, expect } from 'vitest';
import { buildMatcher, type CatalogueEntry } from './destination-canonical';

const CAT: CatalogueEntry[] = [
  { id: 1, name: 'Pakistan',   dialPrefix: '92',    country: 'Pakistan' },
  { id: 2, name: 'Jazz',       dialPrefix: '92300', country: 'Pakistan' },
  { id: 3, name: 'Telenor',    dialPrefix: '92345', country: 'Pakistan' },
  { id: 4, name: 'Ufone',      dialPrefix: '9233',  country: 'Pakistan' },
];

describe('buildMatcher', () => {
  const match = buildMatcher(CAT);

  it('longest prefix wins over the country-level entry', () => {
    expect(match('92300')).toMatchObject({ mapped: true, destination: 'Jazz', country: 'Pakistan' });
    expect(match('9233'))  .toMatchObject({ destination: 'Ufone' });
  });

  it('a longer dialed prefix still resolves to its best catalogue ancestor', () => {
    // Tariff prefix 923457 has no exact row; 92345 (Telenor) is the match.
    expect(match('923457')).toMatchObject({ destination: 'Telenor' });
    // 9299 matches only the country row.
    expect(match('9299')).toMatchObject({ destination: 'Pakistan', country: 'Pakistan' });
  });

  it('no catalogue entry → Unmapped Destination, never an invented name', () => {
    expect(match('4477')).toMatchObject({ mapped: false, destination: 'Unmapped Destination', country: '—' });
    expect(match('')).toMatchObject({ mapped: false });
    expect(match(null)).toMatchObject({ mapped: false });
  });

  it('non-digits in the stored prefix are ignored for matching', () => {
    expect(match('92-300')).toMatchObject({ destination: 'Jazz' });
  });

  it('an empty catalogue maps nothing and throws never', () => {
    const empty = buildMatcher([]);
    expect(empty('92300').mapped).toBe(false);
  });
});

/**
 * Built from the LIVE catalogue and the LIVE Sippy prefixes, not invented:
 * the catalogue stores 92 / 880 / 9230 / 9232 and also a literal 1880 for
 * United States 800, while the switch reports 192 / 1880 / 19230 / 19232.
 * Matching raw digits therefore printed Bangladesh traffic as United States.
 */
describe('Sippy trunk-class prefixes (production data)', () => {
  const LIVE: CatalogueEntry[] = [
    { id: 1, name: 'Pakistan',             dialPrefix: '92',   country: 'Pakistan'   },
    { id: 2, name: 'Bangladesh',           dialPrefix: '880',  country: 'Bangladesh' },
    { id: 3, name: 'United States 800',    dialPrefix: '1880', country: 'United States' },
    { id: 4, name: 'Pakistan Mobile Jazz', dialPrefix: '9230', country: 'Pakistan'   },
    { id: 5, name: 'Pakistan Mobile Jazz', dialPrefix: '9232', country: 'Pakistan'   },
  ];
  const match = buildMatcher(LIVE);

  it('1880 is trunk-1 + Bangladesh, NOT United States 800', () => {
    // The wrong-country defect: raw-first matched the literal 1880 entry.
    const m = match('1880');
    expect(m.country).toBe('Bangladesh');
    expect(m.destination).toBe('Bangladesh');
  });

  it('resolves every prefix the switch actually reported that week', () => {
    expect(match('192')).toMatchObject({ country: 'Pakistan', destination: 'Pakistan' });
    expect(match('19230')).toMatchObject({ destination: 'Pakistan Mobile Jazz' });
    expect(match('19232')).toMatchObject({ destination: 'Pakistan Mobile Jazz' });
    // 19234 has no catalogue row of its own; it falls back to the country.
    expect(match('19234')).toMatchObject({ country: 'Pakistan' });
  });

  it('a prefix carrying no trunk digit still resolves on the raw form', () => {
    expect(match('92')).toMatchObject({ country: 'Pakistan' });
    expect(match('880')).toMatchObject({ country: 'Bangladesh' });
    expect(match('9230')).toMatchObject({ destination: 'Pakistan Mobile Jazz' });
  });

  it('an unknown prefix is still unmapped, never force-fitted', () => {
    expect(match('1999').mapped).toBe(false);
    expect(match('4477').mapped).toBe(false);
  });

  it('duplicate catalogue prefixes resolve deterministically', () => {
    // The live catalogue holds Pakistan 92 and Bangladesh 880 twice each.
    const dup = buildMatcher([...LIVE, { id: 9, name: 'Pakistan', dialPrefix: '92', country: 'Pakistan' }]);
    expect(dup('192').entryId).toBe(1);
  });
});
