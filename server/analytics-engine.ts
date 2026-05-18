/**
 * Analytics Engine
 *
 * Pure CDR aggregation functions shared across:
 *   - /api/analytics/dashboard   (HTTP route — scoped by filter contract v1)
 *   - KPI Snapshot Scheduler     (hourly platform-wide baseline snapshots)
 *   - Statistical Anomaly Engine (platform-level ASR/MOS baseline detection)
 *
 * Rules:
 *   - No Express, no DB, no side effects
 *   - All inputs are explicit parameters — no closure dependencies
 *   - Types imported from @shared/analytics only
 */

import { estimateMOSFromPDD, mosToGrade } from './mos';
import type { AnalyticsKpis } from '@shared/analytics';

// ── CDR entry shape (subset of SippyCDR used for aggregation) ─────────────────
export interface CdrEntry {
  startTime?:   string | null;
  connectTime?: string | null;
  result?:      string | number | null;
  duration?:    string | number | null;
  pdd1xx?:      string | number | null;
  pdd?:         string | number | null;
  cost?:        string | number | null;
}

// ── Pure CDR predicates (exported so callers can use for breakout/time series) ─
export const isAnswered = (c: CdrEntry): boolean =>
  String(c.result) === '0' && (Number(c.duration) || 0) > 0;

export const isRna = (c: CdrEntry): boolean =>
  String(c.result) === '0' && (Number(c.duration) || 0) === 0;

export const isNetFail = (c: CdrEntry): boolean =>
  ['100', '101', '102', '103', '104', '105'].includes(String(c.result));

export const cdrTs = (c: CdrEntry): number =>
  c.startTime   ? new Date(c.startTime).getTime()
  : c.connectTime ? new Date(c.connectTime).getTime() : 0;

// ── KPI computation — pure function, O(N) single pass ─────────────────────────
export function computeKpis(cdrs: CdrEntry[]): AnalyticsKpis {
  const answered    = cdrs.filter(isAnswered);
  const rna         = cdrs.filter(isRna);
  const totalCalls  = cdrs.length;
  const ansCount    = answered.length;

  const asr         = totalCalls > 0 ? parseFloat((ansCount / totalCalls * 100).toFixed(2)) : 0;
  const totalDurSec = answered.reduce((s, c) => s + (Number(c.duration) || 0), 0);
  const acd         = ansCount > 0 ? Math.round(totalDurSec / ansCount) : 0;

  const pddArr      = answered.map(c => Number(c.pdd1xx ?? c.pdd) || 0).filter(v => v > 0);
  const avgPddSec   = pddArr.length > 0
    ? parseFloat((pddArr.reduce((a, b) => a + b, 0) / pddArr.length).toFixed(3)) : 0;

  // MOS rule: null when no answered calls — never fake a score
  const mos         = ansCount > 0 && avgPddSec > 0
    ? parseFloat(estimateMOSFromPDD(avgPddSec * 1000).toFixed(2)) : null;
  const mosGrade    = mos !== null ? mosToGrade(mos) : null;

  const totalMinutes = parseFloat((totalDurSec / 60).toFixed(2));
  const totalCost    = parseFloat(cdrs.reduce((s, c) => s + (Number(c.cost) || 0), 0).toFixed(4));

  const nerNum  = ansCount + rna.length;
  const ner     = totalCalls > 0 ? parseFloat((nerNum / totalCalls * 100).toFixed(2)) : null;

  return {
    totalCalls, answeredCalls: ansCount,
    asr, acd, pdd: avgPddSec,
    mos, mosGrade, ner,
    totalMinutes, totalCost,
  };
}

// ── KPI Snapshot Store — rolling 24h in-memory, thread-safe (single-threaded Node) ──

export interface KpiSnapshot {
  timestamp: number;    // bucket start epoch ms (top of the hour)
  windowMs:  number;    // always 3_600_000 for hourly snapshots
  kpis:      AnalyticsKpis;
  cdrCount:  number;
}

export class KpiSnapshotStore {
  private snapshots: KpiSnapshot[] = [];
  private readonly maxHours: number;

  constructor(maxHours = 24) { this.maxHours = maxHours; }

  push(snapshot: KpiSnapshot): void {
    // De-duplicate: replace if same hour bucket already present
    const existing = this.snapshots.findIndex(s => s.timestamp === snapshot.timestamp);
    if (existing >= 0) { this.snapshots[existing] = snapshot; }
    else               { this.snapshots.push(snapshot); }

    // Evict beyond maxHours
    const cutoff = Date.now() - this.maxHours * 3_600_000;
    this.snapshots = this.snapshots.filter(s => s.timestamp >= cutoff);

    // Keep chronological order
    this.snapshots.sort((a, b) => a.timestamp - b.timestamp);
  }

  getAll():    KpiSnapshot[]       { return [...this.snapshots]; }
  getLatest(): KpiSnapshot | null  { return this.snapshots[this.snapshots.length - 1] ?? null; }
  size():      number              { return this.snapshots.length; }

  /** Compute rolling mean + stddev for a named KPI field across stored snapshots. */
  baseline(field: keyof AnalyticsKpis): { mean: number; stddev: number; samples: number } | null {
    const values = this.snapshots
      .map(s => s.kpis[field])
      .filter((v): v is number => typeof v === 'number');
    if (values.length < 3) return null;
    const mean    = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
    return { mean, stddev: Math.sqrt(variance), samples: values.length };
  }

  /** Returns sigma deviation of a current value vs the stored baseline. */
  sigmaOf(field: keyof AnalyticsKpis, current: number): number | null {
    const b = this.baseline(field);
    if (!b || b.stddev < 0.01) return null;
    return Math.abs(current - b.mean) / b.stddev;
  }
}
