/**
 * resolveCommercialScope — where the admin override gets its role from.
 *
 * The helper decided admin-ness by reading `req.user.claims.role`, falling back to
 * `claims.org_role`, falling back to ''. A native session carries NONE of those:
 * `buildNativeSessionUser` sets exactly sub, email, first_name and last_name. So the
 * expression was always '', `isAdmin` was always false FOR EVERY USER, and the admin
 * override documented in hierarchy-scope.ts was unreachable code. Admins fell through to
 * the KAM tree walk and, having no row in `kams`, received scopeError 'no_kam_link' —
 * which the Commercial Workspace shell turns into a full-page alert instead of a sidebar.
 *
 * Confirmed in production 2026-09-20: /api/commercial/scope answered
 * {isAdmin: false, scopeError: 'no_kam_link'} for an account whose role is `admin`.
 *
 * The helper has ELEVEN call sites across eight routes, so this is not one endpoint's bug.
 * These tests drive the real route through Express with the session shaped the way the real
 * one is — no role claim at all — because a fixture that invents a role claim would pass
 * against the broken code and prove nothing.
 *
 * The role must come from where the rest of the platform gets it: storage.getUserRole(),
 * exactly as requireRole does in routes.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('./db', () => ({ pool: { query: vi.fn() }, db: {} }));
vi.mock('./storage', () => ({ storage: { getUserRole: vi.fn() } }));
vi.mock('./services/commercial/hierarchy-scope', () => ({
  getVisibleAccountIds: vi.fn(),
  getAllAccountIds: vi.fn(),
}));
vi.mock('./services/commercial/execution-engine', () => ({
  initWorkflowEventsTable: vi.fn().mockResolvedValue(undefined),
  executeWorkflowAction: vi.fn(), queryWorkflowEvents: vi.fn(),
  getWorkflowTimeline: vi.fn(), getSubjectHistory: vi.fn(),
}));
vi.mock('./live-calls-cache', () => ({ sharedLiveCallsCache: { get: vi.fn(() => []), calls: [] } }));
vi.mock('./sippy', () => ({ listSippyAccounts: vi.fn() }));

import { registerCommercialRoutes } from './routes-commercial';
import { storage } from './storage';
import { getVisibleAccountIds, getAllAccountIds } from './services/commercial/hierarchy-scope';

const ADMIN_SCOPE = { accountIds: ['1', '2', '3'], kamIds: [], orgRole: null, scopeError: undefined };
const KAM_SCOPE   = { accountIds: ['7'], kamIds: [9], orgRole: 'kam', scopeError: undefined };
const NO_LINK     = { accountIds: [], kamIds: [], orgRole: null, scopeError: 'no_kam_link' };

/** A session exactly as buildNativeSessionUser makes it: NO role, NO org_role. */
const realSessionClaims = { sub: 'user-1', email: 'j@example.com', first_name: 'J', last_name: 'Q' };

function appWith(claims: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.user = { claims }; next(); });
  registerCommercialRoutes(app);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  (getAllAccountIds as any).mockResolvedValue(ADMIN_SCOPE);
  (getVisibleAccountIds as any).mockResolvedValue(KAM_SCOPE);
});

describe('the role comes from storage, because the session has no role to read', () => {
  it('an admin is admin — even though the session carries no role claim', async () => {
    (storage.getUserRole as any).mockResolvedValue('admin');
    const res = await request(appWith(realSessionClaims)).get('/api/commercial/scope');
    expect(res.status).toBe(200);
    expect(res.body.isAdmin).toBe(true);
    expect(res.body.scopeError).toBeNull();
    expect(getAllAccountIds).toHaveBeenCalled();
    expect(getVisibleAccountIds).not.toHaveBeenCalled();
  });

  it('a super_admin is admin too', async () => {
    (storage.getUserRole as any).mockResolvedValue('super_admin');
    const res = await request(appWith(realSessionClaims)).get('/api/commercial/scope');
    expect(res.body.isAdmin).toBe(true);
    expect(getAllAccountIds).toHaveBeenCalled();
  });

  it('the role is looked up for THIS user', async () => {
    (storage.getUserRole as any).mockResolvedValue('admin');
    await request(appWith(realSessionClaims)).get('/api/commercial/scope');
    expect(storage.getUserRole).toHaveBeenCalledWith('user-1');
  });
});

