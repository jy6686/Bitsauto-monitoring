/**
 * Parser verification for Vendor Import (fix: duplicate-header uniquification).
 * Verifies parseFile()/getSheetList() against the tricky real-world cases:
 * duplicate headers, blank/merged-cell columns, and multi-sheet selection.
 *
 * Complements — does not replace — validation against real vendor files
 * (Telstra / QuickComm / Tata / BICS / HGC / OTEGlobe) in the deployed app.
 */
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseFile, getSheetList } from './routes-vendor-rates';

/** Build a base64 xlsx from { sheetName: aoa } and return it as parseFile expects. */
function makeXlsx(sheets: Record<string, any[][]>): string {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
}

describe('parseFile header uniquification', () => {
  it('makes duplicate headers unique (first keeps its name)', () => {
    const b64 = makeXlsx({
      Rates: [
        ['Prefix', 'Rate', 'Rate', 'Prefix', 'Dest'],
        ['9233', '0.01', '0.02', '92', 'Pakistan'],
      ],
    });
    const { headers } = parseFile(b64);
    expect(headers).toEqual(['Prefix', 'Rate', 'Rate_2', 'Prefix_2', 'Dest']);
    // all keys unique → no mapping-state collision
    expect(new Set(headers).size).toBe(headers.length);
  });

  it('names blank / merged-remainder columns col_<i>', () => {
    // A merged header cell yields a value in the first col and null in the rest,
    // exactly like a blank column — both must become unique col_<i>.
    // NOTE: parseFile picks the *most-filled* row as the header, so the header
    // row must have >= filled cells than data rows or it is mis-detected
    // (a real edge case for heavily-merged headers — see VR-003 note).
    const b64 = makeXlsx({
      Rates: [
        ['Prefix', null, '', 'Rate', 'Dest'],   // 3 filled
        ['9233', null, null, '0.01', 'PK'],      // 3 filled → tie, header (row 0) wins
      ],
    });
    const { headers } = parseFile(b64);
    expect(headers).toEqual(['Prefix', 'col_1', 'col_2', 'Rate', 'Dest']);
    expect(new Set(headers).size).toBe(headers.length);
  });

  it('lists every worksheet and honours sheetIndex selection', () => {
    const b64 = makeXlsx({
      'Terms & Conditions': [['This agreement...'], ['...']],
      'Contacts': [['Name', 'Email']],
      'Pricing': [['Prefix', 'Rate'], ['9233', '0.01']],
    });
    const sheets = getSheetList(b64);
    expect(sheets.map(s => s.name)).toEqual(['Terms & Conditions', 'Contacts', 'Pricing']);

    // no sheetIndex → keyword auto-detect picks "Pricing"
    expect(parseFile(b64).headers).toEqual(['Prefix', 'Rate']);
    // explicit sheetIndex wins (0 = Terms & Conditions)
    expect(parseFile(b64, 0).headers[0]).toContain('This agreement');
    // explicit Pricing index
    expect(parseFile(b64, 2).headers).toEqual(['Prefix', 'Rate']);
  });

  it('handles triple duplicates', () => {
    const b64 = makeXlsx({ Rates: [['A', 'A', 'A'], ['1', '2', '3']] });
    expect(parseFile(b64).headers).toEqual(['A', 'A_2', 'A_3']);
  });
});
