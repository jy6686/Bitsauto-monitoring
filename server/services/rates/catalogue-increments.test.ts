/**
 * DATABASE-BACKED. Runs real Postgres (PGlite, in-process) through the real Drizzle client.
 *
 * This file exists because of a specific production failure on 2026-09-08: the catalogue
 * increment lookup shipped with `p.prefix = ANY(${jsArray})`, passed 92 unit tests, and
 * returned 500 on the first real request —
 *
 *     op ANY/ALL (array) requires array on right side
 *
 * Green unit tests cannot certify a database boundary they never cross. Every assertion here
 * executes SQL. The schema mirrors migration 500; the seed data mirrors production.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { lookupCatalogueIncrements } from "./catalogue-increments";
import { parseBillingIncrement } from "./billing-increment";

let client: PGlite;
let db: ReturnType<typeof drizzle>;

beforeAll(async () => {
  client = await PGlite.create();
  db = drizzle(client);

  // Shape from migration 500_commercial_destination_catalogue.sql
  await db.execute(sql`
    CREATE TABLE catalogue_versions (
      id SERIAL PRIMARY KEY,
      label TEXT NOT NULL,
      status TEXT NOT NULL
    )`);
  await db.execute(sql`
    CREATE TABLE commercial_destinations (
      id SERIAL PRIMARY KEY,
      version_id INTEGER NOT NULL REFERENCES catalogue_versions(id),
      name TEXT NOT NULL,
      approval_status TEXT NOT NULL DEFAULT 'unapproved'
    )`);
  await db.execute(sql`
    CREATE TABLE commercial_destination_prefixes (
      id SERIAL PRIMARY KEY,
      version_id INTEGER NOT NULL REFERENCES catalogue_versions(id),
      destination_id INTEGER NOT NULL REFERENCES commercial_destinations(id),
      prefix TEXT NOT NULL,
      billing_increment TEXT,
      UNIQUE (version_id, prefix)
    )`);

  await db.execute(sql`INSERT INTO catalogue_versions (id, label, status) VALUES
    (1, 'Supplier Catalogue V1', 'active'),
    (2, 'Superseded V0', 'archived')`);
  await db.execute(sql`INSERT INTO commercial_destinations (id, version_id, name, approval_status) VALUES
    (3,   1, 'AFGHANISTAN - MOBILE AWCC',  'approved'),
    (886, 1, 'PAKISTAN - MOBILE MOBILINK', 'approved'),
    (891, 1, 'PAKISTAN - MOBILE ZONG',     'approved'),
    (999, 1, 'BROKEN - UNREADABLE',        'approved'),
    (500, 2, 'ARCHIVED - OLD',             'approved')`);
  await db.execute(sql`INSERT INTO commercial_destination_prefixes (version_id, destination_id, prefix, billing_increment) VALUES
    (1, 3,   '9370', '60/1'),
    (1, 3,   '9371', '60/1'),
    (1, 886, '9230', '1/1'),
    (1, 891, '9231', '1/1'),
    (1, 891, '9237', '1/1'),
    (1, 999, '35528340', 'per second'),
    (1, 999, '35528350', NULL),
    (2, 500, '4471', '60/60')`);
});

afterAll(async () => { await client?.close(); });

describe("lookupCatalogueIncrements against real Postgres", () => {
  it("REGRESSION: a multi-prefix lookup executes — this is the statement that returned 500", () => {
    // The shipped version threw here with "op ANY/ALL (array) requires array on right side".
    // Reverting to `= ANY(${array})` makes this test fail, which is the point of it existing.
    return expect(lookupCatalogueIncrements(db, ['9370', '9371'])).resolves.toBeInstanceOf(Map);
  });

  it("AWCC: both catalogue prefixes come back as 60/1", async () => {
    const m = await lookupCatalogueIncrements(db, ['9370', '9371']);
    expect(m.get('9370')).toBe('60/1');
    expect(m.get('9371')).toBe('60/1');
    expect(parseBillingIncrement(m.get('9370'))).toEqual({ interval1: 60, intervalN: 1 });
  });

  it("handles a batch mixing several destinations and increments", async () => {
    const m = await lookupCatalogueIncrements(db, ['9370', '9230', '9231', '9237']);
    expect(m.size).toBe(4);
    expect(m.get('9370')).toBe('60/1');
    expect(m.get('9230')).toBe('1/1');
    expect(m.get('9237')).toBe('1/1');
  });

  it("a single prefix works — the legacy one-destination shape", async () => {
    const m = await lookupCatalogueIncrements(db, ['9230']);
    expect(m.get('9230')).toBe('1/1');
  });

  it("a prefix absent from the catalogue is ABSENT from the map, not null", async () => {
    // The caller distinguishes these: absent keeps the legacy 1/1, present-but-unreadable
    // refuses the push. Collapsing them would silently bill an unreadable row per-second.
    const m = await lookupCatalogueIncrements(db, ['9370', '999999']);
    expect(m.has('9370')).toBe(true);
    expect(m.has('999999')).toBe(false);
  });

  it("distinguishes an unreadable increment from an absent one", async () => {
    const m = await lookupCatalogueIncrements(db, ['35528340', '35528350', '404404']);
    expect(m.has('35528340')).toBe(true);
    expect(parseBillingIncrement(m.get('35528340'))).toBeNull();   // present, unusable -> refuse
    expect(m.has('35528350')).toBe(true);
    expect(m.get('35528350')).toBeNull();
    expect(parseBillingIncrement(m.get('35528350'))).toBeNull();   // present, NULL -> refuse
    expect(m.has('404404')).toBe(false);                            // absent -> legacy 1/1
  });

  it("reads ONLY the active version — an archived version's prefix is invisible", async () => {
    const m = await lookupCatalogueIncrements(db, ['4471']);
    expect(m.has('4471')).toBe(false);
  });

  it("an empty batch returns an empty map without emitting `IN ()`", async () => {
    // `IN ()` is a Postgres syntax error, so this must short-circuit rather than build SQL.
    await expect(lookupCatalogueIncrements(db, [])).resolves.toEqual(new Map());
  });

  it("de-duplicates repeated prefixes in one batch", async () => {
    const m = await lookupCatalogueIncrements(db, ['9370', '9370', '9370']);
    expect(m.size).toBe(1);
    expect(m.get('9370')).toBe('60/1');
  });

  it("a prefix containing a quote is bound, not interpolated", async () => {
    // Each prefix is its own bound parameter; this would be a syntax error under string building.
    await expect(lookupCatalogueIncrements(db, ["9370', 'x"])).resolves.toEqual(new Map());
  });

  it("handles a batch far larger than any real push", async () => {
    const many = Array.from({ length: 500 }, (_, i) => `x${i}`).concat(['9370']);
    const m = await lookupCatalogueIncrements(db, many);
    expect(m.get('9370')).toBe('60/1');
    expect(m.size).toBe(1);
  });
});
