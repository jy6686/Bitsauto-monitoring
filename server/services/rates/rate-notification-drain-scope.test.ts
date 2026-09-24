/**
 * A push delivers ITS OWN notifications. Nothing else.
 *
 * 2026-09-22, production: a First Class push for accounts 1gloabl and aura was refused before any
 * Sippy write (not eligible). The drain that ran after it took the oldest pending obligation in
 * the system — aura's Business Class notice from 2026-09-19 — and sent it. Aura received an email
 * about a different product and a different destination, from a push that had nothing to do
 * with her, and the effective date on it was wrong for an unrelated reason. Two defects, one
 * email. This file is the first one.
 *
 * The rule under test is not "filter by job id". It is: the moment a push runs the drain, the
 * only rows that can leave are the rows that push just recorded. The backlog has exactly one
 * legitimate trigger — boot — and when boot sends a backlog row it says so, naming the row's own
 * job and age, so the log cannot read as if a push did it.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { sql } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createObligationsForPush, pendingRateNotifications } from './post-push-obligation';
import type { AppliedOperation } from './post-push-notification';
import { deliverRateNotifications, prepareRateNotifications } from './rate-notification-worker';
import { runAutoDrain, type AutoDrainDeps, DRAIN_LIMIT, MAX_DELIVERY_ATTEMPTS } from './rate-notification-auto';

let client: PGlite;
let db: any;
let sent: Array<{ to: string; subject: string }>;

const all = async (q: any) => { const r: any = await db.execute(q); return Array.isArray(r) ? r : (r.rows ?? []); };

const op = (o: Partial<AppliedOperation> = {}): AppliedOperation => ({
  accountName: 'ACME', productName: 'FC', trunkPrefix: '1',
  dialPrefix: '9230', fullPrefix: '19230', destinationName: 'Afghanistan Mobile',
  requestedRate: 0.045, status: 'succeeded', refusedBeforeWrite: false, effectiveFrom: '2026-09-19 14:45', ...o,
});

const recorder = async (m: any) => { sent.push({ to: m.to, subject: m.subject }); return { ok: true }; };
const deps = (send?: any) => ({ db, send, today: () => '2026-09-23' });

/** Two pushes, two accounts, two obligations — the OLD one first, exactly as the backlog orders them. */
const OLD_JOB = 'job-old-aura';
const NEW_JOB = 'job-new-acme';
async function seedBacklogThenPush() {
  // The parent job rows. rate_push_operations carries a foreign key to these in production, so an
  // obligation always belongs to a job that exists — and the creator now refuses to announce on a
  // job it cannot establish. Seeding them keeps the fixture faithful to that constraint.
  await db.execute(sql`INSERT INTO rate_push_jobs (job_id, rate_type) VALUES (${OLD_JOB}, 'current'), (${NEW_JOB}, 'current') ON CONFLICT DO NOTHING`);
  await createObligationsForPush(db, { jobId: OLD_JOB, operations: [op({ accountName: 'AURA', productName: 'BC', dialPrefix: '9230', fullPrefix: '29230', trunkPrefix: '2' })], productLabelFor: () => 'Business Class' });
  // Make the old one visibly older, as it would be in production.
  await db.execute(sql`UPDATE rate_push_notifications SET created_at = NOW() - INTERVAL '4 days' WHERE job_id = ${OLD_JOB}`);
  await createObligationsForPush(db, { jobId: NEW_JOB, operations: [op({ accountName: 'ACME', dialPrefix: '8801', fullPrefix: '18801' })], productLabelFor: () => 'First Class' });
}

beforeAll(async () => {
  client = await PGlite.create();
  db = drizzle(client);
  await client.exec(`
    CREATE TABLE companies (id SERIAL PRIMARY KEY, name VARCHAR(256) UNIQUE NOT NULL, account_prefix VARCHAR(32),
      sippy_i_account INTEGER);
    CREATE TABLE company_contacts (id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL,
      contact_type VARCHAR(32) NOT NULL, email VARCHAR(320));
    CREATE TABLE rate_push_jobs (job_id VARCHAR(64) PRIMARY KEY, rate_type VARCHAR(64));
    -- VARCHAR(64) mirrors PRODUCTION, verified 2026-09-23 via information_schema. The declared
    -- schema (shared/schema.ts and migration 0000) says varchar(16), which would reject the
    -- 18-character 'change-client-rate' that production has stored 12 times. The fixture
    -- reproduces the live contract the guard runs against; the declared/live drift is a real
    -- defect with its own gate, not something to encode here.
    CREATE TABLE rate_push_operations (
      id SERIAL PRIMARY KEY, job_id VARCHAR(64) NOT NULL, operation_key VARCHAR(128) NOT NULL,
      sequence INTEGER NOT NULL, account_name VARCHAR(160) NOT NULL, product_name VARCHAR(64),
      trunk_prefix VARCHAR(8), dial_prefix VARCHAR(64), full_prefix VARCHAR(32) NOT NULL,
      destination_name VARCHAR(256), requested_rate NUMERIC(18,6), status VARCHAR(24) NOT NULL,
      refused_before_write BOOLEAN, i_account INTEGER, effective_from VARCHAR(32));`);
  await client.exec(readFileSync(join(__dirname, '..', '..', '..', 'migrations', '518_rate_push_notifications.sql'), 'utf8'));
});
afterAll(async () => { await client?.close(); });

