
import type { Express } from "express";
import { createServer, type Server } from "http";
import * as net from "net";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { setupAuth, registerAuthRoutes } from "./replit_integrations/auth";
import * as vos3000 from "./vos3000";
import * as sippy from "./sippy";
import * as sippySnmp from "./snmp";
import * as emailSvc from "./email";
import { enrichCdr, detectCountry, detectTrunkClass, sipCodeToFailReason, detectFas } from "./cdr-enrichment";

// ── Sippy credential helper ────────────────────────────────────────────────────
// Per Sippy docs (106909): XML-RPC API authenticates with Web Login + API Password.
// Admin credentials (apiAdminUsername/apiAdminPassword) provide root-level API access
// and are always preferred over customer-level portal credentials.
// Portal username/password are used as a fallback (e.g. when admin creds are not set).
type SippyCreds = { apiAdminUsername?: string | null; apiAdminPassword?: string | null; portalUsername?: string | null; portalPassword?: string | null };
function sippyXmlCreds(s: SippyCreds, sw?: { portalUsername?: string | null; portalPassword?: string | null }) {
  return {
    username: s.apiAdminUsername || sw?.portalUsername || s.portalUsername || '',
    password: s.apiAdminPassword || sw?.portalPassword || s.portalPassword || '',
  };
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
    apiAdminPassword: string | null | undefined,
    portalUsername: string | null | undefined,
    portalPassword: string | null | undefined,
  ): Promise<{ success: boolean; message: string }> {
    const pairs: [string, string][] = [];
    if (apiAdminUsername && apiAdminPassword) pairs.push([apiAdminUsername, apiAdminPassword]);
    if (portalUsername && portalPassword) pairs.push([portalUsername, portalPassword]);
    if (!pairs.length) return { success: false, message: 'No credentials configured.' };

    let portalFallback: { success: boolean; message: string } | null = null;

    // Pass 1: try each credential pair — stop immediately if XML-RPC works
    for (const [u, p] of pairs) {
      const r = await sippy.connectSippy(portalUrl, u, p);
      if (r.success) {
        if (sippy.getSippySessionStatus().mode === 'xmlrpc') return r;
        if (!portalFallback) portalFallback = r;
        sippy.clearSippySession(); // clear portal-mode session, try next pair
      }
    }

    // Pass 2: no XML-RPC found — reconnect in portal mode with first working credentials
    if (portalFallback) {
      for (const [u, p] of pairs) {
        const r = await sippy.connectSippy(portalUrl, u, p);
        if (r.success) return r;
      }
    }

    return { success: false, message: 'Authentication failed for all configured credentials.' };
  }

  // === IP PROBE ENGINE ===
  // Runs independently to measure real latency to the monitored IP(s)
  async function runIpProbe() {
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
  }
  // Run probe immediately on startup, then every 10 seconds
  runIpProbe();
  setInterval(runIpProbe, 10000);

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
      if (s.portalUrl && s.switchType === 'sippy') {
        console.log('[startup] Sippy credentials found — attempting auto-connect...');
        const result = await smartSippyConnect(s.portalUrl, s.apiAdminUsername, s.apiAdminPassword, s.portalUsername, s.portalPassword);
        if (result.success) {
          console.log('[startup] Sippy auto-connected:', result.message);
        } else {
          console.warn('[startup] Sippy auto-connect failed:', result.message);
        }
      }
    } catch (err) {
      console.error('[startup] Sippy auto-connect error:', err);
    }
  })();

  // === VOS3000 SESSION RESTORE ON STARTUP ===
  // Only runs when switchType is 'vos3000' and a saved session exists
  (async () => {
    try {
      const s = await storage.getSettings();
      if (s.switchType === 'vos3000' && s.portalSessionToken && s.portalSessionBase && s.portalSessionUser) {
        vos3000.restoreSession(s.portalSessionToken, s.portalSessionBase, s.portalSessionUser);
        console.log('[startup] VOS3000 session restored for', s.portalSessionUser);
        const staleCalls = await storage.getCalls(500);
        for (const c of staleCalls) {
          if (c.status === 'active') await storage.endCall(c.id, 'completed');
        }
      }
    } catch (err) {
      console.error('[startup] Session restore error:', err);
    }
  })();

  // === VOS3000 LIVE SYNC ENGINE ===
  // Runs every 15 seconds when a VOS3000 session is active.
  // Fetches live calls from the portal, syncs them into the local DB,
  // and keeps the Tomcat session alive (preventing the 30-min idle timeout).
  const vosCallIdMap = new Map<string, number>(); // vosCallId → local DB call id

  async function runVos3000Sync() {
    // Only run when VOS3000 is the selected active switch
    const currentSettings = await storage.getSettings();
    if (currentSettings.switchType !== 'vos3000') return;
    const sessionStatus = vos3000.getSessionStatus();
    if (!sessionStatus.active) return;

    try {
      const { calls: vosCalls, error } = await vos3000.fetchLiveCalls();

      if (error === 'Session expired.') {
        console.log('[VOS3000 Sync] Session expired — clearing stored token');
        vos3000.clearSession();
        await storage.updateSettings({ portalSessionToken: null, portalSessionUser: null, portalSessionBase: null });
        vosCallIdMap.clear();
        return;
      }

      const liveSettings = await storage.getSettings();
      const vosCallIds = new Set((vosCalls ?? []).map((c: any) => c.id as string));

      // End DB calls that are no longer active in VOS3000
      for (const [vosId, dbId] of vosCallIdMap.entries()) {
        if (!vosCallIds.has(vosId)) {
          await storage.endCall(dbId, 'completed');
          vosCallIdMap.delete(vosId);
        }
      }

      // Create or update calls from VOS3000
      for (const vc of (vosCalls ?? [])) {
        const latency = lastProbeResult?.latency ?? 50;
        const jitter = parseFloat((3 + Math.random() * 10).toFixed(2));
        const packetLoss = parseFloat((Math.random() * 0.3).toFixed(4));
        let rFactor = 94 - (latency / 20) - jitter - (packetLoss * 20);
        rFactor = Math.max(0, rFactor);
        let mos = 1 + (0.035 * rFactor) + (rFactor * (rFactor - 60) * (100 - rFactor) * 0.000007);
        mos = parseFloat(Math.max(1, Math.min(5, mos)).toFixed(4));

        if (!vosCallIdMap.has(vc.id)) {
          // New call — create in DB
          const dbCall = await storage.createCall({
            caller: vc.caller || 'unknown',
            callee: vc.callee || 'unknown',
            direction: 'outbound',
            status: 'active',
            pdd: null,
          });
          vosCallIdMap.set(vc.id, dbCall.id);
          await storage.createMetric({ callId: dbCall.id, jitter, latency, packetLoss, mos });

          // Alert if latency is above threshold
          if (latency > (liveSettings.latencyThreshold ?? 150)) {
            const existing = await storage.getAlerts();
            const hasAlert = existing.some((a: any) => !a.resolved && a.type === 'high_latency' && a.message.includes(`call ${dbCall.id}`));
            if (!hasAlert) {
              await storage.createAlert({
                type: 'high_latency',
                severity: 'warning',
                message: `High Latency (${Math.round(latency)}ms) from live source on call ${dbCall.id}`,
                resolved: false,
              });
            }
          }
        } else {
          // Existing call — add fresh metric
          const dbId = vosCallIdMap.get(vc.id)!;
          await storage.createMetric({ callId: dbId, jitter, latency, packetLoss, mos });
        }
      }

      if ((vosCalls ?? []).length > 0 || vosCallIdMap.size > 0) {
        console.log(`[VOS3000 Sync] Live calls: ${(vosCalls ?? []).length} | DB active: ${vosCallIdMap.size}`);
      }
    } catch (err: any) {
      if (err?.message === 'SESSION_EXPIRED') {
        vos3000.clearSession();
        await storage.updateSettings({ portalSessionToken: null, portalSessionUser: null, portalSessionBase: null });
        vosCallIdMap.clear();
        console.log('[VOS3000 Sync] Session expired — cleared');
      } else {
        console.error('[VOS3000 Sync] Error:', err?.message);
      }
    }
  }

  // VOS3000 live sync — runs every 15 seconds; switchType guard inside runVos3000Sync()
  setInterval(runVos3000Sync, 15000);

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

  // Settings
  app.get(api.settings.get.path, async (req, res) => {
    const settings = await storage.getSettings();
    res.json(settings);
  });

  app.patch(api.settings.update.path, async (req, res) => {
    try {
      const input = api.settings.update.input.parse(req.body);
      const updated = await storage.updateSettings(input);
      res.json(updated);
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

  app.post(api.settings.resetSimulation.path, async (req, res) => {
    res.json({ message: "Simulation reset acknowledged" });
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

  // ── User Configuration API ────────────────────────────────────────────────

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
    try { res.json(await storage.getSwitches()); }
    catch { res.status(500).json({ message: 'Failed to fetch switches' }); }
  });

  app.post('/api/switches', (req: any, res, next) => requireRole(['admin'], req, res, next), async (req, res) => {
    try {
      const sw = await storage.createSwitch(req.body);
      res.status(201).json(sw);
    } catch { res.status(500).json({ message: 'Failed to create switch' }); }
  });

  app.patch('/api/switches/:id', (req: any, res, next) => requireRole(['admin'], req, res, next), async (req, res) => {
    try {
      const sw = await storage.updateSwitch(Number(req.params.id), req.body);
      res.json(sw);
    } catch { res.status(500).json({ message: 'Failed to update switch' }); }
  });

  app.delete('/api/switches/:id', (req: any, res, next) => requireRole(['admin'], req, res, next), async (req, res) => {
    try {
      await storage.deleteSwitch(Number(req.params.id));
      res.json({ message: 'Switch deleted' });
    } catch { res.status(500).json({ message: 'Failed to delete switch' }); }
  });

  // Get session status for a specific switch
  app.get('/api/switches/:id/session', async (req, res) => {
    try {
      const allSwitches = await storage.getSwitches();
      const sw = allSwitches.find(s => s.id === Number(req.params.id));
      if (!sw) return res.status(404).json({ active: false });
      if (sw.type === 'sippy') return res.json({ active: true, note: 'Sippy uses Basic Auth — no login required' });
      const session = sw.portalUrl ? vos3000.getSessionForUrl(sw.portalUrl) : null;
      res.json({ active: !!session, loggedInAt: session ? (session as any).loggedInAt : undefined });
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
          clientName: c.user || c.accountId || undefined,
          vendor: c.vendor,
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

      if (sw.type === 'vos3000') {
        const session = vos3000.getSessionForUrl(sw.portalUrl);
        if (!session) return res.json({ calls: [], error: 'Not logged in to this VOS3000 switch. Connect via Settings.', needsLogin: true });
        const result = await vos3000.fetchLiveCallsForSession(session as any);
        return res.json({ ...result, switchType: 'vos3000', switchName: sw.name });
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

      if (sw.type === 'vos3000') {
        const session = vos3000.getSessionForUrl(sw.portalUrl);
        if (!session) return res.json({ error: 'Not logged in.' });
        const stats = await vos3000.fetchStats();
        return res.json(stats);
      }

      return res.json({ error: 'Unsupported switch type.' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/switches/:id/captcha — get CAPTCHA for secondary VOS3000 switch login
  app.get('/api/switches/:id/captcha', async (req, res) => {
    try {
      const allSwitches = await storage.getSwitches();
      const sw = allSwitches.find(s => s.id === Number(req.params.id));
      if (!sw || sw.type !== 'vos3000' || !sw.portalUrl) return res.status(400).json({ error: 'Switch not found or not VOS3000.' });
      const result = await vos3000.fetchCaptcha(sw.portalUrl);
      if (!result) return res.status(502).json({ error: 'Could not fetch CAPTCHA from switch portal.' });
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // POST /api/switches/:id/login — login to secondary VOS3000 switch with CAPTCHA
  app.post('/api/switches/:id/login', async (req, res) => {
    try {
      const allSwitches = await storage.getSwitches();
      const sw = allSwitches.find(s => s.id === Number(req.params.id));
      if (!sw || sw.type !== 'vos3000' || !sw.portalUrl) return res.status(400).json({ success: false, message: 'Switch not found or not VOS3000.' });
      const { challengeId, captchaCode } = req.body as { challengeId?: string; captchaCode?: string };
      if (!challengeId || !captchaCode) return res.status(400).json({ success: false, message: 'CAPTCHA challenge required.' });
      const username = sw.portalUsername || '';
      const password = sw.portalPassword || '';
      const result = await vos3000.loginWithCaptcha(sw.portalUrl, username, password, challengeId, captchaCode, sw.loginType ?? 1);
      res.json(result);
    } catch (err: any) { res.status(500).json({ success: false, message: err.message }); }
  });

  // ── Shared helper: push profile + rate to a single switch ──────────────────

  async function pushProfileToOneSwitch(
    profile: Awaited<ReturnType<typeof storage.getClientProfiles>>[number],
    sw: { id: number; type: string; portalUrl: string | null; portalUsername: string | null; portalPassword: string | null },
    pushOpts?: vos3000.PushRateOptions,
  ): Promise<{ success: boolean; message: string; detail?: string }> {
    if (!sw.portalUrl) return { success: false, message: `Switch "${sw.type}" has no URL configured.` };

    if (sw.type === 'vos3000') {
      const session = vos3000.getSessionForUrl(sw.portalUrl);
      if (!session) return { success: false, message: `Not logged in to VOS3000 at ${sw.portalUrl}. Connect in Settings first.` };

      const acctRes = await vos3000.pushAccountToVos3000({
        name: profile.name,
        type: profile.type as 'client' | 'vendor',
        ipAddress: profile.ipAddress || undefined,
        ratePerMin: profile.ratePerMin || undefined,
      }, session);

      if (pushOpts || (profile.prefix && profile.ratePerMin)) {
        const rOpts = pushOpts ?? {
          accountName: profile.name,
          prefix: profile.prefix!,
          ratePerMin: profile.ratePerMin!,
          effectiveFrom: profile.rateEffectiveFrom ? new Date(profile.rateEffectiveFrom) : undefined,
          effectiveTo:   profile.rateEffectiveTo   ? new Date(profile.rateEffectiveTo)   : undefined,
        };
        const rateRes = await vos3000.pushRateToVos3000(rOpts, session);
        return rateRes.success ? rateRes : rateRes;
      }
      return acctRes;
    }

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

      const pushOpts: vos3000.PushRateOptions = {
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

        if (sw.type === 'vos3000') {
          const session = vos3000.getSessionForUrl(sw.portalUrl);
          if (!session) { results[key] = { success: false, message: `Not logged in. Connect to ${sw.portalUrl} first.` }; continue; }
          results[key] = await vos3000.pushRateToVos3000(pushOpts, session);
        } else if (sw.type === 'sippy') {
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

  // Portal connection test — tries to reach the configured management portal URL
  app.post('/api/portal/test', async (req, res) => {
    const { url, username } = req.body as { url?: string; username?: string; password?: string };
    if (!url) return res.status(400).json({ reachable: false, message: 'No URL provided.' });

    try {
      const parsed = new URL(url);
      const isHttps = parsed.protocol === 'https:';
      const port = parsed.port
        ? Number(parsed.port)
        : isHttps ? 443 : 80;
      const host = parsed.hostname;

      const result = await new Promise<{ reachable: boolean; latency: number }>((resolve) => {
        const start = Date.now();
        const socket = new net.Socket();
        socket.setTimeout(5000);
        socket.connect(port, host, () => {
          const latency = Date.now() - start;
          socket.destroy();
          resolve({ reachable: true, latency });
        });
        socket.on('timeout', () => { socket.destroy(); resolve({ reachable: false, latency: -1 }); });
        socket.on('error', () => { socket.destroy(); resolve({ reachable: false, latency: -1 }); });
      });

      if (result.reachable) {
        res.json({
          reachable: true,
          message: `Portal reachable at ${host}:${port} — latency ${result.latency}ms. Enter your credentials and save to enable data extraction.`,
          latency: result.latency,
        });
      } else {
        res.json({
          reachable: false,
          message: `Could not reach ${host}:${port}. Check the URL or ensure the portal allows connections from this server.`,
        });
      }
    } catch (err) {
      res.json({ reachable: false, message: `Invalid URL format. Use http://IP:PORT or https://domain.` });
    }
  });

  // ── VOS3000 Portal Integration ──────────────────────────────────────────────

  // GET /api/portal/captcha — fetch a fresh CAPTCHA image from VOS3000
  app.get('/api/portal/captcha', async (req, res) => {
    const settings = await storage.getSettings();
    const portalUrl = settings.portalUrl;
    if (!portalUrl) {
      return res.status(400).json({ error: 'No portal URL configured in Settings.' });
    }
    const result = await vos3000.fetchCaptcha(portalUrl);
    if (!result) {
      return res.status(502).json({ error: 'Could not fetch CAPTCHA from portal. Check the Portal URL.' });
    }
    res.json(result);
  });

  // POST /api/portal/login — complete VOS3000 login with CAPTCHA answer
  app.post('/api/portal/login', async (req, res) => {
    const { username, password, challengeId, captchaCode, loginType } = req.body as {
      username?: string;
      password?: string;
      challengeId?: string;
      captchaCode?: string;
      loginType?: number;
    };
    if (!username || !password || !challengeId || !captchaCode) {
      return res.status(400).json({ success: false, message: 'Missing required fields.' });
    }
    const settings = await storage.getSettings();
    const portalUrl = settings.portalUrl;
    if (!portalUrl) {
      return res.status(400).json({ success: false, message: 'No portal URL configured in Settings.' });
    }
    const result = await vos3000.loginWithCaptcha(portalUrl, username, password, challengeId, captchaCode, loginType ?? 1);
    // Persist session token to DB so it survives server restarts
    if (result.success) {
      const token = vos3000.getActiveSessionToken();
      const base = vos3000.getActiveSessionBase();
      if (token && base) {
        await storage.updateSettings({ portalSessionToken: token, portalSessionUser: username, portalSessionBase: base });
        console.log('[VOS3000] Session token saved to DB for user:', username);
      }
    }
    res.json(result);
  });

  // GET /api/portal/session — return current portal session status
  app.get('/api/portal/session', (_req, res) => {
    const status = vos3000.getSessionStatus();
    res.json(status);
  });

  // DELETE /api/portal/session — logout from portal
  app.delete('/api/portal/session', (_req, res) => {
    vos3000.clearSession();
    res.json({ success: true, message: 'Logged out from portal.' });
  });

  // GET /api/portal/live-calls — fetch active calls from VOS3000
  app.get('/api/portal/live-calls', async (_req, res) => {
    const result = await vos3000.fetchLiveCalls();
    res.json(result);
  });

  // GET /api/portal/cdr — fetch CDR records from VOS3000
  app.get('/api/portal/cdr', async (req, res) => {
    const limit = Number(req.query.limit) || 100;
    const hoursAgo = Number(req.query.hoursAgo) || 24;
    const result = await vos3000.fetchCdrRecords({ limit, startHoursAgo: hoursAgo });
    res.json(result);
  });

  // GET /api/portal/stats — fetch summary stats from VOS3000
  app.get('/api/portal/stats', async (_req, res) => {
    const result = await vos3000.fetchStats();
    res.json(result);
  });

  // GET /api/portal/clients — list terminal accounts (clients) from VOS3000
  app.get('/api/portal/clients', async (_req, res) => {
    const result = await vos3000.fetchVosClients();
    res.json(result);
  });

  // GET /api/portal/client-stats — per-client call stats from VOS3000 (24h)
  app.get('/api/portal/client-stats', async (_req, res) => {
    const result = await vos3000.fetchClientStats();
    res.json(result);
  });

  // ── Sippy Softswitch Routes ──────────────────────────────────────────────

  // POST /api/sippy/test — test connection
  app.post('/api/sippy/test', async (req, res) => {
    const { url, username, password } = req.body as { url?: string; username?: string; password?: string };
    if (!url) return res.status(400).json({ reachable: false, message: 'No URL provided.' });
    const s = await storage.getSettings();
    // 1. Try admin XML-RPC credentials first (full API access, no "unavailable" note)
    if (s.apiAdminUsername && s.apiAdminPassword) {
      const adminResult = await sippy.testSippyConnection(url, s.apiAdminUsername, s.apiAdminPassword);
      if (adminResult.authenticated) return res.json(adminResult);
    }
    // 2. Try supplied credentials
    if (username) {
      const result = await sippy.testSippyConnection(url, username, password ?? '');
      if (result.authenticated) return res.json(result);
    }
    // 3. Fallback: portal credentials from DB
    if (s.portalUsername && s.portalPassword) {
      const portalResult = await sippy.testSippyConnection(url, s.portalUsername, s.portalPassword);
      return res.json(portalResult);
    }
    // Nothing worked — return a generic failure
    res.json({ reachable: true, authenticated: false, message: 'Server is reachable but all credential attempts failed.' });
  });

  // POST /api/sippy/connect — authenticate and store session
  app.post('/api/sippy/connect', async (req, res) => {
    const settings = await storage.getSettings();
    const { portalUrl, portalUsername, portalPassword, apiAdminUsername, apiAdminPassword } = settings;
    if (!portalUrl) {
      return res.status(400).json({ success: false, message: 'Portal URL not saved in Settings.' });
    }
    const result = await smartSippyConnect(portalUrl, apiAdminUsername, apiAdminPassword, portalUsername, portalPassword);
    if (result.success) return res.json(result);
    return res.status(400).json(result);
  });

  // GET /api/sippy/session — current Sippy session status
  app.get('/api/sippy/session', (_req, res) => {
    res.json(sippy.getSippySessionStatus());
  });

  // DELETE /api/sippy/session — disconnect Sippy session
  app.delete('/api/sippy/session', (_req, res) => {
    sippy.clearSippySession();
    res.json({ success: true, message: 'Disconnected from Sippy.' });
  });

  // POST /api/switch/activate — change the active switch type and auto-connect
  app.post('/api/switch/activate', async (req, res) => {
    const { type } = req.body as { type: string };
    if (type !== 'sippy' && type !== 'vos3000') {
      return res.status(400).json({ error: 'Invalid switch type. Must be "sippy" or "vos3000".' });
    }
    const s = await storage.getSettings();
    await storage.updateSettings({ switchType: type as 'sippy' | 'vos3000' });

    if (type === 'sippy') {
      if (!s.portalUrl || !s.portalUsername || !s.portalPassword) {
        return res.json({ success: false, message: 'Sippy credentials not configured. Go to Settings → Switch Configuration.' });
      }
      try {
        const result = await sippy.connectSippy(s.portalUrl, s.portalUsername, s.portalPassword);
        return res.json({ success: result.success, message: result.message });
      } catch (err: any) {
        return res.json({ success: false, message: `Sippy connect error: ${err.message}` });
      }
    }

    if (type === 'vos3000') {
      if (s.portalSessionToken && s.portalSessionBase && s.portalSessionUser) {
        vos3000.restoreSession(s.portalSessionToken, s.portalSessionBase, s.portalSessionUser);
        return res.json({ success: true, message: `VOS3000 session restored for ${s.portalSessionUser}` });
      }
      return res.json({ success: false, message: 'No saved VOS3000 session. Go to Settings → Portal Sign-In to log in first.' });
    }
  });

  // GET /api/sippy/live-calls — active calls from Sippy
  app.get('/api/sippy/live-calls', async (_req, res) => {
    const settings = await storage.getSettings();
    const { username, password } = sippyXmlCreds(settings);
    const raw = await sippy.getSippyActiveCalls(username, password);
    // Map CC_STATE → callStatus for the frontend, expose full ccState separately
    const ccStateMap: Record<string, 'connected' | 'routing'> = {
      Connected:    'connected',
      ARComplete:   'routing',
      WaitRoute:    'routing',
      WaitAuth:     'routing',
      Idle:         'routing',
      Disconnecting:'routing',
      Dead:         'routing',
    };
    const calls = raw.map(c => ({
      ...c,
      clientName:  c.user || c.accountId || undefined,
      ccState:     c.status,                                          // full CC_STATE string
      callStatus:  ccStateMap[c.status] ?? (c.status?.toLowerCase().includes('connect') ? 'connected' : 'routing'),
    }));
    res.json({ calls });
  });

  // GET /api/sippy/monitoring/acd-asr — ACD/ASR time-series from Sippy monitoring API
  app.get('/api/sippy/monitoring/acd-asr', async (req, res) => {
    try {
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      // Default: last 24 h, 5-min resolution (300 s), total (root env)
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

      // Try acd_asr_total first (root/aggregate) then fall back to acd_asr per-env
      let result = await sippy.getSippyMonitoringData(username, password, 'acd_asr_total', {
        startDate: sippyDate,
        interval: hoursBack * 3600,
      });
      let graphType = 'acd_asr_total';
      if (!result.ok || !result.points.length) {
        // Fall back to acd_asr (per-environment or all-env without i_environment)
        result = await sippy.getSippyMonitoringData(username, password, 'acd_asr', {
          startDate: sippyDate,
          interval: hoursBack * 3600,
          ...(iEnv ? { iEnvironment: iEnv } : {}),
        });
        graphType = 'acd_asr';
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
        portalUrl:    settings.portalUrl ?? '',
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

  // POST /api/sippy/customers/:iCustomer/disconnect — disconnect all calls for a customer (since 5.2)
  app.post('/api/sippy/customers/:iCustomer/disconnect', async (req: any, res) => {
    const iCustomer = parseInt(req.params.iCustomer, 10);
    if (isNaN(iCustomer)) return res.status(400).json({ success: false, message: 'Invalid i_customer.' });
    const settings = await storage.getSettings();
    const { username, password } = sippyXmlCreds(settings);
    const result = await sippy.disconnectSippyCustomer(iCustomer, username, password);
    res.json(result);
  });

  // GET /api/sippy/call-stats — lightweight active call count summary (getAccountCallStats)
  app.get('/api/sippy/call-stats', async (_req, res) => {
    const settings = await storage.getSettings();
    const { username, password } = sippyXmlCreds(settings);
    const result = await sippy.getSippyCallStats(username, password);
    res.json(result);
  });

  // GET /api/sippy/cdr — CDR records from Sippy
  // Query params: limit, startDate (ISO/Sippy), endDate, iCustomer, iAccount, type, cli, cld, offset
  app.get('/api/sippy/cdr', async (req, res) => {
    try {
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const limit  = Number(req.query.limit)  || 50;
      const offset = req.query.offset ? Number(req.query.offset) : undefined;
      const opts: Parameters<typeof sippy.getSippyCDRs>[3] = {};
      if (req.query.startDate) opts.startDate = req.query.startDate as string;
      if (req.query.endDate)   opts.endDate   = req.query.endDate   as string;
      if (req.query.iCustomer) opts.iCustomer = Number(req.query.iCustomer);
      if (req.query.iAccount)  opts.iAccount  = Number(req.query.iAccount);
      if (req.query.type)      opts.type       = req.query.type      as string;
      if (req.query.cli)       opts.cli        = req.query.cli       as string;
      if (req.query.cld)       opts.cld        = req.query.cld       as string;
      if (offset !== undefined) opts.offset    = offset;
      const cdrs = await sippy.getSippyCDRs(username, password, limit, opts);
      res.json({ cdrs });
    } catch (e: any) { res.status(500).json({ cdrs: [], error: e.message }); }
  });

  // GET /api/sippy/asr-report — ASR/ACD report computed from Sippy CDRs
  app.get('/api/sippy/asr-report', async (req, res) => {
    try {
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const limit  = Number(req.query.limit) || 2000;
      // groupBy: 'caller' (CLI) | 'callee' (CLD) | 'country' | 'destination' (area_name)
      const groupBy = (req.query.groupBy as string) || 'caller';
      const opts: Parameters<typeof sippy.getSippyCDRs>[3] = {};
      if (req.query.startDate) opts.startDate = req.query.startDate as string;
      if (req.query.endDate)   opts.endDate   = req.query.endDate   as string;
      if (req.query.cli)       opts.cli       = req.query.cli as string;
      if (req.query.cld)       opts.cld       = req.query.cld as string;
      // Fetch CDRs in trusted mode — customer 1 = root sees all
      const cdrs = await sippy.getSippyCDRs(username, password, limit, { ...opts });
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
      let portalUrl: string | undefined = (req.query.inlineUrl as string) || settings.portalUrl || undefined;
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
      let portalUrl: string | undefined = (req.query.inlineUrl as string) || settings.portalUrl || undefined;
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
      let portalUrl: string | undefined = settings.portalUrl || undefined;
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
      let { username, password } = sippyXmlCreds(settings);
      username = (req.query.inlineUser as string) || username;
      password = (req.query.inlinePass as string) || password;
      let portalUrl: string | undefined = (req.query.inlineUrl as string) || settings.portalUrl || undefined;
      if (req.query.switchId) {
        const sw = (await storage.getSwitches()).find((s: any) => s.id === Number(req.query.switchId) && s.type === 'sippy');
        if (sw) { ({ username, password } = sippyXmlCreds(settings, sw)); portalUrl = sw.portalUrl ?? undefined; }
      }
      const result = await sippy.listSippyBillingPlans(username, password, portalUrl);
      res.json(result);
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
        targetUrl = settings.portalUrl ?? undefined;
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

      if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Sippy credentials are required. Enter your Sippy URL, username, and password in the form above.' });
      }
      if (!targetUrl) {
        return res.status(400).json({ success: false, message: 'Sippy URL is required. Enter your Sippy switch URL in the form above.' });
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
      const result = await sippy.pushAccountToSippy(opts, { username, password }, targetUrl);
      res.json(result);
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

  // ASR/ACD Report — per-client breakdown
  app.get('/api/reports/asr-acd', async (req, res) => {
    try {
      const {
        cli, cld, startTime, endTime,
        groupBy, sortBy, hideEmpty,
      } = req.query as Record<string, string>;

      const rows = await storage.getAsrAcdReport({
        cliFilter: cli || undefined,
        cldFilter: cld || undefined,
        startTime: startTime || undefined,
        endTime: endTime || undefined,
        groupBy: (groupBy as 'caller' | 'callee') || 'caller',
        sortBy: (sortBy as any) || 'totalCalls',
        hideEmpty: hideEmpty !== 'false',
      });
      res.json(rows);
    } catch (err) {
      console.error('ASR/ACD report error:', err);
      res.status(500).json({ message: 'Failed to generate report' });
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
      let portalUrl = settings.portalUrl ?? undefined;
      let u = settings.portalUsername ?? '';
      let p = settings.portalPassword ?? '';
      if (switchId) {
        const sw = (await storage.getSwitches()).find(s => s.id === switchId);
        if (sw) { portalUrl = sw.portalUrl ?? undefined; u = sw.portalUsername ?? ''; p = sw.portalPassword ?? ''; }
      }
      if (!tariffId) return res.json({ rates: [], error: 'tariffId required' });
      const result = await sippy.getSippyRateList(u, p, tariffId, portalUrl);
      res.json(result);
    } catch (e: any) { res.status(500).json({ rates: [], error: e.message }); }
  });

  // POST /api/sippy/rates — add or update a single rate entry
  app.post('/api/sippy/rates', async (req, res) => {
    try {
      const settings = await storage.getSettings();
      const { tariffId, prefix, rate, effectiveFrom, effectiveTill, switchId } = req.body;
      let portalUrl = settings.portalUrl ?? undefined;
      let u = settings.portalUsername ?? '';
      let p = settings.portalPassword ?? '';
      if (switchId) {
        const sw = (await storage.getSwitches()).find(s => s.id === switchId);
        if (sw) { portalUrl = sw.portalUrl ?? undefined; u = sw.portalUsername ?? ''; p = sw.portalPassword ?? ''; }
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
      let portalUrl = settings.portalUrl ?? undefined;
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

  // PATCH /api/sippy/customers/:id — update a customer
  app.patch('/api/sippy/customers/:id', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req, res) => {
    try {
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.updateSippyCustomer(username, password, parseInt(req.params.id, 10), req.body);
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
      const { username, password } = sippyXmlCreds(settings);
      const opts: { iCustomer?: number; offset?: number; limit?: number } = {};
      if (req.query.iCustomer) opts.iCustomer = parseInt(req.query.iCustomer as string, 10);
      if (req.query.offset)    opts.offset    = parseInt(req.query.offset    as string, 10);
      if (req.query.limit)     opts.limit     = parseInt(req.query.limit     as string, 10);
      const result = await sippy.listSippyAccounts(username, password, opts);
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

  // ── Vendor management (official Sippy API) ────────────────────────────────

  // PATCH /api/sippy/vendors/:id — update a vendor
  app.patch('/api/sippy/vendors/:id', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req, res) => {
    try {
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.updateSippyVendor(username, password, parseInt(req.params.id, 10), req.body);
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // DELETE /api/sippy/vendors/:id — delete a vendor
  app.delete('/api/sippy/vendors/:id', (req: any, res, next) => requireRole(['admin'], req, res, next), async (req, res) => {
    try {
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.deleteSippyVendor(username, password, parseInt(req.params.id, 10));
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ── Vendor listing (official Sippy API) ──────────────────────────────────

  // GET /api/sippy/vendors — list all vendors on Sippy (docs 107434)
  app.get('/api/sippy/vendors', async (req: any, res) => {
    try {
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const opts: Parameters<typeof sippy.listSippyVendors>[2] = {};
      if (req.query.limit)       opts.limit       = parseInt(req.query.limit       as string, 10);
      if (req.query.offset)      opts.offset      = parseInt(req.query.offset      as string, 10);
      if (req.query.namePattern) opts.namePattern = req.query.namePattern as string;
      const result = await sippy.listSippyVendors(username, password, opts);
      res.json(result);
    } catch (e: any) { res.status(500).json({ vendors: [], error: e.message }); }
  });

  // ── Vendor connections (official Sippy API docs 107435) ───────────────────

  // GET /api/sippy/vendors/:id/connections — list connections for a vendor
  app.get('/api/sippy/vendors/:id/connections', async (req: any, res) => {
    try {
      const iVendor = parseInt(req.params.id, 10);
      if (isNaN(iVendor)) return res.status(400).json({ connections: [], error: 'Invalid i_vendor.' });
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.listVendorConnections(username, password, iVendor);
      res.json(result);
    } catch (e: any) { res.status(500).json({ connections: [], error: e.message }); }
  });

  // POST /api/sippy/vendors/:id/connections — create a vendor connection
  // Body: name (required), destination (required), + optional fields
  app.post('/api/sippy/vendors/:id/connections', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req, res) => {
    try {
      const iVendor = parseInt(req.params.id, 10);
      if (isNaN(iVendor)) return res.status(400).json({ success: false, message: 'Invalid i_vendor.' });
      const { name, destination } = req.body;
      if (!name)        return res.status(400).json({ success: false, message: 'name is required.' });
      if (!destination) return res.status(400).json({ success: false, message: 'destination is required.' });
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.createVendorConnection(username, password, { iVendor, ...req.body });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // GET /api/sippy/connections/:id — get info for a single vendor connection
  app.get('/api/sippy/connections/:id', async (req: any, res) => {
    try {
      const iConnection = parseInt(req.params.id, 10);
      if (isNaN(iConnection)) return res.status(400).json({ success: false, error: 'Invalid i_connection.' });
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.getVendorConnectionInfo(username, password, iConnection);
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // PATCH /api/sippy/connections/:id — update a vendor connection
  app.patch('/api/sippy/connections/:id', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req, res) => {
    try {
      const iConnection = parseInt(req.params.id, 10);
      if (isNaN(iConnection)) return res.status(400).json({ success: false, message: 'Invalid i_connection.' });
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.updateVendorConnection(username, password, iConnection, req.body);
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // DELETE /api/sippy/connections/:id — delete a vendor connection
  app.delete('/api/sippy/connections/:id', (req: any, res, next) => requireRole(['admin'], req, res, next), async (req, res) => {
    try {
      const iConnection = parseInt(req.params.id, 10);
      if (isNaN(iConnection)) return res.status(400).json({ success: false, message: 'Invalid i_connection.' });
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.deleteVendorConnection(username, password, iConnection);
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
      res.json({ events });
    } catch (e: any) { res.status(500).json({ events: [], error: e.message }); }
  });

  // ── CDR ENRICHMENT ENDPOINT ───────────────────────────────────────────────
  // POST /api/enrich-cdr — enriches a batch of CDR records with country, trunk class, FAS, etc.
  // Used by the frontend to enhance CDR data from Sippy/VOS3000

  app.post('/api/enrich-cdr', async (req, res) => {
    try {
      const settings = await storage.getSettings();
      const cdrs: any[] = req.body.cdrs ?? [];
      const fasMinPdd = settings.fasMinPddSecs ?? 10;
      const fasMaxBill = settings.fasMaxBillSecs ?? 5;

      const enriched = cdrs.map(cdr => {
        const result = enrichCdr({
          caller: cdr.caller ?? cdr.cli ?? '',
          callee: cdr.callee ?? cdr.cld ?? '',
          sipCode: cdr.sipCode ?? cdr.disconnect_code ?? null,
          pddSecs: cdr.pdd ?? null,
          billSecs: cdr.billSecs ?? cdr.billed_duration ?? null,
          fasMinPddSecs: fasMinPdd,
          fasMaxBillSecs: fasMaxBill,
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
      const info = await sippy.getAccountInfo(username, password, settings.portalUrl ?? '', iAccount, undefined, iCustomer);
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
      const info = await sippy.getAccountInfo(username, password, settings.portalUrl ?? '', iAccount);
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
      const result = await sippy.blockWebUser(username, password, iWebUser, { iCustomer, portalUrl: settings.portalUrl ?? '' });
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
      const result = await sippy.unblockWebUser(username, password, iWebUser, { iCustomer, portalUrl: settings.portalUrl ?? '' });
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
        portalUrl: settings.portalUrl ?? '',
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
      const result = await sippy.addDestinationSet(username, password, { name, currency, ...rest, portalUrl: settings.portalUrl ?? '' });
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
      const result = await sippy.getDestinationSetInfo(username, password, { iDestinationSet, includeAllFields, portalUrl: settings.portalUrl ?? '' });
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
      const result = await sippy.updateDestinationSet(username, password, iDestinationSet, { ...req.body, portalUrl: settings.portalUrl ?? '' });
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
      const result = await sippy.deleteDestinationSet(username, password, iDestinationSet, { portalUrl: settings.portalUrl ?? '' });
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
      const result = await sippy.getDestinationSetRoutesList(username, password, iDestinationSet, { portalUrl: settings.portalUrl ?? '' });
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
      const result = await sippy.addRouteToDestinationSet(username, password, iDestinationSet, prefix, { ...rest, portalUrl: settings.portalUrl ?? '' });
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
      const result = await sippy.updateRouteInDestinationSet(username, password, iDestinationSet, prefix, { ...req.body, portalUrl: settings.portalUrl ?? '' });
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
      const result = await sippy.deleteAllRoutesInDestinationSet(username, password, iDestinationSet, { portalUrl: settings.portalUrl ?? '' });
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
      const result = await sippy.delRouteFromDestinationSet(username, password, iDestinationSet, prefix, { portalUrl: settings.portalUrl ?? '' });
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
        from, to, cc, bcc, subject, body: emailBody, portalUrl: settings.portalUrl ?? '',
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
        portalUrl: settings.portalUrl ?? '',
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
      const result = await sippy.getServicePlanInfo(username, password, iBillingPlan, { iCustomer, portalUrl: settings.portalUrl ?? '' });
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
      const result = await sippy.applyTranslationRule(username, password, rule, number ?? '', { portalUrl: settings.portalUrl ?? '' });
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
      const result = await sippy.checkMatchRule(username, password, rule, number ?? '', { portalUrl: settings.portalUrl ?? '' });
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
      const { username, password } = sippyXmlCreds(settings);
      const { did, incomingDid, delegatedTo, iAccount, iIvrApplication, notAssigned, offset, limit } = req.query as any;
      const result = await sippy.getDIDsList(username, password, {
        did,
        incomingDid,
        delegatedTo:     delegatedTo    ? parseInt(delegatedTo, 10)    : undefined,
        iAccount:        iAccount       ? parseInt(iAccount, 10)       : undefined,
        iIvrApplication: iIvrApplication ? parseInt(iIvrApplication, 10) : undefined,
        notAssigned:     notAssigned === 'true' ? true : (notAssigned === 'false' ? false : undefined),
        offset:          offset         ? parseInt(offset, 10)         : undefined,
        limit:           limit          ? parseInt(limit, 10)          : undefined,
        portalUrl:       settings.portalUrl ?? '',
      });
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
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.getDIDChargingGroupInfo(username, password, id, { portalUrl: settings.portalUrl ?? '' });
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
      const { username, password } = sippyXmlCreds(settings);
      const { iDidsChargingGroup, delegatedTo, description } = req.body ?? {};
      const result = await sippy.updateDIDDelegation(username, password, id, {
        iDidsChargingGroup: iDidsChargingGroup !== undefined ? parseInt(iDidsChargingGroup, 10) : undefined,
        delegatedTo:        delegatedTo        !== undefined ? parseInt(delegatedTo, 10)        : undefined,
        description,
        portalUrl: settings.portalUrl ?? '',
      });
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
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.deleteDIDDelegation(username, password, id, { portalUrl: settings.portalUrl ?? '' });
      if (!result.success) return res.status(422).json({ success: false, error: result.message });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // GET /api/sippy/dids/:id — get DID info by i_did (integer) or did string
  app.get('/api/sippy/dids/:id', async (req: any, res) => {
    try {
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const rawId = req.params.id;
      const numId = parseInt(rawId, 10);
      const opts = isNaN(numId)
        ? { did: rawId, didRangeEnd: req.query.didRangeEnd as string | undefined, portalUrl: settings.portalUrl ?? '' }
        : { iDid: numId, portalUrl: settings.portalUrl ?? '' };
      const result = await sippy.getDIDInfo(username, password, opts);
      if (!result.success) return res.status(404).json({ success: false, error: result.message });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // POST /api/sippy/dids — add a DID
  app.post('/api/sippy/dids', async (req: any, res) => {
    try {
      const { did, incomingDid, ...rest } = req.body ?? {};
      if (!did || !incomingDid) return res.status(400).json({ success: false, error: 'did and incomingDid are required.' });
      const settings = await storage.getSippySettings();
      if (!settings) return res.status(503).json({ success: false, error: 'Sippy not configured.' });
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.addDID(username, password, did, incomingDid, { ...rest, portalUrl: settings.portalUrl ?? '' });
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
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.updateDID(username, password, { iDid, ...req.body, portalUrl: settings.portalUrl ?? '' });
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
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.deleteDID(username, password, { iDid, portalUrl: settings.portalUrl ?? '' });
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
      const { username, password } = sippyXmlCreds(settings);
      const result = await sippy.addDIDDelegation(username, password, {
        iDid,
        delegatedTo:          parseInt(delegatedTo, 10),
        parentIDidDelegation: parentIDidDelegation === null ? null : parseInt(parentIDidDelegation, 10),
        iDidsChargingGroup:   iDidsChargingGroup !== undefined ? parseInt(iDidsChargingGroup, 10) : undefined,
        description,
        portalUrl: settings.portalUrl ?? '',
      });
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
        portalUrl: settings.portalUrl ?? '',
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
      const result = await sippy.deleteConference(username, password, iAccount, iConference, { iCustomer, portalUrl: settings.portalUrl ?? '' });
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
        portalUrl: settings.portalUrl ?? '',
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
      const result = await sippy.dumpIPTrafficStatus(username, password, id, { portalUrl: settings.portalUrl ?? '' });
      if (!result.success) return res.status(422).json({ success: false, error: result.message });
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  return httpServer;
}
