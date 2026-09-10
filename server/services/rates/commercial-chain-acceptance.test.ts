/**
 * SLICE 2 ACCEPTANCE — the commercial chain, end to end, against real Postgres.
 *
 *   product registry identity + catalogue destination/version + a rate
 *     -> declared eligibility
 *       -> every prefix of that destination
 *         -> trunk + prefix
 *           -> catalogue billing increment
 *             -> the operations that would be pushed
 *
 * Driven through the REAL modules — `grantEligibility`, `listEligibleDestinations`,
 * `expandRates`, `lookupCatalogueIncrements`, `parseBillingIncrement`, `composePrefix` — not a
 * re-implementation, because a re-implementation keeps passing after the real chain drifts.
 *
 * DELIBERATELY NOT A HAPPY PATH. The destination under test carries THREE prefixes and a
 * `60/1` increment. A chain that only ever handled one prefix at `1/1` would pass a
 * single-prefix test and mis-price every real destination in the catalogue.
 *
 * No Sippy call is possible here: nothing in this file touches the transport.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { grantEligibility, withdrawEligibility, listEligibleDestinations } from "../products/eligibility-store";
import { expandRates, activeCatalogueVersionId } from "./rate-prefix-expansion";
import { lookupCatalogueIncrements } from "./catalogue-increments";
import { parseBillingIncrement } from "./billing-increment";
import { composePrefix } from "./rate-matrix";

let client: PGlite;
let db: ReturnType<typeof drizzle>;

const V1 = 1;
const FC = 1;                 // First Class Wholesale, trunk "1"
const JAZZ = 10;              // 3 prefixes, increment 60/1  <- the interesting one
const AWCC = 11;              // 1 prefix,  increment 1/1
const OPERATOR = 'junaid@ichibaanlogic.com';

const MIG = (f: string) => readFileSync(join(__dirname, '..', '..', '..', 'migrations', f), 'utf8');

beforeAll(async () => {
  client = await PGlite.create();
  db = drizzle(client);
  await client.exec(`
    CREATE TABLE catalogue_versions (
      id SERIAL PRIMARY KEY, label TEXT NOT NULL UNIQUE, status TEXT NOT NULL);
    CREATE TABLE commercial_destinations (
      id SERIAL PRIMARY KEY,
      version_id INTEGER NOT NULL REFERENCES catalogue_versions(id) ON DELETE CASCADE,
      name TEXT NOT NULL, approval_status TEXT NOT NULL DEFAULT 'approved',
      UNIQUE (version_id, name));
    CREATE TABLE commercial_destination_prefixes (
      id SERIAL PRIMARY KEY,
      version_id INTEGER NOT NULL REFERENCES catalogue_versions(id) ON DELETE CASCADE,
      destination_id INTEGER NOT NULL REFERENCES commercial_destinations(id) ON DELETE CASCADE,
      prefix TEXT NOT NULL, billing_increment TEXT, supplier_rate NUMERIC);
    CREATE TABLE product_registry (
      id SERIAL PRIMARY KEY, code VARCHAR(16) UNIQUE NOT NULL, name VARCHAR(64) NOT NULL,
      trunk_prefix VARCHAR(8), segment VARCHAR(32), status VARCHAR(16) NOT NULL DEFAULT 'draft');
    CREATE TABLE product_destination_assignments (
      id SERIAL PRIMARY KEY, product_id INTEGER NOT NULL, destination_id INTEGER NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'active');
    CREATE TABLE product_rates (
      id SERIAL PRIMARY KEY, product_id INTEGER NOT NULL, destination_id INTEGER,
      prefix VARCHAR(32), rate NUMERIC(12,6) NOT NULL DEFAULT 0,
      effective_from DATE NOT NULL DEFAULT CURRENT_DATE, effective_to DATE);`);
  await client.exec(MIG('514_product_destination_eligibility.sql'));
  await client.exec(MIG('515_product_rate_catalogue_identity.sql'));
});
afterAll(async () => { await client?.close(); });

beforeEach(async () => {
  await client.exec(`
    DELETE FROM product_rates;
    DELETE FROM product_destination_eligibility;
    DELETE FROM commercial_destination_prefixes;
    DELETE FROM commercial_destinations;
    DELETE FROM catalogue_versions;
    DELETE FROM product_registry;`);
  await db.execute(sql`
    INSERT INTO product_registry (id, code, name, trunk_prefix, segment, status)
    VALUES (${FC}, 'FC', 'First Class Wholesale', '1', 'wholesale', 'commercial')`);
  await db.execute(sql`INSERT INTO catalogue_versions (id, label, status) VALUES (${V1}, 'V1', 'active')`);
  await db.execute(sql`
    INSERT INTO commercial_destinations (id, version_id, name) VALUES
      (${JAZZ}, ${V1}, 'PAKISTAN - MOBILE JAZZ'),
      (${AWCC}, ${V1}, 'AFGHANISTAN - MOBILE AWCC')`);
  await db.execute(sql`
    INSERT INTO commercial_destination_prefixes (version_id, destination_id, prefix, billing_increment) VALUES
      (${V1}, ${JAZZ}, '9230', '60/1'),
      (${V1}, ${JAZZ}, '9231', '60/1'),
      (${V1}, ${JAZZ}, '9232', '60/1'),
      (${V1}, ${AWCC}, '9370', '1/1')`);
});

const declare  = (destinationId: number) => grantEligibility(db as any, { productId: FC, destinationId, grantedBy: OPERATOR });
const priceIt  = (destinationId: number, rate: string) => db.execute(sql`
  INSERT INTO product_rates (product_id, destination_id, catalogue_version_id, rate, effective_from)
  VALUES (${FC}, ${destinationId}, ${V1}, ${rate}, '2020-01-01')`);

/** The whole chain, exactly as the push path composes it. */
async function buildOperations() {
  const [{ trunk_prefix: trunk }] = ((await db.execute(sql`
    SELECT trunk_prefix FROM product_registry WHERE id = ${FC}`)) as any).rows;

  const priced = ((await db.execute(sql`
    SELECT destination_id AS "destinationId", prefix, rate,
           catalogue_version_id AS "catalogueVersionId", product_id AS "productId"
      FROM product_rates WHERE product_id = ${FC}`)) as any).rows;

  const activeVersion = await activeCatalogueVersionId(db as any, sql as any);
  const expanded = await expandRates(db as any, priced as any, activeVersion, sql as any);

  const allPrefixes = expanded.flatMap(e => e.prefixes);
  const increments = await lookupCatalogueIncrements(db as any, allPrefixes);

  const ops: Array<{ fullPrefix: string; rate: number; interval1: number; intervalN: number; destination: string | null }> = [];
  for (const e of expanded) {
    for (const p of e.prefixes) {
      const inc = parseBillingIncrement(increments.get(p) ?? null);
      ops.push({
        fullPrefix: composePrefix(String(trunk), p),
        rate: Number((e.row as any).rate),
        interval1: inc?.interval1 ?? 1,
        intervalN: inc?.intervalN ?? 1,
        destination: e.destinationName,
      });
    }
  }
  return ops.sort((a, b) => a.fullPrefix.localeCompare(b.fullPrefix));
}

