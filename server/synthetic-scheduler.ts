/**
 * Synthetic Testing Scheduler
 *
 * Ticks every 60 seconds.  For each enabled campaign with intervalMinutes set
 * and nextRunAt <= now, executes the full call sequence, computes ASR,
 * updates the rolling baseline, records a SyntheticTestRun, writes a
 * RouteDecisionTrace per call, and injects AI Ops signals:
 *   • SYNTHETIC_TEST_ASR_DROP  — run ASR drops ≥15 pp below baseline
 *   • SYNTHETIC_FAILURE        — individual call fails (SIP ≥ 400)
 *   • HIGH_PDD                 — PDD > 5000 ms on a connected call
 */

import { eq, desc } from 'drizzle-orm';
import * as sippy from './sippy';
import type { IStorage } from './storage';
import { db } from './db';
import { aiOpsEvents, syntheticTestRuns, routingGroupsCache, connectionVendorCache2 } from '../shared/schema';

const DEFAULT_SIPPY_URL = 'https://191.101.30.107';
function _sippyPortalUrl(s: { portalUrl?: string | null }): string {
  return s.portalUrl || DEFAULT_SIPPY_URL;
}

let _storage: IStorage | null = null;
let _timer: ReturnType<typeof setInterval> | null = null;
let _running = false;

// ── Public init ───────────────────────────────────────────────────────────────
export function initSyntheticScheduler(storage: IStorage): void {
  _storage = storage;
  if (_timer) clearInterval(_timer);
  _timer = setInterval(_tick, 60_000);
  setTimeout(_tick, 5_000);
  console.log('[synthetic-scheduler] Started — checking every 60s');
}

// ── Scheduler tick ────────────────────────────────────────────────────────────
async function _tick(): Promise<void> {
  if (_running || !_storage) return;
  _running = true;
  try {
    const campaigns = await _storage.getCampaignsDueForRun();
    if (campaigns.length) {
      console.log(`[synthetic-scheduler] ${campaigns.length} campaign(s) due`);
    }
    for (const campaign of campaigns) {
      await _executeCampaign(campaign).catch(err =>
        console.error(`[synthetic-scheduler] Campaign ${campaign.id} error:`, err.message)
      );
    }
  } finally {
    _running = false;
  }
}

