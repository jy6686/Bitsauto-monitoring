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
import { NON_NOTIFYING_RATE_TYPES } from './post-push-obligation';

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

/**
 * The route records one durable operation per prefix — the evidence push-batch has always kept.
 *
 * Until this existed, a Rate Analysis change mutated Sippy and left a single job row behind: no
 * per-prefix record, no product, no bare dial prefix, and — when a prefix failed — no persisted
 * reason. "Which of these five prefixes did not change, and why?" had no answer in the database.
 *
 * Source-scanned for the same reason as the rest of this file: the guarantee is the route's
 * CONTRACT — rows written BEFORE the first mutation, one per submitted prefix, closed
 * individually — and every part of it can be removed in one edit without a behavioural test
 * elsewhere noticing.
 */
describe('the rate_type this route declares is the one the guard keys on', () => {
  /** The literal this route writes to rate_push_jobs.rate_type. */
  const rateType = (() => {
    const m = ROUTE.match(/rateType:\s+'([^']+)'/);
    expect(m, 'the route must declare a rateType').not.toBeNull();
    return m![1];
  })();

  it('is the exact string the notification exclusion keys on', () => {
    // The whole boundary rests on these two agreeing. Change one without the other and the
    // guard silently protects a value nothing writes, which looks identical to working.
    expect(NON_NOTIFYING_RATE_TYPES).toContain(rateType);
  });

  it("is 'change-client-rate' — the value production already holds", () => {
    // NOT shortened to fit the declared varchar(16). Production carries 12 rows with this
    // 18-character value, the newest written 2026-09-23, so the live column is wider than
    // shared/schema.ts declares. Renaming it would fork one job type across two values and
    // leave the existing history outside the exclusion above.
    expect(rateType).toBe('change-client-rate');
  });
});

describe('one operation row per submitted prefix, written before the first mutation', () => {
  const opInsert = (() => {
    const at = ROUTE.indexOf('db.insert(ratePushOperations)');
    expect(at, 'the route must record operation rows').toBeGreaterThan(-1);
    return ROUTE.slice(at, ROUTE.indexOf('})));', at));
  })();

  it('inserts operations BEFORE the push loop, so a death mid-loop leaves evidence', () => {
    const insertAt = ROUTE.indexOf('db.insert(ratePushOperations)');
    const loopAt   = ROUTE.indexOf('for (const [opIdx, prefix] of prefixes.entries())');
    expect(loopAt, 'the push loop must carry the operation index').toBeGreaterThan(-1);
    expect(insertAt).toBeLessThan(loopAt);
  });

  it('maps every submitted prefix to exactly one row', () => {
    expect(opInsert).toContain('prefixes.map((prefix, idx)');
    expect(opInsert).toMatch(/status:\s+'pending'/);
    expect(opInsert).toMatch(/sequence:\s+idx/);
  });

  it('keys by position AND prefix, so a repeated prefix is not silently collapsed', () => {
    // The unique index is (job_id, operation_key). A prefix-only key would drop the duplicate.
    expect(ROUTE).toMatch(/operationKeyFor = \(idx: number, prefix: string\) => `\$\{idx\}:\$\{prefix\}`/);
  });

  it('is conditional on the job row existing — operations carry a foreign key to it', () => {
    expect(ROUTE).toContain('if (jobRowWritten && prefixes.length > 0)');
  });
});

describe('identity is derived, never invented', () => {
  it('derives product, trunk and dial from the full prefix through the shared module', () => {
    expect(ROUTE).toContain('deriveOperationIdentity(String(p), identityCatalogue)');
  });

  it('resolves i_account from the canonical identity map, not from the request body', () => {
    expect(ROUTE).toContain('clientIdentityMap.sippyUsername');
    expect(ROUTE).toMatch(/iAccount:\s+changeIAccount/);
  });

  it('falls back to null on every derived field rather than substituting a placeholder', () => {
    // A wrong dial_prefix is a wrong price in a customer's inbox; null keeps the row out of the
    // notification path entirely.
    for (const f of ['productName', 'trunkPrefix', 'dialPrefix']) {
      expect(ROUTE, f).toMatch(new RegExp(`${f}:\\s+identities\\[idx\\]\\?\\.${f}\\s+\\?\\?\\s+null`));
    }
  });

  it('labels the job with a product only when every prefix agrees on one', () => {
    expect(ROUTE).toContain('jobProducts.length === 1 ? jobProducts[0]! : null');
  });
});

