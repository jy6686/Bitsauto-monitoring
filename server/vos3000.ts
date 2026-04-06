/**
 * VOS3000 Integration Module
 * Uses Node's raw http/https modules for full Set-Cookie header access.
 * The native fetch() API silently drops Set-Cookie headers on some Java servers.
 */

import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Vos3000Session {
  jsessionid: string;
  portalBase: string;
  username: string;
  loggedInAt: Date;
}

interface CaptchaChallenge {
  challengeId: string;
  imageBase64: string;
  sessionCookie: string;
  createdAt: Date;
}

export interface CdrRecord {
  id: string;
  startTime: string;
  endTime: string;
  duration: number;
  caller: string;
  callee: string;
  status: string;
  cause: string;
  gateway: string;
  clientName?: string;
  cost?: number;
}

export interface LiveCallRecord {
  id: string;
  startTime: string;
  caller: string;
  callee: string;
  gateway: string;
  clientName?: string;
  duration: number;
  callStatus: 'connected' | 'routing'; // connected = answered (duration>0), routing = in setup
}

// ─── In-memory state ──────────────────────────────────────────────────────────

let activeSession: Vos3000Session | null = null;
const pendingCaptchas = new Map<string, CaptchaChallenge>();

/** Per-URL session map — lets us push to multiple VOS3000 instances simultaneously */
const sessionsByUrl = new Map<string, Vos3000Session>();

export function getSessionForUrl(url: string): Vos3000Session | null {
  const direct = sessionsByUrl.get(url);
  if (direct) return direct;
  // Fall back to primary session if URL matches
  if (activeSession && activeSession.portalBase.startsWith(url)) return activeSession;
  if (activeSession && url.startsWith(activeSession.portalBase)) return activeSession;
  return null;
}

export function storeSessionForUrl(url: string, session: Vos3000Session) {
  sessionsByUrl.set(url, session);
}

export function clearSessionForUrl(url: string) {
  sessionsByUrl.delete(url);
}

// ─── Low-level HTTP helpers ───────────────────────────────────────────────────

interface RawResponse {
  statusCode: number;
  headers: Record<string, string | string[]>;
  body: Buffer;
}

function rawRequest(options: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  followRedirects?: boolean;
  timeout?: number;
}): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(options.url);
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;
    const port = parsed.port ? Number(parsed.port) : (isHttps ? 443 : 80);

    const reqOptions: http.RequestOptions = {
      hostname: parsed.hostname,
      port,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };

    const req = lib.request(reqOptions, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks);

        // Follow one level of redirect if needed
        if (options.followRedirects !== false && (res.statusCode === 301 || res.statusCode === 302)) {
          const location = Array.isArray(res.headers['location'])
            ? res.headers['location'][0]
            : res.headers['location'];
          if (location) {
            const redirectUrl = location.startsWith('http')
              ? location
              : `${parsed.protocol}//${parsed.hostname}:${port}${location}`;
            rawRequest({ ...options, url: redirectUrl, followRedirects: false })
              .then(resolve)
              .catch(reject);
            return;
          }
        }

        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers as Record<string, string | string[]>,
          body,
        });
      });
      res.on('error', reject);
    });

    req.on('error', reject);

    if (options.timeout) {
      req.setTimeout(options.timeout, () => {
        req.destroy(new Error('Request timed out'));
      });
    }

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

function extractSetCookie(headers: Record<string, string | string[]>): string[] {
  const raw = headers['set-cookie'];
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return [raw];
}

function getJsessionId(cookies: string[]): string | null {
  for (const c of cookies) {
    const match = c.match(/JSESSIONID=([A-Za-z0-9]+)/i);
    if (match) return match[1];
  }
  return null;
}

// ─── Portal helpers ───────────────────────────────────────────────────────────

