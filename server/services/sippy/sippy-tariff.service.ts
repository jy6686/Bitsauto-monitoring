/**
 * sippy-tariff.service.ts
 *
 * Telecom Economics Middleware — the most important domain service.
 *
 * Owns: tariff retrieval, tariff sync, interval/rate changes, rate uploads,
 * tariff version detection, and Morocco-type billing interval workflows.
 *
 * This service is the foundation for future:
 *   - Tariff versioning
 *   - Invoice reproducibility
 *   - Rate reconciliation
 *   - Revenue assurance
 *
 * Design: All methods accept SippyConfig — no global state, queue-safe.
 * All write operations emit audit log entries.
 */

import * as sippy from '../../sippy';
import {
  SippyConfig, SippyTariff, SippyTariffRate,
  RateUploadResult, ServiceResult,
} from './types';
import {
  normalizeSippyError, SippyRateUploadError, SippyValidationError,
} from './errors';
import { auditLog } from './sippy-audit.service';
import { withRetry, normalizePrefix, isValidPrefix } from './utils';

// ── Tariff retrieval ──────────────────────────────────────────────────────────

/**
 * List all tariffs on the switch.
 * Returns standardized SippyTariff objects regardless of Sippy version.
 */
export async function getTariffsList(config: SippyConfig): Promise<SippyTariff[]> {
  try {
    // Try new API first, fall back to legacy
    try {
      const result = await sippy.getTariffsList(config.username, config.password, config.portalUrl);
      return (result ?? []) as SippyTariff[];
    } catch {
      const legacy = await sippy.getSippyTariffList(config.username, config.password);
      return (legacy ?? []).map(t => ({
        iTariff: t.id,
        name:    t.name,
        type:    t.type,
      }));
    }
  } catch (err) {
    throw normalizeSippyError(err, 'getTariffsList');
  }
}

/**
 * Get detailed info for a single tariff by ID.
 */
export async function getTariffInfo(
  config: SippyConfig,
  iTariff: string | number,
): Promise<SippyTariff> {
  try {
    const result = await sippy.getTariffInfo(config.username, config.password, iTariff, config.portalUrl);
    return result as SippyTariff;
  } catch (err) {
    throw normalizeSippyError(err, 'getTariffInfo');
  }
}

/**
 * Get the full rate list for a given tariff.
 * Supports all standard Sippy rate fields:
 *   interval_1, interval_n, price_1, price_n, free_seconds,
 *   grace_period, connect_fee, post_call_surcharge
 */
export async function getTariffRatesList(
  config: SippyConfig,
  iTariff: string | number,
  prefix?: string,
): Promise<SippyTariffRate[]> {
  try {
    const rows = await sippy.getTariffRatesListFull(
      config.username, config.password, iTariff, config.portalUrl, prefix,
    );
    return (rows ?? []).map(r => ({
      prefix:           r.prefix,
      destination:      r.destination,
      price1:           r.price1   ?? r.price_1   ?? r.p1,
      priceN:           r.priceN   ?? r.price_n   ?? r.pn,
      interval1:        r.interval1  ?? r.interval_1  ?? 60,
      intervalN:        r.intervalN  ?? r.interval_n  ?? 60,
      freeSeconds:      r.freeSeconds  ?? r.free_seconds  ?? 0,
      gracePeriod:      r.gracePeriod  ?? r.grace_period  ?? 0,
      connectFee:       r.connectFee   ?? r.connect_fee   ?? 0,
      postCallSurcharge:r.postCallSurcharge ?? r.post_call_surcharge ?? 0,
      ...r,
    })) as SippyTariffRate[];
  } catch (err) {
    throw normalizeSippyError(err, 'getTariffRatesList');
  }
}

/**
 * Get rate analysis for a specific prefix — useful for LCR comparison.
 */
export async function getRateAnalysis(
  config: SippyConfig,
  params: {
    prefix: string;
    iTariff?: string | number;
    iAccount?: string | number;
  },
): Promise<unknown> {
  try {
    return await sippy.getSippyRateAnalysis(
      config.username, config.password, params, config.portalUrl,
    );
  } catch (err) {
    throw normalizeSippyError(err, 'getRateAnalysis');
  }
}

// ── Tariff write operations ───────────────────────────────────────────────────

/**
 * Create a new tariff on the switch.
 */
export async function createTariff(
  config: SippyConfig,
  opts: { name: string; currency?: string; type?: string },
): Promise<ServiceResult<{ iTariff: string | number }>> {
  const t0 = Date.now();
  try {
    const result = await sippy.createTariff(
      config.username, config.password,
      { name: opts.name, currency: opts.currency ?? 'USD' },
      config.portalUrl,
    );
    await auditLog({
      operationType: 'tariff_update',
      portalUrl: config.portalUrl,
      params: { action: 'create', name: opts.name },
      result: 'success',
      durationMs: Date.now() - t0,
    });
    return { ok: true, data: { iTariff: (result as any)?.iTariff ?? (result as any)?.i_tariff } };
  } catch (err) {
    const sippyErr = normalizeSippyError(err, 'createTariff');
    await auditLog({
      operationType: 'tariff_update',
      portalUrl: config.portalUrl,
      params: { action: 'create', name: opts.name },
      result: 'failure',
      errorMessage: sippyErr.message,
      durationMs: Date.now() - t0,
    });
    return { ok: false, error: sippyErr.message };
  }
}

// ── Rate write operations ─────────────────────────────────────────────────────

