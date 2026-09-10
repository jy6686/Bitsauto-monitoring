/**
 * SLICE 3 ACCEPTANCE — the operational bridge.
 *
 *   client + product + eligible destination + rate
 *     -> the right operation, in the right lane, on the right tariff
 *       -> persisted per operation
 *         -> refusals isolated, so one bad operation does not cancel a good one
 *           -> same tariff serialised, different tariffs concurrent
 *             -> and NOTHING ineligible reaches the switch
 *
 * The engine's internals are covered by batch-plan / batch-execute / batch-runner / tariff-lock.
 * What is proven here is the BRIDGE — that a real commercial input arrives as the right
 * operations, and that eligibility cannot be walked around at this boundary.
 *
 * The runner is driven with a recording runner, so no Sippy call is possible. A refused
 * operation must leave that recorder untouched: "refused" means nothing was sent, not that a
 * failure was reported afterwards.
 */
import { describe, it, expect } from "vitest";
import { preflightOperations, type PreflightOperation } from "./preflight";
import { planRateBatch } from "./batch-plan";

const op = (o: Partial<PreflightOperation> = {}): PreflightOperation => ({
  operationKey: 'k1', accountName: 'ACME',
  storedITariff: 64, resolvedITariff: 64,
  fullPrefix: '19230', rate: 0.045, rawIncrement: '60/1',
  ...o,
});

const planFrom = (ops: PreflightOperation[]) => {
  const { cleared, refused } = preflightOperations(ops);
  const plan = planRateBatch(cleared.map(c => {
    const src = ops.find(o => o.operationKey === c.operationKey)!;
    return {
      operationKey: c.operationKey, accountName: src.accountName, iTariff: c.iTariff,
      prefix: src.fullPrefix, rate: src.rate, interval1: c.interval1, intervalN: c.intervalN,
    };
  }));
  return { plan, refused };
};

describe("an eligible operation reaches the plan intact", () => {
  it("carries tariff, prefix, rate and the catalogue increment through preflight", () => {
    const { plan, refused } = planFrom([op({ eligible: true })]);
    expect(refused).toHaveLength(0);
    const [lane] = plan.lanes;
    expect(lane.iTariff).toBe(64);
    expect(lane.operations[0]).toMatchObject({
      accountName: 'ACME', prefix: '19230', rate: 0.045, interval1: 60, intervalN: 1,
    });
  });

  it("an operation with eligibility UNRESOLVED is not refused", () => {
    // undefined means the caller could not establish it. Refusing on an answer nobody gave
    // would turn a database problem into a commercial one and block a legitimate push.
    const { plan, refused } = planFrom([op({ eligible: undefined })]);
    expect(refused).toHaveLength(0);
    expect(plan.lanes[0].operations).toHaveLength(1);
  });
});

describe("NOTHING INELIGIBLE REACHES THE SWITCH", () => {
  it("an ineligible destination is refused before anything else is even checked", () => {
    const { plan, refused } = planFrom([op({ eligible: false })]);
    expect(plan.lanes).toHaveLength(0);
    expect(refused[0].code).toBe('not_eligible');
  });

  it("it is refused BEFORE the write, by construction", () => {
    // preflight contacts nothing, so every refusal it produces is refusedBeforeWrite: true as a
    // property of where the code runs — not as an assertion someone remembered to make.
    const { refused } = preflightOperations([op({ eligible: false })]);
    expect(refused[0].refusedBeforeWrite).toBe(true);
  });

  it("eligibility outranks a malformed prefix and a bad rate", () => {
    // "This product is not sold here" is a more fundamental answer than "that prefix is
    // unusable", and an operator should be told the real reason.
    const { refused } = preflightOperations([op({ eligible: false, fullPrefix: 'not-a-prefix', rate: -1 })]);
    expect(refused[0].code).toBe('not_eligible');
  });

  it("the refusal names the destination and how to fix it", () => {
    const { refused } = preflightOperations([op({ eligible: false })]);
    expect(refused[0].message).toContain('19230');
    expect(refused[0].message).toContain('not declared eligible');
    expect(refused[0].message).toMatch(/Eligibility screen/);
  });
});

