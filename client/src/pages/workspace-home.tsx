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
  HardDrive, Database, Star,
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
      { href: '/calls',          label: 'Live Calls',    desc: 'Active call stream',       icon: Phone,    color: 'text-violet-400' },
      { href: '/alerts',         label: 'Alerts',        desc: 'Platform alerts',           icon: Bell,     color: 'text-rose-400'   },
      { href: '/noc-command',    label: 'NOC Command',   desc: 'Operator command centre',   icon: Monitor,  color: 'text-cyan-400'   },
      { href: '/multi-switch',   label: 'Multi-Switch',  desc: 'Consolidated switch view',  icon: Layers,   color: 'text-amber-400'  },
      { href: '/console',        label: 'Console',       desc: 'Unified console',           icon: Database, color: 'text-emerald-400'},
      { href: '/sbc-monitor',    label: 'SBC Monitor',   desc: 'Session border controller', icon: HardDrive,color: 'text-blue-400'   },
      { href: '/traffic-map',    label: 'Traffic Map',   desc: 'Geographic call view',      icon: Globe,    color: 'text-indigo-400' },
      { href: '/server-monitoring',label:'Infra Health', desc: 'Server & infra monitoring', icon: Server,   color: 'text-orange-400' },
    ],
  },
  'clients': {
    description: 'Account management, billing, DID inventory, and client portal',
    headerIcon: Users,
    quickLinks: [
      { href: '/clients',        label: 'Accounts',      desc: 'All client accounts',       icon: Users,       color: 'text-amber-400'  },
      { href: '/client-portal',  label: 'Client Portal', desc: 'Self-service portal',       icon: Globe,       color: 'text-cyan-400'   },
      { href: '/dids',           label: 'DIDs',          desc: 'Number inventory',          icon: PhoneIncoming,color:'text-violet-400' },
      { href: '/billing',        label: 'Billing',       desc: 'Payments & invoices',       icon: Wallet,      color: 'text-emerald-400'},
      { href: '/billing-disputes',label:'Disputes',      desc: 'Dispute resolution',        icon: FileText,    color: 'text-rose-400'   },
      { href: '/client/wizard',  label: 'New Account',   desc: 'Create a client account',   icon: Users,       color: 'text-blue-400'   },
      { href: '/balance',        label: 'Balances',      desc: 'Account balance monitor',   icon: Wallet,      color: 'text-orange-400' },
      { href: '/reseller',       label: 'Resellers',     desc: 'Partner management',        icon: Star,        color: 'text-indigo-400' },
    ],
  },
  'vendors': {
    description: 'Carrier management, quality scoring, rate cards, and balance monitoring',
    headerIcon: Wifi,
    quickLinks: [
      { href: '/vendors',                    label: 'Vendor List',    desc: 'All carrier accounts',      icon: Wifi,        color: 'text-cyan-400'   },
      { href: '/carrier-scoring',            label: 'Carrier Scoring',desc: 'Quality benchmarks',        icon: BarChart3,   color: 'text-amber-400'  },
      { href: '/carrier-intelligence',       label: 'Carrier Intel',  desc: 'Market intelligence',       icon: Brain,       color: 'text-fuchsia-400'},
      { href: '/vendor-prefix-intelligence', label: 'Prefix Intel',   desc: 'Prefix-level analysis',     icon: Globe,       color: 'text-violet-400' },
      { href: '/vendor-stability-timeline',  label: 'Stability',      desc: 'Vendor stability history',  icon: Activity,    color: 'text-emerald-400'},
      { href: '/vendor-rca',                 label: 'RCA Drilldown',  desc: 'Root cause analysis',       icon: ScanSearch,  color: 'text-rose-400'   },
      { href: '/rate-cards',                 label: 'Rate Cards',     desc: 'Pricing management',        icon: FileSpreadsheet,color:'text-blue-400' },
      { href: '/balance',                    label: 'Balances',       desc: 'Vendor balance monitor',    icon: Wallet,      color: 'text-orange-400' },
    ],
  },
  'routing': {
    description: 'Route groups, LCR optimisation, call flow simulation, and self-healing',
    headerIcon: GitBranch,
    quickLinks: [
      { href: '/routing-manager',      label: 'Routing Manager',   desc: 'Groups & connections',  icon: GitBranch,    color: 'text-emerald-400'},
      { href: '/lcr-analyser',         label: 'LCR Analyser',      desc: 'Least-cost routing',    icon: Calculator,   color: 'text-amber-400'  },
      { href: '/self-heal',            label: 'Self-Heal',         desc: 'Auto-healing routes',   icon: HeartPulse,   color: 'text-rose-400'   },
      { href: '/call-flow-simulator',  label: 'Call Flow Sim',     desc: 'Route simulation',      icon: ArrowRightLeft,color:'text-cyan-400'   },
      { href: '/cost-optimisation',    label: 'Cost Optimisation', desc: 'Route cost engine',     icon: TrendingDown, color: 'text-violet-400' },
      { href: '/routing-manager?tab=connections',    label: 'Connections',     desc: 'Trunk connections',     icon: Network,      color: 'text-blue-400'   },
      { href: '/routing-manager?tab=destination-sets',label:'Destination Sets',desc: 'Destination rules',     icon: Layers,       color: 'text-indigo-400' },
      { href: '/routing-manager?tab=policy-sim',     label: 'Policy Sim',      desc: 'Policy simulation',     icon: Zap,          color: 'text-orange-400' },
    ],
  },
  'reports': {
    description: 'Traffic analytics, revenue reporting, CDR viewer, and performance heatmaps',
    headerIcon: BarChart2,
    quickLinks: [
      { href: '/cdrs',             label: 'CDR Viewer',       desc: 'Call detail records',     icon: FileSpreadsheet,color:'text-blue-400'   },
      { href: '/reports',          label: 'Reports',          desc: 'Standard report centre',  icon: BarChart2,    color: 'text-violet-400' },
      { href: '/asr-acd',          label: 'ASR / ACD',        desc: 'Quality KPI reports',     icon: BarChart3,    color: 'text-emerald-400'},
      { href: '/analytics',        label: 'Analytics',        desc: 'Revenue analytics',       icon: LineChart,    color: 'text-amber-400'  },
      { href: '/bitseye',          label: 'BitsEye',          desc: 'Drill-down analytics',    icon: Eye,          color: 'text-cyan-400'   },
      { href: '/revenue-heatmap',  label: 'Revenue Heatmap',  desc: 'Revenue analysis map',    icon: TrendingUp,   color: 'text-rose-400'   },
      { href: '/traffic-forecast', label: 'Forecast',         desc: 'Demand forecasting',      icon: TrendingDown, color: 'text-blue-400'   },
      { href: '/qos-heatmap',      label: 'QoS Heatmap',      desc: 'Quality of service map',  icon: Activity,     color: 'text-indigo-400' },
    ],
  },
  'intelligence': {
    description: 'Correlated signals, anomaly detection, carrier health, and AI-powered insights',
    headerIcon: Brain,
    quickLinks: [
      { href: '/intelligence',             label: 'Intelligence Hub',   desc: 'Correlated insights',    icon: Brain,       color: 'text-fuchsia-400'},
      { href: '/intelligence-validation',  label: 'Validation Console', desc: 'Data quality checks',    icon: Shield,      color: 'text-emerald-400'},
      { href: '/ai-ops',                   label: 'AI Ops Center',      desc: 'Anomaly detection',      icon: Bot,         color: 'text-violet-400' },
      { href: '/carrier-intelligence',     label: 'Carrier Intel',      desc: 'Route health signals',   icon: Activity,    color: 'text-cyan-400'   },
      { href: '/carrier-scoring',          label: 'Carrier Scoring',    desc: 'Quality benchmarks',     icon: BarChart3,   color: 'text-amber-400'  },
      { href: '/ai-ops?tab=decision-overlay',label:'Decision Overlay',  desc: 'AI steering decisions',  icon: Eye,         color: 'text-rose-400'   },
      { href: '/vendor-rca',               label: 'RCA Drilldown',      desc: 'Root cause analysis',    icon: ScanSearch,  color: 'text-blue-400'   },
      { href: '/vendor-stability-timeline',label: 'Stability Timeline', desc: 'Vendor health history',  icon: HeartPulse,  color: 'text-indigo-400' },
    ],
  },
  'troubleshooting': {
    description: 'SIP tracing, RTP analysis, test calls, call replay, and engineering tools',
    headerIcon: Wrench,
    quickLinks: [
      { href: '/sip-trace',         label: 'SIP Trace',        desc: 'Packet-level tracing',    icon: Mic,          color: 'text-orange-400' },
      { href: '/rtp-analytics',     label: 'RTP Analytics',    desc: 'Media quality analysis',  icon: Activity,     color: 'text-cyan-400'   },
      { href: '/test-call',         label: 'Test Suite',       desc: 'On-demand test calls',    icon: PhoneCall,    color: 'text-emerald-400'},
      { href: '/replay',            label: 'Replay Engine',    desc: 'Call session replay',     icon: Rewind,       color: 'text-violet-400' },
      { href: '/network-topology',  label: 'Network Topology', desc: 'Topology viewer',         icon: Network,      color: 'text-blue-400'   },
      { href: '/test-campaigns',    label: 'Test Campaigns',   desc: 'Automated test suites',   icon: FlaskConical, color: 'text-amber-400'  },
      { href: '/tools',             label: 'Tools',            desc: 'Engineering utilities',   icon: Wrench,       color: 'text-rose-400'   },
      { href: '/number-intelligence',label:'Number Intel',     desc: 'Number analysis',         icon: ScanSearch,   color: 'text-indigo-400' },
    ],
  },
  'fraud': {
    description: 'FAS/IRSF detection, firewall, compliance, approvals, and audit trail',
    headerIcon: ShieldAlert,
    quickLinks: [
      { href: '/fraud',             label: 'Fraud Engine',    desc: 'FAS/IRSF detection',       icon: ShieldAlert,  color: 'text-rose-400'   },
      { href: '/firewall',          label: 'Firewall',        desc: 'Auto-blacklist rules',      icon: Shield,       color: 'text-orange-400' },
      { href: '/approvals',         label: 'Approvals',       desc: 'Pending approval queue',    icon: CheckCircle2, color: 'text-emerald-400'},
      { href: '/audit-log',         label: 'Audit Log',       desc: 'Platform activity trail',   icon: ClipboardList,color: 'text-amber-400'  },
      { href: '/compliance',        label: 'Compliance',      desc: 'Regulatory compliance',     icon: FileText,     color: 'text-violet-400' },
      { href: '/stir-shaken',       label: 'STIR/SHAKEN',     desc: 'Attestation framework',     icon: Lock,         color: 'text-cyan-400'   },
      { href: '/call-recordings',   label: 'Recordings',      desc: 'Call recording archive',    icon: Mic,          color: 'text-blue-400'   },
      { href: '/vendor-sla-scorecard',label:'SLA Management', desc: 'SLA breach tracking',       icon: HeartPulse,   color: 'text-indigo-400' },
    ],
  },
  'settings': {
    description: 'Platform configuration, team management, API keys, and system preferences',
    headerIcon: Settings,
    quickLinks: [
      { href: '/settings',         label: 'Platform Settings', desc: 'System configuration',   icon: Settings,        color: 'text-slate-400'  },
      { href: '/team',             label: 'Team & KAM',        desc: 'Roles & access control', icon: Users,           color: 'text-violet-400' },
      { href: '/api-keys',         label: 'API Keys',          desc: 'API key management',     icon: Key,             color: 'text-amber-400'  },
      { href: '/email-centre',     label: 'Email Centre',      desc: 'Notification config',    icon: Mail,            color: 'text-cyan-400'   },
      { href: '/approval-settings',label: 'Approval Rules',    desc: 'Approval configuration', icon: SlidersHorizontal,color:'text-emerald-400'},
      { href: '/whatsapp-alerts',  label: 'WhatsApp Alerts',   desc: 'Alert delivery config',  icon: Bell,            color: 'text-rose-400'   },
      { href: '/vpn-config',       label: 'VPN Config',        desc: 'VPN configuration',      icon: Lock,            color: 'text-blue-400'   },
      { href: '/sidebar-settings', label: 'Sidebar Menu',      desc: 'Navigation preferences', icon: SlidersHorizontal,color:'text-indigo-400'},
    ],
  },
};

