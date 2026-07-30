import { describe, it, expect } from "vitest";
import {
  generateRateMatrix,
  type CatalogueDestination, type GeneratorProduct, type GeneratorRate,
} from "./matrix-generator";

const PRODUCTS: GeneratorProduct[] = [
  { id: 1, code: "FC", name: "First Class",     trunkPrefix: "1" },
  { id: 2, code: "BC", name: "Business Class",  trunkPrefix: "2" },
  { id: 6, code: "SB", name: "Special Bravo",   trunkPrefix: "6" },
  { id: 7, code: "SC", name: "Special Charlie", trunkPrefix: "7" },
];

const PK: CatalogueDestination = { id: 100, dialPrefix: "9233", name: "PAKISTAN MOBILE UFONE", country: "Pakistan", commercialStatus: "approved" };
const IN: CatalogueDestination = { id: 200, dialPrefix: "91",   name: "INDIA FIXED",           country: "India",    commercialStatus: "approved" };

const ratesFor = (destId: number, price = 0.04): GeneratorRate[] =>
  PRODUCTS.map(p => ({ destinationId: destId, productId: p.id, rate: price }));

describe("generateRateMatrix", () => {
  it("composes trunk + dial, which is the whole point", () => {
    const m = generateRateMatrix({ destinations: [PK], products: PRODUCTS, rates: ratesFor(100) });
    expect(m.rows.map(r => r.prefix).sort()).toEqual(["19233", "29233", "69233", "79233"]);
  });

  it("fans destinations across products", () => {
    const m = generateRateMatrix({
      destinations: [PK, IN], products: PRODUCTS,
      rates: [...ratesFor(100), ...ratesFor(200, 0.02)],
    });
    expect(m.rows).toHaveLength(8);
    expect(m.byProduct.map(p => p.count)).toEqual([2, 2, 2, 2]);
  });

  it("excludes a destination the catalogue has not approved, and says why", () => {
    // The rule this exists for: Sippy must never receive a prefix for an unapproved
    // destination, however it got priced.
    const blocked = { ...PK, commercialStatus: "blocked" };
    const m = generateRateMatrix({ destinations: [blocked], products: PRODUCTS, rates: ratesFor(100) });
    expect(m.rows).toHaveLength(0);
    expect(m.skipped[0]).toMatchObject({ reason: "not-approved" });
    expect(m.skipped[0].detail).toMatch(/"blocked"/);
  });

  it.each(["testing", "deprecated", "pending"])("also excludes status %s", (status) => {
    const m = generateRateMatrix({ destinations: [{ ...PK, commercialStatus: status }], products: PRODUCTS, rates: ratesFor(100) });
    expect(m.rows).toHaveLength(0);
  });

  it("reports an approved destination with no dial prefix rather than composing a bare trunk", () => {
    // Without this, product FC + no dial would emit prefix "1" — matching every call.
    const m = generateRateMatrix({ destinations: [{ ...PK, dialPrefix: null }], products: PRODUCTS, rates: ratesFor(100) });
    expect(m.rows).toHaveLength(0);
    expect(m.skipped[0].reason).toBe("no-dial-prefix");
  });

  it("reports a product with no trunk prefix per destination", () => {
    const products = [{ ...PRODUCTS[0], trunkPrefix: null }, PRODUCTS[1]];
    const m = generateRateMatrix({ destinations: [PK], products, rates: ratesFor(100) });
    expect(m.rows.map(r => r.prefix)).toEqual(["29233"]);
    expect(m.skipped[0]).toMatchObject({ reason: "no-trunk-prefix", productCode: "FC" });
  });

  it("names the destination and product missing a price", () => {
    const rates = ratesFor(100).filter(r => r.productId !== 6);
    const m = generateRateMatrix({ destinations: [PK], products: PRODUCTS, rates });
    expect(m.rows).toHaveLength(3);
    const gap = m.skipped.find(s => s.reason === "no-rate")!;
    expect(gap.productCode).toBe("SB");
    expect(gap.detail).toMatch(/unpriced/);
  });

  it("WARNS about an unroutable cell but still emits the row", () => {
    // Excluding would under-price a customer whose routing lands this week; dropping the
    // warning would quote traffic that fails. Both, and the caller decides.
    const m = generateRateMatrix({
      destinations: [PK], products: PRODUCTS, rates: ratesFor(100),
      routableCells: new Set(["Pakistan|FC", "Pakistan|BC"]),
    });
    expect(m.rows).toHaveLength(4);
    expect(m.skipped.filter(s => s.reason === "no-routing-group").map(s => s.productCode).sort())
      .toEqual(["SB", "SC"]);
  });

  it("checks no routing at all when routableCells is omitted", () => {
    const m = generateRateMatrix({ destinations: [PK], products: PRODUCTS, rates: ratesFor(100) });
    expect(m.skipped.filter(s => s.reason === "no-routing-group")).toHaveLength(0);
  });

  it("does not round the rate", () => {
    const m = generateRateMatrix({
      destinations: [PK], products: [PRODUCTS[0]],
      rates: [{ destinationId: 100, productId: 1, rate: 0.012345 }],
    });
    expect(m.rows[0].rate).toBe(0.012345);
  });
});