function portalBase(rawUrl: string): string {
  const u = new URL(rawUrl);
  const path = u.pathname.endsWith('/') ? u.pathname : u.pathname + '/';
  return `${u.protocol}//${u.host}${path}`;
}

function cookieHeader(jsessionid: string): string {
  return `JSESSIONID=${jsessionid}`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetches a fresh CAPTCHA image from VOS3000 and stores a pending challenge.
 */
export async function fetchCaptcha(
  portalUrl: string,
): Promise<{ challengeId: string; imageBase64: string } | null> {
  try {
    const base = portalBase(portalUrl);

    // VOS3000 creates the session when verifyimage.jsp is first requested —
    // NOT on the login page GET. So go straight to verifyimage.jsp.
    const captchaResp = await rawRequest({
      url: `${base}verifyimage.jsp`,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': base,
      },
      timeout: 8000,
    });

    const cookies = extractSetCookie(captchaResp.headers);
    const jsessionid = getJsessionId(cookies);

    if (!jsessionid) {
      console.error('[VOS3000] verifyimage.jsp did not set a JSESSIONID cookie');
      console.error('[VOS3000] Status:', captchaResp.statusCode, 'Headers:', JSON.stringify(captchaResp.headers));
      return null;
    }

    if (captchaResp.statusCode !== 200 || captchaResp.body.length < 100) {
      console.error('[VOS3000] verifyimage.jsp bad response:', captchaResp.statusCode, 'size:', captchaResp.body.length);
      return null;
    }

    const contentType = (captchaResp.headers['content-type'] as string) || 'image/jpeg';
    const imageBase64 = `data:${contentType};base64,${captchaResp.body.toString('base64')}`;

    const challengeId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    pendingCaptchas.set(challengeId, {
      challengeId,
      imageBase64,
      sessionCookie: jsessionid,
      createdAt: new Date(),
    });

    // Purge stale challenges (>5 min)
    for (const [id, ch] of pendingCaptchas.entries()) {
      if (Date.now() - ch.createdAt.getTime() > 5 * 60 * 1000) {
        pendingCaptchas.delete(id);
      }
    }

    console.log('[VOS3000] CAPTCHA fetched OK. JSESSIONID:', jsessionid.slice(0, 8) + '…', 'size:', captchaResp.body.length);
    return { challengeId, imageBase64 };
  } catch (err) {
    console.error('[VOS3000] fetchCaptcha error:', err);
    return null;
  }
}

/**
 * Completes VOS3000 login using the CAPTCHA challenge + credentials.
 */
export async function loginWithCaptcha(
  portalUrl: string,
  username: string,
  password: string,
  challengeId: string,
  captchaCode: string,
  loginType?: number,
): Promise<{ success: boolean; message: string }> {
  const challenge = pendingCaptchas.get(challengeId);
  if (!challenge) {
    return { success: false, message: 'CAPTCHA challenge expired. Please request a new one.' };
  }

  const base = portalBase(portalUrl);

  // VOS3000 login.jsp uses a hybrid ExtJS request:
  //   - randCode (CAPTCHA answer) → URL query param
  //   - credentials              → JSON body (terminalName, terminalPassword, terminalType)
  const loginUrl = `${base}login.jsp?randCode=${encodeURIComponent(captchaCode.trim())}`;
  const bodyStr = JSON.stringify({
    terminalName: username,
    terminalPassword: password,
    terminalType: loginType ?? 1,
  });

  try {
    const resp = await rawRequest({
      url: loginUrl,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookieHeader(challenge.sessionCookie),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': base,
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Length': String(Buffer.byteLength(bodyStr)),
      },
      body: bodyStr,
      followRedirects: false,
      timeout: 10000,
    });

    const text = resp.body.toString('utf-8');
    console.log('[VOS3000] login.jsp status:', resp.statusCode, 'body:', text.slice(0, 200));

    let retCode: number | null = null;
    let exception = '';
    try {
      const json = JSON.parse(text);
      retCode = json.retCode;
      exception = json.exception || '';
    } catch { /* not JSON */ }

    const isSuccess =
      retCode === 0 ||
      (retCode === null && (resp.statusCode === 302 || resp.statusCode === 200) && !text.includes('Error'));

    if (isSuccess) {
      pendingCaptchas.delete(challengeId);
      const newSession: Vos3000Session = {
        jsessionid: challenge.sessionCookie,
        portalBase: base,
        username,
        loggedInAt: new Date(),
      };
      activeSession = newSession;
      sessionsByUrl.set(base, newSession); // register in per-URL map
      console.log('[VOS3000] Login successful as', username);
      return { success: true, message: `Logged in to VOS3000 as ${username}` };
    }

    return { success: false, message: mapVosError(retCode, exception) };
  } catch (err) {
    console.error('[VOS3000] loginWithCaptcha error:', err);
    return { success: false, message: 'Network error connecting to portal.' };
  }
}

