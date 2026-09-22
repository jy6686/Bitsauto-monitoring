/**
 * Recipients resolved by the Sippy account the push targeted — identity, not a name.
 *
 * The production case that forced this: obligation `1gloabl` (the Sippy username) for the
 * company named `1global`. The name lookup found nothing and a real customer's notification
 * blocked. The username is not the short code either, and a wrong guess here mails one
 * customer's prices to another customer's contacts — so every rule below is a refusal, and the
 * only path that resolves is the one that proves identity.
 *
 * Real database (PGlite), same fixture shapes as rate-notification-recipients.test.ts plus the
 * two columns this depends on: companies.sippy_i_account and rate_push_operations.i_account.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { sql } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveRateRecipientsForObligation } from './rate-notification-recipients';

let client: PGlite;
let db: ReturnType<typeof drizzle>;

beforeAll(async () => {
  client = await PGlite.create();
  db = drizzle(client);
  await client.exec(`
    CREATE TABLE companies (id SERIAL PRIMARY KEY, name VARCHAR(256) UNIQUE NOT NULL,
      account_prefix VARCHAR(32), sippy_i_account INTEGER);
    CREATE TABLE company_contacts (id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL,
      contact_type VARCHAR(32) NOT NULL, email VARCHAR(320));
    CREATE TABLE rate_push_operations (id SERIAL PRIMARY KEY, job_id VARCHAR(128) NOT NULL,
      account_name VARCHAR(160) NOT NULL, i_account INTEGER);`);
});
afterAll(async () => { await client?.close(); });
beforeEach(async () => {
  await client.exec(`DELETE FROM company_contacts; DELETE FROM rate_push_operations; DELETE FROM companies;`);
});

const company = (id: number, name: string, iAccount: number | null) =>
  db.execute(sql`INSERT INTO companies (id, name, account_prefix, sippy_i_account) VALUES (${id}, ${name}, '1', ${iAccount})`);
const contact = (companyId: number, type: string, email: string) =>
  db.execute(sql`INSERT INTO company_contacts (company_id, contact_type, email) VALUES (${companyId}, ${type}, ${email})`);
const op = (jobId: string, accountName: string, iAccount: number | null) =>
  db.execute(sql`INSERT INTO rate_push_operations (job_id, account_name, i_account) VALUES (${jobId}, ${accountName}, ${iAccount})`);

describe('the id path — the production case', () => {
  /** `1gloabl` is not `1global`, and it must not need to be. */
  it('resolves a username that is not the company name, through the account id', async () => {
    await company(105, '1global', 1069);
    await contact(105, 'commercial', 'rates@1global.example');
    await op('job-1', '1gloabl', 1069);
    const r = await resolveRateRecipientsForObligation(db as any, { jobId: 'job-1', clientName: '1gloabl' }) as any;
    expect(r.error).toBeUndefined();
    expect(r.companyName).toBe('1global');
    expect(r.emails).toEqual(['rates@1global.example']);
  });

  /**
   * THE PRECEDENCE RULE. When an id IS recorded, a company that merely has the same NAME as the
   * username is not consulted. Otherwise the id path could be quietly bypassed by a name.
   */
  it('when an id is recorded, a same-named company does not win over the linked one', async () => {
    await company(1, 'ghost', null);             // named exactly like the username, unlinked
    await contact(1, 'commercial', 'wrong@ghost.example');
    await company(2, 'Real Owner', 555);         // owns the account
    await contact(2, 'rates', 'right@owner.example');
    await op('job-2', 'ghost', 555);
    const r = await resolveRateRecipientsForObligation(db as any, { jobId: 'job-2', clientName: 'ghost' }) as any;
    expect(r.companyName).toBe('Real Owner');
    expect(r.emails).toEqual(['right@owner.example']);
    expect(r.emails).not.toContain('wrong@ghost.example');
  });

  it('matches the account name inside the push case-insensitively (Test-31 / test-31)', async () => {
    await company(3, 'Test Thirty-One', 1065);
    await contact(3, 'commercial', 'c@t31.example');
    await op('job-3', 'Test-31', 1065);
    const r = await resolveRateRecipientsForObligation(db as any, { jobId: 'job-3', clientName: 'test-31' }) as any;
    expect(r.emails).toEqual(['c@t31.example']);
  });
});

