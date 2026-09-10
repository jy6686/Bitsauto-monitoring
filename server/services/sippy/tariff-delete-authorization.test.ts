/**
 * SMP-003 step 4 — role-level acceptance for `DELETE /api/sippy/tariffs/:id`, through the REAL
 * application.
 *
 * This is not a source assertion and not a reconstruction of the middleware chain. It calls the
 * application's own `registerRoutes()` against a real Express app, so the route table, the real
 * `requireRole` (which is a closure inside `registerRoutes` and cannot be imported), and the real
 * handler are the ones production runs.
 *
 * NO SIPPY REQUEST IS POSSIBLE. `sippy.deleteTariff` is replaced by a recorder — the ONLY thing
 * replaced in that module — so an allowed request proves the handler was reached and the mutation
 * was attempted, without a byte leaving the process. A denied request must leave the recorder
 * untouched; that is what "authorization actually prevents the mutation" means here, as opposed to
 * "a 403 was returned".
 *
 * The lesson from steps 1-3 is preserved: every assertion is tied to the route Express actually
 * resolves, never to a declaration that merely contains `requireRole`.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import request from "supertest";

/** Set per test; the middleware below puts it on the request before any route runs. */
let currentUser: any = null;
/** Set per test; what the real requireRole will read back for that user. */
let currentRole: string | null = null;

/** Every call the route would have made to Sippy. Must stay empty for a denied request. */
const sippyCalls: Array<{ method: string; args: any[] }> = [];

vi.mock("../../replit_integrations/auth", () => ({
  setupAuth: async () => {},
  registerAuthRoutes: () => {},
  isAuthenticated: (_r: any, _s: any, n: any) => n(),
  requirePlatformAccess: (_r: any, _s: any, n: any) => n(),
}));

// ONLY deleteTariff is replaced. Everything else in the module stays real, so nothing about the
// route's own behaviour is being simulated.
vi.mock("../../sippy", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    deleteTariff: async (...args: any[]) => { sippyCalls.push({ method: 'deleteTariff', args }); },
  };
});

let app: express.Express;

beforeAll(async () => {
  const { storage } = await import("../../storage");
  // The role lookup the real requireRole performs.
  vi.spyOn(storage, 'getUserRole' as any).mockImplementation(async () => currentRole as any);
  // Credentials, so the handler does not need a database.
  vi.spyOn(storage, 'getSettings' as any).mockResolvedValue({
    sippyPortalUrl: 'https://sippy.invalid', apiAdminUsername: 'u', apiAdminPassword: 'p',
  } as any);

  app = express();
  app.use(express.json());
  // Registered BEFORE registerRoutes, so it runs before every route it adds.
  app.use((req: any, _res, next) => { if (currentUser) req.user = currentUser; next(); });
  const server = http.createServer(app);
  const { registerRoutes } = await import("../../routes");
  await registerRoutes(server as any, app as any);
}, 60_000);

beforeEach(() => { currentUser = null; currentRole = null; sippyCalls.length = 0; });

const asUser = (role: string | null) => {
  currentUser = { claims: { sub: 'u-1', email: 'x@example.com' } };
  currentRole = role;
};

const del = (id: string | number = 4242) => request(app).delete(`/api/sippy/tariffs/${id}`);

describe("the request reaches the surviving deleteTariff registration", () => {
  it("an admin request reaches the handler and attempts the real mutation call", async () => {
    asUser('admin');
    const res = await del(4242);
    // 204 is the surviving handler's contract. The removed duplicate returned a JSON body, so
    // this also confirms which implementation ran.
    expect(res.status).toBe(204);
    expect(sippyCalls).toHaveLength(1);
    expect(sippyCalls[0].method).toBe('deleteTariff');
    // Signature of the retained implementation: (username, password, iTariff, iCustomer?)
    expect(sippyCalls[0].args[2]).toBe(4242);
  });

  it("the handler still honours i_customer, which the removed copy dropped", async () => {
    asUser('admin');
    await request(app).delete('/api/sippy/tariffs/4242?iCustomer=77').expect(204);
    expect(sippyCalls[0].args[3]).toBe(77);
  });

  it("id validation runs BEFORE the mutation, so a bad id reaches no Sippy call", async () => {
    asUser('admin');
    const res = await del('not-a-number');
    expect(res.status).toBe(400);
    expect(sippyCalls).toEqual([]);
  });
});

describe("the authorization matrix, on the reachable route", () => {
  const denied = ['management', 'viewer', 'destination_manager', 'finance', 'noc'];

  it("admin is allowed past authorization", async () => {
    asUser('admin');
    await del().expect(204);
    expect(sippyCalls).toHaveLength(1);
  });

  it.each(denied)("%s is refused with 403", async (role) => {
    asUser(role);
    const res = await del();
    expect(res.status).toBe(403);
  });

  it("a denied caller cannot reach the Sippy mutation — not merely a 403 in the response", async () => {
    // The assertion that matters. A 403 body proves what was returned; an empty recorder proves
    // nothing was sent.
    for (const role of denied) {
      sippyCalls.length = 0;
      asUser(role);
      await del();
      expect(sippyCalls, `${role} reached the mutation`).toEqual([]);
    }
  });

  it("a user with NO role assigned is refused", async () => {
    asUser(null);
    expect((await del()).status).toBe(403);
    expect(sippyCalls).toEqual([]);
  });

  it("an unauthenticated request is rejected before authorization", async () => {
    currentUser = null;
    const res = await del();
    expect(res.status).toBe(401);
    expect(sippyCalls).toEqual([]);
  });
});

describe("what this route still does NOT protect against — SMP-003's remaining scope", () => {
  it("a portal_only session with an admin role is STILL allowed", async () => {
    // Recorded as behaviour, not asserted as correct. `/api/sippy` is absent from
    // PLATFORM_ROUTE_GROUPS, so requirePlatformAccess never runs for this group and the
    // platform-access layer cannot refuse a portal_only caller here. The role floor is not a
    // substitute for that boundary, and this test exists so the gap stays visible rather than
    // being assumed closed by step 3.
    asUser('admin');
    currentUser.platformAccessType = 'portal_only';
    const res = await del();
    expect(res.status).toBe(204);
    expect(sippyCalls).toHaveLength(1);
  });

  it("no confirmation is required — deliberately out of scope for the floor", async () => {
    // The tariff-restore workflow requires confirmation:'RESTORE'. Whether this route should too
    // is a tightening decision above the floor, recorded in the register and NOT implemented.
    asUser('admin');
    await request(app).delete('/api/sippy/tariffs/4242').send({}).expect(204);
    expect(sippyCalls).toHaveLength(1);
  });
});
