/**
 * THE POLICY LAYER, WIRED — the mixed batch.
 *
 * The decision this proves, taken 2026-09-14: a commercial refusal is isolated to its own
 * operation. One unresolved question must not freeze the sound destinations beside it, which is
 * the same principle the batch engine already holds for technical refusals.
 *
 * The blast radii are the one exception, and they are the POLICY's decision rather than the
 * batch's: `REJECT COUNTRY` and `REJECT RATE-SHEET` are configured consequences that are MEANT to
 * reach other operations. Isolation is the default, not a rule the policy cannot override.
 *
 * Every assertion runs against the real persisted rows and a push that COUNTS ITS CALLS, so
 * "never reached Sippy" is established by the primitive not having been invoked — not by a
 * response saying so.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runRateBatch, type RunnerOperation, type InjectedPush } from "./batch-runner";
import type { Thresholds, RuleConfig } from "./rate-validation";

let client: PGlite;
let db: ReturnType<typeof drizzle>;
const JOB = 'job-policy-1';

const GLOBAL: Thresholds = {
  rateDecreaseAlertPct: 50, rateIncreaseAlertPct: 50,
  increaseNoticePeriodDays: 7, futureEffectiveDateDays: 14, oldEffectiveDateDays: 7,
  acceptablePendingIncreases: 3,
};
const ONEGLOBAL: RuleConfig = {
  clientName: '1GLOBAL', department: 'Wholesale',
  outcomes: {
    rate_increase_notice_violation: 'IGNORE',
    suspect_rate_increase: 'IGNORE',
    suspect_rate_decrease: 'REJECT_DESTINATION',
    pending_increases_exceeded: 'IGNORE',
    effective_date_greater_than_limit: 'REJECT_DESTINATION',
    effective_date_older_than_limit: 'IGNORE',
  },
};
const TODAY = '2026-09-14';
const policy = (config: RuleConfig | null = ONEGLOBAL) => ({ thresholds: GLOBAL, config, today: TODAY });

const op = (over: Partial<RunnerOperation> & Pick<RunnerOperation, 'operationKey'>): RunnerOperation => ({
  accountName: 'test-312', storedITariff: 65, resolvedITariff: 65,
  fullPrefix: '19370', rate: 0.04, rawIncrement: '60/1',
  destinationName: 'AFGHANISTAN - MOBILE AWCC', country: 'AFGHANISTAN',
  priorRate: 0.05, priorRateSource: 'product_rates', effectiveFrom: TODAY,
  ...over,
});

const confirms: InjectedPush = async () => ({
  success: true, message: 'confirmed by read-back', method: 'upload_token',
  verificationResult: 'confirmed', refusedBeforeWrite: false,
});

const all = async (q: any) => { const r: any = await db.execute(q); return Array.isArray(r) ? r : (r.rows ?? []); };
const rows = async () =>
  all(sql`SELECT operation_key, status, refused_before_write, message
            FROM rate_push_operations WHERE job_id = ${JOB} ORDER BY sequence`);

beforeAll(async () => {
  client = await PGlite.create();
  db = drizzle(client);
  await client.exec(`
    CREATE TABLE rate_push_jobs (
      id SERIAL PRIMARY KEY, job_id VARCHAR(64) UNIQUE NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'pending');`);
  for (const m of ['511_rate_push_operations.sql', '512_operation_resolution.sql', '513_operation_trace.sql']) {
    await client.exec(readFileSync(join(__dirname, '..', '..', '..', 'migrations', m), 'utf8'));
  }
});
afterAll(async () => { await client?.close(); });
beforeEach(async () => {
  await client.exec(`DELETE FROM rate_push_operations; DELETE FROM rate_push_jobs;`);
  await db.execute(sql`INSERT INTO rate_push_jobs (job_id) VALUES (${JOB})`);
});

describe("THE MIXED BATCH: A proceeds, B is undecidable, C proceeds", () => {
  /** B is exactly −50%: the boundary the policy will not decide. */
  const mixed = () => [
    op({ operationKey: 'A', fullPrefix: '19370', rate: 0.04,  priorRate: 0.05 }),   // −20%, fine
    op({ operationKey: 'B', fullPrefix: '19371', rate: 0.025, priorRate: 0.05 }),   // −50% EXACTLY
    op({ operationKey: 'C', fullPrefix: '19232', rate: 0.045, priorRate: 0.05,
         destinationName: 'PAKISTAN - MOBILE ZONG', country: 'PAKISTAN' }),         // −10%, fine
  ];

  it("B never reaches Sippy, and A and C still do", async () => {
    const push = vi.fn(confirms);
    await runRateBatch({ db, push, policy: policy() }, { jobId: JOB, operations: mixed() });

    const pushed = push.mock.calls.map((c: any) => c[0].operationKey).sort();
    // Established by the primitive not having been called, not by a response saying so.
    expect(pushed).toEqual(['A', 'C']);
    expect(pushed).not.toContain('B');
  });

  it("B is persisted as refused BEFORE the write, with the subject named", async () => {
    await runRateBatch({ db, push: vi.fn(confirms), policy: policy() }, { jobId: JOB, operations: mixed() });
    const r = await rows();
    const b = r.find((x: any) => x.operation_key === 'B')!;

    expect(b.status).toBe('not_attempted');
    expect(b.refused_before_write).toBe(true);
    expect(String(b.message)).toContain('policy_undecided');
    // "Why wasn't this rate pushed?" must have a deterministic answer that does not pretend the
    // policy answered a question it does not currently answer.
    expect(String(b.message)).toContain('[subject: suspect_rate_decrease]');
    expect(String(b.message)).toMatch(/exactly the 50% threshold/);
  });

  it("NO BATCH-WIDE ABORT — A and C settle normally", async () => {
    const out = await runRateBatch({ db, push: vi.fn(confirms), policy: policy() },
      { jobId: JOB, operations: mixed() });
    const r = await rows();
    for (const key of ['A', 'C']) {
      const row = r.find((x: any) => x.operation_key === key)!;
      expect(row.status, key).toBe('succeeded');
      expect(row.refused_before_write, key).not.toBe(true);
    }
    expect(out.ok).toBe(2);
    expect(out.total).toBe(3);
  });

  it("conservation holds: every submitted operation has exactly one row", async () => {
    await runRateBatch({ db, push: vi.fn(confirms), policy: policy() }, { jobId: JOB, operations: mixed() });
    const r = await rows();
    expect(r.map((x: any) => x.operation_key).sort()).toEqual(['A', 'B', 'C']);
    // A batch cannot quietly do less than it was asked to, refusals included.
    expect(r.length).toBe(3);
  });

  it("undecidable is NEVER converted to IGNORE", async () => {
    const push = vi.fn(confirms);
    await runRateBatch({ db, push, policy: policy() }, { jobId: JOB, operations: mixed() });
    const b = (await rows()).find((x: any) => x.operation_key === 'B')!;
    expect(String(b.message)).not.toMatch(/ignore/i);
    expect(b.status).not.toBe('success');
  });
});

