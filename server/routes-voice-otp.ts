/**
 * Voice OTP Routes — Asterisk AMI integration
 * POST /api/voice-otp          — initiate OTP call
 * GET  /api/voice-otp/calls    — call log
 * GET  /api/voice-otp/status   — AMI connection health
 */
import type { Express } from 'express';
import { db } from './db';
import { voiceOtpCalls } from '@shared/schema';
import { originateOtpCall, pingAmi, isAmiConfigured } from './services/asterisk/index';
import { desc } from 'drizzle-orm';
import { broadcastVoiceOtpUpdate } from './noc-ws';

function requireAuth(req: any, res: any, next: any) {
  if (!req.isAuthenticated?.()) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

function maskOtp(otp: string): string {
  if (otp.length <= 2) return '**';
  return otp[0] + '*'.repeat(otp.length - 2) + otp[otp.length - 1];
}

export function registerVoiceOtpRoutes(app: Express) {

  // ── AMI status ───────────────────────────────────────────────────────────────
  app.get('/api/voice-otp/status', requireAuth, async (_req: any, res: any) => {
    if (!isAmiConfigured()) {
      return res.json({ connected: false, error: 'ASTERISK_AMI_SECRET not set' });
    }
    const result = await pingAmi();
    res.json({ connected: result.ok, latencyMs: result.latencyMs, error: result.error });
  });

  // ── Initiate OTP call ────────────────────────────────────────────────────────
  app.post('/api/voice-otp', requireAuth, async (req: any, res: any) => {
    const { to, otp, trunk, cli } = req.body ?? {};
    if (!to)  return res.status(400).json({ error: '"to" (destination number) is required' });
    if (!otp) return res.status(400).json({ error: '"otp" (digits to speak) is required' });
    if (!/^\d{4,8}$/.test(String(otp))) {
      return res.status(400).json({ error: 'OTP must be 4–8 numeric digits' });
    }
    if (!isAmiConfigured()) {
      return res.status(503).json({ error: 'Asterisk AMI not configured — add ASTERISK_AMI_SECRET to Replit Secrets' });
    }

    // Insert call record immediately so we have an ID
    const [row] = await db.insert(voiceOtpCalls).values({
      toNumber: String(to),
      otp:      maskOtp(String(otp)),
      trunk:    trunk ?? 'Sippy',
      status:   'initiated',
    }).returning();

    // Originate via AMI (non-blocking from client perspective)
    originateOtpCall({ to: String(to), otp: String(otp), trunk: trunk ?? 'Sippy', cli: cli ? String(cli) : undefined })
      .then(async (result) => {
        const status = result.success ? 'answered' : 'failed';
        console.log(`[voice-otp] call outcome → status=${status} reason=${result.reasonText ?? result.error ?? 'ok'} uniqueId=${result.uniqueId ?? 'none'}`);
        const asteriskId   = result.uniqueId ?? null;
        const errorMessage = result.error ?? result.reasonText ?? null;
        await db.update(voiceOtpCalls)
          .set({ status, asteriskId, errorMessage })
          .where(require('drizzle-orm').eq(voiceOtpCalls.id, row.id));
        broadcastVoiceOtpUpdate({ callId: row.id, status, asteriskId, errorMessage });
      })
      .catch((err) => {
        console.error('[voice-otp] AMI error:', err.message);
      });

    res.json({ ok: true, callId: row.id, message: 'Call initiated' });
  });

  // ── Call log ─────────────────────────────────────────────────────────────────
  app.get('/api/voice-otp/calls', requireAuth, async (req: any, res: any) => {
    try {
      const limit = Math.min(Number(req.query.limit ?? 50), 200);
      const rows  = await db.select().from(voiceOtpCalls)
        .orderBy(desc(voiceOtpCalls.initiatedAt))
        .limit(limit);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Stats ────────────────────────────────────────────────────────────────────
  app.get('/api/voice-otp/stats', requireAuth, async (_req: any, res: any) => {
    try {
      const { sql } = await import('drizzle-orm');
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const result = await db.execute(sql`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE status = 'answered' OR status = 'completed') AS success,
          COUNT(*) FILTER (WHERE status = 'failed')    AS failed,
          COUNT(*) FILTER (WHERE status = 'initiated') AS pending
        FROM voice_otp_calls
        WHERE initiated_at >= ${since}
      `);
      const row = result.rows?.[0] as any;
      res.json({
        callsToday:   Number(row?.total   ?? 0),
        successToday: Number(row?.success ?? 0),
        failedToday:  Number(row?.failed  ?? 0),
        pendingToday: Number(row?.pending ?? 0),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Hourly success-rate trend (last 24 h) ────────────────────────────────
  app.get('/api/voice-otp/stats/hourly', requireAuth, async (_req: any, res: any) => {
    try {
      const { sql } = await import('drizzle-orm');
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const result = await db.execute(sql`
        SELECT
          date_trunc('hour', initiated_at) AS hour,
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE status = 'answered' OR status = 'completed') AS success
        FROM voice_otp_calls
        WHERE initiated_at >= ${since}
        GROUP BY 1
        ORDER BY 1 ASC
      `);
      const rows = (result.rows ?? []) as { hour: string; total: string; success: string }[];
      const points = rows.map(r => {
        const total   = Number(r.total);
        const success = Number(r.success);
        return {
          hour:    r.hour,
          total,
          success,
          rate: total > 0 ? Math.round((success / total) * 100) : 0,
        };
      });
      res.json(points);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  console.log('[voice-otp] Routes registered');
}
