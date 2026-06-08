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

// ── CDR cache access via global singleton ──────────────────────────────────────
// routes.ts sets (global as any).__bitsautoCdrCache = cdrCache after each refresh.
// Using global (vs. module-level injection) survives TSX hot-reloads of this file,
// which would otherwise reset a module-level reference back to null.
function _getGlobalCdrCache(): Map<string, any> | null {
  return (global as any).__bitsautoCdrCache ?? null;
}

// ── Destination-based rule selection ──────────────────────────────────────────
// Returns the single most-specific matching rule from a list of channel-matched
// rules.  Specificity = destinationPrefix.length + callerPrefix.length.
// A rule with no prefix set is a catch-all and wins only if nothing more specific
// exists.  Returns null if the list is empty.
function pickBestRule(
  rules: any[],
  callee: string,
  caller: string,
): any | null {
  const cleanCallee = callee.replace(/\D/g, '');
  const cleanCaller = caller.replace(/\D/g, '');

  let best: any | null = null;
  let bestScore = -1;

  for (const rule of rules) {
    const destPfx   = (rule.destinationPrefix ?? '').replace(/\D/g, '');
    const callerPfx = (rule.callerPrefix      ?? '').replace(/\D/g, '');

    if (destPfx   && !cleanCallee.startsWith(destPfx))   continue;
    if (callerPfx && !cleanCaller.startsWith(callerPfx)) continue;

    const score = destPfx.length + callerPfx.length;
    if (score > bestScore) { bestScore = score; best = rule; }
  }

  return best;
}

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
// Statuses that indicate a CDR has been successfully matched — never overwrite these.
const CDR_RESOLVED = new Set(['ok', 'check', 'loss']);

