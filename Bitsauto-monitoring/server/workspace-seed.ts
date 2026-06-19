import { db } from "./db";
import { workspaceDefinitions, workspaceTabs, workspaceTabItems } from "@shared/schema";
import { eq, sql } from "drizzle-orm";

interface TabSeed {
  slug: string;
  label: string;
  icon?: string;
  routes: string[];
  contextualRoutes?: string[];
}

interface WorkspaceSeed {
  slug: string;
  label: string;
  description: string;
  portalSlug: string;
  domainId: string;
  icon: string;
  sortOrder: number;
  tabs: TabSeed[];
}

const WORKSPACES: WorkspaceSeed[] = [
  // ── PHASE 1: Products & Destinations ──────────────────────────────────────
  {
    slug: "products-catalog",
    label: "Products & Destinations",
    description: "Product registry, global destination catalog, and assignments",
    portalSlug: "products",
    domainId: "products",
    icon: "Package",
    sortOrder: 5,
    tabs: [
      { slug: "pr-dashboard",    label: "Dashboard",           icon: "BarChart2",  routes: ["/product-registry"] },
      { slug: "pr-products",     label: "Product Catalog",     icon: "BookOpen",   routes: ["/product-registry/products"] },
      { slug: "pr-destinations", label: "Destinations",        icon: "Globe",      routes: ["/product-registry/destinations"] },
      { slug: "pr-assignments",  label: "Assignments",         icon: "Layers",     routes: ["/product-registry/assignments"] },
      { slug: "pr-routing",      label: "Routing Templates",   icon: "Network",    routes: ["/product-registry/routing"] },
      { slug: "pr-pricing",      label: "Pricing Templates",   icon: "TrendingUp", routes: ["/product-registry/pricing"] },
      { slug: "pr-history",      label: "History",             icon: "BookOpen",   routes: ["/product-registry/history"] },
    ],
  },

  // ── PHASE 2: Finance ─────────────────────────────────────────────────────
  {
    slug: "billing-ops",
    label: "Billing Operations",
    description: "Invoice lifecycle, rate cards, credits, and collections",
    portalSlug: "finance",
    domainId: "finance",
    icon: "Receipt",
    sortOrder: 10,
    tabs: [
      { slug: "billing-cycles",  label: "Billing",       icon: "CreditCard",  routes: ["/billing"] },
      { slug: "invoices",        label: "Invoices",      icon: "FileText",    routes: ["/invoices", "/invoice-jobs"] },
      { slug: "templates",       label: "Templates",     icon: "Layers",      routes: ["/invoice-templates"] },
      { slug: "credits",         label: "Credits",       icon: "RefreshCw",   routes: ["/credit-notes", "/credit-control"] },
      { slug: "rate-cards",      label: "Rate Cards",    icon: "BarChart2",   routes: ["/rate-cards"] },
      { slug: "rating",          label: "Rating",        icon: "Settings",    routes: ["/tariff-versions"] },
      { slug: "products",        label: "Products",      icon: "BookOpen",    routes: ["/products"] },
    ],
  },
  {
    slug: "revenue-assurance",
    label: "Revenue Assurance",
    description: "DMR, reconciliation, AI alerts, margin, and forecasting",
    portalSlug: "finance",
    domainId: "finance",
    icon: "TrendingUp",
    sortOrder: 20,
    tabs: [
      { slug: "daily-assurance", label: "Daily Assurance", icon: "Activity",    routes: ["/dmr"] },
      { slug: "reconciliation",  label: "Reconciliation",  icon: "RefreshCw",   routes: ["/client-reconciliation", "/carrier-reconciliation"] },
      { slug: "ai-alerts",       label: "AI Alerts",       icon: "Brain",        routes: ["/ai-assurance"] },
      { slug: "margin",          label: "Margin",          icon: "BarChart2",    routes: ["/margin-intelligence"] },
      { slug: "forecasting",     label: "Forecasting",     icon: "TrendingUp",   routes: ["/traffic-forecast"] },
      { slug: "revenue-drift",   label: "Revenue Drift",   icon: "AlertTriangle",routes: ["/revenue-heatmap"] },
    ],
  },
  {
    slug: "dispute-governance",
    label: "Dispute & Governance",
    description: "Disputes, defense packages, commercial notices, and audit",
    portalSlug: "finance",
    domainId: "finance",
    icon: "Scale",
    sortOrder: 30,
    tabs: [
      { slug: "active-disputes", label: "Active Disputes", icon: "AlertTriangle", routes: ["/billing-disputes", "/dispute-cases"] },
      { slug: "defense",         label: "Defense",         icon: "ShieldAlert",   routes: [], contextualRoutes: ["/dispute-defense"] },
      { slug: "commercial",      label: "Commercial",      icon: "FileText",      routes: ["/commercial-notifications"] },
      { slug: "audit-trail",     label: "Audit Trail",     icon: "BookOpen",      routes: ["/audit-log"] },
    ],
  },

  // ── PHASE 3: NOC (routes not wrapped yet — seeded for future phase) ─────
  {
    slug: "noc-ops",
    label: "NOC Operations",
    description: "Live calls, incidents, alerts, network, and SIP tools",
    portalSlug: "noc",
    domainId: "operations",
    icon: "Monitor",
    sortOrder: 40,
    tabs: [
      { slug: "live",      label: "Live",      icon: "Activity",    routes: ["/calls", "/live-traffic"] },
      { slug: "incidents", label: "Incidents", icon: "AlertTriangle",routes: ["/noc-dashboard", "/noc-incidents"] },
      { slug: "alerts",    label: "Alerts",    icon: "ShieldAlert", routes: ["/alerts"] },
      { slug: "network",   label: "Network",   icon: "Network",     routes: ["/server-monitoring"] },
      { slug: "command",   label: "Command",   icon: "Settings",    routes: ["/noc-command"] },
      { slug: "sip-rtp",   label: "SIP / RTP", icon: "Layers",      routes: ["/sip-trace"] },
    ],
  },

  // ── PHASE 4: Analytics (routes not wrapped yet — seeded for future phase)
  {
    slug: "analytics-hub",
    label: "Analytics Hub",
    description: "Traffic, quality, revenue, AI insights, and reports",
    portalSlug: "analytics",
    domainId: "analytics",
    icon: "BarChart2",
    sortOrder: 50,
    tabs: [
      { slug: "traffic",    label: "Traffic",    icon: "Activity",  routes: ["/analytics", "/traffic-forecast"] },
      { slug: "quality",    label: "Quality",    icon: "TrendingUp",routes: ["/asr-acd", "/qos-heatmap", "/codec-analytics"] },
      { slug: "revenue",    label: "Revenue",    icon: "BarChart2", routes: ["/revenue-heatmap", "/margin-intelligence"] },
      { slug: "ai-insights",label: "AI Insights",icon: "Brain",     routes: ["/intelligence", "/ai-assurance"] },
      { slug: "reports",    label: "Reports",    icon: "FileText",  routes: ["/reports", "/executive-reports"] },
      { slug: "cdrs",       label: "CDR Viewer", icon: "Layers",    routes: ["/cdrs"] },
    ],
  },
];

