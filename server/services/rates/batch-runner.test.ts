/**
 * DATABASE-BACKED, with the Sippy call injected.
 *
 * This is the whole batch path exercised end to end — preflight, lanes, persistence, execution,
 * verdicts, recovery — against real Postgres (PGlite) and migration 511 read off disk, with a fake
 * push in place of the switch. No network, no possibility of a production write from a test run.
 *
 * The properties asserted here are the ones the wiring is accountable for:
 *   - a deterministic refusal never reaches the push, and never cancels sound work beside it;
 *   - one tariff is never written concurrently;
 *   - an unknown outcome is not retried and stops only its own tariff;
 *   - every operation ends up on a durable row, and the parent status comes from those rows;
 *   - an interrupted run recovers to "needs review" rather than to "failed".
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runRateBatch, type RunnerOperation, type InjectedPush } from "./batch-runner";
import { reconcileInterruptedOperations, deriveJobStatus, getJobOperations } from "./operation-store";

let client: PGlite;
let db: ReturnType<typeof drizzle>;
const JOB = 'job-runner-1';

const op = (over: Partial<RunnerOperation> & Pick<RunnerOperation, 'operationKey'>): RunnerOperation => ({
  accountName: 'test-312', storedITariff: 65, resolvedITariff: 65,
  fullPrefix: '19370', rate: 0.133, rawIncrement: '60/1', ...over,
});

/** A push that confirms, as the primitive reports a verified write. */
const confirms: InjectedPush = async () => ({
  success: true, message: 'confirmed by read-back', method: 'upload_token', verificationResult: 'confirmed',
  refusedBeforeWrite: false,
});

