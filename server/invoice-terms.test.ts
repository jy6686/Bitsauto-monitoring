/**
 * Payment terms → due date.
 *
 * The rule an owner set after two fields were found competing: prepaid pays on
 * the invoice date and says so; postpaid pays invoice date plus its terms. This
 * pins it, because the same answer has to appear on the PDF and in the email.
 */

import { describe, it, expect } from 'vitest';
import { resolveInvoiceTerms, daysFromPaymentTerm, paymentTermLabel, fmtInvoiceDate } from './invoice-terms';

describe('resolveInvoiceTerms', () => {
  it('prepaid falls due on the invoice date and states the condition', () => {
    const t = resolveInvoiceTerms('2026-08-24', 'prepaid', 30);
    expect(t.dueDate).toBe('2026-08-24');
    expect(t.dueLabel).toBe('Payment due immediately');
    expect(t.basis).toBe('prepaid');
  });

  it('prepaid ignores any terms days — credit was never extended', () => {
    expect(resolveInvoiceTerms('2026-08-24', 'prepaid', 45).dueDate).toBe('2026-08-24');
    expect(resolveInvoiceTerms('2026-08-24', 'Advance', 15).dueDate).toBe('2026-08-24');
  });

  it('postpaid adds the recorded terms to the invoice date', () => {
    const t = resolveInvoiceTerms('2026-08-24', 'postpaid', 15);
    expect(t.dueDate).toBe('2026-09-08');
    expect(t.dueLabel).toContain('Net 15');
    expect(t.basis).toBe('postpaid');
  });

  it('crosses month and year boundaries correctly', () => {
    expect(resolveInvoiceTerms('2026-12-20', 'postpaid', 30).dueDate).toBe('2027-01-19');
    expect(resolveInvoiceTerms('2026-01-31', 'postpaid', 1).dueDate).toBe('2026-02-01');
  });

  it('no recorded length anywhere → NOT CONFIGURED, never an invented 30 days', () => {
    // Owner rule: fail visibly. A silent default would put a contractual
    // deadline on a customer document that nobody agreed to.
    for (const t of [
      resolveInvoiceTerms('2026-08-24', 'postpaid', null),
      resolveInvoiceTerms('2026-08-24', 'postpaid', undefined),
      resolveInvoiceTerms('2026-08-24', null, null),
      resolveInvoiceTerms('2026-08-24', '', undefined),
      resolveInvoiceTerms('2026-08-24', 'something-else', null),
    ]) {
      expect(t.basis).toBe('unconfigured');
      expect(t.dueDate).toBeNull();
      expect(t.termsDays).toBeNull();
      expect(t.termLabel).toBe('Not configured');
      expect(t.dueLabel).toBe('Payment terms not configured');
    }
  });

  it('an unknown payment term is never treated as already-paid', () => {
    // Assuming prepaid on unknown input would tell a customer they owe nothing.
    const t = resolveInvoiceTerms('2026-08-24', 'something-else', 7);
    expect(t.basis).toBe('postpaid');
    expect(t.dueDate).toBe('2026-08-31');
  });

  it('a missing payment term still honours a recorded partner length', () => {
    // The length IS configured — just on the partner record. That is a real
    // agreement, not an invented default, so the due date computes.
    expect(resolveInvoiceTerms('2026-08-24', null, 7).basis).toBe('postpaid');
    expect(resolveInvoiceTerms('2026-08-24', '', 7).dueDate).toBe('2026-08-31');
  });

  it('the company profile term wins over a separately-recorded partner term', () => {
    // Commercial terms belong to the company profile; a stale partner record
    // must not override what the account actually agreed.
    const t = resolveInvoiceTerms('2026-08-24', 'net_15', 45);
    expect(t.termsDays).toBe(15);
    expect(t.dueDate).toBe('2026-09-08');
  });

  it('reads the term length in any of the shapes the profile stores', () => {
    expect(daysFromPaymentTerm('net_30')).toBe(30);
    expect(daysFromPaymentTerm('Net 45')).toBe(45);
    expect(daysFromPaymentTerm('net7')).toBe(7);
    expect(daysFromPaymentTerm('postpaid')).toBeNull();
    expect(daysFromPaymentTerm('credit')).toBeNull();
    expect(daysFromPaymentTerm(null)).toBeNull();
  });

  it('a termless postpaid term still falls back to the partner record', () => {
    expect(resolveInvoiceTerms('2026-08-24', 'postpaid', 7).termsDays).toBe(7);
    expect(resolveInvoiceTerms('2026-08-24', 'credit', 45).termsDays).toBe(45);
  });

  it('labels terms the way a customer should read them', () => {
    expect(paymentTermLabel('net_30')).toBe('Net 30');
    expect(paymentTermLabel('prepaid')).toBe('Prepaid');
    expect(paymentTermLabel('postpaid')).toBe('Postpaid');
    expect(paymentTermLabel(null)).toBe('Not configured');
  });

  it('an unparseable invoice date does not throw', () => {
    const t = resolveInvoiceTerms('not-a-date', 'postpaid', 30);
    expect(t.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  describe('issuer default (settings.billing_default_payment_term)', () => {
    it('applies fully when the company recorded nothing', () => {
      const t = resolveInvoiceTerms('2026-08-24', null, null, 'net_30');
      expect(t.basis).toBe('postpaid');
      expect(t.dueDate).toBe('2026-09-23');
      expect(t.termLabel).toBe('Net 30');
      // A prepaid issuer default makes an unrecorded company prepaid too.
      expect(resolveInvoiceTerms('2026-08-24', null, null, 'prepaid').basis).toBe('prepaid');
    });

    it('never overrides what the company or partner recorded', () => {
      // Company term wins outright.
      expect(resolveInvoiceTerms('2026-08-24', 'net_15', null, 'net_60').termsDays).toBe(15);
      // A company that chose postpaid is never flipped prepaid by a default…
      expect(resolveInvoiceTerms('2026-08-24', 'postpaid', null, 'prepaid').basis).toBe('unconfigured');
      // …but a termless postpaid does take the issuer's standard LENGTH.
      expect(resolveInvoiceTerms('2026-08-24', 'postpaid', null, 'net_45').termsDays).toBe(45);
      // Partner length beats the issuer default, and the label follows the
      // source that decided — not the configured value that lost.
      const t = resolveInvoiceTerms('2026-08-24', null, 45, 'net_30');
      expect(t.termsDays).toBe(45);
      expect(t.termLabel).toBe('Net 45');
    });

    it('nothing anywhere is still Not configured — the default tier is configured, not invented', () => {
      expect(resolveInvoiceTerms('2026-08-24', null, null, null).basis).toBe('unconfigured');
      expect(resolveInvoiceTerms('2026-08-24', 'postpaid', null, 'postpaid').basis).toBe('unconfigured');
    });
  });
});

describe('fmtInvoiceDate', () => {
  it('renders the configured preference from the ISO form', () => {
    expect(fmtInvoiceDate('2026-08-25', null)).toBe('2026-08-25');
    expect(fmtInvoiceDate('2026-08-25', 'DD MMM YYYY')).toBe('25 Aug 2026');
    expect(fmtInvoiceDate('2026-08-25', 'DD/MM/YYYY')).toBe('25/08/2026');
    expect(fmtInvoiceDate('2026-08-25', 'MM/DD/YYYY')).toBe('08/25/2026');
    expect(fmtInvoiceDate('2026-08-25T10:00:00Z', 'DD MMM YYYY')).toBe('25 Aug 2026');
  });

  it('passes through what it cannot parse rather than guessing', () => {
    expect(fmtInvoiceDate('soon', 'DD MMM YYYY')).toBe('soon');
    expect(fmtInvoiceDate(null, 'DD/MM/YYYY')).toBe('—');
  });
});
