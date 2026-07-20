/**
 * platform-access-guard.tsx — Sprint #365 PortalBoundaryGuard.
 *
 * Headless component (renders null). Sits once inside Router, above the Switch.
 * On every navigation, enforces access-scope boundaries:
 *   FULL_PLATFORM  → always allowed; no redirect
 *   MULTI_PORTAL   → always allowed on main platform (hybrid); no redirect
 *   PORTAL_ONLY    → redirect to landingRoute(); never see the main platform
 *
 * Skips:
 *   • Portal routes      — /{noc,finance,commercial,…}/* are portal territory
 *   • Auth/gateway pages — /login, /welcome, /workspace-selector, /portal-select
 *
 * Uses AuthorizationProvider (Sprint #365) rather than reading `platformAccessType`
 * directly from the user object. This is the single enforcement point for
 * scope-based URL escape prevention.
 */
import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { usePortal } from "@/context/portal-context";
import { useAuthorization } from "@/context/authorization-context";

// Pages that are part of the auth/gateway flow — never redirect away from these
const AUTH_ROUTES = new Set([
  "/login",
  "/welcome",
  "/workspace-selector",
  "/portal-select",
]);

export function PlatformAccessGuard() {
  const { isLoading }             = useAuth();
  const { activePortal }          = usePortal();
  const { isPortalOnly, landingRoute, isLoading: authzLoading } = useAuthorization();
  const [location, setLocation]   = useLocation();

  // Track last redirect to prevent redirect loops
  const lastRedirect = useRef<string | null>(null);

  useEffect(() => {
    // Wait for both auth and authorization context to resolve
    if (isLoading || authzLoading) return;

    // On a portal route — guard does not apply
    if (activePortal) return;

    // On an auth/gateway page — exempt
    if (AUTH_ROUTES.has(location)) return;

    // FULL_PLATFORM and MULTI_PORTAL (hybrid) users are always allowed
    if (!isPortalOnly) return;

    // PORTAL_ONLY user on a main-platform route — redirect to their landing
    const destination = landingRoute();

    if (destination !== location && destination !== lastRedirect.current) {
      lastRedirect.current = destination;
      setLocation(destination);
    }
  }, [isLoading, authzLoading, activePortal, location, isPortalOnly, landingRoute, setLocation]);

  return null; // no UI — side-effects only
}

/** Alias export for Sprint #365 spec compliance. */
export const PortalBoundaryGuard = PlatformAccessGuard;
