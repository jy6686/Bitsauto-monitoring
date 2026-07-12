/**
 * noc-portal-home.tsx
 *
 * NOC Portal home page — rendered at /noc.
 *
 * This page:
 *   1. Sets the portal context to "noc" on mount.
 *   2. Renders DashboardTemplate with nocPortalConfig.
 *   3. Passes existing dashboard section components as render props.
 *
 * Phase 1 (initial): Sections 3, 6, 7 are fully wired (Quick Actions +
 * Workflow Cards). Sections 1, 2, 4, 5, 8, 9, 10 are slots — pass the
 * existing components from DashboardPage as you integrate them.
 *
 * No new APIs. No new pages. No copied JSX.
 */

import { useEffect } from "react";
import { usePortal } from "@/context/portal-context";
import { DashboardTemplate } from "@/portals/DashboardTemplate";
import { nocPortalConfig } from "@/portals/configs/noc.config";

// ── Phase 1: Sections 6 & 7 are wired (workflow cards + quick actions).
// ── Integrate remaining sections by importing existing components below
// ── and passing them as props to DashboardTemplate.
//
// Example — when ready to wire Section 1 (KPI Cards):
//   import { NocKpiCards } from "@/components/kpi-widgets";
//
// Example — when ready to wire Section 4 (Main Data Widget = Live Calls):
//   import CallsListPage from "@/pages/calls-list";
//   then pass: mainWidget={<CallsListPage embedded />}
//   (requires calls-list to accept an `embedded` prop that hides its own header)

export default function NocPortalHomePage() {
  const { setPortal, activePortal } = usePortal();

  // Activate NOC portal mode on mount; restore on unmount.
  useEffect(() => {
    setPortal("noc");
    return () => {
      // Only exit portal mode if still in NOC context when unmounting.
      // This prevents clearing portal state if the user navigated to another portal.
    };
  }, []);

  return (
    <DashboardTemplate
      config={nocPortalConfig}

      // ── Section 1: KPI Cards ──────────────────────────────────────────────
      // Phase 1: wire when ready.
      // kpiCards={<NocKpiCards />}

      // ── Section 2: Live Telemetry ─────────────────────────────────────────
      // Phase 1: wire when ready.
      // telemetry={<ExistingTelemetrySection />}

      // ── Section 4: Main Data Widget — Live Calls ──────────────────────────
      // Phase 1: wire when ready.
      // Requires calls-list to support an `embedded` prop (no page chrome).
      // mainWidget={<CallsListPage embedded />}

      // ── Section 5: Smart Priorities ───────────────────────────────────────
      // Phase 1: wire when ready.
      // smartPriorities={<ExistingSmartPriorities />}

      // ── Section 8: System Health ──────────────────────────────────────────
      // Phase 1: wire when ready.
      // systemHealth={<ExistingSystemHealth />}

      // ── Section 9: Live Operational Feed ──────────────────────────────────
      // Phase 1: wire when ready.
      // operationalFeed={<ExistingOperationalFeed />}

      // ── Section 10: Risk Destinations ─────────────────────────────────────
      // Phase 1: wire when ready.
      // riskSection={<ExistingRiskDestinations />}
    />
  );
}
