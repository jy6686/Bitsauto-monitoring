/**
 * sippy-tariff-versioning.service.ts
 *
 * Layer 4A — Tariff Versioning
 *
 * Immutable tariff state capture, change detection, and Morocco-type workflows.
 *
 * This service is the prerequisite for:
 *   Layer 4B — Rating Verification Engine
 *   Layer 4C — Immutable Rating Snapshots
 *   Layer 5B — Automated Invoice Delivery
 *   Layer 5C — Carrier Invoice Reconciliation
 *
 * Design invariant: once a snapshot is written, its snapshotJson is never mutated.
 * All history is append-only. Versions form an ordered chain by createdAt.
 *
 * All methods accept SippyConfig — queue-safe, no global state.
 */

import { SippyConfig, SippyTariffRate } from './types';
import { normalizeSippyError } from './errors';
import { getTariffRatesList, detectTariffChanges } from './sippy-tariff.service';
import { auditLog } from './sippy-audit.service';
import { storage } from '../../storage';
import type {
  TariffVersion, InsertTariffVersion,
  TariffChangeEvent, InsertTariffChangeEvent,
} from '@shared/schema';

// ── Snapshot creation ─────────────────────────────────────────────────────────

/**
 * Take a point-in-time snapshot of a tariff's current rate list.
 * Writes an immutable TariffVersion record. Safe to call from queue or cron.
 *
 * source:
 *   'manual'          — operator-triggered snapshot
 *   'auto_snapshot'   — periodic background capture
 *   'pre_change'      — snapshot taken before a Morocco-type interval change
 *   'post_change'     — snapshot taken after a Morocco-type interval change
 *   'morocco_workflow'— full paired snapshot set from a Morocco workflow
 */
export async function snapshotTariff(
  config: SippyConfig,
  iTariff: string | number,
  opts: {
    source?:       TariffVersion['source'];
    tariffName?:   string;
    notes?:        string;
    createdBy?:    string;
    effectiveFrom?: Date;
    effectiveTo?:   Date;
  } = {},
): Promise<TariffVersion> {
  const t0 = Date.now();
  try {
    const rates = await getTariffRatesList(config, iTariff);

    const row: InsertTariffVersion = {
      iTariff:       String(iTariff),
      tariffName:    opts.tariffName,
      source:        opts.source ?? 'manual',
      snapshotJson:  JSON.stringify(rates),
      rateCount:     rates.length,
      effectiveFrom: opts.effectiveFrom,
      effectiveTo:   opts.effectiveTo,
      notes:         opts.notes,
      createdBy:     opts.createdBy,
    };

    const version = await storage.createTariffVersion(row);

    await auditLog({
      operationType: 'tariff_update',
      portalUrl: config.portalUrl,
      params: {
        action: 'snapshot',
        iTariff,
        versionId: version.id,
        rateCount: rates.length,
        source: opts.source ?? 'manual',
      },
      result: 'success',
      durationMs: Date.now() - t0,
    });

    return version;
  } catch (err) {
    const sippyErr = normalizeSippyError(err, 'snapshotTariff');
    await auditLog({
      operationType: 'tariff_update',
      portalUrl: config.portalUrl,
      params: { action: 'snapshot', iTariff },
      result: 'failure',
      errorMessage: sippyErr.message,
      durationMs: Date.now() - t0,
    });
    throw sippyErr;
  }
}

// ── Change detection and recording ────────────────────────────────────────────

/**
 * Compare the current live tariff state against its most recent snapshot.
 * Records TariffChangeEvent rows for each detected delta.
 *
 * Returns the new snapshot (post-change version) and a summary of changes.
 */
export async function detectAndRecordChanges(
  config: SippyConfig,
  iTariff: string | number,
  opts: {
    tariffName?: string;
    notes?:      string;
    createdBy?:  string;
  } = {},
): Promise<{
  version:        TariffVersion;
  added:          number;
  removed:        number;
  changed:        number;
  changeEvents:   TariffChangeEvent[];
}> {
  // Get last snapshot to compare against
  const lastVersion = await storage.getLatestTariffVersion(String(iTariff));

  let baseline: SippyTariffRate[] = [];
  let baseVersionId: number | null = null;

  if (lastVersion) {
    try {
      baseline     = JSON.parse(lastVersion.snapshotJson ?? '[]');
      baseVersionId = lastVersion.id;
    } catch {
      baseline = [];
    }
  }

  // Detect deltas
  const { added, removed, changed } = await detectTariffChanges(config, iTariff, baseline);

  // Take new snapshot
  const version = await snapshotTariff(config, iTariff, {
    source:    'auto_snapshot',
    tariffName: opts.tariffName,
    notes:     opts.notes,
    createdBy: opts.createdBy,
  });

  // Build change event rows
  const insertRows: InsertTariffChangeEvent[] = [
    ...added.map(r => buildChangeEvent(version.id, iTariff, r, 'added', null, r)),
    ...removed.map(r => buildChangeEvent(version.id, iTariff, r, 'removed', r, null)),
    ...changed.map(({ prefix, before, after }) => {
      const changeType = detectChangeType(before, after);
      return buildChangeEvent(version.id, iTariff, after, changeType, before, after);
    }),
  ];

  const changeEvents = await storage.bulkCreateTariffChangeEvents(insertRows);

  // Fire-and-forget: dispatch communication policies for each change event.
  // Non-blocking — economics transaction is always primary.
  if (changeEvents.length > 0) {
    import('./sippy-comm-policy.service').then(({ dispatchPoliciesForChangeEvents }) => {
      dispatchPoliciesForChangeEvents(changeEvents).catch(err => {
        console.error('[tariff-versioning] comm-policy dispatch failed:', err.message);
      });
    }).catch(() => {/* ignore import error */});
  }

  return {
    version,
    added:        added.length,
    removed:      removed.length,
    changed:      changed.length,
    changeEvents,
  };
}

