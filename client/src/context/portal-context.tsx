import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PortalDefinition, PortalModuleWithMeta } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";

const STORAGE_KEY = "bitsauto_active_portal";

export type PortalSlug = "kam" | "noc" | "finance" | "partner" | "admin";

interface PortalCtx {
  activePortal:   PortalSlug | null;
  setPortal:      (slug: PortalSlug | null) => void;
  definitions:    PortalDefinition[];
  modules:        PortalModuleWithMeta[];
  portalConfig:   PortalDefinition | null;
  isPortalMode:   boolean;
  exitPortalMode: () => void;
  allowedPortals: PortalDefinition[];
}

const PortalContext = createContext<PortalCtx>({
  activePortal:   null,
  setPortal:      () => {},
  definitions:    [],
  modules:        [],
  portalConfig:   null,
  isPortalMode:   false,
  exitPortalMode: () => {},
  allowedPortals: [],
});

export function PortalProvider({ children }: { children: ReactNode }) {
  const { user, role } = useAuth();

  const [activePortal, setActivePortalState] = useState<PortalSlug | null>(() => {
    try { return (localStorage.getItem(STORAGE_KEY) as PortalSlug) ?? null; } catch { return null; }
  });

  const { data: definitions = [] } = useQuery<PortalDefinition[]>({
    queryKey: ["/api/portal/definitions"],
    staleTime: 5 * 60_000,
    enabled: !!user,
  });

  const allowedPortals = definitions.filter(p =>
    role && (
      ["admin", "super_admin"].includes(role) ||
      p.allowedRoles.includes(role)
    )
  );

  const { data: modules = [] } = useQuery<PortalModuleWithMeta[]>({
    queryKey: ["/api/portal/modules", activePortal],
    enabled: !!activePortal && !!user,
    staleTime: 5 * 60_000,
  });

  const setPortal = (slug: PortalSlug | null) => {
    setActivePortalState(slug);
    try {
      if (slug) localStorage.setItem(STORAGE_KEY, slug);
      else      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  };

  // Validate stored portal against user's allowed portals once loaded
  useEffect(() => {
    if (definitions.length > 0 && activePortal) {
      const valid = allowedPortals.find(p => p.slug === activePortal);
      if (!valid) setPortal(null);
    }
  }, [definitions.length, role]);

  const portalConfig = definitions.find(p => p.slug === activePortal) ?? null;
  const isPortalMode = !!activePortal;

  return (
    <PortalContext.Provider value={{
      activePortal,
      setPortal,
      definitions,
      modules,
      portalConfig,
      isPortalMode,
      exitPortalMode: () => setPortal(null),
      allowedPortals,
    }}>
      {children}
    </PortalContext.Provider>
  );
}

export const usePortal = () => useContext(PortalContext);
