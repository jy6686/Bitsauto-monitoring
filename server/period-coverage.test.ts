import { describe, it, expect } from 'vitest';
import { assessPeriodCoverage } from './period-coverage';

const WEEK = { periodStart: '2026-08-24', periodEnd: '2026-08-30' };
const allDays = ['2026-08-24','2026-08-25','2026-08-26','2026-08-27','2026-08-28','2026-08-29','2026-08-30'];

describe('assessPeriodCoverage — the production case', () => {
  /**
   * Invoice C-2608-0009: generated for a 7-day week from 4 days of CDRs,
   * because forward capture was left disarmed. Every existing gate passed.
   */
  it('refuses the week that produced C-2608-0009 and names the missing days', () => {
    const r = assessPeriodCoverage({
      ...WEEK,
      daysWithRows: ['2026-08-24','2026-08-25','2026-08-26','2026-08-27'],
      collectedRanges: [
        { periodStart: '2026-08-24', periodEnd: '2026-08-24' },
        { periodStart: '2026-08-25', periodEnd: '2026-08-25' },
        { periodStart: '2026-08-26', periodEnd: '2026-08-26' },
        { periodStart: '2026-08-27', periodEnd: '2026-08-27' },
      ],
    });
    expect(r.covered).toBe(false);
    expect(r.uncovered).toEqual(['2026-08-28','2026-08-29','2026-08-30']);
    expect(r.reason).toContain('2026-08-28, 2026-08-29, 2026-08-30');
    expect(r.reason).toContain('3 of its 7');
  });

  it('passes a fully collected week', () => {
    const r = assessPeriodCoverage({
      ...WEEK, daysWithRows: allDays,
      collectedRanges: allDays.map(d => ({ periodStart: d, periodEnd: d })),
    });
    expect(r.covered).toBe(true);
    expect(r.uncovered).toEqual([]);
    expect(r.reason).toBe('');
  });
});

describe('an empty day is not an uncollected day', () => {
  /**
   * The distinction this module exists to preserve. A customer with no traffic
   * on a Sunday is a legitimate zero; refusing to invoice them would be its own
   * defect. Absence of DATA is not evidence — absence of COLLECTION is.
   */
  it('accepts a day that was collected and genuinely had no calls', () => {
    const r = assessPeriodCoverage({
      ...WEEK,
      daysWithRows: allDays.filter(d => d !== '2026-08-30'),   // quiet Sunday
      collectedRanges: allDays.map(d => ({ periodStart: d, periodEnd: d })),
    });
    expect(r.covered).toBe(true);
    expect(r.emptyButCollected).toEqual(['2026-08-30']);
  });

  it('reports the quiet day rather than hiding it', () => {
    const r = assessPeriodCoverage({
      ...WEEK,
      daysWithRows: allDays.filter(d => d !== '2026-08-30'),
      collectedRanges: allDays.map(d => ({ periodStart: d, periodEnd: d })),
    });
    // Covered, but the operator can still see which day carried nothing.
    expect(r.emptyButCollected).toHaveLength(1);
  });

  it('refuses the same day when nothing ever collected it', () => {
    const r = assessPeriodCoverage({
      ...WEEK,
      daysWithRows: allDays.filter(d => d !== '2026-08-30'),
      collectedRanges: allDays.filter(d => d !== '2026-08-30').map(d => ({ periodStart: d, periodEnd: d })),
    });
    expect(r.covered).toBe(false);
    expect(r.uncovered).toEqual(['2026-08-30']);
  });
});

describe('collection ranges cover the days inside them', () => {
  /** A chain seed records ONE row spanning the whole period, not seven. */
  it('accepts a single multi-day collection run', () => {
    const r = assessPeriodCoverage({
      ...WEEK, daysWithRows: allDays,
      collectedRanges: [{ periodStart: '2026-08-24', periodEnd: '2026-08-30' }],
    });
    expect(r.covered).toBe(true);
  });

  it('does not let a range cover days outside it', () => {
    const r = assessPeriodCoverage({
      ...WEEK, daysWithRows: [],
      collectedRanges: [{ periodStart: '2026-08-24', periodEnd: '2026-08-26' }],
    });
    expect(r.uncovered).toEqual(['2026-08-27','2026-08-28','2026-08-29','2026-08-30']);
  });

  /** seed_jobs stores periodEnd as a string that may be blank for a single day. */
  it('treats a range with a blank end as a single day', () => {
    const r = assessPeriodCoverage({
      periodStart: '2026-08-24', periodEnd: '2026-08-24',
      daysWithRows: [],
      collectedRanges: [{ periodStart: '2026-08-24', periodEnd: '' }],
    });
    expect(r.covered).toBe(true);
  });
});

describe('degenerate input', () => {
  it('refuses rather than guessing on an unusable period', () => {
    const r = assessPeriodCoverage({
      periodStart: 'nonsense', periodEnd: '2026-08-30',
      daysWithRows: [], collectedRanges: [],
    });
    expect(r.covered).toBe(false);
    expect(r.reason).toMatch(/Unusable/);
  });

  it('refuses when the period runs backwards', () => {
    const r = assessPeriodCoverage({
      periodStart: '2026-08-30', periodEnd: '2026-08-24',
      daysWithRows: [], collectedRanges: [],
    });
    expect(r.covered).toBe(false);
  });

  it('handles a single-day period', () => {
    const r = assessPeriodCoverage({
      periodStart: '2026-08-24', periodEnd: '2026-08-24',
      daysWithRows: ['2026-08-24'], collectedRanges: [],
    });
    expect(r.days).toEqual(['2026-08-24']);
    expect(r.covered).toBe(true);
  });
});
