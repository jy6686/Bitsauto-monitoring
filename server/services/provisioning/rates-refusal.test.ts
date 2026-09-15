import { describe, it, expect } from 'vitest';
import { classifyMatrixRefusal } from './rates-refusal';

const summary = { destinationsProcessed: 9, destinationsApproved: 9, rowsGenerated: 9, rowsSkipped: 27, errorCount: 3, warningCount: 0 };

describe('classifyMatrixRefusal', () => {
  it('names a selected-but-unpriced product as the commercial mismatch it is (1global, 2026-09-15)', () => {
    const r = classifyMatrixRefusal({
      errors: [
        'Product BC (Business Class) produced no rows — a customer would carry it unpriced.',
        'Product SB (Special Bravo) produced no rows — a customer would carry it unpriced.',
        'Product SC (Special Charlie) produced no rows — a customer would carry it unpriced.',
      ],
      unpricedProducts: [{ code: 'BC', name: 'Business Class' }, { code: 'SB', name: 'Special Bravo' }, { code: 'SC', name: 'Special Charlie' }],
      summary,
    });
    expect(r.reasonCode).toBe('UNPRICED_SELECTED_PRODUCT');
    expect(r.error).toMatch(/^Business Class \(BC\) has been selected for this customer, but no effective rates exist for this product\./);
    expect(r.detail[0]).toBe('9 row(s) generated, 27 skipped');
    expect(r.detail).toContain("Remove the product from the customer's active product selection or add rates before provisioning.");
    expect(r.detail.join(' ')).toMatch(/Nothing was uploaded/);
    expect(r.cause).toBe('selected product has no priced rows');
  });

  it('keeps RATE_MATRIX_INVALID for a structural error, even alongside an unpriced product', () => {
    const dup = classifyMatrixRefusal({
      errors: ['Prefix 19233 is produced by both "A (FC)" and "B (XX)" — one would overwrite the other in the tariff.'],
      unpricedProducts: [],
      summary,
    });
    expect(dup.reasonCode).toBe('RATE_MATRIX_INVALID');
    expect(dup.error).toMatch(/Prefix 19233/);
    expect(dup.cause).toBe('rate matrix invalid');

    const both = classifyMatrixRefusal({
      errors: [
        'Prefix 19233 is produced by both "A (FC)" and "B (XX)" — one would overwrite the other in the tariff.',
        'Product SC (Special Charlie) produced no rows — a customer would carry it unpriced.',
      ],
      unpricedProducts: [{ code: 'SC', name: 'Special Charlie' }],
      summary,
    });
    expect(both.reasonCode).toBe('RATE_MATRIX_INVALID');
    expect(both.detail).toHaveLength(3);
  });

  it('never matches on message text: an unpriced list with no matching error is still commercial', () => {
    const r = classifyMatrixRefusal({ errors: ['anything at all'], unpricedProducts: [{ code: 'BC', name: 'Business Class' }], summary });
    expect(r.reasonCode).toBe('UNPRICED_SELECTED_PRODUCT');
  });
});
