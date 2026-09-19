/**
 * The runner with a group push injected — database-backed (PGlite), no switch.
 *
 * What the wiring is accountable for: a multi-row group goes to the GROUP primitive exactly once;
 * a single-row group keeps using the proven per-operation primitive (so a flag that is ON changes
 * nothing for a one-prefix push); the tariff is claimed ONCE per group; and every operation still
 * ends on its own durable row with its own verdict.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runRateBatch, type RunnerOperation, type InjectedPush, type InjectedGroupPush } from "./batch-runner";
import { createInMemoryTariffLock, type TariffLockProvider } from "./tariff-lock";

let client: PGlite;
let db: ReturnType<typeof drizzle>;
const JOB = 'job-groups-1';
const FUTURE = '2099-01-01 10:00:00';

const op = (over: Partial<RunnerOperation> & Pick<RunnerOperation, 'operationKey'>): RunnerOperation => ({
  accountName: 'aura', storedITariff: 66, resolvedITariff: 66,
  fullPrefix: '29230', rate: 0.04, rawIncrement: '1/1', effectiveFrom: FUTURE, ...over,
});

const confirms: InjectedPush = async () => ({
  success: true, message: 'confirmed by read-back', method: 'upload_token', verificationResult: 'confirmed', refusedBeforeWrite: false,
});
const groupConfirms: InjectedGroupPush = async (ops) => ops.map(o => ({
  operationKey: o.operationKey, success: true, message: `confirmed ${o.prefix}`, method: 'upload_token',
  verificationResult: 'confirmed', refusedBeforeWrite: false,
}));

const all = async (q: any) => { const r: any = await db.execute(q); return Array.isArray(r) ? r : (r.rows ?? []); };
const rowsFor = async (jobId = JOB) =>
  all(sql`SELECT operation_key, status, i_tariff, attempts, refused_before_write, verification_result, message
            FROM rate_push_operations WHERE job_id = ${jobId} ORDER BY sequence`);

beforeAll(async () => {
  client = await PGlite.create();
  db = drizzle(client);
  await client.exec(`
    CREATE TABLE rate_push_jobs (
      id SERIAL PRIMARY KEY,
      job_id VARCHAR(64) UNIQUE NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'pending'
    );`);
  for (const m of ['511_rate_push_operations.sql', '512_operation_resolution.sql', '513_operation_trace.sql']) {
    await client.exec(readFileSync(join(__dirname, '..', '..', '..', 'migrations', m), 'utf8'));
  }
});
afterAll(async () => { await client?.close(); });
beforeEach(async () => {
  await client.exec(`DELETE FROM rate_push_operations; DELETE FROM rate_push_jobs;`);
  await db.execute(sql`INSERT INTO rate_push_jobs (job_id) VALUES (${JOB})`);
});

describe("which primitive runs", () => {
  it("five same-date prefixes on one tariff → the group push ONCE with all five; the per-op push never", async () => {
    const push = vi.fn(confirms);
    const pushGroup = vi.fn(groupConfirms);
    const out = await runRateBatch({ db, push, pushGroup }, {
      jobId: JOB,
      operations: ['29230', '29233', '29232', '29231', '29237'].map((p, i) => op({ operationKey: `k${i}`, fullPrefix: p })),
    });

    expect(pushGroup).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
    const [ops, ctx] = pushGroup.mock.calls[0];
    expect(ops.map(o => o.prefix)).toEqual(['29230', '29233', '29232', '29231', '29237']);
    expect(ctx).toMatchObject({ iTariff: 66, action: 'A', activation: FUTURE });
    expect(out.ok).toBe(5);
    expect(out.summary.status).toBe('completed');
  });

  it("a one-prefix group keeps the proven per-operation primitive — the flag changes nothing for a single push", async () => {
    const push = vi.fn(confirms);
    const pushGroup = vi.fn(groupConfirms);
    await runRateBatch({ db, push, pushGroup }, { jobId: JOB, operations: [op({ operationKey: 'only' })] });

    expect(push).toHaveBeenCalledTimes(1);
    expect(pushGroup).not.toHaveBeenCalled();
  });

  it("A and SA rows on one tariff are two calls; a lone SA row goes per-operation", async () => {
    const push = vi.fn(confirms);
    const pushGroup = vi.fn(groupConfirms);
    await runRateBatch({ db, push, pushGroup }, {
      jobId: JOB,
      operations: [
        op({ operationKey: 'a1', fullPrefix: '29230' }),
        op({ operationKey: 'sa', fullPrefix: '29231', effectiveFrom: undefined }),
        op({ operationKey: 'a2', fullPrefix: '29232' }),
      ],
    });
    expect(pushGroup).toHaveBeenCalledTimes(1);
    expect(pushGroup.mock.calls[0][0].map(o => o.operationKey)).toEqual(['a1', 'a2']);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][0].operationKey).toBe('sa');
  });

  it("without pushGroup the runner is exactly what it was", async () => {
    const push = vi.fn(confirms);
    await runRateBatch({ db, push }, {
      jobId: JOB, operations: [op({ operationKey: 'a' }), op({ operationKey: 'b', fullPrefix: '29231' })],
    });
    expect(push).toHaveBeenCalledTimes(2);
  });
});

describe("the tariff is claimed once per group and the rows stay per operation", () => {
  it("one lock acquisition for a three-row group, released afterwards", async () => {
    const inner = createInMemoryTariffLock();
    let acquisitions = 0;
    const lock: TariffLockProvider = { tryAcquire: async (t) => { acquisitions++; return inner.tryAcquire(t); } };
    await runRateBatch({ db, push: confirms, pushGroup: groupConfirms, lock }, {
      jobId: JOB, operations: ['1', '2', '3'].map(p => op({ operationKey: `k${p}`, fullPrefix: `2923${p}` })),
    });
    expect(acquisitions).toBe(1);
    expect(await inner.tryAcquire(66)).not.toBeNull();   // free again
  });

  it("a group that cannot claim the tariff in time is five failures with nothing sent", async () => {
    const inner = createInMemoryTariffLock();
    const held = await inner.tryAcquire(66);
    const pushGroup = vi.fn(groupConfirms);
    const out = await runRateBatch(
      { db, push: confirms, pushGroup, lock: inner, lockOptions: { timeoutMs: 20, pollMs: 5 } },
      { jobId: JOB, operations: ['1', '2'].map(p => op({ operationKey: `k${p}`, fullPrefix: `2923${p}` })) },
    );
    await held!();
    expect(pushGroup).not.toHaveBeenCalled();
    expect(out.results.map(r => r.verdict)).toEqual(['failure', 'failure']);
    const rows = await rowsFor();
    expect(rows.every((r: any) => r.status === 'failed' && r.refused_before_write === true)).toBe(true);
  });

  it("4 confirmed + 1 mismatch lands as five rows: four succeeded, one failed, parent partial", async () => {
    const pushGroup: InjectedGroupPush = async (ops) => ops.map(o => (o.prefix === '29237'
      ? { operationKey: o.operationKey, success: false, message: 'found 0.05', method: 'upload_token', verificationResult: 'mismatch', refusedBeforeWrite: false }
      : { operationKey: o.operationKey, success: true, message: 'ok', method: 'upload_token', verificationResult: 'confirmed', refusedBeforeWrite: false }));
    const out = await runRateBatch({ db, push: confirms, pushGroup }, {
      jobId: JOB,
      operations: ['29230', '29233', '29232', '29231', '29237'].map((p, i) => op({ operationKey: `k${i}`, fullPrefix: p })),
    });
    const rows = await rowsFor();
    expect(rows.map((r: any) => r.status)).toEqual(['succeeded', 'succeeded', 'succeeded', 'succeeded', 'failed']);
    expect(rows.map((r: any) => r.verification_result)).toEqual(['confirmed', 'confirmed', 'confirmed', 'confirmed', 'mismatch']);
    expect(rows.every((r: any) => r.attempts === 1)).toBe(true);
    expect(out.summary.status).toBe('partial');
  });

  it("results are matched by operationKey, never by position: the right count under the wrong keys is an unknown outcome", async () => {
    const pushGroup: InjectedGroupPush = async (ops) => ops.map((o, i) => ({
      operationKey: `not-${i}`, success: true, message: 'ok', method: 'upload_token',
      verificationResult: 'confirmed', refusedBeforeWrite: false,
    }));
    const out = await runRateBatch({ db, push: confirms, pushGroup }, {
      jobId: JOB, operations: ['1', '2'].map(p => op({ operationKey: `k${p}`, fullPrefix: `2923${p}` })),
    });
    const rows = await rowsFor();
    expect(rows.map((r: any) => r.status)).toEqual(['indeterminate', 'indeterminate']);
    expect(rows[0].message).toMatch(/0 outcome\(s\) for 2 operation\(s\)/);
    expect(out.summary.status).toBe('needs_review');
  });

  it("a group left indeterminate marks every row indeterminate and the parent needs_review", async () => {
    const pushGroup: InjectedGroupPush = async (ops) => ops.map(o => ({
      operationKey: o.operationKey, success: false, message: 'read-back unavailable', method: 'upload_token',
      verificationResult: 'skip', refusedBeforeWrite: false,
    }));
    const out = await runRateBatch({ db, push: confirms, pushGroup }, {
      jobId: JOB, operations: ['1', '2'].map(p => op({ operationKey: `k${p}`, fullPrefix: `2923${p}` })),
    });
    const rows = await rowsFor();
    expect(rows.map((r: any) => r.status)).toEqual(['indeterminate', 'indeterminate']);
    expect(out.summary.status).toBe('needs_review');
    expect(out.tariffsNeedingReview).toEqual([66]);
  });
});
