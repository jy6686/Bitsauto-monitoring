/**
 * VOS3000 Integration Module
 * Handles authentication (CAPTCHA relay), session management, and live data fetching
 * from a VOS3000 VoIP softswitch (by Linknat).
 */

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

interface CdrRecord {
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

interface LiveCallRecord {
  id: string;
  startTime: string;
  caller: string;
  callee: string;
  gateway: string;
  duration: number;
}

// In-memory state — cleared on server restart (acceptable for session data)
let activeSession: Vos3000Session | null = null;
const pendingCaptchas = new Map<string, CaptchaChallenge>();

function portalBase(rawUrl: string): string {
  const u = new URL(rawUrl);
  // Ensure trailing slash
  return `${u.protocol}//${u.host}${u.pathname.endsWith('/') ? u.pathname : u.pathname + '/'}`;
}

function buildCookieHeader(jsessionid: string): string {
  return `JSESSIONID=${jsessionid}`;
}

/**
 * Fetches a fresh CAPTCHA image from VOS3000 and stores a pending challenge.
 * Returns the challenge ID and image as base64 PNG.
 */
export async function fetchCaptcha(portalUrl: string): Promise<{ challengeId: string; imageBase64: string } | null> {
  try {
    const base = portalBase(portalUrl);

    // Step 1: GET the login page to create a new JSESSIONID
    const loginPageResp = await fetch(`${base}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VoSMonitor/1.0)' },
      redirect: 'follow',
    });

    // Extract JSESSIONID from Set-Cookie header
    const setCookieRaw = loginPageResp.headers.get('set-cookie') || '';
    const sessionMatch = setCookieRaw.match(/JSESSIONID=([A-F0-9]+)/i);
    if (!sessionMatch) return null;
    const jsessionid = sessionMatch[1];

    // Step 2: Fetch the CAPTCHA image using the same session
    const captchaResp = await fetch(`${base}verifyimage.jsp`, {
      headers: {
        'Cookie': buildCookieHeader(jsessionid),
        'User-Agent': 'Mozilla/5.0 (compatible; VoSMonitor/1.0)',
      },
    });

    if (!captchaResp.ok) return null;

    // Read as buffer and convert to base64
    const arrayBuf = await captchaResp.arrayBuffer();
    const base64 = Buffer.from(arrayBuf).toString('base64');
    const contentType = captchaResp.headers.get('content-type') || 'image/jpeg';

    // Generate a unique challenge ID
    const challengeId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Store pending challenge (expires after 5 minutes)
    pendingCaptchas.set(challengeId, {
      challengeId,
      imageBase64: `data:${contentType};base64,${base64}`,
      sessionCookie: jsessionid,
      createdAt: new Date(),
    });

    // Clean up old challenges
    for (const [id, ch] of pendingCaptchas.entries()) {
      if (Date.now() - ch.createdAt.getTime() > 5 * 60 * 1000) {
        pendingCaptchas.delete(id);
      }
    }

    return { challengeId, imageBase64: `data:${contentType};base64,${base64}` };
  } catch (err) {
    console.error('[VOS3000] fetchCaptcha error:', err);
    return null;
  }
}

/**
 * Completes VOS3000 login using the CAPTCHA challenge + credentials.
 * Stores the session for future API calls.
 */
export async function loginWithCaptcha(
  portalUrl: string,
  username: string,
  password: string,
  challengeId: string,
  captchaCode: string,
): Promise<{ success: boolean; message: string }> {
  const challenge = pendingCaptchas.get(challengeId);
  if (!challenge) {
    return { success: false, message: 'CAPTCHA challenge expired or not found. Please request a new one.' };
  }

  const base = portalBase(portalUrl);

  try {
    const body = new URLSearchParams({
      loginType: '0',
      textFieldName: username,
      textFieldPwd: password,
      vcode: captchaCode.trim(),
      submit: 'Login',
    });

    const resp = await fetch(`${base}login.jsp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': buildCookieHeader(challenge.sessionCookie),
        'User-Agent': 'Mozilla/5.0 (compatible; VoSMonitor/1.0)',
        'Referer': base,
      },
      body: body.toString(),
      redirect: 'manual',
    });

    const text = await resp.text().catch(() => '');

    // VOS3000 returns JSON: {"retCode":0} on success, {"retCode":-XXXX,"exception":"..."} on failure
    let retCode: number | null = null;
    let exception = '';
    try {
      const json = JSON.parse(text);
      retCode = json.retCode;
      exception = json.exception || '';
    } catch {
      // Not JSON — might be an HTML redirect page (success)
    }

