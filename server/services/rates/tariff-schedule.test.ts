/**
 * One active job per tariff; `concurrency` tariffs at once.
 *
 * These assert OVERLAP, not just ordering — the regression they exist to prevent is two accounts
 * sharing a tariff both becoming active, which the advisory lock would turn into a timeout rather
 * than the orderly wait the planner gives today. The runner is controlled by hand so overlap is
 * observed rather than inferred from timing.
 */
import { describe, it, expect } from 'vitest';
import { runTariffExclusive, type TariffJob } from './tariff-schedule';

/** A runner whose every call can be resolved individually, so interleaving is deterministic. */
function controllable() {
  const active = new Set<string>();
  const everActive: string[][] = [];
  const gates = new Map<string, () => void>();
  const started: string[] = [];

  const run = (name: string) => new Promise<string>(resolve => {
    started.push(name);
    active.add(name);
    everActive.push([...active]);
    gates.set(name, () => { active.delete(name); resolve(name); });
  });

  return {
    run, started, everActive,
    finish: async (name: string) => { gates.get(name)?.(); await Promise.resolve(); await Promise.resolve(); },
    maxActive: () => everActive.reduce((m, s) => Math.max(m, s.length), 0),
    /** Was this pair of names ever simultaneously active? */
    overlapped: (a: string, b: string) => everActive.some(s => s.includes(a) && s.includes(b)),
  };
}

const j = (iTariff: number | null, name: string): TariffJob<string> => ({ iTariff, job: name });

describe('one active job per tariff', () => {
  /** THE REGRESSION. Two accounts on tariff 68 must never both be in flight. */
  it('never runs two jobs on the same tariff at once', async () => {
    const c = controllable();
    const p = runTariffExclusive([j(68, 'aura'), j(68, 'test-31')], { concurrency: 4, run: c.run });

    await Promise.resolve();
    expect(c.started).toEqual(['aura']);          // the second waits its turn
    await c.finish('aura');
    expect(c.started).toEqual(['aura', 'test-31']);
    await c.finish('test-31');

    await p;
    expect(c.overlapped('aura', 'test-31')).toBe(false);
    expect(c.maxActive()).toBe(1);
  });

  it('runs different tariffs together', async () => {
    const c = controllable();
    const p = runTariffExclusive([j(68, 'aura'), j(64, 'test-31')], { concurrency: 4, run: c.run });

    await Promise.resolve();
    expect(c.started.sort()).toEqual(['aura', 'test-31']);
    expect(c.overlapped('aura', 'test-31')).toBe(true);
    await c.finish('aura'); await c.finish('test-31');
    await p;
  });

  /**
   * THE ACCEPTANCE CASE for the whole split: two accounts sharing a tariff plus a third on its
   * own. The two must never overlap each other; the third is free to overlap either. Asserted
   * together rather than as two separate cases, because the failure mode is a scheduler that
   * gets each rule right in isolation and still lets A and B run while C is pending.
   */
  it('A and B on one tariff never overlap, while C on another may overlap either', async () => {
    const c = controllable();
    const p = runTariffExclusive(
      [j(68, 'A'), j(68, 'B'), j(64, 'C')], { concurrency: 4, run: c.run });

    await Promise.resolve();
    expect(c.started.sort()).toEqual(['A', 'C']);        // B waits for A; C is independent
    expect(c.overlapped('A', 'C')).toBe(true);

    await c.finish('A');
    expect(c.started.sort()).toEqual(['A', 'B', 'C']);
    expect(c.overlapped('B', 'C')).toBe(true);

    await c.finish('B'); await c.finish('C');
    await p;

    expect(c.overlapped('A', 'B')).toBe(false);          // the property being protected
    expect(c.maxActive()).toBe(2);                       // two tariffs, never three jobs
  });

  /** An unresolved tariff writes nothing, so those jobs cannot collide and must not serialise. */
  it('does not serialise jobs whose tariff never resolved', async () => {
    const c = controllable();
    const p = runTariffExclusive([j(null, 'a'), j(null, 'b')], { concurrency: 4, run: c.run });

    await Promise.resolve();
    expect(c.overlapped('a', 'b')).toBe(true);
    await c.finish('a'); await c.finish('b');
    await p;
  });
});

