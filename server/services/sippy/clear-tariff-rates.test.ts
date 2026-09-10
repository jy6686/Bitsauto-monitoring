/**
 * SMP-002 — clearTariffRates' verdict semantics, and SMP-001's use of them.
 *
 * The hazard on this path is the REPORT, not the retry. deleteAllRatesInTariff is idempotent at
 * the Sippy operation level, so re-issuing it is harmless; telling an operator "this failed"
 * when the tariff has actually been emptied is not, because every decision they make next is
 * reasoned from a tariff state that no longer exists.
 *
 * The verdict must therefore come from WHERE the failure happened relative to the request, and
 * never from what the error says. These tests drive a faked sippy module so a throw can be
 * placed on either side of the boundary deliberately.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Where the fake should throw, relative to the mutating request. */
let throwBefore: Error | null = null;   // e.g. no session — nothing sent
let throwAfter:  Error | null = null;   // e.g. timeout / fault — request sent

vi.mock("../../sippy", () => ({
  deleteAllRatesInTariff: async (_u: string, _p: string, _t: number, _c: any, boundary: any) => {
    // Faithful to the real function: the session check precedes the request, and
    // assertSippyOk throws after it.
    if (throwBefore) throw throwBefore;
    if (boundary) boundary.crossed = true;
    if (throwAfter) throw throwAfter;
  },
}));
vi.mock("./sippy-audit.service", () => ({ auditLog: async () => {} }));

const { clearTariffRates } = await import("./sippy-tariff.service");
const config = { username: 'u', password: 'p', portalUrl: 'https://sippy.example' } as any;

beforeEach(() => { throwBefore = null; throwAfter = null; });

describe("the verdict comes from the boundary, not the message", () => {
  it("a clean run is success and reports the request was sent", async () => {
    const r = await clearTariffRates(config, 33);
    expect(r).toMatchObject({ ok: true, verdict: 'success', refusedBeforeWrite: false });
  });

  it("a failure BEFORE the request is `failure` — nothing was sent", async () => {
    throwBefore = new Error('No active Sippy session');
    const r = await clearTariffRates(config, 33);
    expect(r.verdict).toBe('failure');
    expect(r.refusedBeforeWrite).toBe(true);
    expect(r.ok).toBe(false);
  });

  it("a failure AFTER the request is `indeterminate` — it may already be empty", async () => {
    throwAfter = new Error('socket hang up');
    const r = await clearTariffRates(config, 33);
    expect(r.verdict).toBe('indeterminate');
    expect(r.refusedBeforeWrite).toBe(false);
  });

  it("a Sippy FAULT is indeterminate too, because the request still left the process", async () => {
    // A fault is Sippy describing a failure. It is not evidence that nothing was applied.
    throwAfter = new Error('faultString: Fatal error');
    expect((await clearTariffRates(config, 33)).verdict).toBe('indeterminate');
  });

  it("two failures with the SAME message get different verdicts by position alone", async () => {
    // The proof that nothing is being inferred from the text.
    const msg = 'connection reset';
    throwBefore = new Error(msg);
    const before = await clearTariffRates(config, 33);
    throwBefore = null; throwAfter = new Error(msg);
    const after = await clearTariffRates(config, 33);
    expect(before.verdict).toBe('failure');
    expect(after.verdict).toBe('indeterminate');
  });

  it("an indeterminate result says the tariff state is unknown", async () => {
    throwAfter = new Error('socket hang up');
    const r = await clearTariffRates(config, 33);
    expect(r.error).toContain('WAS sent');
    expect(r.error).toMatch(/unknown/i);
    expect(r.error).toMatch(/read it back/i);
  });

  it("a plain failure does NOT claim the state is unknown — it is known to be untouched", async () => {
    throwBefore = new Error('No active Sippy session');
    expect((await clearTariffRates(config, 33)).error).not.toMatch(/unknown/i);
  });
});

describe("SMP-001 — the restore is gated on a CONFIRMED clear", () => {
  const SRC = readFileSync(join(__dirname, '..', '..', 'routes.ts'), 'utf8');
  /** The restore handler's own text. */
  const HANDLER = (() => {
    const a = SRC.indexOf("const { clearTariffRates, bulkPushRates }");
    return SRC.slice(a, SRC.indexOf('\n  app.', a));
  })();
  const code = HANDLER.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

  it("the clear's result is captured, not discarded", () => {
    // It used to be a bare `await clearTariffRates(...)`, and the function swallows its own
    // errors, so a failure had no way to reach the caller at all.
    expect(code).toContain('const clearResult = await clearTariffRates(');
    expect(code).not.toMatch(/^\s*await clearTariffRates\(/m);
  });

  it("the tariff is READ BACK after the clear, before anything is pushed", () => {
    const readBack = code.indexOf('const afterClear = await getTariffRatesList(');
    const push     = code.indexOf('await bulkPushRates(');
    expect(readBack).toBeGreaterThan(-1);
    expect(push).toBeGreaterThan(-1);
    // Order is the property: verifying afterwards would be too late to withhold the push.
    expect(readBack).toBeLessThan(push);
  });

  it("a tariff that still holds rates aborts the restore", () => {
    expect(code).toContain('if (afterClear.length > 0)');
    expect(code).toContain('restored:           false');
    expect(code).toContain('versionRecorded:    false');
  });

  it("the abort reports the verdict and the structural boundary answer", () => {
    expect(code).toContain('clearVerdict:       clearResult.verdict');
    expect(code).toContain('refusedBeforeWrite: clearResult.refusedBeforeWrite');
  });

  it("a `failure` abort says nothing was sent, so a retry is safe", () => {
    expect(HANDLER).toContain('No rate data was sent to Sippy');
  });

  it("read-back is unconditional — Sippy's own success is not proof of state", () => {
    // The read-back must not sit inside an `if (clearResult.ok)`, or a `success` that did not
    // actually empty the tariff would sail through.
    const guardBeforeReadBack = code.slice(
      code.indexOf('const clearResult'), code.indexOf('const afterClear'));
    expect(guardBeforeReadBack).not.toMatch(/if\s*\(/);
  });

  it("the post-push check requires the snapshot's exact count, not merely non-zero", () => {
    // `liveAfter.length === 0` only caught a totally failed push; a partial one wrote a
    // version record asserting the snapshot was live.
    expect(code).toContain('verifiedLiveCount !== snapshotRates.length');
    expect(code).not.toContain('verifiedLiveCount === 0 && snapshotRates.length > 0');
  });

  it("an emptied tariff is reported as emptied, not as '0 rates found'", () => {
    // The fact that matters first: the previous rates are gone and traffic is unpriced.
    expect(HANDLER).toContain('the tariff is now EMPTY');
    expect(HANDLER).toContain('traffic on it is unpriced');
    expect(code).toContain('previousRatesCleared: true');
  });

  it("no version record is written on any abort path", () => {
    const abortReturns = code.slice(0, code.indexOf('createTariffVersion'));
    expect(abortReturns).toContain('versionRecorded: false');
    expect(abortReturns).toContain('versionRecorded:    false');
  });
});
