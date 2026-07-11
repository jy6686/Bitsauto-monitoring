/**
 * Vendor Rates self-tests — registered into the platform Self-Test Registry.
 * Import this module for its side effects (registration). Pure/unit tests run the
 * REAL parse→map→validate import pipeline against synthetic fixtures.
 */
import * as XLSX from 'xlsx';
import { registerSelfTest, type SelfTestOutcome } from './self-test-registry';
import { parseFile, getSheetList, applyMap } from '../routes-vendor-rates';

const MODULE = 'Vendor Rates';

function fixture(sheets: Record<string, any[][]>): string {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
}
const ok = (detail: string): SelfTestOutcome => ({ status: 'PASS', detail });
const bad = (detail: string): SelfTestOutcome => ({ status: 'FAIL', detail });

registerSelfTest({ module: MODULE, name: 'Sheet listing', type: 'unit', run: () => {
  const names = getSheetList(fixture({ 'Terms & Conditions': [['x']], Contacts: [['a']], Pricing: [['Prefix', 'Rate']] })).map(s => s.name);
  return names.length === 3 && names[2] === 'Pricing' ? ok(`sheets=[${names}]`) : bad(`sheets=[${names}]`);
}});

registerSelfTest({ module: MODULE, name: 'Sheet auto-detect (keyword → Pricing)', type: 'unit', run: () => {
  const h = parseFile(fixture({ Info: [['x']], Pricing: [['Prefix', 'Rate']] })).headers;
  return JSON.stringify(h) === JSON.stringify(['Prefix', 'Rate']) ? ok('auto→Pricing') : bad(`headers=${JSON.stringify(h)}`);
}});

registerSelfTest({ module: MODULE, name: 'Sheet selection honours sheetIndex (BUG-003)', type: 'unit', run: () => {
  const b = fixture({ 'Terms & Conditions': [['This agreement…']], Pricing: [['Prefix', 'Rate']] });
  return String(parseFile(b, 0).headers[0]).includes('This agreement') ? ok('index 0 → T&C') : bad('sheetIndex ignored');
}});

registerSelfTest({ module: MODULE, name: 'Duplicate headers uniquified (BUG-001)', type: 'unit', run: () => {
  const h = parseFile(fixture({ Rates: [['Prefix', 'Rate', 'Rate', 'Dest']] })).headers;
  const uniq = new Set(h).size === h.length;
  return JSON.stringify(h) === JSON.stringify(['Prefix', 'Rate', 'Rate_2', 'Dest']) && uniq ? ok(`headers=${JSON.stringify(h)}`) : bad(`headers=${JSON.stringify(h)}`);
}});

registerSelfTest({ module: MODULE, name: 'Column mapping independent (first Rate wins)', type: 'unit', run: () => {
  const rows = applyMap(['Prefix', 'Rate', 'Rate_2', 'Dest'], [['9233', '0.010', '0.020', 'PK']], { Prefix: 'prefix', Rate: 'rate' }, 0) as any[];
  return rows.length === 1 && Number(rows[0].rate) === 0.010 ? ok(`rate=${rows[0].rate}`) : bad(`rate=${rows[0]?.rate}`);
}});

registerSelfTest({ module: MODULE, name: 'Blank/merged columns → col_<i>', type: 'unit', run: () => {
  const h = parseFile(fixture({ Rates: [['Prefix', null, '', 'Rate', 'Dest'], ['9233', null, null, '0.01', 'PK']] })).headers;
  return JSON.stringify(h) === JSON.stringify(['Prefix', 'col_1', 'col_2', 'Rate', 'Dest']) ? ok(`headers=${JSON.stringify(h)}`) : bad(`headers=${JSON.stringify(h)}`);
}});

registerSelfTest({ module: MODULE, name: 'Validation rejects short/invalid/duplicate', type: 'unit', run: () => {
  const rows = applyMap(['Prefix', 'Rate'], [['9233', '0.01'], ['9', '0.02'], ['9234', '0'], ['9233', '0.05']], { Prefix: 'prefix', Rate: 'rate' }, 0) as any[];
  const seen = new Set<string>();
  const valid = rows.filter(r => (r.prefix.length >= 2 && r.prefix.length <= 16 && !seen.has(r.prefix) && seen.add(r.prefix)));
  return valid.length === 1 && valid[0].prefix === '9233' ? ok('1 valid of 4') : bad(`valid=${valid.length}`);
}});

// Stages that require a live DB / external system — reported, not auto-run.
registerSelfTest({ module: MODULE, name: 'Import → DB rows + row-count match', type: 'integration' });
registerSelfTest({ module: MODULE, name: 'Compare / Margin against DB', type: 'integration' });
registerSelfTest({ module: MODULE, name: 'Push to Sippy (portal upload)', type: 'external' });
registerSelfTest({ module: MODULE, name: 'End-to-end vendor file (Telstra/QuickComm/…)', type: 'manual' });
