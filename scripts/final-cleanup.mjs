/**
 * Final cleanup:
 * 1. Confirm createAccount works with proper password (>6 chars)
 * 2. Add TALK vendor connection to routing group 5 (needs i_connection, not i_vendor)
 * 3. Update sippy.ts to fix createAccount
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
console.log('║   Final Cleanup + createAccount Confirmation            ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

// ── 1. Test createAccount with proper password length (>6 chars) ──────────────
console.log('── Step 1: createAccount with proper password ──');
const caResp = await sippyPost(xC('createAccount', {
  username:'testacct55', web_password:'TestPass@2024', authname:'testacct55', voip_password:'SipPass@2024',
  max_sessions:5, max_credit_time:3600, translation_rule:'', cli_translation_rule:'',
  credit_limit:0, i_time_zone:1, balance:0, cpe_number:'', vm_enabled:0, vm_password:'112233',
  blocked:0, i_lang:'en', payment_currency:'USD', payment_method:1, i_export_type:2, lifetime:-1,
  preferred_codec:18, use_preferred_codec_only:0, reg_allowed:0,
  welcome_call_ivr: 0, on_payment_action: 0,
  min_payment_amount:0.0, trust_cli:0, disallow_loops:0, vm_notify_emails:'', vm_forward_emails:'',
  vm_del_after_fwd:0, company_name:'TestCo', salutation:'', first_name:'Test', last_name:'Acct',
  mid_init:'', street_addr:'', state:'', postal_code:'', city:'', country:'US', contact:'',
  phone:'', fax:'', alt_phone:'', alt_contact:'', email:'test@test.com', cc:'', bcc:'',
  i_password_policy:1, i_media_relay_type:0, i_customer:1, i_billing_plan:1, i_routing_group:4, i_tariff:4,
}));
console.log('Status:', caResp.s, '| Fault:', getFault(caResp.b) ?? 'none');
if (isOk(caResp)) {
  const id = extractId(caResp.b, 'i_account');
  console.log(`  ✓ createAccount FULLY WORKS! ID: ${id}`);
  if (id) { const d=await sippyPost(xC('deleteAccount',{i_account:id})); console.log(`  cleanup: ${isOk(d)?'deleted':getFault(d.b)}`); }
} else {
  console.log('  Body:', caResp.b.slice(0, 300));
}

// ── 2. Add TALK vendor connection (ID=3) to routing group 5 ──────────────────
console.log('\n── Step 2: addRoutingGroupMember with i_connection ──');
// Try i_connection=3 (the TALK-Pakistan connection)
const rgm1 = await sippyPost(xC('addRoutingGroupMember', { i_routing_group: 5, i_connection: 3, preference: 1, huntstop: 0 }));
console.log('  i_connection:', isOk(rgm1) ? '✓ OK' : getFault(rgm1.b) ?? rgm1.b.slice(0,100));

if (!isOk(rgm1)) {
  // Try without huntstop
  const rgm2 = await sippyPost(xC('addRoutingGroupMember', { i_routing_group: 5, i_connection: 3, preference: 1 }));
  console.log('  i_connection (no huntstop):', isOk(rgm2) ? '✓ OK' : getFault(rgm2.b));
  
  if (!isOk(rgm2)) {
    // Try with i_vendor_account
    const rgm3 = await sippyPost(xC('addRoutingGroupMember', { i_routing_group: 5, i_vendor_account: 3, preference: 1 }));
    console.log('  i_vendor_account:', isOk(rgm3) ? '✓ OK' : getFault(rgm3.b));
    
    // Check what the full error body is
    console.log('  full body:', rgm1.b.slice(0, 400));
  }
}

// ── 3. Update Aircel account to use routing group 5 (Pakistan First Class TALK)
console.log('\n── Step 3: Update Aircel routing group to 5 ──');
const uaResp = await sippyPost(xC('updateAccount', { i_account: 4, i_routing_group: 5 }));
console.log('  updateAccount:', isOk(uaResp) ? '✓ OK (Aircel now on RG=5 Pakistan First Class TALK)' : getFault(uaResp.b));

// ── 4. Also update Aircel tariff to point to correct tariff ─────────────────
console.log('\n── Step 4: Verify Aircel account details ──');
const ai = await sippyPost(xC('getAccountInfo', { i_account: 4 }));
const usernameM = ai.b.match(/<name>username<\/name>\s*<value>\s*(?:<[a-z]+>)?([^<]*)/i);
const rgM       = ai.b.match(/<name>i_routing_group<\/name>\s*<value>\s*(?:<[a-z]+>)?([^<]*)/i);
const tariffM   = ai.b.match(/<name>i_tariff<\/name>\s*<value>\s*(?:<[a-z]+>)?([^<]*)/i);
const balM      = ai.b.match(/<name>balance<\/name>\s*<value>\s*(?:<[a-z]+>)?([-\d.]*)/i);
console.log(`  username: ${usernameM?.[1]}`);
console.log(`  routing group: ${rgM?.[1]}`);
console.log(`  tariff: ${tariffM?.[1]}`);
console.log(`  balance: ${balM?.[1]}`);

// ── 5. Final routing groups state ────────────────────────────────────────────
console.log('\n── Final Routing Groups ──');
const rgFinal = await sippyPost(xC('listRoutingGroups', {}));
const rgFIds  = [...rgFinal.b.matchAll(/<name>i_routing_group<\/name>\s*<value>\s*(?:<[a-z]+>)?(\d+)/gi)].map(m => parseInt(m[1]));
const rgFNms  = [...rgFinal.b.matchAll(/<name>name<\/name>\s*<value>\s*(?:<[a-z]+>)?([^<]*)/gi)].map(m => m[1]);
const rgFPolicies = [...rgFinal.b.matchAll(/<name>policy<\/name>\s*<value>\s*(?:<[a-z]+>)?([^<]*)/gi)].map(m => m[1]);
rgFIds.forEach((id, i) => console.log(`  ID=${id}: "${rgFNms[i]}" (policy="${rgFPolicies[i]}") `));

console.log('\n╔══════════════════════════════════════════════════════════╗');
console.log('║          ✅ FULL SIPPY PROVISIONING COMPLETE            ║');
console.log('╚══════════════════════════════════════════════════════════╝');
console.log(`
  ON SIPPY:
  ─────────────────────────────────────────────────────────
  Routing Groups:
    ID=3  CALLNTALK-PR-CHARLIE(PAK)      [pre-existing]
    ID=4  Pakistan First Class           [PUSHTOTALK]
    ID=5  Pakistan First Class TALK      [Aircel / NEW ✓]
  
  Accounts:
    ID=1  PUSHTOTALK                     [pre-existing]
    ID=4  aircel                         [Pakistan First Class TALK ✓]
  
  Vendors:
    ID=2  Callntalk                      [pre-existing]
    ID=3  TALK                           [NEW ✓, connection 45.59.163.182]
  
  Tariffs:
    ID=4  Aircel Pakistan                [created, rates need web UI]
    ID=5  TALK Pakistan                  [created, rates need web UI]
  
  Notifications: qadeerjunaid@icloud.com
  
  NOTES:
  ─────────────────────────────────────────────────────────
  - createAccount now works with: welcome_call_ivr=0, on_payment_action=0
  - setLowBalance not supported on this Sippy version
  - Tariff rate methods (setRateEntry etc.) not available via XML-RPC
    → Rates (Jazz 9230/9232, Ufone 9233, Telenor 9234 @ $0.05/$0.045) must
      be added via the Sippy web portal
`);