    if (retCode === 0 || (retCode === null && (resp.status === 302 || resp.status === 200))) {
      // Login successful
      pendingCaptchas.delete(challengeId);
      activeSession = {
        jsessionid: challenge.sessionCookie,
        portalBase: base,
        username,
        loggedInAt: new Date(),
      };
      return { success: true, message: `Logged in to VOS3000 as ${username}` };
    }

    // Failed
    const friendlyMsg = mapVosError(retCode, exception);
    return { success: false, message: friendlyMsg };
  } catch (err) {
    console.error('[VOS3000] loginWithCaptcha error:', err);
    return { success: false, message: 'Network error connecting to portal.' };
  }
}

function mapVosError(retCode: number | null, exception: string): string {
  if (retCode === -12105 || exception.includes('verify code')) return 'Incorrect CAPTCHA code. Please try again.';
  if (retCode === -12101 || exception.includes('password')) return 'Wrong username or password.';
  if (retCode === -12102) return 'Account locked. Contact your VOS3000 administrator.';
  if (retCode === -12103) return 'Account does not exist.';
  if (retCode === -12104) return 'Account expired.';
  return exception || `Login failed (code ${retCode})`;
}

/**
 * Returns whether there is an active portal session and basic info about it.
 */
export function getSessionStatus(): { active: boolean; username?: string; loggedInAt?: Date; portalBase?: string } {
  if (!activeSession) return { active: false };
  return {
    active: true,
    username: activeSession.username,
    loggedInAt: activeSession.loggedInAt,
    portalBase: activeSession.portalBase,
  };
}

/**
 * Clears the stored VOS3000 session.
 */
export function clearSession(): void {
  activeSession = null;
}

/**
 * Fetches CDR records from VOS3000 for the given time range.
 * VOS3000 gateway CDR query endpoint.
 */
export async function fetchCdrRecords(options: {
  limit?: number;
  startHoursAgo?: number;
} = {}): Promise<{ records: CdrRecord[]; error?: string }> {
  if (!activeSession) return { records: [], error: 'Not logged in to portal.' };

  const { limit = 100, startHoursAgo = 24 } = options;
  const base = activeSession.portalBase;

  try {
    const now = new Date();
    const start = new Date(now.getTime() - startHoursAgo * 60 * 60 * 1000);

    // VOS3000 CDR query — try gateway CDR query endpoint
    const body = new URLSearchParams({
      page: '1',
      rows: String(limit),
      starttime: formatVosDate(start),
      endtime: formatVosDate(now),
    });

    const resp = await fetch(`${base}gateway/cdrQuery.action`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': buildCookieHeader(activeSession.jsessionid),
        'User-Agent': 'Mozilla/5.0 (compatible; VoSMonitor/1.0)',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': base,
      },
      body: body.toString(),
    });

    if (resp.status === 302 || resp.status === 403) {
      activeSession = null;
      return { records: [], error: 'Session expired. Please log in again.' };
    }

    const text = await resp.text();

    // Try to parse JSON response
    try {
      const json = JSON.parse(text);
      if (json.rows && Array.isArray(json.rows)) {
        return { records: json.rows.map(parseVosCdrRow) };
      }
      if (json.retCode && json.retCode !== 0) {
        return { records: [], error: `VOS3000 error: ${json.exception || json.retCode}` };
      }
      return { records: [] };
    } catch {
      // Try alternate parse (XML-like or other format)
      return { records: [], error: 'Unexpected response format from portal.' };
    }
  } catch (err) {
    console.error('[VOS3000] fetchCdrRecords error:', err);
    return { records: [], error: 'Network error fetching CDR data.' };
  }
}

/**
 * Fetches active/live calls from VOS3000 if the endpoint is available.
 */
export async function fetchLiveCalls(): Promise<{ calls: LiveCallRecord[]; error?: string }> {
  if (!activeSession) return { calls: [], error: 'Not logged in to portal.' };

  const base = activeSession.portalBase;

  try {
    // Try the live monitor endpoint — VOS3000 admin has this; self-service may not
    const endpoints = [
      `${base}monitor/liveCallQuery.action`,
      `${base}gateway/liveCallQuery.action`,
      `${base}admin/monitor/liveCalls.action`,
    ];

    for (const url of endpoints) {
      const resp = await fetch(url, {
        headers: {
          'Cookie': buildCookieHeader(activeSession.jsessionid),
          'User-Agent': 'Mozilla/5.0 (compatible; VoSMonitor/1.0)',
          'X-Requested-With': 'XMLHttpRequest',
        },
      });

      if (resp.status === 302 || resp.status === 403) continue;
      if (!resp.ok) continue;

      const text = await resp.text();
      try {
        const json = JSON.parse(text);
        if (json.rows && Array.isArray(json.rows)) {
          return { calls: json.rows.map(parseVosLiveRow) };
        }
        if (Array.isArray(json)) {
          return { calls: json.map(parseVosLiveRow) };
        }
      } catch { continue; }
    }

    // No live call endpoint found — return empty (not an error)
    return { calls: [] };
  } catch (err) {
    console.error('[VOS3000] fetchLiveCalls error:', err);
    return { calls: [], error: 'Network error fetching live calls.' };
  }
}

