import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import {
  Radio, Users, Wifi, GitBranch, BarChart2,
  Brain, Wrench, ShieldAlert, Settings,
  Phone, Bell, Monitor, Layers, Zap,
  Server, Activity, Globe, Wallet, PhoneIncoming,
  BarChart3, Eye, ScanSearch, Calculator,
  ArrowRightLeft, HeartPulse, TrendingDown,
  FileText, FlaskConical, Network, Rewind, PhoneCall,
  Shield, Lock, ClipboardList, Mic,
  Key, Mail, Building2, SlidersHorizontal,
  Bot, FileSpreadsheet, LineChart, TrendingUp,
  ChevronRight, AlertTriangle, CheckCircle2,
  HardDrive, Database, Star, Banknote, Map, Package, History,
  Search,
} from "lucide-react";
import type { WorkspaceDomain } from "@/lib/workspace";
import { WORKSPACE_LABELS, WORKSPACE_TEXT_COLOR, WORKSPACE_DOT_BG } from "@/lib/workspace";

// ── Per-workspace static config ───────────────────────────────────────────────

interface QuickLink {
  href:  string;
  label: string;
  desc:  string;
  icon:  React.ComponentType<{ className?: string }>;
  color: string;
}

interface WorkspaceConfig {
  description: string;
  headerIcon:  React.ComponentType<{ className?: string }>;
  quickLinks:  QuickLink[];
}

const WS_CONFIG: Record<WorkspaceDomain, WorkspaceConfig> = {
  'live-ops': {
    description: 'Real-time call monitoring, network health, and NOC operations centre',
    headerIcon: Radio,
    quickLinks: [
      { href: '/calls',            label: 'Live Calls',    desc: 'Active call stream',       icon: Phone,    color: 'text-violet-400' },
      { href: '/alerts',           label: 'Alerts',        desc: 'Platform alerts',           icon: Bell,     color: 'text-rose-400'   },
      { href: '/noc-command',      label: 'NOC Command',   desc: 'Operator command centre',   icon: Monitor,  color: 'text-cyan-400'   },
      { href: '/multi-switch',     label: 'Multi-Switch',  desc: 'Consolidated switch view',  icon: Layers,   color: 'text-amber-400'  },
      { href: '/console',          label: 'Console',       desc: 'Unified console',           icon: Database, color: 'text-emerald-400'},
      { href: '/sbc-monitor',      label: 'SBC Monitor',   desc: 'Session border controller', icon: HardDrive,color: 'text-blue-400'   },
      { href: '/traffic-map',      label: 'Traffic Map',   desc: 'Geographic call view',      icon: Globe,    color: 'text-indigo-400' },
      { href: '/server-monitoring',label: 'Infra Health',  desc: 'Server & infra monitoring', icon: Server,   color: 'text-orange-400' },
    ],
  },
  'clients': {
    description: 'Account management, billing, DID inventory, and client portal',
    headerIcon: Users,
    quickLinks: [
      { href: '/clients',          label: 'Accounts',      desc: 'All client accounts',       icon: Users,        color: 'text-amber-400'  },
      { href: '/client-portal',    label: 'Client Portal', desc: 'Self-service portal',       icon: Globe,        color: 'text-cyan-400'   },
      { href: '/dids',             label: 'DIDs',          desc: 'Number inventory',          icon: PhoneIncoming,color: 'text-violet-400' },
      { href: '/billing',          label: 'Billing',       desc: 'Payments & invoices',       icon: Wallet,       color: 'text-emerald-400'},
      { href: '/billing-disputes', label: 'Disputes',      desc: 'Dispute resolution',        icon: FileText,     color: 'text-rose-400'   },
      { href: '/client/wizard',    label: 'New Account',   desc: 'Create a client account',   icon: Users,        color: 'text-blue-400'   },
      { href: '/balance',          label: 'Balances',      desc: 'Account balance monitor',   icon: Wallet,       color: 'text-orange-400' },
      { href: '/reseller',         label: 'Resellers',     desc: 'Partner management',        icon: Star,         color: 'text-indigo-400' },
    ],
  },
  'vendors': {
    description: 'Carrier management, quality scoring, rate cards, and balance monitoring',
    headerIcon: Wifi,
    quickLinks: [],
  },
  'analytics': {
    description: 'Traffic analytics, revenue reporting, CDR viewer, quality heatmaps, and forecasting',
    headerIcon: BarChart2,
    quickLinks: [
      { href: '/analytics',        label: 'Traffic Analytics', desc: 'Call traffic analytics',   icon: LineChart,    color: 'text-blue-400'   },
      { href: '/asr-acd',          label: 'ASR / ACD',         desc: 'Quality KPI reports',      icon: BarChart3,    color: 'text-emerald-400'},
      { href: '/revenue-heatmap',  label: 'Revenue Heatmap',   desc: 'Revenue analysis map',     icon: Map,          color: 'text-rose-400'   },
      { href: '/reports',          label: 'Reports',           desc: 'Standard report centre',   icon: BarChart2,    color: 'text-violet-400' },
      { href: '/cdrs',             label: 'CDR Viewer',        desc: 'Call detail records',      icon: History,      color: 'text-cyan-400'   },
      { href: '/bitseye',          label: 'BitsEye',           desc: 'Drill-down analytics',     icon: Eye,          color: 'text-amber-400'  },
      { href: '/traffic-forecast', label: 'Forecast',          desc: 'Demand forecasting',       icon: TrendingDown, color: 'text-blue-400'   },
      { href: '/qos-heatmap',      label: 'QoS Heatmap',       desc: 'Quality of service map',   icon: Activity,     color: 'text-indigo-400' },
    ],
  },
  'intelligence': {
    description: 'Correlated signals, anomaly detection, carrier health, and AI-powered insights',
    headerIcon: Brain,
    quickLinks: [],
  },
  'security': {
    description: 'FAS/IRSF detection, firewall, compliance, approvals, and audit trail',
    headerIcon: ShieldAlert,
    quickLinks: [
      { href: '/fraud',                label: 'Fraud Engine',  desc: 'FAS/IRSF detection',       icon: ShieldAlert,  color: 'text-rose-400'   },
      { href: '/firewall',             label: 'Firewall',      desc: 'Auto-blacklist rules',      icon: Shield,       color: 'text-orange-400' },
      { href: '/approvals',            label: 'Approvals',     desc: 'Pending approval queue',    icon: CheckCircle2, color: 'text-emerald-400'},
      { href: '/audit-log',            label: 'Audit Log',     desc: 'Platform activity trail',   icon: ClipboardList,color: 'text-amber-400'  },
      { href: '/compliance',           label: 'Compliance',    desc: 'Regulatory compliance',     icon: FileText,     color: 'text-violet-400' },
      { href: '/stir-shaken',          label: 'STIR/SHAKEN',   desc: 'Attestation framework',     icon: Lock,         color: 'text-cyan-400'   },
      { href: '/call-recordings',      label: 'Recordings',    desc: 'Call recording archive',    icon: Mic,          color: 'text-blue-400'   },
      { href: '/vendor-sla-scorecard', label: 'SLA Management',desc: 'SLA breach tracking',       icon: HeartPulse,   color: 'text-indigo-400' },
    ],
  },
  'finance': {
    description: 'Billing, invoices, rate decks, cost optimisation, and revenue analytics',
    headerIcon: Banknote,
    quickLinks: [
      { href: '/billing',          label: 'Billing',           desc: 'Payments & invoices',      icon: Wallet,         color: 'text-emerald-400'},
      { href: '/billing-disputes', label: 'Disputes',          desc: 'Dispute resolution',        icon: FileText,       color: 'text-rose-400'   },
      { href: '/rate-cards',       label: 'Rate Cards',        desc: 'Rate decks & pricing',      icon: FileSpreadsheet,color: 'text-blue-400'   },
      { href: '/products',         label: 'Products',          desc: 'Product catalogue',         icon: Package,        color: 'text-violet-400' },
      { href: '/cost-optimisation',label: 'Cost Optimisation', desc: 'Route cost engine',         icon: TrendingDown,   color: 'text-cyan-400'   },
      { href: '/revenue-heatmap',  label: 'Revenue Heatmap',   desc: 'Revenue visualisation',     icon: Map,            color: 'text-amber-400'  },
      { href: '/balance',          label: 'Balance Monitor',   desc: 'Vendor account balances',   icon: Wallet,         color: 'text-orange-400' },
      { href: '/reports',          label: 'Finance Reports',   desc: 'Revenue & cost reports',    icon: BarChart2,      color: 'text-indigo-400' },
    ],
  },
  'settings': {
    description: 'Platform configuration, team management, API keys, and system preferences',
    headerIcon: Settings,
    quickLinks: [
      { href: '/settings',          label: 'Platform Settings', desc: 'System configuration',   icon: Settings,         color: 'text-slate-400'  },
      { href: '/team',              label: 'Team & KAM',        desc: 'Roles & access control', icon: Users,            color: 'text-violet-400' },
      { href: '/api-keys',          label: 'API Keys',          desc: 'API key management',     icon: Key,              color: 'text-amber-400'  },
      { href: '/email-centre',      label: 'Email Centre',      desc: 'Notification config',    icon: Mail,             color: 'text-cyan-400'   },
      { href: '/approval-settings', label: 'Approval Rules',    desc: 'Approval configuration', icon: SlidersHorizontal,color: 'text-emerald-400'},
      { href: '/whatsapp-alerts',   label: 'WhatsApp Alerts',   desc: 'Alert delivery config',  icon: Bell,             color: 'text-rose-400'   },
      { href: '/vpn-config',        label: 'VPN Config',        desc: 'VPN configuration',      icon: Lock,             color: 'text-blue-400'   },
      { href: '/sidebar-settings',  label: 'Sidebar Menu',      desc: 'Navigation preferences', icon: SlidersHorizontal,color: 'text-indigo-400' },
    ],
  },
};

