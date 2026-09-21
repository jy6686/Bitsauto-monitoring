/**
 * What the Rate Manager shows when it is opened inside a portal.
 *
 * `/commercial/rate-manager` resolves to the SAME component as the platform-wide
 * `/rate-manager` — the module registry maps the key straight to the page — so Commercial saw
 * all eight tabs and there was nowhere for a three-tab rule to live. This is that place.
 *
 * THIS IS PRESENTATION SCOPE, NOT AUTHORIZATION. Filtering a tab strip hides navigation; it
 * denies nothing. `/rate-manager` and every route behind it stay reachable by URL for anyone
 * whose role permits them, and admin/management keep the full Rate Manager outside this portal.
 * That is the requirement as stated: a portal navigation scope, not removal of the underlying
 * capability. If a capability must actually be DENIED to Commercial, that is a server-side
 * change and deliberately not done here.
 */

/**
 * Commercial's three, as an allowlist. A tab added to the page later does not appear here
 * until someone writes its key down, which is the safe direction for a view that exists to
 * show less.
 */
export const COMMERCIAL_TAB_KEYS = ['analysis', 'send', 'jobs'] as const;

/** Portals with a restricted Rate Manager view. Everything else sees the page unchanged. */
const RESTRICTED: Record<string, readonly string[]> = {
  commercial: COMMERCIAL_TAB_KEYS,
};

/**
 * Filter the page's own tab array. The array is passed in rather than duplicated here, so the
 * labels and their order have exactly one definition and the two cannot drift apart.
 */
export function visibleRateManagerTabs<T extends { key: string }>(
  tabs: readonly T[],
  activePortal: string | null,
): T[] {
  const allowed = activePortal ? RESTRICTED[activePortal] : undefined;
  if (!allowed) return [...tabs];
  return tabs.filter(t => allowed.includes(t.key));
}

/**
 * Whether the push-job drawer may offer its write and export controls.
 *
 * Push History is required to be READ-ONLY in Commercial, and by default it is not: the
 * drawer's "Re-send" POSTs to the job retry route and re-pushes rates to Sippy, and "Download
 * Rate Sheet" exports the entire price list. The retry route's own guard —
 * requireRole(['admin','management','noc_operator']) — gives Commercial no protection, because
 * the portal admits admin, super_admin and management: its audience is precisely who that
 * route accepts. So the controls are suppressed here.
 *
 * Again: suppressed in this view, not denied. The endpoints remain callable.
 */
export function allowsJobWriteActions(activePortal: string | null): boolean {
  return activePortal !== 'commercial';
}
