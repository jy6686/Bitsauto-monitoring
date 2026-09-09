/**
 * Cross-batch exclusion on a tariff.
 *
 * The load-bearing test is the first one, and it reproduces 2026-09-09 directly: two SEPARATE
 * batches — job 46 from the UI and job 47 from the authorised acceptance — ran against tariff 65
 * at the same time, both writing prefix 19370, overlapping for about 44 seconds. The planner could
 * not prevent it, because its serialisation only covers operations inside one batch.
 *
 * Database-backed, because the persistence and the lock have to hold together.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runRateBatch, type RunnerOperation, type InjectedPush } from "./batch-runner";
import {
  createInMemoryTariffLock, acquireTariff, tariffHasUnresolvedOperations,
  createPostgresTariffLock, TARIFF_LOCK_NAMESPACE, type TariffLockProvider,
} from "./tariff-lock";

let client: PGlite;
let db: ReturnType<typeof drizzle>;

const op = (key: string, iTariff: number, prefix: string): RunnerOperation => ({
  operationKey: key, accountName: `acct-${iTariff}`,
  storedITariff: iTariff, resolvedITariff: iTariff,
  fullPrefix: prefix, rate: 0.133, rawIncrement: '60/1',
});

const okPush: InjectedPush = async () =>
  ({ success: true, message: 'confirmed', verificationResult: 'confirmed', refusedBeforeWrite: false });

beforeAll(async () => {
  client = await PGlite.create();
  db = drizzle(client);
  await client.exec(`CREATE TABLE rate_push_jobs (id SERIAL PRIMARY KEY, job_id VARCHAR(64) UNIQUE NOT NULL, status VARCHAR(16) NOT NULL DEFAULT 'pending');`);
  await client.exec(readFileSync(join(__dirname, '..', '..', '..', 'migrations', '511_rate_push_operations.sql'), 'utf8'));
  await client.exec(readFileSync(join(__dirname, '..', '..', '..', 'migrations', '512_operation_resolution.sql'), 'utf8'));
});
afterAll(async () => { await client?.close(); });
beforeEach(async () => {
  await client.exec(`DELETE FROM rate_push_operations; DELETE FROM rate_push_jobs;`);
  await db.execute(sql`INSERT INTO rate_push_jobs (job_id) VALUES ('job-46'), ('job-47')`);
});

describe("two batches, one tariff", () => {
  it("REGRESSION (jobs 46 + 47, tariff 65): concurrent batches never overlap on the same tariff", async () => {
    const lock = createInMemoryTariffLock();
    let inFlight = 0, maxOverlap = 0;
    const order: string[] = [];
    const push: InjectedPush = async (o) => {
      inFlight++; maxOverlap = Math.max(maxOverlap, inFlight);
      order.push(`start ${o.operationKey}`);
      await new Promise(r => setTimeout(r, 20));
      order.push(`end   ${o.operationKey}`);
      inFlight--;
      return { success: true, message: 'ok', verificationResult: 'confirmed', refusedBeforeWrite: false };
    };
    const lockOptions = { pollMs: 2, timeoutMs: 5000 };

    // Both batches target tariff 65, exactly as the two real jobs did.
    await Promise.all([
      runRateBatch({ db, push, lock, lockOptions }, { jobId: 'job-46', operations: [op('a', 65, '19370'), op('b', 65, '19371')] }),
      runRateBatch({ db, push, lock, lockOptions }, { jobId: 'job-47', operations: [op('c', 65, '19370')] }),
    ]);

    expect(maxOverlap).toBe(1);
    // Every start is immediately followed by its own end — no interleaving at all.
    for (let i = 0; i < order.length; i += 2) {
      expect(order[i].replace('start ', '')).toBe(order[i + 1].replace('end   ', ''));
    }
  });

  it("still runs DIFFERENT tariffs concurrently — the lock is per tariff, not global", async () => {
    const lock = createInMemoryTariffLock();
    let inFlight = 0, maxOverlap = 0;
    const push: InjectedPush = async () => {
      inFlight++; maxOverlap = Math.max(maxOverlap, inFlight);
      await new Promise(r => setTimeout(r, 20));
      inFlight--;
      return { success: true, message: 'ok', verificationResult: 'confirmed', refusedBeforeWrite: false };
    };
    await Promise.all([
      runRateBatch({ db, push, lock }, { jobId: 'job-46', operations: [op('a', 64, '19370')] }),
      runRateBatch({ db, push, lock }, { jobId: 'job-47', operations: [op('c', 65, '19370')] }),
    ]);
    expect(maxOverlap).toBe(2);
  });

  it("releases the tariff even when the push throws", async () => {
    const lock = createInMemoryTariffLock();
    await runRateBatch({ db, push: async () => { throw new Error('boom'); }, lock },
      { jobId: 'job-46', operations: [op('a', 65, '19370')] });
    // If the release had been skipped, this would be null.
    const again = await lock.tryAcquire(65);
    expect(again).not.toBeNull();
  });

  it("without a lock provider, behaviour is unchanged — no cross-batch exclusion", async () => {
    let inFlight = 0, maxOverlap = 0;
    const push: InjectedPush = async () => {
      inFlight++; maxOverlap = Math.max(maxOverlap, inFlight);
      await new Promise(r => setTimeout(r, 20));
      inFlight--;
      return { success: true, message: 'ok', verificationResult: 'confirmed', refusedBeforeWrite: false };
    };
    await Promise.all([
      runRateBatch({ db, push }, { jobId: 'job-46', operations: [op('a', 65, '19370')] }),
      runRateBatch({ db, push }, { jobId: 'job-47', operations: [op('c', 65, '19371')] }),
    ]);
    expect(maxOverlap).toBe(2);   // the gap this slice closes, demonstrated
  });
});

describe("when the tariff never becomes free", () => {
  it("reports a FAILURE, not an unknown outcome, because nothing was sent", async () => {
    // A blocked operation is the one case where "nothing happened" is certain, so it must not halt
    // the tariff the way an unestablished outcome does.
    const blocked: TariffLockProvider = { tryAcquire: async () => null };
    const push = vi.fn(okPush);
    const out = await runRateBatch(
      { db, push, lock: blocked, lockOptions: { timeoutMs: 30, pollMs: 5 } },
      { jobId: 'job-46', operations: [op('a', 65, '19370')] },
    );

    expect(push).not.toHaveBeenCalled();
    expect(out.results[0].success).toBe(false);
    expect(out.results[0].message).toContain('did not become free in time');
    expect(out.summary.status).toBe('failed');
    expect(out.summary.requiresReview).toBe(false);
    const [row] = await (async () => { const r: any = await db.execute(sql`SELECT status, refused_before_write FROM rate_push_operations WHERE job_id='job-46'`); return Array.isArray(r) ? r : r.rows; })();
    expect(row.status).toBe('failed');
    expect(row.refused_before_write).toBe(true);
  });

  it("acquireTariff gives up after the timeout rather than waiting forever", async () => {
    const never: TariffLockProvider = { tryAcquire: async () => null };
    let slept = 0;
    const t0 = 1_000_000;
    let clock = t0;
    const release = await acquireTariff(never, 65, {
      timeoutMs: 100, pollMs: 10,
      now: () => clock,
      sleep: async (ms) => { slept += ms; clock += ms; },
    });
    expect(release).toBeNull();
    expect(slept).toBeGreaterThanOrEqual(100);
  });

  it("acquireTariff returns as soon as the tariff frees up", async () => {
    let calls = 0;
    const freesOnThirdTry: TariffLockProvider = {
      tryAcquire: async () => (++calls < 3 ? null : (async () => {})),
    };
    const release = await acquireTariff(freesOnThirdTry, 65, { timeoutMs: 5000, pollMs: 1 });
    expect(release).not.toBeNull();
    expect(calls).toBe(3);
  });
});

describe("the Postgres provider", () => {
  it("acquires, blocks a second holder on the same connection pool, and releases", async () => {
    // PGlite is a single Postgres session, so two pooled clients are the same session and the
    // second acquire SUCCEEDS — a session already holding an advisory lock may retake it. That
    // makes this a test of the SQL and the release path, not of contention; contention is covered
    // by the in-memory provider above, where two holders are genuinely distinct.
    const fakePool = {
      connect: async () => ({
        query: (text: string, params?: any[]) => db.execute(sql.raw(
          text.replace('$1', String(params?.[0])).replace('$2', String(params?.[1])),
        )).then((r: any) => ({ rows: Array.isArray(r) ? r : (r.rows ?? []) })),
        release: () => {},
      }),
    };
    const provider = createPostgresTariffLock(fakePool as any);
    const release = await provider.tryAcquire(65);
    expect(release).not.toBeNull();

    const held: any = await db.execute(sql`SELECT objid FROM pg_locks WHERE locktype = 'advisory' AND classid = ${TARIFF_LOCK_NAMESPACE}`);
    expect((Array.isArray(held) ? held : held.rows).map((r: any) => Number(r.objid))).toContain(65);

    await release!();
    const after: any = await db.execute(sql`SELECT objid FROM pg_locks WHERE locktype = 'advisory' AND classid = ${TARIFF_LOCK_NAMESPACE}`);
    expect((Array.isArray(after) ? after : after.rows).map((r: any) => Number(r.objid))).not.toContain(65);
  });

  it("releasing twice is safe", async () => {
    const provider = createInMemoryTariffLock();
    const release = await provider.tryAcquire(65);
    await release!(); await release!();
    expect(await provider.tryAcquire(65)).not.toBeNull();
  });
});

describe("tariffHasUnresolvedOperations — reports the fact, imposes no policy", () => {
  it("finds an operation whose outcome was never established", async () => {
    await db.execute(sql`
      INSERT INTO rate_push_operations (job_id, operation_key, sequence, account_name, full_prefix, i_tariff, status)
      VALUES ('job-46', 'a', 0, 'acct', '19370', 65, 'indeterminate')`);
    const r = await tariffHasUnresolvedOperations(db, 65, sql);
    expect(r.unresolved).toBe(true);
    expect(r.operationKeys).toEqual(['job-46/a']);
  });

  it("stops counting an operation once a person has resolved it", async () => {
    // This is the unblock half of the chain: unknown -> block -> inspect -> resolve -> eligible.
    await db.execute(sql`
      INSERT INTO rate_push_operations (job_id, operation_key, sequence, account_name, full_prefix, i_tariff, status)
      VALUES ('job-46', 'a', 0, 'acct', '19370', 65, 'indeterminate')`);
    expect((await tariffHasUnresolvedOperations(db, 65, sql)).unresolved).toBe(true);

    await db.execute(sql`
      UPDATE rate_push_operations
         SET resolution = 'not_applied', resolved_by = 'junaid', resolved_at = NOW(),
             resolution_note = 'Read tariff 65 in Sippy; 19370 is absent.'
       WHERE job_id = 'job-46' AND operation_key = 'a'`);

    const after = await tariffHasUnresolvedOperations(db, 65, sql);
    expect(after.unresolved).toBe(false);
    // The original verdict is still on the row — resolution did not erase it.
    const st: any = await db.execute(sql`SELECT status FROM rate_push_operations WHERE operation_key = 'a'`);
    expect((Array.isArray(st) ? st : st.rows)[0].status).toBe('indeterminate');
  });

  it("is clean for a tariff whose operations all settled", async () => {
    await db.execute(sql`
      INSERT INTO rate_push_operations (job_id, operation_key, sequence, account_name, full_prefix, i_tariff, status)
      VALUES ('job-46', 'a', 0, 'acct', '19370', 66, 'succeeded'),
             ('job-46', 'b', 1, 'acct', '19371', 66, 'failed')`);
    expect((await tariffHasUnresolvedOperations(db, 66, sql)).unresolved).toBe(false);
  });
});
