/**
 * Option C's contract with the route and the push path — asserted against source.
 *
 * The behavioural rules live in account-list.test.ts. What is pinned here is the two things a
 * reviewer could regress in one edit: the route must list from COMPANIES (not only from the
 * assignment table, which is what hid accounts), and push-batch's tariff-integrity check must be
 * untouched — Option C moves the product-assignment fact into a visible flag, it does not weaken
 * the write-time guard.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const strip = (t: string) => t.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const SRC = strip(readFileSync(join(__dirname, '..', '..', 'routes.ts'), 'utf8'));

const ROUTE = (() => {
  const at = SRC.indexOf("app.get('/api/sippy/accounts-by-product/:productId'");
  expect(at, 'accounts-by-product route must exist').toBeGreaterThan(-1);
  return SRC.slice(at, SRC.indexOf("app.get('/api/sippy/accounts'", at));
})();

describe('the list is drawn from managed companies, and assignment is a flag not a filter', () => {
  it('selects every company with a Sippy account', () => {
    expect(ROUTE).toContain('.from(companies).where(isNotNull(companies.sippyIAccount))');
  });

  it('reads the assignment rows for the product and hands both to buildAccountList', () => {
    expect(ROUTE).toContain('buildAccountList(managed as any, assignments as any, productId)');
  });

  it('no longer filters the assignment query to active — the builder decides assigned, the route does not hide', () => {
    // The old shape: .where(and(eq(productId), eq(status,'active'))) on the assignment query. If
    // that returns, unassigned accounts vanish again.
    const assignmentQuery = ROUTE.slice(ROUTE.indexOf('const assignments = await db.select'), ROUTE.indexOf('const listed ='));
    expect(assignmentQuery).not.toContain("eq(customerProductAssignments.status, 'active')");
  });

  it('returns the assigned flag on every row and counts assigned vs unassigned separately', () => {
    expect(ROUTE).toContain('assigned: a.assigned');
    expect(ROUTE).toContain('assignedCount: accounts.filter((a: any) => a.assigned).length');
    expect(ROUTE).toContain('unassignedCount: accounts.filter((a: any) => !a.assigned).length');
  });
});

describe('push-time safety is unchanged', () => {
  const PUSH = (() => {
    const at = SRC.indexOf("app.post('/api/rate-manager/push-batch'");
    expect(at).toBeGreaterThan(-1);
    return SRC.slice(at, SRC.indexOf("app.post('/api/rate-manager/change-client-rates'", at));
  })();

  it('push-batch still runs checkTariffIntegrity before writing', () => {
    expect(PUSH).toContain('checkTariffIntegrity(');
  });

  it('Option C did not add an assignment-based refusal to the push path (it is a visible flag, not a new gate)', () => {
    // If someone later wants assignment enforced at push time that is a deliberate policy change,
    // not a side effect of this dropdown fix.
    expect(PUSH).not.toContain('buildAccountList');
  });
});
