/**
 * The Rate Manager KPI strip — one registration, and the fields the UI actually asks for.
 *
 * `/api/rate-manager/kpi` was registered TWICE: a guarded handler inside registerRateManagerRoutes
 * and an unguarded one inline in routes.ts. Express takes the first, so the guarded one served
 * every request and the inline one was dead code — no authorization hole, but not harmless
 * either: the two returned DIFFERENT shapes, and the dead one was the shape the UI was written
 * against. `rate-manager.tsx` renders `kpiStats?.totalCountries`, which only the dead handler
 * produced, so the Countries tile has been rendering "—".
 *
 * The fix keeps the guarded route and adds the two missing fields to it. Deliberately NOT
 * changed: `totalDestinations` and `totalClients` are computed differently by the two handlers
 * (all levels vs level 2; companies vs distinct active assignments), and the live values are what
 * the tiles already show. Changing a displayed number is a separate decision from restoring a
 * missing one.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const strip = (t: string) => t.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const ROUTES = strip(readFileSync(join(__dirname, '..', '..', 'routes.ts'), 'utf8'));
const RM     = strip(readFileSync(join(__dirname, '..', '..', 'routes-rate-manager.ts'), 'utf8'));

/** The live handler: from its registration to the response it sends. */
const KPI = () => {
  const at = RM.indexOf("app.get('/api/rate-manager/kpi'");
  expect(at, 'the guarded kpi route must exist').toBeGreaterThan(-1);
  const end = RM.indexOf("app.get('/api/rate-manager/export'", at);
  expect(end).toBeGreaterThan(at);
  return RM.slice(at, end);
};

const countRegistrations = (path: string) =>
  (ROUTES.split(`app.get('${path}'`).length - 1) + (RM.split(`app.get('${path}'`).length - 1);

describe('ONE registration — a shadowed route cannot silently come back', () => {
  it('/api/rate-manager/kpi is registered exactly once, and not in routes.ts', () => {
    expect(countRegistrations('/api/rate-manager/kpi')).toBe(1);
    expect(ROUTES).not.toContain("app.get('/api/rate-manager/kpi'");
  });

  it('the dead handler is gone, not merely unreachable', () => {
    // Its own markers: the level-filtered destination query and the assignment-based client count.
    expect(ROUTES).not.toContain('distinct_countries');
    expect(ROUTES).not.toContain("COUNT(DISTINCT i_account) FROM customer_product_assignments WHERE status = 'active'");
  });

  it('NO /api/rate-manager route is registered twice', () => {
    const paths = [...ROUTES.matchAll(/app\.(?:get|post|put|patch|delete)\('(\/api\/rate-manager[^']*)'/g),
                   ...RM.matchAll(/app\.(?:get|post|put|patch|delete)\('(\/api\/rate-manager[^']*)'/g)].map(m => m[1]);
    const dupes = paths.filter((p, i) => paths.indexOf(p) !== i);
    expect([...new Set(dupes)]).toEqual([]);
  });
});

describe('the surviving handler answers with the fields it can answer truthfully', () => {
  it('returns the four it already had, plus totalProducts', () => {
    const body = KPI();
    const send = body.slice(body.indexOf('res.json({'));
    for (const f of ['totalClients', 'totalDestinations', 'todayPushes', 'successRate', 'totalProducts']) {
      expect(send, f).toContain(f);
    }
  });

  it('sources totalProducts from commercial products in the registry', () => {
    const k = KPI();
    expect(k).toMatch(/product_registry|productRegistry/);
    expect(k).toMatch(/'commercial'/);
    expect(k).toContain('totalProducts');
  });

  it('a failure in the new query degrades to a number, never a 500 for the whole strip', () => {
    // totalDestinations already tolerates a missing table; the addition must be no more fragile
    // than the tile it sits beside.
    const k = KPI();
    expect((k.match(/catch\s*\{/g) || []).length).toBeGreaterThanOrEqual(2);
  });
});

describe('totalCountries is NOT part of the contract — a dash beats a confident zero', () => {
  /**
   * Deployed once, in c9e07b6b, carried over from the dead handler: distinct level-1
   * `country_code` in `global_destinations`, a table whose level-1 rows have none. It answered 0.
   * The UI renders `kpiStats?.totalCountries ?? "—"`, so an ABSENT field says "unavailable" while
   * a zero asserts there are no countries. The data exists in `destinationsView` but duplicates
   * each country (Albania as both `AL` and `355`), so the count needs a definition first.
   */
  it('the response does not carry totalCountries', () => {
    const body = KPI();
    expect(body.slice(body.indexOf('res.json({'))).not.toContain('totalCountries');
  });

  it('the query that produced the false zero is gone from the handler', () => {
    const k = KPI();
    expect(k).not.toMatch(/count\(distinct country_code\)/i);
    expect(k).not.toMatch(/FROM global_destinations\s+WHERE level = 1/i);
  });

  it('and is not lurking anywhere else in the route files', () => {
    expect(ROUTES).not.toContain('totalCountries');
    expect(RM).not.toContain('totalCountries');
  });
});

describe('REGRESSION: nothing else about the route changed', () => {
  it('keeps its own guard — admin, management, noc_operator', () => {
    expect(KPI()).toMatch(/requireRole\(\['admin','management','noc_operator'\]/);
  });

  it('keeps the existing four computations exactly as they were', () => {
    const k = KPI();
    expect(k).toContain('const allCompanies  = await storage.getCompanies();');
    expect(k).toContain('.from(globalDestinations)');
    expect(k).toMatch(/gte\(ratePushJobs\.createdAt, todayStart\)/);
    expect(k).toMatch(/gte\(ratePushJobs\.createdAt, ago30\)/);
    expect(k).toContain("r.status === 'completed'");
  });

  it('the two other known duplicate registrations are untouched — out of scope, not forgotten', () => {
    expect(countRegistrations('/api/reports/asr-acd')).toBe(2);
    expect(countRegistrations('/api/sippy/accounts/:id/info')).toBe(2);
  });
});
