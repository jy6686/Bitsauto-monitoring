/**
 * The two reads the submit guards and the by-request lookup need — against real Postgres
 * (PGlite) and the 525 shape. Same OperationQueryable surface as operation-store.ts.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { sql } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findJobByClientRequestId, listNonTerminalJobsForTariffs } from './job-lookup-store';

let client: PGlite;
let db: ReturnType<typeof drizzle>;

beforeAll(async () => {
  client = await PGlite.create();
  db = drizzle(client);
  await client.exec(`
    CREATE TABLE rate_push_jobs (
      id SERIAL PRIMARY KEY,
      job_id VARCHAR(64) UNIQUE NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'pending',
      i_tariff INTEGER,
      client_names TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      last_step VARCHAR(32),
      last_step_at TIMESTAMP,
      completed_at TIMESTAMP,
      error_message TEXT
    );`);
  await client.exec(readFileSync(join(__dirname, '..', '..', '..', 'migrations', '525_rate_push_jobs_client_request_id.sql'), 'utf8'));
});
afterAll(async () => { await client?.close(); });
beforeEach(async () => { await client.exec(`DELETE FROM rate_push_jobs`); });

const seed = (jobId: string, over: { status?: string; iTariff?: number | null; key?: string | null; lastStepAt?: string | null; createdAt?: string } = {}) =>
  db.execute(sql`INSERT INTO rate_push_jobs (job_id, status, i_tariff, client_request_id, last_step_at, created_at)
                 VALUES (${jobId}, ${over.status ?? 'processing'}, ${over.iTariff === undefined ? 64 : over.iTariff}, ${over.key ?? null},
                         ${over.lastStepAt === undefined ? '2026-09-19 14:00:00' : over.lastStepAt}, ${over.createdAt ?? '2026-09-19 13:59:00'})`);

describe('findJobByClientRequestId', () => {
  it('returns the job for a known key, null for an unknown one, and never matches NULL keys', async () => {
    await seed('job-1', { key: 'req-A', status: 'completed' });
    await seed('job-2', { key: null });
    expect(await findJobByClientRequestId(db as any, 'req-A')).toMatchObject({ jobId: 'job-1', status: 'completed', iTariff: 64 });
    expect(await findJobByClientRequestId(db as any, 'req-Z')).toBeNull();
    expect(await findJobByClientRequestId(db as any, '')).toBeNull();
  });
});

describe('listNonTerminalJobsForTariffs', () => {
  it('returns only pending/processing jobs on the given tariffs, with both clocks', async () => {
    await seed('live-64', { iTariff: 64 });
    await seed('live-66', { iTariff: 66 });
    await seed('done-64', { iTariff: 64, status: 'completed' });
    await seed('pend-64', { iTariff: 64, status: 'pending', lastStepAt: null });
    await seed('none',    { iTariff: null });
    const rows = await listNonTerminalJobsForTariffs(db as any, [64]);
    expect(rows.map(r => r.jobId).sort()).toEqual(['live-64', 'pend-64']);
    const pend = rows.find(r => r.jobId === 'pend-64')!;
    expect(pend.lastStepAt).toBeNull();
    expect(pend.createdAt).toBeInstanceOf(Date);
    expect(rows.find(r => r.jobId === 'live-64')!.lastStepAt).toBeInstanceOf(Date);
  });

  it('an empty tariff list reads nothing', async () => {
    await seed('live-64');
    expect(await listNonTerminalJobsForTariffs(db as any, [])).toEqual([]);
  });
});
