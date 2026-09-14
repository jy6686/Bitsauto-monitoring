/**
 * PRICING ACCEPTANCE — the FC × AWCC case, end to end, against a real database.
 *
 * The production state this mirrors exactly: catalogue version 1 active, AWCC (destination 3)
 * holding 9370 and 9371 at increment 60/1, First Class (product 1, trunk "1") declared eligible
 * for it, and `product_rates` empty.
 *
 * Migration 514 and 515 are read OFF DISK and executed, so what is asserted is the schema that
 * was actually deployed to neondb rather than a hand-built approximation of it. A pricing test
 * built on an invented schema proves the test's schema works.
 *
 * WHAT THIS FILE IS FOR. Pricing is the stage where a commercial commitment first acquires a
 * number, and the ways it can go wrong are quiet ones: a price that covers one prefix of a
 * destination instead of all of them, a price against a destination nobody declared, a customer
 * shown the switch-side prefix. None of those throw. Each is asserted here.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expandRates, activeCatalogueVersionId } from "./rate-prefix-expansion";
import { grantEligibility, withdrawEligibility, eligibilityStanding } from "../products/eligibility-store";
import { lookupCatalogueIncrements } from "./catalogue-increments";

const migration = (f: string) =>
  readFileSync(join(__dirname, '..', '..', '..', 'migrations', f), 'utf8');

const FC = 1;      // First Class, trunk "1"
const BC = 3;      // Business Class — declared nothing, and stays that way
const AWCC = 3;    // AFGHANISTAN - MOBILE AWCC, prefixes 9370 + 9371
const ZONG = 891;  // in the catalogue, never declared for any product
const V1 = 1;

let client: PGlite;
let db: ReturnType<typeof drizzle>;
const one = async (q: any) => ((await db.execute(q)) as any).rows[0];
const all = async (q: any) => ((await db.execute(q)) as any).rows;

beforeEach(async () => {
  client = await PGlite.create();
  db = drizzle(client);

  // What the platform already holds when 514 runs.
  // client.exec, not db.execute: drizzle sends prepared statements, which cannot carry multiple
  // commands, and the migration files are many commands each.
  await client.exec(`
    CREATE TABLE catalogue_versions (
      id SERIAL PRIMARY KEY, label TEXT NOT NULL, status TEXT NOT NULL);
    CREATE TABLE commercial_destinations (
      id SERIAL PRIMARY KEY,
      version_id INTEGER NOT NULL REFERENCES catalogue_versions(id),
      name TEXT NOT NULL, approval_status TEXT NOT NULL DEFAULT 'approved');
    CREATE TABLE commercial_destination_prefixes (
      id SERIAL PRIMARY KEY,
      version_id INTEGER NOT NULL REFERENCES catalogue_versions(id),
      destination_id INTEGER NOT NULL REFERENCES commercial_destinations(id),
      prefix TEXT NOT NULL, billing_increment TEXT,
      UNIQUE (version_id, prefix));
    CREATE TABLE product_registry (
      id SERIAL PRIMARY KEY, code VARCHAR(16) UNIQUE NOT NULL, name VARCHAR(64) NOT NULL,
      trunk_prefix VARCHAR(8), segment VARCHAR(32), status VARCHAR(16) NOT NULL DEFAULT 'commercial');
    CREATE TABLE product_destination_assignments (
      id SERIAL PRIMARY KEY, product_id INTEGER NOT NULL, destination_id INTEGER NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'active');
    CREATE TABLE product_rates (
      id SERIAL PRIMARY KEY, product_id INTEGER NOT NULL, destination_id INTEGER,
      prefix VARCHAR(32), rate NUMERIC(12,6) NOT NULL DEFAULT 0, currency VARCHAR(8) DEFAULT 'USD',
      effective_from DATE NOT NULL DEFAULT CURRENT_DATE, effective_to DATE,
      notes TEXT, created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW());
  `);

  // The real migrations, in order, off disk.
  await client.exec(migration('514_product_destination_eligibility.sql'));
  await client.exec(migration('515_product_rate_catalogue_identity.sql'));

  // Production's own facts.
  await db.execute(sql`INSERT INTO catalogue_versions (id, label, status) VALUES
    (1, 'Supplier Catalogue V1', 'active'), (2, 'Supplier Catalogue V2', 'draft')`);
  await db.execute(sql`INSERT INTO product_registry (id, code, name, trunk_prefix) VALUES
    (1, 'FC', 'First Class', '1'), (3, 'BC', 'Business Class', '2')`);
  await db.execute(sql`INSERT INTO commercial_destinations (id, version_id, name, approval_status) VALUES
    (3,   1, 'AFGHANISTAN - MOBILE AWCC', 'approved'),
    (891, 1, 'PAKISTAN - MOBILE ZONG',    'approved')`);
  await db.execute(sql`INSERT INTO commercial_destination_prefixes (version_id, destination_id, prefix, billing_increment) VALUES
    (1, 3,   '9370', '60/1'),
    (1, 3,   '9371', '60/1'),
    (1, 891, '9230', '1/1')`);

  // FC × AWCC, exactly as declared in production on 2026-09-14.
  await grantEligibility(db as any, { productId: FC, destinationId: AWCC, grantedBy: 'junaid' });
});

afterEach(async () => { await client?.close(); });

/** Price something, the way the API writes it: destination + the version that names its id space. */
const price = (productId: number, destinationId: number | null, rate: string,
               opts: { versionId?: number | null; prefix?: string | null } = {}) =>
  db.execute(sql`
    INSERT INTO product_rates (product_id, destination_id, catalogue_version_id, prefix, rate, effective_from)
    VALUES (${productId}, ${destinationId}, ${opts.versionId === undefined ? V1 : opts.versionId},
            ${opts.prefix ?? null}, ${rate}, CURRENT_DATE)
    RETURNING *`);

