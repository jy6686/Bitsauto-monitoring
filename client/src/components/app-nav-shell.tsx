import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useLocation, useSearch } from "wouter";
import {
  Radio, Users, Wifi, GitBranch, BarChart2,
  Wrench, ShieldAlert, Settings, ChevronRight,
  Activity, Globe, Phone, PhoneCall, Server,
  LineChart, Eye, Monitor, Database, Network,
  HardDrive, Layers, Calculator, Route, FlaskConical,
  Shield, FileText, Lock, TrendingDown, History,
  LayoutDashboard, Zap, Map, BarChart3, Brain,
  SlidersHorizontal, Key, Mail, Building2, Wallet,
  HeartPulse, Mic, Bot, ClipboardList, ArrowRightLeft,
  FileSpreadsheet, Rewind, Upload, Star, Package,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Domain taxonomy ────────────────────────────────────────────────────────────
interface Module { href: string; label: string; desc: string; icon: React.ComponentType<{ className?: string }> }
interface Domain  { id: string; label: string; icon: React.ComponentType<{ className?: string }>; color: string; modules: Module[] }

const DOMAINS: Domain[] = [
  {
    id: 'live-ops', label: 'Live Ops', icon: Radio, color: 'text-violet-400',
    modules: [
      { href: '/bitseye2',         label: 'BitsEye 2',      desc: 'Live topology observatory', icon: Eye },
      { href: '/live-traffic',     label: 'Live Traffic',   desc: 'Active call stream',        icon: Activity },
      { href: '/traffic-map',      label: 'Traffic Map',    desc: 'Geographic call view',      icon: Globe },
      { href: '/',                 label: 'Dashboard',      desc: 'Platform overview',         icon: LayoutDashboard },
      { href: '/graphs',           label: 'Graphs',         desc: 'Performance charts',        icon: LineChart },
      { href: '/multi-switch',     label: 'Multi-Switch',   desc: 'Consolidated switch view',  icon: Layers },
      { href: '/noc-command',      label: 'NOC Command',    desc: 'Command center',            icon: Monitor },
      { href: '/ops-console',      label: 'Ops Console',    desc: 'Unified operations',        icon: SlidersHorizontal },
      { href: '/console',          label: 'Console',        desc: 'Logs & debug shell',        icon: Database },
      { href: '/server-monitoring',label: 'Server Monitor', desc: 'Infrastructure health',     icon: Server },
      { href: '/sbc-monitor',      label: 'SBC Monitor',    desc: 'Session border controller', icon: HardDrive },
      { href: '/alerts',           label: 'Alerts',         desc: 'Platform alerts',           icon: Zap },
    ],
  },
  {
    id: 'clients', label: 'Clients', icon: Users, color: 'text-amber-400',
    modules: [
      { href: '/clients',         label: 'Accounts',      desc: 'Client management',       icon: Users },
      { href: '/client-portal',   label: 'Client Portal', desc: 'Self-service access',     icon: Building2 },
      { href: '/reseller',        label: 'Reseller',      desc: 'Partner accounts',        icon: Star },
      { href: '/billing',         label: 'Billing',       desc: 'Payments & invoices',     icon: Wallet },
      { href: '/billing-disputes',label: 'Disputes',      desc: 'Dispute resolution',      icon: ClipboardList },
      { href: '/dids',            label: 'DIDs',          desc: 'Number inventory',        icon: Phone },
      { href: '/account-names',   label: 'Account Names', desc: 'Account naming',          icon: FileText },
    ],
  },
  {
    id: 'vendors', label: 'Vendors', icon: Wifi, color: 'text-cyan-400',
    modules: [
      { href: '/vendors',              label: 'Vendor List',      desc: 'Carrier management',      icon: Wifi },
      { href: '/vendor-sla-scorecard', label: 'SLA Scorecard',    desc: 'Carrier performance',     icon: HeartPulse },
      { href: '/carrier-scoring',      label: 'Carrier Scoring',  desc: 'Quality benchmarks',      icon: Star },
      { href: '/carrier-intelligence', label: 'Carrier Intel',    desc: 'Market intelligence',     icon: Brain },
      { href: '/balance',              label: 'Balance Monitor',  desc: 'Vendor balances',         icon: Wallet },
      { href: '/products',             label: 'Products',         desc: 'Product catalogue',       icon: Package },
      { href: '/rate-cards',           label: 'Rate Cards',       desc: 'Pricing management',      icon: FileSpreadsheet },
    ],
  },
  {
    id: 'routing', label: 'Routing', icon: GitBranch, color: 'text-emerald-400',
    modules: [
      { href: '/routing-manager',     label: 'Routing Manager',    desc: 'Groups & connections',     icon: GitBranch },
      { href: '/lcr-analyser',        label: 'LCR Analyser',       desc: 'Least-cost routing',       icon: Calculator },
      { href: '/call-flow-simulator', label: 'Call Flow Sim',      desc: 'Route simulation',         icon: ArrowRightLeft },
      { href: '/routing-intelligence',label: 'Routing Intel',      desc: 'Intelligent routing',      icon: Brain },
      { href: '/number-intelligence', label: 'Number Intel',       desc: 'Number analysis',          icon: Phone },
      { href: '/cost-optimisation',   label: 'Cost Optimisation',  desc: 'Route cost engine',        icon: TrendingDown },
    ],
  },
  {
    id: 'reports', label: 'Reports', icon: BarChart2, color: 'text-blue-400',
    modules: [
      { href: '/reports',          label: 'Reports',          desc: 'Report centre',         icon: BarChart2 },
      { href: '/asr-acd',          label: 'ASR / ACD',        desc: 'Call quality reports',  icon: BarChart3 },
      { href: '/analytics',        label: 'Analytics',        desc: 'Traffic analytics',     icon: LineChart },
      { href: '/cdrs',             label: 'CDRs',             desc: 'Call detail records',   icon: History },
      { href: '/revenue-heatmap',  label: 'Revenue Heatmap',  desc: 'Revenue analysis',      icon: Map },
      { href: '/traffic-forecast', label: 'Traffic Forecast', desc: 'Demand forecasting',    icon: TrendingDown },
      { href: '/audit-log',        label: 'Audit Log',        desc: 'Platform activity log', icon: FileText },
      { href: '/qos-heatmap',      label: 'QoS Heatmap',      desc: 'Quality of service',    icon: HeartPulse },
    ],
  },
  {
    id: 'troubleshooting', label: 'Troubleshooting', icon: Wrench, color: 'text-orange-400',
    modules: [
      { href: '/sip-trace',    label: 'SIP Trace',     desc: 'Packet-level tracing',   icon: Mic },
      { href: '/rtp-analytics',label: 'RTP Analytics', desc: 'Media quality analysis', icon: Activity },
      { href: '/replay',       label: 'Replay Engine', desc: 'Call session replay',    icon: Rewind },
      { href: '/test-call',    label: 'Test Call',     desc: 'On-demand test calls',   icon: PhoneCall },
      { href: '/test-campaigns',label: 'Test Campaigns',desc: 'Automated test suites', icon: FlaskConical },
      { href: '/tools',        label: 'Tools',         desc: 'Engineering utilities',  icon: Wrench },
      { href: '/network-topology',label: 'Network Topology',desc: 'Topology viewer',  icon: Network },
      { href: '/ai-ops',       label: 'AIOps',         desc: 'AI-assisted operations', icon: Bot },
    ],
  },
  {
    id: 'fraud', label: 'Fraud', icon: ShieldAlert, color: 'text-rose-400',
    modules: [
      { href: '/fraud',        label: 'Fraud Engine',  desc: 'FAS/IRSF detection',    icon: ShieldAlert },
      { href: '/firewall',     label: 'Firewall',      desc: 'Auto-blacklist',         icon: Shield },
      { href: '/stir-shaken',  label: 'STIR/SHAKEN',   desc: 'Attestation framework',  icon: Lock },
      { href: '/sla-breaches', label: 'SLA Breaches',  desc: 'Breach tracking',        icon: Zap },
      { href: '/compliance',   label: 'Compliance',    desc: 'Regulatory compliance',  icon: ClipboardList },
      { href: '/approvals',    label: 'Approvals',     desc: 'Approval queue',         icon: FileText },
      { href: '/intelligence', label: 'Intelligence',  desc: 'Threat intelligence',    icon: Brain },
    ],
  },
  {
    id: 'settings', label: 'Settings', icon: Settings, color: 'text-slate-400',
    modules: [
      { href: '/settings',          label: 'Platform Settings', desc: 'System configuration',   icon: Settings },
      { href: '/team',              label: 'Team',              desc: 'Role & access control',   icon: Users },
      { href: '/company-profile',   label: 'Company Profile',   desc: 'Org details',             icon: Building2 },
      { href: '/api-keys',          label: 'API Keys',          desc: 'API key management',      icon: Key },
      { href: '/approval-settings', label: 'Approval Rules',    desc: 'Approval configuration',  icon: SlidersHorizontal },
      { href: '/whatsapp-alerts',   label: 'WhatsApp Alerts',   desc: 'Alert delivery config',   icon: Mail },
      { href: '/email-centre',      label: 'Email Centre',      desc: 'Email notifications',     icon: Mail },
      { href: '/sidebar-settings',  label: 'Sidebar Settings',  desc: 'Navigation preferences',  icon: Layers },
      { href: '/vpn-config',        label: 'VPN Config',        desc: 'VPN configuration',       icon: Lock },
    ],
  },
];

// ── Route → domain + breadcrumb label ─────────────────────────────────────────
const ROUTE_META: Record<string, { domain: string; label: string }> = {};
for (const d of DOMAINS) {
  for (const m of d.modules) {
    if (!ROUTE_META[m.href]) ROUTE_META[m.href] = { domain: d.id, label: m.label };
  }
}
// Fallback: path segments not explicitly listed
function inferMeta(path: string): { domain: string; label: string } {
  const direct = ROUTE_META[path];
  if (direct) return direct;
  for (const prefix of Object.keys(ROUTE_META).sort((a, b) => b.length - a.length)) {
    if (path.startsWith(prefix + '/')) return { ...ROUTE_META[prefix], label: ROUTE_META[prefix].label };
  }
  return { domain: 'live-ops', label: 'Dashboard' };
}

// ── Mega panel ─────────────────────────────────────────────────────────────────
function MegaPanel({ domain, onClose }: { domain: Domain; onClose: () => void }) {
  return (
    <div
      className="absolute left-0 right-0 top-full z-[100] border-b border-white/[0.07]"
      style={{
        background: 'hsl(var(--background)/0.97)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        boxShadow: '0 16px 48px rgba(0,0,0,0.35)',
      }}
      onMouseLeave={onClose}
    >
      <div className="max-w-7xl mx-auto px-6 py-5">
        {/* Domain header */}
        <div className="flex items-center gap-2 mb-4">
          <domain.icon className={cn("w-4 h-4", domain.color)} />
          <span className={cn("text-xs font-bold uppercase tracking-widest", domain.color)}>{domain.label}</span>
        </div>
        {/* Module grid — 4 columns */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {domain.modules.map(mod => (
            <Link
              key={mod.href}
              href={mod.href}
              onClick={onClose}
              data-testid={`nav-module-${mod.href.replace(/\//g, '-')}`}
            >
              <div className={cn(
                "group flex items-start gap-3 p-3 rounded-xl cursor-pointer transition-all duration-150",
                "hover:bg-white/[0.06] border border-transparent hover:border-white/[0.07]"
              )}>
                <div className={cn(
                  "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5",
                  "bg-white/[0.04] group-hover:bg-white/[0.08] transition-colors"
                )}>
                  <mod.icon className={cn("w-4 h-4", domain.color)} />
                </div>
                <div className="min-w-0">
                  <div className="text-[12px] font-semibold text-foreground leading-tight truncate">{mod.label}</div>
                  <div className="text-[10px] text-muted-foreground/60 leading-tight mt-0.5 line-clamp-1">{mod.desc}</div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── AppNavShell ────────────────────────────────────────────────────────────────
export function AppNavShell() {
  const [location]            = useLocation();
  const search                = useSearch();
  const [openDomain, setOpen] = useState<string | null>(null);
  const closeTimer            = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hide in compact / wallboard mode
  const compact = new URLSearchParams(search).get('compact') === '1';
  const wallboard = typeof document !== 'undefined' && document.body.dataset.wallboard === '1';
  if (compact || wallboard) return null;

  const meta = inferMeta(location);

  const scheduleClose = useCallback(() => {
    closeTimer.current = setTimeout(() => setOpen(null), 180);
  }, []);
  const cancelClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  // Escape key closes panel
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const activeDomain = DOMAINS.find(d => d.id === meta.domain);

  return (
    <div className="relative z-50 flex-shrink-0">
      {/* ── Top bar ── */}
      <div
        className="flex items-center h-[44px] px-4 border-b"
        style={{
          background: 'hsl(var(--background)/0.92)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderColor: 'rgba(255,255,255,0.06)',
        }}
      >
        {/* Logo mark */}
        <div className="flex items-center gap-2 mr-6 flex-shrink-0">
          <Activity className="w-4 h-4 text-indigo-400" />
          <span className="text-[11px] font-bold tracking-widest text-foreground/80 uppercase">Bitsauto</span>
        </div>

        {/* Domain tabs */}
        <nav className="flex items-center gap-0.5 flex-1 min-w-0" role="menubar">
          {DOMAINS.map(domain => {
            const isActive = meta.domain === domain.id;
            const isOpen   = openDomain === domain.id;
            return (
              <button
                key={domain.id}
                role="menuitem"
                data-testid={`nav-domain-${domain.id}`}
                className={cn(
                  "relative flex items-center gap-1.5 h-[36px] px-3 rounded-lg text-[11px] font-semibold transition-all duration-150 whitespace-nowrap flex-shrink-0",
                  isActive || isOpen
                    ? "text-foreground bg-white/[0.08]"
                    : "text-muted-foreground/60 hover:text-foreground hover:bg-white/[0.05]"
                )}
                onMouseEnter={() => { cancelClose(); setOpen(domain.id); }}
                onMouseLeave={scheduleClose}
                onClick={() => setOpen(openDomain === domain.id ? null : domain.id)}
                aria-haspopup="true"
                aria-expanded={isOpen}
              >
                {/* Active domain underline */}
                {isActive && (
                  <span className="absolute bottom-0 left-3 right-3 h-[2px] rounded-full bg-gradient-to-r from-violet-400 to-indigo-500" />
                )}
                <domain.icon className={cn("w-3.5 h-3.5", isActive ? domain.color : '')} />
                <span>{domain.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Right: breadcrumb compact trail */}
        <div className="hidden lg:flex items-center gap-1 text-[10px] text-muted-foreground/40 ml-4 flex-shrink-0">
          {activeDomain && (
            <>
              <span className={cn("font-semibold", activeDomain.color)}>{activeDomain.label}</span>
              <ChevronRight className="w-3 h-3" />
              <span className="text-muted-foreground/60">{meta.label}</span>
            </>
          )}
        </div>
      </div>

      {/* ── Mega panel ── */}
      {openDomain && (
        <div
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          {DOMAINS.filter(d => d.id === openDomain).map(d => (
            <MegaPanel key={d.id} domain={d} onClose={() => setOpen(null)} />
          ))}
        </div>
      )}
    </div>
  );
}
