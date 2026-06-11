/**
 * Call Governance Routes
 * AMI-triggered vendor BYE at configurable timer + 120s audio replay to A-leg.
 * Registered by server/routes.ts via registerCallGovernanceRoutes(app).
 */

import type { Express } from 'express';
import { db } from './db';
import {
  callGovernanceRules, governedCalls, callGovernanceLogs,
  canonicalVendors, vendorProductPrefixes, prefixAuditLog,
  productRegistry,
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

// ── Live portal scrape throttle ───────────────────────────────────────────────
// Prevents concurrent Track-2 portal scrapes from hammering Sippy.
// Only one live scrape at a time; callers that arrive while locked use cache only.
// Also limits Track-2 to calls within the 2h portal visibility window — older calls
// can never be found via live scrape (CDRs age out of portal view).
let _portalScrapeLock = false;
const PORTAL_WINDOW_MS = 2 * 60 * 60 * 1000;

// ── Track 2b: P&L targeted lookup concurrency guard ──────────────────────────
// Prevents multiple concurrent P&L scrapes for different calls from hammering
// the portal simultaneously. One scrape at a time; others wait for next retry.
let _pnlFetching = false;

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
  const rawCallee = callee.replace(/\D/g, '');
  const cleanCaller = caller.replace(/\D/g, '');

  // Strip routing prefix "2060" before destination-prefix matching.
  // callee is stored as callerIdNum1 which contains "2060" + actual E.164 destination
  // e.g. "2060923xxxxxxxx" → strip → "923xxxxxxxx" = Pakistan, for rule dest="923" to match.
  const cleanCallee = (rawCallee.startsWith('2060') && rawCallee.length >= 14)
    ? rawCallee.slice(4)
    : rawCallee;

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
  // Historical CDRs — good for backfill retries once the cache has caught up.
  // NOTE: Cache has 5-min staleness. CDRs for calls cut in the last 5 min may not
  // be present yet. Track 2 always runs live to supplement the cache.
  let cdrs: any[] = [];
  let source = 'none';
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
  } catch { /* fall through */ }

  // ── Track 1b: SIPPY_PROV XML-RPC — provisioning credentials with root wholesaler scope ──
  // The Asterisk SIP trunk authenticates to Sippy as a different account than ssp-root,
  // so ssp-root's customer portal CDRs never include governed calls. SIPPY_PROV credentials
  // are expected to have admin/provisioning-level XML-RPC access (i_wholesaler=1 = all accts).
  // This track runs ONLY if Track 1 returned 0 CDRs (auth failure or empty result).
  if (cdrs.length === 0 || source !== 'xmlrpc') {
    const provUser = (process.env.SIPPY_PROV_USERNAME ?? '').trim();
    const provPass = (process.env.SIPPY_PROV_PASSWORD ?? '').trim();
    if (provUser && provUser !== apiUser) {
      try {
        const provCdrs = await sippy.getSippyCDRs(
          provUser, provPass, 50,
          {
            cld:       destDigits,
            startDate: winStart.toISOString(),
            endDate:   winEnd.toISOString(),
          },
          portalUrl,
        );
        if (provCdrs.length > 0) {
          cdrs   = provCdrs;
          source = 'xmlrpc-prov';
          console.log(`[call-governance] CDR lookup #${governedCallId}: XML-RPC prov → ${provCdrs.length} CDR(s) for cld=${destDigits}`);
        } else {
          console.log(`[call-governance] CDR lookup #${governedCallId}: XML-RPC prov → 0 CDR(s) for cld=${destDigits}`);
        }
      } catch (e: any) {
        console.log(`[call-governance] CDR lookup #${governedCallId}: XML-RPC prov error: ${e?.message}`);
      }
    }
  }

  // ── Track 2: LIVE portal scrape — runs when call is fresh & no concurrent scrape ──
  // CRITICAL FIX: Previously gated on cdrs.length===0 which meant it NEVER ran (cache
  // always non-empty). Now runs for fresh calls (within portal visibility window) with
  // a global lock to prevent concurrent scrapes from hammering Sippy.
  //
  // Portal date strings MUST be relative, NOT UTC ISO — Sippy portal interprets them
  // in server local time (UTC+5); ISO strings shift the window by 5h.
  const callIsRecent = (Date.now() - startMs) < PORTAL_WINDOW_MS;
  if (callIsRecent && !_portalScrapeLock) {
    _portalScrapeLock = true;
    try {
      const liveCdrs = await sippy.scrapePortalCDRsAll(portalUser, portalPass, portalUrl, {
        startDate: '90 minutes ago',
        endDate:   'now',
        maxPages:  6,   // 300 CDRs — covers ~30 min of traffic at 500 cuts/hr
      });
      if (liveCdrs.length > 0) {
        const seenFp = new Set(cdrs.map((c: any) => `${c.startTime}:${c.caller}:${c.callee}`));
        let added = 0;
        for (const c of liveCdrs) {
          const fp = `${c.startTime}:${c.caller}:${c.callee}`;
          if (!seenFp.has(fp)) { seenFp.add(fp); cdrs.push(c); added++; }
        }
        if (added > 0) source = cdrs.length > liveCdrs.length ? 'cache+portal' : 'portal';
        console.log(`[call-governance] CDR lookup #${governedCallId}: Track2 live → ${liveCdrs.length} CDR(s), +${added} new (pool=${cdrs.length})`);
      }
    } catch { /* non-critical — matching continues with cache only */ }
    finally { _portalScrapeLock = false; }
  } else if (!callIsRecent) {
    console.log(`[call-governance] CDR lookup #${governedCallId}: Track2 skipped (call >2h old, outside portal window)`);
  } else {
    console.log(`[call-governance] CDR lookup #${governedCallId}: Track2 skipped (concurrent scrape in progress)`);
  }

  // ── Track 2b: Targeted P&L CDR lookup ────────────────────────────────────
  // The Asterisk SIP trunk is a VENDOR in Sippy — its CDRs NEVER appear in
  // cdrs_customer.php. The admin P&L report covers all call types.
  //
  // We use a narrow date window (callStart ± window) and paginate through pages
  // stopping as soon as the destination CLD suffix is found (early exit).
  // Only runs when the call is ≥3 min old (Sippy CDR write delay) and either
  // Track 2 found nothing or the pool has no matching CDR yet.
  //
  // Rate-limited: at most one concurrent P&L lookup per session via _pnlFetching.
  const callAgeMs    = Date.now() - startMs;
  const callOldEnough = callAgeMs >= 3 * 60_000;   // Sippy CDR write delay
  if (callOldEnough && !_pnlFetching && destSuffix.length >= 8) {
    _pnlFetching = true;
    try {
      const pnlCdrs = await sippy.scrapePnlCdrForCall(
        portalUser, portalPass,
        startMs,
        destSuffix,
        portalUrl,
        { maxPages: 15, windowMinutes: 12 },
      );
      if (pnlCdrs.length > 0) {
        const seenFp = new Set(cdrs.map((c: any) => `${c.startTime}:${c.caller}:${c.callee}`));
        let pnlAdded = 0;
        for (const c of pnlCdrs) {
          const fp = `${c.startTime}:${c.caller}:${c.callee}`;
          if (!seenFp.has(fp)) { seenFp.add(fp); cdrs.push(c); pnlAdded++; }
        }
        if (pnlAdded > 0) {
          if (!source.includes('pnl')) source += source ? '+pnl' : 'pnl';
          console.log(`[call-governance] CDR lookup #${governedCallId}: Track2b P&L → +${pnlAdded} rows (pool=${cdrs.length})`);
        }
      }
    } catch (e: any) {
      console.warn(`[call-governance] CDR lookup #${governedCallId}: Track2b P&L error: ${e?.message ?? e}`);
    } finally {
      _pnlFetching = false;
    }
  } else if (!callOldEnough) {
    console.log(`[call-governance] CDR lookup #${governedCallId}: Track2b skipped (call <3 min old, CDR not written yet)`);
  }

  // ── Track 3: REMOVED — previously used destination=destDigits which triggered ──
  // a different admin portal HTML layout (tooFewCells, 0 CDRs parsed). Since Track 2
  // uses the same credentials as the old Track 3, removing the broken destination
  // filter makes Track 3 redundant. The global cache + Track 2 live scrape is sufficient.

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
  // CDR generation timing: vendor B-leg is in Wait(90) after the governance BYE,
  // so Sippy doesn't see the BYE on the outbound leg until ~T+90s. CDR is generated
  // AFTER the B-leg disconnects. First retry at 45s is always too early — bumped to 100s.
  // Subsequent retries: 3 min (CDR usually in portal by then), 10 min (final safety net).
  const attempts = [100_000, 3 * 60_000, 10 * 60_000];
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
      // Always play silence on cut — never replay the recording to the caller.
      // The recording file (set in recordingPath) is preserved for the
      // Recordings tab but is not used as playback audio.
      const playbackFile = 'silence/10';

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
        // Sippy-created recording file — always present on the Asterisk server.
        const recordingPath = `/var/spool/asterisk/monitor/${legA.uniqueId}.wav`;

        let gc: { id: number; channelA: string | null; channelB: string | null; recordingPath: string | null };

        if (existing.length > 0) {
          // Reuse the existing DB record — just re-arm the timer.
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

  // ── Periodic CDR backfill: every 30 min retry unresolved cuts (last 7 days) ──
  // Covers: (a) cuts where all 3 retries fired during a Sippy outage, and
  //         (b) completed calls — they never had scheduleCdrLookup() called.
  // Note: portal CDR window is ~2 hours so older records can only be matched
  // from the global cache. Records older than 2 hours will resolve on future
  // backfill cycles once P&L extraction is wired.
  async function runPeriodicCdrBackfill(limitOverride?: number) {
    try {
      const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000);
      // No status filter — include both 'cut' AND 'completed' rows
      const pending = await db
        .select({ id: governedCalls.id })
        .from(governedCalls)
        .where(and(
          sql`(cdr_status IS NULL OR cdr_status = 'no_cdr')`,
          gte(governedCalls.startTime, cutoff),
        ))
        .orderBy(desc(governedCalls.id))   // newest first — most likely to be in portal
        .limit(limitOverride ?? 50);
      if (pending.length === 0) return;
      console.log(`[call-governance] Periodic CDR backfill: ${pending.length} record(s) queued`);
      for (const { id } of pending) {
        runCdrLookup(id, false).catch(() => {});
        await new Promise(r => setTimeout(r, 1_500));
      }
    } catch (err: any) {
      console.error('[call-governance] Periodic CDR backfill error:', err?.message);
    }
  }
  setInterval(runPeriodicCdrBackfill, 30 * 60 * 1000);
  // Run 5 min after startup with larger batch — portal covers last 2h so recent records
  // missed by the previous session's retries can be recovered immediately.
  setTimeout(() => runPeriodicCdrBackfill(200), 5 * 60 * 1000);

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
      // Sippy/Asterisk AMI Bridge event field semantics (CONFIRMED from production DB):
      //   callerIdNum1 = SIP/sippy (B-leg/vendor) CallerIDNum = CLD with routing prefix
      //                  e.g. "2060923xxxxxxxxxx" (routing prefix 2060 + Pakistan 923...)
      //                       "20602917xxxxxxxx"  (routing prefix 2060 + Eritrea 291...)
      //   callerIdNum2 = PJSIP/sippy-endpoint (A-leg/customer) CallerIDNum = originating CLI
      //                  e.g. "17246702541" (North America originating caller)
      // WARNING: do NOT invert based on channel A/B identification — the CallerIDNum
      // assignment is Sippy-specific. callerIdNum1 ALWAYS contains the routed destination.
      const callee    = event.callerIdNum1 ?? '';   // CLD — routed destination (with routing prefix)
      const caller    = event.callerIdNum2 ?? '';   // CLI — originating ANI
      console.log(`[call-governance] Bridge callee(CLD)="${callee}" caller(CLI)="${caller}"`);
      const bestRule  = pickBestRule(bridgeMatches.map(m => m.rule), callee, caller);
      if (!bestRule) return;
      const { channelA, channelB, uniqueIdA } = bridgeMatches.find(m => m.rule.id === bestRule.id)!;
      const rule = bestRule;
      console.log(`[call-governance] Best rule id=${rule.id} name="${rule.ruleName ?? rule.connectionName}" dest="${rule.destinationPrefix ?? '*'}" caller="${rule.callerPrefix ?? '*'}" → A-leg=${channelA} B-leg=${channelB}`);

      const capSec = rule.capSec + Math.floor(Math.random() * (rule.jitterSec + 1));

      // Sippy creates this file automatically when the channel is set up.
      // It is always present on the Asterisk server and is used for the
      // Recordings tab. Playback on cut always uses silence — see cutVendorLeg.
      const recordingPath = `/var/spool/asterisk/monitor/${uniqueIdA || event.uniqueId1}.wav`;
      console.log(`[call-governance] Recording path: ${recordingPath}`);

      const [gc] = await db.insert(governedCalls).values({
        uniqueId:       event.uniqueId1,
        channelA,
        channelB,
        caller:         event.callerIdNum2,   // CLI — originating ANI (A-party)
        callee:         event.callerIdNum1,   // CLD — routed destination with routing prefix (B-party)
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

  // ── Prefix Registry ──────────────────────────────────────────────────────────

  // GET  /api/prefix-registry/vendors — list all canonical vendors + their product prefixes
  app.get('/api/prefix-registry/vendors', requireAuth, async (_req, res) => {
    try {
      const vendors = await db.select().from(canonicalVendors).orderBy(canonicalVendors.name);
      const prefixes = await db.select().from(vendorProductPrefixes).orderBy(vendorProductPrefixes.productCode);
      const prefixMap = new Map<number, typeof prefixes>();
      for (const p of prefixes) {
        if (!prefixMap.has(p.canonicalId)) prefixMap.set(p.canonicalId, []);
        prefixMap.get(p.canonicalId)!.push(p);
      }
      res.json(vendors.map(v => ({ ...v, prefixes: prefixMap.get(v.id) ?? [] })));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/prefix-registry/vendors — register a new vendor with auto-assigned prefix
  app.post('/api/prefix-registry/vendors', requireAuth, async (req, res) => {
    try {
      const { name, description } = req.body ?? {};
      if (!name?.trim()) return res.status(400).json({ error: 'name is required' });

      // Check name uniqueness
      const existing = await db.select({ id: canonicalVendors.id })
        .from(canonicalVendors).where(sql`lower(name) = lower(${name.trim()})`).limit(1);
      if (existing.length) return res.status(409).json({ error: `Vendor "${name.trim()}" already exists` });

      // Fetch all used prefixes and generate a unique 4-digit one
      const usedRows = await db.select({ vp: canonicalVendors.vendorPrefix }).from(canonicalVendors);
      const used = new Set(usedRows.map(r => r.vp));
      let vendorPrefix = '';
      let attempts = 0;
      while (attempts < 200) {
        const candidate = (Math.floor(Math.random() * 9000) + 1000).toString();
        if (!used.has(candidate)) { vendorPrefix = candidate; break; }
        attempts++;
      }
      if (!vendorPrefix) return res.status(500).json({ error: 'Prefix pool exhausted' });

      // Conflict check: ensure no existing governance rule destinationPrefix overlaps
      const govRules = await db.select({ dp: callGovernanceRules.destinationPrefix }).from(callGovernanceRules);
      for (const rule of govRules) {
        const dp = (rule.dp ?? '').replace(/\D/g, '');
        if (!dp) continue;
        if (vendorPrefix.startsWith(dp) || dp.startsWith(vendorPrefix)) {
          return res.status(409).json({
            error: `Generated prefix ${vendorPrefix} conflicts with governance rule prefix "${dp}". Retrying — please try again.`,
            conflict: true,
          });
        }
      }

      const performedBy = (req as any).user?.claims?.name ?? (req as any).user?.username ?? 'admin';

      const [vendor] = await db.insert(canonicalVendors).values({
        name: name.trim(), vendorPrefix, description: description?.trim() || null,
        status: 'active', createdBy: performedBy,
      }).returning();

      const products = [
        { productCode: '1', productName: 'FC - First Class'     },
        { productCode: '2', productName: 'BC - Business Class'  },
        { productCode: '6', productName: 'SB - Special Bravo'   },
        { productCode: '7', productName: 'SC - Special Charlie' },
      ];
      const insertedPrefixes = await db.insert(vendorProductPrefixes)
        .values(products.map(p => ({
          canonicalId: vendor.id, ...p,
          fullPrefix: vendorPrefix + p.productCode, status: 'active',
        }))).returning();

      await db.insert(prefixAuditLog).values({
        action: 'vendor_registered', canonicalId: vendor.id, vendorName: vendor.name,
        performedBy, details: { vendorPrefix, prefixes: insertedPrefixes.map(p => p.fullPrefix) },
      });

      res.json({ ...vendor, prefixes: insertedPrefixes });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // PATCH /api/prefix-registry/vendors/:id/status — suspend or retire a vendor
  app.patch('/api/prefix-registry/vendors/:id/status', requireAuth, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { status } = req.body ?? {};
      if (!['active', 'suspended', 'retired'].includes(status))
        return res.status(400).json({ error: 'status must be active | suspended | retired' });

      const [vendor] = await db.update(canonicalVendors)
        .set({ status, updatedAt: new Date() }).where(eq(canonicalVendors.id, id)).returning();
      if (!vendor) return res.status(404).json({ error: 'Vendor not found' });

      // Cascade status to product prefixes
      await db.update(vendorProductPrefixes).set({ status }).where(eq(vendorProductPrefixes.canonicalId, id));

      const performedBy = (req as any).user?.claims?.name ?? (req as any).user?.username ?? 'admin';
      await db.insert(prefixAuditLog).values({
        action: `vendor_${status}`, canonicalId: id, vendorName: vendor.name,
        performedBy, details: { previousStatus: vendor.status, newStatus: status },
      });

      res.json({ ok: true, vendor });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // PATCH /api/prefix-registry/prefixes/:id/status — suspend/retire a single product prefix
  app.patch('/api/prefix-registry/prefixes/:id/status', requireAuth, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { status } = req.body ?? {};
      if (!['active', 'suspended', 'retired'].includes(status))
        return res.status(400).json({ error: 'status must be active | suspended | retired' });

      const [prefix] = await db.update(vendorProductPrefixes)
        .set({ status }).where(eq(vendorProductPrefixes.id, id)).returning();
      if (!prefix) return res.status(404).json({ error: 'Prefix not found' });

      const vendor = await db.select({ name: canonicalVendors.name })
        .from(canonicalVendors).where(eq(canonicalVendors.id, prefix.canonicalId)).limit(1);
      const performedBy = (req as any).user?.claims?.name ?? (req as any).user?.username ?? 'admin';
      await db.insert(prefixAuditLog).values({
        action: `prefix_${status}`, canonicalId: prefix.canonicalId,
        vendorName: vendor[0]?.name, fullPrefix: prefix.fullPrefix,
        performedBy, details: { productCode: prefix.productCode, productName: prefix.productName },
      });

      res.json({ ok: true, prefix });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/prefix-registry/audit — audit log (most recent 200)
  app.get('/api/prefix-registry/audit', requireAuth, async (_req, res) => {
    try {
      const rows = await db.select().from(prefixAuditLog)
        .orderBy(desc(prefixAuditLog.createdAt)).limit(200);
      res.json(rows);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/prefix-registry/conflict-check?prefix=XXXX — check a prefix for conflicts
  app.get('/api/prefix-registry/conflict-check', requireAuth, async (req, res) => {
    try {
      const prefix = String(req.query.prefix ?? '').replace(/\D/g, '');
      if (!prefix) return res.status(400).json({ error: 'prefix param required' });

      const conflicts: string[] = [];

      // Check existing vendor prefixes
      const vendors = await db.select({ vp: canonicalVendors.vendorPrefix, name: canonicalVendors.name })
        .from(canonicalVendors);
      for (const v of vendors) {
        if (prefix.startsWith(v.vp) || v.vp.startsWith(prefix))
          conflicts.push(`Overlaps with vendor ${v.name} (prefix ${v.vp})`);
      }

      // Check existing governance rule prefixes
      const rules = await db.select({ dp: callGovernanceRules.destinationPrefix, rn: callGovernanceRules.ruleName })
        .from(callGovernanceRules);
      for (const r of rules) {
        const dp = (r.dp ?? '').replace(/\D/g, '');
        if (dp && (prefix.startsWith(dp) || dp.startsWith(prefix)))
          conflicts.push(`Overlaps with governance rule "${r.rn ?? dp}" (prefix ${dp})`);
      }

      res.json({ prefix, conflicts, safe: conflicts.length === 0 });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── GET /api/call-governance/live-monitor ───────────────────────────────────
  // Real-time governance dashboard: active calls, today's KPIs, recent cut
  // windows, hourly chart, and raw calls today for client-side LPM grouping.
  // All data is read-only — no writes performed.
  app.get('/api/call-governance/live-monitor', requireAuth, async (req: any, res: any) => {
    try {
      // 1. In-flight calls (status = 'active', timer pending)
      const activeResult = await db.execute(sql`
        SELECT
          gc.id,
          gc.callee,
          gc.caller,
          gc.start_time,
          gc.cap_sec,
          gc.channel_b,
          r.rule_name,
          r.connection_name,
          EXTRACT(EPOCH FROM (NOW() - gc.start_time))::int AS elapsed_sec
        FROM governed_calls gc
        LEFT JOIN call_governance_rules r ON r.id = gc.rule_id
        WHERE gc.status = 'active'
        ORDER BY gc.start_time ASC
      `);

      // 2. Recent cut windows (5 / 15 / 30 min)
      const recentResult = await db.execute(sql`
        SELECT
          COUNT(CASE WHEN bye_sent_at >= NOW() - INTERVAL  '5 minutes' THEN 1 END)  AS cuts_5min,
          COUNT(CASE WHEN bye_sent_at >= NOW() - INTERVAL '15 minutes' THEN 1 END)  AS cuts_15min,
          COUNT(CASE WHEN bye_sent_at >= NOW() - INTERVAL '30 minutes' THEN 1 END)  AS cuts_30min,
          ROUND(COALESCE(SUM(
            CASE WHEN bye_sent_at >= NOW() - INTERVAL '30 minutes'
              THEN EXTRACT(EPOCH FROM (bye_sent_at - start_time)) / 60.0 ELSE 0 END
          ), 0)::numeric, 2)                                                         AS gov_min_30min,
          ROUND(COALESCE(SUM(
            CASE WHEN bye_sent_at >= NOW() - INTERVAL  '5 minutes'
              THEN EXTRACT(EPOCH FROM (bye_sent_at - start_time)) / 60.0 ELSE 0 END
          ), 0)::numeric, 2)                                                         AS gov_min_5min
        FROM governed_calls
        WHERE bye_sent_at >= NOW() - INTERVAL '30 minutes'
      `);

      // 3. Today's KPIs (from midnight UTC)
      const todayResult = await db.execute(sql`
        SELECT
          COUNT(*)                                                              AS total_today,
          COUNT(bye_sent_at)                                                    AS cut_today,
          COUNT(CASE WHEN bye_sent_at IS NULL THEN 1 END)                      AS passed_today,
          ROUND(COALESCE(SUM(
            CASE WHEN bye_sent_at IS NOT NULL
              THEN EXTRACT(EPOCH FROM (bye_sent_at - start_time)) / 60.0 ELSE 0 END
          ), 0)::numeric, 2)                                                   AS gov_min_today,
          ROUND(COALESCE(AVG(
            CASE WHEN bye_sent_at IS NOT NULL
              THEN EXTRACT(EPOCH FROM (bye_sent_at - start_time)) ELSE NULL END
          ), 0)::numeric, 1)                                                   AS avg_cut_sec_today,
          COUNT(CASE WHEN start_time >= NOW() - INTERVAL '1 hour' THEN 1 END)  AS total_1h,
          COUNT(CASE WHEN bye_sent_at >= NOW() - INTERVAL '1 hour' THEN 1 END) AS cut_1h
        FROM governed_calls
        WHERE start_time >= date_trunc('day', NOW())
      `);

      // 4. Hourly cut buckets for today's activity chart
      const hourlyResult = await db.execute(sql`
        SELECT
          EXTRACT(HOUR FROM bye_sent_at)::int              AS hour,
          COUNT(*)                                          AS cuts,
          ROUND(SUM(
            EXTRACT(EPOCH FROM (bye_sent_at - start_time)) / 60.0
          )::numeric, 2)                                   AS gov_min
        FROM governed_calls
        WHERE bye_sent_at >= date_trunc('day', NOW())
        GROUP BY 1
        ORDER BY 1
      `);

      // 5. Raw today calls for client-side LPM destination grouping (most recent first, capped)
      const callsTodayResult = await db.execute(sql`
        SELECT
          gc.callee,
          gc.rule_id,
          COALESCE(r.rule_name, r.connection_name, 'Rule ' || gc.rule_id::text) AS rule_name,
          bye_sent_at IS NOT NULL                                               AS is_cut,
          CASE WHEN bye_sent_at IS NOT NULL
            THEN EXTRACT(EPOCH FROM (bye_sent_at - start_time)) ELSE NULL END  AS gov_sec
        FROM governed_calls gc
        LEFT JOIN call_governance_rules r ON r.id = gc.rule_id
        WHERE gc.start_time >= date_trunc('day', NOW())
        ORDER BY gc.start_time DESC
        LIMIT 2000
      `);

      res.json({
        activeNow:  activeResult.rows,
        recent:     recentResult.rows[0]  ?? {},
        todayKpi:   todayResult.rows[0]   ?? {},
        hourly:     hourlyResult.rows,
        calls:      callsTodayResult.rows,
        fetchedAt:  new Date().toISOString(),
      });
    } catch (err: any) {
      console.error('[call-governance] live-monitor error:', err?.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/call-governance/analytics ──────────────────────────────────────
  // Read-only aggregation of governed_calls for the Analytics dashboard.
  // ?period=daily (24h) | weekly (7d) | monthly (30d)
  // No schema changes — all fields already exist in governed_calls.
  app.get('/api/call-governance/analytics', requireAuth, async (req: any, res: any) => {
    try {
      const period = String(req.query.period ?? 'daily');
      const now = new Date();
      let periodStart: Date;
      let bucketUnit: string;

      if (period === 'weekly') {
        periodStart = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
        bucketUnit = 'day';
      } else if (period === 'monthly') {
        periodStart = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
        bucketUnit = 'day';
      } else {
        periodStart = new Date(now.getTime() - 24 * 3600 * 1000);
        bucketUnit = 'hour';
      }

      // 1. Overall KPI totals
      const kpiResult = await db.execute(sql`
        SELECT
          COUNT(*)                                                          AS total_calls,
          COUNT(bye_sent_at)                                                AS calls_governed,
          COUNT(CASE WHEN bye_sent_at IS NULL THEN 1 END)                  AS calls_passed,
          ROUND(COALESCE(SUM(
            CASE WHEN bye_sent_at IS NOT NULL
              THEN EXTRACT(EPOCH FROM (bye_sent_at - start_time)) / 60.0
              ELSE 0 END
          ), 0)::numeric, 2)                                               AS governance_minutes,
          ROUND(COALESCE(SUM(cdr_duration) / 60.0, 0)::numeric, 2)        AS vendor_minutes,
          COUNT(CASE WHEN cdr_duration IS NOT NULL THEN 1 END)             AS cdr_resolved,
          -- Saved Minutes: cap_sec minus actual cut duration per governed call.
          -- Represents vendor minutes PREVENTED (e.g. cap=120s cut at 10s → saved=110s).
          ROUND(COALESCE(SUM(
            CASE WHEN bye_sent_at IS NOT NULL AND cap_sec IS NOT NULL
              THEN GREATEST(0, cap_sec - EXTRACT(EPOCH FROM (bye_sent_at - start_time))) / 60.0
              ELSE 0 END
          ), 0)::numeric, 2)                                               AS saved_minutes,
          -- Potential Minutes: sum of cap_sec for all governed (cut) calls.
          -- Denominator for Governance Efficiency %.
          ROUND(COALESCE(SUM(
            CASE WHEN bye_sent_at IS NOT NULL AND cap_sec IS NOT NULL
              THEN cap_sec / 60.0 ELSE 0 END
          ), 0)::numeric, 2)                                               AS potential_minutes
        FROM governed_calls
        WHERE start_time >= ${periodStart}
      `);

      // 2. Per-rule breakdown
      const ruleResult = await db.execute(sql`
        SELECT
          gc.rule_id,
          r.rule_name,
          r.connection_name,
          r.destination_prefix,
          r.cap_sec,
          COUNT(*)                                                          AS calls_matched,
          COUNT(gc.bye_sent_at)                                             AS calls_cut,
          COUNT(CASE WHEN gc.bye_sent_at IS NULL THEN 1 END)               AS calls_passed,
          ROUND(COALESCE(SUM(
            CASE WHEN gc.bye_sent_at IS NOT NULL
              THEN EXTRACT(EPOCH FROM (gc.bye_sent_at - gc.start_time)) / 60.0
              ELSE 0 END
          ), 0)::numeric, 2)                                               AS gov_minutes,
          ROUND(COALESCE(AVG(
            CASE WHEN gc.bye_sent_at IS NOT NULL
              THEN EXTRACT(EPOCH FROM (gc.bye_sent_at - gc.start_time))
              ELSE NULL END
          ), 0)::numeric, 1)                                               AS avg_cut_sec,
          ROUND(COALESCE(SUM(gc.cdr_duration) / 60.0, 0)::numeric, 2)     AS vendor_minutes,
          MAX(gc.start_time)                                                AS last_triggered
        FROM governed_calls gc
        LEFT JOIN call_governance_rules r ON r.id = gc.rule_id
        WHERE gc.start_time >= ${periodStart}
        GROUP BY gc.rule_id, r.rule_name, r.connection_name, r.destination_prefix, r.cap_sec
        ORDER BY calls_matched DESC
      `);

      // 3. Time-series trend buckets (hourly for daily period, daily for weekly/monthly)
      const trendResult = await db.execute(sql`
        SELECT
          date_trunc(${bucketUnit}, start_time)   AS bucket,
          COUNT(*)                                 AS calls,
          COUNT(bye_sent_at)                       AS governed,
          ROUND(COALESCE(SUM(
            CASE WHEN bye_sent_at IS NOT NULL
              THEN EXTRACT(EPOCH FROM (bye_sent_at - start_time)) / 60.0
              ELSE 0 END
          ), 0)::numeric, 2)                       AS gov_minutes
        FROM governed_calls
        WHERE start_time >= ${periodStart}
        GROUP BY 1
        ORDER BY 1
      `);

      // 4. Raw governed calls for client-side destination LPM grouping (capped at 5000)
      const callsResult = await db.execute(sql`
        SELECT
          callee,
          bye_sent_at,
          start_time,
          cdr_duration,
          cap_sec,
          status,
          rule_id
        FROM governed_calls
        WHERE start_time >= ${periodStart}
        ORDER BY start_time DESC
        LIMIT 5000
      `);

      res.json({
        period,
        periodStart: periodStart.toISOString(),
        kpi:   kpiResult.rows[0]   ?? {},
        rules: ruleResult.rows     ?? [],
        trend: trendResult.rows    ?? [],
        calls: callsResult.rows    ?? [],
      });
    } catch (e: any) {
      console.error('[analytics]', e);
      res.status(500).json({ error: e.message });
    }
  });

  // ── Reconciliation Lab: Recording Integrity ───────────────────────────────
  // GET /api/recon-lab/recording-integrity?days=7
  // Returns governed calls with recording path status. Batch-checks files via SSH.
  app.get('/api/recon-lab/recording-integrity', requireAdmin, async (req: any, res: any) => {
    try {
      const days = Math.min(Number(req.query.days) || 7, 30);
      const since = new Date(Date.now() - days * 86400_000);

      const rows = await db
        .select()
        .from(governedCalls)
        .where(and(gte(governedCalls.startTime, since)))
        .orderBy(desc(governedCalls.startTime))
        .limit(500);

      const completed = rows.filter((r: any) => r.byeSentAt);
      const withPath  = completed.filter((r: any) => r.recordingPath);
      const noPath    = completed.filter((r: any) => !r.recordingPath);

      // Attempt SSH batch file-stat for calls with a recording path (up to 100)
      const toCheck = withPath.slice(0, 100);
      const fileStats: Record<number, { exists: boolean; size: number; error?: string }> = {};

      if (toCheck.length > 0) {
        const host     = process.env.ASTERISK_HOST     ?? '159.223.32.59';
        const user     = process.env.ASTERISK_SSH_USER ?? 'root';
        const password = process.env.ASTERISK_SSH_PASSWORD ?? '';

        if (password) {
          await new Promise<void>((resolve) => {
            const conn = new SshClient();
            conn.on('ready', () => {
              conn.sftp((err, sftp) => {
                if (err) { conn.end(); resolve(); return; }
                let pending = toCheck.length;
                const done = () => { if (--pending === 0) { conn.end(); resolve(); } };
                for (const row of toCheck) {
                  const fp = row.recordingPath!;
                  sftp.stat(fp, (statErr, stat) => {
                    fileStats[row.id] = statErr
                      ? { exists: false, size: 0, error: statErr.message }
                      : { exists: true, size: stat.size };
                    done();
                  });
                }
              });
            });
            conn.on('error', () => resolve());
            conn.connect({ host, port: 22, username: user, password, readyTimeout: 8000 });
          });
        }
      }

      const calls = completed.map((r: any) => {
        const stat = fileStats[r.id];
        let fileStatus = 'no_path';
        if (r.recordingPath) {
          if (stat === undefined) fileStatus = 'unchecked';
          else if (stat.exists && stat.size > 0) fileStatus = 'ok';
          else if (stat.exists && stat.size === 0) fileStatus = 'empty';
          else fileStatus = 'missing';
        }
        return {
          id: r.id,
          caller: r.caller,
          callee: r.callee,
          startTime: r.startTime,
          byeSentAt: r.byeSentAt,
          recordingPath: r.recordingPath,
          fileStatus,
          fileSize: stat?.size ?? null,
          fileError: stat?.error ?? null,
        };
      });

      const summary = {
        total: completed.length,
        hasPath: withPath.length,
        noPath: noPath.length,
        fileOk: calls.filter((c: any) => c.fileStatus === 'ok').length,
        fileMissing: calls.filter((c: any) => c.fileStatus === 'missing').length,
        fileEmpty: calls.filter((c: any) => c.fileStatus === 'empty').length,
        unchecked: calls.filter((c: any) => c.fileStatus === 'unchecked').length,
        successPct: completed.length > 0
          ? Math.round(calls.filter((c: any) => c.fileStatus === 'ok').length / completed.length * 100)
          : 0,
      };

      res.json({ summary, calls });
    } catch (e: any) {
      console.error('[recon-lab/recording-integrity]', e);
      res.status(500).json({ error: e.message });
    }
  });

  // ── Reconciliation Lab: CDR Reconciliation ────────────────────────────────
  // GET /api/recon-lab/cdr-reconciliation?days=7
  // Returns governed calls unified with CDR/P&L data.
  app.get('/api/recon-lab/cdr-reconciliation', requireAdmin, async (req: any, res: any) => {
    try {
      const days = Math.min(Number(req.query.days) || 7, 30);
      const since = new Date(Date.now() - days * 86400_000);

      const rows = await db
        .select()
        .from(governedCalls)
        .where(and(gte(governedCalls.startTime, since)))
        .orderBy(desc(governedCalls.startTime))
        .limit(500);

      const cdrCache = _getGlobalCdrCache();

      const calls = rows.map((r: any) => {
        // Determine match status
        let matchStatus = 'pending';
        if (r.byeSentAt) {
          if (r.cdrStatus === 'ok') matchStatus = 'matched';
          else if (r.cdrStatus === 'no_cdr') matchStatus = 'missing';
          else if (r.cdrStatus) matchStatus = 'partial';
          else matchStatus = 'pending';
        }

        // Check if Call-ID exists in cdrCache (customer CDR)
        let customerCdrFound = false;
        let customerCdrEntry: any = null;
        if (cdrCache && r.vendorCallId) {
          const callIdNorm = (r.vendorCallId || '').replace(/^<|>$/g, '').trim();
          for (const entry of cdrCache.values()) {
            const entryCallId = (entry.callId || '').replace(/^<|>$/g, '').trim();
            if (entryCallId && entryCallId === callIdNorm) {
              customerCdrFound = true;
              customerCdrEntry = entry;
              break;
            }
          }
        }

        return {
          id: r.id,
          caller: r.caller,
          callee: r.callee,
          startTime: r.startTime,
          byeSentAt: r.byeSentAt,
          status: r.status,
          matchStatus,
          // Governed / P&L data
          cdrStatus: r.cdrStatus,
          cdrCost: r.cdrCost,
          cdrVendorCost: r.cdrVendorCost,
          cdrVendorName: r.cdrVendorName,
          cdrCaller: r.cdrCaller,
          cdrCallee: r.cdrCallee,
          cdrDuration: r.cdrDuration,
          cdrCheckedAt: r.cdrCheckedAt,
          // Customer CDR (from cdrCache)
          customerCdrFound,
          customerCdrCli: customerCdrEntry?.caller ?? null,
          customerCdrCld: customerCdrEntry?.callee ?? null,
          customerCdrCost: customerCdrEntry?.cost ?? null,
          customerCdrCallId: customerCdrEntry?.callId ?? null,
          // Identity
          vendorCallId: r.vendorCallId,
          uniqueId: r.uniqueId,
        };
      });

      const completed = calls.filter((c: any) => c.byeSentAt);
      const summary = {
        total: rows.length,
        completed: completed.length,
        matched: completed.filter((c: any) => c.matchStatus === 'matched').length,
        missing: completed.filter((c: any) => c.matchStatus === 'missing').length,
        partial: completed.filter((c: any) => c.matchStatus === 'partial').length,
        pending: calls.filter((c: any) => c.matchStatus === 'pending').length,
        matchRatePct: completed.length > 0
          ? Math.round(completed.filter((c: any) => c.matchStatus === 'matched').length / completed.length * 100)
          : 0,
        customerCdrFound: calls.filter((c: any) => c.customerCdrFound).length,
      };

      res.json({ summary, calls });
    } catch (e: any) {
      console.error('[recon-lab/cdr-reconciliation]', e);
      res.status(500).json({ error: e.message });
    }
  });

  // ── Reconciliation Lab: Identity Audit ────────────────────────────────────
  // GET /api/recon-lab/identity-audit?limit=50
  // Audits cross-system call identity: which fields survive Governed→CDR→P&L.
  app.get('/api/recon-lab/identity-audit', requireAdmin, async (req: any, res: any) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const since = new Date(Date.now() - 7 * 86400_000);

      const rows = await db
        .select()
        .from(governedCalls)
        .where(and(gte(governedCalls.startTime, since), sql`bye_sent_at IS NOT NULL`))
        .orderBy(desc(governedCalls.startTime))
        .limit(limit);

      const cdrCache = _getGlobalCdrCache();
      const cacheArr = cdrCache ? Array.from(cdrCache.values()) : [];

      const calls = rows.map((r: any) => {
        const callIdNorm = (r.vendorCallId || '').replace(/^<|>$/g, '').trim();

        // Check Call-ID in customer CDR (cdrCache)
        const callIdInCustomerCdr = callIdNorm
          ? cacheArr.some((e: any) => (e.callId || '').replace(/^<|>$/g, '').trim() === callIdNorm)
          : false;

        // Check Call-ID in P&L (DB — cdrCallee populated by Track2b = P&L match confirmed)
        const callIdInPnl = !!r.cdrStatus && r.cdrStatus === 'ok';

        // Check Original CLD in customer CDR
        const callee = (r.callee || '').replace(/\D/g, '');
        const suffix10 = callee.slice(-10);
        const cldInCustomerCdr = suffix10.length >= 8
          ? cacheArr.some((e: any) => (e.callee || '').replace(/\D/g, '').endsWith(suffix10))
          : false;

        // Check CLI in customer CDR
        const caller = (r.caller || '').replace(/\D/g, '');
        const cliInCustomerCdr = caller.length >= 7
          ? cacheArr.some((e: any) => (e.caller || '').replace(/\D/g, '') === caller)
          : false;

        // Determine product prefix from callee
        const stripped = callee.replace(/^2060/, '');
        const productPrefix = stripped.startsWith('1') ? '1 (FC)' :
                              stripped.startsWith('2') ? '2 (BC)' :
                              stripped.startsWith('6') ? '6 (SB)' :
                              stripped.startsWith('7') ? '7 (SC)' : '?';

        return {
          id: r.id,
          startTime: r.startTime,
          caller: r.caller,
          callee: r.callee,
          productPrefix,
          // Identity fields
          vendorCallId: r.vendorCallId || null,
          asteriskUniqueId: r.uniqueId || null,
          // Cross-system presence
          callIdInGovernedCall: !!r.vendorCallId,
          callIdInCustomerCdr,
          callIdInPnl,
          cldInCustomerCdr,
          cliInCustomerCdr,
          // CDR status
          cdrStatus: r.cdrStatus,
          cdrCost: r.cdrCost,
        };
      });

      // Aggregate: how often does each field span systems?
      const total = calls.length;
      const summary = {
        total,
        callIdCoverage: {
          governedCall: calls.filter((c: any) => c.callIdInGovernedCall).length,
          customerCdr:  calls.filter((c: any) => c.callIdInCustomerCdr).length,
          pnl:          calls.filter((c: any) => c.callIdInPnl).length,
        },
        cldCoverage: {
          customerCdr: calls.filter((c: any) => c.cldInCustomerCdr).length,
        },
        cliCoverage: {
          customerCdr: calls.filter((c: any) => c.cliInCustomerCdr).length,
        },
        recommendation: (() => {
          const callIdSpansAll = calls.filter((c: any) => c.callIdInGovernedCall && c.callIdInCustomerCdr).length;
          if (callIdSpansAll / Math.max(total, 1) > 0.8) return 'Call-ID — spans Governed + Customer CDR (>80%). Use as reconciliation key.';
          if (calls.filter((c: any) => c.cldInCustomerCdr).length / Math.max(total, 1) > 0.8) return 'Original CLD — spans Governed + Customer CDR (>80%). Use suffix-10 as fallback key.';
          return 'No single field spans all systems reliably. CCI (call_uuid) required as master key.';
        })(),
      };

      res.json({ summary, calls });
    } catch (e: any) {
      console.error('[recon-lab/identity-audit]', e);
      res.status(500).json({ error: e.message });
    }
  });

  // ── Reconciliation Lab: Vendor Cost Validation ───────────────────────────
  // GET /api/recon-lab/vendor-cost?days=7
  // Shows P&L cost vs vendor cost per call. Diagnoses whether vendor cost is
  // being extracted from the P&L scraper.
  app.get('/api/recon-lab/vendor-cost', requireAdmin, async (req: any, res: any) => {
    try {
      const days = Math.min(Number(req.query.days) || 7, 30);
      const since = new Date(Date.now() - days * 86400_000);

      const rows = await db
        .select()
        .from(governedCalls)
        .where(and(gte(governedCalls.startTime, since), sql`cdr_status IS NOT NULL`))
        .orderBy(desc(governedCalls.startTime))
        .limit(500);

      const calls = rows.map((r: any) => {
        const cost       = r.cdrCost       !== null ? Number(r.cdrCost)       : null;
        const vendorCost = r.cdrVendorCost !== null ? Number(r.cdrVendorCost) : null;
        const dur        = r.cdrDuration   !== null ? Number(r.cdrDuration)   : null;
        const effectiveRatePerMin = (cost !== null && dur !== null && dur > 0)
          ? cost / (dur / 60)
          : null;
        const margin = (cost !== null && vendorCost !== null) ? cost - vendorCost : null;
        const marginPct = (margin !== null && cost !== null && cost > 0)
          ? (margin / cost) * 100
          : null;

        return {
          id: r.id,
          caller: r.caller,
          callee: r.callee,
          cdrCallee: r.cdrCallee,
          startTime: r.startTime,
          cdrStatus: r.cdrStatus,
          cdrCost: cost,
          cdrVendorCost: vendorCost,
          cdrVendorName: r.cdrVendorName,
          cdrDuration: dur,
          effectiveRatePerMin,
          margin,
          marginPct,
          marginFlag: margin !== null ? (margin < 0 ? 'negative' : margin === 0 ? 'zero' : 'ok') : 'no_vendor_cost',
        };
      });

      const resolved = calls.filter((c: any) => c.cdrStatus === 'ok');
      const withVendor = resolved.filter((c: any) => c.cdrVendorCost !== null);
      const negMargin = withVendor.filter((c: any) => c.marginFlag === 'negative');
      const avgMarginPct = withVendor.length > 0
        ? withVendor.reduce((s: number, c: any) => s + (c.marginPct ?? 0), 0) / withVendor.length
        : null;

      const summary = {
        total: rows.length,
        resolved: resolved.length,
        withVendorCost: withVendor.length,
        vendorCostGap: resolved.length - withVendor.length,
        negativeMargin: negMargin.length,
        avgMarginPct: avgMarginPct !== null ? Math.round(avgMarginPct * 10) / 10 : null,
        vendorCostPopulated: withVendor.length > 0,
        // P3.1 applied: scrapePnlCallRows now emits vendorCost from the Cost,USD column.
        // Calls resolved AFTER this fix will have cdrVendorCost populated automatically.
        // Calls resolved BEFORE this fix (cdrVendorCost=NULL) need a forced P&L backfill,
        // but those calls are beyond the portal 2-hour window so re-scrape won't find them.
        gapReason: withVendor.length === 0 && resolved > 0
          ? 'P3.1 fix is live — vendor cost will populate for all new resolved calls. Historical calls (resolved before P3.1) cannot be backfilled via the portal (beyond 2-hour visibility window). Trigger a forced billing-backfill only for calls within the last 2 hours.'
          : withVendor.length === 0 && resolved === 0
          ? 'No P&L-resolved calls in this window yet.'
          : null,
      };

      res.json({ summary, calls });
    } catch (e: any) {
      console.error('[recon-lab/vendor-cost]', e);
      res.status(500).json({ error: e.message });
    }
  });

  // ── Reconciliation Lab: Commercial Identity Audit ─────────────────────────
  // GET /api/recon-lab/commercial-identity?days=7
  // Shows original CLD → product prefix → product → effective rate per call.
  // Product prefix is read from cdrCallee (P&L CLD) — first digit = trunk prefix.
  app.get('/api/recon-lab/commercial-identity', requireAdmin, async (req: any, res: any) => {
    try {
      const days = Math.min(Number(req.query.days) || 7, 30);
      const since = new Date(Date.now() - days * 86400_000);

      // Load all products once
      const products = await db.select().from(productRegistry);
      const prefixMap: Record<string, typeof products[0]> = {};
      for (const p of products) {
        if (p.trunkPrefix) prefixMap[p.trunkPrefix] = p;
      }

      const rows = await db
        .select()
        .from(governedCalls)
        .where(and(gte(governedCalls.startTime, since), sql`bye_sent_at IS NOT NULL`))
        .orderBy(desc(governedCalls.startTime))
        .limit(500);

      const calls = rows.map((r: any) => {
        const cost = r.cdrCost     !== null ? Number(r.cdrCost)     : null;
        const dur  = r.cdrDuration !== null ? Number(r.cdrDuration) : null;

        // Extract product prefix from cdrCallee (first digit of P&L CLD)
        const cdrCallee = (r.cdrCallee as string | null) ?? null;
        let detectedPrefix: string | null = null;
        if (cdrCallee) {
          const digits = cdrCallee.replace(/\D/g, '');
          const firstDigit = digits[0];
          if (firstDigit && prefixMap[firstDigit]) {
            detectedPrefix = firstDigit;
          }
        }

        const product = detectedPrefix ? prefixMap[detectedPrefix] ?? null : null;
        const effectiveRatePerMin = (cost !== null && dur !== null && dur > 0)
          ? cost / (dur / 60)
          : null;

        // Determine identity confidence
        let confidence: string;
        if (r.cdrStatus === 'ok' && detectedPrefix && product) {
          confidence = 'confirmed';
        } else if (r.cdrStatus === 'ok' && !detectedPrefix) {
          confidence = 'resolved_no_prefix';
        } else if (r.cdrStatus === 'no_cdr') {
          confidence = 'no_p&l_match';
        } else {
          confidence = 'pending';
        }

        return {
          id: r.id,
          caller: r.caller,
          callee: r.callee,                // Raw CLD from Asterisk (has 2060 routing prefix)
          cdrCallee,                        // P&L CLD — original customer-dialed number
          startTime: r.startTime,
          cdrStatus: r.cdrStatus,
          detectedPrefix,
          productCode: product?.code ?? null,
          productName: product?.name ?? null,
          productColor: product?.color ?? null,
          productStatus: product?.status ?? null,
          minMarginPct: product?.minMarginPct ?? null,
          effectiveRatePerMin,
          cdrCost: cost,
          cdrDuration: dur,
          confidence,
        };
      });

      // Breakdown by product
      const confirmed = calls.filter((c: any) => c.confidence === 'confirmed');
      const productBreakdown: Record<string, number> = {};
      for (const c of confirmed) {
        const key = c.productCode ?? 'unknown';
        productBreakdown[key] = (productBreakdown[key] ?? 0) + 1;
      }

      const summary = {
        total: calls.length,
        confirmed: confirmed.length,
        resolvedNoPrefix: calls.filter((c: any) => c.confidence === 'resolved_no_prefix').length,
        noPnlMatch: calls.filter((c: any) => c.confidence === 'no_p&l_match').length,
        pending: calls.filter((c: any) => c.confidence === 'pending').length,
        productBreakdown,
        avgEffectiveRateByProduct: (() => {
          const byProduct: Record<string, number[]> = {};
          for (const c of confirmed) {
            if (c.effectiveRatePerMin !== null && c.productCode) {
              byProduct[c.productCode] = byProduct[c.productCode] ?? [];
              byProduct[c.productCode].push(c.effectiveRatePerMin);
            }
          }
          const result: Record<string, number> = {};
          for (const [k, arr] of Object.entries(byProduct)) {
            result[k] = arr.reduce((a, b) => a + b, 0) / arr.length;
          }
          return result;
        })(),
      };

      res.json({ summary, calls });
    } catch (e: any) {
      console.error('[recon-lab/commercial-identity]', e);
      res.status(500).json({ error: e.message });
    }
  });

  console.log('[call-governance] Routes registered');
}
