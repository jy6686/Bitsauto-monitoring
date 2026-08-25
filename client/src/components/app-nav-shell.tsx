import { useState, useEffect, useRef, useCallback, useMemo } from "react";
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
  MessageSquare, Bell, Sun, Moon, LogOut, UserPlus, Briefcase,
  Telescope, Cpu, AreaChart, ClockIcon, GitCompare, Layers2, MoreHorizontal, Hash,
  CheckCircle, CreditCard,
  Landmark, Scale, SendHorizontal, PieChart,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { useQuery } from "@tanstack/react-query";
import { inferWorkspace } from "@/lib/workspace";
import type { WorkspaceDefinition } from "@shared/schema";
import { useChatDrawer } from "@/context/chat-drawer-context";
// PortalTopNav retired — portal nav is now a data-driven cascade (see portal_top_nav_domains/items DB tables)
import { usePortal } from "@/context/portal-context";
import { PortalTopNav } from "@/components/portal-sidebar";
import { usePortalWorkspace } from "@/context/portal-workspace-context";
import { FavoritesStrip } from "@/components/favorites-strip";

// Phase 6b: iconKey → component lookup for workspace-derived nav (fallbacks per level).
const WS_NAV_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  radio: Radio, users: Users, wifi: Wifi, "git-branch": GitBranch, "bar-chart-2": BarChart2,
  wrench: Wrench, "shield-alert": ShieldAlert, settings: Settings, activity: Activity,
  globe: Globe, phone: Phone, server: Server, "line-chart": LineChart, eye: Eye,
  monitor: Monitor, database: Database, network: Network, "hard-drive": HardDrive,
  layers: Layers, shield: Shield, "file-text": FileText, lock: Lock, history: History,
  "layout-dashboard": LayoutDashboard, zap: Zap, map: MapIcon, "bar-chart-3": BarChart3,
  brain: Brain, sliders: SlidersHorizontal, mail: Mail, building: Building2,
  wallet: Wallet, "heart-pulse": HeartPulse, mic: Mic, bot: Bot, rewind: Rewind,
  star: Star, search: Search, bell: Bell, "trending-down": TrendingDown,
  "flask-conical": FlaskConical, "clipboard-list": ClipboardList, key: Key,
};

function openCommandBar() {
  document.dispatchEvent(new CustomEvent('open-command-palette', { bubbles: true }));
}