describe('refusals — ambiguity never becomes a recipient', () => {
  /** Account 76 is claimed by two companies in production. Nobody gets picked. */
  it('an account claimed by two companies is refused, not resolved to the lowest id', async () => {
    await company(2, 'Internal-ptcl', 76);
    await contact(2, 'commercial', 'a@internal.example');
    await company(32, 'ptcl', 76);
    await contact(32, 'commercial', 'b@ptcl.example');
    await op('job-4', 'ptcl', 76);
    const r = await resolveRateRecipientsForObligation(db as any, { jobId: 'job-4', clientName: 'ptcl' }) as any;
    expect(r.error).toMatch(/claimed by 2 companies/);
    expect(r.error).toMatch(/#2 "Internal-ptcl"/);
    expect(r.error).toMatch(/#32 "ptcl"/);
    expect(r.emails).toBeUndefined();
  });

  /**
   * An id with no linked company is a configuration gap, and it is NOT rescued by a name
   * lookup: a company that happens to share the username must not receive the sheet.
   */
  it('an account no company is linked to is refused — even if a company shares the username', async () => {
    await company(7, 'orphan', null);
    await contact(7, 'commercial', 'someone@orphan.example');
    await op('job-5', 'orphan', 999);
    const r = await resolveRateRecipientsForObligation(db as any, { jobId: 'job-5', clientName: 'orphan' }) as any;
    expect(r.error).toMatch(/No company is linked to Sippy account 999/);
    expect(r.emails).toBeUndefined();
  });

  it('a push that recorded two different accounts under one name is refused', async () => {
    await company(8, 'A', 11);
    await company(9, 'B', 12);
    await op('job-6', 'shared', 11);
    await op('job-6', 'shared', 12);
    const r = await resolveRateRecipientsForObligation(db as any, { jobId: 'job-6', clientName: 'shared' }) as any;
    expect(r.error).toMatch(/2 different Sippy accounts \(11, 12\)/);
  });

  it('a linked company with no commercial/rates contact still reports the audience gap, not an error', async () => {
    await company(10, 'Silent Co', 500);
    await contact(10, 'technical', 'noc@silent.example');
    await op('job-7', 'silent', 500);
    const r = await resolveRateRecipientsForObligation(db as any, { jobId: 'job-7', clientName: 'silent' }) as any;
    expect(r.error).toBeUndefined();
    expect(r.emails).toEqual([]);
    expect(r.reason).toMatch(/no commercial or rates contact/);
  });
});

describe('the name fallback — only when no id was recorded, and exactly as before', () => {
  it('no operation rows for the job → resolves by name (legacy obligation)', async () => {
    await company(20, 'Aura', null);
    await contact(20, 'commercial', 'c@aura.example');
    const r = await resolveRateRecipientsForObligation(db as any, { jobId: 'job-gone', clientName: 'aura' }) as any;
    expect(r.companyName).toBe('Aura');
    expect(r.emails).toEqual(['c@aura.example']);
  });

  it('operation rows without an id → resolves by name (pre-511 push)', async () => {
    await company(21, 'Aura', null);
    await contact(21, 'rates', 'r@aura.example');
    await op('job-old', 'aura', null);
    const r = await resolveRateRecipientsForObligation(db as any, { jobId: 'job-old', clientName: 'aura' }) as any;
    expect(r.emails).toEqual(['r@aura.example']);
  });

  it('name fallback with no such company → the same error as before', async () => {
    const r = await resolveRateRecipientsForObligation(db as any, { jobId: 'job-none', clientName: '1gloabl' }) as any;
    expect(r.error).toBe('No company named "1gloabl".');
  });
});

describe('the worker consumes the obligation resolver', () => {
  const WORKER = readFileSync(join(__dirname, 'rate-notification-worker.ts'), 'utf8')
    .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

  it('resolves by obligation — job id and client name together — not by name alone', () => {
    expect(WORKER).toMatch(/resolveRateRecipientsForObligation\(deps\.db,\s*\{\s*jobId:\s*owed\.jobId,\s*clientName:\s*owed\.clientName\s*\}\)/);
    expect(WORKER).not.toMatch(/resolveRateRecipientsByName\(/);
  });

  it('still imports no transport — the two-acts rule holds', () => {
    expect(WORKER).not.toMatch(/from ['"]\.\.\/\.\.\/email['"]/);
  });
});
