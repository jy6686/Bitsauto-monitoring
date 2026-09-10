/**
 * measure-upload-token-latency.ts — how long does getUploadToken actually take?
 *
 *   npx tsx scripts/measure-upload-token-latency.ts --tariff 65
 *   npx tsx scripts/measure-upload-token-latency.ts --tariff 65 --runs 5
 *
 * WHY THIS EXISTS
 * On 2026-09-09 `diagnose-upload-token.ts` issued a token for tariffs 65 and 66 on every variant that
 * matches production's request shape. Production still fell through to the portal on jobs #45–#47.
 * The requests are identical, so the difference is the deadline:
 *
 *   setSippyRateEntry (sippy.ts:9571)      sippyPost(..., 10_000)   ← 10 s
 *   diagnose-upload-token.ts               no timeout at all
 *
 * Sippy was measured at 36.3 s for one tariff read the same evening. If getUploadToken is anywhere
 * near that, production aborts and the diagnostic does not — which would explain the whole regression
 * without a single line of our code having changed, and that is exactly what the git history shows.
 *
 * This measures the real latency of the EXACT call production makes, with NO deadline, and reports
 * whether production's 10 s would have fired. It is a measurement, not a fix.
 *
 * SAFETY. Identical Sippy-side footprint to diagnose-upload-token.ts, which has been run twice with
 * approval: it mints an upload token that is never used and expires unused. Nothing is uploaded. No
 * tariff, rate or account is read for modification or written. The token is minted precisely because
 * a token request is the thing being timed — a cheaper probe would measure a different call.
 */
import { Pool } from "pg";
import * as sippy from "../server/sippy";

/** Production's own timeout on this call. The number under test. */
const PRODUCTION_TIMEOUT_MS = 10_000;

type Pair = { username: string; password: string; origin: string };