// ── KPI card ──────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, color, icon: Icon }: {
  label: string; value: string | number; sub?: string;
  color: string; icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex items-center gap-3 bg-white/[0.04] border border-white/[0.07] rounded-xl px-4 py-3">
      <div className={cn("p-2 rounded-lg bg-white/[0.06]", color.replace('text-',''))}>
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

// ── Quick-launch card ─────────────────────────────────────────────────────────
function QuickCard({ link }: { link: QuickLink }) {
  return (
    <Link
      href={link.href}
      className="group flex items-center gap-3 bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] hover:border-white/[0.12] rounded-xl px-4 py-3 transition-all duration-150"
    >
      <div className={cn("p-1.5 rounded-lg bg-white/[0.06] group-hover:bg-white/[0.10] transition-colors flex-shrink-0")}>
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
      <span className={cn("text-[11px] font-bold tabular-nums", color)}>
        {score.toFixed(0)}
      </span>
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

  // ── Data queries ─────────────────────────────────────────────────────────
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
  const liveCallCount   = Array.isArray(liveCallsRaw) ? liveCallsRaw.length : (liveCallsRaw?.calls?.length ?? liveCallsRaw?.count ?? 0);
  const activeIncidents = Array.isArray(incidentsRaw) ? incidentsRaw.filter((i: any) => i.status === 'active' || !i.resolvedAt) : [];
  const allIncidents    = Array.isArray(incidentsRaw) ? incidentsRaw : [];
  const carrierScores   = Array.isArray(carrierScoresRaw) ? carrierScoresRaw : [];
  const pendingCount    = pendingCountData?.count ?? 0;
  const vendorBalances  = Array.isArray(vendorBalancesRaw) ? vendorBalancesRaw : [];

  const avgAsr = carrierScores.length > 0
    ? carrierScores.reduce((s: number, c: any) => s + (c.rollingAsr ?? 0), 0) / carrierScores.length : null;
  const degradedCarriers = carrierScores.filter((c: any) => (c.stabilityScore ?? 100) < 55);
  const healthyCarriers  = carrierScores.filter((c: any) => (c.stabilityScore ?? 100) >= 80);

  // ── KPIs per workspace ───────────────────────────────────────────────────
  const kpisByDomain: Record<WorkspaceDomain, { label: string; value: string | number; sub?: string; color: string; icon: React.ComponentType<any> }[]> = {
    'live-ops': [
      { label: 'Live Calls',     value: liveCallCount,              color: 'text-violet-400', icon: Phone },
      { label: 'Active Alerts',  value: activeIncidents.length,     color: activeIncidents.length > 0 ? 'text-rose-400' : 'text-emerald-400', icon: Bell },
      { label: 'Avg ASR',        value: avgAsr != null ? `${avgAsr.toFixed(1)}%` : '—', sub: `${carrierScores.length} carriers`, color: avgAsr == null ? 'text-muted-foreground' : avgAsr >= 90 ? 'text-emerald-400' : avgAsr >= 75 ? 'text-amber-400' : 'text-rose-400', icon: Activity },
      { label: 'Degraded Carriers', value: degradedCarriers.length, sub: `of ${carrierScores.length}`, color: degradedCarriers.length > 0 ? 'text-amber-400' : 'text-emerald-400', icon: AlertTriangle },
    ],
    'clients': [
      { label: 'Live Calls',     value: liveCallCount,              color: 'text-amber-400',  icon: Phone },
      { label: 'Active Alerts',  value: activeIncidents.length,     color: activeIncidents.length > 0 ? 'text-rose-400' : 'text-emerald-400', icon: Bell },
      { label: 'Pending Approvals', value: pendingCount,            color: pendingCount > 0 ? 'text-amber-400' : 'text-emerald-400', icon: CheckCircle2 },
      { label: 'Avg ASR',        value: avgAsr != null ? `${avgAsr.toFixed(1)}%` : '—', color: avgAsr == null ? 'text-muted-foreground' : avgAsr >= 90 ? 'text-emerald-400' : 'text-amber-400', icon: BarChart3 },
    ],
    'vendors': [
      { label: 'Carriers',       value: carrierScores.length,       color: 'text-cyan-400',   icon: Wifi },
      { label: 'Degraded',       value: degradedCarriers.length,    sub: `of ${carrierScores.length}`, color: degradedCarriers.length > 0 ? 'text-rose-400' : 'text-emerald-400', icon: AlertTriangle },
      { label: 'Avg ASR',        value: avgAsr != null ? `${avgAsr.toFixed(1)}%` : '—', color: avgAsr == null ? 'text-muted-foreground' : avgAsr >= 90 ? 'text-emerald-400' : avgAsr >= 75 ? 'text-amber-400' : 'text-rose-400', icon: BarChart3 },
      { label: 'Balance Alerts', value: vendorBalances.filter((v: any) => (v.balance ?? Infinity) < 100).length, sub: `${vendorBalances.length} vendors`, color: 'text-amber-400', icon: Wallet },
    ],
    'routing': [
      { label: 'Live Calls',     value: liveCallCount,              color: 'text-emerald-400', icon: Phone },
      { label: 'Active Incidents',value: activeIncidents.length,    color: activeIncidents.length > 0 ? 'text-rose-400' : 'text-emerald-400', icon: AlertTriangle },
      { label: 'Avg ASR',        value: avgAsr != null ? `${avgAsr.toFixed(1)}%` : '—', color: avgAsr == null ? 'text-muted-foreground' : avgAsr >= 90 ? 'text-emerald-400' : 'text-amber-400', icon: BarChart3 },
      { label: 'Pending Approvals', value: pendingCount,            color: pendingCount > 0 ? 'text-amber-400' : 'text-emerald-400', icon: CheckCircle2 },
    ],
    'reports': [
      { label: 'Live Calls',     value: liveCallCount,              color: 'text-blue-400',   icon: Phone },
      { label: 'Active Incidents',value: activeIncidents.length,    color: activeIncidents.length > 0 ? 'text-rose-400' : 'text-emerald-400', icon: Bell },
      { label: 'Avg ASR',        value: avgAsr != null ? `${avgAsr.toFixed(1)}%` : '—', color: avgAsr == null ? 'text-muted-foreground' : avgAsr >= 90 ? 'text-emerald-400' : 'text-amber-400', icon: BarChart3 },
      { label: 'Carriers Monitored', value: carrierScores.length,   color: 'text-blue-400',   icon: Activity },
    ],
    'intelligence': [
      { label: 'Active Anomalies', value: activeIncidents.length,   color: activeIncidents.length > 0 ? 'text-rose-400' : 'text-emerald-400', icon: AlertTriangle },
      { label: 'Healthy Carriers', value: healthyCarriers.length,   sub: `of ${carrierScores.length}`, color: 'text-emerald-400', icon: CheckCircle2 },
      { label: 'Degraded',        value: degradedCarriers.length,   sub: `stability < 55`, color: degradedCarriers.length > 0 ? 'text-rose-400' : 'text-emerald-400', icon: ShieldAlert },
      { label: 'Avg ASR',         value: avgAsr != null ? `${avgAsr.toFixed(1)}%` : '—', color: avgAsr == null ? 'text-muted-foreground' : avgAsr >= 90 ? 'text-emerald-400' : avgAsr >= 75 ? 'text-amber-400' : 'text-rose-400', icon: BarChart3 },
    ],
    'troubleshooting': [
      { label: 'Active Incidents', value: activeIncidents.length,   color: activeIncidents.length > 0 ? 'text-rose-400' : 'text-emerald-400', icon: AlertTriangle },
      { label: 'Live Calls',       value: liveCallCount,            color: 'text-orange-400', icon: Phone },
      { label: 'Degraded Carriers',value: degradedCarriers.length,  color: degradedCarriers.length > 0 ? 'text-amber-400' : 'text-emerald-400', icon: Wifi },
      { label: 'Pending Approvals',value: pendingCount,             color: pendingCount > 0 ? 'text-amber-400' : 'text-emerald-400', icon: CheckCircle2 },
    ],
    'fraud': [
      { label: 'Active Incidents', value: activeIncidents.length,   color: activeIncidents.length > 0 ? 'text-rose-400' : 'text-emerald-400', icon: ShieldAlert },
      { label: 'Pending Approvals',value: pendingCount,             color: pendingCount > 0 ? 'text-amber-400' : 'text-emerald-400', icon: CheckCircle2 },
      { label: 'Avg ASR',          value: avgAsr != null ? `${avgAsr.toFixed(1)}%` : '—', color: avgAsr == null ? 'text-muted-foreground' : avgAsr >= 90 ? 'text-emerald-400' : 'text-amber-400', icon: BarChart3 },
      { label: 'Carriers Monitored',value: carrierScores.length,    color: 'text-rose-400',   icon: Wifi },
    ],
    'settings': [
      { label: 'Active Incidents', value: activeIncidents.length,   color: activeIncidents.length > 0 ? 'text-rose-400' : 'text-emerald-400', icon: AlertTriangle },
      { label: 'Pending Approvals',value: pendingCount,             color: pendingCount > 0 ? 'text-amber-400' : 'text-emerald-400', icon: CheckCircle2 },
      { label: 'Live Calls',       value: liveCallCount,            color: 'text-slate-400',  icon: Phone },
      { label: 'Carriers',         value: carrierScores.length,     color: 'text-slate-400',  icon: Wifi },
    ],
  };

  const kpis = kpisByDomain[domain] ?? kpisByDomain['live-ops'];

  // ── Contextual live feed (depends on workspace) ──────────────────────────
  const showIncidentFeed   = ['live-ops','intelligence','troubleshooting','fraud'].includes(domain);
  const showCarrierFeed    = ['vendors','intelligence','routing'].includes(domain);
  const recentIncidents    = allIncidents.slice(0, 5);
  const sortedCarriers     = [...carrierScores].sort((a: any, b: any) => (a.stabilityScore ?? 100) - (b.stabilityScore ?? 100)).slice(0, 6);

  return (
    <div className="flex flex-col min-h-full bg-background p-6 gap-6 max-w-[1400px] mx-auto">

      {/* ── Workspace header ── */}
      <div className="flex items-start gap-4">
        <div className={cn("p-3 rounded-2xl border bg-white/[0.04]", 'border-white/[0.08]')}>
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

      {/* ── Quick launch + live feed ── */}
      <div className={cn("grid gap-6", (showIncidentFeed || showCarrierFeed) ? 'lg:grid-cols-[1fr_320px]' : 'grid-cols-1')}>

        {/* Quick launch grid */}
        <div>
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/50 mb-3">
            Quick Launch
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {config.quickLinks.map(link => (
              <QuickCard key={link.href} link={link} />
            ))}
          </div>
        </div>

        {/* Contextual live feed */}
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
