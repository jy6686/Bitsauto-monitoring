/**
 * gate0-sippy-verify.ts — READ-ONLY Gate 0 verification against the Sippy test switch.
 *
 * WHAT GATE 0 NEEDS AND WHY THIS EXISTS. The new platform's CDR arm carries TEST traffic only, so
 * invoicing and P&L can be built but not certified. Gate 0 is the step that makes real traffic
 * available. This script establishes what is actually true about Sippy access, and nothing more.
 *
 * HARD BOUNDARIES, ENFORCED RATHER THAN INTENDED:
 *
 *   - Credentials come from the RUNTIME ENVIRONMENT ONLY. If they are absent this REFUSES and
 *     exits non-zero. It never reads switch settings from a database, and never calls
 *     `sippyXmlCreds(settings)`. SB1 is entirely outside this path.
 *   - The portal URL is passed EXPLICITLY to every call, so the client's `activeSession` fallback
 *     — which elsewhere is seeded from stored settings — cannot supply a host behind our back.
 *   - NO WRITES. No tariff, rate or account mutation is attempted. A self-check scans this file for
 *     every mutation primitive and aborts before contacting anything if one appears.
 *   - NO DATABASE. `server/sippy.ts` imports no db, so this stays db-free. Repository capture is
 *     NOT exercised unless explicitly asked for, and even then only COUNTS rows — never inserts.
 *
 * WHAT IT WILL NOT DO: claim more than it proved. Each step reports VERIFIED, FAILED, or
 * UNVERIFIED separately. Reachability and authentication do NOT constitute Gate 0. CDRs returning
 * does not establish that a vendor leg is available through the tested interface — that is reported
 * as its own finding either way.
 *
 * RUN IT WHERE THE CREDENTIALS ALREADY LIVE:
 *
 *     npx tsx scripts/gate0-sippy-verify.ts
 *
 * Optional environment:
 *     GATE0_SIPPY_URL        default https://191.101.30.107
 *     GATE0_TEST_ACCOUNT     account username to query (else the first account listed)
 *     GATE0_DAYS             lookback window in days, default 2
 *     GATE0_LIMIT            max CDRs to request, default 25
 *     GATE0_INSPECT_REPO=1   additionally COUNT rows in raw_sippy_cdrs (read-only, needs DATABASE_URL)
 */
import { readFileSync } from 'node:fs';
import * as sippy from '../server/sippy';
import { MUTATION_PRIMITIVES } from '../server/services/rates/canonical-seam-guard';

type Verdict = 'VERIFIED' | 'FAILED' | 'UNVERIFIED' | 'NOT EXERCISED';
const rows: Array<{ step: string; verdict: Verdict; detail: string }> = [];
const record = (step: string, verdict: Verdict, detail: string) => {
  rows.push({ step, verdict, detail });
  const tag = { VERIFIED: '  ok  ', FAILED: ' FAIL ', UNVERIFIED: ' ???  ', 'NOT EXERCISED': '  --  ' }[verdict];
  console.log(`[${tag}] ${step}\n          ${detail}`);
};

function refuse(why: string): never {
  console.error(`\nREFUSED — ${why}\n`);
  console.error('Gate 0 is NOT verified. Nothing was contacted.\n');
  process.exit(2);
}

