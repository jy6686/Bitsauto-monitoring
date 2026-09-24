/**
 * The rate sheet on an automatic notification is the frozen rows, printed — and says CHANGES.
 *
 * Two things this proves that a green build would not: the sheet is built from `rows_json` and
 * nothing else (no product_rates, no catalogue, no switch), and its terms never carry the FULL
 * sheet's "any destination not listed is DELETED" — which, attached to a CHANGES email, would
 * tell the customer the opposite of what the email says.
 *
 * The fixture is production obligation 5 as it stands after the 2026-09-23 backfill: 1global,
 * First Class, 9376/9377 Afghanistan MTN at 0.0199, effective 2026-09-19 14:45.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { sql } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import {
  buildFrozenRateSheetModel, buildFrozenRateSheetAttachment, frozenSheetFilename,
  RATE_SHEET_TERMS_CHANGES, CHANGES_SCOPE_SENTENCE, XLSX_CONTENT_TYPE,
} from './frozen-rate-sheet';
import { RATE_SHEET_TERMS } from '../provisioning/rate-sheet-model';
import { createObligationsForPush } from './post-push-obligation';
import type { AppliedOperation } from './post-push-notification';
import { prepareRateNotifications, deliverRateNotifications } from './rate-notification-worker';
import { buildRateNotificationSender } from './rate-notification-auto';

/** Every cell of every sheet, as one string — so a workbook can be asserted on like text. */
async function workbookText(buf: Buffer): Promise<string> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  const out: string[] = [];
  wb.eachSheet(ws => ws.eachRow(row => row.eachCell(c => out.push(String(c.value ?? '')))));
  return out.join('\n');
}

const SENT_AT = new Date('2026-09-23T09:00:00Z');
const OBLIGATION_5 = {
  companyName: '1global', productLabel: 'First Class', accountPrefix: '1019', kamName: 'Junaid',
  issueDate: '2026-09-23', sentAt: SENT_AT,
  rows: [
    { rate: '0.019900', prefix: '9376', currency: 'USD', destination: 'AFGHANISTAN - MOBILE MTN', productCode: 'First Class', productDigit: '1', productLabel: 'First Class', effectiveDate: '2026-09-19 14:45' },
    { rate: '0.019900', prefix: '9377', currency: 'USD', destination: 'AFGHANISTAN - MOBILE MTN', productCode: 'First Class', productDigit: '1', productLabel: 'First Class', effectiveDate: '2026-09-19 14:45' },
  ],
};

describe('the model is the frozen rows, printed', () => {
  it('one sheet row per frozen row, in order, with the frozen values', () => {
    const m = buildFrozenRateSheetModel(OBLIGATION_5);
    expect(m.rows.map(r => r.prefix)).toEqual(['9376', '9377']);
    expect(m.rows.map(r => r.rate)).toEqual([0.0199, 0.0199]);
    expect(m.rows[0]).toMatchObject({ country: 'AFGHANISTAN', destination: 'AFGHANISTAN - MOBILE MTN', status: 'N' });
  });

  /** THE date. Not the send date, not the issue date — the one the switch was given. */
  it('prints the frozen effective date, not the day the sheet was made', () => {
    const m = buildFrozenRateSheetModel(OBLIGATION_5);
    expect(m.rows.map(r => r.effectiveDate)).toEqual(['19-Sep-2026', '19-Sep-2026']);
    expect(m.rows.map(r => r.effectiveTime)).toEqual(['14:45', '14:45']);
    expect(m.header.sendDate).toBe('23-Sep-2026');
  });

  it('a row that froze no date falls back to the issue date — the same rule as the email body', () => {
    const rows = OBLIGATION_5.rows.map(r => ({ ...r, effectiveDate: undefined }));
    const m = buildFrozenRateSheetModel({ ...OBLIGATION_5, rows });
    expect(m.rows[0].effectiveDate).toBe('23-Sep-2026');
    expect(m.rows[0].effectiveTime).toBe('');
  });

  /** Not frozen, so not printed. Not "60/1", not "1/1", not anything. */
  it('the billing increment is BLANK — nothing is inferred', () => {
    const m = buildFrozenRateSheetModel(OBLIGATION_5);
    expect(m.rows.every(r => r.billingIncrement === '')).toBe(true);
  });

  it('technical prefix is account prefix + product digit, from the frozen rows', () => {
    expect(buildFrozenRateSheetModel(OBLIGATION_5).header.technicalPrefix).toBe('10191');
    expect(buildFrozenRateSheetModel({ ...OBLIGATION_5, accountPrefix: null }).header.technicalPrefix).toBe('1');
  });

  it('KAM name from the company record; KAM email blank — there is no source for it here', () => {
    const h = buildFrozenRateSheetModel(OBLIGATION_5).header;
    expect(h).toMatchObject({ companyName: '1global', productLabel: 'First Class', kamName: 'Junaid', kamEmail: '' });
    expect(buildFrozenRateSheetModel({ ...OBLIGATION_5, kamName: null }).header.kamName).toBe('');
  });

  it('filename follows the manual convention, with CHANGES where it wrote FULL', () => {
    expect(frozenSheetFilename('1global', 'First Class', SENT_AT)).toBe('1GLOBAL-First_Class-20260923-0900-CHANGES.xlsx');
    expect(buildFrozenRateSheetModel(OBLIGATION_5)).toBeTruthy();
  });
});