function mapVosError(retCode: number | null, exception: string): string {
  if (retCode === -12105 || exception.toLowerCase().includes('verify code')) {
    return 'Incorrect CAPTCHA code. A new one has been loaded — please try again.';
  }
  if (retCode === -12101 || exception.toLowerCase().includes('password')) return 'Wrong username or password.';
  if (retCode === -12102) return 'Account locked.';
  if (retCode === -12103) return 'Account does not exist.';
  if (retCode === -12104) return 'Account expired.';
  return exception || `Login failed (code ${retCode}).`;
}

export function getSessionStatus(): {
  active: boolean;
  username?: string;
  loggedInAt?: Date;
  portalBase?: string;
} {
  if (!activeSession) return { active: false };
  return {
    active: true,
    username: activeSession.username,
    loggedInAt: activeSession.loggedInAt,
    portalBase: activeSession.portalBase,
  };
}

export function clearSession(): void {
  activeSession = null;
}

/**
 * Restores a persisted session from stored credentials (e.g. after server restart).
 * The session is marked as restored — the next live-call fetch will validate it.
 */
export function restoreSession(jsessionid: string, base: string, username: string): void {
  const session: Vos3000Session = {
    jsessionid,
    portalBase: base.endsWith('/') ? base : base + '/',
    username,
    loggedInAt: new Date(),
  };
  activeSession = session;
  sessionsByUrl.set(session.portalBase, session);
  console.log('[VOS3000] Session restored from DB for', username, 'at', session.portalBase);
}

/** Returns the raw JSESSIONID of the current active session, or null. */
export function getActiveSessionToken(): string | null {
  return activeSession?.jsessionid ?? null;
}

/** Returns portalBase of the current active session, or null. */
export function getActiveSessionBase(): string | null {
  return activeSession?.portalBase ?? null;
}

// ─── Data Fetching ────────────────────────────────────────────────────────────

async function portalPost(path: string, params: Record<string, string>): Promise<any> {
  if (!activeSession) throw new Error('No active session');
  const body = new URLSearchParams(params).toString();
  const resp = await rawRequest({
    url: `${activeSession.portalBase}${path}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookieHeader(activeSession.jsessionid),
      'User-Agent': 'Mozilla/5.0',
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': activeSession.portalBase,
      'Content-Length': String(Buffer.byteLength(body)),
    },
    body,
    timeout: 12000,
  });

  if (resp.statusCode === 302 || resp.statusCode === 403) {
    activeSession = null;
    throw new Error('SESSION_EXPIRED');
  }

  return JSON.parse(resp.body.toString('utf-8'));
}

/** Same as portalPost but uses an explicitly provided session (for multi-switch push) */
async function portalPostForSession(session: Vos3000Session, path: string, params: Record<string, string>): Promise<any> {
  const body = new URLSearchParams(params).toString();
  const resp = await rawRequest({
    url: `${session.portalBase}${path}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookieHeader(session.jsessionid),
      'User-Agent': 'Mozilla/5.0',
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': session.portalBase,
      'Content-Length': String(Buffer.byteLength(body)),
    },
    body,
    timeout: 12000,
  });
  if (resp.statusCode === 302 || resp.statusCode === 403) {
    sessionsByUrl.delete(session.portalBase);
    if (activeSession?.portalBase === session.portalBase) activeSession = null;
    throw new Error('SESSION_EXPIRED');
  }
  return JSON.parse(resp.body.toString('utf-8'));
}

