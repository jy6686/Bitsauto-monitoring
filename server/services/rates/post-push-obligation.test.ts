/**
 * Durable post-push obligations, against real Postgres.
 *
 * THE TWO CRITICAL CASES ARE THE POINT OF THIS FILE:
 *
 *   1. A push certifies and the process dies before recording what it owes. Recovery must find
 *      it and record it, without announcing anything twice.
 *   2. The same completion is processed twice. Exactly one obligation must exist.
 *
 * Both have the same answer, and that is deliberate: idempotence is structural, so neither case
 * depends on anything being remembered between attempts.
 *
 * Nothing here sends. This module has no transport.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createObligationsForPush, findPushesMissingObligations, loadOperationsForPush,
  recoverMissingObligations, pendingRateNotifications,
} from "./post-push-obligation";
import type { AppliedOperation } from "./post-push-notification";

let client: PGlite;
let db: any;

const JOB = 'job-001';
const all = async (q: any) => { const r: any = await db.execute(q); return Array.isArray(r) ? r : (r.rows ?? []); };

const op = (o: Partial<AppliedOperation> = {}): AppliedOperation => ({
  accountName: 'ACME', productName: 'FC', trunkPrefix: '1',
  dialPrefix: '9230', fullPrefix: '19230', destinationName: 'PAKISTAN - MOBILE JAZZ',
  requestedRate: 0.045, status: 'succeeded', refusedBeforeWrite: false, ...o,
});

/** Write operation records exactly as a real push would, so recovery has something to find. */
const persistOps = async (jobId: string, ops: AppliedOperation[]) => {
  await db.execute(sql`INSERT INTO rate_push_jobs (job_id) VALUES (${jobId}) ON CONFLICT DO NOTHING`);
  let seq = 0;
  for (const o of ops) {
    await db.execute(sql`
      INSERT INTO rate_push_operations
        (job_id, operation_key, sequence, account_name, product_name, trunk_prefix, dial_prefix,
         full_prefix, destination_name, requested_rate, status, refused_before_write)
      VALUES (${jobId}, ${`k${seq}`}, ${seq}, ${o.accountName}, ${o.productName}, ${o.trunkPrefix},
              ${o.dialPrefix}, ${o.fullPrefix}, ${o.destinationName},
              ${o.requestedRate === null ? null : String(o.requestedRate)}, ${o.status},
              ${o.refusedBeforeWrite})`);
    seq++;
  }
};

beforeAll(async () => {
  client = await PGlite.create();
  db = drizzle(client);
  // Only the columns this path reads, matching migration 511's shape.
  await client.exec(`
    CREATE TABLE rate_push_jobs (job_id VARCHAR(64) PRIMARY KEY);
    CREATE TABLE rate_push_operations (
      id SERIAL PRIMARY KEY,
      job_id VARCHAR(64) NOT NULL REFERENCES rate_push_jobs(job_id) ON DELETE CASCADE,
      operation_key VARCHAR(128) NOT NULL,
      sequence INTEGER NOT NULL,
      account_name VARCHAR(160) NOT NULL,
      product_name VARCHAR(64), trunk_prefix VARCHAR(8), dial_prefix VARCHAR(64),
      full_prefix VARCHAR(32) NOT NULL, destination_name VARCHAR(256),
      requested_rate NUMERIC(18,6), status VARCHAR(24) NOT NULL,
      refused_before_write BOOLEAN);`);
  await client.exec(readFileSync(join(__dirname, '..', '..', '..', 'migrations', '518_rate_push_notifications.sql'), 'utf8'));
});
afterAll(async () => { await client?.close(); });

beforeEach(async () => {
  await client.exec(`DELETE FROM rate_push_notifications; DELETE FROM rate_push_operations; DELETE FROM rate_push_jobs;`);
});

