/**
 * Migrations 514-518, applied TOGETHER and IN ORDER against one database.
 *
 * Every other test in this feature builds the schema its own module needs and applies one
 * migration to it. That proves each file works; it does not prove the SET works. Ordering
 * dependencies, a missing prerequisite, an object one file expects another to have created -
 * none of those show up until they run in sequence on one database, which is exactly what the
 * deployment gate will do.
 *
 * It also asserts the two properties the deployment procedure depends on:
 *   - every file is IDEMPOTENT, so a re-run cannot damage an applied environment
 *   - no file is DESTRUCTIVE, so applying the set cannot lose data
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = [
  '514_product_destination_eligibility.sql',
  '515_product_rate_catalogue_identity.sql',
  '516_billing_increment_changes.sql',
  '517_billing_increment_notifications.sql',
  '518_rate_push_notifications.sql',
] as const;

const sqlFor = (f: string) =>
  readFileSync(join(__dirname, '..', '..', '..', 'migrations', f), 'utf8');

/**
 * What the platform already has when 514 runs. Everything 514-518 depends on and does not create
 * itself — if this list is wrong, the migrations will say so by failing.
 */
const PRE_EXISTING = `
  CREATE TABLE catalogue_versions (
    id SERIAL PRIMARY KEY, label TEXT NOT NULL UNIQUE, status TEXT NOT NULL);
  CREATE TABLE commercial_destinations (
    id SERIAL PRIMARY KEY,
    version_id INTEGER NOT NULL REFERENCES catalogue_versions(id) ON DELETE CASCADE,
    name TEXT NOT NULL, approval_status TEXT NOT NULL DEFAULT 'approved');
  CREATE TABLE commercial_destination_prefixes (
    id SERIAL PRIMARY KEY,
    version_id INTEGER NOT NULL REFERENCES catalogue_versions(id) ON DELETE CASCADE,
    destination_id INTEGER NOT NULL REFERENCES commercial_destinations(id) ON DELETE CASCADE,
    prefix TEXT NOT NULL, billing_increment TEXT);
  CREATE TABLE product_registry (
    id SERIAL PRIMARY KEY, code VARCHAR(16) UNIQUE NOT NULL, name VARCHAR(64) NOT NULL,
    trunk_prefix VARCHAR(8), segment VARCHAR(32), status VARCHAR(16) NOT NULL DEFAULT 'draft');
  CREATE TABLE product_destination_assignments (
    id SERIAL PRIMARY KEY, product_id INTEGER NOT NULL, destination_id INTEGER NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'active');
  CREATE TABLE product_rates (
    id SERIAL PRIMARY KEY, product_id INTEGER NOT NULL, destination_id INTEGER,
    prefix VARCHAR(32), rate NUMERIC(12,6) NOT NULL DEFAULT 0,
    effective_from DATE NOT NULL DEFAULT CURRENT_DATE, effective_to DATE);
  CREATE TABLE rate_push_jobs (job_id VARCHAR(64) PRIMARY KEY);
`;

let db: PGlite;

const applyAll = async () => { for (const f of MIGRATIONS) await db.exec(sqlFor(f)); };
const one = async (q: string) => ((await db.query(q)) as any).rows[0];

beforeEach(async () => {
  db = await PGlite.create();
  await db.exec(PRE_EXISTING);
});
afterEach(async () => { await db?.close(); });

