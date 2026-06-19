import { useEffect } from "react";
import { usePortal } from "@/context/portal-context";
import { useQuery } from "@tanstack/react-query";
import type { PortalDefinition } from "@shared/schema";

// Portal color palette — maps primary_color DB value to HSL CSS variable values
const COLOR_MAP: Record<string, { primary: string; accent: string; ring: string }> = {
  purple:  { primary: "263 85% 65%",  accent: "270 80% 60%",  ring: "263 85% 65%" },
  blue:    { primary: "217 91% 60%",  accent: "199 89% 48%",  ring: "217 91% 60%" },
  emerald: { primary: "160 84% 39%",  accent: "145 80% 42%",  ring: "160 84% 39%" },
  green:   { primary: "142 71% 45%",  accent: "160 84% 39%",  ring: "142 71% 45%" },
  indigo:  { primary: "239 84% 67%",  accent: "217 91% 60%",  ring: "239 84% 67%" },
  slate:   { primary: "215 16% 47%",  accent: "215 20% 55%",  ring: "215 16% 47%" },
  cyan:    { primary: "189 94% 43%",  accent: "199 89% 48%",  ring: "189 94% 43%" },
  neutral: { primary: "215 16% 47%",  accent: "215 20% 55%",  ring: "215 16% 47%" },
};

const FONT_SCALE_MAP: Record<string, string> = {
  small:  "13px",
  normal: "14px",
  large:  "15px",
};

export function usePortalTheme() {
  const { activePortal } = usePortal();

  const { data: portals = [] } = useQuery<PortalDefinition[]>({
    queryKey: ["/api/portal/definitions"],
    staleTime: 60_000,
  });

  const portal = portals.find(p => p.slug === activePortal);

  useEffect(() => {
    const root = document.documentElement;

    if (!portal || !activePortal) {
      // Reset to base theme
      root.removeAttribute("data-portal");
      root.style.removeProperty("--portal-primary");
      root.style.removeProperty("--portal-accent");
      root.style.removeProperty("--portal-ring");
      root.style.removeProperty("--portal-font-size");
      return;
    }

    const colors = COLOR_MAP[portal.primaryColor] ?? COLOR_MAP["neutral"];
    const accentColors = COLOR_MAP[portal.accentColor] ?? colors;
    const fontSize = FONT_SCALE_MAP[portal.fontScale] ?? "14px";

    root.setAttribute("data-portal", portal.slug);
    root.setAttribute("data-portal-density", portal.density ?? "comfortable");
    root.setAttribute("data-portal-nav-style", portal.navStyle ?? "glass");
    root.style.setProperty("--portal-primary", colors.primary);
    root.style.setProperty("--portal-accent", accentColors.accent);
    root.style.setProperty("--portal-ring", colors.ring);
    root.style.setProperty("--portal-font-size", fontSize);

    return () => {
      root.removeAttribute("data-portal");
      root.removeAttribute("data-portal-density");
      root.removeAttribute("data-portal-nav-style");
      root.style.removeProperty("--portal-primary");
      root.style.removeProperty("--portal-accent");
      root.style.removeProperty("--portal-ring");
      root.style.removeProperty("--portal-font-size");
    };
  }, [portal, activePortal]);

  return { portal, activePortal };
}
