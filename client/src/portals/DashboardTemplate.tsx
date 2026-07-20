/**
 * DashboardTemplate.tsx
 *
 * Shared dashboard template used by all BitsAuto portals.
 * Accepts a PortalConfig object — only the config changes per portal.
 *
 * Dashboard Template v1.0 section order (FROZEN):
 *   1  KPI Cards
 *   2  Live Telemetry
 *   3  Quick Actions        ← fixed position across all portals
 *   4  Main Data Widget     ← portal-specific, config-driven
 *   5  Smart Priorities
 *   6  Primary Workflows
 *   7  Secondary Workflows
 *   8  System Health
 *   9  Live Operational Feed
 *  10  Risk & Exceptions
 *
 * Sections 1, 2, 5, 8, 9, 10 reuse the existing DashboardPage widgets.
 * Sections 3, 4, 6, 7 receive NOC-specific config from PortalConfig.
 *
 * To add a new portal: create a new config file (e.g. commercial.config.ts)
 * and pass it here. No new JSX required.
 */

import { Link } from "wouter";
import { cn } from "@/lib/utils";
import type { PortalConfig, WorkflowCard, QuickAction } from "@/portals/types/portal-config.types";
import { isNavGroup } from "@/portals/types/portal-config.types";

import {
  Phone, Activity, Map, Monitor, Terminal, LayoutGrid,
  Cpu, BarChart2, Shield, Wrench, FileText, TrendingUp,
  Zap, ArrowRight, Lock,
  MessageCircle, Radio, Building2, Hash, HeartPulse, Clipboard,
  Handshake, GitBranch, Telescope, Eye, History, Brain, Search,
  Route, TrendingDown, Compass, ArrowRightLeft, ShieldAlert,
  CheckCircle, Mic, Globe, Users, Wifi, Server, HardDrive,
  Layers, Mail, MessageSquare, LayoutDashboard, SquareTerminal,
} from "lucide-react";

// ── Icon registry ─────────────────────────────────────────────────────────────
// Maps the icon string in config to a Lucide component.
// Add entries here as new portal configs reference new icons.
const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  'phone':              Phone,
  'activity':           Activity,
  'map':                Map,
  'monitor':            Monitor,
  'terminal':           Terminal,
  'layout-grid':        LayoutGrid,
  'cpu':                Cpu,
  'bar-chart-2':        BarChart2,
  'shield':             Shield,
  'wrench':             Wrench,
  'file-text':          FileText,
  'trending-up':        TrendingUp,
  'zap':                Zap,
  // Sprint #368 additions
  'message-circle':     MessageCircle,
  'radio':              Radio,
  'building-2':         Building2,
  'hash':               Hash,
  'heart-pulse':        HeartPulse,
  'clipboard':          Clipboard,
  'handshake':          Handshake,
  'git-branch':         GitBranch,
  'telescope':          Telescope,
  'eye':                Eye,
  'history':            History,
  'brain':              Brain,
  'search':             Search,
  'route':              Route,
  'trending-down':      TrendingDown,
  'compass':            Compass,
  'arrow-right-left':   ArrowRightLeft,
  'shield-alert':       ShieldAlert,
  'check-circle':       CheckCircle,
  'mic':                Mic,
  'lock':               Lock,
  'globe':              Globe,
  'users':              Users,
  'wifi':               Wifi,
  'server':             Server,
  'hard-drive':         HardDrive,
  'layers':             Layers,
  'mail':               Mail,
  'message-square':     MessageSquare,
  'layout-dashboard':   LayoutDashboard,
  'square-terminal':    SquareTerminal,
};

function PortalIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICON_MAP[name] ?? Activity;
  return <Icon className={className} />;
}

// ── Section 3: Quick Actions ─────────────────────────────────────────────────

