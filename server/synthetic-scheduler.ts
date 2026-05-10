/**
 * Synthetic Testing Scheduler — hardened with Execution Reliability Layer
 *
 * Phase 1 — Execution Reliability:
 *   • Retry wrapper (max 2 attempts, 5s → 10s backoff)
 *   • Failure classification: carrier_failure vs infra_failure
 *   • Infra failures excluded from ASR/baseline/anomaly detection
 *   • Infra failures logged to execution_health_log + AI Ops (low confidence)
 *
 * Phase 2 — Truth Layer:
 *   • Confidence score (0–1) on every AI Ops event
 *   • Signal source tagging (synthetic / live_traffic / manual_test)
 *   • Deduplication: same carrier + same type within 15 min = 1 event
 *   • Classification: carrier_failure | infra_failure
 *
 * Phase 4 — Baseline Upgrade:
 *   • 24h rolling window baseline replaces 10-run average
 *   • Only carrier_failure and success outcomes count toward baseline
 *
 * Phase 5 — Replay Snapshot:
 *   • Carrier stability scores captured at execution time per trace
 */

import { eq, desc, gte, and } from 'drizzle-orm';
import * as sippy from './sippy';
import type { IStorage } from './storage';
import { db } from './db';
import {
  aiOpsEvents, syntheticTestRuns, routingGroupsCache,
  connectionVendorCache2, executionHealthLog, carrierQualityScores,
} from '../shared/schema';

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
    status: 'running', lastRunAt: new Date(), nextRunAt,
  } as any);

  // Create a run record
  const [runRow] = await db.insert(syntheticTestRuns).values({
    campaignId:       campaign.id,
    startedAt:        new Date(),
    totalCalls:       destinations.length,
    baselineAsrAtRun: campaign.baselineAsr ?? null,
    triggeredBy:      'scheduler',
  }).returning();

  const sSettings          = await _storage.getSippySettings();
  const portalUrl           = sSettings ? _sippyPortalUrl(sSettings) : '';
  const routingCandidates  = await _fetchRoutingCandidates();
  const scoresSnapshot      = await _fetchCarrierScoresSnapshot();

  let connected = 0, failed = 0, infraFailed = 0, carrierFailed = 0;
  let totalPdd = 0, pddCount = 0;

  for (const dest of destinations) {
    const callResult = sSettings?.portalUrl
      ? await _callWithRetry(
          sSettings.apiAdminUsername,
          sSettings.apiAdminPassword,
          dest,
          portalUrl
        )
      : { outcome: 'failed' as const, failureType: 'infra_failure' as const, attemptCount: 1 };

    const { outcome, failureType, sipCode, durationSec = 0, pddMs = 0, attemptCount = 1 } = callResult as any;

    // ── Log infra failures to health log (never touch ASR) ───────────────────
    if (failureType === 'infra_failure') {
      infraFailed++;
      await db.insert(executionHealthLog).values({
        campaignId:   campaign.id,
        runId:        runRow.id,
        cld:          dest.cld,
        cli:          dest.cli,
        errorType:    sipCode ? `sip_${sipCode}` : 'no_response',
        errorMessage: `Infra failure on ${dest.cld} after ${attemptCount} attempt(s)`,
        attemptCount,
      }).catch(() => {});

      // Still emit to AI Ops but with low confidence + infra classification
      await _deduplicatedAiOpsInsert({
        type:           'INFRA_FAILURE',
        severity:       'low',
        message:        `Infrastructure failure on synthetic call to ${dest.cld} (campaign "${campaign.name}"). Not carrier-related. Attempts: ${attemptCount}.`,
        entity:         `synthetic_campaign:${campaign.id}`,
        value:          String(sipCode ?? 0),
        source:         'synthetic_scheduler',
        confidence:     0.1,
        signalSource:   'synthetic',
        classification: 'infra_failure',
        dedupeKey:      `infra:camp${campaign.id}:${_bucket15()}`,
      });
      continue; // infra failure — skip ASR and baseline
    }

    // ── Store campaign result (carrier_failure or success) ────────────────────
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

    // ── Route decision trace with replay snapshot ─────────────────────────────
    const { selectedCarrier, selectedCarrierId, candidates, decisionReason } =
      _resolveRouteDecision(dest.cld, outcome, sipCode, routingCandidates);

    await _storage.addRouteDecisionTrace({
      campaignId:            campaign.id,
      runId:                 runRow.id,
      cld:                   dest.cld,
      cli:                   dest.cli,
      selectedCarrier,
      selectedCarrierId,
      candidateRoutes:       JSON.stringify(candidates),
      decisionReason,
      outcome,
      sipCode,
      pddMs:                 pddMs > 0 ? pddMs : null,
      durationSec:           durationSec > 0 ? durationSec : null,
      failureCategory:       outcome === 'failed' ? _classifyFailureCategory(sipCode) : null,
      failureType:           outcome === 'failed' ? 'carrier_failure' : null,
      carrierScoresSnapshot: JSON.stringify(scoresSnapshot),
    });

    // ── Per-call AI Ops signals (with confidence + dedup) ─────────────────────
    if (outcome === 'failed') {
      carrierFailed++;
      await _deduplicatedAiOpsInsert({
        type:           'SYNTHETIC_FAILURE',
        severity:       sipCode && sipCode >= 500 ? 'high' : 'medium',
        message:        `Synthetic call to ${dest.cld} failed with SIP ${sipCode ?? 'unknown'} (campaign "${campaign.name}"). Carrier: ${selectedCarrier ?? 'unknown'}. Category: ${_classifyFailureCategory(sipCode)}.`,
        entity:         selectedCarrier ? `carrier:${selectedCarrier}` : `synthetic_campaign:${campaign.id}`,
        value:          String(sipCode ?? 0),
        source:         'synthetic_scheduler',
        confidence:     0.55,
        signalSource:   'synthetic',
        classification: 'carrier_failure',
        dedupeKey:      `synfail:${selectedCarrier ?? campaign.id}:${_bucket15()}`,
      });
    }

    if (outcome === 'connected' && pddMs > 5000) {
      await _deduplicatedAiOpsInsert({
        type:           'HIGH_PDD',
        severity:       pddMs > 8000 ? 'high' : 'medium',
        message:        `High PDD on synthetic call to ${dest.cld}: ${pddMs}ms (threshold: 5000ms). Campaign "${campaign.name}", carrier: ${selectedCarrier ?? 'unknown'}.`,
        entity:         selectedCarrier ? `carrier:${selectedCarrier}` : `synthetic_campaign:${campaign.id}`,
        value:          String(pddMs),
        source:         'synthetic_scheduler',
        confidence:     0.65,
        signalSource:   'synthetic',
        classification: 'carrier_failure',
        dedupeKey:      `highpdd:${selectedCarrier ?? campaign.id}:${_bucket15()}`,
      });
    }

    if (outcome === 'connected') {
      connected++;
      if (pddMs > 0) { totalPdd += pddMs; pddCount++; }
    }

    await _sleep(300);
  }

  // ── ASR computed from carrier outcomes only (infra excluded) ─────────────────
  const eligibleCalls = destinations.length - infraFailed;
  const asr           = eligibleCalls > 0 ? (connected / eligibleCalls) * 100 : 0;
  const avgPddMs      = pddCount > 0 ? totalPdd / pddCount : null;

  // Finalise run record
  await db.update(syntheticTestRuns)
    .set({
      completedAt: new Date(),
      connectedCalls: connected,
      failedCalls: failed + carrierFailed,
      infraFailures: infraFailed,
      carrierFailures: carrierFailed,
      asr,
      avgPddMs,
    })
    .where(eq(syntheticTestRuns.id, runRow.id));

  // ── 24h rolling baseline (Phase 4) — excludes infra-only runs ───────────────
  const newBaseline = await _compute24hBaseline(campaign.id, asr);

  // ── Degraded vs last run (run-over-run regression) ───────────────────────
  let degradedVsLastRun = false;
  try {
    const [prevRun] = await db.select({ asr: syntheticTestRuns.asr })
      .from(syntheticTestRuns)
      .where(and(
        eq(syntheticTestRuns.campaignId, campaign.id),
        // exclude current run
        // (id < runRow.id is guaranteed since we just inserted runRow)
      ))
      .orderBy(desc(syntheticTestRuns.id))
      .offset(1)
      .limit(1);

    if (prevRun?.asr != null && eligibleCalls >= 1) {
      const drop = prevRun.asr - asr;
      degradedVsLastRun = drop >= 10; // ≥10pp drop vs immediately previous run
      if (degradedVsLastRun) {
        console.warn(`[synthetic-scheduler] "${campaign.name}" degraded vs last run: ${asr.toFixed(1)}% (was ${prevRun.asr.toFixed(1)}%, Δ${(-drop).toFixed(1)}pp)`);
      }
    }
  } catch { /* not fatal */ }

  // ── ASR drop anomaly signal ───────────────────────────────────────────────
  const baseline     = campaign.baselineAsr as number | null;
  const anomalyFired = eligibleCalls >= 2 && baseline != null && (baseline - asr) >= 15;

  if (anomalyFired) {
    console.warn(`[synthetic-scheduler] "${campaign.name}" ASR anomaly: ${asr.toFixed(1)}% vs baseline ${baseline!.toFixed(1)}%`);
    const confidence = _asrDropConfidence(baseline!, asr, eligibleCalls);
    await _deduplicatedAiOpsInsert({
      type:           'SYNTHETIC_TEST_ASR_DROP',
      severity:       asr < 50 ? 'high' : 'medium',
      message:        `Scheduled test campaign "${campaign.name}" ASR dropped to ${asr.toFixed(1)}% (baseline: ${baseline!.toFixed(1)}%). ${carrierFailed}/${eligibleCalls} carrier failures. ${infraFailed} infra failures excluded.`,
      entity:         `synthetic_campaign:${campaign.id}`,
      value:          String(asr.toFixed(1)),
      source:         'synthetic_scheduler',
      confidence,
      signalSource:   'synthetic',
      classification: 'carrier_failure',
      dedupeKey:      `asrdrop:${campaign.id}:${_bucket15()}`,
    });
  }

  await db.update(syntheticTestRuns)
    .set({ anomalyFired, degradedVsLastRun })
    .where(eq(syntheticTestRuns.id, runRow.id));

  await _storage.updateTestCampaign(campaign.id, {
    status:      'done',
    baselineAsr: newBaseline ?? campaign.baselineAsr ?? null,
    baselinePdd: avgPddMs ?? campaign.baselinePdd ?? null,
  } as any);

  console.log(
    `[synthetic-scheduler] "${campaign.name}" — ASR: ${asr.toFixed(1)}% ` +
    `(${connected}/${eligibleCalls} eligible | ${infraFailed} infra excl.) | ` +
    `anomaly: ${anomalyFired} | confidence: ${anomalyFired ? _asrDropConfidence(baseline!, asr, eligibleCalls).toFixed(2) : 'n/a'} | ` +
    `next: ${nextRunAt?.toISOString() ?? 'none'}`
  );
}

