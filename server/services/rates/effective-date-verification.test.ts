/**
 * SMP-006 — effective-dated pushes were applied twice.
 *
 * The rows below are the EXACT read-back from tariff 64 on 2026-09-14 after the ALLOW pilot: the
 * upload had created the scheduled row (9175, activating 2026-09-22) and the old verifier, judging
 * the first row for the prefix, found the live one still at 0.133 and called the upload a failure.
 * The portal fallback then edited the live row. Both halves are guarded here: the verifier picks
 * the row the request was about, and the fallback refuses a future-dated rate outright.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { selectVerificationRow } from "../../sippy";

const LIVE      = { prefix: '19370', rate: 0.133, effectiveFrom: '20260731T17:00:00' };
const SCHEDULED = { prefix: '19370', rate: 0.196, effectiveFrom: '20260922T00:00:00' };
const OTHER     = { prefix: '19371', rate: 0.05,  effectiveFrom: '20260101T00:00:00' };

describe("selectVerificationRow — the row the request was about", () => {
  it("THE PILOT: after a future-dated upload, judges the scheduled row, not the live one", () => {
    // Read-back order on 2026-09-14 put the scheduled row first; the pre-fix code's behaviour did
    // not depend on order, it depended on ignoring dates. Both orders must pick 9175.
    for (const rates of [[SCHEDULED, LIVE, OTHER], [LIVE, SCHEDULED, OTHER]]) {
      const { row, reason } = selectVerificationRow(rates, '19370', '2026-09-22 00:00:00');
      expect(row).toBe(SCHEDULED);
      expect(reason).toBe('row activating 20260922');
    }
  });

  it("BEFORE the upload lands, the same request finds only the live row — and says so", () => {
    // This is the pre-upload state. Judging the live row at 0.133 against 0.196 is a correct
    // "not confirmed"; what changed is that once the scheduled row EXISTS it is the one judged.
    const { row, reason } = selectVerificationRow([LIVE, OTHER], '19370', '2026-09-22 00:00:00');
    expect(row).toBe(LIVE);
    expect(reason).toMatch(/no row activating 20260922; judged the latest-activating row \(20260731\)/);
  });

  it("with NO effective date requested, behaviour is unchanged: first row for the prefix", () => {
    expect(selectVerificationRow([LIVE, SCHEDULED], '19370').row).toBe(LIVE);
    expect(selectVerificationRow([SCHEDULED, LIVE], '19370').row).toBe(SCHEDULED);
    expect(selectVerificationRow([LIVE], '19370', '').reason).toMatch(/no effective date requested/);
  });

  it("compares dates on their digits, whatever the two sides' formats", () => {
    const r = selectVerificationRow([LIVE, SCHEDULED], '19370', '2026-09-22');
    expect(r.row).toBe(SCHEDULED);
    expect(selectVerificationRow([LIVE, { ...SCHEDULED, effectiveFrom: '2026-09-22 00:00:00' }], '19370', '20260922T00:00:00').row?.rate).toBe(0.196);
  });

  it("never picks another prefix's row", () => {
    expect(selectVerificationRow([OTHER], '19370', '2026-09-22').row).toBeUndefined();
  });
});

describe("the write path, asserted against server/sippy.ts", () => {
  const SRC = readFileSync(join(__dirname, '..', '..', 'sippy.ts'), 'utf8');
  const code = SRC.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

  it("every in-function verification passes the requested effective date", () => {
    // Four call sites inside setSippyRateEntry: direct edit, two after upload, and portal_csv.
    const withDate = (code.match(/verifySippyRate\([\s\S]{0,140}?\{ effectiveFrom: normaliseEntryDate\(entry\.effectiveFrom\) \}/g) || []).length;
    expect(withDate).toBe(4);
    // And none of those four still calls it WITHOUT the date.
    expect(code).not.toMatch(/verifySippyRate\(username, password, tariffId, entry\.prefix, entry\.rate, base\);/);
  });

  it("the verifier uses the selector, not the first prefix match", () => {
    expect(code).toContain('selectVerificationRow(result.rates, prefix, opts.effectiveFrom)');
    expect(code).not.toContain('result.rates.find(r => r.prefix === prefix)');
  });

  it("THE GATE: the portal fallback refuses a future-dated rate, before calling it", () => {
    const at = code.indexOf("if (requestedAction === 'A') {");
    const fallback = code.indexOf('const portalResult = await pushRateViaPortalUpload(');
    expect(at).toBeGreaterThan(-1);
    expect(fallback).toBeGreaterThan(at);
    const gate = code.slice(at, fallback);
    expect(gate).toContain('return {');
    expect(gate).toContain("verificationResult: 'skip'");
    expect(gate).not.toContain("verificationResult: 'mismatch'");   // mismatch = retryable; the upload MAY have landed
    expect(gate).toMatch(/Read tariff \$\{tariffId\} before writing to it again/);
  });

  it("the gate does not remove the fallback for same-day edits", () => {
    expect(code).toContain('const portalResult = await pushRateViaPortalUpload(');
  });
});
