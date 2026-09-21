/**
 * Getting to the Rate Manager from inside the Commercial Portal, without leaving it.
 *
 * `2a8effb8` restricted `/commercial/rate-manager` to three tabs — Rate Analysis, Push Rate
 * (the `jobs` tab) and Send Rate — and that is certified in production. But the Commercial
 * Workspace at `/commercial` links to `/rate-manager`, the PLATFORM route, in three places:
 * a "Full Rate Manager" header link and two launcher cards in the Products section whose
 * `action` is interpolated into `/${action}`. That route shows all eight tabs with Re-send and
 * Download intact, so the restriction was one click from being bypassed from inside the portal.
 *
 * The tab filter was never wrong; it was reachable around. This closes the way around.
 *
 * NOT a change to the platform Rate Manager, which keeps all eight tabs and both controls for
 * everyone whose role permits them — that was the explicit requirement.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COMMERCIAL_RATE_MANAGER_PATH, rateManagerPathFor } from '@/lib/commercial-nav';

describe('the path a Commercial user should be sent to', () => {
  it('is the scoped surface, not the platform one', () => {
    expect(COMMERCIAL_RATE_MANAGER_PATH).toBe('/commercial/rate-manager');
  });

  it('resolves to the scoped surface inside the Commercial Portal', () => {
    expect(rateManagerPathFor('commercial')).toBe('/commercial/rate-manager');
  });

  /**
   * Everywhere else keeps the platform route. A helper that always returned the Commercial path
   * would quietly send NOC and Finance users into a three-tab Rate Manager.
   */
  it('keeps the platform route outside the Commercial Portal', () => {
    expect(rateManagerPathFor(null)).toBe('/rate-manager');
    expect(rateManagerPathFor('noc')).toBe('/rate-manager');
    expect(rateManagerPathFor('finance')).toBe('/rate-manager');
  });
});

const strip = (t: string) => t.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const WS = strip(readFileSync(
  join(__dirname, '..', '..', '..', 'client', 'src', 'pages', 'commercial-workspace.tsx'), 'utf8'));
const APP = strip(readFileSync(
  join(__dirname, '..', '..', '..', 'client', 'src', 'App.tsx'), 'utf8'));

