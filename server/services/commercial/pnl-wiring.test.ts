/**
 * How the Commercial P&L is wired — the properties that live in the route and the page rather
 * than in the arithmetic, and that pnl.test.ts therefore cannot see.
 *
 * Source-reading, like the other route-boundary tests here (kam-authorization, commercial-nav):
 * the route is inline in routes-commercial.ts and not importable without a database. The
 * assertions are scoped to the P&L route's own slice, so an unrelated route legitimately reading
 * financial_snapshot (the intelligence trend does) cannot satisfy or break them.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const strip = (t: string) => t.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const ROUTES = strip(readFileSync(join(__dirname, '..', '..', 'routes-commercial.ts'), 'utf8'));
const WS     = strip(readFileSync(join(__dirname, '..', '..', '..', 'client', 'src', 'pages', 'commercial-workspace.tsx'), 'utf8'));

/** The P&L route only: from its registration to the next route's. */
const PNL = (() => {
  const at = ROUTES.indexOf("app.get('/api/commercial/reports/pnl'");
  expect(at, 'the P&L route must exist').toBeGreaterThan(-1);
  const end = ROUTES.indexOf("app.get('/api/commercial/actions'", at);
  expect(end).toBeGreaterThan(at);
  return ROUTES.slice(at, end);
})();

