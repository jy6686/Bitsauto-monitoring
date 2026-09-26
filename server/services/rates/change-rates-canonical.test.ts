import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { changeClientRatesCanonical, type ChangeRatesDeps, type ChangeRatesRequest } from './change-rates-canonical';
import { findSeamBypasses, holdsCanonicalSeam } from './canonical-seam-guard';
import type { BatchRunOutcome } from './batch-runner';

const outcome = (ok = 1, total = 1): BatchRunOutcome => ({
  jobId: 'job-1', results: [], ok, total,
  summary: {} as any, tariffsNeedingReview: [], haltedLanes: [],
});

const req = (o: Partial<ChangeRatesRequest> = {}): ChangeRatesRequest => ({
  jobId: 'job-1', accountName: 'aura', iTariff: 66, prefixes: ['9370'], rate: 0.025, ...o,
});

const deps = (o: Partial<ChangeRatesDeps> = {}): ChangeRatesDeps => ({
  batch: { db: {} as any, push: (async () => ({})) as any },
  runBatch: vi.fn(async () => outcome()),
  resolveTariff: async () => ({ storedITariff: 66, resolvedITariff: 66 }),
  ...o,
});

describe('THE acceptance test: this module cannot bypass the seam', () => {
  const SRC = readFileSync('server/services/rates/change-rates-canonical.ts', 'utf8');
  /**
   * Comments stripped: the header quotes the old handler's `for (const [opIdx, prefix] ...)` loop
   * and names the primitives it replaces, so a check against raw source matches the PROSE that
   * documents the defect rather than any code. The invariant is about what executes.
   */
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('holds the canonical-seam invariant, checked mechanically against its own source', () => {
    expect(findSeamBypasses(CODE)).toEqual([]);
    expect(holdsCanonicalSeam(CODE)).toBe(true);
  });

  it('never names a mutation primitive at all — the transport is injected', () => {
    expect(CODE).not.toMatch(/\bsetSippyRateEntry\s*\(/);
    expect(CODE).not.toMatch(/\bpushRateToSippy\s*\(/);
  });

  it('has no per-prefix write loop of its own', () => {
    expect(CODE).not.toMatch(/for\s*\(\s*const\s*\[\s*\w+\s*,\s*prefix/);
  });

  /**
   * The hole the blind-guard found. `findSeamBypasses` matches primitives BY NAME, so invoking the
   * injected transport — `deps.batch.push(op)` — bypasses the tariff lock while naming nothing the
   * guard can see. Only `runRateBatch` may call the transport; this module must never touch it.
   */
  it('never invokes the injected transport itself — only the engine may', async () => {
    const push = vi.fn(async () => ({ success: true }) as any);
    const runBatch = vi.fn(async () => outcome());
    await changeClientRatesCanonical(
      deps({ runBatch, batch: { db: {} as any, push } }), req({ prefixes: ['9370', '9371'] }));
    expect(push).not.toHaveBeenCalled();
  });

  it('nor the bulk transport', async () => {
    const pushGroup = vi.fn(async () => [] as any);
    const runBatch = vi.fn(async () => outcome());
    await changeClientRatesCanonical(
      deps({ runBatch, batch: { db: {} as any, push: (async () => ({})) as any, pushGroup } }), req());
    expect(pushGroup).not.toHaveBeenCalled();
  });

  it('contains no loop over the built operations at all', () => {
    expect(CODE).not.toMatch(/for\s*\([^)]*built\.operations/);
    expect(CODE).not.toMatch(/built\.operations\s*\.\s*(map|forEach)\s*\(/);
  });

  it('does not import stage-failure — that wiring is a separate decision', () => {
    expect(CODE).not.toContain("from './stage-failure'");
  });
});

describe('every mutation goes through runRateBatch', () => {
  it('calls the seam exactly once, with the adapted operations', async () => {
    const runBatch = vi.fn(async () => outcome());
    const r = await changeClientRatesCanonical(deps({ runBatch }), req({ prefixes: ['9370', '9371'] }));
    expect(r.ok).toBe(true);
    expect(runBatch).toHaveBeenCalledTimes(1);
    const input = runBatch.mock.calls[0][1];
    expect(input.operations.map((o: any) => o.fullPrefix)).toEqual(['9370', '9371']);
    expect(input.jobId).toBe('job-1');
  });

  it('passes the transport and the lock through untouched, so the engine keeps its guarantees', async () => {
    const lock = {} as any, push = (async () => ({})) as any;
    const runBatch = vi.fn(async () => outcome());
    await changeClientRatesCanonical(
      deps({ runBatch, batch: { db: {} as any, push, lock } }), req());
    expect(runBatch.mock.calls[0][0]).toMatchObject({ push, lock });
  });

  it('does not reach the seam at all when the adapter refuses', async () => {
    const runBatch = vi.fn(async () => outcome());
    const r = await changeClientRatesCanonical(deps({ runBatch }), req({ prefixes: [] }));
    expect(r).toMatchObject({ ok: false, refusal: { reason: 'NO_PREFIXES' } });
    expect(runBatch).not.toHaveBeenCalled();
  });
});

describe('the tariff is resolved by the server, never taken from the request', () => {
  it('refuses when the request claims a different tariff than the server resolved', async () => {
    const runBatch = vi.fn(async () => outcome());
    const r = await changeClientRatesCanonical(
      deps({ runBatch, resolveTariff: async () => ({ storedITariff: 66, resolvedITariff: 66 }) }),
      req({ iTariff: 64 }));
    expect(r).toMatchObject({ ok: false, refusal: { reason: 'TARIFF_CLAIM_MISMATCH' } });
    expect(runBatch).not.toHaveBeenCalled();
  });

  it('refuses when the server resolved nothing', async () => {
    const r = await changeClientRatesCanonical(
      deps({ resolveTariff: async () => ({ storedITariff: null, resolvedITariff: null }) }), req());
    expect(r).toMatchObject({ ok: false, refusal: { reason: 'NO_RESOLVED_TARIFF' } });
  });

  it('sends the resolved value to the engine, not the claim', async () => {
    const runBatch = vi.fn(async () => outcome());
    await changeClientRatesCanonical(
      deps({ runBatch, resolveTariff: async () => ({ storedITariff: 66, resolvedITariff: '66' }) }),
      req({ iTariff: null }));
    expect(runBatch.mock.calls[0][1].operations[0]).toMatchObject({ resolvedITariff: '66' });
  });
});

describe('eligibility applies to this entry point too', () => {
  it('marks operations from the eligibility set', async () => {
    const runBatch = vi.fn(async () => outcome());
    await changeClientRatesCanonical(
      deps({ runBatch, listEligiblePrefixes: async () => new Set(['9370']) }),
      req({ prefixes: ['9370', '8801'], productId: 7 }));
    const ops = runBatch.mock.calls[0][1].operations as any[];
    expect(ops[0].eligible).toBe(true);
    expect(ops[1].eligible).toBe(false);
  });

  it('a failed lookup leaves eligibility UNDEFINED rather than false', async () => {
    const runBatch = vi.fn(async () => outcome());
    await changeClientRatesCanonical(
      deps({ runBatch, listEligiblePrefixes: async () => { throw new Error('db down'); } }),
      req({ productId: 7 }));
    expect('eligible' in (runBatch.mock.calls[0][1].operations[0] as any)).toBe(false);
  });

  it('skips the lookup entirely with no productId, rather than guessing one', async () => {
    const listEligiblePrefixes = vi.fn(async () => new Set<string>());
    await changeClientRatesCanonical(deps({ listEligiblePrefixes }), req({ productId: null }));
    expect(listEligiblePrefixes).not.toHaveBeenCalled();
  });
});

describe('the obligation is recorded after execution and cannot fail the push', () => {
  it('records it, and reports that it did', async () => {
    const createObligations = vi.fn(async () => ({ created: 1 }));
    const r = await changeClientRatesCanonical(deps({ createObligations }), req());
    expect(createObligations).toHaveBeenCalledWith('job-1', expect.any(Array));
    expect(r).toMatchObject({ ok: true, obligationRecorded: true });
  });

  it('a mutated push still succeeds when the obligation write throws', async () => {
    const onObligationError = vi.fn();
    const r = await changeClientRatesCanonical(
      deps({ createObligations: async () => { throw new Error('neon timeout'); }, onObligationError }),
      req());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.obligationRecorded).toBe(false);
    expect(onObligationError).toHaveBeenCalled();
  });

  it('runs the obligation AFTER the seam, never before', async () => {
    const order: string[] = [];
    await changeClientRatesCanonical(deps({
      runBatch: async () => { order.push('batch'); return outcome(); },
      createObligations: async () => { order.push('obligation'); },
    }), req());
    expect(order).toEqual(['batch', 'obligation']);
  });
});

describe('a failure cannot read as a successful completion', () => {
  it('reports the engine outcome verbatim, including a zero-success batch', async () => {
    const r = await changeClientRatesCanonical(deps({ runBatch: async () => outcome(0, 2) }), req({ prefixes: ['9370', '9371'] }));
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.outcome.ok).toBe(0); expect(r.outcome.total).toBe(2); }
  });

  it('propagates a thrown engine error rather than reporting success', async () => {
    await expect(changeClientRatesCanonical(
      deps({ runBatch: async () => { throw new Error('lock provider gone'); } }), req()))
      .rejects.toThrow(/lock provider gone/);
  });

  it('a refusal is never shaped like a success', async () => {
    const r = await changeClientRatesCanonical(deps(), req({ rate: NaN }));
    expect(r.ok).toBe(false);
    expect('outcome' in r).toBe(false);
  });
});
