/**
 * Full setup script: Aircel client + TALK vendor + Pakistan First Class TALK routing group
 * Run 2 — fixed based on Run 1 learnings:
 *   - welcome_call_ivr must be sent as <nil/> for createAccount
 *   - on_payment_action must be OMITTED (not null) to avoid Fatal error
 *   - addRoutingGroup needs policy parameter
 *   - tariff rates use tariff.setRate not setRateEntry
 *   - createVendor needs base_currency
 */

import https from 'https';
import crypto from 'crypto';

const agent = new https.Agent({ rejectUnauthorized: false });
const HOST  = '191.101.30.107';
const USER  = 'ssp-root';
const PASS  = '!chiaan1';
const URI   = '/xmlapi/xmlapi';

// ── XML helpers ───────────────────────────────────────────────────────────────
function tX(v) {
  if (v === null || v === undefined) return '<nil/>';
  if (typeof v === 'number')  return Number.isInteger(v) ? `<int>${v}</int>` : `<double>${v}</double>`;
  if (typeof v === 'boolean') return `<boolean>${v ? 1 : 0}</boolean>`;
  return `<string>${String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</string>`;
}
// bM: build members, skip null/undefined (for most calls)
function bM(p) {
  return Object.entries(p)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `<member><name>${k}</name><value>${tX(v)}</value></member>`)
    .join('');
}
// bMAll: include null as <nil/> (for createAccount which requires welcome_call_ivr=nil)
function bMAll(p) {
  return Object.entries(p)
    .map(([k, v]) => `<member><name>${k}</name><value>${tX(v)}</value></member>`)
    .join('');
}
function xC(method, params) {
  return `<?xml version="1.0"?><methodCall><methodName>${method}</methodName><params><param><value><struct>${bM(params)}</struct></value></param></params></methodCall>`;
}
function xCAll(method, params) {
  return `<?xml version="1.0"?><methodCall><methodName>${method}</methodName><params><param><value><struct>${bMAll(params)}</struct></value></param></params></methodCall>`;
}

// ── HTTP / Digest Auth ────────────────────────────────────────────────────────
async function sippyPost(body) {
  const buf = Buffer.from(body, 'utf8');
  function makeReq(ex = {}) {
    return new Promise((res, rej) => {
      const r = https.request({
        hostname: HOST, port: 443, path: URI, method: 'POST',
        headers: { 'Content-Type': 'text/xml', 'Content-Length': buf.length, 'User-Agent': 'SippySetup/1.0', ...ex },
        agent, timeout: 20000,
      }, resp => {
        let d = '';
        resp.on('data', c => d += c);
        resp.on('end', () => res({ s: resp.statusCode, b: d, a: resp.headers['www-authenticate'] }));
      });
      r.on('error', rej);
      r.on('timeout', () => { r.destroy(); rej(new Error('timeout')); });
      r.write(buf); r.end();
    });
  }
  const probe = await makeReq();
  if (probe.s !== 401 || !probe.a) return probe;
  const realm   = (probe.a.match(/realm="([^"]+)"/) ?? [])[1] ?? '';
  const nonce   = (probe.a.match(/nonce="([^"]+)"/) ?? [])[1] ?? '';
  const opaque  = (probe.a.match(/opaque="([^"]+)"/) ?? [])[1] ?? '';
  const qopRaw  = probe.a.match(/qop="([^"]+)"/) ?? probe.a.match(/qop=(\S+)/) ?? [];
  const qop     = (qopRaw[1] ?? '').split(',').map(s => s.trim()).find(s => s === 'auth' || s === 'auth-int') ?? '';
  const ha1     = crypto.createHash('md5').update(`${USER}:${realm}:${PASS}`).digest('hex');
  const ha2     = crypto.createHash('md5').update(`POST:${URI}`).digest('hex');
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