describe('the route consumes the shared pieces rather than restating them', () => {
  it('resolves scope through resolveCommercialScope — no second hierarchy implementation', () => {
    expect(PNL).toContain('resolveCommercialScope(req)');
    expect(PNL).not.toMatch(/FROM\s+kam_accounts|FROM\s+kams\b/);
  });

  it('intersects the requested accounts with scope via intersectScope', () => {
    expect(PNL).toContain('intersectScope(');
  });

  it('validates the range through parseDateRange and shapes through shapePnl', () => {
    expect(PNL).toContain('parseDateRange(');
    expect(PNL).toContain('shapePnl(');
  });

  it('requires auth', () => {
    expect(PNL).toMatch(/app\.get\('\/api\/commercial\/reports\/pnl',\s*requireAuth/);
  });
});

describe('the data boundary — executed results only', () => {
  /**
   * Vendor and aggregate rows share the table. A SELECT without this predicate double- or
   * triple-counts, silently. So EVERY read carries it.
   */
  /**
   * Each read is examined ONLY up to its own closing backtick. A fixed-width window was tried
   * first and a mutation that dropped the predicate from the per-client read was NOT caught:
   * the window ran on into the next query and borrowed its row_type. The window has to end
   * where the SQL does.
   */
  const READS = () => [...PNL.matchAll(/FROM\s+financial_snapshot/g)].map(m => {
    const end = PNL.indexOf('`', m.index!);
    expect(end, `unterminated SQL after offset ${m.index}`).toBeGreaterThan(m.index!);
    return PNL.slice(m.index!, end);
  });

  it("every FROM financial_snapshot in the route is paired with row_type = 'client' — within its own SQL", () => {
    const reads = READS();
    expect(reads.length, 'expected the daily, per-client and earliest reads').toBe(3);
    for (const sql of reads) {
      expect(sql, sql.slice(0, 60)).toMatch(/row_type\s*=\s*'client'/);
    }
  });

  it('the predicate count equals the read count — none shared, none missing', () => {
    const preds = (PNL.match(/row_type\s*=\s*'client'/g) ?? []).length;
    expect(preds).toBe(3);
  });

  it('never reads product_rates — that table is intent, this report is execution', () => {
    expect(PNL).not.toMatch(/product_rates|productRates/);
  });

  /**
   * THE DIRECTION OF THE QUERY IS THE BOUNDARY. Scope decides the ids; the ids decide the rows.
   * Every read filters on the account list, so no row outside scope can be aggregated in.
   */
  it('every read is bounded by the scoped account list — within its own SQL', () => {
    for (const sql of READS()) {
      expect(sql, sql.slice(0, 60)).toMatch(/account_id\s*=\s*ANY\(\$1\)/);
    }
  });

  it('the range is applied server-side, in the query', () => {
    expect(PNL).toMatch(/report_date\s+BETWEEN\s+\$2\s+AND\s+\$3/);
  });
});

describe('an empty scope runs no query', () => {
  /**
   * `intersectScope` returns [] both for a KAM with no accounts and for a request made entirely
   * of foreign ids. In either case an empty ANY() must never be reached — it has to return
   * before pool.query, not rely on the database returning nothing.
   */
  it('returns before the first pool.query when the account list is empty', () => {
    const guard = PNL.indexOf('accountIds.length === 0');
    const query = PNL.indexOf('pool.query(');
    expect(guard).toBeGreaterThan(-1);
    expect(query).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(query);
    const guardBlock = PNL.slice(guard, guard + 200);
    expect(guardBlock).toMatch(/return res\.json\(/);
  });

  it('a scope error is answered with the same shape, not a 403', () => {
    const at = PNL.indexOf('scope.scopeError');
    expect(at).toBeGreaterThan(-1);
    expect(PNL.slice(at, at + 300)).toMatch(/return res\.json\(\{ scopeError: scope\.scopeError/);
    expect(PNL).not.toMatch(/status\(403\)/);
  });
});

describe('the coverage denominator is the caller\'s scope', () => {
  /**
   * `scopeAccountIds: scope.accountIds` — the resolved scope, NOT the intersected filter and
   * NOT an estate-wide count. A four-account KAM reads "1 of 4".
   */
  it('passes the resolved scope, not the filtered list, as the denominator', () => {
    const calls = [...PNL.matchAll(/scopeAccountIds:\s*([A-Za-z.]+)/g)].map(m => m[1]);
    expect(calls.length).toBeGreaterThan(0);
    for (const v of calls) expect(v).toBe('scope.accountIds');
  });
});

describe('the Commercial workspace renders the P&L inside the portal', () => {
  it('the P&L tab mounts the in-portal report and fetches the scoped endpoint', () => {
    expect(WS).toContain("{tab === 'pnl' && <PnlReport />}");
    expect(WS).toContain('/api/commercial/reports/pnl?from=');
  });

  /**
   * The four dead-end escapes. All four targets require ['admin','management']; for a kam
   * they led out of the portal to a 403. /bitseye2 is deliberately NOT in this list (Gate D),
   * and the BITSAUTO logo's escape to "/" is deliberate (Gate C) — see the tests that keep them.
   */
  it('no longer links to /analytics, /finance-cockpit, /revenue-heatmap or /traffic-forecast', () => {
    for (const target of ['/analytics', '/finance-cockpit', '/revenue-heatmap', '/traffic-forecast']) {
      expect(WS, target).not.toMatch(new RegExp(`href[=:]\\s*["'\`{]*${target.replace('/', '\\/')}["'\`]`));
    }
  });

  it('keeps the BitsEye2 link — its scoping is Gate D, not this change', () => {
    expect(WS).toContain('href="/bitseye2"');
  });

  /** Rule 7 in the UI: a day with no row must say so, never show $0.00. */
  it('renders a missing day as "No data", not as a zero', () => {
    const at = WS.indexOf('data-testid="pnl-daily-table"');
    expect(at).toBeGreaterThan(-1);
    const table = WS.slice(at, at + 3000);
    expect(table).toMatch(/p\.revenue == null \?/);
    expect(table).toContain('No data');
  });

  it('draws the margin line without bridging gaps', () => {
    expect(WS).toMatch(/dataKey="margin"[^>]*connectNulls=\{false\}/s);
  });

  it('surfaces all three notices from the server, not a local paraphrase', () => {
    for (const n of ['notices.coverage', 'notices.marginQuality', 'notices.costBasis']) {
      expect(WS).toContain(`d.${n}`);
    }
  });
});
