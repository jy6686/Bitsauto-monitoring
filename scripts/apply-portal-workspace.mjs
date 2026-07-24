#!/usr/bin/env node
/**
 * apply-portal-workspace.mjs — applies migrations/031_portal_workspace_model.sql.
 *
 * Runs the migration file verbatim against DATABASE_URL (override with
 * MIGRATE_DATABASE_URL for a different target, e.g. production). The migration is
 * fully idempotent and wrapped in BEGIN/COMMIT, so re-running is always safe and a
 * failure rolls back atomically.
 *
 * Usage (Replit shell):   node scripts/apply-portal-workspace.mjs
 * Usage (prod, careful):  MIGRATE_DATABASE_URL="$PROD_DATABASE_URL" node scripts/apply-portal-workspace.mjs
 *
 * Governance: schema+seed live in numbered migrations, never in app boot (see
 * docs/portal-framework/NAV-WORKSPACE-MODEL.md §4.7). This script is the manual
 * apply step; it prints read-back verification counts because no external change
 * is "done" until independently verified.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL (or MIGRATE_DATABASE_URL) first.");
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sql = readFileSync(join(root, "migrations/031_portal_workspace_model.sql"), "utf8");

const client = new pg.Client({ connectionString: url, ssl: url.includes("neon.tech") ? { rejectUnauthorized: false } : undefined });
await client.connect();
const host = new URL(url.replace(/^postgres(ql)?:/, "http:")).host;
console.log(`Applying 031_portal_workspace_model.sql to ${host} …`);

try {
  await client.query(sql);
  console.log("Migration applied (or already in place — idempotent).");

  // Read-back verification: counts must match the seed design.
  const checks = [
    ["navigation_domains", "SELECT COUNT(*)::int n FROM navigation_domains", 11],
    ["navigation_groups", "SELECT COUNT(*)::int n FROM navigation_groups", 38],
    ["modules with group_id", "SELECT COUNT(*)::int n FROM navigation_modules WHERE group_id IS NOT NULL", 149],
    ["noc domain assignments", "SELECT COUNT(*)::int n FROM portal_domain_assignments WHERE portal_slug='noc'", 4],
    ["portal_workspace rows", "SELECT COUNT(*)::int n FROM portal_workspace", 1],
  ];
  let ok = true;
  for (const [label, q, expectMin] of checks) {
    const { rows: [{ n }] } = await client.query(q);
    const pass = n >= expectMin;
    ok &&= pass;
    console.log(`  ${pass ? "✓" : "✗"} ${label}: ${n}${pass ? "" : ` (expected ≥ ${expectMin})`}`);
  }
  const { rows: dup } = await client.query(
    `SELECT m.route FROM portal_domain_assignments pda
     JOIN navigation_groups g ON g.domain_id = pda.domain_id
     JOIN navigation_modules m ON m.group_id = g.id
     WHERE pda.portal_slug='noc' GROUP BY m.route HAVING COUNT(*) > 1`);
  console.log(`  ${dup.length === 0 ? "✓" : "✗"} no duplicate routes in NOC scope (${dup.length} dups)`);
  ok &&= dup.length === 0;

  if (!ok) {
    console.error("VERIFICATION FAILED — do not proceed to boot-logic removal.");
    process.exit(1);
  }
  console.log("Verified. This environment is ready for the db.ts boot-seed removal.");
} finally {
  await client.end();
}
