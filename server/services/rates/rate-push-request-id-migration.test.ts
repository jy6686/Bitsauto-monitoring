/**
 * Migration 527 widens `rate_push_jobs.rate_type` and adds `rate_push_jobs.request_id`.
 *
 * Two independent things are locked here.
 *
 * The WIDTH is a declaration/reality drift, and the tests below fix its direction. The route
 * writes `change-client-rate` (18 chars) into a column declared varchar(16); both live databases
 * are 64 by drift, so the only correct move is bringing the declaration UP. A later migration
 * that narrows it would make the stored rows unrepresentable, so "never narrows" is asserted,
 * not assumed — and the schema.ts declaration is checked against the migration so the pair
 * cannot drift apart again, which is the defect this migration exists to end.
 *
 * The COLUMN is the seam for the per-account job split. It must arrive nullable, unbacked-filled
 * and non-uniquely indexed: siblings of one submission SHARE a request_id, and historical rows
 * keep NULL because "submitted before submissions had identity" is the true value for them.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { NON_NOTIFYING_RATE_TYPES } from './post-push-obligation';

const MIG_DIR = join(__dirname, '..', '..', '..', 'migrations');
const FILE = '527_rate_push_jobs_request_id.sql';
const SQL = readFileSync(join(MIG_DIR, FILE), 'utf8');
/** SQL with `--` comment lines removed, so an assertion cannot be satisfied by prose. */
const CODE = SQL.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');

const SCHEMA = readFileSync(join(__dirname, '..', '..', '..', 'shared', 'schema.ts'), 'utf8');

describe('migration 527', () => {
  it('is uniquely numbered', () => {
    const at527 = readdirSync(MIG_DIR).filter(f => /^527_/.test(f));
    expect(at527).toEqual([FILE]);
  });

  describe('rate_type', () => {
    /** The reason the width was wrong: a real value the route writes does not fit in 16. */
    it('is widened to hold the rate types the code actually writes', () => {
      const longest = Math.max(...NON_NOTIFYING_RATE_TYPES.map(t => t.length));
      expect(longest).toBeGreaterThan(16);
      expect(longest).toBeLessThanOrEqual(64);
      expect(CODE).toMatch(/ALTER TABLE rate_push_jobs ALTER COLUMN rate_type TYPE VARCHAR\(64\)/);
    });

    /** THE RULE. Live is already 64 and holds 18-char values; narrowing would destroy them. */
    it('never narrows the column', () => {
      const widths = [...CODE.matchAll(/ALTER COLUMN rate_type TYPE VARCHAR\((\d+)\)/gi)]
        .map(m => Number(m[1]));
      expect(widths.length).toBeGreaterThan(0);
      for (const w of widths) expect(w).toBeGreaterThanOrEqual(64);
    });

    /** The drift this migration ends: declaration and migration must state the same width. */
    it('agrees with the schema.ts declaration', () => {
      expect(SCHEMA).toMatch(/varchar\("rate_type",\s*\{\s*length:\s*64\s*\}\)/);
      expect(SCHEMA).not.toMatch(/varchar\("rate_type",\s*\{\s*length:\s*16\s*\}\)/);
    });
  });

  describe('request_id', () => {
    it('is added as a nullable column, with no default', () => {
      expect(CODE).toMatch(
        /ALTER TABLE rate_push_jobs ADD COLUMN IF NOT EXISTS request_id VARCHAR\(64\)/,
      );
      const stmt = CODE.match(/ADD COLUMN IF NOT EXISTS request_id[^;]*/i)?.[0] ?? '';
      expect(stmt).not.toMatch(/NOT NULL/i);
      expect(stmt).not.toMatch(/DEFAULT/i);
    });

    /** Siblings of one submission share this id — a unique index would reject the second job. */
    it('indexes it NON-uniquely, unlike 525 client_request_id', () => {
      expect(CODE).toMatch(
        /CREATE INDEX IF NOT EXISTS rate_push_jobs_request_id_idx\s*\n?\s*ON rate_push_jobs \(request_id\)/,
      );
      expect(CODE).not.toMatch(/CREATE UNIQUE INDEX[^;]*request_id_idx/i);
    });

    it('is a partial index, so legacy NULL rows cost nothing', () => {
      expect(CODE).toMatch(/WHERE request_id IS NOT NULL/);
    });

    /** NULL is the boundary between the two eras. A synthetic id would invent a grouping. */
    it('backfills nothing — historical rows stay NULL', () => {
      expect(CODE).not.toMatch(/UPDATE rate_push_jobs/i);
      expect(CODE).not.toMatch(/INSERT INTO rate_push_jobs/i);
      expect(CODE).not.toMatch(/SET request_id/i);
    });

    it('is declared in schema.ts so drizzle and the database agree', () => {
      expect(SCHEMA).toMatch(/requestId:\s*varchar\("request_id",\s*\{\s*length:\s*64\s*\}\)/);
    });
  });

  it('touches no other table — operations and obligations are unchanged', () => {
    const tables = new Set(
      [...CODE.matchAll(/ALTER TABLE (\w+)/gi)].map(m => m[1].toLowerCase()),
    );
    expect([...tables]).toEqual(['rate_push_jobs']);
    expect(CODE).not.toMatch(/rate_push_operations/i);
    expect(CODE).not.toMatch(/rate_push_notifications/i);
  });

  it('is idempotent — re-running adds nothing a second time', () => {
    expect(CODE).toMatch(/ADD COLUMN IF NOT EXISTS/);
    expect(CODE).toMatch(/CREATE INDEX IF NOT EXISTS/);
  });

  it('verifies its own effect and fails loudly on either half', () => {
    expect(CODE).toMatch(
      /RAISE EXCEPTION 'rate_push_jobs\.rate_type is not at least 64 wide after migration 527'/,
    );
    expect(CODE).toMatch(
      /RAISE EXCEPTION 'rate_push_jobs\.request_id was not created by migration 527'/,
    );
    expect(CODE).toMatch(/FROM information_schema\.columns/);
  });

  it('runs in a transaction, like 525', () => {
    expect(CODE.trim()).toMatch(/^BEGIN;/);
    expect(CODE.trim()).toMatch(/COMMIT;$/);
  });
});