function getFault(xml) {
  return xml.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? xml.match(/<faultString>([^<]*)<\/faultString>/i)?.[1]?.trim() ?? null;
}
function isOk(resp) {
  return resp.s === 200 && !resp.b.includes('<fault>') && !resp.b.includes('faultCode');
}
function checkOk(label, resp) {
  if (isOk(resp)) { console.log(`  ✓ ${label}`); return true; }
  console.log(`  ✗ ${label}: ${getFault(resp.b) ?? resp.b.slice(0, 150)}`);
  return false;
}
function extractId(xml, field) {
  const m = xml.match(new RegExp(`<name>${field}<\\/name>\\s*<value>\\s*(?:<[a-z]+>)?(\\d+)`, 'i'));
  return m ? parseInt(m[1], 10) : null;
}

// Pakistan prefix rates
const PAK_PREFIXES = [
  { prefix: '9230', dest: 'Pakistan Jazz',    clientRate: 0.05,  vendorRate: 0.045 },
  { prefix: '9232', dest: 'Pakistan Jazz',    clientRate: 0.05,  vendorRate: 0.045 },
  { prefix: '9233', dest: 'Pakistan Ufone',   clientRate: 0.05,  vendorRate: 0.045 },
  { prefix: '9234', dest: 'Pakistan Telenor', clientRate: 0.05,  vendorRate: 0.045 },
];