interface NavStats { activeIncidents: number; pendingApprovals: number; degradedCarriers: number; }
interface Module  { href: string; label: string; desc: string; icon: React.ComponentType<{ className?: string }>; readOnly?: boolean }
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
        { href: '/server-monitoring', label: 'Server Monitor',   desc: 'Infrastructure health',          icon: Server },
        { href: '/sbc-monitor',       label: 'SBC Monitor',      desc: 'Session border controller',      icon: HardDrive },
        { href: '/network-topology',  label: 'Network Topology', desc: 'Topology visualisation',         icon: Network },
        { href: '/live-traffic-map',  label: 'Live Traffic Map', desc: 'Geo-plotted live call flows',    icon: Globe },
        { href: '/graphs',            label: 'Graphs',           desc: 'Real-time performance charts',   icon: LineChart },
        { href: '/multi-switch',      label: 'Multi-Switch',     desc: 'Consolidated switch view',       icon: Layers },
      ]},
    ],
  },

  // ── 2. CLIENTS ───────────────────────────────────────────────────────────────
  {
    id: 'company', label: 'Clients', icon: Building2, color: 'text-amber-400',
    groups: [
      { label: 'Account Management', desc: 'Client accounts, portals and resellers', icon: Users, items: [
        { href: '/clients',          label: 'Accounts',        desc: 'All client accounts',           icon: Users },
        { href: '/client-portal',    label: 'Client Portal',   desc: 'Self-service client access',    icon: Globe },
        { href: '/client-identity',  label: 'Client Identity', desc: 'Canonical identity map & iTariff linking', icon: Shield },
        { href: '/kam-dashboard',    label: 'KAM Dashboard',   desc: 'Key Account Manager portfolio view', icon: LayoutDashboard },
        { href: '/reseller',         label: 'Resellers',       desc: 'Partner & reseller accounts',   icon: Star },
        { href: '/company/list',     label: 'Company List',    desc: 'All company profiles',          icon: Building2 },
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
        // Removed: Stability Timeline — canonical home is BitsEye
        { href: '/vendor-health',           label: 'Health Engine',      desc: 'Unified 0–100 vendor & route health score', icon: HeartPulse },
      ]},
      { label: 'Routing', desc: 'Routing groups, LCR analysis, simulators and route testing', icon: GitBranch, items: [
        { href: '/routing-manager',     label: 'Routing Manager', desc: 'Groups, connections & translations', icon: GitBranch },
        { href: '/auth-studio',         label: 'Auth Studio',     desc: 'Client → Destination → RG provisioning', icon: ShieldCheck },
        { href: '/lcr-analyser',        label: 'LCR Analyser',    desc: 'Least-cost routing engine',          icon: Calculator },
        { href: '/test-call',           label: 'Route Tester',    desc: 'On-demand route test calls',         icon: PhoneCall },
        { href: '/call-flow-simulator', label: 'Route Simulator', desc: 'Simulate routing decisions',         icon: ArrowRightLeft },
        { href: '/self-heal',           label: 'Self-Heal',       desc: 'Auto-healing & failover engine',     icon: HeartPulse },
        { href: '/route-testing',       label: 'Route Testing',   desc: 'Proactive scheduled route test calls',  icon: FlaskConical },
      ]},
      { label: 'Messaging', desc: 'BhaooSMS gateway, SMS delivery monitoring and A2P operations', icon: MessageSquare, items: [
        { href: '/sms-monitor',              label: 'SMS Monitor',            desc: 'Live delivery rates and gateway status',        icon: MessageSquare },
        { href: '/voice-otp',                label: 'Voice OTP',              desc: 'Asterisk AMI · OTP call origination',          icon: Phone },
        { href: '/communication-policies',   label: 'Comm Policies',          desc: 'Alert routing: SMS vs WhatsApp vs email',       icon: SlidersHorizontal },
        { href: '/commercial-notifications', label: 'Commercial Notifs',      desc: 'Rate change & invoice notification queue',      icon: Bell },
        { href: '/sender-profiles',          label: 'Sender Profiles',        desc: 'SMTP sender identity management',               icon: Mail },
        { href: '/termination-chains',       label: 'Termination Chains',     desc: 'End-to-end entity mapping across all systems',  icon: GitBranch },
      ]},
      { label: 'Diagnostics', desc: 'SIP tracing, session replay, test suites and engineering tools', icon: Wrench, items: [
        { href: '/sip-trace',      label: 'SIP Trace',      desc: 'Packet-level SIP tracing',  icon: Mic },
        { href: '/replay',         label: 'Replay Engine',  desc: 'Call session replay',        icon: Rewind },
        { href: '/test-campaigns', label: 'Test Campaigns', desc: 'Automated test suites',      icon: FlaskConical },
        { href: '/tools',          label: 'Tools',          desc: 'Engineering utilities',      icon: Wrench },
      ]},
    ],
  },

  // ── 4. BITSEYE TELEMETRY — Tier 1 Strategic Platform (frozen architecture) ──
  {
    id: 'telemetry', label: 'BitsEye', icon: Telescope, color: 'text-cyan-400',
    groups: [
      { label: 'Telemetry Platform', desc: 'Concurrent snapshot engine, live traffic and geo-plotted call flows', icon: Cpu, items: [
        { href: '/bitseye2', label: 'BitsEye 2.0',        desc: 'Concurrent snapshot engine · geo map · arc drill-down · Q-Score · entity intelligence', icon: Telescope },
        { href: '/bitseye',  label: 'BitsEye Classic',    desc: 'Classic drill-down CDR analytics surface',                                              icon: Eye },
        { href: '/calls',    label: 'Live Call Stream',   desc: 'Active calls with CLI/CLD, vendor, duration',                                           icon: Phone },
        { href: '/live-traffic-map', label: 'Traffic Map', desc: 'Geo-plotted live call flows on world map',                                             icon: Globe },
      ]},
      { label: 'Historical Warehouse', desc: 'Time-series telemetry: LIVE · DAILY · WEEKLY spans across all KPIs', icon: ClockIcon, items: [
        { href: '/bitseye2',        label: 'Entity History',     desc: 'Per-entity concurrent/ASR/ACD/Revenue/CPS over LIVE·DAILY·WEEKLY spans', icon: AreaChart },
        { href: '/graphs',          label: 'Graphs',             desc: 'Freeform performance charts and ad-hoc time-series workspace',             icon: LineChart },
        { href: '/rtp-analytics',   label: 'RTP / MOS History',  desc: 'Jitter, packet-loss, MOS over time — 60m/240m/1440m windows',             icon: Activity },
        { href: '/qos-heatmap',     label: 'QoS Heatmap',        desc: 'Hour-of-day × day-of-week quality heatmap per vendor/account',            icon: HeartPulse },
        { href: '/codec-analytics', label: 'Codec Analytics',    desc: 'Per-codec call distribution and quality correlation over time',            icon: Route },
      ]},
      { label: 'Comparative & Intelligence Views', desc: 'Vendor vs vendor, today vs yesterday, Q-Score arc drill-down and RCA foundation', icon: GitCompare, items: [
        { href: '/bitseye2',               label: 'Comparative Telemetry', desc: 'Today vs yesterday · vendor A vs B · entity drill-down side-by-side', icon: GitCompare },
        { href: '/vendor-stability-timeline', label: 'Stability Timeline', desc: 'Historical stability scoring with outage overlays per vendor',         icon: Activity },
        // Removed: Vendor RCA — canonical home is Intelligence
        { href: '/asr-acd',                label: 'ASR / ACD',             desc: 'Sippy-native ASR/ACD/NER aggregation via portal auth chain',           icon: BarChart3 },
      ]},
    ],
  },

  // ── 5. ANALYTICS ─────────────────────────────────────────────────────────────
  {
    id: 'analytics', label: 'Analytics', icon: BarChart2, color: 'text-indigo-400',
    groups: [
      { label: 'Traffic & Quality', desc: 'Call traffic, QoS and codec analytics', icon: Activity, items: [
        { href: '/analytics',       label: 'Traffic Analytics', desc: 'Call traffic analytics overview',  icon: Activity },
        // Removed: ASR/ACD, QoS Heatmap, RTP Analytics, Codec Analytics — canonical home is BitsEye
      ]},
      { label: 'Reports & Forecasting', desc: 'Revenue reports, traffic forecasting and executive summaries', icon: TrendingDown, items: [
        { href: '/reports',           label: 'Reports',           desc: 'Standard report centre',    icon: BarChart2 },
        { href: '/executive-reports', label: 'Executive Reports', desc: 'C-suite summary views',     icon: Star },
        { href: '/traffic-forecast',  label: 'Traffic Forecast',  desc: 'Demand forecasting',        icon: TrendingDown },
        { href: '/revenue-heatmap',   label: 'Revenue Heatmap',   desc: 'Revenue visualisation map', icon: MapIcon },
      ]},
      { label: 'CDR Records', desc: 'Call detail records and rerate engine', icon: History, items: [
        { href: '/cdrs',       label: 'CDR Viewer',  desc: 'Full call detail record browser',                    icon: History },
        { href: '/cdr-rerate', label: 'CDR Rerate',  desc: 'Re-apply updated rate cards to historical CDRs',     icon: ArrowRightLeft },
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
        { href: '/carrier-intelligence',       label: 'Carrier Intelligence', desc: 'Route health signals',           icon: Brain },
        { href: '/vendor-rca',                 label: 'Vendor RCA',           desc: 'Root cause analysis',            icon: Search },
        { href: '/vendor-prefix-intelligence', label: 'Prefix Intelligence',  desc: 'Prefix-level signals',           icon: Globe },
        { href: '/route-intelligence',         label: 'Route Intelligence',   desc: 'Route health scoring & decision trace audit', icon: Route },
        { href: '/routing-intelligence',       label: 'Routing Engine',       desc: 'Automated routing decision engine', icon: GitBranch },
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
        { href: '/fraud',        label: 'Fraud Engine',  desc: 'FAS/IRSF detection engine',             icon: ShieldAlert },
        { href: '/firewall',     label: 'Firewall',      desc: 'Auto-blacklist management',              icon: Shield },
        { href: '/security-ops', label: 'Security Ops',  desc: 'Unified security event feed',            icon: Monitor },
        { href: '/sla-breaches', label: 'SLA Breaches',  desc: 'SLA breach tracking',                   icon: Zap },
        { href: '/stir-shaken',  label: 'STIR/SHAKEN',   desc: 'Call attestation framework',             icon: Lock },
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
      { label: 'Dashboard', desc: 'Finance operations overview and KPI summary', icon: LayoutDashboard, items: [
        { href: '/finance-cockpit', label: 'Finance Cockpit', desc: 'Unified finance operations centre — billing, assurance and collections', icon: LayoutDashboard },
        { href: '/finance/health', label: 'Data Health', desc: 'Finance pipeline health, scheduler status and materialization history', icon: HeartPulse },
      ]},
      { label: 'Accounts Receivable', desc: 'Invoices, billing, credit and payment management', icon: FileText, items: [
        { href: '/billing',           label: 'Billing Overview',  desc: 'Billing summary & CDR-based payments',       icon: Wallet },
        { href: '/invoices',          label: 'Invoices',          desc: 'Invoice management and lifecycle',            icon: FileText },
        { href: '/invoice-jobs',      label: 'Invoice Queue',     desc: 'Scheduled invoice jobs',                     icon: ClipboardList },
        { href: '/credit-notes',      label: 'Credit Notes',      desc: 'Credit note issuance and application',       icon: History },
        { href: '/credit-control',    label: 'Credit Control',    desc: 'Credit rules, events and risk management',   icon: Banknote },
        { href: '/payment-reminders', label: 'Payment Reminders', desc: 'Dunning and payment reminder schedules',     icon: Bell },
        { href: '/account-statement', label: 'Account Statement', desc: 'Transaction-level per-account view',         icon: FileText },
      ]},
      { label: 'Accounts Payable', desc: 'Vendor bills, verification, approval, payments and statements', icon: Wallet, items: [
        { href: '/finance/business-partners',   label: 'Business Partners',   desc: 'Vendor, client and carrier master data',      icon: Building2 },
        { href: '/finance/vendor-bills',        label: 'Vendor Bills',        desc: 'AP invoices received from vendors',            icon: FileText },
        { href: '/finance/vendor-verification', label: 'Vendor Verification', desc: 'Review and verify vendor bills',               icon: ShieldCheck },
        { href: '/finance/vendor-approval',     label: 'Vendor Approval',     desc: 'Single and bulk bill approval workflow',       icon: CheckCircle },
        { href: '/finance/vendor-payments',     label: 'Vendor Payments',     desc: 'Record and allocate vendor payments',          icon: CreditCard },
        { href: '/finance/vendor-adjustments',  label: 'Vendor Adjustments',  desc: 'Debit and credit notes against vendors',       icon: Calculator },
        { href: '/finance/vendor-statement',    label: 'Vendor Statement',    desc: 'Vendor AP statement and running balance',      icon: FileSpreadsheet },
      ]},
      { label: 'Treasury', desc: 'Bank accounts, wallets, payment runs, reconciliation and cash position', icon: Landmark, items: [
        { href: '/finance/bank-accounts',       label: 'Bank Accounts',       desc: 'Current, savings and escrow bank accounts',    icon: Landmark },
        { href: '/finance/wallets',             label: 'Wallets',             desc: 'Crypto and stablecoin wallets (USDT, etc.)',   icon: Wallet },
        { href: '/finance/payment-runs',        label: 'Payment Runs',        desc: 'Batch vendor payment runs from treasury',      icon: SendHorizontal },
        { href: '/finance/bank-reconciliation', label: 'Bank Reconciliation', desc: 'Match bank statements to system transactions', icon: Scale },
        { href: '/finance/cash-position',       label: 'Cash Position',       desc: 'Net cash position and liquidity dashboard',   icon: PieChart },
      ]},
      { label: 'Revenue Assurance', desc: 'Reconciliation, margin intelligence, DMR and AI assurance', icon: Brain, items: [
        { href: '/finance/reconciliation', label: 'Reconciliation & AI',   desc: 'F3 snapshot reconciliation and AI evidence — internal consistency checks and anomaly detection', icon: ArrowRightLeft },
        { href: '/client-reconciliation',  label: 'Client Reconciliation', desc: 'Client-side billing reconciliation',  icon: ArrowRightLeft },
        { href: '/carrier-reconciliation', label: 'Carrier Reconciliation',desc: 'Carrier-side cost reconciliation',    icon: ArrowRightLeft },
        { href: '/cdr-reconciliation',     label: 'CDR Reconciliation',    desc: 'Call-by-call CDR dispute matching',   icon: ArrowRightLeft },
        { href: '/dmr',                    label: 'Daily Minutes Report',  desc: 'Daily usage and minute reconciliation', icon: Activity },
        { href: '/unbilled-usage',         label: 'Unbilled Usage',        desc: 'CDR usage not yet invoiced',          icon: Wallet },
        { href: '/margin-intelligence',    label: 'Margin Intelligence',   desc: 'Cost vs revenue margin analysis',     icon: TrendingDown },
        { href: '/ai-assurance',           label: 'AI Assurance',          desc: 'AI-driven revenue anomaly checks',    icon: BrainCircuit },
      ]},
      { label: 'Disputes', desc: 'Billing disputes, case tracking and defense toolkit', icon: Shield, items: [
        { href: '/billing-disputes', label: 'Billing Disputes', desc: 'Raise and manage billing disputes', icon: Shield },
        { href: '/dispute-cases',    label: 'Dispute Cases',    desc: 'Active dispute case tracker',       icon: ClipboardList },
        { href: '/dispute-defense',  label: 'Dispute Defense',  desc: 'Evidence and defense toolkit',      icon: ShieldAlert },
      ]},
      { label: 'Finance Settings', desc: 'Invoice templates, schedules and billing configuration', icon: FileSpreadsheet, items: [
        { href: '/invoice-templates',   label: 'Invoice Templates',    desc: 'Reusable invoice layout templates',             icon: FileSpreadsheet },
        { href: '/invoice-schedules',   label: 'Invoice Schedules',    desc: 'Automated billing cycle scheduling',            icon: History },
        { href: '/payment-terms',       label: 'Payment Terms',        desc: 'Due-date rules and early-payment discounts',    icon: ClockIcon },
        { href: '/numbering-prefixes',  label: 'Numbering & Prefixes', desc: 'Invoice number sequences and reference formats', icon: Hash },
        { href: '/reminder-rules',      label: 'Reminder Rules',       desc: 'Automated payment reminder schedules',          icon: Bell },
        { href: '/currency-settings',   label: 'Currency',             desc: 'Base currency and exchange rate settings',      icon: Banknote },
        { href: '/tax-vat',             label: 'Tax / VAT',            desc: 'VAT rules, rates and FTA compliance',           icon: FileText },
        { href: '/finance/pipeline-trace', label: 'Pipeline Trace',   desc: 'Why a customer with traffic did or did not become an invoice', icon: Route },
        { href: '/finance/company-profile', label: 'Company Profile',  desc: 'Issuer identity, bank remittance and invoice document defaults', icon: Building2 },
      ]},
    ],
  },

  // ── 8. PRODUCTS ──────────────────────────────────────────────────────────────
  {
    id: 'products', label: 'Products', icon: Package, color: 'text-violet-400',
    groups: [
      { label: 'Product Registry', desc: 'Product definitions, destinations, and assignment management', icon: Package, items: [
        { href: '/product-registry', label: 'Product Registry',    desc: 'Products, destinations & drag-drop assignments', icon: Package },
      ]},
      { label: 'Rate Operations', desc: 'Rate management, push workflow, and notification engine', icon: BarChart2, items: [
        { href: '/rate-manager',       label: 'Rate Manager',       desc: 'View & push rates with trunk-prefix encoding',  icon: BarChart2 },
        { href: '/client-rate-report', label: 'Client Rate Report', desc: 'Destination filtration by client account',      icon: FileSpreadsheet },
      ]},
      { label: 'Catalog Tools', desc: 'Routing templates, tariff versions, pricing policies, and assignment history', icon: Layers, items: [
        { href: '/destination-catalog',               label: 'Destination Catalog', desc: 'Global destination tree & approval workflow',     icon: Globe          },
        { href: '/tariff-profiles',                   label: 'Tariff Profiles',     desc: 'Excel/PDF rate sheet template management',        icon: FileSpreadsheet },
        { href: '/tariff-versions',                   label: 'Tariff Versions',     desc: 'Version history, diff viewer & rollback support', icon: History         },
        { href: '/rate-editor',                       label: 'Rate Editor',         desc: 'Inline prefix-by-prefix rate editing',            icon: FileSpreadsheet },
        { href: '/product-registry?tab=assignments',  label: 'Assignments',         desc: 'Drag & drop product assignments',                 icon: Layers          },
        { href: '/product-registry?tab=routing',      label: 'Routing Templates',   desc: 'Product routing template mgmt',                  icon: Route           },
        { href: '/product-registry?tab=history',      label: 'Change History',      desc: 'Product & destination audit log',                 icon: History         },
      ]},
    ],
  },

  // ── 9. VOICE TRADING ─────────────────────────────────────────────────────────
  {
    id: 'trading', label: 'Voice Trading', icon: Briefcase, color: 'text-amber-400',
    groups: [
      { label: 'Deals', desc: 'Commercial deal lifecycle — simulator, approvals, and board', icon: Briefcase, items: [
        { href: '/deals', label: 'Deal Workspace', desc: 'Deal board, simulator & approvals', icon: Briefcase },
      ]},
    ],
  },

  // ── 10. PLATFORM ─────────────────────────────────────────────────────────────
  {
    id: 'platform', label: 'Platform', icon: Settings, color: 'text-slate-400',
    groups: [
      { label: 'Diagnostics', desc: 'Reconciliation and diagnostic tools (Admin only)', icon: FlaskConical, items: [
        { href: '/recon-lab', label: 'Reconciliation Lab', desc: 'Recording integrity, CDR reconciliation, identity audit', icon: FlaskConical },
      ]},
      { label: 'Configuration', desc: 'Operational parameters, thresholds and governance values', icon: SlidersHorizontal, items: [
        { href: '/configuration-values', label: 'Configuration Values', desc: 'Platform operational parameters & thresholds', icon: SlidersHorizontal },
        { href: '/validation-rules',     label: 'Validation Rules',     desc: 'Rate violation actions by scope',              icon: Shield },
        { href: '/governance-review',    label: 'Governance Review',    desc: 'Formal sign-off for config and rules stack',   icon: ShieldCheck },
      ]},
      { label: 'System', desc: 'System configuration, workspaces, VPN and navigation', icon: Settings, items: [
        { href: '/settings',              label: 'Platform Settings',     desc: 'System configuration',           icon: Settings },
        { href: '/workspace-settings',    label: 'Workspace Settings',    desc: 'Portal workspaces & themes',     icon: Layers },
        { href: '/navigation-manager',      label: 'Navigation Manager',    desc: 'Sidebar item visibility',        icon: SlidersHorizontal },
        { href: '/governance',            label: 'Governance Console',    desc: 'Module assignments & sections',  icon: Shield },
        { href: '/navigation-governance', label: 'Nav Governance',        desc: 'Navigation module visibility & role gates', icon: Monitor },
        { href: '/console',               label: 'Platform Console',      desc: 'Live log viewer & diagnostic runner', icon: Database },
        { href: '/vpn-config',            label: 'VPN Config',            desc: 'VPN configuration',              icon: Lock },
      ]},
      { label: 'Team & Access', desc: 'Team roles, access control and API keys', icon: Users, items: [
        { href: '/team',          label: 'Team & KAM', desc: 'Roles & access control',       icon: Users },
        { href: '/kam-dashboard', label: 'KAM View',   desc: 'Key Account Manager dashboard', icon: LayoutDashboard },
        { href: '/api-keys',      label: 'API Keys',   desc: 'API key management',            icon: Key },
      ]},
      { label: 'Notifications', desc: 'WhatsApp, email and platform notification configuration', icon: Mail, items: [
        { href: '/notification-centre',      label: 'Notification Centre',  desc: 'All platform notifications',       icon: Bell },
        { href: '/email-centre',             label: 'Email Centre',         desc: 'Email notification rules',         icon: Mail },
        { href: '/whatsapp-alerts',          label: 'WhatsApp Alerts',      desc: 'Alert delivery via WhatsApp',      icon: MessageSquare },
        { href: '/chat',                     label: 'Team Chat',            desc: 'Internal real-time team messaging', icon: MessageSquare },
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

// ── Portal route resolver (DB-driven) ──────────────────────────────────────────
function resolveNavHref(
  href: string,
  portal: string | null,
  routeToModule: Record<string, string>
): string {
  if (!portal) return href;
  const moduleKey = routeToModule[href.replace(/\/+$/, '')];
  return moduleKey ? `/${portal}/${moduleKey}` : href;
}

// ── Cascade Menu (L2 dropdown + L3 submenu) ───────────────────────────────────
function CascadeMenu({ domain, onClose, openLeft, stats, hiddenItems, portalItems, resolveHref }: {
  domain: Domain; onClose: () => void; openLeft?: boolean; stats: NavStats; hiddenItems: Set<string>;
  portalItems?: Set<string>;                   // when set, only these hrefs are shown
  resolveHref?: (href: string) => string;      // when set, resolves item links to portal routes
}) {
  const { activePortal, modules: portalModules } = usePortal();
  const routeToModuleKey = useMemo(
    () => Object.fromEntries((portalModules ?? []).map(m => [m.route.replace(/\/+$/, ''), m.moduleKey])),
    [portalModules]
  );
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

  // Filter out hidden items (and portal-restricted items when in portal mode); skip empty groups
  const visibleGroups = domain.groups
    .map(group => ({
      ...group,
      items: group.items.filter(item =>
        !hiddenItems.has(item.href) &&
        (!portalItems || portalItems.has(item.href))
      ),
    }))
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
                      href={resolveHref ? resolveHref(item.href) : item.href}
                      onClick={onClose}
                      data-testid={`nav-module-${item.href.replace(/\//g, '-')}`}
                    >
                      <div className="flex items-center gap-2.5 px-2 py-1.5 mx-1 rounded-lg hover:bg-white/[0.07] transition-colors cursor-pointer group">
                        <div className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 bg-white/[0.04] group-hover:bg-white/[0.09] transition-colors">
                          <item.icon className={cn("w-3.5 h-3.5", domain.color)} />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[12px] font-medium text-foreground leading-tight">{item.label}</span>
                            {item.readOnly && (
                              <span className="text-[8px] font-bold uppercase tracking-wide px-1 py-px rounded bg-white/[0.08] text-muted-foreground/70 leading-none flex-shrink-0">
                                read-only
                              </span>
                            )}
                          </div>
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

// Domains that own their own portal workspace — hidden in ALL portal modes.
// IDs confirmed from DOMAINS: finance, products, trading (Voice Trading).
const PORTAL_OWNED_DOMAINS = new Set(['finance', 'products', 'trading', 'platform']);

export function AppNavShell() {
  const [location, navigate]  = useLocation();
  const search                = useSearch();
  const [openDomain, setOpen]             = useState<string | null>(null);
  const [hiddenDomains, setHiddenDomains] = useState<Set<string>>(() => {
    try { const s = localStorage.getItem(NAV_HIDDEN_KEY); return s ? new Set<string>(JSON.parse(s)) : new Set<string>(); } catch { return new Set<string>(); }
  });
  const [showNavConfig, setShowNavConfig] = useState(false);
  const [overflowOpen, setOverflowOpen]   = useState(false);
  const overflowRef                       = useRef<HTMLDivElement | null>(null);
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

  // Phase 6b (Top Menu + Cascade consumer): with portalWorkspaceNavigation ON
  // and the workspace loaded, domain tabs + cascade content render EXCLUSIVELY
  // from workspace.navigation.domains. The portal never filters a global list —
  // domains the workspace didn't send simply do not exist here. Legacy Model B
  // (DOMAINS + portal_top_nav_* config) remains the fallback path.
  const { enabled: wsEnabled, workspace } = usePortalWorkspace();
  const wsMode = wsEnabled && !!workspace;

  const wsDomains = useMemo<Domain[]>(() => {
    if (!wsMode) return [];
    return workspace!.navigation.domains.map(d => ({
      id:    d.id,
      label: d.label,
      icon:  WS_NAV_ICONS[d.iconKey] ?? Radio,
      color: d.colorClass || 'text-muted-foreground',
      groups: d.groups.map(g => ({
        label: g.label,
        icon:  WS_NAV_ICONS[g.iconKey] ?? Layers,
        items: g.items.map(it => ({
          // portalRoute (e.g. '/noc/call-recordings'), NOT route (e.g. '/call-recordings')
          // — the workspace API already computed the portal-scoped path. Using the bare
          // platform route here sent users out of the portal on click.
          href:     it.portalRoute,
          label:    it.title,
          desc:     '',
          icon:     WS_NAV_ICONS[it.iconKey] ?? Activity,
          readOnly: it.visibility === 'read-only',
        })),
      })),
    }));
  }, [wsMode, workspace]);

  const effectiveDomains = wsMode ? wsDomains : DOMAINS;

  // ── Portal-specific top-nav config (Model B legacy — unused in wsMode) ──
  const { data: portalTopNav } = useQuery<{ domainIds: string[]; items: Record<string, string[]> }>({
    queryKey: ['/api/portals', activePortalSlug, 'top-nav'],
    queryFn: async () => {
      const r = await fetch(`/api/portals/${activePortalSlug}/top-nav`);
      return r.ok ? r.json() : null;
    },
    enabled: !!activePortalSlug && isPortalMode && !wsMode,
    staleTime: 5 * 60_000,
  });

  // Portal module assignments — for route → moduleKey resolution (keeps nav inside portal)
  const { data: portalModuleList = [] } = useQuery<Array<{ route: string; moduleKey: string }>>({
    queryKey: ['/api/portal/modules', activePortalSlug],
    queryFn: async () => {
      const r = await fetch(`/api/portal/modules/${activePortalSlug}`);
      return r.ok ? r.json() : [];
    },
    enabled: !!activePortalSlug && isPortalMode,
    staleTime: 5 * 60_000,
  });

  // route → moduleKey map (e.g. '/calls' → 'live_calls')
  const routeToModuleKey = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of portalModuleList as Array<{ route: string; moduleKey: string }>) {
      if (m.route && m.moduleKey) map[m.route.replace(/\/+$/, '')] = m.moduleKey;
    }
    return map;
  }, [portalModuleList]);

  // Resolves a platform href to a portal-relative href (e.g. '/calls' → '/noc/live_calls')
  const resolvePortalHref = useCallback((href: string): string => {
    if (!activePortalSlug) return href;
    const moduleKey = routeToModuleKey[href.replace(/\/+$/, '')];
    return moduleKey ? `/${activePortalSlug}/${moduleKey}` : href;
  }, [activePortalSlug, routeToModuleKey]);

  const WORKSPACE_DEFAULT_ROUTE: Record<string, string> = {
    'billing-ops':        '/billing',
    'revenue-assurance':  '/dmr',
    'dispute-governance': '/billing-disputes',
    'noc-ops':            '/noc-dashboard',
    'analytics-hub':      '/analytics',
  };
  const WORKSPACE_ROUTES: Record<string, string[]> = {
    'billing-ops':        ['/billing', '/invoices', '/invoice-jobs', '/invoice-templates', '/credit-notes', '/credit-control', '/products', '/rate-cards', '/tariff-versions', '/unbilled-usage', '/account-statement', '/invoice-schedules', '/payment-reminders'],
    'revenue-assurance':  ['/dmr', '/client-reconciliation', '/carrier-reconciliation', '/cdr-reconciliation', '/ai-assurance', '/margin-intelligence', '/traffic-forecast', '/revenue-heatmap'],
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
  const activeDomain  = effectiveDomains.find(d => d.id === meta.domain);
  const isDashboard   = location === '/';
  // In portal mode the persistent "Dashboard" button points at the portal home
  // (/noc), so it keeps the user inside the portal instead of exiting to the platform.
  const portalHome    = isPortalMode && activePortalSlug ? `/${activePortalSlug}` : '/';
  const dashActive    = location === portalHome;
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

  useEffect(() => {
    function handleOF(e: MouseEvent) {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) setOverflowOpen(false);
    }
    document.addEventListener('mousedown', handleOF);
    return () => document.removeEventListener('mousedown', handleOF);
  }, []);

  function toggleDomainVisibility(id: string) {
    setHiddenDomains(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  // Phase 6b: workspace mode renders the workspace's domains verbatim (already
  // portal-scoped and ordered — no filtering, no exclusions). Legacy: portal
  // config filter over the static DOMAINS registry, else unhidden domains.
  const visibleDomains = useMemo(() => {
    if (wsMode) return wsDomains;
    if (isPortalMode && portalTopNav?.domainIds?.length) {
      return portalTopNav.domainIds
        .map(id => DOMAINS.find(d => d.id === id))
        .filter(Boolean) as typeof DOMAINS;
    }
    return DOMAINS.filter(d => !hiddenDomains.has(d.id));
  }, [wsMode, wsDomains, isPortalMode, portalTopNav, hiddenDomains]);

  const MAX_NAV_TABS    = 8;
  const shownDomains    = visibleDomains.slice(0, MAX_NAV_TABS);
  const overflowDomains = visibleDomains.slice(MAX_NAV_TABS);

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

          {/* Dashboard — portal-aware: goes to the portal home when in a portal */}
          <Link
            href={portalHome}
            data-testid="nav-dashboard"
            className={cn(
              "flex items-center gap-1.5 h-[30px] px-2.5 rounded-md text-[11px] font-semibold transition-all duration-150 whitespace-nowrap flex-shrink-0",
              dashActive
                ? "text-foreground bg-white/[0.08]"
                : "text-muted-foreground/65 hover:text-foreground hover:bg-white/[0.05]"
            )}
          >
            <LayoutDashboard className={cn("w-3.5 h-3.5", dashActive ? "text-indigo-400" : "")} />
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

        {/* ── Centre nav: domain cascade tabs (portal-filtered in portal mode) ── */}
        <nav className="flex items-center gap-0.5 flex-1 min-w-0 overflow-x-auto [&::-webkit-scrollbar]:hidden" role="menubar">
          {shownDomains.map(domain => {
            const isActive = meta.domain === domain.id;
            const isOpen   = openDomain === domain.id;
            // In portal mode the domain label click opens the cascade (no workspace page);
            // in platform mode it navigates to /workspace/<domain>.
            const domainHref = isPortalMode ? portalHome : `/workspace/${domain.id}`;
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
                  href={domainHref}
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

        {/* ── Overflow "More" — domains beyond MAX_NAV_TABS (e.g. Products, Voice
              Trading, Platform). Previously computed (overflowDomains) but never
              rendered, making these domains unreachable from the top menu. ── */}
        {overflowDomains.length > 0 && (
          <div className="relative flex-shrink-0" ref={overflowRef}>
            <button
              onClick={() => setOverflowOpen(v => !v)}
              data-testid="nav-domain-more"
              aria-haspopup="true"
              aria-expanded={overflowOpen}
              aria-label="More workspaces"
              className={cn(
                "flex items-center gap-1 h-[36px] px-2 rounded-lg text-[11px] font-semibold transition-all duration-150 whitespace-nowrap",
                overflowOpen
                  ? "text-foreground bg-white/[0.08]"
                  : "text-muted-foreground/60 hover:text-foreground hover:bg-white/[0.05]"
              )}
            >
              <MoreHorizontal className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">More</span>
              <ChevronDown className={cn("w-2.5 h-2.5 transition-transform duration-150", overflowOpen && "rotate-180")} />
            </button>
            {overflowOpen && (
              <div
                className="absolute top-full right-0 mt-1.5 z-[150] py-1.5 rounded-xl min-w-[180px]"
                style={{
                  background: 'hsl(var(--background)/0.98)',
                  backdropFilter: 'blur(20px)',
                  WebkitBackdropFilter: 'blur(20px)',
                  border: '1px solid rgba(255,255,255,0.07)',
                  boxShadow: '0 16px 48px rgba(0,0,0,0.45)',
                }}
              >
                {overflowDomains.map(domain => {
                  const isActive = meta.domain === domain.id;
                  const isOpen   = openDomain === domain.id;
                  const domainHref = isPortalMode ? portalHome : `/workspace/${domain.id}`;
                  return (
                    <div
                      key={domain.id}
                      ref={el => { if (el) tabRefs.current.set(domain.id, el); }}
                      role="menuitem"
                      className={cn(
                        "flex items-center gap-2 mx-1.5 px-2.5 h-[32px] rounded-md text-[11px] font-semibold transition-all duration-150 cursor-pointer",
                        isActive || isOpen
                          ? "text-foreground bg-white/[0.08]"
                          : "text-muted-foreground/70 hover:text-foreground hover:bg-white/[0.05]"
                      )}
                      onMouseEnter={() => { cancelClose(); setOpen(domain.id); setOverflowOpen(false); }}
                      onMouseLeave={scheduleClose}
                    >
                      <Link
                        href={domainHref}
                        data-testid={`nav-domain-${domain.id}`}
                        onClick={() => { setOpen(null); setOverflowOpen(false); }}
                        className="flex items-center gap-2 flex-1"
                        aria-label={`${domain.label} workspace`}
                      >
                        <domain.icon className={cn("w-3.5 h-3.5 flex-shrink-0", isActive ? domain.color : '')} />
                        <span>{domain.label}</span>
                      </Link>
                      <ChevronRight className="w-3 h-3 opacity-40 flex-shrink-0" />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

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
                            // setPortal is URL-driven → navigates to the portal home (/:slug).
                            // Do NOT also navigate to defaultRoute: for NOC that is the legacy
                            // main-platform route (/calls), which drops the user out of the portal.
                            if (activePortalSlug === p.slug) exitPortalMode();
                            else setPortal(p.slug as any);
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

            {/* ── ROW 2: portal section tabs ── */}
            {/* ── Cascade menu — positioned below the hovered tab ── */}
      {openDomain && (() => {
        const tabEl   = tabRefs.current.get(openDomain);
        const shellEl = shellRef.current;
        const domain  = effectiveDomains.find(d => d.id === openDomain);
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
              hiddenItems={wsMode ? new Set<string>() : hiddenItemsSet}
              portalItems={
                !wsMode && isPortalMode && portalTopNav?.items?.[openDomain]
                  ? new Set(portalTopNav.items[openDomain])
                  : undefined
              }
              // wsMode items already carry the portal-scoped portalRoute — resolving
              // through the legacy module map (built from portal_module_assignments,
              // which doesn't cover every workspace-visible module) sent users to the
              // bare platform route on click. Only apply the legacy resolver in Model B.
              resolveHref={!wsMode && isPortalMode ? resolvePortalHref : undefined}
            />
          </div>
        );
      })()}
    </div>
  );
}