describe("the layer is OFF unless supplied", () => {
  it("with no policy in deps, behaviour is exactly as before — B pushes", async () => {
    // Every existing caller keeps its behaviour. Turning the layer on is a deliberate act.
    const push = vi.fn(confirms);
    await runRateBatch({ db, push }, {
      jobId: JOB,
      operations: [op({ operationKey: 'B', rate: 0.025, priorRate: 0.05 })],
    });
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("THE CALLER IS WIRED: removing the policy call makes this fail", async () => {
    // The teeth. A policy engine with no caller refuses nothing, and the batch would look
    // identical to one with the layer switched off.
    const push = vi.fn(confirms);
    await runRateBatch({ db, push, policy: policy() }, {
      jobId: JOB,
      operations: [op({ operationKey: 'B', rate: 0.025, priorRate: 0.05 })],
    });
    expect(push, 'the policy layer must be consulted when supplied').not.toHaveBeenCalled();
  });
});

describe("policy refusals are distinguishable from technical ones", () => {
  it("a policy refusal and a preflight refusal carry different codes", async () => {
    const push = vi.fn(confirms);
    await runRateBatch({ db, push, policy: policy() }, {
      jobId: JOB,
      operations: [
        op({ operationKey: 'policy',    rate: 0.02, priorRate: 0.05 }),                       // −60%
        op({ operationKey: 'technical', storedITariff: 33, resolvedITariff: 2 }),             // tariff mismatch
        op({ operationKey: 'fine' }),
      ],
    });
    const r = await rows();
    expect(String(r.find((x: any) => x.operation_key === 'policy')!.message)).toContain('policy_reject_destination');
    expect(String(r.find((x: any) => x.operation_key === 'technical')!.message)).toContain('tariff_mismatch');
    // A commercial refusal is not a technical fault and must not read as one.
    expect(String(r.find((x: any) => x.operation_key === 'technical')!.message)).not.toContain('policy_');
    expect(push.mock.calls.map((c: any) => c[0].operationKey)).toEqual(['fine']);
  });

  it("a policy-refused operation is never preflighted — no technical verdict on a forbidden change", async () => {
    const push = vi.fn(confirms);
    await runRateBatch({ db, push, policy: policy() }, {
      jobId: JOB,
      // Both a policy violation AND a tariff mismatch. Policy runs first, so that is the answer.
      operations: [op({ operationKey: 'both', rate: 0.02, priorRate: 0.05, storedITariff: 33, resolvedITariff: 2 })],
    });
    const m = String((await rows())[0].message);
    expect(m).toContain('policy_reject_destination');
    expect(m).not.toContain('tariff_mismatch');
  });
});

describe("THE BLAST RADII reach other operations, because the policy says so", () => {
  const withOutcome = (outcome: any): RuleConfig =>
    ({ ...ONEGLOBAL, outcomes: { ...ONEGLOBAL.outcomes, suspect_rate_decrease: outcome } });

  const batch = () => [
    op({ operationKey: 'af-bad',  rate: 0.02,  priorRate: 0.05 }),                    // −60%, AFGHANISTAN
    op({ operationKey: 'af-ok',   rate: 0.049, priorRate: 0.05, fullPrefix: '1937' }), // −2%,  AFGHANISTAN
    op({ operationKey: 'pk-ok',   rate: 0.049, priorRate: 0.05, fullPrefix: '19232',
         destinationName: 'PAKISTAN - MOBILE ZONG', country: 'PAKISTAN' }),
  ];

  it("REJECT DESTINATION isolates — the country's other destination still pushes", async () => {
    const push = vi.fn(confirms);
    await runRateBatch({ db, push, policy: { ...policy(), config: withOutcome('REJECT_DESTINATION') } },
      { jobId: JOB, operations: batch() });
    expect(push.mock.calls.map((c: any) => c[0].operationKey).sort()).toEqual(['af-ok', 'pk-ok']);
  });

  it("REJECT COUNTRY reaches the sibling destination, and stops at the border", async () => {
    const push = vi.fn(confirms);
    await runRateBatch({ db, push, policy: { ...policy(), config: withOutcome('REJECT_COUNTRY') } },
      { jobId: JOB, operations: batch() });
    expect(push.mock.calls.map((c: any) => c[0].operationKey)).toEqual(['pk-ok']);
    const r = await rows();
    expect(String(r.find((x: any) => x.operation_key === 'af-ok')!.message)).toContain('policy_reject_country');
  });

  it("REJECT RATE-SHEET withholds everything, and NOTHING is pushed", async () => {
    const push = vi.fn(confirms);
    await runRateBatch({ db, push, policy: { ...policy(), config: withOutcome('REJECT_RATE_SHEET') } },
      { jobId: JOB, operations: batch() });
    expect(push).not.toHaveBeenCalled();
    const r = await rows();
    expect(r.length).toBe(3);
    for (const row of r) {
      expect(row.refused_before_write).toBe(true);
      expect(String(row.message)).toContain('policy_reject_rate_sheet');
    }
  });

  it("APPROVAL REQD withholds without pushing", async () => {
    const push = vi.fn(confirms);
    await runRateBatch({ db, push, policy: { ...policy(), config: withOutcome('APPROVAL_REQD') } },
      { jobId: JOB, operations: [op({ operationKey: 'needs', rate: 0.02, priorRate: 0.05 })] });
    expect(push).not.toHaveBeenCalled();
    expect(String((await rows())[0].message)).toContain('policy_approval_required');
  });
});

describe("an unconfigured client refuses rather than sails through", () => {
  it("no rule config means every firing rule is undecided, and nothing is pushed", async () => {
    const push = vi.fn(confirms);
    await runRateBatch({ db, push, policy: policy(null) }, {
      jobId: JOB, operations: [op({ operationKey: 'x', rate: 0.02, priorRate: 0.05 })],
    });
    expect(push).not.toHaveBeenCalled();
    expect(String((await rows())[0].message)).toContain('policy_undecided');
  });

  it("but a clean change under no config still proceeds — silence refuses violations, not everything", async () => {
    const push = vi.fn(confirms);
    await runRateBatch({ db, push, policy: policy(null) }, {
      jobId: JOB, operations: [op({ operationKey: 'clean', rate: 0.049, priorRate: 0.05 })],
    });
    expect(push).toHaveBeenCalledTimes(1);
  });
});
