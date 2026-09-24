/**
 * A push job cannot go terminal over an operation that is still pending.
 *
 * THE FAILURE THIS EXISTS FOR, in order:
 *
 *   1. Sippy is mutated — the rate is live on the switch.
 *   2. The per-operation terminal UPDATE fails. The row stays `pending`.
 *   3. The job's own terminal update runs anyway → `completed`.
 *   4. Boot reconciliation only examines NON-terminal jobs, so it never looks at this one.
 *
 * The audit record is then permanently wrong rather than merely incomplete, and nothing in the
 * system will ever discover it. Step 3 is the only one that can be prevented, so it is.
 *
 * Behavioural, against real Postgres, and using the SAME predicate the route uses — a test that
 * re-wrote the SQL would prove only that its own copy behaves as its own copy says.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { sql } from 'drizzle-orm';
import { noPendingOperations } from './job-terminalization';

let client: PGlite;
let db: any;

const JOB = 'change-1790000000000';
const all = async (q: any) => { const r: any = await db.execute(q); return Array.isArray(r) ? r : (r.rows ?? []); };

/** The route's terminal update, reduced to what the invariant governs. */
const tryTerminalize = async (jobId = JOB) => {
  const res = await db.execute(sql`
    UPDATE rate_push_jobs
       SET status = 'completed', completed_at = NOW()
     WHERE job_id = ${jobId}
       AND ${noPendingOperations(jobId)}
    RETURNING job_id`);
  return (Array.isArray(res) ? res : (res.rows ?? [])).length;
};

const statusOf = async (jobId = JOB) =>
  (await all(sql`SELECT status FROM rate_push_jobs WHERE job_id = ${jobId}`))[0]?.status;

const addOperation = async (key: string, status: string, jobId = JOB) =>
  db.execute(sql`
    INSERT INTO rate_push_operations (job_id, operation_key, sequence, account_name, full_prefix, status)
    VALUES (${jobId}, ${key}, 0, 'ACME', '19230', ${status})`);

beforeAll(async () => {
  client = await PGlite.create();
  db = drizzle(client);
  await client.exec(`
    CREATE TABLE rate_push_jobs (
      job_id VARCHAR(64) PRIMARY KEY,
      status VARCHAR(16) NOT NULL DEFAULT 'pending',
      completed_at TIMESTAMP);
    CREATE TABLE rate_push_operations (
      id SERIAL PRIMARY KEY,
      job_id VARCHAR(64) NOT NULL REFERENCES rate_push_jobs(job_id) ON DELETE CASCADE,
      operation_key VARCHAR(128) NOT NULL,
      sequence INTEGER NOT NULL,
      account_name VARCHAR(160) NOT NULL,
      full_prefix VARCHAR(32) NOT NULL,
      status VARCHAR(24) NOT NULL DEFAULT 'pending');`);
});
afterAll(async () => { await client?.close(); });

beforeEach(async () => {
  await client.exec(`DELETE FROM rate_push_operations; DELETE FROM rate_push_jobs;`);
  await db.execute(sql`INSERT INTO rate_push_jobs (job_id, status) VALUES (${JOB}, 'pending')`);
});

describe('CRITICAL: an operation whose terminal UPDATE failed keeps its job out of terminal', () => {
  it('refuses to terminalise while one operation is still pending', async () => {
    // Two prefixes pushed. The first closed; the second's UPDATE failed, so it is still pending.
    await addOperation('0:19230', 'succeeded');
    await addOperation('1:19231', 'pending');

    expect(await tryTerminalize()).toBe(0);
    expect(await statusOf()).toBe('pending');
  });

  it('leaves the job in a status boot reconciliation actually examines', async () => {
    // reconcile-boot selects status IN ('pending','processing'). A job left anywhere else is
    // invisible to recovery, which is the whole failure being prevented.
    await addOperation('0:19230', 'pending');
    await tryTerminalize();
    expect(['pending', 'processing']).toContain(await statusOf());
  });

  it('terminalises once the stuck operation is settled — the refusal is not permanent', async () => {
    await addOperation('0:19230', 'succeeded');
    await addOperation('1:19231', 'pending');
    expect(await tryTerminalize()).toBe(0);

    // Reconciliation settles it later.
    await db.execute(sql`UPDATE rate_push_operations SET status = 'failed' WHERE operation_key = '1:19231'`);

    expect(await tryTerminalize()).toBe(1);
    expect(await statusOf()).toBe('completed');
  });
});

describe('a fully settled job terminalises normally', () => {
  it('all succeeded → terminal', async () => {
    await addOperation('0:19230', 'succeeded');
    await addOperation('1:19231', 'succeeded');
    expect(await tryTerminalize()).toBe(1);
    expect(await statusOf()).toBe('completed');
  });

  it('a mix of succeeded and failed is SETTLED — failure is a terminal state, not a pending one', async () => {
    await addOperation('0:19230', 'succeeded');
    await addOperation('1:19231', 'failed');
    expect(await tryTerminalize()).toBe(1);
  });

  it('other non-pending states do not block either', async () => {
    for (const s of ['succeeded', 'failed', 'indeterminate', 'not_attempted']) {
      await client.exec(`DELETE FROM rate_push_operations;`);
      await db.execute(sql`UPDATE rate_push_jobs SET status = 'pending', completed_at = NULL WHERE job_id = ${JOB}`);
      await addOperation('0:19230', s);
      expect(await tryTerminalize(), s).toBe(1);
    }
  });

  it('only this job is considered — another job\'s pending operation is not ours', async () => {
    await db.execute(sql`INSERT INTO rate_push_jobs (job_id, status) VALUES ('other-job', 'pending')`);
    await addOperation('0:19230', 'succeeded');
    await addOperation('0:29230', 'pending', 'other-job');
    expect(await tryTerminalize()).toBe(1);
  });
});

describe('the predicate alone is not sufficient — and says so', () => {
  it('a job with NO operations satisfies it, which is why the route also checks operationsRecorded', () => {
    // Documented rather than defended: "nothing is pending" is trivially true of "nothing exists".
    // SQL cannot separate the two, so the route pairs this predicate with the in-process fact that
    // the operation rows were actually written. This test pins the reason that pairing exists.
    return (async () => {
      expect(await all(sql`SELECT * FROM rate_push_operations`)).toHaveLength(0);
      expect(await tryTerminalize()).toBe(1);
    })();
  });
});
