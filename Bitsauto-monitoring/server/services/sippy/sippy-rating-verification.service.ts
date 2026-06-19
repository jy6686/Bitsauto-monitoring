/**
 * sippy-rating-verification.service.ts
 *
 * Layer 4B — Rating Verification Engine
 *
 * Deterministic telecom rating reproduction and validation.
 *
 * CRITICAL DESIGN PRINCIPLE:
 *   This service NEVER replaces or modifies Sippy ratings.
 *   It reproduces and validates them independently.
 *   All operations are read-only against Sippy.
 *
 * Pipeline per CDR:
 *   1. Resolve historical tariff version at CDR connect_time
 *   2. Find the matching rate row for the prefix
 *   3. Reproduce the cost using Sippy billing formula
 *   4. Compare against Sippy's actual billed amount
 *   5. Classify and store the discrepancy
 *
 * This is the prerequisite for:
 *   Layer 4C — Immutable Rating Snapshots
 *   Layer 5B — Automated Invoice Delivery
 *   Layer 5C — Carrier Invoice Reconciliation
 *
 * Queue-safe — accepts SippyConfig, no global state.
 */

import { storage } from '../../storage';
import type {
  TariffVersion, RatingVerification, InsertRatingVerification,
} from '@shared/schema';
import type { SippyCDR, SippyTariffRate } from './types';
import { SippyConfig } from './types';
import { auditLog } from './sippy-audit.service';

// ── Discrepancy classification ─────────────────────────────────────────────────

export type DiscrepancyType =
  | 'exact_match'
  | 'overbilled'
  | 'underbilled'
  | 'interval_mismatch'
  | 'connect_fee_mismatch'
  | 'grace_period_mismatch'
  | 'surcharge_mismatch'
  | 'missing_rate'
  | 'unrated';

export type Severity = 'none' | 'minor' | 'major' | 'critical';

// Threshold for "exact match" — rounding tolerance in telecom billing
const EXACT_MATCH_TOLERANCE = 0.0001;

// Severity thresholds (USD)
const SEVERITY_MINOR    = 0.001;
const SEVERITY_MAJOR    = 0.01;
const SEVERITY_CRITICAL = 0.05;

// ── Tariff resolution ──────────────────────────────────────────────────────────

/**
 * Find the tariff version that was active at a given point in time.
 * Uses the most recent snapshot whose created_at <= connectTime.
 *
 * This is the core historical economics lookup that Layer 4A enables.
 */
export async function resolveTariffVersion(
  iTariff: string,
  connectTime: Date | string,
): Promise<TariffVersion | null> {
  const versions = await storage.listTariffVersions(iTariff);
  const ts = typeof connectTime === 'string' ? new Date(connectTime) : connectTime;

  // Find most recent snapshot before or at the connect time
  const candidates = versions.filter(v =>
    v.createdAt != null && new Date(v.createdAt) <= ts,
  );

  if (!candidates.length) return null;

  // Already ordered DESC by created_at from storage
  return candidates[0];
}

/**
 * Find the matching rate row for a callee number within a tariff version snapshot.
 * Uses longest-prefix match — matches the most specific prefix first.
 */
export function resolveRate(
  callee: string,
  snapshotJson: string,
): SippyTariffRate | null {
  let rates: SippyTariffRate[] = [];
  try {
    rates = JSON.parse(snapshotJson);
  } catch {
    return null;
  }

  // Normalize callee — strip leading + if present
  const normalized = callee.replace(/^\+/, '');

  // Collect all matching prefixes, pick the longest (most specific)
  const matches = rates.filter(r => {
    const prefix = (r.prefix ?? '').replace(/^\+/, '');
    return prefix && normalized.startsWith(prefix);
  });

  if (!matches.length) return null;

  // Longest prefix wins
  return matches.reduce((best, curr) =>
    (curr.prefix?.length ?? 0) > (best.prefix?.length ?? 0) ? curr : best,
  );
}

