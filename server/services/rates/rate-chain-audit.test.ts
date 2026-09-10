/**
 * THE WHOLE CHAIN, END TO END: migration 515 → expansion → the workbook that reaches Sippy.
 *
 * The pieces are covered elsewhere. What is established here is that they compose — that a price
 * entered in Rate Manager arrives in the uploaded workbook as every prefix it covers and nothing
 * else. This is driven through the REAL resolveDefaultRates against a real Postgres (PGlite), not
 * a re-implementation of it, because a re-implementation would keep passing after the real one
 * drifted.
 *
 * The workbook is then parsed back out of the XLSX buffer, so the assertion is about the bytes
 * that would be uploaded rather than the intermediate array.
 *
 * rates.step.ts is a LIVE Sippy write path — it is registered in SLICE_STEPS and calls
 * uploadRatesWorkbook — so the last group asserts the mutation-boundary semantics that make an
 * indeterminate upload distinguishable from one that never left the process.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as XLSX from "xlsx";

const V1 = 1, V2 = 2;
const AWCC = 10, JAZZ = 11, BD = 12;
const FC = 1;                          // First Class Wholesale, trunk 1

let client: PGlite;
let realDb: any;
const holder: { db: any } = { db: null };

// The service imports `db` at module scope. Pointing that at PGlite is what makes this the real
// code path rather than a copy of it.
vi.mock("../../db", () => ({ get db() { return holder.db; } }));

let resolveDefaultRates: typeof import("./rate-upload.service")["resolveDefaultRates"];
let buildBulkRateXlsx:   typeof import("./rate-matrix")["buildBulkRateXlsx"];

/** The uploaded bytes, read back as {prefix, rate} — what Sippy's importer would see. */
const workbookRows = (buf: Buffer) => {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const aoa: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
  return aoa.slice(1).map(r => ({ prefix: String(r[2]), rate: Number(r[6]) }));
};

/** A fixed date so the effective-dating filter is never today-dependent. */
const AS_OF = new Date('2026-09-10T00:00:00Z');

const priceIt = (o: { destinationId?: number | null; versionId?: number | null; prefix?: string | null; rate: number }) =>
  realDb.execute(sql`
    INSERT INTO product_rates (product_id, destination_id, catalogue_version_id, prefix, rate, effective_from)
    VALUES (${FC}, ${o.destinationId ?? null}, ${o.versionId ?? null}, ${o.prefix ?? null}, ${String(o.rate)}, '2020-01-01')`);

