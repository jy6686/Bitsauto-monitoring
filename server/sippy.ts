/**
 * Sippy Softswitch Integration
 *
 * References:
 *   106909 — Introduction to Sippy XML-RPC API
 *             https://support.sippysoft.com/support/solutions/articles/106909
 *   107448 — XML-RPC API: Manage Callback Calls (make2WayCallback)
 *             https://support.sippysoft.com/support/solutions/articles/107448
 *   107462 — XML-RPC API: Manage Active Calls (makeCall, listActiveCalls)
 *             https://support.sippysoft.com/support/solutions/articles/107462
 *   107525 — Simple API (/simpleapi/callback.php — HTTP Basic Auth GET)
 *             https://support.sippysoft.com/support/solutions/articles/107525
 *
 * Three integration modes:
 *
 * 1. XML-RPC API at /xmlapi/xmlapi — HTTP Digest Auth (RFC-2617, NOT Basic).
 *    Two credential modes per article 106909:
 *      a. Trusted Mode (ADMIN credentials — apiAdminUsername/apiAdminPassword):
 *         Full root-level access. Can originate calls via call_control.makeCall.
 *         Requires "Allow XML-RPC call origination" on the admin account.
 *         Credentials: Web Login (username) + API Password (set in My Preferences →
 *         Allow API Calls → API Password field — separate from web portal password).
 *      b. Normal Mode (CUSTOMER credentials — portalUsername/portalPassword):
 *         Scoped to that customer account. Used for make2WayCallback.
 *         Customer must have Callback service active AND Allow API Calls enabled.
 *
 * 2. Simple API at /simpleapi/callback.php — HTTP Basic Auth GET (article 107525).
 *    Easiest integration path. Admin must add credentials to .htpassword:
 *      htpasswd /home/ssp/sippy_web/simpleapi/.htpassword <username>
 *    Customer account (authname) must still have Callback service active.
 *
 * 3. Web portal session scraping — fallback when XML-RPC is restricted.
 *    Authenticates via POST /main.php and scrapes HTML pages.
 *
 * Call origination 3-phase strategy (POST /api/sippy/make-call in routes.ts):
 *   Phase 1: call_control.makeCall via XML-RPC Trusted Mode (admin creds)
 *   Phase 2: make2WayCallback via XML-RPC Normal Mode (customer creds)
 *   Phase 3: /simpleapi/callback.php HTTP Basic Auth GET (customer creds first)
 *
 * Credential fields in Settings (DB: settings table):
 *   apiAdminUsername / apiAdminPassword  →  admin XML-RPC (Trusted Mode)
 *   portalUsername   / portalPassword    →  customer XML-RPC (Normal Mode) + portal scraping
 */

import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
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

/** Returns the portal URL of the current active Sippy session, if any. */
export function getActivePortalUrl(): string | undefined {
  return activeSession?.portalUrl ?? undefined;
}

// ── Portal session caches ─────────────────────────────────────────────────────
// Two separate caches:
//   anyPortalCache  — used by listActiveCalls; accepts any session (admin/reseller/customer)
//   adminPortalCache — used by getSippyPerAccountStats; accepts only admin/reseller (for vendor data)
// TTL = 5 minutes each, to avoid rate-limiting the Sippy portal.
const PORTAL_SESSION_TTL_MS = 5 * 60_000;
// Keyed by base URL so sessions for different switches never cross-contaminate.
const anyPortalCacheByUrl   = new Map<string, { cookies: CookieJar; expiresAt: number }>();
const adminPortalCacheByUrl = new Map<string, { cookies: CookieJar; expiresAt: number }>();
// Negative cache: when admin/reseller portal login fails for ALL credential pairs,
// remember the failure for 5 minutes so we stop hammering Sippy with repeated login attempts.
const adminPortalNegCacheByUrl = new Map<string, number>(); // url → expiresAt epoch ms
const ADMIN_NEG_CACHE_TTL_MS = 5 * 60_000;

// Get any valid portal session (used by listActiveCalls portal scraping fallback)
async function getAnyPortalSession(
  base: string,
  ...pairs: Array<[string, string]>
): Promise<CookieJar | null> {
  const now = Date.now();
  const cached = anyPortalCacheByUrl.get(base);
  if (cached && cached.expiresAt > now) return cached.cookies;
  for (const [u, p] of pairs) {
    for (const acctType of ['admin', 'reseller', 'customer'] as const) {
      const res = await portalLogin(base, u, p, acctType);
      if (res.success) {
        anyPortalCacheByUrl.set(base, { cookies: res.cookies, expiresAt: now + PORTAL_SESSION_TTL_MS });
        console.log(`[Sippy] portal session cached (any) as ${u}/${acctType} @ ${base}`);
        // Also update activeSession so noNewLogin polling picks up these cookies immediately.
        // Only do this when activeSession is absent or points to the same host.
        if (!activeSession || activeSession.portalUrl === base) {
          activeSession = {
            portalUrl:   base,
            username:    u,
            connectedAt: new Date(),
            mode:        'portal',
            cookies:     res.cookies,
          };
          console.log(`[Sippy] activeSession promoted from getAnyPortalSession (${u}/${acctType})`);
        }
        return res.cookies;
      }
    }
  }
  anyPortalCacheByUrl.delete(base);
  return null;
}

/**
 * Exported helper: obtain a portal session for any switch URL + cred pairs, then
 * scrape /activecalls.php (includes orange-banner total fallback).
 * Used by pollSwitch as a last-resort when XML-RPC returns HTTP 200 with 0 calls.
 */
export async function scrapeActiveCallsPortal(
  portalUrl: string,
  ...pairs: Array<[string, string]>
): Promise<SippyActiveCall[]> {
  const base = sippyBase(portalUrl);
  const cookies = await getAnyPortalSession(base, ...pairs);
  if (!cookies) {
    console.log(`[Sippy] scrapeActiveCallsPortal: all portal logins failed for ${base}`);
    return [];
  }
  console.log(`[Sippy] scrapeActiveCallsPortal: scraping /activecalls.php for ${base}`);
  return getPortalActiveCallsHtml(cookies, base);
}

// Get an admin-level portal session (used by getSippyPerAccountStats for vendor cost data)
// Only accepts admin or reseller login — customer login shows wrong vendor data.
// Tries ssp-root (apiAdminUsername) first, then portalUsername.
async function getAdminPortalSession(
  base: string,
  adminUser: string, adminPass: string,
  portalUser: string, portalPass: string,
  adminWebPassword?: string,
  bypassNegCache?: boolean,
): Promise<CookieJar | null> {
  const now = Date.now();
  const cached = adminPortalCacheByUrl.get(base);
  if (cached && cached.expiresAt > now) return cached.cookies;
  // Negative cache: if all logins failed recently, don't hammer Sippy again — wait 5 minutes.
  // bypassNegCache=true lets explicit user-triggered actions (e.g. create service plan) retry immediately.
  if (!bypassNegCache) {
    const negExp = adminPortalNegCacheByUrl.get(base);
    if (negExp && negExp > now) {
      return null;
    }
  }
  // Build de-duplicated credential pairs to try
  const seen = new Set<string>();
  const pairs: [string, string][] = [];
  function addPair(u: string, p: string) {
    const key = `${u}:${p}`;
    if (u && p && !seen.has(key)) { seen.add(key); pairs.push([u, p]); }
  }
  addPair(adminUser, adminPass);
  addPair(portalUser, portalPass);
  if (adminWebPassword) {
    addPair(adminUser,  adminWebPassword);
    addPair(portalUser, adminWebPassword);
  }
  console.log(`[Sippy] getAdminPortalSession: trying ${pairs.length} cred pair(s) against ${base}`);
  const failures: string[] = [];
  // Try admin, reseller, and customer acct_types — ssp-root logs in as 'customer' type on this build
  for (const [u, p] of pairs) {
    for (const acctType of ['admin', 'reseller', 'customer'] as const) {
      const res = await portalLogin(base, u, p, acctType);
      if (res.success) {
        adminPortalCacheByUrl.set(base, { cookies: res.cookies, expiresAt: now + PORTAL_SESSION_TTL_MS });
        adminPortalNegCacheByUrl.delete(base); // clear any negative entry
        console.log(`[Sippy] admin portal session cached as ${u}/${acctType} @ ${base}`);
        return res.cookies;
      }
      failures.push(`${u}/${acctType}: ${res.message}`);
    }
  }
  console.log('[Sippy] getAdminPortalSession: all attempts failed:', failures.join(' | '));
  adminPortalCacheByUrl.delete(base);
  // Store negative result for 5 minutes to stop hammering the Sippy portal with doomed logins.
  adminPortalNegCacheByUrl.set(base, now + ADMIN_NEG_CACHE_TTL_MS);
  return null;
}

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
  timeoutMs = 12000,
): Promise<{ statusCode: number; body: string }> {
  const parsed  = new URL(url);
  const uri     = parsed.pathname + (parsed.search || '');
  const isHttps = parsed.protocol === 'https:';

  function makeReq(
    extraHeaders: Record<string, string | number>,
    overrideBody?: string,
  ): Promise<{ statusCode: number; body: string; wwwAuth?: string }> {
    const reqBody = overrideBody ?? body;
    return new Promise((resolve, reject) => {
      const opts: http.RequestOptions = {
        hostname: parsed.hostname,
        port:     parsed.port ? parseInt(parsed.port) : (isHttps ? 443 : 80),
        path:     uri,
        method:   'POST',
        headers:  {
          'Content-Type':   'text/xml',
          'Content-Length': Buffer.byteLength(reqBody),
          'User-Agent':     'SippyAPI/1.0',
          ...extraHeaders,
        },
        timeout: timeoutMs,
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
      req.write(reqBody);
      req.end();
    });
  }

  // Minimal XML body used ONLY to solicit a Digest auth challenge (407/401 + WWW-Authenticate).
  // We send a lightweight listMethods call so Sippy responds with its auth challenge without
  // executing any real method — the result is discarded, we only need the challenge headers.
  const challengeProbeBody = xmlRpcCall('system.listMethods', {});

  // ── Step 1: probe for auth challenge ──────────────────────────────────────
  let probe = await makeReq({});

  // Some Sippy endpoints (e.g. make2WayCallback) return HTTP 5xx on unauthenticated
  // requests instead of 401 + Digest challenge. Send a lightweight challenge probe
  // to get the Digest parameters, then use them with the real request body.
  if (probe.statusCode >= 500 && !probe.wwwAuth && username && password) {
    const challengeProbe = await makeReq({}, challengeProbeBody);
    if (challengeProbe.statusCode === 401 && challengeProbe.wwwAuth) {
      probe = challengeProbe; // use the Digest challenge from this probe below
    } else {
      // Last resort: try Basic Auth with the actual request body
      const basic = await makeReq({ Authorization: basicAuth(username, password) });
      return { statusCode: basic.statusCode, body: basic.body };
    }
  }
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
): Promise<{ statusCode: number; body: string; cookies: CookieJar; location?: string }> {
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
      const locationHeader = res.headers.location as string | undefined;

      if ((sc === 301 || sc === 302 || sc === 303 || sc === 307 || sc === 308) && locationHeader && redirectsLeft > 0) {
        res.resume();
        const next = new URL(locationHeader, url).toString();
        const nextMethod = (sc === 301 || sc === 302 || sc === 303) ? 'GET' : method;
        rawRequest(nextMethod, next, nextMethod === 'GET' ? null : body, extraHeaders, newJar, redirectsLeft - 1).then(resolve).catch(reject);
        return;
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ statusCode: sc, body: data, cookies: newJar, location: locationHeader }));
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

  // Try every known acct_type value — this Sippy build exposes account/customer/vendor
  // in the UI dropdown; older or admin-level accounts may use different values.
  const acctTypesToTry = accountType === 'admin'
    ? ['account', 'customer', 'vendor']   // ssp-root logs in as 'account' type on this build
    : [accountType];

  for (const acctType of acctTypesToTry) {
    const formData = encodeForm({
      username,
      password,
      acct_type: acctType,
      login_page: 'all',
      Login: 'Login',
    });

    try {
      // Use redirectsLeft=0 so we capture the 302 cookie BEFORE following — Sippy sessions
      // are server-side and the cookie is valid immediately on the 302 response.
      // Following the redirect causes the session to appear invalid in the next request.
      const resp = await rawRequest('POST', loginUrl, formData, { 'User-Agent': PORTAL_USER_AGENT }, new Map(), 0);

      // ── Success: Sippy redirects to /c1/ on successful customer login ───────
      // Only a redirect to /c1/ (the customer self-care portal) means auth succeeded.
      // A redirect to /index.php means auth failed (Sippy bounces back to login page).
      const locHeader = (resp as any).location as string | undefined;
      const redirectedToPortal = locHeader && (locHeader.includes('/c1/') || locHeader.startsWith('c1/'));
      if ((resp.statusCode === 301 || resp.statusCode === 302 || resp.statusCode === 303)
          && resp.cookies.size > 0 && redirectedToPortal) {
        // Verify the session is truly authenticated by checking the /c1/ portal page
        const check = await rawRequest('GET', `${base}/c1/service_plans.php`, null, { 'User-Agent': PORTAL_USER_AGENT }, resp.cookies, 0);
        if (check.statusCode === 200 && check.body.length > 500 && !check.body.includes('value="Login"')) {
          console.log(`[Sippy] portalLogin: success via 302→/c1/ for ${username}/${acctType}`);
          return { success: true, cookies: resp.cookies, message: `Authenticated via web portal as ${acctType}` };
        }
      }

      if (resp.statusCode === 401) continue;

      // ── Failure: login page returned again ───────────────────────────────────
      const isStillLoginPage = resp.body.includes('value="Login"') || resp.body.includes("value='Login'");
      if (isStillLoginPage) continue;

      // ── Success: direct page response with portal content ────────────────────
      const hasErrorDialog = resp.body.includes('ShowErrorDialog(')
        && !resp.body.includes('ShowErrorDialog(\'\')') && !resp.body.includes('ShowErrorDialog("")');
      if (hasErrorDialog) continue;

      const hasSessionMarker = resp.body.includes('action=Logout')
        || resp.body.toLowerCase().includes('logout')
        || resp.body.includes('vendors.php')
        || resp.body.includes('accounts.php')
        || resp.body.includes('activecalls.php')
        || resp.body.includes('service_plans.php')
        || resp.body.includes('reports.php');
      if (hasSessionMarker) {
        return { success: true, cookies: resp.cookies, message: `Authenticated via web portal as ${acctType}` };
      }
    } catch (err: any) {
      console.log(`[Sippy] portalLogin error ${username}/${acctType}: ${err.message}`);
    }
  }

  return { success: false, cookies: new Map(), message: `Login returned login form again — credentials rejected (${accountType}).` };
}

// ── provisioningLogin — strictly isolated write-plane authentication ───────────
// Uses ONLY SIPPY_PROV_USERNAME / SIPPY_PROV_PASSWORD.
// Throws "PROVISIONING_NOT_CONFIGURED" if credentials are absent — callers must
// catch this and surface the manual-fallback UI card.  The returned session is
// function-scoped and must NEVER be cached globally or reused across calls.
async function provisioningLogin(base: string): Promise<CookieJar> {
  const provUser = process.env.SIPPY_PROV_USERNAME?.trim() ?? '';
  const provPass = process.env.SIPPY_PROV_PASSWORD?.trim() ?? '';

  if (!provUser || !provPass) {
    throw new Error('PROVISIONING_NOT_CONFIGURED');
  }

  const loginUrl = `${base}/main.php`;
  // Try every account type. On this Sippy build ssp-root authenticates as 'customer'
  // redirecting to /c1/cdrs_customer.php — that IS a successful login even though
  // the session is customer-typed. We capture cookies directly from the 302 without
  // a follow-up verification GET (verification was the source of false negatives).
  const acctTypes = ['reseller', 'admin', 'account', 'customer'] as const;

  for (const acctType of acctTypes) {
    const formData = encodeForm({
      username: provUser, password: provPass, acct_type: acctType,
      login_page: 'all', Login: 'Login',
    });
    try {
      const resp = await rawRequest('POST', loginUrl, formData, { 'User-Agent': PORTAL_USER_AGENT }, new Map(), 0);
      const loc = (resp as any).location as string | undefined;
      const statusCode = resp.statusCode;
      const hasCookies = resp.cookies.size > 0;
      console.log(`[Sippy] provisioningLogin (${provUser}/${acctType}): HTTP ${statusCode}, Location: ${loc ?? 'none'}, cookies: ${resp.cookies.size}`);

      // ── Determine whether this is a success or failure redirect ─────────────
      // On many Sippy builds (including ssp-root accounts) a successful login
      // redirects to /index.php — this is NOT a failure. We must not assume
      // /index.php means "login rejected". Instead we verify the session by
      // performing a follow-up GET to a portal-only page.
      const isBackToLogin = !loc || (loc.endsWith('/main.php') && !loc.includes('?'));
      const is3xx = statusCode === 301 || statusCode === 302 || statusCode === 303;

      if (is3xx && hasCookies && !isBackToLogin) {
        // Got a 302 with cookies — verify the session with a quick GET
        try {
          const verifyResp = await rawRequest('GET', `${base}/c1/service_plans.php`, null,
            { 'User-Agent': PORTAL_USER_AGENT }, resp.cookies, 0);
          const body = verifyResp.body;
          const hasLoginForm = body.includes('value="Login"') || body.includes("value='Login'");
          const isLoginPage  = verifyResp.statusCode === 302 &&
            ((verifyResp as any).location ?? '').includes('/main.php');
          if (!hasLoginForm && !isLoginPage) {
            console.log(`[Sippy] provisioningLogin: verified session as ${provUser}/${acctType} → ${loc} (service_plans.php reachable)`);
            return resp.cookies;
          }
          console.log(`[Sippy] provisioningLogin: ${acctType} cookies obtained but session invalid (login form detected)`);
        } catch (ve: any) {
          console.log(`[Sippy] provisioningLogin: session verify GET failed (${acctType}): ${ve?.message}`);
        }
      }
      // Also accept a direct 200 with portal content (no redirect on some builds)
      if (statusCode === 200 && hasCookies) {
        const hasPortal = resp.body.includes('action=Logout') || resp.body.toLowerCase().includes('logout')
          || resp.body.includes('service_plans.php') || resp.body.includes('accounts.php');
        const hasLoginForm = resp.body.includes('value="Login"') || resp.body.includes("value='Login'");
        if (hasPortal && !hasLoginForm) {
          console.log(`[Sippy] provisioningLogin: captured session as ${provUser}/${acctType} via 200+portal`);
          return resp.cookies;
        }
      }
    } catch (e: any) {
      console.log(`[Sippy] provisioningLogin error (${acctType}): ${e?.message}`);
    }
  }

  console.log(`[Sippy] provisioningLogin: all acct_type attempts failed for ${provUser}`);
  throw new Error('PROVISIONING_NOT_CONFIGURED');
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

// ── Admin portal active-calls scraper ─────────────────────────────────────────
// Scrapes /activecalls.php (admin portal — logged in as ssp-root / admin type).
// Page structure (confirmed from live HTML):
//   Header row 1 (12 cells, Media IP has colspan=2):
//     #, Caller, CLI, CLD, State, Vendor, Connection, Direction, Media IP, Delay, Duration, Action
//   Header row 2 (2 cells = sub-headers for Media IP):
//     Caller, Callee
//   Data rows (13 cells per row — Media IP expands into 2 separate cells):
//     0:#, 1:Account, 2:CLI, 3:CLD, 4:State, 5:Vendor, 6:Connection,
//     7:Direction, 8:MediaIPCaller, 9:MediaIPCallee, 10:Delay(ms), 11:Duration(MM:SS), 12:Action

// Cache paginated portal calls per-base (9s TTL — prevents re-scraping on every 5s poll).
// 9 seconds gives two polls a cache hit before forcing a fresh scrape, dramatically
// reducing load on the Sippy portal web server.
const _portalCallsCache = new Map<string, { calls: any[]; bannerTotal: number; expiresAt: number }>();
const PORTAL_CALLS_TTL_MS = 9000;

export async function getPortalActiveCallsHtml(cookies: CookieJar, base: string): Promise<SippyActiveCall[]> {
  // Return cached result if still fresh
  const cached = _portalCallsCache.get(base);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.calls as SippyActiveCall[];
  }

  // Request a very large per_page to bypass the default 50-row limit.
  // Sippy admin portal accepts ?per_page=N to control rows shown.
  const { html } = await portalGet('/activecalls.php?per_page=5000', cookies, base);
  if (!html) return [];

  // Stale session detection: if the response looks like a login redirect page
  // (small HTML, contains the login form), the cached session has expired.
  // Evict it from both caches so the next call triggers a fresh login.
  const looksLikeLoginPage = html.length < 8000
    && (html.includes('value="Login"') || html.includes("value='Login'") || html.includes('action=Login'));
  if (looksLikeLoginPage) {
    console.log(`[Sippy] activecalls: stale/expired session detected at ${base} (${html.length}B login page) — evicting cache`);
    anyPortalCacheByUrl.delete(base);
    adminPortalCacheByUrl.delete(base);
    return [];
  }

  // Extract disconnect IDs from delete_warning(ID) calls — these are the IDs needed for disconnectCall()
  const disconnectIds: Record<number, string> = {};
  const dwRe = /delete_warning\((\d+)\)/g;
  let dwMatch: RegExpExecArray | null;
  while ((dwMatch = dwRe.exec(html)) !== null) {
    disconnectIds[Object.keys(disconnectIds).length] = dwMatch[1];
  }

  // Extract account IDs from accounts.php?action=edit&account=N links
  const accountIds: Record<number, string> = {};
  const acctRe = /accounts\.php\?action=edit&amp;account=(\d+)/g;
  let acctMatch: RegExpExecArray | null;
  while ((acctMatch = acctRe.exec(html)) !== null) {
    accountIds[Object.keys(accountIds).length] = acctMatch[1];
  }

  // Extract vendor IDs from vendors.php?i_vendor=N links
  const vendorIds: Record<number, string> = {};
  const vendRe = /vendors\.php\?i_vendor=(\d+)/g;
  let vendMatch: RegExpExecArray | null;
  while ((vendMatch = vendRe.exec(html)) !== null) {
    vendorIds[Object.keys(vendorIds).length] = vendMatch[1];
  }

  const rows = scrapeHtmlTable(html);
  const calls: SippyActiveCall[] = [];

  // Parse the orange "Active Calls: N ROUTING / M CONNECTED / P TOTAL" banner FIRST,
  // before any early returns, so we always have the system-wide total available.
  const bannerMatch = html.match(/(\d+)\s*ROUTING\s*\/\s*(\d+)\s*CONNECTED\s*\/\s*(\d+)\s*TOTAL/i)
    ?? html.match(/Active\s+Calls[^<]*?(\d+)\s*TOTAL/i);
  const bannerTotal = bannerMatch ? parseInt(bannerMatch[bannerMatch.length - 1] || '0', 10) : -1;

  // Locate the main data table header row that contains 'Caller','CLI','CLD','State' all together
  let headerRow = -1;
  for (let i = 0; i < rows.length; i++) {
    const lower = rows[i].map(c => c.toLowerCase().trim());
    const hasCli = lower.includes('cli');
    const hasCld = lower.includes('cld');
    const hasState = lower.includes('state');
    const hasDurOrTime = lower.includes('duration') || lower.includes('dur') || lower.includes('time');
    if (hasCli && hasCld && hasState && hasDurOrTime) {
      headerRow = i;
      break;
    }
  }

  if (headerRow < 0) {
    // Table header format not recognised. Log first row for diagnostics.
    const firstRowPreview = JSON.stringify(rows[0] ?? []);
    console.log(`[Sippy] activecalls table header not found at ${base} — html=${html.length}B rows=${rows.length} firstRow=${firstRowPreview}`);
    if (bannerTotal > 0) {
      // Banner is present and readable — use it as the authoritative call count.
      console.log(`[Sippy] activecalls banner says ${bannerTotal} total at ${base} — returning synthetic entries`);
      for (let j = 0; j < bannerTotal; j++) {
        calls.push({ id: `banner-${j}`, callId: `banner-${j}`, caller: '', callee: '' });
      }
    }
    return calls;
  }

  // Known hardcoded column indices for Sippy admin activecalls.php (confirmed from live HTML).
  // Data rows have 13 cells; header has 12 (Media IP uses colspan=2 → shifts everything after index 8).
  // Col 0:#  1:Account  2:CLI  3:CLD  4:State  5:Vendor  6:Connection
  //     7:Direction  8:MediaIPCaller  9:MediaIPCallee  10:Delay(ms)  11:Duration(MM:SS)  12:Action
  const COL_ACCOUNT    = 1;
  const COL_CLI        = 2;
  const COL_CLD        = 3;
  const COL_STATE      = 4;
  const COL_VENDOR     = 5;
  const COL_CONNECTION = 6;
  const COL_DIRECTION  = 7;
  const COL_MEDIA_SRC  = 8;
  const COL_MEDIA_DST  = 9;
  const COL_DELAY      = 10;
  const COL_DURATION   = 11;

  let callIndex = 0;
  for (let i = headerRow + 2; i < rows.length; i++) {  // +2 skips both header rows
    const row = rows[i];
    if (row.length < 10) continue;
    const joined = row.join('').trim().toLowerCase();
    if (!joined || joined.includes('list is empty') || joined.startsWith('page ')) continue;
    // Skip sub-header row ("Caller" / "Callee" for Media IP)
    if (row[0]?.toLowerCase() === 'caller' || row[0]?.toLowerCase() === '#') continue;

    const get = (idx: number) => (idx >= 0 && idx < row.length ? row[idx].trim() : '');

    const cli    = get(COL_CLI);
    const cld    = get(COL_CLD);
    if (!cli && !cld) continue;

    const durStr = get(COL_DURATION);
    const durParts = durStr.split(':');
    const durationSec = durParts.length >= 2
      ? (parseInt(durParts[0] || '0') * 60 + parseInt(durParts[1] || '0'))
      : (parseInt(durStr || '0') || 0);

    const delayStr = get(COL_DELAY);
    // Delay on this page is in milliseconds (e.g. "19.566"), convert to seconds for consistency
    const delayMs = parseFloat(delayStr) || 0;

    const disconnectId = disconnectIds[callIndex];
    const accountId    = accountIds[callIndex];
    const vendorId     = vendorIds[callIndex];

    calls.push({
      id:           disconnectId || `portal-${i}`,
      callId:       `portal-${i}`,
      caller:       cli  || '-',
      callee:       cld  || '-',
      duration:     durationSec,
      codec:        '-',
      status:       get(COL_STATE) || 'active',
      delay:        delayMs / 1000,             // store as seconds (consistent with XML-RPC DELAY field)
      user:         get(COL_ACCOUNT) || undefined,
      accountId:    accountId || undefined,
      vendor:       get(COL_VENDOR) || undefined,
      connection:   get(COL_CONNECTION) || undefined,
      iVendorId:    vendorId || undefined,
      direction:    get(COL_DIRECTION) || undefined,
      mediaIpCaller: get(COL_MEDIA_SRC) || undefined,
      mediaIpCallee: get(COL_MEDIA_DST) || undefined,
      iCustomer:    undefined,
      iEnvironment: undefined,
    });
    callIndex++;
  }

  // ── Multi-page pagination ────────────────────────────────────────────────────
  // Customer portal caps at 50 rows per page even with per_page=5000.
  // Fetch additional pages using n=OFFSET until we have all calls or reach the max.
  // We try the common Sippy pagination param ?n=N (offset); if the portal ignores it,
  // deduplication on callId prevents duplicates and newCallsOnPage===0 stops the loop.
  if (bannerTotal > calls.length && bannerTotal <= 3000) {
    const seenIds = new Set(calls.map(c => c.callId));
    let offset = calls.length || 50;
    // Cap at 2 extra pages (150 calls total = 3 pages × 50).
    // The NOC live-calls view never needs more than ~150 simultaneous calls to be useful,
    // and fetching 19 pages per poll was adding 9-10 seconds of load on the Sippy web server.
    const maxExtraPages = 2;

    for (let pg = 0; pg < maxExtraPages && calls.length < bannerTotal; pg++) {
      const { html: pgHtml } = await portalGet(
        `/activecalls.php?per_page=50&n=${offset}`, cookies, base
      );
      if (!pgHtml || pgHtml.length < 500) break;

      // Skip if it looks like a login page
      if (pgHtml.includes('value="Login"') || pgHtml.includes("value='Login'")) break;

      // Extract IDs for this page
      const pgDiscoIds: Record<number, string> = {};
      const pgDwRe = /delete_warning\((\d+)\)/g;
      let pgDwM: RegExpExecArray | null;
      while ((pgDwM = pgDwRe.exec(pgHtml)) !== null) {
        pgDiscoIds[Object.keys(pgDiscoIds).length] = pgDwM[1];
      }
      const pgAcctIds: Record<number, string> = {};
      const pgAcctRe = /accounts\.php\?action=edit&amp;account=(\d+)/g;
      let pgAcctM: RegExpExecArray | null;
      while ((pgAcctM = pgAcctRe.exec(pgHtml)) !== null) {
        pgAcctIds[Object.keys(pgAcctIds).length] = pgAcctM[1];
      }
      const pgVendIds: Record<number, string> = {};
      const pgVendRe = /vendors\.php\?i_vendor=(\d+)/g;
      let pgVendM: RegExpExecArray | null;
      while ((pgVendM = pgVendRe.exec(pgHtml)) !== null) {
        pgVendIds[Object.keys(pgVendIds).length] = pgVendM[1];
      }

      const pgRows = scrapeHtmlTable(pgHtml);
      let pgHeaderRow = -1;
      for (let i = 0; i < pgRows.length; i++) {
        const lower = pgRows[i].map(c => c.toLowerCase().trim());
        if (lower.includes('cli') && lower.includes('cld') &&
            (lower.includes('state') || lower.includes('duration') || lower.includes('dur'))) {
          pgHeaderRow = i;
          break;
        }
      }
      if (pgHeaderRow < 0) break;

      let pgIdx = 0;
      let newOnPage = 0;
      for (let i = pgHeaderRow + 2; i < pgRows.length; i++) {
        const row = pgRows[i];
        if (row.length < 10) continue;
        const joined = row.join('').trim().toLowerCase();
        if (!joined || joined.includes('list is empty') || joined.startsWith('page ')) continue;
        if (row[0]?.toLowerCase() === 'caller' || row[0]?.toLowerCase() === '#') continue;
        const get = (idx: number) => (idx >= 0 && idx < row.length ? row[idx].trim() : '');
        const cli = get(COL_CLI);
        const cld = get(COL_CLD);
        if (!cli && !cld) continue;

        const durStr = get(COL_DURATION);
        const durParts = durStr.split(':');
        const durationSec = durParts.length >= 2
          ? (parseInt(durParts[0] || '0') * 60 + parseInt(durParts[1] || '0'))
          : (parseInt(durStr || '0') || 0);
        const delayMs = parseFloat(get(COL_DELAY)) || 0;

        const discoId  = pgDiscoIds[pgIdx];
        const uniqueId = discoId || `portal-pg${pg + 2}-${i}`;
        const cid      = `portal-pg${pg + 2}-row${i}`;

        if (!seenIds.has(uniqueId)) {
          seenIds.add(uniqueId);
          calls.push({
            id:            uniqueId,
            callId:        cid,
            caller:        cli || '-',
            callee:        cld || '-',
            duration:      durationSec,
            codec:         '-',
            status:        get(COL_STATE) || 'active',
            delay:         delayMs / 1000,
            user:          get(COL_ACCOUNT) || undefined,
            accountId:     pgAcctIds[pgIdx]  || undefined,
            vendor:        get(COL_VENDOR)   || undefined,
            connection:    get(COL_CONNECTION) || undefined,
            iVendorId:     pgVendIds[pgIdx]   || undefined,
            direction:     get(COL_DIRECTION)  || undefined,
            mediaIpCaller: get(COL_MEDIA_SRC) || undefined,
            mediaIpCallee: get(COL_MEDIA_DST) || undefined,
            iCustomer:     undefined,
            iEnvironment:  undefined,
          });
          newOnPage++;
        }
        pgIdx++;
      }

      if (newOnPage === 0) break; // portal returned same page or no more data
      offset += 50;
    }

    console.log(`[Sippy] activecalls portal: fetched ${calls.length} of ${bannerTotal} (banner total)`);
  } else if (bannerTotal < 0) {
    console.log(`[Sippy] activecalls banner NOT found in HTML from ${base} (table rows=${calls.length})`);
  } else if (bannerTotal > 0) {
    console.log(`[Sippy] activecalls portal: ${calls.length} calls (banner=${bannerTotal})`);
  }

  // Store in cache
  _portalCallsCache.set(base, { calls, bannerTotal, expiresAt: Date.now() + PORTAL_CALLS_TTL_MS });

  return calls;
}