// ── Morocco-type workflow ─────────────────────────────────────────────────────

/**
 * Full Morocco workflow: pre-snapshot → apply interval change → post-snapshot → record events.
 *
 * This is the canonical entry point for interval governance on any destination.
 *
 * Returns paired pre/post snapshots and the full change event set.
 * On failure, the pre-snapshot is still preserved (audit trail).
 */
export async function runIntervalChangeWorkflow(
  config: SippyConfig,
  opts: {
    iTariff:      string | number;
    prefix:       string;
    interval1:    number;
    intervalN:    number;
    tariffName?:  string;
    destination?: string;
    notes?:       string;
    createdBy?:   string;
  },
): Promise<{
  ok:             boolean;
  preSnapshot:    TariffVersion;
  postSnapshot?:  TariffVersion;
  changeEvents:   TariffChangeEvent[];
  error?:         string;
}> {
  // 1. Pre-change snapshot — always written, even on subsequent failure
  const preSnapshot = await snapshotTariff(config, opts.iTariff, {
    source:    'pre_change',
    tariffName: opts.tariffName,
    notes:     `Pre-change: prefix ${opts.prefix} → ${opts.interval1}/${opts.intervalN}`,
    createdBy: opts.createdBy,
  });

  // 2. Apply the interval change via the tariff service
  try {
    const { pushRate } = await import('./sippy-tariff.service');
    const result = await pushRate(config, {
      iTariff:   opts.iTariff,
      prefix:    opts.prefix,
      interval1: opts.interval1,
      intervalN: opts.intervalN,
      destination: opts.destination,
    });

    if (!result.ok) {
      return {
        ok:          false,
        preSnapshot,
        changeEvents: [],
        error:       result.statusMessage ?? 'Rate push failed',
      };
    }
  } catch (err) {
    return {
      ok:          false,
      preSnapshot,
      changeEvents: [],
      error:       (err as Error).message,
    };
  }

  // 3. Post-change snapshot
  const postSnapshot = await snapshotTariff(config, opts.iTariff, {
    source:    'post_change',
    tariffName: opts.tariffName,
    notes:     `Post-change: prefix ${opts.prefix} → ${opts.interval1}/${opts.intervalN}`,
    createdBy: opts.createdBy,
  });

  // 4. Detect and record the actual changes between pre and post
  let preRates: SippyTariffRate[] = [];
  let postRates: SippyTariffRate[] = [];
  try {
    preRates  = JSON.parse(preSnapshot.snapshotJson ?? '[]');
    postRates = JSON.parse(postSnapshot.snapshotJson ?? '[]');
  } catch { /* safe to continue */ }

  const preByPrefix  = new Map(preRates.map(r  => [r.prefix ?? '', r]));
  const postByPrefix = new Map(postRates.map(r => [r.prefix ?? '', r]));

  const insertRows: InsertTariffChangeEvent[] = [];
  for (const [prefix, after] of postByPrefix) {
    const before = preByPrefix.get(prefix);
    if (!before) {
      insertRows.push(buildChangeEvent(postSnapshot.id, opts.iTariff, after, 'added', null, after));
    } else if (hasChanges(before, after)) {
      insertRows.push(buildChangeEvent(postSnapshot.id, opts.iTariff, after, detectChangeType(before, after), before, after));
    }
  }
  for (const [prefix, before] of preByPrefix) {
    if (!postByPrefix.has(prefix)) {
      insertRows.push(buildChangeEvent(postSnapshot.id, opts.iTariff, before, 'removed', before, null));
    }
  }

  const changeEvents = await storage.bulkCreateTariffChangeEvents(insertRows);

  return { ok: true, preSnapshot, postSnapshot, changeEvents };
}

