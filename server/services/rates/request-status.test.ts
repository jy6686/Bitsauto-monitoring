/**
 * The status of a submission, once a submission is more than one job.
 *
 * The regression these exist to prevent is specific: an operator's Submit unlocking while a
 * sibling account is still being written. That is how the 2026-09-19 double-submit happened when
 * a status was believed too early, and splitting by account creates a brand-new way to believe it
 * too early — a job nobody has started yet has NO operation rows at all.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { sql } from 'drizzle-orm';
import { rankRequestStatus, deriveRequestStatus } from './request-status';

describe('rankRequestStatus — the roll-up rule', () => {
  it('is pending when nothing has been recorded', () => {
    expect(rankRequestStatus([])).toBe('pending');
  });

  describe('work still owed outranks every finished sibling', () => {
    /** THE PROPERTY. One account done, one not started, is NOT a finished submission. */
    it.each(['queued', 'pending', 'processing'])('reports processing while a sibling is %s', (owed) => {
      expect(rankRequestStatus(['completed', owed])).toBe('processing');
      expect(rankRequestStatus([owed, 'failed'])).toBe('processing');
    });

    /** A word this build does not know cannot be certified as finished. */
    it('treats an unrecognised status as owed work, never as success', () => {
      expect(rankRequestStatus(['completed', 'succeeded'])).toBe('processing');
      expect(rankRequestStatus(['completed', ''])).toBe('completed');   // blank entries are dropped
    });
  });

  describe('once every sibling is finished', () => {
    it('is completed only when all of them completed', () => {
      expect(rankRequestStatus(['completed', 'completed'])).toBe('completed');
      expect(rankRequestStatus(['completed'])).toBe('completed');
    });

    /** needs_review outranks the rest for the same reason it does one level down: job #43. */
    it('reports needs_review above partial, completed and failed', () => {
      expect(rankRequestStatus(['completed', 'needs_review'])).toBe('needs_review');
      expect(rankRequestStatus(['failed', 'needs_review'])).toBe('needs_review');
      expect(rankRequestStatus(['partial', 'needs_review'])).toBe('needs_review');
    });

    it('is partial when some progress was made and some was not', () => {
      expect(rankRequestStatus(['completed', 'failed'])).toBe('partial');
      expect(rankRequestStatus(['partial', 'failed'])).toBe('partial');
      expect(rankRequestStatus(['partial'])).toBe('partial');
    });

    it('is failed only when nothing succeeded anywhere', () => {
      expect(rankRequestStatus(['failed', 'failed'])).toBe('failed');
    });
  });

  /** A single-account submission must rank exactly as that one job already reads. */
  it('leaves a one-job submission reading as that job', () => {
    for (const s of ['completed', 'partial', 'failed', 'needs_review']) {
      expect(rankRequestStatus([s])).toBe(s);
    }
  });
});

let client: PGlite;
let db: any;

beforeAll(async () => {
  client = await PGlite.create();
  db = drizzle(client);
  await client.exec(`
    CREATE TABLE rate_push_jobs (
      id SERIAL PRIMARY KEY,
      job_id VARCHAR(64) UNIQUE NOT NULL,
      request_id VARCHAR(64),
      client_names TEXT,
      status VARCHAR(16) NOT NULL DEFAULT 'pending',
      total_clients INTEGER DEFAULT 0,
      pushed_clients INTEGER DEFAULT 0,
      failed_clients INTEGER DEFAULT 0);`);
});
afterAll(async () => { await client?.close(); });
beforeEach(async () => { await client.exec(`DELETE FROM rate_push_jobs;`); });

const add = (jobId: string, requestId: string | null, accountName: string, status: string,
              total = 6, pushed = 0, failed = 0) =>
  db.execute(sql`INSERT INTO rate_push_jobs
    (job_id, request_id, client_names, status, total_clients, pushed_clients, failed_clients)
    VALUES (${jobId}, ${requestId}, ${accountName}, ${status}, ${total}, ${pushed}, ${failed})`);

describe('deriveRequestStatus', () => {
  it('is null for a request id nothing was recorded under', async () => {
    expect(await deriveRequestStatus(db, 'req-nothing')).toBeNull();
  });

  it('names every sibling in creation order', async () => {
    await add('job-1-0', 'req-1', 'aura', 'completed');
    await add('job-1-1', 'req-1', 'test-31', 'failed');
    const s = (await deriveRequestStatus(db, 'req-1'))!;
    expect(s.jobs.map(j => j.jobId)).toEqual(['job-1-0', 'job-1-1']);
    expect(s.jobs.map(j => j.accountName)).toEqual(['aura', 'test-31']);
  });

  /**
   * THE CASE THE SPLIT CREATES. aura is finished with all six operations recorded; test-31 has
   * not been started and therefore has no operation rows whatsoever. Anything that reads only
   * operations sees 6 of 6 succeeded and calls the submission complete.
   */
  it('does not report a submission finished while a sibling has not started', async () => {
    await add('job-1-0', 'req-1', 'aura', 'completed', 6, 6, 0);
    await add('job-1-1', 'req-1', 'test-31', 'queued', 6, 0, 0);
    const s = (await deriveRequestStatus(db, 'req-1'))!;
    expect(s.status).toBe('processing');
    expect(s.terminal).toBe(false);
  });

  it('is terminal only once no sibling owes work', async () => {
    await add('job-1-0', 'req-1', 'aura', 'completed', 6, 6, 0);
    await add('job-1-1', 'req-1', 'test-31', 'failed', 6, 0, 6);
    const s = (await deriveRequestStatus(db, 'req-1'))!;
    expect(s.terminal).toBe(true);
    expect(s.status).toBe('partial');   // aura is fine; the single row used to say only "Partial"
  });

  it('sums operation totals across siblings', async () => {
    await add('job-1-0', 'req-1', 'aura', 'completed', 6, 6, 0);
    await add('job-1-1', 'req-1', 'test-31', 'failed', 6, 0, 6);
    expect((await deriveRequestStatus(db, 'req-1'))!.counts).toEqual({ total: 12, pushed: 6, failed: 6 });
  });

  /** Siblings of ANOTHER submission must never be counted into this one. */
  it('ignores jobs belonging to a different request', async () => {
    await add('job-1-0', 'req-1', 'aura', 'completed', 6, 6, 0);
    await add('job-2-0', 'req-2', 'ghost', 'processing', 3, 0, 0);
    const s = (await deriveRequestStatus(db, 'req-1'))!;
    expect(s.jobs).toHaveLength(1);
    expect(s.status).toBe('completed');
  });

  /** Legacy rows carry no request id; they must not be swept into a null-keyed request. */
  it('does not match rows whose request id is null', async () => {
    await add('job-legacy', null, 'aura', 'completed');
    expect(await deriveRequestStatus(db, '')).toBeNull();
  });
});
