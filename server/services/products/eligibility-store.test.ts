/**
 * DATABASE-BACKED. Real Postgres (PGlite), and the schema is migration 514 itself read off disk
 * alongside the catalogue it references, so the constraints and the trigger are the ones production
 * will get rather than a hand-copy that can drift.
 *
 * The load-bearing assertions are the ones about what this layer refuses to do: it does not seed,
 * does not infer, does not read the legacy assignment table, and does not carry eligibility across a
 * catalogue version by itself.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  grantEligibility, withdrawEligibility, listEligibleDestinations, describeVersionRollover,
} from "./eligibility-store";

let client: PGlite;
let db: ReturnType<typeof drizzle>;

const all = async (q: any) => { const r: any = await db.execute(q); return Array.isArray(r) ? r : (r.rows ?? []); };

/** FC=1 trunk 1, and PREM=6 trunk 1 — the wholesale/retail pairing that shares a trunk. */
const FC = 1, PREM = 6;

beforeAll(async () => {
  client = await PGlite.create();
  db = drizzle(client);

  // The catalogue, as migration 500 shapes it, plus the registry 514 references.
  await client.exec(`
    CREATE TABLE catalogue_versions (
      id SERIAL PRIMARY KEY, label TEXT NOT NULL UNIQUE, status TEXT NOT NULL);
    CREATE TABLE catalogue_import_batches (id SERIAL PRIMARY KEY);
    CREATE TABLE commercial_destinations (
      id SERIAL PRIMARY KEY,
      version_id INTEGER NOT NULL REFERENCES catalogue_versions(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      approval_status TEXT NOT NULL DEFAULT 'unapproved',
      approved_by TEXT, approved_at TIMESTAMPTZ,
      import_batch_id INTEGER REFERENCES catalogue_import_batches(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (version_id, name));
    CREATE TABLE commercial_destination_prefixes (
      id SERIAL PRIMARY KEY,
      version_id INTEGER NOT NULL REFERENCES catalogue_versions(id) ON DELETE CASCADE,
      destination_id INTEGER NOT NULL REFERENCES commercial_destinations(id) ON DELETE CASCADE,
      prefix TEXT NOT NULL, supplier_rate NUMERIC);
    CREATE TABLE product_registry (
      id SERIAL PRIMARY KEY, code VARCHAR(16) UNIQUE NOT NULL, name VARCHAR(64) NOT NULL,
      trunk_prefix VARCHAR(8), segment VARCHAR(32), status VARCHAR(16) NOT NULL DEFAULT 'draft');
    CREATE TABLE product_destination_assignments (
      id SERIAL PRIMARY KEY, product_id INTEGER NOT NULL, destination_id INTEGER NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'active');`);

  await client.exec(readFileSync(join(__dirname, '..', '..', '..', 'migrations', '514_product_destination_eligibility.sql'), 'utf8'));
});
afterAll(async () => { await client?.close(); });

beforeEach(async () => {
  await client.exec(`
    DELETE FROM product_destination_eligibility;
    DELETE FROM commercial_destination_prefixes;
    DELETE FROM commercial_destinations;
    DELETE FROM catalogue_versions;
    DELETE FROM product_registry;
    DELETE FROM product_destination_assignments;`);
  await db.execute(sql`
    INSERT INTO product_registry (id, code, name, trunk_prefix, segment, status) VALUES
      (${FC},   'FC',   'First Class Wholesale', '1', 'wholesale',  'commercial'),
      (${PREM}, 'PREM', 'Premium',               '1', 'retail',     'commercial')`);
  await db.execute(sql`INSERT INTO catalogue_versions (id, label, status) VALUES (1, 'V1', 'active')`);
  await db.execute(sql`
    INSERT INTO commercial_destinations (id, version_id, name, approval_status) VALUES
      (10, 1, 'AFGHANISTAN - MOBILE AWCC', 'approved'),
      (11, 1, 'PAKISTAN - MOBILE JAZZ',    'approved'),
      (12, 1, 'BANGLADESH - FIXED',        'approved')`);
  await db.execute(sql`
    INSERT INTO commercial_destination_prefixes (version_id, destination_id, prefix) VALUES
      (1, 10, '9370'), (1, 10, '9371'), (1, 11, '9230'), (1, 12, '880')`);
});

