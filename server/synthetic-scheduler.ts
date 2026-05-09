/**
 * Synthetic Testing Scheduler
 *
 * Ticks every 60 seconds. For each enabled campaign with intervalMinutes set
 * and nextRunAt <= now, executes the full call sequence, computes ASR,
 * updates the rolling baseline, records a SyntheticTestRun, and injects an
 * AI Ops signal if ASR drops >15 percentage-points below baseline.
 */

import { eq, desc } from 'drizzle-orm';
import * as sippy from './sippy';
import { sippyPortalUrl } from './sippy';
import type { IStorage } from './storage';
import { db } from './db';
import { aiOpsEvents, syntheticTestRuns } from '../shared/schema';

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
  const portalUrl  = sSettings ? sippyPortalUrl(sSettings) : '';

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

  // AI Ops signal injection — fire if ASR dropped ≥15pp below baseline
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
