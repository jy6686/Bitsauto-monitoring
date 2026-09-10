/**
 * DATABASE-BACKED. Real Postgres (PGlite), with migration 515 read off disk so the column and its
 * assertions are the ones production will get.
 *
 * The load-bearing assertions are the refusals. Expanding a destination into its prefixes is the
 * easy half; the half that matters is that a price is never carried across a catalogue version, an
 * ambiguous id is never guessed, and a row that cannot be expanded is REPORTED rather than quietly
 * contributing nothing to the upload.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  expandRates, activeCatalogueVersionId, summariseRefusals, REFUSED_VERDICTS,
  type ExpandableRate,
} from "./rate-prefix-expansion";

let client: PGlite;
let db: ReturnType<typeof drizzle>;

const MIGRATION_515 = readFileSync(
  join(__dirname, '..', '..', '..', 'migrations', '515_product_rate_catalogue_identity.sql'), 'utf8');

const V1 = 1, V2 = 2;
const AWCC = 10, JAZZ = 11, BD = 12;

const rate = (o: Partial<ExpandableRate> = {}): ExpandableRate =>
  ({ destinationId: null, prefix: null, catalogueVersionId: null, ...o });

const expand = async (rows: ExpandableRate[], activeVersion?: number | null) => {
  const v = activeVersion === undefined ? await activeCatalogueVersionId(db as any, sql) : activeVersion;
  return expandRates(db as any, rows, v, sql);
};

beforeAll(async () => {
  client = await PGlite.create();
  db = drizzle(client);
  await client.exec(`
    CREATE TABLE catalogue_versions (
      id SERIAL PRIMARY KEY, label TEXT NOT NULL UNIQUE, status TEXT NOT NULL);
    CREATE TABLE commercial_destinations (
      id SERIAL PRIMARY KEY,
      version_id INTEGER NOT NULL REFERENCES catalogue_versions(id) ON DELETE CASCADE,
      name TEXT NOT NULL, approval_status TEXT NOT NULL DEFAULT 'unapproved',
      UNIQUE (version_id, name));
    CREATE TABLE commercial_destination_prefixes (
      id SERIAL PRIMARY KEY,
      version_id INTEGER NOT NULL REFERENCES catalogue_versions(id) ON DELETE CASCADE,
      destination_id INTEGER NOT NULL REFERENCES commercial_destinations(id) ON DELETE CASCADE,
      prefix TEXT NOT NULL);
    CREATE TABLE product_rates (
      id SERIAL PRIMARY KEY, product_id INTEGER NOT NULL, destination_id INTEGER,
      prefix VARCHAR(32), rate NUMERIC(12,6) NOT NULL DEFAULT 0,
      effective_from DATE NOT NULL DEFAULT CURRENT_DATE, effective_to DATE);`);
  await client.exec(MIGRATION_515);
});
afterAll(async () => { await client?.close(); });

beforeEach(async () => {
  await client.exec(`
    DELETE FROM commercial_destination_prefixes;
    DELETE FROM commercial_destinations;
    DELETE FROM catalogue_versions;`);
  await db.execute(sql`INSERT INTO catalogue_versions (id, label, status) VALUES (${V1}, 'V1', 'active')`);
  await db.execute(sql`
    INSERT INTO commercial_destinations (id, version_id, name) VALUES
      (${AWCC}, ${V1}, 'AFGHANISTAN - MOBILE AWCC'),
      (${JAZZ}, ${V1}, 'PAKISTAN - MOBILE JAZZ'),
      (${BD},   ${V1}, 'BANGLADESH - FIXED')`);
  await db.execute(sql`
    INSERT INTO commercial_destination_prefixes (version_id, destination_id, prefix) VALUES
      (${V1}, ${AWCC}, '9370'), (${V1}, ${AWCC}, '9371'),
      (${V1}, ${JAZZ}, '9230')`);
  // BD deliberately has no prefixes.
});

describe("migration 515", () => {
  it("adds the column that says which id space destination_id is in", async () => {
    const r: any = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
       WHERE table_name = 'product_rates' AND column_name = 'catalogue_version_id'`);
    expect((r.rows ?? r)).toHaveLength(1);
  });

  it("refuses to let a pre-existing row claim a catalogue version", async () => {
    // Re-running the migration with a backfilled row must fail: asserting a legacy
    // global_destinations id is a catalogue id is the exact defect 515 closes.
    //
    // On its OWN database: the migration runs in a transaction, and a raised assertion leaves that
    // transaction aborted, which would poison every later test sharing the connection.
    const own = await PGlite.create();
    try {
      await own.exec(`
        CREATE TABLE product_rates (
          id SERIAL PRIMARY KEY, product_id INTEGER NOT NULL, destination_id INTEGER,
          prefix VARCHAR(32), rate NUMERIC(12,6) NOT NULL DEFAULT 0);`);
      await own.exec(MIGRATION_515);
      await own.exec(`INSERT INTO product_rates (product_id, destination_id, catalogue_version_id, rate)
                      VALUES (1, 999, 1, 0.01)`);
      await expect(own.exec(MIGRATION_515)).rejects.toThrow(/may be backfilled|claim a catalogue version/i);
    } finally { await own.close(); }
  });

  it("says on the column itself that destination_id alone is ambiguous", async () => {
    const r: any = await db.execute(sql`
      SELECT col_description('product_rates'::regclass,
        (SELECT ordinal_position FROM information_schema.columns
          WHERE table_name='product_rates' AND column_name='destination_id')) AS c`);
    expect(String((r.rows ?? r)[0].c)).toContain('ambiguous');
  });
});

describe("a catalogue-keyed price covers the whole destination", () => {
  it("expands one rate into every prefix the destination holds", async () => {
    const [e] = await expand([rate({ destinationId: AWCC, catalogueVersionId: V1, prefix: '9370' })]);
    expect(e.verdict).toBe('catalogue');
    // The whole point: 9371 was going to be silently unpriced.
    expect(e.prefixes).toEqual(['9370', '9371']);
    expect(e.destinationName).toBe('AFGHANISTAN - MOBILE AWCC');
    expect(e.reason).toBeNull();
  });

  it("ignores the row's own prefix column entirely", async () => {
    // The destination decides what it covers. A stale or wrong `prefix` on the row must not
    // narrow, widen, or override the catalogue.
    const [e] = await expand([rate({ destinationId: AWCC, catalogueVersionId: V1, prefix: '999999' })]);
    expect(e.prefixes).toEqual(['9370', '9371']);
  });

  it("expands a single-prefix destination to exactly that prefix", async () => {
    const [e] = await expand([rate({ destinationId: JAZZ, catalogueVersionId: V1 })]);
    expect(e.verdict).toBe('catalogue');
    expect(e.prefixes).toEqual(['9230']);
  });

  it("issues ONE catalogue query for a whole batch", async () => {
    // A provisioning run prices every destination of every product; a per-row lookup would be a
    // query per price.
    let queries = 0;
    const counting = { execute: (q: any) => { queries++; return (db as any).execute(q); } };
    await expandRates(counting as any, [
      rate({ destinationId: AWCC, catalogueVersionId: V1 }),
      rate({ destinationId: JAZZ, catalogueVersionId: V1 }),
      rate({ destinationId: AWCC, catalogueVersionId: V1 }),
    ], V1, sql);
    expect(queries).toBe(1);
  });
});

describe("it never carries a price across a catalogue version", () => {
  beforeEach(async () => {
    // V2 holds a destination with the SAME NAME and a DIFFERENT prefix set — the case that makes
    // name-matching across versions unsafe.
    await db.execute(sql`UPDATE catalogue_versions SET status = 'archived' WHERE id = ${V1}`);
    await db.execute(sql`INSERT INTO catalogue_versions (id, label, status) VALUES (${V2}, 'V2', 'active')`);
    await db.execute(sql`
      INSERT INTO commercial_destinations (id, version_id, name)
      VALUES (20, ${V2}, 'AFGHANISTAN - MOBILE AWCC')`);
    await db.execute(sql`
      INSERT INTO commercial_destination_prefixes (version_id, destination_id, prefix)
      VALUES (${V2}, 20, '9370'), (${V2}, 20, '9372'), (${V2}, 20, '9373')`);
  });

  it("refuses a price set against the previous version", async () => {
    const [e] = await expand([rate({ destinationId: AWCC, catalogueVersionId: V1, prefix: '9370' })]);
    expect(e.verdict).toBe('stale_version');
    expect(e.prefixes).toEqual([]);
  });

  it("does NOT re-resolve it by name to the new version's destination", async () => {
    // V2's AWCC covers 9372 and 9373, which V1's did not. Silently inheriting would upload
    // prices for prefixes nobody priced and drop one somebody did.
    const [e] = await expand([rate({ destinationId: AWCC, catalogueVersionId: V1 })]);
    expect(e.prefixes).not.toContain('9372');
    expect(e.destinationName).toBeNull();
  });

  it("does NOT fall back to the row's prefix to rescue it", async () => {
    // Falling back would upload a partial price under a verdict that reads like success.
    const [e] = await expand([rate({ destinationId: AWCC, catalogueVersionId: V1, prefix: '9370' })]);
    expect(e.prefixes).toEqual([]);
  });

  it("says in the reason that a re-import can change what a destination covers", async () => {
    const [e] = await expand([rate({ destinationId: AWCC, catalogueVersionId: V1 })]);
    expect(e.reason).toMatch(/changing which prefixes it covers/i);
    expect(e.reason).toMatch(/Re-price it against the active version/i);
  });

  it("expands a price that WAS set against the active version", async () => {
    const [e] = await expand([rate({ destinationId: 20, catalogueVersionId: V2 })]);
    expect(e.verdict).toBe('catalogue');
    expect(e.prefixes).toEqual(['9370', '9372', '9373']);
  });
});

describe("legacy rows keep exactly the behaviour they had", () => {
  it("a prefix-only row prices that one prefix", async () => {
    const [e] = await expand([rate({ prefix: '92' })]);
    expect(e.verdict).toBe('legacy_prefix');
    expect(e.prefixes).toEqual(['92']);
  });

  it("a row with a legacy destination_id and no version is NOT read as a catalogue id", async () => {
    // This is the defect. AWCC's catalogue id is 10; a legacy global_destinations id of 10 must
    // not expand to AWCC's prefixes.
    const [e] = await expand([rate({ destinationId: AWCC, prefix: '92' })]);
    expect(e.verdict).toBe('legacy_prefix');
    expect(e.prefixes).toEqual(['92']);
    expect(e.prefixes).not.toContain('9371');
  });

  it("trims a padded prefix", async () => {
    expect((await expand([rate({ prefix: '  880 ' })]))[0].prefixes).toEqual(['880']);
  });

  it("a row with neither identity nor prefix is unpriceable, not silently empty", async () => {
    const [e] = await expand([rate({})]);
    expect(e.verdict).toBe('unpriceable');
    expect(e.reason).toBeTruthy();
  });
});

describe("it refuses rather than emitting less", () => {
  it("reports a destination that is not in the version it claims", async () => {
    const [e] = await expand([rate({ destinationId: 8888, catalogueVersionId: V1 })]);
    expect(e.verdict).toBe('unknown_destination');
    expect(e.reason).toContain('8888');
  });

  it("reports a destination that holds no prefixes instead of uploading nothing quietly", async () => {
    const [e] = await expand([rate({ destinationId: BD, catalogueVersionId: V1 })]);
    expect(e.verdict).toBe('no_prefixes');
    expect(e.reason).toMatch(/reaches nothing/);
  });

  it("refuses a catalogue-keyed row that names no destination", async () => {
    // Falling back to its prefix would upload a price the row does not make.
    const [e] = await expand([rate({ catalogueVersionId: V1, prefix: '9370' })]);
    expect(e.verdict).toBe('unpriceable');
    expect(e.prefixes).toEqual([]);
  });

  it("refuses everything catalogue-keyed when no version is active", async () => {
    await db.execute(sql`UPDATE catalogue_versions SET status = 'archived'`);
    const [e] = await expand([rate({ destinationId: AWCC, catalogueVersionId: V1 })]);
    expect(e.verdict).toBe('stale_version');
    expect(e.reason).toContain('active version is none');
  });

  it("every refusal carries a reason and no prefixes", async () => {
    const all = await expand([
      rate({ destinationId: 8888, catalogueVersionId: V1 }),
      rate({ destinationId: BD,   catalogueVersionId: V1 }),
      rate({ catalogueVersionId: V1 }),
      rate({}),
    ]);
    for (const e of all) {
      expect(REFUSED_VERDICTS).toContain(e.verdict);
      expect(e.prefixes).toEqual([]);
      expect(e.reason, `${e.verdict} must explain itself`).toBeTruthy();
    }
  });

  it("summarises refusals by cause, so a version rollover reads as one line not 19,000", async () => {
    await db.execute(sql`UPDATE catalogue_versions SET status = 'archived' WHERE id = ${V1}`);
    await db.execute(sql`INSERT INTO catalogue_versions (id, label, status) VALUES (${V2}, 'V2', 'active')`);
    const many = Array.from({ length: 500 }, () => rate({ destinationId: AWCC, catalogueVersionId: V1 }));
    const lines = summariseRefusals(await expand(many));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('500 price(s) not uploaded');
    expect(lines[0]).toContain('stale_version');
  });

  it("a successful expansion contributes nothing to the refusal summary", async () => {
    expect(summariseRefusals(await expand([rate({ destinationId: AWCC, catalogueVersionId: V1 })]))).toEqual([]);
  });
});

describe("both readers actually consume this, asserted against their source", () => {
  const read = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8');
  const code = (t: string) => t.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

  const UPLOAD = code(read(join('services', 'rates', 'rate-upload.service.ts')));
  const STEP   = code(read(join('services', 'provisioning', 'steps', 'rates.step.ts')));

  it("rate-upload.service expands instead of reading one prefix", () => {
    expect(UPLOAD).toContain('expandRates');
    expect(UPLOAD).toContain('catalogueVersionId: productRates.catalogueVersionId');
    // The old body emitted exactly one row per rate from the `prefix` column.
    expect(UPLOAD).not.toMatch(/const dest = \(r\.prefix \?\? ''\)\.trim\(\);/);
  });

  it("rates.step splits the two id spaces BEFORE resolving anything", () => {
    expect(STEP).toContain('expandRates');
    expect(STEP).toContain('legacyPriced');
    // The legacy resolution must never see a catalogue-keyed row.
    expect(STEP).toContain('legacyPriced.map');
    expect(STEP).not.toContain('const firstPass: Array<{ r: typeof priced[number]');
  });

  it("rates.step keeps catalogue-derived destination ids negative", () => {
    // Load-bearing: the generator keys rates by destinationId against global_destinations
    // serials, so a negative id is what makes a collision impossible rather than unlikely.
    expect(STEP).toContain('let syntheticId = -1;');
    expect(STEP).toContain('const id = syntheticId--;');
  });

  it("both readers report what they refused rather than uploading less in silence", () => {
    expect(UPLOAD).toContain('summariseRefusals');
    expect(UPLOAD).toContain('refusals');
    expect(STEP).toContain('summariseRefusals');
    expect(STEP).toContain('...expansionRefusals');
  });

  it("neither reader resolves a catalogue id through global_destinations", () => {
    // rates.step still uses globalDestinations for LEGACY rows, which is correct. What must not
    // exist is a path from a catalogue-keyed row into that lookup.
    expect(UPLOAD).not.toContain('globalDestinations');
    expect(STEP).not.toMatch(/catalogueKeyed[\s\S]{0,200}globalDestinations/);
  });
});
