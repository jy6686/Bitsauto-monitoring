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