function QuickActionsSection({ actions }: { actions: QuickAction[] }) {
  return (
    <section className="px-6 py-4 border-b bg-muted/20">
      <div className="flex items-center gap-2 mb-3">
        <Zap className="h-4 w-4 text-primary" />
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Quick Actions</h3>
      </div>
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <Link key={action.path} href={action.path}>
            <a className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-background border text-sm font-medium text-foreground hover:bg-muted/60 hover:border-primary/40 transition-colors">
              <PortalIcon name={action.icon} className="h-3.5 w-3.5 text-primary" />
              {action.label}
            </a>
          </Link>
        ))}
      </div>
    </section>
  );
}

// ── Section 6 & 7: Workflow Cards ─────────────────────────────────────────────

function WorkflowCardItem({ card }: { card: WorkflowCard }) {
  const isComingSoon = card.status === 'coming-soon';

  const inner = (
    <div
      className={cn(
        "group relative flex flex-col gap-2 p-4 rounded-xl border bg-background transition-all",
        isComingSoon
          ? "opacity-50 cursor-not-allowed select-none"
          : "hover:border-primary/50 hover:shadow-sm cursor-pointer"
      )}
    >
      {isComingSoon && (
        <div className="absolute top-3 right-3">
          <Lock className="h-3 w-3 text-muted-foreground" />
        </div>
      )}
      <div className={cn(
        "w-8 h-8 rounded-lg flex items-center justify-center",
        isComingSoon ? "bg-muted" : "bg-primary/10 group-hover:bg-primary/15 transition-colors"
      )}>
        <PortalIcon
          name={card.icon}
          className={cn("h-4 w-4", isComingSoon ? "text-muted-foreground" : "text-primary")}
        />
      </div>
      <div>
        <p className="text-sm font-semibold text-foreground">{card.label}</p>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{card.description}</p>
      </div>
      {!isComingSoon && (
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-primary/60 transition-colors mt-auto self-end" />
      )}
    </div>
  );

  if (isComingSoon) return inner;

  return (
    <Link href={card.path}>
      <a className="block">{inner}</a>
    </Link>
  );
}

function WorkflowSection({
  title,
  cards,
  variant,
}: {
  title: string;
  cards: WorkflowCard[];
  variant: 'primary' | 'secondary';
}) {
  return (
    <section className="px-6 py-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {variant === 'secondary' && cards.some((c) => c.status === 'coming-soon') && (
          <span className="text-[10px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
            Some features coming soon
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {cards.map((card) => (
          <WorkflowCardItem key={card.label} card={card} />
        ))}
      </div>
    </section>
  );
}

// ── Section divider ───────────────────────────────────────────────────────────

function SectionDivider() {
  return <div className="border-b mx-6" />;
}

// ── DashboardTemplate ─────────────────────────────────────────────────────────

interface DashboardTemplateProps {
  config: PortalConfig;
  /**
   * Slot for Section 1: KPI Cards.
   * Pass the existing <KpiWidgets /> or portal-specific KPI component.
   * Falls back to a placeholder if not provided.
   */
  kpiCards?: React.ReactNode;
  /**
   * Slot for Section 2: Live Telemetry.
   * Pass the existing telemetry chart + right-panel component.
   */
  telemetry?: React.ReactNode;
  /**
   * Slot for Section 4: Main Data Widget.
   * Pass the existing component for this portal's main data view.
   * NOC → Live Calls table component
   */
  mainWidget?: React.ReactNode;
  /**
   * Slot for Section 5: Smart Priorities.
   */
  smartPriorities?: React.ReactNode;
  /**
   * Slot for Section 8: System Health.
   */
  systemHealth?: React.ReactNode;
  /**
   * Slot for Section 9: Live Operational Feed.
   */
  operationalFeed?: React.ReactNode;
  /**
   * Slot for Section 10: Risk & Exceptions.
   */
  riskSection?: React.ReactNode;
}