async function portalGet(path: string): Promise<any> {
  if (!activeSession) throw new Error('No active session');
  const resp = await rawRequest({
    url: `${activeSession.portalBase}${path}`,
    method: 'GET',
    headers: {
      'Cookie': cookieHeader(activeSession.jsessionid),
      'User-Agent': 'Mozilla/5.0',
      'X-Requested-With': 'XMLHttpRequest',
    },
    timeout: 12000,
  });

  if (resp.statusCode === 302 || resp.statusCode === 403) {
    activeSession = null;
    throw new Error('SESSION_EXPIRED');
  }

  return JSON.parse(resp.body.toString('utf-8'));
}

export async function fetchCdrRecords(options: {
  limit?: number;
  startHoursAgo?: number;
} = {}): Promise<{ records: CdrRecord[]; error?: string }> {
  if (!activeSession) return { records: [], error: 'Not logged in to portal.' };

  const { limit = 100, startHoursAgo = 24 } = options;
  const now = new Date();
  const start = new Date(now.getTime() - startHoursAgo * 3600 * 1000);

  try {
    const json = await portalPost('gateway/cdrQuery.action', {
      page: '1',
      rows: String(limit),
      starttime: formatVosDate(start),
      endtime: formatVosDate(now),
    });

    if (json.rows && Array.isArray(json.rows)) {
      return { records: json.rows.map(parseCdrRow) };
    }
    return { records: [] };
  } catch (err: any) {
    if (err.message === 'SESSION_EXPIRED') return { records: [], error: 'Session expired. Please log in again.' };
    console.error('[VOS3000] fetchCdrRecords:', err.message);
    return { records: [], error: 'Could not fetch CDR data.' };
  }
}

export async function fetchLiveCalls(): Promise<{ calls: LiveCallRecord[]; error?: string }> {
  if (!activeSession) return { calls: [], error: 'Not logged in to portal.' };

  const endpoints = [
    'monitor/liveCallQuery.action',
    'gateway/liveCallQuery.action',
  ];

  for (const ep of endpoints) {
    try {
      const json = await portalGet(ep);
      const rows = json.rows || (Array.isArray(json) ? json : []);
      return { calls: rows.map(parseLiveRow) };
    } catch (err: any) {
      if (err.message === 'SESSION_EXPIRED') return { calls: [], error: 'Session expired.' };
      // Try next endpoint
    }
  }

  return { calls: [] };
}

export async function fetchStats(): Promise<{
  totalCalls: number;
  successCalls: number;
  failedCalls: number;
  totalMinutes: number;
  totalCost: number;
  asr: number;
  error?: string;
}> {
  const empty = { totalCalls: 0, successCalls: 0, failedCalls: 0, totalMinutes: 0, totalCost: 0, asr: 0 };
  if (!activeSession) return { ...empty, error: 'Not logged in to portal.' };

  const now = new Date();
  const start = new Date(now.getTime() - 24 * 3600 * 1000);

  try {
    const json = await portalPost('gateway/expenditureSummary.action', {
      starttime: formatVosDate(start),
      endtime: formatVosDate(now),
    });

    const rows: any[] = json.rows || (Array.isArray(json) ? json : []);
    let totalCalls = 0, successCalls = 0, totalMinutes = 0, totalCost = 0;
    for (const r of rows) {
      totalCalls += Number(r.total_calls || r.totalCalls || r.callCount || 0);
      successCalls += Number(r.success_calls || r.successCalls || r.answerCall || 0);
      totalMinutes += Number(r.total_minutes || r.totalMinutes || r.talkTime || 0) / 60;
      totalCost += Number(r.total_cost || r.totalCost || r.amount || 0);
    }

    return {
      totalCalls,
      successCalls,
      failedCalls: totalCalls - successCalls,
      totalMinutes: Math.round(totalMinutes),
      totalCost: parseFloat(totalCost.toFixed(2)),
      asr: totalCalls > 0 ? parseFloat(((successCalls / totalCalls) * 100).toFixed(1)) : 0,
    };
  } catch (err: any) {
    if (err.message === 'SESSION_EXPIRED') return { ...empty, error: 'Session expired.' };
    console.error('[VOS3000] fetchStats:', err.message);
    return { ...empty, error: 'Could not fetch stats.' };
  }
}

