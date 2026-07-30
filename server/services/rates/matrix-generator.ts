/**
 * The one place a Sippy rate prefix is produced.
 *
 * A prefix is DERIVED — `product.trunkPrefix + destination.dialPrefix` — and is never
 * stored. Storing a copy creates a second place the truth can be wrong and a place a typo
 * survives; generating it means adding a fifth product costs one product_registry row and
 * changes no destination data. Routing, rating and authentication then all key off the
 * same destination record instead of three lists that drift.
 *
 * FOUR BUSINESS INPUTS, one output. All injected rather than queried, for the same reason
 * rate-matrix.ts imports nothing from the app: server/db.ts throws at module load without
 * DATABASE_URL, and this is exactly the logic that has to be testable without a database.
 *
 *   Destination Catalogue  which destinations may be sold at all, and their dial prefix
 *   Product Registry       FC/BC/SB/SC and the trunk digit each contributes
 *   Product Rates          the commercial price for (destination, product)
 *   Routing eligibility    whether that cell can actually carry a call
 *
 * NOTHING IS SILENTLY DROPPED. Every destination that does not produce a row is reported
 * with the reason, because a matrix that comes back smaller than expected is
 * indistinguishable from a customer who bought less — that ambiguity has cost this project
 * several debugging rounds already.
 */

/** A Destination Catalogue entry. `commercialStatus` is authoritative: only 'approved' is sellable. */
export interface CatalogueDestination {
  id: number;
  dialPrefix: string | null;
  name: string;
  country: string | null;
  /** 'approved' | 'blocked' | 'testing' | 'deprecated' | 'pending' */
  commercialStatus: string;
}

export interface GeneratorProduct {
  id: number;
  code: string;
  name: string;
  trunkPrefix: string | null;
}

export interface GeneratorRate {
  destinationId: number;
  productId: number;
  rate: number;
}

export interface GeneratedRow {
  destinationId: number;
  destinationName: string;
  productId: number;
  productCode: string;
  /** trunkPrefix + dialPrefix — the value Sippy receives. Computed here, stored nowhere. */
  prefix: string;
  country: string | null;
  rate: number;
}

export interface GeneratorSkip {
  destinationId: number | null;
  destinationName: string;
  productCode: string | null;
  reason:
    | 'not-approved'          // catalogue says blocked / testing / deprecated / pending
    | 'no-dial-prefix'        // approved but unusable — nothing to compose from
    | 'no-trunk-prefix'       // the product has no digit, so it cannot be sold
    | 'no-rate'               // priced nowhere for this product
    | 'no-routing-group';     // priced but the call has nowhere to go
  detail: string;
}

export interface GeneratedMatrix {
  rows: GeneratedRow[];
  skipped: GeneratorSkip[];
  byProduct: Array<{ code: string; name: string; count: number }>;
}

export interface GenerateOptions {
  destinations: CatalogueDestination[];
  products: GeneratorProduct[];
  rates: GeneratorRate[];
  /**
   * Cells that resolve to a Sippy routing group, as `${country}|${productCode}`.
   *
   * OPTIONAL, and omitting it means "do not check". Routing eligibility lives in
   * routing_package_entries keyed by COUNTRY NAME and PRODUCT NAME, while the catalogue
   * keys destinations by country_code — those do not join cleanly, so the caller resolves
   * the mapping and this function only reports what it was told. Inventing a join here
   * would silently price destinations that cannot carry a call.
   */
  routableCells?: Set<string>;
}

/**
 * A rate priced with no route is NOT excluded — it is reported.
 *
 * Excluding it would quietly under-price a customer whose routing is being set up this
 * week; including it silently would quote traffic that fails. Neither is ours to decide,
 * so both the row and the warning come back and the caller chooses.
 */
