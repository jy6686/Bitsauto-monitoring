/**
 * portal-config.types.ts — Portal Configuration Contract
 *
 * This file is the enforced contract for all portal configurations.
 * Every portal (NOC, Commercial, Finance, Admin, future portals) MUST
 * implement the PortalConfig interface defined here.
 *
 * Consumers:
 *   - PortalNavBar       renders navigation.entries (Sprint #369)
 *   - DashboardTemplate  renders workflows, quickActions, widgets
 *   - configs/index.ts   registry of slug → PortalConfig
 *
 * Rules (see .local/governance/PORTAL-CONFIG-CONTRACT.md for full details):
 *   1. All path values must reference routes registered in App.tsx.
 *   2. PortalNavBar is NEVER portal-specific — only this contract changes.
 *   3. Adding a portal requires only: a new config file + one registry entry.
 *   4. Do NOT add portal-specific logic to app-nav-shell or PortalNavBar.
 *
 * The portal context (portal-context.tsx) handles dynamic, backend-driven
 * configuration (portal definitions, modules, sections via API).
 * These types cover the STATIC UI configuration: navigation structure,
 * quick actions, workflow cards, widget declarations, and permissions.
 */

// ── Portal identity ──────────────────────────────────────────────────────────

export type PortalId = 'noc' | 'commercial' | 'finance' | 'admin';

// ── Navigation ───────────────────────────────────────────────────────────────

export interface NavItem {
  label: string;
  path: string;
  icon?: string;
}

export interface NavGroup {
  label: string;
  icon?: string;
  items: NavItem[];
}

export type NavEntry = NavItem | NavGroup;

/** Type guard: distinguishes a group (with dropdown items) from a flat item. */
export function isNavGroup(entry: NavEntry): entry is NavGroup {
  return 'items' in entry;
}

// ── Quick Actions ────────────────────────────────────────────────────────────

/**
 * Quick Actions occupy Section 3 of the Dashboard Template (fixed position).
 * Exactly 6 buttons per portal. Targets are existing routes — no new pages.
 */
export interface QuickAction {
  label: string;
  /** Must be an existing route registered in App.tsx */
  path: string;
  icon: string;
}

export interface QuickActionConfig {
  /** Always exactly 6 quick actions per portal (Dashboard Template v1.0). */
  actions: [QuickAction, QuickAction, QuickAction, QuickAction, QuickAction, QuickAction];
}

// ── Workflow cards ───────────────────────────────────────────────────────────

export type WorkflowStatus = 'active' | 'coming-soon';

/**
 * A single workflow card linking to a portal module.
 * Active cards link to existing routes.
 * coming-soon cards are visible but greyed out.
 */
export interface WorkflowCard {
  label: string;
  description: string;
  /** Must be an existing route, or '#' for coming-soon cards. */
  path: string;
  icon: string;
  status: WorkflowStatus;
}

export interface WorkflowConfig {
  /** Section 6: Primary Workflows — max 6, production-ready Phase 1 modules. */
  primary: WorkflowCard[];
  /** Section 7: Secondary Workflows — coming-soon, always visible but greyed out. */
  secondary: WorkflowCard[];
}

// ── Widget declarations ──────────────────────────────────────────────────────

export type KpiFormat = 'number' | 'currency' | 'percent' | 'duration';

/** Declares one KPI card. The dataKey matches the field returned by the dashboard API. */
export interface KpiCardDef {
  label: string;
  dataKey: string;
  format: KpiFormat;
}

/**
 * Section 4: Main Data Widget — configurable per portal, not hardcoded.
 * componentName must refer to an existing page component imported in DashboardTemplate.
 */
export interface MainWidgetDef {
  componentName: string;
  label: string;
}

export interface WidgetConfig {
  /** Section 1: Four KPI summary cards. */
  kpiCards: [KpiCardDef, KpiCardDef, KpiCardDef, KpiCardDef];
  /** Section 2: Live Telemetry chart + right-panel intelligence cards. */
  telemetry: { enabled: boolean };
  /** Section 4: Portal-specific main data widget. */
  mainWidget: MainWidgetDef;
  /** Section 5: Smart Priorities — auto-ranked alert items. */
  smartPriorities: { enabled: boolean };
  /** Section 8: System Health — infrastructure component status row. */
  systemHealth: { enabled: boolean };
  /** Section 9: Live Operational Feed — real-time event stream. */
  operationalFeed: { enabled: boolean };
  /** Section 10: Risk & Exceptions — portal-specific label. */
  riskSection: { enabled: boolean; label: string };
}

// ── Permissions ──────────────────────────────────────────────────────────────

export interface PermissionConfig {
  /** Roles that can access this portal. Must match Role type in @shared/schema. */
  requiredRoles: string[];
  /**
   * 'global'  — no data filtering by hierarchy (NOC, Admin).
   * 'scoped'  — data filtered by the user's hierarchy scope (Commercial, Finance).
   */
  hierarchyScope: 'global' | 'scoped';
}

// ── Root config ──────────────────────────────────────────────────────────────

/**
 * PortalConfig is the single configuration object for one portal.
 * Pass it to <DashboardTemplate config={...} /> to render the portal home.
 *
 * Dashboard Template section order (v1.0 — FROZEN):
 *   1  KPI Cards          (widgets.kpiCards)
 *   2  Live Telemetry     (widgets.telemetry)
 *   3  Quick Actions      (quickActions)          ← fixed position, always here
 *   4  Main Data Widget   (widgets.mainWidget)    ← configurable per portal
 *   5  Smart Priorities   (widgets.smartPriorities)
 *   6  Primary Workflows  (workflows.primary)
 *   7  Secondary Workflows(workflows.secondary)
 *   8  System Health      (widgets.systemHealth)
 *   9  Operational Feed   (widgets.operationalFeed)
 *  10  Risk & Exceptions  (widgets.riskSection)
 */
export interface PortalConfig {
  id: PortalId;
  name: string;
  /** Short badge label displayed in the top-nav portal switcher. */
  badgeLabel: string;
  /** Tailwind color key for portal accent (e.g. 'blue', 'emerald', 'violet'). */
  accentColor: string;
  navigation: { entries: NavEntry[] };
  quickActions: QuickActionConfig;
  workflows: WorkflowConfig;
  widgets: WidgetConfig;
  permissions: PermissionConfig;
}
