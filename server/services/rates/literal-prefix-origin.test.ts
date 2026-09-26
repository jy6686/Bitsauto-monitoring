import { describe, it, expect } from 'vitest';
import { buildLiteralPrefixOperations, literalOperationKey, type LiteralPrefixRequest, type LiteralPrefixContext } from './literal-prefix-origin';

const req = (o: Partial<LiteralPrefixRequest> = {}): LiteralPrefixRequest => ({
  accountName: 'aura', claimedITariff: 66, prefixes: ['9370'], rate: 0.025, ...o,
});
const ctx = (o: Partial<LiteralPrefixContext> = {}): LiteralPrefixContext => ({
  storedITariff: 66, resolvedITariff: 66, eligiblePrefixes: null, ...o,
});

describe('a caller-supplied tariff is a claim, not a resolution', () => {
  it('uses the SERVER-resolved tariff, never the claim', () => {
    const out = buildLiteralPrefixOperations(req({ claimedITariff: 66 }), ctx({ resolvedITariff: 66 }));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.operations[0].resolvedITariff).toBe(66);
  });

  it('REFUSES when the claim disagrees with what the server resolved', () => {
    const out = buildLiteralPrefixOperations(req({ claimedITariff: 64 }), ctx({ resolvedITariff: 66 }));
    expect(out).toMatchObject({ ok: false, refusal: { reason: 'TARIFF_CLAIM_MISMATCH', claimed: '64', resolved: '66' } });
  });

  it('REFUSES when the server resolved nothing — a claim cannot stand in for it', () => {
    for (const v of [null, undefined, '']) {
      expect(buildLiteralPrefixOperations(req(), ctx({ resolvedITariff: v as any })))
        .toMatchObject({ ok: false, refusal: { reason: 'NO_RESOLVED_TARIFF' } });
    }
  });

  it('accepts a request that makes no claim, since the server resolved one', () => {
    expect(buildLiteralPrefixOperations(req({ claimedITariff: null }), ctx()).ok).toBe(true);
  });

  it('compares numerically, so "66" and 66 are the same tariff', () => {
    expect(buildLiteralPrefixOperations(req({ claimedITariff: '66' }), ctx({ resolvedITariff: 66 })).ok).toBe(true);
  });

  it('keeps storedITariff distinct from the resolved value', () => {
    const out = buildLiteralPrefixOperations(req({ claimedITariff: null }), ctx({ storedITariff: null, resolvedITariff: 66 }));
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.operations[0].storedITariff).toBeNull();
      expect(out.operations[0].resolvedITariff).toBe(66);
    }
  });
});

describe('the operations it produces are canonical', () => {
  it('one operation per prefix, keyed stably', () => {
    const out = buildLiteralPrefixOperations(req({ prefixes: ['9370', '9371', '9372'] }), ctx());
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.operations.map(o => o.fullPrefix)).toEqual(['9370', '9371', '9372']);
      expect(out.operations.map(o => o.operationKey)).toEqual([
        literalOperationKey(0, '9370'), literalOperationKey(1, '9371'), literalOperationKey(2, '9372'),
      ]);
    }
  });

  it('carries the account, rate and effective window through', () => {
    const out = buildLiteralPrefixOperations(
      req({ effectiveFrom: '2026-10-01', effectiveTill: '2026-12-31' }), ctx());
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.operations[0]).toMatchObject({
      accountName: 'aura', rate: 0.025, effectiveFrom: '2026-10-01', effectiveTill: '2026-12-31',
    });
  });

  it('omits the effective window entirely when none was given', () => {
    const out = buildLiteralPrefixOperations(req(), ctx());
    if (out.ok) {
      expect('effectiveFrom' in out.operations[0]).toBe(false);
      expect('effectiveTill' in out.operations[0]).toBe(false);
    }
  });

  it('trims and drops blank prefixes', () => {
    const out = buildLiteralPrefixOperations(req({ prefixes: [' 9370 ', '', '  '] }), ctx());
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.operations.map(o => o.fullPrefix)).toEqual(['9370']);
  });
});

describe('eligibility: absence is not permission, and not a refusal either', () => {
  it('leaves eligible UNDEFINED when the lookup did not answer', () => {
    const out = buildLiteralPrefixOperations(req(), ctx({ eligiblePrefixes: null }));
    if (out.ok) expect('eligible' in out.operations[0]).toBe(false);
  });

  it('marks eligible true/false when the lookup did answer', () => {
    const out = buildLiteralPrefixOperations(
      req({ prefixes: ['9370', '8801'] }), ctx({ eligiblePrefixes: new Set(['9370']) }));
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.operations[0].eligible).toBe(true);
      expect(out.operations[1].eligible).toBe(false);
    }
  });

  it('does not itself refuse an ineligible prefix — preflight decides', () => {
    const out = buildLiteralPrefixOperations(req({ prefixes: ['8801'] }), ctx({ eligiblePrefixes: new Set() }));
    expect(out.ok).toBe(true);
  });
});

describe('what it refuses outright', () => {
  it('no prefixes', () => {
    expect(buildLiteralPrefixOperations(req({ prefixes: [] }), ctx())).toMatchObject({ refusal: { reason: 'NO_PREFIXES' } });
  });

  it('a duplicate prefix, naming it rather than leaving batch-plan to refuse opaquely', () => {
    expect(buildLiteralPrefixOperations(req({ prefixes: ['9370', '9370'] }), ctx()))
      .toMatchObject({ refusal: { reason: 'DUPLICATE_PREFIX', prefix: '9370' } });
  });

  it('a rate that is not a finite non-negative number', () => {
    for (const rate of [NaN, Infinity, -1]) {
      expect(buildLiteralPrefixOperations(req({ rate }), ctx()), String(rate)).toMatchObject({ refusal: { reason: 'INVALID_RATE' } });
    }
  });

  it('accepts a zero rate, which is a real commercial value', () => {
    expect(buildLiteralPrefixOperations(req({ rate: 0 }), ctx()).ok).toBe(true);
  });
});

describe('increment passthrough', () => {
  it('takes the raw catalogue increment per prefix when present', () => {
    const out = buildLiteralPrefixOperations(req({ prefixes: ['9370'] }),
      ctx({ rawIncrementByPrefix: new Map([['9370', '60/1']]) }));
    if (out.ok) expect(out.operations[0].rawIncrement).toBe('60/1');
  });

  it('is null when the catalogue has no increment — not a refusal', () => {
    const out = buildLiteralPrefixOperations(req(), ctx());
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.operations[0].rawIncrement).toBeNull();
  });
});