// ── ASR/ACD Report scraper ─────────────────────────────────────────────────────
// Scrapes /asr_acd.php from the Sippy admin portal to get real traffic stats:
// ASR, ACD, PDD (origination side) + Revenue (from customers) + Cost (to vendors)

export interface SippyAsrAcdStats {
  ok: boolean;
  period: string;
  origination: {
    totalCalls: number;
    billableCalls: number;
    totalDurationSec: number;
    acd: number;        // seconds
    asr: number;        // %
    avgPdd: number;     // seconds
    revenue: number;    // USD
  };
  termination: {
    totalCalls: number;
    billableCalls: number;
    totalDurationSec: number;
    acd: number;
    asr: number;
    avgPdd: number;
    cost: number;       // USD
  };
  margin: number;       // revenue - cost
}

const EMPTY_ORIG = { totalCalls: 0, billableCalls: 0, totalDurationSec: 0, acd: 0, asr: 0, avgPdd: 0, revenue: 0 };
const EMPTY_TERM = { totalCalls: 0, billableCalls: 0, totalDurationSec: 0, acd: 0, asr: 0, avgPdd: 0, cost: 0 };

function parseMMSS(s: string): number {
  const parts = s.trim().split(':');
  if (parts.length >= 2) return (parseInt(parts[0]) || 0) * 60 + (parseInt(parts[1]) || 0);
  return parseInt(s) || 0;
}

// ── Portal-based ASR/ACD scraper ──────────────────────────────────────────────
// Scrapes /asr_acd.php from the Sippy portal using customer (RTST1) credentials.
// Returns aggregate origination + termination stats, and per-client/per-vendor rows.

export interface SippyAccountStatRow {
  name:         string;
  totalCalls:   number;
  billableCalls:number;
  durationSec:  number;  // billed duration in seconds
  acdSec:       number;  // ACD in seconds
  asr:          number;  // ASR %
  avgPdd:       number;  // average PDD seconds
  amount:       number;  // revenue (origination) or cost (termination)
}

export interface SippyPerAccountStats {
  ok:                 boolean;
  period:             string;
  fetchedAt:          string;
  clients:            SippyAccountStatRow[];   // origination rows (per customer/caller)
  vendors:            SippyAccountStatRow[];   // termination rows (per vendor/connection)
  origTotal:          SippyAccountStatRow;
  termTotal:          SippyAccountStatRow;
  vendorDataLimited?: boolean;   // true when only customer session was available (no admin/reseller)
  error?:             string;
}

const EMPTY_ROW: SippyAccountStatRow = {
  name: '', totalCalls: 0, billableCalls: 0, durationSec: 0, acdSec: 0, asr: 0, avgPdd: 0, amount: 0,
};

function scrapeAsrAcdRows(html: string): {
  origRows: SippyAccountStatRow[];
  termRows: SippyAccountStatRow[];
} {
  // Find Origination and Termination sections in the HTML
  // The page has two report tables separated by section headings
  const origRows: SippyAccountStatRow[] = [];
  const termRows: SippyAccountStatRow[] = [];

  // Parse all <tr> rows in the page
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;

  // Section tracking: 'orig' or 'term'
  let section: 'orig' | 'term' | null = null;

  while ((m = trRe.exec(html)) !== null) {
    const rowHtml = m[1];
    const text    = rowHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    // Detect section headings
    if (/origination/i.test(text) && !text.match(/^\d/)) { section = 'orig'; continue; }
    if (/termination/i.test(text) && !text.match(/^\d/)) { section = 'term'; continue; }
    if (!section) continue;

    // Skip header rows (column header rows contain "Number of Calls" or "Billable Calls")
    // Note: must NOT skip data rows like "System Vendor / System Connection"
    if (/number of calls|billable calls/i.test(text)) continue;
    // Also skip section heading rows like "Caller ..." and "Vendor / Connection ..."
    // but only when they appear as standalone header text (no digits in the row)
    if (/^(caller|vendor\s*\/\s*connection)\s+/i.test(text)) continue;

    // Extract cells (td/th elements)
    const tdRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    const cells: string[] = [];
    let td: RegExpExecArray | null;
    while ((td = tdRe.exec(rowHtml)) !== null) {
      const cellText = td[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
      cells.push(cellText);
    }

    // Data row: [Name, NumCalls, BillableCalls, BilledDuration mm:ss, ACD mm:ss, ASR%, AvgPDD, Amount]
    if (cells.length < 6) continue;

    const name         = cells[0].replace(/Acct\.\s*/i, '').trim();
    const totalCalls   = parseInt(cells[1]) || 0;
    const billableCalls= parseInt(cells[2]) || 0;
    const durationSec  = parseMMSS(cells[3] || '0:0');
    const acdSec       = parseMMSS(cells[4] || '0:0');
    const asr          = parseFloat(cells[5]) || 0;
    const avgPdd       = parseFloat(cells[6]) || 0;
    const amount       = parseFloat(cells[7]) || 0;

    // Skip if all zeros and no name (empty filler rows)
    if (!name && totalCalls === 0) continue;

    const row: SippyAccountStatRow = { name, totalCalls, billableCalls, durationSec, acdSec, asr, avgPdd, amount };

    // Total rows go to their respective totals (handled separately)
    if (/^total for all/i.test(name)) {
      // Already captured separately — skip here
      continue;
    }

    if (section === 'orig') origRows.push(row);
    else                    termRows.push(row);
  }

  return { origRows, termRows };
}

function sumRows(rows: SippyAccountStatRow[], amountKey: 'revenue' | 'cost'): SippyAccountStatRow {
  if (rows.length === 0) return { ...EMPTY_ROW };
  const totalCalls    = rows.reduce((s, r) => s + r.totalCalls,    0);
  const billableCalls = rows.reduce((s, r) => s + r.billableCalls, 0);
  const durationSec   = rows.reduce((s, r) => s + r.durationSec,   0);
  const amount        = rows.reduce((s, r) => s + r.amount,        0);
  const asr           = totalCalls > 0 ? parseFloat((billableCalls / totalCalls * 100).toFixed(2)) : 0;
  const acdSec        = billableCalls > 0 ? Math.round(durationSec / billableCalls) : 0;
  const avgPdd        = rows.length > 0 ? parseFloat((rows.reduce((s, r) => s + r.avgPdd, 0) / rows.length).toFixed(2)) : 0;
  return { name: 'Total', totalCalls, billableCalls, durationSec, acdSec, asr, avgPdd, amount };
}

// formatSippyPortalDate: converts a JS Date to the Sippy portal date format MM/DD/YYYY HH:MM:SS
// e.g. "05/19/2026 09:45:00"
function formatSippyPortalDate(d: Date): string {
  // Sippy portal expects MM/DD/YYYY HH:MM:SS (same format used by its own CDR pages).
  // The previous "HH:MM:SS.000 GMT Www Mmm DD YYYY" format was unrecognised by the
  // PHP portal and caused it to silently revert to its 90-minute default window.
  const pad  = (n: number) => String(n).padStart(2, '0');
  const mm   = pad(d.getUTCMonth() + 1);
  const dd   = pad(d.getUTCDate());
  const yyyy = d.getUTCFullYear();
  const hh   = pad(d.getUTCHours());
  const min  = pad(d.getUTCMinutes());
  const ss   = pad(d.getUTCSeconds());
  return `${mm}/${dd}/${yyyy} ${hh}:${min}:${ss}`;
}

export async function getSippyPerAccountStats(
  portalUsername: string,
  portalPassword: string,
  periodMinutes = 90,
  fallbackUsername?: string,
  fallbackPassword?: string,
  fromDate?: Date,
  toDate?: Date,
  cli?: string,
  cld?: string,
  adminWebPassword?: string,
): Promise<SippyPerAccountStats> {
  const FAIL = (error: string): SippyPerAccountStats => ({
    ok: false, period: `${periodMinutes} min`, fetchedAt: new Date().toISOString(),
    clients: [], vendors: [], origTotal: { ...EMPTY_ROW }, termTotal: { ...EMPTY_ROW }, error,
  });

  if (!activeSession) return FAIL('Not connected to Sippy.');

  const base = activeSession.portalUrl;
  if (!portalUsername || !portalPassword) {
    return FAIL('Portal credentials not configured (set Portal Username/Password in Settings).');
  }

  try {
    // ── Step 1: Get portal session ────────────────────────────────────────────
    // Prefer admin/reseller (shows correct vendor termination costs).
    // Fall back to any session (customer) so we still return origination revenue.
    // Also include SIPPY_PROV_USERNAME/PASSWORD env vars as additional credential candidates.
    const provUser = process.env.SIPPY_PROV_USERNAME?.trim() ?? '';
    const provPass = process.env.SIPPY_PROV_PASSWORD?.trim() ?? '';

    let cookies = await getAdminPortalSession(
      base,
      fallbackUsername ?? '', fallbackPassword ?? '',  // ssp-root / apiAdminUsername first
      portalUsername, portalPassword,                   // RTST1 / portalUsername second
      adminWebPassword,
    );

    // If admin session failed, also try provisioning credentials as a third option
    if (!cookies && provUser && provPass) {
      cookies = await getAdminPortalSession(
        base,
        provUser, provPass,
        portalUsername, portalPassword,
        adminWebPassword,
        true, // bypass negative cache for provisioning creds
      );
    }
    let vendorDataFull = true;
    if (!cookies) {
      // Try any session (customer login) — origination amounts will be correct,
      // termination/vendor costs will be zero or unavailable.
      cookies = await getAnyPortalSession(base, [portalUsername, portalPassword] as [string, string]);
      vendorDataFull = false;
      if (!cookies) return FAIL('Portal login failed: unable to log in with any credentials.');
      console.log('[Sippy] getSippyPerAccountStats: using customer session — vendor cost unavailable');
    }

    // ── Step 2: POST /asr_acd.php with correct form parameters ─────────────
    // orig_disp=1 → group by Caller (account)
    // term_disp=2 → group by Connection (vendor/connection)
    const now   = toDate ?? new Date();
    const start = fromDate ?? new Date(now.getTime() - periodMinutes * 60_000);

    const postBody = encodeForm({
      startDate:        formatSippyPortalDate(start),
      endDate:          formatSippyPortalDate(now),
      orig_disp:        '1',     // group origination by Account (customer)
      term_disp:        '2',     // group termination by Connection (vendor)
      orig_hide_zcalls: '0',     // show all (including 0-call entries)
      term_hide_zcalls: '0',
      from_form:        '1',
      action:           'update',
      cdr_currency:     'USD',
      vendor:           '0',     // all vendors
      caller:           '0',     // all callers
      orig_sort_by:     '1',
      term_sort_by:     '1',
      cli_clause:       '0',
      cld_clause:       '0',
      source:           cli ?? '',   // CLI (caller) filter substring
      destination:      cld ?? '',   // CLD (callee) filter substring
      hl_asr_below:     '10',
    });

    const acrHtml = await new Promise<string>((resolve, reject) => {
      const url = new URL(`${base}/asr_acd.php`);
      const options = {
        hostname: url.hostname,
        port:     parseInt(url.port) || (url.protocol === 'https:' ? 443 : 80),
        path:     url.pathname,
        method:   'POST',
        headers:  {
          'Content-Type':   'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postBody),
          'Cookie':         [...cookies.entries()].map(([k,v]) => `${k}=${v}`).join('; '),
          'User-Agent':     'Mozilla/5.0 (compatible; SippyMonitor/1.0)',
        },
        rejectUnauthorized: false,
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', d => { data += d; });
        res.on('end', () => resolve(data));
      });
      req.on('error', reject);
      req.write(postBody);
      req.end();
    });

    if (!acrHtml || acrHtml.length < 500) return FAIL('Empty response from portal ASR/ACD page.');

    // ── Step 3: Parse origination + termination rows ─────────────────────────
    const { origRows, termRows } = scrapeAsrAcdRows(acrHtml);

    return {
      ok:               true,
      period:           `${periodMinutes} min`,
      fetchedAt:        new Date().toISOString(),
      clients:          origRows,
      vendors:          termRows,
      origTotal:        sumRows(origRows, 'revenue'),
      termTotal:        sumRows(termRows, 'cost'),
      vendorDataLimited: !vendorDataFull,
    };
  } catch (e: any) {
    return FAIL(e.message ?? 'Unknown error fetching per-account stats.');
  }
}

// getSippyAsrAcdReport — portal-based (uses RTST1 customer login to scrape /asr_acd.php)
// Falls back to zeros when no traffic in the window (shows real data when calls exist).
export async function getSippyAsrAcdReport(
  portalUsername: string,
  portalPassword: string,
  _portalUrl: string,
  periodMinutes = 90,
  fallbackUsername?: string,
  fallbackPassword?: string,
): Promise<SippyAsrAcdStats> {
  const perAccount = await getSippyPerAccountStats(portalUsername, portalPassword, periodMinutes, fallbackUsername, fallbackPassword);

  const o = perAccount.origTotal;
  const t = perAccount.termTotal;

  return {
    ok:     perAccount.ok,
    period: perAccount.period,
    origination: {
      totalCalls:       o.totalCalls,
      billableCalls:    o.billableCalls,
      totalDurationSec: o.durationSec,
      acd:              o.acdSec,
      asr:              o.asr,
      avgPdd:           o.avgPdd,
      revenue:          parseFloat(o.amount.toFixed(4)),
    },
    termination: {
      totalCalls:       t.totalCalls,
      billableCalls:    t.billableCalls,
      totalDurationSec: t.durationSec,
      acd:              t.acdSec,
      asr:              t.asr,
      avgPdd:           t.avgPdd,
      cost:             parseFloat(t.amount.toFixed(4)),
    },
    margin: parseFloat((o.amount - t.amount).toFixed(4)),
  };
}

// ── Profit & Loss Report scraper ──────────────────────────────────────────────
// Scrapes /profit_loss_report.php (or /c1/profit_loss_report.php) from the
// Sippy portal to return per-day P&L rows + summary totals.

export interface PnlRow {
  date:       string;   // e.g. "2026-04-18"
  calls:      number;
  durationSec:number;   // total billed duration in seconds
  revenue:    number;   // USD
  cost:       number;   // USD
  profit:     number;   // USD
  margin:     number;   // %
}

export interface PnlReport {
  ok:       boolean;
  period:   string;
  fetchedAt:string;
  rows:     PnlRow[];
  totals:   PnlRow;
  error?:   string;
}

const EMPTY_PNL_ROW: PnlRow = { date: 'Total', calls: 0, durationSec: 0, revenue: 0, cost: 0, profit: 0, margin: 0 };

function parsePnlDuration(s: string): number {
  // Accept hh:mm:ss, mm:ss, or plain seconds
  if (!s) return 0;
  const parts = s.trim().split(':').map(Number);
  if (parts.length === 3) return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
  if (parts.length === 2) return (parts[0] || 0) * 60 + (parts[1] || 0);
  return parseInt(s) || 0;
}