const all = async (q: any) => { const r: any = await db.execute(q); return Array.isArray(r) ? r : (r.rows ?? []); };
const rowsFor = async (jobId = JOB) =>
  all(sql`SELECT operation_key, status, i_tariff, attempts, refused_before_write, message
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
  await client.exec(readFileSync(join(__dirname, '..', '..', '..', 'migrations', '511_rate_push_operations.sql'), 'utf8'));
  await client.exec(readFileSync(join(__dirname, '..', '..', '..', 'migrations', '512_operation_resolution.sql'), 'utf8'));
  await client.exec(readFileSync(join(__dirname, '..', '..', '..', 'migrations', '513_operation_trace.sql'), 'utf8'));
});
afterAll(async () => { await client?.close(); });
beforeEach(async () => {
  await client.exec(`DELETE FROM rate_push_operations; DELETE FROM rate_push_jobs;`);
  await db.execute(sql`INSERT INTO rate_push_jobs (job_id) VALUES (${JOB})`);
});

describe("deterministic refusals never reach the switch", () => {
  it("a misprovisioned account is refused without a push, and the rest still run", async () => {
    const push = vi.fn(confirms);
    const out = await runRateBatch({ db, push }, {
      jobId: JOB,
      operations: [
        op({ operationKey: 'good1', accountName: 'aura',       storedITariff: 66, resolvedITariff: 66, fullPrefix: '19232' }),
        op({ operationKey: 'bad',   accountName: 'pushtotalk', storedITariff: 33, resolvedITariff: 2,  fullPrefix: '79230' }),
        op({ operationKey: 'good2', accountName: 'test-312',   storedITariff: 65, resolvedITariff: 65, fullPrefix: '19370' }),
      ],
    });

    expect(push).toHaveBeenCalledTimes(2);
    // A set, not a sequence: these are different tariffs, so they are different lanes and may run
    // in either order. Ordering is only guaranteed WITHIN a lane, and that is asserted separately.
    expect(push.mock.calls.map(c => c[0].operationKey).sort()).toEqual(['good1', 'good2']);
    expect(out.ok).toBe(2);
    expect(out.total).toBe(3);
    expect(out.results.find(r => r.operationKey === 'bad')).toMatchObject({ success: false, verdict: 'refused' });
    expect(out.results.find(r => r.operationKey === 'bad')!.message).toContain('provisioned tariff is 33');
  });

  it("a refusal is persisted as not_attempted with the tariff provably untouched", async () => {
    await runRateBatch({ db, push: confirms }, {
      jobId: JOB, operations: [op({ operationKey: 'bad', resolvedITariff: null })],
    });
    const [row] = await rowsFor();
    expect(row.status).toBe('not_attempted');
    expect(row.refused_before_write).toBe(true);
    expect(row.message).toContain('unresolved_tariff');
  });

  it("results come back in submission order, refusals included", async () => {
    const out = await runRateBatch({ db, push: confirms }, {
      jobId: JOB,
      operations: [
        op({ operationKey: 'a', fullPrefix: '191' }),
        op({ operationKey: 'b', rawIncrement: 'per minute' }),
        op({ operationKey: 'c', fullPrefix: '193' }),
      ],
    });
    expect(out.results.map(r => r.operationKey)).toEqual(['a', 'b', 'c']);
    expect(out.results.map(r => r.success)).toEqual([true, false, true]);
  });
});

describe("ordering against the switch", () => {
  it("never writes one tariff concurrently, and does write different tariffs together", async () => {
    const inFlightByTariff = new Map<number, number>();
    let maxSameTariff = 0, maxOverall = 0, live = 0;
    const push: InjectedPush = async (o) => {
      live++; maxOverall = Math.max(maxOverall, live);
      const n = (inFlightByTariff.get(o.iTariff) ?? 0) + 1;
      inFlightByTariff.set(o.iTariff, n);
      maxSameTariff = Math.max(maxSameTariff, n);
      await new Promise(r => setTimeout(r, 3));
      inFlightByTariff.set(o.iTariff, n - 1); live--;
      return { success: true, message: 'ok', verificationResult: 'confirmed', refusedBeforeWrite: false };
    };

    await runRateBatch({ db, push }, {
      jobId: JOB, concurrency: 3,
      operations: [
        op({ operationKey: 'a1', storedITariff: 64, resolvedITariff: 64, fullPrefix: '191' }),
        op({ operationKey: 'a2', storedITariff: 64, resolvedITariff: 64, fullPrefix: '192' }),
        op({ operationKey: 'b1', storedITariff: 65, resolvedITariff: 65, fullPrefix: '191' }),
        op({ operationKey: 'b2', storedITariff: 65, resolvedITariff: 65, fullPrefix: '192' }),
        op({ operationKey: 'c1', storedITariff: 66, resolvedITariff: 66, fullPrefix: '191' }),
      ],
    });

    expect(maxSameTariff).toBe(1);
    expect(maxOverall).toBeGreaterThan(1);
  });

  it("the same prefix twice on one tariff is refused, not silently last-write-wins", async () => {
    const push = vi.fn(confirms);
    const out = await runRateBatch({ db, push }, {
      jobId: JOB,
      operations: [
        op({ operationKey: 'first',  fullPrefix: '19370', rate: 0.10 }),
        op({ operationKey: 'second', fullPrefix: '19370', rate: 0.12 }),
      ],
    });
    expect(push).toHaveBeenCalledTimes(1);
    expect(out.results.find(r => r.operationKey === 'second')).toMatchObject({ verdict: 'refused' });
  });
});

describe("an outcome nobody established", () => {
  it("is not retried, halts only its own tariff, and leaves the job needing review", async () => {
    const push = vi.fn<InjectedPush>(async (o) =>
      o.iTariff === 64
        ? { success: false, message: 'Tariff 64 is locked', verificationResult: 'skip', refusedBeforeWrite: false }
        : { success: true, message: 'ok', verificationResult: 'confirmed', refusedBeforeWrite: false });

    const out = await runRateBatch({ db, push }, {
      jobId: JOB, maxAttempts: 3,
      operations: [
        op({ operationKey: 'a1', storedITariff: 64, resolvedITariff: 64, fullPrefix: '191' }),
        op({ operationKey: 'a2', storedITariff: 64, resolvedITariff: 64, fullPrefix: '192' }),
        op({ operationKey: 'b1', storedITariff: 65, resolvedITariff: 65, fullPrefix: '191' }),
      ],
    });

    // One attempt only, despite maxAttempts: 3.
    expect(push.mock.calls.filter(c => c[0].operationKey === 'a1')).toHaveLength(1);
    expect(push.mock.calls.some(c => c[0].operationKey === 'a2')).toBe(false);

    const byKey = Object.fromEntries((await rowsFor()).map((r: any) => [r.operation_key, r.status]));
    expect(byKey).toMatchObject({ a1: 'indeterminate', a2: 'not_attempted', b1: 'succeeded' });
    expect(out.summary.status).toBe('needs_review');
    expect(out.tariffsNeedingReview).toEqual([64]);
    expect(out.haltedLanes).toEqual([{ iTariff: 64, atOperationKey: 'a1', remaining: 1 }]);
  });

  it("a proven non-write IS retried, up to maxAttempts, and does not halt the lane", async () => {
    const push = vi.fn<InjectedPush>(async () =>
      ({ success: false, message: 'tariff does not hold it', verificationResult: 'mismatch', refusedBeforeWrite: false }));

    await runRateBatch({ db, push }, {
      jobId: JOB, maxAttempts: 3,
      operations: [op({ operationKey: 'a', fullPrefix: '191' }), op({ operationKey: 'b', fullPrefix: '192' })],
    });

    expect(push.mock.calls.filter(c => c[0].operationKey === 'a')).toHaveLength(3);
    expect(push.mock.calls.filter(c => c[0].operationKey === 'b')).toHaveLength(3);
    const rows = await rowsFor();
    expect(rows.map((r: any) => r.status)).toEqual(['failed', 'failed']);
    expect(rows.map((r: any) => r.attempts)).toEqual([3, 3]);
  });

  it("a push that throws is indeterminate, never a failure", async () => {
    const out = await runRateBatch({ db, push: async () => { throw new Error('socket hang up'); } }, {
      jobId: JOB, maxAttempts: 3, operations: [op({ operationKey: 'a' })],
    });
    const [row] = await rowsFor();
    expect(row.status).toBe('indeterminate');
    expect(row.attempts).toBe(1);
    expect(out.summary.status).toBe('needs_review');
  });
});

describe("what the record says afterwards", () => {
  it("every submitted operation has a durable row before anything is attempted", async () => {
    let rowsAtFirstPush = 0;
    const push: InjectedPush = async () => {
      if (!rowsAtFirstPush) rowsAtFirstPush = (await rowsFor()).length;
      return { success: true, message: 'ok', verificationResult: 'confirmed', refusedBeforeWrite: false };
    };
    await runRateBatch({ db, push }, {
      jobId: JOB,
      operations: [op({ operationKey: 'a', fullPrefix: '191' }), op({ operationKey: 'b', fullPrefix: '192' }), op({ operationKey: 'c', resolvedITariff: null })],
    });
    expect(rowsAtFirstPush).toBe(3);
  });

  it("carries what was asked for onto the row, so it says more than pass or fail", async () => {
    await runRateBatch({ db, push: confirms }, {
      jobId: JOB, productName: 'First Class', trunkPrefix: '1',
      operations: [op({ operationKey: 'a', dialPrefix: '9370', destinationName: 'AFGHANISTAN - MOBILE AWCC', iAccount: 1066 })],
    });
    const [r] = await all(sql`SELECT * FROM rate_push_operations WHERE job_id = ${JOB}`);
    expect([r.product_name, r.trunk_prefix, r.dial_prefix, r.i_account]).toEqual(['First Class', '1', '9370', 1066]);
    expect([r.interval_1, r.interval_n]).toEqual([60, 1]);
    expect(Number(r.requested_rate)).toBe(0.133);
    expect([r.status, r.verification_result, r.push_method]).toEqual(['succeeded', 'confirmed', 'upload_token']);
  });

  it("the parent status is derived from the rows, matching a fresh read", async () => {
    const out = await runRateBatch({ db, push: confirms }, {
      jobId: JOB, operations: [op({ operationKey: 'a', fullPrefix: '191' }), op({ operationKey: 'b', resolvedITariff: null })],
    });
    expect(out.summary).toEqual(await deriveJobStatus(db, JOB));
    expect(out.summary.status).toBe('partial');
    expect(out.summary.counts).toMatchObject({ succeeded: 1, not_attempted: 1, total: 2 });
  });

  it("CONSERVATION: rows and reported lines both equal what was submitted", async () => {
    const operations = [
      op({ operationKey: 'a', fullPrefix: '191' }),
      op({ operationKey: 'b', resolvedITariff: null }),
      op({ operationKey: 'c', fullPrefix: '191' }),          // duplicate target of 'a'
      op({ operationKey: 'd', storedITariff: 66, resolvedITariff: 66, fullPrefix: '192' }),
    ];
    const out = await runRateBatch({ db, push: confirms }, { jobId: JOB, operations });
    expect(out.results).toHaveLength(operations.length);
    expect(await rowsFor()).toHaveLength(operations.length);
    expect(out.summary.counts.total).toBe(operations.length);
  });
});

describe("a run interrupted mid-flight", () => {
  it("recovers to needs_review rather than to failed, and never retries the unknown", async () => {
    // The push dies after the row is marked running — the shape a process restart leaves behind.
    const push: InjectedPush = async (o) => {
      if (o.operationKey === 'a1') throw Object.assign(new Error('process died'), { fatal: true });
      return { success: true, message: 'ok', verificationResult: 'confirmed', refusedBeforeWrite: false };
    };
    await runRateBatch({ db, push }, {
      jobId: JOB,
      operations: [
        op({ operationKey: 'a1', storedITariff: 64, resolvedITariff: 64, fullPrefix: '191' }),
        op({ operationKey: 'a2', storedITariff: 64, resolvedITariff: 64, fullPrefix: '192' }),
        op({ operationKey: 'b1', storedITariff: 65, resolvedITariff: 65, fullPrefix: '191' }),
      ],
    });

    // Recovery on a settled run finds nothing left in flight and changes nothing.
    const report = await reconcileInterruptedOperations(db, JOB);
    expect(report.reclassified).toEqual([]);
    expect(report.resumable).toBe(0);

    const summary = await deriveJobStatus(db, JOB);
    expect(summary.status).toBe('needs_review');
    expect(summary.tariffsNeedingReview).toEqual([64]);
  });

  it("a row left running by a crash is reclassified, not retried", async () => {
    // Simulates the process vanishing between markOperationRunning and the result being recorded.
    await db.execute(sql`INSERT INTO rate_push_jobs (job_id) VALUES ('job-crashed')`);
    await runRateBatch({ db, push: confirms }, {
      jobId: 'job-crashed',
      operations: [op({ operationKey: 'x1', storedITariff: 64, resolvedITariff: 64, fullPrefix: '191' })],
    });
    await db.execute(sql`UPDATE rate_push_operations SET status = 'running' WHERE job_id = 'job-crashed'`);

    const report = await reconcileInterruptedOperations(db, 'job-crashed');
    expect(report.reclassified).toEqual([{ operationKey: 'x1', iTariff: 64 }]);
    expect((await deriveJobStatus(db, 'job-crashed')).status).toBe('needs_review');
  });
});

describe("the push explains itself from the record", () => {
  // Jobs #44-#47 each held the answer for ~50 seconds and threw it away: the console had the token
  // result, the upload response and the final status, while the durable record kept only the
  // portal's closing message. Four production pushes produced no diagnosis. This is that fixed.
  const TRACE = [
    '+0ms getUploadToken HTTP 200 body=<methodResponse>…',
    '+412ms token=abc-123 url=https://switch/upload/abc-123',
    '+1180ms file upload success=true bytes=7201 body=OK',
    '+1181ms getUploadStatus did not answer on poll#1 — skipped the loop, verifying the tariff directly',
    '+9400ms verification after FILE_UPLOADED: confirmed=false — prefix 19370 not found in tariff 65',
  ];

  it("persists the trace on a FAILED operation — especially on a failed one", async () => {
    const push: InjectedPush = async () => ({
      success: false, message: 'Portal CSV: Rate add refused…', verificationResult: 'skip',
      refusedBeforeWrite: false, trace: TRACE,
    });
    await runRateBatch({ db, push }, { jobId: JOB, operations: [op({ operationKey: 'a' })] });

    const [row] = await all(sql`SELECT status, trace FROM rate_push_operations WHERE job_id = ${JOB}`);
    expect(row.status).toBe('indeterminate');
    const stored = Array.isArray(row.trace) ? row.trace : JSON.parse(String(row.trace));
    expect(stored).toEqual(TRACE);
    // The specific thing the investigation could not answer for four jobs.
    expect(stored.join('\n')).toContain('file upload success=true');
  });

  it("exposes it through the reader, in order, oldest first", async () => {
    const push: InjectedPush = async () => ({
      success: true, message: 'confirmed', verificationResult: 'confirmed', refusedBeforeWrite: false, trace: TRACE,
    });
    await runRateBatch({ db, push }, { jobId: JOB, operations: [op({ operationKey: 'a' })] });
    const [o] = (await getJobOperations(db, JOB)).operations;
    expect(o.trace).toEqual(TRACE);
    expect(o.trace![0]).toContain('getUploadToken');
  });

  it("a push that THROWS still records the trace the adapter attached to the error", async () => {
    // The adapter attaches its trace to the thrown error precisely so this path is not blind.
    const push: InjectedPush = async () => {
      throw Object.assign(new Error('socket hang up'), { trace: TRACE.slice(0, 3) });
    };
    await runRateBatch({ db, push }, { jobId: JOB, operations: [op({ operationKey: 'a' })] });
    const [o] = (await getJobOperations(db, JOB)).operations;
    expect(o.status).toBe('indeterminate');
    expect(o.trace).toEqual(TRACE.slice(0, 3));
  });

  it("null trace and empty trace are different — a row that recorded nothing must not look like one that ran before the column", async () => {
    const push: InjectedPush = async () => ({ success: true, message: 'ok', verificationResult: 'confirmed', refusedBeforeWrite: false, trace: [] });
    await runRateBatch({ db, push }, { jobId: JOB, operations: [op({ operationKey: 'a' })] });
    expect((await getJobOperations(db, JOB)).operations[0].trace).toBeNull();
  });
});
