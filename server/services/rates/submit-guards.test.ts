/**
 * Submit-time guards for push-batch — decided BEFORE the job row exists, so a refusal is provably
 * a non-event.
 *
 * Two questions, answered without Sippy:
 *   duplicate  this exact submit (same clientRequestId) already produced a job → return it, never
 *              start another. The 09-19 double-fire produced two batches 9 s apart; this is the
 *              rule that would have answered the second click with the first job.
 *   in flight  a job on one of the target tariffs is non-terminal and NOT yet stale by the SAME
 *              floor reconciliation uses. Younger than the floor = a live push, refuse; older =
 *              an orphan, which is reconciliation's to settle, not this guard's to wait on.
 *
 * The floor is shared with reconcile-core by import, never re-typed: two mechanisms that could
 * disagree about whether a job is live would let a push start on a tariff the sweep is about to
 * read back.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { submitGuards, isValidClientRequestId, SUBMIT_IN_FLIGHT_FLOOR_MS, type LiveJob } from './submit-guards';
import { RATE_JOB_STALE_MS, isOrphanEligible } from './reconcile-core';

const NOW = new Date('2026-09-19T14:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const live = (jobId: string, over: Partial<LiveJob> = {}): LiveJob =>
  ({ jobId, status: 'processing', iTariff: 64, lastStepAt: ago(60_000), createdAt: ago(90_000), ...over });

const base = { clientRequestId: 'req-0001-aaaa', existingByKey: null, liveJobs: [] as LiveJob[], targetTariffs: [64], now: NOW };

describe('the stale floor is ONE contract', () => {
  it('the guard floor IS reconcile-core\'s stale floor, by identity', () => {
    expect(SUBMIT_IN_FLIGHT_FLOOR_MS).toBe(RATE_JOB_STALE_MS);
    expect(RATE_JOB_STALE_MS).toBe(30 * 60_000);
  });

  it('reconcile-boot takes its floor from reconcile-core, not from a local literal', () => {
    const strip = (t: string) => t.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    const BOOT = strip(readFileSync(join(__dirname, 'reconcile-boot.ts'), 'utf8'));
    expect(BOOT).toContain('RATE_JOB_STALE_MS');
    expect(BOOT).not.toMatch(/STALE_MS\s*=\s*30\s*\*\s*60_000/);
  });

  it('a job the guard calls live is exactly a job the sweep would NOT touch, and vice versa', () => {
    for (const age of [0, 60_000, 29 * 60_000, 30 * 60_000, 31 * 60_000, 6 * 3600_000]) {
      const job = live('j', { lastStepAt: ago(age) });
      const guardSaysLive = submitGuards({ ...base, liveJobs: [job] }).kind === 'in_flight';
      const sweepWouldTake = isOrphanEligible({ status: job.status, lastStepAt: job.lastStepAt, createdAt: job.createdAt }, NOW, RATE_JOB_STALE_MS);
      expect(guardSaysLive).toBe(!sweepWouldTake);
    }
  });
});

describe('duplicate submit', () => {
  it('the same clientRequestId returns the existing job, whatever its status, and never proceeds', () => {
    for (const status of ['processing', 'completed', 'partial', 'failed', 'needs_review', 'pending']) {
      expect(submitGuards({ ...base, existingByKey: { jobId: 'job-1', status } }))
        .toEqual({ kind: 'duplicate', jobId: 'job-1', status });
    }
  });

  it('duplicate wins over in-flight: the answer is the SAME job, not a refusal about another', () => {
    const d = submitGuards({ ...base, existingByKey: { jobId: 'job-1', status: 'processing' }, liveJobs: [live('job-2')] });
    expect(d).toMatchObject({ kind: 'duplicate', jobId: 'job-1' });
  });

  it('no clientRequestId means no duplicate check — legacy callers keep working', () => {
    expect(submitGuards({ ...base, clientRequestId: null, existingByKey: null })).toEqual({ kind: 'proceed' });
  });
});

describe('in-flight guard', () => {
  it('a young non-terminal job on a target tariff refuses, naming the job, tariff and age', () => {
    const d = submitGuards({ ...base, liveJobs: [live('job-9', { lastStepAt: ago(45_000) })] });
    expect(d).toEqual({ kind: 'in_flight', jobId: 'job-9', iTariff: 64, ageMs: 45_000 });
  });

  it('a job on a DIFFERENT tariff does not refuse — different tariffs are different locks', () => {
    expect(submitGuards({ ...base, liveJobs: [live('job-9', { iTariff: 66 })] })).toEqual({ kind: 'proceed' });
    expect(submitGuards({ ...base, targetTariffs: [64, 66], liveJobs: [live('job-9', { iTariff: 66 })] })).toMatchObject({ kind: 'in_flight', iTariff: 66 });
  });

  it('a stale non-terminal job does NOT refuse — it is an orphan for reconciliation, not a live push', () => {
    expect(submitGuards({ ...base, liveJobs: [live('job-9', { lastStepAt: ago(31 * 60_000) })] })).toEqual({ kind: 'proceed' });
  });

  it('the effective clock falls back to createdAt for a row with no lastStepAt, exactly as the sweep does', () => {
    expect(submitGuards({ ...base, liveJobs: [live('j', { lastStepAt: null, createdAt: ago(60_000) })] })).toMatchObject({ kind: 'in_flight' });
    expect(submitGuards({ ...base, liveJobs: [live('j', { lastStepAt: null, createdAt: ago(31 * 60_000) })] })).toEqual({ kind: 'proceed' });
  });

  it('a terminal job never refuses, however young', () => {
    for (const status of ['completed', 'partial', 'failed', 'needs_review']) {
      expect(submitGuards({ ...base, liveJobs: [live('j', { status, lastStepAt: ago(1000) })] })).toEqual({ kind: 'proceed' });
    }
  });

  it('a job with no tariff cannot be on a target tariff', () => {
    expect(submitGuards({ ...base, liveJobs: [live('j', { iTariff: null })] })).toEqual({ kind: 'proceed' });
  });

  it('no target tariffs → proceed (preflight refuses unresolved targets itself)', () => {
    expect(submitGuards({ ...base, targetTariffs: [], liveJobs: [live('j')] })).toEqual({ kind: 'proceed' });
  });

  it('with several live jobs the youngest is named', () => {
    const d = submitGuards({ ...base, liveJobs: [live('old', { lastStepAt: ago(20 * 60_000) }), live('young', { lastStepAt: ago(5_000) })] });
    expect(d).toMatchObject({ kind: 'in_flight', jobId: 'young', ageMs: 5_000 });
  });
});

describe('isValidClientRequestId', () => {
  it('accepts a UUID and short opaque ids; rejects empty, long, and unsafe characters', () => {
    expect(isValidClientRequestId('4e4786ad-ad8a-4b17-9772-bf0b272ec88c')).toBe(true);
    expect(isValidClientRequestId('req_ABC-123')).toBe(true);
    expect(isValidClientRequestId('')).toBe(false);
    expect(isValidClientRequestId('short')).toBe(false);
    expect(isValidClientRequestId('x'.repeat(65))).toBe(false);
    expect(isValidClientRequestId('has space here')).toBe(false);
    expect(isValidClientRequestId("a'; DROP TABLE x--")).toBe(false);
    expect(isValidClientRequestId(123)).toBe(false);
    expect(isValidClientRequestId(null)).toBe(false);
  });
});
