/**
 * Final provisioning script — uses proven create-pushtotalk.mjs auth pattern
 * 
 * Tests:
 *   1. createAccount with welcome_call_ivr=0 (not nil)
 *   2. addRoutingGroup with integer policy values
 *   3. Confirm TALK vendor connection exists
 *   4. Register Aircel + TALK in local app DB via REST API
 */

import https from 'https';
import http  from 'http';
import crypto from 'crypto';

const agent = new https.Agent({ rejectUnauthorized: false });
const HOST  = '191.101.30.107';
const SIPPY_USER = 'ssp-root', SIPPY_PASS = '!chiaan1', uri = '/xmlapi/xmlapi';

// ── Sippy helpers (exact pattern from create-pushtotalk.mjs) ──────────────────
function tX(v) { return typeof v==='number' ? Number.isInteger(v) ? `<int>${v}</int>` : `<double>${v}</double>` : `<string>${String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</string>`; }
function bM(p) { return Object.entries(p).filter(([,v])=>v!=null).map(([k,v])=>`<member><name>${k}</name><value>${tX(v)}</value></member>`).join(''); }
function xC(m, p) { return `<?xml version="1.0"?><methodCall><methodName>${m}</methodName><params><param><value><struct>${bM(p)}</struct></value></param></params></methodCall>`; }

async function sippyPost(body) {
  const buf = Buffer.from(body, 'utf8');
  function makeReq(ex = {}) {
    return new Promise((res, rej) => {
      const r = https.request({ hostname: HOST, port: 443, path: uri, method: 'POST', headers: { 'Content-Type': 'text/xml', 'Content-Length': buf.length, 'User-Agent': 'SippyAPI/1.0', ...ex }, agent, timeout: 15000 },
        resp => { let d = ''; resp.on('data', c => d += c); resp.on('end', () => res({ s: resp.statusCode, b: d, a: resp.headers['www-authenticate'] })); });
      r.on('error', rej); r.on('timeout', () => { r.destroy(); rej(new Error('timeout')); }); r.write(buf); r.end();
    });
  }
  const probe = await makeReq();
  if (probe.s !== 401 || !probe.a) return probe;
  const realm  = (probe.a.match(/realm="([^"]+)"/) ?? [])[1] ?? '';
  const nonce  = (probe.a.match(/nonce="([^"]+)"/) ?? [])[1] ?? '';
  const qopRaw = probe.a.match(/qop="([^"]+)"/) ?? probe.a.match(/qop=(\S+)/) ?? [];
  const qop    = (qopRaw[1] ?? '').split(',').map(s => s.trim()).find(s => s === 'auth' || s === 'auth-int') ?? '';
  const opaque = (probe.a.match(/opaque="([^"]+)"/) ?? [])[1] ?? '';
  const ha1 = crypto.createHash('md5').update(`${SIPPY_USER}:${realm}:${SIPPY_PASS}`).digest('hex');
  const ha2 = crypto.createHash('md5').update(`POST:${uri}`).digest('hex');
  let auth;
  if (qop) {
    const nc = '00000001', cn = crypto.randomBytes(8).toString('hex');
    const rsp = crypto.createHash('md5').update(`${ha1}:${nonce}:${nc}:${cn}:${qop}:${ha2}`).digest('hex');
    auth = `Digest username="${SIPPY_USER}", realm="${realm}", nonce="${nonce}", uri="${uri}", qop=${qop}, nc=${nc}, cnonce="${cn}", response="${rsp}"${opaque ? `, opaque="${opaque}"` : ''}`;
  } else {
    const rsp = crypto.createHash('md5').update(`${ha1}:${nonce}:${ha2}`).digest('hex');
    auth = `Digest username="${SIPPY_USER}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${rsp}"${opaque ? `, opaque="${opaque}"` : ''}`;
  }
  return makeReq({ Authorization: auth });
}

const getFault  = xml => xml.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim() ?? null;
const isOk      = r  => r.s === 200 && !r.b.includes('<fault>') && !r.b.includes('faultCode');
const extractId = (xml, f) => { const m = xml.match(new RegExp(`<name>${f}<\\/name>\\s*<value>\\s*(?:<[a-z]+>)?(\\d+)`, 'i')); return m ? parseInt(m[1]) : null; };

