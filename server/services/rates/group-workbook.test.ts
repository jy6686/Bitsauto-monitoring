/**
 * The N-row workbook, read back cell by cell.
 *
 * Sippy's importer is positional: a shifted column does not fail, it prices the wrong destination.
 * So the headers must be byte-identical to the single-row builder's, every row must carry its OWN
 * increment and dates (the existing bulk builder hardcodes 1/1, which is why it cannot be reused),
 * and Id must be blank on every row — an Id here is how the portal path once rewrote another
 * destination's price.
 */
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { buildGroupRateXlsx, RATE_XLSX_HEADERS } from "./rate-matrix";
import { buildRateXlsx } from "../../sippy";

function readBack(buf: Buffer): (string | number | null)[][] {
  const wb = XLSX.read(buf, { type: "buffer" });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null }) as (string | number | null)[][];
}

const FIVE = [
  { prefix: '29230', rate: 0.04, interval1: 1,  intervalN: 1,  effectiveFrom: '2026-09-19 10:51:00' },
  { prefix: '29233', rate: 0.04, interval1: 1,  intervalN: 1,  effectiveFrom: '2026-09-19 10:51:00' },
  { prefix: '29232', rate: 0.04, interval1: 1,  intervalN: 1,  effectiveFrom: '2026-09-19 10:51:00' },
  { prefix: '29231', rate: 0.04, interval1: 60, intervalN: 1,  effectiveFrom: '2026-09-19 10:51:00' },
  { prefix: '29237', rate: 0.04, interval1: 60, intervalN: 60, effectiveFrom: '2026-09-19 10:51:00', effectiveTill: '2026-12-31 23:59:00' },
];

describe("buildGroupRateXlsx", () => {
  it("emits one header line plus one line per row", () => {
    const sheet = readBack(buildGroupRateXlsx(FIVE, 'A'));
    expect(sheet).toHaveLength(6);
  });

  it("headers are byte-identical to the single-row builder's and to RATE_XLSX_HEADERS", () => {
    const [ours] = readBack(buildGroupRateXlsx(FIVE, 'A'));
    const [single] = readBack(buildRateXlsx('A', null, '29230', '', 0.04));
    expect(ours).toEqual(single);
    expect(ours).toEqual([...RATE_XLSX_HEADERS]);
  });

  it("Id is null on EVERY row", () => {
    const [, ...rows] = readBack(buildGroupRateXlsx(FIVE, 'A'));
    expect(rows.map(r => r[1])).toEqual([null, null, null, null, null]);
  });

  it("the action is stamped on every row and the prefixes keep their order", () => {
    const [, ...rows] = readBack(buildGroupRateXlsx(FIVE, 'A'));
    expect(rows.map(r => r[0])).toEqual(['A', 'A', 'A', 'A', 'A']);
    expect(rows.map(r => r[2])).toEqual(['29230', '29233', '29232', '29231', '29237']);
    const [, ...sa] = readBack(buildGroupRateXlsx(FIVE, 'SA'));
    expect(sa.map(r => r[0])).toEqual(['SA', 'SA', 'SA', 'SA', 'SA']);
  });

  it("each row carries its OWN increment — never a shared default", () => {
    const [, ...rows] = readBack(buildGroupRateXlsx(FIVE, 'A'));
    expect(rows.map(r => `${r[4]}/${r[5]}`)).toEqual(['1/1', '1/1', '1/1', '60/1', '60/60']);
  });

  it("an omitted increment is 1/1, exactly as the single-row builder does", () => {
    const [, row] = readBack(buildGroupRateXlsx([{ prefix: '29230', rate: 0.04 }], 'SA'));
    expect(row[4]).toBe(1);
    expect(row[5]).toBe(1);
  });

  it("each row carries its own dates; Price 1 = Price N = rate; Forbidden 0; Grace 1", () => {
    const [, ...rows] = readBack(buildGroupRateXlsx(FIVE, 'A'));
    for (const r of rows) {
      expect(r[6]).toBe(0.04);
      expect(r[7]).toBe(0.04);
      expect(r[8]).toBe(0);
      expect(r[9]).toBe(1);
      expect(r[10]).toBe('2026-09-19 10:51:00');
    }
    expect(rows.map(r => r[11])).toEqual([null, null, null, null, '2026-12-31 23:59:00']);
  });

  it("a row is column-for-column what the single-row builder would have produced for it", () => {
    const [, ours] = readBack(buildGroupRateXlsx([FIVE[3]], 'A'));
    const [, single] = readBack(buildRateXlsx('A', null, '29231', '', 0.04, '2026-09-19 10:51:00', undefined, 60, 1));
    expect(ours).toEqual(single);
  });

  it("refuses an empty workbook — an empty import is not a no-op on a REPLACE-capable importer", () => {
    expect(() => buildGroupRateXlsx([], 'A')).toThrow(/empty/i);
  });
});