export async function scrapeProfitLossReport(
  portalUsername: string,
  portalPassword: string,
  fallbackUsername?: string,
  fallbackPassword?: string,
  fromDate?: Date,
  toDate?: Date,
): Promise<PnlReport> {
  const now   = toDate   ?? new Date();
  const start = fromDate ?? new Date(now.getTime() - 30 * 24 * 60 * 60_000);
  const FAIL  = (error: string): PnlReport => ({
    ok: false, period: '', fetchedAt: new Date().toISOString(),
    rows: [], totals: { ...EMPTY_PNL_ROW }, error,
  });

  if (!activeSession) return FAIL('Not connected to Sippy.');
  const base = activeSession.portalUrl;

  // Try admin/reseller session first (more data), then any customer session
  let cookies = await getAdminPortalSession(
    base,
    fallbackUsername ?? '', fallbackPassword ?? '',
    portalUsername, portalPassword,
  );
  if (!cookies) {
    cookies = await getAnyPortalSession(base, [portalUsername, portalPassword]);
    if (!cookies) return FAIL('Portal login failed for P&L report.');
  }

  // Sippy portal date format: "HH:MM:SS.000 GMT Www Mmm DD YYYY"
  const postBody = encodeForm({
    startDate:    formatSippyPortalDate(start),
    endDate:      formatSippyPortalDate(now),
    from_form:    '1',
    action:       'update',
    cdr_currency: 'USD',
    period:       'day',   // daily breakdown
  });

  // Try POST to both /profit_loss_report.php (admin path) and /c1/ (customer path)
  let html = '';
  const paths = ['/profit_loss_report.php', '/c1/profit_loss_report.php'];
  for (const path of paths) {
    try {
      const { statusCode, body: candidate } = await rawRequest(
        'POST',
        `${base}${path}`,
        postBody,
        { 'Content-Type': 'application/x-www-form-urlencoded' },
        cookies,
      );
      if (statusCode === 200 && candidate && candidate.length > 500) {
        html = candidate;
        break;
      }
    } catch { /* try next path */ }
  }

  if (!html) {
    // Fallback: GET with query string (some Sippy builds use GET)
    const qs = [
      `startDate=${encodeURIComponent(formatSippyPortalDate(start))}`,
      `endDate=${encodeURIComponent(formatSippyPortalDate(now))}`,
      'from_form=1', 'action=update', 'cdr_currency=USD', 'period=day',
    ].join('&');
    for (const path of paths) {
      try {
        const { html: h } = await portalGet(`${path}?${qs}`, cookies, base);
        if (h && h.length > 500) { html = h; break; }
      } catch { /* try next path */ }
    }
  }

  if (!html || html.length < 200) return FAIL('Empty response from Sippy P&L report page.');

  // ── Parse the HTML table ───────────────────────────────────────────────────
  // Expected columns (may vary): Date | Calls | Duration | Revenue | Cost | Profit | Margin%
  const rows: PnlRow[] = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;

  // Find column header row to determine indices
  let colDate = 0, colCalls = 1, colDur = 2, colRev = 3, colCost = 4, colProfit = 5, colMargin = 6;
  let headerFound = false;

  while ((m = trRe.exec(html)) !== null) {
    const rowHtml = m[1];
    const tdRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    const cells: string[] = [];
    let td: RegExpExecArray | null;
    while ((td = tdRe.exec(rowHtml)) !== null) {
      cells.push(td[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim());
    }
    if (cells.length < 3) continue;

    const joined = cells.join('|').toLowerCase();

    // Detect header row to map column indices
    if (!headerFound && (joined.includes('revenue') || joined.includes('profit') || joined.includes('calls'))) {
      headerFound = true;
      cells.forEach((c, i) => {
        const lc = c.toLowerCase();
        if (/^date|period|day/i.test(lc))      colDate   = i;
        else if (/calls/i.test(lc))            colCalls  = i;
        else if (/duration|minutes/i.test(lc)) colDur    = i;
        else if (/revenue/i.test(lc))          colRev    = i;
        else if (/cost/i.test(lc))             colCost   = i;
        else if (/profit|net/i.test(lc))       colProfit = i;
        else if (/margin|%/i.test(lc))         colMargin = i;
      });
      continue;
    }

    // Skip non-data rows
    if (!headerFound) continue;
    if (/number of calls|billable calls|header/i.test(joined)) continue;
    if (cells.length <= colRev) continue;

    const raw = (i: number) => cells[i] ?? '';
    const num = (i: number) => parseFloat(raw(i).replace(/[,$%]/g, '')) || 0;

    // Parse date — accept "MM/DD/YYYY", "YYYY-MM-DD", "Apr 18", etc.
    let dateStr = raw(colDate).trim();
    const mdyMatch = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    const isoMatch = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (mdyMatch)      dateStr = `${mdyMatch[3]}-${mdyMatch[1]}-${mdyMatch[2]}`;
    else if (isoMatch) dateStr = `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

    // Skip totals rows (they go into totals separately)
    const isTotal = /^total|^grand/i.test(dateStr) || /^total|^grand/i.test(raw(0));

    const revenue = num(colRev);
    const cost    = num(colCost);
    const profit  = colProfit < cells.length ? num(colProfit) : parseFloat((revenue - cost).toFixed(4));
    const margin  = colMargin < cells.length ? num(colMargin) : (revenue > 0 ? parseFloat(((profit / revenue) * 100).toFixed(2)) : 0);

    const row: PnlRow = {
      date:        dateStr,
      calls:       num(colCalls),
      durationSec: parsePnlDuration(raw(colDur)),
      revenue,
      cost,
      profit,
      margin,
    };

    if (isTotal) continue; // totals computed from rows
    if (row.calls === 0 && row.revenue === 0) continue; // skip empty rows
    rows.push(row);
  }

  // Compute totals from rows
  const totals: PnlRow = rows.length > 0 ? {
    date:        'Total',
    calls:       rows.reduce((s, r) => s + r.calls, 0),
    durationSec: rows.reduce((s, r) => s + r.durationSec, 0),
    revenue:     parseFloat(rows.reduce((s, r) => s + r.revenue, 0).toFixed(4)),
    cost:        parseFloat(rows.reduce((s, r) => s + r.cost, 0).toFixed(4)),
    profit:      parseFloat(rows.reduce((s, r) => s + r.profit, 0).toFixed(4)),
    margin:      0,
  } : { ...EMPTY_PNL_ROW };
  if (totals.revenue > 0) totals.margin = parseFloat(((totals.profit / totals.revenue) * 100).toFixed(2));

  if (rows.length === 0) return FAIL('P&L report parsed but no data rows found. The selected date range may have no traffic.');

  console.log(`[Sippy] scrapeProfitLossReport: ${rows.length} rows, revenue=$${totals.revenue}, profit=$${totals.profit}`);

  return {
    ok:        true,
    period:    `${start.toISOString().slice(0, 10)} → ${now.toISOString().slice(0, 10)}`,
    fetchedAt: new Date().toISOString(),
    rows,
    totals,
  };
}

// ── Per-call P&L CSV export ────────────────────────────────────────────────
//
// profit_loss_report.php with output=csv returns a per-call CSV (confirmed
// 16 columns: Connection, Account, CLI, CLD, Start Time, Setup Time,
// Duration, Buy Duration, Revenue, Cost, Profit, Margin, Result, PDD …).
// This is the financial truth layer — Sippy computes Revenue/Cost/Margin
// correctly, so we consume it rather than re-deriving it.

export interface PnlCsvRow {
  // Call identity
  cli:          string;
  cld:          string;
  startTime:    string;       // ISO or Sippy portal date string
  // Timing
  setupTimeSec: number;       // seconds until answer
  durationSec:  number;       // billed sell duration
  buyDurationSec: number;     // billed buy duration
  // Financials
  revenue:      number;       // USD — charged to customer
  cost:         number;       // USD — paid to vendor
  profit:       number;       // revenue − cost
  margin:       number;       // profit / revenue × 100  (%)
  // Context
  connection:   string;       // vendor connection name
  account:      string;       // customer account / name
  result:       string;       // disconnect reason / ANSWERED etc.
  pdd:          number;       // post-dial delay seconds
  // Raw catch-all for unknown extra columns
  extra:        Record<string, string>;
}

export interface PnlCsvReport {
  ok:           boolean;
  period:       string;
  fetchedAt:    string;
  rows:         PnlCsvRow[];
  probe:        { attempt: string; statusCode: number; bodyLen: number; contentType: string }[];
  error?:       string;
}

/** Proper CSV line parser that handles double-quoted fields with embedded commas. */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuote = !inQuote;
    } else if ((ch === ',' || ch === '\t') && !inQuote) {
      result.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur.trim());
  return result;
}

/**
 * Download the per-call P&L CSV from Sippy's profit_loss_report.php.
 *
 * Tries multiple POST param combinations in order. The first that returns
 * text/csv (or a body that looks like CSV with the right headers) wins.
 *
 * @param fromDate  Start of range (default: 1 day ago)
 * @param toDate    End of range   (default: now)
 */
export async function downloadPnlCsv(
  portalUsername: string,
  portalPassword: string,
  fallbackUsername?: string,
  fallbackPassword?: string,
  fromDate?: Date,
  toDate?: Date,
  portalUrl?: string,
): Promise<PnlCsvReport> {
  const now   = toDate   ?? new Date();
  const start = fromDate ?? new Date(now.getTime() - 1 * 24 * 60 * 60_000);
  const FAIL  = (error: string, probe: PnlCsvReport['probe'] = []): PnlCsvReport => ({
    ok: false, period: '', fetchedAt: new Date().toISOString(), rows: [], probe, error,
  });

  const base = portalUrl ?? activeSession?.portalUrl;
  if (!base) return FAIL('Not connected to Sippy.');

  // Authenticate — admin session preferred for full data
  let cookies = await getAdminPortalSession(
    base,
    fallbackUsername ?? '', fallbackPassword ?? '',
    portalUsername, portalPassword,
  );
  if (!cookies) {
    cookies = await getAnyPortalSession(base, [portalUsername, portalPassword]);
    if (!cookies) return FAIL('Portal login failed for P&L CSV download.');
  }

  const startStr = formatSippyPortalDate(start);
  const endStr   = formatSippyPortalDate(now);

  // Attempt matrix — ordered by most-likely to work.
  // Each entry is a label + the POST body params to try.
  const attempts: Array<{ label: string; params: Record<string, string> }> = [
    {
      label: 'output=csv period=cdr',
      params: { startDate: startStr, endDate: endStr, from_form: '1', action: 'update', cdr_currency: 'USD', period: 'cdr', output: 'csv' },
    },
    {
      label: 'output=csv period=call',
      params: { startDate: startStr, endDate: endStr, from_form: '1', action: 'update', cdr_currency: 'USD', period: 'call', output: 'csv' },
    },
    {
      label: 'output=csv (no period)',
      params: { startDate: startStr, endDate: endStr, from_form: '1', action: 'update', cdr_currency: 'USD', output: 'csv' },
    },
    {
      label: 'output=csv period=day',
      params: { startDate: startStr, endDate: endStr, from_form: '1', action: 'update', cdr_currency: 'USD', period: 'day', output: 'csv' },
    },
    {
      label: 'action=export period=cdr',
      params: { startDate: startStr, endDate: endStr, from_form: '1', action: 'export', cdr_currency: 'USD', period: 'cdr' },
    },
    {
      label: 'action=export (no period)',
      params: { startDate: startStr, endDate: endStr, from_form: '1', action: 'export', cdr_currency: 'USD' },
    },
  ];

  const paths       = ['/profit_loss_report.php', '/c1/profit_loss_report.php'];
  const probeLog: PnlCsvReport['probe'] = [];
  let csvBody = '';
  let winLabel = '';

  outer:
  for (const attempt of attempts) {
    for (const path of paths) {
      let statusCode = 0;
      let body       = '';
      let contentType = '';
      try {
        const resp = await rawRequest(
          'POST',
          `${base}${path}`,
          encodeForm(attempt.params),
          { 'Content-Type': 'application/x-www-form-urlencoded' },
          cookies,
        );
        statusCode  = resp.statusCode;
        body        = typeof resp.body === 'string' ? resp.body : resp.body?.toString() ?? '';
        contentType = (resp as any).headers?.['content-type'] ?? '';
      } catch (e: any) {
        probeLog.push({ attempt: `${attempt.label} @ ${path}`, statusCode: 0, bodyLen: 0, contentType: '' });
        console.warn(`[pnl-csv] ${attempt.label} @ ${path} — exception: ${e.message}`);
        continue;
      }

      const looksLikeCsv =
        contentType.includes('text/csv') ||
        contentType.includes('application/csv') ||
        contentType.includes('octet-stream') ||
        (body.length > 100 && !body.trimStart().startsWith('<') && body.includes(','));

      probeLog.push({ attempt: `${attempt.label} @ ${path}`, statusCode, bodyLen: body.length, contentType });
      console.log(`[pnl-csv] ${attempt.label} @ ${path} → HTTP ${statusCode} contentType="${contentType}" bodyLen=${body.length} looksLikeCsv=${looksLikeCsv}`);

      if (statusCode === 200 && looksLikeCsv && body.length > 50) {
        csvBody  = body;
        winLabel = `${attempt.label} @ ${path}`;
        break outer;
      }
    }
  }

  if (!csvBody) {
    console.warn('[pnl-csv] all attempts failed — no CSV body found');
    return FAIL('All download attempts failed — no CSV data returned by Sippy portal.', probeLog);
  }

  console.log(`[pnl-csv] won with: ${winLabel} (${csvBody.length} bytes)`);

  // ── Parse the CSV ─────────────────────────────────────────────────────────
  const lines = csvBody.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) {
    return FAIL(`CSV too short (${lines.length} line(s)) — no data rows.`, probeLog);
  }

  // Build header index
  const headerLine = parseCsvLine(lines[0]);
  const idx = (keywords: string[]): number => {
    for (const kw of keywords) {
      const i = headerLine.findIndex(h => h.toLowerCase().includes(kw.toLowerCase()));
      if (i >= 0) return i;
    }
    return -1;
  };

  const iCli       = idx(['cli', 'caller', 'from']);
  const iCld       = idx(['cld', 'callee', 'to', 'destination', 'dialed']);
  const iStart     = idx(['start', 'date', 'time']);
  const iSetup     = idx(['setup']);
  const iDuration  = idx(['duration', 'sell dur', 'billed dur', 'dur']);
  const iBuyDur    = idx(['buy dur', 'cost dur', 'vendor dur', 'buying']);
  const iRevenue   = idx(['revenue', 'sell', 'charge']);
  const iCost      = idx(['cost', 'buy', 'vendor amount', 'wholesale']);
  const iProfit    = idx(['profit', 'net', 'margin amount']);
  const iMarginPct = idx(['margin', '%']);
  const iConn      = idx(['connection', 'vendor', 'carrier', 'route']);
  const iAccount   = idx(['account', 'customer', 'client']);
  const iResult    = idx(['result', 'disconnect', 'cause', 'status']);
  const iPdd       = idx(['pdd', 'post dial', 'ring']);

  console.log(`[pnl-csv] header columns (${headerLine.length}):`, headerLine.join(' | '));
  console.log(`[pnl-csv] mapped: cli=${iCli} cld=${iCld} start=${iStart} setup=${iSetup} dur=${iDuration} buyDur=${iBuyDur} rev=${iRevenue} cost=${iCost} profit=${iProfit} margin=${iMarginPct} conn=${iConn} acct=${iAccount} result=${iResult} pdd=${iPdd}`);

  const rows: PnlCsvRow[] = [];
  for (let li = 1; li < lines.length; li++) {
    const cols = parseCsvLine(lines[li]);
    if (cols.length < 3) continue;

    const str  = (i: number) => (i >= 0 && i < cols.length ? cols[i] : '');
    const num  = (i: number) => parseFloat(str(i).replace(/[$,%]/g, '')) || 0;
    const dur  = (i: number): number => {
      const s = str(i);
      if (!s) return 0;
      const parts = s.split(':').map(Number);
      if (parts.length === 3) return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
      if (parts.length === 2) return (parts[0] || 0) * 60 + (parts[1] || 0);
      return parseFloat(s) || 0;
    };

    // Build extra columns map for future use
    const extra: Record<string, string> = {};
    cols.forEach((v, i) => {
      if (![iCli, iCld, iStart, iSetup, iDuration, iBuyDur, iRevenue, iCost, iProfit, iMarginPct, iConn, iAccount, iResult, iPdd].includes(i)) {
        extra[headerLine[i] || `col${i}`] = v;
      }
    });

    const revenue = num(iRevenue);
    const cost    = num(iCost);
    const profit  = iProfit >= 0 ? num(iProfit) : parseFloat((revenue - cost).toFixed(6));
    const margin  = iMarginPct >= 0 ? num(iMarginPct) : (revenue > 0 ? parseFloat(((profit / revenue) * 100).toFixed(2)) : 0);

    rows.push({
      cli:            str(iCli),
      cld:            str(iCld),
      startTime:      str(iStart),
      setupTimeSec:   iSetup >= 0 ? dur(iSetup) : 0,
      durationSec:    dur(iDuration),
      buyDurationSec: iBuyDur >= 0 ? dur(iBuyDur) : 0,
      revenue,
      cost,
      profit,
      margin,
      connection:     str(iConn),
      account:        str(iAccount),
      result:         str(iResult),
      pdd:            num(iPdd),
      extra,
    });
  }

  console.log(`[pnl-csv] parsed ${rows.length} per-call rows via "${winLabel}"`);

  return {
    ok:        true,
    period:    `${start.toISOString().slice(0, 10)} → ${now.toISOString().slice(0, 10)}`,
    fetchedAt: new Date().toISOString(),
    rows,
    probe:     probeLog,
  };
}

// ── Per-call P&L HTML scraper ─────────────────────────────────────────────
//
// profit_loss_report.php with period=call returns HTML (not CSV) on this Sippy
// version. This function fetches that HTML and parses the per-call table, returning
// rows as SippyCDR objects so they can be used in CDR matching.
//
// Known column order from Sippy's CSV export (same columns appear in HTML):
//   Connection | Account | CLI | CLD | Start Time | Setup Time | Duration |
//   Buy Duration | Revenue | Cost | Profit | Margin | Result | PDD
//
// Column detection is flexible — we look for header keywords so we survive
// any Sippy version that reorders or adds/removes columns.
export async function scrapePnlCallRows(
  portalUsername: string,
  portalPassword: string,
  opts: {
    fromMins?:    number;   // default 120 — used when startDate/endDate not provided
    maxRows?:     number;   // default 600 — max rows to parse from HTML
    portalUrl?:   string;   // if absent, uses activeSession
    fallbackUser?: string;
    fallbackPass?: string;
    startDate?:   Date;     // explicit start date (overrides fromMins)
    endDate?:     Date;     // explicit end date (overrides "now")
    offset?:      number;   // row offset for pagination (n= param, 0-based, step 50)
    _cookies?:    any;      // reuse existing portal cookies (skips re-login)
  } = {},
): Promise<SippyCDR[]> {
  const fromMins = opts.fromMins ?? 120;
  const maxRows  = opts.maxRows  ?? 600;
  const base     = opts.portalUrl ?? activeSession?.portalUrl;
  if (!base) {
    console.warn('[scrapePnlCallRows] no portal URL');
    return [];
  }

  // ── Auth ─────────────────────────────────────────────────────────────────
  let cookies = opts._cookies ?? null;
  if (!cookies) {
    cookies = await getAdminPortalSession(
      base,
      opts.fallbackUser ?? '', opts.fallbackPass ?? '',
      portalUsername, portalPassword,
    );
    if (!cookies) {
      cookies = await getAnyPortalSession(base, [portalUsername, portalPassword]);
      if (!cookies) {
        console.warn('[scrapePnlCallRows] portal login failed');
        return [];
      }
    }
  }

  // ── Fetch ────────────────────────────────────────────────────────────────
  const now  = opts.endDate   ?? new Date();
  const from = opts.startDate ?? new Date(now.getTime() - fromMins * 60_000);
  const formParams: Record<string,string> = {
    startDate:    formatSippyPortalDate(from),
    endDate:      formatSippyPortalDate(now),
    from_form:    '1',
    action:       'update',
    cdr_currency: 'USD',
    period:       'call',
  };
  if (opts.offset && opts.offset > 0) formParams.n = String(opts.offset);
  const body = encodeForm(formParams);

  let html = '';
  for (const path of ['/profit_loss_report.php', '/c1/profit_loss_report.php']) {
    try {
      const resp = await rawRequest(
        'POST', `${base}${path}`, body,
        { 'Content-Type': 'application/x-www-form-urlencoded' },
        cookies,
      );
      const text = typeof resp.body === 'string' ? resp.body : resp.body?.toString() ?? '';
      if (resp.statusCode === 200 && text.length > 500) {
        html = text;
        break;
      }
    } catch { /* try next path */ }
  }

  if (!html) {
    console.warn('[scrapePnlCallRows] empty response from profit_loss_report.php');
    return [];
  }

  // ── Parse HTML table ─────────────────────────────────────────────────────
  // Use the same regex pattern as the per-day scraper.
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;

  let iCli = -1, iCld = -1, iTime = -1, iSetup = -1, iDur = -1, iBuyDur = -1;
  let iRev = -1, iCost = -1, iConn = -1, iAcct = -1, iResult = -1;
  let headerFound = false;
  const cdrs: SippyCDR[] = [];
  let rowIdx = 0;

  const MONTHS: Record<string, string> = {
    Jan:'01', Feb:'02', Mar:'03', Apr:'04', May:'05', Jun:'06',
    Jul:'07', Aug:'08', Sep:'09', Oct:'10', Nov:'11', Dec:'12',
  };

  while ((m = trRe.exec(html)) !== null && rowIdx < maxRows) {
    const rowHtml = m[1];
    const tdRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    const cells: string[] = [];
    let td: RegExpExecArray | null;
    while ((td = tdRe.exec(rowHtml)) !== null) {
      cells.push(td[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim());
    }
    if (cells.length < 4) continue;

    const joined = cells.join('|').toLowerCase();

    // ── Detect header row ─────────────────────────────────────────────────
    if (!headerFound && (joined.includes('cli') || joined.includes('cld') || joined.includes('caller'))) {
      headerFound = true;
      cells.forEach((c, i) => {
        const lc = c.toLowerCase().replace(/\s+/g, ' ').trim();
        if      (/^cli$|^caller$|^from$/.test(lc))                            iCli    = i;
        else if (/^cld$|^callee$|^to$|^destination$|^called/.test(lc))       iCld    = i;
        else if (/start.?time|connect.?time/.test(lc) || lc === 'date')       iTime   = i;
        else if (/setup.?time|setup.?dur/.test(lc))                           iSetup  = i;
        else if (/sell.?dur|billed.?dur|^duration$/.test(lc))                 iDur    = i;
        else if (/buy.?dur|cost.?dur|vendor.?dur/.test(lc))                   iBuyDur = i;
        else if (/^revenue$|^sell.?amount$/.test(lc))                         iRev    = i;
        else if (/^cost$|^buy.?amount$|^vendor.?amount$/.test(lc))            iCost   = i;
        else if (/connection|vendor.?name|carrier/.test(lc))                  iConn   = i;
        else if (/^account$|^customer$|^client$/.test(lc))                    iAcct   = i;
        else if (/^result$|disconnect|cause/.test(lc))                        iResult = i;
      });
      // Broader fallback for tricky column labels
      if (iCli   < 0) iCli   = cells.findIndex(c => /\bcli\b/i.test(c));
      if (iCld   < 0) iCld   = cells.findIndex(c => /\bcld\b/i.test(c));
      if (iTime  < 0) iTime  = cells.findIndex(c => /start|time/i.test(c));
      if (iDur   < 0) iDur   = cells.findIndex(c => /\bdur/i.test(c));
      if (iCost  < 0) iCost  = cells.findIndex(c => /cost/i.test(c));
      if (iRev   < 0) iRev   = cells.findIndex(c => /rev/i.test(c));
      // If still no CLI/CLD, assume known column order:
      // Connection(0) | Account(1) | CLI(2) | CLD(3) | Start Time(4) | Setup(5) | Dur(6) | BuyDur(7) | Rev(8) | Cost(9)
      if (iCli < 0 && cells.length >= 10) iCli    = 2;
      if (iCld < 0 && cells.length >= 10) iCld    = 3;
      if (iTime < 0 && cells.length >= 10) iTime  = 4;
      if (iSetup < 0 && cells.length >= 10) iSetup = 5;
      if (iDur < 0 && cells.length >= 10)  iDur   = 6;
      if (iBuyDur < 0 && cells.length >= 10) iBuyDur = 7;
      if (iRev < 0 && cells.length >= 10)  iRev   = 8;
      if (iCost < 0 && cells.length >= 10) iCost  = 9;
      if (iConn < 0 && cells.length >= 10) iConn  = 0;
      if (iAcct < 0 && cells.length >= 10) iAcct  = 1;
      console.log(`[scrapePnlCallRows] header detected: cli=${iCli} cld=${iCld} time=${iTime} dur=${iDur} cost=${iCost} rev=${iRev} | cols=[${cells.slice(0,12).join('|')}]`);
      continue;
    }

    if (!headerFound) continue;

    // Skip totals/summary rows
    if (/^total|^grand|^subtotal/i.test(joined)) continue;

    const cell    = (i: number) => (i >= 0 && i < cells.length ? cells[i] : '');
    const numCell = (i: number) => parseFloat(cell(i).replace(/[$,%\s]/g, '')) || 0;

    const cli = cell(iCli).replace(/\s/g, '');
    const cld = cell(iCld).replace(/\s/g, '');
    if (!cli && !cld) continue;

    // Parse timestamp — handle: "MM/DD/YYYY HH:MM:SS", "DD Mon YYYY HH:MM:SS", ISO
    const timeStr = cell(iTime);
    let startTime = timeStr;
    const dtSlash = timeStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{2}:\d{2}:\d{2})/);
    const dtMon   = timeStr.match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+(\d{2}:\d{2}:\d{2})/);
    const dtIso   = timeStr.match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}:\d{2}:\d{2})/);
    if (dtSlash)      startTime = `${dtSlash[3]}-${dtSlash[1].padStart(2,'0')}-${dtSlash[2].padStart(2,'0')}T${dtSlash[4]}Z`;
    else if (dtMon)   startTime = `${dtMon[3]}-${MONTHS[dtMon[2]] ?? '01'}-${dtMon[1].padStart(2,'0')}T${dtMon[4]}Z`;
    else if (dtIso)   startTime = `${dtIso[1]}-${dtIso[2]}-${dtIso[3]}T${dtIso[4]}Z`;

    // P3.1: cost = Revenue column (customer billing, consistent with portal CDR naming)
    //        vendorCost = Cost column (what we pay the vendor — was not extracted before)
    cdrs.push({
      callId:        `pnl-html-${rowIdx}`,
      caller:        cli.replace(/\D/g, ''),
      callee:        cld.replace(/\D/g, ''),
      startTime,
      duration:      parsePnlDuration(cell(iDur)),
      totalDuration: parsePnlDuration(cell(iDur)),
      cost:          numCell(iRev),       // Revenue, USD → customer billing (cdrCost)
      vendorCost:    numCell(iCost),      // Cost, USD    → vendor buying cost (cdrVendorCost)
      vendorName:    cell(iConn) || undefined,
      description:   cell(iAcct) || undefined,
    } as any);

    rowIdx++;
  }

  console.log(`[scrapePnlCallRows] parsed ${cdrs.length} per-call rows from P&L HTML (headerFound=${headerFound} cli=${iCli} cld=${iCld})`);
  return cdrs;
}

// ── Targeted per-call P&L CDR lookup ──────────────────────────────────────────
//
// Finds the Sippy CDR for a specific governed call using the P&L report.
// Uses a narrow date window (callStart → callStart+windowMin) so each fetch
// only covers a short time period, and paginates until the CLD suffix is found.
//
// Called from Track 2b in routes-call-governance.ts ONLY on retries (call >= 3 min
// old) to allow Sippy's CDR write delay before querying the P&L.
export async function scrapePnlCdrForCall(
  portalUsername: string,
  portalPassword: string,
  callStartMs:    number,   // governed call start time (ms)
  destSuffix10:   string,   // last 10 digits of destination number
  portalUrl:      string,
  opts: {
    maxPages?:      number; // max pages to paginate (default 12)
    windowMinutes?: number; // date window after callStart (default 10)
  } = {},
): Promise<SippyCDR[]> {
  const maxPages     = opts.maxPages      ?? 12;
  const windowMin    = opts.windowMinutes ?? 10;

  // Login once and reuse cookies across pages
  const base = portalUrl;
  let cookies = await getAdminPortalSession(base, '', '', portalUsername, portalPassword);
  if (!cookies) cookies = await getAnyPortalSession(base, [portalUsername, portalPassword]);
  if (!cookies) {
    console.warn('[scrapePnlCdrForCall] portal login failed');
    return [];
  }

  const startDate = new Date(callStartMs - 90_000);                      // 90s before call
  const endDate   = new Date(callStartMs + windowMin * 60_000);

  const allCdrs: SippyCDR[] = [];
  let totalFetched = 0;

  for (let page = 0; page < maxPages; page++) {
    const offset = page * 50;
    const rows = await scrapePnlCallRows(portalUsername, portalPassword, {
      startDate,
      endDate,
      offset,
      maxRows: 60,
      portalUrl: base,
      _cookies: cookies,
    });

    if (rows.length === 0) {
      console.log(`[scrapePnlCdrForCall] page ${page}: 0 rows — end of pages`);
      break;
    }

    totalFetched += rows.length;
    allCdrs.push(...rows);

    // Early exit: found a CLD suffix match
    const match = rows.find(c => (c.callee || '').replace(/\D/g,'').endsWith(destSuffix10));
    if (match) {
      console.log(`[scrapePnlCdrForCall] destSuffix=${destSuffix10} FOUND on page ${page}: CLD=${match.callee} t=${match.startTime} rev(cust)=${match.cost} vendorCost=${(match as any).vendorCost ?? '—'}`);
      break;
    }

    // Early exit: all rows in this page are from BEFORE the call's start window
    const allPast = rows.every(c => {
      if (!c.startTime) return false;
      return new Date(c.startTime).getTime() < callStartMs - 5 * 60_000;
    });
    if (allPast) {
      console.log(`[scrapePnlCdrForCall] page ${page}: all rows before call window, stopping`);
      break;
    }

    console.log(`[scrapePnlCdrForCall] page ${page}: ${rows.length} rows, no suffix match yet (total=${totalFetched})`);
  }

  console.log(`[scrapePnlCdrForCall] done: ${allCdrs.length} rows across pages, suffix=${destSuffix10}`);
  return allCdrs;
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

/**
 * Extracts the human-readable fault message from a Sippy XML-RPC fault response.
 * Sippy wraps faultString inside a struct member, not a direct <faultString> tag:
 *   <fault><value><struct><member><name>faultString</name><value><string>...</string></value></member>...
 * Falls back to a direct <faultString> tag for other XML-RPC implementations.
 */
function extractFaultString(xml: string): string | null {
  const faultSection = extractTag(xml, 'fault');
  if (faultSection) {
    const members = extractStructMembers(faultSection);
    if (members['faultString']) return members['faultString'];
    if (members['faultCode'])   return `Fault code ${members['faultCode']}`;
  }
  return extractTag(xml, 'faultString');
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

// ── parseArrayOfStructs — parse XML-RPC array-of-structs ─────────────────────
// Used by listSippyCustomers and other functions that receive an XML-RPC
// <array><data><value><struct>…</struct></value>…</data></array> response.
function parseArrayOfStructs(arrayXml: string): Record<string, string>[] {
  const results: Record<string, string>[] = [];
  const re = /<struct>([\s\S]*?)<\/struct>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(arrayXml)) !== null) {
    results.push(extractStructMembers(m[1]));
  }
  return results;
}

// ── Connection Test ───────────────────────────────────────────────────────────

export async function testSippyConnection(
  portalUrl: string,
  username: string,
  password: string,
  webPassword?: string,   // optional: separate web-portal login password (may differ from XML-RPC API password)
): Promise<{ reachable: boolean; authenticated: boolean; message: string; latencyMs?: number; mode?: 'xmlrpc' | 'portal'; cookies?: CookieJar }> {
  const base = sippyBase(portalUrl);
  const start = Date.now();

  // Try standard XML-RPC path first (uses API password, NOT web portal password)
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
  // Use webPassword if provided (Sippy has separate API password vs web portal password).
  // Try all three account types — some Sippy installs only accept 'admin' login via HTTPS.
  const loginPass = webPassword || password;
  for (const acctType of ['customer', 'reseller', 'admin'] as const) {
    const loginResult = await portalLogin(base, username, loginPass, acctType);
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

// ── listAvailableMethods — enumerate all XML-RPC methods on this Sippy ───────
export async function listAvailableMethods(
  username: string,
  password: string,
  portalUrl: string,
): Promise<{ methods: string[]; error?: string }> {
  try {
    const apiUrl = `${sippyBase(portalUrl)}/xmlapi/xmlapi`;
    const resp = await sippyPost(apiUrl, xmlRpcCall('i_version.listAvailableMethods'), username, password);
    if (resp.statusCode === 401 || resp.statusCode === 403) {
      return { methods: [], error: `HTTP ${resp.statusCode} — authentication failed` };
    }
    // Extract all <string> values from the response
    const matches = resp.body.match(/<string>([^<]+)<\/string>/g) ?? [];
    const methods = matches.map((m: string) => m.replace(/<\/?string>/g, '').trim()).filter(Boolean);
    return { methods };
  } catch (err: any) {
    return { methods: [], error: err.message };
  }
}

// ── Login (connect and store session) ────────────────────────────────────────

export async function connectSippy(
  portalUrl: string,
  username: string,
  password: string,
  webPassword?: string,   // optional separate web-portal login password (Sippy API vs web login differ)
): Promise<{ success: boolean; message: string }> {
  const result = await testSippyConnection(portalUrl, username, password, webPassword);
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
  iVendorId?: string;     // i_vendor numeric ID (extracted from vendor link in HTML scraping)
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
  fallbackUsername?: string,   // alternate cred pair for admin portal login (handles DB swap)
  fallbackPassword?: string,
  noNewLogin?: boolean,        // when true: never attempt a fresh portal login (avoids 48s timeout in polling routes)
  adminWebPassword?: string,   // separate web-UI password when it differs from the XML-RPC API password
): Promise<SippyActiveCall[]> {
  const base = explicitPortalUrl ? sippyBase(explicitPortalUrl) : activeSession?.portalUrl;
  if (!base) return [];

  // ── Portal session mode (web scraping fallback) ───────────────────────────
  const session = activeSession;

  // Short-circuit: when credentials are intentionally omitted (e.g. circuit-breaker
  // bypass from the live-calls polling route), skip XML-RPC entirely and go straight
  // to portal scraping. This eliminates the 4-second timeout overhead.
  if (!username) {
    // Reuse existing session cookies when available — fastest path, no network overhead.
    if (session?.cookies) {
      console.log('[Sippy] listActiveCalls: circuit bypass — scraping /activecalls.php (active session)');
      return getPortalActiveCallsHtml(session.cookies, base);
    }
    // No session: fall through to tryAdminPortalScrape() which handles
    // getAnyPortalSession() with 5-min caching (noNewLogin controls fresh login).
    return tryAdminPortalScrape();
  }

  // Explicit credentials were provided: try XML-RPC first; fall back to portal.
  // Portal-mode flag means the *connection-test* (listAvailableMethods) was blocked;
  // listActiveCalls may still work for the same credential pair.
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

  // ── Admin portal scrape — fallback when XML-RPC is auth-rejected ────────────
  // Priority: (1) reuse the already-established activeSession cookies so we never
  // trigger a fresh login on every poll — Sippy rate-limits rapid logins.
  // (2) fall back to getAnyPortalSession() (cached 5-min TTL) — but ONLY when
  //     noNewLogin is false (e.g. one-off calls, not the high-frequency poll route).
  async function tryAdminPortalScrape(): Promise<SippyActiveCall[]> {
    // Always prefer the established active-session cookies.
    if (session?.cookies) {
      console.log('[Sippy] listActiveCalls: XML-RPC restricted — scraping /activecalls.php (active session)');
      const calls = await getPortalActiveCallsHtml(session.cookies, base);
      if (calls.length > 0) return calls;
      // If we got zero here AND noNewLogin is set, stop — never attempt a re-login.
      if (noNewLogin) {
        console.log('[Sippy] listActiveCalls: session returned 0 but noNewLogin set — returning empty');
        return [];
      }
      // Otherwise fall through to re-login (session may have expired).
    }
    // Stop here if caller opted out of fresh logins (avoids 48s timeout in polling route).
    if (noNewLogin) {
      console.log('[Sippy] listActiveCalls: no active session + noNewLogin set — returning empty');
      return [];
    }
    const pairs: Array<[string, string]> = [];
    if (username && password) pairs.push([username, password]);
    // If adminWebPassword is provided and differs from the XML-RPC password,
    // add it as a credential pair — web-UI login often uses a different password.
    if (username && adminWebPassword && adminWebPassword !== password)
      pairs.push([username, adminWebPassword]);
    if (fallbackUsername && fallbackPassword && fallbackUsername !== username)
      pairs.push([fallbackUsername, fallbackPassword]);
    if (fallbackUsername && adminWebPassword && adminWebPassword !== fallbackPassword)
      pairs.push([fallbackUsername, adminWebPassword]);
    const cookies = await getAnyPortalSession(base, ...pairs);
    if (!cookies) {
      console.log('[Sippy] listActiveCalls: admin portal login failed, returning empty list');
      return [];
    }
    console.log('[Sippy] listActiveCalls: XML-RPC restricted — scraping /activecalls.php (fresh session)');
    return getPortalActiveCallsHtml(cookies, base);
  }

  // Official methods: listActiveCalls (Connected/ARComplete/WaitRoute only) | listAllCalls (all states fallback)
  // Prefer listActiveCalls to avoid including Dead/Disconnecting/terminated calls in the live view.
  // noNewLogin (polling) mode uses a 4-second timeout so the live-calls endpoint
  // never blocks >5s between polls. Normal calls keep the 12-second default.
  const xmlRpcTimeout = noNewLogin ? 4000 : 12000;

  for (const method of ['listActiveCalls', 'listAllCalls']) {
    try {
      let resp = await sippyPost(apiUrl, xmlRpcCall(method, reqParams), username, password, xmlRpcTimeout);

      // HTTP auth rejection — try fallback credentials then portal scrape
      if (resp.statusCode === 401 || resp.statusCode === 403) {
        if (fallbackUsername && fallbackPassword && fallbackUsername !== username) {
          const fb = await sippyPost(apiUrl, xmlRpcCall(method, reqParams), fallbackUsername, fallbackPassword, xmlRpcTimeout);
          if (fb.statusCode === 200) {
            resp = fb;
          } else {
            return tryAdminPortalScrape();
          }
        } else {
          return tryAdminPortalScrape();
        }
      }

      if (resp.statusCode !== 200) continue;

      const structs = extractAllTags(resp.body, 'struct');
      const calls: SippyActiveCall[] = [];

      for (const s of structs) {
        const m = extractStructMembers(s);
        const id     = m['ID']        || undefined;
        const callId = m['CALL_ID']   || m['call_id']   || m['CallID'] || '-';
        const cli    = m['CLI']       || m['cli']       || m['from']   || m['caller'];
        const cld    = m['CLD']       || m['cld']       || m['to']     || m['callee'];
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
      console.log(`[Sippy] ${method} returned ${calls.length} active calls (XML-RPC, user=${username})`);
      return calls;
    } catch {
      // Connection-level error (ECONNRESET, timeout) — stop XML-RPC attempts immediately
      // and fall through to portal scraping rather than trying the next method.
      break;
    }
  }
  // XML-RPC failed entirely — try portal scraping as the reliable fallback
  return tryAdminPortalScrape();
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
    const fault = extractFaultString(text);
    return { success: false, message: fault?.replace(/<[^>]+>/g, '').trim() || 'Disconnect failed.' };
  } catch (err: any) {
    return { success: false, message: err.message };
  }
}

// ── makeCall() — originates a test/click-to-call via Sippy XML-RPC ───────────
// CLI = caller ID (from number), CLD = called number (to number).
// i_account: optional billing account ID.
// Returns { success, callId?, message, errorType? } where errorType is:
//   'auth_failed'      — credentials rejected (HTTP 401/403)
//   'method_not_found' — no call origination method available on this switch
//   'call_error'       — call was rejected for routing/credit/other reason
export async function makeCall(
  cli: string,
  cld: string,
  opts: { iAccount?: number; billingCode?: string } = {},
  username: string = '',
  password: string = '',
  explicitPortalUrl?: string,
): Promise<{ success: boolean; callId?: string; message: string; errorType?: string; apiUser?: string }> {
  const sess = activeSession;
  const base = explicitPortalUrl ? sippyBase(explicitPortalUrl) : sess?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.', errorType: 'not_connected' };

  const u = username || sess?.adminUsername || '';
  const p = password || sess?.adminPassword || '';
  const apiUrl = `${base}/xmlapi/xmlapi`;

  const params: Record<string, string | number | boolean | null> = {
    CLI: cli.trim(),
    CLD: cld.trim(),
  };
  if (opts.iAccount)    params.i_account    = opts.iAccount;
  if (opts.billingCode) params.billing_code = opts.billingCode;

  // Try method names in order of preference across Sippy versions / builds:
  // 1. call_control.makeCall  — namespaced, Sippy 4.x+
  // 2. makeCall               — legacy bare name
  // 3. make_call              — snake_case variant used in some distributions
  // 4. originate              — used in some custom Sippy forks
  const methodsToTry = ['call_control.makeCall', 'makeCall', 'make_call', 'originate'];
  let methodsNotFound = 0;

  for (const method of methodsToTry) {
    try {
      const resp = await sippyPost(apiUrl, xmlRpcCall(method, params), u, p);
      const text = resp.body;
      console.log(`[Sippy] ${method}(${cli}→${cld}) HTTP ${resp.statusCode}: ${text.slice(0, 400)}`);

      if (resp.statusCode === 401) {
        return {
          success: false,
          message: `XML-RPC authentication failed for user "${u}" (HTTP 401). The stored API credentials may be incorrect — update apiAdminPassword in Settings or verify credentials in Sippy admin.`,
          errorType: 'auth_failed',
          apiUser: u,
        };
      }

      if (resp.statusCode === 200 && !text.includes('<fault>')) {
        const callId = extractTag(text, 'string') || extractTag(text, 'int') || extractTag(text, 'i4') || 'unknown';
        return { success: true, callId, message: `Call initiated via ${method} — ID: ${callId}` };
      }

      // HTTP 500 with non-XML body = method crashes the XML-RPC handler (module not installed/enabled)
      // Treat as "not available" and try the next method name rather than stopping
      if (resp.statusCode >= 500 && !text.includes('<?xml') && !text.includes('<methodResponse>')) {
        console.log(`[Sippy] ${method} returned HTTP ${resp.statusCode} (non-XML body) — module not enabled, trying next…`);
        methodsNotFound++;
        continue;
      }

      const fault = extractFaultString(text);
      const faultMsg = fault?.replace(/<[^>]+>/g, '').trim() || '';

      // If method not found, try the next one in the list.
      // Sippy returns several different strings for "unknown method" depending on version:
      //   "we do not have a method with that name" (Sippy 5.x portal response)
      //   "No such method" / "Method not found" (XML-RPC spec)
      //   "Unknown method"
      const fm = faultMsg.toLowerCase();
      if (
        fm.includes('not found') ||
        fm.includes('no such method') ||
        fm.includes('unknown method') ||
        fm.includes('do not have a method') ||
        fm.includes('with that name') ||
        fm.includes('method does not exist') ||
        fm.includes('not implemented')
      ) {
        console.log(`[Sippy] ${method} not available (${faultMsg}), trying next…`);
        methodsNotFound++;
        continue;
      }

      // Any other XML-RPC fault (routing, credit, permissions, etc.) — return immediately
      return { success: false, message: faultMsg || `HTTP ${resp.statusCode}`, errorType: 'call_error', apiUser: u };
    } catch (err: any) {
      return { success: false, message: err.message, errorType: 'call_error', apiUser: u };
    }
  }

  return {
    success: false,
    errorType: 'method_not_found',
    apiUser: u,
    message:
      `Call origination is not available via XML-RPC on this Sippy switch (all ${methodsNotFound} method names returned server errors). ` +
      `To enable it: in Sippy Admin go to System → Administrators → ${u} → API Access tab and enable "Allow XML-RPC call origination". ` +
      `If the option is missing, the Call Origination or Callback module may need to be activated at the system level (System → Applications).`,
  };
}

// ── testSippyConnectivity() — lightweight non-call probe to detect Sippy availability
// Uses system.listMethods (a read-only, zero-cost XML-RPC introspection call) to check
// if the Sippy XML-RPC endpoint is reachable and responding to requests.
// Returns true if Sippy responded (even with an auth error — it's still reachable);
// returns false only when a TCP/TLS connection failure or hard timeout occurs.
export async function testSippyConnectivity(
  username: string,
  password: string,
  explicitPortalUrl?: string,
): Promise<boolean> {
  const base = explicitPortalUrl ? sippyBase(explicitPortalUrl) : activeSession?.portalUrl;
  if (!base) return false;
  const apiUrl = `${base}/xmlapi/xmlapi`;
  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('system.listMethods', {}), username, password, 5000);
    // Any HTTP response (even 401/403/500) means Sippy is reachable at the network level.
    return resp.statusCode > 0;
  } catch {
    return false;
  }
}

// ── makeTestCall() — initiates a proactive route test call and measures metrics
// Calls makeCall then polls listActiveCalls XML-RPC to detect connect/disconnect,
// giving real ACD (duration) and PDD measurements for route quality monitoring.
//
// Parameters: username, password, { cld, cli, maxDuration (sec) }, portalUrl
// Returns: { connected, sipCode, duration (sec), pdd (ms) } | null on error
export async function makeTestCall(
  username: string,
  password: string,
  opts: { cld: string; cli?: string; maxDuration?: number; iAccount?: number; billingCode?: string },
  explicitPortalUrl?: string,
): Promise<{ connected: boolean; sipCode?: number; duration?: number; pdd?: number; actualVendorName?: string; actualVendorId?: string; callId?: string } | null> {
  const cli           = opts.cli ?? '100';
  const cld           = opts.cld;
  const maxDuration   = opts.maxDuration ?? 10; // seconds
  const portalUrl     = explicitPortalUrl;

  const initMs = Date.now();

  // 1. Initiate the call
  let callId: string | undefined;
  try {
    const callOpts = {
      ...(opts.iAccount   ? { iAccount:    opts.iAccount   } : {}),
      ...(opts.billingCode ? { billingCode: opts.billingCode } : {}),
    };
    const initResult = await makeCall(cli, cld, callOpts, username, password, portalUrl);
    if (!initResult.success) {
      const sipCode = initResult.errorType === 'auth_failed' ? 401
        : initResult.errorType === 'method_not_found' ? 501
        : 503;
      return { connected: false, sipCode, pdd: Math.round(Date.now() - initMs) };
    }
    callId = initResult.callId;
  } catch {
    return null;
  }

  const base   = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  const apiUrl = base ? `${base}/xmlapi/xmlapi` : null;

  // 2. Poll listActiveCalls XML-RPC (lightweight — no portal scraping) to track call lifecycle.
  //    We look for our callId in active calls to measure PDD and ACD.
  //    When found, we also extract VENDOR_NAME / I_VENDOR_ID to identify the actual carrier.
  let connected       = false;
  let connectMs: number | null = null;
  let disconnectMs: number | null = null;
  let actualVendorName: string | undefined;
  let actualVendorId: string | undefined;
  const deadline      = Date.now() + (maxDuration + 8) * 1000; // hard cap
  const pollInterval  = 2000; // 2s between polls

  // Parse listActiveCalls XML body → map of CALL_ID → {vendorName, vendorId}
  const parseCalls = (body: string): Map<string, { vendorName?: string; vendorId?: string }> => {
    const result = new Map<string, { vendorName?: string; vendorId?: string }>();
    // Split into struct blocks — each active call is one <struct>...</struct>
    const structRe = /<struct>([\s\S]*?)<\/struct>/gi;
    let sm: RegExpExecArray | null;
    while ((sm = structRe.exec(body)) !== null) {
      const block = sm[1];
      const get = (field: string): string | undefined => {
        const re = new RegExp(`<name>${field}<\\/name>\\s*<value>\\s*(?:<string>)?([^<]*)(?:<\\/string>)?\\s*<\\/value>`, 'i');
        return re.exec(block)?.[1]?.trim() || undefined;
      };
      const id = get('CALL_ID');
      if (!id) continue;
      result.set(id, {
        vendorName: get('VENDOR_NAME') || get('vendor_name'),
        vendorId:   get('I_VENDOR_ID') || get('i_vendor'),
      });
    }
    return result;
  };

  const pollActiveCalls = async (): Promise<Map<string, { vendorName?: string; vendorId?: string }>> => {
    if (!apiUrl || !callId || callId === 'unknown') return new Map();
    try {
      const resp = await sippyPost(apiUrl, xmlRpcCall('listActiveCalls', {}), username, password);
      if (resp.statusCode !== 200) return new Map();
      return parseCalls(resp.body);
    } catch { return new Map(); }
  };

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, pollInterval));

    const activeCalls = await pollActiveCalls();

    if (!connected) {
      if (callId && callId !== 'unknown' && activeCalls.has(callId)) {
        connected  = true;
        connectMs  = Date.now();
        const info = activeCalls.get(callId);
        actualVendorName = info?.vendorName;
        actualVendorId   = info?.vendorId;
        console.log(`[route-test] callId=${callId} connected — pdd=${connectMs - initMs}ms vendor=${actualVendorName ?? 'unknown'}`);
      } else if (Date.now() - initMs > (maxDuration + 4) * 1000) {
        break;
      }
    } else {
      if (!activeCalls.has(callId!)) {
        disconnectMs = Date.now();
        console.log(`[route-test] callId=${callId} disconnected — duration=${disconnectMs - connectMs!}ms`);
        break;
      }
      if (connectMs && Date.now() - connectMs > maxDuration * 1000 + 3000) {
        disconnectMs = Date.now();
        break;
      }
    }
  }

  // 3. Compute final metrics.
  //    pdd      = time from call initiation to first confirmation in listActiveCalls (real PDD).
  //    duration = time call was visible as connected in listActiveCalls (real ACD, in seconds).
  //    actualVendorName = VENDOR_NAME field from the active call struct (Sippy's authoritative carrier).
  //    If the call was never confirmed via listActiveCalls, report sipCode=408 (no confirmation).
  const pdd = connectMs != null
    ? Math.round(connectMs - initMs)
    : Math.round(Date.now() - initMs);

  const duration = connectMs != null && disconnectMs != null
    ? Math.round((disconnectMs - connectMs) / 1000)
    : connected ? maxDuration
    : 0;

  const finalSipCode = connected ? 200 : (callId && callId !== 'unknown' ? 408 : 503);

  return {
    connected,
    sipCode:  finalSipCode,
    pdd,
    duration,
    actualVendorName,
    actualVendorId,
    callId: callId && callId !== 'unknown' ? callId : undefined,
  };
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
    const fault = extractFaultString(text);
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
    const fault = extractFaultString(text);
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
    const fault = extractFaultString(text);
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
    const fault = extractFaultString(text);
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
  const webPass = opts.name.toLowerCase().replace(/[^a-z0-9]/g, '') + 'Sp1';
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
  // ── Portal-scraped extras ─────────────────────────────────────────────────
  clientName?: string;      // account/caller display name from portal
  billedDuration?: number;  // billed duration in seconds (from portal CDR page)
  // ── Vendor / termination info ────────────────────────────────────────────
  iConnection?: string;     // i_connection — termination connection ID (when returned by Sippy)
  vendor?: string;          // vendor name (resolved from connection or returned directly)
  // ── Disposition enrichment ───────────────────────────────────────────────
  q850Code?: string;        // Q.931 / Q.850 cause code (from Mera vendor-side CDR)
  dispositionSource?: string; // ingestion path: 'xmlrpc' | 'portal-customer' | 'portal-admin'
  // ── Voice Quality (VQ) metrics ───────────────────────────────────────────
  // Only populated when Sippy VQ reporting is enabled on the switch.
  // Sippy XML-RPC field names: i_vq_term_mos, i_vq_orig_mos
  // Jitter and pkt_loss may be present as i_jitter / i_pkt_loss or jitter / pkt_loss.
  iVqTermMos?: number;      // i_vq_term_mos — termination-leg MOS score (1.0–5.0)
  iVqOrigMos?: number;      // i_vq_orig_mos — origination-leg MOS score (1.0–5.0)
  jitter?: number;          // jitter / i_jitter — jitter in milliseconds
  pktLoss?: number;         // pkt_loss / i_pkt_loss — packet loss percentage (0–100)
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
      const fault = extractFaultString(text);
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
      const fault = extractFaultString(text);
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

// ── Portal date conversion ───────────────────────────────────────────────────
// Sippy's CDR search form accepts "MM/DD/YYYY HH:MM:SS" or natural-language
// strings ("1 day ago", "now").  ISO 8601 strings sent by the frontend must be
// converted; natural-language strings are passed through unchanged.
function toSippyPortalDate(raw: string): string {
  if (!raw) return raw;
  // Already natural-language ("1 day ago", "now", "yesterday", etc.)
  if (!/^\d{4}-\d{2}-\d{2}/.test(raw) && !/^\d{2}\/\d{2}\/\d{4}/.test(raw)) return raw;
  // Already in Sippy format MM/DD/YYYY …
  if (/^\d{2}\/\d{2}\/\d{4}/.test(raw)) return raw;
  // ISO 8601: YYYY-MM-DDTHH:MM:SS…
  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return raw;
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const yyyy = d.getUTCFullYear();
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const min = String(d.getUTCMinutes()).padStart(2, '0');
    const ss = String(d.getUTCSeconds()).padStart(2, '0');
    return `${mm}/${dd}/${yyyy} ${hh}:${min}:${ss}`;
  } catch { return raw; }
}

// ── CDR table helpers ────────────────────────────────────────────────────────

/**
 * Finds the CDR data table in Sippy portal HTML using content-based detection.
 *
 * Problem: Using lastIndexOf('<TABLE') or Math.max(lastIndexOf('<TABLE'),
 * lastIndexOf('<table')) is unreliable because:
 *   - Admin portal uses uppercase <TABLE>, customer /c1/ portal uses lowercase <table>
 *   - Navigation/footer <table> elements often appear AFTER the CDR data table
 * Solution: scan ALL tables, return the last one with CDR-characteristic content
 * (MM/DD/YYYY dates, HH:MM:SS times, or phone numbers inside cells).
 */
function findCdrTableHtml(html: string): string {
  const htmlLc = html.toLowerCase();
  const positions: number[] = [];
  let pos = 0;
  while ((pos = htmlLc.indexOf('<table', pos)) !== -1) {
    positions.push(pos);
    pos++;
  }
  // Scan backward from end — CDR table is near the bottom but not always last
  for (let i = positions.length - 1; i >= 0; i--) {
    const start = positions[i];
    const lookahead  = html.slice(start, start + 8000);
    const lookaheadLc = lookahead.toLowerCase();
    const hasDate    = /\d{2}\/\d{2}\/\d{4}/.test(lookahead);    // MM/DD/YYYY
    const hasTime    = /\d{2}:\d{2}:\d{2}/.test(lookahead);      // HH:MM:SS
    const hasPhone   = />[\+]?\d{7,15}</.test(lookahead);         // phone number in cell
    const hasCdrHdr  = lookaheadLc.includes('>cli') || lookaheadLc.includes('>cld');
    if (hasDate || (hasTime && hasPhone) || hasCdrHdr) return html.slice(start);
  }
  // Fallback: absolute last table
  const fallback = htmlLc.lastIndexOf('<table');
  return fallback !== -1 ? html.slice(fallback) : '';
}

/**
 * Strips nested <table>...</table> blocks from the INNER content of the CDR table.
 *
 * Problem 1: Sippy's portal embeds nested tables inside CDR cells (status icons,
 * tooltips). The non-greedy /<tr[^>]*>([\s\S]*?)<\/tr>/gi regex matches these
 * INNER <tr> elements (1-2 cells) BEFORE the outer CDR rows (9-10 cells), causing
 * all rows to fail the cells.length < 7 check → 0 CDRs parsed.
 *
 * Problem 2 (fixed here): naive iterative stripping removes the outer CDR table
 * itself on the last iteration (once all nested tables are gone, the CDR table
 * becomes a "leaf" and gets stripped), leaving total=0 rows.
 *
 * Solution: extract the inner content of the outermost <table> using a depth
 * counter, strip nested tables only from that inner content, then reassemble.
 * The outer <table>...</table> wrapper is always preserved.
 */
function stripNestedTables(html: string): string {
  const htmlLc = html.toLowerCase();

  // Find the opening tag of the outermost table (html must start with <table)
  const openTagMatch = /^(<table\b[^>]*>)/i.exec(html);
  if (!openTagMatch) return html;   // not a table fragment — return as-is
  const openTag = openTagMatch[1];

  // Walk forward to find the matching </table> using a depth counter
  let depth = 1;
  let pos = openTag.length;
  while (pos < html.length && depth > 0) {
    const nextOpen  = htmlLc.indexOf('<table',   pos);
    const nextClose = htmlLc.indexOf('</table>', pos);
    if (nextClose === -1) break;                          // malformed HTML
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      pos = nextOpen + 1;
    } else {
      depth--;
      pos = (depth === 0) ? nextClose : nextClose + 8;   // sit on </table> or skip
    }
  }

  // innerContent = everything between outer <table> and its matching </table>
  const innerContent = html.slice(openTag.length, pos);

  // Iteratively strip nested tables from innerContent only (never touches outer)
  let cleaned = innerContent;
  for (let iter = 0; iter < 6; iter++) {
    const before = cleaned.length;
    cleaned = cleaned.replace(/<table\b[^>]*>(?:(?!<table\b)[\s\S])*?<\/table>/gi, '');
    if (cleaned.length === before) break;
  }

  return openTag + cleaned + '</table>';
}

// ── Portal CDR scraper ───────────────────────────────────────────────────────
// Scrapes /c1/cdrs_customer.php from the Sippy customer portal (using RTST1 or
// portal credentials). Used as fallback when XML-RPC CDR methods return 401.
//
// CDR table columns (confirmed from portal HTML inspection):
//  [0] row#  [1] Caller(acct) [2] CLI [3] CLD [4] Country [5] Description
//  [6] SetupTime [7] Duration mm:ss [8] BilledDuration mm:ss [9] Amount USD
export async function scrapePortalCDRs(
  portalUsername: string,
  portalPassword: string,
  base: string,
  opts: {
    limit?: number;
    offset?: number;      // starting row offset for pagination (n=N in Sippy CDR URL)
    startDate?: string;   // natural-language OR MM/DD/YYYY HH:MM:SS
    endDate?: string;
    callsSelect?: string; // '1'=all '3'=non-zero+errors '4'=non-zero '6'=errors
    fallbackUsername?: string;
    fallbackPassword?: string;
  } = {},
): Promise<SippyCDR[]> {
  const FAIL = (): SippyCDR[] => [];

  const startDate = toSippyPortalDate(opts.startDate || '1 day ago');
  const endDate   = toSippyPortalDate(opts.endDate   || 'now');
  const limit     = opts.limit     || 100;
  const offset    = opts.offset    ?? 0;
  const callsSel  = opts.callsSelect || '1';

  // Login with primary, then fallback credentials
  let loginRes = await portalLogin(base, portalUsername, portalPassword, 'customer');
  console.log(`[scrapePortalCDRs] login ${portalUsername}: ${loginRes.success ? 'OK' : 'FAIL — ' + loginRes.message}`);
  if (!loginRes.success && opts.fallbackUsername && opts.fallbackPassword &&
      opts.fallbackUsername !== portalUsername) {
    loginRes = await portalLogin(base, opts.fallbackUsername, opts.fallbackPassword, 'customer');
    console.log(`[scrapePortalCDRs] fallback login ${opts.fallbackUsername}: ${loginRes.success ? 'OK' : 'FAIL'}`);
  }
  if (!loginRes.success) return FAIL();
  const cookies = loginRes.cookies;

  try {
    const qs = [
      'n=' + offset, 'action=search', 'from_form=1',
      'startDate=' + encodeURIComponent(startDate),
      'endDate='   + encodeURIComponent(endDate),
      'source=', 'destination=', 'caller=0_0',
      'calls_select=' + callsSel,
      'cdr_currency=USD', 'cli_clause=0', 'cld_clause=0',
      'bt_clause=0', 'bt_pattern=', 'account_class=0',
      'result_filter_opt=0_0',
      'limit=' + limit,
    ].join('&');

    // Try /c1/cdrs_customer.php first (customer self-care portal — the only session type
    // this Sippy build grants; logins always redirect to /c1/).  Fall back to the legacy
    // admin path so the function still works on older multi-tenant Sippy installations.
    // IMPORTANT: pass cookies as the 5th arg (jar), not 4th (extraHeaders).
    let resp = await rawRequest('GET', `${base}/c1/cdrs_customer.php?${qs}`, null, {}, cookies);
    console.log(`[scrapePortalCDRs] /c1/ → status=${resp.statusCode} bodyLen=${resp.body?.length ?? 0}`);
    if (!resp.body || resp.body.length < 500) {
      resp = await rawRequest('GET', `${base}/cdrs_customer.php?${qs}`, null, {}, cookies);
      console.log(`[scrapePortalCDRs] /root/ → status=${resp.statusCode} bodyLen=${resp.body?.length ?? 0}`);
    }
    const html = resp.body;
    if (!html || html.length < 500) {
      console.log('[scrapePortalCDRs] response too short — aborting');
      return FAIL();
    }

    // Find the CDR data table using content-based detection (date/phone/header patterns).
    // DO NOT use lastIndexOf or Math.max — nav/footer tables often appear AFTER the CDR
    // data table and would be picked instead, yielding 0 parsed rows.
    const rawTableHtml = findCdrTableHtml(html);
    const isListEmpty  = /list is empty/i.test(html);
    console.log(`[scrapePortalCDRs] tableFound=${rawTableHtml.length > 50} (bodyLen=${html.length}) listEmpty=${isListEmpty}`);
    if (!rawTableHtml) { console.log('[scrapePortalCDRs] no CDR TABLE found'); return FAIL(); }

    // Strip nested <table> blocks (status icons, tooltips inside CDR cells).
    // Without this, the non-greedy <tr>...<\/tr> regex matches inner rows (1-2 cells)
    // before outer CDR rows (9-10 cells), causing all rows to fail the ≥7-cells check.
    const tableHtml = stripNestedTables(rawTableHtml);

    // Parse rows (skip header row and "List is Empty" row)
    const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let m: RegExpExecArray | null;
    const cdrs: SippyCDR[] = [];
    let rowIndex = 0;
    let rowsTotal = 0, rowsTooFew = 0, rowsHeader = 0, rowsEmpty = 0, rowsNoCli = 0;

    while ((m = trRe.exec(tableHtml)) !== null) {
      rowsTotal++;
      const rowHtml = m[1];
      // Extract cell texts
      const tdRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      const cells: string[] = [];
      let td: RegExpExecArray | null;
      while ((td = tdRe.exec(rowHtml)) !== null) {
        const txt = td[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
        cells.push(txt);
      }

      // Skip header row (contains "Caller" or "CLI") and empty/filler rows
      if (cells.length < 7) { rowsTooFew++; continue; }
      if (/^(caller|cli|cld)/i.test(cells[1] || '') || /^(caller|cli|cld)/i.test(cells[0] || '')) { rowsHeader++; continue; }
      if (/list is empty/i.test(cells.join(' '))) { rowsEmpty++; continue; }
      // Skip rows where cells[2] (CLI) looks non-numeric/empty and cells[3] (CLD) is empty
      if (!cells[2] && !cells[3]) { rowsEmpty++; continue; }

      // Columns: [0]=rowNum [1]=Caller/Acct [2]=CLI [3]=CLD [4]=Country [5]=Desc [6]=SetupTime [7]=Dur [8]=BilledDur [9]=Amount
      const callerAcct  = cells[1] || '';
      const cli         = cells[2] || '-';
      const cld         = cells[3] || '-';
      const country     = cells[4] || '';
      const description = cells[5] || '';
      const setupTime   = cells[6] || '';
      const durationRaw = cells[7] || '0:00';
      const billedRaw   = cells[8] || '0:00';
      const amountRaw   = cells[9] || '0';

      if (!cli || cli === '-') { rowsNoCli++; continue; }

      const durationSec = parseMMSS(durationRaw);
      const billedSec   = parseMMSS(billedRaw);
      const cost        = parseFloat(amountRaw) || 0;

      // Parse setup time — customer portal uses "DD Mon YYYY HH:MM:SS" (same as admin portal).
      // Fall back to "MM/DD/YYYY HH:MM:SS" for Sippy instances that use the US date format.
      const CUST_MONTHS: Record<string, string> = {
        Jan:'01', Feb:'02', Mar:'03', Apr:'04', May:'05', Jun:'06',
        Jul:'07', Aug:'08', Sep:'09', Oct:'10', Nov:'11', Dec:'12',
      };
      let connectTime: string | undefined;
      const dtMonMatch = setupTime.match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+(\d{2}:\d{2}:\d{2})/);
      if (dtMonMatch) {
        const [, day, mon, year, time] = dtMonMatch;
        const mo = CUST_MONTHS[mon] || '01';
        connectTime = `${year}-${mo}-${day.padStart(2,'0')}T${time}Z`;
      } else {
        // Fallback: "DD/MM/YYYY HH:MM:SS" — Sippy portal displays dates in DD/MM/YYYY order.
        // match[1]=DD, match[2]=MM, match[3]=YYYY → ISO: YYYY-MM-DD
        const dtSlashMatch = setupTime.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2}:\d{2})/);
        if (dtSlashMatch) {
          connectTime = `${dtSlashMatch[3]}-${dtSlashMatch[2]}-${dtSlashMatch[1]}T${dtSlashMatch[4]}Z`;
        }
      }

      // Normalize result to Sippy numeric convention so isAnswered() works correctly:
      //   '0'      = answered (billed seconds > 0 → voice path established)
      //   'failed' = not answered (ring-no-answer, busy, rejected, network failure)
      // DO NOT use description as result — it's destination text, not disposition.
      const resultCode = billedSec > 0 ? '0' : 'failed';

      cdrs.push({
        callId:            `portal-cdr-${rowIndex++}`,
        caller:            cli,
        callee:            cld,
        country:           country || undefined,
        description,
        areaName:          description || undefined,
        connectTime,
        startTime:         connectTime || new Date().toISOString(),
        duration:          billedSec,
        totalDuration:     durationSec,
        billedDuration:    billedSec,
        cost,
        result:            resultCode,
        clientName:        callerAcct || undefined,
        dispositionSource: 'portal-customer',
      });
    }

    console.log(`[scrapePortalCDRs] rows: total=${rowsTotal} tooFewCells=${rowsTooFew} header=${rowsHeader} empty=${rowsEmpty} noCli=${rowsNoCli} parsed=${cdrs.length}`);
    return cdrs;
  } catch {
    return FAIL();
  }
}

// scrapePortalCDRsAll — like scrapePortalCDRs but logs in ONCE and paginates
// through all pages using offset stepping.  Stops when a page returns 0 rows.
// PORTAL_CAP=50 is the Sippy hard limit per page regardless of the limit= param.
export async function scrapePortalCDRsAll(
  portalUsername: string,
  portalPassword: string,
  base: string,
  opts: {
    startDate?: string;
    endDate?: string;
    callsSelect?: string;
    destination?: string;
    iAccount?: number;        // when set: filter portal CDRs to this account (caller=N_N)
    fallbackUsername?: string;
    fallbackPassword?: string;
    maxPages?: number;
  } = {},
): Promise<SippyCDR[]> {
  const PORTAL_CAP = 50;
  const MAX_PAGES  = opts.maxPages ?? 200;

  const startDate   = toSippyPortalDate(opts.startDate || '1 day ago');
  const endDate     = toSippyPortalDate(opts.endDate   || 'now');
  const callsSel    = opts.callsSelect || '1';
  const callerParam = opts.iAccount ? `${opts.iAccount}_${opts.iAccount}` : '0_0';

  // Login once
  let loginRes = await portalLogin(base, portalUsername, portalPassword, 'customer');
  console.log(`[scrapePortalCDRsAll] login ${portalUsername}: ${loginRes.success ? 'OK' : 'FAIL — ' + loginRes.message}`);
  if (!loginRes.success && opts.fallbackUsername && opts.fallbackPassword &&
      opts.fallbackUsername !== portalUsername) {
    loginRes = await portalLogin(base, opts.fallbackUsername, opts.fallbackPassword, 'customer');
    console.log(`[scrapePortalCDRsAll] fallback login ${opts.fallbackUsername}: ${loginRes.success ? 'OK' : 'FAIL'}`);
  }
  if (!loginRes.success) return [];
  const cookies = loginRes.cookies;

  const allCdrs: SippyCDR[] = [];
  const seenKeys = new Set<string>(); // dedup by startTime+caller+callee fingerprint
  let pageIndex = 0;

  while (pageIndex < MAX_PAGES) {
    const offset = pageIndex * PORTAL_CAP;
    const qs = [
      'n=' + offset, 'action=search', 'from_form=1',
      'startDate=' + encodeURIComponent(startDate),
      'endDate='   + encodeURIComponent(endDate),
      'source=', 'destination=' + encodeURIComponent(opts.destination || ''), 'caller=' + callerParam,
      'calls_select=' + callsSel,
      'cdr_currency=USD', 'cli_clause=0', 'cld_clause=0',
      'bt_clause=0', 'bt_pattern=', 'account_class=0',
      'result_filter_opt=0_0',
      'limit=' + PORTAL_CAP,
    ].join('&');

    let resp = await rawRequest('GET', `${base}/c1/cdrs_customer.php?${qs}`, null, {}, cookies);
    if (!resp.body || resp.body.length < 500) {
      resp = await rawRequest('GET', `${base}/cdrs_customer.php?${qs}`, null, {}, cookies);
    }
    const html = resp.body;
    if (!html || html.length < 500) break;

    const rawTableHtml = findCdrTableHtml(html);
    if (!rawTableHtml) break;
    const tableHtml = stripNestedTables(rawTableHtml);

    const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let m: RegExpExecArray | null;
    const pageCdrs: SippyCDR[] = [];
    let rowIndex = allCdrs.length;
    let rowsTotal = 0, rowsTooFew = 0, rowsHeader = 0, rowsEmpty = 0, rowsNoCli = 0;

    while ((m = trRe.exec(tableHtml)) !== null) {
      rowsTotal++;
      const rowHtml = m[1];
      const tdRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      const cells: string[] = [];
      let td: RegExpExecArray | null;
      while ((td = tdRe.exec(rowHtml)) !== null) {
        const txt = td[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
        cells.push(txt);
      }
      if (cells.length < 7) { rowsTooFew++; continue; }
      if (/^(caller|cli|cld)/i.test(cells[1] || '') || /^(caller|cli|cld)/i.test(cells[0] || '')) { rowsHeader++; continue; }
      if (/list is empty/i.test(cells.join(' '))) { rowsEmpty++; continue; }
      if (!cells[2] && !cells[3]) { rowsEmpty++; continue; }

      const callerAcct  = cells[1] || '';
      const cli         = cells[2] || '-';
      const cld         = cells[3] || '-';
      const country     = cells[4] || '';
      const description = cells[5] || '';
      const setupTime   = cells[6] || '';
      const durationRaw = cells[7] || '0:00';
      const billedRaw   = cells[8] || '0:00';
      const amountRaw   = cells[9] || '0';

      if (!cli || cli === '-') { rowsNoCli++; continue; }

      const durationSec = parseMMSS(durationRaw);
      const billedSec   = parseMMSS(billedRaw);
      const cost        = parseFloat(amountRaw) || 0;

      const CUST_MONTHS: Record<string, string> = {
        Jan:'01', Feb:'02', Mar:'03', Apr:'04', May:'05', Jun:'06',
        Jul:'07', Aug:'08', Sep:'09', Oct:'10', Nov:'11', Dec:'12',
      };
      let connectTime: string | undefined;
      const dtMonMatch = setupTime.match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+(\d{2}:\d{2}:\d{2})/);
      if (dtMonMatch) {
        const [, day, mon, year, time] = dtMonMatch;
        const mo = CUST_MONTHS[mon] || '01';
        connectTime = `${year}-${mo}-${day.padStart(2,'0')}T${time}Z`;
      } else {
        // DD/MM/YYYY HH:MM:SS — Sippy portal displays dates in DD/MM/YYYY order.
        // match[1]=DD, match[2]=MM, match[3]=YYYY → ISO: YYYY-MM-DD
        const dtSlashMatch = setupTime.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2}:\d{2})/);
        if (dtSlashMatch) {
          connectTime = `${dtSlashMatch[3]}-${dtSlashMatch[2]}-${dtSlashMatch[1]}T${dtSlashMatch[4]}Z`;
        }
      }
      const resultCode = billedSec > 0 ? '0' : 'failed';

      pageCdrs.push({
        callId:            `portal-cdr-${rowIndex++}`,
        caller:            cli,
        callee:            cld,
        country:           country || undefined,
        description,
        areaName:          description || undefined,
        connectTime,
        startTime:         connectTime || new Date().toISOString(),
        duration:          billedSec,
        totalDuration:     durationSec,
        billedDuration:    billedSec,
        cost,
        result:            resultCode,
        clientName:        callerAcct || undefined,
        dispositionSource: 'portal-customer',
      });
    }

    // Dedup against already-collected CDRs: if this Sippy portal ignores the
    // n= offset and keeps serving the same rows, every subsequent page will have
    // 0 NEW records → break to avoid an infinite loop.
    let newOnPage = 0;
    for (const cdr of pageCdrs) {
      const fp = `${cdr.startTime}:${cdr.caller}:${cdr.callee}`;
      if (!seenKeys.has(fp)) {
        seenKeys.add(fp);
        allCdrs.push(cdr);
        newOnPage++;
      }
    }

    console.log(`[scrapePortalCDRsAll] page=${pageIndex} offset=${offset} rows: total=${rowsTotal} tooFewCells=${rowsTooFew} header=${rowsHeader} empty=${rowsEmpty} noCli=${rowsNoCli} parsed=${pageCdrs.length} new=${newOnPage}`);

    // Stop only when the page is empty or every CDR on it was already seen (portal
    // ignores the n= offset and repeats the same rows).  No early-exit on low-new-count
    // because on a live system new calls complete between pages and that is expected.
    if (pageCdrs.length === 0 || newOnPage === 0) break;
    pageIndex++;
  }

  const via = loginRes.cookies ? portalUsername : (opts.fallbackUsername ?? portalUsername);
  console.log(`[scrapePortalCDRsAll] done — ${allCdrs.length} CDRs across ${pageIndex} pages via ${via}@${base}`);
  return allCdrs;
}

// scrapeAdminPortalCDRs — logs into admin portal as 'admin' (acct_type=admin) using
// ssp-root credentials and scrapes /cdrs_customer.php for ALL customers' CDRs.
// This is the only way to access system-wide CDRs since getCustomerCDRs XML-RPC
// returns empty for ssp-root's scope.
export async function scrapeAdminPortalCDRs(
  adminUsername: string,
  adminPassword: string,
  base: string,
  opts: {
    limit?: number;
    startDate?: string;   // natural-language (e.g. '1 hour ago') or Sippy date string
    endDate?: string;
    callsSelect?: string; // '1'=all '3'=non-zero+errors '4'=non-zero '5'=complete '6'=errors
    source?: string;       // CLI filter
    destination?: string;  // CLD filter
    offset?: number;
    iAccount?: number;     // when set: filter portal CDRs to this account (caller=N_N param)
  } = {},
): Promise<SippyCDR[]> {
  const FAIL = (): SippyCDR[] => [];
  const startDate = toSippyPortalDate(opts.startDate || '1 day ago');
  const endDate   = toSippyPortalDate(opts.endDate   || 'now');
  const limit     = opts.limit     || 100;
  const callsSel  = opts.callsSelect || '1';
  const offset    = opts.offset ?? 0;
  // Sippy CDR portal account filter: caller=0_0 = all, caller=N_N = specific account N
  const callerParam = opts.iAccount ? `${opts.iAccount}_${opts.iAccount}` : '0_0';

  // Try admin login, then reseller, then customer (fallback)
  let loginRes = await portalLogin(base, adminUsername, adminPassword, 'admin');
  if (!loginRes.success) {
    loginRes = await portalLogin(base, adminUsername, adminPassword, 'reseller');
  }
  if (!loginRes.success) {
    loginRes = await portalLogin(base, adminUsername, adminPassword, 'customer');
  }
  if (!loginRes.success) return FAIL();
  const cookies = loginRes.cookies;

  try {
    const qs = [
      `n=${offset}`, 'action=search', 'from_form=1',
      'startDate=' + encodeURIComponent(startDate),
      'endDate='   + encodeURIComponent(endDate),
      'source='    + encodeURIComponent(opts.source  || ''),
      'destination=' + encodeURIComponent(opts.destination || ''),
      'caller=' + callerParam,
      'calls_select=' + callsSel,
      'cdr_currency=USD', 'cli_clause=0', 'cld_clause=0',
      'bt_clause=0', 'bt_pattern=', 'account_class=0',
      'result_filter_opt=0_0',
      'limit=' + limit,
    ].join('&');

    // Try /c1/cdrs_customer.php first — this Sippy build grants customer sessions only
    // (all logins redirect to /c1/).  Admin-level accounts can still see all CDRs via
    // caller=0_0 from within the customer portal.  Fall back to the legacy admin path.
    // IMPORTANT: pass cookies as the 5th arg (jar), not 4th (extraHeaders).
    let resp = await rawRequest('GET', `${base}/c1/cdrs_customer.php?${qs}`, null, {}, cookies);
    if (!resp.body || resp.body.length < 500) {
      resp = await rawRequest('GET', `${base}/cdrs_customer.php?${qs}`, null, {}, cookies);
    }
    const html = resp.body;
    if (!html || html.length < 500) {
      console.log(`[scrapeAdminPortalCDRs] response too short (len=${html?.length ?? 0})`);
      return FAIL();
    }

    // Find the CDR data table using content-based detection (same fix as scrapePortalCDRs).
    // Math.max(lastIndexOf…) is unreliable when nav/footer tables appear after the CDR table.
    const rawTableHtml = findCdrTableHtml(html);
    const isListEmpty  = /list is empty/i.test(html);
    console.log(`[scrapeAdminPortalCDRs] tableFound=${rawTableHtml.length > 50} (bodyLen=${html.length}) listEmpty=${isListEmpty}`);
    if (!rawTableHtml) { console.log('[scrapeAdminPortalCDRs] no CDR TABLE found'); return FAIL(); }

    // Strip nested tables before row parsing (same nested-TR fix as scrapePortalCDRs)
    const tableHtml = stripNestedTables(rawTableHtml);

    // Extract status icon tooltip from td[0] (ext:qtip attribute or title)
    const getRowStatus = (rowHtml: string): string => {
      const tipMatch = rowHtml.match(/ext:qtip=['"]([^'"]+)['"]/i) || rowHtml.match(/title=['"]([^'"]+)['"]/i);
      return tipMatch ? tipMatch[1] : '';
    };

    const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let m: RegExpExecArray | null;
    const cdrs: SippyCDR[] = [];
    let rowIndex = 0;
    let rowsTotal = 0, rowsTooFew = 0, rowsHeader = 0, rowsEmpty = 0, rowsNoCli = 0;

    // Month name map for admin portal date format "DD Mon YYYY HH:MM:SS"
    const MONTHS: Record<string, string> = {
      Jan:'01', Feb:'02', Mar:'03', Apr:'04', May:'05', Jun:'06',
      Jul:'07', Aug:'08', Sep:'09', Oct:'10', Nov:'11', Dec:'12',
    };

    while ((m = trRe.exec(tableHtml)) !== null) {
      rowsTotal++;
      const rowHtml = m[1];
      const statusTip = getRowStatus(rowHtml);

      const tdRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      const cells: string[] = [];
      let td: RegExpExecArray | null;
      while ((td = tdRe.exec(rowHtml)) !== null) {
        const txt = td[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
        cells.push(txt);
      }

      if (cells.length < 7) { rowsTooFew++; continue; }
      if (/^(caller|cli|cld|country|description|setup)/i.test(cells[1] || '') ||
          /^(caller|cli|cld)/i.test(cells[0] || '')) { rowsHeader++; continue; }
      if (/list is empty/i.test(cells.join(' '))) { rowsEmpty++; continue; }
      if (!cells[2] && !cells[3]) { rowsEmpty++; continue; }

      // Admin portal columns: [0]=status_icon [1]=Caller/Acct [2]=CLI [3]=CLD [4]=Country [5]=Desc [6]=SetupTime [7]=Dur [8]=BilledDur [9]=Amount
      const callerAcct  = cells[1] || '';
      const cli         = cells[2] || '-';
      const cld         = cells[3] || '-';
      const country     = cells[4] || '';
      const description = cells[5] || '';
      const setupTime   = cells[6] || '';
      const durationRaw = cells[7] || '0:00';
      const billedRaw   = cells[8] || '0:00';
      const amountRaw   = cells[9] || '0';

      if (!cli || cli === '-') { rowsNoCli++; continue; }

      const durationSec = parseMMSS(durationRaw);
      const billedSec   = parseMMSS(billedRaw);
      const cost        = parseFloat(amountRaw) || 0;

      // Parse setup time — admin portal format: "DD Mon YYYY HH:MM:SS" or "MM/DD/YYYY HH:MM:SS"
      let startTime = '';
      const adminDtMatch = setupTime.match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+(\d{2}:\d{2}:\d{2})/);
      if (adminDtMatch) {
        const [, day, mon, year, time] = adminDtMatch;
        const mo = MONTHS[mon] || '01';
        startTime = `${year}-${mo}-${day.padStart(2,'0')}T${time}Z`;
      } else {
        // Fallback: MM/DD/YYYY HH:MM:SS
        const custDtMatch = setupTime.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2}:\d{2})/);
        if (custDtMatch) {
          startTime = `${custDtMatch[3]}-${custDtMatch[1]}-${custDtMatch[2]}T${custDtMatch[4]}Z`;
        } else {
          startTime = setupTime || new Date().toISOString();
        }
      }

      // Normalize result to Sippy numeric convention so isAnswered() works correctly:
      //   '0'      = answered (billed seconds > 0 → call was connected and charged)
      //   'failed' = not answered; preserve the tooltip text in areaName for diagnostics
      // The admin portal status-icon tooltip (e.g. "NOANSWER", "BUSY") is informative
      // but is not a reliable numeric code — normalize for ASR/ACD correctness.
      const result = billedSec > 0 ? '0' : (statusTip || 'failed');

      cdrs.push({
        callId:            `admin-cdr-${rowIndex++}`,
        caller:            cli,
        callee:            cld,
        country:           country || undefined,
        areaName:          description || statusTip || undefined,
        startTime,
        duration:      billedSec,
        totalDuration: durationSec,
        billedDuration: billedSec,
        cost,
        result,
        clientName:        callerAcct || undefined,
        dispositionSource: 'portal-admin',
      });
    }

    console.log(`[scrapeAdminPortalCDRs] rows: total=${rowsTotal} tooFewCells=${rowsTooFew} header=${rowsHeader} empty=${rowsEmpty} noCli=${rowsNoCli} parsed=${cdrs.length}`);
    return cdrs;
  } catch {
    return FAIL();
  }
}

// ── CDR portal debug helper ──────────────────────────────────────────────────
/**
 * Fetch the raw CDR portal HTML for diagnostic inspection.
 * Returns login result, HTTP status, body length, table count, and a 6KB sample.
 * Used by the /api/sippy/cdr/debug admin endpoint.
 */
export async function debugCdrPortalHtml(
  portalUsername: string,
  portalPassword: string,
  base: string,
  opts: { startDate?: string; limit?: number } = {},
): Promise<{
  success: boolean; loginMessage: string;
  statusCode?: number; bodyLength?: number;
  tableCount?: number; tablePositions?: number[];
  cdrTableFoundAt?: number; listEmpty?: boolean;
  sample?: string;
}> {
  const loginRes = await portalLogin(base, portalUsername, portalPassword, 'customer');
  if (!loginRes.success) return { success: false, loginMessage: loginRes.message };

  const startDate = toSippyPortalDate(opts.startDate || '1 day ago');
  const limit = opts.limit || 50;
  const qs = [
    'n=0', 'action=search', 'from_form=1',
    'startDate=' + encodeURIComponent(startDate),
    'endDate='   + encodeURIComponent(toSippyPortalDate('now')),
    'calls_select=1', 'cdr_currency=USD', 'cli_clause=0', 'cld_clause=0',
    'limit=' + limit, 'source=', 'destination=', 'caller=', 'result_filter_opt=0_0',
    'bt_clause=0', 'bt_pattern=',
  ].join('&');

  try {
    let resp = await rawRequest('GET', `${base}/c1/cdrs_customer.php?${qs}`, null, { 'User-Agent': PORTAL_USER_AGENT }, loginRes.cookies);
    if (!resp.body || resp.body.length < 500) {
      resp = await rawRequest('GET', `${base}/cdrs_customer.php?${qs}`, null, { 'User-Agent': PORTAL_USER_AGENT }, loginRes.cookies);
    }
    const html = resp.body ?? '';
    const htmlLc = html.toLowerCase();

    // Collect table positions
    const positions: number[] = [];
    let p = 0;
    while ((p = htmlLc.indexOf('<table', p)) !== -1) { positions.push(p); p++; }

    const cdrHtml = findCdrTableHtml(html);
    const cdrTableFoundAt = cdrHtml ? html.length - cdrHtml.length : -1;

    return {
      success: true,
      loginMessage: loginRes.message,
      statusCode: resp.statusCode,
      bodyLength: html.length,
      tableCount: positions.length,
      tablePositions: positions.slice(-10),  // last 10 table positions
      cdrTableFoundAt,
      listEmpty: /list is empty/i.test(html),
      sample: cdrHtml.slice(0, 6000),
    };
  } catch (e: any) {
    return { success: false, loginMessage: e.message };
  }
}

// CDR 401 negative cache — key = `${username}@${apiUrl}`, value = epoch ms when the block expires.
// When a credential pair consistently gets 401 from CDR methods, block it for 5 minutes so we
// don't flood the Sippy server with repeated failing auth requests (30+ per minute observed).
const _cdrAuthFailCache = new Map<string, number>();
const CDR_AUTH_FAIL_TTL_MS = 5 * 60_000; // 5 minutes

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
  fallbackPortalUrl?: string,  // used when activeSession is not yet established (startup race)
): Promise<SippyCDR[]> {
  // Use activeSession URL if available; fall back to the caller-supplied URL
  // so CDR fetching works even during the startup window before auto-connect completes.
  const portalBase = activeSession?.portalUrl ?? fallbackPortalUrl;
  if (!portalBase) return [];
  const apiUrl = `${portalBase}/xmlapi/xmlapi`;

  // CDR 401 negative cache — skip this credential if it recently got 401 from both CDR methods.
  const cdrCacheKey = `${username}@${apiUrl}`;
  const cdrBlocked = _cdrAuthFailCache.get(cdrCacheKey);
  if (cdrBlocked && cdrBlocked > Date.now()) {
    const secsLeft = Math.ceil((cdrBlocked - Date.now()) / 1000);
    console.log(`[getSippyCDRs] ${username} — CDR auth failure cached, skipping for ${secsLeft}s`);
    return [];
  }

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

  let cdrAuthFailCount = 0; // how many methods returned 401/403 for this credential
  for (const method of methods) {
    try {
      // Set the correct trusted-mode field per method
      const params: Record<string, unknown> = { ...baseParams };
      if (method === 'getCustomerCDRs') {
        params.i_wholesaler = opts.iWholesaler ?? 1;
      }
      // getAccountCDRs: do NOT default i_customer — omitting it returns ALL accounts' CDRs

      const resp = await sippyPost(apiUrl, xmlRpcCall(method, params), username, password);
      if (resp.statusCode === 401 || resp.statusCode === 403) {
        console.log(`[getSippyCDRs] ${method} HTTP ${resp.statusCode}`);
        cdrAuthFailCount++;
        continue;
      }
      if (resp.statusCode !== 200) { console.log(`[getSippyCDRs] ${method} HTTP ${resp.statusCode}`); continue; }
      const text = resp.body.toString?.() ?? resp.body;
      if (text.includes('faultCode')) {
        const fc = text.match(/<name>faultCode<\/name>[\s\S]*?<value><int>(\d+)<\/int>/)?.[1] ?? '?';
        const fs = text.match(/<name>faultString<\/name>[\s\S]*?<value><string>([^<]*)<\/string>/)?.[1] ?? text.substring(0, 120);
        console.log(`[getSippyCDRs] ${method} faultCode=${fc}: ${fs}`);
        continue;
      }

      const structs = extractAllTags(text, 'struct');
      if (structs.length > 0) {
        const sampleKeys = Object.keys(extractStructMembers(structs[0])).slice(0, 10).join(', ');
        console.log(`[getSippyCDRs] ${method} → ${structs.length} struct(s), sample keys: [${sampleKeys}]`);
      } else {
        console.log(`[getSippyCDRs] ${method} → 0 structs in response (bodyLen=${text.length})`);
      }
      const cdrs: SippyCDR[] = [];
      for (const s of structs) {
        const m = extractStructMembers(s);
        // Accept CDRs identified by call_id, i_call, cli, or at minimum connect_time/setup_time.
        // Some Sippy builds omit call_id but always include timing fields.
        if (!m['call_id'] && !m['i_call'] && !m['cli'] && !m['connect_time'] && !m['setup_time']) continue;
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
          // Timing — convert raw Sippy date strings to ISO 8601 so clients can parse reliably
          startTime:                (parseSippyDate(m['setup_time'] || m['connect_time']))?.toISOString() || m['setup_time'] || m['connect_time'] || '',
          connectTime:              parseSippyDate(m['connect_time'])?.toISOString()    || m['connect_time']    || undefined,
          disconnectTime:           parseSippyDate(m['disconnect_time'])?.toISOString() || m['disconnect_time'] || undefined,
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
          dispositionSource:        'xmlrpc',
          description:              ns('description'),
          remoteIp:                 ns('remote_ip'),
          protocol:                 ns('protocol'),
          userAgent:                ns('user_agent'),
          releaseSource:            ns('release_source'),
          parentLocalICall:         ns('parent_local_i_call'),
          // Vendor / connection — returned by some Sippy versions in getAccountCDRs
          iConnection:              ns('i_connection'),
          vendor:                   ns('vendor_name') || ns('vendor') || undefined,
          // Voice Quality (VQ) — only present when Sippy VQ reporting is enabled.
          // Field names vary by Sippy version; try both prefixed and un-prefixed variants.
          iVqTermMos:               nf('i_vq_term_mos') ?? nf('vq_term_mos'),
          iVqOrigMos:               nf('i_vq_orig_mos') ?? nf('vq_orig_mos'),
          jitter:                   nf('i_jitter')      ?? nf('jitter'),
          pktLoss:                  nf('i_pkt_loss')    ?? nf('pkt_loss'),
        });
      }
      if (cdrs.length > 0) return cdrs;
    } catch (err: any) {
      console.log(`[getSippyCDRs] ${method} error: ${err?.message ?? err}`);
      continue;
    }
  }

  // Both methods returned 401/403 — cache this auth failure for 5 minutes.
  // This is the key throttle: without it the server floods Sippy with 30+ 401s/minute.
  if (cdrAuthFailCount >= methods.length) {
    _cdrAuthFailCache.set(cdrCacheKey, Date.now() + CDR_AUTH_FAIL_TTL_MS);
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
      const lastConnMatch = text.match(/<name>last_i_cdrs_connection<\/name>\s*<value>[^<]*(?:<[a-z]+>)?([^<]*)</i);
      const lastConn = lastConnMatch?.[1]?.trim() || undefined;

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
      ?? extractFaultString(text) ?? 'exportVendorsCDRs_Mera failed.';
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
      const fault = extractFaultString(text) ?? 'getCDRSDP failed.';
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
    const fault = extractFaultString(text) ?? 'getUploadToken failed.';
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
    const fault = extractFaultString(text) ?? 'getUploadStatus failed.';
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
    const fault = extractFaultString(text) ?? `${method} failed.`;
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
  iTariff?: string;
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
  // If iTariff was passed directly from the UI, skip the expensive customer lookup
  let customer: { i_account: string; i_tariff: string } | null = null;
  if (opts.iTariff) {
    customer = { i_account: '', i_tariff: opts.iTariff };
    console.log(`[Sippy] pushRate using provided iTariff=${opts.iTariff} for "${opts.accountName}"`);
  } else {
    customer = await findSippyCustomer(apiUrl, credentials.username, credentials.password, opts.accountName);
    console.log(`[Sippy] pushRate customer lookup for "${opts.accountName}":`, customer);
  }

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

  const reason = lastErrors.length > 0 ? lastErrors.join(' | ') : 'No compatible Sippy rate API found.';
  console.error(`[Sippy] pushRateToSippy ALL attempts failed for "${opts.accountName}". Errors:`, lastErrors);
  return {
    success: false,
    message: reason,
    detail: customer ? `i_account=${customer.i_account ?? 'none'} i_tariff=${customer.i_tariff ?? 'none'}` : 'No matching Sippy customer found for this account name.',
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
  // Sippy accepts mixed-case usernames (confirmed: "Internal-PTCL" provisions successfully).
  // Only strip characters that Sippy explicitly rejects (spaces, special chars except . _ -).
  const username   = (opts.username || safeName).replace(/[^a-zA-Z0-9._-]/g, '');
  const authname   = (opts.authname || username).replace(/[^a-zA-Z0-9._-]/g, '');
  // Sippy requires passwords to contain ONLY letters and digits (no special chars),
  // AND must contain at least one digit. Strip non-alphanumeric, then append digits if missing.
  const sanitizePw = (raw: string): string => {
    const clean = raw.replace(/[^a-zA-Z0-9]/g, '');
    return /\d/.test(clean) ? clean : clean + '42';
  };
  const webPass  = sanitizePw(opts.webPassword  || (safeName + Math.random().toString(36).slice(2, 8)));
  const voipPass = sanitizePw(opts.voipPassword || (Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6).toUpperCase()));
  // Contact name: caller-supplied first/last name override the auto-derived parts
  const nameParts   = opts.name.trim().split(/\s+/);
  const firstName   = opts.firstName ?? (nameParts[0] ?? opts.name);
  const lastName    = opts.lastName  ?? (nameParts.slice(1).join(' '));

  // preferred_codec: Sippy requires this field — omitting it causes faultString "Parameter preferred_codec is required."
  // 0 = G.711u (PCMU) is the universal default. null/undefined → fall back to 0.
  const codecValue: number =
    (opts.preferredCodec !== undefined && opts.preferredCodec !== null) ? opts.preferredCodec : 0;

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
    lifetime:                 opts.lifetime             ?? -1,   // -1 = unlimited
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
    i_media_relay_type:       opts.iMediaRelayType     ?? 0,
  };
  // Both fields are required by Sippy — send always with safe defaults.
  params.i_export_type    = opts.iExportType    ?? 2;   // 2 = Retail
  params.i_password_policy = opts.iPasswordPolicy ?? 1;  // 1 = Default policy

  // ── Routing group (only if explicitly provided by wizard) ──────────────
  // Do NOT auto-fetch: the first routing group returned by listRoutingGroups
  // may not belong to i_customer=1 and causes faultCode 501 "Fatal error".
  // Sippy assigns a default routing group automatically when omitted.
  if (opts.routingGroup) {
    const rg = parseInt(opts.routingGroup, 10);
    if (!isNaN(rg)) {
      params.i_routing_group = rg;
      console.log(`[Sippy] Using wizard-supplied routing group: ${rg}`);
    }
  } else {
    console.log('[Sippy] No routing group supplied — omitting i_routing_group (Sippy will use account default)');
  }

  // ── Customer context (required for admin/root credentials) ──────────────
  // ssp-root must specify i_customer=1 (root customer) when creating accounts.
  // Confirmed required: createAccount returns fault 501 "Fatal error" without it.
  params.i_customer = opts.iCustomer ?? 1;

  // ── Billing plan (i_billing_plan required since Sippy v1.8) ─────────────
  if (opts.servicePlan) {
    const sp = parseInt(opts.servicePlan, 10);
    if (!isNaN(sp) && sp > 0) params.i_billing_plan = sp;
  }
  // NOTE: Do NOT hardcode a default here.  If the user did not supply a plan and we
  // guess wrong (e.g. ID 1), Sippy returns faultCode 401 "Wrong i_billing_plan" or
  // faultCode 501 "Fatal error".  The auto-probe block below will discover the right ID.

  // preferred_codec: always required by Sippy — 0 = G.711u (PCMU) default
  params.preferred_codec = codecValue;

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

  // ── Billing plan pre-discovery ───────────────────────────────────────────
  // If the user did not specify a service plan, try to discover available plans
  // using the current credentials (could be ssp-root on the retry path).
  // This avoids the "Wrong i_billing_plan" / "Fatal error" faults on first attempt.
  if (!params.i_billing_plan && !isVendor) {
    const bpDiscover = await listSippyBillingPlans(credentials.username, credentials.password, baseUrl);
    if (bpDiscover.plans.length > 0) {
      params.i_billing_plan = bpDiscover.plans[0].id;
      console.log(`[Sippy] Pre-discovered billing plan: ${params.i_billing_plan} "${bpDiscover.plans[0].name}"`);
    } else {
      // Probe getServicePlanInfo for IDs 1-20 using current credentials
      console.log('[Sippy] Billing plan list unavailable — quick-probing IDs 1-20 via getServicePlanInfo');
      let discovered = 0;
      for (const probeId of [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20]) {
        try {
          const pr = await sippyPost(apiUrl, xmlRpcCall('getServicePlanInfo', { i_billing_plan: probeId }), credentials.username, credentials.password);
          if (pr.statusCode === 200 && !pr.body.includes('<fault>') && !pr.body.includes('faultCode')) {
            const nameMatch = pr.body.match(/<name>name<\/name>\s*<value><string>([^<]+)<\/string>/i)?.[1];
            if (nameMatch) {
              params.i_billing_plan = probeId;
              console.log(`[Sippy] Quick-probe found billing plan: ${probeId} "${nameMatch}"`);
              discovered = probeId;
              break;
            }
          }
        } catch { /* skip */ }
      }
      if (!discovered) {
        // Set tentative plan=1 so we get a fault from Sippy (enables the fault-based probe later)
        params.i_billing_plan = 1;
        console.log('[Sippy] No billing plans found via quick-probe — using tentative i_billing_plan=1 (fault-based probe will follow)');
      }
    }
  }

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

  console.log(`[Sippy] pushAccountToSippy → url: ${apiUrl}, type: ${opts.type}`);
  // Log params in chunks to avoid deployment-log truncation
  const paramsStr = JSON.stringify(params);
  for (let _ci = 0; _ci < paramsStr.length; _ci += 300) {
    console.log(`[Sippy] params[${_ci}]: ${paramsStr.slice(_ci, _ci + 300)}`);
  }

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
        ?? extractFaultString(text);  // fallback for other formats
      const faultStr = faultStrRaw ?? null;
      if (faultStr) {
        lastFault = faultStr.replace(/<[^>]+>/g, '').trim();
        console.error(`[Sippy] ${method} fault: ${lastFault}`);

        // Auto-fetch billing plan if Sippy rejects the plan ID (or reports Fatal error)
        // Triggers on: "Wrong i_billing_plan", "Fatal error" (faultCode 501 = missing/bad required field)
        const needsBillingPlanProbe = !billingPlanAutoFetched && (
          lastFault.toLowerCase().includes('i_billing_plan') ||
          lastFault.toLowerCase() === 'fatal error'
        );
        if (needsBillingPlanProbe) {
          billingPlanAutoFetched = true;
          console.log(`[Sippy] Billing plan fault ("${lastFault}") — auto-fetching plans...`);
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

            // If still "Fatal error" after billing plan fix, the routing group may be scoped
            // to a different customer. Strip i_routing_group and retry — Sippy will assign default.
            if (lastFault.toLowerCase() === 'fatal error' && params.i_routing_group !== undefined) {
              const savedRg = params.i_routing_group;
              delete params.i_routing_group;
              console.log(`[Sippy] Stripping i_routing_group=${savedRg} (may be wrong customer scope) — retrying...`);
              const rgStrippedBody = xmlRpcCall(method, params);
              const rgStrippedResp = await sippyPost(apiUrl, rgStrippedBody, credentials.username, credentials.password);
              const rgStrippedText = rgStrippedResp.body;
              const rgStrippedFaultRaw = rgStrippedText.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim() ?? '';
              console.log(`[Sippy] No-routing-group retry: HTTP ${rgStrippedResp.statusCode}, fault="${rgStrippedFaultRaw.slice(0, 120)}"`);
              if (rgStrippedResp.statusCode === 200 && !rgStrippedText.includes('<fault>') && !rgStrippedText.includes('faultCode')) {
                console.log(`[Sippy] createAccount succeeded after stripping i_routing_group`);
                const retIAccountStr3 = extractValue(rgStrippedText, 'i_account');
                const retIAccount3 = retIAccountStr3 ? parseInt(retIAccountStr3, 10) : undefined;
                return {
                  success: true,
                  message: `Account "${opts.name}" created on Sippy (routing group removed — was ${savedRg}).${retIAccount3 ? ` (ID: ${retIAccount3})` : ''}`,
                  method,
                  i_account:     retIAccount3,
                  username:      extractValue(rgStrippedText, 'username'),
                  authname:      extractValue(rgStrippedText, 'authname'),
                  web_password:  extractValue(rgStrippedText, 'web_password'),
                  voip_password: extractValue(rgStrippedText, 'voip_password'),
                  vm_password:   extractValue(rgStrippedText, 'vm_password'),
                };
              }
              if (rgStrippedFaultRaw) {
                lastFault = rgStrippedFaultRaw;
                console.log(`[Sippy] No-routing-group retry fault: "${lastFault}" — continuing`);
              } else {
                params.i_routing_group = savedRg; // restore if no fault extracted
              }

              // Step 2 cascade: if still "Fatal error" after stripping routing group,
              // i_customer=1 may not match ssp-root's actual customer scope.
              // Try omitting i_customer entirely — Sippy will use the session's default customer.
              if (lastFault.toLowerCase() === 'fatal error') {
                const savedCustomer = params.i_customer;
                delete params.i_customer;
                console.log(`[Sippy] Also stripping i_customer=${savedCustomer} — retrying with session-default customer...`);
                const noCustomerBody = xmlRpcCall(method, params);
                const noCustomerResp = await sippyPost(apiUrl, noCustomerBody, credentials.username, credentials.password);
                const noCustomerText = noCustomerResp.body;
                const noCustomerFault = noCustomerText.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim() ?? '';
                console.log(`[Sippy] No-customer retry: HTTP ${noCustomerResp.statusCode}, fault="${noCustomerFault.slice(0, 120)}"`);
                if (noCustomerResp.statusCode === 200 && !noCustomerText.includes('<fault>') && !noCustomerText.includes('faultCode')) {
                  console.log('[Sippy] createAccount succeeded with session-default customer (no i_customer)');
                  const ncAccount = extractValue(noCustomerText, 'i_account');
                  return {
                    success: true,
                    message: `Account "${opts.name}" created on Sippy (session-default customer, no routing group).${ncAccount ? ` (ID: ${parseInt(ncAccount, 10)})` : ''}`,
                    method,
                    i_account:     ncAccount ? parseInt(ncAccount, 10) : undefined,
                    username:      extractValue(noCustomerText, 'username'),
                    authname:      extractValue(noCustomerText, 'authname'),
                    web_password:  extractValue(noCustomerText, 'web_password'),
                    voip_password: extractValue(noCustomerText, 'voip_password'),
                    vm_password:   extractValue(noCustomerText, 'vm_password'),
                  };
                }
                if (noCustomerFault) {
                  lastFault = noCustomerFault;
                  console.log(`[Sippy] No-customer retry fault: "${lastFault}"`);
                } else {
                  params.i_customer = savedCustomer; // restore
                }

                // Step 3 cascade: "i_routing_group is mandatory for root customer"
                // Probe available routing groups in TWO passes:
                //   Pass A — session context (no i_customer): works when ssp-root is a reseller
                //   Pass B — i_customer=1 explicitly: fallback for root-scoped accounts
                if (lastFault.toLowerCase().includes('routing_group') && lastFault.toLowerCase().includes('mandatory')) {
                  console.log('[Sippy] Routing group mandatory — probing available routing groups (session context first, then root customer)...');
                  try {
                    const rgListBody = xmlRpcCall('listRoutingGroups', {});
                    const rgListResp = await sippyPost(apiUrl, rgListBody, credentials.username, credentials.password);
                    // Extract all i_routing_group IDs from the listRoutingGroups response
                    const rgIds: number[] = [];
                    const rgIdRegex = /<name>i_routing_group<\/name>\s*<value><int>(\d+)<\/int>/g;
                    let rgMatch: RegExpExecArray | null;
                    while ((rgMatch = rgIdRegex.exec(rgListResp.body)) !== null) {
                      const rgId = parseInt(rgMatch[1], 10);
                      if (!rgIds.includes(rgId)) rgIds.push(rgId);
                    }
                    console.log(`[Sippy] Available routing groups for probe: [${rgIds.join(', ')}]`);

                    // Helper: try createAccount with specific i_customer setting and a routing group
                    const tryRgProbe = async (rgId: number, customerVal: number | undefined) => {
                      if (customerVal !== undefined) {
                        params.i_customer = customerVal;
                      } else {
                        delete params.i_customer;
                      }
                      params.i_routing_group = rgId;
                      const b = xmlRpcCall(method, params);
                      const r = await sippyPost(apiUrl, b, credentials.username, credentials.password);
                      const t = r.body;
                      const f = t.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim() ?? '';
                      console.log(`[Sippy] RG probe ${rgId} (customer=${customerVal ?? 'session'}): HTTP ${r.statusCode}, fault="${f.slice(0, 120)}"`);
                      return { text: t, fault: f, statusCode: r.statusCode };
                    };

                    // Pass A: no i_customer (use session/reseller context)
                    let rgSucceeded = false;
                    for (const rgId of rgIds) {
                      const { text, fault, statusCode } = await tryRgProbe(rgId, undefined);
                      if (statusCode === 200 && !text.includes('<fault>') && !text.includes('faultCode')) {
                        console.log(`[Sippy] createAccount succeeded with i_routing_group=${rgId} (session context)`);
                        const rgAcct = extractValue(text, 'i_account');
                        return {
                          success: true,
                          message: `Account "${opts.name}" created on Sippy (RG=${rgId}, session context).${rgAcct ? ` (ID: ${parseInt(rgAcct, 10)})` : ''}`,
                          method,
                          i_account:     rgAcct ? parseInt(rgAcct, 10) : undefined,
                          username:      extractValue(text, 'username'),
                          authname:      extractValue(text, 'authname'),
                          web_password:  extractValue(text, 'web_password'),
                          voip_password: extractValue(text, 'voip_password'),
                          vm_password:   extractValue(text, 'vm_password'),
                        };
                      }
                      if (fault && !fault.toLowerCase().includes('fatal error') && !fault.toLowerCase().includes('routing_group') && !fault.toLowerCase().includes('mandatory')) {
                        lastFault = fault;
                        console.log(`[Sippy] Pass A RG ${rgId}: non-fatal different fault — stopping pass A: "${lastFault}"`);
                        rgSucceeded = true; // treat as "routing group accepted, other issue"
                        break;
                      }
                    }

                    // Pass B: explicit i_customer=1 (root customer)
                    if (!rgSucceeded) {
                      console.log('[Sippy] Pass A exhausted — trying Pass B with i_customer=1 explicit...');
                      for (const rgId of rgIds) {
                        const { text, fault, statusCode } = await tryRgProbe(rgId, savedCustomer ?? 1);
                        if (statusCode === 200 && !text.includes('<fault>') && !text.includes('faultCode')) {
                          console.log(`[Sippy] createAccount succeeded with i_routing_group=${rgId} (i_customer=1)`);
                          const rgAcct = extractValue(text, 'i_account');
                          return {
                            success: true,
                            message: `Account "${opts.name}" created on Sippy (RG=${rgId}, root customer).${rgAcct ? ` (ID: ${parseInt(rgAcct, 10)})` : ''}`,
                            method,
                            i_account:     rgAcct ? parseInt(rgAcct, 10) : undefined,
                            username:      extractValue(text, 'username'),
                            authname:      extractValue(text, 'authname'),
                            web_password:  extractValue(text, 'web_password'),
                            voip_password: extractValue(text, 'voip_password'),
                            vm_password:   extractValue(text, 'vm_password'),
                          };
                        }
                        if (fault && !fault.toLowerCase().includes('fatal error') && !fault.toLowerCase().includes('routing_group') && !fault.toLowerCase().includes('mandatory')) {
                          lastFault = fault;
                          console.log(`[Sippy] Pass B RG ${rgId}: non-fatal different fault — "${lastFault}"`);
                          break;
                        }
                      }
                    }

                    // Pass C: Template from existing accounts
                    // All RG probes failed — look up real accounts in Sippy to find a working
                    // (i_customer, i_routing_group) pair, then retry with those values.
                    // This handles setups where routing groups are scoped to sub-customers (not root).
                    if (!rgSucceeded) {
                      console.log('[Sippy] Pass A+B exhausted — probing template from existing accounts...');
                      try {
                        // Step 1: get a sample of account IDs from listAccounts
                        // (listAccounts does NOT return i_routing_group per row,
                        //  so we call getAccountInfo for the first few accounts)
                        const listBody = xmlRpcCall('listAccounts', { limit: 5 });
                        const listResp = await sippyPost(apiUrl, listBody, credentials.username, credentials.password);
                        const listText = listResp.body;
                        console.log(`[Sippy] Pass C listAccounts: HTTP ${listResp.statusCode}, body ${listText.length}B`);
                        // Parse i_account IDs from the accounts array
                        const acctArrayMatch = listText.match(/<name>accounts<\/name>\s*<value>\s*<array>\s*<data>([\s\S]*?)<\/data>\s*<\/array>/);
                        const acctScope = acctArrayMatch ? acctArrayMatch[1] : listText;
                        const acctIds: number[] = [];
                        const acctIdRe = /<name>i_account<\/name>\s*<value><int>(\d+)<\/int>/g;
                        let ai: RegExpExecArray | null;
                        while ((ai = acctIdRe.exec(acctScope)) !== null) {
                          const id = parseInt(ai[1], 10);
                          if (id && !acctIds.includes(id)) acctIds.push(id);
                          if (acctIds.length >= 5) break;
                        }
                        console.log(`[Sippy] Pass C sample account IDs: [${acctIds.join(', ')}]`);

                        // Step 2: call getAccountInfo for each to get i_customer + i_routing_group
                        const templatePairs: Array<{ iCustomer: number; iRg: number }> = [];
                        for (const sampleId of acctIds) {
                          const info = await getAccountInfo(credentials.username, credentials.password, baseUrl, sampleId);
                          if (info?.iCustomer && info?.iRoutingGroup) {
                            const key = `${info.iCustomer}:${info.iRoutingGroup}`;
                            if (!templatePairs.some(p => `${p.iCustomer}:${p.iRg}` === key)) {
                              templatePairs.push({ iCustomer: info.iCustomer!, iRg: info.iRoutingGroup! });
                            }
                          }
                        }
                        console.log(`[Sippy] Pass C template pairs: ${JSON.stringify(templatePairs)}`);

                        // Step 3: try createAccount with each template pair
                        for (const { iCustomer, iRg } of templatePairs) {
                          const { text: tC, fault: fC, statusCode: scC } = await tryRgProbe(iRg, iCustomer);
                          if (scC === 200 && !tC.includes('<fault>') && !tC.includes('faultCode')) {
                            console.log(`[Sippy] createAccount succeeded (template: i_customer=${iCustomer}, RG=${iRg})`);
                            const tAcct = extractValue(tC, 'i_account');
                            return {
                              success: true,
                              message: `Account "${opts.name}" created on Sippy (template customer=${iCustomer}, RG=${iRg}).${tAcct ? ` (ID: ${parseInt(tAcct, 10)})` : ''}`,
                              method,
                              i_account:     tAcct ? parseInt(tAcct, 10) : undefined,
                              username:      extractValue(tC, 'username'),
                              authname:      extractValue(tC, 'authname'),
                              web_password:  extractValue(tC, 'web_password'),
                              voip_password: extractValue(tC, 'voip_password'),
                              vm_password:   extractValue(tC, 'vm_password'),
                            };
                          }
                          if (fC) lastFault = fC;
                        }
                      } catch (tplErr: any) {
                        console.warn('[Sippy] Pass C template error:', tplErr.message);
                      }
                    }
                  } catch (rgProbeErr: any) {
                    console.warn('[Sippy] Routing group probe error:', rgProbeErr.message);
                  }
                }
              }
            }
          } else {
            // Billing plan list API not available — probe via createAccount with IDs 1-20
            console.log('[Sippy] Billing plan list API unavailable — probing plan IDs 1-20 via createAccount...');
            let foundPlan: number | null = null;
            for (const probeId of [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20]) {
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
                const retIAccountStr = extractValue(probeText, 'i_account');
                const retIAccount    = retIAccountStr ? parseInt(retIAccountStr, 10) : undefined;
                return {
                  success: true,
                  message: `Account "${opts.name}" created on Sippy (billing plan auto-probed: ID ${probeId}).${retIAccount ? ` (ID: ${retIAccount})` : ''}`,
                  method,
                  i_account:     retIAccount,
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

        // ── Direct routing-group cascade ─────────────────────────────────────
        // The billing-plan probe block above only fires on "fatal error" or billing
        // plan errors.  When Sippy IMMEDIATELY rejects with "i_routing_group is
        // mandatory for root customer" (e.g. all cached RGs belong to sub-customers),
        // the probe above is skipped entirely and we land here.  Run Pass A/B/C now.
        if (lastFault.toLowerCase().includes('routing_group') && lastFault.toLowerCase().includes('mandatory')) {
          console.log('[Sippy] Direct routing-group cascade — probing all available RGs...');
          try {
            const rgListBody2 = xmlRpcCall('listRoutingGroups', {});
            const rgListResp2 = await sippyPost(apiUrl, rgListBody2, credentials.username, credentials.password);
            const rgIds2: number[] = [];
            const rgIdRe2 = /<name>i_routing_group<\/name>\s*<value><int>(\d+)<\/int>/g;
            let rm2: RegExpExecArray | null;
            while ((rm2 = rgIdRe2.exec(rgListResp2.body)) !== null) {
              const id = parseInt(rm2[1], 10);
              if (!rgIds2.includes(id)) rgIds2.push(id);
            }
            console.log(`[Sippy] Direct cascade RG list: [${rgIds2.join(', ')}]`);

            const tryProbe2 = async (rgId: number, customerVal: number | undefined) => {
              if (customerVal !== undefined) params.i_customer = customerVal; else delete params.i_customer;
              params.i_routing_group = rgId;
              const b = xmlRpcCall(method, params);
              const r = await sippyPost(apiUrl, b, credentials.username, credentials.password);
              const f = r.body.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim() ?? '';
              console.log(`[Sippy] Direct probe RG=${rgId} cust=${customerVal ?? 'session'}: HTTP ${r.statusCode}, fault="${f.slice(0, 100)}"`);
              return { text: r.body, fault: f, statusCode: r.statusCode };
            };

            // Pass A: session context (no explicit i_customer)
            for (const rgId of rgIds2) {
              const { text, fault, statusCode } = await tryProbe2(rgId, undefined);
              if (statusCode === 200 && !text.includes('<fault>') && !text.includes('faultCode')) {
                const acc = extractValue(text, 'i_account');
                return { success: true, message: `Account "${opts.name}" created on Sippy (RG=${rgId}, session).${acc ? ` (ID: ${parseInt(acc,10)})` : ''}`, method, i_account: acc ? parseInt(acc,10) : undefined, username: extractValue(text,'username'), authname: extractValue(text,'authname'), web_password: extractValue(text,'web_password'), voip_password: extractValue(text,'voip_password'), vm_password: extractValue(text,'vm_password') };
              }
              if (fault) lastFault = fault;
            }

            // Pass B: explicit i_customer=1
            for (const rgId of rgIds2) {
              const { text, fault, statusCode } = await tryProbe2(rgId, 1);
              if (statusCode === 200 && !text.includes('<fault>') && !text.includes('faultCode')) {
                const acc = extractValue(text, 'i_account');
                return { success: true, message: `Account "${opts.name}" created on Sippy (RG=${rgId}, root cust).${acc ? ` (ID: ${parseInt(acc,10)})` : ''}`, method, i_account: acc ? parseInt(acc,10) : undefined, username: extractValue(text,'username'), authname: extractValue(text,'authname'), web_password: extractValue(text,'web_password'), voip_password: extractValue(text,'voip_password'), vm_password: extractValue(text,'vm_password') };
              }
              if (fault) lastFault = fault;
            }

            // Pass C: template from existing accounts via getAccountInfo
            console.log('[Sippy] Direct Pass C — template probe from existing accounts...');
            const listBody2 = xmlRpcCall('listAccounts', { limit: 5 });
            const listResp2 = await sippyPost(apiUrl, listBody2, credentials.username, credentials.password);
            console.log(`[Sippy] Direct Pass C listAccounts: HTTP ${listResp2.statusCode}, body ${listResp2.body.length}B`);
            const acctIds2: number[] = [];
            const acctIdRe2 = /<name>i_account<\/name>\s*<value><int>(\d+)<\/int>/g;
            let ai2: RegExpExecArray | null;
            while ((ai2 = acctIdRe2.exec(listResp2.body)) !== null) {
              const id = parseInt(ai2[1], 10);
              if (id && !acctIds2.includes(id)) acctIds2.push(id);
              if (acctIds2.length >= 5) break;
            }
            console.log(`[Sippy] Direct Pass C account IDs: [${acctIds2.join(', ')}]`);
            const pairs2: Array<{iCustomer: number; iRg: number}> = [];
            for (const sid of acctIds2) {
              const info = await getAccountInfo(credentials.username, credentials.password, baseUrl, sid);
              if (info?.iCustomer && info?.iRoutingGroup) {
                const key = `${info.iCustomer}:${info.iRoutingGroup}`;
                if (!pairs2.some(p => `${p.iCustomer}:${p.iRg}` === key)) {
                  pairs2.push({ iCustomer: info.iCustomer!, iRg: info.iRoutingGroup! });
                }
              }
            }
            console.log(`[Sippy] Direct Pass C template pairs: ${JSON.stringify(pairs2)}`);
            for (const { iCustomer, iRg } of pairs2) {
              const { text, fault, statusCode } = await tryProbe2(iRg, iCustomer);
              if (statusCode === 200 && !text.includes('<fault>') && !text.includes('faultCode')) {
                const acc = extractValue(text, 'i_account');
                return { success: true, message: `Account "${opts.name}" created on Sippy (template cust=${iCustomer} RG=${iRg}).${acc ? ` (ID: ${parseInt(acc,10)})` : ''}`, method, i_account: acc ? parseInt(acc,10) : undefined, username: extractValue(text,'username'), authname: extractValue(text,'authname'), web_password: extractValue(text,'web_password'), voip_password: extractValue(text,'voip_password'), vm_password: extractValue(text,'vm_password') };
              }
              if (fault) lastFault = fault;
            }
          } catch (dcErr: any) {
            console.warn('[Sippy] Direct cascade error:', dcErr.message);
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
      console.error(`[Sippy] ${method} error: ${e.message}`);
      lastFault = e.message;
    }
  }

  // ── Translation-rule strip cascade ───────────────────────────────────────────
  // If all retries resulted in "Fatal error" AND we have non-empty translation rules,
  // try one more time with blank rules.  Some Sippy versions return faultCode 501
  // "Fatal error" when the translation_rule format is not supported, even though
  // the routing group and billing plan are valid.  If this succeeds, the admin can
  // set the rule manually in Sippy → Customers → Accounts → Edit.
  if (!isVendor && lastFault.toLowerCase() === 'fatal error' &&
      (params.translation_rule || params.cli_translation_rule)) {
    const savedTransRule    = params.translation_rule;
    const savedCliTransRule = params.cli_translation_rule;
    params.translation_rule    = '';
    params.cli_translation_rule = '';
    console.log(`[Sippy] Strip translation rules (was: "${savedTransRule}") — final createAccount retry...`);
    try {
      const stripBody = xmlRpcCall('createAccount', params);
      const stripResp = await sippyPost(apiUrl, stripBody, credentials.username, credentials.password);
      const stripText = stripResp.body;
      const stripFault = stripText.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim() ?? '';
      console.log(`[Sippy] Strip-rules retry: HTTP ${stripResp.statusCode}, fault="${stripFault.slice(0, 120)}"`);
      if (stripResp.statusCode === 200 && !stripText.includes('<fault>') && !stripText.includes('faultCode')) {
        const acc = extractValue(stripText, 'i_account');
        const note = savedTransRule ? ` CLD rule "${savedTransRule}" could not be applied automatically — set it in Sippy → Accounts → Edit if needed.` : '';
        return {
          success: true,
          message: `Account "${opts.name}" created on Sippy (translation rules stripped).${acc ? ` (ID: ${parseInt(acc, 10)})` : ''}${note}`,
          method: 'createAccount',
          i_account:     acc ? parseInt(acc, 10) : undefined,
          username:      extractValue(stripText, 'username'),
          authname:      extractValue(stripText, 'authname'),
          web_password:  extractValue(stripText, 'web_password'),
          voip_password: extractValue(stripText, 'voip_password'),
          vm_password:   extractValue(stripText, 'vm_password'),
        };
      }
      if (stripFault) lastFault = stripFault;
    } catch (e: any) {
      console.warn('[Sippy] Strip-rules retry error:', e.message);
    }
    // Restore original values regardless of outcome
    params.translation_rule    = savedTransRule;
    params.cli_translation_rule = savedCliTransRule;
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
  iTariff?: number;   // i_tariff from getServicePlanInfo — used for tariff-ID-based matching
}

// ── In-memory cache for billing plans (5-minute TTL) ─────────────────────────
const _bpCache: Map<string, { plans: SippyBillingPlan[]; ts: number }> = new Map();
const BP_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/** Clear the billing-plan cache for all hosts (or a specific base URL prefix). */
export function clearBillingPlanCache(basePrefix?: string): void {
  if (!basePrefix) { _bpCache.clear(); return; }
  for (const k of _bpCache.keys()) { if (k.startsWith(basePrefix)) _bpCache.delete(k); }
}

export async function listSippyBillingPlans(
  username: string,
  password: string,
  portalUrl?: string,
  bustCache?: boolean,
): Promise<{ plans: SippyBillingPlan[]; error?: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { plans: [], error: 'Not connected to Sippy.' };
  const apiUrl = `${base}/xmlapi/xmlapi`;

  // Return cached result if still fresh (skip when bustCache=true)
  const cacheKey = `${base}:${username}`;
  if (!bustCache) {
    const cached = _bpCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < BP_CACHE_TTL) {
      return { plans: cached.plans };
    }
  } else {
    _bpCache.delete(cacheKey);
  }

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
        const fault = extractFaultString(text)?.replace(/<[^>]+>/g, '').trim() ?? '';
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
        const currency = m['currency'] || m['iso_4217'] || undefined;
        const iTariff = m['i_tariff'] ? parseInt(m['i_tariff'], 10) : undefined;
        if (id) plans.push({ id, name, ...(currency ? { currency } : {}), ...(iTariff ? { iTariff } : {}) });
      }
      console.log(`[Sippy] listSippyBillingPlans: found ${plans.length} plans via ${method}`);
      _bpCache.set(cacheKey, { plans, ts: Date.now() });
      return { plans };
    } catch { continue; }
  }

  // ── Fallback: probe IDs 1–200 in batches via getServicePlanInfo ─────────
  // getServicePlanInfo() is the only documented XML-RPC method for service plans
  // (Sippy XML-RPC API has no list or create method for billing/service plans).
  // Run probes in batches of 10 to avoid overwhelming the server.
  // Stop early when an entire batch returns no results (gap detection).
  console.log('[Sippy] listSippyBillingPlans: list API unavailable — probing IDs 1-200 via getServicePlanInfo');
  const probedPlans: SippyBillingPlan[] = [];
  const BATCH = 10;
  const MAX_ID = 200;
  const MAX_CONSECUTIVE_EMPTY = 2; // stop after 2 consecutive empty batches
  let consecutiveEmpty = 0;
  for (let start = 1; start <= MAX_ID; start += BATCH) {
    const ids = Array.from({ length: BATCH }, (_, i) => start + i).filter(i => i <= MAX_ID);
    const batchResults = await Promise.allSettled(
      ids.map(async (id) => {
        const params: Record<string, string | number> = { i_billing_plan: id };
        const resp = await sippyPost(apiUrl, xmlRpcCall('getServicePlanInfo', params), username, password);
        if (resp.statusCode !== 200 || resp.body.includes('<fault>')) return null;
        const m = extractStructMembers(resp.body);
        const name = m['name'];
        if (!name) return null;
        const currency = m['iso_4217'] || m['currency'] || undefined;
        const iTariff = m['i_tariff'] ? parseInt(m['i_tariff'], 10) : undefined;
        return { id, name, ...(currency ? { currency } : {}), ...(iTariff ? { iTariff } : {}) } as SippyBillingPlan;
      })
    );
    let batchFound = 0;
    for (const r of batchResults) {
      if (r.status === 'fulfilled' && r.value !== null) { probedPlans.push(r.value); batchFound++; }
    }
    if (batchFound === 0) {
      consecutiveEmpty++;
      if (consecutiveEmpty >= MAX_CONSECUTIVE_EMPTY) break; // stop probing — no more plans expected
    } else {
      consecutiveEmpty = 0; // reset gap counter when we find something
    }
  }
  if (probedPlans.length > 0) {
    console.log(`[Sippy] listSippyBillingPlans: found ${probedPlans.length} plans via probe:`, probedPlans.map(p => `${p.name}(#${p.id})`).join(', '));
    _bpCache.set(cacheKey, { plans: probedPlans, ts: Date.now() });
    return { plans: probedPlans };
  }

  return { plans: [], error: 'No billing plan list method found on this Sippy instance. Create Service Plans in your Sippy portal (Billing → Service Plans) first.' };
}

// ── createSippyServicePlan — portal form POST ─────────────────────────────────
// Creates a new Service Plan in Sippy by POST-ing to service_plans.php.
// Sippy has no XML-RPC API for this; we reuse the admin portal session.
// Form fields reverse-engineered from service_plans.php "Add New Plan" HTML.
//
// Returns { needsManualCreation: true } when the web portal is not accessible
// (e.g. ssp-root cannot log in via the self-care portal) so the caller can
// surface clear guidance to the user rather than a confusing error.
export async function createSippyServicePlan(
  portalUrl: string,
  adminUser: string,
  adminPass: string,
  portalUser: string,
  portalPass: string,
  planName: string,
  iTariff: number,
  description?: string,
  billingCycle?: number,
  adminWebPassword?: string,
): Promise<{ success: boolean; planId?: number; planName?: string; error?: string; needsManualCreation?: boolean; alreadyExists?: boolean }> {
  const base = sippyBase(portalUrl);

  // ── Step 0: check if a plan already exists via XML-RPC ───────────────────
  // Matches by name first; falls back to tariff-ID match (i_tariff from getServicePlanInfo).
  // This handles both "already created manually" and portal-inaccessible scenarios.
  try {
    const existing = await listSippyBillingPlans(adminUser, adminPass, portalUrl);
    // Primary: exact name match (case-insensitive)
    const nameMatch = existing.plans.find(p => p.name.trim().toLowerCase() === planName.trim().toLowerCase());
    if (nameMatch) {
      console.log(`[Sippy] createSippyServicePlan: reusing existing plan by name "${nameMatch.name}" id=${nameMatch.id}`);
      return { success: true, planId: nameMatch.id, planName: nameMatch.name, alreadyExists: true };
    }
    // Secondary: tariff-ID match — finds a service plan linked to the same tariff even if
    // the plan was created manually with a slightly different name.
    const tariffMatch = existing.plans.find(p => p.iTariff === iTariff);
    if (tariffMatch) {
      console.log(`[Sippy] createSippyServicePlan: reusing existing plan by tariff match "${tariffMatch.name}" id=${tariffMatch.id} (i_tariff=${iTariff})`);
      return { success: true, planId: tariffMatch.id, planName: tariffMatch.name, alreadyExists: true };
    }
  } catch { /* ignore — continue to portal attempt */ }

  // ── Step 0.5: Try XML-RPC addBillingPlan first (no scraping needed) ─────────
  // Sippy may expose a billing plan creation method via XML-RPC.
  // Try multiple method names and both flat/nested param shapes across Sippy versions.
  {
    const apiUrl = `${portalUrl.replace(/\/+$/, '')}/xmlapi/xmlapi`;
    const bpParams = {
      name:          planName,
      i_tariff:      iTariff,
      billing_cycle: billingCycle ?? 3,
    };
    // Flat-params variants
    const flatMethods = ['addBillingPlan', 'addServicePlan', 'createBillingPlan', 'billing_plan.add'];
    // Nested variants (billing_plan_info wrapper, common Sippy pattern)
    const nestedKey = 'billing_plan_info';
    for (const method of flatMethods) {
      for (const useNested of [false, true]) {
        try {
          const xml = useNested
            ? xmlRpcCallNested(method, nestedKey, bpParams as Record<string, string | number | boolean | null>)
            : xmlRpcCall(method, bpParams as Record<string, string | number | boolean | null>);
          const r = await sippyPost(apiUrl, xml, adminUser, adminPass, 8000);
          if (r.statusCode !== 200) continue;
          if (r.body.includes('faultCode')) {
            const fault = extractFaultString(r.body) ?? '';
            if (/unknown method|not found|not supported|no method/i.test(fault)) break; // try next method
            console.log(`[Sippy] createSippyServicePlan XML-RPC ${method}: fault "${fault}"`);
            continue;
          }
          // Success: parse the returned i_billing_plan from the XML response
          const idMatch = r.body.match(/<int>(\d+)<\/int>/) || r.body.match(/<value><int>(\d+)<\/int>/);
          if (idMatch) {
            const planId = parseInt(idMatch[1], 10);
            if (planId > 0) {
              console.log(`[Sippy] createSippyServicePlan: created via XML-RPC ${method} → i_billing_plan=${planId}`);
              for (const k of _bpCache.keys()) { if (k.startsWith(base)) _bpCache.delete(k); }
              return { success: true, planId, planName };
            }
          }
          console.log(`[Sippy] createSippyServicePlan XML-RPC ${method} OK but no plan ID in response`);
        } catch { /* next */ }
      }
    }
  }

  // ── Step 1: obtain a provisioning session via the isolated write plane ────────
  // provisioningLogin() reads ONLY SIPPY_PROV_USERNAME / SIPPY_PROV_PASSWORD.
  // Throws PROVISIONING_NOT_CONFIGURED when credentials are absent → manual fallback.
  // Session is function-scoped: discarded automatically when this function returns.
  type SessionCandidate = { cookies: CookieJar; label: string; iCustomer?: string };
  const allSessions: SessionCandidate[] = [];
  try {
    const provCookies = await provisioningLogin(base);
    console.log('[Sippy] createSippyServicePlan: provisioning session obtained');
    allSessions.push({ cookies: provCookies, label: `prov:${process.env.SIPPY_PROV_USERNAME}`, iCustomer: '1' });
  } catch (e: any) {
    if (e?.message === 'PROVISIONING_NOT_CONFIGURED') {
      console.log('[Sippy] createSippyServicePlan: PROVISIONING_NOT_CONFIGURED — returning manual fallback');
      return {
        success: false,
        needsManualCreation: true,
        error: 'Provisioning credentials (SIPPY_PROV_USERNAME / SIPPY_PROV_PASSWORD) are not configured. Add a Sippy reseller/admin account to the secrets vault to enable automated service plan creation.',
      };
    }
    console.log(`[Sippy] createSippyServicePlan: provisioningLogin failed — ${e?.message}`);
    return {
      success: false,
      needsManualCreation: true,
      error: `Provisioning login failed: ${e?.message}. Check that SIPPY_PROV_USERNAME / SIPPY_PROV_PASSWORD are correct reseller/admin credentials.`,
    };
  }
  console.log(`[Sippy] createSippyServicePlan: using provisioning session: ${allSessions.map(s => s.label).join(', ')}`);

  // ── Step 2: POST service_plans.php — try each session in priority order ───────
  // NOTE: do NOT include i_billing_plan — empty string crashes Sippy's PHP (HTTP 500).
  // account/admin sessions include i_customer='1' in both the URL and POST body so
  // Sippy's PHP knows which customer context to create the plan under.
  // Field order and values match a real browser POST captured from service_plans.php.
  // Missing or mis-valued fields cause Sippy PHP to reject the form silently or crash.
  const basePostFields = {
    bp_name:                     planName,
    i_tariff:                    String(iTariff),
    i_onnet_tariff:              '-1',
    billing_cycle:               String(billingCycle ?? 1),
    i_billing_day:               '-1',
    description:                 description ?? '',
    i_billing_plan_suspend_mode: '1',
    prepaid:                     '1',
    round_up:                    '1',
    // Service charge block
    sc_description:              '',
    sc_price:                    '0.0000',
    // Accessibility surcharge block
    as_cld:                      '',
    as_connect_fee:              '0.0000',
    as_free_seconds:             '0',
    as_grace_period:             '0',
    as_price_1:                  '0.0000',
    as_price_n:                  '0.0000',
    as_interval_1:               '1',
    as_interval_n:               '1',
    // Service package block
    sp_description:              '',
    sp_seconds_total:            'Unlimited',
    sp_price:                    '0.0000',
    sp_interval_1:               '0',
    sp_interval_n:               '1',
    sp_grace_period_enable:      '1',
    // Control fields
    action:                      'add',
    n:                           '',
    name:                        '',
    name_clause:                 '',
    save_and_close:              'Save & Close',
    links:                       '0',
    keep_db_history:             '1',
    i_service_charge:            '',
    i_accessibility_surcharge:   '',
    i_service_plan:              '',
  };

  let resp!: Awaited<ReturnType<typeof rawRequest>>;
  let usedSession = '';
  for (const { cookies, label, iCustomer } of allSessions) {
    try {
      // Service plans live under /c1/ (customer self-care portal), not root.
      // Root /service_plans.php requires an admin-panel session which we cannot obtain.
      const postUrl = iCustomer
        ? `${base}/c1/service_plans.php?i_customer=${iCustomer}`
        : `${base}/c1/service_plans.php`;

      // ── Pre-GET: fetch the Add New form to extract CSRF/hidden tokens ───────
      // Sippy generates hidden form tokens on the GET that must be echoed in the POST.
      // IMPORTANT: use the cookies returned by the GET (getResp.cookies) for the POST,
      // not the original cookies — Sippy may refresh session tokens on the GET.
      const hiddenFields: Record<string, string> = {};
      let postCookies = cookies; // default: use login cookies; overwritten if pre-GET succeeds
      try {
        const getUrl = iCustomer
          ? `${base}/c1/service_plans.php?action=add&i_customer=${iCustomer}`
          : `${base}/c1/service_plans.php?action=add`;
        const getResp = await rawRequest('GET', getUrl, null, { 'User-Agent': PORTAL_USER_AGENT }, cookies, 3);
        const preGetSnippet = getResp.body.slice(0, 400).replace(/\s+/g, ' ');
        const hasLoginFormGet = getResp.body.includes('value="Login"') || getResp.body.includes("value='Login'");
        console.log(`[Sippy] createSippyServicePlan pre-GET (${label}): HTTP ${getResp.statusCode}, ${getResp.body.length}B, loginForm=${hasLoginFormGet}, snippet: ${preGetSnippet}`);
        if (getResp.statusCode === 200 && !hasLoginFormGet) {
          // Use cookies from the GET response (session may be refreshed)
          postCookies = getResp.cookies;
          // Extract all <input type="hidden" name="..." value="..."> fields
          const hiddenRe = /<input[^>]+type=["']?hidden["']?[^>]*>/gi;
          let m: RegExpExecArray | null;
          while ((m = hiddenRe.exec(getResp.body)) !== null) {
            const tag = m[0];
            const nameM  = tag.match(/name=["']([^"']+)["']/i);
            const valueM = tag.match(/value=["']([^"']*)["']/i);
            if (nameM && valueM) hiddenFields[nameM[1]] = valueM[1];
          }
          console.log(`[Sippy] createSippyServicePlan pre-GET (${label}): extracted ${Object.keys(hiddenFields).length} hidden fields: ${Object.keys(hiddenFields).join(', ')}, cookies updated=${getResp.cookies.size}`);
        } else {
          console.log(`[Sippy] createSippyServicePlan pre-GET (${label}): skipped — loginForm=${hasLoginFormGet} status=${getResp.statusCode}`);
        }
      } catch (ge: any) {
        console.log(`[Sippy] createSippyServicePlan pre-GET (${label}): error ${ge?.message} — proceeding without tokens`);
      }

      // Merge hidden fields first so our explicit fields take precedence
      const postFields = { ...hiddenFields, ...basePostFields, ...(iCustomer ? { i_customer: iCustomer } : {}) };
      const postBody   = encodeForm(postFields);
      // Use redirectsLeft=5 so a successful POST that redirects to the edit page is followed
      // Use postCookies (updated after pre-GET) so any refreshed session tokens are included
      const r = await rawRequest('POST', postUrl, postBody, { 'User-Agent': PORTAL_USER_AGENT }, postCookies, 5);
      console.log(`[Sippy] createSippyServicePlan POST (${label}) → HTTP ${r.statusCode}, body: ${r.body.length}B, snippet: ${r.body.slice(0, 200).replace(/\s+/g, ' ')}`);
      const isLoginPage    = r.body.includes('value="Login"') || r.body.includes("value='Login'");
      const hasInsertError = /alert\(['"][^'"]*Cannot insert[^'"]*['"]\)/i.test(r.body);
      if (!isLoginPage && !hasInsertError) {
        resp = r;
        usedSession = label;
        break;
      }
      if (isLoginPage)    console.log(`[Sippy] createSippyServicePlan: ${label} → session rejected (login page)`);
      if (hasInsertError) console.log(`[Sippy] createSippyServicePlan: ${label} → "Cannot insert" (no permission)`);
    } catch (e: any) {
      console.log(`[Sippy] createSippyServicePlan: ${label} → error: ${e?.message}`);
    }
  }

  // POST failed — provisioning session authenticated but Sippy rejected the write.
  // This means SIPPY_PROV_USERNAME does not have reseller/admin INSERT permission on this Sippy build.
  if (!resp) {
    console.log('[Sippy] createSippyServicePlan: provisioning session POST rejected (no INSERT permission) — manual creation needed');
    return {
      success: false,
      needsManualCreation: true,
      error: `Provisioning account "${process.env.SIPPY_PROV_USERNAME}" authenticated but Sippy rejected the Service Plan INSERT. Ensure the account has reseller or admin privileges in Sippy, then retry.`,
    };
  }

  // Check for Sippy validation errors in the response HTML
  const bodyLower = resp.body.toLowerCase();
  const hasError = bodyLower.includes('class="error"') || bodyLower.includes('class="err"')
                || bodyLower.includes('required field') || bodyLower.includes('already exists')
                || bodyLower.includes('invalid value');
  if (hasError) {
    const errMatch = resp.body.match(/class="err(?:or)?[^"]*"[^>]*>([\s\S]{0,300}?)<\/[^>]+>/i);
    const errMsg = errMatch ? errMatch[1].replace(/<[^>]+>/g, '').trim() : 'Sippy returned a validation error.';
    return { success: false, error: errMsg };
  }

  // After "Save & Close", Sippy redirects to the edit page containing the new plan ID.
  const planIdMatch =
    resp.body.match(/name=["']i_billing_plan["'][^>]*value=["'](\d+)["']/i) ||
    resp.body.match(/value=["'](\d+)["'][^>]*name=["']i_billing_plan["']/i);

  if (planIdMatch) {
    const planId = parseInt(planIdMatch[1], 10);
    if (planId > 0) {
      console.log(`[Sippy] createSippyServicePlan: plan "${planName}" created → i_billing_plan=${planId}`);
      for (const k of _bpCache.keys()) { if (k.startsWith(base)) _bpCache.delete(k); }
      return { success: true, planId, planName };
    }
  }

  // Fallback: scrape the service plan list page for the newly created plan
  try {
    const listResp = await rawRequest('GET', `${base}/c1/service_plans.php`, null, { 'User-Agent': PORTAL_USER_AGENT }, resp.cookies);
    if (!listResp.body.includes('value="Login"')) {
      const linkRe = /service_plans\.php\?[^"']*i_billing_plan=(\d+)/gi;
      let m: RegExpExecArray | null;
      const nameEscaped = planName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      while ((m = linkRe.exec(listResp.body)) !== null) {
        const planId = parseInt(m[1], 10);
        const snippet = listResp.body.slice(Math.max(0, m.index - 200), m.index + 200);
        if (new RegExp(nameEscaped, 'i').test(snippet) && planId > 0) {
          console.log(`[Sippy] createSippyServicePlan: found "${planName}" via list scrape → i_billing_plan=${planId}`);
          for (const k of _bpCache.keys()) { if (k.startsWith(base)) _bpCache.delete(k); }
          return { success: true, planId, planName };
        }
      }
    }
  } catch { /* ignore */ }

  // Could not confirm the ID — treat as needing manual verification
  return {
    success: false,
    needsManualCreation: true,
    error: 'Service plan was submitted but the ID could not be confirmed. Check Sippy portal → Billing → Service Plans.',
  };
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
  // Normalise dates — HTML datetime-local produces "YYYY-MM-DDTHH:MM" (no seconds, no TZ).
  // Sippy expects "YYYY-MM-DD HH:MM" — pure string manipulation, NO timezone conversion.
  // Using new Date() would silently shift the time by the server's UTC offset (e.g. PKT+5
  // turns 16:30 local → 11:30 UTC, activating the rate 5 hours too early).
  // The legacy BitsAuto system (which works) sends exactly "YYYY-MM-DD HH:MM" as typed.
  function normaliseSippyDate(raw: string): string {
    // Replace T separator, strip seconds suffix if present, then re-append :00
    // Legacy BitsAuto sends "2026-06-17 13:30:00" — Sippy stores & validates with seconds.
    const s = raw.trim().replace('T', ' ').replace(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}):\d{2}.*$/, '$1');
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) return `${s}:00`;       // "YYYY-MM-DD HH:MM:SS"
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw.trim()))      return `${raw.trim()} 00:00:00`; // date-only
    return raw; // pass through unchanged if format is unrecognised
  }
  if (entry.effectiveFrom) {
    const v = normaliseSippyDate(entry.effectiveFrom);
    params.activation_date = v;
    params.start_date      = v;
  }
  if (entry.effectiveTill) {
    const v = normaliseSippyDate(entry.effectiveTill);
    params.expiration_date = v;
    params.end_date        = v;
  }

  // Helper: extract faultCode + faultString from an XML-RPC <fault> block.
  // Standard XML-RPC wraps them in <member><name>faultString</name><value>...</value></member>,
  // NOT as direct tags — extractTag(body,'faultString') always returns empty.
  function extractXmlRpcFault(body: string): { code: string; str: string } {
    const faultBlock = extractTag(body, 'fault') ?? '';
    const members    = extractStructMembers(faultBlock || body);
    return {
      code: members['faultCode']   ?? extractTag(body, 'faultCode')   ?? '',
      str:  members['faultString'] ?? extractTag(body, 'faultString') ?? '',
    };
  }

  // ── Discover available methods via system.listMethods ───────────────────────
  // Filter for any write methods related to "rate" or "tariff" that we haven't tried.
  const discoveredRateMethods: string[] = [];
  try {
    const lmResp = await sippyPost(apiUrl, xmlRpcCall('system.listMethods', {}), username, password, 6000);
    if (lmResp.statusCode === 200 && !lmResp.body.includes('<fault>')) {
      const strRe = /<string>([^<]+)<\/string>/g;
      let sm: RegExpExecArray | null;
      while ((sm = strRe.exec(lmResp.body)) !== null) {
        const name = sm[1].trim();
        // Keep write-style rate/tariff methods (exclude get/list/fetch/describe)
        if (/rate|tariff/i.test(name) && !/^(get|list|fetch|describe|show)/i.test(name.split('.').pop() ?? name)) {
          discoveredRateMethods.push(name);
        }
      }
      console.log(`[Sippy] setSippyRateEntry: system.listMethods found ${discoveredRateMethods.length} write rate/tariff methods: ${discoveredRateMethods.join(', ')}`);
    }
  } catch (lme: any) {
    console.log(`[Sippy] setSippyRateEntry: system.listMethods error: ${lme.message}`);
  }

  // Probe discovered methods first, then fall back to known candidates
  const knownMethods = [
    'addRateToTariff', 'addRateInTariff', 'addRatesToTariff',
    'setRateInTariff', 'setRateToTariff', 'updateRateInTariff',
    'addRateTariff', 'tariff.setRate', 'tariff.addDestination', 'rate.setRate',
    // Simpler legacy names
    'addRate', 'setRate', 'updateRate', 'insertRate',
  ];
  const methodsToTry = Array.from(new Set([...discoveredRateMethods, ...knownMethods]));

  // Probe all known + plausible method names — Sippy 2022+ and legacy
  for (const method of methodsToTry) {
    try {
      const body = xmlRpcCall(method, params);
      const resp = await sippyPost(apiUrl, body, username, password);
      console.log(`[Sippy] setSippyRateEntry ${method}: HTTP ${resp.statusCode} body=${resp.body.substring(0, 300)}`);
      if (resp.statusCode === 200 && !resp.body.includes('<fault>')) {
        return { success: true, message: `Rate saved via ${method}` };
      }
      const { code, str } = extractXmlRpcFault(resp.body);
      const fault = str
        ? `${method}: ${str}${code ? ` (code ${code})` : ''}`
        : `${method} HTTP ${resp.statusCode}`;
      lastErrors.push(fault);
    } catch (e: any) { lastErrors.push(`${method} exception: ${e.message}`); }
  }
  // ── All XML-RPC methods failed (Sippy has no rate write API) ────────────────
  // Fall back to portal CSV upload — the only reliable rate-push mechanism.
  console.log(`[Sippy] setSippyRateEntry: all XML-RPC methods failed — falling back to portal CSV upload`);
  const portalResult = await pushRateViaPortalUpload(
    base, Number(tariffId), entry.prefix, entry.rate,
    entry.effectiveFrom, entry.effectiveTill,
  );
  if (portalResult.success) return portalResult;

  // Surface all errors: XML-RPC errors + portal error
  return {
    success: false,
    message: `XML-RPC (${lastErrors.length} methods): all 404 | Portal CSV: ${portalResult.message}`,
  };
}

// ── pushRateViaPortalUpload ───────────────────────────────────────────────────
// Pushes a single rate to a Sippy tariff via portal CSV upload (multipart POST).
// This is the ONLY way to add/update rates in Sippy — there are no XML-RPC write
// methods for rates (only getTariffRatesList + deleteAllRatesInTariff exist).
//
// Uses Action=AS (add-or-update by prefix) which behaves like an upsert:
//   • if a rate already exists for this prefix → updates price/dates
//   • if no rate exists → adds it as a new entry
//
// Sippy docs: https://support.sippysoft.com/a/solutions/articles/84153 (Actions)
//             https://support.sippysoft.com/a/solutions/articles/3000118878 (Rates API)
async function pushRateViaPortalUpload(
  base: string,
  iTariff: number,
  prefix: string,
  rate: number,
  effectiveFrom?: string,
  effectiveTill?: string,
): Promise<{ success: boolean; message: string }> {
  // ── Step 1: provisioning session ─────────────────────────────────────────
  let loginCookies: CookieJar;
  try {
    loginCookies = await provisioningLogin(base);
  } catch (e: any) {
    return { success: false, message: `Portal login failed: ${e?.message}` };
  }

  // ── Step 2: GET the tariff rates page to extract upload form details ──────
  // Use the fresher cookies returned by this GET for the subsequent POST.
  const ratesPageUrl = `${base}/c1/rates.php?i_tariff=${iTariff}`;
  const hiddenFields: Record<string, string> = {};
  let fileFieldName = 'rate_file';   // common Sippy default; overridden if found in form
  let formAction    = ratesPageUrl;
  let postCookies   = loginCookies;

  try {
    const pageResp = await rawRequest('GET', ratesPageUrl, null, { 'User-Agent': PORTAL_USER_AGENT }, loginCookies, 3);
    postCookies = pageResp.cookies; // always use refreshed cookies for POST
    const hasLoginForm = pageResp.body.includes('value="Login"') || pageResp.body.includes("value='Login'");
    console.log(`[Sippy] pushRateViaPortalUpload GET (${ratesPageUrl}): HTTP ${pageResp.statusCode}, ${pageResp.body.length}B, loginForm=${hasLoginForm}`);

    if (pageResp.statusCode === 200 && !hasLoginForm) {
      // ── Extract upload form: action URL ────────────────────────────────
      const formMatch = pageResp.body.match(/<form[^>]+enctype=["']multipart\/form-data["'][^>]*>/i)
                     ?? pageResp.body.match(/<form[^>]+id=["'][^"']*upload[^"']*["'][^>]*>/i);
      if (formMatch) {
        const actionM = formMatch[0].match(/action=["']([^"']+)["']/i);
        if (actionM) formAction = new URL(actionM[1], ratesPageUrl).toString();
      }
      // ── Extract file input name ─────────────────────────────────────────
      const fileInputM = pageResp.body.match(/<input[^>]+type=["']?file["']?[^>]*>/i);
      if (fileInputM) {
        const nameM = fileInputM[0].match(/name=["']([^"']+)["']/i);
        if (nameM) fileFieldName = nameM[1];
      }
      // ── Extract all hidden fields ──────────────────────────────────────
      const hiddenRe = /<input[^>]+type=["']?hidden["']?[^>]*>/gi;
      let hm: RegExpExecArray | null;
      while ((hm = hiddenRe.exec(pageResp.body)) !== null) {
        const nM = hm[0].match(/name=["']([^"']+)["']/i);
        const vM = hm[0].match(/value=["']([^"']*)["']/i);
        if (nM && vM) hiddenFields[nM[1]] = vM[1];
      }
      console.log(`[Sippy] pushRateViaPortalUpload: formAction=${formAction}, fileField=${fileFieldName}, hidden=${Object.keys(hiddenFields).join(',')}`);
    }
  } catch (ge: any) {
    console.log(`[Sippy] pushRateViaPortalUpload: GET rates page error: ${ge?.message} — proceeding with defaults`);
  }

  // ── Step 3: build the CSV ─────────────────────────────────────────────────
  // Format: Action,i_rate,Prefix,Price1,PriceN,Interval1,IntervalN,ForbiddenFlag,GracePeriodEnable,ActivationDate,ExpirationDate
  // Action AS = add-or-update by prefix (upsert). i_rate left empty for AS action.
  // Dates: "YYYY-MM-DD HH:MM:SS" — pure string manipulation, NO timezone conversion.
  // Legacy BitsAuto (confirmed working) sends "2026-06-17 13:30:00"; Sippy validates format
  // strictly and returns PARSEERROR01 for an invalid activation date.
  function normDate(raw?: string): string {
    if (!raw) return '';
    const s = raw.trim().replace('T', ' ').replace(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}):\d{2}.*$/, '$1');
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) return `${s}:00`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw.trim()))      return `${raw.trim()} 00:00:00`;
    return '';
  }
  const csvHeader = 'Action,i_rate,Prefix,Price1,PriceN,Interval1,IntervalN,ForbiddenFlag,GracePeriodEnable,ActivationDate,ExpirationDate';
  const csvRow    = `AS,,${prefix},${rate},${rate},1,1,,,${normDate(effectiveFrom)},${normDate(effectiveTill)}`;
  const csvContent = `${csvHeader}\r\n${csvRow}`;
  console.log(`[Sippy] pushRateViaPortalUpload: CSV row: ${csvRow}`);

  // ── Step 4: multipart/form-data POST ─────────────────────────────────────
  // rawRequest supports multipart when the body is pre-built and Content-Type
  // is overridden via extraHeaders (extraHeaders wins over the hardcoded header).
  const boundary = `----SippyRateBoundary${Date.now().toString(36)}`;
  const parts: string[] = [];

  // Include hidden fields (CSRF tokens etc.) first
  for (const [k, v] of Object.entries(hiddenFields)) {
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}`);
  }
  // File field with the CSV content
  parts.push(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="${fileFieldName}"; filename="rates.csv"\r\n` +
    `Content-Type: text/csv\r\n\r\n${csvContent}`
  );
  const multipartBody = parts.join('\r\n') + `\r\n--${boundary}--`;

  try {
    const uploadResp = await rawRequest(
      'POST', formAction, multipartBody,
      { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      postCookies, 5,
    );
    const body         = uploadResp.body;
    const isLoginPage  = body.includes('value="Login"') || body.includes("value='Login'");
    const hasError     = /class=["']err[^"']*["']/i.test(body) || /upload.*fail|fail.*upload/i.test(body);
    const hasSuccess   = /success|updated|processed|OK/i.test(body) || uploadResp.statusCode === 200;
    console.log(`[Sippy] pushRateViaPortalUpload POST: HTTP ${uploadResp.statusCode}, ${body.length}B, login=${isLoginPage}, err=${hasError}, success=${hasSuccess}, snippet=${body.slice(0, 300).replace(/\s+/g, ' ')}`);

    if (isLoginPage) return { success: false, message: 'Portal CSV upload: session rejected (login page returned)' };
    if (hasError) {
      const errM = body.match(/class=["']err[^"']*["'][^>]*>([^<]{0,300})/i);
      return { success: false, message: `Portal CSV error: ${errM ? errM[1].trim() : 'Sippy returned an error response'}` };
    }
    if (hasSuccess) return { success: true, message: `Rate pushed via portal CSV upload (Action=AS, prefix=${prefix})` };

    return { success: false, message: `Portal CSV upload: unexpected response (HTTP ${uploadResp.statusCode}, ${body.length}B)` };
  } catch (e: any) {
    return { success: false, message: `Portal CSV upload exception: ${e?.message}` };
  }
}

// ── probePortalRatesPage ──────────────────────────────────────────────────────
// READ-ONLY diagnostic: verifies portal login works and the tariff rates page
// is reachable, then reports what upload form fields it found.
// Does NOT modify any rate. Use GET /api/sippy/rates/portal-probe?tariffId=N.
export async function probePortalRatesPage(
  base: string,
  iTariff: number,
): Promise<{
  ok: boolean;
  loginOk: boolean;
  ratesPageOk: boolean;
  formFound: boolean;
  fileField: string;
  hiddenFields: string[];
  formAction: string;
  bodySnippet: string;
  error?: string;
}> {
  const fail = (error: string) => ({
    ok: false, loginOk: false, ratesPageOk: false, formFound: false,
    fileField: '', hiddenFields: [], formAction: '', bodySnippet: '', error,
  });
  let loginOk = false;
  let cookies: CookieJar;
  try {
    cookies = await provisioningLogin(base);
    loginOk = true;
  } catch (e: any) {
    return fail(`Portal login failed: ${e?.message}`);
  }
  const ratesPageUrl = `${base}/c1/rates.php?i_tariff=${iTariff}`;
  try {
    const resp = await rawRequest('GET', ratesPageUrl, null, { 'User-Agent': PORTAL_USER_AGENT }, cookies, 3);
    const isLoginPage = resp.body.includes('value="Login"') || resp.body.includes("value='Login'");
    if (isLoginPage) {
      return { ok: false, loginOk, ratesPageOk: false, formFound: false,
        fileField: '', hiddenFields: [], formAction: ratesPageUrl,
        bodySnippet: resp.body.slice(0, 300), error: 'Rates page returned login form (session rejected)' };
    }
    // Extract upload form fields
    let fileField = 'rate_file';
    let formAction = ratesPageUrl;
    const hiddenFields: string[] = [];
    const formMatch = resp.body.match(/<form[^>]+enctype=["']multipart\/form-data["'][^>]*>/i)
                   ?? resp.body.match(/<form[^>]+id=["'][^"']*upload[^"']*["'][^>]*>/i);
    const formFound = !!formMatch;
    if (formMatch) {
      const aM = formMatch[0].match(/action=["']([^"']+)["']/i);
      if (aM) formAction = new URL(aM[1], ratesPageUrl).toString();
    }
    const fileM = resp.body.match(/<input[^>]+type=["']?file["']?[^>]*>/i);
    if (fileM) { const nM = fileM[0].match(/name=["']([^"']+)["']/i); if (nM) fileField = nM[1]; }
    const hidRe = /<input[^>]+type=["']?hidden["']?[^>]*>/gi;
    let hm: RegExpExecArray | null;
    while ((hm = hidRe.exec(resp.body)) !== null) {
      const nM = hm[0].match(/name=["']([^"']+)["']/i);
      if (nM) hiddenFields.push(nM[1]);
    }
    return {
      ok: true, loginOk, ratesPageOk: true, formFound,
      fileField, hiddenFields, formAction,
      bodySnippet: resp.body.slice(0, 500).replace(/\s+/g, ' '),
    };
  } catch (e: any) {
    return { ok: false, loginOk, ratesPageOk: false, formFound: false,
      fileField: '', hiddenFields: [], formAction: ratesPageUrl,
      bodySnippet: '', error: `Rates page fetch error: ${e?.message}` };
  }
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
        ?? extractFaultString(text) ?? 'listCustomers failed.';
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
        ?? extractFaultString(text) ?? 'resetCustomerOneTimePassword failed.';
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
        ?? extractFaultString(text) ?? 'authCustomer failed.';
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
        ?? extractFaultString(text) ?? 'getCustomerInfo failed.';
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
    const fault = extractFaultString(text) ?? 'createCustomer failed.';
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

  // Try multiple XML-RPC method names. Sippy older releases use plain 'getAccountInfo';
  // newer / admin-mode builds require 'customer.getAccountInfo' for cross-account lookups.
  const methods = ['getAccountInfo', 'customer.getAccountInfo'];
  let text = '';
  for (const method of methods) {
    try {
      const resp = await sippyPost(apiUrl, xmlRpcCall(method, params), username, password);
      if (!resp.body.includes('<fault>')) { text = resp.body; break; }
      const fault = resp.body.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
        ?? extractTag(resp.body, 'faultString') ?? `${method} failed.`;
      console.warn(`[Sippy] ${method} fault (will try next): ${fault}`);
    } catch (e: any) {
      console.warn(`[Sippy] ${method} error (will try next): ${e.message}`);
    }
  }

  try {
    if (!text) {
      console.warn('[Sippy] getAccountInfo: all methods failed, returning null');
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

/**
 * Generic XML-RPC call against the current active Sippy switch.
 * Uses the active session URL and environment-configured API credentials.
 * Designed for C2 write-back from action-executor — all writes are logged externally.
 *
 * Returns { success, statusCode, rawBody, fault? }
 */
export async function callSippyXmlRpc(
  method: string,
  params: Record<string, string | number | boolean | null>,
): Promise<{ success: boolean; statusCode: number; rawBody: string; fault?: string }> {
  const base = activeSession?.portalUrl;
  if (!base) {
    return { success: false, statusCode: 0, rawBody: '', fault: 'No active Sippy session. Connect to Sippy before executing live actions.' };
  }

  // Resolve credentials from env — same vars used throughout the server
  const username = process.env.SIPP_ADMIN_USERNAME || process.env.SIPPY_ADMIN_USERNAME || '';
  const password = process.env.SIPP_ADMIN_PASSWORD || process.env.SIPPY_ADMIN_PASSWORD || '';

  if (!username || !password) {
    return {
      success: false,
      statusCode: 0,
      rawBody: '',
      fault: 'API credentials not configured (set SIPP_ADMIN_USERNAME and SIPP_ADMIN_PASSWORD).',
    };
  }

  const apiUrl = `${base}/xmlapi/xmlapi`;
  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall(method, params), username, password);
    const isFault = resp.body.includes('<fault>');
    const fault   = isFault
      ? (extractFaultString(resp.body)?.replace(/<[^>]+>/g, '').trim() ?? 'XML-RPC fault')
      : undefined;
    console.log(`[callSippyXmlRpc] ${method} → HTTP ${resp.statusCode}${fault ? ` fault: ${fault}` : ''}`);
    return {
      success:    resp.statusCode === 200 && !isFault,
      statusCode: resp.statusCode,
      rawBody:    resp.body.slice(0, 2000),
      fault,
    };
  } catch (e: any) {
    console.error(`[callSippyXmlRpc] ${method} threw:`, e.message);
    return { success: false, statusCode: 0, rawBody: '', fault: e.message };
  }
}

/**
 * Update core account settings via XML-RPC updateAccount (docs 107312+).
 * Only fields explicitly passed are sent. Unknown fields are ignored by Sippy.
 */
export async function updateAccountSettings(
  username: string,
  password: string,
  portalUrl: string,
  iAccount: number,
  opts: {
    maxSessions?: number;
    maxCallsPerSecond?: number;
    maxCreditTime?: number;
    blocked?: boolean;
    iCustomer?: number;
    creditLimit?: number;
    iRoutingGroup?: number;
  },
): Promise<{ success: boolean; message: string; method?: string }> {
  const apiUrl = `${sippyBase(portalUrl)}/xmlapi/xmlapi`;

  const params: Record<string, string | number | boolean | null> = { i_account: iAccount };
  if (opts.maxSessions        !== undefined) params.max_sessions          = opts.maxSessions;
  if (opts.maxCallsPerSecond  !== undefined) params.max_calls_per_second  = opts.maxCallsPerSecond;
  if (opts.maxCreditTime      !== undefined) params.max_credit_time       = opts.maxCreditTime;
  if (opts.blocked            !== undefined) params.blocked               = opts.blocked ? 1 : 0;
  if (opts.iCustomer          !== undefined) params.i_customer            = opts.iCustomer;
  if (opts.creditLimit        !== undefined) params.credit_limit          = opts.creditLimit;
  if (opts.iRoutingGroup      !== undefined) params.i_routing_group       = opts.iRoutingGroup;

  const lastErrors: string[] = [];

  for (const method of ['updateAccount', 'customer.updateAccount'] as const) {
    try {
      const body = xmlRpcCall(method, params as any);
      const resp = await sippyPost(apiUrl, body, username, password);
      if (resp.statusCode === 200 && !resp.body.includes('<fault>')) {
        return { success: true, message: `Account ${iAccount} updated via ${method}.`, method };
      }
      const fault = extractTag(resp.body, 'faultString') ?? resp.body.substring(0, 120);
      console.warn(`[Sippy] updateAccountSettings ${method} rejected: ${fault}`);
      lastErrors.push(`${method}: ${fault}`);
    } catch (e: any) {
      console.warn(`[Sippy] updateAccountSettings ${method} error:`, e.message);
      lastErrors.push(`${method}: ${e.message}`);
    }
  }

  return { success: false, message: `All updateAccount methods rejected: ${lastErrors.join(' | ')}` };
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
  maxSessions: number | null;   // null / 0 = unlimited; populated when listAccounts returns max_sessions
  currency?: string;
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
  params.limit = opts.limit ?? 10_000;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('listAccounts', params), username, password);
    if (resp.statusCode !== 200) {
      return { accounts: [], error: `HTTP ${resp.statusCode}` };
    }
    const text = resp.body;
    if (text.includes('<fault>')) {
      const fault = extractFaultString(text) || 'listAccounts failed.';
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

      const rawMaxSessions = f['max_sessions'];
      accounts.push({
        iAccount,
        username:     f['username']      || '',
        description:  f['description']   || '',
        blocked:      f['blocked'] === '1' || f['blocked'] === 'true',
        expired:      f['expired']  === '1' || f['expired']  === 'true',
        balance:      parseFloat(f['balance']      || '0') || 0,   // NOT inverted
        creditLimit:  parseFloat(f['credit_limit'] || '0') || 0,
        baseCurrency: f['base_currency'] || 'USD',
        currency:     f['base_currency'] || f['payment_currency'] || undefined,
        registration,
        // max_sessions: Sippy returns "0" for unlimited and the actual limit otherwise.
        // We map 0 → null to signal "unlimited" consistently throughout the app.
        maxSessions:  rawMaxSessions !== undefined && rawMaxSessions !== ''
                        ? (parseInt(rawMaxSessions, 10) || null)
                        : null,
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
      ?? extractFaultString(text) ?? 'authAccount failed.';

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
  iTimeZone?:        number;
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
    name:         opts.name,
    web_password: opts.webPassword,
    web_login:    opts.webLogin,
  };
  if (opts.iTimeZone !== undefined) params.i_time_zone = opts.iTimeZone;
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
  if (opts.iLang            !== undefined) params.i_lang             = String(opts.iLang);
  if (opts.iExportType      !== undefined) params.i_export_type      = Number(opts.iExportType);
  if (opts.iPasswordPolicy  !== undefined) params.i_password_policy  = Number(opts.iPasswordPolicy);
  if (opts.roundUp          !== undefined) params.round_up           = Boolean(Number(opts.roundUp));
  if (opts.costRoundUp      !== undefined) params.cost_round_up      = Boolean(Number(opts.costRoundUp));
  if (opts.decimalPrecision !== undefined) params.decimal_precision  = Number(opts.decimalPrecision);
  if (opts.iCustomer        !== undefined) params.i_customer         = opts.iCustomer;

  try {
    const xmlBody = xmlRpcCall('createVendor', params);
    console.log('[createVendor] XML sent to Sippy:', xmlBody);
    const resp = await sippyPost(apiUrl, xmlBody, username, password);
    const text = resp.body;
    console.log('[createVendor] Sippy response (HTTP', resp.statusCode, '):', text.substring(0, 500));
    if (resp.statusCode !== 200 || text.includes('<fault>')) {
      const fault = extractFaultString(text) || 'createVendor failed.';
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
      const fault = extractFaultString(text) || 'getVendorInfo failed.';
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

  // Do NOT include i_customer here — passing it scopes the request to a specific customer
  // and causes HTTP 401 on old Sippy builds that interpret it as customer-level auth.
  const params: Record<string, string | number> = {};
  if (opts?.limit       !== undefined) params.limit        = opts.limit;
  if (opts?.offset      !== undefined) params.offset       = opts.offset;
  if (opts?.namePattern !== undefined) params.name_pattern = opts.namePattern;

  // Try multiple method names — old Sippy Python 2 may use different names
  const methods = ['listVendors', 'getVendorsList', 'vendor.getList', 'resellers.getList'];
  let lastError = 'Could not fetch vendors from Sippy.';

  for (const method of methods) {
    try {
      const resp = await sippyPost(apiUrl, xmlRpcCall(method, params), username, password);
      // 401/403 on one method doesn't mean creds are wrong — try the next method name
      if (resp.statusCode === 401 || resp.statusCode === 403) {
        lastError = `HTTP ${resp.statusCode}: Auth rejected for ${method} — trying other methods`;
        continue;
      }
      const text = resp.body;
      if (text.includes('<fault>')) continue;

      // Try vendors array (official listVendors response)
      const arrayMatch = /<name>vendors<\/name>\s*<value>\s*<array>([\s\S]*?)<\/array>\s*<\/value>/.exec(text);
      if (arrayMatch) {
        const vendors: SippyVendor[] = [];
        const re = /<struct>([\s\S]*?)<\/struct>/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(arrayMatch[1])) !== null) {
          vendors.push(parseVendorStruct(m[1]));
        }
        if (vendors.length > 0) return { vendors };
      }

      // Try top-level struct list (older Sippy responses)
      const allStructs = extractAllTags(text, 'struct');
      if (allStructs.length > 0) {
        const vendors: SippyVendor[] = [];
        for (const s of allStructs) {
          const m = extractStructMembers(s);
          if (m['i_vendor'] || m['name']) vendors.push(parseVendorStruct(s));
        }
        if (vendors.length > 0) return { vendors };
        return { vendors: [] };
      }
    } catch { continue; }
  }
  return { vendors: [], error: lastError };
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
      const fault = extractFaultString(text) || 'getVendorConnectionsList failed.';
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
      const fault = extractFaultString(text) || 'getVendorConnectionInfo failed.';
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
    const fault = extractFaultString(text) || 'createVendorConnection failed.';
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
    const fault = extractFaultString(text) || 'updateVendorConnection failed.';
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
    const fault = extractFaultString(text) || 'deleteVendorConnection failed.';
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
    const fault = extractFaultString(text) || 'createConnectionGroup failed.';
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
    const fault = extractFaultString(text) || 'updateConnectionGroup failed.';
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
    const fault = extractFaultString(text) || 'deleteConnectionGroup failed.';
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
    const fault = extractFaultString(text) || 'getConnectionGroupInfo failed.';
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
    const fault = extractFaultString(text) || 'getConnectionGroupsList failed.';
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
    const fault = extractFaultString(text) || 'createCgMember failed.';
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
    const fault = extractFaultString(text) || 'updateCgMember failed.';
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
    const fault = extractFaultString(text) || 'deleteCgMember failed.';
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
    const fault = extractFaultString(text) || 'getCgMemberInfo failed.';
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
    const fault = extractFaultString(text) || 'getCgMembersList failed.';
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
    const fault = extractFaultString(text) || 'listSwitchIPs failed.';
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
    const fault = extractFaultString(text) || 'createEnvironment failed.';
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
    const fault = extractFaultString(text) || 'updateEnvironment failed.';
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
    const fault = extractFaultString(text) || 'deleteEnvironment failed.';
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
    const fault = extractFaultString(text) || 'getEnvironmentInfo failed.';
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
    const fault = extractFaultString(text) || 'listEnvironments failed.';
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
    const fault = extractFaultString(text) || 'queueEnvironmentAction failed.';
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
    loss_protection: 1,
    cost_round_up:   1,
  };
  if (opts.connectFee  !== undefined) params.connect_fee  = opts.connectFee;
  if (opts.freeSeconds !== undefined) params.free_seconds = opts.freeSeconds;

  try {
    const resp = await sippyPost(apiUrl, xmlRpcCall('createTariff', params), username, password);
    console.log(`[Sippy] createSippyTariff HTTP ${resp.statusCode} @ ${apiUrl} — body: ${resp.body.slice(0, 300)}`);
    if (resp.statusCode === 200 && !resp.body.includes('<fault>')) {
      const m = extractStructMembers(resp.body);
      const iTariff = parseInt(m['i_tariff'] || '0', 10);
      return { success: true, message: 'Tariff created.', iTariff: iTariff || undefined };
    }
    const fault = extractFaultString(resp.body) || `createTariff HTTP ${resp.statusCode}`;
    console.log(`[Sippy] createSippyTariff failed: ${fault}`);
    // If a tariff with this name already exists, find and reuse its ID
    if (fault.toLowerCase().includes('already exist') || fault.toLowerCase().includes('conflicting name')) {
      const { tariffs } = await listSippyTariffs(username, password, portalUrl);
      const existing = tariffs.find(t => t.name.toLowerCase() === opts.name.toLowerCase());
      if (existing) {
        console.log(`[Sippy] createSippyTariff: reusing existing tariff "${existing.name}" id=${existing.id}`);
        return { success: true, message: 'Tariff already exists — reusing.', iTariff: existing.id };
      }
    }
    return { success: false, message: fault };
  } catch (e: any) {
    console.log(`[Sippy] createSippyTariff exception: ${e.message}`);
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
      ?? extractFaultString(text) ?? 'create_balance failed.';
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
      ?? extractFaultString(text) ?? 'inc_ref_count failed.';
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
      ?? extractFaultString(text) ?? 'dec_ref_count failed.';
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
    return { success: false, message: extractFaultString(text) || 'addDebitCreditCard failed.' };
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
    return { success: false, message: extractFaultString(text) || 'updateDebitCreditCard failed.' };
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
    return { success: false, message: extractFaultString(text) || 'deleteDebitCreditCard failed.' };
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
    return { success: false, error: extractFaultString(text) || 'getDebitCreditCardInfo failed.' };
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
    return { cards: [], error: extractFaultString(text) || 'listDebitCreditCards failed.' };
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
    return { success: false, error: extractFaultString(text) || 'getPaymentInfo failed.' };
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
    return { payments: [], error: extractFaultString(text) || 'getPaymentsList failed.' };
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
    return { success: false, error: extractFaultString(text) || 'rechargeVoucher failed.' };
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
    return { success: false, message: extractFaultString(text) || 'makePayment failed.' };
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
    return { success: false, message: extractFaultString(text) || 'makePaymentByCard failed.' };
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
      const fault = extractFaultString(text) || 'getLowBalance failed.';
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
    const fault = extractFaultString(text) || 'setLowBalance failed.';
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
      const fault = extractFaultString(text) || 'addAuthRule failed.';

      // ── Idempotency: "conflicting parameters" means an identical auth rule
      // already exists for this IP on this account. This IS the desired state —
      // treat it as success by looking up and returning the existing rule.
      const faultLower = fault.toLowerCase();
      if (
        faultLower.includes('conflicting parameters') ||
        faultLower.includes('another authentication rule') ||
        faultLower.includes('already exist')
      ) {
        console.log(`[Sippy] addSippyAuthRule: conflict detected — looking up existing rule for ip=${opts.remoteIp ?? '?'} account=${opts.iAccount}`);
        try {
          const listRes = await listSippyAuthRules(username, password, {
            iAccount:   opts.iAccount,
            iProtocol:  opts.iProtocol,
            ...(opts.remoteIp ? { remoteIp: opts.remoteIp } : {}),
          }, portalUrl);
          const existing = listRes.authRules[0];
          if (existing) {
            console.log(`[Sippy] addSippyAuthRule: reusing existing rule i_authentication=${existing.iAuthentication}`);
            return { success: true, iAuthentication: existing.iAuthentication, message: 'Auth rule already exists — reusing.' };
          }
        } catch (lookupErr: any) {
          console.warn(`[Sippy] addSippyAuthRule: conflict lookup failed: ${lookupErr.message}`);
        }
        // Conflict but no existing rule found — still report as warning, not hard failure
        return { success: true, message: 'Auth rule conflict reported by Sippy — rule likely already present.' };
      }

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
    const fault = extractFaultString(text) || 'updateAuthRule failed.';
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
    const fault = extractFaultString(text) || 'delAuthRule failed.';
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
      const fault = extractFaultString(text) || 'getAuthRuleInfo failed.';
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
      const fault = extractFaultString(text) || 'listAuthRules failed.';
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
      const fault = extractFaultString(text);
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
      const fault = extractFaultString(text);
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
      const fault = extractFaultString(text);
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
      const fault = extractFaultString(text);
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
      const fault = extractFaultString(text);
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
      const fault = extractFaultString(text);
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
      const fault = extractFaultString(text);
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
      const fault = extractFaultString(text);
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
      const fault = extractFaultString(text);
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
      const fault = extractFaultString(text);
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
      const fault = extractFaultString(text);
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
        ?? extractFaultString(text) ?? 'getAccountMinutePlans failed.';
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
        ?? extractFaultString(text) ?? 'resetAccountOneTimePassword failed.';
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
        ?? extractFaultString(text) ?? 'addPostAuthRule failed.';
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
      ?? extractFaultString(text) ?? 'updatePostAuthRule failed.';
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
      ?? extractFaultString(text) ?? 'deletePostAuthRule failed.';
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
        ?? extractFaultString(text) ?? 'getPostAuthRuleInfo failed.';
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
        ?? extractFaultString(text) ?? 'listPostAuthRules failed.';
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
        ?? extractFaultString(text) ?? 'matchAccountMinutePlan failed.';
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
        ?? extractFaultString(text) ?? 'addCLIMapping failed.';
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
      ?? extractFaultString(text) ?? 'updateCLIMapping failed.';
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
      ?? extractFaultString(text) ?? 'delCLIMapping failed.';
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
        ?? extractFaultString(text) ?? 'listCLIMappings failed.';
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
        ?? extractFaultString(text) ?? 'findCLIMapping failed.';
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
        ?? extractFaultString(text) ?? 'addSmartDial failed.';
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
      ?? extractFaultString(text) ?? 'updateSmartDial failed.';
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
      ?? extractFaultString(text) ?? 'deleteSmartDial failed.';
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
        ?? extractFaultString(text) ?? 'listSmartDials failed.';
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
      ?? extractFaultString(text) ?? 'addHotDialNumber failed.';
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
      ?? extractFaultString(text) ?? 'delHotDialNumber failed.';
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
      ?? extractFaultString(text) ?? 'updateHotDialNumber failed.';
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
        ?? extractFaultString(text) ?? 'listHotDialNumbers failed.';
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
        ?? extractFaultString(text) ?? 'getAccountRates failed.';
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
        ?? extractFaultString(text) ?? 'getFollowMeOptions failed.';
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
      ?? extractFaultString(text) ?? 'setFollowMeOptions failed.';
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
        ?? extractFaultString(text) ?? 'listFollowMeEntries failed.';
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
        ?? extractFaultString(text) ?? 'addFollowMeEntry failed.';
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
      ?? extractFaultString(text) ?? 'updateFollowMeEntry failed.';
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
      ?? extractFaultString(text) ?? 'deleteFollowMeEntry failed.';
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
      ?? extractFaultString(text) ?? 'blockWebUser failed.';
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
      ?? extractFaultString(text) ?? 'unblockWebUser failed.';
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
      ?? extractFaultString(text) ?? 'addDestinationSet failed.';
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
      ?? extractFaultString(text) ?? 'updateDestinationSet failed.';
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
      ?? extractFaultString(text) ?? 'getDestinationSetInfo failed.';
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
      ?? extractFaultString(text) ?? 'listDestinationSets failed.';
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
      ?? extractFaultString(text) ?? 'deleteDestinationSet failed.';
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
      ?? extractFaultString(text) ?? 'getDestinationSetRoutesList failed.';
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
      ?? extractFaultString(text) ?? 'addRouteToDestinationSet failed.';
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
      ?? extractFaultString(text) ?? 'updateRouteInDestinationSet failed.';
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
      ?? extractFaultString(text) ?? 'delRouteFromDestinationSet failed.';
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
      ?? extractFaultString(text) ?? 'deleteAllRoutesInDestinationSet failed.';
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
      ?? extractFaultString(text) ?? 'sendEMail failed.';
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
      ?? extractFaultString(text) ?? 'validatePassword failed.';
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
      ?? extractFaultString(text) ?? 'getServicePlanInfo failed.';
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
      ?? extractFaultString(text) ?? 'applyTranslationRule failed.';
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
      ?? extractFaultString(text) ?? 'checkMatchRule failed.';
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
      ?? extractFaultString(text) ?? 'addDID failed.';
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
      ?? extractFaultString(text) ?? 'updateDID failed.';
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
      ?? extractFaultString(text) ?? 'deleteDID failed.';
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
      ?? extractFaultString(text) ?? 'getDIDInfo failed.';
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
    // Include HTTP status in the message so withSippyCreds can detect auth failures (401/403)
    if (resp.statusCode === 401 || resp.statusCode === 403) {
      return { success: false, dids: [], message: `HTTP ${resp.statusCode}: getDIDsList unauthorized` };
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractFaultString(text) ?? 'getDIDsList failed.';
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
      ?? extractFaultString(text) ?? 'getDIDChargingGroupInfo failed.';
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
      ?? extractFaultString(text) ?? 'addDIDDelegation failed.';
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
      ?? extractFaultString(text) ?? 'updateDIDDelegation failed.';
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
      ?? extractFaultString(text) ?? 'deleteDIDDelegation failed.';
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
      ?? extractFaultString(text) ?? 'addConference failed.';
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
      ?? extractFaultString(text) ?? 'deleteConference failed.';
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
      ?? extractFaultString(text) ?? 'dumpIPTraffic failed.';
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
      ?? extractFaultString(text) ?? 'dumpIPTrafficStatus failed.';
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
      ?? extractFaultString(text) ?? 'getAuditLogs failed.';
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
      ?? extractFaultString(text) ?? 'writeAuditLog failed.';
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
      ?? extractFaultString(text) ?? 'generateInvoicePreview failed.';
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
      ?? extractFaultString(text) ?? 'validateInvoiceTemplate failed.';
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
      ?? extractFaultString(text) ?? 'generateInvoice failed.';
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
      ?? extractFaultString(text) ?? 'testDialplan failed.';
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
        ?? extractFaultString(text) ?? 'listExtendedRouting failed.';
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
      // Sippy returns a top-level struct with a 'list' array-of-structs member.
      // We scan ALL <struct> blocks in the full response and keep only those that
      // carry i_routing_group (matching listDestinationSets' proven pattern).
      const structRe = /<struct>([\s\S]*?)<\/struct>/g;
      const groups: SippyRoutingGroupDetail[] = [];
      let sm: RegExpExecArray | null;
      while ((sm = structRe.exec(text)) !== null) {
        const m = extractStructMembers(sm[1]);
        if (m['i_routing_group']) groups.push(parseRoutingGroupDetail(m));
      }
      return { success: true, groups, message: 'OK' };
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractFaultString(text) ?? 'listRoutingGroups failed.';
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
      ?? extractFaultString(text) ?? 'addRoutingGroup failed.';
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
      ?? extractFaultString(text) ?? 'updateRoutingGroup failed.';
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
      ?? extractFaultString(text) ?? 'delRoutingGroup failed.';
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
      // Scan ALL <struct> blocks in the full response and keep only those that
      // carry i_routing_group_member — same proven pattern used by listDestinationSets.
      // Avoids the non-greedy *? regex bug that stops at the first inner </value></member>.
      const structRe = /<struct>([\s\S]*?)<\/struct>/g;
      const members: SippyRoutingGroupMember[] = [];
      let sm: RegExpExecArray | null;
      while ((sm = structRe.exec(text)) !== null) {
        const m = extractStructMembers(sm[1]);
        if (m['i_routing_group_member']) members.push(parseRoutingGroupMember(m));
      }
      return { success: true, members, message: 'OK' };
    }
    const fault = text.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([^<]*)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim()
      ?? extractFaultString(text) ?? 'listRoutingGroupMembers failed.';
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
      ?? extractFaultString(text) ?? 'addRoutingGroupMember failed.';
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
      ?? extractFaultString(text) ?? 'updateRoutingGroupMember failed.';
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
      ?? extractFaultString(text) ?? 'delRoutingGroupMember failed.';
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
      ?? extractFaultString(text) ?? 'getSystemConfig failed.';
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
      ?? extractFaultString(text) ?? 'setSystemConfig failed.';
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
      ?? extractFaultString(text) ?? 'getReplicationStatus failed.';
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
      ?? extractFaultString(text) ?? 'getReplicationLag failed.';
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
    // Log the FULL raw response so we can see exactly what Sippy returns
    console.log(`[Sippy] make2WayCallback(${opts.authname}) HTTP ${resp.statusCode} body: ${text.slice(0, 1200)}`);

    if (resp.statusCode === 401 || resp.statusCode === 403) {
      return {
        success: false,
        message: `auth_failed: HTTP ${resp.statusCode} — credentials rejected for user "${username}".`,
      };
    }
    if (resp.statusCode === 200 && !text.includes('<fault>')) {
      const m = extractStructMembers(text);
      return {
        success:          true,
        iCallbackRequest: m['i_callback_request'] ? parseInt(m['i_callback_request'], 10) : undefined,
        message:          'Callback initiated.',
      };
    }
    // Extract and clean the Sippy fault string first — if present, use it regardless of status code
    const rawFault = extractFaultString(text) || '';
    const cleanFault = rawFault.replace(/<[^>]+>/g, '').trim();
    if (cleanFault) {
      return { success: false, message: cleanFault };
    }
    // Non-XML body (could be HTML error page or plain text from Sippy)
    if (!text.includes('<?xml') && !text.includes('<methodResponse>')) {
      const bodySnippet = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
      return {
        success: false,
        message: `Sippy HTTP ${resp.statusCode} — ${bodySnippet || '(empty response body)'}`,
      };
    }
    return { success: false, message: `make2WayCallback fault (HTTP ${resp.statusCode}): ${text.slice(0, 300)}` };
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
    return { success: false, message: extractFaultString(text) || 'callbackCallingCard failed.' };
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
    return { success: false, message: extractFaultString(text) || 'cancelCallback failed.' };
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
    return { success: false, message: extractFaultString(text) || 'getCallbackStatus failed.' };
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
      ?? extractFaultString(text) ?? 'system.multicall failed.';
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
 * Simple API callback — article 107525
 * Hits /simpleapi/callback.php with HTTP Basic Auth (credentials from admin's .htpassword).
 * This is the easiest fallback when XML-RPC make2WayCallback fails because the Callback
 * application service is not enabled on the customer account (it must still be enabled for
 * the authname account, but this API doesn't need the full XML-RPC session).
 *
 * Admin setup (one-time):
 *   htpasswd /home/ssp/sippy_web/simpleapi/.htpassword <username>
 * and the customer account (authname) must have the Callback application active.
 *
 * Returns plain-text success / error — response 200 means the callback was queued.
 */
export async function simpleApiCallback(
  username:  string,
  password:  string,
  opts: {
    authname:    string;
    cldFirst:    string;
    cldSecond:   string;
    cliFirst?:   string;
    cliSecond?:  string;
    creditTime?: number;
  },
  portalUrl?: string,
): Promise<{ success: boolean; message: string }> {
  const base = portalUrl ? sippyBase(portalUrl) : activeSession?.portalUrl;
  if (!base) return { success: false, message: 'Not connected to Sippy.' };

  const qs = new URLSearchParams({
    authname:   opts.authname,
    cld_first:  opts.cldFirst,
    cld_second: opts.cldSecond,
  });
  if (opts.cliFirst   !== undefined) qs.set('cli_first',   opts.cliFirst);
  if (opts.cliSecond  !== undefined) qs.set('cli_second',  opts.cliSecond);
  if (opts.creditTime !== undefined) qs.set('credit_time', String(opts.creditTime));

  const url = `${base}/simpleapi/callback.php?${qs.toString()}`;
  const parsed  = new URL(url);
  const isHttps = parsed.protocol === 'https:';
  const path    = parsed.pathname + '?' + parsed.searchParams.toString();

  return new Promise((resolve) => {
    const opts2: http.RequestOptions = {
      hostname: parsed.hostname,
      port:     parsed.port ? parseInt(parsed.port) : (isHttps ? 443 : 80),
      path,
      method:   'GET',
      headers:  {
        Authorization: basicAuth(username, password),
        'User-Agent':  'SippyAPI/1.0',
      },
      timeout: 12000,
      ...(isHttps ? { agent: lenientHttpsAgent, rejectUnauthorized: false } : {}),
    };
    let data = '';
    const req = (isHttps ? https : http).request(opts2, (res) => {
      res.on('data', (chunk) => { data += chunk; });
      res.on('end',  () => {
        const code = res.statusCode ?? 0;
        console.log(`[Sippy] simpleApiCallback(${opts.authname}) HTTP ${code}: ${data.slice(0, 200)}`);
        if (code === 401 || code === 403) {
          resolve({ success: false, message: `Simple API: HTTP ${code} — credentials not in /simpleapi/.htpassword. Admin must run: htpasswd /home/ssp/sippy_web/simpleapi/.htpassword ${username}` });
          return;
        }
        if (code === 200 || code === 201) {
          const lower = data.toLowerCase();
          if (lower.includes('error') || lower.includes('failed') || lower.includes('invalid')) {
            resolve({ success: false, message: `Simple API error: ${data.slice(0, 200).trim()}` });
          } else {
            resolve({ success: true, message: `Simple API callback queued (HTTP ${code}).` });
          }
          return;
        }
        resolve({ success: false, message: `Simple API: HTTP ${code} — ${data.slice(0, 200).trim() || 'no response body'}` });
      });
    });
    req.on('error',   (err: Error) => resolve({ success: false, message: `Simple API request failed: ${err.message}` }));
    req.on('timeout', () => { req.destroy(); resolve({ success: false, message: 'Simple API request timed out.' }); });
    req.end();
  });
}

// ── SSL Certificate Expiry Monitoring ────────────────────────────────────────

/**
 * Enriched SSL certificate status entry — used by the monitoring system.
 * Computed from either the Sippy XML-RPC API or a direct TLS probe.
 */
export interface SslCertStatusEntry {
  certId: string;
  subject: string;
  issuer?: string;
  expiresAt: string;       // ISO 8601 date string
  daysRemaining: number;
  status: 'ok' | 'warning' | 'critical' | 'expired';
  source: 'sippy_api' | 'tls_probe';
  autoRenew: boolean;      // true for Let's Encrypt certs
  checkedAt: string;       // ISO 8601
}

function classifySslStatus(daysRemaining: number): 'ok' | 'warning' | 'critical' | 'expired' {
  if (daysRemaining < 0)  return 'expired';
  if (daysRemaining <= 7) return 'critical';
  if (daysRemaining <= 30) return 'warning';
  return 'ok';
}

function tlsProbe(host: string, port: number, checkedAt: string): Promise<SslCertStatusEntry[]> {
  return new Promise(resolve => {
    try {
      const socket = tls.connect({ host, port, rejectUnauthorized: false, timeout: 12000 }, () => {
        try {
          const cert = socket.getPeerCertificate();
          socket.end();
          if (!cert || !cert.valid_to) { resolve([]); return; }
          const expiresAt  = new Date(cert.valid_to);
          if (isNaN(expiresAt.getTime())) { resolve([]); return; }
          const daysRemaining = Math.floor((expiresAt.getTime() - Date.now()) / 86_400_000);
          const subject    = (cert.subject as any)?.CN ?? (cert.subject as any)?.O ?? host;
          const issuerOrg  = (cert.issuer as any)?.O ?? (cert.issuer as any)?.CN ?? undefined;
          const isLetsEncrypt = (issuerOrg ?? '').toLowerCase().includes("let's encrypt");
          resolve([{
            certId: `tls:${host}:${port}`,
            subject,
            issuer: issuerOrg,
            expiresAt: expiresAt.toISOString(),
            daysRemaining,
            status: classifySslStatus(daysRemaining),
            source: 'tls_probe',
            autoRenew: isLetsEncrypt,
            checkedAt,
          }]);
        } catch { socket.end(); resolve([]); }
      });
      socket.on('error',   () => resolve([]));
      socket.on('timeout', () => { socket.end(); resolve([]); });
    } catch { resolve([]); }
  });
}

function parseSippyExpiryDate(raw: string): Date | null {
  if (!raw) return null;
  // Try ISO / common formats first
  const d = new Date(raw);
  if (!isNaN(d.getTime())) return d;
  // Sippy may return YYYY-MM-DD without time
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  // Unix timestamp (seconds)
  const n = Number(raw);
  if (!isNaN(n) && n > 1_000_000_000) return new Date(n * 1000);
  return null;
}

/**
 * Fetch SSL certificate expiry status for the Sippy softswitch.
 *
 * Strategy:
 *   1. Try getSSLCertificatesList() via Sippy XML-RPC (requires active session).
 *      Parses expiry_date from each returned cert.
 *   2. Fall back to direct TLS connect on the portal host:port.
 *      Returns the cert the Sippy HTTPS server presents.
 *
 * @param username  XML-RPC admin username (used for Sippy API call)
 * @param password  XML-RPC admin password
 * @param portalUrl Sippy portal base URL (e.g. https://191.101.30.107)
 */
export async function fetchSslCertStatus(
  username: string,
  password: string,
  portalUrl: string,
): Promise<SslCertStatusEntry[]> {
  const checkedAt = new Date().toISOString();

  // ── Method 1: Sippy XML-RPC (preferred — full cert inventory) ────────────
  if (activeSession) {
    try {
      const { certificates } = await getSSLCertificatesList(username, password);
      if (certificates.length > 0) {
        const results: SslCertStatusEntry[] = [];
        for (const cert of certificates) {
          const expiresAt = cert.expiryDate ? parseSippyExpiryDate(cert.expiryDate) : null;
          const daysRemaining = expiresAt
            ? Math.floor((expiresAt.getTime() - Date.now()) / 86_400_000)
            : 9999;
          // iSslCertificateType 2 = Let's Encrypt on most Sippy versions
          const isLetsEncrypt = cert.iSslCertificateType === 2;
          results.push({
            certId: String(cert.iSslCertificate),
            subject: cert.commonName ?? cert.name ?? `Cert #${cert.iSslCertificate}`,
            expiresAt: expiresAt ? expiresAt.toISOString() : 'unknown',
            daysRemaining,
            status: expiresAt ? classifySslStatus(daysRemaining) : 'ok',
            source: 'sippy_api',
            autoRenew: isLetsEncrypt,
            checkedAt,
          });
        }
        return results;
      }
    } catch (e) {
      console.log(`[ssl-monitor] getSSLCertificatesList failed (${(e as Error).message}), falling back to TLS probe`);
    }
  }

  // ── Method 2: Direct TLS probe (fallback) ────────────────────────────────
  try {
    const parsed = new URL(sippyBase(portalUrl));
    if (parsed.protocol !== 'https:') return [];
    const host = parsed.hostname;
    const port = parsed.port ? parseInt(parsed.port) : 443;
    return await tlsProbe(host, port, checkedAt);
  } catch {
    return [];
  }
}

/**
 * Bulk-delete DIDs via system.multicall.
 * Official method: deleteDID() via system.multicall — docs 3000108533 + 107502
 */
export async function bulkDeleteDIDs(
  username: string,
  password: string,
  iDids: number[],
  opts?: { portalUrl?: string }
): Promise<{ success: number[]; failed: number[] }> {
  if (iDids.length === 0) return { success: [], failed: [] };

  const calls: MulticallEntry[] = iDids.map((iDid) => ({
    methodName: 'deleteDID',
    params: { i_did: iDid },
  }));

  const res = await sippyMulticall(username, password, calls, opts);
  const success: number[] = [];
  const failed: number[] = [];

  res.results.forEach((r, idx) => {
    if (r.success) success.push(iDids[idx]);
    else failed.push(iDids[idx]);
  });

  if (!res.success && res.results.length === 0) return { success: [], failed: iDids };

  return { success, failed };
}
