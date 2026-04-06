/**
 * Sippy Softswitch Integration
 *
 * Sippy uses an XML-RPC style API over HTTP.
 * All requests POST to /xmlapi/xmlapi with HTTP Basic Auth.
 * Responses are XML wrapped in <methodResponse><params><param><value>...</value>
 */

import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

// ── In-memory session state ───────────────────────────────────────────────────

interface SippySession {
  portalUrl: string;
  username: string;
  connectedAt: Date;
}

let activeSession: SippySession | null = null;

export function getSippySessionStatus() {
  if (!activeSession) return { active: false };
  return {
    active: true,
    username: activeSession.username,
    connectedAt: activeSession.connectedAt.toISOString(),
    portalBase: activeSession.portalUrl,
  };
}

export function clearSippySession() {
  activeSession = null;
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

function rawPost(url: string, body: string, headers: Record<string, string>): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const mod = isHttps ? https : http;

    const opts: http.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port ? parseInt(parsed.port) : (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml',
        'Content-Length': Buffer.byteLength(body),
        ...headers,
      },
      timeout: 10000,
    };

    const req = mod.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body: data }));
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.write(body);
    req.end();
  });
}

function rawGet(url: string, headers: Record<string, string>): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const mod = isHttps ? https : http;

    const opts: http.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port ? parseInt(parsed.port) : (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers,
      timeout: 10000,
    };

    const req = mod.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body: data }));
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

// ── XML-RPC builder ───────────────────────────────────────────────────────────

function xmlRpcCall(method: string, params: Record<string, string | number | boolean> = {}): string {
  const members = Object.entries(params)
    .map(([k, v]) => {
      let valTag: string;
      if (typeof v === 'boolean') valTag = `<boolean>${v ? 1 : 0}</boolean>`;
      else if (typeof v === 'number') valTag = `<int>${v}</int>`;
      else valTag = `<string>${v}</string>`;
      return `<member><name>${k}</name><value>${valTag}</value></member>`;
    })
    .join('');

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
): Promise<{ reachable: boolean; message: string; latencyMs?: number }> {
  const base = sippyBase(portalUrl);
  const apiUrl = `${base}/xmlapi/xmlapi`;
  const body = xmlRpcCall('i_version.listAvailableMethods');
  const start = Date.now();

  try {
    const resp = await rawPost(apiUrl, body, {
      Authorization: basicAuth(username, password),
    });
    const latencyMs = Date.now() - start;

    if (resp.statusCode === 401) {
      return { reachable: true, message: 'Reached the portal but authentication failed — check your username/password.' };
    }
    if (resp.statusCode === 404) {
      // Some Sippy versions put the API at a different path
      const resp2 = await rawGet(`${base}/`, { Authorization: basicAuth(username, password) });
      if (resp2.statusCode < 500) {
        return { reachable: true, message: `Portal is reachable (${latencyMs}ms) but the XML-RPC API path may differ. Verify the URL.` };
      }
      return { reachable: false, message: 'Portal returned 404 — confirm the Portal URL and API path.' };
    }
    if (resp.statusCode >= 200 && resp.statusCode < 300) {
      return { reachable: true, message: `Connected to Sippy successfully (${latencyMs}ms)` };
    }
    return { reachable: false, message: `Unexpected HTTP ${resp.statusCode} from portal.` };
  } catch (err: any) {
    if (err.code === 'ECONNREFUSED') return { reachable: false, message: 'Connection refused — check the URL and port.' };
    if (err.code === 'ENOTFOUND') return { reachable: false, message: 'Host not found — check the Portal URL.' };
    return { reachable: false, message: err.message ?? 'Unknown connection error.' };
  }
}

// ── Login (connect and store session) ────────────────────────────────────────

export async function connectSippy(
  portalUrl: string,
  username: string,
  password: string,
): Promise<{ success: boolean; message: string }> {
  const result = await testSippyConnection(portalUrl, username, password);
  if (!result.reachable) return { success: false, message: result.message };

  activeSession = { portalUrl: sippyBase(portalUrl), username, connectedAt: new Date() };
  return { success: true, message: result.message };
}