// ── Execute one campaign ──────────────────────────────────────────────────────
async function _executeCampaign(campaign: any): Promise<void> {
  if (!_storage) return;

  const destinations: Array<{ cld: string; cli?: string; label?: string }> =
    JSON.parse(campaign.destinations || '[]');
  if (!destinations.length) return;

  // Advance nextRunAt immediately to prevent duplicate fires
  const nextRunAt = _computeNextRunAt(campaign);
  await _storage.updateTestCampaign(campaign.id, {
    status: 'running',
    lastRunAt: new Date(),
    nextRunAt,
  } as any);

  // Create a run record
  const [runRow] = await db.insert(syntheticTestRuns).values({
    campaignId:       campaign.id,
    startedAt:        new Date(),
    totalCalls:       destinations.length,
    baselineAsrAtRun: campaign.baselineAsr ?? null,
    triggeredBy:      'scheduler',
  }).returning();

  let connected = 0, failed = 0, totalPdd = 0, pddCount = 0;

  const sSettings = await _storage.getSippySettings();
  const portalUrl  = sSettings ? _sippyPortalUrl(sSettings) : '';

  // Pre-fetch routing candidates once (used for all destinations)
  const routingCandidates = await _fetchRoutingCandidates();

  for (const dest of destinations) {
    try {
      let outcome: string = 'failed';
      let sipCode: number | undefined;
      let durationSec = 0;
      let pddMs = 0;

      if (sSettings?.portalUrl) {
        const ctcResult = await sippy.makeTestCall(
          sSettings.apiAdminUsername,
          sSettings.apiAdminPassword,
          { cld: dest.cld, cli: dest.cli || '100', maxDuration: 10 },
          portalUrl
        ).catch(() => null);
        if (ctcResult) {
          outcome     = ctcResult.connected ? 'connected' : 'failed';
          sipCode     = ctcResult.sipCode;
          durationSec = ctcResult.duration ?? 0;
          pddMs       = ctcResult.pdd ?? 0;
        }
      }

      await _storage.addCampaignResult({
        campaignId:  campaign.id,
        cld:         dest.cld,
        cli:         dest.cli,
        label:       dest.label,
        outcome,
        sipCode,
        durationSec,
        pddMs,
        fasDetected: durationSec > 0 && durationSec < 4,
      });

      // ── Route Decision Trace ──────────────────────────────────────────────
      const { selectedCarrier, selectedCarrierId, candidates, decisionReason } =
        _resolveRouteDecision(dest.cld, outcome, sipCode, routingCandidates);

      await _storage.addRouteDecisionTrace({
        campaignId:        campaign.id,
        runId:             runRow.id,
        cld:               dest.cld,
        cli:               dest.cli,
        selectedCarrier,
        selectedCarrierId,
        candidateRoutes:   JSON.stringify(candidates),
        decisionReason,
        outcome,
        sipCode,
        pddMs:             pddMs > 0 ? pddMs : null,
        durationSec:       durationSec > 0 ? durationSec : null,
        failureCategory:   outcome === 'failed' ? _classifyFailure(sipCode) : null,
      });

      // ── Per-call AI Ops signals ───────────────────────────────────────────
      if (outcome === 'failed' && sipCode && sipCode >= 400) {
        await db.insert(aiOpsEvents).values({
          type:     'SYNTHETIC_FAILURE',
          severity: sipCode >= 500 ? 'high' : 'medium',
          message:  `Synthetic call to ${dest.cld} failed with SIP ${sipCode} (campaign "${campaign.name}"). Carrier: ${selectedCarrier ?? 'unknown'}. Failure: ${_classifyFailure(sipCode)}.`,
          entity:   `synthetic_campaign:${campaign.id}`,
          value:    String(sipCode),
          source:   'synthetic_scheduler',
        }).catch(() => {});
      }

      if (outcome === 'connected' && pddMs > 5000) {
        await db.insert(aiOpsEvents).values({
          type:     'HIGH_PDD',
          severity: pddMs > 8000 ? 'high' : 'medium',
          message:  `High PDD detected on synthetic call to ${dest.cld}: ${pddMs}ms (threshold: 5000ms). Campaign "${campaign.name}", carrier: ${selectedCarrier ?? 'unknown'}.`,
          entity:   `synthetic_campaign:${campaign.id}`,
          value:    String(pddMs),
          source:   'synthetic_scheduler',
        }).catch(() => {});
      }

      if (outcome === 'connected') {
        connected++;
        if (pddMs > 0) { totalPdd += pddMs; pddCount++; }
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
    await new Promise(r => setTimeout(r, 300));
  }

  const asr      = destinations.length > 0 ? (connected / destinations.length) * 100 : 0;
  const avgPddMs = pddCount > 0 ? totalPdd / pddCount : null;

  // Finalise the run record
  await db.update(syntheticTestRuns)
    .set({ completedAt: new Date(), connectedCalls: connected, failedCalls: failed, asr, avgPddMs })
    .where(eq(syntheticTestRuns.id, runRow.id));

  // Update rolling baseline (average of last 10 runs)
  const newBaseline = await _computeRollingBaseline(campaign.id, asr);

  // AI Ops signal — fire if ASR dropped ≥15pp below baseline
  const baseline     = campaign.baselineAsr as number | null;
  const anomalyFired = baseline != null && (baseline - asr) >= 15;

  if (anomalyFired) {
    console.warn(`[synthetic-scheduler] "${campaign.name}" ASR anomaly: ${asr.toFixed(1)}% vs baseline ${baseline!.toFixed(1)}%`);
    await db.insert(aiOpsEvents).values({
      type:     'SYNTHETIC_TEST_ASR_DROP',
      severity: asr < 50 ? 'high' : 'medium',
      message:  `Scheduled test campaign "${campaign.name}" ASR dropped to ${asr.toFixed(1)}% (baseline: ${baseline!.toFixed(1)}%). ${failed}/${destinations.length} destinations failed.`,
      entity:   `synthetic_campaign:${campaign.id}`,
      value:    String(asr.toFixed(1)),
      source:   'synthetic_scheduler',
    });
    await db.update(syntheticTestRuns)
      .set({ anomalyFired: true })
      .where(eq(syntheticTestRuns.id, runRow.id));
  }

  await _storage.updateTestCampaign(campaign.id, {
    status:      'done',
    baselineAsr: newBaseline,
    baselinePdd: avgPddMs ?? campaign.baselinePdd ?? null,
  } as any);

  console.log(`[synthetic-scheduler] "${campaign.name}" — ASR: ${asr.toFixed(1)}% (${connected}/${destinations.length}) | anomaly: ${anomalyFired} | next: ${nextRunAt?.toISOString() ?? 'none'}`);
}

// ── Route Decision Resolution ─────────────────────────────────────────────────
interface RouteCandidate {
  groupId:    number;
  groupName:  string;
  carrierId:  number | null;
  carrierName: string;
  priority:   number;
}

async function _fetchRoutingCandidates(): Promise<RouteCandidate[]> {
  try {
    const groups  = await db.select().from(routingGroupsCache).limit(50);
    const vendors = await db.select().from(connectionVendorCache2).limit(100);
    const vendorMap = new Map(vendors.map(v => [v.iConnection, v]));

    return groups.map((g, i) => ({
      groupId:     g.id,
      groupName:   g.name ?? `Group ${g.id}`,
      carrierId:   (g as any).iConnection ?? null,
      carrierName: (g as any).iConnection
        ? (vendorMap.get((g as any).iConnection)?.vendorName ?? `Carrier ${(g as any).iConnection}`)
        : 'Unknown',
      priority: i + 1,
    }));
  } catch {
    return [];
  }
}

function _resolveRouteDecision(
  cld: string,
  outcome: string,
  sipCode: number | undefined,
  candidates: RouteCandidate[]
): { selectedCarrier: string | null; selectedCarrierId: number | null; candidates: RouteCandidate[]; decisionReason: string } {
  if (!candidates.length) {
    return {
      selectedCarrier:   null,
      selectedCarrierId: null,
      candidates:        [],
      decisionReason:    'No routing groups available in cache',
    };
  }

  // Highest-priority (lowest index) candidate is selected
  const selected = candidates[0];
  let decisionReason: string;

  if (outcome === 'connected') {
    decisionReason = candidates.length === 1
      ? 'Only available route — connected successfully'
      : `Highest-priority route selected from ${candidates.length} candidates — connected successfully`;
  } else if (sipCode === 404) {
    decisionReason = 'Route matched but destination not found (SIP 404)';
  } else if (sipCode === 503 || sipCode === 480) {
    decisionReason = 'Route matched but carrier unavailable — all candidates exhausted';
  } else if (sipCode && sipCode >= 500) {
    decisionReason = `Server-side failure on selected carrier (SIP ${sipCode})`;
  } else {
    decisionReason = outcome === 'failed'
      ? `Call failed — SIP ${sipCode ?? 'unknown'}`
      : 'Route resolved, outcome pending';
  }

  return {
    selectedCarrier:   selected.carrierName,
    selectedCarrierId: selected.carrierId,
    candidates,
    decisionReason,
  };
}

function _classifyFailure(sipCode: number | undefined): string {
  if (!sipCode) return 'other';
  if (sipCode === 404) return 'user_not_found';
  if (sipCode === 503 || sipCode === 408) return 'timeout';
  if (sipCode === 480 || sipCode === 486) return 'no_answer';
  if (sipCode === 487) return 'cancelled';
  if (sipCode === 403) return 'blocked';
  if (sipCode >= 500) return 'network';
  if (sipCode >= 400) return 'client_error';
  return 'other';
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function _computeNextRunAt(campaign: any): Date | null {
  const mins = campaign.intervalMinutes as number | null;
  if (!mins || mins <= 0) return null;
  return new Date(Date.now() + mins * 60_000);
}

async function _computeRollingBaseline(campaignId: number, latestAsr: number): Promise<number> {
  try {
    const recent = await db.select({ asr: syntheticTestRuns.asr })
      .from(syntheticTestRuns)
      .where(eq(syntheticTestRuns.campaignId, campaignId))
      .orderBy(desc(syntheticTestRuns.startedAt))
      .limit(9);
    const allAsrs = [latestAsr, ...recent.map(r => r.asr ?? 0)].filter(v => v > 0);
    return allAsrs.reduce((a, b) => a + b, 0) / allAsrs.length;
  } catch {
    return latestAsr;
  }
}
