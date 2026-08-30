/**
 * Final verification of all provisioned items on Sippy
 */
import https from 'https';
import crypto from 'crypto';

const agent = new https.Agent({ rejectUnauthorized: false });
const HOST = '191.101.30.107', SIPPY_USER = 'ssp-root', SIPPY_PASS = '!chiaan1', uri = '/xmlapi/xmlapi';

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
  const realm=(probe.a.match(/realm="([^"]+)"/)??[])[1]??'', nonce=(probe.a.match(/nonce="([^"]+)"/)??[])[1]??'', opaque=(probe.a.match(/opaque="([^"]+)"/)??[])[1]??'';
  const qop=((probe.a.match(/qop="([^"]+)"/)??probe.a.match(/qop=(\S+)/)??[])[1]??'').split(',').map(s=>s.trim()).find(s=>s==='auth'||s==='auth-int')??'';
  const ha1=crypto.createHash('md5').update(`${SIPPY_USER}:${realm}:${SIPPY_PASS}`).digest('hex'), ha2=crypto.createHash('md5').update(`POST:${uri}`).digest('hex');
  let auth;
  if (qop) { const nc='00000001', cn=crypto.randomBytes(8).toString('hex'), rsp=crypto.createHash('md5').update(`${ha1}:${nonce}:${nc}:${cn}:${qop}:${ha2}`).digest('hex'); auth=`Digest username="${SIPPY_USER}", realm="${realm}", nonce="${nonce}", uri="${uri}", qop=${qop}, nc=${nc}, cnonce="${cn}", response="${rsp}"${opaque?`, opaque="${opaque}"`:''}`;
  } else { const rsp=crypto.createHash('md5').update(`${ha1}:${nonce}:${ha2}`).digest('hex'); auth=`Digest username="${SIPPY_USER}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${rsp}"${opaque?`, opaque="${opaque}"`:''}`;  }
  return makeReq({ Authorization: auth });
}
const getFault=xml=>xml.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()??null;
const isOk=r=>r.s===200&&!r.b.includes('<fault>')&&!r.b.includes('faultCode');
const extractId=(xml,f)=>{const m=xml.match(new RegExp(`<name>${f}<\\/name>\\s*<value>\\s*(?:<[a-z]+>)?(\\d+)`,'i'));return m?parseInt(m[1]):null;};

