import { describe, it, expect } from 'vitest';
import { resolveRate, resolveAllRates, rateKey, coversAsOf, type RateCandidate } from './rate-resolution';

const row = (o: Partial<RateCandidate> & { id: number }): RateCandidate => ({
  productId: 1, destinationId: null, catalogueVersionId: null, prefix: null,
  rate: '0.010000', currency: 'USD', effectiveFrom: '2026-01-01', effectiveTo: null, ...o,
});

const dest = (id: number, destinationId: number, over: Partial<RateCandidate> = {}) =>
  row({ id, destinationId, catalogueVersionId: 515, ...over });

describe('the acceptance condition: 0 / 1 / >1', () => {
  it('1 matching rate proceeds', () => {
    const r = dest(1, 900, { rate: '0.025000' });
    const out = resolveRate([r], rateKey(r), '2026-06-01');
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.rate.rate).toBe('0.025000');
  });

  it('0 matching rates is an explicit error, never a default price', () => {
    const r = dest(1, 900);
    const out = resolveRate([], rateKey(r), '2026-06-01');
    expect(out).toMatchObject({ ok: false, reason: 'NO_RATE' });
  });

  it('>1 matching rates is an explicit ambiguity, never a first-row pick', () => {
    const a = dest(1, 900, { rate: '0.010000' });
    const b = dest(2, 900, { rate: '0.090000' });
    const out = resolveRate([a, b], rateKey(a), '2026-06-01');
    expect(out).toMatchObject({ ok: false, reason: 'AMBIGUOUS_RATE' });
    if (!out.ok && out.reason === 'AMBIGUOUS_RATE') {
      expect(out.candidates.map(c => c.id).sort()).toEqual([1, 2]);
    }
  });

  it('the ambiguity does not depend on row order — either order refuses', () => {
    const a = dest(1, 900, { rate: '0.010000' });
    const b = dest(2, 900, { rate: '0.090000' });
    expect(resolveRate([a, b], rateKey(a), '2026-06-01').ok).toBe(false);
    expect(resolveRate([b, a], rateKey(a), '2026-06-01').ok).toBe(false);
  });
});

describe('overlapping effective windows are the real-world source of ambiguity', () => {
  it('two windows that both cover asOf refuse', () => {
    const a = dest(1, 900, { effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31' });
    const b = dest(2, 900, { effectiveFrom: '2026-06-01', effectiveTo: null });
    expect(resolveRate([a, b], rateKey(a), '2026-07-01')).toMatchObject({ reason: 'AMBIGUOUS_RATE' });
  });

  it('two windows that do NOT overlap at asOf resolve to the one that covers it', () => {
    const old = dest(1, 900, { rate: '0.010000', effectiveFrom: '2026-01-01', effectiveTo: '2026-05-31' });
    const cur = dest(2, 900, { rate: '0.020000', effectiveFrom: '2026-06-01', effectiveTo: null });
    const out = resolveRate([old, cur], rateKey(cur), '2026-07-01');
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.rate.id).toBe(2);
  });

  it('a date before any window is NO_RATE, not the earliest rate', () => {
    const cur = dest(1, 900, { effectiveFrom: '2026-06-01' });
    expect(resolveRate([cur], rateKey(cur), '2026-01-01')).toMatchObject({ reason: 'NO_RATE' });
  });

  it('windows are inclusive at both ends', () => {
    const r = dest(1, 900, { effectiveFrom: '2026-06-01', effectiveTo: '2026-06-30' });
    expect(coversAsOf(r, '2026-06-01')).toBe(true);
    expect(coversAsOf(r, '2026-06-30')).toBe(true);
    expect(coversAsOf(r, '2026-05-31')).toBe(false);
    expect(coversAsOf(r, '2026-07-01')).toBe(false);
  });
});

describe('the grouping key keeps the two id spaces apart', () => {
  it('the same destination_id in different catalogue versions is NOT one ambiguity', () => {
    const v1 = row({ id: 1, destinationId: 900, catalogueVersionId: 514 });
    const v2 = row({ id: 2, destinationId: 900, catalogueVersionId: 515 });
    expect(rateKey(v1)).not.toBe(rateKey(v2));
    expect(resolveRate([v1, v2], rateKey(v2), '2026-06-01').ok).toBe(true);
  });

  it('an unversioned destination_id is priced by prefix, not by destination', () => {
    const r = row({ id: 1, destinationId: 900, catalogueVersionId: null, prefix: '92' });
    expect(rateKey(r)).toContain('prefix:92');
  });

  it('a row that identifies nothing never collides with another such row', () => {
    const a = row({ id: 1 });
    const b = row({ id: 2 });
    expect(rateKey(a)).not.toBe(rateKey(b));
  });

  it('different products are never ambiguous with each other', () => {
    const a = dest(1, 900, { productId: 1 });
    const b = dest(2, 900, { productId: 2 });
    expect(rateKey(a)).not.toBe(rateKey(b));
    expect(resolveRate([a, b], rateKey(a), '2026-06-01').ok).toBe(true);
  });
});

describe('resolveAllRates gives one verdict per key, with no partial success', () => {
  it('reports the good key as ok and the bad key as ambiguous, in one pass', () => {
    const good = dest(1, 900);
    const badA = dest(2, 901, { rate: '0.010000' });
    const badB = dest(3, 901, { rate: '0.090000' });
    const out = resolveAllRates([good, badA, badB], '2026-06-01');
    expect(out.size).toBe(2);
    expect(out.get(rateKey(good))!.ok).toBe(true);
    expect(out.get(rateKey(badA))).toMatchObject({ reason: 'AMBIGUOUS_RATE' });
  });

  it('a key whose every row is out of window resolves to NO_RATE', () => {
    const expired = dest(1, 900, { effectiveFrom: '2026-01-01', effectiveTo: '2026-02-01' });
    expect(resolveAllRates([expired], '2026-06-01').get(rateKey(expired))).toMatchObject({ reason: 'NO_RATE' });
  });

  it('is empty for no candidates', () => {
    expect(resolveAllRates([], '2026-06-01').size).toBe(0);
  });
});
