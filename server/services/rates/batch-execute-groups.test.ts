/**
 * The executor with groups: a lane is walked group by group, and every rule that held per
 * operation still holds — one durable result per operation, an unknown outcome halts the lane,
 * other tariffs are unaffected. The group is invisible in the results.
 */
import { describe, it, expect, vi } from "vitest";
import { planRateBatch, type RateOperation, type TariffLane } from "./batch-plan";
import { executeRateBatch, type OperationOutcome, type GroupRunner, type GroupSplit } from "./batch-execute";

const op = (key: string, iTariff: number, prefix: string, effectiveFrom?: string): RateOperation =>
  ({ operationKey: key, accountName: `acct-${iTariff}`, iTariff, prefix, rate: 0.04, effectiveFrom });

const ok   = (message = 'confirmed'): OperationOutcome => ({ verdict: 'success', message });
const bad  = (message = 'mismatch'): OperationOutcome => ({ verdict: 'failure', message });
const unkn = (message = 'no read-back'): OperationOutcome => ({ verdict: 'indeterminate', message });

/** Splits a lane by effectiveFrom, in first-seen order — a stand-in for the real grouping. */
const byDate: GroupSplit = (lane: TariffLane) => {
  const groups = new Map<string, RateOperation[]>();
  for (const o of lane.operations) {
    const k = o.effectiveFrom ?? '';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(o);
  }
  return [...groups.values()].map(operations => ({ operations }));
};

/** Never called: a test that reaches the per-operation runner while grouping is on has failed. */
const neverPerOp = vi.fn(async () => { throw new Error('per-operation runner must not run when groups are configured'); });

describe("cardinality — one result per operation, always", () => {
  it("a group of five yields five results in lane order, the group itself invisible", async () => {
    const plan = planRateBatch([op('m', 66, '29230', 'D'), op('u', 66, '29233', 'D'), op('w', 66, '29232', 'D'), op('z1', 66, '29231', 'D'), op('z2', 66, '29237', 'D')]);
    const run: GroupRunner = vi.fn(async (g) => g.operations.map(() => ok()));
    const out = await executeRateBatch(plan, neverPerOp, { groups: { split: byDate, run } });

    expect(run).toHaveBeenCalledTimes(1);
    expect((run as any).mock.calls[0][0].operations.map((o: RateOperation) => o.operationKey)).toEqual(['m', 'u', 'w', 'z1', 'z2']);
    expect(out.results.map(r => r.operationKey)).toEqual(['m', 'u', 'w', 'z1', 'z2']);
    expect(out.results.every(r => r.verdict === 'success' && r.attempts === 1)).toBe(true);
    expect(out.counts.success).toBe(5);
    expect(out.complete).toBe(true);
    expect(neverPerOp).not.toHaveBeenCalled();
  });

  it("4 confirmed + 1 mismatch is recorded as four successes and one failure — never collapsed", async () => {
    const plan = planRateBatch([op('a', 66, '1', 'D'), op('b', 66, '2', 'D'), op('c', 66, '3', 'D'), op('d', 66, '4', 'D'), op('e', 66, '5', 'D')]);
    const run: GroupRunner = async (g) => g.operations.map(o => (o.operationKey === 'd' ? bad() : ok()));
    const out = await executeRateBatch(plan, neverPerOp, { groups: { split: byDate, run } });

    expect(out.results.map(r => r.verdict)).toEqual(['success', 'success', 'success', 'failure', 'success']);
    expect(out.counts).toMatchObject({ success: 4, failure: 1, indeterminate: 0, not_attempted: 0 });
    expect(out.complete).toBe(false);
  });

  it("a runner that returns the wrong number of outcomes is a code defect: every operation in that group is indeterminate", async () => {
    const plan = planRateBatch([op('a', 66, '1', 'D'), op('b', 66, '2', 'D'), op('c', 66, '3', 'D')]);
    const run: GroupRunner = async () => [ok(), ok()];   // three in, two out
    const out = await executeRateBatch(plan, neverPerOp, { groups: { split: byDate, run } });

    expect(out.results.map(r => r.verdict)).toEqual(['indeterminate', 'indeterminate', 'indeterminate']);
    expect(out.results[0].message).toMatch(/2 outcome\(s\) for 3 operation\(s\)/);
  });

  it("a runner that throws leaves every operation in the group indeterminate — the file may have been sent", async () => {
    const plan = planRateBatch([op('a', 66, '1', 'D'), op('b', 66, '2', 'D')]);
    const run: GroupRunner = async () => { throw Object.assign(new Error('socket hang up'), { trace: ['+1ms token ok', '+900ms uploading'] }); };
    const out = await executeRateBatch(plan, neverPerOp, { groups: { split: byDate, run } });

    expect(out.results.map(r => r.verdict)).toEqual(['indeterminate', 'indeterminate']);
    expect(out.results[0].message).toContain('socket hang up');
    expect(out.results[0].trace).toEqual(['+1ms token ok', '+900ms uploading']);
  });
});