describe('the Commercial Workspace no longer sends anyone to the platform Rate Manager', () => {
  /**
   * Link TARGETS only. `/api/rate-manager/kpi`, `/api/rate-manager/jobs` and
   * `/api/rate-manager/products` are query keys, not navigation, and must survive — an earlier
   * draft of this rule would have matched them and demanded their removal.
   */
  it('has no link whose target is the platform route', () => {
    expect(WS).not.toMatch(/href="\/rate-manager"/);
    expect(WS).not.toMatch(/href=\{`\/rate-manager`\}/);
  });

  it('no longer builds a launcher target by interpolating the bare module name', () => {
    expect(WS).not.toMatch(/action:\s*'rate-manager'/);
  });

  it('keeps the API query keys, which are not navigation', () => {
    for (const k of ['/api/rate-manager/kpi', '/api/rate-manager/jobs', '/api/rate-manager/products']) {
      expect(WS, k).toContain(k);
    }
  });

  /**
   * Through the shared constant, not a literal. A literal would satisfy "points somewhere
   * scoped" while leaving the path duplicated in four places, which is how the bypass got in:
   * every link decided its own target.
   */
  it('points at the scoped surface, via the one constant', () => {
    expect(WS).toMatch(/from ["']@\/lib\/commercial-nav["']/);
    expect(WS).toContain('COMMERCIAL_RATE_MANAGER_PATH');
    expect(WS).not.toMatch(/["'`]\/rate-manager["'`]/);
  });

  it('routes the two Products launcher cards there', () => {
    const at = WS.indexOf('Push Rates to Account');
    expect(at, 'the launcher cards must still exist').toBeGreaterThan(-1);
    const block = WS.slice(at, at + 1400);
    expect(block).toMatch(/commercial-nav|COMMERCIAL_RATE_MANAGER_PATH|rateManagerPathFor|\/commercial\/rate-manager/);
  });
});

describe('Rate Manager is reachable from the Commercial sidebar', () => {
  /**
   * The workspace's own sidebar had nine sections and no way to the Rate Manager, which is why
   * the Products launcher existed at all. The entry must NAVIGATE to the scoped surface rather
   * than switch an internal section, because the Rate Manager is a different page.
   */
  /**
   * Anchored on the entry's own testid, not on the words "Rate Manager". The header link is
   * labelled "Full Rate Manager", so a text search was satisfied by that and let the sidebar
   * entry be deleted without failing anything — a mutation caught exactly that.
   */
  const ENTRY = (() => {
    const at = WS.indexOf('data-testid="nav-ws-rate-manager"');
    return at === -1 ? null : WS.slice(Math.max(0, at - 400), at + 400);
  })();

  it('the sidebar offers a Rate Manager entry', () => {
    expect(ENTRY, 'the sidebar must carry a nav-ws-rate-manager entry').not.toBeNull();
    expect(ENTRY!).toMatch(/>\s*Rate Manager\s*</);
  });

  it('that entry is a link to the scoped surface, not a section switch', () => {
    expect(ENTRY!).toMatch(/<Link/);
    expect(ENTRY!).toContain('COMMERCIAL_RATE_MANAGER_PATH');
    expect(ENTRY!).not.toMatch(/setActive\(/);
  });
});

/**
 * Products is not part of the Commercial portal, and `6fde6f88` removed its row from SECTIONS —
 * the only way to reach the section, since setActive() is called from that map alone.
 *
 * THE ASSERTION IS SCOPED TO THE ARRAY, NOT THE FILE. A file-wide search for `products` fails
 * immediately and correctly: SectionId's member, ProductsSection() and the
 * `active === 'products'` branch are all RETAINED ON PURPOSE, so that the decision is a one-line
 * revert rather than a re-implementation. The last rule below guards that retention — a future
 * "remove the dead code" pass has to reverse the decision deliberately instead of quietly.
 */
describe('Products stays out of the Commercial workspace sidebar', () => {
  /** From the array's own declaration to its close — nothing else in the file. */
  const SECTIONS = (() => {
    const at = WS.indexOf('const SECTIONS:');
    expect(at, 'the SECTIONS array must exist').toBeGreaterThan(-1);
    const end = WS.indexOf('];', at);
    expect(end).toBeGreaterThan(at);
    return WS.slice(at, end + 2);
  })();

  const ids = [...SECTIONS.matchAll(/id:\s*'([a-z-]+)'/g)].map(m => m[1]);

  it('has no products row', () => {
    expect(SECTIONS).not.toMatch(/id:\s*'products'/);
    expect(ids).not.toContain('products');
  });

  /**
   * The eight survivors, in order. Without this, deleting the WRONG row would still satisfy the
   * rule above — the test would pass while the sidebar lost Balance or Reports.
   */
  it('keeps the other eight, in order', () => {
    expect(ids).toEqual([
      'dashboard', 'intelligence', 'actions', 'clients',
      'live-calls', 'live-traffic', 'balance', 'reports',
    ]);
  });

  /**
   * Unreachable, not dead. If these three go, the capability has been removed rather than
   * hidden, which is a different decision from the one that was taken.
   */
  it('retains the section itself — SectionId, the component and its render branch', () => {
    expect(WS, 'SectionId member').toMatch(/\|\s*'products'/);
    expect(WS, 'the component').toMatch(/function ProductsSection\(\)/);
    expect(WS, 'the render branch').toMatch(/active === 'products'/);
  });
});

describe('the platform Rate Manager is untouched', () => {
  it('still has its own route', () => {
    expect(APP).toMatch(/<Route path="\/rate-manager">/);
  });

  it('still admits admin and management', () => {
    const at = APP.indexOf('<Route path="/rate-manager">');
    expect(APP.slice(at, at + 260)).toMatch(/requiredRoles=\{\['admin','management'\]\}/);
  });
});
