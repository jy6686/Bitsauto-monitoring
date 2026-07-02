// Sprint 1D certification — mirrors the exact production normalization path
// in server/routes-vendor-rates.ts (setImmediate block, lines 195-260)

import { db } from '../server/db';
import { vendorRateSheets, vendorRateSheetRows, vendorRateNormalizedPrefixes } from '../shared/schema';
import { parsePrefixExpression } from '../server/services/vendor-prefix-parser';
import { matchSheetDestinations } from '../server/services/destination/destination-matcher.service';
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import { sql } from 'drizzle-orm';

const VENDOR_ID = 1;
const FILE = './attached_assets/PUSHTO_TALK_PK_Rates_Rates_1775647323882.xlsx';
const MAP: Record<string,string> = {
  'Prefix':'prefix','Country':'destination','Price 1':'rate',
  'Interval 1':'interval1','Interval N':'intervalN',
  'Activation Date':'effectiveDate','Expiration Date':'expiryDate'
};

// ── Parse XLSX (same logic as production applyMap / validate phase) ────────────
const buf = fs.readFileSync(FILE);
const wb = XLSX.read(buf, { type:'buffer', raw:false, cellDates:true });
const ws = wb.Sheets[wb.SheetNames[0]];
const all: any[][] = XLSX.utils.sheet_to_json(ws, { header:1, defval:null, raw:false });

let hIdx = -1, maxF = 0;
all.forEach((r, i) => {
  const f = r.filter((c:any) => c != null && String(c).trim() !== '').length;
  if (f > maxF) { maxF = f; hIdx = i; }
});
const headers = all[hIdx].map((h:any, i:number) => {
  const v = h != null ? String(h).trim() : ''; return v !== '' ? v : 'col_' + i;
});
const colIdx: Record<string,number> = {};
headers.forEach((h:string, i:number) => { if (h) colIdx[h] = i; });
const cIdx: Record<string,number> = {};
for (const [vc, can] of Object.entries(MAP)) {
  if (colIdx[vc] !== undefined) cIdx[can] = colIdx[vc];
}
const get = (row: any[], f: string) => cIdx[f] !== undefined ? row[cIdx[f]] : null;
const parseDate = (v: any): string|null => {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0,10);
  const s = String(v).trim();
  if (/^\d{4,5}$/.test(s)) {
    const d = new Date(Date.UTC(1900,0,1) + (parseInt(s)-2)*86400000);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0,10);
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0,10);
};

const validated = all.slice(hIdx+1).map((row: any[]) => {
  const rawPfx = get(row,'prefix') != null ? String(get(row,'prefix')).trim() : null;
  const parsedPfx = parsePrefixExpression(rawPfx, 'mixed');
  const prefix = parsedPfx[0]?.prefix ?? '';
  const rate = parseFloat(String(get(row,'rate') ?? '').replace(/[^0-9.\-]/g, ''));
  if (!rawPfx || !prefix || isNaN(rate) || rate <= 0) return null;
  return {
    prefix, rawPrefixExpression: rawPfx,
    rate,
    destination: get(row,'destination') != null ? String(get(row,'destination')).trim() : null,
    currency: 'USD',
    effectiveDate: parseDate(get(row,'effectiveDate')),
    expiryDate:    parseDate(get(row,'expiryDate')),
    interval1:  parseInt(String(get(row,'interval1') ?? '60')) || 60,
    intervalN:  parseInt(String(get(row,'intervalN') ?? '60')) || 60,
    interconnect: null, rawRow: row,
  };
}).filter(Boolean) as any[];
console.log('[test] validated:', validated.length, '/ total:', all.length - hIdx - 1);
if (!validated.length) { console.error('[test] FAIL — 0 validated rows'); process.exit(1); }

// ── Insert sheet ──────────────────────────────────────────────────────────────
const [sheet] = await db.insert(vendorRateSheets).values({
  vendorId: VENDOR_ID, fileName: 'TEST_PIPELINE.xlsx', fileType: 'xlsx',
  currency: 'USD', rowCount: validated.length, status: 'processing',
}).returning();
console.log('[test] sheet id:', sheet.id);

// ── Insert rows — VERBATIM from production .returning() shape ─────────────────
const insertedRows: {
  id: number; rawPrefixExpression: string|null; prefix: string;
  destination: string|null; rate: string; currency: string|null;
  effectiveDate: string|null; expiryDate: string|null;
  interval1: number|null; intervalN: number|null;
}[] = [];