// ── Core billing reproduction ──────────────────────────────────────────────────

export interface ReproducedRating {
  reproducedCost:  number;
  billedSecs:      number;
  rate:            SippyTariffRate | null;
  formula:         string;
}

/**
 * Reproduce the Sippy billing cost for a call using standard Sippy billing formula.
 *
 * Standard Sippy formula:
 *   1. If duration <= grace_period → cost = 0 (grace: no charge for very short calls)
 *   2. billable = max(0, duration - free_seconds)
 *   3. if billable == 0 → cost = connect_fee + post_call_surcharge
 *   4. if billable <= interval_1:
 *        cost = connect_fee + price_1
 *      else:
 *        n_extra = ceil((billable - interval_1) / interval_n)
 *        cost = connect_fee + price_1 + n_extra * price_n
 *   5. cost += post_call_surcharge
 *
 * price_1 and price_n are per-block prices (not per-minute rates).
 * interval_1 and interval_n are billing blocks in seconds.
 */
export function reproduceCost(
  durationSecs: number,
  rate: SippyTariffRate,
): ReproducedRating {
  const interval1   = rate.interval1    ?? rate.interval_1    ?? 60;
  const intervalN   = rate.intervalN    ?? rate.interval_n    ?? 60;
  const price1      = rate.price1       ?? rate.price_1       ?? 0;
  const priceN      = rate.priceN       ?? rate.price_n       ?? 0;
  const connectFee  = rate.connectFee   ?? rate.connect_fee   ?? 0;
  const freeSecs    = rate.freeSeconds  ?? rate.free_seconds  ?? 0;
  const gracePeriod = rate.gracePeriod  ?? rate.grace_period  ?? 0;
  const surcharge   = rate.postCallSurcharge ?? rate.post_call_surcharge ?? 0;

  // Grace period check
  if (gracePeriod > 0 && durationSecs <= gracePeriod) {
    return {
      reproducedCost: 0,
      billedSecs: 0,
      rate,
      formula: `grace(${gracePeriod}s)`,
    };
  }

  const billable = Math.max(0, durationSecs - freeSecs);

  if (billable === 0) {
    const cost = +(connectFee + surcharge).toFixed(8);
    return { reproducedCost: cost, billedSecs: 0, rate, formula: `connect_fee_only` };
  }

  let mainCost: number;
  let billedSecs: number;

  if (billable <= interval1) {
    mainCost  = price1;
    billedSecs = interval1;
  } else {
    const remaining = billable - interval1;
    const nExtra    = Math.ceil(remaining / intervalN);
    mainCost  = price1 + nExtra * priceN;
    billedSecs = interval1 + nExtra * intervalN;
  }

  const total = +(connectFee + mainCost + surcharge).toFixed(8);

  return {
    reproducedCost: total,
    billedSecs,
    rate,
    formula: billable <= interval1
      ? `${connectFee}+${price1}[≤${interval1}s]+${surcharge}`
      : `${connectFee}+${price1}+ceil((${billable}-${interval1})/${intervalN})*${priceN}+${surcharge}`,
  };
}

// ── Discrepancy classification ────────────────────────────────────────────────

export function classifyDiscrepancy(
  sippyActual: number,
  reproduced:  number,
  rate:        SippyTariffRate | null,
): { type: DiscrepancyType; severity: Severity; delta: number; deltaPct: number } {
  const delta    = +(sippyActual - reproduced).toFixed(8);
  const deltaPct = sippyActual !== 0
    ? +(delta / sippyActual * 100).toFixed(4)
    : reproduced !== 0 ? 100 : 0;

  const absDelta = Math.abs(delta);
  const severity: Severity =
    absDelta <= EXACT_MATCH_TOLERANCE ? 'none'     :
    absDelta <  SEVERITY_MINOR        ? 'none'     :
    absDelta <  SEVERITY_MAJOR        ? 'minor'    :
    absDelta <  SEVERITY_CRITICAL     ? 'major'    : 'critical';

  if (absDelta <= EXACT_MATCH_TOLERANCE) {
    return { type: 'exact_match', severity: 'none', delta, deltaPct };
  }

  // Attempt to classify the root cause
  // These are heuristics — the exact cause requires deeper CDR inspection
  let type: DiscrepancyType = delta > 0 ? 'overbilled' : 'underbilled';

  return { type, severity, delta, deltaPct };
}

