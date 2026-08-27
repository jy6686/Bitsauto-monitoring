import { describe, it, expect } from 'vitest';
import { computeSeedSlices, DEFAULT_SLICE_MINUTES } from './seed-slices';

describe('computeSeedSlices — a day in shallow windows', () => {
  it('cuts one day into 48 half-hour slices by default', () => {
    const s = computeSeedSlices('2026-08-18', '2026-08-18');
    expect(DEFAULT_SLICE_MINUTES).toBe(30);
    expect(s).toHaveLength(48);
    expect(s[0].startIso).toBe('2026-08-18T00:00:00Z');
    expect(s[0].endIso).toBe('2026-08-18T00:29:59Z');
    expect(s[47].startIso).toBe('2026-08-18T23:30:00Z');
    expect(s[47].endIso).toBe('2026-08-18T23:59:59Z');
  });

  it('covers the period with no gap: each slice starts where the last ended plus one second', () => {
    const s = computeSeedSlices('2026-08-18', '2026-08-18', 30);
    for (let i = 1; i < s.length; i++) {
      expect(Date.parse(s[i].startIso) - Date.parse(s[i - 1].endIso)).toBe(1000);
    }
  });

  it('spans multi-day periods continuously', () => {
    const s = computeSeedSlices('2026-08-16', '2026-08-22', 60);
    expect(s).toHaveLength(7 * 24);
    expect(s[0].startIso).toBe('2026-08-16T00:00:00Z');
    expect(s[s.length - 1].endIso).toBe('2026-08-22T23:59:59Z');
  });

  it('defaults periodEnd to periodStart, matching the seeder contract', () => {
    expect(computeSeedSlices('2026-08-18', null, 30)).toHaveLength(48);
    expect(computeSeedSlices('2026-08-18', undefined, 30)).toHaveLength(48);
  });

  it('clamps a final partial slice to the period boundary', () => {
    const s = computeSeedSlices('2026-08-18', '2026-08-18', 7 * 60); // 7h slices
    expect(s).toHaveLength(4); // 7+7+7+3
    expect(s[3].startIso).toBe('2026-08-18T21:00:00Z');
    expect(s[3].endIso).toBe('2026-08-18T23:59:59Z');
  });

  /** Every bound carries an explicit Z — new code does not inherit the
   *  offsetless-timestamp defect (BILLING-POLICY §1.1). */
  it('emits explicit-Z bounds only', () => {
    for (const sl of computeSeedSlices('2026-08-18', '2026-08-18', 120)) {
      expect(sl.startIso.endsWith('Z')).toBe(true);
      expect(sl.endIso.endsWith('Z')).toBe(true);
    }
  });

  it('indexes slices 1-based with readable labels', () => {
    const s = computeSeedSlices('2026-08-18', '2026-08-18', 360);
    expect(s.map(x => x.index)).toEqual([1, 2, 3, 4]);
    expect(s[1].label).toBe('2026-08-18 06:00–11:59Z');
  });

  it('rejects nonsense inputs with an empty result, never a throw', () => {
    expect(computeSeedSlices('not-a-date', 'either', 30)).toEqual([]);
    expect(computeSeedSlices('2026-08-19', '2026-08-18', 30)).toEqual([]); // end before start
  });

  it('treats a sub-minute or invalid slice size as the default', () => {
    expect(computeSeedSlices('2026-08-18', '2026-08-18', 0)).toHaveLength(48);
    expect(computeSeedSlices('2026-08-18', '2026-08-18', NaN as any)).toHaveLength(48);
  });
});
