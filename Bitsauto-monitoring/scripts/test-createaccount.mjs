/**
 * Test createAccount with both welcome_call_ivr=0 AND on_payment_action=0
 * Also get full listRoutingGroups XML to find the policy value from existing groups
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

// ── 1. Get full routing groups XML ────────────────────────────────────────────
console.log('── listRoutingGroups raw XML ──');
const rgFull = await sippyPost(xC('listRoutingGroups', {}));
console.log('Status:', rgFull.s);
// Print first 4000 chars to find policy value
console.log(rgFull.b.slice(0, 4000));

// ── 2. createAccount with both fields=0 ───────────────────────────────────────
console.log('\n── createAccount: welcome_call_ivr=0, on_payment_action=0 ──');
const caParams0 = {
  username:'testacct55', web_password:'Test@55', authname:'testacct55', voip_password:'Sip@55',
  max_sessions:5, max_credit_time:3600, translation_rule:'', cli_translation_rule:'',
  credit_limit:0, i_time_zone:1, balance:0, cpe_number:'', vm_enabled:0, vm_password:'1234',
  blocked:0, i_lang:'en', payment_currency:'USD', payment_method:1, i_export_type:2, lifetime:-1,
  preferred_codec:18, use_preferred_codec_only:0, reg_allowed:0,
  welcome_call_ivr:0, on_payment_action:0,
  min_payment_amount:0.0, trust_cli:0, disallow_loops:0, vm_notify_emails:'', vm_forward_emails:'',
  vm_del_after_fwd:0, company_name:'TestCo', salutation:'', first_name:'Test', last_name:'Acct',
  mid_init:'', street_addr:'', state:'', postal_code:'', city:'', country:'US', contact:'',
  phone:'', fax:'', alt_phone:'', alt_contact:'', email:'test@test.com', cc:'', bcc:'',
  i_password_policy:1, i_media_relay_type:0, i_customer:1, i_billing_plan:1, i_routing_group:4, i_tariff:4,
};
const ca0 = await sippyPost(xC('createAccount', caParams0));
console.log('Status:', ca0.s, '| Fault:', getFault(ca0.b)??'none');
if (isOk(ca0)) {
  const id = extractId(ca0.b, 'i_account');
  console.log(`  ✓ WORKS! ID: ${id}`);
  if (id) { const d=await sippyPost(xC('deleteAccount',{i_account:id})); console.log(`  cleanup: ${isOk(d)?'deleted':getFault(d.b)}`); }
} else console.log('  Body:', ca0.b.slice(0, 200));

// ── 3. createAccount with on_payment_action=1 ─────────────────────────────────
console.log('\n── createAccount: on_payment_action=1 ──');
const ca1 = await sippyPost(xC('createAccount', { ...caParams0, username:'testacct56', authname:'testacct56', on_payment_action:1 }));
console.log('Status:', ca1.s, '| Fault:', getFault(ca1.b)??'none');
if (isOk(ca1)) { const id=extractId(ca1.b,'i_account'); console.log(`  ✓ WORKS! ID: ${id}`); if(id) await sippyPost(xC('deleteAccount',{i_account:id})); }

// ── 4. TALK vendor connection details ────────────────────────────────────────
console.log('\n── TALK vendor connection details (full XML) ──');
const connFull = await sippyPost(xC('getVendorConnectionsList', { i_vendor: 3 }));
console.log(connFull.b.slice(0, 2000));
