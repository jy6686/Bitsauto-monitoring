import { describe, it, expect } from 'vitest';
import { buildIdentityInventory, type InventoryProduct } from './identity-inventory';

const PRODUCTS: InventoryProduct[] = [
  { id: 1, code: 'FC', name: 'First Class',    trunkPrefix: '1' },
  { id: 2, code: 'BC', name: 'Business Class', trunkPrefix: '2' },
  { id: 6, code: 'SB', name: 'Special Bravo',  trunkPrefix: '6' },
];
const step = (companyId: number, stepKey: string, result: Record<string, unknown> | null,
              completedAt = '2026-09-15T09:30:00Z', status = 'success') =>
  ({ companyId, stepKey, status, result, completedAt });

const base = { products: PRODUCTS, bought: [], assigned: [], evidence: [] as any[] };
const only = (r: ReturnType<typeof buildIdentityInventory>) => r.companies[0];

describe('identity status', () => {
  it('VERIFIED when an account is recorded and the run agrees', () => {
    const r = buildIdentityInventory({ ...base,
      companies: [{ id: 1, name: 'Acme', sippyIAccount: 900, sippyITariff: 61, provisioningStatus: 'provisioned' }],
      evidence: [step(1, 'account', { iAccount: 900 })] });
    expect(only(r).identity.status).toBe('VERIFIED');
    expect(only(r).identity.note).toMatch(/confirmed by this company's own provisioning run/);
    expect(r.byStatus.VERIFIED).toBe(1);
  });

  it('REPAIRABLE is exactly the 1global case: account null, its own run proved 1069', () => {
    const r = buildIdentityInventory({ ...base,
      companies: [{ id: 105, name: '1global', sippyIAccount: null, sippyITariff: 68, provisioningStatus: 'draft' }],
      evidence: [step(105, 'account', { iAccount: 1069, username: '1gloabl', reused: true })] });
    expect(only(r).identity).toMatchObject({ status: 'REPAIRABLE', storedAccount: null, storedTariff: 68, evidenceAccount: 1069 });
    expect(only(r).nextAction).toMatch(/identity repair/);
  });

  it('CONFLICT never picks a side', () => {
    const r = buildIdentityInventory({ ...base,
      companies: [{ id: 2, name: 'Beta', sippyIAccount: 111, sippyITariff: null, provisioningStatus: 'provisioned' }],
      evidence: [step(2, 'account', { iAccount: 222 })] });
    expect(only(r).identity.status).toBe('CONFLICT');
    expect(only(r).nextAction).toMatch(/Nothing may be written/);
  });

  it('UNRESOLVED when a tariff exists but no run proves the account', () => {
    const r = buildIdentityInventory({ ...base,
      companies: [{ id: 3, name: 'Internal-ptcl', sippyIAccount: null, sippyITariff: 76, provisioningStatus: 'draft' }] });
    expect(only(r).identity.status).toBe('UNRESOLVED');
    expect(only(r).identity.note).toMatch(/never infer the account from the tariff or the name/);
  });

  it('NOT_PROVISIONED when nothing is recorded and no run exists', () => {
    const r = buildIdentityInventory({ ...base,
      companies: [{ id: 4, name: 'Nadeem', sippyIAccount: null, sippyITariff: null, provisioningStatus: 'draft' }] });
    expect(only(r).identity.status).toBe('NOT_PROVISIONED');
    expect(only(r).nextAction).toMatch(/Provision this customer/);
  });

  it('never borrows another company\'s run — not even for an identical name', () => {
    const r = buildIdentityInventory({ ...base,
      companies: [{ id: 10, name: '1global', sippyIAccount: null, sippyITariff: 68, provisioningStatus: 'draft' }],
      evidence: [step(9, 'account', { iAccount: 1069, username: '1gloabl' })] });
    expect(only(r).identity.evidenceAccount).toBeNull();
    expect(only(r).identity.status).toBe('UNRESOLVED');   // not REPAIRABLE
  });

  it('takes the latest successful step and ignores failures', () => {
    const r = buildIdentityInventory({ ...base,
      companies: [{ id: 5, name: 'Gamma', sippyIAccount: null, sippyITariff: null, provisioningStatus: 'draft' }],
      evidence: [step(5, 'account', { iAccount: 500 }, '2026-09-01T10:00:00Z'),
                 step(5, 'account', { iAccount: 777 }, '2026-09-14T10:00:00Z'),
                 step(5, 'account', { iAccount: 999 }, '2026-09-15T10:00:00Z', 'failed')] });
    expect(only(r).identity.evidenceAccount).toBe(777);
  });
});

describe('products under the identity', () => {
  it('names what was bought but never configured under the account', () => {
    const r = buildIdentityInventory({ ...base,
      companies: [{ id: 1, name: 'Acme', sippyIAccount: 900, sippyITariff: 61, provisioningStatus: 'provisioned' }],
      bought:   [{ companyId: 1, productId: 1 }, { companyId: 1, productId: 2 }, { companyId: 1, productId: 6 }],
      assigned: [{ iAccount: 900, productId: 1 }] });
    expect(only(r).products).toMatchObject({ bought: ['BC', 'FC', 'SB'], assigned: ['FC'], missing: ['BC', 'SB'] });
    expect(only(r).nextAction).toMatch(/bought but not configured under it: BC, SB/);
    expect(r.productGaps).toBe(1);
  });

  it('reports products configured under the account that were never bought', () => {
    const r = buildIdentityInventory({ ...base,
      companies: [{ id: 1, name: 'Acme', sippyIAccount: 900, sippyITariff: 61, provisioningStatus: 'provisioned' }],
      bought:   [{ companyId: 1, productId: 1 }],
      assigned: [{ iAccount: 900, productId: 1 }, { iAccount: 900, productId: 6 }] });
    expect(only(r).products.unexpected).toEqual(['SB']);
  });

  it('cannot state assignments for an unknown account — null, never an empty list', () => {
    const r = buildIdentityInventory({ ...base,
      companies: [{ id: 105, name: '1global', sippyIAccount: null, sippyITariff: 68, provisioningStatus: 'draft' }],
      bought: [{ companyId: 105, productId: 1 }],
      assigned: [{ iAccount: 1069, productId: 1 }] });
    // The products ARE configured on 1069; the platform just cannot see them without the id.
    expect(only(r).products.assigned).toBeNull();
    expect(only(r).products.missing).toEqual([]);
    expect(r.productGaps).toBe(0);
  });

  it('assignments follow the account id, so repairing the id reveals them', () => {
    const shared = { ...base, bought: [{ companyId: 105, productId: 1 }], assigned: [{ iAccount: 1069, productId: 1 }] };
    const before = buildIdentityInventory({ ...shared, companies: [{ id: 105, name: '1global', sippyIAccount: null, sippyITariff: 68, provisioningStatus: 'draft' }] });
    const after  = buildIdentityInventory({ ...shared, companies: [{ id: 105, name: '1global', sippyIAccount: 1069, sippyITariff: 68, provisioningStatus: 'provisioned' }] });
    expect(before.companies[0].products.assigned).toBeNull();
    expect(after.companies[0].products.assigned).toEqual(['FC']);
    expect(after.companies[0].nextAction).toMatch(/^None\./);
  });
});

describe('product rollup', () => {
  it('counts every registry product, including one nobody bought yet', () => {
    const r = buildIdentityInventory({ ...base,
      companies: [{ id: 1, name: 'Acme', sippyIAccount: 900, sippyITariff: 61, provisioningStatus: 'provisioned' }],
      bought: [{ companyId: 1, productId: 1 }, { companyId: 1, productId: 2 }],
      assigned: [{ iAccount: 900, productId: 1 }],
      pricedProductCodes: ['FC', 'BC', 'SB'] });
    expect(r.products).toEqual([
      { code: 'FC', name: 'First Class',    bought: 1, assigned: 1, missing: 0, priced: true },
      { code: 'BC', name: 'Business Class', bought: 1, assigned: 0, missing: 1, priced: true },
      { code: 'SB', name: 'Special Bravo',  bought: 0, assigned: 0, missing: 0, priced: true },
    ]);
  });

  it('marks a product the platform holds no prices for', () => {
    const r = buildIdentityInventory({ ...base, companies: [], pricedProductCodes: ['FC'] });
    expect(r.products.map(p => [p.code, p.priced])).toEqual([['FC', true], ['BC', false], ['SB', false]]);
  });
});

describe('ordering', () => {
  it('puts what needs a decision first and the healthy last', () => {
    const r = buildIdentityInventory({ ...base,
      companies: [
        { id: 1, name: 'Healthy',  sippyIAccount: 900, sippyITariff: 61, provisioningStatus: 'provisioned' },
        { id: 2, name: 'Nothing',  sippyIAccount: null, sippyITariff: null, provisioningStatus: 'draft' },
        { id: 3, name: 'Clash',    sippyIAccount: 111, sippyITariff: null, provisioningStatus: 'provisioned' },
        { id: 4, name: 'Fixable',  sippyIAccount: null, sippyITariff: 68, provisioningStatus: 'draft' },
      ],
      evidence: [step(3, 'account', { iAccount: 222 }), step(4, 'account', { iAccount: 1069 })] });
    expect(r.companies.map(c => c.identity.status)).toEqual(['CONFLICT', 'REPAIRABLE', 'NOT_PROVISIONED', 'VERIFIED']);
    expect(r.generatedFor).toBe(4);
  });
});
