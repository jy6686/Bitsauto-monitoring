/**
 * pendingRateNotifications with an attempts cap — proven against a real database.
 *
 * The selection is `status IN ('pending','failed') ORDER BY created_at`. Without a cap, one
 * permanently failing obligation is the oldest row forever and is re-attempted at the front of
 * every run, starving everything behind it. `maxAttempts` skips it. Optional and unbounded by
 * default, so the existing worker tests — and any other caller — see exactly what they saw.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { sql } from 'drizzle-orm';
import { pendingRateNotifications } from './post-push-obligation';

let client: PGlite;
let db: ReturnType<typeof drizzle>;

beforeAll(async () => {
  client = await PGlite.create();
  db = drizzle(client);
  await db.execute(sql`
    CREATE TABLE rate_push_notifications (
      id                SERIAL PRIMARY KEY,
      job_id            TEXT NOT NULL,
      client_name       TEXT NOT NULL,
      product_label     TEXT NOT NULL,
      notification_type TEXT NOT NULL,
      rows_json         JSONB NOT NULL DEFAULT '[]',
      dial_format       TEXT,
      status            TEXT NOT NULL DEFAULT 'pending',
      attempts          INTEGER NOT NULL DEFAULT 0,
      last_error        TEXT,
      last_attempt_at   TIMESTAMPTZ,
      sent_at           TIMESTAMPTZ,
      recipients        TEXT,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  // Oldest first, so the ordering assertion below means something.
  await db.execute(sql`
    INSERT INTO rate_push_notifications (job_id, client_name, product_label, notification_type, status, attempts, created_at) VALUES
      ('j1', 'stuck',   'FC', 'change', 'failed',  5, '2026-09-01T00:00:00Z'),
      ('j2', 'retry',   'FC', 'change', 'failed',  2, '2026-09-02T00:00:00Z'),
      ('j3', 'fresh',   'FC', 'change', 'pending', 0, '2026-09-03T00:00:00Z'),
      ('j4', 'done',    'FC', 'change', 'sent',    1, '2026-09-04T00:00:00Z'),
      ('j5', 'onmore',  'FC', 'change', 'failed',  4, '2026-09-05T00:00:00Z')`);
});

afterAll(async () => { await client.close(); });

describe('pendingRateNotifications', () => {
  it('unchanged by default: every pending and failed row, oldest first, regardless of attempts', async () => {
    const got = await pendingRateNotifications(db as any, 100);
    expect(got.map(r => r.clientName)).toEqual(['stuck', 'retry', 'fresh', 'onmore']);
  });

  /** THE CAP. `stuck` at 5 attempts drops out; `onmore` at 4 is still eligible for its fifth. */
  it('maxAttempts=5 skips the exhausted obligation and keeps the order of the rest', async () => {
    const got = await pendingRateNotifications(db as any, 100, 5);
    expect(got.map(r => r.clientName)).toEqual(['retry', 'fresh', 'onmore']);
    expect(got.map(r => r.attempts)).toEqual([2, 0, 4]);
  });

  it('a lower cap tightens accordingly', async () => {
    const got = await pendingRateNotifications(db as any, 100, 3);
    expect(got.map(r => r.clientName)).toEqual(['retry', 'fresh']);
  });

  /**
   * The starvation the cap exists to prevent: with limit 1 and no cap, the stuck row is the
   * only thing ever returned. With the cap, the queue moves.
   */
  it('with limit 1: uncapped returns the stuck row forever; capped returns the next real one', async () => {
    expect((await pendingRateNotifications(db as any, 1)).map(r => r.clientName)).toEqual(['stuck']);
    expect((await pendingRateNotifications(db as any, 1, 5)).map(r => r.clientName)).toEqual(['retry']);
  });

  it('never returns a sent obligation, capped or not', async () => {
    for (const cap of [undefined, 5, 100]) {
      const names = (await pendingRateNotifications(db as any, 100, cap)).map(r => r.clientName);
      expect(names).not.toContain('done');
    }
  });
});
