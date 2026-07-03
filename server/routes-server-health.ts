/**
 * Server Health Routes
 * Registered by server/routes.ts via registerServerHealthRoutes(app).
 * All routes require admin or management role.
 */

import type { Express } from 'express';
import {
  getLatestSnapshot,
  pollServerHealth,
  getSnapshotHistory,
  getCleanupPreview,
  executeDiskCleanup,
} from './services/asterisk/server-health-poller';

function requireRole(roles: string[], req: any, res: any, next: any) {
  if (!req.isAuthenticated?.() || !req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  return next();
}

export function registerServerHealthRoutes(app: Express): void {

  // ── GET /api/server-health/current ─────────────────────────────────────────
  // Returns the latest cached snapshot (no SSH call on this endpoint).
  app.get('/api/server-health/current',
    (req: any, res: any, next: any) => requireRole(['admin', 'management'], req, res, next),
    async (_req: any, res: any) => {
      try {
        const snap = getLatestSnapshot();
        if (!snap) {
          return res.json({ snapshot: null, message: 'Poller not yet initialised — first poll in ~10s' });
        }
        return res.json({ snapshot: snap });
      } catch (e: any) {
        return res.status(500).json({ error: e.message });
      }
    }
  );

  // ── POST /api/server-health/refresh ────────────────────────────────────────
  // Forces an immediate SSH poll (returns new snapshot).
  app.post('/api/server-health/refresh',
    (req: any, res: any, next: any) => requireRole(['admin', 'management'], req, res, next),
    async (_req: any, res: any) => {
      try {
        const snap = await pollServerHealth();
        return res.json({ snapshot: snap });
      } catch (e: any) {
        return res.status(500).json({ error: e.message });
      }
    }
  );

  // ── GET /api/server-health/history ─────────────────────────────────────────
  // Returns hourly-bucketed history for the last N days (default 7).
  app.get('/api/server-health/history',
    (req: any, res: any, next: any) => requireRole(['admin', 'management'], req, res, next),
    async (req: any, res: any) => {
      try {
        const days = Math.min(30, Math.max(1, parseInt(String(req.query.days ?? '7'), 10) || 7));
        const rows = await getSnapshotHistory(days);
        return res.json({ rows, days });
      } catch (e: any) {
        return res.status(500).json({ error: e.message });
      }
    }
  );

  // ── GET /api/server-health/cleanup-preview ─────────────────────────────────
  // SSH into server; calculates reclaimable disk space WITHOUT deleting anything.
  app.get('/api/server-health/cleanup-preview',
    (req: any, res: any, next: any) => requireRole(['admin', 'management'], req, res, next),
    async (_req: any, res: any) => {
      try {
        const preview = await getCleanupPreview();
        return res.json({ preview });
      } catch (e: any) {
        return res.status(500).json({ error: e.message });
      }
    }
  );

  // ── POST /api/server-health/cleanup-execute ────────────────────────────────
  // Runs the disk cleanup (truncate logs, clear /tmp). Admin only.
  app.post('/api/server-health/cleanup-execute',
    (req: any, res: any, next: any) => requireRole(['admin'], req, res, next),
    async (_req: any, res: any) => {
      try {
        const result = await executeDiskCleanup();
        return res.json({ ok: true, ...result });
      } catch (e: any) {
        return res.status(500).json({ ok: false, error: e.message });
      }
    }
  );
}
