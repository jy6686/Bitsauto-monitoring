/**
 * The guard's whole job is to refuse things that look plausible. The case that matters
 * most is the one that shipped: a destination NAME arriving where a prefix belongs.
 */
import { describe, it, expect } from "vitest";
import { resolveDealDialPrefix } from "./deal-prefix";

describe("resolveDealDialPrefix", () => {
  it("passes a plain dial prefix through unchanged", () => {
    expect(resolveDealDialPrefix("9230")).toBe("9230");
    expect(resolveDealDialPrefix("880")).toBe("880");
    expect(resolveDealDialPrefix("1")).toBe("1");
  });

  it("strips one leading + the way the destination tree stores some prefixes", () => {
    expect(resolveDealDialPrefix("+92")).toBe("92");
    expect(resolveDealDialPrefix("  +9230  ")).toBe("9230");
  });

  it("REFUSES a destination name — the defect this guard exists for", () => {
    expect(resolveDealDialPrefix("PAKISTAN - MOBILE ZONG")).toBeNull();
    expect(resolveDealDialPrefix("Pakistan MOBILE")).toBeNull();
    expect(resolveDealDialPrefix("Zong")).toBeNull();
  });

  it("refuses absent or blank values instead of inventing a prefix", () => {
    expect(resolveDealDialPrefix(null)).toBeNull();
    expect(resolveDealDialPrefix(undefined)).toBeNull();
    expect(resolveDealDialPrefix("")).toBeNull();
    expect(resolveDealDialPrefix("   ")).toBeNull();
    expect(resolveDealDialPrefix("+")).toBeNull();
  });

  it("refuses formatted numbers — spaces, dashes, decimals are not what Sippy matches on", () => {
    expect(resolveDealDialPrefix("92 300")).toBeNull();
    expect(resolveDealDialPrefix("92-300")).toBeNull();
    expect(resolveDealDialPrefix("92.3")).toBeNull();
    expect(resolveDealDialPrefix("++92")).toBeNull();
  });

  it("refuses anything with a letter in it, even one", () => {
    expect(resolveDealDialPrefix("9230a")).toBeNull();
    expect(resolveDealDialPrefix("x9230")).toBeNull();
  });
});