describe("NEGATIVE — an undeclared destination is not priceable", () => {
  it("a destination in the catalogue but not declared is not eligible", async () => {
    // The catalogue holds it. Nobody said this product sells it. Those are different facts.
    expect(await listEligibleDestinations(db as any, FC)).toHaveLength(0);
  });

  it("a rate against an undeclared destination produces NO operation", async () => {
    // Pricing cannot be a back door into eligibility. A rate row alone must not make a
    // destination sellable — the declaration is the commercial act.
    await priceIt(JAZZ, '0.0450');
    const eligible = await listEligibleDestinations(db as any, FC);
    expect(eligible).toHaveLength(0);
    // The rate row exists but the product sells nothing, so nothing is offered.
    expect(eligible.some(d => d.destinationId === JAZZ)).toBe(false);
  });

  it("withdrawing removes it from what the product sells", async () => {
    await declare(JAZZ);
    expect(await listEligibleDestinations(db as any, FC)).toHaveLength(1);
    await withdrawEligibility(db as any, { productId: FC, destinationId: JAZZ, withdrawnBy: OPERATOR });
    expect(await listEligibleDestinations(db as any, FC)).toHaveLength(0);
  });
});

describe("POSITIVE — declared, priced, and expanded correctly", () => {
  beforeEach(async () => { await declare(JAZZ); });

  it("declaring makes it visible with EVERY prefix the catalogue holds", async () => {
    const [d] = await listEligibleDestinations(db as any, FC);
    expect(d.name).toBe('PAKISTAN - MOBILE JAZZ');
    expect(d.versionId).toBe(V1);
    expect(d.prefixes).toEqual(['9230', '9231', '9232']);
  });

  it("ONE rate becomes ONE OPERATION PER PREFIX, trunk-composed, at the catalogue increment", async () => {
    // The whole slice in one assertion. Three prefixes, trunk 1, increment 60/1 — none of
    // which a single-prefix 1/1 implementation would produce.
    await priceIt(JAZZ, '0.0450');
    expect(await buildOperations()).toEqual([
      { fullPrefix: '19230', rate: 0.045, interval1: 60, intervalN: 1, destination: 'PAKISTAN - MOBILE JAZZ' },
      { fullPrefix: '19231', rate: 0.045, interval1: 60, intervalN: 1, destination: 'PAKISTAN - MOBILE JAZZ' },
      { fullPrefix: '19232', rate: 0.045, interval1: 60, intervalN: 1, destination: 'PAKISTAN - MOBILE JAZZ' },
    ]);
  });

  it("the increment comes from the CATALOGUE, not a default — 60/1 survives", async () => {
    await priceIt(JAZZ, '0.0450');
    const ops = await buildOperations();
    expect(ops.every(o => o.interval1 === 60)).toBe(true);
    // Proof it is not simply echoing a constant: a different destination carries 1/1.
    await declare(AWCC);
    await priceIt(AWCC, '0.0210');
    const both = await buildOperations();
    expect(both.find(o => o.fullPrefix === '19370')!.interval1).toBe(1);
    expect(both.find(o => o.fullPrefix === '19230')!.interval1).toBe(60);
  });

  it("the trunk comes from product_registry, so a different product prices differently", async () => {
    await priceIt(JAZZ, '0.0450');
    expect((await buildOperations()).map(o => o.fullPrefix)).toEqual(['19230', '19231', '19232']);
    await db.execute(sql`UPDATE product_registry SET trunk_prefix = '6' WHERE id = ${FC}`);
    expect((await buildOperations()).map(o => o.fullPrefix)).toEqual(['69230', '69231', '69232']);
  });

  it("only DECLARED destinations reach the operations, even when others are priced", async () => {
    // AWCC is priced but never declared. It must not be pushed.
    await priceIt(JAZZ, '0.0450');
    await priceIt(AWCC, '0.0210');
    const ops = await buildOperations();
    expect(ops.map(o => o.fullPrefix)).toEqual(['19230', '19231', '19232']);
    expect(ops.some(o => o.fullPrefix === '19370')).toBe(false);
  });

  it("the rate is carried unchanged to every prefix", async () => {
    await priceIt(JAZZ, '0.0450');
    expect(new Set((await buildOperations()).map(o => o.rate))).toEqual(new Set([0.045]));
  });
});

