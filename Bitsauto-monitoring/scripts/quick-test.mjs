/**
 * Quick tests:
 * 1. createAccount with welcome_call_ivr=0 (instead of nil)
 * 2. Routing group policy probe via listRoutingGroups raw XML
 * 3. Confirm TALK vendor connection
 */

import https from 'https';
import crypto from 'crypto';

const agent = new https.Agent({ rejectUnauthorized: false });
const HOST='191.101.30.107', USER='ssp-root', PASS='!chiaan1', URI='/xmlapi/xmlapi';

function tX(v) {
  if (v===null||v===undefined) return '<nil/>';
  if (typeof v==='number') return Number.isInteger(v)?`<int>${v}</int>`:`<double>${v}</double>`;
  if (typeof v==='boolean') return `<boolean>${v?1:0}</boolean>`;
  return `<string>${String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</string>`;
}
function bM(p) { return Object.entries(p).filter(([,v])=>v!=null).map(([k,v])=>`<member><name>${k}</name><value>${tX(v)}</value></member>`).join(''); }
function xC(m,p) { return `<?xml version="1.0"?><methodCall><methodName>${m}</methodName><params><param><value><struct>${bM(p)}</struct></value></param></params></methodCall>`; }

async function sippyPost(body) {
  const buf=Buffer.from(body,'utf8');
  const makeReq=(ex={})=>new Promise((res,rej)=>{
    const r=https.request({hostname:HOST,port:443,path:URI,method:'POST',headers:{'Content-Type':'text/xml','Content-Length':buf.length,...ex},agent,timeout:20000},
      resp=>{let d='';resp.on('data',c=>d+=c);resp.on('end',()=>res({s:resp.statusCode,b:d,a:resp.headers['www-authenticate']}));});
    r.on('error',rej);r.on('timeout',()=>{r.destroy();rej(new Error('timeout'));});r.write(buf);r.end();
  });
  const probe=await makeReq();
  if(probe.s!==401||!probe.a) return probe;
  const realm=(probe.a.match(/realm="([^"]+)"/)??[])[1]??'',nonce=(probe.a.match(/nonce="([^"]+)"/)??[])[1]??'',opaque=(probe.a.match(/opaque="([^"]+)"/)??[])[1]??'';
  const qop=((probe.a.match(/qop="([^"]+)"/)??probe.a.match(/qop=(\S+)/)??[])[1]??'').split(',').map(s=>s.trim()).find(s=>s==='auth'||s==='auth-int')??'';
  const ha1=crypto.createHash('md5').update(`${USER}:${realm}:${PASS}`).digest('hex'),ha2=crypto.createHash('md5').update(`POST:${URI}`).digest('hex');
  let auth;
  if(qop){const nc='00000001',cn=crypto.randomBytes(8).toString('hex'),rsp=crypto.createHash('md5').update(`${ha1}:${nonce}:${nc}:${cn}:${qop}:${ha2}`).digest('hex');auth=`Digest username="${USER}",realm="${realm}",nonce="${nonce}",uri="${URI}",qop=${qop},nc=${nc},cnonce="${cn}",response="${rsp}"${opaque?`,opaque="${opaque}"`:''}`;}
  else{const rsp=crypto.createHash('md5').update(`${ha1}:${nonce}:${ha2}`).digest('hex');auth=`Digest username="${USER}",realm="${realm}",nonce="${nonce}",uri="${URI}",response="${rsp}"${opaque?`,opaque="${opaque}"`:''}`;}
  return makeReq({Authorization:auth});
}
const getFault=xml=>xml.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()??null;
const isOk=r=>r.s===200&&!r.b.includes('<fault>')&&!r.b.includes('faultCode');
const extractId=(xml,f)=>{const m=xml.match(new RegExp(`<name>${f}<\\/name>\\s*<value>\\s*(?:<[a-z]+>)?(\\d+)`,'i'));return m?parseInt(m[1]):null;};

// ── Test 1: listRoutingGroups raw ─────────────────────────────────────────────
console.log('── Test 1: listRoutingGroups ──');
const r1=await sippyPost(xC('listRoutingGroups',{}));
console.log('Status:', r1.s);
console.log('Body (first 2000):', r1.b.slice(0,2000));

// ── Test 2: createAccount with welcome_call_ivr=0 ─────────────────────────────
console.log('\n── Test 2: createAccount with welcome_call_ivr=0 ──');
const caParams={
  username:'testacct77',web_password:'Test@2024x',authname:'testacct77',voip_password:'TestSIP@77',
  max_sessions:5,max_credit_time:3600,translation_rule:'',cli_translation_rule:'',credit_limit:0,
  i_time_zone:1,balance:0,cpe_number:'',vm_enabled:0,vm_password:'1234',blocked:0,i_lang:'en',
  payment_currency:'USD',payment_method:1,i_export_type:2,lifetime:-1,preferred_codec:18,
  use_preferred_codec_only:0,reg_allowed:0,
  welcome_call_ivr:0,    // Try integer 0 instead of null/<nil/>
  min_payment_amount:0.0,trust_cli:0,disallow_loops:0,vm_notify_emails:'',vm_forward_emails:'',
  vm_del_after_fwd:0,company_name:'TestCo',salutation:'',first_name:'Test',last_name:'Account',
  mid_init:'',street_addr:'',state:'',postal_code:'',city:'',country:'US',contact:'',phone:'',
  fax:'',alt_phone:'',alt_contact:'',email:'test@test.com',cc:'',bcc:'',i_password_policy:1,
  i_media_relay_type:0,i_customer:1,i_billing_plan:1,i_routing_group:4,i_tariff:4,
};
const caResp=await sippyPost(xC('createAccount',caParams));
console.log('Status:', caResp.s, '| Fault:', getFault(caResp.b)??'none');
if(isOk(caResp)){
  const id=extractId(caResp.b,'i_account');
  console.log(`  ✓ createAccount WORKS with welcome_call_ivr=0! ID: ${id}`);
  if(id){const d=await sippyPost(xC('deleteAccount',{i_account:id}));console.log(`  cleanup: ${isOk(d)?'deleted':getFault(d.b)}`);}
} else {
  console.log('  Response:', caResp.b.slice(0,300));
}

// ── Test 3: addRoutingGroup policy probe ──────────────────────────────────────
console.log('\n── Test 3: Routing group policy probe (integers) ──');
for(const policy of [1,2,3,4,5,6,7,8,9,10]){
  const resp=await sippyPost(xC('addRoutingGroup',{name:`PAKTEST_${policy}`,policy}));
  if(isOk(resp)){
    const id=extractId(resp.b,'i_routing_group')??extractId(resp.b,'i_id');
    console.log(`  ✓ policy=${policy} WORKS! ID: ${id}`);
    // clean up
    if(id) await sippyPost(xC('deleteRoutingGroup',{i_routing_group:id}));
    break;
  }
  const f=getFault(resp.b);
  if(f&&!f.includes('policy')&&!f.includes('Wrong value')&&!f.includes('Parameter')){console.log(`  ✗ policy=${policy}: ${f}`);break;}
  if(!f){console.log(`  ✗ policy=${policy}: no fault (status=${resp.s}), body:`,resp.b.slice(0,100));}
  else console.log(`  - policy=${policy}: ${f}`);
}

// ── Test 4: Check TALK vendor ID=3 connections ───────────────────────────────
console.log('\n── Test 4: TALK vendor connections ──');
const connResp=await sippyPost(xC('getVendorConnectionsList',{i_vendor:3}));
console.log('Status:', connResp.s);
console.log('Body:', connResp.b.slice(0,1500));
