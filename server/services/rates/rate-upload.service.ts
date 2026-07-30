/**
 * RateUploadService — the database half of "put these rates into a Sippy tariff".
 *
 * Resolves the default rate matrix from product_rates and hands rows to rate-matrix.ts,
 * which turns them into the workbook. One implementation, two entry points: the
 * provisioning step and Rate Manager both call this rather than either calling the other.
 *
 * The provisioning engine must NOT reach this by POSTing to /api/rate-manager/push-batch.
 * A self-call re-authenticates, re-serialises, and inherits the route's role check — a
 * provisioning run failing on its own auth middleware is a genuinely confusing bug. Call
 * the function.
 *
 * The transform lives in rate-matrix.ts, deliberately free of app imports so the workbook
 * can be tested without a database. The transport (upload token, XLSX POST, status poll,
 * read-back verify) stays in server/sippy.ts, which owns the credential fallbacks.
 */
import { db } from "../../db";
import { productRates, productRegistry } from "../../../shared/schema";
import { and, eq, or, sql, inArray } from "drizzle-orm";
import { composePrefix, type RateRow, type ResolvedDefaults } from "./rate-matrix";

export {
  buildBulkRateXlsx, validateDefaults, composePrefix,
  RATE_XLSX_HEADERS, type RateRow, type ResolvedDefaults,
} from "./rate-matrix";

/**
 * Resolve the default rate matrix: every active product x its priced destinations.
 *
 * EFFECTIVE DATING — product_rates carries effectiveFrom/effectiveTo, so "the rate" is
 * only meaningful as of a date. The filter matches the one routes-rate-manager.ts already
 * uses, so the automated path and the operator path read the same prices on the same day.
 * asOf is injectable so a caller (or a test) does not depend on today's date.
 *
 * A product with no trunk prefix, or with no rates effective today, yields no rows and is
 * NAMED in productsWithoutRates. Returning a smaller matrix silently is the failure that
 * matters here: it provisions a customer priced on three tiers out of four, and nothing
 * downstream can tell that apart from a customer who only bought three.
 */
export async function resolveDefaultRates(opts: {
  /**
   * Which default price list applies — resolved from the company's provisioning profile
   * (`provisioning_profiles.rate_policy`).
   *
   * ACCEPTED BUT NOT YET APPLIED. product_rates has no policy dimension today, so every
   * caller currently gets the platform default and passing a policy changes nothing. It
   * is in the signature from the start deliberately: the alternative is adding a required
   * argument once provisioning, Rate Manager and the certification page are all calling
   * this, and a missed caller would silently price a customer off the wrong list rather
   * than failing.
   *
   * Left as a string because provisioning_profiles.rate_policy is a NAME today. When the
   * rate_policies pointer table lands (anticipated in 042's column comment), this becomes
   * an id and only this function changes — the workbook builder never sees it.
   */
  ratePolicy?: string | null;
  /** Restrict to these product codes (FC/BC/SB/SC). Omit for every active product. */
  productCodes?: string[];
  asOf?: Date;
} = {}): Promise<ResolvedDefaults> {
  const asOf = (opts.asOf ?? new Date()).toISOString().slice(0, 10);
  if (opts.ratePolicy) {
    // Say so rather than appearing to honour it. A caller that thinks it selected a
    // policy and got the platform default would only discover the difference in a
    // customer's bill.
    console.warn(`[rates] resolveDefaultRates: ratePolicy "${opts.ratePolicy}" ignored — product_rates has no policy dimension yet; returning the platform default matrix.`);
  }

  const products = await db
    .select({
      id: productRegistry.id,
      code: productRegistry.code,
      name: productRegistry.name,
      trunkPrefix: productRegistry.trunkPrefix,
    })
    .from(productRegistry)
    .where(
      opts.productCodes?.length
        ? and(eq(productRegistry.status, 'active'), inArray(productRegistry.code, opts.productCodes))
        : eq(productRegistry.status, 'active'),
    );

  const rows: RateRow[] = [];
  const byProduct: ResolvedDefaults['byProduct'] = [];
  const productsWithoutRates: ResolvedDefaults['productsWithoutRates'] = [];

  for (const p of products) {
    const trunk = (p.trunkPrefix ?? '').trim();
    if (!trunk) {
      // No digit means no way to compose a switch-side prefix — the product cannot be sold.
      productsWithoutRates.push({ code: p.code, name: p.name });
      continue;
    }

    const rates = await db
      .select({ prefix: productRates.prefix, rate: productRates.rate })
      .from(productRates)
      .where(
        and(
          eq(productRates.productId, p.id),
          sql`${productRates.effectiveFrom} <= ${asOf}`,
          or(
            sql`${productRates.effectiveTo} IS NULL`,
            sql`${productRates.effectiveTo} >= ${asOf}`,
          ),
        ),
      );

    let n = 0;
    for (const r of rates) {
      const dest = (r.prefix ?? '').trim();
      if (!dest) continue;
      rows.push({ prefix: composePrefix(trunk, dest), rate: Number(r.rate) });
      n++;
    }

    byProduct.push({ code: p.code, name: p.name, trunkPrefix: trunk, count: n });
    if (n === 0) productsWithoutRates.push({ code: p.code, name: p.name });
  }

  return { rows, byProduct, productsWithoutRates };
}
