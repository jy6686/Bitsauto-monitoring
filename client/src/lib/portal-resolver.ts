/**
 * portal-resolver.ts — Sprint 1 portal routing decision logic.
 *
 * Single responsibility: given a user's access type and portal assignments,
 * return the correct destination path AND the reason for that decision.
 * No React. No hooks. Pure function — fully testable, reusable by WelcomePage,
 * future IAM pages, and any server-side redirect logic.
 *
 * Access types
 * ─────────────────────────────────────────────────────────────────────────────
 *  full_platform  Unrestricted access to the main platform. Always → /.
 *
 *  portal_only    Restricted to assigned portals only.
 *                 1 portal  → /:slug               reason: "single_portal"
 *                 N portals → /workspace-selector  reason: "workspace_selector"
 *                 0 portals → /welcome             reason: "no_portals"
 *
 *                 defaultPortal is only used if it is in the portals[] assignment
 *                 list. A stale default_portal that was removed by an admin is
 *                 treated as no-portals — the user sees the admin contact card.
 *
 *  hybrid         Has both main-platform access AND portal assignments.
 *                 1 portal  → /:slug               reason: "single_portal"
 *                 N portals → /workspace-selector  reason: "workspace_selector"
 *                 0 portals → /                    reason: "platform"
 *
 *                 Same defaultPortal validation applies. A stale default_portal
 *                 falls back to the main platform rather than a removed portal.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Add new access types here — not in ProtectedRoute, WelcomePage, or any
 * component. This is the single source of truth for routing decisions.
 */

export interface PortalResolutionInput {
  platformAccessType: string;   // 'full_platform' | 'portal_only' | 'hybrid'
  portals: string[];            // ordered list of portal slugs the user can access
  defaultPortal: string | null; // preferred portal (used as a label/fallback hint)
}

/**
 * Reason codes let WelcomePage show the right UI message without
 * re-implementing any routing logic.
 *
 *  "platform"           → user is going to the full main platform
 *  "single_portal"      → user is going to exactly one portal
 *  "workspace_selector" → user has multiple portals and must choose
 *  "no_portals"         → portal_only user with no portals assigned (admin must act)
 */
export type ResolutionReason =
  | "platform"
  | "single_portal"
  | "workspace_selector"
  | "no_portals";

export interface PortalResolution {
  destination: string;      // absolute path to navigate to
  reason: ResolutionReason; // why this destination was chosen
  portalSlug?: string;      // set when reason === "single_portal"
}

export function resolvePortalDestination(
  opts: PortalResolutionInput
): PortalResolution {
  const { platformAccessType, portals, defaultPortal } = opts;

  switch (platformAccessType) {

    case "full_platform":
      return { destination: "/", reason: "platform" };

    case "portal_only": {
      if (portals.length === 1) {
        return { destination: `/${portals[0]}`, reason: "single_portal", portalSlug: portals[0] };
      }
      if (portals.length > 1) {
        return { destination: "/workspace-selector", reason: "workspace_selector" };
      }
      // Only trust defaultPortal if the user is still assigned to it.
      // If an admin removed the assignment, portals.includes() returns false
      // and we fall through to "no_portals" so the admin-contact card is shown.
      const hasDefaultPortal = defaultPortal && portals.includes(defaultPortal);
      if (hasDefaultPortal) {
        return { destination: `/${defaultPortal}`, reason: "single_portal", portalSlug: defaultPortal };
      }
      // No valid portals — stay on /welcome so the admin-contact message shows
      return { destination: "/welcome", reason: "no_portals" };
    }

    case "hybrid": {
      // Hybrid: platform access + portal assignments.
      // Prefer workspace selector when multiple portals are assigned.
      if (portals.length > 1) {
        return { destination: "/workspace-selector", reason: "workspace_selector" };
      }
      if (portals.length === 1) {
        return { destination: `/${portals[0]}`, reason: "single_portal", portalSlug: portals[0] };
      }
      // Same defaultPortal validation: only use it if still assigned.
      // A stale default_portal that was removed falls back to the main platform.
      const hasDefaultPortal = defaultPortal && portals.includes(defaultPortal);
      if (hasDefaultPortal) {
        return { destination: `/${defaultPortal}`, reason: "single_portal", portalSlug: defaultPortal };
      }
      // Hybrid with no portal assignments → full platform
      return { destination: "/", reason: "platform" };
    }

    default:
      console.warn(
        `[portal-resolver] Unknown platformAccessType: "${platformAccessType}". Falling back to /.`
      );
      return { destination: "/", reason: "platform" };
  }
}
