/**
 * The KAM endpoints are an authorization boundary, and six of them had no role check.
 *
 * `resolveCommercialScope()` resolves the caller's KAM by `user_id`, walks `reports_to`, and
 * collects `kam_accounts.account_id`. Those two tables therefore DECIDE which accounts a
 * Commercial user may read. The endpoints that write them carried no `requireRole`, and
 * `/api/kam` is not in `PLATFORM_ROUTE_GROUPS`, so the only protection was the blanket `/api`
 * check that 401s a request with no user id.
 *
 * The escalation that follows, established from source on 2026-09-21 and deliberately NOT
 * tested against production, because proving it means writing KAM rows to a live system:
 *
 *   authenticated user (a `viewer` suffices)
 *     → POST /api/kam with `userId` set to their own
 *     → POST /api/kam/:id/accounts attaching any Sippy account
 *     → resolveCommercialScope() now returns that account
 *     → /api/commercial/* serves them its data (those routes require auth, not a role)
 *
 * SIX MUTATIONS ARE GUARDED. THE TWO READS ARE DELIBERATELY NOT.
 * `GET /api/kam` has four legitimate non-admin consumers — the layout shell that renders the
 * app chrome for every user, company creation, account-name resolution, and the Commercial
 * portfolio via `/api/kam/portfolio`. Guarding the reads would break the chrome for every
 * non-admin, which is a louder failure than the one being fixed, and it would close nothing:
 * the escalation path runs entirely through mutations.
 *
 * `admin` exactly, matching `/team` (route guard `requiredRoles={['admin']}`, page gated on
 * `isAdmin`, and `GET /api/team` already `requireRole(['admin'])`). `super_admin` is excluded,
 * consistent with those siblings — not an oversight, and not to be widened quietly here.
 *
 * Out of scope by agreement: transfer, bulk reassignment, audit history, the legacy Sieve
 * dimensions, and the generated-doc discrepancy that claims a KAM audit log which does not
 * exist. This gate closes the boundary and nothing else.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, '..', '..', 'routes.ts'), 'utf8');
const CODE = SRC.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

/**
 * The registration head of a route: from `app.method('path'` up to the start of its handler.
 * The guard, if any, lives here — between the path and the handler.
 */
function head(method: string, path: string): string {
  const needle = `app.${method}('${path}',`;
  const at = CODE.indexOf(needle);
  expect(at, `${method.toUpperCase()} ${path} must exist`).toBeGreaterThan(-1);
  const rest = CODE.slice(at);
  const end = rest.search(/async\s*\(/);
  expect(end, `${method.toUpperCase()} ${path} must have a handler`).toBeGreaterThan(-1);
  return rest.slice(0, end);
}

/** The six that write the hierarchy. */
const MUTATIONS: Array<[string, string, string]> = [
  ['post',   '/api/kam',                            'create a KAM'],
  ['patch',  '/api/kam/:id',                        'edit a KAM (including its userId link)'],
  ['delete', '/api/kam/:id',                        'delete a KAM and its assignments'],
  ['post',   '/api/kam/:id/accounts',               'assign an account to a KAM'],
  ['patch',  '/api/kam/accounts/:assignmentId',     'edit an assignment'],
  ['delete', '/api/kam/accounts/:assignmentId',     'remove an assignment'],
];

describe('every KAM mutation requires admin', () => {
  for (const [method, path, what] of MUTATIONS) {
    it(`${method.toUpperCase()} ${path} — ${what}`, () => {
      expect(head(method, path)).toMatch(/requireRole\(\s*\[\s*'admin'\s*\]/);
    });
  }

  /**
   * Through the shared helper, not a hand-rolled check. A bespoke `if (role !== 'admin')` in
   * one handler is how these six drifted apart from the rest of the platform in the first
   * place.
   */
  it('uses the shared requireRole helper in all six', () => {
    for (const [method, path] of MUTATIONS) {
      expect(head(method, path), `${method} ${path}`).toMatch(/requireRole\(/);
    }
  });

  /**
   * Exactly admin. Widening to management would hand the Commercial authorization boundary to
   * the same role the Commercial Portal itself admits, which defeats the point.
   */
  it('admits no role beyond admin', () => {
    for (const [method, path] of MUTATIONS) {
      const h = head(method, path);
      expect(h, `${method} ${path}`).not.toMatch(/'management'/);
      expect(h, `${method} ${path}`).not.toMatch(/'viewer'/);
      expect(h, `${method} ${path}`).not.toMatch(/'noc_operator'/);
    }
  });

  /**
   * super_admin stays excluded, matching /api/team and the rate-manager routes. Recorded as a
   * deliberate choice so a later reader does not "fix" it without a decision.
   */
  it('keeps super_admin excluded, as the sibling routes do', () => {
    for (const [method, path] of MUTATIONS) {
      expect(head(method, path), `${method} ${path}`).not.toMatch(/'super_admin'/);
    }
  });
});

describe('the two reads stay open to their existing consumers', () => {
  /**
   * Not an oversight. Guarding these breaks the app chrome for every non-admin, and closes
   * nothing — the escalation runs through the mutations above.
   */
  it('GET /api/kam is not role-guarded', () => {
    expect(head('get', '/api/kam')).not.toMatch(/requireRole\(/);
  });

  it('GET /api/kam/portfolio is not role-guarded', () => {
    expect(head('get', '/api/kam/portfolio')).not.toMatch(/requireRole\(/);
  });

  /** The consumers that make this necessary — if these disappear, revisit the decision. */
  it('the non-admin consumers that depend on the open read still exist', () => {
    const files = [
      ['components', 'layout-shell.tsx'],
      ['pages', 'company-create.tsx'],
      ['pages', 'account-names.tsx'],
    ] as const;
    for (const [dir, file] of files) {
      const t = readFileSync(join(__dirname, '..', '..', '..', 'client', 'src', dir, file), 'utf8');
      expect(t, `${file} should still read /api/kam`).toMatch(/['"]\/api\/kam['"]/);
    }
  });
});

describe('the surrounding model is untouched', () => {
  /** This gate closes a boundary. It does not add a transfer primitive. */
  it('the assignment PATCH still cannot move an account between KAMs', () => {
    const at = CODE.indexOf("app.patch('/api/kam/accounts/:assignmentId',");
    const body = CODE.slice(at, at + 900);
    expect(body).not.toMatch(/patch\.kamId/);
  });

  it('no audit system was invented here', () => {
    const at = CODE.indexOf("app.post('/api/kam',");
    const block = CODE.slice(at, at + 1200);
    expect(block).not.toMatch(/writeAudit|auditLog|recordAudit/);
  });
});
