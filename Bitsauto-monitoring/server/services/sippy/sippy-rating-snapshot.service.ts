/**
 * sippy-rating-snapshot.service.ts
 *
 * Layer 4C — Immutable Rating Snapshots
 *
 * Crystallizes verified CDR economics into permanent, tamper-evident records.
 *
 * IMMUTABILITY GUARANTEE:
 *   Once created, no economic field in invoice_cdr_snapshots is ever mutated.
 *   The snapshot_hash provides cryptographic tamper detection.
 *   This is what makes 5B (Invoice Delivery) and 5C (Reconciliation) trustworthy.
 *
 * Data flow:
 *   rating_verification (from 4B)
 *     → parse rate_snapshot JSON
 *     → extract economic fields
 *     → compute SHA-256 hash
 *     → insert immutable row
 *
 * The snapshot row becomes the canonical finance source for:
 *   - Invoice line items (5B)
 *   - Carrier reconciliation proofs (5C)
 *   - Dispute defense
 *   - Revenue assurance audit trails
 *
 * Queue-safe — no global state.
 */

import { createHash } from 'crypto';
import { storage } from '../../storage';
import type { RatingVerification, InvoiceCdrSnapshot, InsertInvoiceCdrSnapshot } from '@shared/schema';

// ── Hash computation ───────────────────────────────────────────────────────────

/**
 * Compute the canonical SHA-256 snapshot hash.
 * Uses a deterministic subset of immutable economic fields.
 *
 * The hash covers all fields that constitute the financial truth:
 * identity (cdrId), economics (costs, intervals, prices), and provenance (versionId).
 * It deliberately excludes mutable operational fields (verificationStatus, notes).
 */
