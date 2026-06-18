#!/usr/bin/env tsx
/**
 * Standalone XLSX download → patch → upload → verify end-to-end tester.
 * Does NOT import sippy.ts — uses only node built-ins and xlsx.
 *
 * Usage:
 *   npx tsx scripts/test-xlsx-download.ts
 *
 * Reads from env:
 *   SIPP_URL               e.g. https://191.101.30.107
 *   SIPPY_PROV_USERNAME    e.g. ssp-root
 *   SIPPY_PROV_PASSWORD    e.g. <admin_web_password>
 *
 * Outputs:
 *   /tmp/sippy-original-<tariff>.xlsx  — raw download from Sippy
 *   /tmp/sippy-patched-<tariff>.xlsx   — after patch (rate changed to TEST_RATE)
 */

import https from 'node:https';
import http  from 'node:http';
import { URL } from 'node:url';
import { writeFileSync } from 'node:fs';
import * as XLSX from 'xlsx';

// ── Config ──────────────────────────────────────────────────────────────────
const TARIFF_ID   = 33;
const TARGET_PFX  = '19230';
const TEST_RATE   = 0.0270;       // clearly different from current 0.0274
const BASE_URL    = process.env.SIPP_URL ?? 'https://191.101.30.107';
const USERNAME    = process.env.SIPPY_PROV_USERNAME ?? '';
const PASSWORD    = process.env.SIPPY_PROV_PASSWORD ?? '';
const UA          = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0';

// Lenient HTTPS agent — Sippy uses self-signed certs in many installs
const lenientAgent = new https.Agent({ rejectUnauthorized: false });

// ── Cookie jar ──────────────────────────────────────────────────────────────
type Jar = Map<string, string>;