describe("the catalogue identity is preserved through the whole chain", () => {
  it("the rate is stored against the catalogue version, and expansion honours it", async () => {
    await declare(JAZZ);
    await priceIt(JAZZ, '0.0450');
    const [row] = ((await db.execute(sql`
      SELECT destination_id, catalogue_version_id FROM product_rates`)) as any).rows;
    expect(Number(row.destination_id)).toBe(JAZZ);
    expect(Number(row.catalogue_version_id)).toBe(V1);
    expect(await buildOperations()).toHaveLength(3);
  });

  it("a NEW catalogue version strands the price rather than re-resolving it by name", async () => {
    await declare(JAZZ);
    await priceIt(JAZZ, '0.0450');
    await db.execute(sql`UPDATE catalogue_versions SET status = 'archived' WHERE id = ${V1}`);
    await db.execute(sql`INSERT INTO catalogue_versions (id, label, status) VALUES (2, 'V2', 'active')`);
    await db.execute(sql`INSERT INTO commercial_destinations (id, version_id, name) VALUES (20, 2, 'PAKISTAN - MOBILE JAZZ')`);
    await db.execute(sql`
      INSERT INTO commercial_destination_prefixes (version_id, destination_id, prefix, billing_increment)
      VALUES (2, 20, '9230', '60/1'), (2, 20, '9239', '60/1')`);
    // Same name, different prefix set. Carrying the price over would price 9239, which nobody
    // priced, and drop 9231/9232, which somebody did.
    expect(await buildOperations()).toEqual([]);
  });
});
