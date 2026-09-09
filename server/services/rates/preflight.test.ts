/**
 * The gate before the primitive.
 *
 * The two load-bearing tests assert what the acceptance for this slice asks for: a tariff mismatch
 * and an unreadable catalogue increment must be settled without any Sippy call at all, and must be
 * reportable as `refusedBeforeWrite: true` so the executor treats them as proven non-events rather
 * than as possible mutations.
 *
 * They are asserted behaviourally — a spy stands in for the push, and the test fails if it is
 * called — because "exits before the probes" is a claim about control flow, not about wording.
 */
import { describe, it, expect, vi } from "vitest";
import { preflightOperation, preflightOperations, type PreflightOperation } from "./preflight";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const base: PreflightOperation = {
  operationKey: 'a', accountName: 'test-312',
  storedITariff: 65, resolvedITariff: 65,
  fullPrefix: '19370', rate: 0.133, rawIncrement: '60/1',
};
const op = (over: Partial<PreflightOperation> = {}): PreflightOperation => ({ ...base, ...over });

/** The composition the executor will use: only cleared operations reach the push. */
const runWithPush = async (ops: PreflightOperation[], push: (o: any) => Promise<any>) => {
  const { cleared, refused } = preflightOperations(ops);
  for (const c of cleared) await push(c);
  return { cleared, refused };
};

describe("ACCEPTANCE: deterministic refusals never reach a Sippy call", () => {
  it("a tariff mismatch exits before any push — no XML-RPC rate-write probe is issued", async () => {
    // Provisioning says 65, Sippy bills on 2. Writing would price a destination on somebody
    // else's tariff. Nothing about that needs a request to establish.
    const push = vi.fn(async () => ({ success: true }));
    const { cleared, refused } = await runWithPush([op({ storedITariff: 65, resolvedITariff: 2 })], push);

    expect(push).not.toHaveBeenCalled();
    expect(cleared).toHaveLength(0);
    expect(refused[0]).toMatchObject({ code: 'tariff_mismatch', refusedBeforeWrite: true });
    expect(refused[0].message).toContain('provisioned tariff is 65');
  });

  it("an unreadable catalogue increment exits before any mutation-capable call", async () => {
    const push = vi.fn(async () => ({ success: true }));
    const { refused } = await runWithPush([op({ rawIncrement: 'per minute' })], push);

    expect(push).not.toHaveBeenCalled();
    expect(refused[0]).toMatchObject({ code: 'increment_unreadable', refusedBeforeWrite: true });
    expect(refused[0].message).toContain('nobody chose');
  });

  it("EVERY refusal is refusedBeforeWrite: true — that is the point of deciding here", async () => {
    const { refused } = preflightOperations([
      op({ operationKey: 'a', resolvedITariff: null }),
      op({ operationKey: 'b', storedITariff: null }),
      op({ operationKey: 'c', resolvedITariff: 2 }),
      op({ operationKey: 'd', rawIncrement: '??' }),
      op({ operationKey: 'e', rate: Number.NaN }),
      op({ operationKey: 'f', fullPrefix: '' }),
    ]);
    expect(refused).toHaveLength(6);
    expect(refused.every(r => r.refusedBeforeWrite === true)).toBe(true);
    expect(refused.map(r => r.code)).toEqual([
      'unresolved_tariff', 'no_stored_tariff', 'tariff_mismatch',
      'increment_unreadable', 'invalid_rate', 'invalid_prefix',
    ]);
  });
});

describe("what passes, and what it hands on", () => {
  it("clears a sound operation and resolves its tariff and increment", () => {
    const d = preflightOperation(op());
    expect(d).toEqual({ ok: true, operationKey: 'a', iTariff: 65, interval1: 60, intervalN: 1 });
  });

  it("a prefix ABSENT from the catalogue is not a refusal — the tariff keeps its own increment", () => {
    // Matches what the push-batch route already does. Absent is not the same as unreadable, and
    // treating it as one would refuse every prefix the catalogue has yet to cover.
    for (const rawIncrement of [null, undefined, '']) {
      const d = preflightOperation(op({ rawIncrement }));
      expect(d.ok).toBe(true);
      expect(d).toMatchObject({ interval1: undefined, intervalN: undefined });
    }
  });

  it("accepts a zero rate, because a destination can legitimately be free", () => {
    expect(preflightOperation(op({ rate: 0 })).ok).toBe(true);
  });

  it("accepts the tariff as a string, which is how the route carries it", () => {
    expect(preflightOperation(op({ resolvedITariff: '65', storedITariff: 65 })).ok).toBe(true);
  });

  it("refuses a negative rate and a non-numeric prefix", () => {
    expect(preflightOperation(op({ rate: -0.01 }))).toMatchObject({ code: 'invalid_rate' });
    expect(preflightOperation(op({ fullPrefix: '193x0' }))).toMatchObject({ code: 'invalid_prefix' });
  });
});

