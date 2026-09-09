/**
 * The two directions that matter, both taken from real production behaviour:
 *
 *   banner + read-back FOUND the rate   -> SUCCESS   (job #43: reported failed, had written)
 *   page looked fine + read-back MISSED -> FAILURE   (a page is never proof)
 *
 * Plus the interval assertion, so "60/1 arrived" is an acceptance criterion rather than a
 * production-only observation.
 */
import { describe, it, expect } from "vitest";
import { classifyPortalWrite, type PortalPageSignals, type PortalReadBack } from "./portal-write-outcome";

const CTX = { operation: 'add' as const, tariffId: 64, prefix: '19370', rate: 0.133, iRate: 9200,
              expectedInterval1: 60, expectedIntervalN: 1 };
const CLEAN_PAGE: PortalPageSignals = { isLoginPage: false, hasError: false, lockBanner: null, statusCode: 200, bodyLength: 12000 };
const LOCKED_PAGE: PortalPageSignals = { ...CLEAN_PAGE, lockBanner: 'Tariff is locked for making changes, processing of uploaded file is in progress.' };
const FOUND: PortalReadBack = { confirmed: true, message: 'ok', foundRate: 0.133, foundInterval1: 60, foundIntervalN: 1 };
const MISSING: PortalReadBack = { confirmed: false, message: 'prefix 19370 not found in tariff 64 after push (tariff holds 1 rate(s))' };

describe("classifyPortalWrite — the tariff decides, not the page", () => {
  it("JOB #43 REGRESSION: lock banner + read-back FOUND the rate -> SUCCESS, banner surfaced", () => {
    // The exact contradiction that told an operator nothing had happened while a rate was destroyed.
    const o = classifyPortalWrite(CTX, LOCKED_PAGE, FOUND);
    expect(o.success).toBe(true);
    expect(o.pageContradictedTariff).toBe(true);
    expect(o.message).toContain('lock banner');
    expect(o.message).toContain('the banner was not the outcome');
  });

  it("page looks perfectly successful + read-back MISSED -> FAILURE", () => {
    // HTTP 200 and a big body were the old success test. They prove nothing.
    const o = classifyPortalWrite(CTX, CLEAN_PAGE, MISSING);
    expect(o.success).toBe(false);
    expect(o.pageContradictedTariff).toBe(true);
    expect(o.message).toContain('not found in tariff 64');
  });

  it("clean page + read-back found -> plain success with the increment confirmed", () => {
    const o = classifyPortalWrite(CTX, CLEAN_PAGE, FOUND);
    expect(o.success).toBe(true);
    expect(o.pageContradictedTariff).toBe(false);
    expect(o.message).toContain('Increment 60/1 confirmed');
  });

  it("FIX #2 ACCEPTANCE: right rate, WRONG interval -> failure, not partial success", () => {
    // 1/1 where the catalogue says 60/1 is the exact defect the increment work exists for.
    const wrongInterval: PortalReadBack = { ...FOUND, foundInterval1: 1, foundIntervalN: 1 };
    const o = classifyPortalWrite(CTX, CLEAN_PAGE, wrongInterval);
    expect(o.success).toBe(false);
    expect(o.message).toContain('billing increment is 1/1');
    expect(o.message).toContain('catalogue says 60/1');
  });

  it("says so when the increment could not be verified, rather than implying it was", () => {
    const noIntervals: PortalReadBack = { confirmed: true, message: 'ok', foundRate: 0.133 };
    const o = classifyPortalWrite(CTX, CLEAN_PAGE, noIntervals);
    expect(o.success).toBe(true);
    expect(o.message).toContain('Increment NOT verified');
  });

  it("every failure warns that the write may still have changed something", () => {
    for (const page of [
      LOCKED_PAGE,
      { ...CLEAN_PAGE, isLoginPage: true },
      { ...CLEAN_PAGE, hasError: true, errorText: 'Invalid prefix' },
      CLEAN_PAGE,
    ] as PortalPageSignals[]) {
      const o = classifyPortalWrite(CTX, page, MISSING);
      expect(o.success).toBe(false);
      expect(o.message).toMatch(/mutates before it can report/);
    }
  });

  it("no read-back at all -> UNVERIFIED, never inferred success", () => {
    const o = classifyPortalWrite(CTX, CLEAN_PAGE, null);
    expect(o.success).toBe(false);
    expect(o.message).toContain('UNVERIFIED');
    // and it must NOT claim the tariff lacks the rate — that was never established
    expect(o.message).not.toContain('does not show');
  });

  it("distinguishes the causes when the read-back missed", () => {
    expect(classifyPortalWrite(CTX, { ...CLEAN_PAGE, isLoginPage: true }, MISSING).message).toContain('session rejected');
    expect(classifyPortalWrite(CTX, { ...CLEAN_PAGE, hasError: true, errorText: 'Invalid prefix' }, MISSING).message).toContain('Invalid prefix');
    expect(classifyPortalWrite(CTX, LOCKED_PAGE, MISSING).message).toContain('is locked');
  });

  it("reports the edit operation with its own wording", () => {
    const o = classifyPortalWrite({ ...CTX, operation: 'edit' }, CLEAN_PAGE, FOUND);
    expect(o.message).toContain('updated in tariff 64');
  });
});