const expand = async (rows: any[]) =>
  expandRates(db as any, rows, await activeCatalogueVersionId(db as any, sql as any), sql as any);

const priced = async (productId: number) =>
  (await all(sql`SELECT id, product_id AS "productId", destination_id AS "destinationId",
                        catalogue_version_id AS "catalogueVersionId", prefix, rate
                   FROM product_rates WHERE product_id = ${productId}`))
    .map((r: any) => ({ ...r, productId: Number(r.productId), destinationId: r.destinationId === null ? null : Number(r.destinationId),
                        catalogueVersionId: r.catalogueVersionId === null ? null : Number(r.catalogueVersionId) }));

describe("THE ACCEPTANCE: FC × AWCC priced once, covering the whole destination", () => {
  it("persists the catalogue identity AND the version that names its id space", async () => {
    await price(FC, AWCC, '0.045000');
    const [row] = await priced(FC);
    expect(row.destinationId).toBe(AWCC);
    // Without this the id is ambiguous — rates.step.ts reads destination_id as a
    // global_destinations id, Rate Manager writes it as a commercial_destinations id.
    expect(row.catalogueVersionId).toBe(V1);
  });

  it("ONE price expands to EXACTLY 9370 and 9371 — the destination's whole set", async () => {
    await price(FC, AWCC, '0.045000');
    const [e] = await expand(await priced(FC));
    expect(e.verdict).toBe('catalogue');
    expect(e.prefixes).toEqual(['9370', '9371']);
    expect(e.destinationName).toBe('AFGHANISTAN - MOBILE AWCC');
  });

  it("NO CATALOGUE PREFIX IS LOST: the expansion covers every prefix the catalogue holds", async () => {
    await price(FC, AWCC, '0.045000');
    const [e] = await expand(await priced(FC));
    const held = (await all(sql`SELECT prefix FROM commercial_destination_prefixes
                                 WHERE destination_id = ${AWCC} ORDER BY prefix`)).map((r: any) => String(r.prefix));
    // Asserted against the catalogue itself rather than a literal, so adding a third prefix to
    // AWCC tomorrow fails this test instead of silently dropping it from every price.
    expect(e.prefixes.slice().sort()).toEqual(held);
  });

  it("carries the increment the catalogue states — 60/1, not a default", async () => {
    const inc = await lookupCatalogueIncrements(db as any, ['9370', '9371']);
    expect(inc.get('9370')).toBe('60/1');
    expect(inc.get('9371')).toBe('60/1');
  });

  it("the price is ONE row, not one per prefix", async () => {
    await price(FC, AWCC, '0.045000');
    // Two rows would be two prices to keep in step, and the second one to change silently wins.
    expect((await priced(FC)).length).toBe(1);
  });
});