beforeAll(async () => {
  client = await PGlite.create();
  realDb = drizzle(client);
  holder.db = realDb;

  await client.exec(`
    CREATE TABLE catalogue_versions (id SERIAL PRIMARY KEY, label TEXT NOT NULL UNIQUE, status TEXT NOT NULL);
    CREATE TABLE commercial_destinations (
      id SERIAL PRIMARY KEY,
      version_id INTEGER NOT NULL REFERENCES catalogue_versions(id) ON DELETE CASCADE,
      name TEXT NOT NULL, approval_status TEXT NOT NULL DEFAULT 'approved',
      UNIQUE (version_id, name));
    CREATE TABLE commercial_destination_prefixes (
      id SERIAL PRIMARY KEY,
      version_id INTEGER NOT NULL REFERENCES catalogue_versions(id) ON DELETE CASCADE,
      destination_id INTEGER NOT NULL REFERENCES commercial_destinations(id) ON DELETE CASCADE,
      prefix TEXT NOT NULL);
    CREATE TABLE product_registry (
      id SERIAL PRIMARY KEY, code VARCHAR(16) UNIQUE NOT NULL, name VARCHAR(64) NOT NULL,
      trunk_prefix VARCHAR(8), segment VARCHAR(32), status VARCHAR(16) NOT NULL DEFAULT 'draft');
    CREATE TABLE product_rates (
      id SERIAL PRIMARY KEY, product_id INTEGER NOT NULL, destination_id INTEGER,
      prefix VARCHAR(32), rate NUMERIC(12,6) NOT NULL DEFAULT 0,
      currency VARCHAR(8) NOT NULL DEFAULT 'USD',
      effective_from DATE NOT NULL, effective_to DATE, notes TEXT,
      created_by VARCHAR(128), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.exec(readFileSync(join(__dirname, '..', '..', '..', 'migrations', '515_product_rate_catalogue_identity.sql'), 'utf8'));

  ({ resolveDefaultRates } = await import("./rate-upload.service"));
  ({ buildBulkRateXlsx }   = await import("./rate-matrix"));
});
afterAll(async () => { await client?.close(); });

beforeEach(async () => {
  await client.exec(`
    DELETE FROM product_rates; DELETE FROM commercial_destination_prefixes;
    DELETE FROM commercial_destinations; DELETE FROM catalogue_versions; DELETE FROM product_registry;`);
  await realDb.execute(sql`
    INSERT INTO product_registry (id, code, name, trunk_prefix, status)
    VALUES (${FC}, 'FC', 'First Class Wholesale', '1', 'commercial')`);
  await realDb.execute(sql`INSERT INTO catalogue_versions (id, label, status) VALUES (${V1}, 'V1', 'active')`);
  await realDb.execute(sql`
    INSERT INTO commercial_destinations (id, version_id, name) VALUES
      (${AWCC}, ${V1}, 'AFGHANISTAN - MOBILE AWCC'),
      (${JAZZ}, ${V1}, 'PAKISTAN - MOBILE JAZZ'),
      (${BD},   ${V1}, 'BANGLADESH - FIXED')`);
  await realDb.execute(sql`
    INSERT INTO commercial_destination_prefixes (version_id, destination_id, prefix) VALUES
      (${V1}, ${AWCC}, '9370'), (${V1}, ${AWCC}, '9371'),
      (${V1}, ${JAZZ}, '9230')`);   // BD has none, on purpose
});

// ── 1. Legacy rows are unchanged ─────────────────────────────────────────────
describe("1 — legacy rows keep their exact historical behaviour", () => {
  it("a NULL catalogue_version_id row prices the one prefix it names", async () => {
    await priceIt({ prefix: '92', rate: 0.05 });
    const d = await resolveDefaultRates({ asOf: AS_OF } as any);
    expect(d.rows).toEqual([{ prefix: '192', rate: 0.05 }]);   // trunk 1 + 92
    expect(d.refusals).toEqual([]);
  });

  it("a legacy destination_id that collides with a catalogue id does NOT expand", async () => {
    // THE DEFECT. AWCC's catalogue id is 10; a legacy global_destinations id of 10 must price
    // only '92' and must never reach 9370/9371.
    await priceIt({ destinationId: AWCC, prefix: '92', rate: 0.05 });
    const d = await resolveDefaultRates({ asOf: AS_OF } as any);
    expect(d.rows.map(r => r.prefix)).toEqual(['192']);
    expect(d.rows.map(r => r.prefix)).not.toContain('19370');
  });
});

// ── 2. Catalogue rows expand ─────────────────────────────────────────────────
describe("2 — a catalogue-backed price covers every prefix of its destination", () => {
  it("one price becomes one row per prefix, trunk-composed", async () => {
    await priceIt({ destinationId: AWCC, versionId: V1, prefix: '9370', rate: 0.021 });
    const d = await resolveDefaultRates({ asOf: AS_OF } as any);
    expect(d.rows).toEqual([
      { prefix: '19370', rate: 0.021 },
      { prefix: '19371', rate: 0.021 },   // this is the one that used to be silently dropped
    ]);
  });

  it("the per-product count reflects prefixes, not priced rows", async () => {
    // "FC 1" on a 2-prefix destination would understate what was uploaded.
    await priceIt({ destinationId: AWCC, versionId: V1, rate: 0.021 });
    const d = await resolveDefaultRates({ asOf: AS_OF } as any);
    expect(d.byProduct[0].count).toBe(2);
  });

  it("mixes catalogue and legacy rows in one matrix without cross-contamination", async () => {
    await priceIt({ destinationId: AWCC, versionId: V1, rate: 0.021 });
    await priceIt({ prefix: '880', rate: 0.09 });
    const d = await resolveDefaultRates({ asOf: AS_OF } as any);
    expect(d.rows.map(r => r.prefix).sort()).toEqual(['1880', '19370', '19371']);
  });
});

// ── 3. Version rollover ──────────────────────────────────────────────────────
describe("3 — V1 → V2 produces a deterministic stale_version refusal", () => {
  beforeEach(async () => {
    await realDb.execute(sql`UPDATE catalogue_versions SET status = 'archived' WHERE id = ${V1}`);
    await realDb.execute(sql`INSERT INTO catalogue_versions (id, label, status) VALUES (${V2}, 'V2', 'active')`);
    await realDb.execute(sql`INSERT INTO commercial_destinations (id, version_id, name) VALUES (20, ${V2}, 'AFGHANISTAN - MOBILE AWCC')`);
    await realDb.execute(sql`INSERT INTO commercial_destination_prefixes (version_id, destination_id, prefix) VALUES (${V2}, 20, '9370'), (${V2}, 20, '9372')`);
  });

  it("uploads nothing for the V1 price and says why", async () => {
    await priceIt({ destinationId: AWCC, versionId: V1, prefix: '9370', rate: 0.021 });
    const d = await resolveDefaultRates({ asOf: AS_OF } as any);
    expect(d.rows).toEqual([]);
    expect(d.refusals.join(' ')).toContain('stale_version');
    expect(d.productsWithoutRates.map(p => p.code)).toContain('FC');
  });

  it("does not inherit V2's different prefix set", async () => {
    // V2's same-named destination covers 9372, which V1's did not.
    await priceIt({ destinationId: AWCC, versionId: V1, rate: 0.021 });
    const d = await resolveDefaultRates({ asOf: AS_OF } as any);
    expect(d.rows.map(r => r.prefix)).not.toContain('19372');
  });

  it("is deterministic — the same input refuses identically twice", async () => {
    await priceIt({ destinationId: AWCC, versionId: V1, rate: 0.021 });
    const a = await resolveDefaultRates({ asOf: AS_OF } as any);
    const b = await resolveDefaultRates({ asOf: AS_OF } as any);
    expect(a.refusals).toEqual(b.refusals);
    expect(a.rows).toEqual(b.rows);
  });

  it("a price RE-SET against V2 uploads V2's prefixes", async () => {
    await priceIt({ destinationId: 20, versionId: V2, rate: 0.021 });
    const d = await resolveDefaultRates({ asOf: AS_OF } as any);
    expect(d.rows.map(r => r.prefix).sort()).toEqual(['19370', '19372']);
  });
});

// ── 4. No catalogue id reaches a legacy lookup ───────────────────────────────
describe("4 — no catalogue id reaches a global_destinations lookup", () => {
  const STEP = readFileSync(join(__dirname, '..', 'provisioning', 'steps', 'rates.step.ts'), 'utf8')
    .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

  it("the id spaces are split BEFORE the legacy resolution runs", () => {
    // Order is the property. Splitting after the lookup would be too late.
    expect(STEP.indexOf('const legacyPriced')).toBeGreaterThan(-1);
    expect(STEP.indexOf('const legacyPriced')).toBeLessThan(STEP.indexOf('byDialPrefix.get'));
  });

  it("the legacy resolution is fed legacyPriced, never the full priced set", () => {
    expect(STEP).toContain('legacyPriced.map');
    expect(STEP).not.toMatch(/=\s*priced\.map\(/);
  });

  it("rate-upload.service never touches global_destinations at all", () => {
    expect(readFileSync(join(__dirname, 'rate-upload.service.ts'), 'utf8')).not.toContain('globalDestinations');
  });
});

// ── 5 & 7. The workbook, and the operation count ─────────────────────────────
describe("5 & 7 — the uploaded workbook carries every expanded prefix", () => {
  it("the XLSX bytes contain one row per prefix, at the priced rate", async () => {
    await priceIt({ destinationId: AWCC, versionId: V1, rate: 0.021 });
    await priceIt({ destinationId: JAZZ, versionId: V1, rate: 0.048 });
    const d = await resolveDefaultRates({ asOf: AS_OF } as any);

    // Parsed back out of the buffer that would be uploaded.
    const parsed = workbookRows(buildBulkRateXlsx(d.rows));
    expect(parsed).toEqual([
      { prefix: '19370', rate: 0.021 },
      { prefix: '19371', rate: 0.021 },
      { prefix: '19230', rate: 0.048 },
    ]);
  });

  it("2 destinations priced → 3 operations, because one of them holds 2 prefixes", async () => {
    // The count is the thing an operator reads on the run report. "2 rates" would be wrong.
    await priceIt({ destinationId: AWCC, versionId: V1, rate: 0.021 });
    await priceIt({ destinationId: JAZZ, versionId: V1, rate: 0.048 });
    const d = await resolveDefaultRates({ asOf: AS_OF } as any);
    expect(d.rows).toHaveLength(3);
    expect(workbookRows(buildBulkRateXlsx(d.rows))).toHaveLength(3);
  });

  it("a refused price contributes no workbook row", async () => {
    await priceIt({ destinationId: BD, versionId: V1, rate: 0.09 });   // BD holds no prefixes
    const d = await resolveDefaultRates({ asOf: AS_OF } as any);
    expect(d.rows).toEqual([]);
    // And the empty workbook is refused outright rather than uploaded as a REPLACE of nothing.
    expect(() => buildBulkRateXlsx(d.rows)).toThrow(/refusing to build an empty workbook/);
  });
});

// ── 6. Refusal reporting ─────────────────────────────────────────────────────
describe("6 — refusals are reported, grouped by cause", () => {
  it("names the product and the cause", async () => {
    await priceIt({ destinationId: BD, versionId: V1, rate: 0.09 });
    const d = await resolveDefaultRates({ asOf: AS_OF } as any);
    expect(d.refusals).toHaveLength(1);
    expect(d.refusals[0]).toMatch(/^FC: /);
    expect(d.refusals[0]).toContain('no_prefixes');
  });

  it("groups many rows of one cause into one line", async () => {
    await realDb.execute(sql`UPDATE catalogue_versions SET status = 'archived' WHERE id = ${V1}`);
    await realDb.execute(sql`INSERT INTO catalogue_versions (id, label, status) VALUES (${V2}, 'V2', 'active')`);
    for (let i = 0; i < 20; i++) await priceIt({ destinationId: AWCC, versionId: V1, rate: 0.02 });
    const d = await resolveDefaultRates({ asOf: AS_OF } as any);
    expect(d.refusals).toHaveLength(1);
    expect(d.refusals[0]).toContain('20 price(s) not uploaded');
  });

  it("separates two different causes into two lines", async () => {
    await priceIt({ destinationId: BD,   versionId: V1, rate: 0.09 });   // no_prefixes
    await priceIt({ destinationId: 7777, versionId: V1, rate: 0.09 });   // unknown_destination
    const d = await resolveDefaultRates({ asOf: AS_OF } as any);
    expect(d.refusals).toHaveLength(2);
    expect(d.refusals.join(' ')).toContain('no_prefixes');
    expect(d.refusals.join(' ')).toContain('unknown_destination');
  });

  it("a fully successful resolve reports no refusals", async () => {
    await priceIt({ destinationId: AWCC, versionId: V1, rate: 0.021 });
    expect((await resolveDefaultRates({ asOf: AS_OF } as any)).refusals).toEqual([]);
  });
});

// ── 8. Mutation boundary on the live upload path ─────────────────────────────
describe("8 — the mutation boundary covers the workbook upload", () => {
  const SIPPY = readFileSync(join(__dirname, '..', '..', 'sippy.ts'), 'utf8');
  const UPLOAD = (() => {
    const a = SIPPY.indexOf('export async function uploadRatesWorkbook(');
    return SIPPY.slice(a, SIPPY.indexOf('\nexport ', a + 10));
  })();
  const code = (t: string) => t.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const STEP = code(readFileSync(join(__dirname, '..', 'provisioning', 'steps', 'rates.step.ts'), 'utf8'));

  it("uploadRatesWorkbook owns a boundary and reports refusedBeforeWrite", () => {
    // rates.step.ts is a LIVE Sippy write path — SLICE_STEPS registers it and it uploads.
    // Before this it had no boundary at all.
    expect(code(UPLOAD)).toContain('const boundary: MutationBoundary = { crossed: false }');
    expect(code(UPLOAD)).toContain('refusedBeforeWrite: !boundary.crossed');
  });

  it("crosses the boundary IMMEDIATELY BEFORE the upload, not after", () => {
    const cross  = UPLOAD.indexOf('boundary.crossed = true');
    const upload = UPLOAD.indexOf('await uploadBinaryFile(');
    expect(cross).toBeGreaterThan(-1);
    expect(upload).toBeGreaterThan(-1);
    // A request that then times out has still been sent.
    expect(cross).toBeLessThan(upload);
  });

  it("every return path reports the boundary, none can omit it", () => {
    // done() stamps it, so a new early return cannot silently drop the field.
    const returns = code(UPLOAD).match(/return (done\(|\{)/g) ?? [];
    expect(returns.length).toBeGreaterThan(3);
    expect(returns.every(r => r.startsWith('return done('))).toBe(true);
  });

  it("an unverified upload is INDETERMINATE, not a retryable failure", () => {
    // The workbook was sent; a sample that does not read back is not evidence nothing landed.
    expect(code(UPLOAD)).toContain("verdict: 'indeterminate' as const");
    expect(UPLOAD).toContain('must not be retried blindly');
  });

  it("a token failure stays a plain failure — nothing was sent", () => {
    const tokenFail = UPLOAD.slice(UPLOAD.indexOf('getUploadToken failed'));
    expect(tokenFail.slice(0, 200)).not.toContain('indeterminate');
  });

  it("rates.step gives the two outcomes different reason codes", () => {
    expect(STEP).toContain('RATE_UPLOAD_INDETERMINATE');
    expect(STEP).toContain('RATE_UPLOAD_FAILED');
    // Structural, never read off the message text.
    expect(STEP).toContain("res.verdict === 'indeterminate' || res.refusedBeforeWrite === false");
  });

  it("tells the operator, in words, which one is safe to re-run", () => {
    const raw = readFileSync(join(__dirname, '..', 'provisioning', 'steps', 'rates.step.ts'), 'utf8');
    expect(raw).toContain('must NOT be re-run blindly');
    expect(raw).toContain('re-running this step is safe');
  });
});
