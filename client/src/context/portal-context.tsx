import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import type { PortalDefinition, PortalModuleWithMeta, PortalSection } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";

// Portal context is now URL-DRIVEN (ADR-006). The active portal is a function of the
// URL prefix (/noc/*, /commercial/*, …) — never localStorage. A browser refresh or a
// deep link always restores the exact portal + module. No hidden state.
export type PortalSlug = "kam" | "noc" | "finance" | "partner" | "admin" | "commercial";

const KNOWN_PORTALS: PortalSlug[] = ["noc", "commercial", "finance", "admin", "kam", "partner"];

interface PortalCtx {
  activePortal:    PortalSlug | null;
  activeModule:    string | null;
  setPortal:       (slug: PortalSlug | null) => void;
  definitions:     PortalDefinition[];
  modules:         PortalModuleWithMeta[];
  sections:        PortalSection[];
  activeSection:   string | null;
  setSection:      (key: string) => void;
  sectionModules:  PortalModuleWithMeta[];
  portalConfig:    PortalDefinition | null;
  isPortalMode:    boolean;
  exitPortalMode:  () => void;
  allowedPortals:  PortalDefinition[];
}

const PortalContext = createContext<PortalCtx>({
  activePortal:    null,
  activeModule:    null,
  setPortal:       () => {},
  definitions:     [],
  modules:         [],
  sections:        [],
  activeSection:   null,
  setSection:      () => {},
  sectionModules:  [],
  portalConfig:    null,
  isPortalMode:    false,
  exitPortalMode:  () => {},
  allowedPortals:  [],
});

export function PortalProvider({ children }: { children: ReactNode }) {
  const { user, role } = useAuth();
  const [location, navigate] = useLocation();

  // ── Derive active portal + module from the URL (single source of truth) ────────
  const [maybePortal, maybeModule] = useMemo(() => {
    const segs = location.split("?")[0].split("/").filter(Boolean);
    return [segs[0], segs[1]] as [string | undefined, string | undefined];
  }, [location]);

  const activePortal: PortalSlug | null =
    maybePortal && (KNOWN_PORTALS as string[]).includes(maybePortal)
      ? (maybePortal as PortalSlug)
      : null;
  const activeModule = activePortal ? (maybeModule ?? null) : null;

  const { data: definitions = [] } = useQuery<PortalDefinition[]>({
    queryKey: ["/api/portal/definitions"],
    staleTime: 5 * 60_000,
    enabled: !!user,
  });

  // Memoized so the context value reference is stable between renders.
  const allowedPortals = useMemo(
    () => definitions.filter(p =>
      role && (["admin", "super_admin"].includes(role) || p.allowedRoles.includes(role))
    ),
    [definitions, role],
  );

  const { data: modules = [] } = useQuery<PortalModuleWithMeta[]>({
    queryKey: ["/api/portal/modules", activePortal],
    enabled: !!activePortal && !!user,
    staleTime: 5 * 60_000,
  });

  const { data: sections = [] } = useQuery<PortalSection[]>({
    queryKey: ["/api/portal/sections", activePortal],
    enabled: !!activePortal && !!user,
    staleTime: 5 * 60_000,
  });

  // Active section is derived from the active module's section, else the first section.
  const activeSection = useMemo(() => {
    if (activeModule) {
      const m = modules.find(mm => mm.moduleKey === activeModule);
      if (m) return m.section;
    }
    return sections[0]?.sectionKey ?? null;
  }, [activeModule, modules, sections]);

  // Entering/leaving a portal is a navigation — the URL owns the state.
  const setPortal = (slug: PortalSlug | null) => navigate(slug ? `/${slug}` : "/");
  const exitPortalMode = () => navigate("/");
  const setSection = (key: string) => {
    if (!activePortal) return;
    const first = modules.filter(m => m.section === key).sort((a, b) => a.displayOrder - b.displayOrder)[0];
    if (first) navigate(`/${activePortal}/${first.moduleKey}`);
  };

  // If the URL names a portal the user may not access, bounce to the main platform.
  // Guard: only redirect once BOTH definitions AND role are loaded.
  // Without !!role, definitions arriving before auth resolves produces
  // allowedPortals=[] and incorrectly redirects every cold portal deep-link.
  useEffect(() => {
    if (activePortal && definitions.length > 0 && !!role) {
      const ok = allowedPortals.find(p => p.slug === activePortal);
      if (!ok) navigate("/");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePortal, definitions.length, role]);

  const portalConfig   = definitions.find(p => p.slug === activePortal) ?? null;
  const isPortalMode   = !!activePortal;
  const sectionModules = activeSection ? modules.filter(m => m.section === activeSection) : modules;

  return (
    <PortalContext.Provider value={{
      activePortal,
      activeModule,
      setPortal,
      definitions,
      modules,
      sections,
      activeSection,
      setSection,
      sectionModules,
      portalConfig,
      isPortalMode,
      exitPortalMode,
      allowedPortals,
    }}>
      {children}
    </PortalContext.Provider>
  );
}

export const usePortal = () => useContext(PortalContext);
