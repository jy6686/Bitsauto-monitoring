/**
 * The queue a submission becomes. Through PGlite, because the two properties that matter —
 * SKIP LOCKED never handing one job to two workers, and the cap being read from the table rather
 * than a process — are properties of SQL, and a fake would assert my own assumptions back at me.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { sql } from 'drizzle-orm';
import {
  QUEUED, NON_TERMINAL_JOB_STATES, dedupeAccounts, countActiveJobs, claimNextQueuedJob,
  requestIsTerminal,
} from './job-queue';

let client: PGlite;
let db: any;
const all = async (q: any) => { const r = await db.execute(q); return Array.isArray(r) ? r : (r?.rows ?? []); };

/** Only the columns the queue reads. `status` is varchar(16) in production — 'needs_review' fits. */
beforeAll(async () => {
  client = await PGlite.create();
  db = drizzle(client);
  await client.exec(`
    CREATE TABLE rate_push_jobs (
      id SERIAL PRIMARY KEY,
      job_id VARCHAR(64) UNIQUE NOT NULL,
      request_id VARCHAR(64),
      status VARCHAR(16) NOT NULL DEFAULT 'pending',
      started_at TIMESTAMP,
      completed_at TIMESTAMP);`);
});
afterAll(async () => { await client?.close(); });
beforeEach(async () => { await client.exec(`DELETE FROM rate_push_jobs;`); });

const enqueue = async (jobId: string, requestId: string | null = 'req-1') =>
  db.execute(sql`INSERT INTO rate_push_jobs (job_id, request_id, status)
                 VALUES (${jobId}, ${requestId}, ${QUEUED})`);

describe('the vocabulary is extended, not replaced', () => {
  /** The whole point of decision 3: `queued` is added; nothing is renamed. */
  it('treats queued as non-terminal alongside the two that already existed', () => {
    expect([...NON_TERMINAL_JOB_STATES]).toEqual(['queued', 'pending', 'processing']);
  });

  it('does not introduce operation-layer words at the job layer', () => {
    for (const operationWord of ['running', 'succeeded', 'indeterminate', 'not_attempted']) {
      expect(NON_TERMINAL_JOB_STATES as readonly string[]).not.toContain(operationWord);
    }
  });

  it('fits the production column width', () => {
    for (const s of NON_TERMINAL_JOB_STATES) expect(s.length).toBeLessThanOrEqual(16);
  });
});

describe('dedupeAccounts — one account, one job', () => {
  it('collapses a repeated account to one', () => {
    expect(dedupeAccounts(['aura', 'test-31', 'aura'])).toEqual(['aura', 'test-31']);
  });

  /** The operator's order is the queue's order; the first mention wins. */
  it('keeps the submitted order and the first occurrence', () => {
    expect(dedupeAccounts(['b', 'a', 'b', 'c'])).toEqual(['b', 'a', 'c']);
  });

  it('drops blanks rather than queueing a job for nobody', () => {
    expect(dedupeAccounts(['aura', '', '   ', 'test-31'])).toEqual(['aura', 'test-31']);
  });

  /** Account names are Sippy identifiers. Folding case would merge accounts the switch separates. */
  it('does NOT fold case — 1global and 1GLOBAL are different accounts', () => {
    expect(dedupeAccounts(['1global', '1GLOBAL'])).toEqual(['1global', '1GLOBAL']);
  });

  it('survives empty and absent input', () => {
    expect(dedupeAccounts([])).toEqual([]);
    expect(dedupeAccounts(null)).toEqual([]);
    expect(dedupeAccounts(undefined)).toEqual([]);
  });
});