/** Same shape production sends: YYYYMMDDThh:mm:ss, as a <string>. */
function sippyUploadTimestamp(offsetMs: number): string {
  const s = new Date(Date.now() + offsetMs).toISOString();
  return `${s.slice(0, 4)}${s.slice(5, 7)}${s.slice(8, 10)}T${s.slice(11, 19)}`;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is not set — run this from the app environment."); process.exit(2); }

  const tArg = process.argv.indexOf("--tariff");
  const iTariff = tArg >= 0 ? Number(process.argv[tArg + 1]) : NaN;
  if (!Number.isInteger(iTariff)) {
    console.error("Usage: measure-upload-token-latency.ts --tariff <i_tariff> [--runs N]");
    process.exit(2);
  }
  const rArg = process.argv.indexOf("--runs");
  const runs = rArg >= 0 ? Math.max(1, Math.min(10, Number(process.argv[rArg + 1]) || 3)) : 3;

  const pool = new Pool({ connectionString: url });
  const { rows } = await pool.query(
    `SELECT portal_url, api_admin_username, api_admin_password, sippy_username, sippy_password
       FROM settings ORDER BY id LIMIT 1`);
  if (!rows.length) { console.error("No settings row."); process.exit(2); }
  const s = rows[0];
  const portalUrl: string = s.portal_url ?? "";
  if (!portalUrl) { console.error("settings.portal_url is empty."); process.exit(2); }

  const pairs: Pair[] = [];
  if (s.api_admin_username && s.api_admin_password) pairs.push({ username: s.api_admin_username, password: s.api_admin_password, origin: 'apiAdmin' });
  if (s.sippy_username && s.sippy_password)         pairs.push({ username: s.sippy_username,     password: s.sippy_password,     origin: 'sippy' });
  if (!pairs.length) { console.error("No credentials configured."); process.exit(2); }

  let creds: Pair | null = null;
  for (const p of pairs) {
    const r = await sippy.listSippyAccounts(p.username, p.password, { limit: 1 }, portalUrl);
    if (!r.error) { creds = p; break; }
  }
  if (!creds) { console.error("No credential pair can call admin XML-RPC."); process.exit(1); }

  const base   = portalUrl.replace(/\/+$/, '');
  const apiUrl = `${base.startsWith('http') ? base : 'https://' + base}/xmlapi/xmlapi`;

  console.log(`Measuring getUploadToken against ${portalUrl}`);
  console.log(`Credential: ${creds.origin} ("${creds.username}")`);
  console.log(`Tariff: ${iTariff} · runs: ${runs}`);
  console.log(`Production deadline under test: ${PRODUCTION_TIMEOUT_MS} ms (sippy.ts:9571)\n`);

  // The upload type production resolves, measured too — it is a second round trip on a cold cache.
  const tDict = Date.now();
  const uploadType = await sippy.resolveUploadType(creds.username, creds.password, base, 'rates');
  const dictMs = Date.now() - tDict;
  console.log(`resolveUploadType('rates') → ${uploadType}   [${dictMs} ms]${dictMs > PRODUCTION_TIMEOUT_MS ? '  ⚠ over the deadline on its own' : ''}\n`);

  const samples: number[] = [];
  for (let i = 1; i <= runs; i++) {
    const processOn = sippyUploadTimestamp(10_000);
    const xml = sippy.buildGetUploadTokenXml(uploadType, processOn, undefined, { i_tariff: iTariff });

    const t0 = Date.now();
    let outcome: string;
    try {
      // 120 s, i.e. effectively no deadline — the point is to learn the TRUE latency.
      // sippyPost is not exported, so postRaw below sends the identical request shape.
      const resp = await postRaw(apiUrl, xml, creds.username, creds.password, 120_000);
      const ms = Date.now() - t0;
      samples.push(ms);
      const gotToken = /<name>token<\/name>/.test(resp.body);
      const fault    = resp.body.includes('faultCode');
      outcome = fault ? `FAULT ${(resp.body.match(/<int>(\d+)<\/int>/) ?? [])[1] ?? '?'}`
              : gotToken ? 'token issued' : `HTTP ${resp.statusCode}, no token in struct`;
      console.log(`  run ${i}: ${String(ms).padStart(6)} ms — ${outcome}` +
                  `${ms > PRODUCTION_TIMEOUT_MS ? `   ⚠ PRODUCTION WOULD HAVE ABORTED at ${PRODUCTION_TIMEOUT_MS} ms` : ''}`);
    } catch (e: any) {
      const ms = Date.now() - t0;
      samples.push(ms);
      console.log(`  run ${i}: ${String(ms).padStart(6)} ms — THREW: ${e?.message}`);
    }
  }

  const over = samples.filter(m => m > PRODUCTION_TIMEOUT_MS).length;
  const min = Math.min(...samples), max = Math.max(...samples);
  const avg = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length);
  console.log(`\nmin ${min} ms · avg ${avg} ms · max ${max} ms`);
  console.log(`${over} of ${samples.length} run(s) exceeded production's ${PRODUCTION_TIMEOUT_MS} ms deadline.\n`);

  if (over === samples.length) {
    console.log("VERDICT: every call exceeded the production deadline. The timeout hypothesis is");
    console.log("SUPPORTED — production would abort here and fall through to the portal, which is");
    console.log("exactly what jobs #45-#47 recorded. The request itself is fine.");
  } else if (over > 0) {
    console.log("VERDICT: INTERMITTENT. Some calls fit inside the deadline and some do not, which");
    console.log("would make the failure look random rather than systematic. Worth more runs.");
  } else {
    console.log("VERDICT: every call fit inside the production deadline. The timeout hypothesis is");
    console.log("NOT supported by this measurement — the failure lies elsewhere, and the console");
    console.log("trace is still the artifact that will say where.");
  }
  console.log("\nNo tariff, rate or account was modified. Any tokens minted here were never used.");
  await pool.end();
}

/** Minimal XML-RPC POST, so the measurement does not depend on a non-exported helper. */
function postRaw(url: string, body: string, username: string, password: string, timeoutMs: number):
    Promise<{ statusCode: number; body: string }> {
  const https = require('node:https'), http = require('node:http');
  const parsed = new URL(url);
  const isHttps = parsed.protocol === 'https:';
  return new Promise((resolve, reject) => {
    const req = (isHttps ? https : http).request({
      hostname: parsed.hostname,
      port: parsed.port ? parseInt(parsed.port) : (isHttps ? 443 : 80),
      path: parsed.pathname + (parsed.search || ''),
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'SippyAPI/1.0',
        Authorization: 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64'),
      },
      timeout: timeoutMs,
      ...(isHttps ? { rejectUnauthorized: false } : {}),
    }, (res: any) => {
      let data = '';
      res.on('data', (c: any) => { data += c; });
      res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`no response within ${timeoutMs} ms`)); });
    req.write(body);
    req.end();
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