describe("NO UNDECLARED DESTINATION CAN BE PRICED INTO A PUSH", () => {
  it("a price for a destination the product does not sell is REFUSED as not_eligible", async () => {
    await price(FC, ZONG, '0.021000');   // Zong is in the catalogue; FC never declared it
    const [e] = await expand((await priced(FC)).map(r => ({ ...r, productId: FC })));
    expect(e.verdict).toBe('not_eligible');
    expect(e.prefixes).toEqual([]);
  });

  it("WITHDRAWING eligibility stops the existing price reaching a push", async () => {
    await price(FC, AWCC, '0.045000');
    expect((await expand((await priced(FC)).map(r => ({ ...r, productId: FC }))))[0].verdict).toBe('catalogue');

    await withdrawEligibility(db as any, { productId: FC, destinationId: AWCC, withdrawnBy: 'junaid' });

    // The rate row is untouched — withdrawing is a commercial decision about SELLING, not an
    // instruction to delete a price. It simply stops being uploadable.
    const [e] = await expand((await priced(FC)).map(r => ({ ...r, productId: FC })));
    expect(e.verdict).toBe('not_eligible');
    expect((await priced(FC)).length).toBe(1);
  });

  it("eligibility is PER PRODUCT: FC's declaration does not let BC price AWCC", async () => {
    await price(BC, AWCC, '0.050000');
    const [e] = await expand((await priced(BC)).map(r => ({ ...r, productId: BC })));
    expect(e.verdict).toBe('not_eligible');
  });

  it("a price against a NON-ACTIVE version is refused, never re-resolved by name", async () => {
    await db.execute(sql`INSERT INTO commercial_destinations (id, version_id, name) VALUES (777, 2, 'AFGHANISTAN - MOBILE AWCC')`);
    await price(FC, 777, '0.045000', { versionId: 2 });
    const [e] = await expand((await priced(FC)).map(r => ({ ...r, productId: FC })));
    // Same NAME in V2. Resolving by name would let a version rollover silently re-point a price.
    expect(e.verdict).toBe('stale_version');
    expect(e.prefixes).toEqual([]);
  });
});

describe("THE PRESENTATION BOUNDARY holds at the pricing layer", () => {
  it("the stored destination code is 9370 — the trunk-composed 19370 is NOT the destination", async () => {
    await price(FC, AWCC, '0.045000');
    const [e] = await expand(await priced(FC));
    // 19370 is what the SWITCH is given: FC's trunk "1" + dial prefix 9370. It exists in Sippy
    // tariff 64. It is not a destination code and must never be stored or shown as one.
    for (const p of e.prefixes) {
      expect(p).not.toMatch(/^1937/);
      expect(p.startsWith('1')).toBe(false);
    }
    expect(e.prefixes).toContain('9370');
  });

  it("no row in product_rates carries a trunk-composed prefix", async () => {
    await price(FC, AWCC, '0.045000');
    const rows = await priced(FC);
    for (const r of rows) {
      if (r.prefix) expect(String(r.prefix)).not.toBe('19370');
    }
  });
});

describe("PRICING IS NOT PUSHING, AND NOT TELLING", () => {
  /**
   * Asserted against the source, because the property is the ABSENCE of a call and no runtime
   * assertion can prove an absence the way reading the module can. Comments are stripped first:
   * a previous version of this check matched the word in a comment explaining why it must not
   * appear, and passed for the wrong reason.
   */
  const strip = (t: string) => t.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const ROUTES = strip(readFileSync(join(__dirname, '..', '..', 'routes-rate-manager.ts'), 'utf8'));
  const CREATE = (() => {
    const at = ROUTES.indexOf("app.post('/api/product-rates'");
    expect(at, 'the pricing route must exist').toBeGreaterThan(-1);
    // Bounded at the NEXT route registration, not a character count: a fixed window reads the
    // neighbours' code and reports it as this route's.
    const end = ROUTES.indexOf("app.put('/api/product-rates/:id'", at);
    expect(end, 'the pricing route must be followed by the update route').toBeGreaterThan(at);
    return ROUTES.slice(at, end);
  })();

  it("saving a price does not touch Sippy", async () => {
    for (const forbidden of ['pushRateToSippy', 'uploadRatesWorkbook', 'pushRateViaPortalUpload', 'sippyPost', 'getUploadToken']) {
      expect(CREATE, forbidden).not.toContain(forbidden);
    }
  });

  it("saving a price does not notify anybody", async () => {
    for (const forbidden of ['sendEmail', 'nodemailer', 'rate_push_notifications', 'deliverRateNotifications', 'createObligationsForPush']) {
      expect(CREATE, forbidden).not.toContain(forbidden);
    }
  });

  it("saving a price writes to product_rates and nothing else", async () => {
    await price(FC, AWCC, '0.045000');
    // The one commercial side effect a price is allowed to have is being a price.
    expect((await one(sql`SELECT count(*)::int AS n FROM product_destination_eligibility`)).n).toBe(1);
    expect((await one(sql`SELECT count(*)::int AS n FROM product_rates`)).n).toBe(1);
  });
});

