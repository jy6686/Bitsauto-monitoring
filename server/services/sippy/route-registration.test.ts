/**
 * SMP-003 step 1 — duplicate route resolution, and the guard against the class.
 *
 * `DELETE /api/sippy/tariffs/:id` was registered twice inside the same registerRoutes function:
 * ungated at ~9059 and requireRole(['admin']) at ~12684. Express matches the first registration
 * and the first handler never called next(), so the admin gate never ran. Reading the gated copy,
 * tariff deletion looked admin-only. It was not.
 *
 * That is why authorization is NOT applied in the same step. A gate added to a shadowed
 * registration is present in the source and inert at runtime, and a source-level assertion — the
 * style used throughout this work — would pass while the open route kept serving.
 *
 * These tests therefore assert the property that makes reachability unambiguous: exactly ONE
 * registration per method+path. With one registration, the reachable handler is that handler;
 * there is nothing left for Express to choose between.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(join(__dirname, '..', '..', 'routes.ts'), 'utf8');
const LINES = SRC.split('\n');

/** Every route registration in routes.ts, with its line. */
const registrations = LINES.flatMap((l, i) => {
  const m = l.match(/app\.(get|post|put|patch|delete)\('([^']+)'/);
  return m ? [{ line: i + 1, verb: m[1].toUpperCase(), path: m[2] }] : [];
});

/** Registrations grouped by method+path, with whether each copy carries authorization. */
const grouped = (() => {
  const m = new Map<string, Array<{ line: number; gated: boolean }>>();
  for (const r of registrations) {
    // Authorization may sit on the registration line or the line after it.
    const gated = [LINES[r.line - 1], LINES[r.line] ?? ''].join('\n').includes('requireRole');
    const k = `${r.verb} ${r.path}`;
    m.set(k, [...(m.get(k) ?? []), { line: r.line, gated }]);
  }
  return [...m.entries()].filter(([, v]) => v.length > 1);
})();

describe("no route is registered twice — Express would serve only the first", () => {
  it("NO duplicate has authorization on any copy — the SMP-003 invariant", () => {
    // This is the load-bearing assertion. A gate on a shadowed registration is present in the
    // source and inert at runtime: the source reads as protected while the open copy serves.
    // That is exactly what DELETE /api/sippy/tariffs/:id did before this change.
    const gatedDupes = grouped
      .filter(([, hits]) => hits.some(h => h.gated))
      .map(([k, hits]) => `${k} — copies at ${hits.map(h => `${h.line}${h.gated ? ' (GATED)' : ''}`).join(', ')}`);
    expect(gatedDupes, `a duplicate carries authorization that cannot run:\n  ${gatedDupes.join('\n  ')}`).toEqual([]);
  });

  it("the set of remaining duplicates has not grown", () => {
    // Two duplicates remain, both GET reads and NEITHER gated, so neither is an authorization
    // exposure — they are shadowed implementations, recorded as SMP-004. Pinned here so a NEW
    // duplicate fails this test rather than joining them silently.
    expect(grouped.map(([k]) => k).sort()).toEqual([
      'GET /api/reports/asr-acd',
      'GET /api/sippy/accounts/:id/info',
    ]);
  });

  it("DELETE /api/sippy/tariffs/:id is registered exactly once", () => {
    const hits = registrations.filter(r => r.verb === 'DELETE' && r.path === '/api/sippy/tariffs/:id');
    expect(hits).toHaveLength(1);
  });

  it("no /api/sippy WRITE route is duplicated", () => {
    // The scope SMP-003 covers.
    const writeDupes = grouped
      .filter(([k]) => /^(POST|PUT|PATCH|DELETE) \/api\/sippy\//.test(k))
      .map(([k]) => k);
    expect(writeDupes).toEqual([]);
  });
});

describe("the surviving handler is the better implementation, not merely the earlier one", () => {
  const HANDLER = (() => {
    const a = SRC.indexOf("app.delete('/api/sippy/tariffs/:id'");
    return SRC.slice(a, SRC.indexOf('\n  app.', a + 10));
  })();

  it("accepts i_customer, which the removed copy dropped", () => {
    expect(HANDLER).toContain('iCustomer');
    expect(HANDLER).toContain('sippy.deleteTariff(');
  });

  it("validates the id before calling Sippy", () => {
    // The removed copy passed an unchecked parseInt straight through.
    expect(HANDLER).toContain('isNaN(iTariff)');
    expect(HANDLER).toContain("id must be a valid integer");
    const guard = HANDLER.indexOf('isNaN(iTariff)');
    const call  = HANDLER.indexOf('sippy.deleteTariff(');
    expect(guard).toBeLessThan(call);
  });

  it("does not call the removed copy's function", () => {
    expect(HANDLER).not.toContain('deleteSippyTariff');
  });
});

describe("removing the registration did not orphan anything", () => {
  it("sippy.deleteSippyTariff is still used elsewhere, so the function stays", () => {
    // Only the route registration was removed. The function has another live caller.
    const uses = [...SRC.matchAll(/sippy\.deleteSippyTariff\(/g)];
    expect(uses.length).toBeGreaterThanOrEqual(1);
  });
});

describe("the admin floor is on the surviving registration", () => {
  it("the surviving route carries requireRole(['admin'])", () => {
    // SMP-003 baseline: destructive -> admin. Step 3 applied it, to the registration step 2
    // established as reachable. That this line and the reachable line are the same one is
    // asserted by route-reachability.test.ts, which is where it belongs — a source check alone
    // cannot know which registration serves.
    const reg = LINES[registrations.find(r => r.verb === 'DELETE' && r.path === '/api/sippy/tariffs/:id')!.line - 1];
    expect(reg).toContain("requireRole(['admin']");
  });

  it("the floor did not bring a confirmation guard with it", () => {
    // A confirmation control for this route is a tightening decision above the floor, recorded
    // separately. Step 3 was the floor only.
    const a = SRC.indexOf("app.delete('/api/sippy/tariffs/:id'");
    const handler = SRC.slice(a, SRC.indexOf('\n  app.', a + 10));
    expect(handler).not.toContain('confirmation');
  });
});