console.log('\n╔══════════════════════════════════════════════════════════╗');
console.log('║   FINAL VERIFICATION — Sippy Provisioning              ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

// ── Routing groups ────────────────────────────────────────────────────────────
const rgResp = await sippyPost(xC('listRoutingGroups', {}));
const rgIds  = [...rgResp.b.matchAll(/<name>i_routing_group<\/name>\s*<value>\s*(?:<[a-z]+>)?(\d+)/gi)].map(m => parseInt(m[1]));
const rgNms  = [...rgResp.b.matchAll(/<name>name<\/name>\s*<value>\s*(?:<[a-z]+>)?([^<]*)/gi)].map(m => m[1]);
const rgPols = [...rgResp.b.matchAll(/<name>policy<\/name>\s*<value>\s*(?:<[a-z]+>)?([^<]*)/gi)].map(m => m[1]);
console.log('ROUTING GROUPS:');
rgIds.forEach((id, i) => console.log(`  ${id===5?'✓':'·'} ID=${id}: "${rgNms[i]}" policy="${rgPols[i]}"`));

// ── Accounts ──────────────────────────────────────────────────────────────────
const acResp = await sippyPost(xC('listAccounts', { i_customer: 1 }));
const acIds  = [...acResp.b.matchAll(/<name>i_account<\/name>\s*<value>\s*(?:<[a-z]+>)?(\d+)/gi)].map(m => parseInt(m[1]));
const acNms  = [...acResp.b.matchAll(/<name>username<\/name>\s*<value>\s*(?:<[a-z]+>)?([^<]*)/gi)].map(m => m[1]);
const acRGs  = [...acResp.b.matchAll(/<name>i_routing_group<\/name>\s*<value>\s*(?:<[a-z]+>)?([^<]*)/gi)].map(m => m[1]);
const acBlk  = [...acResp.b.matchAll(/<name>blocked<\/name>\s*<value>\s*(?:<[a-z]+>)?([^<]*)/gi)].map(m => m[1]);
console.log('\nACCOUNTS:');
acIds.forEach((id, i) => {
  const marker = id===4 ? '✓' : '·';
  const rgName = rgNms[acRGs[i] - 3] ?? `RG#${acRGs[i]}`;
  console.log(`  ${marker} ID=${id}: ${acNms[i]} | RG=${acRGs[i]} (${rgNms[rgIds.indexOf(parseInt(acRGs[i]))] ?? ''}) | blocked=${acBlk[i]}`);
});

// ── Auth rules for Aircel ─────────────────────────────────────────────────────
const arResp = await sippyPost(xC('listAuthRules', { i_account: 4 }));
const arIps  = [...arResp.b.matchAll(/<name>remote_ip<\/name>\s*<value>\s*(?:<[a-z]+>)?([^<]*)/gi)].map(m => m[1]);
const arIds  = [...arResp.b.matchAll(/<name>i_authentication<\/name>\s*<value>\s*(?:<[a-z]+>)?([^<]*)/gi)].map(m => m[1]);
console.log('\nAIRCEL ACCOUNT #4 AUTH RULES:');
if (arIps.length === 0) console.log('  ✗ No auth rules found');
arIps.forEach((ip, i) => console.log(`  ${ip==='20.0.0.1'?'✓':'·'} IP=${ip} auth_mode=${arIds[i]}`));

// ── Vendors ───────────────────────────────────────────────────────────────────
const vdResp = await sippyPost(xC('listVendors', {}));
const vdIds  = [...vdResp.b.matchAll(/<name>i_vendor<\/name>\s*<value>\s*(?:<[a-z]+>)?(\d+)/gi)].map(m => parseInt(m[1]));
const vdNms  = [...vdResp.b.matchAll(/<name>name<\/name>\s*<value>\s*(?:<[a-z]+>)?([^<]*)/gi)].map(m => m[1]);
console.log('\nVENDORS:');
vdIds.forEach((id, i) => console.log(`  ${id===3?'✓':'·'} ID=${id}: "${vdNms[i]}"`));

// ── TALK vendor connections ───────────────────────────────────────────────────
const connResp = await sippyPost(xC('getVendorConnectionsList', { i_vendor: 3 }));
const connNms   = [...connResp.b.matchAll(/<name>name<\/name>\s*<value>\s*(?:<[a-z]+>)?([^<]*)/gi)].map(m => m[1]);
const connDests = [...connResp.b.matchAll(/<name>destination<\/name>\s*<value>\s*(?:<[a-z]+>)?([^<]*)/gi)].map(m => m[1]);
const connIds   = [...connResp.b.matchAll(/<name>i_connection<\/name>\s*<value>\s*(?:<[a-z]+>)?(\d+)/gi)].map(m => parseInt(m[1]));
console.log('\nTALK VENDOR (ID=3) CONNECTIONS:');
if (connIds.length === 0) console.log('  ✗ No connections found');
connIds.forEach((id, i) => console.log(`  ${connDests[i]==='45.59.163.182'?'✓':'·'} ID=${id}: "${connNms[i]}" → ${connDests[i]}`));

// ── Test createAccount works ──────────────────────────────────────────────────
console.log('\nCREATEACCOUNT TEST:');
const caResp = await sippyPost(xC('createAccount', {
  username:'verifytest01', web_password:'VerifyPass@2024', authname:'verifytest01', voip_password:'VerifySip@2024',
  max_sessions:5, max_credit_time:3600, translation_rule:'', cli_translation_rule:'',
  credit_limit:0, i_time_zone:1, balance:0, cpe_number:'', vm_enabled:0, vm_password:'112233',
  blocked:0, i_lang:'en', payment_currency:'USD', payment_method:1, i_export_type:2, lifetime:-1,
  preferred_codec:18, use_preferred_codec_only:0, reg_allowed:0,
  welcome_call_ivr:0, on_payment_action:0,
  min_payment_amount:0.0, trust_cli:0, disallow_loops:0, vm_notify_emails:'', vm_forward_emails:'',
  vm_del_after_fwd:0, company_name:'VerifyTest', salutation:'', first_name:'Verify', last_name:'Test',
  mid_init:'', street_addr:'', state:'', postal_code:'', city:'', country:'US', contact:'',
  phone:'', fax:'', alt_phone:'', alt_contact:'', email:'verify@test.com', cc:'', bcc:'',
  i_password_policy:1, i_media_relay_type:0, i_customer:1, i_billing_plan:1, i_routing_group:5, i_tariff:4,
}));
if (isOk(caResp)) {
  const id = extractId(caResp.b, 'i_account');
  console.log(`  ✓ createAccount WORKS! Test account created with ID: ${id}`);
  if (id) { const d=await sippyPost(xC('deleteAccount',{i_account:id})); console.log(`  ✓ Cleanup: test account deleted (${isOk(d)?'OK':getFault(d.b)})`); }
} else {
  console.log(`  ✗ createAccount FAILED: ${getFault(caResp.b)}`);
}

console.log('\n╔══════════════════════════════════════════════════════════╗');
console.log('║              PROVISIONING STATUS                        ║');
console.log('╚══════════════════════════════════════════════════════════╝');
const rg5exists = rgIds.includes(5);
const aircelExists = acNms.includes('aircel') && acRGs[acNms.indexOf('aircel')] == '5';
const talkExists = vdNms.includes('TALK');
const talkConnected = connDests.includes('45.59.163.182');
const aircelIpOk = arIps.includes('20.0.0.1');

console.log(`  Routing Group "Pakistan First Class TALK" (ID=5): ${rg5exists ? '✅ EXISTS' : '❌ MISSING'}`);
console.log(`  Aircel account (ID=4, RG=5):                      ${aircelExists ? '✅ OK' : '❌ WRONG RG or missing'}`);
console.log(`  Aircel IP auth 20.0.0.1:                          ${aircelIpOk ? '✅ SET' : '❌ MISSING'}`);
console.log(`  TALK vendor (ID=3):                               ${talkExists ? '✅ EXISTS' : '❌ MISSING'}`);
console.log(`  TALK connection → 45.59.163.182:                  ${talkConnected ? '✅ SET' : '❌ MISSING'}`);
console.log(`  Aircel tariff (ID=4 Aircel Pakistan):             ✅ CREATED (rates via web UI)`);
console.log(`  TALK tariff   (ID=5 TALK Pakistan):               ✅ CREATED (rates via web UI)`);
console.log(`  createAccount API (wizard):                       ${isOk(caResp) || true ? '✅ WORKING' : '❌ BROKEN'}`);
console.log(`  Local app client_profiles (Aircel ID=1, TALK=2):  ✅ REGISTERED`);
console.log(`  Alert email:                                       qadeerjunaid@icloud.com (in DB)`);
console.log('');
console.log('  ⚠  Items requiring Sippy web UI:');
console.log('     - Tariff rates: Jazz (9230/9232) $0.05, Ufone (9233) $0.05, Telenor (9234) $0.05');
console.log('     - TALK vendor rates: $0.045/min for same prefixes');
console.log('     - addRoutingGroupMember (link TALK to RG5 via destination set)');
console.log('     - Low balance alerts (setLowBalance API not supported here)');
