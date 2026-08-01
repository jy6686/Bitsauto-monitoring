/**
 * Sippy's destination importer is POSITIONAL. A shifted column does not fail the import —
 * it writes the country into the description and the length bound into the area name, and
 * the switch accepts it. So these tests read the generated workbook back cell by cell.
 *
 * The behaviour that matters most is not the layout though: it is that every existing row
 * survives. Sending only new rows is correct if the import merges and deletes 2,923 live
 * routing entries if it replaces, and which one applies is unresolved. The builder is
 * designed to be correct either way, and that is what most of these tests pin down.
 */
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  buildDestinationsXlsx,
  DESTINATION_XLSX_HEADERS,
  type SippyDestinationRow,
  type NewDestinationRow,
} from "./destination-workbook";

function readBack(buf: Buffer): (string | number | null)[][] {
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as (string | number | null)[][];
}

// Real rows from a Download Destinations export, kept verbatim — including the first one,
// which carries no ISO and no length bounds and proves blanks are a value Sippy itself uses.
const EXISTING: SippyDestinationRow[] = [
  { id: 1924, prefix: "11",     countryIso: null,  description: "North America",        areaName: null, minLength: null, maxLength: null },
  { id: 2676, prefix: "11201",  countryIso: "USA", description: "New Jersey",           areaName: "NJ", minLength: 11,   maxLength: 11 },
  { id: 2791, prefix: "11202",  countryIso: "USA", description: "District of Columbia", areaName: "DC", minLength: 11,   maxLength: 11 },
];

describe("buildDestinationsXlsx", () => {
  it("emits Sippy's exact column order", () => {
    const { buffer } = buildDestinationsXlsx([], []);
    expect(readBack(buffer)[0]).toEqual([...DESTINATION_XLSX_HEADERS]);
  });

  it("re-emits every existing row as U carrying its Id", () => {
    const { buffer, summary } = buildDestinationsXlsx(EXISTING, []);
    const rows = readBack(buffer).slice(1);
    expect(summary.existing).toBe(3);
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(r[0]).toBe("U");
    expect(rows.map(r => r[1])).toEqual([1924, 2676, 2791]);
  });

  it("places each field in the column Sippy reads it from", () => {
    const { buffer } = buildDestinationsXlsx([EXISTING[1]], []);
    const [, row] = readBack(buffer);
    expect(row[0]).toBe("U");            // Action
    expect(row[1]).toBe(2676);           // Id
    expect(row[2]).toBe("11201");        // Prefix
    expect(row[3]).toBe("USA");          // Country ISO
    expect(row[4]).toBe("New Jersey");   // Description
    expect(row[5]).toBe("NJ");           // Area Name
    expect(row[6]).toBe(11);             // Min. Length
    expect(row[7]).toBe(11);             // Max. Length
  });

  it("adds new destinations as A with a blank Id", () => {
    const additions: NewDestinationRow[] = [
      { prefix: "9230", countryIso: "PAK", description: "Pakistan Mobile", areaName: "Jazz" },
    ];
    const { buffer, summary } = buildDestinationsXlsx(EXISTING, additions);
    const rows = readBack(buffer).slice(1);
    const added = rows[rows.length - 1];
    expect(added[0]).toBe("A");
    expect(added[1]).toBeNull();
    expect(added[2]).toBe("9230");
    expect(added[5]).toBe("Jazz");
    expect(summary.added).toBe(1);
    expect(summary.totalRows).toBe(4);
  });

  // THE POINT OF THE WHOLE DESIGN. Under REPLACE semantics the file is the table, so an
  // existing row missing from the file is an existing row deleted from a live switch.
  it("never drops an existing row, whatever is being added", () => {
    const { buffer } = buildDestinationsXlsx(EXISTING, [{ prefix: "9230" }]);
    const prefixes = readBack(buffer).slice(1).map(r => r[2]);
    for (const e of EXISTING) expect(prefixes).toContain(e.prefix);
  });

  it("does not emit a second row for a prefix Sippy already holds", () => {
    const { buffer, summary } = buildDestinationsXlsx(EXISTING, [
      { prefix: "11201", description: "New Jersey (ours)" },
      { prefix: "9230",  description: "Pakistan Mobile" },
    ]);
    expect(summary.duplicates).toEqual(["11201"]);
    expect(summary.added).toBe(1);
    expect(readBack(buffer).slice(1).filter(r => r[2] === "11201")).toHaveLength(1);
  });

  it("skips a destination with no prefix rather than emitting an empty cell", () => {
    const { buffer, summary } = buildDestinationsXlsx([], [
      { prefix: "", description: "nowhere" },
      { prefix: "  ", description: "also nowhere" },
      { prefix: "9231", description: "Pakistan Mobile" },
    ]);
    expect(summary.skippedNoPrefix).toBe(2);
    expect(summary.added).toBe(1);
    expect(readBack(buffer).slice(1)).toHaveLength(1);
  });

  // Blank, never guessed. Sippy's own export leaves both blank on prefix 11, so a blank is
  // a value its importer accepts — and an invented 11/11 on a Pakistani mobile series would
  // reject valid traffic on a live switch.
  it("leaves country and length blank when unknown, and counts them", () => {
    const { buffer, summary } = buildDestinationsXlsx([], [
      { prefix: "9232", description: "Pakistan Mobile" },
    ]);
    const [, row] = readBack(buffer);
    expect(row[3]).toBeNull();
    expect(row[6]).toBeNull();
    expect(row[7]).toBeNull();
    expect(summary.missingIso).toBe(1);
    expect(summary.missingLengths).toBe(1);
  });

  it("reports a summary that adds up", () => {
    const { summary } = buildDestinationsXlsx(EXISTING, [
      { prefix: "9230" }, { prefix: "9231" }, { prefix: "11201" }, { prefix: "" },
    ]);
    expect(summary.existing).toBe(3);
    expect(summary.added).toBe(2);
    expect(summary.duplicates).toEqual(["11201"]);
    expect(summary.skippedNoPrefix).toBe(1);
    expect(summary.totalRows).toBe(summary.existing + summary.added);
  });
});
