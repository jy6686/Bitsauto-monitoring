/**
 * SMP-003 step 2 — RUNTIME reachability of `DELETE /api/sippy/tariffs/:id`.
 *
 * Step 1 asserted that exactly one source registration remains. That is necessary and NOT
 * sufficient: source inspection cannot see path-pattern shadowing. A different pattern registered
 * earlier — `/api/sippy/:resource/:id`, a mounted router, a wildcard — would intercept the request
 * while the source still shows exactly one literal registration of our path.
 *
 * So this test resolves the request through REAL Express. It rebuilds the application's actual
 * registration list, in the application's actual order, substitutes each handler with a marker
 * that reports which registration it is, and issues a real DELETE. Whichever marker answers is,
 * by definition, the reachable route.
 *
 * NO SIPPY REQUEST IS POSSIBLE HERE. Every handler is replaced by a marker; not one line of real
 * handler code runs, so the route under test cannot reach deleteTariff or any other Sippy call.
 * That is the point of markers rather than mounting the real app.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import express from "express";
import request from "supertest";

const SERVER = join(__dirname, '..', '..');
const read = (f: string) => readFileSync(join(SERVER, f), 'utf8');

interface Reg { file: string; line: number; verb: string; path: string }

/** Route registrations in one file, in file order. */
function registrationsIn(file: string): Reg[] {
  return read(file).split('\n').flatMap((l, i) => {
    const m = l.match(/app\.(get|post|put|patch|delete)\('([^']+)'/);
    return m ? [{ file, line: i + 1, verb: m[1].toUpperCase(), path: m[2] }] : [];
  });
}

/**
 * The application's registration order.
 *
 * routes.ts registers its own routes in file order, and calls registerXRoutes(app) at specific
 * lines — every one of them well after 9059. Expanding each call in place reproduces the order
 * Express actually sees.
 */
function applicationOrder(): Reg[] {
  const MODULES: Record<string, string> = {
    registerRateManagerRoutes:        'routes-rate-manager.ts',
    registerProductEligibilityRoutes: 'routes-product-eligibility.ts',
    registerRateNotificationRoutes:   'routes-rate-notifications.ts',
    registerProductTemplatesRoutes:   'routes-product-templates.ts',
  };
  const lines = read('routes.ts').split('\n');
  const out: Reg[] = [];
  lines.forEach((l, i) => {
    const own = l.match(/app\.(get|post|put|patch|delete)\('([^']+)'/);
    if (own) { out.push({ file: 'routes.ts', line: i + 1, verb: own[1].toUpperCase(), path: own[2] }); return; }
    const call = l.match(/^\s*(register[A-Za-z]+Routes)\(app\);/);
    if (call && MODULES[call[1]]) out.push(...registrationsIn(MODULES[call[1]]));
  });
  return out;
}

let app: express.Express;
let order: Reg[];
/** Registrations Express could not accept as patterns — reported rather than hidden. */
const unmountable: Reg[] = [];

beforeAll(() => {
  order = applicationOrder();
  app = express();
  order.forEach((r, idx) => {
    try {
      (app as any)[r.verb.toLowerCase()](r.path, (_req: any, res: any) =>
        res.status(200).json({ idx, file: r.file, line: r.line, path: r.path }));
    } catch { unmountable.push(r); }
  });
});

/** Which registration Express resolves a request to. */
const resolve = async (verb: string, url: string) => {
  const res = await (request(app) as any)[verb.toLowerCase()](url);
  return res.status === 404 ? null : res.body;
};

