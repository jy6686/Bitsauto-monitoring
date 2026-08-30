#!/usr/bin/env node
/**
 * verify-catalogue.mjs — assert the commercial catalogue is actually usable.
 *
 *   DATABASE_URL='…' node scripts/verify-catalogue.mjs
 *   DATABASE_URL='…' node scripts/verify-catalogue.mjs --expect-sellable 1344
 *
 * Exits 0 when every check passes, 1 when any fails. Run it after every step, against
 * whichever database that step touched.
 *
 * This exists because "implemented" and "working" were being treated as the same claim. On
 * 2026-08-30 a build deployed cleanly, connected to its database, reported migrations ok, and
 * could not sell anything — the catalogue had been imported into a different database. Every
 * fact needed to see that was available; none of them were in one place.
 *
 * It talks to the database directly rather than through the API, so it works before the app is
 * running, needs no session, and cannot be fooled by a cached bundle.
 */
import { Pool } from 'pg';

const expectSellable = process.argv.includes('--expect-sellable')
  ? Number(process.argv[process.argv.indexOf('--expect-sellable') + 1]) : null;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Refusing to guess a database — that is how ten migrations went missing.');
  process.exit(2);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); return ok; };
const q = async (c, sql) => (await c.query(sql)).rows[0] ?? {};

const c = await pool.connect();
try {
  const who = await q(c, 'SELECT current_database() db, inet_server_addr()::text host');
  console.log(`\ndatabase   ${who.db} @ ${who.host ?? 'local socket'}\n`);

  const tables = await q(c, `SELECT count(*)::int n FROM information_schema.tables
     WHERE table_schema='public' AND table_name IN
       ('catalogue_versions','commercial_destinations','commercial_destination_prefixes',
        'catalogue_import_batches','commercial_destination_approvals')`);
  if (!check('migrations 500-503 applied', tables.n === 5, `${tables.n}/5 tables present`)) {
    report(); process.exit(1);   // nothing below can be asked if the tables are absent
  }

  // FROM matters: `SELECT count(*)` with no FROM counts the implicit single row and reports
  // 1 against an empty database. Caught by running this against a known-empty one, which is
  // the whole argument for verifying every step against a state you already know.
  const v = await q(c, `SELECT (SELECT count(*)::int FROM catalogue_versions) versions,
      (SELECT label FROM catalogue_versions WHERE status='active') active`);
  check('a catalogue is imported', v.versions > 0, `${v.versions} version(s)`);
  check('a version is active',     !!v.active,     v.active ?? 'none active');

  const d = await q(c, `SELECT
      (SELECT count(*)::int FROM commercial_destinations)                                AS dests,
      (SELECT count(*)::int FROM commercial_destination_prefixes)                        AS prefixes,
      (SELECT count(*)::int FROM commercial_destinations WHERE approval_status='approved') AS approved,
      (SELECT count(*)::int FROM v_catalogue_sellable)                                   AS sellable`);
  check('destinations imported', d.dests > 0,    `${d.dests}`);
  check('prefixes imported',     d.prefixes > 0, `${d.prefixes}`);
  check('destinations approved', d.approved > 0, `${d.approved} of ${d.dests}`);
  check('SELLABLE — pickers will have data', d.sellable > 0, `${d.sellable}`);
  if (expectSellable !== null)
    check(`sellable === ${expectSellable}`, d.sellable === expectSellable, `${d.sellable}`);

  // Integrity. The first two are schema-enforced and cannot fail — asserted anyway, because a
  // constraint that is never checked is indistinguishable from one that was quietly dropped.
  const i = await q(c, `SELECT
      (SELECT count(*)::int FROM (SELECT version_id, prefix FROM commercial_destination_prefixes
         GROUP BY 1,2 HAVING count(*)>1) x)                                              AS dup_prefix,
      (SELECT count(*)::int FROM (SELECT version_id, lower(name) FROM commercial_destinations
         GROUP BY 1,2 HAVING count(*)>1) y)                                              AS dup_name,
      (SELECT count(*)::int FROM commercial_destinations cd WHERE NOT EXISTS
         (SELECT 1 FROM commercial_destination_prefixes p WHERE p.destination_id=cd.id)) AS no_prefix`);
  check('no duplicate prefix in a version',   i.dup_prefix === 0, `${i.dup_prefix}`);
  check('no duplicate identity in a version', i.dup_name === 0,   `${i.dup_name}`);
  check('every destination has a prefix',     i.no_prefix === 0,  `${i.no_prefix} without`);

  const b = await q(c, `SELECT source_file, file_sha256, imported_at
     FROM catalogue_import_batches ORDER BY id DESC LIMIT 1`);
  check('import provenance recorded', !!b.file_sha256,
        b.file_sha256 ? `${b.source_file} sha256 ${b.file_sha256.slice(0,16)}…` : 'no batch');

  report();
  process.exit(results.every(r => r.ok) ? 0 : 1);
} finally { c.release(); await pool.end(); }

function report() {
  for (const r of results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name.padEnd(42)} ${r.detail ?? ''}`);
  const bad = results.filter(r => !r.ok);
  console.log(bad.length
    ? `\n✗ ${bad.length} check(s) failed — this database cannot serve commercial traffic.\n`
    : `\n✓ all ${results.length} checks passed.\n`);
}
