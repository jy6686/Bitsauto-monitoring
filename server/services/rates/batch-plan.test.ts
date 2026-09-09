/**
 * The scheduling rules, stated as the incidents that produced them.
 *
 * The load-bearing one is the first: between 2026-09-07 and 09-09 every push failed against a
 * tariff that our own previous upload had left locked. A plan that puts two operations for one
 * tariff into the same lane recreates that, so it is asserted directly rather than left to a
 * concurrency setting nobody reads.
 */
import { describe, it, expect } from "vitest";
import {
  planRateBatch, longestLaneDepth,
  DEFAULT_LANE_CONCURRENCY, MAX_LANE_CONCURRENCY, MIN_LANE_CONCURRENCY,
  type RateOperation,
} from "./batch-plan";

const op = (over: Partial<RateOperation> & Pick<RateOperation, 'operationKey'>): RateOperation => ({
  accountName: 'test-312', iTariff: 65, prefix: '19370', rate: 0.133, ...over,
});

describe("planRateBatch — one lane per tariff", () => {
  it("SELF-LOCK REGRESSION: two operations on one tariff share a lane, so they can never overlap", () => {
    // Jobs #37–#45: each push left the tariff locked and the next tripped over it. Serialising
    // within a tariff is the scheduling expression of that finding.
    const plan = planRateBatch([
      op({ operationKey: 'a', iTariff: 64, prefix: '19370' }),
      op({ operationKey: 'b', iTariff: 64, prefix: '19371' }),
      op({ operationKey: 'c', iTariff: 64, prefix: '19372' }),
    ]);
    expect(plan.lanes).toHaveLength(1);
    expect(plan.lanes[0].operations.map(o => o.operationKey)).toEqual(['a', 'b', 'c']);
    expect(plan.concurrency).toBe(1);   // one lane — nothing to run alongside it
  });

  it("different tariffs are independent locks and get their own lanes", () => {
    const plan = planRateBatch([
      op({ operationKey: 'a', iTariff: 64 }),
      op({ operationKey: 'b', iTariff: 65 }),
      op({ operationKey: 'c', iTariff: 66 }),
    ]);
    expect(plan.lanes.map(l => l.iTariff)).toEqual([64, 65, 66]);
    expect(plan.lanes.every(l => l.operations.length === 1)).toBe(true);
  });

  it("interleaved input still collapses to one lane per tariff, keeping each tariff's order", () => {
    const plan = planRateBatch([
      op({ operationKey: 'a1', iTariff: 2, prefix: '79230' }),
      op({ operationKey: 'b1', iTariff: 66, prefix: '79230' }),
      op({ operationKey: 'a2', iTariff: 2, prefix: '79232' }),
      op({ operationKey: 'b2', iTariff: 66, prefix: '79232' }),
    ]);
    expect(plan.lanes.map(l => l.iTariff)).toEqual([2, 66]);
    expect(plan.lanes[0].operations.map(o => o.operationKey)).toEqual(['a1', 'a2']);
    expect(plan.lanes[1].operations.map(o => o.operationKey)).toEqual(['b1', 'b2']);
  });
});

