/**
 * noc-portal-home.tsx
 *
 * NOC Portal home page — rendered at /noc.
 *
 * Shows the KAM Dashboard (account health board, quick actions, KPIs)
 * with full global data scope (no hierarchy filter) for the NOC team.
 * Future: swap the data provider for NOC-scoped metrics while keeping
 * the same layout.
 */

import { useEffect } from "react";
import { usePortal } from "@/context/portal-context";
import KamDashboard from "@/pages/kam-dashboard";

export default function NocPortalHomePage() {
  const { setPortal } = usePortal();

  useEffect(() => {
    setPortal("noc");
  }, []);

  return <KamDashboard />;
}
