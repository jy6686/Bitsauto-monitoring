/**
 * invoice-terms.ts
 *
 * When an invoice falls due.
 *
 * Two fields describe payment, and they answer different questions. Treating
 * them as competing sources produced no due date at all; treating them as a
 * hierarchy makes both meaningful:
 *
 *   payment term  — prepaid | postpaid | advance   (WHETHER credit is extended)
 *   terms days    — 7 | 15 | 30 | 45               (HOW LONG, when it is)
 *
 * A prepaid customer has already paid; the invoice documents what was consumed
 * rather than requesting settlement, so its due date is the invoice date and it
 * says so in words. A postpaid customer gets invoice date plus their terms.
 *
 * Dependency-free so the rule is pinned by tests and cannot drift between the
 * PDF and the email — the two places a customer reads it.
 */

export interface InvoiceTerms {
  /** ISO date (YYYY-MM-DD) the invoice falls due. */
  dueDate: string;
  /** What to print. Prepaid invoices state the condition, not a deadline. */
  dueLabel: string;
  /** 'prepaid' | 'postpaid' — what drove the calculation. */
  basis: 'prepaid' | 'postpaid';
  termsDays: number;
}

const PREPAID = /^(prepaid|pre-paid|pre paid|advance|prepay)$/i;

/**
 * @param invoiceDate  ISO date or Date the invoice was raised
 * @param paymentTerm  companies.payment_term — 'prepaid', 'postpaid', etc.
 * @param termsDays    business_partners.payment_terms_days, when known
 */
export function resolveInvoiceTerms(
  invoiceDate: string | Date,
  paymentTerm?: string | null,
  termsDays?: number | null,
): InvoiceTerms {
  const base = typeof invoiceDate === 'string' ? new Date(invoiceDate) : invoiceDate;
  const day = isNaN(base?.getTime?.() ?? NaN) ? new Date() : base;

  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const prepaid = PREPAID.test(String(paymentTerm ?? '').trim());

  if (prepaid) {
    return { dueDate: iso(day), dueLabel: 'Payment due immediately', basis: 'prepaid', termsDays: 0 };
  }

  // Postpaid. Fall back to 30 days only when no term is recorded — the same
  // default business_partners already carries, so the invoice agrees with the
  // partner record rather than inventing a different one.
  const days = Number.isFinite(termsDays as number) && (termsDays as number) >= 0
    ? Math.floor(termsDays as number)
    : 30;
  const due = new Date(day.getTime());
  due.setUTCDate(due.getUTCDate() + days);
  return { dueDate: iso(due), dueLabel: `Net ${days} — due ${iso(due)}`, basis: 'postpaid', termsDays: days };
}
