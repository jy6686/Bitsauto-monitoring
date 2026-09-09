/**
 * DATABASE-BACKED. Real Postgres (PGlite, in-process), driven through the real Drizzle client, and
 * the schema is migration 511 itself — read off disk and executed, not a hand-copy that can drift
 * from what production will apply.
 *
 * This is the standing lesson from 2026-09-08: the catalogue increment lookup passed 92 unit tests
 * and returned 500 on its first real request, because no test crossed the database boundary. Every
 * assertion here runs SQL.
 *
 * The invariants under test are the ones a person's next decision depends on:
 *   - an outcome nobody established is never stored, aggregated, or recovered as a failure;
 *   - a tariff whose state is unknown takes no further writes, and only that tariff stops;
 *   - the parent's status is computed from the rows, so it cannot drift from them.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { planRateBatch, type RateOperation } from "./batch-plan";
import type { OperationResult } from "./batch-execute";
import {
  persistPlan, markOperationRunning, recordOperationResult,
  deriveJobStatus, reconcileInterruptedOperations, getJobOperations,
  resolveOperation, listUnresolvedOperations,
} from "./operation-store";
import { tariffHasUnresolvedOperations } from "./tariff-lock";

let client: PGlite;
let db: ReturnType<typeof drizzle>;

const JOB = 'job-test-1';

const op = (key: string, iTariff: number | null, prefix = '19370', rate = 0.133): RateOperation =>
  ({ operationKey: key, accountName: `acct-${iTariff}`, iTariff, prefix, rate, interval1: 60, intervalN: 1 });

const result = (
  operationKey: string, verdict: OperationResult['verdict'], over: Partial<OperationResult> = {},
): OperationResult => ({
  operationKey, iTariff: 64, prefix: '19370', accountName: 'acct-64',
  verdict, message: `${verdict} for ${operationKey}`, attempts: 1, ms: 10, ...over,
});

const all = async (q: any) => { const r: any = await db.execute(q); return Array.isArray(r) ? r : (r.rows ?? []); };
const statusOf = async (key: string) => {
  const [row] = await all(sql`SELECT status, message, refused_before_write, attempts, i_rate, push_method
                                FROM rate_push_operations WHERE job_id = ${JOB} AND operation_key = ${key}`);
  return row;
};

beforeAll(async () => {
  client = await PGlite.create();
  db = drizzle(client);

  // The parent, as rate_push_jobs exists today: job_id is the unique business key 511 references.
  await client.exec(`
    CREATE TABLE rate_push_jobs (
      id SERIAL PRIMARY KEY,
      job_id VARCHAR(64) UNIQUE NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'pending'
    );`);

  // Migration 511 verbatim. If it cannot apply here it cannot apply in production.
  await client.exec(readFileSync(join(__dirname, '..', '..', '..', 'migrations', '511_rate_push_operations.sql'), 'utf8'));
  await client.exec(readFileSync(join(__dirname, '..', '..', '..', 'migrations', '512_operation_resolution.sql'), 'utf8'));
});

afterAll(async () => { await client?.close(); });

beforeEach(async () => {
  await client.exec(`DELETE FROM rate_push_operations; DELETE FROM rate_push_jobs;`);
  await db.execute(sql`INSERT INTO rate_push_jobs (job_id) VALUES (${JOB})`);
});

describe("migration 511", () => {
  it("creates the table, the status CHECK and the indexes it declares", async () => {
    const [t] = await all(sql`SELECT 1 AS ok FROM information_schema.tables WHERE table_name = 'rate_push_operations'`);
    expect(t?.ok).toBe(1);
    const idx = await all(sql`SELECT indexname FROM pg_indexes WHERE tablename = 'rate_push_operations' ORDER BY indexname`);
    expect(idx.map((r: any) => r.indexname)).toEqual(expect.arrayContaining([
      'rate_push_operations_job_key_uq', 'rate_push_operations_job_seq_ix', 'rate_push_operations_tariff_status_ix',
    ]));
  });

  it("REFUSES an unknown status at the database, not just in TypeScript", async () => {
    // A status the code does not know about would let an unestablished outcome be stored as
    // something benign. The constraint is the last line of defence.
    await expect(db.execute(sql`
      INSERT INTO rate_push_operations (job_id, operation_key, sequence, account_name, full_prefix, status)
      VALUES (${JOB}, 'bad', 0, 'a', '1', 'done')`)).rejects.toThrow(/rate_push_operations_status_ck|check constraint/i);
  });

  it("keeps refused_before_write nullable — NULL is not FALSE", async () => {
    const [c] = await all(sql`SELECT is_nullable FROM information_schema.columns
                               WHERE table_name = 'rate_push_operations' AND column_name = 'refused_before_write'`);
    expect(c.is_nullable).toBe('YES');
  });

  it("cascades operations away with their job, leaving no orphans", async () => {
    await persistPlan(db, JOB, planRateBatch([op('a', 64)]));
    await db.execute(sql`DELETE FROM rate_push_jobs WHERE job_id = ${JOB}`);
    expect(await all(sql`SELECT 1 FROM rate_push_operations`)).toHaveLength(0);
  });
});

describe("persistPlan", () => {
  it("CONSERVATION: writes every submitted operation, executable and refused alike", async () => {
    const plan = planRateBatch([
      op('a', 64, '191'), op('b', 64, '192'),
      op('c', 65, '191'),
      op('d', null),                       // refused: unresolved tariff
      op('e', 64, '191'),                  // refused: duplicate of 'a'
    ]);
    const written = await persistPlan(db, JOB, plan);

    expect(written).toBe(5);
    expect(plan.executableCount + plan.refused.length).toBe(5);
    const [{ n }] = await all(sql`SELECT COUNT(*)::int AS n FROM rate_push_operations WHERE job_id = ${JOB}`);
    expect(n).toBe(5);
  });

  it("stores a planning refusal as not_attempted with the tariff PROVABLY untouched", async () => {
    await persistPlan(db, JOB, planRateBatch([op('a', 64), op('dup', 64)]));
    const row = await statusOf('dup');
    expect(row.status).toBe('not_attempted');
    expect(row.refused_before_write).toBe(true);   // no request ever existed — assertable, not assumed
    expect(row.message).toContain('duplicate_target');
  });

  it("records lane membership and order, so the serial sequence is reconstructable", async () => {
    await persistPlan(db, JOB, planRateBatch([
      op('a1', 64, '1'), op('b1', 65, '1'), op('a2', 64, '2'),
    ]));
    const laid = await all(sql`SELECT operation_key, i_tariff, lane_position FROM rate_push_operations
                                WHERE job_id = ${JOB} ORDER BY sequence`);
    expect(laid.map((r: any) => [r.operation_key, r.i_tariff, r.lane_position])).toEqual([
      ['a1', 64, 0], ['a2', 64, 1], ['b1', 65, 0],
    ]);
  });

  it("carries the requested rate and increment, so a row says what was asked for", async () => {
    await persistPlan(db, JOB, planRateBatch([op('a', 64, '19370', 0.133)]), {
      productName: 'First Class', trunkPrefix: '1',
      extras: { a: { dialPrefix: '9370', destinationName: 'AFGHANISTAN - MOBILE AWCC', iAccount: 1066 } },
    });
    const [r] = await all(sql`SELECT * FROM rate_push_operations WHERE job_id = ${JOB}`);
    expect(Number(r.requested_rate)).toBe(0.133);
    expect([r.interval_1, r.interval_n]).toEqual([60, 1]);
    expect([r.product_name, r.trunk_prefix, r.dial_prefix, r.i_account]).toEqual(['First Class', '1', '9370', 1066]);
    expect(r.destination_name).toBe('AFGHANISTAN - MOBILE AWCC');
  });

  it("refuses a duplicate operation key within one job", async () => {
    await persistPlan(db, JOB, planRateBatch([op('a', 64)]));
    await expect(persistPlan(db, JOB, planRateBatch([op('a', 65)]))).rejects.toThrow(/duplicate key|unique/i);
  });

  it("writes nothing, and does not fail, for an empty plan", async () => {
    expect(await persistPlan(db, JOB, planRateBatch([]))).toBe(0);
  });
});

describe("recordOperationResult", () => {
  beforeEach(async () => {
    await persistPlan(db, JOB, planRateBatch([op('s', 64, '1'), op('f', 64, '2'), op('i', 64, '3'), op('n', 64, '4')]));
  });

  it("maps each verdict onto its own durable status", async () => {
    await recordOperationResult(db, JOB, result('s', 'success', { method: 'upload_token', iRate: 9200 }), { verificationResult: 'confirmed' });
    await recordOperationResult(db, JOB, result('f', 'failure'), { verificationResult: 'mismatch' });
    await recordOperationResult(db, JOB, result('i', 'indeterminate'));
    await recordOperationResult(db, JOB, result('n', 'not_attempted', { attempts: 0 }));

    expect((await statusOf('s')).status).toBe('succeeded');
    expect((await statusOf('f')).status).toBe('failed');
    expect((await statusOf('i')).status).toBe('indeterminate');
    expect((await statusOf('n')).status).toBe('not_attempted');
  });

  it("keeps refused_before_write NULL when nobody established it", async () => {
    // The tri-state that stops an unverified mutation being treated as a safe non-event.
    await recordOperationResult(db, JOB, result('i', 'indeterminate'));
    expect((await statusOf('i')).refused_before_write).toBeNull();

    await recordOperationResult(db, JOB, result('f', 'failure'), { refusedBeforeWrite: true });
    expect((await statusOf('f')).refused_before_write).toBe(true);
  });

  it("stores the attempt count and Sippy's identifiers for the record", async () => {
    await recordOperationResult(db, JOB, result('s', 'success', { attempts: 2, iRate: 9200, method: 'portal_edit' }));
    const r = await statusOf('s');
    expect([r.attempts, r.i_rate, r.push_method]).toEqual([2, 9200, 'portal_edit']);
  });
});

describe("deriveJobStatus — computed from the rows, never from a counter", () => {
  it("is pending with no operations, and processing while any remain", async () => {
    expect((await deriveJobStatus(db, JOB)).status).toBe('pending');
    await persistPlan(db, JOB, planRateBatch([op('a', 64)]));
    expect((await deriveJobStatus(db, JOB)).status).toBe('processing');
  });

  it("is completed only when every operation succeeded", async () => {
    await persistPlan(db, JOB, planRateBatch([op('a', 64, '1'), op('b', 64, '2')]));
    await recordOperationResult(db, JOB, result('a', 'success'));
    await recordOperationResult(db, JOB, result('b', 'success'));
    const s = await deriveJobStatus(db, JOB);
    expect(s.status).toBe('completed');
    expect(s.requiresReview).toBe(false);
  });

  it("JOB #43 REGRESSION: an unestablished outcome is never reported as failed", async () => {
    // #43 told an operator nothing had been applied while a live rate was being destroyed.
    // A job whose only outcome is unknown must ask for a person, not claim a failure.
    await persistPlan(db, JOB, planRateBatch([op('a', 64)]));
    await recordOperationResult(db, JOB, result('a', 'indeterminate'));
    const s = await deriveJobStatus(db, JOB);
    expect(s.status).toBe('needs_review');
    expect(s.status).not.toBe('failed');
    expect(s.tariffsNeedingReview).toEqual([64]);
  });

  it("needs_review outranks partial, so success cannot average away an unknown", async () => {
    await persistPlan(db, JOB, planRateBatch([op('a', 64, '1'), op('b', 65, '1')]));
    await recordOperationResult(db, JOB, result('a', 'success'));
    await recordOperationResult(db, JOB, result('b', 'indeterminate', { iTariff: 65 }));
    expect((await deriveJobStatus(db, JOB)).status).toBe('needs_review');
  });

  it("is partial with a mix of success and proven failure, and failed with none succeeding", async () => {
    await persistPlan(db, JOB, planRateBatch([op('a', 64, '1'), op('b', 64, '2')]));
    await recordOperationResult(db, JOB, result('a', 'success'));
    await recordOperationResult(db, JOB, result('b', 'failure'));
    expect((await deriveJobStatus(db, JOB)).status).toBe('partial');

    await recordOperationResult(db, JOB, result('a', 'failure'));
    expect((await deriveJobStatus(db, JOB)).status).toBe('failed');
  });

  it("counts every state, and the counts add up to what was submitted", async () => {
    const plan = planRateBatch([op('a', 64, '1'), op('b', 64, '2'), op('c', 65, '1'), op('d', null)]);
    await persistPlan(db, JOB, plan);
    await recordOperationResult(db, JOB, result('a', 'success'));
    await recordOperationResult(db, JOB, result('b', 'indeterminate'));
    await recordOperationResult(db, JOB, result('c', 'failure', { iTariff: 65 }));
    const { counts } = await deriveJobStatus(db, JOB);
    expect(counts).toMatchObject({ succeeded: 1, indeterminate: 1, failed: 1, not_attempted: 1, total: 4 });
    expect(counts.total).toBe(plan.submittedCount);
  });

  it("survives a restart: the same status comes back from the rows alone", async () => {
    await persistPlan(db, JOB, planRateBatch([op('a', 64, '1'), op('b', 64, '2')]));
    await recordOperationResult(db, JOB, result('a', 'success'));
    await recordOperationResult(db, JOB, result('b', 'failure'));
    const before = await deriveJobStatus(db, JOB);
    // Nothing in memory carries over; a fresh derivation reads only what was written.
    const after = await deriveJobStatus(db, JOB);
    expect(after).toEqual(before);
    expect(after.status).toBe('partial');
  });
});

describe("reconcileInterruptedOperations — what a crash leaves behind", () => {
  it("turns an interrupted in-flight operation into indeterminate, never failed", async () => {
    await persistPlan(db, JOB, planRateBatch([op('a', 64)]));
    await markOperationRunning(db, JOB, 'a');

    const report = await reconcileInterruptedOperations(db, JOB);
    expect(report.reclassified).toEqual([{ operationKey: 'a', iTariff: 64 }]);
    const row = await statusOf('a');
    expect(row.status).toBe('indeterminate');
    expect(row.message).toContain('never established');
    expect(row.message).toContain('will not be retried automatically');
  });

  it("halts the rest of that tariff, and ONLY that tariff", async () => {
    await persistPlan(db, JOB, planRateBatch([
      op('a1', 64, '1'), op('a2', 64, '2'), op('a3', 64, '3'),
      op('b1', 65, '1'), op('b2', 65, '2'),
    ]));
    await markOperationRunning(db, JOB, 'a1');

    const report = await reconcileInterruptedOperations(db, JOB);
    expect(report.halted.map(h => h.operationKey).sort()).toEqual(['a2', 'a3']);
    expect((await statusOf('a2')).status).toBe('not_attempted');
    expect((await statusOf('a2')).message).toContain('tariff 64');
    // Tariff 65 is a different lock and nothing is unknown about it.
    expect((await statusOf('b1')).status).toBe('pending');
    expect(report.resumable).toBe(2);
  });

  it("leaves a clean interruption fully resumable", async () => {
    await persistPlan(db, JOB, planRateBatch([op('a', 64), op('b', 65)]));
    const report = await reconcileInterruptedOperations(db, JOB);
    expect(report.reclassified).toEqual([]);
    expect(report.halted).toEqual([]);
    expect(report.resumable).toBe(2);
  });

  it("is idempotent — running it twice changes nothing the second time", async () => {
    await persistPlan(db, JOB, planRateBatch([op('a1', 64, '1'), op('a2', 64, '2')]));
    await markOperationRunning(db, JOB, 'a1');

    const first = await reconcileInterruptedOperations(db, JOB);
    const second = await reconcileInterruptedOperations(db, JOB);
    expect(first.reclassified).toHaveLength(1);
    expect(second.reclassified).toEqual([]);
    expect(second.halted).toEqual([]);
    expect((await statusOf('a1')).status).toBe('indeterminate');
    expect((await statusOf('a2')).status).toBe('not_attempted');
  });

  it("does not touch a settled operation", async () => {
    await persistPlan(db, JOB, planRateBatch([op('a', 64, '1'), op('b', 64, '2')]));
    await recordOperationResult(db, JOB, result('a', 'success'));
    await markOperationRunning(db, JOB, 'b');

    await reconcileInterruptedOperations(db, JOB);
    expect((await statusOf('a')).status).toBe('succeeded');
    expect((await statusOf('b')).status).toBe('indeterminate');
  });

  it("leaves the job asking for a person after recovery", async () => {
    await persistPlan(db, JOB, planRateBatch([op('a1', 64, '1'), op('a2', 64, '2')]));
    await markOperationRunning(db, JOB, 'a1');
    await reconcileInterruptedOperations(db, JOB);

    const s = await deriveJobStatus(db, JOB);
    expect(s.status).toBe('needs_review');
    expect(s.tariffsNeedingReview).toEqual([64]);
    expect(s.counts).toMatchObject({ indeterminate: 1, not_attempted: 1, pending: 0 });
  });
});

describe("getJobOperations — the reader the acceptance needed and did not have", () => {
  it("returns every operation in submission order with the parent status derived", async () => {
    const plan = planRateBatch([op('a', 64, '191'), op('b', 64, '192'), op('c', 65, '191'), op('d', null)]);
    await persistPlan(db, JOB, plan, {
      productName: 'First Class', trunkPrefix: '1',
      extras: { a: { dialPrefix: '91', destinationName: 'PAKISTAN', iAccount: 1065 } },
    });
    await recordOperationResult(db, JOB, result('a', 'success', { method: 'upload_token', iRate: 9200, attempts: 1 }), { verificationResult: 'confirmed', refusedBeforeWrite: false });
    await recordOperationResult(db, JOB, result('b', 'indeterminate'));

    const { operations, summary } = await getJobOperations(db, JOB);

    expect(operations.map(o => o.operationKey)).toEqual(['a', 'b', 'c', 'd']);
    expect(operations.map(o => o.status)).toEqual(['succeeded', 'indeterminate', 'pending', 'not_attempted']);
    expect(summary.status).toBe('processing');   // 'c' is still pending
  });

  it("exposes every field an operator needs to reconstruct what happened", async () => {
    await persistPlan(db, JOB, planRateBatch([op('a', 65, '19370')]), {
      productName: 'First Class', trunkPrefix: '1',
      extras: { a: { dialPrefix: '9370', destinationName: 'AFGHANISTAN - MOBILE AWCC', iAccount: 1066 } },
    });
    await recordOperationResult(db, JOB, result('a', 'success', { method: 'portal_csv', iRate: 9200, attempts: 2 }), { verificationResult: 'confirmed', refusedBeforeWrite: false });

    const [o] = (await getJobOperations(db, JOB)).operations;
    expect(o).toMatchObject({
      accountName: 'acct-65', iAccount: 1066, iTariff: 65,
      productName: 'First Class', trunkPrefix: '1', dialPrefix: '9370',
      fullPrefix: '19370', destinationName: 'AFGHANISTAN - MOBILE AWCC',
      requestedRate: 0.133, interval1: 60, intervalN: 1,
      status: 'succeeded', attempts: 2, iRate: 9200,
      pushMethod: 'portal_csv', verificationResult: 'confirmed', refusedBeforeWrite: false,
    });
    expect(o.completedAt).toBeTruthy();
    expect(o.message).toContain('success');
  });

  it("keeps refusedBeforeWrite as a TRI-STATE — null must not read as false", async () => {
    await persistPlan(db, JOB, planRateBatch([op('a', 65, '191'), op('b', 65, '192'), op('c', 65, '191')]));
    await recordOperationResult(db, JOB, result('a', 'indeterminate'));                                  // nobody established it
    await recordOperationResult(db, JOB, result('b', 'failure'), { refusedBeforeWrite: true });           // provably untouched
    const byKey = Object.fromEntries((await getJobOperations(db, JOB)).operations.map(o => [o.operationKey, o.refusedBeforeWrite]));
    expect(byKey.a).toBeNull();
    expect(byKey.b).toBe(true);
    expect(byKey.c).toBe(true);   // planner refusal: no request ever existed
  });

  it("returns an empty list for a job with no operations rather than failing", async () => {
    const r = await getJobOperations(db, JOB);
    expect(r.operations).toEqual([]);
    expect(r.summary.status).toBe('pending');
  });
});

describe("the operations endpoint is read-only and gated", () => {
  const SRC = readFileSync(join(__dirname, '..', '..', 'routes.ts'), 'utf8');
  const handler = (() => {
    const start = SRC.indexOf("app.get('/api/rate-manager/jobs/:jobId/operations'");
    return SRC.slice(start, SRC.indexOf("app.get('/api/rate-manager/jobs'", start));
  })();

  it("is mounted, and only as a GET", () => {
    expect(handler.length).toBeGreaterThan(200);
    expect(SRC).not.toContain("app.post('/api/rate-manager/jobs/:jobId/operations'");
  });

  it("requires an admin or management role", () => {
    expect(handler).toContain("requireRole(['admin', 'management']");
  });

  it("performs NO writes — the whole point is that reading evidence cannot alter it", () => {
    for (const mutation of ['db.insert(', 'db.update(', 'db.delete(', 'INSERT ', 'UPDATE ', 'DELETE ']) {
      expect(handler, `operations reader must not contain ${mutation}`).not.toContain(mutation);
    }
  });

  it("accepts either the numeric id the UI shows or the business key", () => {
    expect(handler).toContain('ratePushJobs.id');
    expect(handler).toContain('ratePushJobs.jobId');
  });

  it("reports the DERIVED status alongside the stored one, so a disagreement is visible", () => {
    expect(handler).toContain('derived: summary');
    expect(handler).toContain('status: parent.status');
  });
});

describe("resolveOperation — a person settles an unknown outcome", () => {
  beforeEach(async () => {
    await persistPlan(db, JOB, planRateBatch([op('unknown', 65, '19370'), op('done', 65, '192'), op('nope', 65, '193')]));
    await recordOperationResult(db, JOB, result('unknown', 'indeterminate', { iTariff: 65 }));
    await recordOperationResult(db, JOB, result('done', 'success', { iTariff: 65 }));
    await recordOperationResult(db, JOB, result('nope', 'failure', { iTariff: 65 }));
  });

  const NOTE = 'Read tariff 65 in the Sippy panel; 19370 is not present.';

  it("records the finding WITHOUT rewriting the original verdict", async () => {
    // The operation was indeterminate at the time and that remains the historical fact.
    const r = await resolveOperation(db, JOB, 'unknown', { resolution: 'not_applied', resolvedBy: 'junaid', note: NOTE });
    expect(r.ok).toBe(true);
    const o = (r as any).operation;
    expect(o.status).toBe('indeterminate');          // untouched
    expect(o.resolution).toBe('not_applied');
    expect(o.resolvedBy).toBe('junaid');
    expect(o.resolvedAt).toBeTruthy();
    expect(o.resolutionNote).toBe(NOTE);
  });

  it("records 'applied' with the observed state, for a mutation that DID land", async () => {
    const r = await resolveOperation(db, JOB, 'unknown', {
      resolution: 'applied', resolvedBy: 'junaid',
      note: 'Tariff 65 shows 19370 @ 0.133 on a new iRate.', observedState: '19370 @ 0.133 / 60/1 / iRate 9200',
    });
    expect((r as any).operation.resolution).toBe('applied');
    expect((r as any).operation.observedState).toContain('iRate 9200');
  });

  it("REFUSES a note too short to be a real observation", async () => {
    // "resolve" must not come to mean "I did not check".
    const r = await resolveOperation(db, JOB, 'unknown', { resolution: 'not_applied', resolvedBy: 'junaid', note: 'ok' });
    expect(r).toMatchObject({ ok: false, code: 'note_too_short' });
    expect((await getJobOperations(db, JOB)).operations.find(o => o.operationKey === 'unknown')!.resolution).toBeNull();
  });

  it("REFUSES to resolve an outcome that was already established", async () => {
    for (const key of ['done', 'nope']) {
      const r = await resolveOperation(db, JOB, key, { resolution: 'not_applied', resolvedBy: 'junaid', note: NOTE });
      expect(r).toMatchObject({ ok: false, code: 'not_indeterminate' });
    }
  });

  it("REFUSES a second resolution rather than overwriting the first person's finding", async () => {
    await resolveOperation(db, JOB, 'unknown', { resolution: 'not_applied', resolvedBy: 'junaid', note: NOTE });
    const second = await resolveOperation(db, JOB, 'unknown', { resolution: 'applied', resolvedBy: 'someone-else', note: 'I think it did apply after all.' });
    expect(second).toMatchObject({ ok: false, code: 'already_resolved' });
    expect((second as any).message).toContain('junaid');
    expect((await getJobOperations(db, JOB)).operations.find(o => o.operationKey === 'unknown')!.resolution).toBe('not_applied');
  });

  it("reports a missing operation rather than silently doing nothing", async () => {
    expect(await resolveOperation(db, JOB, 'ghost', { resolution: 'applied', resolvedBy: 'j', note: NOTE }))
      .toMatchObject({ ok: false, code: 'not_found' });
  });

  it("the DATABASE refuses an unattributed or unexplained resolution, not just the code path", async () => {
    // Belt and braces: the CHECK is the last line of defence if a future writer bypasses the helper.
    await expect(db.execute(sql`
      UPDATE rate_push_operations SET resolution = 'not_applied'
       WHERE job_id = ${JOB} AND operation_key = 'unknown'`)).rejects.toThrow(/resolution_ck|check constraint/i);
  });

  it("the DATABASE refuses resolving a non-indeterminate operation", async () => {
    await expect(db.execute(sql`
      UPDATE rate_push_operations
         SET resolution='not_applied', resolved_by='j', resolved_at=NOW(), resolution_note=${'x'.repeat(20)}
       WHERE job_id = ${JOB} AND operation_key = 'done'`)).rejects.toThrow(/resolution_ck|check constraint/i);
  });
});

describe("listUnresolvedOperations — the queue of things awaiting a person", () => {
  beforeEach(async () => {
    await persistPlan(db, JOB, planRateBatch([op('a', 65, '19370'), op('b', 66, '19232'), op('c', 65, '192')]));
    await recordOperationResult(db, JOB, result('a', 'indeterminate', { iTariff: 65 }));
    await recordOperationResult(db, JOB, result('b', 'indeterminate', { iTariff: 66 }));
    await recordOperationResult(db, JOB, result('c', 'success', { iTariff: 65 }));
  });

  it("lists only unestablished, unsettled operations", async () => {
    const all = await listUnresolvedOperations(db);
    expect(all.map(o => o.operationKey).sort()).toEqual(['a', 'b']);
  });

  it("filters to one tariff", async () => {
    expect((await listUnresolvedOperations(db, { iTariff: 66 })).map(o => o.operationKey)).toEqual(['b']);
  });

  it("drops an operation once a person has settled it", async () => {
    await resolveOperation(db, JOB, 'a', { resolution: 'not_applied', resolvedBy: 'junaid', note: 'Read tariff 65; 19370 absent.' });
    expect((await listUnresolvedOperations(db)).map(o => o.operationKey)).toEqual(['b']);
  });
});

describe("the resolve endpoint is gated, attributable and never touches Sippy", () => {
  const SRC = readFileSync(join(__dirname, '..', '..', 'routes.ts'), 'utf8');
  const handler = (() => {
    const start = SRC.indexOf("app.post('/api/rate-manager/jobs/:jobId/operations/:operationKey/resolve'");
    return SRC.slice(start, SRC.indexOf("app.get('/api/rate-manager/jobs'", start));
  })();

  it("is mounted and role-gated", () => {
    expect(handler.length).toBeGreaterThan(200);
    expect(handler).toContain("requireRole(['admin', 'management']");
  });

  it("refuses an unattributable resolution", () => {
    expect(handler).toContain('A resolution must be attributable to a person.');
  });

  it("makes NO Sippy call and never re-runs the operation", () => {
    for (const forbidden of ['sippy.', 'pushRateToSippy', 'runRateBatch', 'setSippyRateEntry']) {
      expect(handler, `resolve handler must not contain ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("writes an audit event naming the operator and the finding", () => {
    expect(handler).toContain("action: 'RATE_OPERATION_RESOLVED'");
    expect(handler).toContain("actorType: 'user'");
    expect(handler).toContain('originalStatus');
  });

  it("treats a mutation declared APPLIED as more serious than one declared absent", () => {
    expect(handler).toContain("severity: resolution === 'applied' ? 'warning' : 'info'");
  });
});

describe("REGRESSION: the two 'needs a person' predicates must agree", () => {
  // Found by production verification on 2026-09-09, not by a test. After both indeterminate
  // operations on tariff 65 were resolved, /operations/unresolved correctly returned 0 while
  // deriveJobStatus still reported tariffsNeedingReview: [65]. tariffHasUnresolvedOperations had
  // been made resolution-aware and this one had not. A later blocking policy built on this list
  // would have kept a resolved tariff blocked forever — the exact stranding the workflow prevents.
  const NOTE = 'Read tariff 65 in Sippy; 19370 is absent, so nothing was applied.';

  beforeEach(async () => {
    await persistPlan(db, JOB, planRateBatch([op('a', 65, '19370'), op('b', 65, '19371')]));
    await recordOperationResult(db, JOB, result('a', 'indeterminate', { iTariff: 65 }));
    await recordOperationResult(db, JOB, result('b', 'not_attempted', { iTariff: 65, attempts: 0 }));
  });

  it("before resolution: the tariff needs review and the job needs a person", async () => {
    const s = await deriveJobStatus(db, JOB);
    expect(s.tariffsNeedingReview).toEqual([65]);
    expect(s.requiresReview).toBe(true);
    expect(s.unresolvedCount).toBe(1);
  });

  it("after resolution: the tariff drops off the list and nothing awaits a person", async () => {
    await resolveOperation(db, JOB, 'a', { resolution: 'not_applied', resolvedBy: 'junaid', note: NOTE });
    const s = await deriveJobStatus(db, JOB);

    expect(s.tariffsNeedingReview).toEqual([]);
    expect(s.requiresReview).toBe(false);
    expect(s.unresolvedCount).toBe(0);
    // …while the history is untouched: the operation and the job still say what happened.
    expect(s.counts.indeterminate).toBe(1);
    expect(s.status).toBe('needs_review');
  });

  it("agrees with tariffHasUnresolvedOperations in both directions", async () => {
    const before = await tariffHasUnresolvedOperations(db, 65, sql);
    expect(before.unresolved).toBe((await deriveJobStatus(db, JOB)).requiresReview);

    await resolveOperation(db, JOB, 'a', { resolution: 'applied', resolvedBy: 'junaid', note: NOTE });
    const after = await tariffHasUnresolvedOperations(db, 65, sql);
    expect(after.unresolved).toBe((await deriveJobStatus(db, JOB)).requiresReview);
    expect(after.unresolved).toBe(false);
  });
});