/**
 * The assertions above read the migration as TEXT. These run it as SQL, against a database
 * shaped the way the migrations declare it — `rate_type` varchar(16), no `request_id` — so the
 * defect is reproduced before it is fixed. A migration that matches every pattern above and
 * still fails to execute would pass that suite and break a boot.
 */
describe('migration 527, executed', () => {
  let db: PGlite;
  const width = async (column: string): Promise<number | null> => {
    const res = await db.query<{ w: number | null }>(
      `SELECT character_maximum_length AS w FROM information_schema.columns
        WHERE table_name = 'rate_push_jobs' AND column_name = $1`,
      [column],
    );
    return res.rows[0]?.w ?? null;
  };

  beforeAll(async () => {
    db = await PGlite.create();
    // The pre-527 world, exactly as migrations/0000 declares it.
    await db.exec(`CREATE TABLE rate_push_jobs (
      id                serial PRIMARY KEY,
      job_id            varchar(64) UNIQUE NOT NULL,
      rate_type         varchar(16) DEFAULT 'current',
      client_request_id varchar(64)
    );`);
    await db.exec(`INSERT INTO rate_push_jobs (job_id, rate_type) VALUES ('job-legacy', 'current');`);
  });

  afterAll(async () => { await db?.close(); });

  /** The defect, reproduced: the value the route writes does not fit the declared column. */
  it('rejects the route\'s own rate_type before the migration runs', async () => {
    await expect(
      db.exec(`INSERT INTO rate_push_jobs (job_id, rate_type) VALUES ('job-pre', 'change-client-rate');`),
    ).rejects.toThrow(/too long/i);
    expect(await width('rate_type')).toBe(16);
    expect(await width('request_id')).toBeNull();
  });

  it('applies cleanly and produces both declared effects', async () => {
    await db.exec(SQL);
    expect(await width('rate_type')).toBe(64);
    expect(await width('request_id')).toBe(64);
  });

  it('then accepts the rate_type the route writes', async () => {
    await db.exec(`INSERT INTO rate_push_jobs (job_id, rate_type) VALUES ('job-post', 'change-client-rate');`);
    const res = await db.query<{ rate_type: string }>(
      `SELECT rate_type FROM rate_push_jobs WHERE job_id = 'job-post'`,
    );
    expect(res.rows[0].rate_type).toBe('change-client-rate');
    expect(NON_NOTIFYING_RATE_TYPES).toContain('change-client-rate');
  });

  it('leaves the pre-existing row\'s request_id NULL', async () => {
    const res = await db.query<{ request_id: string | null }>(
      `SELECT request_id FROM rate_push_jobs WHERE job_id = 'job-legacy'`,
    );
    expect(res.rows[0].request_id).toBeNull();
  });

  /** The whole point of the column: N jobs, one submission. A unique index would reject this. */
  it('accepts two sibling jobs sharing one request_id', async () => {
    await db.exec(`INSERT INTO rate_push_jobs (job_id, rate_type, request_id)
                   VALUES ('job-a', 'current', 'req-1'), ('job-b', 'current', 'req-1');`);
    const res = await db.query<{ n: bigint }>(
      `SELECT COUNT(*) AS n FROM rate_push_jobs WHERE request_id = 'req-1'`,
    );
    expect(Number(res.rows[0].n)).toBe(2);
  });

  it('is idempotent in fact, not only in text — a second run is a no-op', async () => {
    await db.exec(SQL);
    expect(await width('rate_type')).toBe(64);
    expect(await width('request_id')).toBe(64);
    const res = await db.query<{ n: bigint }>(`SELECT COUNT(*) AS n FROM rate_push_jobs`);
    expect(Number(res.rows[0].n)).toBe(4); // legacy, post, a, b — nothing added or lost
  });
});
