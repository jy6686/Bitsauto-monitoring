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
  ClipboardList, Mail, Star, Package, Activity, Banknote,
  Mic, Rewind, Clock, Terminal, Wifi, AlertTriangle, CheckCircle2,
  Radio, Package2, Lightbulb,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

// ── Route registry ─────────────────────────────────────────────────────────────
interface RouteEntry {
  type:        'route';
  domain:      string;
  domainColor: string;
  label:       string;
  href:        string;
  icon:        React.ComponentType<{ className?: string }>;
  keywords?:   string;
  roles?:      string[];
}

// Multi-context entries carry the same href with a different domain key.
// The value prop on CommandItem is made unique with a domain prefix so the
// Command component does not collapse duplicates.
export const ROUTE_REGISTRY: RouteEntry[] = [
  // ── Live Ops ──────────────────────────────────────────────────────────────
  { type: 'route', domain: 'Live Ops',      domainColor: 'text-violet-400', label: 'BitsEye 2',           href: '/bitseye2',          icon: Eye,             keywords: 'live topology observatory noc' },
  { type: 'route', domain: 'Live Ops',      domainColor: 'text-violet-400', label: 'Live Traffic',         href: '/live-traffic',       icon: Activity,        keywords: 'active calls stream concurrent' },
  { type: 'route', domain: 'Live Ops',      domainColor: 'text-violet-400', label: 'Traffic Map',          href: '/traffic-map',        icon: Globe,           keywords: 'geographic world map' },
  { type: 'route', domain: 'Live Ops',      domainColor: 'text-violet-400', label: 'Dashboard',            href: '/',                   icon: LayoutDashboard, keywords: 'home overview summary' },
  { type: 'route', domain: 'Live Ops',      domainColor: 'text-violet-400', label: 'Alerts',               href: '/alerts',             icon: Bell,            keywords: 'incidents active alerts notifications' },
  { type: 'route', domain: 'Live Ops',      domainColor: 'text-violet-400', label: 'Graphs',               href: '/graphs',             icon: LineChart,       keywords: 'performance charts metrics realtime' },
  { type: 'route', domain: 'Live Ops',      domainColor: 'text-violet-400', label: 'Multi-Switch',         href: '/multi-switch',       icon: Layers,          keywords: 'consolidated switch view' },
  { type: 'route', domain: 'Live Ops',      domainColor: 'text-violet-400', label: 'NOC Command',          href: '/noc-command',        icon: Monitor,         keywords: 'noc command center operator' },
  { type: 'route', domain: 'Live Ops',      domainColor: 'text-violet-400', label: 'Ops Console',          href: '/ops-console',        icon: SlidersHorizontal, keywords: 'unified operations console' },
  { type: 'route', domain: 'Live Ops',      domainColor: 'text-violet-400', label: 'Console',              href: '/console',            icon: Database,        keywords: 'logs debug shell terminal' },
  { type: 'route', domain: 'Live Ops',      domainColor: 'text-violet-400', label: 'Server Monitor',       href: '/server-monitoring',  icon: Server,          keywords: 'infrastructure health uptime server' },
  { type: 'route', domain: 'Live Ops',      domainColor: 'text-violet-400', label: 'SBC Monitor',          href: '/sbc-monitor',        icon: HardDrive,       keywords: 'session border controller sbc' },
  { type: 'route', domain: 'Live Ops',      domainColor: 'text-violet-400', label: 'Network Topology',     href: '/network-topology',   icon: Network,         keywords: 'topology viewer network map' },
  { type: 'route', domain: 'Live Ops',      domainColor: 'text-violet-400', label: 'SIP Trace',            href: '/sip-trace',          icon: Mic,             keywords: 'packet sip trace debug pcap' },
  { type: 'route', domain: 'Live Ops',      domainColor: 'text-violet-400', label: 'Replay Engine',        href: '/replay',             icon: Rewind,          keywords: 'call session replay pcap' },
  { type: 'route', domain: 'Live Ops',      domainColor: 'text-violet-400', label: 'Test Campaigns',       href: '/test-campaigns',     icon: FlaskConical,    keywords: 'automated test suite campaign' },
  { type: 'route', domain: 'Live Ops',      domainColor: 'text-violet-400', label: 'Tools',                href: '/tools',              icon: Wrench,          keywords: 'engineering utilities calculator dial' },

  // ── Clients ───────────────────────────────────────────────────────────────
  { type: 'route', domain: 'Clients',       domainColor: 'text-amber-400',  label: 'Accounts',             href: '/clients',            icon: Users,           keywords: 'client management accounts customer' },
  { type: 'route', domain: 'Clients',       domainColor: 'text-amber-400',  label: 'Client Portal',        href: '/client-portal',      icon: Building2,       keywords: 'self service portal' },
  { type: 'route', domain: 'Clients',       domainColor: 'text-amber-400',  label: 'Company Profile',      href: '/company-profile',    icon: Building2,       keywords: 'organisation company details' },
  { type: 'route', domain: 'Clients',       domainColor: 'text-amber-400',  label: 'Reseller',             href: '/reseller',           icon: Star,            keywords: 'partner accounts reseller' },
  { type: 'route', domain: 'Clients',       domainColor: 'text-amber-400',  label: 'Billing',              href: '/billing',            icon: Wallet,          keywords: 'payments invoices billing' },
  { type: 'route', domain: 'Clients',       domainColor: 'text-amber-400',  label: 'Billing Disputes',     href: '/billing-disputes',   icon: ClipboardList,   keywords: 'dispute resolution billing' },
  { type: 'route', domain: 'Clients',       domainColor: 'text-amber-400',  label: 'DIDs',                 href: '/dids',               icon: Phone,           keywords: 'number inventory did management' },
  { type: 'route', domain: 'Clients',       domainColor: 'text-amber-400',  label: 'Account Names',        href: '/account-names',      icon: FileText,        keywords: 'account naming aliases' },
  { type: 'route', domain: 'Clients',       domainColor: 'text-amber-400',  label: 'Recordings',           href: '/call-recordings',    icon: Mic,             keywords: 'call recording archive' },

  // ── Vendors (includes routing) ────────────────────────────────────────────
  { type: 'route', domain: 'Vendors',       domainColor: 'text-cyan-400',   label: 'Vendor List',          href: '/vendors',            icon: Wifi,            keywords: 'carriers vendor connections list' },
  { type: 'route', domain: 'Vendors',       domainColor: 'text-cyan-400',   label: 'SLA Scorecard',        href: '/vendor-sla-scorecard',icon: HeartPulse,     keywords: 'carrier performance sla scorecard' },
  { type: 'route', domain: 'Vendors',       domainColor: 'text-cyan-400',   label: 'Carrier Scoring',      href: '/carrier-scoring',    icon: Star,            keywords: 'quality benchmarks carrier scoring' },
  { type: 'route', domain: 'Vendors',       domainColor: 'text-cyan-400',   label: 'Stability Timeline',   href: '/vendor-stability-timeline', icon: Activity, keywords: 'vendor stability timeline history' },
  { type: 'route', domain: 'Vendors',       domainColor: 'text-cyan-400',   label: 'Vendor RCA',           href: '/vendor-rca',         icon: Search,          keywords: 'root cause analysis rca vendor degradation' },
  { type: 'route', domain: 'Vendors',       domainColor: 'text-cyan-400',   label: 'Carrier Intelligence', href: '/carrier-intelligence',icon: Brain,          keywords: 'market intelligence carrier health signals' },
  { type: 'route', domain: 'Vendors',       domainColor: 'text-cyan-400',   label: 'Prefix Intelligence',  href: '/vendor-prefix-intelligence', icon: Globe,    keywords: 'prefix level analytics intelligence' },
  { type: 'route', domain: 'Vendors',       domainColor: 'text-cyan-400',   label: 'Balance Monitor',      href: '/balance',            icon: Wallet,          keywords: 'vendor balances account' },
  { type: 'route', domain: 'Vendors',       domainColor: 'text-cyan-400',   label: 'Products',             href: '/products',           icon: Package,         keywords: 'product catalogue trunk class' },
  { type: 'route', domain: 'Vendors',       domainColor: 'text-cyan-400',   label: 'Rate Cards',           href: '/rate-cards',         icon: FileText,        keywords: 'pricing rate management deck' },
  // Routing Core (lives under Vendors)
  { type: 'route', domain: 'Vendors',       domainColor: 'text-cyan-400',   label: 'Routing Manager',      href: '/routing-manager',    icon: GitBranch,       keywords: 'routing groups connections destination sets lcr' },
  { type: 'route', domain: 'Vendors',       domainColor: 'text-cyan-400',   label: 'LCR Analyser',         href: '/lcr-analyser',       icon: Calculator,      keywords: 'least cost routing lcr analyser' },
  { type: 'route', domain: 'Vendors',       domainColor: 'text-cyan-400',   label: 'Route Simulator',      href: '/call-flow-simulator',icon: ArrowRightLeft,  keywords: 'route simulation call flow simulator' },
  { type: 'route', domain: 'Vendors',       domainColor: 'text-cyan-400',   label: 'Routing Intelligence', href: '/routing-intelligence',icon: Brain,          keywords: 'intelligent routing route analysis' },
  { type: 'route', domain: 'Vendors',       domainColor: 'text-cyan-400',   label: 'Number Intelligence',  href: '/number-intelligence',icon: Phone,           keywords: 'number analysis cli cld prefix' },
  { type: 'route', domain: 'Vendors',       domainColor: 'text-cyan-400',   label: 'Cost Optimisation',    href: '/cost-optimisation',  icon: TrendingDown,    keywords: 'route cost engine optimise' },
  { type: 'route', domain: 'Vendors',       domainColor: 'text-cyan-400',   label: 'Traffic Steering',     href: '/self-heal',          icon: HeartPulse,      keywords: 'self heal auto healing traffic steering routes' },
  { type: 'route', domain: 'Vendors',       domainColor: 'text-cyan-400',   label: 'Route Tester',         href: '/test-call',          icon: PhoneCall,       keywords: 'route test call on demand' },
  // Quality & RCA
  { type: 'route', domain: 'Vendors',       domainColor: 'text-cyan-400',   label: 'ASR / NER Analytics',  href: '/asr-acd',            icon: BarChart3,       keywords: 'asr ner answer seizure ratio quality vendor' },
  { type: 'route', domain: 'Vendors',       domainColor: 'text-cyan-400',   label: 'RTP Analytics',        href: '/rtp-analytics',      icon: Activity,        keywords: 'rtp media quality jitter mos vendor' },

  // ── Intelligence ──────────────────────────────────────────────────────────
  { type: 'route', domain: 'Intelligence',  domainColor: 'text-fuchsia-400',label: 'Intelligence Hub',     href: '/intelligence',       icon: Brain,           keywords: 'correlated insights intelligence hub' },
  { type: 'route', domain: 'Intelligence',  domainColor: 'text-fuchsia-400',label: 'AI Ops Center',        href: '/ai-ops',             icon: Bot,             keywords: 'ai assisted aiops anomaly detection' },
  { type: 'route', domain: 'Intelligence',  domainColor: 'text-fuchsia-400',label: 'Validation Console',   href: '/intelligence-validation', icon: Shield,     keywords: 'data quality validation console trust' },
  // Multi-context: same routes as Vendors, different workflow entry point
  { type: 'route', domain: 'Intelligence',  domainColor: 'text-fuchsia-400',label: 'Vendor RCA',           href: '/vendor-rca',         icon: Search,          keywords: 'root cause analysis rca intelligence' },
  { type: 'route', domain: 'Intelligence',  domainColor: 'text-fuchsia-400',label: 'Prefix Intelligence',  href: '/vendor-prefix-intelligence', icon: Globe,    keywords: 'prefix intelligence analysis rca' },
  { type: 'route', domain: 'Intelligence',  domainColor: 'text-fuchsia-400',label: 'Stability Engine',     href: '/vendor-stability-timeline', icon: Activity,  keywords: 'vendor stability intelligence engine' },
  { type: 'route', domain: 'Intelligence',  domainColor: 'text-fuchsia-400',label: 'Routing Intelligence', href: '/routing-intelligence',icon: GitBranch,      keywords: 'route intelligence engine analysis' },
  { type: 'route', domain: 'Intelligence',  domainColor: 'text-fuchsia-400',label: 'Carrier Intelligence', href: '/carrier-intelligence',icon: Brain,          keywords: 'carrier intelligence health signals' },

  // ── Analytics ─────────────────────────────────────────────────────────────
  { type: 'route', domain: 'Analytics',     domainColor: 'text-blue-400',   label: 'Traffic Analytics',    href: '/analytics',          icon: LineChart,       keywords: 'traffic analytics revenue margin' },
  { type: 'route', domain: 'Analytics',     domainColor: 'text-blue-400',   label: 'ASR / ACD',            href: '/asr-acd',            icon: BarChart3,       keywords: 'asr acd call quality kpi' },
  { type: 'route', domain: 'Analytics',     domainColor: 'text-blue-400',   label: 'Reports',              href: '/reports',            icon: BarChart2,       keywords: 'reports standard centre export' },
  { type: 'route', domain: 'Analytics',     domainColor: 'text-blue-400',   label: 'CDRs',                 href: '/cdrs',               icon: History,         keywords: 'call detail records cdr viewer export' },
  { type: 'route', domain: 'Analytics',     domainColor: 'text-blue-400',   label: 'Revenue Heatmap',      href: '/revenue-heatmap',    icon: Map,             keywords: 'revenue heatmap visualisation map' },
  { type: 'route', domain: 'Analytics',     domainColor: 'text-blue-400',   label: 'Traffic Forecast',     href: '/traffic-forecast',   icon: TrendingUp,      keywords: 'demand forecast prediction traffic' },
  { type: 'route', domain: 'Analytics',     domainColor: 'text-blue-400',   label: 'QoS Heatmap',          href: '/qos-heatmap',        icon: HeartPulse,      keywords: 'quality of service qos heatmap' },
  { type: 'route', domain: 'Analytics',     domainColor: 'text-blue-400',   label: 'Codec Analytics',      href: '/codec-analytics',    icon: Radio,           keywords: 'codec breakdown analytics' },
  { type: 'route', domain: 'Analytics',     domainColor: 'text-blue-400',   label: 'RTP Analytics',        href: '/rtp-analytics',      icon: Activity,        keywords: 'rtp media quality mos jitter analytics' },
  { type: 'route', domain: 'Analytics',     domainColor: 'text-blue-400',   label: 'BitsEye',              href: '/bitseye',            icon: Eye,             keywords: 'bitseye drill down analytics classic' },
  { type: 'route', domain: 'Analytics',     domainColor: 'text-blue-400',   label: 'BitsEye 2',            href: '/bitseye2',           icon: Eye,             keywords: 'bitseye 2 live analytics topology' },

  // ── Security ──────────────────────────────────────────────────────────────
  { type: 'route', domain: 'Security',      domainColor: 'text-rose-400',   label: 'Fraud Engine',         href: '/fraud',              icon: ShieldAlert,     keywords: 'fas irsf detection fraud security' },
  { type: 'route', domain: 'Security',      domainColor: 'text-rose-400',   label: 'Firewall',             href: '/firewall',           icon: Shield,          keywords: 'auto blacklist block firewall ip' },
  { type: 'route', domain: 'Security',      domainColor: 'text-rose-400',   label: 'STIR/SHAKEN',          href: '/stir-shaken',        icon: Lock,            keywords: 'attestation stir shaken' },
  { type: 'route', domain: 'Security',      domainColor: 'text-rose-400',   label: 'SLA Breaches',         href: '/sla-breaches',       icon: Zap,             keywords: 'sla breach tracking alerts' },
  { type: 'route', domain: 'Security',      domainColor: 'text-rose-400',   label: 'Compliance',           href: '/compliance',         icon: ClipboardList,   keywords: 'regulatory compliance rules' },
  { type: 'route', domain: 'Security',      domainColor: 'text-rose-400',   label: 'Approval Queue',       href: '/approvals',          icon: FileText,        keywords: 'approval queue pending governance' },
  { type: 'route', domain: 'Security',      domainColor: 'text-rose-400',   label: 'Audit Log',            href: '/audit-log',          icon: FileText,        keywords: 'activity log audit trail platform' },
  { type: 'route', domain: 'Security',      domainColor: 'text-rose-400',   label: 'Call Recordings',      href: '/call-recordings',    icon: Mic,             keywords: 'call recording archive security' },
  { type: 'route', domain: 'Security',      domainColor: 'text-rose-400',   label: 'Approval Rules',       href: '/approval-settings',  icon: SlidersHorizontal, keywords: 'approval configuration rules governance' },

  // ── Finance ───────────────────────────────────────────────────────────────
  { type: 'route', domain: 'Finance',       domainColor: 'text-emerald-400',label: 'Billing',              href: '/billing',            icon: Wallet,          keywords: 'billing payments invoices finance' },
  { type: 'route', domain: 'Finance',       domainColor: 'text-emerald-400',label: 'Billing Disputes',     href: '/billing-disputes',   icon: ClipboardList,   keywords: 'billing dispute resolution finance' },
  { type: 'route', domain: 'Finance',       domainColor: 'text-emerald-400',label: 'Rate Cards',           href: '/rate-cards',         icon: FileText,        keywords: 'rate cards pricing decks finance' },
  { type: 'route', domain: 'Finance',       domainColor: 'text-emerald-400',label: 'Products',             href: '/products',           icon: Package,         keywords: 'products catalogue trunk finance' },
  { type: 'route', domain: 'Finance',       domainColor: 'text-emerald-400',label: 'Cost Optimisation',    href: '/cost-optimisation',  icon: TrendingDown,    keywords: 'cost optimisation route engine finance' },
  { type: 'route', domain: 'Finance',       domainColor: 'text-emerald-400',label: 'Revenue Heatmap',      href: '/revenue-heatmap',    icon: Map,             keywords: 'revenue heatmap finance analytics' },
  { type: 'route', domain: 'Finance',       domainColor: 'text-emerald-400',label: 'Balance Monitor',      href: '/balance',            icon: Wallet,          keywords: 'vendor balance monitor finance' },
  { type: 'route', domain: 'Finance',       domainColor: 'text-emerald-400',label: 'Finance Reports',      href: '/reports',            icon: BarChart2,       keywords: 'finance reports revenue cost settlement' },
  { type: 'route', domain: 'Finance',       domainColor: 'text-emerald-400',label: 'CDR Billing',          href: '/cdrs',               icon: History,         keywords: 'cdr billing export finance' },
  { type: 'route', domain: 'Finance',       domainColor: 'text-emerald-400',label: 'Margin Analytics',     href: '/asr-acd',            icon: BarChart3,       keywords: 'margin analytics cost revenue finance' },

  // ── Settings ──────────────────────────────────────────────────────────────
  { type: 'route', domain: 'Settings',      domainColor: 'text-slate-400',  label: 'Platform Settings',    href: '/settings',           icon: Settings,        roles: ['admin'], keywords: 'system configuration settings platform' },
  { type: 'route', domain: 'Settings',      domainColor: 'text-slate-400',  label: 'Team & Roles',         href: '/team',               icon: Users,           roles: ['admin'], keywords: 'role access control team members' },
  { type: 'route', domain: 'Settings',      domainColor: 'text-slate-400',  label: 'Company Profile',      href: '/company-profile',    icon: Building2,       keywords: 'organisation company details' },
  { type: 'route', domain: 'Settings',      domainColor: 'text-slate-400',  label: 'API Keys',             href: '/api-keys',           icon: Key,             roles: ['admin'], keywords: 'api key integration external' },
  { type: 'route', domain: 'Settings',      domainColor: 'text-slate-400',  label: 'Approval Rules',       href: '/approval-settings',  icon: SlidersHorizontal, keywords: 'approval configuration rules' },
  { type: 'route', domain: 'Settings',      domainColor: 'text-slate-400',  label: 'WhatsApp Alerts',      href: '/whatsapp-alerts',    icon: MessageSquare,   keywords: 'whatsapp alerts delivery config' },
  { type: 'route', domain: 'Settings',      domainColor: 'text-slate-400',  label: 'Email Centre',         href: '/email-centre',       icon: Mail,            keywords: 'email notifications config' },
  { type: 'route', domain: 'Settings',      domainColor: 'text-slate-400',  label: 'Sidebar Settings',     href: '/sidebar-settings',   icon: Layers,          keywords: 'navigation sidebar preferences' },
  { type: 'route', domain: 'Settings',      domainColor: 'text-slate-400',  label: 'Notification Centre',  href: '/notification-centre',icon: Bell,            keywords: 'notifications centre' },
  { type: 'route', domain: 'Settings',      domainColor: 'text-slate-400',  label: 'VPN Config',           href: '/vpn-config',         icon: Lock,            keywords: 'vpn configuration network' },
  { type: 'route', domain: 'Settings',      domainColor: 'text-slate-400',  label: 'My Account',           href: '/account',            icon: Users,           keywords: 'profile account preferences' },
];

