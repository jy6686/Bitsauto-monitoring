/**
 * invoice-terms-db.ts
 *
 * The ONE lookup that feeds resolveInvoiceTerms. The PDF renderer and the
 * email service previously each carried their own copy of this SQL; invoice
 * generation is a third consumer now that due dates are stamped at creation
 * (migration 076). One query in one place means the PDF, the email, the
 * stored due_date and every future consumer cannot disagree about terms.
 *
 * Sources, in the precedence resolveInvoiceTerms enforces:
 *   companies.payment_term                → the account's own agreement
 *   business_partners.payment_terms_days  → a separately recorded agreement
 *   settings.billing_default_payment_term → the issuer's configured standard
 * Nothing recorded anywhere → 'unconfigured', printed as such, never invented.
 */

import { db } from './db';
import { sql } from 'drizzle-orm';
import { resolveInvoiceTerms, type InvoiceTerms } from './invoice-terms';

/**
 * Fill dueDate/paymentTermsLabel on invoice rows that predate the 076 stamp,
 * from the same rule, batched (one settings read + one companies read per
 * call, whatever the row count). Rows already stamped at generation keep
 * their stored values — an issued document's terms don't drift with the
 * profile. Computed values are response-only, never written back.
 */
export async function attachInvoiceTerms<T extends Record<string, any>>(rows: T[]): Promise<T[]> {
  const pending = rows.filter((r) => r.dueDate == null && r.paymentTermsLabel == null);
  if (!pending.length) return rows;

  let issuerDefault: string | null = null;
  try {
    const s = await db.execute(sql`
      SELECT billing_default_payment_term FROM settings LIMIT 1`);
    issuerDefault = ((s as any).rows ?? [])[0]?.billing_default_payment_term ?? null;
  } catch { /* absent tier — the rest still resolves */ }

  const byName = new Map<string, { paymentTerm: string | null; termsDays: number | null }>();
  const names = [...new Set(
    pending.map((r) => String(r.customerName ?? '').trim().toLowerCase()).filter(Boolean),
  )];
  if (names.length) {
    try {
      const t = await db.execute(sql`
        SELECT lower(c.name) AS lname, c.payment_term,
               (SELECT bp.payment_terms_days FROM business_partners bp
                 WHERE lower(bp.name) = lower(c.name) LIMIT 1) AS terms_days
          FROM companies c
         WHERE lower(c.name) IN (${sql.join(names.map((n) => sql`${n}`), sql`, `)})`);
      for (const row of (t as any).rows ?? []) {
        byName.set(String(row.lname), {
          paymentTerm: row.payment_term ?? null,
          termsDays: row.terms_days != null ? Number(row.terms_days) : null,
        });
      }
    } catch { /* unknown companies resolve from the issuer default alone */ }
  }

  return rows.map((r) => {
    if (r.dueDate != null || r.paymentTermsLabel != null) return r;
    const info = byName.get(String(r.customerName ?? '').trim().toLowerCase());
    const terms = resolveInvoiceTerms(
      r.generatedAt ?? r.createdAt ?? new Date(),
      info?.paymentTerm ?? null, info?.termsDays ?? null, issuerDefault,
    );
    return { ...r, dueDate: terms.dueDate, paymentTermsLabel: terms.termLabel };
  });
}

export async function invoiceTermsForCustomer(
  customerName: string | null | undefined,
  invoiceDate: string | Date,
): Promise<InvoiceTerms> {
  let paymentTerm: string | null = null;
  let termsDays: number | null = null;
  let issuerDefault: string | null = null;

  try {
    const t = await db.execute(sql`
      SELECT c.payment_term,
             (SELECT bp.payment_terms_days FROM business_partners bp
               WHERE lower(bp.name) = lower(c.name) LIMIT 1) AS terms_days
        FROM companies c
       WHERE lower(c.name) = lower(${String(customerName ?? '')})
       LIMIT 1`);
    const row = ((t as any).rows ?? [])[0] ?? {};
    paymentTerm = row.payment_term ?? null;
    termsDays   = row.terms_days != null ? Number(row.terms_days) : null;
  } catch { /* company unreadable → the remaining tiers still apply */ }

  try {
    const s = await db.execute(sql`
      SELECT billing_default_payment_term FROM settings LIMIT 1`);
    issuerDefault = ((s as any).rows ?? [])[0]?.billing_default_payment_term ?? null;
  } catch { /* settings unreadable → terms resolve from what was found */ }

  return resolveInvoiceTerms(invoiceDate, paymentTerm, termsDays, issuerDefault);
}
