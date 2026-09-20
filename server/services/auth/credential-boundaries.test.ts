/**
 * The two HTTP response boundaries that leak `password_hash`, asserted against source.
 *
 * These guards run against the CURRENT tree and fail today: /api/auth/user still appends
 * `...user` to its response object, and /api/team still calls res.json(members) on the raw
 * rows from getAllUsersWithRoles(). Confirmed live in production 2026-09-20.
 *
 * The projection's own behaviour is proven in ./public-user.test.ts. Nothing here handles a
 * credential value; a hash is proven absent by the absence of its KEY.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const strip = (t: string) => t.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const AUTH_ROUTES = strip(readFileSync(join(__dirname, '..', '..', 'replit_integrations', 'auth', 'routes.ts'), 'utf8'));
const ROUTES      = strip(readFileSync(join(__dirname, '..', '..', 'routes.ts'), 'utf8'));

/** The GET /api/auth/user handler body, sliced so a match elsewhere in the file cannot pass it. */
const AUTH_USER_HANDLER = (() => {
  const a = AUTH_ROUTES.indexOf('app.get("/api/auth/user"');
  expect(a, 'the /api/auth/user handler must exist').toBeGreaterThan(-1);
  const b = AUTH_ROUTES.indexOf('});', AUTH_ROUTES.indexOf('catch (error)', a));
  expect(b).toBeGreaterThan(a);
  return AUTH_ROUTES.slice(a, b);
})();

/** The GET /api/team handler body — NOT the PATCH sibling, which legitimately echoes a role. */
const TEAM_HANDLER = (() => {
  const a = ROUTES.indexOf("app.get('/api/team'");
  expect(a, 'the GET /api/team handler must exist').toBeGreaterThan(-1);
  const b = ROUTES.indexOf("app.patch('/api/team/:userId/role'", a);
  expect(b).toBeGreaterThan(a);
  return ROUTES.slice(a, b);
})();

describe('GET /api/auth/user — the spread is gone and the documented shape survives', () => {
  it('no longer spreads the raw user row into the response', () => {
    expect(AUTH_USER_HANDLER).not.toMatch(/\.\.\.user\b/);
  });

  it('still returns every field its doc comment promises', () => {
    for (const field of [
      'id:', 'email:', 'username:', 'firstName:', 'lastName:', 'displayName',
      'avatar:', 'jobTitle:', 'role,', 'accessScope:', 'defaultPortal:', 'assignedPortals', 'portals:',
    ]) {
      expect(AUTH_USER_HANDLER, field).toContain(field);
    }
  });

  it('names no credential field of its own', () => {
    expect(AUTH_USER_HANDLER).not.toMatch(/passwordHash/);
  });
});

describe('GET /api/team — projected, and still admin-only', () => {
  it('does not serialise the raw rows', () => {
    expect(TEAM_HANDLER).not.toMatch(/res\.json\(\s*members\s*\)/);
  });

  it('serialises through the projection', () => {
    expect(TEAM_HANDLER).toMatch(/toTeamMember/);
  });

  /**
   * The exact-role convention: requireRole matches exactly, so ['admin'] excludes super_admin.
   * That is the endpoint's existing behaviour and this change must not widen it — a security
   * fix that quietly grants a new role access is not a security fix.
   */
  it('remains requireRole(["admin"]) — not broadened to super_admin', () => {
    expect(TEAM_HANDLER).toMatch(/requireRole\(\[\s*'admin'\s*\]/);
    expect(TEAM_HANDLER).not.toMatch(/super_admin/);
  });
});

describe('the database layer is untouched — the fix is at the boundary', () => {
  const STORAGE = strip(readFileSync(join(__dirname, '..', '..', 'storage.ts'), 'utf8'));

  /**
   * getAllUsersWithRoles keeps returning full rows ON PURPOSE. server/routes.ts uses it
   * internally for a viewer IDOR check that needs the whole row, and two other callers already
   * project. Narrowing it here would be a wider change than the leak requires.
   */
  it('getAllUsersWithRoles still returns the full row for its internal callers', () => {
    const at = STORAGE.indexOf('async getAllUsersWithRoles');
    expect(at).toBeGreaterThan(-1);
    expect(STORAGE.slice(at, at + 700)).toMatch(/\.\.\.u\b/);
  });
});
