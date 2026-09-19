/**
 * Grouping is the whole optimisation: which operations may share ONE Sippy upload.
 *
 * The key is (tariff, upload verb, activation date) and nothing looser. Sippy's `A` and `SA` are
 * not interchangeable (SA silently discards a future date), and a multi-row workbook has only been
 * proven for rows that would each have been an identical single-row upload — same verb, same
 * activation. So a group is exactly the set of rows that already had that property. Mixed verbs
 * or mixed dates in one file is a semantics nobody has proven, and this refuses to produce it.
 */
import { describe, it, expect } from "vitest";
import { planRateBatch, type RateOperation } from "./batch-plan";
import { groupLane, groupKeyFor } from "./group-plan";

// Far enough ahead that "A" does not depend on when the test runs.
const FUTURE = '2099-01-01 10:00:00';
const FUTURE_2 = '2099-01-02 10:00:00';

const op = (key: string, prefix: string, effectiveFrom?: string, iTariff = 66): RateOperation =>
  ({ operationKey: key, accountName: 'aura', iTariff, prefix, rate: 0.04, effectiveFrom });

const lane = (...ops: RateOperation[]) => planRateBatch(ops).lanes[0];

describe("groupKeyFor — the verb and the date decide", () => {
  it("a future activation is an A group keyed on the normalised date", () => {
    expect(groupKeyFor(op('a', '29230', '2099-01-01T10:00'))).toEqual({ action: 'A', activation: FUTURE });
  });

  it("no activation is an SA group with an empty activation, whatever the till", () => {
    expect(groupKeyFor(op('a', '29230'))).toEqual({ action: 'SA', activation: '' });
  });

  it("an activation in the past is SA — Sippy would discard the date anyway, so it must not split groups", () => {
    expect(groupKeyFor(op('a', '29230', '2020-01-01 00:00:00'))).toEqual({ action: 'SA', activation: '' });
  });
});

describe("groupLane — one upload per (tariff, verb, activation)", () => {
  it("Aura's five: same tariff, same future date → ONE group of five", () => {
    const groups = groupLane(lane(
      op('m', '29230', FUTURE), op('u', '29233', FUTURE), op('w', '29232', FUTURE),
      op('z1', '29231', FUTURE), op('z2', '29237', FUTURE),
    ));
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ iTariff: 66, action: 'A', activation: FUTURE });
    expect(groups[0].operations.map(o => o.operationKey)).toEqual(['m', 'u', 'w', 'z1', 'z2']);
  });

  it("A and SA rows for the same tariff never share a workbook", () => {
    const groups = groupLane(lane(op('a', '29230', FUTURE), op('b', '29231'), op('c', '29232', FUTURE)));
    expect(groups.map(g => [g.action, g.operations.map(o => o.operationKey)])).toEqual([
      ['A',  ['a', 'c']],
      ['SA', ['b']],
    ]);
  });

  it("two different future dates are two A groups", () => {
    const groups = groupLane(lane(op('a', '29230', FUTURE), op('b', '29231', FUTURE_2)));
    expect(groups.map(g => g.activation)).toEqual([FUTURE, FUTURE_2]);
    expect(groups.every(g => g.operations.length === 1)).toBe(true);
  });

  it("the same date written two ways is ONE group — the key is the normalised value", () => {
    const groups = groupLane(lane(op('a', '29230', '2099-01-01T10:00'), op('b', '29231', '2099-01-01 10:00:00')));
    expect(groups).toHaveLength(1);
  });

  it("keeps the caller's order: groups appear in first-seen order, operations in lane order", () => {
    const groups = groupLane(lane(
      op('1', '291', FUTURE_2), op('2', '292'), op('3', '293', FUTURE_2), op('4', '294', FUTURE), op('5', '295'),
    ));
    expect(groups.map(g => g.operations.map(o => o.operationKey))).toEqual([['1', '3'], ['2', '5'], ['4']]);
  });

  it("conserves every operation exactly once", () => {
    const ops = [op('a', '291', FUTURE), op('b', '292'), op('c', '293', FUTURE_2), op('d', '294', FUTURE)];
    const flat = groupLane(lane(...ops)).flatMap(g => g.operations.map(o => o.operationKey)).sort();
    expect(flat).toEqual(['a', 'b', 'c', 'd']);
  });

  it("an empty lane yields no groups", () => {
    expect(groupLane({ iTariff: 66, operations: [] })).toEqual([]);
  });
});
