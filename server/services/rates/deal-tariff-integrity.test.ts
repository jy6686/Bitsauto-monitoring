/**
 * Deal approval may not write to a tariff it has not confirmed.
 *
 * `12ae5a4e` made push-batch refuse a push whose target tariff cannot be confirmed — the
 * provisioned `company.sippyITariff` must equal the tariff Sippy actually bills the account on.
 * increment-apply consumes the same guard. `POST /api/deals/:id/approve` did not: it read
 * `clientCompany.sippyITariff` and pushed straight to it, never resolving the live tariff.
 *
 * THE RISK INVERTS BETWEEN THE TWO PATHS. On push-batch a divergence is a loud 409 — which is
 * why 4 of 26 accounts can push and 22 are refused. On deal approval the same divergence wrote
 * to the stored tariff anyway, and because the account does not bill on it the rate LOOKS
 * applied and never takes effect. A silent commercial no-op is the more dangerous direction,
 * and it was the unguarded one.
 *
 * This file pins the composition, not a new rule: the route consumes `checkTariffIntegrity`,
 * whose four verdicts are already proven in ./tariff-integrity.test.ts. Restating those
 * thresholds here would create a second copy to drift.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkTariffIntegrity } from "./tariff-integrity";

/**
 * Mirrors the route's decision: resolve the live tariff, compare it to the provisioned one,
 * and push only on `safe`. `resolvedITariff` is null when Sippy could not be reached.
 */
function dealWouldPush(
  storedITariff: number | null | undefined,
  resolvedITariff: number | string | null,
): { push: boolean; reason?: string; message?: string } {
  const v = checkTariffIntegrity({ accountName: 'aura', storedITariff, resolvedITariff });
  return v.safe ? { push: true } : { push: false, reason: v.reason, message: v.message };
}

describe("the four integrity outcomes, as deal approval sees them", () => {
  it("stored === live: the push proceeds to the existing write path", () => {
    expect(dealWouldPush(66, 66)).toEqual({ push: true });
    // Sippy answers strings on some calls; the guard normalises, so this must not refuse.
    expect(dealWouldPush(66, '66')).toEqual({ push: true });
  });

  it("mismatch: refuses, and names both tariffs so the operator can act", () => {
    const d = dealWouldPush(61, 2);
    expect(d.push).toBe(false);
    expect(d.reason).toBe('mismatch');
    // The guard's own words, verbatim — not a paraphrase maintained in two places.
    expect(d.message).toContain('provisioned tariff is 61 but Sippy bills this account on 2');
  });

  /**
   * The live divergent fixture: Test-3071 stores 61, Sippy bills it on 2. Before this guard,
   * deal approval wrote every deal rate into 61 — a tariff account 1064 does not bill on.
   */
  it("refuses the Test-3071 case that used to be written silently", () => {
    expect(dealWouldPush(61, 2).push).toBe(false);
  });

  /**
   * FAILS CLOSED. An unreachable Sippy leaves the target unproven, and "we could not check"
   * must not read as "safe". This is the deliberate behaviour change: today's code pushed to
   * the stored value during an outage.
   */
  it("unresolved: refuses rather than falling back to the stored tariff", () => {
    const d = dealWouldPush(66, null);
    expect(d.push).toBe(false);
    expect(d.reason).toBe('unresolved');
    expect(d.message).toContain('could not resolve which Sippy tariff this account bills on');
  });

  it("no stored tariff: refuses — there is nothing to verify against", () => {
    const d = dealWouldPush(null, 2);
    expect(d.push).toBe(false);
    expect(d.reason).toBe('no_stored_tariff');
  });
});

const SRC = readFileSync(join(__dirname, '..', '..', 'routes.ts'), 'utf8');
const CODE = SRC.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

/** The deal-approval route only — other routes legitimately resolve tariffs their own way. */
const APPROVE = (() => {
  const at = CODE.indexOf("app.post('/api/deals/:id/approve'");
  expect(at, 'the deal-approve route must exist').toBeGreaterThan(-1);
  const end = CODE.indexOf("app.post('/api/deals/:id/reject'", at);
  expect(end).toBeGreaterThan(at);
  return CODE.slice(at, end);
})();

describe("the route consumes the guard rather than restating it", () => {
  it("calls checkTariffIntegrity", () => {
    expect(APPROVE).toContain('checkTariffIntegrity({');
  });

  /**
   * No second implementation. A hand-rolled `stored !== resolved` here would diverge from
   * push-batch the first time the guard's rules changed.
   */
  it("does not hand-roll the comparison", () => {
    expect(APPROVE).not.toMatch(/sippyITariff\s*[!=]==?\s*resolved/);
    expect(APPROVE).not.toMatch(/resolved\w*\s*[!=]==?\s*tariffId/);
  });

  /**
   * ORDERING IS THE CONTRACT, and it is proven by position rather than by structure — the same
   * proof used for push-batch. A guard that runs after the first write is not a guard.
   */
  it("refuses BEFORE the first setSippyRateEntry", () => {
    const check = APPROVE.indexOf('checkTariffIntegrity({');
    const guard = APPROVE.indexOf('.safe');
    const write = APPROVE.indexOf('setSippyRateEntry');
    expect(check).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(-1);
    expect(check).toBeLessThan(write);
    expect(guard).toBeLessThan(write);
  });

  /**
   * THE CONDITION ITSELF, VERBATIM. Position and presence are not enough: calling the guard and
   * then ignoring its answer — `if (false && !tariffVerdict.safe)` — satisfies every rule above
   * while pushing to an unconfirmed tariff. A mutation proved exactly that gap, so the refusal
   * is anchored on its exact text.
   */
  it("acts on the verdict — the refusal is the unqualified negation", () => {
    expect(APPROVE).toContain('if (!tariffVerdict.safe) {');
    expect(APPROVE).not.toMatch(/if \([^)]*&&\s*!tariffVerdict\.safe/);
    expect(APPROVE).not.toMatch(/if \(!tariffVerdict\.safe\s*&&/);
  });

  /**
   * Resolved the way push-batch resolves it. If the two chains diverge, the two guards stop
   * meaning the same thing while both still reporting "integrity checked".
   */
  it("resolves the live tariff via getAccountInfo, with the billing-plan fallback", () => {
    expect(APPROVE).toContain('getAccountInfo(');
    expect(APPROVE).toContain('iBillingPlan');
    expect(APPROVE).toContain('listSippyBillingPlans(');
  });
});

describe("what the refusal does NOT change", () => {
  /**
   * The deal is still approved; only the push is skipped. Failing the whole approval would be
   * new semantics, and the trunk-prefix refusal above it already established this shape.
   */
  it("skips the push without failing the approval", () => {
    expect(APPROVE).toMatch(/ratePushResult = \{ pushed: 0, failed: 0, skipped: tariffVerdict\.message \}/);
    expect(APPROVE).toContain('res.json({ ...deal, ratePushResult })');
  });

  it("leaves the NULL case with its own existing message", () => {
    expect(APPROVE).toContain('No tariff linked to client (provision first)');
  });

  /** The two pre-existing guards on this path are untouched. */
  it("keeps the product-trunk and dial-prefix refusals", () => {
    expect(APPROVE).toContain('has no usable trunk prefix');
    expect(APPROVE).toContain('resolveDealDialPrefix(');
  });
});
