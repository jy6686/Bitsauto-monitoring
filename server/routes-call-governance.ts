/**
 * Call Governance Routes
 * AMI-triggered vendor BYE at configurable timer + 120s audio replay to A-leg.
 * Registered by server/routes.ts via registerCallGovernanceRoutes(app).
 */

import type { Express } from 'express';
import { db } from './db';
import {
  callGovernanceRules, governedCalls, callGovernanceLogs,
} from '@shared/schema';
import { eq, desc, gte, and, sql } from 'drizzle-orm';
import { amiGovernance } from './services/asterisk/ami-governance';
import { storage } from './storage';

// ── Auth helpers ───────────────────────────────────────────────────────────────

function requireAuth(req: any, res: any, next: any) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  next();
}
async function requireAdmin(req: any, res: any, next: any) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  const userId = req.user.claims?.sub ?? req.user.id ?? req.user.userId;
  const role = await storage.getUserRole(userId).catch(() => null);
  if (!role || !['admin', 'super_admin'].includes(role)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  next();
}

// ── Timer registry ─────────────────────────────────────────────────────────────
// Maps governedCall.id → active setTimeout handle
const activeTimers = new Map<number, NodeJS.Timeout>();

// ── Governance engine ──────────────────────────────────────────────────────────

async function cutVendorLeg(
  governedCallId: number,
  channelB: string,
  channelA: string | null,
  recordingPath: string | null,
  triggerReason: string,
) {
  try {
    // 1. Send BYE to vendor channel
    await amiGovernance.hangup(channelB);

    // 2. Mark governed call as cut
    await db.update(governedCalls)
      .set({ byeSentAt: new Date(), triggerReason, status: 'cut' })
      .where(eq(governedCalls.id, governedCallId));

    // 3. Log the event
    await db.insert(callGovernanceLogs).values({
      governedCallId,
      eventType: 'vendor_bye',
      channel:   channelB,
      details:   `Vendor leg cut. Trigger: ${triggerReason}`,
    });

    // 4. Start playback on A-leg if recording exists
    if (recordingPath && channelA) {
      const ok = await amiGovernance.playback(channelA, recordingPath);
      if (ok) {
        await db.update(governedCalls)
          .set({ playbackStartedAt: new Date() })
          .where(eq(governedCalls.id, governedCallId));
        await db.insert(callGovernanceLogs).values({
          governedCallId,
          eventType: 'playback_started',
          channel:   channelA,
          details:   `120s recording playback started: ${recordingPath}`,
        });
      }
    }

    console.log(`[call-governance] Vendor leg cut for governed call ${governedCallId} (${triggerReason})`);
  } catch (err: any) {
    console.error('[call-governance] cutVendorLeg error:', err?.message);
    await db.insert(callGovernanceLogs).values({
      governedCallId,
      eventType: 'error',
      details:   `cutVendorLeg failed: ${err?.message}`,
    }).catch(() => {});
  }
}

async function scheduleGovernedCallCut(
  gc: { id: number; channelA: string | null; channelB: string | null; recordingPath: string | null },
  capSec: number,
) {
  if (!gc.channelB) return;
  const capMs = capSec * 1_000;
  const timer = setTimeout(async () => {
    activeTimers.delete(gc.id);
    await cutVendorLeg(gc.id, gc.channelB!, gc.channelA, gc.recordingPath, 'time_cap');
  }, capMs);
  activeTimers.set(gc.id, timer);
  console.log(`[call-governance] Timer set for call ${gc.id}: ${capSec}s`);
}

// ── Route registration ─────────────────────────────────────────────────────────