describe('each operation is closed with what happened to THAT prefix', () => {
  const finish = (() => {
    const at = ROUTE.indexOf('const finishOperation = async (');
    expect(at, 'the terminal update helper must exist').toBeGreaterThan(-1);
    return ROUTE.slice(at, ROUTE.indexOf('terminal update failed:', at));
  })();

  it('writes succeeded or failed per operation, not the job-level verdict', () => {
    expect(finish).toContain("status:             outcome.success ? 'succeeded' : 'failed'");
    expect(finish).toContain('eq(ratePushOperations.operationKey, operationKeyFor(opIdx, String(prefix)))');
  });

  it('persists the failure reason, which previously survived only in the HTTP response', () => {
    expect(finish).toMatch(/message:\s+outcome\.message \? String\(outcome\.message\) : null/);
  });

  it('closes the operation on BOTH paths, so a thrown push still leaves a terminal row', () => {
    expect(ROUTE).toContain('await finishOperation(opIdx, String(prefix), { success: false, message: e.message });');
    expect(ROUTE).toMatch(/await finishOperation\(opIdx, String\(prefix\), \{[\s\S]*?success:\s+r\.success/);
  });

  it('never claims refusedBeforeWrite — this route has no preflight to establish it', () => {
    // NULL means nobody established it. Writing false would assert a mutating request WAS sent.
    expect(finish).not.toContain('refusedBeforeWrite');
  });
});

/**
 * THE AUDIT INVARIANT: a terminal job means every operation it owns has settled.
 *
 * The failure it prevents is narrow and permanent. Sippy is mutated, the per-operation UPDATE
 * fails so the row stays `pending`, and the job's terminal write then stamps `completed` over it.
 * Boot reconciliation only examines NON-terminal jobs, so nothing ever looks at that job again —
 * the record is wrong rather than incomplete, and silently so.
 *
 * The predicate itself is proven behaviourally in job-terminalization.test.ts. What is asserted
 * here is that this route actually uses it, and that the outcome is still recorded when it does
 * not fire — a guard that is present but unwired is indistinguishable from no guard at all.
 */
describe('a job may only go terminal when its operations have settled', () => {
  it('guards the terminal update with the shared noPendingOperations predicate', () => {
    expect(ROUTE).toContain('noPendingOperations(jobId)');
  });

  it('makes the terminal status claim ONLY inside the settled branch', () => {
    const settled = ROUTE.indexOf('if (jobFullySettled)');
    expect(settled, 'the settled branch must exist').toBeGreaterThan(-1);

    // The job's terminal verdict appears exactly once, and after the guard. (The operation rows
    // have their own completedAt in finishOperation — a different table, legitimately terminal
    // per operation, which is why this pins the job's status line rather than any completedAt.)
    const verdict = /status:\s+ok === prefixes\.length \? 'completed' : ok > 0 \? 'partial' : 'failed'/g;
    expect(ROUTE.match(verdict) ?? []).toHaveLength(1);
    expect(ROUTE.search(verdict)).toBeGreaterThan(settled);
  });

  it('requires BOTH that operations exist and that every one was closed', () => {
    // "nothing pending" is trivially true of "nothing recorded", so SQL alone is not enough.
    expect(ROUTE).toContain('const jobFullySettled = operationsRecorded && operationPersistFailures === 0;');
  });

  it('still records the outcome when it refuses — only the terminal claim is withheld', () => {
    // Withholding the counts and notes too would lose the evidence recovery needs.
    expect(ROUTE).toMatch(/set\(jobOutcome\)\.where\(eq\(ratePushJobs\.jobId, jobId\)\)/);
  });

  it('jobOutcome carries NO terminal fields — the fallback cannot terminalise by accident', () => {
    // THE WHOLE INVARIANT RESTS HERE. `set(jobOutcome)` runs on the refusal path, unguarded. If
    // `status` or `completedAt` ever appears in this literal, that path silently terminalises the
    // job it exists to hold open, and every other assertion in this file would still pass.
    const at = ROUTE.indexOf('const jobOutcome = {');
    expect(at, 'jobOutcome must exist').toBeGreaterThan(-1);
    const literal = ROUTE.slice(at, ROUTE.indexOf('};', at) + 2);

    // Key positions only: `uploadStatus:` is a legitimate observation and must not trip this.
    expect(literal).not.toMatch(/(^|\s)status:/);
    expect(literal).not.toMatch(/(^|\s)completedAt:/);
  });

  it('checks the UPDATE actually applied, rather than assuming the predicate passed', () => {
    expect(ROUTE).toContain('.returning({ jobId: ratePushJobs.jobId })');
    expect(ROUTE).toContain('if (done.length === 0)');
  });
});

describe('a failed operation write is reported, and never escalated into a retry', () => {
  const finish = (() => {
    const at = ROUTE.indexOf('const finishOperation = async (');
    return ROUTE.slice(at, ROUTE.indexOf('for (const [opIdx, prefix]', at));
  })();

  it('counts the failure so the job cannot be terminalised over it', () => {
    expect(finish).toContain('operationPersistFailures++');
  });

  it('names the job, operation, prefix and the state that failed to land', () => {
    for (const f of ['job=${jobId}', 'operationKey=', 'prefix=${prefix}', 'intendedStatus=']) {
      expect(finish, f).toContain(f);
    }
  });

  it('does NOT rethrow — Sippy may already hold the rate, and a 500 invites a duplicate write', () => {
    // The push has mutated the switch by this point. Turning a bookkeeping failure into an error
    // response would tell the caller to try again, writing the same rate twice.
    expect(finish).not.toContain('throw');
    expect(finish).not.toContain('res.status(500)');
  });
});
