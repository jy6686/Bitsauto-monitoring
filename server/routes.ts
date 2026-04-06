
import type { Express } from "express";
import { createServer, type Server } from "http";
import * as net from "net";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { setupAuth, registerAuthRoutes } from "./replit_integrations/auth";
import * as vos3000 from "./vos3000";
import * as sippy from "./sippy";

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

// In-memory store for latest IP probe result
let lastProbeResult: { latency: number; reachable: boolean; port?: number; host?: string; timestamp: Date } | null = null;

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Auth Setup
  await setupAuth(app);
  registerAuthRoutes(app);

  // === IP PROBE ENGINE ===
  // Runs independently to measure real latency to the monitored IP
  async function runIpProbe() {
    const settings = await storage.getSettings();
    const raw = settings.monitoredIp;
    if (!raw) return;
    // Strip protocol / path from the monitored IP so net.Socket can connect
    const { host, explicitPort } = normalizeMonitoredIp(raw);
    if (!host) return;
    // Priority ports: any port in the monitoredIp value + any port in portalUrl
    const portalPort = portFromUrl(settings.portalUrl);
    const priorityPorts = [explicitPort, portalPort].filter((p): p is number => p !== null);
    const result = await probeIp(host, priorityPorts);
    lastProbeResult = { ...result, host, timestamp: new Date() };
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
      if (s.portalUrl && s.portalUsername && s.portalPassword && s.switchType === 'sippy') {
        console.log('[startup] Sippy credentials found — attempting auto-connect to portal...');
        const result = await sippy.connectSippy(s.portalUrl, s.portalUsername, s.portalPassword);
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
  (async () => {
    try {
      const s = await storage.getSettings();
      if (s.portalSessionToken && s.portalSessionBase && s.portalSessionUser) {
        vos3000.restoreSession(s.portalSessionToken, s.portalSessionBase, s.portalSessionUser);
        console.log('[startup] VOS3000 session restored for', s.portalSessionUser);
        // End any stale "active" calls from the previous session so sync starts clean
        const staleCalls = await storage.getCalls(500);
        for (const c of staleCalls) {
          if (c.status === 'active') {
            await storage.endCall(c.id, 'completed');
          }
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

  // Run VOS3000 live sync immediately and every 15 seconds
  setTimeout(runVos3000Sync, 3000); // small delay to let startup restore settle
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
    // Return the normalised host so the UI shows a clean IP/hostname
    const displayIp = raw ? normalizeMonitoredIp(raw).host : null;
    res.json({
      ip: displayIp,
      rawIp: raw,
      ...lastProbeResult,
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
    const result = await sippy.testSippyConnection(url, username ?? '', password ?? '');
    res.json(result);
  });

  // POST /api/sippy/connect — authenticate and store session
  app.post('/api/sippy/connect', async (req, res) => {
    const settings = await storage.getSettings();
    const { portalUrl, portalUsername, portalPassword } = settings;
    if (!portalUrl || !portalUsername || !portalPassword) {
      return res.status(400).json({ success: false, message: 'Portal credentials not saved in Settings.' });
    }
    const result = await sippy.connectSippy(portalUrl, portalUsername, portalPassword);
    res.json(result);
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

  // GET /api/sippy/live-calls — active calls from Sippy
  app.get('/api/sippy/live-calls', async (_req, res) => {
    const settings = await storage.getSettings();
    const raw = await sippy.getSippyActiveCalls(settings.portalUsername ?? '', settings.portalPassword ?? '');
    const calls = raw.map(c => ({
      ...c,
      clientName: c.user || c.accountId || undefined,
    }));
    res.json({ calls });
  });

  // GET /api/sippy/cdr — CDR records from Sippy
  app.get('/api/sippy/cdr', async (req, res) => {
    const settings = await storage.getSettings();
    const limit = Number(req.query.limit) || 50;
    const cdrs = await sippy.getSippyCDRs(settings.portalUsername ?? '', settings.portalPassword ?? '', limit);
    res.json({ cdrs });
  });

  // GET /api/sippy/routing-groups — list routing groups from Sippy
  app.get('/api/sippy/routing-groups', async (req: any, res) => {
    try {
      const settings = await storage.getSettings();
      // Prefer dedicated admin API credentials for XML-RPC; fall back to portal creds
      let username = (req.query.inlineUser as string) || settings.apiAdminUsername || settings.portalUsername || '';
      let password = (req.query.inlinePass as string) || settings.apiAdminPassword || settings.portalPassword || '';
      let portalUrl: string | undefined = (req.query.inlineUrl as string) || settings.portalUrl || undefined;
      if (req.query.switchId) {
        const sw = (await storage.getSwitches()).find((s: any) => s.id === Number(req.query.switchId) && s.type === 'sippy');
        if (sw) { username = sw.portalUsername ?? ''; password = sw.portalPassword ?? ''; portalUrl = sw.portalUrl ?? undefined; }
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
      // Prefer dedicated admin API credentials for XML-RPC; fall back to portal creds
      let username = (req.query.inlineUser as string) || settings.apiAdminUsername || settings.portalUsername || '';
      let password = (req.query.inlinePass as string) || settings.apiAdminPassword || settings.portalPassword || '';
      let portalUrl: string | undefined = (req.query.inlineUrl as string) || settings.portalUrl || undefined;
      if (req.query.switchId) {
        const sw = (await storage.getSwitches()).find((s: any) => s.id === Number(req.query.switchId) && s.type === 'sippy');
        if (sw) { username = sw.portalUsername ?? ''; password = sw.portalPassword ?? ''; portalUrl = sw.portalUrl ?? undefined; }
      }
      const result = await sippy.listSippyTariffs(username, password, portalUrl);
      res.json(result);
    } catch (err: any) {
      res.json({ tariffs: [], error: err.message });
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
        // Prefer dedicated admin API credentials for XML-RPC; fall back to portal creds
        username = settings.apiAdminUsername || settings.portalUsername || '';
        password = settings.apiAdminPassword || settings.portalPassword || '';
        targetUrl = settings.portalUrl ?? undefined;
        if (req.body.switchId) {
          const sw = (await storage.getSwitches()).find((s: any) => s.id === Number(req.body.switchId) && s.type === 'sippy');
          if (!sw) return res.status(404).json({ success: false, message: 'Sippy switch not found.' });
          // For per-switch requests, use switch's own creds (no admin override)
          username = sw.portalUsername ?? '';
          password = sw.portalPassword ?? '';
          targetUrl = sw.portalUrl ?? undefined;
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
        username:           req.body.username   || undefined,
        authname:           req.body.authname   || undefined,
        voipPassword:       req.body.voipPassword || undefined,
        webPassword:        req.body.webPassword  || undefined,
        // Network
        ipAddress:          req.body.ipAddress,
        ratePerMin:         req.body.ratePerMin !== undefined ? Number(req.body.ratePerMin) : undefined,
        // Billing
        creditLimit:        req.body.creditLimit !== undefined ? Number(req.body.creditLimit) : undefined,
        balance:            req.body.balance     !== undefined ? Number(req.body.balance)     : undefined,
        // Advanced
        maxSessions:        req.body.maxSessions !== undefined ? Number(req.body.maxSessions) : undefined,
        maxCallsPerSecond:  req.body.maxCallsPerSecond !== undefined ? Number(req.body.maxCallsPerSecond) : undefined,
        maxSessionTime:     req.body.maxSessionTime !== undefined ? Number(req.body.maxSessionTime) : undefined,
        timezone:           req.body.timezone,
        language:           req.body.language,
        routingGroup:       req.body.routingGroup,
        servicePlan:        req.body.servicePlan,
        cliTranslationRule: req.body.cliTranslationRule,
        cldTranslationRule: req.body.cldTranslationRule,
        // Contact
        companyName:        req.body.companyName,
        email:              req.body.email || undefined,
        description:        req.body.description,
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
    const stats = await sippy.getSippyStats(settings.portalUsername ?? '', settings.portalPassword ?? '');
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
      const result = await sippy.updateSippyCustomer(
        settings.portalUsername ?? '',
        settings.portalPassword ?? '',
        parseInt(req.params.id, 10),
        req.body,
      );
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // DELETE /api/sippy/customers/:id — delete a customer
  app.delete('/api/sippy/customers/:id', (req: any, res, next) => requireRole(['admin'], req, res, next), async (req, res) => {
    try {
      const settings = await storage.getSettings();
      const result = await sippy.deleteSippyCustomer(
        settings.portalUsername ?? '',
        settings.portalPassword ?? '',
        parseInt(req.params.id, 10),
      );
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // POST /api/sippy/customers/:id/block — block a customer
  app.post('/api/sippy/customers/:id/block', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req, res) => {
    try {
      const settings = await storage.getSettings();
      const result = await sippy.blockSippyCustomer(
        settings.portalUsername ?? '',
        settings.portalPassword ?? '',
        parseInt(req.params.id, 10),
      );
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // POST /api/sippy/customers/:id/unblock — unblock a customer
  app.post('/api/sippy/customers/:id/unblock', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req, res) => {
    try {
      const settings = await storage.getSettings();
      const result = await sippy.unblockSippyCustomer(
        settings.portalUsername ?? '',
        settings.portalPassword ?? '',
        parseInt(req.params.id, 10),
      );
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ── Account management (official Sippy API) ───────────────────────────────

  // DELETE /api/sippy/accounts/:id — delete an account
  app.delete('/api/sippy/accounts/:id', (req: any, res, next) => requireRole(['admin'], req, res, next), async (req, res) => {
    try {
      const settings = await storage.getSettings();
      const result = await sippy.deleteSippyAccount(
        settings.portalUsername ?? '',
        settings.portalPassword ?? '',
        parseInt(req.params.id, 10),
      );
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ── Vendor management (official Sippy API) ────────────────────────────────

  // PATCH /api/sippy/vendors/:id — update a vendor
  app.patch('/api/sippy/vendors/:id', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req, res) => {
    try {
      const settings = await storage.getSettings();
      const result = await sippy.updateSippyVendor(
        settings.portalUsername ?? '',
        settings.portalPassword ?? '',
        parseInt(req.params.id, 10),
        req.body,
      );
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // DELETE /api/sippy/vendors/:id — delete a vendor
  app.delete('/api/sippy/vendors/:id', (req: any, res, next) => requireRole(['admin'], req, res, next), async (req, res) => {
    try {
      const settings = await storage.getSettings();
      const result = await sippy.deleteSippyVendor(
        settings.portalUsername ?? '',
        settings.portalPassword ?? '',
        parseInt(req.params.id, 10),
      );
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ── Tariff management (official Sippy API) ────────────────────────────────

  // POST /api/sippy/tariffs/create — create a new tariff
  app.post('/api/sippy/tariffs/create', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req, res) => {
    try {
      const settings = await storage.getSettings();
      const { name, currency, connectFee, freeSeconds } = req.body;
      if (!name || !currency) return res.status(400).json({ success: false, message: 'name and currency are required' });
      const result = await sippy.createSippyTariff(
        settings.portalUsername ?? '',
        settings.portalPassword ?? '',
        { name, currency, connectFee, freeSeconds },
      );
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  // DELETE /api/sippy/tariffs/:id — delete a tariff
  app.delete('/api/sippy/tariffs/:id', (req: any, res, next) => requireRole(['admin'], req, res, next), async (req, res) => {
    try {
      const settings = await storage.getSettings();
      const result = await sippy.deleteSippyTariff(
        settings.portalUsername ?? '',
        settings.portalPassword ?? '',
        parseInt(req.params.id, 10),
      );
      res.json(result);
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  return httpServer;
}
