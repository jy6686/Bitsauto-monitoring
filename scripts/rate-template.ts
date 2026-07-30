/**
 * rate-template.ts — download the default-rate sheet, price it, import it back.
 *
 *   npx tsx scripts/rate-template.ts download --out ./rates.csv
 *   npx tsx scripts/rate-template.ts import ./rates.csv --effective-from 2026-08-01
 *   npx tsx scripts/rate-template.ts import ./rates.csv --effective-from 2026-08-01 --apply
 *
 * IMPORT IS A DRY RUN UNLESS --apply IS PASSED. Same rule the provisioning engine follows:
 * an operator who omits the flag gets a report, not a repricing. This writes the numbers
 * every customer is billed on, so the destructive direction should require saying so.
 *
 * VERSIONING, NOT OVERWRITING. An import never edits an existing row. It inserts a new
 * generation starting on --effective-from and closes the open rows of affected products
 * the day before. What a customer was quoted last quarter stays answerable, and
 * resolveDefaultRates() picks the right generation for any date because it filters on the
 * same window.
 *
 * Parsing, validation and expansion live in rate-template.ts, which imports nothing from
 * the app and is covered by tests. This file is the database and filesystem around them.
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { db } from "../server/db";
import { productRegistry, productRates, rateCards, rateCardEntries } from "../shared/schema";
import { and, eq, isNull, lt, inArray, asc } from "drizzle-orm";
import {
  buildTemplateCsv, parseTemplateCsv, validateTemplate, expandTemplate, previousDay,
  type TemplateProduct,
} from "../server/services/rates/rate-template";
import { SELLABLE_PRODUCT_STATUSES } from "../server/services/rates/rate-upload.service";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

async function activeProducts(): Promise<TemplateProduct[]> {
  const rows = await db
    .select({ id: productRegistry.id, code: productRegistry.code, name: productRegistry.name })
    .from(productRegistry)
    // Not 'active' alone — the canonical four are seeded as 'commercial'. See
    // SELLABLE_PRODUCT_STATUSES.
    .where(inArray(productRegistry.status, [...SELLABLE_PRODUCT_STATUSES]))
    .orderBy(asc(productRegistry.sortOrder), asc(productRegistry.id));
  return rows;
}

/**
 * Destinations for a blank template.
 *
 * Prefers what product_rates already holds, so a re-download reflects the current sheet.
 * Falls back to the client rate card seeded by migration 041 — 32 owner-supplied
 * destinations — so the first download is a sheet to price rather than a header to fill
 * in by hand. Retyping 32 prefixes is where prefixes get transposed.
 */
async function seedDestinations(): Promise<Array<{ prefix: string; destination?: string | null }>> {
  const existing = await db
    .selectDistinct({ prefix: productRates.prefix })
    .from(productRates)
    .orderBy(asc(productRates.prefix));
  const fromRates = existing.map(r => r.prefix).filter((p): p is string => !!p);
  if (fromRates.length) return fromRates.map(prefix => ({ prefix }));

  const [card] = await db.select().from(rateCards).where(eq(rateCards.cardType, "client")).limit(1);
  if (!card) return [];
  const entries = await db
    .select({ prefix: rateCardEntries.prefix, breakout: rateCardEntries.breakout, country: rateCardEntries.country })
    .from(rateCardEntries)
    .where(eq(rateCardEntries.rateCardId, card.id))
    .orderBy(asc(rateCardEntries.prefix));
  return entries.map(e => ({ prefix: e.prefix, destination: e.breakout ?? e.country ?? null }));
}

async function doDownload() {
  const products = await activeProducts();
  if (!products.length) {
    console.error("No active products in product_registry — nothing to build columns from.");
    process.exit(1);
  }
  const dests = await seedDestinations();
  const out = resolve(arg("out") ?? "./rate-template.csv");
  writeFileSync(out, buildTemplateCsv(dests, products));

  console.log(`Wrote ${out}`);
  console.log(`  ${dests.length} destination(s) x ${products.length} product(s) — ${products.map(p => p.code).join(", ")}`);
  if (!dests.length) {
    console.log("  No destinations found in product_rates or any client rate card — the file is a header only.");
  }
  console.log("\nFill in the price columns, then:");
  console.log(`  npx tsx scripts/rate-template.ts import ${out} --effective-from YYYY-MM-DD`);
}