// ── Phase 1: Retry wrapper ────────────────────────────────────────────────────
type CallResult = {
  outcome:      'connected' | 'failed';
  failureType:  'carrier_failure' | 'infra_failure' | null;
  sipCode?:     number;
  durationSec:  number;
  pddMs:        number;
  attemptCount: number;
};

async function _callWithRetry(
  username: string,
  password: string,
  dest: { cld: string; cli?: string },
  portalUrl: string,
): Promise<CallResult> {
  const maxAttempts = 2;
  let lastFailureType: 'carrier_failure' | 'infra_failure' = 'infra_failure';
  let lastSipCode: number | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await sippy.makeTestCall(
        username, password,
        { cld: dest.cld, cli: dest.cli || '100', maxDuration: 10 },
        portalUrl
      );

      if (!res) {
        // null = Sippy unreachable
        lastFailureType = 'infra_failure';
        if (attempt < maxAttempts) { await _sleep(attempt === 1 ? 5000 : 10000); continue; }
        return { outcome: 'failed', failureType: 'infra_failure', durationSec: 0, pddMs: 0, attemptCount: attempt };
      }

      if (res.connected) {
        return {
          outcome: 'connected', failureType: null,
          sipCode: res.sipCode, durationSec: res.duration ?? 0, pddMs: res.pdd ?? 0,
          attemptCount: attempt,
        };
      }

      // Not connected — classify the SIP failure
      const ft = _classifySipCode(res.sipCode);
      lastFailureType = ft;
      lastSipCode     = res.sipCode;

      if (ft === 'infra_failure' && attempt < maxAttempts) {
        await _sleep(attempt === 1 ? 5000 : 10000);
        continue; // retry only infra failures
      }

      // carrier_failure or exhausted retries
      return { outcome: 'failed', failureType: ft, sipCode: res.sipCode, durationSec: 0, pddMs: 0, attemptCount: attempt };

    } catch {
      lastFailureType = 'infra_failure';
      if (attempt < maxAttempts) { await _sleep(attempt === 1 ? 5000 : 10000); continue; }
    }
  }

  return { outcome: 'failed', failureType: lastFailureType, sipCode: lastSipCode, durationSec: 0, pddMs: 0, attemptCount: maxAttempts };
}