// ── History retrieval ─────────────────────────────────────────────────────────

/**
 * Get the full version history for a tariff, ordered newest first.
 */
export async function getTariffHistory(
  iTariff: string | number,
): Promise<TariffVersion[]> {
  return storage.listTariffVersions(String(iTariff));
}

/**
 * Get a specific version with its change events.
 */
export async function getVersionDetail(
  versionId: number,
): Promise<{
  version:      TariffVersion | null;
  changeEvents: TariffChangeEvent[];
  rates:        SippyTariffRate[];
}> {
  const version      = await storage.getTariffVersion(versionId);
  const changeEvents = version
    ? await storage.listTariffChangeEvents(versionId)
    : [];
  let rates: SippyTariffRate[] = [];
  try {
    rates = version ? JSON.parse(version.snapshotJson ?? '[]') : [];
  } catch { /* safe */ }
  return { version, changeEvents, rates };
}

/**
 * Compare two versions and return their structural diff.
 */
export async function diffVersions(
  versionIdA: number,
  versionIdB: number,
): Promise<{
  added:   SippyTariffRate[];
  removed: SippyTariffRate[];
  changed: Array<{ prefix: string; before: SippyTariffRate; after: SippyTariffRate }>;
}> {
  const [a, b] = await Promise.all([
    storage.getTariffVersion(versionIdA),
    storage.getTariffVersion(versionIdB),
  ]);

  let ratesA: SippyTariffRate[] = [];
  let ratesB: SippyTariffRate[] = [];
  try { ratesA = JSON.parse(a?.snapshotJson ?? '[]'); } catch { /* */ }
  try { ratesB = JSON.parse(b?.snapshotJson ?? '[]'); } catch { /* */ }

  const mapA = new Map(ratesA.map(r => [r.prefix ?? '', r]));
  const mapB = new Map(ratesB.map(r => [r.prefix ?? '', r]));

  const added   = ratesB.filter(r => !mapA.has(r.prefix ?? ''));
  const removed = ratesA.filter(r => !mapB.has(r.prefix ?? ''));
  const changed: Array<{ prefix: string; before: SippyTariffRate; after: SippyTariffRate }> = [];

  for (const [prefix, after] of mapB) {
    const before = mapA.get(prefix);
    if (before && hasChanges(before, after)) {
      changed.push({ prefix, before, after });
    }
  }

  return { added, removed, changed };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function hasChanges(a: SippyTariffRate, b: SippyTariffRate): boolean {
  return (
    a.interval1 !== b.interval1 ||
    a.intervalN !== b.intervalN ||
    a.price1    !== b.price1    ||
    a.priceN    !== b.priceN    ||
    a.connectFee !== b.connectFee ||
    a.gracePeriod !== b.gracePeriod ||
    a.postCallSurcharge !== b.postCallSurcharge
  );
}

function detectChangeType(before: SippyTariffRate, after: SippyTariffRate): TariffChangeEvent['changeType'] {
  const intervalChanged = before.interval1 !== after.interval1 || before.intervalN !== after.intervalN;
  const rateChanged     = before.price1 !== after.price1 || before.priceN !== after.priceN;
  const surchargeChanged = before.postCallSurcharge !== after.postCallSurcharge || before.connectFee !== after.connectFee;

  if (intervalChanged && rateChanged) return 'modified';
  if (intervalChanged) return 'interval_changed';
  if (rateChanged)     return 'rate_changed';
  if (surchargeChanged)return 'surcharge_changed';
  return 'modified';
}

function buildChangeEvent(
  tariffVersionId: number,
  iTariff: string | number,
  rate:    SippyTariffRate,
  changeType: string,
  before:  SippyTariffRate | null,
  after:   SippyTariffRate | null,
): InsertTariffChangeEvent {
  return {
    tariffVersionId,
    iTariff:      String(iTariff),
    prefix:       rate.prefix ?? '',
    destination:  rate.destination,
    changeType,
    oldInterval1: before?.interval1 ?? null,
    newInterval1: after?.interval1  ?? null,
    oldIntervalN: before?.intervalN ?? null,
    newIntervalN: after?.intervalN  ?? null,
    oldPrice1:    before?.price1    ?? null,
    newPrice1:    after?.price1     ?? null,
    oldPriceN:    before?.priceN    ?? null,
    newPriceN:    after?.priceN     ?? null,
    oldConnectFee:  before?.connectFee  ?? null,
    newConnectFee:  after?.connectFee   ?? null,
    oldGracePeriod: before?.gracePeriod ?? null,
    newGracePeriod: after?.gracePeriod  ?? null,
    oldSurcharge:   before?.postCallSurcharge ?? null,
    newSurcharge:   after?.postCallSurcharge  ?? null,
  };
}