describe("planRateBatch — what it refuses", () => {
  it("refuses an operation whose tariff never resolved, rather than writing somewhere unknown", () => {
    const plan = planRateBatch([
      op({ operationKey: 'ok', iTariff: 65 }),
      op({ operationKey: 'lost', iTariff: null, accountName: 'no-account' }),
    ]);
    expect(plan.executableCount).toBe(1);
    expect(plan.refused).toHaveLength(1);
    expect(plan.refused[0].code).toBe('unresolved_tariff');
    expect(plan.refused[0].message).toContain('no Sippy tariff resolved');
  });

  it("refuses the SECOND write to the same prefix in the same tariff, and says which won", () => {
    // Serialising these would silently apply whichever finished last.
    const plan = planRateBatch([
      op({ operationKey: 'first',  iTariff: 65, prefix: '19370', rate: 0.10 }),
      op({ operationKey: 'second', iTariff: 65, prefix: '19370', rate: 0.12 }),
    ]);
    expect(plan.executableCount).toBe(1);
    expect(plan.lanes[0].operations[0].operationKey).toBe('first');
    expect(plan.refused[0].code).toBe('duplicate_target');
    expect(plan.refused[0].message).toContain('already written by operation first');
  });

  it("the same prefix in DIFFERENT tariffs is not a duplicate — it is the normal case", () => {
    // One destination pushed to many customers is the entire point of a batch.
    const plan = planRateBatch([
      op({ operationKey: 'a', iTariff: 64, prefix: '19370' }),
      op({ operationKey: 'b', iTariff: 65, prefix: '19370' }),
      op({ operationKey: 'c', iTariff: 66, prefix: '19370' }),
    ]);
    expect(plan.refused).toEqual([]);
    expect(plan.executableCount).toBe(3);
  });

  it("CONSERVATION: every submitted operation is either executable or refused, never dropped", () => {
    const submitted = [
      op({ operationKey: 'a', iTariff: 64 }),
      op({ operationKey: 'b', iTariff: null }),
      op({ operationKey: 'c', iTariff: 64, prefix: '19370' }),   // duplicate of 'a'
      op({ operationKey: 'd', iTariff: 65 }),
    ];
    const plan = planRateBatch(submitted);
    expect(plan.submittedCount).toBe(4);
    expect(plan.executableCount + plan.refused.length).toBe(plan.submittedCount);
  });
});

describe("planRateBatch — concurrency", () => {
  const threeLanes = () => [
    op({ operationKey: 'a', iTariff: 64 }), op({ operationKey: 'b', iTariff: 65 }), op({ operationKey: 'c', iTariff: 66 }),
  ];

  it("defaults conservatively, because the switch is carrying live calls", () => {
    expect(planRateBatch(threeLanes()).concurrency).toBe(DEFAULT_LANE_CONCURRENCY);
  });

  it("never exceeds the lane count — extra workers would have no lane to take", () => {
    expect(planRateBatch(threeLanes(), { concurrency: 8 }).concurrency).toBe(3);
    expect(planRateBatch([op({ operationKey: 'a', iTariff: 64 })], { concurrency: 8 }).concurrency).toBe(1);
  });

  it("clamps a request above the ceiling and below the floor", () => {
    const many = Array.from({ length: 20 }, (_, i) => op({ operationKey: `k${i}`, iTariff: 100 + i }));
    expect(planRateBatch(many, { concurrency: 999 }).concurrency).toBe(MAX_LANE_CONCURRENCY);
    expect(planRateBatch(many, { concurrency: 0 }).concurrency).toBe(MIN_LANE_CONCURRENCY);
    expect(planRateBatch(many, { concurrency: -5 }).concurrency).toBe(MIN_LANE_CONCURRENCY);
  });

  it("an empty batch plans to nothing and still reports a usable concurrency", () => {
    const plan = planRateBatch([]);
    expect(plan.lanes).toEqual([]);
    expect(plan.executableCount).toBe(0);
    expect(plan.concurrency).toBe(MIN_LANE_CONCURRENCY);
  });
});

describe("longestLaneDepth", () => {
  it("reports the serial floor a batch cannot beat", () => {
    // 19,160 prefixes onto one customer's tariff is 19,160 sequential operations, and an
    // operator asking for more workers should be told that before starting.
    const plan = planRateBatch([
      op({ operationKey: 'a1', iTariff: 2, prefix: '1' }),
      op({ operationKey: 'a2', iTariff: 2, prefix: '2' }),
      op({ operationKey: 'a3', iTariff: 2, prefix: '3' }),
      op({ operationKey: 'b1', iTariff: 66, prefix: '1' }),
    ]);
    expect(longestLaneDepth(plan)).toBe(3);
  });

  it("is zero when nothing is executable", () => {
    expect(longestLaneDepth(planRateBatch([op({ operationKey: 'x', iTariff: null })]))).toBe(0);
  });
});
