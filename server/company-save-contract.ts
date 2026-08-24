/**
 * company-save-contract.ts
 *
 * The pure decisions behind saving a company and resolving who its invoices
 * are emailed to. Extracted so the writer and the reader can be pinned by
 * tests against each other: every defect this module encodes was live in
 * production on 2026-08-24, and each was invisible until an operator hit it.
 *
 *   1. The company editor submits a NESTED payload ({ basic, billing,
 *      contacts, bankAccounts }). Passing it straight to Drizzle's .set()
 *      matched no column, produced an empty SET clause, and Postgres rejected
 *      every save with `syntax error at or near "where"`.
 *   2. Contacts were displayed, edited, and then dropped — the update path
 *      never wrote company_contacts at all.
 *   3. Invoice dispatch resolves recipients from companies.invoiceEmail and
 *      from company_contacts rows whose contactType contains 'billing'. If
 *      the save path ever writes a different type string than the resolver
 *      reads, dispatch fails with "No billing recipient on file" while the
 *      editor shows a perfectly good billing contact.
 *
 * The chain test at the bottom of the suite is the one that matters: an
 * editor payload must survive normalization and sanitization and still be
 * found by the resolver.
 */

/** Keys the editor sends that are NOT columns of `companies`. */
export const NON_COLUMN_KEYS = [
  '__source', 'basic', 'billing', 'contacts', 'bankAccounts',
  'initialIps', 'productIds', 'marketDestinationIds',
] as const;

export interface NormalizedCompanySave {
  /** Column patch for `companies`. Empty means "no column changes". */
  patch:        Record<string, unknown>;
  /** Contact rows as submitted, or null when the payload carried none. */
  contacts:     any[] | null;
  bankAccounts: any[] | null;
  /** Audit provenance (`__source`), never a column. */
  source:       string | null;
}

/**
 * Split an editor payload into the column patch and its child collections.
 * Accepts both the nested editor shape and a flat column patch (the
 * preparation wizard and other callers send the latter).
 */
export function normalizeCompanySave(body: Record<string, any> | null | undefined): NormalizedCompanySave {
  const {
    __source, basic, billing, contacts, bankAccounts,
    initialIps: _ips, productIds: _p, marketDestinationIds: _m,
    ...flat
  } = (body ?? {}) as Record<string, any>;

  const nested = basic !== undefined || billing !== undefined
              || contacts !== undefined || bankAccounts !== undefined;

  return {
    patch:        nested ? { ...(basic ?? {}), ...(billing ?? {}), ...flat } : flat,
    contacts:     Array.isArray(contacts)     ? contacts     : null,
    bankAccounts: Array.isArray(bankAccounts) ? bankAccounts : null,
    source:       typeof __source === 'string' ? __source : null,
  };
}

export interface ContactRow {
  companyId:   number;
  contactType: string;
  firstName:   string;
  lastName:    string | null;
  email:       string;
  phone:       string | null;
  fax:         string | null;
}

/**
 * What a contacts submission should do to the stored set.
 *
 * `skip` on an empty submission is deliberate: the editor loads every contact
 * and submits them all, so an empty list is far more likely to be a form that
 * failed to load than an operator deleting all four contacts. Treating it as
 * delete-all would silently erase the billing recipients invoice dispatch
 * depends on. Removing a contact row-by-row in the editor still works.
 *
 * company_contacts.first_name and .email are NOT NULL, so a row missing
 * either cannot be stored and is dropped rather than failing the whole save.
 */
export function planContactsReplacement(
  companyId: number,
  contacts: any[] | null,
): { action: 'replace' | 'skip'; rows: ContactRow[]; dropped: number } {
  if (!Array.isArray(contacts)) return { action: 'skip', rows: [], dropped: 0 };

  const rows: ContactRow[] = [];
  let dropped = 0;
  for (const c of contacts) {
    const firstName = String(c?.firstName ?? '').trim();
    const email     = String(c?.email     ?? '').trim();
    if (!firstName || !email) { dropped++; continue; }
    rows.push({
      companyId,
      contactType: String(c?.contactType ?? 'technical').trim() || 'technical',
      firstName,
      lastName: c?.lastName ? String(c.lastName).trim() : null,
      email,
      phone:    c?.phone    ? String(c.phone).trim()    : null,
      fax:      c?.fax      ? String(c.fax).trim()      : null,
    });
  }
  return { action: rows.length ? 'replace' : 'skip', rows, dropped };
}

export function planBankReplacement(
  companyId: number,
  accounts: any[] | null,
): { action: 'replace' | 'skip'; rows: any[] } {
  if (!Array.isArray(accounts)) return { action: 'skip', rows: [] };
  const rows = accounts
    .filter(b => String(b?.bankName ?? '').trim() && String(b?.accountNo ?? '').trim())
    .map(({ id: _id, companyId: _c, ...b }: any) => ({ ...b, companyId }));
  return { action: rows.length ? 'replace' : 'skip', rows };
}

/**
 * Who an invoice is emailed to, given a company and its contacts.
 *
 * Order is deliberate: an explicit invoiceEmail on the company overrides the
 * contact list, and multiple addresses may be comma-separated. A company with
 * neither returns NO recipients and a reason — dispatch must refuse rather
 * than invent an address.
 */
export function selectBillingRecipients(
  company: { id: number; name?: string | null; invoiceEmail?: string | null } | null,
  contacts: Array<{ contactType?: string | null; email?: string | null }>,
  clientName = '',
): { recipients: string[]; source: string } {
  if (!company) return { recipients: [], source: `no company matches "${clientName}"` };

  const direct = (company.invoiceEmail ?? '').trim();
  if (direct) {
    const list = direct.split(',').map(s => s.trim()).filter(Boolean);
    if (list.length) return { recipients: list, source: `companies.invoiceEmail (company #${company.id})` };
  }

  const billing = (contacts ?? [])
    .filter(c => (c.contactType ?? '').toLowerCase().includes('billing') && (c.email ?? '').trim())
    .map(c => (c.email ?? '').trim());
  if (billing.length) {
    return { recipients: billing, source: `company_contacts(billing) (company #${company.id})` };
  }

  return {
    recipients: [],
    source: `company #${company.id} "${company.name ?? ''}" has no invoiceEmail and no billing contact`,
  };
}
