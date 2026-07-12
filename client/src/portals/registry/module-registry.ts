/**
 * module-registry.ts — the ONE code seam of the portal framework.
 *
 * Answers exactly one question: given a stable module key, which React component
 * renders it. It is PORTAL-BLIND — it does not know or care which portal requested
 * the module. Everything else (portal, menu, section, order, quick actions,
 * workflows, icon, description, permission, visibility, landing group) lives in the
 * database and is owned by the Portal Assignment Manager (Model A:
 * portal_module_assignments). See docs/engineering/platform-feature-audit/MODULE-REGISTRY.md.
 *
 * Keys are the permanent identity (kebab-case) used identically in URL, DB, audit,
 * permissions, telemetry. Display names change; keys never do.
 */
import { lazy, type LazyExoticComponent, type ComponentType } from "react";

export type ModuleComponent = LazyExoticComponent<ComponentType<any>>;

/**
 * moduleKey → component. Adding a NEW page touches this once; moving an existing
 * page between portals never does (that is pure DB / Portal Assignment Manager).
 */
export const moduleRegistry: Record<string, ModuleComponent> = {
  // ── NOC (Phase 1) ────────────────────────────────────────────────────────────
  "live-calls":    lazy(() => import("@/pages/calls-list")),
  "live-traffic":  lazy(() => import("@/pages/live-traffic")),
  // Duplicate under PFR review (traffic-map.tsx vs live-traffic-map.tsx). Bound to a
  // resolver that points at the current page today; ONE line changes once the
  // duplicate review resolves — the module key `traffic-map` never changes.
  "traffic-map":   lazy(() => import("./TrafficMapResolver")),
  "noc-dashboard": lazy(() => import("@/pages/noc-dashboard")),
  "noc-command":   lazy(() => import("@/pages/noc-command")),
  "ops-console":   lazy(() => import("@/pages/ops-console")),
};

/** Resolve a module key to its component, or null if the key is unknown. */
export function resolveModuleComponent(moduleKey: string): ModuleComponent | null {
  return moduleRegistry[moduleKey] ?? null;
}

/** True if a module key has a bound component in the registry. */
export function isRegisteredModule(moduleKey: string): boolean {
  return moduleKey in moduleRegistry;
}
