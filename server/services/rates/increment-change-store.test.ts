/**
 * The write path for a billing-increment change, against real Postgres.
 *
 * The assertions that matter are about ATOMICITY and about what survives a failure:
 *
 *   - a client is never owed an email for a change that was not committed
 *   - a change is never lost because an email could not be delivered
 *
 * NOTHING IS SENT HERE. There is no transport in this module — rows are committed and a worker
 * delivers them later — so no test can accidentally email a real customer.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  acceptIncrementChange, resolveRecipients, pendingNotifications, recordDelivery,
  markNotifiedWhenComplete, recordApplyOutcome, changesNeedingReview,
} from "./increment-change-store";

let client: PGlite;
let db: any;

const V1 = 1, FC = 1, JAZZ = 10;
const TODAY = '2026-09-11';
const EFFECTIVE = '2026-09-20';
const ACTOR = 'junaid@ichibaanlogic.com';

const MIG = (f: string) => readFileSync(join(__dirname, '..', '..', '..', 'migrations', f), 'utf8');
const all = async (q: any) => { const r: any = await db.execute(q); return Array.isArray(r) ? r : (r.rows ?? []); };

const accept = (over: any = {}) => acceptIncrementChange(db, {
  productId: FC, destinationId: JAZZ, catalogueVersionId: V1,
  destinationName: 'PAKISTAN - MOBILE JAZZ',
  currentIncrement: '60/1', newIncrement: '30/6',
  effectiveDate: EFFECTIVE, today: TODAY, actor: ACTOR, ...over,
});

beforeAll(async () => {
  client = await PGlite.create();
  db = drizzle(client);
  await client.exec(`
    CREATE TABLE catalogue_versions (id SERIAL PRIMARY KEY, label TEXT UNIQUE NOT NULL, status TEXT NOT NULL);
    CREATE TABLE commercial_destinations (id SERIAL PRIMARY KEY,
      version_id INTEGER NOT NULL REFERENCES catalogue_versions(id), name TEXT NOT NULL);
    CREATE TABLE product_registry (id SERIAL PRIMARY KEY, code VARCHAR(16) UNIQUE NOT NULL, name VARCHAR(64) NOT NULL);
    CREATE TABLE companies (id SERIAL PRIMARY KEY, name VARCHAR(256) UNIQUE NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'active', invoice_email VARCHAR(256));
    CREATE TABLE rate_notification_templates (id SERIAL PRIMARY KEY,
      client_name VARCHAR(256) NOT NULL, product_id INTEGER NOT NULL,
      recipients TEXT, cc_emails TEXT, status VARCHAR(32) NOT NULL DEFAULT 'active');`);
  await client.exec(MIG('516_billing_increment_changes.sql'));
  await client.exec(MIG('517_billing_increment_notifications.sql'));
});
afterAll(async () => { await client?.close(); });

beforeEach(async () => {
  await client.exec(`
    DELETE FROM billing_increment_notifications;
    DELETE FROM billing_increment_changes;
    DELETE FROM rate_notification_templates;
    DELETE FROM companies;
    DELETE FROM commercial_destinations;
    DELETE FROM catalogue_versions;
    DELETE FROM product_registry;`);
  await db.execute(sql`INSERT INTO product_registry (id, code, name) VALUES (${FC}, 'FC', 'First Class')`);
  await db.execute(sql`INSERT INTO catalogue_versions (id, label, status) VALUES (${V1}, 'V1', 'active')`);
  await db.execute(sql`INSERT INTO commercial_destinations (id, version_id, name) VALUES (${JAZZ}, ${V1}, 'PAKISTAN - MOBILE JAZZ')`);
  await db.execute(sql`
    INSERT INTO companies (name, status, invoice_email) VALUES
      ('ACME',    'active',   'ops@acme.example'),
      ('BETA',    'active',   'billing@beta.example'),
      ('NOEMAIL', 'active',   NULL),
      ('GONE',    'inactive', 'old@gone.example')`);
});

describe("recipients — who is told, and from which setting", () => {
  it("prefers the configured RATE notification recipients over the invoice address", async () => {
    // An invoice address is for invoices. Announcing a commercial rate change to an
    // accounts-payable inbox because it was the first address found is a real defect.
    await db.execute(sql`
      INSERT INTO rate_notification_templates (client_name, product_id, recipients)
      VALUES ('ACME', ${FC}, 'rates@acme.example')`);
    const { recipients } = await resolveRecipients(db, FC);
    const acme = recipients.filter(r => r.clientName === 'ACME');
    expect(acme).toHaveLength(1);
    expect(acme[0]).toMatchObject({ email: 'rates@acme.example', source: 'rate_notification_template' });
  });

  it("falls back to the invoice address for a client with no rate template", async () => {
    const { recipients } = await resolveRecipients(db, FC);
    expect(recipients.find(r => r.clientName === 'BETA')).toMatchObject({
      email: 'billing@beta.example', source: 'company_invoice_email',
    });
  });

  it("SKIPS a client with no address, and names it — not a failure", async () => {
    const { recipients, skipped } = await resolveRecipients(db, FC);
    expect(recipients.some(r => r.clientName === 'NOEMAIL')).toBe(false);
    expect(skipped).toContain('NOEMAIL');
  });

  it("ignores inactive companies", async () => {
    const { recipients } = await resolveRecipients(db, FC);
    expect(recipients.some(r => r.clientName === 'GONE')).toBe(false);
  });

  it("de-duplicates one person configured twice", async () => {
    // One human being, one announcement.
    await db.execute(sql`
      INSERT INTO rate_notification_templates (client_name, product_id, recipients, cc_emails)
      VALUES ('ACME', ${FC}, 'rates@acme.example, RATES@ACME.EXAMPLE', 'rates@acme.example')`);
    const { recipients } = await resolveRecipients(db, FC);
    expect(recipients.filter(r => r.email === 'rates@acme.example')).toHaveLength(1);
  });

  it("ignores an entry that is not an address at all", async () => {
    await db.execute(sql`
      INSERT INTO rate_notification_templates (client_name, product_id, recipients)
      VALUES ('ACME', ${FC}, 'ask sales, rates@acme.example')`);
    const { recipients } = await resolveRecipients(db, FC);
    expect(recipients.map(r => r.email)).not.toContain('ask sales');
  });
});

describe("ATOMICITY — the promise and the obligation become true together", () => {
  it("accepting commits the change AND one notification per recipient", async () => {
    const r = await accept();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(await all(sql`SELECT * FROM billing_increment_changes`)).toHaveLength(1);
    const notes = await all(sql`SELECT * FROM billing_increment_notifications`);
    expect(notes).toHaveLength(r.notified);
    expect(notes.every((n: any) => n.status === 'pending')).toBe(true);
  });

  it("60/1 -> 30/6 creates exactly ONE scheduled change, field for field", async () => {
    // The acceptance row itself, not inferred from the notification text. A change whose stored
    // date or previous increment differs from what was requested is a different commitment from
    // the one the client was told about.
    const r = await accept();
    expect(r.ok).toBe(true);
    const changes = await all(sql`SELECT * FROM billing_increment_changes`);
    expect(changes).toHaveLength(1);
    const [c] = changes;
    expect(c.previous_increment).toBe('60/1');          // the CURRENT increment is preserved
    expect(c.new_increment).toBe('30/6');
    expect(String(c.effective_date).slice(0, 10)).toBe(EFFECTIVE);   // preserved EXACTLY
    expect(c.status).toBe('accepted');                  // scheduled, not applied
    expect(c.applied_at).toBeNull();                    // the switch has not been told
    expect(c.notified_at).toBeNull();                   // nor have the clients, yet
    expect(c.created_by).toBe(ACTOR);
    expect(Number(c.product_id)).toBe(FC);
    expect(Number(c.destination_id)).toBe(JAZZ);
    expect(Number(c.catalogue_version_id)).toBe(V1);
  });

  it("the stored date is the one the notification names — one date, not two", async () => {
    // The whole contract: the date clients are told is the date the switch will be changed.
    // Two fields drifting apart is how that promise gets broken silently.
    const r = await accept();
    const [c] = await all(sql`SELECT effective_date FROM billing_increment_changes`);
    const [n] = await all(sql`SELECT message FROM billing_increment_notifications LIMIT 1`);
    expect(String(n.message)).toContain(String(c.effective_date).slice(0, 10));
  });

  it("a normalised increment is stored canonically, not as typed", async () => {
    const r = await accept({ newIncrement: '30 / 6' });
    expect(r.ok).toBe(true);
    const [c] = await all(sql`SELECT new_increment FROM billing_increment_changes`);
    expect(c.new_increment).toBe('30/6');
  });

  it("the notification text names the destination, both increments and the date", async () => {
    const r = await accept();
    const [n] = await all(sql`SELECT message FROM billing_increment_notifications LIMIT 1`);
    expect(String(n.message)).toContain('PAKISTAN - MOBILE JAZZ');
    expect(String(n.message)).toContain('30/6');
    expect(String(n.message)).toContain(EFFECTIVE);
    if (r.ok) expect(r.message).toBe(String(n.message));
  });

  it("a REFUSED change writes nothing — no record, so no client is owed anything", async () => {
    const r = await accept({ newIncrement: '60/1' });   // same increment
    expect(r.ok).toBe(false);
    expect(await all(sql`SELECT * FROM billing_increment_changes`)).toHaveLength(0);
    expect(await all(sql`SELECT * FROM billing_increment_notifications`)).toHaveLength(0);
  });

  it("a past effective date is refused before anything is written", async () => {
    const r = await accept({ effectiveDate: '2026-09-01' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('effective_date_in_past');
    expect(await all(sql`SELECT * FROM billing_increment_notifications`)).toHaveLength(0);
  });

  it("a second change for the same destination on the same date is refused", async () => {
    await accept();
    const r = await accept({ newIncrement: '15/1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('duplicate_change');
    // And the first change's notifications are untouched.
    const notes = await all(sql`SELECT DISTINCT change_id FROM billing_increment_notifications`);
    expect(notes).toHaveLength(1);
  });

  it("if the notification write fails, the CHANGE rolls back with it", async () => {
    // The property the outbox exists for, forced: no half state where a change is committed
    // with nobody owed an email, and none where an email is owed for a change that vanished.
    await client.exec(`ALTER TABLE billing_increment_notifications ADD CONSTRAINT tmp_boom CHECK (message = 'never')`);
    const r = await accept();
    expect(r.ok).toBe(false);
    expect(await all(sql`SELECT * FROM billing_increment_changes`)).toHaveLength(0);
    await client.exec(`ALTER TABLE billing_increment_notifications DROP CONSTRAINT tmp_boom`);
  });

  it("nothing in this module sends anything", () => {
    const src = readFileSync(join(__dirname, 'increment-change-store.ts'), 'utf8');
    for (const transport of ['nodemailer', 'sendMail', 'sendEmail', 'fetch(', 'axios']) {
      expect(src, `must not reach a transport: ${transport}`).not.toContain(transport);
    }
  });
});

describe("THE CATALOGUE IS NEVER WRITTEN, AND CANNOT OVERWRITE THE COMMITMENT", () => {
  it("scheduling a change leaves the supplier increment untouched", async () => {
    await client.exec(`
      CREATE TABLE IF NOT EXISTS commercial_destination_prefixes (
        id SERIAL PRIMARY KEY, version_id INTEGER NOT NULL, destination_id INTEGER NOT NULL,
        prefix TEXT NOT NULL, billing_increment TEXT)`);
    await client.exec(`DELETE FROM commercial_destination_prefixes`);
    await db.execute(sql`
      INSERT INTO commercial_destination_prefixes (version_id, destination_id, prefix, billing_increment)
      VALUES (${V1}, ${JAZZ}, '9230', '60/1')`);

    await accept();

    const [p] = await all(sql`SELECT billing_increment FROM commercial_destination_prefixes WHERE prefix = '9230'`);
    // Supplier data is source data. The commitment lives elsewhere precisely so this stays true.
    expect(p.billing_increment).toBe('60/1');
  });

  it("a supplier re-import CANNOT overwrite the commercial change", async () => {
    await client.exec(`
      CREATE TABLE IF NOT EXISTS commercial_destination_prefixes (
        id SERIAL PRIMARY KEY, version_id INTEGER NOT NULL, destination_id INTEGER NOT NULL,
        prefix TEXT NOT NULL, billing_increment TEXT)`);
    await client.exec(`DELETE FROM commercial_destination_prefixes`);
    await db.execute(sql`
      INSERT INTO commercial_destination_prefixes (version_id, destination_id, prefix, billing_increment)
      VALUES (${V1}, ${JAZZ}, '9230', '60/1')`);
    const r = await accept();

    // The vendor file lands and replaces the supplier value — the thing that would have silently
    // reverted a commitment if the increment had been edited in place.
    await db.execute(sql`UPDATE commercial_destination_prefixes SET billing_increment = '1/1' WHERE prefix = '9230'`);

    const [c] = await all(sql`SELECT previous_increment, new_increment, effective_date, status FROM billing_increment_changes`);
    expect(c.new_increment).toBe('30/6');
    expect(c.previous_increment).toBe('60/1');
    expect(String(c.effective_date).slice(0, 10)).toBe(EFFECTIVE);
    expect(c.status).toBe('accepted');
    // And the clients still hold exactly what they were promised.
    const [n] = await all(sql`SELECT message FROM billing_increment_notifications LIMIT 1`);
    expect(String(n.message)).toContain('30/6');
    expect(String(n.message)).toContain(EFFECTIVE);
    if (r.ok) expect(r.changeId).toBeGreaterThan(0);
  });
});

describe("DELIVERY — a failure loses the email, never the change", () => {
  it("pending notifications are what the worker should attempt", async () => {
    await accept();
    const pending = await pendingNotifications(db);
    expect(pending.length).toBeGreaterThan(0);
    expect(pending[0].message).toContain('30/6');
  });

  it("a failed delivery keeps the change, records why, and stays owed", async () => {
    await accept();
    const [n] = await pendingNotifications(db);
    await recordDelivery(db, n.id, { sent: false, error: 'SMTP 421 service unavailable' });

    const [row] = await all(sql`SELECT * FROM billing_increment_notifications WHERE id = ${n.id}`);
    expect(row.status).toBe('failed');
    expect(row.last_error).toContain('421');
    expect(Number(row.attempts)).toBe(1);
    // The commercial change is untouched.
    expect(await all(sql`SELECT * FROM billing_increment_changes`)).toHaveLength(1);
    // And it is still owed.
    expect((await pendingNotifications(db)).some(p => p.id === n.id)).toBe(true);
  });

  it("a retry updates the same row rather than telling the client twice", async () => {
    await accept();
    const [n] = await pendingNotifications(db);
    await recordDelivery(db, n.id, { sent: false, error: 'first attempt' });
    await recordDelivery(db, n.id, { sent: true });
    const rowsFor = await all(sql`SELECT * FROM billing_increment_notifications WHERE id = ${n.id}`);
    expect(rowsFor).toHaveLength(1);
    expect(rowsFor[0].status).toBe('sent');
    expect(Number(rowsFor[0].attempts)).toBe(2);
    expect(rowsFor[0].last_error).toBeNull();
  });

  it("the change is NOT marked notified while any client is still owed", async () => {
    await accept();
    const pending = await pendingNotifications(db);
    await recordDelivery(db, pending[0].id, { sent: true });
    expect(await markNotifiedWhenComplete(db, pending[0].changeId)).toBe(false);
    const [c] = await all(sql`SELECT status FROM billing_increment_changes`);
    expect(c.status).toBe('accepted');
  });

  it("and IS marked notified once every client has been told", async () => {
    const r = await accept();
    for (const p of await pendingNotifications(db)) await recordDelivery(db, p.id, { sent: true });
    if (!r.ok) return;
    expect(await markNotifiedWhenComplete(db, r.changeId)).toBe(true);
    const [c] = await all(sql`SELECT status, notified_count FROM billing_increment_changes`);
    expect(c.status).toBe('notified');
    expect(Number(c.notified_count)).toBe(r.notified);
  });
});

describe("APPLIED IS EARNED, NOT ASSUMED", () => {
  const changeId = async () => {
    const r = await accept();
    if (!r.ok) throw new Error('setup failed');
    return r.changeId;
  };

  it("THE INVARIANT: notifying every client does not make a change applied", async () => {
    // A commercial commitment and a client notification are not evidence about a switch.
    const id = await changeId();
    for (const p of await pendingNotifications(db)) await recordDelivery(db, p.id, { sent: true });
    await markNotifiedWhenComplete(db, id);

    const [c] = await all(sql`SELECT status, applied_at FROM billing_increment_changes WHERE id = ${id}`);
    expect(c.status).toBe('notified');
    expect(c.applied_at).toBeNull();
  });

  it("an APPLIED outcome records the evidence, not merely the status", async () => {
    const id = await changeId();
    await recordApplyOutcome(db, id, { verdict: 'applied', increment: '30/6', prefixesVerified: 3, appliedBy: ACTOR });
    const [c] = await all(sql`SELECT * FROM billing_increment_changes WHERE id = ${id}`);
    expect(c.status).toBe('applied');
    expect(c.applied_at).not.toBeNull();
    expect(c.applied_increment).toBe('30/6');
    expect(Number(c.prefixes_verified)).toBe(3);
  });

  it("the schema REFUSES an applied row with no evidence", async () => {
    // Belt and braces: even a hand-written UPDATE cannot claim applied without proof.
    const id = await changeId();
    await expect(client.exec(
      `UPDATE billing_increment_changes SET status='applied', applied_at=NOW(), applied_by='x' WHERE id=${id}`
    )).rejects.toThrow(/bic_applied_proven/);
  });

  it("NEEDS_REVIEW is durable, explained, and distinct from failed", async () => {
    const id = await changeId();
    await recordApplyOutcome(db, id, { verdict: 'needs_review', message: 'write sent, read-back failed' });
    const [c] = await all(sql`SELECT status, failure_reason, applied_at FROM billing_increment_changes WHERE id = ${id}`);
    expect(c.status).toBe('needs_review');
    expect(c.failure_reason).toContain('read-back failed');
    // Not applied. Something may have happened, and we do not claim it did.
    expect(c.applied_at).toBeNull();
    expect(await changesNeedingReview(db)).toHaveLength(1);
  });

  it("a REFUSAL leaves the change due — the commitment is still owed", async () => {
    const id = await changeId();
    await recordApplyOutcome(db, id, { verdict: 'refused', code: 'lock_unavailable', message: 'tariff busy' });
    const [c] = await all(sql`SELECT status, applied_at, attempts, failure_reason FROM billing_increment_changes WHERE id = ${id}`);
    // Nothing was sent, so nothing is retired.
    expect(c.status).toBe('accepted');
    expect(c.applied_at).toBeNull();
    expect(Number(c.attempts)).toBe(1);
    expect(c.failure_reason).toContain('lock_unavailable');
  });

  it("a refusal cannot un-apply a change that is already applied", async () => {
    const id = await changeId();
    await recordApplyOutcome(db, id, { verdict: 'applied', increment: '30/6', prefixesVerified: 3, appliedBy: ACTOR });
    await recordApplyOutcome(db, id, { verdict: 'refused', code: 'already_applied', message: 'not re-sending' });
    const [c] = await all(sql`SELECT status FROM billing_increment_changes WHERE id = ${id}`);
    expect(c.status).toBe('applied');
  });

  it("the four states are all representable and distinct", async () => {
    const ids = [] as number[];
    for (const d of ['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23']) {
      const r = await accept({ effectiveDate: d, newIncrement: '30/6' });
      if (r.ok) ids.push(r.changeId);
    }
    await recordApplyOutcome(db, ids[1], { verdict: 'applied', increment: '30/6', prefixesVerified: 1, appliedBy: ACTOR });
    await recordApplyOutcome(db, ids[2], { verdict: 'needs_review', message: 'unproven' });
    await client.exec(`UPDATE billing_increment_changes SET status='cancelled', cancelled_at=NOW(), cancelled_by='x' WHERE id=${ids[3]}`);

    const states = await all(sql`SELECT id, status FROM billing_increment_changes ORDER BY id`);
    const byId = Object.fromEntries(states.map((s: any) => [Number(s.id), s.status]));
    expect(byId[ids[0]]).toBe('accepted');       // scheduled
    expect(byId[ids[1]]).toBe('applied');        // proven
    expect(byId[ids[2]]).toBe('needs_review');   // sent, unproven
    expect(byId[ids[3]]).toBe('cancelled');      // never reaches the switch
  });
});
