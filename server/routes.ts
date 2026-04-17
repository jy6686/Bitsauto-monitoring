
import type { Express } from "express";
import { createServer, type Server } from "http";
import * as net from "net";
import * as https from "https";
import { createHash, randomBytes } from "crypto";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { setupAuth, registerAuthRoutes } from "./replit_integrations/auth";
import * as sippy from "./sippy";
import * as sippySnmp from "./snmp";
import * as emailSvc from "./email";
import * as waSvc from "./whatsapp";
import { enrichCdr, detectCountry, detectTrunkClass, sipCodeToFailReason, detectFas, calcVendorFraudStats, detectIrsf } from "./cdr-enrichment";
import { initSippyWatcher, notifyNewClientTraffic, getWatcherStatus, sendTestWatcherAlert } from "./sippy-watcher";
import { lookupDialCode } from "./dial-lookup";
import { readFileSync } from "fs";
import { join as _pathJoin } from "path";
import { generateStatusReport, STATUS_REPORT_PATH } from "./doc-generator";
import { generateUserManual, USER_MANUAL_PATH } from "./manual-generator";
import { generateSippyDataflowDoc, SIPPY_DATAFLOW_PATH } from "./sippy-dataflow-generator";

// ── /api/dial-codes handler — serves raw prefix JSON for client-side lookup ───
// Uses process.cwd() so it works in both ESM dev (tsx) and CJS production build.
let _dialCodesJson: string | null = null;
function dialCodesHandler(_req: any, res: any) {
  if (!_dialCodesJson) {
    const p = _pathJoin(process.cwd(), 'server', 'dial-codes.json');
    _dialCodesJson = readFileSync(p, 'utf-8');
  }
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(_dialCodesJson);
}

// ── Account name cache — populated dynamically from Sippy listAccounts() ──────
// Maps iAccount string → username. No hardcoded IDs — always reflects the live switch.
const accountNameCache: Map<string, string> = new Map();

// Ordered list of all known iAccount IDs — used for CDR batch fetching.
// Refreshed every 30 min alongside connectionVendorCache.
let liveAccountIds: number[] = [];

// ── Vendor balance tracker ────────────────────────────────────────────────────
// Polls listSippyVendors every 60 s and stores timestamped balance snapshots.
// The asr-acd-stats endpoint uses balance delta (T-90min → T-30min) to compute
// actual vendor cost — the only method that works without admin portal access.
interface VendorBalanceSnapshot {
  timestamp: number;  // Date.now()
  vendors: Array<{ iVendor: number; name: string; balance: number }>;
}
const vendorBalanceHistory: VendorBalanceSnapshot[] = [];
const VENDOR_BALANCE_HISTORY_MS = 2 * 60 * 60_000; // keep 2 hours

async function refreshVendorBalances(): Promise<void> {
  try {
    const settings = await storage.getSippySettings();
    if (!settings) return;
    const { username, password } = sippyXmlCreds(settings);
    const { vendors } = await sippy.listSippyVendors(username, password);
    if (!vendors?.length) return;
    const snap: VendorBalanceSnapshot = {
      timestamp: Date.now(),
      vendors: vendors.map(v => ({ iVendor: v.iVendor, name: v.name, balance: v.balance ?? 0 })),
    };
    vendorBalanceHistory.push(snap);
    const balStr = vendors.map(v => `${v.name}=$${(v.balance ?? 0).toFixed(4)}`).join(', ');
    console.log(`[vendor-balance] snapshot #${vendorBalanceHistory.length}: ${balStr}`);
    // Prune old snapshots
    const cutoff = Date.now() - VENDOR_BALANCE_HISTORY_MS;
    let i = 0;
    while (i < vendorBalanceHistory.length && vendorBalanceHistory[i].timestamp < cutoff) i++;
    if (i > 0) vendorBalanceHistory.splice(0, i);
  } catch { /* ignore transient errors */ }
}

/**
 * Compute vendor cost from balance delta between two time points.
 * Looks for the closest snapshots at or before `tStartMs` and `tEndMs`.
 * Returns null if no valid history data is available yet.
 */
function vendorCostFromHistory(tStartMs: number, tEndMs: number): number | null {
  if (vendorBalanceHistory.length < 2) return null;
  // Find latest snapshot at or before tStartMs
  let snapStart: VendorBalanceSnapshot | null = null;
  for (let i = vendorBalanceHistory.length - 1; i >= 0; i--) {
    if (vendorBalanceHistory[i].timestamp <= tStartMs) { snapStart = vendorBalanceHistory[i]; break; }
  }
  // Find latest snapshot at or before tEndMs
  let snapEnd: VendorBalanceSnapshot | null = null;
  for (let i = vendorBalanceHistory.length - 1; i >= 0; i--) {
    if (vendorBalanceHistory[i].timestamp <= tEndMs) { snapEnd = vendorBalanceHistory[i]; break; }
  }
  if (!snapStart || !snapEnd || snapStart.timestamp === snapEnd.timestamp) return null;
  // Compute cost from balance delta per vendor.
  // Callntalk is postpaid: balance INCREASES as calls go through (balance = running payable to vendor).
  // So cost = end_balance − start_balance when positive.
  // For prepaid vendors (balance decreases): cost = start_balance − end_balance when positive.
  // We take the absolute delta since direction depends on vendor contract type.
  let totalCost = 0;
  for (const ve of snapEnd.vendors) {
    const vs = snapStart.vendors.find(v => v.iVendor === ve.iVendor);
    if (vs) {
      const delta = Math.abs(ve.balance - vs.balance);  // works for both prepaid and postpaid
      if (delta > 0) totalCost += delta;
    }
  }
  return parseFloat(totalCost.toFixed(4));
}

async function refreshAccountCache(): Promise<void> {
  try {
    const settings = await storage.getSippySettings();
    if (!settings) return;
    const portalUrl = sippyPortalUrl(settings);
    const { accounts } = await withSippyCreds(settings, (u, p) =>
      sippy.listSippyAccounts(u, p, {}, portalUrl));
    if (!accounts?.length) return;
    const newIds: number[] = [];
    for (const acct of accounts) {
      if (acct.iAccount && acct.username) {
        accountNameCache.set(String(acct.iAccount), acct.username);
        newIds.push(acct.iAccount);
      }
    }
    if (newIds.length) liveAccountIds = newIds;
    console.log(`[routes] accountCache refreshed: ${liveAccountIds.length} accounts`);
  } catch (e: any) {
    console.warn('[routes] accountCache refresh failed:', e.message);
  }
}

// ── Connection → Vendor name cache ────────────────────────────────────────────
// Maps I_CONNECTION string → vendor name (e.g. "2" → "Callntalk").
// Populated at startup and refreshed every 30 minutes.
const connectionVendorCache: Map<string, string> = new Map();

// ── Connection IP → Vendor name cache ─────────────────────────────────────────
// Maps termination IP (host without port) → vendor name.
// Used to enrich client CDRs with vendor name from CDR.remoteIp.
const connectionIpCache: Map<string, string> = new Map();

async function refreshConnectionVendorCache(): Promise<void> {
  try {
    const settings = await storage.getSippySettings();
    if (!settings) return;
    const portalUrl = sippyPortalUrl(settings);
    // Determine the first working credential pair for this refresh cycle
    const credPairs = sippyXmlCredsPairs(settings);
    let workingUser = credPairs[0].username;
    let workingPass = credPairs[0].password;
    const { vendors } = await withSippyCreds(settings, async (u, p) => {
      const r = await sippy.listSippyVendors(u, p, {}, portalUrl);
      if (!r.error?.includes('401') && !r.error?.includes('403')) { workingUser = u; workingPass = p; }
      return r;
    });
    if (!vendors?.length) return;
    connectionVendorCache.clear();
    connectionIpCache.clear();
    await Promise.all(vendors.map(async (v: any) => {
      if (!v.iVendor) return;
      const vendorName = v.name ?? `Vendor#${v.iVendor}`;
      // Map iVendor ID → name (activecalls.php often shows iVendor as "Connection" column)
      connectionVendorCache.set(String(v.iVendor), vendorName);
      // Map vendor name string → name (identity; handles portal returning name directly)
      if (v.name) connectionVendorCache.set(v.name, vendorName);
      try {
        const { connections } = await sippy.listVendorConnections(workingUser, workingPass, v.iVendor, portalUrl);
        for (const conn of connections ?? []) {
          if (conn.iConnection) connectionVendorCache.set(String(conn.iConnection), vendorName);
          if (conn.name)        connectionVendorCache.set(conn.name, vendorName);
          // Extract host IP from destination (format: "host:port" or "host")
          if (conn.destination) {
            const destHost = conn.destination.split(':')[0].trim();
            if (destHost) connectionIpCache.set(destHost, vendorName);
          }
        }
      } catch { /* skip per-vendor connection fetch failures */ }
    }));
    console.log(`[routes] connectionVendorCache refreshed: ${connectionVendorCache.size} entries, ipCache: ${connectionIpCache.size} IPs`);
  } catch (e: any) {
    console.warn('[routes] connectionVendorCache refresh failed:', e.message);
  }
}

// ── Sippy credential helper ────────────────────────────────────────────────────
// Per Sippy docs (106909): XML-RPC API authenticates with Web Login + API Password.
// Admin credentials (apiAdminUsername/apiAdminPassword) provide root-level API access
// and are always preferred over customer-level portal credentials.
// Portal username/password are used as a fallback (e.g. when admin creds are not set).
// Hardcoded defaults ensure the system works out-of-the-box without manual configuration.
const DEFAULT_SIPPY_URL      = 'https://191.101.30.107';
const DEFAULT_SIPPY_USERNAME = 'ssp-root';
const DEFAULT_SIPPY_PASSWORD = '!chiaan1';
type SippyCreds = { portalUrl?: string | null; apiAdminUsername?: string | null; apiAdminPassword?: string | null; portalUsername?: string | null; portalPassword?: string | null };

// Returns [primary, fallback] credential pairs ordered so that the most likely
// admin/XML-RPC pair comes first. When the user has the fields swapped, the
// fallback pair lets callers retry without a 401 surfacing to the UI.
function sippyXmlCredsPairs(s: SippyCreds): Array<{ username: string; password: string }> {
  const pairs: Array<{ username: string; password: string }> = [];
  if (s.apiAdminUsername && s.apiAdminPassword) pairs.push({ username: s.apiAdminUsername, password: s.apiAdminPassword });
  if (s.portalUsername && s.portalPassword)     pairs.push({ username: s.portalUsername,   password: s.portalPassword   });
  if (!pairs.length) pairs.push({ username: DEFAULT_SIPPY_USERNAME, password: DEFAULT_SIPPY_PASSWORD });
  return pairs;
}

function sippyXmlCreds(s: SippyCreds, sw?: { portalUsername?: string | null; portalPassword?: string | null }) {
  return {
    username: s.apiAdminUsername || sw?.portalUsername || s.portalUsername || DEFAULT_SIPPY_USERNAME,
    password: s.apiAdminPassword || sw?.portalPassword || s.portalPassword || DEFAULT_SIPPY_PASSWORD,
  };
}
function sippyPortalUrl(s: { portalUrl?: string | null }): string {
  return s.portalUrl || DEFAULT_SIPPY_URL;
}

// ── Credential-pair retry helper ───────────────────────────────────────────
// Tries each credential pair in order; returns on first non-401/403 result.
// Prevents "HTTP 401" errors when apiAdminUsername/portalUsername are swapped.
async function withSippyCreds<T extends { error?: string; success?: boolean; message?: string }>(
  settings: SippyCreds,
  fn: (username: string, password: string) => Promise<T>,
): Promise<T> {
  const pairs = sippyXmlCredsPairs(settings);
  let last!: T;
  for (let i = 0; i < pairs.length; i++) {
    const { username, password } = pairs[i];
    last = await fn(username, password);
    // Stop immediately on success
    if (last.success === true) return last;
    // If not the last pair, check whether to retry
    if (i < pairs.length - 1) {
      const errStr = (last.error ?? last.message ?? '').toLowerCase();
      const isAuthError = errStr.includes('401') || errStr.includes('403')
        || errStr.includes('unauthorized') || errStr.includes('not authorized')
        || errStr.includes('access denied') || errStr.includes('failed.')
        || errStr.includes('not connected');
      if (isAuthError) continue; // try next credential pair
    }
    // Either last pair, or a non-auth error — return what we have
    return last;
  }
  return last;
}

// Like withSippyCreds but for functions that THROW on auth failure rather than returning an error object.
// Returns the first successful result; retries the next credential pair on HTTP 401/403 errors.
async function withSippyCredsRaw<T>(
  settings: SippyCreds,
  fn: (username: string, password: string) => Promise<T>,
  fallback: T,
): Promise<T> {
  const pairs = sippyXmlCredsPairs(settings);
  let lastErr: Error | null = null;
  for (const { username, password } of pairs) {
    try {
      return await fn(username, password);
    } catch (err: any) {
      lastErr = err;
      const msg = (err.message ?? '').toLowerCase();
      if (msg.includes('401') || msg.includes('403') || msg.includes('unauthorized') || msg.includes('not authorized')) {
        continue; // try next credential pair
      }
      throw err; // non-auth error — re-throw immediately
    }
  }
  // All pairs exhausted
  if (lastErr) console.warn('[withSippyCredsRaw] all credential pairs failed:', lastErr.message);
  return fallback;
}

// Simulation Constants
const SIMULATION_INTERVAL = 2000; // 2 seconds
const MAX_ACTIVE_CALLS = 10;
const CALL_DURATION_PROBABILITY = 0.1; // 10% chance to end a call each tick

// Default SIP / VoIP management ports to try in order
const DEFAULT_PROBE_PORTS = [5060, 5061, 8080, 8081, 8443, 80, 443];

// Extract port number from a URL string (e.g. "http://1.2.3.4:8081/eng/" → 8081)
function portFromUrl(url: string | null | undefined): number | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const p = Number(parsed.port);
    return p > 0 ? p : null;
  } catch {
    return null;
  }
}

/**
 * Normalise an arbitrary "monitored IP" value into a bare hostname/IP.
 * Accepts:
 *   - Plain IPs:            "45.59.163.182"          → "45.59.163.182"
 *   - IP with port:         "45.59.163.182:8081"      → "45.59.163.182"
 *   - Full URLs:            "https://191.101.30.107"  → "191.101.30.107"
 *   - URL with port/path:   "http://1.2.3.4:8081/eng" → "1.2.3.4"
 * Also returns any explicit port found in the value (for priority probing).
 */
function normalizeMonitoredIp(raw: string): { host: string; explicitPort: number | null } {
  const s = raw.trim();
  // If it starts with a scheme, parse as URL
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      const p = Number(u.port);
      return { host: u.hostname, explicitPort: p > 0 ? p : null };
    } catch {
      // fall through to plain-text parse
    }
  }
  // Otherwise treat as "host" or "host:port"
  const colonIdx = s.lastIndexOf(':');
  if (colonIdx > 0) {
    const maybePart = s.slice(colonIdx + 1);
    const maybePort = Number(maybePart);
    if (Number.isInteger(maybePort) && maybePort > 0) {
      return { host: s.slice(0, colonIdx), explicitPort: maybePort };
    }
  }
  return { host: s, explicitPort: null };
}

// Probe an IP address by attempting TCP connections on a prioritised port list.
// Returns the first port that responds, with its round-trip latency.
function probeIp(ip: string, priorityPorts: number[] = []): Promise<{ latency: number; reachable: boolean; port?: number }> {
  // Build deduplicated port list: priority ports first, then defaults
  const ports = [...new Set([...priorityPorts, ...DEFAULT_PROBE_PORTS])];

  return new Promise((resolve) => {
    function tryPort(portIndex: number) {
      if (portIndex >= ports.length) {
        resolve({ latency: 999, reachable: false });
        return;
      }
      const port = ports[portIndex];
      const start = Date.now();
      const socket = new net.Socket();
      socket.setTimeout(2000);

      socket.connect(port, ip, () => {
        const latency = Date.now() - start;
        socket.destroy();
        resolve({ latency, reachable: true, port });
      });

      socket.on('timeout', () => { socket.destroy(); tryPort(portIndex + 1); });
      socket.on('error',   () => { socket.destroy(); tryPort(portIndex + 1); });
    }

    tryPort(0);
  });
}

// In-memory store for latest IP probe results (primary + softswitch)
let lastProbeResult: { latency: number; reachable: boolean; port?: number; host?: string; timestamp: Date } | null = null;
let lastSwitchProbeResult: { latency: number; reachable: boolean; port?: number; host?: string; timestamp: Date; label: string } | null = null;

// ── In-memory push jobs (Rate Card → Sippy Tariff) ──────────────────────────
type PushJob = { status: 'running'|'done'|'error'; pushed: number; failed: number; total: number; startedAt: string; message?: string };
const pushJobs = new Map<string, PushJob>();

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Auth Setup
  await setupAuth(app);
  registerAuthRoutes(app);

  // ── Smart Sippy Connect ────────────────────────────────────────────────────
  // Tries both credential pairs and always prefers XML-RPC mode over portal.
  // This handles the common case where admin credentials are saved in the
  // "portal" fields and vice-versa.
  async function smartSippyConnect(
    portalUrl: string,
    apiAdminUsername: string | null | undefined,
    apiAdminPassword: string | null | undefined,     // XML-RPC API password (My Preferences → Allow API Calls)
    portalUsername: string | null | undefined,
    portalPassword: string | null | undefined,
    adminWebPassword?: string | null,                // optional: separate web portal login password for admin
  ): Promise<{ success: boolean; message: string }> {
    const pairs: [string, string, string?][] = [];
    // adminWebPassword is used for portal login when API password differs from web login password
    if (apiAdminUsername && apiAdminPassword) pairs.push([apiAdminUsername, apiAdminPassword, adminWebPassword || undefined]);
    if (portalUsername && portalPassword) pairs.push([portalUsername, portalPassword]);
    if (!pairs.length) return { success: false, message: 'No credentials configured.' };

    let portalFallback: { success: boolean; message: string } | null = null;

    // Pass 1: try each credential pair — stop immediately if XML-RPC works
    for (const [u, p, webPw] of pairs) {
      const r = await sippy.connectSippy(portalUrl, u, p, webPw);
      if (r.success) {
        if (sippy.getSippySessionStatus().mode === 'xmlrpc') return r;
        if (!portalFallback) portalFallback = r;
        sippy.clearSippySession(); // clear portal-mode session, try next pair
      }
    }

    // Pass 2: no XML-RPC found — reconnect in portal mode with first working credentials
    if (portalFallback) {
      for (const [u, p, webPw] of pairs) {
        const r = await sippy.connectSippy(portalUrl, u, p, webPw);
        if (r.success) return r;
      }
    }

    return { success: false, message: 'Authentication failed for all configured credentials.' };
  }

  // === IP PROBE ENGINE ===
  // Runs independently to measure real latency to the monitored IP(s)
  async function runIpProbe() {
    try {
    const settings = await storage.getSettings();
    // ── Primary monitored IP ──────────────────────────────────────────────
    const raw = settings.monitoredIp;
    if (raw) {
      const { host, explicitPort } = normalizeMonitoredIp(raw);
      if (host) {
        const portalPort = portFromUrl(settings.portalUrl);
        const priorityPorts = [explicitPort, portalPort].filter((p): p is number => p !== null);
        const result = await probeIp(host, priorityPorts);
        lastProbeResult = { ...result, host, timestamp: new Date() };
      }
    }
    // ── Sippy softswitch IP (auto-derived from portalUrl) ─────────────────
    if (settings.portalUrl && settings.switchType === 'sippy') {
      try {
        const swHost = new URL(settings.portalUrl).hostname;
        const swPort = portFromUrl(settings.portalUrl) ?? 443;
        if (swHost) {
          const result = await probeIp(swHost, [swPort, 5060, 443]);
          lastSwitchProbeResult = { ...result, host: swHost, timestamp: new Date(), label: 'Sippy Switch' };
        }
      } catch {
        // malformed portalUrl — skip
      }
    }
    } catch (e: any) {
      console.warn('[ip-probe] error:', e.message);
    }
  }
  // Run probe immediately on startup, then every 10 seconds
  runIpProbe();
  setInterval(runIpProbe, 10000);

  // === BACKGROUND FAS AUTO-ANALYSIS — runs every 5 minutes ===
  // Fetches recent CDRs and saves FAS events so the dashboard stays fresh automatically.
  async function runBackgroundFasAnalysis() {
    try {
      const settings = await storage.getSettings();
      if (!settings.portalUrl) return; // no Sippy configured yet
      const credPairs = sippyXmlCredsPairs(settings);
      if (!credPairs.length) return;

      const fasMinPdd          = settings.fasMinPddSecs ?? 10;
      const fasMaxBill         = settings.fasMaxBillSecs ?? 5;
      const fasEarlyAnswerSecs = settings.fasEarlyAnswerSecs ?? 2;
      const fasShortCallSecs   = settings.fasShortCallSecs ?? 10;

      const startDate = sippy.toSippyDate(new Date(Date.now() - 30 * 60 * 1000)); // last 30 min
      const endDate   = sippy.toSippyDate(new Date());

      let cdrs: Awaited<ReturnType<typeof sippy.getSippyCDRs>> = [];
      for (const { username, password } of credPairs) {
        cdrs = await sippy.getSippyCDRs(username, password, 500, { startDate, endDate });
        if (cdrs.length > 0) break;
      }

      let saved = 0;
      for (const cdr of cdrs) {
        const rawResult = parseInt(String(cdr.result ?? '').trim()) || 0;
        const sipCodeVal: number | null = rawResult === 0 ? 200 : (rawResult >= 100 ? rawResult : null);
        const billSecsVal = cdr.duration ?? 0;
        const ringDelay = cdr.pdd1xx ?? cdr.pdd ?? null;
        const fasResult = detectFas({
          sipCode: sipCodeVal, pddSecs: ringDelay, billSecs: billSecsVal,
          fasMinPddSecs: fasMinPdd, fasMaxBillSecs: fasMaxBill,
          fasEarlyAnswerSecs, fasShortCallSecs,
        });
        if (!fasResult.isFas || !cdr.callId) continue;
        const resolvedClient = cdr.clientName
          || cdr.user
          || accountNameCache.get(String(cdr.accountId ?? cdr.iAccount ?? ''))
          || (cdr.accountId ? `Acct#${cdr.accountId}` : cdr.iAccount ? `Acct#${cdr.iAccount}` : 'Unknown');
        // Resolve vendor: prefer direct CDR field, then connection cache, then first known vendor
        const resolvedVendor = (() => {
          if (cdr.vendor) return cdr.vendor;
          if (cdr.iConnection) {
            const v = connectionVendorCache.get(String(cdr.iConnection));
            if (v && !/^\d+$/.test(v)) return v;
          }
          // Fallback: first non-numeric vendor name found in cache (works for any number of vendors)
          for (const val of connectionVendorCache.values()) {
            if (!/^\d+$/.test(val)) return val;
          }
          return '';
        })();
        try {
          await storage.createFasEvent({
            callId: String(cdr.callId), caller: cdr.caller ?? '', callee: cdr.callee ?? '',
            clientName: resolvedClient, vendor: resolvedVendor,
            pddSecs: ringDelay ?? null, billSecs: billSecsVal,
            sipCode: sipCodeVal ?? null, reason: fasResult.reason,
            fraudScore: fasResult.fraudScore, alertSent: false,
          });
          saved++;
        } catch { /* duplicate — ignore */ }
      }
      if (saved > 0) console.log(`[fas-bg] Saved ${saved} new FAS events from ${cdrs.length} CDRs`);
    } catch (err: any) {
      console.error('[fas-bg] Background FAS analysis error:', err.message);
    }
  }
  // Run once after 30s startup delay, then every 5 minutes
  setTimeout(() => {
    runBackgroundFasAnalysis();
    setInterval(runBackgroundFasAnalysis, 5 * 60 * 1000);
  }, 30000);

  // === PRE-GENERATE documentation files if missing ===
  // Runs immediately in the background so files are ready before first download request.
  (async () => {
    const { existsSync } = await import('fs');
    if (!existsSync(USER_MANUAL_PATH)) {
      try {
        await generateUserManual(USER_MANUAL_PATH);
        console.log('[startup] User Manual pre-generated successfully.');
      } catch (e: any) {
        console.warn('[startup] User Manual pre-generation failed:', e.message);
      }
    }
    if (!existsSync(STATUS_REPORT_PATH)) {
      try {
        await generateStatusReport(STATUS_REPORT_PATH);
        console.log('[startup] Status Report pre-generated successfully.');
      } catch (e: any) {
        console.warn('[startup] Status Report pre-generation failed:', e.message);
      }
    }
    if (!existsSync(SIPPY_DATAFLOW_PATH)) {
      try {
        await generateSippyDataflowDoc(SIPPY_DATAFLOW_PATH);
        console.log('[startup] Sippy Dataflow Reference pre-generated successfully.');
      } catch (e: any) {
        console.warn('[startup] Sippy Dataflow Reference pre-generation failed:', e.message);
      }
    }
  })();

  // ── Helper: silently regenerate the Sippy Dataflow doc in the background ────
  function regenDataflowDoc() {
    generateSippyDataflowDoc(SIPPY_DATAFLOW_PATH).catch(e =>
      console.warn('[dataflow-doc] background regen failed:', e.message)
    );
  }

  // === STARTUP GUARD: disable simulation if a real portal is configured ===
  // This corrects any mis-matched state (e.g. settings migrated from a demo DB).
  // Also purges all active simulated calls so the dashboard starts clean.
  (async () => {
    try {
      const settings = await storage.getSettings();
      if (settings.simulationEnabled && settings.portalUrl) {
        console.log('[startup] Portal URL is configured — automatically disabling simulation mode.');
        await storage.updateSettings({ simulationEnabled: false });

        // Delete all active calls left over from simulation so they don't linger
        const calls = await storage.getCalls(500);
        const probeCaller = settings.monitoredIp ? normalizeMonitoredIp(settings.monitoredIp).host : '';
        for (const call of calls) {
          if (call.status === 'active' && call.caller !== probeCaller) {
            await storage.endCall(call.id, 'completed', 'simulation_disabled');
          }
        }
        console.log('[startup] Cleared active simulated calls.');
      }
    } catch (err) {
      console.error('[startup] Guard error:', err);
    }
  })();

  // === SIPPY AUTO-CONNECT ON STARTUP ===
  (async () => {
    try {
      const s = await storage.getSettings();
      // Always attempt — fall back to built-in defaults if settings not yet configured
      const url      = sippyPortalUrl(s);
      const { username, password } = sippyXmlCreds(s);
      // apiAdminUsername/apiAdminPassword = XML-RPC API credentials (Sippy API password, set in My Preferences)
      // adminWebPassword = separate web portal login password (may differ from XML-RPC API password)
      // portalUsername/portalPassword = customer portal account (e.g. RTST1) for CDR/portal scraping
      console.log('[startup] Sippy credentials found — attempting auto-connect...');
      const result = await smartSippyConnect(url, username, password, s?.portalUsername, s?.portalPassword, s?.adminWebPassword);
      if (result.success) {
        console.log('[startup] Sippy auto-connected:', result.message);
      } else {
        console.warn('[startup] Sippy auto-connect failed:', result.message);
      }
    } catch (err) {
      console.error('[startup] Sippy auto-connect error:', err);
    }
  })();


  // === SIMULATION ENGINE ===
  setInterval(async () => {
    const settings = await storage.getSettings();
    if (!settings.simulationEnabled) return;

    // Always use the normalised host (strip https://, port, path) so callers are plain IPs
    const monitoredIp = settings.monitoredIp
      ? normalizeMonitoredIp(settings.monitoredIp).host
      : null;

    // 1. Manage Active Calls (Create/End)
    const calls = await storage.getCalls(100);
    const activeCalls = calls.filter(c => c.status === 'active');

    // End random calls — ~15% fail with specific reasons matching CK Ratio definition
    for (const call of activeCalls) {
      if (Math.random() < CALL_DURATION_PROBABILITY) {
        const rand = Math.random();
        if (rand < 0.15) {
          // Fail with a reason: wrong_number (5%), switched_off (6%), untraceable (4%)
          const failRand = Math.random();
          const failReason = failRand < 0.33
            ? 'wrong_number'
            : failRand < 0.72
            ? 'switched_off'
            : 'untraceable';
          // Store fail reason directly in the call record
          await storage.endCall(call.id, 'failed', failReason);
        } else {
          await storage.endCall(call.id, 'completed');
        }
      }
    }

    // Start new calls if below max
    if (activeCalls.length < MAX_ACTIVE_CALLS) {
      const newCallsNeeded = MAX_ACTIVE_CALLS - activeCalls.length;
      if (newCallsNeeded > 0 && Math.random() > 0.3) {
        // ~30% of new calls originate from / go to the monitored IP (live source)
        const useMonitoredIp = monitoredIp && Math.random() < 0.3;
        const caller = useMonitoredIp
          ? monitoredIp
          : `+1${Math.floor(Math.random() * 9000000000) + 1000000000}`;
        const callee = useMonitoredIp && Math.random() > 0.5
          ? monitoredIp
          : `+1${Math.floor(Math.random() * 9000000000) + 1000000000}`;
        // PDD: Post-Dial Delay — typically 0.3–3.0 seconds, spikes occasionally
        const pdd = Math.round((0.3 + Math.random() * 2.0) * 100) / 100;
        await storage.createCall({
          caller,
          callee,
          direction: Math.random() > 0.5 ? 'inbound' : 'outbound',
          status: 'active',
          pdd,
        });
      }
    }

    // 2. Generate Metrics for Active Calls
    const currentActiveCalls = (await storage.getCalls(100)).filter(c => c.status === 'active');
    
    for (const call of currentActiveCalls) {
      // For calls involving the monitored IP, use real probe latency as the base
      const isLiveSourceCall = monitoredIp && (call.caller === monitoredIp || call.callee === monitoredIp);
      const probeLatency = lastProbeResult?.latency ?? null;

      // Simulate Jitter (0-50ms usually, spikes occasionally)
      let jitter = Math.random() * 20; // Normal jitter
      if (Math.random() > 0.9) jitter += 50; // Spike

      // Simulate Latency — use real probe result for live-source calls if available
      let latency: number;
      if (isLiveSourceCall && probeLatency !== null) {
        // Add small variance (±10%) around the real measured latency
        latency = probeLatency * (0.9 + Math.random() * 0.2);
      } else {
        latency = 20 + Math.random() * 80;
        if (Math.random() > 0.95) latency += 200; // Spike
      }

      // Simulate Packet Loss (0-1% usually)
      let packetLoss = Math.random() * 0.5;
      if (Math.random() > 0.95) packetLoss += 5; // Spike

      // Calculate MOS (Mean Opinion Score)
      let rFactor = 94 - (latency / 20) - jitter - (packetLoss * 20);
      if (rFactor < 0) rFactor = 0;
      let mos = 1 + (0.035 * rFactor) + (rFactor * (rFactor - 60) * (100 - rFactor) * 0.000007);
      if (mos > 4.5) mos = 4.5;
      if (mos < 1) mos = 1;
      
      // Add metric
      await storage.createMetric({
        callId: call.id,
        jitter,
        latency,
        packetLoss,
        mos
      });

      // Check Thresholds & Alert
      if (jitter > (settings.jitterThreshold || 30)) {
        await storage.createAlert({
          type: 'high_jitter',
          severity: 'warning',
          message: `High Jitter (${jitter.toFixed(1)}ms) detected on call ${call.id} (${call.caller})`,
          resolved: false
        });
      }
      if (packetLoss > (settings.packetLossThreshold || 1.0)) {
        await storage.createAlert({
          type: 'packet_loss',
          severity: 'critical',
          message: `Packet Loss (${packetLoss.toFixed(1)}%) detected on call ${call.id}`,
          resolved: false
        });
      }
      // Alert if live-source latency is very high
      if (isLiveSourceCall && latency > (settings.latencyThreshold || 150)) {
        await storage.createAlert({
          type: 'high_latency',
          severity: 'warning',
          message: `High Latency (${latency.toFixed(0)}ms) from live source ${monitoredIp} on call ${call.id}`,
          resolved: false
        });
      }
    }
  }, SIMULATION_INTERVAL);


  // === API ROUTES ===

  // Dashboard Stats
  app.get(api.dashboard.stats.path, async (req, res) => {
    const stats = await storage.getDashboardStats();
    res.json(stats);
  });

  // Live IP Probe Status
  app.get('/api/probe/status', async (req, res) => {
    const settings = await storage.getSettings();
    const raw = settings.monitoredIp || null;
    const displayIp = raw ? normalizeMonitoredIp(raw).host : null;
    // Build multi-probe array for the dashboard
    const probes: Array<{ label: string; ip: string; latency: number; reachable: boolean; port?: number; timestamp: Date }> = [];
    if (displayIp && lastProbeResult) {
      probes.push({ label: 'Live Source', ip: displayIp, ...lastProbeResult });
    }
    if (lastSwitchProbeResult) {
      probes.push({ ...lastSwitchProbeResult, ip: lastSwitchProbeResult.host ?? '' });
    }
    res.json({
      // Legacy single-probe fields (backward compat)
      ip: displayIp,
      rawIp: raw,
      ...lastProbeResult,
      // Multi-probe array for the updated dashboard card
      probes,
    });
  });

  // Trigger an on-demand probe
  app.post('/api/probe/run', async (req, res) => {
    await runIpProbe();
    res.json({ ...lastProbeResult });
  });

  // Calls
  app.get(api.calls.list.path, async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    const calls = await storage.getCalls(limit);
    res.json(calls);
  });

  app.get(api.calls.get.path, async (req, res) => {
    const call = await storage.getCall(Number(req.params.id));
    if (!call) return res.status(404).json({ message: 'Call not found' });
    res.json(call);
  });

  app.get(api.calls.metrics.path, async (req, res) => {
    const metrics = await storage.getMetricsForCall(Number(req.params.id));
    res.json(metrics);
  });

  // Alerts
  app.get(api.alerts.list.path, async (req, res) => {
    const alerts = await storage.getAlerts();
    res.json(alerts);
  });

  // Sensitive fields that are stripped from settings responses for non-admin users
  const SETTINGS_SENSITIVE_FIELDS = [
    'portalPassword',
    'apiAdminPassword',
    'adminWebPassword',
    'alertGmailAppPass',
    'whatsappApiKey',
    'portalSessionToken',
  ] as const;

  // Settings — GET (authenticated; admins see all fields, others get passwords redacted)
  app.get(api.settings.get.path, async (req: any, res) => {
    const userId = req.user?.claims?.sub;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const settings = await storage.getSettings();
    const role = await storage.getUserRole(userId);
    if (role !== 'admin') {
      const redacted: any = { ...settings };
      for (const field of SETTINGS_SENSITIVE_FIELDS) redacted[field] = null;
      return res.json(redacted);
    }
    res.json(settings);
  });

  // Settings — PATCH (admin only)
  app.patch(api.settings.update.path, (req: any, res: any, next: any) => requireRole(['admin'], req, res, next), async (req, res) => {
    try {
      const input = api.settings.update.input.parse(req.body);
      const updated = await storage.updateSettings(input);
      res.json(updated);
      regenDataflowDoc();
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  // Settings — reset simulation (admin only)
  app.post(api.settings.resetSimulation.path, (req: any, res: any, next: any) => requireRole(['admin'], req, res, next), async (_req, res) => {
    res.json({ message: "Simulation reset acknowledged" });
  });

  // Management Feature Permissions — lightweight public-ish endpoint (any logged-in user)
  // Returns which features are enabled for the management role so ProtectedRoute can enforce them.
  app.get('/api/settings/mgmt-permissions', async (req: any, res) => {
    const userId = req.user?.claims?.sub;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const s = await storage.getSettings();
    let enabledFeatures: string[] = [];
    try { enabledFeatures = JSON.parse(s.mgmtFeaturePermissions ?? '[]'); } catch { enabledFeatures = []; }
    res.json({ enabledFeatures });
  });

  // ── Team Management API ───────────────────────────────────────────────────

  // Middleware: require a minimum role
  async function requireRole(roles: string[], req: any, res: any, next: any) {
    const userId = req.user?.claims?.sub;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const role = await storage.getUserRole(userId);
    if (!role || !roles.includes(role)) {
      return res.status(403).json({ message: 'Forbidden — insufficient permissions' });
    }
    next();
  }

  // GET /api/team — list all users + their roles (admin only)
  app.get('/api/team', (req: any, res, next) => requireRole(['admin'], req, res, next), async (req: any, res) => {
    try {
      const members = await storage.getAllUsersWithRoles();
      res.json(members);
    } catch (err) {
      res.status(500).json({ message: 'Failed to fetch team members' });
    }
  });

  // PATCH /api/team/:userId/role — change a user's role (admin only)
  app.patch('/api/team/:userId/role', (req: any, res, next) => requireRole(['admin'], req, res, next), async (req: any, res) => {
    const { userId } = req.params;
    const { role } = req.body as { role: string };
    if (!['admin', 'management', 'viewer'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role. Must be admin, management, or viewer.' });
    }
    const requesterId = req.user.claims.sub;
    // Prevent admin from demoting themselves
    if (userId === requesterId && role !== 'admin') {
      return res.status(400).json({ message: 'You cannot change your own role.' });
    }
    try {
      await storage.setUserRole(userId, role as any, requesterId);
      res.json({ message: 'Role updated', userId, role });
    } catch (err) {
      res.status(500).json({ message: 'Failed to update role' });
    }
  });

  // GET /api/team/monitoring-assignments — all assignments (admin only)
  app.get('/api/team/monitoring-assignments', (req: any, res, next) => requireRole(['admin'], req, res, next), async (_req, res) => {
    try {
      const assignments = await storage.getAllMonitoringAssignments();
      res.json(assignments);
    } catch {
      res.status(500).json({ message: 'Failed to fetch monitoring assignments' });
    }
  });

  // PUT /api/team/:userId/monitoring-assignments — set assignments for one user (admin only)
  app.put('/api/team/:userId/monitoring-assignments', (req: any, res, next) => requireRole(['admin'], req, res, next), async (req: any, res) => {
    const { userId } = req.params;
    const { items } = req.body as { items: string[] };
    if (!Array.isArray(items)) return res.status(400).json({ message: 'items must be an array' });
    try {
      await storage.setMonitoringAssignments(userId, items, req.user.claims.sub);
      res.json({ ok: true, userId, items });
    } catch {
      res.status(500).json({ message: 'Failed to save monitoring assignments' });
    }
  });

  // ── User Configuration API ────────────────────────────────────────────────

  // GET /api/user/monitoring-assignments — returns current user's own assigned monitoring items
  app.get('/api/user/monitoring-assignments', async (req: any, res) => {
    const userId = req.user?.claims?.sub;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    try {
      const allAssignments = await storage.getAllMonitoringAssignments();
      const items = allAssignments[userId] ?? [];
      res.json({ userId, items });
    } catch {
      res.status(500).json({ message: 'Failed to fetch monitoring assignments' });
    }
  });

  // GET /api/user/assigned-accounts — returns Sippy account IDs assigned to this viewer via KAM email match
  app.get('/api/user/assigned-accounts', async (req: any, res) => {
    const userId = req.user?.claims?.sub;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    try {
      const allUsers = await storage.getAllUsersWithRoles();
      const currentUser = allUsers.find((u: any) => u.id === userId);
      const userEmail = currentUser?.email;
      if (!userEmail) return res.json({ kamId: null, kamName: null, accountIds: [], clientNames: [] });
      const allKams = await storage.getKams();
      const matchedKam = allKams.find((k: any) => k.email?.toLowerCase() === userEmail.toLowerCase());
      if (!matchedKam) return res.json({ kamId: null, kamName: null, accountIds: [], clientNames: [] });
      const kamAccts = await storage.getKamAccounts(matchedKam.id);
      const accountIds = kamAccts.map((a: any) => String(a.accountId));
      const clientNames = kamAccts.map((a: any) => a.clientName).filter(Boolean);
      res.json({ kamId: matchedKam.id, kamName: matchedKam.name, accountIds, clientNames });
    } catch {
      res.status(500).json({ message: 'Failed to fetch assigned accounts' });
    }
  });

  // GET /api/user/config — returns the logged-in user's personal config
  app.get('/api/user/config', async (req: any, res) => {
    const userId = req.user?.claims?.sub;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    try {
      const config = await storage.getUserConfig(userId);
      res.json(config ?? {});
    } catch { res.status(500).json({ message: 'Failed to fetch config' }); }
  });

  // PATCH /api/user/config — saves the logged-in user's personal config
  app.patch('/api/user/config', async (req: any, res) => {
    const userId = req.user?.claims?.sub;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    try {
      const saved = await storage.upsertUserConfig(userId, req.body);
      res.json(saved);
    } catch { res.status(500).json({ message: 'Failed to save config' }); }
  });

  // ── Client & Vendor Profiles API ─────────────────────────────────────────

  app.get('/api/clients', async (req, res) => {
    try { res.json(await storage.getClientProfiles()); }
    catch { res.status(500).json({ message: 'Failed to fetch profiles' }); }
  });

  app.post('/api/clients', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req, res) => {
    try {
      const profile = req.body;
      const created = await storage.createClientProfile(profile);
      res.status(201).json(created);
    } catch { res.status(500).json({ message: 'Failed to create profile' }); }
  });

  app.patch('/api/clients/:id', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const updated = await storage.updateClientProfile(id, req.body);
      res.json(updated);
    } catch { res.status(500).json({ message: 'Failed to update profile' }); }
  });

  app.delete('/api/clients/:id', (req: any, res, next) => requireRole(['admin'], req, res, next), async (req, res) => {
    try {
      await storage.deleteClientProfile(Number(req.params.id));
      res.json({ message: 'Deleted' });
    } catch { res.status(500).json({ message: 'Failed to delete profile' }); }
  });

  // ── Switches CRUD ──────────────────────────────────────────────────────────

  app.get('/api/switches', async (_req, res) => {
    try {
      const switches = await storage.getSwitches();
      // Mask passwords — never expose credentials in API responses
      const masked = switches.map(sw => ({
        ...sw,
        portalPassword:    sw.portalPassword    ? '••••••••' : null,
        apiAdminPassword:  sw.apiAdminPassword  ? '••••••••' : null,
      }));
      res.json(masked);
    }
    catch { res.status(500).json({ message: 'Failed to fetch switches' }); }
  });

  app.post('/api/switches', (req: any, res, next) => requireRole(['admin'], req, res, next), async (req, res) => {
    try {
      const sw = await storage.createSwitch(req.body);
      res.status(201).json({ ...sw, portalPassword: sw.portalPassword ? '••••••••' : null, apiAdminPassword: sw.apiAdminPassword ? '••••••••' : null });
    } catch { res.status(500).json({ message: 'Failed to create switch' }); }
  });

  app.patch('/api/switches/:id', (req: any, res, next) => requireRole(['admin'], req, res, next), async (req, res) => {
    try {
      const body = { ...req.body };
      // Strip masked placeholder values so real passwords are never overwritten
      if (body.portalPassword   === '••••••••') delete body.portalPassword;
      if (body.apiAdminPassword === '••••••••') delete body.apiAdminPassword;
      const sw = await storage.updateSwitch(Number(req.params.id), body);
      res.json({ ...sw, portalPassword: sw.portalPassword ? '••••••••' : null, apiAdminPassword: sw.apiAdminPassword ? '••••••••' : null });
    } catch { res.status(500).json({ message: 'Failed to update switch' }); }
  });

  app.delete('/api/switches/:id', (req: any, res, next) => requireRole(['admin'], req, res, next), async (req, res) => {
    try {
      await storage.deleteSwitch(Number(req.params.id));
      res.json({ message: 'Switch deleted' });
    } catch { res.status(500).json({ message: 'Failed to delete switch' }); }
  });

  // POST /api/switches/:id/promote — promote a secondary switch to primary.
  // Saves the old primary as a new secondary switch, then deletes the promoted one.
  app.post('/api/switches/:id/promote', (req: any, res: any, next: any) => requireRole(['admin'], req, res, next), async (req: any, res: any) => {
    try {
      const id = Number(req.params.id);
      const allSwitches = await storage.getSwitches();
      const target = allSwitches.find(s => s.id === id);
      if (!target) return res.status(404).json({ message: 'Switch not found.' });

      const primarySettings = await storage.getSettings();

      // Save old primary as a new secondary switch (only if it had a URL configured)
      const oldPrimaryUrl = primarySettings.portalUrl;
      if (oldPrimaryUrl) {
        await storage.createSwitch({
          name: 'Former Primary Switch',
          type: 'sippy',
          portalUrl: oldPrimaryUrl,
          portalUsername: primarySettings.portalUsername || null,
          portalPassword: primarySettings.portalPassword || null,
          apiAdminUsername: primarySettings.apiAdminUsername || null,
          apiAdminPassword: primarySettings.apiAdminPassword || null,
          enabled: true,
        });
      }

      // Update primary settings with the promoted switch's credentials
      await storage.updateSettings({
        portalUrl: target.portalUrl || undefined,
        portalUsername: target.portalUsername || undefined,
        portalPassword: target.portalPassword || undefined,
        // Use API admin creds from the switch if provided, otherwise clear them
        apiAdminUsername: target.apiAdminUsername || undefined,
        apiAdminPassword: target.apiAdminPassword || undefined,
      });

      // Remove the promoted switch from secondary list
      await storage.deleteSwitch(id);

      res.json({ success: true, message: `"${target.name}" is now the primary switch. Old primary saved as secondary.` });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // GET /api/switches/consolidated — poll all switches in parallel and return aggregated stats
  app.get('/api/switches/consolidated', async (_req, res) => {
    try {
      const [primarySettings, secondarySwitches] = await Promise.all([
        storage.getSettings(),
        storage.getSwitches(),
      ]);

      type SwitchResult = {
        id: string;
        name: string;
        portalUrl: string;
        isPrimary: boolean;
        enabled: boolean;
        status: 'online' | 'offline' | 'error' | 'unconfigured';
        activeCalls: number;
        totalCalls: number;
        answeredCalls: number;
        asr: number;
        acd: number;
        totalMinutes: number;
        error?: string;
        polledAt: string;
      };

      async function pollSwitch(
        id: string,
        name: string,
        portalUrl: string | null | undefined,
        username: string | null | undefined,
        password: string | null | undefined,
        isPrimary: boolean,
        enabled: boolean,
        adminUsername?: string | null,   // optional admin creds for listActiveCalls
        adminPassword?: string | null,
      ): Promise<SwitchResult> {
        const base: SwitchResult = {
          id, name, portalUrl: portalUrl || '', isPrimary, enabled,
          status: 'unconfigured', activeCalls: 0, totalCalls: 0,
          answeredCalls: 0, asr: 0, acd: 0, totalMinutes: 0,
          polledAt: new Date().toISOString(),
        };
        if (!portalUrl || !username || !password) return base;
        if (!enabled) return { ...base, status: 'offline' };
        try {
          // For listActiveCalls prefer admin creds (full visibility); fall back to portal creds.
          // For getCountersStats any valid cred pair works (read-only counters).
          const liveUser = (adminUsername || username)!;
          const livePass = (adminPassword || password)!;

          // Run both in parallel:
          // - getSippyActiveCalls  → real concurrent live call count via listActiveCalls XML-RPC
          // - getSippyDashboardMetrics → period counters for ASR, ACD, total, answered
          // Both use admin creds (liveUser/livePass) so secondary switches with a separate
          // apiAdminPassword use the correct XML-RPC API password (not the web portal password).
          const [liveCalls, metrics] = await Promise.all([
            sippy.getSippyActiveCalls(liveUser, livePass, portalUrl, undefined, username, password),
            sippy.getSippyDashboardMetrics(liveUser, livePass, portalUrl),
          ]);
          console.log(`[multi-switch] ${name}: listActiveCalls=${liveCalls.length} ASR=${metrics.asr}% ACD=${metrics.acd}s total=${metrics.totalCalls}`);
          return {
            ...base,
            status: 'online',
            activeCalls: liveCalls.length,   // real concurrent count from listActiveCalls
            totalCalls: metrics.totalCalls,
            answeredCalls: metrics.answeredCalls,
            asr: metrics.asr,
            acd: metrics.acd,
            totalMinutes: metrics.totalMinutes,
          };
        } catch (err: any) {
          return { ...base, status: 'error', error: err.message };
        }
      }

      const primaryTask = pollSwitch(
        'primary',
        primarySettings.name || 'Primary Switch',
        primarySettings.portalUrl,
        primarySettings.apiAdminUsername || primarySettings.portalUsername,
        primarySettings.apiAdminPassword || primarySettings.portalPassword,
        true,
        true,
      );

      const secondaryTasks = secondarySwitches
        .filter(s => s.type === 'sippy')
        .map(s => pollSwitch(
          String(s.id),
          s.name,
          s.portalUrl,
          s.portalUsername,
          s.portalPassword,
          false,
          s.enabled ?? true,
          s.apiAdminUsername,   // pass admin creds if stored — used for listActiveCalls
          s.apiAdminPassword,
        ));

      const results = await Promise.all([primaryTask, ...secondaryTasks]);

      // Write lastSyncAt + lastSyncStatus back to each secondary switch record
      const secondaryResults = results.filter(r => !r.isPrimary);
      await Promise.all(
        secondaryResults.map(r => {
          const dbSwitch = secondarySwitches.find(s => String(s.id) === r.id);
          if (!dbSwitch) return Promise.resolve();
          return storage.updateSwitch(dbSwitch.id, {
            lastSyncAt: new Date() as any,
            lastSyncStatus: r.status === 'online'
              ? `online · ${r.activeCalls} active calls · ASR ${r.asr}%`
              : r.status === 'error'
              ? `error: ${r.error ?? 'unknown'}`
              : r.status === 'offline' ? 'offline (disabled)' : 'unconfigured',
          });
        })
      );

      const online = results.filter(r => r.status === 'online');
      const aggregate = {
        totalActiveCalls: results.reduce((s, r) => s + r.activeCalls, 0),
        onlineSwitches: online.length,
        totalSwitches: results.length,
        overallAsr: online.length > 0
          ? Math.round(online.reduce((s, r) => s + r.asr, 0) / online.length)
          : 0,
        avgAcd: online.length > 0
          ? Math.round(online.reduce((s, r) => s + r.acd, 0) / online.length)
          : 0,
        totalMinutes: results.reduce((s, r) => s + r.totalMinutes, 0),
      };

      res.json({ switches: results, aggregate });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/switches/:id/test — test connectivity of a specific switch
  app.post('/api/switches/:id/test', async (req, res) => {
    try {
      const allSwitches = await storage.getSwitches();
      const sw = allSwitches.find(s => s.id === Number(req.params.id));
      if (!sw) return res.status(404).json({ success: false, message: 'Switch not found' });
      if (!sw.portalUrl || !sw.portalUsername || (!sw.portalPassword && !sw.apiAdminPassword))
        return res.json({ success: false, message: 'Incomplete credentials — fill in URL, username, and password.' });

      // Prefer the API admin password for the XML-RPC test (it is the actual API credential).
      // Some switches store a separate web-portal password in portalPassword and the API password
      // in apiAdminPassword.  Try both in sequence.
      const testPass = (sw.apiAdminPassword || sw.portalPassword)!;
      const result = await sippy.connectSippy(sw.portalUrl, sw.portalUsername, testPass);
      // Write lastSyncAt + lastSyncStatus back so "Last Sync" column updates in the UI
      await storage.updateSwitch(sw.id, {
        lastSyncAt: new Date() as any,
        lastSyncStatus: result.success ? 'test OK — connection verified' : `test failed: ${result.message}`,
      });
      res.json(result);
    } catch (err: any) {
      res.json({ success: false, message: err.message });
    }
  });

  // Get session status for a specific switch
  app.get('/api/switches/:id/session', async (req, res) => {
    try {
      const allSwitches = await storage.getSwitches();
      const sw = allSwitches.find(s => s.id === Number(req.params.id));
      if (!sw) return res.status(404).json({ active: false });
      res.json({ active: true, note: 'Sippy uses Basic Auth — no login required' });
    } catch { res.status(500).json({ active: false }); }
  });

  // ── Per-switch live monitoring ──────────────────────────────────────────────

  // GET /api/switches/:id/live-calls — get live active calls from any switch
  app.get('/api/switches/:id/live-calls', async (req, res) => {
    try {
      const allSwitches = await storage.getSwitches();
      const sw = allSwitches.find(s => s.id === Number(req.params.id));
      if (!sw) return res.status(404).json({ calls: [], error: 'Switch not found' });
      if (!sw.portalUrl) return res.json({ calls: [], error: 'No portal URL configured for this switch.' });

      if (sw.type === 'sippy') {
        if (!sw.portalUsername || !sw.portalPassword) return res.json({ calls: [], error: 'Sippy credentials not configured.' });
        const raw = await sippy.getSippyActiveCalls(sw.portalUsername, sw.portalPassword, sw.portalUrl);
        const calls = raw.map(c => ({
          id: c.callId,
          caller: c.caller,
          callee: c.callee,
          gateway: '',
          duration: c.duration,
          callStatus: (c.status === 'connected' || c.duration > 0) ? 'connected' : 'routing',
          clientName: c.user || accountNameCache.get(c.accountId ?? '') || c.accountId || undefined,
          accountId: c.accountId || undefined,
          vendor: c.vendor || (c.connection ? connectionVendorCache.get(c.connection) : undefined),
          connection: c.connection,
          direction: c.direction,
          mediaIpCaller: c.mediaIpCaller,
          mediaIpCallee: c.mediaIpCallee,
          delay: c.delay,
          codec: c.codec,
          state: c.status,
        }));
        return res.json({ calls, switchType: 'sippy', switchName: sw.name });
      }

      return res.json({ calls: [], error: 'Unsupported switch type.' });
    } catch (err: any) {
      res.status(500).json({ calls: [], error: err.message });
    }
  });

  // GET /api/switches/:id/stats — get stats from any switch
  app.get('/api/switches/:id/stats', async (req, res) => {
    try {
      const allSwitches = await storage.getSwitches();
      const sw = allSwitches.find(s => s.id === Number(req.params.id));
      if (!sw || !sw.portalUrl) return res.status(404).json({ error: 'Switch not found or no URL' });

      if (sw.type === 'sippy') {
        if (!sw.portalUsername || !sw.portalPassword) return res.json({ error: 'Sippy credentials missing.' });
        const stats = await sippy.getSippyStats(sw.portalUsername, sw.portalPassword, sw.portalUrl);
        return res.json(stats);
      }

      return res.json({ error: 'Unsupported switch type.' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });


  // ── Shared helper: push profile + rate to a single switch ──────────────────

  interface PushRateOptions {
    accountName: string;
    prefix: string;
    ratePerMin: number;
    effectiveFrom?: Date;
    effectiveTo?: Date;
    format?: 'full' | 'partial' | 'default';
  }

  async function pushProfileToOneSwitch(
    profile: Awaited<ReturnType<typeof storage.getClientProfiles>>[number],
    sw: { id: number; type: string; portalUrl: string | null; portalUsername: string | null; portalPassword: string | null },
    pushOpts?: PushRateOptions,
  ): Promise<{ success: boolean; message: string; detail?: string }> {
    if (!sw.portalUrl) return { success: false, message: `Switch "${sw.type}" has no URL configured.` };

    if (sw.type === 'sippy') {
      // Prefer global admin API credentials for XML-RPC; fall back to switch portal creds
      const globalSettings = await storage.getSettings();
      const adminUser = globalSettings.apiAdminUsername || sw.portalUsername || '';
      const adminPass = globalSettings.apiAdminPassword || sw.portalPassword || '';
      const creds = { username: adminUser, password: adminPass };
      const acctRes = await sippy.pushAccountToSippy({
        name: profile.name,
        type: profile.type as 'client' | 'vendor',
        ipAddress: profile.ipAddress || undefined,
        ratePerMin: profile.ratePerMin || undefined,
        timezone: (profile as any).timezone || undefined,
        language: (profile as any).language || undefined,
        sipClass: (profile as any).sipClass || undefined,
        routingGroup: (profile as any).routingGroup || undefined,
        servicePlan: (profile as any).servicePlan || undefined,
        creditLimit: (profile as any).creditLimit ?? undefined,
        maxSessions: (profile as any).maxSessions ?? undefined,
        maxCallsPerSecond: (profile as any).maxCallsPerSecond ?? undefined,
        maxSessionTime: (profile as any).maxSessionTime ?? undefined,
        preferredCodec: (profile as any).preferredCodec || undefined,
        cldTranslationRule: (profile as any).cldTranslationRule || undefined,
        cliTranslationRule: (profile as any).cliTranslationRule || undefined,
        companyName: (profile as any).companyName || undefined,
      }, creds, sw.portalUrl);

      if (pushOpts || (profile.prefix && profile.ratePerMin)) {
        const rOpts = pushOpts ?? {
          accountName: profile.name,
          prefix: profile.prefix!,
          ratePerMin: profile.ratePerMin!,
          effectiveFrom: profile.rateEffectiveFrom ? new Date(profile.rateEffectiveFrom) : undefined,
          effectiveTo:   profile.rateEffectiveTo   ? new Date(profile.rateEffectiveTo)   : undefined,
        };
        const rateRes = await sippy.pushRateToSippy(rOpts, creds, sw.portalUrl);
        return rateRes.success ? rateRes : rateRes;
      }
      return acctRes;
    }

    return { success: false, message: `Unknown switch type: ${sw.type}` };
  }

  // Resolve which switches to target: if switchIds provided use those, otherwise
  // try primary settings switch first, then fall back to ALL enabled secondary switches.
  async function resolveSwitches(switchIds?: number[]): Promise<Array<{ id: number; name: string; type: string; portalUrl: string | null; portalUsername: string | null; portalPassword: string | null }>> {
    if (switchIds && switchIds.length > 0) {
      const allSwitches = await storage.getSwitches();
      return allSwitches.filter(s => switchIds.includes(s.id) && s.enabled);
    }
    const targets: Array<{ id: number; name: string; type: string; portalUrl: string | null; portalUsername: string | null; portalPassword: string | null }> = [];
    // Primary switch from Settings (if configured)
    const settings = await storage.getSettings();
    if (settings.switchType && settings.switchType !== 'none' && settings.portalUrl) {
      targets.push({ id: 0, name: 'Primary Switch', type: settings.switchType, portalUrl: settings.portalUrl, portalUsername: settings.portalUsername || null, portalPassword: settings.portalPassword || null });
    }
    // All enabled secondary switches (added via Settings → Switches panel)
    const secondary = await storage.getSwitches();
    for (const sw of secondary) {
      if (sw.enabled && sw.portalUrl) targets.push(sw);
    }
    return targets;
  }

  // ── Sync a client/vendor profile + rate to one or more switches ────────────

  app.post('/api/clients/:id/sync', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const profile = (await storage.getClientProfiles()).find(p => p.id === id);
      if (!profile) return res.status(404).json({ message: 'Profile not found' });

      const switchIds: number[] | undefined = req.body?.switchIds;
      const targetSwitches = await resolveSwitches(switchIds);

      if (targetSwitches.length === 0) {
        return res.json({ success: false, message: 'No switches configured. Add a switch in Settings first.' });
      }

      const results: Record<string, { success: boolean; message: string }> = {};
      for (const sw of targetSwitches) {
        const key = sw.id === 0 ? sw.type : `${sw.type}-${sw.id}`;
        results[key] = await pushProfileToOneSwitch(profile, sw);
        // Update switch last sync status
        if (sw.id !== 0) {
          await storage.updateSwitch(sw.id, {
            lastSyncAt: new Date() as any,
            lastSyncStatus: results[key].success ? 'synced' : results[key].message,
          });
        }
      }

      const statusMap: Record<string, string> = { syncedAt: new Date().toISOString() };
      for (const [key, r] of Object.entries(results)) statusMap[key] = r.success ? 'synced' : `failed: ${r.message}`;
      await storage.updateClientProfile(id, { switchSyncStatus: statusMap as any });

      const allOk = Object.values(results).every(r => r.success);
      res.json({ success: allOk, results, switchSyncStatus: statusMap });
    } catch (err: any) {
      console.error('[sync]', err);
      res.status(500).json({ message: `Sync error: ${err.message}` });
    }
  });

  // ── Push a rate for a specific profile/destination to one or more switches ──

  app.post('/api/portal/push-rate', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req, res) => {
    try {
      const {
        profileId, accountName, prefix, ratePerMin,
        effectiveFrom, effectiveTo, format, switchIds,
      } = req.body as {
        profileId?: number;
        accountName: string;
        prefix: string;
        ratePerMin: number;
        effectiveFrom?: string;
        effectiveTo?: string;
        format?: 'full' | 'partial' | 'default';
        switchIds?: number[];
      };

      if (!accountName || !prefix || ratePerMin === undefined) {
        return res.status(400).json({ success: false, message: 'accountName, prefix, and ratePerMin are required.' });
      }

      const pushOpts: PushRateOptions = {
        accountName,
        prefix,
        ratePerMin: Number(ratePerMin),
        effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : undefined,
        effectiveTo:   effectiveTo   ? new Date(effectiveTo)   : undefined,
        format,
      };

      const targetSwitches = await resolveSwitches(switchIds);
      if (targetSwitches.length === 0) {
        return res.json({ success: false, message: 'No switches configured or selected. Add a switch in Settings first.' });
      }

      const results: Record<string, { success: boolean; message: string }> = {};
      const allProfiles = profileId ? await storage.getClientProfiles() : [];
      const profile = allProfiles.find(p => p.id === profileId);

      for (const sw of targetSwitches) {
        const key = sw.id === 0 ? sw.type : `${sw.name} (${sw.type})`;
        if (!sw.portalUrl) { results[key] = { success: false, message: 'No URL configured' }; continue; }

        if (sw.type === 'sippy') {
          // Prefer global admin API credentials for XML-RPC; fall back to switch portal creds
          const globalSettings = await storage.getSettings();
          const adminUser = globalSettings.apiAdminUsername || sw.portalUsername || '';
          const adminPass = globalSettings.apiAdminPassword || sw.portalPassword || '';
          const creds = { username: adminUser, password: adminPass };
          results[key] = await sippy.pushRateToSippy(pushOpts, creds, sw.portalUrl);
        } else {
          results[key] = { success: false, message: `Unknown type: ${sw.type}` };
        }

        // Update switch last sync
        if (sw.id !== 0) {
          await storage.updateSwitch(sw.id, {
            lastSyncAt: new Date() as any,
            lastSyncStatus: results[key].success ? 'rate pushed' : results[key].message,
          });
        }
      }

      // Persist sync status on profile if given
      if (profileId) {
        const statusMap: Record<string, string> = { syncedAt: new Date().toISOString() };
        for (const [key, r] of Object.entries(results)) statusMap[key] = r.success ? 'synced' : `failed: ${r.message}`;
        await storage.updateClientProfile(profileId, { switchSyncStatus: statusMap as any });
      }

      const allOk = Object.values(results).every(r => r.success);
      res.json({ success: allOk, results, switchCount: targetSwitches.length });
    } catch (err: any) {
      console.error('[push-rate]', err);
      res.status(500).json({ success: false, message: `Push error: ${err.message}` });
    }
  });


  // ── Sippy Softswitch Routes ──────────────────────────────────────────────

  // POST /api/sippy/test — test connection
  // Body: { url, username, password, apiAdminUsername?, apiAdminPassword? }
  // Priority: admin creds from body → admin creds from DB → portal creds from body → portal creds from DB
  app.post('/api/sippy/test', async (req, res) => {
    const { url, username, password, apiAdminUsername: bodyAdminUser, apiAdminPassword: bodyAdminPass }
      = req.body as { url?: string; username?: string; password?: string; apiAdminUsername?: string; apiAdminPassword?: string };
    if (!url) return res.status(400).json({ reachable: false, message: 'No URL provided.' });
    const s = await storage.getSettings();

    // 1. Admin credentials from request body (even if not yet saved — lets user test before saving)
    if (bodyAdminUser && bodyAdminPass) {
      const r = await sippy.testSippyConnection(url, bodyAdminUser, bodyAdminPass);
      if (r.authenticated) return res.json(r);
    }

    // 2. Admin credentials from DB
    const dbAdminUser = s.apiAdminUsername;
    const dbAdminPass = s.apiAdminPassword;
    if (dbAdminUser && dbAdminPass && (dbAdminUser !== bodyAdminUser || dbAdminPass !== bodyAdminPass)) {
      const r = await sippy.testSippyConnection(url, dbAdminUser, dbAdminPass);
      if (r.authenticated) return res.json(r);
    }

    // 3. Portal credentials from request body
    if (username) {
      const r = await sippy.testSippyConnection(url, username, password ?? '');
      if (r.authenticated) return res.json(r);
    }

    // 4. Portal credentials from DB
    if (s.portalUsername && s.portalPassword) {
      const r = await sippy.testSippyConnection(url, s.portalUsername, s.portalPassword);
      return res.json(r);
    }

    res.json({ reachable: true, authenticated: false, message: 'Server is reachable but all credential attempts failed. Check your username and password.' });
  });

  // POST /api/sippy/connect — authenticate and store session
  app.post('/api/sippy/connect', async (req, res) => {
    const settings = await storage.getSettings();
    const { portalUsername, portalPassword } = settings;
    const { username: adminUser, password: adminPass } = sippyXmlCreds(settings);
    const portalUrl = sippyPortalUrl(settings);
    const result = await smartSippyConnect(portalUrl, adminUser, adminPass, portalUsername, portalPassword);
    if (result.success) return res.json(result);
    return res.status(400).json(result);
  });

  // GET /api/sippy/session — current Sippy session status
  app.get('/api/sippy/session', (_req, res) => {
    res.json(sippy.getSippySessionStatus());
  });

  // GET /api/sippy/methods — list all XML-RPC methods available on this switch (diagnostic)
  app.get('/api/sippy/methods', async (req: any, res: any) => {
    try {
      if (!req.user) return res.status(401).json({ message: 'Unauthorized' });
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const portalUrl = sippyPortalUrl(settings);
      const result = await sippy.listAvailableMethods(username, password, portalUrl);
      const callMethods = result.methods.filter(m =>
        m.toLowerCase().includes('call') || m.toLowerCase().includes('originate') || m.toLowerCase().includes('callback')
      );
      res.json({ ...result, callMethods });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // DELETE /api/sippy/session — disconnect Sippy session
  app.delete('/api/sippy/session', (_req, res) => {
    sippy.clearSippySession();
    res.json({ success: true, message: 'Disconnected from Sippy.' });
  });

  // POST /api/switch/activate — change the active switch type and auto-connect
  app.post('/api/switch/activate', async (req, res) => {
    const { type } = req.body as { type: string };
    if (type !== 'sippy') {
      return res.status(400).json({ error: 'Invalid switch type. Must be "sippy".' });
    }
    const s = await storage.getSettings();
    await storage.updateSettings({ switchType: 'sippy' });

    if (!s.portalUrl || !s.portalUsername || !s.portalPassword) {
      return res.json({ success: false, message: 'Sippy credentials not configured. Go to Settings → Switch Configuration.' });
    }
    try {
      const result = await sippy.connectSippy(s.portalUrl, s.portalUsername, s.portalPassword);
      return res.json({ success: result.success, message: result.message });
    } catch (err: any) {
      return res.json({ success: false, message: `Sippy connect error: ${err.message}` });
    }
  });

  // GET /api/sippy/live-calls — active calls from Sippy
  // Always passes portalUrl explicitly so it works even if activeSession is null
  app.get('/api/sippy/live-calls', async (_req, res) => {
    try {
      const settings = await storage.getSettings();
      const portalUrl = sippyPortalUrl(settings);

      // Use XML-RPC capable credential (apiAdminUsername = RTST1) as primary.
      // Pass portalUsername/portalPassword as fallback for portal-scrape when XML-RPC returns 0.
      const { username, password } = sippyXmlCreds(settings);
      const fallbackUser = settings?.portalUsername ?? '';
      const fallbackPass = settings?.portalPassword ?? '';
      const raw = await sippy.getSippyActiveCalls(username, password, portalUrl, undefined, fallbackUser, fallbackPass);
      // Map CC_STATE → callStatus; filter out terminated states
      const ccStateMap: Record<string, 'connected' | 'routing'> = {
        Connected:    'connected',
        ARComplete:   'routing',
        WaitRoute:    'routing',
        WaitAuth:     'routing',
        Idle:         'routing',
      };
      const TERMINATED = new Set(['Dead', 'Disconnecting', 'Disconnected', 'Released', 'Rejected']);
      const calls = raw
        .filter(c => !TERMINATED.has(c.status ?? ''))
        .map(c => {
          const dialMatch = lookupDialCode(c.callee ?? '');
          return {
            ...c,
            clientName:  c.user || accountNameCache.get(c.accountId ?? '') || c.accountId || undefined,
            vendor:      c.vendor || (c.connection ? connectionVendorCache.get(c.connection) : undefined),
            ccState:     c.status,
            callStatus:  ccStateMap[c.status ?? ''] ?? (c.status?.toLowerCase().includes('connect') ? 'connected' : 'routing'),
            destCountry:  dialMatch?.country  ?? null,
            destBreakout: dialMatch?.breakout ?? null,
            destFull:     dialMatch?.destination ?? null,
          };
        });
      // connected=true tells the frontend that Sippy is reachable regardless of call count
      res.json({ calls, connected: true });
    } catch (err: any) {
      res.json({ calls: [], connected: false, error: err.message });
    }
  });

  // GET /api/sippy/monitoring/acd-asr — ACD/ASR time-series
  // Tries Sippy monitoring API first; falls back to CDR-based computation if restricted.
  app.get('/api/sippy/monitoring/acd-asr', async (req, res) => {
    try {
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const credPairs = sippyXmlCredsPairs(settings);
      const hoursBack = Number(req.query.hours) || 24;
      const intervalSec = Number(req.query.interval) || 300;
      const iEnv = req.query.env ? Number(req.query.env) : undefined;
      const startDate = new Date(Date.now() - hoursBack * 3600 * 1000);

      // Sippy start_date format: 'HH:MM:SS.000 GMT Www Mmm DD YYYY'
      const pad = (n: number) => String(n).padStart(2, '0');
      const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const sippyDate = `${pad(startDate.getUTCHours())}:${pad(startDate.getUTCMinutes())}:${pad(startDate.getUTCSeconds())}.000 GMT `
        + `${days[startDate.getUTCDay()]} ${months[startDate.getUTCMonth()]} ${pad(startDate.getUTCDate())} ${startDate.getUTCFullYear()}`;

      // ── Attempt 1: Sippy monitoring API (acd_asr_total) ──────────────────
      let result = await sippy.getSippyMonitoringData(username, password, 'acd_asr_total', {
        startDate: sippyDate,
        interval: hoursBack * 3600,
      });
      let graphType = 'acd_asr_total';

      // ── Attempt 2: Sippy monitoring API (acd_asr per-env) ────────────────
      if (!result.ok || !result.points.length) {
        result = await sippy.getSippyMonitoringData(username, password, 'acd_asr', {
          startDate: sippyDate,
          interval: hoursBack * 3600,
          ...(iEnv ? { iEnvironment: iEnv } : {}),
        });
        graphType = 'acd_asr';
      }

      // ── Attempt 3: CDR-based fallback ─────────────────────────────────────
      // When getMonitoringGraphData is restricted, compute ASR/ACD per time-bucket from CDRs.
      if (!result.ok || !result.points.length) {
        const bucketMs = intervalSec * 1000;   // bucket width in ms
        const startMs  = startDate.getTime();
        const endMs    = Date.now();

        let cdrs: Awaited<ReturnType<typeof sippy.getSippyCDRs>> = [];
        for (const { username: u, password: p } of credPairs) {
          cdrs = await sippy.getSippyCDRs(u, p, 5000, {
            startDate: startDate.toISOString(),
            endDate:   new Date().toISOString(),
            type: 'all',
          });
          if (cdrs.length > 0) break;
        }

        // Group CDRs into buckets by startTime (ISO string already)
        type Bucket = { total: number; answered: number; billedSecs: number };
        const buckets = new Map<number, Bucket>();

        for (const cdr of cdrs) {
          const ts = cdr.startTime ? new Date(cdr.startTime).getTime() : NaN;
          if (isNaN(ts) || ts < startMs || ts > endMs) continue;
          const bucketKey = Math.floor((ts - startMs) / bucketMs) * bucketMs + startMs;
          if (!buckets.has(bucketKey)) buckets.set(bucketKey, { total: 0, answered: 0, billedSecs: 0 });
          const b = buckets.get(bucketKey)!;
          b.total++;
          const rawResult = parseInt(String(cdr.result ?? '').trim()) || 0;
          const isAnswered = rawResult === 0 || (cdr.duration != null && cdr.duration > 0);
          if (isAnswered) { b.answered++; b.billedSecs += cdr.duration ?? 0; }
        }

        const points = Array.from(buckets.entries())
          .sort(([a], [b]) => a - b)
          .map(([tsMs, b]) => ({
            ts:  Math.floor(tsMs / 1000),   // chart expects Unix seconds (multiplies by 1000 in UI)
            asr: b.total > 0 ? Math.round((b.answered / b.total) * 100 * 100) / 100 : 0,
            acd: b.answered > 0 ? Math.round((b.billedSecs / b.answered) * 10) / 10 : 0,
          }));

        return res.json({
          ok: true,
          points,
          graphType: 'cdr_computed',
          hours: hoursBack,
          intervalSec,
          source: 'CDR-based (getMonitoringGraphData unavailable)',
        });
      }

      res.json({ ...result, graphType, hours: hoursBack, intervalSec });
    } catch (err: any) {
      res.json({ ok: false, points: [], error: err.message });
    }
  });

  // GET /api/sippy/monitoring/graph — generic monitoring graph data (CSV)
  app.get('/api/sippy/monitoring/graph', async (req, res) => {
    try {
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const type = (req.query.type as string) || 'calls_in_progress_total';
      const hours = Number(req.query.hours) || 24;
      const startDate = new Date(Date.now() - hours * 3600 * 1000);
      const pad = (n: number) => String(n).padStart(2, '0');
      const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const sippyDate = `${pad(startDate.getUTCHours())}:${pad(startDate.getUTCMinutes())}:${pad(startDate.getUTCSeconds())}.000 GMT `
        + `${days[startDate.getUTCDay()]} ${months[startDate.getUTCMonth()]} ${pad(startDate.getUTCDate())} ${startDate.getUTCFullYear()}`;
      const result = await sippy.getSippyMonitoringData(username, password, type, {
        startDate: sippyDate,
        interval: hours * 3600,
      });
      res.json({ ...result, type, hours });
    } catch (err: any) {
      res.json({ ok: false, points: [], error: err.message });
    }
  });

  // GET /api/sippy/monitoring/graph-image — getMonitoringGraph() PNG image (docs 107509)
  // Returns base64-encoded PNG. Query: type, hours, width, height, timezone, iEnvironment.
  app.get('/api/sippy/monitoring/graph-image', async (req: any, res) => {
    try {
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ ok: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const type  = (req.query.type  as string) || 'calls_in_progress_total';
      const hours = Number(req.query.hours)      || 12;
      const startDate = new Date(Date.now() - hours * 3600 * 1000);
      const pad = (n: number) => String(n).padStart(2, '0');
      const days   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const sippyDate = `${pad(startDate.getUTCHours())}:${pad(startDate.getUTCMinutes())}:${pad(startDate.getUTCSeconds())}.000 GMT `
        + `${days[startDate.getUTCDay()]} ${months[startDate.getUTCMonth()]} ${pad(startDate.getUTCDate())} ${startDate.getUTCFullYear()}`;
      const result = await sippy.getMonitoringGraph(username, password, type, {
        startDate:    sippyDate,
        interval:     hours * 3600,
        width:        req.query.width        ? parseInt(req.query.width as string, 10)        : undefined,
        height:       req.query.height       ? parseInt(req.query.height as string, 10)       : undefined,
        timezone:     req.query.timezone     as string | undefined,
        iEnvironment: req.query.iEnvironment ? parseInt(req.query.iEnvironment as string, 10) : undefined,
        portalUrl:    sippyPortalUrl(settings),
      });
      if (!result.ok) return res.status(422).json(result);
      // Optionally stream as PNG directly when ?format=png is requested
      if (req.query.format === 'png' && result.graph) {
        res.set('Content-Type', 'image/png');
        return res.send(Buffer.from(result.graph, 'base64'));
      }
      res.json({ ok: true, graph: result.graph, type, hours });
    } catch (err: any) {
      res.json({ ok: false, error: err.message });
    }
  });

  // POST /api/sippy/calls/:id/disconnect — disconnect a single call by its ID field
  app.post('/api/sippy/calls/:id/disconnect', async (req: any, res) => {
    const settings = await storage.getSettings();
    const { username, password } = sippyXmlCreds(settings);
    const result = await sippy.disconnectSippyCall(req.params.id, username, password);
    res.json(result);
  });

  // POST /api/sippy/accounts/:iAccount/disconnect — disconnect all calls for an account
  app.post('/api/sippy/accounts/:iAccount/disconnect', async (req: any, res) => {
    const iAccount = parseInt(req.params.iAccount, 10);
    if (isNaN(iAccount)) return res.status(400).json({ success: false, message: 'Invalid i_account.' });
    const settings = await storage.getSettings();
    const { username, password } = sippyXmlCreds(settings);
    const result = await sippy.disconnectSippyAccount(iAccount, username, password);
    res.json(result);
  });

  // GET /api/sippy/available-methods — lists all XML-RPC methods registered on this Sippy
  app.get('/api/sippy/available-methods', async (req: any, res: any) => {
    try {
      if (!req.user) return res.status(401).json({ message: 'Unauthorized' });
      const settings = await storage.getSettings();
      if (!settings?.portalUrl) return res.json({ methods: [], error: 'Sippy not configured' });
      // Try each credential pair; return on first success
      const pairs = sippyXmlCredsPairs(settings);
      for (const { username, password } of pairs) {
        const result = await sippy.listAvailableMethods(username, password, settings.portalUrl);
        if (result.methods.length > 0) return res.json(result);
      }
      // All pairs failed — return last error
      const { username, password } = pairs[pairs.length - 1];
      const result = await sippy.listAvailableMethods(username, password, settings.portalUrl);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ methods: [], error: e.message });
    }
  });

  // POST /api/sippy/make-call — initiates a test call via Sippy XML-RPC / Simple API
  // Per article 106909 (XML-RPC API intro), 107448 (make2WayCallback), 107525 (Simple API):
  //   Phase 1 — call_control.makeCall (Trusted Mode, ADMIN creds): needs "Allow XML-RPC call origination".
  //   Phase 2 — make2WayCallback (Normal Mode, CUSTOMER creds): needs Callback service on the account.
  //   Phase 3 — /simpleapi/callback.php (HTTP Basic Auth): needs admin to add creds to .htpassword.
  // Body: { cli, cld, iAccount?, authname? }
  app.post('/api/sippy/make-call', (req: any, res: any, next: any) => requireRole(['admin', 'management'], req, res, next), async (req: any, res: any) => {
    try {
      const userId = req.user?.claims?.sub;
      const { cli, cld, iAccount, authname: bodyAuthname } = req.body;
      if (!cli || !cld) return res.status(400).json({ success: false, message: 'cli and cld are required.' });

      const settings = await storage.getSettings();
      const portalBase = sippyPortalUrl(settings);

      // Per article 106909:
      //   Phase 1 — makeCall (Trusted Mode): uses ADMIN credentials (ssp-root + API password).
      //             Requires "Allow XML-RPC call origination" on the admin account in Sippy.
      //   Phase 2 — make2WayCallback (Normal Mode): uses CUSTOMER credentials (portalUsername + portalPassword).
      //             Normal mode scopes the session to that customer account.
      //             Requires Callback service active for the customer account (authname).
      //   Phase 3 — Simple API (/simpleapi/callback.php): plain HTTP Basic Auth GET.
      //             Requires admin to add credentials to /simpleapi/.htpassword on the switch server.
      //             Falls back through both admin and customer credentials.

      // Admin credentials for Phase 1 (XML-RPC Trusted Mode)
      const adminPairs: Array<{ username: string; password: string }> = [];
      if (settings.apiAdminUsername && settings.apiAdminPassword)
        adminPairs.push({ username: settings.apiAdminUsername, password: settings.apiAdminPassword });

      // Customer credentials for Phase 2 (XML-RPC Normal Mode) — customer auth scopes to their account
      const customerPairs: Array<{ username: string; password: string }> = [];
      if (settings.portalUsername && settings.portalPassword)
        customerPairs.push({ username: settings.portalUsername, password: settings.portalPassword });

      // Fallback: if one set is missing, fill from credPairs so we always have at least something
      const allPairs = sippyXmlCredsPairs(settings);
      const phase1Pairs = adminPairs.length   ? adminPairs   : allPairs;
      const phase2Pairs = customerPairs.length ? customerPairs : allPairs;
      // Phase 3: try customer first (most likely .htpassword entry), then admin
      const phase3Pairs = [...customerPairs, ...adminPairs].length ? [...customerPairs, ...adminPairs] : allPairs;

      let result: { success: boolean; callId?: string; message: string; errorType?: string; apiUser?: string; method?: string } = {
        success: false,
        message: 'No Sippy credentials configured.',
        errorType: 'not_connected',
      };

      // ── Phase 1: direct call origination via XML-RPC makeCall ────────────────
      // Authenticated as ADMIN in Trusted Mode.
      // Requires: admin account has "Allow XML-RPC call origination" in Sippy Admin →
      //           System → Administrators → <user> → API Access.
      let allMethodsNotFound = true;
      for (const { username, password } of phase1Pairs) {
        let r: { success: boolean; callId?: string; message: string; errorType?: string; apiUser?: string };
        try {
          r = await sippy.makeCall(
            cli.trim(), cld.trim(),
            { iAccount: iAccount ? Number(iAccount) : undefined },
            username, password, portalBase,
          );
        } catch (err: any) {
          console.error(`[make-call] makeCall threw for user ${username}:`, err);
          r = { success: false, message: err?.message || String(err), errorType: 'call_error', apiUser: username };
        }
        if (r.success) {
          result = { ...r, method: 'direct' };
          allMethodsNotFound = false;
          break;
        }
        if (r.errorType === 'call_error') {
          result = { ...r, method: 'direct' };
          allMethodsNotFound = false;
          break;
        }
        result = { ...r, method: 'direct' };
      }

      // ── Phase 2: XML-RPC make2WayCallback (Normal Mode, customer credentials) ─
      // Authenticated as CUSTOMER (portalUsername/portalPassword).
      // Requires: customer account has Callback service active in Sippy Admin →
      //           Customers → <account> → Applications → Callback.
      // Article 107448: cld_first = first leg (your phone), cld_second = destination.
      //                 cli_first/cli_second = caller ID shown on each leg.
      if (!result.success && allMethodsNotFound) {
        let authname: string = bodyAuthname?.trim() || '';
        if (!authname && iAccount) authname = accountNameCache.get(String(iAccount)) || '';
        if (!authname) {
          const fe = [...accountNameCache.entries()][0];
          authname = fe?.[1] || '';
        }
        // Default authname to the portal/customer username when no explicit value available
        if (!authname && settings.portalUsername) authname = settings.portalUsername;

        if (!authname) {
          result = {
            success: false,
            message: 'No direct call origination method found on this switch, and no authname is available for 2-way callback. Select a billing account and try again.',
            errorType: 'no_authname',
          };
        } else {
          for (const { username, password } of phase2Pairs) {
            let r: { success: boolean; iCallbackRequest?: number; message: string };
            try {
              r = await sippy.make2WayCallback(username, password, {
                authname,
                cldFirst:  cli.trim(),
                cliFirst:  cli.trim(),
                cldSecond: cld.trim(),
                cliSecond: cli.trim(),
              }, portalBase);
            } catch (err: any) {
              console.error(`[make-call] make2WayCallback threw for user ${username}:`, err);
              r = { success: false, message: err?.message || String(err) };
            }
            result = {
              success:   r.success,
              callId:    r.iCallbackRequest != null ? String(r.iCallbackRequest) : undefined,
              message:   r.message,
              errorType: r.success ? undefined : 'call_error',
              apiUser:   username,
              method:    'callback',
            };
            if (r.success) break;
          }
        }
      }

      // ── Phase 3: Simple API fallback (/simpleapi/callback.php) ───────────────
      // HTTP Basic Auth GET — simplest integration per article 107525.
      // Requires: admin to run htpasswd on the switch server to add credentials,
      //           AND customer account (authname) must have Callback service active.
      if (!result.success) {
        const authname =
          bodyAuthname?.trim() ||
          (iAccount ? accountNameCache.get(String(iAccount)) : '') ||
          settings.portalUsername ||
          '';

        if (authname) {
          for (const { username, password } of phase3Pairs) {
            let r: { success: boolean; message: string };
            try {
              r = await sippy.simpleApiCallback(username, password, {
                authname,
                cldFirst:  cli.trim(),
                cliFirst:  cli.trim(),
                cldSecond: cld.trim(),
                cliSecond: cli.trim(),
              }, portalBase);
            } catch (err: any) {
              console.error(`[make-call] simpleApiCallback threw for user ${username}:`, err);
              r = { success: false, message: err?.message || String(err) };
            }
            if (r.success) {
              result = { ...r, errorType: undefined, apiUser: username, method: 'simple-api' };
              break;
            }
            // Only update result if we haven't succeeded — keep last error for logging
            result = { ...result, message: r.message, errorType: 'call_error', apiUser: username, method: 'simple-api' };
          }
        }
      }

      await storage.logTestCall({
        userId:   userId ?? 'unknown',
        cli,
        cld,
        iAccount: iAccount ? Number(iAccount) : null,
        callId:   result.callId ?? null,
        status:   result.success ? 'success' : 'error',
        message:  result.message,
      });

      res.json(result);
    } catch (e: any) {
      console.error('[make-call] unhandled error:', e);
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // GET /api/sippy/test-call-logs — recent test call history for the authenticated user
  app.get('/api/sippy/test-call-logs', async (req: any, res: any) => {
    try {
      if (!req.user) return res.status(401).json({ message: 'Unauthorized' });
      const userId = req.user?.claims?.sub;
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const logs = await storage.getTestCallLogs(userId, limit);
      res.json(logs);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // POST /api/sippy/customers/:iCustomer/disconnect — disconnect all calls for a customer (since 5.2)
  // Body (optional): { iWholesaler } — trusted mode
  app.post('/api/sippy/customers/:iCustomer/disconnect', async (req: any, res) => {
    const iCustomer = parseInt(req.params.iCustomer, 10);
    if (isNaN(iCustomer)) return res.status(400).json({ success: false, message: 'Invalid i_customer.' });
    const settings = await storage.getSippySettings();
    const { username, password } = sippyXmlCreds(settings);
    const iWholesaler = req.body?.iWholesaler ? parseInt(req.body.iWholesaler, 10) : undefined;
    const result = await sippy.disconnectSippyCustomer(iCustomer, username, password, {
      iWholesaler,
      portalUrl: sippyPortalUrl(settings),
    });
    res.json(result);
  });

  // GET /api/sippy/dashboard-stats — real-time switch stats from monitoring + live calls
  // Uses getMonitoringGraphData (env=5) for ASR/ACD and listActiveCalls for PDD/count
  // Explicit portalUrl so it works without activeSession
  app.get('/api/sippy/dashboard-stats', async (_req, res) => {
    try {
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const portalUrl = sippyPortalUrl(settings);

      // Time window: 2 hours ago → now (broad window to capture all recent settled CDRs)
      const pad = (n: number) => String(n).padStart(2, '0');
      const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const winEnd   = new Date();                               // now
      const winStart = new Date(Date.now() - 2 * 60 * 60_000); // 2 hours ago
      const sippyDate = `${pad(winStart.getUTCHours())}:${pad(winStart.getUTCMinutes())}:${pad(winStart.getUTCSeconds())}.000 GMT `
        + `${DAYS[winStart.getUTCDay()]} ${MONTHS[winStart.getUTCMonth()]} ${pad(winStart.getUTCDate())} ${winStart.getUTCFullYear()}`;

      const cdrStartDate = sippy.toSippyDate(winStart);
      const cdrEndDate   = sippy.toSippyDate(winEnd);
      const credPairs    = sippyXmlCredsPairs(settings);

      // Run monitoring graph + CPS in parallel — live calls intentionally NOT fetched here.
      // Live call count + PDD come from /api/sippy/live-calls (separate 5-second poll).
      // Merging getSippyActiveCalls into this endpoint caused concurrent XML-RPC requests
      // that throttled Sippy and made the Live Calls page show stale/empty data.
      const [monResult, cpsResult] = await Promise.all([
        sippy.getSippyMonitoringData(username, password, 'acd_asr', {
          startDate: sippyDate,
          interval:  300,
          iEnvironment: 5,
          explicitPortalUrl: portalUrl,
        }),
        sippy.getSippyMonitoringData(username, password, 'cps_total', {
          startDate: sippyDate,
          interval:  300,
          explicitPortalUrl: portalUrl,
        }).catch(() => ({ ok: false, points: [] as any[] })),
      ]);

      // Fetch CDRs — try all credential pairs (RTST1 often 401 on CDR methods, ssp-root succeeds)
      // Use global (no i_account) CDR fetch so one call covers all accounts
      let recentCdrs: any[] = [];
      for (const creds of credPairs) {
        try {
          const rows = await sippy.getSippyCDRs(creds.username, creds.password, 500, {
            startDate: cdrStartDate, endDate: cdrEndDate,
          });
          if (rows.length > 0) { recentCdrs = rows; break; }
        } catch { continue; }
      }

      // ── CK (Call-Back) Ratio from CDRs ─────────────────────────────────────
      // Sippy result codes: "0" = success; negative = failure
      // -16 = external_translation_error (wrong routing) → Wrong Number
      // -17 = subscriber absent / -18 = call rejected    → Switched Off
      // -23 = no route / -24 = temp failure              → Untraceable
      const ckConnected   = recentCdrs.filter(c => String(c.result) === '0' && (Number(c.duration) || 0) > 0).length;
      const ckWrongNumber = recentCdrs.filter(c => ['-16', '-1', '-20'].includes(String(c.result))).length;
      const ckSwitchedOff = recentCdrs.filter(c => ['-17', '-18', '-19'].includes(String(c.result))).length;
      const ckUntraceable = recentCdrs.filter(c => ['-23', '-24', '-21', '-22'].includes(String(c.result))).length;
      const ckTotal       = recentCdrs.length;
      const ckRatio       = ckTotal > 0 ? parseFloat((ckConnected / ckTotal * 100).toFixed(1)) : 0;

      // ── MOS estimate (E-model RFC 3611 approximation) ─────────────────────
      // Use probe latency (network RTT) — PDD is signaling delay, not network delay
      let estimatedMos: number | null = null;
      const probeLatency = lastProbeResult?.latency ?? lastSwitchProbeResult?.latency ?? null;
      if (probeLatency && probeLatency > 0 && probeLatency < 500) {
        const d = probeLatency * 0.3; // one-way delay from RTT
        const R = Math.max(0, 94.2 - 0.024 * d - 0.11 * (d > 177.3 ? d - 177.3 : 0));
        estimatedMos = R > 0 ? parseFloat((1 + 0.035 * R + 7e-6 * R * (R - 60) * (100 - R)).toFixed(2)) : null;
      }

      // ── ASR / ACD ────────────────────────────────────────────────────────────
      // Primary: compute directly from CDRs (most accurate — CDR result codes never lie)
      // Fallback: monitoring graph data (getMonitoringGraphData env=5)
      const nowTs = Math.floor(Date.now() / 1000);
      const nonZeroPts = monResult.points.filter((p: any) => (p.asr > 0 || p.acd > 0) && p.ts <= nowTs);
      let asr = 0; let acd = 0;
      if (recentCdrs.length > 0) {
        const cdrTotal    = recentCdrs.length;
        const cdrAnswered = recentCdrs.filter(c => String(c.result) === '0' && (Number(c.duration) || 0) > 0);
        const cdrDurSec   = cdrAnswered.reduce((s: number, c: any) => s + (Number(c.duration) || 0), 0);
        asr = parseFloat((cdrAnswered.length / cdrTotal * 100).toFixed(2));
        acd = cdrAnswered.length > 0 ? Math.round(cdrDurSec / cdrAnswered.length) : 0;
      } else {
        // Fall back to monitoring graph (may be 0 if env=5 has no data in window)
        const latestPt = nonZeroPts.length > 0 ? nonZeroPts[nonZeroPts.length - 1] : null;
        asr = latestPt ? parseFloat(latestPt.asr.toFixed(2)) : 0;
        acd = latestPt ? Math.round(latestPt.acd) : 0;
      }

      // ── CPS (Calls Per Second) ───────────────────────────────────────────────
      // Primary: most recent non-zero point from cps_total monitoring graph.
      // Fallback: CDR-based estimate (cdrCount / 3600) when monitoring returns all zeros.
      // Note: monitoring returns all-zero for iEnvironment=5 on this Sippy instance.
      const cpsPts    = cpsResult.points.filter((p: any) => p.ts <= nowTs && (p.cps ?? p.col1 ?? 0) > 0);
      const latestCpt = cpsPts.length > 0 ? cpsPts[cpsPts.length - 1] : null;
      const cpsMonitor = latestCpt ? parseFloat((latestCpt.cps ?? latestCpt.col1 ?? 0).toFixed(2)) : 0;
      // CDR-based fallback: total CDRs in last hour ÷ 3600 s → calls/sec average
      const cpsCdrFallback = ckTotal > 0 ? parseFloat((ckTotal / 3600).toFixed(2)) : 0;
      const cps = cpsMonitor > 0 ? cpsMonitor : cpsCdrFallback;

      // activeCalls / pdd / liveCount: NOT computed here — sourced from /api/sippy/live-calls
      // on the frontend (5-second poll, single XML-RPC source to avoid throttling Sippy).

      res.json({
        asr,
        acd,
        cps,
        connected:   true,
        monOk:       monResult.ok,
        dataPoints:  monResult.points.length,
        nonZeroPts:  nonZeroPts.length,
        // CK ratio from real CDR data
        ckRatio,
        ckBreakdown: { connected: ckConnected, wrongNumber: ckWrongNumber, switchedOff: ckSwitchedOff, untraceable: ckUntraceable, total: ckTotal },
        cdrCount:    ckTotal,
        cpsSource:   cpsMonitor > 0 ? 'monitoring' : 'cdr',
        // Estimated MOS (null = not computable)
        estimatedMos,
      });
    } catch (err: any) {
      res.json({ asr: 0, acd: 0, cps: 0, connected: false, error: err.message });
    }
  });

  // GET /api/sippy/asr-acd-stats — CDR-based aggregate totals for the last 90 min.
  // Fetches live CDRs from Sippy XML-RPC (getCustomerCDRs) and computes:
  //   origination: totalCalls, billableCalls, ASR, ACD, avgPDD, revenue (sum of CDR cost field)
  //   termination: mirrors origination (revenue ≈ cost until vendor-side CDRs are added)
  //   margin: revenue - cost (0 until vendor cost source is added)
  // Falls back to portal scraping if CDR fetch fails.
  app.get('/api/sippy/asr-acd-stats', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    const PERIOD_LABEL = '90→30 min ago';
    const EMPTY_STATS = {
      ok: false, period: PERIOD_LABEL,
      origination: { totalCalls: 0, billableCalls: 0, totalDurationSec: 0, acd: 0, asr: 0, avgPdd: 0, revenue: 0 },
      termination: { totalCalls: 0, billableCalls: 0, totalDurationSec: 0, acd: 0, asr: 0, avgPdd: 0, cost: 0 },
      margin: 0,
    };
    try {
      const settings = await storage.getSettings();
      const credPairs = sippyXmlCredsPairs(settings);

      // Date window: 90 minutes ago → 30 minutes ago (settled completed CDRs only)
      const now   = new Date();
      const start = new Date(now.getTime() - 90 * 60_000);
      const end   = new Date(now.getTime() - 30 * 60_000);
      const startDate = sippy.toSippyDate(start);
      const endDate   = sippy.toSippyDate(end);

      // Fetch CDRs — global (no i_account) so one call covers all accounts.
      // Try credential pairs in order: RTST1 first, then ssp-root.
      // RTST1 often gets 401 on getCustomerCDRs; ssp-root (admin) always has access.
      let cdrs: any[] = [];
      for (const { username, password } of credPairs) {
        try {
          const rows = await sippy.getSippyCDRs(username, password, 1000, { startDate, endDate });
          if (rows.length > 0) { cdrs = rows; break; }
        } catch { continue; }
      }

      // If still empty, fall back to portal scraping
      if (cdrs.length === 0) {
        const { username: adminUser, password: adminPass } = sippyXmlCreds(settings);
        const portalUser = settings?.portalUsername ?? '';
        const portalPass = settings?.portalPassword ?? '';
        try {
          const result = await sippy.getSippyAsrAcdReport(portalUser, portalPass, '', 60, adminUser, adminPass);
          return res.json({ ...result, period: PERIOD_LABEL, source: 'portal' });
        } catch { /* fall through to zeros */ }
        return res.json({ ...EMPTY_STATS, ok: true, source: 'empty' });
      }

      // Compute origination stats from CDRs
      const totalCalls    = cdrs.length;
      const completed     = cdrs.filter(c => String(c.result) === '0');
      const billableCalls = completed.filter(c => (Number(c.duration) || 0) > 0).length;
      const totalDurSec   = completed.reduce((s, c) => s + (Number(c.duration) || 0), 0);
      const asr           = totalCalls > 0 ? parseFloat((billableCalls / totalCalls * 100).toFixed(2)) : 0;
      const acd           = billableCalls > 0 ? parseFloat((totalDurSec / billableCalls).toFixed(1)) : 0;

      // avgPdd — prefer pdd1xx (real ring delay), fall back to pdd
      const pddCalls = completed.filter(c => (Number(c.pdd1xx ?? c.pdd) || 0) > 0);
      const avgPdd   = pddCalls.length > 0
        ? parseFloat((pddCalls.reduce((s, c) => s + (Number(c.pdd1xx ?? c.pdd) || 0), 0) / pddCalls.length).toFixed(2))
        : 0;

      // Revenue = sum of CDR cost field (amount billed to customer by Sippy)
      const revenue = parseFloat(completed.reduce((s, c) => s + (parseFloat(c.cost) || 0), 0).toFixed(4));

      // Vendor cost: computed from vendor balance delta (T-90min → T-30min).
      // vendorCostFromHistory() returns null when <2 snapshots are available (app just started).
      // After the tracker has accumulated ≥90 min of history it returns the real delta.
      const balanceDelta = vendorCostFromHistory(start.getTime(), end.getTime());
      const vendorCost   = balanceDelta !== null ? balanceDelta : 0;
      const costSource   = balanceDelta !== null ? 'balance-delta' : 'pending';

      res.json({
        ok: true,
        period: PERIOD_LABEL,
        source: 'cdr',
        costSource,
        origination: { totalCalls, billableCalls, totalDurationSec: totalDurSec, acd, asr, avgPdd, revenue },
        termination: { totalCalls, billableCalls, totalDurationSec: totalDurSec, acd, asr, avgPdd, cost: vendorCost },
        margin: parseFloat((revenue - vendorCost).toFixed(4)),
      });
    } catch (err: any) {
      res.json({ ...EMPTY_STATS, error: err.message });
    }
  });

  // GET /api/sippy/per-account-stats — CDR-based per-client origination + vendor totals.
  // Origination: groups CDRs by iAccount → clientName (exact, from Sippy CDR field).
  // Termination: computes total CDR stats then distributes across known vendor connections
  //   (from portal scraping); falls back to a single "All Connections" row when portal fails.
  // Returns the same shape as the old portal-scraping endpoint so the frontend needs no change.
  app.get('/api/sippy/per-account-stats', async (req: any, res) => {
    const period = parseInt((req.query.period as string) || '90', 10);
    const EMPTY_ROW = { name: '', totalCalls: 0, billableCalls: 0, durationSec: 0, acdSec: 0, asr: 0, avgPdd: 0, amount: 0 };
    const FAIL = (error: string) => ({ ok: false, period: `${period} min`, fetchedAt: new Date().toISOString(), clients: [], vendors: [], origTotal: { ...EMPTY_ROW }, termTotal: { ...EMPTY_ROW }, error });

    try {
      const settings = await storage.getSettings();
      const credPairs = sippyXmlCredsPairs(settings);

      // ── Date window ──────────────────────────────────────────────────────────
      const now   = new Date();
      const start = new Date(now.getTime() - period * 60_000);
      const startDate = sippy.toSippyDate(start);
      const endDate   = sippy.toSippyDate(now);

      // ── Fetch CDRs (up to 2000) ──────────────────────────────────────────────
      let cdrs: any[] = [];
      for (const { username, password } of credPairs) {
        try {
          const fetched = await sippy.getSippyCDRs(username, password, 2000, { startDate, endDate });
          if (fetched && fetched.length > 0) { cdrs = fetched; break; }
        } catch { continue; }
      }

      // Helper: compute a stat row from a CDR slice
      function cdrToRow(name: string, slice: any[]): typeof EMPTY_ROW {
        const totalCalls    = slice.length;
        const completed     = slice.filter(c => String(c.result) === '0');
        const billable      = completed.filter(c => (Number(c.duration) || 0) > 0);
        const billableCalls = billable.length;
        const durationSec   = completed.reduce((s, c) => s + (Number(c.duration) || 0), 0);
        const acdSec        = billableCalls > 0 ? parseFloat((durationSec / billableCalls).toFixed(1)) : 0;
        const asr           = totalCalls > 0 ? parseFloat((billableCalls / totalCalls * 100).toFixed(2)) : 0;
        const pddArr        = completed.map(c => Number(c.pdd1xx ?? c.pdd) || 0).filter(v => v > 0);
        const avgPdd        = pddArr.length > 0 ? parseFloat((pddArr.reduce((a, b) => a + b, 0) / pddArr.length).toFixed(2)) : 0;
        const amount        = parseFloat(completed.reduce((s, c) => s + (parseFloat(c.cost) || 0), 0).toFixed(4));
        return { name, totalCalls, billableCalls, durationSec, acdSec, asr, avgPdd, amount };
      }

      // ── Origination: group by iAccount → clientName ──────────────────────────
      const clientGroups: Record<string, any[]> = {};
      for (const cdr of cdrs) {
        const name = cdr.clientName || accountNameCache.get(String(cdr.iAccount ?? '')) || (cdr.iAccount ? `Acct.${cdr.iAccount}` : 'Unknown');
        if (!clientGroups[name]) clientGroups[name] = [];
        clientGroups[name].push(cdr);
      }
      const clientRows = Object.entries(clientGroups)
        .map(([name, slice]) => cdrToRow(name, slice))
        .sort((a, b) => b.totalCalls - a.totalCalls);

      // origTotal = sum across all clients
      const origTotal = cdrToRow('Total', cdrs);

      // ── Termination: try portal first; fall back to CDR total ────────────────
      // The portal finds vendor connection names (even if stats are stale);
      // merge CDR stats into those rows proportionally.
      let termRows: typeof EMPTY_ROW[] = [];
      try {
        const portalUser = settings?.portalUsername ?? '';
        const portalPass = settings?.portalPassword ?? '';
        const adminUser  = settings?.apiAdminUsername ?? '';
        const adminPass  = settings?.apiAdminPassword ?? '';
        const portal = await sippy.getSippyPerAccountStats(portalUser, portalPass, period, adminUser, adminPass);
        if (portal.ok && portal.vendors.length > 0) {
          // If portal has non-zero stats, use them directly
          const hasData = portal.vendors.some(v => v.totalCalls > 0);
          if (hasData) {
            termRows = portal.vendors.map(v => ({ ...EMPTY_ROW, name: v.name, totalCalls: v.totalCalls, billableCalls: v.billableCalls, durationSec: v.durationSec, acdSec: v.acdSec, asr: v.asr, avgPdd: v.avgPdd, amount: v.amount }));
          } else if (portal.vendors.length > 0 && cdrs.length > 0) {
            // Portal has vendor names but 0 stats — distribute CDR totals across vendors
            const totalPerVendor = origTotal.totalCalls > 0 ? Math.round(origTotal.totalCalls / portal.vendors.length) : 0;
            const billablePerVendor = origTotal.billableCalls > 0 ? Math.round(origTotal.billableCalls / portal.vendors.length) : 0;
            // Assign all CDR stats to first vendor (most active, based on balance consumption)
            termRows = portal.vendors.map((v, i) => i === 0
              ? { ...EMPTY_ROW, name: v.name, totalCalls: origTotal.totalCalls, billableCalls: origTotal.billableCalls, durationSec: origTotal.durationSec, acdSec: origTotal.acdSec, asr: origTotal.asr, avgPdd: origTotal.avgPdd, amount: origTotal.amount }
              : { ...EMPTY_ROW, name: v.name }
            );
          }
        }
      } catch { /* fall through */ }

      // Final fallback: single combined termination row from CDR totals
      if (termRows.length === 0) {
        termRows = [{ ...origTotal, name: 'All Connections' }];
      }

      const termTotal: typeof EMPTY_ROW = termRows.reduce((acc, r) => ({
        name: 'Total',
        totalCalls:    acc.totalCalls    + r.totalCalls,
        billableCalls: acc.billableCalls + r.billableCalls,
        durationSec:   acc.durationSec   + r.durationSec,
        acdSec:        acc.acdSec        + r.acdSec,
        asr:           0, // recomputed below
        avgPdd:        0,
        amount:        acc.amount        + r.amount,
      }), { ...EMPTY_ROW, name: 'Total' });
      if (termTotal.totalCalls > 0) {
        termTotal.asr    = parseFloat((termTotal.billableCalls / termTotal.totalCalls * 100).toFixed(2));
        termTotal.acdSec = parseFloat((termTotal.durationSec / Math.max(termTotal.billableCalls, 1)).toFixed(1));
      }

      res.json({
        ok:        true,
        period:    `${period} min`,
        source:    'cdr',
        fetchedAt: new Date().toISOString(),
        clients:   clientRows,
        vendors:   termRows,
        origTotal,
        termTotal,
      });
    } catch (err: any) {
      res.status(500).json(FAIL(err.message));
    }
  });

  // GET /api/sippy/call-stats — lightweight active call count summary (getAccountCallStats)
  // Root-only (all accounts). Returns { i_account: [total, connected] }
  app.get('/api/sippy/call-stats', async (_req, res) => {
    const settings = await storage.getSettings();
    const { username, password } = sippyXmlCreds(settings);
    const result = await sippy.getSippyCallStats(username, password);
    res.json(result);
  });

  // GET /api/sippy/call-stats/customer — getAccountCallStatsCustomer() — docs 107462 (2024+, FreightSwitch)
  // Scoped to a single customer's accounts. Trusted mode: ?iCustomer=<id>
  // Returns { i_account: [total, connected] }
  app.get('/api/sippy/call-stats/customer', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req: any, res) => {
    try {
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, message: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const iCustomer = req.query.iCustomer ? parseInt(req.query.iCustomer as string, 10) : undefined;
      const result = await sippy.getSippyCallStatsCustomer(username, password, { iCustomer, portalUrl: sippyPortalUrl(settings) });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ── Rolling CDR Cache (for /api/sippy/cdr/graphs) ───────────────────────────
  // Fetches latest 500 CDRs without date filter (fast, no timeout) every 5 minutes,
  // deduplicates by callId, and keeps a rolling 72-hour window.
  const CDR_CACHE_MAX_HOURS = 72;
  const cdrCache = new Map<string, Awaited<ReturnType<typeof sippy.getSippyCDRs>>[0]>();
  let cdrCacheUpdatedAt: Date | null = null;

  async function refreshCdrCache(): Promise<void> {
    try {
      const settings = await storage.getSettings();
      const credPairs = sippyXmlCredsPairs(settings);
      let batch: Awaited<ReturnType<typeof sippy.getSippyCDRs>> = [];

      for (const { username, password } of credPairs) {
        batch = await sippy.getSippyCDRs(username, password, 500, {});
        if (batch.length > 0) break;
      }

      // Fallback: portal scrape
      if (batch.length === 0 && settings) {
        const portalUrl = sippyPortalUrl(settings);
        const adminUser = settings.apiAdminUsername ?? '';
        const adminPass = settings.apiAdminPassword ?? '';
        if (adminUser && adminPass) {
          try {
            const scraped = await sippy.scrapeAdminPortalCDRs(adminUser, adminPass, portalUrl, { limit: 500 });
            if (scraped.length > 0) batch = scraped;
          } catch { /* ignore */ }
        }
      }

      const cutoff = Date.now() - CDR_CACHE_MAX_HOURS * 3600 * 1000;
      let added = 0;
      for (const c of batch) {
        const key = c.callId || c.iCdr || `${c.startTime}:${c.caller}:${c.callee}`;
        if (!key) continue;
        if (!cdrCache.has(key)) { cdrCache.set(key, c); added++; }
      }
      // Evict entries older than 72h
      for (const [k, c] of cdrCache) {
        const ts = c.startTime ? new Date(c.startTime).getTime() : c.connectTime ? new Date(c.connectTime).getTime() : 0;
        if (ts && ts < cutoff) cdrCache.delete(k);
      }
      cdrCacheUpdatedAt = new Date();
      if (added > 0) console.log(`[cdr-cache] +${added} new records, total=${cdrCache.size}`);
    } catch (e: any) {
      console.warn('[cdr-cache] refresh error:', e.message);
    }
  }

  // Seed cache immediately on startup, then every 5 minutes
  setTimeout(() => refreshCdrCache(), 5000);
  setInterval(() => refreshCdrCache(), 5 * 60 * 1000);

  // GET /api/sippy/cdr/graphs — pre-aggregated CDR data for charts
  // Returns: hourly call counts (last Nh), top destinations, top clients
  app.get('/api/sippy/cdr/graphs', async (req: any, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    try {
      const hours = Number(req.query.hours) || 24;
      const now = new Date();
      const cutoffMs = now.getTime() - hours * 3600 * 1000;

      // Read from rolling CDR cache (populated by background refreshCdrCache every 5 min)
      const cdrs = Array.from(cdrCache.values()).filter(c => {
        const ts = c.startTime ? new Date(c.startTime).getTime() : c.connectTime ? new Date(c.connectTime).getTime() : 0;
        return ts >= cutoffMs;
      }).map(c => ({
        ...c,
        clientName: c.clientName || accountNameCache.get(String(c.iAccount ?? '')) || (c.iAccount ? `Acct.${c.iAccount}` : 'Unknown'),
      }));

      // 1) Hourly call counts (bucketed by UTC hour label)
      const buckets: Record<string, { total: number; answered: number }> = {};
      for (let h = hours - 1; h >= 0; h--) {
        const t = new Date(now.getTime() - h * 3600 * 1000);
        const label = `${String(t.getUTCHours()).padStart(2, '0')}:00`;
        buckets[label] = { total: 0, answered: 0 };
      }
      for (const c of cdrs) {
        const ts = c.startTime ? new Date(c.startTime) : c.connectTime ? new Date(c.connectTime) : null;
        if (!ts) continue;
        const label = `${String(ts.getUTCHours()).padStart(2, '0')}:00`;
        if (buckets[label]) {
          buckets[label].total++;
          if ((c.duration ?? 0) > 0) buckets[label].answered++;
        }
      }
      const hourly = Object.entries(buckets).map(([hour, v]) => ({ hour, ...v }));

      // 2) Top destinations (by country or CLD prefix)
      const destMap: Record<string, number> = {};
      for (const c of cdrs) {
        const dest = c.country || (c.callee ? c.callee.slice(0, 3) : 'Unknown');
        destMap[dest] = (destMap[dest] || 0) + 1;
      }
      const byDestination = Object.entries(destMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([name, calls]) => ({ name, calls }));

      // 3) Top clients
      const clientMap: Record<string, number> = {};
      for (const c of cdrs) {
        const client = c.clientName || 'Unknown';
        clientMap[client] = (clientMap[client] || 0) + 1;
      }
      const byClient = Object.entries(clientMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([name, calls]) => ({ name, calls }));

      res.json({
        hourly, byDestination, byClient,
        total: cdrs.length, windowHours: hours,
        cacheSize: cdrCache.size,
        cacheUpdatedAt: cdrCacheUpdatedAt?.toISOString() ?? null,
      });
    } catch (err: any) {
      console.error('[graphs]', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/sippy/cdr — CDR records from Sippy
  // Query params: limit, startDate (ISO/Sippy), endDate, iCustomer, iAccount, type,
  //               cli, cld, offset, iWholesaler, iCdrsCustomer
  // Trusted mode: getCustomerCDRs uses iWholesaler (default 1); getAccountCDRs uses iCustomer=1
  // iCdrsCustomer: fetch only the single CDR with this i_cdrs_customer value (docs 107429)
  app.get('/api/sippy/cdr', async (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    try {
      const settings = await storage.getSettings();
      const credPairs = sippyXmlCredsPairs(settings);
      const limit  = Number(req.query.limit)  || 50;
      const offset = req.query.offset ? Number(req.query.offset) : undefined;
      const opts: Parameters<typeof sippy.getSippyCDRs>[3] = {};
      if (req.query.startDate)      opts.startDate      = req.query.startDate      as string;
      if (req.query.endDate)        opts.endDate        = req.query.endDate        as string;
      if (req.query.iCustomer)      opts.iCustomer      = Number(req.query.iCustomer);
      if (req.query.iAccount)       opts.iAccount       = Number(req.query.iAccount);
      if (req.query.iWholesaler)    opts.iWholesaler    = Number(req.query.iWholesaler);
      if (req.query.iCdrsCustomer)  opts.iCdrsCustomer  = req.query.iCdrsCustomer as string;
      if (req.query.iCdr)           opts.iCdr           = req.query.iCdr           as string;
      if (req.query.type)           opts.type           = req.query.type           as string;
      if (req.query.cli)            opts.cli            = req.query.cli            as string;
      if (req.query.cld)            opts.cld            = req.query.cld            as string;
      if (offset !== undefined)     opts.offset         = offset;
      // Try each credential pair (handles cases where apiAdmin and portal creds are swapped in settings)
      let cdrs: Awaited<ReturnType<typeof sippy.getSippyCDRs>> = [];
      for (const { username, password } of credPairs) {
        cdrs = await sippy.getSippyCDRs(username, password, limit, opts);
        if (cdrs.length > 0) break;
      }
      // Enrich with clientName from account cache and vendorName from connection cache
      cdrs = cdrs.map(c => ({
        ...c,
        clientName: c.clientName || accountNameCache.get(String(c.iAccount ?? '')) || (c.iAccount ? `Acct.${c.iAccount}` : undefined),
        vendorName: (c as any).vendorName || (c as any).vendor || connectionVendorCache.get(String((c as any).iConnection ?? '')) || undefined,
      }));
      // Fallback 1: XML-RPC returned 0 → scrape customer portal with RTST1 credentials
      if (cdrs.length === 0 && settings) {
        const portalUser = settings.portalUsername ?? '';
        const portalPass = settings.portalPassword ?? '';
        const portalUrl  = sippyPortalUrl(settings);
        const adminUser  = settings.apiAdminUsername ?? '';
        const adminPass  = settings.apiAdminPassword ?? '';
        const startDate  = (req.query.startDate as string) || '1 day ago';
        const endDate    = (req.query.endDate   as string) || 'now';
        const typeMap: Record<string, string> = {
          errors: '6', non_zero: '4', complete: '5', non_zero_and_errors: '3', incomplete: '2',
        };
        const callsSel = typeMap[req.query.type as string] || '1';
        const pageOffset = offset || 0;
        try {
          const scraped = await sippy.scrapePortalCDRs(portalUser, portalPass, portalUrl, {
            limit, startDate, endDate, callsSelect: callsSel,
            fallbackUsername: adminUser, fallbackPassword: adminPass,
          });
          if (scraped.length > 0) cdrs = scraped;
        } catch { /* ignore */ }

        // Fallback 2: customer portal also empty → scrape ADMIN portal as ssp-root (admin login)
        // This gives access to ALL customers' CDRs (Vovida, Manor-It, etc.)
        if (cdrs.length === 0 && adminUser && adminPass) {
          try {
            const adminScraped = await sippy.scrapeAdminPortalCDRs(adminUser, adminPass, portalUrl, {
              limit,
              startDate,
              endDate,
              callsSelect: callsSel,
              source:      req.query.cli  as string | undefined,
              destination: req.query.cld  as string | undefined,
              offset:      pageOffset,
            });
            if (adminScraped.length > 0) cdrs = adminScraped;
          } catch { /* ignore */ }
        }
      }
      res.json({ cdrs });
    } catch (e: any) { res.status(500).json({ cdrs: [], error: e.message }); }
  });

  // GET /api/sippy/cdr/vendor — vendor CDRs (client CDRs enriched with vendor name via remoteIp)
  // Uses standard getSippyCDRs and enriches each CDR with a vendorName resolved from
  // connectionIpCache (IP → vendor name) populated at startup from vendor connection destinations.
  app.get('/api/sippy/cdr/vendor', async (req: any, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    try {
      const settings  = await storage.getSettings();
      const credPairs = sippyXmlCredsPairs(settings);
      const startDate = req.query.startDate as string | undefined;
      const endDate   = req.query.endDate   as string | undefined;
      const cli       = req.query.cli       as string | undefined;
      const cld       = req.query.cld       as string | undefined;
      const limit     = Number(req.query.limit)  || 50;
      const offset    = Number(req.query.offset) || 0;
      const type      = (req.query.type as string | undefined) || 'all';

      // Use the same standard CDR fetch as the client CDR endpoint
      let rawCdrs: Awaited<ReturnType<typeof sippy.getSippyCDRs>> = [];
      for (const { username, password } of credPairs) {
        rawCdrs = await sippy.getSippyCDRs(username, password, limit + offset, {
          startDate, endDate, cli, cld, type,
        });
        if (rawCdrs.length > 0) break;
      }

      // Determine a single-vendor fallback: if all vendor connections share one vendor name, use it
      // This handles the common case where all traffic routes through one carrier
      const uniqueVendorNames = new Set(connectionIpCache.values());
      // Also collect unique names from connectionVendorCache (only actual vendor names, not IDs or IPs)
      const vcNames = Array.from(connectionVendorCache.entries())
        .filter(([k]) => isNaN(Number(k)))  // exclude numeric ID keys
        .map(([, v]) => v);
      const uniqueVcNames = new Set(vcNames);

      // Slice once for this page
      const pageCdrs = rawCdrs.slice(offset, offset + limit);

      // Page-level iConnection deduction: if all CDRs share one non-empty connection ID, resolve it
      const pageConnIds = new Set(pageCdrs.map(c => String((c as any).iConnection ?? '')).filter(Boolean));
      const pageConnFallback = pageConnIds.size === 1
        ? connectionVendorCache.get(Array.from(pageConnIds)[0])
        : undefined;

      // Page-level remoteIp deduction: if all CDRs share one IP, and we have a name for it, use it
      const pageRemoteHosts = new Set(pageCdrs.map(c => (c.remoteIp || '').split(':')[0].trim()).filter(Boolean));
      const pageIpFallback = pageRemoteHosts.size === 1
        ? connectionIpCache.get(Array.from(pageRemoteHosts)[0])
        : undefined;

      const singleVendorFallback = uniqueVcNames.size === 1
        ? Array.from(uniqueVcNames)[0]
        : uniqueVcNames.size === 0 && uniqueVendorNames.size === 1
          ? Array.from(uniqueVendorNames)[0]
          : pageConnFallback ?? pageIpFallback ?? undefined;

      // Build a page-level IP→vendor map from any CDRs that already have vendor info
      // (c.vendor comes from Sippy's vendor_name field; iConnection from i_connection)
      const pageIpVendor: Map<string, string> = new Map();
      for (const c of pageCdrs) {
        const remoteHost = (c.remoteIp || '').split(':')[0].trim();
        if (!remoteHost) continue;
        const resolved = connectionIpCache.get(remoteHost)
          || connectionVendorCache.get(String((c as any).iConnection ?? ''))
          || (c as any).vendor;
        if (resolved && !pageIpVendor.has(remoteHost)) pageIpVendor.set(remoteHost, resolved);
      }
      // Opportunistically populate connectionIpCache from page discoveries
      for (const [ip, name] of pageIpVendor) {
        if (!connectionIpCache.has(ip)) connectionIpCache.set(ip, name);
      }

      // Enrich with vendor name from connectionIpCache (remoteIp host → vendor name)
      const cdrs = pageCdrs.map(c => {
        const remoteHost = (c.remoteIp || '').split(':')[0].trim();
        const vendorName = connectionIpCache.get(remoteHost)
          || pageIpVendor.get(remoteHost)
          || connectionVendorCache.get(String((c as any).iConnection ?? ''))
          || (c as any).vendor
          || singleVendorFallback
          || undefined;
        const clientName = accountNameCache.get(String(c.iAccount ?? ''))
          || (c as any).clientName
          || (c.iAccount ? `Acct.${c.iAccount}` : undefined);
        return { ...c, vendorName, clientName };
      });

      res.json({ cdrs });
    } catch (e: any) { res.status(500).json({ cdrs: [], error: e.message }); }
  });

  // GET /api/sippy/cdr/vendors/mera — export vendor CDRs in Mera format (docs 107436)
  // Query params: startDate, endDate (Sippy or ISO format), startICdrsConnection,
  //               endICdrsConnection, trustedMode (default true)
  // Returns: { success, lastICdrsConnection, cdrs: SippyMeraCDR[], message }
  // Supports pagination: use lastICdrsConnection as startICdrsConnection on next call.
  app.get('/api/sippy/cdr/vendors/mera', async (req: any, res) => {
    try {
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);

      const formatDate = (d?: string) => {
        if (!d) return undefined;
        if (d.includes('GMT')) return d;
        try { return sippy.toSippyDate(d); } catch { return d; }
      };

      const result = await sippy.exportVendorsCDRsMera(username, password, {
        startDate:            formatDate(req.query.startDate as string | undefined),
        endDate:              formatDate(req.query.endDate   as string | undefined),
        startICdrsConnection: req.query.startICdrsConnection as string | undefined,
        endICdrsConnection:   req.query.endICdrsConnection   as string | undefined,
        trustedMode:          req.query.trustedMode !== 'false',
        portalUrl:            sippyPortalUrl(settings),
      });

      if (!result.success) return res.status(422).json({ success: false, error: result.message, cdrs: [] });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message, cdrs: [] }); }
  });

  // GET /api/sippy/cdr/sdp — retrieve SDP messages for a call (docs 3000039695)
  // Query params: iCall (required, integer), iCustomer (optional, trusted mode)
  // Returns: { records: SippyCDRSDPRecord[], iCustomer? }
  //   Each record: { timeStamp, iCallsSdp, iCdrsConnection, sipMsgType, sdp }
  //   iCallsSdp is set when the SDP relates to the Caller side.
  //   iCdrsConnection is set when the SDP relates to the Callee side.
  app.get('/api/sippy/cdr/sdp', async (req: any, res) => {
    try {
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);

      const iCall = req.query.iCall ? Number(req.query.iCall) : undefined;
      if (!iCall || isNaN(iCall)) {
        return res.status(400).json({ error: 'iCall (integer) is required' });
      }
      const iCustomer = req.query.iCustomer ? Number(req.query.iCustomer) : undefined;

      const result = await sippy.getCDRSDP(username, password, iCall, iCustomer);
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message, records: [] }); }
  });

  // ── Binary Upload (docs 3000073010 / 3000073011 / 3000073012) ──────────────

  // POST /api/sippy/upload/token — initiate a bulk binary upload (docs 3000073011)
  // Body (JSON): { iUploadType, processOn?, expiresOn?, params?, iCustomer? }
  //   iUploadType: integer (1 = Rates/Tariff, 2 = Routes/Destination Set; see getDictionary('upload_types'))
  //   processOn:   date string — when to start processing (default: now).
  //                Accepts standard ISO (2024-01-15T14:30:00Z) or Sippy format (20240115T14:30:00);
  //                auto-converted to Sippy's compact dateTime.iso8601 UTC format internally.
  //   expiresOn:   date string — when the upload URL expires (default: now + 1 day); same format rules.
  //   params:      nested struct e.g. { i_tariff: 5 } for rates or { i_destination_set: 3 } for routes
  //   iCustomer:   trusted-mode customer ID (optional)
  // Returns: { token, url } — POST the binary file to `url` using chunked encoding
  app.post('/api/sippy/upload/token', async (req: any, res) => {
    try {
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);

      const { iUploadType, processOn, expiresOn, params: uploadParams, iCustomer } = req.body ?? {};
      if (!iUploadType || isNaN(Number(iUploadType))) {
        return res.status(400).json({ error: 'iUploadType (integer) is required' });
      }

      const result = await sippy.getUploadToken(
        username, password,
        Number(iUploadType),
        processOn  as string | undefined,
        expiresOn  as string | undefined,
        uploadParams as Record<string, number> | undefined,
        iCustomer !== undefined ? Number(iCustomer) : undefined,
      );
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/sippy/upload/status — poll upload processing state (docs 3000073012)
  // Query params: token (required), iCustomer (optional, trusted mode)
  // Returns: { status, processOn?, expiresOn?, statusChangedOn?, reportUrl? }
  //   Status lifecycle: INIT_TOKEN → FILE_UPLOADED → PROCESSING → DONE | FAIL
  //   reportUrl is only present when status is DONE or FAIL
  app.get('/api/sippy/upload/status', async (req: any, res) => {
    try {
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);

      const token = req.query.token as string | undefined;
      if (!token) return res.status(400).json({ error: 'token is required' });
      const iCustomer = req.query.iCustomer ? Number(req.query.iCustomer) : undefined;

      const result = await sippy.getUploadStatus(username, password, token, iCustomer);
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/sippy/upload/file — proxy a binary file to a Sippy upload URL (docs 3000073010)
  // Query params: url (required) — the upload URL returned by /api/sippy/upload/token
  //               filename (optional) — original filename for Content-Disposition
  // Body: raw binary file content (any MIME type; set Content-Type as needed)
  // Returns: { success, body } — body is Sippy's raw HTTP response text
  app.post('/api/sippy/upload/file',
    // Collect raw binary body (any Content-Type, up to 200 MB) without depending on require()
    (req: any, res: any, next: any) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => { req.rawBinary = Buffer.concat(chunks); next(); });
      req.on('error', next);
    },
    async (req: any, res) => {
      try {
        const uploadUrl = req.query.url as string | undefined;
        if (!uploadUrl) return res.status(400).json({ error: 'url query param is required' });

        const data: Buffer = req.rawBinary ?? Buffer.from('');
        const filename = (req.query.filename as string | undefined) ?? 'upload.csv';

        const result = await sippy.uploadBinaryFile(uploadUrl, data, filename);
        res.status(result.success ? 200 : 422).json(result);
      } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
    }
  );

  // ── SSL Certificates (docs 3000108832) ─────────────────────────────────────
  // All routes support trusted mode via iCustomer body/query param (i_customer = 1 for root).
  // Available since Sippy 2021. i_ssl_use_domain_type available since Sippy 2023.

  // POST /api/sippy/ssl-certificates — create a new SSL certificate
  // Body (JSON): { name, commonName, iSslCertificateType?, iSslUseDomainType?,
  //               altDnsNames?, certificate?, key?, iEnvironment?, iCustomer? }
  //   For 'Upload Own' type: certificate + key are mandatory.
  //   For 'Let's Encrypt' type: iSslCertificateType is mandatory; certificate/key are optional.
  //   altDnsNames: array of strings — Subject Alternative Names (SANs).
  //   certificate/key: base64-encoded PEM strings.
  // Returns: { iSslCertificate, relayResult? }
  app.post('/api/sippy/ssl-certificates', async (req: any, res) => {
    try {
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const b = req.body ?? {};
      if (!b.name || !b.commonName) {
        return res.status(400).json({ error: 'name and commonName are required' });
      }
      const result = await sippy.createSSLCertificate(username, password, {
        name:                 b.name,
        commonName:           b.commonName,
        iSslCertificateType:  b.iSslCertificateType  !== undefined ? Number(b.iSslCertificateType)  : undefined,
        iSslUseDomainType:    b.iSslUseDomainType    !== undefined ? Number(b.iSslUseDomainType)    : undefined,
        altDnsNames:          Array.isArray(b.altDnsNames) ? b.altDnsNames : undefined,
        certificate:          b.certificate           as string | undefined,
        key:                  b.key                  as string | undefined,
        iEnvironment:         b.iEnvironment          !== undefined ? Number(b.iEnvironment)          : undefined,
        iCustomer:            b.iCustomer             !== undefined ? Number(b.iCustomer)             : undefined,
      });
      res.status(201).json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // PATCH /api/sippy/ssl-certificates/:id — update an existing SSL certificate
  // Body (JSON): { name?, commonName?, iSslCertificateType?, iSslUseDomainType?,
  //               altDnsNames?, certificate?, key?, iEnvironment?, iCustomer? }
  // Returns: { iSslCertificate, relayResult? }
  app.patch('/api/sippy/ssl-certificates/:id', async (req: any, res) => {
    try {
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const iSslCertificate = Number(req.params.id);
      if (!iSslCertificate || isNaN(iSslCertificate)) {
        return res.status(400).json({ error: 'id must be a valid integer' });
      }
      const b = req.body ?? {};
      const result = await sippy.updateSSLCertificate(username, password, {
        iSslCertificate,
        name:                 b.name                 as string | undefined,
        commonName:           b.commonName            as string | undefined,
        iSslCertificateType:  b.iSslCertificateType  !== undefined ? Number(b.iSslCertificateType)  : undefined,
        iSslUseDomainType:    b.iSslUseDomainType    !== undefined ? Number(b.iSslUseDomainType)    : undefined,
        altDnsNames:          Array.isArray(b.altDnsNames) ? b.altDnsNames : undefined,
        certificate:          b.certificate           as string | undefined,
        key:                  b.key                  as string | undefined,
        iEnvironment:         b.iEnvironment          !== undefined ? Number(b.iEnvironment)          : undefined,
        iCustomer:            b.iCustomer             !== undefined ? Number(b.iCustomer)             : undefined,
      });
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // DELETE /api/sippy/ssl-certificates/:id — delete an SSL certificate
  // Query params: iEnvironment (optional), iCustomer (optional)
  // Returns: { iSslCertificate, relayResult? }
  app.delete('/api/sippy/ssl-certificates/:id', async (req: any, res) => {
    try {
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const iSslCertificate = Number(req.params.id);
      if (!iSslCertificate || isNaN(iSslCertificate)) {
        return res.status(400).json({ error: 'id must be a valid integer' });
      }
      const iEnvironment = req.query.iEnvironment ? Number(req.query.iEnvironment) : undefined;
      const iCustomer    = req.query.iCustomer    ? Number(req.query.iCustomer)    : undefined;
      const result = await sippy.deleteSSLCertificate(username, password, iSslCertificate, iEnvironment, iCustomer);
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/sippy/ssl-certificates/:id — get SSL certificate details
  // Query params: iEnvironment (optional), iCustomer (optional)
  // Returns: { certificate: SippySSLCertificate, relayResult? }
  //   certificate.extra holds any undocumented fields returned by Sippy.
  app.get('/api/sippy/ssl-certificates/:id', async (req: any, res) => {
    try {
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const iSslCertificate = Number(req.params.id);
      if (!iSslCertificate || isNaN(iSslCertificate)) {
        return res.status(400).json({ error: 'id must be a valid integer' });
      }
      const iEnvironment = req.query.iEnvironment ? Number(req.query.iEnvironment) : undefined;
      const iCustomer    = req.query.iCustomer    ? Number(req.query.iCustomer)    : undefined;
      const result = await sippy.getSSLCertificateInfo(username, password, iSslCertificate, iEnvironment, iCustomer);
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/sippy/ssl-certificates — list SSL certificates
  // Query params: namePattern?, limit?, offset?, iEnvironment?, iCustomer?
  //   namePattern uses SQL ILIKE syntax (e.g. 'prod%', '%wildcard%').
  // Returns: { certificates: SippySSLCertificate[], relayResult? }
  app.get('/api/sippy/ssl-certificates', async (req: any, res) => {
    try {
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.getSSLCertificatesList(
        username, password,
        req.query.namePattern  as string | undefined,
        req.query.limit        ? Number(req.query.limit)        : undefined,
        req.query.offset       ? Number(req.query.offset)       : undefined,
        req.query.iEnvironment ? Number(req.query.iEnvironment) : undefined,
        req.query.iCustomer    ? Number(req.query.iCustomer)    : undefined,
      );
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── CA Lists (docs 3000111712) ──────────────────────────────────────────────
  // All routes support trusted mode via iCustomer. Available since Sippy 2021.
  // i_ssl_use_domain_type available from Sippy 2023.

  // POST /api/sippy/ca-lists — create a new CA list
  // Body (JSON): { name, caList, iCaListType?, iSslUseDomainType?, iCustomer? }
  //   name:              Human-readable name (required)
  //   caList:            base64 PEM string for 'Uploaded' type, or folder path for 'Local Folder'
  //   iCaListType:       CA list type integer (optional; see getDictionary('ca_list_types'))
  //   iSslUseDomainType: Domain type integer (optional; see getDictionary('ssl_use_domain_types'))
  // Returns: { iCaList }
  app.post('/api/sippy/ca-lists', async (req: any, res) => {
    try {
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const b = req.body ?? {};
      if (!b.name || !b.caList) {
        return res.status(400).json({ error: 'name and caList are required' });
      }
      const result = await sippy.createCAList(
        username, password,
        b.name as string,
        b.caList as string,
        b.iCaListType       !== undefined ? Number(b.iCaListType)       : undefined,
        b.iSslUseDomainType !== undefined ? Number(b.iSslUseDomainType) : undefined,
        b.iCustomer         !== undefined ? Number(b.iCustomer)         : undefined,
      );
      res.status(201).json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // PATCH /api/sippy/ca-lists/:id — update an existing CA list
  // Body (JSON): { name?, iCaListType?, iSslUseDomainType?, caList?, iCustomer? }
  //   iSslUseDomainType and caList are co-dependent — both must be supplied together.
  // Returns: { iCaList }
  app.patch('/api/sippy/ca-lists/:id', async (req: any, res) => {
    try {
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const iCaList = Number(req.params.id);
      if (!iCaList || isNaN(iCaList)) {
        return res.status(400).json({ error: 'id must be a valid integer' });
      }
      const b = req.body ?? {};
      const result = await sippy.updateCAList(username, password, iCaList, {
        name:              b.name              as string | undefined,
        iCaListType:       b.iCaListType       !== undefined ? Number(b.iCaListType)       : undefined,
        iSslUseDomainType: b.iSslUseDomainType !== undefined ? Number(b.iSslUseDomainType) : undefined,
        caList:            b.caList            as string | undefined,
        iCustomer:         b.iCustomer         !== undefined ? Number(b.iCustomer)         : undefined,
      });
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // DELETE /api/sippy/ca-lists/:id — delete a CA list
  // Query params: iCustomer (optional, trusted mode)
  // Returns: { iCaList }
  app.delete('/api/sippy/ca-lists/:id', async (req: any, res) => {
    try {
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const iCaList = Number(req.params.id);
      if (!iCaList || isNaN(iCaList)) {
        return res.status(400).json({ error: 'id must be a valid integer' });
      }
      const iCustomer = req.query.iCustomer ? Number(req.query.iCustomer) : undefined;
      const result = await sippy.deleteCAList(username, password, iCaList, iCustomer);
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/sippy/ca-lists/:id — get CA list details
  // Query params: iCustomer (optional, trusted mode)
  // Returns: SippyCAList — { iCaList, name?, caList?, iCaListType?, iSslUseDomainType?, extra }
  app.get('/api/sippy/ca-lists/:id', async (req: any, res) => {
    try {
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const iCaList = Number(req.params.id);
      if (!iCaList || isNaN(iCaList)) {
        return res.status(400).json({ error: 'id must be a valid integer' });
      }
      const iCustomer = req.query.iCustomer ? Number(req.query.iCustomer) : undefined;
      const result = await sippy.getCAListInfo(username, password, iCaList, iCustomer);
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/sippy/ca-lists — list CA lists with optional filtering
  // Query params: namePattern?, limit?, offset?, iCustomer?
  //   namePattern: SQL ILIKE pattern (e.g. 'prod%', '%wildcard%')
  // Returns: SippyCAList[]
  app.get('/api/sippy/ca-lists', async (req: any, res) => {
    try {
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.getCAListsList(
        username, password,
        req.query.namePattern as string | undefined,
        req.query.limit       ? Number(req.query.limit)    : undefined,
        req.query.offset      ? Number(req.query.offset)   : undefined,
        req.query.iCustomer   ? Number(req.query.iCustomer): undefined,
      );
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Network Services (docs 3000112519) ─────────────────────────────────────
  // Network services are pre-existing in Sippy — no create or delete, only update + read.
  // i_proto_transport identifies the service; see getDictionary('proto_transports') for values.
  // Available since Sippy 2021. All routes support trusted mode via iCustomer.

  // PATCH /api/sippy/network-services/:protoTransport — update listeners for a network service
  // Body (JSON): { listeners: [{ ipAddress, port }, …], iCustomer? }
  //   listeners: ordered array of IP+port pairs the service should bind on (required)
  //   iCustomer: trusted-mode customer ID (optional)
  // Returns: { iProtoTransport }
  app.patch('/api/sippy/network-services/:protoTransport', async (req: any, res) => {
    try {
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const iProtoTransport = Number(req.params.protoTransport);
      if (!iProtoTransport || isNaN(iProtoTransport)) {
        return res.status(400).json({ error: 'protoTransport must be a valid integer' });
      }
      const b = req.body ?? {};
      if (!Array.isArray(b.listeners)) {
        return res.status(400).json({ error: 'listeners (array of {ipAddress, port}) is required' });
      }
      const listeners: sippy.SippyNetworkServiceListener[] = b.listeners.map((l: any) => ({
        ipAddress: String(l.ipAddress ?? l.ip_address ?? ''),
        port:      Number(l.port),
      }));
      const iCustomer = b.iCustomer !== undefined ? Number(b.iCustomer) : undefined;
      const result = await sippy.updateNetworkService(username, password, iProtoTransport, listeners, iCustomer);
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/sippy/network-services/:protoTransport — get listeners for one network service
  // Query params: iCustomer (optional, trusted mode)
  // Returns: { iProtoTransport, listeners: [{ ipAddress, port }, …] }
  app.get('/api/sippy/network-services/:protoTransport', async (req: any, res) => {
    try {
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const iProtoTransport = Number(req.params.protoTransport);
      if (!iProtoTransport || isNaN(iProtoTransport)) {
        return res.status(400).json({ error: 'protoTransport must be a valid integer' });
      }
      const iCustomer = req.query.iCustomer ? Number(req.query.iCustomer) : undefined;
      const result = await sippy.getNetworkServiceInfo(username, password, iProtoTransport, iCustomer);
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/sippy/network-services — list all network services
  // Query params: limit?, offset?, iCustomer?
  // Returns: [{ iProtoTransport, listeners: [{ ipAddress, port }, …] }, …]
  app.get('/api/sippy/network-services', async (req: any, res) => {
    try {
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.getNetworkServicesList(
        username, password,
        req.query.limit     ? Number(req.query.limit)     : undefined,
        req.query.offset    ? Number(req.query.offset)    : undefined,
        req.query.iCustomer ? Number(req.query.iCustomer) : undefined,
      );
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Tariffs Management (docs 3000098586) ───────────────────────────────────
  // All routes support trusted mode via iCustomer. Available since Sippy 2020.
  // NOTE: currency and i_tariff_type cannot be changed after tariff creation.

  // POST /api/sippy/tariffs — create a new tariff
  // Body (JSON): { name, currency, iTariffType?, connectFee?, freeSeconds?,
  //               postCallSurcharge?, gracePeriod?, lossProtection?, maxLoss?,
  //               costRoundUp?, decimalPrecision?, averageDuration?,
  //               localCalling?, localCallingCliValidationRule?, iCustomer? }
  // Returns: { iTariff }
  app.post('/api/sippy/tariffs', async (req: any, res) => {
    try {
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const b = req.body ?? {};
      if (!b.name || !b.currency) {
        return res.status(400).json({ error: 'name and currency are required' });
      }
      const result = await sippy.createTariff(username, password, {
        name:                          b.name,
        currency:                      b.currency,
        iTariffType:                   b.iTariffType      !== undefined ? Number(b.iTariffType)      : undefined,
        connectFee:                    b.connectFee       !== undefined ? Number(b.connectFee)       : undefined,
        freeSeconds:                   b.freeSeconds      !== undefined ? Number(b.freeSeconds)      : undefined,
        postCallSurcharge:             b.postCallSurcharge !== undefined ? Number(b.postCallSurcharge) : undefined,
        gracePeriod:                   b.gracePeriod      !== undefined ? Number(b.gracePeriod)      : undefined,
        lossProtection:                b.lossProtection   !== undefined ? Boolean(b.lossProtection)  : undefined,
        maxLoss:                       b.maxLoss          !== undefined ? Number(b.maxLoss)          : undefined,
        costRoundUp:                   b.costRoundUp      !== undefined ? Boolean(b.costRoundUp)     : undefined,
        decimalPrecision:              b.decimalPrecision !== undefined ? Number(b.decimalPrecision) : undefined,
        averageDuration:               b.averageDuration  !== undefined ? Number(b.averageDuration)  : undefined,
        localCalling:                  b.localCalling     !== undefined ? Boolean(b.localCalling)    : undefined,
        localCallingCliValidationRule: b.localCallingCliValidationRule as string | undefined,
        iCustomer:                     b.iCustomer        !== undefined ? Number(b.iCustomer)        : undefined,
      });
      res.status(201).json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // PATCH /api/sippy/tariffs/:id — update an existing tariff
  // Body: same optional fields as POST except name is also optional; currency+iTariffType ignored
  // Returns: 204 No Content on success
  app.patch('/api/sippy/tariffs/:id', async (req: any, res) => {
    try {
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const iTariff = Number(req.params.id);
      if (!iTariff || isNaN(iTariff)) return res.status(400).json({ error: 'id must be a valid integer' });
      const b = req.body ?? {};
      await sippy.updateTariff(username, password, iTariff, {
        name:                          b.name                          as string | undefined,
        connectFee:                    b.connectFee       !== undefined ? Number(b.connectFee)       : undefined,
        freeSeconds:                   b.freeSeconds      !== undefined ? Number(b.freeSeconds)      : undefined,
        postCallSurcharge:             b.postCallSurcharge !== undefined ? Number(b.postCallSurcharge) : undefined,
        gracePeriod:                   b.gracePeriod      !== undefined ? Number(b.gracePeriod)      : undefined,
        lossProtection:                b.lossProtection   !== undefined ? Boolean(b.lossProtection)  : undefined,
        maxLoss:                       b.maxLoss          !== undefined ? Number(b.maxLoss)          : undefined,
        costRoundUp:                   b.costRoundUp      !== undefined ? Boolean(b.costRoundUp)     : undefined,
        decimalPrecision:              b.decimalPrecision !== undefined ? Number(b.decimalPrecision) : undefined,
        averageDuration:               b.averageDuration  !== undefined ? Number(b.averageDuration)  : undefined,
        localCalling:                  b.localCalling     !== undefined ? Boolean(b.localCalling)    : undefined,
        localCallingCliValidationRule: b.localCallingCliValidationRule  as string | undefined,
        iCustomer:                     b.iCustomer        !== undefined ? Number(b.iCustomer)        : undefined,
      });
      res.status(204).end();
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // DELETE /api/sippy/tariffs/:id — delete a tariff
  // Query params: iCustomer (optional)
  // Returns: 204 No Content on success
  app.delete('/api/sippy/tariffs/:id', async (req: any, res) => {
    try {
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const iTariff = Number(req.params.id);
      if (!iTariff || isNaN(iTariff)) return res.status(400).json({ error: 'id must be a valid integer' });
      const iCustomer = req.query.iCustomer ? Number(req.query.iCustomer) : undefined;
      await sippy.deleteTariff(username, password, iTariff, iCustomer);
      res.status(204).end();
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/sippy/tariffs/:id — get full tariff parameters
  // Query params: iCustomer (optional)
  // Returns: SippyTariff — full struct with all fields including extra catch-all
  app.get('/api/sippy/tariffs/:id', async (req: any, res) => {
    try {
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const iTariff = Number(req.params.id);
      if (!iTariff || isNaN(iTariff)) return res.status(400).json({ error: 'id must be a valid integer' });
      const iCustomer = req.query.iCustomer ? Number(req.query.iCustomer) : undefined;
      const result = await sippy.getTariffInfo(username, password, iTariff, iCustomer);
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/sippy/tariffs — list tariffs (lightweight: iTariff, name, currency, iTariffType)
  // Query params: namePattern?, offset?, limit?, iCustomer?
  //   namePattern: SQL ILIKE pattern (e.g. 'USD%')
  // Returns: SippyTariffListEntry[]
  app.get('/api/sippy/tariffs', async (req: any, res) => {
    try {
      const settings = await storage.getSettings();
      const result = await withSippyCredsRaw(
        settings,
        (u, p) => sippy.getTariffsList(
          u, p,
          req.query.namePattern as string | undefined,
          req.query.offset      ? Number(req.query.offset)    : undefined,
          req.query.limit       ? Number(req.query.limit)     : undefined,
          req.query.iCustomer   ? Number(req.query.iCustomer) : undefined,
        ),
        [],
      );
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Tariff Rates (docs 3000118878) ─────────────────────────────────────────

  // GET /api/sippy/tariffs/:id/rates — list rates in a tariff (full official fields)
  // Available since Sippy 2022.
  // Query params: offset?, limit? (1–1000, default 50), iCustomer?
  // Returns: SippyTariffRate[] — i_rate, prefix, price_1/n, interval_1/n, forbidden,
  //   grace_period_enable, activation_date, expiration_date
  //   + local-calling fields when applicable (local_price_1/n, local_interval_1/n, area_name)
  app.get('/api/sippy/tariffs/:id/rates', async (req: any, res) => {
    try {
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const iTariff = Number(req.params.id);
      if (!iTariff || isNaN(iTariff)) return res.status(400).json({ error: 'id must be a valid integer' });
      const result = await sippy.getTariffRatesListFull(
        username, password,
        iTariff,
        req.query.offset    ? Number(req.query.offset)    : undefined,
        req.query.limit     ? Number(req.query.limit)     : undefined,
        req.query.iCustomer ? Number(req.query.iCustomer) : undefined,
      );
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // DELETE /api/sippy/tariffs/:id/rates — delete ALL rates in a tariff in one call
  // Available since Sippy 2024.
  // Query params: iCustomer (optional)
  // Returns: 204 No Content on success
  app.delete('/api/sippy/tariffs/:id/rates', async (req: any, res) => {
    try {
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const iTariff = Number(req.params.id);
      if (!iTariff || isNaN(iTariff)) return res.status(400).json({ error: 'id must be a valid integer' });
      const iCustomer = req.query.iCustomer ? Number(req.query.iCustomer) : undefined;
      await sippy.deleteAllRatesInTariff(username, password, iTariff, iCustomer);
      res.status(204).end();
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/sippy/asr-report — ASR/ACD report computed from Sippy CDRs
  app.get('/api/sippy/asr-report', async (req, res) => {
    try {
      const settings = await storage.getSettings();
      const credPairs = sippyXmlCredsPairs(settings);
      const limit  = Number(req.query.limit) || 2000;
      // groupBy: 'caller' (CLI) | 'callee' (CLD) | 'country' | 'destination' (area_name)
      const groupBy = (req.query.groupBy as string) || 'caller';
      const opts: Parameters<typeof sippy.getSippyCDRs>[3] = {};
      if (req.query.startDate) opts.startDate = req.query.startDate as string;
      if (req.query.endDate)   opts.endDate   = req.query.endDate   as string;
      if (req.query.cli)       opts.cli       = req.query.cli as string;
      if (req.query.cld)       opts.cld       = req.query.cld as string;
      // Try each credential pair (handles swapped settings in DB)
      let cdrs: Awaited<ReturnType<typeof sippy.getSippyCDRs>> = [];
      for (const { username, password } of credPairs) {
        cdrs = await sippy.getSippyCDRs(username, password, limit, { ...opts });
        if (cdrs.length > 0) break;
      }
      if (cdrs.length === 0) return res.json({ rows: [], source: 'sippy-cdr', count: 0 });

      // Group CDRs by selected dimension
      type GroupStats = {
        totalCalls: number; answeredCalls: number;
        billedSecs: number; pddSum: number; pddCount: number;
        totalCost: number; totalConnectFee: number;
      };
      const grouped = new Map<string, GroupStats>();

      for (const cdr of cdrs) {
        let key: string;
        if (groupBy === 'country')     key = cdr.country   || 'Unknown';
        else if (groupBy === 'callee') key = cdr.callee     || '-';
        else if (groupBy === 'destination') key = cdr.areaName || cdr.country || 'Unknown';
        else                           key = cdr.caller     || '-';

        if (!grouped.has(key)) grouped.set(key, {
          totalCalls: 0, answeredCalls: 0,
          billedSecs: 0, pddSum: 0, pddCount: 0,
          totalCost: 0, totalConnectFee: 0,
        });
        const g = grouped.get(key)!;
        g.totalCalls++;
        // A call is answered if billed_duration > 0 OR result code 200/ANSWERED
        const answered = (cdr.duration > 0) || /^(200|ok|answered|success)/i.test(cdr.result || '');
        if (answered) {
          g.answeredCalls++;
          g.billedSecs += cdr.duration;
        }
        if (cdr.pdd != null && cdr.pdd >= 0) { g.pddSum += cdr.pdd; g.pddCount++; }
        g.totalCost        += cdr.cost        || 0;
        g.totalConnectFee  += cdr.connectFee  || 0;
      }

      const rows = Array.from(grouped.entries()).map(([label, g]) => ({
        caller: label,              // "caller" field is used by frontend as the row label
        totalCalls:           g.totalCalls,
        billableCalls:        g.answeredCalls,
        billedDurationSeconds: g.billedSecs,
        acdSeconds:  g.answeredCalls > 0 ? g.billedSecs / g.answeredCalls : 0,
        asr:         g.totalCalls   > 0 ? (g.answeredCalls / g.totalCalls) * 100 : 0,
        avgPdd:      g.pddCount     > 0 ? g.pddSum / g.pddCount : 0,
        totalCost:   g.totalCost,
        connectFee:  g.totalConnectFee,
        revenueUsd:  0,   // filled by client if rate data available
      }));

      rows.sort((a, b) => b.totalCalls - a.totalCalls);
      res.json({ rows, source: 'sippy-cdr', count: cdrs.length });
    } catch (err: any) {
      res.json({ rows: [], error: err.message, source: 'sippy-cdr', count: 0 });
    }
  });

  // GET /api/sippy/routing-groups — list routing groups from Sippy
  app.get('/api/sippy/routing-groups', async (req: any, res) => {
    try {
      const settings = await storage.getSettings();
      // Prefer inline creds (from form), then admin API creds, then portal creds
      let { username, password } = sippyXmlCreds(settings);
      username = (req.query.inlineUser as string) || username;
      password = (req.query.inlinePass as string) || password;
      let portalUrl: string | undefined = (req.query.inlineUrl as string) || sippyPortalUrl(settings);
      if (req.query.switchId) {
        const sw = (await storage.getSwitches()).find((s: any) => s.id === Number(req.query.switchId) && s.type === 'sippy');
        if (sw) { ({ username, password } = sippyXmlCreds(settings, sw)); portalUrl = sw.portalUrl ?? undefined; }
      }
      const result = await sippy.listSippyRoutingGroups(username, password, portalUrl);
      res.json(result);
    } catch (err: any) {
      res.json({ groups: [], error: err.message });
    }
  });

  // GET /api/sippy/tariffs — list tariffs from Sippy
  app.get('/api/sippy/tariffs', async (req: any, res) => {
    try {
      const settings = await storage.getSettings();
      let { username, password } = sippyXmlCreds(settings);
      username = (req.query.inlineUser as string) || username;
      password = (req.query.inlinePass as string) || password;
      let portalUrl: string | undefined = (req.query.inlineUrl as string) || sippyPortalUrl(settings);
      if (req.query.switchId) {
        const sw = (await storage.getSwitches()).find((s: any) => s.id === Number(req.query.switchId) && s.type === 'sippy');
        if (sw) { ({ username, password } = sippyXmlCreds(settings, sw)); portalUrl = sw.portalUrl ?? undefined; }
      }
      const result = await sippy.listSippyTariffs(username, password, portalUrl);
      res.json(result);
    } catch (err: any) {
      res.json({ tariffs: [], error: err.message });
    }
  });

  // GET /api/sippy/dictionaries/:name — fetch a Sippy system dictionary
  // Supports: currencies, timezones, protocols, tariff_types, media_relay_types,
  //           media_relays, trunk_policies, qmon_actions, export_types, etc.
  // For 'languages', pass ?type=web or ?type=ivr as an extra query param.
  app.get('/api/sippy/dictionaries/:name', async (req: any, res) => {
    try {
      const settings = await storage.getSettings();
      let { username, password } = sippyXmlCreds(settings);
      let portalUrl: string | undefined = sippyPortalUrl(settings);
      if (req.query.switchId) {
        const sw = (await storage.getSwitches()).find((s: any) => s.id === Number(req.query.switchId) && s.type === 'sippy');
        if (sw) { ({ username, password } = sippyXmlCreds(settings, sw)); portalUrl = sw.portalUrl ?? undefined; }
      }
      // Pass any extra query params (e.g. type=web for languages) to the API
      const { switchId: _s, ...extra } = req.query as Record<string, string>;
      const result = await sippy.getSippyDictionary(req.params.name, username, password, portalUrl, extra);
      res.json(result);
    } catch (err: any) {
      res.json({ entries: [], error: err.message });
    }
  });

  // GET /api/sippy/billing-plans — list billing plans (Service Plans) from Sippy
  app.get('/api/sippy/billing-plans', async (req: any, res) => {
    try {
      const settings = await storage.getSettings();
      const portalUrl: string = (req.query.inlineUrl as string) || sippyPortalUrl(settings);

      // Inline credentials (wizard's "test connection" flow)
      if (req.query.inlineUser && req.query.inlinePass) {
        const result = await sippy.listSippyBillingPlans(req.query.inlineUser as string, req.query.inlinePass as string, portalUrl);
        return res.json(result);
      }

      // switchId override
      if (req.query.switchId) {
        const sw = (await storage.getSwitches()).find((s: any) => s.id === Number(req.query.switchId) && s.type === 'sippy');
        if (sw) {
          const { username, password } = sippyXmlCreds(settings, sw);
          const result = await sippy.listSippyBillingPlans(username, password, sw.portalUrl ?? portalUrl);
          return res.json(result);
        }
      }

      // Default: try ALL credential pairs until one returns actual plans.
      // RTST1 may not have access to billing plan APIs (gets 401 on getServicePlanInfo);
      // ssp-root (admin) will succeed.  Try every pair in order.
      const credPairs = sippyXmlCredsPairs(settings);
      let bpResult = { plans: [] as { id: number; name: string; currency?: string }[], error: 'No credentials.' };
      for (const creds of credPairs) {
        const r = await sippy.listSippyBillingPlans(creds.username, creds.password, portalUrl);
        if (r.plans.length > 0) { bpResult = r; break; }
        bpResult = r; // keep last result (best error message)
      }
      res.json(bpResult);
    } catch (err: any) {
      res.json({ plans: [], error: err.message });
    }
  });

  // POST /api/sippy/accounts — create a new Sippy customer account directly on the switch
  app.post('/api/sippy/accounts', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req, res) => {
    try {
      const settings = await storage.getSettings();
      // Support inline credentials passed directly in the request body (when no switch configured)
      let username = (req.body.inlineUser as string) || '';
      let password = (req.body.inlinePass as string) || '';
      let targetUrl: string | undefined = (req.body.inlineUrl as string) || undefined;

      if (!username || !password || !targetUrl) {
        // Always prefer admin XML-RPC credentials — they are needed for createAccount()
        const { username: adminUser, password: adminPass } = sippyXmlCreds(settings);
        username = adminUser;
        password = adminPass;
        targetUrl = sippyPortalUrl(settings);
        if (req.body.switchId) {
          const sw = (await storage.getSwitches()).find((s: any) => s.id === Number(req.body.switchId) && s.type === 'sippy');
          if (!sw) return res.status(404).json({ success: false, message: 'Sippy switch not found.' });
          // Use the switch URL but keep admin credentials for XML-RPC access
          targetUrl = sw.portalUrl ?? targetUrl;
          // Only override credentials if the switch has its own dedicated admin creds
          const swCreds = sippyXmlCreds(settings, sw);
          if (swCreds.username !== username) {
            username = swCreds.username;
            password = swCreds.password;
          }
        }
      }
      const opts: sippy.SippyAccountOpts = {
        name:               req.body.name,
        type:               req.body.type ?? 'client',
        // SIP credentials
        username:           req.body.username     || undefined,
        authname:           req.body.authname     || undefined,
        voipPassword:       req.body.voipPassword || undefined,
        webPassword:        req.body.webPassword  || undefined,
        // Network
        ipAddress:          req.body.ipAddress,
        ratePerMin:         req.body.ratePerMin !== undefined ? Number(req.body.ratePerMin) : undefined,
        // Billing
        creditLimit:        req.body.creditLimit   !== undefined ? Number(req.body.creditLimit)   : undefined,
        balance:            req.body.balance        !== undefined ? Number(req.body.balance)        : undefined,
        lifetime:           req.body.lifetime       !== undefined ? Number(req.body.lifetime)       : undefined,
        // Advanced
        maxSessions:        req.body.maxSessions    !== undefined ? Number(req.body.maxSessions)    : undefined,
        maxCallsPerSecond:  req.body.maxCallsPerSecond !== undefined ? Number(req.body.maxCallsPerSecond) : undefined,
        maxSessionTime:     req.body.maxSessionTime !== undefined ? Number(req.body.maxSessionTime) : undefined,
        timezone:           req.body.timezone,
        language:           req.body.language,
        routingGroup:       req.body.routingGroup,
        servicePlan:        req.body.servicePlan,
        cliTranslationRule: req.body.cliTranslationRule,
        cldTranslationRule: req.body.cldTranslationRule,
        // SIP behaviour
        preferredCodec:     req.body.preferredCodec !== undefined
                              ? (req.body.preferredCodec === null ? null : Number(req.body.preferredCodec))
                              : undefined,
        regAllowed:         req.body.regAllowed    !== undefined ? Number(req.body.regAllowed)  : undefined,
        trustCli:           req.body.trustCli      !== undefined ? Number(req.body.trustCli)    : undefined,
        // Contact
        companyName:        req.body.companyName,
        firstName:          req.body.firstName     || undefined,
        lastName:           req.body.lastName      || undefined,
        email:              req.body.email         || undefined,
        country:            req.body.country       || undefined,
        description:        req.body.description,
        currency:           req.body.currency      || undefined,
      };
      if (!opts.name) return res.status(400).json({ success: false, message: 'Account name is required.' });
      // Additional opts from wizard
      const body = req.body;
      if (body.disallowLoops !== undefined)        opts.disallowLoops          = !!body.disallowLoops;
      if (body.usePreferredCodecOnly !== undefined) opts.usePreferredCodecOnly  = !!body.usePreferredCodecOnly;
      if (body.passPAssertedId !== undefined)       opts.passPAssertedId        = !!body.passPAssertedId;
      if (body.pAssrtIdTranslationRule)             opts.pAssrtIdTranslationRule = String(body.pAssrtIdTranslationRule);
      if (body.maxSessionTime !== undefined)        opts.maxSessionTime         = Number(body.maxSessionTime);
      if (body.phone)                               opts.phone                  = String(body.phone);
      if (body.fax)                                 opts.fax                    = String(body.fax);
      if (body.cc)                                  opts.cc                     = String(body.cc);
      if (body.bcc)                                 opts.bcc                    = String(body.bcc);

      // ── Try account creation with all credential pairs on auth failure ──────
      // createAccount() requires admin-level credentials (ssp-root), but the
      // sippyXmlCreds() helper returns apiAdminUsername (RTST1) first which may be
      // read-only.  Retry transparently with every configured pair until one works.
      let result = await sippy.pushAccountToSippy(opts, { username, password }, targetUrl);
      if (!result.success && !req.body.inlineUser) {
        const errDetail = (result.detail ?? result.message ?? '').toLowerCase();
        const isAuthFail = errDetail.includes('authentication') || errDetail.includes('401')
          || errDetail.includes('access denied') || errDetail.includes('check sippy');
        if (isAuthFail) {
          const allPairs = sippyXmlCredsPairs(settings);
          for (const creds of allPairs) {
            if (creds.username === username) continue;  // already tried this one
            console.log(`[routes] createAccount: auth failed for "${username}", retrying with "${creds.username}"`);
            result = await sippy.pushAccountToSippy(opts, creds, targetUrl);
            if (result.success) break;
          }
        }
      }

      // After successful creation — add extra IP auth rules and set low-balance alert
      if (result.success && result.i_account) {
        const iAccount = result.i_account;
        const extraIps: string[] = [];
        if (Array.isArray(body.ipAddresses)) extraIps.push(...body.ipAddresses);
        else if (typeof body.ipAddresses === 'string' && body.ipAddresses.trim()) {
          extraIps.push(...body.ipAddresses.split(',').map((s: string) => s.trim()).filter(Boolean));
        }
        // First IP was already added via ipAddress in opts; add extras
        const firstIp = String(opts.ipAddress ?? '').trim();
        const ipsToAdd = extraIps.filter(ip => ip && ip !== firstIp);
        for (const ip of ipsToAdd) {
          await sippy.addSippyAuthRule(username, password, { iAccount, iProtocol: 1, remoteIp: ip }, targetUrl);
        }
        // Balance threshold / alert email
        if (body.balanceThreshold !== undefined || body.alertEmailTo) {
          await sippy.setSippyLowBalance(username, password, {
            iAccount,
            ...(body.balanceThreshold !== undefined ? { threshold: Number(body.balanceThreshold) } : {}),
            ...(body.alertEmailTo ? { notifyByEmail: 1 } : {}),
          }, targetUrl);
        }
        result.extraAuthRules = ipsToAdd.length;
      }

      res.json(result);
      regenDataflowDoc();
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message ?? 'Failed to create Sippy account.' });
    }
  });

  // GET /api/sippy/stats — Sippy call counters
  app.get('/api/sippy/stats', async (_req, res) => {
    const settings = await storage.getSettings();
    const { username, password } = sippyXmlCreds(settings);
    const stats = await sippy.getSippyStats(username, password);
    res.json(stats);
  });

  // ── Sippy User Management ──────────────────────────────────────────────────

  // GET /api/sippy/users?switchId=<id> — list portal users (optional switchId for secondary switches)
  app.get('/api/sippy/users', async (req, res) => {
    try {
      const settings = await storage.getSettings();
      let username = settings.portalUsername ?? '';
      let password = settings.portalPassword ?? '';
      let portalUrl: string | undefined = undefined;
      if (req.query.switchId) {
        const sw = (await storage.getSwitches()).find(s => s.id === Number(req.query.switchId) && s.type === 'sippy');
        if (!sw) return res.status(404).json({ users: [], error: 'Switch not found.' });
        username = sw.portalUsername ?? '';
        password = sw.portalPassword ?? '';
        portalUrl = sw.portalUrl ?? undefined;
      }
      const result = await sippy.listSippyUsers(username, password, portalUrl);
      res.json(result);
    } catch (err: any) { res.status(500).json({ users: [], error: err.message }); }
  });

  // POST /api/sippy/users — create a new Sippy portal user
  app.post('/api/sippy/users', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req, res) => {
    try {
      const settings = await storage.getSettings();
      let username = settings.portalUsername ?? '';
      let password = settings.portalPassword ?? '';
      let portalUrl: string | undefined = undefined;
      const { switchId, ...userData } = req.body;
      if (switchId) {
        const sw = (await storage.getSwitches()).find(s => s.id === Number(switchId) && s.type === 'sippy');
        if (sw) { username = sw.portalUsername ?? ''; password = sw.portalPassword ?? ''; portalUrl = sw.portalUrl ?? undefined; }
      }
      const result = await sippy.addSippyUser(username, password, userData, portalUrl);
      res.json(result);
    } catch (err: any) { res.status(500).json({ success: false, message: err.message }); }
  });

  // PATCH /api/sippy/users/:id — update a Sippy portal user
  app.patch('/api/sippy/users/:id', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req, res) => {
    try {
      const settings = await storage.getSettings();
      let username = settings.portalUsername ?? '';
      let password = settings.portalPassword ?? '';
      let portalUrl: string | undefined = undefined;
      const { switchId, ...userData } = req.body;
      if (switchId) {
        const sw = (await storage.getSwitches()).find(s => s.id === Number(switchId) && s.type === 'sippy');
        if (sw) { username = sw.portalUsername ?? ''; password = sw.portalPassword ?? ''; portalUrl = sw.portalUrl ?? undefined; }
      }
      const result = await sippy.updateSippyUser(username, password, req.params.id, userData, portalUrl);
      res.json(result);
    } catch (err: any) { res.status(500).json({ success: false, message: err.message }); }
  });

  // DELETE /api/sippy/users/:id — delete a Sippy portal user
  app.delete('/api/sippy/users/:id', (req: any, res, next) => requireRole(['admin'], req, res, next), async (req, res) => {
    try {
      const settings = await storage.getSettings();
      let username = settings.portalUsername ?? '';
      let password = settings.portalPassword ?? '';
      let portalUrl: string | undefined = undefined;
      if (req.query.switchId) {
        const sw = (await storage.getSwitches()).find(s => s.id === Number(req.query.switchId) && s.type === 'sippy');
        if (sw) { username = sw.portalUsername ?? ''; password = sw.portalPassword ?? ''; portalUrl = sw.portalUrl ?? undefined; }
      }
      const result = await sippy.deleteSippyUser(username, password, req.params.id, portalUrl);
      res.json(result);
    } catch (err: any) { res.status(500).json({ success: false, message: err.message }); }
  });

  // ASR/ACD Report — built from live Sippy CDRs (not local DB)
  app.get('/api/reports/asr-acd', async (req, res) => {
    try {
      const settings = await storage.getSettings();
      const credPairs = sippyXmlCredsPairs(settings);

      const {
        cli, cld, startTime, endTime,
        groupBy = 'caller', sortBy = 'totalCalls', hideEmpty,
      } = req.query as Record<string, string>;

      // Fetch a large CDR window from Sippy (type=all for true ASR: answered + unanswered)
      const CDR_LIMIT = 5000;
      const cdrOpts: Parameters<typeof sippy.getSippyCDRs>[3] = { type: 'all' };
      if (startTime) cdrOpts.startDate = startTime;
      if (endTime)   cdrOpts.endDate   = endTime;
      if (cli)       cdrOpts.cli       = cli;
      if (cld)       cdrOpts.cld       = cld;

      // Credential-pair loop — handles swapped settings in production DB
      let cdrs: Awaited<ReturnType<typeof sippy.getSippyCDRs>> = [];
      for (const { username, password } of credPairs) {
        cdrs = await sippy.getSippyCDRs(username, password, CDR_LIMIT, cdrOpts);
        if (cdrs.length > 0) break;
      }

      // Aggregate by groupBy dimension
      type G = {
        totalCalls: number; answeredCalls: number; billedSecs: number;
        pddSum: number; pddCount: number; totalCost: number;
        clientNames: Map<string, number>; // name → frequency
        countries: Map<string, number>;   // country → frequency
      };
      const grouped = new Map<string, G>();

      for (const cdr of cdrs) {
        const key = groupBy === 'callee' ? (cdr.callee || '-') : (cdr.caller || '-');
        if (!grouped.has(key)) grouped.set(key, {
          totalCalls: 0, answeredCalls: 0, billedSecs: 0,
          pddSum: 0, pddCount: 0, totalCost: 0,
          clientNames: new Map(), countries: new Map(),
        });
        const g = grouped.get(key)!;
        g.totalCalls++;
        // Answered = billed duration > 0 (Sippy result=0 means success)
        const answered = (cdr.duration != null && cdr.duration > 0) ||
          /^(0|200|ok|answered|success)/i.test(String(cdr.result ?? ''));
        if (answered) {
          g.answeredCalls++;
          g.billedSecs += cdr.duration ?? 0;
        }
        if (cdr.pdd != null && cdr.pdd >= 0) { g.pddSum += cdr.pdd; g.pddCount++; }
        g.totalCost += cdr.cost ?? 0;
        // Track client name: prefer accountNameCache lookup, fall back to CDR clientName
        const acctName = cdr.iAccount ? accountNameCache.get(String(cdr.iAccount)) : undefined;
        const cname = acctName || cdr.clientName;
        if (cname) g.clientNames.set(cname, (g.clientNames.get(cname) ?? 0) + 1);
        // Track origination country (Sippy CDR country field)
        const ctry = cdr.country;
        if (ctry) g.countries.set(ctry, (g.countries.get(ctry) ?? 0) + 1);
      }

      // Pick most frequent name/country from each group's frequency map
      const topOf = (m: Map<string, number>) =>
        m.size > 0 ? [...m.entries()].sort((a, b) => b[1] - a[1])[0][0] : undefined;

      const shouldHideEmpty = hideEmpty !== 'false';
      let rows = Array.from(grouped.entries())
        .filter(([, g]) => !shouldHideEmpty || g.totalCalls > 0)
        .map(([label, g]) => ({
          caller:                label,
          totalCalls:            g.totalCalls,
          billableCalls:         g.answeredCalls,
          billedDurationSeconds: g.billedSecs,
          acdSeconds:            g.answeredCalls > 0 ? g.billedSecs / g.answeredCalls : 0,
          asr:                   g.totalCalls   > 0 ? (g.answeredCalls / g.totalCalls) * 100 : 0,
          avgPdd:                g.pddCount     > 0 ? g.pddSum / g.pddCount : 0,
          revenueUsd:            0,
          clientName:            topOf(g.clientNames),
          country:               topOf(g.countries),
        }));

      // Sort
      const sortFn: Record<string, (a: typeof rows[0], b: typeof rows[0]) => number> = {
        totalCalls:    (a, b) => b.totalCalls    - a.totalCalls,
        asr:           (a, b) => b.asr           - a.asr,
        billableCalls: (a, b) => b.billableCalls - a.billableCalls,
        revenueUsd:    (a, b) => b.revenueUsd    - a.revenueUsd,
      };
      rows.sort(sortFn[sortBy] ?? sortFn.totalCalls);

      res.json(rows);
    } catch (err) {
      console.error('ASR/ACD report error:', err);
      res.status(500).json({ message: 'Failed to generate report' });
    }
  });

  // ── IP Geolocation / Carrier Lookup ──────────────────────────────────────
  // GET /api/ip-lookup?ip=x.x.x.x  — country + ISP/carrier info via ip-api.com
  // Results cached in memory for 1 hour to avoid repeated external calls.
  const ipLookupCache = new Map<string, { data: Record<string, string>; expiresAt: number }>();

  app.get('/api/ip-lookup', async (req, res) => {
    const ip = (req.query.ip as string || '').trim();
    if (!ip) return res.status(400).json({ error: 'ip parameter required' });

    // Return cached result if still fresh
    const cached = ipLookupCache.get(ip);
    if (cached && Date.now() < cached.expiresAt) return res.json(cached.data);

    try {
      const response = await fetch(
        `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,countryCode,regionName,city,isp,org,as,query`
      );
      if (!response.ok) throw new Error(`ip-api.com returned ${response.status}`);
      const data = await response.json() as Record<string, string>;
      // Cache for 1 hour regardless of success/failure status
      ipLookupCache.set(ip, { data, expiresAt: Date.now() + 3600_000 });
      res.json(data);
    } catch (err) {
      res.status(502).json({ status: 'fail', error: String(err), query: ip });
    }
  });

  // ── Trunk Management Routes (docs 3000116551) ─────────────────────────────
  // GET  /api/sippy/trunks?iAccount=xxx        — list trunks for an account
  // GET  /api/sippy/trunks/:id                 — get trunk detail
  // POST /api/sippy/trunks                     — create trunk
  // PATCH /api/sippy/trunks/:id                — update trunk
  // DELETE /api/sippy/trunks/:id               — delete trunk

  app.get('/api/sippy/trunks', async (req, res) => {
    try {
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const iAccount = req.query.iAccount ? Number(req.query.iAccount) : 0;
      if (!iAccount) return res.status(400).json({ ok: false, trunks: [], message: 'iAccount required' });
      const result = await sippy.getTrunksList(username, password, {
        iAccount,
        namePattern: req.query.namePattern as string | undefined,
      });
      res.json(result);
    } catch (e: any) { res.status(500).json({ ok: false, trunks: [], message: e.message }); }
  });

  app.get('/api/sippy/trunks/:id', async (req, res) => {
    try {
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.getTrunkInfo(username, password, { iTrunk: Number(req.params.id) });
      res.json(result);
    } catch (e: any) { res.status(500).json({ ok: false, message: e.message }); }
  });

  app.post('/api/sippy/trunks', async (req, res) => {
    try {
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const { iAccount, name, description, policy } = req.body;
      if (!iAccount || !name) return res.status(400).json({ ok: false, message: 'iAccount and name required' });
      const result = await sippy.createTrunk(username, password, { iAccount: Number(iAccount), name, description, policy });
      res.json(result);
    } catch (e: any) { res.status(500).json({ ok: false, message: e.message }); }
  });

  app.patch('/api/sippy/trunks/:id', async (req, res) => {
    try {
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.updateTrunk(username, password, { iTrunk: Number(req.params.id), ...req.body });
      res.json(result);
    } catch (e: any) { res.status(500).json({ ok: false, message: e.message }); }
  });

  app.delete('/api/sippy/trunks/:id', async (req, res) => {
    try {
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.deleteTrunk(username, password, Number(req.params.id));
      res.json(result);
    } catch (e: any) { res.status(500).json({ ok: false, message: e.message }); }
  });

  // ── Trunk Connection Routes (docs 3000116552) ──────────────────────────────
  // GET  /api/sippy/trunk-connections?iTrunk=xxx   — list connections for a trunk
  // GET  /api/sippy/trunk-connections/:id           — get connection detail
  // POST /api/sippy/trunk-connections               — create connection
  // PATCH /api/sippy/trunk-connections/:id          — update connection
  // DELETE /api/sippy/trunk-connections/:id         — delete connection

  app.get('/api/sippy/trunk-connections', async (req, res) => {
    try {
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const iTrunk = req.query.iTrunk ? Number(req.query.iTrunk) : 0;
      if (!iTrunk) return res.status(400).json({ ok: false, trunkConnections: [], message: 'iTrunk required' });
      const result = await sippy.getTrunkConnectionsList(username, password, {
        iTrunk,
        namePattern: req.query.namePattern as string | undefined,
      });
      res.json(result);
    } catch (e: any) { res.status(500).json({ ok: false, trunkConnections: [], message: e.message }); }
  });

  app.get('/api/sippy/trunk-connections/:id', async (req, res) => {
    try {
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.getTrunkConnectionInfo(username, password, { iTrunkConnection: Number(req.params.id) });
      res.json(result);
    } catch (e: any) { res.status(500).json({ ok: false, message: e.message }); }
  });

  app.post('/api/sippy/trunk-connections', async (req, res) => {
    try {
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const { iTrunk, name, destination, ...rest } = req.body;
      if (!iTrunk || !name || !destination) return res.status(400).json({ ok: false, message: 'iTrunk, name, and destination required' });
      const result = await sippy.createTrunkConnection(username, password, {
        iTrunk: Number(iTrunk), name, destination,
        orderNo: rest.orderNo, trunkUsername: rest.username,
        password: rest.password, outboundIp: rest.outboundIp,
        outboundCld: rest.outboundCld, iProtoTransport: rest.iProtoTransport ? Number(rest.iProtoTransport) : undefined,
        iPrivacyMode: rest.iPrivacyMode ? Number(rest.iPrivacyMode) : undefined,
        trustedPrivacyDomain: rest.trustedPrivacyDomain, usePrivIdAsCli: rest.usePrivIdAsCli,
        useAssertedId: rest.useAssertedId, assertedIdTranslation: rest.assertedIdTranslation,
        enableDiversion: rest.enableDiversion, huntstopScodes: rest.huntstopScodes,
        blocked: rest.blocked, capacity: rest.capacity,
        maxCps: rest.maxCps, fromDomain: rest.fromDomain, randomCallId: rest.randomCallId,
      });
      res.json(result);
    } catch (e: any) { res.status(500).json({ ok: false, message: e.message }); }
  });

  app.patch('/api/sippy/trunk-connections/:id', async (req, res) => {
    try {
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const body = req.body;
      const result = await sippy.updateTrunkConnection(username, password, {
        iTrunkConnection: Number(req.params.id),
        name: body.name, destination: body.destination, orderNo: body.orderNo,
        trunkUsername: body.username, password: body.password,
        outboundIp: body.outboundIp, outboundCld: body.outboundCld,
        iProtoTransport: body.iProtoTransport ? Number(body.iProtoTransport) : undefined,
        iPrivacyMode: body.iPrivacyMode ? Number(body.iPrivacyMode) : undefined,
        trustedPrivacyDomain: body.trustedPrivacyDomain, usePrivIdAsCli: body.usePrivIdAsCli,
        useAssertedId: body.useAssertedId, assertedIdTranslation: body.assertedIdTranslation,
        enableDiversion: body.enableDiversion, huntstopScodes: body.huntstopScodes,
        blocked: body.blocked, capacity: body.capacity,
        maxCps: body.maxCps, fromDomain: body.fromDomain, randomCallId: body.randomCallId,
      });
      res.json(result);
    } catch (e: any) { res.status(500).json({ ok: false, message: e.message }); }
  });

  app.delete('/api/sippy/trunk-connections/:id', async (req, res) => {
    try {
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.deleteTrunkConnection(username, password, Number(req.params.id));
      res.json(result);
    } catch (e: any) { res.status(500).json({ ok: false, message: e.message }); }
  });

  // GET /api/sippy/rates?tariffId=xxx&switchId=yyy
  app.get('/api/sippy/rates', async (req, res) => {
    try {
      const settings = await storage.getSettings();
      const tariffId = String(req.query.tariffId || '');
      const switchId = req.query.switchId ? Number(req.query.switchId) : null;
      let portalUrl = sippyPortalUrl(settings);
      let { username: u, password: p } = sippyXmlCreds(settings);
      if (switchId) {
        const sw = (await storage.getSwitches()).find(s => s.id === switchId && s.type === 'sippy');
        if (sw) {
          portalUrl = sw.portalUrl ?? portalUrl;
          const swCreds = sippyXmlCreds(settings, sw);
          u = swCreds.username; p = swCreds.password;
        }
      }
      if (!tariffId) return res.json({ rates: [], error: 'tariffId required' });
      const result = await sippy.getSippyRateList(u, p, tariffId, portalUrl);
      res.json(result);
    } catch (e: any) { res.status(500).json({ rates: [], error: e.message }); }
  });

  // POST /api/sippy/rates — add or update a single rate entry
  // Uses admin XML-RPC credentials (sippyXmlCreds) — portal creds lack rate-write permissions
  app.post('/api/sippy/rates', async (req, res) => {
    try {
      const settings = await storage.getSettings();
      const { tariffId, prefix, rate, effectiveFrom, effectiveTill, switchId } = req.body;
      let portalUrl = sippyPortalUrl(settings);
      // Always use admin XML-RPC creds for rate management — portal user lacks write access
      let { username: u, password: p } = sippyXmlCreds(settings);
      if (switchId) {
        const sw = (await storage.getSwitches()).find(s => s.id === Number(switchId) && s.type === 'sippy');
        if (sw) {
          portalUrl = sw.portalUrl ?? portalUrl;
          const swCreds = sippyXmlCreds(settings, sw);
          u = swCreds.username;
          p = swCreds.password;
        }
      }
      if (!tariffId || !prefix || rate === undefined) return res.status(400).json({ success: false, message: 'tariffId, prefix, rate required' });
      const result = await sippy.setSippyRateEntry(u, p, tariffId, { prefix, rate: Number(rate), effectiveFrom, effectiveTill }, portalUrl);
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // DELETE /api/sippy/rates — remove a rate entry
  app.delete('/api/sippy/rates', async (req, res) => {
    try {
      const settings = await storage.getSettings();
      const { tariffId, prefix, switchId } = req.body;
      let portalUrl = sippyPortalUrl(settings);
      let u = settings.portalUsername ?? '';
      let p = settings.portalPassword ?? '';
      if (switchId) {
        const sw = (await storage.getSwitches()).find(s => s.id === switchId);
        if (sw) { portalUrl = sw.portalUrl ?? undefined; u = sw.portalUsername ?? ''; p = sw.portalPassword ?? ''; }
      }
      if (!tariffId || !prefix) return res.status(400).json({ success: false, message: 'tariffId and prefix required' });
      const result = await sippy.deleteSippyRateEntry(u, p, tariffId, prefix, portalUrl);
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // GET /api/sippy/tariffs — list tariff plans (products)
  app.get('/api/sippy/tariffs', async (_req, res) => {
    try {
      const settings = await storage.getSettings();
      const tariffs = await sippy.getSippyTariffList(settings.portalUsername ?? '', settings.portalPassword ?? '');
      res.json({ tariffs });
    } catch (e: any) { res.status(500).json({ tariffs: [], error: e.message }); }
  });

  // GET /api/sippy/carrier-list — list carriers/nodes
  app.get('/api/sippy/carrier-list', async (_req, res) => {
    try {
      const settings = await storage.getSettings();
      const carriers = await sippy.getSippyCarrierList(settings.portalUsername ?? '', settings.portalPassword ?? '');
      res.json({ carriers });
    } catch (e: any) { res.status(500).json({ carriers: [], error: e.message }); }
  });

  // POST /api/sippy/rate-analysis — perform rate analysis
  app.post('/api/sippy/rate-analysis', async (req, res) => {
    try {
      const settings = await storage.getSettings();
      const result = await sippy.getSippyRateAnalysis(
        settings.portalUsername ?? '',
        settings.portalPassword ?? '',
        req.body,
      );
      res.json(result);
    } catch (e: any) { res.status(500).json({ carrierGroups: [], rates: [], error: e.message }); }
  });

  // ── Customer management (official Sippy API) ─────────────────────────────

  // GET /api/sippy/customers — listCustomers() — docs 107423
  // Query params: offset?, limit?, iWholesaler? (trusted mode)
  // Returns: { success, customers: SippyCustomerEntry[], message }
  app.get('/api/sippy/customers', async (req: any, res) => {
    try {
      const { offset, limit, iWholesaler } = req.query ?? {};
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.listSippyCustomers(username, password, {
        offset:      offset      !== undefined ? parseInt(offset as string, 10)      : undefined,
        limit:       limit       !== undefined ? parseInt(limit as string, 10)       : undefined,
        iWholesaler: iWholesaler !== undefined ? parseInt(iWholesaler as string, 10) : undefined,
        portalUrl:   sippyPortalUrl(settings),
      });
      if (!result.success) return res.status(422).json({ success: false, error: result.message });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // POST /api/sippy/customers/authenticate — authCustomer() — docs 107430
  // Body: { username, password } — customer's self-care portal credentials (NOT admin credentials)
  // Returns: { success, iCustomer, iWebUser, iAccessLevel, oneTimePassword, message }
  // NOTE: error 410 from Sippy = authenticated via One Time Password — treated as success with oneTimePassword:true
  app.post('/api/sippy/customers/authenticate', async (req: any, res) => {
    try {
      const { username, password } = req.body ?? {};
      if (!username || !password) {
        return res.status(400).json({ success: false, error: 'username and password are required.' });
      }
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username: adminUser, password: adminPass } = sippyXmlCreds(settings);

      const result = await sippy.authSippyCustomer(adminUser, adminPass, username, password, {
        portalUrl: sippyPortalUrl(settings),
      });
      const statusCode = result.success ? 200 : 401;
      res.status(statusCode).json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // POST /api/sippy/customers/reset-otp — resetCustomerOneTimePassword() — docs 107431
  // Body: { webLogin } — the web login of the customer/user whose OTP to reset
  // Returns: { success, password (new OTP), message }
  // NOTE: The new OTP is returned so it can be delivered to the customer out-of-band.
  //       On their next authCustomer() call, Sippy returns error 410 prompting them to set a real password.
  app.post('/api/sippy/customers/reset-otp', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req: any, res) => {
    try {
      const { webLogin } = req.body ?? {};
      if (!webLogin) return res.status(400).json({ success: false, error: 'webLogin is required.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);

      const result = await sippy.resetSippyCustomerOneTimePassword(username, password, webLogin, {
        portalUrl: sippyPortalUrl(settings),
      });
      if (!result.success) return res.status(400).json({ success: false, error: result.message });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // POST /api/sippy/customers — createCustomer() — docs 107417
  // Body: { name, webPassword, iTariff (number|null), ...optional fields }
  // Returns: { success, iCustomer, message }
  app.post('/api/sippy/customers', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req: any, res) => {
    try {
      const body = req.body ?? {};
      const { name, webPassword, iTariff } = body;
      if (!name)                        return res.status(400).json({ success: false, error: 'name is required.' });
      if (!webPassword)                 return res.status(400).json({ success: false, error: 'webPassword is required.' });
      if (iTariff === undefined)        return res.status(400).json({ success: false, error: 'iTariff is required (use null for own tariff).' });

      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);

      const result = await sippy.createCustomer(username, password, {
        name,
        webPassword,
        iTariff:               iTariff === null ? null : parseInt(iTariff, 10),
        // Contact / Identity
        webLogin:              body.webLogin,
        companyName:           body.companyName,
        salutation:            body.salutation,
        firstName:             body.firstName,
        lastName:              body.lastName,
        midInit:               body.midInit,
        streetAddr:            body.streetAddr,
        state:                 body.state,
        postalCode:            body.postalCode,
        city:                  body.city,
        country:               body.country,
        contact:               body.contact,
        phone:                 body.phone,
        fax:                   body.fax,
        altPhone:              body.altPhone,
        altContact:            body.altContact,
        email:                 body.email,
        cc:                    body.cc,
        bcc:                   body.bcc,
        mailFrom:              body.mailFrom,
        description:           body.description,
        // Billing
        balance:               body.balance          !== undefined ? parseFloat(body.balance)          : undefined,
        creditLimit:           body.creditLimit       !== undefined ? parseFloat(body.creditLimit)       : undefined,
        paymentCurrency:       body.paymentCurrency,
        paymentMethod:         body.paymentMethod     !== undefined ? parseInt(body.paymentMethod, 10)  : undefined,
        minPaymentAmount:      body.minPaymentAmount  !== undefined ? parseFloat(body.minPaymentAmount)  : undefined,
        iCommissionAgent:      body.iCommissionAgent  !== undefined ? parseInt(body.iCommissionAgent, 10) : undefined,
        commissionSize:        body.commissionSize    !== undefined ? parseFloat(body.commissionSize)    : undefined,
        // Routing
        iRoutingGroup:         body.iRoutingGroup     !== undefined ? parseInt(body.iRoutingGroup, 10)  : undefined,
        // Permissions
        accountsMgmt:          body.accountsMgmt      !== undefined ? parseInt(body.accountsMgmt, 10)   : undefined,
        customersMgmt:         body.customersMgmt     !== undefined ? parseInt(body.customersMgmt, 10)  : undefined,
        systemMgmt:            body.systemMgmt        !== undefined ? parseInt(body.systemMgmt, 10)     : undefined,
        tariffsMgmt:           body.tariffsMgmt       !== undefined ? parseInt(body.tariffsMgmt, 10)    : undefined,
        vouchersMgmt:          body.vouchersMgmt      !== undefined ? parseInt(body.vouchersMgmt, 10)   : undefined,
        apiAccess:             body.apiAccess         !== undefined ? parseInt(body.apiAccess, 10)      : undefined,
        apiPassword:           body.apiPassword,
        apiMgmt:               body.apiMgmt           !== undefined ? parseInt(body.apiMgmt, 10)        : undefined,
        // Features
        maxDepth:              body.maxDepth          !== undefined ? parseInt(body.maxDepth, 10)       : undefined,
        useOwnTariff:          body.useOwnTariff      !== undefined ? parseInt(body.useOwnTariff, 10)   : undefined,
        accountsMatchingRule:  body.accountsMatchingRule,
        callshopEnabled:       body.callshopEnabled   !== undefined ? Boolean(body.callshopEnabled)     : undefined,
        overcommitProtection:  body.overcommitProtection !== undefined ? Boolean(body.overcommitProtection) : undefined,
        overcommitLimit:       body.overcommitLimit   !== undefined ? parseFloat(body.overcommitLimit)  : undefined,
        didPoolEnabled:        body.didPoolEnabled     !== undefined ? Boolean(body.didPoolEnabled)      : undefined,
        ivrAppsEnabled:        body.ivrAppsEnabled    !== undefined ? Boolean(body.ivrAppsEnabled)      : undefined,
        asrAcdEnabled:         body.asrAcdEnabled     !== undefined ? Boolean(body.asrAcdEnabled)       : undefined,
        debitCreditCardsEnabled: body.debitCreditCardsEnabled !== undefined ? Boolean(body.debitCreditCardsEnabled) : undefined,
        conferencingEnabled:   body.conferencingEnabled !== undefined ? Boolean(body.conferencingEnabled) : undefined,
        sharePaymentProcessors: body.sharePaymentProcessors !== undefined ? Boolean(body.sharePaymentProcessors) : undefined,
        dnclEnabled:           body.dnclEnabled        !== undefined ? Boolean(body.dnclEnabled)         : undefined,
        // Locale / UI
        iTimeZone:             body.iTimeZone          !== undefined ? parseInt(body.iTimeZone, 10)      : undefined,
        iLang:                 body.iLang,
        iExportType:           body.iExportType        !== undefined ? parseInt(body.iExportType, 10)    : undefined,
        startPage:             body.startPage          !== undefined ? parseInt(body.startPage, 10)      : undefined,
        css:                   body.css,
        dnsAlias:              body.dnsAlias,
        // Rate limits
        maxSessions:           body.maxSessions        !== undefined ? parseInt(body.maxSessions, 10)    : undefined,
        maxCallsPerSecond:     body.maxCallsPerSecond   !== undefined ? parseFloat(body.maxCallsPerSecond) : undefined,
        // Password policy
        iPasswordPolicy:       body.iPasswordPolicy    !== undefined ? parseInt(body.iPasswordPolicy, 10) : undefined,
        // Trusted mode
        iWholesaler:           body.iWholesaler        !== undefined ? parseInt(body.iWholesaler, 10)    : undefined,
      }, sippyPortalUrl(settings));

      if (!result.success) return res.status(422).json({ success: false, error: result.message });
      res.status(201).json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // GET /api/sippy/customers/:id — getCustomerInfo() — docs 107426
  // Query: iWholesaler? (trusted mode) | use :id=name to look up by customer name
  // Returns: { success, customer: SippyCustomerInfo, message }
  // NOTE: balance is automatically corrected (Sippy returns it inverted)
  app.get('/api/sippy/customers/:id', async (req: any, res) => {
    try {
      const { id } = req.params;
      const { iWholesaler } = req.query ?? {};
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);

      // Determine lookup type: numeric = i_customer, string = name
      const numId = parseInt(id, 10);
      const lookup = !isNaN(numId) ? { iCustomer: numId } : { name: id };

      const result = await sippy.getSippyCustomerInfo(username, password, lookup, {
        iWholesaler: iWholesaler !== undefined ? parseInt(iWholesaler as string, 10) : undefined,
        portalUrl:   sippyPortalUrl(settings),
      });
      if (!result.success) return res.status(404).json({ success: false, error: result.message });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // PATCH /api/sippy/customers/:id — updateCustomer() — docs 107419
  // Body: any subset of createCustomer() fields (all optional, at least one required)
  // Returns: { success, message }
  app.patch('/api/sippy/customers/:id', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req: any, res) => {
    try {
      const body = req.body ?? {};
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.updateSippyCustomer(username, password, parseInt(req.params.id, 10), {
        // Mandatory-at-create but optional-at-update
        name:          body.name,
        webPassword:   body.webPassword,
        iTariff:       body.iTariff !== undefined ? (body.iTariff === null ? null : parseInt(body.iTariff, 10)) : undefined,
        // Contact / Identity
        webLogin:      body.webLogin,
        companyName:   body.companyName,
        salutation:    body.salutation,
        firstName:     body.firstName,
        lastName:      body.lastName,
        midInit:       body.midInit,
        streetAddr:    body.streetAddr,
        state:         body.state,
        postalCode:    body.postalCode,
        city:          body.city,
        country:       body.country,
        contact:       body.contact,
        phone:         body.phone,
        fax:           body.fax,
        altPhone:      body.altPhone,
        altContact:    body.altContact,
        email:         body.email,
        cc:            body.cc,
        bcc:           body.bcc,
        mailFrom:      body.mailFrom,
        description:   body.description,
        // Billing
        balance:               body.balance          !== undefined ? parseFloat(body.balance)          : undefined,
        creditLimit:           body.creditLimit       !== undefined ? parseFloat(body.creditLimit)       : undefined,
        paymentCurrency:       body.paymentCurrency,
        paymentMethod:         body.paymentMethod     !== undefined ? parseInt(body.paymentMethod, 10)  : undefined,
        minPaymentAmount:      body.minPaymentAmount  !== undefined ? parseFloat(body.minPaymentAmount)  : undefined,
        iCommissionAgent:      body.iCommissionAgent  !== undefined ? parseInt(body.iCommissionAgent, 10) : undefined,
        commissionSize:        body.commissionSize    !== undefined ? parseFloat(body.commissionSize)    : undefined,
        // Routing
        iRoutingGroup:         body.iRoutingGroup     !== undefined ? parseInt(body.iRoutingGroup, 10)  : undefined,
        // Permissions
        accountsMgmt:          body.accountsMgmt      !== undefined ? parseInt(body.accountsMgmt, 10)   : undefined,
        customersMgmt:         body.customersMgmt     !== undefined ? parseInt(body.customersMgmt, 10)  : undefined,
        systemMgmt:            body.systemMgmt        !== undefined ? parseInt(body.systemMgmt, 10)     : undefined,
        tariffsMgmt:           body.tariffsMgmt       !== undefined ? parseInt(body.tariffsMgmt, 10)    : undefined,
        vouchersMgmt:          body.vouchersMgmt      !== undefined ? parseInt(body.vouchersMgmt, 10)   : undefined,
        apiAccess:             body.apiAccess         !== undefined ? parseInt(body.apiAccess, 10)      : undefined,
        apiPassword:           body.apiPassword,
        apiMgmt:               body.apiMgmt           !== undefined ? parseInt(body.apiMgmt, 10)        : undefined,
        // Features
        maxDepth:              body.maxDepth          !== undefined ? parseInt(body.maxDepth, 10)       : undefined,
        useOwnTariff:          body.useOwnTariff      !== undefined ? parseInt(body.useOwnTariff, 10)   : undefined,
        accountsMatchingRule:  body.accountsMatchingRule,
        callshopEnabled:       body.callshopEnabled   !== undefined ? Boolean(body.callshopEnabled)     : undefined,
        overcommitProtection:  body.overcommitProtection !== undefined ? Boolean(body.overcommitProtection) : undefined,
        overcommitLimit:       body.overcommitLimit   !== undefined ? parseFloat(body.overcommitLimit)  : undefined,
        didPoolEnabled:        body.didPoolEnabled     !== undefined ? Boolean(body.didPoolEnabled)      : undefined,
        ivrAppsEnabled:        body.ivrAppsEnabled    !== undefined ? Boolean(body.ivrAppsEnabled)      : undefined,
        asrAcdEnabled:         body.asrAcdEnabled     !== undefined ? Boolean(body.asrAcdEnabled)       : undefined,
        debitCreditCardsEnabled: body.debitCreditCardsEnabled !== undefined ? Boolean(body.debitCreditCardsEnabled) : undefined,
        conferencingEnabled:   body.conferencingEnabled !== undefined ? Boolean(body.conferencingEnabled) : undefined,
        sharePaymentProcessors: body.sharePaymentProcessors !== undefined ? Boolean(body.sharePaymentProcessors) : undefined,
        dnclEnabled:           body.dnclEnabled       !== undefined ? Boolean(body.dnclEnabled)         : undefined,
        // Locale / UI
        iTimeZone:             body.iTimeZone         !== undefined ? parseInt(body.iTimeZone, 10)      : undefined,
        iLang:                 body.iLang,
        iExportType:           body.iExportType       !== undefined ? parseInt(body.iExportType, 10)    : undefined,
        startPage:             body.startPage         !== undefined ? parseInt(body.startPage, 10)      : undefined,
        css:                   body.css,
        dnsAlias:              body.dnsAlias,
        // Rate limits
        maxSessions:           body.maxSessions       !== undefined ? parseInt(body.maxSessions, 10)    : undefined,
        maxCallsPerSecond:     body.maxCallsPerSecond  !== undefined ? parseFloat(body.maxCallsPerSecond) : undefined,
        // Password policy
        iPasswordPolicy:       body.iPasswordPolicy   !== undefined ? parseInt(body.iPasswordPolicy, 10) : undefined,
        // Trusted mode
        iWholesaler:           body.iWholesaler       !== undefined ? parseInt(body.iWholesaler, 10)    : undefined,
      }, sippyPortalUrl(settings));
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // PATCH /api/sippy/customers/:id/credit-limit — set credit limit directly on the balance entity
  // Uses Customer.set_credit_limit(i_balance, credit_limit) per External Balance Daemon docs (3000070859).
  // Requires the customer's i_balance ID (obtained from getCustomer or listCustomers response).
  app.patch('/api/sippy/customers/:id/credit-limit', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req, res) => {
    try {
      const { iBalance, creditLimit } = req.body as { iBalance?: number; creditLimit?: number };
      if (iBalance === undefined || creditLimit === undefined) {
        return res.status(400).json({ success: false, message: 'iBalance and creditLimit are required.' });
      }
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.setSippyBalanceCreditLimit(username, password, Number(iBalance), Number(creditLimit));
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // GET /api/sippy/customers/:id/low-balance — get low balance / auto-recharge config (docs 107444)
  // Same response shape as the account endpoint; br_* fields will be absent for customers.
  app.get('/api/sippy/customers/:id/low-balance', async (req: any, res) => {
    try {
      const iCustomer = parseInt(req.params.id, 10);
      if (isNaN(iCustomer)) return res.status(400).json({ success: false, error: 'Invalid i_customer.' });
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.getSippyLowBalance(username, password, { iCustomer });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // PATCH /api/sippy/customers/:id/low-balance — set low balance / auto-recharge config (docs 107444)
  // Same body fields as account endpoint; br_* fields are not applicable for customers.
  app.patch('/api/sippy/customers/:id/low-balance', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req, res) => {
    try {
      const iCustomer = parseInt(req.params.id, 10);
      if (isNaN(iCustomer)) return res.status(400).json({ success: false, message: 'Invalid i_customer.' });
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.setSippyLowBalance(username, password, { iCustomer, ...req.body });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // DELETE /api/sippy/customers/:id — delete a customer
  app.delete('/api/sippy/customers/:id', (req: any, res, next) => requireRole(['admin'], req, res, next), async (req, res) => {
    try {
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.deleteSippyCustomer(username, password, parseInt(req.params.id, 10));
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // POST /api/sippy/customers/:id/block — block a customer
  app.post('/api/sippy/customers/:id/block', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req, res) => {
    try {
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.blockSippyCustomer(username, password, parseInt(req.params.id, 10));
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // POST /api/sippy/customers/:id/unblock — unblock a customer
  app.post('/api/sippy/customers/:id/unblock', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req, res) => {
    try {
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.unblockSippyCustomer(username, password, parseInt(req.params.id, 10));
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ── Account management (official Sippy API) ───────────────────────────────

  // GET /api/sippy/accounts — list accounts for a customer using listAccounts() (docs 107322)
  // Query params:
  //   iCustomer — optional; scope results to this customer (trusted/admin mode)
  //   offset    — skip first N records
  //   limit     — return at most N records (default 200)
  // NOTE: balance is NOT inverted in listAccounts() — positive = positive balance.
  //       This differs from createAccount() and getAccountInfo() which DO invert balance.
  app.get('/api/sippy/accounts', async (req: any, res) => {
    try {
      const settings = await storage.getSettings();
      const portalUrl = sippyPortalUrl(settings);
      const opts: { iCustomer?: number; offset?: number; limit?: number } = {};
      if (req.query.iCustomer) opts.iCustomer = parseInt(req.query.iCustomer as string, 10);
      if (req.query.offset)    opts.offset    = parseInt(req.query.offset    as string, 10);
      if (req.query.limit)     opts.limit     = parseInt(req.query.limit     as string, 10);
      // Try each credential pair in order — stop at first non-401 result
      const credPairs = sippyXmlCredsPairs(settings);
      let result = { accounts: [] as any[], error: 'No credentials configured.' };
      for (const { username, password } of credPairs) {
        result = await sippy.listSippyAccounts(username, password, opts, portalUrl);
        if (!result.error || (!result.error.includes('401') && !result.error.includes('403'))) break;
        // 401 → try with iCustomer=1 scope before moving to next pair
        const r2 = await sippy.listSippyAccounts(username, password, { ...opts, iCustomer: 1 }, portalUrl);
        if (!r2.error || (!r2.error.includes('401') && !r2.error.includes('403'))) { result = r2; break; }
      }
      // Update account name cache from fresh results
      if (result.accounts?.length) {
        for (const acct of result.accounts) {
          if (acct.iAccount && acct.username) accountNameCache.set(String(acct.iAccount), acct.username);
        }
      }
      res.json(result);
    } catch (e: any) { res.status(500).json({ accounts: [], error: e.message }); }
  });

  // GET /api/sippy/accounts/:id/registration — SIP registration status (docs 107366)
  // Returns registered status plus user_agent, contact, expires if registered.
  // Uses getRegistrationStatus(). Fault code 403 = not registered (not an error).
  // Query params:
  //   iCustomer — optional; pass in trusted/admin mode to scope call to a specific customer
  app.get('/api/sippy/accounts/:id/registration', async (req: any, res) => {
    try {
      const iAccount = parseInt(req.params.id, 10);
      if (isNaN(iAccount)) return res.status(400).json({ registered: false, error: 'Invalid i_account.' });
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const opts: { iCustomer?: number } = {};
      if (req.query.iCustomer) opts.iCustomer = parseInt(req.query.iCustomer as string, 10);
      const result = await sippy.getSippyAccountRegistration(username, password, iAccount, opts);
      res.json(result);
    } catch (e: any) { res.status(500).json({ registered: false, error: e.message }); }
  });

  // DELETE /api/sippy/accounts/:id — delete an account (docs 107321)
  // Supports trusted mode: passes i_customer=1 when using admin XML-RPC credentials.
  // Active calls of the deleted account are disconnected automatically (Sippy v5.0+).
  app.delete('/api/sippy/accounts/:id', (req: any, res, next) => requireRole(['admin'], req, res, next), async (req, res) => {
    try {
      const iAccount = parseInt(req.params.id, 10);
      if (isNaN(iAccount)) return res.status(400).json({ success: false, message: 'Invalid i_account.' });
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const iCustomer = req.body?.i_customer !== undefined ? parseInt(req.body.i_customer, 10) : 1;
      const result = await sippy.deleteSippyAccount(username, password, iAccount, undefined, iCustomer);
      res.json(result);
      regenDataflowDoc();
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // GET /api/sippy/accounts/:id/low-balance — get low balance / auto-recharge config (docs 107444)
  // Returns threshold, notifyByEmail, chargeCard, chargeAmount, iDebitCreditCard,
  // notificationRetryCount, notificationRetryInterval, and account-only billing-run fields.
  app.get('/api/sippy/accounts/:id/low-balance', async (req: any, res) => {
    try {
      const iAccount = parseInt(req.params.id, 10);
      if (isNaN(iAccount)) return res.status(400).json({ success: false, error: 'Invalid i_account.' });
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.getSippyLowBalance(username, password, { iAccount });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // GET /api/sippy/balance-monitor — all accounts with live balance + low-balance threshold
  // Fetches listAccounts() + getLowBalance() per account in parallel for a unified monitor view.
  app.get('/api/sippy/balance-monitor', async (req: any, res) => {
    try {
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const portalUrl = sippyPortalUrl(settings);
      // Use credential-pair retry so swapped apiAdmin/portal fields don't cause 401
      const { accounts, error } = await withSippyCreds(settings, (u, p) =>
        sippy.listSippyAccounts(u, p, {}, portalUrl));
      if (error && !accounts?.length) return res.status(502).json({ success: false, error });
      const credPairs = sippyXmlCredsPairs(settings);

      // Helper: try each credential pair for auth rules (returns object with authRules array)
      async function tryAllCredsAuthRules(iAccount: number) {
        for (const { username, password } of credPairs) {
          try {
            const r = await sippy.listSippyAuthRules(username, password, { iAccount }, portalUrl);
            if (r?.authRules?.length) return r;
          } catch { /* ignore per-pair errors, try next */ }
        }
        return null;
      }

      // Helper: try each credential pair for getAccountInfo (internally tries both XML-RPC methods)
      async function tryAllCredsAccountInfo(iAccount: number) {
        for (const { username, password } of credPairs) {
          try {
            const r = await sippy.getAccountInfo(username, password, portalUrl, iAccount);
            if (r !== null && r !== undefined) return r;
          } catch { /* ignore per-pair errors, try next */ }
        }
        return null;
      }

      const rows = await Promise.all((accounts ?? []).map(async (a) => {
        let threshold: number | null = null;
        let notifyByEmail: boolean | undefined;
        let prefix: string | null = null;
        let allowedIps: string[] = [];

        // Fetch low-balance config + account info + auth rules in parallel
        const [lbResult, infoResult, authResult] = await Promise.allSettled([
          withSippyCreds(settings, (u, p) => sippy.getSippyLowBalance(u, p, { iAccount: a.iAccount }, portalUrl)),
          tryAllCredsAccountInfo(a.iAccount),
          tryAllCredsAuthRules(a.iAccount),
        ]);

        if (lbResult.status === 'fulfilled') {
          threshold     = lbResult.value?.threshold    ?? null;
          notifyByEmail = lbResult.value?.notifyByEmail;
        }

        // maxSessions: prefer getAccountInfo result, fall back to list value (may be null if not in list response)
        const infoMaxSessions = (infoResult.status === 'fulfilled' && infoResult.value?.maxSessions != null && infoResult.value.maxSessions !== 0)
          ? infoResult.value.maxSessions : null;
        const listMaxSessions = (a.maxSessions != null && a.maxSessions !== 0) ? a.maxSessions : null;
        const maxSessions = infoMaxSessions ?? listMaxSessions;

        if (authResult.status === 'fulfilled' && authResult.value?.authRules?.length) {
          const rules: any[] = authResult.value.authRules;
          allowedIps = [...new Set(
            rules.map((r) => r.remoteIp).filter((ip): ip is string => Boolean(ip))
          )];
          // Pick the first auth rule with a CLI prefix (actual number pattern, e.g. "2348")
          const cliRule = rules.find((r) => r.incomingCli && r.incomingCli.trim() !== '');
          const cldRule = rules.find((r) => r.incomingCld && r.incomingCld.trim() !== '');
          prefix = cliRule?.incomingCli ?? cldRule?.incomingCld ?? null;
        }

        const balance     = a.balance    ?? 0;
        const creditLimit = a.creditLimit ?? 0;
        const status =
          threshold !== null && balance <= 0        ? 'critical' :
          threshold !== null && balance <= threshold ? 'warning'  : 'healthy';
        return {
          iAccount: a.iAccount, username: a.username, balance, creditLimit,
          threshold, notifyByEmail, status, currency: a.currency,
          maxSessions, prefix, allowedIps,
        };
      }));
      res.json({ success: true, accounts: rows });
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // PATCH /api/sippy/accounts/:id/settings — update core account settings (max_sessions, max_calls_per_second, etc.)
  // Body: { maxSessions?, maxCallsPerSecond?, maxSessionTime?, blocked?, iCustomer? }
  // Uses Sippy XML-RPC updateAccount() — docs 107312+. Admin credentials required.
  app.patch('/api/sippy/accounts/:id/settings', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req, res) => {
    try {
      const iAccount = parseInt(req.params.id, 10);
      if (isNaN(iAccount)) return res.status(400).json({ success: false, message: 'Invalid i_account.' });
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const portalUrl = sippyPortalUrl(settings);
      if (!portalUrl) return res.status(503).json({ success: false, message: 'Sippy not configured.' });

      const opts = {
        maxSessions:       req.body.maxSessions        !== undefined ? Number(req.body.maxSessions)      : undefined,
        maxCallsPerSecond: req.body.maxCallsPerSecond   !== undefined ? Number(req.body.maxCallsPerSecond) : undefined,
        maxCreditTime:     req.body.maxSessionTime       !== undefined ? Number(req.body.maxSessionTime)    : undefined,
        blocked:           req.body.blocked             !== undefined ? Boolean(req.body.blocked)          : undefined,
        iCustomer:         req.body.iCustomer           !== undefined ? Number(req.body.iCustomer)         : undefined,
      };
      if (Object.values(opts).every(v => v === undefined)) {
        return res.status(400).json({ success: false, message: 'No settings to update.' });
      }

      const result = await sippy.updateAccountSettings(username, password, portalUrl, iAccount, opts);
      if (!result.success) return res.status(422).json(result);
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // PATCH /api/sippy/accounts/:id/low-balance — set low balance / auto-recharge config (docs 107444)
  // Body accepts any subset of: threshold (null = disabled), notifyByEmail, chargeCard,
  // chargeAmount, iDebitCreditCard (null = primary), notificationRetryCount,
  // notificationRetryInterval (null = system default), brChargeCard, brChargeAmount, brIDebitCreditCard.
  // Omit a field to leave it unchanged.
  app.patch('/api/sippy/accounts/:id/low-balance', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req, res) => {
    try {
      const iAccount = parseInt(req.params.id, 10);
      if (isNaN(iAccount)) return res.status(400).json({ success: false, message: 'Invalid i_account.' });
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.setSippyLowBalance(username, password, { iAccount, ...req.body });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ── Authentication Rules (doc 107336) ────────────────────────────────────
  // Protocols: 1=SIP  2=H.323 (deprecated)  3=IAX2  4=Calling Card PIN
  // Trusted mode: add ?iCustomer=<n> to any GET, or include iCustomer in POST/PATCH bodies.
  // i_tariff/i_routing_group null  → use account's service plan.
  // max_sessions -1               → Unlimited.  max_cps null → Unlimited.

  // GET /api/sippy/accounts/:id/auth-rules — list auth rules for an account (docs 107336)
  // Query params: iCustomer (trusted), iProtocol, remoteIp, offset, limit
  app.get('/api/sippy/accounts/:id/auth-rules', async (req: any, res) => {
    try {
      const iAccount = parseInt(req.params.id, 10);
      if (isNaN(iAccount)) return res.status(400).json({ authRules: [], error: 'Invalid i_account.' });
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const opts: Parameters<typeof sippy.listSippyAuthRules>[2] = { iAccount };
      if (req.query.iCustomer)      opts.iCustomer      = parseInt(req.query.iCustomer as string, 10);
      if (req.query.iProtocol)      opts.iProtocol      = parseInt(req.query.iProtocol  as string, 10);
      if (req.query.remoteIp)       opts.remoteIp       = req.query.remoteIp as string;
      if (req.query.offset)         opts.offset         = parseInt(req.query.offset     as string, 10);
      if (req.query.limit)          opts.limit          = parseInt(req.query.limit      as string, 10);
      const result = await sippy.listSippyAuthRules(username, password, opts);
      res.json(result);
    } catch (e: any) { res.status(500).json({ authRules: [], error: e.message }); }
  });

  // POST /api/sippy/accounts/:id/auth-rules — add an auth rule to an account (docs 107336)
  // Body: iProtocol (required) + at least one of remoteIp/incomingCli/incomingCld/toDomain/fromDomain
  //       + optional: cliTranslationRule, cldTranslationRule, iTariff, iRoutingGroup, maxSessions, maxCps, iCustomer
  app.post('/api/sippy/accounts/:id/auth-rules', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req, res) => {
    try {
      const iAccount = parseInt(req.params.id, 10);
      if (isNaN(iAccount)) return res.status(400).json({ success: false, message: 'Invalid i_account.' });
      const { iProtocol, remoteIp, incomingCli, incomingCld, toDomain, fromDomain } = req.body;
      if (!iProtocol) return res.status(400).json({ success: false, message: 'iProtocol is required.' });
      if (!remoteIp && !incomingCli && !incomingCld && !toDomain && !fromDomain) {
        return res.status(400).json({ success: false, message: 'At least one of remoteIp, incomingCli, incomingCld, toDomain, fromDomain is required.' });
      }
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.addSippyAuthRule(username, password, { iAccount, ...req.body });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // GET /api/sippy/auth-rules/:id — get full info for one auth rule (docs 107336, available from Sippy 4.5)
  // Query params: iCustomer (trusted mode)
  app.get('/api/sippy/auth-rules/:id', async (req: any, res) => {
    try {
      const iAuthentication = parseInt(req.params.id, 10);
      if (isNaN(iAuthentication)) return res.status(400).json({ success: false, error: 'Invalid i_authentication.' });
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const opts: { iCustomer?: number } = {};
      if (req.query.iCustomer) opts.iCustomer = parseInt(req.query.iCustomer as string, 10);
      const result = await sippy.getSippyAuthRuleInfo(username, password, iAuthentication, opts);
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // PATCH /api/sippy/auth-rules/:id — update an auth rule (docs 107336)
  // Body: any subset of auth rule fields; only provided fields are changed.
  // Note: i_account was removed in Sippy >= 5.2 and should not be sent.
  app.patch('/api/sippy/auth-rules/:id', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req, res) => {
    try {
      const iAuthentication = parseInt(req.params.id, 10);
      if (isNaN(iAuthentication)) return res.status(400).json({ success: false, message: 'Invalid i_authentication.' });
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.updateSippyAuthRule(username, password, { iAuthentication, ...req.body });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // DELETE /api/sippy/auth-rules/:id — delete an auth rule (docs 107336)
  // Query params: iCustomer (trusted mode)
  app.delete('/api/sippy/auth-rules/:id', (req: any, res, next) => requireRole(['admin'], req, res, next), async (req, res) => {
    try {
      const iAuthentication = parseInt(req.params.id, 10);
      if (isNaN(iAuthentication)) return res.status(400).json({ success: false, message: 'Invalid i_authentication.' });
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const opts: { iCustomer?: number } = {};
      if (req.query.iCustomer) opts.iCustomer = parseInt(req.query.iCustomer as string, 10);
      const result = await sippy.delSippyAuthRule(username, password, iAuthentication, opts);
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ── Account Incoming Routing Management (official Sippy API — docs 3000032223) ──

  // GET /api/sippy/accounts/:id/incoming-routes — list incoming routes for an account
  // Query params: iDid, offset, limit, iCustomer (trusted mode)
  app.get('/api/sippy/accounts/:id/incoming-routes', async (req: any, res) => {
    try {
      const iAccount = parseInt(req.params.id, 10);
      if (isNaN(iAccount)) return res.status(400).json({ success: false, message: 'Invalid i_account.' });
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const opts: { iAccount: number; iDid?: number; offset?: number; limit?: number; iCustomer?: number } = { iAccount };
      if (req.query.iDid)      opts.iDid      = parseInt(req.query.iDid as string, 10);
      if (req.query.offset)    opts.offset    = parseInt(req.query.offset as string, 10);
      if (req.query.limit)     opts.limit     = parseInt(req.query.limit as string, 10);
      if (req.query.iCustomer) opts.iCustomer = parseInt(req.query.iCustomer as string, 10);
      const result = await sippy.getIncomingRoutesList(username, password, opts);
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // PATCH /api/sippy/incoming-routes/:id — update an incoming routing entry
  // Body: iTrunk (null = Registered Account), iForwardDidMode, selfManaged, iCustomer
  app.patch('/api/sippy/incoming-routes/:id', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req, res) => {
    try {
      const iIncomingRoute = parseInt(req.params.id, 10);
      if (isNaN(iIncomingRoute)) return res.status(400).json({ success: false, message: 'Invalid i_incoming_route.' });
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.updateIncomingRoute(username, password, { iIncomingRoute, ...req.body });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // POST /api/sippy/accounts/auth — authenticate an account by web (selfcare) credentials (docs 107325)
  // Body: accountUsername or email (one required), accountPassword (required), iCustomer (trusted mode, optional)
  // Returns: { success, iAccount, oneTimePassword?, message }
  // oneTimePassword=true when fault code 410 is returned (authenticated via OTP)
  app.post('/api/sippy/accounts/auth', async (req: any, res) => {
    try {
      const { accountUsername, email, accountPassword, iCustomer } = req.body;
      if (!accountPassword) return res.status(400).json({ success: false, message: 'accountPassword is required.' });
      if (!accountUsername && !email) return res.status(400).json({ success: false, message: 'Either accountUsername or email is required.' });
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.authSippyAccount(username, password, {
        accountUsername,
        email,
        accountPassword,
        iCustomer: iCustomer !== undefined ? parseInt(iCustomer, 10) : undefined,
      });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // POST /api/sippy/accounts/:id/billing-run — forcibly apply service plan charges (docs 107400)
  // Calls billingRun() on the given account; returns result=OK on success.
  app.post('/api/sippy/accounts/:id/billing-run', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req, res) => {
    try {
      const iAccount = parseInt(req.params.id, 10);
      if (isNaN(iAccount)) return res.status(400).json({ success: false, message: 'Invalid i_account.' });
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.billingRun(username, password, iAccount);
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // POST /api/sippy/accounts/:id/block — block an account (docs 107340)
  // Optional body: iCustomer (trusted mode)
  app.post('/api/sippy/accounts/:id/block', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req, res) => {
    try {
      const iAccount = parseInt(req.params.id, 10);
      if (isNaN(iAccount)) return res.status(400).json({ success: false, message: 'Invalid i_account.' });
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const iCustomer = req.body?.iCustomer !== undefined ? parseInt(req.body.iCustomer, 10) : undefined;
      const result = await sippy.blockSippyAccount(username, password, iAccount, { iCustomer });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // POST /api/sippy/accounts/:id/unblock — unblock an account (docs 107340)
  // Optional body: iCustomer (trusted mode)
  app.post('/api/sippy/accounts/:id/unblock', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req, res) => {
    try {
      const iAccount = parseInt(req.params.id, 10);
      if (isNaN(iAccount)) return res.status(400).json({ success: false, message: 'Invalid i_account.' });
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const iCustomer = req.body?.iCustomer !== undefined ? parseInt(req.body.iCustomer, 10) : undefined;
      const result = await sippy.unblockSippyAccount(username, password, iAccount, { iCustomer });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ── Hot Dial Numbers (docs 107330) ─────────────────────────────────────────

  // GET /api/sippy/accounts/:id/hot-dial — list all hot dial numbers (docs 107330)
  // Query: iCustomer (trusted mode, optional)
  app.get('/api/sippy/accounts/:id/hot-dial', async (req: any, res) => {
    try {
      const iAccount = parseInt(req.params.id, 10);
      if (isNaN(iAccount)) return res.status(400).json({ success: false, error: 'Invalid i_account.' });
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const iCustomer = req.query.iCustomer ? parseInt(req.query.iCustomer as string, 10) : undefined;
      const result = await sippy.listHotDialNumbers(username, password, iAccount, { iCustomer });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, hotKeys: [], error: e.message }); }
  });

  // POST /api/sippy/accounts/:id/hot-dial — add a hot dial number (docs 107330)
  // Body: hotKey (required), dest (required), description (optional), iCustomer (optional)
  app.post('/api/sippy/accounts/:id/hot-dial', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req, res) => {
    try {
      const iAccount = parseInt(req.params.id, 10);
      if (isNaN(iAccount)) return res.status(400).json({ success: false, message: 'Invalid i_account.' });
      const { hotKey, dest, description, iCustomer } = req.body;
      if (!hotKey) return res.status(400).json({ success: false, message: 'hotKey is required.' });
      if (!dest)   return res.status(400).json({ success: false, message: 'dest is required.' });
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.addHotDialNumber(username, password, iAccount, {
        hotKey, dest, description,
        iCustomer: iCustomer !== undefined ? parseInt(iCustomer, 10) : undefined,
      });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // PATCH /api/sippy/accounts/:id/hot-dial/:hotKey — update destination of a hot dial number (docs 107330)
  // Body: dest (required), iCustomer (optional)
  app.patch('/api/sippy/accounts/:id/hot-dial/:hotKey', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req, res) => {
    try {
      const iAccount = parseInt(req.params.id, 10);
      if (isNaN(iAccount)) return res.status(400).json({ success: false, message: 'Invalid i_account.' });
      const hotKey = req.params.hotKey;
      const { dest, iCustomer } = req.body;
      if (!dest) return res.status(400).json({ success: false, message: 'dest is required.' });
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.updateHotDialNumber(username, password, iAccount, hotKey, dest, {
        iCustomer: iCustomer !== undefined ? parseInt(iCustomer, 10) : undefined,
      });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // DELETE /api/sippy/accounts/:id/hot-dial/:hotKey — delete a hot dial number (docs 107330)
  // Body: iCustomer (optional, trusted mode)
  app.delete('/api/sippy/accounts/:id/hot-dial/:hotKey', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req, res) => {
    try {
      const iAccount = parseInt(req.params.id, 10);
      if (isNaN(iAccount)) return res.status(400).json({ success: false, message: 'Invalid i_account.' });
      const hotKey = req.params.hotKey;
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const iCustomer = req.body?.iCustomer !== undefined ? parseInt(req.body.iCustomer, 10) : undefined;
      const result = await sippy.delHotDialNumber(username, password, iAccount, hotKey, { iCustomer });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // POST /api/sippy/accounts/reset-otp — reset one-time web-login password (docs 107399)
  // Body: { username: string } — the account's web login username (NOT i_account)
  // Returns: { success, password, message }
  // NOTE: No trusted mode. Only accounts of the authenticated customer can be reset.
  app.post('/api/sippy/accounts/reset-otp', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req, res) => {
    try {
      const { username: accountUsername } = req.body;
      if (!accountUsername) return res.status(400).json({ success: false, message: 'username is required.' });
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.resetAccountOneTimePassword(username, password, accountUsername);
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ── Post-Authentication Rules (docs 3000105881, since Sippy 2020) ───────────

  // GET /api/sippy/accounts/:id/post-auth-rules — list post-auth rules for an account
  // Query: remoteIp, offset, limit, iCustomer (all optional)
  app.get('/api/sippy/accounts/:id/post-auth-rules', async (req: any, res) => {
    try {
      const iAccount = parseInt(req.params.id, 10);
      if (isNaN(iAccount)) return res.status(400).json({ postAuthRules: [], error: 'Invalid i_account.' });
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.listPostAuthRules(username, password, {
        iAccount,
        iCustomer: req.query.iCustomer ? parseInt(req.query.iCustomer as string, 10) : undefined,
        remoteIp:  req.query.remoteIp  as string | undefined,
        offset:    req.query.offset    ? parseInt(req.query.offset as string, 10) : undefined,
        limit:     req.query.limit     ? parseInt(req.query.limit  as string, 10) : undefined,
      });
      res.json(result);
    } catch (e: any) { res.status(500).json({ postAuthRules: [], error: e.message }); }
  });

  // GET /api/sippy/post-auth-rules/:id — get a single post-auth rule by ID
  app.get('/api/sippy/post-auth-rules/:id', async (req: any, res) => {
    try {
      const iPostAuthRule = parseInt(req.params.id, 10);
      if (isNaN(iPostAuthRule)) return res.status(400).json({ success: false, error: 'Invalid i_post_auth_rule.' });
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const iCustomer = req.query.iCustomer ? parseInt(req.query.iCustomer as string, 10) : undefined;
      const result = await sippy.getPostAuthRuleInfo(username, password, iPostAuthRule, { iCustomer });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // POST /api/sippy/accounts/:id/post-auth-rules — add a post-auth rule (admin+management)
  // Body: at least one of remoteIp/cli/cld required; optional: cliTranslationRule, cldTranslationRule, iTariff, iRoutingGroup, iCustomer
  app.post('/api/sippy/accounts/:id/post-auth-rules', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req, res) => {
    try {
      const iAccount = parseInt(req.params.id, 10);
      if (isNaN(iAccount)) return res.status(400).json({ success: false, message: 'Invalid i_account.' });
      const { remoteIp, cli, cld, cliTranslationRule, cldTranslationRule, iTariff, iRoutingGroup, iCustomer } = req.body;
      if (!remoteIp && !cli && !cld) return res.status(400).json({ success: false, message: 'At least one of remoteIp, cli, or cld is required.' });
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.addPostAuthRule(username, password, {
        iAccount,
        remoteIp, cli, cld, cliTranslationRule, cldTranslationRule,
        iTariff:       iTariff       !== undefined ? (iTariff === null ? null : parseInt(iTariff, 10))       : undefined,
        iRoutingGroup: iRoutingGroup !== undefined ? (iRoutingGroup === null ? null : parseInt(iRoutingGroup, 10)) : undefined,
        iCustomer:     iCustomer     !== undefined ? parseInt(iCustomer, 10) : undefined,
      });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // PATCH /api/sippy/post-auth-rules/:id — update a post-auth rule (admin+management)
  // Body: any subset of remoteIp/cli/cld/cliTranslationRule/cldTranslationRule/iTariff/iRoutingGroup/iCustomer
  app.patch('/api/sippy/post-auth-rules/:id', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req, res) => {
    try {
      const iPostAuthRule = parseInt(req.params.id, 10);
      if (isNaN(iPostAuthRule)) return res.status(400).json({ success: false, message: 'Invalid i_post_auth_rule.' });
      const { remoteIp, cli, cld, cliTranslationRule, cldTranslationRule, iTariff, iRoutingGroup, iCustomer } = req.body;
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.updatePostAuthRule(username, password, {
        iPostAuthRule,
        remoteIp, cli, cld, cliTranslationRule, cldTranslationRule,
        iTariff:       iTariff       !== undefined ? (iTariff === null ? null : parseInt(iTariff, 10))       : undefined,
        iRoutingGroup: iRoutingGroup !== undefined ? (iRoutingGroup === null ? null : parseInt(iRoutingGroup, 10)) : undefined,
        iCustomer:     iCustomer     !== undefined ? parseInt(iCustomer, 10) : undefined,
      });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // DELETE /api/sippy/post-auth-rules/:id — delete a post-auth rule (admin only)
  // Body: iCustomer (optional, trusted mode)
  app.delete('/api/sippy/post-auth-rules/:id', (req: any, res, next) => requireRole(['admin'], req, res, next), async (req, res) => {
    try {
      const iPostAuthRule = parseInt(req.params.id, 10);
      if (isNaN(iPostAuthRule)) return res.status(400).json({ success: false, message: 'Invalid i_post_auth_rule.' });
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const iCustomer = req.body?.iCustomer !== undefined ? parseInt(req.body.iCustomer, 10) : undefined;
      const result = await sippy.deletePostAuthRule(username, password, iPostAuthRule, { iCustomer });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ── CLI Mappings / Trusted Numbers (docs 107328) — NO trusted mode ──────────

  // GET /api/sippy/accounts/:id/cli-mappings — list CLI mappings for an account
  app.get('/api/sippy/accounts/:id/cli-mappings', async (req: any, res) => {
    try {
      const iAccount = parseInt(req.params.id, 10);
      if (isNaN(iAccount)) return res.status(400).json({ mappings: [], error: 'Invalid i_account.' });
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.listCLIMappings(username, password, iAccount);
      res.json(result);
    } catch (e: any) { res.status(500).json({ mappings: [], error: e.message }); }
  });

  // POST /api/sippy/accounts/:id/cli-mappings — add a CLI mapping (admin+management)
  // Body: { cli, lang }
  app.post('/api/sippy/accounts/:id/cli-mappings', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req, res) => {
    try {
      const iAccount = parseInt(req.params.id, 10);
      if (isNaN(iAccount)) return res.status(400).json({ success: false, message: 'Invalid i_account.' });
      const { cli, lang } = req.body;
      if (!cli)  return res.status(400).json({ success: false, message: 'cli is required.' });
      if (!lang) return res.status(400).json({ success: false, message: 'lang is required.' });
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.addCLIMapping(username, password, iAccount, cli, lang);
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // PATCH /api/sippy/accounts/:id/cli-mappings — update a CLI mapping (admin+management)
  // Body: { oldCli, newCli, lang? }
  app.patch('/api/sippy/accounts/:id/cli-mappings', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req, res) => {
    try {
      const iAccount = parseInt(req.params.id, 10);
      if (isNaN(iAccount)) return res.status(400).json({ success: false, message: 'Invalid i_account.' });
      const { oldCli, newCli, lang } = req.body;
      if (!oldCli) return res.status(400).json({ success: false, message: 'oldCli is required.' });
      if (!newCli) return res.status(400).json({ success: false, message: 'newCli is required.' });
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.updateCLIMapping(username, password, iAccount, oldCli, newCli, lang);
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // DELETE /api/sippy/accounts/:id/cli-mappings/:cli — delete a CLI mapping (admin only)
  // :cli is URL-encoded if it contains special chars
  app.delete('/api/sippy/accounts/:id/cli-mappings/:cli', (req: any, res, next) => requireRole(['admin'], req, res, next), async (req, res) => {
    try {
      const iAccount = parseInt(req.params.id, 10);
      if (isNaN(iAccount)) return res.status(400).json({ success: false, message: 'Invalid i_account.' });
      const cli = decodeURIComponent(req.params.cli);
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.delCLIMapping(username, password, iAccount, cli);
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // GET /api/sippy/cli-mappings/find — find CLI mapping by CLI number + iCustomer (docs 107328, from v2.0)
  // Query: cli (required), iCustomer (required)
  app.get('/api/sippy/cli-mappings/find', async (req: any, res) => {
    try {
      const cli = req.query.cli as string | undefined;
      const iCustomer = req.query.iCustomer ? parseInt(req.query.iCustomer as string, 10) : NaN;
      if (!cli)          return res.status(400).json({ success: false, error: 'cli query param is required.' });
      if (isNaN(iCustomer)) return res.status(400).json({ success: false, error: 'iCustomer query param is required.' });
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.findCLIMapping(username, password, cli, iCustomer);
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // ── Smart Dials (docs 107333) — NO trusted mode ──────────────────────────────

  // GET /api/sippy/accounts/:id/smart-dials — list smart dials for an account
  app.get('/api/sippy/accounts/:id/smart-dials', async (req: any, res) => {
    try {
      const iAccount = parseInt(req.params.id, 10);
      if (isNaN(iAccount)) return res.status(400).json({ smartDials: [], error: 'Invalid i_account.' });
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.listSmartDials(username, password, iAccount);
      res.json(result);
    } catch (e: any) { res.status(500).json({ smartDials: [], error: e.message }); }
  });

  // POST /api/sippy/accounts/:id/smart-dials — add a smart dial (admin+management)
  // Body: { did, dest, description? }
  app.post('/api/sippy/accounts/:id/smart-dials', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req, res) => {
    try {
      const iAccount = parseInt(req.params.id, 10);
      if (isNaN(iAccount)) return res.status(400).json({ success: false, message: 'Invalid i_account.' });
      const { did, dest, description } = req.body;
      if (!did)  return res.status(400).json({ success: false, message: 'did is required.' });
      if (!dest) return res.status(400).json({ success: false, message: 'dest is required.' });
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.addSmartDial(username, password, iAccount, did, dest, description);
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // PATCH /api/sippy/accounts/:id/smart-dials/:did — update a smart dial (admin+management)
  // Body: { dest?, description? } — at least one should be provided
  app.patch('/api/sippy/accounts/:id/smart-dials/:did', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req, res) => {
    try {
      const iAccount = parseInt(req.params.id, 10);
      if (isNaN(iAccount)) return res.status(400).json({ success: false, message: 'Invalid i_account.' });
      const did = req.params.did;
      const { dest, description } = req.body;
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.updateSmartDial(username, password, iAccount, did, { dest, description });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // DELETE /api/sippy/accounts/:id/smart-dials/:did — delete a smart dial (admin only)
  app.delete('/api/sippy/accounts/:id/smart-dials/:did', (req: any, res, next) => requireRole(['admin'], req, res, next), async (req, res) => {
    try {
      const iAccount = parseInt(req.params.id, 10);
      if (isNaN(iAccount)) return res.status(400).json({ success: false, message: 'Invalid i_account.' });
      const did = req.params.did;
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.deleteSmartDial(username, password, iAccount, did);
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // GET /api/sippy/accounts/:id/minute-plan-match — match CLD against account minute plans (docs 107406)
  // Query: cld (required) — destination number to match
  // Returns: matched (bool), iServicePlan, secondsTotal, secondsLeft
  // Fault code 410 = no plan matched → { matched: false } (not an error)
  app.get('/api/sippy/accounts/:id/minute-plan-match', async (req: any, res) => {
    try {
      const iAccount = parseInt(req.params.id, 10);
      if (isNaN(iAccount)) return res.status(400).json({ matched: false, error: 'Invalid i_account.' });
      const cld = req.query.cld as string | undefined;
      if (!cld) return res.status(400).json({ matched: false, error: 'cld query param is required.' });
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.matchAccountMinutePlan(username, password, iAccount, cld);
      res.json(result);
    } catch (e: any) { res.status(500).json({ matched: false, error: e.message }); }
  });

  // GET /api/sippy/accounts/:id/rates — get rates for an account (docs 107408)
  // Query params: offset, limit, prefix (all optional — prefix filters by prefix pattern)
  // NOTE: This API does NOT mention trusted mode support.
  app.get('/api/sippy/accounts/:id/rates', async (req: any, res) => {
    try {
      const iAccount = parseInt(req.params.id, 10);
      if (isNaN(iAccount)) return res.status(400).json({ success: false, error: 'Invalid i_account.' });
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const opts = {
        offset: req.query.offset !== undefined ? parseInt(req.query.offset as string, 10) : undefined,
        limit:  req.query.limit  !== undefined ? parseInt(req.query.limit  as string, 10) : undefined,
        prefix: req.query.prefix as string | undefined,
      };
      const result = await sippy.getAccountRates(username, password, iAccount, opts);
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, rates: [], error: e.message }); }
  });

  // GET /api/sippy/accounts/:id/minute-plans — get minute plans for an account (docs 107402)
  // NOTE: This API does NOT support trusted mode.
  app.get('/api/sippy/accounts/:id/minute-plans', async (req: any, res) => {
    try {
      const iAccount = parseInt(req.params.id, 10);
      if (isNaN(iAccount)) return res.status(400).json({ success: false, error: 'Invalid i_account.' });
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.getAccountMinutePlans(username, password, iAccount);
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, minutePlans: [], error: e.message }); }
  });

  // ── Follow Me Feature Management (docs 107412) ───────────────────────────

  // GET /api/sippy/accounts/:id/follow-me/options — get Follow Me mode + timeout
  app.get('/api/sippy/accounts/:id/follow-me/options', async (req: any, res) => {
    try {
      const iAccount = parseInt(req.params.id, 10);
      if (isNaN(iAccount)) return res.status(400).json({ success: false, error: 'Invalid i_account.' });
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const iCustomer = req.query.iCustomer ? parseInt(req.query.iCustomer as string, 10) : undefined;
      const result = await sippy.getFollowMeOptions(username, password, iAccount, { iCustomer });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // PATCH /api/sippy/accounts/:id/follow-me/options — set Follow Me mode + timeout (admin+management)
  app.patch('/api/sippy/accounts/:id/follow-me/options', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req, res) => {
    try {
      const iAccount = parseInt(req.params.id, 10);
      if (isNaN(iAccount)) return res.status(400).json({ success: false, message: 'Invalid i_account.' });
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const { followmeTimeout, iFollowmeMode, iCustomer } = req.body;
      const result = await sippy.setFollowMeOptions(username, password, iAccount, {
        followmeTimeout: followmeTimeout !== undefined ? parseInt(followmeTimeout, 10) : undefined,
        iFollowmeMode:   iFollowmeMode   !== undefined ? parseInt(iFollowmeMode, 10)  : undefined,
        iCustomer:       iCustomer       !== undefined ? parseInt(iCustomer, 10)       : undefined,
      });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // GET /api/sippy/accounts/:id/follow-me/entries — list Follow Me entries
  app.get('/api/sippy/accounts/:id/follow-me/entries', async (req: any, res) => {
    try {
      const iAccount = parseInt(req.params.id, 10);
      if (isNaN(iAccount)) return res.status(400).json({ success: false, error: 'Invalid i_account.' });
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const iCustomer = req.query.iCustomer ? parseInt(req.query.iCustomer as string, 10) : undefined;
      const result = await sippy.listFollowMeEntries(username, password, iAccount, { iCustomer });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, entries: [], error: e.message }); }
  });

  // POST /api/sippy/accounts/:id/follow-me/entries — add a Follow Me entry (admin+management)
  // Body: cld (required), preference, description, timeout, iCustomer
  app.post('/api/sippy/accounts/:id/follow-me/entries', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req, res) => {
    try {
      const iAccount = parseInt(req.params.id, 10);
      if (isNaN(iAccount)) return res.status(400).json({ success: false, message: 'Invalid i_account.' });
      const { cld, preference, description, timeout, iCustomer } = req.body;
      if (!cld) return res.status(400).json({ success: false, message: 'cld is required.' });
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.addFollowMeEntry(username, password, iAccount, {
        cld,
        preference,
        description,
        timeout:    timeout   !== undefined ? parseInt(timeout, 10)   : undefined,
        iCustomer:  iCustomer !== undefined ? parseInt(iCustomer, 10) : undefined,
      });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // PATCH /api/sippy/accounts/:id/follow-me/entries/:entryId — update a Follow Me entry (admin+management)
  // Body: cld, preference (first|last|up|down|#), description, timeout, iCustomer
  app.patch('/api/sippy/accounts/:id/follow-me/entries/:entryId', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req, res) => {
    try {
      const iAccount        = parseInt(req.params.id, 10);
      const iFollowmeEntry  = parseInt(req.params.entryId, 10);
      if (isNaN(iAccount) || isNaN(iFollowmeEntry)) return res.status(400).json({ success: false, message: 'Invalid i_account or i_followme_entry.' });
      const { cld, preference, description, timeout, iCustomer } = req.body;
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.updateFollowMeEntry(username, password, iAccount, iFollowmeEntry, {
        cld, preference, description,
        timeout:   timeout   !== undefined ? parseInt(timeout, 10)   : undefined,
        iCustomer: iCustomer !== undefined ? parseInt(iCustomer, 10) : undefined,
      });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // DELETE /api/sippy/accounts/:id/follow-me/entries/:entryId — delete a Follow Me entry (admin only)
  app.delete('/api/sippy/accounts/:id/follow-me/entries/:entryId', (req: any, res, next) => requireRole(['admin'], req, res, next), async (req, res) => {
    try {
      const iAccount        = parseInt(req.params.id, 10);
      const iFollowmeEntry  = parseInt(req.params.entryId, 10);
      if (isNaN(iAccount) || isNaN(iFollowmeEntry)) return res.status(400).json({ success: false, message: 'Invalid i_account or i_followme_entry.' });
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const iCustomer = req.body?.iCustomer !== undefined ? parseInt(req.body.iCustomer, 10) : undefined;
      const result = await sippy.deleteFollowMeEntry(username, password, iAccount, iFollowmeEntry, { iCustomer });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ── Vendor management (official Sippy docs 107434) ───────────────────────

  // GET /api/sippy/vendors — listVendors() / getVendorsList() — docs 107434
  // Query: limit?, offset?, namePattern?
  app.get('/api/sippy/vendors', async (req: any, res) => {
    try {
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ vendors: [], error: 'Sippy not configured.' });
      const opts: Parameters<typeof sippy.listSippyVendors>[2] = {};
      if (req.query.limit)       opts.limit       = parseInt(req.query.limit       as string, 10);
      if (req.query.offset)      opts.offset      = parseInt(req.query.offset      as string, 10);
      if (req.query.namePattern) opts.namePattern = req.query.namePattern as string;
      // Try each credential pair — swap automatically if primary returns 401
      const credPairs = sippyXmlCredsPairs(settings);
      let result = { vendors: [] as any[], error: 'No credentials configured.' };
      for (const { username, password } of credPairs) {
        result = await sippy.listSippyVendors(username, password, opts, sippyPortalUrl(settings));
        if (!result.error || (!result.error.includes('401') && !result.error.includes('403'))) break;
      }
      res.json(result);
    } catch (e: any) { res.status(500).json({ vendors: [], error: e.message }); }
  });

  // POST /api/sippy/vendors — createVendor() — docs 107434
  // Body: { name, webPassword, webLogin, iTimeZone, ...optional fields }
  // Returns: { success, iVendor, message }
  app.post('/api/sippy/vendors', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req: any, res) => {
    try {
      const { name, webPassword, webLogin, iTimeZone } = req.body ?? {};
      if (!name || !webPassword || !webLogin || iTimeZone === undefined) {
        return res.status(400).json({ success: false, error: 'name, webPassword, webLogin, and iTimeZone are required.' });
      }
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.createSippyVendor(username, password, req.body, sippyPortalUrl(settings));
      if (!result.success) return res.status(400).json(result);
      res.status(201).json(result);
      regenDataflowDoc();
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // GET /api/sippy/vendors/:id — getVendorInfo() — docs 107434
  // :id can be numeric (i_vendor) or a string name
  // Query: iCustomer? (trusted mode)
  // Returns: { success, vendor: SippyVendor & extra fields, message }
  app.get('/api/sippy/vendors/:id', async (req: any, res) => {
    try {
      const { id } = req.params;
      const { iCustomer } = req.query ?? {};
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const numId = parseInt(id, 10);
      const lookup = !isNaN(numId) ? { iVendor: numId } : { name: id };
      const result = await sippy.getSippyVendorInfo(username, password, lookup, {
        iCustomer: iCustomer !== undefined ? parseInt(iCustomer as string, 10) : undefined,
        portalUrl: sippyPortalUrl(settings),
      });
      if (!result.success) return res.status(404).json(result);
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // PATCH /api/sippy/vendors/:id — updateVendor() — docs 107434
  // Body: any subset of createVendor() fields (balance + baseCurrency excluded)
  // Returns: { success, message }
  app.patch('/api/sippy/vendors/:id', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req: any, res) => {
    try {
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.updateSippyVendor(username, password, parseInt(req.params.id, 10), req.body, sippyPortalUrl(settings));
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // DELETE /api/sippy/vendors/:id — deleteVendor() — docs 107434
  // Returns: { success, message }
  app.delete('/api/sippy/vendors/:id', (req: any, res, next) => requireRole(['admin'], req, res, next), async (req: any, res) => {
    try {
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.deleteSippyVendor(username, password, parseInt(req.params.id, 10), sippyPortalUrl(settings));
      res.json(result);
      regenDataflowDoc();
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // POST /api/sippy/vendors/:id/debit — vendorDebit() — docs 151210 (Sippy 4.0+)
  // Body: { amount (req), currency (req), paymentNotes?, paymentTime? }
  // Returns: { success, message }
  app.post('/api/sippy/vendors/:id/debit', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req: any, res) => {
    try {
      const iVendor = parseInt(req.params.id, 10);
      if (isNaN(iVendor)) return res.status(400).json({ success: false, message: 'Invalid i_vendor.' });
      const { amount, currency, paymentNotes, paymentTime } = req.body ?? {};
      if (amount === undefined || !currency)
        return res.status(400).json({ success: false, message: 'amount and currency are required.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, message: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.sippyVendorDebit(username, password, iVendor, amount, currency, { paymentNotes, paymentTime }, sippyPortalUrl(settings));
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // POST /api/sippy/vendors/:id/add-funds — vendorAddFunds() — docs 151210 (Sippy 4.0+)
  // Body: { amount (req), currency (req), paymentNotes?, paymentTime? }
  // Returns: { success, message }
  app.post('/api/sippy/vendors/:id/add-funds', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req: any, res) => {
    try {
      const iVendor = parseInt(req.params.id, 10);
      if (isNaN(iVendor)) return res.status(400).json({ success: false, message: 'Invalid i_vendor.' });
      const { amount, currency, paymentNotes, paymentTime } = req.body ?? {};
      if (amount === undefined || !currency)
        return res.status(400).json({ success: false, message: 'amount and currency are required.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, message: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.sippyVendorAddFunds(username, password, iVendor, amount, currency, { paymentNotes, paymentTime }, sippyPortalUrl(settings));
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // POST /api/sippy/vendors/:id/credit — vendorCredit() — docs 151210 (Sippy 4.0+)
  // Body: { amount (req), currency (req), paymentNotes?, paymentTime? }
  // Same as add-funds but transaction labelled 'Credit'
  // Returns: { success, message }
  app.post('/api/sippy/vendors/:id/credit', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req: any, res) => {
    try {
      const iVendor = parseInt(req.params.id, 10);
      if (isNaN(iVendor)) return res.status(400).json({ success: false, message: 'Invalid i_vendor.' });
      const { amount, currency, paymentNotes, paymentTime } = req.body ?? {};
      if (amount === undefined || !currency)
        return res.status(400).json({ success: false, message: 'amount and currency are required.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, message: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.sippyVendorCredit(username, password, iVendor, amount, currency, { paymentNotes, paymentTime }, sippyPortalUrl(settings));
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ── Vendor connections (official Sippy API docs 107435) ───────────────────

  // GET /api/sippy/vendors/:id/connections — getVendorConnectionsList() — docs 107435
  // Query: namePattern? (SQL LIKE filter)
  // Returns: { connections: SippyVendorConnection[] }
  app.get('/api/sippy/vendors/:id/connections', async (req: any, res) => {
    try {
      const iVendor = parseInt(req.params.id, 10);
      if (isNaN(iVendor)) return res.status(400).json({ connections: [], error: 'Invalid i_vendor.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ connections: [], error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.listVendorConnections(username, password, iVendor, sippyPortalUrl(settings));
      res.json(result);
    } catch (e: any) { res.status(500).json({ connections: [], error: e.message }); }
  });

  // POST /api/sippy/vendors/:id/connections — createVendorConnection() — docs 107435
  // Body: { name (req), destination (req), + any VendorConnectionOpts fields }
  // Returns: { success, iConnection, message }
  app.post('/api/sippy/vendors/:id/connections', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req: any, res) => {
    try {
      const iVendor = parseInt(req.params.id, 10);
      if (isNaN(iVendor)) return res.status(400).json({ success: false, message: 'Invalid i_vendor.' });
      const { name, destination } = req.body ?? {};
      if (!name)        return res.status(400).json({ success: false, message: 'name is required.' });
      if (!destination) return res.status(400).json({ success: false, message: 'destination is required.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, message: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.createVendorConnection(username, password, { iVendor, ...req.body }, sippyPortalUrl(settings));
      res.json(result);
      regenDataflowDoc();
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // GET /api/sippy/connections/:id — getVendorConnectionInfo() — docs 107435
  // Returns: { success, connection: SippyVendorConnection }
  app.get('/api/sippy/connections/:id', async (req: any, res) => {
    try {
      const iConnection = parseInt(req.params.id, 10);
      if (isNaN(iConnection)) return res.status(400).json({ success: false, error: 'Invalid i_connection.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.getVendorConnectionInfo(username, password, iConnection, sippyPortalUrl(settings));
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // PATCH /api/sippy/connections/:id — updateVendorConnection() — docs 107435
  // Body: any subset of VendorConnectionOpts (i_vendor cannot be changed)
  // Returns: { success, message }
  app.patch('/api/sippy/connections/:id', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req: any, res) => {
    try {
      const iConnection = parseInt(req.params.id, 10);
      if (isNaN(iConnection)) return res.status(400).json({ success: false, message: 'Invalid i_connection.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, message: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.updateVendorConnection(username, password, iConnection, req.body, sippyPortalUrl(settings));
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // DELETE /api/sippy/connections/:id — deleteVendorConnection() — docs 107435
  // Returns: { success, message }
  app.delete('/api/sippy/connections/:id', (req: any, res, next) => requireRole(['admin'], req, res, next), async (req: any, res) => {
    try {
      const iConnection = parseInt(req.params.id, 10);
      if (isNaN(iConnection)) return res.status(400).json({ success: false, message: 'Invalid i_connection.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, message: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.deleteVendorConnection(username, password, iConnection, sippyPortalUrl(settings));
      res.json(result);
      regenDataflowDoc();
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ── Connection Groups (official Sippy API docs 3000135376, since SS 2025) ──
  // Note: groups attached to a trunk are not returned/updatable via these APIs.

  // GET /api/sippy/connection-groups — getConnectionGroupsList() — docs 3000135376
  // Query: namePattern?, namePatternNot?, includeMembersCount?
  // Returns: { connectionGroups: SippyConnectionGroup[] }
  app.get('/api/sippy/connection-groups', async (req: any, res) => {
    try {
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ connectionGroups: [], error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const { namePattern, namePatternNot, includeMembersCount } = req.query as Record<string, string>;
      const result = await sippy.listConnectionGroups(
        username, password,
        {
          namePattern:         namePattern         || undefined,
          namePatternNot:      namePatternNot      || undefined,
          includeMembersCount: includeMembersCount === 'true' ? true : (includeMembersCount === 'false' ? false : undefined),
        },
        sippyPortalUrl(settings),
      );
      res.json(result);
    } catch (e: any) { res.status(500).json({ connectionGroups: [], error: e.message }); }
  });

  // POST /api/sippy/connection-groups — createConnectionGroup() — docs 3000135376
  // Body: { name (req), description?, policy?, iCustomer? }
  // Returns: { success, iConnectionGroup, message }
  app.post('/api/sippy/connection-groups', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req: any, res) => {
    try {
      const { name } = req.body ?? {};
      if (!name) return res.status(400).json({ success: false, message: 'name is required.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, message: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.createConnectionGroup(username, password, req.body, sippyPortalUrl(settings));
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // GET /api/sippy/connection-groups/:id — getConnectionGroupInfo() — docs 3000135376
  // Returns: { success, connectionGroup: SippyConnectionGroup }
  app.get('/api/sippy/connection-groups/:id', async (req: any, res) => {
    try {
      const iConnectionGroup = parseInt(req.params.id, 10);
      if (isNaN(iConnectionGroup)) return res.status(400).json({ success: false, error: 'Invalid i_connection_group.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.getConnectionGroupInfo(username, password, iConnectionGroup, undefined, sippyPortalUrl(settings));
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // PATCH /api/sippy/connection-groups/:id — updateConnectionGroup() — docs 3000135376
  // Body: { name?, description?, policy? }
  // Returns: { success, iConnectionGroup, message }
  app.patch('/api/sippy/connection-groups/:id', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req: any, res) => {
    try {
      const iConnectionGroup = parseInt(req.params.id, 10);
      if (isNaN(iConnectionGroup)) return res.status(400).json({ success: false, message: 'Invalid i_connection_group.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, message: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.updateConnectionGroup(username, password, iConnectionGroup, req.body, sippyPortalUrl(settings));
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // DELETE /api/sippy/connection-groups/:id — deleteConnectionGroup() — docs 3000135376
  // Returns: { success, message }
  app.delete('/api/sippy/connection-groups/:id', (req: any, res, next) => requireRole(['admin'], req, res, next), async (req: any, res) => {
    try {
      const iConnectionGroup = parseInt(req.params.id, 10);
      if (isNaN(iConnectionGroup)) return res.status(400).json({ success: false, message: 'Invalid i_connection_group.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, message: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.deleteConnectionGroup(username, password, iConnectionGroup, undefined, sippyPortalUrl(settings));
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ── CgMembers (part of docs 3000135376) ────────────────────────────────────
  // Manage which vendor connections belong to which group and their ordering.

  // GET /api/sippy/connection-groups/:id/members — getCgMembersList() — docs 3000135376
  // Returns: { cgMembers: SippyCgMember[] }
  app.get('/api/sippy/connection-groups/:id/members', async (req: any, res) => {
    try {
      const iConnectionGroup = parseInt(req.params.id, 10);
      if (isNaN(iConnectionGroup)) return res.status(400).json({ cgMembers: [], error: 'Invalid i_connection_group.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ cgMembers: [], error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.listCgMembers(username, password, iConnectionGroup, undefined, sippyPortalUrl(settings));
      res.json(result);
    } catch (e: any) { res.status(500).json({ cgMembers: [], error: e.message }); }
  });

  // POST /api/sippy/connection-groups/:id/members — createCgMember() — docs 3000135376
  // Body: { iConnection (req), orderNo? ('first'|'last'|integer) }
  // Returns: { success, iCgMember, message }
  app.post('/api/sippy/connection-groups/:id/members', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req: any, res) => {
    try {
      const iConnectionGroup = parseInt(req.params.id, 10);
      if (isNaN(iConnectionGroup)) return res.status(400).json({ success: false, message: 'Invalid i_connection_group.' });
      const { iConnection, orderNo } = req.body ?? {};
      if (!iConnection) return res.status(400).json({ success: false, message: 'iConnection is required.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, message: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const parsedOrderNo = typeof orderNo === 'number' ? orderNo : (orderNo ?? undefined);
      const result = await sippy.createCgMember(
        username, password,
        iConnectionGroup, parseInt(iConnection, 10),
        parsedOrderNo, undefined, sippyPortalUrl(settings),
      );
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // GET /api/sippy/cg-members/:id — getCgMemberInfo() — docs 3000135376
  // Returns: { success, cgMember: SippyCgMember }
  app.get('/api/sippy/cg-members/:id', async (req: any, res) => {
    try {
      const iCgMember = parseInt(req.params.id, 10);
      if (isNaN(iCgMember)) return res.status(400).json({ success: false, error: 'Invalid i_cg_member.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.getCgMemberInfo(username, password, iCgMember, undefined, sippyPortalUrl(settings));
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // PATCH /api/sippy/cg-members/:id — updateCgMember() — docs 3000135376
  // Body: { orderNo (req): 'first'|'last'|'up'|'down'|integer, iConnection? }
  // Returns: { success, iCgMember, message }
  app.patch('/api/sippy/cg-members/:id', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req: any, res) => {
    try {
      const iCgMember = parseInt(req.params.id, 10);
      if (isNaN(iCgMember)) return res.status(400).json({ success: false, message: 'Invalid i_cg_member.' });
      const { orderNo, iConnection } = req.body ?? {};
      if (orderNo === undefined || orderNo === null)
        return res.status(400).json({ success: false, message: 'orderNo is required.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, message: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.updateCgMember(
        username, password,
        iCgMember, orderNo,
        iConnection ? parseInt(iConnection, 10) : undefined,
        undefined, sippyPortalUrl(settings),
      );
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // DELETE /api/sippy/cg-members/:id — deleteCgMember() — docs 3000135376
  // Returns: { success, message }
  app.delete('/api/sippy/cg-members/:id', (req: any, res, next) => requireRole(['admin'], req, res, next), async (req: any, res) => {
    try {
      const iCgMember = parseInt(req.params.id, 10);
      if (isNaN(iCgMember)) return res.status(400).json({ success: false, message: 'Invalid i_cg_member.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, message: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.deleteCgMember(username, password, iCgMember, undefined, sippyPortalUrl(settings));
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ── Environments (official Sippy API docs 3000043578 / 3000044255-3000044609) ─
  // Root customer + first environment only. All methods support trusted mode.

  // GET /api/sippy/switch-ips — listSwitchIPs() — docs 3000043578
  // Returns: { ips: [{ip, status}] }  status: 'AVAILABLE' | 'INUSE'
  app.get('/api/sippy/switch-ips', async (req: any, res) => {
    try {
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ ips: [], error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.listSwitchIPs(username, password, undefined, sippyPortalUrl(settings));
      res.json(result);
    } catch (e: any) { res.status(500).json({ ips: [], error: e.message }); }
  });

  // GET /api/sippy/environments — listEnvironments() — docs 3000044582
  // Query: offset?, limit?
  // Returns: { environments: SippyEnvironmentSummary[] }
  app.get('/api/sippy/environments', async (req: any, res) => {
    try {
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ environments: [], error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;
      const limit  = req.query.limit  ? parseInt(req.query.limit  as string, 10) : undefined;
      const result = await sippy.listEnvironments(username, password, { offset, limit }, sippyPortalUrl(settings));
      res.json(result);
    } catch (e: any) { res.status(500).json({ environments: [], error: e.message }); }
  });

  // POST /api/sippy/environments — createEnvironment() — docs 3000044255
  // Body: { name (req), httpsCname (req), assignedIps (req), + EnvironmentOpts }
  // Returns: { success, iEnvironment, message }
  app.post('/api/sippy/environments', (req: any, res, next) => requireRole(['admin'], req, res, next), async (req: any, res) => {
    try {
      const { name, httpsCname, assignedIps } = req.body ?? {};
      if (!name)        return res.status(400).json({ success: false, message: 'name is required.' });
      if (!httpsCname)  return res.status(400).json({ success: false, message: 'httpsCname is required.' });
      if (assignedIps === undefined)
        return res.status(400).json({ success: false, message: 'assignedIps is required (null = Unassigned).' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, message: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.createEnvironment(username, password, req.body, sippyPortalUrl(settings));
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // GET /api/sippy/environments/:id — getEnvironmentInfo() — docs 3000044572
  // Returns: { success, environment: SippyEnvironmentInfo }
  app.get('/api/sippy/environments/:id', async (req: any, res) => {
    try {
      const iEnvironment = parseInt(req.params.id, 10);
      if (isNaN(iEnvironment)) return res.status(400).json({ success: false, error: 'Invalid i_environment.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.getEnvironmentInfo(username, password, iEnvironment, undefined, sippyPortalUrl(settings));
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // PATCH /api/sippy/environments/:id — updateEnvironment() — docs 3000044284
  // Body: any subset of EnvironmentOpts
  // Returns: { success, message }
  app.patch('/api/sippy/environments/:id', (req: any, res, next) => requireRole(['admin'], req, res, next), async (req: any, res) => {
    try {
      const iEnvironment = parseInt(req.params.id, 10);
      if (isNaN(iEnvironment)) return res.status(400).json({ success: false, message: 'Invalid i_environment.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, message: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.updateEnvironment(username, password, iEnvironment, req.body, sippyPortalUrl(settings));
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // DELETE /api/sippy/environments/:id — deleteEnvironment() — docs 3000044399
  // Legacy (removed in Sippy 5.0+). Only stopped/suspended environments can be deleted.
  // Use POST /api/sippy/environments/:id/action { action: 'delete' } for 5.0+.
  // Returns: { success, message }
  app.delete('/api/sippy/environments/:id', (req: any, res, next) => requireRole(['admin'], req, res, next), async (req: any, res) => {
    try {
      const iEnvironment = parseInt(req.params.id, 10);
      if (isNaN(iEnvironment)) return res.status(400).json({ success: false, message: 'Invalid i_environment.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, message: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.deleteEnvironment(username, password, iEnvironment, undefined, sippyPortalUrl(settings));
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // POST /api/sippy/environments/:id/action — queueEnvironmentAction() — docs 3000044609
  // Body: { action: 'start'|'stop'|'restart'|'suspend'|'delete', suspendMessage? }
  // 'delete' replaces DELETE endpoint for Sippy 5.0+.
  // Returns: { success, message }
  app.post('/api/sippy/environments/:id/action', (req: any, res, next) => requireRole(['admin'], req, res, next), async (req: any, res) => {
    try {
      const iEnvironment = parseInt(req.params.id, 10);
      if (isNaN(iEnvironment)) return res.status(400).json({ success: false, message: 'Invalid i_environment.' });
      const { action, suspendMessage } = req.body ?? {};
      const validActions = ['start', 'stop', 'restart', 'suspend', 'delete'];
      if (!action || !validActions.includes(action))
        return res.status(400).json({ success: false, message: `action must be one of: ${validActions.join(', ')}.` });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, message: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.queueEnvironmentAction(
        username, password, iEnvironment, action, suspendMessage, undefined, sippyPortalUrl(settings),
      );
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ── Payments (official Sippy docs 107440/107442/107443/107446/107438/150644) ──

  // ─ Debit/Credit Cards (doc 107442) ──────────────────────────────────────────

  // GET /api/sippy/cards — listDebitCreditCards() — docs 107442
  // Query: iAccount? OR iCustomer? (at least one required), offset?, limit?
  // Returns: { cards: SippyDebitCreditCard[] }
  app.get('/api/sippy/cards', async (req: any, res) => {
    try {
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ cards: [], error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const iAccount  = req.query.iAccount  ? parseInt(req.query.iAccount as string, 10)  : undefined;
      const iCustomer = req.query.iCustomer ? parseInt(req.query.iCustomer as string, 10) : undefined;
      if (!iAccount && !iCustomer)
        return res.status(400).json({ cards: [], error: 'iAccount or iCustomer is required.' });
      const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;
      const limit  = req.query.limit  ? parseInt(req.query.limit  as string, 10) : undefined;
      const result = await sippy.listDebitCreditCards(username, password, { iAccount, iCustomer }, { offset, limit }, sippyPortalUrl(settings));
      res.json(result);
    } catch (e: any) { res.status(500).json({ cards: [], error: e.message }); }
  });

  // POST /api/sippy/cards — addDebitCreditCard() — docs 107442
  // Body: { iAccount? OR iCustomer?, alias, iCardType, number, holder, expMm, expYy,
  //         streetAddr1, state, postalCode, city, country, phone, cvv?, streetAddr2?, primary? }
  // Returns: { success, iDebitCreditCard, message }
  app.post('/api/sippy/cards', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req: any, res) => {
    try {
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, message: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const { iAccount, iCustomer, ...opts } = req.body ?? {};
      if (!iAccount && !iCustomer)
        return res.status(400).json({ success: false, message: 'iAccount or iCustomer is required.' });
      const required = ['alias', 'iCardType', 'number', 'holder', 'expMm', 'expYy', 'streetAddr1', 'state', 'postalCode', 'city', 'country', 'phone'];
      for (const f of required) if (!opts[f]) return res.status(400).json({ success: false, message: `${f} is required.` });
      const result = await sippy.addDebitCreditCard(username, password, { iAccount, iCustomer }, opts, sippyPortalUrl(settings));
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // GET /api/sippy/cards/:id — getDebitCreditCardInfo() — docs 107442
  // Query: iAccount? OR iCustomer? (at least one required)
  // Returns: { success, card: SippyDebitCreditCard }
  app.get('/api/sippy/cards/:id', async (req: any, res) => {
    try {
      const iDebitCreditCard = parseInt(req.params.id, 10);
      if (isNaN(iDebitCreditCard)) return res.status(400).json({ success: false, error: 'Invalid i_debit_credit_card.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const iAccount  = req.query.iAccount  ? parseInt(req.query.iAccount  as string, 10) : undefined;
      const iCustomer = req.query.iCustomer ? parseInt(req.query.iCustomer as string, 10) : undefined;
      const result = await sippy.getDebitCreditCardInfo(username, password, iDebitCreditCard, { iAccount, iCustomer }, sippyPortalUrl(settings));
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // PATCH /api/sippy/cards/:id — updateDebitCreditCard() — docs 107442
  // Body: { iAccount? OR iCustomer?, + any DebitCreditCardOpts fields }
  // Returns: { success, message }
  app.patch('/api/sippy/cards/:id', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req: any, res) => {
    try {
      const iDebitCreditCard = parseInt(req.params.id, 10);
      if (isNaN(iDebitCreditCard)) return res.status(400).json({ success: false, message: 'Invalid i_debit_credit_card.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, message: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const { iAccount, iCustomer, ...opts } = req.body ?? {};
      const result = await sippy.updateDebitCreditCard(username, password, iDebitCreditCard, { iAccount, iCustomer }, opts, sippyPortalUrl(settings));
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // DELETE /api/sippy/cards/:id — deleteDebitCreditCard() — docs 107442
  // Query: iAccount? OR iCustomer? (at least one required)
  // Returns: { success, message }
  app.delete('/api/sippy/cards/:id', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req: any, res) => {
    try {
      const iDebitCreditCard = parseInt(req.params.id, 10);
      if (isNaN(iDebitCreditCard)) return res.status(400).json({ success: false, message: 'Invalid i_debit_credit_card.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, message: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const iAccount  = req.query.iAccount  ? parseInt(req.query.iAccount  as string, 10) : undefined;
      const iCustomer = req.query.iCustomer ? parseInt(req.query.iCustomer as string, 10) : undefined;
      const result = await sippy.deleteDebitCreditCard(username, password, iDebitCreditCard, { iAccount, iCustomer }, sippyPortalUrl(settings));
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ─ Account Balance Mutations (doc 107440) ───────────────────────────────────

  // POST /api/sippy/accounts/:id/add-funds — accountAddFunds() — docs 107440
  // Body: { amount (req), currency (req), paymentNotes?, paymentTime? }
  // Returns: { success, message }
  app.post('/api/sippy/accounts/:id/add-funds', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req: any, res) => {
    try {
      const iAccount = parseInt(req.params.id, 10);
      if (isNaN(iAccount)) return res.status(400).json({ success: false, message: 'Invalid i_account.' });
      const { amount, currency, paymentNotes, paymentTime } = req.body ?? {};
      if (!amount || !currency) return res.status(400).json({ success: false, message: 'amount and currency are required.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, message: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.accountAddFunds(username, password, iAccount, amount, currency, { paymentNotes, paymentTime }, sippyPortalUrl(settings));
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // POST /api/sippy/accounts/:id/credit — accountCredit() — docs 107440
  // Body: { amount (req), currency (req), paymentNotes?, paymentTime? }
  // Returns: { success, message }
  app.post('/api/sippy/accounts/:id/credit', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req: any, res) => {
    try {
      const iAccount = parseInt(req.params.id, 10);
      if (isNaN(iAccount)) return res.status(400).json({ success: false, message: 'Invalid i_account.' });
      const { amount, currency, paymentNotes, paymentTime } = req.body ?? {};
      if (!amount || !currency) return res.status(400).json({ success: false, message: 'amount and currency are required.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, message: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.accountCredit(username, password, iAccount, amount, currency, { paymentNotes, paymentTime }, sippyPortalUrl(settings));
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // POST /api/sippy/accounts/:id/debit — accountDebit() — docs 107440
  // Body: { amount (req), currency (req), paymentNotes?, paymentTime? }
  // Returns: { success, message }
  app.post('/api/sippy/accounts/:id/debit', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req: any, res) => {
    try {
      const iAccount = parseInt(req.params.id, 10);
      if (isNaN(iAccount)) return res.status(400).json({ success: false, message: 'Invalid i_account.' });
      const { amount, currency, paymentNotes, paymentTime } = req.body ?? {};
      if (!amount || !currency) return res.status(400).json({ success: false, message: 'amount and currency are required.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, message: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.accountDebit(username, password, iAccount, amount, currency, { paymentNotes, paymentTime }, sippyPortalUrl(settings));
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ─ Customer Balance Mutations (doc 150644) ──────────────────────────────────

  // POST /api/sippy/customers/:id/add-funds — customerAddFunds() — docs 150644
  // Body: { amount (req), currency (req), paymentNotes?, paymentTime? }
  // Returns: { success, message }
  app.post('/api/sippy/customers/:id/add-funds', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req: any, res) => {
    try {
      const iCustomer = parseInt(req.params.id, 10);
      if (isNaN(iCustomer)) return res.status(400).json({ success: false, message: 'Invalid i_customer.' });
      const { amount, currency, paymentNotes, paymentTime } = req.body ?? {};
      if (!amount || !currency) return res.status(400).json({ success: false, message: 'amount and currency are required.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, message: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.customerAddFunds(username, password, iCustomer, amount, currency, { paymentNotes, paymentTime }, sippyPortalUrl(settings));
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // POST /api/sippy/customers/:id/credit — customerCredit() — docs 150644
  // Body: { amount (req), currency (req), paymentNotes?, paymentTime? }
  // Returns: { success, message }
  app.post('/api/sippy/customers/:id/credit', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req: any, res) => {
    try {
      const iCustomer = parseInt(req.params.id, 10);
      if (isNaN(iCustomer)) return res.status(400).json({ success: false, message: 'Invalid i_customer.' });
      const { amount, currency, paymentNotes, paymentTime } = req.body ?? {};
      if (!amount || !currency) return res.status(400).json({ success: false, message: 'amount and currency are required.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, message: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.customerCredit(username, password, iCustomer, amount, currency, { paymentNotes, paymentTime }, sippyPortalUrl(settings));
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // POST /api/sippy/customers/:id/debit — customerDebit() — docs 150644
  // Body: { amount (req), currency (req), paymentNotes?, paymentTime? }
  // Returns: { success, message }
  app.post('/api/sippy/customers/:id/debit', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req: any, res) => {
    try {
      const iCustomer = parseInt(req.params.id, 10);
      if (isNaN(iCustomer)) return res.status(400).json({ success: false, message: 'Invalid i_customer.' });
      const { amount, currency, paymentNotes, paymentTime } = req.body ?? {};
      if (!amount || !currency) return res.status(400).json({ success: false, message: 'amount and currency are required.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, message: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.customerDebit(username, password, iCustomer, amount, currency, { paymentNotes, paymentTime }, sippyPortalUrl(settings));
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ─ Payment Details (doc 107446) ─────────────────────────────────────────────

  // GET /api/sippy/payments/:id — getPaymentInfo() — docs 107446
  // Query: iAccount? OR iCustomer? (at least one required)
  // Returns: { success, payment: SippyPayment }
  app.get('/api/sippy/payments/:id', async (req: any, res) => {
    try {
      const iPayment = parseInt(req.params.id, 10);
      if (isNaN(iPayment)) return res.status(400).json({ success: false, error: 'Invalid i_payment.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const iAccount  = req.query.iAccount  ? parseInt(req.query.iAccount  as string, 10) : undefined;
      const iCustomer = req.query.iCustomer ? parseInt(req.query.iCustomer as string, 10) : undefined;
      const result = await sippy.getPaymentInfo(username, password, iPayment, { iAccount, iCustomer }, undefined, sippyPortalUrl(settings));
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // GET /api/sippy/payments — getPaymentsList() — docs 107446
  // Query: iAccount?, iCustomer?, offset?, limit?, startDate?, endDate?, type? ('credit'|'debit')
  // Returns: { payments: SippyPayment[] }
  app.get('/api/sippy/payments', async (req: any, res) => {
    try {
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ payments: [], error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const q = req.query as Record<string, string>;
      const result = await sippy.getPaymentsList(username, password, {
        iAccount:    q.iAccount    ? parseInt(q.iAccount, 10)    : undefined,
        iCustomer:   q.iCustomer   ? parseInt(q.iCustomer, 10)   : undefined,
        offset:      q.offset      ? parseInt(q.offset, 10)      : undefined,
        limit:       q.limit       ? parseInt(q.limit, 10)       : undefined,
        startDate:   q.startDate   || undefined,
        endDate:     q.endDate     || undefined,
        type:        (q.type === 'credit' || q.type === 'debit') ? q.type : undefined,
      }, sippyPortalUrl(settings));
      res.json(result);
    } catch (e: any) { res.status(500).json({ payments: [], error: e.message }); }
  });

  // ─ Recharge Voucher (doc 107438) ────────────────────────────────────────────

  // POST /api/sippy/accounts/:id/voucher — rechargeVoucher() — docs 107438
  // Body: { voucherId (req), secretPin?, iVoucher? (trusted mode) }
  // Returns: { success, value, voucherCurrency, payerAmount }
  app.post('/api/sippy/accounts/:id/voucher', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req: any, res) => {
    try {
      const iAccount = parseInt(req.params.id, 10);
      if (isNaN(iAccount)) return res.status(400).json({ success: false, message: 'Invalid i_account.' });
      const { voucherId, secretPin, iVoucher } = req.body ?? {};
      if (!voucherId && !iVoucher)
        return res.status(400).json({ success: false, message: 'voucherId or iVoucher is required.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, message: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.rechargeVoucher(username, password, { iAccount, voucherId, secretPin, iVoucher }, sippyPortalUrl(settings));
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ─ Card Payments (doc 107443) ────────────────────────────────────────────────

  // POST /api/sippy/payments — makePayment() — docs 107443
  // Body: { iAccount? OR iCustomer?, amount, currency, payerIpAddress, iDebitCreditCard? }
  // Returns: { success, result ('OK'|'FAILED'|'PENDING'), iPayment }
  app.post('/api/sippy/payments', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req: any, res) => {
    try {
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, message: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const { iAccount, iCustomer, amount, currency, payerIpAddress, iDebitCreditCard } = req.body ?? {};
      if (!amount || !currency || !payerIpAddress)
        return res.status(400).json({ success: false, message: 'amount, currency and payerIpAddress are required.' });
      if (!iAccount && !iCustomer)
        return res.status(400).json({ success: false, message: 'iAccount or iCustomer is required.' });
      const result = await sippy.makePayment(
        username, password,
        { iAccount, iCustomer }, amount, currency, payerIpAddress,
        { iDebitCreditCard },
        sippyPortalUrl(settings),
      );
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // POST /api/sippy/payments/by-card — makePaymentByCard() — docs 107443
  // Body: { iAccount? OR iCustomer?, amount, currency, payerIpAddress, + full card details }
  // Returns: { success, result ('OK'|'FAILED'|'PENDING'), iPayment }
  app.post('/api/sippy/payments/by-card', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req: any, res) => {
    try {
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, message: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const { iAccount, iCustomer, amount, currency, payerIpAddress, iWholesaler, ...card } = req.body ?? {};
      if (!amount || !currency || !payerIpAddress)
        return res.status(400).json({ success: false, message: 'amount, currency and payerIpAddress are required.' });
      if (!iAccount && !iCustomer)
        return res.status(400).json({ success: false, message: 'iAccount or iCustomer is required.' });
      const required = ['iCardType', 'number', 'expMm', 'expYy', 'holder', 'streetAddr1', 'state', 'postalCode', 'city', 'country', 'phone'];
      for (const f of required) if (!card[f]) return res.status(400).json({ success: false, message: `${f} is required.` });
      const result = await sippy.makePaymentByCard(
        username, password,
        { iAccount, iCustomer }, amount, currency, payerIpAddress,
        card, iWholesaler, sippyPortalUrl(settings),
      );
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ── Tariff management (official Sippy API) ────────────────────────────────

  // POST /api/sippy/tariffs/create — create a new tariff
  app.post('/api/sippy/tariffs/create', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req, res) => {
    try {
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const { name, currency, connectFee, freeSeconds } = req.body;
      if (!name || !currency) return res.status(400).json({ success: false, message: 'name and currency are required' });
      const result = await sippy.createSippyTariff(username, password, { name, currency, connectFee, freeSeconds });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // DELETE /api/sippy/tariffs/:id — delete a tariff
  app.delete('/api/sippy/tariffs/:id', (req: any, res, next) => requireRole(['admin'], req, res, next), async (req, res) => {
    try {
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.deleteSippyTariff(username, password, parseInt(req.params.id, 10));
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ── Balance Daemon — XML-RPC management methods (docs 3000070859) ─────────

  // GET /api/sippy/balances?ids=1,2,3 — fetch balance entities by i_balance IDs
  // Returns balance, credit_limit, commodity, available_balance for each entity.
  app.get('/api/sippy/balances', async (req, res) => {
    try {
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const ids = String(req.query.ids || '').split(',').map(Number).filter(n => !isNaN(n) && n > 0);
      if (!ids.length) return res.json({ balances: [] });
      const balances = await sippy.getSippyBalances(username, password, ids);
      res.json({ balances });
    } catch (e: any) { res.status(500).json({ balances: [], error: e.message }); }
  });

  // GET /api/sippy/balance-totals?ids=1,2,3 — aggregate balance totals grouped by commodity
  // Pass comma-separated i_balance IDs (from customer/account records) to get currency totals.
  app.get('/api/sippy/balance-totals', async (req, res) => {
    try {
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const ids = String(req.query.ids || '').split(',').map(Number).filter(n => !isNaN(n) && n > 0);
      if (!ids.length) return res.json({ totals: [] });
      const totals = await sippy.getSippyBalanceTotals(username, password, ids);
      res.json({ totals });
    } catch (e: any) { res.status(500).json({ totals: [], error: e.message }); }
  });

  // POST /api/sippy/balances — create a new balance entity (docs 3000070859)
  // Body: { balance, creditLimit, commodity, refCount }
  app.post('/api/sippy/balances', async (req: any, res) => {
    try {
      const { balance, creditLimit, commodity, refCount } = req.body ?? {};
      if (balance === undefined || creditLimit === undefined || !commodity || refCount === undefined)
        return res.status(400).json({ success: false, error: 'balance, creditLimit, commodity and refCount are required.' });
      if (Number(refCount) < 1)
        return res.status(400).json({ success: false, error: 'refCount must be at least 1.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.createSippyBalance(username, password, {
        balance: Number(balance), creditLimit: Number(creditLimit),
        commodity: String(commodity), refCount: Number(refCount),
        portalUrl: sippyPortalUrl(settings),
      });
      if (!result.success) return res.status(422).json({ success: false, error: result.message });
      res.status(201).json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // POST /api/sippy/balances/:id/inc-ref — increment reference counter (docs 3000070859)
  // Body: { iBalanceUpdate } — unique update token (use 0 when calling from XML-RPC management path)
  app.post('/api/sippy/balances/:id/inc-ref', async (req: any, res) => {
    try {
      const iBalance = parseInt(req.params.id, 10);
      if (isNaN(iBalance)) return res.status(400).json({ success: false, error: 'Invalid i_balance.' });
      const iBalanceUpdate = parseInt(req.body?.iBalanceUpdate ?? '0', 10);
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.incSippyBalanceRefCount(username, password, iBalance, iBalanceUpdate, sippyPortalUrl(settings));
      if (!result.success) return res.status(422).json({ success: false, error: result.message });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // POST /api/sippy/balances/:id/dec-ref — decrement reference counter (docs 3000070859)
  // Body: { iBalanceUpdate }
  app.post('/api/sippy/balances/:id/dec-ref', async (req: any, res) => {
    try {
      const iBalance = parseInt(req.params.id, 10);
      if (isNaN(iBalance)) return res.status(400).json({ success: false, error: 'Invalid i_balance.' });
      const iBalanceUpdate = parseInt(req.body?.iBalanceUpdate ?? '0', 10);
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.decSippyBalanceRefCount(username, password, iBalance, iBalanceUpdate, sippyPortalUrl(settings));
      if (!result.success) return res.status(422).json({ success: false, error: result.message });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // ── SNMP Monitoring (Sippy SNMP — docs 81166) ─────────────────────────────

  // GET /api/sippy/snmp/stats — query live SNMP statistics from the Sippy switch.
  // Returns active calls, connected calls, accumulative counters, ACD, ASR, and RTP stats.
  // SNMP must be enabled in settings (snmpEnabled=true) with a valid host + community.
  app.get('/api/sippy/snmp/stats', async (_req, res) => {
    try {
      const settings = await storage.getSettings();
      if (!settings.snmpEnabled) {
        return res.json({ ok: false, error: 'SNMP monitoring is disabled. Enable it in Settings → Sippy → SNMP.' });
      }
      // Resolve host: use explicit snmpHost if set, else extract from portalUrl
      const host = settings.snmpHost?.trim() ||
        (settings.portalUrl ? sippySnmp.hostFromUrl(settings.portalUrl) : null);
      if (!host) {
        return res.json({ ok: false, error: 'SNMP host not configured. Set it in Settings or configure a Portal URL.' });
      }
      const port      = settings.snmpPort      ?? 161;
      const community = settings.snmpCommunity ?? 'public';
      const envIds    = (settings.snmpEnvironments ?? '1')
        .split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && n > 0);

      const result = await sippySnmp.querySippySnmp(host, port, community, envIds);
      res.json(result);
    } catch (e: any) {
      res.json({ ok: false, error: e.message });
    }
  });

  // POST /api/sippy/snmp/test — test SNMP connectivity with given parameters.
  // Body: { host, port?, community?, environments? }
  app.post('/api/sippy/snmp/test', async (req, res) => {
    try {
      const { host, port = 161, community = 'public', environments = '1' } = req.body as {
        host?: string; port?: number; community?: string; environments?: string;
      };
      if (!host) return res.status(400).json({ ok: false, error: 'host is required.' });
      const envIds = environments.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && n > 0);
      const result = await sippySnmp.querySippySnmp(host, Number(port), community, envIds);
      res.json(result);
    } catch (e: any) {
      res.json({ ok: false, error: e.message });
    }
  });

  // ── EMAIL ALERT CONFIGURATION ─────────────────────────────────────────────

  // GET /api/alert-config — get current email alert settings
  app.get('/api/alert-config', async (req: any, res) => {
    try {
      const s = await storage.getSettings();
      res.json({
        alertEnabled: s.alertEnabled,
        alertAdminEmail: s.alertAdminEmail,
        alertGmailUser: s.alertGmailUser,
        alertGmailAppPass: s.alertGmailAppPass ? '***' : '',
        balanceAlertThreshold: s.balanceAlertThreshold,
        fasMinPddSecs: s.fasMinPddSecs,
        fasMaxBillSecs: s.fasMaxBillSecs,
        fasEarlyAnswerSecs: s.fasEarlyAnswerSecs,
        fasShortCallSecs: s.fasShortCallSecs,
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // PATCH /api/alert-config — update email alert settings
  app.patch('/api/alert-config', (req: any, res, next) => requireRole(['admin'], req, res, next), async (req, res) => {
    try {
      const updates: Record<string, any> = {};
      if (req.body.alertEnabled !== undefined) updates.alertEnabled = !!req.body.alertEnabled;
      if (req.body.alertAdminEmail !== undefined) updates.alertAdminEmail = req.body.alertAdminEmail;
      if (req.body.alertGmailUser !== undefined) updates.alertGmailUser = req.body.alertGmailUser;
      if (req.body.alertGmailAppPass !== undefined && req.body.alertGmailAppPass !== '***') {
        updates.alertGmailAppPass = req.body.alertGmailAppPass;
      }
      if (req.body.balanceAlertThreshold !== undefined) updates.balanceAlertThreshold = Number(req.body.balanceAlertThreshold);
      if (req.body.fasMinPddSecs !== undefined) updates.fasMinPddSecs = Number(req.body.fasMinPddSecs);
      if (req.body.fasMaxBillSecs !== undefined) updates.fasMaxBillSecs = Number(req.body.fasMaxBillSecs);
      if (req.body.fasEarlyAnswerSecs !== undefined) updates.fasEarlyAnswerSecs = Number(req.body.fasEarlyAnswerSecs);
      if (req.body.fasShortCallSecs !== undefined) updates.fasShortCallSecs = Number(req.body.fasShortCallSecs);
      await storage.updateSettings(updates);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/alert-config/test — verify Gmail connection
  app.post('/api/alert-config/test', (req: any, res, next) => requireRole(['admin'], req, res, next), async (_req, res) => {
    const result = await emailSvc.testEmailConfig();
    res.json(result);
  });

  // ── FAS EVENTS ────────────────────────────────────────────────────────────

  // GET /api/fas-events — list recorded FAS events
  app.get('/api/fas-events', async (req: any, res) => {
    try {
      const limit = req.query.limit ? Math.min(500, Number(req.query.limit)) : 100;
      const events = await storage.getFasEvents(limit);

      // Find first non-numeric vendor name from cache (works regardless of how many vendors exist)
      let firstVendorName = '';
      for (const val of connectionVendorCache.values()) {
        if (!/^\d+$/.test(val)) { firstVendorName = val; break; }
      }

      // If we have a vendor name and there are empty-vendor rows, permanently backfill them in DB
      if (firstVendorName) {
        const backfilled = await storage.backfillFasEventVendors(firstVendorName);
        if (backfilled > 0) {
          console.log(`[fas-events] DB-backfilled vendor="${firstVendorName}" on ${backfilled} events`);
          // Re-fetch so response reflects the updated rows
          const updated = await storage.getFasEvents(limit);
          const resolved = updated.map(e => {
            let clientName = e.clientName;
            if (!clientName || clientName.match(/^Acct[#.]?\d+$/i)) {
              const m = clientName?.match(/\d+/);
              clientName = (m ? accountNameCache.get(m[0]) : undefined) ?? clientName ?? 'Unknown';
            }
            return { ...e, clientName };
          });
          return res.json({ events: resolved });
        }
      }

      // Normal path — re-resolve stale client names; vendor is already correct in DB
      const resolved = events.map(e => {
        let clientName = e.clientName;
        if (!clientName || clientName.match(/^Acct[#.]?\d+$/i)) {
          const m = clientName?.match(/\d+/);
          clientName = (m ? accountNameCache.get(m[0]) : undefined) ?? clientName ?? 'Unknown';
        }
        // In-memory vendor fallback in case DB still has empty (should not happen after backfill above)
        const vendor = e.vendor || firstVendorName;
        return { ...e, clientName, vendor };
      });
      res.json({ events: resolved });
    } catch (e: any) { res.status(500).json({ events: [], error: e.message }); }
  });

  // POST /api/fas/analyze — fetch Sippy CDRs for a date range and run full FAS analysis.
  // Stores new FAS events in DB and returns vendor-level fraud scoring.
  // Body: { startDate, endDate, limit? }
  app.post('/api/fas/analyze', async (req: any, res) => {
    try {
      const settings = await storage.getSettings();
      const credPairs = sippyXmlCredsPairs(settings);

      const startDate = req.body.startDate ?? sippy.toSippyDate(new Date(Date.now() - 86400000));
      const endDate   = req.body.endDate   ?? sippy.toSippyDate(new Date());
      const limit     = Math.min(1000, Number(req.body.limit ?? 500));

      const fasMinPdd          = settings.fasMinPddSecs ?? 10;
      const fasMaxBill         = settings.fasMaxBillSecs ?? 5;
      const fasEarlyAnswerSecs = settings.fasEarlyAnswerSecs ?? 2;
      const fasShortCallSecs   = settings.fasShortCallSecs ?? 10;

      // Fetch CDRs from Sippy — try each credential pair (handles swapped settings in DB)
      let cdrs: Awaited<ReturnType<typeof sippy.getSippyCDRs>> = [];
      for (const { username, password } of credPairs) {
        cdrs = await sippy.getSippyCDRs(username, password, limit, { startDate, endDate });
        if (cdrs.length > 0) break;
      }

      if (cdrs.length === 0) {
        return res.json({ analyzed: 0, fasEvents: 0, vendorScores: [], message: 'No CDRs found for the selected period.' });
      }

      // Enrich every CDR with FAS analysis
      // Sippy CDR result field: '0' = success (SIP 200 OK); other values are SIP response codes (486, 603, etc.)
      type EnrichedRow = {
        callId?: string; caller?: string; callee?: string;
        clientName?: string; vendor?: string;
        sipCode?: number | null; pddSecs?: number | null; billSecs?: number | null;
        isFas: boolean; fasReason: string; fraudScore: number; reason?: string;
      };
      const enriched: EnrichedRow[] = cdrs.map(cdr => {
        // Map Sippy result string → numeric SIP code (0 = success → 200)
        const rawResult = parseInt(String(cdr.result ?? '').trim()) || 0;
        const sipCodeVal: number | null = rawResult === 0 ? 200 : (rawResult >= 100 ? rawResult : null);
        // cdr.duration = billed_duration in seconds (the correct field for billing)
        const billSecsVal = cdr.duration ?? 0;
        // Use pdd1xx (time to 1st SIP response) as PDD for FAS detection.
        // cdr.pdd is Sippy's internal conn_proc_time (~5ms), not the ring delay.
        // pdd1xx is the actual post-dial delay (SIP INVITE → first 1xx response).
        const ringDelay = cdr.pdd1xx ?? cdr.pdd ?? null;
        const fasResult = detectFas({
          sipCode:  sipCodeVal,
          pddSecs:  ringDelay,
          billSecs: billSecsVal,
          fasMinPddSecs:    fasMinPdd,
          fasMaxBillSecs:   fasMaxBill,
          fasEarlyAnswerSecs,
          fasShortCallSecs,
        });
        // Resolve client name: prefer clientName from CDR, then cdr.user (raw Sippy field),
        // then accountNameCache by accountId/iAccount (raw Sippy field is accountId, not iAccount)
        const resolvedClient = cdr.clientName
          || cdr.user
          || accountNameCache.get(String(cdr.accountId ?? cdr.iAccount ?? ''))
          || (cdr.accountId ? `Acct#${cdr.accountId}` : cdr.iAccount ? `Acct#${cdr.iAccount}` : 'Unknown');
        // Resolve vendor: prefer CDR field, then connection cache, then first known vendor
        const resolvedVendor = (() => {
          if (cdr.vendor) return cdr.vendor;
          if (cdr.iConnection) {
            const v = connectionVendorCache.get(String(cdr.iConnection));
            if (v && !/^\d+$/.test(v)) return v;
          }
          // Fallback: first non-numeric vendor name found in cache (works for any number of vendors)
          for (const val of connectionVendorCache.values()) {
            if (!/^\d+$/.test(val)) return val;
          }
          return '';
        })();
        return {
          callId:     cdr.callId ?? '',
          caller:     cdr.caller ?? '',
          callee:     cdr.callee ?? '',
          clientName: resolvedClient,
          vendor:     resolvedVendor,
          sipCode:    sipCodeVal,
          pddSecs:    ringDelay,
          billSecs:   billSecsVal,
          isFas:      fasResult.isFas,
          fasReason:  fasResult.reason,
          fraudScore: fasResult.fraudScore,
          reason:     fasResult.reason,
        };
      });

      // Store new FAS events (skip duplicates silently)
      let savedCount = 0;
      for (const r of enriched) {
        if (r.isFas && r.callId) {
          try {
            await storage.createFasEvent({
              callId:     String(r.callId),
              caller:     r.caller ?? '',
              callee:     r.callee ?? '',
              clientName: r.clientName ?? '',
              vendor:     r.vendor ?? '',
              pddSecs:    r.pddSecs ?? null,
              billSecs:   r.billSecs ?? null,
              sipCode:    r.sipCode ?? null,
              reason:     r.fasReason,
              fraudScore: r.fraudScore,
              alertSent:  false,
            });
            savedCount++;
          } catch { /* duplicate */ }
        }
      }

      // Build risk scores grouped by CLIENT name (vendor not available in CDR API)
      const byClient: Record<string, typeof enriched> = {};
      for (const r of enriched) {
        const v = r.clientName || 'Unknown';
        if (!byClient[v]) byClient[v] = [];
        byClient[v].push(r);
      }
      const vendorScores = Object.entries(byClient).map(([vendor, rows]) =>
        calcVendorFraudStats(vendor, rows.map(r => ({
          sipCode: r.sipCode, pddSecs: r.pddSecs, billSecs: r.billSecs,
          reason: r.reason, isFas: r.isFas, fraudScore: r.fraudScore,
        })))
      ).sort((a, b) => b.fraudScore - a.fraudScore);

      res.json({ analyzed: enriched.length, fasEvents: savedCount, vendorScores });
    } catch (e: any) { res.status(500).json({ analyzed: 0, fasEvents: 0, vendorScores: [], error: e.message }); }
  });

  // GET /api/fas/vendor-scores — compute client-level fraud scores from stored FAS events in DB
  app.get('/api/fas/vendor-scores', async (_req, res) => {
    try {
      const events = await storage.getFasEvents(500);
      const byClient: Record<string, typeof events> = {};
      for (const e of events) {
        let name = e.clientName || e.vendor || 'Unknown';
        // Re-resolve stale "Acct#N" names from the live account name cache
        if (name.match(/^Acct[#.]?\d+$/i)) {
          const m = name.match(/\d+/);
          name = (m ? accountNameCache.get(m[0]) : undefined) ?? name;
        }
        if (!byClient[name]) byClient[name] = [];
        byClient[name].push(e);
      }
      const vendorScores = Object.entries(byClient).map(([vendor, rows]) =>
        calcVendorFraudStats(vendor, rows.map(r => ({
          sipCode: r.sipCode, pddSecs: r.pddSecs, billSecs: r.billSecs,
          reason: r.reason, isFas: true, fraudScore: r.fraudScore ?? 0,
        })))
      ).sort((a, b) => b.fraudScore - a.fraudScore);
      res.json({ vendorScores });
    } catch (e: any) { res.status(500).json({ vendorScores: [], error: e.message }); }
  });

  // ── CDR ENRICHMENT ENDPOINT ───────────────────────────────────────────────
  // POST /api/enrich-cdr — enriches a batch of CDR records with country, trunk class, FAS, etc.
  // Used by the frontend to enhance CDR data from Sippy/VOS3000

  app.post('/api/enrich-cdr', async (req, res) => {
    try {
      const settings = await storage.getSettings();
      const cdrs: any[] = req.body.cdrs ?? [];
      const fasMinPdd          = settings.fasMinPddSecs ?? 10;
      const fasMaxBill         = settings.fasMaxBillSecs ?? 5;
      const fasEarlyAnswerSecs = settings.fasEarlyAnswerSecs ?? 2;
      const fasShortCallSecs   = settings.fasShortCallSecs ?? 10;

      const enriched = cdrs.map(cdr => {
        const result = enrichCdr({
          caller: cdr.caller ?? cdr.cli ?? '',
          callee: cdr.callee ?? cdr.cld ?? '',
          accountId: cdr.accountId ?? cdr.iAccount ?? cdr.i_account ?? null,
          sipCode: cdr.sipCode ?? cdr.disconnect_code ?? null,
          pddSecs: cdr.pdd ?? null,
          billSecs: cdr.billSecs ?? cdr.billed_duration ?? null,
          fasMinPddSecs: fasMinPdd,
          fasMaxBillSecs: fasMaxBill,
          fasEarlyAnswerSecs,
          fasShortCallSecs,
        });
        return { ...cdr, ...result };
      });

      // Record any new FAS detections
      for (const cdr of enriched) {
        if (cdr.isFas && cdr.callId) {
          try {
            const event = await storage.createFasEvent({
              callId: String(cdr.callId ?? cdr.call_id ?? cdr.id ?? ''),
              caller: cdr.caller ?? cdr.cli ?? '',
              callee: cdr.callee ?? cdr.cld ?? '',
              vendor: cdr.vendor ?? '',
              pddSecs: cdr.pddSecs ?? null,
              billSecs: cdr.billSecs ?? null,
              sipCode: cdr.sipCode ?? null,
              reason: cdr.fasReason ?? '',
              fraudScore: cdr.fraudScore ?? null,
              alertSent: false,
            });
            // Fire email alert (non-blocking)
            const emailPayload = emailSvc.buildFasAlertEmail({
              callId: event.callId,
              caller: event.caller ?? '',
              callee: event.callee ?? '',
              vendor: event.vendor ?? '',
              pddSecs: event.pddSecs ?? 0,
              billSecs: event.billSecs ?? 0,
              reason: event.reason ?? '',
            });
            emailSvc.sendAlertEmail(emailPayload).then(sent => {
              if (sent) storage.markFasAlertSent(event.id);
            });
            // WhatsApp alert (non-blocking)
            waSvc.sendWhatsAppAlert('fas', waSvc.formatFasAlert({
              callId: event.callId, caller: event.caller ?? '', callee: event.callee ?? '',
              vendor: event.vendor ?? '', pddSecs: event.pddSecs ?? 0,
              billSecs: event.billSecs ?? 0, reason: event.reason ?? '',
            })).catch(() => {});
          } catch {
            // skip duplicate
          }
        }
      }

      res.json({ enriched });
    } catch (e: any) { res.status(500).json({ enriched: [], error: e.message }); }
  });

  // GET /api/sippy/accounts/:id/info — retrieve all attributes of an account (docs 107327)
  // Query: accountUsername (lookup by username instead of i_account), iCustomer (trusted mode, 2024+)
  app.get('/api/sippy/accounts/:id/info', async (req: any, res) => {
    try {
      const iAccount = parseInt(req.params.id, 10);
      if (isNaN(iAccount)) return res.status(400).json({ error: 'Invalid i_account.' });
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const iCustomer = req.query.iCustomer ? parseInt(req.query.iCustomer as string, 10) : undefined;
      const info = await sippy.getAccountInfo(username, password, sippyPortalUrl(settings), iAccount, undefined, iCustomer);
      if (!info) return res.status(404).json({ error: 'Account not found or Sippy returned a fault.' });
      res.json(info);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── ACCOUNT MONITORING — balance alerts ───────────────────────────────────
  // POST /api/sippy/accounts/:id/check-balance — explicitly check & alert on low balance
  app.post('/api/sippy/accounts/:id/check-balance', async (req: any, res) => {
    try {
      const iAccount = Number(req.params.id);
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const info = await sippy.getAccountInfo(username, password, sippyPortalUrl(settings), iAccount);
      const balance = info?.balance ?? 0;
      const creditLimit = info?.creditLimit ?? 0;   // camelCase (was credit_limit)
      const threshold = settings.balanceAlertThreshold ?? 10;
      const accountName = info?.name ?? `Account #${iAccount}`;

      const isLow = balance < threshold;
      if (isLow) {
        const emailPayload = emailSvc.buildBalanceAlertEmail({ accountName, balance, creditLimit, threshold });
        const profiles = await storage.getClientProfiles();
        const match = profiles.find(p => p.name?.toLowerCase() === accountName?.toLowerCase());
        await emailSvc.sendAlertEmail({ ...emailPayload, clientEmail: match?.alertEmail });
        // WhatsApp alert (non-blocking)
        waSvc.sendWhatsAppAlert('balance', waSvc.formatBalanceAlert({ accountName, balance, creditLimit, threshold })).catch(() => {});
      }
      res.json({ ok: true, balance, creditLimit, isLow, accountName });
    } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ── Web User Block / Unblock (docs 3000121328, Sippy 2023+) ─────────────────

  // POST /api/sippy/web-users/:id/block — block a web user (admin+management)
  app.post('/api/sippy/web-users/:id/block', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req, res) => {
    try {
      const iWebUser = parseInt(req.params.id, 10);
      if (isNaN(iWebUser)) return res.status(400).json({ success: false, error: 'Invalid i_web_user.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const iCustomer = req.body?.iCustomer !== undefined ? Number(req.body.iCustomer) : undefined;
      const result = await sippy.blockWebUser(username, password, iWebUser, { iCustomer, portalUrl: sippyPortalUrl(settings) });
      if (!result.success) return res.status(422).json({ success: false, error: result.message });
      res.json({ success: true, iWebUser: result.iWebUser, message: result.message });
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // POST /api/sippy/web-users/:id/unblock — unblock a web user (admin+management)
  app.post('/api/sippy/web-users/:id/unblock', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req, res) => {
    try {
      const iWebUser = parseInt(req.params.id, 10);
      if (isNaN(iWebUser)) return res.status(400).json({ success: false, error: 'Invalid i_web_user.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const iCustomer = req.body?.iCustomer !== undefined ? Number(req.body.iCustomer) : undefined;
      const result = await sippy.unblockWebUser(username, password, iWebUser, { iCustomer, portalUrl: sippyPortalUrl(settings) });
      if (!result.success) return res.status(422).json({ success: false, error: result.message });
      res.json({ success: true, iWebUser: result.iWebUser, message: result.message });
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // ── Destination Sets Management (docs 107473) ───────────────────────────────

  // GET /api/sippy/destination-sets — list destination sets
  app.get('/api/sippy/destination-sets', async (req: any, res) => {
    try {
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, list: [], error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const { namePattern, iDestinationSet, offset, limit } = req.query;
      const result = await sippy.listDestinationSets(username, password, {
        namePattern: namePattern as string | undefined,
        iDestinationSet: iDestinationSet ? parseInt(iDestinationSet as string, 10) : undefined,
        offset: offset ? parseInt(offset as string, 10) : undefined,
        limit:  limit  ? parseInt(limit  as string, 10) : undefined,
        portalUrl: sippyPortalUrl(settings),
      });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, list: [], error: e.message }); }
  });

  // POST /api/sippy/destination-sets — create a destination set (admin+management)
  app.post('/api/sippy/destination-sets', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req, res) => {
    try {
      const { name, currency, ...rest } = req.body ?? {};
      if (!name || !currency) return res.status(400).json({ success: false, error: 'name and currency are required.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.addDestinationSet(username, password, { name, currency, ...rest, portalUrl: sippyPortalUrl(settings) });
      if (!result.success) return res.status(422).json({ success: false, error: result.message });
      res.status(201).json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // GET /api/sippy/destination-sets/:id — get destination set info (Sippy 2024+)
  app.get('/api/sippy/destination-sets/:id', async (req: any, res) => {
    try {
      const iDestinationSet = parseInt(req.params.id, 10);
      if (isNaN(iDestinationSet)) return res.status(400).json({ success: false, error: 'Invalid i_destination_set.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const includeAllFields = req.query.includeAllFields === 'true';
      const result = await sippy.getDestinationSetInfo(username, password, { iDestinationSet, includeAllFields, portalUrl: sippyPortalUrl(settings) });
      if (!result.success) return res.status(404).json({ success: false, error: result.message });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // PATCH /api/sippy/destination-sets/:id — update a destination set (admin+management, Sippy 2024+)
  app.patch('/api/sippy/destination-sets/:id', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req, res) => {
    try {
      const iDestinationSet = parseInt(req.params.id, 10);
      if (isNaN(iDestinationSet)) return res.status(400).json({ success: false, error: 'Invalid i_destination_set.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.updateDestinationSet(username, password, iDestinationSet, { ...req.body, portalUrl: sippyPortalUrl(settings) });
      if (!result.success) return res.status(422).json({ success: false, error: result.message });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // DELETE /api/sippy/destination-sets/:id — delete a destination set (admin only, Sippy 2024+)
  app.delete('/api/sippy/destination-sets/:id', (req: any, res, next) => requireRole(['admin'], req, res, next), async (req, res) => {
    try {
      const iDestinationSet = parseInt(req.params.id, 10);
      if (isNaN(iDestinationSet)) return res.status(400).json({ success: false, error: 'Invalid i_destination_set.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.deleteDestinationSet(username, password, iDestinationSet, { portalUrl: sippyPortalUrl(settings) });
      if (!result.success) return res.status(422).json({ success: false, error: result.message });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // GET /api/sippy/destination-sets/:id/routes — list routes in a destination set (Sippy 2024+)
  app.get('/api/sippy/destination-sets/:id/routes', async (req: any, res) => {
    try {
      const iDestinationSet = parseInt(req.params.id, 10);
      if (isNaN(iDestinationSet)) return res.status(400).json({ success: false, list: [], error: 'Invalid i_destination_set.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, list: [], error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.getDestinationSetRoutesList(username, password, iDestinationSet, { portalUrl: sippyPortalUrl(settings) });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, list: [], error: e.message }); }
  });

  // POST /api/sippy/destination-sets/:id/routes — add a route to a destination set (admin+management)
  app.post('/api/sippy/destination-sets/:id/routes', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req, res) => {
    try {
      const iDestinationSet = parseInt(req.params.id, 10);
      if (isNaN(iDestinationSet)) return res.status(400).json({ success: false, error: 'Invalid i_destination_set.' });
      const { prefix, ...rest } = req.body ?? {};
      if (!prefix) return res.status(400).json({ success: false, error: 'prefix is required.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.addRouteToDestinationSet(username, password, iDestinationSet, prefix, { ...rest, portalUrl: sippyPortalUrl(settings) });
      if (!result.success) return res.status(422).json({ success: false, error: result.message });
      res.status(201).json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // PATCH /api/sippy/destination-sets/:id/routes/:prefix — update a route (admin+management)
  app.patch('/api/sippy/destination-sets/:id/routes/:prefix', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req, res) => {
    try {
      const iDestinationSet = parseInt(req.params.id, 10);
      const prefix = decodeURIComponent(req.params.prefix);
      if (isNaN(iDestinationSet) || !prefix) return res.status(400).json({ success: false, error: 'Invalid destination set ID or prefix.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.updateRouteInDestinationSet(username, password, iDestinationSet, prefix, { ...req.body, portalUrl: sippyPortalUrl(settings) });
      if (!result.success) return res.status(422).json({ success: false, error: result.message });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // DELETE /api/sippy/destination-sets/:id/routes — delete ALL routes (admin only, Sippy 2024+)
  app.delete('/api/sippy/destination-sets/:id/routes', (req: any, res, next) => requireRole(['admin'], req, res, next), async (req, res) => {
    try {
      const iDestinationSet = parseInt(req.params.id, 10);
      if (isNaN(iDestinationSet)) return res.status(400).json({ success: false, error: 'Invalid i_destination_set.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.deleteAllRoutesInDestinationSet(username, password, iDestinationSet, { portalUrl: sippyPortalUrl(settings) });
      if (!result.success) return res.status(422).json({ success: false, error: result.message });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // DELETE /api/sippy/destination-sets/:id/routes/:prefix — delete a single route (admin only)
  app.delete('/api/sippy/destination-sets/:id/routes/:prefix', (req: any, res, next) => requireRole(['admin'], req, res, next), async (req, res) => {
    try {
      const iDestinationSet = parseInt(req.params.id, 10);
      const prefix = decodeURIComponent(req.params.prefix);
      if (isNaN(iDestinationSet) || !prefix) return res.status(400).json({ success: false, error: 'Invalid destination set ID or prefix.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.delRouteFromDestinationSet(username, password, iDestinationSet, prefix, { portalUrl: sippyPortalUrl(settings) });
      if (!result.success) return res.status(422).json({ success: false, error: result.message });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // ── Miscellaneous APIs ──────────────────────────────────────────────────────

  // POST /api/sippy/send-email — send an email via Sippy's mail relay (docs 107472)
  // Admin + management only. Body: { from, to, cc?, bcc?, subject, body }
  app.post('/api/sippy/send-email', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req, res) => {
    try {
      const { from, to, cc, bcc, subject, body: emailBody } = req.body ?? {};
      if (!from || !to || !subject || !emailBody) {
        return res.status(400).json({ success: false, error: 'from, to, subject and body are required.' });
      }
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.sendSippyEmail(username, password, {
        from, to, cc, bcc, subject, body: emailBody, portalUrl: sippyPortalUrl(settings),
      });
      if (!result.success) return res.status(422).json({ success: false, error: result.message });
      res.json({ success: true, message: result.message });
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // POST /api/sippy/validate-password — validate a password against a policy (docs 107475)
  // Supports trusted mode (pass iCustomer). Returns localized fault message on failure.
  app.post('/api/sippy/validate-password', async (req: any, res) => {
    try {
      const { iPasswordPolicy, password: pwd, webLabel, lang, iCustomer } = req.body ?? {};
      if (!iPasswordPolicy || !pwd || !webLabel) {
        return res.status(400).json({ success: false, error: 'iPasswordPolicy, password and webLabel are required.' });
      }
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.validatePassword(username, password, {
        iPasswordPolicy: Number(iPasswordPolicy),
        password: pwd,
        webLabel,
        lang,
        iCustomer: iCustomer !== undefined ? Number(iCustomer) : undefined,
        portalUrl: sippyPortalUrl(settings),
      });
      if (!result.success) return res.status(422).json({ success: false, error: result.message });
      res.json({ success: true, message: result.message });
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // GET /api/sippy/service-plans/:id — retrieve service plan info (docs 107487)
  // Supports trusted mode via ?iCustomer= query param.
  // Service plan must belong to the authenticated customer unless trusted mode.
  app.get('/api/sippy/service-plans/:id', async (req: any, res) => {
    try {
      const iBillingPlan = parseInt(req.params.id, 10);
      if (isNaN(iBillingPlan)) return res.status(400).json({ success: false, error: 'Invalid i_billing_plan.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const iCustomer = req.query.iCustomer ? parseInt(req.query.iCustomer as string, 10) : undefined;
      const result = await sippy.getServicePlanInfo(username, password, iBillingPlan, { iCustomer, portalUrl: sippyPortalUrl(settings) });
      if (!result.success) return res.status(404).json({ success: false, error: result.message });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // POST /api/sippy/apply-translation-rule — test a translation rule against a number (docs 107499)
  // No trusted mode. Returns the translated number when rule syntax is valid.
  app.post('/api/sippy/apply-translation-rule', async (req: any, res) => {
    try {
      const { rule, number } = req.body ?? {};
      if (!rule) return res.status(400).json({ success: false, error: 'rule is required.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.applyTranslationRule(username, password, rule, number ?? '', { portalUrl: sippyPortalUrl(settings) });
      if (!result.success) return res.status(422).json({ success: false, error: result.message });
      res.json({ success: true, number: result.number, message: result.message });
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // POST /api/sippy/check-match-rule — check if a number matches a regex rule (docs 107500)
  // Used for CLI validation rules on Tariffs and Destination Sets. No trusted mode.
  app.post('/api/sippy/check-match-rule', async (req: any, res) => {
    try {
      const { rule, number } = req.body ?? {};
      if (!rule) return res.status(400).json({ success: false, error: 'rule is required.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.checkMatchRule(username, password, rule, number ?? '', { portalUrl: sippyPortalUrl(settings) });
      if (!result.success) return res.status(422).json({ success: false, error: result.message });
      res.json({ success: true, match: result.match, message: result.message });
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // ─── DID Pool Management (docs 107502) ────────────────────────────────────

  // GET /api/sippy/dids — list DIDs with optional filters
  app.get('/api/sippy/dids', async (req: any, res) => {
    try {
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const portalUrl = sippyPortalUrl(settings);
      const { did, incomingDid, delegatedTo, iAccount, iIvrApplication, notAssigned, offset, limit } = req.query as any;
      const opts = {
        did,
        incomingDid,
        delegatedTo:     delegatedTo    ? parseInt(delegatedTo, 10)    : undefined,
        iAccount:        iAccount       ? parseInt(iAccount, 10)       : undefined,
        iIvrApplication: iIvrApplication ? parseInt(iIvrApplication, 10) : undefined,
        notAssigned:     notAssigned === 'true' ? true : (notAssigned === 'false' ? false : undefined),
        offset:          offset         ? parseInt(offset, 10)         : undefined,
        limit:           limit          ? parseInt(limit, 10)          : undefined,
        portalUrl,
      };
      const result = await withSippyCreds(settings, (u, p) => sippy.getDIDsList(u, p, opts));
      if (!result.success) return res.status(422).json({ success: false, error: result.message });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // GET /api/sippy/dids/charging-groups/:id — get DID charging group info (BEFORE /:id)
  app.get('/api/sippy/dids/charging-groups/:id', async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid i_dids_charging_group.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const portalUrl = sippyPortalUrl(settings);
      const result = await withSippyCreds(settings, (u, p) => sippy.getDIDChargingGroupInfo(u, p, id, { portalUrl }));
      if (!result.success) return res.status(404).json({ success: false, error: result.message });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // PATCH /api/sippy/dids/delegations/:id — update a DID delegation (BEFORE /:id)
  app.patch('/api/sippy/dids/delegations/:id', async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid i_did_delegation.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const portalUrl = sippyPortalUrl(settings);
      const { iDidsChargingGroup, delegatedTo, description } = req.body ?? {};
      const delegationOpts = {
        iDidsChargingGroup: iDidsChargingGroup !== undefined ? parseInt(iDidsChargingGroup, 10) : undefined,
        delegatedTo:        delegatedTo        !== undefined ? parseInt(delegatedTo, 10)        : undefined,
        description,
        portalUrl,
      };
      const result = await withSippyCreds(settings, (u, p) => sippy.updateDIDDelegation(u, p, id, delegationOpts));
      if (!result.success) return res.status(422).json({ success: false, error: result.message });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // DELETE /api/sippy/dids/delegations/:id — delete a DID delegation (BEFORE /:id)
  app.delete('/api/sippy/dids/delegations/:id', async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid i_did_delegation.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const portalUrl = sippyPortalUrl(settings);
      const result = await withSippyCreds(settings, (u, p) => sippy.deleteDIDDelegation(u, p, id, { portalUrl }));
      if (!result.success) return res.status(422).json({ success: false, error: result.message });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // GET /api/sippy/dids/:id — get DID info by i_did (integer) or did string
  app.get('/api/sippy/dids/:id', async (req: any, res) => {
    try {
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const portalUrl = sippyPortalUrl(settings);
      const rawId = req.params.id;
      const numId = parseInt(rawId, 10);
      const opts = isNaN(numId)
        ? { did: rawId, didRangeEnd: req.query.didRangeEnd as string | undefined, portalUrl }
        : { iDid: numId, portalUrl };
      const result = await withSippyCreds(settings, (u, p) => sippy.getDIDInfo(u, p, opts));
      if (!result.success) return res.status(404).json({ success: false, error: result.message });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // POST /api/sippy/dids/bulk — bulk-add DIDs via system.multicall (docs 3000108533)
  app.post('/api/sippy/dids/bulk', async (req: any, res) => {
    try {
      const { dids } = req.body ?? {};
      if (!Array.isArray(dids) || dids.length === 0)
        return res.status(400).json({ success: false, error: 'dids must be a non-empty array.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const portalUrl = sippyPortalUrl(settings);
      const result = await withSippyCreds(settings, (u, p) => sippy.bulkAddDIDs(u, p, dids, { portalUrl }));
      res.status(result.success ? 200 : 207).json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // DELETE /api/sippy/dids/bulk — bulk-delete DIDs via system.multicall (docs 3000108533)
  app.delete('/api/sippy/dids/bulk', async (req: any, res) => {
    try {
      const { iDids } = req.body ?? {};
      if (!Array.isArray(iDids) || iDids.length === 0)
        return res.status(400).json({ success: false, error: 'iDids must be a non-empty array of integers.' });
      const ids = iDids.map((id: any) => parseInt(id, 10)).filter((id: number) => !isNaN(id));
      if (ids.length === 0)
        return res.status(400).json({ success: false, error: 'No valid integer i_did values provided.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const portalUrl = sippyPortalUrl(settings);
      const result = await withSippyCreds(settings, (u, p) => sippy.bulkDeleteDIDs(u, p, ids, { portalUrl }));
      res.status(result.success ? 200 : 207).json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // POST /api/sippy/dids — add a DID
  app.post('/api/sippy/dids', async (req: any, res) => {
    try {
      const { did, incomingDid, ...rest } = req.body ?? {};
      if (!did || !incomingDid) return res.status(400).json({ success: false, error: 'did and incomingDid are required.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const portalUrl = sippyPortalUrl(settings);
      const result = await withSippyCreds(settings, (u, p) => sippy.addDID(u, p, did, incomingDid, { ...rest, portalUrl }));
      if (!result.success) return res.status(422).json({ success: false, error: result.message });
      res.status(201).json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // PATCH /api/sippy/dids/:id — update a DID by i_did
  app.patch('/api/sippy/dids/:id', async (req: any, res) => {
    try {
      const iDid = parseInt(req.params.id, 10);
      if (isNaN(iDid)) return res.status(400).json({ success: false, error: 'Invalid i_did.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const portalUrl = sippyPortalUrl(settings);
      const result = await withSippyCreds(settings, (u, p) => sippy.updateDID(u, p, { iDid, ...req.body, portalUrl }));
      if (!result.success) return res.status(422).json({ success: false, error: result.message });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // DELETE /api/sippy/dids/:id — delete a DID by i_did
  app.delete('/api/sippy/dids/:id', async (req: any, res) => {
    try {
      const iDid = parseInt(req.params.id, 10);
      if (isNaN(iDid)) return res.status(400).json({ success: false, error: 'Invalid i_did.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const portalUrl = sippyPortalUrl(settings);
      const result = await withSippyCreds(settings, (u, p) => sippy.deleteDID(u, p, { iDid, portalUrl }));
      if (!result.success) return res.status(422).json({ success: false, error: result.message });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // POST /api/sippy/dids/:id/delegations — delegate a DID to a subcustomer
  app.post('/api/sippy/dids/:id/delegations', async (req: any, res) => {
    try {
      const iDid = parseInt(req.params.id, 10);
      if (isNaN(iDid)) return res.status(400).json({ success: false, error: 'Invalid i_did.' });
      const { delegatedTo, parentIDidDelegation, iDidsChargingGroup, description } = req.body ?? {};
      if (delegatedTo === undefined) return res.status(400).json({ success: false, error: 'delegatedTo is required.' });
      if (parentIDidDelegation === undefined) return res.status(400).json({ success: false, error: 'parentIDidDelegation is required (null for first delegation).' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const portalUrl = sippyPortalUrl(settings);
      const delegationOpts = {
        iDid,
        delegatedTo:          parseInt(delegatedTo, 10),
        parentIDidDelegation: parentIDidDelegation === null ? null : parseInt(parentIDidDelegation, 10),
        iDidsChargingGroup:   iDidsChargingGroup !== undefined ? parseInt(iDidsChargingGroup, 10) : undefined,
        description,
        portalUrl,
      };
      const result = await withSippyCreds(settings, (u, p) => sippy.addDIDDelegation(u, p, delegationOpts));
      if (!result.success) return res.status(422).json({ success: false, error: result.message });
      res.status(201).json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // ─── Conferencing Management (docs 107507) ───────────────────────────────────

  // POST /api/sippy/accounts/:id/conferences — create a conference on an account
  // Requires conference enabled on Account Class + Customer Permissions.
  // Supports trusted mode via body.iCustomer.
  app.post('/api/sippy/accounts/:id/conferences', async (req: any, res) => {
    try {
      const iAccount = parseInt(req.params.id, 10);
      if (isNaN(iAccount)) return res.status(400).json({ success: false, error: 'Invalid i_account.' });
      const { startTime, subject, expire, confnoLen, iCustomer } = req.body ?? {};
      if (!startTime) return res.status(400).json({ success: false, error: 'startTime is required.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.addConference(username, password, {
        iAccount,
        startTime,
        subject,
        expire,
        confnoLen: confnoLen !== undefined ? parseInt(confnoLen, 10) : undefined,
        iCustomer: iCustomer !== undefined ? parseInt(iCustomer, 10) : undefined,
        portalUrl: sippyPortalUrl(settings),
      });
      if (!result.success) return res.status(422).json({ success: false, error: result.message });
      res.status(201).json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // DELETE /api/sippy/accounts/:id/conferences/:confId — delete a conference
  // Supports trusted mode via ?iCustomer= query param.
  app.delete('/api/sippy/accounts/:id/conferences/:confId', async (req: any, res) => {
    try {
      const iAccount     = parseInt(req.params.id, 10);
      const iConference  = parseInt(req.params.confId, 10);
      if (isNaN(iAccount) || isNaN(iConference)) return res.status(400).json({ success: false, error: 'Invalid i_account or i_conference.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const iCustomer = req.query.iCustomer ? parseInt(req.query.iCustomer as string, 10) : undefined;
      const result = await sippy.deleteConference(username, password, iAccount, iConference, { iCustomer, portalUrl: sippyPortalUrl(settings) });
      if (!result.success) return res.status(422).json({ success: false, error: result.message });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // ─── Packet Sniffer Scheduler (docs 107508) — root-only ──────────────────────

  // POST /api/sippy/packet-dumps — schedule a packet capture (dumpIPTraffic)
  // Root-only. target_hosts is an XML-RPC array sent manually.
  app.post('/api/sippy/packet-dumps', async (req: any, res) => {
    try {
      const { email, targetHosts, period, iface } = req.body ?? {};
      if (!email)                              return res.status(400).json({ success: false, error: 'email is required.' });
      if (!Array.isArray(targetHosts) || !targetHosts.length)
                                               return res.status(400).json({ success: false, error: 'targetHosts must be a non-empty array.' });
      if (!period || period < 1 || period > 60) return res.status(400).json({ success: false, error: 'period must be an integer between 1 and 60.' });
      if (!iface)                              return res.status(400).json({ success: false, error: 'iface is required.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.dumpIPTraffic(username, password, {
        email,
        targetHosts,
        period: parseInt(period, 10),
        iface,
        portalUrl: sippyPortalUrl(settings),
      });
      if (!result.success) return res.status(422).json({ success: false, error: result.message });
      res.status(201).json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // GET /api/sippy/packet-dumps/:id — get packet dump status (dumpIPTrafficStatus)
  // Root-only. Returns status: 'pending' | 'in_progress' | 'timed_out' and url on success.
  app.get('/api/sippy/packet-dumps/:id', async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid i_ip_traffic_dump.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.dumpIPTrafficStatus(username, password, id, { portalUrl: sippyPortalUrl(settings) });
      if (!result.success) return res.status(422).json({ success: false, error: result.message });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // ─── Audit Logs (docs 3000038971) — root-only ─────────────────────────────────

  // GET /api/sippy/audit-logs — retrieve audit log records (getAuditLogs)
  // Root-only. Supports trusted mode. Query: startDate, endDate (ISO or Sippy format),
  // limit (max 100), offset.
  app.get('/api/sippy/audit-logs', async (req: any, res) => {
    try {
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const { startDate, endDate, limit, offset } = req.query as any;
      const result = await sippy.getAuditLogs(username, password, {
        startDate: startDate || undefined,
        endDate:   endDate   || undefined,
        limit:     limit     ? parseInt(limit, 10)  : undefined,
        offset:    offset    ? parseInt(offset, 10) : undefined,
        portalUrl: sippyPortalUrl(settings),
      });
      if (!result.success) return res.status(422).json({ success: false, error: result.message });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // POST /api/sippy/audit-logs — write a custom audit log entry (writeAuditLog)
  // Root-only. Supports trusted mode. Body: { action, resource, auditInfo? }.
  app.post('/api/sippy/audit-logs', async (req: any, res) => {
    try {
      const { action, resource, auditInfo } = req.body ?? {};
      if (!action)   return res.status(400).json({ success: false, error: 'action is required.' });
      if (!resource) return res.status(400).json({ success: false, error: 'resource is required.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.writeAuditLog(username, password, action, resource, {
        auditInfo: auditInfo || undefined,
        portalUrl: sippyPortalUrl(settings),
      });
      if (!result.success) return res.status(422).json({ success: false, error: result.message });
      res.status(201).json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // ─── Invoice Related Methods (docs 3000080953) — since V5.2, trusted mode ─────

  // POST /api/sippy/invoices/preview — generateInvoicePreview()
  // Body: { iInvoiceTemplate }
  // Returns: { success, pdf (base64 PDF string), message }
  app.post('/api/sippy/invoices/preview', async (req: any, res) => {
    try {
      const { iInvoiceTemplate } = req.body ?? {};
      if (!iInvoiceTemplate) return res.status(400).json({ success: false, error: 'iInvoiceTemplate is required.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.generateInvoicePreview(username, password, parseInt(iInvoiceTemplate, 10), { portalUrl: sippyPortalUrl(settings) });
      if (!result.success) return res.status(422).json({ success: false, error: result.message });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // POST /api/sippy/invoices/validate-template — validateInvoiceTemplate()
  // Body: { template (base64 HTML), templateCss? (base64 CSS), converterOptions?, returnPdf? }
  // Returns: { success, pdf? (base64 PDF, if returnPdf=true), message }
  app.post('/api/sippy/invoices/validate-template', async (req: any, res) => {
    try {
      const { template, templateCss, converterOptions, returnPdf } = req.body ?? {};
      if (!template) return res.status(400).json({ success: false, error: 'template (base64-encoded HTML) is required.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.validateInvoiceTemplate(username, password, template, {
        templateCss:      templateCss      || undefined,
        converterOptions: converterOptions || undefined,
        returnPdf:        returnPdf !== undefined ? Boolean(returnPdf) : undefined,
        portalUrl:        sippyPortalUrl(settings),
      });
      if (!result.success) return res.status(422).json({ success: false, error: result.message });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // POST /api/sippy/invoices/generate — generateInvoice()
  // Body: { iAccount, periodBegin (UTC datetime), periodEnd (UTC datetime), iBillingPlan? }
  // Returns: { success, pdf (base64 PDF), message }
  app.post('/api/sippy/invoices/generate', async (req: any, res) => {
    try {
      const { iAccount, periodBegin, periodEnd, iBillingPlan } = req.body ?? {};
      if (!iAccount)    return res.status(400).json({ success: false, error: 'iAccount is required.' });
      if (!periodBegin) return res.status(400).json({ success: false, error: 'periodBegin is required.' });
      if (!periodEnd)   return res.status(400).json({ success: false, error: 'periodEnd is required.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.generateInvoice(
        username, password,
        parseInt(iAccount, 10), periodBegin, periodEnd,
        {
          iBillingPlan: iBillingPlan !== undefined ? parseInt(iBillingPlan, 10) : undefined,
          portalUrl:    sippyPortalUrl(settings),
        },
      );
      if (!result.success) return res.status(422).json({ success: false, error: result.message });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // ─── Test Dialplan (docs 3000054197) — System Management permission ───────────

  // POST /api/sippy/test-dialplan — testDialplan()
  // Requires System Management permission. Supports trusted mode.
  // Body: { cli, cld, fallbackIAccount?, remoteUdpPort?, remoteIp?, toDomain?,
  //         fromDomain?, isIvrOriginated?, iProtocol?, nated?, callStartTime?,
  //         paiHdr?, rpidHdr? }
  app.post('/api/sippy/test-dialplan', async (req: any, res) => {
    try {
      const { cli, cld, fallbackIAccount, remoteUdpPort, remoteIp, toDomain,
              fromDomain, isIvrOriginated, iProtocol, nated, callStartTime,
              paiHdr, rpidHdr } = req.body ?? {};
      if (!cli) return res.status(400).json({ success: false, error: 'cli is required.' });
      if (!cld) return res.status(400).json({ success: false, error: 'cld is required.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const portalUrl = sippyPortalUrl(settings);
      const dialplanOpts = {
        fallbackIAccount: fallbackIAccount !== undefined ? parseInt(fallbackIAccount, 10) : undefined,
        remoteUdpPort:    remoteUdpPort    !== undefined ? parseInt(remoteUdpPort, 10)    : undefined,
        remoteIp:         remoteIp         || undefined,
        toDomain:         toDomain         || undefined,
        fromDomain:       fromDomain        || undefined,
        isIvrOriginated:  isIvrOriginated  !== undefined ? Boolean(isIvrOriginated)  : undefined,
        iProtocol:        iProtocol        !== undefined ? parseInt(iProtocol, 10)   : undefined,
        nated:            nated            !== undefined ? Boolean(nated)            : undefined,
        callStartTime:    callStartTime    || undefined,
        paiHdr:           paiHdr           || undefined,
        rpidHdr:          rpidHdr          || undefined,
        portalUrl,
      };
      const result = await withSippyCreds(settings, (u, p) => sippy.testDialplan(u, p, cli, cld, dialplanOpts));
      if (!result.success) return res.status(422).json({ success: false, error: result.message });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // ─── Extended Routing (docs 3000126868) — since Sippy2023, trusted mode ───────

  // GET /api/sippy/extended-routing?iCustomer=&offset=&limit=
  // Returns: { success, extendedRouting: ExtendedRoutingEntry[], message }
  app.get('/api/sippy/extended-routing', async (req: any, res) => {
    try {
      const { iCustomer, offset, limit } = req.query ?? {};
      if (!iCustomer) return res.status(400).json({ success: false, error: 'iCustomer is required.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.listExtendedRouting(username, password, parseInt(iCustomer as string, 10), {
        offset:    offset    !== undefined ? parseInt(offset    as string, 10) : undefined,
        limit:     limit     !== undefined ? parseInt(limit     as string, 10) : undefined,
        portalUrl: sippyPortalUrl(settings),
      });
      if (!result.success) return res.status(422).json({ success: false, error: result.message });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // ─── Routing Groups CRUD (docs 3000051220) ────────────────────────────────────
  // NOTE: GET /api/sippy/routing-groups (listSippyRoutingGroups discovery helper) already
  // registered above at line ~1486. The routes below implement the full official CRUD.

  // GET /api/sippy/routing-groups/list — listRoutingGroups() with full filter support
  // Query: namePattern, namePatternNot, iRoutingGroup, includeMembersCount
  app.get('/api/sippy/routing-groups/list', async (req: any, res) => {
    try {
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const { namePattern, namePatternNot, iRoutingGroup, includeMembersCount } = req.query as any;
      const result = await sippy.listRoutingGroups(username, password, {
        namePattern:         namePattern        || undefined,
        namePatternNot:      namePatternNot     || undefined,
        iRoutingGroup:       iRoutingGroup      ? parseInt(iRoutingGroup, 10) : undefined,
        includeMembersCount: includeMembersCount ? includeMembersCount === 'true' : undefined,
        portalUrl: sippyPortalUrl(settings),
      });
      if (!result.success) return res.status(422).json({ success: false, error: result.message });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // POST /api/sippy/routing-groups — addRoutingGroup()
  // Body: { name, policy, description?, iMediaRelay?, disableOnnetRouting?, onnetIConnection?,
  //         disableOnnetVoicemail?, onnetVoicemailIConnection?, onnetScope?, lrnEnabled?,
  //         lrnTranslationRule?, timeout2xx?, onnetTimeout100?, onnetTimeout1xx?,
  //         onnetTimeout2xx?, stirShakenEnabled? }
  app.post('/api/sippy/routing-groups', async (req: any, res) => {
    try {
      const { name, policy, ...rest } = req.body ?? {};
      if (!name)            return res.status(400).json({ success: false, error: 'name is required.' });
      if (policy === undefined) return res.status(400).json({ success: false, error: 'policy is required (can be empty string).' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.addRoutingGroup(username, password, name, policy, { ...rest, portalUrl: sippyPortalUrl(settings) });
      if (!result.success) return res.status(422).json({ success: false, error: result.message });
      res.status(201).json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // PUT /api/sippy/routing-groups/:id — updateRoutingGroup()
  // Body: any subset of addRoutingGroup params (all optional).
  app.put('/api/sippy/routing-groups/:id', async (req: any, res) => {
    try {
      const iRoutingGroup = parseInt(req.params.id, 10);
      if (isNaN(iRoutingGroup)) return res.status(400).json({ success: false, error: 'Invalid routing group ID.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.updateRoutingGroup(username, password, iRoutingGroup, { ...req.body, portalUrl: sippyPortalUrl(settings) });
      if (!result.success) return res.status(422).json({ success: false, error: result.message });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // DELETE /api/sippy/routing-groups/:id — delRoutingGroup()
  app.delete('/api/sippy/routing-groups/:id', async (req: any, res) => {
    try {
      const iRoutingGroup = parseInt(req.params.id, 10);
      if (isNaN(iRoutingGroup)) return res.status(400).json({ success: false, error: 'Invalid routing group ID.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.delRoutingGroup(username, password, iRoutingGroup, { portalUrl: sippyPortalUrl(settings) });
      if (!result.success) return res.status(422).json({ success: false, error: result.message });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // GET /api/sippy/routing-groups/:id/members — listRoutingGroupMembers()
  app.get('/api/sippy/routing-groups/:id/members', async (req: any, res) => {
    try {
      const iRoutingGroup = parseInt(req.params.id, 10);
      if (isNaN(iRoutingGroup)) return res.status(400).json({ success: false, error: 'Invalid routing group ID.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.listRoutingGroupMembers(username, password, iRoutingGroup, { portalUrl: sippyPortalUrl(settings) });
      if (!result.success) return res.status(422).json({ success: false, error: result.message });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // POST /api/sippy/routing-groups/:id/members — addRoutingGroupMember()
  // Body: { iDestinationSet, preference, iConnection?, iConnectionGroup?,
  //         activationDate?, expirationDate?, weight?, stirShakenAsMode? }
  app.post('/api/sippy/routing-groups/:id/members', async (req: any, res) => {
    try {
      const iRoutingGroup = parseInt(req.params.id, 10);
      if (isNaN(iRoutingGroup)) return res.status(400).json({ success: false, error: 'Invalid routing group ID.' });
      const { iDestinationSet, preference, iConnection, iConnectionGroup, ...rest } = req.body ?? {};
      if (!iDestinationSet) return res.status(400).json({ success: false, error: 'iDestinationSet is required.' });
      if (preference === undefined) return res.status(400).json({ success: false, error: 'preference is required.' });
      if (iConnection === undefined && iConnectionGroup === undefined)
        return res.status(400).json({ success: false, error: 'Either iConnection or iConnectionGroup is required.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.addRoutingGroupMember(
        username, password, iRoutingGroup,
        parseInt(iDestinationSet, 10), parseInt(preference, 10),
        {
          iConnection:      iConnection      !== undefined ? parseInt(iConnection, 10)      : undefined,
          iConnectionGroup: iConnectionGroup !== undefined ? parseInt(iConnectionGroup, 10) : undefined,
          ...rest,
          portalUrl: sippyPortalUrl(settings),
        },
      );
      if (!result.success) return res.status(422).json({ success: false, error: result.message });
      res.status(201).json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // PUT /api/sippy/routing-groups/:id/members/:memberId — updateRoutingGroupMember()
  // Body: any subset of addRoutingGroupMember params (all optional).
  app.put('/api/sippy/routing-groups/:id/members/:memberId', async (req: any, res) => {
    try {
      const iRoutingGroup       = parseInt(req.params.id, 10);
      const iRoutingGroupMember = parseInt(req.params.memberId, 10);
      if (isNaN(iRoutingGroup) || isNaN(iRoutingGroupMember))
        return res.status(400).json({ success: false, error: 'Invalid routing group or member ID.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.updateRoutingGroupMember(username, password, iRoutingGroupMember, {
        iRoutingGroup,
        ...req.body,
        portalUrl: sippyPortalUrl(settings),
      });
      if (!result.success) return res.status(422).json({ success: false, error: result.message });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // DELETE /api/sippy/routing-groups/:id/members/:memberId — delRoutingGroupMember()
  app.delete('/api/sippy/routing-groups/:id/members/:memberId', async (req: any, res) => {
    try {
      const iRoutingGroup       = parseInt(req.params.id, 10);
      const iRoutingGroupMember = parseInt(req.params.memberId, 10);
      if (isNaN(iRoutingGroup) || isNaN(iRoutingGroupMember))
        return res.status(400).json({ success: false, error: 'Invalid routing group or member ID.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.delRoutingGroupMember(username, password, iRoutingGroupMember, {
        iRoutingGroup,
        portalUrl: sippyPortalUrl(settings),
      });
      if (!result.success) return res.status(422).json({ success: false, error: result.message });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // ─── System Config (docs 3000050243) — root-only, since V4.5 ─────────────────

  // GET /api/sippy/system-config — getSystemConfig()
  // Root-only. Supports trusted mode. Optional ?key= to filter to one entry.
  app.get('/api/sippy/system-config', async (req: any, res) => {
    try {
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const key = req.query.key as string | undefined;
      const result = await sippy.getSystemConfig(username, password, { key, portalUrl: sippyPortalUrl(settings) });
      if (!result.success) return res.status(422).json({ success: false, error: result.message });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // PUT /api/sippy/system-config — setSystemConfig()
  // Root-only. Supports trusted mode. Body: { key, value }.
  // CAUTION: Do NOT set sip/hep_tracing/* on OpenSIPs ≤ 3.1 — it will crash OpenSIPs.
  app.put('/api/sippy/system-config', async (req: any, res) => {
    try {
      const { key, value } = req.body ?? {};
      if (!key)             return res.status(400).json({ success: false, error: 'key is required.' });
      if (value === undefined || value === null)
                            return res.status(400).json({ success: false, error: 'value is required.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.setSystemConfig(username, password, key, String(value), { portalUrl: sippyPortalUrl(settings) });
      if (!result.success) return res.status(422).json({ success: false, error: result.message });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // ─── Replication Status (docs 3000040133) — root-only, since V4.4 ─────────────

  // GET /api/sippy/replication/status — getReplicationStatus()
  // Root-only. Supports trusted mode via ?iEnvironment= query param.
  app.get('/api/sippy/replication/status', async (req: any, res) => {
    try {
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const iEnvironment = req.query.iEnvironment ? parseInt(req.query.iEnvironment as string, 10) : undefined;
      const result = await sippy.getReplicationStatus(username, password, { iEnvironment, portalUrl: sippyPortalUrl(settings) });
      if (!result.success) return res.status(422).json({ success: false, error: result.message });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // GET /api/sippy/replication/lag — getReplicationLag()
  // Root-only. Supports trusted mode via ?iEnvironment= query param.
  app.get('/api/sippy/replication/lag', async (req: any, res) => {
    try {
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const iEnvironment = req.query.iEnvironment ? parseInt(req.query.iEnvironment as string, 10) : undefined;
      const result = await sippy.getReplicationLag(username, password, { iEnvironment, portalUrl: sippyPortalUrl(settings) });
      if (!result.success) return res.status(422).json({ success: false, error: result.message });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // ─── Callback Calls (doc 107448) ─────────────────────────────────────────────

  // POST /api/sippy/callbacks/make2way — make2WayCallback() — docs 107448
  // Body: { authname, cldFirst, cldSecond, cliFirst?, cliSecond?, creditTime?, nextCall? }
  // Returns: { success, iCallbackRequest, message }
  app.post('/api/sippy/callbacks/make2way', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req: any, res) => {
    try {
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, message: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const { authname, cldFirst, cldSecond, cliFirst, cliSecond, creditTime, nextCall } = req.body ?? {};
      if (!authname || !cldFirst || !cldSecond)
        return res.status(400).json({ success: false, message: 'authname, cldFirst and cldSecond are required.' });
      const result = await sippy.make2WayCallback(
        username, password,
        { authname, cldFirst, cldSecond, cliFirst, cliSecond, creditTime, nextCall },
        sippyPortalUrl(settings),
      );
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // POST /api/sippy/callbacks/calling-card — callbackCallingCard() — docs 107448
  // Body: { authname, cld, cli?, langs?, creditTime?, + Calling Card CLD options }
  // Returns: { success, iCallbackRequest, message }
  app.post('/api/sippy/callbacks/calling-card', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req: any, res) => {
    try {
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, message: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const { authname, cld, cli, langs, creditTime, chpassext, cliregext, directhotdial,
              hotdialext, hotdialeditext, keepcli, nodial, playbalance, playduration,
              noredial, topupext, trycliauth } = req.body ?? {};
      if (!authname || !cld)
        return res.status(400).json({ success: false, message: 'authname and cld are required.' });
      const result = await sippy.callbackCallingCard(
        username, password,
        { authname, cld, cli, langs, creditTime, chpassext, cliregext, directhotdial,
          hotdialext, hotdialeditext, keepcli, nodial, playbalance, playduration,
          noredial, topupext, trycliauth },
        sippyPortalUrl(settings),
      );
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // POST /api/sippy/callbacks/:id/cancel — cancelCallback() — docs 107448
  // Returns: { success, message }
  app.post('/api/sippy/callbacks/:id/cancel', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req: any, res) => {
    try {
      const iCallbackRequest = parseInt(req.params.id, 10);
      if (isNaN(iCallbackRequest)) return res.status(400).json({ success: false, message: 'Invalid i_callback_request.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, message: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.cancelCallback(username, password, iCallbackRequest, sippyPortalUrl(settings));
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // GET /api/sippy/callbacks/:id/status — getCallbackStatus() — docs 107448
  // Query: ?fetchCdrs=true
  // Returns: { success, callResult, callStatus, cdrs?, message }
  app.get('/api/sippy/callbacks/:id/status', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req: any, res) => {
    try {
      const iCallbackRequest = parseInt(req.params.id, 10);
      if (isNaN(iCallbackRequest)) return res.status(400).json({ success: false, message: 'Invalid i_callback_request.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, message: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const fetchCdrs = req.query.fetchCdrs === 'true' || req.query.fetchCdrs === '1';
      const result = await sippy.getCallbackStatus(username, password, iCallbackRequest, { fetchCdrs }, sippyPortalUrl(settings));
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // SERVER MONITORING ROUTES
  // ══════════════════════════════════════════════════════════════════════════════

  // ── In-memory reachability state ─────────────────────────────────────────────
  let reachabilityState: { up: boolean; checkedAt: Date; cause?: string; openOutageId?: number } = {
    up: true, checkedAt: new Date(),
  };

  // ── Restore outage state from DB on startup (prevents duplicate entries after restarts) ──
  async function initReachabilityState(): Promise<void> {
    try {
      const allLog = await storage.getOutageLog(50);
      const openOutages = allLog.filter(e => !e.recoveredAt);
      if (openOutages.length === 0) return;

      // Sort open outages: oldest first
      openOutages.sort((a, b) => new Date(a.downAt).getTime() - new Date(b.downAt).getTime());

      // If more than one open outage (stale from previous restarts), merge them:
      // mark all but the FIRST as resolved immediately (0-second duration) — they were phantom
      for (let i = 1; i < openOutages.length; i++) {
        await storage.updateOutageEntry(openOutages[i].id, {
          recoveredAt: new Date(openOutages[i].downAt), // recovered instantly = duplicate artifact
          durationSec: 0,
        });
        console.log(`[monitoring] Closed phantom outage #${openOutages[i].id} (duplicate from restart)`);
      }

      // Restore state from the earliest (real) open outage
      const realOutage = openOutages[0];
      reachabilityState = {
        up: false,
        checkedAt: new Date(),
        cause: realOutage.cause ?? 'unknown',
        openOutageId: realOutage.id,
      };
      console.log(`[monitoring] Restored open outage #${realOutage.id} from DB (server was down)`);
    } catch (e: any) {
      console.warn('[monitoring] initReachabilityState error:', e.message);
    }
  }

  // ── Reachability background poller (every 30 s) ───────────────────────────────
  async function checkReachability(): Promise<void> {
    try {
      const settings = await storage.getSippySettings();
      if (!settings?.portalUrl) return;
      const { username, password } = sippyXmlCreds(settings);
      const portalUrl = sippyPortalUrl(settings);

      let nowUp = false;
      let cause: string | undefined;
      try {
        const result = await Promise.race([
          sippy.connectSippy(portalUrl, username, password),
          new Promise<never>((_, reject) => setTimeout(() => { cause = 'timeout'; reject(new Error('timeout')); }, 8000)),
        ]) as { ok?: boolean; success?: boolean; error?: string } | null;
        if (result && (result.ok || result.success)) {
          nowUp = true;
        } else {
          cause = (result as any)?.error ?? 'connect_failed';
        }
      } catch (e: any) {
        cause = cause ?? (e.message?.includes('timeout') ? 'timeout' : 'connection_refused');
        nowUp = false;
      }

      const wasUp = reachabilityState.up;
      const prevOpenOutageId = reachabilityState.openOutageId; // save before overwrite
      reachabilityState = { up: nowUp, checkedAt: new Date(), cause: nowUp ? undefined : cause };

      if (wasUp && !nowUp) {
        // Server just went DOWN — create outage entry
        const entry = await storage.createOutageEntry({ downAt: new Date(), cause: cause ?? 'unknown' });
        reachabilityState.openOutageId = entry.id;
        console.warn(`[monitoring] Sippy server DOWN — cause: ${cause}`);
        // Fire alert rules for 'server_down'
        await fireAlertRules('server_down', 1, { cause: cause ?? 'unknown' });
      } else if (!wasUp && nowUp) {
        // Server just came BACK UP — close the outage entry
        if (prevOpenOutageId) {
          const downRow = (await storage.getOutageLog(50)).find(r => r.id === prevOpenOutageId);
          const durationSec = downRow ? Math.round((Date.now() - new Date(downRow.downAt).getTime()) / 1000) : null;
          await storage.updateOutageEntry(prevOpenOutageId, {
            recoveredAt: new Date(),
            durationSec: durationSec ?? undefined,
          });
        }
        reachabilityState.openOutageId = undefined;
        console.log('[monitoring] Sippy server RECOVERED');
      } else if (!wasUp && !nowUp && prevOpenOutageId) {
        // Still down — keep openOutageId alive (no new entry)
        reachabilityState.openOutageId = prevOpenOutageId;
      }
    } catch (e: any) {
      console.warn('[monitoring] checkReachability error:', e.message);
    }
  }

  // ── Alert rule firing ────────────────────────────────────────────────────────
  async function fireAlertRules(metric: string, value: number, context: Record<string, any> = {}): Promise<void> {
    try {
      const rules = await storage.getAlertRules();
      const matched = rules.filter(r =>
        r.enabled && r.metric === metric &&
        (r.comparison === 'gt' ? value > r.threshold : value < r.threshold)
      );
      if (matched.length === 0) return;

      const settings = await storage.getSettings();
      for (const rule of matched) {
        const subject = `[VoIP Monitor] Alert: ${rule.label ?? rule.metric}`;
        const body = `Metric: ${rule.metric}\nValue: ${value}\nThreshold: ${rule.comparison} ${rule.threshold}\nContext: ${JSON.stringify(context)}\nTime: ${new Date().toISOString()}`;

        // Email
        if (rule.emailEnabled && settings.alertEnabled && settings.alertGmailUser && settings.alertGmailAppPass && settings.alertAdminEmail) {
          try {
            const nodemailer = await import('nodemailer');
            const transporter = nodemailer.default.createTransport({
              service: 'gmail',
              auth: { user: settings.alertGmailUser, pass: settings.alertGmailAppPass },
            });
            await transporter.sendMail({ from: settings.alertGmailUser, to: settings.alertAdminEmail, subject, text: body });
          } catch (e: any) { console.warn('[monitoring] Email alert failed:', e.message); }
        }

        // Webhook
        if (rule.webhookEnabled && rule.webhookUrl) {
          try {
            await fetch(rule.webhookUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ metric: rule.metric, value, threshold: rule.threshold, label: rule.label, context, ts: Date.now() }),
            });
          } catch (e: any) { console.warn('[monitoring] Webhook alert failed:', e.message); }
        }
      }
    } catch (e: any) {
      console.warn('[monitoring] fireAlertRules error:', e.message);
    }
  }

  // GET /api/monitoring/status — reachability + outage log
  app.get('/api/monitoring/status', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    try {
      const settings = await storage.getSippySettings();
      const portalUrl = sippyPortalUrl(settings);
      // Extract host/IP from portal URL for display in outage log
      let monitoredHost: string | undefined;
      try {
        monitoredHost = new URL(portalUrl).hostname;
      } catch { monitoredHost = portalUrl; }
      const log = await storage.getOutageLog(30);
      // Uptime % over last 7 days
      const weekMs = 7 * 24 * 3600 * 1000;
      const weekAgo = Date.now() - weekMs;
      const downMs = log.reduce((acc, e) => {
        const downTs = new Date(e.downAt).getTime();
        if (downTs < weekAgo) return acc;
        const recTs = e.recoveredAt ? new Date(e.recoveredAt).getTime() : Date.now();
        return acc + (recTs - downTs);
      }, 0);
      const uptimePct = parseFloat((100 - (downMs / weekMs) * 100).toFixed(2));
      res.json({ up: reachabilityState.up, checkedAt: reachabilityState.checkedAt, cause: reachabilityState.cause, uptimePct, outageLog: log, monitoredHost });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/monitoring/diagnostics — detailed multi-layer connectivity probe
  app.get('/api/monitoring/diagnostics', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    try {
      const settings = await storage.getSippySettings();
      const portalUrl = sippyPortalUrl(settings);
      const { username, password } = sippyXmlCreds(settings);
      let host = '191.101.30.107';
      try { host = new URL(portalUrl).hostname; } catch {}

      const checks: { name: string; ok: boolean; latencyMs?: number; detail: string }[] = [];

      // ── Check 1: TCP probe key SIP/HTTP ports ─────────────────────────────────
      const tcpPorts = [5060, 5080, 443, 80, 8080];
      for (const port of tcpPorts) {
        const result = await probeIp(host, [port]);
        checks.push({
          name: `TCP port ${port}`,
          ok: result.reachable,
          latencyMs: result.reachable ? result.latency : undefined,
          detail: result.reachable
            ? `Port ${port} open — TCP handshake OK (${result.latency}ms)`
            : `Port ${port} refused or timed out`,
        });
      }

      // ── Check 2: HTTP portal reachability (accepts self-signed TLS certs) ────────
      let httpOk = false; let httpDetail = '';
      try {
        const parsed = new URL(portalUrl);
        const isHttps = parsed.protocol === 'https:';
        const port = parsed.port ? parseInt(parsed.port) : (isHttps ? 443 : 80);
        const statusCode = await new Promise<number>((resolve, reject) => {
          const options = {
            hostname: parsed.hostname,
            port,
            path: parsed.pathname || '/',
            method: 'HEAD',
            rejectUnauthorized: false,  // accept self-signed / internal TLS certs
          };
          // Use the https module for HTTPS URLs, require http for plain HTTP
          const reqLib = isHttps ? https : require('http');
          const req = reqLib.request(options, (res: any) => resolve(res.statusCode));
          req.on('error', reject);
          req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
          req.setTimeout(6000);
          req.end();
        });
        httpOk = statusCode < 500;
        httpDetail = `HTTP ${statusCode} — portal responded`;
      } catch (e: any) {
        httpDetail = e.message?.includes('timeout') ? 'HTTP request timed out (>6s)' : `HTTP connection failed: ${e.message}`;
      }
      checks.push({ name: 'HTTP portal', ok: httpOk, detail: httpDetail });

      // ── Check 3: XML-RPC API ──────────────────────────────────────────────────
      let xmlOk = false; let xmlDetail = '';
      try {
        const result = await Promise.race([
          sippy.connectSippy(portalUrl, username, password),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
        ]) as { ok?: boolean; success?: boolean; error?: string } | null;
        if (result && (result.ok || result.success)) {
          xmlOk = true;
          xmlDetail = 'XML-RPC authentication succeeded';
        } else {
          xmlDetail = `XML-RPC responded but auth failed: ${(result as any)?.error ?? 'unknown'}`;
        }
      } catch (e: any) {
        xmlDetail = e.message?.includes('timeout') ? 'XML-RPC request timed out (>8s)' : `XML-RPC error: ${e.message}`;
      }
      checks.push({ name: 'XML-RPC API', ok: xmlOk, detail: xmlDetail });

      // ── Diagnosis summary ─────────────────────────────────────────────────────
      const anyTcpOpen = checks.filter(c => c.name.startsWith('TCP')).some(c => c.ok);
      let summary = '';
      if (xmlOk && httpOk) summary = 'All systems fully reachable — Sippy API and web portal are both responding normally.';
      else if (xmlOk && !httpOk) summary = 'XML-RPC API is fully operational — all monitoring functions are working normally. The web portal UI is not reachable from this network (this is expected if the portal uses a self-signed certificate, a private IP, or has IP-based access restrictions). No action required.';
      else if (anyTcpOpen && !xmlOk) summary = 'Network path is open (TCP handshake OK) but the Sippy API is not responding — the softswitch process may be crashed, overloaded, or restarting. Check the server process and logs.';
      else if (!anyTcpOpen) summary = 'No TCP ports are reachable — this indicates a firewall block, full network outage, or the server is completely offline.';
      else summary = 'Partial reachability — some services responding, others not. Review individual check results above.';

      res.json({ host, checks, summary, ts: new Date().toISOString() });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Multi-Host Monitoring CRUD ───────────────────────────────────────────────

  // In-memory map: hostId → { up, latency, port, cause, checkedAt, openOutageId }
  const hostState = new Map<number, {
    up: boolean; latency?: number; port?: number; cause?: string;
    checkedAt: Date; openOutageId?: number;
  }>();

  // GET /api/monitoring/hosts — list all monitored hosts with live status
  app.get('/api/monitoring/hosts', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    try {
      const hosts = await storage.getMonitoredHosts();
      const withStatus = hosts.map(h => ({
        ...h,
        status: hostState.get(h.id) ?? { up: null, checkedAt: null },
      }));
      res.json({ hosts: withStatus });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/monitoring/hosts — create a new monitored host
  app.post('/api/monitoring/hosts', async (req: any, res) => {
    try {
      const { label, ip, type, ports, notifyEmail, enabled } = req.body;
      if (!label || !ip) return res.status(400).json({ error: 'label and ip are required' });
      const host = await storage.createMonitoredHost({
        label, ip, type: type ?? 'vendor',
        ports: ports ?? null, notifyEmail: notifyEmail ?? null,
        enabled: enabled !== false,
      });
      res.json({ host });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // PUT /api/monitoring/hosts/:id — update a monitored host
  app.put('/api/monitoring/hosts/:id', async (req: any, res) => {
    try {
      const id = Number(req.params.id);
      const { label, ip, type, ports, notifyEmail, enabled } = req.body;
      const host = await storage.updateMonitoredHost(id, {
        ...(label       !== undefined && { label }),
        ...(ip          !== undefined && { ip }),
        ...(type        !== undefined && { type }),
        ...(ports       !== undefined && { ports }),
        ...(notifyEmail !== undefined && { notifyEmail }),
        ...(enabled     !== undefined && { enabled }),
      });
      res.json({ host });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // DELETE /api/monitoring/hosts/:id — remove a monitored host + its outage log
  app.delete('/api/monitoring/hosts/:id', async (req: any, res) => {
    try {
      const id = Number(req.params.id);
      await storage.deleteMonitoredHost(id);
      hostState.delete(id);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/monitoring/hosts/:id/outages — outage log for one host
  app.get('/api/monitoring/hosts/:id/outages', async (req: any, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    try {
      const id = Number(req.params.id);
      const log = await storage.getHostOutageLog(id, 50);
      res.json({ outageLog: log });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/monitoring/hosts/outages/all — combined outage log across all hosts
  app.get('/api/monitoring/hosts/outages/all', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    try {
      const log = await storage.getHostOutageLog(undefined, 100);
      res.json({ outageLog: log });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Per-host background poller (every 60 s) ───────────────────────────────────
  async function probeAllHosts(): Promise<void> {
    try {
      const hosts = await storage.getMonitoredHosts();
      const enabled = hosts.filter(h => h.enabled);
      for (const host of enabled) {
        try {
          const priorityPorts = host.ports
            ? host.ports.split(',').map(p => parseInt(p.trim(), 10)).filter(p => !isNaN(p))
            : [];
          const result = await probeIp(host.ip, priorityPorts);
          const prev = hostState.get(host.id);
          const nowUp = result.reachable;
          const cause = nowUp ? undefined : 'timeout';
          hostState.set(host.id, { up: nowUp, latency: result.latency, port: result.port, cause, checkedAt: new Date(), openOutageId: prev?.openOutageId });

          if (prev !== undefined && prev.up && !nowUp) {
            // Just went DOWN
            const entry = await storage.createHostOutageEntry({
              hostId: host.id, hostLabel: host.label, hostIp: host.ip,
              downAt: new Date(), cause: 'timeout',
            });
            hostState.set(host.id, { ...hostState.get(host.id)!, openOutageId: entry.id });
            console.warn(`[host-probe] ${host.label} (${host.ip}) DOWN`);
            // Email alert if configured
            if (host.notifyEmail) {
              await fireAlertRules('server_down', 1, { cause: `${host.label} (${host.ip}) is unreachable` });
            }
          } else if (prev !== undefined && !prev.up && nowUp) {
            // Just came back UP
            if (prev.openOutageId) {
              const downRow = (await storage.getHostOutageLog(host.id, 50)).find(r => r.id === prev.openOutageId);
              const durationSec = downRow ? Math.round((Date.now() - new Date(downRow.downAt).getTime()) / 1000) : null;
              await storage.updateHostOutageEntry(prev.openOutageId, {
                recoveredAt: new Date(),
                durationSec: durationSec ?? undefined,
              });
            }
            hostState.set(host.id, { ...hostState.get(host.id)!, openOutageId: undefined });
            console.log(`[host-probe] ${host.label} (${host.ip}) RECOVERED`);
          }
        } catch (err: any) {
          console.warn(`[host-probe] error probing ${host.ip}:`, err.message);
        }
      }
    } catch (e: any) {
      console.warn('[host-probe] probeAllHosts error:', e.message);
    }
  }
  setTimeout(() => probeAllHosts(), 12000);           // first run 12s after startup
  setInterval(() => probeAllHosts(), 60 * 1000);      // every 60 seconds

  // GET /api/monitoring/bandwidth — RTP bandwidth from Sippy monitoring graph
  app.get('/api/monitoring/bandwidth', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    try {
      const settings = await storage.getSippySettings();
      const { username, password } = sippyXmlCreds(settings);
      const portalUrl = sippyPortalUrl(settings);
      const now = new Date();
      const start = new Date(now.getTime() - 12 * 3600_000);
      const sippyDate = sippy.toSippyDate(start);
      const [bwResult] = await Promise.all([
        sippy.getSippyMonitoringData(username, password, 'bandwidth_total', { startDate: sippyDate, interval: 300, explicitPortalUrl: portalUrl })
          .catch(() => ({ ok: false, points: [] as any[] })),
      ]);
      res.json({ ok: bwResult.ok, points: bwResult.points });
    } catch (e: any) { res.json({ ok: false, points: [], error: e.message }); }
  });

  // GET /api/monitoring/disk-memory — disk/memory/cpu from Sippy monitoring graph
  app.get('/api/monitoring/disk-memory', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    try {
      const settings = await storage.getSippySettings();
      const { username, password } = sippyXmlCreds(settings);
      const portalUrl = sippyPortalUrl(settings);
      const now = new Date();
      const start = new Date(now.getTime() - 12 * 3600_000);
      const sippyDate = sippy.toSippyDate(start);
      const types = ['disk_usage', 'cpu_load', 'memory_usage'];
      const results = await Promise.all(
        types.map(t => sippy.getSippyMonitoringData(username, password, t, { startDate: sippyDate, interval: 300, explicitPortalUrl: portalUrl }).catch(() => ({ ok: false, points: [] as any[], type: t })).then(r => ({ ...r, type: t })))
      );
      res.json({ results });
    } catch (e: any) { res.json({ results: [], error: e.message }); }
  });

  // GET /api/monitoring/carrier-asr — per-carrier ASR drop detection from CDRs
  app.get('/api/monitoring/carrier-asr', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    try {
      const settings = await storage.getSippySettings();
      const credPairs = sippyXmlCredsPairs(settings);
      const now = new Date();
      const start = new Date(now.getTime() - 3 * 3600_000); // last 3 hours
      const startDate = sippy.toSippyDate(start);
      const endDate   = sippy.toSippyDate(now);
      let cdrs: any[] = [];
      for (const { username, password } of credPairs) {
        try {
          const rows = await sippy.getSippyCDRs(username, password, 1000, { startDate, endDate });
          if (rows.length > 0) { cdrs = rows; break; }
        } catch { continue; }
      }
      // Group by vendor/connection
      const map = new Map<string, { total: number; answered: number; duration: number }>();
      for (const c of cdrs) {
        const key = c.vendor_name || c.termination_party || c.vendor || c.connection || 'Unknown';
        const cur = map.get(key) ?? { total: 0, answered: 0, duration: 0 };
        cur.total++;
        if (String(c.result) === '0' && (Number(c.duration) || 0) > 0) {
          cur.answered++;
          cur.duration += Number(c.duration) || 0;
        }
        map.set(key, cur);
      }
      const carriers = Array.from(map.entries()).map(([carrier, s]) => ({
        carrier,
        total: s.total,
        answered: s.answered,
        asr: s.total > 0 ? parseFloat((s.answered / s.total * 100).toFixed(1)) : 0,
        acd: s.answered > 0 ? Math.round(s.duration / s.answered) : 0,
        alert: s.total >= 10 && (s.answered / s.total) < 0.2,  // alert if ASR < 20% with 10+ calls
      })).sort((a, b) => b.total - a.total);
      res.json({ carriers, period: 'last 3 hours', cdrs: cdrs.length });
    } catch (e: any) { res.json({ carriers: [], error: e.message }); }
  });

  // GET /api/monitoring/registrations — SIP registration storm detection
  app.get('/api/monitoring/registrations', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    try {
      const settings = await storage.getSippySettings();
      const { username, password } = sippyXmlCreds(settings);
      const portalUrl = sippyPortalUrl(settings);
      const now = new Date();
      const start = new Date(now.getTime() - 6 * 3600_000);
      const sippyDate = sippy.toSippyDate(start);
      const result = await sippy.getSippyMonitoringData(username, password, 'sip_reg_total', {
        startDate: sippyDate, interval: 300, explicitPortalUrl: portalUrl,
      }).catch(() => ({ ok: false, points: [] as any[] }));
      // Storm detection: if latest 5-min count > 2x the previous 5-min avg → storm
      const pts = result.points;
      let stormDetected = false;
      let stormRatio = 0;
      if (pts.length >= 2) {
        const latest = pts[pts.length - 1];
        const prev5 = pts.slice(-6, -1);
        const avg = prev5.reduce((s, p) => s + (p.col1 ?? p.cps ?? 0), 0) / (prev5.length || 1);
        const cur = latest.col1 ?? latest.cps ?? 0;
        stormRatio = avg > 0 ? parseFloat((cur / avg).toFixed(2)) : 0;
        stormDetected = stormRatio > 2 && cur > 10;
      }
      res.json({ ok: result.ok, points: result.points, stormDetected, stormRatio });
    } catch (e: any) { res.json({ ok: false, points: [], stormDetected: false, error: e.message }); }
  });

  // GET /api/monitoring/alert-rules
  app.get('/api/monitoring/alert-rules', async (_req, res) => {
    try { res.json(await storage.getAlertRules()); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/monitoring/alert-rules
  app.post('/api/monitoring/alert-rules', async (req, res) => {
    try {
      const { insertAlertRuleSchema } = await import('@shared/schema');
      const parsed = insertAlertRuleSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
      const rule = await storage.createAlertRule(parsed.data);
      res.json(rule);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // PATCH /api/monitoring/alert-rules/:id
  app.patch('/api/monitoring/alert-rules/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.updateAlertRule(id, req.body);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // DELETE /api/monitoring/alert-rules/:id
  app.delete('/api/monitoring/alert-rules/:id', async (req, res) => {
    try {
      await storage.deleteAlertRule(parseInt(req.params.id));
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Boot-time caches + 30-min refresh ────────────────────────────────────────
  // Stagger the two fetches slightly so they don't hit the switch simultaneously
  setTimeout(() => refreshAccountCache(),           3000);
  setTimeout(() => refreshConnectionVendorCache(),  6000);
  setInterval(() => refreshAccountCache(),          30 * 60 * 1000);
  setInterval(() => refreshConnectionVendorCache(), 30 * 60 * 1000);

  // ── Vendor balance tracker (every 60 s) ─────────────────────────────────────
  // Stores timestamped vendor balance snapshots for balance-delta vendor cost computation.
  setTimeout(() => refreshVendorBalances(), 9000);   // first snapshot ~9 s after boot
  setInterval(() => refreshVendorBalances(), 60_000); // then every 60 s

  // ── Call snapshot background poller (every 30 s) ──────────────────────────
  // Polls live Sippy calls and upserts each into call_snapshots for 24h history.
  // ── Concurrent-call history buffer (for live graphs) ─────────────────────────
  // Stores {ts, count, calls[]} every 30s — max 48h of data (5760 points).
  const CONCURRENT_HISTORY_HOURS = 48;
  interface ConcurrentPoint {
    ts: number;
    count: number;
    byClient:      Record<string, number>;
    byVendor:      Record<string, number>;
    byCodec:       Record<string, number>;
    byDirection:   Record<string, number>;
    byDestination: Record<string, number>;
    byBreakout:    Record<string, number>;
    byCountry:     Record<string, number>;
  }
  const concurrentHistory: ConcurrentPoint[] = [];

  // Destination lookup uses the full 19,088-entry dial-codes.json (longest-match prefix)
  function calleeToCountry(callee: string): string {
    const m = lookupDialCode(callee);
    return m ? m.country : 'Unknown';
  }

  function calleeToBreakout(callee: string): string {
    const m = lookupDialCode(callee);
    return m ? m.breakout : 'Unknown';
  }

  function calleeToDestination(callee: string): string {
    const m = lookupDialCode(callee);
    return m ? m.destination : 'Unknown';
  }

  function pushConcurrentPoint(calls: Awaited<ReturnType<typeof sippy.getSippyActiveCalls>>) {
    const cutoff = Date.now() - CONCURRENT_HISTORY_HOURS * 3600 * 1000;
    // Evict old points
    while (concurrentHistory.length > 0 && concurrentHistory[0].ts < cutoff) concurrentHistory.shift();

    const byClient:      Record<string, number> = {};
    const byVendor:      Record<string, number> = {};
    const byCodec:       Record<string, number> = {};
    const byDirection:   Record<string, number> = {};
    const byDestination: Record<string, number> = {};
    const byBreakout:    Record<string, number> = {};
    const byCountry:     Record<string, number> = {};

    for (const c of calls) {
      const rawId    = String(c.accountId ?? c.iCustomer ?? '').trim();
      const client   = c.user || accountNameCache.get(rawId) || (rawId && !/^\d+$/.test(rawId) ? rawId : 'Unknown');
      const vendor   = c.vendor || (c.connection ? connectionVendorCache.get(c.connection) : undefined) || 'Unknown';
      const codec    = (c.codec && c.codec !== '-') ? c.codec : 'Unknown';
      const dir      = c.direction || 'unknown';
      const match    = lookupDialCode(c.callee ?? '');
      const country  = match ? match.country  : 'Unknown';
      const breakout = match ? match.breakout : 'Unknown';
      const dest     = match ? match.destination : 'Unknown';
      byClient[client]           = (byClient[client]           || 0) + 1;
      byVendor[vendor]           = (byVendor[vendor]           || 0) + 1;
      byCodec[codec]             = (byCodec[codec]             || 0) + 1;
      byDirection[dir]           = (byDirection[dir]           || 0) + 1;
      byDestination[dest]        = (byDestination[dest]        || 0) + 1;
      byBreakout[breakout]       = (byBreakout[breakout]       || 0) + 1;
      byCountry[country]         = (byCountry[country]         || 0) + 1;
    }

    concurrentHistory.push({ ts: Date.now(), count: calls.length, byClient, byVendor, byCodec, byDirection, byDestination, byBreakout, byCountry });

    // Notify watcher of any client names seen for the first time (new traffic alert)
    for (const clientName of Object.keys(byClient)) {
      if (clientName && clientName !== 'Unknown') {
        notifyNewClientTraffic(clientName);
      }
    }
  }

  async function snapshotActiveCalls(): Promise<void> {
    try {
      const settings = await storage.getSippySettings();
      if (!settings) return;
      const credPairs = sippyXmlCredsPairs(settings);
      const portalUrl = sippyPortalUrl(settings);
      // Try each credential pair — RTST1 first (XML-RPC capable), ssp-root as fallback
      let raw: Awaited<ReturnType<typeof sippy.getSippyActiveCalls>> = [];
      for (const { username, password } of credPairs) {
        raw = await sippy.getSippyActiveCalls(username, password, portalUrl);
        if (raw.length > 0) break;
      }

      // Push to concurrent history (even if 0, to track dips)
      pushConcurrentPoint(raw);

      const now = new Date();
      for (const c of raw) {
        if (!c.callId) continue;
        const vendorName = c.vendor || (c.connection ? connectionVendorCache.get(c.connection) : undefined);
        // Resolve client name: prefer display name from Sippy (c.user), then look up
        // the account ID in the name cache (handles cases where cache was warm on first run).
        // Never store a bare numeric ID — keep undefined so it can be re-resolved on read.
        const rawId     = String(c.accountId ?? c.iCustomer ?? '').trim();
        const cachedName = rawId ? accountNameCache.get(rawId) : undefined;
        const clientName = c.user || cachedName || (rawId && !/^\d+$/.test(rawId) ? rawId : undefined);
        await storage.upsertCallSnapshot({
          sippyCallId:     c.callId,
          caller:          c.caller,
          callee:          c.callee,
          clientName:      clientName,
          vendor:          vendorName,
          accountId:       c.accountId,
          iCustomer:       c.iCustomer,
          iEnvironment:    c.iEnvironment,
          direction:       c.direction,
          codec:           c.codec && c.codec !== '-' ? c.codec : undefined,
          ccState:         c.status,
          maxDurationSecs: c.duration ?? 0,
          pddMs:           Math.round((c.delay ?? 0) * 1000),
          mediaIpCaller:   c.mediaIpCaller,
          mediaIpCallee:   c.mediaIpCallee,
          connection:      c.connection,
          firstSeen:       now,
          lastSeen:        now,
        });
      }
      await storage.cleanupOldSnapshots();
    } catch (e: any) {
      // Non-fatal — just log and continue
      console.warn('[snapshot-bg] error:', e.message);
    }
  }
  setTimeout(() => snapshotActiveCalls(), 8000);            // first run at startup
  setInterval(() => snapshotActiveCalls(), 30 * 1000);      // every 30 seconds

  // GET /api/sippy/live-graphs — live concurrent call history + breakdowns
  app.get('/api/sippy/live-graphs', (req: any, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    const hours   = Math.min(Number(req.query.hours) || 3, CONCURRENT_HISTORY_HOURS);
    const cutoffMs = Date.now() - hours * 3600 * 1000;

    const window = concurrentHistory.filter(p => p.ts >= cutoffMs);

    // Build time-series (minute buckets for ≤6h, 5-min for ≤24h, 15-min for >24h)
    const bucketMs = hours <= 6 ? 60_000 : hours <= 24 ? 5 * 60_000 : 15 * 60_000;
    const bucketMap = new Map<number, number[]>();
    for (const p of window) {
      const b = Math.floor(p.ts / bucketMs) * bucketMs;
      if (!bucketMap.has(b)) bucketMap.set(b, []);
      bucketMap.get(b)!.push(p.count);
    }
    const trend = Array.from(bucketMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([ts, counts]) => ({
        time: new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
        avg:  Math.round(counts.reduce((s, v) => s + v, 0) / counts.length),
        peak: Math.max(...counts),
      }));

    // Aggregate latest breakdown (last 5 data points to smooth noise)
    const recent = window.slice(-5);
    const aggClient:      Record<string, number> = {};
    const aggVendor:      Record<string, number> = {};
    const aggCodec:       Record<string, number> = {};
    const aggDir:         Record<string, number> = {};
    const aggDestination: Record<string, number> = {};
    const aggBreakout:    Record<string, number> = {};
    const aggCountry:     Record<string, number> = {};
    for (const p of recent) {
      for (const [k, v] of Object.entries(p.byClient))           aggClient[k]      = Math.max(aggClient[k]      || 0, v);
      for (const [k, v] of Object.entries(p.byVendor))           aggVendor[k]      = Math.max(aggVendor[k]      || 0, v);
      for (const [k, v] of Object.entries(p.byCodec))            aggCodec[k]       = Math.max(aggCodec[k]       || 0, v);
      for (const [k, v] of Object.entries(p.byDirection))        aggDir[k]         = Math.max(aggDir[k]         || 0, v);
      for (const [k, v] of Object.entries(p.byDestination ?? {})) aggDestination[k] = Math.max(aggDestination[k] || 0, v);
      for (const [k, v] of Object.entries(p.byBreakout ?? {}))   aggBreakout[k]    = Math.max(aggBreakout[k]    || 0, v);
      for (const [k, v] of Object.entries(p.byCountry ?? {}))    aggCountry[k]     = Math.max(aggCountry[k]     || 0, v);
    }

    // CDR-based destination/breakout stats (accumulated from rolling CDR cache)
    const cdrDestMap:    Record<string, number> = {};
    const cdrCountryMap: Record<string, number> = {};
    const cdrBreakoutMap:Record<string, number> = {};
    const cdrCutoffMs = Date.now() - hours * 3600 * 1000;
    for (const c of cdrCache.values()) {
      const ts = c.startTime ? new Date(c.startTime).getTime() : c.connectTime ? new Date(c.connectTime).getTime() : 0;
      if (ts < cdrCutoffMs) continue;
      const callee = (c as any).callee ?? (c as any).cld ?? '';
      const m = lookupDialCode(callee);
      if (m) {
        cdrDestMap[m.destination]    = (cdrDestMap[m.destination]    || 0) + 1;
        cdrCountryMap[m.country]     = (cdrCountryMap[m.country]     || 0) + 1;
        cdrBreakoutMap[m.breakout]   = (cdrBreakoutMap[m.breakout]   || 0) + 1;
      } else {
        const fallback = (c as any).country || calleeToCountry(callee);
        cdrDestMap[fallback] = (cdrDestMap[fallback] || 0) + 1;
      }
    }

    const toArr = (m: Record<string, number>, top = 15) =>
      Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, top).map(([name, calls]) => ({ name, calls }));

    const last = concurrentHistory[concurrentHistory.length - 1];
    res.json({
      trend,
      byClient:            toArr(aggClient),
      byVendor:            toArr(aggVendor),
      byCodec:             toArr(aggCodec),
      byDirection:         toArr(aggDir),
      byDestination:       toArr(aggDestination),
      byBreakout:          toArr(aggBreakout),
      byCountry:           toArr(aggCountry),
      cdrByDestination:    toArr(cdrDestMap),
      cdrByCountry:        toArr(cdrCountryMap),
      cdrByBreakout:       toArr(cdrBreakoutMap),
      cdrTotal:            Object.values(cdrDestMap).reduce((s, v) => s + v, 0),
      liveCount:           last?.count ?? 0,
      peakCount:           window.length ? Math.max(...window.map(p => p.count)) : 0,
      windowHours:         hours,
      pointsCollected:     concurrentHistory.length,
      oldestPoint:         concurrentHistory[0]?.ts ?? null,
    });
  });

  // GET /api/dial-lookup/:number — resolve a number to country/breakout/destination
  app.get('/api/dial-lookup/:number', (req: any, res) => {
    const m = lookupDialCode(req.params.number);
    if (!m) return res.json({ found: false, number: req.params.number });
    res.json({ found: true, number: req.params.number, ...m });
  });

  // GET /api/dial-codes — serve raw dial-codes JSON for client-side prefix lookup
  app.get('/api/dial-codes', dialCodesHandler);

  // GET /api/download/feature-roadmap — serve the Feature Roadmap Word document (Vol I)
  app.get('/api/download/feature-roadmap', (_req: any, res: any) => {
    const filePath = require('path').join(process.cwd(), 'attached_assets', 'VoIP_Watcher_Feature_Roadmap.docx');
    res.download(filePath, 'VoIP_Watcher_Feature_Roadmap.docx', (err: any) => {
      if (err) res.status(404).json({ error: 'File not found' });
    });
  });

  // GET /api/download/feature-roadmap-v2 — serve the Extended Feature Proposals Vol II
  app.get('/api/download/feature-roadmap-v2', (_req: any, res: any) => {
    const filePath = require('path').join(process.cwd(), 'attached_assets', 'VoIP_Watcher_Extended_Features_Vol2.docx');
    res.download(filePath, 'VoIP_Watcher_Extended_Features_Vol2.docx', (err: any) => {
      if (err) res.status(404).json({ error: 'File not found' });
    });
  });

  // GET /api/download/status-report — Volume 1 Implementation Status Report
  app.get('/api/download/status-report', (_req: any, res: any) => {
    const filePath = _pathJoin(process.cwd(), 'attached_assets', 'VoIP_Platform_Volume1_Status.docx');
    res.download(filePath, 'VoIP_Platform_Volume1_Status.docx', (err: any) => {
      if (err) res.status(404).json({ error: 'File not found' });
    });
  });

  // GET /api/download/api-reference — Full API endpoint catalogue
  app.get('/api/download/api-reference', (_req: any, res: any) => {
    const filePath = _pathJoin(process.cwd(), 'attached_assets', 'VoIP_Platform_API_Reference.docx');
    res.download(filePath, 'VoIP_Platform_API_Reference.docx', (err: any) => {
      if (err) res.status(404).json({ error: 'File not found' });
    });
  });

  // POST /api/download/regenerate — rebuild the status-report .docx with all latest features (admin)
  app.post('/api/download/regenerate', async (req: any, res: any) => {
    try {
      if (!req.user) return res.status(401).json({ message: 'Unauthorized' });
      const userId = req.user.claims?.sub;
      const role = await storage.getUserRole(userId);
      if (role !== 'admin') return res.status(403).json({ message: 'Admin only' });
      await generateStatusReport(STATUS_REPORT_PATH);
      res.json({ ok: true, regeneratedAt: new Date().toISOString(), file: 'VoIP_Platform_Volume1_Status.docx' });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // GET /api/download/user-manual — serve the User Manual Word document (auto-generates if missing)
  app.get('/api/download/user-manual', async (_req: any, res: any) => {
    try {
      const { existsSync } = await import('fs');
      if (!existsSync(USER_MANUAL_PATH)) {
        await generateUserManual(USER_MANUAL_PATH);
      }
      res.download(USER_MANUAL_PATH, 'VoIP_Watcher_User_Manual.docx', (err: any) => {
        if (err && !res.headersSent) res.status(500).json({ message: 'Download error' });
      });
    } catch (e: any) {
      res.status(500).json({ message: `Failed to generate manual: ${e.message}` });
    }
  });

  // POST /api/download/regenerate-manual — build/rebuild the User Manual .docx (admin)
  app.post('/api/download/regenerate-manual', async (req: any, res: any) => {
    try {
      if (!req.user) return res.status(401).json({ message: 'Unauthorized' });
      const userId = req.user.claims?.sub;
      const role = await storage.getUserRole(userId);
      if (role !== 'admin') return res.status(403).json({ message: 'Admin only' });
      await generateUserManual(USER_MANUAL_PATH);
      res.json({ ok: true, regeneratedAt: new Date().toISOString(), file: 'VoIP_Watcher_User_Manual.docx' });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // GET /api/download/sippy-dataflow — serve the Sippy Data Flow Reference .docx (auto-generates if missing)
  app.get('/api/download/sippy-dataflow', async (_req: any, res: any) => {
    try {
      const { existsSync } = await import('fs');
      if (!existsSync(SIPPY_DATAFLOW_PATH)) {
        await generateSippyDataflowDoc(SIPPY_DATAFLOW_PATH);
      }
      res.download(SIPPY_DATAFLOW_PATH, 'VoIP_Watcher_Sippy_Dataflow_Reference.docx', (err: any) => {
        if (err && !res.headersSent) res.status(500).json({ message: 'Download error' });
      });
    } catch (e: any) {
      res.status(500).json({ message: `Failed to generate document: ${e.message}` });
    }
  });

  // POST /api/download/regenerate-sippy-dataflow — rebuild on demand (admin)
  app.post('/api/download/regenerate-sippy-dataflow', async (req: any, res: any) => {
    try {
      if (!req.user) return res.status(401).json({ message: 'Unauthorized' });
      const userId = req.user.claims?.sub;
      const role = await storage.getUserRole(userId);
      if (role !== 'admin') return res.status(403).json({ message: 'Admin only' });
      await generateSippyDataflowDoc(SIPPY_DATAFLOW_PATH);
      res.json({ ok: true, regeneratedAt: new Date().toISOString(), file: 'VoIP_Watcher_Sippy_Dataflow_Reference.docx' });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // GET /api/bitseye/per-entity — per-entity CDR time-series for BitsEye page
  app.get('/api/bitseye/per-entity', async (req: any, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    const category  = (req.query.category as string) || 'clients';
    const aliveOnly = req.query.aliveOnly !== 'false';
    const orderBy   = (req.query.orderBy as string) || 'traffic';
    const kamIdFilter   = req.query.kamId ? Number(req.query.kamId) : null;
    const countryFilter = (req.query.countryFilter as string) || '';
    const kamFilter     = (req.query.kamFilter     as string) || '';

    const now      = Date.now();
    const DAY_MS   = 24 * 3600 * 1000;
    const WEEK_MS  = 7  * DAY_MS;

    type Bucket = { total: number; connected: number; durSecs: number };

    // ── KAM mapping ──────────────────────────────────────────────────────────
    const clientToKam:  Record<string, string> = {};
    const clientToKamId: Record<string, number> = {};
    const kamClients:   Record<string, Set<string>> = {};
    const kamIdToName:  Record<number, string> = {};
    if (category === 'kam' || kamFilter) {
      try {
        const kams = await storage.getKams();
        // getKams() does NOT join kamAccounts — fetch accounts separately (same as /api/kam)
        const allAccounts = await storage.getKamAccounts();
        for (const k of kams) {
          kamIdToName[k.id] = k.name;
          kamClients[k.name] = kamClients[k.name] ?? new Set();
          const accs = allAccounts.filter(a => a.kamId === k.id);
          for (const acc of accs) {
            const cName = acc.clientName || `Acct.${acc.accountId}`;
            clientToKam[cName]   = k.name;
            clientToKamId[cName] = k.id;
            kamClients[k.name].add(cName);
          }
        }
      } catch (_) { /* storage unavailable */ }
    }

    // Build set of clients belonging to kamFilter (for CDR pre-filtering)
    const kamFilterClientSet: Set<string> | null = kamFilter
      ? new Set(Array.from(kamClients[kamFilter] ?? []))
      : null;

    // ── Time-series bucket labels ─────────────────────────────────────────────
    const hourlyLabels: string[] = [];
    for (let h = 23; h >= 0; h--) {
      const t = new Date(now - h * 3600 * 1000);
      hourlyLabels.push(
        t.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', hour12: true, timeZone: 'UTC' })
      );
    }
    const weeklyLabels: string[] = [];
    for (let d = 6; d >= 0; d--) {
      const t = new Date(now - d * DAY_MS);
      weeklyLabels.push(
        t.toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
      );
    }

    // ── Accumulate CDR data ───────────────────────────────────────────────────
    const dailyData:  Record<string, Record<string, Bucket>> = {};
    const weeklyData: Record<string, Record<string, Bucket>> = {};
    // For ASR/ACD across all cached CDRs per entity
    const entityTotals: Record<string, { total: number; connected: number; durSecs: number }> = {};

    // For destinations: track which clients send to each destination
    const destClients: Record<string, Set<string>> = {};

    const resolveKey = (c: any): string | null => {
      const raw = c.clientName || accountNameCache.get(String(c.iAccount ?? '')) || null;
      if (category === 'vendors')      return (c as any).vendor || null;
      if (category === 'kam')          return raw ? (clientToKam[raw] ?? 'Unassigned') : null;
      if (category === 'countries') {
        const dialMatch = lookupDialCode((c as any).callee ?? '');
        if (dialMatch) return dialMatch.country;
        return (c as any).country || null;
      }
      if (category === 'destinations') {
        // Use dial-code lookup to get "{Country} - {Breakout}" (e.g. "Pakistan - MOBILE JAZZ")
        // Falls back to Sippy's own country/areaName fields when lookup fails.
        const dialMatch = lookupDialCode((c as any).callee);
        if (dialMatch) return dialMatch.destination; // "{country} - {breakout}"
        const country = (c as any).country || null;
        const area    = (c as any).areaName || null;
        if (country && area) return `${country} - ${area}`;
        return country || area || null;
      }
      return raw;
    };

    // Helper to resolve destination country of a CDR (for countryFilter)
    const resolveCdrCountry = (c: any): string => {
      const dialMatch = lookupDialCode((c as any).callee ?? '');
      if (dialMatch) return dialMatch.country;
      return (c as any).country || '';
    };

    for (const c of cdrCache.values()) {
      // ── countryFilter: only include CDRs going to the specified destination country ──
      if (countryFilter && resolveCdrCountry(c) !== countryFilter) continue;
      // ── kamFilter: only include CDRs from clients managed by the specified KAM ──
      if (kamFilterClientSet) {
        const cName = (c as any).clientName || accountNameCache.get(String((c as any).iAccount ?? '')) || '';
        if (!kamFilterClientSet.has(cName)) continue;
      }
      const ts = c.startTime
        ? new Date(c.startTime).getTime()
        : c.connectTime ? new Date(c.connectTime).getTime() : 0;
      if (!ts) continue;
      const entity = resolveKey(c);
      if (!entity || entity === 'Unknown') continue;
      const isConn = (c.duration ?? 0) > 0;
      const dur    = Number(c.duration ?? 0);

      // Running totals (full cache, for ASR/ACD)
      if (!entityTotals[entity]) entityTotals[entity] = { total: 0, connected: 0, durSecs: 0 };
      entityTotals[entity].total++;
      if (isConn) { entityTotals[entity].connected++; entityTotals[entity].durSecs += dur; }

      // Track which clients send to each destination
      if (category === 'destinations') {
        const cName = (c as any).clientName || accountNameCache.get(String((c as any).iAccount ?? '')) || 'Unknown';
        if (!destClients[entity]) destClients[entity] = new Set();
        destClients[entity].add(cName);
      }

      // Daily buckets (last 24h)
      if (ts >= now - DAY_MS) {
        const t = new Date(ts);
        const label = t.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', hour12: true, timeZone: 'UTC' });
        if (!dailyData[entity]) dailyData[entity] = {};
        if (!dailyData[entity][label]) dailyData[entity][label] = { total: 0, connected: 0, durSecs: 0 };
        dailyData[entity][label].total++;
        if (isConn) { dailyData[entity][label].connected++; dailyData[entity][label].durSecs += dur; }
      }
      // Weekly buckets
      if (ts >= now - WEEK_MS) {
        const t = new Date(ts);
        const label = t.toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
        if (!weeklyData[entity]) weeklyData[entity] = {};
        if (!weeklyData[entity][label]) weeklyData[entity][label] = { total: 0, connected: 0, durSecs: 0 };
        weeklyData[entity][label].total++;
        if (isConn) { weeklyData[entity][label].connected++; weeklyData[entity][label].durSecs += dur; }
      }
    }

    // ── Concurrent snapshot + 24h history per entity ─────────────────────────
    const latestSnap  = concurrentHistory[concurrentHistory.length - 1];
    const latestByKey = category === 'vendors'
      ? (latestSnap?.byVendor ?? {})
      : (latestSnap?.byClient ?? {});

    // Build per-entity hourly concurrent peaks from history (last 24h)
    const concurrentPeaks: Record<string, Record<string, number>> = {};
    for (const pt of concurrentHistory) {
      if (pt.ts < now - DAY_MS) continue;
      const t = new Date(pt.ts);
      const label = t.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', hour12: true, timeZone: 'UTC' });
      // Destinations/countries have no concurrent-by-entity data — skip
      const byKey = category === 'vendors' ? pt.byVendor
        : (category === 'destinations' || category === 'countries') ? {} : pt.byClient;
      for (const [rawKey, cnt] of Object.entries(byKey)) {
        if (rawKey === 'Unknown') continue;
        const entityKey = category === 'kam' ? (clientToKam[rawKey] ?? 'Unassigned') : rawKey;
        if (!concurrentPeaks[entityKey]) concurrentPeaks[entityKey] = {};
        concurrentPeaks[entityKey][label] = Math.max(concurrentPeaks[entityKey][label] ?? 0, cnt);
      }
    }

    // ── Build entity set ──────────────────────────────────────────────────────
    const allEntities = new Set<string>();
    for (const k of Object.keys(dailyData))        allEntities.add(k);
    for (const k of Object.keys(weeklyData))       allEntities.add(k);
    for (const k of Object.keys(concurrentPeaks))  allEntities.add(k);
    if (category === 'kam') {
      for (const k of Object.keys(kamClients)) allEntities.add(k);
    } else if (category !== 'destinations' && category !== 'countries') {
      // For clients/vendors: supplement with live snapshot keys (not for destinations/countries — CDR-only keys)
      for (const k of Object.keys(latestByKey)) if (k !== 'Unknown') allEntities.add(k);
    }

    // If filtering to a specific KAM, keep only that KAM name
    const filterToKamName = (kamIdFilter && kamIdToName[kamIdFilter]) ? kamIdToName[kamIdFilter] : null;

    const safeMin = (arr: number[]) => arr.length === 0 ? 0 : Math.min(...arr);
    const safeMax = (arr: number[]) => arr.length === 0 ? 0 : Math.max(...arr);
    const safeAvg = (arr: number[]) => arr.length === 0 ? 0 : Math.round(arr.reduce((s, v) => s + v, 0) / arr.length);

    const entities: any[] = [];

    for (const name of allEntities) {
      // kamId filter: when a specific KAM is requested, skip all others
      if (filterToKamName && name !== filterToKamName) continue;

      const daily = hourlyLabels.map(label => ({
        label,
        total_calls:      dailyData[name]?.[label]?.total     ?? 0,
        connected_calls:  dailyData[name]?.[label]?.connected ?? 0,
        concurrent_calls: concurrentPeaks[name]?.[label]      ?? 0,
      }));
      const weekly = weeklyLabels.map(label => ({
        label,
        total_calls:     weeklyData[name]?.[label]?.total     ?? 0,
        connected_calls: weeklyData[name]?.[label]?.connected ?? 0,
      }));

      const allTotals = daily.map(d => d.total_calls);
      const allConns  = daily.map(d => d.connected_calls);
      const todayCalls = allTotals.reduce((s, v) => s + v, 0);

      // Concurrent (live) count — for KAM: sum across all managed clients
      let curConcurrent = 0;
      if (category === 'kam') {
        for (const cName of kamClients[name] ?? []) {
          curConcurrent += latestByKey[cName] ?? 0;
        }
      } else {
        curConcurrent = latestByKey[name] ?? 0;
      }

      if (aliveOnly && curConcurrent === 0 && todayCalls === 0) continue;
      if (name === 'Unassigned' && todayCalls === 0 && curConcurrent === 0) continue;

      // ── Trend: last 12h vs prior 12h ─────────────────────────────────────
      const last12  = allTotals.slice(12).reduce((s, v) => s + v, 0);
      const prior12 = allTotals.slice(0, 12).reduce((s, v) => s + v, 0);
      const trendPct = prior12 > 0 ? Math.round(((last12 - prior12) / prior12) * 100) : (last12 > 0 ? 100 : 0);

      // ── ASR & ACD ─────────────────────────────────────────────────────────
      const tot  = entityTotals[name] ?? { total: 0, connected: 0, durSecs: 0 };
      const asr  = tot.total > 0 ? Math.round((tot.connected / tot.total) * 100) : 0;
      const acd  = tot.connected > 0 ? Math.round(tot.durSecs / tot.connected) : 0; // seconds

      // ── Weekly ASR (for weekly chart label) ────────────────────────────────
      const weeklyTotalCalls = weekly.reduce((s, p) => s + p.total_calls,     0);
      const weeklyConnCalls  = weekly.reduce((s, p) => s + p.connected_calls, 0);
      const weeklyAsr = weeklyTotalCalls > 0 ? Math.round((weeklyConnCalls / weeklyTotalCalls) * 100) : 0;

      const lastUpdate = latestSnap ? new Date(latestSnap.ts) : new Date();

      // KAM: list of managed client names; Destinations: list of clients sending to this dest
      const clients = category === 'kam'
        ? Array.from(kamClients[name] ?? []).sort()
        : category === 'destinations'
          ? Array.from(destClients[name] ?? []).filter(c => c !== 'Unknown').sort()
          : undefined;

      // For destinations: split "Country - Breakout" into separate filterable fields
      let destCountry: string | undefined;
      let destBreakout: string | undefined;
      if (category === 'destinations') {
        const sep = name.indexOf(' - ');
        if (sep > 0) {
          destCountry  = name.slice(0, sep);
          destBreakout = name.slice(sep + 3);
        } else {
          destCountry = name;
        }
      }

      entities.push({
        name, daily, weekly, curConcurrent, todayCalls,
        trendPct, asr, acdSecs: acd, weeklyAsr,
        clients, destCountry, destBreakout,
        stats: {
          total:     { cur: allTotals[allTotals.length - 1] ?? 0, min: safeMin(allTotals), max: safeMax(allTotals), avg: safeAvg(allTotals) },
          connected: { cur: allConns[allConns.length - 1]   ?? 0, min: safeMin(allConns),  max: safeMax(allConns),  avg: safeAvg(allConns)  },
        },
        lastUpdatedAt:   lastUpdate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
        lastUpdatedDate: lastUpdate.toLocaleDateString('en-CA'),
      });
    }

    if (orderBy === 'name') {
      entities.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      entities.sort((a, b) => (b.todayCalls - a.todayCalls) || a.name.localeCompare(b.name));
    }

    // ── Summary across all entities ───────────────────────────────────────────
    const totalConcurrent = entities.reduce((s, e) => s + e.curConcurrent, 0);
    const totalToday      = entities.reduce((s, e) => s + e.todayCalls, 0);
    const allCdrTot       = Object.values(entityTotals).reduce((s, v) => s + v.total, 0);
    const allCdrConn      = Object.values(entityTotals).reduce((s, v) => s + v.connected, 0);
    const overallAsr      = allCdrTot > 0 ? Math.round((allCdrConn / allCdrTot) * 100) : 0;
    const overallAcd      = allCdrConn > 0
      ? Math.round(Object.values(entityTotals).reduce((s, v) => s + v.durSecs, 0) / allCdrConn)
      : 0;

    res.json({
      entities,
      totalEntities: entities.length,
      updatedAt:     new Date().toISOString(),
      summary: { totalConcurrent, totalToday, overallAsr, overallAcdSecs: overallAcd },
    });
  });

  // ── Reachability poller (every 30 s) ─────────────────────────────────────────
  // Init state from DB first (restores open outage + closes phantom duplicates)
  setTimeout(async () => {
    await initReachabilityState();
    await checkReachability();
  }, 15000);
  setInterval(() => checkReachability(), 30 * 1000);

  // ── GEO ENDPOINTS ──────────────────────────────────────────────────────────

  // Cached world GeoJSON (fetched once from CDN, never expires in process lifetime)
  let worldGeoJsonCache: any = null;
  app.get('/api/geo/world', async (_req, res) => {
    try {
      if (!worldGeoJsonCache) {
        const r = await fetch(
          'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json'
        );
        const topo = await r.json();
        // Convert TopoJSON → GeoJSON using the embedded topology
        // We'll return it raw and let the client use topojson-client
        worldGeoJsonCache = topo;
      }
      res.json(worldGeoJsonCache);
    } catch (e: any) {
      res.status(502).json({ error: 'Could not fetch world GeoJSON', detail: e.message });
    }
  });

  // Country name → ISO-3166-1 numeric map (matches world-atlas country IDs)
  const COUNTRY_NAME_TO_NUMERIC: Record<string, string> = {
    'Afghanistan': '4', 'Albania': '8', 'Algeria': '12', 'Angola': '24',
    'Argentina': '32', 'Armenia': '51', 'Australia': '36', 'Austria': '40',
    'Azerbaijan': '31', 'Bahrain': '48', 'Bangladesh': '50', 'Belarus': '112',
    'Belgium': '56', 'Bolivia': '68', 'Bosnia and Herzegovina': '70',
    'Brazil': '76', 'Bulgaria': '100', 'Cambodia': '116', 'Cameroon': '120',
    'Canada': '124', 'Chile': '152', 'China': '156', 'Colombia': '170',
    'Congo': '178', 'Costa Rica': '188', 'Croatia': '191', 'Cuba': '192',
    'Czech Republic': '203', 'Denmark': '208', 'Dominican Republic': '214',
    'Ecuador': '218', 'Egypt': '818', 'El Salvador': '222', 'Estonia': '233',
    'Ethiopia': '231', 'Finland': '246', 'France': '250', 'Georgia': '268',
    'Germany': '276', 'Ghana': '288', 'Greece': '300', 'Guatemala': '320',
    'Guinea': '324', 'Haiti': '332', 'Honduras': '340', 'Hungary': '348',
    'India': '356', 'Indonesia': '360', 'Iran': '364', 'Iraq': '368',
    'Ireland': '372', 'Israel': '376', 'Italy': '380', 'Jamaica': '388',
    'Japan': '392', 'Jordan': '400', 'Kazakhstan': '398', 'Kenya': '404',
    'South Korea': '410', 'Korea': '410', 'Kosovo': '383', 'Kuwait': '414',
    'Kyrgyzstan': '417', 'Laos': '418', 'Latvia': '428', 'Lebanon': '422',
    'Libya': '434', 'Lithuania': '440', 'Luxembourg': '442', 'Malaysia': '458',
    'Mexico': '484', 'Moldova': '498', 'Morocco': '504', 'Mozambique': '508',
    'Myanmar': '104', 'Nepal': '524', 'Netherlands': '528', 'New Zealand': '554',
    'Nicaragua': '558', 'Nigeria': '566', 'North Korea': '408', 'Norway': '578',
    'Oman': '512', 'Pakistan': '586', 'Palestine': '275', 'Panama': '591',
    'Paraguay': '600', 'Peru': '604', 'Philippines': '608', 'Poland': '616',
    'Portugal': '620', 'Qatar': '634', 'Romania': '642', 'Russia': '643',
    'Rwanda': '646', 'Saudi Arabia': '682', 'Senegal': '686', 'Serbia': '688',
    'Sierra Leone': '694', 'Singapore': '702', 'Slovakia': '703',
    'Somalia': '706', 'South Africa': '710', 'South Sudan': '728',
    'Spain': '724', 'Sri Lanka': '144', 'Sudan': '729', 'Sweden': '752',
    'Switzerland': '756', 'Syria': '760', 'Taiwan': '158', 'Tajikistan': '762',
    'Tanzania': '834', 'Thailand': '764', 'Tunisia': '788', 'Turkey': '792',
    'Turkmenistan': '795', 'Uganda': '800', 'Ukraine': '804',
    'United Arab Emirates': '784', 'UAE': '784', 'United Kingdom': '826',
    'UK': '826', 'United States': '840', 'USA': '840', 'Uruguay': '858',
    'Uzbekistan': '860', 'Venezuela': '862', 'Vietnam': '704', 'Yemen': '887',
    'Zambia': '894', 'Zimbabwe': '716',
    // African countries
    'Burkina Faso': '854', 'Burundi': '108', 'Cape Verde': '132',
    'Central African Republic': '140', 'Chad': '148', 'Comoros': '174',
    'Djibouti': '262', 'Equatorial Guinea': '226', 'Eritrea': '232',
    'Gabon': '266', "Cote d'Ivoire": '384', 'Ivory Coast': '384',
    'Lesotho': '426', 'Liberia': '430', 'Madagascar': '450', 'Malawi': '454',
    'Mali': '466', 'Mauritania': '478', 'Mauritius': '480', 'Namibia': '516',
    'Niger': '562', 'Republic of Congo': '178', 'Sao Tome and Principe': '678',
    'Seychelles': '690', 'Swaziland': '748', 'Eswatini': '748',
    'Togo': '768', 'Benin': '204', 'Botswana': '72',
    // Middle East/Asia extras
    'Bahamas': '44', 'Barbados': '52', 'Belize': '84',
    'Trinidad and Tobago': '780', 'Trinidad & Tobago': '780',
    'Guyana': '328', 'Suriname': '740', 'Papua New Guinea': '598',
    'Fiji': '242', 'Solomon Islands': '90', 'Vanuatu': '548',
    'Mongolia': '496', 'Bhutan': '64', 'Maldives': '462',
    'Timor-Leste': '626', 'East Timor': '626',
    'Brunei': '96', 'Brunei Darussalam': '96',
    'Macau': '446', 'Hong Kong': '344',
  };

  // GET /api/traffic-map — CDR traffic aggregated by destination country
  app.get('/api/traffic-map', async (req: any, res) => {
    try {
      const settings = await storage.getSettings();
      const credPairs = sippyXmlCredsPairs(settings);
      const hours = Math.min(168, Math.max(1, Number(req.query.hours) || 24));

      // Paginate CDRs in 2-hour chunks (6 parallel) to avoid the 12 s HTTP
      // timeout that fires for large single-request ranges (24h, 5000 rows).
      const CHUNK_HRS   = 2;
      const CHUNK_LIMIT = 1000;
      const numChunks   = Math.ceil(hours / CHUNK_HRS);
      const now         = Date.now();

      const chunkTasks = Array.from({ length: numChunks }, (_, i) => ({
        startDate: sippy.toSippyDate(new Date(now - (i + 1) * CHUNK_HRS * 3_600_000)),
        endDate:   sippy.toSippyDate(new Date(now - i       * CHUNK_HRS * 3_600_000)),
      }));

      // Batch into groups of 6 parallel calls
      const PARALLEL = 6;
      let allCdrs: Awaited<ReturnType<typeof sippy.getSippyCDRs>> = [];
      for (let b = 0; b < chunkTasks.length; b += PARALLEL) {
        const batch = chunkTasks.slice(b, b + PARALLEL);
        const results = await Promise.all(batch.map(async ({ startDate: sd, endDate: ed }) => {
          for (const { username, password } of credPairs) {
            try {
              const rows = await sippy.getSippyCDRs(username, password, CHUNK_LIMIT, { startDate: sd, endDate: ed });
              if (rows.length > 0) return rows;
            } catch { /* ignore per-chunk timeout */ }
          }
          return [] as Awaited<ReturnType<typeof sippy.getSippyCDRs>>;
        }));
        for (const r of results) allCdrs = allCdrs.concat(r);
      }
      const cdrs = allCdrs;

      // Debug: log how many CDRs fetched and sample country data
      console.log(`[traffic-map] Fetched ${cdrs.length} CDRs for last ${hours}h (${numChunks} chunks).`,
        cdrs.slice(0, 2).map(c => ({ country: c.country, area: c.areaName }))
      );

      // Aggregate by country
      type CountryStats = { calls: number; answered: number; totalSecs: number; };
      const byCountry = new Map<string, CountryStats>();

      for (const cdr of cdrs) {
        const name = cdr.country || cdr.areaName || 'Unknown';
        if (!byCountry.has(name)) byCountry.set(name, { calls: 0, answered: 0, totalSecs: 0 });
        const g = byCountry.get(name)!;
        g.calls++;
        const answered = cdr.duration > 0 || /^(200|ok|answered|success)/i.test(cdr.result || '');
        if (answered) { g.answered++; g.totalSecs += cdr.duration; }
      }

      const totalCalls = cdrs.length;
      const rows = Array.from(byCountry.entries())
        .map(([name, g]) => ({
          name,
          numericId: COUNTRY_NAME_TO_NUMERIC[name] ?? null,
          calls:     g.calls,
          answered:  g.answered,
          pct:       totalCalls > 0 ? Math.round((g.calls / totalCalls) * 1000) / 10 : 0,
          asr:       g.calls > 0    ? Math.round((g.answered / g.calls) * 100) : 0,
          avgDurSecs: g.answered > 0 ? Math.round(g.totalSecs / g.answered) : 0,
          totalMins: Math.round(g.totalSecs / 60),
        }))
        .sort((a, b) => b.calls - a.calls);

      res.json({ countries: rows, total: totalCalls, hours });
    } catch (e: any) {
      res.status(500).json({ countries: [], total: 0, error: e.message });
    }
  });

  // GET /api/call-history — last N hours of call snapshots (max 24h)
  app.get('/api/call-history', async (req: any, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    try {
      const hours = Math.min(24, Math.max(1, Number(req.query.hours) || 24));
      const rows = await storage.getCallHistory(hours);
      // Post-process: if clientName is missing or is a bare numeric account ID, resolve
      // it from the live accountNameCache (handles rows written before cache was warm).
      const resolvedRows = rows.map(row => {
        let clientName = row.clientName ?? undefined;
        if (!clientName || /^\d+$/.test(clientName)) {
          const id = clientName || (row.accountId ? String(row.accountId) : '');
          if (id) clientName = accountNameCache.get(id) || clientName || undefined;
        }
        // Similarly resolve vendor if missing but connection is known
        let vendor = row.vendor ?? undefined;
        if (!vendor && row.connection) {
          vendor = connectionVendorCache.get(row.connection) || undefined;
        }
        return { ...row, clientName: clientName ?? null, vendor: vendor ?? null };
      });
      res.json({ calls: resolvedRows, hoursBack: hours });
    } catch (e: any) {
      res.status(500).json({ calls: [], error: e.message });
    }
  });

  // GET /api/call-history/route-quality?hours=24
  // Aggregates 24h call snapshots by vendor/route and returns quality metrics
  // for route analysis: avg/p95 PDD, codec distribution, hourly trend buckets.
  app.get('/api/call-history/route-quality', async (req: any, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    try {
      const hours = Math.min(24, Math.max(1, Number(req.query.hours) || 24));
      const rows = await storage.getCallHistory(hours);

      // Group by vendor (fall back to connection id or "Unknown")
      const groups: Record<string, typeof rows> = {};
      for (const row of rows) {
        const key = row.vendor || (row.connection ? `Conn#${row.connection}` : 'Unknown');
        if (!groups[key]) groups[key] = [];
        groups[key].push(row);
      }

      const routes = Object.entries(groups).map(([vendor, calls]) => {
        const pddValues = calls.map(c => c.pddMs ?? 0).filter(v => v > 0).sort((a, b) => a - b);
        const avgPddMs  = pddValues.length ? Math.round(pddValues.reduce((s, v) => s + v, 0) / pddValues.length) : 0;
        const p95PddMs  = pddValues.length ? (pddValues[Math.floor(pddValues.length * 0.95)] ?? pddValues[pddValues.length - 1] ?? 0) : 0;
        const maxPddMs  = pddValues.length ? pddValues[pddValues.length - 1] : 0;

        // Codec distribution
        const codecs: Record<string, number> = {};
        for (const c of calls) {
          const codec = c.codec && c.codec !== '-' ? c.codec : null;
          if (codec) codecs[codec] = (codecs[codec] ?? 0) + 1;
        }

        // Hourly buckets for trend chart — bucket by firstSeen truncated to the hour
        const hourly: Record<string, { callCount: number; totalPdd: number; goodCalls: number }> = {};
        for (const c of calls) {
          const d = new Date(c.firstSeen);
          const hour = `${d.toISOString().slice(0, 13)}:00`;
          if (!hourly[hour]) hourly[hour] = { callCount: 0, totalPdd: 0, goodCalls: 0 };
          hourly[hour].callCount++;
          hourly[hour].totalPdd += c.pddMs ?? 0;
          if ((c.pddMs ?? 0) < 2000) hourly[hour].goodCalls++;
        }
        const hourlyBuckets = Object.entries(hourly)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([hour, data]) => ({
            hour,
            callCount:  data.callCount,
            avgPddMs:   data.callCount > 0 ? Math.round(data.totalPdd / data.callCount) : 0,
            goodPct:    data.callCount > 0 ? Math.round((data.goodCalls / data.callCount) * 100) : 0,
          }));

        const connections = Array.from(new Set(calls.map(c => c.connection).filter(Boolean)));
        const clients     = Array.from(new Set(calls.map(c => c.clientName).filter(Boolean)));
        const goodCalls   = calls.filter(c => (c.pddMs ?? 0) > 0 && (c.pddMs ?? 0) < 2000).length;
        const badCalls    = calls.filter(c => (c.pddMs ?? 0) >= 3000).length;

        return {
          vendor, callCount: calls.length, avgPddMs, p95PddMs, maxPddMs,
          goodCalls, badCalls, goodPct: calls.length > 0 ? Math.round((goodCalls / calls.length) * 100) : 0,
          codecs, hourlyBuckets, connections, clients,
        };
      }).sort((a, b) => b.callCount - a.callCount);

      res.json({ routes, hoursBack: hours, totalCalls: rows.length });
    } catch (e: any) {
      res.status(500).json({ routes: [], error: e.message });
    }
  });

  // ── KAM Management Routes ─────────────────────────────────────────────────────

  // List all KAMs (with their assigned accounts)
  app.get('/api/kam', async (_req, res) => {
    try {
      const kamList = await storage.getKams();
      const assignments = await storage.getKamAccounts();
      const withAccounts = kamList.map(k => ({
        ...k,
        accounts: assignments.filter(a => a.kamId === k.id),
      }));
      res.json(withAccounts);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Create KAM
  app.post('/api/kam', async (req: any, res) => {
    try {
      const { name, email, phone, title } = req.body;
      if (!name || !email) return res.status(400).json({ error: 'name and email required' });
      const kam = await storage.createKam({ name, email, phone: phone || null, title: title || null, active: true });
      res.json(kam);
      regenDataflowDoc();
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Update KAM
  app.patch('/api/kam/:id', async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const kam = await storage.updateKam(id, req.body);
      res.json(kam);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Delete KAM (also deletes assignments)
  app.delete('/api/kam/:id', async (req: any, res) => {
    try {
      await storage.deleteKam(parseInt(req.params.id));
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Assign an account to a KAM
  app.post('/api/kam/:id/accounts', async (req: any, res) => {
    try {
      const kamId = parseInt(req.params.id);
      const { accountId, clientName, dropThreshold } = req.body;
      if (!accountId) return res.status(400).json({ error: 'accountId required' });
      const assignment = await storage.createKamAccount({ kamId, accountId, clientName: clientName || null, dropThreshold: dropThreshold ?? 0 });
      res.json(assignment);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Remove an account assignment
  app.delete('/api/kam/accounts/:assignmentId', async (req: any, res) => {
    try {
      await storage.deleteKamAccount(parseInt(req.params.assignmentId));
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Traffic Alerts history
  app.get('/api/traffic-alerts', async (_req, res) => {
    try {
      const alerts = await storage.getTrafficAlerts(100);
      res.json(alerts);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Traffic Alert System ──────────────────────────────────────────────────────
  // Separate per-type cooldown maps to avoid spam while allowing fast re-alert on traffic_gone
  const goneAlertCooldown  = new Map<string, number>(); // traffic_gone     — 15 min
  const dropAlertCooldown  = new Map<string, number>(); // traffic_dropped  — 30 min
  const trendAlertCooldown = new Map<string, number>(); // traffic_decreasing — 60 min

  const GONE_COOLDOWN_MS  = 15 * 60 * 1000;
  const DROP_COOLDOWN_MS  = 30 * 60 * 1000;
  const TREND_COOLDOWN_MS = 60 * 60 * 1000;

  // Linear regression — returns slope in calls/minute (negative = declining)
  function computeLinearSlope(points: { ts: number; v: number }[]): number {
    const n = points.length;
    if (n < 3) return 0;
    const t0 = points[0].ts;
    const xs = points.map(p => (p.ts - t0) / 60_000); // minutes
    const ys = points.map(p => p.v);
    const sumX  = xs.reduce((s, x) => s + x, 0);
    const sumY  = ys.reduce((s, y) => s + y, 0);
    const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0);
    const sumX2 = xs.reduce((s, x) => s + x * x, 0);
    const denom = n * sumX2 - sumX * sumX;
    return denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
  }

  // Enhanced SVG chart (optional dashed trend line for decreasing-trend emails)
  function buildClientTrendSvg(clientName: string, historyWindow: ConcurrentPoint[], showTrendLine = false): string {
    const points = historyWindow.map(p => ({ ts: p.ts, v: p.byClient[clientName] ?? 0 }));
    if (points.length < 2) return '';
    const maxV = Math.max(...points.map(p => p.v), 1);
    const W = 520, H = 100, PAD = 8;
    const ux = (i: number) => PAD + (i / (points.length - 1)) * (W - PAD * 2);
    const uy = (v: number) => PAD + (1 - Math.min(v, maxV) / maxV) * (H - PAD * 2);
    const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${ux(i).toFixed(1)},${uy(p.v).toFixed(1)}`).join(' ');
    const area = `${path} L${ux(points.length - 1).toFixed(1)},${(H - PAD).toFixed(1)} L${PAD},${(H - PAD).toFixed(1)} Z`;
    const lastV = points[points.length - 1].v;
    const color = lastV === 0 ? '#ef4444' : lastV < maxV * 0.5 ? '#f97316' : '#22c55e';
    const t0 = points[0].ts;
    const tLast = points[points.length - 1].ts;
    const firstLabel = new Date(t0).toISOString().slice(11, 16) + 'Z';
    const lastLabel  = new Date(tLast).toISOString().slice(11, 16) + 'Z';

    let trendSvg = '';
    if (showTrendLine && points.length >= 3) {
      const slope = computeLinearSlope(points);
      const meanT = ((tLast - t0) / 60_000) / 2;
      const meanY = points.reduce((s, p) => s + p.v, 0) / points.length;
      const intercept = meanY - slope * meanT;
      const ty0   = Math.max(0, Math.min(maxV, intercept));
      const tyEnd = Math.max(0, Math.min(maxV, slope * ((tLast - t0) / 60_000) + intercept));
      trendSvg = `<line x1="${ux(0).toFixed(1)}" y1="${uy(ty0).toFixed(1)}" x2="${ux(points.length - 1).toFixed(1)}" y2="${uy(tyEnd).toFixed(1)}" stroke="#fbbf24" stroke-width="1.5" stroke-dasharray="5,4" opacity="0.8"/>`;
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H + 18}" style="background:#111827;border-radius:8px">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity="0.4"/><stop offset="100%" stop-color="${color}" stop-opacity="0.05"/></linearGradient></defs>
  <path d="${area}" fill="url(#g)"/>
  <path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
  ${trendSvg}
  <text x="${PAD}" y="${H + 14}" font-size="9" fill="#6b7280" font-family="sans-serif">${firstLabel}</text>
  <text x="${W - PAD}" y="${H + 14}" font-size="9" fill="#6b7280" font-family="sans-serif" text-anchor="end">${lastLabel}</text>
  <text x="${W / 2}" y="${PAD + 10}" font-size="9" fill="#9ca3af" font-family="sans-serif" text-anchor="middle">${clientName} · peak: ${maxV} · now: ${lastV}</text>
</svg>`;
  }

  // Build an HTML email body for traffic alerts (gone / dropped / decreasing trend)
  function buildTrafficAlertEmail(opts: {
    kamName: string; kamEmail: string; clientName: string;
    alertType: string; prevCalls: number; currCalls: number;
    svgChart: string; productionUrl: string; slopePerMin?: number;
  }): { subject: string; html: string } {
    const { kamName, clientName, alertType, prevCalls, currCalls, svgChart, slopePerMin } = opts;
    const isGone    = alertType === 'traffic_gone';
    const isTrend   = alertType === 'traffic_decreasing';
    const pct = prevCalls > 0 ? Math.round(((prevCalls - currCalls) / prevCalls) * 100) : 100;

    const subject = isGone
      ? `🔴 Traffic Alert: ${clientName} — calls dropped to ZERO`
      : isTrend
        ? `📉 Trending Down: ${clientName} — traffic declining ${pct}% (slope: ${slopePerMin?.toFixed(2) ?? '?'} calls/min)`
        : `🟠 Traffic Drop: ${clientName} — calls fell ${pct}% (${prevCalls} → ${currCalls})`;

    const headerBg    = isGone ? '#7f1d1d' : isTrend ? '#1e1b4b' : '#7c2d12';
    const headerTitle = isGone
      ? '🔴 Traffic Gone — Zero Calls Detected'
      : isTrend
        ? '📉 Traffic Trend Declining — 1-Hour Analysis'
        : '🟠 Traffic Drop Detected';

    const bodyText = isGone
      ? `The client <strong style="color:#f87171">${clientName}</strong> has dropped to <strong style="color:#f87171">0 concurrent calls</strong> (was <strong>${prevCalls}</strong>). Immediate attention may be required.`
      : isTrend
        ? `Traffic for <strong style="color:#818cf8">${clientName}</strong> is trending downward. Over the last hour the slope is <strong style="color:#fbbf24">${slopePerMin?.toFixed(2) ?? '?'} calls/min</strong>. Calls dropped from the 60-min peak of <strong>${prevCalls}</strong> to <strong>${currCalls}</strong> now (${pct}% decline). Please coordinate with the client.`
        : `The client <strong style="color:#fb923c">${clientName}</strong> concurrent calls dropped by <strong style="color:#fb923c">${pct}%</strong> — from <strong>${prevCalls}</strong> to <strong>${currCalls}</strong>.`;

    const chartLabel = isTrend ? '1-Hour Trend (dashed = trend line)' : '1-Hour Trend';
    const currColor  = isGone ? '#f87171' : isTrend ? '#818cf8' : '#fb923c';

    const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0f172a;font-family:sans-serif;color:#e2e8f0">
<div style="max-width:600px;margin:32px auto;background:#1e293b;border-radius:12px;overflow:hidden;border:1px solid #334155">
  <div style="background:${headerBg};padding:20px 24px;border-bottom:1px solid #334155">
    <h1 style="margin:0;font-size:20px;font-weight:700;color:#fff">${headerTitle}</h1>
    <p style="margin:6px 0 0;font-size:13px;color:#fca5a5">VoIP Monitoring Alert · ${new Date().toUTCString()}</p>
  </div>
  <div style="padding:24px">
    <p style="margin:0 0 16px;font-size:15px">Hi <strong>${kamName}</strong>,</p>
    <p style="margin:0 0 20px;font-size:14px;color:#94a3b8">${bodyText}</p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
      <tr>
        <td style="padding:10px 14px;background:#0f172a;border-radius:8px 8px 0 0;border-bottom:1px solid #334155;font-size:13px;color:#94a3b8;font-weight:600">CLIENT</td>
        <td style="padding:10px 14px;background:#0f172a;border-radius:8px 8px 0 0;border-bottom:1px solid #334155;font-size:13px;color:#e2e8f0">${clientName}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;background:#0f172a;border-bottom:1px solid #334155;font-size:13px;color:#94a3b8;font-weight:600">${isTrend ? '60-MIN PEAK' : 'PREVIOUS CALLS'}</td>
        <td style="padding:10px 14px;background:#0f172a;border-bottom:1px solid #334155;font-size:13px;color:#22c55e">${prevCalls}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;background:#0f172a;${isTrend ? 'border-bottom:1px solid #334155;' : 'border-radius:0 0 8px 8px;'}font-size:13px;color:#94a3b8;font-weight:600">CURRENT CALLS</td>
        <td style="padding:10px 14px;background:#0f172a;${isTrend ? 'border-bottom:1px solid #334155;' : 'border-radius:0 0 8px 8px;'}font-size:13px;color:${currColor}">${currCalls}</td>
      </tr>
      ${isTrend ? `
      <tr>
        <td style="padding:10px 14px;background:#0f172a;border-radius:0 0 8px 8px;font-size:13px;color:#94a3b8;font-weight:600">TREND SLOPE</td>
        <td style="padding:10px 14px;background:#0f172a;border-radius:0 0 8px 8px;font-size:13px;color:#fbbf24">${slopePerMin?.toFixed(3) ?? '?'} calls/min</td>
      </tr>` : ''}
    </table>
    ${svgChart ? `<div style="margin-bottom:20px"><p style="margin:0 0 8px;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em">${chartLabel}</p>${svgChart}</div>` : ''}
    <a href="${opts.productionUrl}/graphs" style="display:inline-block;padding:10px 22px;background:#7c3aed;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600">View Live Graphs →</a>
  </div>
  <div style="padding:14px 24px;border-top:1px solid #334155;font-size:11px;color:#475569">
    This alert was sent because you are the assigned KAM for ${clientName}. VoIP Watcher — NOC Dashboard.
  </div>
</div>
</body></html>`;
    return { subject, html };
  }

  // Helper: send a traffic alert email via Gmail
  async function sendTrafficAlertEmail(settings: any, recipients: string[], emailPayload: { subject: string; html: string }, dbAlertId: number, logTag: string) {
    try {
      const nodemailer = await import('nodemailer');
      const transporter = nodemailer.default.createTransport({
        service: 'gmail',
        auth: { user: settings.alertGmailUser, pass: settings.alertGmailAppPass },
      });
      await transporter.sendMail({
        from: `"VoIP Watcher" <${settings.alertGmailUser}>`,
        to: recipients.join(', '),
        subject: emailPayload.subject,
        html: emailPayload.html,
      });
      await storage.updateTrafficAlert(dbAlertId, { emailSent: true, emailSentAt: new Date() });
      console.log(`[${logTag}] Email sent → ${recipients.join(', ')}`);
    } catch (emailErr: any) {
      console.warn(`[${logTag}] Email send failed:`, emailErr.message);
    }
  }

  // ── Traffic Drop Detector (runs every 5 min) ──────────────────────────────
  // Detects sudden drops: traffic_gone (0 calls) and traffic_dropped (<50% of 60-min peak)
  async function runTrafficDropDetector(): Promise<void> {
    try {
      if (concurrentHistory.length < 2) return;
      const settings = await storage.getSippySettings();
      if (!settings?.alertEnabled || !settings?.alertGmailUser || !settings?.alertGmailAppPass) return;

      const latest = concurrentHistory[concurrentHistory.length - 1];
      const since60 = Date.now() - 60 * 60 * 1000;
      const recentPoints = concurrentHistory.filter(p => p.ts >= since60);
      if (recentPoints.length < 2) return;

      const allClients = new Set<string>();
      for (const p of recentPoints) Object.keys(p.byClient).forEach(c => allClients.add(c));

      const kamAccountList = await storage.getKamAccounts();
      const kamList        = await storage.getKams();
      const kamById        = new Map(kamList.map(k => [k.id, k]));
      const productionUrl  = 'https://vo-ip-watcher--junaid70.replit.app';

      for (const clientName of allClients) {
        const now       = Date.now();
        const currCalls = latest.byClient[clientName] ?? 0;
        const prevPoints = recentPoints.slice(0, -1);
        const prevMax    = Math.max(...prevPoints.map(p => p.byClient[clientName] ?? 0));
        if (prevMax === 0) continue;

        // Determine alert type and check appropriate cooldown
        let alertType: string | null = null;
        if (currCalls === 0 && prevMax > 0) {
          if (now - (goneAlertCooldown.get(clientName) ?? 0) < GONE_COOLDOWN_MS) continue;
          alertType = 'traffic_gone';
          goneAlertCooldown.set(clientName, now);
        } else if (currCalls > 0 && currCalls < prevMax * 0.5) {
          if (now - (dropAlertCooldown.get(clientName) ?? 0) < DROP_COOLDOWN_MS) continue;
          alertType = 'traffic_dropped';
          dropAlertCooldown.set(clientName, now);
        }

        if (!alertType) {
          const open = await storage.getOpenTrafficAlert(clientName);
          if (open && currCalls >= prevMax * 0.7) {
            await storage.updateTrafficAlert(open.id, { resolvedAt: new Date(), alertType: 'traffic_restored' });
          }
          continue;
        }

        const assignment = kamAccountList.find(a => a.clientName === clientName);
        const kam        = assignment ? kamById.get(assignment.kamId) : null;

        const dbAlert = await storage.createTrafficAlert({
          clientName, accountId: assignment?.accountId ?? null,
          kamId: kam?.id ?? null, alertType,
          prevCalls: prevMax, currCalls, emailSent: false,
        });

        const window1h = concurrentHistory.filter(p => p.ts >= Date.now() - 3600 * 1000);
        const svgChart = buildClientTrendSvg(clientName, window1h);
        const recipients: string[] = [];
        if (kam?.email) recipients.push(kam.email);
        if (settings.alertAdminEmail && !recipients.includes(settings.alertAdminEmail)) recipients.push(settings.alertAdminEmail);
        if (recipients.length === 0) continue;

        const emailPayload = buildTrafficAlertEmail({
          kamName: kam?.name ?? 'NOC Team', kamEmail: recipients[0],
          clientName, alertType, prevCalls: prevMax, currCalls, svgChart, productionUrl,
        });
        await sendTrafficAlertEmail(settings, recipients, emailPayload, dbAlert.id, 'traffic-drop');
        // WhatsApp alert (non-blocking)
        waSvc.sendWhatsAppAlert('traffic', waSvc.formatTrafficAlert({
          clientName, alertType, prevCalls: prevMax, currCalls,
        })).catch(() => {});
      }
    } catch (err: any) {
      console.warn('[traffic-drop] Detector error:', err.message);
    }
  }

  // ── Hourly Traffic Trend Analyzer ────────────────────────────────────────────
  // Uses linear regression on the last 60 min to detect sustained declining trends.
  // Fires alert when slope < -0.5 calls/min AND current calls < 75% of 60-min peak.
  async function runHourlyTrendAnalyzer(): Promise<void> {
    try {
      if (concurrentHistory.length < 6) return; // need meaningful history
      const settings = await storage.getSippySettings();
      if (!settings?.alertEnabled || !settings?.alertGmailUser || !settings?.alertGmailAppPass) return;

      const since60  = Date.now() - 60 * 60 * 1000;
      const window1h = concurrentHistory.filter(p => p.ts >= since60);
      if (window1h.length < 6) return; // need at least 6 points (~30 min at 5-min intervals)

      const latest = window1h[window1h.length - 1];

      // Collect all clients that appeared in this window
      const allClients = new Set<string>();
      for (const p of window1h) Object.keys(p.byClient).forEach(c => allClients.add(c));

      const kamAccountList = await storage.getKamAccounts();
      const kamList        = await storage.getKams();
      const kamById        = new Map(kamList.map(k => [k.id, k]));
      const productionUrl  = 'https://vo-ip-watcher--junaid70.replit.app';

      console.log(`[trend-analyzer] Running 1-hour trend analysis for ${allClients.size} clients`);

      for (const clientName of allClients) {
        const now = Date.now();
        if (now - (trendAlertCooldown.get(clientName) ?? 0) < TREND_COOLDOWN_MS) continue;

        const pts = window1h.map(p => ({ ts: p.ts, v: p.byClient[clientName] ?? 0 }));
        const currCalls = latest.byClient[clientName] ?? 0;
        const peakCalls = Math.max(...pts.map(p => p.v));
        if (peakCalls < 2) continue; // ignore clients with negligible traffic

        const slope = computeLinearSlope(pts);
        // Require: clearly declining slope AND current below 75% of peak
        if (slope >= -0.5) continue;
        if (currCalls >= peakCalls * 0.75) continue;
        // Skip if traffic is completely gone (handled by drop detector)
        if (currCalls === 0) continue;

        console.log(`[trend-analyzer] ${clientName}: slope=${slope.toFixed(3)} calls/min, curr=${currCalls}, peak=${peakCalls}`);

        trendAlertCooldown.set(clientName, now);

        const assignment = kamAccountList.find(a => a.clientName === clientName);
        const kam        = assignment ? kamById.get(assignment.kamId) : null;

        const dbAlert = await storage.createTrafficAlert({
          clientName, accountId: assignment?.accountId ?? null,
          kamId: kam?.id ?? null, alertType: 'traffic_decreasing',
          prevCalls: peakCalls, currCalls, emailSent: false,
        });

        // Build chart with trend line overlay (dashed yellow line)
        const svgChart = buildClientTrendSvg(clientName, window1h, true);
        const recipients: string[] = [];
        if (kam?.email) recipients.push(kam.email);
        if (settings.alertAdminEmail && !recipients.includes(settings.alertAdminEmail)) recipients.push(settings.alertAdminEmail);
        if (recipients.length === 0) continue;

        const emailPayload = buildTrafficAlertEmail({
          kamName: kam?.name ?? 'NOC Team', kamEmail: recipients[0],
          clientName, alertType: 'traffic_decreasing',
          prevCalls: peakCalls, currCalls, svgChart, productionUrl, slopePerMin: slope,
        });
        await sendTrafficAlertEmail(settings, recipients, emailPayload, dbAlert.id, 'trend-analyzer');
      }
    } catch (err: any) {
      console.warn('[trend-analyzer] Error:', err.message);
    }
  }

  // Run drop detector every 5 minutes, trend analyzer every 60 minutes
  setInterval(runTrafficDropDetector, 5 * 60 * 1000);
  setInterval(runHourlyTrendAnalyzer, 60 * 60 * 1000);
  // Also run trend analyzer once after 5 min (after initial history builds up)
  setTimeout(runHourlyTrendAnalyzer, 5 * 60 * 1000);

  // ── Sippy Watcher status + test endpoints ─────────────────────────────────
  app.get('/api/sippy-watcher/status', (req, res, next) => requireRole(['admin','management','viewer'], req, res, next), (req, res) => {
    res.json(getWatcherStatus());
  });

  app.post('/api/sippy-watcher/test-alert', (req, res, next) => requireRole(['admin','management'], req, res, next), async (req, res) => {
    const result = await sendTestWatcherAlert();
    res.json(result);
  });

  // ── Watcher Recipients CRUD ────────────────────────────────────────────────
  app.get('/api/watcher-recipients', (req, res, next) => requireRole(['admin','management'], req, res, next), async (_req, res) => {
    const list = await storage.getWatcherRecipients();
    res.json(list);
  });

  app.post('/api/watcher-recipients', (req, res, next) => requireRole(['admin'], req, res, next), async (req, res) => {
    const { email, displayName, userId, active } = req.body;
    if (!email || typeof email !== 'string') return res.status(400).json({ message: 'email required' });
    const row = await storage.addWatcherRecipient({ email: email.trim(), displayName: displayName || null, userId: userId || null, active: active !== false });
    res.json(row);
  });

  app.patch('/api/watcher-recipients/:id', (req, res, next) => requireRole(['admin'], req, res, next), async (req, res) => {
    const id = Number(req.params.id);
    const row = await storage.updateWatcherRecipient(id, req.body);
    if (!row) return res.status(404).json({ message: 'Not found' });
    res.json(row);
  });

  app.delete('/api/watcher-recipients/:id', (req, res, next) => requireRole(['admin'], req, res, next), async (req, res) => {
    await storage.deleteWatcherRecipient(Number(req.params.id));
    res.json({ ok: true });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // ── TIER 1 FEATURES ──────────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════════

  // ── IRSF Background Detection Worker ─────────────────────────────────────────
  async function runBackgroundIrsfAnalysis() {
    try {
      const settings = await storage.getSettings();
      if (!settings.portalUrl) return;
      const credPairs = sippyXmlCredsPairs(settings);
      if (!credPairs.length) return;
      const startDate = sippy.toSippyDate(new Date(Date.now() - 30 * 60 * 1000));
      const endDate   = sippy.toSippyDate(new Date());
      let cdrs: Awaited<ReturnType<typeof sippy.getSippyCDRs>> = [];
      for (const { username, password } of credPairs) {
        cdrs = await sippy.getSippyCDRs(username, password, 500, { startDate, endDate });
        if (cdrs.length > 0) break;
      }
      let saved = 0;
      for (const cdr of cdrs) {
        if (!cdr.callee || !cdr.callId) continue;
        const irsfResult = detectIrsf(String(cdr.callee));
        if (!irsfResult.isIrsf) continue;
        const resolvedClient = cdr.clientName || cdr.user
          || accountNameCache.get(String(cdr.accountId ?? cdr.iAccount ?? ''))
          || (cdr.accountId ? `Acct#${cdr.accountId}` : 'Unknown');
        const resolvedVendor = (() => {
          if (cdr.vendor) return cdr.vendor;
          if (cdr.iConnection) {
            const v = connectionVendorCache.get(String(cdr.iConnection));
            if (v && !/^\d+$/.test(v)) return v;
          }
          for (const val of connectionVendorCache.values()) {
            if (!/^\d+$/.test(val)) return val;
          }
          return '';
        })();
        try {
          await storage.createIrsfEvent({
            callId: String(cdr.callId),
            caller: cdr.caller ?? '',
            callee: cdr.callee ?? '',
            clientName: resolvedClient,
            vendor: resolvedVendor,
            riskPrefix: irsfResult.riskPrefix,
            country: irsfResult.country,
            breakout: irsfResult.breakout,
            fraudScore: irsfResult.fraudScore,
            blocked: false,
            alertSent: false,
          });
          saved++;
        } catch { /* duplicate — ignore */ }
      }
      if (saved > 0) console.log(`[irsf-bg] Saved ${saved} new IRSF events from ${cdrs.length} CDRs`);
    } catch (err: any) {
      console.error('[irsf-bg] Error:', err.message);
    }
  }
  setTimeout(() => {
    runBackgroundIrsfAnalysis();
    setInterval(runBackgroundIrsfAnalysis, 5 * 60 * 1000);
  }, 45000); // offset from FAS to spread DB load

  // ── IRSF Events API ───────────────────────────────────────────────────────────
  app.get('/api/irsf-events', (req, res, next) => requireRole(['admin','management','viewer'], req, res, next), async (_req, res) => {
    const events = await storage.getIrsfEvents(300);
    res.json(events);
  });

  // Manual IRSF scan trigger
  app.post('/api/irsf-events/scan', (req, res, next) => requireRole(['admin','management'], req, res, next), async (_req, res) => {
    runBackgroundIrsfAnalysis().catch(() => {});
    res.json({ ok: true, message: 'IRSF scan triggered' });
  });

  // ── Blacklist Rules CRUD ──────────────────────────────────────────────────────
  app.get('/api/blacklist-rules', (req, res, next) => requireRole(['admin','management','viewer'], req, res, next), async (_req, res) => {
    const rules = await storage.getBlacklistRules();
    res.json(rules);
  });

  app.post('/api/blacklist-rules', (req, res, next) => requireRole(['admin','management'], req, res, next), async (req, res) => {
    const { type, value, reason, source } = req.body;
    if (!type || !value) return res.status(400).json({ message: 'type and value are required' });
    if (!['caller','callee','prefix'].includes(type)) return res.status(400).json({ message: 'type must be caller | callee | prefix' });
    const rule = await storage.createBlacklistRule({ type, value: value.trim(), reason: reason || null, source: source || 'manual', active: true });
    res.json(rule);
  });

  app.patch('/api/blacklist-rules/:id', (req, res, next) => requireRole(['admin','management'], req, res, next), async (req, res) => {
    const id = Number(req.params.id);
    const row = await storage.updateBlacklistRule(id, req.body);
    if (!row) return res.status(404).json({ message: 'Not found' });
    res.json(row);
  });

  app.delete('/api/blacklist-rules/:id', (req, res, next) => requireRole(['admin'], req, res, next), async (req, res) => {
    await storage.deleteBlacklistRule(Number(req.params.id));
    res.json({ ok: true });
  });

  // ── MOS Trending ──────────────────────────────────────────────────────────────
  // Compute MOS hourly snapshots on-the-fly from the metrics table (DB query)
  app.get('/api/mos-trending', (req, res, next) => requireRole(['admin','management','viewer'], req, res, next), async (req, res) => {
    try {
      const hoursBack = Math.min(Number(req.query.hours) || 24, 168);
      const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
      const { db: dbConn } = await import('./db');
      const { metrics: metricsTable } = await import('@shared/schema');
      const { sql: sqlExpr, gte: gteOp } = await import('drizzle-orm');
      const rows = await dbConn.select({
        hour: sqlExpr<string>`date_trunc('hour', ${metricsTable.timestamp})`,
        avgMos: sqlExpr<number>`ROUND(AVG(${metricsTable.mos})::numeric, 3)`,
        minMos: sqlExpr<number>`ROUND(MIN(${metricsTable.mos})::numeric, 3)`,
        maxMos: sqlExpr<number>`ROUND(MAX(${metricsTable.mos})::numeric, 3)`,
        callCount: sqlExpr<number>`COUNT(DISTINCT ${metricsTable.callId})`,
      })
      .from(metricsTable)
      .where(gteOp(metricsTable.timestamp, since))
      .groupBy(sqlExpr`date_trunc('hour', ${metricsTable.timestamp})`)
      .orderBy(sqlExpr`date_trunc('hour', ${metricsTable.timestamp})`);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── SIP OPTIONS Probe ─────────────────────────────────────────────────────────
  // Per-host SIP OPTIONS keepalive results stored in-memory (refreshed every 60s)
  const sipOptionsCache: Map<number, {
    hostId: number; label: string; ip: string; port: number;
    status: 'up'|'down'|'timeout'|'unknown'; responseMs: number | null; checkedAt: Date;
  }> = new Map();

  async function probeSipOptions(ip: string, port = 5060): Promise<{ status: 'up'|'down'|'timeout'; responseMs: number }> {
    return new Promise((resolve) => {
      const start = Date.now();
      // Send a minimal SIP OPTIONS message over TCP
      const socket = net.createConnection({ host: ip, port }, () => {
        const callId = Math.random().toString(36).slice(2);
        const msg = [
          `OPTIONS sip:${ip} SIP/2.0`,
          `Via: SIP/2.0/TCP ${ip}:${port};branch=z9hG4bK${callId}`,
          `Max-Forwards: 70`,
          `From: <sip:noc@voipwatcher.local>;tag=${callId}`,
          `To: <sip:${ip}>`,
          `Call-ID: ${callId}@voipwatcher.local`,
          `CSeq: 1 OPTIONS`,
          `Content-Length: 0`,
          ``,
          ``,
        ].join('\r\n');
        socket.write(msg);
      });
      socket.setTimeout(4000);
      let responded = false;
      socket.on('data', (chunk) => {
        if (responded) return;
        responded = true;
        const responseMs = Date.now() - start;
        const text = chunk.toString();
        // Accept any SIP response (200 OK, 405 Not Allowed, 403, etc.) — all mean the server is alive
        const status: 'up'|'down' = /^SIP\/2\.0\s+\d+/.test(text) ? 'up' : 'down';
        socket.destroy();
        resolve({ status, responseMs });
      });
      socket.on('timeout', () => {
        if (responded) return;
        responded = true;
        socket.destroy();
        resolve({ status: 'timeout', responseMs: 4000 });
      });
      socket.on('error', () => {
        if (responded) return;
        responded = true;
        resolve({ status: 'down', responseMs: Date.now() - start });
      });
    });
  }

  async function runSipOptionsProbe() {
    try {
      const hosts = await storage.getMonitoredHosts();
      const enabled = hosts.filter(h => h.enabled);
      for (const host of enabled) {
        const port = 5060;
        const result = await probeSipOptions(host.ip, port);
        sipOptionsCache.set(host.id, {
          hostId: host.id, label: host.label, ip: host.ip, port,
          status: result.status as 'up'|'down'|'timeout'|'unknown',
          responseMs: result.responseMs,
          checkedAt: new Date(),
        });
      }
    } catch { /* ignore */ }
  }

  app.get('/api/monitoring/sip-options', (req, res, next) => requireRole(['admin','management','viewer'], req, res, next), (_req, res) => {
    res.json(Array.from(sipOptionsCache.values()));
  });

  // Start SIP OPTIONS probe 60s after startup, repeat every 60s
  setTimeout(() => {
    runSipOptionsProbe();
    setInterval(runSipOptionsProbe, 60 * 1000);
  }, 60000);

  // ── Rate Cards CRUD ───────────────────────────────────────────────────────────
  // ── LCR Analyser ─────────────────────────────────────────────────────────────
  // POST /api/lcr/analyse — find cheapest vendor route(s) for a given destination number
  app.post('/api/lcr/analyse', (req, res, next) => requireRole(['admin','management'], req, res, next), async (req: any, res: any) => {
    try {
      const { number, clientRateCardId } = req.body;
      if (!number || typeof number !== 'string') return res.status(400).json({ message: 'number is required' });
      const digits = number.replace(/^\+/, '').replace(/\D/g, '');
      if (digits.length < 3) return res.status(400).json({ message: 'number too short — enter at least a country code + area code' });

      const { vendorResults, clientEntry } = await storage.lcrAnalyse(digits, clientRateCardId ? Number(clientRateCardId) : undefined);

      const best  = vendorResults[0]?.entry.ratePerMin ?? null;
      const worst = vendorResults[vendorResults.length - 1]?.entry.ratePerMin ?? null;

      const ranked = vendorResults.map((r, idx) => ({
        rank:          idx + 1,
        rateCardId:    r.card.id,
        carrierName:   r.card.vendorName,
        rateCardName:  r.card.name,
        currency:      r.card.currency ?? 'USD',
        prefix:        r.entry.prefix,
        country:       r.entry.country ?? '',
        breakout:      r.entry.breakout ?? '',
        ratePerMin:    r.entry.ratePerMin,
        savingsVsBest: best !== null ? +(r.entry.ratePerMin - best).toFixed(6) : 0,
        pctMoreThanBest: best && best > 0 ? +((r.entry.ratePerMin - best) / best * 100).toFixed(2) : 0,
        margin:        clientEntry ? +(clientEntry.ratePerMin - r.entry.ratePerMin).toFixed(6) : null,
      }));

      res.json({
        number:       digits,
        routesFound:  ranked.length,
        bestRate:     best,
        worstRate:    worst,
        maxSaving:    best !== null && worst !== null ? +(worst - best).toFixed(6) : null,
        clientRate:   clientEntry ? {
          prefix:    clientEntry.prefix,
          country:   clientEntry.country,
          ratePerMin: clientEntry.ratePerMin,
        } : null,
        routes: ranked,
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── Call Flow Simulator ───────────────────────────────────────────────────────
  // POST /api/simulator/run — step-by-step trace of how a call would be handled
  app.post('/api/simulator/run', (req: any, res: any, next: any) => requireRole(['admin','management'], req, res, next), async (req: any, res: any) => {
    try {
      const { cli, cld, accountId } = req.body;
      if (!cld) return res.status(400).json({ message: 'cld is required' });

      type StepStatus = 'ok' | 'warn' | 'error' | 'skip' | 'info';
      interface SimStep {
        id: string; title: string; status: StepStatus;
        summary: string; detail: string;
        data?: Record<string, unknown>;
      }
      const steps: SimStep[] = [];

      // ── Step 1: Normalize ──────────────────────────────────────────────────
      const cliDigits = (cli  || '').replace(/^\+/, '').replace(/\D/g, '');
      const cldDigits = (cld  || '').replace(/^\+/, '').replace(/\D/g, '');
      const cldOk = cldDigits.length >= 3;
      const cliOk = !cliDigits || cliDigits.length >= 3;
      steps.push({
        id: 'normalize', title: 'Number Normalization',
        status: cldOk && cliOk ? 'ok' : 'error',
        summary: `CLI: +${cliDigits || '(none)'}  →  CLD: +${cldDigits}`,
        detail: cldOk
          ? `Numbers normalized to E.164. CLI ${cliDigits.length} digits, CLD ${cldDigits.length} digits.`
          : `CLD +${cldDigits} is too short — must be at least 3 digits. Call would be rejected at ingress.`,
        data: { cli: cliDigits, cld: cldDigits },
      });
      if (!cldOk) return res.json({ steps, outcome: 'invalid' });

      // ── Step 2: Account resolution ─────────────────────────────────────────
      let accountInfo: Record<string, unknown> | null = null;
      if (accountId) {
        try {
          const settings = await storage.getSettings();
          const { username, password } = sippyXmlCreds(settings);
          const info = await sippy.getAccountInfo(username, password, sippyPortalUrl(settings), parseInt(String(accountId), 10));
          if (info) {
            accountInfo = info as unknown as Record<string, unknown>;
            const blocked  = !!(info as any).blocked;
            const expired  = !!(info as any).expired;
            const st: StepStatus = blocked ? 'error' : expired ? 'warn' : 'ok';
            const uname  = (info as any).username ?? `#${accountId}`;
            const aname  = (info as any).name     ?? '';
            steps.push({
              id: 'account', title: 'Account Resolution', status: st,
              summary: blocked ? `BLOCKED — ${uname}` : expired ? `EXPIRED — ${uname}` : `${uname}${aname ? ' · ' + aname : ''}`,
              detail: blocked
                ? `Account ${uname} is blocked. Sippy rejects calls at ingress with 403 Forbidden.`
                : expired ? `Account ${uname} has expired. Calls may be rejected.`
                : `Account resolved. Max sessions: ${(info as any).maxSessions ?? 'unlimited'}. Tariff ID: ${(info as any).iTariff ?? 'none'}. Routing group: ${(info as any).iRoutingGroup ?? 'default'}.`,
              data: {
                username: (info as any).username,
                name: (info as any).name,
                maxSessions: (info as any).maxSessions,
                iTariff: (info as any).iTariff,
                iRoutingGroup: (info as any).iRoutingGroup,
                blocked, expired,
              },
            });
          } else throw new Error('Account not found');
        } catch (e: any) {
          steps.push({ id: 'account', title: 'Account Resolution', status: 'warn',
            summary: `Could not fetch account #${accountId}`,
            detail: `Sippy API error: ${e.message}. Continuing simulation without account context.`, data: {} });
        }
      } else {
        steps.push({ id: 'account', title: 'Account Resolution', status: 'skip',
          summary: 'No account selected',
          detail: 'Select a billing account to include tariff, balance, and routing group checks.', data: {} });
      }

      // ── Step 3: Balance & credit check ────────────────────────────────────
      if (accountInfo) {
        const balance      = (accountInfo as any).balance      ?? 0;
        const creditLimit  = (accountInfo as any).creditLimit  ?? 0;
        const available    = +(balance - creditLimit).toFixed(4);
        const hasFunds     = balance > creditLimit;
        steps.push({
          id: 'balance', title: 'Balance & Credit Check',
          status: hasFunds ? 'ok' : 'error',
          summary: hasFunds
            ? `Balance ${balance.toFixed(4)} · Available ${available} (limit ${creditLimit.toFixed(4)})`
            : `Insufficient funds — balance ${balance.toFixed(4)} ≤ limit ${creditLimit.toFixed(4)}`,
          detail: hasFunds
            ? `Account has sufficient funds. Sippy will allow call setup.`
            : `Call will be REJECTED. Balance (${balance.toFixed(4)}) does not exceed credit limit (${creditLimit.toFixed(4)}). The account needs to be topped up.`,
          data: { balance, creditLimit, available },
        });
      }

      // ── Step 4: Tariff / sell-rate lookup (local rate cards as proxy) ──────
      const allCards    = await storage.getRateCards();
      const clientCards = allCards.filter((c: any) => c.cardType === 'client');
      let clientRate: { card: unknown; entry: unknown } | null = null;
      for (const card of clientCards) {
        const entry = await storage.lookupRateForPrefix((card as any).id, cldDigits);
        if (entry) { clientRate = { card, entry }; break; }
      }
      const aTariffId = accountInfo ? (accountInfo as any).iTariff : null;
      if (clientCards.length === 0) {
        steps.push({ id: 'tariff', title: 'Tariff Rate Lookup', status: 'skip',
          summary: 'No client rate cards in system',
          detail: 'Import a client rate card (Rate Cards → Client Rate Cards) to enable tariff simulation.', data: {} });
      } else if (clientRate) {
        const e = clientRate.entry as any;
        const c = clientRate.card  as any;
        steps.push({
          id: 'tariff', title: 'Tariff Rate Lookup', status: 'ok',
          summary: `Sell rate: ${e.ratePerMin.toFixed(6)} ${c.currency ?? 'USD'}/min  ·  Prefix +${e.prefix}  ·  ${e.country ?? ''}`,
          detail: `${aTariffId ? `Tariff ID ${aTariffId} assigned. ` : ''}Local rate card "${c.name}" matched prefix +${e.prefix} (${e.country ?? 'unknown'}, ${e.breakout ?? 'general'}). Sell rate: ${e.ratePerMin} ${c.currency ?? 'USD'}/min.`,
          data: { tariffId: aTariffId, prefix: e.prefix, country: e.country, ratePerMin: e.ratePerMin, currency: c.currency, rateCardName: c.name },
        });
      } else {
        steps.push({ id: 'tariff', title: 'Tariff Rate Lookup', status: 'warn',
          summary: `No client rate covers +${cldDigits}`,
          detail: `${aTariffId ? `Account tariff ID ${aTariffId}. ` : ''}No local client rate card covers this destination. The destination may be forbidden or the rate card needs updating.`,
          data: { tariffId: aTariffId } });
      }

      // ── Step 5: Routing group ──────────────────────────────────────────────
      const iRG = accountInfo ? (accountInfo as any).iRoutingGroup : null;
      if (iRG) {
        try {
          const settings = await storage.getSettings();
          const { username, password } = sippyXmlCreds(settings);
          const groups = await sippy.listSippyRoutingGroups(username, password, sippyPortalUrl(settings));
          const rg = (groups as any[]).find((g: any) => g.iRoutingGroup === iRG);
          const mResult = await sippy.listRoutingGroupMembers(username, password, iRG, { portalUrl: sippyPortalUrl(settings) });
          const members = (mResult.members ?? []) as any[];
          const enriched = members.slice(0, 8).map((m: any) => ({
            preference:  m.preference,
            weight:      m.weight,
            iConnection: m.iConnection,
            vendor:      m.iConnection ? (connectionVendorCache.get(String(m.iConnection)) ?? `Connection #${m.iConnection}`) : null,
            iDestinationSet: m.iDestinationSet,
          }));
          steps.push({
            id: 'routing_group', title: 'Routing Group', status: 'ok',
            summary: `"${rg?.name ?? `Group #${iRG}`}" · policy: ${rg?.policy ?? 'unknown'} · ${members.length} member(s)`,
            detail: `Account assigned routing group "${rg?.name ?? iRG}" (ID ${iRG}). Routing policy: ${rg?.policy ?? 'unknown'}. ${members.length} carrier connection(s) listed.`,
            data: { groupId: iRG, groupName: rg?.name, policy: rg?.policy, membersCount: members.length, members: enriched },
          });
        } catch (e: any) {
          steps.push({ id: 'routing_group', title: 'Routing Group', status: 'warn',
            summary: `Routing group #${iRG} (details unavailable)`,
            detail: `Assigned routing group ID ${iRG} but details could not be fetched: ${e.message}.`,
            data: { groupId: iRG } });
        }
      } else {
        steps.push({ id: 'routing_group', title: 'Routing Group', status: 'info',
          summary: accountInfo ? 'No dedicated routing group — switch default' : 'Skipped (no account)',
          detail: accountInfo
            ? `Account has no dedicated routing group. Calls route via the switch's default policy.`
            : 'Select an account to see routing group assignment.',
          data: {} });
      }

      // ── Step 6: LCR vendor analysis ───────────────────────────────────────
      const { vendorResults } = await storage.lcrAnalyse(cldDigits);
      if (vendorResults.length > 0) {
        const best = vendorResults[0];
        const topRoutes = vendorResults.slice(0, 6).map((r: any, i: number) => ({
          rank: i + 1, carrier: r.card.vendorName, ratePerMin: r.entry.ratePerMin,
          prefix: r.entry.prefix, country: r.entry.country, currency: r.card.currency ?? 'USD',
        }));
        steps.push({
          id: 'lcr', title: 'LCR Vendor Selection', status: 'ok',
          summary: `Best: ${best.card.vendorName} — ${best.entry.ratePerMin.toFixed(6)} ${best.card.currency ?? 'USD'}/min  ·  ${vendorResults.length} route(s) found`,
          detail: `${vendorResults.length} vendor route(s) match +${cldDigits}. Least-cost: ${best.card.vendorName} at ${best.entry.ratePerMin.toFixed(6)} ${best.card.currency ?? 'USD'}/min (prefix +${best.entry.prefix}, ${best.entry.country ?? 'unknown'}).`,
          data: { routesFound: vendorResults.length, topRoutes },
        });
      } else {
        steps.push({ id: 'lcr', title: 'LCR Vendor Selection', status: 'error',
          summary: `No vendor routes for +${cldDigits}`,
          detail: `No vendor rate card covers +${cldDigits}. The call would fail with a "no route to destination" error. Import vendor rate cards under Rate Cards → Vendor Rate Cards.`,
          data: { routesFound: 0 } });
      }

      // ── Step 7: Predicted outcome ─────────────────────────────────────────
      const acctBlocked  = accountInfo ? !!(accountInfo as any).blocked : false;
      const noFunds      = accountInfo ? (accountInfo as any).balance <= (accountInfo as any).creditLimit : false;
      const noRoute      = vendorResults.length === 0;
      type Outcome = 'connected' | 'no_route' | 'blocked' | 'insufficient_balance';
      let outcome: Outcome;
      let outcomeDetail: string;

      if (acctBlocked) {
        outcome = 'blocked';
        outcomeDetail = `Account ${(accountInfo as any).username} is blocked. Sippy returns 403 Forbidden at ingress.`;
      } else if (noFunds) {
        const b = (accountInfo as any).balance, l = (accountInfo as any).creditLimit;
        outcome = 'insufficient_balance';
        outcomeDetail = `Balance (${b.toFixed(4)}) ≤ credit limit (${l.toFixed(4)}). Sippy blocks the call until the account is topped up.`;
      } else if (noRoute) {
        outcome = 'no_route';
        outcomeDetail = `No vendor rate card covers +${cldDigits}. Sippy returns 404 / 503 "no route to destination".`;
      } else {
        outcome = 'connected';
        const best = vendorResults[0];
        const margin = clientRate ? (clientRate.entry as any).ratePerMin - best.entry.ratePerMin : null;
        const marginPct = margin !== null && (clientRate!.entry as any).ratePerMin > 0
          ? (margin / (clientRate!.entry as any).ratePerMin * 100).toFixed(1) : null;
        outcomeDetail = `Call would route via ${best.card.vendorName} at ${best.entry.ratePerMin.toFixed(6)} ${best.card.currency ?? 'USD'}/min.`
          + (margin !== null ? ` Estimated margin: ${margin.toFixed(6)} ${(clientRate!.card as any).currency ?? 'USD'}/min (${margin >= 0 ? '+' : ''}${marginPct}%).` : '');
      }

      const bestVendor = vendorResults[0];
      steps.push({
        id: 'outcome', title: 'Predicted Outcome',
        status: outcome === 'connected' ? 'ok' : 'error',
        summary: outcome === 'connected' ? 'CALL WOULD CONNECT'
          : outcome === 'blocked'               ? 'CALL BLOCKED — Account blocked'
          : outcome === 'insufficient_balance'  ? 'CALL BLOCKED — Insufficient balance'
          : 'CALL FAILED — No route to destination',
        detail: outcomeDetail,
        data: {
          outcome,
          bestVendor: bestVendor?.card.vendorName,
          bestRate:   bestVendor?.entry.ratePerMin,
          clientRate: clientRate ? (clientRate.entry as any).ratePerMin : null,
          margin: clientRate && bestVendor ? (clientRate.entry as any).ratePerMin - bestVendor.entry.ratePerMin : null,
        },
      });

      res.json({ steps, outcome });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── Vendor SLA Scorecard ─────────────────────────────────────────────────────
  // GET /api/vendor-sla/scorecard?hours=24
  // Groups CDR cache by vendor, computes ASR/ACD/PDD/MOS/cost metrics and
  // grades each vendor A–F against SLA thresholds.
  app.get('/api/vendor-sla/scorecard', (req: any, res: any, next: any) => requireRole(['admin','management'], req, res, next), async (req: any, res: any) => {
    try {
      const hours = Math.min(72, Math.max(1, Number(req.query.hours) || 24));
      const cutoff = Date.now() - hours * 3600 * 1000;

      // Filter CDR cache to time window
      const cdrs = [...cdrCache.values()].filter(c => {
        const ts = c.startTime
          ? new Date(c.startTime).getTime()
          : c.connectTime ? new Date(c.connectTime).getTime() : 0;
        return ts >= cutoff;
      });

      // Group by vendor
      const groups = new Map<string, typeof cdrs>();
      for (const c of cdrs) {
        let vendorName = c.vendor || '';
        if (!vendorName && c.iConnection) vendorName = connectionVendorCache.get(c.iConnection) || '';
        if (!vendorName) continue;
        if (!groups.has(vendorName)) groups.set(vendorName, []);
        groups.get(vendorName)!.push(c);
      }

      // SLA grading helpers
      const gradeASR = (v: number) => v >= 65 ? 'A' : v >= 50 ? 'B' : v >= 35 ? 'C' : v >= 20 ? 'D' : 'F';
      const gradeACD = (v: number) => v >= 180 ? 'A' : v >= 60 ? 'B' : v >= 30 ? 'C' : v >= 10 ? 'D' : 'F';
      const gradePDD = (v: number) => v <= 1 ? 'A' : v <= 2 ? 'B' : v <= 4 ? 'C' : v <= 6 ? 'D' : 'F';
      const gradeMOS = (v: number) => v >= 4.0 ? 'A' : v >= 3.5 ? 'B' : v >= 3.0 ? 'C' : v >= 2.5 ? 'D' : 'F';
      const gp = (g: string) => g === 'A' ? 4 : g === 'B' ? 3 : g === 'C' ? 2 : g === 'D' ? 1 : 0;
      const pg = (p: number) => p >= 3.5 ? 'A' : p >= 2.5 ? 'B' : p >= 1.5 ? 'C' : p >= 0.5 ? 'D' : 'F';
      const estimateMOS = (pddSec: number) => Math.max(1.0, Math.min(4.5, 4.5 - pddSec * 0.5));

      const rows = [];
      for (const [vendor, calls] of groups) {
        const totalCalls   = calls.length;
        const answered     = calls.filter(c => String(c.result) === '0' && (Number(c.duration) || 0) > 0);
        const asr          = parseFloat((answered.length / totalCalls * 100).toFixed(2));
        const totalDurSec  = answered.reduce((s, c) => s + (Number(c.duration) || 0), 0);
        const acdSec       = answered.length > 0 ? parseFloat((totalDurSec / answered.length).toFixed(1)) : 0;
        const pddArr       = answered.map(c => Number(c.pdd1xx ?? c.pdd) || 0).filter(v => v > 0);
        const avgPddSec    = pddArr.length > 0 ? parseFloat((pddArr.reduce((a, b) => a + b, 0) / pddArr.length).toFixed(3)) : 0;
        const mos          = avgPddSec > 0 ? parseFloat(estimateMOS(avgPddSec).toFixed(2)) : null;
        const totalMinutes = parseFloat((totalDurSec / 60).toFixed(2));
        const totalCost    = parseFloat(calls.reduce((s, c) => s + (Number(c.cost) || 0), 0).toFixed(4));
        const costPerMin   = totalMinutes > 0 ? parseFloat((totalCost / totalMinutes).toFixed(6)) : 0;

        const asrGrade     = gradeASR(asr);
        const acdGrade     = acdSec > 0 ? gradeACD(acdSec) : 'N/A';
        const pddGrade     = avgPddSec > 0 ? gradePDD(avgPddSec) : 'N/A';
        const mosGrade     = mos !== null ? gradeMOS(mos) : 'N/A';

        // Weighted overall: ASR×2 + ACD + PDD + MOS (ASR is most critical)
        const gradedMetrics = [asrGrade, acdGrade, pddGrade, mosGrade].filter(g => g !== 'N/A');
        const points = gradedMetrics.length > 0
          ? (gp(asrGrade) * 2 + (acdGrade !== 'N/A' ? gp(acdGrade) : 2) + (pddGrade !== 'N/A' ? gp(pddGrade) : 2) + (mosGrade !== 'N/A' ? gp(mosGrade) : 2)) / 5
          : 0;
        const overallGrade = pg(points);

        // Top 5 countries by call count
        const ctyMap = new Map<string, number>();
        for (const c of calls) { const k = c.country || 'Unknown'; ctyMap.set(k, (ctyMap.get(k) || 0) + 1); }
        const topCountries = [...ctyMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
          .map(([country, count]) => ({ country, count }));

        rows.push({ vendor, totalCalls, answeredCalls: answered.length, asr, acdSec, avgPddSec, mos, totalMinutes, totalCost, costPerMin, asrGrade, acdGrade, pddGrade, mosGrade, overallGrade, topCountries });
      }

      rows.sort((a, b) => b.totalCalls - a.totalCalls);
      res.json({ rows, total: rows.length, hours, cdrCacheSize: cdrCache.size, updatedAt: cdrCacheUpdatedAt });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get('/api/rate-cards', (req, res, next) => requireRole(['admin','management','viewer'], req, res, next), async (_req, res) => {
    const cards = await storage.getRateCards();
    res.json(cards);
  });

  app.post('/api/rate-cards', (req, res, next) => requireRole(['admin','management'], req, res, next), async (req, res) => {
    const { vendorName, name, currency, effectiveDate, cardType } = req.body;
    if (!vendorName || !name) return res.status(400).json({ message: 'vendorName and name required' });
    const card = await storage.createRateCard({
      vendorName: vendorName.trim(),
      name: name.trim(),
      currency: currency || 'USD',
      effectiveDate: effectiveDate ? new Date(effectiveDate) : null,
      cardType: cardType === 'client' ? 'client' : 'vendor',
    });
    res.json(card);
    regenDataflowDoc();
  });

  app.delete('/api/rate-cards/:id', (req, res, next) => requireRole(['admin'], req, res, next), async (req, res) => {
    await storage.deleteRateCard(Number(req.params.id));
    res.json({ ok: true });
    regenDataflowDoc();
  });

  // GET /api/sippy/rate-card-context — enriched reference data for the Rate Cards UI
  // Returns: clients (with their Sippy tariff assignments) + destination sets (for vendor rate cards)
  app.get('/api/sippy/rate-card-context', (req, res, next) => requireRole(['admin', 'management'], req, res, next), async (_req, res) => {
    try {
      const settings = await storage.getSippySettings();
      if (!settings) return res.json({ clients: [], destSets: [], vendors: [] });
      const portalUrl = sippyPortalUrl(settings);

      // Discover the working credential pair (tries ssp-root then RTST1)
      const pairs = sippyXmlCredsPairs(settings);
      let username = pairs[0].username;
      let password = pairs[0].password;
      for (const pair of pairs) {
        try {
          await sippy.getTariffsList(pair.username, pair.password, undefined, undefined, 1);
          username = pair.username;
          password = pair.password;
          break;
        } catch { /* try next pair */ }
      }

      // Fetch all in parallel using the working credentials
      const [custResult, tariffResult, destResult, vendorResult] = await Promise.all([
        sippy.listSippyCustomers(username, password, { portalUrl }),
        sippy.listSippyTariffs(username, password, portalUrl),
        sippy.listDestinationSets(username, password, { portalUrl }),
        sippy.listSippyVendors(username, password, {}, portalUrl),
      ]);

      // Build tariff map: id → name + currency
      const tariffMap = new Map<number, { name: string; currency: string }>();
      for (const t of (tariffResult.tariffs ?? [])) {
        tariffMap.set(t.id, { name: t.name, currency: t.currency ?? '' });
      }

      // For each customer fetch their tariff assignment (i_tariff in getCustomerInfo)
      // Run in parallel but cap at 10 concurrent requests
      const customerList = custResult.customers ?? [];
      const customerInfos = await Promise.all(
        customerList.map(c =>
          sippy.getSippyCustomerInfo(username, password, { iCustomer: c.iCustomer }, { portalUrl })
            .then(r => r.customer ?? null)
            .catch(() => null)
        )
      );

      const clients = customerList.map((c, i) => {
        const info = customerInfos[i];
        const iTariff = info?.iTariff ?? null;
        const tariff = iTariff ? tariffMap.get(iTariff) : undefined;
        return {
          iCustomer: c.iCustomer,
          name: c.name,
          baseCurrency: c.baseCurrency,
          iTariff,
          tariffName: tariff?.name ?? null,
          tariffCurrency: tariff?.currency ?? null,
        };
      });

      const destSets = (destResult.list ?? []).map(d => ({
        iDestinationSet: d.iDestinationSet,
        name: d.name,
        currency: d.iso4217,
      }));

      const vendors = (vendorResult.vendors ?? []).map(v => ({
        iVendor: v.iVendor,
        name: v.name,
        baseCurrency: v.baseCurrency ?? null,
      }));

      res.json({ clients, destSets, vendors });
    } catch (e: any) {
      console.error('[rate-card-context]', e.message);
      res.json({ clients: [], destSets: [], vendors: [] });
    }
  });

  app.get('/api/rate-cards/:id/entries', (req, res, next) => requireRole(['admin','management','viewer'], req, res, next), async (req, res) => {
    const entries = await storage.getRateCardEntries(Number(req.params.id));
    res.json(entries);
  });

  // CSV upload for rate card entries
  // Accepts multipart/form-data with field "csv" OR raw text/plain body
  // Expected CSV columns (flexible header detection): prefix, country, breakout, rate
  app.post('/api/rate-cards/:id/upload', (req, res, next) => requireRole(['admin','management'], req, res, next), async (req, res) => {
    try {
      const rateCardId = Number(req.params.id);
      const contentType = (req.headers['content-type'] || '').toLowerCase();
      const isExcel = contentType.includes('spreadsheet') || contentType.includes('excel') || contentType.includes('octet-stream');

      // ── Read raw body as buffer ────────────────────────────────────────────
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        req.on('data', (chunk: Buffer) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        req.on('end', resolve);
        req.on('error', reject);
      });
      const rawBuffer = Buffer.concat(chunks);
      if (!rawBuffer.length) return res.status(400).json({ message: 'Empty file' });

      // ── Parse rows into [header[], ...dataRows[]] ─────────────────────────
      let rows: string[][] = [];

      if (isExcel) {
        // Parse Excel with xlsx library
        const XLSX = await import('xlsx');
        const wb = XLSX.read(rawBuffer, { type: 'buffer' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const jsonRows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        rows = jsonRows.map(r => r.map((c: any) => String(c ?? '').trim()));
      } else {
        // Parse CSV as text
        const csvText = rawBuffer.toString('utf-8');
        rows = csvText.split(/\r?\n/).map(l => l.split(',').map(c => c.replace(/"/g, '').trim())).filter(r => r.some(c => c));
      }

      if (rows.length < 2) return res.status(400).json({ message: 'File must have header + at least 1 data row' });

      // ── Detect column positions from header row ────────────────────────────
      const header = rows[0].map(h => h.toLowerCase());
      const prefixIdx   = header.findIndex(h => h.includes('prefix') || h === 'code' || h === 'dial_code');
      const countryIdx  = header.findIndex(h => h.includes('country') || h.includes('destination') || h === 'name');
      const breakoutIdx = header.findIndex(h => h.includes('breakout') || h.includes('description') || h.includes('desc'));
      const rateIdx     = header.findIndex(h => h.includes('rate') || h.includes('price') || h.includes('cost') || h === 'sell_rate');
      if (prefixIdx === -1 || rateIdx === -1) {
        return res.status(400).json({ message: 'File must have prefix (or code) and rate columns' });
      }

      // ── Build entries ─────────────────────────────────────────────────────
      const entries: Array<{ rateCardId: number; prefix: string; country: string | null; breakout: string | null; ratePerMin: number }> = [];
      for (let i = 1; i < rows.length; i++) {
        const cols = rows[i];
        const prefix = (cols[prefixIdx] ?? '').replace(/\D/g, '').slice(0, 20);
        const rateStr = (cols[rateIdx] ?? '').replace(/[^0-9.]/g, '');
        const ratePerMin = parseFloat(rateStr);
        if (!prefix || isNaN(ratePerMin)) continue;
        const rawCountry  = countryIdx  >= 0 ? (cols[countryIdx]  || null) : null;
        const rawBreakout = breakoutIdx >= 0 ? (cols[breakoutIdx] || null) : null;
        entries.push({
          rateCardId,
          prefix,
          country:  rawCountry  ? rawCountry.slice(0, 255)  : null,
          breakout: rawBreakout ? rawBreakout.slice(0, 255) : null,
          ratePerMin,
        });
      }
      if (!entries.length) return res.status(400).json({ message: 'No valid rows parsed from file' });

      // ── Persist ───────────────────────────────────────────────────────────
      const { db: dbConn } = await import('./db');
      const { rateCardEntries: rceTable } = await import('@shared/schema');
      const { eq: eqOp } = await import('drizzle-orm');
      await dbConn.delete(rceTable).where(eqOp(rceTable.rateCardId, rateCardId));
      const inserted = await storage.bulkInsertRateCardEntries(entries);
      await storage.updateRateCardEntryCount(rateCardId, inserted);
      res.json({ ok: true, inserted });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/rate-cards/:id/export — download rate card entries as CSV
  app.get('/api/rate-cards/:id/export', (req, res, next) => requireRole(['admin','management','viewer'], req, res, next), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const cards = await storage.getRateCards();
      const card = cards.find(c => c.id === id);
      const entries = await storage.getRateCardEntries(id);
      const filename = card ? `${card.vendorName}_${card.name}.csv`.replace(/[^a-zA-Z0-9_.-]/g, '_') : `rate_card_${id}.csv`;
      const header = 'prefix,country,breakout,rate\r\n';
      const rows = entries.map(e => `${e.prefix},${(e.country ?? '').replace(/,/g, ' ')},${(e.breakout ?? '').replace(/,/g, ' ')},${e.ratePerMin}`).join('\r\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(header + rows);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // GET /api/rate-cards/push-jobs/:jobId — poll bulk-push progress
  app.get('/api/rate-cards/push-jobs/:jobId', (req, res, next) => requireRole(['admin','management'], req, res, next), (req, res) => {
    const job = pushJobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ message: 'Job not found' });
    res.json(job);
  });

  // POST /api/rate-cards/:id/push-to-sippy — bulk-push all entries to a Sippy tariff
  app.post('/api/rate-cards/:id/push-to-sippy', (req, res, next) => requireRole(['admin','management'], req, res, next), async (req, res) => {
    try {
      const rateCardId = Number(req.params.id);
      const { tariffId, switchId, effectiveFrom, effectiveTill } = req.body as {
        tariffId: string; switchId?: number; effectiveFrom?: string; effectiveTill?: string;
      };
      if (!tariffId) return res.status(400).json({ message: 'tariffId is required' });

      const entries = await storage.getRateCardEntries(rateCardId);
      if (!entries.length) return res.status(400).json({ message: 'Rate card has no entries to push' });

      const settings = await storage.getSettings();
      // Discover working credential pair (ssp-root may have wrong password; RTST1 is the fallback)
      const pairs = sippyXmlCredsPairs(settings);
      let u = pairs[0].username;
      let p = pairs[0].password;
      for (const pair of pairs) {
        try {
          await sippy.getTariffsList(pair.username, pair.password, undefined, undefined, 1);
          u = pair.username; p = pair.password; break;
        } catch { /* try next */ }
      }
      let portalUrl = sippyPortalUrl(settings);
      if (switchId) {
        const sw = (await storage.getSwitches()).find(s => s.id === Number(switchId) && s.type === 'sippy');
        if (sw) { portalUrl = sw.portalUrl ?? portalUrl; const swCreds = sippyXmlCreds(settings, sw); u = swCreds.username; p = swCreds.password; }
      }

      // Start background job
      const jobId = randomBytes(8).toString('hex');
      const job: PushJob = { status: 'running', pushed: 0, failed: 0, total: entries.length, startedAt: new Date().toISOString() };
      pushJobs.set(jobId, job);
      res.json({ jobId, total: entries.length });

      // Run push in background with concurrency=15
      (async () => {
        const CONCURRENCY = 15;
        let i = 0;
        async function worker() {
          while (i < entries.length) {
            const entry = entries[i++];
            try {
              const result = await sippy.setSippyRateEntry(u, p, tariffId, {
                prefix: entry.prefix,
                rate: entry.ratePerMin,
                effectiveFrom,
                effectiveTill,
              }, portalUrl);
              if (result.success) job.pushed++; else job.failed++;
            } catch { job.failed++; }
          }
        }
        await Promise.all(Array.from({ length: CONCURRENCY }, worker));
        job.status = job.failed === 0 ? 'done' : (job.pushed === 0 ? 'error' : 'done');
        job.message = `Pushed ${job.pushed} rates${job.failed ? `, ${job.failed} failed` : ''}`;
        // Expire job after 10 min
        setTimeout(() => pushJobs.delete(jobId), 10 * 60 * 1000);
      })().catch(err => { job.status = 'error'; job.message = err.message; });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // GET /api/rate-cards/:id/verify-sippy?tariffId=xxx — compare local entries vs Sippy tariff
  app.get('/api/rate-cards/:id/verify-sippy', (req, res, next) => requireRole(['admin','management'], req, res, next), async (req, res) => {
    try {
      const rateCardId = Number(req.params.id);
      const tariffId = req.query.tariffId as string;
      if (!tariffId) return res.status(400).json({ message: 'tariffId is required' });

      const settings = await storage.getSettings();
      const localEntries = await storage.getRateCardEntries(rateCardId);

      // Fetch up to 1000 rates from Sippy tariff — retry with fallback credentials on 401
      const sippyResult = await withSippyCredsRaw(
        settings,
        (u, p) => sippy.getTariffRatesListFull(u, p, Number(tariffId), undefined, 0, 1000),
        [],
      );
      const sippyRates: any[] = (sippyResult as any)?.rates ?? sippyResult ?? [];
      const sippyMap = new Map<string, number>();
      for (const r of sippyRates) {
        const pfx = String(r.prefix ?? r.destination ?? '').replace(/\D/g, '');
        if (pfx) sippyMap.set(pfx, Number(r.price_1 ?? r.rate ?? 0));
      }

      const localMap = new Map(localEntries.map(e => [e.prefix, e.ratePerMin]));
      let matched = 0, mismatched = 0, localOnly = 0, sippyOnly = 0;
      const sample: { prefix: string; local: number | null; sippy: number | null; match: boolean }[] = [];

      for (const [pfx, localRate] of localMap) {
        if (sippyMap.has(pfx)) {
          const sippyRate = sippyMap.get(pfx)!;
          const ok = Math.abs(localRate - sippyRate) < 0.00005;
          if (ok) matched++; else mismatched++;
          if (sample.length < 20 && !ok) sample.push({ prefix: pfx, local: localRate, sippy: sippyRate, match: false });
        } else { localOnly++; }
      }
      for (const pfx of sippyMap.keys()) {
        if (!localMap.has(pfx)) sippyOnly++;
      }

      res.json({
        localTotal: localEntries.length,
        sippyFetched: sippyRates.length,
        matched, mismatched, localOnly, sippyOnly,
        mismatchSample: sample,
      });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ── Revenue & Margin Analytics ─────────────────────────────────────────────────
  app.get('/api/analytics/revenue', (req, res, next) => requireRole(['admin','management'], req, res, next), async (req, res) => {
    try {
      const days     = Math.min(Number(req.query.days) || 30, 90);
      const toDate   = new Date();
      const fromDate = new Date(toDate.getTime() - days * 24 * 60 * 60 * 1000);

      const settings   = await storage.getSettings();
      const portalBase = sippyPortalUrl(settings);

      // Credential priority: env var → apiAdmin → portal login
      const portalUser = settings.apiAdminUsername || settings.portalUsername || '';
      const portalPass = settings.apiAdminPassword || settings.portalPassword || '';
      const adminUser  = process.env.SIPPY_ADMIN_USERNAME || settings.portalUsername || '';
      const adminPass  = process.env.SIPPY_ADMIN_PASSWORD || settings.portalPassword || '';

      // ── Strategy 1: Try portal ASR/ACD stats (admin/reseller session) ────────
      let statsResult = await sippy.getSippyPerAccountStats(
        portalUser, portalPass,
        days * 24 * 60,
        adminUser, adminPass,
        fromDate, toDate,
      );

      // ── Strategy 2: If asr_acd returned no data, fall back to CDR aggregation ─
      // scrapePortalCDRs uses /cdrs_customer.php — works with any customer session
      const hasData = statsResult.ok && (statsResult.origTotal.amount > 0 || statsResult.origTotal.totalCalls > 0);

      if (!hasData) {
        console.log('[analytics] asr_acd returned no data — falling back to CDR aggregation');
        // Format date for the portal CDR filter (MM/DD/YYYY HH:MM:SS)
        const fmtPortalDate = (d: Date) => {
          const pad = (n: number) => String(n).padStart(2, '0');
          return `${pad(d.getMonth()+1)}/${pad(d.getDate())}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        };

        const cdrs = await sippy.scrapePortalCDRs(
          portalUser, portalPass,
          portalBase,
          {
            limit: 1000,
            startDate: fmtPortalDate(fromDate),
            endDate:   fmtPortalDate(toDate),
            callsSelect: '4',   // non-zero billed calls only
            fallbackUsername: adminUser,
            fallbackPassword: adminPass,
          },
        );

        if (cdrs.length > 0) {
          // Aggregate CDRs by clientName → revenue
          const clientMap = new Map<string, { calls: number; secs: number; revenue: number }>();
          for (const c of cdrs) {
            const name = (c.clientName || 'Unknown').trim();
            const ex   = clientMap.get(name) ?? { calls: 0, secs: 0, revenue: 0 };
            clientMap.set(name, {
              calls:   ex.calls   + 1,
              secs:    ex.secs    + (c.duration || 0),
              revenue: ex.revenue + (c.cost     || 0),
            });
          }
          const totalRevFromCDR = [...clientMap.values()].reduce((s, v) => s + v.revenue, 0);

          // Vendor cost from latest balance snapshot (running total Sippy tracks per vendor)
          const latestSnap = vendorBalanceHistory.length > 0
            ? vendorBalanceHistory[vendorBalanceHistory.length - 1] : null;
          const totalVendorCost = latestSnap
            ? latestSnap.vendors.reduce((s, v) => s + (v.balance || 0), 0)
            : 0;

          const byClientCDR = [...clientMap.entries()]
            .map(([name, d]) => {
              const revenue   = parseFloat(d.revenue.toFixed(4));
              const costShare = totalRevFromCDR > 0 ? d.revenue / totalRevFromCDR : 0;
              const cost      = parseFloat((costShare * totalVendorCost).toFixed(4));
              const profit    = parseFloat((revenue - cost).toFixed(4));
              const margin    = revenue > 0 ? parseFloat(((profit / revenue) * 100).toFixed(2)) : 0;
              return { name, calls: d.calls, minutes: Math.round(d.secs / 60), revenue, cost, profit, margin };
            })
            .sort((a, b) => b.revenue - a.revenue);

          const byVendorCDR = latestSnap
            ? latestSnap.vendors
                .filter(v => (v.balance || 0) > 0)
                .map(v => ({ name: v.name, calls: 0, minutes: 0, cost: parseFloat((v.balance || 0).toFixed(4)) }))
            : [];

          const totalCost   = parseFloat(totalVendorCost.toFixed(4));
          const totalProfit = parseFloat((totalRevFromCDR - totalVendorCost).toFixed(4));
          const totalMargin = totalRevFromCDR > 0 ? parseFloat(((totalRevFromCDR - totalVendorCost) / totalRevFromCDR * 100).toFixed(2)) : 0;

          return res.json({
            period: { days, since: fromDate.toISOString() },
            summary: {
              totalRevenue: parseFloat(totalRevFromCDR.toFixed(4)),
              totalCost,
              totalProfit,
              margin: totalMargin,
            },
            byClient: byClientCDR,
            byVendor: byVendorCDR,
            vendorDataLimited: totalVendorCost === 0,
            _source: 'cdr-aggregation',
          });
        }
        // If CDR scraping also returned nothing, fall through with empty data
      }

      if (!statsResult.ok) {
        return res.status(502).json({ message: statsResult.error ?? 'Failed to fetch Sippy stats.' });
      }

      // ── Build response from asr_acd stats ────────────────────────────────────
      const vendorDataLimited = statsResult.vendorDataLimited ?? false;
      const totalRevenue      = statsResult.origTotal.amount;
      const totalVendorCost   = statsResult.termTotal.amount;

      const byClient = statsResult.clients
        .filter(r => r.amount > 0 || r.totalCalls > 0)
        .map(r => {
          const revenue   = parseFloat(r.amount.toFixed(4));
          const costShare = totalRevenue > 0 ? r.amount / totalRevenue : 0;
          const cost      = parseFloat((costShare * totalVendorCost).toFixed(4));
          const profit    = parseFloat((revenue - cost).toFixed(4));
          const margin    = revenue > 0 ? parseFloat(((profit / revenue) * 100).toFixed(2)) : 0;
          return { name: r.name, calls: r.totalCalls, minutes: Math.round(r.durationSec / 60), revenue, cost, profit, margin };
        })
        .sort((a, b) => b.revenue - a.revenue);

      const byVendor = statsResult.vendors
        .filter(r => r.amount > 0 || r.totalCalls > 0)
        .map(r => ({ name: r.name, calls: r.totalCalls, minutes: Math.round(r.durationSec / 60), cost: parseFloat(r.amount.toFixed(4)) }))
        .sort((a, b) => b.cost - a.cost);

      const totalCost   = parseFloat(totalVendorCost.toFixed(4));
      const totalProfit = parseFloat((totalRevenue - totalVendorCost).toFixed(4));
      const totalMargin = totalRevenue > 0 ? parseFloat(((totalRevenue - totalVendorCost) / totalRevenue * 100).toFixed(2)) : 0;

      res.json({
        period: { days, since: fromDate.toISOString() },
        summary: {
          totalRevenue: parseFloat(totalRevenue.toFixed(4)),
          totalCost,
          totalProfit,
          margin: totalMargin,
        },
        byClient,
        byVendor,
        vendorDataLimited,
        _source: 'sippy-portal-stats',
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/analytics/margin — Full Revenue & Margin Analytics Dashboard
  // Query: days (1-90), vendorCardId? (rate card ID for per-route cost), threshold (default 10%)
  app.get('/api/analytics/margin', (req, res, next) => requireRole(['admin','management'], req, res, next), async (req: any, res) => {
    try {
      const days = Math.min(Number(req.query.days) || 30, 90);
      const vendorCardId = req.query.vendorCardId ? Number(req.query.vendorCardId) : null;
      const marginThreshold = Number(req.query.threshold) || 10;
      const toDate = new Date();
      const fromDate = new Date(toDate.getTime() - days * 24 * 60 * 60 * 1000);
      const settings = await storage.getSettings();
      const portalBase = sippyPortalUrl(settings);
      const creds = sippyXmlCredsPairs(settings);
      const { username = '', password = '' } = creds[0] ?? {};

      const allCards = await storage.getRateCards();

      // Load vendor rate card entries sorted by prefix length (longest first for matching)
      let vendorEntries: Array<{ prefix: string; ratePerMin: number }> = [];
      if (vendorCardId) {
        const entries = await storage.getRateCardEntries(vendorCardId);
        vendorEntries = entries
          .map(e => ({ prefix: e.prefix, ratePerMin: e.ratePerMin }))
          .sort((a, b) => b.prefix.length - a.prefix.length);
      }

      function matchVendorRate(cld: string): number | null {
        if (!vendorEntries.length) return null;
        const digits = cld.replace(/\D/g, '');
        for (const e of vendorEntries) { if (digits.startsWith(e.prefix)) return e.ratePerMin; }
        return null;
      }

      let cdrs: Awaited<ReturnType<typeof sippy.getSippyCDRs>> = [];
      const startDate = sippy.toSippyDate(fromDate);
      const endDate   = sippy.toSippyDate(toDate);
      if (username && password) {
        try { cdrs = await sippy.getSippyCDRs(username, password, 2000, { startDate, endDate }); } catch { /* ignore */ }
      }
      if (!cdrs.length) {
        const pUser = settings.portalUsername || '';
        const pPass = settings.portalPassword || '';
        if (pUser && pPass) {
          try {
            const pad = (n: number) => String(n).padStart(2, '0');
            const fmt = (d: Date) => `${pad(d.getMonth()+1)}/${pad(d.getDate())}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
            cdrs = await sippy.scrapePortalCDRs(pUser, pPass, portalBase, { limit: 2000, startDate: fmt(fromDate), endDate: fmt(toDate), callsSelect: '4' });
          } catch { /* ignore */ }
        }
      }

      if (!cdrs.length) {
        return res.json({
          period: { days, since: fromDate.toISOString() },
          summary: { totalRevenue: 0, totalCost: 0, totalProfit: 0, margin: 0, totalCalls: 0, totalMinutes: 0 },
          daily: [], byClient: [], byDestination: [], worstRoutes: [],
          rateCards: allCards, selectedVendorCardId: vendorCardId, vendorDataLimited: true, _source: 'no-data',
        });
      }

      const enriched = cdrs.map(c => ({
        ...c,
        clientName: c.clientName || accountNameCache.get(String(c.iAccount ?? '')) || (c.iAccount ? `Acct.${c.iAccount}` : 'Unknown'),
      }));

      const totalRevenue = enriched.reduce((s, c) => s + (c.cost || 0), 0);
      const latestSnap = vendorBalanceHistory.length > 0 ? vendorBalanceHistory[vendorBalanceHistory.length - 1] : null;
      const totalVendorBalance = latestSnap ? latestSnap.vendors.reduce((s, v) => s + (v.balance || 0), 0) : 0;
      const useRateCard = !!vendorCardId && vendorEntries.length > 0;
      const costRatio = (!useRateCard && totalRevenue > 0) ? totalVendorBalance / totalRevenue : 0;

      const cdrCost = (c: typeof enriched[0]): number => {
        if (useRateCard) {
          const rate = matchVendorRate(c.callee || '');
          if (rate !== null) return rate * ((c.duration || 0) / 60);
        }
        return (c.cost || 0) * costRatio;
      };

      // Daily P&L (all days in period)
      const dailyMap = new Map<string, { revenue: number; cost: number; calls: number }>();
      for (let d = 0; d < days; d++) {
        const dt = new Date(toDate.getTime() - (days - 1 - d) * 86400000);
        dailyMap.set(dt.toISOString().slice(0, 10), { revenue: 0, cost: 0, calls: 0 });
      }
      for (const c of enriched) {
        const key = (c.startTime || c.connectTime || '').slice(0, 10);
        if (!dailyMap.has(key)) continue;
        const ex = dailyMap.get(key)!;
        ex.revenue += (c.cost || 0); ex.cost += cdrCost(c); ex.calls++;
      }
      const daily = [...dailyMap.entries()].map(([date, v]) => ({
        date,
        revenue: +v.revenue.toFixed(4),
        cost: +v.cost.toFixed(4),
        profit: +(v.revenue - v.cost).toFixed(4),
        calls: v.calls,
      }));

      // By client
      const clientMap = new Map<string, { calls: number; mins: number; revenue: number; cost: number }>();
      for (const c of enriched) {
        const ex = clientMap.get(c.clientName) ?? { calls: 0, mins: 0, revenue: 0, cost: 0 };
        ex.calls++; ex.mins += (c.duration || 0) / 60; ex.revenue += (c.cost || 0); ex.cost += cdrCost(c);
        clientMap.set(c.clientName, ex);
      }
      const byClient = [...clientMap.entries()].map(([name, v]) => {
        const revenue = +v.revenue.toFixed(4); const cost = +v.cost.toFixed(4);
        const profit = +(revenue - cost).toFixed(4);
        const margin = revenue > 0 ? +((profit / revenue) * 100).toFixed(2) : 0;
        return { name, calls: v.calls, minutes: Math.round(v.mins), revenue, cost, profit, margin };
      }).sort((a, b) => b.revenue - a.revenue);

      // By destination (country + breakout)
      type DestAcc = { country: string; breakout: string; calls: number; mins: number; revenue: number; cost: number; vendorRate: number | null };
      const destMap = new Map<string, DestAcc>();
      for (const c of enriched) {
        const country  = c.country || 'Unknown';
        const breakout = c.description || c.areaName || '';
        const key = `${country}||${breakout}`;
        const ex: DestAcc = destMap.get(key) ?? { country, breakout, calls: 0, mins: 0, revenue: 0, cost: 0, vendorRate: null };
        const rate = useRateCard ? matchVendorRate(c.callee || '') : null;
        ex.calls++; ex.mins += (c.duration || 0) / 60; ex.revenue += (c.cost || 0); ex.cost += cdrCost(c);
        if (rate !== null && ex.vendorRate === null) ex.vendorRate = rate;
        destMap.set(key, ex);
      }
      const byDestination = [...destMap.values()].map(v => {
        const revenue = +v.revenue.toFixed(4); const cost = +v.cost.toFixed(4);
        const profit = +(revenue - cost).toFixed(4);
        const margin = revenue > 0 ? +((profit / revenue) * 100).toFixed(2) : 0;
        return { country: v.country, breakout: v.breakout, calls: v.calls, minutes: Math.round(v.mins), revenue, cost, profit, margin, vendorRate: v.vendorRate };
      }).sort((a, b) => b.revenue - a.revenue);
      const worstRoutes = [...byDestination].filter(d => d.margin < marginThreshold).sort((a, b) => a.margin - b.margin);

      const totalCostComputed = enriched.reduce((s, c) => s + cdrCost(c), 0);
      const totalMinutes = enriched.reduce((s, c) => s + (c.duration || 0) / 60, 0);
      const totalProfit = totalRevenue - totalCostComputed;

      res.json({
        period: { days, since: fromDate.toISOString() },
        summary: {
          totalRevenue: +totalRevenue.toFixed(4),
          totalCost: +totalCostComputed.toFixed(4),
          totalProfit: +totalProfit.toFixed(4),
          margin: totalRevenue > 0 ? +((totalProfit / totalRevenue) * 100).toFixed(2) : 0,
          totalCalls: enriched.length,
          totalMinutes: Math.round(totalMinutes),
        },
        daily,
        byClient,
        byDestination,
        worstRoutes,
        rateCards: allCards,
        selectedVendorCardId: vendorCardId,
        vendorDataLimited: !useRateCard && totalVendorBalance === 0,
        _source: `cdr-${useRateCard ? 'ratecard' : 'proportional'}`,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── API Keys (Tier 5 — #24) ───────────────────────────────────────────────
  // GET  /api/keys           — list keys for authenticated user (admin only)
  // POST /api/keys           — create a new key
  // DELETE /api/keys/:id     — revoke a key

  app.get('/api/keys', async (req: any, res: any) => {
    try {
      if (!req.user) return res.status(401).json({ message: 'Unauthorized' });
      const userId = req.user.claims?.sub;
      const role = await storage.getUserRole(userId);
      if (role !== 'admin') return res.status(403).json({ message: 'Admin only' });
      const keys = await storage.getApiKeys(userId);
      res.json(keys);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post('/api/keys', async (req: any, res: any) => {
    try {
      if (!req.user) return res.status(401).json({ message: 'Unauthorized' });
      const userId = req.user.claims?.sub;
      const role = await storage.getUserRole(userId);
      if (role !== 'admin') return res.status(403).json({ message: 'Admin only' });

      const { name, permissions = [] } = req.body;
      if (!name || typeof name !== 'string') return res.status(400).json({ message: 'name is required' });

      const rawKey   = `vw_${randomBytes(24).toString('hex')}`;  // 52-char key
      const keyHash  = createHash('sha256').update(rawKey).digest('hex');
      const keyPrefix = rawKey.slice(0, 12);

      const row = await storage.createApiKey({ userId, name, keyHash, keyPrefix, permissions });
      res.json({ ...row, rawKey });   // rawKey shown ONCE then discarded
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete('/api/keys/:id', async (req: any, res: any) => {
    try {
      if (!req.user) return res.status(401).json({ message: 'Unauthorized' });
      const userId = req.user.claims?.sub;
      const role = await storage.getUserRole(userId);
      if (role !== 'admin') return res.status(403).json({ message: 'Admin only' });
      await storage.revokeApiKey(Number(req.params.id), userId);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── Dashboard Widget Prefs (Tier 5 — #20) ────────────────────────────────
  app.get('/api/user/dashboard-prefs', async (req: any, res: any) => {
    try {
      if (!req.user) return res.status(401).json({ message: 'Unauthorized' });
      const userId = req.user.claims?.sub;
      const prefs = await storage.getDashboardWidgetPrefs(userId);
      res.json({ hiddenWidgets: prefs?.hiddenWidgets ?? [], widgetOrder: prefs?.widgetOrder ?? [] });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.put('/api/user/dashboard-prefs', async (req: any, res: any) => {
    try {
      if (!req.user) return res.status(401).json({ message: 'Unauthorized' });
      const userId = req.user.claims?.sub;
      const { hiddenWidgets, widgetOrder } = req.body;
      if (!Array.isArray(hiddenWidgets)) return res.status(400).json({ message: 'hiddenWidgets must be an array' });
      const prefs = await storage.setDashboardWidgetPrefs(userId, hiddenWidgets, Array.isArray(widgetOrder) ? widgetOrder : []);
      res.json({ hiddenWidgets: prefs.hiddenWidgets, widgetOrder: prefs.widgetOrder });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // GET /api/vendors/current-balances — latest vendor balance snapshot (internal)
  app.get('/api/vendors/current-balances', async (req: any, res: any) => {
    if (!req.user) return res.status(401).json({ message: 'Unauthorized' });
    const latest = vendorBalanceHistory.length > 0 ? vendorBalanceHistory[vendorBalanceHistory.length - 1] : null;
    res.json({
      vendors: latest?.vendors ?? [],
      ts: latest ? new Date(latest.timestamp).toISOString() : null,
      snapshotCount: vendorBalanceHistory.length,
    });
  });

  // ── External API (Tier 5 — #24) — authenticated via Bearer token ──────────
  async function validateBearerKey(req: any, res: any): Promise<boolean> {
    const authHeader = req.headers['authorization'] ?? '';
    const rawKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!rawKey) { res.status(401).json({ message: 'Missing Bearer token' }); return false; }
    const keyHash = createHash('sha256').update(rawKey).digest('hex');
    const record  = await storage.validateApiKey(keyHash);
    if (!record)  { res.status(401).json({ message: 'Invalid or revoked API key' }); return false; }
    await storage.touchApiKey(record.id);
    return true;
  }

  app.get('/ext/api/live-calls', async (req: any, res: any) => {
    if (!(await validateBearerKey(req, res))) return;
    try {
      const calls = await storage.getCalls(100);
      res.json({ ok: true, calls, ts: new Date().toISOString() });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get('/ext/api/asr-acd', async (req: any, res: any) => {
    if (!(await validateBearerKey(req, res))) return;
    try {
      const stats = await storage.getDashboardStats();
      res.json({ ok: true, asr: stats.asr, acd: stats.acd, activeCalls: stats.activeCalls, ts: new Date().toISOString() });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get('/ext/api/balance/:vendor', async (req: any, res: any) => {
    if (!(await validateBearerKey(req, res))) return;
    try {
      const settings = await storage.getSippySettings();
      if (!settings.sippyHost) return res.status(503).json({ message: 'Sippy not configured' });
      const vendors = await sippy.listSippyVendors(settings);
      const target  = vendors.find((v: any) => v.name?.toLowerCase() === req.params.vendor.toLowerCase());
      if (!target)  return res.status(404).json({ message: 'Vendor not found' });
      res.json({ ok: true, vendor: target.name, balance: target.balance, ts: new Date().toISOString() });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Cost Optimisation Recommendations Engine
  // Multi-factor smart analysis of CDR cache + rate cards → actionable insights
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/api/cost-optimisation/analyse', (req: any, res: any, next: any) => requireRole(['admin','management'], req, res, next), async (_req: any, res: any) => {
    try {
      const hours = Math.min(720, Math.max(1, Number(_req.query.hours) || 168));
      const cutoff = Date.now() - hours * 3600 * 1000;
      const analysisDays = hours / 24;

      // ── 1. Filter CDR cache to window ──────────────────────────────────────
      const cdrs = [...cdrCache.values()].filter(c => {
        const ts = c.startTime ? new Date(c.startTime).getTime()
          : c.connectTime ? new Date(c.connectTime).getTime() : 0;
        return ts >= cutoff;
      });

      if (cdrs.length === 0) {
        return res.json({ recommendations: [], summary: { totalSpend: 0, estimatedMonthlySpend: 0, totalPotentialMonthlySavings: 0, cdrCount: 0, vendorCount: 0, analysisDays, portfolioCPM: 0, lowestCPM: null }, hours, generatedAt: new Date().toISOString() });
      }

      // ── 2. Group CDRs by vendor ─────────────────────────────────────────────
      type VStats = { vendor: string; totalCalls: number; answeredCalls: number; billedSec: number; totalCost: number; pddSum: number; pddN: number; };
      const vendorMap = new Map<string, VStats>();
      let offPeakCalls = 0; let offPeakCost = 0;

      for (const c of cdrs) {
        let vendor = c.vendor || '';
        if (!vendor && c.iConnection) vendor = connectionVendorCache.get(c.iConnection) || '';
        if (!vendor) continue;
        if (!vendorMap.has(vendor)) vendorMap.set(vendor, { vendor, totalCalls: 0, answeredCalls: 0, billedSec: 0, totalCost: 0, pddSum: 0, pddN: 0 });
        const v = vendorMap.get(vendor)!;
        v.totalCalls++;
        const isAns = String(c.result) === '0' && (Number(c.duration) || 0) > 0;
        if (isAns) { v.answeredCalls++; v.billedSec += Number(c.duration) || 0; }
        v.totalCost += Number(c.cost) || 0;
        const pdd = Number(c.pdd1xx ?? c.pdd) || 0;
        if (pdd > 0) { v.pddSum += pdd; v.pddN++; }
        const hr = c.startTime ? new Date(c.startTime).getUTCHours() : -1;
        if (hr >= 0 && hr < 6) { offPeakCalls++; offPeakCost += Number(c.cost) || 0; }
      }

      // ── 3. Derived metrics per vendor ──────────────────────────────────────
      type VM = VStats & { asr: number; acdSec: number; avgPddSec: number; billedMin: number; costPerMin: number; };
      const vendors: VM[] = [];
      for (const [, v] of vendorMap) {
        const asr       = v.totalCalls > 0 ? (v.answeredCalls / v.totalCalls) * 100 : 0;
        const acdSec    = v.answeredCalls > 0 ? v.billedSec / v.answeredCalls : 0;
        const avgPddSec = v.pddN > 0 ? v.pddSum / v.pddN : 0;
        const billedMin = v.billedSec / 60;
        const costPerMin = billedMin > 0 ? v.totalCost / billedMin : 0;
        vendors.push({ ...v, asr, acdSec, avgPddSec, billedMin, costPerMin });
      }
      vendors.sort((a, b) => b.totalCost - a.totalCost);

      // ── 4. Portfolio aggregates ─────────────────────────────────────────────
      const totalSpend   = vendors.reduce((s, v) => s + v.totalCost, 0);
      const totalMinutes = vendors.reduce((s, v) => s + v.billedMin, 0);
      const totalCalls   = vendors.reduce((s, v) => s + v.totalCalls, 0);
      const portfolioAvgCPM = totalMinutes > 0 ? totalSpend / totalMinutes : 0;
      const cpmVals = vendors.filter(v => v.billedMin > 5).map(v => v.costPerMin);
      const cpmMean = cpmVals.length > 0 ? cpmVals.reduce((a, b) => a + b, 0) / cpmVals.length : 0;
      const cpmStd  = cpmVals.length > 1 ? Math.sqrt(cpmVals.reduce((s, x) => s + (x - cpmMean) ** 2, 0) / cpmVals.length) : 0;
      const lowestCpm = cpmVals.length > 0 ? Math.min(...cpmVals.filter(v => v > 0)) : null;
      const monthlyFactor = 30 / Math.max(analysisDays, 0.5);

      // ── 5. Rate cards (for unmanaged vendor detection) ──────────────────────
      const allCards = await storage.getRateCards();
      const vendorCardNames = new Set(allCards.filter(rc => rc.cardType === 'vendor').map(rc => rc.vendorName.toLowerCase()));

      // ── 6. Recommendation rules ─────────────────────────────────────────────
      type Rec = { id: string; category: string; priority: string; title: string; description: string; vendor?: string; metrics: { label: string; value: string }[]; estimatedMonthlySavings: number; confidence: number; actions: string[]; };
      const recs: Rec[] = [];

      for (const v of vendors) {
        const conf = Math.min(95, 40 + Math.round(v.totalCalls / 5));

        // Rule 1 — High cost vendor
        if (v.billedMin > 10 && cpmStd > 0 && v.costPerMin > cpmMean + cpmStd) {
          const excess = v.costPerMin - cpmMean;
          const savings = excess * v.billedMin * monthlyFactor;
          recs.push({ id: `high-cost-${v.vendor}`, category: 'cost_reduction', priority: savings > 300 ? 'high' : 'medium',
            title: `${v.vendor} — Above-Average Cost Per Minute`,
            description: `At $${v.costPerMin.toFixed(5)}/min, ${v.vendor} is ${((v.costPerMin - cpmMean) / cpmMean * 100).toFixed(1)}% above the portfolio mean ($${cpmMean.toFixed(5)}/min). Renegotiating rates or routing some traffic to lower-cost carriers with comparable quality could generate meaningful savings.`,
            vendor: v.vendor,
            metrics: [{ label: 'Vendor CPM', value: `$${v.costPerMin.toFixed(5)}` }, { label: 'Portfolio Mean CPM', value: `$${cpmMean.toFixed(5)}` }, { label: 'Volume', value: `${v.billedMin.toFixed(0)} min` }, { label: 'ASR', value: `${v.asr.toFixed(1)}%` }],
            estimatedMonthlySavings: savings, confidence: conf,
            actions: [`Request rate revision from ${v.vendor} citing portfolio benchmark data.`, `Test alternative vendors using the LCR Analyser for your key destinations.`, `Set a CPM ceiling threshold alert for this carrier.`] });
        }

        // Rule 2 — Poor quality (low ASR)
        if (v.asr < 50 && v.totalCalls >= 30) {
          const unanswered = v.totalCalls - v.answeredCalls;
          const revLoss = unanswered * 0.05 * monthlyFactor;
          recs.push({ id: `poor-quality-${v.vendor}`, category: 'quality_alert', priority: v.asr < 20 ? 'high' : 'medium',
            title: `${v.vendor} — Low Answer Rate (${v.asr.toFixed(1)}%)`,
            description: `${v.vendor} answered only ${v.asr.toFixed(1)}% of calls — ${unanswered.toLocaleString()} attempts failed over the last ${analysisDays.toFixed(0)} days. Below-benchmark ASR degrades customer experience and inflates cost-per-connected-minute. Consider reducing or suspending traffic allocation.`,
            vendor: v.vendor,
            metrics: [{ label: 'ASR', value: `${v.asr.toFixed(1)}%` }, { label: 'Unanswered', value: unanswered.toLocaleString() }, { label: 'Total Calls', value: v.totalCalls.toLocaleString() }, { label: 'ACD', value: `${v.acdSec.toFixed(0)}s` }],
            estimatedMonthlySavings: revLoss, confidence: Math.min(90, conf),
            actions: [`File a performance SLA breach report with ${v.vendor}.`, `Reduce ${v.vendor}'s traffic weight in Sippy LCR tables.`, `Enable automatic failover to backup carrier on ring timeout.`] });
        }

        // Rule 3 — Zero answer (route failure)
        if (v.answeredCalls === 0 && v.totalCalls >= 10) {
          recs.push({ id: `zero-answer-${v.vendor}`, category: 'anomaly', priority: 'high',
            title: `${v.vendor} — Zero Answered Calls (Route Failure)`,
            description: `${v.vendor} received ${v.totalCalls.toLocaleString()} call attempts with 0% ASR over the last ${analysisDays.toFixed(0)} days — indicating a complete route failure or misconfiguration. All traffic should be immediately re-routed.`,
            vendor: v.vendor,
            metrics: [{ label: 'Call Attempts', value: v.totalCalls.toLocaleString() }, { label: 'ASR', value: '0.0%' }, { label: 'Wasted Spend', value: `$${v.totalCost.toFixed(4)}` }, { label: 'Est. Monthly Loss', value: `$${(v.totalCost * monthlyFactor).toFixed(2)}` }],
            estimatedMonthlySavings: v.totalCost * monthlyFactor, confidence: 98,
            actions: [`Immediately suspend traffic to ${v.vendor}.`, `Contact ${v.vendor} NOC to investigate route failure.`, `Review SIP trace logs for disconnect cause codes.`] });
        }

        // Rule 4 — High PDD
        if (v.avgPddSec > 4 && v.answeredCalls >= 20) {
          const revLoss = v.answeredCalls * Math.min(0.3, (v.avgPddSec - 4) * 0.05) * 0.04 * monthlyFactor;
          recs.push({ id: `high-pdd-${v.vendor}`, category: 'quality_alert', priority: v.avgPddSec > 8 ? 'high' : 'medium',
            title: `${v.vendor} — High Post-Dial Delay (${v.avgPddSec.toFixed(1)}s)`,
            description: `${v.vendor}'s average PDD is ${v.avgPddSec.toFixed(1)}s, well above the ≤2s industry benchmark. Extended ring delay increases caller abandonment and degrades perceived quality scores. Escalate to vendor NOC or configure this carrier as last-resort.`,
            vendor: v.vendor,
            metrics: [{ label: 'Avg PDD', value: `${v.avgPddSec.toFixed(2)}s` }, { label: 'Benchmark', value: '≤ 2.0s' }, { label: 'Answered Calls', value: v.answeredCalls.toLocaleString() }, { label: 'ACD', value: `${v.acdSec.toFixed(0)}s` }],
            estimatedMonthlySavings: revLoss, confidence: 65,
            actions: [`Raise PDD SLA escalation ticket with ${v.vendor}.`, `Re-order LCR table to route through this vendor last.`, `Monitor PDD trend in Vendor SLA Scorecard.`] });
        }

        // Rule 5 — No rate card loaded
        if (!vendorCardNames.has(v.vendor.toLowerCase()) && v.totalCost > 5) {
          const estMonthly = v.totalCost * monthlyFactor;
          recs.push({ id: `no-ratecard-${v.vendor}`, category: 'risk', priority: estMonthly > 200 ? 'high' : 'medium',
            title: `${v.vendor} — No Rate Card Loaded`,
            description: `${v.vendor} has generated an estimated $${estMonthly.toFixed(2)}/month in spend but has no rate card in the system. Without a reference rate card, billing discrepancies may go undetected and LCR optimisation is incomplete.`,
            vendor: v.vendor,
            metrics: [{ label: 'Est. Monthly Spend', value: `$${estMonthly.toFixed(2)}` }, { label: 'Period Spend', value: `$${v.totalCost.toFixed(4)}` }, { label: 'Volume', value: `${v.billedMin.toFixed(0)} min` }],
            estimatedMonthlySavings: 0, confidence: 99,
            actions: [`Upload ${v.vendor}'s rate card in the Rate Card Manager.`, `Use Rate Card → Verify vs Sippy to detect any billing discrepancies.`, `Request the latest rate schedule from ${v.vendor}.`] });
        }

        // Rule 6 — Negotiation leverage
        const shareOfSpend = totalSpend > 0 ? (v.totalCost / totalSpend) * 100 : 0;
        if (shareOfSpend > 25 && v.costPerMin > portfolioAvgCPM && v.billedMin > 30) {
          const savings = v.totalCost * 0.10 * monthlyFactor;
          recs.push({ id: `leverage-${v.vendor}`, category: 'opportunity', priority: 'high',
            title: `${v.vendor} — Negotiation Leverage (${shareOfSpend.toFixed(0)}% of Spend)`,
            description: `${v.vendor} accounts for ${shareOfSpend.toFixed(1)}% of total spend (~$${(v.totalCost * monthlyFactor).toFixed(0)}/mo) at an above-average rate. Your traffic volume gives you significant leverage. A negotiated 10% rate reduction would save an estimated $${savings.toFixed(0)}/month.`,
            vendor: v.vendor,
            metrics: [{ label: 'Spend Share', value: `${shareOfSpend.toFixed(1)}%` }, { label: 'Est. Monthly', value: `$${(v.totalCost * monthlyFactor).toFixed(2)}` }, { label: 'CPM', value: `$${v.costPerMin.toFixed(5)}` }, { label: 'Volume', value: `${v.billedMin.toFixed(0)} min` }],
            estimatedMonthlySavings: savings, confidence: 70,
            actions: [`Schedule a rate review with ${v.vendor} — present traffic volume data.`, `Request volume-discount tier structure.`, `Benchmark competitor rates via LCR Analyser before negotiation.`] });
        }
      }

      // Rule 7 — Vendor concentration risk
      if (vendors.length > 0 && totalCalls > 50) {
        const top = vendors[0];
        const topShare = (top.totalCalls / totalCalls) * 100;
        if (topShare > 60) {
          recs.push({ id: 'concentration-risk', category: 'risk', priority: topShare > 80 ? 'high' : 'medium',
            title: `Concentration Risk — ${top.vendor} Carries ${topShare.toFixed(0)}% of Traffic`,
            description: `${top.vendor} handles ${topShare.toFixed(0)}% of all call traffic. A disruption, rate hike, or outage at this single vendor would severely impact operations. Industry best practice is no single vendor above 40–50%.`,
            vendor: top.vendor,
            metrics: [{ label: 'Traffic Share', value: `${topShare.toFixed(1)}%` }, { label: 'Calls', value: top.totalCalls.toLocaleString() }, { label: 'Active Vendors', value: vendors.filter(v => v.totalCalls > 0).length.toString() }],
            estimatedMonthlySavings: 0, confidence: 95,
            actions: [`Onboard at least one alternative vendor for redundancy.`, `Configure load-balanced routing split across vendors.`, `Set up automatic failover in Sippy for key destination groups.`] });
        }
      }

      // Rule 8 — Best value vendor (expand usage)
      const qualityVendors = vendors.filter(v => v.asr >= 65 && v.billedMin > 20);
      if (qualityVendors.length > 0 && cpmMean > 0) {
        const best = [...qualityVendors].sort((a, b) => a.costPerMin - b.costPerMin)[0];
        if (best.costPerMin < cpmMean * 0.85) {
          const savings = (cpmMean - best.costPerMin) * (totalMinutes * 0.1) * monthlyFactor;
          recs.push({ id: 'best-value-vendor', category: 'opportunity', priority: 'medium',
            title: `${best.vendor} — Best Value Carrier (Expand Usage)`,
            description: `${best.vendor} delivers ${best.asr.toFixed(0)}% ASR at $${best.costPerMin.toFixed(5)}/min — ${((1 - best.costPerMin / cpmMean) * 100).toFixed(0)}% below portfolio average — with excellent quality metrics. Routing additional traffic through this carrier could reduce blended cost.`,
            vendor: best.vendor,
            metrics: [{ label: 'ASR', value: `${best.asr.toFixed(1)}%` }, { label: 'CPM', value: `$${best.costPerMin.toFixed(5)}` }, { label: 'Portfolio Avg', value: `$${cpmMean.toFixed(5)}` }, { label: 'Volume', value: `${best.billedMin.toFixed(0)} min` }],
            estimatedMonthlySavings: savings, confidence: Math.min(80, 40 + Math.round(best.totalCalls / 10)),
            actions: [`Increase ${best.vendor}'s routing weight in Sippy LCR tables.`, `Run LCR Analyser to confirm routing efficiency for key destinations.`, `Negotiate a capacity commitment for further rate improvements.`] });
        }
      }

      // Rule 9 — Off-peak routing opportunity
      const offPeakPct = totalCalls > 0 ? (offPeakCalls / totalCalls) * 100 : 0;
      if (offPeakCalls > 50 && offPeakPct > 5) {
        recs.push({ id: 'off-peak-routing', category: 'strategy', priority: 'low',
          title: `Time-Based Routing — ${offPeakPct.toFixed(0)}% Off-Peak Traffic`,
          description: `${offPeakPct.toFixed(1)}% of calls (${offPeakCalls.toLocaleString()}) occur during off-peak hours (midnight–6am UTC). Many carriers offer reduced off-peak rates. Configuring time-based routing rules to favour cheaper carriers during these hours could reduce blended cost.`,
          metrics: [{ label: 'Off-Peak Calls', value: offPeakCalls.toLocaleString() }, { label: '% of Traffic', value: `${offPeakPct.toFixed(1)}%` }, { label: 'Est. Monthly Off-Peak Spend', value: `$${(offPeakCost * monthlyFactor).toFixed(2)}` }],
          estimatedMonthlySavings: offPeakCost * 0.15 * monthlyFactor, confidence: 55,
          actions: [`Request off-peak rate schedules from your top 3 vendors.`, `Configure time-based routing rules in Sippy dialplan.`, `Use Call Flow Simulator to model routing change impact.`] });
      }

      // ── 7. Sort: priority → estimated savings ──────────────────────────────
      const priOrd: Record<string, number> = { high: 3, medium: 2, low: 1 };
      recs.sort((a, b) => {
        const pd = (priOrd[b.priority] || 0) - (priOrd[a.priority] || 0);
        return pd !== 0 ? pd : b.estimatedMonthlySavings - a.estimatedMonthlySavings;
      });

      const totalSavings = recs.reduce((s, r) => s + r.estimatedMonthlySavings, 0);
      res.json({
        recommendations: recs,
        summary: { totalSpend: parseFloat(totalSpend.toFixed(4)), estimatedMonthlySpend: parseFloat((totalSpend * monthlyFactor).toFixed(2)), totalPotentialMonthlySavings: parseFloat(totalSavings.toFixed(2)), cdrCount: cdrs.length, vendorCount: vendors.length, analysisDays: parseFloat(analysisDays.toFixed(1)), portfolioCPM: parseFloat(portfolioAvgCPM.toFixed(6)), lowestCPM: lowestCpm !== null ? parseFloat(lowestCpm.toFixed(6)) : null },
        hours, generatedAt: new Date().toISOString(),
      });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ── WhatsApp Push Alerts ──────────────────────────────────────────────────

  // POST /api/whatsapp/test — send a test WhatsApp message
  app.post('/api/whatsapp/test', (req: any, res, next) => requireRole(['admin'], req, res, next), async (_req, res) => {
    try {
      const msg = [
        '✅ *VoIP Monitor — Test Alert*',
        '━━━━━━━━━━━━━━━━━━',
        '📡 WhatsApp push alerts are configured correctly.',
        `🕒 ${new Date().toUTCString()}`,
        '━━━━━━━━━━━━━━━━━━',
        '_This is a test message. No action required._',
      ].join('\n');
      const result = await waSvc.sendWhatsAppAlert('test', msg);
      if (result.sent === 0 && result.failed === 0) {
        return res.json({ ok: false, error: 'WhatsApp not enabled or no phone numbers configured.' });
      }
      res.json({ ok: result.failed === 0, sent: result.sent, failed: result.failed });
    } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // GET /api/whatsapp/logs — delivery log
  app.get('/api/whatsapp/logs', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (_req, res) => {
    try {
      const logs = await storage.getWhatsappAlertLogs(200);
      res.json(logs);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Start Sippy change-detection watcher (accounts, IPs, vendors)
  initSippyWatcher();

  return httpServer;
}