// ── Self-check 0: this file must contain no mutation primitive ────────────────
{
  const self = readFileSync(new URL(import.meta.url).pathname, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const offending = MUTATION_PRIMITIVES.filter(p => new RegExp(`\\b${p}\\s*\\(`).test(self));
  if (offending.length) refuse(`this script names mutation primitives: ${offending.join(', ')}`);
  // Patterns assembled from fragments: spelled literally, this check would match its OWN source
  // after comment-stripping and refuse every run — a self-check that always fires proves nothing.
  const forbidden = [
    ['sippy', 'XmlCreds'].join(''),
    ['from \'./', 'db\''].join(''),
    ['from \'./', 'storage\''].join(''),
  ];
  const hit = forbidden.find(f => self.includes(f));
  if (hit) refuse(`this script reaches for database-backed credentials or storage (${hit})`);
}

// ── Credentials: environment ONLY ────────────────────────────────────────────
const username = process.env.SIPP_ADMIN_USERNAME || process.env.SIPPY_ADMIN_USERNAME || '';
const password = process.env.SIPP_ADMIN_PASSWORD || process.env.SIPPY_ADMIN_PASSWORD || '';
if (!username || !password) {
  refuse(
    'no Sippy credentials in the runtime environment.\n' +
    '  Expected SIPPY_ADMIN_USERNAME and SIPPY_ADMIN_PASSWORD (or the SIPP_ variants).\n' +
    '  This script will NOT fall back to database/SB1-backed switch settings — that is the point.\n' +
    '  Run it inside the runtime where the approved Sippy credentials are configured.',
  );
}

const PORTAL  = (process.env.GATE0_SIPPY_URL || 'https://191.101.30.107').replace(/\/$/, '');
const DAYS    = Number(process.env.GATE0_DAYS  ?? 2);
const LIMIT   = Number(process.env.GATE0_LIMIT ?? 25);

const iso = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
const endDate = iso(new Date());
const startDate = iso(new Date(Date.now() - DAYS * 86_400_000));

async function main() {
  console.log('\nGate 0 — read-only Sippy verification');
  console.log(`  target      ${PORTAL}`);
  console.log(`  credential  ${username.slice(0, 2)}***  (from environment, never from a database)`);
  console.log(`  window      ${startDate} .. ${endDate}   limit ${LIMIT}`);
  console.log(`  mode        READ-ONLY · no writes · no SB1 · no database\n`);

  // ── 1 + 2. Reachability and authentication ─────────────────────────────────
  let authed = false;
  try {
    const t = await sippy.testSippyConnection(PORTAL, username, password);
    record('1. XML-RPC endpoint reachable', t.reachable ? 'VERIFIED' : 'FAILED',
      `${t.message}${t.latencyMs != null ? ` (${t.latencyMs} ms)` : ''}`);
    authed = !!t.authenticated;
    record('2. Authentication via runtime credentials', authed ? 'VERIFIED' : 'FAILED',
      authed ? `mode=${t.mode ?? 'xmlrpc'}` : t.message);
  } catch (e: any) {
    record('1. XML-RPC endpoint reachable', 'FAILED', e?.message ?? String(e));
    record('2. Authentication via runtime credentials', 'FAILED', 'not attempted — no connection');
  }

  if (!authed) {
    record('3. Test account query', 'NOT EXERCISED', 'authentication did not succeed');
    record('4. CDR retrieval', 'NOT EXERCISED', 'authentication did not succeed');
    record('5. Vendor / termination leg', 'NOT EXERCISED', 'no CDRs to inspect');
    return summary();
  }

  // ── 3. A known account can be queried ──────────────────────────────────────
  let iAccount: number | undefined;
  let accountName = process.env.GATE0_TEST_ACCOUNT || '';
  try {
    if (accountName) {
      const info = await sippy.getAccountInfo(username, password, PORTAL, undefined, accountName);
      iAccount = (info as any)?.iAccount ?? undefined;
      record('3. Test account query', info ? 'VERIFIED' : 'FAILED',
        info ? `${accountName} → i_account=${iAccount ?? 'n/a'}` : `no account returned for ${accountName}`);
    } else {
      const list: any = await (sippy as any).listSippyAccounts(username, password, PORTAL);
      const arr = Array.isArray(list) ? list : (list?.accounts ?? []);
      const first = arr[0];
      iAccount = first?.iAccount ?? first?.i_account;
      accountName = first?.username ?? first?.name ?? '';
      record('3. Test account query', arr.length ? 'VERIFIED' : 'FAILED',
        arr.length ? `${arr.length} account(s) listed; using ${accountName || '(unnamed)'} i_account=${iAccount ?? 'n/a'}`
                   : 'the switch listed no accounts');
    }
  } catch (e: any) {
    record('3. Test account query', 'FAILED', e?.message ?? String(e));
  }

  // ── 4. CDR retrieval ───────────────────────────────────────────────────────
  let cdrs: any[] = [];
  try {
    const page: any = await (sippy as any).getSippyCDRsPage(
      username, password, LIMIT,
      { ...(iAccount != null ? { iAccount } : {}), startDate, endDate, type: 'all' },
      PORTAL,
    );
    const ok = page?.ok !== false;
    cdrs = page?.cdrs ?? [];
    record('4. CDR retrieval', ok ? (cdrs.length ? 'VERIFIED' : 'UNVERIFIED') : 'FAILED',
      ok ? (cdrs.length
              ? `${cdrs.length} CDR(s) returned${page?.method ? ` via ${page.method}` : ''}`
              : `the call succeeded but returned 0 rows in this window — retrieval is UNPROVEN, not disproven` +
                `; widen GATE0_DAYS or pick a busier account`)
         : (page?.message ?? 'the call did not succeed'));
    if (page?.method) record('4a. Pagination / method', 'VERIFIED',
      `answered by ${page.method}; total=${page?.total ?? 'not reported'}, pinning available for deeper pages`);
  } catch (e: any) {
    record('4. CDR retrieval', 'FAILED', e?.message ?? String(e));
  }

  // ── 5. Vendor / termination leg, reported honestly either way ──────────────
  if (!cdrs.length) {
    record('5. Vendor / termination leg', 'NOT EXERCISED', 'no CDRs were returned to inspect');
  } else {
    const CANDIDATES = ['vendor', 'iConnection', 'remoteIp', 'remotePartyId', 'cost', 'connectFee'] as const;
    const populated = CANDIDATES.filter(f => cdrs.some(c => c?.[f] !== undefined && c?.[f] !== null && c?.[f] !== ''));
    const vendorSide = populated.filter(f => f === 'vendor' || f === 'iConnection');
    record('5. Vendor / termination leg', vendorSide.length ? 'VERIFIED' : 'UNVERIFIED',
      vendorSide.length
        ? `populated on returned rows: ${vendorSide.join(', ')} (all populated fields: ${populated.join(', ')})`
        : `NO vendor-side field populated on ${cdrs.length} row(s). Fields present: ${populated.join(', ') || 'none'}.\n` +
          `          CDR retrieval is verified; vendor-leg availability through THIS interface remains UNVERIFIED.\n` +
          `          A different method (e.g. the Mera vendor export) may expose it — untested here.`);
  }

  // ── 6. Repository capture: inspection only, and off by default ─────────────
  if (process.env.GATE0_INSPECT_REPO === '1') {
    record('6. raw_sippy_cdrs capture', 'NOT EXERCISED',
      'GATE0_INSPECT_REPO=1 was set, but this script is deliberately database-free; ' +
      'run the repository count separately so this verification cannot insert anything');
  } else {
    record('6. raw_sippy_cdrs capture', 'NOT EXERCISED',
      'not requested. No row was read, written or inserted. Repository capture is a SEPARATE proof.');
  }

  record('7. Mutation attempted', 'VERIFIED', 'none — asserted by self-check before any contact');
  record('8. SB1 / database settings lookup', 'VERIFIED', 'none — credentials came from the environment only');

  summary();
}

function summary() {
  const n = (v: Verdict) => rows.filter(r => r.verdict === v).length;
  console.log('\n──────── summary ────────');
  for (const r of rows) console.log(`  ${r.verdict.padEnd(14)} ${r.step}`);
  console.log(`\n  VERIFIED ${n('VERIFIED')} · FAILED ${n('FAILED')} · UNVERIFIED ${n('UNVERIFIED')} · NOT EXERCISED ${n('NOT EXERCISED')}`);

  const gate0 = ['1.', '2.', '3.', '4.', '5.'].every(p =>
    rows.find(r => r.step.startsWith(p))?.verdict === 'VERIFIED');
  console.log(`\n  Gate 0 status: ${gate0 ? 'steps 1-5 VERIFIED — repository capture still unproven (step 6)' : 'NOT COMPLETE'}`);
  console.log('  Reachability and authentication alone do NOT constitute Gate 0.\n');
  process.exit(n('FAILED') > 0 ? 1 : 0);
}

main().catch(e => { console.error('\nunhandled:', e?.message ?? e); process.exit(1); });