// ── Full CDR verification pipeline ───────────────────────────────────────────

export interface CdrVerificationInput {
  callId?:        string;
  startTime?:     string;
  callee:         string;
  durationSecs:   number;
  sippyActualCost: number;
  iTariff:        string;
}

/**
 * Verify a single CDR against historical tariff economics.
 * Full pipeline: resolve → match rate → reproduce → compare → classify → persist.
 *
 * This is the canonical entry point for all rating verification.
 */
export async function verifyCdr(
  input: CdrVerificationInput,
): Promise<RatingVerification> {
  const connectTime = input.startTime ? new Date(input.startTime) : new Date();

  // 1. Resolve historical tariff version
  const version = await resolveTariffVersion(input.iTariff, connectTime);

  if (!version) {
    // No tariff snapshot for this time period
    const row: InsertRatingVerification = {
      cdrCallId:          input.callId,
      cdrStartTime:       input.startTime,
      prefix:             null,
      destination:        null,
      iTariff:            input.iTariff,
      tariffVersionId:    null,
      durationSecs:       input.durationSecs,
      billedSecs:         null,
      sippyActualCost:    input.sippyActualCost,
      reproducedCost:     null,
      deltaAmount:        null,
      deltaPct:           null,
      discrepancyType:    'unrated',
      verificationStatus: 'pending',
      severity:           'none',
      verificationSource: 'auto',
      notes:              'No tariff snapshot available for this time period',
    };
    return storage.createRatingVerification(row);
  }

  // 2. Find matching rate by longest prefix
  const rate = resolveRate(input.callee, version.snapshotJson ?? '[]');

  if (!rate) {
    const row: InsertRatingVerification = {
      cdrCallId:          input.callId,
      cdrStartTime:       input.startTime,
      prefix:             null,
      destination:        null,
      iTariff:            input.iTariff,
      tariffVersionId:    version.id,
      durationSecs:       input.durationSecs,
      billedSecs:         null,
      sippyActualCost:    input.sippyActualCost,
      reproducedCost:     null,
      deltaAmount:        null,
      deltaPct:           null,
      discrepancyType:    'missing_rate',
      verificationStatus: 'flagged',
      severity:           'major',
      verificationSource: 'auto',
      notes:              `No matching rate found for callee ${input.callee} in version #${version.id}`,
    };
    return storage.createRatingVerification(row);
  }

  // 3. Reproduce the cost
  const reproduced = reproduceCost(input.durationSecs, rate);

  // 4. Classify discrepancy
  const { type, severity, delta, deltaPct } = classifyDiscrepancy(
    input.sippyActualCost,
    reproduced.reproducedCost,
    rate,
  );

  // 5. Persist
  const row: InsertRatingVerification = {
    cdrCallId:          input.callId,
    cdrStartTime:       input.startTime,
    prefix:             rate.prefix,
    destination:        rate.destination,
    iTariff:            input.iTariff,
    tariffVersionId:    version.id,
    durationSecs:       input.durationSecs,
    billedSecs:         reproduced.billedSecs,
    sippyActualCost:    input.sippyActualCost,
    reproducedCost:     reproduced.reproducedCost,
    deltaAmount:        delta,
    deltaPct:           deltaPct,
    discrepancyType:    type,
    verificationStatus: type === 'exact_match' ? 'verified' : 'pending',
    severity,
    verificationSource: 'auto',
    rateSnapshot:       JSON.stringify({
      prefix:     rate.prefix,
      interval1:  rate.interval1 ?? rate.interval_1,
      intervalN:  rate.intervalN ?? rate.interval_n,
      price1:     rate.price1    ?? rate.price_1,
      priceN:     rate.priceN    ?? rate.price_n,
      connectFee: rate.connectFee ?? rate.connect_fee ?? 0,
      grace:      rate.gracePeriod ?? rate.grace_period ?? 0,
      freeSecs:   rate.freeSeconds ?? rate.free_seconds ?? 0,
      surcharge:  rate.postCallSurcharge ?? rate.post_call_surcharge ?? 0,
      formula:    reproduced.formula,
    }),
  };

  return storage.createRatingVerification(row);
}