export function generateRateMatrix(opts: GenerateOptions): GeneratedMatrix {
  const { destinations, products, rates, routableCells } = opts;

  const rateOf = new Map<string, number>();
  for (const r of rates) rateOf.set(`${r.destinationId}|${r.productId}`, r.rate);

  const rows: GeneratedRow[] = [];
  const skipped: GeneratorSkip[] = [];
  const counts = new Map<string, number>();

  for (const d of destinations) {
    if (d.commercialStatus !== 'approved') {
      skipped.push({
        destinationId: d.id, destinationName: d.name, productCode: null,
        reason: 'not-approved',
        detail: `Catalogue status is "${d.commercialStatus}" — only approved destinations may be sold.`,
      });
      continue;
    }
    const dial = (d.dialPrefix ?? '').trim();
    if (!dial) {
      skipped.push({
        destinationId: d.id, destinationName: d.name, productCode: null,
        reason: 'no-dial-prefix',
        detail: 'Approved in the catalogue but has no dial prefix, so no Sippy prefix can be composed.',
      });
      continue;
    }

    for (const p of products) {
      const trunk = (p.trunkPrefix ?? '').trim();
      if (!trunk) {
        skipped.push({
          destinationId: d.id, destinationName: d.name, productCode: p.code,
          reason: 'no-trunk-prefix',
          detail: `Product ${p.code} has no trunk prefix — it cannot be sold until one is set in the Product Registry.`,
        });
        continue;
      }

      const rate = rateOf.get(`${d.id}|${p.id}`);
      if (rate === undefined) {
        skipped.push({
          destinationId: d.id, destinationName: d.name, productCode: p.code,
          reason: 'no-rate',
          detail: `No price for ${d.name} on ${p.name}. A customer would carry this destination unpriced.`,
        });
        continue;
      }

      if (routableCells && d.country && !routableCells.has(`${d.country}|${p.code}`)) {
        // Reported, and the row is still produced — see the note above.
        skipped.push({
          destinationId: d.id, destinationName: d.name, productCode: p.code,
          reason: 'no-routing-group',
          detail: `${d.country}/${p.name} has no routing group, so this rate would price traffic that cannot be routed.`,
        });
      }

      rows.push({
        destinationId: d.id,
        destinationName: d.name,
        productId: p.id,
        productCode: p.code,
        prefix: `${trunk}${dial}`,
        country: d.country,
        rate,
      });
      counts.set(p.code, (counts.get(p.code) ?? 0) + 1);
    }
  }

  return {
    rows,
    skipped,
    byProduct: products.map(p => ({ code: p.code, name: p.name, count: counts.get(p.code) ?? 0 })),
  };
}

/**
 * Refuse a matrix that would produce a wrong tariff.
 *
 * Separate from generation so a caller can preview a partial matrix — seeing what is
 * missing is the point of the preview — while an upload still cannot proceed on one.
 */
export function validateGeneratedMatrix(m: GeneratedMatrix): { ok: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!m.rows.length) errors.push('No rows generated — no approved destination has a price for any product.');

  // Two destinations composing to one prefix means one silently overwrites the other in
  // the tariff, and which one wins depends on row order.
  const seen = new Map<string, string>();
  for (const r of m.rows) {
    const prior = seen.get(r.prefix);
    if (prior) {
      errors.push(`Prefix ${r.prefix} is produced by both "${prior}" and "${r.destinationName}" — one would overwrite the other.`);
    } else {
      seen.set(r.prefix, `${r.destinationName} (${r.productCode})`);
    }
  }

  for (const p of m.byProduct) {
    if (p.count === 0) errors.push(`Product ${p.code} (${p.name}) produced no rows — a customer would carry it unpriced.`);
  }

  const unroutable = m.skipped.filter(s => s.reason === 'no-routing-group');
  if (unroutable.length) {
    warnings.push(`${unroutable.length} cell(s) are priced but have no routing group: ${unroutable.slice(0, 3).map(s => `${s.destinationName}/${s.productCode}`).join(', ')}${unroutable.length > 3 ? ' …' : ''}`);
  }
  const notApproved = m.skipped.filter(s => s.reason === 'not-approved');
  if (notApproved.length) {
    warnings.push(`${notApproved.length} destination(s) excluded as not approved in the catalogue.`);
  }

  return { ok: errors.length === 0, errors, warnings };
}
