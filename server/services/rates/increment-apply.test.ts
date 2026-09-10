/**
 * Applying a billing-increment change on its effective date.
 *
 * THE DANGEROUS CASES ARE FIRST, deliberately: not-yet-effective, cancelled, already applied,
 * tariff mismatch, a busy tariff, a write that throws, a read-back that disagrees. The happy path
 * is last, because it is the one that would pass even if none of the guards existed.
 *
 * No Sippy is reachable: every dependency is injected, and the recorder proves whether a write
 * was attempted at all. "Refused" means the recorder is empty — not that a failure was reported.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { applyIncrementChange, type ApplyDeps, type ApplyOutcome } from "./increment-apply";
import { createInMemoryTariffLock } from "./tariff-lock";
import type { IncrementChange } from "./increment-change";

const EFFECTIVE = '2026-09-20';
const change = (o: Partial<IncrementChange> = {}): IncrementChange => ({
  id: 7, productId: 1, destinationId: 10, catalogueVersionId: 1,
  previousIncrement: '60/1', newIncrement: '30/6',
  effectiveDate: EFFECTIVE, status: 'notified', ...o,
});

/** Everything the mutation was asked to do. Must stay EMPTY for every refusal. */
let writes: Array<{ iTariff: number; prefixes: string[]; interval1: number; intervalN: number }>;
let recorded: ApplyOutcome[];
let held: Map<string, { interval1: number; intervalN: number } | null>;

const deps = (over: Partial<ApplyDeps> = {}): ApplyDeps => ({
  prefixesFor: async () => ['9230', '9231', '9232'],
  tariffFor: async () => ({ accountName: 'ACME', storedITariff: 64, resolvedITariff: 64 }),
  lock: createInMemoryTariffLock(),
  writeIncrement: async (i) => { writes.push(i); return { sent: true, message: 'ok' }; },
  readBack: async () => held,
  record: async (_id, o) => { recorded.push(o); },
  lockOptions: { timeoutMs: 0, pollMs: 1 },
  ...over,
});

beforeEach(() => {
  writes = [];
  recorded = [];
  held = new Map([
    ['9230', { interval1: 30, intervalN: 6 }],
    ['9231', { interval1: 30, intervalN: 6 }],
    ['9232', { interval1: 30, intervalN: 6 }],
  ]);
});

describe("DANGEROUS — nothing may be sent early or twice", () => {
  it("refuses BEFORE the effective date, and sends nothing", async () => {
    const r = await applyIncrementChange(deps(), change(), '2026-09-19');
    expect(r.verdict).toBe('refused');
    if (r.verdict === 'refused') expect(r.code).toBe('not_yet_effective');
    expect(writes).toEqual([]);           // the property, not the status code
    expect(r.refusedBeforeWrite).toBe(true);
  });

  it("applies ON the effective date", async () => {
    const r = await applyIncrementChange(deps(), change(), EFFECTIVE);
    expect(r.verdict).toBe('applied');
    expect(writes).toHaveLength(1);
  });

  it("refuses a CANCELLED change however overdue it is", async () => {
    const r = await applyIncrementChange(deps(), change({ status: 'cancelled' }), '2026-12-01');
    expect(r.verdict).toBe('refused');
    if (r.verdict === 'refused') expect(r.code).toBe('cancelled');
    expect(writes).toEqual([]);
  });

  it("refuses an ALREADY APPLIED change — no second write of a proven result", async () => {
    const r = await applyIncrementChange(deps(), change({ status: 'applied' }), '2026-12-01');
    expect(r.verdict).toBe('refused');
    if (r.verdict === 'refused') expect(r.code).toBe('already_applied');
    expect(writes).toEqual([]);
  });

  it("refuses a previously FAILED change rather than blindly retrying it", async () => {
    const r = await applyIncrementChange(deps(), change({ status: 'failed' }), '2026-12-01');
    expect(r.verdict).toBe('refused');
    expect(writes).toEqual([]);
  });
});

describe("DANGEROUS — the tariff must be the right one, and ours alone", () => {
  it("refuses when stored and resolved tariffs disagree", async () => {
    // A rate landing on a tariff the customer does not bill on — or one others do.
    const r = await applyIncrementChange(
      deps({ tariffFor: async () => ({ accountName: 'ACME', storedITariff: 64, resolvedITariff: 65 }) }),
      change(), EFFECTIVE);
    expect(r.verdict).toBe('refused');
    if (r.verdict === 'refused') expect(r.code).toBe('tariff_integrity');
    expect(writes).toEqual([]);
  });

  it("refuses when the tariff cannot be resolved at all", async () => {
    const r = await applyIncrementChange(
      deps({ tariffFor: async () => ({ accountName: 'ACME', storedITariff: null, resolvedITariff: null }) }),
      change(), EFFECTIVE);
    expect(r.verdict).toBe('refused');
    expect(writes).toEqual([]);
  });

  it("integrity is re-checked HERE, not trusted from when the change was scheduled", async () => {
    // The billing plan moved between the promise and the day it fell due.
    let asked = 0;
    await applyIncrementChange(
      deps({ tariffFor: async () => { asked++; return { accountName: 'ACME', storedITariff: 64, resolvedITariff: 64 }; } }),
      change(), EFFECTIVE);
    expect(asked).toBe(1);
  });

  it("refuses when another mutation holds the tariff — and sends nothing", async () => {
    const lock = createInMemoryTariffLock();
    const holder = await lock.tryAcquire(64);       // a concurrent rate push
    expect(holder).not.toBeNull();
    const r = await applyIncrementChange(deps({ lock }), change(), EFFECTIVE);
    expect(r.verdict).toBe('refused');
    if (r.verdict === 'refused') expect(r.code).toBe('lock_unavailable');
    expect(writes).toEqual([]);
    await holder!();
  });

  it("releases the tariff afterwards, so it does not wedge", async () => {
    const lock = createInMemoryTariffLock();
    await applyIncrementChange(deps({ lock }), change(), EFFECTIVE);
    const after = await lock.tryAcquire(64);
    expect(after).not.toBeNull();
    await after!();
  });
});