export async function seedWorkspacesIfEmpty(): Promise<void> {
  try {
    for (const ws of WORKSPACES) {
      const [existing] = await db
        .select({ id: workspaceDefinitions.id })
        .from(workspaceDefinitions)
        .where(eq(workspaceDefinitions.slug, ws.slug))
        .limit(1);

      if (existing) continue; // already seeded — skip

      console.log(`[workspace-seed] Seeding workspace: ${ws.slug}`);

      const [wsRow] = await db
        .insert(workspaceDefinitions)
        .values({
          slug:        ws.slug,
          label:       ws.label,
          description: ws.description,
          portalSlug:  ws.portalSlug,
          domainId:    ws.domainId,
          icon:        ws.icon,
          sortOrder:   ws.sortOrder,
          isActive:    true,
        })
        .returning();

      let tabOrder = 0;
      for (const tab of ws.tabs) {
        const [tabRow] = await db
          .insert(workspaceTabs)
          .values({
            workspaceId:     wsRow.id,
            slug:            tab.slug,
            label:           tab.label,
            icon:            tab.icon ?? null,
            sortOrder:       tabOrder++,
            isVisible:       true,
            visibilityRoles: null,
          })
          .returning();

        let itemOrder = 0;
        for (const route of tab.routes) {
          await db.insert(workspaceTabItems).values({
            tabId:           tabRow.id,
            route,
            label:           null,
            icon:            null,
            sortOrder:       itemOrder++,
            isContextual:    false,
            isHidden:        false,
            visibilityRoles: null,
          });
        }
        for (const route of (tab.contextualRoutes ?? [])) {
          await db.insert(workspaceTabItems).values({
            tabId:           tabRow.id,
            route,
            label:           null,
            icon:            null,
            sortOrder:       itemOrder++,
            isContextual:    true,
            isHidden:        false,
            visibilityRoles: null,
          });
        }
      }
    }

    console.log(`[workspace-seed] Workspace sync complete.`);
  } catch (err: any) {
    console.warn('[workspace-seed] Non-fatal seed error:', err?.message ?? err);
  }
}