describe("the set applies cleanly, in order, on one database", () => {
  it("514 through 518 apply in sequence without error", async () => {
    // The thing no isolated test can establish: that they compose.
    await expect(applyAll()).resolves.not.toThrow();
  });

  it("every table the set promises exists afterwards", async () => {
    await applyAll();
    for (const t of [
      'product_destination_eligibility',
      'billing_increment_changes',
      'billing_increment_notifications',
      'rate_push_notifications',
    ]) {
      const r = await one(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = '${t}'`);
      expect(r.n, `${t} must exist`).toBe(1);
    }
  });

  it("515's column lands on the pre-existing product_rates", async () => {
    await applyAll();
    const r = await one(`SELECT count(*)::int AS n FROM information_schema.columns
                          WHERE table_name = 'product_rates' AND column_name = 'catalogue_version_id'`);
    expect(r.n).toBe(1);
  });

  it("517 depends on 516 and would fail if the order were reversed", async () => {
    // Proves the ordering is real rather than incidental: the notification outbox references the
    // change table by foreign key.
    await expect(db.exec(sqlFor('517_billing_increment_notifications.sql')))
      .rejects.toThrow(/billing_increment_changes/i);
  });

  it("every table is created EMPTY — no migration manufactures a commitment", async () => {
    await applyAll();
    for (const t of [
      'product_destination_eligibility', 'billing_increment_changes',
      'billing_increment_notifications', 'rate_push_notifications',
    ]) {
      const r = await one(`SELECT count(*)::int AS n FROM ${t}`);
      expect(r.n, `${t} must be empty`).toBe(0);
    }
  });
});

describe("IDEMPOTENT — a re-run cannot damage an applied environment", () => {
  it("applying the whole set twice succeeds and changes nothing", async () => {
    await applyAll();
    // The runner records checksums and does not re-run, but a re-run must still be harmless:
    // that is what makes recovering from a partial apply safe rather than frightening.
    await expect(applyAll()).resolves.not.toThrow();
    for (const t of ['product_destination_eligibility', 'rate_push_notifications']) {
      expect((await one(`SELECT count(*)::int AS n FROM ${t}`)).n).toBe(0);
    }
  });

  it("re-running does not duplicate indexes or triggers", async () => {
    await applyAll();
    const before = await one(`SELECT count(*)::int AS n FROM pg_indexes WHERE schemaname = 'public'`);
    await applyAll();
    const after = await one(`SELECT count(*)::int AS n FROM pg_indexes WHERE schemaname = 'public'`);
    expect(after.n).toBe(before.n);
  });
});

describe("NON-DESTRUCTIVE — applying the set cannot lose data", () => {
  it("no file contains a destructive statement", async () => {
    for (const f of MIGRATIONS) {
      const code = sqlFor(f)
        .split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
      // DROP TRIGGER IF EXISTS on a table the same file creates is an idempotency guard, not a
      // data operation, and is the only DROP permitted here.
      const destructive = code.match(/\b(DROP\s+(TABLE|COLUMN|DATABASE|SCHEMA)|TRUNCATE|DELETE\s+FROM)\b/gi);
      expect(destructive, `${f} must not be destructive`).toBeNull();
    }
  });

  it("pre-existing data survives the whole set", async () => {
    await db.exec(`
      INSERT INTO catalogue_versions (id, label, status) VALUES (1, 'V1', 'active');
      INSERT INTO commercial_destinations (id, version_id, name) VALUES (10, 1, 'PAKISTAN - MOBILE JAZZ');
      INSERT INTO product_registry (id, code, name) VALUES (1, 'FC', 'First Class');
      INSERT INTO product_rates (product_id, destination_id, prefix, rate, effective_from)
        VALUES (1, 10, '9230', 0.045, '2020-01-01');`);

    await applyAll();

    expect((await one(`SELECT count(*)::int AS n FROM product_rates`)).n).toBe(1);
    expect((await one(`SELECT count(*)::int AS n FROM commercial_destinations`)).n).toBe(1);
    // And the new column is NULL on the pre-existing row: nothing was backfilled, because there
    // is no mapping from a legacy destination_id to a catalogue id.
    const r = await one(`SELECT catalogue_version_id FROM product_rates LIMIT 1`);
    expect(r.catalogue_version_id).toBeNull();
  });

  it("515 refuses to apply if any pre-existing row claims a catalogue version", async () => {
    await db.exec(sqlFor('514_product_destination_eligibility.sql'));
    await db.exec(sqlFor('515_product_rate_catalogue_identity.sql'));
    await db.exec(`INSERT INTO product_rates (product_id, catalogue_version_id, rate, effective_from)
                   VALUES (1, 1, 0.01, '2020-01-01')`);
    // Re-applying with a backfilled row must fail: asserting a legacy id is a catalogue id is the
    // defect 515 exists to prevent.
    await expect(db.exec(sqlFor('515_product_rate_catalogue_identity.sql')))
      .rejects.toThrow(/backfilled|claim a catalogue version/i);
  });
});

describe("THE PUBLISH HAZARD SURFACE is known, not discovered later", () => {
  const SCHEMA = readFileSync(join(__dirname, '..', '..', '..', 'shared', 'schema.ts'), 'utf8');

  /**
   * Replit's publish runs a Drizzle diff. A table that exists in a DATABASE but not in
   * `schema.ts` is a table the diff can propose DROPPING - which is exactly how a publish once
   * proposed `DROP TABLE rate_push_operations CASCADE`.
   *
   * These tables are created by runFileMigrations and are deliberately absent from the schema
   * file. That is a known, accepted state; what must not happen is someone meeting it for the
   * first time in a publish dialog. This test names them so the list is explicit.
   */
  const CREATED_BY_MIGRATION = [
    'product_destination_eligibility',
    'billing_increment_changes',
    'billing_increment_notifications',
    'rate_push_notifications',
  ];

  it("EVERY migration-created table is declared, so the diff proposes dropping none", () => {
    // The hazard, closed. A table in the database and absent from this file is one the publish
    // diff can propose DROPPING — literally how a publish once proposed
    // `DROP TABLE rate_push_operations CASCADE`. Declaring costs nothing; the migration remains
    // the only thing that creates it.
    const undeclared = CREATED_BY_MIGRATION.filter(t => !SCHEMA.includes(`pgTable("${t}"`));
    expect(undeclared, `undeclared and therefore droppable: ${undeclared.join(', ')}`).toEqual([]);
  });

  it("rate_push_operations stays declared — the table the hazard was found on", () => {
    expect(SCHEMA).toContain('pgTable("rate_push_operations"');
  });

  it("product_rates IS in schema.ts, so 515's column must be there too", () => {
    // The opposite hazard: a column added by migration to a table the snapshot DOES know would
    // show as a diff to remove. It is declared, so the diff sees no difference.
    expect(SCHEMA).toContain('product_rates');
    expect(SCHEMA).toContain('catalogue_version_id');
  });
});
