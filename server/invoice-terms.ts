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
  /** Printable form of the company's recorded term. */
  termLabel: string;
}

const PREPAID = /^(prepaid|pre-paid|pre paid|advance|prepay|on receipt|immediate)$/i;

/**
 * Days encoded in the term itself — "net_30", "net 30", "Net30", "30 days".
 * The company profile is the single source of truth for commercial terms, so a
 * term that states its own length needs no second lookup. Returns null when the
 * term carries no number ("postpaid", "credit"), leaving the caller's fallback
 * to apply.
 */
export function daysFromPaymentTerm(term?: string | null): number | null {
  const m = String(term ?? '').match(/(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 0 && n <= 365 ? n : null;
}

/** Human label for a stored term: "net_30" → "Net 30", "prepaid" → "Prepaid". */
export function paymentTermLabel(term?: string | null): string {
  const t = String(term ?? '').trim();
  if (!t) return 'Not set';
  if (PREPAID.test(t)) return 'Prepaid';
  const d = daysFromPaymentTerm(t);
  if (d != null) return `Net ${d}`;
  return t.charAt(0).toUpperCase() + t.slice(1).replace(/[_-]+/g, ' ');
}

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
    return {
      dueDate: iso(day), dueLabel: 'Payment due immediately',
      basis: 'prepaid', termsDays: 0, termLabel: 'Prepaid',
    };
  }

  // Postpaid. Precedence: the length stated in the company's own term wins,
  // because the company profile is the single source of truth for commercial
  // terms; a separately-recorded partner term is the fallback; 30 only when
  // neither says anything — the same default business_partners carries, so the
  // invoice agrees with the partner record rather than inventing a number.
  const fromTerm = daysFromPaymentTerm(paymentTerm);
  const days = fromTerm != null
    ? fromTerm
    : (Number.isFinite(termsDays as number) && (termsDays as number) >= 0
        ? Math.floor(termsDays as number)
        : 30);
  const due = new Date(day.getTime());
  due.setUTCDate(due.getUTCDate() + days);
  return {
    dueDate: iso(due), dueLabel: `Net ${days} — due ${iso(due)}`,
    basis: 'postpaid', termsDays: days, termLabel: paymentTermLabel(paymentTerm) ,
  };
}