// ── Active Calls ──────────────────────────────────────────────────────────────

export interface SippyActiveCall {
  callId: string;
  caller: string;
  callee: string;
  duration: number; // seconds
  codec: string;
  status: string;
}

export async function getSippyActiveCalls(username: string, password: string, explicitPortalUrl?: string): Promise<SippyActiveCall[]> {
  const base = explicitPortalUrl ? sippyBase(explicitPortalUrl) : activeSession?.portalUrl;
  if (!base) return [];
  const apiUrl = `${base}/xmlapi/xmlapi`;
  const body = xmlRpcCall('call_control.listActiveCalls');

  try {
    const resp = await rawPost(apiUrl, body, {
      Authorization: basicAuth(username, password),
    });
    if (resp.statusCode !== 200) return [];

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
 * Push a rate entry to Sippy via XML-RPC.
 * Tries customer.setAccount, tariff.setRate and tariff.addRatePlan.
 */
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

  const apiUrl = `${sippyBase(baseUrl)}/xmlapi/xmlapi`;
  const auth   = { Authorization: basicAuth(credentials.username, credentials.password) };
  const effFrom = opts.effectiveFrom ? fmtSippyDate(opts.effectiveFrom) : fmtSippyDate(new Date());

  // Attempt 1: tariff.setRate
  try {
    const body = xmlRpcCall('tariff.setRate', {
      destination: opts.prefix,
      rate:        opts.ratePerMin,
      account:     opts.accountName,
      start_date:  effFrom,
      ...(opts.effectiveTo ? { end_date: fmtSippyDate(opts.effectiveTo) } : {}),
    });
    const resp = await rawPost(apiUrl, body, auth);
    if (resp.statusCode === 200 && !resp.body.includes('<fault>')) {
      return { success: true, message: 'Rate pushed via Sippy tariff.setRate', method: 'tariff.setRate' };
    }
  } catch (e: any) { console.warn('[Sippy] tariff.setRate:', e.message); }

  // Attempt 2: customer.setAccount (update account-level rate)
  try {
    const body = xmlRpcCall('customer.setAccount', {
      i_account:    0,
      name:         opts.accountName,
      billing_model: 1,
      balance:       0,
    });
    const resp = await rawPost(apiUrl, body, auth);
    if (resp.statusCode === 200 && !resp.body.includes('<fault>')) {
      return { success: true, message: 'Account updated via Sippy customer.setAccount', method: 'customer.setAccount' };
    }
  } catch (e: any) { console.warn('[Sippy] customer.setAccount:', e.message); }

  // Attempt 3: tariff.addRatePlan
  try {
    const body = xmlRpcCall('tariff.addRatePlan', {
      destination: opts.prefix,
      rate:        opts.ratePerMin,
      account_name: opts.accountName,
    });
    const resp = await rawPost(apiUrl, body, auth);
    if (resp.statusCode === 200 && !resp.body.includes('<fault>')) {
      return { success: true, message: 'Rate added via Sippy tariff.addRatePlan', method: 'tariff.addRatePlan' };
    }
  } catch (e: any) { console.warn('[Sippy] tariff.addRatePlan:', e.message); }

  return { success: false, message: 'Could not push rate to Sippy', detail: 'None of the XML-RPC methods accepted the request.' };
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
}

export async function pushAccountToSippy(
  opts: SippyAccountOpts,
  credentials: { username: string; password: string },
  targetUrl?: string,
): Promise<SippyPushResult> {
  const baseUrl = targetUrl ?? activeSession?.portalUrl;
  if (!baseUrl) return { success: false, message: 'Not connected to Sippy.' };

  const apiUrl = `${sippyBase(baseUrl)}/xmlapi/xmlapi`;
  const auth   = { Authorization: basicAuth(credentials.username, credentials.password) };

  // Build the full account parameter set (only include non-empty values)
  const accountParams: Record<string, string | number | boolean> = {
    name: opts.name,
    type: opts.type === 'vendor' ? 'vendor' : 'customer',
  };
  if (opts.ipAddress)           accountParams.ip                   = opts.ipAddress;
  if (opts.ratePerMin !== undefined) accountParams.rate            = opts.ratePerMin;
  if (opts.timezone)            accountParams.time_zone            = opts.timezone;
  if (opts.language)            accountParams.language             = opts.language;
  if (opts.sipClass)            accountParams.i_class              = opts.sipClass;
  if (opts.routingGroup)        accountParams.i_routing_group      = opts.routingGroup;
  if (opts.servicePlan)         accountParams.i_tariff             = opts.servicePlan;
  if (opts.creditLimit !== undefined) accountParams.credit_limit   = opts.creditLimit;
  if (opts.maxSessions !== undefined) accountParams.max_sessions   = opts.maxSessions;
  if (opts.maxCallsPerSecond !== undefined) accountParams.max_calls_per_second = opts.maxCallsPerSecond;
  if (opts.maxSessionTime !== undefined) accountParams.max_session_time = opts.maxSessionTime;
  if (opts.preferredCodec)      accountParams.preferred_codec      = opts.preferredCodec;
  if (opts.cldTranslationRule)  accountParams.cld_translation_rule = opts.cldTranslationRule;
  if (opts.cliTranslationRule)  accountParams.cli_translation_rule = opts.cliTranslationRule;
  if (opts.companyName)         accountParams.company_name         = opts.companyName;

  // Attempt: customer.addAccount (create or upsert)
  try {
    const body = xmlRpcCall('customer.addAccount', accountParams);
    const resp = await rawPost(apiUrl, body, auth);
    if (resp.statusCode === 200 && !resp.body.includes('<fault>')) {
      console.log(`[Sippy] customer.addAccount succeeded for "${opts.name}"`);
      return { success: true, message: `Account "${opts.name}" added/updated on Sippy`, method: 'customer.addAccount' };
    }
    const fault = extractTag(resp.body, 'faultString');
    console.warn('[Sippy] customer.addAccount fault:', fault);
  } catch (e: any) { console.warn('[Sippy] customer.addAccount:', e.message); }

  // Attempt: customer.updateAccount (may work if account already exists)
  try {
    const body = xmlRpcCall('customer.updateAccount', accountParams);
    const resp = await rawPost(apiUrl, body, auth);
    if (resp.statusCode === 200 && !resp.body.includes('<fault>')) {
      console.log(`[Sippy] customer.updateAccount succeeded for "${opts.name}"`);
      return { success: true, message: `Account "${opts.name}" updated on Sippy`, method: 'customer.updateAccount' };
    }
  } catch (e: any) { console.warn('[Sippy] customer.updateAccount:', e.message); }

  // Attempt: customer.setAccount (some Sippy versions use this)
  try {
    const body = xmlRpcCall('customer.setAccount', accountParams);
    const resp = await rawPost(apiUrl, body, auth);
    if (resp.statusCode === 200 && !resp.body.includes('<fault>')) {
      console.log(`[Sippy] customer.setAccount succeeded for "${opts.name}"`);
      return { success: true, message: `Account "${opts.name}" set on Sippy`, method: 'customer.setAccount' };
    }
  } catch (e: any) { console.warn('[Sippy] customer.setAccount:', e.message); }

  return { success: false, message: 'Could not push account to Sippy', detail: 'Check Sippy API permissions and account type.' };
}

export async function getSippyStats(username: string, password: string, explicitPortalUrl?: string): Promise<SippyStats> {
  const base = explicitPortalUrl ? sippyBase(explicitPortalUrl) : activeSession?.portalUrl;
  if (!base) return { totalCalls: 0, activeCalls: 0, successRate: 0, totalMinutes: 0 };
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