describe("migration 514", () => {
  it("creates the table EMPTY, and says why seeding it would be wrong", async () => {
    // Which destinations a product sells is a commercial decision. The migration asserts this.
    expect(await all(sql`SELECT * FROM product_destination_eligibility`)).toHaveLength(0);
  });

  it("retires the legacy assignment table by MARKING it, not emptying it", async () => {
    await db.execute(sql`INSERT INTO product_destination_assignments (product_id, destination_id) VALUES (1, 13)`);
    // The 52 production rows stay readable as an audit trail; only the comment declares them dead.
    expect(await all(sql`SELECT * FROM product_destination_assignments`)).toHaveLength(1);
    const [c] = await all(sql`SELECT obj_description('product_destination_assignments'::regclass) AS comment`);
    expect(String(c.comment)).toContain('NON-AUTHORITATIVE');
    expect(String(c.comment)).toContain('do NOT remap its ids');
  });

  it("refuses eligibility whose version disagrees with its destination", async () => {
    await db.execute(sql`INSERT INTO catalogue_versions (id, label, status) VALUES (2, 'V2', 'draft')`);
    await expect(db.execute(sql`
      INSERT INTO product_destination_eligibility (product_id, destination_id, version_id)
      VALUES (${FC}, 10, 2)`)).rejects.toThrow(/does not match destination/i);
  });

  it("refuses a withdrawal with no operator or no time", async () => {
    await expect(db.execute(sql`
      INSERT INTO product_destination_eligibility (product_id, destination_id, version_id, status)
      VALUES (${FC}, 10, 1, 'withdrawn')`)).rejects.toThrow(/withdrawal_ck|check constraint/i);
  });

  it("keeps one row per product per destination", async () => {
    await db.execute(sql`INSERT INTO product_destination_eligibility (product_id, destination_id, version_id) VALUES (${FC}, 10, 1)`);
    await expect(db.execute(sql`
      INSERT INTO product_destination_eligibility (product_id, destination_id, version_id) VALUES (${FC}, 10, 1)`))
      .rejects.toThrow(/unique|duplicate key/i);
  });
});

describe("granting is explicit and attributable", () => {
  it("records who said the product sells there", async () => {
    const r = await grantEligibility(db, { productId: FC, destinationId: 10, grantedBy: 'junaid' });
    expect(r.ok).toBe(true);
    expect((r as any).row).toMatchObject({ productId: FC, destinationId: 10, versionId: 1, status: 'active', createdBy: 'junaid' });
  });

  it("takes the version from the DESTINATION, never from the caller", async () => {
    // A caller-supplied version would be a second source of truth for a fact the catalogue owns.
    const r = await grantEligibility(db, { productId: FC, destinationId: 11, grantedBy: 'junaid' });
    expect((r as any).row.versionId).toBe(1);
  });

  it("refuses an unattributable grant", async () => {
    expect(await grantEligibility(db, { productId: FC, destinationId: 10, grantedBy: '  ' }))
      .toMatchObject({ ok: false, code: 'not_attributable' });
  });

  it("refuses a destination that is not in the commercial catalogue", async () => {
    // 13 is a legacy assignment id. Eligibility must never resolve one of those.
    const r = await grantEligibility(db, { productId: FC, destinationId: 13, grantedBy: 'junaid' });
    expect(r).toMatchObject({ ok: false, code: 'unknown_destination' });
    expect((r as any).message).toContain('never the legacy destination tree');
  });

  it("is idempotent, and re-granting a withdrawal flips one row rather than adding another", async () => {
    await grantEligibility(db, { productId: FC, destinationId: 10, grantedBy: 'junaid' });
    expect(await grantEligibility(db, { productId: FC, destinationId: 10, grantedBy: 'junaid' }))
      .toMatchObject({ ok: true, reactivated: false });

    await withdrawEligibility(db, { productId: FC, destinationId: 10, withdrawnBy: 'junaid' });
    const again = await grantEligibility(db, { productId: FC, destinationId: 10, grantedBy: 'someone' });
    expect(again).toMatchObject({ ok: true, reactivated: true });
    expect((again as any).row.withdrawnAt).toBeNull();
    expect(await all(sql`SELECT * FROM product_destination_eligibility WHERE product_id = ${FC} AND destination_id = 10`)).toHaveLength(1);
  });
});

describe("withdrawal is a claim, not a delete", () => {
  it("keeps the row and records who withdrew it", async () => {
    await grantEligibility(db, { productId: FC, destinationId: 10, grantedBy: 'junaid' });
    const w = await withdrawEligibility(db, { productId: FC, destinationId: 10, withdrawnBy: 'junaid', notes: 'no longer sold' });
    expect((w as any).row).toMatchObject({ status: 'withdrawn', withdrawnBy: 'junaid', notes: 'no longer sold' });
    expect(await all(sql`SELECT * FROM product_destination_eligibility`)).toHaveLength(1);
  });

  it("refuses to withdraw what was never granted, or to withdraw twice", async () => {
    expect(await withdrawEligibility(db, { productId: FC, destinationId: 10, withdrawnBy: 'j' }))
      .toMatchObject({ ok: false, code: 'not_found' });
    await grantEligibility(db, { productId: FC, destinationId: 10, grantedBy: 'j' });
    await withdrawEligibility(db, { productId: FC, destinationId: 10, withdrawnBy: 'j' });
    expect(await withdrawEligibility(db, { productId: FC, destinationId: 10, withdrawnBy: 'j' }))
      .toMatchObject({ ok: false, code: 'already_withdrawn' });
  });
});

