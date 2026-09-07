import { describe, it, expect } from 'vitest';
import {
  fallbackRecipient, planDelivery, markReviewCopy, FALLBACK_ENV, REVIEW_COPY_PREFIX,
} from './billing-fallback';

describe('fallbackRecipient — from the environment, never from source', () => {
  it('reads the configured address', () => {
    expect(fallbackRecipient({ [FALLBACK_ENV]: ' finance@example.com ' })).toBe('finance@example.com');
  });

  it('is null when unset, blank, or not an address', () => {
    expect(fallbackRecipient({})).toBeNull();
    expect(fallbackRecipient({ [FALLBACK_ENV]: '' })).toBeNull();
    expect(fallbackRecipient({ [FALLBACK_ENV]: '   ' })).toBeNull();
    expect(fallbackRecipient({ [FALLBACK_ENV]: 'not-an-email' })).toBeNull();
    expect(fallbackRecipient({ [FALLBACK_ENV]: 'a@b' })).toBeNull();
  });

  it('has no default — a personal address must not live in the code', () => {
    expect(fallbackRecipient({})).toBeNull();
  });
});

describe('planDelivery — the fallback only fills an EMPTY list', () => {
  const fb = 'finance@example.com';

  it('never touches a customer that has recipients', () => {
    const p = planDelivery({ recipients: ['ap@customer.com', ' cfo@customer.com '], source: 'company.invoiceEmail', fallback: fb });
    expect(p.recipients).toEqual(['ap@customer.com', 'cfo@customer.com']);
    expect(p.reviewCopy).toBeNull();
  });

  it('uses the fallback when there are none, and says why', () => {
    const p = planDelivery({ recipients: [], source: 'company.invoiceEmail (empty), 0 billing contact(s)', fallback: fb });
    expect(p.recipients).toEqual([fb]);
    expect(p.reviewCopy).toMatchObject({ fallbackTo: fb });
    expect(p.reviewCopy!.reason).toContain('not configured');
    expect(p.reviewCopy!.reason).toContain('0 billing contact(s)');   // the lookup's own words survive
    expect(p.reviewCopy!.reason).toContain('NOT delivered to the customer');
  });

  it('leaves the list empty when no fallback is configured, so the caller fails as before', () => {
    const p = planDelivery({ recipients: [], source: 'x', fallback: null });
    expect(p.recipients).toEqual([]);
    expect(p.reviewCopy).toBeNull();
  });

  it('treats whitespace-only recipients as none', () => {
    const p = planDelivery({ recipients: ['  ', ''], source: 'x', fallback: fb });
    expect(p.recipients).toEqual([fb]);
    expect(p.reviewCopy).not.toBeNull();
  });
});

describe('markReviewCopy — distinguishable in subject and body, idempotent', () => {
  const rc = { reason: 'Customer billing email not configured (x). Review copy…', fallbackTo: 'f@x.com' };

  it('prefixes the subject and banners the body', () => {
    const m = markReviewCopy('Invoice C-2609-0012 — PUSHTOTALK', 'Dear Customer,', rc);
    expect(m.subject).toBe(`${REVIEW_COPY_PREFIX} Invoice C-2609-0012 — PUSHTOTALK`);
    expect(m.body.startsWith('*** REVIEW COPY')).toBe(true);
    expect(m.body).toContain('Dear Customer,');
  });

  it('does not stack the prefix on a retry', () => {
    const once  = markReviewCopy('Invoice X', 'body', rc);
    const twice = markReviewCopy(once.subject, once.body, rc);
    expect(twice).toEqual(once);
    expect(twice.subject.match(/\[REVIEW COPY\]/g)).toHaveLength(1);
  });
});
