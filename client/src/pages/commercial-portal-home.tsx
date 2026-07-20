/**
 * commercial-portal-home.tsx
 *
 * Commercial Portal home page — rendered at /commercial.
 *
 * Shows the KAM Dashboard (account health board, quick actions, KPIs)
 * as the primary entry point for Commercial Portal users.
 * Data scope is hierarchy-filtered via the Hierarchy Scope Service (Phase 2).
 */

import { useEffect } from "react";
import { usePortal } from "@/context/portal-context";
import KamDashboard from "@/pages/kam-dashboard";

export default function CommercialPortalHomePage() {
  const { setPortal } = usePortal();

  useEffect(() => {
    setPortal("commercial");
  }, []);

  return <KamDashboard />;
}
