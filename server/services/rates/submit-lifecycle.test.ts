/**
 * The Send Rate submit lifecycle — a pure state machine the UI drives.
 *
 * The rule it encodes: the HTTP response is a courtesy; the JOB ROW is the truth. `pushing` is
 * released only when the job the operator started is terminal — never because a response
 * arrived, and never because one failed to. On 2026-09-19 a 504 re-enabled Submit while the
 * server was still pushing, and the second click produced a second batch 9 s behind the first.
 * With this machine that click is impossible: after a lost response the UI is polling the job
 * it knows by request id, Submit stays disabled, and the queue is kept until the row settles.
 */
import { describe, it, expect } from 'vitest';
import {
  submitReducer, initialSubmitState, canSubmit, isPushing, shouldClearQueue, pollIntervalMs, statusMessage,
  TERMINAL_JOB_STATUSES, NOT_FOUND_LIMIT, type SubmitState, type SubmitEvent,
} from '@/lib/submit-lifecycle';

const run = (events: SubmitEvent[], from: SubmitState = initialSubmitState): SubmitState =>
  events.reduce((s, e) => submitReducer(s, e), from);

const KEY = '4e4786ad-ad8a-4b17-9772-bf0b272ec88c';

describe('idle → submitting', () => {
  it('starts idle: can submit, not pushing, no polling', () => {
    expect(canSubmit(initialSubmitState)).toBe(true);
    expect(isPushing(initialSubmitState)).toBe(false);
    expect(pollIntervalMs(initialSubmitState)).toBeNull();
  });

  it('SUBMIT locks the button, starts polling by key, and keeps the queue', () => {
    const s = run([{ type: 'SUBMIT', key: KEY }]);
    expect(s).toMatchObject({ phase: 'submitting', key: KEY });
    expect(canSubmit(s)).toBe(false);
    expect(isPushing(s)).toBe(true);
    expect(pollIntervalMs(s)).toBe(3000);
    expect(shouldClearQueue(s)).toBe(false);
  });

  it('a second SUBMIT while not idle/terminal is ignored', () => {
    const s = run([{ type: 'SUBMIT', key: KEY }, { type: 'SUBMIT', key: 'other-key-0001' }]);
    expect(s).toMatchObject({ phase: 'submitting', key: KEY });
  });
});

describe('the response is a courtesy', () => {
  it('RESPONSE_OK does NOT release pushing — it moves to polling until the row is terminal', () => {
    const s = run([{ type: 'SUBMIT', key: KEY }, { type: 'RESPONSE_OK', jobId: 'job-1' }]);
    expect(s).toMatchObject({ phase: 'polling', key: KEY, jobId: 'job-1' });
    expect(isPushing(s)).toBe(true);
    expect(canSubmit(s)).toBe(false);
  });

  it('RESPONSE_LOST (504 / network) keeps pushing, keeps the queue, keeps polling, and says so honestly', () => {
    const s = run([{ type: 'SUBMIT', key: KEY }, { type: 'RESPONSE_LOST', error: '504: upstream request timeout' }]);
    expect(s).toMatchObject({ phase: 'response_lost', key: KEY });
    expect(isPushing(s)).toBe(true);
    expect(canSubmit(s)).toBe(false);
    expect(shouldClearQueue(s)).toBe(false);
    expect(pollIntervalMs(s)).toBe(3000);
    const msg = statusMessage(s);
    expect(msg).toMatch(/still running|in progress/i);
    expect(msg).not.toMatch(/failed/i);
  });

  it('RESPONSE_REJECTED (a 4xx: refused before anything was recorded) returns to idle with the reason', () => {
    const s = run([{ type: 'SUBMIT', key: KEY }, { type: 'RESPONSE_REJECTED', error: 'Tariff 64 is being written by job job-9' }]);
    expect(s).toMatchObject({ phase: 'idle', lastError: 'Tariff 64 is being written by job job-9' });
    expect(canSubmit(s)).toBe(true);
    expect(shouldClearQueue(s)).toBe(false);
  });
});

describe('the job row is the truth', () => {
  it('a non-terminal JOB keeps polling; a terminal JOB settles, releases the button, clears the queue', () => {
    const polling = run([{ type: 'SUBMIT', key: KEY }, { type: 'RESPONSE_LOST', error: '504' }, { type: 'JOB', jobId: 'job-1', status: 'processing' }]);
    expect(polling).toMatchObject({ phase: 'polling', jobId: 'job-1', status: 'processing' });
    expect(isPushing(polling)).toBe(true);

    for (const status of TERMINAL_JOB_STATUSES) {
      const s = submitReducer(polling, { type: 'JOB', jobId: 'job-1', status });
      expect(s).toMatchObject({ phase: 'terminal', jobId: 'job-1', status });
      expect(canSubmit(s)).toBe(true);
      expect(isPushing(s)).toBe(false);
      expect(shouldClearQueue(s)).toBe(true);
      expect(pollIntervalMs(s)).toBeNull();
    }
  });

  it('terminal statuses are exactly the four the store derives', () => {
    expect([...TERMINAL_JOB_STATUSES].sort()).toEqual(['completed', 'failed', 'needs_review', 'partial']);
  });

  it('a lost response followed by a job that was never recorded returns to idle only after the limit — nothing was sent', () => {
    let s = run([{ type: 'SUBMIT', key: KEY }, { type: 'RESPONSE_LOST', error: '504' }]);
    for (let i = 1; i < NOT_FOUND_LIMIT; i++) {
      s = submitReducer(s, { type: 'JOB_NOT_FOUND' });
      expect(s.phase).toBe('response_lost');
      expect(isPushing(s)).toBe(true);
    }
    s = submitReducer(s, { type: 'JOB_NOT_FOUND' });
    expect(s).toMatchObject({ phase: 'idle' });
    expect(statusMessage(s)).toMatch(/no job was recorded|nothing was sent/i);
    expect(canSubmit(s)).toBe(true);
  });

  it('a job found after a lost response clears the not-found count', () => {
    const s = run([{ type: 'SUBMIT', key: KEY }, { type: 'RESPONSE_LOST', error: '504' }, { type: 'JOB_NOT_FOUND' }, { type: 'JOB_NOT_FOUND' }, { type: 'JOB', jobId: 'job-1', status: 'processing' }]);
    expect(s).toMatchObject({ phase: 'polling', jobId: 'job-1' });
  });

  it('the terminal message names the job and its status; RESET returns to idle', () => {
    const t = run([{ type: 'SUBMIT', key: KEY }, { type: 'RESPONSE_OK', jobId: 'job-1' }, { type: 'JOB', jobId: 'job-1', status: 'partial' }]);
    expect(statusMessage(t)).toMatch(/job-1/);
    expect(statusMessage(t)).toMatch(/partial/);
    expect(submitReducer(t, { type: 'RESET' })).toEqual(initialSubmitState);
  });
});
