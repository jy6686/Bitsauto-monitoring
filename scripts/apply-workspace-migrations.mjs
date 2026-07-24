#!/usr/bin/env node
/**
 * apply-workspace-migrations.mjs — applies 031 + 032 as a single unit.
 *
 * 031 and 032 are a certification unit: 031 establishes the workspace model; 032
 * standardises all module_key values to kebab-case. Certifying after 031 alone would
 * validate an intermediate state that never runs in production. This script applies
 * both migrations in sequence, then runs the same embedded verification that
 * `certify-portal-workspace.mjs` uses for its DB-mode checks.
 *
 * Usage (Replit dev):    node scripts/apply-workspace-migrations.mjs
 * Usage (Neon prod):     MIGRATE_DATABASE_URL="$PROD_URL" node scripts/apply-workspace-migrations.mjs
 *
 * IMPORTANT: always run `git pull` before applying. The Replit clone may trail origin
 * by commits that include bug-fixes inside these migrations (e.g. the kebab identity
 * merge introduced in a5516255). Applying a stale copy produces a stale DB.
 *
 * Sequencing:
 *   apply-workspace-migrations.mjs  (this script — dev)
 *   apply-workspace-migrations.mjs  (prod)
 *   certify-portal-workspace.mjs    (explicit certification pass — record navigationChecksum)
 *   → Phase 2A
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

const root   = join(dirname(fileURLToPath(import.meta.url)), "..");
const sql031 = readFileSync(join(root, "migrations/031_portal_workspace_model.sql"), "utf8");
const sql032 = readFileSync(join(root, "migrations/032_kebab_module_keys.sql"),      "utf8");

const client = new pg.Client({
  connectionString: url,
  ssl: url.includes("neon.tech") ? { rejectUnauthorized: false } : undefined,
});
await client.connect();
const host = new URL(url.replace(/^postgres(ql)?:/, "http:")).host;

let ok = true;
const pass = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg) => { ok = false; console.log(`  ✗ ${msg}`); };

try {
  // ── 1. Apply 031 ─────────────────────────────────────────────────────────────
  console.log(`\n[031] Applying portal workspace model to ${host} …`);
  await client.query(sql031);
  console.log("[031] Applied (idempotent — re-run is safe).");

  // ── 2. Apply 032 ─────────────────────────────────────────────────────────────
  console.log(`\n[032] Applying kebab module-key standardisation …`);
  await client.query(sql032);
  console.log("[032] Applied (idempotent — re-run is safe).");

  // ── 3. Structural verification ───────────────────────────────────────────────
  console.log(`\nVerification:`);

  const checks = [
    ["navigation_domains",      "SELECT COUNT(*)::int n FROM navigation_domains",                                   11],
    ["navigation_groups",       "SELECT COUNT(*)::int n FROM navigation_groups",                                    38],
    ["modules with group_id",   "SELECT COUNT(*)::int n FROM navigation_modules WHERE group_id IS NOT NULL",       149],
    ["noc domain assignments",  "SELECT COUNT(*)::int n FROM portal_domain_assignments WHERE portal_slug='noc'",    4],
    ["portal_workspace rows",   "SELECT COUNT(*)::int n FROM portal_workspace",                                     1],
  ];
  for (const [label, q, expectMin] of checks) {
    const { rows: [{ n }] } = await client.query(q);
    n >= expectMin ? pass(`${label}: ${n}`) : fail(`${label}: ${n} (expected ≥ ${expectMin})`);
  }

  // ── 4. Kebab-key invariant ───────────────────────────────────────────────────
  const { rows: [{ n: nmUnder }] } = await client.query(
    `SELECT COUNT(*)::int n FROM navigation_modules WHERE strpos(module_key,'_') > 0`);
  const { rows: [{ n: pwUnder }] } = await client.query(
    `SELECT COUNT(*)::int n FROM portal_workspace WHERE home_module IS NOT NULL AND strpos(home_module,'_') > 0`);
  const { rows: [{ n: ufUnder }] } = await client.query(
    `SELECT COUNT(*)::int n FROM user_favorites WHERE strpos(module_key,'_') > 0`);
  nmUnder === 0 && pwUnder === 0 && ufUnder === 0
    ? pass(`all module_key values are kebab (nm=${nmUnder} pw=${pwUnder} uf=${ufUnder})`)
    : fail(`underscore module_keys remain (nm=${nmUnder} pw=${pwUnder} uf=${ufUnder})`);

  // ── 5. Duplicate-route check (NOC scope) ────────────────────────────────────
  const { rows: dup } = await client.query(
    `SELECT m.route FROM portal_domain_assignments pda
     JOIN navigation_groups g ON g.domain_id = pda.domain_id
     JOIN navigation_modules m ON m.group_id = g.id
     WHERE pda.portal_slug='noc' GROUP BY m.route HAVING COUNT(*) > 1`);
  dup.length === 0 ? pass("no duplicate routes in NOC scope")
    : fail(`duplicate routes in NOC scope: ${dup.map(r => r.route).join(", ")}`);

  // ── 6. Referential integrity ─────────────────────────────────────────────────
  const { rows: badHm } = await client.query(
    `SELECT portal_slug, home_module FROM portal_workspace
     WHERE home_module IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM navigation_modules m WHERE m.module_key = portal_workspace.home_module)`);
  badHm.length === 0
    ? pass(`portal_workspace.home_module → valid in all rows`)
    : fail(`dangling home_module: ${badHm.map(r => `${r.portal_slug}→'${r.home_module}'`).join(", ")}`);

  const { rows: [{ n: badFavs }] } = await client.query(
    `SELECT COUNT(*)::int n FROM user_favorites uf
     WHERE NOT EXISTS (SELECT 1 FROM navigation_modules m WHERE m.module_key = uf.module_key)`);
  badFavs === 0
    ? pass("user_favorites.module_key → valid in all rows")
    : fail(`${badFavs} user_favorites row(s) reference unknown module_key`);

  // ── 7. Home module reachable ─────────────────────────────────────────────────
  const { rows: [{ hm }] } = await client.query(
    `SELECT home_module AS hm FROM portal_workspace WHERE portal_slug='noc'`);
  const { rows: [{ reachable }] } = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM portal_domain_assignments pda
       JOIN navigation_groups g ON g.domain_id = pda.domain_id
       JOIN navigation_modules m ON m.group_id = g.id
       WHERE pda.portal_slug='noc' AND m.module_key = $1
     ) AS reachable`, [hm]);
  reachable ? pass(`home module '${hm}' reachable in NOC navigation`)
    : fail(`home module '${hm}' NOT reachable in NOC navigation`);

  // ── Result ───────────────────────────────────────────────────────────────────
  if (!ok) {
    console.error("\nVERIFICATION FAILED — do not proceed to certification or Phase 2A.");
    process.exit(1);
  }
  console.log("\n✓ Both migrations applied and verified.");
  console.log("  Next: run `node scripts/certify-portal-workspace.mjs` to record navigationChecksum.");

} finally {
  await client.end();
}
