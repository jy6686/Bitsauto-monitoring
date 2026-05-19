import { useEffect, useState, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput,
  CommandItem, CommandList, CommandSeparator,
} from "@/components/ui/command";
import {
  LayoutDashboard, Phone, Bell, Settings, BarChart2, Users, Building2,
  ShieldAlert, FileText, Wrench, Globe, Wallet, Server, Eye, Key,
  LineChart, Search, MessageSquare, Layers, Monitor, SlidersHorizontal,
  Database, HardDrive, GitBranch, Calculator, ArrowRightLeft, Brain,
  TrendingDown, TrendingUp, BarChart3, History, Map, HeartPulse,
  PhoneCall, FlaskConical, Network, Bot, Shield, Lock, Zap,
  ClipboardList, Mail, Star, Package, CreditCard, Activity,
  Mic, Rewind, Clock,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

// ── Centralized route registry ─────────────────────────────────────────────────
interface RouteEntry {
  type: 'route';
  domain: string;
  domainColor: string;
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  keywords?: string;
  roles?: string[];
}

export const ROUTE_REGISTRY: RouteEntry[] = [
  // Live Ops
  { type: 'route', domain: 'Live Ops',        domainColor: 'text-violet-400', label: 'BitsEye 2',           href: '/bitseye2',          icon: Eye,            keywords: 'live topology observatory noc' },
  { type: 'route', domain: 'Live Ops',        domainColor: 'text-violet-400', label: 'Live Traffic',         href: '/live-traffic',       icon: Activity,       keywords: 'active calls stream concurrent' },
  { type: 'route', domain: 'Live Ops',        domainColor: 'text-violet-400', label: 'Traffic Map',          href: '/traffic-map',        icon: Globe,          keywords: 'geographic world map' },
  { type: 'route', domain: 'Live Ops',        domainColor: 'text-violet-400', label: 'Dashboard',            href: '/',                   icon: LayoutDashboard,keywords: 'home overview summary' },
  { type: 'route', domain: 'Live Ops',        domainColor: 'text-violet-400', label: 'Alerts',               href: '/alerts',             icon: Bell },
  { type: 'route', domain: 'Live Ops',        domainColor: 'text-violet-400', label: 'Graphs',               href: '/graphs',             icon: LineChart,      keywords: 'performance charts metrics' },
  { type: 'route', domain: 'Live Ops',        domainColor: 'text-violet-400', label: 'Multi-Switch',         href: '/multi-switch',       icon: Layers,         keywords: 'consolidated switch view' },
  { type: 'route', domain: 'Live Ops',        domainColor: 'text-violet-400', label: 'NOC Command',          href: '/noc-command',        icon: Monitor },
  { type: 'route', domain: 'Live Ops',        domainColor: 'text-violet-400', label: 'Ops Console',          href: '/ops-console',        icon: SlidersHorizontal },
  { type: 'route', domain: 'Live Ops',        domainColor: 'text-violet-400', label: 'Console',              href: '/console',            icon: Database,       keywords: 'logs debug shell terminal' },
  { type: 'route', domain: 'Live Ops',        domainColor: 'text-violet-400', label: 'Server Monitor',       href: '/server-monitoring',  icon: Server,         keywords: 'infrastructure health uptime' },
  { type: 'route', domain: 'Live Ops',        domainColor: 'text-violet-400', label: 'SBC Monitor',          href: '/sbc-monitor',        icon: HardDrive,      keywords: 'session border controller' },
  // Clients
  { type: 'route', domain: 'Clients',         domainColor: 'text-amber-400',  label: 'Accounts',             href: '/clients',            icon: Users,          keywords: 'client management accounts' },
  { type: 'route', domain: 'Clients',         domainColor: 'text-amber-400',  label: 'Client Portal',        href: '/client-portal',      icon: Building2,      keywords: 'self service portal' },
  { type: 'route', domain: 'Clients',         domainColor: 'text-amber-400',  label: 'Reseller',             href: '/reseller',           icon: Star,           keywords: 'partner accounts' },
  { type: 'route', domain: 'Clients',         domainColor: 'text-amber-400',  label: 'Billing',              href: '/billing',            icon: Wallet,         keywords: 'payments invoices' },
  { type: 'route', domain: 'Clients',         domainColor: 'text-amber-400',  label: 'Billing Disputes',     href: '/billing-disputes',   icon: ClipboardList },
  { type: 'route', domain: 'Clients',         domainColor: 'text-amber-400',  label: 'DIDs',                 href: '/dids',               icon: Phone,          keywords: 'number inventory did management' },
  { type: 'route', domain: 'Clients',         domainColor: 'text-amber-400',  label: 'Account Names',        href: '/account-names',      icon: FileText },
  // Vendors
  { type: 'route', domain: 'Vendors',         domainColor: 'text-cyan-400',   label: 'Vendor List',          href: '/vendors',            icon: Wrench,         keywords: 'carriers vendor connections' },
  { type: 'route', domain: 'Vendors',         domainColor: 'text-cyan-400',   label: 'Vendor SLA Scorecard', href: '/vendor-sla-scorecard',icon: HeartPulse,    keywords: 'carrier performance sla' },
  { type: 'route', domain: 'Vendors',         domainColor: 'text-cyan-400',   label: 'Carrier Scoring',      href: '/carrier-scoring',    icon: Star,           keywords: 'quality benchmarks' },
  { type: 'route', domain: 'Vendors',         domainColor: 'text-cyan-400',   label: 'Carrier Intelligence', href: '/carrier-intelligence',icon: Brain,         keywords: 'market intelligence carrier' },
  { type: 'route', domain: 'Vendors',         domainColor: 'text-cyan-400',   label: 'Balance Monitor',      href: '/balance',            icon: Wallet,         keywords: 'vendor balances account' },
  { type: 'route', domain: 'Vendors',         domainColor: 'text-cyan-400',   label: 'Products',             href: '/products',           icon: Package,        keywords: 'product catalogue trunk' },
  { type: 'route', domain: 'Vendors',         domainColor: 'text-cyan-400',   label: 'Rate Cards',           href: '/rate-cards',         icon: CreditCard,     keywords: 'pricing rate management' },
  // Routing
  { type: 'route', domain: 'Routing',         domainColor: 'text-emerald-400',label: 'Routing Manager',      href: '/routing-manager',    icon: GitBranch,      keywords: 'groups connections routing lcr' },
  { type: 'route', domain: 'Routing',         domainColor: 'text-emerald-400',label: 'LCR Analyser',         href: '/lcr-analyser',       icon: Calculator,     keywords: 'least cost routing lcr' },
  { type: 'route', domain: 'Routing',         domainColor: 'text-emerald-400',label: 'Call Flow Simulator',  href: '/call-flow-simulator',icon: ArrowRightLeft, keywords: 'route simulation call flow' },
  { type: 'route', domain: 'Routing',         domainColor: 'text-emerald-400',label: 'Routing Intelligence', href: '/routing-intelligence',icon: Brain,         keywords: 'intelligent routing' },
  { type: 'route', domain: 'Routing',         domainColor: 'text-emerald-400',label: 'Number Intelligence',  href: '/number-intelligence',icon: Phone,          keywords: 'number analysis cli cld' },
  { type: 'route', domain: 'Routing',         domainColor: 'text-emerald-400',label: 'Cost Optimisation',    href: '/cost-optimisation',  icon: TrendingDown,   keywords: 'route cost engine optimise' },
  // Reports
  { type: 'route', domain: 'Reports',         domainColor: 'text-blue-400',   label: 'Reports',              href: '/reports',            icon: BarChart2 },
  { type: 'route', domain: 'Reports',         domainColor: 'text-blue-400',   label: 'ASR / ACD',            href: '/asr-acd',            icon: BarChart3,      keywords: 'answer seizure ratio call quality asr acd' },
  { type: 'route', domain: 'Reports',         domainColor: 'text-blue-400',   label: 'Revenue Analytics',    href: '/analytics',          icon: TrendingUp,     keywords: 'revenue margin analytics' },
  { type: 'route', domain: 'Reports',         domainColor: 'text-blue-400',   label: 'CDRs',                 href: '/cdrs',               icon: History,        keywords: 'call detail records cdr viewer' },
  { type: 'route', domain: 'Reports',         domainColor: 'text-blue-400',   label: 'Revenue Heatmap',      href: '/revenue-heatmap',    icon: Map },
  { type: 'route', domain: 'Reports',         domainColor: 'text-blue-400',   label: 'Traffic Forecast',     href: '/traffic-forecast',   icon: TrendingUp,     keywords: 'demand forecast prediction' },
  { type: 'route', domain: 'Reports',         domainColor: 'text-blue-400',   label: 'Audit Log',            href: '/audit-log',          icon: FileText,       keywords: 'activity log audit trail' },
  { type: 'route', domain: 'Reports',         domainColor: 'text-blue-400',   label: 'QoS Heatmap',          href: '/qos-heatmap',        icon: HeartPulse,     keywords: 'quality of service qos' },
  // Troubleshooting
  { type: 'route', domain: 'Troubleshooting', domainColor: 'text-orange-400', label: 'SIP Trace',            href: '/sip-trace',          icon: Mic,            keywords: 'packet sip trace debug' },
  { type: 'route', domain: 'Troubleshooting', domainColor: 'text-orange-400', label: 'RTP Analytics',        href: '/rtp-analytics',      icon: Activity,       keywords: 'rtp media quality jitter mos' },
  { type: 'route', domain: 'Troubleshooting', domainColor: 'text-orange-400', label: 'Replay Engine',        href: '/replay',             icon: Rewind,         keywords: 'call session replay pcap' },
  { type: 'route', domain: 'Troubleshooting', domainColor: 'text-orange-400', label: 'Test Call',            href: '/test-call',          icon: PhoneCall,      keywords: 'test call on demand' },
  { type: 'route', domain: 'Troubleshooting', domainColor: 'text-orange-400', label: 'Test Campaigns',       href: '/test-campaigns',     icon: FlaskConical,   keywords: 'automated test suite campaign' },
  { type: 'route', domain: 'Troubleshooting', domainColor: 'text-orange-400', label: 'Tools',                href: '/tools',              icon: Wrench,         keywords: 'engineering utilities calculator dial' },
  { type: 'route', domain: 'Troubleshooting', domainColor: 'text-orange-400', label: 'Network Topology',     href: '/network-topology',   icon: Network },
  { type: 'route', domain: 'Troubleshooting', domainColor: 'text-orange-400', label: 'AIOps',                href: '/ai-ops',             icon: Bot,            keywords: 'ai assisted operations aiops' },
  // Fraud
  { type: 'route', domain: 'Fraud',           domainColor: 'text-rose-400',   label: 'Fraud Engine',         href: '/fraud',              icon: ShieldAlert,    keywords: 'fas irsf detection fraud' },
  { type: 'route', domain: 'Fraud',           domainColor: 'text-rose-400',   label: 'Firewall',             href: '/firewall',           icon: Shield,         keywords: 'auto blacklist block' },
  { type: 'route', domain: 'Fraud',           domainColor: 'text-rose-400',   label: 'STIR/SHAKEN',          href: '/stir-shaken',        icon: Lock,           keywords: 'attestation stir shaken' },
  { type: 'route', domain: 'Fraud',           domainColor: 'text-rose-400',   label: 'SLA Breaches',         href: '/sla-breaches',       icon: Zap,            keywords: 'sla breach tracking' },
  { type: 'route', domain: 'Fraud',           domainColor: 'text-rose-400',   label: 'Compliance',           href: '/compliance',         icon: ClipboardList },
  { type: 'route', domain: 'Fraud',           domainColor: 'text-rose-400',   label: 'Approval Queue',       href: '/approvals',          icon: FileText,       keywords: 'approval queue pending' },
  { type: 'route', domain: 'Fraud',           domainColor: 'text-rose-400',   label: 'Intelligence',         href: '/intelligence',       icon: Brain,          keywords: 'threat intelligence' },
  // Settings
  { type: 'route', domain: 'Settings',        domainColor: 'text-slate-400',  label: 'Platform Settings',    href: '/settings',           icon: Settings,       roles: ['admin'], keywords: 'system configuration settings' },
  { type: 'route', domain: 'Settings',        domainColor: 'text-slate-400',  label: 'Team & Roles',         href: '/team',               icon: Users,          roles: ['admin'], keywords: 'role access control team' },
  { type: 'route', domain: 'Settings',        domainColor: 'text-slate-400',  label: 'Company Profile',      href: '/company-profile',    icon: Building2 },
  { type: 'route', domain: 'Settings',        domainColor: 'text-slate-400',  label: 'API Keys',             href: '/api-keys',           icon: Key,            roles: ['admin'], keywords: 'api key integration external' },
  { type: 'route', domain: 'Settings',        domainColor: 'text-slate-400',  label: 'Approval Rules',       href: '/approval-settings',  icon: SlidersHorizontal },
  { type: 'route', domain: 'Settings',        domainColor: 'text-slate-400',  label: 'WhatsApp Alerts',      href: '/whatsapp-alerts',    icon: MessageSquare },
  { type: 'route', domain: 'Settings',        domainColor: 'text-slate-400',  label: 'Email Centre',         href: '/email-centre',       icon: Mail },
  { type: 'route', domain: 'Settings',        domainColor: 'text-slate-400',  label: 'Sidebar Settings',     href: '/sidebar-settings',   icon: Layers,         keywords: 'navigation preferences' },
  { type: 'route', domain: 'Settings',        domainColor: 'text-slate-400',  label: 'Notification Centre',  href: '/notification-centre',icon: Bell },
];

// ── Entity dim metadata ────────────────────────────────────────────────────────
const DIM_META = {
  client:      { label: 'Clients',      color: 'text-amber-400'   },
  vendor:      { label: 'Vendors',      color: 'text-cyan-400'    },
  country:     { label: 'Countries',    color: 'text-emerald-400' },
  destination: { label: 'Destinations', color: 'text-orange-400'  },
} as const;

type Dim = keyof typeof DIM_META;

interface SliceEntity { name: string; active: number; idle?: boolean; }
interface SliceResponse { entities: SliceEntity[]; }

interface EntityResult {
  dim: Dim; dimLabel: string; dimColor: string;
  name: string; active: number; idle: boolean;
}

// ── Recent pages ───────────────────────────────────────────────────────────────
const RECENT_KEY = 'bitsauto-recent-pages';
const MAX_RECENT = 6;

function getRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); }
  catch { return []; }
}
function pushRecent(href: string) {
  const next = [href, ...getRecent().filter(h => h !== href)].slice(0, MAX_RECENT);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
}

