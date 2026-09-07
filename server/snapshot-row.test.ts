/**
 * buildSnapshotRow — the row a verification becomes when it is locked into
 * billing evidence.
 *
 * WHY THIS EXISTS. Snapshot writing moved from one INSERT per CDR to batched
 * inserts on 2026-09-07, because the per-row path ran at 3-4 rows/second and
 * a 5,812-call day took 25 minutes. Batching is only safe if a batched row is
 * IDENTICAL to a singly-created one — above all its `snapshotHash`, which is
 * the tamper evidence the whole finance chain rests on. The builder is now
 * shared by both paths, so these tests pin the mapping and the hash.
 */

import { describe, it, expect } from 'vitest';
import { buildSnapshotRow, computeSnapshotHash } from './services/sippy/sippy-rating-snapshot.service';
import type { RatingVerification } from '@shared/schema';

const verification = (over: Partial<RatingVerification> = {}): RatingVerification => ({
  id:                 4210,
  cdrCallId:          '7c5b931536c6c6163a714d971@47.84.63.223-b2b_1',
  cdrStartTime:       '2026-09-04T00:35:12.000Z',
  prefix:             '792',
  destination:        '7923245211500',
  iTariff:            '32',
  tariffVersionId:    150459,
  durationSecs:       8,
  billedSecs:         8,
  sippyActualCost:    0.0036666666,
  reproducedCost:     0.0036666666,
  deltaAmount:        0,
  deltaPct:           0,
  discrepancyType:    'exact_match',
  verificationStatus: 'verified',
  verificationSource: 'repository',
  severity:           null,
  verifiedAt:         null,
  notes:              null,
  rateSnapshot:       JSON.stringify({ interval1: 1, intervalN: 1, price1: 0.0275, priceN: 0.0275, connectFee: 0, grace: 0, freeSecs: 0, surcharge: 0 }),
  createdAt:          new Date('2026-09-07T13:56:33.000Z'),
  ...over,
} as RatingVerification);

describe('buildSnapshotRow', () => {
  it('carries the economic fields the invoice is built from', () => {
    const row = buildSnapshotRow(verification());
    expect(row.cdrId).toBe('7c5b931536c6c6163a714d971@47.84.63.223-b2b_1');
    expect(row.cdrStartTime).toBe('2026-09-04T00:35:12.000Z');
    // `callee` comes from the verification's destination, not its prefix.
    expect(row.callee).toBe('7923245211500');
    expect(row.iTariff).toBe('32');
    expect(row.tariffVersionId).toBe(150459);
    expect(row.ratingVerificationId).toBe(4210);
    expect(row.actualCost).toBe(0.0036666666);
    expect(row.reproducedCost).toBe(0.0036666666);
    expect(row.delta).toBe(0);
    expect(row.verificationStatus).toBe('verified');
  });

  it('unpacks the rate that was actually applied', () => {
    const row = buildSnapshotRow(verification()) as any;
    expect(row.price1Used).toBe(0.0275);
    expect(row.priceNUsed).toBe(0.0275);
    expect(row.interval1Used).toBe(1);
    expect(row.intervalNUsed).toBe(1);
    expect(row.connectFeeUsed).toBe(0);
  });

  it('hashes exactly what computeSnapshotHash hashes', () => {
    const v = verification();
    const row = buildSnapshotRow(v);
    expect(row.snapshotHash).toBe(computeSnapshotHash({
      cdrId: v.cdrCallId, tariffVersionId: v.tariffVersionId, ratingVerificationId: v.id,
      reproducedCost: v.reproducedCost ?? 0, actualCost: v.sippyActualCost,
      interval1Used: 1, intervalNUsed: 1, price1Used: 0.0275, priceNUsed: 0.0275,
      connectFeeUsed: 0, gracePeriodUsed: 0, freeSecondsUsed: 0, postCallSurchargeUsed: 0,
      prefix: v.prefix, durationSecs: v.durationSecs,
    }));
  });

  it('is deterministic, so a batched row equals a singly-written one', () => {
    expect(buildSnapshotRow(verification()).snapshotHash)
      .toBe(buildSnapshotRow(verification()).snapshotHash);
  });

  it('still detects a changed price — batching must not weaken tamper evidence', () => {
    const asRated  = buildSnapshotRow(verification()).snapshotHash;
    const reRated  = buildSnapshotRow(verification({
      rateSnapshot: JSON.stringify({ interval1: 1, intervalN: 1, price1: 0.001, priceN: 0.001, connectFee: 0, grace: 0, freeSecs: 0, surcharge: 0 }),
    })).snapshotHash;
    // The PUSHTOTALK question in one assertion: 0.0275 and 0.001 are not the
    // same evidence, and the hash must say so.
    expect(reRated).not.toBe(asRated);
  });

  it('treats a missing reproduced cost as zero rather than dropping the row', () => {
    const row = buildSnapshotRow(verification({ reproducedCost: null } as Partial<RatingVerification>));
    expect(row.reproducedCost).toBe(0);
    expect(row.snapshotHash).toHaveLength(64);
  });

  it('survives an unparseable rate snapshot without inventing rates', () => {
    const row = buildSnapshotRow(verification({ rateSnapshot: 'not json' })) as any;
    expect(row.price1Used).toBeUndefined();
    expect(row.snapshotHash).toHaveLength(64);
  });
});
