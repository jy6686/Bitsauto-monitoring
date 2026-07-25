// ── Feature Flags — NAV-WORKSPACE Phase 4 ─────────────────────────────────────
// Controls progressive migration of portal navigation consumers from the legacy
// Model B sources (DOMAINS constant, portal_top_nav_* tables, module registry)
// to the Portal Workspace API (GET /api/portals/:slug/workspace).
//
// portalWorkspaceNavigation
//   false (default) → legacy navigation remains the production path. Zero
//                     behavior change anywhere.
//   true            → Phase 6 consumers read from the workspace API.
//                     (No consumer honors this flag until Phase 6 lands —
//                     until then the flag only affects the startup log line.)
//
// Enable locally WITHOUT affecting production (checked in this order):
//   1. localStorage.setItem('ff.portalWorkspaceNavigation', 'true')  — per-browser,
//      survives reloads, never ships. 'false' forces off. Remove to fall through.
//   2. VITE_PORTAL_WORKSPACE_NAV=true at build time — per-environment.
//   3. DEFAULT (false).
//
// Frozen workspace invariants consumers must verify after each Phase 6 step
// (flag ON, dev): navigationChecksum c3760592395da687 · 6 domains ·
// search index 55 · hidden absent · routing-manager/call-recordings read-only.

const DEFAULT_PORTAL_WORKSPACE_NAV = false;

function computePortalWorkspaceNav(): boolean {
  try {
    const ls = window.localStorage.getItem("ff.portalWorkspaceNavigation");
    if (ls === "true")  return true;
    if (ls === "false") return false;
  } catch {
    /* storage unavailable — fall through */
  }
  if (import.meta.env?.VITE_PORTAL_WORKSPACE_NAV === "true") return true;
  return DEFAULT_PORTAL_WORKSPACE_NAV;
}

let cached: boolean | null = null;

/** Single source of truth for the navigation-provider decision. Logs once. */
export function isPortalWorkspaceNavEnabled(): boolean {
  if (cached === null) {
    cached = computePortalWorkspaceNav();
    console.info(
      `[nav-provider] active: ${cached ? "workspace-api (Model A)" : "legacy (Model B)"}` +
      ` — portalWorkspaceNavigation=${cached}`,
    );
  }
  return cached;
}