describe("boundary behaviour across groups", () => {
  it("one indeterminate row halts the lane: later groups on that tariff are not attempted, other tariffs finish", async () => {
    const plan = planRateBatch([
      op('a1', 66, '1', 'D1'), op('a2', 66, '2', 'D1'),   // group 1 on 66
      op('a3', 66, '3', 'D2'),                           // group 2 on 66 — must not run
      op('b1', 68, '1', 'D1'),                           // tariff 68 — unaffected
    ]);
    const run: GroupRunner = vi.fn(async (g, ctx) =>
      g.operations.map(o => (o.operationKey === 'a2' ? unkn() : ok(`t${ctx.iTariff}`))));
    const out = await executeRateBatch(plan, neverPerOp, { groups: { split: byDate, run } });

    const byKey = Object.fromEntries(out.results.map(r => [r.operationKey, r.verdict]));
    expect(byKey).toEqual({ a1: 'success', a2: 'indeterminate', a3: 'not_attempted', b1: 'success' });
    expect(out.haltedLanes).toEqual([{ iTariff: 66, atOperationKey: 'a2', remaining: 1 }]);
    expect(out.results.find(r => r.operationKey === 'a3')!.message).toContain('unknown state');
    // The halted group's runner was called once for 66 and once for 68 — never for group 2.
    expect((run as any).mock.calls.map((c: any[]) => c[1].iTariff).sort()).toEqual([66, 68]);
  });

  it("a plain failure does NOT halt the lane: the next group on the tariff still runs", async () => {
    const plan = planRateBatch([op('a1', 66, '1', 'D1'), op('a2', 66, '2', 'D2')]);
    const run: GroupRunner = vi.fn(async (g) => g.operations.map(o => (o.operationKey === 'a1' ? bad() : ok())));
    const out = await executeRateBatch(plan, neverPerOp, { groups: { split: byDate, run } });

    expect(run).toHaveBeenCalledTimes(2);
    expect(out.results.map(r => r.verdict)).toEqual(['failure', 'success']);
    expect(out.haltedLanes).toEqual([]);
  });

  it("groups are never retried, even when retries are allowed", async () => {
    const plan = planRateBatch([op('a', 66, '1', 'D')]);
    const run: GroupRunner = vi.fn(async () => [bad()]);
    const out = await executeRateBatch(plan, neverPerOp, { maxAttempts: 5, groups: { split: byDate, run } });
    expect(run).toHaveBeenCalledTimes(1);
    expect(out.results[0].attempts).toBe(1);
  });

  it("progress is reported once per operation, in order, and a rejecting reporter never fails the batch", async () => {
    const plan = planRateBatch([op('a', 66, '1', 'D'), op('b', 66, '2', 'D')]);
    const seen: Array<[string, number, number]> = [];
    const out = await executeRateBatch(plan, neverPerOp, {
      groups: { split: byDate, run: async (g) => g.operations.map(() => ok()) },
      onResult: async (r, p) => { seen.push([r.operationKey, p.done, p.total]); throw new Error('reporter down'); },
    });
    expect(seen).toEqual([['a', 1, 2], ['b', 2, 2]]);
    expect(out.counts.success).toBe(2);
  });

  it("without a groups option the per-operation path is untouched", async () => {
    const plan = planRateBatch([op('a', 66, '1', 'D'), op('b', 66, '2', 'D')]);
    const perOp = vi.fn(async () => ok());
    const out = await executeRateBatch(plan, perOp);
    expect(perOp).toHaveBeenCalledTimes(2);
    expect(out.counts.success).toBe(2);
  });
});
