/**
 * One submission becomes one job per account.
 *
 * The case this exists for is `job-1790249867200`: aura 6/6 verified, test-31 0/6 failed, both
 * collapsed into a single Push History row reading `aura, test-31 · 6 failed · Partial`. Execution
 * was already isolated; the record was not. These tests pin the record boundary.
 */
import { describe, it, expect } from 'vitest';
import { planAccountJobs, accountJobId } from './account-job-plan';

type Op = { accountName: string; operationKey: string; fullPrefix: string };
const op = (accountName: string, fullPrefix: string, i = 0): Op =>
  ({ accountName, fullPrefix, operationKey: `${i}:${accountName}:${fullPrefix}` });

const plan = (accountNames: string[], operations: Op[]) =>
  planAccountJobs({ accountNames, operations, requestId: 'req-1', idBase: 1790249867200 });

describe('accountJobId', () => {
  /** `job-<base>` was unique for one row per submission; N rows in one millisecond would not be. */
  it('gives siblings distinct ids from one base', () => {
    const ids = [0, 1, 2].map(i => accountJobId(1790249867200, i));
    expect(ids).toEqual(['job-1790249867200-0', 'job-1790249867200-1', 'job-1790249867200-2']);
    expect(new Set(ids).size).toBe(3);
  });
});

describe('planAccountJobs', () => {
  it('splits one submission into one job per account, each owning its own operations', () => {
    const p = plan(['aura', 'test-31'], [
      op('aura', '19230'), op('test-31', '19230'),
      op('aura', '19231'), op('test-31', '19231'),
    ]);

    expect(p.jobs.map(j => j.accountName)).toEqual(['aura', 'test-31']);
    expect(p.jobs[0].operations.map(o => o.fullPrefix)).toEqual(['19230', '19231']);
    expect(p.jobs[1].operations.map(o => o.fullPrefix)).toEqual(['19230', '19231']);
  });

  /** THE POINT. No operation may appear under an account that is not its own. */
  it('never puts one account\'s operation under another account\'s job', () => {
    const p = plan(['aura', 'test-31'], [op('aura', '19230'), op('test-31', '18801')]);
    for (const job of p.jobs) {
      for (const o of job.operations) expect(o.accountName).toBe(job.accountName);
    }
  });

  it('shares one request id across every sibling', () => {
    const p = plan(['aura', 'test-31'], [op('aura', '1'), op('test-31', '1')]);
    expect(p.requestId).toBe('req-1');
    expect(new Set(p.jobs.map(j => j.jobId)).size).toBe(2);
  });

  it('gives every sibling a distinct job id', () => {
    const names = ['a', 'b', 'c', 'd', 'e'];
    const p = plan(names, names.map(n => op(n, '1')));
    expect(new Set(p.jobs.map(j => j.jobId)).size).toBe(5);
  });

  describe('duplicate accounts', () => {
    /** Decision 2: one account, one job — a repeat is an operator slip, not intent to push twice. */
    it('collapses a repeated account to a single job', () => {
      const p = plan(['aura', 'test-31', 'aura'], [op('aura', '19230'), op('test-31', '19230')]);
      expect(p.jobs.map(j => j.accountName)).toEqual(['aura', 'test-31']);
      expect(p.jobs).toHaveLength(2);
    });

    /** Dropped, but not silently — the operator's list and the queue must be reconcilable. */
    it('names what it dropped', () => {
      const p = plan(['aura', 'aura', 'aura'], [op('aura', '1')]);
      expect(p.duplicatesDropped).toEqual(['aura', 'aura']);
    });

    /** Account names are Sippy identifiers; folding case would merge distinct accounts. */
    it('does NOT treat 1global and 1GLOBAL as the same account', () => {
      const p = plan(['1global', '1GLOBAL'], [op('1global', '1'), op('1GLOBAL', '1')]);
      expect(p.jobs).toHaveLength(2);
      expect(p.duplicatesDropped).toEqual([]);
    });
  });

  describe('accounts with nothing to do', () => {
    /**
     * A job with no operations would sit in the queue forever and report a status about work that
     * does not exist. Reported instead, so the omission is visible.
     */
    it('creates no job for an account that produced no operation', () => {
      const p = plan(['aura', 'ghost'], [op('aura', '19230')]);
      expect(p.jobs.map(j => j.accountName)).toEqual(['aura']);
      expect(p.accountsWithoutOperations).toEqual(['ghost']);
    });

    it('numbers the jobs it did create contiguously', () => {
      const p = plan(['ghost', 'aura'], [op('aura', '19230')]);
      expect(p.jobs).toHaveLength(1);
      expect(p.jobs[0].jobId).toBe('job-1790249867200-0');
    });
  });

  describe('ordering and edges', () => {
    it('follows the submitted order, not map order', () => {
      const p = plan(['zeta', 'alpha'], [op('alpha', '1'), op('zeta', '1')]);
      expect(p.jobs.map(j => j.accountName)).toEqual(['zeta', 'alpha']);
    });

    it('ignores blank account names on both sides', () => {
      const p = plan(['aura', '', '   '], [op('aura', '1'), op('', '1') as Op]);
      expect(p.jobs).toHaveLength(1);
      expect(p.jobs[0].operations).toHaveLength(1);
    });

    it('produces no jobs from an empty submission', () => {
      const p = plan([], []);
      expect(p.jobs).toEqual([]);
      expect(p.duplicatesDropped).toEqual([]);
      expect(p.accountsWithoutOperations).toEqual([]);
    });

    /** An operation for an account nobody submitted is not smuggled into the plan. */
    it('ignores operations for accounts outside the submission', () => {
      const p = plan(['aura'], [op('aura', '1'), op('stranger', '1')]);
      expect(p.jobs).toHaveLength(1);
      expect(p.jobs[0].operations.every(o => o.accountName === 'aura')).toBe(true);
    });

    /** Every submitted operation must land somewhere, or be explained. Nothing vanishes. */
    it('accounts for every operation of a submitted account', () => {
      const ops = [op('aura', '1'), op('aura', '2'), op('test-31', '3')];
      const p = plan(['aura', 'test-31'], ops);
      expect(p.jobs.flatMap(j => j.operations)).toHaveLength(ops.length);
    });
  });
});