async function setTariffRate(iTariff, prefix, dest, rate) {
  // Try tariff.setRate first, then tariff.addDestination
  for (const method of ['tariff.setRate', 'tariff.addDestination']) {
    const resp = await sippyPost(xC(method, {
      i_tariff:             iTariff,
      destination:          prefix,
      description:          dest,
      connect_fee:          0,
      price_first:          rate,
      price_next:           rate,
      initial_interval:     1,
      subsequent_interval:  1,
      i_destination_group:  1,
    }));
    if (isOk(resp)) {
      console.log(`    ✓ ${prefix} (${dest}) @ $${rate}/min [${method}]`);
      return;
    }
    const fault = getFault(resp.b);
    if (!fault?.includes('not found')) {
      console.log(`    ✗ ${prefix}: ${fault} [${method}]`);
      return;
    }
  }
  console.log(`    ✗ ${prefix}: no working rate method found`);
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
console.log('\n╔══════════════════════════════════════════════════════════╗');
console.log('║   AIRCEL + TALK Setup on Sippy  (Run 2 - Fixed)         ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

// ── 0. Check existing state ───────────────────────────────────────────────────
console.log('── Step 0: Current Sippy state ──');
const rgResp  = await sippyPost(xC('listRoutingGroups', {}));
const rgIds   = [...rgResp.b.matchAll(/<name>i_routing_group<\/name>\s*<value>\s*(?:<[a-z]+>)?(\d+)/gi)].map(m => parseInt(m[1]));
const rgNames = [...rgResp.b.matchAll(/<name>name<\/name>\s*<value>\s*(?:<[a-z]+>)?([^<]*)/gi)].map(m => m[1]);
const rgMap   = Object.fromEntries(rgIds.map((id, i) => [id, rgNames[i] ?? '']));
console.log('  Routing groups:', JSON.stringify(rgMap));

let rgTalkId  = Object.entries(rgMap).find(([, n]) => n.includes('First Class TALK'))?.[0];

// Check tariffs
const tariffsResp = await sippyPost(xC('listTariffs', {}));
const tariffIds   = [...tariffsResp.b.matchAll(/<name>i_tariff<\/name>\s*<value>\s*(?:<[a-z]+>)?(\d+)/gi)].map(m => parseInt(m[1]));
const tariffNames = [...tariffsResp.b.matchAll(/<name>name<\/name>\s*<value>\s*(?:<[a-z]+>)?([^<]*)/gi)].map(m => m[1]);
const tariffMap   = Object.fromEntries(tariffIds.map((id, i) => [id, tariffNames[i] ?? '']));
console.log('  Tariffs:', JSON.stringify(tariffMap));

let aircelTariffId = Object.entries(tariffMap).find(([, n]) => n.includes('Aircel Pakistan') || n === 'Aircel Pakistan')?.[0];
let talkTariffId   = Object.entries(tariffMap).find(([, n]) => n.includes('TALK Pakistan') || n === 'TALK Pakistan')?.[0];
if (aircelTariffId) aircelTariffId = parseInt(aircelTariffId);
if (talkTariffId)   talkTariffId   = parseInt(talkTariffId);
console.log(`  Aircel tariff ID: ${aircelTariffId ?? 'not found'}`);
console.log(`  TALK tariff ID:   ${talkTariffId ?? 'not found'}`);

// Check vendors
const vendorsResp = await sippyPost(xC('listVendors', {}));
const vendorIds   = [...vendorsResp.b.matchAll(/<name>i_vendor<\/name>\s*<value>\s*(?:<[a-z]+>)?(\d+)/gi)].map(m => parseInt(m[1]));
const vendorNames = [...vendorsResp.b.matchAll(/<name>name<\/name>\s*<value>\s*(?:<[a-z]+>)?([^<]*)/gi)].map(m => m[1]);
const vendorMap   = Object.fromEntries(vendorIds.map((id, i) => [id, vendorNames[i] ?? '']));
console.log('  Vendors:', JSON.stringify(vendorMap));
let talkVendorId  = parseInt(Object.entries(vendorMap).find(([, n]) => n === 'TALK')?.[0] ?? '0') || null;

// ── 1. Create routing group "Pakistan First Class TALK" ───────────────────────
if (!rgTalkId) {
  console.log('\n── Step 1: Creating routing group "Pakistan First Class TALK" ──');
  // policy values to try: 'rr' (round-robin), 'lcr', 'pref', 'ordered', '0', '1', '2'
  for (const policy of ['rr', 'lcr', 'pref', 'ordered', 'least_cost_routing', 'round_robin', '0', '1', '2']) {
    const resp = await sippyPost(xC('addRoutingGroup', {
      name:        'Pakistan First Class TALK',
      policy,
      description: 'Pakistan routing via TALK vendor - First Class tier',
    }));
    if (isOk(resp)) {
      rgTalkId = String(extractId(resp.b, 'i_routing_group') ?? extractId(resp.b, 'i_id'));
      console.log(`  ✓ Routing group created with policy="${policy}". ID: ${rgTalkId}`);
      break;
    }
    const fault = getFault(resp.b);
    if (!fault?.includes('policy')) {
      console.log(`  ✗ policy="${policy}": ${fault}`);
      break;
    }
    console.log(`  - policy="${policy}" rejected: ${fault}`);
  }
  if (!rgTalkId) console.log('  ✗ Could not create routing group — will use existing group 4');
} else {
  console.log(`\n── Step 1: Routing group "Pakistan First Class TALK" already exists (ID: ${rgTalkId}) ──`);
}
const routingGroupForAircel = rgTalkId ? parseInt(rgTalkId) : 4;

// ── 2. Create / use Aircel tariff ─────────────────────────────────────────────
if (!aircelTariffId) {
  console.log('\n── Step 2: Creating Aircel Pakistan tariff ──');
  const resp = await sippyPost(xC('createTariff', { name: 'Aircel Pakistan', currency: 'USD', i_tariff_type: 1, i_customer: 1 }));
  if (isOk(resp)) {
    aircelTariffId = extractId(resp.b, 'i_tariff');
    console.log(`  ✓ Aircel tariff created. ID: ${aircelTariffId}`);
  } else {
    console.log(`  ✗ createTariff (Aircel): ${getFault(resp.b)}`);
  }
} else {
  console.log(`\n── Step 2: Aircel Pakistan tariff already exists (ID: ${aircelTariffId}) ──`);
}

if (aircelTariffId) {
  console.log('  Setting Pakistan rates...');
  for (const { prefix, dest, clientRate } of PAK_PREFIXES) {
    await setTariffRate(aircelTariffId, prefix, dest, clientRate);
  }
}

// ── 3. Create / use TALK tariff ───────────────────────────────────────────────
if (!talkTariffId) {
  console.log('\n── Step 3: Creating TALK Pakistan tariff ──');
  const resp = await sippyPost(xC('createTariff', { name: 'TALK Pakistan', currency: 'USD', i_tariff_type: 1, i_customer: 1 }));
  if (isOk(resp)) {
    talkTariffId = extractId(resp.b, 'i_tariff');
    console.log(`  ✓ TALK tariff created. ID: ${talkTariffId}`);
  } else {
    console.log(`  ✗ createTariff (TALK): ${getFault(resp.b)}`);
  }
} else {
  console.log(`\n── Step 3: TALK Pakistan tariff already exists (ID: ${talkTariffId}) ──`);
}

if (talkTariffId) {
  console.log('  Setting Pakistan vendor rates...');
  for (const { prefix, dest, vendorRate } of PAK_PREFIXES) {
    await setTariffRate(talkTariffId, prefix, dest, vendorRate);
  }
}

// ── 4. Create Aircel account ──────────────────────────────────────────────────
console.log('\n── Step 4: Creating Aircel account ──');

// Billing plan
const bpResp  = await sippyPost(xC('listBillingPlans', {}));
const bpIds   = [...bpResp.b.matchAll(/<name>i_billing_plan<\/name>\s*<value>\s*(?:<[a-z]+>)?(\d+)/gi)].map(m => parseInt(m[1]));
const billingPlan = bpIds[0] ?? 1;

// Check if account "aircel" already exists
const acctList = await sippyPost(xC('listAccounts', { i_customer: 1 }));
const acctUsernames = [...acctList.b.matchAll(/<name>username<\/name>\s*<value>\s*(?:<[a-z]+>)?([^<]*)/gi)].map(m => m[1]);
const acctIds       = [...acctList.b.matchAll(/<name>i_account<\/name>\s*<value>\s*(?:<[a-z]+>)?(\d+)/gi)].map(m => parseInt(m[1]));
const acctMap       = Object.fromEntries(acctIds.map((id, i) => [id, acctUsernames[i] ?? '']));
console.log('  Existing accounts:', JSON.stringify(acctMap));

let aircelAccountId = parseInt(Object.entries(acctMap).find(([, u]) => u === 'aircel')?.[0] ?? '0') || null;
let aircelCreated   = !!aircelAccountId;

if (aircelCreated) {
  console.log(`  Aircel account already exists (ID: ${aircelAccountId}) — will update`);
} else {
  // Try createAccount with welcome_call_ivr as nil (no on_payment_action)
  console.log('  Trying createAccount (welcome_call_ivr=nil, no on_payment_action)...');
  const caParams = {
    username:              'aircel',
    web_password:          'Aircel@2024',
    authname:              'aircel',
    voip_password:         'AircelSIP@99',
    max_sessions:          100,
    max_credit_time:       3600,
    translation_rule:      '',
    cli_translation_rule:  '',
    credit_limit:          0,
    i_time_zone:           1,
    balance:               0,
    cpe_number:            '',
    vm_enabled:            0,
    vm_password:           '11223',
    blocked:               0,
    i_lang:                'en',
    payment_currency:      'USD',
    payment_method:        1,
    i_export_type:         2,
    lifetime:              -1,
    preferred_codec:       18,
    use_preferred_codec_only: 0,
    reg_allowed:           0,
    welcome_call_ivr:      null,   // MUST be sent as <nil/> per Sippy
    // on_payment_action: OMITTED — causes Fatal error 501 on this Sippy instance
    min_payment_amount:    0.0,
    trust_cli:             0,
    disallow_loops:        0,
    vm_notify_emails:      'qadeerjunaid@icloud.com',
    vm_forward_emails:     '',
    vm_del_after_fwd:      0,
    company_name:          'Aircel',
    salutation:            '',
    first_name:            'Aircel',
    last_name:             'Client',
    mid_init:              '',
    street_addr:           '',
    state:                 '',
    postal_code:           '',
    city:                  '',
    country:               'PK',
    contact:               '',
    phone:                 '',
    fax:                   '',
    alt_phone:             '',
    alt_contact:           '',
    email:                 'qadeerjunaid@icloud.com',
    cc:                    'qadeerjunaid@icloud.com',
    bcc:                   '',
    i_password_policy:     1,
    i_media_relay_type:    0,
    i_customer:            1,
    i_billing_plan:        billingPlan,
    i_routing_group:       routingGroupForAircel,
  };
  if (aircelTariffId) caParams.i_tariff = aircelTariffId;

  const caResp = await sippyPost(xCAll('createAccount', caParams));
  console.log('  createAccount →', caResp.s, caResp.b.slice(0, 400));

  if (isOk(caResp)) {
    aircelAccountId = extractId(caResp.b, 'i_account');
    aircelCreated   = true;
    console.log(`  ✓ Aircel created via createAccount! ID: ${aircelAccountId}`);
  } else {
    const fault = getFault(caResp.b);
    console.log(`  ✗ createAccount: ${fault}`);
    // Fallback: updateAccount on account #4
    console.log('  Fallback: updateAccount on account #4...');
    const updateParams = {
      i_account:       4,
      username:        'aircel',
      first_name:      'Aircel',
      last_name:       'Client',
      company_name:    'Aircel',
      email:           'qadeerjunaid@icloud.com',
      cc:              'qadeerjunaid@icloud.com',
      country:         'PK',
      i_routing_group: routingGroupForAircel,
      reg_allowed:     0,
      trust_cli:       0,
      max_sessions:    100,
      max_credit_time: 3600,
      preferred_codec: 18,
      vm_notify_emails:'qadeerjunaid@icloud.com',
    };
    if (aircelTariffId) updateParams.i_tariff      = aircelTariffId;
    if (billingPlan)    updateParams.i_billing_plan = billingPlan;
    const uaResp = await sippyPost(xC('updateAccount', updateParams));
    if (isOk(uaResp)) {
      aircelAccountId = 4; aircelCreated = true;
      console.log('  ✓ Account #4 updated to Aircel');
    } else {
      console.log(`  ✗ updateAccount: ${getFault(uaResp.b)}`);
    }
  }
}

// ── 5. Configure Aircel (auth rule + low balance alert) ───────────────────────
if (aircelCreated && aircelAccountId) {
  console.log(`\n── Step 5: Configuring Aircel account #${aircelAccountId} ──`);

  // Check existing auth rules first
  const arResp = await sippyPost(xC('listAuthRules', { i_account: aircelAccountId }));
  const existingIps = [...arResp.b.matchAll(/<name>remote_ip<\/name>\s*<value>\s*(?:<[a-z]+>)?([^<]*)/gi)].map(m => m[1]);
  console.log('  Existing auth rules IPs:', existingIps);

  if (!existingIps.includes('20.0.0.1')) {
    const authResp = await sippyPost(xC('addAuthRule', {
      i_account:        aircelAccountId,
      i_protocol:       1,
      remote_ip:        '20.0.0.1',
      i_authentication: 1,
    }));
    checkOk('addAuthRule 20.0.0.1', authResp);
  } else {
    console.log('  ✓ IP auth rule 20.0.0.1 already exists');
  }

  // Set low balance alert
  const lbResp = await sippyPost(xC('setLowBalance', {
    i_account:       aircelAccountId,
    threshold:       10.00,
    notify_by_email: 1,
  }));
  if (isOk(lbResp)) {
    console.log('  ✓ Low balance alert set ($10 threshold, email: qadeerjunaid@icloud.com)');
  } else {
    console.log(`  ! setLowBalance: ${getFault(lbResp.b)} (may need balance first)`);
  }

  // Update routing group if needed
  const updateRgResp = await sippyPost(xC('updateAccount', {
    i_account:       aircelAccountId,
    i_routing_group: routingGroupForAircel,
  }));
  checkOk(`updateAccount routing_group=${routingGroupForAircel}`, updateRgResp);
}

// ── 6. Create TALK vendor ──────────────────────────────────────────────────────
if (!talkVendorId) {
  console.log('\n── Step 6: Creating TALK vendor ──');
  // createVendor needs base_currency (learned from run 1)
  for (const method of ['createVendor', 'addVendor']) {
    const params = method === 'createVendor'
      ? { name: 'TALK', web_login: 'talkvendor', web_password: 'TalkVendor@2024', i_time_zone: 1, base_currency: 'USD', i_customer: 1 }
      : { name: 'TALK', web_login: 'talkvendor', web_password: 'TalkVendor@2024', base_currency: 'USD' };
    const resp = await sippyPost(xC(method, params));
    if (isOk(resp)) {
      talkVendorId = extractId(resp.b, 'i_vendor');
      console.log(`  ✓ TALK vendor created via ${method}. ID: ${talkVendorId}`);
      break;
    }
    console.log(`  ✗ ${method}: ${getFault(resp.b) ?? resp.b.slice(0, 200)}`);
  }
} else {
  console.log(`\n── Step 6: TALK vendor already exists (ID: ${talkVendorId}) ──`);
}

// ── 7. Create TALK vendor connection ──────────────────────────────────────────
if (talkVendorId) {
  console.log('\n── Step 7: Creating TALK vendor connection ──');
  // Check existing connections
  const connListResp = await sippyPost(xC('getVendorConnectionsList', { i_vendor: talkVendorId }));
  const connHosts    = [...connListResp.b.matchAll(/<name>host<\/name>\s*<value>\s*(?:<[a-z]+>)?([^<]*)/gi)].map(m => m[1]);
  console.log('  Existing connections:', connHosts);

  if (!connHosts.includes('45.59.163.182')) {
    const connParams = {
      i_vendor:  talkVendorId,
      name:      'TALK-Pakistan',
      host:      '45.59.163.182',
      port:      5060,
      protocol:  1,
      capacity:  100,
    };
    if (talkTariffId) connParams.i_tariff = talkTariffId;

    const connResp = await sippyPost(xC('createVendorConnection', connParams));
    if (isOk(connResp)) {
      const connId = extractId(connResp.b, 'i_vendor_account') ?? extractId(connResp.b, 'i_id');
      console.log(`  ✓ TALK vendor connection created. ID: ${connId}`);
    } else {
      console.log(`  ✗ createVendorConnection: ${getFault(connResp.b) ?? connResp.b.slice(0, 300)}`);
      // Try with additional params
      const connParams2 = { ...connParams, transport: 'UDP' };
      const connResp2 = await sippyPost(xC('createVendorConnection', connParams2));
      if (isOk(connResp2)) {
        console.log(`  ✓ TALK vendor connection created (retry). ID: ${extractId(connResp2.b, 'i_vendor_account')}`);
      } else {
        console.log(`  ✗ retry: ${getFault(connResp2.b) ?? connResp2.b.slice(0, 200)}`);
      }
    }
  } else {
    console.log('  ✓ Connection to 45.59.163.182 already exists');
  }
}

// ── 8. Link TALK vendor to routing group ──────────────────────────────────────
if (rgTalkId && talkVendorId) {
  console.log('\n── Step 8: Adding TALK to routing group ──');
  const resp = await sippyPost(xC('addRoutingGroupMember', {
    i_routing_group: parseInt(rgTalkId),
    i_vendor:        talkVendorId,
    preference:      1,
    huntstop:        0,
  }));
  if (isOk(resp)) {
    console.log(`  ✓ TALK vendor added to routing group ${rgTalkId}`);
  } else {
    console.log(`  ✗ addRoutingGroupMember: ${getFault(resp.b)}`);
  }
}

// ── 9. Summary ───────────────────────────────────────────────────────────────
console.log('\n╔══════════════════════════════════════════════════════════╗');
console.log('║                    SUMMARY                              ║');
console.log('╚══════════════════════════════════════════════════════════╝');
console.log(`  Routing Group "Pakistan First Class TALK": ID=${rgTalkId ?? 'FAILED (used RG #4)'}`);
console.log(`  Aircel Tariff  (Pakistan $0.05/min):       ID=${aircelTariffId ?? 'FAILED'}`);
console.log(`  TALK Tariff    (Pakistan $0.045/min):      ID=${talkTariffId ?? 'FAILED'}`);
console.log(`  Aircel Account:                            ID=${aircelAccountId ?? 'FAILED'} (created=${aircelCreated})`);
console.log(`  TALK Vendor:                               ID=${talkVendorId ?? 'FAILED'}`);
console.log(`  Alert email: qadeerjunaid@icloud.com`);
console.log('');
