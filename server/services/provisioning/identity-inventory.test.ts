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
    // Repairing the id reveals the products, but it does NOT prove the billing tariff:
    // no run recorded a read-back here, so the report refuses to say "nothing to do".
    expect(after.companies[0].products.state).toEqual([
      { code: 'FC', state: 'CONFIGURED' }, { code: 'BC', state: 'NOT_SOLD' }, { code: 'SB', state: 'NOT_SOLD' },
    ]);
    expect(after.companies[0].nextAction).toMatch(/billing plan to tariff link is unverified/);
  });
});

describe('billing link — the tariff hangs off the PLAN, not the account', () => {
  const acct = (extra: Record<string, unknown>) => ({
    companyId: 105, stepKey: 'account', status: 'success',
    result: { iAccount: 1069 }, completedAt: '2026-09-15T09:50:00Z', ...extra,
  });
  const company = (tariff: number | null) =>
    [{ id: 105, name: '1global', sippyIAccount: 1069, sippyITariff: tariff, provisioningStatus: 'provisioned' }];
  const PLANS = [{ id: 38, name: '1global', iTariff: 68 }, { id: 12, name: 'Someone else', iTariff: 2 }];

  it('an account with no tariff of its own is NOT a missing link — the plan carries it', () => {
    // This is the live shape: "Account 1069 (1gloabl) — service plan 38, tariff (none)".
    const r = buildIdentityInventory({ ...base, plans: PLANS, companies: company(68),
      evidence: [acct({ detail: ['Account 1069 (1gloabl) — service plan 38, tariff (none)'] })] });
    expect(only(r).billing).toMatchObject({ verdict: 'MATCHES', servicePlan: 38, switchTariff: 68, source: 'recorded read-back line' });
    expect(only(r).billing.note).toMatch(/bills through plan 38 \("1global"\) on tariff 68/);
  });

  it('is NO_EVIDENCE when only the tariff step ran — building a tariff never proves billing', () => {
    const r = buildIdentityInventory({ ...base, plans: PLANS, companies: company(68),
      evidence: [step(105, 'tariff', { iTariff: 68 })] });
    expect(only(r).billing).toMatchObject({ verdict: 'NO_EVIDENCE', servicePlan: null, switchTariff: null });
    expect(only(r).billing.note).toMatch(/the tariff hangs off the plan/);
  });

  it('reads the structured verify metric when a run recorded one', () => {
    const r = buildIdentityInventory({ ...base, plans: PLANS, companies: company(68),
      evidence: [acct({ metrics: { accountBillingPlan: 38 } })] });
    expect(only(r).billing).toMatchObject({ verdict: 'MATCHES', servicePlan: 38, source: 'verify metrics' });
  });

  it('falls back to servicePlanActual, which runs since migration 056 already carry', () => {
    const r = buildIdentityInventory({ ...base, plans: PLANS, companies: company(68),
      evidence: [acct({ metrics: { servicePlanActual: 38, verified: 1 } })] });
    expect(only(r).billing).toMatchObject({ verdict: 'MATCHES', servicePlan: 38 });
  });

  it('DIFFERS when the plan carries a tariff the platform does not store', () => {
    const r = buildIdentityInventory({ ...base, plans: PLANS, companies: company(68),
      evidence: [acct({ metrics: { accountBillingPlan: 12 } })] });
    expect(only(r).billing).toMatchObject({ verdict: 'DIFFERS', servicePlan: 12, switchTariff: 2 });
    expect(only(r).billing.note).toMatch(/Rates loaded into 68 are never consulted/);
    expect(only(r).nextAction).toMatch(/bills through plan 12 on tariff 2/);
  });

  it('PLAN_MISSING when the account is on a plan the switch no longer has', () => {
    const r = buildIdentityInventory({ ...base, plans: PLANS, companies: company(68),
      evidence: [acct({ metrics: { accountBillingPlan: 999 } })] });
    expect(only(r).billing).toMatchObject({ verdict: 'PLAN_MISSING', servicePlan: 999, switchTariff: null });
    expect(only(r).nextAction).toMatch(/billing plan 999 is absent from the switch/);
  });

  it('says so rather than guessing when the plan list could not be read', () => {
    const r = buildIdentityInventory({ ...base, companies: company(68),
      evidence: [acct({ metrics: { accountBillingPlan: 38 } })] });   // no plans passed
    expect(only(r).billing).toMatchObject({ verdict: 'NO_EVIDENCE', servicePlan: 38, switchTariff: null });
    expect(only(r).billing.note).toMatch(/plan list could not be read/);
  });

  it('counts the four verdicts across the platform', () => {
    const r = buildIdentityInventory({ ...base, plans: PLANS,
      companies: [
        { id: 1, name: 'A', sippyIAccount: 10, sippyITariff: 68, provisioningStatus: 'provisioned' },
        { id: 2, name: 'B', sippyIAccount: 20, sippyITariff: 68, provisioningStatus: 'provisioned' },
        { id: 3, name: 'C', sippyIAccount: 30, sippyITariff: 68, provisioningStatus: 'provisioned' },
        { id: 4, name: 'D', sippyIAccount: 40, sippyITariff: 68, provisioningStatus: 'provisioned' },
      ],
      evidence: [
        { companyId: 1, stepKey: 'account', status: 'success', result: {}, metrics: { accountBillingPlan: 38 } },
        { companyId: 2, stepKey: 'account', status: 'success', result: {}, metrics: { accountBillingPlan: 12 } },
        { companyId: 3, stepKey: 'account', status: 'success', result: {}, metrics: { accountBillingPlan: 777 } },
      ] });
    expect(r.billingLinks).toEqual({ matches: 1, differs: 1, planMissing: 1, noEvidence: 1 });
  });
});

