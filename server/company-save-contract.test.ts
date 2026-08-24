/**
 * Company save → billing recipient, pinned end to end.
 *
 * Every case here failed in production on 2026-08-24. The chain test at the
 * bottom is the point of the file: an editor payload must survive the save
 * path and still be found by the resolver that invoice dispatch uses.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeCompanySave, planContactsReplacement, planBankReplacement,
  selectBillingRecipients,
} from './company-save-contract';

/** The exact shape client/src/pages/company-create.tsx submits. */
const editorPayload = (over: Record<string, any> = {}) => ({
  basic:   { name: 'PUSHTOTALK', shortCode: 'PTT', companyType: 'retail' },
  billing: { paymentTerm: 'prepaid', invoiceEmail: 'billing@pushtotalk.example' },
  contacts: [
    { contactType: 'technical',  firstName: 'Junaid', lastName: 'Yousufi', email: 'tech@x.example',  phone: '0346' },
    { contactType: 'finance',    firstName: 'Junaid', lastName: 'Yousufi', email: 'fin@x.example',   phone: '0346' },
    { contactType: 'commercial', firstName: 'Junaid', lastName: 'Yousufi', email: 'comm@x.example',  phone: '0346' },
    { contactType: 'billing',    firstName: 'Junaid', lastName: 'Yousufi', email: 'bill@x.example',  phone: '0346' },
  ],
  bankAccounts: [],
  initialIps: [],
  ...over,
});

describe('normalizeCompanySave', () => {
  it('flattens the nested editor payload into a NON-EMPTY column patch', () => {
    // The regression: passing the raw body to Drizzle .set() matched no column,
    // emitting `update "companies" set where "id" = $1` — a Postgres syntax error
    // that made every company save fail.
    const { patch } = normalizeCompanySave(editorPayload());
    expect(Object.keys(patch).length).toBeGreaterThan(0);
    expect(patch).toMatchObject({
      name: 'PUSHTOTALK', shortCode: 'PTT',
      paymentTerm: 'prepaid', invoiceEmail: 'billing@pushtotalk.example',
    });
  });

  it('keeps child collections and audit provenance OUT of the column patch', () => {
    const { patch, contacts, bankAccounts, source } =
      normalizeCompanySave(editorPayload({ __source: 'company-editor' }));
    for (const k of ['basic', 'billing', 'contacts', 'bankAccounts', 'initialIps', '__source']) {
      expect(patch).not.toHaveProperty(k);
    }
    expect(contacts).toHaveLength(4);
    expect(bankAccounts).toEqual([]);
    expect(source).toBe('company-editor');
  });

  it('drops productIds/marketDestinationIds — not columns, not edited here', () => {
    const { patch } = normalizeCompanySave(editorPayload({ productIds: [1, 2], marketDestinationIds: [9] }));
    expect(patch).not.toHaveProperty('productIds');
    expect(patch).not.toHaveProperty('marketDestinationIds');
  });

  it('passes a FLAT patch through unchanged (wizard and other callers)', () => {
    const { patch, contacts } = normalizeCompanySave({ clientBillingCycle: 'monthly', __source: 'wizard' });
    expect(patch).toEqual({ clientBillingCycle: 'monthly' });
    expect(contacts).toBeNull();
  });

  it('a payload carrying only non-column keys yields an empty patch', () => {
    // Callers must treat this as "no column changes" — never as SQL to execute.
    const { patch } = normalizeCompanySave({ __source: 'x', initialIps: [] });
    expect(patch).toEqual({});
  });
});

describe('planContactsReplacement', () => {
  it('maps submitted rows onto company_contacts columns, preserving contactType', () => {
    const { action, rows, dropped } = planContactsReplacement(17, editorPayload().contacts);
    expect(action).toBe('replace');
    expect(dropped).toBe(0);
    expect(rows).toHaveLength(4);
    expect(rows.map(r => r.contactType)).toEqual(['technical', 'finance', 'commercial', 'billing']);
    expect(rows.every(r => r.companyId === 17)).toBe(true);
  });

  it('drops rows missing firstName or email (both NOT NULL) instead of failing the save', () => {
    const { rows, dropped } = planContactsReplacement(17, [
      { contactType: 'billing', firstName: '', email: 'only-email@x.example' },
      { contactType: 'billing', firstName: 'NoEmail', email: '   ' },
      { contactType: 'billing', firstName: 'Good', email: 'good@x.example' },
    ]);
    expect(dropped).toBe(2);
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe('good@x.example');
  });

  it('NEVER treats an empty submission as delete-all', () => {
    // A form that failed to load must not erase the billing recipients that
    // invoice dispatch resolves against.
    expect(planContactsReplacement(17, []).action).toBe('skip');
    expect(planContactsReplacement(17, [{ firstName: '', email: '' }]).action).toBe('skip');
    expect(planContactsReplacement(17, null).action).toBe('skip');
  });
});

