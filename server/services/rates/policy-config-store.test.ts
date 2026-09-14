/**
 * The per-client rate-change policy: storage, the migration, and resolution.
 *
 * DATABASE-BACKED. Migration 519 is read off disk and executed, so what is tested is the schema
 * that will be deployed rather than an approximation of it.
 *
 * The property under test throughout is the one `validation_rules` cannot express: **absence is
 * not permission**. No row, and a row with no action, both resolve to the engine's `undecided`.
 * Nothing here can turn silence into IGNORE.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  policyRulesInForce, resolvePolicyConfig, resolveThresholds, declarePolicyRule,
} from "./policy-config-store";
import { validateRateChanges, type RateChange } from "./rate-validation";

let client: PGlite;
let db: ReturnType<typeof drizzle>;
const ACME = 1, OTHER = 2;

const migration = (f: string) =>
  readFileSync(join(__dirname, '..', '..', '..', 'migrations', f), 'utf8');

const one = async (q: any) => ((await db.execute(q)) as any).rows[0];

const put = (o: {
  clientId?: number; department?: string; ruleKey?: string; action?: string | null;
  from?: string; to?: string | null; by?: string; reason?: string | null;
}) => db.execute(sql`
  INSERT INTO rate_policy_rules (client_id, department, rule_key, selected_action,
                                 effective_from, effective_to, created_by, reason)
  VALUES (${o.clientId ?? ACME}, ${o.department ?? 'Wholesale'},
          ${o.ruleKey ?? 'suspect_rate_decrease'}, ${o.action === undefined ? 'REJECT_DESTINATION' : o.action},
          ${o.from ?? '2026-01-01'}::date, ${o.to === undefined ? null : o.to},
          ${o.by ?? 'junaid'}, ${o.reason ?? null})
  RETURNING *`);

beforeEach(async () => {
  client = await PGlite.create();
  db = drizzle(client);
  await client.exec(`
    CREATE TABLE companies (
      id SERIAL PRIMARY KEY, name VARCHAR(256) NOT NULL UNIQUE,
      short_code VARCHAR(32) NOT NULL UNIQUE);
    CREATE TABLE configuration_values (
      id SERIAL PRIMARY KEY, category VARCHAR(32) NOT NULL, config_key VARCHAR(128) NOT NULL,
      label VARCHAR(256) NOT NULL, value TEXT, is_active BOOLEAN NOT NULL DEFAULT TRUE);
    INSERT INTO companies (id, name, short_code) VALUES (1, 'ACME Telecom', 'ACME'), (2, 'Other Ltd', 'OTH');
  `);
  await client.exec(migration('519_rate_policy_rules.sql'));

  // The seeded values, INCLUDING the disagreement this migration deliberately did not normalise.
  await client.exec(`
    INSERT INTO configuration_values (category, config_key, label, value) VALUES
      ('vendor', 'rate_decrease_alert',        'Rate Decrease Alert',       '50.0'),
      ('vendor', 'rate_increase_alert',        'Rate Increase Alert',       '50.0'),
      ('vendor', 'increase_notice_period',     'Increase Notice Period',    '7'),
      ('vendor', 'future_effective_date',      'Future Effective Date',     '14'),
      ('vendor', 'old_effective_date',         'Old Effective Date',        '7'),
      ('vendor', 'acceptable_pending_increase','Acceptable Pending',        '3'),
      ('client', 'rate_decrease_alert',        'Rate Decrease Alert',       '50.0'),
      ('client', 'rate_increase_alert',        'Rate Increase Alert',       '50.0'),
      ('client', 'increase_notice_period',     'Increase Notice Period',    '7'),
      ('client', 'future_effective_date',      'Future Effective Date',     '15'),
      ('client', 'old_effective_date',         'Old Effective Date',        '7'),
      ('client', 'acceptable_pending_increase','Acceptable Pending',        '3');
  `);
});
afterEach(async () => { await client?.close(); });

describe("ABSENCE IS NOT PERMISSION", () => {
  it("the table is created EMPTY — no client starts with a policy", async () => {
    expect((await one(sql`SELECT count(*)::int AS n FROM rate_policy_rules`)).n).toBe(0);
  });

  it("no rows resolves to config null, which the engine reads as undecided", async () => {
    const r = await resolvePolicyConfig(db as any, { clientId: ACME, clientName: 'ACME Telecom', department: 'Wholesale', asOf: '2026-09-14' });
    expect(r.noPolicy).toBe(true);
    expect(r.config).toBeNull();
  });

  it("a row with a NULL action is CONSIDERED, NOT DECIDED — and still not IGNORE", async () => {
    await put({ action: null, reason: 'Awaiting the commercial decision on decreases.' });
    const r = await resolvePolicyConfig(db as any, { clientId: ACME, clientName: 'ACME Telecom', department: 'Wholesale', asOf: '2026-09-14' });

    expect(r.noPolicy).toBe(false);
    expect(r.declaredRules).toEqual(['suspect_rate_decrease']);
    expect(r.undeclaredActions).toEqual(['suspect_rate_decrease']);
    // NOT written into outcomes: the engine treats a rule with no entry as undecided, which is
    // exactly what "considered, not decided" must produce.
    expect(r.config!.outcomes.suspect_rate_decrease).toBeUndefined();
  });

  it("END TO END: an undeclared action makes a −60% decrease undecided, not permitted", async () => {
    await put({ action: null });
    const r = await resolvePolicyConfig(db as any, { clientId: ACME, clientName: 'ACME Telecom', department: 'Wholesale', asOf: '2026-09-14' });
    const { thresholds } = await resolveThresholds(db as any, 'vendor');

    const change: RateChange = {
      key: 'k', destinationId: 3, destinationName: 'AFGHANISTAN - MOBILE AWCC', country: 'AFGHANISTAN',
      newRate: 0.02, priorRate: 0.05, priorRateSource: 'product_rates',
      effectiveDate: '2026-09-14', today: '2026-09-14',
    };
    const v = validateRateChanges([change], thresholds, r.config);
    expect(v.rows[0].disposition).toBe('undecided');
    expect(v.proceeding).toEqual([]);
  });

  it("nothing in the store can turn absence into an action", () => {
    const code = readFileSync(join(__dirname, 'policy-config-store.ts'), 'utf8')
      .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    // No default, no fallback, no coalesce onto a permissive value.
    expect(code).not.toMatch(/\?\?\s*'IGNORE'/);
    expect(code).not.toMatch(/=\s*'IGNORE'/);
    expect(code).not.toMatch(/COALESCE\([^)]*IGNORE/i);
  });
});

describe("client and department are independent axes", () => {
  it("one client's policy is not another's", async () => {
    await put({ clientId: ACME, action: 'REJECT_DESTINATION' });
    await put({ clientId: OTHER, action: 'IGNORE' });

    const a = await resolvePolicyConfig(db as any, { clientId: ACME, clientName: 'ACME Telecom', department: 'Wholesale', asOf: '2026-09-14' });
    const b = await resolvePolicyConfig(db as any, { clientId: OTHER, clientName: 'Other Ltd', department: 'Wholesale', asOf: '2026-09-14' });
    expect(a.config!.outcomes.suspect_rate_decrease).toBe('REJECT_DESTINATION');
    expect(b.config!.outcomes.suspect_rate_decrease).toBe('IGNORE');
  });

  it("one department's policy is not another's, for the SAME client", async () => {
    await put({ department: 'Wholesale', action: 'REJECT_DESTINATION' });
    await put({ department: 'Retail',    action: 'IGNORE' });

    const w = await resolvePolicyConfig(db as any, { clientId: ACME, clientName: 'ACME Telecom', department: 'Wholesale', asOf: '2026-09-14' });
    const r = await resolvePolicyConfig(db as any, { clientId: ACME, clientName: 'ACME Telecom', department: 'Retail',    asOf: '2026-09-14' });
    expect(w.config!.outcomes.suspect_rate_decrease).toBe('REJECT_DESTINATION');
    expect(r.config!.outcomes.suspect_rate_decrease).toBe('IGNORE');
  });

  it("both axes are REQUIRED — neither can be left blank", async () => {
    await expect(put({ department: '   ' })).rejects.toThrow();
    await expect(db.execute(sql`
      INSERT INTO rate_policy_rules (client_id, department, rule_key, effective_from, created_by)
      VALUES (NULL, 'Wholesale', 'suspect_rate_decrease', '2026-01-01', 'junaid')`)).rejects.toThrow();
  });

  it("a policy cannot name a client that does not exist", async () => {
    await expect(put({ clientId: 999 })).rejects.toThrow(/foreign key|violates/i);
  });
});

describe("effective dating keeps provenance", () => {
  it("resolves what the policy said THEN, not what it says now", async () => {
    await put({ action: 'IGNORE',             from: '2026-01-01', to: '2026-06-01' });
    await put({ action: 'REJECT_DESTINATION', from: '2026-06-01', to: null });

    const before = await resolvePolicyConfig(db as any, { clientId: ACME, clientName: 'A', department: 'Wholesale', asOf: '2026-03-01' });
    const after  = await resolvePolicyConfig(db as any, { clientId: ACME, clientName: 'A', department: 'Wholesale', asOf: '2026-09-14' });
    expect(before.config!.outcomes.suspect_rate_decrease).toBe('IGNORE');
    expect(after.config!.outcomes.suspect_rate_decrease).toBe('REJECT_DESTINATION');
  });

  it("the boundary day belongs to the NEW configuration, not both", async () => {
    await put({ action: 'IGNORE',             from: '2026-01-01', to: '2026-06-01' });
    await put({ action: 'REJECT_DESTINATION', from: '2026-06-01', to: null });
    const on = await policyRulesInForce(db as any, { clientId: ACME, department: 'Wholesale', asOf: '2026-06-01' });
    expect(on.length).toBe(1);
    expect(on[0].selectedAction).toBe('REJECT_DESTINATION');
  });

  it("TWO configurations cannot cover the same day", async () => {
    await put({ action: 'IGNORE', from: '2026-01-01', to: '2026-12-31' });
    await expect(put({ action: 'REJECT_DESTINATION', from: '2026-06-01', to: '2026-07-01' }))
      .rejects.toThrow(/already has a configuration covering that period/i);
  });

  it("only ONE open-ended configuration per rule", async () => {
    await put({ action: 'IGNORE', from: '2026-01-01', to: null });
    await expect(put({ action: 'REJECT_DESTINATION', from: '2027-01-01', to: null })).rejects.toThrow();
  });

  it("an overlap for a DIFFERENT rule or client is allowed", async () => {
    await put({ ruleKey: 'suspect_rate_decrease', from: '2026-01-01', to: null });
    await expect(put({ ruleKey: 'suspect_rate_increase', from: '2026-01-01', to: null })).resolves.toBeDefined();
    await expect(put({ clientId: OTHER, from: '2026-01-01', to: null })).resolves.toBeDefined();
  });

  it("effective_to must be after effective_from", async () => {
    // The message must name the columns. A BEFORE trigger runs ahead of the CHECK constraint, so
    // without an explicit ordering check this surfaced as Postgres's opaque "range lower bound
    // must be less than or equal to range upper bound", which names neither column nor row.
    await expect(put({ from: '2026-06-01', to: '2026-01-01' }))
      .rejects.toThrow(/effective_to .* must be after effective_from/i);
    await expect(put({ from: '2026-06-01', to: '2026-06-01' })).rejects.toThrow(/must be after/i);
  });

  it("a change is a new row that supersedes, so the old decision survives", async () => {
    const [old]: any = ((await put({ action: 'IGNORE', from: '2026-01-01', to: '2026-06-01' })) as any).rows;
    await db.execute(sql`
      INSERT INTO rate_policy_rules (client_id, department, rule_key, selected_action,
                                     effective_from, created_by, reason, supersedes_id)
      VALUES (${ACME}, 'Wholesale', 'suspect_rate_decrease', 'REJECT_DESTINATION',
              '2026-06-01', 'junaid', 'Margin review', ${Number(old.id)})`);
    // Both rows remain. "Who moved the decrease rule, when, and why" stays answerable — the
    // question that is currently unanswerable for validation_rules.
    expect((await one(sql`SELECT count(*)::int AS n FROM rate_policy_rules`)).n).toBe(2);
    const [chain]: any = (await db.execute(sql`
      SELECT created_by, reason, supersedes_id FROM rate_policy_rules WHERE supersedes_id IS NOT NULL`) as any).rows;
    expect(chain.created_by).toBe('junaid');
    expect(chain.reason).toBe('Margin review');
    expect(Number(chain.supersedes_id)).toBe(Number(old.id));
  });
});

describe("every policy is attributable", () => {
  it("created_by is required and cannot be blank", async () => {
    await expect(put({ by: '' })).rejects.toThrow();
    await expect(put({ by: '   ' })).rejects.toThrow();
  });

  it("the resolver carries the author and the reason through", async () => {
    await put({ by: 'junaid', reason: 'Margin protection on long-haul' });
    const [r] = await policyRulesInForce(db as any, { clientId: ACME, department: 'Wholesale', asOf: '2026-09-14' });
    expect(r.createdBy).toBe('junaid');
    expect(r.reason).toBe('Margin protection on long-haul');
    expect(r.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("THE WRITER CANNOT CREATE A STATE THE VALIDATOR REFUSES", () => {
  it("AUTO ADJUST EFFECTIVE DATE is accepted on the notice rule", async () => {
    await expect(put({ ruleKey: 'rate_increase_notice_violation', action: 'AUTO_ADJUST_EFFECTIVE_DATE' }))
      .resolves.toBeDefined();
  });

  it("and REFUSED on every other rule — the mismatch is not inherited", async () => {
    // PATCH /api/validation-rules accepts this for any rule, which lets a writer create exactly
    // the state the engine declares a configuration error. The table refuses it instead.
    for (const rule of ['suspect_rate_decrease', 'suspect_rate_increase', 'pending_increases_exceeded',
                        'effective_date_greater_than_limit', 'effective_date_older_than_limit']) {
      await expect(put({ ruleKey: rule, action: 'AUTO_ADJUST_EFFECTIVE_DATE' }), rule)
        .rejects.toThrow(/rpr_auto_adjust_only_on_notice|violates/i);
    }
  });

  it("an unknown rule or an unknown action is refused", async () => {
    await expect(put({ ruleKey: 'made_up_rule' })).rejects.toThrow();
    await expect(put({ action: 'REJECT_EVERYTHING' })).rejects.toThrow();
  });

  it("the six rule keys are EXACTLY the engine's six", async () => {
    // A translation table somebody has to keep in step is a defect waiting to happen; these are
    // identical strings on both sides.
    for (const rule of ['rate_increase_notice_violation', 'suspect_rate_increase', 'suspect_rate_decrease',
                        'pending_increases_exceeded', 'effective_date_greater_than_limit',
                        'effective_date_older_than_limit']) {
      await expect(put({ ruleKey: rule, action: 'IGNORE', from: '2026-01-01' }), rule).resolves.toBeDefined();
    }
  });
});

describe("THRESHOLDS: referenced, never chosen", () => {
  it("reads a category's values", async () => {
    const { thresholds, missing } = await resolveThresholds(db as any, 'vendor');
    expect(thresholds).toEqual({
      rateDecreaseAlertPct: 50, rateIncreaseAlertPct: 50, increaseNoticePeriodDays: 7,
      futureEffectiveDateDays: 14, oldEffectiveDateDays: 7, acceptablePendingIncreases: 3,
    });
    expect(missing).toEqual([]);
  });

  it("PRESERVES the disagreement rather than normalising it", async () => {
    // vendor 14 vs client 15. Which is authoritative is an open business decision; picking one
    // here would settle it by import order.
    const v = await resolveThresholds(db as any, 'vendor');
    const c = await resolveThresholds(db as any, 'client');
    expect(v.thresholds.futureEffectiveDateDays).toBe(14);
    expect(c.thresholds.futureEffectiveDateDays).toBe(15);
  });

  it("the category is REQUIRED — there is no default", async () => {
    const code = readFileSync(join(__dirname, 'policy-config-store.ts'), 'utf8');
    expect(code).toMatch(/category: string/);
    // No default parameter, which would pick a side silently.
    expect(code).not.toMatch(/category: string = /);
    expect(code).not.toMatch(/category\s*\?\?\s*'/);
  });

  it("an unknown category yields nothing, not a fallback to another category", async () => {
    const r = await resolveThresholds(db as any, 'does_not_exist');
    expect(r.thresholds).toEqual({});
    expect(r.missing.length).toBe(6);
  });

  it("an UNPARSEABLE value is absent, never zero", async () => {
    // A threshold of 0 means "every change is a violation" — the most dangerous reading of a typo.
    await db.execute(sql`UPDATE configuration_values SET value = 'fifty' WHERE category = 'vendor' AND config_key = 'rate_decrease_alert'`);
    const r = await resolveThresholds(db as any, 'vendor');
    expect(r.thresholds.rateDecreaseAlertPct).toBeUndefined();
    expect(r.missing).toContain('rate_decrease_alert');
  });

  it("an inactive value is not read", async () => {
    await db.execute(sql`UPDATE configuration_values SET is_active = FALSE WHERE category = 'vendor' AND config_key = 'future_effective_date'`);
    const r = await resolveThresholds(db as any, 'vendor');
    expect(r.thresholds.futureEffectiveDateDays).toBeUndefined();
    expect(r.missing).toContain('future_effective_date');
  });
});

describe("the migration is safe to apply", () => {
  it("is idempotent — applying it twice changes nothing", async () => {
    await client.exec(migration('519_rate_policy_rules.sql'));
    const before = (await one(sql`SELECT count(*)::int AS n FROM pg_indexes WHERE tablename = 'rate_policy_rules'`)).n;
    await client.exec(migration('519_rate_policy_rules.sql'));
    const after = (await one(sql`SELECT count(*)::int AS n FROM pg_indexes WHERE tablename = 'rate_policy_rules'`)).n;
    expect(after).toBe(before);
  });

  it("contains no destructive statement", () => {
    const code = migration('519_rate_policy_rules.sql')
      .split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
    expect(code.match(/\b(DROP\s+(TABLE|COLUMN|DATABASE|SCHEMA)|TRUNCATE|DELETE\s+FROM)\b/gi)).toBeNull();
  });

  it("LEAVES validation_rules ALONE — it is not migrated, read or altered", () => {
    const code = migration('519_rate_policy_rules.sql')
      .split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
    expect(code).not.toContain('validation_rules');
  });

  it("is declared in schema.ts, so a publish diff cannot propose dropping it", () => {
    // The standing hazard: a table in the database and absent from the schema file is one the
    // Drizzle diff can propose DROPPING.
    const schema = readFileSync(join(__dirname, '..', '..', '..', 'shared', 'schema.ts'), 'utf8');
    expect(schema).toContain('pgTable("rate_policy_rules"');
  });
});

describe("declarePolicyRule — the table validates, the function attributes", () => {
  const declare = (o: Partial<Parameters<typeof declarePolicyRule>[1]> = {}) =>
    declarePolicyRule(db as any, { clientId: ACME, department: 'Wholesale', ruleKey: 'suspect_rate_decrease',
      selectedAction: 'REJECT_DESTINATION', effectiveFrom: '2026-01-01', declaredBy: 'junaid', reason: 'controlled test', ...o });

  it("declares, and the row carries the author and reason", async () => {
    const r = await declare();
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.row.createdBy).toBe('junaid'); expect(r.row.reason).toBe('controlled test'); expect(r.row.selectedAction).toBe('REJECT_DESTINATION'); }
  });

  it("a NULL action is a legitimate declaration, not an error and not IGNORE", async () => {
    const r = await declare({ selectedAction: null });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.row.selectedAction).toBeNull();
  });

  it("refuses without an author", async () => {
    const r = await declare({ declaredBy: '  ' });
    expect(r).toMatchObject({ ok: false, code: 'not_attributable' });
  });

  it("turns the trigger's overlap refusal into a code, keeping its message", async () => {
    await declare({ effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31' });
    const r = await declare({ effectiveFrom: '2026-06-01', effectiveTo: '2026-07-01' });
    expect(r).toMatchObject({ ok: false, code: 'overlap' });
    if (!r.ok) expect(r.message).toMatch(/already has a configuration covering that period/);
  });

  it("refuses AUTO_ADJUST outside the notice rule with a legible message", async () => {
    const r = await declare({ selectedAction: 'AUTO_ADJUST_EFFECTIVE_DATE' });
    expect(r).toMatchObject({ ok: false, code: 'invalid' });
    if (!r.ok) expect(r.message).toMatch(/rate_increase_notice_violation only/);
  });

  it("refuses an unknown client as 404-shaped, not a 500", async () => {
    const r = await declare({ clientId: 999 });
    expect(r).toMatchObject({ ok: false, code: 'unknown_client' });
  });
});