// ── Domain display order ───────────────────────────────────────────────────────
const DOMAIN_ORDER = ['Live Ops', 'Clients', 'Vendors', 'Routing', 'Reports', 'Troubleshooting', 'Fraud', 'Settings'];

// ── Semantic aliases ────────────────────────────────────────────────────────────
// Short codes that expand silently to full search terms.
// Operators under pressure type bd, pk, noc — aliases resolve instantly.
const ALIASES: Record<string, string> = {
  // ISO country codes → country names as they appear in Sippy entity lists
  bd: 'bangladesh',
  pk: 'pakistan',
  sa: 'saudi arabia',
  ae: 'uae',
  kw: 'kuwait',
  qa: 'qatar',
  bh: 'bahrain',
  om: 'oman',
  iq: 'iraq',
  sy: 'syria',
  jo: 'jordan',
  lb: 'lebanon',
  eg: 'egypt',
  ng: 'nigeria',
  gh: 'ghana',
  ke: 'kenya',
  ug: 'uganda',
  tz: 'tanzania',
  et: 'ethiopia',
  zm: 'zambia',
  in: 'india',
  lk: 'sri lanka',
  np: 'nepal',
  af: 'afghanistan',
  // Common alternate names
  uk: 'united kingdom',
  gb: 'united kingdom',
  us: 'united states',
  usa: 'united states',
  de: 'germany',
  fr: 'france',
  au: 'australia',
  ca: 'canada',
  // Platform module shortcuts
  noc: 'bitseye',
  live: 'live ops',
  acct: 'accounts',
  rev: 'revenue',
  cdr: 'cdrs',
  lcr: 'lcr analyser',
  sip: 'sip trace',
  rtp: 'rtp analytics',
  fas: 'fraud',
  irsf: 'fraud',
  bl: 'firewall',
  fw: 'firewall',
  bal: 'balance',
  rpt: 'reports',
  rg: 'routing manager',
  tst: 'test call',
  kpi: 'asr',
  asr: 'asr',
  mos: 'qos',
  pdd: 'asr',
};