export interface VosClient {
  id: string;
  name: string;
  balance: number;
  status: string;
  type: string;
}

export interface ClientStatRow {
  clientId: string;
  clientName: string;
  totalCalls: number;
  successCalls: number;
  failedCalls: number;
  totalMinutes: number;
  totalCost: number;
  asr: number;
}

/**
 * Fetches terminal account (client) list from VOS3000.
 * Tries multiple endpoint paths used by different VOS3000 versions / login types.
 * Falls back to deriving the client list from the expenditure-summary rows
 * (which work for all account types including Mapping Gateway logins).
 */
export async function fetchVosClients(): Promise<{ clients: VosClient[]; source?: string; error?: string }> {
  if (!activeSession) return { clients: [], error: 'Not logged in to portal.' };

  const listEndpoints = [
    // Admin / reseller endpoints
    { path: 'terminal/terminalQuery.action',        params: { page: '1', rows: '500' } },
    { path: 'account/terminalQuery.action',          params: { page: '1', rows: '500' } },
    { path: 'customer/customerQuery.action',         params: { page: '1', rows: '500' } },
    { path: 'gateway/terminalQuery.action',          params: { page: '1', rows: '500' } },
    // Gateway / mapping account endpoints
    { path: 'mapping/terminalQuery.action',          params: { page: '1', rows: '500' } },
    { path: 'gateway/gatewayQuery.action',           params: { page: '1', rows: '500' } },
    { path: 'mapping/mappingGatewayQuery.action',    params: { page: '1', rows: '500' } },
    { path: 'reseller/terminalQuery.action',         params: { page: '1', rows: '500' } },
    { path: 'user/userQuery.action',                 params: { page: '1', rows: '500' } },
    { path: 'terminal/query.action',                 params: { page: '1', rows: '500' } },
    // GET variants some VOS3000 builds use
  ];

  for (const { path, params } of listEndpoints) {
    try {
      const json = await portalPost(path, params);
      const rows: any[] = json.rows || (Array.isArray(json) ? json : []);
      if (rows.length > 0) {
        console.log(`[VOS3000] fetchVosClients: found ${rows.length} clients via ${path}`);
        return {
          source: path,
          clients: rows.map((r: any) => ({
            id: String(r.id || r.terminalId || r.accountId || r.customerId || r.gatewayId || ''),
            name: r.terminalName || r.name || r.accountName || r.customerName || r.loginName || r.gatewayName || String(r.id || 'Unknown'),
            balance: parseFloat(String(r.balance || r.amount || r.credit || r.fee || 0)),
            status: String(r.status || r.state || r.enabled || r.active || ''),
            type: String(r.terminalType || r.type || r.accountType || r.gatewayType || ''),
          })),
        };
      }
    } catch (err: any) {
      if (err.message === 'SESSION_EXPIRED') return { clients: [], error: 'Session expired. Please log in again.' };
      console.warn(`[VOS3000] fetchVosClients tried ${path}: ${err.message}`);
    }
  }

  // ── Fallback: derive clients from expenditure summary ───────────────────────
  // The expenditure summary works for all account types. Each row is one
  // gateway / terminal with accumulated call stats — enough to build a client list.
  console.log('[VOS3000] fetchVosClients: falling back to expenditure-summary client extraction');
  try {
    const now = new Date();
    const start = new Date(now.getTime() - 30 * 24 * 3600 * 1000); // last 30 days
    const json = await portalPost('gateway/expenditureSummary.action', {
      starttime: formatVosDate(start),
      endtime: formatVosDate(now),
      page: '1',
      rows: '500',
    });

    const rows: any[] = json.rows || (Array.isArray(json) ? json : []);
    if (rows.length > 0) {
      const seen = new Set<string>();
      const clients: VosClient[] = [];
      for (const r of rows) {
        const id   = String(r.terminalId || r.id || r.accountId || '');
        const name = r.terminalName || r.name || r.accountName || r.loginName || id || 'Unknown';
        if (!id && name === 'Unknown') continue;
        const key = id || name;
        if (seen.has(key)) continue;
        seen.add(key);
        clients.push({
          id,
          name,
          balance: parseFloat(String(r.balance || r.amount || r.fee || 0)),
          status: 'active',
          type: String(r.terminalType || r.type || ''),
        });
      }
      if (clients.length > 0) {
        console.log(`[VOS3000] fetchVosClients fallback: extracted ${clients.length} clients from expenditure summary`);
        return { clients, source: 'expenditure-summary' };
      }
    }
  } catch (err: any) {
    console.warn('[VOS3000] fetchVosClients fallback error:', err.message);
  }

  return { clients: [], error: 'No client data found. Your VOS3000 account may not have permission to list terminal accounts.' };
}