function _classifySipCode(sipCode?: number): 'carrier_failure' | 'infra_failure' {
  if (!sipCode) return 'infra_failure';
  // Infra failures: Sippy-side errors, timeouts, auth
  if ([401, 407, 408, 500, 502, 504].includes(sipCode)) return 'infra_failure';
  // Everything else (404, 480, 486, 487, 488, 503, 603…) = carrier decision
  return 'carrier_failure';
}

// ── Phase 2: Deduplication + confidence ──────────────────────────────────────
function _bucket15(): number {
  return Math.floor(Date.now() / (15 * 60_000));
}

type AiOpsInsertPayload = {
  type: string; severity: string; message: string; entity?: string; value?: string;
  source: string; confidence: number; signalSource: string;
  classification: string; dedupeKey: string;
};

async function _deduplicatedAiOpsInsert(payload: AiOpsInsertPayload): Promise<void> {
  try {
    const windowStart = new Date(Date.now() - 15 * 60_000);
    const [existing]  = await db.select({ id: aiOpsEvents.id })
      .from(aiOpsEvents)
      .where(and(
        eq(aiOpsEvents.dedupeKey, payload.dedupeKey),
        gte(aiOpsEvents.createdAt, windowStart),
      ))
      .limit(1);

    if (!existing) {
      await db.insert(aiOpsEvents).values(payload as any);
    }
  } catch {
    // never fail a call over a signal insert
  }
}

