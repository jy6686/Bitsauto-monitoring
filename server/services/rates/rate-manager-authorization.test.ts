/**
 * Who may read rate data — asserted against source.
 *
 * `/api/rate-manager/jobs`, `/export` and the two workbook endpoints carried no role check. They
 * were never anonymous: the global `/api` middleware 401s without a session, and
 * `/api/rate-manager` is in PLATFORM_ROUTE_GROUPS, so `isAuthenticated` + `requirePlatformAccess`
 * already reject portal_only, suspended and disabled users. What was missing is ROLE: any
 * authenticated platform user — viewer, noc_operator, finance, training_admin,
 * destination_manager — could read every client's name, prefixes, rates, tariff ids and upload
 * tokens, and download the generated rate workbooks.
 *
 * The guard is the one the siblings already use, exactly: `requireRole(['admin', 'management'])`.
 * `requireRole` matches the role exactly, so super_admin stays excluded here as it already is on
 * push-batch, change-client-rates, the operations endpoints and reconcile-status. Consistency is
 * the point: this data is the same data those routes serve.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const strip = (t: string) => t.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const ROUTES = strip(readFileSync(join(__dirname, '..', '..', 'routes.ts'), 'utf8'));
const RM     = strip(readFileSync(join(__dirname, '..', '..', 'routes-rate-manager.ts'), 'utf8'));

/** The handler registration plus the middleware that precedes its body. */
const registration = (src: string, path: string) => {
  const at = src.indexOf(`app.get('${path}'`);
  expect(at, `route not found: ${path}`).toBeGreaterThan(-1);
  return src.slice(at, at + 320);
};

const GUARD = /requireRole\(\['admin',\s*'management'\]/;

const NEWLY_GUARDED: Array<[string, string, () => string]> = [
  ['jobs',               '/api/rate-manager/jobs',               () => registration(ROUTES, '/api/rate-manager/jobs')],
  ['export',             '/api/rate-manager/export',             () => registration(RM, '/api/rate-manager/export')],
  ['push-xlsx-list',     '/api/rate-manager/push-xlsx-list',     () => registration(RM, '/api/rate-manager/push-xlsx-list')],
  ['push-xlsx-download', '/api/rate-manager/push-xlsx-download', () => registration(RM, '/api/rate-manager/push-xlsx-download')],
];

describe('the four rate-data routes require admin or management', () => {
  for (const [name, , slice] of NEWLY_GUARDED) {
    it(`${name} carries requireRole(['admin','management'])`, () => {
      expect(slice()).toMatch(GUARD);
    });
  }

  it('each workbook endpoint is guarded in its own right, not by a neighbour', () => {
    // Asserted separately because they sit next to each other: a single guard placed on one and
    // relied upon for the other would leave the download open.
    expect(registration(RM, '/api/rate-manager/push-xlsx-list')).toMatch(GUARD);
    expect(registration(RM, '/api/rate-manager/push-xlsx-download')).toMatch(GUARD);
  });

  it('uses the exact-role convention the siblings use — super_admin stays excluded', () => {
    for (const [name, , slice] of NEWLY_GUARDED) {
      expect(slice(), name).not.toMatch(/'super_admin'/);
      expect(slice(), name).not.toMatch(/'noc_operator'/);
      expect(slice(), name).not.toMatch(/'viewer'/);
    }
  });
});

describe('REGRESSION: the guards that already existed are untouched', () => {
  it('the global /api session gate still 401s, and these paths are not exempted', () => {
    expect(ROUTES).toMatch(/if\(!uid\)return res\.status\(401\)\.json\(\{error:'Auth required'\}\);/);
    const ungu = ROUTES.slice(ROUTES.indexOf('const UNGUARDED = new Set('), ROUTES.indexOf('const UNGUARDED = new Set(') + 260);
    for (const p of ['/rate-manager/jobs', '/rate-manager/export', '/rate-manager/push-xlsx-list', '/rate-manager/push-xlsx-download']) {
      expect(ungu, p).not.toContain(p);
    }
  });

  it('/api/rate-manager is still a platform route group (portal_only and suspended stay blocked)', () => {
    const groups = ROUTES.slice(ROUTES.indexOf('const PLATFORM_ROUTE_GROUPS'), ROUTES.indexOf('const PLATFORM_ROUTE_GROUPS') + 700);
    expect(groups).toContain("'/api/rate-manager'");
    expect(ROUTES).toContain('app.use(prefix, isAuthenticated, requirePlatformAccess);');
  });

  it('requireRole still answers 401 without a session and 403 for the wrong role', () => {
    const fn = ROUTES.slice(ROUTES.indexOf('async function requireRole('), ROUTES.indexOf('async function requireRole(') + 420);
    expect(fn).toMatch(/if \(!userId\) return res\.status\(401\)/);
    expect(fn).toMatch(/if \(!role \|\| !roles\.includes\(role\)\)/);
    expect(fn).toMatch(/res\.status\(403\)/);
  });

  it('the sibling rate routes keep the guard they already had', () => {
    for (const p of ['/api/rate-manager/push-batch', '/api/rate-manager/change-client-rates',
                     '/api/rate-manager/jobs/:jobId/operations', '/api/rate-manager/reconcile-status']) {
      const at = ROUTES.indexOf(`app.post('${p}'`) > -1 ? ROUTES.indexOf(`app.post('${p}'`) : ROUTES.indexOf(`app.get('${p}'`);
      expect(at, p).toBeGreaterThan(-1);
      expect(ROUTES.slice(at, at + 320), p).toMatch(GUARD);
    }
  });
});

describe('REGRESSION: nothing but the guard changed', () => {
  it('jobs still returns the enriched array it returned before', () => {
    const h = registration(ROUTES, '/api/rate-manager/jobs') + ROUTES.slice(ROUTES.indexOf(`app.get('/api/rate-manager/jobs'`) + 320, ROUTES.indexOf(`app.get('/api/rate-manager/jobs'`) + 1400);
    expect(h).toContain('db.select().from(ratePushJobs)');
    expect(h).toContain('res.json(enriched)');
  });

  it('the workbook endpoints keep their filename validation', () => {
    const d = RM.slice(RM.indexOf(`app.get('/api/rate-manager/push-xlsx-download'`), RM.indexOf(`app.get('/api/rate-manager/push-xlsx-download'`) + 900);
    expect(d).toMatch(/replace\(\/\[\^a-zA-Z0-9\._-\]\/g, ''\)/);
    expect(d).toMatch(/startsWith\('rate-push-'\)/);
    expect(d).toMatch(/endsWith\('\.xlsx'\)/);
  });

  it('the routes deliberately left out of scope are still untouched', () => {
    // products and download-test-xlsx are separate decisions; the dead duplicate kpi likewise.
    expect(registration(ROUTES, '/api/rate-manager/products')).not.toMatch(GUARD);
    expect(registration(RM, '/api/rate-manager/download-test-xlsx')).not.toMatch(GUARD);
  });
});
