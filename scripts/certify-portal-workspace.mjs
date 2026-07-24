#!/usr/bin/env node
/**
 * certify-portal-workspace.mjs — API Certification gate for the Portal Workspace.
 *
 * Runs BEFORE any frontend consumes the workspace (NAV-WORKSPACE-MODEL §6).
 * A 200 response is not certification; this script independently verifies the
 * contract and the data tree for every portal that has domain assignments.
 *
 * Two modes:
 *   DB mode (default)  — reconstructs the workspace tree with the same query logic
 *                        as getPortalWorkspace and validates it. No server needed.
 *                        node scripts/certify-portal-workspace.mjs
 *   HTTP mode          — additionally fetches the live endpoint and checks the frozen
 *                        JSON shape (§7). Needs a running server + session cookie.
 *                        WORKSPACE_BASE_URL=http://localhost:5000 WORKSPACE_COOKIE="connect.sid=…" \
 *                          node scripts/certify-portal-workspace.mjs
 *
 * Exit 0 = certified. Exit 1 = NOT certified — do not start NAV-C.
 */
import pg from "pg";

const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
if (!url) { console.error("Set DATABASE_URL (or MIGRATE_DATABASE_URL)."); process.exit(1); }

const FROZEN_TOP_LEVEL_KEYS = ["workspaceVersion", "navigationChecksum", "portal", "workspace", "navigation", "search", "quickActions", "favorites", "dashboard"];
const ITEM_KEYS = ["moduleKey", "title", "iconKey", "route", "portalRoute"];

let failures = 0;
const fail = (msg) => { failures++; console.log(`  ✗ ${msg}`); };
const pass = (msg) => console.log(`  ✓ ${msg}`);

const client = new pg.Client({ connectionString: url, ssl: url.includes("neon.tech") ? { rejectUnauthorized: false } : undefined });
await client.connect();

