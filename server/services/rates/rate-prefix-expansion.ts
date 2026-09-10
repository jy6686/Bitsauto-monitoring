/**
 * rate-prefix-expansion.ts
 *
 * Turning one priced row into the prefixes it actually covers.
 *
 * A rate is priced per DESTINATION. The push already works that way — push-batch takes
 * `dialPrefixes` and expands one rate into one operation per prefix — but the two readers of
 * `product_rates` did not: rate-upload.service.ts and rates.step.ts each selected a single
 * `prefix` column. A catalogue destination holds many (AWCC is 9370 and 9371; the catalogue
 * averages ~14 across 1,344 destinations and 19,160 prefixes), so a destination priced through
 * Rate Manager would have uploaded a price for one prefix and left the rest unpriced.
 *
 * THREE RULES THIS MODULE KEEPS.
 *
 * 1. **It never guesses the id space.** `product_rates.destination_id` is ambiguous on its own —
 *    rates.step.ts reads it as a global_destinations id, Rate Manager writes it as a
 *    commercial_destinations id. Migration 515 made the space explicit in
 *    `catalogue_version_id`, and this module reads that FIRST. A row with no version is a legacy
 *    row and keeps its single-prefix behaviour exactly.
 *
 * 2. **It never carries a price across a catalogue version.** A re-import can keep a
 *    destination's name and change what it covers, so a price set against V1's "PAKISTAN -
 *    MOBILE JAZZ" is not a price for V2's. Such a row is refused as `stale_version` and
 *    reported. Nothing is matched by name or prefix to rescue it — that fuzzy matching is what
 *    produced the id-space residue in the first place. Re-pricing against the new version is a
 *    commercial act, the same way re-declaring eligibility is.
 *
 * 3. **It refuses rather than silently emitting less.** Every row returns a verdict. A caller
 *    that cannot expand a row must be able to say so on the run report, because "uploaded fewer
 *    prefixes than the operator priced" is indistinguishable from success at the switch.
 */

export type ExpansionVerdict =
  /** A catalogue-keyed row in the active version. `prefixes` is the destination's full set. */
  | 'catalogue'
  /** No catalogue identity. Prices the single prefix the row carries — unchanged behaviour. */
  | 'legacy_prefix'
  /** Priced against a catalogue version that is not the active one. Refused, not re-resolved. */
  | 'stale_version'
  /** Claims a catalogue destination that does not exist in that version. */
  | 'unknown_destination'
  /** Catalogue-keyed, in the active version, but the destination holds no prefixes. */
  | 'no_prefixes'
  /** Neither a catalogue identity nor a prefix — nothing to upload. */
  | 'unpriceable';

/** The columns an expandable row must carry. Callers pass their own rows through unchanged. */
export interface ExpandableRate {
  destinationId: number | null;
  prefix: string | null;
  catalogueVersionId: number | null;
}

export interface Expansion<T extends ExpandableRate> {
  row: T;
  verdict: ExpansionVerdict;
  /** Every prefix this price covers. Empty whenever the verdict is not `catalogue`/`legacy_prefix`. */
  prefixes: string[];
  /** The catalogue destination's name, when one was resolved — for reporting, never for matching. */
  destinationName: string | null;
  /** Why a row was refused, in words a run report can print. Null when it expanded. */
  reason: string | null;
}

export interface ExpansionQueryable {
  execute(query: any): Promise<any>;
}

/**
 * The drizzle `sql` helper, passed in so this module stays free of a database import and can be
 * driven by PGlite in tests. `.raw` is needed for the id list: binding a JS array as a single
 * parameter does not serialise, and the ids are forced through Number() before they reach it.
 */
export interface SqlHelper {
  (strings: TemplateStringsArray, ...values: any[]): any;
  raw(value: string): any;
}

const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : (r?.rows ?? []));

/**
 * Expand a batch of priced rows.
 *
 * Batched on purpose: a per-row lookup against the catalogue would issue one query per price, and
 * a provisioning run prices every destination of every product.
 *
 * `activeVersionId` is passed in rather than read here so the caller can report the same version
 * on its own summary, and so a caller that has already resolved it does not resolve it twice.
 */
