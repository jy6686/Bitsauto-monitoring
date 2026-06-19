/**
 * Route Testing Engine — REST API routes
 * GET  /api/route-tests/jobs             — list all test jobs
 * POST /api/route-tests/jobs             — create a new test job
 * GET  /api/route-tests/jobs/:id         — get a single job
 * PATCH /api/route-tests/jobs/:id        — update (enable/disable, schedule)
 * DELETE /api/route-tests/jobs/:id       — delete a job
 * POST /api/route-tests/run/:id          — trigger a job immediately
 * GET  /api/route-tests/results          — list results (optional ?jobId=&limit=)
 * GET  /api/route-tests/evidence         — Copilot test evidence summary
 * GET  /api/route-tests/trend            — hourly pass-rate time series for 24h (?jobId=&vendorName=)
 * GET  /api/route-tests/cli-health       — 7-day CLI integrity pass rate per vendor
 */

import type { Express } from "express";
import { db } from "./db";
import { routeTestJobs, routeTestResults } from "../shared/schema";
import { eq, desc, and, gte } from "drizzle-orm";
import { executeRouteTestJob, loadRouteTestEvidence, loadCliHealthSummary } from "./services/route-tester";

type RequireRoleFn = (roles: string[], req: any, res: any, next: any) => void;

export function registerRouteTestRoutes(app: Express, requireRole: RequireRoleFn): void {

  // ── GET /api/route-tests/jobs ──────────────────────────────────────────────
  app.get("/api/route-tests/jobs",
    (req: any, res: any, next: any) => requireRole(["admin", "management", "routing_admin"], req, res, next),
    async (_req: any, res: any) => {
      try {
        const jobs = await db.select().from(routeTestJobs).orderBy(desc(routeTestJobs.createdAt));
        res.json({ success: true, data: jobs });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

  // ── POST /api/route-tests/jobs ────────────────────────────────────────────
  app.post("/api/route-tests/jobs",
    (req: any, res: any, next: any) => requireRole(["admin", "management", "routing_admin"], req, res, next),
    async (req: any, res: any) => {
      try {
        const { name, destinationPrefix, vendorIds, vendorNames, scheduleMinutes, enabled, cliToSend } = req.body ?? {};
        if (!name || !destinationPrefix) {
          return res.status(400).json({ success: false, error: "name and destinationPrefix are required" });
        }
        const schedMins = Number(scheduleMinutes ?? 0);
        const nextRunAt = schedMins > 0 ? new Date(Date.now() + schedMins * 60_000) : null;

        const [job] = await db.insert(routeTestJobs).values({
          name,
          destinationPrefix,
          vendorIds:       Array.isArray(vendorIds) ? vendorIds : [],
          vendorNames:     Array.isArray(vendorNames) ? vendorNames : [],
          scheduleMinutes: schedMins,
          enabled:         enabled !== false,
          cliToSend:       cliToSend?.trim() || null,
          createdBy:       req.user?.name ?? req.user?.username ?? "system",
          nextRunAt,
        }).returning();

        res.json({ success: true, data: job });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

  // ── PATCH /api/route-tests/jobs/:id ──────────────────────────────────────
  app.patch("/api/route-tests/jobs/:id",
    (req: any, res: any, next: any) => requireRole(["admin", "management", "routing_admin"], req, res, next),
    async (req: any, res: any) => {
      try {
        const id = Number(req.params.id);
        const { enabled, scheduleMinutes, name, destinationPrefix, vendorIds, vendorNames, cliToSend } = req.body ?? {};
        const update: Record<string, any> = {};
        if (enabled !== undefined)         update.enabled = enabled;
        if (scheduleMinutes !== undefined) {
          update.scheduleMinutes = Number(scheduleMinutes);
          update.nextRunAt = update.scheduleMinutes > 0
            ? new Date(Date.now() + update.scheduleMinutes * 60_000)
            : null;
        }
        if (name !== undefined)              update.name = name;
        if (destinationPrefix !== undefined) update.destinationPrefix = destinationPrefix;
        if (vendorIds !== undefined)         update.vendorIds = vendorIds;
        if (vendorNames !== undefined)       update.vendorNames = vendorNames;
        if (cliToSend !== undefined)         update.cliToSend = cliToSend?.trim() || null;

        const [job] = await db.update(routeTestJobs).set(update).where(eq(routeTestJobs.id, id)).returning();
        if (!job) return res.status(404).json({ success: false, error: "Job not found" });
        res.json({ success: true, data: job });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

  // ── DELETE /api/route-tests/jobs/:id ─────────────────────────────────────
  app.delete("/api/route-tests/jobs/:id",
    (req: any, res: any, next: any) => requireRole(["admin", "management"], req, res, next),
    async (req: any, res: any) => {
      try {
        const id = Number(req.params.id);
        await db.delete(routeTestResults).where(eq(routeTestResults.jobId, id));
        await db.delete(routeTestJobs).where(eq(routeTestJobs.id, id));
        res.json({ success: true });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

  // ── POST /api/route-tests/run/:id ─────────────────────────────────────────
  app.post("/api/route-tests/run/:id",
    (req: any, res: any, next: any) => requireRole(["admin", "management", "routing_admin"], req, res, next),
    async (req: any, res: any) => {
      try {
        const id = Number(req.params.id);
        const result = await executeRouteTestJob(id);
        res.json({ success: true, ...result });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

  // ── GET /api/route-tests/results ──────────────────────────────────────────
  app.get("/api/route-tests/results",
    (req: any, res: any, next: any) => requireRole(["admin", "management", "routing_admin", "noc_operator"], req, res, next),
    async (req: any, res: any) => {
      try {
        const jobId  = req.query.jobId  ? Number(req.query.jobId)  : undefined;
        const limit  = Math.min(Number(req.query.limit  ?? 100), 500);
        const since  = req.query.since  ? new Date(req.query.since as string) : undefined;

        const conditions: any[] = [];
        if (jobId) conditions.push(eq(routeTestResults.jobId, jobId));
        if (since) conditions.push(gte(routeTestResults.startedAt, since));

        const rows = await db.select().from(routeTestResults)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(routeTestResults.startedAt))
          .limit(limit);

        res.json({ success: true, data: rows });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

  // ── GET /api/route-tests/evidence ────────────────────────────────────────
  app.get("/api/route-tests/evidence",
    (req: any, res: any, next: any) => requireRole(["admin", "management", "routing_admin", "noc_operator"], req, res, next),
    async (req: any, res: any) => {
      try {
        const hours = Math.min(Number(req.query.hours ?? 6), 48);
        const evidence = await loadRouteTestEvidence(hours);
        res.json({ success: true, data: evidence });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

  // ── GET /api/route-tests/cli-health ──────────────────────────────────────
  // Returns 7-day CLI integrity pass rate per vendor (only for jobs with cliToSend set).
  app.get("/api/route-tests/cli-health",
    (req: any, res: any, next: any) => requireRole(["admin", "management", "routing_admin", "noc_operator"], req, res, next),
    async (_req: any, res: any) => {
      try {
        const data = await loadCliHealthSummary();
        res.json({ success: true, data });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

  // ── GET /api/route-tests/trend ────────────────────────────────────────────
  app.get("/api/route-tests/trend",
    (req: any, res: any, next: any) => requireRole(["admin", "management", "routing_admin", "noc_operator"], req, res, next),
    async (req: any, res: any) => {
      try {
        const jobId      = req.query.jobId      ? Number(req.query.jobId)         : undefined;
        const vendorName = req.query.vendorName ? String(req.query.vendorName)     : undefined;
        const hoursBack  = Math.min(Number(req.query.hours ?? 24), 72);
        const since      = new Date(Date.now() - hoursBack * 60 * 60_000);

        const conditions: any[] = [gte(routeTestResults.startedAt, since)];
        if (jobId)      conditions.push(eq(routeTestResults.jobId, jobId));

        const rows = await db.select().from(routeTestResults)
          .where(and(...conditions))
          .orderBy(desc(routeTestResults.startedAt));

        const filtered = vendorName
          ? rows.filter(r => r.vendorName?.toLowerCase() === vendorName.toLowerCase())
          : rows;

        const buckets = new Map<string, { passed: number; total: number }>();
        const nowHour = new Date();
        nowHour.setMinutes(0, 0, 0);
        for (let i = hoursBack - 1; i >= 0; i--) {
          const t = new Date(nowHour.getTime() - i * 60 * 60_000);
          buckets.set(t.toISOString(), { passed: 0, total: 0 });
        }

        for (const r of filtered) {
          const d = new Date(r.startedAt);
          d.setMinutes(0, 0, 0);
          const key = d.toISOString();
          if (!buckets.has(key)) continue;
          const b = buckets.get(key)!;
          b.total++;
          if (r.connected) b.passed++;
        }

        const data = Array.from(buckets.entries()).map(([hour, b]) => ({
          hour,
          passRate: b.total > 0 ? Math.round((b.passed / b.total) * 100) : null,
          passed:   b.passed,
          total:    b.total,
        }));

        res.json({ success: true, data });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
      }
    });
}
