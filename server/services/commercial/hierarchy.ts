/**
 * Country › Type › Operator, derived from the supplier name.
 *
 * The catalogue stores a flat supplier name and no country, type, operator or parent_id
 * column, deliberately: none of those are in the supplier file, and persisting an inference
 * would make a guess indistinguishable from supplied fact the moment it is wrong. The tree
 * is therefore derived per request and stored nowhere, so a corrected rule takes effect
 * immediately and needs no migration.
 *
 * This lives in its own module because TWO surfaces draw the same tree — the Send Rate
 * picker over sellable destinations, and the catalogue page over every destination in a
 * version, approved or not. Deriving it twice would let the two disagree about what
 * "PAKISTAN - MOBILE ZONG" is, and a disagreement between the screen you approve on and the
 * screen you sell from is worse than either rule being wrong on its own.
 *
 * Nothing here is country-specific. The rules are: split on the separator, recognise a type
 * keyword, treat the rest as the operator. PAKISTAN - MOBILE ZONG and USA - MOBILE VERIZON
 * pass through identical code.
 */

/** A destination as it comes out of the database, before the tree is drawn. */
export type HierarchyRow = {
  id: number;
  name: string;
  prefixCount: number;
  /** Only the catalogue view carries this; the picker's rows are approved by definition. */
  approvalStatus?: string;
};

export type HierarchyLeaf = {
  id: number;
  /** The supplier name, byte-for-byte. The identity, and what the backend pushes against. */
  name: string;
  /** What to render: the operator token, or the type when the destination IS the type node. */
  label: string;
  prefixCount: number;
  approvalStatus?: string;
};

export type HierarchyType = {
  type: string;
  /** Selectable at the type level when a destination exists there — INDIA - MOBILE has no
   *  operator level because the supplier does not sell one. Null when it does not. */
  destinationId: number | null;
  prefixCount: number;
  approvalStatus?: string;
  operators: HierarchyLeaf[];
};

export type HierarchyCountry = { country: string; types: HierarchyType[] };

/**
 * The vocabulary is a constant, not a table. It decides only how the tree is DRAWN; getting
 * an entry wrong misfiles a row in a dropdown, it does not change what is sold or charged.
 */
export const TYPE_KEYWORDS = new Set([
  'MOBILE', 'FIXED', 'SATELLITE', 'PREMIUM', 'SPECIAL', 'TOLL', 'PAGING',
  'VOIP', 'SHARED', 'PERSONAL', 'AUDIOTEXT', 'ROAMING', 'SERVICES',
]);

/**
 * Where the 17 names carrying no separator go. Inventing a country for CANADA, INMARSAT,
 * SATELLITE 5, WAKE ISLAND or UNITED NATIONS OCHA would be a fabrication; grouping them
 * under a visible bucket is not.
 */
export const UNGROUPED_COUNTRY = 'Global Services';

/** The separator is literal, not inferred: 1,327 of 1,344 supplier names carry it. */
const SEPARATOR = ' - ';

/** Splits one supplier name into its parts. Exported so a single name can be explained. */
export function parseDestinationName(name: string): { country: string; type: string; operator: string } {
  const [head, ...tail] = name.split(SEPARATOR);
  const country   = tail.length ? head.trim() : UNGROUPED_COUNTRY;
  const remainder = (tail.length ? tail.join(SEPARATOR) : name).trim();
  const words     = remainder.split(/\s+/).filter(Boolean);
  const hasType   = words.length > 0 && TYPE_KEYWORDS.has(words[0].toUpperCase());
  return {
    country,
    type:     hasType ? words[0] : 'Other',
    operator: (hasType ? words.slice(1) : words).join(' '),
  };
}

/** Builds the whole tree. Sorted so the same input always renders in the same order. */
export function buildHierarchy(input: HierarchyRow[]): HierarchyCountry[] {
  const countries = new Map<string, Map<string, { self: HierarchyLeaf | null; operators: HierarchyLeaf[] }>>();

  for (const row of input) {
    const { country, type, operator } = parseDestinationName(row.name);

    if (!countries.has(country)) countries.set(country, new Map());
    const types = countries.get(country)!;
    if (!types.has(type)) types.set(type, { self: null, operators: [] });
    const node = types.get(type)!;

    const leaf: HierarchyLeaf = {
      id: row.id,
      name: row.name,
      label: operator || type,
      prefixCount: row.prefixCount,
      approvalStatus: row.approvalStatus,
    };
    // No operator token means the destination IS the type node.
    if (operator) node.operators.push(leaf); else node.self = leaf;
  }

  return [...countries.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([country, types]) => ({
      country,
      types: [...types.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([type, node]) => ({
          type,
          destinationId:  node.self?.id ?? null,
          prefixCount:    node.self?.prefixCount ?? 0,
          approvalStatus: node.self?.approvalStatus,
          operators:      node.operators.sort((a, b) => a.label.localeCompare(b.label)),
        })),
    }));
}
