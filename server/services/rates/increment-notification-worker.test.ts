/**
 * The delivery worker, against real Postgres.
 *
 * NO EMAIL CAN BE SENT HERE. The transport is injected and every test binds a recorder, so the
 * suite has no path to a real address. The worker also refuses to send at all unless delivery is
 * explicitly enabled, which is asserted first.
 *
 * The load-bearing properties: only committed obligations are deliverable, a failure stays owed,
 * a retry updates the same obligation rather than creating a second one, and a change is never
 * reported as announced while any client is still waiting.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { acceptIncrementChange } from "./increment-change-store";
import { deliverPendingNotifications, type SendResult } from "./increment-notification-worker";

let client: PGlite;
let db: any;
let sentTo: string[];
let failWith: string | null;

const V1 = 1, FC = 1, JAZZ = 10;
const TODAY = '2026-09-11', EFFECTIVE = '2026-09-20', ACTOR = 'ops@example.com';
const MIG = (f: string) => readFileSync(join(__dirname, '..', '..', '..', 'migrations', f), 'utf8');
/** The worker's code with comments stripped — assertions about behaviour must not match prose. */
const WORKER_CODE = readFileSync(join(__dirname, 'increment-notification-worker.ts'), 'utf8')
  .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

const all = async (q: any) => { const r: any = await db.execute(q); return Array.isArray(r) ? r : (r.rows ?? []); };

const recorder = async (msg: { to: string }): Promise<SendResult> => {
  if (failWith) return { ok: false, error: failWith };
  sentTo.push(msg.to);
  return { ok: true };
};
const deps = (send = recorder) => ({ db, send });

const accept = (over: any = {}) => acceptIncrementChange(db, {
  productId: FC, destinationId: JAZZ, catalogueVersionId: V1,
  destinationName: 'PAKISTAN - MOBILE JAZZ', currentIncrement: '60/1', newIncrement: '30/6',
  effectiveDate: EFFECTIVE, today: TODAY, actor: ACTOR, ...over,
});

beforeAll(async () => {
  client = await PGlite.create();
  db = drizzle(client);
  await client.exec(`
    CREATE TABLE catalogue_versions (id SERIAL PRIMARY KEY, label TEXT UNIQUE NOT NULL, status TEXT NOT NULL);
    CREATE TABLE commercial_destinations (id SERIAL PRIMARY KEY, version_id INTEGER NOT NULL REFERENCES catalogue_versions(id), name TEXT NOT NULL);
    CREATE TABLE product_registry (id SERIAL PRIMARY KEY, code VARCHAR(16) UNIQUE NOT NULL, name VARCHAR(64) NOT NULL);
    CREATE TABLE companies (id SERIAL PRIMARY KEY, name VARCHAR(256) UNIQUE NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'active', invoice_email VARCHAR(256));
    CREATE TABLE rate_notification_templates (id SERIAL PRIMARY KEY, client_name VARCHAR(256) NOT NULL,
      product_id INTEGER NOT NULL, recipients TEXT, cc_emails TEXT, status VARCHAR(32) NOT NULL DEFAULT 'active');`);
  await client.exec(MIG('516_billing_increment_changes.sql'));
  await client.exec(MIG('517_billing_increment_notifications.sql'));
});
afterAll(async () => { await client?.close(); });

beforeEach(async () => {
  sentTo = []; failWith = null;
  await client.exec(`
    DELETE FROM billing_increment_notifications; DELETE FROM billing_increment_changes;
    DELETE FROM companies; DELETE FROM commercial_destinations;
    DELETE FROM catalogue_versions; DELETE FROM product_registry;`);
  await db.execute(sql`INSERT INTO product_registry (id, code, name) VALUES (${FC}, 'FC', 'First Class')`);
  await db.execute(sql`INSERT INTO catalogue_versions (id, label, status) VALUES (${V1}, 'V1', 'active')`);
  await db.execute(sql`INSERT INTO commercial_destinations (id, version_id, name) VALUES (${JAZZ}, ${V1}, 'PAKISTAN - MOBILE JAZZ')`);
  await db.execute(sql`
    INSERT INTO companies (name, status, invoice_email) VALUES
      ('ACME', 'active', 'ops@acme.example'), ('BETA', 'active', 'billing@beta.example')`);
});

describe("delivery is OFF unless explicitly enabled", () => {
  it("sends nothing and changes nothing when not enabled", async () => {
    await accept();
    const r = await deliverPendingNotifications(deps());
    expect(r.disabled).toBe(true);
    expect(sentTo).toEqual([]);
    // Not marked sent, not marked failed — neither happened.
    const rows = await all(sql`SELECT status, attempts FROM billing_increment_notifications`);
    expect(rows.every((n: any) => n.status === 'pending' && Number(n.attempts) === 0)).toBe(true);
  });

  it("the worker opens no transport of its own", () => {
    // Asserted on CODE, not on prose: the header explains why an SMTP client would be wrong, and
    // an assertion that trips over its own explanation guards nothing.
    for (const t of ['nodemailer', 'createtransport', 'smtp', 'sendgrid', 'fetch(']) {
      expect(WORKER_CODE.toLowerCase(), `must not reach ${t}`).not.toContain(t);
    }
    // It must not import the platform sender either — it is GIVEN one, explicitly.
    expect(WORKER_CODE).not.toContain("from '../../email'");
  });
});