describe('planBankReplacement', () => {
  it('requires bankName and accountNo, and never carries a foreign id through', () => {
    const { action, rows } = planBankReplacement(17, [
      { id: 99, companyId: 4, bankName: 'HBL', accountNo: '123', swiftCode: 'HABBPKKA', accountTitle: 'X', country: 'PK' },
      { bankName: '', accountNo: '456' },
    ]);
    expect(action).toBe('replace');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ companyId: 17, bankName: 'HBL' });
    expect(rows[0]).not.toHaveProperty('id');
  });

  it('skips rather than wiping when nothing valid was submitted', () => {
    expect(planBankReplacement(17, []).action).toBe('skip');
  });
});

describe('selectBillingRecipients', () => {
  const company = { id: 17, name: 'PUSHTOTALK', invoiceEmail: null as string | null };

  it('prefers companies.invoiceEmail and splits multiple addresses', () => {
    const r = selectBillingRecipients(
      { ...company, invoiceEmail: ' a@x.example , b@x.example ' }, []);
    expect(r.recipients).toEqual(['a@x.example', 'b@x.example']);
    expect(r.source).toContain('companies.invoiceEmail');
  });

  it('falls back to billing-type contacts', () => {
    const r = selectBillingRecipients(company, [
      { contactType: 'technical', email: 'tech@x.example' },
      { contactType: 'billing',   email: 'bill@x.example' },
    ]);
    expect(r.recipients).toEqual(['bill@x.example']);
    expect(r.source).toContain('company_contacts(billing)');
  });

  it('never falls back to a non-billing contact', () => {
    const r = selectBillingRecipients(company, [
      { contactType: 'technical', email: 'tech@x.example' },
      { contactType: 'finance',   email: 'fin@x.example'  },
    ]);
    expect(r.recipients).toEqual([]);
    expect(r.source).toContain('no invoiceEmail and no billing contact');
  });

  it('refuses, with a reason, when the company is unknown — never invents an address', () => {
    const r = selectBillingRecipients(null, [], 'Ghost Client');
    expect(r.recipients).toEqual([]);
    expect(r.source).toContain('Ghost Client');
  });
});

describe('the chain: what the editor saves is what dispatch resolves', () => {
  it('a billing contact typed in the editor reaches the recipient resolver', () => {
    // Writer and reader pinned against each other. If the save path ever
    // writes a different contactType string than the resolver matches on,
    // this fails here instead of as "No billing recipient on file" in
    // production while the editor shows a valid billing contact.
    const body = editorPayload({ billing: { paymentTerm: 'prepaid', invoiceEmail: '' } });
    const { patch, contacts } = normalizeCompanySave(body);
    const { action, rows } = planContactsReplacement(17, contacts);

    expect(action).toBe('replace');
    const stored = rows.map(r => ({ contactType: r.contactType, email: r.email }));
    const resolved = selectBillingRecipients(
      { id: 17, name: 'PUSHTOTALK', invoiceEmail: (patch as any).invoiceEmail ?? null },
      stored,
    );
    expect(resolved.recipients).toEqual(['bill@x.example']);
  });

  it('an invoiceEmail typed on the Billing Information step reaches the resolver', () => {
    const { patch } = normalizeCompanySave(editorPayload({ contacts: [] }));
    const resolved = selectBillingRecipients(
      { id: 17, name: 'PUSHTOTALK', invoiceEmail: (patch as any).invoiceEmail },
      [],
    );
    expect(resolved.recipients).toEqual(['billing@pushtotalk.example']);
  });
});
