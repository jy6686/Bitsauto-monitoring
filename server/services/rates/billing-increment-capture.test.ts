/**
 * The billing increment must survive the push into the customer's document.
 *
 * It was lost at `loadOperationsForPush`'s SELECT: the column existed on the operation, the
 * renderer already had a Billing Increment column, and the frozen row in between carried nothing
 * — so the sheet's terms paragraph pointed at a column that was blank on every row.
 *
 * THE DISTINCTION THESE TESTS EXIST TO PROTECT. A populated interval is the term server-resolved
 * from the active commercial catalogue and actually applied to the switch, so quoting it is
 * honest. A NULL means the prefix was absent from that catalogue and the legacy path kept 1/1
 * with no commercial row to consult — a default nobody committed to. Rendering that as "1/1"
 * would print a commitment that was never made, which is the failure the blank cell prevents.
 */
import { describe, it, expect } from 'vitest';
import {
  deriveNotificationsFromPush, formatBillingIncrement, type AppliedOperation,
} from './post-push-notification';
import { buildFrozenRateSheetModel } from './frozen-rate-sheet';

const op = (over: Partial<AppliedOperation> = {}): AppliedOperation => ({
  accountName: 'aura', productName: 'FC', trunkPrefix: '1', dialPrefix: '9230',
  fullPrefix: '19230', destinationName: 'PAKISTAN - MOBILE', requestedRate: 0.04,
  status: 'succeeded', refusedBeforeWrite: false, effectiveFrom: '2026-09-24 11:54',
  interval1: 60, intervalN: 1, ...over,
});

describe('formatBillingIncrement', () => {
  it('renders initial/subsequent seconds', () => {
    expect(formatBillingIncrement(60, 1)).toBe('60/1');
    expect(formatBillingIncrement(1, 1)).toBe('1/1');
  });

  /** Half a term is not a term. */
  it('is empty unless BOTH halves are present', () => {
    expect(formatBillingIncrement(60, null)).toBe('');
    expect(formatBillingIncrement(null, 1)).toBe('');
    expect(formatBillingIncrement(null, null)).toBe('');
    expect(formatBillingIncrement(undefined, undefined)).toBe('');
  });

  /** A default nobody committed to must never be invented here. */
  it('never substitutes 1/1 for a missing term', () => {
    expect(formatBillingIncrement(null, null)).not.toBe('1/1');
  });

  it('is empty for unusable numbers', () => {
    expect(formatBillingIncrement(NaN, 1)).toBe('');
    expect(formatBillingIncrement(60, Infinity)).toBe('');
  });
});

describe('the increment reaches the frozen customer row', () => {
  it('carries an applied increment through to the row', () => {
    const [n] = deriveNotificationsFromPush([op()]).notifications;
    expect(n.rows[0].billingIncrement).toBe('60/1');
  });

  /** THE FIX. Before this, every row was blank regardless of what the push applied. */
  it('does not blank a row that has one', () => {
    const [n] = deriveNotificationsFromPush([op({ interval1: 1, intervalN: 1 })]).notifications;
    expect(n.rows[0].billingIncrement).toBe('1/1');
    expect(n.rows[0].billingIncrement).not.toBe('');
  });

  it('leaves a row blank when the push established no term', () => {
    const [n] = deriveNotificationsFromPush([op({ interval1: null, intervalN: null })]).notifications;
    expect(n.rows[0].billingIncrement).toBe('');
  });

  /**
   * The realistic case: one destination priced in the active catalogue, another absent from it.
   * The sheet must show each row's own truth rather than one answer for the whole notice.
   */
  it('is decided per row, not per sheet', () => {
    const [n] = deriveNotificationsFromPush([
      op({ dialPrefix: '9230', fullPrefix: '19230', interval1: 60, intervalN: 1 }),
      op({ dialPrefix: '8801', fullPrefix: '18801', interval1: null, intervalN: null }),
    ]).notifications;
    expect(n.rows.map(r => r.billingIncrement)).toEqual(['60/1', '']);
  });

  /**
   * The last hop. The derivation can carry the increment perfectly and the XLSX still print
   * nothing — which is exactly what it did, because the sheet hard-coded a blank cell.
   */
  it('reaches the XLSX model, per row', () => {
    const m = buildFrozenRateSheetModel({
      companyName: 'aura', productLabel: 'First Class', accountPrefix: '1018', kamName: 'Junaid',
      issueDate: '2026-09-24', sentAt: new Date('2026-09-24T11:42:33Z'),
      rows: [
        { rate: '0.030000', prefix: '8801', currency: 'USD', destination: 'BANGLADESH - MOBILE',
          productCode: 'FC', productDigit: '1', productLabel: 'First Class',
          effectiveDate: '2026-09-24 12:24', billingIncrement: '60/1' },
        { rate: '0.060000', prefix: '9234', currency: 'USD', destination: 'PAKISTAN - MOBILE TELENOR',
          productCode: 'FC', productDigit: '1', productLabel: 'First Class',
          effectiveDate: '2026-09-24 13:24', billingIncrement: '' },
      ],
    });
    expect(m.rows.map(r => r.billingIncrement)).toEqual(['60/1', '']);
  });

  /** The increment must not rescue a row the evidence rule excludes. */
  it('does not make an unproven operation announceable', () => {
    const report = deriveNotificationsFromPush([
      op({ status: 'indeterminate', interval1: 60, intervalN: 1 }),
    ]);
    expect(report.notifications).toEqual([]);
    expect(report.excluded).toHaveLength(1);
  });
});
