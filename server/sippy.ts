/**
 * Sippy Softswitch Integration
 *
 * Dual-mode integration:
 * 1. XML-RPC API at /xmlapi/xmlapi with HTTP Basic Auth (for admin/API accounts)
 * 2. Web portal session scraping (for customer/reseller web accounts like RTST1)
 *
 * The web portal mode authenticates via POST /main.php then scrapes HTML pages
 * using session cookies. This works when XML-RPC credentials are unavailable.
 */

import http from 'node:http';
import https from 'node:https';
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

function buildStructMembers(params: Record<string, string | number | boolean>): string {
  return Object.entries(params)
    .map(([k, v]) => {
      let valTag: string;
      if (typeof v === 'boolean') valTag = `<boolean>${v ? 1 : 0}</boolean>`;
      else if (typeof v === 'number') valTag = `<int>${v}</int>`;
      else valTag = `<string>${String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</string>`;
      return `<member><name>${k}</name><value>${valTag}</value></member>`;
    })
    .join('');
}

// Flat struct: <struct><member>...</member></struct>
function xmlRpcCall(method: string, params: Record<string, string | number | boolean> = {}): string {
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
function xmlRpcCallNested(method: string, wrapKey: string, params: Record<string, string | number | boolean>): string {
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
  const memberRe = /<member>\s*<name>([^<]+)<\/name>\s*<value>([^<]*(?:<[^/][^>]*>[^<]*<\/[^>]+>)?[^<]*)<\/value>\s*<\/member>/gi;
  let m;
  while ((m = memberRe.exec(structXml)) !== null) {
    const key = m[1].trim();
    const rawVal = m[2].trim();
    const stripped = rawVal.replace(/<[^>]+>/g, '').trim();
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
  const auth = { Authorization: basicAuth(username, password) };
  const start = Date.now();

  // Try standard XML-RPC path first
  const apiUrl = `${base}/xmlapi/xmlapi`;
  const body = xmlRpcCall('i_version.listAvailableMethods');
  let xmlRpcReachable = false;

  try {
    const resp = await rawPost(apiUrl, body, auth);
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
  callId: string;
  caller: string;       // CLI (calling number)
  callee: string;       // CLD (destination number)
  duration: number;     // seconds
  codec: string;
  status: string;
  user?: string;        // account/customer name
  accountId?: string;   // i_account numeric ID
  vendor?: string;
  connection?: string;
  direction?: string;
  mediaIpCaller?: string;
  mediaIpCallee?: string;
  delay?: number;
}

export async function getSippyActiveCalls(username: string, password: string, explicitPortalUrl?: string): Promise<SippyActiveCall[]> {
  const base = explicitPortalUrl ? sippyBase(explicitPortalUrl) : activeSession?.portalUrl;
  if (!base) return [];

  // ── Portal session mode (web scraping fallback) ───────────────────────────
  const session = activeSession;
  if (session?.mode === 'portal' && session.cookies) {
    return getPortalActiveCallsHtml(session.cookies, base);
  }

  // ── XML-RPC mode ──────────────────────────────────────────────────────────
  const apiUrl = `${base}/xmlapi/xmlapi`;
  const body = xmlRpcCall('call_control.listActiveCalls');

  try {
    const resp = await rawPost(apiUrl, body, {
      Authorization: basicAuth(username, password),
    });
    if (resp.statusCode !== 200) {
      // Try portal scraping as last resort even without stored session
      const loginRes = await portalLogin(base, username, password, 'customer');
      if (loginRes.success) return getPortalActiveCallsHtml(loginRes.cookies, base);
      return [];
    }

    // Parse array of structs from XML
    const structs = extractAllTags(resp.body, 'struct');
    const calls: SippyActiveCall[] = [];

    for (const s of structs) {
      const m = extractStructMembers(s);
      if (!m['call-id'] && !m['call_id'] && !m['CallID']) continue;
      calls.push({
        callId: m['call-id'] || m['call_id'] || m['CallID'] || '-',
        caller: m['cli'] || m['from'] || m['caller'] || '-',
        callee: m['cld'] || m['to'] || m['callee'] || '-',
        duration: parseInt(m['duration'] || m['time'] || '0') || 0,
        codec: m['codec'] || m['media_type'] || '-',
        status: m['status'] || 'active',
        user: m['username'] || m['user'] || m['account_name'] || m['i_customer_name'] || m['customer_name'] || undefined,
        accountId: m['i_account'] || m['account_id'] || undefined,
        vendor: m['vendor_name'] || m['i_vendor_name'] || m['vendor'] || undefined,
        connection: m['i_connection_name'] || m['connection_name'] || m['connection'] || m['node_name'] || undefined,
        direction: m['direction'] || m['call_direction'] || undefined,
        mediaIpCaller: m['r_srtp'] || m['media_ip_caller'] || m['local_rtp_ip'] || undefined,
        mediaIpCallee: m['media_ip_callee'] || m['remote_rtp_ip'] || m['p_srtp'] || undefined,
        delay: m['delay'] != null ? (parseFloat(m['delay']) || 0) : undefined,
      });
    }
    return calls;
  } catch {
    return [];
  }
}

// ── CDR Records ───────────────────────────────────────────────────────────────

export interface SippyCDR {
  callId: string;
  caller: string;
  callee: string;
  startTime: string;
  duration: number;
  cost: number;
  result: string;
}

export async function getSippyCDRs(username: string, password: string, limit = 50): Promise<SippyCDR[]> {
  if (!activeSession) return [];
  const apiUrl = `${activeSession.portalUrl}/xmlapi/xmlapi`;
  const body = xmlRpcCall('cdrs.getCDRs', {
    limit,
    type: 0,
  });

  try {
    const resp = await rawPost(apiUrl, body, {
      Authorization: basicAuth(username, password),
    });
    if (resp.statusCode !== 200) return [];

    const structs = extractAllTags(resp.body, 'struct');
    const cdrs: SippyCDR[] = [];

    for (const s of structs) {
      const m = extractStructMembers(s);
      if (!m['call_id'] && !m['CallID'] && !m['cli']) continue;
      cdrs.push({
        callId: m['call_id'] || m['CallID'] || '-',
        caller: m['cli'] || m['caller'] || '-',
        callee: m['cld'] || m['callee'] || '-',
        startTime: m['connect_time'] || m['start_time'] || m['time'] || '',
        duration: parseInt(m['duration'] || '0') || 0,
        cost: parseFloat(m['cost'] || '0') || 0,
        result: m['disconnect_reason'] || m['reason'] || m['result'] || '',
      });
    }
    return cdrs;
  } catch {
    return [];
  }
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
  const auth = { Authorization: basicAuth(username, password) };

  // Try multiple known Sippy API method names for listing web portal users
  const methods = ['user.getUsersList', 'user.getList', 'user.get_users', 'admin.getAdminList'];
  for (const method of methods) {
    try {
      const body = xmlRpcCall(method);
      const resp = await rawPost(apiUrl, body, auth);
      if (resp.statusCode !== 200) continue;
      const text = resp.body.toString('utf-8');
      if (text.includes('faultCode')) continue; // Method not found / fault
      const structs = extractAllTags(text, 'struct');
      if (structs.length === 0) return { users: [] };
      const users: SippyPortalUser[] = [];
      for (const s of structs) {
        const m = extractStructMembers(s);
        const userId = m['i_user'] || m['user_id'] || m['id'] || '';
        if (!userId) continue;
        users.push({
          userId,
          name: m['name'] || m['login'] || userId,
          login: m['login'] || m['web_login'] || '',
          accessLevel: m['access_level'] || m['i_role'] || m['role'] || 'User',
          description: m['description'] || m['descr'] || undefined,
          email: m['email'] || undefined,
          timezone: m['time_zone'] || m['timezone'] || m['i_time_zone'] || undefined,
          language: m['language'] || m['i_lang'] || undefined,
          allowedHosts: m['allowed_hosts'] || undefined,
          startPage: m['start_page'] || undefined,
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
  const auth = { Authorization: basicAuth(username, password) };

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
      const resp = await rawPost(apiUrl, body, auth);
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
  const auth = { Authorization: basicAuth(username, password) };

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
      const resp = await rawPost(apiUrl, body, auth);
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
  const auth = { Authorization: basicAuth(username, password) };

  const methods = ['user.deleteUser', 'user.delete', 'admin.deleteAdmin'];
  for (const method of methods) {
    try {
      const body = xmlRpcCall(method, { i_user: userId });
      const resp = await rawPost(apiUrl, body, auth);
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
  auth: Record<string, string>,
  accountName: string,
): Promise<{ i_account: string; i_tariff: string } | null> {
  const methods = ['customer.getAccountList', 'customer.listAccounts'];
  for (const method of methods) {
    try {
      const body = xmlRpcCall(method, { name: accountName, get_total: 0 });
      const resp = await rawPost(apiUrl, body, auth);
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
  const auth    = { Authorization: basicAuth(credentials.username, credentials.password) };
  const effFrom = opts.effectiveFrom ? fmtSippyDate(opts.effectiveFrom) : fmtSippyDate(new Date());
  const lastErrors: string[] = [];

  // Step 1 — find the customer + their tariff ID
  const customer = await findSippyCustomer(apiUrl, auth, opts.accountName);
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
      const resp = await rawPost(apiUrl, body, auth);
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
      const resp = await rawPost(apiUrl, body, auth);
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
    const resp = await rawPost(apiUrl, body, auth);
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
      const resp = await rawPost(apiUrl, body, auth);
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
 * Create or update a customer account on Sippy.
 */
export interface SippyAccountOpts {
  name: string;
  type: 'client' | 'vendor';
  ipAddress?: string;
  ratePerMin?: number;
  // Basic Parameters
  timezone?: string;          // e.g. "Etc/UTC"
  language?: string;          // e.g. "English"
  sipClass?: string;          // e.g. "404 & 500 sip CC to"
  routingGroup?: string;      // e.g. "Banglades IGW OR"
  // Rating & Billing
  servicePlan?: string;       // tariff plan name
  creditLimit?: number;       // prepaid credit limit
  // Advanced Parameters
  maxSessions?: number;       // Max concurrent sessions (e.g. 1000)
  maxCallsPerSecond?: number; // CPS limit (e.g. 45)
  maxSessionTime?: number;    // max call time in seconds (e.g. 7200)
  preferredCodec?: string;    // e.g. "G.729"
  cldTranslationRule?: string; // CLD Tr. Rule, e.g. "s/^6043//"
  cliTranslationRule?: string; // CLI Tr. Rule, e.g. "s/^[+]//"
  // Address Info
  companyName?: string;
  description?: string;
}

export async function pushAccountToSippy(
  opts: SippyAccountOpts,
  credentials: { username: string; password: string },
  targetUrl?: string,
): Promise<SippyPushResult> {
  const baseUrl = targetUrl ?? activeSession?.portalUrl;
  if (!baseUrl) return { success: false, message: 'Not connected to Sippy — configure and connect your Sippy switch first.' };

  const apiUrl = `${sippyBase(baseUrl)}/xmlapi/xmlapi`;
  const auth   = { Authorization: basicAuth(credentials.username, credentials.password) };

  // Build the account parameter set (only include non-empty / non-null values)
  // NOTE: 'type' is NOT a valid Sippy customer.add param — account type is implied by the method
  const accountParams: Record<string, string | number | boolean> = {
    name: opts.name,
  };
  if (opts.ipAddress)           accountParams.ip                    = opts.ipAddress;
  if (opts.ratePerMin !== undefined) accountParams.rate             = opts.ratePerMin;
  if (opts.timezone)            accountParams.time_zone             = opts.timezone;
  if (opts.language)            accountParams.language              = opts.language;
  if (opts.sipClass)            accountParams.i_class               = opts.sipClass;
  if (opts.companyName)         accountParams.company_name          = opts.companyName;
  if (opts.description)         accountParams.description           = opts.description;
  if (opts.preferredCodec)      accountParams.preferred_codec       = opts.preferredCodec;
  if (opts.cldTranslationRule)  accountParams.cld_translation_rule  = opts.cldTranslationRule;
  if (opts.cliTranslationRule)  accountParams.cli_translation_rule  = opts.cliTranslationRule;
  if (opts.creditLimit !== undefined)    accountParams.credit_limit        = opts.creditLimit;
  if (opts.maxSessions !== undefined)    accountParams.max_sessions        = opts.maxSessions;
  if (opts.maxCallsPerSecond !== undefined) accountParams.max_calls_per_second = opts.maxCallsPerSecond;
  if (opts.maxSessionTime !== undefined) accountParams.max_session_time    = opts.maxSessionTime;
  // Routing group and tariff — Sippy needs integer IDs (i_routing_group, i_tariff)
  if (opts.routingGroup) {
    const rgInt = parseInt(opts.routingGroup, 10);
    if (!isNaN(rgInt)) accountParams.i_routing_group = rgInt;
  }
  if (opts.servicePlan) {
    const spInt = parseInt(opts.servicePlan, 10);
    if (!isNaN(spInt)) accountParams.i_tariff = spInt;
  }

  // Sippy uses different top-level methods for customers vs vendors.
  // We try the nested customer_info/vendor_info format first (standard Sippy XML-RPC),
  // then fall back to flat params for older/variant Sippy builds.
  const isVendor = opts.type === 'vendor';
  const wrapKey = isVendor ? 'vendor_info' : 'customer_info';

  const attempts: Array<{ method: string; body: string }> = isVendor
    ? [
        { method: 'vendor.add',       body: xmlRpcCallNested('vendor.add', wrapKey, accountParams) },
        { method: 'vendor.add-flat',  body: xmlRpcCall('vendor.add', accountParams) },
        { method: 'customer.add',     body: xmlRpcCallNested('customer.add', wrapKey, accountParams) },
        { method: 'customer.add-flat',body: xmlRpcCall('customer.add', accountParams) },
      ]
    : [
        { method: 'customer.add',           body: xmlRpcCallNested('customer.add', wrapKey, accountParams) },
        { method: 'customer.add-flat',      body: xmlRpcCall('customer.add', accountParams) },
        { method: 'customer.addCustomer',   body: xmlRpcCallNested('customer.addCustomer', wrapKey, accountParams) },
        { method: 'customer.addAccount',    body: xmlRpcCall('customer.addAccount', accountParams) },
      ];

  let lastFault = '';

  console.log(`[Sippy] pushAccountToSippy → url: ${apiUrl}, wrapKey: ${wrapKey}, params:`, JSON.stringify(accountParams));

  for (const { method, body } of attempts) {
    try {
      console.log(`[Sippy] Trying ${method}:\n${body}`);
      const resp = await rawPost(apiUrl, body, auth);
      const text = resp.body;
      console.log(`[Sippy] ${method} → HTTP ${resp.statusCode}, body: ${text.slice(0, 600)}`);
      if (resp.statusCode === 200 && !text.includes('<fault>') && !text.includes('faultCode') && !text.includes('faultString')) {
        console.log(`[Sippy] ${method} succeeded for "${opts.name}"`);
        return { success: true, message: `Account "${opts.name}" created successfully on Sippy.`, method };
      }
      // Extract Sippy fault string from XML-RPC fault response
      const faultStr = extractTag(text, 'faultString');
      if (faultStr) {
        lastFault = faultStr.replace(/<[^>]+>/g, '').trim();
        console.warn(`[Sippy] ${method} fault: ${lastFault}`);
        // A meaningful fault means the method name is correct — stop trying other formats
        if (!lastFault.toLowerCase().includes('no such method') && !lastFault.toLowerCase().includes('unknown method')) {
          break;
        }
      } else {
        console.warn(`[Sippy] ${method} non-fault failure: HTTP ${resp.statusCode}`);
        if (resp.statusCode === 401) { lastFault = 'Authentication failed — check Sippy username and password.'; break; }
        if (resp.statusCode === 403) { lastFault = 'Access denied — check Sippy API permissions.'; break; }
      }
    } catch (e: any) {
      console.warn(`[Sippy] ${method} error:`, e.message);
      lastFault = e.message;
    }
  }

  const detail = lastFault || `No response from Sippy at ${apiUrl} — check the URL and credentials in Settings.`;
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

export async function listSippyRoutingGroups(
  username: string,
  password: string,
  portalUrl?: string,
): Promise<{ groups: SippyRoutingGroup[]; error?: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { groups: [], error: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;
  const auth = { Authorization: basicAuth(username, password) };

  const methods = ['routing_group.getRoutingGroupList', 'routing_group.getList', 'routing.getGroupList'];
  for (const method of methods) {
    try {
      const body = xmlRpcCall(method);
      const resp = await rawPost(apiUrl, body, auth);
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
  const auth = { Authorization: basicAuth(username, password) };

  const methods = ['tariff.getTariffList', 'tariff.getList', 'billing.getTariffList'];
  for (const method of methods) {
    try {
      const body = xmlRpcCall(method);
      const resp = await rawPost(apiUrl, body, auth);
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
    const resp = await rawPost(apiUrl, body, {
      Authorization: basicAuth(username, password),
    });
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

// ── Rate Analysis ─────────────────────────────────────────────────────────────

export interface SippyTariff {
  id: string;
  name: string;
  type: string;
}

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

export async function getSippyTariffList(username: string, password: string): Promise<SippyTariff[]> {
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
      const resp = await rawPost(apiUrl, body, { Authorization: basicAuth(username, password) });
      if (resp.statusCode !== 200) continue;
      const text = resp.body.toString('utf-8');
      if (text.includes('faultCode')) continue;
      const structs = extractAllTags(text, 'struct');
      const tariffs: SippyTariff[] = [];
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
      const resp = await rawPost(apiUrl, body, { Authorization: basicAuth(username, password) });
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
      const resp = await rawPost(apiUrl, body, { Authorization: basicAuth(username, password) });
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
  const auth   = { Authorization: basicAuth(username, password) };

  for (const method of ['tariff.getRateList', 'rate.getRateList', 'tariff.getRates']) {
    try {
      const body = xmlRpcCall(method, { i_tariff: tariffId, get_total: 0 });
      const resp = await rawPost(apiUrl, body, auth);
      if (resp.statusCode !== 200 || resp.body.includes('<fault>')) continue;
      const structs = extractAllTags(resp.body, 'struct');
      const rates: RateEntry[] = [];
      for (const s of structs) {
        const m = extractStructMembers(s);
        const prefix = m['destination'] || m['prefix'] || m['dial_code'] || m['i_dest'] || '';
        if (!prefix) continue;
        rates.push({
          prefix,
          destination: m['destination_name'] || m['name'] || m['destination_description'] || prefix,
          rate: parseFloat(m['rate'] || m['price'] || '0') || 0,
          effectiveFrom: m['effective_from'] || m['start_date'] || '',
          effectiveTill: m['effective_till'] || m['end_date'] || '',
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
  const auth   = { Authorization: basicAuth(username, password) };
  const lastErrors: string[] = [];

  const params: Record<string, string | number> = {
    i_tariff:    tariffId,
    destination: entry.prefix,
    rate:        entry.rate,
  };
  if (entry.effectiveFrom) params.start_date = entry.effectiveFrom;
  if (entry.effectiveTill) params.end_date   = entry.effectiveTill;

  for (const method of ['tariff.setRate', 'tariff.addDestination', 'rate.setRate']) {
    try {
      const body = xmlRpcCall(method, params);
      const resp = await rawPost(apiUrl, body, auth);
      if (resp.statusCode === 200 && !resp.body.includes('<fault>')) {
        return { success: true, message: `Rate saved via ${method}` };
      }
      const fault = extractTag(resp.body, 'faultString') || `${method} failed`;
      lastErrors.push(fault);
    } catch (e: any) { lastErrors.push(e.message); }
  }
  return { success: false, message: lastErrors[0] || 'Could not save rate.' };
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
  const auth   = { Authorization: basicAuth(username, password) };

  for (const method of ['tariff.deleteRate', 'tariff.deleteDestination', 'rate.deleteRate']) {
    try {
      const body = xmlRpcCall(method, { i_tariff: tariffId, destination: prefix });
      const resp = await rawPost(apiUrl, body, auth);
      if (resp.statusCode === 200 && !resp.body.includes('<fault>')) {
        return { success: true, message: `Rate deleted via ${method}` };
      }
    } catch { continue; }
  }
  return { success: false, message: 'Delete not supported by this Sippy instance. Rate removed locally.' };
}
