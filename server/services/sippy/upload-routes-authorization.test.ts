/**
 * SMP-005 — the three generic Sippy upload routes carry a role floor.
 *
 * `POST /api/sippy/upload/token`, `GET /api/sippy/upload/status` and `POST /api/sippy/upload/file`
 * were added together by a Replit-Agent commit (101013bb, 2026-04-08) and never wired to anything:
 * no client code, no server code. The certified push path reaches Sippy through the service
 * layer — getUploadToken in group-readback.ts and rate-matrix.ts — not through these routes. But
 * token accepts any i_tariff and file posts caller-supplied bytes, and /api/sippy is not in
 * PLATFORM_ROUTE_GROUPS, so together they were a generic rate-rewrite primitive open to ANY
 * authenticated session, portal_only included. That walked straight around pushScopeGuard.
 *
 * Seven days of deployment logs (validated with a positive control on /api/build) show no
 * requests. Seven days does not rule out a periodic caller, so the routes are GATED, not
 * deleted: a real caller now surfaces as a 403 in the same logs. Deletion is a later gate.
 *
 * `admin` exactly. Most guarded /api/sippy writes use ['admin','management']; this is the
 * deliberate narrower choice, and super_admin stays excluded as on /api/team and the KAM
 * mutations — recorded here so nobody widens it as a tidy-up.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC  = readFileSync(join(__dirname, '..', '..', 'routes.ts'), 'utf8');
const CODE = SRC.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

/**
 * The registration head: from `app.method('path'` up to the async handler. Middleware — the
 * guard, and for /file the body collector — lives here.
 */
function head(method: string, path: string): string {
  const needle = `app.${method}('${path}'`;
  const at = CODE.indexOf(needle);
  expect(at, `${method.toUpperCase()} ${path} must exist`).toBeGreaterThan(-1);
  expect(CODE.indexOf(needle, at + 1), `${path} must be registered exactly once`).toBe(-1);
  const rest = CODE.slice(at);
  const end = rest.search(/async\s*\(req/);
  expect(end, `${method.toUpperCase()} ${path} must have a handler`).toBeGreaterThan(-1);
  return rest.slice(0, end);
}

const ROUTES: Array<[string, string]> = [
  ['post', '/api/sippy/upload/token'],
  ['get',  '/api/sippy/upload/status'],
  ['post', '/api/sippy/upload/file'],
];

describe('all three upload routes require admin', () => {
  for (const [method, path] of ROUTES) {
    it(`${method.toUpperCase()} ${path}`, () => {
      expect(head(method, path)).toMatch(/requireRole\(\s*\[\s*'admin'\s*\]/);
    });
  }

  it('through the shared requireRole helper, not a hand-rolled check', () => {
    for (const [method, path] of ROUTES) {
      expect(head(method, path), path).toMatch(/requireRole\(/);
    }
  });

  /** Exactly admin: the deliberate narrower floor. */
  it('admits nothing beyond admin — not management, not super_admin, not kam', () => {
    for (const [method, path] of ROUTES) {
      const h = head(method, path);
      expect(h, path).not.toMatch(/'management'/);
      expect(h, path).not.toMatch(/'super_admin'/);
      expect(h, path).not.toMatch(/'kam'/);
      expect(h, path).not.toMatch(/'viewer'/);
    }
  });
});

describe('the file route refuses before it buffers', () => {
  /**
   * The body collector reads up to 200 MB into memory. An unauthorised caller must be refused
   * before that, or the guard protects Sippy while leaving the server to be filled up.
   */
  it('the role check precedes the body collector', () => {
    const h = head('post', '/api/sippy/upload/file');
    const guard   = h.indexOf('requireRole(');
    const collect = h.indexOf("req.on('data'");
    expect(guard).toBeGreaterThan(-1);
    expect(collect).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(collect);
  });
});

describe('nothing else changed — this gate adds a floor and does not touch the rest', () => {
  it('the routes keep their internals', () => {
    expect(CODE).toContain('iUploadType');                         // token
    expect(CODE).toContain("error: 'token is required'");           // status
    expect(CODE).toContain('req.rawBinary = Buffer.concat(chunks)'); // file
  });

  /**
   * /api/sippy staying OUT of PLATFORM_ROUTE_GROUPS is SMP-003's decision, not this one. This
   * pins that it was not folded in here as a side effect — which would change 160 routes.
   */
  it('/api/sippy is still not in PLATFORM_ROUTE_GROUPS', () => {
    const at = CODE.indexOf('const PLATFORM_ROUTE_GROUPS');
    expect(at).toBeGreaterThan(-1);
    const block = CODE.slice(at, CODE.indexOf('];', at));
    expect(block).not.toMatch(/'\/api\/sippy'/);
  });

  /**
   * The certified push path never used these routes; it must still not. The service layer
   * calls getUploadToken itself, and nothing under services/rates references the HTTP path.
   */
  it('the certified service-layer upload path is untouched and does not go through HTTP', () => {
    const ratesDir = join(__dirname, '..', 'rates');
    const files = readdirSync(ratesDir).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    let seenGetUploadToken = false;
    for (const f of files) {
      const t = readFileSync(join(ratesDir, f), 'utf8');
      if (/getUploadToken/.test(t)) seenGetUploadToken = true;
      expect(t, `${f} must not call the HTTP upload routes`).not.toMatch(/api\/sippy\/upload/);
    }
    expect(seenGetUploadToken, 'the service-layer upload must still exist').toBe(true);
  });
});