/**
 * Fetches per-client call statistics from VOS3000 expenditure summary.
 * Each row in the result represents one client/terminal with their traffic stats.
 */
export async function fetchClientStats(): Promise<{ clients: ClientStatRow[]; error?: string }> {
  if (!activeSession) return { clients: [], error: 'Not logged in to portal.' };

  const now = new Date();
  const start = new Date(now.getTime() - 24 * 3600 * 1000);

  try {
    const json = await portalPost('gateway/expenditureSummary.action', {
      starttime: formatVosDate(start),
      endtime: formatVosDate(now),
      page: '1',
      rows: '200',
    });

    const rows: any[] = json.rows || (Array.isArray(json) ? json : []);
    const clients: ClientStatRow[] = rows
      .map((r: any) => {
        const totalCalls = Number(r.total_calls || r.totalCalls || r.callCount || r.call_count || 0);
        const successCalls = Number(r.success_calls || r.successCalls || r.answerCall || r.answer_call || 0);
        const rawMinutes = Number(r.total_minutes || r.totalMinutes || r.talkTime || r.talk_time || 0);
        // VOS3000 may return talkTime in seconds; if very large treat as seconds
        const totalMinutes = rawMinutes > 10000 ? Math.round(rawMinutes / 60) : Math.round(rawMinutes);
        const totalCost = parseFloat(String(r.total_cost || r.totalCost || r.amount || r.fee || 0));
        const clientName = r.terminalName || r.name || r.accountName || r.customerName || r.loginName || String(r.terminalId || r.id || 'Unknown');
        return {
          clientId: String(r.terminalId || r.id || r.accountId || ''),
          clientName,
          totalCalls,
          successCalls,
          failedCalls: Math.max(0, totalCalls - successCalls),
          totalMinutes,
          totalCost,
          asr: totalCalls > 0 ? parseFloat(((successCalls / totalCalls) * 100).toFixed(1)) : 0,
        };
      })
      .filter(c => c.clientName !== 'Unknown' || c.totalCalls > 0)
      .sort((a, b) => b.totalCalls - a.totalCalls);

    console.log(`[VOS3000] fetchClientStats: ${clients.length} client rows`);
    return { clients };
  } catch (err: any) {
    if (err.message === 'SESSION_EXPIRED') return { clients: [], error: 'Session expired.' };
    console.error('[VOS3000] fetchClientStats:', err.message);
    return { clients: [], error: 'Could not fetch client stats.' };
  }
}

