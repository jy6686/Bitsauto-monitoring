import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  assessStage, assessPipeline, alarms, describeLiveness, STAGE_ORDER,
  type StageObservation, type Stage,
} from './stage-liveness';
import { STAGES, STAGE_CODES, type StageCode } from './stage-failure';

const NOW = 1_800_000_000_000;
const MIN = 60_000;

const obs = (o: Partial<StageObservation> = {}): StageObservation => ({
  stage: 'rating', owner: 'rating-worker', expected: true, inputPresent: true,
  lastRunAt: NOW - MIN, outputCount: 10, stalenessMs: 30 * MIN, ...o,
});

describe('1. a healthy stage is not reported stalled', () => {
  it('ran inside its threshold with output', () => {
    const r = assessStage(obs(), NOW);
    expect(r.state).toBe('healthy');
    expect(r.alarm).toBe(false);
  });

  it('stays healthy when output is simply not reported — null is unknown, not zero', () => {
    const r = assessStage(obs({ outputCount: null }), NOW);
    expect(r.state).toBe('healthy');
    expect(r.detail).toMatch(/output not reported/);
  });

  it('is healthy right up to the threshold, and stalled only past it', () => {
    expect(assessStage(obs({ lastRunAt: NOW - 30 * MIN }), NOW).state).toBe('healthy');
    expect(assessStage(obs({ lastRunAt: NOW - 30 * MIN - 1 }), NOW).state).toBe('stalled');
  });
});

describe('2. a stage not expected to run is not falsely alarmed', () => {
  it('reports not_expected, silently', () => {
    const r = assessStage(obs({ expected: false, lastRunAt: null, outputCount: null }), NOW);
    expect(r.state).toBe('not_expected');
    expect(r.alarm).toBe(false);
  });

  it('not_expected wins even when it looks long dead', () => {
    expect(assessStage(obs({ expected: false, lastRunAt: NOW - 500 * MIN }), NOW).alarm).toBe(false);
  });
});

describe('3. missing upstream input does not become a stage failure', () => {
  it('reports awaiting_input, not no_evidence or failed', () => {
    const r = assessStage(obs({ inputPresent: false, lastRunAt: null }), NOW);
    expect(r.state).toBe('awaiting_input');
    expect(r.alarm).toBe(false);
    expect(r.code).toBeUndefined();
  });

  it('this is THE Gate 0 distinction: no traffic yet reads differently from a stalled stage', () => {
    const noTraffic = assessStage(obs({ inputPresent: false, lastRunAt: null }), NOW);
    const stalled   = assessStage(obs({ inputPresent: true,  lastRunAt: NOW - 500 * MIN }), NOW);
    expect(noTraffic.state).not.toBe(stalled.state);
    expect(noTraffic.alarm).toBe(false);
    expect(stalled.alarm).toBe(true);
  });
});

describe('4. execution evidence with no output is its own state', () => {
  it('ran_without_output is distinguishable from healthy and from no_evidence', () => {
    const r = assessStage(obs({ outputCount: 0 }), NOW);
    expect(r.state).toBe('ran_without_output');
    expect(r.alarm).toBe(true);
    expect(r.detail).toMatch(/produced no output while input was present/);
  });

  it('the legacy failure — input present, no evidence it ran — is separate again', () => {
    const r = assessStage(obs({ lastRunAt: null }), NOW);
    expect(r.state).toBe('no_evidence');
    expect(r.alarm).toBe(true);
  });

  it('all five distinctions produce five different states', () => {
    const states = new Set([
      assessStage(obs({ inputPresent: false, lastRunAt: null }), NOW).state,
      assessStage(obs({ lastRunAt: null }), NOW).state,
      assessStage(obs({ outputCount: 0 }), NOW).state,
      assessStage(obs({ failure: { code: 'RATING_NO_RATE', cls: 'data' } }), NOW).state,
      assessStage(obs(), NOW, false).state,
    ]);
    expect(states.size).toBe(5);
  });
});

describe('5. a genuinely stalled stage is detected', () => {
  it('past its own threshold, with the age reported', () => {
    const r = assessStage(obs({ lastRunAt: NOW - 90 * MIN }), NOW);
    expect(r.state).toBe('stalled');
    expect(r.alarm).toBe(true);
    expect(r.detail).toMatch(/5400s ago, threshold 1800s/);
  });

  it('thresholds are per stage — the same age is fine for one and stale for another', () => {
    const age = NOW - 45 * MIN;
    expect(assessStage(obs({ stage: 'collection', lastRunAt: age, stalenessMs: 30 * MIN }), NOW).state).toBe('stalled');
    expect(assessStage(obs({ stage: 'invoice',    lastRunAt: age, stalenessMs: 24 * 60 * MIN }), NOW).state).toBe('healthy');
  });

  it('refuses a missing or nonsense threshold rather than inventing one', () => {
    for (const ms of [0, -1, NaN]) {
      expect(() => assessStage(obs({ stalenessMs: ms }), NOW)).toThrow(/positive stalenessMs/);
    }
  });
});