describe("what a product sells", () => {
  it("NOTHING is inferred — an undeclared product sells nothing, and that is the answer", async () => {
    expect(await listEligibleDestinations(db, FC)).toEqual([]);
  });

  it("resolves through the catalogue, carrying every prefix the destination holds", async () => {
    await grantEligibility(db, { productId: FC, destinationId: 10, grantedBy: 'junaid' });
    const [d] = await listEligibleDestinations(db, FC);
    expect(d).toMatchObject({ destinationId: 10, name: 'AFGHANISTAN - MOBILE AWCC', versionId: 1, approvalStatus: 'approved' });
    // A destination is a SET of prefixes, not one — 9370 and 9371 both belong to AWCC.
    expect(d.prefixes).toEqual(['9370', '9371']);
  });

  it("two products can sell genuinely different sets — the thing the legacy 13x4 seed could not express", async () => {
    await grantEligibility(db, { productId: FC,   destinationId: 10, grantedBy: 'junaid' });
    await grantEligibility(db, { productId: FC,   destinationId: 11, grantedBy: 'junaid' });
    await grantEligibility(db, { productId: PREM, destinationId: 12, grantedBy: 'junaid' });

    expect((await listEligibleDestinations(db, FC)).map(d => d.destinationId).sort()).toEqual([10, 11]);
    expect((await listEligibleDestinations(db, PREM)).map(d => d.destinationId)).toEqual([12]);
  });

  it("a withdrawn destination drops out", async () => {
    await grantEligibility(db, { productId: FC, destinationId: 10, grantedBy: 'j' });
    await grantEligibility(db, { productId: FC, destinationId: 11, grantedBy: 'j' });
    await withdrawEligibility(db, { productId: FC, destinationId: 10, withdrawnBy: 'j' });
    expect((await listEligibleDestinations(db, FC)).map(d => d.destinationId)).toEqual([11]);
  });

  it("is scoped to the ACTIVE version, because that is the only one anything is sold on", async () => {
    await grantEligibility(db, { productId: FC, destinationId: 10, grantedBy: 'j' });
    // A second version exists but is not active; the V1 grant must still be the answer.
    await db.execute(sql`INSERT INTO catalogue_versions (id, label, status) VALUES (2, 'V2', 'draft')`);
    await db.execute(sql`INSERT INTO commercial_destinations (id, version_id, name, approval_status) VALUES (20, 2, 'AFGHANISTAN - MOBILE AWCC', 'approved')`);
    expect((await listEligibleDestinations(db, FC)).map(d => d.destinationId)).toEqual([10]);
  });
});

describe("a catalogue version rollover is reported, never performed", () => {
  beforeEach(async () => {
    await grantEligibility(db, { productId: FC, destinationId: 10, grantedBy: 'junaid' });  // AWCC
    await grantEligibility(db, { productId: FC, destinationId: 12, grantedBy: 'junaid' });  // BANGLADESH - FIXED
    await db.execute(sql`INSERT INTO catalogue_versions (id, label, status) VALUES (2, 'V2', 'draft')`);
    // V2 keeps AWCC and drops BANGLADESH - FIXED.
    await db.execute(sql`INSERT INTO commercial_destinations (id, version_id, name, approval_status) VALUES (20, 2, 'AFGHANISTAN - MOBILE AWCC', 'approved')`);
  });

  it("says what would carry and what would be orphaned, matching on the catalogue's own identity", async () => {
    const r = await describeVersionRollover(db, 1, 2);
    expect(r.carriable).toEqual([{ productId: FC, name: 'AFGHANISTAN - MOBILE AWCC', fromDestinationId: 10, toDestinationId: 20 }]);
    expect(r.orphaned).toEqual([{ productId: FC, name: 'BANGLADESH - FIXED', fromDestinationId: 12 }]);
  });

  it("CARRIES NOTHING — a name surviving is not a commercial decision that eligibility survives", async () => {
    await describeVersionRollover(db, 1, 2);
    const v2 = await all(sql`SELECT * FROM product_destination_eligibility WHERE version_id = 2`);
    expect(v2).toHaveLength(0);
  });
});

describe("the legacy table is never read", () => {
  it("no eligibility code mentions product_destination_assignments or global_destinations", () => {
    const src = readFileSync(join(__dirname, 'eligibility-store.ts'), 'utf8')
      .split('\n').filter(l => !/^\s*(\*|\/\*|\/\/)/.test(l)).join('\n');
    for (const legacy of ['product_destination_assignments', 'global_destinations', 'destination_id_map']) {
      expect(src, `eligibility must not read ${legacy}`).not.toContain(legacy);
    }
  });
});
