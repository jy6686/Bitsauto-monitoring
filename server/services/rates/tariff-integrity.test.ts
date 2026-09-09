/**
 * The guard that should have stopped the 2026-09-08 near-miss.
 *
 * An authorised push aimed at tariff 61 was sent to tariff 2 — a live customer's tariff shared
 * by fifteen accounts. Nothing was written, but only because tariff 2 was locked at that
 * moment. These tests pin the three ways a push must be refused, and the single narrow case
 * where it may proceed.
 */
import { describe, it, expect } from "vitest";
import { checkTariffIntegrity } from "./tariff-integrity";

describe("checkTariffIntegrity", () => {
  it("REGRESSION — the tariff-2 near-miss is refused before any Sippy contact", () => {
    // Test-3071: provisioning built tariff 61 for it; Sippy bills account 1064 on tariff 2,
    // because the account was created without its service plan and got a shared default.
    const v = checkTariffIntegrity({ accountName: 'test-3071', storedITariff: 61, resolvedITariff: 2 });
    expect(v.safe).toBe(false);
    expect(v.safe === false && v.reason).toBe('mismatch');
    expect(v.safe === false && v.message).toContain('61');
    expect(v.safe === false && v.message).toContain('2');
  });

  it("allows a push only when provisioned and resolved agree", () => {
    // The four companies where the invariant currently holds.
    for (const [name, t] of [['PUSHTOTALK', 2], ['asterisk', 32], ['internal-ptcl', 33], ['test516', 2]] as const) {
      const v = checkTariffIntegrity({ accountName: name, storedITariff: t, resolvedITariff: t });
      expect(v.safe).toBe(true);
      expect(v.safe === true && v.storedITariff).toBe(t);
    }
  });

  it("REFUSES when no provisioned tariff is recorded — 'cannot check' is not 'safe'", () => {
    // 21 of 26 production companies are in this state, most resolving to shared tariff 2.
    const v = checkTariffIntegrity({ accountName: 'acmetel', storedITariff: null, resolvedITariff: 2 });
    expect(v.safe).toBe(false);
    expect(v.safe === false && v.reason).toBe('no_stored_tariff');
    expect(v.safe === false && v.message).toMatch(/every other account/i);
  });

  it("treats undefined stored the same as null", () => {
    const v = checkTariffIntegrity({ accountName: 'x', storedITariff: undefined, resolvedITariff: 2 });
    expect(v.safe === false && v.reason).toBe('no_stored_tariff');
  });

  it("REFUSES when the tariff could not be resolved at all", () => {
    for (const resolved of [null, undefined, '', 0, -1]) {
      const v = checkTariffIntegrity({ accountName: 'x', storedITariff: 61, resolvedITariff: resolved as any });
      expect(v.safe).toBe(false);
      expect(v.safe === false && v.reason).toBe('unresolved');
    }
  });

  it("accepts the string form the resolver actually produces", () => {
    // iTariffByAccountName stores String(resolvedTariff) — a string must not read as a mismatch.
    const v = checkTariffIntegrity({ accountName: 'PUSHTOTALK', storedITariff: 2, resolvedITariff: '2' });
    expect(v.safe).toBe(true);
  });

  it("refuses a non-integer or malformed resolved value rather than coercing it", () => {
    for (const bad of ['2.5', 'two', '2a', NaN]) {
      const v = checkTariffIntegrity({ accountName: 'x', storedITariff: 2, resolvedITariff: bad as any });
      expect(v.safe).toBe(false);
      expect(v.safe === false && v.reason).toBe('unresolved');
    }
  });

  it("names both tariffs in the refusal, so an operator can see which is which", () => {
    const v = checkTariffIntegrity({ accountName: 'test-3071', storedITariff: 61, resolvedITariff: 2 });
    expect(v.safe === false && v.storedITariff).toBe(61);
    expect(v.safe === false && v.resolvedITariff).toBe(2);
  });

  it("the production estate as measured 2026-09-08: 4 allowed, 22 refused", () => {
    const estate = [
      { accountName: 'PUSHTOTALK', storedITariff: 2, resolvedITariff: 2 },
      { accountName: 'asterisk', storedITariff: 32, resolvedITariff: 32 },
      { accountName: 'internal-ptcl', storedITariff: 33, resolvedITariff: 33 },
      { accountName: 'test516', storedITariff: 2, resolvedITariff: 2 },
      { accountName: 'test-3071', storedITariff: 61, resolvedITariff: 2 },
      ...['Internal-ptcl','Route-Inspector','acmetel','aircel','asif','calling','internal-afg',
          'internal-bd','internal-eritrea','internaltelstra','junaid','jytest1','noman','ptcl',
          'test12345','test2','test202','test3','test9','testingaccount','uzair']
        .map(n => ({ accountName: n, storedITariff: null, resolvedITariff: 2 })),
    ];
    const verdicts = estate.map(e => checkTariffIntegrity(e as any));
    expect(verdicts.filter(v => v.safe).length).toBe(4);
    expect(verdicts.filter(v => !v.safe).length).toBe(22);
  });
});
