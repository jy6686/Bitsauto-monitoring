/**
 * The change policy, WIRED into the production push route — asserted against the route source.
 *
 * The runner and adapter are covered behaviourally (policy-adapter.test.ts, end to end against
 * Postgres and a counting push). What is guarded here is the route's contract with them, and in
 * particular the four things that decide whether enabling the layer is safe:
 *
 *   - it ships OFF, behind an audited platform_feature_flags row, and a flag read that fails
 *     leaves behaviour UNCHANGED rather than refusing everything;
 *   - thresholds come from the CLIENT category — settled 2026-09-14 from the old system's
 *     Configuration Values, where vendor and client deliberately differ (14 vs 15 days);
 *   - the comparison base is read from the client's own Sippy tariff, once per tariff, and a
 *     prefix absent from a PARTIAL read is 'unknown', never 'none';
 *   - the client scope comes from the company row and is never guessed from an account name.
 *
 * Every claim is anchored to code text, comments stripped, bounded at the route's own end.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(join(__dirname, '..', '..', 'routes.ts'), 'utf8');
const code = (t: string) => t.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

/** The push-batch handler only, bounded at the next route registration. */
const ROUTE = (() => {
  const start = SRC.indexOf("app.post('/api/rate-manager/push-batch'");
  expect(start, 'push-batch must exist').toBeGreaterThan(-1);
  const end = SRC.indexOf("app.post('/api/rate-manager/change-client-rates'", start);
  expect(end, 'push-batch must be followed by change-client-rates').toBeGreaterThan(start);
  return code(SRC.slice(start, end));
})();

describe("it ships OFF, and fails to unchanged behaviour", () => {
  it("is gated by an audited feature flag with a named key", () => {
    expect(ROUTE).toContain("eq(platformFeatureFlags.key, 'rate_policy_enforcement')");
    expect(ROUTE).toContain('let policyEnforced = false;');
  });

  it("a flag read that FAILS leaves the layer off — never on", () => {
    // A new refusal layer that switched itself on by accident would stop every push. The
    // failure mode of reading the switch is therefore "as before", explicitly.
    const at = ROUTE.indexOf("'rate_policy_enforcement'");
    const window = ROUTE.slice(at, at + 400);
    expect(window).toMatch(/catch\s*\{[\s\S]*?policyEnforced = false/);
  });

  it("the policy is only built, and only passed, when enforced", () => {
    expect(ROUTE).toContain('if (policyEnforced) {');
    expect(ROUTE.indexOf('policy = perClientPolicy(')).toBeGreaterThan(ROUTE.indexOf('if (policyEnforced) {'));
    // Passed by reference: undefined when off, so runRateBatch sees no policy at all.
    expect(ROUTE).toContain('{ db, push, lock: createPostgresTariffLock(pool), policy }');
  });
});

describe("the CLIENT category, settled from the old system", () => {
  it("names the client category literally — not vendor, not a variable somebody can default", () => {
    expect(ROUTE).toContain("thresholdCategory: 'client'");
    expect(ROUTE).not.toContain("thresholdCategory: 'vendor'");
  });
});

describe("the comparison base is the client's own tariff, read once per tariff", () => {
  it("reads Sippy's tariff rates for each DISTINCT target tariff", () => {
    expect(ROUTE).toContain('sippy.getTariffRatesListFull(username, password, Number(t), 0, 1000, undefined, portalUrl)');
    expect(ROUTE).toContain('if (!t || priorByTariff.has(t)) continue;');
  });

  it("a prefix found on the tariff is sourced as sippy_tariff", () => {
    expect(ROUTE).toContain("op.priorRateSource = 'sippy_tariff'");
  });

  it("a prefix absent from a PARTIAL read is UNKNOWN, never none", () => {
    // "We could not see" and "there is no prior rate" are different facts, and the engine
    // treats an unknown base as no_comparison_base rather than as a first rate.
    expect(ROUTE).toContain("partial: (list as any[]).length >= 1000");
    expect(ROUTE).toMatch(/if \(!read \|\| read\.partial\) \{ op\.priorRate = null;\s*op\.priorRateSource = 'unknown'; \}/);
    // A failed read is also partial, not empty.
    expect(ROUTE).toContain("priorByTariff.set(t, { rates: new Map(), partial: true });");
  });

  it("only a COMPLETE read may say there is no prior rate", () => {
    expect(ROUTE).toMatch(/else\s*\{ op\.priorRate = null;\s*op\.priorRateSource = 'none'; \}/);
  });

  it("the read is a read — nothing on this path can write to Sippy", () => {
    const at = ROUTE.indexOf('if (policyEnforced) {');
    const end = ROUTE.indexOf('const runOutcome = await runRateBatch(', at);
    const block = ROUTE.slice(at, end);
    for (const forbidden of ['pushRate', 'uploadRates', 'Upload', 'setRate', 'addRate', 'deleteAllRates']) {
      expect(block, forbidden).not.toContain(forbidden);
    }
  });
});

describe("the client scope comes from the company row, never from a guess", () => {
  it("captures id, name and department from getCompanyBySippyAccount", () => {
    expect(ROUTE).toContain('companyByAccountName.set(acc.username, {');
    expect(ROUTE).toContain("department: (company as any).department ?? null,");
  });

  it("puts them on every operation, and null stays null", () => {
    for (const f of ['clientId', 'clientName', 'department']) {
      expect(ROUTE).toMatch(new RegExp(`${f}:\\s+companyByAccountName\\.get\\(accountName\\)\\?\\.[a-zA-Z]+ \\?\\? null,`));
    }
  });

  it("does not derive a department from companyType or an account name", () => {
    expect(ROUTE).not.toMatch(/department:\s*[^,]*companyType/);
    expect(ROUTE).not.toMatch(/department:\s*[^,]*accountName\b(?!\))/);
  });
});

describe("it never consults validation_rules and reports what it resolved", () => {
  it("no fallback to the legacy singleton stack", () => {
    expect(ROUTE).not.toMatch(/validation_rules|validationRules/);
  });

  it("surfaces each client's resolution in the response, so unmeasurable rules are seen before they refuse", () => {
    expect(ROUTE).toContain('onResolved: (scope, r) => {');
    expect(ROUTE).toContain('policy: { enforced: policyEnforced, resolutions: policyResolutions }');
  });
});
