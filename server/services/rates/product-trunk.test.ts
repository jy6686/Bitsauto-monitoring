/**
 * The Send Rate push composes `trunk + commercial dial prefix` and sends the result to a live
 * customer tariff. Before this guard the trunk was whatever the BROWSER sent, and
 * `(trunkPrefix ?? '') + prefix` turned an empty value into a bare prefix without complaint.
 *
 * These tests pin the two things that matter: the four canonical products compose correctly,
 * and every unusable registry value refuses rather than degrading to "no trunk".
 */
import { describe, it, expect } from "vitest";
import { validateTrunkPrefix } from "./product-trunk";
import { composePrefix } from "./rate-matrix";

describe("validateTrunkPrefix", () => {
  it("accepts the four canonical product trunks", () => {
    expect(validateTrunkPrefix('1')).toBe('1'); // First Class
    expect(validateTrunkPrefix('2')).toBe('2'); // Business Class
    expect(validateTrunkPrefix('6')).toBe('6'); // Special Bravo
    expect(validateTrunkPrefix('7')).toBe('7'); // Special Charlie
  });

  it("tolerates whitespace from a registry value", () => {
    expect(validateTrunkPrefix(' 1 ')).toBe('1');
  });

  it("REFUSES an empty trunk — the defect this guard replaces", () => {
    // The old code did `(trunkPrefix ?? '') + prefix`, which silently produced a bare
    // prefix on a live tariff. Null here makes the route return 400 instead.
    expect(validateTrunkPrefix('')).toBeNull();
    expect(validateTrunkPrefix('   ')).toBeNull();
    expect(validateTrunkPrefix(null)).toBeNull();
    expect(validateTrunkPrefix(undefined)).toBeNull();
  });

  it("refuses a product CODE mistaken for a trunk", () => {
    expect(validateTrunkPrefix('FC')).toBeNull();
    expect(validateTrunkPrefix('SC')).toBeNull();
  });

  it("refuses anything non-numeric or decorated", () => {
    expect(validateTrunkPrefix('1a')).toBeNull();
    expect(validateTrunkPrefix('+1')).toBeNull();
    expect(validateTrunkPrefix('1.0')).toBeNull();
    expect(validateTrunkPrefix('-1')).toBeNull();
  });
});

describe("Send Rate prefix composition (19k catalogue + server-derived trunk)", () => {
  // Jazz/Mobilink carries commercial prefix 9230 (migration 041). Live tariffs 2 and 32
  // already hold 19230, so this is the value the path must reproduce.
  it("composes the commercial Jazz prefix for each product", () => {
    const jazz = '9230';
    expect(composePrefix(validateTrunkPrefix('1')!, jazz)).toBe('19230'); // FC
    expect(composePrefix(validateTrunkPrefix('2')!, jazz)).toBe('29230'); // BC
    expect(composePrefix(validateTrunkPrefix('6')!, jazz)).toBe('69230'); // SB
    expect(composePrefix(validateTrunkPrefix('7')!, jazz)).toBe('79230'); // SC
  });

  it("reproduces prefixes read back from live tariff 66", () => {
    expect(composePrefix('1', '9231')).toBe('19231');
    expect(composePrefix('2', '880')).toBe('2880');
    expect(composePrefix('6', '91')).toBe('691');
    expect(composePrefix('7', '9232')).toBe('79232');
  });

  it("Zong's two commercial prefixes both take the same product trunk", () => {
    // One destination, several prefixes — the case that made an operator appear twice.
    for (const p of ['9231', '9237']) {
      expect(composePrefix('1', p)).toBe('1' + p);
    }
  });

  it("shows why the guard is needed: bare composition looks successful", () => {
    // composePrefix itself cannot tell a missing trunk from a deliberate one.
    expect(composePrefix('', '9230')).toBe('9230');
    expect(validateTrunkPrefix('')).toBeNull(); // ...so the route refuses before composing
  });
});
