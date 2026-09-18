/**
 * The change-client-rates route records its position while it pushes — asserted against source.
 *
 * `setSippyRateEntry` has reported every real phase boundary through an optional `onProgress`
 * for as long as the step() reporter has existed, and push-batch has always listened, writing
 * lastStep/lastStepAt to the job row. This route passed six arguments and stopped: the client
 * emitted every step and nothing caught them. A row from this route therefore held NOTHING
 * between its insert and its terminal update — no startedAt, no lastStep, lastStepAt NULL — so
 * a process death mid-push left a row that could not say whether Sippy had been reached.
 *
 * That matters twice. Once for the operator, who otherwise reconstructs the push from logs.
 * Once for boot-time reconciliation, which needs `lastStepAt` staleness to tell an orphaned
 * job from one a sibling instance is still running, and needs 'uploading' persisted BEFORE the
 * mutation-capable request to know whether the boundary was crossed.
 *
 * Source-scanning because the thing being guarded is the route's CONTRACT — one argument, one
 * closure — which a reviewer can drop in a single edit without any behavioural test noticing.
 * Every claim is anchored to code text, comments stripped, bounded inside the route itself.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, '..', '..', 'routes.ts'), 'utf8');
const code = (t: string) => t.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

/** The change-client-rates handler only, bounded at its own terminal-update failure message. */
const ROUTE = (() => {
  const start = SRC.indexOf("app.post('/api/rate-manager/change-client-rates'");
  expect(start, 'change-client-rates must exist').toBeGreaterThan(-1);
  const end = SRC.indexOf("'[rate_push_jobs] change-client-rates update failed:'", start);
  expect(end, 'the terminal update must follow the route start').toBeGreaterThan(start);
  return code(SRC.slice(start, end));
})();

describe('the pending row is dated from birth', () => {
  /** The insert that creates the job before the first mutation-capable call. */
  const insert = (() => {
    const at = ROUTE.indexOf('db.insert(ratePushJobs)');
    expect(at, 'the pre-push insert must exist').toBeGreaterThan(-1);
    return ROUTE.slice(at, ROUTE.indexOf('});', at));
  })();

  it("still creates the job as 'pending' before any push", () => {
    expect(insert).toContain("status:       'pending'");
  });

  it('sets startedAt, lastStep and lastStepAt on insert — lastStepAt is never NULL on this route', () => {
    // Without these, a stranded row has no timestamp but createdAt, and reconciliation would need
    // a second, route-specific discriminator. push-batch sets all three at insert (its 'queued').
    expect(insert).toMatch(/startedAt:\s+new Date\(\)/);
    expect(insert).toMatch(/lastStep:\s+'queued'/);
    expect(insert).toMatch(/lastStepAt:\s+new Date\(\)/);
  });
});

describe('a mark() closure writes position to the job row, and cannot fail the push', () => {
  /** The closure, from its declaration to the end of its statement. */
  const mark = (() => {
    const at = ROUTE.indexOf('const mark = (step: string) => {');
    expect(at, 'mark closure must exist inside the route').toBeGreaterThan(-1);
    return ROUTE.slice(at, ROUTE.indexOf('};', at));
  })();

  it('writes lastStep and lastStepAt, keyed by this job', () => {
    expect(mark).toContain('lastStep: step, lastStepAt: new Date(),');
    expect(mark).toContain('.where(eq(ratePushJobs.jobId, jobId))');
  });

  it('records the prefix and tariff in flight, so a stranded row names its target', () => {
    expect(mark).toMatch(/lastPrefix:\s+String\(prefix\)\.substring\(0, 32\)/);
    expect(mark).toMatch(/iTariff:\s+iTariff \?\? null/);
  });

  it('is fire-and-forget — position reporting must never fail a push', () => {
    // An awaited write here would turn a telemetry hiccup into a failed rate change.
    expect(mark).toContain('.catch(() => {');
    expect(mark).not.toContain('await db.update');
  });

  it("marks 'queued' at the top of every prefix, as push-batch does per operation", () => {
    expect(ROUTE).toContain("mark('queued');");
  });
});

describe('the callback is actually passed to the Sippy client', () => {
  /** From the setSippyRateEntry call to the statement that consumes its result. */
  const call = (() => {
    const at = ROUTE.indexOf('sippy.setSippyRateEntry(');
    expect(at, 'the tariff-scoped push must exist').toBeGreaterThan(-1);
    const end = ROUTE.indexOf('r = { ...sr', at);
    expect(end, 'the call result must be consumed after the call').toBeGreaterThan(at);
    return ROUTE.slice(at, end);
  })();

  it('hands mark(step) in as the progress reporter — the one argument this route used to drop', () => {
    // This is the guard that matters. Remove the seventh argument and the client still emits
    // every step; only this assertion knows nobody is listening.
    expect(call).toMatch(/\(step, detail\) => \{[\s\S]*?mark\(step\);[\s\S]*?\}/);
  });

  it('the reporter is inside the argument list, not merely somewhere in the route', () => {
    // The closure exists above the call; what is asserted here is that the CALL carries it.
    const open = call.indexOf('sippy.setSippyRateEntry(');
    const reporter = call.indexOf('mark(step);');
    expect(reporter).toBeGreaterThan(open);
  });
});
