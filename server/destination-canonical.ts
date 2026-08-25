/**
 * destination-canonical.ts
 *
 * ONE naming authority for destinations on billing surfaces — owner rule:
 * "The Destination Catalog should be the only authoritative source for
 * destination names. Nothing should invent or rewrite destination names."
 *
 * A survey found billing speaking four disjoint vocabularies — raw Sippy
 * tariff strings frozen into snapshots, the static dial-codes.json, the
 * legacy global_destinations table, and bare numeric prefixes — while the
 * canonical `destinations` catalogue was joined by none of them. This module
 * replaces all of that for display naming: a tariff prefix resolves to its
 * catalogue entry by longest-prefix match, walking the hierarchy up to the
 * level-1 ancestor for the country name.
 *
 * A prefix with no catalogue entry is UNMAPPED — reported as such, never
 * papered over with an invented name, and surfaced by certification so the
 * catalogue grows instead of the gap hiding.
 *
 * Pure matching logic here (tested); the catalogue loader lives in
 * destination-canonical-db.ts.
 */

export interface CatalogueEntry {
  id: number;
  name: string;
  dialPrefix: string;   // digits only
  country: string;      // level-1 ancestor name (or own name for level-1 rows)
}

export interface CanonicalMatch {
  mapped: boolean;
  /** Catalogue name, or 'Unmapped Destination'. */
  destination: string;
  /** Level-1 country name, or '—' when unmapped. */
  country: string;
  entryId: number | null;
}

export const UNMAPPED: Omit<CanonicalMatch, 'entryId'> & { entryId: null } = {
  mapped: false, destination: 'Unmapped Destination', country: '—', entryId: null,
};

/**
 * Sippy trunk-class lead digits: 1 First Class, 2 Business, 6 Bravo, 7 Charlie
 * (the same set server/dial-lookup.ts strips). Every tariff prefix on this
 * platform carries one — the switch reports Pakistan as "192" and Bangladesh
 * as "1880", while the catalogue stores "92" and "880".
 */
const TRUNK_CLASS_DIGITS = new Set(['1', '2', '6', '7']);

/** Index entries by prefix length for longest-prefix matching. */
export function buildMatcher(entries: readonly CatalogueEntry[]) {
  const byPrefix = new Map<string, CatalogueEntry>();
  let maxLen = 0;
  for (const e of entries) {
    const p = String(e.dialPrefix ?? '').replace(/\D/g, '');
    if (!p) continue;
    // First writer wins on a duplicate prefix — catalogue governance owns
    // uniqueness; this module must stay deterministic regardless.
    if (!byPrefix.has(p)) byPrefix.set(p, e);
    if (p.length > maxLen) maxLen = p.length;
  }

  const lookup = (digits: string): CatalogueEntry | null => {
    for (let len = Math.min(digits.length, maxLen); len >= 1; len--) {
      const hit = byPrefix.get(digits.slice(0, len));
      if (hit) return hit;
    }
    return null;
  };

  return function match(rawPrefix: string | null | undefined): CanonicalMatch {
    const digits = String(rawPrefix ?? '').replace(/\D/g, '');
    if (!digits) return { ...UNMAPPED };

    // Strip the trunk-class digit FIRST, and let that win when both forms
    // resolve. Matching raw first looks safer but is demonstrably wrong here:
    // Sippy's "1880" is trunk-1 + Bangladesh, while the catalogue also holds
    // a literal "1880" for United States 800 — raw-first prints the wrong
    // COUNTRY on a customer invoice. Raw remains the fallback so a catalogue
    // or tariff that does not use the convention still resolves.
    const stripped = digits.length > 1 && TRUNK_CLASS_DIGITS.has(digits[0])
      ? digits.slice(1) : null;
    const hit = (stripped ? lookup(stripped) : null) ?? lookup(digits);

    if (!hit) return { ...UNMAPPED };
    // A row without a resolvable level-1 ancestor has NO country — the
    // Country column must never show an operator name.
    return { mapped: true, destination: hit.name, country: hit.country || '—', entryId: hit.id };
  };
}
