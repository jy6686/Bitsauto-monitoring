import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useLocation, useSearch } from "wouter";
import {
  Radio, Users, Wifi, GitBranch, BarChart2,
  Wrench, ShieldAlert, Settings, ChevronRight, ChevronDown,
  Activity, Globe, Phone, PhoneCall, Server,
  LineChart, Eye, Monitor, Database, Network,
  HardDrive, Layers, Calculator, Route, FlaskConical,
  Shield, FileText, Lock, TrendingDown, History,
  LayoutDashboard, Zap, Map, BarChart3, Brain,
  SlidersHorizontal, Key, Mail, Building2, Wallet,
  HeartPulse, Mic, Bot, ClipboardList, ArrowRightLeft,
  FileSpreadsheet, Rewind, Upload, Star, Package, Search,
  MessageSquare, Bell, Sun, Moon, LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { useQuery } from "@tanstack/react-query";
import { inferWorkspace } from "@/lib/workspace";
import { useChatDrawer } from "@/context/chat-drawer-context";

function openCommandBar() {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
}

interface Module { href: string; label: string; desc: string; icon: React.ComponentType<{ className?: string }> }
interface Group  { label: string; icon: React.ComponentType<{ className?: string }>; items: Module[] }
interface Domain { id: string; label: string; icon: React.ComponentType<{ className?: string }>; color: string; groups: Group[] }

const DOMAINS: Domain[] = [
  {
    id: 'live-ops', label: 'Live Ops', icon: Radio, color: 'text-violet-400',
    groups: [
      { label: 'Monitor', icon: Eye, items: [
        { href: '/bitseye2',     label: 'BitsEye 2',    desc: 'Live topology observatory', icon: Eye },
        { href: '/live-traffic', label: 'Live Traffic', desc: 'Active call stream',        icon: Activity },
        { href: '/traffic-map',  label: 'Traffic Map',  desc: 'Geographic call view',      icon: Globe },
        { href: '/graphs',       label: 'Graphs',       desc: 'Performance charts',        icon: LineChart },
      ]},
      { label: 'Infrastructure', icon: Server, items: [
        { href: '/multi-switch',      label: 'Multi-Switch',   desc: 'Consolidated switch view',  icon: Layers },
        { href: '/server-monitoring', label: 'Server Monitor', desc: 'Infrastructure health',     icon: Server },
        { href: '/sbc-monitor',       label: 'SBC Monitor',    desc: 'Session border controller', icon: HardDrive },
      ]},
      { label: 'Operations', icon: Monitor, items: [
        { href: '/noc-command', label: 'NOC Command', desc: 'Command center',         icon: Monitor },
        { href: '/ops-console', label: 'Ops Console', desc: 'Unified operations',     icon: SlidersHorizontal },
        { href: '/console',     label: 'Console',     desc: 'Logs & debug shell',     icon: Database },
        { href: '/alerts',      label: 'Alerts',      desc: 'Platform alerts',        icon: Zap },
      ]},
    ],
  },
  {
    id: 'clients', label: 'Clients', icon: Users, color: 'text-amber-400',
    groups: [
      { label: 'Accounts', icon: Users, items: [
        { href: '/clients',       label: 'Accounts',      desc: 'Client management',   icon: Users },
        { href: '/client-portal', label: 'Client Portal', desc: 'Self-service access', icon: Building2 },
        { href: '/reseller',      label: 'Reseller',      desc: 'Partner accounts',    icon: Star },
      ]},
      { label: 'Billing', icon: Wallet, items: [
        { href: '/billing',          label: 'Billing',  desc: 'Payments & invoices', icon: Wallet },
        { href: '/billing-disputes', label: 'Disputes', desc: 'Dispute resolution',  icon: ClipboardList },
      ]},
      { label: 'Numbers & Config', icon: Phone, items: [
        { href: '/dids',          label: 'DIDs',          desc: 'Number inventory', icon: Phone },
        { href: '/account-names', label: 'Account Names', desc: 'Account naming',   icon: FileText },
      ]},
    ],
  },
  {
    id: 'vendors', label: 'Vendors', icon: Wifi, color: 'text-cyan-400',
    groups: [
      { label: 'Health & Quality', icon: HeartPulse, items: [
        { href: '/vendors',              label: 'Vendor List',     desc: 'Carrier management',  icon: Wifi },
        { href: '/vendor-sla-scorecard', label: 'SLA Scorecard',   desc: 'Carrier performance', icon: HeartPulse },
        { href: '/carrier-scoring',      label: 'Carrier Scoring', desc: 'Quality benchmarks',  icon: Star },
      ]},
      { label: 'Intelligence', icon: Brain, items: [
        { href: '/carrier-intelligence',       label: 'Carrier Intel', desc: 'Market intelligence',   icon: Brain },
        { href: '/vendor-prefix-intelligence', label: 'Prefix Intel',  desc: 'Prefix-level analysis', icon: Globe },
        { href: '/vendor-stability-timeline',  label: 'Stability',     desc: 'Vendor timeline',       icon: Activity },
        { href: '/vendor-rca',                 label: 'RCA Drilldown', desc: 'Root cause analysis',   icon: Search },
      ]},
      { label: 'Finance', icon: Wallet, items: [
        { href: '/balance',     label: 'Balance Monitor', desc: 'Vendor balances',    icon: Wallet },
        { href: '/products',    label: 'Products',        desc: 'Product catalogue',  icon: Package },
        { href: '/rate-cards',  label: 'Rate Cards',      desc: 'Pricing management', icon: FileSpreadsheet },
      ]},
    ],
  },
  {
    id: 'routing', label: 'Routing', icon: GitBranch, color: 'text-emerald-400',
    groups: [
      { label: 'Manager', icon: GitBranch, items: [
        { href: '/routing-manager', label: 'Routing Manager', desc: 'Groups & connections', icon: GitBranch },
        { href: '/lcr-analyser',    label: 'LCR Analyser',    desc: 'Least-cost routing',   icon: Calculator },
      ]},
      { label: 'Analysis', icon: Brain, items: [
        { href: '/routing-intelligence', label: 'Routing Intel', desc: 'Intelligent routing', icon: Brain },
        { href: '/number-intelligence',  label: 'Number Intel',  desc: 'Number analysis',     icon: Phone },
      ]},
      { label: 'Simulation', icon: ArrowRightLeft, items: [
        { href: '/call-flow-simulator', label: 'Call Flow Sim', desc: 'Route simulation',    icon: ArrowRightLeft },
        { href: '/self-heal',           label: 'Self-Heal',     desc: 'Auto-heal routes',    icon: HeartPulse },
      ]},
      { label: 'Cost', icon: TrendingDown, items: [
        { href: '/cost-optimisation', label: 'Cost Optimisation', desc: 'Route cost engine', icon: TrendingDown },
      ]},
    ],
  },
  {
    id: 'reports', label: 'Analytics', icon: BarChart2, color: 'text-blue-400',
    groups: [
      { label: 'Reports', icon: BarChart2, items: [
        { href: '/reports', label: 'Reports',   desc: 'Report centre',        icon: BarChart2 },
        { href: '/asr-acd', label: 'ASR / ACD', desc: 'Call quality reports', icon: BarChart3 },
        { href: '/cdrs',    label: 'CDRs',       desc: 'Call detail records',  icon: History },
      ]},
      { label: 'Visual Analytics', icon: LineChart, items: [
        { href: '/analytics',       label: 'Analytics',       desc: 'Traffic analytics', icon: LineChart },
        { href: '/bitseye',         label: 'BitsEye',         desc: 'Drill-down analytics', icon: Eye },
        { href: '/revenue-heatmap', label: 'Revenue Heatmap', desc: 'Revenue analysis',  icon: Map },
      ]},
      { label: 'Forecasting', icon: TrendingDown, items: [
        { href: '/traffic-forecast', label: 'Traffic Forecast', desc: 'Demand forecasting',  icon: TrendingDown },
        { href: '/qos-heatmap',      label: 'QoS Heatmap',      desc: 'Quality of service',  icon: HeartPulse },
        { href: '/codec-analytics',  label: 'Codec Analytics',  desc: 'Codec breakdown',     icon: Radio },
      ]},
    ],
  },
  {
    id: 'intelligence', label: 'Intelligence', icon: Brain, color: 'text-fuchsia-400',
    groups: [
      { label: 'Core', icon: Brain, items: [
        { href: '/intelligence', label: 'Intelligence Hub', desc: 'Correlated insights',  icon: Brain },
        { href: '/ai-ops',       label: 'AI Ops Center',    desc: 'Anomaly detection',    icon: Bot },
        { href: '/carrier-intelligence', label: 'Carrier Intel', desc: 'Route health signals', icon: Activity },
      ]},
      { label: 'Validation', icon: Shield, items: [
        { href: '/intelligence-validation', label: 'Validation', desc: 'Data quality checks', icon: Shield },
      ]},
    ],
  },
  {
    id: 'troubleshooting', label: 'Troubleshoot', icon: Wrench, color: 'text-orange-400',
    groups: [
      { label: 'Diagnostics', icon: Mic, items: [
        { href: '/sip-trace',     label: 'SIP Trace',      desc: 'Packet-level tracing',   icon: Mic },
        { href: '/rtp-analytics', label: 'RTP Analytics',  desc: 'Media quality analysis', icon: Activity },
        { href: '/replay',        label: 'Replay Engine',  desc: 'Call session replay',    icon: Rewind },
      ]},
      { label: 'Testing', icon: FlaskConical, items: [
        { href: '/test-call',      label: 'Test Call',      desc: 'On-demand test calls',  icon: PhoneCall },
        { href: '/test-campaigns', label: 'Test Campaigns', desc: 'Automated test suites', icon: FlaskConical },
      ]},
      { label: 'Tools', icon: Wrench, items: [
        { href: '/tools',            label: 'Tools',            desc: 'Engineering utilities', icon: Wrench },
        { href: '/network-topology', label: 'Network Topology', desc: 'Topology viewer',       icon: Network },
      ]},
    ],
  },
  {
    id: 'fraud', label: 'Security', icon: ShieldAlert, color: 'text-rose-400',
    groups: [
      { label: 'Fraud', icon: ShieldAlert, items: [
        { href: '/fraud',    label: 'Fraud Engine', desc: 'FAS/IRSF detection', icon: ShieldAlert },
        { href: '/firewall', label: 'Firewall',     desc: 'Auto-blacklist',     icon: Shield },
      ]},
      { label: 'Compliance', icon: Lock, items: [
        { href: '/stir-shaken',  label: 'STIR/SHAKEN',  desc: 'Attestation framework',  icon: Lock },
        { href: '/sla-breaches', label: 'SLA Breaches',  desc: 'Breach tracking',        icon: Zap },
        { href: '/compliance',   label: 'Compliance',    desc: 'Regulatory compliance',  icon: ClipboardList },
        { href: '/audit-log',    label: 'Audit Log',     desc: 'Platform activity log',  icon: FileText },
      ]},
      { label: 'Governance', icon: FileText, items: [
        { href: '/approvals',       label: 'Approvals',  desc: 'Approval queue',   icon: FileText },
        { href: '/call-recordings', label: 'Recordings', desc: 'Call recordings',  icon: Mic },
      ]},
    ],
  },
  {
    id: 'settings', label: 'Settings', icon: Settings, color: 'text-slate-400',
    groups: [
      { label: 'Platform', icon: Settings, items: [
        { href: '/settings',       label: 'Platform Settings', desc: 'System configuration', icon: Settings },
        { href: '/company-profile',label: 'Company Profile',   desc: 'Org details',          icon: Building2 },
        { href: '/vpn-config',     label: 'VPN Config',        desc: 'VPN configuration',    icon: Lock },
      ]},
      { label: 'Team & Access', icon: Users, items: [
        { href: '/team',              label: 'Team',           desc: 'Role & access control',  icon: Users },
        { href: '/api-keys',          label: 'API Keys',       desc: 'API key management',     icon: Key },
        { href: '/approval-settings', label: 'Approval Rules', desc: 'Approval configuration', icon: SlidersHorizontal },
      ]},
      { label: 'Notifications', icon: Mail, items: [
        { href: '/whatsapp-alerts', label: 'WhatsApp Alerts', desc: 'Alert delivery config',   icon: Mail },
        { href: '/email-centre',    label: 'Email Centre',    desc: 'Email notifications',     icon: Mail },
      ]},
      { label: 'Preferences', icon: Layers, items: [
        { href: '/sidebar-settings', label: 'Sidebar Settings', desc: 'Navigation preferences', icon: Layers },
        { href: '/account',          label: 'My Account',        desc: 'Profile & preferences',  icon: Users },
      ]},
    ],
  },
];

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
function CascadeMenu({ domain, onClose, openLeft }: { domain: Domain; onClose: () => void; openLeft?: boolean }) {
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

  return (
    // Outer wrapper catches mouse-leave for the whole cascade (L2 + L3)
    <div className="relative" onMouseLeave={onClose}>
      {/* ── L2 dropdown ── */}
      <div className="py-1.5 min-w-[188px]" style={panelStyle}>
        {domain.groups.map(group => {
          const isActive = activeGroup === group.label;
          return (
            <div
              key={group.label}
              className="relative px-1"
              onMouseEnter={() => enterGroup(group.label)}
              onMouseLeave={leaveGroup}
            >
              <div className={cn(
                "flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-default transition-colors duration-100 select-none",
                isActive
                  ? "bg-white/[0.09] text-foreground"
                  : "text-muted-foreground/70 hover:text-foreground hover:bg-white/[0.05]"
              )}>
                <group.icon className={cn("w-3.5 h-3.5 flex-shrink-0 transition-colors", isActive && domain.color)} />
                <span className="text-[12px] font-medium flex-1 whitespace-nowrap">{group.label}</span>
                <ChevronRight className="w-3 h-3 opacity-40 flex-shrink-0" />
              </div>

              {/* ── L3 submenu ── */}
              {isActive && (
                <div
                  className={cn(
                    "absolute top-0 py-1.5 min-w-[230px]",
                    openLeft ? "right-full mr-1" : "left-full ml-1"
                  )}
                  style={panelStyle}
                  onMouseEnter={stayGroup}
                  onMouseLeave={leaveGroup}
                >
                  {/* Group label header */}
                  <div className="px-3.5 pt-0.5 pb-1.5 mb-0.5 border-b border-white/[0.05]">
                    <span className={cn("text-[9px] font-bold uppercase tracking-widest", domain.color)}>
                      {group.label}
                    </span>
                  </div>
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
  const [location]            = useLocation();
  const search                = useSearch();
  const [openDomain, setOpen] = useState<string | null>(null);
  const closeTimer            = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shellRef              = useRef<HTMLDivElement | null>(null);
  const tabRefs               = useRef<Map<string, HTMLDivElement>>(new Map());
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

  const activeIncidents  = Array.isArray(incidentsRaw) ? incidentsRaw.filter((i: any) => i.status === 'active' || !i.resolvedAt).length : 0;
  const pendingApprovals = pendingCountData?.count ?? 0;
  const notifCount       = activeIncidents + pendingApprovals;
  const liveCallCount    = Array.isArray(liveCallsRaw) ? liveCallsRaw.length : (liveCallsRaw?.calls?.length ?? liveCallsRaw?.count ?? 0);

  if (compact || wallboard) return null;

  const { isOpen: chatOpen, toggle: toggleChat } = useChatDrawer();

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

        {/* ── Centre: domain workspace tabs ── */}
        <nav className="flex items-center gap-0.5 flex-1 min-w-0 overflow-x-auto [&::-webkit-scrollbar]:hidden" role="menubar">
          {DOMAINS.map(domain => {
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
                {/* Active underline */}
                {isActive && (
                  <span className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full bg-gradient-to-r from-violet-400 to-indigo-500 pointer-events-none" />
                )}
                {/* Label → workspace home */}
                <Link
                  href={`/workspace/${domain.id}`}
                  data-testid={`nav-domain-${domain.id}`}
                  onClick={() => setOpen(null)}
                  className="flex items-center gap-1.5 pl-2.5 pr-1 h-full"
                  aria-label={`${domain.label} workspace`}
                >
                  <domain.icon className={cn("w-3.5 h-3.5 flex-shrink-0", isActive ? domain.color : '')} />
                  <span className="hidden lg:inline">{domain.label}</span>
                </Link>
                {/* Chevron → toggle mega panel */}
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

        {/* ── Right zone: global utilities ── */}
        <div className="flex items-center gap-1 ml-2 flex-shrink-0">
          {/* Breadcrumb — only on wide screens */}
          {activeDomain && (
            <div className="hidden xl:flex items-center gap-1 text-[10px] text-muted-foreground/40 mr-2">
              <span className={cn("font-semibold", activeDomain.color)}>{activeDomain.label}</span>
              <ChevronRight className="w-3 h-3" />
              <span className="text-muted-foreground/60">{meta.label}</span>
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
            <CascadeMenu domain={domain} onClose={() => setOpen(null)} openLeft={openLeft} />
          </div>
        );
      })()}
    </div>
  );
}
