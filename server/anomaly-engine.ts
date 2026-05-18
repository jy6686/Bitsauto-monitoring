/**
 * Statistical Anomaly Engine
 *
 * Computes rolling baselines (mean ± stddev) per vendor per metric from the
 * live CDR cache, then flags deviations > 2σ as anomaly events in the DB.
 *
 * Metrics tracked per vendor:
 *   asr  — Answer-Seizure Ratio (%)
 *   acd  — Average Call Duration (seconds, answered calls only)
 *   cps  — Calls Per Hour (volume proxy)
 *
 * Algorithm:
 *   1. Bucket all CDRs into 1-hour windows.
 *   2. Compute metric value for each hour bucket → sample series.
 *   3. Baseline = mean + stddev across ALL buckets except the most recent.
 *   4. Current = metric value of the most recent complete hour.
 *   5. σ_deviation = |current - mean| / stddev
 *   6. Severity: >3σ → critical, >2.5σ → high, >2σ → medium
 */

import type { SippyCDR } from "./sippy";
import { db } from "./db";
import { vendorMetricBaselines, anomalyEvents } from "@shared/schema";
import { eq, and, gte } from "drizzle-orm";
import type { KpiSnapshot } from "./analytics-engine";

// ─── Types ────────────────────────────────────────────────────────────────────

interface HourBucket {
  total:    number;
  answered: number;
  durationSum: number;
}

interface VendorStats {
  [vendor: string]: {
    [hourKey: string]: HourBucket;
  };
}

interface BaselineResult {
  mean:   number;
  stddev: number;
  samples: number[];
}

