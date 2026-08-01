/**
 * destination-workbook.ts — build the XLSX Sippy's /c1/destinations.php import expects.
 *
 * PURE. Imports only `xlsx`. No database, no HTTP.
 *
 * The split is load-bearing, for the same reason rate-matrix.ts is split from
 * rate-upload.service.ts: server/db.ts throws at module load without DATABASE_URL, so a
 * module that touched the database would drag a live connection into every test. The first
 * cut of the rate builder did exactly that and could not be tested at all.
 *
 * ── The column layout is POSITIONAL and comes from Sippy's own export ─────────
 *   Action [A|D|U|S|SA] | Id | Prefix | Country ISO | Description | Area Name |
 *   Min. Length | Max. Length
 *
 * Taken from a Download Destinations export, not inferred. A shifted column does not fail
 * the import — it writes the country into the description and the length into the area, and
 * the switch accepts it. That is why every field here is placed by index and why the test
 * reads the workbook back cell by cell.
 *
 * ── Why every existing row is included ────────────────────────────────────────
 * Whether a destination import REPLACES the table or MERGES into it is unresolved. The rate
 * path faces the same ambiguity and resolves it the same way: buildFullTariffXlsx includes
 * every current row because "Sippy portal upload can operate in REPLACE mode (wipes rows not
 * in the file)".
 *
 * So this builder takes the CURRENT Sippy destinations and re-emits all of them as Action=U
 * carrying their existing Id, then appends new ones as Action=A with a blank Id. That file
 * is correct under both semantics:
 *
 *   merge   -> U updates in place, A adds. Nothing is touched that should not be.
 *   replace -> the file is the whole table, and the whole table is in the file.
 *
 * The alternative — sending only new rows — is correct under merge and deletes 2,923 live
 * routing entries under replace, including every NANP prefix and its length rules. A design
 * that is safe under both is worth more than an answer to which one applies.
 *
 * ── What this refuses to invent ───────────────────────────────────────────────
 * Country ISO and the length bounds are emitted only when supplied. A destination with no
 * ISO gets a blank cell and is COUNTED, never guessed — Sippy's own export has blanks in
 * those columns (row `11 / North America` carries none), so blank is a value the importer
 * already accepts. Min/Max length is a misdial guard on a live switch; inventing 11/11 for a
 * Pakistani mobile series would reject valid traffic.
 */
import * as XLSX from "xlsx";

/** Sippy's export column order. Positional — do not reorder without changing the tests. */
export const DESTINATION_XLSX_HEADERS = [
  "Action [A|D|U|S|SA]",
  "Id",
  "Prefix",
  "Country ISO",
  "Description",
  "Area Name",
  "Min. Length",
  "Max. Length",
] as const;

/** A row as it exists in Sippy today, from a Download Destinations export. */
export interface SippyDestinationRow {
  id: number | string;
  prefix: string;
  countryIso?: string | null;
  description?: string | null;
  areaName?: string | null;
  minLength?: number | string | null;
  maxLength?: number | string | null;
}

/** A destination BitsAuto wants Sippy to know about. */
export interface NewDestinationRow {
  prefix: string;
  countryIso?: string | null;
  description?: string | null;
  areaName?: string | null;
  minLength?: number | null;
  maxLength?: number | null;
}

export interface DestinationWorkbookSummary {
  existing: number;
  added: number;
  skippedNoPrefix: number;
  /** New rows already present in Sippy by prefix — not re-added, and named. */
  duplicates: string[];
  /** Added rows with no country ISO. Blank is accepted by Sippy; the count is so nobody is surprised. */
  missingIso: number;
  /** Added rows with no length bounds. */
  missingLengths: number;
  totalRows: number;
}

export interface DestinationWorkbook {
  buffer: Buffer;
  summary: DestinationWorkbookSummary;
}

function cell(v: unknown): string | number | null {
  if (v === undefined || v === null || v === "") return null;
  return typeof v === "number" ? v : String(v);
}

/**
 * Build the import workbook.
 *
 * @param existing  Every destination Sippy currently holds. Re-emitted as Action=U so the
 *                  file is complete under REPLACE semantics. Pass the full export.
 * @param additions Destinations to create. Emitted as Action=A with a blank Id.
 */
export function buildDestinationsXlsx(
  existing: SippyDestinationRow[],
  additions: NewDestinationRow[],
): DestinationWorkbook {
  const rows: Array<Array<string | number | null>> = [];
  const seen = new Set(existing.map(e => String(e.prefix).trim()).filter(Boolean));

  // Existing rows first, unchanged, each carrying its Id. Order follows the export so a
  // human diffing the file against a fresh download sees the same sequence.
  for (const e of existing) {
    const prefix = String(e.prefix ?? "").trim();
    if (!prefix) continue;
    rows.push([
      "U",
      cell(e.id),
      prefix,
      cell(e.countryIso),
      cell(e.description),
      cell(e.areaName),
      cell(e.minLength),
      cell(e.maxLength),
    ]);
  }

  const summary: DestinationWorkbookSummary = {
    existing: rows.length,
    added: 0,
    skippedNoPrefix: 0,
    duplicates: [],
    missingIso: 0,
    missingLengths: 0,
    totalRows: 0,
  };

  for (const a of additions) {
    const prefix = String(a.prefix ?? "").trim();
    // A destination with no prefix cannot route. Counted, never emitted — an empty prefix
    // cell in an import is the kind of row that either fails the file or matches everything.
    if (!prefix) { summary.skippedNoPrefix++; continue; }
    // Already in Sippy. Left as the existing U row rather than emitted twice: two rows for
    // one prefix in one file makes the result depend on import order.
    if (seen.has(prefix)) { summary.duplicates.push(prefix); continue; }
    seen.add(prefix);

    if (!a.countryIso) summary.missingIso++;
    if (a.minLength === undefined || a.minLength === null ||
        a.maxLength === undefined || a.maxLength === null) summary.missingLengths++;

    rows.push([
      "A",
      null,                       // Id blank — Sippy assigns it
      prefix,
      cell(a.countryIso),
      cell(a.description),
      cell(a.areaName),
      cell(a.minLength),
      cell(a.maxLength),
    ]);
    summary.added++;
  }

  summary.totalRows = rows.length;

  const ws = XLSX.utils.aoa_to_sheet([[...DESTINATION_XLSX_HEADERS], ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return {
    buffer: XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer,
    summary,
  };
}
