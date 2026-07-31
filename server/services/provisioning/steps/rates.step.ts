/**
 * rates.step.ts — load the customer's opening prices into their Sippy tariff.
 *
 * LAST, AND AFTER VERIFICATION, ON PURPOSE. The rows go into the tariff the account
 * references, so the account, its service plan and its authentication all have to exist
 * and be verified first. Running earlier would price a customer who may never be
 * provisioned.
 *
 * READS INTENT, ASKS NOTHING. company_products and company_markets record what the
 * customer bought at company creation, so nobody opens Rate Manager during onboarding.
 * Rate Manager keeps every LATER upload — re-rates, negotiated sheets, bulk refreshes —
 * and this step keeps only the first.
 *
 * NON-BLOCKING. A customer with a working account and no rates is recoverable in minutes
 * from Rate Manager; a provisioning run aborted at the last step, leaving an account that
 * authenticates and routes but is marked failed, is worse. It reports precisely what it
 * did so an operator can finish the job rather than guess at it.
 *
 * EMPTY SELECTION MEANS EVERYTHING, matching the wizard: no recorded products or markets
 * is not an unpriced customer, it is a customer on the full commercial set.
 */
import { db } from "../../../db";
import { companyProducts, companyMarkets, productRegistry, globalDestinations, productRates } from "../../../../shared/schema";
import { and, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import * as sippy from "../../../sippy";
import { generateRateMatrix, type CatalogueDestination, type GeneratorProduct, type GeneratorRate } from "../../rates/matrix-generator";
import { buildBulkRateXlsx } from "../../rates/rate-matrix";
import type { ProvisioningStep, StepContext, StepOutcome } from "../types";

export const ratesStep: ProvisioningStep = {
  key:   'rates',
  label: 'Upload Rates',
  order: 90,
  // See the header: a priced-but-unprovisioned customer is worse than a provisioned
  // one whose rates need a second action.
  blocking: false,

  async validate(ctx: StepContext): Promise<string | null> {
    const iTariff = (ctx.results?.tariff as any)?.iTariff;
    if (!iTariff) return 'No tariff id from the tariff step — rates have nowhere to go.';
    // Checked here so a bad id is named by this step rather than by Postgres. The operator
    // saw `invalid input syntax for type integer: "NaN"` on a stage called Upload Rates,
    // which says nothing about what was wrong or where.
    if (!Number.isInteger(ctx.companyId) || ctx.companyId <= 0) {
      return `No usable company id on the run context (${String(ctx.companyId)}) — rates cannot be looked up.`;
    }
    return null;
  },

  async execute(ctx: StepContext): Promise<StepOutcome> {
    // ctx.companyId, not ctx.input.companyId. `input` is the FROZEN SNAPSHOT of the
    // onboarding form — it deliberately does not carry the company id, which lives on the
    // context. Reading it through `as any` produced Number(undefined) === NaN, which
    // Drizzle passed straight to Postgres:
    //
    //   invalid input syntax for type integer: "NaN"
    //
    // Every other step already uses ctx.companyId. The cast is what let this one differ.
    const companyId = ctx.companyId;
    const iTariff   = Number((ctx.results?.tariff as any)?.iTariff);
    const asOf      = new Date().toISOString().slice(0, 10);

    // ── What the customer bought ────────────────────────────────────────────
    const chosenProducts = await db.select({ productId: companyProducts.productId })
      .from(companyProducts).where(eq(companyProducts.companyId, companyId));
    const chosenMarkets = await db.select({ destinationId: companyMarkets.destinationId })
      .from(companyMarkets).where(eq(companyMarkets.companyId, companyId));

    const productIds = chosenProducts.map(r => r.productId);
    const marketIds  = chosenMarkets.map(r => r.destinationId);

    const products: GeneratorProduct[] = await db
      .select({ id: productRegistry.id, code: productRegistry.code, name: productRegistry.name, trunkPrefix: productRegistry.trunkPrefix })
      .from(productRegistry)
      .where(productIds.length
        ? inArray(productRegistry.id, productIds)
        : inArray(productRegistry.status, ['active', 'commercial']));

    const destinations: CatalogueDestination[] = await db
      .select({
        id: globalDestinations.id, dialPrefix: globalDestinations.dialPrefix,
        name: globalDestinations.name, country: globalDestinations.countryCode,
        commercialStatus: globalDestinations.commercialStatus,
      })
      .from(globalDestinations)
      .where(marketIds.length
        ? inArray(globalDestinations.id, marketIds)
        : and(eq(globalDestinations.commercialStatus, 'approved'), isNotNull(globalDestinations.dialPrefix)));

    if (!products.length || !destinations.length) {
      return {
        status: 'skipped',
        detail: [`No rates to load — ${products.length} product(s), ${destinations.length} destination(s).`],
        metrics: { requested: 0, skipped: 1, products: products.length, destinations: destinations.length },
      };
    }

    // Prices effective today. Same filter Rate Manager uses, so the automated path and
    // the operator path cannot read different numbers on the same day.
    const priced = await db
      .select({
        destinationId: productRates.destinationId, productId: productRates.productId,
        rate: productRates.rate, prefix: productRates.prefix,
      })
      .from(productRates)
      .where(and(
        inArray(productRates.productId, products.map(p => p.id)),
        sql`${productRates.effectiveFrom} <= ${asOf}`,
        or(sql`${productRates.effectiveTo} IS NULL`, sql`${productRates.effectiveTo} >= ${asOf}`),
      ));

    // ── A price may name its destination, or name a prefix ─────────────────
    // product_rates carries BOTH columns and Rate Manager's form only fills `prefix` —
    // it has no destination picker. This step used to `.filter(r => r.destinationId !==
    // null)`, so every price an operator entered through the UI was dropped before the
    // matrix saw it, and the run reported "no approved destination has a price for any
    // product". Which was true of the rows that survived the filter, and said nothing
    // about the rows that did not.
    //
    // Resolving prefix → destination is what the catalogue is for, and the join is exact:
    // dial_prefix is unique within the commercial set the matrix was built from. A price
    // for "92" is a price for whatever destination owns 92.
    //
    // destination_id still wins where it is set. It is the stronger statement — it names
    // one catalogue row rather than a number that has to be looked up.
    const byDialPrefix = new Map(destinations.filter(d => d.dialPrefix).map(d => [String(d.dialPrefix), d.id]));
    const unmatchedPrefixes = new Set<string>();

    const rates: GeneratorRate[] = priced.flatMap(r => {
      let destinationId = r.destinationId;
      if (destinationId == null && r.prefix) {
        destinationId = byDialPrefix.get(String(r.prefix).trim()) ?? null;
        if (destinationId == null) { unmatchedPrefixes.add(String(r.prefix).trim()); return []; }
      }
      if (destinationId == null) return [];
      return [{ destinationId, productId: r.productId, rate: Number(r.rate) }];
    });

    const matrix = generateRateMatrix({ destinations, products, rates });

    // ── Nothing priced is not a failure ────────────────────────────────────
    // The generator reports two unrelated things through one `errors` array, and it is
    // right to: a duplicate prefix means one row would overwrite another, and an operator
    // uploading by hand from Rate Manager genuinely wants "no rows" to be an error there.
    //
    // This caller knows something Rate Manager does not — that an unpriced platform is the
    // EXPECTED state right now. Preflight already says so on the card, in these words:
    // "the rate upload step will report that it had nothing to send". It did not; it failed
    // the stage, and a run that is behaving exactly as designed came out red.
    //
    // The split is exact, and needs no matching on message text: a duplicate prefix
    // requires two rows to collide, so zero rows can only mean nothing is priced.
    if (!matrix.rows.length) {
      return {
        status: 'skipped',
        detail: [
          `Nothing to upload — no price is effective today for any of the ${destinations.length} destination(s) x ${products.length} product(s).`,
          `${priced.length} price(s) effective today, ${rates.length} matched to a destination.`,
          // A price that resolved to nothing is the difference between "no prices exist"
          // and "prices exist for destinations this customer is not sold", and the
          // operator's next action is completely different in each case.
          ...(unmatchedPrefixes.size
            ? [`${unmatchedPrefixes.size} price(s) name a prefix with no destination in this customer's set: ${Array.from(unmatchedPrefixes).slice(0, 6).join(', ')}`]
            : []),
          `${matrix.summary.rowsSkipped} cell(s) skipped.`,
          'Load prices in Rate Manager; the account is provisioned and will carry traffic unpriced until then.',
        ],
        metrics: {
          requested: 0, skipped: matrix.summary.rowsSkipped,
          products: products.length, destinations: destinations.length, iTariff,
        },
      };
    }

    if (!matrix.ok) {
      // Rows exist AND the matrix is malformed — a duplicate prefix, so one row would
      // overwrite another in the tariff. Reported, never uploaded: a tariff nobody can
      // reason about is worse than no tariff, and the errors name exactly which cells.
      return {
        status: 'failed',
        reasonCode: 'RATE_MATRIX_INVALID',
        error: matrix.errors.slice(0, 3).join(' · '),
        detail: [
          `${matrix.summary.rowsGenerated} row(s) generated, ${matrix.summary.rowsSkipped} skipped`,
          ...matrix.errors.slice(0, 5),
        ],
        metrics: {
          requested: matrix.summary.rowsGenerated,
          created: 0, verified: 0, failed: matrix.summary.rowsGenerated,
          products: products.length, destinations: destinations.length,
          failures: [{ cause: 'rate matrix invalid', count: matrix.errors.length }],
        },
      };
    }

    // First, middle and last — enough to catch a truncated or misaligned import without
    // spending a round trip per row.
    const rows = matrix.rows;
    const sample = [rows[0], rows[Math.floor(rows.length / 2)], rows[rows.length - 1]]
      .filter(Boolean)
      .map(r => ({ prefix: r.prefix, rate: r.rate }));

    const res = await sippy.uploadRatesWorkbook(
      ctx.sippy.username, ctx.sippy.password, ctx.sippy.portalUrl,
      iTariff,
      buildBulkRateXlsx(rows.map(r => ({ prefix: r.prefix, country: r.country, rate: r.rate }))),
      sample,
    );

    if (!res.success) {
      return {
        status: 'failed',
        reasonCode: 'RATE_UPLOAD_FAILED',
        error: res.message,
        detail: [
          `${rows.length} row(s) built from ${destinations.length} destination(s) x ${products.length} product(s)`,
          `Tariff ${iTariff} — ${res.message}`,
          'The account is provisioned; load the rates from Rate Manager and this is complete.',
        ],
        metrics: {
          requested: rows.length, created: 0, verified: 0, failed: rows.length,
          iTariff, products: products.length, destinations: destinations.length,
          failures: [{ cause: 'rate upload rejected by Sippy', count: 1 }],
        },
      };
    }

    return {
      status: 'success',
      result: { iTariff, rowsUploaded: rows.length, verified: res.verified, uploadStatus: res.uploadStatus },
      detail: [
        `${rows.length} rate(s) uploaded to tariff ${iTariff}`,
        // Stated because it is a decision the operator never made and should still see.
        // The workbook leaves Activation Date blank, which Sippy reads as immediate —
        // correct for onboarding, where the customer is being activated now. Scheduling a
        // future price belongs to Rate Manager, not to a provisioning run.
        'Effective immediately — no activation date set',
        `${matrix.byProduct.map(p => `${p.code} ${p.count}`).join(' · ')}`,
        res.message,
        ...(matrix.warnings.length ? [`Warnings: ${matrix.warnings.join(' · ')}`] : []),
      ],
      metrics: {
        requested: rows.length,
        created:   rows.length,
        // The sampled read-back, not the upload's own say-so. A workbook Sippy accepted
        // and did not import reports created without verified, and that gap is the signal.
        verified:  res.verified ? rows.length : 0,
        failed:    0,
        iTariff,
        products: products.length, destinations: destinations.length,
        byProduct: Object.fromEntries(matrix.byProduct.map(p => [p.code, p.count])),
        effectiveImmediately: true,
      },
    };
  },
};