// ─── Parsers ──────────────────────────────────────────────────────────────────

function formatVosDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function parseCdrRow(r: any): CdrRecord {
  return {
    id: String(r.id || r.cdrId || r.call_id || Math.random()),
    startTime: r.starttime || r.start_time || r.calltime || '',
    endTime: r.endtime || r.end_time || '',
    duration: Number(r.duration || r.talk_time || r.billseconds || 0),
    caller: r.caller || r.cli || r.callerNum || '',
    callee: r.callee || r.cld || r.calleeNum || '',
    status: r.status || r.result || '',
    cause: r.cause || r.disconnect_cause || r.reason || '',
    gateway: r.gateway || r.gw_name || r.gwName || '',
    clientName: r.terminalName || r.accountName || r.customerName || r.clientName || r.name || undefined,
    cost: Number(r.cost || r.amount || r.fee || 0),
  };
}

function parseLiveRow(r: any): LiveCallRecord {
  const duration = Number(r.duration || r.elapsed || r.seconds || r.talk_time || 0);
  const rawStatus = String(r.callStatus || r.call_status || r.status || r.state || '').toLowerCase();
  // "connected" if duration > 0 OR status says answer/talk/connected
  const isConnected = duration > 0
    || rawStatus.includes('answer')
    || rawStatus.includes('talk')
    || rawStatus.includes('connect')
    || rawStatus === 'active';
  return {
    id: String(r.id || r.call_id || Math.random()),
    startTime: new Date().toISOString(),
    caller: r.caller || r.cli || r.callerNumber || '',
    callee: r.callee || r.cld || r.calleeNumber || '',
    gateway: r.gateway || r.gw || r.gatewayName || '',
    clientName: r.terminalName || r.accountName || r.customerName || r.clientName || r.name || undefined,
    duration,
    callStatus: isConnected ? 'connected' : 'routing',
  };
}

// ─── Rate / Account Push ──────────────────────────────────────────────────────

export interface PushRateOptions {
  accountName: string;     // terminal / client name on the switch
  prefix: string;          // dialling prefix / destination (e.g. "+1", "44")
  ratePerMin: number;      // USD per minute
  effectiveFrom?: Date;    // UTC
  effectiveTo?: Date;      // UTC (null = no expiry)
  format?: 'full' | 'partial' | 'default';
}

export interface PushResult {
  success: boolean;
  message: string;
  detail?: string;
  endpoint?: string;
}

/**
 * Attempts to push a rate / account config to VOS3000.
 * @param opts  Rate push options
 * @param session  Optional explicit session (for secondary switches). Defaults to activeSession.
 */
