
import type { Express } from "express";
import { createServer, type Server } from "http";
import * as net from "net";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { setupAuth, registerAuthRoutes } from "./replit_integrations/auth";

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