/**
 * THE GATE AT THE WRITE, not only at the push.
 *
 * Found while building this acceptance: `POST /api/product-rates` verified that a destination
 * was in the catalogue and that the version was active, and never asked whether the product was
 * declared to sell it. The expansion refused such a row later as `not_eligible`, so nothing
 * unsold could reach a switch — but the refusal arrived at PUSH time, to whoever was running the
 * push, about a decision somebody else made days earlier. `PUT` was worse: it repointed
 * `destinationId` with no catalogue, version or eligibility check at all, so every check on the
 * create path could be stepped around with a second request.
 *
 * The dropdown offering only declared destinations was never a gate. It is one client of an open
 * endpoint.
 */
describe("pricing refuses an undeclared destination AT THE WRITE", () => {
  it("standing distinguishes never-declared from withdrawn, because they are different facts", async () => {
    expect(await eligibilityStanding(db as any, FC, ZONG)).toEqual({ eligible: false, reason: 'never_declared' });

    const declared = await eligibilityStanding(db as any, FC, AWCC);
    expect(declared.eligible).toBe(true);
    if (declared.eligible) expect(declared.declaredBy).toBe('junaid');

    await withdrawEligibility(db as any, { productId: FC, destinationId: AWCC, withdrawnBy: 'junaid' });
    const gone = await eligibilityStanding(db as any, FC, AWCC);
    expect(gone.eligible).toBe(false);
    // An operator meeting the refusal can be pointed at whose decision it was.
    if (!gone.eligible && gone.reason === 'withdrawn') expect(gone.withdrawnBy).toBe('junaid');
    else throw new Error('expected a withdrawn standing');
  });

  it("the CREATE route consults eligibility before writing", () => {
    const strip = (t: string) => t.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    const src = strip(readFileSync(join(__dirname, '..', '..', 'routes-rate-manager.ts'), 'utf8'));
    const at = src.indexOf("app.post('/api/product-rates'");
    const end = src.indexOf("app.put('/api/product-rates/:id'", at);
    const create = src.slice(at, end);
    // The GUARD, verbatim and unconditional — not merely that the symbol appears. A presence
    // check passes against `if (false && !standing.eligible)`, which is exactly how a disabled
    // gate reads. Anchoring on the expression means disabling it has to change this line.
    expect(create).toContain('const standing = await eligibilityStanding(db as any, Number(productId), Number(destinationId));');
    expect(create).toContain('if (!standing.eligible) {');
    expect(create).toContain('return res.status(409).json({');
    // Before the insert, not after: a row written and then refused is a row that exists.
    expect(create.indexOf('eligibilityStanding')).toBeLessThan(create.indexOf('db.insert(productRates)'));
  });

  it("the UPDATE route re-checks when a price is repointed", () => {
    const strip = (t: string) => t.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    const src = strip(readFileSync(join(__dirname, '..', '..', 'routes-rate-manager.ts'), 'utf8'));
    const at = src.indexOf("app.put('/api/product-rates/:id'");
    const end = src.indexOf("app.delete('/api/product-rates/:id'", at);
    const update = src.slice(at, end);
    expect(update).toContain('const standing = await eligibilityStanding(db as any, Number(current.product_id), Number(destinationId));');
    expect(update).toContain('if (!standing.eligible) {');
    expect(update.indexOf('eligibilityStanding')).toBeLessThan(update.indexOf('db.update(productRates)'));
  });

  it("a LEGACY row keeps its behaviour — this is not a migration path", async () => {
    // A row with no catalogue_version_id prices the single prefix it carries, exactly as before.
    // Refusing those would break every rate written before migration 515.
    await price(FC, null, '0.030000', { versionId: null, prefix: '880' });
    const [e] = await expand((await priced(FC)).map(r => ({ ...r, productId: FC })));
    expect(e.verdict).toBe('legacy_prefix');
    expect(e.prefixes).toEqual(['880']);
  });
});
