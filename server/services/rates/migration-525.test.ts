/**
 * Migration 525 — the client request id on rate_push_jobs.
 *
 * DATABASE-BACKED: the file is read off disk and applied to the rate_push_jobs shape. What is
 * guarded: it is ADDITIVE (a nullable column and a partial unique index, nothing dropped), it is
 * idempotent (applying twice is a no-op), the index enforces one job per request id while leaving
 * NULL free for every caller that does not send one, and the schema declares the same column
 * name so drizzle and the migration cannot drift.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FILE = join(__dirname, '..', '..', '..', 'migrations', '525_rate_push_jobs_client_request_id.sql');
const SCHEMA = readFileSync(join(__dirname, '..', '..', '..', 'shared', 'schema.ts'), 'utf8');

let db: PGlite;
beforeEach(async () => {
  db = await PGlite.create();
  await db.exec(`
    CREATE TABLE rate_push_jobs (
      id SERIAL PRIMARY KEY,
      job_id VARCHAR(64) UNIQUE NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW()
    );`);
});
afterEach(async () => { await db?.close(); });

describe('migration 525', () => {
  const sqlText = () => readFileSync(FILE, 'utf8');

  it('exists, adds a nullable client_request_id and a partial unique index, and drops nothing', () => {
    const s = sqlText();
    expect(s).toMatch(/ADD COLUMN IF NOT EXISTS client_request_id VARCHAR\(64\)/i);
    expect(s).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS/i);
    expect(s).toMatch(/WHERE client_request_id IS NOT NULL/i);
    expect(s).not.toMatch(/\bDROP\b/i);
    expect(s).not.toMatch(/NOT NULL\s*$/m);   // the column must stay nullable
  });

  it('applies, and applies again without error', async () => {
    await db.exec(sqlText());
    await db.exec(sqlText());
    const cols = (await db.query(`SELECT column_name, is_nullable, character_maximum_length FROM information_schema.columns WHERE table_name = 'rate_push_jobs' AND column_name = 'client_request_id'`)) as any;
    expect(cols.rows).toEqual([{ column_name: 'client_request_id', is_nullable: 'YES', character_maximum_length: 64 }]);
  });

  it('one job per request id; NULL stays free for callers that send none', async () => {
    await db.exec(sqlText());
    await db.exec(`INSERT INTO rate_push_jobs (job_id, client_request_id) VALUES ('job-1', 'req-A')`);
    await expect(db.exec(`INSERT INTO rate_push_jobs (job_id, client_request_id) VALUES ('job-2', 'req-A')`)).rejects.toThrow(/unique|duplicate/i);
    await db.exec(`INSERT INTO rate_push_jobs (job_id, client_request_id) VALUES ('job-3', NULL)`);
    await db.exec(`INSERT INTO rate_push_jobs (job_id, client_request_id) VALUES ('job-4', NULL)`);
    const n = (await db.query(`SELECT COUNT(*)::int AS n FROM rate_push_jobs`)) as any;
    expect(n.rows[0].n).toBe(3);
  });

  it('shared/schema.ts declares the same column on ratePushJobs', () => {
    const at = SCHEMA.indexOf('export const ratePushJobs = pgTable("rate_push_jobs"');
    expect(at).toBeGreaterThan(-1);
    const block = SCHEMA.slice(at, SCHEMA.indexOf('});', at));
    expect(block).toMatch(/clientRequestId:\s*varchar\("client_request_id",\s*\{\s*length:\s*64\s*\}\)/);
  });
});
