/**
 * The push-batch route's contract with the per-account split — asserted against source.
 *
 * The unit tests beside this one prove the planner and the scheduler in isolation. What they
 * cannot prove is that the ROUTE hands them the right things, and that is the whole risk of this
 * change: there is no integration test that drives push-batch end to end, because doing so means
 * a live Sippy. So the wiring is pinned here, the way the submit guards, the policy gate and the
 * bulk-group gate are pinned in their own files.
 *
 * Two questions, and only these two:
 *   1. does the scheduler receive exactly the account jobs, each owning only its own operations?
 *   2. is the certified Sippy/write/verification path semantically unchanged?
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, '..', '..', 'routes.ts'), 'utf8');

const PUSH_BATCH = (() => {
  const at = SRC.indexOf("app.post('/api/rate-manager/push-batch'");
  expect(at, 'push-batch route must exist').toBeGreaterThan(-1);
  const end = SRC.indexOf("app.post('/api/rate-manager/change-client-rates'", at);
  expect(end, 'the following route must exist').toBeGreaterThan(at);
  return SRC.slice(at, end);
})();

/** Position of a marker inside the handler; -1 never passes an ordering assertion by accident. */
const at = (needle: string) => {
  const i = PUSH_BATCH.indexOf(needle);
  expect(i, `handler must contain: ${needle}`).toBeGreaterThan(-1);
  return i;
};