// ── Alias priority weights ──────────────────────────────────────────────────────
// When a token is a module-alias, route results surface first (operator intends a tool).
// Country/entity aliases keep the default (entities first).
// ── Scope chip styles — per entity-dim and route-domain ──────────────────────
const SCOPE_CHIPS: Record<string, { label: string; bg: string; fg: string }> = {
  // Entity dimensions
  'Countries':        { label: 'COUNTRY',   bg: 'rgba(56,189,248,0.12)',  fg: '#38BDF8' },
  'Clients':          { label: 'CLIENT',    bg: 'rgba(167,139,250,0.12)', fg: '#A78BFA' },
  'Vendors':          { label: 'VENDOR',    bg: 'rgba(251,191,36,0.12)',  fg: '#FBBF24' },
  'Destination Sets': { label: 'DEST SET',  bg: 'rgba(45,212,191,0.12)',  fg: '#2DD4BF' },
  // Route domains
  'Live Ops':         { label: 'LIVE',      bg: 'rgba(52,211,153,0.12)',  fg: '#34D399' },
  'Analytics':        { label: 'ANALYTICS', bg: 'rgba(34,211,238,0.12)',  fg: '#22D3EE' },
  'Reports':          { label: 'REPORTS',   bg: 'rgba(99,102,241,0.12)',  fg: '#818CF8' },
  'Troubleshooting':  { label: 'TOOLING',   bg: 'rgba(251,113,133,0.12)', fg: '#FB7185' },
  'Routing':          { label: 'ROUTING',   bg: 'rgba(251,146,60,0.12)',  fg: '#FB923C' },
  'Fraud & Security': { label: 'FRAUD',     bg: 'rgba(239,68,68,0.12)',   fg: '#F87171' },
  'Management':       { label: 'MGMT',      bg: 'rgba(148,163,184,0.12)', fg: '#94A3B8' },
  'Platform':         { label: 'PLATFORM',  bg: 'rgba(192,132,252,0.12)', fg: '#C084FC' },
};

