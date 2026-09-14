/**
 * THE CONSUMER CONTRACT — stored configuration to engine inputs, and whether the result can decide.
 *
 * DATABASE-BACKED: migration 519 off disk, real `configuration_values` rows including the 14-vs-15
 * disagreement this work deliberately did not normalise.
 *
 * The case this file exists for was found by testing rather than by reading: a client who declares
 * REJECT DESTINATION against a threshold that is absent would have every decrease PROCEED, because
 * the rule never fires. A −98% cut sails through a declared refusal. That is the same
 * "absence is permission" failure the policy table was built to prevent, one dimension over.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolvePolicyForPush } from "./policy-resolution";
import { validateRateChanges, type RateChange } from "./rate-validation";

let client: PGlite;
let db: ReturnType<typeof drizzle>;
const ACME = 1;
const REQ = { clientId: ACME, clientName: 'ACME Telecom', department: 'Wholesale',
              asOf: '2026-09-14', thresholdCategory: 'vendor' };

const migration = (f: string) =>
  readFileSync(join(__dirname, '..', '..', '..', 'migrations', f), 'utf8');

const put = (ruleKey: string, action: string | null) => db.execute(sql`
  INSERT INTO rate_policy_rules (client_id, department, rule_key, selected_action, effective_from, created_by)
  VALUES (${ACME}, 'Wholesale', ${ruleKey}, ${action}, '2026-01-01'::date, 'junaid')`);

const decrease = (pct: number): RateChange => ({
  key: 'k', destinationId: 3, destinationName: 'AFGHANISTAN - MOBILE AWCC', country: 'AFGHANISTAN',
  priorRate: 0.05, newRate: 0.05 * (1 - pct / 100), priorRateSource: 'product_rates',
  effectiveDate: '2026-09-14', today: '2026-09-14',
});

beforeEach(async () => {
  client = await PGlite.create();
  db = drizzle(client);
  await client.exec(`
    CREATE TABLE companies (id SERIAL PRIMARY KEY, name VARCHAR(256) NOT NULL UNIQUE, short_code VARCHAR(32) NOT NULL UNIQUE);
    CREATE TABLE configuration_values (
      id SERIAL PRIMARY KEY, category VARCHAR(32) NOT NULL, config_key VARCHAR(128) NOT NULL,
      label VARCHAR(256) NOT NULL, value TEXT, is_active BOOLEAN NOT NULL DEFAULT TRUE);
    INSERT INTO companies (id, name, short_code) VALUES (1, 'ACME Telecom', 'ACME');
    INSERT INTO configuration_values (category, config_key, label, value) VALUES
      ('vendor','rate_decrease_alert','Rate Decrease Alert','50.0'),
      ('vendor','rate_increase_alert','Rate Increase Alert','50.0'),
      ('vendor','increase_notice_period','Increase Notice','7'),
      ('vendor','future_effective_date','Future Effective Date','14'),
      ('vendor','old_effective_date','Old Effective Date','7'),
      ('vendor','acceptable_pending_increase','Acceptable Pending','3'),
      ('client','future_effective_date','Future Effective Date','15');
  `);
  await client.exec(migration('519_rate_policy_rules.sql'));
});
afterEach(async () => { await client?.close(); });

describe("A DECLARED CONSEQUENCE WITH NO THRESHOLD IS NOT PERMISSION", () => {
  beforeEach(async () => {
    await db.execute(sql`DELETE FROM configuration_values WHERE config_key = 'rate_decrease_alert'`);
    await put('suspect_rate_decrease', 'REJECT_DESTINATION');
  });

  it("is reported BEFORE a push, as a configuration problem with a name", async () => {
    const r = await resolvePolicyForPush(db as any, REQ);
    expect(r.unmeasurableRules).toEqual([{
      rule: 'suspect_rate_decrease',
      configuredAction: 'REJECT_DESTINATION',
      missingThreshold: 'rateDecreaseAlertPct',
    }]);
    expect(r.usable).toBe(false);
    expect(r.summary).toMatch(/Declared but not enforceable/);
  });

  it("and a −98% decrease comes back UNDECIDED, not proceeding", async () => {
    // The hole, closed. Before this, the rule simply never fired and the cut proceeded.
    const r = await resolvePolicyForPush(db as any, REQ);
    const v = validateRateChanges([decrease(98)], r.policy.thresholds, r.policy.config);
    expect(v.rows[0].disposition).toBe('undecided');
    expect(v.proceeding).toEqual([]);
    expect(v.rows[0].reason).toMatch(/threshold \(rateDecreaseAlertPct\) is not configured/);
  });

  it("a missing threshold for a rule NOBODY configured is noted, not raised", async () => {
    // An unconfigured rule was never going to act on it, so it is not a configuration problem.
    await db.execute(sql`DELETE FROM rate_policy_rules`);
    await db.execute(sql`DELETE FROM configuration_values WHERE config_key = 'acceptable_pending_increase'`);
    const r = await resolvePolicyForPush(db as any, REQ);
    expect(r.unmeasurableRules).toEqual([]);
    expect(r.missingThresholds).toContain('acceptable_pending_increase');
    expect(r.summary).toMatch(/unused by this policy/);
  });

  it("the missing threshold is irrelevant to a change that could not breach it", async () => {
    // A missing DECREASE threshold says nothing about an increase. Reporting it per-row would
    // bury the real findings.
    const r = await resolvePolicyForPush(db as any, REQ);
    // Nine days out: INSIDE both date bounds. Today breaches the 7-day increase notice and 16 days
    // breaches the 14-day future limit — and this client configures neither rule, so either would
    // come back undecided for a reason unrelated to the missing decrease threshold.
    const increase: RateChange = { ...decrease(0), newRate: 0.055, effectiveDate: '2026-09-23' };
    const v = validateRateChanges([increase], r.policy.thresholds, r.policy.config);
    expect(v.rows[0].disposition).toBe('proceed');
    expect(v.rows[0].assessment.findings).toEqual([]);
  });
});

describe("what the resolution reports", () => {
  it("no policy at all: safe, and said plainly", async () => {
    const r = await resolvePolicyForPush(db as any, REQ);
    expect(r.noPolicy).toBe(true);
    expect(r.policy.config).toBeNull();
    expect(r.usable).toBe(false);
    expect(r.summary).toMatch(/no declared rate-change policy, so any violation will be undecided rather than permitted/);
  });

  it("a declared and measurable rule is usable", async () => {
    await put('suspect_rate_decrease', 'REJECT_DESTINATION');
    const r = await resolvePolicyForPush(db as any, REQ);
    expect(r.usable).toBe(true);
    expect(r.unmeasurableRules).toEqual([]);
    const v = validateRateChanges([decrease(60)], r.policy.thresholds, r.policy.config);
    expect(v.rows[0].disposition).toBe('dropped_destination');
  });

  it("a NULL action is reported as considered-not-decided and does not make the policy usable", async () => {
    await put('suspect_rate_decrease', null);
    const r = await resolvePolicyForPush(db as any, REQ);
    expect(r.undeclaredActions).toEqual(['suspect_rate_decrease']);
    expect(r.usable).toBe(false);
    expect(r.summary).toMatch(/Considered but not decided/);
  });

  it("`today` is the asOf date, so a replay decides as of then", async () => {
    const r = await resolvePolicyForPush(db as any, { ...REQ, asOf: '2026-03-01' });
    expect(r.policy.today).toBe('2026-03-01');
  });

  it("resolves the shape runRateBatch takes, and nothing more", async () => {
    await put('suspect_rate_decrease', 'REJECT_DESTINATION');
    const r = await resolvePolicyForPush(db as any, REQ);
    expect(Object.keys(r.policy).sort()).toEqual(['config', 'thresholds', 'today']);
  });
});

describe("it does not choose, default, or enable", () => {
  it("the threshold CATEGORY is the caller's — the disagreement survives", async () => {
    const v = await resolvePolicyForPush(db as any, { ...REQ, thresholdCategory: 'vendor' });
    const c = await resolvePolicyForPush(db as any, { ...REQ, thresholdCategory: 'client' });
    expect(v.policy.thresholds.futureEffectiveDateDays).toBe(14);
    expect(c.policy.thresholds.futureEffectiveDateDays).toBe(15);
  });

  it("an unknown category does not fall back to a populated one", async () => {
    const r = await resolvePolicyForPush(db as any, { ...REQ, thresholdCategory: 'nonexistent' });
    expect(r.policy.thresholds).toEqual({});
    expect(r.usable).toBe(false);
  });

  it("there is no house default policy to fall back to", () => {
    const code = readFileSync(join(__dirname, 'policy-resolution.ts'), 'utf8')
      .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    expect(code).not.toMatch(/DEFAULT_(POLICY|CONFIG|RULES)/);
    expect(code).not.toMatch(/\?\?\s*\{\s*outcomes/);
    expect(code).not.toMatch(/'IGNORE'/);
  });

  it("RESOLVING IS NOT ENABLING — it cannot push, write, or turn enforcement on", () => {
    const code = readFileSync(join(__dirname, 'policy-resolution.ts'), 'utf8')
      .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    for (const forbidden of ['runRateBatch', 'pushRate', 'uploadRates', 'INSERT', 'UPDATE ', 'DELETE ']) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it("NO PRODUCTION CALLER — enforcement stays behind the wiring gate", () => {
    // `deps.policy` is optional on runRateBatch and nothing in the route layer supplies it. This
    // is the gate: the layer exists, is tested, and is off.
    const routes = [
      readFileSync(join(__dirname, '..', '..', 'routes.ts'), 'utf8'),
      readFileSync(join(__dirname, '..', '..', 'routes-rate-manager.ts'), 'utf8'),
    ].join('\n');
    expect(routes).not.toContain('resolvePolicyForPush');
    expect(routes).not.toContain('policy-resolution');
    // `policy: {` alone is too loose — routes.ts carries an unrelated notification-routing
    // variable by that name. What must be absent is a policy passed to the batch runner.
    expect(routes).not.toMatch(/runRateBatch\([^)]*policy/s);
  });
});
