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
    // Five call sites inside setSippyRateEntryInner: direct edit, after FAIL, two after upload, portal_csv.
    const withDate = (code.match(/verifySippyRate\([\s\S]{0,140}?\{ effectiveFrom: normaliseEntryDate\(entry\.effectiveFrom\) \}/g) || []).length;
    expect(withDate).toBe(5);
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

describe("the upload poller, after the 2026-09-15 pilot", () => {
  const SRC = readFileSync(join(__dirname, '..', '..', 'sippy.ts'), 'utf8');
  const code = SRC.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

  /** One function's text, from its declaration to the next top-level function. */
  const fn = (decl: string) => {
    const at = code.indexOf(decl);
    expect(at, `${decl} must exist`).toBeGreaterThan(-1);
    const next = code.indexOf('\nexport async function ', at + decl.length);
    return code.slice(at, next < 0 ? undefined : next);
  };
  const INNER = fn('async function setSippyRateEntryInner(');
  const WORKBOOK = fn('export async function uploadRatesWorkbook(');

  it("BOTH pollers wait long enough to see DONE — the import took 43 s and the loops gave up at ~36 s", () => {
    for (const [name, body] of [['setSippyRateEntryInner', INNER], ['uploadRatesWorkbook', WORKBOOK]] as const) {
      const m = body.match(/for \(let poll = 1; poll <= (\d+); poll\+\+\)/);
      expect(m, `${name} must have a poll loop`).not.toBeNull();
      expect(Number(m![1]), name).toBeGreaterThanOrEqual(60);   // 60 x 2 s sleeps ≈ 2 min
    }
  });

  it("keeps what Sippy said — the report URL and when it settled reach the trace", () => {
    expect(code).toContain("lastStatus = sm;");
    expect(code).toMatch(/note\(`upload status settled at \$\{finalStatus\}`[\s\S]{0,200}status_changed_on[\s\S]{0,200}report=\$\{lastStatus\['url'\]\}/);
  });

  it("on FAIL, reads the tariff back and reports an unchanged tariff as a retryable MISMATCH", () => {
    const at = INNER.indexOf("if (finalStatus === 'FAIL') {");
    const done = INNER.indexOf("if (finalStatus === 'DONE') {", at);
    expect(at).toBeGreaterThan(-1);
    expect(done).toBeGreaterThan(at);
    const branch = INNER.slice(at, done);
    expect(branch).toContain("await verifySippyRate(username, password, tariffId, entry.prefix, entry.rate, base, { effectiveFrom: normaliseEntryDate(entry.effectiveFrom) })");
    expect(branch).toContain("verificationResult: 'mismatch'");
    // And it RETURNS — a refused import never continues into the XML-RPC guesses or the fallback.
    expect(branch).toMatch(/return \{[\s\S]*success: false[\s\S]*verificationResult: 'mismatch'/);
    expect(branch).not.toContain('lastErrors.push');
  });
});

describe("the importer's report is readable from the platform", () => {
  const SIPPY = readFileSync(join(__dirname, '..', '..', 'sippy.ts'), 'utf8').split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const ROUTES = readFileSync(join(__dirname, '..', '..', 'routes.ts'), 'utf8').split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

  it("fetchUploadReport is READ-ONLY: a GET with the provisioning session, token pinned to a UUID", () => {
    const at = SIPPY.indexOf('export async function fetchUploadReport(');
    const end = SIPPY.indexOf('\nexport ', at + 10);
    const fn = SIPPY.slice(at, end);
    // rawGetBinary, not rawRequest: the report is an XLSX and string concatenation mangles it.
    // It is still a GET and nothing else — asserted on the primitive itself, below.
    expect(fn).toContain('await rawGetBinary(url, cookies)');
    expect(fn).toContain('await provisioningLogin(base)');
    expect(fn).toMatch(/\^\[0-9a-f\]\{8\}-/);                  // UUID gate
    // Nothing that writes: no POST, no upload-token issuance, no file upload, no rate mutation.
    for (const forbidden of ["'POST'", 'getUploadToken', 'uploadFile', 'setRate', 'deleteAll', 'pushRate']) expect(fn, forbidden).not.toContain(forbidden);
  });

  it("rawGetBinary is a GET and cannot become anything else", () => {
    const at = SIPPY.indexOf('export function rawGetBinary(');
    const end = SIPPY.indexOf('\nexport ', at + 10);
    const fn = SIPPY.slice(at, end);
    expect(at).toBeGreaterThan(-1);
    expect(fn).toContain("method:   'GET'");
    for (const forbidden of ["'POST'", "'PUT'", "'DELETE'"]) expect(fn, forbidden).not.toContain(forbidden);
  });

  it("an unreadable report is never reported as an EMPTY one", () => {
    // The distinction the reader exists to preserve: "the importer wrote nothing" is evidence
    // about the import; "I could not parse this" is evidence about the reader. Collapsing them
    // would manufacture a reason nobody read.
    const at = SIPPY.indexOf('export async function interpretUploadReport(');
    const end = SIPPY.indexOf('\nexport ', at + 10);
    const fn = SIPPY.slice(at, end);
    expect(at).toBeGreaterThan(-1);
    expect(fn).toContain('could not be parsed');
    expect(fn).toMatch(/catch[\s\S]*ok: false/);
  });

  it("an EMPTY report is named as such — it is evidence, not an error", () => {
    expect(SIPPY).toMatch(/report is EMPTY/);
  });

  it("the route is gated and only GETs", () => {
    const at = ROUTES.indexOf("app.get('/api/sippy/upload/report'");
    expect(at).toBeGreaterThan(-1);
    const route = ROUTES.slice(at, at + 900);
    expect(route).toContain("requireRole(['admin', 'management'], req, res, next)");
    expect(route).toContain('sippy.fetchUploadReport(base, token)');
  });
});

describe("a tariff's lock state is readable before anyone writes to it", () => {
  const SIPPY = readFileSync(join(__dirname, '..', '..', 'sippy.ts'), 'utf8').split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const ROUTES = readFileSync(join(__dirname, '..', '..', 'routes.ts'), 'utf8').split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

  it("readTariffLockState only reads the rates page and the banner", () => {
    const at = SIPPY.indexOf('export async function readTariffLockState(');
    const end = SIPPY.indexOf('\nexport ', at + 10);
    const fn = SIPPY.slice(at, end);
    expect(fn).toContain('await findRatesCapableSession(base, iTariff, adminCreds)');
    expect(fn).toContain('tariffLockedMessage(session.ratesBody)');
    for (const forbidden of ["'POST'", 'getUploadToken', 'uploadFile', 'setRate', 'deleteAll', 'pushRate', 'action=']) expect(fn, forbidden).not.toContain(forbidden);
    // Not established is null, never false: "we could not look" is not "not locked".
    expect(fn).toContain('locked: null');
  });

  it("the route is gated, integer-checked, and only GETs", () => {
    const at = ROUTES.indexOf("app.get('/api/sippy/tariffs/:id/lock-state'");
    expect(at).toBeGreaterThan(-1);
    const route = ROUTES.slice(at, at + 1200);
    expect(route).toContain("requireRole(['admin', 'management'], req, res, next)");
    expect(route).toContain("if (!Number.isInteger(iTariff)) return res.status(400)");
    expect(route).toContain('sippy.readTariffLockState(');
  });
});