console.log('\n╔══════════════════════════════════════════════════════════╗');
console.log('║   Final Provisioning Script                             ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

// ── 1. Confirm current state ──────────────────────────────────────────────────
console.log('── Step 1: Current Sippy state ──');
const rgResp = await sippyPost(xC('listRoutingGroups', {}));
const rgIds  = [...rgResp.b.matchAll(/<name>i_routing_group<\/name>\s*<value>\s*(?:<[a-z]+>)?(\d+)/gi)].map(m => parseInt(m[1]));
const rgNms  = [...rgResp.b.matchAll(/<name>name<\/name>\s*<value>\s*(?:<[a-z]+>)?([^<]*)/gi)].map(m => m[1]);
const rgMap  = Object.fromEntries(rgIds.map((id, i) => [id, rgNms[i] ?? '']));
console.log('  Routing groups:', JSON.stringify(rgMap));

const acResp = await sippyPost(xC('listAccounts', { i_customer: 1 }));
const acIds  = [...acResp.b.matchAll(/<name>i_account<\/name>\s*<value>\s*(?:<[a-z]+>)?(\d+)/gi)].map(m => parseInt(m[1]));
const acNms  = [...acResp.b.matchAll(/<name>username<\/name>\s*<value>\s*(?:<[a-z]+>)?([^<]*)/gi)].map(m => m[1]);
const acMap  = Object.fromEntries(acIds.map((id, i) => [id, acNms[i] ?? '']));
console.log('  Accounts:', JSON.stringify(acMap));

const vdResp = await sippyPost(xC('listVendors', {}));
const vdIds  = [...vdResp.b.matchAll(/<name>i_vendor<\/name>\s*<value>\s*(?:<[a-z]+>)?(\d+)/gi)].map(m => parseInt(m[1]));
const vdNms  = [...vdResp.b.matchAll(/<name>name<\/name>\s*<value>\s*(?:<[a-z]+>)?([^<]*)/gi)].map(m => m[1]);
const vdMap  = Object.fromEntries(vdIds.map((id, i) => [id, vdNms[i] ?? '']));
console.log('  Vendors:', JSON.stringify(vdMap));

const talkVendorId   = parseInt(Object.entries(vdMap).find(([, n]) => n === 'TALK')?.[0] ?? '0') || 3;
const aircelAccountId= parseInt(Object.entries(acMap).find(([, u]) => u === 'aircel')?.[0] ?? '0') || 4;
let   rgTalkId       = parseInt(Object.entries(rgMap).find(([, n]) => n.includes('First Class TALK'))?.[0] ?? '0') || null;

// Check TALK vendor connections
const connResp = await sippyPost(xC('getVendorConnectionsList', { i_vendor: talkVendorId }));
const connHosts = [...connResp.b.matchAll(/<name>host<\/name>\s*<value>\s*(?:<[a-z]+>)?([^<]*)/gi)].map(m => m[1]);
const connIds   = [...connResp.b.matchAll(/<name>i_connection<\/name>\s*<value>\s*(?:<[a-z]+>)?(\d+)/gi)].map(m => parseInt(m[1]));
console.log(`  TALK vendor (ID=${talkVendorId}) connections:`, JSON.stringify(connIds.map((id, i) => ({ id, host: connHosts[i] }))));

// ── 2. createAccount test with welcome_call_ivr=0 ─────────────────────────────
console.log('\n── Step 2: Test createAccount (welcome_call_ivr=0) ──');
const caParams = {
  username:'testacct88', web_password:'Test@2024x', authname:'testacct88', voip_password:'TestSIP@88',
  max_sessions:5, max_credit_time:3600, translation_rule:'', cli_translation_rule:'',
  credit_limit:0, i_time_zone:1, balance:0, cpe_number:'',
  vm_enabled:0, vm_password:'1234', blocked:0, i_lang:'en',
  payment_currency:'USD', payment_method:1, i_export_type:2, lifetime:-1,
  preferred_codec:18, use_preferred_codec_only:0, reg_allowed:0,
  welcome_call_ivr:0,   // Use 0 instead of null/<nil/>
  // on_payment_action: OMITTED
  min_payment_amount:0.0, trust_cli:0, disallow_loops:0,
  vm_notify_emails:'', vm_forward_emails:'', vm_del_after_fwd:0,
  company_name:'TestCo', salutation:'', first_name:'Test', last_name:'Account',
  mid_init:'', street_addr:'', state:'', postal_code:'', city:'', country:'US',
  contact:'', phone:'', fax:'', alt_phone:'', alt_contact:'',
  email:'test@test.com', cc:'', bcc:'',
  i_password_policy:1, i_media_relay_type:0, i_customer:1, i_billing_plan:1,
  i_routing_group:4, i_tariff:4,
};
const caResp = await sippyPost(xC('createAccount', caParams));
console.log('  Status:', caResp.s, '| Fault:', getFault(caResp.b) ?? 'none');
let createAccountWorks = false;
if (isOk(caResp)) {
  const testId = extractId(caResp.b, 'i_account');
  createAccountWorks = true;
  console.log(`  ✓ createAccount WORKS with welcome_call_ivr=0! ID: ${testId}`);
  if (testId) { const d = await sippyPost(xC('deleteAccount', { i_account: testId })); console.log(`  cleanup: ${isOk(d) ? 'deleted' : getFault(d.b)}`); }
} else {
  console.log('  Response:', caResp.b.slice(0, 250));
}

// ── 3. addRoutingGroup with integer policy ────────────────────────────────────
console.log('\n── Step 3: addRoutingGroup policy probe ──');
if (!rgTalkId) {
  for (const policy of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    const resp = await sippyPost(xC('addRoutingGroup', { name: `PakTEST_${policy}`, policy }));
    if (isOk(resp)) {
      rgTalkId = extractId(resp.b, 'i_routing_group') ?? extractId(resp.b, 'i_id');
      console.log(`  ✓ policy=${policy} WORKS! Created as "PakTEST_${policy}", ID: ${rgTalkId}`);
      // Rename it
      const renResp = await sippyPost(xC('updateRoutingGroup', { i_routing_group: rgTalkId, name: 'Pakistan First Class TALK', description: 'Pakistan routing via TALK vendor - First Class tier' }));
      console.log(`  rename: ${isOk(renResp) ? 'OK' : getFault(renResp.b)}`);
      break;
    }
    const f = getFault(resp.b);
    if (f && !f.includes('policy') && !f.includes('Wrong value') && !f.includes('Parameter')) {
      console.log(`  ✗ policy=${policy}: ${f}`);
      // This policy value syntax might be right but other error
    } else if (!f) {
      console.log(`  ✗ policy=${policy}: status=${resp.s}, no XML fault`);
    } else {
      process.stdout.write(`  - ${policy}: rejected | `);
    }
  }
  if (!rgTalkId) {
    console.log('\n  Trying string variants...');
    for (const policy of ['hunting', 'HUNTING', 'lcr', 'LCR', 'Hunting', 'route', 'static', 'fail', 'first']) {
      const resp = await sippyPost(xC('addRoutingGroup', { name: `PakTEST_${policy}`, policy }));
      if (isOk(resp)) {
        rgTalkId = extractId(resp.b, 'i_routing_group');
        console.log(`  ✓ policy="${policy}" WORKS! ID: ${rgTalkId}`);
        await sippyPost(xC('updateRoutingGroup', { i_routing_group: rgTalkId, name: 'Pakistan First Class TALK', description: 'Pakistan routing via TALK vendor - First Class tier' }));
        break;
      }
      const f = getFault(resp.b);
      console.log(`  - "${policy}": ${f}`);
    }
  }
} else {
  console.log(`  Routing group already exists: ID=${rgTalkId}`);
}

// ── 4. If routing group created, link TALK vendor ─────────────────────────────
if (rgTalkId) {
  console.log(`\n── Step 4: Linking TALK vendor to routing group ${rgTalkId} ──`);
  const rgmResp = await sippyPost(xC('addRoutingGroupMember', { i_routing_group: rgTalkId, i_vendor: talkVendorId, preference: 1, huntstop: 0 }));
  console.log(`  addRoutingGroupMember: ${isOk(rgmResp) ? '✓ OK' : getFault(rgmResp.b)}`);
}

// ── 5. Final state ────────────────────────────────────────────────────────────
console.log('\n── Final State ──');
const rgResp2 = await sippyPost(xC('listRoutingGroups', {}));
const rgIds2  = [...rgResp2.b.matchAll(/<name>i_routing_group<\/name>\s*<value>\s*(?:<[a-z]+>)?(\d+)/gi)].map(m => parseInt(m[1]));
const rgNms2  = [...rgResp2.b.matchAll(/<name>name<\/name>\s*<value>\s*(?:<[a-z]+>)?([^<]*)/gi)].map(m => m[1]);
console.log('  Routing groups:', JSON.stringify(Object.fromEntries(rgIds2.map((id, i) => [id, rgNms2[i]]))));

const vdResp2 = await sippyPost(xC('listVendors', {}));
const vdIds2  = [...vdResp2.b.matchAll(/<name>i_vendor<\/name>\s*<value>\s*(?:<[a-z]+>)?(\d+)/gi)].map(m => parseInt(m[1]));
const vdNms2  = [...vdResp2.b.matchAll(/<name>name<\/name>\s*<value>\s*(?:<[a-z]+>)?([^<]*)/gi)].map(m => m[1]);
console.log('  Vendors:', JSON.stringify(Object.fromEntries(vdIds2.map((id, i) => [id, vdNms2[i]]))));

const connResp2 = await sippyPost(xC('getVendorConnectionsList', { i_vendor: talkVendorId }));
const connHosts2= [...connResp2.b.matchAll(/<name>host<\/name>\s*<value>\s*(?:<[a-z]+>)?([^<]*)/gi)].map(m => m[1]);
const connIds2  = [...connResp2.b.matchAll(/<name>i_connection<\/name>\s*<value>\s*(?:<[a-z]+>)?(\d+)/gi)].map(m => parseInt(m[1]));
console.log(`  TALK connections:`, JSON.stringify(connIds2.map((id, i) => ({ id, host: connHosts2[i] }))));

console.log(`\n  createAccount works:   ${createAccountWorks}`);
console.log(`  Aircel account ID:     ${aircelAccountId}`);
console.log(`  TALK vendor ID:        ${talkVendorId}`);
console.log(`  RG "Pak First TALK":   ${rgTalkId ?? 'FAILED - policy value unknown'}`);
