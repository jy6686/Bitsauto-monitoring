import { describe, it, expect } from 'vitest';
import { preUploadGate } from './rates-upload-gate';

describe('preUploadGate', () => {
  it('proceeds with products and NO legacy destinations — the 1global case of 2026-09-14', () => {
    // 4 products, 7 catalogue-keyed prices effective today, legacy list empty.
    expect(preUploadGate({ productCount: 4, legacyDestinationCount: 0 })).toEqual({ proceed: true });
  });

  it('proceeds when both are present', () => {
    expect(preUploadGate({ productCount: 1, legacyDestinationCount: 120 })).toEqual({ proceed: true });
  });

  it('stops only when there is no product at all', () => {
    const g = preUploadGate({ productCount: 0, legacyDestinationCount: 120 });
    expect(g.proceed).toBe(false);
    if (!g.proceed) expect(g.reason).toMatch(/no products/i);
  });
});
