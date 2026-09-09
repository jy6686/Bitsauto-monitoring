/**
 * The execution rules, asserted as behaviour rather than as configuration.
 *
 * Two of these encode the September incidents directly: an outcome nobody could establish must
 * not be retried (a second write on the add path can edit a different rate), and it must stop
 * further writes to the same tariff (that tariff may still be processing our file, which is how
 * jobs #37–#45 locked each other out one after another).
 */
import { describe, it, expect, vi } from "vitest";
import { planRateBatch, type RateOperation } from "./batch-plan";
import { executeRateBatch, summariseBatch, type OperationOutcome, type OperationRunner } from "./batch-execute";

const op = (key: string, iTariff: number | null, prefix = '19370'): RateOperation =>
  ({ operationKey: key, accountName: `acct-${iTariff}`, iTariff, prefix, rate: 0.133 });

const ok   = (message = 'confirmed by read-back'): OperationOutcome => ({ verdict: 'success', message });
const bad  = (message = 'tariff does not hold it'): OperationOutcome => ({ verdict: 'failure', message });
const unkn = (message = 'no read-back was possible'): OperationOutcome => ({ verdict: 'indeterminate', message });

/** Runner driven by a per-operation script. */
const scripted = (script: Record<string, OperationOutcome | OperationOutcome[]>): OperationRunner => {
  const calls: Record<string, number> = {};
  return async (operation) => {
    const n = (calls[operation.operationKey] = (calls[operation.operationKey] ?? 0) + 1);
    const entry = script[operation.operationKey] ?? ok();
    return Array.isArray(entry) ? entry[Math.min(n - 1, entry.length - 1)] : entry;
  };
};

describe("executeRateBatch — an unknown outcome is terminal", () => {
  it("NEVER retries an indeterminate outcome, even when retries are allowed", async () => {
    // A retry of a mutation we cannot prove did not happen is a second write, and on Sippy's add
    // path a second write can edit an existing rate rather than repeat the intended one.
    const run = vi.fn<OperationRunner>(async () => unkn());
    const outcome = await executeRateBatch(planRateBatch([op('a', 64)]), run, { maxAttempts: 5 });

    expect(run).toHaveBeenCalledTimes(1);
    expect(outcome.results[0].verdict).toBe('indeterminate');
    expect(outcome.results[0].attempts).toBe(1);
  });

  it("HALTS the rest of that tariff's lane, and says why, without failing what it never tried", async () => {
    const plan = planRateBatch([op('a', 64, '191'), op('b', 64, '192'), op('c', 64, '193')]);
    const outcome = await executeRateBatch(plan, scripted({ a: unkn() }));

    expect(outcome.results.map(r => r.verdict)).toEqual(['indeterminate', 'not_attempted', 'not_attempted']);
    expect(outcome.results[1].message).toContain('unknown state');
    expect(outcome.results[1].attempts).toBe(0);
    expect(outcome.haltedLanes).toEqual([{ iTariff: 64, atOperationKey: 'a', remaining: 2 }]);
  });

  it("halts ONLY the affected tariff — other tariffs are separate locks and finish normally", async () => {
    const plan = planRateBatch([
      op('a1', 64, '191'), op('a2', 64, '192'),
      op('b1', 65, '191'), op('b2', 65, '192'),
    ]);
    const outcome = await executeRateBatch(plan, scripted({ a1: unkn() }));

    const byKey = Object.fromEntries(outcome.results.map(r => [r.operationKey, r.verdict]));
    expect(byKey).toEqual({ a1: 'indeterminate', a2: 'not_attempted', b1: 'success', b2: 'success' });
    expect(outcome.haltedLanes.map(h => h.iTariff)).toEqual([64]);
  });

  it("a thrown push is indeterminate, not a failure — the request may have reached Sippy", async () => {
    const outcome = await executeRateBatch(
      planRateBatch([op('a', 64)]),
      async () => { throw new Error('socket hang up'); },
      { maxAttempts: 3 },
    );
    expect(outcome.results[0].verdict).toBe('indeterminate');
    expect(outcome.results[0].attempts).toBe(1);
    expect(outcome.results[0].message).toContain('socket hang up');
    expect(outcome.results[0].message).toContain('may still have been applied');
  });
});