describe("CRITICAL: a push that dies before recording what it owes", () => {
  it("recovery finds it, because the operation records outlive the process", async () => {
    // The push certified and then died. No obligation was written.
    await persistOps(JOB, [op({ dialPrefix: '9230' }), op({ dialPrefix: '9231' })]);
    expect(await all(sql`SELECT * FROM rate_push_notifications`)).toHaveLength(0);

    expect(await findPushesMissingObligations(db)).toEqual([JOB]);

    const r = await recoverMissingObligations(db);
    expect(r.jobsRecovered).toEqual([JOB]);
    expect(r.created).toBe(1);

    const [n] = await all(sql`SELECT * FROM rate_push_notifications`);
    expect(n.client_name).toBe('ACME');
    expect(Number(n.row_count)).toBe(2);
    // Marked as recovered, so a rising count is a visible signal that completions are dying.
    expect(n.created_via).toBe('recovery');
  });

  it("recovery reproduces EXACTLY what the push would have recorded", async () => {
    await persistOps('a', [op({ dialPrefix: '9230' })]);
    await persistOps('b', [op({ dialPrefix: '9230' })]);
    // 'a' recorded normally; 'b' died and is recovered.
    await createObligationsForPush(db, { jobId: 'a', operations: await loadOperationsForPush(db, 'a') });
    await recoverMissingObligations(db);

    const rowsOut = await all(sql`SELECT job_id, rows_json, row_count, notification_type, dial_format FROM rate_push_notifications ORDER BY job_id`);
    expect(rowsOut).toHaveLength(2);
    expect(JSON.stringify(rowsOut[0].rows_json)).toBe(JSON.stringify(rowsOut[1].rows_json));
    expect(rowsOut[0].notification_type).toBe(rowsOut[1].notification_type);
    expect(rowsOut[0].dial_format).toBe(rowsOut[1].dial_format);
  });

  it("recovery does NOT announce twice when the push had already recorded", async () => {
    await persistOps(JOB, [op()]);
    await createObligationsForPush(db, { jobId: JOB, operations: await loadOperationsForPush(db, JOB) });

    // The job is no longer missing, so recovery leaves it alone.
    expect(await findPushesMissingObligations(db)).toEqual([]);
    const r = await recoverMissingObligations(db);
    expect(r.created).toBe(0);
    expect(await all(sql`SELECT * FROM rate_push_notifications`)).toHaveLength(1);
  });

  it("recovery is safe to run repeatedly", async () => {
    await persistOps(JOB, [op()]);
    await recoverMissingObligations(db);
    await recoverMissingObligations(db);
    await recoverMissingObligations(db);
    expect(await all(sql`SELECT * FROM rate_push_notifications`)).toHaveLength(1);
  });

  it("a push with NO certified success is not 'missing' an obligation", async () => {
    // Nothing succeeded, so nothing is owed. Recovery must not invent an announcement.
    await persistOps(JOB, [op({ status: 'indeterminate' }), op({ status: 'failed' })]);
    expect(await findPushesMissingObligations(db)).toEqual([]);
    const r = await recoverMissingObligations(db);
    expect(r.created).toBe(0);
  });
});

describe("CRITICAL: the same completion processed twice", () => {
  it("produces exactly ONE obligation", async () => {
    await persistOps(JOB, [op()]);
    const ops = await loadOperationsForPush(db, JOB);
    const first  = await createObligationsForPush(db, { jobId: JOB, operations: ops });
    const second = await createObligationsForPush(db, { jobId: JOB, operations: ops });

    expect(first.created).toBe(1);
    expect(second.created).toBe(0);
    expect(second.alreadyPresent).toBe(1);
    expect(await all(sql`SELECT * FROM rate_push_notifications`)).toHaveLength(1);
  });

  it("the schema refuses a duplicate even if the code stopped guarding", async () => {
    await persistOps(JOB, [op()]);
    await createObligationsForPush(db, { jobId: JOB, operations: await loadOperationsForPush(db, JOB) });
    await expect(client.exec(`
      INSERT INTO rate_push_notifications
        (job_id, client_name, product_code, product_label, rows_json, row_count)
      VALUES ('${JOB}', 'ACME', 'FC', 'FC', '[]'::jsonb, 1)`)).rejects.toThrow();
  });

  it("a SECOND push to the same client is its own obligation", async () => {
    // Idempotence is per push, not per client: a later push is a new commercial event.
    await persistOps('job-1', [op()]);
    await persistOps('job-2', [op({ requestedRate: 0.04 })]);
    await createObligationsForPush(db, { jobId: 'job-1', operations: await loadOperationsForPush(db, 'job-1') });
    await createObligationsForPush(db, { jobId: 'job-2', operations: await loadOperationsForPush(db, 'job-2') });
    expect(await all(sql`SELECT * FROM rate_push_notifications`)).toHaveLength(2);
  });
});

