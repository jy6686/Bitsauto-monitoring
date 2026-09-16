import { describe, it, expect } from 'vitest';
import { buildIdentityInventory, type InventoryProduct } from './identity-inventory';
import { renderIdentityInventoryText } from './identity-inventory-text';

const PRODUCTS: InventoryProduct[] = [
  { id: 1, code: 'FC', name: 'First Class',    trunkPrefix: '1' },
  { id: 2, code: 'BC', name: 'Business Class', trunkPrefix: '2' },
];

const report = () => buildIdentityInventory({
  products: PRODUCTS,
  companies: [
    { id: 105, name: '1global', sippyIAccount: null, sippyITariff: 68, provisioningStatus: 'draft' },
    { id: 7,   name: 'Acme',    sippyIAccount: 900,  sippyITariff: 61, provisioningStatus: 'provisioned' },
  ],
  plans: [{ id: 38, name: '1global', iTariff: 68 }, { id: 4, name: 'Shared', iTariff: 12 }],
  evidence: [
    { companyId: 105, stepKey: 'account', status: 'success', result: { iAccount: 1069 },
      detail: ['Account 1069 (1gloabl) — service plan 38, tariff (none)'], completedAt: '2026-09-15T09:50:00Z' },
    { companyId: 7, stepKey: 'account', status: 'success', result: { iAccount: 900 },
      metrics: { accountBillingPlan: 4 }, completedAt: '2026-09-15T09:50:00Z' },
  ],
  bought:   [{ companyId: 105, productId: 1 }, { companyId: 7, productId: 1 }, { companyId: 7, productId: 2 }],
  assigned: [{ iAccount: 900, productId: 1 }],
  pricedProductCodes: ['FC'],
});

describe('renderIdentityInventoryText', () => {
  it('states read-only provenance at the top', () => {
    const t = renderIdentityInventoryText({ ...report(), generatedAt: '2026-09-16T10:00:00Z' });
    expect(t).toMatch(/READ-ONLY/);
    expect(t).toMatch(/No company record was written and no Sippy call was made/);
    expect(t).toMatch(/2026-09-16T10:00:00Z/);
  });

  it('gives each company the four evidence lines and a next action', () => {
    const t = renderIdentityInventoryText(report());
    const block = t.split('\n\n').find(b => b.startsWith('1global'))!;
    expect(block).toMatch(/Stored Sippy account\s*: none/);
    expect(block).toMatch(/Identity evidence\s*: REPAIRABLE/);
    expect(block).toMatch(/Billing-link evidence\s*: MATCHES \(from recorded read-back line\)/);
    expect(block).toMatch(/Stored tariff\s*: 68/);
    expect(block).toMatch(/Next action/);
  });

  it('never lets UNKNOWN read as a blank or as missing', () => {
    const t = renderIdentityInventoryText(report());
    const block = t.split('\n\n').find(b => b.startsWith('1global'))!;
    expect(block).toMatch(/FC UNKNOWN · BC UNKNOWN/);
    expect(block).not.toMatch(/MISSING/);
  });

  it('shows a billing discrepancy as its own verdict, not folded into identity', () => {
    const t = renderIdentityInventoryText(report());
    const block = t.split('\n\n').find(b => b.startsWith('Acme'))!;
    expect(block).toMatch(/Identity evidence\s*: VERIFIED/);
    expect(block).toMatch(/Billing-link evidence\s*: DIFFERS \(from verify metrics\)/);
    expect(block).toMatch(/Rates loaded into 61 are never consulted/);
    expect(block).toMatch(/bills through plan 4 \("Shared"\) on tariff 12/);
    expect(block).toMatch(/Settle\s+which tariff is theirs/);   // \s+ because the line wraps
  });

  it('counts the three billing verdicts and flags an unpriced product', () => {
    const t = renderIdentityInventoryText(report());
    expect(t).toMatch(/Billing link\s+MATCHES 1 · DIFFERS 1 · PLAN_MISSING 0 · NO_EVIDENCE 0/);
    expect(t).toMatch(/BC\s+Business Class.*NO — nothing sendable/);
    expect(t).toMatch(/FC\s+First Class.*yes/);
  });

  it('closes by restating that nothing was applied', () => {
    expect(renderIdentityInventoryText(report())).toMatch(/remain unauthorised\.$/);
  });

  it('wraps a long note instead of producing a single unreadable line', () => {
    const t = renderIdentityInventoryText(report());
    for (const line of t.split('\n')) expect(line.length).toBeLessThan(125);
  });
});