beforeEach(async () => {
  sent = [];
  await client.exec(`DELETE FROM rate_push_notifications; DELETE FROM company_contacts; DELETE FROM companies;`);
  await db.execute(sql`INSERT INTO companies (id, name, account_prefix) VALUES (1, 'ACME', '307'), (2, 'AURA', '1018')`);
  await db.execute(sql`INSERT INTO company_contacts (company_id, contact_type, email)
                       VALUES (1, 'rates', 'pricing@acme.example'), (2, 'commercial', 'rates@aura.example')`);
});

describe('THE PRODUCTION CASE: a push runs the drain while an older obligation is pending', () => {
  it('the push sends ONLY its own obligation; the older one stays pending', async () => {
    await seedBacklogThenPush();
    const r = await deliverRateNotifications(deps(recorder), { enabled: true, jobId: NEW_JOB });

    expect(r.attempted).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('pricing@acme.example');
    expect(sent[0].to).not.toContain('aura');

    const rows = await all(sql`SELECT job_id, status FROM rate_push_notifications ORDER BY created_at`);
    expect(rows.map((x: any) => [x.job_id, x.status])).toEqual([[OLD_JOB, 'pending'], [NEW_JOB, 'sent']]);
  });

  /**
   * THE REGRESSION, stated as the 2026-09-22 email. The push is for ACME. Before this fix the
   * drain's first row was AURA's — oldest first — and AURA got an email. Now AURA gets nothing
   * from ACME's push, whatever the ordering.
   */
  it('a push for one account can never deliver another account\'s backlog', async () => {
    await seedBacklogThenPush();
    await deliverRateNotifications(deps(recorder), { enabled: true, jobId: NEW_JOB });
    expect(sent.map(s => s.to)).not.toContain('rates@aura.example');
  });

  it('a push whose own obligation was already sent delivers nothing — it does not fall through to the backlog', async () => {
    await seedBacklogThenPush();
    await deliverRateNotifications(deps(recorder), { enabled: true, jobId: NEW_JOB });
    sent = [];
    const again = await deliverRateNotifications(deps(recorder), { enabled: true, jobId: NEW_JOB });
    expect(again.attempted).toBe(0);
    expect(sent).toEqual([]);
    const [old] = await all(sql`SELECT status FROM rate_push_notifications WHERE job_id = ${OLD_JOB}`);
    expect(old.status).toBe('pending');
  });

  it('the pending list itself honours the scope, so no caller can widen it by accident', async () => {
    await seedBacklogThenPush();
    expect((await pendingRateNotifications(db, 50, undefined, NEW_JOB)).map(o => o.jobId)).toEqual([NEW_JOB]);
    expect((await pendingRateNotifications(db, 50, undefined, OLD_JOB)).map(o => o.jobId)).toEqual([OLD_JOB]);
    expect((await pendingRateNotifications(db, 50, undefined, 'job-nobody')).length).toBe(0);
  });
});

describe('the backlog has exactly one legitimate trigger: boot', () => {
  it('an unscoped pass (boot) delivers both, oldest first, and reports each with its own job and age', async () => {
    await seedBacklogThenPush();
    const r = await deliverRateNotifications(deps(recorder), { enabled: true });
    expect(r.sent).toBe(2);
    expect(r.deliveries.map(d => d.jobId)).toEqual([OLD_JOB, NEW_JOB]);
    expect(r.deliveries[0]).toMatchObject({ jobId: OLD_JOB, clientName: 'AURA', to: ['rates@aura.example'], ok: true });
    // The age is carried, so the log can say "frozen four days ago" instead of "sent 1".
    expect(r.deliveries[0].createdAt).toBeTruthy();
    expect(new Date(r.deliveries[0].createdAt!).getTime()).toBeLessThan(new Date(r.deliveries[1].createdAt!).getTime());
  });

  it('a failed delivery is reported with its error, in place, not dropped from the record', async () => {
    await seedBacklogThenPush();
    const flaky = async (m: any) => m.to.includes('aura') ? { ok: false, error: 'mailbox full' } : recorder(m);
    const r = await deliverRateNotifications(deps(flaky), { enabled: true });
    expect(r.deliveries.find(d => d.jobId === OLD_JOB)).toMatchObject({ ok: false, error: 'mailbox full' });
    expect(r.deliveries.find(d => d.jobId === NEW_JOB)).toMatchObject({ ok: true });
  });

  it('preparing with a scope is as safe as preparing without one: nothing sent, nothing written', async () => {
    await seedBacklogThenPush();
    const before = JSON.stringify(await all(sql`SELECT id, status, attempts FROM rate_push_notifications ORDER BY id`));
    const { prepared } = await prepareRateNotifications(deps(recorder), { jobId: NEW_JOB });
    expect(prepared.map(p => p.jobId)).toEqual([NEW_JOB]);
    expect(sent).toEqual([]);
    expect(JSON.stringify(await all(sql`SELECT id, status, attempts FROM rate_push_notifications ORDER BY id`))).toBe(before);
  });
});

