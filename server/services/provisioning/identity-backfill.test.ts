import { describe, it, expect } from 'vitest';
import { planIdentityBackfill, parseStepResult, type BackfillEvidence, type CompanyNow } from './identity-backfill';

const ev = (companyId: number, stepKey: string, result: Record<string, unknown> | null, completedAt = '2026-09-15T09:30:00Z', status = 'success'): BackfillEvidence =>
  ({ companyId, stepKey, status, result, completedAt });

describe('planIdentityBackfill', () => {
  it('repairs 1global from its own run: the account step proved 1069, so the null is filled', () => {
    const companies: CompanyNow[] = [{ id: 105, name: '1global', sippyIAccount: null, sippyITariff: 68 }];
    const plan = planIdentityBackfill(companies, [ev(105, 'account', { iAccount: 1069, username: '1gloabl', reused: true })]);
    expect(plan.patches).toHaveLength(1);
    expect(plan.patches[0]).toMatchObject({ companyId: 105, companyName: '1global', sippyIAccount: 1069 });
    expect(plan.patches[0].sippyITariff).toBeUndefined();   // already recorded
    expect(plan.patches[0].because[0]).toMatch(/Sippy account 1069 — created or reused by this company's own provisioning run/);
    expect(plan.conflicts).toEqual([]);
  });

  it('fills a missing tariff from the tariff step, and both when both are missing', () => {
    const plan = planIdentityBackfill(
      [{ id: 7, name: 'Acme', sippyIAccount: 900, sippyITariff: null }, { id: 8, name: 'Beta', sippyIAccount: null, sippyITariff: null }],
      [ev(7, 'tariff', { iTariff: 61 }), ev(8, 'account', { iAccount: 901 }), ev(8, 'tariff', { iTariff: 62 })],
    );
    expect(plan.patches.find(p => p.companyId === 7)).toMatchObject({ sippyITariff: 61 });
    expect(plan.patches.find(p => p.companyId === 8)).toMatchObject({ sippyIAccount: 901, sippyITariff: 62 });
  });

  it('never matches by name — evidence must belong to that company', () => {
    // A run for company 9 cannot repair company 10, however similar the names.
    const plan = planIdentityBackfill(
      [{ id: 10, name: '1global', sippyIAccount: null, sippyITariff: 68 }],
      [ev(9, 'account', { iAccount: 1069, username: '1gloabl' })],
    );
    expect(plan.patches).toEqual([]);
    expect(plan.noEvidence[0].missing[0]).toMatch(/no successful account step/);
  });

  it('takes the latest successful step when a company has several runs', () => {
    const plan = planIdentityBackfill(
      [{ id: 3, name: 'Gamma', sippyIAccount: null }],
      [ev(3, 'account', { iAccount: 500 }, '2026-09-01T10:00:00Z'), ev(3, 'account', { iAccount: 777 }, '2026-09-14T10:00:00Z')],
    );
    expect(plan.patches[0].sippyIAccount).toBe(777);
  });

  it('ignores steps that did not succeed, and unusable ids', () => {
    const plan = planIdentityBackfill(
      [{ id: 4, name: 'Delta', sippyIAccount: null }],
      [ev(4, 'account', { iAccount: 1069 }, '2026-09-15T09:00:00Z', 'failed'), ev(4, 'account', { iAccount: 0 }), ev(4, 'account', null)],
    );
    expect(plan.patches).toEqual([]);
    expect(plan.noEvidence).toHaveLength(1);
  });

  it('reports a contradiction instead of overwriting a recorded id', () => {
    const plan = planIdentityBackfill(
      [{ id: 5, name: 'Epsilon', sippyIAccount: 111, sippyITariff: null }],
      [ev(5, 'account', { iAccount: 222 }), ev(5, 'tariff', { iTariff: 33 })],
    );
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0]).toMatchObject({ field: 'sippyIAccount', recorded: 111, evidence: 222 });
    expect(plan.conflicts[0].message).toMatch(/Not changed/);
    // the uncontested field is still repaired
    expect(plan.patches[0]).toMatchObject({ sippyITariff: 33 });
  });

  it('counts a company that already holds both and proposes nothing for it', () => {
    const plan = planIdentityBackfill(
      [{ id: 6, name: 'Zeta', sippyIAccount: 1, sippyITariff: 2 }],
      [ev(6, 'account', { iAccount: 99 })],
    );
    expect(plan.alreadyComplete).toBe(1);
    expect(plan.patches).toEqual([]);
    expect(plan.conflicts).toEqual([]);
  });
});

describe('parseStepResult', () => {
  it('reads a JSON string, passes an object through, and refuses anything else', () => {
    expect(parseStepResult('{"iAccount":1069}')).toEqual({ iAccount: 1069 });
    expect(parseStepResult({ iAccount: 7 })).toEqual({ iAccount: 7 });
    for (const bad of [null, undefined, 'not json', '[1,2]', '42', '']) {
      const r = parseStepResult(bad);
      expect(r === null || !('iAccount' in (r as object))).toBe(true);
    }
  });
});