function _asrDropConfidence(baseline: number, asr: number, sampleCount: number): number {
  const dropMagnitude = baseline - asr;
  let c = 0.35;
  if (dropMagnitude >= 30) c += 0.20;
  else if (dropMagnitude >= 15) c += 0.10;
  if (sampleCount >= 10) c += 0.20;
  else if (sampleCount >= 5) c += 0.10;
  return Math.min(0.95, c);
}

// ── Phase 4: 24h rolling baseline ────────────────────────────────────────────
async function _compute24hBaseline(campaignId: number, latestAsr: number): Promise<number | null> {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60_000);
    const runs   = await db.select({ asr: syntheticTestRuns.asr })
      .from(syntheticTestRuns)
      .where(and(
        eq(syntheticTestRuns.campaignId, campaignId),
        gte(syntheticTestRuns.startedAt, cutoff),
      ))
      .orderBy(desc(syntheticTestRuns.startedAt))
      .limit(48);

    const asrs = [latestAsr, ...runs.map(r => r.asr ?? 0)].filter(v => v > 0);
    if (asrs.length < 2) return latestAsr; // not enough 24h data yet
    return asrs.reduce((a, b) => a + b, 0) / asrs.length;
  } catch {
    return latestAsr;
  }
}

// ── Phase 5: carrier scores snapshot ─────────────────────────────────────────
async function _fetchCarrierScoresSnapshot(): Promise<Record<string, number>> {
  try {
    const scores = await db.select({
      carrierName:    carrierQualityScores.carrierName,
      stabilityScore: carrierQualityScores.stabilityScore,
    }).from(carrierQualityScores)
      .where(eq(carrierQualityScores.windowHours, 24));

    const snap: Record<string, number> = {};
    for (const s of scores) snap[s.carrierName] = s.stabilityScore ?? 0;
    return snap;
  } catch {
    return {};
  }
}