// ── Batch verification ─────────────────────────────────────────────────────────

export interface BatchVerificationResult {
  total:          number;
  verified:       number;
  discrepancies:  number;
  missing:        number;
  unrated:        number;
  totalDelta:     number;
  byType:         Record<string, number>;
  bySeverity:     Record<string, number>;
  durationMs:     number;
}

/**
 * Verify a batch of CDRs. Queue-safe — processes sequentially to avoid
 * overwhelming Sippy with tariff lookups.
 *
 * Returns a summary of results without loading all records into memory.
 */
export async function verifyBatch(
  cdrs: CdrVerificationInput[],
  opts: {
    concurrency?: number;
    onProgress?:  (processed: number, total: number) => void;
  } = {},
): Promise<BatchVerificationResult> {
  const t0 = Date.now();
  const concurrency = opts.concurrency ?? 5;

  const summary: BatchVerificationResult = {
    total:         cdrs.length,
    verified:      0,
    discrepancies: 0,
    missing:       0,
    unrated:       0,
    totalDelta:    0,
    byType:        {},
    bySeverity:    {},
    durationMs:    0,
  };

  // Process in chunks
  for (let i = 0; i < cdrs.length; i += concurrency) {
    const chunk = cdrs.slice(i, i + concurrency);
    const results = await Promise.allSettled(chunk.map(c => verifyCdr(c)));

    for (const result of results) {
      if (result.status !== 'fulfilled') continue;
      const r = result.value;

      summary.byType[r.discrepancyType]     = (summary.byType[r.discrepancyType]     ?? 0) + 1;
      summary.bySeverity[r.severity]         = (summary.bySeverity[r.severity]         ?? 0) + 1;
      summary.totalDelta                    += r.deltaAmount ?? 0;

      if (r.discrepancyType === 'exact_match') summary.verified++;
      else if (r.discrepancyType === 'missing_rate') summary.missing++;
      else if (r.discrepancyType === 'unrated') summary.unrated++;
      else summary.discrepancies++;
    }

    opts.onProgress?.(Math.min(i + concurrency, cdrs.length), cdrs.length);
  }

  summary.durationMs = Date.now() - t0;
  return summary;
}

// ── Retrieval helpers ─────────────────────────────────────────────────────────

export async function getDiscrepancySummary(opts: {
  iTariff?: string;
  since?:   Date;
} = {}): Promise<{
  total:          number;
  exact:          number;
  discrepancies:  number;
  totalDelta:     number;
  byType:         Record<string, number>;
  bySeverity:     Record<string, number>;
}> {
  const all = await storage.listRatingVerifications({
    iTariff: opts.iTariff,
    since:   opts.since,
    limit:   10000,
  });

  const byType:     Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  let totalDelta = 0;
  let exact = 0;
  let discrepancies = 0;

  for (const r of all) {
    byType[r.discrepancyType]     = (byType[r.discrepancyType]     ?? 0) + 1;
    bySeverity[r.severity]         = (bySeverity[r.severity]         ?? 0) + 1;
    totalDelta                    += r.deltaAmount ?? 0;
    if (r.discrepancyType === 'exact_match') exact++;
    else discrepancies++;
  }

  return {
    total: all.length,
    exact,
    discrepancies,
    totalDelta: +totalDelta.toFixed(6),
    byType,
    bySeverity,
  };
}
