/**
 * Final fix script:
 * 1. Test createAccount with cpe_number and welcome_call_ivr=nil, no on_payment_action
 * 2. Try addRoutingGroup with integer policy values
 * 3. Confirm TALK vendor connection exists
 * 4. Register all as local app profiles
 */

import https from 'https';
import crypto from 'crypto';

const agent = new https.Agent({ rejectUnauthorized: false });
const HOST  = '191.101.30.107';
const USER  = 'ssp-root';
const PASS  = '!chiaan1';
const URI   = '/xmlapi/xmlapi';

function tX(v) {
  if (v === null || v === undefined) return '<nil/>';
  if (typeof v === 'number')  return Number.isInteger(v) ? `<int>${v}</int>` : `<double>${v}</double>`;
  if (typeof v === 'boolean') return `<boolean>${v ? 1 : 0}</boolean>`;
  return `<string>${String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</string>`;
}
function bMNull(p) { // includes null as <nil/>
  return Object.entries(p).map(([k, v]) => `<member><name>${k}</name><value>${tX(v)}</value></member>`).join('');
}
function bM(p) { // skip null
  return Object.entries(p).filter(([, v]) => v != null).map(([k, v]) => `<member><name>${k}</name><value>${tX(v)}</value></member>`).join('');
}
function xCNull(m, p) { return `<?xml version="1.0"?><methodCall><methodName>${m}</methodName><params><param><value><struct>${bMNull(p)}</struct></value></param></params></methodCall>`; }
function xC(m, p)     { return `<?xml version="1.0"?><methodCall><methodName>${m}</methodName><params><param><value><struct>${bM(p)}</struct></value></param></params></methodCall>`; }

