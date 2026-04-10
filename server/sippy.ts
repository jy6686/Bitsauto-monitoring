/**
 * Sippy Softswitch Integration
 *
 * Reference: https://support.sippysoft.com/support/solutions/articles/106909
 *
 * Dual-mode integration:
 * 1. XML-RPC API at /xmlapi/xmlapi — authenticated via HTTP Digest (RFC-2617).
 *    Credentials: Web Login (username) + API Password (separate from portal password,
 *    set in Sippy portal → My Preferences → "Allow API Calls" + API Password field).
 *    Admin credentials (e.g. ssp-root) provide root-level access to all customers.
 *    Customer-level credentials only see that customer's data.
 *
 * 2. Web portal session scraping — fallback when XML-RPC is unavailable.
 *    Authenticates via POST /main.php using web portal username + web password,
 *    then maintains session cookies and scrapes HTML pages.
 *
 * Credential priority for XML-RPC calls (in routes.ts via sippyXmlCreds()):
 *   apiAdminUsername / apiAdminPassword  →  admin root access (preferred)
 *   portalUsername   / portalPassword    →  customer-level access (fallback)
 */

import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import { URL } from 'node:url';

// ── Cookie jar type ───────────────────────────────────────────────────────────

type CookieJar = Map<string, string>;

function parseCookies(setCookieHeaders: string[]): CookieJar {
  const jar: CookieJar = new Map();
  for (const header of setCookieHeaders) {
    const parts = header.split(';');
    const pair = (parts[0] || '').trim();
    const eqIdx = pair.indexOf('=');
    if (eqIdx > 0) {
      jar.set(pair.substring(0, eqIdx).trim(), pair.substring(eqIdx + 1).trim());
    }
  }
  return jar;
}

function mergeCookies(base: CookieJar, incoming: CookieJar): CookieJar {
  const merged = new Map(base);
  for (const [k, v] of incoming) merged.set(k, v);
  return merged;
}

function serializeCookies(jar: CookieJar): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

// ── In-memory session state ───────────────────────────────────────────────────

interface SippySession {
  portalUrl: string;
  username: string;
  connectedAt: Date;
  mode: 'xmlrpc' | 'portal';
  cookies?: CookieJar;
  accountType?: string;
}

let activeSession: SippySession | null = null;

export function getSippySessionStatus() {
  if (!activeSession) return { active: false };
  return {
    active: true,
    username: activeSession.username,
    connectedAt: activeSession.connectedAt.toISOString(),
    portalBase: activeSession.portalUrl,
    mode: activeSession.mode,
  };
}

export function clearSippySession() {
  activeSession = null;
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

// Shared HTTPS agent that ignores self-signed / untrusted certificates.
// Sippy deployments frequently use self-signed certs on private IPs.
const lenientHttpsAgent = new https.Agent({ rejectUnauthorized: false });

function makeHttpsOpts(parsed: URL, extra: http.RequestOptions): http.RequestOptions {
  return {
    ...extra,
    hostname: parsed.hostname,
    port: parsed.port ? parseInt(parsed.port) : 443,
    path: parsed.pathname + parsed.search,
    // Bypass self-signed certificate errors (common in on-prem Sippy installs)
    agent: lenientHttpsAgent,
    rejectUnauthorized: false,
  } as http.RequestOptions;
}

function rawPost(
  url: string,
  body: string,
  headers: Record<string, string>,
  redirectsLeft = 5,
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const mod = isHttps ? https : http;

    const baseOpts: http.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port ? parseInt(parsed.port) : (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml',
        'Content-Length': Buffer.byteLength(body),
        ...headers,
      },
      timeout: 12000,
    };
    const opts = isHttps ? makeHttpsOpts(parsed, baseOpts) : baseOpts;

    const req = mod.request(opts, (res) => {
      const sc = res.statusCode ?? 0;
      // Follow 301/302/307/308 redirects automatically
      if ((sc === 301 || sc === 302 || sc === 307 || sc === 308) && res.headers.location && redirectsLeft > 0) {
        res.resume(); // drain
        const next = new URL(res.headers.location, url).toString();
        rawPost(next, body, headers, redirectsLeft - 1).then(resolve).catch(reject);
        return;
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ statusCode: sc, body: data }));
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.write(body);
    req.end();
  });
}

function rawGet(
  url: string,
  headers: Record<string, string>,
  redirectsLeft = 5,
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const mod = isHttps ? https : http;

    const baseOpts: http.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port ? parseInt(parsed.port) : (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers,
      timeout: 12000,
    };
    const opts = isHttps ? makeHttpsOpts(parsed, baseOpts) : baseOpts;

    const req = mod.request(opts, (res) => {
      const sc = res.statusCode ?? 0;
      if ((sc === 301 || sc === 302 || sc === 307 || sc === 308) && res.headers.location && redirectsLeft > 0) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        rawGet(next, headers, redirectsLeft - 1).then(resolve).catch(reject);
        return;
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ statusCode: sc, body: data }));
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.end();
  });
}

function basicAuth(username: string, password: string) {
  return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
}

/**
 * Two-step Digest-auth POST for the Sippy XML-RPC endpoint.
 *
 * Step 1 — send the request with no credentials; the server responds 401 with
 *           a WWW-Authenticate: Digest challenge (realm, nonce, qop, opaque).
 * Step 2 — compute the RFC-2617 digest response and resend with proper header.
 *
 * Falls back to HTTP Basic auth if the server does not issue a Digest challenge.
 */
async function sippyPost(
  url: string,
  body: string,
  username: string,
  password: string,
): Promise<{ statusCode: number; body: string }> {
  const parsed  = new URL(url);
  const uri     = parsed.pathname + (parsed.search || '');
  const isHttps = parsed.protocol === 'https:';

  function makeReq(
    extraHeaders: Record<string, string | number>,
  ): Promise<{ statusCode: number; body: string; wwwAuth?: string }> {
    return new Promise((resolve, reject) => {
      const opts: http.RequestOptions = {
        hostname: parsed.hostname,
        port:     parsed.port ? parseInt(parsed.port) : (isHttps ? 443 : 80),
        path:     uri,
        method:   'POST',
        headers:  {
          'Content-Type':   'text/xml',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent':     'SippyAPI/1.0',
          ...extraHeaders,
        },
        timeout: 12000,
        ...(isHttps ? { agent: lenientHttpsAgent, rejectUnauthorized: false } : {}),
      };
      let data = '';
      const req = (isHttps ? https : http).request(opts, (res) => {
        const wwwAuth = res.headers['www-authenticate'] as string | undefined;
        res.on('data',  (chunk) => { data += chunk; });
        res.on('end',   () => resolve({ statusCode: res.statusCode ?? 0, body: data, wwwAuth }));
      });
      req.on('error',   reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
      req.write(body);
      req.end();
    });
  }

  // ── Step 1: probe for auth challenge ──────────────────────────────────────
  const probe = await makeReq({});
  if (probe.statusCode !== 401 || !probe.wwwAuth) {
    return { statusCode: probe.statusCode, body: probe.body };
  }

  // ── Step 2: Digest auth ───────────────────────────────────────────────────
  if (probe.wwwAuth.toLowerCase().includes('digest')) {
    const realm   = (probe.wwwAuth.match(/realm="([^"]+)"/)  || [])[1] || '';
    const nonce   = (probe.wwwAuth.match(/nonce="([^"]+)"/)  || [])[1] || '';
    const qopRaw  = (probe.wwwAuth.match(/qop=(?:"([^"]+)"|([^,\s]+))/) || []);
    const qop     = qopRaw[1] || qopRaw[2] || '';
    const opaque  = (probe.wwwAuth.match(/opaque="([^"]+)"/) || [])[1] || '';

    const ha1 = crypto.createHash('md5').update(`${username}:${realm}:${password}`).digest('hex');
    const ha2 = crypto.createHash('md5').update(`POST:${uri}`).digest('hex');

    let response: string;
    let authValue: string;
    const effectiveQop = (qop === 'auth' || qop === 'auth-int') ? qop : '';

    if (effectiveQop) {
      const nc     = '00000001';
      const cnonce = crypto.randomBytes(8).toString('hex');
      response  = crypto.createHash('md5')
        .update(`${ha1}:${nonce}:${nc}:${cnonce}:${effectiveQop}:${ha2}`).digest('hex');
      authValue = `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${uri}", qop=${effectiveQop}, nc=${nc}, cnonce="${cnonce}", response="${response}"${opaque ? `, opaque="${opaque}"` : ''}`;
    } else {
      response  = crypto.createHash('md5').update(`${ha1}:${nonce}:${ha2}`).digest('hex');
      authValue = `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}"${opaque ? `, opaque="${opaque}"` : ''}`;
    }

    const final = await makeReq({ Authorization: authValue });
    return { statusCode: final.statusCode, body: final.body };
  }

  // ── Fallback: Basic auth ───────────────────────────────────────────────────
  const basic = await makeReq({ Authorization: basicAuth(username, password) });
  return { statusCode: basic.statusCode, body: basic.body };
}

function sippyBase(portalUrl: string): string {
  return portalUrl.replace(/\/$/, '');
}

// ── Cookie-aware HTTP helpers (for web portal session mode) ───────────────────

function rawRequest(
  method: 'GET' | 'POST',
  url: string,
  body: string | null,
  extraHeaders: Record<string, string>,
  jar: CookieJar,
  redirectsLeft = 5,
): Promise<{ statusCode: number; body: string; cookies: CookieJar }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const mod = isHttps ? https : http;
    const cookieStr = serializeCookies(jar);

    const baseOpts: http.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port ? parseInt(parsed.port) : (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        ...(cookieStr ? { Cookie: cookieStr } : {}),
        'User-Agent': 'Mozilla/5.0 (compatible; VoIPMonitor/1.0)',
        ...(body != null ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } : {}),
        ...extraHeaders,
      },
      timeout: 15000,
    };
    const opts = isHttps ? { ...baseOpts, agent: lenientHttpsAgent } : baseOpts;

    const req = mod.request(opts as http.RequestOptions, (res) => {
      const sc = res.statusCode ?? 0;
      const setCookies = (res.headers['set-cookie'] as string[] | undefined) || [];
      const newJar = mergeCookies(jar, parseCookies(setCookies));

      if ((sc === 301 || sc === 302 || sc === 303 || sc === 307 || sc === 308) && res.headers.location && redirectsLeft > 0) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        const nextMethod = (sc === 301 || sc === 302 || sc === 303) ? 'GET' : method;
        rawRequest(nextMethod, next, nextMethod === 'GET' ? null : body, extraHeaders, newJar, redirectsLeft - 1).then(resolve).catch(reject);
        return;
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ statusCode: sc, body: data, cookies: newJar }));
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    if (body != null) req.write(body);
    req.end();
  });
}

function encodeForm(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

// ── Web Portal Login & Scraping ───────────────────────────────────────────────

const PORTAL_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0';

async function portalLogin(
  base: string,
  username: string,
  password: string,
  accountType: 'customer' | 'reseller' | 'admin' = 'customer',
): Promise<{ success: boolean; cookies: CookieJar; message: string }> {
  const loginUrl = `${base}/main.php`;
  const formData = encodeForm({
    username,
    password,
    acct_type: accountType,
    login_page: 'all',
    Login: 'Login',
  });

  try {
    const resp = await rawRequest('POST', loginUrl, formData, { 'User-Agent': PORTAL_USER_AGENT }, new Map());
    if (resp.statusCode === 401) {
      return { success: false, cookies: new Map(), message: 'Authentication failed (401).' };
    }
    // Check if we ended up on the login page again (failed login = ShowErrorDialog with message)
    const isLoginPage = resp.body.includes('ShowErrorDialog(') && !resp.body.includes('ShowErrorDialog(\'\')') && !resp.body.includes('ShowErrorDialog("")');
    // Also check if we have a logout link (success) or just a login form
    const hasLogout = resp.body.includes('logout') || resp.body.includes('Logout') || resp.body.includes('My Preferences') || resp.body.includes('my_calls') || resp.body.includes('cdrs_customer');
    if (!hasLogout || isLoginPage) {
      return { success: false, cookies: new Map(), message: `Login rejected — wrong username, password, or account type (${accountType}).` };
    }
    return { success: true, cookies: resp.cookies, message: `Authenticated via web portal as ${accountType}` };
  } catch (err: any) {
    return { success: false, cookies: new Map(), message: err.message ?? 'Portal login failed.' };
  }
}

async function portalGet(path: string, cookies: CookieJar, base: string): Promise<{ html: string; cookies: CookieJar }> {
  const url = `${base}${path}`;
  try {
    const resp = await rawRequest('GET', url, null, { 'User-Agent': PORTAL_USER_AGENT }, cookies);
    return { html: resp.body, cookies: resp.cookies };
  } catch {
    return { html: '', cookies };
  }
}

function scrapeHtmlTable(html: string): string[][] {
  const rows: string[][] = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch;
  while ((trMatch = trRe.exec(html)) !== null) {
    const rowHtml = trMatch[1];
    const tdRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    const cells: string[] = [];
    let tdMatch;
    while ((tdMatch = tdRe.exec(rowHtml)) !== null) {
      const text = tdMatch[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
      cells.push(text);
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

export async function getPortalActiveCallsHtml(cookies: CookieJar, base: string): Promise<SippyActiveCall[]> {
  const { html } = await portalGet('/c2/activecalls.php', cookies, base);
  if (!html) return [];

  const rows = scrapeHtmlTable(html);
  const calls: SippyActiveCall[] = [];
  let headerRow = -1;

  // Find the ACTUAL calls table header — it must have 'caller' AND ('state' OR 'duration')
  // to distinguish from the CLI/CLD filter form rows that only have one keyword
  for (let i = 0; i < rows.length; i++) {
    const lower = rows[i].map(c => c.toLowerCase());
    const hasCaller = lower.some(c => c === 'caller' || c === 'cli');
    const hasDur = lower.some(c => c.includes('duration') || c.includes('state') || c.includes('delay'));
    if (hasCaller && hasDur) {
      headerRow = i;
      break;
    }
  }

  if (headerRow < 0) return calls;

  const headers = rows[headerRow].map(c => c.toLowerCase().trim());
  const colIdx = (names: string[]) => names.map(n => headers.findIndex(h => h === n || h.includes(n))).find(i => i >= 0) ?? -1;
  const callerCol = colIdx(['caller', 'cli', 'from']);
  const calleeCol = colIdx(['cld', 'callee', 'to', 'destination']);
  const stateCol  = colIdx(['state', 'status']);
  const delayCol  = colIdx(['delay', 'pdd']);
  const durCol    = colIdx(['duration', 'dur']);

  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i];
    const joined = row.join('').trim().toLowerCase();
    if (!row.length || joined === '' || joined.includes('list is empty') || joined.startsWith('page ')) continue;
    // Skip rows that look like column headers repeated (pagination-style)
    if (row.some(c => c.toLowerCase() === 'caller' || c.toLowerCase() === 'cli')) continue;

    const get = (idx: number) => (idx >= 0 && idx < row.length) ? row[idx] : '';
    const durStr = get(durCol);
    const durParts = durStr.split(':');
    const durationSec = durParts.length >= 2
      ? (parseInt(durParts[0] || '0') * 60 + parseInt(durParts[1] || '0'))
      : parseInt(durStr || '0') || 0;

    const caller = get(callerCol);
    const callee = get(calleeCol);
    if (!caller && !callee) continue;

    calls.push({
      callId: `portal-${i}`,
      caller: caller || '-',
      callee: callee || '-',
      duration: durationSec,
      codec: '-',
      status: get(stateCol) || 'active',
      delay: parseFloat(get(delayCol)) || 0,
    });
  }
  return calls;
}

export async function getPortalSubcustomers(cookies: CookieJar, base: string): Promise<Array<{ name: string; status: string; description: string; balance: string; creditLimit: string; tariff: string }>> {
  const { html } = await portalGet('/c2/subcustomers.php', cookies, base);
  if (!html) return [];

  const rows = scrapeHtmlTable(html);
  const results: Array<{ name: string; status: string; description: string; balance: string; creditLimit: string; tariff: string }> = [];
  let headerRow = -1;

  for (let i = 0; i < rows.length; i++) {
    const lower = rows[i].map(c => c.toLowerCase());
    if (lower.some(c => c.includes('name') || c.includes('description'))) {
      if (lower.some(c => c.includes('status') || c.includes('balance') || c.includes('tariff'))) {
        headerRow = i;
        break;
      }
    }
  }
  if (headerRow < 0) return results;

  const headers = rows[headerRow].map(c => c.toLowerCase());
  const colIdx = (names: string[]) => names.map(n => headers.findIndex(h => h.includes(n))).find(i => i >= 0) ?? -1;
  const statusCol = colIdx(['status']);
  const nameCol   = colIdx(['name']);
  const descCol   = colIdx(['description', 'descr']);
  const balCol    = colIdx(['balance']);
  const limitCol  = colIdx(['credit', 'limit']);
  const tariffCol = colIdx(['tariff']);

  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row.length || row.join('').trim() === '' || row[0].toLowerCase().includes('list is empty') || row[0].toLowerCase().includes('page')) continue;
    const get = (idx: number) => (idx >= 0 && idx < row.length) ? row[idx] : '';
    if (!get(nameCol)) continue;
    results.push({
      name: get(nameCol),
      status: get(statusCol),
      description: get(descCol),
      balance: get(balCol),
      creditLimit: get(limitCol),
      tariff: get(tariffCol),
    });
  }
  return results;
}

export async function getPortalAccounts(cookies: CookieJar, base: string): Promise<Array<{ id: string; account: string; type: string; balance: string; tariff: string; status: string }>> {
  const { html } = await portalGet('/c2/accounts.php', cookies, base);
  if (!html) return [];

  const rows = scrapeHtmlTable(html);
  const results: Array<{ id: string; account: string; type: string; balance: string; tariff: string; status: string }> = [];
  let headerRow = -1;

  for (let i = 0; i < rows.length; i++) {
    const lower = rows[i].map(c => c.toLowerCase());
    if (lower.some(c => c.includes('account') || c.includes('id'))) {
      headerRow = i;
      break;
    }
  }
  if (headerRow < 0) return results;

  const headers = rows[headerRow].map(c => c.toLowerCase());
  const colIdx = (names: string[]) => names.map(n => headers.findIndex(h => h.includes(n))).find(i => i >= 0) ?? -1;
  const idCol      = colIdx(['id', 'account id']);
  const accountCol = colIdx(['account', 'name', 'login']);
  const typeCol    = colIdx(['type']);
  const balanceCol = colIdx(['balance']);
  const tariffCol  = colIdx(['tariff']);
  const statusCol  = colIdx(['status', 'state']);

  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row.length || row.join('').trim() === '' || row[0].toLowerCase().includes('list is empty') || row[0].toLowerCase().includes('page')) continue;
    const get = (idx: number) => (idx >= 0 && idx < row.length) ? row[idx] : '';
    results.push({
      id: get(idCol),
      account: get(accountCol),
      type: get(typeCol),
      balance: get(balanceCol),
      tariff: get(tariffCol),
      status: get(statusCol),
    });
  }
  return results;
}

// ── XML-RPC builder ───────────────────────────────────────────────────────────

function buildStructMembers(params: Record<string, string | number | boolean | null>): string {
  return Object.entries(params)
    .map(([k, v]) => {
      let valTag: string;
      if (v === null)             valTag = `<nil/>`;
      else if (typeof v === 'boolean') valTag = `<boolean>${v ? 1 : 0}</boolean>`;
      else if (typeof v === 'number')  valTag = Number.isInteger(v) ? `<int>${v}</int>` : `<double>${v}</double>`;
      else valTag = `<string>${String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</string>`;
      return `<member><name>${k}</name><value>${valTag}</value></member>`;
    })
    .join('');
}

// Flat struct: <struct><member>...</member></struct>
function xmlRpcCall(method: string, params: Record<string, string | number | boolean | null> = {}): string {
  const members = buildStructMembers(params);
  return `<?xml version="1.0" encoding="UTF-8"?>
<methodCall>
  <methodName>${method}</methodName>
  <params>
    <param>
      <value>
        <struct>${members}</struct>
      </value>
    </param>
  </params>
</methodCall>`;
}

// Nested struct: wraps all params under a named key, e.g. customer_info or vendor_info
// This is the standard Sippy XML-RPC format for customer.add / vendor.add
function xmlRpcCallNested(method: string, wrapKey: string, params: Record<string, string | number | boolean | null>): string {
  const innerMembers = buildStructMembers(params);
  return `<?xml version="1.0" encoding="UTF-8"?>
<methodCall>
  <methodName>${method}</methodName>
  <params>
    <param>
      <value>
        <struct>
          <member>
            <name>${wrapKey}</name>
            <value><struct>${innerMembers}</struct></value>
          </member>
        </struct>
      </value>
    </param>
  </params>
</methodCall>`;
}

// ── Simple XML value extractor ────────────────────────────────────────────────

function extractTag(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m ? m[1].trim() : null;
}

function extractAllTags(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  const results: string[] = [];
  let m;
  while ((m = re.exec(xml)) !== null) results.push(m[1].trim());
  return results;
}

function extractStructMembers(structXml: string): Record<string, string> {
  const members: Record<string, string> = {};

  // Pre-process: replace <nil/> and <value/> (self-closing nil indicators) with
  // a sentinel empty string BEFORE the main regex runs.
  // Per docs 3000073101: Sippy uses <nil/> (de-facto standard) to represent NULL values.
  // Without this step, self-closing <nil/> breaks the member regex and the key is lost.
  const normalised = structXml
    .replace(/<value>\s*<nil\s*\/>\s*<\/value>/gi, '<value><string></string></value>')
    .replace(/<value\s*\/>/gi, '<value><string></string></value>');

  const memberRe = /<member>\s*<name>([^<]+)<\/name>\s*<value>([^<]*(?:<[^/][^>]*>[^<]*<\/[^>]+>)?[^<]*)<\/value>\s*<\/member>/gi;
  let m;
  while ((m = memberRe.exec(normalised)) !== null) {
    const key = m[1].trim();
    const rawVal = m[2].trim();
    const stripped = rawVal.replace(/<[^>]+>/g, '').trim();
    // '' (empty) is our standard sentinel for NULL — callers use `=== ''` or `=== 'nil'` checks
    members[key] = stripped;
  }
  return members;
}

// ── Connection Test ───────────────────────────────────────────────────────────

export async function testSippyConnection(
  portalUrl: string,
  username: string,
  password: string,
): Promise<{ reachable: boolean; authenticated: boolean; message: string; latencyMs?: number; mode?: 'xmlrpc' | 'portal'; cookies?: CookieJar }> {
  const base = sippyBase(portalUrl);
  const start = Date.now();

  // Try standard XML-RPC path first
  const apiUrl = `${base}/xmlapi/xmlapi`;
  const body = xmlRpcCall('i_version.listAvailableMethods');
  let xmlRpcReachable = false;

  try {
    const resp = await sippyPost(apiUrl, body, username, password);
    const latencyMs = Date.now() - start;
    xmlRpcReachable = true;

    if (resp.statusCode >= 200 && resp.statusCode < 300) {
      return { reachable: true, authenticated: true, message: `Connected to Sippy API successfully (${latencyMs}ms)`, latencyMs, mode: 'xmlrpc' };
    }
    if (resp.statusCode === 403) {
      // Fall through to portal login below
    }
    // 401 or other failure — try web portal login as fallback
  } catch (err: any) {
    const latencyMs = Date.now() - start;
    if (err.code === 'ECONNREFUSED') return { reachable: false, authenticated: false, message: 'Connection refused — verify the URL and port number.', latencyMs };
    if (err.code === 'ENOTFOUND')    return { reachable: false, authenticated: false, message: 'Host not found — check the Portal URL hostname.', latencyMs };
    if (err.code === 'ETIMEDOUT' || err.message?.includes('timed out')) {
      return { reachable: false, authenticated: false, message: 'Connection timed out — the server may be unreachable or blocked by a firewall.', latencyMs };
    }
    if (err.message?.includes('certificate') || err.code === 'CERT_HAS_EXPIRED' || err.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
      return { reachable: false, authenticated: false, message: `SSL certificate error: ${err.message}`, latencyMs };
    }
    xmlRpcReachable = false;
  }

  // ── Fallback: try web portal login ────────────────────────────────────────
  // Try account types in order: customer (RTST1 type), reseller, admin
  for (const acctType of ['customer', 'reseller'] as const) {
    const loginResult = await portalLogin(base, username, password, acctType);
    if (loginResult.success) {
      const latencyMs = Date.now() - start;
      return {
        reachable: true,
        authenticated: true,
        message: `Connected via web portal (${acctType} account) in ${latencyMs}ms. Note: XML-RPC API unavailable — using portal session mode.`,
        latencyMs,
        mode: 'portal',
        cookies: loginResult.cookies,
      };
    }
  }

  const latencyMs = Date.now() - start;
  return {
    reachable: xmlRpcReachable,
    authenticated: false,
    message: xmlRpcReachable
      ? 'Server is reachable but authentication failed for both XML-RPC API and web portal. Check your credentials.'
      : 'Portal is not reachable. Verify the URL is correct.',
    latencyMs,
  };
}

// ── Login (connect and store session) ────────────────────────────────────────

export async function connectSippy(
  portalUrl: string,
  username: string,
  password: string,
): Promise<{ success: boolean; message: string }> {
  const result = await testSippyConnection(portalUrl, username, password);
  if (!result.reachable || !result.authenticated) {
    return { success: false, message: result.message };
  }
  activeSession = {
    portalUrl: sippyBase(portalUrl),
    username,
    connectedAt: new Date(),
    mode: result.mode ?? 'xmlrpc',
    cookies: result.cookies,
  };
  return { success: true, message: result.message };
}

// ── Active Calls ──────────────────────────────────────────────────────────────

export interface SippyActiveCall {
  id?: string;            // ID field — used by disconnectCall() (different from CALL_ID)
  callId: string;         // CALL_ID — SIP Call-ID header
  caller: string;         // CLI (calling number)
  callee: string;         // CLD (destination number)
  duration: number;       // DURATION in seconds
  codec: string;
  status: string;         // CC_STATE: Idle | WaitAuth | WaitRoute | ARComplete | Connected | Disconnecting | Dead
  user?: string;          // account/customer label
  accountId?: string;     // I_ACCOUNT numeric ID
  iCustomer?: string;     // I_CUSTOMER numeric ID
  iEnvironment?: string;  // I_ENVIRONMENT numeric ID
  vendor?: string;
  connection?: string;    // I_CONNECTION numeric ID
  direction?: string;     // DIRECTION
  mediaIpCaller?: string; // CALLER_MEDIA_IP
  mediaIpCallee?: string; // CALLEE_MEDIA_IP
  delay?: number;         // DELAY in seconds (PDD / setup delay)
  setupTime?: string;     // SETUP_TIME timestamp (available since Sippy 2022)
  nodeId?: string;        // NODE_ID (FreightSwitch)
}

export interface SippyActiveCallsFilter {
  order?: 'oldest_first' | 'oldest_last' | 'longest_first' | 'longest_last';
  recursive?: boolean;   // include subcustomer calls (default: true)
  i_account?: number;    // return only calls for this account (Sippy 2020+)
  i_vendor?: number;     // return only calls via this vendor (Sippy 2020+)
  i_connection?: number; // return only calls via this connection (Sippy 2020+, takes precedence over i_vendor)
  node_id?: string;      // return calls for specific node (FreightSwitch)
}

export async function getSippyActiveCalls(
  username: string,
  password: string,
  explicitPortalUrl?: string,
  filter?: SippyActiveCallsFilter,
): Promise<SippyActiveCall[]> {
  const base = explicitPortalUrl ? sippyBase(explicitPortalUrl) : activeSession?.portalUrl;
  if (!base) return [];

  // ── Portal session mode (web scraping fallback) ───────────────────────────
  const session = activeSession;
  if (session?.mode === 'portal' && session.cookies) {
    return getPortalActiveCallsHtml(session.cookies, base);
  }

  // ── XML-RPC mode: official API is listAllCalls() (Sippy docs 107462) ────────
  // Fields returned in UPPERCASE: ID, CALL_ID, CLI, CLD, DELAY, DURATION,
  // CC_STATE, I_ACCOUNT, I_CUSTOMER, I_CONNECTION, I_ENVIRONMENT,
  // CALLER_MEDIA_IP, CALLEE_MEDIA_IP, DIRECTION, NODE_ID, SETUP_TIME (2022+)
  const apiUrl = `${base}/xmlapi/xmlapi`;

  // Build optional filter params (all optional per docs)
  const reqParams: Record<string, string | number | boolean | null> = {};
  if (filter?.order        !== undefined) reqParams.order        = filter.order;
  if (filter?.recursive    !== undefined) reqParams.recursive    = filter.recursive;
  if (filter?.i_account    !== undefined) reqParams.i_account    = filter.i_account;
  if (filter?.i_vendor     !== undefined) reqParams.i_vendor     = filter.i_vendor;
  if (filter?.i_connection !== undefined) reqParams.i_connection = filter.i_connection;
  if (filter?.node_id      !== undefined) reqParams.node_id      = filter.node_id;

  // Official methods: listActiveCalls (Connected/ARComplete/WaitRoute only) | listAllCalls (all states fallback)
  // Prefer listActiveCalls to avoid including Dead/Disconnecting/terminated calls in the live view.
  for (const method of ['listActiveCalls', 'listAllCalls']) {
    try {
      const resp = await sippyPost(apiUrl, xmlRpcCall(method, reqParams), username, password);
      if (resp.statusCode === 401 || resp.statusCode === 403) {
        // Auth failure — try portal scraping
        const loginRes = await portalLogin(base, username, password, 'customer');
        if (loginRes.success) return getPortalActiveCallsHtml(loginRes.cookies, base);
        return [];
      }
      if (resp.statusCode !== 200) continue;

      const structs = extractAllTags(resp.body, 'struct');
      const calls: SippyActiveCall[] = [];

      for (const s of structs) {
        const m = extractStructMembers(s);
        // Official response uses uppercase keys per docs
        const id       = m['ID']        || undefined;                    // for disconnectCall()
        const callId   = m['CALL_ID']   || m['call_id']   || m['CallID'] || '-';
        const cli      = m['CLI']       || m['cli']       || m['from']   || m['caller'];
        const cld      = m['CLD']       || m['cld']       || m['to']     || m['callee'];
        if (!callId && !cli) continue;
        calls.push({
          id,
          callId,
          caller:        cli     || '-',
          callee:        cld     || '-',
          duration:      parseFloat(m['DURATION']        || '0') || 0,
          codec:         m['codec'] || m['media_type']   || '-',
          status:        m['CC_STATE']  || m['status']   || 'active',
          accountId:     m['I_ACCOUNT'] || m['i_account'] || undefined,
          iCustomer:     m['I_CUSTOMER'] || undefined,
          user:          m['username']  || m['account_name'] || undefined,
          vendor:        m['vendor_name'] || undefined,
          connection:    m['I_CONNECTION'] ? String(m['I_CONNECTION']) : undefined,
          direction:     m['DIRECTION'] || undefined,
          mediaIpCaller: m['CALLER_MEDIA_IP'] || undefined,
          mediaIpCallee: m['CALLEE_MEDIA_IP'] || undefined,
          delay:         parseFloat(m['DELAY'] || '0') || 0,
          setupTime:     m['SETUP_TIME'] || undefined,
          iEnvironment:  m['I_ENVIRONMENT'] ? String(m['I_ENVIRONMENT']) : undefined,
          nodeId:        m['NODE_ID'] || undefined,
        });
      }
      return calls;
    } catch {
      continue;
    }
  }
  return [];
}

// ── disconnectCall() — docs 107462 ────────────────────────────────────────────
// Disconnects a single active call by its ID (the ID field from listAllCalls).
// Returns { success, result, message }.
export async function disconnectSippyCall(
  id: string | number,
  username: string,
  password: string,
  explicitPortalUrl?: string,
): Promise<{ success: boolean; result?: string; message: string }> {
  const base = explicitPortalUrl ? sippyBase(explicitPortalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };

  const apiUrl = `${base}/xmlapi/xmlapi`;
  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('disconnectCall', { ID: String(id) }), username, password);
    const text = resp.body;
    console.log(`[Sippy] disconnectCall(${id}) → HTTP ${resp.statusCode}: ${text.slice(0, 300)}`);
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const result = extractTag(text, 'string') || 'OK';
      return { success: true, result, message: `Call ${id} disconnected: ${result}` };
    }
    const fault = extractTag(text, 'faultString');
    return { success: false, message: fault?.replace(/<[^>]+>/g, '').trim() || 'Disconnect failed.' };
  } catch (err: any) {
    return { success: false, message: err.message };
  }
}

// ── disconnectAccount() — docs 107462 (post 1.7.1+) ─────────────────────────
// Disconnects ALL active calls for a given i_account.
// Returns { success, count, message }.
export async function disconnectSippyAccount(
  iAccount: number,
  username: string,
  password: string,
  explicitPortalUrl?: string,
): Promise<{ success: boolean; count?: number; message: string }> {
  const base = explicitPortalUrl ? sippyBase(explicitPortalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };

  const apiUrl = `${base}/xmlapi/xmlapi`;
  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('disconnectAccount', { i_account: iAccount }), username, password);
    const text = resp.body;
    console.log(`[Sippy] disconnectAccount(${iAccount}) → HTTP ${resp.statusCode}: ${text.slice(0, 300)}`);
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const countStr = extractTag(text, 'int') || extractTag(text, 'i4') || '0';
      const count = parseInt(countStr, 10) || 0;
      return { success: true, count, message: `Disconnected ${count} call(s) for account ${iAccount}.` };
    }
    const fault = extractTag(text, 'faultString');
    return { success: false, message: fault?.replace(/<[^>]+>/g, '').trim() || 'Disconnect failed.' };
  } catch (err: any) {
    return { success: false, message: err.message };
  }
}

// ── disconnectCustomer() — docs 107462 (since 5.2) ───────────────────────────
// Disconnects ALL calls of a given customer and all their subcustomers.
// Trusted mode: supply iWholesaler to execute under specific access rights.
export async function disconnectSippyCustomer(
  iCustomer: number,
  username: string,
  password: string,
  opts?: { iWholesaler?: number; portalUrl?: string },
): Promise<{ success: boolean; count?: number; message: string }> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };

  const apiUrl = `${base}/xmlapi/xmlapi`;
  const params: Record<string, number> = { i_customer: iCustomer };
  if (opts?.iWholesaler !== undefined) params.i_wholesaler = opts.iWholesaler;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('disconnectCustomer', params as any), username, password);
    const text = resp.body;
    console.log(`[Sippy] disconnectCustomer(${iCustomer}) → HTTP ${resp.statusCode}: ${text.slice(0, 300)}`);
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const countStr = extractTag(text, 'int') || extractTag(text, 'i4') || '0';
      const count = parseInt(countStr, 10) || 0;
      return { success: true, count, message: `Disconnected ${count} call(s) for customer ${iCustomer}.` };
    }
    const fault = extractTag(text, 'faultString');
    return { success: false, message: fault?.replace(/<[^>]+>/g, '').trim() || 'Disconnect failed.' };
  } catch (err: any) {
    return { success: false, message: err.message };
  }
}

// ── getAccountCallStats() — docs 107462 (2.1+) ───────────────────────────────
// Lightweight API: returns { i_account: [total, connected] } for all accounts.
// Prefer this over listAllCalls() when only a count summary is needed.
export async function getSippyCallStats(
  username: string,
  password: string,
  explicitPortalUrl?: string,
): Promise<{ success: boolean; data?: Record<string, [number, number]>; message: string }> {
  const base = explicitPortalUrl ? sippyBase(explicitPortalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };

  const apiUrl = `${base}/xmlapi/xmlapi`;
  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('getAccountCallStats'), username, password);
    const text = resp.body;
    console.log(`[Sippy] getAccountCallStats → HTTP ${resp.statusCode}: ${text.slice(0, 300)}`);
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      // Response: data is a struct of { i_account: [total, connected] }
      // Parse structs inside the 'data' member
      const structs = extractAllTags(text, 'struct');
      const data: Record<string, [number, number]> = {};
      for (const s of structs) {
        const m = extractStructMembers(s);
        for (const [k, v] of Object.entries(m)) {
          // Values are arrays [total, connected] — parse from the raw XML if possible
          const nums = v.match ? String(v).match(/\d+/g) : null;
          if (nums && nums.length >= 2) data[k] = [parseInt(nums[0]), parseInt(nums[1])];
        }
      }
      return { success: true, data, message: 'OK' };
    }
    const fault = extractTag(text, 'faultString');
    return { success: false, message: fault?.replace(/<[^>]+>/g, '').trim() || 'getAccountCallStats failed.' };
  } catch (err: any) {
    return { success: false, message: err.message };
  }
}

// ── getAccountCallStatsCustomer() — docs 107462 (new in 2024, FreightSwitch) ─
// Same as getAccountCallStats but scoped to a single customer's accounts.
// Trusted mode: supply iCustomer to specify the target customer.
export async function getSippyCallStatsCustomer(
  username: string,
  password: string,
  opts?: { iCustomer?: number; portalUrl?: string },
): Promise<{ success: boolean; data?: Record<string, [number, number]>; message: string }> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };

  const apiUrl = `${base}/xmlapi/xmlapi`;
  const params: Record<string, number> = {};
  if (opts?.iCustomer !== undefined) params.i_customer = opts.iCustomer;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('getAccountCallStatsCustomer', params as any), username, password);
    const text = resp.body;
    console.log(`[Sippy] getAccountCallStatsCustomer → HTTP ${resp.statusCode}: ${text.slice(0, 300)}`);
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const structs = extractAllTags(text, 'struct');
      const data: Record<string, [number, number]> = {};
      for (const s of structs) {
        const m = extractStructMembers(s);
        for (const [k, v] of Object.entries(m)) {
          const nums = v.match ? String(v).match(/\d+/g) : null;
          if (nums && nums.length >= 2) data[k] = [parseInt(nums[0]), parseInt(nums[1])];
        }
      }
      return { success: true, data, message: 'OK' };
    }
    const fault = extractTag(text, 'faultString');
    return { success: false, message: fault?.replace(/<[^>]+>/g, '').trim() || 'getAccountCallStatsCustomer failed.' };
  } catch (err: any) {
    return { success: false, message: err.message };
  }
}

// ── Portal Account / Subcustomer Creation ────────────────────────────────────

/**
 * Create a subcustomer/account via the Sippy web portal form.
 * Used as fallback when XML-RPC API is unavailable (portal mode).
 *
 * Strategy:
 *  1. GET the subcustomers add-page to find the form action & CSRF token.
 *  2. POST the form fields.
 *  3. Detect success/failure from the response HTML.
 */
async function createAccountViaPortal(
  cookies: CookieJar,
  base: string,
  opts: SippyAccountOpts,
): Promise<{ success: boolean; message: string; cookies: CookieJar }> {

  // ── 1. Discover the add-form page ─────────────────────────────────────────
  // Sippy portals expose subcustomer creation at one of these paths:
  const addPaths = [
    '/c2/subcustomers.php?cmd=add',
    '/c2/subcustomers.php?action=add',
    '/c2/customer.php?cmd=add',
    '/c2/accounts.php?cmd=add',
  ];

  let formHtml = '';
  let formCookies = cookies;
  let foundFormPath = '';

  for (const path of addPaths) {
    const { html, cookies: c } = await portalGet(path, cookies, base);
    if (html && (html.toLowerCase().includes('<form') || html.toLowerCase().includes('input'))) {
      formHtml = html;
      formCookies = c;
      foundFormPath = path;
      break;
    }
  }

  // If no dedicated add page, fall back to the main subcustomers page
  if (!formHtml) {
    const { html, cookies: c } = await portalGet('/c2/subcustomers.php', cookies, base);
    formHtml = html;
    formCookies = c;
    foundFormPath = '/c2/subcustomers.php';
  }

  // ── 2. Extract CSRF / form token ──────────────────────────────────────────
  // Sippy uses a hidden input whose name is often 'token', 'csrf_token', or '_token'
  let csrfToken = '';
  const tokenMatch = formHtml.match(/<input[^>]+name=["'](token|csrf_token|_token|form_token)["'][^>]+value=["']([^"']*)["']/i)
                  || formHtml.match(/<input[^>]+value=["']([^"']{8,})["'][^>]+name=["'](token|csrf_token|_token|form_token)["']/i);
  if (tokenMatch) {
    // match[2] if first form, match[1] if second form
    csrfToken = tokenMatch[2] || tokenMatch[1] || '';
  }

  // ── 3. Build form fields ──────────────────────────────────────────────────
  const webPass = opts.name.toLowerCase().replace(/\s+/g, '') + '@Sippy1';
  const webLogin = opts.name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const fields: Record<string, string> = {
    cmd:          'add',
    name:         opts.name,
    web_password: webPass,
    web_login:    webLogin,
    i_tariff:     opts.servicePlan  || '0',
    max_sessions: String(opts.maxSessions  ?? ''),
    credit_limit: String(opts.creditLimit  ?? ''),
    description:  opts.description  || '',
    submit:       'Save',
    ...(csrfToken ? { token: csrfToken } : {}),
  };
  if (opts.type === 'vendor') {
    fields.i_time_zone = '1'; // UTC default
  }

  const postBody = encodeForm(fields);

  // ── 4. POST the form ──────────────────────────────────────────────────────
  // Try each possible form-action path
  const postPaths = [
    foundFormPath.split('?')[0],   // same page without query
    '/c2/subcustomers.php',
    '/c2/customer.php',
  ];

  for (const postPath of [...new Set(postPaths)]) {
    try {
      const postUrl = `${base}${postPath}`;
      const resp = await rawRequest('POST', postUrl, postBody, { 'User-Agent': PORTAL_USER_AGENT }, formCookies);
      const body = resp.body || '';
      console.log(`[Sippy] Portal account create POST ${postUrl} → HTTP ${resp.statusCode}, body snippet: ${body.slice(0, 400)}`);

      const lower = body.toLowerCase();

      // Check for explicit error indicators in the response
      const hasError = lower.includes('class="error"') || lower.includes('class="err"')
                    || lower.includes('required field') || lower.includes('invalid value');
      if (hasError) {
        const errMatch = body.match(/class="err(?:or)?[^"]*"[^>]*>([\s\S]{0,200}?)<\/[^>]+>/i);
        const errMsg = errMatch ? errMatch[1].replace(/<[^>]+>/g, '').trim() : 'Portal returned a validation error.';
        return { success: false, message: errMsg, cookies: resp.cookies };
      }

      // ── VERIFY creation by re-fetching the subcustomers list ─────────────────
      // We CANNOT trust HTTP 200 alone as success — a customer portal that doesn't
      // support subcustomer creation also returns 200 (just shows the dashboard).
      // Instead, check that the account name now appears in the subcustomers list.
      const verifyResp = await rawRequest('GET', `${base}/c2/subcustomers.php`, null, { 'User-Agent': PORTAL_USER_AGENT }, resp.cookies);
      const verifyLower = (verifyResp.body || '').toLowerCase();
      const accountNameLower = opts.name.toLowerCase();

      if (verifyLower.includes(accountNameLower)) {
        console.log(`[Sippy] Portal account create VERIFIED — "${opts.name}" appears in subcustomers list.`);
        return {
          success: true,
          portalSubcustomer: true,
          message: `Sub-account "${opts.name}" created in portal under your connected user. NOTE: This is a portal sub-account only — it does NOT have SIP credentials or appear as a full Sippy system account. To create proper SIP accounts, add Admin API Credentials in Settings.`,
          cookies: resp.cookies,
        };
      }

      // Account not found after POST — this portal/account level does not support creation
      console.warn(`[Sippy] Portal account create: POST returned ${resp.statusCode} but "${opts.name}" NOT found in subcustomers list. Likely insufficient permissions.`);
    } catch (e: any) {
      console.warn(`[Sippy] Portal create POST error (${postPath}):`, e.message);
    }
  }

  return {
    success: false,
    message: 'Portal account creation form not available on this Sippy instance.',
    cookies: formCookies,
  };
}

// ── CDR Records ───────────────────────────────────────────────────────────────

export interface SippyCDR {
  // ── Core identity ────────────────────────────────────────────────────────
  callId: string;           // call_id (Call-ID header)
  iCall?: string;           // i_call — unique call identifier
  iCdr?: string;            // i_cdr — unique CDR identifier (docs 107367)
  iAccount?: number;        // i_account of the account (docs 107367)
  iCustomer?: number;       // i_customer — which customer owns this CDR
  iProtocol?: number;       // i_protocol — signaling protocol used

  // ── Numbers ──────────────────────────────────────────────────────────────
  caller: string;           // cli — CLI after translation
  callee: string;           // cld — CLD after translation
  callerIn?: string;        // cli_in — CLI before translation
  calleeIn?: string;        // cld_in — CLD before translation
  lrnCld?: string;          // lrn_cld — translated LRN CLD
  lrnCldIn?: string;        // lrn_cld_in — incoming LRN CLD
  lrnCldResult?: number;    // lrn_cld_result — LRN lookup result for CLD
  lrnCli?: string;          // lrn_cli — translated LRN CLI
  lrnCliIn?: string;        // lrn_cli_in — incoming LRN CLI before translation
  lrnCliResult?: number;    // lrn_cli_result — LRN lookup result for CLI
  pAssertedId?: string;     // p_asserted_id — P-Asserted-Identity
  remotePartyId?: string;   // remote_party_id — RPID
  prefix?: string;          // prefix — rate prefix used

  // ── Timing ───────────────────────────────────────────────────────────────
  startTime: string;        // setup_time (Sippy format; available from Sippy 2024)
  connectTime?: string;     // connect_time (Sippy format)
  disconnectTime?: string;  // disconnect_time (Sippy format)

  // ── Duration & billing ───────────────────────────────────────────────────
  duration: number;         // billed_duration — billed seconds
  totalDuration?: number;   // duration — actual call duration (Double)
  planDuration?: number;    // plan_duration — seconds covered by minute plan
  freeSeconds?: number;     // free_seconds — free seconds from tariff
  gracePeriod?: number;     // grace_period — grace period from tariff
  interval1?: number;       // interval_1 — tariff interval 1
  intervalN?: number;       // interval_n — tariff interval N
  pdd?: number;             // conn_proc_time — PDD / call setup processing time
  pdd1xx?: number;          // pdd1xx — time to first provisional/final response
  delay?: number;           // delay — total call delay
  mediaTimeoutCorrection?: number; // media_timeout_correction — CDR duration adjustment

  // ── Cost & tariff ────────────────────────────────────────────────────────
  cost: number;             // cost — amount charged in base currency
  connectFee?: number;      // connect_fee — connect fee from tariff
  accessibilityCost?: number; // accessibility_cost — accessibility surcharges
  postCallSurcharge?: number; // post_call_surcharge — post-call surcharge from tariff
  price1?: number;          // price_1 — tariff rate price 1
  priceN?: number;          // price_n — tariff rate price N

  // ── Call metadata ────────────────────────────────────────────────────────
  result: string;           // result — call result / disconnect reason
  country?: string;         // country — dialed country
  areaName?: string;        // area_name — area name of dialed prefix
  description?: string;     // description — destination description
  remoteIp?: string;        // remote_ip — caller's remote IP
  protocol?: string;        // protocol — SIP/IAX2
  userAgent?: string;       // user_agent — User-Agent of caller
  releaseSource?: string;   // release_source — who released the call
  parentLocalICall?: string; // parent_local_i_call — parent leg i_call
}

/**
 * Format a JS Date or ISO string into Sippy's legacy string date format:
 * '%H:%M:%S.000 GMT %a %b %d %Y' (e.g. '09:57:29.000 GMT Wed Mar 18 2026')
 * Docs: 3000073101 — used when sending dates to Sippy XML-RPC API.
 */
export function toSippyDate(d: Date | string): string {
  const dt = typeof d === 'string' ? new Date(d) : d;
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}:${pad(dt.getUTCSeconds())}.000 GMT ${days[dt.getUTCDay()]} ${months[dt.getUTCMonth()]} ${pad(dt.getUTCDate())} ${dt.getUTCFullYear()}`;
}

/**
 * Parse a date string returned by Sippy XML-RPC API into a JS Date (UTC).
 * Docs: 3000073101 — two formats may be returned depending on Sippy version:
 *
 * 1. ISO8601 format (Sippy 2022+): 'YYYYMMDDThh:mm:ss[.SSS]'
 *    e.g. '20260407T09:57:29' or '20260407T09:57:29.123'
 *
 * 2. Legacy string format: 'HH:MM:SS.mmm GMT DayName MonAbbr DD YYYY'
 *    e.g. '09:57:29.000 GMT Tue Apr 07 2026'
 *    (same format produced by toSippyDate())
 *
 * Returns null if the input is empty, 'nil', 'None', or unparseable.
 * All dates are treated as UTC per Sippy API specification.
 */
export function parseSippyDate(raw: string | null | undefined): Date | null {
  if (!raw || raw === 'nil' || raw === 'None' || raw.trim() === '') return null;
  const s = raw.trim();

  // ISO8601 compact format: YYYYMMDDThh:mm:ss[.SSS] — UTC per spec (no timezone suffix)
  const iso8601 = /^(\d{4})(\d{2})(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/.exec(s);
  if (iso8601) {
    const [, year, month, day, hour, min, sec, msRaw] = iso8601;
    const ms = msRaw ? parseInt(msRaw.slice(0, 3).padEnd(3, '0'), 10) : 0;
    const d = new Date(Date.UTC(+year, +month - 1, +day, +hour, +min, +sec, ms));
    return isNaN(d.getTime()) ? null : d;
  }

  // Legacy string format: 'HH:MM:SS.mmm GMT DayName MonAbbr DD YYYY'
  const months: Record<string, number> = {
    Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5,
    Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11,
  };
  const legacy = /^(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?\s+GMT\s+\w+\s+(\w{3})\s+(\d{1,2})\s+(\d{4})$/.exec(s);
  if (legacy) {
    const [, hour, min, sec, msRaw, monStr, day, year] = legacy;
    const mon = months[monStr];
    if (mon === undefined) return null;
    const ms = msRaw ? parseInt(msRaw.slice(0, 3).padEnd(3, '0'), 10) : 0;
    const d = new Date(Date.UTC(+year, mon, +day, +hour, +min, +sec, ms));
    return isNaN(d.getTime()) ? null : d;
  }

  // Fallback: try native Date parser (handles standard ISO strings like '2026-04-07T09:57:29Z')
  const fallback = new Date(s);
  return isNaN(fallback.getTime()) ? null : fallback;
}

// ── getMonitoringGraphData() — docs 107509 ───────────────────────────────────
// Fetches monitoring time-series CSV data from Sippy (available since 2020).
// First CSV column is Unix timestamp; subsequent columns depend on graph type.
// For 'acd_asr_total': columns are timestamp, ACD (seconds), ASR (%).
export async function getSippyMonitoringData(
  username: string,
  password: string,
  type: string,
  opts: { startDate?: string; interval?: number; iEnvironment?: number; explicitPortalUrl?: string } = {},
): Promise<{ ok: boolean; points: Array<{ ts: number; [k: string]: number }>; error?: string }> {
  const base = opts.explicitPortalUrl ? sippyBase(opts.explicitPortalUrl) : activeSession?.portalUrl;
  if (!base) return { ok: false, points: [], error: 'Not connected.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, unknown> = { type };
  if (opts.startDate)    params.start_date    = opts.startDate;
  if (opts.interval)     params.interval      = opts.interval;
  if (opts.iEnvironment) params.i_environment = opts.iEnvironment;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('getMonitoringGraphData', params), username, password);
    const text = resp.body.toString?.() ?? resp.body;
    if (resp.statusCode !== 200 || text.includes('<fault>')) {
      const fault = extractTag(text, 'faultString');
      return { ok: false, points: [], error: fault?.replace(/<[^>]+>/g, '').trim() || 'getMonitoringGraphData failed' };
    }
    // Response contains base64-encoded CSV in <value><string> inside the 'csv_data' member
    const csvDataMatch = text.match(/csv_data[\s\S]*?<string>([\s\S]*?)<\/string>/);
    const b64 = csvDataMatch ? csvDataMatch[1].trim() : extractTag(text, 'string');
    if (!b64) return { ok: false, points: [], error: 'No csv_data in response' };

    const csv = Buffer.from(b64, 'base64').toString('utf8');
    const lines = csv.split('\n').filter(l => l.trim());

    // Proper CSV parser that handles double-quoted fields (which may contain commas)
    function parseCSVLine(line: string): string[] {
      const result: string[] = [];
      let cur = '';
      let inQuote = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
          else inQuote = !inQuote;
        } else if (ch === ',' && !inQuote) {
          result.push(cur.trim());
          cur = '';
        } else {
          cur += ch;
        }
      }
      result.push(cur.trim());
      return result;
    }

    // Detect header: first line is a header if first field is non-numeric
    let headerCols: string[] = [];
    let dataStart = 0;
    if (lines.length > 0 && isNaN(Number(parseCSVLine(lines[0])[0]))) {
      headerCols = parseCSVLine(lines[0]);
      dataStart = 1;
    }
    // Normalise header names: "acd (mins)" → "acd", "asr, authenticated" → "asr"
    const normKey = (raw: string, idx: number): string => {
      const l = raw.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
      if (l.startsWith('acd'))  return 'acd';
      if (l.startsWith('asr'))  return 'asr';
      if (l.includes('calls'))  return 'calls';
      if (l.includes('cps'))    return 'cps';
      return `col${idx}`;
    };
    const keys = headerCols.length > 0
      ? headerCols.map((h, i) => i === 0 ? 'ts' : normKey(h, i))
      : ['ts', 'acd', 'asr'];

    const points = lines.slice(dataStart).map(line => {
      const cols = parseCSVLine(line);
      const ts = parseInt(cols[0], 10) || 0;
      const pt: { ts: number; [k: string]: number } = { ts };
      cols.slice(1).forEach((val, i) => {
        const key = keys[i + 1] ?? `col${i}`;
        const num = parseFloat(val) || 0;
        // Convert ACD from minutes → seconds (Sippy returns minutes for acd_asr type)
        pt[key] = key === 'acd' ? Math.round(num * 60) : num;
      });
      return pt;
    }).filter(p => p.ts > 0);

    return { ok: true, points };
  } catch (err: any) {
    return { ok: false, points: [], error: err.message };
  }
}

// ── getMonitoringGraph() — docs 107509 ────────────────────────────────────────
// Returns a base64-encoded PNG image of the monitoring graph.
// Supports trusted mode (i_environment for root env).
export async function getMonitoringGraph(
  username: string,
  password: string,
  type: string,
  opts: {
    startDate?:    string;
    interval?:     number;
    width?:        number;
    height?:       number;
    timezone?:     string;
    iEnvironment?: number;
    portalUrl?:    string;
  } = {},
): Promise<{ ok: boolean; graph?: string; error?: string }> {
  const base = opts.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { ok: false, error: 'Not connected.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number> = { type };
  if (opts.startDate)    params.start_date    = opts.startDate;
  if (opts.interval)     params.interval      = opts.interval;
  if (opts.width)        params.width         = opts.width;
  if (opts.height)       params.height        = opts.height;
  if (opts.timezone)     params.timezone      = opts.timezone;
  if (opts.iEnvironment) params.i_environment = opts.iEnvironment;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('getMonitoringGraph', params as any), username, password);
    const text = resp.body.toString?.() ?? resp.body;
    if (resp.statusCode !== 200 || text.includes('<fault>')) {
      const fault = extractTag(text, 'faultString');
      return { ok: false, error: fault?.replace(/<[^>]+>/g, '').trim() || 'getMonitoringGraph failed' };
    }
    // Response: base64 PNG in 'graph' struct member
    const graphMatch = text.match(/graph[\s\S]*?<string>([\s\S]*?)<\/string>/);
    const b64 = graphMatch ? graphMatch[1].trim() : extractTag(text, 'string');
    if (!b64) return { ok: false, error: 'No graph data in response' };
    return { ok: true, graph: b64 };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// getSippyCDRs — uses official getAccountCDRs() (docs 107367) or
//               getCustomerCDRs() (docs 107429) with documented field names.
// CDR response fields: call_id, cli, cld, connect_time, billed_duration,
//   cost, country, description, remote_ip, result, disconnect_time, duration
//
// Trusted-mode notes (per docs):
//   getCustomerCDRs — trusted mode uses i_wholesaler (docs 107429)
//   getAccountCDRs  — trusted mode uses i_customer   (docs 107367)
export async function getSippyCDRs(
  username: string,
  password: string,
  limit = 50,
  opts: {
    iAccount?: number;
    iCustomer?: number;      // i_customer filter: which customer's CDRs to fetch
    iWholesaler?: number;    // trusted mode for getCustomerCDRs (docs 107429); defaults to 1
    iCdrsCustomer?: string;  // fetch only one CDR by i_cdrs_customer (docs 107429)
    iCdr?: string;           // fetch only one CDR by i_cdr (docs 107367, getAccountCDRs)
    startDate?: string;      // ISO or Sippy format; auto-converted to Sippy format
    endDate?: string;        // ISO or Sippy format; auto-converted to Sippy format
    type?: string;           // 'all' | 'non_zero' | 'non_zero_and_errors' | 'complete' | 'incomplete' | 'errors'
    cli?: string;            // filter by CLI (after translation)
    cld?: string;            // filter by CLD (after translation)
    offset?: number;
  } = {},
): Promise<SippyCDR[]> {
  if (!activeSession) return [];
  const apiUrl = `${activeSession.portalUrl}/xmlapi/xmlapi`;

  // Convert ISO dates to Sippy format if needed (Sippy requires '%H:%M:%S.000 GMT %a %b %d %Y')
  const formatDate = (d?: string) => {
    if (!d) return undefined;
    if (d.includes('GMT')) return d;
    try { return toSippyDate(d); } catch { return d; }
  };

  // Base params shared by both methods
  const baseParams: Record<string, unknown> = {
    limit,
    type: opts.type || 'all',
  };
  if (opts.iAccount)              baseParams.i_account        = opts.iAccount;
  if (opts.iCustomer)             baseParams.i_customer       = opts.iCustomer;
  if (opts.iCdrsCustomer)         baseParams.i_cdrs_customer  = opts.iCdrsCustomer;
  if (opts.iCdr)                  baseParams.i_cdr            = opts.iCdr;
  const fmtStart = formatDate(opts.startDate);
  const fmtEnd   = formatDate(opts.endDate);
  if (fmtStart)                   baseParams.start_date       = fmtStart;
  if (fmtEnd)                     baseParams.end_date         = fmtEnd;
  if (opts.cli)                   baseParams.cli              = opts.cli;
  if (opts.cld)                   baseParams.cld              = opts.cld;
  if (opts.offset !== undefined)  baseParams.offset           = opts.offset;

  // Official methods: getAccountCDRs() (docs 107367) / getCustomerCDRs() (docs 107429)
  // Use getAccountCDRs first for account-scoped CDRs; getCustomerCDRs for customer-level.
  // Each method has a different trusted-mode field:
  //   getCustomerCDRs → i_wholesaler (defaults to 1 for root access)
  //   getAccountCDRs  → i_customer   (defaults to 1 for root access)
  const methods = opts.iAccount
    ? ['getAccountCDRs', 'getCustomerCDRs']
    : ['getCustomerCDRs', 'getAccountCDRs'];

  for (const method of methods) {
    try {
      // Set the correct trusted-mode field per method
      const params: Record<string, unknown> = { ...baseParams };
      if (method === 'getCustomerCDRs') {
        params.i_wholesaler = opts.iWholesaler ?? 1;
      } else {
        // getAccountCDRs trusted mode: i_customer=1 (only set if caller hasn't overridden it)
        if (!params.i_customer) params.i_customer = 1;
      }

      const resp = await sippyPost(apiUrl, xmlRpcCall(method, params), username, password);
      if (resp.statusCode !== 200) continue;
      const text = resp.body.toString?.() ?? resp.body;
      if (text.includes('faultCode')) continue;

      const structs = extractAllTags(text, 'struct');
      const cdrs: SippyCDR[] = [];
      for (const s of structs) {
        const m = extractStructMembers(s);
        if (!m['call_id'] && !m['i_call'] && !m['cli']) continue;
        const nf = (k: string) => m[k] ? parseFloat(m[k]) : undefined;
        const ni = (k: string) => m[k] ? parseInt(m[k], 10) : undefined;
        const ns = (k: string) => m[k] || undefined;
        cdrs.push({
          // Core identity
          callId:                   m['call_id']          || m['i_call'] || '-',
          iCall:                    ns('i_call'),
          iCdr:                     ns('i_cdr'),
          iAccount:                 ni('i_account'),
          iCustomer:                ni('i_customer'),
          iProtocol:                ni('i_protocol'),
          // Numbers
          caller:                   m['cli']              || m['cli_in'] || '-',
          callee:                   m['cld']              || m['cld_in'] || '-',
          callerIn:                 ns('cli_in'),
          calleeIn:                 ns('cld_in'),
          lrnCld:                   ns('lrn_cld'),
          lrnCldIn:                 ns('lrn_cld_in'),
          lrnCldResult:             ni('lrn_cld_result'),
          lrnCli:                   ns('lrn_cli'),
          lrnCliIn:                 ns('lrn_cli_in'),
          lrnCliResult:             ni('lrn_cli_result'),
          pAssertedId:              ns('p_asserted_id'),
          remotePartyId:            ns('remote_party_id'),
          prefix:                   ns('prefix'),
          // Timing
          startTime:                m['setup_time']       || m['connect_time'] || '',
          connectTime:              ns('connect_time'),
          disconnectTime:           ns('disconnect_time'),
          // Duration & billing
          duration:                 parseFloat(m['billed_duration'] || '0') || 0,
          totalDuration:            nf('duration'),
          planDuration:             ni('plan_duration'),
          freeSeconds:              ni('free_seconds'),
          gracePeriod:              ni('grace_period'),
          interval1:                ni('interval_1'),
          intervalN:                ni('interval_n'),
          pdd:                      nf('conn_proc_time'),
          pdd1xx:                   nf('pdd1xx'),
          delay:                    nf('delay'),
          mediaTimeoutCorrection:   nf('media_timeout_correction'),
          // Cost & tariff
          cost:                     parseFloat(m['cost'] || '0') || 0,
          connectFee:               nf('connect_fee'),
          accessibilityCost:        nf('accessibility_cost'),
          postCallSurcharge:        nf('post_call_surcharge'),
          price1:                   nf('price_1'),
          priceN:                   nf('price_n'),
          // Call metadata
          result:                   m['result']           || m['disconnect_reason'] || '',
          country:                  ns('country'),
          areaName:                 ns('area_name'),
          description:              ns('description'),
          remoteIp:                 ns('remote_ip'),
          protocol:                 ns('protocol'),
          userAgent:                ns('user_agent'),
          releaseSource:            ns('release_source'),
          parentLocalICall:         ns('parent_local_i_call'),
        });
      }
      return cdrs;
    } catch { continue; }
  }
  return [];
}

// ── exportVendorsCDRs_Mera() (docs 107436) ───────────────────────────────────

export interface SippyMeraCDR {
  raw:              string;          // original Mera-format string from Sippy
  host?:            string;          // HOST — switch IP
  confId?:          string;          // CONFID — calls.call_id
  callId?:          string;          // CALLID — i_cdrs_connection
  iCall?:           string;          // I_CALL — cdrs_connections.i_call (since Sippy 2022)
  cost?:            string;          // COST — cdrs_connections.cost (since Sippy 2022)
  srcIp?:           string;          // SRC-IP — cdrs.remote_ip
  dstIp?:           string;          // DST-IP — connections.destination
  srcName?:         string;          // SRC-NAME — accounts.username
  dstName?:         string;          // DST-NAME — vendors.name
  srcNumberIn?:     string;          // SRC-NUMBER-IN — cdrs.cli_in
  srcNumberBill?:   string;          // SRC-NUMBER-BILL — calls.cli
  srcNumberOut?:    string;          // SRC-NUMBER-OUT — cdrs_connections.cli_out
  dstNumberIn?:     string;          // DST-NUMBER-IN — cdrs.cld_in
  dstNumberBill?:   string;          // DST-NUMBER-BILL — calls.cld
  dstNumberOut?:    string;          // DST-NUMBER-OUT — cdrs_connections.cld_out
  setupTime?:       string;          // SETUP-TIME — cdrs_connections.setup_time
  connectTime?:     string;          // CONNECT-TIME — cdrs_connections.connect_time
  disconnectTime?:  string;          // DISCONNECT-TIME — cdrs_connections.disconnect_time
  elapsedTime?:     string;          // ELAPSED-TIME — duration in seconds
  disconnectCodeQ931?: string;       // DISCONNECT-CODE-Q931 — H.323 disconnect cause
}

/** Parse a single Mera-format CDR string into a structured object. */
function parseMeraCDRString(raw: string): SippyMeraCDR {
  const kv: Record<string, string> = {};
  for (const pair of raw.split(',')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    kv[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return {
    raw,
    host:              kv['HOST'],
    confId:            kv['CONFID'],
    callId:            kv['CALLID'],
    iCall:             kv['I_CALL'],
    cost:              kv['COST'],
    srcIp:             kv['SRC-IP'],
    dstIp:             kv['DST-IP'],
    srcName:           kv['SRC-NAME'],
    dstName:           kv['DST-NAME'],
    srcNumberIn:       kv['SRC-NUMBER-IN'],
    srcNumberBill:     kv['SRC-NUMBER-BILL'],
    srcNumberOut:      kv['SRC-NUMBER-OUT'],
    dstNumberIn:       kv['DST-NUMBER-IN'],
    dstNumberBill:     kv['DST-NUMBER-BILL'],
    dstNumberOut:      kv['DST-NUMBER-OUT'],
    setupTime:         kv['SETUP-TIME'],
    connectTime:       kv['CONNECT-TIME'],
    disconnectTime:    kv['DISCONNECT-TIME'],
    elapsedTime:       kv['ELAPSED-TIME'],
    disconnectCodeQ931: kv['DISCONNECT-CODE-Q931'],
  };
}

/**
 * Export all vendor CDRs in Mera format for external billing.
 * Official method: exportVendorsCDRs_Mera() — docs 107436
 * Available since Sippy 5.0. start_date defaults to 1 hour ago, end_date to now (since Sippy 2020).
 * Supports sequential pagination via start_i_cdrs_connection / end_i_cdrs_connection.
 */
export async function exportVendorsCDRsMera(
  username: string,
  password: string,
  opts: {
    startDate?:            string;   // Sippy format: '%H:%M:%S.000 GMT %a %b %d %Y'
    endDate?:              string;   // Sippy format
    startICdrsConnection?: string;   // fetch CDRs where i_cdrs_connection >= this value
    endICdrsConnection?:   string;   // fetch CDRs where i_cdrs_connection < this value
    trustedMode?:          boolean;  // pass i_customer=1 for root access
    portalUrl?:            string;
  } = {},
): Promise<{ success: boolean; lastICdrsConnection?: string; cdrs: SippyMeraCDR[]; message: string }> {
  const base = opts.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, cdrs: [], message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number | boolean | null> = {};
  if (opts.startDate)            params.start_date             = opts.startDate;
  if (opts.endDate)              params.end_date               = opts.endDate;
  if (opts.startICdrsConnection) params.start_i_cdrs_connection = opts.startICdrsConnection;
  if (opts.endICdrsConnection)   params.end_i_cdrs_connection   = opts.endICdrsConnection;
  if (opts.trustedMode !== false) params.i_customer             = 1;  // trusted mode by default

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('exportVendorsCDRs_Mera', params), username, password);
    const text = resp.body;
    console.log(`[Sippy] exportVendorsCDRs_Mera → HTTP ${resp.statusCode}: ${text.slice(0, 200)}`);

    if (resp.statusCode === 200 && !text.includes('<fault>') && !text.includes('faultCode')) {
      // Extract last_i_cdrs_connection (plain string or int value)
      const lastConn = extractValue(text, 'last_i_cdrs_connection');

      // Extract cdrs array of strings
      // Shape: <name>cdrs</name><value><array><data><value><string>...</string></value>...</data></array></value>
      const cdrsMatch = /<name>cdrs<\/name>\s*<value>\s*<array>\s*<data>([\s\S]*?)<\/data>\s*<\/array>\s*<\/value>/.exec(text);
      const meras: SippyMeraCDR[] = [];
      if (cdrsMatch) {
        const stringRe = /<value>\s*<string>([\s\S]*?)<\/string>\s*<\/value>/gi;
        let m;
        while ((m = stringRe.exec(cdrsMatch[1])) !== null) {
          const raw = m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
          if (raw) meras.push(parseMeraCDRString(raw));
        }
      }

      return {
        success: true,
        lastICdrsConnection: lastConn || undefined,
        cdrs: meras,
        message: `OK — ${meras.length} CDR(s) returned.`,
      };
    }

    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'exportVendorsCDRs_Mera failed.';
    return { success: false, cdrs: [], message: fault };
  } catch (e: any) {
    return { success: false, cdrs: [], message: e.message };
  }
}

// ── getCDRSDP() (docs 3000039695) ────────────────────────────────────────────

/** One SDP record linked to a call (either caller-side or callee-side). */
export interface SippyCDRSDPRecord {
  timeStamp?: string;         // time_stamp — record timestamp in Sippy format
  iCallsSdp?: number;         // i_calls_sdp — set when SDP relates to the Caller
  iCdrsConnection?: number;   // i_cdrs_connection — set when SDP relates to the Callee
  sipMsgType?: string;        // sip_msg_type — INVITE, 183, 200, etc.
  sdp: string;                // sdp — multiline SDP body
}

/**
 * getCDRSDP() — retrieve SDP messages exchanged during a call (docs 3000039695).
 *
 * Supports trusted mode: supply iCustomer to fetch CDRs owned by that customer.
 *
 * @param username  XML-RPC admin username
 * @param password  XML-RPC admin password
 * @param iCall     Unique i_call value of the call (required)
 * @param iCustomer Customer ID for trusted-mode access (optional)
 * @returns Array of SDP records plus the resolved i_customer
 */
export async function getCDRSDP(
  username: string,
  password: string,
  iCall: number,
  iCustomer?: number,
): Promise<{ records: SippyCDRSDPRecord[]; iCustomer?: number }> {
  if (!activeSession) return { records: [] };
  const apiUrl = `${activeSession.portalUrl}/xmlapi/xmlapi`;

  const params: Record<string, string | number | boolean | null> = { i_call: iCall };
  if (iCustomer !== undefined) params.i_customer = iCustomer;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('getCDRSDP', params), username, password);
    const text = resp.body.toString?.() ?? resp.body;
    if (resp.statusCode !== 200 || text.includes('faultCode')) {
      const fault = extractTag(text, 'faultString') ?? 'getCDRSDP failed.';
      throw new Error(fault);
    }

    // Top-level i_customer from response (outside the records array)
    const topStruct = extractAllTags(text, 'struct')[0] ?? '';
    const topFields = extractStructMembers(topStruct);
    const respICustomer = topFields['i_customer'] ? parseInt(topFields['i_customer'], 10) : undefined;

    // Parse the nested <name>records</name><value><array><data>...</data></array></value>
    const arrMatch = text.match(/<name>records<\/name>\s*<value>\s*<array>\s*<data>([\s\S]*?)<\/data>/i);
    if (!arrMatch) return { records: [], iCustomer: respICustomer };

    const innerStructs = extractAllTags(arrMatch[1], 'struct');
    const records: SippyCDRSDPRecord[] = innerStructs.map(s => {
      const m = extractStructMembers(s);
      return {
        timeStamp:       m['time_stamp']       || undefined,
        iCallsSdp:       m['i_calls_sdp']      ? parseInt(m['i_calls_sdp'],     10) : undefined,
        iCdrsConnection: m['i_cdrs_connection'] ? parseInt(m['i_cdrs_connection'], 10) : undefined,
        sipMsgType:      m['sip_msg_type']     || undefined,
        sdp:             m['sdp']              || '',
      };
    });

    return { records, iCustomer: respICustomer };
  } catch (e: any) {
    throw new Error(`getCDRSDP: ${e.message}`);
  }
}

// ── Binary Upload (docs 3000073010 / 3000073011 / 3000073012) ────────────────

/**
 * Possible status values returned by getUploadStatus().
 * Lifecycle: INIT_TOKEN → FILE_UPLOADED → PROCESSING → DONE | FAIL
 * (status only advances once the file has been uploaded)
 */
export type SippyUploadStatus =
  | 'INIT_TOKEN'
  | 'FILE_UPLOADED'
  | 'PROCESSING'
  | 'FAIL'
  | 'DONE';

/** Response from getUploadToken() — docs 3000073011 */
export interface SippyUploadTokenResult {
  token: string;    // unique token identifying this upload
  url: string;      // unique URL to POST the binary file to
}

/** Response from getUploadStatus() — docs 3000073012 */
export interface SippyUploadStatusResult {
  status: SippyUploadStatus;  // current processing state
  processOn?: string;         // process_on — when processing starts (Sippy/ISO format)
  expiresOn?: string;         // expires_on — when the upload URL/task expires
  statusChangedOn?: string;   // status_changed_on — when status last changed
  reportUrl?: string;         // url — report download URL (only when DONE/FAIL)
}

/**
 * Builds the XML body for getUploadToken(), which requires a nested struct
 * inside the `params` member — something buildStructMembers() cannot produce.
 *
 * upload_type values (from getDictionary('upload_types')):
 *   typically 1 = Rates (Tariff), 2 = Routes (Destination Set)
 *
 * @param iUploadType   Integer upload type (mandatory)
 * @param processOn     ISO8601 UTC datetime: when to start processing (optional)
 * @param expiresOn     ISO8601 UTC datetime: when the upload URL expires (optional)
 * @param uploadParams  Nested struct — { i_tariff: N } for rates, { i_destination_set: N } for routes
 * @param iCustomer     Customer ID for trusted-mode access (optional)
 */
function buildGetUploadTokenXml(
  iUploadType: number,
  processOn?: string,
  expiresOn?: string,
  uploadParams?: Record<string, number>,
  iCustomer?: number,
): string {
  let members = `<member><name>i_upload_type</name><value><int>${iUploadType}</int></value></member>`;

  if (processOn)  members += `<member><name>process_on</name><value><dateTime.iso8601>${processOn}</dateTime.iso8601></value></member>`;
  if (expiresOn)  members += `<member><name>expires_on</name><value><dateTime.iso8601>${expiresOn}</dateTime.iso8601></value></member>`;

  if (uploadParams && Object.keys(uploadParams).length > 0) {
    const innerMembers = Object.entries(uploadParams)
      .map(([k, v]) => `<member><name>${k}</name><value><int>${v}</int></value></member>`)
      .join('');
    members += `<member><name>params</name><value><struct>${innerMembers}</struct></value></member>`;
  }

  if (iCustomer !== undefined) {
    members += `<member><name>i_customer</name><value><int>${iCustomer}</int></value></member>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?><methodCall><methodName>getUploadToken</methodName><params><param><value><struct>${members}</struct></value></param></params></methodCall>`;
}

/**
 * getUploadToken() — initiate a new binary bulk upload (docs 3000073011).
 *
 * Returns an upload token and a unique URL.  The caller must then POST the
 * binary file to that URL using chunked transfer encoding (see `uploadBinaryFile`).
 *
 * @param username      XML-RPC admin username
 * @param password      XML-RPC admin password
 * @param iUploadType   Upload type integer (1 = Rates/Tariff, 2 = Routes/Destination Set; see getDictionary('upload_types'))
 * @param processOn     ISO8601 UTC datetime when processing should start (optional, default: now)
 * @param expiresOn     ISO8601 UTC datetime until which the upload URL is valid (optional, default: now + 1 day)
 * @param uploadParams  Nested params struct: `{ i_tariff: N }` for rates or `{ i_destination_set: N }` for routes
 * @param iCustomer     Customer ID for trusted-mode access (optional)
 */
export async function getUploadToken(
  username: string,
  password: string,
  iUploadType: number,
  processOn?: string,
  expiresOn?: string,
  uploadParams?: Record<string, number>,
  iCustomer?: number,
): Promise<SippyUploadTokenResult> {
  if (!activeSession) throw new Error('No active Sippy session');
  const apiUrl = `${activeSession.portalUrl}/xmlapi/xmlapi`;

  // Normalise dates to Sippy's compact ISO8601 format (YYYYMMDDThh:mm:ss).
  // If the string already matches Sippy format (8 digits + T + hh:mm:ss), leave it alone.
  // Otherwise convert from any Date-parseable string (e.g. 2024-01-15T14:30:00Z).
  const sippyIso8601Re = /^\d{8}T\d{2}:\d{2}:\d{2}$/;
  const toIso = (d?: string) => {
    if (!d) return undefined;
    if (sippyIso8601Re.test(d)) return d;
    try { return toSippyIso8601(d); } catch { return d; }
  };

  const xmlBody = buildGetUploadTokenXml(iUploadType, toIso(processOn), toIso(expiresOn), uploadParams, iCustomer);
  const resp = await sippyPost(apiUrl, xmlBody, username, password);
  const text = resp.body.toString?.() ?? resp.body;

  if (resp.statusCode !== 200 || text.includes('faultCode')) {
    const fault = extractTag(text, 'faultString') ?? 'getUploadToken failed.';
    throw new Error(fault);
  }

  const s = extractAllTags(text, 'struct')[0] ?? '';
  const m = extractStructMembers(s);

  const token = m['token'];
  const url   = m['url'];
  if (!token || !url) throw new Error('getUploadToken: missing token or url in response');

  return { token, url };
}

/**
 * getUploadStatus() — poll the processing state of a bulk upload (docs 3000073012).
 *
 * Status lifecycle: INIT_TOKEN → FILE_UPLOADED → PROCESSING → DONE | FAIL
 * `reportUrl` is only present when status is DONE or FAIL.
 *
 * @param username  XML-RPC admin username
 * @param password  XML-RPC admin password
 * @param token     Token returned by getUploadToken()
 * @param iCustomer Customer ID for trusted-mode access (optional)
 */
export async function getUploadStatus(
  username: string,
  password: string,
  token: string,
  iCustomer?: number,
): Promise<SippyUploadStatusResult> {
  if (!activeSession) throw new Error('No active Sippy session');
  const apiUrl = `${activeSession.portalUrl}/xmlapi/xmlapi`;

  const params: Record<string, string | number | boolean | null> = { token };
  if (iCustomer !== undefined) params.i_customer = iCustomer;

  const resp = await sippyPost(apiUrl, xmlRpcCall('getUploadStatus', params), username, password);
  const text = resp.body.toString?.() ?? resp.body;

  if (resp.statusCode !== 200 || text.includes('faultCode')) {
    const fault = extractTag(text, 'faultString') ?? 'getUploadStatus failed.';
    throw new Error(fault);
  }

  const s = extractAllTags(text, 'struct')[0] ?? '';
  const mm = extractStructMembers(s);

  return {
    status:          (mm['status'] || 'INIT_TOKEN') as SippyUploadStatus,
    processOn:       mm['process_on']        || undefined,
    expiresOn:       mm['expires_on']        || undefined,
    statusChangedOn: mm['status_changed_on'] || undefined,
    reportUrl:       mm['url']               || undefined,
  };
}

/**
 * uploadBinaryFile() — POST a binary buffer to a Sippy upload URL using
 * chunked transfer encoding (as required by docs 3000073010).
 *
 * Used server-side to forward a file received from the browser to Sippy.
 *
 * @param uploadUrl  URL returned by getUploadToken()
 * @param data       File contents as a Buffer
 * @param filename   Original filename (sent as Content-Disposition)
 */
export async function uploadBinaryFile(
  uploadUrl: string,
  data: Buffer,
  filename = 'upload.csv',
): Promise<{ success: boolean; body: string }> {
  return new Promise((resolve) => {
    const url   = new URL(uploadUrl);
    const proto = url.protocol === 'https:' ? https : http;

    const options = {
      hostname:            url.hostname,
      port:                url.port || (url.protocol === 'https:' ? 443 : 80),
      path:                url.pathname + url.search,
      method:              'POST',
      rejectUnauthorized:  false,   // Sippy uses self-signed certs
      headers: {
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Type':        'application/octet-stream',
        'Transfer-Encoding':   'chunked',
      },
    };

    const req = proto.request(options, (incoming: any) => {
      let body = '';
      incoming.on('data', (chunk: any) => { body += chunk.toString(); });
      incoming.on('end', () => {
        resolve({ success: incoming.statusCode < 400, body });
      });
    });

    req.on('error', (err: any) => resolve({ success: false, body: err.message }));
    req.write(data);
    req.end();
  });
}

// ── SSL Certificates (docs 3000108832) ───────────────────────────────────────

/**
 * SSL certificate record returned by getSSLCertificateInfo() and getSSLCertificatesList().
 * The doc does not enumerate every field — known fields are typed; extras land in `extra`.
 */
export interface SippySSLCertificate {
  iSslCertificate: number;       // i_ssl_certificate — unique certificate ID
  name?: string;                 // name — human-readable certificate name
  commonName?: string;           // common_name — CN field of the certificate
  iSslCertificateType?: number;  // i_ssl_certificate_type — cert type (Upload Own / Let's Encrypt)
  iSslUseDomainType?: number;    // i_ssl_use_domain_type — domain type (Web/HTTPS, etc.) [since 2023]
  altDnsNames?: string[];        // alt_dns_names — Subject Alternative Names
  certificate?: string;          // certificate — base64-encoded PEM certificate
  iEnvironment?: number;         // i_environment — environment the certificate belongs to
  expiryDate?: string;           // expiry_date — certificate expiry (Sippy date format)
  status?: string;               // status — current certificate status string
  extra: Record<string, string>; // any additional fields returned by Sippy
}

/**
 * relay_result struct returned when the operation is relayed to another environment.
 * Captured as a raw key-value map since Sippy does not document its internal fields.
 */
export type SippyRelayResult = Record<string, string>;

/**
 * Builds the XML `<struct>` members string for create/update SSL certificate calls.
 * Handles the `alt_dns_names` array field that `buildStructMembers()` cannot produce.
 */
function buildSSLCertMembers(p: {
  name?: string;
  commonName?: string;
  iSslCertificate?: number;
  iSslCertificateType?: number;
  iSslUseDomainType?: number;
  altDnsNames?: string[];
  certificate?: string;
  key?: string;
  iEnvironment?: number;
  iCustomer?: number;
}): string {
  let m = '';
  const str  = (k: string, v: string)  => { m += `<member><name>${k}</name><value><string>${v.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</string></value></member>`; };
  const int  = (k: string, v: number)  => { m += `<member><name>${k}</name><value><int>${v}</int></value></member>`; };

  if (p.iSslCertificate    !== undefined) int('i_ssl_certificate',      p.iSslCertificate);
  if (p.name               !== undefined) str('name',                   p.name);
  if (p.commonName         !== undefined) str('common_name',            p.commonName);
  if (p.iSslCertificateType !== undefined) int('i_ssl_certificate_type', p.iSslCertificateType);
  if (p.iSslUseDomainType  !== undefined) int('i_ssl_use_domain_type',  p.iSslUseDomainType);
  if (p.certificate        !== undefined) str('certificate',            p.certificate);
  if (p.key                !== undefined) str('key',                    p.key);
  if (p.iEnvironment       !== undefined) int('i_environment',          p.iEnvironment);
  if (p.iCustomer          !== undefined) int('i_customer',             p.iCustomer);

  // alt_dns_names — array of strings; must be built manually
  if (p.altDnsNames && p.altDnsNames.length > 0) {
    const items = p.altDnsNames
      .map(n => `<value><string>${n.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</string></value>`)
      .join('');
    m += `<member><name>alt_dns_names</name><value><array><data>${items}</data></array></value></member>`;
  }

  return m;
}

/** Wraps a members string into a full XML-RPC method call body. */
function xmlRpcCallFromMembers(method: string, members: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><methodCall><methodName>${method}</methodName><params><param><value><struct>${members}</struct></value></param></params></methodCall>`;
}

/** Parses a single `ssl_certificate` struct out of the raw XML response. */
function parseSSLCertStruct(s: string): SippySSLCertificate {
  const m = extractStructMembers(s);
  const known = new Set(['i_ssl_certificate','name','common_name','i_ssl_certificate_type',
    'i_ssl_use_domain_type','certificate','i_environment','expiry_date','status']);
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(m)) {
    if (!known.has(k)) extra[k] = v;
  }

  // alt_dns_names is a nested array — extract with array regex
  const altMatch = s.match(/<name>alt_dns_names<\/name>\s*<value>\s*<array>\s*<data>([\s\S]*?)<\/data>/i);
  const altDnsNames: string[] = [];
  if (altMatch) {
    const strRe = /<value>\s*(?:<string>)?(.*?)(?:<\/string>)?\s*<\/value>/gi;
    let hit: RegExpExecArray | null;
    while ((hit = strRe.exec(altMatch[1])) !== null) {
      if (hit[1].trim()) altDnsNames.push(hit[1].trim());
    }
  }

  return {
    iSslCertificate:      m['i_ssl_certificate']       ? parseInt(m['i_ssl_certificate'], 10) : 0,
    name:                 m['name']                    || undefined,
    commonName:           m['common_name']             || undefined,
    iSslCertificateType:  m['i_ssl_certificate_type']  ? parseInt(m['i_ssl_certificate_type'], 10) : undefined,
    iSslUseDomainType:    m['i_ssl_use_domain_type']   ? parseInt(m['i_ssl_use_domain_type'], 10)  : undefined,
    altDnsNames:          altDnsNames.length ? altDnsNames : undefined,
    certificate:          m['certificate']             || undefined,
    iEnvironment:         m['i_environment']           ? parseInt(m['i_environment'], 10)          : undefined,
    expiryDate:           m['expiry_date']             || undefined,
    status:               m['status']                  || undefined,
    extra,
  };
}

/** Extracts the optional relay_result struct (present only for cross-environment ops). */
function parseRelayResult(text: string): SippyRelayResult | undefined {
  const relayMatch = text.match(/<name>relay_result<\/name>\s*<value>\s*<struct>([\s\S]*?)<\/struct>/i);
  if (!relayMatch) return undefined;
  return extractStructMembers(relayMatch[1]);
}

/** Shared error / fault check helper — throws if Sippy returned a fault. */
function assertSippyOk(text: string, method: string): void {
  if (text.includes('faultCode')) {
    const fault = extractTag(text, 'faultString') ?? `${method} failed.`;
    throw new Error(fault);
  }
}

// ── createSSLCertificate() ────────────────────────────────────────────────────

export interface CreateSSLCertificateOpts {
  name: string;                    // Mandatory
  commonName: string;              // Mandatory
  iSslCertificateType?: number;    // Optional — see getDictionary('ssl_certificate_types')
  iSslUseDomainType?: number;      // Optional — see getDictionary('ssl_use_domain_types') [2023+]
  altDnsNames?: string[];          // Optional — Subject Alternative Names
  certificate?: string;            // Mandatory for 'Upload Own'; base64 PEM
  key?: string;                    // Mandatory for 'Upload Own'; base64 PEM private key
  iEnvironment?: number;           // Optional — target environment
  iCustomer?: number;              // Trusted mode
}

/**
 * createSSLCertificate() — create a new SSL certificate (docs 3000108832).
 *
 * For 'Upload Own' type: `certificate` and `key` are mandatory.
 * For 'Let's Encrypt' type: `i_ssl_certificate_type` is mandatory; cert/key are optional.
 */
export async function createSSLCertificate(
  username: string,
  password: string,
  opts: CreateSSLCertificateOpts,
): Promise<{ iSslCertificate: number; relayResult?: SippyRelayResult }> {
  if (!activeSession) throw new Error('No active Sippy session');
  const apiUrl = `${activeSession.portalUrl}/xmlapi/xmlapi`;

  const members = buildSSLCertMembers({
    name:                 opts.name,
    commonName:           opts.commonName,
    iSslCertificateType:  opts.iSslCertificateType,
    iSslUseDomainType:    opts.iSslUseDomainType,
    altDnsNames:          opts.altDnsNames,
    certificate:          opts.certificate,
    key:                  opts.key,
    iEnvironment:         opts.iEnvironment,
    iCustomer:            opts.iCustomer,
  });

  const resp = await sippyPost(apiUrl, xmlRpcCallFromMembers('createSSLCertificate', members), username, password);
  const text = resp.body.toString?.() ?? resp.body;
  if (resp.statusCode !== 200) throw new Error(`createSSLCertificate HTTP ${resp.statusCode}`);
  assertSippyOk(text, 'createSSLCertificate');

  const s  = extractAllTags(text, 'struct')[0] ?? '';
  const mm = extractStructMembers(s);
  return {
    iSslCertificate: mm['i_ssl_certificate'] ? parseInt(mm['i_ssl_certificate'], 10) : 0,
    relayResult:     parseRelayResult(text),
  };
}

// ── updateSSLCertificate() ────────────────────────────────────────────────────

export interface UpdateSSLCertificateOpts {
  iSslCertificate: number;         // Mandatory — ID of cert to update
  name?: string;
  commonName?: string;
  iSslCertificateType?: number;
  iSslUseDomainType?: number;
  altDnsNames?: string[];
  certificate?: string;            // base64 PEM
  key?: string;                    // base64 PEM private key
  iEnvironment?: number;
  iCustomer?: number;              // Trusted mode
}

/**
 * updateSSLCertificate() — update an existing SSL certificate (docs 3000108832).
 */
export async function updateSSLCertificate(
  username: string,
  password: string,
  opts: UpdateSSLCertificateOpts,
): Promise<{ iSslCertificate: number; relayResult?: SippyRelayResult }> {
  if (!activeSession) throw new Error('No active Sippy session');
  const apiUrl = `${activeSession.portalUrl}/xmlapi/xmlapi`;

  const members = buildSSLCertMembers(opts);
  const resp = await sippyPost(apiUrl, xmlRpcCallFromMembers('updateSSLCertificate', members), username, password);
  const text = resp.body.toString?.() ?? resp.body;
  if (resp.statusCode !== 200) throw new Error(`updateSSLCertificate HTTP ${resp.statusCode}`);
  assertSippyOk(text, 'updateSSLCertificate');

  const s  = extractAllTags(text, 'struct')[0] ?? '';
  const mm = extractStructMembers(s);
  return {
    iSslCertificate: mm['i_ssl_certificate'] ? parseInt(mm['i_ssl_certificate'], 10) : 0,
    relayResult:     parseRelayResult(text),
  };
}

// ── deleteSSLCertificate() ────────────────────────────────────────────────────

/**
 * deleteSSLCertificate() — delete an SSL certificate (docs 3000108832).
 *
 * @param iSslCertificate  ID of the certificate to delete (required)
 * @param iEnvironment     Target environment (optional)
 * @param iCustomer        Trusted-mode customer ID (optional)
 */
export async function deleteSSLCertificate(
  username: string,
  password: string,
  iSslCertificate: number,
  iEnvironment?: number,
  iCustomer?: number,
): Promise<{ iSslCertificate: number; relayResult?: SippyRelayResult }> {
  if (!activeSession) throw new Error('No active Sippy session');
  const apiUrl = `${activeSession.portalUrl}/xmlapi/xmlapi`;

  const params: Record<string, string | number | boolean | null> = { i_ssl_certificate: iSslCertificate };
  if (iEnvironment !== undefined) params.i_environment = iEnvironment;
  if (iCustomer    !== undefined) params.i_customer    = iCustomer;

  const resp = await sippyPost(apiUrl, xmlRpcCall('deleteSSLCertificate', params), username, password);
  const text = resp.body.toString?.() ?? resp.body;
  if (resp.statusCode !== 200) throw new Error(`deleteSSLCertificate HTTP ${resp.statusCode}`);
  assertSippyOk(text, 'deleteSSLCertificate');

  const s  = extractAllTags(text, 'struct')[0] ?? '';
  const mm = extractStructMembers(s);
  return {
    iSslCertificate: mm['i_ssl_certificate'] ? parseInt(mm['i_ssl_certificate'], 10) : iSslCertificate,
    relayResult:     parseRelayResult(text),
  };
}

// ── getSSLCertificateInfo() ───────────────────────────────────────────────────

/**
 * getSSLCertificateInfo() — fetch detailed info for one SSL certificate (docs 3000108832).
 *
 * @param iSslCertificate  Certificate ID (required)
 * @param iEnvironment     Target environment (optional)
 * @param iCustomer        Trusted-mode customer ID (optional)
 */
export async function getSSLCertificateInfo(
  username: string,
  password: string,
  iSslCertificate: number,
  iEnvironment?: number,
  iCustomer?: number,
): Promise<{ certificate: SippySSLCertificate; relayResult?: SippyRelayResult }> {
  if (!activeSession) throw new Error('No active Sippy session');
  const apiUrl = `${activeSession.portalUrl}/xmlapi/xmlapi`;

  const params: Record<string, string | number | boolean | null> = { i_ssl_certificate: iSslCertificate };
  if (iEnvironment !== undefined) params.i_environment = iEnvironment;
  if (iCustomer    !== undefined) params.i_customer    = iCustomer;

  const resp = await sippyPost(apiUrl, xmlRpcCall('getSSLCertificateInfo', params), username, password);
  const text = resp.body.toString?.() ?? resp.body;
  if (resp.statusCode !== 200) throw new Error(`getSSLCertificateInfo HTTP ${resp.statusCode}`);
  assertSippyOk(text, 'getSSLCertificateInfo');

  // Extract the nested ssl_certificate struct
  const certMatch = text.match(/<name>ssl_certificate<\/name>\s*<value>\s*<struct>([\s\S]*?)<\/struct>/i);
  const certStruct = certMatch ? certMatch[1] : (extractAllTags(text, 'struct')[0] ?? '');

  return {
    certificate: parseSSLCertStruct(certStruct),
    relayResult: parseRelayResult(text),
  };
}

// ── getSSLCertificatesList() ──────────────────────────────────────────────────

/**
 * getSSLCertificatesList() — list SSL certificates with optional filtering (docs 3000108832).
 *
 * @param username       XML-RPC admin username
 * @param password       XML-RPC admin password
 * @param namePattern    SQL ILIKE pattern to filter by name (optional)
 * @param limit          Maximum number of results (optional)
 * @param offset         Skip first N results for pagination (optional)
 * @param iEnvironment   Target environment (optional)
 * @param iCustomer      Trusted-mode customer ID (optional)
 */
export async function getSSLCertificatesList(
  username: string,
  password: string,
  namePattern?: string,
  limit?: number,
  offset?: number,
  iEnvironment?: number,
  iCustomer?: number,
): Promise<{ certificates: SippySSLCertificate[]; relayResult?: SippyRelayResult }> {
  if (!activeSession) throw new Error('No active Sippy session');
  const apiUrl = `${activeSession.portalUrl}/xmlapi/xmlapi`;

  const params: Record<string, string | number | boolean | null> = {};
  if (namePattern  !== undefined) params.name_pattern  = namePattern;
  if (limit        !== undefined) params.limit         = limit;
  if (offset       !== undefined) params.offset        = offset;
  if (iEnvironment !== undefined) params.i_environment = iEnvironment;
  if (iCustomer    !== undefined) params.i_customer    = iCustomer;

  const resp = await sippyPost(apiUrl, xmlRpcCall('getSSLCertificatesList', params), username, password);
  const text = resp.body.toString?.() ?? resp.body;
  if (resp.statusCode !== 200) throw new Error(`getSSLCertificatesList HTTP ${resp.statusCode}`);
  assertSippyOk(text, 'getSSLCertificatesList');

  // The ssl_certificates array contains one struct per certificate
  const arrMatch = text.match(/<name>ssl_certificates<\/name>\s*<value>\s*<array>\s*<data>([\s\S]*?)<\/data>/i);
  const certificates: SippySSLCertificate[] = [];
  if (arrMatch) {
    const innerStructs = extractAllTags(arrMatch[1], 'struct');
    for (const s of innerStructs) {
      certificates.push(parseSSLCertStruct(s));
    }
  }

  return { certificates, relayResult: parseRelayResult(text) };
}

// ── CA Lists (docs 3000111712) ────────────────────────────────────────────────

/**
 * CA list record returned by getCAListInfo() and getCAListsList().
 * Sippy does not enumerate the struct fields — known fields are typed; extras go in `extra`.
 */
export interface SippyCAList {
  iCaList: number;            // i_ca_list — unique CA list ID
  name?: string;              // name — human-readable CA list name
  caList?: string;            // ca_list — base64 PEM content or folder path
  iCaListType?: number;       // i_ca_list_type — see getDictionary('ca_list_types')
  iSslUseDomainType?: number; // i_ssl_use_domain_type — see getDictionary('ssl_use_domain_types') [2023+]
  extra: Record<string, string>; // any additional undocumented fields from Sippy
}

/** Parse a single ca_list struct out of a raw XML struct string. */
function parseCAListStruct(s: string): SippyCAList {
  const m = extractStructMembers(s);
  const known = new Set(['i_ca_list', 'name', 'ca_list', 'i_ca_list_type', 'i_ssl_use_domain_type']);
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(m)) {
    if (!known.has(k)) extra[k] = v;
  }
  return {
    iCaList:           m['i_ca_list']            ? parseInt(m['i_ca_list'], 10)            : 0,
    name:              m['name']                 || undefined,
    caList:            m['ca_list']              || undefined,
    iCaListType:       m['i_ca_list_type']       ? parseInt(m['i_ca_list_type'], 10)       : undefined,
    iSslUseDomainType: m['i_ssl_use_domain_type'] ? parseInt(m['i_ssl_use_domain_type'], 10) : undefined,
    extra,
  };
}

/**
 * createCAList() — create a new CA list (docs 3000111712).
 *
 * CA list types (from getDictionary('ca_list_types')):
 *   'Uploaded'     — caList must be a base64-encoded CA list in PEM format
 *   'Local Folder' — caList must be a path to a folder on the Sippy server
 *
 * @param username         XML-RPC admin username
 * @param password         XML-RPC admin password
 * @param name             Human-readable name (required)
 * @param caList           CA list value — base64 PEM or folder path (required)
 * @param iCaListType      CA list type integer (optional, default: 'Uploaded')
 * @param iSslUseDomainType  Domain type integer (optional, default: 'Web/HTTPS') [Sippy 2023+]
 * @param iCustomer        Trusted-mode customer ID (optional)
 */
export async function createCAList(
  username: string,
  password: string,
  name: string,
  caList: string,
  iCaListType?: number,
  iSslUseDomainType?: number,
  iCustomer?: number,
): Promise<{ iCaList: number }> {
  if (!activeSession) throw new Error('No active Sippy session');
  const apiUrl = `${activeSession.portalUrl}/xmlapi/xmlapi`;

  const params: Record<string, string | number | boolean | null> = { name, ca_list: caList };
  if (iCaListType       !== undefined) params.i_ca_list_type       = iCaListType;
  if (iSslUseDomainType !== undefined) params.i_ssl_use_domain_type = iSslUseDomainType;
  if (iCustomer         !== undefined) params.i_customer            = iCustomer;

  const resp = await sippyPost(apiUrl, xmlRpcCall('createCAList', params), username, password);
  const text = resp.body.toString?.() ?? resp.body;
  if (resp.statusCode !== 200) throw new Error(`createCAList HTTP ${resp.statusCode}`);
  assertSippyOk(text, 'createCAList');

  const mm = extractStructMembers(extractAllTags(text, 'struct')[0] ?? '');
  return { iCaList: mm['i_ca_list'] ? parseInt(mm['i_ca_list'], 10) : 0 };
}

/**
 * updateCAList() — update an existing CA list (docs 3000111712).
 *
 * Note: `iSslUseDomainType` and `caList` are co-dependent — both must be supplied together.
 *
 * @param iCaList          CA list ID to update (required)
 * @param name             New name (optional)
 * @param iCaListType      New CA list type (optional)
 * @param iSslUseDomainType  New domain type [Sippy 2023+]; must be paired with caList
 * @param caList           New CA list value; must be paired with iSslUseDomainType
 * @param iCustomer        Trusted-mode customer ID (optional)
 */
export async function updateCAList(
  username: string,
  password: string,
  iCaList: number,
  opts: {
    name?: string;
    iCaListType?: number;
    iSslUseDomainType?: number; // must be paired with caList
    caList?: string;            // must be paired with iSslUseDomainType
    iCustomer?: number;
  } = {},
): Promise<{ iCaList: number }> {
  if (!activeSession) throw new Error('No active Sippy session');

  // Enforce co-dependency documented in the spec
  if ((opts.iSslUseDomainType !== undefined) !== (opts.caList !== undefined)) {
    throw new Error('updateCAList: iSslUseDomainType and caList must be supplied together');
  }

  const apiUrl = `${activeSession.portalUrl}/xmlapi/xmlapi`;
  const params: Record<string, string | number | boolean | null> = { i_ca_list: iCaList };
  if (opts.name             !== undefined) params.name                 = opts.name;
  if (opts.iCaListType      !== undefined) params.i_ca_list_type       = opts.iCaListType;
  if (opts.iSslUseDomainType !== undefined) params.i_ssl_use_domain_type = opts.iSslUseDomainType;
  if (opts.caList           !== undefined) params.ca_list              = opts.caList;
  if (opts.iCustomer        !== undefined) params.i_customer           = opts.iCustomer;

  const resp = await sippyPost(apiUrl, xmlRpcCall('updateCAList', params), username, password);
  const text = resp.body.toString?.() ?? resp.body;
  if (resp.statusCode !== 200) throw new Error(`updateCAList HTTP ${resp.statusCode}`);
  assertSippyOk(text, 'updateCAList');

  const mm = extractStructMembers(extractAllTags(text, 'struct')[0] ?? '');
  return { iCaList: mm['i_ca_list'] ? parseInt(mm['i_ca_list'], 10) : iCaList };
}

/**
 * deleteCAList() — delete a CA list (docs 3000111712).
 *
 * @param iCaList    CA list ID to delete (required)
 * @param iCustomer  Trusted-mode customer ID (optional)
 */
export async function deleteCAList(
  username: string,
  password: string,
  iCaList: number,
  iCustomer?: number,
): Promise<{ iCaList: number }> {
  if (!activeSession) throw new Error('No active Sippy session');
  const apiUrl = `${activeSession.portalUrl}/xmlapi/xmlapi`;

  const params: Record<string, string | number | boolean | null> = { i_ca_list: iCaList };
  if (iCustomer !== undefined) params.i_customer = iCustomer;

  const resp = await sippyPost(apiUrl, xmlRpcCall('deleteCAList', params), username, password);
  const text = resp.body.toString?.() ?? resp.body;
  if (resp.statusCode !== 200) throw new Error(`deleteCAList HTTP ${resp.statusCode}`);
  assertSippyOk(text, 'deleteCAList');

  const mm = extractStructMembers(extractAllTags(text, 'struct')[0] ?? '');
  return { iCaList: mm['i_ca_list'] ? parseInt(mm['i_ca_list'], 10) : iCaList };
}

/**
 * getCAListInfo() — fetch detailed info for one CA list (docs 3000111712).
 *
 * @param iCaList    CA list ID (required)
 * @param iCustomer  Trusted-mode customer ID (optional)
 */
export async function getCAListInfo(
  username: string,
  password: string,
  iCaList: number,
  iCustomer?: number,
): Promise<SippyCAList> {
  if (!activeSession) throw new Error('No active Sippy session');
  const apiUrl = `${activeSession.portalUrl}/xmlapi/xmlapi`;

  const params: Record<string, string | number | boolean | null> = { i_ca_list: iCaList };
  if (iCustomer !== undefined) params.i_customer = iCustomer;

  const resp = await sippyPost(apiUrl, xmlRpcCall('getCAListInfo', params), username, password);
  const text = resp.body.toString?.() ?? resp.body;
  if (resp.statusCode !== 200) throw new Error(`getCAListInfo HTTP ${resp.statusCode}`);
  assertSippyOk(text, 'getCAListInfo');

  // Sippy wraps the detail under <name>ca_list</name><value><struct>…</struct></value>
  const nested = text.match(/<name>ca_list<\/name>\s*<value>\s*<struct>([\s\S]*?)<\/struct>/i);
  const structStr = nested ? nested[1] : (extractAllTags(text, 'struct')[0] ?? '');
  return parseCAListStruct(structStr);
}

/**
 * getCAListsList() — list CA lists with optional filtering (docs 3000111712).
 *
 * @param username      XML-RPC admin username
 * @param password      XML-RPC admin password
 * @param namePattern   SQL ILIKE pattern to filter by name (e.g. 'prod%') (optional)
 * @param limit         Maximum number of results (optional)
 * @param offset        Skip first N results for pagination (optional)
 * @param iCustomer     Trusted-mode customer ID (optional)
 */
export async function getCAListsList(
  username: string,
  password: string,
  namePattern?: string,
  limit?: number,
  offset?: number,
  iCustomer?: number,
): Promise<SippyCAList[]> {
  if (!activeSession) throw new Error('No active Sippy session');
  const apiUrl = `${activeSession.portalUrl}/xmlapi/xmlapi`;

  const params: Record<string, string | number | boolean | null> = {};
  if (namePattern !== undefined) params.name_pattern = namePattern;
  if (limit       !== undefined) params.limit        = limit;
  if (offset      !== undefined) params.offset       = offset;
  if (iCustomer   !== undefined) params.i_customer   = iCustomer;

  const resp = await sippyPost(apiUrl, xmlRpcCall('getCAListsList', params), username, password);
  const text = resp.body.toString?.() ?? resp.body;
  if (resp.statusCode !== 200) throw new Error(`getCAListsList HTTP ${resp.statusCode}`);
  assertSippyOk(text, 'getCAListsList');

  // Extract the ca_lists array (note: singular "ca_list" in the array name per doc)
  const arrMatch = text.match(/<name>ca_lists<\/name>\s*<value>\s*<array>\s*<data>([\s\S]*?)<\/data>/i);
  if (!arrMatch) return [];

  return extractAllTags(arrMatch[1], 'struct').map(parseCAListStruct);
}

// ── Network Services (docs 3000112519) ───────────────────────────────────────

/** One listener entry: an IP + port pair that a network service binds on. */
export interface SippyNetworkServiceListener {
  ipAddress: string;  // ip_address — IP address the service listens on
  port: number;       // port — TCP/UDP port the service listens on
}

/** Network service record returned by getNetworkServiceInfo() and getNetworkServicesList(). */
export interface SippyNetworkService {
  iProtoTransport: number;                  // i_proto_transport — proto_transport ID (see getDictionary('proto_transports'))
  listeners: SippyNetworkServiceListener[]; // ordered list of listeners (ip + port pairs)
}

/**
 * Builds the XML body for updateNetworkService().
 * `listeners` is an array of structs — cannot go through buildStructMembers().
 */
function buildUpdateNetworkServiceXml(
  iProtoTransport: number,
  listeners: SippyNetworkServiceListener[],
  iCustomer?: number,
): string {
  const listenerItems = listeners.map(l =>
    `<value><struct>` +
    `<member><name>ip_address</name><value><string>${l.ipAddress.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</string></value></member>` +
    `<member><name>port</name><value><int>${l.port}</int></value></member>` +
    `</struct></value>`,
  ).join('');

  let members =
    `<member><name>i_proto_transport</name><value><int>${iProtoTransport}</int></value></member>` +
    `<member><name>listeners</name><value><array><data>${listenerItems}</data></array></value></member>`;

  if (iCustomer !== undefined) {
    members += `<member><name>i_customer</name><value><int>${iCustomer}</int></value></member>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?><methodCall><methodName>updateNetworkService</methodName><params><param><value><struct>${members}</struct></value></param></params></methodCall>`;
}

/** Parse the listeners array out of a raw XML response body. */
function parseListeners(text: string): SippyNetworkServiceListener[] {
  const arrMatch = text.match(/<name>listeners<\/name>\s*<value>\s*<array>\s*<data>([\s\S]*?)<\/data>/i);
  if (!arrMatch) return [];
  return extractAllTags(arrMatch[1], 'struct').map(s => {
    const m = extractStructMembers(s);
    return {
      ipAddress: m['ip_address'] || '',
      port:      m['port']       ? parseInt(m['port'], 10) : 0,
    };
  });
}

/**
 * updateNetworkService() — update the listener list for a network service (docs 3000112519).
 *
 * Network services are pre-existing in Sippy — there is no create or delete.
 * `i_proto_transport` identifies which service to update (see getDictionary('proto_transports')).
 *
 * @param iProtoTransport  Proto-transport ID of the service to update (required)
 * @param listeners        Ordered list of {ipAddress, port} pairs (required)
 * @param iCustomer        Trusted-mode customer ID (optional)
 */
export async function updateNetworkService(
  username: string,
  password: string,
  iProtoTransport: number,
  listeners: SippyNetworkServiceListener[],
  iCustomer?: number,
): Promise<{ iProtoTransport: number }> {
  if (!activeSession) throw new Error('No active Sippy session');
  const apiUrl = `${activeSession.portalUrl}/xmlapi/xmlapi`;

  const xmlBody = buildUpdateNetworkServiceXml(iProtoTransport, listeners, iCustomer);
  const resp = await sippyPost(apiUrl, xmlBody, username, password);
  const text = resp.body.toString?.() ?? resp.body;
  if (resp.statusCode !== 200) throw new Error(`updateNetworkService HTTP ${resp.statusCode}`);
  assertSippyOk(text, 'updateNetworkService');

  const mm = extractStructMembers(extractAllTags(text, 'struct')[0] ?? '');
  return { iProtoTransport: mm['i_proto_transport'] ? parseInt(mm['i_proto_transport'], 10) : iProtoTransport };
}

/**
 * getNetworkServiceInfo() — fetch listeners for one network service (docs 3000112519).
 *
 * @param iProtoTransport  Proto-transport ID (required)
 * @param iCustomer        Trusted-mode customer ID (optional)
 */
export async function getNetworkServiceInfo(
  username: string,
  password: string,
  iProtoTransport: number,
  iCustomer?: number,
): Promise<SippyNetworkService> {
  if (!activeSession) throw new Error('No active Sippy session');
  const apiUrl = `${activeSession.portalUrl}/xmlapi/xmlapi`;

  const params: Record<string, string | number | boolean | null> = { i_proto_transport: iProtoTransport };
  if (iCustomer !== undefined) params.i_customer = iCustomer;

  const resp = await sippyPost(apiUrl, xmlRpcCall('getNetworkServiceInfo', params), username, password);
  const text = resp.body.toString?.() ?? resp.body;
  if (resp.statusCode !== 200) throw new Error(`getNetworkServiceInfo HTTP ${resp.statusCode}`);
  assertSippyOk(text, 'getNetworkServiceInfo');

  const mm = extractStructMembers(extractAllTags(text, 'struct')[0] ?? '');
  return {
    iProtoTransport: mm['i_proto_transport'] ? parseInt(mm['i_proto_transport'], 10) : iProtoTransport,
    listeners:       parseListeners(text),
  };
}

/**
 * getNetworkServicesList() — list all network services (docs 3000112519).
 *
 * @param username   XML-RPC admin username
 * @param password   XML-RPC admin password
 * @param limit      Maximum number of results (optional)
 * @param offset     Skip first N results for pagination (optional)
 * @param iCustomer  Trusted-mode customer ID (optional)
 */
export async function getNetworkServicesList(
  username: string,
  password: string,
  limit?: number,
  offset?: number,
  iCustomer?: number,
): Promise<SippyNetworkService[]> {
  if (!activeSession) throw new Error('No active Sippy session');
  const apiUrl = `${activeSession.portalUrl}/xmlapi/xmlapi`;

  const params: Record<string, string | number | boolean | null> = {};
  if (limit     !== undefined) params.limit      = limit;
  if (offset    !== undefined) params.offset     = offset;
  if (iCustomer !== undefined) params.i_customer = iCustomer;

  const resp = await sippyPost(apiUrl, xmlRpcCall('getNetworkServicesList', params), username, password);
  const text = resp.body.toString?.() ?? resp.body;
  if (resp.statusCode !== 200) throw new Error(`getNetworkServicesList HTTP ${resp.statusCode}`);
  assertSippyOk(text, 'getNetworkServicesList');

  // network_services is an array; each element is a network service struct containing
  // i_proto_transport (scalar) and listeners (nested array of structs).
  // We parse each top-level struct, then extract its listeners sub-array.
  const arrMatch = text.match(/<name>network_services<\/name>\s*<value>\s*<array>\s*<data>([\s\S]*?)<\/data>/i);
  if (!arrMatch) return [];

  // Each service struct has its own listeners array — parse via regex scoped to that struct
  const serviceStructs = extractAllTags(arrMatch[1], 'struct');
  return serviceStructs.map(s => {
    const mm = extractStructMembers(s);
    return {
      iProtoTransport: mm['i_proto_transport'] ? parseInt(mm['i_proto_transport'], 10) : 0,
      listeners:       parseListeners(s),   // scope parseListeners to this struct's XML
    };
  });
}

// ── Tariffs Management (docs 3000098586) + Rates (docs 3000118878) ───────────

/**
 * Full tariff record returned by getTariffInfo().
 * Field list mirrors the createTariff() optional params plus i_tariff.
 */
export interface SippyTariff {
  iTariff: number;                        // i_tariff — unique tariff ID
  name: string;                           // tariff name
  currency: string;                       // tariff currency (ISO 4217, e.g. 'USD')
  iTariffType?: number;                   // i_tariff_type — see getDictionary('tariff_types')
  connectFee?: number;                    // connect_fee — connect fee (Double)
  freeSeconds?: number;                   // free_seconds — free seconds (Integer)
  postCallSurcharge?: number;             // post_call_surcharge — fraction part (Double)
  gracePeriod?: number;                   // grace_period (Integer)
  lossProtection?: boolean;               // loss_protection — is loss protection enabled
  maxLoss?: number;                       // max_loss — max loss fraction (Double)
  costRoundUp?: boolean;                  // cost_round_up — round up call cost
  decimalPrecision?: number;              // decimal_precision — cost decimal precision
  averageDuration?: number;               // average_duration — ACD in seconds
  localCalling?: boolean;                 // local_calling — is local calling enabled
  localCallingCliValidationRule?: string; // local_calling_cli_validation_rule
  extra: Record<string, string>;          // undocumented fields returned by Sippy
}

/** Simplified tariff entry returned inside the getTariffsList() array. */
export interface SippyTariffListEntry {
  iTariff: number;       // i_tariff
  name: string;          // tariff name
  currency: string;      // tariff currency
  iTariffType?: number;  // i_tariff_type
}

/**
 * Rate record returned by getTariffRatesList() — docs 3000118878.
 * Optional local-calling fields appear only when the tariff has local_calling enabled
 * and the tariff type is not 'Incoming Tariff'.
 */
export interface SippyTariffRate {
  iRate: number;              // i_rate — unique rate identifier
  prefix: string;             // prefix — dial prefix
  price1: number;             // price_1 — price per minute (first interval)
  priceN: number;             // price_n — price per minute (subsequent intervals)
  interval1: number;          // interval_1 — first billing interval in seconds
  intervalN: number;          // interval_n — subsequent billing interval in seconds
  forbidden?: boolean;        // forbidden — true if this prefix is blocked (not for Incoming tariffs)
  gracePeriodEnable?: boolean; // grace_period_enable — grace period enabled for this rate
  activationDate?: string;    // activation_date — ISO8601 UTC timestamp
  expirationDate?: string;    // expiration_date — ISO8601 UTC timestamp; nil = never expires
  // local_calling extras (only when tariff has local_calling enabled and type is 'Tariff')
  localPrice1?: number;       // local_price_1
  localPriceN?: number;       // local_price_n
  localInterval1?: number;    // local_interval_1
  localIntervalN?: number;    // local_interval_n
  areaName?: string;          // area_name — associated geographic region
}

/** Parse a single tariff struct returned by getTariffInfo(). */
function parseTariffStruct(s: string): SippyTariff {
  const m = extractStructMembers(s);
  const known = new Set(['i_tariff','name','currency','i_tariff_type','connect_fee',
    'free_seconds','post_call_surcharge','grace_period','loss_protection','max_loss',
    'cost_round_up','decimal_precision','average_duration','local_calling',
    'local_calling_cli_validation_rule']);
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(m)) { if (!known.has(k)) extra[k] = v; }
  return {
    iTariff:                       m['i_tariff']             ? parseInt(m['i_tariff'], 10)             : 0,
    name:                          m['name']                 || '',
    currency:                      m['currency']             || '',
    iTariffType:                   m['i_tariff_type']        ? parseInt(m['i_tariff_type'], 10)        : undefined,
    connectFee:                    m['connect_fee']          ? parseFloat(m['connect_fee'])            : undefined,
    freeSeconds:                   m['free_seconds']         ? parseInt(m['free_seconds'], 10)         : undefined,
    postCallSurcharge:             m['post_call_surcharge']  ? parseFloat(m['post_call_surcharge'])    : undefined,
    gracePeriod:                   m['grace_period']         ? parseInt(m['grace_period'], 10)         : undefined,
    lossProtection:                m['loss_protection']      ? m['loss_protection'] !== '0'            : undefined,
    maxLoss:                       m['max_loss']             ? parseFloat(m['max_loss'])               : undefined,
    costRoundUp:                   m['cost_round_up']        ? m['cost_round_up'] !== '0'             : undefined,
    decimalPrecision:              m['decimal_precision']    ? parseInt(m['decimal_precision'], 10)    : undefined,
    averageDuration:               m['average_duration']     ? parseInt(m['average_duration'], 10)     : undefined,
    localCalling:                  m['local_calling']        ? m['local_calling'] !== '0'              : undefined,
    localCallingCliValidationRule: m['local_calling_cli_validation_rule'] || undefined,
    extra,
  };
}

/** Parse one rate struct from getTariffRatesList() response. */
function parseTariffRateStruct(s: string): SippyTariffRate {
  const m = extractStructMembers(s);
  return {
    iRate:             m['i_rate']             ? parseInt(m['i_rate'], 10)              : 0,
    prefix:            m['prefix']             || '',
    price1:            m['price_1']            ? parseFloat(m['price_1'])               : 0,
    priceN:            m['price_n']            ? parseFloat(m['price_n'])               : 0,
    interval1:         m['interval_1']         ? parseInt(m['interval_1'], 10)          : 0,
    intervalN:         m['interval_n']         ? parseInt(m['interval_n'], 10)          : 0,
    forbidden:         m['forbidden']          !== undefined ? m['forbidden'] !== '0'   : undefined,
    gracePeriodEnable: m['grace_period_enable'] !== undefined ? m['grace_period_enable'] !== '0' : undefined,
    activationDate:    m['activation_date']    || undefined,
    expirationDate:    m['expiration_date']    || undefined,
    localPrice1:       m['local_price_1']      ? parseFloat(m['local_price_1'])         : undefined,
    localPriceN:       m['local_price_n']      ? parseFloat(m['local_price_n'])         : undefined,
    localInterval1:    m['local_interval_1']   ? parseInt(m['local_interval_1'], 10)    : undefined,
    localIntervalN:    m['local_interval_n']   ? parseInt(m['local_interval_n'], 10)    : undefined,
    areaName:          m['area_name']          || undefined,
  };
}

// ── createTariff() ────────────────────────────────────────────────────────────

export interface CreateTariffOpts {
  name: string;                           // Mandatory
  currency: string;                       // Mandatory — ISO 4217 (e.g. 'USD')
  iTariffType?: number;                   // Optional — see getDictionary('tariff_types'); default 1
  connectFee?: number;                    // Double; default 0
  freeSeconds?: number;                   // Integer; default 0
  postCallSurcharge?: number;             // Double fraction; default 0
  gracePeriod?: number;                   // Integer; default 0
  lossProtection?: boolean;               // Boolean; default false
  maxLoss?: number;                       // Double fraction
  costRoundUp?: boolean;                  // Boolean; default false
  decimalPrecision?: number;              // Integer; default 20
  averageDuration?: number;              // Integer (ACD); default 200
  localCalling?: boolean;                 // Boolean; default false
  localCallingCliValidationRule?: string; // String
  iCustomer?: number;                     // Trusted mode
}

/**
 * createTariff() — create a new tariff (docs 3000098586). Available since Sippy 2020.
 * NOTE: currency and i_tariff_type cannot be changed after creation.
 */
export async function createTariff(
  username: string,
  password: string,
  opts: CreateTariffOpts,
): Promise<{ iTariff: number }> {
  if (!activeSession) throw new Error('No active Sippy session');
  const apiUrl = `${activeSession.portalUrl}/xmlapi/xmlapi`;

  const p: Record<string, string | number | boolean | null> = {
    name:     opts.name,
    currency: opts.currency,
  };
  if (opts.iTariffType      !== undefined) p.i_tariff_type                     = opts.iTariffType;
  if (opts.connectFee       !== undefined) p.connect_fee                       = opts.connectFee;
  if (opts.freeSeconds      !== undefined) p.free_seconds                      = opts.freeSeconds;
  if (opts.postCallSurcharge !== undefined) p.post_call_surcharge               = opts.postCallSurcharge;
  if (opts.gracePeriod      !== undefined) p.grace_period                      = opts.gracePeriod;
  if (opts.lossProtection   !== undefined) p.loss_protection                   = opts.lossProtection;
  if (opts.maxLoss          !== undefined) p.max_loss                          = opts.maxLoss;
  if (opts.costRoundUp      !== undefined) p.cost_round_up                     = opts.costRoundUp;
  if (opts.decimalPrecision !== undefined) p.decimal_precision                 = opts.decimalPrecision;
  if (opts.averageDuration  !== undefined) p.average_duration                  = opts.averageDuration;
  if (opts.localCalling     !== undefined) p.local_calling                     = opts.localCalling;
  if (opts.localCallingCliValidationRule !== undefined) p.local_calling_cli_validation_rule = opts.localCallingCliValidationRule;
  if (opts.iCustomer        !== undefined) p.i_customer                        = opts.iCustomer;

  const resp = await sippyPost(apiUrl, xmlRpcCall('createTariff', p), username, password);
  const text = resp.body.toString?.() ?? resp.body;
  if (resp.statusCode !== 200) throw new Error(`createTariff HTTP ${resp.statusCode}`);
  assertSippyOk(text, 'createTariff');

  const mm = extractStructMembers(extractAllTags(text, 'struct')[0] ?? '');
  return { iTariff: mm['i_tariff'] ? parseInt(mm['i_tariff'], 10) : 0 };
}

// ── updateTariff() ────────────────────────────────────────────────────────────

/**
 * updateTariff() — update an existing tariff (docs 3000098586). Available since Sippy 2020.
 * NOTE: currency and i_tariff_type cannot be changed — Sippy will reject those fields.
 */
export async function updateTariff(
  username: string,
  password: string,
  iTariff: number,
  opts: Omit<CreateTariffOpts, 'name' | 'currency'> & { name?: string },
): Promise<void> {
  if (!activeSession) throw new Error('No active Sippy session');
  const apiUrl = `${activeSession.portalUrl}/xmlapi/xmlapi`;

  const p: Record<string, string | number | boolean | null> = { i_tariff: iTariff };
  if (opts.name             !== undefined) p.name                              = opts.name;
  if (opts.connectFee       !== undefined) p.connect_fee                       = opts.connectFee;
  if (opts.freeSeconds      !== undefined) p.free_seconds                      = opts.freeSeconds;
  if (opts.postCallSurcharge !== undefined) p.post_call_surcharge               = opts.postCallSurcharge;
  if (opts.gracePeriod      !== undefined) p.grace_period                      = opts.gracePeriod;
  if (opts.lossProtection   !== undefined) p.loss_protection                   = opts.lossProtection;
  if (opts.maxLoss          !== undefined) p.max_loss                          = opts.maxLoss;
  if (opts.costRoundUp      !== undefined) p.cost_round_up                     = opts.costRoundUp;
  if (opts.decimalPrecision !== undefined) p.decimal_precision                 = opts.decimalPrecision;
  if (opts.averageDuration  !== undefined) p.average_duration                  = opts.averageDuration;
  if (opts.localCalling     !== undefined) p.local_calling                     = opts.localCalling;
  if (opts.localCallingCliValidationRule !== undefined) p.local_calling_cli_validation_rule = opts.localCallingCliValidationRule;
  if (opts.iCustomer        !== undefined) p.i_customer                        = opts.iCustomer;

  const resp = await sippyPost(apiUrl, xmlRpcCall('updateTariff', p), username, password);
  const text = resp.body.toString?.() ?? resp.body;
  if (resp.statusCode !== 200) throw new Error(`updateTariff HTTP ${resp.statusCode}`);
  assertSippyOk(text, 'updateTariff');
}

// ── deleteTariff() ────────────────────────────────────────────────────────────

/**
 * deleteTariff() — delete an existing tariff (docs 3000098586). Available since Sippy 2020.
 */
export async function deleteTariff(
  username: string,
  password: string,
  iTariff: number,
  iCustomer?: number,
): Promise<void> {
  if (!activeSession) throw new Error('No active Sippy session');
  const apiUrl = `${activeSession.portalUrl}/xmlapi/xmlapi`;

  const p: Record<string, string | number | boolean | null> = { i_tariff: iTariff };
  if (iCustomer !== undefined) p.i_customer = iCustomer;

  const resp = await sippyPost(apiUrl, xmlRpcCall('deleteTariff', p), username, password);
  const text = resp.body.toString?.() ?? resp.body;
  if (resp.statusCode !== 200) throw new Error(`deleteTariff HTTP ${resp.statusCode}`);
  assertSippyOk(text, 'deleteTariff');
}

// ── getTariffInfo() ───────────────────────────────────────────────────────────

/**
 * getTariffInfo() — fetch full parameters for one tariff (docs 3000098586). Available since Sippy 2020.
 */
export async function getTariffInfo(
  username: string,
  password: string,
  iTariff: number,
  iCustomer?: number,
): Promise<SippyTariff> {
  if (!activeSession) throw new Error('No active Sippy session');
  const apiUrl = `${activeSession.portalUrl}/xmlapi/xmlapi`;

  const p: Record<string, string | number | boolean | null> = { i_tariff: iTariff };
  if (iCustomer !== undefined) p.i_customer = iCustomer;

  const resp = await sippyPost(apiUrl, xmlRpcCall('getTariffInfo', p), username, password);
  const text = resp.body.toString?.() ?? resp.body;
  if (resp.statusCode !== 200) throw new Error(`getTariffInfo HTTP ${resp.statusCode}`);
  assertSippyOk(text, 'getTariffInfo');

  // Sippy wraps the detail under <name>tariff</name><value><struct>…</struct></value>
  const nested = text.match(/<name>tariff<\/name>\s*<value>\s*<struct>([\s\S]*?)<\/struct>/i);
  const structStr = nested ? nested[1] : (extractAllTags(text, 'struct')[0] ?? '');
  return parseTariffStruct(structStr);
}

// ── getTariffsList() ──────────────────────────────────────────────────────────

/**
 * getTariffsList() — list tariffs with optional name filtering (docs 3000098586). Available since Sippy 2020.
 * Returns a lightweight array: { iTariff, name, currency, iTariffType }.
 *
 * @param namePattern  SQL ILIKE pattern to filter by name (optional)
 * @param offset       Skip first N records (optional)
 * @param limit        Return at most N records (optional)
 * @param iCustomer    Trusted-mode customer ID (optional)
 */
export async function getTariffsList(
  username: string,
  password: string,
  namePattern?: string,
  offset?: number,
  limit?: number,
  iCustomer?: number,
): Promise<SippyTariffListEntry[]> {
  if (!activeSession) throw new Error('No active Sippy session');
  const apiUrl = `${activeSession.portalUrl}/xmlapi/xmlapi`;

  const p: Record<string, string | number | boolean | null> = {};
  if (namePattern !== undefined) p.name_pattern = namePattern;
  if (offset      !== undefined) p.offset       = offset;
  if (limit       !== undefined) p.limit        = limit;
  if (iCustomer   !== undefined) p.i_customer   = iCustomer;

  const resp = await sippyPost(apiUrl, xmlRpcCall('getTariffsList', p), username, password);
  const text = resp.body.toString?.() ?? resp.body;
  if (resp.statusCode !== 200) throw new Error(`getTariffsList HTTP ${resp.statusCode}`);
  assertSippyOk(text, 'getTariffsList');

  const arrMatch = text.match(/<name>tariffs<\/name>\s*<value>\s*<array>\s*<data>([\s\S]*?)<\/data>/i);
  if (!arrMatch) return [];

  return extractAllTags(arrMatch[1], 'struct').map(s => {
    const m = extractStructMembers(s);
    return {
      iTariff:    m['i_tariff']     ? parseInt(m['i_tariff'], 10)     : 0,
      name:       m['name']         || '',
      currency:   m['currency']     || '',
      iTariffType: m['i_tariff_type'] ? parseInt(m['i_tariff_type'], 10) : undefined,
    };
  });
}

// ── getTariffRatesList() — full official impl (docs 3000118878) ───────────────

/**
 * getTariffRatesList() — get rates within a tariff (docs 3000118878). Available since Sippy 2022.
 *
 * Returns the full SippyTariffRate type including all 15 documented fields.
 * Local-calling fields (localPrice1, localPriceN, etc.) only appear when the tariff
 * has local_calling enabled and is of type 'Tariff' (not 'Incoming Tariff').
 *
 * Default limit is 50 (Sippy default); maximum is 1000.
 *
 * @param iTariff    Tariff ID (required)
 * @param offset     Skip first N rates ordered by prefix (optional)
 * @param limit      Max number of rates to return; 1–1000 (optional, default 50)
 * @param iCustomer  Trusted-mode customer ID (optional)
 */
export async function getTariffRatesListFull(
  username: string,
  password: string,
  iTariff: number,
  offset?: number,
  limit?: number,
  iCustomer?: number,
): Promise<SippyTariffRate[]> {
  if (!activeSession) throw new Error('No active Sippy session');
  const apiUrl = `${activeSession.portalUrl}/xmlapi/xmlapi`;

  const p: Record<string, string | number | boolean | null> = { i_tariff: iTariff };
  if (offset    !== undefined) p.offset     = offset;
  if (limit     !== undefined) p.limit      = Math.min(Math.max(1, limit), 1000);
  if (iCustomer !== undefined) p.i_customer = iCustomer;

  const resp = await sippyPost(apiUrl, xmlRpcCall('getTariffRatesList', p), username, password);
  const text = resp.body.toString?.() ?? resp.body;
  if (resp.statusCode !== 200) throw new Error(`getTariffRatesList HTTP ${resp.statusCode}`);
  assertSippyOk(text, 'getTariffRatesList');

  const arrMatch = text.match(/<name>rates<\/name>\s*<value>\s*<array>\s*<data>([\s\S]*?)<\/data>/i);
  if (!arrMatch) return [];

  return extractAllTags(arrMatch[1], 'struct').map(parseTariffRateStruct);
}

// ── deleteAllRatesInTariff() — docs 3000118878 ────────────────────────────────

/**
 * deleteAllRatesInTariff() — delete every rate in a tariff in one call (docs 3000118878).
 * Available since Sippy 2024.
 *
 * @param iTariff    Tariff ID whose rates should all be deleted (required)
 * @param iCustomer  Trusted-mode customer ID (optional)
 */
export async function deleteAllRatesInTariff(
  username: string,
  password: string,
  iTariff: number,
  iCustomer?: number,
): Promise<void> {
  if (!activeSession) throw new Error('No active Sippy session');
  const apiUrl = `${activeSession.portalUrl}/xmlapi/xmlapi`;

  const p: Record<string, string | number | boolean | null> = { i_tariff: iTariff };
  if (iCustomer !== undefined) p.i_customer = iCustomer;

  const resp = await sippyPost(apiUrl, xmlRpcCall('deleteAllRatesInTariff', p), username, password);
  const text = resp.body.toString?.() ?? resp.body;
  if (resp.statusCode !== 200) throw new Error(`deleteAllRatesInTariff HTTP ${resp.statusCode}`);
  assertSippyOk(text, 'deleteAllRatesInTariff');
}

// ── Portal User Management ────────────────────────────────────────────────────

export interface SippyPortalUser {
  userId: string;
  name: string;
  login: string;
  accessLevel: string;
  description?: string;
  email?: string;
  timezone?: string;
  language?: string;
  allowedHosts?: string;
  startPage?: string;
}

export interface SippyPortalUserInput {
  name: string;
  login: string;
  password?: string;
  accessLevel?: string;
  description?: string;
  email?: string;
  timezone?: string;
  language?: string;
  allowedHosts?: string;
  startPage?: string;
}

export async function listSippyUsers(username: string, password: string, portalUrl?: string): Promise<{ users: SippyPortalUser[]; error?: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { users: [], error: 'Not connected to Sippy.' };

  // ── Portal session mode: use subcustomer scraping ─────────────────────────
  const session = activeSession;
  if (session?.mode === 'portal' && session.cookies) {
    const subcustomers = await getPortalSubcustomers(session.cookies, base);
    const users: SippyPortalUser[] = subcustomers.map((sc, i) => ({
      userId: String(i + 1),
      name: sc.name,
      login: sc.name.toLowerCase().replace(/\s+/g, '.'),
      accessLevel: 'Customer',
      description: sc.description || undefined,
    }));
    return { users };
  }

  const apiUrl = `${base}/xmlapi/xmlapi`;

  // Official method: listCustomers() (Sippy docs 107423)
  // Returns: i_customer, name, web_login, description, balance, credit_limit, base_currency
  // Fallback: legacy method names used in older Sippy versions
  const methods = ['listCustomers', 'user.getUsersList', 'user.getList', 'admin.getAdminList'];
  for (const method of methods) {
    try {
      const body = xmlRpcCall(method, { limit: 200 });
      const resp = await sippyPost(apiUrl, body, username, password);
      if (resp.statusCode !== 200) continue;
      const text = resp.body.toString('utf-8');
      if (text.includes('faultCode')) continue;
      const structs = extractAllTags(text, 'struct');
      if (structs.length === 0) return { users: [] };
      const users: SippyPortalUser[] = [];
      for (const s of structs) {
        const m = extractStructMembers(s);
        // listCustomers() uses i_customer; legacy uses i_user
        const userId = m['i_customer'] || m['i_user'] || m['user_id'] || m['id'] || '';
        if (!userId) continue;
        users.push({
          userId,
          name:        m['name']       || m['login']    || userId,
          login:       m['web_login']  || m['login']    || '',
          accessLevel: m['access_level'] || (m['i_customer'] ? 'Customer' : 'User'),
          description: m['description'] || m['descr']  || undefined,
          email:       m['email']       || undefined,
          timezone:    m['i_time_zone'] || m['time_zone'] || undefined,
          language:    m['i_lang']      || m['language']  || undefined,
          allowedHosts:m['allowed_hosts'] || undefined,
          startPage:   m['start_page']  || undefined,
        });
      }
      return { users };
    } catch { continue; }
  }
  return { users: [], error: 'User management API not available on this Sippy instance.' };
}

export async function addSippyUser(username: string, password: string, user: SippyPortalUserInput, portalUrl?: string): Promise<{ success: boolean; message: string; userId?: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number> = {
    name: user.name,
    login: user.login,
  };
  if (user.password) params.password = user.password;
  if (user.accessLevel) params.access_level = user.accessLevel;
  if (user.description) params.description = user.description;
  if (user.email) params.email = user.email;
  if (user.timezone) params.time_zone = user.timezone;
  if (user.language) params.language = user.language;
  if (user.allowedHosts) params.allowed_hosts = user.allowedHosts;
  if (user.startPage) params.start_page = user.startPage;

  const methods = ['user.addUser', 'user.add', 'user.createUser', 'admin.addAdmin'];
  for (const method of methods) {
    try {
      const body = xmlRpcCall(method, params);
      const resp = await sippyPost(apiUrl, body, username, password);
      if (resp.statusCode !== 200) continue;
      const text = resp.body.toString('utf-8');
      if (text.includes('faultCode')) {
        const fm = extractStructMembers(text);
        const msg = fm['faultString'] || 'Unknown fault';
        if (msg.includes('not found') || msg.includes('undefined')) continue;
        return { success: false, message: msg };
      }
      const m = extractStructMembers(text);
      const newId = m['i_user'] || m['user_id'] || m['id'] || '';
      return { success: true, message: `User "${user.login}" created successfully.`, userId: newId };
    } catch { continue; }
  }
  return { success: false, message: 'User creation API not available on this Sippy instance.' };
}

export async function updateSippyUser(username: string, password: string, userId: string, user: SippyPortalUserInput, portalUrl?: string): Promise<{ success: boolean; message: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number> = { i_user: userId };
  if (user.name) params.name = user.name;
  if (user.login) params.login = user.login;
  if (user.password) params.password = user.password;
  if (user.accessLevel) params.access_level = user.accessLevel;
  if (user.description !== undefined) params.description = user.description;
  if (user.email !== undefined) params.email = user.email;
  if (user.timezone) params.time_zone = user.timezone;
  if (user.allowedHosts !== undefined) params.allowed_hosts = user.allowedHosts;

  const methods = ['user.updateUser', 'user.update', 'admin.updateAdmin'];
  for (const method of methods) {
    try {
      const body = xmlRpcCall(method, params);
      const resp = await sippyPost(apiUrl, body, username, password);
      if (resp.statusCode !== 200) continue;
      const text = resp.body.toString('utf-8');
      if (text.includes('faultCode')) {
        const fm = extractStructMembers(text);
        const msg = fm['faultString'] || '';
        if (msg.includes('not found') || msg.includes('undefined')) continue;
        return { success: false, message: msg };
      }
      return { success: true, message: `User "${user.login}" updated.` };
    } catch { continue; }
  }
  return { success: false, message: 'User update API not available on this Sippy instance.' };
}

export async function deleteSippyUser(username: string, password: string, userId: string, portalUrl?: string): Promise<{ success: boolean; message: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const methods = ['user.deleteUser', 'user.delete', 'admin.deleteAdmin'];
  for (const method of methods) {
    try {
      const body = xmlRpcCall(method, { i_user: userId });
      const resp = await sippyPost(apiUrl, body, username, password);
      if (resp.statusCode !== 200) continue;
      const text = resp.body.toString('utf-8');
      if (text.includes('faultCode')) {
        const fm = extractStructMembers(text);
        const msg = fm['faultString'] || '';
        if (msg.includes('not found') || msg.includes('undefined')) continue;
        return { success: false, message: msg };
      }
      return { success: true, message: 'User deleted.' };
    } catch { continue; }
  }
  return { success: false, message: 'User delete API not available on this Sippy instance.' };
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export interface SippyStats {
  totalCalls: number;
  activeCalls: number;
  successRate: number;
  totalMinutes: number;
}

// ── Rate / Account Push ───────────────────────────────────────────────────────

export interface SippyPushResult {
  success: boolean;
  message: string;
  detail?: string;
  method?: string;
  // Returned by createAccount() on success (XML-RPC path — docs 107312)
  i_account?: number;         // i_account of created account
  username?: string;          // self-care login
  authname?: string;          // VoIP login
  web_password?: string;      // self-care portal password
  voip_password?: string;     // SIP / VoIP password
  vm_password?: string;       // voice mail PIN
  // True when account was created via portal sub-account form (not a real SIP account)
  portalSubcustomer?: boolean;
  // Count of extra auth rules added (additional IPs) after account creation
  extraAuthRules?: number;
}

function fmtSippyDate(d: Date): string {
  // Sippy expects ISO8601 or "YYYY-MM-DD HH:MM:SS" UTC
  return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}

/**
 * Look up a Sippy customer account by name or number and return its i_account + i_tariff.
 */
async function findSippyCustomer(
  apiUrl: string,
  username: string,
  password: string,
  accountName: string,
): Promise<{ i_account: string; i_tariff: string } | null> {
  const methods = ['customer.getAccountList', 'customer.listAccounts'];
  for (const method of methods) {
    try {
      const body = xmlRpcCall(method, { name: accountName, get_total: 0 });
      const resp = await sippyPost(apiUrl, body, username, password);
      if (resp.statusCode !== 200 || resp.body.includes('<fault>')) continue;
      const structs = extractAllTags(resp.body, 'struct');
      for (const s of structs) {
        const m = extractStructMembers(s);
        const name = m['name'] || m['username'] || m['account_name'] || '';
        if (name.toLowerCase() === accountName.toLowerCase() || name.startsWith(accountName)) {
          const i_account = m['i_account'] || m['account_id'] || '';
          const i_tariff  = m['i_tariff']  || m['tariff_id']  || '';
          if (i_account) return { i_account, i_tariff };
        }
      }
      // If only one result returned, use it
      if (structs.length > 0) {
        const m = extractStructMembers(structs[0]);
        const i_account = m['i_account'] || m['account_id'] || '';
        const i_tariff  = m['i_tariff']  || m['tariff_id']  || '';
        if (i_account) return { i_account, i_tariff };
      }
    } catch { continue; }
  }
  return null;
}

export async function pushRateToSippy(opts: {
  accountName: string;
  prefix: string;
  ratePerMin: number;
  effectiveFrom?: Date;
  effectiveTo?: Date;
  format?: 'full' | 'partial' | 'default';
}, credentials: { username: string; password: string }, targetUrl?: string): Promise<SippyPushResult> {
  const baseUrl = targetUrl ?? activeSession?.portalUrl;
  if (!baseUrl) return { success: false, message: 'Not connected to Sippy.' };

  const apiUrl  = `${sippyBase(baseUrl)}/xmlapi/xmlapi`;
    const effFrom = opts.effectiveFrom ? fmtSippyDate(opts.effectiveFrom) : fmtSippyDate(new Date());
  const lastErrors: string[] = [];

  // Step 1 — find the customer + their tariff ID
  const customer = await findSippyCustomer(apiUrl, credentials.username, credentials.password, opts.accountName);
  console.log(`[Sippy] pushRate customer lookup for "${opts.accountName}":`, customer);

  // Step 2a — if we have a tariff ID, call tariff.setRate with i_tariff
  if (customer?.i_tariff) {
    try {
      const body = xmlRpcCall('tariff.setRate', {
        i_tariff:    customer.i_tariff,
        destination: opts.prefix,
        rate:        opts.ratePerMin,
        start_date:  effFrom,
        ...(opts.effectiveTo ? { end_date: fmtSippyDate(opts.effectiveTo) } : {}),
      });
      const resp = await sippyPost(apiUrl, body, credentials.username, credentials.password);
      if (resp.statusCode === 200 && !resp.body.includes('<fault>')) {
        return { success: true, message: `Rate ${opts.prefix}=${opts.ratePerMin} pushed to Sippy tariff`, method: 'tariff.setRate' };
      }
      const fault = extractTag(resp.body, 'faultString') || 'tariff.setRate rejected';
      lastErrors.push(fault);
      console.warn('[Sippy] tariff.setRate (i_tariff):', fault);
    } catch (e: any) { lastErrors.push(e.message); }
  }

  // Step 2b — tariff.setRate with account i_account
  if (customer?.i_account) {
    try {
      const body = xmlRpcCall('tariff.setRate', {
        i_account:   customer.i_account,
        destination: opts.prefix,
        rate:        opts.ratePerMin,
        start_date:  effFrom,
        ...(opts.effectiveTo ? { end_date: fmtSippyDate(opts.effectiveTo) } : {}),
      });
      const resp = await sippyPost(apiUrl, body, credentials.username, credentials.password);
      if (resp.statusCode === 200 && !resp.body.includes('<fault>')) {
        return { success: true, message: `Rate ${opts.prefix}=${opts.ratePerMin} pushed to account tariff`, method: 'tariff.setRate(i_account)' };
      }
      const fault = extractTag(resp.body, 'faultString') || 'tariff.setRate(i_account) rejected';
      lastErrors.push(fault);
    } catch (e: any) { lastErrors.push(e.message); }
  }

  // Step 3 — tariff.addDestination (some Sippy versions)
  try {
    const params: Record<string, string | number> = {
      destination: opts.prefix,
      rate:        opts.ratePerMin,
      start_date:  effFrom,
    };
    if (customer?.i_tariff) params.i_tariff = customer.i_tariff;
    const body = xmlRpcCall('tariff.addDestination', params);
    const resp = await sippyPost(apiUrl, body, credentials.username, credentials.password);
    if (resp.statusCode === 200 && !resp.body.includes('<fault>')) {
      return { success: true, message: `Destination ${opts.prefix} added via tariff.addDestination`, method: 'tariff.addDestination' };
    }
    const fault = extractTag(resp.body, 'faultString') || 'tariff.addDestination rejected';
    lastErrors.push(fault);
  } catch (e: any) { lastErrors.push(e.message); }

  // Step 4 — customer.updateAccount with flat rate
  if (customer?.i_account) {
    try {
      const body = xmlRpcCall('customer.updateAccount', {
        i_account: customer.i_account,
        ...(opts.ratePerMin !== undefined ? { rate: opts.ratePerMin } : {}),
      });
      const resp = await sippyPost(apiUrl, body, credentials.username, credentials.password);
      if (resp.statusCode === 200 && !resp.body.includes('<fault>')) {
        return { success: true, message: `Account rate updated via customer.updateAccount`, method: 'customer.updateAccount' };
      }
      const fault = extractTag(resp.body, 'faultString') || 'customer.updateAccount rejected';
      lastErrors.push(fault);
    } catch (e: any) { lastErrors.push(e.message); }
  }

  const reason = lastErrors.length > 0 ? lastErrors[0] : 'No compatible Sippy rate API found.';
  console.error(`[Sippy] pushRateToSippy ALL attempts failed for "${opts.accountName}". Errors:`, lastErrors);
  return {
    success: false,
    message: reason,
    detail: lastErrors.slice(1).join(' | ') || 'Check Sippy API permissions and account configuration.',
  };
}

/**
 * Codec IDs as documented in the Sippy createAccount() API (docs 107312).
 * null = Disabled (no preference), 0 = G.711u (PCMU), 8 = G.711a (PCMA), etc.
 */
export const SIPPY_CODECS: Array<{ id: number | null; label: string }> = [
  { id: null, label: 'Disabled (no preference)' },
  { id: 0,    label: 'G.711u (PCMU)' },
  { id: 8,    label: 'G.711a (PCMA)' },
  { id: 3,    label: 'GSM' },
  { id: 18,   label: 'G.729' },
  { id: 9,    label: 'G.722' },
  { id: 4,    label: 'G.723' },
  { id: 15,   label: 'G.728' },
];

export interface SippyAccountOpts {
  name: string;               // Display / company name
  type: 'client' | 'vendor';
  // SIP credentials
  username?: string;          // Self-care login (web portal). Auto-derived from name if omitted.
  authname?: string;          // VoIP login / SIP username. Defaults to username.
  voipPassword?: string;      // SIP password. Auto-generated if omitted.
  webPassword?: string;       // Self-care portal password. Auto-generated if omitted.
  // Network
  ipAddress?: string;
  ratePerMin?: number;
  // Basic
  timezone?: string;          // i_time_zone integer ID. Defaults to 1 (UTC).
  language?: string;          // Two-char code, e.g. "en". Defaults to "en".
  routingGroup?: string;      // i_routing_group integer ID.
  iCustomer?: number;         // i_customer (1 = root customer for ssp-root admin context)
  iAccountClass?: number;     // i_account_class. Optional (from v1.10).
  // Rating & Billing
  servicePlan?: string;       // i_billing_plan integer ID (required, >= Sippy v1.8).
  creditLimit?: number;       // credit_limit double. Defaults to 0.
  balance?: number;           // Starting balance. Defaults to 0.
  lifetime?: number;          // -1 = unlimited (default), 0+ = days until expiry.
  iCommissionAgent?: number;  // i_commission_agent — i_customer of commission agent.
  commissionSize?: number;    // commission_size in percent.
  invoicingEnabled?: boolean; // invoicing_enabled (from v2.0).
  iInvoiceTemplate?: number;  // i_invoice_template (from v2.0).
  // Advanced
  maxSessions?: number;       // max_sessions. Defaults to 0 (unlimited).
  maxCallsPerSecond?: number; // max_calls_per_second. Optional.
  maxSessionTime?: number;    // max_credit_time seconds. Defaults to 3600.
  cldTranslationRule?: string;
  cliTranslationRule?: string;
  lanAccess?: boolean;        // lan_access. Optional.
  batchTag?: string;          // batch_tag. Optional.
  // Voicemail
  vmEnabled?: number;         // vm_enabled. 0 = disabled (default), 1 = enabled.
  vmPassword?: string;        // vm_password PIN code (digits only).
  vmTimeout?: number;         // vm_timeout seconds (from v2.0).
  vmCheckNumber?: string;     // vm_check_number — access # to VM (from v2.0).
  vmNotifyEmails?: string;    // vm_notify_emails.
  vmForwardEmails?: string;   // vm_forward_emails.
  vmDelAfterFwd?: boolean;    // vm_del_after_fwd.
  vmDialinAccess?: boolean;   // vm_dialin_access — enable external VM access (from v2.1).
  // Provisioning
  iProvisioning?: number | null; // i_provisioning: null=Disabled, 1=Linksys (from v2.0).
  // Caller name
  iCallerNameType?: number;   // 1=pass-through, 2=account name, 3=custom, 4=CLI (from v2.0).
  callerName?: string;        // Custom caller name (from v2.0, when iCallerNameType=3).
  // SIP behaviour
  preferredCodec?: number | null; // null=Disabled, 0=G.711u, 3=GSM, 4=G.723, 8=G.711a, 9=G.722, 15=G.728, 18=G.729.
  usePreferredCodecOnly?: boolean; // use_preferred_codec_only.
  regAllowed?: number;            // 1 = allow registration (default), 0 = deny.
  trustCli?: number;              // 0 = no (default), 1 = yes.
  disallowLoops?: boolean;        // disallow_loops.
  hideOwnCli?: boolean;           // hide_own_cli — anonymous outgoing calls (from v2.1).
  blockIncomingAnonymous?: boolean; // block_incoming_anonymous (from v2.1).
  iIncomingAnonymousAction?: number; // 1=Reject, 2=Play+Reject, 3=VM (from v2.1).
  dndEnabled?: boolean;           // dnd_enabled (from v2.1).
  followmeEnabled?: boolean;      // followme_enabled — call forwarding (from v2.1).
  passPAssertedId?: boolean;      // pass_p_asserted_id (from v2.2).
  pAssrtIdTranslationRule?: string; // p_assrt_id_translation_rule (from v2.2).
  trustPrivacyHdrs?: boolean;     // trust_privacy_hdrs (from v2021).
  privacySchemas?: string[];      // privacy_schemas array e.g. ['pai','rpid'] (from v2021).
  dncLookup?: boolean;            // dncl_lookup — DNC list lookup (from v4.3).
  generateRingbacktone?: boolean; // generate_ringbacktone (from v4.4).
  allowFreeOnnetCalls?: boolean;  // allow_free_onnet_calls (from v5.1).
  startPage?: number;             // 1=Calls History, 4=My Preferences (from v5.2).
  // Contact / Address
  companyName?: string;
  salutation?: string;
  firstName?: string;
  lastName?: string;
  midInit?: string;
  streetAddr?: string;
  state?: string;
  postalCode?: string;
  city?: string;
  email?: string;
  country?: string;
  contact?: string;
  phone?: string;
  fax?: string;
  altPhone?: string;
  altContact?: string;
  cc?: string;
  bcc?: string;
  description?: string;
  // Billing / Payment
  currency?: string;         // payment_currency ISO code e.g. 'USD'. Defaults to 'USD'.
  paymentMethod?: number;    // payment_method. Defaults to 1 (credit card).
  iExportType?: number;      // i_export_type (download format). Defaults to 2.
  iPasswordPolicy?: number;  // i_password_policy. Defaults to 1.
  iMediaRelayType?: number;  // i_media_relay_type. Defaults to 0.
  minPaymentAmount?: number; // min_payment_amount. Defaults to 0.
  onPaymentAction?: number | null; // null=No Action, 0=Extend Lifetime, 1=Clear First Use, 2=Restart Billing.
}

export async function pushAccountToSippy(
  opts: SippyAccountOpts,
  credentials: { username: string; password: string },
  targetUrl?: string,
): Promise<SippyPushResult> {
  const baseUrl = targetUrl ?? activeSession?.portalUrl;
  if (!baseUrl) return { success: false, message: 'Not connected to Sippy — configure and connect your Sippy switch first.' };

  const session = activeSession;
  const apiUrl = `${sippyBase(baseUrl)}/xmlapi/xmlapi`;
  const isVendor = opts.type === 'vendor';

  // ── Derive auto-values ────────────────────────────────────────────────────
  const safeName   = opts.name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const username   = opts.username   || safeName;
  const authname   = opts.authname   || username;
  const webPass    = opts.webPassword  || (safeName + '@' + Math.random().toString(36).slice(2, 8));
  const voipPass   = opts.voipPassword || Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6).toUpperCase();
  // Contact name: caller-supplied first/last name override the auto-derived parts
  const nameParts   = opts.name.trim().split(/\s+/);
  const firstName   = opts.firstName ?? (nameParts[0] ?? opts.name);
  const lastName    = opts.lastName  ?? (nameParts.slice(1).join(' '));

  // preferred_codec: per docs, null = "Disabled" (no preference).
  // If caller passes a number (0=G.711u, 8=G.711a, 18=G.729, etc.) use it directly.
  // We use 'undefined' as sentinel for "not set by caller" so we default to null.
  const codecValue: number | null =
    opts.preferredCodec !== undefined ? opts.preferredCodec : null;

  // ── Build parameter set per official Sippy API docs ──────────────────────
  // createAccount() docs: https://support.sippysoft.com/support/solutions/articles/107312
  // All "Required" fields are provided with safe defaults when not supplied by caller.
  const params: Record<string, string | number | boolean | null> = {
    // SIP / self-care credentials
    username,
    web_password:             webPass,
    authname,
    voip_password:            voipPass,
    // ── Required fields (with sensible defaults) ────────────────────────────
    max_sessions:             opts.maxSessions         ?? 0,     // 0 = unlimited
    max_credit_time:          opts.maxSessionTime       ?? 3600,  // max per-call secs (0/-1 rejected)
    translation_rule:         opts.cldTranslationRule   ?? '',
    cli_translation_rule:     opts.cliTranslationRule   ?? '',
    credit_limit:             opts.creditLimit          ?? 0,
    i_time_zone:              opts.timezone ? (Number(opts.timezone) || 1) : 1,
    balance:                  opts.balance              ?? 0,
    cpe_number:               '',
    vm_enabled:               opts.vmEnabled            ?? 0,
    vm_password:              opts.vmPassword           ?? Math.floor(Math.random() * 90000 + 10000).toString(),
    blocked:                  0,
    i_lang:                   opts.language             ?? 'en',
    payment_currency:         opts.currency             ?? 'USD',
    payment_method:           opts.paymentMethod        ?? 1,    // 1 = Credit card
    i_export_type:            opts.iExportType          ?? 2,    // 2 = Retail
    lifetime:                 opts.lifetime             ?? -1,   // -1 = unlimited
    // preferred_codec: null = "Disabled" per official docs (107312)
    preferred_codec:          codecValue,
    use_preferred_codec_only: opts.usePreferredCodecOnly ? 1 : 0,
    reg_allowed:              opts.regAllowed            ?? 1,
    welcome_call_ivr:         0,     // 0 = disabled (must NOT be null/<nil/> — crashes server)
    on_payment_action:        0,     // 0 = no action (must be 0 integer, not null)
    min_payment_amount:       opts.minPaymentAmount     ?? 0.0,
    trust_cli:                opts.trustCli             ?? 0,
    disallow_loops:           opts.disallowLoops ? 1 : 0,
    vm_notify_emails:         opts.vmNotifyEmails       ?? '',
    vm_forward_emails:        opts.vmForwardEmails      ?? '',
    vm_del_after_fwd:         opts.vmDelAfterFwd ? 1 : 0,
    // ── Contact / Address ─────────────────────────────────────────────────
    company_name:             opts.companyName   ?? '',
    salutation:               opts.salutation    ?? '',
    first_name:               firstName,
    last_name:                lastName,
    mid_init:                 opts.midInit       ?? '',
    street_addr:              opts.streetAddr    ?? '',
    state:                    opts.state         ?? '',
    postal_code:              opts.postalCode    ?? '',
    city:                     opts.city          ?? '',
    country:                  opts.country       ?? '',
    contact:                  opts.contact       ?? '',
    phone:                    opts.phone         ?? '',
    fax:                      opts.fax           ?? '',
    alt_phone:                opts.altPhone      ?? '',
    alt_contact:              opts.altContact    ?? '',
    email:                    opts.email         ?? '',
    cc:                       opts.cc            ?? '',
    bcc:                      opts.bcc           ?? '',
    i_password_policy:        opts.iPasswordPolicy     ?? 1,    // 1 = Default policy
    i_media_relay_type:       opts.iMediaRelayType     ?? 0,
  };

  // ── Routing group (required for root-customer accounts) ─────────────────
  // If caller did not supply a routing group, auto-fetch the first available one.
  if (opts.routingGroup) {
    const rg = parseInt(opts.routingGroup, 10);
    if (!isNaN(rg)) params.i_routing_group = rg;
  } else {
    // Auto-fetch via listRoutingGroups (confirmed working on this Sippy version)
    try {
      const rgBody = xmlRpcCall('listRoutingGroups', {});
      const rgResp = await sippyPost(apiUrl, rgBody, credentials.username, credentials.password);
      if (rgResp.statusCode === 200 && !rgResp.body.includes('<fault>')) {
        const firstId = rgResp.body.match(/<name>i_routing_group<\/name>\s*<value><int>(\d+)/)?.[1];
        if (firstId) {
          params.i_routing_group = parseInt(firstId, 10);
          console.log(`[Sippy] Auto-selected routing group: ${params.i_routing_group}`);
        }
      }
    } catch (e) {
      console.warn('[Sippy] Could not auto-fetch routing groups:', e);
    }
  }

  // ── Customer context (required for admin/root credentials) ──────────────
  // ssp-root must specify i_customer=1 (root customer) when creating accounts.
  // Confirmed required: createAccount returns fault 501 "Fatal error" without it.
  params.i_customer = opts.iCustomer ?? 1;

  // ── Billing plan (i_billing_plan required since Sippy v1.8) ─────────────
  if (opts.servicePlan) {
    const sp = parseInt(opts.servicePlan, 10);
    if (!isNaN(sp)) params.i_billing_plan = sp;
  }
  // Default to plan 1 (confirmed valid on this Sippy instance) if not specified;
  // will be overridden by auto-probe if plan 1 is rejected.
  if (!params.i_billing_plan) {
    params.i_billing_plan = 1;
  }

  // ── Optional extras (all from official docs 107312) ──────────────────────
  // Session / traffic
  if (opts.maxCallsPerSecond !== undefined) params.max_calls_per_second  = opts.maxCallsPerSecond;
  // Classification
  if (opts.iAccountClass     !== undefined) params.i_account_class       = opts.iAccountClass;
  // Commission
  if (opts.iCommissionAgent  !== undefined) params.i_commission_agent    = opts.iCommissionAgent;
  if (opts.commissionSize    !== undefined) params.commission_size        = opts.commissionSize;
  // LAN / batching
  if (opts.lanAccess         !== undefined) params.lan_access             = opts.lanAccess;
  if (opts.batchTag                       ) params.batch_tag              = opts.batchTag;
  // Voicemail extensions (v2.0)
  if (opts.vmTimeout         !== undefined) params.vm_timeout             = opts.vmTimeout;
  if (opts.vmCheckNumber                  ) params.vm_check_number        = opts.vmCheckNumber;
  if (opts.vmDialinAccess    !== undefined) params.vm_dialin_access       = opts.vmDialinAccess;
  // Provisioning (v2.0)
  if (opts.iProvisioning     !== undefined) params.i_provisioning         = opts.iProvisioning;
  // Invoicing (v2.0)
  if (opts.invoicingEnabled  !== undefined) params.invoicing_enabled      = opts.invoicingEnabled;
  if (opts.iInvoiceTemplate  !== undefined) params.i_invoice_template     = opts.iInvoiceTemplate;
  // Caller name (v2.0)
  if (opts.iCallerNameType   !== undefined) params.i_caller_name_type     = opts.iCallerNameType;
  if (opts.callerName                     ) params.caller_name            = opts.callerName;
  // Call behaviour (v2.1)
  if (opts.followmeEnabled   !== undefined) params.followme_enabled       = opts.followmeEnabled;
  if (opts.hideOwnCli        !== undefined) params.hide_own_cli           = opts.hideOwnCli;
  if (opts.blockIncomingAnonymous !== undefined) params.block_incoming_anonymous = opts.blockIncomingAnonymous;
  if (opts.iIncomingAnonymousAction !== undefined) params.i_incoming_anonymous_action = opts.iIncomingAnonymousAction;
  if (opts.dndEnabled        !== undefined) params.dnd_enabled            = opts.dndEnabled;
  // Privacy / identity (v2.2 and v2021)
  if (opts.passPAssertedId   !== undefined) params.pass_p_asserted_id     = opts.passPAssertedId;
  if (opts.pAssrtIdTranslationRule        ) params.p_assrt_id_translation_rule = opts.pAssrtIdTranslationRule;
  if (opts.trustPrivacyHdrs  !== undefined) params.trust_privacy_hdrs     = opts.trustPrivacyHdrs;
  if (opts.privacySchemas                 ) params.privacy_schemas         = opts.privacySchemas;
  // Telephony features (v4.3 / v4.4 / v5.1 / v5.2)
  if (opts.dncLookup         !== undefined) params.dncl_lookup            = opts.dncLookup;
  if (opts.generateRingbacktone !== undefined) params.generate_ringbacktone = opts.generateRingbacktone;
  if (opts.allowFreeOnnetCalls !== undefined) params.allow_free_onnet_calls = opts.allowFreeOnnetCalls;
  if (opts.startPage         !== undefined) params.start_page             = opts.startPage;
  // General
  if (opts.description                    ) params.description            = opts.description;

  // ── Attempt list ─────────────────────────────────────────────────────────
  // createAccount() — official Sippy API (docs 107312). Creates an account under
  // the authenticated customer. Does NOT require admin credentials.
  // For vendors, createVendor() requires admin; listed as fallback.
  const attempts: Array<{ method: string; body: string }> = isVendor
    ? [
        { method: 'createVendor', body: xmlRpcCall('createVendor', { name: opts.name, web_login: username, web_password: webPass, i_time_zone: Number(opts.timezone) || 1 }) },
        { method: 'addVendor',    body: xmlRpcCall('addVendor',    { name: opts.name, web_login: username, web_password: webPass }) },
      ]
    : [
        { method: 'createAccount', body: xmlRpcCall('createAccount', params) },  // official — works with customer session
      ];

  let lastFault = '';
  let billingPlanAutoFetched = false;

  console.log(`[Sippy] pushAccountToSippy → url: ${apiUrl}, type: ${opts.type}, params:`, JSON.stringify(params));

  const extractValue = (xml: string, fieldName: string): string | undefined => {
    const memberRe = new RegExp(`<name>${fieldName}</name>\\s*<value>[^<]*(?:<[a-z]+>)?([^<]*)<`, 'i');
    const m = xml.match(memberRe);
    return m?.[1]?.trim() || undefined;
  };

  for (const { method, body: initialBody } of attempts) {
    let body = initialBody;
    try {
      console.log(`[Sippy] Trying ${method}:\n${body}`);
      const resp = await sippyPost(apiUrl, body, credentials.username, credentials.password);
      const text = resp.body;
      console.log(`[Sippy] ${method} → HTTP ${resp.statusCode}, body: ${text.slice(0, 600)}`);

      if (resp.statusCode === 200 && !text.includes('<fault>') && !text.includes('faultCode') && !text.includes('faultString')) {
        console.log(`[Sippy] ${method} succeeded for "${opts.name}"`);
        const retUsername    = extractValue(text, 'username');
        const retAuthname    = extractValue(text, 'authname');
        const retWebPassword = extractValue(text, 'web_password');
        const retVoipPass    = extractValue(text, 'voip_password');
        const retVmPass      = extractValue(text, 'vm_password');
        const retIAccountStr = extractValue(text, 'i_account');
        const retIAccount    = retIAccountStr ? parseInt(retIAccountStr, 10) : undefined;
        return {
          success: true,
          message: `Account "${opts.name}" created successfully on Sippy.${retIAccount ? ` (ID: ${retIAccount})` : ''}`,
          method,
          i_account:     retIAccount,
          username:      retUsername,
          authname:      retAuthname,
          web_password:  retWebPassword,
          voip_password: retVoipPass,
          vm_password:   retVmPass,
        };
      }

      // Extract Sippy fault string from XML-RPC fault response.
      // Fault is a struct with <name>faultString</name><value><string>...</string></value>
      // NOT a direct <faultString> element — extractTag won't find it.
      const faultStrRaw = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
        ?? extractTag(text, 'faultString');  // fallback for other formats
      const faultStr = faultStrRaw ?? null;
      if (faultStr) {
        lastFault = faultStr.replace(/<[^>]+>/g, '').trim();
        console.warn(`[Sippy] ${method} fault: ${lastFault}`);

        // Auto-fetch billing plan if "i_billing_plan is required" and we haven't tried yet
        if (!billingPlanAutoFetched && lastFault.toLowerCase().includes('i_billing_plan') && !params.i_billing_plan) {
          billingPlanAutoFetched = true;
          console.log('[Sippy] Auto-fetching billing plans to satisfy i_billing_plan requirement...');
          const bpResult = await listSippyBillingPlans(credentials.username, credentials.password, baseUrl);
          if (bpResult.plans.length > 0) {
            const firstPlan = bpResult.plans[0];
            console.log(`[Sippy] Using auto-fetched billing plan: ${firstPlan.id} "${firstPlan.name}"`);
            params.i_billing_plan = firstPlan.id;
            body = xmlRpcCall(method, params);
            const resp2 = await sippyPost(apiUrl, body, credentials.username, credentials.password);
            const text2 = resp2.body;
            console.log(`[Sippy] ${method} retry → HTTP ${resp2.statusCode}, body: ${text2.slice(0, 400)}`);
            if (resp2.statusCode === 200 && !text2.includes('<fault>') && !text2.includes('faultCode')) {
              const retUsername    = extractValue(text2, 'username');
              const retAuthname    = extractValue(text2, 'authname');
              const retWebPassword = extractValue(text2, 'web_password');
              const retVoipPass    = extractValue(text2, 'voip_password');
              const retVmPass2     = extractValue(text2, 'vm_password');
              const retIAccountStr2 = extractValue(text2, 'i_account');
              const retIAccount2   = retIAccountStr2 ? parseInt(retIAccountStr2, 10) : undefined;
              return {
                success: true,
                message: `Account "${opts.name}" created on Sippy (billing plan auto-selected: "${firstPlan.name}").${retIAccount2 ? ` (ID: ${retIAccount2})` : ''}`,
                method,
                i_account:     retIAccount2,
                username:      retUsername,
                authname:      retAuthname,
                web_password:  retWebPassword,
                voip_password: retVoipPass,
                vm_password:   retVmPass2,
              };
            }
            const fs2 = extractTag(text2, 'faultString');
            if (fs2) lastFault = fs2.replace(/<[^>]+>/g, '').trim();
          } else {
            // Billing plan list API not available on this Sippy version — probe IDs 1→5
            console.log('[Sippy] Billing plan list API unavailable — probing plan IDs 1-5...');
            let foundPlan: number | null = null;
            for (const probeId of [1, 2, 3, 4, 5]) {
              params.i_billing_plan = probeId;
              const probeBody = xmlRpcCall(method, params);
              const probeResp = await sippyPost(apiUrl, probeBody, credentials.username, credentials.password);
              const probeText = probeResp.body;
              const probeFault = extractTag(probeText, 'faultString');
              const probeFaultStr = probeFault?.replace(/<[^>]+>/g, '').trim() ?? '';
              console.log(`[Sippy] Plan probe ${probeId}: HTTP ${probeResp.statusCode}, fault="${probeFaultStr.slice(0, 80)}"`);
              if (probeResp.statusCode === 200 && !probeText.includes('<fault>') && !probeText.includes('faultCode')) {
                // Success with this plan!
                const retUsername    = extractValue(probeText, 'username');
                const retAuthname    = extractValue(probeText, 'authname');
                const retWebPassword = extractValue(probeText, 'web_password');
                const retVoipPass    = extractValue(probeText, 'voip_password');
                const retIAccount    = extractValue(probeText, 'i_account');
                return {
                  success: true,
                  message: `Account "${opts.name}" created on Sippy (billing plan auto-probed: ID ${probeId}).${retIAccount ? ` (ID: ${retIAccount})` : ''}`,
                  method,
                  username:      retUsername,
                  authname:      retAuthname,
                  web_password:  retWebPassword,
                  voip_password: retVoipPass,
                };
              }
              if (probeFaultStr && !probeFaultStr.toLowerCase().includes('billing_plan') && !probeFaultStr.toLowerCase().includes('billing plan')) {
                // Got a different kind of fault — plan ID might be valid, but other error
                foundPlan = probeId;
                lastFault = probeFaultStr;
                break;
              }
              // billing_plan-related fault → try next ID
            }
            if (!foundPlan) {
              return {
                success: false,
                message: 'Could not create account: a Service Plan (Billing Plan) is required by your Sippy switch, and none were found (IDs 1-5 tried).',
                detail: `Log in to your Sippy admin portal → Billing → Service Plans, create at least one plan, then specify its ID in the Service Plan field when creating the account.`,
              };
            }
          }
        }

        // A meaningful fault means the method name is correct — stop trying other formats
        if (!lastFault.toLowerCase().includes('no such method') && !lastFault.toLowerCase().includes('unknown method')) {
          break;
        }
      } else {
        console.warn(`[Sippy] ${method} non-fault failure: HTTP ${resp.statusCode}`);
        if (resp.statusCode === 401) { lastFault = 'Authentication failed — check Sippy username and password.'; break; }
        if (resp.statusCode === 403) { lastFault = 'Access denied — check Sippy API permissions.'; break; }
        if (resp.statusCode === 500) { lastFault = `Sippy server error (HTTP 500) — the switch returned an internal error. Check that the billing plan ID is valid, or create Service Plans in Sippy portal first.`; break; }
      }
    } catch (e: any) {
      console.warn(`[Sippy] ${method} error:`, e.message);
      lastFault = e.message;
    }
  }

  // ── Portal fallback: if XML-RPC failed (e.g. 401 / no API access) ──────────
  // Try creating the account by submitting the Sippy web-portal form instead.
  const xmlFailed = !lastFault || lastFault.includes('Authentication failed') || lastFault.includes('Access denied') || lastFault.includes('401');
  if (session?.cookies && session.portalUrl) {
    console.log('[Sippy] XML-RPC failed — trying portal form fallback for account creation');
    const portalResult = await createAccountViaPortal(session.cookies, session.portalUrl, opts);
    if (portalResult.success) {
      return {
        success: true,
        message: portalResult.message,
        portalSubcustomer: portalResult.portalSubcustomer ?? true,
      };
    }
    // Portal gave us a real error message — surface it
    if (!portalResult.message.includes('not available')) {
      return { success: false, message: portalResult.message };
    }
  }

  const detail = lastFault
    ? lastFault
    : xmlFailed
      ? `Authentication failed. The Sippy XML-RPC API rejected credentials for "${credentials.username}". Verify the credentials in Settings or ask your Sippy administrator to enable API access for this account.`
      : `No response from Sippy at ${apiUrl} — check the URL in Settings.`;
  return { success: false, message: 'Could not create account on Sippy.', detail };
}

// ── Routing Groups & Tariffs ───────────────────────────────────────────────────

export interface SippyRoutingGroup {
  id: number;
  name: string;
}

export interface SippyTariffOption {
  id: number;
  name: string;
  currency?: string;
}

export interface SippyBillingPlan {
  id: number;
  name: string;
  currency?: string;
}

export async function listSippyBillingPlans(
  username: string,
  password: string,
  portalUrl?: string,
): Promise<{ plans: SippyBillingPlan[]; error?: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { plans: [], error: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  // Try all known billing plan listing methods across Sippy versions
  const methods = [
    'getBillingPlanList',           // newer Sippy API
    'getCustomerBillingPlanList',   // customer-scoped version
    'listBillingPlans',             // alternate name
    'billing_plan.getList',         // legacy
    'billing.getBillingPlanList',   // older builds
  ];

  for (const method of methods) {
    try {
      const body = xmlRpcCall(method, { limit: 500 });
      const resp = await sippyPost(apiUrl, body, username, password);
      if (resp.statusCode !== 200) continue;
      const text = resp.body;
      if (text.includes('faultCode')) {
        const fault = extractTag(text, 'faultString')?.replace(/<[^>]+>/g, '').trim() ?? '';
        if (fault.toLowerCase().includes('not found') || fault.toLowerCase().includes('unknown method')) continue;
        break;
      }
      const structs = extractAllTags(text, 'struct');
      if (structs.length === 0) return { plans: [] };
      const plans: SippyBillingPlan[] = [];
      for (const s of structs) {
        const m = extractStructMembers(s);
        const id = parseInt(m['i_billing_plan'] || m['id'] || '0', 10);
        const name = m['name'] || m['billing_plan_name'] || `Plan ${id}`;
        const currency = m['currency'] || undefined;
        if (id) plans.push({ id, name, ...(currency ? { currency } : {}) });
      }
      console.log(`[Sippy] listSippyBillingPlans: found ${plans.length} plans via ${method}`);
      return { plans };
    } catch { continue; }
  }
  return { plans: [], error: 'No billing plan list method found on this Sippy instance. Create Service Plans in your Sippy portal (Billing → Service Plans) first.' };
}

export async function listSippyRoutingGroups(
  username: string,
  password: string,
  portalUrl?: string,
): Promise<{ groups: SippyRoutingGroup[]; error?: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { groups: [], error: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  // Official method: listRoutingGroups() — confirmed working; also try legacy names
  const methods = [
    'listRoutingGroups',                       // confirmed working on Sippy ≤ 5.x
    'getRoutingGroupsList',                    // official (newer Sippy)
    'routing_group.getRoutingGroupList',       // legacy
    'routing_group.getList',                   // legacy variant
    'routing.getGroupList',                    // older builds
  ];
  for (const method of methods) {
    try {
      const body = xmlRpcCall(method);
      const resp = await sippyPost(apiUrl, body, username, password);
      if (resp.statusCode !== 200) continue;
      const text = resp.body;
      if (text.includes('faultCode')) continue;
      const structs = extractAllTags(text, 'struct');
      if (structs.length === 0) return { groups: [] };
      const groups: SippyRoutingGroup[] = [];
      for (const s of structs) {
        const m = extractStructMembers(s);
        const id = parseInt(m['i_routing_group'] || m['id'] || '0', 10);
        const name = m['name'] || m['routing_group_name'] || `Group ${id}`;
        if (id) groups.push({ id, name });
      }
      console.log(`[Sippy] listSippyRoutingGroups: found ${groups.length} groups via ${method}`);
      return { groups };
    } catch { continue; }
  }
  return { groups: [], error: 'Could not fetch routing groups from Sippy.' };
}

export async function listSippyTariffs(
  username: string,
  password: string,
  portalUrl?: string,
): Promise<{ tariffs: SippyTariffOption[]; error?: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { tariffs: [], error: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  // Official method: getTariffsList() (Sippy docs 3000098586, available since Sippy 2020)
  // Returns: tariffs array with i_tariff, name, currency, i_tariff_type
  // Fallback to legacy methods for older Sippy builds
  const methods = [
    'getTariffsList',           // official (since Sippy 2020)
    'tariff.getTariffList',     // legacy
    'tariff.getList',           // legacy variant
    'billing.getTariffList',    // older builds
  ];
  for (const method of methods) {
    try {
      const body = xmlRpcCall(method, { limit: 500 });
      const resp = await sippyPost(apiUrl, body, username, password);
      if (resp.statusCode !== 200) continue;
      const text = resp.body;
      if (text.includes('faultCode')) continue;
      const structs = extractAllTags(text, 'struct');
      if (structs.length === 0) return { tariffs: [] };
      const tariffs: SippyTariffOption[] = [];
      for (const s of structs) {
        const m = extractStructMembers(s);
        const id = parseInt(m['i_tariff'] || m['id'] || '0', 10);
        const name = m['name'] || m['tariff_name'] || `Tariff ${id}`;
        const currency: string | undefined = m['currency'] || m['i_currency'] || undefined;
        if (id) tariffs.push({ id, name, ...(currency ? { currency } : {}) });
      }
      console.log(`[Sippy] listSippyTariffs: found ${tariffs.length} tariffs via ${method}`);
      return { tariffs };
    } catch { continue; }
  }
  return { tariffs: [], error: 'Could not fetch tariffs from Sippy.' };
}

export async function getSippyStats(username: string, password: string, explicitPortalUrl?: string): Promise<SippyStats> {
  const base = explicitPortalUrl ? sippyBase(explicitPortalUrl) : activeSession?.portalUrl;
  if (!base) return { totalCalls: 0, activeCalls: 0, successRate: 0, totalMinutes: 0 };

  // ── Portal mode: derive stats from live active calls count ─────────────────
  const session = activeSession;
  if (session?.mode === 'portal' && session.cookies) {
    const liveCalls = await getPortalActiveCallsHtml(session.cookies, base);
    const activeCalls = liveCalls.length;
    const totalMinutes = liveCalls.reduce((sum, c) => sum + Math.round(c.duration / 60), 0);
    return { totalCalls: activeCalls, activeCalls, successRate: activeCalls > 0 ? 100 : 0, totalMinutes };
  }

  // ── XML-RPC mode ──────────────────────────────────────────────────────────
  const apiUrl = `${base}/xmlapi/xmlapi`;
  const body = xmlRpcCall('call_control.getCountersStats');

  try {
    const resp = await sippyPost(apiUrl, body, username, password);
    if (resp.statusCode !== 200) return { totalCalls: 0, activeCalls: 0, successRate: 0, totalMinutes: 0 };

    const m = extractStructMembers(resp.body);
    const total = parseInt(m['total'] || m['total_calls'] || '0') || 0;
    const answered = parseInt(m['answered'] || m['answered_calls'] || '0') || 0;
    const active = parseInt(m['active'] || m['active_calls'] || '0') || 0;
    const minutes = parseFloat(m['total_duration'] || m['minutes'] || '0') / 60 || 0;

    return {
      totalCalls: total,
      activeCalls: active,
      successRate: total > 0 ? Math.round((answered / total) * 100) : 0,
      totalMinutes: Math.round(minutes),
    };
  } catch {
    return { totalCalls: 0, activeCalls: 0, successRate: 0, totalMinutes: 0 };
  }
}

// ── getSippyDashboardMetrics — real-time stats from call_control.getCountersStats ──
// Returns activeCalls, ASR, ACD (secs), total/answered counts.
// Always requires explicitPortalUrl so it works without activeSession.
export interface SippyDashboardMetrics {
  activeCalls: number;
  totalCalls: number;
  answeredCalls: number;
  asr: number;       // percent 0-100
  acd: number;       // seconds
  totalMinutes: number;
  rawFields: Record<string, string>;
}

export async function getSippyDashboardMetrics(
  username: string,
  password: string,
  explicitPortalUrl: string,
): Promise<SippyDashboardMetrics> {
  const empty: SippyDashboardMetrics = { activeCalls: 0, totalCalls: 0, answeredCalls: 0, asr: 0, acd: 0, totalMinutes: 0, rawFields: {} };
  try {
    const base = sippyBase(explicitPortalUrl);
    const apiUrl = `${base}/xmlapi/xmlapi`;
    const resp = await sippyPost(apiUrl, xmlRpcCall('call_control.getCountersStats'), username, password);
    if (resp.statusCode !== 200) return empty;
    const m = extractStructMembers(resp.body);
    // Sippy may use different field names across versions
    const total    = parseInt(m['total']    || m['total_calls']    || m['calls_total']   || '0') || 0;
    const answered = parseInt(m['answered'] || m['answered_calls'] || m['calls_answered']|| '0') || 0;
    const active   = parseInt(m['active']   || m['active_calls']   || m['calls_active']  || '0') || 0;
    // total_duration may be in seconds; fall back to minutes * 60
    const durSecs  = parseFloat(m['total_duration'] || m['duration'] || '0') || 0;
    const minsFallback = parseFloat(m['minutes'] || '0') * 60;
    const totalSecs = durSecs || minsFallback;
    const asr = total > 0 ? Math.round((answered / total) * 100) : 0;
    const acd = answered > 0 ? Math.round(totalSecs / answered) : 0;
    return { activeCalls: active, totalCalls: total, answeredCalls: answered, asr, acd, totalMinutes: Math.round(totalSecs / 60), rawFields: m };
  } catch {
    return empty;
  }
}

// ── Rate Analysis ─────────────────────────────────────────────────────────────

export interface SippyCarrierEntry {
  id: string;
  name: string;
}

export interface SippyRateEntry {
  code: string;
  destination: string;
  clientDestination: string;
  rate: number;
  activeFrom: string;
  activeTill: string;
  country: string;
  isBlocked: boolean;
  isSpecial: boolean;
}

export interface RateAnalysisCarrierGroup {
  carrierName: string;
  country: string;
  totalDest: number;
  specialDest: number;
  blockDest: number;
  changeDest: number;
  totalCodes: number;
}

export interface RateAnalysisResult {
  carrierGroups: RateAnalysisCarrierGroup[];
  rates: SippyRateEntry[];
  error?: string;
}

export interface RateAnalysisParams {
  party?: 'client' | 'vendor';
  tariffId?: string;
  carrierIds?: string[];
  countries?: string[];
  operatorTypes?: string[];
  details?: string[];
  destination?: string;
  groupBy?: string;
  blockDest?: 'all' | 'block' | 'unblock';
  specialDest?: 'all' | 'lock' | 'unlock';
  ratesPeriod?: string;
  format?: 'default' | 'partial' | 'full';
}

export interface SippyTariffLegacy { id: string; name: string; type: string; }

export async function getSippyTariffList(username: string, password: string): Promise<SippyTariffLegacy[]> {
  if (!activeSession) return [];
  const apiUrl = `${activeSession.portalUrl}/xmlapi/xmlapi`;
  const methods = [
    ['tariff.getTariffList', { type: 'customer', get_total: 1 }],
    ['tariff.getTariffList', {}],
    ['customer.getTariffList', {}],
  ];
  for (const [method, params] of methods) {
    try {
      const body = xmlRpcCall(method as string, params as Record<string, any>);
      const resp = await sippyPost(apiUrl, body, username, password);
      if (resp.statusCode !== 200) continue;
      const text = resp.body.toString('utf-8');
      if (text.includes('faultCode')) continue;
      const structs = extractAllTags(text, 'struct');
      const tariffs: SippyTariffLegacy[] = [];
      for (const s of structs) {
        const m = extractStructMembers(s);
        const id = m['i_tariff'] || m['tariff_id'] || '';
        const name = m['name'] || m['tariff_name'] || '';
        if (!id && !name) continue;
        tariffs.push({ id, name, type: m['type_name'] || m['type'] || 'customer' });
      }
      if (tariffs.length > 0) return tariffs;
    } catch { continue; }
  }
  return [];
}

export async function getSippyCarrierList(username: string, password: string): Promise<SippyCarrierEntry[]> {
  if (!activeSession) return [];
  const apiUrl = `${activeSession.portalUrl}/xmlapi/xmlapi`;
  const methods = ['node.getNodeList', 'connection.getConnectionList', 'vendor.getVendorList'];
  for (const method of methods) {
    try {
      const body = xmlRpcCall(method, {});
      const resp = await sippyPost(apiUrl, body, username, password);
      if (resp.statusCode !== 200) continue;
      const text = resp.body.toString('utf-8');
      if (text.includes('faultCode')) continue;
      const structs = extractAllTags(text, 'struct');
      const carriers: SippyCarrierEntry[] = [];
      for (const s of structs) {
        const m = extractStructMembers(s);
        const id = m['i_node'] || m['i_connection'] || m['i_vendor'] || m['node_id'] || '';
        const name = m['name'] || m['node_name'] || m['vendor_name'] || m['connection_name'] || '';
        if (!name) continue;
        carriers.push({ id, name });
      }
      if (carriers.length > 0) return carriers;
    } catch { continue; }
  }
  return [];
}

export async function getSippyRateAnalysis(
  username: string,
  password: string,
  params: RateAnalysisParams,
): Promise<RateAnalysisResult> {
  if (!activeSession) return { carrierGroups: [], rates: [], error: 'Not connected to Sippy.' };
  if (!params.tariffId) return { carrierGroups: [], rates: [], error: 'No product (tariff) selected.' };

  const apiUrl = `${activeSession.portalUrl}/xmlapi/xmlapi`;
  const reqParams: Record<string, any> = { i_tariff: params.tariffId, get_total: 1 };
  if (params.destination) reqParams.destination = params.destination;

  const methods = ['tariff.getRateList', 'rate.getRateList'];
  for (const method of methods) {
    try {
      const body = xmlRpcCall(method, reqParams);
      const resp = await sippyPost(apiUrl, body, username, password);
      if (resp.statusCode !== 200) continue;
      const text = resp.body.toString('utf-8');
      if (text.includes('faultCode')) {
        const fm = extractStructMembers(text);
        const msg = fm['faultString'] || 'Sippy API error';
        if (msg.includes('undefined') || msg.includes('not found')) continue;
        return { carrierGroups: [], rates: [], error: msg };
      }

      const structs = extractAllTags(text, 'struct');
      const rates: SippyRateEntry[] = [];

      for (const s of structs) {
        const m = extractStructMembers(s);
        if (!m['i_dest'] && !m['destination'] && !m['rate']) continue;

        const country = m['destination_group_name'] || m['country_code'] || m['country'] || '';
        const isBlocked = m['blocked'] === '1' || m['is_blocked'] === '1';
        const isSpecial = m['is_special'] === '1' || m['special'] === '1';

        // Apply country filter
        if (params.countries && params.countries.length > 0) {
          const match = params.countries.some(c =>
            country.toLowerCase().includes(c.toLowerCase()) ||
            (m['destination'] || '').toLowerCase().includes(c.toLowerCase())
          );
          if (!match) continue;
        }
        // Apply block/special filters
        if (params.blockDest === 'block' && !isBlocked) continue;
        if (params.blockDest === 'unblock' && isBlocked) continue;
        if (params.specialDest === 'lock' && !isSpecial) continue;
        if (params.specialDest === 'unlock' && isSpecial) continue;

        rates.push({
          code: m['i_dest'] || m['dial_code'] || m['prefix'] || '-',
          destination: m['destination'] || m['destination_name'] || '-',
          clientDestination: m['client_destination'] || m['customer_destination'] || m['destination'] || '-',
          rate: parseFloat(m['rate'] || m['price'] || '0') || 0,
          activeFrom: m['effective_from'] || m['active_from'] || '-',
          activeTill: m['effective_till'] || m['active_till'] || 'None',
          country,
          isBlocked,
          isSpecial,
        });
      }

      // Group by country → carrier-style rows
      const countryMap = new Map<string, RateAnalysisCarrierGroup>();
      for (const r of rates) {
        const key = r.country || 'Unknown';
        if (!countryMap.has(key)) {
          countryMap.set(key, { carrierName: 'Quickcom', country: key, totalDest: 0, specialDest: 0, blockDest: 0, changeDest: 0, totalCodes: 0 });
        }
        const g = countryMap.get(key)!;
        g.totalDest++;
        if (r.isBlocked) g.blockDest++;
        if (r.isSpecial) g.specialDest++;
        g.totalCodes++;
      }

      return { carrierGroups: Array.from(countryMap.values()), rates };
    } catch { continue; }
  }
  return { carrierGroups: [], rates: [], error: 'Rate analysis API not available on this Sippy instance.' };
}

// ── Rate Editor CRUD ──────────────────────────────────────────────────────────

export interface RateEntry {
  prefix: string;
  destination: string;
  rate: number;
  effectiveFrom: string;
  effectiveTill: string;
}

export async function getSippyRateList(
  username: string,
  password: string,
  tariffId: string,
  portalUrl?: string,
): Promise<{ rates: RateEntry[]; error?: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { rates: [], error: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  // Official method: getTariffRatesList() (Sippy docs 3000118878, available since Sippy 2022)
  // Returns: i_rate, prefix, price_1, price_n, interval_1, interval_n,
  //          forbidden, grace_period_enable, activation_date, expiration_date
  // Fallback to older methods for pre-2022 builds
  const methods = [
    'getTariffRatesList',     // official (since Sippy 2022) — uses prefix, price_1, price_n
    'tariff.getRateList',     // legacy
    'rate.getRateList',       // legacy variant
    'tariff.getRates',        // older builds
  ];
  for (const method of methods) {
    try {
      const body = xmlRpcCall(method, { i_tariff: tariffId, limit: 1000, offset: 0 });
      const resp = await sippyPost(apiUrl, body, username, password);
      if (resp.statusCode !== 200 || resp.body.includes('<fault>')) continue;
      const structs = extractAllTags(resp.body, 'struct');
      const rates: RateEntry[] = [];
      for (const s of structs) {
        const m = extractStructMembers(s);
        // getTariffRatesList uses 'prefix'; legacy methods use 'destination'
        const prefix = m['prefix'] || m['destination'] || m['dial_code'] || m['i_dest'] || '';
        if (!prefix) continue;
        // getTariffRatesList uses price_1 for per-min rate
        const rate = parseFloat(m['price_1'] || m['rate'] || m['price'] || '0') || 0;
        rates.push({
          prefix,
          destination: m['destination_name'] || m['name'] || m['destination_description'] || prefix,
          rate,
          effectiveFrom: m['activation_date']  || m['effective_from'] || m['start_date'] || '',
          effectiveTill: m['expiration_date']  || m['effective_till'] || m['end_date']   || '',
        });
      }
      return { rates };
    } catch { continue; }
  }
  return { rates: [], error: 'Could not fetch rates from this Sippy instance.' };
}

export async function setSippyRateEntry(
  username: string,
  password: string,
  tariffId: string,
  entry: { prefix: string; rate: number; effectiveFrom?: string; effectiveTill?: string },
  portalUrl?: string,
): Promise<{ success: boolean; message: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;
  const lastErrors: string[] = [];

  // Sippy 2022+: uses prefix / price_1 / price_n / interval_1 / interval_n (<double> types)
  // Legacy:      uses destination / rate
  const r = entry.rate;
  const params: Record<string, string | number> = {
    i_tariff:   Number(tariffId),   // must be <int> not <string>
    prefix:     entry.prefix,       // Sippy 2022+ (getTariffRatesList uses 'prefix')
    price_1:    r,                  // per-min rate, float → <double>
    price_n:    r,                  // subsequent-min rate
    interval_1: 1,                  // 1-second first interval
    interval_n: 1,                  // 1-second subsequent interval
    destination: entry.prefix,      // legacy alias
    rate:        r,                 // legacy alias (<double> now fixed)
  };
  if (entry.effectiveFrom) { params.activation_date = entry.effectiveFrom; params.start_date = entry.effectiveFrom; }
  if (entry.effectiveTill) { params.expiration_date = entry.effectiveTill; params.end_date   = entry.effectiveTill; }

  // Probe all known + plausible method names — Sippy 2022+ and legacy
  for (const method of [
    // Sippy 2022+ naming pattern (matching getTariffRatesList / deleteAllRatesInTariff)
    'addRateToTariff', 'addRateInTariff', 'addRatesToTariff',
    'setRateInTariff', 'setRateToTariff', 'updateRateInTariff',
    // Original guesses — confirmed 404 but keeping for completeness
    'addRateTariff', 'tariff.setRate', 'tariff.addDestination', 'rate.setRate',
  ]) {
    try {
      const body = xmlRpcCall(method, params);
      const resp = await sippyPost(apiUrl, body, username, password);
      console.log(`[Sippy] setSippyRateEntry ${method}: HTTP ${resp.statusCode} body=${resp.body.substring(0, 300)}`);
      if (resp.statusCode === 200 && !resp.body.includes('<fault>')) {
        return { success: true, message: `Rate saved via ${method}` };
      }
      const faultStr = extractTag(resp.body, 'faultString');
      const faultCode = extractTag(resp.body, 'faultCode');
      const fault = faultStr ? `${method}: ${faultStr} (code ${faultCode})` : `${method} HTTP ${resp.statusCode}`;
      lastErrors.push(fault);
    } catch (e: any) { lastErrors.push(`${method} exception: ${e.message}`); }
  }
  return { success: false, message: lastErrors.join(' | ') || 'Could not save rate.' };
}

export async function deleteSippyRateEntry(
  username: string,
  password: string,
  tariffId: string,
  prefix: string,
  portalUrl?: string,
): Promise<{ success: boolean; message: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  // Official: deleteRateTariff() — also try legacy aliases
  for (const method of ['deleteRateTariff', 'tariff.deleteRate', 'tariff.deleteDestination', 'rate.deleteRate']) {
    try {
      const body = xmlRpcCall(method, { i_tariff: tariffId, destination: prefix });
      const resp = await sippyPost(apiUrl, body, username, password);
      if (resp.statusCode === 200 && !resp.body.includes('<fault>')) {
        return { success: true, message: `Rate deleted via ${method}` };
      }
    } catch { continue; }
  }
  return { success: false, message: 'Delete not supported by this Sippy instance. Rate removed locally.' };
}

// ── Customer Management (official Sippy docs 107417-107423) ──────────────────

export interface SippyCustomerEntry {
  iCustomer:    number;
  name:         string;
  webLogin:     string;
  description:  string;
  balance:      number;
  creditLimit:  number;
  baseCurrency: string;
}

export interface ListSippyCustomersResult {
  success:   boolean;
  customers: SippyCustomerEntry[];
  message:   string;
}

/**
 * Get list of customers belonging to the authenticated customer.
 * Official method: listCustomers() — docs 107423
 * Trusted mode: supply iWholesaler.
 * Returns: i_customer, name, web_login, description, balance, credit_limit, base_currency
 */
export async function listSippyCustomers(
  username: string,
  password: string,
  opts?: {
    offset?:      number;
    limit?:       number;
    iWholesaler?: number;
    portalUrl?:   string;
  },
): Promise<ListSippyCustomersResult> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, customers: [], message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, number> = {};
  if (opts?.offset      !== undefined) params.offset      = opts.offset;
  if (opts?.limit       !== undefined) params.limit       = opts.limit;
  if (opts?.iWholesaler !== undefined) params.i_wholesaler = opts.iWholesaler;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('listCustomers', params as any), username, password);
    const text = resp.body;

    if (resp.statusCode !== 200 || text.includes('<fault>')) {
      const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
        ?? extractTag(text, 'faultString') ?? 'listCustomers failed.';
      return { success: false, customers: [], message: fault };
    }

    // Extract the customers array of structs
    const arrMatch = /<name>customers<\/name>\s*<value>\s*<array>\s*<data>([\s\S]*?)<\/data>\s*<\/array>\s*<\/value>/.exec(text);
    const customers: SippyCustomerEntry[] = [];

    if (arrMatch) {
      const structs = parseArrayOfStructs(arrMatch[1]);
      for (const s of structs) {
        const iCustomer = parseInt(s.i_customer ?? '0', 10);
        if (!iCustomer) continue;
        customers.push({
          iCustomer,
          name:         s.name         ?? '',
          webLogin:     s.web_login    ?? '',
          description:  s.description  ?? '',
          balance:      parseFloat(s.balance      ?? '0'),
          creditLimit:  parseFloat(s.credit_limit ?? '0'),
          baseCurrency: s.base_currency ?? '',
        });
      }
    }

    return { success: true, customers, message: 'OK' };
  } catch (e: any) {
    return { success: false, customers: [], message: e.message };
  }
}

export interface SippyCustomerInfo {
  // Core identity
  iCustomer:            number;
  name:                 string;
  webLogin:             string;
  description:          string;
  // Balance (already inverted: negative-on-wire → positive here)
  balance:              number;
  creditLimit:          number;
  baseCurrency:         string;
  // Contact
  companyName:          string;
  salutation:           string;
  firstName:            string;
  lastName:             string;
  midInit:              string;
  streetAddr:           string;
  state:                string;
  postalCode:           string;
  city:                 string;
  country:              string;
  contact:              string;
  phone:                string;
  fax:                  string;
  altPhone:             string;
  altContact:           string;
  email:                string;
  cc:                   string;
  bcc:                  string;
  mailFrom:             string;
  // Routing
  iRoutingGroup:        number | null;
  iTariff:              number | null;
  // Permissions
  accountsMgmt:         number;
  customersMgmt:        number;
  systemMgmt:           number;
  tariffsMgmt:          number;
  vouchersMgmt:         number;
  apiAccess:            number;
  apiMgmt:              number;
  // Features
  maxDepth:             number | null;
  useOwnTariff:         number;
  callshopEnabled:      boolean;
  overcommitProtection: boolean;
  overcommitLimit:      number;
  didPoolEnabled:       boolean;
  ivrAppsEnabled:       boolean;
  asrAcdEnabled:        boolean;
  conferencingEnabled:  boolean;
  dnclEnabled:          boolean;
  // Locale / UI
  iTimeZone:            number | null;
  iLang:                string;
  iExportType:          number | null;
  startPage:            number | null;
  dnsAlias:             string;
  // Rate limits
  maxSessions:          number | null;   // null = unlimited
  maxCallsPerSecond:    number | null;   // null = unlimited
  // Commission
  iCommissionAgent:     number | null;
  commissionSize:       number;
  // Payment
  paymentCurrency:      string;
  paymentMethod:        number | null;
  minPaymentAmount:     number;
  // Status / misc
  iPasswordPolicy:      number | null;
  accountsMatchingRule: string;
  // Raw extra fields the switch may return
  [key: string]: unknown;
}

/**
 * Reset the one-time password for a customer or user's web-interface login.
 * Official method: resetCustomerOneTimePassword() — docs 107431
 * Authenticated admin can reset any customer's OTP, their subcustomers', or their users'.
 * The new OTP value is returned in the response so it can be communicated to the customer.
 */
export async function resetSippyCustomerOneTimePassword(
  username:  string,
  password:  string,
  webLogin:  string,
  opts?: { portalUrl?: string },
): Promise<{ success: boolean; password?: string; message: string }> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string> = { web_login: webLogin };

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('resetCustomerOneTimePassword', params), username, password);
    const text = resp.body;

    if (resp.statusCode !== 200 || text.includes('<fault>')) {
      const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
        ?? extractTag(text, 'faultString') ?? 'resetCustomerOneTimePassword failed.';
      return { success: false, message: fault };
    }

    const m = extractStructMembers(text);
    return {
      success:  m.result === 'OK',
      password: m.password ?? undefined,
      message:  m.result ?? 'Unknown',
    };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Authenticate a customer using their self-care portal credentials.
 * Official method: authCustomer() — docs 107430
 * Parameters: username + password (customer's web-login credentials, NOT admin credentials).
 * Returns: i_customer, i_web_user, i_access_level on success.
 * Special: error code 410 = authenticated via One Time Password.
 */
export async function authSippyCustomer(
  adminUsername: string,
  adminPassword: string,
  custUsername:  string,
  custPassword:  string,
  opts?: { portalUrl?: string },
): Promise<{
  success:      boolean;
  iCustomer?:   number;
  iWebUser?:    number;
  iAccessLevel?: string;
  oneTimePassword?: boolean;
  message:      string;
}> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string> = {
    username: custUsername,
    password: custPassword,
  };

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('authCustomer', params), adminUsername, adminPassword);
    const text = resp.body;

    // Error 410 = authenticated via One Time Password — treat as a special success
    const faultCode = extractTag(text, 'faultCode');
    if (faultCode === '410') {
      return { success: true, oneTimePassword: true, message: 'Authenticated via One Time Password.' };
    }

    if (resp.statusCode !== 200 || text.includes('<fault>')) {
      const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
        ?? extractTag(text, 'faultString') ?? 'authCustomer failed.';
      return { success: false, message: fault };
    }

    const m = extractStructMembers(text);
    return {
      success:       m.result === 'OK',
      iCustomer:     m.i_customer   ? parseInt(m.i_customer, 10)  : undefined,
      iWebUser:      m.i_web_user   ? parseInt(m.i_web_user, 10)  : undefined,
      iAccessLevel:  m.i_access_level ?? undefined,
      oneTimePassword: false,
      message:       m.result ?? 'Unknown',
    };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Retrieve all attributes of a customer.
 * Official method: getCustomerInfo() — docs 107426
 * Pass either iCustomer (int) OR name (string).
 * Trusted mode: supply iWholesaler.
 * IMPORTANT: balance is returned inverted by Sippy — this function corrects it.
 *   negative wire value → positive balance displayed
 *   positive wire value → negative balance displayed
 */
export async function getSippyCustomerInfo(
  username:  string,
  password:  string,
  lookup:    { iCustomer: number } | { name: string },
  opts?: {
    iWholesaler?: number;
    portalUrl?:   string;
  },
): Promise<{ success: boolean; customer?: SippyCustomerInfo; message: string }> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number> = {};
  if ('iCustomer' in lookup) params.i_customer = lookup.iCustomer;
  else                       params.name       = lookup.name;
  if (opts?.iWholesaler !== undefined) params.i_wholesaler = opts.iWholesaler;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('getCustomerInfo', params), username, password);
    const text = resp.body;

    if (resp.statusCode !== 200 || text.includes('<fault>')) {
      const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
        ?? extractTag(text, 'faultString') ?? 'getCustomerInfo failed.';
      return { success: false, message: fault };
    }

    // Extract the nested customer struct
    const custMatch = /<name>customer<\/name>\s*<value>\s*<struct>([\s\S]*?)<\/struct>\s*<\/value>/.exec(text);
    if (!custMatch) return { success: false, message: 'No customer struct in response.' };

    const m = extractStructMembers(custMatch[1]);

    // Balance: Sippy returns inverted — negative wire = positive balance
    const rawBalance = parseFloat(m.balance ?? '0');
    const balance    = -rawBalance;   // invert
    const creditLimit = parseFloat(m.credit_limit ?? '0');

    const customer: SippyCustomerInfo = {
      iCustomer:            parseInt(m.i_customer ?? '0', 10),
      name:                 m.name         ?? '',
      webLogin:             m.web_login    ?? '',
      description:          m.description  ?? '',
      balance,
      creditLimit,
      baseCurrency:         m.base_currency ?? '',
      // Contact
      companyName:          m.company_name  ?? '',
      salutation:           m.salutation    ?? '',
      firstName:            m.first_name    ?? '',
      lastName:             m.last_name     ?? '',
      midInit:              m.mid_init      ?? '',
      streetAddr:           m.street_addr   ?? '',
      state:                m.state         ?? '',
      postalCode:           m.postal_code   ?? '',
      city:                 m.city          ?? '',
      country:              m.country       ?? '',
      contact:              m.contact       ?? '',
      phone:                m.phone         ?? '',
      fax:                  m.fax           ?? '',
      altPhone:             m.alt_phone     ?? '',
      altContact:           m.alt_contact   ?? '',
      email:                m.email         ?? '',
      cc:                   m.cc            ?? '',
      bcc:                  m.bcc           ?? '',
      mailFrom:             m.mail_from     ?? '',
      // Routing
      iRoutingGroup:        m.i_routing_group ? parseInt(m.i_routing_group, 10) : null,
      iTariff:              m.i_tariff        ? parseInt(m.i_tariff, 10)         : null,
      // Permissions
      accountsMgmt:         parseInt(m.accounts_mgmt   ?? '0', 10),
      customersMgmt:        parseInt(m.customers_mgmt  ?? '0', 10),
      systemMgmt:           parseInt(m.system_mgmt     ?? '0', 10),
      tariffsMgmt:          parseInt(m.tariffs_mgmt    ?? '0', 10),
      vouchersMgmt:         parseInt(m.vouchers_mgmt   ?? '0', 10),
      apiAccess:            parseInt(m.api_access       ?? '0', 10),
      apiMgmt:              parseInt(m.api_mgmt         ?? '0', 10),
      // Features
      maxDepth:             m.max_depth               ? parseInt(m.max_depth, 10)    : null,
      useOwnTariff:         parseInt(m.use_own_tariff ?? '0', 10),
      callshopEnabled:      m.callshop_enabled         === '1' || m.callshop_enabled === 'true',
      overcommitProtection: m.overcommit_protection    === '1' || m.overcommit_protection === 'true',
      overcommitLimit:      parseFloat(m.overcommit_limit ?? '0'),
      didPoolEnabled:       m.did_pool_enabled         === '1' || m.did_pool_enabled === 'true',
      ivrAppsEnabled:       m.ivr_apps_enabled         === '1' || m.ivr_apps_enabled === 'true',
      asrAcdEnabled:        m.asr_acd_enabled          === '1' || m.asr_acd_enabled === 'true',
      conferencingEnabled:  m.conferencing_enabled     === '1' || m.conferencing_enabled === 'true',
      dnclEnabled:          m.dncl_enabled             === '1' || m.dncl_enabled === 'true',
      // Locale / UI
      iTimeZone:            m.i_time_zone   ? parseInt(m.i_time_zone, 10)    : null,
      iLang:                m.i_lang        ?? '',
      iExportType:          m.i_export_type ? parseInt(m.i_export_type, 10)  : null,
      startPage:            m.start_page    ? parseInt(m.start_page, 10)     : null,
      dnsAlias:             m.dns_alias     ?? '',
      // Rate limits — empty/nil → null (unlimited)
      maxSessions:          m.max_sessions        ? parseInt(m.max_sessions, 10)           : null,
      maxCallsPerSecond:    m.max_calls_per_second ? parseFloat(m.max_calls_per_second)    : null,
      // Commission
      iCommissionAgent:     m.i_commission_agent  ? parseInt(m.i_commission_agent, 10)    : null,
      commissionSize:       parseFloat(m.commission_size ?? '0'),
      // Payment
      paymentCurrency:      m.payment_currency    ?? '',
      paymentMethod:        m.payment_method      ? parseInt(m.payment_method, 10)        : null,
      minPaymentAmount:     parseFloat(m.min_payment_amount ?? '0'),
      // Misc
      iPasswordPolicy:      m.i_password_policy   ? parseInt(m.i_password_policy, 10)    : null,
      accountsMatchingRule: m.accounts_matching_rule ?? '',
    };

    return { success: true, customer, message: 'OK' };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export interface CreateCustomerOpts {
  // ── Mandatory ──────────────────────────────────────────────────────────────
  name:        string;        // unique customer name
  webPassword: string;        // self-care interface password
  iTariff:     number | null; // tariff ID; null = assign own tariff

  // ── Identity / Contact ─────────────────────────────────────────────────────
  webLogin?:         string;
  companyName?:      string;
  salutation?:       string;
  firstName?:        string;
  lastName?:         string;
  midInit?:          string;
  streetAddr?:       string;
  state?:            string;
  postalCode?:       string;
  city?:             string;
  country?:          string;
  contact?:          string;
  phone?:            string;
  fax?:              string;
  altPhone?:         string;
  altContact?:       string;
  email?:            string;
  cc?:               string;
  bcc?:              string;
  mailFrom?:         string;
  description?:      string;

  // ── Billing / Balance ──────────────────────────────────────────────────────
  balance?:             number;
  creditLimit?:         number;
  paymentCurrency?:     string;
  paymentMethod?:       number;
  minPaymentAmount?:    number;
  iCommissionAgent?:    number;  // i_customer of commission agent
  commissionSize?:      number;  // in percent

  // ── Routing ────────────────────────────────────────────────────────────────
  iRoutingGroup?:  number;

  // ── Permissions / Management bitmasks ─────────────────────────────────────
  accountsMgmt?:    number;   // bit 0=add, 1=edit, 2=delete
  customersMgmt?:   number;
  systemMgmt?:      number;
  tariffsMgmt?:     number;   // bit 0=add, 1=edit, 2=delete
  vouchersMgmt?:    number;
  apiAccess?:       number;   // 1 = XML-RPC API enabled
  apiPassword?:     string;
  apiMgmt?:         number;

  // ── Features ───────────────────────────────────────────────────────────────
  maxDepth?:               number;
  useOwnTariff?:           number;
  accountsMatchingRule?:   string;
  callshopEnabled?:        boolean;
  overcommitProtection?:   boolean;
  overcommitLimit?:        number;  // percent
  didPoolEnabled?:         boolean;
  ivrAppsEnabled?:         boolean;
  asrAcdEnabled?:          boolean;
  debitCreditCardsEnabled?: boolean;
  conferencingEnabled?:    boolean;
  sharePaymentProcessors?: boolean;
  dnclEnabled?:            boolean;

  // ── Locale / UI ────────────────────────────────────────────────────────────
  iTimeZone?:    number;   // timezone ID
  iLang?:        string;   // two-char code e.g. "en"
  iExportType?:  number;   // download format ID
  startPage?:    number;
  css?:          string;   // CSS stylesheet body for branding
  dnsAlias?:     string;

  // ── Rate limits ───────────────────────────────────────────────────────────
  maxSessions?:         number;  // nil = unlimited
  maxCallsPerSecond?:   number;  // nil = unlimited

  // ── Password policy ───────────────────────────────────────────────────────
  iPasswordPolicy?:  number;

  // ── Trusted mode ──────────────────────────────────────────────────────────
  iWholesaler?: number;
}

/**
 * Create a new customer on Sippy.
 * Official method: createCustomer() — docs 107417
 * Mandatory: name, webPassword, iTariff (null = own tariff).
 * Trusted mode: supply iWholesaler.
 */
export async function createCustomer(
  username:  string,
  password:  string,
  opts:      CreateCustomerOpts,
  portalUrl?: string,
): Promise<{ success: boolean; iCustomer?: number; message: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number | boolean | null> = {
    name:         opts.name,
    web_password: opts.webPassword,
    i_tariff:     opts.iTariff,
  };

  // Contact / Identity
  if (opts.webLogin        !== undefined) params.web_login          = opts.webLogin;
  if (opts.companyName     !== undefined) params.company_name       = opts.companyName;
  if (opts.salutation      !== undefined) params.salutation         = opts.salutation;
  if (opts.firstName       !== undefined) params.first_name         = opts.firstName;
  if (opts.lastName        !== undefined) params.last_name          = opts.lastName;
  if (opts.midInit         !== undefined) params.mid_init           = opts.midInit;
  if (opts.streetAddr      !== undefined) params.street_addr        = opts.streetAddr;
  if (opts.state           !== undefined) params.state              = opts.state;
  if (opts.postalCode      !== undefined) params.postal_code        = opts.postalCode;
  if (opts.city            !== undefined) params.city               = opts.city;
  if (opts.country         !== undefined) params.country            = opts.country;
  if (opts.contact         !== undefined) params.contact            = opts.contact;
  if (opts.phone           !== undefined) params.phone              = opts.phone;
  if (opts.fax             !== undefined) params.fax                = opts.fax;
  if (opts.altPhone        !== undefined) params.alt_phone          = opts.altPhone;
  if (opts.altContact      !== undefined) params.alt_contact        = opts.altContact;
  if (opts.email           !== undefined) params.email              = opts.email;
  if (opts.cc              !== undefined) params.cc                 = opts.cc;
  if (opts.bcc             !== undefined) params.bcc                = opts.bcc;
  if (opts.mailFrom        !== undefined) params.mail_from          = opts.mailFrom;
  if (opts.description     !== undefined) params.description        = opts.description;

  // Billing
  if (opts.balance             !== undefined) params.balance              = opts.balance;
  if (opts.creditLimit         !== undefined) params.credit_limit         = opts.creditLimit;
  if (opts.paymentCurrency     !== undefined) params.payment_currency     = opts.paymentCurrency;
  if (opts.paymentMethod       !== undefined) params.payment_method       = opts.paymentMethod;
  if (opts.minPaymentAmount    !== undefined) params.min_payment_amount   = opts.minPaymentAmount;
  if (opts.iCommissionAgent    !== undefined) params.i_commission_agent   = opts.iCommissionAgent;
  if (opts.commissionSize      !== undefined) params.commission_size      = opts.commissionSize;

  // Routing
  if (opts.iRoutingGroup !== undefined) params.i_routing_group = opts.iRoutingGroup;

  // Permissions
  if (opts.accountsMgmt    !== undefined) params.accounts_mgmt   = opts.accountsMgmt;
  if (opts.customersMgmt   !== undefined) params.customers_mgmt  = opts.customersMgmt;
  if (opts.systemMgmt      !== undefined) params.system_mgmt     = opts.systemMgmt;
  if (opts.tariffsMgmt     !== undefined) params.tariffs_mgmt    = opts.tariffsMgmt;
  if (opts.vouchersMgmt    !== undefined) params.vouchers_mgmt   = opts.vouchersMgmt;
  if (opts.apiAccess       !== undefined) params.api_access      = opts.apiAccess;
  if (opts.apiPassword     !== undefined) params.api_password    = opts.apiPassword;
  if (opts.apiMgmt         !== undefined) params.api_mgmt        = opts.apiMgmt;

  // Features
  if (opts.maxDepth               !== undefined) params.max_depth                = opts.maxDepth;
  if (opts.useOwnTariff           !== undefined) params.use_own_tariff           = opts.useOwnTariff;
  if (opts.accountsMatchingRule   !== undefined) params.accounts_matching_rule   = opts.accountsMatchingRule;
  if (opts.callshopEnabled        !== undefined) params.callshop_enabled         = opts.callshopEnabled;
  if (opts.overcommitProtection   !== undefined) params.overcommit_protection    = opts.overcommitProtection;
  if (opts.overcommitLimit        !== undefined) params.overcommit_limit         = opts.overcommitLimit;
  if (opts.didPoolEnabled         !== undefined) params.did_pool_enabled         = opts.didPoolEnabled;
  if (opts.ivrAppsEnabled         !== undefined) params.ivr_apps_enabled         = opts.ivrAppsEnabled;
  if (opts.asrAcdEnabled          !== undefined) params.asr_acd_enabled          = opts.asrAcdEnabled;
  if (opts.debitCreditCardsEnabled !== undefined) params.debit_credit_cards_enabled = opts.debitCreditCardsEnabled;
  if (opts.conferencingEnabled    !== undefined) params.conferencing_enabled     = opts.conferencingEnabled;
  if (opts.sharePaymentProcessors !== undefined) params.share_payment_processors = opts.sharePaymentProcessors;
  if (opts.dnclEnabled            !== undefined) params.dncl_enabled             = opts.dnclEnabled;

  // Locale / UI
  if (opts.iTimeZone   !== undefined) params.i_time_zone   = opts.iTimeZone;
  if (opts.iLang       !== undefined) params.i_lang         = opts.iLang;
  if (opts.iExportType !== undefined) params.i_export_type  = opts.iExportType;
  if (opts.startPage   !== undefined) params.start_page     = opts.startPage;
  if (opts.css         !== undefined) params.css            = opts.css;
  if (opts.dnsAlias    !== undefined) params.dns_alias      = opts.dnsAlias;

  // Rate limits
  if (opts.maxSessions       !== undefined) params.max_sessions         = opts.maxSessions;
  if (opts.maxCallsPerSecond !== undefined) params.max_calls_per_second = opts.maxCallsPerSecond;

  // Password policy
  if (opts.iPasswordPolicy !== undefined) params.i_password_policy = opts.iPasswordPolicy;

  // Trusted mode
  if (opts.iWholesaler !== undefined) params.i_wholesaler = opts.iWholesaler;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('createCustomer', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const iCustomerRaw = extractTag(text, 'i_customer');
      const iCustomer = iCustomerRaw ? parseInt(iCustomerRaw, 10) : undefined;
      return { success: true, iCustomer, message: 'Customer created successfully.' };
    }
    const fault = extractTag(text, 'faultString') ?? 'createCustomer failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Update a customer on Sippy.
 * Official method: updateCustomer() — docs 107419
 * Accepts any field from createCustomer() — all optional, at least one required.
 * Trusted mode: supply iWholesaler.
 */
export async function updateSippyCustomer(
  username:  string,
  password:  string,
  iCustomer: number,
  fields:    Partial<CreateCustomerOpts>,
  portalUrl?: string,
): Promise<{ success: boolean; message: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number | boolean | null> = { i_customer: iCustomer };

  // Mandatory-at-create but optional-at-update
  if (fields.name        !== undefined) params.name         = fields.name;
  if (fields.webPassword !== undefined) params.web_password = fields.webPassword;
  if (fields.iTariff     !== undefined) params.i_tariff     = fields.iTariff;

  // Contact / Identity
  if (fields.webLogin    !== undefined) params.web_login    = fields.webLogin;
  if (fields.companyName !== undefined) params.company_name = fields.companyName;
  if (fields.salutation  !== undefined) params.salutation   = fields.salutation;
  if (fields.firstName   !== undefined) params.first_name   = fields.firstName;
  if (fields.lastName    !== undefined) params.last_name    = fields.lastName;
  if (fields.midInit     !== undefined) params.mid_init     = fields.midInit;
  if (fields.streetAddr  !== undefined) params.street_addr  = fields.streetAddr;
  if (fields.state       !== undefined) params.state        = fields.state;
  if (fields.postalCode  !== undefined) params.postal_code  = fields.postalCode;
  if (fields.city        !== undefined) params.city         = fields.city;
  if (fields.country     !== undefined) params.country      = fields.country;
  if (fields.contact     !== undefined) params.contact      = fields.contact;
  if (fields.phone       !== undefined) params.phone        = fields.phone;
  if (fields.fax         !== undefined) params.fax          = fields.fax;
  if (fields.altPhone    !== undefined) params.alt_phone    = fields.altPhone;
  if (fields.altContact  !== undefined) params.alt_contact  = fields.altContact;
  if (fields.email       !== undefined) params.email        = fields.email;
  if (fields.cc          !== undefined) params.cc           = fields.cc;
  if (fields.bcc         !== undefined) params.bcc          = fields.bcc;
  if (fields.mailFrom    !== undefined) params.mail_from    = fields.mailFrom;
  if (fields.description !== undefined) params.description  = fields.description;

  // Billing
  if (fields.balance          !== undefined) params.balance            = fields.balance;
  if (fields.creditLimit      !== undefined) params.credit_limit       = fields.creditLimit;
  if (fields.paymentCurrency  !== undefined) params.payment_currency   = fields.paymentCurrency;
  if (fields.paymentMethod    !== undefined) params.payment_method     = fields.paymentMethod;
  if (fields.minPaymentAmount !== undefined) params.min_payment_amount = fields.minPaymentAmount;
  if (fields.iCommissionAgent !== undefined) params.i_commission_agent = fields.iCommissionAgent;
  if (fields.commissionSize   !== undefined) params.commission_size    = fields.commissionSize;

  // Routing
  if (fields.iRoutingGroup !== undefined) params.i_routing_group = fields.iRoutingGroup;

  // Permissions
  if (fields.accountsMgmt  !== undefined) params.accounts_mgmt  = fields.accountsMgmt;
  if (fields.customersMgmt !== undefined) params.customers_mgmt = fields.customersMgmt;
  if (fields.systemMgmt    !== undefined) params.system_mgmt    = fields.systemMgmt;
  if (fields.tariffsMgmt   !== undefined) params.tariffs_mgmt   = fields.tariffsMgmt;
  if (fields.vouchersMgmt  !== undefined) params.vouchers_mgmt  = fields.vouchersMgmt;
  if (fields.apiAccess     !== undefined) params.api_access     = fields.apiAccess;
  if (fields.apiPassword   !== undefined) params.api_password   = fields.apiPassword;
  if (fields.apiMgmt       !== undefined) params.api_mgmt       = fields.apiMgmt;

  // Features
  if (fields.maxDepth               !== undefined) params.max_depth                = fields.maxDepth;
  if (fields.useOwnTariff           !== undefined) params.use_own_tariff           = fields.useOwnTariff;
  if (fields.accountsMatchingRule   !== undefined) params.accounts_matching_rule   = fields.accountsMatchingRule;
  if (fields.callshopEnabled        !== undefined) params.callshop_enabled         = fields.callshopEnabled;
  if (fields.overcommitProtection   !== undefined) params.overcommit_protection    = fields.overcommitProtection;
  if (fields.overcommitLimit        !== undefined) params.overcommit_limit         = fields.overcommitLimit;
  if (fields.didPoolEnabled         !== undefined) params.did_pool_enabled         = fields.didPoolEnabled;
  if (fields.ivrAppsEnabled         !== undefined) params.ivr_apps_enabled         = fields.ivrAppsEnabled;
  if (fields.asrAcdEnabled          !== undefined) params.asr_acd_enabled          = fields.asrAcdEnabled;
  if (fields.debitCreditCardsEnabled !== undefined) params.debit_credit_cards_enabled = fields.debitCreditCardsEnabled;
  if (fields.conferencingEnabled    !== undefined) params.conferencing_enabled     = fields.conferencingEnabled;
  if (fields.sharePaymentProcessors !== undefined) params.share_payment_processors = fields.sharePaymentProcessors;
  if (fields.dnclEnabled            !== undefined) params.dncl_enabled             = fields.dnclEnabled;

  // Locale / UI
  if (fields.iTimeZone   !== undefined) params.i_time_zone   = fields.iTimeZone;
  if (fields.iLang       !== undefined) params.i_lang         = fields.iLang;
  if (fields.iExportType !== undefined) params.i_export_type  = fields.iExportType;
  if (fields.startPage   !== undefined) params.start_page     = fields.startPage;
  if (fields.css         !== undefined) params.css            = fields.css;
  if (fields.dnsAlias    !== undefined) params.dns_alias      = fields.dnsAlias;

  // Rate limits
  if (fields.maxSessions       !== undefined) params.max_sessions         = fields.maxSessions;
  if (fields.maxCallsPerSecond !== undefined) params.max_calls_per_second = fields.maxCallsPerSecond;

  // Password policy
  if (fields.iPasswordPolicy !== undefined) params.i_password_policy = fields.iPasswordPolicy;

  // Trusted mode
  if (fields.iWholesaler !== undefined) params.i_wholesaler = fields.iWholesaler;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('updateCustomer', params), username, password);
    if (resp.statusCode === 200 && !resp.body.includes('<fault>')) {
      return { success: true, message: 'Customer updated successfully.' };
    }
    const fault = extractTag(resp.body, 'faultString') || 'updateCustomer failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Delete a customer from Sippy.
 * Official method: deleteCustomer() — docs 107421
 * Parameters: i_customer (required)
 */
export async function deleteSippyCustomer(
  username: string,
  password: string,
  iCustomer: number,
  portalUrl?: string,
): Promise<{ success: boolean; message: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('deleteCustomer', { i_customer: iCustomer }), username, password);
    if (resp.statusCode === 200 && !resp.body.includes('<fault>')) {
      return { success: true, message: 'Customer deleted successfully.' };
    }
    const fault = extractTag(resp.body, 'faultString') || 'deleteCustomer failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Block a customer on Sippy.
 * Official method: blockCustomer() — docs 3000083421 (available since 5.2)
 * Parameters: i_customer (required)
 */
export async function blockSippyCustomer(
  username: string,
  password: string,
  iCustomer: number,
  portalUrl?: string,
): Promise<{ success: boolean; message: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('blockCustomer', { i_customer: iCustomer }), username, password);
    if (resp.statusCode === 200 && !resp.body.includes('<fault>')) {
      return { success: true, message: 'Customer blocked.' };
    }
    const fault = extractTag(resp.body, 'faultString') || 'blockCustomer failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Unblock a customer on Sippy.
 * Official method: unblockCustomer() — docs 3000083421 (available since 5.2)
 * Parameters: i_customer (required)
 */
export async function unblockSippyCustomer(
  username: string,
  password: string,
  iCustomer: number,
  portalUrl?: string,
): Promise<{ success: boolean; message: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('unblockCustomer', { i_customer: iCustomer }), username, password);
    if (resp.statusCode === 200 && !resp.body.includes('<fault>')) {
      return { success: true, message: 'Customer unblocked.' };
    }
    const fault = extractTag(resp.body, 'faultString') || 'unblockCustomer failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Block an account on Sippy.
 * Official method: blockAccount() — docs 107340
 *
 * Parameters: i_account (required), i_customer (trusted mode, optional)
 * Returns: result=OK on success.
 */
export async function blockSippyAccount(
  username: string,
  password: string,
  iAccount: number,
  opts?: { iCustomer?: number; portalUrl?: string },
): Promise<{ success: boolean; message: string }> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number> = { i_account: iAccount };
  if (opts?.iCustomer !== undefined) params.i_customer = opts.iCustomer;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('blockAccount', params), username, password);
    if (resp.statusCode === 200 && !resp.body.includes('<fault>')) {
      return { success: true, message: 'Account blocked.' };
    }
    const fault = resp.body.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(resp.body, 'faultString') ?? 'blockAccount failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Unblock an account on Sippy.
 * Official method: unblockAccount() — docs 107340
 *
 * Parameters: i_account (required), i_customer (trusted mode, optional)
 * Returns: result=OK on success.
 */
export async function unblockSippyAccount(
  username: string,
  password: string,
  iAccount: number,
  opts?: { iCustomer?: number; portalUrl?: string },
): Promise<{ success: boolean; message: string }> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number> = { i_account: iAccount };
  if (opts?.iCustomer !== undefined) params.i_customer = opts.iCustomer;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('unblockAccount', params), username, password);
    if (resp.statusCode === 200 && !resp.body.includes('<fault>')) {
      return { success: true, message: 'Account unblocked.' };
    }
    const fault = resp.body.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(resp.body, 'faultString') ?? 'unblockAccount failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

// ── Account Management (official Sippy docs 107312 / 107321 / 107322 / 107366) ──

// SIP registration status returned inline in listAccounts() per account struct,
// or standalone from getRegistrationStatus(). Null when account is not registered.
export interface SippyAccountRegistration {
  registered: boolean;
  userAgent?: string;   // User-Agent header
  contact?: string;     // SIP contact header
  expires?: string;     // Expiration time string: '%H:%M:%S.000 GMT %a %b %d %Y'
}

// ── getAccountInfo() — retrieve all attributes of an account (docs 107327) ───
// Available since all versions. Trusted mode: i_customer (from 2024).
// CRITICAL: Sippy returns NEGATIVE for positive balance, POSITIVE for negative.
//           getAccountInfo() INVERTS the balance before returning (same as createAccount).

export interface SippyAccountInfo {
  iAccount: number;
  username: string;
  name?: string;               // display / billing name
  iCustomer?: number;
  blocked: boolean;
  expired: boolean;
  expiryDate?: string;
  balance: number;             // ALREADY INVERTED: positive = real positive balance
  creditLimit: number;
  baseCurrency?: string;
  iBillingPlan?: number;
  iTariff?: number;
  iRoutingGroup?: number;
  maxSessions?: number;
  maxCallsPerSecond?: number;
  sipProxyRegistration?: boolean;
  registrationBindingLifetime?: number;
  iCodecGroup?: number;
  iTimeZone?: string;
  description?: string;
  vmEnabled?: boolean;
  iLang?: string;
  email?: string;
  webLogin?: string;           // web interface login (no web_password returned per doc)
  incomingCli?: string;
  incomingCld?: string;
  // Any extra fields not explicitly typed are passed through as-is
  [key: string]: unknown;
}

/**
 * Retrieve all attributes of an account.
 * Official method: getAccountInfo() — docs 107327
 *
 * Lookup by i_account (number) or username (string) — at least one required.
 * Trusted mode: provide iCustomer (from Sippy 2024+).
 *
 * IMPORTANT: Sippy returns inverted balance (negative = positive balance).
 *            This function corrects the inversion before returning.
 */
export async function getAccountInfo(
  username: string,
  password: string,
  portalUrl: string | undefined,
  iAccount?: number,
  accountUsername?: string,
  iCustomer?: number,
): Promise<SippyAccountInfo | null> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return null;
  if (!iAccount && !accountUsername) return null;
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number> = {};
  if (iAccount)         params.i_account = iAccount;
  if (accountUsername)  params.username   = accountUsername;
  if (iCustomer !== undefined) params.i_customer = iCustomer;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('getAccountInfo', params), username, password);
    const text = resp.body;

    if (text.includes('<fault>')) {
      const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
        ?? extractTag(text, 'faultString') ?? 'getAccountInfo failed.';
      console.warn(`[Sippy] getAccountInfo fault: ${fault}`);
      return null;
    }

    const m = extractStructMembers(text);

    const int = (k: string): number | undefined => {
      const v = m[k]; if (v === undefined) return undefined;
      const n = parseInt(v, 10); return isNaN(n) ? undefined : n;
    };
    const bool = (k: string): boolean => m[k] === '1' || m[k] === 'true' || m[k] === 'Yes';
    const str = (k: string): string | undefined => (m[k] !== undefined && m[k] !== '') ? m[k] : undefined;

    // Balance inversion: Sippy returns negative for positive balance — negate it
    const rawBalance = parseFloat(m['balance'] ?? '0');
    const balance = isNaN(rawBalance) ? 0 : -rawBalance;
    const creditLimit = parseFloat(m['credit_limit'] ?? '0');

    const info: SippyAccountInfo = {
      iAccount:                  int('i_account') ?? (iAccount ?? 0),
      username:                  str('username') ?? (accountUsername ?? ''),
      name:                      str('name'),
      iCustomer:                 int('i_customer'),
      blocked:                   bool('blocked'),
      expired:                   bool('expired'),
      expiryDate:                str('expiry_date'),
      balance,
      creditLimit:               isNaN(creditLimit) ? 0 : creditLimit,
      baseCurrency:              str('base_currency'),
      iBillingPlan:              int('i_billing_plan'),
      iTariff:                   int('i_tariff'),
      iRoutingGroup:             int('i_routing_group'),
      maxSessions:               int('max_sessions'),
      maxCallsPerSecond:         int('max_calls_per_second'),
      sipProxyRegistration:      bool('sip_proxy_registration'),
      registrationBindingLifetime: int('registration_binding_lifetime'),
      iCodecGroup:               int('i_codec_group'),
      iTimeZone:                 str('i_time_zone'),
      description:               str('description'),
      vmEnabled:                 bool('vm_enabled'),
      iLang:                     str('i_lang'),
      email:                     str('email'),
      webLogin:                  str('web_login'),
      incomingCli:               str('incoming_cli'),
      incomingCld:               str('incoming_cld'),
      // NOTE: web_password, voip_password, vm_password are NOT returned by Sippy per docs
    };

    // Pass through any extra fields not explicitly typed
    for (const [k, v] of Object.entries(m)) {
      if (!(k in {
        i_account:1, username:1, name:1, i_customer:1, blocked:1, expired:1, expiry_date:1,
        balance:1, credit_limit:1, base_currency:1, i_billing_plan:1, i_tariff:1,
        i_routing_group:1, max_sessions:1, max_calls_per_second:1, sip_proxy_registration:1,
        registration_binding_lifetime:1, i_codec_group:1, i_time_zone:1, description:1,
        vm_enabled:1, i_lang:1, email:1, web_login:1, incoming_cli:1, incoming_cld:1,
      })) {
        info[k] = v;
      }
    }

    return info;
  } catch (e: any) {
    console.error(`[Sippy] getAccountInfo error:`, e.message);
    return null;
  }
}

// ── GET /api/sippy/accounts/:id/info — expose getAccountInfo via REST ─────────
// (Route registered in routes.ts)

// Typed account record returned by listAccounts() (docs 107322)
// NOTE: balance is NOT inverted here — positive number = positive balance.
// createAccount() and getAccountInfo() DO invert balance; listAccounts() does NOT.
export interface SippyAccount {
  iAccount: number;
  username: string;
  description: string;
  blocked: boolean;
  expired: boolean;
  balance: number;       // NOT inverted (positive = positive balance)
  creditLimit: number;
  baseCurrency: string;
  registration: SippyAccountRegistration | null;  // null if not registered
}

/**
 * List accounts belonging to a customer.
 * Official method: listAccounts() — docs 107322 (Sippy v2.2+)
 *
 * In trusted mode (admin caller) supply iCustomer to scope results to one customer.
 * Without iCustomer the call returns accounts for the authenticated user's customer.
 *
 * Parameters:
 *   iCustomer  — optional; filter to a specific customer (trusted / admin mode)
 *   offset     — skip first N records (pagination)
 *   limit      — return at most N records (default 200)
 *
 * NOTE: Unlike createAccount() and getAccountInfo(), this method returns balance
 * as a positive number for a positive balance (i.e. balance is NOT inverted).
 */
export async function listSippyAccounts(
  username: string,
  password: string,
  opts: { iCustomer?: number; offset?: number; limit?: number } = {},
  portalUrl?: string,
): Promise<{ accounts: SippyAccount[]; error?: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { accounts: [], error: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number | boolean | null> = {};
  if (opts.iCustomer !== undefined) params.i_customer = opts.iCustomer;
  if (opts.offset    !== undefined) params.offset      = opts.offset;
  params.limit = opts.limit ?? 200;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('listAccounts', params), username, password);
    if (resp.statusCode !== 200) {
      return { accounts: [], error: `HTTP ${resp.statusCode}` };
    }
    const text = resp.body;
    if (text.includes('<fault>')) {
      const fault = extractTag(text, 'faultString') || 'listAccounts failed.';
      return { accounts: [], error: fault };
    }

    // Each account is a <struct> inside the <accounts> array.
    // The registration_status member is itself a nested <struct> or <nil/>.
    // We extract account-level structs then parse nested registration.
    const accounts: SippyAccount[] = [];

    // Match top-level <struct> blocks (each is one account)
    const structRe = /<struct>([\s\S]*?)<\/struct>/g;
    // We need to find the <accounts> array first, then iterate its data values.
    const accountsArrayMatch = text.match(/<name>accounts<\/name>\s*<value>\s*<array>\s*<data>([\s\S]*?)<\/data>\s*<\/array>/);
    const scope = accountsArrayMatch ? accountsArrayMatch[1] : text;

    let m;
    while ((m = structRe.exec(scope)) !== null) {
      const rawStruct = m[1];

      // Extract registration_status sub-struct BEFORE stripping tags from rawStruct
      let registration: SippyAccountRegistration | null = null;
      const regMatch = rawStruct.match(
        /<name>registration_status<\/name>\s*<value>\s*<struct>([\s\S]*?)<\/struct>\s*<\/value>/
      );
      if (regMatch) {
        const regMembers = extractStructMembers(regMatch[1]);
        registration = {
          registered: (regMembers['result'] || '').toUpperCase() === 'OK',
          userAgent:  regMembers['user_agent']  || undefined,
          contact:    regMembers['contact']     || undefined,
          expires:    regMembers['expires']     || undefined,
        };
      }

      // Parse flat members (stripping the nested registration_status block first)
      const flatStruct = rawStruct.replace(
        /<name>registration_status<\/name>\s*<value>[\s\S]*?<\/value>/g, ''
      );
      const f = extractStructMembers(flatStruct);

      const iAccount = parseInt(f['i_account'] || '0', 10);
      if (!iAccount) continue;   // skip the outer wrapper struct if any

      accounts.push({
        iAccount,
        username:     f['username']      || '',
        description:  f['description']   || '',
        blocked:      f['blocked'] === '1' || f['blocked'] === 'true',
        expired:      f['expired']  === '1' || f['expired']  === 'true',
        balance:      parseFloat(f['balance']      || '0') || 0,   // NOT inverted
        creditLimit:  parseFloat(f['credit_limit'] || '0') || 0,
        baseCurrency: f['base_currency'] || 'USD',
        registration,
      });
    }

    return { accounts };
  } catch (e: any) {
    return { accounts: [], error: e.message };
  }
}

/**
 * Get SIP registration status for a single account.
 * Official method: getRegistrationStatus() — docs 107366
 *
 * Returns the account's current SIP registration state.
 * Fault code 403 means "Account is not registered" (not an error).
 *
 * Parameters:
 *   iAccount  — required; i_account of the account to check
 *   iCustomer — optional; supply in trusted/admin mode to scope the call to a specific customer
 */
export async function getSippyAccountRegistration(
  username: string,
  password: string,
  iAccount: number,
  opts?: { iCustomer?: number; portalUrl?: string },
): Promise<SippyAccountRegistration> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { registered: false };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  // Build params — always include i_account; add i_customer for trusted/admin mode
  const params: Record<string, string | number | boolean | null> = { i_account: iAccount };
  if (opts?.iCustomer !== undefined) params.i_customer = opts.iCustomer;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('getRegistrationStatus', params), username, password);
    const text = resp.body;

    // Fault code 403 = "Account is not registered" — treat as valid unregistered state.
    // Any other fault is also returned as unregistered (no crash, no leaked fault string).
    if (text.includes('<fault>')) {
      return { registered: false };
    }

    const m = extractStructMembers(text);
    return {
      registered: (m['result'] || '').toUpperCase() === 'OK',
      userAgent:  m['user_agent'] || undefined,
      contact:    m['contact']    || undefined,
      expires:    m['expires']    || undefined,
    };
  } catch {
    return { registered: false };
  }
}

/**
 * Delete an account from Sippy.
 * Official method: deleteAccount() — docs 107321
 * Parameters: i_account (required); supports trusted mode via i_customer.
 * Active calls of the deleted account will be disconnected. (since Sippy v5.0)
 */
export async function deleteSippyAccount(
  username: string,
  password: string,
  iAccount: number,
  portalUrl?: string,
  iCustomer?: number,  // trusted mode: i_customer of the owning customer (1 = root)
): Promise<{ success: boolean; message: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, number> = { i_account: iAccount };
  if (iCustomer !== undefined) params.i_customer = iCustomer;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('deleteAccount', params), username, password);
    if (resp.statusCode === 200 && !resp.body.includes('<fault>') && !resp.body.includes('faultCode')) {
      return { success: true, message: 'Account deleted successfully.' };
    }
    const fault = resp.body.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(resp.body, 'faultString')
      ?? 'deleteAccount failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

// ── Account Incoming Routing Management (official Sippy docs 3000032223) ────────

export interface SippyIncomingRoute {
  i_incoming_route: number;
  i_did: number | null;        // null = On-Net Calls
  did: string;
  i_trunk: number | null;      // null = Registered Account
  trunk_name: string;
  i_forward_did_mode: number | null;
  self_managed: boolean;
}

/**
 * Get list of incoming routes configured for an account.
 * Official method: getIncomingRoutesList() — docs 3000032223
 * Available from Sippy v4.4. Supports trusted mode via i_customer.
 */
export async function getIncomingRoutesList(
  username: string,
  password: string,
  opts: {
    iAccount: number;
    iDid?: number;
    offset?: number;
    limit?: number;
    iCustomer?: number;
  },
  portalUrl?: string,
): Promise<{ success: boolean; routes: SippyIncomingRoute[]; message?: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, routes: [], message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number> = { i_account: opts.iAccount };
  if (opts.iDid     !== undefined) params.i_did     = opts.iDid;
  if (opts.offset   !== undefined) params.offset    = opts.offset;
  if (opts.limit    !== undefined) params.limit     = opts.limit;
  if (opts.iCustomer !== undefined) params.i_customer = opts.iCustomer;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('getIncomingRoutesList', params), username, password);
    if (resp.statusCode !== 200 || resp.body.includes('<fault>') || resp.body.includes('faultCode')) {
      const fault = resp.body.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
        ?? extractTag(resp.body, 'faultString') ?? 'getIncomingRoutesList failed.';
      return { success: false, routes: [], message: fault };
    }

    const structs = extractAllTags(resp.body, 'struct');
    const routes: SippyIncomingRoute[] = [];
    for (const s of structs) {
      const m = extractStructMembers(s);
      if (m['i_incoming_route'] === undefined) continue;
      routes.push({
        i_incoming_route: parseInt(m['i_incoming_route'] ?? '0', 10),
        i_did:            m['i_did'] && m['i_did'] !== 'nil' ? parseInt(m['i_did'], 10) : null,
        did:              m['did'] ?? '',
        i_trunk:          m['i_trunk'] && m['i_trunk'] !== 'nil' ? parseInt(m['i_trunk'], 10) : null,
        trunk_name:       m['trunk_name'] ?? '',
        i_forward_did_mode: m['i_forward_did_mode'] && m['i_forward_did_mode'] !== 'nil'
          ? parseInt(m['i_forward_did_mode'], 10) : null,
        self_managed:     m['self_managed'] === '1' || m['self_managed'] === 'true',
      });
    }
    return { success: true, routes };
  } catch (e: any) {
    return { success: false, routes: [], message: e.message };
  }
}

/**
 * Update an incoming routing entry for an account.
 * Official method: updateIncomingRoute() — docs 3000032223
 * Available from Sippy v4.4. Supports trusted mode via i_customer.
 */
export async function updateIncomingRoute(
  username: string,
  password: string,
  opts: {
    iIncomingRoute: number;    // Required — the route to update
    iTrunk?: number | null;    // null = Registered Account
    iForwardDidMode?: number;  // Forward DID number mode
    selfManaged?: boolean;     // whether account can manage this route
    iCustomer?: number;        // trusted mode
  },
  portalUrl?: string,
): Promise<{ success: boolean; message: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number | boolean | null> = {
    i_incoming_route: opts.iIncomingRoute,
  };
  if (opts.iTrunk           !== undefined) params.i_trunk            = opts.iTrunk;           // null is valid
  if (opts.iForwardDidMode  !== undefined) params.i_forward_did_mode = opts.iForwardDidMode;
  if (opts.selfManaged      !== undefined) params.self_managed        = opts.selfManaged;
  if (opts.iCustomer        !== undefined) params.i_customer          = opts.iCustomer;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('updateIncomingRoute', params), username, password);
    if (resp.statusCode === 200 && !resp.body.includes('<fault>') && !resp.body.includes('faultCode')) {
      return { success: true, message: 'Incoming route updated successfully.' };
    }
    const fault = resp.body.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(resp.body, 'faultString') ?? 'updateIncomingRoute failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

// ── Account Web Credentials Authentication (official Sippy docs 107325) ─────

/**
 * Authenticate an account using its WEB login (selfcare) credentials.
 * Official method: authAccount() — docs 107325
 * Pass either username or email (not both required). Trusted mode via i_customer.
 * Returns i_account on success; error 410 = authenticated by One Time Password.
 */
export async function authSippyAccount(
  username: string,
  password: string,
  opts: {
    accountUsername?: string;  // selfcare login username (either this or email required)
    email?: string;            // account email as identifier (either this or accountUsername required)
    accountPassword: string;   // selfcare login password (always required)
    iCustomer?: number;        // trusted mode only
  },
  portalUrl?: string,
): Promise<{ success: boolean; iAccount?: number; message: string; oneTimePassword?: boolean }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  if (!opts.accountUsername && !opts.email) {
    return { success: false, message: 'Either accountUsername or email is required.' };
  }
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number> = {
    password: opts.accountPassword,
  };
  if (opts.accountUsername) params.username   = opts.accountUsername;
  if (opts.email)           params.email      = opts.email;
  if (opts.iCustomer !== undefined) params.i_customer = opts.iCustomer;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('authAccount', params), username, password);
    const text = resp.body;

    if (resp.statusCode === 200 && !text.includes('<fault>') && !text.includes('faultCode')) {
      const iAccountStr = text.match(/<name>i_account<\/name>\s*<value>[^<]*(?:<[a-z]+>)?(\d+)/i)?.[1];
      return {
        success:  true,
        iAccount: iAccountStr ? parseInt(iAccountStr, 10) : undefined,
        message:  'Account authenticated successfully.',
      };
    }

    // Error code 410 = successfully authenticated by One Time Password
    const faultCode = text.match(/<name>faultCode<\/name>\s*<value>[^<]*(?:<[a-z]+>)?(\d+)/i)?.[1];
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'authAccount failed.';

    if (faultCode === '410') {
      return { success: true, oneTimePassword: true, message: 'Authenticated via One Time Password (code 410).' };
    }
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

// ── Service Plan Charges (official Sippy docs 107400) ───────────────────────

/**
 * Forcibly apply service plan charges to a given account.
 * Official method: billingRun() — docs 107400
 * Parameters: i_account (required).
 * No trusted mode documented for this method.
 */
export async function billingRun(
  username: string,
  password: string,
  iAccount: number,
  portalUrl?: string,
): Promise<{ success: boolean; message: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('billingRun', { i_account: iAccount }), username, password);
    if (resp.statusCode === 200 && !resp.body.includes('<fault>') && !resp.body.includes('faultCode')) {
      return { success: true, message: 'Service plan charges applied successfully.' };
    }
    const fault = resp.body.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(resp.body, 'faultString') ?? 'billingRun failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

// ── Vendor Management (official Sippy docs 107434) ───────────────────────────

export interface CreateVendorOpts {
  name:              string;
  webPassword:       string;
  webLogin:          string;
  iTimeZone:         number;
  // Optional
  baseCurrency?:     string;
  companyName?:      string;
  salutation?:       string;
  firstName?:        string;
  midInit?:          string;
  lastName?:         string;
  streetAddr?:       string;
  state?:            string;
  postalCode?:       string;
  city?:             string;
  country?:          string;
  contact?:          string;
  phone?:            string;
  fax?:              string;
  altPhone?:         string;
  altContact?:       string;
  email?:            string;
  cc?:               string;
  bcc?:              string;
  balance?:          number;
  iLang?:            string;
  iExportType?:      number;
  iPasswordPolicy?:  number;
  roundUp?:          boolean;
  costRoundUp?:      boolean;
  decimalPrecision?: number;
  // Trusted mode
  iCustomer?:        number;
}

/**
 * Create a new vendor on Sippy.
 * Official method: createVendor() (alias: addVendor()) — docs 107434
 * Returns i_vendor of the newly created vendor.
 */
export async function createSippyVendor(
  username: string,
  password: string,
  opts:     CreateVendorOpts,
  portalUrl?: string,
): Promise<{ success: boolean; iVendor?: number; message: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number | boolean> = {
    name:        opts.name,
    web_password: opts.webPassword,
    web_login:   opts.webLogin,
    i_time_zone: opts.iTimeZone,
  };
  if (opts.baseCurrency     !== undefined) params.base_currency      = opts.baseCurrency;
  if (opts.companyName      !== undefined) params.company_name       = opts.companyName;
  if (opts.salutation       !== undefined) params.salutation         = opts.salutation;
  if (opts.firstName        !== undefined) params.first_name         = opts.firstName;
  if (opts.midInit          !== undefined) params.mid_init           = opts.midInit;
  if (opts.lastName         !== undefined) params.last_name          = opts.lastName;
  if (opts.streetAddr       !== undefined) params.street_addr        = opts.streetAddr;
  if (opts.state            !== undefined) params.state              = opts.state;
  if (opts.postalCode       !== undefined) params.postal_code        = opts.postalCode;
  if (opts.city             !== undefined) params.city               = opts.city;
  if (opts.country          !== undefined) params.country            = opts.country;
  if (opts.contact          !== undefined) params.contact            = opts.contact;
  if (opts.phone            !== undefined) params.phone              = opts.phone;
  if (opts.fax              !== undefined) params.fax                = opts.fax;
  if (opts.altPhone         !== undefined) params.alt_phone          = opts.altPhone;
  if (opts.altContact       !== undefined) params.alt_contact        = opts.altContact;
  if (opts.email            !== undefined) params.email              = opts.email;
  if (opts.cc               !== undefined) params.cc                 = opts.cc;
  if (opts.bcc              !== undefined) params.bcc                = opts.bcc;
  if (opts.balance          !== undefined) params.balance            = opts.balance;
  if (opts.iLang            !== undefined) params.i_lang             = opts.iLang;
  if (opts.iExportType      !== undefined) params.i_export_type      = opts.iExportType;
  if (opts.iPasswordPolicy  !== undefined) params.i_password_policy  = opts.iPasswordPolicy;
  if (opts.roundUp          !== undefined) params.round_up           = opts.roundUp;
  if (opts.costRoundUp      !== undefined) params.cost_round_up      = opts.costRoundUp;
  if (opts.decimalPrecision !== undefined) params.decimal_precision  = opts.decimalPrecision;
  if (opts.iCustomer        !== undefined) params.i_customer         = opts.iCustomer;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('createVendor', params), username, password);
    const text = resp.body;
    if (resp.statusCode !== 200 || text.includes('<fault>')) {
      const fault = extractTag(text, 'faultString') || 'createVendor failed.';
      return { success: false, message: fault };
    }
    const m = extractStructMembers(text);
    const iVendor = m.i_vendor ? parseInt(m.i_vendor, 10) : undefined;
    return { success: true, iVendor, message: m.result ?? 'OK' };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Update a vendor on Sippy.
 * Official method: updateVendor() — docs 107434
 * Parameters: i_vendor (required) + any createVendor() optional fields.
 * NOTE: balance and base_currency cannot be changed via updateVendor().
 */
export async function updateSippyVendor(
  username: string,
  password: string,
  iVendor:  number,
  fields:   Partial<Omit<CreateVendorOpts, 'webPassword' | 'balance' | 'baseCurrency'>>,
  portalUrl?: string,
): Promise<{ success: boolean; message: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number | boolean> = { i_vendor: iVendor };
  if (fields.name             !== undefined) params.name              = fields.name;
  if (fields.webLogin         !== undefined) params.web_login         = fields.webLogin;
  if (fields.iTimeZone        !== undefined) params.i_time_zone       = fields.iTimeZone;
  if (fields.companyName      !== undefined) params.company_name      = fields.companyName;
  if (fields.salutation       !== undefined) params.salutation        = fields.salutation;
  if (fields.firstName        !== undefined) params.first_name        = fields.firstName;
  if (fields.midInit          !== undefined) params.mid_init          = fields.midInit;
  if (fields.lastName         !== undefined) params.last_name         = fields.lastName;
  if (fields.streetAddr       !== undefined) params.street_addr       = fields.streetAddr;
  if (fields.state            !== undefined) params.state             = fields.state;
  if (fields.postalCode       !== undefined) params.postal_code       = fields.postalCode;
  if (fields.city             !== undefined) params.city              = fields.city;
  if (fields.country          !== undefined) params.country           = fields.country;
  if (fields.contact          !== undefined) params.contact           = fields.contact;
  if (fields.phone            !== undefined) params.phone             = fields.phone;
  if (fields.fax              !== undefined) params.fax               = fields.fax;
  if (fields.altPhone         !== undefined) params.alt_phone         = fields.altPhone;
  if (fields.altContact       !== undefined) params.alt_contact       = fields.altContact;
  if (fields.email            !== undefined) params.email             = fields.email;
  if (fields.cc               !== undefined) params.cc                = fields.cc;
  if (fields.bcc              !== undefined) params.bcc               = fields.bcc;
  if (fields.iLang            !== undefined) params.i_lang            = fields.iLang;
  if (fields.iExportType      !== undefined) params.i_export_type     = fields.iExportType;
  if (fields.iPasswordPolicy  !== undefined) params.i_password_policy = fields.iPasswordPolicy;
  if (fields.roundUp          !== undefined) params.round_up          = fields.roundUp;
  if (fields.costRoundUp      !== undefined) params.cost_round_up     = fields.costRoundUp;
  if (fields.decimalPrecision !== undefined) params.decimal_precision = fields.decimalPrecision;
  if (fields.iCustomer        !== undefined) params.i_customer        = fields.iCustomer;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('updateVendor', params), username, password);
    if (resp.statusCode === 200 && !resp.body.includes('<fault>')) {
      return { success: true, message: 'Vendor updated successfully.' };
    }
    const fault = extractTag(resp.body, 'faultString') || 'updateVendor failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Get detailed info for a single vendor.
 * Official method: getVendorInfo() — docs 107434
 * Pass either iVendor (int) OR name (string). Trusted mode: iCustomer.
 */
export async function getSippyVendorInfo(
  username: string,
  password: string,
  lookup:   { iVendor: number } | { name: string },
  opts?: { iCustomer?: number; portalUrl?: string },
): Promise<{ success: boolean; vendor?: SippyVendor & Record<string, unknown>; message: string }> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number> = {};
  if ('iVendor' in lookup) params.i_vendor = lookup.iVendor;
  else                     params.name     = lookup.name;
  if (opts?.iCustomer !== undefined) params.i_customer = opts.iCustomer;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('getVendorInfo', params), username, password);
    const text = resp.body;
    if (resp.statusCode !== 200 || text.includes('<fault>')) {
      const fault = extractTag(text, 'faultString') || 'getVendorInfo failed.';
      return { success: false, message: fault };
    }

    const vendorMatch = /<name>vendor<\/name>\s*<value>\s*<struct>([\s\S]*?)<\/struct>\s*<\/value>/.exec(text);
    if (!vendorMatch) return { success: false, message: 'No vendor struct in response.' };

    const m = extractStructMembers(vendorMatch[1]);
    const vendor: SippyVendor & Record<string, unknown> = {
      iVendor:      parseInt(m.i_vendor      || '0', 10),
      name:         m.name                   || '',
      balance:      m.balance      ? parseFloat(m.balance) : undefined,
      baseCurrency: m.base_currency           || undefined,
      email:        m.email                   || undefined,
      companyName:  m.company_name            || undefined,
      webLogin:     m.web_login               || undefined,
      iTimeZone:    m.i_time_zone ? parseInt(m.i_time_zone, 10) : undefined,
      iLang:        m.i_lang                  || undefined,
      phone:        m.phone                   || undefined,
      city:         m.city                    || undefined,
      country:      m.country                 || undefined,
      roundUp:      m.round_up === '1' || m.round_up === 'true',
      costRoundUp:  m.cost_round_up === '1' || m.cost_round_up === 'true',
      decimalPrecision: m.decimal_precision ? parseInt(m.decimal_precision, 10) : undefined,
    };
    return { success: true, vendor, message: 'OK' };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/** Shared helper for vendorDebit / vendorAddFunds / vendorCredit — docs 151210 */
async function vendorBalanceMutation(
  method:    string,
  username:  string,
  password:  string,
  iVendor:   number,
  amount:    number,
  currency:  string,
  opts?:     { paymentNotes?: string; paymentTime?: string },
  portalUrl?: string,
): Promise<{ success: boolean; message: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const params: Record<string, string | number> = { i_vendor: iVendor, amount, currency };
  if (opts?.paymentNotes !== undefined) params.payment_notes = opts.paymentNotes;
  if (opts?.paymentTime  !== undefined) params.payment_time  = opts.paymentTime;
  try {
    const resp = await sippyPost(`${base}/xmlapi/xmlapi`, xmlRpcCall(method, params), username, password);
    if (resp.statusCode === 200 && !resp.body.includes('<fault>')) return { success: true, message: `${method} OK.` };
    return { success: false, message: extractTag(resp.body, 'faultString') || `${method} failed.` };
  } catch (e: any) { return { success: false, message: e.message }; }
}

/**
 * Debit a currency amount from a vendor's balance.
 * Official method: vendorDebit() — docs 151210 (Sippy 4.0+)
 * Mandatory: i_vendor, amount, currency. Optional: payment_notes, payment_time (5.0+).
 */
export const sippyVendorDebit = (
  username: string, password: string,
  iVendor: number, amount: number, currency: string,
  opts?: { paymentNotes?: string; paymentTime?: string }, portalUrl?: string,
) => vendorBalanceMutation('vendorDebit', username, password, iVendor, amount, currency, opts, portalUrl);

/**
 * Add funds to (increase) a vendor's balance.
 * Official method: vendorAddFunds() — docs 151210 (Sippy 4.0+)
 * Mandatory: i_vendor, amount, currency. Optional: payment_notes, payment_time (5.0+).
 */
export const sippyVendorAddFunds = (
  username: string, password: string,
  iVendor: number, amount: number, currency: string,
  opts?: { paymentNotes?: string; paymentTime?: string }, portalUrl?: string,
) => vendorBalanceMutation('vendorAddFunds', username, password, iVendor, amount, currency, opts, portalUrl);

/**
 * Credit a vendor's balance (same effect as addFunds; transaction labelled 'Credit').
 * Official method: vendorCredit() — docs 151210 (Sippy 4.0+)
 * Mandatory: i_vendor, amount, currency. Optional: payment_notes, payment_time (5.0+).
 */
export const sippyVendorCredit = (
  username: string, password: string,
  iVendor: number, amount: number, currency: string,
  opts?: { paymentNotes?: string; paymentTime?: string }, portalUrl?: string,
) => vendorBalanceMutation('vendorCredit', username, password, iVendor, amount, currency, opts, portalUrl);

/**
 * Delete a vendor from Sippy.
 * Official method: deleteVendor() — docs 107434
 * Parameters: i_vendor (required)
 */
export async function deleteSippyVendor(
  username: string,
  password: string,
  iVendor: number,
  portalUrl?: string,
): Promise<{ success: boolean; message: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('deleteVendor', { i_vendor: iVendor }), username, password);
    if (resp.statusCode === 200 && !resp.body.includes('<fault>')) {
      return { success: true, message: 'Vendor deleted successfully.' };
    }
    const fault = extractTag(resp.body, 'faultString') || 'deleteVendor failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

// ── Vendor Listing (official Sippy docs 107434) ───────────────────────────────

export interface SippyVendor {
  iVendor: number;
  name: string;
  balance?: number;
  baseCurrency?: string;
  email?: string;
  companyName?: string;
}

function parseVendorStruct(xml: string): SippyVendor {
  const m = extractStructMembers(xml);
  return {
    iVendor:      parseInt(m['i_vendor']   || '0', 10),
    name:         m['name']                || '',
    balance:      m['balance']   ? parseFloat(m['balance'])  : undefined,
    baseCurrency: m['base_currency']       || undefined,
    email:        m['email']               || undefined,
    companyName:  m['company_name']        || undefined,
  };
}

/**
 * List all vendors on Sippy.
 * Tries listVendors() (Sippy 4.5+) then getVendorsList() (earlier).
 * Official methods: listVendors() / getVendorsList() — docs 107434
 */
export async function listSippyVendors(
  username: string,
  password: string,
  opts?: { limit?: number; offset?: number; namePattern?: string },
  portalUrl?: string,
): Promise<{ vendors: SippyVendor[]; error?: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { vendors: [], error: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number> = { i_customer: 1 };
  if (opts?.limit       !== undefined) params.limit        = opts.limit;
  if (opts?.offset      !== undefined) params.offset       = opts.offset;
  if (opts?.namePattern !== undefined) params.name_pattern = opts.namePattern;

  for (const method of ['listVendors', 'getVendorsList']) {
    try {
      const resp = await sippyPost(apiUrl, xmlRpcCall(method, params), username, password);
      const text = resp.body;
      if (text.includes('<fault>')) continue;

      const arrayMatch = /<name>vendors<\/name>\s*<value>\s*<array>([\s\S]*?)<\/array>\s*<\/value>/.exec(text);
      if (!arrayMatch) return { vendors: [] };

      const vendors: SippyVendor[] = [];
      const re = /<struct>([\s\S]*?)<\/struct>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(arrayMatch[1])) !== null) {
        vendors.push(parseVendorStruct(m[1]));
      }
      return { vendors };
    } catch { continue; }
  }
  return { vendors: [], error: 'Could not fetch vendors from Sippy.' };
}

// ── Vendor Connections (official Sippy docs 107435) ───────────────────────────

export interface SippyVendorConnection {
  iConnection:            number;
  name:                   string;
  destination:            string;
  username?:              string;
  capacity?:              number;
  enforceCapacity?:       boolean;
  maxCps?:                number;
  blocked?:               boolean;
  // Transport & Media
  iProtocol?:             number;           // deprecated in 2021, use iProtoTransport
  iProtoTransport?:       number;           // since 2021
  iMediaRelay?:           number;           // media relay node ID
  iMediaRelayType?:       number;
  // Call handling
  huntstopScodes?:        string;
  timeout100?:            number;
  translationRule?:       string;
  cliTranslationRule?:    string;
  outboundProxy?:         string;
  outboundIp?:            string;
  ignoreLrn?:             boolean;
  singleOutboundPort?:    boolean;
  acceptRedirects?:       boolean;
  redirectDepthLimit?:    number;
  fromDomain?:            string;
  // Diversion
  enableDiversion?:       boolean;
  diversionTranslation?:  string;
  // Privacy
  iPrivacyMode?:          number;           // since 5.1
  useAssertedId?:         boolean;          // Use CLI as Privacy ID
  assertedIdTranslation?: string;
  usePrivIdAsCli?:        boolean;          // since 2021
  trustedPrivacyDomain?:  boolean;          // since 2021; default true
  // Misc
  randomCallId?:          boolean;          // since 5.2
  passRuriParams?:        string;           // since 5.2
  // Quality Monitoring (qmon) fields — docs 107435
  qmonAcdEnabled?:        boolean;
  qmonAsrEnabled?:        boolean;
  qmonPddEnabled?:        boolean;
  qmonStatWindow?:        number;           // seconds sliding window for stats
  qmonAcdThreshold?:      number;           // min acceptable ACD in seconds
  qmonAsrThreshold?:      number;           // min acceptable ASR as 0–100
  qmonPddThreshold?:      number;           // max acceptable PDD in seconds
  qmonRetryInterval?:     number;           // seconds to wait before re-enabling blocked connection
  qmonRetryBatch?:        number;           // number of test calls before re-enabling
  qmonAction?:            string;           // 'disable' | 'suspend' | 'alert'
  qmonNotificationEnabled?: boolean;
}

function parseVendorConnectionStruct(xml: string): SippyVendorConnection {
  const m = extractStructMembers(xml);
  const parseBool = (v: string | undefined): boolean | undefined =>
    v === '1' || v === 'true' ? true : (v === '0' || v === 'false' ? false : undefined);
  return {
    iConnection:              parseInt(m['i_connection']             || '0', 10),
    name:                     m['name']                              || '',
    destination:              m['destination']                       || '',
    username:                 m['username']                          || undefined,
    capacity:                 m['capacity']              ? parseInt(m['capacity'], 10)                  : undefined,
    enforceCapacity:          parseBool(m['enforce_capacity']),
    maxCps:                   m['max_cps']               ? parseFloat(m['max_cps'])                    : undefined,
    blocked:                  parseBool(m['blocked']),
    // Transport & Media
    iProtocol:                m['i_protocol']            ? parseInt(m['i_protocol'], 10)               : undefined,
    iProtoTransport:          m['i_proto_transport']     ? parseInt(m['i_proto_transport'], 10)         : undefined,
    iMediaRelay:              m['i_media_relay']         ? parseInt(m['i_media_relay'], 10)             : undefined,
    iMediaRelayType:          m['i_media_relay_type']    ? parseInt(m['i_media_relay_type'], 10)        : undefined,
    // Call handling
    huntstopScodes:           m['huntstop_scodes']                   || undefined,
    timeout100:               m['timeout_100']           ? parseInt(m['timeout_100'], 10)               : undefined,
    translationRule:          m['translation_rule']                  || undefined,
    cliTranslationRule:       m['cli_translation_rule']              || undefined,
    outboundProxy:            m['outbound_proxy']                    || undefined,
    outboundIp:               m['outbound_ip']                       || undefined,
    ignoreLrn:                parseBool(m['ignore_lrn']),
    singleOutboundPort:       parseBool(m['single_outbound_port']),
    acceptRedirects:          parseBool(m['accept_redirects']),
    redirectDepthLimit:       m['redirect_depth_limit']  ? parseInt(m['redirect_depth_limit'], 10)     : undefined,
    fromDomain:               m['from_domain']                       || undefined,
    // Diversion
    enableDiversion:          parseBool(m['enable_diversion']),
    diversionTranslation:     m['diversion_translation']             || undefined,
    // Privacy
    iPrivacyMode:             m['i_privacy_mode']        ? parseInt(m['i_privacy_mode'], 10)           : undefined,
    useAssertedId:            parseBool(m['use_asserted_id']),
    assertedIdTranslation:    m['asserted_id_translation']           || undefined,
    usePrivIdAsCli:           parseBool(m['use_priv_id_as_cli']),
    trustedPrivacyDomain:     parseBool(m['trusted_privacy_domain']),
    // Misc
    randomCallId:             parseBool(m['random_call_id']),
    passRuriParams:           m['pass_ruri_params']                  || undefined,
    // Quality Monitoring (qmon) — docs 107435
    qmonAcdEnabled:           parseBool(m['qmon_acd_enabled']),
    qmonAsrEnabled:           parseBool(m['qmon_asr_enabled']),
    qmonPddEnabled:           parseBool(m['qmon_pdd_enabled']),
    qmonStatWindow:           m['qmon_stat_window']      ? parseInt(m['qmon_stat_window'], 10)         : undefined,
    qmonAcdThreshold:         m['qmon_acd_threshold']    ? parseInt(m['qmon_acd_threshold'], 10)       : undefined,
    qmonAsrThreshold:         m['qmon_asr_threshold']    ? parseFloat(m['qmon_asr_threshold'])         : undefined,
    qmonPddThreshold:         m['qmon_pdd_threshold']    ? parseFloat(m['qmon_pdd_threshold'])         : undefined,
    qmonRetryInterval:        m['qmon_retry_interval']   ? parseInt(m['qmon_retry_interval'], 10)      : undefined,
    qmonRetryBatch:           m['qmon_retry_batch']      ? parseInt(m['qmon_retry_batch'], 10)         : undefined,
    qmonAction:               m['qmon_action']                       || undefined,
    qmonNotificationEnabled:  parseBool(m['qmon_notification_enabled']),
  };
}

/**
 * List all vendor connections for a vendor.
 * Official method: getVendorConnectionsList() — docs 107435
 * Required: i_vendor
 */
export async function listVendorConnections(
  username: string,
  password: string,
  iVendor: number,
  portalUrl?: string,
): Promise<{ connections: SippyVendorConnection[]; error?: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { connections: [], error: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('getVendorConnectionsList', { i_vendor: iVendor, i_customer: 1 }), username, password);
    const text = resp.body;
    if (text.includes('<fault>')) {
      const fault = extractTag(text, 'faultString') || 'getVendorConnectionsList failed.';
      return { connections: [], error: fault };
    }

    const arrayMatch = /<name>vendor_connections<\/name>\s*<value>\s*<array>([\s\S]*?)<\/array>\s*<\/value>/.exec(text);
    if (!arrayMatch) return { connections: [] };

    const connections: SippyVendorConnection[] = [];
    const re = /<struct>([\s\S]*?)<\/struct>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(arrayMatch[1])) !== null) {
      connections.push(parseVendorConnectionStruct(m[1]));
    }
    return { connections };
  } catch (e: any) {
    return { connections: [], error: e.message };
  }
}

/**
 * Get full info for a single vendor connection.
 * Official method: getVendorConnectionInfo() — docs 107435
 */
export async function getVendorConnectionInfo(
  username: string,
  password: string,
  iConnection: number,
  portalUrl?: string,
): Promise<{ success: boolean; connection?: SippyVendorConnection; error?: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, error: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('getVendorConnectionInfo', { i_connection: iConnection, i_customer: 1 }), username, password);
    const text = resp.body;
    if (text.includes('<fault>')) {
      const fault = extractTag(text, 'faultString') || 'getVendorConnectionInfo failed.';
      return { success: false, error: fault };
    }

    const nested = /<name>vendor_connection<\/name>\s*<value>\s*<struct>([\s\S]*?)<\/struct>\s*<\/value>/.exec(text);
    if (!nested) return { success: false, error: 'vendor_connection struct not found.' };
    return { success: true, connection: parseVendorConnectionStruct(nested[1]) };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/**
 * Create a vendor connection.
 * Official method: createVendorConnection() — docs 107435
 * Required: i_vendor, name, destination
 */
export type VendorConnectionOpts = {
  // Required for create (omit for update)
  iVendor?:               number;
  name?:                  string;
  destination?:           string;
  // Auth
  connUsername?:          string;
  connPassword?:          string;
  // Transport & Media
  iProtocol?:             number;           // deprecated 2021
  iProtoTransport?:       number;           // since 2021
  iMediaRelay?:           number;
  iMediaRelayType?:       number;
  // Capacity
  capacity?:              number;
  enforceCapacity?:       boolean;
  maxCps?:                number;
  blocked?:               boolean;
  // Call handling
  huntstopScodes?:        string;
  timeout100?:            number;
  translationRule?:       string;
  cliTranslationRule?:    string;
  outboundProxy?:         string;
  outboundIp?:            string;
  ignoreLrn?:             boolean;
  singleOutboundPort?:    boolean;
  acceptRedirects?:       boolean;
  redirectDepthLimit?:    number;
  fromDomain?:            string;
  // Diversion
  enableDiversion?:       boolean;
  diversionTranslation?:  string;
  // Privacy
  iPrivacyMode?:          number;           // since 5.1
  useAssertedId?:         boolean;
  assertedIdTranslation?: string;
  usePrivIdAsCli?:        boolean;          // since 2021
  trustedPrivacyDomain?:  boolean;          // since 2021
  // Misc
  randomCallId?:          boolean;          // since 5.2
  passRuriParams?:        string;           // since 5.2
  // Quality Monitoring — docs 107435
  qmonAcdEnabled?:        boolean;
  qmonAsrEnabled?:        boolean;
  qmonPddEnabled?:        boolean;
  qmonStatWindow?:        number;
  qmonAcdThreshold?:      number;
  qmonAsrThreshold?:      number;
  qmonPddThreshold?:      number;
  qmonRetryInterval?:     number;
  qmonRetryBatch?:        number;
  qmonAction?:            string;
  qmonNotificationEnabled?: boolean;
  // Trusted mode
  iCustomer?:             number;
};

function buildConnectionParams(opts: VendorConnectionOpts): Record<string, string | number | boolean | null> {
  const p: Record<string, string | number | boolean | null> = {};
  if (opts.connUsername            !== undefined) p.username                   = opts.connUsername;
  if (opts.connPassword            !== undefined) p.password                   = opts.connPassword;
  if (opts.iProtocol               !== undefined) p.i_protocol                 = opts.iProtocol;
  if (opts.iProtoTransport         !== undefined) p.i_proto_transport          = opts.iProtoTransport;
  if (opts.iMediaRelay             !== undefined) p.i_media_relay              = opts.iMediaRelay;
  if (opts.iMediaRelayType         !== undefined) p.i_media_relay_type         = opts.iMediaRelayType;
  if (opts.capacity                !== undefined) p.capacity                   = opts.capacity;
  if (opts.enforceCapacity         !== undefined) p.enforce_capacity           = opts.enforceCapacity;
  if (opts.maxCps                  !== undefined) p.max_cps                    = opts.maxCps;
  if (opts.blocked                 !== undefined) p.blocked                    = opts.blocked;
  if (opts.huntstopScodes          !== undefined) p.huntstop_scodes            = opts.huntstopScodes;
  if (opts.timeout100              !== undefined) p.timeout_100                = opts.timeout100;
  if (opts.translationRule         !== undefined) p.translation_rule           = opts.translationRule;
  if (opts.cliTranslationRule      !== undefined) p.cli_translation_rule       = opts.cliTranslationRule;
  if (opts.outboundProxy           !== undefined) p.outbound_proxy             = opts.outboundProxy;
  if (opts.outboundIp              !== undefined) p.outbound_ip                = opts.outboundIp;
  if (opts.ignoreLrn               !== undefined) p.ignore_lrn                 = opts.ignoreLrn;
  if (opts.singleOutboundPort      !== undefined) p.single_outbound_port       = opts.singleOutboundPort;
  if (opts.acceptRedirects         !== undefined) p.accept_redirects           = opts.acceptRedirects;
  if (opts.redirectDepthLimit      !== undefined) p.redirect_depth_limit       = opts.redirectDepthLimit;
  if (opts.fromDomain              !== undefined) p.from_domain                = opts.fromDomain;
  if (opts.enableDiversion         !== undefined) p.enable_diversion           = opts.enableDiversion;
  if (opts.diversionTranslation    !== undefined) p.diversion_translation      = opts.diversionTranslation;
  if (opts.iPrivacyMode            !== undefined) p.i_privacy_mode             = opts.iPrivacyMode;
  if (opts.useAssertedId           !== undefined) p.use_asserted_id            = opts.useAssertedId;
  if (opts.assertedIdTranslation   !== undefined) p.asserted_id_translation    = opts.assertedIdTranslation;
  if (opts.usePrivIdAsCli          !== undefined) p.use_priv_id_as_cli         = opts.usePrivIdAsCli;
  if (opts.trustedPrivacyDomain    !== undefined) p.trusted_privacy_domain     = opts.trustedPrivacyDomain;
  if (opts.randomCallId            !== undefined) p.random_call_id             = opts.randomCallId;
  if (opts.passRuriParams          !== undefined) p.pass_ruri_params           = opts.passRuriParams;
  if (opts.qmonAcdEnabled          !== undefined) p.qmon_acd_enabled           = opts.qmonAcdEnabled;
  if (opts.qmonAsrEnabled          !== undefined) p.qmon_asr_enabled           = opts.qmonAsrEnabled;
  if (opts.qmonPddEnabled          !== undefined) p.qmon_pdd_enabled           = opts.qmonPddEnabled;
  if (opts.qmonStatWindow          !== undefined) p.qmon_stat_window           = opts.qmonStatWindow;
  if (opts.qmonAcdThreshold        !== undefined) p.qmon_acd_threshold         = opts.qmonAcdThreshold;
  if (opts.qmonAsrThreshold        !== undefined) p.qmon_asr_threshold         = opts.qmonAsrThreshold;
  if (opts.qmonPddThreshold        !== undefined) p.qmon_pdd_threshold         = opts.qmonPddThreshold;
  if (opts.qmonRetryInterval       !== undefined) p.qmon_retry_interval        = opts.qmonRetryInterval;
  if (opts.qmonRetryBatch          !== undefined) p.qmon_retry_batch           = opts.qmonRetryBatch;
  if (opts.qmonAction              !== undefined) p.qmon_action                = opts.qmonAction;
  if (opts.qmonNotificationEnabled !== undefined) p.qmon_notification_enabled  = opts.qmonNotificationEnabled;
  if (opts.iCustomer               !== undefined) p.i_customer                 = opts.iCustomer;
  return p;
}

export async function createVendorConnection(
  username: string,
  password: string,
  opts: VendorConnectionOpts & { iVendor: number; name: string; destination: string },
  portalUrl?: string,
): Promise<{ success: boolean; message: string; iConnection?: number }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number | boolean | null> = {
    i_vendor:    opts.iVendor,
    name:        opts.name,
    destination: opts.destination,
    i_customer:  opts.iCustomer ?? 1,
    ...buildConnectionParams(opts),
  };

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('createVendorConnection', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const m = extractStructMembers(text);
      const iConnection = parseInt(m['i_connection'] || '0', 10);
      return { success: true, message: 'Vendor connection created.', iConnection: iConnection || undefined };
    }
    const fault = extractTag(text, 'faultString') || 'createVendorConnection failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Update a vendor connection.
 * Official method: updateVendorConnection() — docs 107435
 * Required: i_connection; all other fields optional.
 */
export async function updateVendorConnection(
  username:    string,
  password:    string,
  iConnection: number,
  opts:        VendorConnectionOpts,
  portalUrl?:  string,
): Promise<{ success: boolean; message: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number | boolean | null> = {
    i_connection: iConnection,
    i_customer:   opts.iCustomer ?? 1,
    ...buildConnectionParams(opts),
  };
  if (opts.name        !== undefined) params.name        = opts.name;
  if (opts.destination !== undefined) params.destination = opts.destination;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('updateVendorConnection', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      return { success: true, message: 'Vendor connection updated.' };
    }
    const fault = extractTag(text, 'faultString') || 'updateVendorConnection failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Delete a vendor connection.
 * Official method: deleteVendorConnection() — docs 107435
 */
export async function deleteVendorConnection(
  username: string,
  password: string,
  iConnection: number,
  portalUrl?: string,
): Promise<{ success: boolean; message: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('deleteVendorConnection', { i_connection: iConnection, i_customer: 1 }), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      return { success: true, message: 'Vendor connection deleted.' };
    }
    const fault = extractTag(text, 'faultString') || 'deleteVendorConnection failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

// ── Connection Groups (official Sippy docs 3000135376, since SoftSwitch 2025) ─
//
// Note: Connection groups attached to a trunk are NOT returned by
// getConnectionGroupsList() and cannot be updated/deleted via these APIs.
// All methods support trusted mode — pass iCustomer when needed.

export interface SippyConnectionGroup {
  iConnectionGroup: number;
  name:             string;
  description?:     string;
  policy?:          string;           // 'ordered' | see getSystemDictionary(trunk_policies)
  membersCount?:    number;           // only present when includeMembersCount=true
}

export interface SippyCgMember {
  iCgMember:        number;
  iConnectionGroup: number;
  iConnection:      number;
  orderNo?:         number;           // numeric position in the group
}

function parseConnectionGroupStruct(xml: string): SippyConnectionGroup {
  const m = extractStructMembers(xml);
  return {
    iConnectionGroup: parseInt(m['i_connection_group'] || '0', 10),
    name:             m['name']             || '',
    description:      m['description']      || undefined,
    policy:           m['policy']           || undefined,
    membersCount:     m['members_count']    ? parseInt(m['members_count'], 10) : undefined,
  };
}

function parseCgMemberStruct(xml: string): SippyCgMember {
  const m = extractStructMembers(xml);
  return {
    iCgMember:        parseInt(m['i_cg_member']        || '0', 10),
    iConnectionGroup: parseInt(m['i_connection_group'] || '0', 10),
    iConnection:      parseInt(m['i_connection']       || '0', 10),
    orderNo:          m['order_no'] ? parseInt(m['order_no'], 10) : undefined,
  };
}

/**
 * Create a connection group.
 * Official method: createConnectionGroup() — docs 3000135376
 * Required: name; Optional: description, policy, iCustomer (trusted mode)
 */
export async function createConnectionGroup(
  username:  string,
  password:  string,
  opts: {
    name:         string;
    description?: string;
    policy?:      string;
    iCustomer?:   number;
  },
  portalUrl?: string,
): Promise<{ success: boolean; message: string; iConnectionGroup?: number }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number | boolean | null> = { name: opts.name };
  if (opts.description !== undefined) params.description = opts.description;
  if (opts.policy      !== undefined) params.policy      = opts.policy;
  if (opts.iCustomer   !== undefined) params.i_customer  = opts.iCustomer;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('createConnectionGroup', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const m = extractStructMembers(text);
      const iConnectionGroup = parseInt(m['i_connection_group'] || '0', 10);
      return { success: true, message: 'Connection group created.', iConnectionGroup: iConnectionGroup || undefined };
    }
    const fault = extractTag(text, 'faultString') || 'createConnectionGroup failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Update a connection group.
 * Official method: updateConnectionGroup() — docs 3000135376
 * Required: i_connection_group; Optional: name, description, policy
 */
export async function updateConnectionGroup(
  username:         string,
  password:         string,
  iConnectionGroup: number,
  opts: {
    name?:        string;
    description?: string;
    policy?:      string;
    iCustomer?:   number;
  },
  portalUrl?: string,
): Promise<{ success: boolean; message: string; iConnectionGroup?: number }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number | boolean | null> = { i_connection_group: iConnectionGroup };
  if (opts.name        !== undefined) params.name        = opts.name;
  if (opts.description !== undefined) params.description = opts.description;
  if (opts.policy      !== undefined) params.policy      = opts.policy;
  if (opts.iCustomer   !== undefined) params.i_customer  = opts.iCustomer;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('updateConnectionGroup', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const m = extractStructMembers(text);
      const returned = parseInt(m['i_connection_group'] || '0', 10);
      return { success: true, message: 'Connection group updated.', iConnectionGroup: returned || iConnectionGroup };
    }
    const fault = extractTag(text, 'faultString') || 'updateConnectionGroup failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Delete a connection group.
 * Official method: deleteConnectionGroup() — docs 3000135376
 */
export async function deleteConnectionGroup(
  username:         string,
  password:         string,
  iConnectionGroup: number,
  iCustomer?:       number,
  portalUrl?:       string,
): Promise<{ success: boolean; message: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number> = { i_connection_group: iConnectionGroup };
  if (iCustomer !== undefined) params.i_customer = iCustomer;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('deleteConnectionGroup', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      return { success: true, message: 'Connection group deleted.' };
    }
    const fault = extractTag(text, 'faultString') || 'deleteConnectionGroup failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Get info for a single connection group.
 * Official method: getConnectionGroupInfo() — docs 3000135376
 */
export async function getConnectionGroupInfo(
  username:         string,
  password:         string,
  iConnectionGroup: number,
  iCustomer?:       number,
  portalUrl?:       string,
): Promise<{ success: boolean; connectionGroup?: SippyConnectionGroup; error?: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, error: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number> = { i_connection_group: iConnectionGroup };
  if (iCustomer !== undefined) params.i_customer = iCustomer;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('getConnectionGroupInfo', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const structStart = text.indexOf('<struct>');
      const structEnd   = text.lastIndexOf('</struct>');
      if (structStart === -1) return { success: false, error: 'No connection group data returned.' };
      const structXml = text.slice(structStart, structEnd + 9);
      return { success: true, connectionGroup: parseConnectionGroupStruct(structXml) };
    }
    const fault = extractTag(text, 'faultString') || 'getConnectionGroupInfo failed.';
    return { success: false, error: fault };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/**
 * List connection groups.
 * Official method: getConnectionGroupsList() — docs 3000135376
 * Note: groups attached to a trunk are NOT returned.
 * Optional: namePattern, namePatternNot, includeMembersCount, iCustomer
 */
export async function listConnectionGroups(
  username: string,
  password: string,
  opts?: {
    namePattern?:        string;
    namePatternNot?:     string;
    includeMembersCount?: boolean;
    iCustomer?:          number;
  },
  portalUrl?: string,
): Promise<{ connectionGroups: SippyConnectionGroup[]; error?: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { connectionGroups: [], error: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number | boolean> = {};
  if (opts?.namePattern        !== undefined) params.name_pattern         = opts.namePattern;
  if (opts?.namePatternNot     !== undefined) params.name_pattern_not     = opts.namePatternNot;
  if (opts?.includeMembersCount !== undefined) params.include_members_count = opts.includeMembersCount;
  if (opts?.iCustomer          !== undefined) params.i_customer            = opts.iCustomer;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('getConnectionGroupsList', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const connectionGroups: SippyConnectionGroup[] = [];
      const structRe = /<struct>([\s\S]*?)<\/struct>/g;
      let match: RegExpExecArray | null;
      while ((match = structRe.exec(text)) !== null) {
        try { connectionGroups.push(parseConnectionGroupStruct(match[0])); } catch {}
      }
      return { connectionGroups };
    }
    const fault = extractTag(text, 'faultString') || 'getConnectionGroupsList failed.';
    return { connectionGroups: [], error: fault };
  } catch (e: any) {
    return { connectionGroups: [], error: e.message };
  }
}

// ── CgMembers (part of docs 3000135376) ────────────────────────────────────────
// Note: for vendor connections only. Trunk connections use createTrunkConnection().

/**
 * Add a vendor connection to a connection group.
 * Official method: createCgMember() — docs 3000135376
 * Required: i_connection_group, i_connection
 * Optional: order_no ('first' | 'last' | #integer) — default 'last'
 */
export async function createCgMember(
  username:         string,
  password:         string,
  iConnectionGroup: number,
  iConnection:      number,
  orderNo?:         number | 'first' | 'last',
  iCustomer?:       number,
  portalUrl?:       string,
): Promise<{ success: boolean; message: string; iCgMember?: number }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number> = {
    i_connection_group: iConnectionGroup,
    i_connection:       iConnection,
  };
  if (orderNo   !== undefined) params.order_no   = orderNo as string | number;
  if (iCustomer !== undefined) params.i_customer = iCustomer;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('createCgMember', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const m = extractStructMembers(text);
      const iCgMember = parseInt(m['i_cg_member'] || '0', 10);
      return { success: true, message: 'CG member created.', iCgMember: iCgMember || undefined };
    }
    const fault = extractTag(text, 'faultString') || 'createCgMember failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Update a connection group member (change order or connection).
 * Official method: updateCgMember() — docs 3000135376
 * Required: i_cg_member, order_no; Optional: i_connection
 * order_no values: #integer | 'first' | 'last' | 'up' | 'down'
 */
export async function updateCgMember(
  username:   string,
  password:   string,
  iCgMember:  number,
  orderNo:    number | 'first' | 'last' | 'up' | 'down',
  iConnection?: number,
  iCustomer?:   number,
  portalUrl?:   string,
): Promise<{ success: boolean; message: string; iCgMember?: number }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number> = {
    i_cg_member: iCgMember,
    order_no:    orderNo as string | number,
  };
  if (iConnection !== undefined) params.i_connection = iConnection;
  if (iCustomer   !== undefined) params.i_customer   = iCustomer;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('updateCgMember', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const m = extractStructMembers(text);
      const returned = parseInt(m['i_cg_member'] || '0', 10);
      return { success: true, message: 'CG member updated.', iCgMember: returned || iCgMember };
    }
    const fault = extractTag(text, 'faultString') || 'updateCgMember failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Remove a member from a connection group.
 * Official method: deleteCgMember() — docs 3000135376
 */
export async function deleteCgMember(
  username:   string,
  password:   string,
  iCgMember:  number,
  iCustomer?: number,
  portalUrl?: string,
): Promise<{ success: boolean; message: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number> = { i_cg_member: iCgMember };
  if (iCustomer !== undefined) params.i_customer = iCustomer;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('deleteCgMember', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      return { success: true, message: 'CG member deleted.' };
    }
    const fault = extractTag(text, 'faultString') || 'deleteCgMember failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Get info for a single CG member.
 * Official method: getCgMemberInfo() — docs 3000135376
 */
export async function getCgMemberInfo(
  username:   string,
  password:   string,
  iCgMember:  number,
  iCustomer?: number,
  portalUrl?: string,
): Promise<{ success: boolean; cgMember?: SippyCgMember; error?: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, error: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number> = { i_cg_member: iCgMember };
  if (iCustomer !== undefined) params.i_customer = iCustomer;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('getCgMemberInfo', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const structStart = text.indexOf('<struct>');
      const structEnd   = text.lastIndexOf('</struct>');
      if (structStart === -1) return { success: false, error: 'No CG member data returned.' };
      const structXml = text.slice(structStart, structEnd + 9);
      return { success: true, cgMember: parseCgMemberStruct(structXml) };
    }
    const fault = extractTag(text, 'faultString') || 'getCgMemberInfo failed.';
    return { success: false, error: fault };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/**
 * List all members of a connection group.
 * Official method: getCgMembersList() — docs 3000135376
 * Required: i_connection_group
 */
export async function listCgMembers(
  username:         string,
  password:         string,
  iConnectionGroup: number,
  iCustomer?:       number,
  portalUrl?:       string,
): Promise<{ cgMembers: SippyCgMember[]; error?: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { cgMembers: [], error: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number> = { i_connection_group: iConnectionGroup };
  if (iCustomer !== undefined) params.i_customer = iCustomer;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('getCgMembersList', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const cgMembers: SippyCgMember[] = [];
      const structRe = /<struct>([\s\S]*?)<\/struct>/g;
      let match: RegExpExecArray | null;
      while ((match = structRe.exec(text)) !== null) {
        try { cgMembers.push(parseCgMemberStruct(match[0])); } catch {}
      }
      return { cgMembers };
    }
    const fault = extractTag(text, 'faultString') || 'getCgMembersList failed.';
    return { cgMembers: [], error: fault };
  } catch (e: any) {
    return { cgMembers: [], error: e.message };
  }
}

// ── Environments (official Sippy docs 3000043578 / 3000044255-3000044609) ─────
// Available since V4.5. Root customer + first environment only.
// All methods support trusted mode (i_customer).

// ─ Shared types ───────────────────────────────────────────────────────────────

/** Fields common to both createEnvironment and getEnvironmentInfo. */
export type EnvironmentOpts = {
  // Required for create, optional for update
  name?:                   string;
  httpsCname?:             string;             // hostname for HTTP-server
  assignedIps?:            string | null;      // comma-separated IPs; null = "Unassigned"
  // Capacity
  maxCps?:                 number | null;      // null = Unlimited
  maxSessions?:            number | null;      // null = Unlimited
  description?:            string;
  installedModules?:       string;             // comma-separated module list
  // Monitoring flags
  enableSysinfo?:          boolean;
  enableNetband?:          boolean;
  enableCpuutil?:          boolean;
  enableDiskload?:         boolean;
  // Expiry & notifications
  expirationDate?:         string;             // '%H:%M:%S.000 GMT %a %b %d %Y'
  notifyOnExpiration?:     boolean;
  notifyAddresses?:        string;             // comma-separated emails / special <E-Mail> etc.
  // HTTP server
  httpdServers?:           number;             // 0 = Auto
  // SIP logging
  siplogIndexEnabled?:     boolean;
  recordSdp?:              boolean;
  // Contact info
  companyName?:            string;
  salutation?:             string;
  firstName?:              string;
  lastName?:               string;
  midInit?:                string;
  streetAddr?:             string;
  state?:                  string;
  postalCode?:             string;
  city?:                   string;
  country?:                string;
  contact?:                string;
  phone?:                  string;
  fax?:                    string;
  altPhone?:               string;
  altContact?:             string;
  email?:                  string;
  cc?:                     string;
  bcc?:                    string;
  // Deprecated/removed fields (kept for ≤5.0 compat)
  sipPorts?:               string;             // removed since 2021
  httpsCertificate?:       string;             // removed since 2021
  httpsKey?:               string;             // removed since 2021
  // Trusted mode
  iCustomer?:              number;
};

/** Summary row returned by listEnvironments(). */
export interface SippyEnvironmentSummary {
  iEnvironment:   number;
  name:           string;
  httpsCname?:    string;
  description?:   string;
  maxCps?:        number | null;
  maxSessions?:   number | null;
  expirationDate?: string;
  enabled?:       boolean;
  suspendDate?:   string;
  pendingAction?: string;
}

/** Full environment struct returned by getEnvironmentInfo(). */
export interface SippyEnvironmentInfo extends SippyEnvironmentSummary {
  assignedIps?:          string;
  installedModules?:     string;
  enableSysinfo?:        boolean;
  enableNetband?:        boolean;
  enableCpuutil?:        boolean;
  enableDiskload?:       boolean;
  notifyOnExpiration?:   boolean;
  notifyAddresses?:      string;
  httpdServers?:         number;
  siplogIndexEnabled?:   boolean;
  recordSdp?:            boolean;
  companyName?:          string;
  salutation?:           string;
  firstName?:            string;
  lastName?:             string;
  midInit?:              string;
  streetAddr?:           string;
  state?:                string;
  postalCode?:           string;
  city?:                 string;
  country?:              string;
  contact?:              string;
  phone?:                string;
  fax?:                  string;
  altPhone?:             string;
  altContact?:           string;
  email?:                string;
  cc?:                   string;
  bcc?:                  string;
}

/** IP address entry from listSwitchIPs(). */
export interface SippySwitchIp {
  ip:     string;
  status: 'INUSE' | 'AVAILABLE' | string;
}

function buildEnvParams(opts: EnvironmentOpts): Record<string, string | number | boolean | null> {
  const p: Record<string, string | number | boolean | null> = {};
  if (opts.name                !== undefined) p.name                  = opts.name;
  if (opts.httpsCname          !== undefined) p.https_cname           = opts.httpsCname;
  if (opts.assignedIps         !== undefined) p.assigned_ips          = opts.assignedIps;
  if (opts.maxCps              !== undefined) p.max_cps               = opts.maxCps;
  if (opts.maxSessions         !== undefined) p.max_sessions          = opts.maxSessions;
  if (opts.description         !== undefined) p.description           = opts.description;
  if (opts.installedModules    !== undefined) p.installed_modules     = opts.installedModules;
  if (opts.enableSysinfo       !== undefined) p.enable_sysinfo        = opts.enableSysinfo;
  if (opts.enableNetband       !== undefined) p.enable_netband        = opts.enableNetband;
  if (opts.enableCpuutil       !== undefined) p.enable_cpuutil        = opts.enableCpuutil;
  if (opts.enableDiskload      !== undefined) p.enable_diskload       = opts.enableDiskload;
  if (opts.expirationDate      !== undefined) p.expiration_date       = opts.expirationDate;
  if (opts.notifyOnExpiration  !== undefined) p.notify_on_expiration  = opts.notifyOnExpiration;
  if (opts.notifyAddresses     !== undefined) p.notify_addresses      = opts.notifyAddresses;
  if (opts.httpdServers        !== undefined) p.httpd_servers         = opts.httpdServers;
  if (opts.siplogIndexEnabled  !== undefined) p.siplog_index_enabled  = opts.siplogIndexEnabled;
  if (opts.recordSdp           !== undefined) p.record_sdp            = opts.recordSdp;
  if (opts.companyName         !== undefined) p.company_name          = opts.companyName;
  if (opts.salutation          !== undefined) p.salutation            = opts.salutation;
  if (opts.firstName           !== undefined) p.first_name            = opts.firstName;
  if (opts.lastName            !== undefined) p.last_name             = opts.lastName;
  if (opts.midInit             !== undefined) p.mid_init              = opts.midInit;
  if (opts.streetAddr          !== undefined) p.street_addr           = opts.streetAddr;
  if (opts.state               !== undefined) p.state                 = opts.state;
  if (opts.postalCode          !== undefined) p.postal_code           = opts.postalCode;
  if (opts.city                !== undefined) p.city                  = opts.city;
  if (opts.country             !== undefined) p.country               = opts.country;
  if (opts.contact             !== undefined) p.contact               = opts.contact;
  if (opts.phone               !== undefined) p.phone                 = opts.phone;
  if (opts.fax                 !== undefined) p.fax                   = opts.fax;
  if (opts.altPhone            !== undefined) p.alt_phone             = opts.altPhone;
  if (opts.altContact          !== undefined) p.alt_contact           = opts.altContact;
  if (opts.email               !== undefined) p.email                 = opts.email;
  if (opts.cc                  !== undefined) p.cc                    = opts.cc;
  if (opts.bcc                 !== undefined) p.bcc                   = opts.bcc;
  if (opts.sipPorts            !== undefined) p.sip_ports             = opts.sipPorts;
  if (opts.httpsCertificate    !== undefined) p.https_certificate     = opts.httpsCertificate;
  if (opts.httpsKey            !== undefined) p.https_key             = opts.httpsKey;
  if (opts.iCustomer           !== undefined) p.i_customer            = opts.iCustomer;
  return p;
}

function parseEnvSummaryStruct(xml: string): SippyEnvironmentSummary {
  const m = extractStructMembers(xml);
  const parseBool = (v: string | undefined) =>
    v === '1' || v === 'true' ? true : (v === '0' || v === 'false' ? false : undefined);
  return {
    iEnvironment:   parseInt(m['i_environment'] || '0', 10),
    name:           m['name']             || '',
    httpsCname:     m['https_cname']      || undefined,
    description:    m['description']      || undefined,
    maxCps:         m['max_cps']          ? parseInt(m['max_cps'], 10)      : (m['max_cps'] === '' ? null : undefined),
    maxSessions:    m['max_sessions']     ? parseInt(m['max_sessions'], 10) : (m['max_sessions'] === '' ? null : undefined),
    expirationDate: m['expiration_date']  || undefined,
    enabled:        parseBool(m['enabled']),
    suspendDate:    m['suspend_date']     || undefined,
    pendingAction:  m['pending_action']   || undefined,
  };
}

function parseEnvInfoStruct(xml: string): SippyEnvironmentInfo {
  const m = extractStructMembers(xml);
  const parseBool = (v: string | undefined) =>
    v === '1' || v === 'true' ? true : (v === '0' || v === 'false' ? false : undefined);
  const summary = {
    iEnvironment:         parseInt(m['i_environment'] || '0', 10),
    name:                 m['name']                  || '',
    httpsCname:           m['https_cname']            || undefined,
    description:          m['description']            || undefined,
    maxCps:               m['max_cps']      ? parseInt(m['max_cps'], 10)      : (m['max_cps'] === '' ? null : undefined),
    maxSessions:          m['max_sessions'] ? parseInt(m['max_sessions'], 10) : (m['max_sessions'] === '' ? null : undefined),
    expirationDate:       m['expiration_date']        || undefined,
    enabled:              parseBool(m['enabled']),
    suspendDate:          m['suspend_date']           || undefined,
    pendingAction:        m['pending_action']          || undefined,
  };
  return {
    ...summary,
    assignedIps:          m['assigned_ips']           || undefined,
    installedModules:     m['installed_modules']      || undefined,
    enableSysinfo:        parseBool(m['enable_sysinfo']),
    enableNetband:        parseBool(m['enable_netband']),
    enableCpuutil:        parseBool(m['enable_cpuutil']),
    enableDiskload:       parseBool(m['enable_diskload']),
    notifyOnExpiration:   parseBool(m['notify_on_expiration']),
    notifyAddresses:      m['notify_addresses']       || undefined,
    httpdServers:         m['httpd_servers']  ? parseInt(m['httpd_servers'], 10) : undefined,
    siplogIndexEnabled:   parseBool(m['siplog_index_enabled']),
    recordSdp:            parseBool(m['record_sdp']),
    companyName:          m['company_name']            || undefined,
    salutation:           m['salutation']              || undefined,
    firstName:            m['first_name']              || undefined,
    lastName:             m['last_name']               || undefined,
    midInit:              m['mid_init']                || undefined,
    streetAddr:           m['street_addr']             || undefined,
    state:                m['state']                   || undefined,
    postalCode:           m['postal_code']             || undefined,
    city:                 m['city']                    || undefined,
    country:              m['country']                 || undefined,
    contact:              m['contact']                 || undefined,
    phone:                m['phone']                   || undefined,
    fax:                  m['fax']                     || undefined,
    altPhone:             m['alt_phone']               || undefined,
    altContact:           m['alt_contact']             || undefined,
    email:                m['email']                   || undefined,
    cc:                   m['cc']                      || undefined,
    bcc:                  m['bcc']                     || undefined,
  };
}

// ─ listSwitchIPs ──────────────────────────────────────────────────────────────

/**
 * List IP addresses configured on the softswitch.
 * Official method: listSwitchIPs() — docs 3000043578
 * Returns AVAILABLE (assignable to env) and INUSE (already assigned) IPs.
 * Root customer + first environment only.
 */
export async function listSwitchIPs(
  username:   string,
  password:   string,
  iCustomer?: number,
  portalUrl?: string,
): Promise<{ ips: SippySwitchIp[]; error?: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { ips: [], error: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, number> = {};
  if (iCustomer !== undefined) params.i_customer = iCustomer;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('listSwitchIPs', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const ips: SippySwitchIp[] = [];
      const structRe = /<struct>([\s\S]*?)<\/struct>/g;
      let match: RegExpExecArray | null;
      while ((match = structRe.exec(text)) !== null) {
        const m = extractStructMembers(match[0]);
        if (m['ip']) ips.push({ ip: m['ip'], status: m['status'] || '' });
      }
      return { ips };
    }
    const fault = extractTag(text, 'faultString') || 'listSwitchIPs failed.';
    return { ips: [], error: fault };
  } catch (e: any) {
    return { ips: [], error: e.message };
  }
}

// ─ createEnvironment ──────────────────────────────────────────────────────────

/**
 * Create a new environment.
 * Official method: createEnvironment() — docs 3000044255
 * Required: name, httpsCname, assignedIps
 * Root customer + first environment only.
 */
export async function createEnvironment(
  username:  string,
  password:  string,
  opts:      EnvironmentOpts & { name: string; httpsCname: string; assignedIps: string | null },
  portalUrl?: string,
): Promise<{ success: boolean; message: string; iEnvironment?: number }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params = buildEnvParams(opts);

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('createEnvironment', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const m = extractStructMembers(text);
      const iEnvironment = parseInt(m['i_environment'] || '0', 10);
      return { success: true, message: 'Environment created.', iEnvironment: iEnvironment || undefined };
    }
    const fault = extractTag(text, 'faultString') || 'createEnvironment failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

// ─ updateEnvironment ──────────────────────────────────────────────────────────

/**
 * Update an existing environment.
 * Official method: updateEnvironment() — docs 3000044284
 * Required: i_environment; Optional: any EnvironmentOpts field.
 * Root customer + first environment only.
 */
export async function updateEnvironment(
  username:      string,
  password:      string,
  iEnvironment:  number,
  opts:          EnvironmentOpts,
  portalUrl?:    string,
): Promise<{ success: boolean; message: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params = { i_environment: iEnvironment, ...buildEnvParams(opts) };

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('updateEnvironment', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      return { success: true, message: 'Environment updated.' };
    }
    const fault = extractTag(text, 'faultString') || 'updateEnvironment failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

// ─ deleteEnvironment ──────────────────────────────────────────────────────────

/**
 * Delete an environment (legacy — removed in Sippy 5.0+).
 * Official method: deleteEnvironment() — docs 3000044399
 * For Sippy 5.0+ use queueEnvironmentAction(delete) instead.
 * Only stopped or suspended environments can be deleted.
 * Root customer + first environment only.
 */
export async function deleteEnvironment(
  username:      string,
  password:      string,
  iEnvironment:  number,
  iCustomer?:    number,
  portalUrl?:    string,
): Promise<{ success: boolean; message: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, number> = { i_environment: iEnvironment };
  if (iCustomer !== undefined) params.i_customer = iCustomer;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('deleteEnvironment', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      return { success: true, message: 'Environment deleted.' };
    }
    const fault = extractTag(text, 'faultString') || 'deleteEnvironment failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

// ─ getEnvironmentInfo ─────────────────────────────────────────────────────────

/**
 * Get full details for a single environment.
 * Official method: getEnvironmentInfo() — docs 3000044572
 * Root customer + first environment only.
 */
export async function getEnvironmentInfo(
  username:      string,
  password:      string,
  iEnvironment:  number,
  iCustomer?:    number,
  portalUrl?:    string,
): Promise<{ success: boolean; environment?: SippyEnvironmentInfo; error?: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, error: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, number> = { i_environment: iEnvironment };
  if (iCustomer !== undefined) params.i_customer = iCustomer;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('getEnvironmentInfo', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const structStart = text.indexOf('<struct>');
      const structEnd   = text.lastIndexOf('</struct>');
      if (structStart === -1) return { success: false, error: 'No environment data returned.' };
      return { success: true, environment: parseEnvInfoStruct(text.slice(structStart, structEnd + 9)) };
    }
    const fault = extractTag(text, 'faultString') || 'getEnvironmentInfo failed.';
    return { success: false, error: fault };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// ─ listEnvironments ───────────────────────────────────────────────────────────

/**
 * List all environments (summary records).
 * Official method: listEnvironments() — docs 3000044582
 * Optional: offset, limit (for pagination).
 * Root customer + first environment only.
 */
export async function listEnvironments(
  username:   string,
  password:   string,
  opts?: {
    offset?:    number;
    limit?:     number;
    iCustomer?: number;
  },
  portalUrl?: string,
): Promise<{ environments: SippyEnvironmentSummary[]; error?: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { environments: [], error: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, number> = {};
  if (opts?.offset    !== undefined) params.offset     = opts.offset;
  if (opts?.limit     !== undefined) params.limit      = opts.limit;
  if (opts?.iCustomer !== undefined) params.i_customer = opts.iCustomer;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('listEnvironments', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const environments: SippyEnvironmentSummary[] = [];
      const structRe = /<struct>([\s\S]*?)<\/struct>/g;
      let match: RegExpExecArray | null;
      while ((match = structRe.exec(text)) !== null) {
        try { environments.push(parseEnvSummaryStruct(match[0])); } catch {}
      }
      return { environments };
    }
    const fault = extractTag(text, 'faultString') || 'listEnvironments failed.';
    return { environments: [], error: fault };
  } catch (e: any) {
    return { environments: [], error: e.message };
  }
}

// ─ queueEnvironmentAction ────────────────────────────────────────────────────

/**
 * Queue a lifecycle action for an environment.
 * Official method: queueEnvironmentAction() — docs 3000044609
 * action: 'start' | 'stop' | 'restart' | 'suspend' | 'delete'
 * Optional: suspendMessage (shown in web UI when suspended)
 * Note: 'delete' replaces deleteEnvironment() since Sippy 5.0+.
 * Root customer + first environment only.
 */
export async function queueEnvironmentAction(
  username:      string,
  password:      string,
  iEnvironment:  number,
  action:        'start' | 'stop' | 'restart' | 'suspend' | 'delete',
  suspendMessage?: string,
  iCustomer?:    number,
  portalUrl?:    string,
): Promise<{ success: boolean; message: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number> = {
    i_environment: iEnvironment,
    action,
  };
  if (suspendMessage !== undefined) params.suspend_message = suspendMessage;
  if (iCustomer      !== undefined) params.i_customer      = iCustomer;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('queueEnvironmentAction', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      return { success: true, message: `Action '${action}' queued for environment ${iEnvironment}.` };
    }
    const fault = extractTag(text, 'faultString') || 'queueEnvironmentAction failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

// ── Tariff Management (official Sippy docs 3000098586, since Sippy 2020) ─────

/**
 * Create a new tariff.
 * Official method: createTariff() — docs 3000098586 (available since Sippy 2020)
 */
export async function createSippyTariff(
  username: string,
  password: string,
  opts: { name: string; currency: string; connectFee?: number; freeSeconds?: number },
  portalUrl?: string,
): Promise<{ success: boolean; message: string; iTariff?: number }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number | boolean> = {
    name: opts.name,
    currency: opts.currency,
  };
  if (opts.connectFee  !== undefined) params.connect_fee  = opts.connectFee;
  if (opts.freeSeconds !== undefined) params.free_seconds = opts.freeSeconds;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('createTariff', params), username, password);
    if (resp.statusCode === 200 && !resp.body.includes('<fault>')) {
      const m = extractStructMembers(resp.body);
      const iTariff = parseInt(m['i_tariff'] || '0', 10);
      return { success: true, message: 'Tariff created.', iTariff: iTariff || undefined };
    }
    const fault = extractTag(resp.body, 'faultString') || 'createTariff failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

// ── External Balance Daemon — XML-RPC-accessible methods ─────────────────────
//
// Reference: https://support.sippysoft.com/support/solutions/articles/3000070859
//
// The External Balance Daemon consists of two parts:
//   1. Real-time Thrift binary service (for call processing engine) — separate port,
//      NOT accessible via HTTP XML-RPC. Methods: get_balance, make_debit, add_credit,
//      block_amount, unblock_amount, clear_blocked_amounts, register_service,
//      next_i_balance_update. Our app does NOT implement Thrift.
//
//   2. XML-RPC management methods (used by Sippy Web UI) — accessible via /xmlapi/xmlapi:
//      get_balances, get_totals, set_credit_limit, create_balance, inc_ref_count, dec_ref_count.
//      These operate on "balance entities" (i_balance) linked to Customers, Accounts, Vendors.
//
// The i_balance identifier is returned inside each Customer / Account / Vendor record.
// Balance entities have three attributes: balance, credit_limit, commodity (currency code).

/**
 * Fetch multiple balance entities by their i_balance IDs.
 * Official method: Customer.get_balances(i_balances[], filter)
 *
 * filter is optional — when provided, only returns entities whose balance, credit_limit
 * or available_balance (= credit_limit - balance) match the expression.
 * Returns array of { i_balance, balance, credit_limit, commodity, available_balance }.
 */
export async function getSippyBalances(
  username: string,
  password: string,
  iBalances: number[],
  portalUrl?: string,
): Promise<Array<{ iBalance: number; balance: number; creditLimit: number; commodity: string; availableBalance: number }>> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base || !iBalances.length) return [];
  const apiUrl = `${base}/xmlapi/xmlapi`;

  // Build XML-RPC array of int values for i_balances[]
  const arrayXml = `<array><data>${iBalances.map(id => `<value><int>${id}</int></value>`).join('')}</data></array>`;
  const body = `<?xml version="1.0"?><methodCall><methodName>Customer.get_balances</methodName><params><param><value>${arrayXml}</value></param></params></methodCall>`;

  try {
    const resp = await sippyPost(apiUrl, body, username, password);
    if (resp.statusCode !== 200 || resp.body.includes('<fault>')) return [];

    // Parse array of structs
    const results: Array<{ iBalance: number; balance: number; creditLimit: number; commodity: string; availableBalance: number }> = [];
    const memberRe = /<struct>([\s\S]*?)<\/struct>/g;
    let m;
    while ((m = memberRe.exec(resp.body)) !== null) {
      const struct = m[1];
      const f = (n: string) => { const match = struct.match(new RegExp(`<name>${n}<\\/name>[^<]*<value><(?:double|int|string|i4)>([^<]*)</`)); return match?.[1] ?? ''; };
      results.push({
        iBalance:        Number(f('i_balance')),
        balance:         parseFloat(f('balance'))      || 0,
        creditLimit:     parseFloat(f('credit_limit')) || 0,
        commodity:       f('commodity'),
        availableBalance: parseFloat(f('available_balance')) || 0,
      });
    }
    return results;
  } catch { return []; }
}

/**
 * Get aggregate balance totals for a list of balance entities, grouped by commodity.
 * Official method: Customer.get_totals(i_balances[])
 * Returns array of { commodity, totalBalance, totalCreditLimit }.
 */
export async function getSippyBalanceTotals(
  username: string,
  password: string,
  iBalances: number[],
  portalUrl?: string,
): Promise<Array<{ commodity: string; totalBalance: number; totalCreditLimit: number }>> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base || !iBalances.length) return [];
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const arrayXml = `<array><data>${iBalances.map(id => `<value><int>${id}</int></value>`).join('')}</data></array>`;
  const body = `<?xml version="1.0"?><methodCall><methodName>Customer.get_totals</methodName><params><param><value>${arrayXml}</value></param></params></methodCall>`;

  try {
    const resp = await sippyPost(apiUrl, body, username, password);
    if (resp.statusCode !== 200 || resp.body.includes('<fault>')) return [];

    const results: Array<{ commodity: string; totalBalance: number; totalCreditLimit: number }> = [];
    const memberRe = /<struct>([\s\S]*?)<\/struct>/g;
    let m;
    while ((m = memberRe.exec(resp.body)) !== null) {
      const struct = m[1];
      const f = (n: string) => { const match = struct.match(new RegExp(`<name>${n}<\\/name>[^<]*<value><(?:double|int|string|i4)>([^<]*)</`)); return match?.[1] ?? ''; };
      results.push({
        commodity:       f('commodity'),
        totalBalance:    parseFloat(f('balance'))      || 0,
        totalCreditLimit: parseFloat(f('credit_limit')) || 0,
      });
    }
    return results;
  } catch { return []; }
}

/**
 * Set the credit limit on a balance entity directly.
 * Official method: Customer.set_credit_limit(i_balance, credit_limit)
 *
 * i_balance is the balance entity ID (returned in customer/account records).
 * This is the balance-daemon-side way to set credit limits, as opposed to
 * updateCustomer(credit_limit=…) which goes through the customer record.
 * Both achieve the same outcome; this method is more atomic and immediate.
 */
export async function setSippyBalanceCreditLimit(
  username: string,
  password: string,
  iBalance: number,
  creditLimit: number,
  portalUrl?: string,
): Promise<{ success: boolean; message: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('Customer.set_credit_limit', { i_balance: iBalance, credit_limit: creditLimit }), username, password);
    if (resp.statusCode === 200 && !resp.body.includes('<fault>')) {
      return { success: true, message: 'Credit limit updated.' };
    }
    const fault = extractTag(resp.body, 'faultString') || 'set_credit_limit failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Create a new balance entity on the External Balance Daemon.
 * Official method: Customer.create_balance(balance, credit_limit, commodity, ref_count)
 * Returns the i_balance ID of the newly created entity.
 * The commodity becomes a read-only attribute (currency code, e.g. 'USD').
 * ref_count must be at least 1.
 * docs 3000070859
 */
export async function createSippyBalance(
  username: string,
  password: string,
  opts: {
    balance:      number;
    creditLimit:  number;
    commodity:    string;   // currency code, e.g. 'USD'
    refCount:     number;   // must be >= 1
    portalUrl?:   string;
  },
): Promise<{ success: boolean; iBalance?: number; message: string }> {
  const base = opts.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  try {
    const body = xmlRpcCall('Customer.create_balance', {
      balance:      opts.balance,
      credit_limit: opts.creditLimit,
      commodity:    opts.commodity,
      ref_count:    opts.refCount,
    });
    const resp = await sippyPost(apiUrl, body, username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const m = extractStructMembers(text);
      const iBalance = m['i_balance'] ? parseInt(m['i_balance'], 10) : undefined;
      return { success: true, iBalance, message: 'Balance entity created.' };
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'create_balance failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Increment the reference counter of a balance entity.
 * Official method: Customer.inc_ref_count(i_balance, i_balance_update)
 * i_balance_update is a unique token from next_i_balance_update() (Thrift side).
 * When called via XML-RPC management path, pass 0 or omit i_balance_update.
 * docs 3000070859
 */
export async function incSippyBalanceRefCount(
  username: string,
  password: string,
  iBalance: number,
  iBalanceUpdate: number,
  portalUrl?: string,
): Promise<{ success: boolean; message: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('Customer.inc_ref_count', { i_balance: iBalance, i_balance_update: iBalanceUpdate }), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      return { success: true, message: 'Reference count incremented.' };
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'inc_ref_count failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Decrement the reference counter of a balance entity.
 * Official method: Customer.dec_ref_count(i_balance, i_balance_update)
 * When the counter reaches zero the entity is safe to delete (no explicit delete method).
 * docs 3000070859
 */
export async function decSippyBalanceRefCount(
  username: string,
  password: string,
  iBalance: number,
  iBalanceUpdate: number,
  portalUrl?: string,
): Promise<{ success: boolean; message: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('Customer.dec_ref_count', { i_balance: iBalance, i_balance_update: iBalanceUpdate }), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      return { success: true, message: 'Reference count decremented.' };
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'dec_ref_count failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Delete a tariff from Sippy.
 * Official method: deleteTariff() — docs 3000098586 (available since Sippy 2020)
 */
export async function deleteSippyTariff(
  username: string,
  password: string,
  iTariff: number,
  portalUrl?: string,
): Promise<{ success: boolean; message: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('deleteTariff', { i_tariff: iTariff }), username, password);
    if (resp.statusCode === 200 && !resp.body.includes('<fault>')) {
      return { success: true, message: 'Tariff deleted.' };
    }
    const fault = extractTag(resp.body, 'faultString') || 'deleteTariff failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

// ── Payments (official Sippy docs 107440/107442/107443/107446/107438/150644) ──

// ─ Shared types ───────────────────────────────────────────────────────────────

/** Card type IDs used by addDebitCreditCard / makePaymentByCard */
export const CARD_TYPES: Record<number, string> = {
  1: 'Visa',
  2: 'American Express',
  3: 'MasterCard',
  4: 'Discover',
  5: 'JCB',
  6: "Diner's Club",
};

/** A stored debit/credit card returned by getDebitCreditCardInfo / listDebitCreditCards. */
export interface SippyDebitCreditCard {
  iDebitCreditCard: number;
  alias:            string;
  iCardType:        number;
  cardName?:        string;   // human-readable type, from list response
  number?:          string;   // last 4 digits only (never full number)
  holder?:          string;
  expMm?:           number;
  expYy?:           number;
  streetAddr1?:     string;
  streetAddr2?:     string;
  state?:           string;
  postalCode?:      string;
  city?:            string;
  country?:         string;
  phone?:           string;
  primary?:         boolean;
}

/** A payment record returned by getPaymentInfo / getPaymentsList. */
export interface SippyPayment {
  iPayment?:         number;
  paymentTime?:      string;   // '%H:%M:%S.000 GMT %a %b %d %Y'
  amount?:           number;
  currency?:         string;
  txId?:             string;
  txError?:          string;
  txResult?:         number;   // 1=success, 2=failed
  byCreditDebitCard?: boolean;
  byVoucher?:        boolean;
  notes?:            string;
  iAccount?:         number;
  iCustomer?:        number;
}

function parseDebitCreditCardStruct(xml: string): SippyDebitCreditCard {
  const m = extractStructMembers(xml);
  const parseBool = (v?: string) =>
    v === '1' || v === 'true' ? true : (v === '0' || v === 'false' ? false : undefined);
  return {
    iDebitCreditCard: parseInt(m['i_debit_credit_card'] || '0', 10),
    alias:            m['alias']       || '',
    iCardType:        parseInt(m['i_card_type'] || '0', 10),
    cardName:         m['card_name']   || undefined,
    number:           m['number']      || undefined,
    holder:           m['holder']      || undefined,
    expMm:            m['exp_mm']      ? parseInt(m['exp_mm'], 10)  : undefined,
    expYy:            m['exp_yy']      ? parseInt(m['exp_yy'], 10)  : undefined,
    streetAddr1:      m['street_addr1'] || undefined,
    streetAddr2:      m['street_addr2'] || undefined,
    state:            m['state']       || undefined,
    postalCode:       m['postal_code'] || undefined,
    city:             m['city']        || undefined,
    country:          m['country']     || undefined,
    phone:            m['phone']       || undefined,
    primary:          parseBool(m['primary']),
  };
}

function parsePaymentStruct(xml: string): SippyPayment {
  const m = extractStructMembers(xml);
  const parseBool = (v?: string) =>
    v === '1' || v === 'true' ? true : (v === '0' || v === 'false' ? false : undefined);
  return {
    iPayment:         m['i_payment']          ? parseInt(m['i_payment'], 10)    : undefined,
    paymentTime:      m['payment_time']        || undefined,
    amount:           m['amount']             ? parseFloat(m['amount'])          : undefined,
    currency:         m['currency']            || undefined,
    txId:             m['tx_id']               || undefined,
    txError:          m['tx_error']            || undefined,
    txResult:         m['tx_result']          ? parseInt(m['tx_result'], 10)    : undefined,
    byCreditDebitCard: parseBool(m['by_credit_debit_card']),
    byVoucher:        parseBool(m['by_voucher']),
    notes:            m['notes']               || undefined,
    iAccount:         m['i_account']          ? parseInt(m['i_account'], 10)    : undefined,
    iCustomer:        m['i_customer']         ? parseInt(m['i_customer'], 10)   : undefined,
  };
}

// ─ Debit / Credit Card CRUD (doc 107442) ─────────────────────────────────────

/** Shared card fields used by addDebitCreditCard / updateDebitCreditCard. */
export type DebitCreditCardOpts = {
  alias?:       string;
  iCardType?:   number;
  number?:      string;
  holder?:      string;
  expMm?:       number;
  expYy?:       number;
  cvv?:         string;
  streetAddr1?: string;
  streetAddr2?: string;
  state?:       string;
  postalCode?:  string;
  city?:        string;
  country?:     string;
  phone?:       string;
  primary?:     boolean;
};

function buildCardParams(opts: DebitCreditCardOpts): Record<string, string | number | boolean> {
  const p: Record<string, string | number | boolean> = {};
  if (opts.alias       !== undefined) p.alias        = opts.alias;
  if (opts.iCardType   !== undefined) p.i_card_type  = opts.iCardType;
  if (opts.number      !== undefined) p.number       = opts.number;
  if (opts.holder      !== undefined) p.holder       = opts.holder;
  if (opts.expMm       !== undefined) p.exp_mm       = opts.expMm;
  if (opts.expYy       !== undefined) p.exp_yy       = opts.expYy;
  if (opts.cvv         !== undefined) p.cvv          = opts.cvv;
  if (opts.streetAddr1 !== undefined) p.street_addr1 = opts.streetAddr1;
  if (opts.streetAddr2 !== undefined) p.street_addr2 = opts.streetAddr2;
  if (opts.state       !== undefined) p.state        = opts.state;
  if (opts.postalCode  !== undefined) p.postal_code  = opts.postalCode;
  if (opts.city        !== undefined) p.city         = opts.city;
  if (opts.country     !== undefined) p.country      = opts.country;
  if (opts.phone       !== undefined) p.phone        = opts.phone;
  if (opts.primary     !== undefined) p.primary      = opts.primary;
  return p;
}

/**
 * Add a debit/credit card.
 * Official method: addDebitCreditCard() — docs 107442
 * Note: Either iAccount OR iCustomer must be supplied.
 */
export async function addDebitCreditCard(
  username:   string,
  password:   string,
  owner:      { iAccount?: number; iCustomer?: number },
  opts:       DebitCreditCardOpts & {
    alias: string; iCardType: number; number: string; holder: string;
    expMm: number; expYy: number; streetAddr1: string; state: string;
    postalCode: string; city: string; country: string; phone: string;
  },
  portalUrl?: string,
): Promise<{ success: boolean; message: string; iDebitCreditCard?: number }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number | boolean> = { ...buildCardParams(opts) };
  if (owner.iAccount  !== undefined) params.i_account  = owner.iAccount;
  if (owner.iCustomer !== undefined) params.i_customer = owner.iCustomer;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('addDebitCreditCard', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const m = extractStructMembers(text);
      const iDebitCreditCard = parseInt(m['i_debit_credit_card'] || '0', 10);
      return { success: true, message: 'Card added.', iDebitCreditCard: iDebitCreditCard || undefined };
    }
    return { success: false, message: extractTag(text, 'faultString') || 'addDebitCreditCard failed.' };
  } catch (e: any) { return { success: false, message: e.message }; }
}

/**
 * Update a debit/credit card.
 * Official method: updateDebitCreditCard() — docs 107442
 * Note: Either iAccount OR iCustomer must be supplied.
 */
export async function updateDebitCreditCard(
  username:        string,
  password:        string,
  iDebitCreditCard: number,
  owner:           { iAccount?: number; iCustomer?: number },
  opts:            DebitCreditCardOpts,
  portalUrl?:      string,
): Promise<{ success: boolean; message: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number | boolean> = {
    i_debit_credit_card: iDebitCreditCard,
    ...buildCardParams(opts),
  };
  if (owner.iAccount  !== undefined) params.i_account  = owner.iAccount;
  if (owner.iCustomer !== undefined) params.i_customer = owner.iCustomer;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('updateDebitCreditCard', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) return { success: true, message: 'Card updated.' };
    return { success: false, message: extractTag(text, 'faultString') || 'updateDebitCreditCard failed.' };
  } catch (e: any) { return { success: false, message: e.message }; }
}

/**
 * Delete a debit/credit card.
 * Official method: deleteDebitCreditCard() — docs 107442
 * Note: Either iAccount OR iCustomer must be supplied.
 */
export async function deleteDebitCreditCard(
  username:         string,
  password:         string,
  iDebitCreditCard: number,
  owner:            { iAccount?: number; iCustomer?: number },
  portalUrl?:       string,
): Promise<{ success: boolean; message: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number> = { i_debit_credit_card: iDebitCreditCard };
  if (owner.iAccount  !== undefined) params.i_account  = owner.iAccount;
  if (owner.iCustomer !== undefined) params.i_customer = owner.iCustomer;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('deleteDebitCreditCard', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) return { success: true, message: 'Card deleted.' };
    return { success: false, message: extractTag(text, 'faultString') || 'deleteDebitCreditCard failed.' };
  } catch (e: any) { return { success: false, message: e.message }; }
}

/**
 * Get info for a single debit/credit card.
 * Official method: getDebitCreditCardInfo() — docs 107442
 * Note: Card number returned as last 4 digits only. CVV never returned.
 */
export async function getDebitCreditCardInfo(
  username:         string,
  password:         string,
  iDebitCreditCard: number,
  owner:            { iAccount?: number; iCustomer?: number },
  portalUrl?:       string,
): Promise<{ success: boolean; card?: SippyDebitCreditCard; error?: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, error: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number> = { i_debit_credit_card: iDebitCreditCard };
  if (owner.iAccount  !== undefined) params.i_account  = owner.iAccount;
  if (owner.iCustomer !== undefined) params.i_customer = owner.iCustomer;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('getDebitCreditCardInfo', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const s = text.indexOf('<struct>'), e = text.lastIndexOf('</struct>');
      if (s === -1) return { success: false, error: 'No card data returned.' };
      return { success: true, card: parseDebitCreditCardStruct(text.slice(s, e + 9)) };
    }
    return { success: false, error: extractTag(text, 'faultString') || 'getDebitCreditCardInfo failed.' };
  } catch (e: any) { return { success: false, error: e.message }; }
}

/**
 * List all debit/credit cards for an account or customer.
 * Official method: listDebitCreditCards() — docs 107442
 * Optional: offset, limit for pagination.
 */
export async function listDebitCreditCards(
  username:  string,
  password:  string,
  owner:     { iAccount?: number; iCustomer?: number },
  opts?:     { offset?: number; limit?: number },
  portalUrl?: string,
): Promise<{ cards: SippyDebitCreditCard[]; error?: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { cards: [], error: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, number> = {};
  if (owner.iAccount  !== undefined) params.i_account  = owner.iAccount;
  if (owner.iCustomer !== undefined) params.i_customer = owner.iCustomer;
  if (opts?.offset    !== undefined) params.offset     = opts.offset;
  if (opts?.limit     !== undefined) params.limit      = opts.limit;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('listDebitCreditCards', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const cards: SippyDebitCreditCard[] = [];
      const arrayMatch = /<name>debit_credit_cards<\/name>\s*<value>\s*<array>\s*<data>([\s\S]*?)<\/data>\s*<\/array>/i.exec(text);
      if (arrayMatch) {
        const structRe = /<struct>([\s\S]*?)<\/struct>/g;
        let m: RegExpExecArray | null;
        while ((m = structRe.exec(arrayMatch[1])) !== null) {
          try { cards.push(parseDebitCreditCardStruct(m[0])); } catch {}
        }
      }
      return { cards };
    }
    return { cards: [], error: extractTag(text, 'faultString') || 'listDebitCreditCards failed.' };
  } catch (e: any) { return { cards: [], error: e.message }; }
}

// ─ Account Balance Mutations (doc 107440) ─────────────────────────────────────

/** Shared balance mutation helper for accountAddFunds / accountCredit / accountDebit. */
async function accountBalanceMutation(
  method:    string,
  username:  string,
  password:  string,
  iAccount:  number,
  amount:    number,
  currency:  string,
  opts?:     { paymentNotes?: string; paymentTime?: string },
  portalUrl?: string,
): Promise<{ success: boolean; message: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const params: Record<string, string | number> = { i_account: iAccount, amount, currency };
  if (opts?.paymentNotes !== undefined) params.payment_notes = opts.paymentNotes;
  if (opts?.paymentTime  !== undefined) params.payment_time  = opts.paymentTime;
  try {
    const resp = await sippyPost(`${base}/xmlapi/xmlapi`, xmlRpcCall(method, params), username, password);
    if (resp.statusCode === 200 && !resp.body.includes('<fault>')) return { success: true, message: `${method} OK.` };
    return { success: false, message: extractTag(resp.body, 'faultString') || `${method} failed.` };
  } catch (e: any) { return { success: false, message: e.message }; }
}

/**
 * Add funds to (increase) an account balance.
 * Official method: accountAddFunds() — docs 107440
 */
export const accountAddFunds = (u: string, p: string, iAccount: number, amount: number, currency: string,
  opts?: { paymentNotes?: string; paymentTime?: string }, portalUrl?: string) =>
  accountBalanceMutation('accountAddFunds', u, p, iAccount, amount, currency, opts, portalUrl);

/**
 * Credit an account (increase balance, recorded as credit transaction).
 * Official method: accountCredit() — docs 107440
 */
export const accountCredit = (u: string, p: string, iAccount: number, amount: number, currency: string,
  opts?: { paymentNotes?: string; paymentTime?: string }, portalUrl?: string) =>
  accountBalanceMutation('accountCredit', u, p, iAccount, amount, currency, opts, portalUrl);

/**
 * Debit an account (reduce balance).
 * Official method: accountDebit() — docs 107440
 */
export const accountDebit = (u: string, p: string, iAccount: number, amount: number, currency: string,
  opts?: { paymentNotes?: string; paymentTime?: string }, portalUrl?: string) =>
  accountBalanceMutation('accountDebit', u, p, iAccount, amount, currency, opts, portalUrl);

// ─ Customer Balance Mutations (doc 150644) ────────────────────────────────────

/** Shared balance mutation helper for customerAddFunds / customerCredit / customerDebit. */
async function customerBalanceMutation(
  method:    string,
  username:  string,
  password:  string,
  iCustomer: number,
  amount:    number,
  currency:  string,
  opts?:     { paymentNotes?: string; paymentTime?: string; iWholesaler?: number },
  portalUrl?: string,
): Promise<{ success: boolean; message: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const params: Record<string, string | number> = { i_customer: iCustomer, amount, currency };
  if (opts?.paymentNotes !== undefined) params.payment_notes = opts.paymentNotes;
  if (opts?.paymentTime  !== undefined) params.payment_time  = opts.paymentTime;
  if (opts?.iWholesaler  !== undefined) params.i_wholesaler  = opts.iWholesaler;
  try {
    const resp = await sippyPost(`${base}/xmlapi/xmlapi`, xmlRpcCall(method, params), username, password);
    if (resp.statusCode === 200 && !resp.body.includes('<fault>')) return { success: true, message: `${method} OK.` };
    return { success: false, message: extractTag(resp.body, 'faultString') || `${method} failed.` };
  } catch (e: any) { return { success: false, message: e.message }; }
}

/**
 * Add funds to (increase) a customer balance.
 * Official method: customerAddFunds() — docs 150644
 */
export const customerAddFunds = (u: string, p: string, iCustomer: number, amount: number, currency: string,
  opts?: { paymentNotes?: string; paymentTime?: string; iWholesaler?: number }, portalUrl?: string) =>
  customerBalanceMutation('customerAddFunds', u, p, iCustomer, amount, currency, opts, portalUrl);

/**
 * Credit a customer (increase balance, recorded as credit transaction).
 * Official method: customerCredit() — docs 150644
 */
export const customerCredit = (u: string, p: string, iCustomer: number, amount: number, currency: string,
  opts?: { paymentNotes?: string; paymentTime?: string; iWholesaler?: number }, portalUrl?: string) =>
  customerBalanceMutation('customerCredit', u, p, iCustomer, amount, currency, opts, portalUrl);

/**
 * Debit a customer (reduce balance).
 * Official method: customerDebit() — docs 150644
 */
export const customerDebit = (u: string, p: string, iCustomer: number, amount: number, currency: string,
  opts?: { paymentNotes?: string; paymentTime?: string; iWholesaler?: number }, portalUrl?: string) =>
  customerBalanceMutation('customerDebit', u, p, iCustomer, amount, currency, opts, portalUrl);

// ─ Payment Info (doc 107446) ──────────────────────────────────────────────────

/**
 * Get details for a single payment.
 * Official method: getPaymentInfo() — docs 107446
 * Note: Either iAccount OR iCustomer must be supplied.
 * Trusted mode: supply iWholesaler.
 */
export async function getPaymentInfo(
  username:    string,
  password:    string,
  iPayment:    number,
  owner:       { iAccount?: number; iCustomer?: number },
  iWholesaler?: number,
  portalUrl?:  string,
): Promise<{ success: boolean; payment?: SippyPayment; error?: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, error: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, number> = { i_payment: iPayment };
  if (owner.iAccount    !== undefined) params.i_account    = owner.iAccount;
  if (owner.iCustomer   !== undefined) params.i_customer   = owner.iCustomer;
  if (iWholesaler       !== undefined) params.i_wholesaler = iWholesaler;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('getPaymentInfo', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const s = text.indexOf('<struct>'), e = text.lastIndexOf('</struct>');
      if (s === -1) return { success: false, error: 'No payment data returned.' };
      return { success: true, payment: parsePaymentStruct(text.slice(s, e + 9)) };
    }
    return { success: false, error: extractTag(text, 'faultString') || 'getPaymentInfo failed.' };
  } catch (e: any) { return { success: false, error: e.message }; }
}

/**
 * List payments with optional filters.
 * Official method: getPaymentsList() — docs 107446
 * Optional: iAccount, iCustomer, offset, limit, startDate, endDate, type ('credit'|'debit')
 */
export async function getPaymentsList(
  username:   string,
  password:   string,
  opts?: {
    iAccount?:    number;
    iCustomer?:   number;
    offset?:      number;
    limit?:       number;
    startDate?:   string;      // '%H:%M:%S.000 GMT %a %b %d %Y'
    endDate?:     string;
    type?:        'credit' | 'debit';
    iWholesaler?: number;
  },
  portalUrl?: string,
): Promise<{ payments: SippyPayment[]; error?: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { payments: [], error: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number> = {};
  if (opts?.iAccount    !== undefined) params.i_account    = opts.iAccount;
  if (opts?.iCustomer   !== undefined) params.i_customer   = opts.iCustomer;
  if (opts?.offset      !== undefined) params.offset       = opts.offset;
  if (opts?.limit       !== undefined) params.limit        = opts.limit;
  if (opts?.startDate   !== undefined) params.start_date   = opts.startDate;
  if (opts?.endDate     !== undefined) params.end_date     = opts.endDate;
  if (opts?.type        !== undefined) params.type         = opts.type;
  if (opts?.iWholesaler !== undefined) params.i_wholesaler = opts.iWholesaler;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('getPaymentsList', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const payments: SippyPayment[] = [];
      const arrayMatch = /<name>payments<\/name>\s*<value>\s*<array>\s*<data>([\s\S]*?)<\/data>\s*<\/array>/i.exec(text);
      if (arrayMatch) {
        const structRe = /<struct>([\s\S]*?)<\/struct>/g;
        let m: RegExpExecArray | null;
        while ((m = structRe.exec(arrayMatch[1])) !== null) {
          try { payments.push(parsePaymentStruct(m[0])); } catch {}
        }
      }
      return { payments };
    }
    return { payments: [], error: extractTag(text, 'faultString') || 'getPaymentsList failed.' };
  } catch (e: any) { return { payments: [], error: e.message }; }
}

// ─ Recharge Voucher (doc 107438) ─────────────────────────────────────────────

/**
 * Top up an account balance using a recharge voucher.
 * Official method: rechargeVoucher() — docs 107438
 * Supply iAccount OR username; supply voucherId + optional secretPin (normal mode)
 * OR iVoucher (trusted mode).
 */
export async function rechargeVoucher(
  username:   string,
  password:   string,
  opts: {
    iAccount?:   number;
    accountUsername?: string;    // 'username' field in Sippy API
    voucherId?:  string;         // voucher_id (normal mode)
    secretPin?:  string;
    iVoucher?:   number;         // trusted mode: use i_voucher directly
  },
  portalUrl?: string,
): Promise<{
  success: boolean;
  message?: string;
  value?: number;
  voucherCurrency?: string;
  payerAmount?: number;
  error?: string;
}> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, error: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number> = {};
  if (opts.iAccount         !== undefined) params.i_account  = opts.iAccount;
  if (opts.accountUsername  !== undefined) params.username   = opts.accountUsername;
  if (opts.voucherId        !== undefined) params.voucher_id = opts.voucherId;
  if (opts.secretPin        !== undefined) params.secret_pin = opts.secretPin;
  if (opts.iVoucher         !== undefined) params.i_voucher  = opts.iVoucher;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('rechargeVoucher', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const m = extractStructMembers(text);
      return {
        success:        true,
        message:        'Voucher applied.',
        value:          m['value']           ? parseFloat(m['value'])           : undefined,
        voucherCurrency: m['voucher_currency'] || undefined,
        payerAmount:    m['payer_amount']    ? parseFloat(m['payer_amount'])    : undefined,
      };
    }
    return { success: false, error: extractTag(text, 'faultString') || 'rechargeVoucher failed.' };
  } catch (e: any) { return { success: false, error: e.message }; }
}

// ─ Card Payments (doc 107443) ─────────────────────────────────────────────────

/**
 * Make a payment using a stored debit/credit card.
 * Official method: makePayment() — docs 107443
 * Note: Either iAccount OR iCustomer must be supplied.
 * If iDebitCreditCard not given, the primary card is used.
 */
export async function makePayment(
  username:   string,
  password:   string,
  owner:      { iAccount?: number; iCustomer?: number },
  amount:     number,
  currency:   string,
  payerIpAddress: string,
  opts?: {
    iDebitCreditCard?: number;
    iWholesaler?:      number;
  },
  portalUrl?: string,
): Promise<{ success: boolean; result?: string; iPayment?: number; message?: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number> = { amount, currency, payer_ip_address: payerIpAddress };
  if (owner.iAccount          !== undefined) params.i_account           = owner.iAccount;
  if (owner.iCustomer         !== undefined) params.i_customer          = owner.iCustomer;
  if (opts?.iDebitCreditCard  !== undefined) params.i_debit_credit_card = opts.iDebitCreditCard;
  if (opts?.iWholesaler       !== undefined) params.i_wholesaler        = opts.iWholesaler;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('makePayment', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const m = extractStructMembers(text);
      const result = m['result'] || 'OK';
      return {
        success:  result !== 'FAILED',
        result,
        iPayment: m['i_payment'] ? parseInt(m['i_payment'], 10) : undefined,
      };
    }
    return { success: false, message: extractTag(text, 'faultString') || 'makePayment failed.' };
  } catch (e: any) { return { success: false, message: e.message }; }
}

/**
 * Make a payment by providing card details inline (no stored card needed).
 * Official method: makePaymentByCard() — docs 107443
 * Note: Either iAccount OR iCustomer must be supplied.
 */
export async function makePaymentByCard(
  username:       string,
  password:       string,
  owner:          { iAccount?: number; iCustomer?: number },
  amount:         number,
  currency:       string,
  payerIpAddress: string,
  card: {
    iCardType:    number;
    number:       string;
    expMm:        number;
    expYy:        number;
    holder:       string;
    streetAddr1:  string;
    state:        string;
    postalCode:   string;
    city:         string;
    country:      string;
    phone:        string;
    cvv?:         string;
    streetAddr2?: string;
  },
  iWholesaler?:  number,
  portalUrl?:    string,
): Promise<{ success: boolean; result?: string; iPayment?: number; message?: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number> = {
    amount, currency,
    payer_ip_address: payerIpAddress,
    i_card_type:      card.iCardType,
    number:           card.number,
    exp_mm:           card.expMm,
    exp_yy:           card.expYy,
    holder:           card.holder,
    street_addr1:     card.streetAddr1,
    state:            card.state,
    postal_code:      card.postalCode,
    city:             card.city,
    country:          card.country,
    phone:            card.phone,
  };
  if (owner.iAccount    !== undefined) params.i_account    = owner.iAccount;
  if (owner.iCustomer   !== undefined) params.i_customer   = owner.iCustomer;
  if (card.cvv          !== undefined) params.cvv          = card.cvv;
  if (card.streetAddr2  !== undefined) params.street_addr2 = card.streetAddr2;
  if (iWholesaler       !== undefined) params.i_wholesaler = iWholesaler;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('makePaymentByCard', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const m = extractStructMembers(text);
      const result = m['result'] || 'OK';
      return {
        success:  result !== 'FAILED',
        result,
        iPayment: m['i_payment'] ? parseInt(m['i_payment'], 10) : undefined,
      };
    }
    return { success: false, message: extractTag(text, 'faultString') || 'makePaymentByCard failed.' };
  } catch (e: any) { return { success: false, message: e.message }; }
}

// ─── Low Balance / Auto-Recharge (doc 107444) ────────────────────────────────

export interface SippyLowBalanceConfig {
  success: boolean;
  // Returned by getLowBalance()
  threshold?: number | null;          // null = threshold disabled
  notifyByEmail?: boolean;
  chargeCard?: boolean;               // auto-charge on low balance
  chargeAmount?: number;
  iDebitCreditCard?: number | null;   // null = use primary card
  notificationRetryCount?: number;    // since 2024
  notificationRetryInterval?: number | null; // hours; null = system default; since 2024
  // Account-only fields (not applicable for customers)
  brChargeCard?: boolean;             // auto-charge on billing run
  brChargeAmount?: number | null;     // null = Plan Price
  brIDebitCreditCard?: number | null;
  error?: string;
}

export interface SetLowBalanceOpts {
  // Target — supply EXACTLY ONE of these:
  iAccount?: number;
  iCustomer?: number;
  // Trusted mode (since 2022):
  iWholesaler?: number;
  // Settings — all optional; omit a field to leave it unchanged:
  threshold?: number | null;          // null disables the threshold
  notifyByEmail?: boolean;
  chargeCard?: boolean;
  chargeAmount?: number;
  iDebitCreditCard?: number | null;   // null = use primary card
  notificationRetryCount?: number;    // >= 0; must not exceed system limit
  notificationRetryInterval?: number | null; // hours >= 1, or null for system default
  // Account-only (ignored when i_customer is supplied):
  brChargeCard?: boolean;
  brChargeAmount?: number | null;     // null = Plan Price
  brIDebitCreditCard?: number | null;
}

/**
 * Get Low Balance / Auto-Recharge configuration for an account or customer.
 * Official method: getLowBalance() — docs 107444
 * Supply EITHER i_account OR i_customer (not both).
 * i_wholesaler enables trusted mode (since 2022).
 */
export async function getSippyLowBalance(
  username: string,
  password: string,
  target: { iAccount?: number; iCustomer?: number; iWholesaler?: number },
  portalUrl?: string,
): Promise<SippyLowBalanceConfig> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, error: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, number> = {};
  if (target.iAccount    !== undefined) params.i_account    = target.iAccount;
  if (target.iCustomer   !== undefined) params.i_customer   = target.iCustomer;
  if (target.iWholesaler !== undefined) params.i_wholesaler = target.iWholesaler;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('getLowBalance', params as any), username, password);
    const text = resp.body;

    if (text.includes('<fault>')) {
      const fault = extractTag(text, 'faultString') || 'getLowBalance failed.';
      return { success: false, error: fault };
    }

    const m = extractStructMembers(text);

    const parseNullableDouble = (key: string): number | null | undefined => {
      if (!(key in m)) return undefined;
      const v = m[key];
      if (v === '' || v === 'None' || v === 'nil') return null;
      const n = parseFloat(v);
      return isNaN(n) ? null : n;
    };

    const parseNullableInt = (key: string): number | null | undefined => {
      if (!(key in m)) return undefined;
      const v = m[key];
      if (v === '' || v === 'None' || v === 'nil') return null;
      const n = parseInt(v, 10);
      return isNaN(n) ? null : n;
    };

    const parseBool = (key: string): boolean | undefined => {
      if (!(key in m)) return undefined;
      return m[key] === '1' || m[key].toLowerCase() === 'true';
    };

    const result: SippyLowBalanceConfig = { success: true };

    const threshold = parseNullableDouble('threshold');
    if (threshold !== undefined) result.threshold = threshold;

    const notifyByEmail = parseBool('notify_by_email');
    if (notifyByEmail !== undefined) result.notifyByEmail = notifyByEmail;

    const chargeCard = parseBool('charge_card');
    if (chargeCard !== undefined) result.chargeCard = chargeCard;

    const chargeAmount = parseNullableDouble('charge_amount');
    if (chargeAmount !== undefined) result.chargeAmount = chargeAmount ?? 0;

    const iDCC = parseNullableInt('i_debit_credit_card');
    if (iDCC !== undefined) result.iDebitCreditCard = iDCC;

    const retryCount = parseNullableInt('notification_retry_count');
    if (retryCount !== undefined) result.notificationRetryCount = retryCount ?? 0;

    const retryInterval = parseNullableInt('notification_retry_interval');
    if (retryInterval !== undefined) result.notificationRetryInterval = retryInterval;

    // Account-only fields
    const brChargeCard = parseBool('br_charge_card');
    if (brChargeCard !== undefined) result.brChargeCard = brChargeCard;

    const brChargeAmount = parseNullableDouble('br_charge_amount');
    if (brChargeAmount !== undefined) result.brChargeAmount = brChargeAmount;

    const brIDCC = parseNullableInt('br_i_debit_credit_card');
    if (brIDCC !== undefined) result.brIDebitCreditCard = brIDCC;

    return result;
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/**
 * Set Low Balance / Auto-Recharge configuration for an account or customer.
 * Official method: setLowBalance() — docs 107444
 * Supply EITHER iAccount OR iCustomer (not both).
 * Only include options you want to change — others are left untouched.
 * Pass null for threshold to disable it; null for i_debit_credit_card = use primary card.
 */
export async function setSippyLowBalance(
  username: string,
  password: string,
  opts: SetLowBalanceOpts,
  portalUrl?: string,
): Promise<{ success: boolean; message: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  // Build params — only include keys that were explicitly provided
  const params: Record<string, string | number | boolean | null> = {};
  if (opts.iAccount    !== undefined) params.i_account    = opts.iAccount;
  if (opts.iCustomer   !== undefined) params.i_customer   = opts.iCustomer;
  if (opts.iWholesaler !== undefined) params.i_wholesaler = opts.iWholesaler;

  // null is a valid value (disables threshold / means primary card) — include it
  if (opts.threshold           !== undefined) params.threshold              = opts.threshold;
  if (opts.notifyByEmail       !== undefined) params.notify_by_email        = opts.notifyByEmail;
  if (opts.chargeCard          !== undefined) params.charge_card            = opts.chargeCard;
  if (opts.chargeAmount        !== undefined) params.charge_amount          = opts.chargeAmount;
  if (opts.iDebitCreditCard    !== undefined) params.i_debit_credit_card    = opts.iDebitCreditCard;
  if (opts.notificationRetryCount    !== undefined) params.notification_retry_count    = opts.notificationRetryCount;
  if (opts.notificationRetryInterval !== undefined) params.notification_retry_interval = opts.notificationRetryInterval;

  // Account-only
  if (opts.brChargeCard        !== undefined) params.br_charge_card         = opts.brChargeCard;
  if (opts.brChargeAmount      !== undefined) params.br_charge_amount       = opts.brChargeAmount;
  if (opts.brIDebitCreditCard  !== undefined) params.br_i_debit_credit_card = opts.brIDebitCreditCard;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('setLowBalance', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      return { success: true, message: 'Low balance settings updated.' };
    }
    const fault = extractTag(text, 'faultString') || 'setLowBalance failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

// ─── Authentication Rules Management (doc 107336) ────────────────────────────
//
// Protocols: 1=SIP  2=H.323 (deprecated since 2020)  3=IAX2  4=Calling Card PIN
// Trusted mode: supply iCustomer alongside iAccount.
// i_tariff / i_routing_group null  → use account's service plan values.
// max_sessions -1                  → Unlimited concurrent calls.
// max_cps      null                → Unlimited call rate.

export interface SippyAuthRule {
  iAuthentication: number;
  iAccount?: number;             // removed from list since Sippy 2020, still in getAuthRuleInfo
  iProtocol?: number;            // 1=SIP 3=IAX2 4=PIN  (present in listAuthRules since 2020)
  remoteIp?: string;             // caller's IP address
  incomingCli?: string;          // caller number (CLI)
  incomingCld?: string;          // callee number (CLD)
  toDomain?: string;             // To-header hostname (since Sippy 2020)
  fromDomain?: string;           // From-header hostname (since Sippy 2020)
  cliTranslationRule?: string;
  cldTranslationRule?: string;
  iTariff?: number | null;       // null = use account's base tariff
  iRoutingGroup?: number | null; // null = use account's routing group
  maxSessions?: number;          // -1 = Unlimited
  maxCps?: number | null;        // null = Unlimited
}

export interface AddAuthRuleOpts {
  iAccount: number;              // required
  iProtocol: number;             // required (1/2/3/4)
  iCustomer?: number;            // trusted mode
  // At least ONE of the following must be present:
  remoteIp?: string;
  incomingCli?: string;
  incomingCld?: string;
  toDomain?: string;
  fromDomain?: string;
  // Optional:
  cliTranslationRule?: string;
  cldTranslationRule?: string;
  iTariff?: number | null;
  iRoutingGroup?: number | null;
  maxSessions?: number;
  maxCps?: number | null;
}

export interface UpdateAuthRuleOpts {
  iAuthentication: number;       // required
  iCustomer?: number;            // trusted mode
  iAccount?: number;             // optional; removed in >=5.2
  iProtocol?: number;
  remoteIp?: string;
  incomingCli?: string;
  incomingCld?: string;
  toDomain?: string;
  fromDomain?: string;
  cliTranslationRule?: string;
  cldTranslationRule?: string;
  iTariff?: number | null;
  iRoutingGroup?: number | null;
  maxSessions?: number;
  maxCps?: number | null;
}

/** Parse a flat <struct> XML block into a SippyAuthRule. */
function parseAuthRuleStruct(structBody: string): SippyAuthRule {
  const m = extractStructMembers(`<struct>${structBody}</struct>`);
  const num = (k: string) => m[k] ? parseInt(m[k], 10) || 0 : undefined;
  const str = (k: string) => m[k] || undefined;
  const nullableInt = (k: string): number | null | undefined => {
    if (!(k in m)) return undefined;
    if (m[k] === '' || m[k] === 'None' || m[k] === 'nil') return null;
    const n = parseInt(m[k], 10); return isNaN(n) ? null : n;
  };
  const nullableFlt = (k: string): number | null | undefined => {
    if (!(k in m)) return undefined;
    if (m[k] === '' || m[k] === 'None' || m[k] === 'nil') return null;
    const n = parseFloat(m[k]); return isNaN(n) ? null : n;
  };

  return {
    iAuthentication:   parseInt(m['i_authentication'] || '0', 10),
    iAccount:          num('i_account'),
    iProtocol:         num('i_protocol'),
    remoteIp:          str('remote_ip'),
    incomingCli:       str('incoming_cli'),
    incomingCld:       str('incoming_cld'),
    toDomain:          str('to_domain'),
    fromDomain:        str('from_domain'),
    cliTranslationRule: str('cli_translation_rule'),
    cldTranslationRule: str('cld_translation_rule'),
    iTariff:           nullableInt('i_tariff'),
    iRoutingGroup:     nullableInt('i_routing_group'),
    maxSessions:       num('max_sessions'),
    maxCps:            nullableFlt('max_cps'),
  };
}

/**
 * Add an authentication rule to an account.
 * Official method: addAuthRule() — docs 107336
 *
 * Mandatory: iAccount + iProtocol + at least one of remoteIp/incomingCli/incomingCld/toDomain/fromDomain.
 * Returns the new i_authentication ID on success.
 */
export async function addSippyAuthRule(
  username: string,
  password: string,
  opts: AddAuthRuleOpts,
  portalUrl?: string,
): Promise<{ success: boolean; iAuthentication?: number; message: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number | boolean | null> = {
    i_account:  opts.iAccount,
    i_protocol: opts.iProtocol,
  };
  if (opts.iCustomer          !== undefined) params.i_customer           = opts.iCustomer;
  if (opts.remoteIp           !== undefined) params.remote_ip            = opts.remoteIp;
  if (opts.incomingCli        !== undefined) params.incoming_cli         = opts.incomingCli;
  if (opts.incomingCld        !== undefined) params.incoming_cld         = opts.incomingCld;
  if (opts.toDomain           !== undefined) params.to_domain            = opts.toDomain;
  if (opts.fromDomain         !== undefined) params.from_domain          = opts.fromDomain;
  if (opts.cliTranslationRule !== undefined) params.cli_translation_rule = opts.cliTranslationRule;
  if (opts.cldTranslationRule !== undefined) params.cld_translation_rule = opts.cldTranslationRule;
  if (opts.iTariff            !== undefined) params.i_tariff             = opts.iTariff;
  if (opts.iRoutingGroup      !== undefined) params.i_routing_group      = opts.iRoutingGroup;
  if (opts.maxSessions        !== undefined) params.max_sessions         = opts.maxSessions;
  if (opts.maxCps             !== undefined) params.max_cps              = opts.maxCps;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('addAuthRule', params), username, password);
    const text = resp.body;
    if (text.includes('<fault>')) {
      const fault = extractTag(text, 'faultString') || 'addAuthRule failed.';
      return { success: false, message: fault };
    }
    const m = extractStructMembers(text);
    const iAuthentication = parseInt(m['i_authentication'] || '0', 10);
    return { success: true, iAuthentication, message: 'Auth rule added.' };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Update an existing authentication rule.
 * Official method: updateAuthRule() — docs 107336
 *
 * Only i_authentication is mandatory; all other fields are optional updates.
 * Note: i_account was removed in Sippy >= 5.2.
 */
export async function updateSippyAuthRule(
  username: string,
  password: string,
  opts: UpdateAuthRuleOpts,
  portalUrl?: string,
): Promise<{ success: boolean; message: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number | boolean | null> = {
    i_authentication: opts.iAuthentication,
  };
  if (opts.iCustomer          !== undefined) params.i_customer           = opts.iCustomer;
  if (opts.iAccount           !== undefined) params.i_account            = opts.iAccount;
  if (opts.iProtocol          !== undefined) params.i_protocol           = opts.iProtocol;
  if (opts.remoteIp           !== undefined) params.remote_ip            = opts.remoteIp;
  if (opts.incomingCli        !== undefined) params.incoming_cli         = opts.incomingCli;
  if (opts.incomingCld        !== undefined) params.incoming_cld         = opts.incomingCld;
  if (opts.toDomain           !== undefined) params.to_domain            = opts.toDomain;
  if (opts.fromDomain         !== undefined) params.from_domain          = opts.fromDomain;
  if (opts.cliTranslationRule !== undefined) params.cli_translation_rule = opts.cliTranslationRule;
  if (opts.cldTranslationRule !== undefined) params.cld_translation_rule = opts.cldTranslationRule;
  if (opts.iTariff            !== undefined) params.i_tariff             = opts.iTariff;
  if (opts.iRoutingGroup      !== undefined) params.i_routing_group      = opts.iRoutingGroup;
  if (opts.maxSessions        !== undefined) params.max_sessions         = opts.maxSessions;
  if (opts.maxCps             !== undefined) params.max_cps              = opts.maxCps;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('updateAuthRule', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      return { success: true, message: 'Auth rule updated.' };
    }
    const fault = extractTag(text, 'faultString') || 'updateAuthRule failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Delete an authentication rule.
 * Official method: delAuthRule() — docs 107336
 *
 * Only i_authentication is required.
 */
export async function delSippyAuthRule(
  username: string,
  password: string,
  iAuthentication: number,
  opts?: { iCustomer?: number; portalUrl?: string },
): Promise<{ success: boolean; message: string }> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number | boolean | null> = { i_authentication: iAuthentication };
  if (opts?.iCustomer !== undefined) params.i_customer = opts.iCustomer;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('delAuthRule', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      return { success: true, message: 'Auth rule deleted.' };
    }
    const fault = extractTag(text, 'faultString') || 'delAuthRule failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Get full info for a single authentication rule.
 * Official method: getAuthRuleInfo() — docs 107336 (available from Sippy 4.5)
 *
 * Returns the full authrule struct including tariff, routing group, max_sessions, max_cps.
 */
export async function getSippyAuthRuleInfo(
  username: string,
  password: string,
  iAuthentication: number,
  opts?: { iCustomer?: number; portalUrl?: string },
): Promise<{ success: boolean; authRule?: SippyAuthRule; error?: string }> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, error: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number | boolean | null> = { i_authentication: iAuthentication };
  if (opts?.iCustomer !== undefined) params.i_customer = opts.iCustomer;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('getAuthRuleInfo', params), username, password);
    const text = resp.body;
    if (text.includes('<fault>')) {
      const fault = extractTag(text, 'faultString') || 'getAuthRuleInfo failed.';
      return { success: false, error: fault };
    }

    // The `authrule` member contains a nested <struct> — extract it by name
    const nestedMatch = /<name>authrule<\/name>\s*<value>\s*<struct>([\s\S]*?)<\/struct>\s*<\/value>/.exec(text);
    if (!nestedMatch) return { success: false, error: 'authrule struct not found in response.' };

    return { success: true, authRule: parseAuthRuleStruct(nestedMatch[1]) };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/**
 * List authentication rules for an account.
 * Official method: listAuthRules() — docs 107336 (available from Sippy 2.0)
 *
 * Filters:
 *   iAccount    — required since Sippy 2020; the account whose rules to fetch
 *   iProtocol   — optional; filter by protocol
 *   remoteIp    — optional; filter by caller IP
 *   offset/limit — pagination
 *
 * Note: i_account and i_protocol are absent from each rule struct since Sippy 2020
 * (they were moved to filter params). i_tariff, i_routing_group, max_sessions, max_cps
 * are NOT returned by listAuthRules — use getAuthRuleInfo for those.
 */
export async function listSippyAuthRules(
  username: string,
  password: string,
  opts: {
    iAccount: number;
    iCustomer?: number;
    iAuthentication?: number;   // deprecated filter since Sippy 2020
    iProtocol?: number;
    remoteIp?: string;
    offset?: number;
    limit?: number;
  },
  portalUrl?: string,
): Promise<{ authRules: SippyAuthRule[]; error?: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { authRules: [], error: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number | boolean | null> = { i_account: opts.iAccount };
  if (opts.iCustomer      !== undefined) params.i_customer      = opts.iCustomer;
  if (opts.iAuthentication !== undefined) params.i_authentication = opts.iAuthentication;
  if (opts.iProtocol      !== undefined) params.i_protocol      = opts.iProtocol;
  if (opts.remoteIp       !== undefined) params.remote_ip       = opts.remoteIp;
  if (opts.offset         !== undefined) params.offset          = opts.offset;
  if (opts.limit          !== undefined) params.limit           = opts.limit;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('listAuthRules', params), username, password);
    const text = resp.body;
    if (text.includes('<fault>')) {
      const fault = extractTag(text, 'faultString') || 'listAuthRules failed.';
      return { authRules: [], error: fault };
    }

    // Extract the <authrules> array portion from the response body
    const arrayMatch = /<name>authrules<\/name>\s*<value>\s*<array>([\s\S]*?)<\/array>\s*<\/value>/.exec(text);
    if (!arrayMatch) return { authRules: [] };

    const authRules: SippyAuthRule[] = [];
    const structRe = /<struct>([\s\S]*?)<\/struct>/g;
    let match: RegExpExecArray | null;
    while ((match = structRe.exec(arrayMatch[1])) !== null) {
      authRules.push(parseAuthRuleStruct(match[1]));
    }

    return { authRules };
  } catch (e: any) {
    return { authRules: [], error: e.message };
  }
}

// ── System Dictionaries (getDictionary) ──────────────────────────────────────
//
// Supported dictionary names (available since Sippy v5.0):
//   languages, export_types, currencies, timezones, media_relay_types,
//   media_relays, protocols, proto_transports, qmon_actions, forward_did_modes,
//   upload_types, privacy_modes, tariff_types, ssl_certificate_types,
//   ca_list_types, ssl_use_domain_types, trunk_policies
//
// Reference: https://support.sippysoft.com/support/solutions/articles/3000055804
// The 'languages' dictionary also accepts an extra `type` param: 'web' or 'ivr'.

export interface SippyDictionaryEntry {
  id: string;
  name: string;
}

export async function getSippyDictionary(
  dictName: string,
  username: string,
  password: string,
  portalUrl?: string,
  extraParams: Record<string, string> = {},
): Promise<{ entries: SippyDictionaryEntry[]; error?: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { entries: [], error: 'Not connected to Sippy.' };

  const apiUrl = `${base}/xmlapi/xmlapi`;
  const params: Record<string, string | number | boolean | null> = { name: dictName, ...extraParams };

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('getDictionary', params), username, password);
    const text = resp.body;
    console.log(`[Sippy] getDictionary(${dictName}) → HTTP ${resp.statusCode}: ${text.slice(0, 200)}`);

    if (text.includes('<fault>')) {
      const fault = extractTag(text, 'faultString');
      return { entries: [], error: fault?.replace(/<[^>]+>/g, '').trim() || `getDictionary(${dictName}) failed.` };
    }

    // The response has a top-level struct with members `result` and `dictionary`.
    // The `dictionary` value is itself a struct whose <name> elements are the IDs
    // and whose <value> elements are the human-readable labels.
    const dictMatch = /<name>dictionary<\/name>\s*<value>\s*<struct>([\s\S]*?)<\/struct>\s*<\/value>/.exec(text);
    if (!dictMatch) {
      // Some dictionaries may be empty or return a different shape
      return { entries: [] };
    }

    const dictXml = dictMatch[1];
    const entries: SippyDictionaryEntry[] = [];
    const memberRe = /<member>\s*<name>([^<]+)<\/name>\s*<value>([\s\S]*?)<\/value>\s*<\/member>/gi;
    let m;
    while ((m = memberRe.exec(dictXml)) !== null) {
      const id = m[1].trim();
      const label = m[2].replace(/<[^>]+>/g, '').trim();
      if (id && label) entries.push({ id, name: label });
    }

    return { entries };
  } catch (err: any) {
    return { entries: [], error: err.message };
  }
}

// ── Trunk Management APIs (docs 3000116551 — versions from 2022) ──────────────
// All support trusted mode; i_customer must be supplied in that mode.

export interface SippyTrunk {
  iTrunk: number;
  iAccount: number;
  name: string;
  description?: string;
  policy?: string;          // trunk routing policy (ordered, random, etc.)
  iConnection?: number;     // underlying connection ID (from v2025)
  connectionName?: string;  // connection name when looked up by i_connection
  iTrunkConnection?: number;
}

function parseTrunkStruct(s: string): SippyTrunk | null {
  const m = extractStructMembers(s);
  if (!m['i_trunk'] && !m['name']) return null;
  return {
    iTrunk:          m['i_trunk']          ? parseInt(m['i_trunk'], 10)          : 0,
    iAccount:        m['i_account']        ? parseInt(m['i_account'], 10)        : 0,
    name:            m['name']             || '',
    description:     m['description']      || undefined,
    policy:          m['policy']           || undefined,
    iConnection:     m['i_connection']     ? parseInt(m['i_connection'], 10)     : undefined,
    connectionName:  m['connection_name']  || undefined,
    iTrunkConnection:m['i_trunk_connection']? parseInt(m['i_trunk_connection'],10): undefined,
  };
}

/** createTrunk() — docs 3000116551 */
export async function createTrunk(
  username: string, password: string,
  params: { iAccount: number; name: string; description?: string; policy?: string },
): Promise<{ ok: boolean; iTrunk?: number; message?: string }> {
  if (!activeSession) return { ok: false, message: 'Not connected' };
  const apiUrl = `${activeSession.portalUrl}/xmlapi/xmlapi`;
  const p: Record<string, unknown> = { i_account: params.iAccount, name: params.name, i_customer: 1 };
  if (params.description) p.description = params.description;
  if (params.policy)      p.policy      = params.policy;
  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('createTrunk', p), username, password);
    const text = resp.body.toString?.() ?? resp.body;
    if (text.includes('faultCode')) {
      const fault = extractTag(text, 'faultString');
      return { ok: false, message: fault?.replace(/<[^>]+>/g, '').trim() || 'createTrunk failed.' };
    }
    const m = extractStructMembers(extractAllTags(text, 'struct')[0] ?? '');
    return { ok: true, iTrunk: m['i_trunk'] ? parseInt(m['i_trunk'], 10) : undefined };
  } catch (e: any) { return { ok: false, message: e.message }; }
}

/** updateTrunk() — docs 3000116551 */
export async function updateTrunk(
  username: string, password: string,
  params: { iTrunk: number; name?: string; description?: string; policy?: string },
): Promise<{ ok: boolean; iTrunk?: number; message?: string }> {
  if (!activeSession) return { ok: false, message: 'Not connected' };
  const apiUrl = `${activeSession.portalUrl}/xmlapi/xmlapi`;
  const p: Record<string, unknown> = { i_trunk: params.iTrunk, i_customer: 1 };
  if (params.name        !== undefined) p.name        = params.name;
  if (params.description !== undefined) p.description = params.description;
  if (params.policy      !== undefined) p.policy      = params.policy;
  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('updateTrunk', p), username, password);
    const text = resp.body.toString?.() ?? resp.body;
    if (text.includes('faultCode')) {
      const fault = extractTag(text, 'faultString');
      return { ok: false, message: fault?.replace(/<[^>]+>/g, '').trim() || 'updateTrunk failed.' };
    }
    const m = extractStructMembers(extractAllTags(text, 'struct')[0] ?? '');
    return { ok: true, iTrunk: m['i_trunk'] ? parseInt(m['i_trunk'], 10) : params.iTrunk };
  } catch (e: any) { return { ok: false, message: e.message }; }
}

/** deleteTrunk() — docs 3000116551 */
export async function deleteTrunk(
  username: string, password: string, iTrunk: number,
): Promise<{ ok: boolean; message?: string }> {
  if (!activeSession) return { ok: false, message: 'Not connected' };
  const apiUrl = `${activeSession.portalUrl}/xmlapi/xmlapi`;
  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('deleteTrunk', { i_trunk: iTrunk, i_customer: 1 }), username, password);
    const text = resp.body.toString?.() ?? resp.body;
    if (text.includes('faultCode')) {
      const fault = extractTag(text, 'faultString');
      return { ok: false, message: fault?.replace(/<[^>]+>/g, '').trim() || 'deleteTrunk failed.' };
    }
    return { ok: true };
  } catch (e: any) { return { ok: false, message: e.message }; }
}

/** getTrunkInfo() — docs 3000116551 */
export async function getTrunkInfo(
  username: string, password: string,
  params: { iTrunk?: number; iConnection?: number },
): Promise<{ ok: boolean; trunk?: SippyTrunk; message?: string }> {
  if (!activeSession) return { ok: false, message: 'Not connected' };
  const apiUrl = `${activeSession.portalUrl}/xmlapi/xmlapi`;
  const p: Record<string, unknown> = { i_customer: 1 };
  if (params.iTrunk)      p.i_trunk      = params.iTrunk;
  if (params.iConnection) p.i_connection = params.iConnection;
  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('getTrunkInfo', p), username, password);
    const text = resp.body.toString?.() ?? resp.body;
    if (text.includes('faultCode')) {
      const fault = extractTag(text, 'faultString');
      return { ok: false, message: fault?.replace(/<[^>]+>/g, '').trim() || 'getTrunkInfo failed.' };
    }
    const structs = extractAllTags(text, 'struct');
    for (const s of structs) {
      const t = parseTrunkStruct(s);
      if (t) return { ok: true, trunk: t };
    }
    return { ok: false, message: 'Trunk not found in response.' };
  } catch (e: any) { return { ok: false, message: e.message }; }
}

/** getTrunksList() — docs 3000116551 */
export async function getTrunksList(
  username: string, password: string,
  params: { iAccount: number; namePattern?: string },
): Promise<{ ok: boolean; trunks: SippyTrunk[]; message?: string }> {
  if (!activeSession) return { ok: false, trunks: [], message: 'Not connected' };
  const apiUrl = `${activeSession.portalUrl}/xmlapi/xmlapi`;
  const p: Record<string, unknown> = { i_account: params.iAccount, i_customer: 1 };
  if (params.namePattern) p.name_pattern = params.namePattern;
  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('getTrunksList', p), username, password);
    const text = resp.body.toString?.() ?? resp.body;
    if (text.includes('faultCode')) {
      const fault = extractTag(text, 'faultString');
      return { ok: false, trunks: [], message: fault?.replace(/<[^>]+>/g, '').trim() || 'getTrunksList failed.' };
    }
    const structs = extractAllTags(text, 'struct');
    const trunks: SippyTrunk[] = [];
    for (const s of structs) {
      const t = parseTrunkStruct(s);
      if (t) trunks.push(t);
    }
    return { ok: true, trunks };
  } catch (e: any) { return { ok: false, trunks: [], message: e.message }; }
}

// ── Trunk Connection Management APIs (docs 3000116552 — versions from 2022) ───
// All support trusted mode; i_customer must be supplied in that mode.

export interface SippyTrunkConnection {
  iTrunkConnection: number;
  iTrunk: number;
  name: string;
  destination: string;
  orderNo?: number;
  username?: string;
  outboundIp?: string;
  outboundCld?: string;
  iProtoTransport?: number;
  iPrivacyMode?: number;
  trustedPrivacyDomain?: boolean;
  usePrivIdAsCli?: boolean;
  useAssertedId?: boolean;
  assertedIdTranslation?: string;
  enableDiversion?: boolean;
  huntstopScodes?: string;
  blocked?: boolean;
  capacity?: number;
  maxCps?: number;
  fromDomain?: string;
  randomCallId?: boolean;
  iConnection?: number;    // underlying connection ID
}

function parseTrunkConnectionStruct(s: string): SippyTrunkConnection | null {
  const m = extractStructMembers(s);
  if (!m['i_trunk_connection'] && !m['name']) return null;
  const boolVal = (v?: string) => v === '1' || v === 'true';
  return {
    iTrunkConnection:      m['i_trunk_connection']      ? parseInt(m['i_trunk_connection'], 10)       : 0,
    iTrunk:                m['i_trunk']                 ? parseInt(m['i_trunk'], 10)                  : 0,
    name:                  m['name']                    || '',
    destination:           m['destination']             || '',
    orderNo:               m['order_no']                ? parseInt(m['order_no'], 10)                 : undefined,
    username:              m['username']                || undefined,
    outboundIp:            m['outbound_ip']             || undefined,
    outboundCld:           m['outbound_cld']            || undefined,
    iProtoTransport:       m['i_proto_transport']       ? parseInt(m['i_proto_transport'], 10)        : undefined,
    iPrivacyMode:          m['i_privacy_mode']          ? parseInt(m['i_privacy_mode'], 10)           : undefined,
    trustedPrivacyDomain:  m['trusted_privacy_domain']  != null ? boolVal(m['trusted_privacy_domain']): undefined,
    usePrivIdAsCli:        m['use_priv_id_as_cli']      != null ? boolVal(m['use_priv_id_as_cli'])    : undefined,
    useAssertedId:         m['use_asserted_id']         != null ? boolVal(m['use_asserted_id'])        : undefined,
    assertedIdTranslation: m['asserted_id_translation'] || undefined,
    enableDiversion:       m['enable_diversion']        != null ? boolVal(m['enable_diversion'])       : undefined,
    huntstopScodes:        m['huntstop_scodes']         || undefined,
    blocked:               m['blocked']                 != null ? boolVal(m['blocked'])                : undefined,
    capacity:              m['capacity']                ? parseInt(m['capacity'], 10)                  : undefined,
    maxCps:                m['max_cps']                 ? parseFloat(m['max_cps'])                     : undefined,
    fromDomain:            m['from_domain']             || undefined,
    randomCallId:          m['random_call_id']          != null ? boolVal(m['random_call_id'])         : undefined,
    iConnection:           m['i_connection']            ? parseInt(m['i_connection'], 10)              : undefined,
  };
}

/** createTrunkConnection() — docs 3000116552 */
export async function createTrunkConnection(
  username: string, password: string,
  params: {
    iTrunk: number; name: string; destination: string;
    orderNo?: number | 'first' | 'last';
    trunkUsername?: string; password?: string;
    outboundIp?: string | null; outboundCld?: string;
    iProtoTransport?: number; iPrivacyMode?: number;
    trustedPrivacyDomain?: boolean; usePrivIdAsCli?: boolean;
    useAssertedId?: boolean; assertedIdTranslation?: string;
    enableDiversion?: boolean; huntstopScodes?: string;
    blocked?: boolean; capacity?: number | null;
    maxCps?: number | null; fromDomain?: string;
    randomCallId?: boolean;
  },
): Promise<{ ok: boolean; iTrunkConnection?: number; message?: string }> {
  if (!activeSession) return { ok: false, message: 'Not connected' };
  const apiUrl = `${activeSession.portalUrl}/xmlapi/xmlapi`;
  const p: Record<string, unknown> = {
    i_trunk: params.iTrunk, name: params.name,
    destination: params.destination, i_customer: 1,
  };
  if (params.orderNo           !== undefined) p.order_no                = params.orderNo;
  if (params.trunkUsername     !== undefined) p.username                = params.trunkUsername;
  if (params.password          !== undefined) p.password                = params.password;
  if (params.outboundIp        !== undefined) p.outbound_ip             = params.outboundIp;
  if (params.outboundCld       !== undefined) p.outbound_cld            = params.outboundCld;
  if (params.iProtoTransport   !== undefined) p.i_proto_transport       = params.iProtoTransport;
  if (params.iPrivacyMode      !== undefined) p.i_privacy_mode          = params.iPrivacyMode;
  if (params.trustedPrivacyDomain !== undefined) p.trusted_privacy_domain = params.trustedPrivacyDomain;
  if (params.usePrivIdAsCli    !== undefined) p.use_priv_id_as_cli      = params.usePrivIdAsCli;
  if (params.useAssertedId     !== undefined) p.use_asserted_id         = params.useAssertedId;
  if (params.assertedIdTranslation !== undefined) p.asserted_id_translation = params.assertedIdTranslation;
  if (params.enableDiversion   !== undefined) p.enable_diversion        = params.enableDiversion;
  if (params.huntstopScodes    !== undefined) p.huntstop_scodes         = params.huntstopScodes;
  if (params.blocked           !== undefined) p.blocked                 = params.blocked;
  if (params.capacity          !== undefined) p.capacity                = params.capacity;
  if (params.maxCps            !== undefined) p.max_cps                 = params.maxCps;
  if (params.fromDomain        !== undefined) p.from_domain             = params.fromDomain;
  if (params.randomCallId      !== undefined) p.random_call_id          = params.randomCallId;
  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('createTrunkConnection', p), username, password);
    const text = resp.body.toString?.() ?? resp.body;
    if (text.includes('faultCode')) {
      const fault = extractTag(text, 'faultString');
      return { ok: false, message: fault?.replace(/<[^>]+>/g, '').trim() || 'createTrunkConnection failed.' };
    }
    const m = extractStructMembers(extractAllTags(text, 'struct')[0] ?? '');
    return { ok: true, iTrunkConnection: m['i_trunk_connection'] ? parseInt(m['i_trunk_connection'], 10) : undefined };
  } catch (e: any) { return { ok: false, message: e.message }; }
}

/** updateTrunkConnection() — docs 3000116552 */
export async function updateTrunkConnection(
  username: string, password: string,
  params: {
    iTrunkConnection: number;
    name?: string; destination?: string;
    orderNo?: number | 'first' | 'last' | 'up' | 'down';
    trunkUsername?: string; password?: string;
    outboundIp?: string | null; outboundCld?: string;
    iProtoTransport?: number; iPrivacyMode?: number;
    trustedPrivacyDomain?: boolean; usePrivIdAsCli?: boolean;
    useAssertedId?: boolean; assertedIdTranslation?: string;
    enableDiversion?: boolean; huntstopScodes?: string;
    blocked?: boolean; capacity?: number | null;
    maxCps?: number | null; fromDomain?: string;
    randomCallId?: boolean;
  },
): Promise<{ ok: boolean; iTrunkConnection?: number; message?: string }> {
  if (!activeSession) return { ok: false, message: 'Not connected' };
  const apiUrl = `${activeSession.portalUrl}/xmlapi/xmlapi`;
  const p: Record<string, unknown> = { i_trunk_connection: params.iTrunkConnection, i_customer: 1 };
  if (params.name              !== undefined) p.name                    = params.name;
  if (params.destination       !== undefined) p.destination             = params.destination;
  if (params.orderNo           !== undefined) p.order_no                = params.orderNo;
  if (params.trunkUsername     !== undefined) p.username                = params.trunkUsername;
  if (params.password          !== undefined) p.password                = params.password;
  if (params.outboundIp        !== undefined) p.outbound_ip             = params.outboundIp;
  if (params.outboundCld       !== undefined) p.outbound_cld            = params.outboundCld;
  if (params.iProtoTransport   !== undefined) p.i_proto_transport       = params.iProtoTransport;
  if (params.iPrivacyMode      !== undefined) p.i_privacy_mode          = params.iPrivacyMode;
  if (params.trustedPrivacyDomain !== undefined) p.trusted_privacy_domain = params.trustedPrivacyDomain;
  if (params.usePrivIdAsCli    !== undefined) p.use_priv_id_as_cli      = params.usePrivIdAsCli;
  if (params.useAssertedId     !== undefined) p.use_asserted_id         = params.useAssertedId;
  if (params.assertedIdTranslation !== undefined) p.asserted_id_translation = params.assertedIdTranslation;
  if (params.enableDiversion   !== undefined) p.enable_diversion        = params.enableDiversion;
  if (params.huntstopScodes    !== undefined) p.huntstop_scodes         = params.huntstopScodes;
  if (params.blocked           !== undefined) p.blocked                 = params.blocked;
  if (params.capacity          !== undefined) p.capacity                = params.capacity;
  if (params.maxCps            !== undefined) p.max_cps                 = params.maxCps;
  if (params.fromDomain        !== undefined) p.from_domain             = params.fromDomain;
  if (params.randomCallId      !== undefined) p.random_call_id          = params.randomCallId;
  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('updateTrunkConnection', p), username, password);
    const text = resp.body.toString?.() ?? resp.body;
    if (text.includes('faultCode')) {
      const fault = extractTag(text, 'faultString');
      return { ok: false, message: fault?.replace(/<[^>]+>/g, '').trim() || 'updateTrunkConnection failed.' };
    }
    const m = extractStructMembers(extractAllTags(text, 'struct')[0] ?? '');
    return { ok: true, iTrunkConnection: m['i_trunk_connection'] ? parseInt(m['i_trunk_connection'], 10) : params.iTrunkConnection };
  } catch (e: any) { return { ok: false, message: e.message }; }
}

/** deleteTrunkConnection() — docs 3000116552 */
export async function deleteTrunkConnection(
  username: string, password: string, iTrunkConnection: number,
): Promise<{ ok: boolean; message?: string }> {
  if (!activeSession) return { ok: false, message: 'Not connected' };
  const apiUrl = `${activeSession.portalUrl}/xmlapi/xmlapi`;
  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('deleteTrunkConnection', { i_trunk_connection: iTrunkConnection, i_customer: 1 }), username, password);
    const text = resp.body.toString?.() ?? resp.body;
    if (text.includes('faultCode')) {
      const fault = extractTag(text, 'faultString');
      return { ok: false, message: fault?.replace(/<[^>]+>/g, '').trim() || 'deleteTrunkConnection failed.' };
    }
    return { ok: true };
  } catch (e: any) { return { ok: false, message: e.message }; }
}

/** getTrunkConnectionInfo() — docs 3000116552 */
export async function getTrunkConnectionInfo(
  username: string, password: string,
  params: { iTrunkConnection?: number; iConnection?: number },
): Promise<{ ok: boolean; trunkConnection?: SippyTrunkConnection; message?: string }> {
  if (!activeSession) return { ok: false, message: 'Not connected' };
  const apiUrl = `${activeSession.portalUrl}/xmlapi/xmlapi`;
  const p: Record<string, unknown> = { i_customer: 1 };
  if (params.iTrunkConnection) p.i_trunk_connection = params.iTrunkConnection;
  if (params.iConnection)      p.i_connection       = params.iConnection;
  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('getTrunkConnectionInfo', p), username, password);
    const text = resp.body.toString?.() ?? resp.body;
    if (text.includes('faultCode')) {
      const fault = extractTag(text, 'faultString');
      return { ok: false, message: fault?.replace(/<[^>]+>/g, '').trim() || 'getTrunkConnectionInfo failed.' };
    }
    const structs = extractAllTags(text, 'struct');
    for (const s of structs) {
      const tc = parseTrunkConnectionStruct(s);
      if (tc) return { ok: true, trunkConnection: tc };
    }
    return { ok: false, message: 'Trunk connection not found in response.' };
  } catch (e: any) { return { ok: false, message: e.message }; }
}

/** getTrunkConnectionsList() — docs 3000116552 */
export async function getTrunkConnectionsList(
  username: string, password: string,
  params: { iTrunk: number; namePattern?: string },
): Promise<{ ok: boolean; trunkConnections: SippyTrunkConnection[]; message?: string }> {
  if (!activeSession) return { ok: false, trunkConnections: [], message: 'Not connected' };
  const apiUrl = `${activeSession.portalUrl}/xmlapi/xmlapi`;
  const p: Record<string, unknown> = { i_trunk: params.iTrunk, i_customer: 1 };
  if (params.namePattern) p.name_pattern = params.namePattern;
  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('getTrunkConnectionsList', p), username, password);
    const text = resp.body.toString?.() ?? resp.body;
    if (text.includes('faultCode')) {
      const fault = extractTag(text, 'faultString');
      return { ok: false, trunkConnections: [], message: fault?.replace(/<[^>]+>/g, '').trim() || 'getTrunkConnectionsList failed.' };
    }
    const structs = extractAllTags(text, 'struct');
    const trunkConnections: SippyTrunkConnection[] = [];
    for (const s of structs) {
      const tc = parseTrunkConnectionStruct(s);
      if (tc) trunkConnections.push(tc);
    }
    return { ok: true, trunkConnections };
  } catch (e: any) { return { ok: false, trunkConnections: [], message: e.message }; }
}

// ── Account Minute Plans (docs 107402) ───────────────────────────────────────

export interface SippyMinutePlan {
  iServicePlan: number;        // ID of the minute plan
  description: string;         // plan description
  price: number;               // price of the minute plan
  secondsTotal: number | null; // total seconds in plan (null = Unlimited)
  secondsLeft: number | null;  // seconds remaining (null = Unlimited)
  chargeableSeconds: number;   // seconds charged beyond the plan
}

/**
 * Get minute plans for an account.
 * Official method: getAccountMinutePlans() — docs 107402
 *
 * NOTE: Does NOT support trusted mode.
 * Parameters: i_account (required)
 * Returns: array of minute plan structs.
 */
export async function getAccountMinutePlans(
  username: string,
  password: string,
  iAccount: number,
  portalUrl?: string,
): Promise<{ success: boolean; minutePlans: SippyMinutePlan[]; error?: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, minutePlans: [], error: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('getAccountMinutePlans', { i_account: iAccount }), username, password);
    const text = resp.body;
    if (text.includes('<fault>')) {
      const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
        ?? extractTag(text, 'faultString') ?? 'getAccountMinutePlans failed.';
      return { success: false, minutePlans: [], error: fault };
    }

    const arrayMatch = /<name>minute_plans<\/name>\s*<value>\s*<array>([\s\S]*?)<\/array>\s*<\/value>/.exec(text);
    if (!arrayMatch) return { success: true, minutePlans: [] };

    const minutePlans: SippyMinutePlan[] = [];
    const structRe = /<struct>([\s\S]*?)<\/struct>/g;
    let match: RegExpExecArray | null;
    while ((match = structRe.exec(arrayMatch[1])) !== null) {
      const m = extractStructMembers(`<struct>${match[1]}</struct>`);
      const nullableInt = (k: string): number | null => {
        if (!(k in m) || m[k] === '' || m[k] === 'None' || m[k] === 'nil') return null;
        const n = parseInt(m[k], 10); return isNaN(n) ? null : n;
      };
      minutePlans.push({
        iServicePlan:      parseInt(m['i_service_plan'] || '0', 10),
        description:       m['description'] || '',
        price:             parseFloat(m['price'] || '0'),
        secondsTotal:      nullableInt('seconds_total'),
        secondsLeft:       nullableInt('seconds_left'),
        chargeableSeconds: parseInt(m['chargeable_seconds'] || '0', 10),
      });
    }
    return { success: true, minutePlans };
  } catch (e: any) {
    return { success: false, minutePlans: [], error: e.message };
  }
}

// ── Reset Account One-Time Password (docs 107399) ────────────────────────────

/**
 * Reset the one-time password used by an account to log into the web interface.
 * Official method: resetAccountOneTimePassword() — docs 107399
 *
 * NOTE: Takes the account's web login `username` (not i_account).
 *       Only accounts of the authenticated customer can be reset.
 *       No trusted mode documented.
 */
export async function resetAccountOneTimePassword(
  username: string,
  password: string,
  accountUsername: string,
  portalUrl?: string,
): Promise<{ success: boolean; password?: string; message: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('resetAccountOneTimePassword', { username: accountUsername }), username, password);
    const text = resp.body;

    if (text.includes('<fault>')) {
      const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
        ?? extractTag(text, 'faultString') ?? 'resetAccountOneTimePassword failed.';
      return { success: false, message: fault };
    }

    const m = extractStructMembers(text);
    const newPassword = m['password'] ?? extractTag(text, 'password');
    return { success: true, password: newPassword, message: 'One-time password reset successfully.' };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

// ── Post-Authentication Rules Management (docs 3000105881) ───────────────────
// Available since Sippy 2020. Supports wildcard matching since Sippy 2022.
// NOTE: Post-auth rules differ from pre-auth rules: no i_protocol, no max_sessions/max_cps.
//       Field names are cli/cld (not incoming_cli/incoming_cld).

export interface SippyPostAuthRule {
  iPostAuthRule: number;
  remoteIp?: string;
  cli?: string;                  // caller number (CLI)
  cld?: string;                  // callee number (CLD)
  cliTranslationRule?: string;
  cldTranslationRule?: string;
  iTariff?: number | null;       // null = use account's base tariff
  iRoutingGroup?: number | null; // null = use account's routing group
}

export interface AddPostAuthRuleOpts {
  iAccount: number;             // required
  iCustomer?: number;           // trusted mode
  // At least ONE of these must be present:
  remoteIp?: string;
  cli?: string;
  cld?: string;
  // Optional:
  cliTranslationRule?: string;
  cldTranslationRule?: string;
  iTariff?: number | null;
  iRoutingGroup?: number | null;
}

export interface UpdatePostAuthRuleOpts {
  iPostAuthRule: number;        // required
  iCustomer?: number;           // trusted mode
  remoteIp?: string;
  cli?: string;
  cld?: string;
  cliTranslationRule?: string;
  cldTranslationRule?: string;
  iTariff?: number | null;
  iRoutingGroup?: number | null;
}

/** Parse a flat post_auth_rule <struct> block. */
function parsePostAuthRuleStruct(structBody: string): SippyPostAuthRule {
  const m = extractStructMembers(`<struct>${structBody}</struct>`);
  const str = (k: string) => m[k] || undefined;
  const nullableInt = (k: string): number | null | undefined => {
    if (!(k in m)) return undefined;
    if (m[k] === '' || m[k] === 'None' || m[k] === 'nil') return null;
    const n = parseInt(m[k], 10); return isNaN(n) ? null : n;
  };
  return {
    iPostAuthRule:     parseInt(m['i_post_auth_rule'] || '0', 10),
    remoteIp:          str('remote_ip'),
    cli:               str('cli'),
    cld:               str('cld'),
    cliTranslationRule: str('cli_translation_rule'),
    cldTranslationRule: str('cld_translation_rule'),
    iTariff:           nullableInt('i_tariff'),
    iRoutingGroup:     nullableInt('i_routing_group'),
  };
}

/**
 * Add a post-authentication rule to an account.
 * Official method: addPostAuthRule() — docs 3000105881 (since Sippy 2020)
 */
export async function addPostAuthRule(
  username: string,
  password: string,
  opts: AddPostAuthRuleOpts,
  portalUrl?: string,
): Promise<{ success: boolean; iPostAuthRule?: number; message: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number | null> = { i_account: opts.iAccount };
  if (opts.iCustomer          !== undefined) params.i_customer           = opts.iCustomer;
  if (opts.remoteIp           !== undefined) params.remote_ip            = opts.remoteIp;
  if (opts.cli                !== undefined) params.cli                  = opts.cli;
  if (opts.cld                !== undefined) params.cld                  = opts.cld;
  if (opts.cliTranslationRule !== undefined) params.cli_translation_rule = opts.cliTranslationRule;
  if (opts.cldTranslationRule !== undefined) params.cld_translation_rule = opts.cldTranslationRule;
  if (opts.iTariff            !== undefined) params.i_tariff             = opts.iTariff;
  if (opts.iRoutingGroup      !== undefined) params.i_routing_group      = opts.iRoutingGroup;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('addPostAuthRule', params), username, password);
    const text = resp.body;
    if (text.includes('<fault>')) {
      const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
        ?? extractTag(text, 'faultString') ?? 'addPostAuthRule failed.';
      return { success: false, message: fault };
    }
    const m = extractStructMembers(text);
    const iPostAuthRule = parseInt(m['i_post_auth_rule'] || '0', 10);
    return { success: true, iPostAuthRule, message: 'Post-auth rule added.' };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Update a post-authentication rule.
 * Official method: updatePostAuthRule() — docs 3000105881
 */
export async function updatePostAuthRule(
  username: string,
  password: string,
  opts: UpdatePostAuthRuleOpts,
  portalUrl?: string,
): Promise<{ success: boolean; message: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number | null> = { i_post_auth_rule: opts.iPostAuthRule };
  if (opts.iCustomer          !== undefined) params.i_customer           = opts.iCustomer;
  if (opts.remoteIp           !== undefined) params.remote_ip            = opts.remoteIp;
  if (opts.cli                !== undefined) params.cli                  = opts.cli;
  if (opts.cld                !== undefined) params.cld                  = opts.cld;
  if (opts.cliTranslationRule !== undefined) params.cli_translation_rule = opts.cliTranslationRule;
  if (opts.cldTranslationRule !== undefined) params.cld_translation_rule = opts.cldTranslationRule;
  if (opts.iTariff            !== undefined) params.i_tariff             = opts.iTariff;
  if (opts.iRoutingGroup      !== undefined) params.i_routing_group      = opts.iRoutingGroup;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('updatePostAuthRule', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      return { success: true, message: 'Post-auth rule updated.' };
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'updatePostAuthRule failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Delete a post-authentication rule.
 * Official method: deletePostAuthRule() — docs 3000105881
 */
export async function deletePostAuthRule(
  username: string,
  password: string,
  iPostAuthRule: number,
  opts?: { iCustomer?: number; portalUrl?: string },
): Promise<{ success: boolean; message: string }> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number> = { i_post_auth_rule: iPostAuthRule };
  if (opts?.iCustomer !== undefined) params.i_customer = opts.iCustomer;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('deletePostAuthRule', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      return { success: true, message: 'Post-auth rule deleted.' };
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'deletePostAuthRule failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Get info for a single post-authentication rule.
 * Official method: getPostAuthRuleInfo() — docs 3000105881
 */
export async function getPostAuthRuleInfo(
  username: string,
  password: string,
  iPostAuthRule: number,
  opts?: { iCustomer?: number; portalUrl?: string },
): Promise<{ success: boolean; postAuthRule?: SippyPostAuthRule; error?: string }> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, error: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number> = { i_post_auth_rule: iPostAuthRule };
  if (opts?.iCustomer !== undefined) params.i_customer = opts.iCustomer;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('getPostAuthRuleInfo', params), username, password);
    const text = resp.body;
    if (text.includes('<fault>')) {
      const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
        ?? extractTag(text, 'faultString') ?? 'getPostAuthRuleInfo failed.';
      return { success: false, error: fault };
    }
    const nestedMatch = /<name>post_auth_rule<\/name>\s*<value>\s*<struct>([\s\S]*?)<\/struct>\s*<\/value>/.exec(text);
    if (!nestedMatch) return { success: false, error: 'post_auth_rule struct not found in response.' };
    return { success: true, postAuthRule: parsePostAuthRuleStruct(nestedMatch[1]) };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/**
 * List post-authentication rules for an account.
 * Official method: listPostAuthRules() — docs 3000105881
 */
export async function listPostAuthRules(
  username: string,
  password: string,
  opts: {
    iAccount: number;
    iCustomer?: number;
    remoteIp?: string;
    offset?: number;
    limit?: number;
    portalUrl?: string;
  },
): Promise<{ postAuthRules: SippyPostAuthRule[]; error?: string }> {
  const base = opts.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { postAuthRules: [], error: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number> = { i_account: opts.iAccount };
  if (opts.iCustomer !== undefined) params.i_customer = opts.iCustomer;
  if (opts.remoteIp  !== undefined) params.remote_ip  = opts.remoteIp;
  if (opts.offset    !== undefined) params.offset     = opts.offset;
  if (opts.limit     !== undefined) params.limit      = opts.limit;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('listPostAuthRules', params), username, password);
    const text = resp.body;
    if (text.includes('<fault>')) {
      const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
        ?? extractTag(text, 'faultString') ?? 'listPostAuthRules failed.';
      return { postAuthRules: [], error: fault };
    }

    const arrayMatch = /<name>post_auth_rules<\/name>\s*<value>\s*<array>([\s\S]*?)<\/array>\s*<\/value>/.exec(text);
    if (!arrayMatch) return { postAuthRules: [] };

    const postAuthRules: SippyPostAuthRule[] = [];
    const structRe = /<struct>([\s\S]*?)<\/struct>/g;
    let match: RegExpExecArray | null;
    while ((match = structRe.exec(arrayMatch[1])) !== null) {
      postAuthRules.push(parsePostAuthRuleStruct(match[1]));
    }
    return { postAuthRules };
  } catch (e: any) {
    return { postAuthRules: [], error: e.message };
  }
}

// ── CLD Minute Plan Matching (docs 107406) ───────────────────────────────────

/**
 * Match a CLD (destination) against the minute plans of an account.
 * Official method: matchAccountMinutePlan() — docs 107406
 *
 * NOTE: No trusted mode documented.
 * Fault code 410 = no minute plan matched — returned as { matched: false } (not an error).
 */
export async function matchAccountMinutePlan(
  username: string,
  password: string,
  iAccount: number,
  cld: string,
  portalUrl?: string,
): Promise<{
  matched: boolean;
  iServicePlan?: number;
  secondsTotal?: number | null;  // null = Unlimited
  secondsLeft?: number | null;   // null = Unlimited
  error?: string;
}> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { matched: false, error: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('matchAccountMinutePlan', { i_account: iAccount, cld }), username, password);
    const text = resp.body;

    if (text.includes('<fault>')) {
      // Fault code 410 = "no plan matched" — not an application error
      const codeMatch = text.match(/<name>faultCode<\/name>\s*<value>\s*(?:<int>)?(\d+)(?:<\/int>)?\s*<\/value>/i);
      const faultCode = codeMatch ? parseInt(codeMatch[1], 10) : 0;
      if (faultCode === 410) return { matched: false };
      const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
        ?? extractTag(text, 'faultString') ?? 'matchAccountMinutePlan failed.';
      return { matched: false, error: fault };
    }

    const m = extractStructMembers(text);
    const nullableInt = (k: string): number | null | undefined => {
      if (!(k in m)) return undefined;
      if (m[k] === '' || m[k] === 'None' || m[k] === 'nil') return null;
      const n = parseInt(m[k], 10); return isNaN(n) ? null : n;
    };

    return {
      matched:      true,
      iServicePlan: m['i_service_plan'] ? parseInt(m['i_service_plan'], 10) : undefined,
      secondsTotal: nullableInt('seconds_total'),
      secondsLeft:  nullableInt('seconds_left'),
    };
  } catch (e: any) {
    return { matched: false, error: e.message };
  }
}

// ── Trusted Numbers / CLI Mappings (docs 107328) ─────────────────────────────
// No trusted mode documented for any of these methods.
// Used for calling-card (trusted number) CLI association.

export interface SippyCLIMapping {
  cli:  string;   // the CLI (caller number) associated with the account
  lang: string;   // two-character language code (e.g. 'en', 'ru')
}

export interface SippyCLIMappingInfo {
  iAccount: number;
  cli:      string;
  lang:     string;
  authname: string;   // authname of associated account
  username: string;   // username of associated account
}

/**
 * Associate a CLI with a calling-card account (add trusted number).
 * Official method: addCLIMapping() — docs 107328
 */
export async function addCLIMapping(
  username: string,
  password: string,
  iAccount: number,
  cli: string,
  lang: string,
  portalUrl?: string,
): Promise<{ success: boolean; message: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;
  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('addCLIMapping', { i_account: iAccount, cli, lang }), username, password);
    const text = resp.body;
    if (text.includes('<fault>')) {
      const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
        ?? extractTag(text, 'faultString') ?? 'addCLIMapping failed.';
      return { success: false, message: fault };
    }
    return { success: true, message: 'CLI mapping added.' };
  } catch (e: any) { return { success: false, message: e.message }; }
}

/**
 * Update an existing CLI mapping (trusted number).
 * Official method: updateCLIMapping() — docs 107328
 * lang is optional (available from Sippy 2020).
 */
export async function updateCLIMapping(
  username: string,
  password: string,
  iAccount: number,
  oldCli: string,
  newCli: string,
  lang?: string,
  portalUrl?: string,
): Promise<{ success: boolean; message: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number> = { i_account: iAccount, old_cli: oldCli, new_cli: newCli };
  if (lang !== undefined) params.lang = lang;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('updateCLIMapping', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) return { success: true, message: 'CLI mapping updated.' };
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'updateCLIMapping failed.';
    return { success: false, message: fault };
  } catch (e: any) { return { success: false, message: e.message }; }
}

/**
 * Remove a CLI association from a calling-card account.
 * Official method: delCLIMapping() — docs 107328
 */
export async function delCLIMapping(
  username: string,
  password: string,
  iAccount: number,
  cli: string,
  portalUrl?: string,
): Promise<{ success: boolean; message: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;
  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('delCLIMapping', { i_account: iAccount, cli }), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) return { success: true, message: 'CLI mapping removed.' };
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'delCLIMapping failed.';
    return { success: false, message: fault };
  } catch (e: any) { return { success: false, message: e.message }; }
}

/**
 * List all CLIs associated with a calling-card account.
 * Official method: listCLIMappings() — docs 107328
 * Returns array of { cli, lang } tuples.
 */
export async function listCLIMappings(
  username: string,
  password: string,
  iAccount: number,
  portalUrl?: string,
): Promise<{ mappings: SippyCLIMapping[]; error?: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { mappings: [], error: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;
  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('listCLIMappings', { i_account: iAccount }), username, password);
    const text = resp.body;
    if (text.includes('<fault>')) {
      const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
        ?? extractTag(text, 'faultString') ?? 'listCLIMappings failed.';
      return { mappings: [], error: fault };
    }

    // Result is under <name>list</name> — array of (cli, lang) structs
    const arrayMatch = /<name>list<\/name>\s*<value>\s*<array>([\s\S]*?)<\/array>\s*<\/value>/.exec(text);
    if (!arrayMatch) return { mappings: [] };

    const mappings: SippyCLIMapping[] = [];
    const structRe = /<struct>([\s\S]*?)<\/struct>/g;
    let m: RegExpExecArray | null;
    while ((m = structRe.exec(arrayMatch[1])) !== null) {
      const fields = extractStructMembers(`<struct>${m[1]}</struct>`);
      mappings.push({ cli: fields['cli'] ?? '', lang: fields['lang'] ?? '' });
    }

    // Fallback: if Sippy returns flat string values in the array (non-struct tuples)
    if (mappings.length === 0) {
      const strRe = /<value>\s*(?:<string>)?([^<]+)(?:<\/string>)?\s*<\/value>/g;
      const vals: string[] = [];
      let sv: RegExpExecArray | null;
      while ((sv = strRe.exec(arrayMatch[1])) !== null) vals.push(sv[1].trim());
      for (let i = 0; i + 1 < vals.length; i += 2) {
        mappings.push({ cli: vals[i], lang: vals[i + 1] });
      }
    }

    return { mappings };
  } catch (e: any) { return { mappings: [], error: e.message }; }
}

/**
 * Look up CLI mapping info by CLI number and customer.
 * Official method: findCLIMapping() — docs 107328 (available from Sippy 2.0)
 * Returns account info for the account associated with this CLI.
 */
export async function findCLIMapping(
  username: string,
  password: string,
  cli: string,
  iCustomer: number,
  portalUrl?: string,
): Promise<{ success: boolean; info?: SippyCLIMappingInfo; error?: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, error: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;
  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('findCLIMapping', { cli, i_customer: iCustomer }), username, password);
    const text = resp.body;
    if (text.includes('<fault>')) {
      const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
        ?? extractTag(text, 'faultString') ?? 'findCLIMapping failed.';
      return { success: false, error: fault };
    }
    const m = extractStructMembers(text);
    return {
      success: true,
      info: {
        iAccount: parseInt(m['i_account'] || '0', 10),
        cli:      m['cli']      ?? cli,
        lang:     m['lang']     ?? '',
        authname: m['authname'] ?? '',
        username: m['username'] ?? '',
      },
    };
  } catch (e: any) { return { success: false, error: e.message }; }
}

// ── Smart Dials Manipulation (docs 107333) ───────────────────────────────────
// NOTE: These APIs do NOT support trusted mode.

export interface SippySmartDial {
  did: string;          // DID number (the key/identifier)
  dest: string;         // destination number to dial
  description?: string; // optional custom description
}

/**
 * Add a smart dial entry to an account.
 * Official method: addSmartDial() — docs 107333. No trusted mode.
 */
export async function addSmartDial(
  username: string,
  password: string,
  iAccount: number,
  did: string,
  dest: string,
  description?: string,
  portalUrl?: string,
): Promise<{ success: boolean; message: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number> = { i_account: iAccount, did, dest };
  if (description !== undefined) params.description = description;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('addSmartDial', params), username, password);
    const text = resp.body;
    if (text.includes('<fault>')) {
      const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
        ?? extractTag(text, 'faultString') ?? 'addSmartDial failed.';
      return { success: false, message: fault };
    }
    return { success: true, message: 'Smart dial added.' };
  } catch (e: any) { return { success: false, message: e.message }; }
}

/**
 * Update an existing smart dial entry.
 * Official method: updateSmartDial() — docs 107333. No trusted mode.
 */
export async function updateSmartDial(
  username: string,
  password: string,
  iAccount: number,
  did: string,
  opts: { dest?: string; description?: string },
  portalUrl?: string,
): Promise<{ success: boolean; message: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number> = { i_account: iAccount, did };
  if (opts.dest        !== undefined) params.dest        = opts.dest;
  if (opts.description !== undefined) params.description = opts.description;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('updateSmartDial', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      return { success: true, message: 'Smart dial updated.' };
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'updateSmartDial failed.';
    return { success: false, message: fault };
  } catch (e: any) { return { success: false, message: e.message }; }
}

/**
 * Delete a smart dial entry from an account.
 * Official method: deleteSmartDial() — docs 107333. No trusted mode.
 */
export async function deleteSmartDial(
  username: string,
  password: string,
  iAccount: number,
  did: string,
  portalUrl?: string,
): Promise<{ success: boolean; message: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('deleteSmartDial', { i_account: iAccount, did }), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      return { success: true, message: 'Smart dial deleted.' };
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'deleteSmartDial failed.';
    return { success: false, message: fault };
  } catch (e: any) { return { success: false, message: e.message }; }
}

/**
 * List all smart dial entries for an account.
 * Official method: listSmartDials() — docs 107333. No trusted mode.
 */
export async function listSmartDials(
  username: string,
  password: string,
  iAccount: number,
  portalUrl?: string,
): Promise<{ smartDials: SippySmartDial[]; error?: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { smartDials: [], error: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('listSmartDials', { i_account: iAccount }), username, password);
    const text = resp.body;

    if (text.includes('<fault>')) {
      const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
        ?? extractTag(text, 'faultString') ?? 'listSmartDials failed.';
      return { smartDials: [], error: fault };
    }

    const arrayMatch = /<name>smart_dials<\/name>\s*<value>\s*<array>([\s\S]*?)<\/array>\s*<\/value>/.exec(text);
    if (!arrayMatch) return { smartDials: [] };

    const smartDials: SippySmartDial[] = [];
    const structRe = /<struct>([\s\S]*?)<\/struct>/g;
    let match: RegExpExecArray | null;
    while ((match = structRe.exec(arrayMatch[1])) !== null) {
      const m = extractStructMembers(`<struct>${match[1]}</struct>`);
      smartDials.push({
        did:         m['did']         ?? '',
        dest:        m['dest']        ?? '',
        description: m['description'] || undefined,
      });
    }
    return { smartDials };
  } catch (e: any) { return { smartDials: [], error: e.message }; }
}

// ── Hot Dial Numbers (docs 107330) ───────────────────────────────────────────

export interface SippyHotDialNumber {
  hotKey: string;        // the speed-dial key
  dest: string;          // destination number to dial
  description?: string;  // optional custom description
}

/**
 * Add a hot dial number to an account.
 * Official method: addHotDialNumber() — docs 107330
 * Mandatory: i_account, hot_key, dest. Optional: description, i_customer (trusted mode).
 */
export async function addHotDialNumber(
  username: string,
  password: string,
  iAccount: number,
  opts: {
    hotKey: string;
    dest: string;
    description?: string;
    iCustomer?: number;
    portalUrl?: string;
  },
): Promise<{ success: boolean; message: string }> {
  const base = opts.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number> = { i_account: iAccount, hot_key: opts.hotKey, dest: opts.dest };
  if (opts.iCustomer   !== undefined) params.i_customer   = opts.iCustomer;
  if (opts.description !== undefined) params.description  = opts.description;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('addHotDialNumber', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      return { success: true, message: 'Hot dial number added.' };
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'addHotDialNumber failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Delete a hot dial number from an account.
 * Official method: delHotDialNumber() — docs 107330
 * Mandatory: i_account, hot_key. Optional: i_customer (trusted mode).
 */
export async function delHotDialNumber(
  username: string,
  password: string,
  iAccount: number,
  hotKey: string,
  opts?: { iCustomer?: number; portalUrl?: string },
): Promise<{ success: boolean; message: string }> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number> = { i_account: iAccount, hot_key: hotKey };
  if (opts?.iCustomer !== undefined) params.i_customer = opts.iCustomer;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('delHotDialNumber', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      return { success: true, message: 'Hot dial number deleted.' };
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'delHotDialNumber failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Update a hot dial number on an account.
 * Official method: updateHotDialNumber() — docs 107330
 * Mandatory: i_account, hot_key, dest (new destination). Optional: i_customer (trusted mode).
 */
export async function updateHotDialNumber(
  username: string,
  password: string,
  iAccount: number,
  hotKey: string,
  dest: string,
  opts?: { iCustomer?: number; portalUrl?: string },
): Promise<{ success: boolean; message: string }> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number> = { i_account: iAccount, hot_key: hotKey, dest };
  if (opts?.iCustomer !== undefined) params.i_customer = opts.iCustomer;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('updateHotDialNumber', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      return { success: true, message: 'Hot dial number updated.' };
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'updateHotDialNumber failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * List all hot dial numbers for an account.
 * Official method: listHotDialNumbers() — docs 107330
 * Mandatory: i_account. Optional: i_customer (trusted mode).
 * Returns array of { hotKey, dest, description } entries.
 */
export async function listHotDialNumbers(
  username: string,
  password: string,
  iAccount: number,
  opts?: { iCustomer?: number; portalUrl?: string },
): Promise<{ success: boolean; hotKeys: SippyHotDialNumber[]; error?: string }> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, hotKeys: [], error: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number> = { i_account: iAccount };
  if (opts?.iCustomer !== undefined) params.i_customer = opts.iCustomer;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('listHotDialNumbers', params), username, password);
    const text = resp.body;
    if (text.includes('<fault>')) {
      const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
        ?? extractTag(text, 'faultString') ?? 'listHotDialNumbers failed.';
      return { success: false, hotKeys: [], error: fault };
    }

    const arrayMatch = /<name>hot_keys<\/name>\s*<value>\s*<array>([\s\S]*?)<\/array>\s*<\/value>/.exec(text);
    if (!arrayMatch) return { success: true, hotKeys: [] };

    const hotKeys: SippyHotDialNumber[] = [];
    const structRe = /<struct>([\s\S]*?)<\/struct>/g;
    let match: RegExpExecArray | null;
    while ((match = structRe.exec(arrayMatch[1])) !== null) {
      const m = extractStructMembers(`<struct>${match[1]}</struct>`);
      hotKeys.push({
        hotKey:      m['hot_key']     || '',
        dest:        m['dest']        || '',
        description: m['description'] || undefined,
      });
    }
    return { success: true, hotKeys };
  } catch (e: any) {
    return { success: false, hotKeys: [], error: e.message };
  }
}

// ── Account Rates (docs 107408) ──────────────────────────────────────────────

export interface SippyAccountRate {
  prefix: string;          // dialing prefix
  country: string;         // country name
  description: string;     // rate description
  rate: number;            // per-minute rate (Double)
  localRate?: number;      // local rate, if local calling is enabled on the tariff (Double)
}

/**
 * Get rates for a specific account.
 * Official method: getAccountRates() — docs 107408
 *
 * NOTE: Does NOT mention trusted mode.
 * Parameters: i_account (required), offset, limit, prefix (optional filter).
 * Returns: currency string + array of rate entries.
 */
export async function getAccountRates(
  username: string,
  password: string,
  iAccount: number,
  opts?: {
    offset?: number;
    limit?: number;
    prefix?: string;
    portalUrl?: string;
  },
): Promise<{ success: boolean; currency?: string; rates: SippyAccountRate[]; error?: string }> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, rates: [], error: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number> = { i_account: iAccount };
  if (opts?.offset !== undefined) params.offset = opts.offset;
  if (opts?.limit  !== undefined) params.limit  = opts.limit;
  if (opts?.prefix !== undefined) params.prefix = opts.prefix;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('getAccountRates', params), username, password);
    const text = resp.body;
    if (text.includes('<fault>')) {
      const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
        ?? extractTag(text, 'faultString') ?? 'getAccountRates failed.';
      return { success: false, rates: [], error: fault };
    }

    const top = extractStructMembers(text);
    const currency = top['currency'] || undefined;

    const arrayMatch = /<name>rates<\/name>\s*<value>\s*<array>([\s\S]*?)<\/array>\s*<\/value>/.exec(text);
    if (!arrayMatch) return { success: true, currency, rates: [] };

    const rates: SippyAccountRate[] = [];
    const structRe = /<struct>([\s\S]*?)<\/struct>/g;
    let match: RegExpExecArray | null;
    while ((match = structRe.exec(arrayMatch[1])) !== null) {
      const m = extractStructMembers(`<struct>${match[1]}</struct>`);
      rates.push({
        prefix:      m['prefix']      || '',
        country:     m['country']     || '',
        description: m['description'] || '',
        rate:        parseFloat(m['rate']       || '0'),
        localRate:   m['local_rate'] !== undefined ? parseFloat(m['local_rate']) : undefined,
      });
    }
    return { success: true, currency, rates };
  } catch (e: any) {
    return { success: false, rates: [], error: e.message };
  }
}

// ── Follow Me Feature Management (docs 107412) ────────────────────────────────

export interface SippyFollowMeOptions {
  followmeTimeout?: number;       // ring timeout in seconds
  iFollowmeMode: number;          // 1=Always 2=OnUnavailable 3=Off 4=OnBusy 5=OnNoAnswer 6=OnUnregistered
  followmeModeName?: string;      // human label from Sippy
}

export interface SippyFollowMeEntry {
  iFollowmeEntry: number;
  cld: string;                    // number to forward to
  preference?: string | number;   // 'first'|'last'|#
  description?: string;
  timeout?: number;
}

/**
 * Get Follow Me options for an account.
 * Official method: getFollowMeOptions() — docs 107412
 */
export async function getFollowMeOptions(
  username: string,
  password: string,
  iAccount: number,
  opts?: { iCustomer?: number; portalUrl?: string },
): Promise<{ success: boolean; options?: SippyFollowMeOptions; error?: string }> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, error: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number> = { i_account: iAccount };
  if (opts?.iCustomer !== undefined) params.i_customer = opts.iCustomer;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('getFollowMeOptions', params), username, password);
    const text = resp.body;
    if (text.includes('<fault>')) {
      const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
        ?? extractTag(text, 'faultString') ?? 'getFollowMeOptions failed.';
      return { success: false, error: fault };
    }
    const m = extractStructMembers(text);
    return {
      success: true,
      options: {
        followmeTimeout:  m['followme_timeout'] ? parseInt(m['followme_timeout'], 10) : undefined,
        iFollowmeMode:    parseInt(m['i_followme_mode'] || '3', 10),
        followmeModeName: m['followme_mode_name'] || undefined,
      },
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/**
 * Set Follow Me options for an account.
 * Official method: setFollowMeOptions() — docs 107412
 */
export async function setFollowMeOptions(
  username: string,
  password: string,
  iAccount: number,
  opts: {
    followmeTimeout?: number;
    iFollowmeMode?: number;
    iCustomer?: number;
    portalUrl?: string;
  },
): Promise<{ success: boolean; message: string }> {
  const base = opts.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number> = { i_account: iAccount };
  if (opts.iCustomer      !== undefined) params.i_customer       = opts.iCustomer;
  if (opts.followmeTimeout !== undefined) params.followme_timeout = opts.followmeTimeout;
  if (opts.iFollowmeMode   !== undefined) params.i_followme_mode  = opts.iFollowmeMode;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('setFollowMeOptions', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      return { success: true, message: 'Follow Me options updated.' };
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'setFollowMeOptions failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * List Follow Me entries for an account.
 * Official method: listFollowMeEntries() — docs 107412
 */
export async function listFollowMeEntries(
  username: string,
  password: string,
  iAccount: number,
  opts?: { iCustomer?: number; portalUrl?: string },
): Promise<{ success: boolean; entries: SippyFollowMeEntry[]; error?: string }> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, entries: [], error: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number> = { i_account: iAccount };
  if (opts?.iCustomer !== undefined) params.i_customer = opts.iCustomer;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('listFollowMeEntries', params), username, password);
    const text = resp.body;
    if (text.includes('<fault>')) {
      const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
        ?? extractTag(text, 'faultString') ?? 'listFollowMeEntries failed.';
      return { success: false, entries: [], error: fault };
    }

    const arrayMatch = /<name>followme_entries<\/name>\s*<value>\s*<array>([\s\S]*?)<\/array>\s*<\/value>/.exec(text);
    if (!arrayMatch) return { success: true, entries: [] };

    const entries: SippyFollowMeEntry[] = [];
    const structRe = /<struct>([\s\S]*?)<\/struct>/g;
    let match: RegExpExecArray | null;
    while ((match = structRe.exec(arrayMatch[1])) !== null) {
      const m = extractStructMembers(`<struct>${match[1]}</struct>`);
      const prefRaw = m['preference'];
      const pref = prefRaw !== undefined
        ? (isNaN(Number(prefRaw)) ? prefRaw : Number(prefRaw))
        : undefined;
      entries.push({
        iFollowmeEntry: parseInt(m['i_followme_entry'] || '0', 10),
        cld:            m['cld'] || '',
        preference:     pref,
        description:    m['description'] || undefined,
        timeout:        m['timeout'] ? parseInt(m['timeout'], 10) : undefined,
      });
    }
    return { success: true, entries };
  } catch (e: any) {
    return { success: false, entries: [], error: e.message };
  }
}

/**
 * Add a Follow Me entry to an account.
 * Official method: addFollowMeEntry() — docs 107412
 */
export async function addFollowMeEntry(
  username: string,
  password: string,
  iAccount: number,
  opts: {
    cld: string;
    preference?: string | number;
    description?: string;
    timeout?: number;
    iCustomer?: number;
    portalUrl?: string;
  },
): Promise<{ success: boolean; iFollowmeEntry?: number; message: string }> {
  const base = opts.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number> = { i_account: iAccount, cld: opts.cld };
  if (opts.iCustomer   !== undefined) params.i_customer   = opts.iCustomer;
  if (opts.preference  !== undefined) params.preference   = opts.preference;
  if (opts.description !== undefined) params.description  = opts.description;
  if (opts.timeout     !== undefined) params.timeout      = opts.timeout;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('addFollowMeEntry', params), username, password);
    const text = resp.body;
    if (text.includes('<fault>')) {
      const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
        ?? extractTag(text, 'faultString') ?? 'addFollowMeEntry failed.';
      return { success: false, message: fault };
    }
    const m = extractStructMembers(text);
    const iFollowmeEntry = parseInt(m['i_followme_entry'] || '0', 10);
    return { success: true, iFollowmeEntry, message: 'Follow Me entry added.' };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Update a Follow Me entry.
 * Official method: updateFollowMeEntry() — docs 107412
 */
export async function updateFollowMeEntry(
  username: string,
  password: string,
  iAccount: number,
  iFollowmeEntry: number,
  opts: {
    cld?: string;
    preference?: string | number;  // first|last|up|down|#
    description?: string;
    timeout?: number;
    iCustomer?: number;
    portalUrl?: string;
  },
): Promise<{ success: boolean; message: string }> {
  const base = opts.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number> = { i_account: iAccount, i_followme_entry: iFollowmeEntry };
  if (opts.iCustomer   !== undefined) params.i_customer   = opts.iCustomer;
  if (opts.cld         !== undefined) params.cld          = opts.cld;
  if (opts.preference  !== undefined) params.preference   = opts.preference;
  if (opts.description !== undefined) params.description  = opts.description;
  if (opts.timeout     !== undefined) params.timeout      = opts.timeout;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('updateFollowMeEntry', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      return { success: true, message: 'Follow Me entry updated.' };
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'updateFollowMeEntry failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Delete a Follow Me entry.
 * Official method: deleteFollowMeEntry() — docs 107412
 */
export async function deleteFollowMeEntry(
  username: string,
  password: string,
  iAccount: number,
  iFollowmeEntry: number,
  opts?: { iCustomer?: number; portalUrl?: string },
): Promise<{ success: boolean; message: string }> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number> = { i_account: iAccount, i_followme_entry: iFollowmeEntry };
  if (opts?.iCustomer !== undefined) params.i_customer = opts.iCustomer;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('deleteFollowMeEntry', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      return { success: true, message: 'Follow Me entry deleted.' };
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'deleteFollowMeEntry failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

// ── Block / Unblock Web Users (docs 3000121328) ───────────────────────────────
// Available since Sippy 2023. Supports trusted mode (pass i_customer).
// Cannot be used on the default web user created with the Customer.

/**
 * Block a web user by i_web_user ID.
 * Official method: blockWebUser() — docs 3000121328
 */
export async function blockWebUser(
  username: string,
  password: string,
  iWebUser: number,
  opts?: { iCustomer?: number; portalUrl?: string },
): Promise<{ success: boolean; iWebUser?: number; message: string }> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number> = { i_web_user: iWebUser };
  if (opts?.iCustomer !== undefined) params.i_customer = opts.iCustomer;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('blockWebUser', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const m = extractStructMembers(text);
      const result = m['result'] ?? '';
      const id = m['i_web_user'] ? parseInt(m['i_web_user'], 10) : iWebUser;
      if (result === 'OK') return { success: true, iWebUser: id, message: 'Web user blocked.' };
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'blockWebUser failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Unblock a web user by i_web_user ID.
 * Official method: unblockWebUser() — docs 3000121328
 */
export async function unblockWebUser(
  username: string,
  password: string,
  iWebUser: number,
  opts?: { iCustomer?: number; portalUrl?: string },
): Promise<{ success: boolean; iWebUser?: number; message: string }> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number> = { i_web_user: iWebUser };
  if (opts?.iCustomer !== undefined) params.i_customer = opts.iCustomer;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('unblockWebUser', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const m = extractStructMembers(text);
      const result = m['result'] ?? '';
      const id = m['i_web_user'] ? parseInt(m['i_web_user'], 10) : iWebUser;
      if (result === 'OK') return { success: true, iWebUser: id, message: 'Web user unblocked.' };
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'unblockWebUser failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

// ── Destination Sets Management (docs 107473) ────────────────────────────────

/**
 * Format a JS Date into Sippy's ISO8601 compact format for sending dates in API calls.
 * Format: YYYYMMDDThh:mm:ss (UTC, no timezone suffix) — docs 3000073101
 * Used for activation_date / expiration_date in route methods.
 */
export function toSippyIso8601(d: Date | string): string {
  const dt = typeof d === 'string' ? new Date(d) : d;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}T${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}:${pad(dt.getUTCSeconds())}`;
}

export interface SippyDestinationSet {
  iDestinationSet:               number;
  name:                          string;
  iso4217:                       string;
  cldTranslationRule?:           string | null;
  cliTranslationRule?:           string | null;
  isRemote?:                     boolean | null;
  isExportable?:                 boolean | null;
  // EXPORTABLE fields
  postCallSurcharge?:            number | null;
  connectFee?:                   number | null;
  freeSeconds?:                  number | null;
  gracePeriod?:                  number | null;
  localCalling?:                 boolean | null;
  localCallingCliValidationRule?: string | null;
  lockForUpload?:                boolean | null;
  exportKey?:                    string | null;
  // IMPORTABLE fields
  importHealth?:                 string | null;
  firstImportFailureTs?:         string | null;
  lastImportFailureTs?:          string | null;
  importError?:                  string | null;
  importHealthLastNotification?: string | null;
  notifyOnImportError?:          boolean | null;
  remoteId?:                     string | null;
}

export interface SippyDestinationSetRoute {
  prefix:         string;
  preference?:    number | null;
  huntstop?:      number | null;
  timeout?:       number | null;
  price1?:        number | null;
  priceN?:        number | null;
  interval1?:     number | null;
  intervalN?:     number | null;
  timeout1xx?:    number | null;
  forbidden?:     boolean | null;
  activationDate?: string | null;
  expirationDate?: string | null;
}

function parseDestinationSet(m: Record<string, string>): SippyDestinationSet {
  const nullableStr  = (k: string) => (!m[k] || m[k] === 'nil' || m[k] === 'None') ? null : m[k];
  const nullableInt  = (k: string) => (!m[k] || m[k] === 'nil' || m[k] === 'None') ? null : parseInt(m[k], 10);
  const nullableFloat = (k: string) => (!m[k] || m[k] === 'nil' || m[k] === 'None') ? null : parseFloat(m[k]);
  const nullableBool = (k: string) => (!m[k] || m[k] === 'nil' || m[k] === 'None') ? null : (m[k] === '1' || m[k].toLowerCase() === 'true');
  return {
    iDestinationSet:               parseInt(m['i_destination_set'] || '0', 10),
    name:                          m['name'] ?? '',
    iso4217:                       m['iso_4217'] ?? m['currency'] ?? '',
    cldTranslationRule:            nullableStr('cld_translation_rule'),
    cliTranslationRule:            nullableStr('cli_translation_rule'),
    isRemote:                      nullableBool('is_remote'),
    isExportable:                  nullableBool('is_exportable'),
    postCallSurcharge:             nullableFloat('post_call_surcharge'),
    connectFee:                    nullableFloat('connect_fee'),
    freeSeconds:                   nullableInt('free_seconds'),
    gracePeriod:                   nullableInt('grace_period'),
    localCalling:                  nullableBool('local_calling'),
    localCallingCliValidationRule: nullableStr('local_calling_cli_validation_rule'),
    lockForUpload:                 nullableBool('lock_for_upload'),
    exportKey:                     nullableStr('export_key'),
    importHealth:                  nullableStr('import_health'),
    firstImportFailureTs:          nullableStr('first_import_failure_ts'),
    lastImportFailureTs:           nullableStr('last_import_failure_ts'),
    importError:                   nullableStr('import_error'),
    importHealthLastNotification:  nullableStr('import_health_last_notification'),
    notifyOnImportError:           nullableBool('notify_on_import_error'),
    remoteId:                      nullableStr('remote_id'),
  };
}

function parseDestinationSetRoute(m: Record<string, string>): SippyDestinationSetRoute {
  const nullableInt   = (k: string) => (!m[k] || m[k] === 'nil' || m[k] === 'None') ? null : parseInt(m[k], 10);
  const nullableFloat = (k: string) => (!m[k] || m[k] === 'nil' || m[k] === 'None') ? null : parseFloat(m[k]);
  const nullableBool  = (k: string) => (!m[k] || m[k] === 'nil' || m[k] === 'None') ? null : (m[k] === '1' || m[k].toLowerCase() === 'true');
  const nullableStr   = (k: string) => (!m[k] || m[k] === 'nil' || m[k] === 'None') ? null : m[k];
  return {
    prefix:          m['prefix'] ?? '',
    preference:      nullableInt('preference'),
    huntstop:        nullableInt('huntstop'),
    timeout:         nullableInt('timeout'),
    price1:          nullableFloat('price_1'),
    priceN:          nullableFloat('price_n'),
    interval1:       nullableInt('interval_1'),
    intervalN:       nullableInt('interval_n'),
    timeout1xx:      nullableInt('timeout_1xx'),
    forbidden:       nullableBool('forbidden'),
    activationDate:  nullableStr('activation_date'),
    expirationDate:  nullableStr('expiration_date'),
  };
}

/** Create a new destination set — docs 107473 */
export async function addDestinationSet(
  username: string,
  password: string,
  opts: {
    name: string;
    currency: string;
    remoteManagementType?: number;
    remoteManagementKey?: string;
    localCalling?: boolean;
    localCallingCliValidationRule?: string;
    description?: string;
    postCallSurcharge?: number;
    notifyOnImportError?: boolean;
    connectFee?: number;
    freeSeconds?: number;
    gracePeriod?: number;
    cldTranslationRule?: string;
    cliTranslationRule?: string;
    portalUrl?: string;
  },
): Promise<{ success: boolean; iDestinationSet?: number; message: string }> {
  const base = opts.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number | boolean | null> = { name: opts.name, currency: opts.currency };
  if (opts.remoteManagementType !== undefined)        params.remote_management_type = opts.remoteManagementType;
  if (opts.remoteManagementKey  !== undefined)        params.remote_management_key  = opts.remoteManagementKey;
  if (opts.localCalling         !== undefined)        params.local_calling          = opts.localCalling;
  if (opts.localCallingCliValidationRule !== undefined) params.local_calling_cli_validation_rule = opts.localCallingCliValidationRule;
  if (opts.description          !== undefined)        params.description            = opts.description;
  if (opts.postCallSurcharge    !== undefined)        params.post_call_surcharge    = opts.postCallSurcharge;
  if (opts.notifyOnImportError  !== undefined)        params.notify_on_import_error = opts.notifyOnImportError;
  if (opts.connectFee           !== undefined)        params.connect_fee            = opts.connectFee;
  if (opts.freeSeconds          !== undefined)        params.free_seconds           = opts.freeSeconds;
  if (opts.gracePeriod          !== undefined)        params.grace_period           = opts.gracePeriod;
  if (opts.cldTranslationRule   !== undefined)        params.cld_translation_rule   = opts.cldTranslationRule;
  if (opts.cliTranslationRule   !== undefined)        params.cli_translation_rule   = opts.cliTranslationRule;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('addDestinationSet', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const m = extractStructMembers(text);
      if ((m['result'] ?? '').trim() === 'OK') {
        const id = m['i_destination_set'] ? parseInt(m['i_destination_set'], 10) : undefined;
        return { success: true, iDestinationSet: id, message: 'Destination set created.' };
      }
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'addDestinationSet failed.';
    return { success: false, message: fault };
  } catch (e: any) { return { success: false, message: e.message }; }
}

/** Update an existing destination set — docs 107473, Sippy 2024+ */
export async function updateDestinationSet(
  username: string,
  password: string,
  iDestinationSet: number,
  opts: {
    name?: string;
    remoteManagementType?: number;
    remoteManagementKey?: string;
    localCalling?: boolean;
    localCallingCliValidationRule?: string;
    freeSeconds?: number;
    gracePeriod?: number;
    postCallSurcharge?: number;
    connectFee?: number;
    notifyOnImportError?: boolean;
    cldTranslationRule?: string;
    cliTranslationRule?: string;
    portalUrl?: string;
  },
): Promise<{ success: boolean; iDestinationSet?: number; message: string }> {
  const base = opts.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number | boolean | null> = { i_destination_set: iDestinationSet };
  if (opts.name                          !== undefined) params.name                            = opts.name;
  if (opts.remoteManagementType          !== undefined) params.remote_management_type          = opts.remoteManagementType;
  if (opts.remoteManagementKey           !== undefined) params.remote_management_key           = opts.remoteManagementKey;
  if (opts.localCalling                  !== undefined) params.local_calling                   = opts.localCalling;
  if (opts.localCallingCliValidationRule !== undefined) params.local_calling_cli_validation_rule = opts.localCallingCliValidationRule;
  if (opts.freeSeconds                   !== undefined) params.free_seconds                    = opts.freeSeconds;
  if (opts.gracePeriod                   !== undefined) params.grace_period                    = opts.gracePeriod;
  if (opts.postCallSurcharge             !== undefined) params.post_call_surcharge             = opts.postCallSurcharge;
  if (opts.connectFee                    !== undefined) params.connect_fee                     = opts.connectFee;
  if (opts.notifyOnImportError           !== undefined) params.notify_on_import_error          = opts.notifyOnImportError;
  if (opts.cldTranslationRule            !== undefined) params.cld_translation_rule            = opts.cldTranslationRule;
  if (opts.cliTranslationRule            !== undefined) params.cli_translation_rule            = opts.cliTranslationRule;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('updateDestinationSet', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const m = extractStructMembers(text);
      if ((m['result'] ?? '').trim() === 'OK') {
        const id = m['i_destination_set'] ? parseInt(m['i_destination_set'], 10) : iDestinationSet;
        return { success: true, iDestinationSet: id, message: 'Destination set updated.' };
      }
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'updateDestinationSet failed.';
    return { success: false, message: fault };
  } catch (e: any) { return { success: false, message: e.message }; }
}

/** Get details of a destination set — docs 107473, Sippy 2024+ */
export async function getDestinationSetInfo(
  username: string,
  password: string,
  opts: { iDestinationSet?: number; name?: string; includeAllFields?: boolean; portalUrl?: string },
): Promise<{ success: boolean; destinationSet?: SippyDestinationSet; message: string }> {
  const base = opts.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number | boolean | null> = {};
  if (opts.iDestinationSet  !== undefined) params.i_destination_set  = opts.iDestinationSet;
  if (opts.name             !== undefined) params.name               = opts.name;
  if (opts.includeAllFields !== undefined) params.include_all_fields = opts.includeAllFields;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('getDestinationSetInfo', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const dsMatch = /<name>destination_set<\/name>\s*<value>\s*<struct>([\s\S]*?)<\/struct>/i.exec(text);
      const m = dsMatch ? extractStructMembers(dsMatch[1]) : extractStructMembers(text);
      return { success: true, destinationSet: parseDestinationSet(m), message: 'OK' };
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'getDestinationSetInfo failed.';
    return { success: false, message: fault };
  } catch (e: any) { return { success: false, message: e.message }; }
}

/** List destination sets — docs 107473 */
export async function listDestinationSets(
  username: string,
  password: string,
  opts: { namePattern?: string; iDestinationSet?: number; offset?: number; limit?: number; portalUrl?: string } = {},
): Promise<{ success: boolean; list: SippyDestinationSet[]; message: string }> {
  const base = opts.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, list: [], message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number | boolean | null> = {};
  if (opts.namePattern     !== undefined) params.name_pattern     = opts.namePattern;
  if (opts.iDestinationSet !== undefined) params.i_destination_set = opts.iDestinationSet;
  if (opts.offset          !== undefined) params.offset           = opts.offset;
  if (opts.limit           !== undefined) params.limit            = opts.limit;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('listDestinationSets', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const structRe = /<struct>([\s\S]*?)<\/struct>/g;
      const list: SippyDestinationSet[] = [];
      let sm;
      while ((sm = structRe.exec(text)) !== null) {
        const m = extractStructMembers(sm[1]);
        if (m['i_destination_set']) list.push(parseDestinationSet(m));
      }
      return { success: true, list, message: 'OK' };
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'listDestinationSets failed.';
    return { success: false, list: [], message: fault };
  } catch (e: any) { return { success: false, list: [], message: e.message }; }
}

/** Delete a destination set — docs 107473, Sippy 2024+ */
export async function deleteDestinationSet(
  username: string,
  password: string,
  iDestinationSet: number,
  opts?: { portalUrl?: string },
): Promise<{ success: boolean; message: string }> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('deleteDestinationSet', { i_destination_set: iDestinationSet }), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) return { success: true, message: 'Destination set deleted.' };
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'deleteDestinationSet failed.';
    return { success: false, message: fault };
  } catch (e: any) { return { success: false, message: e.message }; }
}

/** List routes in a destination set — docs 107473, Sippy 2024+ */
export async function getDestinationSetRoutesList(
  username: string,
  password: string,
  iDestinationSet: number,
  opts?: { portalUrl?: string },
): Promise<{ success: boolean; list: SippyDestinationSetRoute[]; message: string }> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, list: [], message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('getDestinationSetRoutesList', { i_destination_set: iDestinationSet }), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const structRe = /<struct>([\s\S]*?)<\/struct>/g;
      const list: SippyDestinationSetRoute[] = [];
      let sm;
      while ((sm = structRe.exec(text)) !== null) {
        const m = extractStructMembers(sm[1]);
        if (m['prefix'] !== undefined) list.push(parseDestinationSetRoute(m));
      }
      return { success: true, list, message: 'OK' };
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'getDestinationSetRoutesList failed.';
    return { success: false, list: [], message: fault };
  } catch (e: any) { return { success: false, list: [], message: e.message }; }
}

/** Add a route to a destination set — docs 107473 */
export async function addRouteToDestinationSet(
  username: string,
  password: string,
  iDestinationSet: number,
  prefix: string,
  opts: {
    preference?: number;
    huntstop?: number;
    timeout?: number;
    price1?: number;
    priceN?: number;
    interval1?: number;
    intervalN?: number;
    timeout1xx?: number;
    forbidden?: boolean;
    activationDate?: string;
    expirationDate?: string;
    portalUrl?: string;
  } = {},
): Promise<{ success: boolean; message: string }> {
  const base = opts.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number | boolean | null> = { i_destination_set: iDestinationSet, prefix };
  if (opts.preference      !== undefined) params.preference    = opts.preference;
  if (opts.huntstop        !== undefined) params.huntstop      = opts.huntstop;
  if (opts.timeout         !== undefined) params.timeout       = opts.timeout;
  if (opts.price1          !== undefined) params.price_1       = opts.price1;
  if (opts.priceN          !== undefined) params.price_n       = opts.priceN;
  if (opts.interval1       !== undefined) params.interval_1    = opts.interval1;
  if (opts.intervalN       !== undefined) params.interval_n    = opts.intervalN;
  if (opts.timeout1xx      !== undefined) params.timeout_1xx   = opts.timeout1xx;
  if (opts.forbidden       !== undefined) params.forbidden     = opts.forbidden;
  if (opts.activationDate  !== undefined) params.activation_date  = toSippyIso8601(opts.activationDate);
  if (opts.expirationDate  !== undefined) params.expiration_date  = toSippyIso8601(opts.expirationDate);

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('addRouteToDestinationSet', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) return { success: true, message: 'Route added to destination set.' };
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'addRouteToDestinationSet failed.';
    return { success: false, message: fault };
  } catch (e: any) { return { success: false, message: e.message }; }
}

/** Update a route in a destination set — docs 107473 */
export async function updateRouteInDestinationSet(
  username: string,
  password: string,
  iDestinationSet: number,
  prefix: string,
  opts: {
    newPrefix?: string;
    preference?: number;
    huntstop?: number;
    timeout?: number;
    price1?: number;
    priceN?: number;
    interval1?: number;
    intervalN?: number;
    timeout1xx?: number;
    forbidden?: boolean;
    portalUrl?: string;
  } = {},
): Promise<{ success: boolean; message: string }> {
  const base = opts.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number | boolean | null> = { i_destination_set: iDestinationSet, prefix };
  if (opts.newPrefix   !== undefined) params.new_prefix   = opts.newPrefix;
  if (opts.preference  !== undefined) params.preference   = opts.preference;
  if (opts.huntstop    !== undefined) params.huntstop     = opts.huntstop;
  if (opts.timeout     !== undefined) params.timeout      = opts.timeout;
  if (opts.price1      !== undefined) params.price_1      = opts.price1;
  if (opts.priceN      !== undefined) params.price_n      = opts.priceN;
  if (opts.interval1   !== undefined) params.interval_1   = opts.interval1;
  if (opts.intervalN   !== undefined) params.interval_n   = opts.intervalN;
  if (opts.timeout1xx  !== undefined) params.timeout_1xx  = opts.timeout1xx;
  if (opts.forbidden   !== undefined) params.forbidden    = opts.forbidden;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('updateRouteInDestinationSet', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) return { success: true, message: 'Route updated.' };
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'updateRouteInDestinationSet failed.';
    return { success: false, message: fault };
  } catch (e: any) { return { success: false, message: e.message }; }
}

/** Remove a route from a destination set — docs 107473 */
export async function delRouteFromDestinationSet(
  username: string,
  password: string,
  iDestinationSet: number,
  prefix: string,
  opts?: { portalUrl?: string },
): Promise<{ success: boolean; message: string }> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('delRouteFromDestinationSet', { i_destination_set: iDestinationSet, prefix }), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) return { success: true, message: 'Route removed from destination set.' };
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'delRouteFromDestinationSet failed.';
    return { success: false, message: fault };
  } catch (e: any) { return { success: false, message: e.message }; }
}

/** Remove all routes from a destination set — docs 107473, Sippy 2024+ */
export async function deleteAllRoutesInDestinationSet(
  username: string,
  password: string,
  iDestinationSet: number,
  opts?: { portalUrl?: string },
): Promise<{ success: boolean; message: string }> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('deleteAllRoutesInDestinationSet', { i_destination_set: iDestinationSet }), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) return { success: true, message: 'All routes deleted from destination set.' };
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'deleteAllRoutesInDestinationSet failed.';
    return { success: false, message: fault };
  } catch (e: any) { return { success: false, message: e.message }; }
}

// ── Miscellaneous APIs ────────────────────────────────────────────────────────

/**
 * Send an email via Sippy's built-in mail relay.
 * Official method: sendEMail() — docs 107472
 *
 * All six parameters are required by Sippy. Pass empty string for cc/bcc if unused.
 */
export async function sendSippyEmail(
  username: string,
  password: string,
  opts: {
    from: string;
    to: string;
    cc?: string;
    bcc?: string;
    subject: string;
    body: string;
    portalUrl?: string;
  },
): Promise<{ success: boolean; message: string }> {
  const base = opts.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string> = {
    from:    opts.from,
    to:      opts.to,
    cc:      opts.cc  ?? '',
    bcc:     opts.bcc ?? '',
    subject: opts.subject,
    body:    opts.body,
  };

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('sendEMail', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const m = extractStructMembers(text);
      if ((m['result'] ?? extractTag(text, 'string') ?? '').trim() === 'OK') {
        return { success: true, message: 'Email sent.' };
      }
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'sendEMail failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Validate a password against a named password policy.
 * Official method: validatePassword() — docs 107475
 * Supports trusted mode (pass iCustomer). Fault message is localized per lang.
 */
export async function validatePassword(
  username: string,
  password: string,
  opts: {
    iPasswordPolicy: number;
    password: string;
    webLabel: string;
    lang?: string;
    iCustomer?: number;
    portalUrl?: string;
  },
): Promise<{ success: boolean; message: string }> {
  const base = opts.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number | null> = {
    i_password_policy: opts.iPasswordPolicy,
    password:          opts.password,
    web_label:         opts.webLabel,
  };
  if (opts.lang       !== undefined) params.lang       = opts.lang;
  if (opts.iCustomer  !== undefined) params.i_customer = opts.iCustomer;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('validatePassword', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const m = extractStructMembers(text);
      if ((m['result'] ?? extractTag(text, 'string') ?? '').trim() === 'OK') {
        return { success: true, message: 'Password is valid.' };
      }
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'validatePassword failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export interface SippyServicePlanInfo {
  iBillingPlan:    number;
  iTariff:         number | null;
  iCustomer:       number | null;
  name:            string;
  description:     string | null;
  suspendAllCalls: boolean | null;
  billingCycle:    number | null;  // 1=weekly 2=bi-weekly 3=monthly
  iso4217:         string | null;
  prepaid:         boolean | null;
}

/**
 * Retrieve all attributes of a given service plan.
 * Official method: getServicePlanInfo() — docs 107487
 * Supports trusted mode (pass iCustomer). Service plan must belong to the
 * authenticated customer unless trusted mode is used.
 */
export async function getServicePlanInfo(
  username: string,
  password: string,
  iBillingPlan: number,
  opts?: { iCustomer?: number; portalUrl?: string },
): Promise<{ success: boolean; servicePlan?: SippyServicePlanInfo; message: string }> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number | null> = { i_billing_plan: iBillingPlan };
  if (opts?.iCustomer !== undefined) params.i_customer = opts.iCustomer;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('getServicePlanInfo', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const m = extractStructMembers(text);
      const nullableInt  = (k: string) => (!m[k] || m[k] === 'nil' || m[k] === 'None') ? null : parseInt(m[k], 10);
      const nullableBool = (k: string) => (!m[k] || m[k] === 'nil' || m[k] === 'None') ? null : (m[k] === '1' || m[k].toLowerCase() === 'true');
      const nullableStr  = (k: string) => (!m[k] || m[k] === 'nil' || m[k] === 'None') ? null : m[k];
      const plan: SippyServicePlanInfo = {
        iBillingPlan:    parseInt(m['i_billing_plan'] || String(iBillingPlan), 10),
        iTariff:         nullableInt('i_tariff'),
        iCustomer:       nullableInt('i_customer'),
        name:            m['name'] ?? '',
        description:     nullableStr('description'),
        suspendAllCalls: nullableBool('suspend_all_calls'),
        billingCycle:    nullableInt('billing_cycle'),
        iso4217:         nullableStr('iso_4217'),
        prepaid:         nullableBool('prepaid'),
      };
      return { success: true, servicePlan: plan, message: 'OK' };
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'getServicePlanInfo failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Apply a number translation rule to a given number and return the result.
 * Useful for testing CLD/CLI translation rules on accounts, connections, DIDs, account classes.
 * Official method: applyTranslationRule() — docs 107499
 * No trusted mode.
 */
export async function applyTranslationRule(
  username: string,
  password: string,
  rule: string,
  number: string = '',
  opts?: { portalUrl?: string },
): Promise<{ success: boolean; number?: string; message: string }> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('applyTranslationRule', { rule, number }), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const m = extractStructMembers(text);
      if ((m['result'] ?? '').trim() === 'OK') {
        return { success: true, number: m['number'] ?? '', message: 'OK' };
      }
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'applyTranslationRule failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Check if a number matches a regular-expression rule.
 * Useful for validating CLI validation rules on Tariffs and Destination Sets.
 * Official method: checkMatchRule() — docs 107500
 * No trusted mode.
 */
export async function checkMatchRule(
  username: string,
  password: string,
  rule: string,
  number: string = '',
  opts?: { portalUrl?: string },
): Promise<{ success: boolean; match?: boolean; message: string }> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('checkMatchRule', { rule, number }), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const m = extractStructMembers(text);
      if ((m['result'] ?? '').trim() === 'OK') {
        const match = m['match'] === '1' || m['match']?.toLowerCase() === 'true';
        return { success: true, match, message: 'OK' };
      }
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'checkMatchRule failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

// ─── DID Pool Management (docs 107502) ──────────────────────────────────────

export interface SippyDID {
  iDid:                    number;
  did:                     string;
  didRangeEnd:             string | null;
  iDidAllocatedFrom:       number | null;
  incomingDid:             string | null;
  translationRule:         string | null;
  cldTranslationRule:      string | null;
  cliTranslationRule:      string | null;
  description:             string | null;
  iIvrApplication:         number | null;
  iAccount:                number | null;
  iDidsChargingGroup:      number | null;
  iVendor:                 number | null;
  iConnection:             number | null;
  buyingIDidsChargingGroup: number | null;
  iDidDelegation:          number | null;
  delegatedTo:             number | null;
  parentIDidDelegation:    number | null;
  incomingCli:             string | null;
}

export interface SippyDIDChargingGroup {
  iDidsChargingGroup: number;
  iCustomer:          number | null;
  name:               string;
  description:        string | null;
  connectFee:         number | null;
  freeSeconds:        number | null;
  gracePeriod:        number | null;
  price1:             number | null;
  priceN:             number | null;
  interval1:          number | null;
  intervalN:          number | null;
  iso4217:            string | null;
  price:              number | null;
  setupFee:           number | null;
  postCallSurcharge:  number | null;
  type:               number | null;  // 1=selling 2=buying
}

function parseDIDStruct(m: Record<string, string>): SippyDID {
  const ni = (k: string) => (!m[k] || m[k] === 'nil' || m[k] === 'None') ? null : parseInt(m[k], 10);
  const ns = (k: string) => (!m[k] || m[k] === 'nil' || m[k] === 'None') ? null : m[k];
  return {
    iDid:                    parseInt(m['i_did'] || '0', 10),
    did:                     m['did'] ?? '',
    didRangeEnd:             ns('did_range_end'),
    iDidAllocatedFrom:       ni('i_did_allocated_from'),
    incomingDid:             ns('incoming_did'),
    translationRule:         ns('translation_rule'),
    cldTranslationRule:      ns('cld_translation_rule'),
    cliTranslationRule:      ns('cli_translation_rule'),
    description:             ns('description'),
    iIvrApplication:         ni('i_ivr_application'),
    iAccount:                ni('i_account'),
    iDidsChargingGroup:      ni('i_dids_charging_group'),
    iVendor:                 ni('i_vendor'),
    iConnection:             ni('i_connection'),
    buyingIDidsChargingGroup: ni('buying_i_dids_charging_group'),
    iDidDelegation:          ni('i_did_delegation'),
    delegatedTo:             ni('delegated_to'),
    parentIDidDelegation:    ni('parent_i_did_delegation'),
    incomingCli:             ns('incoming_cli'),
  };
}

/**
 * Add a DID to the pool.
 * Official method: addDID() — docs 107502
 */
export async function addDID(
  username: string,
  password: string,
  did: string,
  incomingDid: string,
  opts?: {
    didRangeEnd?: string;
    iDidAllocatedFrom?: number | null;
    translationRule?: string;
    cliTranslationRule?: string;
    description?: string;
    iIvrApplication?: number;
    iAccount?: number;
    iDidsChargingGroup?: number;
    iVendor?: number;
    iConnection?: number;
    buyingIDidsChargingGroup?: number;
    incomingCli?: string;
    portalUrl?: string;
  },
): Promise<{ success: boolean; iDid?: number; message: string }> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number | null> = { did, incoming_did: incomingDid };
  if (opts?.didRangeEnd             !== undefined) params.did_range_end                = opts.didRangeEnd;
  if (opts?.iDidAllocatedFrom       !== undefined) params.i_did_allocated_from         = opts.iDidAllocatedFrom;
  if (opts?.translationRule         !== undefined) params.translation_rule             = opts.translationRule;
  if (opts?.cliTranslationRule      !== undefined) params.cli_translation_rule         = opts.cliTranslationRule;
  if (opts?.description             !== undefined) params.description                  = opts.description;
  if (opts?.iIvrApplication         !== undefined) params.i_ivr_application            = opts.iIvrApplication;
  if (opts?.iAccount                !== undefined) params.i_account                    = opts.iAccount;
  if (opts?.iDidsChargingGroup      !== undefined) params.i_dids_charging_group        = opts.iDidsChargingGroup;
  if (opts?.iVendor                 !== undefined) params.i_vendor                     = opts.iVendor;
  if (opts?.iConnection             !== undefined) params.i_connection                 = opts.iConnection;
  if (opts?.buyingIDidsChargingGroup !== undefined) params.buying_i_dids_charging_group = opts.buyingIDidsChargingGroup;
  if (opts?.incomingCli             !== undefined) params.incoming_cli                 = opts.incomingCli;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('addDID', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const m = extractStructMembers(text);
      if ((m['result'] ?? '').trim() === 'OK') {
        return { success: true, iDid: parseInt(m['i_did'] || '0', 10), message: 'OK' };
      }
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'addDID failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Update an existing DID. Either iDid or did must be specified.
 * Official method: updateDID() — docs 107502
 */
export async function updateDID(
  username: string,
  password: string,
  opts: {
    iDid?: number;
    did?: string;
    didRangeEnd?: string;
    incomingDid?: string;
    translationRule?: string;
    cliTranslationRule?: string;
    description?: string;
    iIvrApplication?: number | null;
    iAccount?: number | null;
    iDidsChargingGroup?: number;
    iVendor?: number;
    iConnection?: number;
    buyingIDidsChargingGroup?: number;
    incomingCli?: string;
    portalUrl?: string;
  },
): Promise<{ success: boolean; iDid?: number; message: string }> {
  const base = opts.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  if (!opts.iDid && !opts.did) return { success: false, message: 'Either iDid or did must be specified.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number | null> = {};
  if (opts.iDid                     !== undefined) params.i_did                        = opts.iDid;
  if (opts.did                      !== undefined) params.did                          = opts.did;
  if (opts.didRangeEnd              !== undefined) params.did_range_end                = opts.didRangeEnd;
  if (opts.incomingDid              !== undefined) params.incoming_did                 = opts.incomingDid;
  if (opts.translationRule          !== undefined) params.translation_rule             = opts.translationRule;
  if (opts.cliTranslationRule       !== undefined) params.cli_translation_rule         = opts.cliTranslationRule;
  if (opts.description              !== undefined) params.description                  = opts.description;
  if (opts.iIvrApplication          !== undefined) params.i_ivr_application            = opts.iIvrApplication;
  if (opts.iAccount                 !== undefined) params.i_account                    = opts.iAccount;
  if (opts.iDidsChargingGroup       !== undefined) params.i_dids_charging_group        = opts.iDidsChargingGroup;
  if (opts.iVendor                  !== undefined) params.i_vendor                     = opts.iVendor;
  if (opts.iConnection              !== undefined) params.i_connection                 = opts.iConnection;
  if (opts.buyingIDidsChargingGroup !== undefined) params.buying_i_dids_charging_group = opts.buyingIDidsChargingGroup;
  if (opts.incomingCli              !== undefined) params.incoming_cli                 = opts.incomingCli;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('updateDID', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const m = extractStructMembers(text);
      if ((m['result'] ?? '').trim() === 'OK') {
        return { success: true, iDid: parseInt(m['i_did'] || '0', 10), message: 'OK' };
      }
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'updateDID failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Delete a DID from the pool. Either iDid or did must be specified.
 * Official method: deleteDID() — docs 107502
 */
export async function deleteDID(
  username: string,
  password: string,
  opts: { iDid?: number; did?: string; didRangeEnd?: string; portalUrl?: string },
): Promise<{ success: boolean; message: string }> {
  const base = opts.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  if (!opts.iDid && !opts.did) return { success: false, message: 'Either iDid or did must be specified.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number> = {};
  if (opts.iDid        !== undefined) params.i_did         = opts.iDid;
  if (opts.did         !== undefined) params.did           = opts.did;
  if (opts.didRangeEnd !== undefined) params.did_range_end = opts.didRangeEnd;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('deleteDID', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const m = extractStructMembers(text);
      if ((m['result'] ?? '').trim() === 'OK') return { success: true, message: 'OK' };
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'deleteDID failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Get all attributes of a given DID. Either iDid or did must be specified.
 * Official method: getDIDInfo() — docs 107502
 */
export async function getDIDInfo(
  username: string,
  password: string,
  opts: { iDid?: number; did?: string; didRangeEnd?: string; portalUrl?: string },
): Promise<{ success: boolean; did?: SippyDID; message: string }> {
  const base = opts.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  if (!opts.iDid && !opts.did) return { success: false, message: 'Either iDid or did must be specified.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number> = {};
  if (opts.iDid        !== undefined) params.i_did         = opts.iDid;
  if (opts.did         !== undefined) params.did           = opts.did;
  if (opts.didRangeEnd !== undefined) params.did_range_end = opts.didRangeEnd;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('getDIDInfo', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const m = extractStructMembers(text);
      if ((m['result'] ?? '').trim() === 'OK') {
        return { success: true, did: parseDIDStruct(m), message: 'OK' };
      }
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'getDIDInfo failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * List DIDs with optional filters.
 * Official method: getDIDsList() — docs 107502
 */
export async function getDIDsList(
  username: string,
  password: string,
  filters?: {
    did?: string;
    incomingDid?: string;
    delegatedTo?: number;
    iAccount?: number;
    iIvrApplication?: number;
    notAssigned?: boolean;
    offset?: number;
    limit?: number;
    portalUrl?: string;
  },
): Promise<{ success: boolean; dids: SippyDID[]; message: string }> {
  const base = filters?.portalUrl ? sippyBase(filters.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, dids: [], message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number | boolean> = {};
  if (filters?.did            !== undefined) params.did             = filters.did;
  if (filters?.incomingDid    !== undefined) params.incoming_did    = filters.incomingDid;
  if (filters?.delegatedTo    !== undefined) params.delegated_to    = filters.delegatedTo;
  if (filters?.iAccount       !== undefined) params.i_account       = filters.iAccount;
  if (filters?.iIvrApplication !== undefined) params.i_ivr_application = filters.iIvrApplication;
  if (filters?.notAssigned    !== undefined) params.not_assigned    = filters.notAssigned ? 1 : 0;
  if (filters?.offset         !== undefined) params.offset          = filters.offset;
  if (filters?.limit          !== undefined) params.limit           = filters.limit;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('getDIDsList', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const dids = parseArrayOfStructs(text).map(parseDIDStruct);
      return { success: true, dids, message: 'OK' };
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'getDIDsList failed.';
    return { success: false, dids: [], message: fault };
  } catch (e: any) {
    return { success: false, dids: [], message: e.message };
  }
}

/**
 * Get all attributes of a DID Charging Group.
 * Official method: getDIDChargingGroupInfo() — docs 107502
 */
export async function getDIDChargingGroupInfo(
  username: string,
  password: string,
  iDidsChargingGroup: number,
  opts?: { portalUrl?: string },
): Promise<{ success: boolean; group?: SippyDIDChargingGroup; message: string }> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('getDIDChargingGroupInfo', { i_dids_charging_group: iDidsChargingGroup }), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const m = extractStructMembers(text);
      if ((m['result'] ?? '').trim() === 'OK') {
        const nf = (k: string) => (!m[k] || m[k] === 'nil' || m[k] === 'None') ? null : parseFloat(m[k]);
        const ni = (k: string) => (!m[k] || m[k] === 'nil' || m[k] === 'None') ? null : parseInt(m[k], 10);
        const ns = (k: string) => (!m[k] || m[k] === 'nil' || m[k] === 'None') ? null : m[k];
        const group: SippyDIDChargingGroup = {
          iDidsChargingGroup: parseInt(m['i_dids_charging_group'] || String(iDidsChargingGroup), 10),
          iCustomer:          ni('i_customer'),
          name:               m['name'] ?? '',
          description:        ns('description'),
          connectFee:         nf('connect_fee'),
          freeSeconds:        ni('free_seconds'),
          gracePeriod:        ni('grace_period'),
          price1:             nf('price_1'),
          priceN:             nf('price_n'),
          interval1:          ni('interval_1'),
          intervalN:          ni('interval_n'),
          iso4217:            ns('iso_4217'),
          price:              nf('price'),
          setupFee:           nf('setup_fee'),
          postCallSurcharge:  nf('post_call_surcharge'),
          type:               ni('type'),
        };
        return { success: true, group, message: 'OK' };
      }
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'getDIDChargingGroupInfo failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Delegate a DID to a subcustomer.
 * Official method: addDIDDelegation() — docs 107502
 */
export async function addDIDDelegation(
  username: string,
  password: string,
  opts: {
    iDid: number;
    delegatedTo: number;
    parentIDidDelegation: number | null;
    iDidsChargingGroup?: number;
    description?: string;
    portalUrl?: string;
  },
): Promise<{ success: boolean; iDidDelegation?: number; message: string }> {
  const base = opts.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number | null> = {
    i_did:                  opts.iDid,
    delegated_to:           opts.delegatedTo,
    parent_i_did_delegation: opts.parentIDidDelegation,
  };
  if (opts.iDidsChargingGroup !== undefined) params.i_dids_charging_group = opts.iDidsChargingGroup;
  if (opts.description        !== undefined) params.description           = opts.description;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('addDIDDelegation', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const m = extractStructMembers(text);
      if ((m['result'] ?? '').trim() === 'OK') {
        return { success: true, iDidDelegation: parseInt(m['i_did_delegation'] || '0', 10), message: 'OK' };
      }
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'addDIDDelegation failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Update a DID delegation entry.
 * Official method: updateDIDDelegation() — docs 107502
 */
export async function updateDIDDelegation(
  username: string,
  password: string,
  iDidDelegation: number,
  opts?: { iDidsChargingGroup?: number; delegatedTo?: number; description?: string; portalUrl?: string },
): Promise<{ success: boolean; iDidDelegation?: number; message: string }> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number> = { i_did_delegation: iDidDelegation };
  if (opts?.iDidsChargingGroup !== undefined) params.i_dids_charging_group = opts.iDidsChargingGroup;
  if (opts?.delegatedTo        !== undefined) params.delegated_to          = opts.delegatedTo;
  if (opts?.description        !== undefined) params.description           = opts.description;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('updateDIDDelegation', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const m = extractStructMembers(text);
      if ((m['result'] ?? '').trim() === 'OK') {
        return { success: true, iDidDelegation: parseInt(m['i_did_delegation'] || String(iDidDelegation), 10), message: 'OK' };
      }
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'updateDIDDelegation failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Delete a DID delegation entry.
 * Official method: deleteDIDDelegation() — docs 107502
 */
export async function deleteDIDDelegation(
  username: string,
  password: string,
  iDidDelegation: number,
  opts?: { portalUrl?: string },
): Promise<{ success: boolean; message: string }> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('deleteDIDDelegation', { i_did_delegation: iDidDelegation }), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const m = extractStructMembers(text);
      if ((m['result'] ?? '').trim() === 'OK') return { success: true, message: 'OK' };
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'deleteDIDDelegation failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

// ─── Conferencing Management (docs 107507) ───────────────────────────────────

/**
 * Add a conference on a given account.
 * Requires conference to be enabled on the Account Class and Customer Permissions.
 * Official method: addConference() — docs 107507
 * Supports trusted mode (pass iCustomer).
 * Dates use '%H:%M:%S.000 GMT %a %b %d %Y' format (toSippyDate).
 */
export async function addConference(
  username: string,
  password: string,
  opts: {
    iAccount:    number;
    startTime:   Date | string;
    subject?:    string;
    expire?:     Date | string;
    confnoLen?:  number;
    iCustomer?:  number;
    portalUrl?:  string;
  },
): Promise<{ success: boolean; iConference?: number; confno?: string; message: string }> {
  const base = opts.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number> = {
    i_account:  opts.iAccount,
    start_time: toSippyDate(opts.startTime),
  };
  if (opts.subject   !== undefined) params.subject     = opts.subject;
  if (opts.expire    !== undefined) params.expire       = toSippyDate(opts.expire);
  if (opts.confnoLen !== undefined) params.confno_len   = opts.confnoLen;
  if (opts.iCustomer !== undefined) params.i_customer   = opts.iCustomer;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('addConference', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const m = extractStructMembers(text);
      if ((m['result'] ?? '').trim() === 'OK') {
        return {
          success:     true,
          iConference: parseInt(m['i_conference'] || '0', 10),
          confno:      m['confno'] ?? '',
          message:     'OK',
        };
      }
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'addConference failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Delete an existing conference.
 * Official method: deleteConference() — docs 107507
 * Supports trusted mode (pass iCustomer).
 */
export async function deleteConference(
  username: string,
  password: string,
  iAccount: number,
  iConference: number,
  opts?: { iCustomer?: number; portalUrl?: string },
): Promise<{ success: boolean; message: string }> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, number> = { i_account: iAccount, i_conference: iConference };
  if (opts?.iCustomer !== undefined) (params as any).i_customer = opts.iCustomer;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('deleteConference', params), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const m = extractStructMembers(text);
      if ((m['result'] ?? '').trim() === 'OK') return { success: true, message: 'OK' };
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'deleteConference failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

// ─── Packet Sniffer Scheduler (docs 107508) — root-only ──────────────────────

/**
 * Schedule a packet dump (tcpdump) for given hosts.
 * Root customer user only. No trusted mode.
 * Official method: dumpIPTraffic() — docs 107508
 * target_hosts is an XML-RPC array — built manually since xmlRpcCall is flat-only.
 */
export async function dumpIPTraffic(
  username: string,
  password: string,
  opts: {
    email:        string;
    targetHosts:  string[];
    period:       number;   // 1–60 minutes
    iface:        string;   // e.g. 'em0' or 'em0:1.2.3.4'
    portalUrl?:   string;
  },
): Promise<{ success: boolean; iIpTrafficDump?: number; message: string }> {
  const base = opts.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const hostsXml = opts.targetHosts
    .map(h => `<value><string>${h}</string></value>`)
    .join('');

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<methodCall>
  <methodName>dumpIPTraffic</methodName>
  <params>
    <param>
      <value>
        <struct>
          <member><name>email</name><value><string>${opts.email}</string></value></member>
          <member><name>target_hosts</name><value><array><data>${hostsXml}</data></array></value></member>
          <member><name>period</name><value><int>${opts.period}</int></value></member>
          <member><name>interface</name><value><string>${opts.iface}</string></value></member>
        </struct>
      </value>
    </param>
  </params>
</methodCall>`;

  try {
    const resp = await sippyPost(apiUrl, body, username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const m = extractStructMembers(text);
      if ((m['result'] ?? '').trim() === 'OK') {
        return { success: true, iIpTrafficDump: parseInt(m['i_ip_traffic_dump'] || '0', 10), message: 'OK' };
      }
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'dumpIPTraffic failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Get the status of a packet dump task.
 * Root customer user only. No trusted mode.
 * Official method: dumpIPTrafficStatus() — docs 107508
 */
export async function dumpIPTrafficStatus(
  username: string,
  password: string,
  iIpTrafficDump: number,
  opts?: { portalUrl?: string },
): Promise<{ success: boolean; status?: string; url?: string; message: string }> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('dumpIPTrafficStatus', { i_ip_traffic_dump: iIpTrafficDump }), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const m = extractStructMembers(text);
      if ((m['result'] ?? '').trim() === 'OK') {
        return {
          success: true,
          status:  m['status'] ?? '',
          url:     m['url'] && m['url'] !== 'nil' && m['url'] !== 'None' ? m['url'] : undefined,
          message: 'OK',
        };
      }
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'dumpIPTrafficStatus failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

// ─── Audit Logs (docs 3000038971) — root-only ─────────────────────────────────

export interface SippyAuditRecord {
  [key: string]: string;
}

/**
 * Retrieve audit log records within a date range.
 * Root customer only. Supports trusted mode.
 * Official method: getAuditLogs() — docs 3000038971
 * Dates use '%H:%M:%S.000 GMT %a %b %d %Y' format (toSippyDate). Default window: last hour.
 */
export async function getAuditLogs(
  username: string,
  password: string,
  opts?: {
    startDate?: Date | string;
    endDate?:   Date | string;
    limit?:     number;   // max 100
    offset?:    number;
    portalUrl?: string;
  },
): Promise<{ success: boolean; records: SippyAuditRecord[]; message: string }> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, records: [], message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number> = {};
  if (opts?.startDate !== undefined) params.start_date = toSippyDate(opts.startDate);
  if (opts?.endDate   !== undefined) params.end_date   = toSippyDate(opts.endDate);
  if (opts?.limit     !== undefined) params.limit       = Math.min(opts.limit, 100);
  if (opts?.offset    !== undefined) params.offset      = opts.offset;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('getAuditLogs', params as any), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const records = parseArrayOfStructs(text) as SippyAuditRecord[];
      return { success: true, records, message: 'OK' };
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'getAuditLogs failed.';
    return { success: false, records: [], message: fault };
  } catch (e: any) {
    return { success: false, records: [], message: e.message };
  }
}

/**
 * Write a custom audit log entry.
 * Root customer only. Supports trusted mode.
 * Official method: writeAuditLog() — docs 3000038971
 * audit_info is an optional struct of arbitrary key-value pairs.
 */
export async function writeAuditLog(
  username: string,
  password: string,
  action: string,
  resource: string,
  opts?: {
    auditInfo?: Record<string, string | number | boolean | null>;
    portalUrl?: string;
  },
): Promise<{ success: boolean; message: string }> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  // Build audit_info struct XML member if provided
  const auditInfoMember = opts?.auditInfo
    ? `<member><name>audit_info</name><value><struct>${buildStructMembers(opts.auditInfo)}</struct></value></member>`
    : '';

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<methodCall>
  <methodName>writeAuditLog</methodName>
  <params>
    <param>
      <value>
        <struct>
          <member><name>action</name><value><string>${action}</string></value></member>
          <member><name>resource</name><value><string>${resource}</string></value></member>
          ${auditInfoMember}
        </struct>
      </value>
    </param>
  </params>
</methodCall>`;

  try {
    const resp = await sippyPost(apiUrl, body, username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const m = extractStructMembers(text);
      if ((m['result'] ?? extractTag(text, 'string') ?? '').trim() === 'OK') {
        return { success: true, message: 'OK' };
      }
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'writeAuditLog failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

// ─── Invoice Related Methods (docs 3000080953) — since V5.2, trusted mode ─────

/**
 * Generate a preview PDF for an invoice template using sample data.
 * Trusted mode supported. Requires valid i_invoice_template ID.
 * Official method: generateInvoicePreview() — docs 3000080953 (since V5.2)
 */
export async function generateInvoicePreview(
  username: string,
  password: string,
  iInvoiceTemplate: number,
  opts?: { portalUrl?: string },
): Promise<{ success: boolean; pdf?: string; message: string }> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('generateInvoicePreview', { i_invoice_template: iInvoiceTemplate }), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      // pdf is a base64-encoded string — may be very large, use a targeted regex
      const pdf = /<name>pdf<\/name>\s*<value>\s*(?:<string>)?([\s\S]*?)(?:<\/string>)?\s*<\/value>/.exec(text)?.[1]?.trim() ?? undefined;
      return { success: true, pdf, message: 'OK' };
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'generateInvoicePreview failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Validate an arbitrary invoice template (HTML) and optionally return a sample PDF.
 * Trusted mode supported.
 * Official method: validateInvoiceTemplate() — docs 3000080953 (since V5.2)
 */
export async function validateInvoiceTemplate(
  username: string,
  password: string,
  template: string,  // base64-encoded HTML template
  opts?: {
    templateCss?:       string;  // base64-encoded CSS
    converterOptions?:  string;
    returnPdf?:         boolean;
    portalUrl?:         string;
  },
): Promise<{ success: boolean; pdf?: string; message: string }> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | boolean> = { template };
  if (opts?.templateCss      !== undefined) params.template_css      = opts.templateCss;
  if (opts?.converterOptions !== undefined) params.converter_options = opts.converterOptions;
  if (opts?.returnPdf        !== undefined) params.return_pdf        = opts.returnPdf;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('validateInvoiceTemplate', params as any), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const pdf = /<name>pdf<\/name>\s*<value>\s*(?:<string>)?([\s\S]*?)(?:<\/string>)?\s*<\/value>/.exec(text)?.[1]?.trim() ?? undefined;
      return { success: true, ...(pdf ? { pdf } : {}), message: 'OK' };
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'validateInvoiceTemplate failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Generate an invoice PDF for an account for a given billing period.
 * Trusted mode supported.
 * Official method: generateInvoice() — docs 3000080953 (since V5.2)
 * Dates must be UTC (toSippyDate / toSippyIso8601).
 */
export async function generateInvoice(
  username: string,
  password: string,
  iAccount: number,
  periodBegin: Date | string,
  periodEnd: Date | string,
  opts?: {
    iBillingPlan?: number;
    portalUrl?:    string;
  },
): Promise<{ success: boolean; pdf?: string; message: string }> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number> = {
    i_account:    iAccount,
    period_begin: toSippyDate(periodBegin),
    period_end:   toSippyDate(periodEnd),
  };
  if (opts?.iBillingPlan !== undefined) params.i_billing_plan = opts.iBillingPlan;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('generateInvoice', params as any), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const pdf = /<name>pdf<\/name>\s*<value>\s*(?:<string>)?([\s\S]*?)(?:<\/string>)?\s*<\/value>/.exec(text)?.[1]?.trim() ?? undefined;
      return { success: true, pdf, message: 'OK' };
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'generateInvoice failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

// ─── Test Dialplan (docs 3000054197) — System Management permission ───────────

export interface SippyDialplanRoute {
  cli:                        string  | null;
  cld:                        string  | null;
  prefix:                     string  | null;
  iDestinationSet:            number  | null;
  destinationSetName:         string  | null;
  iRoute:                     number  | null;
  iMediaRelay:                number  | null;
  mediaRelayIsSystem:         boolean | null;
  iVendor:                    number  | null;
  vendorName:                 string  | null;
  iConnection:                number  | null;
  connectionName:             string  | null;
  capacity:                   number  | null;
  numSessions:                number  | null;
  preference:                 number  | null;
  qualityMonitorEnabled:      boolean | null;
  qualityMonitorAction:       string  | null;
  connectionQuality:          string  | null;
  failedQualityMonitor:       boolean | null;
  connectionDestinationStatus:string  | null;
  qmonAction:                 string  | null;
  estimatedCost:              string  | null;
  stirShakenMode:             string  | null;
  systemConnection:           boolean | null;
  freeSeconds:                number  | null;
  interval1:                  number  | null;
  intervalN:                  number  | null;
  connectFee:                 string  | null;
  price1:                     string  | null;
  priceN:                     string  | null;
  gracePeriod:                number  | null;
  postCallSurcharge:          string  | null;
  areaName:                   string  | null;
  forbidden:                  boolean | null;
  huntstop:                   boolean | null;
  timeout100:                 number  | null;
  timeout1xx:                 number  | null;
  timeout200:                 number  | null;
  onnetRouteType:             number  | null;
  error:                      string  | null;
  errorCause:                 string  | null;
}

export interface SippyDialplanResult {
  result:               string  | null;
  cause:                string  | null;
  // Origination / account
  iDid:                 number  | null;
  iDidAuthorization:    number  | null;
  iIvrApplication:      number  | null;
  iAuthentication:      number  | null;
  iAccount:             number  | null;
  iCustomer:            number  | null;
  // Tariff / billing
  iTariff:              number  | null;
  tariffName:           string  | null;
  iRate:                number  | null;
  prefix:               string  | null;
  cli:                  string  | null;
  cld:                  string  | null;
  username:             string  | null;
  averageDuration:      number  | null;
  freeSeconds:          number  | null;
  interval1:            number  | null;
  intervalN:            number  | null;
  connectFee:           string  | null;
  price1:               string  | null;
  priceN:               string  | null;
  gracePeriod:          number  | null;
  postCallSurcharge:    string  | null;
  estimatedCostOrig:    string  | null;
  // Routing
  iRoutingGroup:        number  | null;
  routingGroupName:     string  | null;
  stirShakenEnabled:    boolean | null;
  // LRN
  lrnCldIn:             string  | null;
  lrnCld:               string  | null;
  lrnCliIn:             string  | null;
  lrnCli:               string  | null;
  areaName:             string  | null;
  // Ambiguous auth (since 2021)
  ambiguousAuth:        string[] | null;
  // Routes / onnet
  routes:               SippyDialplanRoute[] | null;
  onnetAccount:         Record<string, unknown> | null;
}

/** Parse one route struct into a SippyDialplanRoute. */
function parseDialplanRoute(m: Record<string, string>): SippyDialplanRoute {
  const ni = (k: string) => { const v = m[k]; return (!v || v === 'nil' || v === 'None') ? null : parseInt(v, 10) || null; };
  const ns = (k: string) => (!m[k] || m[k] === 'nil' || m[k] === 'None') ? null : m[k];
  const nb = (k: string) => (!m[k] || m[k] === 'nil' || m[k] === 'None') ? null : (m[k] === '1' || m[k].toLowerCase() === 'true');
  const nf = (k: string) => { const v = m[k]; return (!v || v === 'nil' || v === 'None') ? null : v; };
  return {
    cli:                         ns('cli'),
    cld:                         ns('cld'),
    prefix:                      ns('prefix'),
    iDestinationSet:             ni('i_destination_set'),
    destinationSetName:          ns('destination_set_name'),
    iRoute:                      ni('i_route'),
    iMediaRelay:                 ni('i_media_relay'),
    mediaRelayIsSystem:          nb('media_relay_is_system'),
    iVendor:                     ni('i_vendor'),
    vendorName:                  ns('vendor_name'),
    iConnection:                 ni('i_connection'),
    connectionName:              ns('connection_name'),
    capacity:                    ni('capacity'),
    numSessions:                 ni('num_sessions'),
    preference:                  ni('preference'),
    qualityMonitorEnabled:       nb('quality_monitor_enabled'),
    qualityMonitorAction:        ns('quality_monitor_action'),
    connectionQuality:           ns('connection_quality'),
    failedQualityMonitor:        nb('failed_quality_monitor'),
    connectionDestinationStatus: ns('connection_destination_status'),
    qmonAction:                  ns('qmon_action'),
    estimatedCost:               nf('estimated_cost'),
    stirShakenMode:              ns('stir_shaken_mode'),
    systemConnection:            nb('system_connection'),
    freeSeconds:                 ni('free_seconds'),
    interval1:                   ni('interval_1'),
    intervalN:                   ni('interval_N'),
    connectFee:                  nf('connect_fee'),
    price1:                      nf('price_1'),
    priceN:                      nf('price_N'),
    gracePeriod:                 ni('grace_period'),
    postCallSurcharge:           nf('post_call_surcharge'),
    areaName:                    ns('area_name'),
    forbidden:                   nb('forbidden'),
    huntstop:                    nb('huntstop'),
    timeout100:                  ni('timeout_100'),
    timeout1xx:                  ni('timeout_1xx'),
    timeout200:                  ni('timeout_200'),
    onnetRouteType:              ni('onnet_route_type'),
    error:                       ns('error'),
    errorCause:                  ns('error_cause'),
  };
}

/**
 * Test dialplan routing for a given CLI/CLD pair.
 * Requires System Management permission. Supports trusted mode.
 * Official method: testDialplan() — docs 3000054197
 */
export async function testDialplan(
  username: string,
  password: string,
  cli: string,
  cld: string,
  opts?: {
    fallbackIAccount?: number;
    remoteUdpPort?:    number;
    remoteIp?:         string;
    toDomain?:         string;
    fromDomain?:       string;
    isIvrOriginated?:  boolean;
    iProtocol?:        number;
    nated?:            boolean;
    callStartTime?:    Date | string;
    paiHdr?:           string;
    rpidHdr?:          string;
    portalUrl?:        string;
  },
): Promise<{ success: boolean; data?: SippyDialplanResult; message: string }> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number | boolean | null> = { cli, cld };
  if (opts?.fallbackIAccount !== undefined) params.fallback_i_account = opts.fallbackIAccount;
  if (opts?.remoteUdpPort   !== undefined) params.remote_udp_port    = opts.remoteUdpPort;
  if (opts?.remoteIp        !== undefined) params.remote_ip          = opts.remoteIp;
  if (opts?.toDomain        !== undefined) params.to_domain          = opts.toDomain;
  if (opts?.fromDomain      !== undefined) params.from_domain        = opts.fromDomain;
  if (opts?.isIvrOriginated !== undefined) params.is_ivr_originated  = opts.isIvrOriginated;
  if (opts?.iProtocol       !== undefined) params.i_protocol         = opts.iProtocol;
  if (opts?.nated           !== undefined) params.nated              = opts.nated;
  if (opts?.callStartTime   !== undefined) params.call_start_time    = toSippyDate(opts.callStartTime);
  if (opts?.paiHdr          !== undefined) params.pai_hdr            = opts.paiHdr;
  if (opts?.rpidHdr         !== undefined) params.rpid_hdr           = opts.rpidHdr;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('testDialplan', params as any), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const m = extractStructMembers(text);
      const ni = (k: string) => { const v = m[k]; return (!v || v === 'nil' || v === 'None') ? null : parseInt(v, 10) || null; };
      const ns = (k: string) => (!m[k] || m[k] === 'nil' || m[k] === 'None') ? null : m[k];
      const nb = (k: string) => (!m[k] || m[k] === 'nil' || m[k] === 'None') ? null : (m[k] === '1' || m[k].toLowerCase() === 'true');
      const nf = (k: string) => { const v = m[k]; return (!v || v === 'nil' || v === 'None') ? null : v; };

      // Parse routes array — inside <name>routes</name><value><array>...</array></value>
      let routes: SippyDialplanRoute[] | null = null;
      const routesMatch = /<name>routes<\/name>\s*<value>([\s\S]*?)<\/value>\s*<\/member>/i.exec(text);
      if (routesMatch) {
        const rawRoutes = parseArrayOfStructs(routesMatch[1]);
        routes = rawRoutes.map((r: Record<string, string>) => parseDialplanRoute(r));
      }

      // Parse onnet_account struct (if present)
      let onnetAccount: Record<string, unknown> | null = null;
      const onnetMatch = /<name>onnet_account<\/name>\s*<value>\s*<struct>([\s\S]*?)<\/struct>\s*<\/value>/i.exec(text);
      if (onnetMatch) {
        onnetAccount = extractStructMembers(`<struct>${onnetMatch[1]}</struct>`);
      }

      // Parse ambiguous_auth array of strings
      let ambiguousAuth: string[] | null = null;
      const aaMatch = /<name>ambiguous_auth<\/name>\s*<value>([\s\S]*?)<\/value>\s*<\/member>/i.exec(text);
      if (aaMatch) {
        const valMatches = [...aaMatch[1].matchAll(/<string>([^<]*)<\/string>/g)];
        if (valMatches.length > 0) ambiguousAuth = valMatches.map(x => x[1]);
      }

      const data: SippyDialplanResult = {
        result:            ns('result'),
        cause:             ns('cause'),
        iDid:              ni('i_did'),
        iDidAuthorization: ni('i_did_authorization'),
        iIvrApplication:   ni('i_ivr_application'),
        iAuthentication:   ni('i_authentication'),
        iAccount:          ni('i_account'),
        iCustomer:         ni('i_customer'),
        iTariff:           ni('i_tariff'),
        tariffName:        ns('tariff_name'),
        iRate:             ni('i_rate'),
        prefix:            ns('prefix'),
        cli:               ns('cli'),
        cld:               ns('cld'),
        username:          ns('username'),
        averageDuration:   ni('average_duration'),
        freeSeconds:       ni('free_seconds'),
        interval1:         ni('interval_1'),
        intervalN:         ni('interval_N'),
        connectFee:        nf('connect_fee'),
        price1:            nf('price_1'),
        priceN:            nf('price_N'),
        gracePeriod:       ni('grace_period'),
        postCallSurcharge: nf('post_call_surcharge'),
        estimatedCostOrig: nf('estimated_cost_orig'),
        iRoutingGroup:     ni('i_routing_group'),
        routingGroupName:  ns('routing_group_name'),
        stirShakenEnabled: nb('stir_shaken_enabled'),
        lrnCldIn:          ns('lrn_cld_in'),
        lrnCld:            ns('lrn_cld'),
        lrnCliIn:          ns('lrn_cli_in'),
        lrnCli:            ns('lrn_cli'),
        areaName:          ns('area_name'),
        ambiguousAuth,
        routes,
        onnetAccount,
      };
      return { success: true, data, message: data.result ?? 'OK' };
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'testDialplan failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

// ─── Extended Routing (docs 3000126868) — since Sippy2023, trusted mode ───────

export interface ExtendedRoutingEntry {
  iExtendedRouting: number;
  iWholesaler:      number;
  iCustomer:        number;
  iRoutingGroup:    number;
  iTariff:          number | null;  // nil when customer's own tariff is used
  description:      string;
}

export interface ListExtendedRoutingResult {
  success:         boolean;
  extendedRouting: ExtendedRoutingEntry[];
  message:         string;
}

/**
 * Get the list of extended routing entries for a customer.
 * Trusted mode: supply i_wholesaler.
 * Official method: listExtendedRouting() — docs 3000126868 (since Sippy2023)
 */
export async function listExtendedRouting(
  username:   string,
  password:   string,
  iCustomer:  number,
  opts?: {
    offset?:     number;
    limit?:      number;
    portalUrl?:  string;
  },
): Promise<ListExtendedRoutingResult> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, extendedRouting: [], message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, number> = { i_customer: iCustomer };
  if (opts?.offset !== undefined) params.offset = opts.offset;
  if (opts?.limit  !== undefined) params.limit  = opts.limit;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('listExtendedRouting', params as any), username, password);
    const text = resp.body;

    if (resp.statusCode !== 200 || text.includes('<fault>')) {
      const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
        ?? extractTag(text, 'faultString') ?? 'listExtendedRouting failed.';
      return { success: false, extendedRouting: [], message: fault };
    }

    // Extract the extended_routing array of structs
    const arrMatch = /<name>extended_routing<\/name>\s*<value>\s*<array>\s*<data>([\s\S]*?)<\/data>\s*<\/array>\s*<\/value>/.exec(text);
    const extendedRouting: ExtendedRoutingEntry[] = [];

    if (arrMatch) {
      const structs = parseArrayOfStructs(arrMatch[1]);
      for (const s of structs) {
        extendedRouting.push({
          iExtendedRouting: parseInt(s.i_extended_routing ?? '0', 10),
          iWholesaler:      parseInt(s.i_wholesaler      ?? '0', 10),
          iCustomer:        parseInt(s.i_customer        ?? '0', 10),
          iRoutingGroup:    parseInt(s.i_routing_group   ?? '0', 10),
          iTariff:          s.i_tariff ? parseInt(s.i_tariff, 10) : null,
          description:      s.description ?? '',
        });
      }
    }

    return { success: true, extendedRouting, message: 'OK' };
  } catch (e: any) {
    return { success: false, extendedRouting: [], message: e.message };
  }
}

// ─── Routing Groups CRUD (docs 3000051220) ────────────────────────────────────

export interface SippyRoutingGroupDetail {
  iRoutingGroup:              number  | null;
  name:                       string  | null;
  policy:                     string  | null;
  description:                string  | null;
  iMediaRelay:                number  | null;
  disableOnnetRouting:        boolean | null;
  onnetIConnection:           number  | null;
  disableOnnetVoicemail:      boolean | null;
  onnetVoicemailIConnection:  number  | null;
  onnetScope:                 number  | null;
  lrnEnabled:                 boolean | null;
  lrnTranslationRule:         string  | null;
  timeout2xx:                 number  | null;
  onnetTimeout100:            number  | null;
  onnetTimeout1xx:            number  | null;
  onnetTimeout2xx:            number  | null;
  stirShakenEnabled:          boolean | null;
  safeToDelete:               boolean | null;
  membersCount:               number  | null;
}

export interface SippyRoutingGroupMember {
  iRoutingGroupMember:  number  | null;
  iRoutingGroup:        number  | null;
  iConnection:          number  | null;
  iVendor:              number  | null;
  iConnectionGroup:     number  | null;
  iDestinationSet:      number  | null;
  preference:           number  | null;
  activationDate:       string  | null;
  expirationDate:       string  | null;
  weight:               number  | null;
  stirShakenAsMode:     string  | null;
}

/** Parse a raw struct map into a SippyRoutingGroupDetail. */
function parseRoutingGroupDetail(m: Record<string, string>): SippyRoutingGroupDetail {
  const ni = (k: string) => { const v = m[k]; return (!v || v === 'nil' || v === 'None') ? null : parseInt(v, 10) || null; };
  const ns = (k: string) => (!m[k] || m[k] === 'nil' || m[k] === 'None') ? null : m[k];
  const nb = (k: string) => (!m[k] || m[k] === 'nil' || m[k] === 'None') ? null : (m[k] === '1' || m[k].toLowerCase() === 'true');
  return {
    iRoutingGroup:             ni('i_routing_group'),
    name:                      ns('name'),
    policy:                    ns('policy'),
    description:               ns('description'),
    iMediaRelay:               ni('i_media_relay'),
    disableOnnetRouting:       nb('disable_onnet_routing'),
    onnetIConnection:          ni('onnet_i_connection'),
    disableOnnetVoicemail:     nb('disable_onnet_voicemail'),
    onnetVoicemailIConnection: ni('onnet_voicemail_i_connection'),
    onnetScope:                ni('onnet_scope'),
    lrnEnabled:                nb('lrn_enabled'),
    lrnTranslationRule:        ns('lrn_translation_rule'),
    timeout2xx:                ni('timeout_2xx'),
    onnetTimeout100:           ni('onnet_timeout_100'),
    onnetTimeout1xx:           ni('onnet_timeout_1xx'),
    onnetTimeout2xx:           ni('onnet_timeout_2xx'),
    stirShakenEnabled:         nb('stir_shaken_enabled'),
    safeToDelete:              nb('safe_to_delete'),
    membersCount:              ni('members_count'),
  };
}

/** Parse a raw struct map into a SippyRoutingGroupMember. */
function parseRoutingGroupMember(m: Record<string, string>): SippyRoutingGroupMember {
  const ni = (k: string) => { const v = m[k]; return (!v || v === 'nil' || v === 'None') ? null : parseInt(v, 10) || null; };
  const ns = (k: string) => (!m[k] || m[k] === 'nil' || m[k] === 'None') ? null : m[k];
  return {
    iRoutingGroupMember: ni('i_routing_group_member'),
    iRoutingGroup:       ni('i_routing_group'),
    iConnection:         ni('i_connection'),
    iVendor:             ni('i_vendor'),
    iConnectionGroup:    ni('i_connection_group'),
    iDestinationSet:     ni('i_destination_set'),
    preference:          ni('preference'),
    activationDate:      ns('activation_date'),
    expirationDate:      ns('expiration_date'),
    weight:              ni('weight'),
    stirShakenAsMode:    ns('stir_shaken_as_mode'),
  };
}

/**
 * List routing groups with optional filters.
 * Official method: listRoutingGroups() — docs 3000051220
 * Filters name_pattern_not and include_members_count available since 2025.
 */
export async function listRoutingGroups(
  username: string,
  password: string,
  opts?: {
    namePattern?:         string;
    namePatternNot?:      string;
    iRoutingGroup?:       number;
    includeMembersCount?: boolean;
    portalUrl?:           string;
  },
): Promise<{ success: boolean; groups: SippyRoutingGroupDetail[]; message: string }> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, groups: [], message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number | boolean> = {};
  if (opts?.namePattern        !== undefined) params.name_pattern          = opts.namePattern;
  if (opts?.namePatternNot     !== undefined) params.name_pattern_not      = opts.namePatternNot;
  if (opts?.iRoutingGroup      !== undefined) params.i_routing_group        = opts.iRoutingGroup;
  if (opts?.includeMembersCount !== undefined) params.include_members_count = opts.includeMembersCount;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('listRoutingGroups', params as any), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      // Response: struct with a 'list' member that is an array of structs.
      const listBlock = /<name>list<\/name>\s*<value>([\s\S]*?)<\/value>\s*<\/member>/.exec(text)?.[1] ?? text;
      const rawStructs = parseArrayOfStructs(listBlock);
      const groups = rawStructs.map((r: Record<string, string>) => parseRoutingGroupDetail(r));
      return { success: true, groups, message: 'OK' };
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'listRoutingGroups failed.';
    return { success: false, groups: [], message: fault };
  } catch (e: any) {
    return { success: false, groups: [], message: e.message };
  }
}

/**
 * Create a new routing group.
 * Official method: addRoutingGroup() — docs 3000051220
 */
export async function addRoutingGroup(
  username: string,
  password: string,
  name: string,
  policy: string,
  opts?: {
    description?:               string;
    iMediaRelay?:               number | null;
    disableOnnetRouting?:       boolean;
    onnetIConnection?:          number | null;
    disableOnnetVoicemail?:     boolean;
    onnetVoicemailIConnection?: number | null;
    onnetScope?:                number;
    lrnEnabled?:                boolean;
    lrnTranslationRule?:        string;
    timeout2xx?:                number;
    onnetTimeout100?:           number;
    onnetTimeout1xx?:           number;
    onnetTimeout2xx?:           number;
    stirShakenEnabled?:         boolean;
    portalUrl?:                 string;
  },
): Promise<{ success: boolean; iRoutingGroup?: number; message: string }> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number | boolean | null> = { name, policy };
  if (opts?.description               !== undefined) params.description                 = opts.description;
  if (opts?.iMediaRelay               !== undefined) params.i_media_relay               = opts.iMediaRelay;
  if (opts?.disableOnnetRouting       !== undefined) params.disable_onnet_routing        = opts.disableOnnetRouting;
  if (opts?.onnetIConnection          !== undefined) params.onnet_i_connection           = opts.onnetIConnection;
  if (opts?.disableOnnetVoicemail     !== undefined) params.disable_onnet_voicemail      = opts.disableOnnetVoicemail;
  if (opts?.onnetVoicemailIConnection !== undefined) params.onnet_voicemail_i_connection = opts.onnetVoicemailIConnection;
  if (opts?.onnetScope                !== undefined) params.onnet_scope                  = opts.onnetScope;
  if (opts?.lrnEnabled                !== undefined) params.lrn_enabled                  = opts.lrnEnabled;
  if (opts?.lrnTranslationRule        !== undefined) params.lrn_translation_rule          = opts.lrnTranslationRule;
  if (opts?.timeout2xx                !== undefined) params.timeout_2xx                  = opts.timeout2xx;
  if (opts?.onnetTimeout100           !== undefined) params.onnet_timeout_100            = opts.onnetTimeout100;
  if (opts?.onnetTimeout1xx           !== undefined) params.onnet_timeout_1xx            = opts.onnetTimeout1xx;
  if (opts?.onnetTimeout2xx           !== undefined) params.onnet_timeout_2xx            = opts.onnetTimeout2xx;
  if (opts?.stirShakenEnabled         !== undefined) params.stir_shaken_enabled          = opts.stirShakenEnabled;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('addRoutingGroup', params as any), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const m = extractStructMembers(text);
      const iRoutingGroup = m.i_routing_group ? parseInt(m.i_routing_group, 10) : undefined;
      return { success: true, iRoutingGroup, message: 'OK' };
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'addRoutingGroup failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Update properties of an existing routing group.
 * Official method: updateRoutingGroup() — docs 3000051220
 */
export async function updateRoutingGroup(
  username: string,
  password: string,
  iRoutingGroup: number,
  opts?: {
    name?:                      string;
    policy?:                    string;
    description?:               string;
    iMediaRelay?:               number | null;
    disableOnnetRouting?:       boolean;
    onnetIConnection?:          number | null;
    disableOnnetVoicemail?:     boolean;
    onnetVoicemailIConnection?: number | null;
    onnetScope?:                number;
    lrnEnabled?:                boolean;
    lrnTranslationRule?:        string;
    timeout2xx?:                number;
    onnetTimeout100?:           number;
    onnetTimeout1xx?:           number;
    onnetTimeout2xx?:           number;
    stirShakenEnabled?:         boolean;
    portalUrl?:                 string;
  },
): Promise<{ success: boolean; message: string }> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number | boolean | null> = { i_routing_group: iRoutingGroup };
  if (opts?.name                      !== undefined) params.name                         = opts.name;
  if (opts?.policy                    !== undefined) params.policy                       = opts.policy;
  if (opts?.description               !== undefined) params.description                  = opts.description;
  if (opts?.iMediaRelay               !== undefined) params.i_media_relay                = opts.iMediaRelay;
  if (opts?.disableOnnetRouting       !== undefined) params.disable_onnet_routing         = opts.disableOnnetRouting;
  if (opts?.onnetIConnection          !== undefined) params.onnet_i_connection            = opts.onnetIConnection;
  if (opts?.disableOnnetVoicemail     !== undefined) params.disable_onnet_voicemail       = opts.disableOnnetVoicemail;
  if (opts?.onnetVoicemailIConnection !== undefined) params.onnet_voicemail_i_connection  = opts.onnetVoicemailIConnection;
  if (opts?.onnetScope                !== undefined) params.onnet_scope                   = opts.onnetScope;
  if (opts?.lrnEnabled                !== undefined) params.lrn_enabled                   = opts.lrnEnabled;
  if (opts?.lrnTranslationRule        !== undefined) params.lrn_translation_rule           = opts.lrnTranslationRule;
  if (opts?.timeout2xx                !== undefined) params.timeout_2xx                   = opts.timeout2xx;
  if (opts?.onnetTimeout100           !== undefined) params.onnet_timeout_100             = opts.onnetTimeout100;
  if (opts?.onnetTimeout1xx           !== undefined) params.onnet_timeout_1xx             = opts.onnetTimeout1xx;
  if (opts?.onnetTimeout2xx           !== undefined) params.onnet_timeout_2xx             = opts.onnetTimeout2xx;
  if (opts?.stirShakenEnabled         !== undefined) params.stir_shaken_enabled           = opts.stirShakenEnabled;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('updateRoutingGroup', params as any), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) return { success: true, message: 'OK' };
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'updateRoutingGroup failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Delete a routing group.
 * Official method: delRoutingGroup() — docs 3000051220
 */
export async function delRoutingGroup(
  username: string,
  password: string,
  iRoutingGroup: number,
  opts?: { portalUrl?: string },
): Promise<{ success: boolean; message: string }> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('delRoutingGroup', { i_routing_group: iRoutingGroup }), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) return { success: true, message: 'OK' };
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'delRoutingGroup failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * List members of a routing group.
 * Official method: listRoutingGroupMembers() — docs 3000051220
 * Returns 'list' in ≤2024 or 'routing_group_members' in ≥2025.
 */
export async function listRoutingGroupMembers(
  username: string,
  password: string,
  iRoutingGroup: number,
  opts?: { portalUrl?: string },
): Promise<{ success: boolean; members: SippyRoutingGroupMember[]; message: string }> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, members: [], message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('listRoutingGroupMembers', { i_routing_group: iRoutingGroup }), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      // Response: struct with 'list' (≤2024) or 'routing_group_members' (≥2025) — array of member structs.
      const memberBlock =
        /<name>routing_group_members<\/name>\s*<value>([\s\S]*?)<\/value>\s*<\/member>/.exec(text)?.[1]
        ?? /<name>list<\/name>\s*<value>([\s\S]*?)<\/value>\s*<\/member>/.exec(text)?.[1]
        ?? text;
      const rawStructs = parseArrayOfStructs(memberBlock);
      const members = rawStructs.map((r: Record<string, string>) => parseRoutingGroupMember(r));
      return { success: true, members, message: 'OK' };
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'listRoutingGroupMembers failed.';
    return { success: false, members: [], message: fault };
  } catch (e: any) {
    return { success: false, members: [], message: e.message };
  }
}

/**
 * Add a member entry to a routing group.
 * Official method: addRoutingGroupMember() — docs 3000051220
 * In ≤2024: i_connection is mandatory. In ≥2025: either i_connection or i_connection_group required.
 */
export async function addRoutingGroupMember(
  username: string,
  password: string,
  iRoutingGroup: number,
  iDestinationSet: number,
  preference: number,
  opts?: {
    iConnection?:       number;
    iConnectionGroup?:  number;
    activationDate?:    Date | string;
    expirationDate?:    Date | string | null;
    weight?:            number;
    stirShakenAsMode?:  string;
    portalUrl?:         string;
  },
): Promise<{ success: boolean; iRoutingGroupMember?: number; message: string }> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number | null> = {
    i_routing_group:   iRoutingGroup,
    i_destination_set: iDestinationSet,
    preference,
  };
  if (opts?.iConnection       !== undefined) params.i_connection        = opts.iConnection;
  if (opts?.iConnectionGroup  !== undefined) params.i_connection_group  = opts.iConnectionGroup;
  if (opts?.activationDate    !== undefined) params.activation_date     = toSippyDate(opts.activationDate);
  if (opts?.expirationDate    !== undefined) params.expiration_date     = opts.expirationDate === null ? null : toSippyDate(opts.expirationDate);
  if (opts?.weight            !== undefined) params.weight              = opts.weight;
  if (opts?.stirShakenAsMode  !== undefined) params.stir_shaken_as_mode = opts.stirShakenAsMode;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('addRoutingGroupMember', params as any), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const m = extractStructMembers(text);
      const iRoutingGroupMember = m.i_routing_group_member ? parseInt(m.i_routing_group_member, 10) : undefined;
      return { success: true, iRoutingGroupMember, message: 'OK' };
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'addRoutingGroupMember failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Update properties of a routing group member.
 * Official method: updateRoutingGroupMember() — docs 3000051220
 * In ≤2024: i_routing_group is required. Since 2025: optional.
 */
export async function updateRoutingGroupMember(
  username: string,
  password: string,
  iRoutingGroupMember: number,
  opts?: {
    iRoutingGroup?:     number;
    iConnection?:       number;
    iConnectionGroup?:  number;
    iDestinationSet?:   number;
    preference?:        number;
    activationDate?:    Date | string;
    expirationDate?:    Date | string | null;
    weight?:            number;
    stirShakenAsMode?:  string;
    portalUrl?:         string;
  },
): Promise<{ success: boolean; message: string }> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number | null> = { i_routing_group_member: iRoutingGroupMember };
  if (opts?.iRoutingGroup     !== undefined) params.i_routing_group      = opts.iRoutingGroup;
  if (opts?.iConnection       !== undefined) params.i_connection          = opts.iConnection;
  if (opts?.iConnectionGroup  !== undefined) params.i_connection_group    = opts.iConnectionGroup;
  if (opts?.iDestinationSet   !== undefined) params.i_destination_set     = opts.iDestinationSet;
  if (opts?.preference        !== undefined) params.preference             = opts.preference;
  if (opts?.activationDate    !== undefined) params.activation_date        = toSippyDate(opts.activationDate);
  if (opts?.expirationDate    !== undefined) params.expiration_date        = opts.expirationDate === null ? null : toSippyDate(opts.expirationDate);
  if (opts?.weight            !== undefined) params.weight                 = opts.weight;
  if (opts?.stirShakenAsMode  !== undefined) params.stir_shaken_as_mode   = opts.stirShakenAsMode;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('updateRoutingGroupMember', params as any), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) return { success: true, message: 'OK' };
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'updateRoutingGroupMember failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Delete a routing group member entry.
 * Official method: delRoutingGroupMember() — docs 3000051220
 * In ≤2024: i_routing_group is required. Since 2025: optional.
 */
export async function delRoutingGroupMember(
  username: string,
  password: string,
  iRoutingGroupMember: number,
  opts?: {
    iRoutingGroup?: number;
    portalUrl?:     string;
  },
): Promise<{ success: boolean; message: string }> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, number> = { i_routing_group_member: iRoutingGroupMember };
  if (opts?.iRoutingGroup !== undefined) params.i_routing_group = opts.iRoutingGroup;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('delRoutingGroupMember', params as any), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) return { success: true, message: 'OK' };
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'delRoutingGroupMember failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

// ─── System Config (docs 3000050243) — root-only, since V4.5 ─────────────────

export interface SippySystemConfigRecord {
  key:           string | null;
  currentValue:  string | null;
  defaultValue:  string | null;
}

/**
 * Retrieve system_config* table entries (optionally filtered by key).
 * Root customer only. Supports trusted mode.
 * Official method: getSystemConfig() — docs 3000050243 (since V4.5)
 * NOTE: Do NOT set sip/hep_tracing/* keys on OpenSIPs ≤ 3.1 — it will crash OpenSIPs.
 */
export async function getSystemConfig(
  username: string,
  password: string,
  opts?: { key?: string; portalUrl?: string },
): Promise<{ success: boolean; config: SippySystemConfigRecord[]; message: string }> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, config: [], message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string> = {};
  if (opts?.key) params.key = opts.key;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('getSystemConfig', params as any), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      // Response: struct with a 'config' member containing an array of structs.
      // Try to find the <config> array block first.
      const configBlock = /<name>config<\/name>\s*<value>([\s\S]*?)<\/value>\s*<\/member>/.exec(text)?.[1] ?? text;
      const rawStructs = parseArrayOfStructs(configBlock);
      const config: SippySystemConfigRecord[] = rawStructs.map((r: Record<string, string>) => ({
        key:          r.key           ?? null,
        currentValue: r.current_value ?? null,
        defaultValue: r.default_value ?? null,
      }));
      return { success: true, config, message: 'OK' };
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'getSystemConfig failed.';
    return { success: false, config: [], message: fault };
  } catch (e: any) {
    return { success: false, config: [], message: e.message };
  }
}

/**
 * Set a system config value (system_config* tables only, not system table).
 * Root customer only. Supports trusted mode.
 * Official method: setSystemConfig() — docs 3000050243 (since V4.5)
 * WARNING: Do NOT set sip/hep_tracing/* on OpenSIPs ≤ 3.1 — it crashes OpenSIPs on reload.
 */
export async function setSystemConfig(
  username: string,
  password: string,
  key: string,
  value: string,
  opts?: { portalUrl?: string },
): Promise<{ success: boolean; message: string }> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('setSystemConfig', { key, value }), username, password);
    const text = resp.body;
    // setSystemConfig returns nothing on success — just a non-fault 200 response.
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      return { success: true, message: 'OK' };
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'setSystemConfig failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

// ─── Replication Status (docs 3000040133) — root-only, since V4.4 ─────────────

export interface SippyReplicationStatus {
  replicationEnabled: boolean | null;
  master:             string  | null;
  slave:              string  | null;
  replicationOk:      boolean | null;
}

export interface SippyReplicationLag {
  stLagTime:           string | null;
  replicationTestLag:  string | null;
}

/**
 * Get the current replication status for a given environment.
 * Root only. Supports trusted mode (i_environment).
 * Official method: getReplicationStatus() — docs 3000040133 (since V4.4)
 */
export async function getReplicationStatus(
  username: string,
  password: string,
  opts?: { iEnvironment?: number; portalUrl?: string },
): Promise<{ success: boolean; status?: SippyReplicationStatus; message: string }> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, number> = {};
  if (opts?.iEnvironment !== undefined) params.i_environment = opts.iEnvironment;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('getReplicationStatus', params as any), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const m = extractStructMembers(text);
      const nb = (k: string) => (!m[k] || m[k] === 'nil' || m[k] === 'None') ? null : (m[k] === '1' || m[k].toLowerCase() === 'true');
      const ns = (k: string) => (!m[k] || m[k] === 'nil' || m[k] === 'None') ? null : m[k];
      const status: SippyReplicationStatus = {
        replicationEnabled: nb('replication_enabled'),
        master:             ns('master'),
        slave:              ns('slave'),
        replicationOk:      nb('replication_ok'),
      };
      return { success: true, status, message: 'OK' };
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'getReplicationStatus failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Get the current replication lag for a given environment.
 * Root only. Supports trusted mode (i_environment).
 * Official method: getReplicationLag() — docs 3000040133 (since V4.4)
 */
export async function getReplicationLag(
  username: string,
  password: string,
  opts?: { iEnvironment?: number; portalUrl?: string },
): Promise<{ success: boolean; lag?: SippyReplicationLag; message: string }> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, number> = {};
  if (opts?.iEnvironment !== undefined) params.i_environment = opts.iEnvironment;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('getReplicationLag', params as any), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const m = extractStructMembers(text);
      const ns = (k: string) => (!m[k] || m[k] === 'nil' || m[k] === 'None') ? null : m[k];
      const lag: SippyReplicationLag = {
        stLagTime:          ns('st_lag_time'),
        replicationTestLag: ns('replication_test_lag'),
      };
      return { success: true, lag, message: 'OK' };
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'getReplicationLag failed.';
    return { success: false, message: fault };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

// ─── Callback Calls (doc 107448) ─────────────────────────────────────────────

/**
 * Initiate a 2-way callback request.
 * Official method: make2WayCallback() — docs 107448
 * Supply authname, cldFirst, cldSecond (required); all others optional.
 * nextCall: UTC datetime string in ISO8601 format, e.g. "20240101T12:00:00"
 */
export async function make2WayCallback(
  username: string,
  password: string,
  opts: {
    authname:    string;
    cldFirst:    string;
    cldSecond:   string;
    cliFirst?:   string;
    cliSecond?:  string;
    creditTime?: number;
    nextCall?:   string;  // UTC ISO8601 e.g. "20240101T12:00:00"
  },
  portalUrl?: string,
): Promise<{ success: boolean; iCallbackRequest?: number; message: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number> = {
    authname:   opts.authname,
    cld_first:  opts.cldFirst,
    cld_second: opts.cldSecond,
  };
  if (opts.cliFirst   !== undefined) params.cli_first   = opts.cliFirst;
  if (opts.cliSecond  !== undefined) params.cli_second  = opts.cliSecond;
  if (opts.creditTime !== undefined) params.credit_time = opts.creditTime;
  if (opts.nextCall   !== undefined) params.next_call   = opts.nextCall;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('make2WayCallback', params as any), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const m = extractStructMembers(text);
      return {
        success:          true,
        iCallbackRequest: m['i_callback_request'] ? parseInt(m['i_callback_request'], 10) : undefined,
        message:          'Callback initiated.',
      };
    }
    return { success: false, message: extractTag(text, 'faultString') || 'make2WayCallback failed.' };
  } catch (e: any) { return { success: false, message: e.message }; }
}

/**
 * Initiate a callback to the Calling Card application.
 * Official method: callbackCallingCard() — docs 107448
 * langs is an optional array of language strings sent as XML-RPC <array>.
 * All Calling Card CLD option params are optional booleans/strings.
 */
export async function callbackCallingCard(
  username: string,
  password: string,
  opts: {
    authname:        string;
    cld:             string;
    cli?:            string;
    langs?:          string[];   // Array of language codes, sent as XML-RPC array
    creditTime?:     number;
    chpassext?:      string;
    cliregext?:      string;
    directhotdial?:  boolean;
    hotdialext?:     string;
    hotdialeditext?: string;
    keepcli?:        boolean;
    nodial?:         boolean;
    playbalance?:    boolean;
    playduration?:   boolean;
    noredial?:       boolean;
    topupext?:       string;
    trycliauth?:     boolean;
  },
  portalUrl?: string,
): Promise<{ success: boolean; iCallbackRequest?: number; message: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  // Build all scalar params
  const scalarParams: Record<string, string | number | boolean> = {
    authname: opts.authname,
    cld:      opts.cld,
  };
  if (opts.cli            !== undefined) scalarParams.cli            = opts.cli;
  if (opts.creditTime     !== undefined) scalarParams.credit_time    = opts.creditTime;
  if (opts.chpassext      !== undefined) scalarParams.chpassext      = opts.chpassext;
  if (opts.cliregext      !== undefined) scalarParams.cliregext      = opts.cliregext;
  if (opts.directhotdial  !== undefined) scalarParams.directhotdial  = opts.directhotdial;
  if (opts.hotdialext     !== undefined) scalarParams.hotdialext     = opts.hotdialext;
  if (opts.hotdialeditext !== undefined) scalarParams.hotdialeditext = opts.hotdialeditext;
  if (opts.keepcli        !== undefined) scalarParams.keepcli        = opts.keepcli;
  if (opts.nodial         !== undefined) scalarParams.nodial         = opts.nodial;
  if (opts.playbalance    !== undefined) scalarParams.playbalance    = opts.playbalance;
  if (opts.playduration   !== undefined) scalarParams.playduration   = opts.playduration;
  if (opts.noredial       !== undefined) scalarParams.noredial       = opts.noredial;
  if (opts.topupext       !== undefined) scalarParams.topupext       = opts.topupext;
  if (opts.trycliauth     !== undefined) scalarParams.trycliauth     = opts.trycliauth;

  // langs must be sent as an XML-RPC <array> — build it manually
  let langsMember = '';
  if (opts.langs && opts.langs.length > 0) {
    const items = opts.langs
      .map(l => `<value><string>${l.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</string></value>`)
      .join('');
    langsMember = `<member><name>langs</name><value><array><data>${items}</data></array></value></member>`;
  }

  const scalarMembers = buildStructMembers(scalarParams as any);
  const body = `<?xml version="1.0" encoding="UTF-8"?><methodCall><methodName>callbackCallingCard</methodName><params><param><value><struct>${scalarMembers}${langsMember}</struct></value></param></params></methodCall>`;

  try {
    const resp = await sippyPost(apiUrl, body, username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const m = extractStructMembers(text);
      return {
        success:          true,
        iCallbackRequest: m['i_callback_request'] ? parseInt(m['i_callback_request'], 10) : undefined,
        message:          'Calling Card callback initiated.',
      };
    }
    return { success: false, message: extractTag(text, 'faultString') || 'callbackCallingCard failed.' };
  } catch (e: any) { return { success: false, message: e.message }; }
}

/**
 * Cancel a callback request (and the call if it has already started).
 * Official method: cancelCallback() — docs 107448
 */
export async function cancelCallback(
  username:         string,
  password:         string,
  iCallbackRequest: number,
  portalUrl?:       string,
): Promise<{ success: boolean; message: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  try {
    const resp = await sippyPost(
      apiUrl,
      xmlRpcCall('cancelCallback', { i_callback_request: iCallbackRequest }),
      username, password,
    );
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      return { success: true, message: 'Callback cancel request sent.' };
    }
    return { success: false, message: extractTag(text, 'faultString') || 'cancelCallback failed.' };
  } catch (e: any) { return { success: false, message: e.message }; }
}

/**
 * Get status (and optional CDRs) for a callback request.
 * Official method: getCallbackStatus() — docs 107448
 * callResult / callStatus values documented at:
 * https://trac.sippysoft.com/trac/wiki/public/IVR/ANICallback#Statusandresultstrings
 */
export async function getCallbackStatus(
  username:         string,
  password:         string,
  iCallbackRequest: number,
  opts?: { fetchCdrs?: boolean },
  portalUrl?: string,
): Promise<{
  success:     boolean;
  callResult?: string;
  callStatus?: string;
  cdrs?:       Record<string, string>[];
  message:     string;
}> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, number | boolean> = { i_callback_request: iCallbackRequest };
  if (opts?.fetchCdrs !== undefined) params.fetch_cdrs = opts.fetchCdrs;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('getCallbackStatus', params as any), username, password);
    const text = resp.body;
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const m = extractStructMembers(text);

      // Extract cdrs array if present (each element is a struct)
      let cdrs: Record<string, string>[] = [];
      const cdrsMatch = text.match(/<name>cdrs<\/name>\s*<value>\s*<array>\s*<data>([\s\S]*?)<\/data>/i);
      if (cdrsMatch) {
        const structRe = /<struct>([\s\S]*?)<\/struct>/gi;
        let sm: RegExpExecArray | null;
        while ((sm = structRe.exec(cdrsMatch[1])) !== null) {
          cdrs.push(extractStructMembers(sm[1]));
        }
      }

      return {
        success:    true,
        callResult: m['call_result'] || undefined,
        callStatus: m['call_status'] || undefined,
        cdrs,
        message:    'OK',
      };
    }
    return { success: false, message: extractTag(text, 'faultString') || 'getCallbackStatus failed.' };
  } catch (e: any) { return { success: false, message: e.message }; }
}

// ─── system.multicall (docs 3000108533) — Sippy 4.4+ ─────────────────────────

export interface MulticallEntry {
  methodName: string;
  params: Record<string, string | number | boolean | null>;
}

export interface MulticallResult {
  index:       number;
  success:     boolean;
  result?:     Record<string, string>;   // parsed struct on success
  faultCode?:  number;
  faultString?: string;
}

/**
 * Build a system.multicall XML-RPC body.
 * Each call's params are sent as a single-element array containing a flat struct
 * — this matches the standard Sippy XML-RPC calling convention.
 */
function buildMulticallBody(calls: MulticallEntry[]): string {
  const callsXml = calls.map(({ methodName, params }) => {
    const members = buildStructMembers(params);
    return `<value><struct>\
<member><name>methodName</name><value><string>${methodName}</string></value></member>\
<member><name>params</name><value><array><data>\
<value><struct>${members}</struct></value>\
</data></array></value></member>\
</struct></value>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<methodCall>
  <methodName>system.multicall</methodName>
  <params>
    <param>
      <value>
        <array><data>${callsXml}</data></array>
      </value>
    </param>
  </params>
</methodCall>`;
}

/**
 * Parse a system.multicall response.
 * Each top-level <value> in the response array is either:
 *   – <array><data><value>RESULT</value></data></array>  (success)
 *   – <struct> with faultCode + faultString              (per-call fault)
 */
function parseMulticallResponse(text: string): MulticallResult[] {
  const results: MulticallResult[] = [];

  // Extract the outer array <data> block from the response
  const outerMatch = text.match(/<params>\s*<param>\s*<value>\s*<array>\s*<data>([\s\S]*?)<\/data>\s*<\/array>\s*<\/value>\s*<\/param>\s*<\/params>/);
  if (!outerMatch) return results;

  const outerData = outerMatch[1];

  let index = 0;

  // Walk balanced <value> blocks — careful with nesting
  // by finding all <value> children of the outer <data>
  const topValues: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < outerData.length; i++) {
    if (outerData.slice(i, i + 7) === '<value>') {
      if (depth === 0) start = i;
      depth++;
    } else if (outerData.slice(i, i + 8) === '</value>') {
      depth--;
      if (depth === 0 && start !== -1) {
        topValues.push(outerData.slice(start + 7, i));
        start = -1;
      }
    }
  }

  for (const inner of topValues) {
    // Success: wrapped in another <array><data><value>...</value></data></array>
    const successMatch = inner.match(/^\s*<array>\s*<data>\s*<value>([\s\S]*?)<\/value>\s*<\/data>\s*<\/array>\s*$/);
    if (successMatch) {
      const resultInner = successMatch[1];
      const parsed = extractStructMembers(resultInner);
      results.push({ index, success: true, result: parsed });
    } else {
      // Fault: <struct> with faultCode + faultString
      const parsed = extractStructMembers(inner);
      const fc = parsed['faultCode'] ? parseInt(parsed['faultCode'], 10) : undefined;
      const fs = parsed['faultString'] ?? 'Unknown fault';
      results.push({ index, success: false, faultCode: fc, faultString: fs });
    }
    index++;
  }

  return results;
}

/**
 * Execute multiple Sippy XML-RPC calls in a single system.multicall request.
 * Requires Sippy 4.4+. Returns one result entry per input call, in order.
 * Official method: system.multicall — docs 3000108533
 */
export async function sippyMulticall(
  username: string,
  password: string,
  calls: MulticallEntry[],
  opts?: { portalUrl?: string },
): Promise<{ success: boolean; results: MulticallResult[]; message: string }> {
  const base = opts?.portalUrl ? sippyBase(opts.portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, results: [], message: 'Not connected to Sippy.' };
  if (calls.length === 0) return { success: true, results: [], message: 'No calls to execute.' };

  const apiUrl = `${base}/xmlapi/xmlapi`;
  try {
    const body = buildMulticallBody(calls);
    const resp = await sippyPost(apiUrl, body, username, password);
    const text = resp.body;

    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const results = parseMulticallResponse(text);
      const failed = results.filter(r => !r.success).length;
      return {
        success: failed === 0,
        results,
        message: failed === 0
          ? `All ${results.length} calls succeeded.`
          : `${results.length - failed}/${results.length} calls succeeded; ${failed} faulted.`,
      };
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractTag(text, 'faultString') ?? 'system.multicall failed.';
    return { success: false, results: [], message: fault };
  } catch (e: any) {
    return { success: false, results: [], message: e.message };
  }
}

/**
 * Bulk-add DIDs via system.multicall (3× faster than serial addDID calls).
 * Official method: addDID() via system.multicall — docs 3000108533 + 107502
 */
export async function bulkAddDIDs(
  username: string,
  password: string,
  dids: Array<{
    did: string;
    incomingDid: string;
    didRangeEnd?: string;
    translationRule?: string;
    cliTranslationRule?: string;
    description?: string;
    iIvrApplication?: number;
    iAccount?: number;
    iDidsChargingGroup?: number;
    iVendor?: number;
    iConnection?: number;
    buyingIDidsChargingGroup?: number;
    incomingCli?: string;
  }>,
  opts?: { portalUrl?: string },
): Promise<{ success: boolean; results: MulticallResult[]; message: string }> {
  const calls: MulticallEntry[] = dids.map(d => {
    const params: Record<string, string | number | null> = {
      did:          d.did,
      incoming_did: d.incomingDid,
    };
    if (d.didRangeEnd             !== undefined) params.did_range_end                = d.didRangeEnd;
    if (d.translationRule         !== undefined) params.translation_rule             = d.translationRule;
    if (d.cliTranslationRule      !== undefined) params.cli_translation_rule         = d.cliTranslationRule;
    if (d.description             !== undefined) params.description                  = d.description;
    if (d.iIvrApplication         !== undefined) params.i_ivr_application            = d.iIvrApplication;
    if (d.iAccount                !== undefined) params.i_account                    = d.iAccount;
    if (d.iDidsChargingGroup      !== undefined) params.i_dids_charging_group        = d.iDidsChargingGroup;
    if (d.iVendor                 !== undefined) params.i_vendor                     = d.iVendor;
    if (d.iConnection             !== undefined) params.i_connection                 = d.iConnection;
    if (d.buyingIDidsChargingGroup !== undefined) params.buying_i_dids_charging_group = d.buyingIDidsChargingGroup;
    if (d.incomingCli             !== undefined) params.incoming_cli                 = d.incomingCli;
    return { methodName: 'addDID', params };
  });
  return sippyMulticall(username, password, calls, opts);
}

/**
 * Bulk-delete DIDs via system.multicall.
 * Official method: deleteDID() via system.multicall — docs 3000108533 + 107502
 */
export async function bulkDeleteDIDs(
  username: string,
  password: string,
  iDids: number[],
  opts?: { portalUrl?: string },
): Promise<{ success: boolean; results: MulticallResult[]; message: string }> {
  const calls: MulticallEntry[] = iDids.map(id => ({
    methodName: 'deleteDID',
    params: { i_did: id },
  }));
  return sippyMulticall(username, password, calls, opts);
}
