/**
 * Who receives a rate notification, against real Postgres.
 *
 * The load-bearing assertions are the EXCLUSIONS. A rate sheet names a customer's prices, and the
 * failure that matters is not "nobody got it" - it is "the wrong people did". A NOC engineer given
 * an address for incident handling should not receive a commercial pricing document.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  resolveRateNotificationRecipients, resolveRateRecipientsByName,
  RATE_NOTIFICATION_CONTACT_TYPES,
} from "./rate-notification-recipients";

let client: PGlite;
let db: any;
const ACME = 1;

const addContact = (companyId: number, type: string, email: string | null) =>
  db.execute(sql`INSERT INTO company_contacts (company_id, contact_type, email) VALUES (${companyId}, ${type}, ${email})`);

beforeAll(async () => {
  client = await PGlite.create();
  db = drizzle(client);
  await client.exec(`
    CREATE TABLE companies (id SERIAL PRIMARY KEY, name VARCHAR(256) UNIQUE NOT NULL,
      account_prefix VARCHAR(32));
    CREATE TABLE company_contacts (id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL,
      contact_type VARCHAR(32) NOT NULL, email VARCHAR(320));`);
});
afterAll(async () => { await client?.close(); });

beforeEach(async () => {
  await client.exec(`DELETE FROM company_contacts; DELETE FROM companies;`);
  await db.execute(sql`INSERT INTO companies (id, name, account_prefix) VALUES (${ACME}, 'ACME', '307')`);
});

describe("the audience is commercial and rates, and nothing else", () => {
  it("includes commercial and rates contacts", async () => {
    await addContact(ACME, 'commercial', 'sales@acme.example');
    await addContact(ACME, 'rates', 'pricing@acme.example');
    const r = await resolveRateNotificationRecipients(db, ACME) as any;
    expect(r.emails.sort()).toEqual(['pricing@acme.example', 'sales@acme.example']);
  });

  it("EXCLUDES technical, support and noc - they handle connectivity, not prices", async () => {
    // The defect this module exists to fix: the previous query included all three, contradicting
    // its own comment, so pricing documents reached incident-handling inboxes.
    await addContact(ACME, 'commercial', 'sales@acme.example');
    for (const t of ['technical', 'support', 'noc']) await addContact(ACME, t, `${t}@acme.example`);
    const r = await resolveRateNotificationRecipients(db, ACME) as any;
    expect(r.emails).toEqual(['sales@acme.example']);
    for (const t of ['technical', 'support', 'noc']) {
      expect(r.emails, t).not.toContain(`${t}@acme.example`);
    }
  });

  it("EXCLUDES finance, billing and invoicing, as it always has", async () => {
    await addContact(ACME, 'rates', 'pricing@acme.example');
    for (const t of ['finance', 'billing', 'invoicing']) await addContact(ACME, t, `${t}@acme.example`);
    const r = await resolveRateNotificationRecipients(db, ACME) as any;
    expect(r.emails).toEqual(['pricing@acme.example']);
  });

  it("the allowed set is exactly two types, stated once", async () => {
    expect([...RATE_NOTIFICATION_CONTACT_TYPES]).toEqual(['commercial', 'rates']);
  });

  it("matches contact_type case-insensitively", async () => {
    await addContact(ACME, 'Commercial', 'sales@acme.example');
    await addContact(ACME, 'RATES', 'pricing@acme.example');
    const r = await resolveRateNotificationRecipients(db, ACME) as any;
    expect(r.emails).toHaveLength(2);
  });
});

describe("an empty result is explained, not silent", () => {
  it("a company with only technical contacts gets a REASON, not a bare empty list", async () => {
    // "Nobody was notified" must be traceable to a configuration gap somebody can fix.
    await addContact(ACME, 'technical', 'noc@acme.example');
    const r = await resolveRateNotificationRecipients(db, ACME) as any;
    expect(r.emails).toEqual([]);
    expect(r.reason).toMatch(/no commercial or rates contact/i);
    expect(r.reason).toMatch(/add a commercial or rates contact/i);
  });

  it("a company with no contacts at all is explained the same way", async () => {
    const r = await resolveRateNotificationRecipients(db, ACME) as any;
    expect(r.emails).toEqual([]);
    expect(r.reason).toBeTruthy();
  });

  it("a company that does not exist is an error, not an empty audience", async () => {
    const r = await resolveRateNotificationRecipients(db, 9999) as any;
    expect(r.error).toMatch(/not found/i);
  });
});

describe("addresses are cleaned without being invented", () => {
  it("de-duplicates the same person listed twice, case-insensitively", async () => {
    await addContact(ACME, 'commercial', 'Sales@ACME.example');
    await addContact(ACME, 'rates', 'sales@acme.example');
    const r = await resolveRateNotificationRecipients(db, ACME) as any;
    expect(r.emails).toEqual(['sales@acme.example']);
  });

  it("drops an entry that is not an address at all", async () => {
    await addContact(ACME, 'commercial', 'ask the KAM');
    await addContact(ACME, 'rates', 'pricing@acme.example');
    const r = await resolveRateNotificationRecipients(db, ACME) as any;
    expect(r.emails).toEqual(['pricing@acme.example']);
  });

  it("ignores null and blank addresses", async () => {
    await addContact(ACME, 'commercial', null);
    await addContact(ACME, 'rates', '');
    const r = await resolveRateNotificationRecipients(db, ACME) as any;
    expect(r.emails).toEqual([]);
  });

  it("carries the account prefix, which the dial format needs", async () => {
    await addContact(ACME, 'rates', 'pricing@acme.example');
    const r = await resolveRateNotificationRecipients(db, ACME) as any;
    expect(r.accountPrefix).toBe('307');
  });
});

describe("resolution by name, which is what a push records", () => {
  it("finds a company by name, case-insensitively", async () => {
    await addContact(ACME, 'rates', 'pricing@acme.example');
    const r = await resolveRateRecipientsByName(db, 'acme') as any;
    expect(r.companyName).toBe('ACME');
    expect(r.emails).toEqual(['pricing@acme.example']);
  });

  it("an unknown name is an error rather than a silent empty audience", async () => {
    const r = await resolveRateRecipientsByName(db, 'NOBODY') as any;
    expect(r.error).toMatch(/no company named/i);
  });
});

describe("this is the pricing audience, not the credentials audience", () => {
  const CODE = readFileSync(join(__dirname, 'rate-notification-recipients.ts'), 'utf8')
    .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

  it("the query names only commercial and rates", () => {
    expect(CODE).toContain("IN ('commercial', 'rates')");
    for (const t of ['technical', 'support', 'noc', 'finance', 'billing', 'invoicing']) {
      expect(CODE, `must not select ${t}`).not.toContain(`'${t}'`);
    }
  });

  it("sends nothing itself", () => {
    for (const t of ['sendmail', 'sendemail', 'nodemailer', 'fetch(']) {
      expect(CODE.toLowerCase(), t).not.toContain(t);
    }
  });
});
