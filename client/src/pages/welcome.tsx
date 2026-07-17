/**
 * welcome.tsx — Welcome Gateway (Sprint 1).
 *
 * Single responsibility: post-login orchestration.
 *
 * 1. Load the authenticated user (useAuth → GET /api/auth/user)
 * 2. Call resolvePortalDestination() — routing logic lives there, not here
 * 3. Read the `reason` to show the right loading message
 * 4. Redirect
 *
 * This page never contains routing rules. When the access model changes,
 * update portal-resolver.ts — not this file.
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Loader2, ShieldCheck } from "lucide-react";
import {
  resolvePortalDestination,
  type PortalResolution,
} from "@/lib/portal-resolver";

// Human-readable loading messages keyed by reason code
const LOADING_MESSAGES: Record<string, string> = {
  platform:           "Loading Platform…",
  single_portal:      "Loading Portal…",
  workspace_selector: "Preparing your workspaces…",
  no_portals:         "",
};

// Delay (ms) before redirecting — lets the user see the branded loading screen
const REDIRECT_DELAY_MS = 1000;

export default function WelcomePage() {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();
  const [resolution, setResolution] = useState<PortalResolution | null>(null);

  useEffect(() => {
    if (isLoading) return;

    if (!user) {
      setLocation("/login");
      return;
    }

    const u = user as any;
    const result = resolvePortalDestination({
      platformAccessType: u.platformAccessType ?? "full_platform",
      portals:            u.portals            ?? [],
      defaultPortal:      u.defaultPortal      ?? null,
    });

    setResolution(result);

    // /welcome is the sentinel for "no portals assigned" — don't redirect, show message
    if (result.destination !== "/welcome") {
      const timer = setTimeout(() => {
        window.location.replace(result.destination);
      }, REDIRECT_DELAY_MS);
      return () => clearTimeout(timer);
    }
  }, [user, isLoading, setLocation]);

  const u = user as any;
  const firstName: string = u?.firstName ?? u?.username ?? "";

  const loadingMessage = resolution
    ? LOADING_MESSAGES[resolution.reason] ?? "Loading…"
    : "Loading…";

  const isNoPortals = resolution?.reason === "no_portals";

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-6 p-4">
      {/* Branded loading state */}
      {!isNoPortals && (
        <div className="text-center space-y-6">
          {/* Auth success badge */}
          <div className="flex flex-col items-center gap-3">
            <div className="p-4 bg-primary/10 rounded-2xl ring-1 ring-primary/20 shadow-lg shadow-primary/10">
              <ShieldCheck className="w-10 h-10 text-primary" />
            </div>
            <span className="text-xs font-medium text-primary/80 tracking-wider uppercase">
              Authentication Successful
            </span>
          </div>

          {/* Welcome message */}
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold">
              Welcome back{firstName ? `, ${firstName}` : ""}!
            </h1>
            <p className="text-muted-foreground text-sm">{loadingMessage}</p>
          </div>

          <Loader2 className="w-6 h-6 animate-spin text-primary mx-auto" />
        </div>
      )}

      {/* No portals assigned — portal_only user, admin must act */}
      {isNoPortals && (
        <div className="text-center max-w-sm space-y-4">
          <div className="p-4 bg-primary/10 rounded-2xl ring-1 ring-primary/20 mx-auto w-fit">
            <ShieldCheck className="w-10 h-10 text-primary" />
          </div>
          <h1 className="text-2xl font-semibold">
            Welcome{firstName ? `, ${firstName}` : ""}!
          </h1>
          <div className="border border-border rounded-lg p-6 space-y-2 text-sm text-muted-foreground bg-card">
            <p className="font-medium text-foreground">
              No portals assigned yet.
            </p>
            <p>
              Your account is configured for portal-only access but no portals
              have been assigned. Please contact your administrator.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