// ── Operational card config (Vendors + Intelligence only) ─────────────────────
// tier: 'primary' → full-width 2-col card; 'secondary' → 3-col compact card
interface OpsCard {
  tier:       'primary' | 'secondary';
  href:       string;
  label:      string;
  desc:       string;
  icon:       React.ComponentType<{ className?: string }>;
  accentColor: string;   // Tailwind border-color class
  iconColor:   string;   // Tailwind text-color class
  statKey?:    'degradedCarriers' | 'activeIncidents' | 'pendingApprovals' | 'lowBalances' | 'healthyCarriers' | 'activeCalls' | 'activeAlerts';
  statLabel?:  string;   // suffix: "degraded", "active", etc.
  statCritical?: boolean; // if true and stat > 0, badge is amber/rose; else always shown
}

const VENDORS_CARDS: OpsCard[] = [
  // Primary tier — decision-critical tools
  { tier: 'primary', href: '/vendor-rca',                  label: 'Vendor RCA',              desc: 'Root cause analysis for carrier degradation events',           icon: ScanSearch,     accentColor: 'border-rose-500',    iconColor: 'text-rose-400',    statKey: 'degradedCarriers',   statLabel: 'degraded',    statCritical: true  },
  { tier: 'primary', href: '/vendor-prefix-intelligence',  label: 'Prefix Intelligence',     desc: 'Prefix-level quality trends, anomaly detection and signals',    icon: Globe,          accentColor: 'border-violet-500',  iconColor: 'text-violet-400' },
  { tier: 'primary', href: '/routing-intelligence',        label: 'Routing Intelligence',    desc: 'AI-powered routing recommendations and decision overlay',       icon: Brain,          accentColor: 'border-fuchsia-500', iconColor: 'text-fuchsia-400', statKey: 'activeIncidents', statLabel: 'signals',  statCritical: true  },
  { tier: 'primary', href: '/vendor-stability-timeline',   label: 'Stability Timeline',      desc: 'Vendor health history, stability scores and trend analysis',    icon: Activity,       accentColor: 'border-cyan-500',    iconColor: 'text-cyan-400',    statKey: 'degradedCarriers',   statLabel: 'unstable',    statCritical: true  },
  // Secondary tier — supporting operational tools
  { tier: 'secondary', href: '/carrier-scoring',           label: 'Carrier Scoring',         desc: 'Quality benchmarks',   icon: BarChart3,     accentColor: 'border-amber-500',   iconColor: 'text-amber-400' },
  { tier: 'secondary', href: '/routing-manager',           label: 'Routing Manager',         desc: 'Groups & connections', icon: GitBranch,     accentColor: 'border-cyan-500',    iconColor: 'text-cyan-400'  },
  { tier: 'secondary', href: '/cost-optimisation',         label: 'Cost Optimisation',       desc: 'Route cost engine',    icon: TrendingDown,  accentColor: 'border-emerald-500', iconColor: 'text-emerald-400' },
  { tier: 'secondary', href: '/lcr-analyser',              label: 'LCR Analyser',            desc: 'Least cost routing',   icon: Calculator,    accentColor: 'border-blue-500',    iconColor: 'text-blue-400'  },
  { tier: 'secondary', href: '/balance',                   label: 'Balance Monitor',         desc: 'Vendor balances',      icon: Wallet,        accentColor: 'border-orange-500',  iconColor: 'text-orange-400', statKey: 'lowBalances', statLabel: 'low', statCritical: true },
  { tier: 'secondary', href: '/vendors',                   label: 'Vendor List',             desc: 'All carriers',         icon: Wifi,          accentColor: 'border-cyan-400',    iconColor: 'text-cyan-400'  },
  { tier: 'secondary', href: '/rate-cards',                label: 'Rate Cards',              desc: 'Pricing management',   icon: FileSpreadsheet,accentColor: 'border-slate-500',  iconColor: 'text-slate-400' },
  { tier: 'secondary', href: '/call-flow-simulator',       label: 'Route Simulator',         desc: 'Simulate call flows',  icon: ArrowRightLeft,accentColor: 'border-indigo-500',  iconColor: 'text-indigo-400' },
];