/**
 * Fetches expenditure/traffic summary stats from VOS3000.
 */
export async function fetchStats(): Promise<{
  totalCalls: number;
  successCalls: number;
  failedCalls: number;
  totalMinutes: number;
  totalCost: number;
  asr: number;
  error?: string;
}> {
  if (!activeSession) return {
    totalCalls: 0, successCalls: 0, failedCalls: 0, totalMinutes: 0, totalCost: 0, asr: 0,
    error: 'Not logged in to portal.',
  };

  const base = activeSession.portalBase;

  try {
    const now = new Date();
    const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const body = new URLSearchParams({
      starttime: formatVosDate(start),
      endtime: formatVosDate(now),
    });

    const resp = await fetch(`${base}gateway/expenditureSummary.action`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': buildCookieHeader(activeSession.jsessionid),
        'User-Agent': 'Mozilla/5.0 (compatible; VoSMonitor/1.0)',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': base,
      },
      body: body.toString(),
    });

    if (resp.status === 302 || resp.status === 403) {
      activeSession = null;
      return {
        totalCalls: 0, successCalls: 0, failedCalls: 0, totalMinutes: 0, totalCost: 0, asr: 0,
        error: 'Session expired.',
      };
    }

    const text = await resp.text();
    try {
      const json = JSON.parse(text);
      const rows: any[] = json.rows || (Array.isArray(json) ? json : []);

      let totalCalls = 0, successCalls = 0, totalMinutes = 0, totalCost = 0;
      for (const row of rows) {
        totalCalls += Number(row.total_calls || row.totalCalls || row.callCount || 0);
        successCalls += Number(row.success_calls || row.successCalls || row.answerCall || 0);
        totalMinutes += Number(row.total_minutes || row.totalMinutes || row.talkTime || 0) / 60;
        totalCost += Number(row.total_cost || row.totalCost || row.amount || 0);
      }

      return {
        totalCalls,
        successCalls,
        failedCalls: totalCalls - successCalls,
        totalMinutes: Math.round(totalMinutes),
        totalCost: parseFloat(totalCost.toFixed(2)),
        asr: totalCalls > 0 ? parseFloat(((successCalls / totalCalls) * 100).toFixed(1)) : 0,
      };
    } catch {
      return {
        totalCalls: 0, successCalls: 0, failedCalls: 0, totalMinutes: 0, totalCost: 0, asr: 0,
      };
    }
  } catch (err) {
    console.error('[VOS3000] fetchStats error:', err);
    return {
      totalCalls: 0, successCalls: 0, failedCalls: 0, totalMinutes: 0, totalCost: 0, asr: 0,
      error: 'Network error fetching stats.',
    };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function formatVosDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function parseVosCdrRow(row: any): CdrRecord {
  return {
    id: row.id || row.cdrId || String(row.call_id || Math.random()),
    startTime: row.starttime || row.start_time || row.calltime || '',
    endTime: row.endtime || row.end_time || '',
    duration: Number(row.duration || row.talk_time || row.billseconds || 0),
    caller: row.caller || row.cli || row.callerNum || '',
    callee: row.callee || row.cld || row.calleeNum || '',
    status: row.status || row.result || '',
    cause: row.cause || row.disconnect_cause || row.reason || '',
    gateway: row.gateway || row.gw_name || row.gwName || '',
    cost: Number(row.cost || row.amount || row.fee || 0),
  };
}

function parseVosLiveRow(row: any): LiveCallRecord {
  const startMs = row.start_time || row.starttime || row.callStartTime || Date.now();
  const elapsed = row.duration || row.elapsed || row.seconds || 0;
  return {
    id: row.id || row.call_id || String(Math.random()),
    startTime: new Date(typeof startMs === 'number' && startMs < 2e12 ? startMs * 1000 : startMs).toISOString(),
    caller: row.caller || row.cli || '',
    callee: row.callee || row.cld || '',
    gateway: row.gateway || row.gw || '',
    duration: Number(elapsed),
  };
}
