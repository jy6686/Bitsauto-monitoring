/**
 * Payment terms → due date.
 *
 * The rule an owner set after two fields were found competing: prepaid pays on
 * the invoice date and says so; postpaid pays invoice date plus its terms. This
 * pins it, because the same answer has to appear on the PDF and in the email.
 */

import { describe, it, expect } from 'vitest';
import { resolveInvoiceTerms } from './invoice-terms';

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

  it('an unparseable invoice date does not throw', () => {
    const t = resolveInvoiceTerms('not-a-date', 'postpaid', 30);
    expect(t.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