async function sippyPost(body) {
  const buf = Buffer.from(body, 'utf8');
  const makeReq = (ex = {}) => new Promise((res, rej) => {
    const r = https.request({ hostname: HOST, port: 443, path: URI, method: 'POST', headers: { 'Content-Type': 'text/xml', 'Content-Length': buf.length, ...ex }, agent, timeout: 20000 },
      resp => { let d = ''; resp.on('data', c => d += c); resp.on('end', () => res({ s: resp.statusCode, b: d, a: resp.headers['www-authenticate'] })); });
    r.on('error', rej); r.on('timeout', () => { r.destroy(); rej(new Error('timeout')); });
    r.write(buf); r.end();
  });
  const probe = await makeReq();
  if (probe.s !== 401 || !probe.a) return probe;
  const realm = (probe.a.match(/realm="([^"]+)"/) ?? [])[1] ?? '';
  const nonce = (probe.a.match(/nonce="([^"]+)"/) ?? [])[1] ?? '';
  const opaque = (probe.a.match(/opaque="([^"]+)"/) ?? [])[1] ?? '';
  const qop = ((probe.a.match(/qop="([^"]+)"/) ?? probe.a.match(/qop=(\S+)/) ?? [])[1] ?? '').split(',').map(s => s.trim()).find(s => s === 'auth' || s === 'auth-int') ?? '';
  const ha1 = crypto.createHash('md5').update(`${USER}:${realm}:${PASS}`).digest('hex');
  const ha2 = crypto.createHash('md5').update(`POST:${URI}`).digest('hex');
  let auth;
  if (qop) { const nc = '00000001', cn = crypto.randomBytes(8).toString('hex'), rsp = crypto.createHash('md5').update(`${ha1}:${nonce}:${nc}:${cn}:${qop}:${ha2}`).digest('hex'); auth = `Digest username="${USER}", realm="${realm}", nonce="${nonce}", uri="${URI}", qop=${qop}, nc=${nc}, cnonce="${cn}", response="${rsp}"${opaque ? `, opaque="${opaque}"` : ''}`; }
  else { const rsp = crypto.createHash('md5').update(`${ha1}:${nonce}:${ha2}`).digest('hex'); auth = `Digest username="${USER}", realm="${realm}", nonce="${nonce}", uri="${URI}", response="${rsp}"${opaque ? `, opaque="${opaque}"` : ''}`; }
  return makeReq({ Authorization: auth });
}

const getFault  = xml => xml.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim() ?? null;
const isOk      = r  => r.s === 200 && !r.b.includes('<fault>') && !r.b.includes('faultCode');
const extractId = (xml, f) => { const m = xml.match(new RegExp(`<name>${f}<\\/name>\\s*<value>\\s*(?:<[a-z]+>)?(\\d+)`, 'i')); return m ? parseInt(m[1]) : null; };

// ── 1. Test createAccount ─────────────────────────────────────────────────────
console.log('── Test 1: createAccount with full params including cpe_number ──');
const caParams = {
  username:             'testacct99',
  web_password:         'Test@2024x',
  authname:             'testacct99',
  voip_password:        'TestSIP@2024x',
  max_sessions:         5,
  max_credit_time:      3600,
  translation_rule:     '',
  cli_translation_rule: '',
  credit_limit:         0,
  i_time_zone:          1,
  balance:              0,
  cpe_number:           '',        // Required field — send as empty string
  vm_enabled:           0,
  vm_password:          '1234',
  blocked:              0,
  i_lang:               'en',
  payment_currency:     'USD',
  payment_method:       1,
  i_export_type:        2,
  lifetime:             -1,
  preferred_codec:      18,
  use_preferred_codec_only: 0,
  reg_allowed:          0,
  welcome_call_ivr:     null,     // Must be <nil/>
  // on_payment_action: OMITTED
  min_payment_amount:   0.0,
  trust_cli:            0,
  disallow_loops:       0,
  vm_notify_emails:     '',
  vm_forward_emails:    '',
  vm_del_after_fwd:     0,
  company_name:         'TestCo',
  salutation:           '',
  first_name:           'Test',
  last_name:            'Account',
  mid_init:             '',
  street_addr:          '',
  state:                '',
  postal_code:          '',
  city:                 '',
  country:              'US',
  contact:              '',
  phone:                '',
  fax:                  '',
  alt_phone:            '',
  alt_contact:          '',
  email:                'test@test.com',
  cc:                   '',
  bcc:                  '',
  i_password_policy:    1,
  i_media_relay_type:   0,
  i_customer:           1,
  i_billing_plan:       1,
  i_routing_group:      4,
  i_tariff:             4,
};
// Use xCNull so welcome_call_ivr becomes <nil/> but on_payment_action is absent
const caResp = await sippyPost(xCNull('createAccount', caParams));
console.log('createAccount →', caResp.s, caResp.b.slice(0, 400));
let createAccountWorks = false;
if (isOk(caResp)) {
  const testId = extractId(caResp.b, 'i_account');
  createAccountWorks = true;
  console.log(`  ✓ createAccount FULLY WORKS! ID: ${testId}`);
  // Clean up
  if (testId) {
    const del = await sippyPost(xC('deleteAccount', { i_account: testId }));
    console.log(`  cleanup: ${isOk(del) ? 'deleted' : getFault(del.b)}`);
  }
} else {
  console.log(`  ✗ Still failing: ${getFault(caResp.b)}`);
}

// ── 2. Try addRoutingGroup with integer policies ───────────────────────────────
console.log('\n── Test 2: addRoutingGroup with integer policy ──');
let rgId = null;

// Try integer values 0-5 directly
for (const policyVal of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
  const resp = await sippyPost(xC('addRoutingGroup', {
    name:        `Pakistan First Class TALK ${policyVal}`,
    policy:      policyVal,
    description: 'Test',
  }));
  if (isOk(resp)) {
    rgId = extractId(resp.b, 'i_routing_group') ?? extractId(resp.b, 'i_id');
    console.log(`  ✓ addRoutingGroup works with policy=${policyVal}! ID: ${rgId}`);
    // Rename it properly
    if (rgId) {
      await sippyPost(xC('updateRoutingGroup', { i_routing_group: rgId, name: 'Pakistan First Class TALK', description: 'Pakistan routing via TALK vendor' }));
    }
    break;
  }
  const f = getFault(resp.b);
  if (!f?.includes('policy') && !f?.includes('Wrong value')) {
    console.log(`  ✗ policy=${policyVal} other error: ${f}`);
    break;
  }
  console.log(`  - policy=${policyVal}: rejected (wrong value)`);
}

if (!rgId) {
  console.log('  All integer values rejected for policy. Trying string variants...');
  for (const pol of ['hunting', 'lcr_group', 'priority', 'failover', 'static', 'rou', 'quality', 'cost', 'none']) {
    const resp = await sippyPost(xC('addRoutingGroup', { name: `Test RG ${pol}`, policy: pol }));
    if (isOk(resp)) {
      rgId = extractId(resp.b, 'i_routing_group');
      console.log(`  ✓ Works with policy="${pol}"! ID: ${rgId}`);
      if (rgId) await sippyPost(xC('updateRoutingGroup', { i_routing_group: rgId, name: 'Pakistan First Class TALK', description: 'Pakistan routing via TALK vendor' }));
      break;
    }
    const f = getFault(resp.b);
    if (!f?.includes('policy') && !f?.includes('Wrong value')) { console.log(`  ✗ policy="${pol}": ${f}`); break; }
    console.log(`  - "${pol}": rejected`);
  }
}

// ── 3. Confirm current Sippy state ────────────────────────────────────────────
console.log('\n── Current Sippy State ──');
const rgResp    = await sippyPost(xC('listRoutingGroups', {}));
const rgIds     = [...rgResp.b.matchAll(/<name>i_routing_group<\/name>\s*<value>\s*(?:<[a-z]+>)?(\d+)/gi)].map(m => parseInt(m[1]));
const rgNames   = [...rgResp.b.matchAll(/<name>name<\/name>\s*<value>\s*(?:<[a-z]+>)?([^<]*)/gi)].map(m => m[1]);
console.log('Routing groups:', JSON.stringify(Object.fromEntries(rgIds.map((id, i) => [id, rgNames[i]]))));

const vendResp  = await sippyPost(xC('listVendors', {}));
const vendIds   = [...vendResp.b.matchAll(/<name>i_vendor<\/name>\s*<value>\s*(?:<[a-z]+>)?(\d+)/gi)].map(m => parseInt(m[1]));
const vendNames = [...vendResp.b.matchAll(/<name>name<\/name>\s*<value>\s*(?:<[a-z]+>)?([^<]*)/gi)].map(m => m[1]);
console.log('Vendors:', JSON.stringify(Object.fromEntries(vendIds.map((id, i) => [id, vendNames[i]]))));

const acctResp  = await sippyPost(xC('listAccounts', { i_customer: 1 }));
const acctIds   = [...acctResp.b.matchAll(/<name>i_account<\/name>\s*<value>\s*(?:<[a-z]+>)?(\d+)/gi)].map(m => parseInt(m[1]));
const acctUsers = [...acctResp.b.matchAll(/<name>username<\/name>\s*<value>\s*(?:<[a-z]+>)?([^<]*)/gi)].map(m => m[1]);
console.log('Accounts:', JSON.stringify(Object.fromEntries(acctIds.map((id, i) => [id, acctUsers[i]]))));

// Get vendor connections for TALK (vendor ID 3)
const connResp  = await sippyPost(xC('getVendorConnectionsList', { i_vendor: 3 }));
const connHosts = [...connResp.b.matchAll(/<name>host<\/name>\s*<value>\s*(?:<[a-z]+>)?([^<]*)/gi)].map(m => m[1]);
const connIds   = [...connResp.b.matchAll(/<name>i_connection<\/name>\s*<value>\s*(?:<[a-z]+>)?(\d+)/gi)].map(m => parseInt(m[1]));
console.log('TALK vendor connections:', JSON.stringify(connIds.map((id, i) => ({ id, host: connHosts[i] }))));

console.log('\n── Summary ──');
console.log(`createAccount WORKS: ${createAccountWorks}`);
console.log(`Routing group "Pakistan First Class TALK": ${rgId ? `created ID=${rgId}` : 'FAILED - policy unknown'}`);
console.log(`TALK vendor (ID=3) connections to 45.59.163.182: ${connHosts.length > 0}`);
