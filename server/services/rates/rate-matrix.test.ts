/**
 * The workbook is the contract with Sippy's importer, and the importer is POSITIONAL —
 * a shifted column does not fail, it prices the wrong destination. These tests read the
 * generated file back cell by cell rather than asserting on a byte count.
 */
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { buildBulkRateXlsx, validateDefaults, type RateRow, type ResolvedDefaults } from "./rate-matrix";

function readBack(buf: Buffer): (string | number | null)[][] {
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as (string | number | null)[][];
}

const HEADERS = [
  'Action [A|D|U|S|SA]', 'Id', 'Prefix', 'Country',
  'Interval 1', 'Interval N', 'Price 1', 'Price N',
  'Forbidden', 'Grace Period', 'Activation Date', 'Expiration Date',
];

describe("buildBulkRateXlsx", () => {
  const rows: RateRow[] = [
    { prefix: "19233", country: "Pakistan", rate: 0.04 },
    { prefix: "1880",  country: "Bangladesh", rate: 0.02 },
    { prefix: "291",   country: "India", rate: 0.02 },
  ];

  it("keeps the exact column layout server/sippy.ts uses", () => {
    // If buildRateXlsx's headers ever change, this must change with them — the two
    // builders write to the same importer and a divergence would only show up as
    // mispriced traffic.
    expect(readBack(buildBulkRateXlsx(rows))[0]).toEqual(HEADERS);
  });

  it("writes every rate into ONE workbook", () => {
    // The whole point: 128 rates must be one file, not 128 uploads.
    const aoa = readBack(buildBulkRateXlsx(rows));
    expect(aoa.length).toBe(rows.length + 1);
    expect(aoa.slice(1).map(r => r[2])).toEqual(["19233", "1880", "291"]);
  });

  it("places prefix, price and intervals in the columns the importer reads", () => {
    const [, first] = readBack(buildBulkRateXlsx([rows[0]]));
    expect(first[0]).toBe("SA");      // Action
    expect(first[1]).toBe(null);      // Id — blank for a settable row
    expect(first[2]).toBe("19233");   // Prefix
    expect(first[3]).toBe("Pakistan");
    expect(first[4]).toBe(1);         // Interval 1  — per-second from the first second
    expect(first[5]).toBe(1);         // Interval N
    expect(first[6]).toBe(0.04);      // Price 1
    expect(first[7]).toBe(0.04);      // Price N
    expect(first[8]).toBe(0);         // Forbidden
    expect(first[9]).toBe(1);         // Grace Period
  });

  it("carries effective dates through, and leaves them blank when absent", () => {
    // Blank means "immediately" to Sippy. Writing a string like "immediate" would be
    // parsed as a date and rejected.
    const [, dated] = readBack(buildBulkRateXlsx([
      { prefix: "19233", rate: 0.04, effectiveFrom: "2026-08-01 00:00:00", effectiveTill: "2026-12-31 23:59:59" },
    ]));
    expect(dated[10]).toBe("2026-08-01 00:00:00");
    expect(dated[11]).toBe("2026-12-31 23:59:59");

    const [, undated] = readBack(buildBulkRateXlsx([{ prefix: "19233", rate: 0.04 }]));
    expect(undated[10]).toBe(null);
    expect(undated[11]).toBe(null);
  });

  it("refuses to build an empty workbook", () => {
    // A REPLACE-mode import of an empty file can be read as "delete every rate" —
    // silently unpricing a live customer.
    expect(() => buildBulkRateXlsx([])).toThrow(/empty/i);
  });

  it("does not round or reformat the rate", () => {
    // Sippy rates run to 6 decimal places; a float coerced through a string would lose
    // the tail and undercharge on every call.
    const [, row] = readBack(buildBulkRateXlsx([{ prefix: "19233", rate: 0.012345 }]));
    expect(row[6]).toBe(0.012345);
  });
});

describe("validateDefaults", () => {
  const ok: ResolvedDefaults = {
    rows: [{ prefix: "19233", rate: 0.04 }, { prefix: "29233", rate: 0.03 }],
    byProduct: [
      { code: "FC", name: "First Class", trunkPrefix: "1", count: 1 },
      { code: "BC", name: "Business Class", trunkPrefix: "2", count: 1 },
    ],
    productsWithoutRates: [],
  };

  it("passes a complete matrix", () => {
    expect(validateDefaults(ok)).toEqual({ ok: true, reasons: [] });
  });

  it("names a product that would be provisioned unpriced", () => {
    const r = validateDefaults({ ...ok, productsWithoutRates: [{ code: "SC", name: "Special Charlie" }] });
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/Special Charlie.*unpriced/);
  });

  it("catches two products colliding on one switch-side prefix", () => {
    // e.g. trunk "1" + "9233" and trunk "19" + "233" both compose to 19233 — one would
    // silently overwrite the other in the tariff.
    const r = validateDefaults({ ...ok, rows: [{ prefix: "19233", rate: 0.04 }, { prefix: "19233", rate: 0.03 }] });
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/Duplicate prefix 19233/);
  });

  it("fails when nothing resolved at all", () => {
    expect(validateDefaults({ rows: [], byProduct: [], productsWithoutRates: [] }).ok).toBe(false);
  });
});