describe('the concurrency envelope', () => {
  /** `concurrency` counts TARIFFS, exactly as batch-plan counts lanes one level down. */
  it('never exceeds the configured number of simultaneous tariffs', async () => {
    const c = controllable();
    const p = runTariffExclusive(
      [j(1, 'a'), j(2, 'b'), j(3, 'c'), j(4, 'd')], { concurrency: 2, run: c.run });

    await Promise.resolve();
    expect(c.maxActive()).toBe(2);
    for (const n of ['a', 'b']) await c.finish(n);
    for (const n of ['c', 'd']) await c.finish(n);
    await p;
    expect(c.maxActive()).toBe(2);
  });

  it('is clamped to at least one, whatever it is given', async () => {
    for (const concurrency of [0, -3, NaN]) {
      const c = controllable();
      const p = runTariffExclusive([j(1, 'a')], { concurrency, run: c.run });
      await Promise.resolve();
      expect(c.started).toEqual(['a']);
      await c.finish('a');
      await p;
    }
  });

  it('never starts more workers than there are tariffs', async () => {
    const c = controllable();
    const p = runTariffExclusive([j(9, 'only')], { concurrency: 8, run: c.run });
    await Promise.resolve();
    expect(c.maxActive()).toBe(1);
    await c.finish('only');
    await p;
  });
});

describe('results', () => {
  it('come back in submitted order, not completion order', async () => {
    const order: string[] = [];
    const out = await runTariffExclusive(
      [j(1, 'first'), j(2, 'second')],
      { concurrency: 2, run: async (n) => { if (n === 'first') await new Promise(r => setTimeout(r, 5)); order.push(n); return n; } });

    expect(order).toEqual(['second', 'first']);          // completion order
    expect(out.map(r => (r.ok ? r.value : null))).toEqual(['first', 'second']);
  });

  it('is empty for an empty submission', async () => {
    expect(await runTariffExclusive([], { concurrency: 3, run: async () => 1 })).toEqual([]);
  });
});

describe('failure isolation', () => {
  /** Mirrors batch-execute: "this lane stops; other lanes are unaffected". */
  it('a throw stops only its own tariff', async () => {
    const out = await runTariffExclusive(
      [j(68, 'boom'), j(68, 'after'), j(64, 'other')],
      { concurrency: 3, run: async (n) => { if (n === 'boom') throw new Error('sippy refused'); return n; } });

    expect(out[0]).toMatchObject({ ok: false, skipped: false, error: 'sippy refused' });
    expect(out[1]).toMatchObject({ ok: false, skipped: true });
    expect(out[2]).toMatchObject({ ok: true, value: 'other' });
  });

  /** An account never attempted must SAY so — read as success, an absence misleads. */
  it('names a skipped job rather than omitting it', async () => {
    const out = await runTariffExclusive(
      [j(5, 'boom'), j(5, 'skipped')],
      { concurrency: 2, run: async (n) => { if (n === 'boom') throw new Error('nope'); return n; } });

    expect(out).toHaveLength(2);
    expect(out[1].ok).toBe(false);
    expect((out[1] as any).skipped).toBe(true);
    expect((out[1] as any).error).toMatch(/not attempted/i);
  });

  it('keeps running later chains after an earlier one fails', async () => {
    const out = await runTariffExclusive(
      [j(1, 'boom'), j(2, 'b'), j(3, 'c')],
      { concurrency: 1, run: async (n) => { if (n === 'boom') throw new Error('x'); return n; } });

    expect(out.map(r => r.ok)).toEqual([false, true, true]);
  });
});
