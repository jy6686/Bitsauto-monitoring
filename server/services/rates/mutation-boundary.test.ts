/**
 * The mutation-boundary contract on the push primitive.
 *
 *   refusedBeforeWrite === true   no mutating request was issued; the tariff is untouched
 *   refusedBeforeWrite === false  one was issued, whatever happened afterwards
 *   absent                        nobody established it — never to be read as false
 *
 * Two of these run the real functions end to end (the not-connected paths need no network). The
 * rest assert the property STRUCTURALLY, against the source, because that is what the property
 * actually is: whether execution passed a particular request. A behavioural test would have to
 * stand up a fake switch and would still only prove the paths it happened to drive, whereas the
 * risk here is a mutating call added later with no flag beside it.
 *
 * The same source-reading technique guards the upload-token call sites, and for the same reason.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setSippyRateEntry, pushRateToSippy } from "../../sippy";

const SRC = readFileSync(join(__dirname, '..', '..', 'sippy.ts'), 'utf8');
const LINES = SRC.split('\n');

/** Line numbers (1-based) whose text contains `needle`. */
const linesWith = (needle: string): number[] =>
  LINES.map((l, i) => (l.includes(needle) ? i + 1 : 0)).filter(Boolean);

/** True when a boundary assignment appears in the 5 lines immediately before `line`. */
const crossedJustBefore = (line: number): boolean =>
  LINES.slice(Math.max(0, line - 6), line - 1).some(l => /boundary\.crossed\s*=\s*true/.test(l));

describe("the contract, run for real", () => {
  it("a push with no switch to talk to never issued a request, and says so", async () => {
    // Reaches the first guard and returns; no socket is opened.
    const r = await setSippyRateEntry('u', 'p', '65', { prefix: '19370', rate: 0.133 });
    expect(r.success).toBe(false);
    expect(r.message).toContain('Not connected');
    expect(r.refusedBeforeWrite).toBe(true);
  });

  it("the same holds at the outer entry point the route calls", async () => {
    const r = await pushRateToSippy(
      { accountName: 'test-312', prefix: '19370', ratePerMin: 0.133 },
      { username: 'u', password: 'p' },
    );
    expect(r.success).toBe(false);
    expect(r.refusedBeforeWrite).toBe(true);
  });

  it("the flag is always present on a settled push, so absent means genuinely unestablished", async () => {
    const r = await setSippyRateEntry('u', 'p', '65', { prefix: '19370', rate: 0.133 });
    expect(Object.prototype.hasOwnProperty.call(r, 'refusedBeforeWrite')).toBe(true);
    expect(typeof r.refusedBeforeWrite).toBe('boolean');
  });
});