export async function expandRates<T extends ExpandableRate>(
  db: ExpansionQueryable,
  rows: T[],
  activeVersionId: number | null,
  sqlTag: SqlHelper,
): Promise<Array<Expansion<T>>> {
  const legacyPrefix = (row: T): Expansion<T> => {
    const p = (row.prefix ?? '').trim();
    return p
      ? { row, verdict: 'legacy_prefix', prefixes: [p], destinationName: null, reason: null }
      : {
          row, verdict: 'unpriceable', prefixes: [], destinationName: null,
          reason: 'The row carries neither a catalogue destination nor a prefix, so there is nothing to price.',
        };
  };

  // Rows worth a catalogue lookup: those that declare a version AND a destination.
  const wanted = new Set<number>();
  for (const r of rows) {
    if (r.catalogueVersionId !== null && r.catalogueVersionId !== undefined
        && r.destinationId !== null && r.destinationId !== undefined
        && r.catalogueVersionId === activeVersionId) {
      wanted.add(Number(r.destinationId));
    }
  }

  const byDest = new Map<number, { name: string; versionId: number; prefixes: string[] }>();
  if (wanted.size > 0) {
    // Scoped to the active version in the query as well as the filter above, so a destination id
    // that exists in another version cannot answer for this one.
    // Integers only, and asserted as such before they are inlined. Every value here came from
    // Number() above, but the id list is the one fragment that is not parameter-bound, so it is
    // re-checked rather than trusted: a non-integer reaching this string would be an injection.
    const ids = Array.from(wanted).filter(Number.isInteger);
    if (ids.length !== wanted.size) {
      throw new Error('rate expansion: a non-integer destination id reached the catalogue lookup.');
    }
    const res = await db.execute(sqlTag`
      SELECT d.id, d.name, d.version_id,
             COALESCE(array_agg(p.prefix ORDER BY p.prefix) FILTER (WHERE p.prefix IS NOT NULL), '{}') AS prefixes
        FROM commercial_destinations d
        LEFT JOIN commercial_destination_prefixes p ON p.destination_id = d.id
       WHERE d.version_id = ${activeVersionId}
         AND d.id IN (${sqlTag.raw(ids.join(','))})
       GROUP BY d.id, d.name, d.version_id`);
    for (const r of rowsOf(res)) {
      byDest.set(Number(r.id), {
        name: String(r.name),
        versionId: Number(r.version_id),
        prefixes: Array.isArray(r.prefixes)
          ? r.prefixes.map(String)
          : String(r.prefixes ?? '').replace(/^\{|\}$/g, '').split(',').filter(Boolean),
      });
    }
  }

  return rows.map((row): Expansion<T> => {
    const version = row.catalogueVersionId;
    if (version === null || version === undefined) return legacyPrefix(row);

    if (row.destinationId === null || row.destinationId === undefined) {
      // A version with no destination says the row was meant to be catalogue-keyed and is not.
      // Falling back to its prefix would upload a price the row does not actually make.
      return {
        row, verdict: 'unpriceable', prefixes: [], destinationName: null,
        reason: `The row claims catalogue version ${version} but names no destination, so what it prices cannot be established.`,
      };
    }

    if (activeVersionId === null || Number(version) !== Number(activeVersionId)) {
      return {
        row, verdict: 'stale_version', prefixes: [], destinationName: null,
        reason: `Priced against catalogue version ${version}; the active version is ${activeVersionId ?? 'none'}. `
              + `A destination can keep its name across a re-import while changing which prefixes it covers, so this price is not carried over. Re-price it against the active version.`,
      };
    }

    const dest = byDest.get(Number(row.destinationId));
    if (!dest) {
      return {
        row, verdict: 'unknown_destination', prefixes: [], destinationName: null,
        reason: `Destination ${row.destinationId} is not in catalogue version ${version}.`,
      };
    }
    if (dest.prefixes.length === 0) {
      return {
        row, verdict: 'no_prefixes', prefixes: [], destinationName: dest.name,
        reason: `${dest.name} holds no prefixes in version ${version}, so a price on it reaches nothing.`,
      };
    }
    return { row, verdict: 'catalogue', prefixes: dest.prefixes, destinationName: dest.name, reason: null };
  });
}

/** The active catalogue version, or null when none is. Kept here so both readers ask identically. */
export async function activeCatalogueVersionId(
  db: ExpansionQueryable,
  sqlTag: SqlHelper,
): Promise<number | null> {
  const [v] = rowsOf(await db.execute(sqlTag`SELECT id FROM catalogue_versions WHERE status = 'active' LIMIT 1`));
  return v ? Number(v.id) : null;
}

/** Verdicts that produced no prefixes and therefore belong on a run report. */
export const REFUSED_VERDICTS: ExpansionVerdict[] =
  ['stale_version', 'unknown_destination', 'no_prefixes', 'unpriceable'];

/** One line per refused row, for a step report. Grouped so a version rollover reads as one cause. */
export function summariseRefusals<T extends ExpandableRate>(expansions: Array<Expansion<T>>): string[] {
  const byVerdict = new Map<ExpansionVerdict, Expansion<T>[]>();
  for (const e of expansions) {
    if (!REFUSED_VERDICTS.includes(e.verdict)) continue;
    const list = byVerdict.get(e.verdict) ?? [];
    list.push(e);
    byVerdict.set(e.verdict, list);
  }
  const out: string[] = [];
  for (const [verdict, list] of byVerdict) {
    // The first row's reason states the cause; the count states the scale. Naming every row would
    // render 19k lines into a step report on a version rollover.
    out.push(`${list.length} price(s) not uploaded — ${verdict}: ${list[0].reason}`);
  }
  return out;
}