describe('per-product state', () => {
  it('names every registry product, and UNKNOWN is not MISSING', () => {
    const r = buildIdentityInventory({ ...base,
      companies: [{ id: 105, name: '1global', sippyIAccount: null, sippyITariff: 68, provisioningStatus: 'draft' }],
      bought: [{ companyId: 105, productId: 1 }, { companyId: 105, productId: 6 }],
      assigned: [{ iAccount: 1069, productId: 1 }] });
    // Account unresolved: the platform cannot see assignments, and that is not absence.
    expect(only(r).products.state).toEqual([
      { code: 'FC', state: 'UNKNOWN' }, { code: 'BC', state: 'UNKNOWN' }, { code: 'SB', state: 'UNKNOWN' },
    ]);
  });

  it('separates configured, missing, unexpected and not-sold once the account is known', () => {
    const r = buildIdentityInventory({ ...base,
      companies: [{ id: 1, name: 'Acme', sippyIAccount: 900, sippyITariff: 61, provisioningStatus: 'provisioned' }],
      bought:   [{ companyId: 1, productId: 1 }, { companyId: 1, productId: 2 }],
      assigned: [{ iAccount: 900, productId: 1 }, { iAccount: 900, productId: 6 }] });
    expect(only(r).products.state).toEqual([
      { code: 'FC', state: 'CONFIGURED' },   // bought and configured
      { code: 'BC', state: 'MISSING' },      // bought, not configured
      { code: 'SB', state: 'UNEXPECTED' },   // configured, never bought
    ]);
  });

  it('NOT_SOLD where nothing is owed', () => {
    const r = buildIdentityInventory({ ...base,
      companies: [{ id: 1, name: 'Acme', sippyIAccount: 900, sippyITariff: 61, provisioningStatus: 'provisioned' }],
      bought: [{ companyId: 1, productId: 1 }], assigned: [{ iAccount: 900, productId: 1 }] });
    expect(only(r).products.state.map(s => s.state)).toEqual(['CONFIGURED', 'NOT_SOLD', 'NOT_SOLD']);
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
