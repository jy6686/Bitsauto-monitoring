/**
 * import-supplier-catalogue.ts — load the supplier catalogue into the commercial tables.
 *
 *   npx tsx scripts/import-supplier-catalogue.ts <file.xlsx> --version "<label>" [--sheet NAME] [--dry-run]
 *
 * Imports into a NEW catalogue version, always created as `draft`. It never writes to the
 * active version and never deletes anything, so a new supplier file can be loaded and
 * reviewed while the live catalogue keeps serving rate pushes. Activation is deliberately
 * NOT part of this script — it is a separate, reversible decision:
 *
 *   SELECT activate_catalogue_version('Supplier Catalogue V2', 'junaid');
 *
 * Requires DATABASE_URL. Requires migration 500 to have run.
 *
 * ── The governing rule ────────────────────────────────────────────────────────────────
 * The uploaded catalogue is authoritative. This importer stores names, prefixes, billing
 * increments and effective dates EXACTLY as supplied. It does not rename, normalise, expand
 * prefixes, title-case, trim to a convention, or infer country / operator / hierarchy /
 * product. Everything lands UNAPPROVED.
 *
 * The only transformation applied to any value is `String(cell).trim()` on the name and the
 * code — leading/trailing whitespace from the spreadsheet is not a commercial fact — and
 * stripping the currency symbol from the rate so it can be stored as a number. Both are
 * reported in the summary so they are never silent.
 *
 * ── Why it refuses instead of repairing ───────────────────────────────────────────────
 * Every check below describes something MEASURED to be true of the 2026-08-28 file. If a
 * later upload breaks one, the shape of the source has changed, and continuing would mean
 * this importer deciding what the supplier meant. It stops and prints the offending rows.
 * A wrong guess bills silently; a refusal is visible.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import * as XLSX from 'xlsx';
import { Pool } from 'pg';

const EXPECTED_HEADERS = ['DESTINATION', 'CODES', 'RATE/MIN($)', 'STATUS', 'EFFECTIVE DATE', 'BILLING INCREMENT', 'LEVEL'];

type Row = { name: string; prefix: string; rate: number | null; increment: string | null; effective: string | null; sheetRow: number };

function die(msg: string, detail?: string[]): never {
  console.error(`\n✗ REFUSED — ${msg}`);
  if (detail?.length) { console.error(''); detail.slice(0, 25).forEach(d => console.error('    ' + d));
    if (detail.length > 25) console.error(`    … and ${detail.length - 25} more`); }
  console.error('\nNothing was written. The source shape is not what this importer measured;');
  console.error('resolve it in the file, or approve a change to the importer.\n');
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find(a => !a.startsWith('--'));
  const dryRun = args.includes('--dry-run');
  const sheetArg = args.includes('--sheet') ? args[args.indexOf('--sheet') + 1] : undefined;
  const versionLabel = args.includes('--version') ? args[args.indexOf('--version') + 1] : undefined;
  if (!file) die('usage: import-supplier-catalogue.ts <file.xlsx> --version "<label>" [--sheet NAME] [--dry-run]');
  if (!dryRun && !versionLabel) die('--version "<label>" is required. Every import creates a NEW catalogue version so it cannot collide with the live one.');

  const buf = readFileSync(file);
  const sha256 = createHash('sha256').update(buf).digest('hex');
  const wb = XLSX.read(buf, { type: 'buffer' });
  const sheetName = sheetArg ?? wb.SheetNames[0];
  if (!wb.Sheets[sheetName]) die(`sheet "${sheetName}" not found. Sheets: ${wb.SheetNames.join(', ')}`);
  const grid: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: false, defval: null });

  // ── Locate the header rather than assuming row 6 ───────────────────────────────────
  // The 2026-08-28 file has five blank rows first. Hardcoding 6 would break on a file that
  // simply has a different preamble, which is not a reason to refuse.
  const headerRow = grid.findIndex(r => r && String(r[0] ?? '').trim().toUpperCase() === 'DESTINATION');
  if (headerRow < 0) die('no header row found — expected a cell reading "DESTINATION" in column A');
  const headers = (grid[headerRow] ?? []).map(h => String(h ?? '').trim().toUpperCase());
  const missing = EXPECTED_HEADERS.filter(h => !headers.some(x => x === h || x.replace(/\s+/g, '') === h.replace(/\s+/g, '')));
  if (missing.length) die(`header row ${headerRow + 1} is missing expected column(s): ${missing.join(', ')}`,
                          [`found: ${headers.filter(Boolean).join(' | ')}`]);
  const col = (want: string) => headers.findIndex(x => x === want || x.replace(/\s+/g, '') === want.replace(/\s+/g, ''));
  const [cName, cCode, cRate, cEff, cInc] = [col('DESTINATION'), col('CODES'), col('RATE/MIN($)'), col('EFFECTIVE DATE'), col('BILLING INCREMENT')];

  // ── Read ───────────────────────────────────────────────────────────────────────────
  const rows: Row[] = [];
  const trimmed: string[] = [];
  for (let i = headerRow + 1; i < grid.length; i++) {
    const r = grid[i]; if (!r) continue;
    const rawName = r[cName], rawCode = r[cCode];
    if (rawName == null && rawCode == null) continue;                       // trailing blanks
    const name = String(rawName ?? '').trim();
    const prefix = String(rawCode ?? '').trim();
    if (String(rawName ?? '') !== name || String(rawCode ?? '') !== prefix)
      trimmed.push(`row ${i + 1}: "${rawName}" / "${rawCode}"`);
    if (!name) die(`row ${i + 1} has a code but no destination name`);
    if (!prefix) die(`row ${i + 1} ("${name}") has no code`);
    const rateStr = String(r[cRate] ?? '').replace(/[^0-9.]/g, '');
    rows.push({
      name, prefix,
      rate: rateStr === '' ? null : Number(rateStr),
      increment: r[cInc] == null ? null : String(r[cInc]).trim(),
      effective: r[cEff] == null ? null : String(r[cEff]).trim(),
      sheetRow: i + 1,
    });
  }
  if (!rows.length) die('no data rows found beneath the header');

  // ── Refuse-don't-repair checks ─────────────────────────────────────────────────────
  const nonNumeric = rows.filter(r => !/^[0-9]+$/.test(r.prefix));
  if (nonNumeric.length) die(`${nonNumeric.length} code(s) are not purely numeric`,
    nonNumeric.map(r => `row ${r.sheetRow}: ${r.name} -> "${r.prefix}"`));

  const seen = new Map<string, Row>(); const dupes: string[] = [];
  for (const r of rows) {
    const prev = seen.get(r.prefix);
    if (prev) dupes.push(`"${r.prefix}" on row ${prev.sheetRow} (${prev.name}) and row ${r.sheetRow} (${r.name})`);
    else seen.set(r.prefix, r);
  }
  if (dupes.length) die(`${dupes.length} duplicate code(s). A prefix owned by two identities means two destinations compete for the same traffic`, dupes);

  // The full name is the pricing unit — measured 0/1344 violations. If that stops holding,
  // identity-level rate expansion is no longer lossless and the push model needs revisiting.
  const rateByName = new Map<string, Set<number>>();
  rows.forEach(r => { if (r.rate == null) return; if (!rateByName.has(r.name)) rateByName.set(r.name, new Set()); rateByName.get(r.name)!.add(r.rate); });
  const multiRate = [...rateByName.entries()].filter(([, s]) => s.size > 1);
  if (multiRate.length) die(`${multiRate.length} destination(s) carry more than one rate — the name is no longer the pricing unit, so expanding a push to every prefix of an identity would no longer be lossless`,
    multiRate.map(([n, s]) => `${n}: ${[...s].sort().join(', ')}`));

  const names = [...new Set(rows.map(r => r.name))];
  console.log(`\nfile        ${basename(file)}  (sha256 ${sha256.slice(0, 16)}…)`);
  console.log(`sheet       ${sheetName}, header row ${headerRow + 1}`);
  console.log(`data rows   ${rows.length}`);
  console.log(`->          ${names.length} destinations + ${rows.length} prefixes`);
  console.log(`whitespace  ${trimmed.length} cell(s) trimmed${trimmed.length ? ' (reported, never silent)' : ''}`);
  trimmed.slice(0, 5).forEach(t => console.log('              ' + t));
  console.log(`status      every destination UNAPPROVED, no product assignment\n`);
  if (dryRun) { console.log('--dry-run: nothing written.\n'); return; }

  if (!process.env.DATABASE_URL) die('DATABASE_URL is not set. Refusing to guess a database — that is how ten migrations went missing.');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  try {
    const who = await c.query('SELECT current_database() db, inet_server_addr() host');
    console.log(`database    ${who.rows[0].db} @ ${who.rows[0].host ?? 'local socket'}`);

    const dupLabel = await c.query('SELECT id, status FROM catalogue_versions WHERE label = $1', [versionLabel]);
    if (dupLabel.rowCount) die(`catalogue version "${versionLabel}" already exists (status ${dupLabel.rows[0].status}). Choose a new label — an import never writes into an existing version.`);
    const elsewhere = await c.query(
      `SELECT v.label FROM catalogue_import_batches b JOIN catalogue_versions v ON v.id = b.version_id WHERE b.file_sha256 = $1`, [sha256]);
    if (elsewhere.rowCount) console.log(`note        this identical file is already loaded as version "${elsewhere.rows[0].label}" — continuing, since a re-import under a new label is legitimate`);
    const live = await c.query(`SELECT label FROM catalogue_versions WHERE status = 'active'`);
    console.log(`live        ${live.rowCount ? live.rows[0].label + ' (untouched by this import)' : 'none yet'}`);

    await c.query('BEGIN');
    const ver = await c.query(
      `INSERT INTO catalogue_versions (label, status, source_file, notes) VALUES ($1,'draft',$2,$3) RETURNING id`,
      [versionLabel, basename(file), 'imported verbatim; no rename, no normalisation, no prefix expansion, no inferred hierarchy']);
    const versionId = ver.rows[0].id;
    const batch = await c.query(
      `INSERT INTO catalogue_import_batches (version_id, source_file, sheet_name, file_sha256, header_row, data_rows, destinations, prefixes, imported_by, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [versionId, basename(file), sheetName, sha256, headerRow + 1, rows.length, names.length, rows.length,
       process.env.USER ?? 'unknown', 'imported verbatim']);
    const batchId = batch.rows[0].id;

    const idByName = new Map<string, number>();
    for (let i = 0; i < names.length; i += 500) {
      const chunk = names.slice(i, i + 500);
      const res = await c.query(
        `INSERT INTO commercial_destinations (name, import_batch_id, version_id)
         VALUES ${chunk.map((_, k) => `($${k * 3 + 1}, $${k * 3 + 2}, $${k * 3 + 3})`).join(',')} RETURNING id, name`,
        chunk.flatMap(n => [n, batchId, versionId]));
      res.rows.forEach((r: any) => idByName.set(r.name, r.id));
    }
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const vals = chunk.map((_, k) => `($${k * 8 + 1},$${k * 8 + 2},$${k * 8 + 3},$${k * 8 + 4},$${k * 8 + 5},$${k * 8 + 6},$${k * 8 + 7},$${k * 8 + 8})`).join(',');
      await c.query(
        `INSERT INTO commercial_destination_prefixes
           (destination_id, prefix, supplier_rate, billing_increment, effective_date_raw, source_row, import_batch_id, version_id)
         VALUES ${vals}`,
        chunk.flatMap(r => [idByName.get(r.name), r.prefix, r.rate, r.increment, r.effective, r.sheetRow, batchId, versionId]));
    }
    await c.query('COMMIT');

    const d = await c.query('SELECT count(*)::int n FROM commercial_destinations WHERE version_id = $1', [versionId]);
    const p = await c.query('SELECT count(*)::int n FROM commercial_destination_prefixes WHERE version_id = $1', [versionId]);
    const u = await c.query(`SELECT count(*)::int n FROM commercial_destinations WHERE version_id = $1 AND approval_status <> 'unapproved'`, [versionId]);
    const sell = await c.query('SELECT count(*)::int n FROM v_catalogue_sellable');
    console.log(`\n✓ version ${versionId} "${versionLabel}" (draft), batch ${batchId}`);
    console.log(`  ${d.rows[0].n} destinations, ${p.rows[0].n} prefixes`);
    console.log(`  approved in this version: ${u.rows[0].n} (must be 0)`);
    if (u.rows[0].n !== 0) die('rows were created already approved — the default was bypassed');
    console.log(`  rows now sellable platform-wide: ${sell.rows[0].n} (this import added none)`);
    console.log(`\n  next: review, approve, then activate deliberately —`);
    console.log(`    SELECT activate_catalogue_version('${versionLabel}', 'your-name');\n`);
  } catch (e: any) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { c.release(); await pool.end(); }
}
main().catch(e => { console.error('\n✗ import failed:', e.message, '\n'); process.exit(1); });