async function runCdrLookup(governedCallId: number, allowOverwrite = false): Promise<void> {
  const [gc] = await db.select().from(governedCalls).where(eq(governedCalls.id, governedCallId));
  if (!gc) return;

  // ── LOCK: once CDR is resolved, never overwrite unless caller explicitly allows ──
  if (!allowOverwrite && CDR_RESOLVED.has(gc.cdrStatus ?? '')) {
    console.log(`[call-governance] CDR lookup #${governedCallId}: already resolved (${gc.cdrStatus}), skipping`);
    return;
  }

  const settings = await storage.getSettings();
  if (!settings) return;

  const portalUrl  = (settings as any).portalUrl ?? '';
  const portalUser = settings.portalUsername ?? '';
  const portalPass = settings.portalPassword ?? '';
  if (!portalUrl || !portalUser || !portalPass) return;

  const apiUser = (settings as any).apiAdminUsername ?? portalUser;
  const apiPass = (settings as any).apiAdminPassword ?? portalPass;

  const startMs  = gc.startTime ? new Date(gc.startTime).getTime() : Date.now();
  const winStart = new Date(startMs - 3 * 60_000);
  const winEnd   = new Date(startMs + 20 * 60_000);

  // ── Destination extraction ────────────────────────────────────────────────
  // Field semantics (critical — DO NOT swap):
  //   gc.callee = B-leg CallerID  = the actual Pakistan/destination number dialed
  //               (e.g. "923719959675" — what appears as CLD in the Sippy CDR)
  //   gc.caller = A-leg CallerID  = calling customer's ANI with routing prefix
  //               (e.g. "20601923419451539" or "2060923419451539" — with prefix)
  //
  // The routing prefix on gc.caller (e.g. "20601" or "2060") is NOT the destination;
  // that prefix is assigned by the Sippy/Asterisk routing layer and should be
  // stripped. gc.callee already IS the clean destination with no prefix.
  //
  // NOTE on "2060 vs 20601" display: the one-digit difference in the routing prefix
  // is an upstream Asterisk CallerID presentation issue — Sippy/Asterisk is sending
  // "2060" where it should send "20601". Our code stores exactly what AMI reports.
  const rawDestDigits = (gc.callee || '').replace(/\D/g, '');  // ← B-leg = destination
  const techPrefix    = (process.env.SIPPY_TECH_PREFIX ?? '').replace(/\D/g, '');
  let stripped = techPrefix && rawDestDigits.startsWith(techPrefix)
    ? rawDestDigits.slice(techPrefix.length)
    : rawDestDigits;
  while (stripped.length > 12) stripped = stripped.slice(1);
  const destDigits  = stripped;
  const destSuffix  = destDigits.slice(-10);
  const destSuffix9 = destDigits.slice(-9);
  const cliSuffix   = (gc.caller || '').replace(/\D/g, '').slice(-8);  // ← A-leg = CLI

  // ── Track 0: in-memory CDR cache (zero HTTP cost, refreshed every 5 min) ──────
  // The global cache has 660+ CDRs including all Pakistan/Eritrea connection-level
  // CDRs. Using it avoids a portal HTTP round-trip for 3-min/8-min retries and
  // backfill runs. It has 5-min staleness so the 45s lookup may miss very fresh CDRs
  // — Tracks 2/3 below handle those via live portal scrape.
  let cdrs: any[] = [];
  let source = 'portal';
  const _globalCache = _getGlobalCdrCache();
  if (_globalCache && _globalCache.size > 0) {
    cdrs = [..._globalCache.values()];
    source = 'cache';
    console.log(`[call-governance] CDR lookup #${governedCallId}: cache T0 — ${_globalCache.size} CDR(s)`);
  }

  // ── Track 1: XML-RPC getAccountCDRs with cld filter (targeted, fast) ──
  // Uses billed_duration + cost fields. Blocked by circuit-breaker if auth fails.
  // No `type: non_zero` — governed cuts can land as 0-duration CDRs in Sippy.
  try {
    const xmlCdrs = await sippy.getSippyCDRs(
      apiUser, apiPass, 50,
      {
        cld:       destDigits,
        startDate: winStart.toISOString(),
        endDate:   winEnd.toISOString(),
      },
      portalUrl,
    );
    if (xmlCdrs.length > 0) {
      cdrs   = xmlCdrs;
      source = 'xmlrpc';
      console.log(`[call-governance] CDR lookup #${governedCallId}: XML-RPC returned ${xmlCdrs.length} CDR(s) for cld=${destDigits}`);
    }
  } catch { /* fall through to portal scrape */ }

  // ── Track 2: customer portal scrape ──────────────────────────────────────────
  // Use portal-relative date strings ('2 hours ago'/'now') NOT UTC ISO timestamps.
  // The Sippy portal interprets date params as server LOCAL time (UTC+5), so passing
  // UTC ISO strings shifts the search window by 5 h and returns wrong CDRs.
  // Relative strings are computed by the portal itself in its own timezone → correct.
  // Time-window filtering happens in JavaScript using UTC startTime fields.
  if (cdrs.length === 0) {
    try {
      cdrs = await sippy.scrapePortalCDRsAll(portalUser, portalPass, portalUrl, {
        startDate: '2 hours ago',
        endDate:   'now',
        maxPages:  8,
      });
    } catch { /* fall through to Track 3 */ }
  }

  // ── Track 3: admin-credential TARGETED portal scrape (destination-filtered) ──
  // Uses adminWebPassword for ssp-root web login and passes `destination=destDigits`
  // so the portal returns ONLY CDRs for this specific destination number — not a
  // generic 200-CDR dump. This is the correct fix for high-traffic systems where
  // 500+ calls/hour make a page-limited CDR list inadequate for finding a specific call.
  const adminWebPass = (settings as any).adminWebPassword as string | undefined;
  if (apiUser && adminWebPass) {
    try {
      const adminCdrs = await sippy.scrapePortalCDRsAll(apiUser, adminWebPass, portalUrl, {
        startDate:   '2 hours ago',
        endDate:     'now',
        destination: destDigits,   // Filter by CLD — returns only CDRs for this destination
        maxPages:    2,             // 2 pages is more than enough for a single destination
      });
      if (adminCdrs.length > 0) {
        // Merge: dedup by startTime:caller:callee fingerprint
        const seenFp = new Set(cdrs.map((c: any) => `${c.startTime}:${c.caller}:${c.callee}`));
        let added = 0;
        for (const c of adminCdrs) {
          const fp = `${c.startTime}:${c.caller}:${c.callee}`;
          if (!seenFp.has(fp)) { seenFp.add(fp); cdrs.push(c); added++; }
        }
        if (added > 0) source = 'admin-portal';
        console.log(`[call-governance] CDR lookup #${governedCallId}: admin portal → ${adminCdrs.length} CDR(s), +${added} new (pool now ${cdrs.length})`);
      }
    } catch { /* non-critical — matching continues with Track 2 CDRs */ }
  }

  // ── Diagnostic: log sample CDR callee values when pool is non-empty ──
  // Helps identify CLD format mismatches without verbose logs.
  if (cdrs.length > 0) {
    const sample = cdrs.slice(0, 3).map((c: any) => c.callee ?? c.cld ?? '?').join(', ');
    console.log(`[call-governance] CDR lookup #${governedCallId}: pool=${cdrs.length} searching destSuffix=${destSuffix} sample_cld=[${sample}]`);
  }

  // ── Match: 4-tier priority ────────────────────────────────────────────────
  // Tier 1 — SIP Call-ID exact match (100% deterministic)
  // Tier 2 — Vendor IP + time window
  // Tier 3 — CLD 10-digit suffix + CLI tiebreaker (global destinations)
  // Tier 4 — CLD 9-digit suffix fallback (shorter national numbers)
  const vendorCallId = (gc as any).vendorCallId as string | null;
  const vendorIp     = (gc as any).vendorIp     as string | null;
  const windowMs     = 15 * 60 * 1000;   // widened to 15 min — Sippy CDR write can lag

  let matched: any = null;
  let matchTier = 0;

  // Tier 1: Call-ID exact match
  if (vendorCallId) {
    const callIdNorm = vendorCallId.replace(/^<|>$/g, '').trim();
    matched = cdrs.find((c: any) => {
      const cdrCallId = (c.callId || '').replace(/^<|>$/g, '').trim();
      return cdrCallId && cdrCallId === callIdNorm;
    }) ?? null;
    if (matched) matchTier = 1;
  }

  // Tier 2: Vendor IP + time window (within ±10 min of call start)
  if (!matched && vendorIp) {
    const ipCandidates = cdrs.filter((c: any) => {
      if (!c.remoteIp || c.remoteIp !== vendorIp) return false;
      const cdrTs = c.startTime ? new Date(c.startTime).getTime() : null;
      return cdrTs !== null && Math.abs(cdrTs - startMs) <= windowMs;
    });
    if (ipCandidates.length === 1) {
      matched = ipCandidates[0];
      matchTier = 2;
    } else if (ipCandidates.length > 1) {
      // Multiple CDRs from same IP in window — pick closest by time
      matched = ipCandidates.reduce((best: any, c: any) => {
        const a = Math.abs(new Date(c.startTime).getTime() - startMs);
        const b = Math.abs(new Date(best.startTime).getTime() - startMs);
        return a < b ? c : best;
      });
      matchTier = 2;
    }
  }

  // Tier 3: CLD 10-digit suffix + CLI tiebreaker (global destinations)
  if (!matched) {
    const inWindow = (c: any) => {
      const cdrTs = c.startTime ? new Date(c.startTime).getTime() : null;
      return cdrTs !== null && Math.abs(cdrTs - startMs) <= windowMs;
    };
    const pickBest = (pool: any[]) => {
      const cliMatch = cliSuffix.length >= 6
        ? pool.find((c: any) => (c.caller || '').replace(/\D/g, '').endsWith(cliSuffix))
        : null;
      return cliMatch ?? pool.reduce((best: any, c: any) => {
        const a = Math.abs(new Date(c.startTime).getTime() - startMs);
        const b = Math.abs(new Date(best.startTime).getTime() - startMs);
        return a < b ? c : best;
      });
    };
    // Try 10-digit suffix first (most precise for international numbers)
    const tier3 = cdrs.filter((c: any) =>
      inWindow(c) && (c.callee || '').replace(/\D/g, '').endsWith(destSuffix)
    );
    if (tier3.length > 0) { matched = pickBest(tier3); matchTier = 3; }
  }

  // Tier 4: CLD 9-digit suffix fallback (shorter national numbers / alternate format)
  if (!matched) {
    const tier4 = cdrs.filter((c: any) => {
      const cdrTs = c.startTime ? new Date(c.startTime).getTime() : null;
      if (cdrTs === null || Math.abs(cdrTs - startMs) > windowMs) return false;
      const cdrCallee = (c.callee || '').replace(/\D/g, '');
      return destSuffix9.length >= 7 && cdrCallee.endsWith(destSuffix9);
    });
    if (tier4.length > 0) {
      const cliMatch = cliSuffix.length >= 6
        ? tier4.find((c: any) => (c.caller || '').replace(/\D/g, '').endsWith(cliSuffix))
        : null;
      matched = cliMatch ?? tier4.reduce((best: any, c: any) => {
        const a = Math.abs(new Date(c.startTime).getTime() - startMs);
        const b = Math.abs(new Date(best.startTime).getTime() - startMs);
        return a < b ? c : best;
      });
      if (matched) matchTier = 4;
    }
  }

  // Use 0 (not null) when matched but has zero billed duration — vendor billed 0s.
  // This correctly resolves as 'ok' rather than staying 'no_cdr'.
  const cdrDuration   = matched !== null ? (Number(matched.duration) || 0) : null;
  const cdrCost       = matched !== null ? (Number(matched.cost)     || 0) : null;
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

  // ── LOCK: only write if we have a better result than what's stored ──
  // Never downgrade a resolved CDR back to no_cdr from a subsequent lookup.
  if (!allowOverwrite && CDR_RESOLVED.has(gc.cdrStatus ?? '') && cdrStatus === 'no_cdr') {
    console.log(`[call-governance] CDR lookup #${governedCallId}: not downgrading ${gc.cdrStatus} → no_cdr`);
    return;
  }

  await db.update(governedCalls)
    .set({ cdrStatus, cdrCaller, cdrCallee, cdrDuration, cdrCost, cdrVendorCost, cdrVendorName, cdrCheckedAt: new Date() } as any)
    .where(eq(governedCalls.id, governedCallId));

  console.log(`[call-governance] CDR lookup #${governedCallId}: status=${cdrStatus} tier=${matchTier} source=${source} pool=${cdrs.length} duration=${cdrDuration} cost=${cdrCost}`);
}

