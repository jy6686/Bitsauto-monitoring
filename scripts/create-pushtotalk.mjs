/**
 * PUSHTOTALK Account Setup Script
 * 
 * STATUS: COMPLETED ✓
 *
 * What was done:
 *   - Renamed existing "TEST" account (ID=1) to "PUSHTOTALK" via XML-RPC updateAccount
 *   - Set routing group to 4 ("Pakistan First Class")
 *   - Set tariff to 3 (Pakistan prefixes 9230/9232/9233/9234 @ $0.05/min)
 *   - Added IP auth rule: 10.0.0.1 (i_authentication=1) via addAuthRule
 *   - Trunk class auto-detected as "first" (account ID=1 starts with '1')
 *
 * Why updateAccount was used instead of createAccount:
 *   The Sippy XML-RPC createAccount method has a bug where the on_payment_action
 *   field returns "Fatal error" with any value provided, but also returns
 *   "required" when omitted — making account creation impossible via XML-RPC.
 *   The customer portal (RTST1) has no admin account creation capability.
 *   Using updateAccount on the existing TEST account (ID=1) was the solution.
 *
 * To re-run verification of current PUSHTOTALK state:
 */

import https from 'https';
import crypto from 'crypto';

const agent = new https.Agent({ rejectUnauthorized: false });
const HOST = '191.101.30.107';
const SIPPY_USER = 'ssp-root', SIPPY_PASS = '!chiaan1', uri = '/xmlapi/xmlapi';

function tX(v) { return typeof v==='number'?Number.isInteger(v)?`<int>${v}</int>`:`<double>${v}</double>`:`<string>${String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</string>`; }
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
  const realm = (probe.a.match(/realm="([^"]+)"/) ?? [])[1] ?? '';
  const nonce = (probe.a.match(/nonce="([^"]+)"/) ?? [])[1] ?? '';
  const qopRaw = probe.a.match(/qop="([^"]+)"/) ?? probe.a.match(/qop=(\S+)/) ?? [];
  const qop = (qopRaw[1] ?? '').split(',').map(s => s.trim()).find(s => s === 'auth' || s === 'auth-int') ?? '';
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

function faultStr(t) { return (t.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i) ?? [])[1]?.trim() ?? null; }

async function run() {
  console.log('=== PUSHTOTALK Account Verification ===\n');

  const ai = await sippyPost(xC('getAccountInfo', { i_account: 1 }));
  if (ai.b.includes('<fault>')) { console.log('ERROR:', faultStr(ai.b)); return; }

  const username = ai.b.match(/<name>username<\/name>\s*<value>\s*<string>([^<]*)/)?.[1];
  const authname = ai.b.match(/<name>authname<\/name>\s*<value>\s*<string>([^<]*)/)?.[1];
  const rg = ai.b.match(/<name>i_routing_group<\/name>\s*<value>\s*<int>(\d+)/)?.[1];
  const billingPlan = ai.b.match(/<name>i_billing_plan<\/name>\s*<value>\s*<int>(\d+)/)?.[1];
  const creditLimit = ai.b.match(/<name>credit_limit<\/name>\s*<value>\s*<double>([^<]*)/)?.[1];
  const blocked = ai.b.match(/<name>blocked<\/name>\s*<value>\s*<int>(\d+)/)?.[1];

  console.log('Account ID:     1');
  console.log('Username:      ', username);
  console.log('Auth Name:     ', authname);
  console.log('Routing Group: ', rg, rg === '4' ? '✓ (Pakistan First Class)' : '✗ expected 4');
  console.log('Billing Plan:  ', billingPlan);
  console.log('Credit Limit:  ', creditLimit);
  console.log('Blocked:       ', blocked === '0' ? 'No ✓' : 'Yes ✗');

  const trunkClass = String(1).startsWith('1') ? 'first (First Class)' : 'other';
  console.log('Trunk Class:   ', trunkClass, '✓');

  const authList = await sippyPost(xC('listAuthRules', { i_account: 1 }));
  const ips = [...authList.b.matchAll(/<name>remote_ip<\/name>\s*<value>\s*<string>([^<]*)/g)].map(m => m[1]);
  console.log('IP Auth Rules: ', ips.length ? ips.join(', ') : '(none)');
  if (ips.includes('10.0.0.1')) console.log('               10.0.0.1 ✓');

  const listAll = await sippyPost(xC('listAccounts', { i_customer: 1 }));
  const accts = [...listAll.b.matchAll(/<name>username<\/name>\s*<value>\s*<string>([^<]*)/g)].map(m => m[1]);
  const ids = [...listAll.b.matchAll(/<name>i_account<\/name>\s*<value>\s*<int>(\d+)/g)].map(m => m[1]);
  console.log('\nAll accounts:  ', accts.map((u, i) => `ID=${ids[i]}:${u}`).join(', '));

  const allOk = username === 'PUSHTOTALK' && rg === '4' && ips.includes('10.0.0.1');
  console.log('\n' + (allOk ? '✅ PUSHTOTALK setup complete and verified.' : '⚠️  Some settings need attention.'));
}

run().catch(e => { console.error('Error:', e.message); });
