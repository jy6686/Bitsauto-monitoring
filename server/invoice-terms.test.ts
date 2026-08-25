/**
 * Payment terms → due date.
 *
 * The rule an owner set after two fields were found competing: prepaid pays on
 * the invoice date and says so; postpaid pays invoice date plus its terms. This
 * pins it, because the same answer has to appear on the PDF and in the email.
 */

import { describe, it, expect } from 'vitest';
import { resolveInvoiceTerms, daysFromPaymentTerm, paymentTermLabel } from './invoice-terms';

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

  it('an unrecorded term defaults to 30 — the same default the partner record carries', () => {
    expect(resolveInvoiceTerms('2026-08-24', 'postpaid', null).dueDate).toBe('2026-09-23');
    expect(resolveInvoiceTerms('2026-08-24', 'postpaid', undefined).termsDays).toBe(30);
  });

  it('an unknown payment term is treated as postpaid, never as already-paid', () => {
    // Assuming prepaid on unknown input would tell a customer they owe nothing.
    const t = resolveInvoiceTerms('2026-08-24', 'something-else', 7);
    expect(t.basis).toBe('postpaid');
    expect(t.dueDate).toBe('2026-08-31');
  });

  it('a missing payment term is postpaid too', () => {
    expect(resolveInvoiceTerms('2026-08-24', null, 7).basis).toBe('postpaid');
    expect(resolveInvoiceTerms('2026-08-24', '', 7).basis).toBe('postpaid');
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
    expect(paymentTermLabel(null)).toBe('Not set');
  });

  it('an unparseable invoice date does not throw', () => {
    const t = resolveInvoiceTerms('not-a-date', 'postpaid', 30);
    expect(t.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