const INTELLIGENCE_CARDS: OpsCard[] = [
  // Primary tier — decision surfaces
  { tier: 'primary', href: '/ai-ops',                     label: 'AI Ops Center',           desc: 'Anomaly detection, AI-assisted decisions and automated insights', icon: Bot,          accentColor: 'border-violet-500',  iconColor: 'text-violet-400',  statKey: 'activeIncidents', statLabel: 'anomalies', statCritical: true },
  { tier: 'primary', href: '/vendor-rca',                 label: 'Vendor RCA',              desc: 'Root cause drilldown for carrier degradation and instability',    icon: ScanSearch,   accentColor: 'border-rose-500',    iconColor: 'text-rose-400',    statKey: 'degradedCarriers', statLabel: 'degraded', statCritical: true },
  { tier: 'primary', href: '/intelligence',               label: 'Intelligence Hub',        desc: 'Correlated multi-source signals and cross-domain insights',       icon: Brain,        accentColor: 'border-fuchsia-500', iconColor: 'text-fuchsia-400' },
  { tier: 'primary', href: '/routing-intelligence',       label: 'Routing Intelligence',    desc: 'Intelligent route recommendations and AI steering decisions',      icon: GitBranch,    accentColor: 'border-cyan-500',    iconColor: 'text-cyan-400',    statKey: 'activeIncidents', statLabel: 'signals', statCritical: true },
  // Secondary tier
  { tier: 'secondary', href: '/intelligence-validation',  label: 'Validation Console',      desc: 'Data quality & trust',  icon: Shield,       accentColor: 'border-emerald-500', iconColor: 'text-emerald-400' },
  { tier: 'secondary', href: '/carrier-intelligence',     label: 'Carrier Intelligence',    desc: 'Market health signals', icon: Activity,     accentColor: 'border-amber-500',   iconColor: 'text-amber-400',  statKey: 'degradedCarriers', statLabel: 'degraded', statCritical: true },
  { tier: 'secondary', href: '/vendor-stability-timeline',label: 'Stability Engine',        desc: 'Vendor health trends',  icon: HeartPulse,   accentColor: 'border-blue-500',    iconColor: 'text-blue-400'  },
  { tier: 'secondary', href: '/vendor-prefix-intelligence',label: 'Prefix Intelligence',   desc: 'Prefix anomaly signals',icon: Globe,        accentColor: 'border-violet-500',  iconColor: 'text-violet-400' },
  { tier: 'secondary', href: '/carrier-scoring',          label: 'Carrier Scoring',         desc: 'Quality benchmarks',    icon: BarChart3,    accentColor: 'border-indigo-500',  iconColor: 'text-indigo-400', statKey: 'healthyCarriers', statLabel: 'healthy' },
  { tier: 'secondary', href: '/ai-ops?tab=decision-overlay',label: 'Decision Overlay',     desc: 'AI steering layer',     icon: Eye,          accentColor: 'border-fuchsia-500', iconColor: 'text-fuchsia-400' },
];

// ── Live stat resolver ─────────────────────────────────────────────────────────
function resolveStat(
  statKey: OpsCard['statKey'] | undefined,
  { degradedCarriers, activeIncidents, pendingApprovals, lowBalances, healthyCarriers, activeCalls, activeAlerts }: {
    degradedCarriers: number; activeIncidents: number; pendingApprovals: number;
    lowBalances: number; healthyCarriers: number; activeCalls: number; activeAlerts: number;
  }
): number {
  if (!statKey) return 0;
  if (statKey === 'degradedCarriers')  return degradedCarriers;
  if (statKey === 'activeIncidents')   return activeIncidents;
  if (statKey === 'pendingApprovals')  return pendingApprovals;
  if (statKey === 'lowBalances')       return lowBalances;
  if (statKey === 'healthyCarriers')   return healthyCarriers;
  if (statKey === 'activeCalls')       return activeCalls;
  if (statKey === 'activeAlerts')      return activeAlerts;
  return 0;
}

const LIVE_OPS_CARDS: OpsCard[] = [
  // Primary tier — highest-density operational surfaces
  { tier: 'primary', href: '/bitseye2',     label: 'BitsEye 2',    desc: 'Real-time call stream visualisation with per-carrier breakdown and anomaly overlay', icon: Eye,      accentColor: 'border-violet-500', iconColor: 'text-violet-400', statKey: 'activeCalls',    statLabel: 'live',  statCritical: false },
  { tier: 'primary', href: '/noc-command',  label: 'NOC Command',  desc: 'Operator command centre — incidents, escalations, live telemetry and NOC actions',    icon: Monitor,  accentColor: 'border-cyan-500',   iconColor: 'text-cyan-400',   statKey: 'activeIncidents', statLabel: 'open', statCritical: true  },
  // Secondary tier — supporting operational tools
  { tier: 'secondary', href: '/calls',             label: 'Live Calls',    desc: 'Active call stream',         icon: Phone,     accentColor: 'border-violet-500',  iconColor: 'text-violet-400', statKey: 'activeCalls',  statLabel: 'active', statCritical: false },
  { tier: 'secondary', href: '/alerts',            label: 'Alerts',        desc: 'Platform alert queue',       icon: Bell,      accentColor: 'border-rose-500',    iconColor: 'text-rose-400',   statKey: 'activeAlerts', statLabel: 'active', statCritical: true  },
  { tier: 'secondary', href: '/sip-trace',         label: 'SIP Trace',     desc: 'SIP message diagnostics',    icon: Mic,       accentColor: 'border-cyan-500',    iconColor: 'text-cyan-400'    },
  { tier: 'secondary', href: '/cdrs',              label: 'Call Replay',   desc: 'Recent CDR viewer',          icon: Rewind,    accentColor: 'border-indigo-500',  iconColor: 'text-indigo-400'  },
  { tier: 'secondary', href: '/console',           label: 'Console',       desc: 'Unified platform console',   icon: Database,  accentColor: 'border-emerald-500', iconColor: 'text-emerald-400' },
  { tier: 'secondary', href: '/server-monitoring', label: 'Diagnostics',   desc: 'Infra & server health',      icon: Activity,  accentColor: 'border-amber-500',   iconColor: 'text-amber-400'   },
];

