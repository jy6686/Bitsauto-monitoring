/**
 * What the Rate Manager shows when it is opened inside the Commercial Portal.
 *
 * `/commercial/rate-manager` resolves to the SAME component as the platform-wide
 * `/rate-manager` — the module registry maps the key straight to `@/pages/rate-manager`. So
 * Commercial has been seeing all eight tabs, and the three-tab requirement had nowhere to live
 * because no portal-scoped restriction existed anywhere.
 *
 * Commercial gets: Rate Analysis, Send Rate, Push History.
 *
 * AND PUSH HISTORY MUST ACTUALLY BE READ-ONLY, which the tab is not by default. Its table is
 * clean — one query, and both buttons only open a detail drawer — but the drawer carries a
 * "Re-send" that POSTs to the job retry route and re-pushes rates to Sippy, plus a "Download
 * Rate Sheet" that exports the whole price list. The retry route is guarded by
 * requireRole(['admin','management','noc_operator']), which does NOT protect Commercial: the
 * portal admits admin, super_admin and management, so its audience is precisely who that route
 * accepts. Showing the tab without suppressing those controls would hand Commercial a live
 * write path labelled "history".
 *
 * THIS IS PRESENTATION SCOPE, NOT AUTHORIZATION. Hiding a control does not deny the route;
 * /rate-manager and the retry endpoint stay reachable by URL for anyone whose role permits
 * them. That is deliberate — the requirement was a portal navigation scope, not removal of the
 * underlying capability, and admin/management keep the full Rate Manager elsewhere. If the
 * capability must actually be denied, that is a server-side change and separate work.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { visibleRateManagerTabs, allowsJobWriteActions, COMMERCIAL_TAB_KEYS } from '@/lib/rate-manager-scope';

/** The real tab source, in the order the page declares it. */
const ALL = [
  { key: 'analysis',      label: 'Rate Analysis' },
  { key: 'vendor-rates',  label: 'Vendor Rates'  },
  { key: 'send',          label: 'Send Rate'     },
  { key: 'jobs',          label: 'Push History'  },
  { key: 'eligibility',   label: 'Eligibility'   },
  { key: 'product-rates', label: 'Product Rates' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'intelligence',  label: 'Intelligence'  },
] as const;

describe('Commercial sees exactly three tabs', () => {
  it('gives Commercial Rate Analysis, Send Rate and Push History', () => {
    expect(visibleRateManagerTabs(ALL, 'commercial').map(t => t.key)).toEqual(['analysis', 'send', 'jobs']);
  });

  it('keeps them in the page\'s own order rather than re-ordering', () => {
    const labels = visibleRateManagerTabs(ALL, 'commercial').map(t => t.label);
    expect(labels).toEqual(['Rate Analysis', 'Send Rate', 'Push History']);
  });

  it('filters the caller\'s array — it does not carry a second copy of the tab list', () => {
    const out = visibleRateManagerTabs(ALL, 'commercial');
    for (const t of out) expect(ALL).toContain(t);
  });
});

describe('every other context is untouched', () => {
  it('outside a portal, all eight tabs remain', () => {
    expect(visibleRateManagerTabs(ALL, null)).toHaveLength(8);
  });

  it('another portal is not restricted by this rule', () => {
    expect(visibleRateManagerTabs(ALL, 'noc')).toHaveLength(8);
  });

  it('an unrecognised portal is not silently restricted', () => {
    expect(visibleRateManagerTabs(ALL, 'something-new')).toHaveLength(8);
  });

  /** A tab added to the page later must not appear in Commercial by default. */
  it('a newly added tab does not leak into Commercial', () => {
    const withNew = [...ALL, { key: 'brand-new', label: 'Brand New' }] as const;
    expect(visibleRateManagerTabs(withNew, 'commercial').map(t => t.key)).toEqual(['analysis', 'send', 'jobs']);
  });

  it('the allowlist names exactly the three', () => {
    expect([...COMMERCIAL_TAB_KEYS].sort()).toEqual(['analysis', 'jobs', 'send']);
  });
});

describe('Push History is read-only inside Commercial', () => {
  it('denies the job write actions in Commercial', () => {
    expect(allowsJobWriteActions('commercial')).toBe(false);
  });

  it('allows them everywhere else, including outside a portal', () => {
    expect(allowsJobWriteActions(null)).toBe(true);
    expect(allowsJobWriteActions('noc')).toBe(true);
    expect(allowsJobWriteActions('finance')).toBe(true);
  });
});

// ── The page is wired to it ──────────────────────────────────────────────────

const strip = (t: string) => t.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const PAGE = strip(readFileSync(
  join(__dirname, '..', '..', '..', 'client', 'src', 'pages', 'rate-manager.tsx'), 'utf8'));

describe('rate-manager.tsx uses the scope rather than re-deciding it', () => {
  it('knows which portal it is being rendered in', () => {
    expect(PAGE).toMatch(/usePortal\(\)/);
  });

  it('renders the tab strip through the filter', () => {
    expect(PAGE).toContain('visibleRateManagerTabs(');
  });

  it('passes the write permission down to the job drawer', () => {
    expect(PAGE).toContain('allowsJobWriteActions(');
  });

  /**
   * The drawer's two controls must both be conditional. Re-send is the write; Download Rate
   * Sheet is the whole price list, which the export route's own comment calls the most
   * disclosive of the set.
   */
  const DRAWER = (() => {
    const a = PAGE.indexOf('function PushJobDrawer');
    expect(a, 'the drawer must exist').toBeGreaterThan(-1);
    const b = PAGE.indexOf('\nfunction ', a + 10);
    expect(b).toBeGreaterThan(a);
    return PAGE.slice(a, b);
  })();

  it('the drawer takes the permission as a prop', () => {
    expect(DRAWER).toMatch(/canWrite/);
  });

  /**
   * Position, not proximity. Both controls must sit INSIDE the `canWrite &&` block: the gate
   * opens before each of them and closes after both. An earlier version of these two tests
   * searched a fixed window of characters before each control, which failed on the honest
   * implementation simply because the Download handler is long — a window is a proxy for
   * containment, and a bad one.
   */
  const gateOpen  = DRAWER.indexOf('canWrite && (');
  const gateClose = DRAWER.indexOf('</>)}', gateOpen);

  it('opens a canWrite gate and closes it', () => {
    expect(gateOpen, 'the drawer must gate its actions on canWrite').toBeGreaterThan(-1);
    expect(gateClose).toBeGreaterThan(gateOpen);
  });

  it('Re-send sits inside the gate', () => {
    const at = DRAWER.indexOf('/retry');
    expect(at, 'the retry control must still exist for permitted contexts').toBeGreaterThan(-1);
    expect(at).toBeGreaterThan(gateOpen);
    expect(at).toBeLessThan(gateClose);
  });

  it('Download Rate Sheet sits inside the gate', () => {
    const at = DRAWER.indexOf('Download Rate Sheet');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeGreaterThan(gateOpen);
    expect(at).toBeLessThan(gateClose);
  });

  /** The capability itself must survive for the contexts that keep it. */
  it('still offers both controls somewhere — this hides, it does not delete', () => {
    expect(DRAWER).toContain('/retry');
    expect(DRAWER).toContain('Download Rate Sheet');
  });
});
