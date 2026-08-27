import { describe, it, expect } from 'vitest';
import { seedRequestKey, sameSeedRequest, findRunningDuplicate, type RunningSeedJob } from './seed-single-flight';

const REQ = { iAccount: 315, iTariff: '32', periodStart: '2026-08-25', periodEnd: '2026-08-25' };

describe('seedRequestKey — the same work must look the same', () => {
  it('treats a numeric and string tariff as one request', () => {
    expect(sameSeedRequest(REQ, { ...REQ, iTariff: 32 })).toBe(true);
  });

  it('treats a numeric and string account as one request', () => {
    expect(sameSeedRequest(REQ, { ...REQ, iAccount: '315' })).toBe(true);
  });

  /** The seeder's own contract: an absent periodEnd means a single day. */
  it('treats an omitted periodEnd as the same single day', () => {
    expect(sameSeedRequest(REQ, { iAccount: 315, iTariff: '32', periodStart: '2026-08-25' })).toBe(true);
    expect(sameSeedRequest(REQ, { ...REQ, periodEnd: null })).toBe(true);
  });

  it('keeps genuinely different work distinct', () => {
    expect(sameSeedRequest(REQ, { ...REQ, periodStart: '2026-08-26', periodEnd: '2026-08-26' })).toBe(false);
    expect(sameSeedRequest(REQ, { ...REQ, iAccount: 316 })).toBe(false);
    expect(sameSeedRequest(REQ, { ...REQ, iTariff: '33' })).toBe(false);
    expect(sameSeedRequest(REQ, { ...REQ, periodEnd: '2026-08-26' })).toBe(false);
  });
});

describe('findRunningDuplicate — the production case', () => {
  /**
   * 2026-08-27: two imports of account 315 / tariff 32 / 2026-08-25 ran
   * concurrently, walking the same 48 slices against one Sippy credential.
   */
  it('finds the in-flight job covering the same day', () => {
    const jobs: RunningSeedJob[] = [{ jobId: 'sj-3c7jnb', status: 'running', request: REQ }];
    expect(findRunningDuplicate(jobs, { ...REQ, iTariff: 32 })?.jobId).toBe('sj-3c7jnb');
  });

  it('does not block a different day', () => {
    const jobs: RunningSeedJob[] = [{ jobId: 'sj-3c7jnb', status: 'running', request: REQ }];
    expect(findRunningDuplicate(jobs, { ...REQ, periodStart: '2026-08-26', periodEnd: '2026-08-26' })).toBeNull();
  });

  /** Re-running a FAILED day is the documented recovery — never block it. */
  it('does not block a re-run of a failed day', () => {
    const jobs: RunningSeedJob[] = [{ jobId: 'sj-xlp0tj', status: 'error', request: REQ }];
    expect(findRunningDuplicate(jobs, REQ)).toBeNull();
  });

  it('does not block a re-run of a completed day', () => {
    const jobs: RunningSeedJob[] = [{ jobId: 'sj-old', status: 'done', request: REQ }];
    expect(findRunningDuplicate(jobs, REQ)).toBeNull();
  });

  /**
   * Refusing work to protect against a duplicate we cannot demonstrate would
   * be worse than the duplicate — older jobs predate the request being recorded.
   */
  it('does not block when the running job never recorded its request', () => {
    const jobs: RunningSeedJob[] = [{ jobId: 'sj-legacy', status: 'running' }];
    expect(findRunningDuplicate(jobs, REQ)).toBeNull();
  });

  it('returns null on an empty registry', () => {
    expect(findRunningDuplicate([], REQ)).toBeNull();
  });

  it('picks the matching job out of several running ones', () => {
    const jobs: RunningSeedJob[] = [
      { jobId: 'sj-a', status: 'running', request: { ...REQ, periodStart: '2026-08-24', periodEnd: '2026-08-24' } },
      { jobId: 'sj-b', status: 'running', request: REQ },
      { jobId: 'sj-c', status: 'running', request: { ...REQ, iAccount: 588 } },
    ];
    expect(findRunningDuplicate(jobs, REQ)?.jobId).toBe('sj-b');
  });
});

describe('key shape', () => {
  it('is stable and readable', () => {
    expect(seedRequestKey(REQ)).toBe('315|32|2026-08-25|2026-08-25');
  });
});
