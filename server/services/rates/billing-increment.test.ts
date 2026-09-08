/**
 * These tests exist because the parser's output becomes a billing term on a live switch.
 * The cases that matter most are the ones where a plausible-looking string must be
 * REFUSED rather than coerced — coercion here bills a real customer wrongly.
 */
import { describe, it, expect } from "vitest";
import {
  parseBillingIncrement,
  differsFromCurrentBehaviour,
  formatBillingIncrement,
  CURRENT_HARDCODED_INCREMENT,
} from "./billing-increment";

describe("parseBillingIncrement", () => {
  it("reads every increment the catalogue import is documented to carry", () => {
    // migration 500: billing_increment TEXT -- as supplied: '1/1', '60/1', '60/60', '30/6', '6/6'
    expect(parseBillingIncrement("1/1")).toEqual({ interval1: 1, intervalN: 1 });
    expect(parseBillingIncrement("60/1")).toEqual({ interval1: 60, intervalN: 1 });
    expect(parseBillingIncrement("60/60")).toEqual({ interval1: 60, intervalN: 60 });
    expect(parseBillingIncrement("30/6")).toEqual({ interval1: 30, intervalN: 6 });
    expect(parseBillingIncrement("6/6")).toEqual({ interval1: 6, intervalN: 6 });
  });

  it("tolerates the whitespace a spreadsheet export leaves behind", () => {
    expect(parseBillingIncrement("  60/60  ")).toEqual({ interval1: 60, intervalN: 60 });
    expect(parseBillingIncrement("60 / 60")).toEqual({ interval1: 60, intervalN: 60 });
  });

  it("returns null for absent or blank values rather than assuming per-second", () => {
    expect(parseBillingIncrement(null)).toBeNull();
    expect(parseBillingIncrement(undefined)).toBeNull();
    expect(parseBillingIncrement("")).toBeNull();
    expect(parseBillingIncrement("   ")).toBeNull();
  });

  it("refuses a bare number — '60' does not say what the subsequent interval is", () => {
    expect(parseBillingIncrement("60")).toBeNull();
    expect(parseBillingIncrement("1")).toBeNull();
  });

  it("refuses zero, which is a division by zero on the switch and not 'bill nothing'", () => {
    expect(parseBillingIncrement("0/1")).toBeNull();
    expect(parseBillingIncrement("60/0")).toBeNull();
    expect(parseBillingIncrement("0/0")).toBeNull();
  });

  it("refuses values too large to be a billing increment", () => {
    expect(parseBillingIncrement("3600/1")).toEqual({ interval1: 3600, intervalN: 1 });
    expect(parseBillingIncrement("3601/1")).toBeNull();
    expect(parseBillingIncrement("9999/9999")).toBeNull();
  });

  it("refuses text, separators we never agreed, and decimals", () => {
    expect(parseBillingIncrement("per second")).toBeNull();
    expect(parseBillingIncrement("60-60")).toBeNull();
    expect(parseBillingIncrement("60:60")).toBeNull();
    expect(parseBillingIncrement("60,60")).toBeNull();
    expect(parseBillingIncrement("1.5/1")).toBeNull();
    expect(parseBillingIncrement("60/60/60")).toBeNull();
  });

  it("refuses a negative, which the pattern must not read as a subtraction", () => {
    expect(parseBillingIncrement("-60/1")).toBeNull();
    expect(parseBillingIncrement("60/-1")).toBeNull();
  });
});

describe("differsFromCurrentBehaviour", () => {
  it("is false for 1/1 — that row already sends the right thing", () => {
    expect(differsFromCurrentBehaviour("1/1")).toBe(false);
  });

  it("is true for every increment that is not per-second", () => {
    expect(differsFromCurrentBehaviour("60/1")).toBe(true);
    expect(differsFromCurrentBehaviour("60/60")).toBe(true);
    expect(differsFromCurrentBehaviour("30/6")).toBe(true);
    expect(differsFromCurrentBehaviour("6/6")).toBe(true);
  });

  it("is false for unreadable values — 'cannot tell' is not 'would change'", () => {
    // The report counts these separately. Conflating them would understate the unknown
    // and overstate the measured blast radius.
    expect(differsFromCurrentBehaviour(null)).toBe(false);
    expect(differsFromCurrentBehaviour("")).toBe(false);
    expect(differsFromCurrentBehaviour("garbage")).toBe(false);
  });
});

describe("formatBillingIncrement", () => {
  it("round-trips a parsed value to one canonical spelling", () => {
    expect(formatBillingIncrement(parseBillingIncrement("60 / 60")!)).toBe("60/60");
    expect(formatBillingIncrement(CURRENT_HARDCODED_INCREMENT)).toBe("1/1");
  });
});