describe("verdict, folded into generation", () => {
  const full = () => generateRateMatrix({
    destinations: [PK, IN], products: PRODUCTS,
    rates: [...ratesFor(100), ...ratesFor(200, 0.02)],
  });

  it("passes a complete matrix and reports counts", () => {
    const m = full();
    expect(m.ok).toBe(true);
    expect(m.errors).toEqual([]);
    expect(m.summary).toMatchObject({
      destinationsProcessed: 2, destinationsApproved: 2,
      rowsGenerated: 8, rowsSkipped: 0, errorCount: 0,
    });
  });

  it("FAILS generation when two destinations compose to one prefix", () => {
    // "1"+"9233" and "19"+"233" both make 19233. Caught here rather than by the upload
    // engine — as a separate validate() step this is a step a caller can forget, and the
    // cost of forgetting is one destination silently overwriting another.
    const collide: CatalogueDestination = { id: 300, dialPrefix: "233", name: "OVERLAP", country: "X", commercialStatus: "approved" };
    const products = [PRODUCTS[0], { id: 9, code: "XX", name: "Odd", trunkPrefix: "19" }];
    const m = generateRateMatrix({
      destinations: [PK, collide], products,
      rates: [{ destinationId: 100, productId: 1, rate: 0.04 }, { destinationId: 300, productId: 9, rate: 0.04 }],
    });
    expect(m.ok).toBe(false);
    expect(m.errors.join(" ")).toMatch(/Prefix 19233 is produced by both/);
    // Rows still returned so a preview can show the problem.
    expect(m.rows).toHaveLength(2);
  });

  it("fails when a product produced nothing", () => {
    const rates = ratesFor(100).filter(r => r.productId !== 7);
    const m = generateRateMatrix({ destinations: [PK], products: PRODUCTS, rates });
    expect(m.ok).toBe(false);
    expect(m.errors.join(" ")).toMatch(/SC .*produced no rows/);
  });

  it("fails on an empty matrix", () => {
    expect(generateRateMatrix({ destinations: [], products: PRODUCTS, rates: [] }).ok).toBe(false);
  });

  it("warns without failing on unroutable and unapproved", () => {
    const m = generateRateMatrix({
      destinations: [PK, { ...IN, commercialStatus: "pending" }], products: PRODUCTS,
      rates: [...ratesFor(100), ...ratesFor(200)],
      routableCells: new Set(["Pakistan|FC", "Pakistan|BC", "Pakistan|SB", "Pakistan|SC"]),
    });
    expect(m.ok).toBe(true);
    expect(m.warnings.join(" ")).toMatch(/1 destination\(s\) excluded/);
    expect(m.summary.destinationsApproved).toBe(1);
  });
});