describe('the terms say CHANGES, and never the deletion clause', () => {
  it('carries the owner\'s CHANGES sentence, verbatim', () => {
    const m = buildFrozenRateSheetModel(OBLIGATION_5);
    expect(m.terms.some(p => p.includes(CHANGES_SCOPE_SENTENCE))).toBe(true);
    expect(CHANGES_SCOPE_SENTENCE).toBe('This sheet lists only the destinations whose rates changed; all other destinations and rates remain as previously notified.');
  });

  /** THE contradiction this exists to prevent. */
  it('never says DELETED, never says FULL rate sheet', () => {
    const text = buildFrozenRateSheetModel(OBLIGATION_5).terms.join('\n');
    expect(text).not.toMatch(/DELETED/);
    expect(text).not.toMatch(/FULL rate sheet/);
  });

  it('keeps every other commitment the FULL terms make (acceptance window, increments, authorised address)', () => {
    expect(RATE_SHEET_TERMS_CHANGES).toHaveLength(RATE_SHEET_TERMS.length);
    expect(RATE_SHEET_TERMS_CHANGES.filter(p => RATE_SHEET_TERMS.includes(p))).toHaveLength(RATE_SHEET_TERMS.length - 1);
    expect(RATE_SHEET_TERMS_CHANGES.join(' ')).toMatch(/pricing@ichibaanlogic\.com/);
  });
});

describe('the workbook the customer opens', () => {
  it('is a real XLSX with the frozen prefixes, rates, the effective date and the CHANGES terms', async () => {
    const att = await buildFrozenRateSheetAttachment(OBLIGATION_5);
    expect(att.contentType).toBe(XLSX_CONTENT_TYPE);
    expect(att.filename).toBe('1GLOBAL-First_Class-20260923-0900-CHANGES.xlsx');
    const text = await workbookText(att.content);
    for (const must of ['9376', '9377', '19-Sep-2026', 'AFGHANISTAN', '1global', 'First Class', '10191', CHANGES_SCOPE_SENTENCE]) {
      expect(text, must).toContain(must);
    }
    expect(text).not.toMatch(/DELETED/);
    expect(text).not.toMatch(/FULL rate sheet/);
  });
});

