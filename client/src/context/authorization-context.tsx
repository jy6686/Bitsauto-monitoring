/**
 * authorization-context.tsx — Sprint #365 Authorization Layer.
 *
 * Single responsibility: given the authenticated user's access profile,
 * expose scope helpers (isFullPlatform, isPortalOnly, canAccessPortal),
 * and the canonical post-login landing route (landingRoute()).
 *
 * Access scope vocabulary (normalized from DB's lowercase values):
 *   FULL_PLATFORM  ← full_platform  — unrestricted main-platform access
 *   PORTAL_ONLY    ← portal_only    — restricted to assigned portals only
 *   MULTI_PORTAL   ← hybrid         — platform + portal access
 *
 * This context is the single source of truth that login, guards, and
 * gateway pages consume. PortalBoundaryGuard replaces PlatformAccessGuard
 * and plugs directly into this context.
 */
import {
  createContext,
  useContext,
  useMemo,
  useEffect,
  type ReactNode,
} from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { resolvePortalDestination } from "@/lib/portal-resolver";
import { VALID_PORTAL_KEYS, type PortalKey } from "@shared/lib/portal-constants";

// ── Canonical access scope enum ────────────────────────────────────────────────
export type AccessScope = "FULL_PLATFORM" | "PORTAL_ONLY" | "MULTI_PORTAL";

/** Map DB / API lowercase value to the canonical uppercase scope. */
function normalizeAccessScope(raw: string | null | undefined): AccessScope {
  switch ((raw ?? "").toLowerCase()) {
    case "portal_only": return "PORTAL_ONLY";
    case "hybrid":      return "MULTI_PORTAL";
    case "multi_portal":return "MULTI_PORTAL";
    default:            return "FULL_PLATFORM";  // full_platform, global, unknown
  }
}

// ── Context interface ──────────────────────────────────────────────────────────
export interface AuthorizationCtx {
  /** Canonical normalized scope for the current user. */
  accessScope:      AccessScope;
  /** Raw defaultPortal from the user record (may be null). */
  defaultPortal:    string | null;
  /** Portals the user is explicitly assigned to. */
  assignedPortals:  string[];

  // Helpers
  isFullPlatform:   boolean;   // true when accessScope === "FULL_PLATFORM"
  isPortalOnly:     boolean;   // true when accessScope === "PORTAL_ONLY"
  isMultiPortal:    boolean;   // true when accessScope === "MULTI_PORTAL"

  /** Returns true when the user may access the given portal slug. */
  canAccessPortal:  (portalSlug: PortalKey | string) => boolean;

  /**
   * Returns the route the user should be sent to after a successful login.
   * Delegates to resolvePortalDestination — single source of routing truth.
   */
  landingRoute:     () => string;

  /** True while auth is still loading — callers can show a skeleton. */
  isLoading:        boolean;
}

// ── Sensible unauthenticated defaults ─────────────────────────────────────────
const DEFAULT_CTX: AuthorizationCtx = {
  accessScope:     "FULL_PLATFORM",
  defaultPortal:   null,
  assignedPortals: [],
  isFullPlatform:  true,
  isPortalOnly:    false,
  isMultiPortal:   false,
  canAccessPortal: () => false,
  landingRoute:    () => "/",
  isLoading:       true,
};

const AuthorizationContext = createContext<AuthorizationCtx>(DEFAULT_CTX);

// ── Provider ───────────────────────────────────────────────────────────────────
export function AuthorizationProvider({ children }: { children: ReactNode }) {
  const { user, isLoading, logout } = useAuth();
  const [, navigate]                = useLocation();

  // ── Disabled-user guard ─────────────────────────────────────────────────────
  // If the session contains a user marked as disabled, force logout immediately.
  // This handles the edge-case where a session cookie persists after an admin
  // disables the account — the next API response triggers this cleanup.
  useEffect(() => {
    if (!user) return;
    const u = user as any;
    if (u.status === "disabled") {
      console.warn("[authorization] Disabled user session detected — forcing logout.");
      logout?.();
      navigate("/login");
    }
  }, [user, logout, navigate]);

  const value = useMemo<AuthorizationCtx>(() => {
    if (!user) {
      return { ...DEFAULT_CTX, isLoading };
    }

    const u = user as any;

    // Normalize — accept platformAccessType from /api/auth/user response
    const rawScope       = u.platformAccessType ?? u.accessScope ?? "full_platform";
    const accessScope    = normalizeAccessScope(rawScope);
    const defaultPortal  = u.defaultPortal ?? null;
    // /api/auth/user returns `portals` + `assignedPortals` (both identical arrays)
    // Filter to only known valid portal keys for safety
    const rawPortals: string[] = u.assignedPortals ?? u.portals ?? [];
    const assignedPortals = rawPortals.filter(
      (s) => (VALID_PORTAL_KEYS as readonly string[]).includes(s)
    );

    const isFullPlatform = accessScope === "FULL_PLATFORM";
    const isPortalOnly   = accessScope === "PORTAL_ONLY";
    const isMultiPortal  = accessScope === "MULTI_PORTAL";

    const canAccessPortal = (portalSlug: string): boolean => {
      if (isFullPlatform) return true;             // FULL_PLATFORM: access to everything
      return assignedPortals.includes(portalSlug); // PORTAL_ONLY / MULTI_PORTAL: assignment required
    };

    const landingRoute = (): string => {
      // Delegate to the pure resolver (single source of routing truth)
      const resolution = resolvePortalDestination({
        platformAccessType: rawScope,     // resolver uses lowercase DB values
        portals:            assignedPortals,
        defaultPortal,
      });
      return resolution.destination;
    };

    return {
      accessScope,
      defaultPortal,
      assignedPortals,
      isFullPlatform,
      isPortalOnly,
      isMultiPortal,
      canAccessPortal,
      landingRoute,
      isLoading: false,
    };
  }, [user, isLoading]);

  return (
    <AuthorizationContext.Provider value={value}>
      {children}
    </AuthorizationContext.Provider>
  );
}

// ── Hooks ──────────────────────────────────────────────────────────────────────
export const useAuthorization = () => useContext(AuthorizationContext);
