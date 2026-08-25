/**
 * invoice-numbering-alloc.ts
 *
 * DB side of invoice numbering: derive the next number in the configured
 * series and create the invoice under the database's UNIQUE constraint
 * (migration 076), retrying on collision.
 *
 * The old scheme trusted count(*)+1 read moments before the insert — two
 * concurrent generations could both read N and both mint N+1, and nothing
 * stopped the second insert. Here the unique index is the arbiter: losing a
 * race is an error we CATCH, re-derive, and retry, not one we silently store.
 */

import { db } from './db';
import { sql } from 'drizzle-orm';
import {
  resolveNumberingConfig, renderInvoiceNumber, literalHead, nextSeqFromNumbers,
} from './invoice-numbering';

interface NumberingSettings {
  invoiceNumberFormat?: string | null;
  invoiceNumberPrefix?: string | null;
}

async function readNumberingSettings(): Promise<NumberingSettings> {
  try {
    const r = await db.execute(sql`
      SELECT invoice_number_format, invoice_number_prefix FROM settings LIMIT 1`);
    const row = ((r as any).rows ?? [])[0] ?? {};
    return {
      invoiceNumberFormat: row.invoice_number_format ?? null,
      invoiceNumberPrefix: row.invoice_number_prefix ?? null,
    };
  } catch {
    return {}; // unreadable settings → the default series, never a blocked generation
  }
}

/** Next number in the configured series: max existing sequence + 1. */
export async function nextInvoiceNumber(date: Date = new Date()): Promise<string> {
  const cfg = resolveNumberingConfig(await readNumberingSettings());
  const head = literalHead(cfg);
  const r = await db.execute(sql`
    SELECT invoice_number FROM invoices WHERE invoice_number LIKE ${head + '%'}`);
  const numbers = ((r as any).rows ?? []).map((x: any) => String(x.invoice_number));
  return renderInvoiceNumber(cfg, date, nextSeqFromNumbers(cfg, numbers));
}

const isUniqueViolation = (e: any) =>
  e?.code === '23505' || /duplicate key value|unique constraint/i.test(String(e?.message ?? ''));

/**
 * Mint a number and run `create` with it; on a unique-constraint collision
 * (a concurrent generation won the number) re-derive and retry, a few times.
 * Any other failure propagates untouched.
 */
export async function createWithUniqueInvoiceNumber<T>(
  create: (invoiceNumber: string) => Promise<T>,
  date: Date = new Date(),
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const invoiceNumber = await nextInvoiceNumber(date);
    try {
      return await create(invoiceNumber);
    } catch (e: any) {
      if (!isUniqueViolation(e) || attempt >= 5) throw e;
      console.warn(`[invoice-numbering] ${invoiceNumber} lost a concurrent race (attempt ${attempt}); re-deriving`);
    }
  }
}
