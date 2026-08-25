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
 * When NEITHER source records a length, there is no default: the invoice
 * prints "Not configured" and no due date, so the missing profile is noticed
 * at review instead of a customer receiving invented contractual terms.
 *
 * Dependency-free so the rule is pinned by tests and cannot drift between the
 * PDF and the email — the two places a customer reads it.
 */

export interface InvoiceTerms {
  /**
   * ISO date (YYYY-MM-DD) the invoice falls due — or null when no term is
   * configured anywhere. Null is deliberate: inventing a default here would
   * put a contractual deadline on a customer document that no one agreed to.
   * An unconfigured profile must READ as unconfigured so Finance fixes it.
   */
  dueDate: string | null;
  /** What to print. Prepaid invoices state the condition, not a deadline. */
  dueLabel: string;
  /** What drove the calculation — 'unconfigured' when nothing is recorded. */
  basis: 'prepaid' | 'postpaid' | 'unconfigured';
  termsDays: number | null;
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
  if (!t) return 'Not configured';
  if (PREPAID.test(t)) return 'Prepaid';
  const d = daysFromPaymentTerm(t);
  if (d != null) return `Net ${d}`;
  return t.charAt(0).toUpperCase() + t.slice(1).replace(/[_-]+/g, ' ');
}

/**
 * Dates on customer documents, from the configured preference. Pure string
 * assembly on the ISO form — no locale machinery to drift between renderers.
 */
export function fmtInvoiceDate(iso: string | null | undefined, format?: string | null): string {
  const s = String(iso ?? '').slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return s || '—';
  const [, y, mo, d] = m;
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  switch (String(format ?? '').trim()) {
    case 'DD MMM YYYY': return `${d} ${MONTHS[Number(mo) - 1] ?? mo} ${y}`;
    case 'DD/MM/YYYY':  return `${d}/${mo}/${y}`;
    case 'MM/DD/YYYY':  return `${mo}/${d}/${y}`;
    default:            return s;
  }
}

/**
 * @param invoiceDate        ISO date or Date the invoice was raised
 * @param paymentTerm        companies.payment_term — 'prepaid', 'net_30', etc.
 * @param termsDays          business_partners.payment_terms_days, when known
 * @param issuerDefaultTerm  settings.billing_default_payment_term — the
 *                           issuer's DELIBERATE standard terms. Applies fully
 *                           when the company recorded nothing; supplies only a
 *                           LENGTH when the company said a termless "postpaid"
 *                           (the company's prepaid/postpaid choice always wins).
 */
export function resolveInvoiceTerms(
  invoiceDate: string | Date,
  paymentTerm?: string | null,
  termsDays?: number | null,
  issuerDefaultTerm?: string | null,
): InvoiceTerms {
  const base = typeof invoiceDate === 'string' ? new Date(invoiceDate) : invoiceDate;
  const day = isNaN(base?.getTime?.() ?? NaN) ? new Date() : base;

  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const companyTerm = String(paymentTerm ?? '').trim();
  const issuerTerm  = String(issuerDefaultTerm ?? '').trim();

  const asPrepaid = (): InvoiceTerms => ({
    dueDate: iso(day), dueLabel: 'Payment due immediately',
    basis: 'prepaid', termsDays: 0, termLabel: 'Prepaid',
  });
  if (PREPAID.test(companyTerm)) return asPrepaid();
  // The issuer default applies FULLY only when the company recorded nothing —
  // a company that chose "postpaid" is never flipped to prepaid by a default.
  if (!companyTerm && PREPAID.test(issuerTerm)) return asPrepaid();

  // Postpaid. Precedence for the length: the company's own term, then the
  // partner record, then the issuer's configured standard. All three are
  // agreements somebody recorded; there is no fourth tier — an invented
  // default would print a contractual deadline nobody agreed to, and Finance
  // would never learn the profile was incomplete.
  const fromCompany = daysFromPaymentTerm(companyTerm);
  const fromPartner = Number.isFinite(termsDays as number) && (termsDays as number) >= 0
    ? Math.floor(termsDays as number)
    : null;
  const fromIssuer  = daysFromPaymentTerm(issuerTerm);

  const days = fromCompany ?? fromPartner ?? fromIssuer;
  if (days == null) {
    // Fail visibly: the document says the configuration is missing rather
    // than inventing terms. The gap surfaces at review, before any send.
    return {
      dueDate: null, dueLabel: 'Payment terms not configured',
      basis: 'unconfigured', termsDays: null,
      termLabel: 'Not configured',
    };
  }

  // The label names the source that actually decided the length — never a
  // configured value that lost the precedence contest.
  const labelSource =
    fromCompany != null || companyTerm ? companyTerm
    : fromPartner != null              ? ''         // partner record decided
    : issuerTerm;                                   // issuer default decided
  const due = new Date(day.getTime());
  due.setUTCDate(due.getUTCDate() + days);
  return {
    dueDate: iso(due), dueLabel: `Net ${days} — due ${iso(due)}`,
    basis: 'postpaid', termsDays: days,
    termLabel: labelSource ? paymentTermLabel(labelSource) : `Net ${days}`,
  };
}
