/**
 * The route's contract with the submit guards and the by-request lookup — asserted against source.
 *
 * Order is the whole point: the guards must run BEFORE the job row is inserted (which is itself
 * before the first mutation-capable call), the request id must be on that insert, and a refusal
 * must be a 409 that names the existing job — never a fresh job, never a 500.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const strip = (t: string) => t.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const ROUTES = strip(readFileSync(join(__dirname, '..', '..', 'routes.ts'), 'utf8'));

const PUSH_BATCH = (() => {
  const at = ROUTES.indexOf("app.post('/api/rate-manager/push-batch'");
  expect(at, 'push-batch route must exist').toBeGreaterThan(-1);
  return ROUTES.slice(at, ROUTES.indexOf("app.post('/api/rate-manager/change-client-rates'", at));
})();

describe('push-batch: guards before the job row, request id on the row', () => {
  it('reads clientRequestId from the body and validates it', () => {
    expect(PUSH_BATCH).toContain('isValidClientRequestId(');
  });

  it('runs submitGuards BEFORE db.insert(ratePushJobs), on the resolved target tariffs', () => {
    const guardAt  = PUSH_BATCH.indexOf('submitGuards(');
    const insertAt = PUSH_BATCH.indexOf('db.insert(ratePushJobs)');
    expect(guardAt).toBeGreaterThan(-1);
    expect(insertAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(insertAt);
    expect(PUSH_BATCH).toContain('listNonTerminalJobsForTariffs(');
    expect(PUSH_BATCH).toContain('findJobByClientRequestId(');
  });

  it('BOTH refusals are 409s that name the existing job, issued before the insert', () => {
    const insertAt = PUSH_BATCH.indexOf('db.insert(ratePushJobs)');
    const before = PUSH_BATCH.slice(0, insertAt);
    const dup = before.indexOf("kind === 'duplicate'");
    const inf = before.indexOf("kind === 'in_flight'");
    expect(dup).toBeGreaterThan(-1);
    expect(inf).toBeGreaterThan(-1);
    // Each branch answers 409 with a jobId — not one of them, each of them.
    expect(before.slice(dup, inf)).toMatch(/res\.status\(409\)\.json\(\{[^}]*jobId/);
    expect(before.slice(inf)).toMatch(/res\.status\(409\)\.json\(\{[^}]*jobId/);
    expect((before.match(/res\.status\(409\)/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  /**
   * A submission is now one job per account, and `rate_push_jobs_client_request_id_uq` is unique
   * where the column is non-null — so the operator's submit id sits on the FIRST sibling. That is
   * the row the duplicate guard and the lost-response lookup find, and its `request_id` is what
   * turns it back into the whole submission.
   */
  it('the job rows carry clientRequestId on the first sibling and a shared requestId', () => {
    const planAt   = PUSH_BATCH.indexOf('planAccountJobs(');
    const insertAt = PUSH_BATCH.indexOf('db.insert(ratePushJobs)');
    expect(planAt).toBeGreaterThan(-1);
    expect(planAt).toBeLessThan(insertAt);
    const rowsBlock = PUSH_BATCH.slice(planAt, insertAt);
    expect(rowsBlock).toMatch(/clientRequestId:\s*index === 0/);
    expect(rowsBlock).toMatch(/\brequestId,/);
  });

  /**
   * ONE statement, not N. Separate inserts could leave a submission half recorded — some accounts
   * with a durable row, others silently absent — and an account that vanishes between planning and
   * insertion is the exact failure the per-account split exists to make impossible.
   */
  it('inserts every sibling in a single statement', () => {
    expect((PUSH_BATCH.match(/db\.insert\(ratePushJobs\)/g) || []).length).toBe(1);
    expect(PUSH_BATCH).toMatch(/db\.insert\(ratePushJobs\)\.values\(jobRows\)/);
  });

  /** The row exists before the first mutation-capable call. That position is the contract. */
  it('inserts the job rows BEFORE the engine is ever called', () => {
    const insertAt = PUSH_BATCH.indexOf('db.insert(ratePushJobs)');
    const runAt    = PUSH_BATCH.indexOf('runRateBatch(');
    expect(runAt).toBeGreaterThan(-1);
    expect(insertAt).toBeLessThan(runAt);
  });
});

describe('GET /api/rate-manager/jobs/by-request/:clientRequestId', () => {
  const ROUTE = (() => {
    const at = ROUTES.indexOf("app.get('/api/rate-manager/jobs/by-request/:clientRequestId'");
    expect(at, 'by-request route must exist').toBeGreaterThan(-1);
    // Bounded by the NEXT route rather than a character count, so growing this handler cannot
    // silently make the read-only assertion below inspect the following route instead.
    const next = ROUTES.indexOf("app.get('/api/rate-manager/jobs/:jobId/operations'", at);
    expect(next, 'the following route must exist').toBeGreaterThan(at);
    return ROUTES.slice(at, next);
  })();

  it('is authenticated for admin, management and kam', () => {
    // `kam` added by the KAM authorization gate — the Send Rate tab uses this lookup to
    // recover a submit whose response was lost, and a KAM has that same need.
    expect(ROUTE).toMatch(/requireRole\(\['admin',\s*'management',\s*'kam'\]/);
  });

  it('validates the id, answers 404 for an unknown one, and returns the row with its derived summary', () => {
    expect(ROUTE).toContain('isValidClientRequestId(');
    expect(ROUTE).toContain('findJobByClientRequestId(');
    expect(ROUTE).toMatch(/res\.status\(404\)/);
    expect(ROUTE).toContain('deriveJobStatus(');
    expect(ROUTE).toMatch(/res\.json\(\{\s*job/);
  });

  /**
   * THE REGRESSION THE SPLIT CREATES. The submit id names one sibling; answering with that
   * sibling's status would unlock Submit while another customer's rates were still being written —
   * the 2026-09-19 double-submit, re-created. The status must come from the whole request.
   */
  it('answers for the whole submission when the row carries a request id', () => {
    expect(ROUTE).toContain('deriveRequestStatus(');
    expect(ROUTE).toContain('deriveRequestOperations(');
    // A row written before migration 527 has no request id and keeps the single-job answer.
    expect(ROUTE).toMatch(/if\s*\(!job\.requestId\)/);
  });

  it('is read-only: no update, insert, or Sippy call', () => {
    for (const forbidden of ['db.update(', 'db.insert(', 'sippy.', 'runRateBatch(']) {
      expect(ROUTE).not.toContain(forbidden);
    }
  });
});
