/**
 * THE ADAPTER, END TO END: stored policy rows → resolver → batch runner → the push primitive.
 *
 * Everything before this stopped one step short. The wiring acceptance ran the runner with a
 * HAND-BUILT config; the resolution tests stopped at the engine. This file is the whole chain
 * against real Postgres and a push that counts its calls, so "never reached Sippy" is established
 * by the primitive not having been invoked.
 *
 * Two findings shaped it. A batch is destinations x CLIENTS, so a batch-wide policy applied one
 * client's rules to every client, and a REJECT RATE-SHEET on client X's operation would have
 * dropped client Y's — a rate sheet is per client. Both are asserted here.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runRateBatch, type RunnerOperation, type InjectedPush } from "./batch-runner";
import { perClientPolicy } from "./policy-adapter";

let client: PGlite;
let db: ReturnType<typeof drizzle>;
const JOB = 'job-adapter-1';
const TODAY = '2026-09-14';
const X = 1, Y = 2;   // two clients in one batch

const migration = (f: string) =>
  readFileSync(join(__dirname, '..', '..', '..', 'migrations', f), 'utf8');

const putPolicy = (clientId: number, ruleKey: string, action: string | null, department = 'Wholesale') =>
  db.execute(sql`
    INSERT INTO rate_policy_rules (client_id, department, rule_key, selected_action, effective_from, created_by)
    VALUES (${clientId}, ${department}, ${ruleKey}, ${action}, '2026-01-01'::date, 'junaid')`);

const op = (over: Partial<RunnerOperation> & Pick<RunnerOperation, 'operationKey'>): RunnerOperation => ({
  accountName: 'acme-account', storedITariff: 65, resolvedITariff: 65,
  fullPrefix: '19370', rate: 0.04, rawIncrement: '60/1',
  destinationName: 'AFGHANISTAN - MOBILE AWCC', country: 'AFGHANISTAN',
  clientId: X, clientName: 'ACME Telecom', department: 'Wholesale',
  priorRate: 0.05, priorRateSource: 'product_rates',
  // Inside both date bounds: today breaches the 7-day notice, 16 days breaches the 14-day limit.
  effectiveFrom: '2026-09-23',
  ...over,
});
// Y on its OWN tariff. Two clients on one tariff with the same prefix would be refused by the
// planner as a duplicate target — the existing rule, unrelated to policy — and read as a policy
// outcome here.
const forY = (over: Partial<RunnerOperation> & Pick<RunnerOperation, 'operationKey'>) =>
  op({ accountName: 'other-account', clientId: Y, clientName: 'Other Ltd',
       storedITariff: 66, resolvedITariff: 66, ...over });

const confirms: InjectedPush = async () => ({
  success: true, message: 'confirmed by read-back', method: 'upload_token',
  verificationResult: 'confirmed', refusedBeforeWrite: false,
});
const pushed = (push: any) => push.mock.calls.map((c: any) => c[0].operationKey).sort();
const rows = async () => ((await db.execute(sql`
  SELECT operation_key, status, refused_before_write, message
    FROM rate_push_operations WHERE job_id = ${JOB} ORDER BY sequence`)) as any).rows;
const adapter = (extra: Partial<Parameters<typeof perClientPolicy>[1]> = {}) =>
  perClientPolicy(db as any, { thresholdCategory: 'vendor', today: TODAY, ...extra });

beforeAll(async () => {
  client = await PGlite.create();
  db = drizzle(client);
  await client.exec(`
    CREATE TABLE rate_push_jobs (id SERIAL PRIMARY KEY, job_id VARCHAR(64) UNIQUE NOT NULL, status VARCHAR(16) NOT NULL DEFAULT 'pending');
    CREATE TABLE companies (id SERIAL PRIMARY KEY, name VARCHAR(256) NOT NULL UNIQUE, short_code VARCHAR(32) NOT NULL UNIQUE);
    CREATE TABLE configuration_values (
      id SERIAL PRIMARY KEY, category VARCHAR(32) NOT NULL, config_key VARCHAR(128) NOT NULL,
      label VARCHAR(256) NOT NULL, value TEXT, is_active BOOLEAN NOT NULL DEFAULT TRUE);
    INSERT INTO companies (id, name, short_code) VALUES (1, 'ACME Telecom', 'ACME'), (2, 'Other Ltd', 'OTH');
  `);
  for (const m of ['511_rate_push_operations.sql', '512_operation_resolution.sql', '513_operation_trace.sql',
                   '519_rate_policy_rules.sql']) {
    await client.exec(migration(m));
  }
});
afterAll(async () => { await client?.close(); });
beforeEach(async () => {
  await client.exec(`
    DELETE FROM rate_push_operations; DELETE FROM rate_push_jobs; DELETE FROM rate_policy_rules;
    DELETE FROM configuration_values;
    INSERT INTO configuration_values (category, config_key, label, value) VALUES
      ('vendor','rate_decrease_alert','Rate Decrease Alert','50.0'),
      ('vendor','rate_increase_alert','Rate Increase Alert','50.0'),
      ('vendor','increase_notice_period','Increase Notice','7'),
      ('vendor','future_effective_date','Future Effective Date','14'),
      ('vendor','old_effective_date','Old Effective Date','7'),
      ('vendor','acceptable_pending_increase','Acceptable Pending','3');`);
  await db.execute(sql`INSERT INTO rate_push_jobs (job_id) VALUES (${JOB})`);
});

describe("THE TEETH BY CONSTRUCTION: the −98% case", () => {
  const cut = () => [op({ operationKey: 'cut', rate: 0.001 })];   // −98%

  it("WITH the adapter, a declared REJECT DESTINATION refuses it before the write", async () => {
    await putPolicy(X, 'suspect_rate_decrease', 'REJECT_DESTINATION');
    const push = vi.fn(confirms);
    await runRateBatch({ db, push, policy: adapter() }, { jobId: JOB, operations: cut() });
    expect(push).not.toHaveBeenCalled();
    const [r] = await rows();
    expect(r.refused_before_write).toBe(true);
    expect(String(r.message)).toContain('policy_reject_destination');
  });

  it("WITHOUT the adapter, the same operation reaches the push — which is why it must be wired", async () => {
    // Not a defect: the layer is opt-in. It is the demonstration that removing the adapter
    // lets the −98% case through, so its absence in a route is a decision, not an accident.
    await putPolicy(X, 'suspect_rate_decrease', 'REJECT_DESTINATION');
    const push = vi.fn(confirms);
    await runRateBatch({ db, push }, { jobId: JOB, operations: cut() });
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("with the threshold MISSING, the declared consequence is undecided end to end — not proceeding", async () => {
    await putPolicy(X, 'suspect_rate_decrease', 'REJECT_DESTINATION');
    await db.execute(sql`DELETE FROM configuration_values WHERE config_key = 'rate_decrease_alert'`);
    const push = vi.fn(confirms);
    const seen: any[] = [];
    await runRateBatch({ db, push, policy: adapter({ onResolved: (k, r) => seen.push({ k, r }) }) },
      { jobId: JOB, operations: cut() });
    expect(push).not.toHaveBeenCalled();
    const [r] = await rows();
    expect(String(r.message)).toContain('policy_undecided');
    expect(String(r.message)).toContain('[subject: suspect_rate_decrease]');
    // And the route was told, once, before any operation was evaluated.
    expect(seen).toHaveLength(1);
    expect(seen[0].r.unmeasurableRules.map((u: any) => u.rule)).toEqual(['suspect_rate_decrease']);
    expect(seen[0].r.usable).toBe(false);
  });

  it("with NO policy declared, a violation is undecided — absence is not permission", async () => {
    const push = vi.fn(confirms);
    await runRateBatch({ db, push, policy: adapter() }, { jobId: JOB, operations: cut() });
    expect(push).not.toHaveBeenCalled();
    expect(String((await rows())[0].message)).toContain('policy_undecided');
  });
});

describe("POLICY IS PER CLIENT — a batch is destinations x clients", () => {
  it("the same −60% decrease is dropped for X and pushed for Y, in ONE batch", async () => {
    await putPolicy(X, 'suspect_rate_decrease', 'REJECT_DESTINATION');
    await putPolicy(Y, 'suspect_rate_decrease', 'IGNORE');
    const push = vi.fn(confirms);
    await runRateBatch({ db, push, policy: adapter() }, {
      jobId: JOB,
      operations: [op({ operationKey: 'X', rate: 0.02 }), forY({ operationKey: 'Y', rate: 0.02 })],
    });
    expect(pushed(push)).toEqual(['Y']);
    expect(String((await rows()).find((r: any) => r.operation_key === 'X').message)).toContain('policy_reject_destination');
  });

  it("X's REJECT RATE-SHEET drops X's whole sheet and NOTHING of Y's", async () => {
    // The defect a batch-wide policy had: one client's sheet rejection reached every client.
    await putPolicy(X, 'suspect_rate_decrease', 'REJECT_RATE_SHEET');
    await putPolicy(Y, 'suspect_rate_decrease', 'REJECT_RATE_SHEET');
    const push = vi.fn(confirms);
    await runRateBatch({ db, push, policy: adapter() }, {
      jobId: JOB,
      operations: [
        op({ operationKey: 'X-bad', rate: 0.02 }),                          // −60%: rejects X's sheet
        op({ operationKey: 'X-ok',  rate: 0.049, fullPrefix: '19232', destinationName: 'PAKISTAN - MOBILE ZONG', country: 'PAKISTAN' }),
        forY({ operationKey: 'Y-ok', rate: 0.049 }),                        // clean, other client
      ],
    });
    expect(pushed(push)).toEqual(['Y-ok']);
    const r = await rows();
    for (const k of ['X-bad', 'X-ok']) {
      expect(String(r.find((x: any) => x.operation_key === k).message), k).toContain('policy_reject_rate_sheet');
    }
  });

  it("the same client differs by DEPARTMENT", async () => {
    await putPolicy(X, 'suspect_rate_decrease', 'REJECT_DESTINATION', 'Wholesale');
    await putPolicy(X, 'suspect_rate_decrease', 'IGNORE', 'Retail');
    const push = vi.fn(confirms);
    await runRateBatch({ db, push, policy: adapter() }, {
      jobId: JOB,
      operations: [op({ operationKey: 'W', rate: 0.02 }), op({ operationKey: 'R', rate: 0.02, department: 'Retail' })],
    });
    expect(pushed(push)).toEqual(['R']);
  });

  it("an operation that names NO client is refused as policy_unresolved, and the rest proceed", async () => {
    await putPolicy(X, 'suspect_rate_decrease', 'IGNORE');
    const push = vi.fn(confirms);
    await runRateBatch({ db, push, policy: adapter() }, {
      jobId: JOB,
      operations: [
        op({ operationKey: 'known', rate: 0.049 }),
        op({ operationKey: 'nobody', rate: 0.049, clientId: null, clientName: null, department: null }),
      ],
    });
    expect(pushed(push)).toEqual(['known']);
    const r = (await rows()).find((x: any) => x.operation_key === 'nobody');
    expect(r.status).toBe('not_attempted');
    expect(r.refused_before_write).toBe(true);
    expect(String(r.message)).toContain('policy_unresolved');
    expect(String(r.message)).toContain('[subject: no_policy_scope]');
  });

  it("resolves each client+department ONCE, however many operations it has", async () => {
    await putPolicy(X, 'suspect_rate_decrease', 'IGNORE');
    await putPolicy(Y, 'suspect_rate_decrease', 'IGNORE');
    const resolved: string[] = [];
    const push = vi.fn(confirms);
    await runRateBatch({ db, push, policy: adapter({ onResolved: k => resolved.push(k) }) }, {
      jobId: JOB,
      operations: [
        op({ operationKey: 'x1', rate: 0.049 }), op({ operationKey: 'x2', rate: 0.049, fullPrefix: '19232' }),
        op({ operationKey: 'x3', rate: 0.049, fullPrefix: '1933' }),
        forY({ operationKey: 'y1', rate: 0.049 }), forY({ operationKey: 'y2', rate: 0.049, fullPrefix: '19232' }),
      ],
    });
    expect(resolved.sort()).toEqual(['1:Wholesale', '2:Wholesale']);
    expect(push).toHaveBeenCalledTimes(5);
  });
});

describe("it never consults validation_rules, defaults nothing, and carries no transport", () => {
  it("a permissive validation_rules stack changes NOTHING about the outcome", async () => {
    // The legacy singleton, with every rule at 'ignore'. If any part of this path fell back to it,
    // the −60% cut below would proceed. It must stay undecided.
    await client.exec(`
      CREATE TABLE IF NOT EXISTS validation_rules (
        id SERIAL PRIMARY KEY, scope VARCHAR(32) NOT NULL, rule_key VARCHAR(128) NOT NULL,
        selected_action VARCHAR(64) NOT NULL DEFAULT 'ignore', is_active BOOLEAN NOT NULL DEFAULT TRUE);
      INSERT INTO validation_rules (scope, rule_key, selected_action) VALUES
        ('client', 'client_suspect_rate_decrease', 'ignore'), ('vendor', 'vendor_suspect_rate_decrease', 'ignore');`);
    const push = vi.fn(confirms);
    await runRateBatch({ db, push, policy: adapter() }, { jobId: JOB, operations: [op({ operationKey: 'cut', rate: 0.02 })] });
    expect(push).not.toHaveBeenCalled();
    expect(String((await rows())[0].message)).toContain('policy_undecided');
  });

  it("no module on the path names validation_rules", () => {
    for (const f of ['policy-adapter.ts', 'policy-resolution.ts', 'policy-config-store.ts', 'rate-validation.ts']) {
      const code = readFileSync(join(__dirname, f), 'utf8')
        .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      expect(code, f).not.toMatch(/validation_rules|validationRules/);
    }
  });

  it("the adapter imports only the policy modules and types — no db, no sippy, no transport", () => {
    const src = readFileSync(join(__dirname, 'policy-adapter.ts'), 'utf8');
    const imports = src.split('\n').filter(l => /^import /.test(l));
    expect(imports).toHaveLength(3);
    for (const l of imports) expect(l).toMatch(/from '\.\/(policy-resolution|policy-config-store|batch-runner)'/);
    const code = src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    for (const forbidden of ["from './db'", 'sippy', 'fetch(', 'INSERT', 'UPDATE ', 'runRateBatch(', "'IGNORE'"]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it("building the resolver performs no query; the threshold category has no default", async () => {
    const execute = vi.fn(async (q: any) => (db as any).execute(q));
    perClientPolicy({ execute } as any, { thresholdCategory: 'vendor', today: TODAY });
    expect(execute).not.toHaveBeenCalled();
    const src = readFileSync(join(__dirname, 'policy-adapter.ts'), 'utf8');
    expect(src).not.toMatch(/thresholdCategory\s*(\?\?|=)\s*'/);
  });

  it("NO PRODUCTION CALLER — the resolver exists and the routes do not build it", () => {
    const routes = [
      readFileSync(join(__dirname, '..', '..', 'routes.ts'), 'utf8'),
      readFileSync(join(__dirname, '..', '..', 'routes-rate-manager.ts'), 'utf8'),
    ].join('\n');
    expect(routes).not.toContain('perClientPolicy');
    expect(routes).not.toContain('policy-adapter');
  });
});
