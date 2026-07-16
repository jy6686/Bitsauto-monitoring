/**
 * PortalAwareNocDashboard.tsx
 *
 * Thin portal-isolation wrapper for the NOC Dashboard.
 *
 * NocDashboardPage was built for the main platform and contains hardcoded
 * links (e.g. "/calls", "/noc-command") that would escape the portal namespace
 * if clicked without interception. This wrapper listens for clicks on those
 * anchors (capture phase, before wouter's handler) and rewrites them to their
 * /noc/... equivalents, keeping the user inside the portal.
 *
 * Links with NO portal equivalent are left unchanged — they navigate to the
 * main platform as before (acceptable until those modules are added to the NOC
 * portal).
 *
 * NocDashboardPage itself is never modified. When a new module is added to
 * the NOC portal, add its mapping here and in 029_seed_portal_assignments.sql.
 */
import { useRef, useEffect } from "react";
import NocDashboardPage from "@/pages/noc-dashboard";
import { useLocation } from "wouter";
import { usePortal } from "@/context/portal-context";

/**
 * Main-platform path → NOC portal path.
 * Only includes modules that are actually registered in the NOC portal.
 */
const PORTAL_PATH_MAP: Record<string, string> = {
  "/calls":        "/noc/live-calls",
  "/live-traffic": "/noc/live-traffic",
  "/traffic-map":  "/noc/traffic-map",
  "/noc-command":  "/noc/noc-command",
  "/ops-console":  "/noc/ops-console",
};

export default function PortalAwareNocDashboard() {
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
      <NocDashboardPage />
    </div>
  );
}