try {
  const { rows: portals } = await client.query(
    `SELECT DISTINCT portal_slug FROM portal_domain_assignments ORDER BY 1`);
  if (portals.length === 0) fail("no portal has domain assignments — nothing to certify");

  for (const { portal_slug: slug } of portals) {
    console.log(`\nPortal: ${slug}`);

    // Portal + workspace rows exist
    const { rows: [pdef] } = await client.query(`SELECT slug FROM portal_definitions WHERE slug=$1`, [slug]);
    pdef ? pass("portal_definitions row exists") : fail("missing portal_definitions row");
    const { rows: [wrow] } = await client.query(`SELECT home_module FROM portal_workspace WHERE portal_slug=$1`, [slug]);
    wrow ? pass("portal_workspace row exists") : fail("missing portal_workspace row");

    // The full tree, exactly the scope the endpoint serves
    const { rows: tree } = await client.query(`
      SELECT d.id AS domain_id, g.id AS group_id, g.label AS group_label,
             m.id AS module_id, m.module_key, m.route
      FROM portal_domain_assignments pda
      JOIN navigation_domains d ON d.id = pda.domain_id
      LEFT JOIN navigation_groups g ON g.domain_id = d.id
      LEFT JOIN navigation_modules m ON m.group_id = g.id
      WHERE pda.portal_slug = $1`, [slug]);

    const domains = new Set(tree.map(r => r.domain_id));
    const modules = tree.filter(r => r.module_id != null);
    pass(`counts: ${domains.size} domains, ${new Set(tree.filter(r=>r.group_id!=null).map(r=>r.group_id)).size} groups, ${modules.length} modules`);

    // duplicate routes within the portal scope
    const routeCount = {};
    for (const m of modules) routeCount[m.route] = (routeCount[m.route] ?? 0) + 1;
    const dupRoutes = Object.entries(routeCount).filter(([, n]) => n > 1);
    dupRoutes.length === 0 ? pass("no duplicate routes")
      : fail(`duplicate routes: ${dupRoutes.map(([r]) => r).join(", ")}`);

    // duplicate module keys within the portal scope
    const keyCount = {};
    for (const m of modules) keyCount[m.module_key] = (keyCount[m.module_key] ?? 0) + 1;
    const dupKeys = Object.entries(keyCount).filter(([, n]) => n > 1);
    dupKeys.length === 0 ? pass("no duplicate module keys")
      : fail(`duplicate module keys: ${dupKeys.map(([k]) => k).join(", ")}`);

    // empty groups are allowed but reported; domains with NO groups are a config error
    const domainsWithGroups = new Set(tree.filter(r => r.group_id != null).map(r => r.domain_id));
    const emptyDomains = [...domains].filter(d => !domainsWithGroups.has(d));
    emptyDomains.length === 0 ? pass("every assigned domain has ≥1 group")
      : fail(`assigned domains with no groups: ${emptyDomains.join(", ")}`);

    // home module must be reachable through the portal's own navigation
    if (wrow?.home_module) {
      const reachable = modules.some(m => m.module_key === wrow.home_module);
      reachable ? pass(`home module '${wrow.home_module}' reachable in portal nav`)
        : fail(`home module '${wrow.home_module}' NOT in portal navigation scope`);
    }
  }

  // Global integrity (portal-independent)
  console.log(`\nGlobal:`);
  const { rows: [{ n: orphanG }] } = await client.query(
    `SELECT COUNT(*)::int n FROM navigation_groups g LEFT JOIN navigation_domains d ON d.id=g.domain_id WHERE d.id IS NULL`);
  orphanG === 0 ? pass("no orphan groups") : fail(`${orphanG} orphan groups`);
  const { rows: [{ n: badFk }] } = await client.query(
    `SELECT COUNT(*)::int n FROM navigation_modules m WHERE m.group_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM navigation_groups g WHERE g.id=m.group_id)`);
  badFk === 0 ? pass("no orphan modules (dangling group_id)") : fail(`${badFk} orphan modules`);
  const { rows: [{ n: dupMk }] } = await client.query(
    `SELECT COUNT(*)::int n FROM (SELECT module_key FROM navigation_modules GROUP BY module_key HAVING COUNT(*)>1) x`);
  dupMk === 0 ? pass("module_key globally unique") : fail(`${dupMk} duplicated module_key values`);
  // Split identity namespace: underscore and kebab variants of the same module must
  // never coexist (kebab is the frozen permanent identity; 029/031 merge enforces it).
  const { rows: idPairs } = await client.query(
    `SELECT u.module_key FROM navigation_modules u JOIN navigation_modules k
       ON k.module_key = replace(u.module_key,'_','-') AND k.module_key <> u.module_key`);
  idPairs.length === 0 ? pass("no underscore/kebab split identities")
    : fail(`split identities (underscore+kebab both exist): ${idPairs.map(r => r.module_key).join(", ")}`);
  // Post-032 invariant: no underscore module_keys remain anywhere.
  // module_key is the single canonical identity across DB, workspace API, registry,
  // router, audit, permissions, favorites, quick-actions, and portal_module_overrides.
  // If this fails, run migration 032_kebab_module_keys.sql before proceeding.
  const { rows: [{ n: underscoreNm }] } = await client.query(
    `SELECT COUNT(*)::int n FROM navigation_modules WHERE strpos(module_key,'_') > 0`);
  const { rows: [{ n: underscorePw }] } = await client.query(
    `SELECT COUNT(*)::int n FROM portal_workspace WHERE home_module IS NOT NULL AND strpos(home_module,'_') > 0`);
  const { rows: [{ n: underscoreUf }] } = await client.query(
    `SELECT COUNT(*)::int n FROM user_favorites WHERE strpos(module_key,'_') > 0`);
  underscoreNm === 0 && underscorePw === 0 && underscoreUf === 0
    ? pass("all module_key values are kebab (032 applied)")
    : fail(`underscore module_keys remain — run migration 032 first (nm=${underscoreNm} pw=${underscorePw} uf=${underscoreUf})`);

  // HTTP mode: frozen JSON shape against the live endpoint
  const base = process.env.WORKSPACE_BASE_URL;
  if (base) {
    console.log(`\nHTTP contract (${base}):`);
    for (const { portal_slug: slug } of portals) {
      const res = await fetch(`${base}/api/portals/${slug}/workspace`, {
        headers: process.env.WORKSPACE_COOKIE ? { cookie: process.env.WORKSPACE_COOKIE } : {},
      });
      if (!res.ok) { fail(`${slug}: HTTP ${res.status}`); continue; }
      const body = await res.json();
      const missing = FROZEN_TOP_LEVEL_KEYS.filter(k => !(k in body));
      missing.length === 0 ? pass(`${slug}: all frozen top-level keys present`)
        : fail(`${slug}: missing frozen keys: ${missing.join(", ")}`);
      const item = body.search?.index?.[0];
      if (item) {
        const miss = ITEM_KEYS.filter(k => !(k in item));
        miss.length === 0 ? pass(`${slug}: nav item shape correct`)
          : fail(`${slug}: nav item missing: ${miss.join(", ")}`);
        item.portalRoute === `/${slug}/${item.moduleKey}`
          ? pass(`${slug}: portalRoute server-computed correctly`)
          : fail(`${slug}: portalRoute malformed: ${item.portalRoute}`);
      }
      // search index must equal the navigation scope — no wider, no narrower
      const navKeys = new Set((body.navigation?.domains ?? []).flatMap(d => d.groups.flatMap(g => g.items.map(i => i.moduleKey))));
      const searchKeys = new Set((body.search?.index ?? []).map(i => i.moduleKey));
      const extra = [...searchKeys].filter(k => !navKeys.has(k));
      const absent = [...navKeys].filter(k => !searchKeys.has(k));
      extra.length === 0 && absent.length === 0
        ? pass(`${slug}: search.index === navigation scope (${searchKeys.size} modules)`)
        : fail(`${slug}: search/navigation mismatch (extra: ${extra.length}, missing: ${absent.length})`);
    }
  } else {
    console.log(`\n(HTTP contract checks skipped — set WORKSPACE_BASE_URL to include them)`);
  }
} finally {
  await client.end();
}

console.log(failures === 0
  ? "\nCERTIFIED — the Workspace API may be consumed by NAV-C."
  : `\nNOT CERTIFIED — ${failures} failure(s). Do not start NAV-C.`);
process.exit(failures === 0 ? 0 : 1);
