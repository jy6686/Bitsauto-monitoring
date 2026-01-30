
import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { setupAuth, registerAuthRoutes } from "./replit_integrations/auth";

// Simulation Constants
const SIMULATION_INTERVAL = 2000; // 2 seconds
const MAX_ACTIVE_CALLS = 10;
const CALL_DURATION_PROBABILITY = 0.1; // 10% chance to end a call each tick

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Auth Setup
  await setupAuth(app);
  registerAuthRoutes(app);

  // === SIMULATION ENGINE ===
  setInterval(async () => {
    const settings = await storage.getSettings();
    if (!settings.simulationEnabled) return;

    // 1. Manage Active Calls (Create/End)
    const calls = await storage.getCalls(100);
    const activeCalls = calls.filter(c => c.status === 'active');

    // End random calls
    for (const call of activeCalls) {
      if (Math.random() < CALL_DURATION_PROBABILITY) {
        await storage.endCall(call.id);
      }
    }

    // Start new calls if below max
    if (activeCalls.length < MAX_ACTIVE_CALLS) {
      const newCallsNeeded = MAX_ACTIVE_CALLS - activeCalls.length;
      if (newCallsNeeded > 0 && Math.random() > 0.3) {
        const caller = `+1${Math.floor(Math.random() * 9000000000) + 1000000000}`;
        const callee = `+1${Math.floor(Math.random() * 9000000000) + 1000000000}`;
        await storage.createCall({
          caller,
          callee,
          direction: Math.random() > 0.5 ? 'inbound' : 'outbound',
          status: 'active'
        });
      }
    }

    // 2. Generate Metrics for Active Calls
    const currentActiveCalls = (await storage.getCalls(100)).filter(c => c.status === 'active');
    
    for (const call of currentActiveCalls) {
      // Simulate Jitter (0-50ms usually, spikes occasionally)
      let jitter = Math.random() * 20; // Normal jitter
      if (Math.random() > 0.9) jitter += 50; // Spike

      // Simulate Latency (20-100ms usually)
      let latency = 20 + Math.random() * 80;
      if (Math.random() > 0.95) latency += 200; // Spike

      // Simulate Packet Loss (0-1% usually)
      let packetLoss = Math.random() * 0.5;
      if (Math.random() > 0.95) packetLoss += 5; // Spike

      // Calculate MOS (Mean Opinion Score)
      // Simplified formula: MOS = 4.4 - 0.024*latency - 0.1*jitter - 2.5*packetLoss
      // Capped between 1 and 5
      let rFactor = 94 - (latency / 20) - jitter - (packetLoss * 20);
      if (rFactor < 0) rFactor = 0;
      let mos = 1 + (0.035 * rFactor) + (rFactor * (rFactor - 60) * (100 - rFactor) * 0.000007);
      if (mos > 4.5) mos = 4.5; // Cap at realistic max
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
    }
  }, SIMULATION_INTERVAL);


  // === API ROUTES ===

  // Dashboard Stats
  app.get(api.dashboard.stats.path, async (req, res) => {
    const stats = await storage.getDashboardStats();
    res.json(stats);
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
    // In a real app, this might clear tables or reset simulation state
    // For now, we'll just acknowledge
    res.json({ message: "Simulation reset (not fully implemented in MVP logic but acknowledged)" });
  });

  return httpServer;
}
