import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PortalDefinition, PortalModuleWithMeta, PortalSection } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";

const STORAGE_KEY         = "bitsauto_active_portal";
const STORAGE_SECTION_KEY = "bitsauto_active_section";

export type PortalSlug = "kam" | "noc" | "finance" | "partner" | "admin";

interface PortalCtx {
  activePortal:    PortalSlug | null;
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

  const [activePortal, setActivePortalState] = useState<PortalSlug | null>(() => {
    try { return (localStorage.getItem(STORAGE_KEY) as PortalSlug) ?? null; } catch { return null; }
  });

  const [activeSection, setActiveSectionState] = useState<string | null>(() => {
    try { return localStorage.getItem(STORAGE_SECTION_KEY) ?? null; } catch { return null; }
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

  const { data: sections = [] } = useQuery<PortalSection[]>({
    queryKey: ["/api/portal/sections", activePortal],
    enabled: !!activePortal && !!user,
    staleTime: 5 * 60_000,
  });

  // When sections load, ensure activeSection is valid; default to first section
  useEffect(() => {
    if (sections.length > 0) {
      const valid = sections.find(s => s.sectionKey === activeSection);
      if (!valid) {
        const first = sections[0].sectionKey;
        setActiveSectionState(first);
        try { localStorage.setItem(STORAGE_SECTION_KEY, first); } catch {}
      }
    }
  }, [sections.length, activePortal]);

  // Reset section when portal changes
  useEffect(() => {
    setActiveSectionState(null);
    try { localStorage.removeItem(STORAGE_SECTION_KEY); } catch {}
  }, [activePortal]);

  const setPortal = (slug: PortalSlug | null) => {
    setActivePortalState(slug);
    try {
      if (slug) localStorage.setItem(STORAGE_KEY, slug);
      else      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  };

  const setSection = (key: string) => {
    setActiveSectionState(key);
    try { localStorage.setItem(STORAGE_SECTION_KEY, key); } catch {}
  };

  // Validate stored portal against user's allowed portals once loaded
  useEffect(() => {
    if (definitions.length > 0 && activePortal) {
      const valid = allowedPortals.find(p => p.slug === activePortal);
      if (!valid) setPortal(null);
    }
  }, [definitions.length, role]);

  const portalConfig   = definitions.find(p => p.slug === activePortal) ?? null;
  const isPortalMode   = !!activePortal;

  // Modules filtered to the active section (for contextual sidebar)
  const sectionModules = activeSection
    ? modules.filter(m => m.section === activeSection)
    : modules;

  return (
    <PortalContext.Provider value={{
      activePortal,
      setPortal,
      definitions,
      modules,
      sections,
      activeSection,
      setSection,
      sectionModules,
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
