/**
 * The join: obligation -> recipients -> rendered message. Against real Postgres.
 *
 * The property that matters most is that WIRING THESE TOGETHER DID NOT TURN AN OBLIGATION INTO A
 * DELIVERY. Sending requires two deliberate acts - `enabled: true` AND an injected sender - and
 * the first group asserts that neither alone is enough.
 *
 * No test here supplies a real transport, so nothing can reach a customer.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createObligationsForPush } from "./post-push-obligation";
import { prepareRateNotifications, deliverRateNotifications } from "./rate-notification-worker";
import type { AppliedOperation } from "./post-push-notification";

let client: PGlite;
let db: any;
let sent: Array<{ to: string; subject: string; html: string }>;

const JOB = 'job-001';
const all = async (q: any) => { const r: any = await db.execute(q); return Array.isArray(r) ? r : (r.rows ?? []); };

const op = (o: Partial<AppliedOperation> = {}): AppliedOperation => ({
  accountName: 'ACME', productName: 'FC', trunkPrefix: '1',
  dialPrefix: '9230', fullPrefix: '19230', destinationName: 'Afghanistan Mobile',
  requestedRate: 0.045, status: 'succeeded', refusedBeforeWrite: false, ...o,
});

const recorder = async (m: any) => { sent.push(m); return { ok: true }; };
const deps = (send?: any) => ({ db, send, today: () => '2026-09-11' });

const owe = (ops: AppliedOperation[] = [op()], jobId = JOB) =>
  createObligationsForPush(db, { jobId, operations: ops, productLabelFor: () => 'Voice A-Z' });

beforeAll(async () => {
  client = await PGlite.create();
  db = drizzle(client);
  await client.exec(`
    CREATE TABLE companies (id SERIAL PRIMARY KEY, name VARCHAR(256) UNIQUE NOT NULL, account_prefix VARCHAR(32));
    CREATE TABLE company_contacts (id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL,
      contact_type VARCHAR(32) NOT NULL, email VARCHAR(320));
    CREATE TABLE rate_push_jobs (job_id VARCHAR(64) PRIMARY KEY);
    CREATE TABLE rate_push_operations (
      id SERIAL PRIMARY KEY, job_id VARCHAR(64) NOT NULL, operation_key VARCHAR(128) NOT NULL,
      sequence INTEGER NOT NULL, account_name VARCHAR(160) NOT NULL, product_name VARCHAR(64),
      trunk_prefix VARCHAR(8), dial_prefix VARCHAR(64), full_prefix VARCHAR(32) NOT NULL,
      destination_name VARCHAR(256), requested_rate NUMERIC(18,6), status VARCHAR(24) NOT NULL,
      refused_before_write BOOLEAN);`);
  await client.exec(readFileSync(join(__dirname, '..', '..', '..', 'migrations', '518_rate_push_notifications.sql'), 'utf8'));
});
afterAll(async () => { await client?.close(); });

beforeEach(async () => {
  sent = [];
  await client.exec(`DELETE FROM rate_push_notifications; DELETE FROM company_contacts; DELETE FROM companies;`);
  await db.execute(sql`INSERT INTO companies (id, name, account_prefix) VALUES (1, 'ACME', '307')`);
  await db.execute(sql`INSERT INTO company_contacts (company_id, contact_type, email) VALUES (1, 'rates', 'pricing@acme.example')`);
});

describe("WIRING DID NOT TURN AN OBLIGATION INTO A DELIVERY", () => {
  it("sends nothing when delivery is disabled, even with a sender present", async () => {
    await owe();
    const r = await deliverRateNotifications(deps(recorder), { enabled: false });
    expect(r.disabled).toBe(true);
    expect(sent).toEqual([]);
  });

  it("sends nothing when ENABLED but no sender was injected", async () => {
    // Two deliberate acts are required. One alone is not enough, by construction.
    await owe();
    const r = await deliverRateNotifications(deps(undefined), { enabled: true });
    expect(r.disabled).toBe(true);
    expect(r.attempted).toBe(0);
  });

  it("leaves every obligation untouched while disabled - not sent, not failed", async () => {
    await owe();
    await deliverRateNotifications(deps(recorder), { enabled: false });
    const [n] = await all(sql`SELECT status, attempts, sent_at FROM rate_push_notifications`);
    expect(n.status).toBe('pending');
    expect(Number(n.attempts)).toBe(0);
    expect(n.sent_at).toBeNull();
  });

  it("preparing is always safe: it sends nothing and writes nothing", async () => {
    await owe();
    const before = await all(sql`SELECT * FROM rate_push_notifications`);
    const { prepared } = await prepareRateNotifications(deps(recorder));
    expect(prepared).toHaveLength(1);
    expect(sent).toEqual([]);
    expect(JSON.stringify(await all(sql`SELECT * FROM rate_push_notifications`))).toBe(JSON.stringify(before));
  });

  it("the module imports no transport of its own", () => {
    const CODE = readFileSync(join(__dirname, 'rate-notification-worker.ts'), 'utf8')
      .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    for (const t of ['nodemailer', 'createtransport', 'sendgrid', 'fetch(']) {
      expect(CODE.toLowerCase(), t).not.toContain(t);
    }
    expect(CODE).not.toContain("from '../../email'");
  });
});

describe("the prepared message is the certified facts, in the house style", () => {
  it("carries the frozen rows, the right recipient and the CID logo", async () => {
    await owe();
    const { prepared } = await prepareRateNotifications(deps());
    const [m] = prepared;
    expect(m.to).toEqual(['pricing@acme.example']);
    expect(m.kind).toBe('CHANGES');
    expect(m.rowCount).toBe(1);
    expect(m.attachment?.cid).toBe('ichibaan-logo');
    expect(m.html).toContain(`cid:${m.attachment!.cid}`);
  });

  it("shows 9230 and NEVER the execution prefix 19230", async () => {
    await owe();
    const [m] = (await prepareRateNotifications(deps())).prepared;
    expect(m.html).toMatch(/>9230</);
    expect(m.html).not.toContain('19230');
    // The dial format is composed from the account prefix and product digit only.
    expect(m.html).toContain('3071[Country Code][Number]');
  });

  it("carries the CHANGES clause and never the deletion clause", async () => {
    await owe();
    const [m] = (await prepareRateNotifications(deps())).prepared;
    expect(m.html).toContain('CHANGES (PARTIAL) NOTIFICATION');
    expect(m.html).not.toMatch(/considered DELETED/i);
    expect(m.subject).toContain('(CHANGES)');
  });

  it("only certified operations reach the message", async () => {
    await owe([
      op({ dialPrefix: '9230', status: 'succeeded' }),
      op({ dialPrefix: '9231', status: 'indeterminate' }),
    ]);
    const [m] = (await prepareRateNotifications(deps())).prepared;
    expect(m.rowCount).toBe(1);
    expect(m.html).toMatch(/>9230</);
    expect(m.html).not.toMatch(/>9231</);
  });
});

describe("an obligation that cannot be prepared is BLOCKED, never dropped", () => {
  it("a client with only a technical contact is blocked with a reason", async () => {
    // The pricing audience is commercial and rates. A NOC address is not a fallback.
    await client.exec(`DELETE FROM company_contacts`);
    await db.execute(sql`INSERT INTO company_contacts (company_id, contact_type, email) VALUES (1, 'technical', 'noc@acme.example')`);
    await owe();
    const { prepared, blocked } = await prepareRateNotifications(deps());
    expect(prepared).toHaveLength(0);
    expect(blocked[0].reason).toMatch(/no commercial or rates contact/i);
  });

  it("an unknown company is blocked rather than treated as nobody to tell", async () => {
    await owe([op({ accountName: 'GHOST' })]);
    const { prepared, blocked } = await prepareRateNotifications(deps());
    expect(prepared).toHaveLength(0);
    expect(blocked[0].reason).toMatch(/no company named/i);
  });

  it("a blocked obligation stays owed, so the gap can be fixed and retried", async () => {
    await client.exec(`DELETE FROM company_contacts`);
    await owe();
    await deliverRateNotifications(deps(recorder), { enabled: true });
    const [n] = await all(sql`SELECT status FROM rate_push_notifications`);
    expect(n.status).toBe('pending');   // not failed, not sent - it was never attempted
  });
});

describe("delivery, when both acts are deliberate", () => {
  it("sends and records who was told", async () => {
    await owe();
    const r = await deliverRateNotifications(deps(recorder), { enabled: true });
    expect(r.sent).toBe(1);
    expect(sent[0].to).toBe('pricing@acme.example');
    const [n] = await all(sql`SELECT status, sent_at, recipients FROM rate_push_notifications`);
    expect(n.status).toBe('sent');
    expect(n.sent_at).not.toBeNull();
    expect(n.recipients).toBe('pricing@acme.example');
  });

  it("a failure stays owed, with its reason", async () => {
    await owe();
    await deliverRateNotifications({ db, send: async () => ({ ok: false, error: 'SMTP 421' }) }, { enabled: true });
    const [n] = await all(sql`SELECT status, last_error, attempts FROM rate_push_notifications`);
    expect(n.status).toBe('failed');
    expect(n.last_error).toContain('421');
    expect(Number(n.attempts)).toBe(1);
  });

  it("a send that throws is a failure, not a crash", async () => {
    await owe();
    const r = await deliverRateNotifications({ db, send: async () => { throw new Error('reset'); } }, { enabled: true });
    expect(r.failed).toBe(1);
  });

  it("a delivered obligation is not delivered again", async () => {
    await owe();
    await deliverRateNotifications(deps(recorder), { enabled: true });
    sent = [];
    await deliverRateNotifications(deps(recorder), { enabled: true });
    expect(sent).toEqual([]);
  });

  it("delivery never touches the switch or the obligation's frozen rows", async () => {
    await owe();
    const before = (await all(sql`SELECT rows_json FROM rate_push_notifications`))[0];
    await deliverRateNotifications(deps(recorder), { enabled: true });
    const after = (await all(sql`SELECT rows_json FROM rate_push_notifications`))[0];
    expect(JSON.stringify(after.rows_json)).toBe(JSON.stringify(before.rows_json));
  });
});

describe("the push hook creates obligations and cannot send", () => {
  const ROUTES = readFileSync(join(__dirname, '..', '..', 'routes.ts'), 'utf8');
  /**
   * The hook's OWN text, bounded by its section marker and the statement after it.
   *
   * A fixed character window around the call spills into neighbouring code and reads its
   * `product_rates` as the hook's - which is exactly how a source assertion ends up testing a
   * different function than the one it names.
   */
  const HOOK = (() => {
    const start = ROUTES.indexOf('// ── Record what this push owes clients');
    expect(start, 'the hook must exist').toBeGreaterThan(-1);
    const end = ROUTES.indexOf('const ok    = results.filter', start);
    return ROUTES.slice(start, end);
  })();
  /** The hook's CODE. Its own comment explains why product_rates is not read; an assertion that
   *  the explanation satisfies would guard nothing. */
  const HOOK_CODE = HOOK.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

  it("push completion records what it owes", () => {
    expect(HOOK).toContain('createObligationsForPush');
    expect(HOOK).toContain('loadOperationsForPush');
    expect(HOOK).toContain("createdVia: 'push'");
  });

  it("it derives from the durable operation records, not product_rates", () => {
    expect(HOOK_CODE).not.toContain('product_rates');
    expect(HOOK_CODE).not.toContain('resolveDefaultRates');
    expect(HOOK_CODE).toContain('loadOperationsForPush');
  });

  it("a failure to record does NOT fail the push", () => {
    // The switch has already been mutated. Throwing here would turn a successful push into an
    // error response and invite a retry that writes again.
    expect(HOOK).toContain('recovery will re-derive them');
    expect(HOOK).toMatch(/catch\s*\(/);
  });

  it("the hook sends nothing", () => {
    for (const t of ['sendMail', 'sendDirectEmail', 'deliverRateNotifications']) {
      expect(HOOK_CODE, t).not.toContain(t);
    }
  });
});