const CLIENTS_CARDS: OpsCard[] = [
  // Primary tier — core client management workflows
  { tier: 'primary', href: '/clients', label: 'Accounts', desc: 'All client accounts — status, balances, usage and account-level operations',                 icon: Users,  accentColor: 'border-amber-500',   iconColor: 'text-amber-400'   },
  { tier: 'primary', href: '/billing', label: 'Billing',  desc: 'Payments, invoices, billing disputes and client financial management',                        icon: Wallet, accentColor: 'border-emerald-500', iconColor: 'text-emerald-400', statKey: 'pendingApprovals', statLabel: 'pending', statCritical: true },
  // Secondary tier — supporting client tools
  { tier: 'secondary', href: '/dids',            label: 'DIDs',           desc: 'Number inventory',        icon: PhoneIncoming,    accentColor: 'border-violet-500',  iconColor: 'text-violet-400'  },
  { tier: 'secondary', href: '/client-portal',   label: 'Client Portal',  desc: 'Self-service portal',     icon: Globe,            accentColor: 'border-cyan-500',    iconColor: 'text-cyan-400'    },
  { tier: 'secondary', href: '/reseller',        label: 'Resellers',      desc: 'Partner management',      icon: Users,            accentColor: 'border-indigo-500',  iconColor: 'text-indigo-400'  },
  { tier: 'secondary', href: '/call-recordings', label: 'Recordings',     desc: 'Call recording archive',  icon: Mic,              accentColor: 'border-blue-500',    iconColor: 'text-blue-400'    },
  { tier: 'secondary', href: '/client/wizard',   label: 'Create Account', desc: 'New account wizard',      icon: Users,            accentColor: 'border-amber-400',   iconColor: 'text-amber-300'   },
  { tier: 'secondary', href: '/team',            label: 'Permissions',    desc: 'Access & role control',   icon: Key,              accentColor: 'border-rose-500',    iconColor: 'text-rose-400'    },
];

const SECURITY_CARDS: OpsCard[] = [
  // Primary tier — critical security surfaces
  { tier: 'primary', href: '/fraud',     label: 'Fraud Engine',   desc: 'FAS and IRSF detection — monitor active fraud events, auto-blacklist and exposure triggers', icon: ShieldAlert,  accentColor: 'border-rose-500',  iconColor: 'text-rose-400',  statKey: 'activeIncidents',  statLabel: 'events',  statCritical: true },
  { tier: 'primary', href: '/approvals', label: 'Approval Queue', desc: 'Pending platform approvals — Sippy operations awaiting authorisation and sign-off',          icon: CheckCircle2, accentColor: 'border-amber-500', iconColor: 'text-amber-400', statKey: 'pendingApprovals', statLabel: 'pending', statCritical: true },
  // Secondary tier — supporting security tools
  { tier: 'secondary', href: '/firewall',          label: 'Firewall',       desc: 'Auto-blacklist rules',    icon: Shield,            accentColor: 'border-orange-500', iconColor: 'text-orange-400'  },
  { tier: 'secondary', href: '/audit-log',         label: 'Audit Log',      desc: 'Platform activity trail', icon: ClipboardList,     accentColor: 'border-amber-500',  iconColor: 'text-amber-400'   },
  { tier: 'secondary', href: '/compliance',        label: 'Compliance',     desc: 'Regulatory compliance',   icon: FileText,          accentColor: 'border-violet-500', iconColor: 'text-violet-400'  },
  { tier: 'secondary', href: '/stir-shaken',       label: 'STIR/SHAKEN',    desc: 'Attestation framework',   icon: Lock,              accentColor: 'border-cyan-500',   iconColor: 'text-cyan-400'    },
  { tier: 'secondary', href: '/approval-settings', label: 'Auth Rules',     desc: 'Approval configuration',  icon: SlidersHorizontal, accentColor: 'border-indigo-500', iconColor: 'text-indigo-400'  },
  { tier: 'secondary', href: '/team',              label: 'Access Control', desc: 'Roles & permissions',     icon: Key,               accentColor: 'border-rose-400',   iconColor: 'text-rose-300'    },
];

const ANALYTICS_CARDS: OpsCard[] = [
  // Primary tier — primary analysis surfaces
  { tier: 'primary', href: '/analytics',       label: 'Traffic Analytics', desc: 'Call volume, routing patterns, carrier traffic breakdown and trend analysis',           icon: LineChart, accentColor: 'border-blue-500',   iconColor: 'text-blue-400',   statKey: 'activeCalls',      statLabel: 'live',     statCritical: false },
  { tier: 'primary', href: '/revenue-heatmap', label: 'Revenue Heatmap',   desc: 'Geographic and destination-level revenue visualisation with margin and cost overlay',    icon: Map,       accentColor: 'border-violet-500', iconColor: 'text-violet-400', statKey: 'degradedCarriers', statLabel: 'degraded', statCritical: true  },
  // Secondary tier — supporting analytics tools
  { tier: 'secondary', href: '/cdrs',              label: 'CDR Viewer',    desc: 'Call detail records',    icon: History,     accentColor: 'border-cyan-500',    iconColor: 'text-cyan-400'   },
  { tier: 'secondary', href: '/asr-acd',           label: 'ASR / ACD',     desc: 'Quality KPI reports',    icon: BarChart3,   accentColor: 'border-emerald-500', iconColor: 'text-emerald-400', statKey: 'degradedCarriers', statLabel: 'degraded', statCritical: true },
  { tier: 'secondary', href: '/traffic-forecast',  label: 'Forecasting',   desc: 'Demand forecasting',     icon: TrendingDown,accentColor: 'border-blue-400',    iconColor: 'text-blue-300'   },
  { tier: 'secondary', href: '/reports',           label: 'Reports',       desc: 'Standard report centre', icon: BarChart2,   accentColor: 'border-violet-400',  iconColor: 'text-violet-300' },
  { tier: 'secondary', href: '/cost-optimisation', label: 'Cost Analysis', desc: 'Route cost engine',      icon: TrendingDown,accentColor: 'border-amber-500',   iconColor: 'text-amber-400'  },
  { tier: 'secondary', href: '/qos-heatmap',       label: 'QoS Analytics', desc: 'Quality of service map', icon: Activity,    accentColor: 'border-indigo-500',  iconColor: 'text-indigo-400' },
];