describe('everyone else still walks the KAM hierarchy', () => {
  it('a kam gets the subtree, not the platform', async () => {
    (storage.getUserRole as any).mockResolvedValue('kam');
    const res = await request(appWith(realSessionClaims)).get('/api/commercial/scope');
    expect(res.body.isAdmin).toBe(false);
    expect(getVisibleAccountIds).toHaveBeenCalledWith('user-1');
    expect(getAllAccountIds).not.toHaveBeenCalled();
    expect(res.body.accountIds).toEqual(['7']);
  });

  it('a user with NO role row is not admin, and a missing KAM link still surfaces', async () => {
    (storage.getUserRole as any).mockResolvedValue(null);
    (getVisibleAccountIds as any).mockResolvedValue(NO_LINK);
    const res = await request(appWith(realSessionClaims)).get('/api/commercial/scope');
    expect(res.body.isAdmin).toBe(false);
    expect(res.body.scopeError).toBe('no_kam_link');
  });

  it('management is NOT an admin override — only admin and super_admin are', async () => {
    (storage.getUserRole as any).mockResolvedValue('management');
    const res = await request(appWith(realSessionClaims)).get('/api/commercial/scope');
    expect(res.body.isAdmin).toBe(false);
    expect(getVisibleAccountIds).toHaveBeenCalled();
  });
});

describe('a session claim is not a source of authority', () => {
  /**
   * The tempting "fix" is to start putting a role into the session claims. That would make
   * admin-ness depend on something written at login and never re-checked, so a role change
   * would not take effect until the user signs in again — and a forged or stale claim would
   * decide scope. The stored role wins, in both directions.
   */
  it('a role claim cannot grant admin when the stored role says otherwise', async () => {
    (storage.getUserRole as any).mockResolvedValue('viewer');
    const res = await request(appWith({ ...realSessionClaims, role: 'admin', org_role: 'admin' }))
      .get('/api/commercial/scope');
    expect(res.body.isAdmin).toBe(false);
    expect(getAllAccountIds).not.toHaveBeenCalled();
  });

  it('a missing role claim cannot deny admin when the stored role grants it', async () => {
    (storage.getUserRole as any).mockResolvedValue('admin');
    const res = await request(appWith(realSessionClaims)).get('/api/commercial/scope');
    expect(res.body.isAdmin).toBe(true);
  });
});

describe('the fix is in the shared helper, so every route inherits it', () => {
  const SRC = readFileSync(join(__dirname, 'routes-commercial.ts'), 'utf8');
  const code = SRC.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

  it('no longer reads a role off the session claims anywhere in the file', () => {
    expect(code).not.toMatch(/claims\?\.\s*role/);
    expect(code).not.toMatch(/claims\?\.\s*org_role/);
    expect(code).not.toMatch(/claims\.role/);
  });

  it('resolves the role through storage, like requireRole does', () => {
    expect(code).toMatch(/storage\.getUserRole\(/);
  });

  /**
   * EIGHT call sites, one per route. The "11" quoted during the investigation was a raw grep
   * that counted the declaration and three mentions in prose; this counts calls in stripped
   * code. The guard is that routes keep going THROUGH the helper rather than each deciding
   * admin-ness for itself; one of them deciding for itself is how this class of bug returns.
   */
  it('every scope decision still goes through the one helper', () => {
    const calls = (code.match(/resolveCommercialScope\(req\)/g) || []).length;
    expect(calls).toBeGreaterThanOrEqual(8);
  });
});
