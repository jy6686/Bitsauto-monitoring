import { describe, it, expect } from 'vitest';
import {
  STAGES, STAGE_CODES, stageFailure, stageOfCode, isExecutionFailure,
  countsAgainstRetryBudget, describeFailure, type StageCode, type Stage,
} from './stage-failure';

const codes = Object.keys(STAGE_CODES) as StageCode[];

describe('the registry is internally consistent', () => {
  it('every code carries its own stage as a prefix, so the two cannot drift', () => {
    for (const code of codes) {
      expect(stageOfCode(code), `${code} prefix must name its stage`).toBe(STAGE_CODES[code].stage);
    }
  });

  it('covers all six stages', () => {
    const covered = new Set<Stage>(codes.map(c => STAGE_CODES[c].stage));
    expect([...covered].sort()).toEqual([...STAGES].sort());
  });

  it('gives every stage a way to say "not attempted" or another control state', () => {
    for (const stage of STAGES) {
      const hasControl = codes.some(c => STAGE_CODES[c].stage === stage && STAGE_CODES[c].cls === 'control');
      expect(hasControl, `${stage} needs a control state`).toBe(true);
    }
  });

  it('gives every stage at least one data and one infrastructure code', () => {
    for (const stage of STAGES) {
      const forStage = codes.filter(c => STAGE_CODES[c].stage === stage).map(c => STAGE_CODES[c].cls);
      expect(forStage, `${stage} data`).toContain('data');
      expect(forStage, `${stage} infrastructure`).toContain('infrastructure');
    }
  });

  it('never marks a control state retryable — it was not attempted, not failed', () => {
    for (const code of codes) {
      if (STAGE_CODES[code].cls === 'control') expect(STAGE_CODES[code].retryable, code).toBe(false);
    }
  });

  it('never marks a data failure retryable — the same query returns the same answer', () => {
    for (const code of codes) {
      if (STAGE_CODES[code].cls === 'data') expect(STAGE_CODES[code].retryable, code).toBe(false);
    }
  });
});

describe('a control state must not masquerade as a failed execution', () => {
  it('a pair-blocked job is not an execution failure and does not burn a retry', () => {
    const f = stageFailure('RATING_PAIR_BLOCKED', { message: 'held behind j-mon', entity: { jobId: 'j-tue' } });
    expect(f.cls).toBe('control');
    expect(isExecutionFailure(f)).toBe(false);
    expect(countsAgainstRetryBudget(f)).toBe(false);
  });

  it('every control code in the registry behaves that way, not just the pair one', () => {
    for (const code of codes.filter(c => STAGE_CODES[c].cls === 'control')) {
      const f = stageFailure(code, { message: 'x' });
      expect(isExecutionFailure(f), code).toBe(false);
      expect(countsAgainstRetryBudget(f), code).toBe(false);
    }
  });

  it('a real failure does count, in both classes', () => {
    for (const code of codes.filter(c => STAGE_CODES[c].cls !== 'control')) {
      expect(countsAgainstRetryBudget(stageFailure(code, { message: 'x' })), code).toBe(true);
    }
  });
});

describe('the read-back distinction is preserved, not flattened', () => {
  it('ABSENT is a claim about the target; UNAVAILABLE is not', () => {
    expect(STAGE_CODES.VERIFICATION_ABSENT.cls).toBe('data');
    expect(STAGE_CODES.VERIFICATION_UNAVAILABLE.cls).toBe('infrastructure');
  });

  it('only the unreadable one is retryable', () => {
    expect(STAGE_CODES.VERIFICATION_ABSENT.retryable).toBe(false);
    expect(STAGE_CODES.VERIFICATION_UNAVAILABLE.retryable).toBe(true);
  });
});

describe('a failure identifies stage, reason, entity and cause', () => {
  it('carries all four when they are available', () => {
    const f = stageFailure('RATING_AMBIGUOUS_RATE', {
      message: 'two rates cover 2026-06-01 for product 1 / destination 900',
      entity: { requestId: 'req-1', jobId: 'job-9', accountId: 'aura', clientId: 'c1', productId: 'p1' },
      cause: 'product_rates ids 41, 87',
    });
    expect(f.stage).toBe('rating');
    expect(f.cls).toBe('data');
    expect(f.entity.accountId).toBe('aura');
    expect(f.cause).toContain('41, 87');
  });

  it('never withholds a failure for lack of ids', () => {
    expect(stageFailure('COLLECTION_TIMEOUT', { message: 'elapsed' }).entity).toEqual({});
  });

  it('refuses a code that is not registered', () => {
    expect(() => stageFailure('RATING_MADE_UP' as StageCode, { message: 'x' })).toThrow(/not a registered code/);
  });

  it('refuses to drop the human-readable message', () => {
    expect(() => stageFailure('RATING_NO_RATE', { message: '' })).toThrow(/human-readable/);
    expect(() => stageFailure('RATING_NO_RATE', { message: '   ' })).toThrow(/human-readable/);
  });

  it('omits cause entirely when there is none, rather than storing undefined', () => {
    expect('cause' in stageFailure('RATING_NO_RATE', { message: 'x' })).toBe(false);
  });
});

describe('describeFailure keeps both halves', () => {
  it('shows the code, the class, the ids and the message', () => {
    const line = describeFailure(stageFailure('INVOICE_DELIVERY_FAILED', {
      message: 'smtp rejected the recipient', entity: { invoiceId: 'C-3313-0024', period: '2026-08' },
    }));
    expect(line).toContain('INVOICE_DELIVERY_FAILED');
    expect(line).toContain('retryable');
    expect(line).toContain('invoiceId=C-3313-0024');
    expect(line).toContain('smtp rejected the recipient');
  });

  it('does not print empty ids', () => {
    expect(describeFailure(stageFailure('RATING_NO_RATE', { message: 'none', entity: { jobId: '' } })))
      .not.toContain('jobId=');
  });
});

describe('stageOfCode', () => {
  it('recovers the stage from a bare string with no registry lookup', () => {
    expect(stageOfCode('SNAPSHOT_HASH_MISMATCH')).toBe('snapshot');
    expect(stageOfCode('RECONCILIATION_DELTA_EXCEEDED')).toBe('reconciliation');
  });

  it('returns null for a string that names no stage', () => {
    expect(stageOfCode('WHATEVER_HAPPENED')).toBeNull();
  });
});