describe('6. control / held states do not consume retry budget', () => {
  it('a control failure is held, unalarmed, and spends nothing', () => {
    const r = assessStage(obs({ failure: { code: 'RATING_PAIR_BLOCKED', cls: 'control' } }), NOW);
    expect(r.state).toBe('held');
    expect(r.alarm).toBe(false);
    expect(r.countsAgainstRetryBudget).toBe(false);
  });

  it('holds for every control code in the shared registry, not just the pair one', () => {
    for (const code of (Object.keys(STAGE_CODES) as StageCode[]).filter(c => STAGE_CODES[c].cls === 'control')) {
      const r = assessStage(obs({ stage: STAGE_CODES[code].stage, failure: { code, cls: 'control' } }), NOW);
      expect(r.state, code).toBe('held');
      expect(r.countsAgainstRetryBudget, code).toBe(false);
    }
  });

  it('only a real failure counts against the budget', () => {
    expect(assessStage(obs({ failure: { code: 'RATING_NO_RATE', cls: 'data' } }), NOW).countsAgainstRetryBudget).toBe(true);
    expect(assessStage(obs({ failure: { code: 'RATING_SOURCE_UNAVAILABLE', cls: 'infrastructure' } }), NOW).countsAgainstRetryBudget).toBe(true);
    expect(assessStage(obs(), NOW).countsAgainstRetryBudget).toBe(false);
  });
});

describe('7. stages map exactly to the existing six-stage vocabulary', () => {
  it('STAGE_ORDER is the six registered stages, in pipeline order', () => {
    expect([...STAGE_ORDER]).toEqual(['collection', 'verification', 'rating', 'snapshot', 'reconciliation', 'invoice']);
    expect([...STAGE_ORDER].sort()).toEqual([...STAGES].sort());
  });

  it('defines no taxonomy of its own — the codes come from stage-failure', () => {
    const SRC = readFileSync('server/services/rates/stage-liveness.ts', 'utf8');
    expect(SRC).toContain("from './stage-failure'");
    expect(SRC).not.toMatch(/const\s+STAGES\s*=/);
  });
});

describe('8. unknown stages are rejected, not silently accepted', () => {
  it('assessStage throws', () => {
    expect(() => assessStage(obs({ stage: 'billing' as Stage }), NOW)).toThrow(/not a registered stage/);
  });

  it('assessPipeline throws', () => {
    expect(() => assessPipeline([obs({ stage: 'delivery' as Stage })], NOW)).toThrow(/not a registered stage/);
  });
});

describe('9. the detector takes no financial action', () => {
  const SRC = readFileSync('server/services/rates/stage-liveness.ts', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  /**
   * Persistence patterns only. A bare `.set(` also matches `Map.prototype.set`, which this module
   * uses legitimately to index observations by stage — a check that flags an in-memory Map as a
   * database write is a check nobody will keep.
   */
  it('performs no write, insert, update or delete', () => {
    for (const w of ['.insert(', '.update(', '.delete(', '.execute(', '.values(', '.returning(', 'db.']) {
      expect(SRC, w).not.toContain(w);
    }
  });

  it('and the Map it does use is in-memory, not a query builder', () => {
    expect(SRC).toContain('new Map<Stage, StageObservation>()');
  });

  it('imports no database, no sippy client and no scheduler', () => {
    expect(SRC).not.toMatch(/from ['"][^'"]*\/(db|storage|sippy)['"]/);
    expect(SRC).not.toMatch(/setTimeout|setInterval|cron/);
  });

  it('is a pure function of its observations — no clock of its own', () => {
    expect(SRC).not.toContain('Date.now()');
    expect(assessStage(obs(), NOW)).toEqual(assessStage(obs(), NOW));
  });
});

describe('one fault is reported once, and everything behind it is blocked, not broken', () => {
  it('a rating stall leaves snapshot and invoice blocked_upstream, unalarmed', () => {
    const r = assessPipeline([
      obs({ stage: 'collection', owner: 'collector' }),
      obs({ stage: 'rating', owner: 'rating-worker', lastRunAt: NOW - 500 * MIN }),
      obs({ stage: 'snapshot', owner: 'snapshot-svc', inputPresent: false, lastRunAt: null }),
      obs({ stage: 'invoice', owner: 'invoice-svc', inputPresent: false, lastRunAt: null }),
    ], NOW);
    expect(r.map(x => x.state)).toEqual(['healthy', 'stalled', 'blocked_upstream', 'blocked_upstream']);
    expect(alarms(r).map(a => a.stage)).toEqual(['rating']);
  });

  it('assesses in pipeline order regardless of the order observed', () => {
    const r = assessPipeline([obs({ stage: 'invoice' }), obs({ stage: 'collection' })], NOW);
    expect(r.map(x => x.stage)).toEqual(['collection', 'invoice']);
  });

  it('an unobserved stage does not block what follows — absence is not evidence', () => {
    const r = assessPipeline([obs({ stage: 'collection' }), obs({ stage: 'invoice' })], NOW);
    expect(r.map(x => x.state)).toEqual(['healthy', 'healthy']);
  });

  it('a held stage does not block downstream either', () => {
    const r = assessPipeline([
      obs({ stage: 'rating', failure: { code: 'RATING_PAIR_BLOCKED', cls: 'control' } }),
      obs({ stage: 'snapshot' }),
    ], NOW);
    expect(r.map(x => x.state)).toEqual(['held', 'healthy']);
  });
});

describe('reporting', () => {
  it('names the stage, state, owner, context and reason', () => {
    const line = describeLiveness(assessStage(
      obs({ stage: 'invoice', owner: 'invoice-svc', outputCount: 0, period: '2026-09', runId: 'run-7' }), NOW));
    expect(line).toContain('invoice');
    expect(line).toContain('ALARM');
    expect(line).toContain('owner=invoice-svc');
    expect(line).toContain('period=2026-09');
    expect(line).toContain('runId=run-7');
  });

  it('alarms() returns nothing for a healthy chain', () => {
    expect(alarms(assessPipeline(STAGE_ORDER.map(s => obs({ stage: s })), NOW))).toEqual([]);
  });
});
