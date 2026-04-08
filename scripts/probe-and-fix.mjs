/**
 * Probe Sippy for correct routing group policy and fix remaining items:
 * 1. Find correct policy value via getRoutingGroup
 * 2. Create routing group "Pakistan First Class TALK"
 * 3. Fix tariff rates (tariff.setRate with correct fields)
 * 4. Create TALK vendor connection (with destination param)
 * 5. Add TALK to routing group
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
function bM(p) {
  return Object.entries(p).filter(([, v]) => v != null)
    .map(([k, v]) => `<member><name>${k}</name><value>${tX(v)}</value></member>`).join('');
}
function xC(method, params) {
  return `<?xml version="1.0"?><methodCall><methodName>${method}</methodName><params><param><value><struct>${bM(params)}</struct></value></param></params></methodCall>`;
}

async function sippyPost(body) {
  const buf = Buffer.from(body, 'utf8');
  const makeReq = (ex = {}) => new Promise((res, rej) => {
    const r = https.request({
      hostname: HOST, port: 443, path: URI, method: 'POST',
      headers: { 'Content-Type': 'text/xml', 'Content-Length': buf.length, 'User-Agent': 'Probe/1.0', ...ex },
      agent, timeout: 20000,
    }, resp => { let d = ''; resp.on('data', c => d += c); resp.on('end', () => res({ s: resp.statusCode, b: d, a: resp.headers['www-authenticate'] })); });
    r.on('error', rej); r.on('timeout', () => { r.destroy(); rej(new Error('timeout')); });
    r.write(buf); r.end();
  });
  const probe = await makeReq();
  if (probe.s !== 401 || !probe.a) return probe;
  const realm  = (probe.a.match(/realm="([^"]+)"/) ?? [])[1] ?? '';
  const nonce  = (probe.a.match(/nonce="([^"]+)"/) ?? [])[1] ?? '';
  const opaque = (probe.a.match(/opaque="([^"]+)"/) ?? [])[1] ?? '';
  const qop    = ((probe.a.match(/qop="([^"]+)"/) ?? probe.a.match(/qop=(\S+)/) ?? [])[1] ?? '').split(',').map(s => s.trim()).find(s => s === 'auth' || s === 'auth-int') ?? '';
  const ha1    = crypto.createHash('md5').update(`${USER}:${realm}:${PASS}`).digest('hex');
  const ha2    = crypto.createHash('md5').update(`POST:${URI}`).digest('hex');
  let auth;
  if (qop) {
    const nc = '00000001', cn = crypto.randomBytes(8).toString('hex');
    const rsp = crypto.createHash('md5').update(`${ha1}:${nonce}:${nc}:${cn}:${qop}:${ha2}`).digest('hex');
    auth = `Digest username="${USER}", realm="${realm}", nonce="${nonce}", uri="${URI}", qop=${qop}, nc=${nc}, cnonce="${cn}", response="${rsp}"${opaque ? `, opaque="${opaque}"` : ''}`;
  } else {
    const rsp = crypto.createHash('md5').update(`${ha1}:${nonce}:${ha2}`).digest('hex');
    auth = `Digest username="${USER}", realm="${realm}", nonce="${nonce}", uri="${URI}", response="${rsp}"${opaque ? `, opaque="${opaque}"` : ''}`;
  }
  return makeReq({ Authorization: auth });
}

const getFault  = xml => xml.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim() ?? null;
const isOk      = r  => r.s === 200 && !r.b.includes('<fault>') && !r.b.includes('faultCode');
const checkOk   = (label, r) => { if (isOk(r)) { console.log(`  ✓ ${label}`); return true; } console.log(`  ✗ ${label}: ${getFault(r.b) ?? r.b.slice(0,120)}`); return false; };
const extractId = (xml, f) => { const m = xml.match(new RegExp(`<name>${f}<\\/name>\\s*<value>\\s*(?:<[a-z]+>)?(\\d+)`, 'i')); return m ? parseInt(m[1]) : null; };

// ── 1. Probe routing group 4 to find policy ───────────────────────────────────
console.log('── Probing routing group #4 for policy value ──');
const rg4 = await sippyPost(xC('getRoutingGroup', { i_routing_group: 4 }));
console.log('getRoutingGroup(4) body:', rg4.b.slice(0, 2000));

// ── 2. Probe routing group #3 ─────────────────────────────────────────────────
const rg3 = await sippyPost(xC('getRoutingGroup', { i_routing_group: 3 }));
console.log('\ngetRoutingGroup(3) policy section:');
const policyMatch3 = rg3.b.match(/<name>policy<\/name>[\s\S]{0,200}/i);
console.log(policyMatch3?.[0] ?? '(policy key not found)');

// ── 3. Try createAccount to test welcome_call_ivr fix ─────────────────────────
console.log('\n── Testing createAccount fix ──');
// Build XML manually to include welcome_call_ivr as nil but omit on_payment_action
function bMAllowNull(p) {
  return Object.entries(p)
    .map(([k, v]) => `<member><name>${k}</name><value>${tX(v)}</value></member>`)
    .join('');
}
function xCAllowNull(method, params) {
  return `<?xml version="1.0"?><methodCall><methodName>${method}</methodName><params><param><value><struct>${bMAllowNull(params)}</struct></value></param></params></methodCall>`;
}

const testAcctParams = {
  username:             'aircel_test2',
  web_password:         'Test@2024',
  authname:             'aircel_test2',
  voip_password:        'TestSIP@2024',
  max_sessions:         5,
  max_credit_time:      3600,
  translation_rule:     '',
  cli_translation_rule: '',
  credit_limit:         0,
  i_time_zone:          1,
  balance:              0,
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
  welcome_call_ivr:     null,   // send as <nil/>
  // on_payment_action: OMITTED
  min_payment_amount:   0.0,
  trust_cli:            0,
  disallow_loops:       0,
  vm_notify_emails:     'qadeerjunaid@icloud.com',
  vm_forward_emails:    '',
  vm_del_after_fwd:     0,
  company_name:         'Test',
  salutation:           '',
  first_name:           'Test',
  last_name:            'Account',
  mid_init:             '',
  street_addr:          '',
  state:                '',
  postal_code:          '',
  city:                 '',
  country:              'PK',
  contact:              '',
  phone:                '',
  fax:                  '',
  alt_phone:            '',
  alt_contact:          '',
  email:                'qadeerjunaid@icloud.com',
  cc:                   '',
  bcc:                  '',
  i_password_policy:    1,
  i_media_relay_type:   0,
  i_customer:           1,
  i_billing_plan:       1,
  i_routing_group:      4,
  i_tariff:             4,
};

const caResp = await sippyPost(xCAllowNull('createAccount', testAcctParams));
console.log('createAccount test:', caResp.s);
console.log('response:', caResp.b.slice(0, 600));

// If worked, clean up test account
if (isOk(caResp)) {
  const testId = extractId(caResp.b, 'i_account');
  console.log(`  ✓ createAccount WORKS! Created test account ID: ${testId}`);
  if (testId) {
    const delResp = await sippyPost(xC('deleteAccount', { i_account: testId }));
    checkOk(`cleanup deleteAccount(${testId})`, delResp);
  }
} else {
  console.log(`  ✗ createAccount still failing: ${getFault(caResp.b)}`);
}

// ── 4. Tariff rates — try multiple methods ─────────────────────────────────────
console.log('\n── Testing tariff rate methods ──');
const AIRCEL_TARIFF = 4;
const TALK_TARIFF   = 5;

async function tryRateMethod(method, params) {
  const resp = await sippyPost(xC(method, params));
  if (isOk(resp)) {
    console.log(`  ✓ ${method} works!`);
    return true;
  }
  const f = getFault(resp.b);
  console.log(`  ✗ ${method}: ${f}`);
  return false;
}

const baseRateParams = { i_tariff: AIRCEL_TARIFF, destination: '9230' };

// Try each method
for (const [method, extra] of [
  ['tariff.setRate',         { price_first: 0.05, price_next: 0.05, initial_interval: 1, subsequent_interval: 1, connect_fee: 0, description: 'Pakistan Jazz' }],
  ['setRateInTariff',        { price_first: 0.05, price_next: 0.05 }],
  ['addRateEntry',           { price_first: 0.05, price_next: 0.05, initial_interval: 1, subsequent_interval: 1 }],
  ['tariff.addDestination',  { price_first: 0.05, price_next: 0.05, initial_interval: 1, subsequent_interval: 1 }],
  ['addRateToTariff',        { price_first: 0.05, price_next: 0.05 }],
]) {
  await tryRateMethod(method, { ...baseRateParams, ...extra });
}

// ── 5. Try TALK vendor connection with destination ────────────────────────────
console.log('\n── Creating TALK vendor connection with destination ──');
const TALK_VENDOR = 3;
for (const destVal of ['45.59.163.182', 'Pakistan', 'TALK-Pakistan', '']) {
  const connParams = {
    i_vendor:    TALK_VENDOR,
    name:        'TALK-Pakistan',
    host:        '45.59.163.182',
    port:        5060,
    protocol:    1,
    capacity:    100,
    destination: destVal,
    i_customer:  1,
    i_tariff:    TALK_TARIFF,
  };
  const resp = await sippyPost(xC('createVendorConnection', connParams));
  if (isOk(resp)) {
    const connId = extractId(resp.b, 'i_connection') ?? extractId(resp.b, 'i_vendor_account');
    console.log(`  ✓ createVendorConnection with destination="${destVal}" → ID: ${connId}`);
    break;
  } else {
    const f = getFault(resp.b);
    if (!f?.includes('destination')) { console.log(`  ✗ dest="${destVal}": ${f}`); break; }
    console.log(`  - dest="${destVal}": ${f}`);
  }
}