export interface AnomalyEngineResult {
  baselines:  number;   // baseline records written
  detected:   number;   // new anomalies written
  resolved:   number;   // old anomalies auto-resolved
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hourKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${String(d.getUTCHours()).padStart(2, '0')}`;
}

function isAnswered(c: SippyCDR): boolean {
  const r = String(c.result ?? '').toUpperCase();
  return r === 'NORMAL_CLEARING' || r === '200' || Number(c.duration ?? 0) > 0;
}

function computeStats(samples: number[]): BaselineResult {
  if (samples.length === 0) return { mean: 0, stddev: 0, samples };
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length;
  return { mean, stddev: Math.sqrt(variance), samples };
}

function deviationSigma(current: number, mean: number, stddev: number): number {
  if (stddev < 0.001) return 0;
  return Math.abs(current - mean) / stddev;
}

function toSeverity(sigma: number): 'critical' | 'high' | 'medium' | null {
  if (sigma >= 3)   return 'critical';
  if (sigma >= 2.5) return 'high';
  if (sigma >= 2)   return 'medium';
  return null;
}

// Generate human-readable anomaly text
function buildAnomalyText(
  vendor: string,
  metric: string,
  current: number,
  mean: number,
  direction: 'above' | 'below',
  sigma: number,
): { title: string; description: string; rootCause: string; recommendation: string } {
  const pct = mean > 0 ? Math.abs(((current - mean) / mean) * 100).toFixed(0) : '–';
  const sigStr = sigma.toFixed(1);

  if (metric === 'asr') {
    const isDown = direction === 'below';
    return {
      title: isDown
        ? `ASR Drop — ${vendor}`
        : `Unusual ASR Spike — ${vendor}`,
      description: isDown
        ? `ASR for ${vendor} is ${current.toFixed(1)}% — ${pct}% below the rolling baseline of ${mean.toFixed(1)}% (${sigStr}σ deviation).`
        : `ASR for ${vendor} is ${current.toFixed(1)}% — ${pct}% above the rolling baseline of ${mean.toFixed(1)}% (${sigStr}σ deviation).`,
      rootCause: isDown
        ? `Statistical anomaly detected: ${sigStr}σ below expected baseline. Possible causes: carrier SIP errors (503/408), trunk exhaustion, or routing misconfiguration on ${vendor}.`
        : `ASR significantly above baseline — possible test traffic, fraud pattern, or inbound call burst on ${vendor}.`,
      recommendation: isDown
        ? `Check ${vendor} SIP response codes in the CDR Viewer. If >20% 503s, consider deprioritising ${vendor} in the routing group and submitting a Fix via the Approval Queue.`
        : `Monitor for fraud patterns. Review concurrent call counts and CLI diversity for ${vendor}.`,
    };
  }

  if (metric === 'acd') {
    const isDown = direction === 'below';
    return {
      title: isDown
        ? `Short Call Duration — ${vendor}`
        : `Unusually Long Calls — ${vendor}`,
      description: isDown
        ? `ACD for ${vendor} is ${current.toFixed(0)}s — ${pct}% below baseline of ${mean.toFixed(0)}s (${sigStr}σ).`
        : `ACD for ${vendor} is ${current.toFixed(0)}s — ${pct}% above baseline of ${mean.toFixed(0)}s (${sigStr}σ).`,
      rootCause: isDown
        ? `Short call duration may indicate early disconnect issues, media failures, or FAS activity on ${vendor}.`
        : `Longer than typical call durations — could be long-duration fraud, conference calls, or queued sessions on ${vendor}.`,
      recommendation: isDown
        ? `Review FAS detection results and short-call thresholds. Check ${vendor} for media negotiation failures.`
        : `Investigate for long-duration fraud (especially international termination). Check max_duration_secs limits.`,
    };
  }

  if (metric === 'cps') {
    const isUp = direction === 'above';
    return {
      title: isUp
        ? `Call Volume Spike — ${vendor}`
        : `Traffic Drop — ${vendor}`,
      description: isUp
        ? `Call volume via ${vendor} is ${current.toFixed(0)} calls/hr — ${pct}% above the ${mean.toFixed(0)} calls/hr baseline (${sigStr}σ).`
        : `Call volume via ${vendor} is ${current.toFixed(0)} calls/hr — ${pct}% below the ${mean.toFixed(0)} calls/hr baseline (${sigStr}σ).`,
      rootCause: isUp
        ? `Traffic surge detected on ${vendor}. Could be a campaign launch, fraud attack, or routing change redirecting traffic.`
        : `Traffic significantly lower than baseline on ${vendor}. Possible trunk failure, routing away from this vendor, or client churn.`,
      recommendation: isUp
        ? `Monitor concurrent call utilisation. If growth continues, verify trunk capacity and check for fraud patterns.`
        : `Verify ${vendor} trunk registration and connectivity. Check routing group to ensure ${vendor} is still active.`,
    };
  }

  return {
    title: `Anomaly — ${vendor} ${metric.toUpperCase()}`,
    description: `${metric.toUpperCase()} for ${vendor}: ${current.toFixed(2)} vs baseline ${mean.toFixed(2)} (${sigStr}σ).`,
    rootCause:  `Statistical deviation detected.`,
    recommendation: `Investigate ${vendor} performance in the CDR Viewer.`,
  };
}

// ─── Main engine function ─────────────────────────────────────────────────────

export async function runAnomalyEngine(
  cdrCache: Map<string, SippyCDR>,
  kpiSnapshots: KpiSnapshot[] = [],
): Promise<AnomalyEngineResult> {
  const cdrs = Array.from(cdrCache.values());
  if (cdrs.length < 10) {
    console.log('[anomaly-engine] Not enough CDR data to compute baselines (need ≥10 records).');
    return { baselines: 0, detected: 0, resolved: 0 };
  }

  // ── Step 1: Bucket CDRs by vendor + hour ─────────────────────────────────
  const stats: VendorStats = {};

  for (const c of cdrs) {
    const vendor = c.vendor?.trim() || 'Unknown';
    const ts = c.startTime ? new Date(c.startTime).getTime() : 0;
    if (!ts) continue;

    const hk = hourKey(ts);
    if (!stats[vendor]) stats[vendor] = {};
    if (!stats[vendor][hk]) stats[vendor][hk] = { total: 0, answered: 0, durationSum: 0 };

    const bucket = stats[vendor][hk];
    bucket.total++;
    if (isAnswered(c)) {
      bucket.answered++;
      bucket.durationSum += Number(c.duration ?? c.totalDuration ?? 0);
    }
  }

  // ── Step 2: For each vendor, build sample series per metric ──────────────
  const now = Date.now();
  const currentHourKey = hourKey(now);
  let baselinesWritten = 0;
  let detected = 0;
  let resolved = 0;

  for (const [vendor, hours] of Object.entries(stats)) {
    const hourKeys = Object.keys(hours).sort();
    if (hourKeys.length < 3) continue; // need at least 3 hours of data

    // Separate baseline hours (all except most recent) from current
    const baselineKeys = hourKeys.filter(k => k !== currentHourKey);
    const currentKey   = hourKeys[hourKeys.length - 1]; // most recent hour in cache

    if (baselineKeys.length < 2) continue;

    // Build sample arrays for each metric across baseline hours
    const asrSamples:  number[] = [];
    const acdSamples:  number[] = [];
    const cpsSamples:  number[] = [];

    for (const hk of baselineKeys) {
      const b = hours[hk];
      if (b.total > 0) {
        asrSamples.push((b.answered / b.total) * 100);
        cpsSamples.push(b.total); // calls per hour
        if (b.answered > 0) acdSamples.push(b.durationSum / b.answered);
      }
    }

    // Current hour metrics
    const cur = hours[currentKey];
    if (!cur || cur.total < 3) continue; // skip if current window has too few calls

    const currentAsr = (cur.answered / cur.total) * 100;
    const currentCps = cur.total;
    const currentAcd = cur.answered > 0 ? cur.durationSum / cur.answered : null;

    // ── Step 3: Write baselines + detect anomalies ────────────────────────
    const metricsToCheck: Array<{
      metric: string;
      current: number | null;
      samples: number[];
    }> = [
      { metric: 'asr', current: currentAsr,  samples: asrSamples },
      { metric: 'cps', current: currentCps,  samples: cpsSamples },
      { metric: 'acd', current: currentAcd,  samples: acdSamples },
    ];

    for (const { metric, current, samples } of metricsToCheck) {
      if (current === null || samples.length < 2) continue;

      const { mean, stddev } = computeStats(samples);

      // Upsert baseline record
      try {
        const existing = await db
          .select()
          .from(vendorMetricBaselines)
          .where(and(
            eq(vendorMetricBaselines.vendor, vendor),
            eq(vendorMetricBaselines.metric, metric),
          ))
          .limit(1);

        if (existing.length > 0) {
          await db
            .update(vendorMetricBaselines)
            .set({ mean, stddev, sampleCount: samples.length, computedAt: new Date() })
            .where(eq(vendorMetricBaselines.id, existing[0].id));
        } else {
          await db.insert(vendorMetricBaselines).values({
            vendor, metric, mean, stddev,
            sampleCount: samples.length,
            windowHours: baselineKeys.length,
          });
        }
        baselinesWritten++;
      } catch (e: any) {
        console.warn(`[anomaly-engine] Failed to write baseline ${vendor}/${metric}:`, e.message);
      }

      // Skip detection if stddev is negligible (flat metric)
      if (stddev < 0.5) continue;

      const sigma = deviationSigma(current, mean, stddev);
      const severity = toSeverity(sigma);
      if (!severity) continue;

      const direction = current < mean ? 'below' : 'above';

      // Dedup: check if a matching unresolved anomaly already exists within last 2h
      try {
        const recentCutoff = new Date(now - 2 * 60 * 60 * 1000);
        const existing = await db
          .select()
          .from(anomalyEvents)
          .where(and(
            eq(anomalyEvents.vendor, vendor),
            eq(anomalyEvents.metric, metric),
            eq(anomalyEvents.resolved, false),
            gte(anomalyEvents.detectedAt, recentCutoff),
          ))
          .limit(1);

        if (existing.length > 0) {
          // Update sigma in place rather than creating a duplicate
          await db
            .update(anomalyEvents)
            .set({ currentValue: current, deviationSigma: sigma, severity })
            .where(eq(anomalyEvents.id, existing[0].id));
          continue;
        }
      } catch (e: any) {
        console.warn(`[anomaly-engine] Dedup check failed:`, e.message);
      }

      // Write new anomaly event
      const text = buildAnomalyText(vendor, metric, current, mean, direction, sigma);
      try {
        await db.insert(anomalyEvents).values({
          vendor,
          metric,
          severity,
          title:            text.title,
          description:      text.description,
          rootCause:        text.rootCause,
          recommendation:   text.recommendation,
          affectedEntities: [`Vendor: ${vendor}`],
          currentValue:     current,
          baselineMean:     mean,
          baselineStddev:   stddev,
          deviationSigma:   sigma,
          resolved:         false,
        });
        detected++;
        console.log(`[anomaly-engine] NEW anomaly: ${vendor}/${metric} ${current.toFixed(2)} vs mean ${mean.toFixed(2)} (${sigma.toFixed(1)}σ) [${severity}]`);
      } catch (e: any) {
        console.warn(`[anomaly-engine] Failed to write anomaly:`, e.message);
      }
    }
  }

  // ── Step 4: Auto-resolve stale anomalies (>4 hours old, no re-detection) ─
  try {
    const staleCutoff = new Date(now - 4 * 60 * 60 * 1000);
    const stale = await db
      .select()
      .from(anomalyEvents)
      .where(and(
        eq(anomalyEvents.resolved, false),
        // detectedAt < staleCutoff — we use a trick: fetch all open, filter in JS
      ));

    for (const ev of stale) {
      if (ev.detectedAt < staleCutoff) {
        await db
          .update(anomalyEvents)
          .set({ resolved: true, resolvedAt: new Date() })
          .where(eq(anomalyEvents.id, ev.id));
        resolved++;
      }
    }
  } catch (e: any) {
    console.warn('[anomaly-engine] Auto-resolve failed:', e.message);
  }

  // ── Step 5: Platform-level KPI anomaly detection (AI Ops hook-in, C) ────────
  // Uses the 24h rolling KPI snapshots produced by the KPI Snapshot Scheduler.
  // Compares the latest snapshot to the 24h baseline for ASR and ACD.
  // Only fires if ≥4 hourly snapshots are available (need enough baseline history).
  if (kpiSnapshots.length >= 4) {
    const latest = kpiSnapshots[kpiSnapshots.length - 1];
    if (latest) {
      const platformMetrics: Array<{ field: 'asr' | 'acd'; label: string; unit: string }> = [
        { field: 'asr', label: 'Platform ASR', unit: '%' },
        { field: 'acd', label: 'Platform ACD', unit: 's' },
      ];

      for (const { field, label, unit } of platformMetrics) {
        const current = latest.kpis[field];
        if (typeof current !== 'number') continue;

        // Compute mean + stddev across all snapshots except the latest
        const history = kpiSnapshots.slice(0, -1);
        const values  = history.map(s => s.kpis[field]).filter((v): v is number => typeof v === 'number');
        if (values.length < 3) continue;

        const mean     = values.reduce((a, b) => a + b, 0) / values.length;
        const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
        const stddev   = Math.sqrt(variance);
        if (stddev < 0.01) continue;

        const sigma     = Math.abs(current - mean) / stddev;
        const severity  = toSeverity(sigma);
        if (!severity) continue;

        const direction = current < mean ? 'below' : 'above';
        const pct       = mean > 0 ? Math.abs(((current - mean) / mean) * 100).toFixed(0) : '–';

        console.warn(
          `[anomaly-engine] Platform anomaly: ${label} ${current.toFixed(1)}${unit} ` +
          `— ${pct}% ${direction} baseline ${mean.toFixed(1)}${unit} (${sigma.toFixed(1)}σ) [${severity}]`,
        );

        // Write to DB as vendor="PLATFORM" for visibility in the anomaly feed
        try {
          const recentCutoff = new Date(now - 2 * 60 * 60 * 1000);
          const existingPlatform = await db
            .select()
            .from(anomalyEvents)
            .where(and(
              eq(anomalyEvents.vendor, 'PLATFORM'),
              eq(anomalyEvents.metric, field),
              eq(anomalyEvents.resolved, false),
              gte(anomalyEvents.detectedAt, recentCutoff),
            ))
            .limit(1);

          if (existingPlatform.length > 0) {
            await db
              .update(anomalyEvents)
              .set({ currentValue: current, deviationSigma: sigma, severity })
              .where(eq(anomalyEvents.id, existingPlatform[0].id));
          } else {
            await db.insert(anomalyEvents).values({
              vendor:           'PLATFORM',
              metric:           field,
              severity,
              title:            `${label} ${direction === 'below' ? 'Drop' : 'Spike'} — Network-Wide`,
              description:      `${label} is ${current.toFixed(1)}${unit} — ${pct}% ${direction} the 24h rolling baseline of ${mean.toFixed(1)}${unit} (${sigma.toFixed(1)}σ).`,
              rootCause:        `Statistical deviation detected across all platform traffic. ${sigma.toFixed(1)}σ ${direction} expected baseline.`,
              recommendation:   direction === 'below'
                ? `Investigate all active vendors and trunk groups. Check for simultaneous carrier-side degradation or a routing misconfiguration.`
                : `Monitor for fraud or unexpected traffic surge across all accounts.`,
              affectedEntities: ['Vendor: ALL', 'Scope: PLATFORM'],
              currentValue:     current,
              baselineMean:     mean,
              baselineStddev:   stddev,
              deviationSigma:   sigma,
              resolved:         false,
            });
            detected++;
          }
        } catch (e: any) {
          console.warn(`[anomaly-engine] Failed to write platform anomaly (${field}):`, e.message);
        }
      }
    }
  }

  console.log(`[anomaly-engine] Run complete — baselines: ${baselinesWritten}, detected: ${detected}, resolved: ${resolved}`);
  return { baselines: baselinesWritten, detected, resolved };
}