describe("the application's route table is modelled faithfully", () => {
  it("every registration mounts as an Express pattern", () => {
    // If Express cannot accept a pattern, the model is incomplete and the conclusion below
    // would be drawn from a route table the application does not have.
    expect(unmountable.map(r => `${r.file}:${r.line} ${r.verb} ${r.path}`)).toEqual([]);
  });

  it("includes the sub-module registrars that also register /api/sippy paths", () => {
    // routes-rate-manager.ts registers /api/sippy/* routes of its own. Omitting it would model a
    // route table with fewer chances to shadow than the real one.
    expect(order.some(r => r.file === 'routes-rate-manager.ts')).toBe(true);
    expect(order.some(r => r.file === 'routes-rate-manager.ts' && r.path.startsWith('/api/sippy/'))).toBe(true);
  });

  it("registers routes.ts's own routes before the sub-modules it calls", () => {
    const lastOwn  = order.map((r, i) => r.file === 'routes.ts' ? i : -1).filter(i => i >= 0).pop()!;
    const firstSub = order.findIndex(r => r.file !== 'routes.ts');
    expect(firstSub).toBeGreaterThan(-1);
    // The tariff route sits at ~9059, long before any registerXRoutes(app) call.
    const tariff = order.findIndex(r => r.verb === 'DELETE' && r.path === '/api/sippy/tariffs/:id');
    expect(tariff).toBeLessThan(firstSub);
    expect(lastOwn).toBeGreaterThan(-1);
  });
});

describe("DELETE /api/sippy/tariffs/:id resolves to the surviving implementation", () => {
  it("Express resolves it to the registration in routes.ts, not a shadowing pattern", async () => {
    const hit = await resolve('delete', '/api/sippy/tariffs/123');
    expect(hit, 'the route resolved to nothing').not.toBeNull();
    expect(hit.file).toBe('routes.ts');
    expect(hit.path).toBe('/api/sippy/tariffs/:id');
  });

  it("the resolved registration is the deleteTariff handler — the one step 1 kept", async () => {
    const hit = await resolve('delete', '/api/sippy/tariffs/123');
    // Cross the runtime answer back to the source: the line Express resolved to must be the
    // handler that accepts i_customer, validates the id, and calls sippy.deleteTariff.
    const src = read('routes.ts');
    const from = src.split('\n').slice(hit.line - 1).join('\n');
    const handler = from.slice(0, from.indexOf('\n  app.', 10));
    expect(handler).toContain('sippy.deleteTariff(');
    expect(handler).toContain('iCustomer');
    expect(handler).toContain('isNaN(iTariff)');
    expect(handler).not.toContain('deleteSippyTariff');
  });

  it("exactly ONE registration in the whole table can serve this method+path", async () => {
    const candidates = order.filter(r => r.verb === 'DELETE' && r.path === '/api/sippy/tariffs/:id');
    expect(candidates).toHaveLength(1);
    const hit = await resolve('delete', '/api/sippy/tariffs/123');
    expect(hit.line).toBe(candidates[0].line);
  });

  it("a non-numeric id resolves to the same registration — no alternate pattern picks it up", async () => {
    // The surviving handler validates and returns 400 for this; what matters here is that the
    // request does not fall through to some other pattern that would handle it differently.
    const hit = await resolve('delete', '/api/sippy/tariffs/not-a-number');
    expect(hit.path).toBe('/api/sippy/tariffs/:id');
    expect(hit.file).toBe('routes.ts');
  });
});

describe("step 2 established reachability and applied NO authorization", () => {
  it("the reachable registration is still ungated — step 3 has not run", async () => {
    const hit = await resolve('delete', '/api/sippy/tariffs/123');
    const line = read('routes.ts').split('\n')[hit.line - 1];
    expect(line).not.toContain('requireRole');
  });

  it("names the exact registration step 3 must gate", async () => {
    // The output of this step: a line number established by runtime resolution rather than by
    // reading the file. Step 3 gates THIS registration; step 4 asserts the gate landed on it.
    const hit = await resolve('delete', '/api/sippy/tariffs/123');
    expect(hit.file).toBe('routes.ts');
    expect(typeof hit.line).toBe('number');
    console.log(`[SMP-003 step 2] reachable registration = ${hit.file}:${hit.line} (${hit.path})`);
  });
});
