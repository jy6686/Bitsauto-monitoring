import { describe, it, expect } from 'vitest';
import { createPairBarrier, pairKey, type BarrierJob } from './pair-barrier';

const job = (jobId: string, clientId: string, productId: string, createdAt: number): BarrierJob =>
  ({ jobId, clientId, productId, createdAt });

describe('pairKey', () => {
  it('requires both ids', () => {
    expect(() => pairKey('', 'p1')).toThrow(/requires both ids/);
    expect(() => pairKey('c1', '')).toThrow(/requires both ids/);
  });

  it('cannot collide across a delimiter in either id', () => {
    expect(pairKey('a:b', 'c')).not.toBe(pairKey('a', 'b:c'));
  });

  it('is stable for the same pair', () => {
    expect(pairKey('c1', 'p1')).toBe(pairKey('c1', 'p1'));
  });
});

describe('the defect this exists to prevent', () => {
  it('a failed Monday change holds back Tuesday for the same (client, product)', () => {
    const b = createPairBarrier();
    const monday = job('j-mon', 'saif-voice', 'prod-1', 1_000);
    const tuesday = job('j-tue', 'saif-voice', 'prod-1', 2_000);

    expect(b.admit(monday)).toEqual({ run: true });
    b.record(monday, 'failed');

    const d = b.admit(tuesday);
    expect(d.run).toBe(false);
    expect(d).toMatchObject({ reason: 'PAIR_BLOCKED', blockedBy: 'j-mon' });
  });

  it('without the failure, Tuesday applies normally', () => {
    const b = createPairBarrier();
    const monday = job('j-mon', 'saif-voice', 'prod-1', 1_000);
    b.admit(monday);
    b.record(monday, 'succeeded');
    expect(b.admit(job('j-tue', 'saif-voice', 'prod-1', 2_000))).toEqual({ run: true });
  });
});

describe('the barrier is per pair, not per job and not per client', () => {
  it('another client is unaffected by this pair failing', () => {
    const b = createPairBarrier();
    const a = job('j-a', 'client-a', 'prod-1', 1_000);
    b.admit(a);
    b.record(a, 'failed');
    expect(b.admit(job('j-b', 'client-b', 'prod-1', 2_000))).toEqual({ run: true });
  });

  it('the same client on a different product is unaffected', () => {
    const b = createPairBarrier();
    const a = job('j-a', 'client-a', 'prod-1', 1_000);
    b.admit(a);
    b.record(a, 'failed');
    expect(b.admit(job('j-b', 'client-a', 'prod-2', 2_000))).toEqual({ run: true });
  });

  it('blocks every later job for the pair, not only the next one', () => {
    const b = createPairBarrier();
    const first = job('j-1', 'c', 'p', 1_000);
    b.admit(first);
    b.record(first, 'failed');
    for (const [id, t] of [['j-2', 2_000], ['j-3', 3_000], ['j-4', 4_000]] as const) {
      expect(b.admit(job(id, 'c', 'p', t)).run).toBe(false);
    }
  });

  it('names the earliest failure as the blocker, not the most recent', () => {
    const b = createPairBarrier();
    const first = job('j-1', 'c', 'p', 1_000);
    b.admit(first);
    b.record(first, 'failed');
    // a second failure on the pair cannot happen while blocked, but the recorded blocker must not drift
    expect(b.admit(job('j-2', 'c', 'p', 2_000))).toMatchObject({ blockedBy: 'j-1' });
    expect(b.blockedPairs()).toEqual([pairKey('c', 'p')]);
  });
});

describe('a blocked job is skipped, never failed', () => {
  it('refuses an outcome for a job it did not admit, so a skip cannot be recorded as a failure', () => {
    const b = createPairBarrier();
    const first = job('j-1', 'c', 'p', 1_000);
    b.admit(first);
    b.record(first, 'failed');

    const skipped = job('j-2', 'c', 'p', 2_000);
    expect(b.admit(skipped).run).toBe(false);
    expect(() => b.record(skipped, 'failed')).toThrow(/never admitted/);
    expect(() => b.record(skipped, 'succeeded')).toThrow(/never admitted/);
  });

  it('a skipped job does not itself block the pair any further', () => {
    const b = createPairBarrier();
    const first = job('j-1', 'c', 'p', 1_000);
    b.admit(first);
    b.record(first, 'failed');
    b.admit(job('j-2', 'c', 'p', 2_000));
    expect(b.blockedPairs()).toEqual([pairKey('c', 'p')]);
  });
});

describe('ordering is the callers responsibility and is enforced', () => {
  it('refuses a job that predates one already seen', () => {
    const b = createPairBarrier();
    b.admit(job('j-2', 'c', 'p', 2_000));
    expect(() => b.admit(job('j-1', 'c', 'p', 1_000))).toThrow(/creation order/);
  });

  it('allows equal timestamps, since creation order need only be non-decreasing', () => {
    const b = createPairBarrier();
    expect(b.admit(job('j-1', 'c', 'p1', 1_000)).run).toBe(true);
    expect(b.admit(job('j-2', 'c', 'p2', 1_000)).run).toBe(true);
  });

  it('refuses out-of-order input even across unrelated pairs', () => {
    const b = createPairBarrier();
    b.admit(job('j-1', 'client-a', 'p', 5_000));
    expect(() => b.admit(job('j-2', 'client-b', 'p', 4_000))).toThrow(/creation order/);
  });
});

describe('reporting', () => {
  it('starts with nothing blocked', () => {
    expect(createPairBarrier().blockedPairs()).toEqual([]);
  });

  it('lists each blocked pair once', () => {
    const b = createPairBarrier();
    const a = job('j-a', 'c1', 'p1', 1_000);
    const c = job('j-c', 'c2', 'p2', 2_000);
    b.admit(a); b.record(a, 'failed');
    b.admit(c); b.record(c, 'failed');
    expect(b.blockedPairs().sort()).toEqual([pairKey('c1', 'p1'), pairKey('c2', 'p2')].sort());
  });
});
