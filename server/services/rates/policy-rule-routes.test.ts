/**
 * The policy-rule endpoints' contract, asserted against the route source.
 * Behaviour is covered by policy-config-store.test.ts against real Postgres; what is guarded here
 * is what the endpoints promise: attribution, no defaulted action, no validation_rules, no
 * enforcement side effect.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const SRC = readFileSync(join(__dirname, '..', '..', 'routes-rate-policy.ts'), 'utf8');
const ROUTES = readFileSync(join(__dirname, '..', '..', 'routes.ts'), 'utf8');
const code = (t: string) => t.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const CODE = code(SRC);

describe("registered, gated, attributed", () => {
  it("is wired into the app", () => {
    expect(ROUTES).toContain("import { registerRatePolicyRoutes } from './routes-rate-policy';");
    expect(ROUTES).toContain('registerRatePolicyRoutes(app);');
  });
  it("write requires a write role and an actor", () => {
    expect(CODE).toContain("app.post('/api/rate-policy/rules'");
    expect(CODE).toContain('requireRole(WRITE, req, res, next)');
    expect(CODE).toContain("if (!actor) return res.status(401).json({ error: 'A policy must be attributable to a person.' });");
    expect(CODE).toContain("action: 'RATE_POLICY_DECLARED'");
  });
});

describe("it defaults nothing and consults nothing it should not", () => {
  it("selectedAction must be PRESENT — null is allowed, absence is a 400", () => {
    expect(CODE).toContain("if (!('selectedAction' in b)) return res.status(400)");
    expect(CODE).not.toMatch(/selectedAction\s*\?\?\s*'IGNORE'/);
  });
  it("never reads validation_rules", () => {
    expect(CODE).not.toMatch(/validation_rules|validationRules/);
  });
  it("cannot enable enforcement or touch Sippy", () => {
    for (const f of ['platform_feature_flags', 'platformFeatureFlags', 'sippy', 'pushRate', 'runRateBatch']) {
      expect(CODE, f).not.toContain(f);
    }
  });
  it("the read resolves with the CLIENT category, same as the push route", () => {
    expect(CODE).toContain("thresholdCategory: 'client'");
  });
});
