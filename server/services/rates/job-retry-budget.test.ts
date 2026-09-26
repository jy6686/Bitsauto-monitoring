import { describe, it, expect } from 'vitest';
import {
  decideJobDisposition, mayAutoRetry, isTerminalJobState, needsOperatorReview,
  JOB_RETRY_BUDGET, NON_TERMINAL_JOB_STATES, TERMINAL_JOB_STATES,
} from './job-retry-budget';
import { stageFailure, STAGE_CODES, type StageCode } from './stage-failure';

const fail = (code: StageCode, message = 'x') => {
  const f = stageFailure(code, { message });
  return { code: f.code, cls: f.cls, retryable: f.retryable, message: f.message };
};
const decide = (o: Partial<Parameters<typeof decideJobDisposition>[0]> & { failure: ReturnType<typeof fail> }) =>
  decideJobDisposition({ attempts: 0, unsettledOperations: false, ...o });

describe('the invariant: attempt < budget → retry, attempt >= budget → terminal', () => {
  it('retries while the budget holds, counting down', () => {
    const f = fail('COLLECTION_TIMEOUT');
    expect(decide({ attempts: 0, failure: f })).toEqual({ kind: 'RETRY', attemptsUsed: 1, remaining: 2 });
    expect(decide({ attempts: 1, failure: f })).toEqual({ kind: 'RETRY', attemptsUsed: 2, remaining: 1 });
  });

  it('goes terminal on the attempt that reaches the budget, not one after', () => {
    const d = decide({ attempts: JOB_RETRY_BUDGET - 1, failure: fail('COLLECTION_TIMEOUT') });
    expect(d.kind).toBe('TERMINAL');
    if (d.kind === 'TERMINAL') {
      expect(d.reasonCode).toBe('BUDGET_EXHAUSTED');
      expect(d.status).toBe('abandoned');
      expect(d.attemptsUsed).toBe(JOB_RETRY_BUDGET);
    }
  });

  it('never returns RETRY once the budget is spent, however many attempts have accrued', () => {
    for (const attempts of [3, 4, 10, 99]) {
      expect(decide({ attempts, failure: fail('COLLECTION_TIMEOUT') }).kind).toBe('TERMINAL');
    }
  });

  it('honours an explicit budget', () => {
    expect(decide({ attempts: 0, budget: 1, failure: fail('COLLECTION_TIMEOUT') }).kind).toBe('TERMINAL');
    expect(decide({ attempts: 3, budget: 9, failure: fail('COLLECTION_TIMEOUT') }).kind).toBe('RETRY');
  });

  it('refuses a nonsense budget or attempt count rather than guessing', () => {
    expect(() => decide({ budget: 0, failure: fail('COLLECTION_TIMEOUT') })).toThrow(/positive integer/);
    expect(() => decide({ attempts: -1, failure: fail('COLLECTION_TIMEOUT') })).toThrow(/non-negative/);
  });
});

describe('the three classes are dispositioned differently', () => {
  it('a data failure is terminal at once and does not spend the budget on a repeat', () => {
    const d = decide({ attempts: 0, failure: fail('RATING_AMBIGUOUS_RATE') });
    expect(d).toMatchObject({ kind: 'TERMINAL', status: 'failed', reasonCode: 'PERMANENT_FAILURE', attemptsUsed: 1 });
  });

  it('a control state is terminal, held, and spends NO attempt', () => {
    const d = decide({ attempts: 2, failure: fail('RATING_PAIR_BLOCKED') });
    expect(d).toMatchObject({ kind: 'TERMINAL', status: 'held', reasonCode: 'HELD_NOT_ATTEMPTED', attemptsUsed: 2 });
  });

  it('an unretryable infrastructure failure stops rather than burning three pickups', () => {
    const d = decide({ attempts: 0, failure: fail('COLLECTION_UNSUPPORTED') });
    expect(d).toMatchObject({ reasonCode: 'PERMANENT_FAILURE' });
  });

  it('every registered code reaches a disposition without throwing', () => {
    for (const code of Object.keys(STAGE_CODES) as StageCode[]) {
      expect(() => decide({ attempts: 0, failure: fail(code) }), code).not.toThrow();
    }
  });
});