describe('the module reads nothing but the frozen rows', () => {
  // Code only: the header comment is allowed to NAME product_rates while explaining why it is
  // not read. Same discipline as the wiring test.
  const strip = (t: string) => t.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const SRC = strip(readFileSync(join(__dirname, 'frozen-rate-sheet.ts'), 'utf8'));
  const WORKER = strip(readFileSync(join(__dirname, 'rate-notification-worker.ts'), 'utf8'));
  it('no product_rates, no catalogue assembly, no switch, no database', () => {
    for (const forbidden of ['product_rates', 'assembleRateSheets', 'sippy', 'Sippy', 'db.execute', 'from \'../../db\'', 'drizzle-orm']) {
      expect(SRC, forbidden).not.toContain(forbidden);
    }
  });
  it('the worker still never assembles a sheet from product_rates', () => {
    expect(WORKER).not.toMatch(/assembleRateSheets|product_rates/);
    expect(WORKER).toMatch(/buildFrozenRateSheetAttachment\(/);
  });
});

// ── The worker, end to end, against PGlite ────────────────────────────────────────────────
let client: PGlite;
let db: any;
let sentMsgs: any[];
const JOB = 'job-1789826439720';
const op = (o: Partial<AppliedOperation> = {}): AppliedOperation => ({
  accountName: '1gloabl', productName: 'First Class', trunkPrefix: '1',
  dialPrefix: '9376', fullPrefix: '19376', destinationName: 'AFGHANISTAN - MOBILE MTN',
  requestedRate: 0.0199, status: 'succeeded', refusedBeforeWrite: false, effectiveFrom: '2026-09-19 14:45', ...o,
});
const recorder = async (m: any) => { sentMsgs.push(m); return { ok: true }; };
const deps = (send?: any) => ({ db, send, today: () => '2026-09-23', now: () => SENT_AT });

beforeAll(async () => {
  client = await PGlite.create();
  db = drizzle(client);
  await client.exec(`
    CREATE TABLE companies (id SERIAL PRIMARY KEY, name VARCHAR(256) UNIQUE NOT NULL, account_prefix VARCHAR(32),
      sippy_i_account INTEGER, kam VARCHAR(64));
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
  sentMsgs = [];
  await client.exec(`DELETE FROM rate_push_notifications; DELETE FROM company_contacts; DELETE FROM companies;`);
  // The production shape: company "1global", Sippy username "1gloabl" — resolved by name here
  // because no operation rows carry an account id in this fixture.
  await db.execute(sql`INSERT INTO companies (id, name, account_prefix, kam) VALUES (105, '1gloabl', '1019', 'Junaid')`);
  await db.execute(sql`INSERT INTO company_contacts (company_id, contact_type, email) VALUES (105, 'commercial', 'junaid@1global.example')`);
  // The parent job row — operations reference it by foreign key in production, and the creator
  // refuses to announce on a job it cannot establish.
  await db.execute(sql`INSERT INTO rate_push_jobs (job_id, rate_type) VALUES (${JOB}, 'current') ON CONFLICT DO NOTHING`);
  await createObligationsForPush(db, { jobId: JOB, operations: [op(), op({ dialPrefix: '9377', fullPrefix: '19377' })], productLabelFor: () => 'First Class' });
});

describe('the worker attaches the sheet built from the obligation it is sending', () => {
  it('prepares TWO attachments: the inline logo, then the sheet — sheet last', async () => {
    const { prepared, blocked } = await prepareRateNotifications(deps(recorder));
    expect(blocked).toEqual([]);
    expect(prepared).toHaveLength(1);
    const [m] = prepared;
    expect(m.attachments).toHaveLength(2);
    expect(m.attachments[0]).toMatchObject({ cid: 'ichibaan-logo', contentType: 'image/png' });
    expect(m.attachments[1]).toMatchObject({ contentType: XLSX_CONTENT_TYPE, filename: '1GLOABL-First_Class-20260923-0900-CHANGES.xlsx' });
    expect(m.attachments[1].cid).toBeUndefined();
  });

  it('the sheet carries the FROZEN rows — change rows_json and the sheet changes with it', async () => {
    // A frozen date the operations never had: the sheet must show what the obligation holds.
    await db.execute(sql`UPDATE rate_push_notifications SET rows_json = (
      SELECT jsonb_agg(jsonb_set(r, '{effectiveDate}', '"2026-10-01"'::jsonb)) FROM jsonb_array_elements(rows_json) r)`);
    const { prepared } = await prepareRateNotifications(deps(recorder));
    const text = await workbookText(prepared[0].attachments[1].content);
    expect(text).toContain('01-Oct-2026');
    expect(text).not.toContain('19-Sep-2026');
    expect(text).toContain('9376');
    expect(text).toContain('9377');
  });

  it('KAM name comes from the company row; technical prefix from account prefix + digit', async () => {
    const { prepared } = await prepareRateNotifications(deps(recorder));
    const text = await workbookText(prepared[0].attachments[1].content);
    expect(text).toContain('Junaid');
    expect(text).toContain('10191');
  });

  it('delivery hands BOTH attachments to the sender, and the obligation is marked sent', async () => {
    const r = await deliverRateNotifications(deps(recorder), { enabled: true });
    expect(r.sent).toBe(1);
    expect(sentMsgs[0].attachments).toHaveLength(2);
    expect(sentMsgs[0].attachments[1].filename).toMatch(/CHANGES\.xlsx$/);
    const [n] = (await db.execute(sql`SELECT status FROM rate_push_notifications`)).rows ?? [];
    expect(n.status).toBe('sent');
  });

  it('preparing still sends nothing and writes nothing', async () => {
    const before = JSON.stringify((await db.execute(sql`SELECT id, status, attempts, rows_json FROM rate_push_notifications`)).rows);
    await prepareRateNotifications(deps(recorder));
    expect(sentMsgs).toEqual([]);
    expect(JSON.stringify((await db.execute(sql`SELECT id, status, attempts, rows_json FROM rate_push_notifications`)).rows)).toBe(before);
  });
});

describe('the sender routes a two-file message to the plural transport', () => {
  const logo = { filename: 'ichibaan-logo.png', content: Buffer.from('png'), contentType: 'image/png', cid: 'ichibaan-logo' };
  const sheet = { filename: 'X-CHANGES.xlsx', content: Buffer.from('xlsx'), contentType: XLSX_CONTENT_TYPE };
  const msg = { to: 'c@x.example', subject: 'S', html: '<p/>', attachment: logo, attachments: [logo, sheet] };

  it('logo + sheet → withAttachments, both files, stamped Ichibaan Rates', async () => {
    const withAttachments = vi.fn(async () => ({ ok: true }));
    const withAttachment = vi.fn(async () => ({ ok: true }));
    const plain = vi.fn(async () => ({ ok: true }));
    await buildRateNotificationSender({ withAttachments, withAttachment, plain })(msg);
    expect(withAttachments).toHaveBeenCalledOnce();
    expect(withAttachment).not.toHaveBeenCalled();
    expect(withAttachments.mock.calls[0][0]).toMatchObject({ attachments: [logo, sheet], fromName: 'Ichibaan Rates', fromAddress: 'pricing@ichibaanlogic.com' });
  });

  /** If only one file can travel, it is the sheet. The logo is decoration; the sheet is the notice. */
  it('with no plural transport, the SHEET is the one file that goes — never the logo alone', async () => {
    const withAttachment = vi.fn(async () => ({ ok: true }));
    const plain = vi.fn(async () => ({ ok: true }));
    await buildRateNotificationSender({ withAttachment, plain })(msg);
    expect(withAttachment).toHaveBeenCalledOnce();
    expect((withAttachment.mock.calls[0][0] as any).attachment).toBe(sheet);
  });

  it('a legacy single-attachment message still takes the singular transport', async () => {
    const withAttachments = vi.fn(async () => ({ ok: true }));
    const withAttachment = vi.fn(async () => ({ ok: true }));
    const plain = vi.fn(async () => ({ ok: true }));
    await buildRateNotificationSender({ withAttachments, withAttachment, plain })({ to: 'c@x.example', subject: 'S', html: '<p/>', attachment: logo });
    expect(withAttachment).toHaveBeenCalledOnce();
    expect(withAttachments).not.toHaveBeenCalled();
  });
});