describe("only committed obligations are deliverable", () => {
  it("delivers exactly the rows the change committed", async () => {
    const r = await accept();
    const out = await deliverPendingNotifications(deps(), { enabled: true });
    if (!r.ok) return;
    expect(out.sent).toBe(r.notified);
    expect(sentTo.sort()).toEqual(['billing@beta.example', 'ops@acme.example']);
  });

  it("invents no recipient — an empty outbox delivers nothing", async () => {
    const out = await deliverPendingNotifications(deps(), { enabled: true });
    expect(out.attempted).toBe(0);
    expect(sentTo).toEqual([]);
  });

  it("a suppressed row is not delivered", async () => {
    const r = await accept();
    await client.exec(`UPDATE billing_increment_notifications SET status='suppressed'`);
    const out = await deliverPendingNotifications(deps(), { enabled: true });
    expect(out.attempted).toBe(0);
    expect(sentTo).toEqual([]);
  });

  it("the message delivered is the one committed with the change", async () => {
    await accept();
    let body = '';
    await deliverPendingNotifications({ db, send: async (m: any) => { body = m.html; return { ok: true }; } }, { enabled: true });
    expect(body).toContain('30/6');
    expect(body).toContain(EFFECTIVE);
  });
});

describe("a failure stays owed, and a retry is the same obligation", () => {
  it("records the reason and leaves the row deliverable", async () => {
    await accept();
    failWith = 'SMTP 421';
    const out = await deliverPendingNotifications(deps(), { enabled: true });
    expect(out.failed).toBeGreaterThan(0);
    const rows = await all(sql`SELECT status, last_error, attempts FROM billing_increment_notifications`);
    expect(rows.every((n: any) => n.status === 'failed')).toBe(true);
    expect(rows[0].last_error).toContain('421');
    expect(Number(rows[0].attempts)).toBe(1);
  });

  it("a retry updates the SAME row — the client is not told twice", async () => {
    const r = await accept();
    failWith = 'temporary';
    await deliverPendingNotifications(deps(), { enabled: true });
    failWith = null;
    await deliverPendingNotifications(deps(), { enabled: true });
    const rows = await all(sql`SELECT status, attempts FROM billing_increment_notifications`);
    if (!r.ok) return;
    expect(rows).toHaveLength(r.notified);              // no second obligation appeared
    expect(rows.every((n: any) => n.status === 'sent')).toBe(true);
    expect(rows.every((n: any) => Number(n.attempts) === 2)).toBe(true);
  });

  it("a send that THROWS is treated as a failure, not a crash", async () => {
    await accept();
    const out = await deliverPendingNotifications(
      { db, send: async () => { throw new Error('connection reset'); } }, { enabled: true });
    expect(out.failed).toBeGreaterThan(0);
    const [n] = await all(sql`SELECT last_error FROM billing_increment_notifications LIMIT 1`);
    expect(n.last_error).toContain('connection reset');
  });

  it("stops retrying an address that keeps failing, leaving it visibly owed", async () => {
    // A permanently bad address is a configuration problem. Retrying it forever buries every
    // other pending row behind it.
    await accept();
    failWith = 'bad address';
    for (let i = 0; i < 3; i++) await deliverPendingNotifications(deps(), { enabled: true, maxAttempts: 2 });
    const out = await deliverPendingNotifications(deps(), { enabled: true, maxAttempts: 2 });
    expect(out.attempted).toBe(0);
    expect(out.skippedExhausted).toBeGreaterThan(0);
    const rows = await all(sql`SELECT status FROM billing_increment_notifications`);
    expect(rows.every((n: any) => n.status === 'failed')).toBe(true);   // still owed, still visible
  });
});

describe("the change is notified only when EVERY client has been told", () => {
  it("stays accepted while one recipient is still failing", async () => {
    await accept();
    let first = true;
    await deliverPendingNotifications({
      db, send: async (m: any) => { if (first) { first = false; return { ok: false, error: 'nope' }; } sentTo.push(m.to); return { ok: true }; },
    }, { enabled: true });
    const [c] = await all(sql`SELECT status, notified_at FROM billing_increment_changes`);
    expect(c.status).toBe('accepted');
    expect(c.notified_at).toBeNull();
  });

  it("becomes notified once all are sent, and reports which change", async () => {
    const r = await accept();
    const out = await deliverPendingNotifications(deps(), { enabled: true });
    const [c] = await all(sql`SELECT status, notified_at, notified_count FROM billing_increment_changes`);
    expect(c.status).toBe('notified');
    expect(c.notified_at).not.toBeNull();
    if (r.ok) {
      expect(Number(c.notified_count)).toBe(r.notified);
      expect(out.changesNotified).toContain(r.changeId);
    }
  });
});

describe("delivery cannot alter the commitment or the switch", () => {
  it("leaves the commercial change otherwise untouched", async () => {
    const r = await accept();
    const before = (await all(sql`SELECT new_increment, effective_date, applied_at FROM billing_increment_changes`))[0];
    failWith = 'boom';
    await deliverPendingNotifications(deps(), { enabled: true });
    const after = (await all(sql`SELECT new_increment, effective_date, applied_at FROM billing_increment_changes`))[0];
    expect(after.new_increment).toBe(before.new_increment);
    expect(String(after.effective_date)).toBe(String(before.effective_date));
    // Telling a client is not applying anything.
    expect(after.applied_at).toBeNull();
    if (r.ok) expect(r.changeId).toBeGreaterThan(0);
  });

  it("never sets applied_at, whatever happens to delivery", async () => {
    await accept();
    await deliverPendingNotifications(deps(), { enabled: true });
    const [c] = await all(sql`SELECT applied_at, applied_increment FROM billing_increment_changes`);
    expect(c.applied_at).toBeNull();
    expect(c.applied_increment).toBeNull();
  });

  it("reaches no switch — the module's CODE names nothing Sippy", () => {
    for (const t of ['sippy', 'pushrate', 'uploadbinaryfile', 'itariff']) {
      expect(WORKER_CODE.toLowerCase(), `must not reach ${t}`).not.toContain(t);
    }
  });
});