// ── Operational commands ───────────────────────────────────────────────────────
// Intent-based nav: operators express what they want to do, not where to find it.
interface CommandEntry {
  type:     'command';
  label:    string;
  desc:     string;
  href:     string;
  icon:     React.ComponentType<{ className?: string }>;
  keywords: string;
  color:    string;
  badge?:   string;
}

const COMMANDS: CommandEntry[] = [
  { type: 'command', label: 'View Active Incidents',        desc: 'Open active alerts and incident feed',           href: '/alerts',                   icon: AlertTriangle,  color: 'text-rose-400',    keywords: 'active incidents open alerts view show', badge: 'LIVE' },
  { type: 'command', label: 'Degraded Vendors',             desc: 'Carriers with stability score below threshold',  href: '/vendor-sla-scorecard',     icon: ShieldAlert,    color: 'text-amber-400',   keywords: 'degraded vendors unstable carriers show open' },
  { type: 'command', label: 'Unstable Routes',              desc: 'Routes with active degradation signals',         href: '/vendor-stability-timeline',icon: Activity,       color: 'text-amber-400',   keywords: 'unstable routes degradation signals show open', badge: 'LIVE' },
  { type: 'command', label: 'Open Approval Queue',          desc: 'Pending items requiring your approval',          href: '/approvals',                icon: CheckCircle2,   color: 'text-violet-400',  keywords: 'approval queue pending open show approvals' },
  { type: 'command', label: 'Critical Recommendations',     desc: 'Immediate routing recommendations from AI',      href: '/routing-intelligence',     icon: Lightbulb,      color: 'text-fuchsia-400', keywords: 'critical recommendations routing ai show open' },
  { type: 'command', label: 'FAS Fraud Events',             desc: 'Flash Answer Seizure events and IRSF alerts',    href: '/fraud',                    icon: ShieldAlert,    color: 'text-rose-400',    keywords: 'fas fraud irsf events show open security' },
  { type: 'command', label: 'Run Test Call',                desc: 'Launch an on-demand route test call',            href: '/test-call',                icon: PhoneCall,      color: 'text-emerald-400', keywords: 'run test call launch send route test' },
  { type: 'command', label: 'Live Call Stream',             desc: 'Real-time view of all active calls',             href: '/live-traffic',             icon: Phone,          color: 'text-violet-400',  keywords: 'live calls active stream view open show', badge: 'LIVE' },
  { type: 'command', label: 'Vendor Root Cause Analysis',   desc: 'Drill into carrier failure root causes',         href: '/vendor-rca',               icon: Search,         color: 'text-cyan-400',    keywords: 'vendor rca root cause analysis drill open' },
  { type: 'command', label: 'Prefix Intelligence Lookup',   desc: 'Analyse prefix-level quality and routing',       href: '/vendor-prefix-intelligence',icon: Globe,         color: 'text-cyan-400',    keywords: 'prefix intelligence lookup analysis open' },
  { type: 'command', label: 'Pakistan Route Analysis',      desc: 'Prefix intelligence for Pakistan destinations',  href: '/vendor-prefix-intelligence?focus=pk', icon: Globe, color: 'text-cyan-400', keywords: 'pakistan pk route analysis prefix' },
  { type: 'command', label: 'Bangladesh Route Analysis',    desc: 'Prefix intelligence for Bangladesh destinations',href: '/vendor-prefix-intelligence?focus=bd', icon: Globe, color: 'text-cyan-400', keywords: 'bangladesh bd route analysis prefix' },
  { type: 'command', label: 'AI Ops Center',                desc: 'Anomaly detection and AI-assisted operations',   href: '/ai-ops',                   icon: Bot,            color: 'text-fuchsia-400', keywords: 'ai ops center anomaly aiops open show' },
  { type: 'command', label: 'Balance Alerts',               desc: 'Vendors with low or critical balance levels',    href: '/balance',                  icon: Wallet,         color: 'text-amber-400',   keywords: 'balance low critical vendor alerts show open', badge: 'LIVE' },
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

// ── Live operational data types ────────────────────────────────────────────────
interface IncidentResult {
  id:         number;
  title?:     string;
  message?:   string;
  status?:    string;
  entityName?:string;
  carrier?:   string;
  resolvedAt?:string | null;
  severity?:  string;
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
const DOMAIN_ORDER = ['Live Ops', 'Clients', 'Vendors', 'Intelligence', 'Analytics', 'Security', 'Finance', 'Settings'];

// ── Semantic aliases ────────────────────────────────────────────────────────────
const ALIASES: Record<string, string> = {
  // ISO country codes
  bd: 'bangladesh', pk: 'pakistan',  sa: 'saudi arabia', ae: 'uae',
  kw: 'kuwait',     qa: 'qatar',     bh: 'bahrain',      om: 'oman',
  iq: 'iraq',       sy: 'syria',     jo: 'jordan',       lb: 'lebanon',
  eg: 'egypt',      ng: 'nigeria',   gh: 'ghana',        ke: 'kenya',
  ug: 'uganda',     tz: 'tanzania',  et: 'ethiopia',     zm: 'zambia',
  in: 'india',      lk: 'sri lanka', np: 'nepal',        af: 'afghanistan',
  uk: 'united kingdom', gb: 'united kingdom', us: 'united states',
  usa: 'united states', de: 'germany', fr: 'france', au: 'australia', ca: 'canada',
  // Platform module shortcuts
  noc:  'bitseye',    live:  'live ops',  acct: 'accounts',
  rev:  'revenue',    cdr:   'cdrs',      lcr:  'lcr analyser',
  sip:  'sip trace',  rtp:   'rtp',       fas:  'fraud',
  irsf: 'fraud',      bl:    'firewall',  fw:   'firewall',
  bal:  'balance',    rpt:   'reports',   rg:   'routing manager',
  tst:  'test call',  kpi:   'asr',       asr:  'asr',
  mos:  'qos',        pdd:   'asr',       rca:  'vendor rca',
  sec:  'security',   fin:   'finance',   intel:'intelligence',
};

const ALIAS_PRIORITY: Record<string, 'route'> = {
  noc: 'route', live: 'route', acct: 'route', rev: 'route',
  cdr: 'route', lcr: 'route',  sip: 'route',  rtp: 'route',
  fas: 'route', irsf: 'route', bl: 'route',   fw: 'route',
  bal: 'route', rpt: 'route',  rg: 'route',   tst: 'route',
  kpi: 'route', asr: 'route',  mos: 'route',  pdd: 'route',
  rca: 'route', sec: 'route',  fin: 'route',  intel: 'route',
};

// ── Scope chip styles ─────────────────────────────────────────────────────────
const SCOPE_CHIPS: Record<string, { label: string; bg: string; fg: string }> = {
  'Countries':    { label: 'COUNTRY',   bg: 'rgba(56,189,248,0.12)',  fg: '#38BDF8' },
  'Clients':      { label: 'CLIENT',    bg: 'rgba(251,191,36,0.12)',  fg: '#FBBF24' },
  'Vendors':      { label: 'VENDOR',    bg: 'rgba(34,211,238,0.12)',  fg: '#22D3EE' },
  'Destinations': { label: 'DEST',      bg: 'rgba(45,212,191,0.12)',  fg: '#2DD4BF' },
  'Live Ops':     { label: 'LIVE',      bg: 'rgba(167,139,250,0.12)', fg: '#A78BFA' },
  'Intelligence': { label: 'INTEL',     bg: 'rgba(232,121,249,0.12)', fg: '#E879F9' },
  'Analytics':    { label: 'ANALYTICS', bg: 'rgba(96,165,250,0.12)',  fg: '#60A5FA' },
  'Security':     { label: 'SECURITY',  bg: 'rgba(251,113,133,0.12)', fg: '#FB7185' },
  'Finance':      { label: 'FINANCE',   bg: 'rgba(52,211,153,0.12)',  fg: '#34D399' },
  'Settings':     { label: 'SETTINGS',  bg: 'rgba(148,163,184,0.12)', fg: '#94A3B8' },
  'Commands':     { label: 'ACTION',    bg: 'rgba(99,102,241,0.12)',  fg: '#818CF8' },
  'Incidents':    { label: 'LIVE',      bg: 'rgba(239,68,68,0.12)',   fg: '#F87171' },
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

// ── @scope filter map (new 8-domain vocabulary) ────────────────────────────────
const SCOPE_FILTER_MAP: Record<string, { type: 'entity' | 'route'; key: string }> = {
  '@country':     { type: 'entity', key: 'Countries' },
  '@geo':         { type: 'entity', key: 'Countries' },
  '@client':      { type: 'entity', key: 'Clients' },
  '@vendor':      { type: 'entity', key: 'Vendors' },
  '@dest':        { type: 'entity', key: 'Destinations' },
  '@live':        { type: 'route',  key: 'Live Ops' },
  '@noc':         { type: 'route',  key: 'Live Ops' },
  '@vendors':     { type: 'route',  key: 'Vendors' },
  '@routing':     { type: 'route',  key: 'Vendors' },
  '@intelligence':{ type: 'route',  key: 'Intelligence' },
  '@intel':       { type: 'route',  key: 'Intelligence' },
  '@analytics':   { type: 'route',  key: 'Analytics' },
  '@security':    { type: 'route',  key: 'Security' },
  '@fraud':       { type: 'route',  key: 'Security' },
  '@finance':     { type: 'route',  key: 'Finance' },
  '@clients':     { type: 'route',  key: 'Clients' },
  '@settings':    { type: 'route',  key: 'Settings' },
};

const SCOPE_DESCRIPTIONS: Record<string, string> = {
  '@country':     'Live country entities and routing topology',
  '@geo':         'Live country entities and routing topology',
  '@client':      'Active client accounts and live traffic',
  '@vendor':      'Carrier vendors and live entity data',
  '@dest':        'Routing destination sets',
  '@live':        'Real-time NOC, live calls and alerts',
  '@noc':         'Real-time NOC, live calls and alerts',
  '@vendors':     'Vendor ops, routing core, and carrier intelligence',
  '@routing':     'Routing core tools within Vendors workspace',
  '@intelligence':'AI Ops, RCA, anomaly detection, validation',
  '@intel':       'AI Ops, RCA, anomaly detection, validation',
  '@analytics':   'Traffic analytics, revenue, CDRs, forecasting',
  '@security':    'Fraud, firewall, compliance, approvals, audit',
  '@fraud':       'Fraud detection, firewall and compliance',
  '@finance':     'Billing, rate cards, costs, revenue reports',
  '@clients':     'Client accounts, billing, DIDs, portal',
  '@settings':    'Platform configuration and administration',
};

const SCOPE_EXAMPLES: Record<string, string> = {
  '@country':     '@country bd',
  '@geo':         '@geo pk',
  '@client':      '@client acme',
  '@vendor':      '@vendor callntalk',
  '@dest':        '@dest main',
  '@live':        '@live',
  '@noc':         '@noc',
  '@vendors':     '@vendors rca',
  '@routing':     '@routing lcr',
  '@intelligence':'@intelligence rca',
  '@intel':       '@intel anomaly',
  '@analytics':   '@analytics revenue',
  '@security':    '@security fraud',
  '@fraud':       '@fraud fas',
  '@finance':     '@finance billing',
  '@clients':     '@clients billing',
  '@settings':    '@settings',
};

// ── CommandBar ─────────────────────────────────────────────────────────────────
export function CommandBar() {
  const [open, setOpen]     = useState(false);
  const [query, setQuery]   = useState('');
  const [, setLocation]     = useLocation();
  const { role }            = useAuth();
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => { if (open) setRecent(getRecent()); }, [open]);

  // ── Live entity queries
  const { data: clientData }  = useQuery<SliceResponse>({ queryKey: ['/api/bitseye/live-slice?groupBy=client'],      enabled: open, staleTime: 20_000 });
  const { data: vendorData }  = useQuery<SliceResponse>({ queryKey: ['/api/bitseye/live-slice?groupBy=vendor'],      enabled: open, staleTime: 20_000 });
  const { data: countryData } = useQuery<SliceResponse>({ queryKey: ['/api/bitseye/live-slice?groupBy=country'],     enabled: open, staleTime: 20_000 });
  const { data: destData }    = useQuery<SliceResponse>({ queryKey: ['/api/bitseye/live-slice?groupBy=destination'], enabled: open, staleTime: 20_000 });

  // ── Live operational data queries (active only when palette is open)
  const { data: incidentsRaw }    = useQuery<IncidentResult[]>({ queryKey: ['/api/ai/incidents'],     enabled: open, staleTime: 20_000 });
  const { data: carrierScoresRaw }= useQuery<any[]>({           queryKey: ['/api/carrier-scores'],    enabled: open, staleTime: 30_000 });

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

  // Active incidents for live results panel
  const activeIncidents = useMemo<IncidentResult[]>(() =>
    (Array.isArray(incidentsRaw) ? incidentsRaw : []).filter(i => i.status === 'active' || !i.resolvedAt).slice(0, 5),
    [incidentsRaw],
  );

  // Degraded carriers for live results
  const degradedCarriers = useMemo(() =>
    (Array.isArray(carrierScoresRaw) ? carrierScoresRaw : [])
      .filter((c: any) => (c.stabilityScore ?? 100) < 55)
      .sort((a: any, b: any) => (a.stabilityScore ?? 100) - (b.stabilityScore ?? 100))
      .slice(0, 4),
    [carrierScoresRaw],
  );

  // ── Keyboard shortcut ⌘K / Ctrl+K
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

  // ── Token parsing ────────────────────────────────────────────────────────
  const rawTokens    = q ? q.split(/\s+/).filter(Boolean) : [];
  const scopeTokens  = rawTokens.filter(t => t.startsWith('@'));
  const searchTokens = rawTokens.filter(t => !t.startsWith('@'));
  const expTokens    = searchTokens.map(t => ALIASES[t] ?? t);
  const aliasMap     = Object.fromEntries(
    searchTokens.map((raw, i) => [raw, expTokens[i]] as [string, string]).filter(([r, e]) => r !== e)
  );
  const aliasActive   = Object.keys(aliasMap).length > 0;
  const routePriority = searchTokens.some(t => ALIAS_PRIORITY[t] === 'route');

  // ── @scope filter derivation
  const entityScopeFilter = new Set<string>();
  const routeScopeFilter  = new Set<string>();
  for (const st of scopeTokens) {
    const m = SCOPE_FILTER_MAP[st.toLowerCase()];
    if (m?.type === 'entity') entityScopeFilter.add(m.key);
    else if (m?.type === 'route') routeScopeFilter.add(m.key);
  }
  const hasScopeFilter = entityScopeFilter.size > 0 || routeScopeFilter.size > 0;

  // ── @scope autocomplete
  const lastRaw = rawTokens[rawTokens.length - 1] ?? '';
  const partialScope = lastRaw.startsWith('@') && !SCOPE_FILTER_MAP[lastRaw] ? lastRaw : null;
  const scopeSuggestions = partialScope !== null
    ? Object.keys(SCOPE_FILTER_MAP).filter(k => k.startsWith(partialScope))
    : [];

  // ── Filtered routes grouped by domain ────────────────────────────────────
  // Multi-context: same href can appear in multiple domains, deduped by (domain, href) pair.
  const seenDomainHref = new Set<string>();
  const filteredRoutes = useMemo(() => {
    if (entityScopeFilter.size > 0 && routeScopeFilter.size === 0) return {} as Record<string, RouteEntry[]>;
    if (!expTokens.length && !hasScopeFilter) return {} as Record<string, RouteEntry[]>;
    const grouped: Record<string, RouteEntry[]> = {};
    const seen = new Set<string>();
    for (const r of ROUTE_REGISTRY) {
      if (r.roles && !r.roles.includes(role)) continue;
      if (routeScopeFilter.size > 0 && !routeScopeFilter.has(r.domain)) continue;
      if (expTokens.length > 0) {
        const hay = `${r.label} ${r.keywords ?? ''} ${r.domain}`.toLowerCase();
        if (!expTokens.every(t => hay.includes(t))) continue;
      }
      const key = `${r.domain}::${r.href}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!grouped[r.domain]) grouped[r.domain] = [];
      grouped[r.domain].push(r);
    }
    return grouped;
  }, [q, role]);

  // ── Filtered commands
  const filteredCommands = useMemo(() => {
    if (!expTokens.length) return [];
    return COMMANDS.filter(c => {
      const hay = `${c.label} ${c.keywords}`.toLowerCase();
      return expTokens.every(t => hay.includes(t));
    });
  }, [q]);

  // ── Filtered entities grouped by dim
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

  // ── Live incident results: shown when query hints at incidents or @live scope
  const showLiveIncidents = useMemo(() => {
    if (activeIncidents.length === 0) return false;
    if (routeScopeFilter.has('Live Ops') || routeScopeFilter.has('Security')) return true;
    if (!expTokens.length) return false;
    const hay = 'incident alert active degradation anomaly live event';
    return expTokens.some(t => hay.includes(t));
  }, [q, activeIncidents, routeScopeFilter]);

  // ── Recent routes
  const recentRoutes = useMemo(() => {
    const seen = new Set<string>();
    return recent
      .map(href => ROUTE_REGISTRY.find(r => r.href === href && !seen.has(r.href) && seen.add(r.href)))
      .filter(Boolean) as RouteEntry[];
  }, [recent]);

  const entityGroups = Object.entries(filteredEntities);
  const routeGroups  = DOMAIN_ORDER.map(d => [d, filteredRoutes[d]] as [string, RouteEntry[]]).filter(([, v]) => v?.length);
  const hasResults   = entityGroups.length > 0 || routeGroups.length > 0 || filteredCommands.length > 0 || scopeSuggestions.length > 0 || showLiveIncidents;

  return (
    <CommandDialog open={open} onOpenChange={v => { setOpen(v); if (!v) setQuery(''); }}>
      <CommandInput
        placeholder="Search modules, vendors, clients, incidents… or type @"
        value={query}
        onValueChange={setQuery}
        data-testid="command-bar-input"
      />
      <CommandList>

        {/* Token interpretation bar */}
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
              <p className="text-xs text-muted-foreground/40">Try @vendors, @security, @finance, or @analytics</p>
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

        {/* Empty state — domain overview when no query and no recents */}
        {!q && recentRoutes.length === 0 && (
          <CommandGroup heading="Workspaces — type to search or use @scope">
            {DOMAIN_ORDER.map(domain => {
              const first = ROUTE_REGISTRY.find(r => r.domain === domain);
              if (!first) return null;
              const count = [...new Set(ROUTE_REGISTRY.filter(r => r.domain === domain).map(r => r.href))].length;
              const chip  = SCOPE_CHIPS[domain];
              return (
                <CommandItem key={domain} value={domain} onSelect={() => setQuery(domain.split(' ')[0].toLowerCase())}
                  data-testid={`cmd-domain-${domain.replace(/\s+/g, '-').toLowerCase()}`}>
                  <first.icon className={cn("mr-2 h-3.5 w-3.5 flex-shrink-0", first.domainColor)} />
                  <span className="flex-1">{domain}</span>
                  {chip && (
                    <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.06em', padding: '1px 5px', borderRadius: 3, background: chip.bg, color: chip.fg, marginRight: 8 }}>
                      {chip.label}
                    </span>
                  )}
                  <span className="text-[10px] text-muted-foreground/40">{count} modules</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        {/* @scope autocomplete */}
        {partialScope !== null && scopeSuggestions.length > 0 && (
          <CommandGroup heading={
            <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span>Scope filters</span>
              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', padding: '1px 5px', borderRadius: 3, background: 'rgba(99,102,241,0.12)', color: '#818CF8' }}>@</span>
            </span>
          }>
            {scopeSuggestions.map(sc => {
              const m = SCOPE_FILTER_MAP[sc];
              const chip = SCOPE_CHIPS[m?.key ?? ''];
              const trimmed = query.trimEnd();
              const lastSpace = trimmed.lastIndexOf(' ');
              const prefix = lastSpace >= 0 ? trimmed.slice(0, lastSpace + 1) : '';
              return (
                <CommandItem key={sc} value={`scope-ac ${sc}`}
                  onSelect={() => setQuery(prefix + sc + ' ')}
                  data-testid={`cmd-scope-${sc.slice(1)}`}
                  className="items-start py-2">
                  <span className="font-mono text-[11px] text-indigo-400 mr-3 flex-shrink-0 mt-0.5">{sc}</span>
                  <span className="flex-1 flex flex-col gap-0.5 min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-medium leading-none">{m?.key}</span>
                      {(() => {
                        if (!m) return null;
                        const cnt = m.type === 'entity'
                          ? allEntities.filter(e => e.dimLabel === m.key).length
                          : [...new Set(ROUTE_REGISTRY.filter(r => r.domain === m.key).map(r => r.href))].length;
                        const unit = m.type === 'entity' ? 'entities' : 'modules';
                        return cnt > 0 ? <span className="text-[10px] tabular-nums text-muted-foreground/40 leading-none">{cnt} {unit}</span> : null;
                      })()}
                    </span>
                    {SCOPE_DESCRIPTIONS[sc] && <span className="text-[10px] text-muted-foreground/50 leading-none">{SCOPE_DESCRIPTIONS[sc]}</span>}
                    {(() => {
                      const example = (() => {
                        if (!m || m.type !== 'entity') return SCOPE_EXAMPLES[sc];
                        const topLive = allEntities.filter(e => e.dimLabel === m.key && e.active > 0).sort((a, b) => b.active - a.active)[0];
                        if (!topLive) return SCOPE_EXAMPLES[sc];
                        return `${sc} ${topLive.name.toLowerCase().split(/\s+/)[0]}`;
                      })();
                      return example ? <span className="text-[9px] font-mono text-muted-foreground/30 leading-none">e.g. {example}</span> : null;
                    })()}
                  </span>
                  {chip && <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', flexShrink: 0, padding: '1px 5px', borderRadius: 3, background: chip.bg, color: chip.fg, marginTop: 2 }}>{chip.label}</span>}
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        {/* Keyboard hint during @scope autocomplete */}
        {partialScope !== null && scopeSuggestions.length > 0 && (
          <div className="flex items-center justify-end gap-4 px-3 py-1.5 border-t border-border/20 select-none">
            {[['↑↓', 'navigate'], ['↵', 'apply'], ['esc', 'close']].map(([key, label]) => (
              <span key={key} className="flex items-center gap-1 text-[9px] text-muted-foreground/25">
                <kbd className="font-mono bg-muted/40 px-1 py-0.5 rounded text-[8px]">{key}</kbd>
                <span>{label}</span>
              </span>
            ))}
          </div>
        )}

        {/* ── Results — default order: entities first, then routes + commands ── */}
        {/* Entity groups (non-priority mode) */}
        {!partialScope && !routePriority && entityGroups.map(([dimLabel, entities]) => (
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

        {/* Live incident results */}
        {!partialScope && showLiveIncidents && (
          <>
            {(entityGroups.length > 0 || routeGroups.length > 0) && <CommandSeparator />}
            <CommandGroup heading={<ScopeHeading label="Incidents" />}>
              {activeIncidents.map(inc => (
                <CommandItem key={inc.id} value={`incident ${inc.id} ${inc.title ?? ''}`}
                  onSelect={() => navigate('/alerts')}
                  data-testid={`cmd-incident-${inc.id}`}>
                  <AlertTriangle className="mr-2 h-3.5 w-3.5 text-rose-400 flex-shrink-0" />
                  <span className="flex-1 truncate font-medium text-foreground/80">
                    {inc.title || inc.message || `Incident #${inc.id}`}
                  </span>
                  <span className="ml-3 text-[9px] font-bold tracking-wider text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded flex-shrink-0">ACTIVE</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {/* Commands group */}
        {!partialScope && filteredCommands.length > 0 && (
          <>
            {(entityGroups.length > 0 || routeGroups.length > 0 || showLiveIncidents) && <CommandSeparator />}
            <CommandGroup heading={<ScopeHeading label="Commands" />}>
              {filteredCommands.map(cmd => (
                <CommandItem key={`cmd-${cmd.href}-${cmd.label}`} value={`command ${cmd.label}`}
                  onSelect={() => navigate(cmd.href)}
                  data-testid={`cmd-action-${cmd.label.replace(/\s+/g, '-').toLowerCase()}`}
                  className="items-start py-2">
                  <cmd.icon className={cn("mr-2 h-3.5 w-3.5 flex-shrink-0 mt-0.5", cmd.color)} />
                  <span className="flex-1 flex flex-col gap-0.5 min-w-0">
                    <span className="text-sm font-medium leading-tight">{cmd.label}</span>
                    <span className="text-[10px] text-muted-foreground/50 leading-tight">{cmd.desc}</span>
                  </span>
                  {cmd.badge && (
                    <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', padding: '1px 5px', borderRadius: 3, background: 'rgba(99,102,241,0.12)', color: '#818CF8', marginTop: 2, flexShrink: 0 }}>{cmd.badge}</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {/* Route groups */}
        {!partialScope && routeGroups.length > 0 && (entityGroups.length > 0 || filteredCommands.length > 0 || showLiveIncidents) && <CommandSeparator />}
        {!partialScope && routeGroups.map(([domain, routes]) => (
          <CommandGroup key={domain} heading={<ScopeHeading label={domain} />}>
            {routes.map(r => (
              <CommandItem key={`${r.domain}::${r.href}`} value={`route ${r.domain} ${r.label}`}
                onSelect={() => navigate(r.href)}
                data-testid={`cmd-route-${r.domain.toLowerCase()}-${r.href.replace(/\//g, '-')}`}>
                <r.icon className={cn("mr-2 h-3.5 w-3.5 flex-shrink-0", r.domainColor)} />
                <span className="flex-1">{r.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}

        {/* Entity groups (route-priority mode: placed after routes) */}
        {!partialScope && routePriority && entityGroups.length > 0 && routeGroups.length > 0 && <CommandSeparator />}
        {!partialScope && routePriority && entityGroups.map(([dimLabel, entities]) => (
          <CommandGroup key={dimLabel} heading={<ScopeHeading label={dimLabel} />}>
            {entities.slice(0, 7).map(e => (
              <CommandItem key={`${e.dim}-${e.name}-rp`} value={`entity-rp ${e.name} ${e.dimLabel}`}
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