describe('CONTROL is never a failed execution — consistent with stage-failure', () => {
  it('no control code ever produces a failed or abandoned job', () => {
    for (const code of (Object.keys(STAGE_CODES) as StageCode[]).filter(c => STAGE_CODES[c].cls === 'control')) {
      const d = decide({ attempts: 0, failure: fail(code) });
      expect(d.kind).toBe('TERMINAL');
      if (d.kind === 'TERMINAL') {
        expect(d.status, code).toBe('held');
        expect(d.attemptsUsed, code).toBe(0);
      }
    }
  });
});

describe('abandonment must not impersonate completion', () => {
  it('carries unsettledOperations into the terminal record', () => {
    const d = decide({ attempts: 2, unsettledOperations: true, failure: fail('COLLECTION_TIMEOUT') });
    expect(d).toMatchObject({ status: 'abandoned', unsettledOperations: true });
  });

  it('flags an abandoned job with unsettled operations for a human', () => {
    expect(needsOperatorReview(decide({ attempts: 2, unsettledOperations: true, failure: fail('COLLECTION_TIMEOUT') }))).toBe(true);
  });

  it('does not flag a terminal job whose operations all settled', () => {
    expect(needsOperatorReview(decide({ attempts: 2, unsettledOperations: false, failure: fail('COLLECTION_TIMEOUT') }))).toBe(false);
  });

  it('never flags a retry — nothing is terminal yet', () => {
    expect(needsOperatorReview(decide({ attempts: 0, unsettledOperations: true, failure: fail('COLLECTION_TIMEOUT') }))).toBe(false);
  });

  it('"completed" is never produced by a failure disposition', () => {
    for (const code of Object.keys(STAGE_CODES) as StageCode[]) {
      const d = decide({ attempts: 99, failure: fail(code) });
      if (d.kind === 'TERMINAL') expect(d.status, code).not.toBe('completed');
    }
  });
});

describe('the terminal record survives the job going inactive', () => {
  it('persists the stage code, a message and the attempt count', () => {
    const d = decide({ attempts: 2, failure: fail('SNAPSHOT_SOURCE_UNAVAILABLE', 'neon refused the connection') });
    expect(d.kind).toBe('TERMINAL');
    if (d.kind === 'TERMINAL') {
      expect(d.code).toBe('SNAPSHOT_SOURCE_UNAVAILABLE');
      expect(d.message).toContain('neon refused the connection');
      expect(d.message).toContain('3 attempts');
      expect(d.attemptsUsed).toBe(3);
    }
  });
});

describe('terminal structurally prevents further automatic retry', () => {
  it('a sweep may pick up exactly the non-terminal states', () => {
    for (const s of NON_TERMINAL_JOB_STATES) expect(mayAutoRetry(s), s).toBe(true);
    for (const s of TERMINAL_JOB_STATES) expect(mayAutoRetry(s), s).toBe(false);
  });

  it('the two state sets do not overlap', () => {
    const overlap = (NON_TERMINAL_JOB_STATES as readonly string[]).filter(s => (TERMINAL_JOB_STATES as readonly string[]).includes(s));
    expect(overlap).toEqual([]);
  });

  it('every status a disposition can produce is terminal', () => {
    for (const code of Object.keys(STAGE_CODES) as StageCode[]) {
      const d = decide({ attempts: 99, failure: fail(code) });
      if (d.kind === 'TERMINAL') {
        expect(isTerminalJobState(d.status), `${code}:${d.status}`).toBe(true);
        expect(mayAutoRetry(d.status), `${code}:${d.status}`).toBe(false);
      }
    }
  });

  it('an unknown status is not sweepable, so a typo cannot widen the sweep', () => {
    expect(mayAutoRetry('procesing')).toBe(false);
    expect(mayAutoRetry('')).toBe(false);
  });
});
