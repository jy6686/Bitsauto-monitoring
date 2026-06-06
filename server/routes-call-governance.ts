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
import { Client as SshClient } from 'ssh2';
import * as sippy from './sippy';

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

// ── Eager CDR lookup ───────────────────────────────────────────────────────────
// Runs 45 s after every cut so the CDR is still at the top of the portal list.
// Stores result directly on the governed_calls row — billing view reads from DB.
function scheduleCdrLookup(governedCallId: number): void {
  setTimeout(async () => {
    try {
      const [gc] = await db.select().from(governedCalls).where(eq(governedCalls.id, governedCallId));
      if (!gc) return;

      const settings = await storage.getSettings();
      if (!settings) return;

      const portalUrl  = (settings as any).portalUrl ?? '';
      const portalUser = settings.portalUsername    ?? '';
      const portalPass = settings.portalPassword    ?? '';
      if (!portalUrl || !portalUser || !portalPass) return;

      const startMs  = gc.startTime ? new Date(gc.startTime).getTime() : Date.now();
      const winStart = new Date(startMs - 3 * 60_000);
      const winEnd   = new Date(startMs + 20 * 60_000);

      let cdrs: any[] = [];
      try {
        cdrs = await sippy.scrapePortalCDRsAll(portalUser, portalPass, portalUrl, {
          startDate: winStart.toISOString(),
          endDate:   winEnd.toISOString(),
          maxPages:  3,
        });
      } catch { /* leave cdrs empty */ }

      const destDigits = (gc.caller || '').replace(/\D/g, '').replace(/^2060/, '');
      const destSuffix = destDigits.slice(-9);
      const cliSuffix  = (gc.callee || '').replace(/\D/g, '').slice(-7);

      const candidates = cdrs.filter((c: any) =>
        (c.callee || '').replace(/\D/g, '').endsWith(destSuffix)
      );

      let matched: any = null;
      if (candidates.length > 0) {
        const cliMatch = cliSuffix.length >= 6
          ? candidates.find((c: any) => (c.caller || '').replace(/\D/g, '').endsWith(cliSuffix))
          : null;
        matched = cliMatch ?? candidates.reduce((best: any, c: any) => {
          const a = Math.abs(new Date(c.startTime).getTime() - startMs);
          const b = Math.abs(new Date(best.startTime).getTime() - startMs);
          return a < b ? c : best;
        });
      }

      const cdrDuration   = matched ? (Number(matched.duration) || null) : null;
      const cdrCost       = matched ? (Number(matched.cost)     || null) : null;
      const cdrVendorCost = matched ? (Number((matched as any).vendorCost) || null) : null;
      const cdrVendorName = matched?.vendorResolved ?? matched?.vendorName ?? null;
      const cdrCaller     = matched?.caller ?? null;
      const cdrCallee     = matched?.callee ?? null;

      const govSec = gc.startTime && gc.byeSentAt
        ? Math.round((new Date(gc.byeSentAt).getTime() - new Date(gc.startTime).getTime()) / 1000)
        : null;
      const estimatedBilledSec = govSec !== null ? govSec + 8 : null;

      let cdrStatus = 'no_cdr';
      if (cdrDuration !== null && estimatedBilledSec !== null) {
        if (cdrDuration > estimatedBilledSec + 15) {
          cdrStatus = 'check';
        } else if (cdrVendorCost !== null && cdrCost !== null && (cdrCost - cdrVendorCost) < 0) {
          cdrStatus = 'loss';
        } else {
          cdrStatus = 'ok';
        }
      }

      await db.update(governedCalls)
        .set({ cdrStatus, cdrCaller, cdrCallee, cdrDuration, cdrCost, cdrVendorCost, cdrVendorName, cdrCheckedAt: new Date() } as any)
        .where(eq(governedCalls.id, governedCallId));

      console.log(`[call-governance] CDR lookup #${governedCallId}: status=${cdrStatus} pool=${cdrs.length} duration=${cdrDuration} cost=${cdrCost}`);
    } catch (err: any) {
      console.error(`[call-governance] CDR lookup #${governedCallId} failed:`, err?.message);
    }
  }, 45_000);
}

// ── Governance engine ──────────────────────────────────────────────────────────