/**
 * DashboardTemplate
 *
 * Generic portal dashboard. Renders 10 sections in the frozen order.
 * Sections 1, 2, 4, 5, 8, 9, 10 accept existing components as render props.
 * Sections 3, 6, 7 are driven by the PortalConfig passed in.
 *
 * Usage:
 *   <DashboardTemplate
 *     config={nocPortalConfig}
 *     kpiCards={<ExistingKpiWidgets />}
 *     telemetry={<ExistingTelemetrySection />}
 *     mainWidget={<CallsListPage embedded />}
 *     smartPriorities={<ExistingSmartPriorities />}
 *     systemHealth={<ExistingSystemHealth />}
 *     operationalFeed={<ExistingOperationalFeed />}
 *     riskSection={<ExistingRiskDestinations />}
 *   />
 */
export function DashboardTemplate({
  config,
  kpiCards,
  telemetry,
  mainWidget,
  smartPriorities,
  systemHealth,
  operationalFeed,
  riskSection,
}: DashboardTemplateProps) {
  const { quickActions, workflows, widgets } = config;

  return (
    <div className="flex flex-col min-h-full bg-background">

      {/* ── Section 1: KPI Cards ───────────────────────────────────────────── */}
      {kpiCards && (
        <>
          <div className="px-6 pt-5 pb-4">
            {kpiCards}
          </div>
          <SectionDivider />
        </>
      )}

      {/* ── Section 2: Live Telemetry ─────────────────────────────────────── */}
      {widgets.telemetry.enabled && telemetry && (
        <>
          <div className="px-6 py-4">
            {telemetry}
          </div>
          <SectionDivider />
        </>
      )}

      {/* ── Section 3: Quick Actions (fixed position) ─────────────────────── */}
      <QuickActionsSection actions={quickActions.actions} />

      {/* ── Section 4: Main Data Widget (portal-specific) ─────────────────── */}
      {mainWidget && (
        <>
          <div className="px-6 py-4">
            <div className="flex items-center gap-2 mb-3">
              <h3 className="text-sm font-semibold text-foreground">{widgets.mainWidget.label}</h3>
            </div>
            {mainWidget}
          </div>
          <SectionDivider />
        </>
      )}

      {/* ── Section 5: Smart Priorities ───────────────────────────────────── */}
      {widgets.smartPriorities.enabled && smartPriorities && (
        <>
          <div className="px-6 py-4">
            {smartPriorities}
          </div>
          <SectionDivider />
        </>
      )}

      {/* ── Section 6: Primary Workflows ─────────────────────────────────── */}
      <WorkflowSection
        title="Primary Workflows"
        cards={workflows.primary}
        variant="primary"
      />

      {/* ── Section 7: Secondary Workflows ───────────────────────────────── */}
      {workflows.secondary.length > 0 && (
        <>
          <SectionDivider />
          <WorkflowSection
            title="Secondary Workflows"
            cards={workflows.secondary}
            variant="secondary"
          />
        </>
      )}

      {/* ── Section 8: System Health ──────────────────────────────────────── */}
      {widgets.systemHealth.enabled && systemHealth && (
        <>
          <SectionDivider />
          <div className="px-6 py-4">
            {systemHealth}
          </div>
        </>
      )}

      {/* ── Section 9: Live Operational Feed ─────────────────────────────── */}
      {widgets.operationalFeed.enabled && operationalFeed && (
        <>
          <SectionDivider />
          <div className="px-6 py-4">
            {operationalFeed}
          </div>
        </>
      )}

      {/* ── Section 10: Risk & Exceptions ────────────────────────────────── */}
      {widgets.riskSection.enabled && riskSection && (
        <>
          <SectionDivider />
          <div className="px-6 py-5 pb-8">
            <div className="flex items-center gap-2 mb-3">
              <h3 className="text-sm font-semibold text-foreground">{widgets.riskSection.label}</h3>
            </div>
            {riskSection}
          </div>
        </>
      )}

    </div>
  );
}
