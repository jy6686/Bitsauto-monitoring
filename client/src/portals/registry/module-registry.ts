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
  // ── Core (shared across portals) ─────────────────────────────────────────────
  // The main platform Dashboard reused in any portal that assigns the "dashboard"
  // module key. One component, one API set, zero synchronisation burden.
  "dashboard":     lazy(() => import("@/pages/dashboard")),

  // ── NOC (Phase 1) ────────────────────────────────────────────────────────────
  "live-calls":    lazy(() => import("@/pages/calls-list")),
  "live-traffic":  lazy(() => import("@/pages/live-traffic")),
  // Duplicate under PFR review (traffic-map.tsx vs live-traffic-map.tsx). Bound to a
  // resolver that points at the current page today; ONE line changes once the
  // duplicate review resolves — the module key `traffic-map` never changes.
  "traffic-map":   lazy(() => import("./TrafficMapResolver")),
  // Portal-aware wrapper: intercepts hardcoded main-platform links in NocDashboardPage
  // and rewrites portal-equivalent paths to /noc/... before wouter handles them.
  // NocDashboardPage itself is NOT modified. See portals/noc/PortalAwareNocDashboard.tsx.
  "noc-dashboard": lazy(() => import("@/portals/noc/PortalAwareNocDashboard")),
  "noc-command":   lazy(() => import("@/pages/noc-command")),
  "ops-console":   lazy(() => import("@/pages/ops-console")),

  // ── Commercial (Phase 1) ─────────────────────────────────────────────────────
  "kam-dashboard":             lazy(() => import("@/pages/kam-dashboard")),
  "clients":                   lazy(() => import("@/pages/clients")),

  // ── NOC (Phase 6 follow-up — Clients domain, migration 035) ──────────────────
  // navigation_modules seeded these keys underscore-style in migration 031 and
  // they were never kebab-cased in 032 (company/Clients domain wasn't assigned to
  // any portal until 035). Registry keys below match the exact DB module_key
  // values as-is — verified against App.tsx's actual <Route> bindings, no guessing.
  "client_portal":             lazy(() => import("@/pages/client-portal")),
  "client_identity":           lazy(() => import("@/pages/client-identity")),
  "kam_dashboard":             lazy(() => import("@/pages/kam-dashboard")),
  "reseller":                  lazy(() => import("@/pages/reseller")),
  "company_list":              lazy(() => import("@/pages/company-list")),
  "client_wizard":             lazy(() => import("@/pages/client-wizard")),
  "company_onboarding":        lazy(() => import("@/pages/company-onboarding")),
  "company_profile":           lazy(() => import("@/pages/company-profile")),
  "dids":                      lazy(() => import("@/pages/dids")),
  "account_names":             lazy(() => import("@/pages/account-names")),
  "partner-profiles":          lazy(() => import("@/pages/partner-profiles")),
  "deals":                     lazy(() => import("@/pages/deals")),
  "rate-manager":              lazy(() => import("@/pages/rate-manager")),
  "destination-catalog":       lazy(() => import("@/pages/destination-catalog")),
  "product-registry":          lazy(() => import("@/pages/product-registry")),
  "invoices":                  lazy(() => import("@/pages/invoices")),
  "commercial-notifications":  lazy(() => import("@/pages/commercial-notifications")),
  "margin-intelligence":       lazy(() => import("@/pages/margin-intelligence")),

  // ── NOC (Phase 6 — workspace-exposed modules) ────────────────────────────────
  // Added when Phase 6 (Search + Top Menu consumers) started surfacing every
  // workspace.navigation module, exposing that only 6 of the NOC portal's 55
  // modules had a registry entry (the rest 404'd on click). Every mapping below
  // was verified against the component actually bound to that path's legacy
  // <Route> in App.tsx — no new pages, no guesses.
  "ai-ops":                    lazy(() => import("@/pages/ai-ops")),
  "alerts":                    lazy(() => import("@/pages/alerts")),
  "analytics":                 lazy(() => import("@/pages/analytics")),
  "asr-acd":                   lazy(() => import("@/pages/asr-acd-report")),
  "balance-monitor":           lazy(() => import("@/pages/balance-monitor")),
  // module_key 'bitseye' has historically pointed at the '/bitseye2' route
  // (BitsEye 2); 'bitseye-classic' owns the plain '/bitseye' route. Verified
  // against the live workspace API response, not guessed.
  "bitseye":                   lazy(() => import("@/pages/bitseye2")),
  "bitseye-classic":           lazy(() => import("@/pages/bitseye")),
  "call-recordings":           lazy(() => import("@/pages/call-recordings")),
  "carrier-intelligence":      lazy(() => import("@/pages/carrier-intelligence")),
  "carrier-scoring":           lazy(() => import("@/pages/carrier-scoring")),
  "cdrs":                      lazy(() => import("@/pages/cdrs")),
  "firewall":                  lazy(() => import("@/pages/firewall")),
  "fraud":                     lazy(() => import("@/pages/fraud")),
  "graphs":                    lazy(() => import("@/pages/graphs")),
  "intelligence-hub":          lazy(() => import("@/pages/intelligence")),
  "lcr-analyser":              lazy(() => import("@/pages/lcr-analyser")),
  "live-traffic-map":          lazy(() => import("@/pages/live-traffic-map")),
  "multi-switch":              lazy(() => import("@/pages/multi-switch")),
  "network-topology":          lazy(() => import("@/pages/network-topology")),
  "noc-incidents":             lazy(() => import("@/pages/noc-incidents")),
  "prefix-intelligence":       lazy(() => import("@/pages/vendor-prefix-intelligence")),
  "qos-heatmap":               lazy(() => import("@/pages/qos-heatmap")),
  // module_key 'replay-engine' maps to pages/replay.tsx (ReplayEnginePage) — the
  // legacy '/replay' route's component. pages/replay-engine.tsx exists but is
  // NOT wired into App.tsx anywhere; not used here.
  "replay-engine":             lazy(() => import("@/pages/replay")),
  "reports":                   lazy(() => import("@/pages/reports")),
  "route-intelligence":        lazy(() => import("@/pages/route-intelligence")),
  "route-simulator":           lazy(() => import("@/pages/call-flow-simulator")),
  "route-tester":              lazy(() => import("@/pages/test-call")),
  "route-testing":             lazy(() => import("@/pages/ai-route-copilot")),
  "routing-intelligence":      lazy(() => import("@/pages/routing-intelligence")),
  "routing-manager":           lazy(() => import("@/pages/routing-manager")),
  "rtp-analytics":             lazy(() => import("@/pages/rtp-analytics")),
  "sbc-monitor":               lazy(() => import("@/pages/sbc-monitor")),
  "security-ops":              lazy(() => import("@/pages/security-ops")),
  "self-heal":                 lazy(() => import("@/pages/self-heal")),
  "server-monitoring":         lazy(() => import("@/pages/server-monitoring")),
  "sip-trace":                 lazy(() => import("@/pages/sip-trace")),
  "sla-breaches":              lazy(() => import("@/pages/sla-breaches")),
  "sla-scorecard":             lazy(() => import("@/pages/vendor-sla-scorecard")),
  "sms-monitor":               lazy(() => import("@/pages/sms-monitor")),
  "termination-chains":        lazy(() => import("@/pages/termination-chains")),
  "test-campaigns":            lazy(() => import("@/pages/test-campaigns")),
  "tools":                     lazy(() => import("@/pages/tools")),
  "traffic-forecast":          lazy(() => import("@/pages/traffic-forecast")),
  "traffic-steering":          lazy(() => import("@/pages/traffic-steering")),
  "vendor-health":             lazy(() => import("@/pages/vendor-health")),
  "vendor-rca":                lazy(() => import("@/pages/vendor-rca")),
  "vendor-stability-timeline": lazy(() => import("@/pages/vendor-stability-timeline")),
  "vendors":                   lazy(() => import("@/pages/vendors")),
  "voice-otp":                 lazy(() => import("@/pages/voice-otp")),
};

/** Resolve a module key to its component, or null if the key is unknown. */
export function resolveModuleComponent(moduleKey: string): ModuleComponent | null {
  return moduleRegistry[moduleKey] ?? null;
}

/** True if a module key has a bound component in the registry. */
export function isRegisteredModule(moduleKey: string): boolean {
  return moduleKey in moduleRegistry;
}
