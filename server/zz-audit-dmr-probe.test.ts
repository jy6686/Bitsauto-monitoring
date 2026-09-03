import { describe, it, expect } from 'vitest';
import { assessBusinessDay } from './business-day-status';

const day = '2026-09-02';
const mk = (rowsForDay: number, opts: any = {}) => {
  const coveredDay = rowsForDay > 0 ? day : (opts.maxDate ?? null);
  return assessBusinessDay({
    nowMs: Date.parse('2026-09-03T09:00:00Z'),
    scheduledHourUtc: 2,
    targetDayOverride: day,
    evidence: {
      collect: opts.collect ?? { coveredDay: null },
      dmr: {
        coveredDay,
        running: opts.running ?? false,
        failed: opts.failed ?? false,
        ...(rowsForDay > 0
          ? { progress: { done: rowsForDay, total: rowsForDay, unit: 'reports' } }
          : {}),
      },
    } as any,
  });
};

describe('dmr progress reachability', () => {
  it('progress present => state complete, whatever else is true', () => {
    for (const opts of [
      {}, { running: true }, { failed: true },
      { collect: { coveredDay: null, failed: true } },
      { collect: { coveredDay: null } },
    ]) {
      const dmr = mk(3, opts).stages.find(x => x.key === 'dmr')!;
      expect(dmr.progress).toBeDefined();
      expect(dmr.state).toBe('complete');
      expect(dmr.tone).toBe('good');
    }
  });
  it('no rows for day => no progress element at all', () => {
    const dmr = mk(0).stages.find(x => x.key === 'dmr')!;
    expect(dmr.progress).toBeUndefined();
  });
  it('older max date => no progress, not complete', () => {
    const dmr = mk(0, { maxDate: '2026-09-01' }).stages.find(x => x.key === 'dmr')!;
    expect(dmr.progress).toBeUndefined();
    expect(dmr.state).not.toBe('complete');
  });
});