export function registerCallGovernanceRoutes(app: Express) {
  // Start persistent AMI listener
  amiGovernance.start();

  // ── Bridge event → check governance rules ──────────────────────────────────
  amiGovernance.on('bridge', async (event) => {
    try {
      console.log(`[call-governance] Bridge event received: ${event.channel1} ↔ ${event.channel2}`);
      const rules = await db
        .select()
        .from(callGovernanceRules)
        .where(eq(callGovernanceRules.enabled, true));

      console.log(`[call-governance] Enabled rules found: ${rules.length}`);

      for (const rule of rules) {
        if (!rule.channelPattern) { console.log(`[call-governance] Rule ${rule.id} skipped: no channelPattern`); continue; }
        let pattern: RegExp;
        try { pattern = new RegExp(rule.channelPattern, 'i'); } catch { console.log(`[call-governance] Rule ${rule.id} bad regex: ${rule.channelPattern}`); continue; }

        const ch1Match = pattern.test(event.channel1);
        const ch2Match = pattern.test(event.channel2);
        console.log(`[call-governance] Rule ${rule.id} pattern="${rule.channelPattern}" ch1(${event.channel1})=${ch1Match} ch2(${event.channel2})=${ch2Match}`);
        if (!ch1Match && !ch2Match) continue;

        // Convention: channel matching vendor pattern → B-leg (to cut)
        // The non-matching channel is A-leg (customer, kept alive)
        const channelB = ch2Match ? event.channel2 : event.channel1;
        const channelA = channelB === event.channel2 ? event.channel1 : event.channel2;

        // Apply jitter: capSec + random(0, jitterSec)
        const capSec = rule.capSec + Math.floor(Math.random() * (rule.jitterSec + 1));

        // Recording path: Asterisk MixMonitor writes to /var/spool/asterisk/monitor/
        const recordingPath = `/var/spool/asterisk/monitor/${event.uniqueId1}-${event.uniqueId2}.wav`;

        const [gc] = await db.insert(governedCalls).values({
          uniqueId:       event.uniqueId1,
          channelA,
          channelB,
          caller:         event.callerIdNum1,
          callee:         event.callerIdNum2,
          connectionName: rule.connectionName,
          ruleId:         rule.id,
          capSec,
          status:         'active',
          recordingPath,
        }).returning();

        await db.insert(callGovernanceLogs).values({
          governedCallId: gc.id,
          eventType:      'call_bridged',
          channel:        channelB,
          details:        `Rule: ${rule.connectionName} | cap=${capSec}s | pattern=${rule.channelPattern}`,
        });

        await scheduleGovernedCallCut(gc, capSec);
      }
    } catch (err: any) {
      console.error('[call-governance] bridge handler error:', err?.message);
    }
  });

  // ── Hangup event → mark governed call completed ────────────────────────────
  amiGovernance.on('hangup', async (event) => {
    try {
      const rows = await db
        .select()
        .from(governedCalls)
        .where(
          and(
            eq(governedCalls.status, 'active'),
            sql`(channel_a = ${event.channel} OR channel_b = ${event.channel})`,
          )
        )
        .limit(1);

      if (!rows.length) return;
      const gc = rows[0];

      // Cancel any pending timer
      const timer = activeTimers.get(gc.id);
      if (timer) { clearTimeout(timer); activeTimers.delete(gc.id); }

      await db.update(governedCalls)
        .set({ completedAt: new Date(), status: 'completed' })
        .where(eq(governedCalls.id, gc.id));

      await db.insert(callGovernanceLogs).values({
        governedCallId: gc.id,
        eventType:      'call_ended',
        channel:        event.channel,
        details:        `Hangup received (cause ${event.cause}) before timer fired`,
      });
    } catch (err: any) {
      console.error('[call-governance] hangup handler error:', err?.message);
    }
  });

  // ── REST: Governance Rules ─────────────────────────────────────────────────

  app.get('/api/call-governance/rules', requireAuth, async (_req: any, res: any) => {
    try {
      const rows = await db.select().from(callGovernanceRules).orderBy(desc(callGovernanceRules.createdAt));
      res.json(rows);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/call-governance/rules', requireAdmin, async (req: any, res: any) => {
    try {
      const [rule] = await db.insert(callGovernanceRules).values({
        connectionName: req.body.connectionName,
        channelPattern: req.body.channelPattern ?? null,
        capSec:         Number(req.body.capSec)    || 120,
        jitterSec:      Number(req.body.jitterSec) || 15,
        enabled:        Boolean(req.body.enabled),
        action:         req.body.action   || 'cap_and_replay',
        scenario:       req.body.scenario || 'time_cap',
        notes:          req.body.notes    || null,
      }).returning();
      res.json(rule);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch('/api/call-governance/rules/:id', requireAdmin, async (req: any, res: any) => {
    try {
      const id = Number(req.params.id);
      const update: Record<string, any> = { updatedAt: new Date() };
      if (req.body.connectionName !== undefined) update.connectionName = req.body.connectionName;
      if (req.body.channelPattern !== undefined) update.channelPattern = req.body.channelPattern;
      if (req.body.capSec        !== undefined) update.capSec         = Number(req.body.capSec);
      if (req.body.jitterSec     !== undefined) update.jitterSec      = Number(req.body.jitterSec);
      if (req.body.enabled       !== undefined) update.enabled        = Boolean(req.body.enabled);
      if (req.body.action        !== undefined) update.action         = req.body.action;
      if (req.body.scenario      !== undefined) update.scenario       = req.body.scenario;
      if (req.body.notes         !== undefined) update.notes          = req.body.notes;

      const [rule] = await db.update(callGovernanceRules)
        .set(update)
        .where(eq(callGovernanceRules.id, id))
        .returning();
      res.json(rule ?? { error: 'Not found' });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/call-governance/rules/:id', requireAdmin, async (req: any, res: any) => {
    try {
      await db.delete(callGovernanceRules).where(eq(callGovernanceRules.id, Number(req.params.id)));
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── REST: Governed Calls ───────────────────────────────────────────────────

  app.get('/api/call-governance/calls', requireAuth, async (req: any, res: any) => {
    try {
      const status = req.query.status as string | undefined;
      const base = db.select().from(governedCalls);
      const rows = await (status
        ? base.where(eq(governedCalls.status, status))
        : base
      ).orderBy(desc(governedCalls.startTime)).limit(200);

      const now = Date.now();
      const enriched = rows.map(c => ({
        ...c,
        elapsedSec:   c.startTime ? Math.round((now - new Date(c.startTime).getTime()) / 1000) : null,
        remainingSec: (c.status === 'active' && c.startTime && c.capSec)
          ? Math.max(0, Math.round(c.capSec - (now - new Date(c.startTime).getTime()) / 1000))
          : null,
      }));
      res.json(enriched);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Manual operator cut
  app.post('/api/call-governance/calls/:id/cut', requireAdmin, async (req: any, res: any) => {
    try {
      const id = Number(req.params.id);
      const [gc] = await db.select().from(governedCalls).where(eq(governedCalls.id, id)).limit(1);
      if (!gc)                     return res.status(404).json({ error: 'Governed call not found' });
      if (gc.status !== 'active')  return res.status(400).json({ error: 'Call is not active' });
      if (!gc.channelB)            return res.status(400).json({ error: 'No vendor channel recorded' });

      // Cancel any pending timer first
      const timer = activeTimers.get(id);
      if (timer) { clearTimeout(timer); activeTimers.delete(id); }

      await cutVendorLeg(id, gc.channelB, gc.channelA, gc.recordingPath, 'manual');
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── REST: Stats ────────────────────────────────────────────────────────────

  app.get('/api/call-governance/stats', requireAuth, async (_req: any, res: any) => {
    try {
      const today = new Date(); today.setHours(0, 0, 0, 0);

      const [[activeRow], [cutsRow], [totalRow]] = await Promise.all([
        db.select({ count: sql<number>`count(*)` }).from(governedCalls).where(eq(governedCalls.status, 'active')),
        db.select({ count: sql<number>`count(*)` }).from(governedCalls)
          .where(and(eq(governedCalls.triggerReason, 'time_cap'), gte(governedCalls.byeSentAt, today))),
        db.select({ count: sql<number>`count(*)` }).from(governedCalls).where(gte(governedCalls.startTime, today)),
      ]);

      res.json({
        active:     Number(activeRow?.count  ?? 0),
        cutsToday:  Number(cutsRow?.count    ?? 0),
        totalToday: Number(totalRow?.count   ?? 0),
        amiOnline:  amiGovernance.isConnected,
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── REST: Audit Log ────────────────────────────────────────────────────────

  app.get('/api/call-governance/log', requireAuth, async (req: any, res: any) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 200, 500);
      const rows = await db.select().from(callGovernanceLogs)
        .orderBy(desc(callGovernanceLogs.createdAt))
        .limit(limit);
      res.json(rows);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── REST: AMI Status ───────────────────────────────────────────────────────

  app.get('/api/call-governance/ami-status', requireAuth, async (_req: any, res: any) => {
    res.json({ connected: amiGovernance.isConnected, activeTimers: activeTimers.size });
  });

  console.log('[call-governance] Routes registered');
}
