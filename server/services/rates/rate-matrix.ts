/**
 * The deterministic half of rate upload: rows in, workbook out.
 *
 * DELIBERATELY IMPORTS NOTHING FROM THE APP. No db, no sippy, no config. server/db.ts
 * throws at module load when DATABASE_URL is absent, so anything importing it drags a
 * live database into every test that touches it — which is exactly what happened on the
 * first cut of this file. Keeping the transform pure is what makes the workbook testable
 * with no database, no credentials and no switch, and the workbook is the part that has
 * to be right: Sippy's importer is POSITIONAL, so a shifted column does not fail, it
 * prices the wrong destination.
 *
 * The database half lives in rate-upload.service.ts; the transport half stays in
 * server/sippy.ts.
 */
import * as XLSX from "xlsx";

/** One line of a Sippy rate upload, already carrying its full switch-side prefix. */
export interface RateRow {
  /** trunkPrefix + destination prefix, e.g. "19233" = First Class (1) + Pakistan Ufone (9233). */
  prefix: string;
  country?: string | null;
  rate: number;
  /** "YYYY-MM-DD HH:MM:SS". Omitted means effective immediately. */
  effectiveFrom?: string | null;
  effectiveTill?: string | null;
}

export interface ResolvedDefaults {
  rows: RateRow[];
  /** Per-product counts, so a caller can report "FC 32 · BC 32 · SB 32 · SC 0" rather than a total that hides a missing tier. */
  byProduct: Array<{ code: string; name: string; trunkPrefix: string; count: number }>;
  /** Active products that produced no rows. A silent zero here is a customer priced on three tiers out of four. */
  productsWithoutRates: Array<{ code: string; name: string }>;
}

/**
 * Sippy's rate-upload column layout. Must match buildRateXlsx() in server/sippy.ts
 * EXACTLY — the two builders write to the same importer, and a divergence would surface
 * only as mispriced traffic.
 */
export const RATE_XLSX_HEADERS = [
  'Action [A|D|U|S|SA]', 'Id', 'Prefix', 'Country',
  'Interval 1', 'Interval N', 'Price 1', 'Price N',
  'Forbidden', 'Grace Period', 'Activation Date', 'Expiration Date',
] as const;

/**
 * Compose the switch-side prefix.
 *
 * product_rates.prefix is the BARE destination ("9233"); the product digit lives on
 * product_registry.trunkPrefix ("1"). Storing the composed value instead would duplicate
 * every destination once per product and turn a price change into four edits. This is
 * the same grammar the authentication rules use —
 * {account_prefix}{product_digit}{country_code}.
 */
export function composePrefix(trunkPrefix: string, destinationPrefix: string): string {
  return `${trunkPrefix.trim()}${destinationPrefix.trim()}`;
}

/**
 * Build ONE workbook containing every row.
 *
 * WHY BULK. Rate Manager's single-rate push builds a one-row workbook, takes its own
 * upload token, uploads, then polls getUploadStatus up to fifteen times at two seconds.
 * That is right for an operator changing two destinations and wrong for provisioning: a
 * default sheet is 32 destinations x 4 products = 128 rates, so per-rate upload means 128
 * tokens, 128 uploads, and 128 chances to fail half-way leaving a tariff holding some of
 * its prices. getUploadToken takes an i_tariff and accepts as many rows as you give it —
 * bulk import is what it is for.
 *
 * Action defaults to 'SA', matching what Rate Manager already sends and this switch
 * already accepts. Do not change it to 'A' untested: on a tariff that already holds the
 * prefix, add-versus-set is the difference between an update and a second conflicting row.
 *
 * Price 1 and Price N are both the per-minute rate with 1/1 intervals — per-second
 * billing from the first second, mirroring the existing builder. If billing increments
 * ever need to vary that belongs in product_rates, not as a constant quietly differing
 * between two code paths.
 */
export function buildBulkRateXlsx(rows: RateRow[], action: string = 'SA'): Buffer {
  if (!rows.length) {
    throw new Error('buildBulkRateXlsx: refusing to build an empty workbook — a REPLACE-mode import of an empty file can be read as "delete every rate", silently unpricing a live customer.');
  }
  const aoa: (string | number | null)[][] = [
    [...RATE_XLSX_HEADERS],
    ...rows.map(r => [
      action,
      null,                      // Id — blank for a new/settable row
      r.prefix,
      r.country ?? null,
      1, 1,                      // Interval 1 / Interval N
      r.rate, r.rate,            // Price 1 / Price N
      0, 1,                      // Forbidden / Grace Period
      r.effectiveFrom ?? null,
      r.effectiveTill ?? null,
    ]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/**
 * Reject a matrix that would price a customer incompletely.
 *
 * Runs before any upload. A partially-priced tariff is worse than an unpriced one: the
 * customer authenticates, routes, and bills at whatever the switch falls back to on the
 * tiers we missed. Reasons are returned rather than thrown so preflight can list them
 * beside its other checks.
 */
export function validateDefaults(d: ResolvedDefaults): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!d.rows.length) {
    reasons.push('No default rates resolved — product_rates has no entries effective today for any active product.');
  }
  for (const p of d.productsWithoutRates) {
    reasons.push(`Product "${p.name}" (${p.code}) has no rates — a customer provisioned now would carry that product unpriced.`);
  }
  const seen = new Set<string>();
  for (const r of d.rows) {
    if (seen.has(r.prefix)) {
      reasons.push(`Duplicate prefix ${r.prefix} in the resolved matrix — two products resolving to the same switch-side prefix means one silently overwrites the other.`);
      break;
    }
    seen.add(r.prefix);
  }
  return { ok: reasons.length === 0, reasons };
}