function ScopeHeading({ label }: { label: string }) {
  const chip = SCOPE_CHIPS[label];
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <span>{label}</span>
      {chip && (
        <span style={{
          fontSize: 9, fontWeight: 800, letterSpacing: '0.08em',
          padding: '1px 5px', borderRadius: 3,
          background: chip.bg, color: chip.fg,
          lineHeight: 1.6, flexShrink: 0,
        }}>{chip.label}</span>
      )}
    </span>
  );
}

const ALIAS_PRIORITY: Record<string, 'route'> = {
  noc: 'route', live: 'route', acct: 'route', rev: 'route',
  cdr: 'route', lcr: 'route', sip: 'route',  rtp: 'route',
  fas: 'route', irsf: 'route', bl: 'route',  fw: 'route',
  bal: 'route', rpt: 'route', rg: 'route',   tst: 'route',
  kpi: 'route', asr: 'route', mos: 'route',  pdd: 'route',
};

// ── @scope deterministic filter map ──────────────────────────────────────────
// Tokens starting with '@' pin results to a specific dimension or domain.
// e.g. "@country bd" → only Countries group; "@tooling sip" → only Troubleshooting
const SCOPE_FILTER_MAP: Record<string, { type: 'entity' | 'route'; key: string }> = {
  '@country':    { type: 'entity', key: 'Countries' },
  '@geo':        { type: 'entity', key: 'Countries' },
  '@client':     { type: 'entity', key: 'Clients' },
  '@vendor':     { type: 'entity', key: 'Vendors' },
  '@dest':       { type: 'entity', key: 'Destination Sets' },
  '@live':       { type: 'route',  key: 'Live Ops' },
  '@noc':        { type: 'route',  key: 'Live Ops' },
  '@analytics':  { type: 'route',  key: 'Analytics' },
  '@reports':    { type: 'route',  key: 'Reports' },
  '@rpt':        { type: 'route',  key: 'Reports' },
  '@tooling':    { type: 'route',  key: 'Troubleshooting' },
  '@debug':      { type: 'route',  key: 'Troubleshooting' },
  '@routing':    { type: 'route',  key: 'Routing' },
  '@lcr':        { type: 'route',  key: 'Routing' },
  '@fraud':      { type: 'route',  key: 'Fraud & Security' },
  '@fas':        { type: 'route',  key: 'Fraud & Security' },
  '@settings':   { type: 'route',  key: 'Settings' },
  '@mgmt':       { type: 'route',  key: 'Management' },
};

