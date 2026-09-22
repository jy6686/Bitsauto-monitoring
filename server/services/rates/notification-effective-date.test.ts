/**
 * A rate notification quotes the date the rate takes effect — never the date the email was sent.
 *
 * Aura's first live automatic notification, 2026-09-22, said "Effective Date 2026-09-22" for
 * rates that went live on 2026-09-19. The cause was a missing fact rather than a wrong
 * calculation: the frozen row carried no effective date, `loadOperationsForPush` never selected
 * `effective_from`, and the worker's `String(r.effectiveDate ?? issueDate)` quietly resolved to
 * today. Every fixture set `effectiveDate` by hand, so every test passed.
 *
 * THE CASE THAT MATTERS IS THE FUTURE-DATED ONE. A push made on the 14th for the 22nd exists to
 * give seven days' notice; a notification announcing it as effective on the 14th contradicts the
 * notice it was sent to honour, and does so in a commercial document. So the rule under test is
 * not "carry a field through" but: the customer is told when their price actually changes.
 */
import { describe, it, expect } from 'vitest';
import { deriveNotificationsFromPush, type AppliedOperation } from './post-push-notification';

const op = (o: Partial<AppliedOperation> = {}): AppliedOperation => ({
  accountName: 'aura', productName: 'BC', trunkPrefix: '2', dialPrefix: '9230',
  fullPrefix: '29230', destinationName: 'PAKISTAN - MOBILE', requestedRate: 0.04,
  status: 'succeeded', refusedBeforeWrite: false, effectiveFrom: '2026-09-19 10:51', ...o,
});

/** Mirrors the worker's mapping, which is the line that used to substitute the send date. */
const renderedEffectiveDate = (row: any, issueDate: string) =>
  String(row.effectiveDate ?? issueDate);

describe('the effective date reaches the frozen row', () => {
  it('carries the date the push actually sent to the switch', () => {
    const r = deriveNotificationsFromPush([op()]);
    expect(r.notifications[0].rows[0].effectiveDate).toBe('2026-09-19 10:51');
  });

  /**
   * THE REGRESSION. Push on the 14th, effective the 22nd: the notification must say the 22nd.
   * Before this fix it said the day the email went out, which for a notice-period increase is
   * the one date it must never say.
   */
  it('a FUTURE-dated push renders the future date, not the send date', () => {
    const r = deriveNotificationsFromPush([op({ effectiveFrom: '2026-09-22', dialPrefix: '9370', fullPrefix: '19370', requestedRate: 0.196 })]);
    const row = r.notifications[0].rows[0];
    const sentOn = '2026-09-14';
    expect(renderedEffectiveDate(row, sentOn)).toBe('2026-09-22');
    expect(renderedEffectiveDate(row, sentOn)).not.toBe(sentOn);
  });

  it('a date-and-time effective value is quoted exactly, not truncated to a date', () => {
    // "2026-09-22" and "2026-09-22 16:29" are different moments for a priced minute.
    const r = deriveNotificationsFromPush([op({ effectiveFrom: '2026-09-22 16:29' })]);
    expect(r.notifications[0].rows[0].effectiveDate).toBe('2026-09-22 16:29');
  });

  it('each row keeps its own date — a batch may schedule destinations differently', () => {
    const r = deriveNotificationsFromPush([
      op({ dialPrefix: '9230', fullPrefix: '29230', effectiveFrom: '2026-09-22' }),
      op({ dialPrefix: '9231', fullPrefix: '29231', effectiveFrom: '2026-09-29' }),
    ]);
    expect(r.notifications[0].rows.map(x => x.effectiveDate)).toEqual(['2026-09-22', '2026-09-29']);
  });
});

describe('the fallback survives, and only for a push that genuinely had none', () => {
  it('a push with no effective date leaves the row null, so the renderer still falls back', () => {
    for (const missing of [null, undefined, '', '   ']) {
      const r = deriveNotificationsFromPush([op({ effectiveFrom: missing as any })]);
      const row = r.notifications[0].rows[0];
      expect(row.effectiveDate, String(missing)).toBeNull();
      expect(renderedEffectiveDate(row, '2026-09-22')).toBe('2026-09-22');
    }
  });

  /**
   * Obligations frozen before this change carry no effectiveDate at all. They must keep
   * rendering rather than break — the fallback is why, and it is the only case it is for.
   */
  it('a legacy row with no effectiveDate key still renders via the issue date', () => {
    expect(renderedEffectiveDate({ prefix: '9230', rate: '0.040000' }, '2026-09-22')).toBe('2026-09-22');
  });
});

describe('nothing else about the derivation changed', () => {
  it('still excludes everything that is not a proven success', () => {
    for (const status of ['failed', 'not_attempted', 'pending', 'running', 'indeterminate']) {
      const r = deriveNotificationsFromPush([op({ status })]);
      expect(r.notifications, status).toHaveLength(0);
      expect(r.excluded, status).toHaveLength(1);
    }
  });

  it('still quotes the BARE dial prefix, never the trunk-composed one', () => {
    const r = deriveNotificationsFromPush([op()]);
    expect(r.notifications[0].rows[0].prefix).toBe('9230');
    expect(r.notifications[0].rows[0].prefix).not.toBe('29230');
  });

  it('still carries the trunk digit for the dial-format line', () => {
    expect(deriveNotificationsFromPush([op()]).notifications[0].rows[0].productDigit).toBe('2');
  });
});
