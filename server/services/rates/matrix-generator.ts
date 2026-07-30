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
  /** False when `errors` is non-empty. Nothing may be uploaded from a matrix that is not ok. */
  ok: boolean;
  /** Conditions that would produce a WRONG tariff. Generation still returns its rows so a
   *  preview can show what went wrong — but no caller may upload while these exist. */
  errors: string[];
  /** Conditions worth an operator's attention that do not make the tariff wrong. */
  warnings: string[];
  /** Counts for the UI, so a summary panel needs no arithmetic of its own. */
  summary: {
    destinationsProcessed: number;
    destinationsApproved: number;
    rowsGenerated: number;
    rowsSkipped: number;
    errorCount: number;
    warningCount: number;
  };
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

  // ── Verdict, computed here rather than in a separate validate() ─────────────
  // Duplicate detection in particular MUST live in generation. As a separate step it is
  // a step a caller can forget, and the consequence of forgetting is a tariff where one
  // destination silently overwrites another and which one wins depends on row order.
  // The upload engine should never be the thing that discovers this.
  const errors: string[] = [];
  const warnings: string[] = [];

  const seen = new Map<string, string>();
  for (const r of rows) {
    const prior = seen.get(r.prefix);
    if (prior) {
      errors.push(`Prefix ${r.prefix} is produced by both "${prior}" and "${r.destinationName}" (${r.productCode}) — one would overwrite the other in the tariff.`);
    } else {
      seen.set(r.prefix, `${r.destinationName} (${r.productCode})`);
    }
  }

  if (!rows.length) {
    errors.push('No rows generated — no approved destination has a price for any product.');
  }
  for (const p of products) {
    if ((counts.get(p.code) ?? 0) === 0) {
      errors.push(`Product ${p.code} (${p.name}) produced no rows — a customer would carry it unpriced.`);
    }
  }

  const unroutable = skipped.filter(s2 => s2.reason === 'no-routing-group');
  if (unroutable.length) {
    warnings.push(`${unroutable.length} cell(s) priced with no routing group: ${unroutable.slice(0, 3).map(s2 => `${s2.destinationName}/${s2.productCode}`).join(', ')}${unroutable.length > 3 ? ' …' : ''}`);
  }
  const notApproved = skipped.filter(s2 => s2.reason === 'not-approved');
  if (notApproved.length) {
    warnings.push(`${notApproved.length} destination(s) excluded — not approved in the catalogue.`);
  }
  const noRate = skipped.filter(s2 => s2.reason === 'no-rate');
  if (noRate.length) {
    warnings.push(`${noRate.length} (destination, product) cell(s) have no price.`);
  }

  return {
    rows,
    skipped,
    byProduct: products.map(p => ({ code: p.code, name: p.name, count: counts.get(p.code) ?? 0 })),
    ok: errors.length === 0,
    errors,
    warnings,
    summary: {
      destinationsProcessed: destinations.length,
      destinationsApproved:  destinations.filter(d => d.commercialStatus === 'approved').length,
      rowsGenerated: rows.length,
      rowsSkipped:   skipped.length,
      errorCount:    errors.length,
      warningCount:  warnings.length,
    },
  };
}