for (let i = 0; i < validated.length; i += 500) {
  const returned = await db.insert(vendorRateSheetRows).values(
    validated.slice(i, i+500).map((r: any) => ({
      sheetId: sheet.id, prefix: r.prefix, rawPrefixExpression: r.rawPrefixExpression ?? null,
      destination: r.destination, rate: String(r.rate), currency: r.currency,
      effectiveDate: r.effectiveDate, expiryDate: r.expiryDate,
      interval1: r.interval1, intervalN: r.intervalN,
      interconnect: r.interconnect, rawRow: r.rawRow,
    }))
  ).returning({
    id:                  vendorRateSheetRows.id,
    rawPrefixExpression: vendorRateSheetRows.rawPrefixExpression,
    prefix:              vendorRateSheetRows.prefix,
    destination:         vendorRateSheetRows.destination,
    rate:                vendorRateSheetRows.rate,
    currency:            vendorRateSheetRows.currency,
    effectiveDate:       vendorRateSheetRows.effectiveDate,
    expiryDate:          vendorRateSheetRows.expiryDate,
    interval1:           vendorRateSheetRows.interval1,
    intervalN:           vendorRateSheetRows.intervalN,
  });
  insertedRows.push(...returned);
}
console.log('[test] insertedRows:', insertedRows.length);

// ── Normalization — VERBATIM copy from routes-vendor-rates.ts lines 222-248 ───
await db.execute(sql`UPDATE vendor_rate_sheets SET status = 'normalizing' WHERE id = ${sheet.id}`);
const normBatch: any[] = [];
for (const r of insertedRows) {
  const parsedPfx = parsePrefixExpression(r.rawPrefixExpression ?? r.prefix, 'mixed');
  const unique = new Map<string, typeof parsedPfx[0]>();
  for (const p of parsedPfx) unique.set(p.prefix, p);
  for (const p of unique.values()) {
    normBatch.push({
      sheetId: sheet.id, sheetRowId: r.id,
      normalizedPrefix: p.prefix, destination: r.destination,
      rate: String(r.rate), currency: r.currency,
      effectiveDate: r.effectiveDate, expiryDate: r.expiryDate,
      interval1: r.interval1, intervalN: r.intervalN,
      matchStatus: 'pending', matchMethod: p.method,
      parserVersion: 1, parserWarnings: p.warnings?.length ? p.warnings : null,
    });
  }
}
console.log('[test] normBatch:', normBatch.length);
const dedupedNorm = [
  ...new Map(normBatch.map((r: any) => [`${r.sheetId}:${r.normalizedPrefix}`, r])).values()
];
console.log('[test] dedupedNorm:', dedupedNorm.length);
for (let i = 0; i < dedupedNorm.length; i += 500) {
  await db.insert(vendorRateNormalizedPrefixes).values(dedupedNorm.slice(i, i+500));
}
console.log('[test] normalized inserted:', dedupedNorm.length);
// ── END verbatim normalization block ──────────────────────────────────────────

// ── Match ─────────────────────────────────────────────────────────────────────
await db.execute(sql`UPDATE vendor_rate_sheets SET status = 'matching' WHERE id = ${sheet.id}`);
const matchResult = await matchSheetDestinations(sheet.id);
await db.execute(sql`UPDATE vendor_rate_sheets SET status = 'ready' WHERE id = ${sheet.id}`);
console.log('[test] match:', JSON.stringify(matchResult));

// ── Verify all 3 tables ───────────────────────────────────────────────────────
const cnt = await db.execute(sql`
  SELECT
    (SELECT COUNT(*) FROM vendor_rate_sheet_rows          WHERE sheet_id=${sheet.id})::int AS rows,
    (SELECT COUNT(*) FROM vendor_rate_normalized_prefixes WHERE sheet_id=${sheet.id})::int AS prefixes
`);
const c = (cnt as any).rows?.[0];
console.log('[test] DB — rows:', c?.rows, '  prefixes:', c?.prefixes);

if (Number(c?.rows) > 0 && Number(c?.prefixes) > 0) {
  console.log('[test] ✅ Sprint 1D CERTIFIED sheetId:', sheet.id);
} else {
  console.error('[test] ❌ FAILED — rows=' + c?.rows + ' prefixes=' + c?.prefixes);
}
process.exit(0);