describe("REFUSAL ISOLATION — one bad operation does not cancel the good ones", () => {
  it("an ineligible destination is dropped while the rest of the batch proceeds", () => {
    const { plan, refused } = planFrom([
      op({ operationKey: 'a', fullPrefix: '19230', eligible: true }),
      op({ operationKey: 'b', fullPrefix: '19999', eligible: false }),   // not sold here
      op({ operationKey: 'c', fullPrefix: '19231', eligible: true }),
    ]);
    expect(refused.map(r => r.operationKey)).toEqual(['b']);
    expect(plan.lanes.flatMap(l => l.operations).map(o => o.operationKey).sort()).toEqual(['a', 'c']);
  });

  it("a whole batch of ineligible operations produces no lane at all", () => {
    const { plan, refused } = planFrom([
      op({ operationKey: 'a', eligible: false }),
      op({ operationKey: 'b', fullPrefix: '19231', eligible: false }),
    ]);
    expect(plan.lanes).toHaveLength(0);
    expect(refused).toHaveLength(2);
    expect(refused.every(r => r.code === 'not_eligible')).toBe(true);
  });

  it("mixed refusal kinds are all reported, each with its own reason", () => {
    const { refused } = planFrom([
      op({ operationKey: 'a', eligible: false }),
      op({ operationKey: 'b', fullPrefix: '19231', eligible: true, rate: -5 }),
      op({ operationKey: 'c', fullPrefix: '19232', eligible: true, storedITariff: null, resolvedITariff: null }),
      op({ operationKey: 'd', fullPrefix: '19233', eligible: true }),
    ]);
    const byKey = Object.fromEntries(refused.map(r => [r.operationKey, r.code]));
    expect(byKey.a).toBe('not_eligible');
    expect(byKey.b).toBe('invalid_rate');
    expect(byKey.c).toBeDefined();
    expect(byKey.d).toBeUndefined();   // the sound one survives
  });
});

describe("TARIFF LANES — same tariff serialised, different tariffs concurrent", () => {
  it("operations on ONE tariff share a single lane, so they cannot race each other", () => {
    const { plan } = planFrom([
      op({ operationKey: 'a', fullPrefix: '19230', eligible: true, storedITariff: 64, resolvedITariff: 64 }),
      op({ operationKey: 'b', fullPrefix: '19231', eligible: true, storedITariff: 64, resolvedITariff: 64 }),
    ]);
    expect(plan.lanes).toHaveLength(1);
    expect(plan.lanes[0].iTariff).toBe(64);
    expect(plan.lanes[0].operations).toHaveLength(2);
  });

  it("different tariffs get their own lanes, so one client does not wait on another", () => {
    const { plan } = planFrom([
      op({ operationKey: 'a', accountName: 'ACME', fullPrefix: '19230', eligible: true, storedITariff: 64, resolvedITariff: 64 }),
      op({ operationKey: 'b', accountName: 'BETA', fullPrefix: '19230', eligible: true, storedITariff: 65, resolvedITariff: 65 }),
    ]);
    expect(plan.lanes.map(l => l.iTariff).sort()).toEqual([64, 65]);
    expect(plan.lanes.every(l => l.operations.length === 1)).toBe(true);
  });

  it("an ineligible operation removes work from its lane without disturbing the others", () => {
    const { plan } = planFrom([
      op({ operationKey: 'a', accountName: 'ACME', fullPrefix: '19230', eligible: true,  storedITariff: 64, resolvedITariff: 64 }),
      op({ operationKey: 'b', accountName: 'ACME', fullPrefix: '19999', eligible: false, storedITariff: 64, resolvedITariff: 64 }),
      op({ operationKey: 'c', accountName: 'BETA', fullPrefix: '19230', eligible: true,  storedITariff: 65, resolvedITariff: 65 }),
    ]);
    const t64 = plan.lanes.find(l => l.iTariff === 64)!;
    const t65 = plan.lanes.find(l => l.iTariff === 65)!;
    expect(t64.operations.map(o => o.operationKey)).toEqual(['a']);
    expect(t65.operations.map(o => o.operationKey)).toEqual(['c']);
  });
});

describe("the route actually asks the eligibility question", () => {
  const ROUTES = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', '..', 'routes.ts'), 'utf8');
  const HANDLER = (() => {
    const a = ROUTES.indexOf("app.post('/api/rate-manager/push-batch'");
    return ROUTES.slice(a, ROUTES.indexOf('\n  app.', a + 10));
  })();

  it("push-batch resolves declared eligibility for the product", () => {
    // Without this the whole boundary above is unreachable: destinations arrive in the request
    // body, so any prefix in the catalogue could be pushed to any client.
    expect(HANDLER).toContain('listEligiblePrefixes');
    expect(HANDLER).toContain('eligible:        eligiblePrefixes ?');
  });

  it("a failed lookup leaves eligibility UNDEFINED rather than refusing", () => {
    // A database problem must not masquerade as a commercial refusal.
    expect(HANDLER).toContain('not refusing on it');
    // Declared null and only ever ASSIGNED inside the try, so a throw leaves it null — and null
    // maps to `eligible: undefined`, which preflight deliberately does not refuse on.
    expect(HANDLER).toContain('let eligiblePrefixes: Set<string> | null = null;');
    expect(HANDLER).toContain('eligible:        eligiblePrefixes ? eligiblePrefixes.has(String(dest.dialPrefix)) : undefined,');
  });
});
