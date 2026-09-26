/**
 * Characterisation tests for `calculatePeriod` — the billing window every invoice inherits.
 *
 * WHY THIS FUNCTION FIRST. `invoice-batch.service.ts` is 424 lines, live behind four routes, and
 * carries no test at all. `calculatePeriod` is the part that needs none of the database to prove:
 * it decides period_start / period_end, and an off-by-one there bills a real customer for a day
 * they did not have, or misses one they did.
 *
 * CHARACTERISATION, NOT SPECIFICATION. These record what the function DOES today so that a change
 * to it becomes visible. Where the current behaviour looks questionable it is pinned as-is and
 * raised separately — nothing here asserts that the behaviour is correct, and nothing here changes it.
 *
 * TIMEZONE. The function reads the clock through LOCAL getters (`getFullYear`, `getMonth`,
 * `getDate`, `getDay`, `setHours`), while the platform's business day is UTC. Assertions below are
 * written to hold in any runner timezone — spans, formats and boundaries — and the one assertion
 * that genuinely depends on the process being UTC guards itself, in the spirit of the existing note
 * that a timezone test here is environment-dependent rather than a regression.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { calculatePeriod } from './invoice-batch.service';

const at = (iso: string) => { vi.setSystemTime(new Date(iso)); };
const days = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1;
const PROCESS_IS_UTC = new Date().getTimezoneOffset() === 0;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('monthly', () => {
  it('starts on the first and ends on the last day of the same month', () => {
    at('2026-09-15T12:00:00Z');
    const p = calculatePeriod('monthly');
    expect(p.start).toMatch(/^\d{4}-\d{2}-01$/);
    expect(p.start.slice(0, 7)).toBe(p.end.slice(0, 7));
  });

  it('ends on the 30th for a 30-day month and the 31st for a 31-day month', () => {
    at('2026-09-15T12:00:00Z'); expect(calculatePeriod('monthly').end).toMatch(/-30$/);
    at('2026-10-15T12:00:00Z'); expect(calculatePeriod('monthly').end).toMatch(/-31$/);
  });

  it('handles February in a non-leap year', () => {
    at('2026-02-10T12:00:00Z');
    expect(calculatePeriod('monthly').end).toMatch(/-28$/);
  });

  it('handles February in a leap year', () => {
    at('2028-02-10T12:00:00Z');
    expect(calculatePeriod('monthly').end).toMatch(/-29$/);
  });

  it('labels the month in full', () => {
    at('2026-09-15T12:00:00Z');
    expect(calculatePeriod('monthly').label).toMatch(/^[A-Z][a-z]+ \d{4}$/);
  });

  it('is the month containing "now" when the process runs in UTC', () => {
    if (!PROCESS_IS_UTC) return;           // environment-dependent, not a regression
    at('2026-09-15T12:00:00Z');
    const p = calculatePeriod('monthly');
    expect(p.start).toBe('2026-09-01');
    expect(p.end).toBe('2026-09-30');
    expect(p.label).toBe('September 2026');
  });
});

describe('weekly', () => {
  it('spans exactly seven days', () => {
    for (const iso of ['2026-09-14T09:00:00Z', '2026-09-17T09:00:00Z', '2026-09-20T09:00:00Z']) {
      at(iso);
      const p = calculatePeriod('weekly');
      expect(days(p.start, p.end), iso).toBe(7);
    }
  });

  it('starts on a Monday and ends on a Sunday', () => {
    at('2026-09-17T09:00:00Z');
    const p = calculatePeriod('weekly');
    expect(new Date(`${p.start}T00:00:00Z`).getUTCDay()).toBe(1);
    expect(new Date(`${p.end}T00:00:00Z`).getUTCDay()).toBe(0);
  });

  it('treats Sunday as the END of the week it is in, not the start of the next', () => {
    if (!PROCESS_IS_UTC) return;
    at('2026-09-20T09:00:00Z');           // a Sunday
    const p = calculatePeriod('weekly');
    expect(p.end).toBe('2026-09-20');
    expect(p.start).toBe('2026-09-14');
  });

  it('crosses a month boundary without distorting the span', () => {
    at('2026-10-01T09:00:00Z');
    const p = calculatePeriod('weekly');
    expect(days(p.start, p.end)).toBe(7);
  });
});

describe('biweekly', () => {
  it('spans exactly fourteen days', () => {
    for (const iso of ['2026-09-14T09:00:00Z', '2026-09-17T09:00:00Z', '2026-09-20T09:00:00Z']) {
      at(iso);
      const p = calculatePeriod('biweekly');
      expect(days(p.start, p.end), iso).toBe(14);
    }
  });

  it('ends on the same Sunday the weekly cycle ends on, and starts a week earlier', () => {
    at('2026-09-17T09:00:00Z');
    const w = calculatePeriod('weekly');
    const b = calculatePeriod('biweekly');
    expect(b.end).toBe(w.end);
    expect(days(b.start, w.start)).toBe(8);   // inclusive count: exactly one week earlier
  });
});

describe('custom', () => {
  it('passes the supplied dates through verbatim', () => {
    const p = calculatePeriod('custom', '2026-08-17', '2026-08-31');
    expect(p.start).toBe('2026-08-17');
    expect(p.end).toBe('2026-08-31');
  });

  it('throws when either bound is missing', () => {
    expect(() => calculatePeriod('custom')).toThrow(/requires customStart and customEnd/);
    expect(() => calculatePeriod('custom', '2026-08-17')).toThrow(/requires customStart and customEnd/);
    expect(() => calculatePeriod('custom', undefined, '2026-08-31')).toThrow(/requires customStart and customEnd/);
  });

  /**
   * PINNED, NOT ENDORSED. The custom branch performs no ordering or validity check, so an end
   * before its start, or a bound that is not a date at all, is accepted and carried into the batch.
   * Raised separately; recorded here so a future fix shows up as a deliberate change.
   */
  it('accepts an end BEFORE its start (no ordering check today)', () => {
    const p = calculatePeriod('custom', '2026-08-31', '2026-08-01');
    expect(p.start).toBe('2026-08-31');
    expect(p.end).toBe('2026-08-01');
  });

  it('accepts a bound that is not a date, producing an Invalid Date label', () => {
    const p = calculatePeriod('custom', 'not-a-date', '2026-08-31');
    expect(p.start).toBe('not-a-date');
    expect(p.label).toContain('Invalid Date');
  });

  it('accepts a single-day period', () => {
    const p = calculatePeriod('custom', '2026-08-17', '2026-08-17');
    expect(days(p.start, p.end)).toBe(1);
  });
});

describe('shape, for every cycle', () => {
  it('always returns YYYY-MM-DD bounds and a non-empty label', () => {
    at('2026-09-17T09:00:00Z');
    for (const cycle of ['monthly', 'weekly', 'biweekly'] as const) {
      const p = calculatePeriod(cycle);
      expect(p.start, cycle).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(p.end, cycle).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(p.label.length, cycle).toBeGreaterThan(0);
    }
  });

  it('never returns an end before its start for a derived cycle', () => {
    for (const iso of ['2026-01-01T00:30:00Z', '2026-06-15T23:30:00Z', '2026-12-31T23:59:00Z']) {
      at(iso);
      for (const cycle of ['monthly', 'weekly', 'biweekly'] as const) {
        const p = calculatePeriod(cycle);
        expect(p.start <= p.end, `${cycle} @ ${iso}`).toBe(true);
      }
    }
  });
});
