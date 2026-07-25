// ── Portal Workspace Provider — NAV-WORKSPACE Phase 5 (NAV-C1) ─────────────────
// Client consumer of GET /api/portals/:slug/workspace — the single source of
// truth for portal navigation (NAV-WORKSPACE-MODEL, frozen).
//
// Phase 5 scope (frozen): provider + usePortalWorkspace() hook ONLY.
// No consumer migration. No routing, search, menu, or breadcrumb changes.
//
// Behavior with portalWorkspaceNavigation=false (default): the query is
// DISABLED — no network request, no behavior change anywhere. The hook returns
// { enabled: false, workspace: null }.
//
// Frozen post-Phase-3 invariants (verify after every Phase 6 consumer step):
//   navigationChecksum c3760592395da687 · 6 domains · search index 55 ·
//   hidden modules absent · routing-manager/call-recordings visibility:'read-only'

import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePortal } from "@/context/portal-context";
import { useAuth } from "@/hooks/use-auth";
import { isPortalWorkspaceNavEnabled } from "@/lib/feature-flags";

// ── Contract types (mirror of server PortalWorkspaceResponse, contract v1) ─────
export interface WorkspaceNavItem {
  moduleKey:   string;
  title:       string;
  iconKey:     string;
  route:       string;
  portalRoute: string;
  /** Present ONLY when overridden 'read-only'. Hidden modules never appear. */
  visibility?: "read-only";
}
export interface WorkspaceGroup {
  id:           number;
  label:        string;
  iconKey:      string;
  displayOrder: number;
  items:        WorkspaceNavItem[];
}
export interface WorkspaceDomain {
  id:           string;
  label:        string;
  iconKey:      string;
  colorClass:   string;
  displayOrder: number;
  groups:       WorkspaceGroup[];
}
export interface PortalWorkspaceResponse {
  workspaceVersion:   number;
  navigationChecksum: string;
  portal:    { slug: string; name: string; theme: string; defaultRoute: string };
  workspace: {
    homeModule:      string | null;
    defaultDomain:   string | null;
    searchScope:     string;
    sidebarStyle:    string;
    dashboardLayout: string;
  };
  navigation:   { domains: WorkspaceDomain[] };
  search:       { scope: string; index: WorkspaceNavItem[] };
  quickActions: unknown[];
  favorites:    unknown[];
  dashboard:    { layout: string; sections: unknown[] };
}

/** Client-supported contract version. Mismatch = stale build vs API; warn loudly. */
export const SUPPORTED_WORKSPACE_CONTRACT_VERSION = 1;

interface PortalWorkspaceCtx {
  /** false = flag off OR not in portal mode; workspace is null and nothing was fetched. */
  enabled:   boolean;
  workspace: PortalWorkspaceResponse | null;
  isLoading: boolean;
  error:     Error | null;
  refetch:   () => void;
}

const defaultCtx: PortalWorkspaceCtx = {
  enabled: false, workspace: null, isLoading: false, error: null, refetch: () => {},
};

const PortalWorkspaceContext = createContext<PortalWorkspaceCtx>(defaultCtx);

export function PortalWorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { activePortal } = usePortal();
  const flagOn  = isPortalWorkspaceNavEnabled();
  const enabled = flagOn && !!activePortal && !!user;

  const { data, isLoading, error, refetch } = useQuery<PortalWorkspaceResponse>({
    queryKey: [`/api/portals/${activePortal}/workspace`],
    enabled,
    staleTime: 5 * 60_000,
  });

  // ── Provider validation (Phase 5): contract version + checksum logging ───────
  useEffect(() => {
    if (!data) return;
    console.info(
      `[portal-workspace] loaded: portal=${data.portal.slug}` +
      ` checksum=${data.navigationChecksum} domains=${data.navigation.domains.length}` +
      ` index=${data.search.index.length}`,
    );
    if (data.workspaceVersion !== SUPPORTED_WORKSPACE_CONTRACT_VERSION) {
      console.warn(
        `[portal-workspace] CONTRACT MISMATCH: API v${data.workspaceVersion}, ` +
        `client supports v${SUPPORTED_WORKSPACE_CONTRACT_VERSION}. ` +
        `Stale build or premature API change — do not migrate consumers on this pair.`,
      );
    }
  }, [data]);

  const value: PortalWorkspaceCtx = enabled
    ? { enabled, workspace: data ?? null, isLoading, error: (error as Error) ?? null, refetch }
    : defaultCtx;

  return (
    <PortalWorkspaceContext.Provider value={value}>
      {children}
    </PortalWorkspaceContext.Provider>
  );
}

/**
 * Phase 6 consumers call this and MUST fall back to the legacy source when
 * `enabled` is false or `workspace` is null (loading/error). Never render an
 * empty nav from a pending workspace — legacy is the fallback path.
 */
export const usePortalWorkspace = () => useContext(PortalWorkspaceContext);
