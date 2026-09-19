/**
 * The operation-row store against real Postgres (PGlite) and the real migrations 511–513.
 *
 * What only a database can prove: the loader returns exactly the rows a job left, typed; every
 * write is conditional on the row's CURRENT status, so a second boot matches nothing; the parent
 * is stamped from its rows and only while still non-terminal; and no row that was terminal
 * before the sweep is touched by it.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { sql } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadOperationRows, writeOperationOutcome } from './reconcile-operation-store';
import { deriveOperationIntent } from './reconcile-core';

let client: PGlite;
let db: ReturnType<typeof drizzle>;
const JOB = 'job-1789813881944';

const all = async (q: any) => { const r: any = await db.execute(q); return Array.isArray(r) ? r : (r.rows ?? []); };
const ops = async (jobId = JOB) => all(sql`
  SELECT operation_key, status, verification_result, refused_before_write, message, completed_at
    FROM rate_push_operations WHERE job_id = ${jobId} ORDER BY sequence`);
const jobRow = async (jobId = JOB) => (await all(sql`SELECT status, verification_result, error_message, completed_at FROM rate_push_jobs WHERE job_id = ${jobId}`))[0];

async function seed(jobId: string, rows: Array<{ key: string; status: string; tariff?: number | null; prefix?: string | null; rate?: string | null }>, jobStatus = 'processing') {
  await db.execute(sql`INSERT INTO rate_push_jobs (job_id, status) VALUES (${jobId}, ${jobStatus})`);
  let seq = 0;
  for (const r of rows) {
    await db.execute(sql`
      INSERT INTO rate_push_operations (job_id, operation_key, sequence, account_name, full_prefix, requested_rate, i_tariff, status, message)
      VALUES (${jobId}, ${r.key}, ${seq++}, 'aura', ${r.prefix === undefined ? `2923${r.key}` : r.prefix}, ${r.rate === undefined ? '0.04' : r.rate},
              ${r.tariff === undefined ? 66 : r.tariff}, ${r.status}, 'queued')`);
  }
}

beforeAll(async () => {
  client = await PGlite.create();
  db = drizzle(client);
  await client.exec(`
    CREATE TABLE rate_push_jobs (
      id SERIAL PRIMARY KEY,
      job_id VARCHAR(64) UNIQUE NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'pending',
      verification_result VARCHAR(64),
      error_message TEXT,
      completed_at TIMESTAMP
    );`);
  for (const m of ['511_rate_push_operations.sql', '512_operation_resolution.sql', '513_operation_trace.sql']) {
    await client.exec(readFileSync(join(__dirname, '..', '..', '..', 'migrations', m), 'utf8'));
  }
});
afterAll(async () => { await client?.close(); });
beforeEach(async () => { await client.exec(`DELETE FROM rate_push_operations; DELETE FROM rate_push_jobs;`); });

describe('loadOperationRows', () => {
  it('returns the rows of the requested jobs, typed, in sequence; absent jobs are absent from the map', async () => {
    await seed(JOB, [{ key: 'k0', status: 'running' }, { key: 'k1', status: 'pending', tariff: null }]);
    await seed('job-other', [{ key: 'z', status: 'succeeded' }]);
    const m = await loadOperationRows(db as any, [JOB, 'job-1782159074691']);
    expect([...m.keys()]).toEqual([JOB]);
    expect(m.get(JOB)).toEqual([
      { operationKey: 'k0', iTariff: 66, fullPrefix: '2923k0', requestedRate: 0.04, status: 'running' },
      { operationKey: 'k1', iTariff: null, fullPrefix: '2923k1', requestedRate: 0.04, status: 'pending' },
    ]);
    expect(await loadOperationRows(db as any, [])).toEqual(new Map());
  });

  it('feeds deriveOperationIntent exactly: a legacy id with no rows derives to none', async () => {
    const m = await loadOperationRows(db as any, ['job-1782159074691']);
    expect(deriveOperationIntent(m.get('job-1782159074691') ?? [])).toEqual({ kind: 'none' });
  });
});

describe('writeOperationOutcome — conditional, row by row, then the parent from the rows', () => {
  it('writes one verdict per running row, settles pending rows, leaves terminal rows alone, stamps the parent', async () => {
    await seed(JOB, [
      { key: 'k0', status: 'running' }, { key: 'k1', status: 'running' }, { key: 'k2', status: 'running' },
      { key: 'k3', status: 'pending' }, { key: 'k4', status: 'succeeded' },
    ]);
    const r = await writeOperationOutcome(db as any, JOB, {
      verdicts: [{ operationKey: 'k0', verdict: 'success' }, { operationKey: 'k1', verdict: 'failure' }, { operationKey: 'k2', verdict: 'indeterminate' }],
      notAttempted: ['k3'],
    });
    expect(r).toMatchObject({ rowsWritten: 4, jobWritten: true, jobStatus: 'needs_review' });

    const rows = await ops();
    expect(rows.map((x: any) => [x.operation_key, x.status, x.verification_result])).toEqual([
      ['k0', 'succeeded', 'reconciled_confirmed'],
      ['k1', 'failed', 'reconciled_absent'],
      ['k2', 'indeterminate', 'reconciled_indeterminate'],
      ['k3', 'not_attempted', null],
      ['k4', 'succeeded', null],           // untouched: it was terminal before the sweep
    ]);
    expect(rows[3].refused_before_write).toBe(true);
    expect(rows[3].message).toContain('restarted before this operation was started');
    expect(rows[0].message).toContain('Nothing was re-sent');
    expect(rows[4].message).toBe('queued');
    expect(rows[4].completed_at).toBeNull();

    const j = await jobRow();
    expect(j.status).toBe('needs_review');
    expect(j.verification_result).toBe('reconciled_indeterminate');
    // Counts are of the JOB's rows: k4 was succeeded before the sweep and is counted, not re-stamped.
    expect(j.error_message).toContain('2 succeeded, 1 failed, 1 indeterminate, 1 not attempted');
  });

  it('all confirmed → parent completed/reconciled_confirmed; all absent → failed/reconciled_absent; mixed → partial/reconciled_partial', async () => {
    await seed('j-ok', [{ key: 'a', status: 'running' }, { key: 'b', status: 'running' }]);
    await writeOperationOutcome(db as any, 'j-ok', { verdicts: [{ operationKey: 'a', verdict: 'success' }, { operationKey: 'b', verdict: 'success' }], notAttempted: [] });
    expect(await jobRow('j-ok')).toMatchObject({ status: 'completed', verification_result: 'reconciled_confirmed' });

    await seed('j-no', [{ key: 'a', status: 'running' }, { key: 'b', status: 'pending' }]);
    await writeOperationOutcome(db as any, 'j-no', { verdicts: [{ operationKey: 'a', verdict: 'failure' }], notAttempted: ['b'] });
    expect(await jobRow('j-no')).toMatchObject({ status: 'failed', verification_result: 'reconciled_absent' });

    await seed('j-mix', [{ key: 'a', status: 'running' }, { key: 'b', status: 'running' }]);
    await writeOperationOutcome(db as any, 'j-mix', { verdicts: [{ operationKey: 'a', verdict: 'success' }, { operationKey: 'b', verdict: 'failure' }], notAttempted: [] });
    expect(await jobRow('j-mix')).toMatchObject({ status: 'partial', verification_result: 'reconciled_partial' });
  });

  it('a second, concurrent reconciliation matches nothing: rows and parent keep the first verdict', async () => {
    await seed(JOB, [{ key: 'k0', status: 'running' }, { key: 'k1', status: 'pending' }]);
    const first = await writeOperationOutcome(db as any, JOB, { verdicts: [{ operationKey: 'k0', verdict: 'success' }], notAttempted: ['k1'] });
    expect(first).toMatchObject({ rowsWritten: 2, jobWritten: true });
    // The second boot read the same stale state and reached a DIFFERENT conclusion (Sippy moved).
    const second = await writeOperationOutcome(db as any, JOB, { verdicts: [{ operationKey: 'k0', verdict: 'failure' }], notAttempted: ['k1'] });
    expect(second).toMatchObject({ rowsWritten: 0, jobWritten: false });
    expect((await ops()).map((x: any) => x.status)).toEqual(['succeeded', 'not_attempted']);
    expect(await jobRow()).toMatchObject({ status: 'partial', verification_result: 'reconciled_partial' });
  });

  it('a verdict for a row that is not running is refused by the WHERE clause, whatever the verdict says', async () => {
    await seed(JOB, [{ key: 'k0', status: 'succeeded' }, { key: 'k1', status: 'failed' }]);
    const r = await writeOperationOutcome(db as any, JOB, { verdicts: [{ operationKey: 'k0', verdict: 'failure' }, { operationKey: 'k1', verdict: 'success' }], notAttempted: [] });
    expect(r.rowsWritten).toBe(0);
    expect((await ops()).map((x: any) => [x.status, x.verification_result])).toEqual([['succeeded', null], ['failed', null]]);
  });

  it('a parent already terminal is never resurrected or re-stamped', async () => {
    await seed(JOB, [{ key: 'k0', status: 'running' }], 'completed');
    await db.execute(sql`UPDATE rate_push_jobs SET verification_result = 'confirmed', error_message = NULL WHERE job_id = ${JOB}`);
    const r = await writeOperationOutcome(db as any, JOB, { verdicts: [{ operationKey: 'k0', verdict: 'failure' }], notAttempted: [] });
    expect(r).toMatchObject({ rowsWritten: 1, jobWritten: false });
    expect(await jobRow()).toMatchObject({ status: 'completed', verification_result: 'confirmed', error_message: null });
  });

  it('leaves the parent non-terminal when rows are still in flight — it stays eligible for the next boot', async () => {
    await seed(JOB, [{ key: 'k0', status: 'running' }, { key: 'k1', status: 'running' }]);
    const r = await writeOperationOutcome(db as any, JOB, { verdicts: [{ operationKey: 'k0', verdict: 'success' }], notAttempted: [] });
    expect(r).toMatchObject({ rowsWritten: 1, jobWritten: false, jobStatus: 'processing' });
    expect((await jobRow()).status).toBe('processing');
  });
});

describe('wiring — the store cannot push, and the boot uses it', () => {
  const strip = (t: string) => t.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const STORE = strip(readFileSync(join(__dirname, 'reconcile-operation-store.ts'), 'utf8'));
  const BOOT  = strip(readFileSync(join(__dirname, 'reconcile-boot.ts'), 'utf8'));

  it('the store imports nothing from sippy and contains no push/upload call', () => {
    expect(STORE).not.toMatch(/from ['"].*sippy/);
    for (const forbidden of ['pushRate', 'uploadRate', 'setSippyRateEntry', 'uploadRatesWorkbook', 'INSERT INTO rate_push_operations']) {
      expect(STORE).not.toContain(forbidden);
    }
  });

  it('every write in the store is conditional on the row\'s current status', () => {
    expect(STORE).toContain("AND status = 'running'");
    expect(STORE).toContain("AND status = 'pending'");
    expect(STORE).toContain("AND status IN ('pending', 'processing')");
  });

  it('the boot loads operation rows only for jobs whose row has no intent, and wires both store functions', () => {
    expect(BOOT).toContain('jobs.filter(j => j.intents.length === 0)');
    expect(BOOT).toContain('loadOperationRows(db as any, withoutJobIntent)');
    expect(BOOT).toContain('deriveOperationIntent(opRows.get(j.jobId) ?? [])');
    expect(BOOT).toContain('writeOperationOutcome(db as any, jobId, outcome)');
    expect(BOOT).toContain('readbackByTariff: makeReadbackByTariff(');
  });
});
