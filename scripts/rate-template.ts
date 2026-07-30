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
import { productRegistry, productRates, globalDestinations } from "../shared/schema";
import { and, eq, isNull, isNotNull, lt, inArray, asc } from "drizzle-orm";
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
 * Destinations for a blank template — FROM THE CATALOGUE, approved only.
 *
 * Previously this seeded from whatever was already in product_rates, falling back to a
 * client rate card. Both let an operator price a destination the catalogue has never
 * approved, and neither produced a destination_id — so every imported row was a free-text
 * prefix with nothing tying it to a catalogue entry, and the generator's approval rule had
 * nothing to check against.
 *
 * The template now offers exactly the destinations that may legitimately be sold. You
 * cannot price what is not approved, because it is not on the sheet.
 */
async function seedDestinations(): Promise<Array<{ id: number; prefix: string; destination: string }>> {
  const rows = await db
    .select({
      id: globalDestinations.id,
      dialPrefix: globalDestinations.dialPrefix,
      name: globalDestinations.name,
      operatorName: globalDestinations.operatorName,
    })
    .from(globalDestinations)
    .where(and(
      eq(globalDestinations.commercialStatus, "approved"),
      isNotNull(globalDestinations.dialPrefix),
    ))
    .orderBy(asc(globalDestinations.dialPrefix));
  return rows
    .filter(r => (r.dialPrefix ?? "").trim())
    .map(r => ({
      id: r.id,
      prefix: (r.dialPrefix ?? "").trim(),
      destination: r.operatorName ? `${r.name} ${r.operatorName}` : r.name,
    }));
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
    console.log("  No APPROVED destinations with a dial prefix in the catalogue — the file is a header only.");
    console.log("  Approve destinations in the Destination Catalogue before pricing them.");
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

  // ── Resolve every row to an APPROVED catalogue entry ────────────────────────
  // The owner's rule is that Sippy never receives an arbitrary prefix. Enforced here,
  // at the only point free text enters the system: a CSV row whose prefix matches no
  // approved destination is refused, not imported and dealt with later. Without this the
  // generator's approval check has nothing to check — destination_id was written NULL.
  const catalogue = await seedDestinations();
  const byPrefix = new Map(catalogue.map(d => [d.prefix, d]));
  const unmatched = rows.filter(r => !byPrefix.has(r.prefix));
  if (unmatched.length) {
    for (const r of unmatched) {
      console.log(`  ERROR line ${r.line}: prefix ${r.prefix} matches no APPROVED destination in the catalogue.`);
    }
    console.error(`\n${unmatched.length} row(s) reference destinations that are not approved — nothing imported.`);
    console.error('Approve them in the Destination Catalogue, or re-download the template: it only lists what may be sold.');
    process.exit(1);
  }
  const destIdOf = new Map(rows.map(r => [r.prefix, byPrefix.get(r.prefix)!.id]));

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
      // The link the generator joins on. Populated from the catalogue rather than left
      // NULL, so a rate can always name the approved destination it prices.
      destinationId: destIdOf.get(r.prefix) ?? null,
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
  if (mode === "download") {
    await doDownload();
    // Explicit: the pg pool keeps the event loop alive, so without this the script
    // prints its result and then appears to hang. doImport already exits on every path;
    // download did not, and the missing prompt read as a stuck process.
    process.exit(0);
  }
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
