#!/usr/bin/env node
/**
 * apply-migration.mjs — applies a single numbered migration file.
 *
 * Usage (Replit dev):    node scripts/apply-migration.mjs migrations/033_cleanup_boot_seed_underscore_rows.sql
 * Usage (Neon prod):     MIGRATE_DATABASE_URL="$PROD_URL" node scripts/apply-migration.mjs migrations/033_cleanup_boot_seed_underscore_rows.sql
 *
 * Reports underscore module_key count after applying so the boot-seed cleanup
 * result is visible immediately. Full verification remains
 * certify-portal-workspace.mjs.
 */
import { readFileSync } from "node:fs";
import pg from "pg";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/apply-migration.mjs <migrations/NNN_name.sql>");
  process.exit(1);
}

const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL (or MIGRATE_DATABASE_URL) first.");
  process.exit(1);
}

const client = new pg.Client({
  connectionString: url,
  ssl: url.includes("neon.tech") ? { rejectUnauthorized: false } : undefined,
});
await client.connect();
const host = new URL(url.replace(/^postgres(ql)?:/, "http:")).host;

try {
  console.log(`\nApplying ${file} to ${host} …`);
  await client.query(readFileSync(file, "utf8"));
  console.log(`✓ ${file} applied.`);

  const { rows } = await client.query(
    `SELECT
       (SELECT COUNT(*)::int FROM navigation_modules WHERE module_key LIKE '%\\_%' ESCAPE '\\') AS nm,
       (SELECT COUNT(*)::int FROM navigation_modules) AS total`
  );
  console.log(`navigation_modules: ${rows[0].total} total, ${rows[0].nm} underscore keys remaining`);
  process.exit(rows[0].nm === 0 ? 0 : 1);
} catch (err) {
  console.error(`✗ FAILED: ${err.message}`);
  process.exit(1);
} finally {
  await client.end();
}
