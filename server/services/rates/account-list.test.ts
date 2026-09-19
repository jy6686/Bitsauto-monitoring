/**
 * The Send Rate client list — Option C, pinned.
 *
 * Until 2026-09-19 the dropdown was fed ONLY from customer_product_assignments for the selected
 * product, so an account configured on Sippy for Business Class but never given an assignment row
 * was invisible ("3 clients"). That filter was also the ONLY product-assignment gate in the path:
 * push-batch checks tariff identity, never assignment. Option C keeps the information without
 * hiding accounts: every managed platform company with a Sippy account is listed, and each row
 * says whether the selected product is assigned — strictly from the assignment table, never
 * inferred from a tariff or a product's presence on Sippy.
 */
import { describe, it, expect } from 'vitest';
import { buildAccountList, type ManagedCompany, type ProductAssignment } from './account-list';

const companies: ManagedCompany[] = [
  { id: 1, name: 'aura',       sippyIAccount: 1070, status: 'active' },
  { id: 2, name: '1gloabl',    sippyIAccount: 1069, status: 'active' },
  { id: 3, name: 'shareef-tel',sippyIAccount: 1071, status: 'dormant' },
  { id: 4, name: 'no-sippy',   sippyIAccount: null, status: 'active' },   // not managed on Sippy
  { id: 5, name: 'zero-acct',  sippyIAccount: 0,    status: 'active' },   // never provisioned
];

const assignmentsBC: ProductAssignment[] = [
  { productId: 3, iAccount: 1070, customerName: 'Aura Telecom', status: 'active' },
  { productId: 3, iAccount: 1071, customerName: null,           status: 'inactive' }, // NOT active
  { productId: 1, iAccount: 1069, customerName: '1global FC',   status: 'active' },   // other product
];

describe('the list is every managed company with a Sippy account — assignment never hides one', () => {
  it('includes accounts with NO assignment for the product (the previously invisible ones)', () => {
    const list = buildAccountList(companies, assignmentsBC, 3);
    const ids = list.map(a => a.iAccount).sort();
    expect(ids).toEqual([1069, 1070, 1071]);           // 1global has no BC assignment, still listed
  });

  it('excludes companies with no Sippy account or a zero account — they cannot be pushed to', () => {
    const list = buildAccountList(companies, assignmentsBC, 3);
    expect(list.find(a => a.username === 'no-sippy')).toBeUndefined();
    expect(list.find(a => a.username === 'zero-acct')).toBeUndefined();
  });
});

describe('`assigned` derives STRICTLY from customer_product_assignments for the selected product', () => {
  it('true only for an ACTIVE assignment of THIS product', () => {
    const list = buildAccountList(companies, assignmentsBC, 3);
    expect(list.find(a => a.iAccount === 1070)!.assigned).toBe(true);
  });

  it('false when the assignment exists but is not active', () => {
    const list = buildAccountList(companies, assignmentsBC, 3);
    expect(list.find(a => a.iAccount === 1071)!.assigned).toBe(false);
  });

  it('false when the only assignment is for a DIFFERENT product — no cross-product inference', () => {
    const list = buildAccountList(companies, assignmentsBC, 3);
    expect(list.find(a => a.iAccount === 1069)!.assigned).toBe(false);
  });

  it('is not inferred from anything else — with no assignment rows at all, every account is unassigned yet still listed', () => {
    const list = buildAccountList(companies, [], 3);
    expect(list.length).toBe(3);
    expect(list.every(a => a.assigned === false)).toBe(true);
  });
});

describe('row shape', () => {
  it('prefers the assignment customerName when assigned, else the company name; carries lifecycle', () => {
    const list = buildAccountList(companies, assignmentsBC, 3);
    expect(list.find(a => a.iAccount === 1070)!.username).toBe('Aura Telecom');
    expect(list.find(a => a.iAccount === 1069)!.username).toBe('1gloabl');
    expect(list.find(a => a.iAccount === 1071)!.lifecycle).toBe('dormant');
  });
});
