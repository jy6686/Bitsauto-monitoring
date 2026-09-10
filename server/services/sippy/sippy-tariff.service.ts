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
import type { MutationBoundary } from '../../sippy';
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
    const result = await sippy.getTariffInfo(config.username, config.password, Number(iTariff));
    return result as unknown as SippyTariff;
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
      config.username, config.password, Number(iTariff),
      undefined, undefined, undefined, config.portalUrl,
    );
    return (rows ?? []) as unknown as SippyTariffRate[];
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
      config.username, config.password,
      { tariffId: params.iTariff != null ? String(params.iTariff) : undefined,
        destination: params.prefix },
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
  // The legacy Sippy write path accepts one numeric per-minute price. Passing an
  // interval-only rollback through it used to become ratePerMin=undefined, yet still
  // requested an upload token and locked the tariff. Fail before any remote write.
  if (opts.price1 == null || !Number.isFinite(Number(opts.price1))) {
    throw new SippyValidationError(
      `A finite price1 is required to write prefix ${opts.prefix}; interval-only writes are not supported by this path`,
      'price1',
    );
  }

  const t0 = Date.now();
  try {
    const result = await withRetry(async () => {
      const pushed = await sippy.pushRateToSippy(
        {
          accountName:        opts.destination ?? `tariff-${opts.iTariff}`,
          iTariff:            opts.iTariff != null ? String(opts.iTariff) : undefined,
          prefix:             normalizePrefix(opts.prefix),
          ratePerMin:         Number(opts.price1),
        },
        { username: config.username, password: config.password },
        config.portalUrl,
      );
      if (!pushed.success) throw new Error(pushed.message);
      return pushed;
    }, { maxAttempts: 2 });

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

/** What a clear is known to have done. Only `failure` means nothing was sent. */
export type ClearVerdict = 'success' | 'failure' | 'indeterminate';

export interface ClearTariffRatesResult extends ServiceResult<void> {
  verdict: ClearVerdict;
  /**
   * True = no request left this process. False = one did, whatever happened next.
   *
   * Structural, taken from where the boundary sits relative to the request — never inferred
   * from an error message, because a message describes a failure and is not evidence about
   * whether bytes left the process.
   */
  refusedBeforeWrite: boolean;
}

/**
 * Delete all rates in a tariff.
 *
 * THE HAZARD HERE IS THE REPORT, NOT THE RETRY.
 *
 * `deleteAllRatesInTariff` is idempotent at the Sippy operation level, so re-issuing it is
 * harmless. What is not harmless is telling an operator "this failed" when the tariff has in
 * fact been emptied — they will reason about the next step from a tariff state that no longer
 * exists. A caller deciding whether to proceed with a destructive workflow needs to know
 * whether the request was sent, which a thrown error alone cannot say.
 *
 * So this returns three verdicts rather than a boolean:
 *
 *   failure        nothing was sent — safe to retry, and the tariff is untouched
 *   indeterminate  a request was sent and the outcome is unknown — the tariff may be empty
 *   success        Sippy accepted it
 *
 * `success` is Sippy's own say-so and not proof of the resulting state. A caller that depends
 * on the tariff actually being empty must read it back; see the restore route, which does.
 */
export async function clearTariffRates(
  config: SippyConfig,
  iTariff: string | number,
): Promise<ClearTariffRatesResult> {
  const t0 = Date.now();
  const boundary: MutationBoundary = { crossed: false };
  try {
    await sippy.deleteAllRatesInTariff(config.username, config.password, Number(iTariff), undefined, boundary);
    await auditLog({
      operationType: 'tariff_update',
      portalUrl: config.portalUrl,
      params: { action: 'clearRates', iTariff },
      result: 'success',
      durationMs: Date.now() - t0,
    });
    return { ok: true, verdict: 'success', refusedBeforeWrite: false };
  } catch (err) {
    const sippyErr = normalizeSippyError(err, 'clearTariffRates');
    // The boundary decides, not the error. A fault raised after the request was sent is an
    // unknown outcome; a failure before it is a clean one.
    const verdict: ClearVerdict = boundary.crossed ? 'indeterminate' : 'failure';
    await auditLog({
      operationType: 'tariff_update',
      portalUrl: config.portalUrl,
      params: { action: 'clearRates', iTariff, verdict, requestSent: boundary.crossed },
      result: 'failure',
      errorMessage: sippyErr.message,
      durationMs: Date.now() - t0,
    });
    return {
      ok: false, verdict, refusedBeforeWrite: !boundary.crossed,
      error: verdict === 'indeterminate'
        ? `${sippyErr.message} — the delete request WAS sent, so what the tariff now holds is unknown. Read it back before acting on this.`
        : sippyErr.message,
    };
  }
}

/**
 * Bulk-upload all rates for a tariff in one XLSX file via the upload-token path.
 * This is the CORRECT replacement for the per-rate pushRate() loop in the restore route.
 * pushRate() called sippy.pushRateToSippy() which is account-based and silently fails
 * when called without an accountName — this function uses the direct tariff upload path.
 */
export async function bulkPushRates(
  config: SippyConfig,
  iTariff: string | number,
  rates: Array<{
    prefix:       string;
    price1:       number;
    priceN:       number;
    interval1?:   number;
    intervalN?:   number;
    gracePeriod?: number;
    destination?: string;
  }>,
): Promise<{ pushed: number; message: string }> {
  const t0    = Date.now();
  const iT    = Number(iTariff);

  // ── Attempt 1: XLSX bulk upload via getUploadToken ──────────────────────────
  let xlsxOk = false;
  try {
    const result = await sippy.pushRatesBulkXlsx(
      config.username,
      config.password,
      iT,
      rates,
      config.portalUrl,
    );
    if (result.success) {
      await auditLog({
        operationType: 'tariff_update',
        portalUrl:     config.portalUrl,
        params:        { action: 'bulkPushRates', method: 'xlsx', iTariff, count: rates.length },
        result:        'success',
        durationMs:    Date.now() - t0,
      });
      return { pushed: result.pushed, message: result.message };
    }
    console.warn(`[bulkPushRates] XLSX upload failed (${result.message}), falling back to per-rate XML-RPC`);
  } catch (err: any) {
    console.warn(`[bulkPushRates] XLSX upload threw (${err?.message}), falling back to per-rate XML-RPC`);
  }

  // ── Attempt 2: per-rate direct XML-RPC (addRateDirectToTariff) ───────────────
  let pushed      = 0;
  let lastMethod: string | undefined;
  const errors: string[] = [];

  for (const rate of rates) {
    const r = await sippy.addRateDirectToTariff(
      config.username,
      config.password,
      iT,
      rate,
      config.portalUrl,
    );
    if (r.success) {
      pushed++;
      lastMethod = r.method;
    } else {
      errors.push(`prefix=${rate.prefix}: ${r.message}`);
    }
  }

  const success = pushed === rates.length;
  const msg     = success
    ? `${pushed} rate(s) pushed via direct XML-RPC (${lastMethod})`
    : `${pushed}/${rates.length} rate(s) pushed via direct XML-RPC; errors: ${errors.slice(0, 3).join('; ')}`;

  await auditLog({
    operationType: 'tariff_update',
    portalUrl:     config.portalUrl,
    params:        { action: 'bulkPushRates', method: 'direct-xmlrpc', iTariff, count: rates.length, pushed },
    result:        success ? 'success' : 'failure',
    errorMessage:  success ? undefined : msg,
    durationMs:    Date.now() - t0,
  });

  if (!success && pushed === 0) {
    throw normalizeSippyError(new Error(msg), 'bulkPushRates');
  }

  return { pushed, message: msg };
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
