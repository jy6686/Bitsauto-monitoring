import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useLocation, useSearch } from "wouter";
import {
  Radio, Users, Wifi, GitBranch, BarChart2,
  Wrench, ShieldAlert, Settings, ChevronRight, ChevronDown,
  Activity, Globe, Phone, PhoneCall, Server,
  LineChart, Eye, Monitor, Database, Network,
  HardDrive, Layers, Calculator, Route, FlaskConical,
  Shield, ShieldCheck, FileText, Lock, TrendingDown, History,
  LayoutDashboard, Zap, Map as MapIcon, BarChart3, Brain,
  SlidersHorizontal, Key, Mail, Building2, Wallet, Banknote,
  HeartPulse, Mic, Bot, ClipboardList, ArrowRightLeft, BrainCircuit,
  FileSpreadsheet, Rewind, Upload, Star, Package, Search,
  MessageSquare, Bell, Sun, Moon, LogOut, UserPlus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { useQuery } from "@tanstack/react-query";
import { inferWorkspace } from "@/lib/workspace";
import type { WorkspaceDefinition } from "@shared/schema";
import { useChatDrawer } from "@/context/chat-drawer-context";
import { PortalTopNav } from "@/components/portal-sidebar";
import { usePortal } from "@/context/portal-context";
import { FavoritesStrip } from "@/components/favorites-strip";

function openCommandBar() {
  document.dispatchEvent(new CustomEvent('open-command-palette', { bubbles: true }));
}

interface NavStats { activeIncidents: number; pendingApprovals: number; degradedCarriers: number; }
interface Module  { href: string; label: string; desc: string; icon: React.ComponentType<{ className?: string }> }
interface Group   { label: string; desc?: string; icon: React.ComponentType<{ className?: string }>; items: Module[]; badge?: (s: NavStats) => number }
interface Domain  { id: string; label: string; icon: React.ComponentType<{ className?: string }>; color: string; groups: Group[] }

// ─────────────────────────────────────────────────────────────────────────────
// [MAINTENANCE-ONLY] DOMAINS — Full-platform domain tab registry.
// New PORTAL-specific features → portal_sections + portal_module_assignments (DB).
// New FULL-PLATFORM features → add here ONLY (never duplicate into both systems).
// SIDEBAR_GROUPS and WORKSPACE_RAIL in layout-shell.tsx are also frozen.
// Runtime configuration: /workspace-settings (admin), /governance (super_admin).
// ─────────────────────────────────────────────────────────────────────────────
const DOMAINS: Domain[] = [
  // ── 1. LIVE NETWORK ──────────────────────────────────────────────────────────
  {
    id: 'live-network', label: 'Live Network', icon: Radio, color: 'text-emerald-400',
    groups: [
      { label: 'Live Operations', desc: 'Active calls, alerts and real-time traffic', icon: Phone, badge: (s) => s.activeIncidents, items: [
        { href: '/calls',           label: 'Live Calls',      desc: 'Active calls monitor',              icon: Phone },
        { href: '/alerts',          label: 'Alerts',          desc: 'Platform alerts & incidents',        icon: Zap },
        { href: '/live-traffic',    label: 'Live Traffic',    desc: 'Active call stream',                icon: Activity },
        { href: '/traffic-map',     label: 'Traffic Map',     desc: 'Geographic call view',              icon: Globe },
        { href: '/call-governance', label: 'Call Governance', desc: 'Vendor cap timer + replay engine',  icon: Shield },
      ]},
      { label: 'Command Centre', desc: 'NOC dashboards, incident management and ops console', icon: Monitor, badge: (s) => s.activeIncidents, items: [
        { href: '/noc-dashboard', label: 'NOC Dashboard',    desc: 'Network operations overview',  icon: Monitor },
        { href: '/noc-incidents', label: 'Incident Command', desc: 'NOC incident management',      icon: ShieldAlert },
        { href: '/noc-command',   label: 'NOC Command',      desc: 'Operator command centre',      icon: Monitor },
        { href: '/ops-console',   label: 'Ops Console',      desc: 'Unified operations surface',   icon: SlidersHorizontal },
      ]},
      { label: 'Infrastructure', desc: 'Server health, SBC, topology and performance charts', icon: Server, items: [
        { href: '/server-monitoring', label: 'Server Monitor',   desc: 'Infrastructure health',        icon: Server },
        { href: '/sbc-monitor',       label: 'SBC Monitor',      desc: 'Session border controller',    icon: HardDrive },
        { href: '/network-topology',  label: 'Network Topology', desc: 'Topology visualisation',       icon: Network },
        { href: '/graphs',            label: 'Graphs',           desc: 'Real-time performance charts', icon: LineChart },
        { href: '/multi-switch',      label: 'Multi-Switch',     desc: 'Consolidated switch view',     icon: Layers },
      ]},
    ],
  },

  // ── 2. CLIENTS ───────────────────────────────────────────────────────────────
  {
    id: 'company', label: 'Clients', icon: Building2, color: 'text-amber-400',
    groups: [
      { label: 'Account Management', desc: 'Client accounts, portals and resellers', icon: Users, items: [
        { href: '/clients',       label: 'Accounts',      desc: 'All client accounts',         icon: Users },
        { href: '/client-portal', label: 'Client Portal', desc: 'Self-service client access',  icon: Globe },
        { href: '/reseller',      label: 'Resellers',     desc: 'Partner & reseller accounts', icon: Star },
        { href: '/company/list',  label: 'Company List',  desc: 'All company profiles',        icon: Building2 },
      ]},
      { label: 'Onboarding', desc: 'Account provisioning and organisation management', icon: Zap, items: [
        { href: '/client/wizard',      label: 'Account Wizard',    desc: 'Provision a new account',         icon: UserPlus },
        { href: '/company/onboarding', label: 'Onboarding Wizard', desc: 'Full customer onboarding flow',   icon: Zap },
        { href: '/company-profile',    label: 'Org Management',    desc: 'Company lifecycle & org details',  icon: Building2 },
      ]},
      { label: 'Assets & Numbers', desc: 'DID inventory and account naming', icon: Phone, items: [
        { href: '/dids',          label: 'DID Management', desc: 'Number inventory management', icon: Phone },
        { href: '/account-names', label: 'Account Names',  desc: 'Account naming & aliases',    icon: FileText },
      ]},
    ],
  },

  // ── 3. OPERATIONS (includes Diagnostics — formerly Troubleshooting tab) ──────
  {
    id: 'operations', label: 'Operations', icon: Wifi, color: 'text-blue-400',
    groups: [
      { label: 'Carriers', desc: 'Carrier accounts, SLA scoring, stability and balances', icon: Wifi, badge: (s) => s.degradedCarriers, items: [
        { href: '/vendors',                   label: 'Vendor List',        desc: 'All carrier accounts',      icon: Wifi },
        { href: '/balance',                   label: 'Balance Monitor',    desc: 'Vendor account balances',   icon: Wallet },
        { href: '/vendor-sla-scorecard',      label: 'SLA Scorecard',      desc: 'Carrier SLA performance',   icon: HeartPulse },
        { href: '/carrier-scoring',           label: 'Carrier Scoring',    desc: 'Quality benchmarks',        icon: BarChart3 },
        { href: '/vendor-stability-timeline', label: 'Stability Timeline', desc: 'Vendor stability history',  icon: Activity },
      ]},
      { label: 'Routing', desc: 'Routing groups, LCR analysis, simulators and route testing', icon: GitBranch, items: [
        { href: '/routing-manager',     label: 'Routing Manager', desc: 'Groups, connections & translations', icon: GitBranch },
        { href: '/auth-studio',         label: 'Auth Studio',     desc: 'Client → Destination → RG provisioning', icon: ShieldCheck },
        { href: '/lcr-analyser',        label: 'LCR Analyser',    desc: 'Least-cost routing engine',          icon: Calculator },
        { href: '/test-call',           label: 'Route Tester',    desc: 'On-demand route test calls',         icon: PhoneCall },
        { href: '/call-flow-simulator', label: 'Route Simulator', desc: 'Simulate routing decisions',         icon: ArrowRightLeft },
        { href: '/self-heal',           label: 'Self-Heal',       desc: 'Auto-healing & failover engine',     icon: HeartPulse },
      ]},
      { label: 'Messaging', desc: 'BhaooSMS gateway, SMS delivery monitoring and A2P operations', icon: MessageSquare, items: [
        { href: '/sms-monitor',        label: 'SMS Monitor',         desc: 'Live delivery rates and gateway status',       icon: MessageSquare },
        { href: '/voice-otp',          label: 'Voice OTP',           desc: 'Asterisk AMI · OTP call origination',         icon: Phone },
        { href: '/termination-chains', label: 'Termination Chains',  desc: 'End-to-end entity mapping across all systems', icon: GitBranch },
      ]},
      { label: 'Diagnostics', desc: 'SIP tracing, session replay, test suites and engineering tools', icon: Wrench, items: [
        { href: '/sip-trace',      label: 'SIP Trace',      desc: 'Packet-level SIP tracing',  icon: Mic },
        { href: '/replay',         label: 'Replay Engine',  desc: 'Call session replay',        icon: Rewind },
        { href: '/test-campaigns', label: 'Test Campaigns', desc: 'Automated test suites',      icon: FlaskConical },
        { href: '/tools',          label: 'Tools',          desc: 'Engineering utilities',      icon: Wrench },
      ]},
    ],
  },

  // ── 4. ANALYTICS ─────────────────────────────────────────────────────────────
  {
    id: 'analytics', label: 'Analytics', icon: BarChart2, color: 'text-indigo-400',
    groups: [
      { label: 'Traffic & Quality', desc: 'Call traffic, ASR/ACD, QoS, RTP and codec analytics', icon: Activity, items: [
        { href: '/analytics',       label: 'Traffic Analytics', desc: 'Call traffic analytics',    icon: Activity },
        { href: '/asr-acd',         label: 'ASR / ACD',         desc: 'ASR/ACD call quality KPIs', icon: BarChart3 },
        { href: '/qos-heatmap',     label: 'QoS Heatmap',       desc: 'Quality of service map',    icon: HeartPulse },
        { href: '/rtp-analytics',   label: 'RTP Analytics',     desc: 'Media quality & jitter',    icon: Activity },
        { href: '/codec-analytics', label: 'Codec Analytics',   desc: 'Codec breakdown analysis',  icon: Route },
      ]},
      { label: 'Reports & Forecasting', desc: 'Revenue reports, traffic forecasting and executive summaries', icon: TrendingDown, items: [
        { href: '/reports',           label: 'Reports',           desc: 'Standard report centre',    icon: BarChart2 },
        { href: '/executive-reports', label: 'Executive Reports', desc: 'C-suite summary views',     icon: Star },
        { href: '/traffic-forecast',  label: 'Traffic Forecast',  desc: 'Demand forecasting',        icon: TrendingDown },
        { href: '/revenue-heatmap',   label: 'Revenue Heatmap',   desc: 'Revenue visualisation map', icon: MapIcon },
      ]},
      { label: 'CDRs & Drill-Down', desc: 'Call detail records and BitsEye deep analytics', icon: History, items: [
        { href: '/cdrs',    label: 'CDR Viewer', desc: 'Call detail records',       icon: History },
        { href: '/bitseye', label: 'BitsEye',    desc: 'Drill-down CDR analytics',  icon: Eye },
      ]},
    ],
  },

  // ── 5. INTELLIGENCE ──────────────────────────────────────────────────────────
  {
    id: 'intelligence', label: 'Intelligence', icon: Brain, color: 'text-fuchsia-400',
    groups: [
      { label: 'AI Operations', desc: 'Anomaly detection, AI decisions and data quality', icon: Bot, badge: (s) => s.activeIncidents, items: [
        { href: '/ai-ops',                  label: 'AI Ops Center',      desc: 'Anomaly detection & AI ops',      icon: Bot },
        { href: '/intelligence',            label: 'Intelligence Hub',   desc: 'Correlated multi-source signals', icon: Brain },
        { href: '/intelligence-validation', label: 'Validation Console', desc: 'Data quality & trust scoring',    icon: Shield },
      ]},
      { label: 'Carrier Intelligence', desc: 'Vendor RCA, prefix signals and route intelligence', icon: Search, badge: (s) => s.degradedCarriers, items: [
        { href: '/carrier-intelligence',       label: 'Carrier Intelligence', desc: 'Route health signals',       icon: Brain },
        { href: '/vendor-rca',                 label: 'Vendor RCA',           desc: 'Root cause analysis',        icon: Search },
        { href: '/vendor-prefix-intelligence', label: 'Prefix Intelligence',  desc: 'Prefix-level signals',       icon: Globe },
        { href: '/routing-intelligence',       label: 'Routing Intelligence', desc: 'Route intelligence engine',  icon: GitBranch },
      ]},
      { label: 'Optimisation', desc: 'Route and cost optimisation, traffic steering and simulation', icon: TrendingDown, items: [
        { href: '/cost-optimisation',   label: 'Cost Optimisation',  desc: 'Route cost engine',                 icon: TrendingDown },
        { href: '/route-optimisation',  label: 'Route Optimisation', desc: 'Advisory carrier recommendations',  icon: BrainCircuit },
        { href: '/traffic-steering',    label: 'Traffic Steering',   desc: 'Carrier shift suggestions',         icon: ArrowRightLeft },
        { href: '/simulation-sandbox',  label: 'Simulation Sandbox', desc: 'Model traffic shifts — no impact',  icon: FlaskConical },
        { href: '/number-intelligence', label: 'Number Intel',       desc: 'Number-level analysis',             icon: Phone },
      ]},
    ],
  },

  // ── 6. SECURITY ──────────────────────────────────────────────────────────────
  {
    id: 'security', label: 'Security', icon: ShieldAlert, color: 'text-rose-400',
    groups: [
      { label: 'Fraud & Detection', desc: 'FAS/IRSF detection, firewall, SLA breaches and call attestation', icon: ShieldAlert, badge: (s) => s.activeIncidents, items: [
        { href: '/fraud',        label: 'Fraud Engine',  desc: 'FAS/IRSF detection engine',  icon: ShieldAlert },
        { href: '/firewall',     label: 'Firewall',      desc: 'Auto-blacklist management',   icon: Shield },
        { href: '/sla-breaches', label: 'SLA Breaches',  desc: 'SLA breach tracking',         icon: Zap },
        { href: '/stir-shaken',  label: 'STIR/SHAKEN',   desc: 'Call attestation framework',  icon: Lock },
      ]},
      { label: 'Approvals & Access', desc: 'Pending approvals, governance rules and permissions', icon: Lock, badge: (s) => s.pendingApprovals, items: [
        { href: '/approvals',         label: 'Approval Queue',     desc: 'Pending approval items',        icon: FileText },
        { href: '/approval-settings', label: 'Approval Rules',     desc: 'Approval rule configuration',   icon: SlidersHorizontal },
        { href: '/rbac',              label: 'Permission Matrix',  desc: 'Role-based access control',     icon: Lock },
        { href: '/mfa-setup',         label: 'MFA / 2FA',          desc: 'Multi-factor authentication',   icon: Shield },
      ]},
      { label: 'Compliance & Audit', desc: 'Audit trail, compliance rules and call recordings', icon: ClipboardList, items: [
        { href: '/compliance',      label: 'Compliance',  desc: 'Regulatory compliance',     icon: ClipboardList },
        { href: '/audit-log',       label: 'Audit Log',   desc: 'Platform activity trail',   icon: FileText },
        { href: '/call-recordings', label: 'Recordings',  desc: 'Call recordings archive',   icon: Mic },
      ]},
    ],
  },

  // ── 7. FINANCE ───────────────────────────────────────────────────────────────
  {
    id: 'finance', label: 'Finance', icon: Banknote, color: 'text-emerald-400',
    groups: [
      { label: 'Invoicing & Billing', desc: 'Invoices, billing overview, credit and payment management', icon: FileText, items: [
        { href: '/billing',           label: 'Billing Overview', desc: 'Billing summary & payments',  icon: Wallet },
        { href: '/invoices',          label: 'Invoices',         desc: 'Invoice management',          icon: FileText },
        { href: '/invoice-jobs',      label: 'Invoice Queue',    desc: 'Scheduled invoice jobs',      icon: ClipboardList },
        { href: '/invoice-templates', label: 'Templates',        desc: 'Reusable invoice templates',  icon: FileSpreadsheet },
        { href: '/credit-notes',      label: 'Credit Notes',     desc: 'Credit note issuance',        icon: History },
        { href: '/credit-control',    label: 'Credit Control',   desc: 'Credit risk management',      icon: Banknote },
      ]},
      { label: 'Revenue Assurance', desc: 'DMR, reconciliation, AI assurance and margin intelligence', icon: Brain, items: [
        { href: '/dmr',                    label: 'Daily Minutes',       desc: 'Usage reconciliation',        icon: Activity },
        { href: '/margin-intelligence',    label: 'Margin Intelligence', desc: 'Cost vs revenue margins',     icon: TrendingDown },
        { href: '/client-reconciliation',  label: 'Client Recon',        desc: 'Client-side reconciliation',  icon: ArrowRightLeft },
        { href: '/carrier-reconciliation', label: 'Carrier Recon',       desc: 'Carrier-side reconciliation', icon: ArrowRightLeft },
        { href: '/ai-assurance',           label: 'AI Assurance',        desc: 'AI-driven revenue checks',    icon: BrainCircuit },
      ]},
      { label: 'Disputes', desc: 'Billing disputes, case tracking and defense toolkit', icon: Shield, items: [
        { href: '/billing-disputes', label: 'Disputes',        desc: 'Billing dispute resolution', icon: Shield },
        { href: '/dispute-cases',    label: 'Dispute Cases',   desc: 'Active dispute tracker',     icon: ClipboardList },
        { href: '/dispute-defense',  label: 'Dispute Defense', desc: 'Evidence & defense toolkit', icon: ShieldAlert },
      ]},
      { label: 'Products & Pricing', desc: 'Product catalogue, rate cards and partner profiles', icon: Package, items: [
        { href: '/products',          label: 'Products',       desc: 'Product catalogue',           icon: Package },
        { href: '/rate-cards',        label: 'Rate Cards',     desc: 'Rate decks & pricing',        icon: FileSpreadsheet },
        { href: '/partner-profiles',  label: 'Partner Portal', desc: 'Partner billing & profiles',  icon: Star },
      ]},
    ],
  },

  // ── 8. PLATFORM ──────────────────────────────────────────────────────────────
  {
    id: 'platform', label: 'Platform', icon: Settings, color: 'text-slate-400',
    groups: [
      { label: 'System', desc: 'System configuration, workspaces, VPN and navigation', icon: Settings, items: [
        { href: '/settings',           label: 'Platform Settings',  desc: 'System configuration',          icon: Settings },
        { href: '/workspace-settings', label: 'Workspace Settings', desc: 'Portal workspaces & themes',    icon: Layers },
        { href: '/sidebar-settings',   label: 'Navigation Manager', desc: 'Sidebar item visibility',       icon: SlidersHorizontal },
        { href: '/governance',         label: 'Governance Console', desc: 'Module assignments & sections', icon: Shield },
        { href: '/vpn-config',         label: 'VPN Config',         desc: 'VPN configuration',             icon: Lock },
      ]},
      { label: 'Team & Access', desc: 'Team roles, access control and API keys', icon: Users, items: [
        { href: '/team',     label: 'Team & KAM', desc: 'Roles & access control', icon: Users },
        { href: '/api-keys', label: 'API Keys',   desc: 'API key management',     icon: Key },
      ]},
      { label: 'Notifications', desc: 'WhatsApp, email and platform notification configuration', icon: Mail, items: [
        { href: '/notification-centre', label: 'Notification Centre', desc: 'All platform notifications',   icon: Bell },
        { href: '/email-centre',        label: 'Email Centre',        desc: 'Email notification rules',     icon: Mail },
        { href: '/whatsapp-alerts',     label: 'WhatsApp Alerts',     desc: 'Alert delivery via WhatsApp',  icon: MessageSquare },
      ]},
    ],
  },
];

const NAV_HIDDEN_KEY = 'voip-nav-hidden-domains';

// ── Portal workspace button colour maps ───────────────────────────────────────
const PORTAL_BTN_ACTIVE: Record<string, string> = {
  purple: "bg-purple-500/20 text-purple-200 border border-purple-500/40",
  blue:   "bg-blue-500/20 text-blue-200 border border-blue-500/40",
  green:  "bg-emerald-500/20 text-emerald-200 border border-emerald-500/40",
  indigo: "bg-indigo-500/20 text-indigo-200 border border-indigo-500/40",
  slate:  "bg-slate-500/20 text-slate-200 border border-slate-500/40",
  neutral:"bg-violet-500/20 text-violet-200 border border-violet-500/40",
  amber:  "bg-amber-500/20 text-amber-200 border border-amber-500/40",
  teal:   "bg-teal-500/20 text-teal-200 border border-teal-500/40",
};
const PORTAL_BTN_IDLE: Record<string, string> = {
  purple: "hover:bg-purple-500/10 hover:text-purple-300 border border-transparent hover:border-purple-500/20",
  blue:   "hover:bg-blue-500/10 hover:text-blue-300 border border-transparent hover:border-blue-500/20",
  green:  "hover:bg-emerald-500/10 hover:text-emerald-300 border border-transparent hover:border-emerald-500/20",
  indigo: "hover:bg-indigo-500/10 hover:text-indigo-300 border border-transparent hover:border-indigo-500/20",
  slate:  "hover:bg-slate-500/10 hover:text-slate-300 border border-transparent hover:border-slate-500/20",
  neutral:"hover:bg-violet-500/10 hover:text-violet-300 border border-transparent hover:border-violet-500/20",
  amber:  "hover:bg-amber-500/10 hover:text-amber-300 border border-transparent hover:border-amber-500/20",
  teal:   "hover:bg-teal-500/10 hover:text-teal-300 border border-transparent hover:border-teal-500/20",
};
const PORTAL_UNDERLINE: Record<string, string> = {
  purple: "bg-gradient-to-r from-purple-400 to-indigo-500",
  blue:   "bg-gradient-to-r from-blue-400 to-cyan-500",
  green:  "bg-gradient-to-r from-emerald-400 to-teal-500",
  indigo: "bg-gradient-to-r from-indigo-400 to-violet-500",
  slate:  "bg-gradient-to-r from-slate-400 to-slate-600",
  neutral:"bg-gradient-to-r from-violet-400 to-indigo-500",
  amber:  "bg-gradient-to-r from-amber-400 to-orange-500",
  teal:   "bg-gradient-to-r from-teal-400 to-emerald-500",
};
const ROUTE_META: Record<string, { domain: string; label: string }> = {};
for (const d of DOMAINS) {
  for (const g of d.groups) {
    for (const m of g.items) {
      if (!ROUTE_META[m.href]) ROUTE_META[m.href] = { domain: d.id, label: m.label };
    }
  }
}
function inferMeta(path: string): { domain: string; label: string } {
  const domain = inferWorkspace(path);
  const direct = ROUTE_META[path];
  if (direct) return { domain, label: direct.label };
  const clean = path.split('?')[0];
  for (const prefix of Object.keys(ROUTE_META).sort((a, b) => b.length - a.length)) {
    if (clean.startsWith(prefix + '/')) return { domain, label: ROUTE_META[prefix].label };
  }
  return { domain, label: 'Dashboard' };
}

// ── Cascade Menu (L2 dropdown + L3 submenu) ───────────────────────────────────
function CascadeMenu({ domain, onClose, openLeft, stats, hiddenItems }: {
  domain: Domain; onClose: () => void; openLeft?: boolean; stats: NavStats; hiddenItems: Set<string>;
}) {
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const groupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const enterGroup = (label: string) => {
    if (groupTimer.current) clearTimeout(groupTimer.current);
    setActiveGroup(label);
  };
  const leaveGroup = () => {
    groupTimer.current = setTimeout(() => setActiveGroup(null), 140);
  };
  const stayGroup = () => {
    if (groupTimer.current) clearTimeout(groupTimer.current);
  };

  const panelStyle: React.CSSProperties = {
    background:           'hsl(var(--background)/0.98)',
    backdropFilter:       'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    border:               '1px solid rgba(255,255,255,0.07)',
    borderRadius:         10,
    boxShadow:            '0 16px 48px rgba(0,0,0,0.45)',
  };

  // Filter out hidden items, then skip groups with nothing left
  const visibleGroups = domain.groups
    .map(group => ({ ...group, items: group.items.filter(item => !hiddenItems.has(item.href)) }))
    .filter(group => group.items.length > 0);

  return (
    <div className="relative" onMouseLeave={onClose}>
      {/* ── L2 dropdown ── */}
      <div className="py-1.5 min-w-[210px]" style={panelStyle}>
        {visibleGroups.map(group => {
          const isActive   = activeGroup === group.label;
          const badgeCount = group.badge ? group.badge(stats) : 0;
          return (
            <div
              key={group.label}
              className="relative px-1"
              onMouseEnter={() => enterGroup(group.label)}
              onMouseLeave={leaveGroup}
            >
              <div className={cn(
                "flex items-start gap-2.5 px-3 py-2 rounded-lg cursor-default transition-colors duration-100 select-none",
                isActive
                  ? "bg-white/[0.09] text-foreground"
                  : "text-muted-foreground/70 hover:text-foreground hover:bg-white/[0.05]"
              )}>
                {/* Icon — domain-colored when active */}
                <group.icon className={cn("w-3.5 h-3.5 flex-shrink-0 mt-0.5 transition-colors", isActive ? domain.color : '')} />

                {/* Label + optional description */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[12px] font-medium whitespace-nowrap leading-tight">{group.label}</span>
                    {badgeCount > 0 && (
                      <span className="text-[9px] font-bold tabular-nums px-1.5 py-px rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/25 leading-none flex-shrink-0">
                        {badgeCount}
                      </span>
                    )}
                  </div>
                  {group.desc && (
                    <div className="text-[10px] text-muted-foreground/40 leading-tight mt-0.5 pr-1 truncate">
                      {group.desc}
                    </div>
                  )}
                </div>

                <ChevronRight className="w-3 h-3 opacity-35 flex-shrink-0 mt-0.5" />
              </div>

              {/* ── L3 submenu ── */}
              {isActive && (
                <div
                  className={cn(
                    "absolute top-0 py-1.5 min-w-[240px]",
                    openLeft ? "right-full mr-1" : "left-full ml-1"
                  )}
                  style={panelStyle}
                  onMouseEnter={stayGroup}
                  onMouseLeave={leaveGroup}
                >
                  {/* Group header */}
                  <div className="px-3.5 pt-1 pb-2 mb-0.5 border-b border-white/[0.05]">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className={cn("text-[9px] font-bold uppercase tracking-widest", domain.color)}>
                        {group.label}
                      </span>
                      {badgeCount > 0 && (
                        <span className="text-[9px] font-bold tabular-nums px-1.5 py-px rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/25 leading-none">
                          {badgeCount}
                        </span>
                      )}
                    </div>
                    {group.desc && (
                      <div className="text-[10px] text-muted-foreground/40 leading-tight">
                        {group.desc}
                      </div>
                    )}
                  </div>

                  {/* Items */}
                  {group.items.map(item => (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onClose}
                      data-testid={`nav-module-${item.href.replace(/\//g, '-')}`}
                    >
                      <div className="flex items-center gap-2.5 px-2 py-1.5 mx-1 rounded-lg hover:bg-white/[0.07] transition-colors cursor-pointer group">
                        <div className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 bg-white/[0.04] group-hover:bg-white/[0.09] transition-colors">
                          <item.icon className={cn("w-3.5 h-3.5", domain.color)} />
                        </div>
                        <div className="min-w-0">
                          <div className="text-[12px] font-medium text-foreground leading-tight">{item.label}</div>
                          <div className="text-[10px] text-muted-foreground/50 leading-tight mt-px truncate">{item.desc}</div>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function AppNavShell() {
  const [location, navigate]  = useLocation();
  const search                = useSearch();
  const [openDomain, setOpen]             = useState<string | null>(null);
  const [hiddenDomains, setHiddenDomains] = useState<Set<string>>(() => {
    try { const s = localStorage.getItem(NAV_HIDDEN_KEY); return s ? new Set<string>(JSON.parse(s)) : new Set<string>(); } catch { return new Set<string>(); }
  });
  const [showNavConfig, setShowNavConfig] = useState(false);
  const closeTimer                        = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shellRef                          = useRef<HTMLDivElement | null>(null);
  const tabRefs                           = useRef<Map<string, HTMLDivElement>>(new Map());
  const navConfigRef                      = useRef<HTMLDivElement | null>(null);
  const { user, logout, role } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const compact   = new URLSearchParams(search).get('compact') === '1';
  const wallboard = typeof document !== 'undefined' && document.body.dataset.wallboard === '1';

  const { data: incidentsRaw } = useQuery<any[]>({
    queryKey: ['/api/ai/incidents'],
    refetchInterval: 60_000,
    staleTime: 30_000,
    enabled: !!user && role !== 'viewer' && !compact && !wallboard,
  });
  const { data: pendingCountData } = useQuery<{ count: number }>({
    queryKey: ['/api/approvals/pending-count'],
    refetchInterval: 30_000,
    staleTime: 15_000,
    enabled: !!user && (role === 'admin' || role === 'management' || role === 'super_admin' || role === 'team_lead') && !compact && !wallboard,
  });
  const { data: liveCallsRaw } = useQuery<any>({
    queryKey: ['/api/sippy/live-calls'],
    refetchInterval: 60_000,
    staleTime: 30_000,
    enabled: !!user && role !== 'viewer' && !compact && !wallboard,
  });
  const { data: carrierScoresRaw } = useQuery<any[]>({
    queryKey: ['/api/carrier-scores'],
    refetchInterval: 120_000,
    staleTime: 60_000,
    enabled: !!user && role !== 'viewer' && !compact && !wallboard,
  });
  const { data: sidebarVisData } = useQuery<{ hiddenItems: string[] }>({
    queryKey: ['/api/settings/sidebar-visibility'],
    staleTime: 60_000,
    enabled: !!user,
  });
  const hiddenItemsSet = new Set<string>(sidebarVisData?.hiddenItems ?? []);

  const activeIncidents  = Array.isArray(incidentsRaw) ? incidentsRaw.filter((i: any) => i.status === 'active' || !i.resolvedAt).length : 0;
  const pendingApprovals = pendingCountData?.count ?? 0;
  const notifCount       = activeIncidents + pendingApprovals;
  const degradedCarriers = Array.isArray(carrierScoresRaw) ? carrierScoresRaw.filter((c: any) => (c.stabilityScore ?? 100) < 55).length : 0;
  const liveCallCount    = Array.isArray(liveCallsRaw) ? liveCallsRaw.length : (liveCallsRaw?.calls?.length ?? liveCallsRaw?.count ?? 0);

  // ── Per-domain urgency scores derived from available signals ─────────────
  function domainUrgencyScore(domainId: string): number {
    const raw: Record<string, number> = {
      'live-ops':     activeIncidents * 15,
      'vendors':      degradedCarriers * 20,
      'security':     activeIncidents * 20 + pendingApprovals * 10,
      'intelligence': activeIncidents * 10 + degradedCarriers * 8,
      'finance':      pendingApprovals * 12,
      'clients':      pendingApprovals * 7,
      'analytics':    degradedCarriers * 4,
      'settings':     0,
    };
    return Math.min(100, raw[domainId] ?? 0);
  }

  if (compact || wallboard) return null;
  // Only internal/admin roles see the full top navigation.
  // Viewer, KAM, and Client Portal users get a clean restricted interface.
  const INTERNAL_ROLES = new Set(['super_admin', 'admin', 'management', 'noc_operator', 'team_lead']);
  if (!role || !INTERNAL_ROLES.has(role)) return null;

  const { isOpen: chatOpen, toggle: toggleChat } = useChatDrawer();

  const { isPortalMode, allowedPortals, activePortal: activePortalSlug, setPortal, exitPortalMode, portalConfig } = usePortal();
  const [showPortalDrop, setShowPortalDrop] = useState(false);

  // ── Workspace data for portal-mode second row ────────────────────────────────
  const { data: allWorkspaces = [] } = useQuery<WorkspaceDefinition[]>({
    queryKey: ['/api/workspaces'],
    staleTime: 5 * 60_000,
    enabled: !!user && isPortalMode,
  });
  const portalWorkspaces = (allWorkspaces as WorkspaceDefinition[])
    .filter(w => w.portalSlug === activePortalSlug && w.isActive)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  const WORKSPACE_DEFAULT_ROUTE: Record<string, string> = {
    'billing-ops':        '/billing',
    'revenue-assurance':  '/dmr',
    'dispute-governance': '/billing-disputes',
    'noc-ops':            '/noc-dashboard',
    'analytics-hub':      '/analytics',
  };
  const WORKSPACE_ROUTES: Record<string, string[]> = {
    'billing-ops':        ['/billing', '/invoices', '/invoice-jobs', '/invoice-templates', '/credit-notes', '/credit-control', '/products', '/rate-cards', '/tariff-versions', '/unbilled-usage', '/account-statement', '/invoice-schedules', '/payment-reminders'],
    'revenue-assurance':  ['/dmr', '/client-reconciliation', '/carrier-reconciliation', '/ai-assurance', '/margin-intelligence', '/traffic-forecast', '/revenue-heatmap'],
    'dispute-governance': ['/billing-disputes', '/dispute-cases', '/dispute-defense', '/commercial-notifications'],
    'noc-ops':            ['/calls', '/live-traffic', '/noc-dashboard', '/noc-incidents', '/alerts', '/server-monitoring', '/noc-command', '/sip-trace'],
    'analytics-hub':      ['/analytics', '/traffic-forecast', '/asr-acd', '/qos-heatmap', '/codec-analytics', '/revenue-heatmap', '/reports', '/executive-reports', '/cdrs'],
  };
  function isWsActive(wsSlug: string): boolean {
    return (WORKSPACE_ROUTES[wsSlug] ?? []).some(r =>
      location === r || location.startsWith(r + '/') || location.startsWith(r + '?')
    );
  }
  const meta          = inferMeta(location);
  const activeDomain  = DOMAINS.find(d => d.id === meta.domain);
  const isDashboard   = location === '/';
  const isChat        = location.startsWith('/chat');

  const scheduleClose = useCallback(() => {
    closeTimer.current = setTimeout(() => setOpen(null), 180);
  }, []);
  const cancelClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    try { localStorage.setItem(NAV_HIDDEN_KEY, JSON.stringify([...hiddenDomains])); } catch {}
  }, [hiddenDomains]);

  useEffect(() => {
    if (!showNavConfig) return;
    function handler(e: MouseEvent) {
      if (navConfigRef.current && !navConfigRef.current.contains(e.target as Node)) setShowNavConfig(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showNavConfig]);

  function toggleDomainVisibility(id: string) {
    setHiddenDomains(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  const visibleDomains = DOMAINS.filter(d => !hiddenDomains.has(d.id));

  const userInitial = user?.firstName?.[0] || user?.email?.[0]?.toUpperCase() || 'U';
  const userName    = user?.firstName || user?.email || '';

  return (
    <div ref={shellRef} className="relative z-50 flex-shrink-0">
      <div
        className="flex items-center h-[44px] px-4 border-b gap-2"
        style={{
          background: 'hsl(var(--background)/0.92)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderColor: 'rgba(255,255,255,0.06)',
        }}
      >
        {/* ── Left zone: Logo + global utilities ── */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Logo mark */}
          <Link href="/" className="flex items-center gap-2 mr-2 flex-shrink-0 group">
            <div className="bg-indigo-600/25 p-1 rounded-md border border-indigo-500/20 group-hover:bg-indigo-600/35 transition-colors">
              <Activity className="w-3.5 h-3.5 text-indigo-400" />
            </div>
            <span className="text-[11px] font-bold tracking-widest text-foreground/80 uppercase hidden sm:inline">Bitsauto</span>
          </Link>

          {/* Divider */}
          <div className="w-px h-5 bg-white/[0.08] mr-1 flex-shrink-0" />

          {/* Dashboard */}
          <Link
            href="/"
            data-testid="nav-dashboard"
            className={cn(
              "flex items-center gap-1.5 h-[30px] px-2.5 rounded-md text-[11px] font-semibold transition-all duration-150 whitespace-nowrap flex-shrink-0",
              isDashboard
                ? "text-foreground bg-white/[0.08]"
                : "text-muted-foreground/65 hover:text-foreground hover:bg-white/[0.05]"
            )}
          >
            <LayoutDashboard className={cn("w-3.5 h-3.5", isDashboard ? "text-indigo-400" : "")} />
            <span className="hidden md:inline">Dashboard</span>
          </Link>

          {/* Team Chat — opens floating drawer */}
          <button
            onClick={toggleChat}
            data-testid="nav-team-chat"
            className={cn(
              "relative flex items-center gap-1.5 h-[30px] px-2.5 rounded-md text-[11px] font-semibold transition-all duration-150 whitespace-nowrap flex-shrink-0",
              chatOpen || isChat
                ? "text-foreground bg-white/[0.08]"
                : "text-muted-foreground/65 hover:text-foreground hover:bg-white/[0.05]"
            )}
          >
            <MessageSquare className={cn("w-3.5 h-3.5", chatOpen || isChat ? "text-emerald-400" : "")} />
            <span className="hidden md:inline">Chat</span>
            {activeIncidents > 0 && !chatOpen && !isChat && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] flex items-center justify-center text-[9px] font-bold bg-rose-500 text-white rounded-full px-0.5 leading-none">
                {activeIncidents > 9 ? '9+' : activeIncidents}
              </span>
            )}
          </button>

          {/* Live call count chip */}
          {liveCallCount > 0 && role !== 'viewer' && (
            <Link
              href="/calls"
              data-testid="nav-live-calls-chip"
              className="flex items-center gap-1 h-[22px] px-2 rounded-full bg-emerald-500/15 border border-emerald-500/25 text-emerald-400 text-[10px] font-bold hover:bg-emerald-500/25 transition-colors flex-shrink-0"
            >
              <span className="relative flex h-1.5 w-1.5 flex-shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
              </span>
              {liveCallCount}
            </Link>
          )}
        </div>

        {/* ── Divider ── */}
        <div className="w-px h-5 bg-white/[0.08] mx-1 flex-shrink-0" />

        {/* ── Domain mega-menu tabs — always visible ─────────────────────────── */}
        <nav className="flex items-center gap-0.5 flex-1 min-w-0 overflow-x-auto [&::-webkit-scrollbar]:hidden" role="menubar">
            {visibleDomains.map(domain => {
              const isActive = meta.domain === domain.id;
              const isOpen   = openDomain === domain.id;
              return (
                <div
                  key={domain.id}
                  ref={el => { if (el) tabRefs.current.set(domain.id, el); }}
                  role="menuitem"
                  className={cn(
                    "relative flex items-center h-[36px] rounded-lg text-[11px] font-semibold transition-all duration-150 whitespace-nowrap flex-shrink-0",
                    isActive || isOpen
                      ? "text-foreground bg-white/[0.08]"
                      : "text-muted-foreground/60 hover:text-foreground hover:bg-white/[0.05]"
                  )}
                  onMouseEnter={() => { cancelClose(); setOpen(domain.id); }}
                  onMouseLeave={scheduleClose}
                >
                  {isActive && (
                    <span className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full bg-gradient-to-r from-violet-400 to-indigo-500 pointer-events-none" />
                  )}
                  <Link
                    href={`/workspace/${domain.id}`}
                    data-testid={`nav-domain-${domain.id}`}
                    onClick={() => setOpen(null)}
                    className="flex items-center gap-1.5 pl-2.5 pr-1 h-full"
                    aria-label={`${domain.label} workspace`}
                  >
                    {(() => {
                      const urgency = domainUrgencyScore(domain.id);
                      return (
                        <span className="relative flex-shrink-0 inline-flex">
                          <domain.icon className={cn("w-3.5 h-3.5", isActive ? domain.color : '')} />
                          {urgency >= 60 && (
                            <span className="absolute -top-[3px] -right-[3px] flex h-[6px] w-[6px] pointer-events-none" aria-hidden="true">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-70" />
                              <span className="relative inline-flex rounded-full h-[6px] w-[6px] bg-rose-500" />
                            </span>
                          )}
                          {urgency >= 30 && urgency < 60 && (
                            <span className="absolute -top-[3px] -right-[3px] h-[5px] w-[5px] rounded-full bg-amber-400 pointer-events-none" aria-hidden="true" />
                          )}
                        </span>
                      );
                    })()}
                    <span className="hidden lg:inline">{domain.label}</span>
                  </Link>
                  <button
                    onClick={(e) => { e.stopPropagation(); setOpen(openDomain === domain.id ? null : domain.id); }}
                    aria-haspopup="true"
                    aria-expanded={isOpen}
                    aria-label={`${domain.label} modules`}
                    className={cn(
                      "flex items-center justify-center pr-2 pl-0.5 h-full transition-all duration-150",
                      isOpen ? "opacity-100" : "opacity-40 hover:opacity-80"
                    )}
                  >
                    <ChevronDown className={cn("w-2.5 h-2.5 transition-transform duration-150", isOpen && "rotate-180")} />
                  </button>
                </div>
              );
            })}
          </nav>

        {/* ── Favorites strip — sits between centre nav and right zone ── */}
        <div className="hidden xl:flex items-center mx-2 flex-shrink-0 overflow-hidden">
          <FavoritesStrip />
        </div>

        {/* ── Right zone: global utilities ── */}
        <div className="flex items-center gap-1 ml-auto flex-shrink-0">
          {/* Breadcrumb — only on wide screens, only in standard mode */}
          {!isPortalMode && activeDomain && (
            <div className="hidden xl:flex items-center gap-1 text-[10px] text-muted-foreground/40 mr-2">
              <span className={cn("font-semibold", activeDomain.color)}>{activeDomain.label}</span>
              <ChevronRight className="w-3 h-3" />
              <span className="text-muted-foreground/60">{meta.label}</span>
            </div>
          )}

          {/* Nav config toggle — only in standard mode */}
          {!isPortalMode && (
            <div className="relative" ref={navConfigRef}>
              <button
                onClick={() => setShowNavConfig(v => !v)}
                data-testid="nav-config-toggle"
                title="Customise navigation sections"
                className={cn(
                  "p-1.5 rounded-lg transition-colors",
                  showNavConfig
                    ? "bg-white/[0.07] text-foreground/80"
                    : "text-muted-foreground/40 hover:text-foreground hover:bg-white/[0.06]"
                )}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
              </button>
              {showNavConfig && (
                <div
                  className="absolute right-0 top-full mt-1.5 z-[200] py-2 rounded-xl"
                  style={{
                    background: 'hsl(var(--background)/0.98)',
                    backdropFilter: 'blur(20px)',
                    WebkitBackdropFilter: 'blur(20px)',
                    border: '1px solid rgba(255,255,255,0.07)',
                    boxShadow: '0 16px 48px rgba(0,0,0,0.45)',
                    minWidth: 230,
                  }}
                >
                  <div className="px-3.5 pb-2 mb-1 border-b border-white/[0.06]">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/40">Top Nav Sections</p>
                    <p className="text-[10px] text-muted-foreground/30 mt-0.5">Toggle sections on or off</p>
                  </div>
                  {DOMAINS.map(d => {
                    const on = !hiddenDomains.has(d.id);
                    return (
                      <button
                        key={d.id}
                        onClick={() => toggleDomainVisibility(d.id)}
                        data-testid={`nav-toggle-domain-${d.id}`}
                        className="w-full flex items-center gap-2.5 px-3.5 py-1.5 hover:bg-white/[0.05] transition-colors text-left"
                      >
                        <d.icon className={cn("w-3.5 h-3.5 flex-shrink-0 transition-colors", on ? d.color : 'text-muted-foreground/20')} />
                        <span className={cn("text-[12px] font-medium flex-1 transition-colors", on ? 'text-foreground' : 'text-muted-foreground/30')}>{d.label}</span>
                        <div className={cn("w-8 h-4 rounded-full transition-colors duration-200 relative flex-shrink-0", on ? "bg-indigo-500" : "bg-white/[0.1]")}>
                          <div className={cn("absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-all duration-200", on ? "left-[18px]" : "left-0.5")} />
                        </div>
                      </button>
                    );
                  })}
                  {hiddenDomains.size > 0 && (
                    <div className="px-3.5 pt-2 mt-1 border-t border-white/[0.06]">
                      <button
                        onClick={() => setHiddenDomains(new Set())}
                        className="text-[11px] text-indigo-400 hover:text-indigo-300 font-medium transition-colors"
                      >
                        Show all sections
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Portals dropdown — context switcher in right zone */}
          {allowedPortals.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setShowPortalDrop(v => !v)}
                data-testid="nav-portals-switcher"
                className={cn(
                  "flex items-center gap-1 h-[26px] px-2.5 rounded-md border text-[11px] font-medium transition-colors",
                  isPortalMode
                    ? "border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20"
                    : "border-white/[0.1] text-muted-foreground/50 hover:text-foreground hover:border-white/[0.2] hover:bg-white/[0.04]"
                )}
              >
                <span>{isPortalMode ? (portalConfig?.name ?? 'Portal') : 'Portals'}</span>
                <ChevronDown className="w-2.5 h-2.5" />
              </button>
              {showPortalDrop && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowPortalDrop(false)} />
                  <div
                    className="absolute right-0 top-full mt-1.5 z-50 w-48 rounded-xl shadow-2xl overflow-hidden border border-border/60"
                    style={{ background: 'hsl(var(--background)/0.98)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}
                  >
                    <div className="px-3 py-2 border-b border-border/40">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">Switch Workspace</p>
                    </div>
                    <div className="py-1">
                      {allowedPortals.map(p => (
                        <button
                          key={p.slug}
                          onClick={() => {
                            if (activePortalSlug === p.slug) exitPortalMode();
                            else { setPortal(p.slug as any); navigate((p as any).defaultRoute ?? '/'); }
                            setShowPortalDrop(false);
                          }}
                          data-testid={`nav-portal-${p.slug}`}
                          className={cn(
                            "w-full flex items-center justify-between px-3 py-1.5 text-[12px] transition-colors hover:bg-white/[0.05]",
                            p.slug === activePortalSlug ? "font-semibold text-indigo-400" : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          <span>{p.name}</span>
                          {p.slug === activePortalSlug && <span className="text-[10px] opacity-50">active</span>}
                        </button>
                      ))}
                    </div>
                    {isPortalMode && (
                      <div className="border-t border-border/40 py-1">
                        <button
                          onClick={() => { exitPortalMode(); setShowPortalDrop(false); }}
                          className="w-full px-3 py-1.5 text-[12px] text-left text-muted-foreground hover:text-foreground hover:bg-white/[0.05] transition-colors"
                          data-testid="nav-exit-portal"
                        >
                          ← Full Platform
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ⌘K search chip */}
          <button
            onClick={openCommandBar}
            data-testid="nav-command-search"
            className={cn(
              "hidden sm:flex items-center gap-1.5 h-[26px] px-2 rounded-md border text-[10px] font-medium transition-colors",
              "border-white/[0.1] text-muted-foreground/50 hover:text-muted-foreground hover:border-white/[0.2] hover:bg-white/[0.04]"
            )}
            aria-label="Open command search"
          >
            <Search className="w-3 h-3" />
            <span className="hidden md:inline">Search</span>
            <kbd className="ml-0.5 text-[9px] opacity-60 font-mono hidden md:inline">⌘K</kbd>
          </button>

          {/* Notifications */}
          <Link
            href="/notification-centre"
            data-testid="nav-notifications"
            className="relative p-1.5 rounded-lg text-muted-foreground/60 hover:text-foreground hover:bg-white/[0.06] transition-colors"
            title="Notifications"
          >
            <Bell className="w-4 h-4" />
            {notifCount > 0 && (
              <span className="absolute top-0.5 right-0.5 min-w-[14px] h-[14px] flex items-center justify-center text-[9px] font-bold bg-rose-500 text-white rounded-full px-0.5 leading-none">
                {notifCount > 9 ? '9+' : notifCount}
              </span>
            )}
          </Link>

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            data-testid="nav-theme-toggle"
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className="p-1.5 rounded-lg text-muted-foreground/60 hover:text-foreground hover:bg-white/[0.06] transition-colors"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          {/* User avatar + name */}
          {user && (
            <Link
              href="/account"
              data-testid="nav-user-account"
              className="flex items-center gap-1.5 h-[30px] px-2 rounded-lg text-muted-foreground/70 hover:text-foreground hover:bg-white/[0.06] transition-colors"
              title={`${userName} — My Account`}
            >
              <div className="h-5 w-5 rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-400 font-bold text-[10px] flex-shrink-0">
                {userInitial}
              </div>
              <span className="hidden lg:inline text-[11px] font-medium truncate max-w-[80px]">{userName}</span>
            </Link>
          )}

          {/* Logout */}
          <button
            onClick={() => logout()}
            data-testid="nav-logout"
            title="Sign out"
            className="p-1.5 rounded-lg text-muted-foreground/40 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ── ROW 2: Workspace navigation — visible when portal is active ──── */}
      {isPortalMode && portalWorkspaces.length > 0 && (
        <div
          className="flex items-center h-[36px] px-6 gap-0.5 border-b"
          style={{
            background:           'hsl(var(--background)/0.88)',
            backdropFilter:       'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            borderColor:          'rgba(255,255,255,0.05)',
          }}
        >
          {portalWorkspaces.map(ws => {
            const active = isWsActive(ws.slug);
            const t      = portalConfig?.theme ?? 'neutral';
            return (
              <Link
                key={ws.slug}
                href={WORKSPACE_DEFAULT_ROUTE[ws.slug] ?? '/'}
                data-testid={`nav-workspace-${ws.slug}`}
                className={cn(
                  "relative flex items-center h-[34px] px-3 rounded-lg text-[11px] font-semibold transition-all duration-150 whitespace-nowrap flex-shrink-0",
                  active
                    ? "text-foreground bg-white/[0.07]"
                    : "text-muted-foreground/60 hover:text-foreground hover:bg-white/[0.05]"
                )}
              >
                {active && (
                  <span className={cn(
                    "absolute bottom-0 left-2 right-2 h-[2px] rounded-full pointer-events-none",
                    PORTAL_UNDERLINE[t] ?? PORTAL_UNDERLINE.neutral
                  )} />
                )}
                {ws.label}
              </Link>
            );
          })}
        </div>
      )}

      {/* ── Cascade menu — positioned below the hovered tab ── */}
      {openDomain && (() => {
        const tabEl   = tabRefs.current.get(openDomain);
        const shellEl = shellRef.current;
        const domain  = DOMAINS.find(d => d.id === openDomain);
        if (!domain) return null;

        // Compute left offset relative to shell
        let leftPos = 0;
        let openLeft = false;
        if (tabEl && shellEl) {
          const tabRect   = tabEl.getBoundingClientRect();
          const shellRect = shellEl.getBoundingClientRect();
          leftPos = tabRect.left - shellRect.left;
          // If near right edge, flip L3 submenu to open leftward
          openLeft = (tabRect.left + 450) > window.innerWidth;
        }

        return (
          <div
            key={openDomain}
            style={{ position: 'absolute', top: 44, left: leftPos, zIndex: 100 }}
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
          >
            <CascadeMenu
              domain={domain}
              onClose={() => setOpen(null)}
              openLeft={openLeft}
              stats={{ activeIncidents, pendingApprovals, degradedCarriers }}
              hiddenItems={hiddenItemsSet}
            />
          </div>
        );
      })()}
    </div>
  );
}
