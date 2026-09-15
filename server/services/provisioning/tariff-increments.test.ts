import { describe, it, expect } from 'vitest';
import { incrementsFromTariff, type TariffRateRow } from './tariff-increments';

const NOW = new Date('2026-09-15T12:00:00Z');
const row = (o: Partial<TariffRateRow> & { prefix: string }): TariffRateRow =>
  ({ interval1: 1, intervalN: 1, activationDate: '2026-09-15T09:50:29Z', expirationDate: null, forbidden: false, ...o });

describe('incrementsFromTariff', () => {
  it('prints what the switch holds: tariff 68 after run #32 bills every row 1/1, AWCC included', () => {
    const r = incrementsFromTariff(
      [row({ prefix: '19370' }), row({ prefix: '19371' }), row({ prefix: '19230' }), row({ prefix: '29230' })],
      '1', ['9370', '9371', '9230'], NOW,
    );
    expect(Object.fromEntries(r.increments)).toEqual({ '9370': '1/1', '9371': '1/1', '9230': '1/1' });
    expect(r.missing).toEqual([]);
  });

  it('follows the switch once a commercial increment has been applied there', () => {
    const r = incrementsFromTariff([row({ prefix: '19370', interval1: 60, intervalN: 1 })], '1', ['9370'], NOW);
    expect(r.increments.get('9370')).toBe('60/1');
  });

  it('reports a prefix the tariff does not hold, instead of inventing an increment', () => {
    const r = incrementsFromTariff([row({ prefix: '19230' })], '1', ['9230', '9370'], NOW);
    expect(r.increments.get('9370')).toBeUndefined();
    expect(r.missing).toEqual(['9370']);
  });

  it("only matches the product's own digit — Business Class rows never speak for First Class", () => {
    const r = incrementsFromTariff([row({ prefix: '29370', interval1: 60, intervalN: 1 })], '1', ['9370'], NOW);
    expect(r.missing).toEqual(['9370']);
  });

  it('ignores rows that are not yet active, expired, or forbidden; the latest active row governs', () => {
    const rows = [
      row({ prefix: '19370', interval1: 1, intervalN: 1, activationDate: '2026-09-01T00:00:00Z' }),
      row({ prefix: '19370', interval1: 60, intervalN: 1, activationDate: '2026-09-22T00:00:00Z' }),   // future
      row({ prefix: '19371', interval1: 60, intervalN: 60, activationDate: '2026-08-01T00:00:00Z', expirationDate: '2026-09-10T00:00:00Z' }),
      row({ prefix: '19371', interval1: 30, intervalN: 6, activationDate: '2026-09-10T00:00:00Z' }),
      row({ prefix: '19230', forbidden: true }),
    ];
    const r = incrementsFromTariff(rows, '1', ['9370', '9371', '9230'], NOW);
    expect(r.increments.get('9370')).toBe('1/1');
    expect(r.increments.get('9371')).toBe('30/6');
    expect(r.missing).toEqual(['9230']);
  });

  it('treats an unreadable interval as missing rather than printing 0/0', () => {
    const r = incrementsFromTariff([row({ prefix: '19370', interval1: 0, intervalN: null })], '1', ['9370'], NOW);
    expect(r.missing).toEqual(['9370']);
  });
});
