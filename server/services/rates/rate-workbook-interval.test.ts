/**
 * The billing increment reaches Sippy as two POSITIONAL columns in the rate workbook —
 * "Interval 1" and "Interval N", columns 5 and 6. A shifted or defaulted value does not fail
 * the upload, it bills a real customer on the wrong terms until someone reads a CDR.
 *
 * These read the generated workbook back cell by cell rather than trusting the builder.
 */
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { buildRateXlsx } from "../../sippy";
import { parseBillingIncrement } from "./billing-increment";

function readBack(buf: Buffer): (string | number | null)[][] {
  const wb = XLSX.read(buf, { type: "buffer" });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null }) as (string | number | null)[][];
}
const INTERVAL_1 = 4, INTERVAL_N = 5; // zero-based column positions

describe("buildRateXlsx billing increment", () => {
  it("puts the increment in the Interval 1 / Interval N columns", () => {
    const [headers, row] = readBack(buildRateXlsx('SA', null, '19230', '', 0.04, undefined, undefined, 60, 1));
    expect(headers[INTERVAL_1]).toBe('Interval 1');
    expect(headers[INTERVAL_N]).toBe('Interval N');
    expect(row[INTERVAL_1]).toBe(60);
    expect(row[INTERVAL_N]).toBe(1);
  });

  it("carries every increment the production catalogue actually holds", () => {
    // Distribution verified against the supplier workbook AND production, 2026-09-08:
    // 1/1 x14,964 · 60/1 x2,389 · 60/60 x1,386 · 30/6 x367 · 6/6 x54 = 19,160.
    for (const raw of ['1/1', '60/1', '60/60', '30/6', '6/6']) {
      const inc = parseBillingIncrement(raw)!;
      const [, row] = readBack(buildRateXlsx('SA', null, '19230', '', 0.04, undefined, undefined, inc.interval1, inc.intervalN));
      expect(`${row[INTERVAL_1]}/${row[INTERVAL_N]}`).toBe(raw);
    }
  });

  it("defaults to 1/1 when no increment is supplied — the pre-existing behaviour", () => {
    const [, row] = readBack(buildRateXlsx('SA', null, '19230', '', 0.04));
    expect(row[INTERVAL_1]).toBe(1);
    expect(row[INTERVAL_N]).toBe(1);
  });

  it("does not disturb the other positional columns", () => {
    const [headers, row] = readBack(buildRateXlsx('A', 77, '79230', 'PAKISTAN', 0.0425, '2026-09-09 01:40:00', undefined, 30, 6));
    expect(headers).toEqual([
      'Action [A|D|U|S|SA]', 'Id', 'Prefix', 'Country',
      'Interval 1', 'Interval N', 'Price 1', 'Price N',
      'Forbidden', 'Grace Period', 'Activation Date', 'Expiration Date',
    ]);
    expect(row[0]).toBe('A');
    expect(row[1]).toBe(77);
    expect(row[2]).toBe('79230');
    expect(row[3]).toBe('PAKISTAN');
    expect(row[6]).toBe(0.0425);   // Price 1
    expect(row[7]).toBe(0.0425);   // Price N
    expect(row[8]).toBe(0);        // Forbidden
    expect(row[9]).toBe(1);        // Grace Period
    expect(row[10]).toBe('2026-09-09 01:40:00');
  });

  it("AFGHANISTAN - MOBILE AWCC: both catalogue prefixes ship 60/1 on First Class", () => {
    // The chosen production test destination — 9370 and 9371, both 60/1 in the catalogue,
    // which is why it can prove the value travels where Pakistan (all 1/1) cannot.
    const inc = parseBillingIncrement('60/1')!;
    for (const dial of ['9370', '9371']) {
      const [, row] = readBack(buildRateXlsx('SA', null, '1' + dial, '', 0.133, undefined, undefined, inc.interval1, inc.intervalN));
      expect(row[2]).toBe('1' + dial);
      expect(row[INTERVAL_1]).toBe(60);
      expect(row[INTERVAL_N]).toBe(1);
    }
  });
});