describe('runAutoDrain enforces the scope before anything else', () => {
  const workerDeps = { db: {} as any, send: async () => ({ ok: true }) };
  const report = (deliveries: any[]) => ({
    attempted: deliveries.length, sent: deliveries.filter(d => d.ok).length,
    failed: deliveries.filter(d => !d.ok).length, blocked: [], deliveries, disabled: false,
  });
  function mk(over: Partial<AutoDrainDeps> = {}): AutoDrainDeps {
    return { readFlag: async () => ({ enabled: true }), deliver: vi.fn(async () => report([])), workerDeps, log: () => {}, ...over };
  }

  /**
   * A push with no job id is a wiring defect. The old code's answer to that defect was to drain
   * the whole backlog. The safe answer is to drain nothing — and to say so, before even reading
   * the flag, because the flag being on is not permission to send someone else's mail.
   */
  it('a push without a jobId is REFUSED: the worker is never called, the flag is never consulted', async () => {
    const deliver = vi.fn(async () => report([]));
    const readFlag = vi.fn(async () => ({ enabled: true }));
    const out = await runAutoDrain(mk({ deliver, readFlag }), 'push');
    expect(deliver).not.toHaveBeenCalled();
    expect(readFlag).not.toHaveBeenCalled();
    expect(out).toMatchObject({ reason: 'push', enabled: false, report: null });
    expect(out.error).toMatch(/without a jobId/);
  });

  it('a push WITH a jobId hands exactly that jobId to the worker, with the cap', async () => {
    const deliver = vi.fn(async () => report([]));
    await runAutoDrain(mk({ deliver }), 'push', { jobId: 'job-42' });
    const [, opts] = deliver.mock.calls[0] as any[];
    expect(opts).toEqual({ enabled: true, limit: DRAIN_LIMIT, maxAttempts: MAX_DELIVERY_ATTEMPTS, jobId: 'job-42' });
  });

  it('boot passes NO jobId — the backlog is its job', async () => {
    const deliver = vi.fn(async () => report([]));
    await runAutoDrain(mk({ deliver }), 'boot');
    const [, opts] = deliver.mock.calls[0] as any[];
    expect(opts).toEqual({ enabled: true, limit: DRAIN_LIMIT, maxAttempts: MAX_DELIVERY_ATTEMPTS });
    expect('jobId' in opts).toBe(false);
  });

  it('every delivery is logged naming its own job, its age, and whether it was backlog', async () => {
    const lines: string[] = [];
    const deliveries = [
      { obligationId: 3, jobId: 'job-old', clientName: 'aura', createdAt: '2026-09-19T14:02:35.000Z', to: ['rates@aura.example'], ok: true },
      { obligationId: 5, jobId: 'job-new', clientName: '1global', createdAt: '2026-09-23T09:00:00.000Z', to: ['c@1global.example'], ok: false, error: 'mailbox full' },
    ];
    await runAutoDrain(mk({ deliver: vi.fn(async () => report(deliveries)), log: l => lines.push(l) }), 'boot');
    expect(lines[0]).toMatch(/^\[rate-notify\] boot \(backlog\): sent obligation 3 \(BACKLOG: job-old, frozen 2026-09-19T14:02:35.000Z\) → aura <rates@aura.example>$/);
    expect(lines[1]).toMatch(/^\[rate-notify\] boot \(backlog\): FAILED obligation 5 \(BACKLOG: job-new, frozen 2026-09-23T09:00:00.000Z\) → 1global <c@1global.example> — mailbox full$/);
    expect(lines[2]).toMatch(/^\[rate-notify\] boot \(backlog\): attempted 2, sent 1, failed 1/);
  });

  it('a push logs its own rows as "this push", so a scoped drain reads as scoped', async () => {
    const lines: string[] = [];
    const deliveries = [{ obligationId: 7, jobId: 'job-42', clientName: 'ACME', createdAt: '2026-09-23T09:00:00.000Z', to: ['pricing@acme.example'], ok: true }];
    await runAutoDrain(mk({ deliver: vi.fn(async () => report(deliveries)), log: l => lines.push(l) }), 'push', { jobId: 'job-42' });
    expect(lines[0]).toContain('push job-42: sent obligation 7 (this push: job-42');
  });

  it('flag off still sends nothing, scoped or not', async () => {
    const deliver = vi.fn(async () => report([]));
    await runAutoDrain(mk({ deliver, readFlag: async () => ({ enabled: false }) }), 'push', { jobId: 'job-42' });
    await runAutoDrain(mk({ deliver, readFlag: async () => ({ enabled: false }) }), 'boot');
    expect(deliver).not.toHaveBeenCalled();
  });
});
