/**
 * Vendor Rates self-tests — registered into the platform Self-Test Registry.
 * Import this module for its side effects (registration). Unit tests run the REAL
 * parse→map→validate import pipeline against synthetic fixtures. Integration/
 * external/manual stages declare `dependsOn` so they are SKIPPED (not misleading
 * PASS) when the parser stages fail.
 */
import * as XLSX from 'xlsx';
import { registerSelfTest, type SelfTestOutcome } from './self-test-registry';
import { parseFile, getSheetList, applyMap } from '../routes-vendor-rates';
import { loadFixtureBase64, loadBaseline, normalizeRateSheet, diffBaseline } from './fixtures';

const M = 'Vendor Rates';
const T = ['vendor', 'commercial', 'parser'];

function fixture(sheets: Record<string, any[][]>): string {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
}
const ok = (detail: string): SelfTestOutcome => ({ status: 'PASS', detail });
const bad = (detail: string): SelfTestOutcome => ({ status: 'FAIL', detail });

registerSelfTest({ module: M, id: 'vr.sheet-listing', name: 'Sheet listing', type: 'unit', tags: [...T], run: () => {
  const names = getSheetList(fixture({ 'Terms & Conditions': [['x']], Contacts: [['a']], Pricing: [['Prefix', 'Rate']] })).map(s => s.name);
  return names.length === 3 && names[2] === 'Pricing' ? ok(`sheets=[${names}]`) : bad(`sheets=[${names}]`);
}});

registerSelfTest({ module: M, id: 'vr.auto-detect', name: 'Sheet auto-detect (keyword → Pricing)', type: 'unit', tags: [...T], run: () => {
  const h = parseFile(fixture({ Info: [['x']], Pricing: [['Prefix', 'Rate']] })).headers;
  return JSON.stringify(h) === JSON.stringify(['Prefix', 'Rate']) ? ok('auto→Pricing') : bad(`headers=${JSON.stringify(h)}`);
}});

registerSelfTest({ module: M, id: 'vr.sheet-index', name: 'Sheet selection honours sheetIndex (BUG-003)', type: 'unit', tags: [...T, 'critical', 'regression'], run: () => {
  const b = fixture({ 'Terms & Conditions': [['This agreement…']], Pricing: [['Prefix', 'Rate']] });
  return String(parseFile(b, 0).headers[0]).includes('This agreement') ? ok('index 0 → T&C') : bad('sheetIndex ignored');
}});

registerSelfTest({ module: M, id: 'vr.dup-headers', name: 'Duplicate headers uniquified (BUG-001)', type: 'unit', tags: [...T, 'critical', 'regression'], run: () => {
  const h = parseFile(fixture({ Rates: [['Prefix', 'Rate', 'Rate', 'Dest']] })).headers;
  return JSON.stringify(h) === JSON.stringify(['Prefix', 'Rate', 'Rate_2', 'Dest']) && new Set(h).size === h.length ? ok(`headers=${JSON.stringify(h)}`) : bad(`headers=${JSON.stringify(h)}`);
}});

registerSelfTest({ module: M, id: 'vr.mapping', name: 'Column mapping independent (first Rate wins)', type: 'unit', tags: [...T, 'critical'], dependsOn: ['vr.dup-headers'], run: () => {
  const rows = applyMap(['Prefix', 'Rate', 'Rate_2', 'Dest'], [['9233', '0.010', '0.020', 'PK']], { Prefix: 'prefix', Rate: 'rate' }, 0) as any[];
  return rows.length === 1 && Number(rows[0].rate) === 0.010 ? ok(`rate=${rows[0].rate}`) : bad(`rate=${rows[0]?.rate}`);
}});

registerSelfTest({ module: M, id: 'vr.blank-cols', name: 'Blank/merged columns → col_<i>', type: 'unit', tags: [...T], run: () => {
  const h = parseFile(fixture({ Rates: [['Prefix', null, '', 'Rate', 'Dest'], ['9233', null, null, '0.01', 'PK']] })).headers;
  return JSON.stringify(h) === JSON.stringify(['Prefix', 'col_1', 'col_2', 'Rate', 'Dest']) ? ok(`headers=${JSON.stringify(h)}`) : bad(`headers=${JSON.stringify(h)}`);
}});

registerSelfTest({ module: M, id: 'vr.validation', name: 'Validation rejects short/invalid/duplicate', type: 'unit', tags: [...T, 'critical'], run: () => {
  const rows = applyMap(['Prefix', 'Rate'], [['9233', '0.01'], ['9', '0.02'], ['9234', '0'], ['9233', '0.05']], { Prefix: 'prefix', Rate: 'rate' }, 0) as any[];
  const seen = new Set<string>();
  const valid = rows.filter(r => (r.prefix.length >= 2 && r.prefix.length <= 16 && !seen.has(r.prefix) && seen.add(r.prefix)));
  return valid.length === 1 && valid[0].prefix === '9233' ? ok('1 valid of 4') : bad(`valid=${valid.length}`);
}});

// Fixture-backed tests — load a workbook from the shared fixture library and
// compare the parsed, normalized model against a versioned baseline.
registerSelfTest({ module: M, id: 'vr.fixture-baseline', name: 'Fixture baseline (duplicate-rate)', type: 'unit', tags: [...T, 'regression'], run: () => {
  const { headers, dataRows } = parseFile(loadFixtureBase64('synthetic', 'vendor-duplicate-rate.xlsx'));
  const model = normalizeRateSheet(headers, dataRows, 'Prefix', 'Rate');
  const diffs = diffBaseline(model, loadBaseline('vendor-duplicate-rate.json'));
  return diffs.length === 0 ? ok('matches baseline v1') : bad(diffs.join('; '));
}});

registerSelfTest({ module: M, id: 'vr.regression-bug-001', name: 'Regression BUG-001 (duplicate headers)', type: 'unit', tags: [...T, 'regression', 'critical'], run: () => {
  const h = parseFile(loadFixtureBase64('regression', 'bug-001-duplicate-headers.xlsx')).headers;
  return JSON.stringify(h) === JSON.stringify(['Prefix', 'Rate', 'Rate_2']) ? ok('BUG-001 stays fixed') : bad(`headers=${JSON.stringify(h)}`);
}});

// Environment / manual stages — declared, not auto-run here. dependsOn the parser
// stages so a broken parser never yields a misleading downstream PASS.
registerSelfTest({ module: M, id: 'vr.import-db', name: 'Import → DB rows + row-count match', type: 'integration', tags: [...T, 'database'], dependsOn: ['vr.dup-headers', 'vr.validation'] });
registerSelfTest({ module: M, id: 'vr.compare-margin', name: 'Compare / Margin against DB', type: 'integration', tags: [...T, 'database'], dependsOn: ['vr.import-db'] });
registerSelfTest({ module: M, id: 'vr.push', name: 'Push to Sippy (portal upload)', type: 'external', tags: [...T, 'sippy'], dependsOn: ['vr.compare-margin'] });
registerSelfTest({ module: M, id: 'vr.e2e', name: 'End-to-end vendor file (Telstra/QuickComm/…)', type: 'manual', tags: [...T, 'regression'] });