const FINANCE_CARDS: OpsCard[] = [
  // Primary tier — core financial management
  { tier: 'primary', href: '/billing',          label: 'Billing',           desc: 'Invoices, payments, billing disputes and account-level financial management',        icon: Wallet,      accentColor: 'border-emerald-500', iconColor: 'text-emerald-400', statKey: 'pendingApprovals', statLabel: 'pending', statCritical: true },
  { tier: 'primary', href: '/cost-optimisation',label: 'Cost Optimisation', desc: 'Route cost engine — margin analysis, LCR recommendations and cost-reduction signals', icon: TrendingDown,accentColor: 'border-cyan-500',    iconColor: 'text-cyan-400'    },
  // Secondary tier — supporting finance tools
  { tier: 'secondary', href: '/rate-cards',       label: 'Rate Cards',        desc: 'Rate decks & pricing',    icon: FileSpreadsheet, accentColor: 'border-blue-500',    iconColor: 'text-blue-400',   },
  { tier: 'secondary', href: '/balance',          label: 'Balance Monitor',   desc: 'Vendor account balances', icon: Wallet,          accentColor: 'border-amber-500',   iconColor: 'text-amber-400',   statKey: 'lowBalances', statLabel: 'low', statCritical: true },
  { tier: 'secondary', href: '/revenue-heatmap',  label: 'Revenue Analytics', desc: 'Revenue visualisation',   icon: Map,             accentColor: 'border-violet-500',  iconColor: 'text-violet-400'  },
  { tier: 'secondary', href: '/reports',          label: 'Margin Analysis',   desc: 'Revenue & cost reports',  icon: BarChart2,       accentColor: 'border-indigo-500',  iconColor: 'text-indigo-400'  },
  { tier: 'secondary', href: '/billing',          label: 'Payments',          desc: 'Payment processing',      icon: Banknote,        accentColor: 'border-emerald-400', iconColor: 'text-emerald-300' },
  { tier: 'secondary', href: '/billing-disputes', label: 'Invoices',          desc: 'Invoice & dispute log',   icon: FileText,        accentColor: 'border-rose-500',    iconColor: 'text-rose-400'    },
];

// ── Urgency scoring ────────────────────────────────────────────────────────────
type LiveStats = Parameters<typeof resolveStat>[1];

function cardUrgencyScore(card: OpsCard, stats: LiveStats): number {
  if (!card.statCritical) return 0;
  return resolveStat(card.statKey, stats);
}