async function doImport(file: string) {
  const effectiveFrom = arg("effective-from");
  if (!effectiveFrom || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
    console.error("--effective-from YYYY-MM-DD is required. Rates are effective-dated; an import without a start date has no meaning.");
    process.exit(2);
  }
  const apply = has("apply");
  const products = await activeProducts();
  if (!products.length) { console.error("No active products."); process.exit(1); }

  const csv = readFileSync(resolve(file), "utf8");
  const { rows, issues: parseIssues } = parseTemplateCsv(csv, products);
  const issues = [...parseIssues, ...validateTemplate(rows, products)];
  const errors = issues.filter(i => i.severity === "error");
  const warnings = issues.filter(i => i.severity === "warning");

  for (const w of warnings) console.log(`  WARN  ${w.line ? `line ${w.line}: ` : ""}${w.message}`);
  for (const e of errors)   console.log(`  ERROR ${e.line ? `line ${e.line}: ` : ""}${e.message}`);

  if (errors.length) {
    // Nothing touches the database. A partially-valid sheet imported partially is a
    // price list nobody can reason about.
    console.error(`\n${errors.length} error(s) — nothing imported.`);
    process.exit(1);
  }

  const expanded = expandTemplate(rows, products);
  const closesOn = previousDay(effectiveFrom);
  const productIds = products.map(p => p.id);

  console.log(`\n${rows.length} destination(s) x ${products.length} product(s) = ${expanded.length} row(s)`);
  console.log(`  new generation effective ${effectiveFrom}`);
  console.log(`  open rows for these products will be closed ${closesOn}`);
  if (warnings.length) console.log(`  ${warnings.length} warning(s) above — review before applying`);

  if (!apply) {
    console.log("\nDRY RUN — nothing written. Re-run with --apply to import.");
    process.exit(0);
  }

  await db.transaction(async (tx) => {
    // Close the previous generation first. Only rows that are open AND start before the
    // new generation: re-running an import for the same date must not expire the rows it
    // just wrote, and a future-dated generation further out is not ours to touch.
    const closed = await tx
      .update(productRates)
      .set({ effectiveTo: closesOn })
      .where(and(
        inArray(productRates.productId, productIds),
        isNull(productRates.effectiveTo),
        lt(productRates.effectiveFrom, effectiveFrom),
      ))
      .returning({ id: productRates.id });

    await tx.insert(productRates).values(expanded.map(r => ({
      productId:     r.productId,
      destinationId: null,
      prefix:        r.prefix,
      rate:          String(r.rate),   // numeric column — a JS float would round
      currency:      "USD",
      effectiveFrom,
      effectiveTo:   null,
      notes:         `Imported from ${file}`,
      createdBy:     "rate-template import",
    })));

    console.log(`\nClosed ${closed.length} previous row(s); inserted ${expanded.length}.`);
  });

  console.log("Done. Verify with: npx tsx scripts/generate-default-rates.ts");
  process.exit(0);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set — run this from the app environment.");
    process.exit(2);
  }
  const mode = process.argv[2];
  if (mode === "download") return doDownload();
  if (mode === "import") {
    const file = process.argv[3];
    if (!file || file.startsWith("--")) {
      console.error("Usage: rate-template.ts import <file.csv> --effective-from YYYY-MM-DD [--apply]");
      process.exit(2);
    }
    return doImport(file);
  }
  console.error("Usage:\n  rate-template.ts download [--out FILE]\n  rate-template.ts import <FILE> --effective-from YYYY-MM-DD [--apply]");
  process.exit(2);
}

main().catch(e => { console.error(e); process.exit(2); });
