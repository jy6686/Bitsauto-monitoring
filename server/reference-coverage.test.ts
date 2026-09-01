import { describe, it, expect } from 'vitest';
import { assessReferenceCoverage } from './reference-coverage';

const week = { periodStart: '2026-08-24', periodEnd: '2026-08-31' }; // Mon–Sun, end EXCLUSIVE
const ALL_WEEK = ['2026-08-24','2026-08-25','2026-08-26','2026-08-27',
                  '2026-08-28','2026-08-29','2026-08-30'];

describe('the production case that forced this module', () => {
  /**
   * Measured 2026-09-01: reconciling 08-24→08-30 against the DMR, 2026-08-29
   * had no DMR row at all. The reference total therefore covered six days
   * while the platform total covered seven.
   */
  it('refuses a week whose reference is missing 2026-08-29', () => {
    const c = assessReferenceCoverage({
      ...week,
      referenceDays: ALL_WEEK.filter(d => d !== '2026-08-29'),
    });
    expect(c.complete).toBe(false);
    expect(c.missing).toEqual(['2026-08-29']);
    expect(c.present).toHaveLength(6);
    expect(c.explanation).toContain('2026-08-29');
    expect(c.explanation).toContain('Run DMR');
  });

  it('says WHY a partial reference is dangerous, not merely that it is partial', () => {
    // An operator who reads "incomplete" may reasonably think "close enough".
    // The explanation has to carry the direction of the error.
    const c = assessReferenceCoverage({ ...week, referenceDays: ['2026-08-24'] });
    expect(c.explanation).toContain('understates');
    expect(c.explanation).toContain('hidden');
    expect(c.explanation).toContain('not a pass');
  });
});

describe('complete coverage', () => {
  it('accepts a reference covering every day', () => {
    const c = assessReferenceCoverage({ ...week, referenceDays: ALL_WEEK });
    expect(c.complete).toBe(true);
    expect(c.missing).toEqual([]);
    expect(c.days).toHaveLength(7);
    expect(c.explanation).toContain('all 7 day(s)');
  });

  it('handles a single-day period, end EXCLUSIVE', () => {
    const c = assessReferenceCoverage({
      periodStart: '2026-08-28', periodEnd: '2026-08-29',
      referenceDays: ['2026-08-28'],
    });
    expect(c.days).toEqual(['2026-08-28']);
    expect(c.complete).toBe(true);
  });

  it('does not count the exclusive end day as required', () => {
    // (24, 31) is Mon–Sun = 7 days. 08-31 is NOT part of it, and a reference
    // that lacks 08-31 is still complete.
    const c = assessReferenceCoverage({ ...week, referenceDays: ALL_WEEK });
    expect(c.days).not.toContain('2026-08-31');
    expect(c.complete).toBe(true);
  });
});

describe('it does not accept credit for the wrong days', () => {
  it('ignores reference days outside the period', () => {
    // A DMR for 08-31 says nothing about whether 08-29 was collected.
    const c = assessReferenceCoverage({
      ...week,
      referenceDays: [...ALL_WEEK.filter(d => d !== '2026-08-29'), '2026-08-31', '2026-09-01'],
    });
    expect(c.complete).toBe(false);
    expect(c.missing).toEqual(['2026-08-29']);
    expect(c.present).not.toContain('2026-08-31');
  });

  it('is not fooled by duplicate reference rows for one day', () => {
    // The DMR keeps versions; the same day can appear many times. Seven rows
    // for one day is not seven days of coverage.
    const c = assessReferenceCoverage({
      ...week,
      referenceDays: Array(7).fill('2026-08-24'),
    });
    expect(c.complete).toBe(false);
    expect(c.present).toEqual(['2026-08-24']);
    expect(c.missing).toHaveLength(6);
  });

  it('accepts full ISO timestamps, taking the date part', () => {
    const c = assessReferenceCoverage({
      ...week,
      referenceDays: ALL_WEEK.map(d => `${d}T00:00:00.000Z`),
    });
    expect(c.complete).toBe(true);
  });
});

describe('an empty or malformed period is never "covered"', () => {
  /**
   * The dangerous default: with no days required, `missing` is empty and a
   * naive implementation reports complete:true — a fully-covered verdict from
   * a period that does not exist.
   */
  it('refuses an empty reference for a real period', () => {
    const c = assessReferenceCoverage({ ...week, referenceDays: [] });
    expect(c.complete).toBe(false);
    expect(c.missing).toHaveLength(7);
  });

  it('refuses a zero-length period rather than calling it covered', () => {
    const c = assessReferenceCoverage({
      periodStart: '2026-08-28', periodEnd: '2026-08-28', referenceDays: [],
    });
    expect(c.complete).toBe(false);
    expect(c.days).toEqual([]);
    expect(c.explanation).toContain('Not a valid period');
  });

  it('refuses an inverted period', () => {
    const c = assessReferenceCoverage({
      periodStart: '2026-08-30', periodEnd: '2026-08-24', referenceDays: ALL_WEEK,
    });
    expect(c.complete).toBe(false);
    expect(c.explanation).toContain('EXCLUSIVE');
  });

  it('refuses unparseable dates', () => {
    const c = assessReferenceCoverage({
      periodStart: 'not-a-date', periodEnd: '2026-08-31', referenceDays: ALL_WEEK,
    });
    expect(c.complete).toBe(false);
  });
});

describe('month boundaries', () => {
  it('spans a month end without losing or inventing a day', () => {
    const c = assessReferenceCoverage({
      periodStart: '2026-08-30', periodEnd: '2026-09-02',
      referenceDays: ['2026-08-30', '2026-08-31', '2026-09-01'],
    });
    expect(c.days).toEqual(['2026-08-30', '2026-08-31', '2026-09-01']);
    expect(c.complete).toBe(true);
  });
});
