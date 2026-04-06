
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

// SIP probe ports to try in order
const SIP_PORTS = [5060, 5061, 80, 443];

// Probe an IP address by attempting TCP connections and measuring round-trip time
// Returns latency in ms, or null if unreachable
function probeIp(ip: string): Promise<{ latency: number; reachable: boolean }> {
  return new Promise((resolve) => {
    let portIdx = 0;
    
    function tryPort(portIndex: number) {
      if (portIndex >= SIP_PORTS.length) {
        resolve({ latency: 999, reachable: false });
        return;
      }
      const port = SIP_PORTS[portIndex];
      const start = Date.now();
      const socket = new net.Socket();
      socket.setTimeout(2000);
      
      socket.connect(port, ip, () => {
        const latency = Date.now() - start;
        socket.destroy();
        resolve({ latency, reachable: true });
      });
      
      socket.on('timeout', () => {
        socket.destroy();
        tryPort(portIndex + 1);
      });
      
      socket.on('error', () => {
        socket.destroy();
        tryPort(portIndex + 1);
      });
    }
    
    tryPort(0);
  });
}

// In-memory store for latest IP probe result
let lastProbeResult: { latency: number; reachable: boolean; timestamp: Date } | null = null;

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
    const ip = settings.monitoredIp;
    if (!ip) return;
    const result = await probeIp(ip);
    lastProbeResult = { ...result, timestamp: new Date() };
  }
  // Run probe immediately on startup, then every 10 seconds
  runIpProbe();
  setInterval(runIpProbe, 10000);

  // === SIMULATION ENGINE ===
  setInterval(async () => {
    const settings = await storage.getSettings();
    if (!settings.simulationEnabled) return;

    const monitoredIp = settings.monitoredIp || null;

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
    res.json({
      ip: settings.monitoredIp || null,
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
    const calls = await sippy.getSippyActiveCalls(settings.portalUsername ?? '', settings.portalPassword ?? '');
    res.json({ calls });
  });

  // GET /api/sippy/cdr — CDR records from Sippy
  app.get('/api/sippy/cdr', async (req, res) => {
    const settings = await storage.getSettings();
    const limit = Number(req.query.limit) || 50;
    const cdrs = await sippy.getSippyCDRs(settings.portalUsername ?? '', settings.portalPassword ?? '', limit);
    res.json({ cdrs });
  });

  // GET /api/sippy/stats — Sippy call counters
  app.get('/api/sippy/stats', async (_req, res) => {
    const settings = await storage.getSettings();
    const stats = await sippy.getSippyStats(settings.portalUsername ?? '', settings.portalPassword ?? '');
    res.json(stats);
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

  return httpServer;
}