// ── Primary ops card (full-width, 2-col grid) ─────────────────────────────────
function PrimaryOpsCard({ card, stat, elevated = false }: { card: OpsCard; stat: number; elevated?: boolean }) {
  const hasUrgency = card.statCritical && stat > 0;
  return (
    <Link
      href={card.href}
      data-testid={`ops-card-primary-${card.href.replace(/\//g, '-')}`}
      className={cn(
        "group relative flex flex-col gap-3 rounded-xl border-l-[3px] border transition-all duration-150",
        elevated
          ? "bg-white/[0.05] border-white/[0.12] shadow-[0_0_0_1px] shadow-rose-500/[0.12]"
          : "bg-white/[0.03] border-white/[0.07]",
        "hover:bg-white/[0.07] hover:border-white/[0.16] hover:shadow-sm px-5 py-4",
        card.accentColor,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className={cn("p-2 rounded-lg bg-white/[0.06] group-hover:bg-white/[0.09] transition-colors flex-shrink-0")}>
          <card.icon className={cn("w-5 h-5", card.iconColor)} />
        </div>
        {card.statKey && stat > 0 && (
          <span className={cn(
            "text-[9px] font-black tracking-widest px-2 py-0.5 rounded-full flex-shrink-0",
            hasUrgency ? "bg-rose-500/15 text-rose-400 border border-rose-500/20" : "bg-white/[0.06] text-muted-foreground/60",
          )}>
            {stat} {card.statLabel?.toUpperCase()}
          </span>
        )}
      </div>
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-foreground/90 group-hover:text-foreground leading-tight mb-1 transition-colors">
          {card.label}
        </div>
        <div className="text-[11px] text-muted-foreground/55 leading-snug">
          {card.desc}
        </div>
      </div>
      <div className="flex items-center justify-end">
        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/25 group-hover:text-muted-foreground/50 transition-colors" />
      </div>
    </Link>
  );
}

// ── Secondary ops card (compact, 3-col grid) ─────────────────────────────────
function SecondaryOpsCard({ card, stat }: { card: OpsCard; stat: number }) {
  const hasUrgency = card.statCritical && stat > 0;
  return (
    <Link
      href={card.href}
      data-testid={`ops-card-secondary-${card.href.replace(/\//g, '-')}`}
      className={cn(
        "group flex items-center gap-3 rounded-xl border-l-[3px] border border-white/[0.06]",
        "bg-white/[0.02] hover:bg-white/[0.05] px-4 py-3 transition-all duration-150",
        "hover:border-white/[0.12]",
        card.accentColor,
      )}
    >
      <div className={cn("p-1.5 rounded-lg bg-white/[0.05] group-hover:bg-white/[0.08] transition-colors flex-shrink-0")}>
        <card.icon className={cn("w-4 h-4", card.iconColor)} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold text-foreground/80 group-hover:text-foreground leading-tight transition-colors truncate">
          {card.label}
        </div>
        <div className="text-[10px] text-muted-foreground/45 truncate leading-tight">{card.desc}</div>
      </div>
      {card.statKey && stat > 0 ? (
        <span className={cn(
          "text-[9px] font-bold tabular-nums px-1.5 py-0.5 rounded flex-shrink-0",
          hasUrgency ? "bg-rose-500/15 text-rose-400" : "bg-white/[0.05] text-muted-foreground/50",
        )}>{stat}</span>
      ) : (
        <ChevronRight className="w-3 h-3 text-muted-foreground/20 group-hover:text-muted-foreground/45 flex-shrink-0 transition-colors" />
      )}
    </Link>
  );
}

// ── Ops card grid — urgency-sorted ────────────────────────────────────────────
function OpsCardGrid({ cards, stats }: { cards: OpsCard[]; stats: LiveStats }) {
  // Stable sort within each tier: highest urgency floats to front
  const sorted = [...cards].sort((a, b) => {
    if (a.tier !== b.tier) return 0; // keep tier groups intact
    return cardUrgencyScore(b, stats) - cardUrgencyScore(a, stats);
  });
  const primaryCards   = sorted.filter(c => c.tier === 'primary');
  const secondaryCards = sorted.filter(c => c.tier === 'secondary');

  // First primary card with critical urgency gets elevated styling
  const topUrgentHref = primaryCards.find(c => cardUrgencyScore(c, stats) > 0)?.href;

  return (
    <div className="flex flex-col gap-5">
      {primaryCards.length > 0 && (
        <div>
          <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/40 mb-2.5">
            Decision Tools
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {primaryCards.map(card => (
              <PrimaryOpsCard
                key={`${card.href}-${card.label}`}
                card={card}
                stat={resolveStat(card.statKey, stats)}
                elevated={card.href === topUrgentHref}
              />
            ))}
          </div>
        </div>
      )}
      {secondaryCards.length > 0 && (
        <div>
          <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/40 mb-2.5">
            Supporting Tools
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {secondaryCards.map(card => (
              <SecondaryOpsCard
                key={`${card.href}-${card.label}`}
                card={card}
                stat={resolveStat(card.statKey, stats)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── KPI card ──────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, color, icon: Icon }: {
  label: string; value: string | number; sub?: string;
  color: string; icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex items-center gap-3 bg-white/[0.04] border border-white/[0.07] rounded-xl px-4 py-3">
      <div className={cn("p-2 rounded-lg bg-white/[0.06]")}>
        <Icon className={cn("w-4 h-4", color)} />
      </div>
      <div className="min-w-0">
        <div className={cn("text-lg font-bold tabular-nums leading-tight", color)}>{value}</div>
        <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wider leading-tight">{label}</div>
        {sub && <div className="text-[10px] text-muted-foreground/40 truncate">{sub}</div>}
      </div>
    </div>
  );
}

// ── Quick-launch card (used by all workspaces that don't have OpsCardGrid) ───
function QuickCard({ link }: { link: QuickLink }) {
  return (
    <Link
      href={link.href}
      className="group flex items-center gap-3 bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] hover:border-white/[0.12] rounded-xl px-4 py-3 transition-all duration-150"
    >
      <div className="p-1.5 rounded-lg bg-white/[0.06] group-hover:bg-white/[0.10] transition-colors flex-shrink-0">
        <link.icon className={cn("w-4 h-4", link.color)} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-semibold text-foreground/80 group-hover:text-foreground transition-colors leading-tight">{link.label}</div>
        <div className="text-[10px] text-muted-foreground/50 truncate leading-tight">{link.desc}</div>
      </div>
      <ChevronRight className="w-3 h-3 text-muted-foreground/30 group-hover:text-muted-foreground/60 flex-shrink-0 transition-colors" />
    </Link>
  );
}

// ── Alert/incident row ────────────────────────────────────────────────────────
function IncidentRow({ incident }: { incident: any }) {
  const isActive = incident.status === 'active' || !incident.resolvedAt;
  return (
    <div className="flex items-start gap-2.5 py-2 border-b border-white/[0.04] last:border-0">
      <span className={cn("mt-0.5 h-1.5 w-1.5 rounded-full flex-shrink-0", isActive ? 'bg-rose-400' : 'bg-emerald-400')} />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-medium text-foreground/80 truncate">
          {incident.title || incident.message || `Incident #${incident.id}`}
        </div>
        <div className="text-[10px] text-muted-foreground/50">
          {incident.carrier || incident.entityName || ''}{incident.carrier && ' · '}
          {isActive ? 'Active' : 'Resolved'}
        </div>
      </div>
    </div>
  );
}

// ── Carrier health row ────────────────────────────────────────────────────────
function CarrierRow({ c }: { c: any }) {
  const score = c.stabilityScore ?? c.qScore ?? 0;
  const color = score >= 80 ? 'text-emerald-400' : score >= 55 ? 'text-amber-400' : 'text-rose-400';
  const asr   = c.rollingAsr ?? c.asr ?? 0;
  return (
    <div className="flex items-center gap-2.5 py-1.5 border-b border-white/[0.04] last:border-0">
      <span className={cn("h-1.5 w-1.5 rounded-full flex-shrink-0", score >= 80 ? 'bg-emerald-400' : score >= 55 ? 'bg-amber-400' : 'bg-rose-400')} />
      <div className="flex-1 min-w-0">
        <span className="text-[11px] font-medium text-foreground/80 truncate">{c.carrierName || c.name || 'Unknown'}</span>
      </div>
      <span className={cn("text-[11px] font-bold tabular-nums", color)}>{score.toFixed(0)}</span>
      <span className="text-[10px] text-muted-foreground/40 tabular-nums">ASR {asr.toFixed(1)}%</span>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function WorkspaceHomePage() {
  const params = useParams<{ domain: string }>();
  const domain = (params.domain || 'live-ops') as WorkspaceDomain;
  const config  = WS_CONFIG[domain] ?? WS_CONFIG['live-ops'];
  const label   = WORKSPACE_LABELS[domain] ?? domain;
  const textClr = WORKSPACE_TEXT_COLOR[domain] ?? 'text-violet-400';
  const dotBg   = WORKSPACE_DOT_BG[domain] ?? 'bg-violet-400';
  const HeaderIcon = config.headerIcon;

  // ── Data queries ──────────────────────────────────────────────────────────
  const { data: liveCallsRaw } = useQuery<any>({
    queryKey: ['/api/sippy/live-calls'], staleTime: 30_000, refetchInterval: 60_000,
  });
  const { data: incidentsRaw } = useQuery<any[]>({
    queryKey: ['/api/ai/incidents'], staleTime: 30_000, refetchInterval: 60_000,
  });
  const { data: carrierScoresRaw } = useQuery<any[]>({
    queryKey: ['/api/carrier-scores'], staleTime: 60_000, refetchInterval: 120_000,
  });
  const { data: pendingCountData } = useQuery<{ count: number }>({
    queryKey: ['/api/approvals/pending-count'], staleTime: 15_000, refetchInterval: 30_000,
  });
  const { data: vendorBalancesRaw } = useQuery<any[]>({
    queryKey: ['/api/vendor-balances'], staleTime: 60_000,
  });

  // Derived values
  const liveCallCount    = Array.isArray(liveCallsRaw) ? liveCallsRaw.length : (liveCallsRaw?.calls?.length ?? liveCallsRaw?.count ?? 0);
  const activeIncidents  = Array.isArray(incidentsRaw) ? incidentsRaw.filter((i: any) => i.status === 'active' || !i.resolvedAt) : [];
  const allIncidents     = Array.isArray(incidentsRaw) ? incidentsRaw : [];
  const carrierScores    = Array.isArray(carrierScoresRaw) ? carrierScoresRaw : [];
  const pendingCount     = pendingCountData?.count ?? 0;
  const vendorBalances   = Array.isArray(vendorBalancesRaw) ? vendorBalancesRaw : [];

  const avgAsr           = carrierScores.length > 0
    ? carrierScores.reduce((s: number, c: any) => s + (c.rollingAsr ?? 0), 0) / carrierScores.length : null;
  const degradedCarriers = carrierScores.filter((c: any) => (c.stabilityScore ?? 100) < 55);
  const healthyCarriers  = carrierScores.filter((c: any) => (c.stabilityScore ?? 100) >= 80);
  const lowBalances      = vendorBalances.filter((v: any) => (v.balance ?? Infinity) < 100).length;

  // Stats object passed to OpsCardGrid
  const liveStats = {
    degradedCarriers: degradedCarriers.length,
    activeIncidents:  activeIncidents.length,
    pendingApprovals: pendingCount,
    lowBalances,
    healthyCarriers:  healthyCarriers.length,
    activeCalls:      liveCallCount,
    activeAlerts:     activeIncidents.length,
  };

  // ── KPIs per workspace ────────────────────────────────────────────────────
  const kpisByDomain: Record<WorkspaceDomain, { label: string; value: string | number; sub?: string; color: string; icon: React.ComponentType<any> }[]> = {
    'live-ops': [
      { label: 'Live Calls',        value: liveCallCount,          color: 'text-violet-400', icon: Phone },
      { label: 'Active Alerts',     value: activeIncidents.length, color: activeIncidents.length > 0 ? 'text-rose-400' : 'text-emerald-400', icon: Bell },
      { label: 'Avg ASR',           value: avgAsr != null ? `${avgAsr.toFixed(1)}%` : '—', sub: `${carrierScores.length} carriers`, color: avgAsr == null ? 'text-muted-foreground' : avgAsr >= 90 ? 'text-emerald-400' : avgAsr >= 75 ? 'text-amber-400' : 'text-rose-400', icon: Activity },
      { label: 'Degraded Carriers', value: degradedCarriers.length, sub: `of ${carrierScores.length}`, color: degradedCarriers.length > 0 ? 'text-amber-400' : 'text-emerald-400', icon: AlertTriangle },
    ],
    'clients': [
      { label: 'Live Calls',        value: liveCallCount,          color: 'text-amber-400',  icon: Phone },
      { label: 'Active Alerts',     value: activeIncidents.length, color: activeIncidents.length > 0 ? 'text-rose-400' : 'text-emerald-400', icon: Bell },
      { label: 'Pending Approvals', value: pendingCount,           color: pendingCount > 0 ? 'text-amber-400' : 'text-emerald-400', icon: CheckCircle2 },
      { label: 'Avg ASR',           value: avgAsr != null ? `${avgAsr.toFixed(1)}%` : '—', color: avgAsr == null ? 'text-muted-foreground' : avgAsr >= 90 ? 'text-emerald-400' : 'text-amber-400', icon: BarChart3 },
    ],
    'vendors': [
      { label: 'Carriers',          value: carrierScores.length,   color: 'text-cyan-400',   icon: Wifi },
      { label: 'Degraded',          value: degradedCarriers.length, sub: `of ${carrierScores.length}`, color: degradedCarriers.length > 0 ? 'text-rose-400' : 'text-emerald-400', icon: AlertTriangle },
      { label: 'Avg ASR',           value: avgAsr != null ? `${avgAsr.toFixed(1)}%` : '—', color: avgAsr == null ? 'text-muted-foreground' : avgAsr >= 90 ? 'text-emerald-400' : avgAsr >= 75 ? 'text-amber-400' : 'text-rose-400', icon: BarChart3 },
      { label: 'Balance Alerts',    value: lowBalances, sub: `${vendorBalances.length} vendors`, color: 'text-amber-400', icon: Wallet },
    ],
    'analytics': [
      { label: 'Live Calls',        value: liveCallCount,          color: 'text-blue-400',   icon: Phone },
      { label: 'Active Incidents',  value: activeIncidents.length, color: activeIncidents.length > 0 ? 'text-rose-400' : 'text-emerald-400', icon: Bell },
      { label: 'Avg ASR',           value: avgAsr != null ? `${avgAsr.toFixed(1)}%` : '—', color: avgAsr == null ? 'text-muted-foreground' : avgAsr >= 90 ? 'text-emerald-400' : 'text-amber-400', icon: BarChart3 },
      { label: 'Carriers Monitored',value: carrierScores.length,   color: 'text-blue-400',   icon: Activity },
    ],
    'intelligence': [
      { label: 'Active Anomalies',  value: activeIncidents.length, color: activeIncidents.length > 0 ? 'text-rose-400' : 'text-emerald-400', icon: AlertTriangle },
      { label: 'Healthy Carriers',  value: healthyCarriers.length, sub: `of ${carrierScores.length}`, color: 'text-emerald-400', icon: CheckCircle2 },
      { label: 'Degraded',          value: degradedCarriers.length, sub: 'stability < 55',    color: degradedCarriers.length > 0 ? 'text-rose-400' : 'text-emerald-400', icon: ShieldAlert },
      { label: 'Avg ASR',           value: avgAsr != null ? `${avgAsr.toFixed(1)}%` : '—', color: avgAsr == null ? 'text-muted-foreground' : avgAsr >= 90 ? 'text-emerald-400' : avgAsr >= 75 ? 'text-amber-400' : 'text-rose-400', icon: BarChart3 },
    ],
    'security': [
      { label: 'Active Incidents',  value: activeIncidents.length, color: activeIncidents.length > 0 ? 'text-rose-400' : 'text-emerald-400', icon: ShieldAlert },
      { label: 'Pending Approvals', value: pendingCount,           color: pendingCount > 0 ? 'text-amber-400' : 'text-emerald-400', icon: CheckCircle2 },
      { label: 'Avg ASR',           value: avgAsr != null ? `${avgAsr.toFixed(1)}%` : '—', color: avgAsr == null ? 'text-muted-foreground' : avgAsr >= 90 ? 'text-emerald-400' : 'text-amber-400', icon: BarChart3 },
      { label: 'Carriers Monitored',value: carrierScores.length,   color: 'text-rose-400',   icon: Wifi },
    ],
    'finance': [
      { label: 'Live Calls',        value: liveCallCount,          color: 'text-emerald-400', icon: Phone },
      { label: 'Pending Approvals', value: pendingCount,           color: pendingCount > 0 ? 'text-amber-400' : 'text-emerald-400', icon: CheckCircle2 },
      { label: 'Avg ASR',           value: avgAsr != null ? `${avgAsr.toFixed(1)}%` : '—', color: avgAsr == null ? 'text-muted-foreground' : avgAsr >= 90 ? 'text-emerald-400' : 'text-amber-400', icon: BarChart3 },
      { label: 'Balance Alerts',    value: lowBalances, sub: `${vendorBalances.length} vendors`, color: 'text-amber-400', icon: Wallet },
    ],
    'settings': [
      { label: 'Active Incidents',  value: activeIncidents.length, color: activeIncidents.length > 0 ? 'text-rose-400' : 'text-emerald-400', icon: AlertTriangle },
      { label: 'Pending Approvals', value: pendingCount,           color: pendingCount > 0 ? 'text-amber-400' : 'text-emerald-400', icon: CheckCircle2 },
      { label: 'Live Calls',        value: liveCallCount,          color: 'text-slate-400',  icon: Phone },
      { label: 'Carriers',          value: carrierScores.length,   color: 'text-slate-400',  icon: Wifi },
    ],
  };

  const kpis = kpisByDomain[domain] ?? kpisByDomain['live-ops'];

  // ── Contextual live feed ──────────────────────────────────────────────────
  const showIncidentFeed = ['live-ops', 'intelligence', 'security'].includes(domain);
  const showCarrierFeed  = ['vendors', 'intelligence', 'analytics'].includes(domain);
  const recentIncidents  = allIncidents.slice(0, 5);
  const sortedCarriers   = [...carrierScores].sort((a: any, b: any) => (a.stabilityScore ?? 100) - (b.stabilityScore ?? 100)).slice(0, 6);

  // ── Workspaces that use OpsCardGrid (all except settings) ────────────────
  const OPS_CARD_MAP: Partial<Record<WorkspaceDomain, OpsCard[]>> = {
    'live-ops':     LIVE_OPS_CARDS,
    'clients':      CLIENTS_CARDS,
    'vendors':      VENDORS_CARDS,
    'analytics':    ANALYTICS_CARDS,
    'intelligence': INTELLIGENCE_CARDS,
    'security':     SECURITY_CARDS,
    'finance':      FINANCE_CARDS,
  };
  const useOpsGrid = domain in OPS_CARD_MAP;
  const opsCards   = OPS_CARD_MAP[domain] ?? [];

  return (
    <div className="flex flex-col min-h-full bg-background p-6 gap-6 max-w-[1400px] mx-auto">

      {/* ── Workspace header ── */}
      <div className="flex items-start gap-4">
        <div className="p-3 rounded-2xl border border-white/[0.08] bg-white/[0.04]">
          <HeaderIcon className={cn("w-7 h-7", textClr)} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={cn("h-2 w-2 rounded-full flex-shrink-0", dotBg)} />
            <h1 className={cn("text-xl font-bold tracking-tight", textClr)}>{label} Workspace</h1>
          </div>
          <p className="text-[13px] text-muted-foreground/70 max-w-2xl leading-relaxed">
            {config.description}
          </p>
        </div>
      </div>

      {/* ── KPI row ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {kpis.map(k => (
          <KpiCard key={k.label} label={k.label} value={k.value} sub={k.sub} color={k.color} icon={k.icon} />
        ))}
      </div>

      {/* ── Quick Access section ── */}
      <div className={cn("grid gap-6", (showIncidentFeed || showCarrierFeed) ? 'lg:grid-cols-[1fr_320px]' : 'grid-cols-1')}>

        {/* Card grid or QuickCard grid depending on workspace */}
        <div>
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/50 mb-3">
            Quick Access
          </h2>

          {useOpsGrid ? (
            <OpsCardGrid cards={opsCards} stats={liveStats} />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {config.quickLinks.map(link => (
                <QuickCard key={link.href} link={link} />
              ))}
            </div>
          )}
        </div>

        {/* Contextual live feed — right column */}
        {showIncidentFeed && (
          <div>
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/50 mb-3">
              Active Incidents
            </h2>
            <div className="bg-white/[0.03] border border-white/[0.07] rounded-xl px-4 py-2">
              {recentIncidents.length === 0 ? (
                <div className="flex items-center gap-2 py-4 text-emerald-400">
                  <CheckCircle2 className="w-4 h-4" />
                  <span className="text-[12px] font-medium">No active incidents</span>
                </div>
              ) : (
                recentIncidents.map((inc: any) => (
                  <IncidentRow key={inc.id} incident={inc} />
                ))
              )}
              {allIncidents.length > 0 && (
                <Link href="/ai-ops" className="flex items-center gap-1 mt-2 text-[10px] text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors">
                  View all incidents <ChevronRight className="w-3 h-3" />
                </Link>
              )}
            </div>
          </div>
        )}

        {showCarrierFeed && !showIncidentFeed && (
          <div>
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/50 mb-3">
              Carrier Health
            </h2>
            <div className="bg-white/[0.03] border border-white/[0.07] rounded-xl px-4 py-2">
              {sortedCarriers.length === 0 ? (
                <div className="flex items-center gap-2 py-4 text-muted-foreground/50">
                  <Activity className="w-4 h-4" />
                  <span className="text-[12px]">No carrier data</span>
                </div>
              ) : (
                sortedCarriers.map((c: any) => (
                  <CarrierRow key={c.id ?? c.carrierName} c={c} />
                ))
              )}
              {carrierScores.length > 0 && (
                <Link href="/carrier-scoring" className="flex items-center gap-1 mt-2 text-[10px] text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors">
                  Full scorecard <ChevronRight className="w-3 h-3" />
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