/**
 * Upload or update a single rate entry on a tariff.
 *
 * Supports all standard Sippy billing parameters:
 *   interval_1, interval_n, price_1, price_n, free_seconds,
 *   grace_period, connect_fee, post_call_surcharge
 *
 * This is the canonical entry point for Morocco-type billing interval changes.
 */
export async function pushRate(
  config: SippyConfig,
  opts: {
    iTariff:             string | number;
    prefix:              string;
    price1?:             number;
    priceN?:             number;
    interval1?:          number;
    intervalN?:          number;
    freeSeconds?:        number;
    gracePeriod?:        number;
    connectFee?:         number;
    postCallSurcharge?:  number;
    destination?:        string;
  },
): Promise<RateUploadResult> {
  // Validate prefix before hitting the switch
  if (!isValidPrefix(opts.prefix)) {
    throw new SippyValidationError(`Invalid prefix: ${opts.prefix}`, 'prefix');
  }

  const t0 = Date.now();
  try {
    const result = await withRetry(() =>
      sippy.pushRateToSippy(
        {
          iTariff:            opts.iTariff,
          prefix:             normalizePrefix(opts.prefix),
          price_1:            opts.price1,
          price_n:            opts.priceN,
          interval_1:         opts.interval1,
          interval_n:         opts.intervalN,
          free_seconds:       opts.freeSeconds,
          grace_period:       opts.gracePeriod,
          connect_fee:        opts.connectFee,
          post_call_surcharge:opts.postCallSurcharge,
          destination:        opts.destination,
        },
        { username: config.username, password: config.password },
        config.portalUrl,
      ),
      { maxAttempts: 2 },
    );

    await auditLog({
      operationType: 'rate_upload',
      portalUrl: config.portalUrl,
      params: { iTariff: opts.iTariff, prefix: opts.prefix },
      result: 'success',
      durationMs: Date.now() - t0,
    });

    return {
      ok: true,
      statusMessage: (result as any)?.message ?? 'Rate uploaded',
    };
  } catch (err) {
    const sippyErr = normalizeSippyError(err, 'pushRate');
    await auditLog({
      operationType: 'rate_upload',
      portalUrl: config.portalUrl,
      params: { iTariff: opts.iTariff, prefix: opts.prefix },
      result: 'failure',
      errorMessage: sippyErr.message,
      durationMs: Date.now() - t0,
    });
    throw new SippyRateUploadError(sippyErr.message);
  }
}

/**
 * Update billing intervals for a destination prefix on a tariff.
 *
 * This is the primary workflow for Morocco-type interval changes:
 *   e.g. 60/60 → 30/6 for prefix 212
 *
 * Wraps pushRate with semantic naming for operator clarity.
 */
export async function updateBillingInterval(
  config: SippyConfig,
  opts: {
    iTariff:    string | number;
    prefix:     string;
    interval1:  number;
    intervalN:  number;
    destination?: string;
  },
): Promise<RateUploadResult> {
  return pushRate(config, {
    iTariff:   opts.iTariff,
    prefix:    opts.prefix,
    interval1: opts.interval1,
    intervalN: opts.intervalN,
    destination: opts.destination,
  });
}

/**
 * Delete all rates in a tariff — use with caution.
 */
export async function clearTariffRates(
  config: SippyConfig,
  iTariff: string | number,
): Promise<ServiceResult<void>> {
  const t0 = Date.now();
  try {
    await sippy.deleteAllRatesInTariff(config.username, config.password, iTariff, config.portalUrl);
    await auditLog({
      operationType: 'tariff_update',
      portalUrl: config.portalUrl,
      params: { action: 'clearRates', iTariff },
      result: 'success',
      durationMs: Date.now() - t0,
    });
    return { ok: true };
  } catch (err) {
    const sippyErr = normalizeSippyError(err, 'clearTariffRates');
    await auditLog({
      operationType: 'tariff_update',
      portalUrl: config.portalUrl,
      params: { action: 'clearRates', iTariff },
      result: 'failure',
      errorMessage: sippyErr.message,
      durationMs: Date.now() - t0,
    });
    return { ok: false, error: sippyErr.message };
  }
}

// ── Tariff version detection ──────────────────────────────────────────────────

/**
 * Compare live tariff rates against a known baseline snapshot.
 * Returns changed prefixes — used for tariff version detection and reconciliation.
 */
export async function detectTariffChanges(
  config: SippyConfig,
  iTariff: string | number,
  baseline: SippyTariffRate[],
): Promise<{
  added:    SippyTariffRate[];
  removed:  SippyTariffRate[];
  changed:  Array<{ prefix: string; before: SippyTariffRate; after: SippyTariffRate }>;
}> {
  const live = await getTariffRatesList(config, iTariff);
  const liveByPrefix  = new Map(live.map(r => [r.prefix ?? '', r]));
  const baseByPrefix  = new Map(baseline.map(r => [r.prefix ?? '', r]));

  const added   = live.filter(r => !baseByPrefix.has(r.prefix ?? ''));
  const removed = baseline.filter(r => !liveByPrefix.has(r.prefix ?? ''));
  const changed: Array<{ prefix: string; before: SippyTariffRate; after: SippyTariffRate }> = [];

  for (const [prefix, after] of liveByPrefix) {
    const before = baseByPrefix.get(prefix);
    if (!before) continue;
    const isChanged =
      before.price1    !== after.price1    ||
      before.priceN    !== after.priceN    ||
      before.interval1 !== after.interval1 ||
      before.intervalN !== after.intervalN;
    if (isChanged) changed.push({ prefix, before, after });
  }

  return { added, removed, changed };
}
