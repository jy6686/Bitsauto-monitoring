import { describe, it, expect } from 'vitest';
import { identityPatchFor, hasPatch, shouldMarkProvisioned } from './identity-writeback';

describe('identityPatchFor', () => {
  it('records the account id a verified step returned — the 1global case, where NULL broke every push', () => {
    const p = identityPatchFor({ stepKey: 'account', status: 'success', result: { iAccount: 1069, username: '1gloabl', reused: true } }, { sippyIAccount: null, sippyITariff: 68 });
    expect(p).toEqual({ sippyIAccount: 1069 });
    expect(hasPatch(p)).toBe(true);
  });

  it('records the tariff id from the tariff step', () => {
    expect(identityPatchFor({ stepKey: 'tariff', status: 'success', result: { iTariff: 68 } }, { sippyITariff: null })).toEqual({ sippyITariff: 68 });
  });

  it('writes nothing when the company already records the same value', () => {
    expect(identityPatchFor({ stepKey: 'account', status: 'success', result: { iAccount: 1069 } }, { sippyIAccount: 1069 })).toEqual({});
    expect(identityPatchFor({ stepKey: 'tariff', status: 'success', result: { iTariff: 68 } }, { sippyITariff: 68 })).toEqual({});
  });

  it('never writes from a step that did not succeed, or that returned nothing usable', () => {
    expect(identityPatchFor({ stepKey: 'account', status: 'failed', result: { iAccount: 1069 } }, {})).toEqual({});
    expect(identityPatchFor({ stepKey: 'account', status: 'skipped', result: { iAccount: 1069 } }, {})).toEqual({});
    expect(identityPatchFor({ stepKey: 'account', status: 'success', result: null }, {})).toEqual({});
    for (const bad of [0, -1, 'abc', null, undefined, '', 1.5]) {
      expect(identityPatchFor({ stepKey: 'account', status: 'success', result: { iAccount: bad } }, {})).toEqual({});
    }
  });

  it('never clears a recorded value when a later run proves nothing', () => {
    expect(identityPatchFor({ stepKey: 'account', status: 'success', result: {} }, { sippyIAccount: 1069 })).toEqual({});
  });

  it('ignores steps that prove no identity', () => {
    for (const key of ['service_plan', 'authentication', 'capacity', 'rates', 'account_email']) {
      expect(identityPatchFor({ stepKey: key, status: 'success', result: { iAccount: 9, iTariff: 9 } }, {})).toEqual({});
    }
  });
});

describe('shouldMarkProvisioned', () => {
  const account = (status: string) => [{ key: 'tariff', status: 'success' }, { key: 'account', status }];

  it('a customer whose account was created is provisioned, warnings and all', () => {
    expect(shouldMarkProvisioned('completed', account('success'))).toBe(true);
    // Run #32 ended completed_with_warnings; calling that 'draft' is what hid the customer.
    expect(shouldMarkProvisioned('completed_with_warnings', account('success'))).toBe(true);
  });

  it('no account, no claim', () => {
    expect(shouldMarkProvisioned('completed_with_warnings', account('failed'))).toBe(false);
    expect(shouldMarkProvisioned('completed', account('skipped'))).toBe(false);
    expect(shouldMarkProvisioned('failed', account('success'))).toBe(false);
    expect(shouldMarkProvisioned('running', account('success'))).toBe(false);
  });
});