// ── CommandBar ─────────────────────────────────────────────────────────────────
export function CommandBar() {
  const [open, setOpen]   = useState(false);
  const [query, setQuery] = useState('');
  const [, setLocation]   = useLocation();
  const { role }          = useAuth();
  const [recent, setRecent] = useState<string[]>([]);

  // Refresh recent list when dialog opens
  useEffect(() => { if (open) setRecent(getRecent()); }, [open]);

  // ── Live entity queries — enabled only when dialog is open
  const { data: clientData }  = useQuery<SliceResponse>({ queryKey: ['/api/bitseye/live-slice?groupBy=client'],      enabled: open, staleTime: 20_000 });
  const { data: vendorData }  = useQuery<SliceResponse>({ queryKey: ['/api/bitseye/live-slice?groupBy=vendor'],      enabled: open, staleTime: 20_000 });
  const { data: countryData } = useQuery<SliceResponse>({ queryKey: ['/api/bitseye/live-slice?groupBy=country'],     enabled: open, staleTime: 20_000 });
  const { data: destData }    = useQuery<SliceResponse>({ queryKey: ['/api/bitseye/live-slice?groupBy=destination'], enabled: open, staleTime: 20_000 });

  // Flatten all entities into a single ranked list
  const allEntities = useMemo<EntityResult[]>(() => {
    const results: EntityResult[] = [];
    const add = (data: SliceResponse | undefined, dim: Dim) => {
      if (!data?.entities) return;
      const meta = DIM_META[dim];
      for (const e of data.entities) {
        results.push({ dim, dimLabel: meta.label, dimColor: meta.color, name: e.name, active: e.active ?? 0, idle: e.idle ?? false });
      }
    };
    add(clientData, 'client'); add(vendorData, 'vendor');
    add(countryData, 'country'); add(destData, 'destination');
    return results;
  }, [clientData, vendorData, countryData, destData]);

  // ── Keyboard shortcut: ⌘K / Ctrl+K
  const toggle = useCallback(() => { setOpen(o => !o); setQuery(''); }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); toggle(); } };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [toggle]);

  const navigate = (href: string) => {
    pushRecent(href);
    setRecent(getRecent());
    setOpen(false);
    setQuery('');
    setLocation(href);
  };

  const q = query.trim().toLowerCase();

  // ── Token parsing ───────────────────────────────────────────────────────────
  // @-prefix tokens are scope filters (@country, @vendor, @tooling…) handled separately.
  // Remaining tokens are alias-expanded: "bd rev" → ["bangladesh", "revenue"]
  const rawTokens    = q ? q.split(/\s+/).filter(Boolean) : [];
  const scopeTokens  = rawTokens.filter(t => t.startsWith('@'));
  const searchTokens = rawTokens.filter(t => !t.startsWith('@'));
  const expTokens    = searchTokens.map(t => ALIASES[t] ?? t);
  const aliasMap     = Object.fromEntries(
    searchTokens.map((raw, i) => [raw, expTokens[i]] as [string, string]).filter(([r, e]) => r !== e)
  );
  const aliasActive   = Object.keys(aliasMap).length > 0;
  const routePriority = searchTokens.some(t => ALIAS_PRIORITY[t] === 'route');

  // ── @scope filter derivation ────────────────────────────────────────────────
  const entityScopeFilter = new Set<string>();
  const routeScopeFilter  = new Set<string>();
  for (const st of scopeTokens) {
    const m = SCOPE_FILTER_MAP[st.toLowerCase()];
    if (m?.type === 'entity') entityScopeFilter.add(m.key);
    else if (m?.type === 'route') routeScopeFilter.add(m.key);
  }
  const hasScopeFilter = entityScopeFilter.size > 0 || routeScopeFilter.size > 0;

  // ── Filtered routes grouped by domain ──────────────────────────────────────
  // @entity-only scope → suppress all routes; @route scope → restrict to that domain
  const filteredRoutes = useMemo(() => {
    if (entityScopeFilter.size > 0 && routeScopeFilter.size === 0) return {} as Record<string, RouteEntry[]>;
    if (!expTokens.length && !hasScopeFilter) return {} as Record<string, RouteEntry[]>;
    const grouped: Record<string, RouteEntry[]> = {};
    for (const r of ROUTE_REGISTRY) {
      if (r.roles && !r.roles.includes(role)) continue;
      if (routeScopeFilter.size > 0 && !routeScopeFilter.has(r.domain)) continue;
      if (expTokens.length > 0) {
        const hay = `${r.label} ${r.keywords ?? ''} ${r.domain}`.toLowerCase();
        if (!expTokens.every(t => hay.includes(t))) continue;
      }
      if (!grouped[r.domain]) grouped[r.domain] = [];
      grouped[r.domain].push(r);
    }
    return grouped;
  }, [q, role]);

  // ── Filtered entities grouped by dim ───────────────────────────────────────
  // @route-only scope → suppress all entities; @entity scope → restrict to that dim
  const filteredEntities = useMemo(() => {
    if (routeScopeFilter.size > 0 && entityScopeFilter.size === 0) return {} as Record<string, EntityResult[]>;
    if (!expTokens.length && !hasScopeFilter) return {} as Record<string, EntityResult[]>;
    const grouped: Record<string, EntityResult[]> = {};
    const matches = allEntities
      .filter(e => {
        if (entityScopeFilter.size > 0 && !entityScopeFilter.has(e.dimLabel)) return false;
        if (!expTokens.length) return true;
        const n = e.name.toLowerCase();
        return expTokens.every(t => n.includes(t));
      })
      .sort((a, b) => (b.active > 0 ? 1 : 0) - (a.active > 0 ? 1 : 0) || b.active - a.active);
    for (const e of matches) {
      if (!grouped[e.dimLabel]) grouped[e.dimLabel] = [];
      grouped[e.dimLabel].push(e);
    }
    return grouped;
  }, [q, allEntities]);

  // ── Recent routes (resolved to registry entries)
  const recentRoutes = useMemo(() =>
    recent.map(href => ROUTE_REGISTRY.find(r => r.href === href)).filter(Boolean) as RouteEntry[],
    [recent],
  );

  const entityGroups = Object.entries(filteredEntities);
  const routeGroups  = DOMAIN_ORDER.map(d => [d, filteredRoutes[d]] as [string, RouteEntry[]]).filter(([, v]) => v?.length);
  const hasResults   = entityGroups.length > 0 || routeGroups.length > 0;

  return (
    <CommandDialog open={open} onOpenChange={v => { setOpen(v); if (!v) setQuery(''); }}>
      <CommandInput
        placeholder="Search modules, clients, vendors, countries…"
        value={query}
        onValueChange={setQuery}
        data-testid="command-bar-input"
      />
      <CommandList>

        {/* Token interpretation bar — @scope pins (indigo) + alias expansions (muted) */}
        {(scopeTokens.length > 0 || aliasActive) && (
          <div className="flex items-center gap-3 px-3 py-1.5 border-b border-border/40 flex-wrap">
            {scopeTokens.map(st => {
              const m = SCOPE_FILTER_MAP[st.toLowerCase()];
              return (
                <span key={st} className="flex items-center gap-1.5">
                  <kbd className="text-[10px] font-mono bg-indigo-500/15 border border-indigo-500/25 px-1.5 py-0.5 rounded text-indigo-400">{st}</kbd>
                  {m && <span className="text-[10px] text-muted-foreground/40">→ {m.key}</span>}
                </span>
              );
            })}
            {Object.entries(aliasMap).map(([raw, expanded]) => (
              <span key={raw} className="flex items-center gap-1.5">
                <kbd className="text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{raw}</kbd>
                <span className="text-[10px] text-muted-foreground/40">→</span>
                <span className="text-[10px] font-medium text-muted-foreground capitalize">{expanded}</span>
              </span>
            ))}
          </div>
        )}

        {/* No results */}
        {q && !hasResults && (
          <CommandEmpty>
            <div className="flex flex-col items-center gap-2 py-6">
              <Search className="w-6 h-6 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No results for &ldquo;{query}&rdquo;</p>
            </div>
          </CommandEmpty>
        )}

        {/* Empty state — recent pages */}
        {!q && recentRoutes.length > 0 && (
          <CommandGroup heading="Recent">
            {recentRoutes.map(r => (
              <CommandItem key={r.href} value={`recent ${r.label}`} onSelect={() => navigate(r.href)}
                data-testid={`cmd-recent-${r.href.replace(/\//g, '') || 'home'}`}>
                <Clock className="mr-2 h-3.5 w-3.5 text-muted-foreground/50 flex-shrink-0" />
                <span className="flex-1 truncate">{r.label}</span>
                <span className={cn("text-[10px] font-semibold ml-3 flex-shrink-0", r.domainColor)}>{r.domain}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* Empty state — domain hints when no query and no recents */}
        {!q && recentRoutes.length === 0 && (
          <CommandGroup heading="Domains — type to search">
            {DOMAIN_ORDER.slice(0, 6).map(domain => {
              const first = ROUTE_REGISTRY.find(r => r.domain === domain);
              if (!first) return null;
              const count = ROUTE_REGISTRY.filter(r => r.domain === domain).length;
              return (
                <CommandItem key={domain} value={domain} onSelect={() => setQuery(domain.split(' ')[0].toLowerCase())}
                  data-testid={`cmd-domain-${domain.replace(/\s+/g, '-').toLowerCase()}`}>
                  <first.icon className={cn("mr-2 h-3.5 w-3.5 flex-shrink-0", first.domainColor)} />
                  <span className="flex-1">{domain}</span>
                  <span className="ml-3 text-[10px] text-muted-foreground/40">{count} modules</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        {/* ── Results: order swaps based on alias priority ────────────────────
             Default (country aliases, plain text): entities first, then routes
             Route priority (module aliases: noc, sip, rpt…): routes first, then entities */}

        {/* Entity groups rendered inline — position controlled by routePriority */}
        {!routePriority && entityGroups.map(([dimLabel, entities]) => (
          <CommandGroup key={dimLabel} heading={<ScopeHeading label={dimLabel} />}>
            {entities.slice(0, 7).map(e => (
              <CommandItem key={`${e.dim}-${e.name}`} value={`entity ${e.name} ${e.dimLabel}`}
                onSelect={() => navigate('/bitseye2')}
                data-testid={`cmd-entity-${e.name.replace(/\s+/g, '-').toLowerCase()}`}>
                <span className={cn("w-2 h-2 rounded-full mr-2.5 flex-shrink-0", e.active > 0 ? 'bg-emerald-400' : 'bg-slate-600')} />
                <span className="flex-1 truncate font-medium">{e.name}</span>
                {e.active > 0
                  ? <span className="ml-3 text-[11px] font-bold tabular-nums text-emerald-400 flex-shrink-0">{e.active}</span>
                  : <span className="ml-3 text-[10px] text-muted-foreground/40 flex-shrink-0">idle</span>}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}

        {/* Route groups */}
        {routeGroups.length > 0 && entityGroups.length > 0 && <CommandSeparator />}
        {routeGroups.map(([domain, routes]) => (
          <CommandGroup key={domain} heading={<ScopeHeading label={domain} />}>
            {routes.map(r => (
              <CommandItem key={r.href} value={`route ${r.label} ${r.domain}`}
                onSelect={() => navigate(r.href)}
                data-testid={`cmd-route-${r.href.replace(/\//g, '-')}`}>
                <r.icon className={cn("mr-2 h-3.5 w-3.5 flex-shrink-0", r.domainColor)} />
                <span className="flex-1">{r.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}

        {/* Entity groups (route-priority mode: placed after routes) */}
        {routePriority && entityGroups.length > 0 && routeGroups.length > 0 && <CommandSeparator />}
        {routePriority && entityGroups.map(([dimLabel, entities]) => (
          <CommandGroup key={dimLabel} heading={<ScopeHeading label={dimLabel} />}>
            {entities.slice(0, 7).map(e => (
              <CommandItem key={`${e.dim}-${e.name}`} value={`entity-rp ${e.name} ${e.dimLabel}`}
                onSelect={() => navigate('/bitseye2')}
                data-testid={`cmd-entity-${e.name.replace(/\s+/g, '-').toLowerCase()}-rp`}>
                <span className={cn("w-2 h-2 rounded-full mr-2.5 flex-shrink-0", e.active > 0 ? 'bg-emerald-400' : 'bg-slate-600')} />
                <span className="flex-1 truncate font-medium">{e.name}</span>
                {e.active > 0
                  ? <span className="ml-3 text-[11px] font-bold tabular-nums text-emerald-400 flex-shrink-0">{e.active}</span>
                  : <span className="ml-3 text-[10px] text-muted-foreground/40 flex-shrink-0">idle</span>}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}

      </CommandList>
    </CommandDialog>
  );
}