export async function pushRateToVos3000(opts: PushRateOptions, session?: Vos3000Session | null): Promise<PushResult> {
  const sess = session ?? activeSession;
  if (!sess) return { success: false, message: 'Not logged in to VOS3000 portal.' };

  const effectiveFromStr = opts.effectiveFrom ? formatVosDate(opts.effectiveFrom) : formatVosDate(new Date());
  const effectiveToStr   = opts.effectiveTo   ? formatVosDate(opts.effectiveTo)   : '';

  const baseParams: Record<string, string> = {
    terminalName:    opts.accountName,
    prefix:          opts.prefix,
    ratePerMinute:   String(opts.ratePerMin),
    rate:            String(opts.ratePerMin),
    effectiveDate:   effectiveFromStr,
    startDate:       effectiveFromStr,
    ...(effectiveToStr ? { endDate: effectiveToStr, expiryDate: effectiveToStr } : {}),
  };

  const rateEndpoints = [
    { path: 'gateway/setPricing.action',      params: baseParams },
    { path: 'pricing/savePricing.action',     params: baseParams },
    { path: 'pricing/pricingSave.action',     params: baseParams },
    { path: 'rate/saveRate.action',           params: { ...baseParams, type: '0' } },
    { path: 'terminal/setRate.action',        params: baseParams },
    { path: 'billing/setRate.action',         params: baseParams },
    { path: 'terminal/modifyTerminal.action', params: { ...baseParams, terminalPassword: '' } },
    { path: 'gateway/modifyGateway.action',   params: baseParams },
  ];

  for (const { path, params } of rateEndpoints) {
    try {
      const json = await portalPostForSession(sess, path, params);
      const text = JSON.stringify(json);
      const ok =
        json.retCode === 0 || json.success === true ||
        json.result === 'ok' || json.status === 'success' ||
        text.includes('"retCode":0') || text.toLowerCase().includes('"success":true');
      if (ok) {
        console.log(`[VOS3000] pushRate succeeded via ${path} for ${opts.accountName}/${opts.prefix}`);
        return { success: true, message: 'Rate pushed to VOS3000', endpoint: path };
      }
      const msg = json.exception || json.message || json.msg || text.slice(0, 120);
      console.warn(`[VOS3000] pushRate ${path} returned error:`, msg);
    } catch (err: any) {
      if (err.message === 'SESSION_EXPIRED') {
        return { success: false, message: 'Session expired. Please reconnect to VOS3000.' };
      }
      console.warn(`[VOS3000] pushRate tried ${path}:`, err.message);
    }
  }

  return {
    success: false,
    message: 'Could not push rate to VOS3000',
    detail: 'None of the pricing endpoints accepted the request. This account type may not have rate-write permission.',
  };
}

/**
 * Attempts to create or update a terminal/client account on VOS3000.
 * @param opts      Account options
 * @param session   Optional explicit session (for secondary switches). Defaults to activeSession.
 */
export async function pushAccountToVos3000(opts: {
  name: string;
  type: 'client' | 'vendor';
  ipAddress?: string;
  ratePerMin?: number;
}, session?: Vos3000Session | null): Promise<PushResult> {
  const sess = session ?? activeSession;
  if (!sess) return { success: false, message: 'Not logged in to VOS3000 portal.' };

  const params: Record<string, string> = {
    terminalName:    opts.name,
    terminalType:    opts.type === 'vendor' ? '2' : '1',
    ...(opts.ipAddress  ? { ip: opts.ipAddress, terminalIp: opts.ipAddress } : {}),
    ...(opts.ratePerMin ? { ratePerMinute: String(opts.ratePerMin), rate: String(opts.ratePerMin) } : {}),
  };

  const accountEndpoints = [
    'terminal/addTerminal.action',
    'terminal/terminalAdd.action',
    'terminal/save.action',
    'gateway/addGateway.action',
    'gateway/save.action',
    'account/addAccount.action',
    'customer/addCustomer.action',
  ];

  for (const path of accountEndpoints) {
    try {
      const json = await portalPostForSession(sess, path, params);
      const ok = json.retCode === 0 || json.success === true || json.result === 'ok';
      if (ok) {
        console.log(`[VOS3000] pushAccount succeeded via ${path} for "${opts.name}"`);
        return { success: true, message: `Account "${opts.name}" created/updated on VOS3000`, endpoint: path };
      }
      console.warn(`[VOS3000] pushAccount ${path}:`, json.exception || json.message || '');
    } catch (err: any) {
      if (err.message === 'SESSION_EXPIRED') return { success: false, message: 'Session expired. Please reconnect.' };
      console.warn(`[VOS3000] pushAccount tried ${path}:`, err.message);
    }
  }

  return {
    success: false,
    message: 'Could not create account on VOS3000',
    detail: 'The portal account may not have write permissions for terminal accounts.',
  };
}