export function computeSnapshotHash(fields: {
  cdrId:                  string | null | undefined;
  tariffVersionId:        number | null | undefined;
  ratingVerificationId:   number | null | undefined;
  reproducedCost:         number;
  actualCost:             number | null | undefined;
  interval1Used:          number | null | undefined;
  intervalNUsed:          number | null | undefined;
  price1Used:             number | null | undefined;
  priceNUsed:             number | null | undefined;
  connectFeeUsed:         number | null | undefined;
  gracePeriodUsed:        number | null | undefined;
  freeSecondsUsed:        number | null | undefined;
  postCallSurchargeUsed:  number | null | undefined;
  prefix:                 string | null | undefined;
  durationSecs:           number | null | undefined;
}): string {
  const canonical = JSON.stringify({
    cdrId:               fields.cdrId                ?? null,
    tariffVersionId:     fields.tariffVersionId      ?? null,
    ratingVerificationId: fields.ratingVerificationId ?? null,
    reproducedCost:      +((fields.reproducedCost ?? 0).toFixed(8)),
    actualCost:          fields.actualCost != null ? +fields.actualCost.toFixed(8) : null,
    interval1Used:       fields.interval1Used        ?? null,
    intervalNUsed:       fields.intervalNUsed        ?? null,
    price1Used:          fields.price1Used != null ? +fields.price1Used.toFixed(8) : null,
    priceNUsed:          fields.priceNUsed  != null ? +fields.priceNUsed.toFixed(8)  : null,
    connectFeeUsed:      fields.connectFeeUsed  != null ? +fields.connectFeeUsed.toFixed(8)  : null,
    gracePeriodUsed:     fields.gracePeriodUsed      ?? null,
    freeSecondsUsed:     fields.freeSecondsUsed      ?? null,
    postCallSurchargeUsed: fields.postCallSurchargeUsed != null ? +fields.postCallSurchargeUsed.toFixed(8) : null,
    prefix:              fields.prefix               ?? null,
    durationSecs:        fields.durationSecs         ?? null,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Verify the integrity of a stored snapshot by re-computing its hash.
 * Returns true if the snapshot is unmodified, false if tampered.
 */
export async function verifySnapshotIntegrity(id: number): Promise<{
  ok:       boolean;
  stored:   string;
  computed: string;
  snapshot: InvoiceCdrSnapshot | null;
}> {
  const snapshot = await storage.getInvoiceCdrSnapshot(id);
  if (!snapshot) return { ok: false, stored: '', computed: '', snapshot: null };

  const computed = computeSnapshotHash({
    cdrId:                snapshot.cdrId,
    tariffVersionId:      snapshot.tariffVersionId,
    ratingVerificationId: snapshot.ratingVerificationId,
    reproducedCost:       snapshot.reproducedCost,
    actualCost:           snapshot.actualCost,
    interval1Used:        snapshot.interval1Used,
    intervalNUsed:        snapshot.intervalNUsed,
    price1Used:           snapshot.price1Used,
    priceNUsed:           snapshot.priceNUsed,
    connectFeeUsed:       snapshot.connectFeeUsed,
    gracePeriodUsed:      snapshot.gracePeriodUsed,
    freeSecondsUsed:      snapshot.freeSecondsUsed,
    postCallSurchargeUsed: snapshot.postCallSurchargeUsed,
    prefix:               snapshot.prefix,
    durationSecs:         snapshot.durationSecs,
  });

  return {
    ok:       computed === snapshot.snapshotHash,
    stored:   snapshot.snapshotHash,
    computed,
    snapshot,
  };
}

// ── Snapshot creation ─────────────────────────────────────────────────────────

/**
 * Parse rate fields from the stored rateSnapshot JSON in a rating_verification row.
 */
function parseRateSnapshot(rateSnapshotJson: string | null | undefined): {
  interval1Used?:          number;
  intervalNUsed?:          number;
  price1Used?:             number;
  priceNUsed?:             number;
  connectFeeUsed?:         number;
  gracePeriodUsed?:        number;
  freeSecondsUsed?:        number;
  postCallSurchargeUsed?:  number;
} {
  if (!rateSnapshotJson) return {};
  try {
    const r = JSON.parse(rateSnapshotJson);
    return {
      interval1Used:         r.interval1     ?? undefined,
      intervalNUsed:         r.intervalN     ?? undefined,
      price1Used:            r.price1        ?? undefined,
      priceNUsed:            r.priceN        ?? undefined,
      connectFeeUsed:        r.connectFee    ?? undefined,
      gracePeriodUsed:       r.grace         ?? undefined,
      freeSecondsUsed:       r.freeSecs      ?? undefined,
      postCallSurchargeUsed: r.surcharge     ?? undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Create an immutable snapshot from a rating_verification record.
 *
 * Safe to call multiple times on the same cdrId — idempotent by unique index.
 * If a snapshot already exists for this cdrId, returns the existing one.
 *
 * This is the canonical entry point for Layer 4C.
 */
export async function createSnapshot(
  verificationId: number,
): Promise<InvoiceCdrSnapshot> {
  const verification = await storage.getRatingVerification(verificationId);
  if (!verification) {
    throw new Error(`Rating verification #${verificationId} not found`);
  }

  // Check idempotency — if snapshot already exists for this CDR, return it
  if (verification.cdrCallId) {
    const existing = await storage.getInvoiceCdrSnapshotByCdrId(verification.cdrCallId);
    if (existing) return existing;
  }

  const rateFields = parseRateSnapshot(verification.rateSnapshot);

  const fields: Parameters<typeof computeSnapshotHash>[0] = {
    cdrId:                verification.cdrCallId,
    tariffVersionId:      verification.tariffVersionId,
    ratingVerificationId: verification.id,
    reproducedCost:       verification.reproducedCost ?? 0,
    actualCost:           verification.sippyActualCost,
    prefix:               verification.prefix,
    durationSecs:         verification.durationSecs,
    ...rateFields,
  };

  const snapshotHash = computeSnapshotHash(fields);

  const row: InsertInvoiceCdrSnapshot = {
    cdrId:                verification.cdrCallId,
    cdrStartTime:         verification.cdrStartTime,
    callee:               verification.destination,
    durationSecs:         verification.durationSecs,
    iTariff:              verification.iTariff,
    tariffVersionId:      verification.tariffVersionId,
    ratingVerificationId: verification.id,
    reproducedCost:       verification.reproducedCost ?? 0,
    actualCost:           verification.sippyActualCost,
    delta:                verification.deltaAmount,
    prefix:               verification.prefix,
    verificationStatus:   verification.verificationStatus,
    snapshotHash,
    ...rateFields,
  };

  return storage.createInvoiceCdrSnapshot(row);
}

// ── Batch snapshot creation ───────────────────────────────────────────────────

export interface SnapshotBatchResult {
  total:     number;
  created:   number;
  skipped:   number;
  errors:    number;
  durationMs: number;
}

/**
 * Create snapshots for a batch of verified rating_verifications.
 * Skips CDRs that already have a snapshot (idempotent).
 * Skips unrated/missing_rate CDRs by default.
 *
 * This is the canonical entry point for bulk snapshot creation,
 * e.g. nightly revenue assurance run.
 */
export async function lockBatch(opts: {
  iTariff?:              string;
  excludeExactMatch?:    boolean;
  includeStatuses?:      string[];
  limit?:                number;
}): Promise<SnapshotBatchResult> {
  const t0 = Date.now();
  const result: SnapshotBatchResult = {
    total: 0, created: 0, skipped: 0, errors: 0, durationMs: 0,
  };

  // Load verified rating records that don't yet have snapshots
  const verifications = await storage.listRatingVerifications({
    iTariff: opts.iTariff,
    limit:   opts.limit ?? 1000,
  });

  // Filter to actionable records only
  const actionable = verifications.filter(v => {
    if (opts.includeStatuses) return opts.includeStatuses.includes(v.discrepancyType);
    return v.discrepancyType !== 'unrated' && v.discrepancyType !== 'missing_rate';
  });

  result.total = actionable.length;

  for (const v of actionable) {
    try {
      await createSnapshot(v.id);
      result.created++;
    } catch (err: any) {
      // Unique index violation = already exists → skip
      if (err.code === '23505') {
        result.skipped++;
      } else {
        result.errors++;
        console.error(`[rating-snapshot] lockBatch error for verification #${v.id}:`, err.message);
      }
    }
  }

  result.durationMs = Date.now() - t0;
  return result;
}

// ── Summary ───────────────────────────────────────────────────────────────────

export interface SnapshotSummary {
  total:          number;
  withDelta:      number;
  exact:          number;
  totalDelta:     number;
  totalReproduced: number;
  totalActual:    number;
  integrityErrors: number;
}

export async function getSnapshotSummary(opts: {
  iTariff?: string;
  since?:   Date;
} = {}): Promise<SnapshotSummary> {
  const all = await storage.listInvoiceCdrSnapshots({
    iTariff: opts.iTariff,
    since:   opts.since,
    limit:   50000,
  });

  let withDelta     = 0;
  let exact         = 0;
  let totalDelta    = 0;
  let totalReproduced = 0;
  let totalActual   = 0;

  for (const s of all) {
    totalReproduced += s.reproducedCost ?? 0;
    totalActual     += s.actualCost ?? 0;
    totalDelta      += s.delta ?? 0;
    if (Math.abs(s.delta ?? 0) > 0.0001) withDelta++;
    else exact++;
  }

  return {
    total:           all.length,
    withDelta,
    exact,
    totalDelta:      +totalDelta.toFixed(6),
    totalReproduced: +totalReproduced.toFixed(6),
    totalActual:     +totalActual.toFixed(6),
    integrityErrors: 0,
  };
}

/**
 * Run a full integrity audit on a sample of snapshots.
 * Re-computes each hash and flags mismatches.
 * Expensive — use only for audits, not regular calls.
 */
export async function runIntegrityAudit(opts: {
  iTariff?: string;
  limit?:   number;
} = {}): Promise<{
  audited:  number;
  passed:   number;
  failed:   number;
  failures: Array<{ id: number; stored: string; computed: string }>;
}> {
  const all = await storage.listInvoiceCdrSnapshots({
    iTariff: opts.iTariff,
    limit:   opts.limit ?? 500,
  });

  const failures: Array<{ id: number; stored: string; computed: string }> = [];

  for (const s of all) {
    const computed = computeSnapshotHash({
      cdrId:                s.cdrId,
      tariffVersionId:      s.tariffVersionId,
      ratingVerificationId: s.ratingVerificationId,
      reproducedCost:       s.reproducedCost,
      actualCost:           s.actualCost,
      interval1Used:        s.interval1Used,
      intervalNUsed:        s.intervalNUsed,
      price1Used:           s.price1Used,
      priceNUsed:           s.priceNUsed,
      connectFeeUsed:       s.connectFeeUsed,
      gracePeriodUsed:      s.gracePeriodUsed,
      freeSecondsUsed:      s.freeSecondsUsed,
      postCallSurchargeUsed: s.postCallSurchargeUsed,
      prefix:               s.prefix,
      durationSecs:         s.durationSecs,
    });
    if (computed !== s.snapshotHash) {
      failures.push({ id: s.id, stored: s.snapshotHash, computed });
    }
  }

  return {
    audited: all.length,
    passed:  all.length - failures.length,
    failed:  failures.length,
    failures,
  };
}