async function cutVendorLeg(
  governedCallId: number,
  channelB: string,
  channelA: string | null,
  recordingPath: string | null,
  triggerReason: string,
  capSec: number = 30,
) {
  try {
    // Atomic redirect: both legs leave the bridge simultaneously.
    // channelA → gov-playback (StopMixMonitor + Wait(1) + Playback + Hangup)
    // channelB → gov-hangup  (immediate Hangup)
    // This prevents Asterisk from tearing down the A-leg as a side-effect
    // of hanging up the B-leg while both are in a bridge.
    if (channelA && recordingPath) {
      // Strip .wav — Asterisk Playback() auto-selects format
      const playbackFile = recordingPath.replace(/\.wav$/i, '');

      // Atomic redirect:
      //   A-leg → gov-playback  (StopMixMonitor + Wait(1) + Playback + Hangup)
      //   B-leg → gov-hangup    (Wait(90) + Hangup)
      //
      // B-leg enters Wait(90) instead of immediate Hangup so that Sippy
      // (acting as B2BUA) does NOT receive a BYE on the outbound call leg
      // during playback. If Sippy got that BYE it would cascade BYE to the
      // A-leg and kill the caller before the recording plays.
      // We send an explicit AMI Hangup to B-leg ~40s later (after playback
      // is done) so it is cleaned up promptly without waiting the full 90s.
      await amiGovernance.cutAndPlayback(channelA, channelB, playbackFile);

      // Delayed B-leg cleanup — 8 seconds after cut.
      // NOTE: Sippy is a B2BUA; when B-leg sends BYE Sippy will also send BYE
      // to the A-leg. Keep this value >= playback length if you want the full
      // recording to play. At 8s the carrier charges only 8 extra seconds but
      // playback will be cut at ~8s by the Sippy cascade.
      const bLegCleanupMs = 8_000;
      console.log(`[call-governance] B-leg cleanup scheduled in 8s for ${channelB}`);
      setTimeout(() => {
        console.log(`[call-governance] B-leg cleanup firing for ${channelB}`);
        amiGovernance.hangup(channelB).catch(() => {});
      }, bLegCleanupMs);

      await db.update(governedCalls)
        .set({ byeSentAt: new Date(), playbackStartedAt: new Date(), triggerReason, status: 'cut' })
        .where(eq(governedCalls.id, governedCallId));

      scheduleCdrLookup(governedCallId);

      await db.insert(callGovernanceLogs).values([
        {
          governedCallId,
          eventType: 'vendor_bye',
          channel:   channelB,
          details:   `Vendor leg cut (atomic redirect). Trigger: ${triggerReason}`,
        },
        {
          governedCallId,
          eventType: 'playback_started',
          channel:   channelA,
          details:   `Playback started: ${playbackFile}`,
        },
      ]);
    } else {
      // No recording or no A-leg — fall back to plain hangup on B-leg only
      console.warn(`[call-governance] cutVendorLeg: no channelA or recordingPath — plain hangup only`);
      await amiGovernance.hangup(channelB);

      await db.update(governedCalls)
        .set({ byeSentAt: new Date(), triggerReason, status: 'cut' })
        .where(eq(governedCalls.id, governedCallId));

      scheduleCdrLookup(governedCallId);

      await db.insert(callGovernanceLogs).values({
        governedCallId,
        eventType: 'vendor_bye',
        channel:   channelB,
        details:   `Vendor leg cut (hangup only — no recording). Trigger: ${triggerReason}`,
      });
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
  // Guard: never double-schedule — a timer already running means call is tracked
  if (activeTimers.has(gc.id)) {
    console.log(`[call-governance] Timer already active for call ${gc.id} — skipping duplicate`);
    return;
  }
  const capMs = capSec * 1_000;
  const timer = setTimeout(async () => {
    activeTimers.delete(gc.id);
    await cutVendorLeg(gc.id, gc.channelB!, gc.channelA, gc.recordingPath, 'time_cap', capSec);
  }, capMs);
  activeTimers.set(gc.id, timer);
  console.log(`[call-governance] Timer set for call ${gc.id}: ${capSec}s`);
}

/**
 * Reconcile active bridges seen by Asterisk against the governance rule set.
 * Runs on every AMI reconnect and every 60s thereafter.
 * Catches calls that were already bridged when the server started or when AMI
 * dropped — those calls never fired a BridgeEnter event so their timers were
 * never set, leaving them hanging indefinitely.
 */
async function reconcileActiveCalls() {
  try {
    if (!amiGovernance.isConnected) return;

    // ── Age-based stale cleanup (always runs) ─────────────────────────────
    // Mark 'active' rows as completed when their cap time + 5 min buffer has
    // passed. Handles calls that ended while AMI was down / server restarted
    // and whose Hangup event was never delivered.
    const staleByAge = await db.select().from(governedCalls).where(
      and(
        eq(governedCalls.status, 'active'),
        sql`start_time + (COALESCE(cap_sec, 120) || ' seconds')::interval + interval '5 minutes' < NOW()`,
      )
    );
    for (const row of staleByAge) {
      const timer = activeTimers.get(row.id);
      if (timer) { clearTimeout(timer); activeTimers.delete(row.id); }
      await db.update(governedCalls)
        .set({ completedAt: new Date(), status: 'completed' })
        .where(eq(governedCalls.id, row.id));
      await db.insert(callGovernanceLogs).values({
        governedCallId: row.id,
        eventType:      'stale_cleanup',
        channel:        row.channelB,
        details:        'Auto-completed: cap time + 5 min elapsed with no Hangup event received',
      });
      console.log(`[call-governance] Stale cleanup (age): call #${row.id} (${row.channelB}) auto-completed`);
    }

    const rules = await db.select().from(callGovernanceRules).where(eq(callGovernanceRules.enabled, true));
    if (!rules.length) return;

    const amiChannels = await amiGovernance.fetchActiveBridges();

    // ── AMI channel-based stale cleanup ───────────────────────────────────
    // When AMI returned a valid channel list, mark any 'active' DB row whose
    // channels are no longer present in Asterisk as completed.
    const amiChannelSet = new Set(amiChannels.map(c => c.channel));
    const dbActive = await db.select().from(governedCalls).where(eq(governedCalls.status, 'active'));
    for (const row of dbActive) {
      const aLive = row.channelA ? amiChannelSet.has(row.channelA) : false;
      const bLive = row.channelB ? amiChannelSet.has(row.channelB) : false;
      if (!aLive && !bLive) {
        const timer = activeTimers.get(row.id);
        if (timer) { clearTimeout(timer); activeTimers.delete(row.id); }
        await db.update(governedCalls)
          .set({ completedAt: new Date(), status: 'completed' })
          .where(eq(governedCalls.id, row.id));
        await db.insert(callGovernanceLogs).values({
          governedCallId: row.id,
          eventType:      'stale_cleanup',
          channel:        row.channelB,
          details:        'Auto-completed: channels absent from AMI bridge list',
        });
        console.log(`[call-governance] Stale cleanup (AMI): call #${row.id} (${row.channelB}) not in AMI → completed`);
      }
    }

    if (!amiChannels.length) return;

    console.log(`[call-governance] Reconcile: ${amiChannels.length} bridged channel(s) from AMI`);

    // Group channels by bridgeId — each bridge should have exactly 2 legs
    const byBridge = new Map<string, typeof amiChannels>();
    for (const ch of amiChannels) {
      const arr = byBridge.get(ch.bridgeId) ?? [];
      arr.push(ch);
      byBridge.set(ch.bridgeId, arr);
    }

    for (const [, legs] of byBridge) {
      if (legs.length !== 2) continue; // incomplete — skip

      for (const rule of rules) {
        if (!rule.channelPattern) continue;
        let pattern: RegExp;
        try { pattern = new RegExp(rule.channelPattern, 'i'); } catch { continue; }

        const ch1 = legs[0];
        const ch2 = legs[1];
        const ch1Match = pattern.test(ch1.channel);
        const ch2Match = pattern.test(ch2.channel);
        if (!ch1Match && !ch2Match) continue;

        // Determine A/B legs using same logic as the bridge handler
        let legB: typeof ch1, legA: typeof ch1;
        if (ch1Match && !ch2Match) {
          legB = ch1; legA = ch2;
        } else if (ch2Match && !ch1Match) {
          legB = ch2; legA = ch1;
        } else {
          // Both match — SIP (plain) before PJSIP
          const c1Plain = /^SIP\//i.test(ch1.channel) && !/^PJSIP\//i.test(ch1.channel);
          legB = c1Plain ? ch1 : ch2;
          legA = legB === ch1 ? ch2 : ch1;
        }

        // Check DB for existing active record for this vendor channel
        const existing = await db.select().from(governedCalls).where(
          and(
            eq(governedCalls.status, 'active'),
            sql`channel_b = ${legB.channel}`,
          )
        ).limit(1);

        if (existing.length > 0 && activeTimers.has(existing[0].id)) {
          continue; // already tracked with an active timer — nothing to do
        }

        // Compute remaining time — if call already exceeds cap, cut in 5s minimum
        const capSec       = rule.capSec + Math.floor(Math.random() * (rule.jitterSec + 1));
        const elapsedSec   = legB.durationSec;
        const remainingSec = Math.max(5, capSec - elapsedSec);
        const recordingPath = `/var/spool/asterisk/monitor/${legA.uniqueId}.wav`;

        let gc: { id: number; channelA: string | null; channelB: string | null; recordingPath: string | null };

        if (existing.length > 0) {
          // Reuse the existing DB record — just re-arm the timer
          gc = existing[0];
          console.log(`[call-governance] Reconcile: re-arming timer for call ${gc.id} (${legB.channel}) elapsed=${elapsedSec}s → cut in ${remainingSec}s`);
        } else {
          // New record — this call was never tracked at all
          const [inserted] = await db.insert(governedCalls).values({
            uniqueId:       legA.uniqueId,
            channelA:       legA.channel,
            channelB:       legB.channel,
            caller:         legA.callerIdNum,
            callee:         legA.connectedLineNum,
            connectionName: rule.connectionName,
            ruleId:         rule.id,
            capSec,
            status:         'active',
            recordingPath,
          }).returning();
          gc = inserted;

          await db.insert(callGovernanceLogs).values({
            governedCallId: gc.id,
            eventType:      'call_bridged',
            channel:        legB.channel,
            details:        `Recovered by AMI reconcile | elapsed=${elapsedSec}s cap=${capSec}s → cutting in ${remainingSec}s`,
          });

          console.log(`[call-governance] Reconcile: new record #${gc.id} for ${legB.channel} elapsed=${elapsedSec}s → cut in ${remainingSec}s`);
        }

        await scheduleGovernedCallCut(gc, remainingSec);
      }
    }
  } catch (err: any) {
    console.error('[call-governance] reconcileActiveCalls error:', err?.message);
  }
}

// ── Route registration ─────────────────────────────────────────────────────────

export function registerCallGovernanceRoutes(app: Express) {
  // Start persistent AMI listener
  amiGovernance.start();

  // ── On every AMI login: reconcile calls that were already bridged ──────────
  // Runs 2s after login to let Asterisk finish its initial event stream.
  amiGovernance.on('connected', () => {
    setTimeout(reconcileActiveCalls, 2_000);
  });

  // ── Periodic watchdog: every 60s catch any remaining missed bridges ────────
  setInterval(reconcileActiveCalls, 60_000);

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
        // The non-matching channel is A-leg (customer, kept alive).
        // IMPORTANT: when both channels match (e.g. pattern "SIP/sippy" hits both
        // SIP/sippy-XXXX AND PJSIP/sippy-endpoint-XXXX), prefer ch1Match-only or
        // ch2Match-only.  If both match, fall back to ch1 as B-leg (SIP comes before
        // PJSIP in bridge events from this setup).
        let channelB: string;
        let channelA: string;
        if (ch1Match && !ch2Match) {
          channelB = event.channel1; channelA = event.channel2;
        } else if (ch2Match && !ch1Match) {
          channelB = event.channel2; channelA = event.channel1;
        } else {
          // Both match — use channel type priority: SIP (plain) before PJSIP
          const c1IsSip  = /^SIP\//i.test(event.channel1) && !/^PJSIP\//i.test(event.channel1);
          channelB = c1IsSip ? event.channel1 : event.channel2;
          channelA = channelB === event.channel1 ? event.channel2 : event.channel1;
        }
        console.log(`[call-governance] Identified A-leg=${channelA} B-leg=${channelB}`);

        // Apply jitter: capSec + random(0, jitterSec)
        const capSec = rule.capSec + Math.floor(Math.random() * (rule.jitterSec + 1));

        // Recording path: MixMonitor runs on A-leg (PJSIP) with ${UNIQUEID}.wav.
        // Must use A-leg's uniqueId — NOT always uniqueId1 (order is non-deterministic).
        const uniqueIdA = channelA === event.channel1 ? event.uniqueId1 : event.uniqueId2;
        const recordingPath = `/var/spool/asterisk/monitor/${uniqueIdA}.wav`;
        console.log(`[call-governance] Recording path: ${recordingPath}`);

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

      await cutVendorLeg(id, gc.channelB, gc.channelA, gc.recordingPath, 'manual', gc.capSec ?? 30);
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

  // ── REST: Recording stream (SFTP from Asterisk box) ────────────────────────
  app.get('/api/call-governance/recordings/stream', requireAuth, async (req: any, res: any) => {
    const filePath = req.query.path as string;
    if (!filePath) return res.status(400).json({ error: 'path param required' });

    // Block path traversal
    if (filePath.includes('..') || !filePath.startsWith('/')) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    const host     = process.env.ASTERISK_HOST     ?? '159.223.32.59';
    const user     = process.env.ASTERISK_SSH_USER ?? 'root';
    const password = process.env.ASTERISK_SSH_PASSWORD ?? '';

    if (!password) {
      return res.status(503).json({ error: 'ASTERISK_SSH_PASSWORD env var not set' });
    }

    const conn = new SshClient();
    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err) {
          conn.end();
          console.error(`[recording-stream] SFTP open failed: ${err.message}`);
          return res.status(500).json({ error: 'SFTP open failed: ' + err.message });
        }

        sftp.stat(filePath, (statErr, stats) => {
          if (statErr) {
            conn.end();
            console.warn(`[recording-stream] File not found: ${filePath} — ${statErr.message}`);
            return res.status(404).json({ error: 'File not found on Asterisk: ' + filePath });
          }

          const fileName = filePath.split('/').pop() ?? 'recording.wav';
          console.log(`[recording-stream] Streaming ${fileName} (${stats.size} bytes)`);
          res.setHeader('Content-Type', 'audio/wav');
          res.setHeader('Content-Length', stats.size);
          res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
          res.setHeader('Accept-Ranges', 'bytes');

          const stream = sftp.createReadStream(filePath);
          stream.on('error', (e: any) => {
            console.error(`[recording-stream] Stream error: ${e.message}`);
            conn.end();
            if (!res.headersSent) res.status(500).end();
          });
          stream.on('close', () => conn.end());
          stream.pipe(res);
        });
      });
    });

    conn.on('error', (e) => {
      console.error(`[recording-stream] SSH connect failed to ${host}: ${e.message}`);
      if (!res.headersSent) res.status(502).json({ error: 'SSH connect failed: ' + e.message });
    });

    console.log(`[recording-stream] Connecting to ${host} as ${user} for: ${filePath}`);
    conn.connect({ host, port: 22, username: user, password });
  });

  // ── Manual CDR backfill ────────────────────────────────────────────────────
  // POST /api/call-governance/billing-backfill
  // Body: { id?: number }  — if id omitted, retries all null-cdrStatus cuts
  app.post('/api/call-governance/billing-backfill', requireAuth, async (req: any, res: any) => {
    try {
      const { id } = req.body ?? {};
      let rows: any[];
      if (id) {
        rows = await db.select().from(governedCalls)
          .where(and(eq(governedCalls.id, Number(id)), eq(governedCalls.status, 'cut')));
      } else {
        rows = await db.select().from(governedCalls)
          .where(and(eq(governedCalls.status, 'cut'), sql`cdr_status IS NULL`));
      }
      const ids = rows.map(r => r.id);
      // Fire lookup without the 45s delay — immediate retry
      for (const gcId of ids) {
        setTimeout(() => scheduleCdrLookup(gcId), 0);
      }
      res.json({ queued: ids.length, ids });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  console.log('[call-governance] Routes registered');
}
