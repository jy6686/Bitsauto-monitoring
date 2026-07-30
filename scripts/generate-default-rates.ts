/**
 * generate-default-rates.ts — write the default rate matrix to a workbook on disk.
 *
 *   npx tsx scripts/generate-default-rates.ts
 *   npx tsx scripts/generate-default-rates.ts --products FC,BC --out ./premium.xlsx
 *   npx tsx scripts/generate-default-rates.ts --policy "Premium Default" --as-of 2026-09-01
 *
 * WHY THIS EXISTS
 * Certifying the rate path means answering two questions, and answering them together is
 * how the tariff-33 defect stayed unexplained for two weeks:
 *
 *   1. Is our workbook correct?        → import this file through the Sippy UI by hand.
 *   2. Does the API upload work?       → scripts/sippy-admin-probe.ts (getUploadToken).
 *
 * This script answers only the first, and it touches Sippy not at all. If Sippy's own
 * importer accepts the file, the workbook builder, the prefix composition and the column
 * layout are all certified, and any later failure is in the transport. If it rejects the
 * file, the error comes from Sippy's importer directly rather than through three layers
 * of fallback.
 *
 * It also produces the known-good multi-row file the rate-push defect has been missing —
 * every previous attempt uploaded a single row.
 *
 * Writes a .json manifest beside the .xlsx so the import can be checked against expected
 * counts without opening Excel. The manifest reports what resolveDefaultRates actually
 * knows: product_rates carries no country column, so there is no country breakdown here
 * rather than an invented one.
 */
import { writeFileSync } from "fs";
import { resolve } from "path";
import { resolveDefaultRates } from "../server/services/rates/rate-upload.service";
import { buildBulkRateXlsx, validateDefaults } from "../server/services/rates/rate-matrix";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set — run this from the app environment.");
    process.exit(2);
  }

  const products = arg("products")?.split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
  const policy   = arg("policy") ?? null;
  const asOfRaw  = arg("as-of");
  const asOf     = asOfRaw ? new Date(asOfRaw) : new Date();
  const outPath  = resolve(arg("out") ?? "./default-rates.xlsx");
  const manifestPath = outPath.replace(/\.xlsx$/i, "") + ".json";

  if (asOfRaw && Number.isNaN(asOf.getTime())) {
    console.error(`--as-of "${asOfRaw}" is not a date.`);
    process.exit(2);
  }

  const resolved = await resolveDefaultRates({ ratePolicy: policy, productCodes: products, asOf });

  console.log(`Resolved as of ${asOf.toISOString().slice(0, 10)}${policy ? ` · policy "${policy}"` : ""}`);
  for (const p of resolved.byProduct) {
    console.log(`  ${p.code.padEnd(3)} ${p.name.padEnd(18)} trunk "${p.trunkPrefix}"  ${p.count} rate(s)`);
  }
  console.log(`  ${resolved.rows.length} row(s) total\n`);

  // Reported, not enforced: a partial matrix is exactly what you might want to import
  // deliberately while only one product has been priced. The manifest records it either
  // way, so a later "why is Charlie unpriced" has an answer.
  const check = validateDefaults(resolved);
  if (!check.ok) {
    console.log("WARNINGS:");
    for (const r of check.reasons) console.log(`  - ${r}`);
    console.log("");
  }

  if (!resolved.rows.length) {
    console.error("Nothing to write — product_rates has no entries effective on this date for the selected products.");
    console.error("Load the price lists in Rate Manager first; the workbook cannot be certified against an empty matrix.");
    process.exit(1);
  }

  writeFileSync(outPath, buildBulkRateXlsx(resolved.rows));
  writeFileSync(manifestPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    asOf:        asOf.toISOString().slice(0, 10),
    ratePolicy:  policy,
    // Recorded because the policy argument is accepted but not yet applied — a manifest
    // naming a policy that had no effect would be misleading a month from now.
    ratePolicyApplied: false,
    productFilter: products ?? null,
    totalRows:   resolved.rows.length,
    products:    resolved.byProduct,
    productsWithoutRates: resolved.productsWithoutRates,
    warnings:    check.reasons,
    // Enough to spot a composition error by eye without opening the workbook.
    samplePrefixes: resolved.rows.slice(0, 10).map(r => r.prefix),
  }, null, 2));

  console.log(`Wrote ${outPath}`);
  console.log(`Wrote ${manifestPath}`);
  console.log("\nNext: import the .xlsx through the Sippy UI against a disposable tariff.");
  console.log("If it imports, the workbook is certified and only the API transport remains untested.");
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(2); });
