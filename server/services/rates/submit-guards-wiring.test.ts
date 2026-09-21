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

  it('the job insert carries clientRequestId', () => {
    const insertAt = PUSH_BATCH.indexOf('db.insert(ratePushJobs)');
    const insertBlock = PUSH_BATCH.slice(insertAt, PUSH_BATCH.indexOf('});', insertAt));
    expect(insertBlock).toMatch(/clientRequestId:\s*clientRequestId/);
  });
});

describe('GET /api/rate-manager/jobs/by-request/:clientRequestId', () => {
  const ROUTE = (() => {
    const at = ROUTES.indexOf("app.get('/api/rate-manager/jobs/by-request/:clientRequestId'");
    expect(at, 'by-request route must exist').toBeGreaterThan(-1);
    return ROUTES.slice(at, at + 2500);
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

  it('is read-only: no update, insert, or Sippy call', () => {
    for (const forbidden of ['db.update(', 'db.insert(', 'sippy.', 'runRateBatch(']) {
      expect(ROUTE).not.toContain(forbidden);
    }
  });
});