describe("DANGEROUS — an unproven result is never 'applied'", () => {
  it("a write that THROWS is needs_review, not a retryable failure", async () => {
    // A request that times out has still left the process.
    const r = await applyIncrementChange(
      deps({ writeIncrement: async () => { throw new Error('socket hang up'); } }),
      change(), EFFECTIVE);
    expect(r.verdict).toBe('needs_review');
    expect(r.refusedBeforeWrite).toBe(false);
    expect(r.message).toMatch(/may have reached/i);
  });

  it("a read-back that FAILS is needs_review — the tariff state is unknown", async () => {
    const r = await applyIncrementChange(
      deps({ readBack: async () => { throw new Error('rpc down'); } }),
      change(), EFFECTIVE);
    expect(r.verdict).toBe('needs_review');
    expect(r.message).toMatch(/unknown/i);
  });

  it("a read-back showing the WRONG increment is needs_review, not success", async () => {
    held.set('9231', { interval1: 60, intervalN: 1 });
    const r = await applyIncrementChange(deps(), change(), EFFECTIVE);
    expect(r.verdict).toBe('needs_review');
    expect(r.message).toContain('9231=60/1');
    // And it names what clients were promised, which is the actual problem.
    expect(r.message).toContain(EFFECTIVE);
  });

  it("a PARTIAL read-back is needs_review — silence is not proof", async () => {
    held.set('9232', null);
    const r = await applyIncrementChange(deps(), change(), EFFECTIVE);
    expect(r.verdict).toBe('needs_review');
    expect(r.message).toMatch(/could not be read back/i);
  });

  it("a missing prefix in the read-back is not treated as verified", async () => {
    held.delete('9232');
    const r = await applyIncrementChange(deps(), change(), EFFECTIVE);
    expect(r.verdict).toBe('needs_review');
  });

  it("a write that reports it was NOT sent is a clean refusal", async () => {
    const r = await applyIncrementChange(
      deps({ writeIncrement: async () => ({ sent: false, message: 'refused locally' }) }),
      change(), EFFECTIVE);
    expect(r.verdict).toBe('refused');
    expect(r.refusedBeforeWrite).toBe(true);
  });
});

describe("the commitment is the source, never a fresh supplier read", () => {
  it("sends the increment recorded on the CHANGE", async () => {
    await applyIncrementChange(deps(), change({ newIncrement: '15/1' }), EFFECTIVE);
    // A vendor file landing in between must not redirect what is applied.
    expect(writes[0]).toMatchObject({ interval1: 15, intervalN: 1 });
  });

  it("refuses an unreadable recorded increment rather than defaulting to 1/1", async () => {
    const r = await applyIncrementChange(deps(), change({ newIncrement: 'garbage' }), EFFECTIVE);
    expect(r.verdict).toBe('refused');
    if (r.verdict === 'refused') expect(r.code).toBe('unreadable_increment');
    expect(writes).toEqual([]);
  });

  it("refuses when the destination has no prefixes — the change would reach nothing", async () => {
    const r = await applyIncrementChange(deps({ prefixesFor: async () => [] }), change(), EFFECTIVE);
    expect(r.verdict).toBe('refused');
    expect(writes).toEqual([]);
  });
});

describe("SUCCESS — proven, then recorded", () => {
  it("writes every prefix once, at the promised increment, on the right tariff", async () => {
    const r = await applyIncrementChange(deps(), change(), EFFECTIVE);
    expect(r.verdict).toBe('applied');
    expect(writes).toEqual([{ iTariff: 64, prefixes: ['9230', '9231', '9232'], interval1: 30, intervalN: 6 }]);
    if (r.verdict === 'applied') {
      expect(r.increment).toBe('30/6');
      expect(r.prefixesVerified).toBe(3);
    }
  });

  it("every outcome is recorded, including refusals", async () => {
    // A refusal nobody recorded is indistinguishable from a run that never happened.
    await applyIncrementChange(deps(), change(), '2026-09-19');
    await applyIncrementChange(deps(), change(), EFFECTIVE);
    expect(recorded.map(o => o.verdict)).toEqual(['refused', 'applied']);
  });

  it("applied is only reached after the read-back agrees on EVERY prefix", async () => {
    const order: string[] = [];
    const r = await applyIncrementChange(deps({
      writeIncrement: async (i) => { order.push('write'); writes.push(i); return { sent: true, message: 'ok' }; },
      readBack: async () => { order.push('readback'); return held; },
      record: async (_id, o) => { order.push(`record:${o.verdict}`); recorded.push(o); },
    }), change(), EFFECTIVE);
    expect(r.verdict).toBe('applied');
    expect(order).toEqual(['write', 'readback', 'record:applied']);
  });
});