function parseCookies(headers: string[]): Jar {
  const jar: Jar = new Map();
  for (const h of headers) {
    const pair = h.split(';')[0]?.trim() ?? '';
    const eq   = pair.indexOf('=');
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
  return jar;
}
function mergeCookies(a: Jar, b: Jar): Jar {
  const m = new Map(a);
  for (const [k, v] of b) m.set(k, v);
  return m;
}
function serCookies(j: Jar): string {
  return [...j.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────
function strRequest(
  method: 'GET' | 'POST', url: string, body: string | null,
  jar: Jar, extra: Record<string, string> = {}, redirects = 5,
): Promise<{ status: number; body: string; jar: Jar; location?: string }> {
  return new Promise((resolve, reject) => {
    const p      = new URL(url);
    const isHttps = p.protocol === 'https:';
    const mod: any = isHttps ? https : http;
    const ck     = serCookies(jar);
    const opts: any = {
      hostname: p.hostname,
      port:     p.port ? +p.port : (isHttps ? 443 : 80),
      path:     p.pathname + p.search,
      method,
      headers: {
        ...(ck ? { Cookie: ck } : {}),
        'User-Agent': UA,
        ...(body != null ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } : {}),
        ...extra,
      },
      timeout: 20000,
      ...(isHttps ? { agent: lenientAgent } : {}),
    };
    const req = mod.request(opts, (res: any) => {
      const newJar = mergeCookies(jar, parseCookies((res.headers['set-cookie'] as string[] | undefined) ?? []));
      const loc    = res.headers.location as string | undefined;
      const sc     = res.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(sc) && loc && redirects > 0) {
        res.resume();
        const next   = new URL(loc, url).toString();
        const meth   = [301, 302, 303].includes(sc) ? 'GET' : method;
        strRequest(meth, next, meth === 'GET' ? null : body, newJar, extra, redirects - 1).then(resolve).catch(reject);
        return;
      }
      let data = '';
      res.on('data', (c: any) => { data += c; });
      res.on('end', () => resolve({ status: sc, body: data, jar: newJar, location: loc }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

function binRequest(url: string, jar: Jar): Promise<{ status: number; buf: Buffer; ct: string; jar: Jar }> {
  return new Promise((resolve, reject) => {
    const p      = new URL(url);
    const isHttps = p.protocol === 'https:';
    const mod: any = isHttps ? https : http;
    const ck     = serCookies(jar);
    const opts: any = {
      hostname: p.hostname,
      port:     p.port ? +p.port : (isHttps ? 443 : 80),
      path:     p.pathname + p.search,
      method:   'GET',
      headers:  {
        ...(ck ? { Cookie: ck } : {}),
        'User-Agent': UA,
        Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*',
      },
      timeout: 20000,
      ...(isHttps ? { agent: lenientAgent } : {}),
    };
    const req = mod.request(opts, (res: any) => {
      const newJar = mergeCookies(jar, parseCookies((res.headers['set-cookie'] as string[] | undefined) ?? []));
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode ?? 0,
        buf:    Buffer.concat(chunks),
        ct:     String(res.headers['content-type'] ?? ''),
        jar:    newJar,
      }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

// ── Resumable.js single-chunk upload ──────────────────────────────────────────
// Sippy's /c1/rates_tariff.php uses Resumable.js for file uploads.
// The client submits one chunk per file (XLSX < 1MB) with Resumable metadata fields.
// Target URL: rates_tariff.php?file_uploader=true&i_tariff=N&wrapped_file_name=rates_tariff.php&action=import
function uploadXlsx(
  base: string, tariffId: number, xlsxBuf: Buffer, jar: Jar,
): Promise<{ status: number; body: string; jar: Jar }> {
  const boundary  = `----ResumableBoundary${Date.now()}`;
  const mimeType  = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const filename  = `internal-ptcl_Rates.xlsx`;
  const filesize  = xlsxBuf.length;
  const chunkSize = 1048576;  // Resumable.js default
  const identifier = `${filesize}-${filename.replace(/[^a-zA-Z0-9]/g, '')}`;

  // Build Resumable.js multipart body (single chunk = entire file)
  const fields: Array<[string, string | Buffer, string?]> = [
    ['resumableChunkNumber',      '1'],
    ['resumableTotalChunks',      '1'],
    ['resumableChunkSize',        String(chunkSize)],
    ['resumableCurrentChunkSize', String(filesize)],
    ['resumableTotalSize',        String(filesize)],
    ['resumableIdentifier',       identifier],
    ['resumableFilename',         filename],
    ['resumableRelativePath',     filename],
    ['resumableType',             mimeType],
    ['file',                      xlsxBuf, filename],
  ];

  const parts: Buffer[] = [];
  for (const [name, value, fname] of fields) {
    if (fname) {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${fname}"\r\nContent-Type: ${mimeType}\r\n\r\n`));
      parts.push(value as Buffer);
      parts.push(Buffer.from('\r\n'));
    } else {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
    }
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  const body = Buffer.concat(parts);

  const uploadUrl = `${base}/c1/rates_tariff.php?file_uploader=true&i_tariff=${tariffId}&wrapped_file_name=rates_tariff.php&action=import`;

  return new Promise((resolve, reject) => {
    const p      = new URL(uploadUrl);
    const isHttps = p.protocol === 'https:';
    const mod: any = isHttps ? https : http;
    const ck     = serCookies(jar);
    const opts: any = {
      hostname: p.hostname,
      port:     p.port ? +p.port : (isHttps ? 443 : 80),
      path:     p.pathname + p.search,
      method:   'POST',
      headers:  {
        ...(ck ? { Cookie: ck } : {}),
        'User-Agent':     UA,
        'Content-Type':   `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
        'Referer':        `${base}/c1/rates_tariff.php?i_tariff=${tariffId}`,
        'X-Requested-With': 'XMLHttpRequest',
      },
      timeout: 30000,
      ...(isHttps ? { agent: lenientAgent } : {}),
    };
    const req = mod.request(opts, (res: any) => {
      const newJar = mergeCookies(jar, parseCookies((res.headers['set-cookie'] as string[] | undefined) ?? []));
      let data = '';
      res.on('data', (c: any) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data, jar: newJar }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

// ── Portal login ─────────────────────────────────────────────────────────────
async function login(base: string, username: string, password: string): Promise<Jar | null> {
  const loginUrl = `${base}/main.php`;
  for (const acctType of ['customer', 'reseller', 'account', 'admin']) {
    const body = `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&acct_type=${acctType}&login_page=all&Login=Login`;
    const resp = await strRequest('POST', loginUrl, body, new Map(), {}, 0);
    const loc  = resp.location ?? '';
    if ((resp.status === 302 || resp.status === 301) && (loc.includes('/c1/') || loc.includes('/admin/'))) {
      console.log(`✓ Login OK: ${username}/${acctType} → ${loc}`);
      // Follow the redirect to get full session cookies
      const r2 = await strRequest('GET', new URL(loc, base).toString(), null, resp.jar);
      return r2.jar;
    }
    if (resp.status === 200 && (resp.body.includes('Logout') || resp.body.includes('logout'))) {
      console.log(`✓ Login OK (200): ${username}/${acctType}`);
      return resp.jar;
    }
    console.log(`  Login ${username}/${acctType} → HTTP ${resp.status} loc="${loc}" — trying next`);
  }
  return null;
}

// ── Download XLSX ─────────────────────────────────────────────────────────────
async function downloadXlsx(base: string, tariffId: number, jar: Jar): Promise<Buffer | null> {
  const candidates = [
    // ✓ CONFIRMED: Sippy's download() JS submits navform with action=download (lowercase)
    `${base}/c1/rates_tariff.php?i_tariff=${tariffId}&action=download`,
    // Legacy fallbacks for other Sippy versions
    `${base}/c1/rates_tariff.php?i_tariff=${tariffId}&action=Export`,
    `${base}/c1/rates_tariff.php?i_tariff=${tariffId}&action=export`,
    `${base}/c1/rates_tariff.php?i_tariff=${tariffId}&export=xlsx`,
    `${base}/c1/rates_tariff.php?i_tariff=${tariffId}&export=1`,
    `${base}/c1/rates_tariff.php?i_tariff=${tariffId}&output=xlsx`,
    `${base}/c1/rates.php?i_tariff=${tariffId}&action=Export`,
  ];
  for (const url of candidates) {
    try {
      const r = await binRequest(url, jar);
      const isXlsx = r.ct.toLowerCase().includes('spreadsheet') || r.ct.toLowerCase().includes('excel') ||
                     r.ct.toLowerCase().includes('openxml') || r.ct.toLowerCase().includes('octet-stream');
      const magic  = r.buf.length > 4 && r.buf[0] === 0x50 && r.buf[1] === 0x4b && r.buf[2] === 0x03 && r.buf[3] === 0x04;
      console.log(`  Probe: ${url} → HTTP ${r.status} ct="${r.ct}" size=${r.buf.length}B xlsx=${isXlsx} magic=${magic}`);
      if (r.status === 200 && r.buf.length > 200 && (isXlsx || magic)) {
        console.log(`✓ Download SUCCESS: ${url} (${r.buf.length} bytes)`);
        return r.buf;
      }
      if (!magic && r.buf.length < 2000) {
        console.log(`  Response preview: ${r.buf.toString('utf8').slice(0, 200).replace(/\s+/g, ' ')}`);
      }
    } catch (e: any) {
      console.log(`  Probe: ${url} → ERROR: ${e.message}`);
    }
  }
  return null;
}

// ── Parse + dump XLSX structure ────────────────────────────────────────────
function dumpXlsx(buf: Buffer, label: string): void {
  const wb  = XLSX.read(buf, { type: 'buffer' });
  const ws  = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];

  console.log(`\n${'─'.repeat(80)}`);
  console.log(`${label} — ${aoa.length - 1} data rows, sheet="${wb.SheetNames[0]}"`);
  console.log(`${'─'.repeat(80)}`);
  if (aoa.length === 0) { console.log('  (empty sheet)'); return; }

  const hdr = aoa[0] as string[];
  console.log(`  HEADER: [${hdr.map((h, i) => `${i}:${h}`).join(' | ')}]`);
  for (let i = 1; i < aoa.length; i++) {
    const row = aoa[i];
    const isTarget = String(row[2] ?? '').trim() === TARGET_PFX;
    const tag      = isTarget ? '  ← TARGET' : '';
    console.log(`  ROW ${i}: Action=${row[0]} ID=${row[1]} Prefix=${row[2]} Country="${row[3]}" Int1=${row[4]} IntN=${row[5]} Price1=${row[6]} PriceN=${row[7]} Forbidden=${row[8]} Grace=${row[9]} From=${row[10]} Till=${row[11]}${tag}`);
  }
}

// ── Patch XLSX ────────────────────────────────────────────────────────────────
function patchXlsx(buf: Buffer, targetPrefix: string, newRate: number): { buf: Buffer; patchedRows: number } {
  const wb  = XLSX.read(buf, { type: 'buffer' });
  const wsName = wb.SheetNames[0];
  const ws  = wb.Sheets[wsName];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];

  const hdr = aoa[0].map((h: any) => String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, ''));
  const col = (...pats: RegExp[]) => { for (const p of pats) { const i = hdr.findIndex((h: string) => p.test(h)); if (i >= 0) return i; } return -1; };
  const C_ACTION = col(/^action/);
  const C_PREFIX = col(/^prefix/);
  const C_PRICE1 = col(/^price1/, /^price_1/);
  const C_PRICEN = col(/^pricen/, /^price_n/);

  console.log(`  Column map: action=${C_ACTION} prefix=${C_PREFIX} price1=${C_PRICE1} priceN=${C_PRICEN}`);

  let patchedRows = 0;
  for (let i = 1; i < aoa.length; i++) {
    const row = aoa[i];
    if (!row || row[C_PREFIX] == null) continue;
    if (C_ACTION >= 0) row[C_ACTION] = 'U';
    if (String(row[C_PREFIX]).trim() === targetPrefix) {
      const oldPrice = row[C_PRICE1];
      if (C_PRICE1 >= 0) row[C_PRICE1] = newRate;
      if (C_PRICEN >= 0) row[C_PRICEN] = newRate;
      console.log(`  PATCH row ${i}: Prefix=${targetPrefix} Price1 ${oldPrice} → ${newRate}`);
      patchedRows++;
    }
  }
  const newWs = XLSX.utils.aoa_to_sheet(aoa);
  wb.Sheets[wsName] = newWs;
  return { buf: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer, patchedRows };
}

// ── Verify via XML-RPC ────────────────────────────────────────────────────────
async function verifyRate(base: string, tariffId: number, prefix: string): Promise<number | null> {
  const xmlBody = `<?xml version="1.0"?><methodCall><methodName>getTariffRatesList</methodName><params><param><value><struct><member><name>i_tariff</name><value><int>${tariffId}</int></value></member></struct></value></param></params></methodCall>`;

  const apiUser = process.env.SIPPY_API_USERNAME ?? '';
  const apiPass = process.env.SIPPY_API_PASSWORD ?? '';
  if (!apiUser) {
    console.log('  (SIPPY_API_USERNAME not set — skipping XML-RPC verify)');
    return null;
  }

  const auth  = Buffer.from(`${apiUser}:${apiPass}`).toString('base64');
  const r = await strRequest('POST', `${base}/xmlapi/xmlapi`, xmlBody, new Map(), {
    'Content-Type':   'text/xml',
    'Authorization':  `Basic ${auth}`,
  });

  const prefixMatch  = r.body.match(new RegExp(`<name>prefix<\\/name><value><string>${prefix}<\\/string>`, 'g'));
  if (!prefixMatch) { console.log('  verify: prefix not found in XML-RPC response'); return null; }
  const priceMatch = r.body.match(/<name>price_1<\/name><value><double>([\d.]+)<\/double>/g);
  if (!priceMatch) return null;
  const prices = priceMatch.map(m => parseFloat(m.replace(/<[^>]+>/g, '')));
  return prices[0] ?? null;
}

// ── Excel serial → date string ─────────────────────────────────────────────────
// Excel epoch is December 30, 1899 (accounts for the spurious 1900 leap year).
function excelSerialToDateStr(serial: number): string {
  const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
  const ms = EXCEL_EPOCH_MS + serial * 86400000;
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth()+1)}-${p(d.getUTCDate())} ` +
         `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

// ── Parse XLSX for rate edit fields ──────────────────────────────────────────
// Returns iRate and all current field values needed for action=change GET.
function parseXlsxForEdit(buf: Buffer, targetPrefix: string): {
  iRate: number; interval1: number; intervalN: number;
  forbidden: number; gracePeriodEnable: number;
  activationDate: string; expirationDate: string;
} | null {
  const wb  = XLSX.read(buf, { type: 'buffer' });
  const ws  = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as any[][];

  for (let i = 1; i < aoa.length; i++) {
    const row = aoa[i];
    if (!row || row.length < 3) continue;
    if (String(row[2] ?? '').trim() !== targetPrefix) continue;

    const iRate          = Number(row[1]) || 0;
    if (!iRate) continue;
    const interval1      = Number(row[4]) || 1;
    const intervalN      = Number(row[5]) || 1;
    const forbidden      = Number(row[8]) || 0;
    const graceNum       = Number(row[9]) || 0;
    const gracePeriodEnable = graceNum > 0 ? 1 : 0;
    const actSerial      = row[10];
    const expSerial      = row[11];
    const activationDate = (typeof actSerial === 'number' && actSerial > 0) ? excelSerialToDateStr(actSerial) : '';
    const expirationDate = (typeof expSerial === 'number' && expSerial > 0) ? excelSerialToDateStr(expSerial) : '';
    return { iRate, interval1, intervalN, forbidden, gracePeriodEnable, activationDate, expirationDate };
  }
  return null;
}

// ── Submit action=change (individual rate edit) ────────────────────────────────
// CONFIRMED WORKING (tested 2026-06-18): GET to rates_tariff.php?action=change&...
// returns HTTP 200 with the full rates page showing the updated price.
async function changeRate(
  base: string, tariffId: number, iRate: number, prefix: string,
  newRate: number, interval1: number, intervalN: number,
  forbidden: number, gracePeriodEnable: number,
  activationDate: string, expirationDate: string,
  jar: Jar,
): Promise<{ status: number; body: string; jar: Jar }> {
  const params: Record<string, string> = {
    action:              'change',
    i_tariff:            String(tariffId),
    i_rate:              String(iRate),
    prefix,
    interval_1:          String(interval1),
    interval_n:          String(intervalN),
    price_1:             String(newRate),
    price_n:             String(newRate),
    'filter_clause[0]':  '',
    save_and_close:      'Save & Close',
  };
  if (forbidden)         params.forbidden            = '1';
  if (gracePeriodEnable) params.grace_period_enable  = '1';
  if (activationDate)    params.activation_date       = activationDate;
  if (expirationDate)    params.expiration_date        = expirationDate;

  const qs  = new URLSearchParams(params).toString();
  const url = `${base}/c1/rates_tariff.php?${qs}`;
  return strRequest('GET', url, null, jar, {
    Referer: `${base}/c1/rates_tariff.php?action=edit&i_rate=${iRate}&i_tariff=${tariffId}`,
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${'═'.repeat(80)}`);
  console.log(`  Sippy Rate Edit — action=change end-to-end test`);
  console.log(`  Base: ${BASE_URL}   Tariff: ${TARIFF_ID}   Target: ${TARGET_PFX}   NewRate: ${TEST_RATE}`);
  console.log(`${'═'.repeat(80)}\n`);

  if (!USERNAME || !PASSWORD) {
    console.log('ERROR: SIPPY_PROV_USERNAME and SIPPY_PROV_PASSWORD must be set');
    process.exit(1);
  }

  // Step 1: Login
  console.log('Step 1: Portal login');
  let jar = await login(BASE_URL, USERNAME, PASSWORD);
  if (!jar) { console.log('FAIL: Could not log in'); process.exit(1); }

  // Step 2: Download XLSX to discover iRate + field values
  console.log('\nStep 2: Download tariff XLSX to find iRate and field values');
  const originalBuf = await downloadXlsx(BASE_URL, TARIFF_ID, jar);
  if (!originalBuf) {
    console.log('\nFAIL: Could not download XLSX from any candidate URL.');
    process.exit(1);
  }
  const origPath = `/tmp/sippy-original-${TARIFF_ID}.xlsx`;
  writeFileSync(origPath, originalBuf);
  dumpXlsx(originalBuf, 'ORIGINAL (from Sippy)');

  // Step 3: Parse XLSX for iRate and current field values
  console.log('\nStep 3: Parse XLSX for iRate and current field values');
  const fields = parseXlsxForEdit(originalBuf, TARGET_PFX);
  if (!fields) {
    console.log(`FAIL: Prefix ${TARGET_PFX} not found in XLSX or iRate is 0`);
    process.exit(1);
  }
  console.log(`  ✓ Found iRate=${fields.iRate} prefix=${TARGET_PFX}`);
  console.log(`    interval1=${fields.interval1} intervalN=${fields.intervalN} forbidden=${fields.forbidden}`);
  console.log(`    gracePeriodEnable=${fields.gracePeriodEnable} activationDate="${fields.activationDate}"`);
  console.log(`    expirationDate="${fields.expirationDate}"`);
  console.log(`    excelSerial→date check: serial 46182.550138889 → ${excelSerialToDateStr(46182.550138889)}`);

  // Step 4: Submit action=change GET with new rate
  console.log(`\nStep 4: Submit action=change — ${TARGET_PFX} → ${TEST_RATE}`);
  const changeResp = await changeRate(
    BASE_URL, TARIFF_ID, fields.iRate, TARGET_PFX,
    TEST_RATE, fields.interval1, fields.intervalN,
    fields.forbidden, fields.gracePeriodEnable,
    fields.activationDate, fields.expirationDate,
    jar,
  );
  jar = changeResp.jar;

  const body        = changeResp.body;
  const isLoginPage = body.includes('value="Login"') || body.includes("value='Login'");
  const hasError    = /class=["']err[^"']*["']/i.test(body.slice(0, 8000));
  console.log(`  HTTP ${changeResp.status}  size=${body.length}B  login=${isLoginPage}  err=${hasError}`);

  if (isLoginPage) { console.log('  FAIL: session rejected — login page returned'); process.exit(1); }
  if (hasError) {
    const errM = body.match(/class=["']err[^"']*["'][^>]*>([^<]{0,300})/i);
    console.log(`  FAIL: error in response: ${errM ? errM[1].trim() : '(see full response)'}`);
    process.exit(1);
  }
  if (changeResp.status === 200 && body.length > 5000) {
    console.log('  ✓ action=change accepted — response is the full rates page');
  } else {
    console.log('  FAIL: unexpected response');
    process.exit(1);
  }

  // Step 5: Verify via re-download of XLSX
  console.log('\nStep 5: Verify — re-download XLSX and check rate');
  const verifyBuf = await downloadXlsx(BASE_URL, TARIFF_ID, jar);
  if (!verifyBuf) {
    console.log('  WARN: Could not re-download for XLSX verification');
  } else {
    const wb  = XLSX.read(verifyBuf, { type: 'buffer' });
    const ws  = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as any[][];
    let foundPrice: number | null = null;
    for (let i = 1; i < aoa.length; i++) {
      if (String(aoa[i][2] ?? '').trim() === TARGET_PFX) {
        foundPrice = Number(aoa[i][6]);
        break;
      }
    }
    if (foundPrice === null) {
      console.log(`  WARN: Prefix ${TARGET_PFX} not found in re-downloaded XLSX`);
    } else if (Math.abs(foundPrice - TEST_RATE) < 0.00001) {
      console.log(`  ✓ XLSX VERIFIED: prefix=${TARGET_PFX} price=${foundPrice} (expected ${TEST_RATE})`);
    } else {
      console.log(`  ✗ XLSX rate mismatch: ${TARGET_PFX} = ${foundPrice} (expected ${TEST_RATE})`);
    }
  }

  // Step 6: Verify via HTML rates table (ground truth)
  console.log('\nStep 6: Verify via HTML rates table');
  const htmlResp = await strRequest('GET', `${BASE_URL}/c1/rates_tariff.php?i_tariff=${TARIFF_ID}`, null, jar);
  const prefixRe = new RegExp(`>${TARGET_PFX}<\\/a><\\/td>[\\s\\S]{0,500}class="borderbottomright">(\\d+\\.\\d+)<`);
  const htmlMatch = htmlResp.body.match(prefixRe);
  if (htmlMatch) {
    const htmlPrice = parseFloat(htmlMatch[1]);
    if (Math.abs(htmlPrice - TEST_RATE) < 0.00001) {
      console.log(`  ✓ HTML TABLE VERIFIED: prefix=${TARGET_PFX} price=${htmlPrice} (expected ${TEST_RATE})`);
    } else {
      console.log(`  ✗ HTML price mismatch: ${TARGET_PFX} = ${htmlPrice} (expected ${TEST_RATE})`);
    }
  } else {
    console.log(`  WARN: Could not extract price for ${TARGET_PFX} from HTML table`);
  }

  // Step 7: Restore original rate
  console.log('\nStep 7: Restore original rate (0.0274)');
  const ORIGINAL_RATE = 0.0274;
  const restoreResp = await changeRate(
    BASE_URL, TARIFF_ID, fields.iRate, TARGET_PFX,
    ORIGINAL_RATE, fields.interval1, fields.intervalN,
    fields.forbidden, fields.gracePeriodEnable,
    fields.activationDate, fields.expirationDate,
    jar,
  );
  const restoreOk = restoreResp.status === 200 && restoreResp.body.length > 5000 &&
                    !restoreResp.body.includes('value="Login"');
  console.log(`  Restore HTTP ${restoreResp.status} — ${restoreOk ? '✓ restored to ' + ORIGINAL_RATE : 'WARN: restore may have failed'}`);

  console.log(`\n${'═'.repeat(80)}`);
  console.log('  END-TO-END TEST COMPLETE');
  console.log(`${'═'.repeat(80)}\n`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