describe("only certified success becomes an obligation", () => {
  it("indeterminate and needs_review produce nothing", async () => {
    await persistOps(JOB, [op({ status: 'indeterminate' }), op({ status: 'needs_review' })]);
    const r = await createObligationsForPush(db, { jobId: JOB, operations: await loadOperationsForPush(db, JOB) });
    expect(r.created).toBe(0);
    expect(r.excluded).toHaveLength(2);
    expect(await all(sql`SELECT * FROM rate_push_notifications`)).toHaveLength(0);
  });

  it("a partly successful push records only the successful rows", async () => {
    await persistOps(JOB, [
      op({ dialPrefix: '9230', status: 'succeeded' }),
      op({ dialPrefix: '9231', status: 'indeterminate' }),
    ]);
    await createObligationsForPush(db, { jobId: JOB, operations: await loadOperationsForPush(db, JOB) });
    const [n] = await all(sql`SELECT rows_json, row_count FROM rate_push_notifications`);
    expect(Number(n.row_count)).toBe(1);
    const parsed = typeof n.rows_json === 'string' ? JSON.parse(n.rows_json) : n.rows_json;
    expect(parsed.map((x: any) => x.prefix)).toEqual(['9230']);
  });

  it("an obligation always says CHANGES, never FULL", async () => {
    // Under FULL every destination the sheet omits reads as deleted. A partly successful push
    // labelled FULL would withdraw everything it could not prove.
    await persistOps(JOB, [op()]);
    await createObligationsForPush(db, { jobId: JOB, operations: await loadOperationsForPush(db, JOB) });
    const [n] = await all(sql`SELECT notification_type FROM rate_push_notifications`);
    expect(n.notification_type).toBe('CHANGES');
  });
});

describe("the certified facts are frozen, not re-derived", () => {
  it("stores the rows themselves, so nothing is rebuilt from product_rates later", async () => {
    await persistOps(JOB, [op()]);
    await createObligationsForPush(db, { jobId: JOB, operations: await loadOperationsForPush(db, JOB) });
    const [n] = await all(sql`SELECT rows_json, dial_format FROM rate_push_notifications`);
    const parsed = typeof n.rows_json === 'string' ? JSON.parse(n.rows_json) : n.rows_json;
    expect(parsed[0]).toMatchObject({
      prefix: '9230', destination: 'PAKISTAN - MOBILE JAZZ', rate: '0.045000', productDigit: '1',
    });
    expect(n.dial_format).toContain('[Country Code]');
  });

  it("the customer's bare prefix is stored, never the trunk-composed one", async () => {
    await persistOps(JOB, [op()]);
    await createObligationsForPush(db, { jobId: JOB, operations: await loadOperationsForPush(db, JOB) });
    const [n] = await all(sql`SELECT rows_json FROM rate_push_notifications`);
    const parsed = typeof n.rows_json === 'string' ? JSON.parse(n.rows_json) : n.rows_json;
    expect(parsed[0].prefix).toBe('9230');
    expect(parsed[0].prefix).not.toBe('19230');
  });

  it("one obligation per client per product", async () => {
    await persistOps(JOB, [
      op({ accountName: 'ACME', productName: 'FC' }),
      op({ accountName: 'ACME', productName: 'BC', trunkPrefix: '2' }),
      op({ accountName: 'BETA', productName: 'FC' }),
    ]);
    const r = await createObligationsForPush(db, { jobId: JOB, operations: await loadOperationsForPush(db, JOB) });
    expect(r.created).toBe(3);
  });

  it("pending obligations come back with their frozen rows", async () => {
    await persistOps(JOB, [op()]);
    await createObligationsForPush(db, { jobId: JOB, operations: await loadOperationsForPush(db, JOB) });
    const [p] = await pendingRateNotifications(db);
    expect(p.clientName).toBe('ACME');
    expect(p.notificationType).toBe('CHANGES');
    expect(p.rows[0].prefix).toBe('9230');
  });
});

describe("creating an obligation mutates nothing else", () => {
  const CODE = readFileSync(join(__dirname, 'post-push-obligation.ts'), 'utf8')
    .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

  it("reaches no transport and no switch", () => {
    for (const t of ['sendmail', 'sendemail', 'nodemailer', 'sippy', 'pushrate', 'fetch(']) {
      expect(CODE.toLowerCase(), t).not.toContain(t);
    }
  });

  it("never reads product_rates", () => {
    expect(CODE).not.toContain('product_rates');
    expect(CODE).not.toContain('productRates');
  });

  it("leaves the operation records untouched", async () => {
    await persistOps(JOB, [op()]);
    const before = await all(sql`SELECT * FROM rate_push_operations`);
    await createObligationsForPush(db, { jobId: JOB, operations: await loadOperationsForPush(db, JOB) });
    const after = await all(sql`SELECT * FROM rate_push_operations`);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });
});
