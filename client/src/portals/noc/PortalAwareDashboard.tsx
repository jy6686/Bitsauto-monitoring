/**
 * PortalAwareDashboard.tsx
 *
 * Thin portal-isolation wrapper for the shared main-platform DashboardPage,
 * used as the NOC portal's landing page (module key "dashboard" — see
 * db.ts runSafeMigrations "NOC portal home fix").
 *
 * DashboardPage was built for the main platform and contains hardcoded
 * links (e.g. "/calls", "/alerts") that would escape the portal namespace
 * if clicked without interception. This wrapper listens for clicks on those
 * anchors (capture phase, before wouter's handler) and rewrites them to their
 * /noc/... equivalents, keeping the user inside the portal. Identical
 * technique to PortalAwareNocDashboard.tsx (../noc/PortalAwareNocDashboard.tsx),
 * applied here to the generic dashboard page instead of NocDashboardPage.
 *
 * Every entry below was verified against App.tsx's actual <Route> → component
 * binding for that path, cross-referenced with the component each NOC
 * module-registry key imports — not guessed from path names. Three hardcoded
 * hrefs found in dashboard.tsx during that audit (/fraud-engine, /prefix-
 * intelligence, /stability-timeline, /approval-queue) do not match ANY
 * App.tsx route at all (dead links on the main platform itself, e.g. the
 * real routes are /fraud, /vendor-prefix-intelligence, /vendor-stability-
 * timeline, /approvals) — that is a pre-existing main-platform bug, out of
 * scope for portal isolation, and is intentionally NOT mapped here.
 *
 * Links with NO portal equivalent (e.g. "/settings", "/console") are left
 * unchanged — they navigate to the main platform as before, same philosophy
 * as PortalAwareNocDashboard.
 *
 * DashboardPage itself is never modified.
 */
import { useRef, useEffect } from "react";
import DashboardPage from "@/pages/dashboard";
import { useLocation } from "wouter";
import { usePortal } from "@/context/portal-context";

/**
 * Main-platform path → NOC portal path.
 * Only includes modules that are actually registered in the NOC portal.
 */
const PORTAL_PATH_MAP: Record<string, string> = {
  "/calls":                "/noc/live-calls",
  "/live-traffic":         "/noc/live-traffic",
  "/traffic-map":          "/noc/traffic-map",
  "/noc-command":          "/noc/noc-command",
  "/ops-console":          "/noc/ops-console",
  "/bitseye2":             "/noc/bitseye",
  "/server-monitoring":    "/noc/server-monitoring",
  "/carrier-scoring":      "/noc/carrier-scoring",
  "/routing-manager":      "/noc/routing-manager",
  "/ai-ops":               "/noc/ai-ops",
  "/carrier-intelligence": "/noc/carrier-intelligence",
  "/alerts":               "/noc/alerts",
  "/balance":              "/noc/balance-monitor",
  "/reports":              "/noc/reports",
};

export default function PortalAwareDashboard() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [, navigate] = useLocation();
  const { activePortal } = usePortal();

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !activePortal) return;

    const handleClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href) return;
      const portalHref = PORTAL_PATH_MAP[href];
      if (portalHref) {
        // Capture phase fires before wouter's bubbling listener.
        // stopPropagation ensures wouter's onClick never fires for this event.
        e.preventDefault();
        e.stopPropagation();
        navigate(portalHref);
      }
    };

    container.addEventListener("click", handleClick, true); // true = capture phase
    return () => container.removeEventListener("click", handleClick, true);
  }, [activePortal, navigate]);

  return (
    <div ref={containerRef}>
      <DashboardPage />
    </div>
  );
}