// ── Route decision resolution ─────────────────────────────────────────────────
interface RouteCandidate {
  groupId: number; groupName: string;
  carrierId: number | null; carrierName: string; priority: number;
}

async function _fetchRoutingCandidates(): Promise<RouteCandidate[]> {
  try {
    const groups  = await db.select().from(routingGroupsCache).limit(50);
    const vendors = await db.select().from(connectionVendorCache2).limit(100);
    const vmap    = new Map(vendors.map(v => [v.iConnection, v]));
    return groups.map((g, i) => ({
      groupId:    g.id,
      groupName:  g.name ?? `Group ${g.id}`,
      carrierId:  (g as any).iConnection ?? null,
      carrierName: (g as any).iConnection
        ? (vmap.get((g as any).iConnection)?.vendorName ?? `Carrier ${(g as any).iConnection}`)
        : 'Unknown',
      priority: i + 1,
    }));
  } catch { return []; }
}

function _resolveRouteDecision(
  cld: string, outcome: string, sipCode: number | undefined, candidates: RouteCandidate[]
): { selectedCarrier: string | null; selectedCarrierId: number | null; candidates: RouteCandidate[]; decisionReason: string } {
  if (!candidates.length) {
    return { selectedCarrier: null, selectedCarrierId: null, candidates: [], decisionReason: 'No routing groups in cache' };
  }
  const selected = candidates[0];
  let decisionReason: string;
  if (outcome === 'connected') {
    decisionReason = candidates.length === 1
      ? 'Only available route — connected'
      : `Highest-priority route of ${candidates.length} candidates — connected`;
  } else if (sipCode === 404) decisionReason = 'Destination not found at carrier (SIP 404)';
  else if (sipCode === 503 || sipCode === 480) decisionReason = 'Carrier unavailable — all routes exhausted';
  else if (sipCode && sipCode >= 500) decisionReason = `Server-side failure on carrier (SIP ${sipCode})`;
  else decisionReason = `Call failed — SIP ${sipCode ?? 'unknown'}`;
  return { selectedCarrier: selected.carrierName, selectedCarrierId: selected.carrierId, candidates, decisionReason };
}

function _classifyFailureCategory(sipCode?: number): string {
  if (!sipCode) return 'other';
  if (sipCode === 404) return 'user_not_found';
  if (sipCode === 503 || sipCode === 408) return 'timeout';
  if (sipCode === 480 || sipCode === 486) return 'no_answer';
  if (sipCode === 487) return 'cancelled';
  if (sipCode === 403) return 'blocked';
  if (sipCode >= 500)  return 'network';
  if (sipCode >= 400)  return 'client_error';
  return 'other';
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * Compute the NEXT run time after a campaign fires.
 * 'once' schedules return null (no re-schedule).
 * 'interval' / 'hourly' / 'daily' return the next occurrence.
 */
function _computeNextRunAt(campaign: any): Date | null {
  const scheduleType = (campaign.scheduleType ?? 'interval') as string;

  if (scheduleType === 'once') return null; // one-shot — never re-schedule

  if (scheduleType === 'hourly') return new Date(Date.now() + 60 * 60_000);

  if (scheduleType === 'daily') {
    const hour = (campaign.cronHour as number | null) ?? 0;
    const next = new Date();
    next.setUTCHours(hour, 0, 0, 0);
    if (next.getTime() <= Date.now()) next.setUTCDate(next.getUTCDate() + 1);
    return next;
  }

  // default: 'interval'
  const mins = campaign.intervalMinutes as number | null;
  if (!mins || mins <= 0) return null;
  return new Date(Date.now() + mins * 60_000);
}

/**
 * Compute the FIRST nextRunAt when a campaign is toggled on.
 * 'once' schedules use scheduledAt directly.
 */
export function computeInitialNextRunAt(campaign: any): Date | null {
  const scheduleType = (campaign.scheduleType ?? 'interval') as string;
  if (scheduleType === 'once') {
    return campaign.scheduledAt ? new Date(campaign.scheduledAt) : null;
  }
  return _computeNextRunAt(campaign);
}

function _sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