describe('claiming', () => {
  it('claims the oldest queued job and marks it pending', async () => {
    await enqueue('job-1'); await enqueue('job-2');
    const claimed = await claimNextQueuedJob(db, { maxConcurrent: 5 });
    expect(claimed?.jobId).toBe('job-1');
    expect(claimed?.requestId).toBe('req-1');

    const [row] = await all(sql`SELECT status, started_at FROM rate_push_jobs WHERE job_id='job-1'`);
    expect(row.status).toBe('pending');
    expect(row.started_at).not.toBeNull();
  });

  /** THE PROPERTY. Two workers, one job each — never the same one twice. */
  it('never hands the same job to two claimers', async () => {
    await enqueue('job-1'); await enqueue('job-2');
    const a = await claimNextQueuedJob(db, { maxConcurrent: 9 });
    const b = await claimNextQueuedJob(db, { maxConcurrent: 9 });
    expect(a?.jobId).not.toBe(b?.jobId);
    expect([a?.jobId, b?.jobId].sort()).toEqual(['job-1', 'job-2']);
  });

  it('returns null when nothing is queued', async () => {
    expect(await claimNextQueuedJob(db, { maxConcurrent: 5 })).toBeNull();
  });

  /**
   * A TEXT GUARD, and its limitation is the reason it exists.
   *
   * SKIP LOCKED is what stops two workers taking one job, and that property cannot be exercised
   * here: PGlite is a single in-process connection, so two claims cannot genuinely race and the
   * sequential test above passes with or without the clause. Asserting on the emitted statement
   * proves only that the clause is present — but present is exactly what a refactor removes by
   * accident, and its absence would be invisible in production until two instances collided over
   * one customer's push.
   */
  it('emits FOR UPDATE SKIP LOCKED in the claim', async () => {
    const captured: any[] = [];
    const spy = { execute: async (q: any) => { captured.push(q); return { rows: [] }; } };
    await claimNextQueuedJob(spy as any, { maxConcurrent: 1 });

    expect(captured).toHaveLength(1);
    const statement = JSON.stringify(captured[0]);
    expect(statement).toContain('FOR UPDATE SKIP LOCKED');
  });

  /** The cap comes from the table, so work already in flight elsewhere counts against it. */
  it('refuses to claim past the concurrency cap', async () => {
    await db.execute(sql`INSERT INTO rate_push_jobs (job_id, status) VALUES ('busy-1','pending'), ('busy-2','processing')`);
    await enqueue('job-1');
    expect(await claimNextQueuedJob(db, { maxConcurrent: 2 })).toBeNull();
    expect(await countActiveJobs(db)).toBe(2);
  });

  it('claims again once capacity frees up', async () => {
    await db.execute(sql`INSERT INTO rate_push_jobs (job_id, status) VALUES ('busy-1','pending')`);
    await enqueue('job-1');
    expect(await claimNextQueuedJob(db, { maxConcurrent: 1 })).toBeNull();

    await db.execute(sql`UPDATE rate_push_jobs SET status='completed' WHERE job_id='busy-1'`);
    expect((await claimNextQueuedJob(db, { maxConcurrent: 1 }))?.jobId).toBe('job-1');
  });

  /** A terminal job is not in flight and must not hold a slot open. */
  it('does not count finished jobs against the cap', async () => {
    await db.execute(sql`INSERT INTO rate_push_jobs (job_id, status)
                         VALUES ('a','completed'), ('b','failed'), ('c','partial'), ('d','needs_review')`);
    expect(await countActiveJobs(db)).toBe(0);
    await enqueue('job-1');
    expect((await claimNextQueuedJob(db, { maxConcurrent: 1 }))?.jobId).toBe('job-1');
  });

  /** A cap of zero pauses the queue rather than erroring. */
  it('claims nothing when the cap is zero or nonsense', async () => {
    await enqueue('job-1');
    for (const maxConcurrent of [0, -1, NaN]) {
      expect(await claimNextQueuedJob(db, { maxConcurrent })).toBeNull();
    }
    const [row] = await all(sql`SELECT status FROM rate_push_jobs WHERE job_id='job-1'`);
    expect(row.status).toBe(QUEUED);
  });

  it('carries a null request_id through for a legacy job', async () => {
    await enqueue('job-1', null);
    expect((await claimNextQueuedJob(db, { maxConcurrent: 5 }))?.requestId).toBeNull();
  });
});

describe('requestIsTerminal — the operator polls the submission, not a job', () => {
  it('is false while any sibling is queued, claimed or running', async () => {
    await db.execute(sql`INSERT INTO rate_push_jobs (job_id, request_id, status)
                         VALUES ('a','req-1','completed'), ('b','req-1','queued')`);
    expect(await requestIsTerminal(db, 'req-1')).toBe(false);

    await db.execute(sql`UPDATE rate_push_jobs SET status='processing' WHERE job_id='b'`);
    expect(await requestIsTerminal(db, 'req-1')).toBe(false);
  });

  /** Terminal means every sibling settled — including the ones that did not succeed. */
  it('is true when every sibling has settled, however it settled', async () => {
    await db.execute(sql`INSERT INTO rate_push_jobs (job_id, request_id, status)
                         VALUES ('a','req-1','completed'), ('b','req-1','failed'),
                                ('c','req-1','partial'), ('d','req-1','needs_review')`);
    expect(await requestIsTerminal(db, 'req-1')).toBe(true);
  });

  it('is not confused by another submission still running', async () => {
    await db.execute(sql`INSERT INTO rate_push_jobs (job_id, request_id, status)
                         VALUES ('a','req-1','completed'), ('z','req-2','queued')`);
    expect(await requestIsTerminal(db, 'req-1')).toBe(true);
    expect(await requestIsTerminal(db, 'req-2')).toBe(false);
  });
});
