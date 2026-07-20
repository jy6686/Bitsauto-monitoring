/**
 * commercial-portal-home.tsx
 *
 * Commercial Portal home page — rendered at /commercial.
 *
 * Follows the same pattern as noc-portal-home.tsx:
 *   1. Sets portal context to "commercial" on mount.
 *   2. Renders DashboardTemplate with commercialPortalConfig.
 *   3. Section slots are available for future integration.
 *
 * Phase 1: Sections 3, 6, 7 are wired (Quick Actions + Workflow Cards).
 * Remaining sections are open slots — pass existing components when ready.
 */

import { useEffect } from "react";
import { usePortal } from "@/context/portal-context";
import { DashboardTemplate } from "@/portals/DashboardTemplate";
import { commercialPortalConfig } from "@/portals/configs/commercial.config";

export default function CommercialPortalHomePage() {
  const { setPortal } = usePortal();

  useEffect(() => {
    setPortal("commercial");
  }, []);

  return (
    <DashboardTemplate
      config={commercialPortalConfig}

      // ── Section 1: KPI Cards ──────────────────────────────────────────────
      // Wire when commercial KPI API is ready.
      // kpiCards={<CommercialKpiCards />}

      // ── Section 2: Live Telemetry ─────────────────────────────────────────
      // Not enabled for Commercial portal (telemetry.enabled = false).

      // ── Section 4: Main Data Widget — Deal Pipeline ───────────────────────
      // Wire when DealsPage supports an `embedded` prop.
      // mainWidget={<DealsPage embedded />}

      // ── Section 5: Smart Priorities ───────────────────────────────────────
      // Wire when commercial smart priorities are available.
      // smartPriorities={<CommercialSmartPriorities />}

      // ── Section 9: Operational Feed ───────────────────────────────────────
      // Wire when commercial event stream is available.
      // operationalFeed={<CommercialEventFeed />}

      // ── Section 10: Commercial Risk Items ─────────────────────────────────
      // Wire when risk scoring is available.
      // riskSection={<CommercialRiskItems />}
    />
  );
}