describe("executeRateBatch — retries apply only to proven non-writes", () => {
  it("retries a failure up to maxAttempts and reports the attempt count", async () => {
    const run = vi.fn<OperationRunner>(async () => bad());
    const outcome = await executeRateBatch(planRateBatch([op('a', 64)]), run, { maxAttempts: 3 });
    expect(run).toHaveBeenCalledTimes(3);
    expect(outcome.results[0].attempts).toBe(3);
    expect(outcome.results[0].verdict).toBe('failure');
  });

  it("stops retrying as soon as one succeeds", async () => {
    const outcome = await executeRateBatch(
      planRateBatch([op('a', 64)]), scripted({ a: [bad(), ok('applied on the second attempt')] }), { maxAttempts: 3 },
    );
    expect(outcome.results[0].verdict).toBe('success');
    expect(outcome.results[0].attempts).toBe(2);
  });

  it("does not retry at all by default", async () => {
    const run = vi.fn<OperationRunner>(async () => bad());
    await executeRateBatch(planRateBatch([op('a', 64)]), run);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("a failure does NOT halt the lane — the read-back proved nothing was applied", async () => {
    const plan = planRateBatch([op('a', 64, '191'), op('b', 64, '192')]);
    const outcome = await executeRateBatch(plan, scripted({ a: bad() }));
    expect(outcome.results.map(r => r.verdict)).toEqual(['failure', 'success']);
    expect(outcome.haltedLanes).toEqual([]);
  });
});

describe("executeRateBatch — ordering", () => {
  it("never runs two operations of one tariff at the same time", async () => {
    let inFlight = 0, maxObserved = 0;
    const plan = planRateBatch(Array.from({ length: 6 }, (_, i) => op(`k${i}`, 64, `prefix${i}`)));
    await executeRateBatch(plan, async () => {
      inFlight += 1; maxObserved = Math.max(maxObserved, inFlight);
      await new Promise(r => setTimeout(r, 1));
      inFlight -= 1;
      return ok();
    }, { maxAttempts: 1 });
    expect(maxObserved).toBe(1);
  });

  it("runs different tariffs concurrently, up to the plan's concurrency", async () => {
    let inFlight = 0, maxObserved = 0;
    const plan = planRateBatch(
      Array.from({ length: 6 }, (_, i) => op(`k${i}`, 100 + i)),
      { concurrency: 3 },
    );
    await executeRateBatch(plan, async () => {
      inFlight += 1; maxObserved = Math.max(maxObserved, inFlight);
      await new Promise(r => setTimeout(r, 5));
      inFlight -= 1;
      return ok();
    });
    expect(plan.concurrency).toBe(3);
    expect(maxObserved).toBe(3);
  });

  it("keeps a lane's operations in the caller's order", async () => {
    const seen: string[] = [];
    const plan = planRateBatch([op('a', 64, '1'), op('b', 64, '2'), op('c', 64, '3')]);
    await executeRateBatch(plan, async (o) => { seen.push(o.operationKey); return ok(); });
    expect(seen).toEqual(['a', 'b', 'c']);
  });
});

describe("executeRateBatch — reporting", () => {
  it("reports progress for every settled operation, including ones never attempted", async () => {
    const seen: Array<[string, number, number]> = [];
    const plan = planRateBatch([op('a', 64, '1'), op('b', 64, '2')]);
    await executeRateBatch(plan, scripted({ a: unkn() }), {
      onResult: (r, p) => seen.push([r.operationKey, p.done, p.total]),
    });
    expect(seen).toEqual([['a', 1, 2], ['b', 2, 2]]);
  });

  it("a throwing progress callback cannot fail the batch", async () => {
    const outcome = await executeRateBatch(planRateBatch([op('a', 64)]), scripted({}), {
      onResult: () => { throw new Error('reporting blew up'); },
    });
    expect(outcome.counts.success).toBe(1);
  });

  it("`complete` is true only when every SUBMITTED operation succeeded", async () => {
    const allGood = await executeRateBatch(planRateBatch([op('a', 64), op('b', 65)]), scripted({}));
    expect(allGood.complete).toBe(true);

    // One refused before execution — the batch did less than it was asked, so it is not complete.
    const withRefusal = planRateBatch([op('a', 64), op('b', null)]);
    const partial = await executeRateBatch(withRefusal, scripted({}));
    expect(partial.counts.success).toBe(1);
    expect(partial.counts.refused).toBe(1);
    expect(partial.complete).toBe(false);
  });

  it("summarises for an operator, leading with what needs a human", async () => {
    const plan = planRateBatch([op('a', 64, '1'), op('b', 64, '2'), op('c', 65, '1'), op('d', null)]);
    const outcome = await executeRateBatch(plan, scripted({ a: unkn() }));
    const line = summariseBatch(outcome);
    expect(line).toContain('UNVERIFIED — read the tariff');
    expect(line).toContain('1 not attempted');
    expect(line).toContain('1 refused before execution');
    expect(line).toContain('Halted tariff(s): 64');
  });
});
