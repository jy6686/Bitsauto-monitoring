/**
 * portal-config-service.ts — the ONLY model the portal UI consumes.
 *
 * Reads Model A (portal_module_assignments + portal_sections + portal_definitions,
 * the Portal Assignment Manager's source of truth) and produces a ready-to-render
 * Portal View Model. Sidebar, TopNav, Dashboard, and Quick Actions read THIS —
 * never database tables directly. See docs ADR-006 + PORTAL-ASSIGNMENT-MANAGER-SPEC.
 *
 * Sidebar, TopNav, and Dashboard consume the Portal View Model DIRECTLY — there is no
 * runtime dependency on Model B (workspaces/tabs/items). Those tables remain only as a
 * migration artifact to be removed once all portals are on this framework (roadmap Phase 5).
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  PortalDefinition, PortalModuleWithMeta, PortalSection,
} from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";

// ── Portal View Model ──────────────────────────────────────────────────────────
export type Visibility = "full" | "view" | "read" | "send" | "edit" | "approve" | "hidden";

export interface PortalViewModule {
  moduleKey:  string;
  label:      string;   // display_label ?? title
  icon:       string;
  href:       string;   // portal-relative: /:portal/:moduleKey
  section:    string;
  order:      number;
  visibility: Visibility;
  isHome:     boolean;
  isPinned:   boolean;
}

export interface PortalViewSection {
  key:     string;
  title:   string;
  icon:    string;
  order:   number;
  modules: PortalViewModule[];
}

export interface PortalViewModel {
  portal:       string;
  name:         string;
  theme:        string;
  sections:     PortalViewSection[];    // Level-2 top menu + grouped navigation
  navigation:   PortalViewModule[];     // flat, visible modules
  quickActions: PortalViewModule[];     // isPinned
  workflows:    { primary: PortalViewModule[]; secondary: PortalViewModule[] };
  home:         PortalViewModule | null;// isHome (landing)
  isLoading:    boolean;
}

const isVisible = (v: string) => v !== "hidden";

/** Build the portal-relative href for a module. The module key is the identity. */
export function moduleHref(portal: string, moduleKey: string): string {
  return `/${portal}/${moduleKey}`;
}

/**
 * The single service hook. Given a portal slug, returns the composed view model
 * from Model A. Pass a null slug (not in a portal) to get an empty, non-loading model.
 */
export function usePortalConfig(portalSlug: string | null): PortalViewModel {
  const { user } = useAuth();

  const { data: definitions = [] } = useQuery<PortalDefinition[]>({
    queryKey: ["/api/portal/definitions"],
    staleTime: 5 * 60_000,
    enabled: !!user,
  });

  const { data: modules = [], isLoading: modulesLoading } = useQuery<PortalModuleWithMeta[]>({
    queryKey: ["/api/portal/modules", portalSlug],
    enabled: !!portalSlug && !!user,
    staleTime: 5 * 60_000,
  });

  const { data: sections = [], isLoading: sectionsLoading } = useQuery<PortalSection[]>({
    queryKey: ["/api/portal/sections", portalSlug],
    enabled: !!portalSlug && !!user,
    staleTime: 5 * 60_000,
  });

  return useMemo<PortalViewModel>(() => {
    const def = definitions.find(d => d.slug === portalSlug) ?? null;

    if (!portalSlug) {
      return {
        portal: "", name: "", theme: "neutral", sections: [], navigation: [],
        quickActions: [], workflows: { primary: [], secondary: [] }, home: null, isLoading: false,
      };
    }

    // Model A module → view module (portal-relative href, key = identity)
    const toView = (m: PortalModuleWithMeta): PortalViewModule => ({
      moduleKey:  m.moduleKey,
      label:      m.displayLabel ?? m.title,
      icon:       m.icon,
      href:       moduleHref(portalSlug, m.moduleKey),
      section:    m.section,
      order:      m.displayOrder,
      visibility: (m.visibility as Visibility) ?? "full",
      isHome:     m.isHome,
      isPinned:   m.isPinned,
    });

    const views = modules.map(toView).sort((a, b) => a.order - b.order);
    const visible = views.filter(v => isVisible(v.visibility));

    // Group visible modules under their section (Level-2 tabs)
    const sectionList: PortalViewSection[] = [...sections]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(s => ({
        key:   s.sectionKey,
        title: s.title,
        icon:  s.icon,
        order: s.sortOrder,
        modules: visible.filter(v => v.section === s.sectionKey),
      }))
      .filter(s => s.modules.length > 0);

    return {
      portal:       portalSlug,
      name:         def?.name ?? portalSlug.toUpperCase(),
      theme:        def?.theme ?? "neutral",
      sections:     sectionList,
      navigation:   visible,
      quickActions: visible.filter(v => v.isPinned),
      workflows: {
        primary:   visible.filter(v => v.visibility === "full"),
        secondary: visible.filter(v => v.visibility !== "full"),
      },
      home:         visible.find(v => v.isHome) ?? null,
      isLoading:    modulesLoading || sectionsLoading,
    };
  }, [portalSlug, definitions, modules, sections, modulesLoading, sectionsLoading]);
}

