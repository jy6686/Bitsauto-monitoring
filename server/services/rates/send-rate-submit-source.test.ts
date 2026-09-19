/**
 * The Send Rate page's contract with the submit lifecycle — asserted against source.
 *
 * The one line that caused the 09-19 double batch was `setPushing(false)` in the HTTP call's
 * `finally`. This pins that the page no longer releases the button from the response path at
 * all, that every submit carries a client request id, and that a lost response is recovered by
 * the by-request lookup rather than by a second click.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const strip = (t: string) => t.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const PAGE = strip(readFileSync(join(__dirname, '..', '..', '..', 'client', 'src', 'pages', 'rate-manager.tsx'), 'utf8'));

// The page has several handleSubmit functions (another dialog's comes first). Anchor on the one
// call that is unique to Send Rate — the push-batch POST — and take its enclosing handler.
const SUBMIT = (() => {
  const call = PAGE.indexOf('/api/rate-manager/push-batch');
  expect(call, 'the push-batch call must exist in the page').toBeGreaterThan(-1);
  const at = PAGE.lastIndexOf('const handleSubmit = async () => {', call);
  expect(at, 'the Send Rate handleSubmit must enclose the push-batch call').toBeGreaterThan(-1);
  const end = PAGE.indexOf('const handleReset = ', at);
  expect(end).toBeGreaterThan(call);
  return PAGE.slice(at, end);
})();

describe('Send Rate submit is terminal-state-driven', () => {
  it('uses the pure lifecycle from @/lib/submit-lifecycle', () => {
    expect(PAGE).toMatch(/from ["']@\/lib\/submit-lifecycle["']/);
    expect(PAGE).toContain('submitReducer');
  });

  it('the HTTP call\'s finally can no longer re-enable Submit', () => {
    expect(SUBMIT).not.toMatch(/finally\s*\{[^}]*setPushing\(false\)/);
    expect(SUBMIT).not.toContain('setPushing(false)');
  });

  it('every submit sends a clientRequestId generated on the client — IN the request body', () => {
    expect(SUBMIT).toMatch(/const clientRequestId = crypto\.randomUUID\(\)/);
    const bodyAt = SUBMIT.indexOf('const body = {');
    expect(bodyAt).toBeGreaterThan(-1);
    const body = SUBMIT.slice(bodyAt, SUBMIT.indexOf('};', bodyAt));
    expect(body).toMatch(/\bclientRequestId\b/);
    // Named BEFORE the request leaves, so a lost response can still be looked up.
    expect(SUBMIT.indexOf('const clientRequestId')).toBeLessThan(SUBMIT.indexOf('apiRequest("POST", "/api/rate-manager/push-batch"'));
  });

  it('a lost response is recovered by request id, not by a retry', () => {
    expect(PAGE).toContain('/api/rate-manager/jobs/by-request/');
    expect(SUBMIT).toMatch(/RESPONSE_LOST/);
    expect(SUBMIT).toMatch(/RESPONSE_REJECTED/);
    expect(SUBMIT).not.toMatch(/apiRequest\("POST",\s*"\/api\/rate-manager\/push-batch"[\s\S]*apiRequest\("POST",\s*"\/api\/rate-manager\/push-batch"/);
  });

  it('the queue is cleared only when the lifecycle says the job is terminal', () => {
    expect(PAGE).toContain('shouldClearQueue(');
    expect(SUBMIT).not.toContain('setDestQueue([])');
  });

  it('Push History polls while a RECENT job is processing — via the pure helper (push-history-poll.test.ts owns the rule)', () => {
    const at = PAGE.indexOf('function JobsTab()');
    const tab = PAGE.slice(at, at + 800);
    expect(tab).toMatch(/refetchInterval:\s*\(query: any\)\s*=>\s*pushHistoryPollInterval\(/);
    expect(PAGE).toMatch(/from ["']@\/lib\/push-history-poll["']/);
  });
});