describe('one account, one entry, one job', () => {
  /**
   * Deduplicated at the REQUEST boundary, not at the planner. Everything downstream iterates this
   * list, so a name sent twice would build two identical operations for one account and hand both
   * to that account's single job.
   */
  it('deduplicates the submitted accounts before anything is built from them', () => {
    expect(at('const pushAccounts = dedupeAccounts(accountNames)'))
      .toBeLessThan(at('const operations: RunnerOperation[] = []'));
  });

  it('builds the operations from the deduplicated list', () => {
    expect(PUSH_BATCH).toMatch(/for \(const accountName of pushAccounts\)/);
    // The raw body list must not be iterated again after the dedupe.
    const after = PUSH_BATCH.slice(at('const pushAccounts = dedupeAccounts'));
    expect(after).not.toMatch(/for \(const accountName of accountNames\)/);
    expect(after).not.toMatch(/accountNames\.join\(/);
  });

  it('plans one job per account from those same operations, under one request id', () => {
    const plan = at('planAccountJobs({');
    expect(at('const operations: RunnerOperation[] = []')).toBeLessThan(plan);
    const call = PUSH_BATCH.slice(plan, plan + 300);
    expect(call).toMatch(/accountNames:\s*pushAccounts/);
    expect(call).toMatch(/\boperations,/);
    expect(call).toMatch(/\brequestId,/);
  });

  /** An account with nothing to push gets no job, and the operator is told rather than left to infer. */
  it('reports accounts that produced no operation instead of creating empty jobs', () => {
    expect(PUSH_BATCH).toContain('plan.accountsWithoutOperations');
    expect(PUSH_BATCH).toMatch(/accountsWithoutOperations:\s*plan\.accountsWithoutOperations/);
  });

  /** Provably a non-event: no job row, no operation row, nothing sent. */
  it('refuses a submission that produced no operations at all, before recording anything', () => {
    expect(at('plan.jobs.length === 0')).toBeLessThan(at('db.insert(ratePushJobs)'));
    expect(PUSH_BATCH).toContain('produced no rate operations');
  });
});

describe('the scheduler receives exactly the account jobs', () => {
  const schedule = (() => {
    const i = at('runTariffExclusive(');
    return PUSH_BATCH.slice(i, PUSH_BATCH.indexOf('const jobReports', i));
  })();

  it('is given plan.jobs — every one of them, and nothing else', () => {
    expect(schedule).toMatch(/plan\.jobs\.map\(job =>/);
    expect(schedule).toMatch(/\{ iTariff: Number\.isFinite\(t\) \? t : null, job \}/);
  });

  /** The tariff is what serialises; it resolves per ACCOUNT, which is why one job is one lane. */
  it('keys each job by the tariff resolved for its own account', () => {
    expect(schedule).toMatch(/Number\(iTariffByAccountName\.get\(job\.accountName\)\)/);
  });

  it('runs each job through runAccountJob', () => {
    expect(schedule).toMatch(/run:\s*runAccountJob/);
  });

  /**
   * THE ENVELOPE. `concurrency` counted tariffs before the split and must count tariffs after it,
   * or the Sippy-facing load changes. Clamped by the lane planner's OWN constants, imported rather
   * than re-typed, so the two cannot drift.
   */
  it('bounds simultaneous tariffs by the same constants the lane planner uses', () => {
    expect(schedule).toMatch(/concurrency:\s*jobConcurrency/);
    const clamp = PUSH_BATCH.slice(at('const jobConcurrency'), at('const markJobTerminal'));
    expect(clamp).toContain('DEFAULT_LANE_CONCURRENCY');
    expect(clamp).toContain('MIN_LANE_CONCURRENCY');
    expect(clamp).toContain('MAX_LANE_CONCURRENCY');
    expect(SRC).toMatch(/import \{ MIN_LANE_CONCURRENCY, MAX_LANE_CONCURRENCY, DEFAULT_LANE_CONCURRENCY \} from "\.\/services\/rates\/batch-plan"/);
  });
});

describe('each job owns only its own work', () => {
  const runOne = (() => {
    const i = at('const runAccountJob = async (job');
    return PUSH_BATCH.slice(i, PUSH_BATCH.indexOf('const scheduled = await runTariffExclusive', i));
  })();

  /** The engine must never see the whole submission's operations again. */
  it('hands the engine this job\'s id and this job\'s operations', () => {
    expect(runOne).toMatch(/const jobId = job\.jobId;/);
    expect(runOne).toMatch(/operations:\s*job\.operations,/);
    // No line is a bare `operations,` — the submission-wide array must not reach the engine.
    expect(runOne).not.toMatch(/\n\s*operations,\s*\n/);
  });

  it('writes the position trail and the obligations against this job\'s row', () => {
    expect(runOne).toMatch(/push:\s*pushFor\(jobId\)/);
    expect(runOne).toMatch(/loadOperationsForPush\(db as any, jobId\)/);
    // Scoped to this job, as it has been since 2026-09-22: the backlog belongs to the boot drain.
    expect(runOne).toMatch(/drainRateNotifications\('push',\s*\{ jobId \}\)/);
  });

  it('finalises this job\'s row from its own derived summary', () => {
    expect(runOne).toContain('status:             runOutcome.summary.status');
    expect(runOne).toMatch(/\.where\(eq\(ratePushJobs\.jobId, jobId\)\)/);
  });

  /** One lock for the submission, shared: it is what keeps two siblings off one tariff. */
  it('shares one tariff lock across every sibling', () => {
    expect(at('const lock = createPostgresTariffLock(pool);')).toBeLessThan(at('const runAccountJob'));
    expect(runOne).toMatch(/\block,\s*policy\s*\}/);
  });
});

describe('no job is created and then silently lost', () => {
  it('inserts every sibling in one statement, so a submission is never half recorded', () => {
    expect((PUSH_BATCH.match(/db\.insert\(ratePushJobs\)/g) || []).length).toBe(1);
    expect(PUSH_BATCH).toContain('db.insert(ratePushJobs).values(jobRows)');
    expect(PUSH_BATCH).toContain('Refusing to run it unrecorded.');
  });

  /**
   * AN EXECUTION EXCEPTION MEANS WHAT IT MEANT. Before the split, a `runRateBatch` that threw
   * aborted the request (500) and left its row `processing` with unsettled operation rows —
   * exactly what boot reconciliation adopts (`status IN ('pending','processing')`). Terminalising
   * it would remove it from the only recovery path that exists, which is a recovery redesign and
   * not route wiring. The route must therefore NOT settle a job the engine threw on.
   */
  it('leaves a job the engine threw on non-terminal, so boot reconciliation can still adopt it', () => {
    const runOne = PUSH_BATCH.slice(at('const runAccountJob = async (job'), at('const scheduled = await runTariffExclusive'));
    // No catch of its own: the throw travels to the outcome walk untouched.
    expect(runOne).not.toMatch(/markJobTerminal/);
    expect(runOne).not.toMatch(/catch \(e: any\)\s*\{[\s\S]*throw e;/);
    const report = PUSH_BATCH.slice(at('const jobReports'), at('const ok    = results.filter'));
    // Only the never-attempted branch may terminalise. A thrown job is recorded, not settled.
    expect(report).toMatch(/if \(outcome\.skipped\) \{\s*\n\s*await markJobTerminal\(job\.jobId, 'failed', outcome\.error\);/);
    expect(report).toMatch(/threw = \{ accountName: job\.accountName, error: outcome\.error \}/);
    // ONE call site in the whole handler, and it is that one. Asserting the absence of a
    // terminalise inside runAccountJob is not enough on its own: a terminalise smuggled anywhere
    // else in the outcome walk — including into the `else if` condition — reaches a thrown job
    // just the same, and passes every assertion above.
    expect((PUSH_BATCH.match(/\bmarkJobTerminal\(/g) || []).length).toBe(1);
    const skippedBranch = report.slice(report.indexOf('if (outcome.skipped) {'), report.indexOf('jobReports.push({', report.indexOf('if (outcome.skipped) {')));
    expect(skippedBranch).toContain('markJobTerminal(');
    expect(skippedBranch.slice(skippedBranch.indexOf('} else if'))).not.toContain('markJobTerminal(');
  });

  /** …and the request still fails, as it did when the throw came straight out of runRateBatch. */
  it('re-raises the exception at the request boundary', () => {
    expect(PUSH_BATCH).toMatch(/if \(threw\) throw new Error\(/);
    expect(at('if (threw) throw new Error(')).toBeLessThan(at('res.json({'));
  });

  /**
   * The one case with no precedent, and the opposite shape: a never-attempted job has NO operation
   * rows, so reconcile-sweep's `skippedNoIntent` branch leaves it untouched forever. Left
   * `processing` it would strand permanently and hold the operator's Submit locked with it.
   */
  it('terminalises and reports a job the scheduler never attempted', () => {
    const report = PUSH_BATCH.slice(at('const jobReports'), at('const ok    = results.filter'));
    expect(report).toMatch(/await markJobTerminal\(job\.jobId, 'failed', outcome\.error\)/);
    expect(report).toMatch(/status: 'failed', ok: 0, error: outcome\.error/);
  });

  it('walks every scheduled outcome, in submitted order', () => {
    const report = PUSH_BATCH.slice(at('const jobReports'), at('const ok    = results.filter'));
    expect(report).toMatch(/for \(let i = 0; i < scheduled\.length; i\+\+\)/);
    expect(report).toMatch(/const job = plan\.jobs\[i\]/);
  });

  it('never leaves markJobTerminal able to abort the request', () => {
    const fn = PUSH_BATCH.slice(at('const markJobTerminal'), at('const runAccountJob'));
    expect(fn).toMatch(/try \{/);
    expect(fn).toMatch(/catch \(e: any\)/);
    expect(fn).not.toMatch(/throw/);
  });
});

describe('the certified write path is untouched', () => {
  /**
   * These are the steps the 2026-09-18 new-prefix certification and the evidence rule rest on.
   * The split changes WHICH ROW a push is recorded against; it must change nothing about the push.
   */
  it('still pushes one operation at a time through the same Sippy primitive', () => {
    expect(PUSH_BATCH).toContain('sippy.pushRateToSippy(');
    expect(PUSH_BATCH).toMatch(/iTariff:\s*String\(o\.iTariff\)/);
    expect(PUSH_BATCH).toMatch(/interval1:\s*o\.interval1/);
    expect(PUSH_BATCH).toMatch(/intervalN:\s*o\.intervalN/);
    expect(PUSH_BATCH).toMatch(/format:\s*format \?\? 'full'/);
  });

  it('still routes every job through runRateBatch — the lane planner, the lock and the evidence rule', () => {
    expect((PUSH_BATCH.match(/runRateBatch\(/g) || []).length).toBe(1);
  });

  it('still derives the server trunk from productId and refuses a batch without one', () => {
    expect(PUSH_BATCH).toContain('productId is required');
    expect(PUSH_BATCH).toContain('validateTrunkPrefix(pushProduct.trunkPrefix)');
  });

  it('still resolves eligibility once per product and leaves it UNDEFINED on failure', () => {
    expect(PUSH_BATCH).toMatch(/eligible:\s*eligiblePrefixes \? eligiblePrefixes\.has\(String\(dest\.dialPrefix\)\) : undefined/);
  });

  it('still keeps every operation key positional and per-account', () => {
    expect(PUSH_BATCH).toContain('operationKey:    `${operations.length}:${accountName}:${dest.fullPrefix}`');
  });

  /** Reads, not writes, and still once per distinct tariff for the whole submission. */
  it('still reads prior rates once per tariff, only when the policy flag is on', () => {
    expect(at('if (policyEnforced) {')).toBeLessThan(at('sippy.getTariffRatesListFull('));
    expect(at('sippy.getTariffRatesListFull(')).toBeLessThan(at('const runAccountJob'));
  });
});