describe("per operation, not per batch", () => {
  it("one misprovisioned account does not cancel the sound work beside it", async () => {
    // The route refuses the whole request on any integrity failure. A batch cannot afford that:
    // 500 good operations must not be lost to one bad account.
    const push = vi.fn(async () => ({ success: true }));
    const { cleared, refused } = await runWithPush([
      op({ operationKey: 'good1', accountName: 'aura',     storedITariff: 66, resolvedITariff: 66 }),
      op({ operationKey: 'bad',   accountName: 'pushtotalk', storedITariff: 33, resolvedITariff: 2 }),
      op({ operationKey: 'good2', accountName: 'test-312', storedITariff: 65, resolvedITariff: 65 }),
    ], push);

    expect(push).toHaveBeenCalledTimes(2);
    expect(cleared.map(c => c.operationKey)).toEqual(['good1', 'good2']);
    expect(refused.map(r => r.operationKey)).toEqual(['bad']);
  });

  it("CONSERVATION: every operation is either cleared or refused", () => {
    const ops = [op({ operationKey: '1' }), op({ operationKey: '2', resolvedITariff: null }), op({ operationKey: '3' })];
    const { cleared, refused } = preflightOperations(ops);
    expect(cleared.length + refused.length).toBe(ops.length);
  });

  it("handles an empty batch", () => {
    expect(preflightOperations([])).toEqual({ cleared: [], refused: [] });
  });
});

describe("the rules are not restated here", () => {
  it("defers to checkTariffIntegrity, so the two cannot drift apart", () => {
    // The message is the guard's own, verbatim — not a paraphrase maintained in two places.
    const d = preflightOperation(op({ accountName: 'aura', storedITariff: 66, resolvedITariff: 2 }));
    expect(d.ok).toBe(false);
    expect((d as any).message).toContain('aura: provisioned tariff is 66 but Sippy bills this account on 2');
  });

  it("defers to parseBillingIncrement for what a readable increment is", () => {
    expect(preflightOperation(op({ rawIncrement: '1/1' }))).toMatchObject({ interval1: 1, intervalN: 1 });
    expect(preflightOperation(op({ rawIncrement: '60/60' }))).toMatchObject({ interval1: 60, intervalN: 60 });
    expect(preflightOperation(op({ rawIncrement: '60 / 1' }))).toMatchObject({ interval1: 60, intervalN: 1 });
  });
});

describe("the push-batch route, after wiring", () => {
  // These replace the pair that pinned the pre-wiring ordering. They failed the moment the 409 was
  // removed, which is what they were for; the invariant has moved rather than disappeared.
  const SRC = readFileSync(join(__dirname, '..', '..', 'routes.ts'), 'utf8').split('\n');
  const lineOf = (needle: string, from = 0): number =>
    SRC.findIndex((l, i) => i >= from && l.includes(needle)) + 1;

  /** The push-batch handler's own line range, so nothing here reads a neighbouring route. */
  const handler = (() => {
    const start = lineOf("app.post('/api/rate-manager/push-batch'");
    const end   = lineOf('res.json({ results, ok, total, requestMs, sippyMs })', start);
    return { start, end, text: SRC.slice(start - 1, end).join('\n') };
  })();

  it("still resolves tariffs and increments, and records the job, before the engine runs", () => {
    const increments = lineOf('lookupCatalogueIncrements(db, destList.map', handler.start);
    const jobRow     = lineOf('await db.insert(ratePushJobs)', increments);
    const engine     = lineOf('await runRateBatch(', jobRow);

    expect(increments).toBeGreaterThan(handler.start);
    expect(jobRow).toBeGreaterThan(increments);
    // The parent row must exist before operations can hang off it by foreign key.
    expect(engine).toBeGreaterThan(jobRow);
    expect(engine).toBeLessThan(handler.end);
  });

  it("no longer refuses the whole request on a tariff-integrity failure", () => {
    // A misprovisioned account is now one refused operation, not a cancelled batch. The request
    // itself is well formed, so it is not a request-level HTTP failure.
    expect(handler.text).not.toContain('res.status(409)');
    expect(handler.text).toContain('will be refused per-operation');
  });

  it("keeps request-level failures at the request boundary", () => {
    // Malformed input and an unrecordable batch are still 4xx/5xx: those cannot be expressed as an
    // operation outcome because there is no well-formed batch to attribute them to.
    expect(handler.text).toContain("res.status(400).json({ error: 'accountNames array required' })");
    expect(handler.text).toContain('Refusing to run it unrecorded.');
  });

  it("hands the engine the RAW catalogue increment, so preflight owns readability", () => {
    expect(handler.text).toContain('rawIncrement:    catalogueIncrements.get(dest.dialPrefix)');
  });

  it("takes the parent status from the derived summary, not from a counter", () => {
    expect(handler.text).toContain('status:             runOutcome.summary.status');
  });

  it("preserves the response contract the client reads", () => {
    expect(handler.text).toContain('res.json({ results, ok, total, requestMs, sippyMs })');
  });
});
