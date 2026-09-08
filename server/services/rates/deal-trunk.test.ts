/**
 * P1 — the Sippy prefix a deal approval must send.
 *
 * Sippy tariffs store FULL prefixes: the product's trunk digit prepended to the dial prefix.
 * Verified in production 2026-09-08 — tariff 66 (Aura) holds 19231 (FC), 2880 (BC), 691 (SB)
 * and 79230 (SC) side by side, so all four trunks coexist by design.
 *
 * These tests pin the composition the deal-approval path performs, and the two ways it can
 * refuse. They deliberately exercise resolveDealDialPrefix + composePrefix together, because
 * that pairing IS the contract — either function alone is correct and useless.
 */
import { describe, it, expect } from "vitest";
import { resolveDealDialPrefix } from "./deal-prefix";
import { composePrefix } from "./rate-matrix";

/** Mirrors the route: guard the dial prefix, then prepend the product trunk. */
function dealSippyPrefix(trunkPrefix: string | null | undefined, rawDialPrefix: string | null | undefined): string | null {
  const trunk = String(trunkPrefix ?? '').trim();
  if (!/^\d+$/.test(trunk)) return null;          // route refuses the whole push
  const dial = resolveDealDialPrefix(rawDialPrefix);
  if (!dial) return null;                          // route reports this destination
  return composePrefix(trunk, dial);
}

describe("deal approval Sippy prefix (P1)", () => {
  it("prepends the product trunk — the Test-3071 fixture case", () => {
    // Jazz 92300 on a First Class deal must reach Sippy as 192300, never 92300.
    expect(dealSippyPrefix('1', '92300')).toBe('192300');
    expect(dealSippyPrefix('1', '92300')).not.toBe('92300');
  });

  it("composes correctly for all four canonical products", () => {
    expect(dealSippyPrefix('1', '9231')).toBe('19231'); // FC
    expect(dealSippyPrefix('2', '880')).toBe('2880');   // BC
    expect(dealSippyPrefix('6', '91')).toBe('691');     // SB
    expect(dealSippyPrefix('7', '9230')).toBe('79230'); // SC
  });

  it("reproduces prefixes observed in production tariff 66", () => {
    // Every one of these was read back from the live Aura tariff.
    expect(dealSippyPrefix('1', '9232')).toBe('19232');
    expect(dealSippyPrefix('7', '9232')).toBe('79232');
    expect(dealSippyPrefix('7', '9377')).toBe('79377');
  });

  it("REFUSES when the product has no trunk — never falls back to a bare prefix", () => {
    // composePrefix('', '9230') on its own returns '9230'. The guard is what stops that
    // bare value reaching a tariff with no product identity attached.
    expect(composePrefix('', '9230')).toBe('9230');
    expect(dealSippyPrefix('', '9230')).toBeNull();
    expect(dealSippyPrefix(null, '9230')).toBeNull();
    expect(dealSippyPrefix(undefined, '9230')).toBeNull();
    expect(dealSippyPrefix('  ', '9230')).toBeNull();
    expect(dealSippyPrefix('FC', '9230')).toBeNull();
  });

  it("still refuses a destination name, with a trunk present (P0 stays fixed)", () => {
    expect(dealSippyPrefix('1', 'PAKISTAN - MOBILE ZONG')).toBeNull();
    expect(dealSippyPrefix('1', null)).toBeNull();
    expect(dealSippyPrefix('1', '')).toBeNull();
  });

  it("strips a leading + before composing, not after", () => {
    // '+92' must become '192', never '1+92'.
    expect(dealSippyPrefix('1', '+92')).toBe('192');
  });
});