describe("every mutating request is flagged before it is sent", () => {
  it("the rate-file upload", () => {
    // uploadBinaryFile inside setSippyRateEntryInner: the file is on its way and may be processed.
    const sites = linesWith("await uploadBinaryFile(uploadUrl, xlsxBuffer, 'rates.xlsx')");
    expect(sites.length).toBeGreaterThan(0);
    const inPushPath = sites.filter(n => LINES.slice(n - 40, n).some(l => l.includes('[RateManager] Upload XLSX')));
    expect(inPushPath).toHaveLength(1);
    expect(crossedJustBefore(inPushPath[0])).toBe(true);
  });

  it("the XML-RPC rate-write probes", () => {
    // There are two `methodsToTry` probe loops in this file. The other one originates calls and
    // is correctly unflagged, so the rate-write loop is identified by its own log line rather
    // than by the shape of the request, which they share.
    const probes = linesWith('const resp = await sippyPost(apiUrl, body, username, password);')
      .filter(n => LINES.slice(n, n + 2).some(l => l.includes('[Sippy] setSippyRateEntry ${method}')));
    expect(probes).toHaveLength(1);
    expect(crossedJustBefore(probes[0])).toBe(true);
  });

  it("both portal action=change submissions — the GET that is itself the mutation", () => {
    const submits = [
      ...linesWith("const addResp = await rawRequest('GET',"),
      ...linesWith("const resp = await rawRequest('GET', changeUrl, null, {"),
    ];
    expect(submits).toHaveLength(2);
    for (const line of submits) {
      expect(
        LINES.slice(Math.max(0, line - 6), line - 1).some(l => /boundary\.crossed\s*=\s*true/.test(l)),
        `no boundary flag before the submit at sippy.ts:${line}`,
      ).toBe(true);
    }
  });

  it("the flag is set BEFORE each request, never after — a throw still counts as sent", () => {
    // Every assignment must be followed by a request, not preceded by one on the same statement.
    const assignments = linesWith('boundary.crossed = true');
    expect(assignments.length).toBeGreaterThanOrEqual(4);
    for (const n of assignments) {
      const next5 = LINES.slice(n, n + 5).join(' ');
      expect(
        /await (uploadBinaryFile|sippyPost|rawRequest)\(/.test(next5),
        `the flag at sippy.ts:${n} is not immediately followed by the request it guards`,
      ).toBe(true);
    }
  });
});

describe("how the answer is computed", () => {
  it("comes from the boundary object, not from any message", () => {
    expect(SRC).toContain('refusedBeforeWrite: !boundary.crossed');
  });

  it("is NEVER inferred from message or error text", () => {
    // A classification derived from wording is the bug class this exists to avoid: the message is
    // a description of a failure, not evidence about whether a request left the process.
    const suspicious = LINES
      .map((l, i) => ({ l, n: i + 1 }))
      .filter(({ l }) => /refusedBeforeWrite/.test(l))
      .filter(({ l }) => /\.(includes|match|test|indexOf|startsWith)\s*\(|message\s*[=!]==?|refused:/i.test(l));
    expect(suspicious.map(s => `sippy.ts:${s.n} ${s.l.trim()}`)).toEqual([]);
  });

  it("the wrapper stamps every return path, so none can omit it", () => {
    // The inner function has many returns; the flag is applied once, outside all of them.
    expect(SRC).toContain('const result = await setSippyRateEntryInner(');
    expect(SRC).toMatch(/return \{ \.\.\.result, refusedBeforeWrite: !boundary\.crossed/);
  });

  it("the wrapper also returns the trace, on the throwing path as well as the returning one", () => {
    // The trace is owned by the wrapper for the same reason the boundary is: so no exit can drop it.
    // A throw attaches it to the error, because a push that dies is exactly the one worth explaining.
    expect(SRC).toMatch(/return \{ \.\.\.result, refusedBeforeWrite: !boundary\.crossed, trace \}/);
    expect(SRC).toContain("trace.push(`push threw:");
    expect(SRC).toMatch(/throw Object\.assign\([\s\S]{0,80}\{ trace \}\)/);
  });

  it("one boundary object is threaded into the portal fallback, not a second one", () => {
    // Two objects would let the upload path's mutation go unrecorded when the portal path answers.
    const call = SRC.slice(SRC.indexOf('const portalResult = await pushRateViaPortalUpload('));
    expect(call.slice(0, 400)).toContain('boundary,');
  });
});

describe("a consequence of the ordering, recorded so it cannot change unnoticed", () => {
  it("the portal fallback runs AFTER the XML-RPC write probes, so its refusals report false", () => {
    // Jobs #44 and #45 were stopped by the portal add guard, which refuses to guess an i_rate.
    // Nothing was written by that guard. But the probes above it are write ATTEMPTS and cross the
    // boundary first, so under this contract those jobs still report refusedBeforeWrite: false —
    // and the executor will treat them as indeterminate and halt the tariff.
    //
    // That is the contract behaving as specified, not a defect in it. Removing the cost needs the
    // guard to run BEFORE the probes, which is a change to the push path itself and belongs to its
    // own slice. This test exists so the ordering is visible and cannot drift silently.
    const probeLine  = linesWith('const resp = await sippyPost(apiUrl, body, username, password);')
      .filter(n => LINES.slice(n, n + 2).some(l => l.includes('[Sippy] setSippyRateEntry ${method}')))[0];
    const fallback   = linesWith('const portalResult = await pushRateViaPortalUpload(')[0];
    expect(probeLine).toBeLessThan(fallback);

    // And the fallback is unconditional — there is no branch that reaches it without the probes.
    const between = LINES.slice(probeLine, fallback).join('\n');
    expect(between).toContain('all XML-RPC methods failed');
  });
});
