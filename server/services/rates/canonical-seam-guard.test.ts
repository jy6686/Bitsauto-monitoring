import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { findSeamBypasses, holdsCanonicalSeam, MUTATION_PRIMITIVES } from './canonical-seam-guard';

const SRC = readFileSync('server/routes.ts', 'utf8');

/** Body of the handler registered at `path`, by brace matching — the same technique the audit used. */
function handler(path: string): string {
  const i = SRC.indexOf(`app.post('${path}'`);
  expect(i, `route ${path} not found`).toBeGreaterThan(-1);
  const start = SRC.indexOf('{', i);
  let depth = 0;
  for (let k = start; k < SRC.length; k++) {
    if (SRC[k] === '{') depth++;
    else if (SRC[k] === '}') { depth--; if (depth === 0) return SRC.slice(i, k + 1); }
  }
  throw new Error(`unbalanced handler for ${path}`);
}

const CANONICAL = `
  app.post('/x', async (req, res) => {
    const pushFor = (jobId) => async (op) => {
      const r = await sippy.pushRateToSippy({ prefix: op.prefix }, creds);
      return r;
    };
    const out = await runRateBatch({ db, push: pushFor(jobId), lock }, { jobId, operations });
  });`;

const BYPASSING = `
  app.post('/y', async (req, res) => {
    for (const prefix of prefixes) {
      const r = await sippy.setSippyRateEntry({ prefix }, creds);
    }
  });`;

const HALF = `
  app.post('/z', async (req, res) => {
    const pushFor = (jobId) => async (op) => await sippy.pushRateToSippy(op, creds);
    const out = await runRateBatch({ db, push: pushFor(jobId), lock }, { jobId, operations });
    await sippy.setSippyRateEntry({ prefix: 'sneaky' }, creds);
  });`;

describe('the guard discriminates, which is what makes its negatives worth anything', () => {
  it('passes a handler that injects the primitive into the seam', () => {
    expect(findSeamBypasses(CANONICAL)).toEqual([]);
    expect(holdsCanonicalSeam(CANONICAL)).toBe(true);
  });

  it('fails a handler that calls the primitive in its own loop', () => {
    const f = findSeamBypasses(BYPASSING);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ kind: 'NO_CANONICAL_SEAM' });
    expect(holdsCanonicalSeam(BYPASSING)).toBe(false);
  });

  it('catches a direct call sitting BESIDE a correct injected one', () => {
    const f = findSeamBypasses(HALF);
    expect(holdsCanonicalSeam(HALF)).toBe(false);
    expect(f.some(x => x.kind === 'DIRECT_MUTATION' && x.primitive === 'setSippyRateEntry')).toBe(true);
    expect(f.some(x => x.kind === 'DIRECT_MUTATION' && x.primitive === 'pushRateToSippy')).toBe(false);
  });

  it('is silent about a handler that mutates nothing', () => {
    expect(findSeamBypasses(`app.post('/r', async () => { const x = await sippy.getSippyRateList(); });`)).toEqual([]);
  });

  it('names every primitive it guards', () => {
    expect(MUTATION_PRIMITIVES).toContain('pushRateToSippy');
    expect(MUTATION_PRIMITIVES).toContain('setSippyRateEntry');
  });
});

describe('the real handlers, as they stand today', () => {
  it('push-batch HOLDS the invariant — it injects pushFor into runRateBatch', () => {
    expect(findSeamBypasses(handler('/api/rate-manager/push-batch'))).toEqual([]);
  });

  /**
   * The Item 4 acceptance test, recorded in the state the code is actually in.
   * `change-client-rates` bypasses the seam TODAY. When Item 4 is wired this expectation
   * inverts — and that inversion is the proof the item landed.
   */
  it('change-client-rates does NOT hold it yet — this flips when Item 4 is wired', () => {
    const f = findSeamBypasses(handler('/api/rate-manager/change-client-rates'));
    expect(f.length).toBeGreaterThan(0);
    expect(f[0]).toMatchObject({ kind: 'NO_CANONICAL_SEAM' });
    if (f[0].kind === 'NO_CANONICAL_SEAM') {
      expect(f[0].primitives).toContain('setSippyRateEntry');
      expect(f[0].primitives).toContain('pushRateToSippy');
    }
  });

  it('and the reason is specific: it never calls runRateBatch at all', () => {
    expect(handler('/api/rate-manager/change-client-rates')).not.toContain('runRateBatch');
    expect(handler('/api/rate-manager/push-batch')).toContain('runRateBatch');
  });
});