function scheduleCdrLookup(governedCallId: number): void {
  // Sippy can lag 1–3 min writing CDRs after a call ends.
  // Fire at 45s, 3 min, 8 min — each attempt only overwrites if still no_cdr.
  const attempts = [45_000, 3 * 60_000, 8 * 60_000];
  for (const delay of attempts) {
    setTimeout(async () => {
      try {
        const [gc] = await db.select({ cdrStatus: governedCalls.cdrStatus })
          .from(governedCalls).where(eq(governedCalls.id, governedCallId));
        // Skip if already resolved by an earlier attempt
        if (gc && CDR_RESOLVED.has(gc.cdrStatus ?? '')) return;
        await runCdrLookup(governedCallId, false);
      } catch (err: any) {
        console.error(`[call-governance] CDR lookup #${governedCallId} (${delay/1000}s) failed:`, err?.message);
      }
    }, delay);
  }
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

      // ── Find channel-matching rules for this bridge ────────────────────────
      const ch1 = legs[0];
      const ch2 = legs[1];

      // Collect all channel-pattern-matching rules and their A/B leg assignment
      const channelMatches: Array<{ rule: any; legA: typeof ch1; legB: typeof ch1 }> = [];
      for (const rule of rules) {
        if (!rule.channelPattern) continue;
        let pattern: RegExp;
        try { pattern = new RegExp(rule.channelPattern, 'i'); } catch { continue; }

        const ch1Match = pattern.test(ch1.channel);
        const ch2Match = pattern.test(ch2.channel);
        if (!ch1Match && !ch2Match) continue;

        let legB: typeof ch1, legA: typeof ch1;
        if (ch1Match && !ch2Match) {
          legB = ch1; legA = ch2;
        } else if (ch2Match && !ch1Match) {
          legB = ch2; legA = ch1;
        } else {
          const c1Plain = /^SIP\//i.test(ch1.channel) && !/^PJSIP\//i.test(ch1.channel);
          legB = c1Plain ? ch1 : ch2;
          legA = legB === ch1 ? ch2 : ch1;
        }
        channelMatches.push({ rule, legA, legB });
      }
      if (channelMatches.length === 0) continue;

      // ── Pick best rule using destination / caller prefix specificity ────────
      const callee = channelMatches[0].legA.connectedLineNum ?? '';
      const caller = channelMatches[0].legA.callerIdNum      ?? '';
      const best   = pickBestRule(channelMatches.map(m => m.rule), callee, caller);
      if (!best) continue;
      const { legA, legB } = channelMatches.find(m => m.rule.id === best.id)!;

      {
        const rule = best;

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

          // Capture SIP Call-ID + peer IP from vendor leg (reconciled call)
          amiGovernance.getChannelVars(legB.channel).then(({ sipCallId, peerIp }) => {
            if (sipCallId || peerIp) {
              db.update(governedCalls)
                .set({ vendorCallId: sipCallId || null, vendorIp: peerIp || null } as any)
                .where(eq(governedCalls.id, inserted.id))
                .catch(() => {});
            }
          }).catch(() => {});

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

      // ── Collect all channel-pattern matches for this bridge ────────────────
      interface BridgeMatch { rule: any; channelA: string; channelB: string; uniqueIdA: string; }
      const bridgeMatches: BridgeMatch[] = [];
      for (const rule of rules) {
        if (!rule.channelPattern) continue;
        let pattern: RegExp;
        try { pattern = new RegExp(rule.channelPattern, 'i'); } catch { continue; }

        const ch1Match = pattern.test(event.channel1);
        const ch2Match = pattern.test(event.channel2);
        console.log(`[call-governance] Rule ${rule.id} pattern="${rule.channelPattern}" ch1(${event.channel1})=${ch1Match} ch2(${event.channel2})=${ch2Match}`);
        if (!ch1Match && !ch2Match) continue;

        let channelB: string, channelA: string, uniqueIdA: string;
        if (ch1Match && !ch2Match) {
          channelB = event.channel1; channelA = event.channel2; uniqueIdA = event.uniqueId2;
        } else if (ch2Match && !ch1Match) {
          channelB = event.channel2; channelA = event.channel1; uniqueIdA = event.uniqueId1;
        } else {
          const c1IsSip = /^SIP\//i.test(event.channel1) && !/^PJSIP\//i.test(event.channel1);
          channelB   = c1IsSip ? event.channel1 : event.channel2;
          channelA   = channelB === event.channel1 ? event.channel2 : event.channel1;
          uniqueIdA  = channelA === event.channel1 ? event.uniqueId1 : event.uniqueId2;
        }
        bridgeMatches.push({ rule, channelA, channelB, uniqueIdA });
      }

      if (bridgeMatches.length === 0) return;

      // ── Pick most-specific rule by destination / caller prefix ──────────────
      const callee    = event.callerIdNum2 ?? '';
      const caller    = event.callerIdNum1 ?? '';
      const bestRule  = pickBestRule(bridgeMatches.map(m => m.rule), callee, caller);
      if (!bestRule) return;
      const { channelA, channelB, uniqueIdA } = bridgeMatches.find(m => m.rule.id === bestRule.id)!;
      const rule = bestRule;
      console.log(`[call-governance] Best rule id=${rule.id} name="${rule.ruleName ?? rule.connectionName}" dest="${rule.destinationPrefix ?? '*'}" caller="${rule.callerPrefix ?? '*'}" → A-leg=${channelA} B-leg=${channelB}`);

      const capSec = rule.capSec + Math.floor(Math.random() * (rule.jitterSec + 1));

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

      amiGovernance.getChannelVars(channelB).then(({ sipCallId, peerIp }) => {
        if (sipCallId || peerIp) {
          db.update(governedCalls)
            .set({ vendorCallId: sipCallId || null, vendorIp: peerIp || null } as any)
            .where(eq(governedCalls.id, gc.id))
            .catch(() => {});
          console.log(`[call-governance] #${gc.id} vendor vars: callId=${sipCallId || '—'} ip=${peerIp || '—'}`);
        }
      }).catch(() => {});

      await db.insert(callGovernanceLogs).values({
        governedCallId: gc.id,
        eventType:      'call_bridged',
        channel:        channelB,
        details:        `Rule: ${rule.ruleName ?? rule.connectionName} | cap=${capSec}s | dest=${rule.destinationPrefix ?? '*'} | pattern=${rule.channelPattern}`,
      });

      await scheduleGovernedCallCut(gc, capSec);
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
        ruleName:          req.body.ruleName          || null,
        connectionName:    req.body.connectionName,
        channelPattern:    req.body.channelPattern    ?? null,
        destinationPrefix: req.body.destinationPrefix || null,
        callerPrefix:      req.body.callerPrefix      || null,
        capSec:            Number(req.body.capSec)    || 120,
        jitterSec:         Number(req.body.jitterSec) || 15,
        enabled:           Boolean(req.body.enabled),
        action:            req.body.action   || 'cap_and_replay',
        scenario:          req.body.scenario || 'time_cap',
        notes:             req.body.notes    || null,
      }).returning();
      res.json(rule);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch('/api/call-governance/rules/:id', requireAdmin, async (req: any, res: any) => {
    try {
      const id = Number(req.params.id);
      const update: Record<string, any> = { updatedAt: new Date() };
      if (req.body.ruleName          !== undefined) update.ruleName          = req.body.ruleName || null;
      if (req.body.connectionName    !== undefined) update.connectionName    = req.body.connectionName;
      if (req.body.channelPattern    !== undefined) update.channelPattern    = req.body.channelPattern;
      if (req.body.destinationPrefix !== undefined) update.destinationPrefix = req.body.destinationPrefix || null;
      if (req.body.callerPrefix      !== undefined) update.callerPrefix      = req.body.callerPrefix      || null;
      if (req.body.capSec            !== undefined) update.capSec            = Number(req.body.capSec);
      if (req.body.jitterSec         !== undefined) update.jitterSec         = Number(req.body.jitterSec);
      if (req.body.enabled           !== undefined) update.enabled           = Boolean(req.body.enabled);
      if (req.body.action            !== undefined) update.action            = req.body.action;
      if (req.body.scenario          !== undefined) update.scenario          = req.body.scenario;
      if (req.body.notes             !== undefined) update.notes             = req.body.notes;

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
  // Body: { id?: number, force?: boolean }
  //   id    — specific call to retry; omit for all un-resolved cuts
  //   force — if true, overwrite even already-resolved CDR data (admin override)
  app.post('/api/call-governance/billing-backfill', requireAuth, async (req: any, res: any) => {
    try {
      const { id, force = false } = req.body ?? {};
      let rows: any[];
      if (id) {
        rows = await db.select().from(governedCalls)
          .where(and(eq(governedCalls.id, Number(id)), eq(governedCalls.status, 'cut')));
      } else {
        // Default: only retry cuts that are still unresolved (null or no_cdr)
        rows = await db.select().from(governedCalls)
          .where(and(
            eq(governedCalls.status, 'cut'),
            sql`(cdr_status IS NULL OR cdr_status = 'no_cdr')`,
          ));
      }
      const ids = rows.map(r => r.id);
      // Fire immediately — runCdrLookup respects the lock unless force=true
      for (const gcId of ids) {
        runCdrLookup(gcId, Boolean(force)).catch((err: any) =>
          console.error(`[call-governance] backfill #${gcId} failed:`, err?.message)
        );
      }
      res.json({ queued: ids.length, ids });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  console.log('[call-governance] Routes registered');
}
