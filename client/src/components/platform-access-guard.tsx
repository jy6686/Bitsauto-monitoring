/**
 * platform-access-guard.tsx — Sprint 1 frontend access enforcement.
 *
 * Headless component (renders null). Sits once inside Router, above the Switch.
 * On every navigation, silently redirects portal_only users away from
 * main-platform routes toward their assigned portal(s).
 *
 * Responsibility: "Can this authenticated user access the current route?"
 *
 * Chain:
 *   Route (App.tsx)
 *     └─ ProtectedRoute         → Is the user authenticated?
 *          └─ PlatformAccessGuard → Can the user access the main platform?
 *               └─ PortalResolver  → Which portal should they enter?
 *                    └─ WorkspaceSelector → Let the user choose (if multiple)
 *
 * Rules:
 *   full_platform  → always allowed
 *   hybrid         → always allowed (has platform + portal access)
 *   portal_only    → redirect via PortalResolver; never see main platform
 *
 * Skips:
 *   • Portal routes      — activePortal is set; guard does not apply
 *   • Auth pages         — /login, /welcome, /workspace-selector are exempt
 */
import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { usePortal } from "@/context/portal-context";
import { resolvePortalDestination } from "@/lib/portal-resolver";

// Pages that are part of the auth flow — never redirect away from these
const AUTH_ROUTES = new Set(["/login", "/welcome", "/workspace-selector"]);

export function PlatformAccessGuard() {
  const { user, isLoading } = useAuth();
  const { activePortal } = usePortal();
  const [location, setLocation] = useLocation();

  // Track last redirect to prevent redirect loops
  const lastRedirect = useRef<string | null>(null);

  useEffect(() => {
    // Wait for auth to resolve
    if (isLoading || !user) return;

    // On a portal route — guard does not apply
    if (activePortal) return;

    // On an auth/gateway page — exempt
    if (AUTH_ROUTES.has(location)) return;

    const u = user as any;
    const type: string = u?.platformAccessType ?? "full_platform";

    // full_platform and hybrid users are always allowed on main platform
    if (type !== "portal_only") return;

    // portal_only user on a main-platform route — redirect
    const resolution = resolvePortalDestination({
      platformAccessType: type,
      portals:       u?.portals      ?? [],
      defaultPortal: u?.defaultPortal ?? null,
    });

    // Guard against redirect loops
    if (
      resolution.destination !== location &&
      resolution.destination !== lastRedirect.current
    ) {
      lastRedirect.current = resolution.destination;
      setLocation(resolution.destination);
    }
  }, [user, isLoading, activePortal, location, setLocation]);

  return null; // no UI — side-effects only
}
