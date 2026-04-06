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
  cost?: number;
}

export interface LiveCallRecord {
  id: string;
  startTime: string;
  caller: string;
  callee: string;
  gateway: string;
  duration: number;
}

// ─── In-memory state ──────────────────────────────────────────────────────────

let activeSession: Vos3000Session | null = null;
const pendingCaptchas = new Map<string, CaptchaChallenge>();

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
  const bodyStr = new URLSearchParams({
    loginType: String(loginType ?? 1),
    textFieldName: username,
    textFieldPwd: password,
    vcode: captchaCode.trim(),
    submit: 'Login',
  }).toString();

  try {
    const resp = await rawRequest({
      url: `${base}login.jsp`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': cookieHeader(challenge.sessionCookie),
        'User-Agent': 'Mozilla/5.0',
        'Referer': base,
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
      activeSession = {
        jsessionid: challenge.sessionCookie,
        portalBase: base,
        username,
        loggedInAt: new Date(),
      };
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
    cost: Number(r.cost || r.amount || r.fee || 0),
  };
}

function parseLiveRow(r: any): LiveCallRecord {
  return {
    id: String(r.id || r.call_id || Math.random()),
    startTime: new Date().toISOString(),
    caller: r.caller || r.cli || '',
    callee: r.callee || r.cld || '',
    gateway: r.gateway || r.gw || '',
    duration: Number(r.duration || r.elapsed || r.seconds || 0),
  };
}
