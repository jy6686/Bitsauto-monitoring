import { describe, it, expect } from 'vitest';
import { assessBusinessDay, targetBusinessDay, type StageKey, type StageEvidence } from './business-day-status';
import { dailyFreshness } from './freshness';

const at = (iso: string) => Date.parse(iso);

describe('probe', () => {
  it('00:00-02:00 window', () => {
    for (const iso of ['2026-09-03T00:00:00Z', '2026-09-03T00:40:00Z', '2026-09-03T01:59:59Z', '2026-09-03T02:00:01Z', '2026-09-03T07:59:00Z']) {
      const now = at(iso);
      const target = targetBusinessDay(now, 2);
      // deadline for target day = target + 1d + 2h + 6h
      const deadline = Date.parse(`${target}T00:00:00Z`) + 86400000 + 8 * 3600000;
      const ev: Partial<Record<StageKey, StageEvidence>> = {
        collect: { coveredDay: '2026-08-31' },
        verify:  { coveredDay: '2026-08-31' },
        reconcile: { unavailable: true, reason: 'gate not reporting' },
      };
      const r = assessBusinessDay({ nowMs: now, scheduledHourUtc: 2, evidence: ev });
      console.log(iso, '| target', target, '| deadline', new Date(deadline).toISOString(),
        '| overdueH', ((now - deadline) / 3600000).toFixed(1),
        '| verdict', r.verdict, '| collectState', r.stages[0].state,
        '| tones', r.stages.map(s => s.tone).join(','),
        '| headline', r.headline,
        '| readiness', r.readiness.ready, r.readiness.reason);
      const fr = dailyFreshness({ latestDate: '2026-08-31', nowMs: now, scheduledHourUtc: 2 });
      console.log('   FRESH', fr.status, fr.coveredDay, '->', fr.expectedDay, 'behind', fr.daysBehind, '|', fr.detail);
    }
    expect(true).toBe(true);
  });

  it('day override', () => {
    for (const iso of ['2026-09-03T01:00:00Z', '2026-09-03T03:00:00Z']) {
      const now = at(iso);
      const r = assessBusinessDay({
        nowMs: now, scheduledHourUtc: 2, targetDayOverride: '2026-08-15',
        evidence: { collect: { coveredDay: null }, reconcile: { unavailable: true } },
      });
      console.log('OVERRIDE', iso, r.verdict, '|', r.headline, '|', r.readiness.ready, r.readiness.reason);
    }
    expect(true).toBe(true);
  });
});
