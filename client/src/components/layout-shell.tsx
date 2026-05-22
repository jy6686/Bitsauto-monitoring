import { Link, useLocation, useSearch } from "wouter";
import { LayoutDashboard, Phone, Bell, Settings, Activity, BarChart2, Users, Building2, UserCog, ShieldAlert, FileText, Wrench, Globe, Wallet, PhoneIncoming, ChevronDown, BarChart3, List, HeartPulse, History, Server, Wifi, TrendingDown, HardDrive, Radio, LineChart, Eye, ContactRound, ChevronRight, PanelLeftClose, PanelLeftOpen, LogOut, ScanSearch, CreditCard, TrendingUp, Sun, Moon, Menu, Key, Command, PhoneCall, GitBranch, Workflow, ShieldCheck, Lightbulb, Layers, MessageSquare, Package, FlaskConical, Shield, Lock, Mail, Star, Calculator, Zap, Route, ArrowRightLeft, Database, Network, Upload, Search, GripVertical, RotateCcw, Bot, MessageCircle, FileCheck2, Rewind, Monitor, Mic, SlidersHorizontal, Plus, Trash2, X, FolderPlus, UserPlus, ClipboardList, Brain, FileSpreadsheet } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Role } from "@shared/schema";
import { MGMT_CONFIGURABLE_FEATURES } from "@shared/schema";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { CommandBar } from "@/components/command-bar";
import { FixButton } from "@/components/fix-button";
import { AppNavShell } from "@/components/app-nav-shell";
import { SippyHealthBadge } from "@/components/sippy-health-badge";
import { useOrgScope } from "@/context/org-scope-context";

interface Kam { id: number; name: string; active: boolean; }

const BITSEYE_FIXED = [
  { view: 'clients',      label: 'Clients',      iconColor: 'text-amber-400'  },
  { view: 'vendors',      label: 'Vendors',       iconColor: 'text-cyan-400'   },
  { view: 'destinations', label: 'Destinations',  iconColor: 'text-emerald-400'},
  { view: 'countries',    label: 'Countries',     iconColor: 'text-sky-400'    },
] as const;

interface LayoutShellProps { children: React.ReactNode; }

const ROLE_BADGE: Record<Role, { label: string; color: string }> = {
  super_admin:  { label: "Super Admin",  color: "text-violet-400 bg-violet-500/10" },
  admin:        { label: "Admin",        color: "text-rose-400 bg-rose-500/10"     },
  noc_operator: { label: "NOC Operator", color: "text-cyan-400 bg-cyan-500/10"     },
  team_lead:    { label: "Team Lead",    color: "text-emerald-400 bg-emerald-500/10"},
  management:   { label: "Management",  color: "text-amber-400 bg-amber-500/10"   },
  viewer:       { label: "Viewer",       color: "text-blue-400 bg-blue-500/10"     },
};

// ── Sub-item arrays ────────────────────────────────────────────────────────────

const CALLS_SUBITEMS = [
  { view: 'summary', label: 'Call Summary',    icon: BarChart3,  iconColor: 'text-violet-400', itemId: 'live_summary' },
  { view: 'details', label: 'Call Details',    icon: List,       iconColor: 'text-cyan-400',   itemId: 'live_details' },
  { view: 'quality', label: 'Quality Monitor', icon: HeartPulse, iconColor: 'text-rose-400',   itemId: 'live_quality' },
  { view: 'history', label: 'Call History',    icon: History,    iconColor: 'text-amber-400',  itemId: 'call_history' },
] as const;

const CDR_SUBITEMS = [
  { view: 'client', label: 'Client CDRs', iconColor: 'text-amber-400' },
  { view: 'vendor', label: 'Vendor CDRs', iconColor: 'text-cyan-400'  },
] as const;

const MONITORING_SUBITEMS = [
  { tab: 'reachability',  label: 'Reachability',     icon: Wifi,        iconColor: 'text-emerald-400' },
  { tab: 'bandwidth',     label: 'Bandwidth (RTP)',  icon: Activity,    iconColor: 'text-cyan-400'    },
  { tab: 'disk-memory',   label: 'Disk & Memory',    icon: HardDrive,   iconColor: 'text-amber-400'   },
  { tab: 'carrier-asr',   label: 'Carrier ASR',      icon: TrendingDown,iconColor: 'text-violet-400'  },
  { tab: 'alert-rules',   label: 'Alert Rules',      icon: Bell,        iconColor: 'text-blue-400'    },
  { tab: 'registrations', label: 'Reg Storm',        icon: Radio,       iconColor: 'text-rose-400'    },
] as const;

const ROUTING_MGR_SUBITEMS = [
  { tab: 'routing-groups',   label: 'Routing Groups',   icon: Database,    iconColor: 'text-violet-400' },
  { tab: 'destination-sets', label: 'Destination Sets', icon: Layers,      iconColor: 'text-cyan-400'   },
  { tab: 'connections',      label: 'Connections',      icon: Network,     iconColor: 'text-emerald-400'},
  { tab: 'on-net',           label: 'On-Net Routing',  icon: Wifi,        iconColor: 'text-blue-400'   },
  { tab: 'qbr',              label: 'QBR Dashboard',   icon: ShieldCheck, iconColor: 'text-amber-400'  },
  { tab: 'policy-sim',       label: 'Policy Sim',      icon: Calculator,  iconColor: 'text-rose-400'   },
] as const;

const TOOLS_SUBITEMS = [
  { tab: 'carrier',     label: 'Carrier Quality',  icon: Star,          iconColor: 'text-amber-400'  },
  { tab: 'capacity',    label: 'SIP Capacity',     icon: Calculator,    iconColor: 'text-cyan-400'   },
  { tab: 'bandwidth',   label: 'Bandwidth Plan',   icon: Wifi,          iconColor: 'text-emerald-400'},
  { tab: 'burst',       label: 'Burst Simulator',  icon: Zap,           iconColor: 'text-yellow-400' },
  { tab: 'route',       label: 'Route Tester',     icon: Route,         iconColor: 'text-violet-400' },
  { tab: 'translation', label: 'Translation',      icon: ArrowRightLeft,iconColor: 'text-blue-400'   },
] as const;

const TEST_SUBITEMS = [
  { href: '/test-call',      label: 'Test Call',  icon: PhoneCall,    iconColor: 'text-green-400'  },
  { href: '/test-campaigns', label: 'Campaigns',  icon: FlaskConical, iconColor: 'text-violet-400' },
] as const;

const NOTIF_SUBITEMS = [
  { href: '/notification-centre', label: 'Notification Centre', icon: Bell,          iconColor: 'text-indigo-400' },
  { href: '/email-centre',        label: 'Email',               icon: Mail,          iconColor: 'text-blue-400'   },
  { href: '/whatsapp-alerts',     label: 'WhatsApp',            icon: MessageSquare, iconColor: 'text-green-400'  },
] as const;

const COMPANY_SUBITEMS = [
  { href: '/company/list',   label: 'Company List',   icon: List,     iconColor: 'text-amber-300' },
  { href: '/company/create', label: 'Create Company', icon: Plus,     iconColor: 'text-amber-300' },
] as const;

const CLIENT_SUBITEMS = [
  { href: '/client/wizard',                label: 'Create Client',         icon: UserPlus,    iconColor: 'text-amber-400', isNew: true  },
  { href: '/client/config?tab=update',     label: 'Client Update',         icon: UserCog,     iconColor: 'text-sky-400'                },
  { href: '/client/config?tab=email',      label: 'Email',                 icon: Mail,        iconColor: 'text-sky-400'                },
  { href: '/client/config?tab=trunks',     label: 'Trunk Update',          icon: Network,     iconColor: 'text-sky-400'                },
  { href: '/client/config?tab=auth',       label: 'Authentication Update', icon: ShieldCheck, iconColor: 'text-sky-400'                },
  { href: '/client/config?tab=technical',  label: 'Technical Config',      icon: Server,      iconColor: 'text-sky-400'                },
  { href: '/client/config?tab=ratesheet',  label: 'Rate Sheet Config',     icon: FileText,    iconColor: 'text-sky-400'                },
  { href: '/client/config?tab=rules',      label: 'Rules Update',          icon: ShieldAlert, iconColor: 'text-sky-400'                },
  { href: '/client/config?tab=email-format', label: 'Email Format',        icon: Mail,        iconColor: 'text-sky-400'                },
] as const;

// ── Types ──────────────────────────────────────────────────────────────────────

type SubmenuType = 'calls' | 'bitseye' | 'cdr' | 'monitoring' | 'ratecards' | 'settings' | 'tools' | 'routingmgr' | 'testing' | 'notifications' | 'company_grp' | 'client_grp';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: Role[];
  hasSubmenu?: SubmenuType;
  status?: 'live' | 'partial' | 'planned';
  isNew?: boolean;
}

interface NavGroup {
  key: string;
  label: string;
  roles: Role[];
  items: NavItem[];
}

interface CustomGroup {
  id: string;
  label: string;
  tint: string;
  itemHrefs: string[];
}

// ── Navigation structure — 6 groups ───────────────────────────────────────────

const NAV_PINNED_TOP: NavItem[] = [
  { href: "/",     label: "Dashboard", icon: LayoutDashboard, roles: ['admin','management','viewer'] },
  { href: "/chat", label: "Team Chat", icon: MessageSquare,   roles: ['admin','management','viewer'] },
];

const NAV_PINNED_BOTTOM: NavItem[] = [
  { href: "/account", label: "My Account", icon: UserCog, roles: ['admin','management','viewer'] },
];

export const SIDEBAR_GROUPS: NavGroup[] = [
  // ─── 1. Company ──────────────────────────────────────────────────────────────
  {
    key: 'company',
    label: 'Company',
    roles: ['admin','management'],
    items: [
      { href: "/company/list",    label: "Company Profile", icon: Building2,     roles: ['admin','management'], hasSubmenu: 'company_grp' as const },
      { href: "/clients",         label: "Accounts",        icon: Users,         roles: ['admin','management']                                      },
      { href: "/balance",         label: "Balance",         icon: Wallet,        roles: ['admin','management']                                      },
      { href: "/client-portal",   label: "Client Portal",   icon: Globe,         roles: ['admin','management']                                      },
      { href: "/dids",            label: "DID Management",  icon: PhoneIncoming, roles: ['admin','management']                                      },
      { href: "/client/wizard",   label: "Create Account",  icon: UserPlus,      roles: ['admin','management']                                      },
    ],
  },
  // ─── 2. Operations (Execution Layer) ─────────────────────────────────────────
  {
    key: 'operations',
    label: 'Operations',
    roles: ['admin','management'],
    items: [
      { href: "/routing-manager",                      label: "Routing Manager",   icon: Database,    roles: ['admin','management'], hasSubmenu: 'routingmgr'                              },
      { href: "/vendors",                              label: "Vendors",            icon: Building2,   roles: ['admin','management','super_admin','noc_operator','team_lead']                },
      { href: "/vendor-prefix-intelligence",           label: "Prefix Intelligence",  icon: Globe,        roles: ['admin','management'], isNew: true                                            },
      { href: "/vendor-stability-timeline",            label: "Stability Timeline",   icon: Activity,     roles: ['admin','management'], isNew: true                                            },
      { href: "/vendor-rca",                           label: "RCA Drilldown",        icon: ScanSearch,   roles: ['admin','management'], isNew: true                                            },
      { href: "/routing-manager?tab=connections",      label: "Connections",        icon: Network,     roles: ['admin','management']                                                         },
      { href: "/routing-manager?tab=destination-sets", label: "Destination Sets",   icon: Layers,      roles: ['admin','management']                                                         },
      { href: "/lcr-analyser",                         label: "LCR Analyser",       icon: GitBranch,   roles: ['admin','management']                                                         },
      { href: "/self-heal",                            label: "Self-Heal Routes",   icon: HeartPulse,  roles: ['admin','management'], isNew: true                                           },
      { href: "/approvals",                            label: "Approval Queue",     icon: ShieldCheck, roles: ['admin','management','super_admin','noc_operator','team_lead'], status: 'live' },
      { href: "/rate-cards",                           label: "Rate Cards",         icon: CreditCard,  roles: ['admin','management'], hasSubmenu: 'ratecards'                               },
      { href: "/company-profile",                      label: "Rate Plan",          icon: ContactRound,roles: ['admin','management']                                                         },
    ],
  },
  // ─── 3. Live Network ─────────────────────────────────────────────────────────
  {
    key: 'live_network',
    label: 'Live Network',
    roles: ['admin','management','viewer'],
    items: [
      { href: "/console",      label: "Unified Console",   icon: Zap,      roles: ['admin','management','noc_operator','team_lead','super_admin'], isNew: true },
      { href: "/calls",        label: "Live Calls",        icon: Phone,    roles: ['admin','management','viewer'], hasSubmenu: 'calls', status: 'live' },
      { href: "/alerts",       label: "Alerts",            icon: Bell,     roles: ['admin','management','super_admin','noc_operator','team_lead']    },
      { href: "/sbc-monitor",  label: "SBC Monitor",       icon: Network,  roles: ['admin','management','super_admin','noc_operator','team_lead']    },
      { href: "/traffic-map",  label: "Traffic Map",       icon: Globe,    roles: ['admin','management']                                              },
      { href: "/multi-switch", label: "Multi-Switch View", icon: Layers,   roles: ['admin','management']                                              },
      { href: "/noc-command",  label: "NOC View",          icon: Monitor,  roles: ['admin','management','super_admin','noc_operator','team_lead'], isNew: true },
      { href: "/ops-console",  label: "Ops Console",       icon: Layers,   roles: ['admin','management','super_admin','noc_operator','team_lead'], isNew: true },
    ],
  },
  // ─── 4. Intelligence (observation + health signals) ──────────────────────────
  {
    key: 'intelligence',
    label: 'Intelligence',
    roles: ['admin','management','super_admin','noc_operator','team_lead'],
    items: [
      { href: "/carrier-intelligence",      label: "Carrier Intelligence", icon: Activity,  roles: ['admin','management','super_admin','noc_operator','team_lead'], isNew: true },
      { href: "/carrier-scoring",           label: "Carrier Scoring",      icon: BarChart3, roles: ['admin','management','super_admin','noc_operator','team_lead'], isNew: true },
      { href: "/intelligence",              label: "Intelligence Hub",     icon: Brain,     roles: ['admin','management'], isNew: true },
      { href: "/intelligence-validation",   label: "Validation Console",   icon: FlaskConical, roles: ['admin','management'], isNew: true },
      { href: "/ai-ops?tab=decision-overlay", label: "Decision Overlay",  icon: Eye,       roles: ['admin','management','super_admin','noc_operator','team_lead'], isNew: true },
    ],
  },
  // ─── 5. AI Ops (anomaly + interpretation) ────────────────────────────────────
  {
    key: 'ai_ops',
    label: 'AI Ops',
    roles: ['admin','management','super_admin','noc_operator','team_lead'],
    items: [
      { href: "/ai-ops",  label: "AI Ops Center", icon: Bot,        roles: ['admin','management','super_admin','noc_operator','team_lead'], isNew: true },
      { href: "/fraud",   label: "Fraud / FAS",   icon: ShieldAlert,roles: ['admin','management']              },
    ],
  },
  // ─── 6. Simulation (what-if — isolated, read-only) ───────────────────────────
  {
    key: 'simulation',
    label: 'Simulation',
    roles: ['admin','management'],
    items: [
      { href: "/routing-manager?tab=impact-sim",  label: "Impact Simulator",  icon: Zap,         roles: ['admin','management'], isNew: true },
      { href: "/routing-manager?tab=policy-sim",  label: "Policy Simulator",  icon: Calculator,  roles: ['admin','management']              },
      { href: "/call-flow-simulator",             label: "Call Flow Sim",     icon: Workflow,    roles: ['admin','management']              },
    ],
  },
  // ─── 7. Analytics ────────────────────────────────────────────────────────────
  {
    key: 'analytics',
    label: 'Analytics',
    roles: ['admin','management'],
    items: [
      { href: "/analytics",        label: "Revenue Analytics",  icon: TrendingUp,  roles: ['admin','management']                    },
      { href: "/cdrs",             label: "CDR Viewer",         icon: FileText,    roles: ['admin','management'], hasSubmenu: 'cdr' },
      { href: "/graphs",           label: "Graphs",             icon: LineChart,   roles: ['admin','management']                    },
      { href: "/qos-heatmap",      label: "QoS Heatmap",        icon: Activity,    roles: ['admin','management']                    },
      { href: "/revenue-heatmap",  label: "Revenue Heatmap",    icon: Globe,       roles: ['admin','management'], isNew: true      },
      { href: "/codec-analytics",  label: "Codec Analytics",    icon: Radio,       roles: ['admin','management'], isNew: true      },
      { href: "/traffic-forecast", label: "Traffic Forecast",   icon: TrendingUp,  roles: ['admin','management'], isNew: true      },
      { href: "/reports",          label: "Reports",            icon: BarChart2,   roles: ['admin','management']                    },
      { href: "/bitseye",          label: "BitsEye",            icon: Eye,         roles: ['admin','management'], hasSubmenu: 'bitseye' },
      { href: "/cost-optimisation",label: "Cost Optimisation",  icon: Lightbulb,   roles: ['admin','management']                    },
    ],
  },
  // ─── 8. Reports (Sippy-parity truth layer — auditable, filterable, exportable) ─
  {
    key: 'reports',
    label: 'Reports',
    roles: ['admin','management'],
    items: [
      { href: "/live-traffic", label: "Live Traffic",     icon: Activity,        roles: ['admin','management','noc_operator','viewer','team_lead','super_admin'], isNew: true },
      { href: "/asr-acd",      label: "ASR / ACD Report", icon: FileSpreadsheet, roles: ['admin','management'], isNew: true },
    ],
  },
  // ─── 9. Troubleshooting (keep cohesive — do not fragment) ────────────────────
  {
    key: 'troubleshooting',
    label: 'Troubleshooting',
    roles: ['admin','management'],
    items: [
      { href: "/sip-trace",           label: "SIP Trace Viewer",    icon: GitBranch,  roles: ['admin','management'], isNew: true              },
      { href: "/rtp-analytics",       label: "RTP Analytics",       icon: Radio,      roles: ['admin','management']                           },
      { href: "/replay",              label: "Replay Engine",       icon: Rewind,     roles: ['admin','management'], isNew: true              },
      { href: "/server-monitoring",   label: "Server Monitoring",   icon: Server,     roles: ['admin','management'], hasSubmenu: 'monitoring' },
      { href: "/network-topology",    label: "Network Topology",    icon: Network,    roles: ['admin','management'], isNew: true              },
      { href: "/number-intelligence", label: "Number Intelligence", icon: ScanSearch, roles: ['admin','management']                           },
      { href: "/test-call",           label: "Test Suite",          icon: PhoneCall,  roles: ['admin','management'], hasSubmenu: 'testing'    },
      { href: "/tools",               label: "Tools",               icon: Wrench,     roles: ['admin','management'], hasSubmenu: 'tools' as SubmenuType },
    ],
  },
  // ─── 9. Security & Compliance ────────────────────────────────────────────────
  {
    key: 'security',
    label: 'Security & Compliance',
    roles: ['admin','management'],
    items: [
      { href: "/audit-log",            label: "Audit Log",        icon: ClipboardList, roles: ['admin','management'], isNew: true },
      { href: "/stir-shaken",          label: "STIR/SHAKEN",      icon: Lock,          roles: ['admin','management']              },
      { href: "/call-recordings",      label: "Call Recordings",  icon: Mic,           roles: ['admin','management']              },
      { href: "/vendor-sla-scorecard", label: "SLA Management",   icon: ShieldCheck,   roles: ['admin','management']              },
      { href: "/firewall",             label: "Firewall Manager", icon: Shield,        roles: ['admin','management']              },
      { href: "/compliance",           label: "Compliance",       icon: FileCheck2,    roles: ['admin','management']              },
    ],
  },
  // ─── 10. Platform ────────────────────────────────────────────────────────────
  {
    key: 'platform',
    label: 'Platform',
    roles: ['admin','management'],
    items: [
      { href: "/settings",         label: "Settings",      icon: Settings,         roles: ['admin'],              hasSubmenu: 'settings'      },
      { href: "/team",             label: "Team & KAM",    icon: Users,            roles: ['admin']                                           },
      { href: "/reseller",         label: "Reseller Mgmt", icon: Layers,           roles: ['admin','management']                              },
      { href: "/api-keys",         label: "API Keys",      icon: Key,              roles: ['admin']                                           },
      { href: "/vpn-config",       label: "VPN Config",    icon: Lock,             roles: ['admin']                                           },
      { href: "/email-centre",     label: "Notifications", icon: Mail,             roles: ['admin'],              hasSubmenu: 'notifications' },
      { href: "/products",         label: "Products",      icon: Package,          roles: ['admin','management']                              },
      { href: "/billing-disputes", label: "Billing",       icon: FileText,         roles: ['admin','management']                              },
      { href: "/sms-monitor",      label: "SMS / A2P",     icon: MessageCircle,    roles: ['admin','management'],  status: 'planned'          },
      { href: "/sidebar-settings", label: "Sidebar Menu",  icon: SlidersHorizontal,roles: ['admin']                                           },
    ],
  },
];

// ── Constants ──────────────────────────────────────────────────────────────────

const ITEM_NAV_MAP: Record<string, string> = {
  live_summary: '/calls', live_details: '/calls', live_quality: '/calls', call_history: '/calls',
  balance_monitor: '/balance', alerts: '/alerts', fraud_fas: '/fraud',
  traffic_map: '/traffic-map', graphs: '/graphs', bitseye: '/bitseye',
  server_monitoring: '/server-monitoring', cdr_viewer: '/cdrs',
  reports: '/reports', route_quality: '/reports', did_management: '/dids',
};

const MGMT_ROUTE_TO_KEY: Record<string, string> = Object.fromEntries(
  MGMT_CONFIGURABLE_FEATURES.map(f => [f.route, f.key])
);

const SIDEBAR_KEY           = 'voip-sidebar-collapsed';
const GROUPS_LS_KEY         = 'voip-sidebar-groups';
const GROUPS_ORDER_KEY      = 'voip-sidebar-group-order';
const CUSTOM_GROUPS_LS_KEY  = 'voip-sidebar-custom-groups';

const TINT_OPTIONS = [
  { label: 'Indigo',  value: 'text-indigo-400',  bg: 'bg-indigo-400'  },
  { label: 'Violet',  value: 'text-violet-400',  bg: 'bg-violet-400'  },
  { label: 'Cyan',    value: 'text-cyan-400',    bg: 'bg-cyan-400'    },
  { label: 'Emerald', value: 'text-emerald-400', bg: 'bg-emerald-400' },
  { label: 'Amber',   value: 'text-amber-400',   bg: 'bg-amber-400'   },
  { label: 'Rose',    value: 'text-rose-400',    bg: 'bg-rose-400'    },
  { label: 'Sky',     value: 'text-sky-400',     bg: 'bg-sky-400'     },
  { label: 'Fuchsia', value: 'text-fuchsia-400', bg: 'bg-fuchsia-400' },
] as const;
const DEFAULT_GROUP_ORDER = SIDEBAR_GROUPS.map(g => g.key);

// ── Icon accent per group ──────────────────────────────────────────────────────
const GROUP_TINT: Record<string, string> = {
  company:         'text-amber-400',
  operations:      'text-blue-400',
  live_network:    'text-emerald-400',
  intelligence:    'text-cyan-400',
  ai_ops:          'text-violet-400',
  simulation:      'text-orange-400',
  analytics:       'text-indigo-400',
  reports:         'text-emerald-400',
  troubleshooting: 'text-orange-400',
  security:        'text-rose-400',
  platform:        'text-slate-400',
};

// Static bg mapping — must be explicit so Tailwind includes them in the bundle
const GROUP_DOT_BG: Record<string, string> = {
  company:         'bg-amber-400',
  operations:      'bg-blue-400',
  live_network:    'bg-emerald-400',
  intelligence:    'bg-cyan-400',
  ai_ops:          'bg-violet-400',
  simulation:      'bg-orange-400',
  analytics:       'bg-indigo-400',
  reports:         'bg-emerald-400',
  troubleshooting: 'bg-orange-400',
  security:        'bg-rose-400',
  platform:        'bg-slate-400',
};

// ── Helper: find which nav group owns the current location ────────────────────
// Pass the full location including search string (loc + search) for best match.
function getActiveGroupKey(loc: string, search = ''): string | null {
  const fullLoc = search ? `${loc}${search}` : loc;
  // Pass 1: exact full href match (handles query-param-differentiated items)
  for (const group of SIDEBAR_GROUPS) {
    const hit = group.items.some(item => {
      if (item.href === '/') return false;
      return fullLoc === item.href || fullLoc.startsWith(item.href + '/');
    });
    if (hit) return group.key;
  }
  // Pass 2: base-path match (ignore query params)
  for (const group of SIDEBAR_GROUPS) {
    const hit = group.items.some(item => {
      const base = item.href.split('?')[0];
      if (base === '/') return false;
      return loc === base || loc.startsWith(base + '/');
    });
    if (hit) return group.key;
  }
  return null;
}

// ── Spring animation for accordion panels ─────────────────────────────────────
const PANEL = {
  open:   { height: 'auto', opacity: 1,  transition: { type: 'spring' as const, stiffness: 420, damping: 36, mass: 0.7 } },
  closed: { height: 0,      opacity: 0,  transition: { type: 'spring' as const, stiffness: 420, damping: 36, mass: 0.7 } },
};

// ── Component ──────────────────────────────────────────────────────────────────

// ── All pickable items (flat list from every sidebar group) ───────────────────
const ALL_PICKABLE_ITEMS: NavItem[] = SIDEBAR_GROUPS.flatMap(g => g.items);

// ── Group+ dialog ─────────────────────────────────────────────────────────────
function GroupPlusDialog({ open, onClose, onCreate }: {
  open: boolean;
  onClose: () => void;
  onCreate: (g: CustomGroup) => void;
}) {
  const [name, setName] = useState('');
  const [tint, setTint] = useState<string>(TINT_OPTIONS[0].value);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());

  function reset() { setName(''); setTint(TINT_OPTIONS[0].value); setQ(''); setPicked(new Set()); }
  function handleClose() { reset(); onClose(); }

  function handleCreate() {
    const label = name.trim();
    if (!label || picked.size === 0) return;
    onCreate({ id: `custom_${Date.now()}`, label, tint, itemHrefs: [...picked] });
    reset();
    onClose();
  }

  const filtered = ALL_PICKABLE_ITEMS.filter(it =>
    it.label.toLowerCase().includes(q.toLowerCase())
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />
      <div className="relative z-10 w-full max-w-sm bg-[hsl(var(--background))] border border-white/[0.1] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06]">
          <FolderPlus className="h-4 w-4 text-muted-foreground/60" />
          <span className="font-semibold text-sm flex-1">New Group</span>
          <button onClick={handleClose} className="p-1 rounded-lg text-muted-foreground/40 hover:text-foreground hover:bg-white/[0.06] transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-4 flex-1 overflow-y-auto">
          {/* Name */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/50 mb-1.5">Group Name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Finance Ops"
              maxLength={32}
              className="w-full px-3 py-2 text-sm rounded-lg bg-white/[0.04] border border-white/[0.08] text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-white/[0.18] transition-colors"
              autoFocus
            />
          </div>

          {/* Color */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/50 mb-1.5">Accent Colour</label>
            <div className="flex flex-wrap gap-2">
              {TINT_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setTint(opt.value)}
                  title={opt.label}
                  className={cn(
                    "h-6 w-6 rounded-full transition-all duration-150 ring-offset-2 ring-offset-background",
                    opt.bg,
                    tint === opt.value ? "ring-2 ring-white/70 scale-110" : "opacity-50 hover:opacity-80 hover:scale-105"
                  )}
                />
              ))}
            </div>
          </div>

          {/* Item picker */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/50 mb-1.5">
              Add Items <span className="normal-case font-normal text-muted-foreground/30">({picked.size} selected)</span>
            </label>
            <div className="relative mb-2">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/40 pointer-events-none" />
              <input
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Search items…"
                className="w-full pl-7 pr-3 py-1.5 text-[12px] rounded-lg bg-white/[0.04] border border-white/[0.08] text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-white/[0.18] transition-colors"
              />
            </div>
            <div className="max-h-[220px] overflow-y-auto space-y-0.5 pr-1 [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-thumb]:bg-white/10">
              {filtered.map(item => {
                const sel = picked.has(item.href);
                return (
                  <button
                    key={item.href}
                    onClick={() => setPicked(prev => {
                      const s = new Set(prev);
                      sel ? s.delete(item.href) : s.add(item.href);
                      return s;
                    })}
                    className={cn(
                      "w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[12px] transition-all duration-100 text-left",
                      sel
                        ? "bg-white/[0.08] text-foreground"
                        : "text-muted-foreground/60 hover:bg-white/[0.04] hover:text-foreground"
                    )}
                  >
                    <div className={cn(
                      "h-3.5 w-3.5 rounded flex-shrink-0 border transition-colors",
                      sel ? "bg-primary border-primary" : "border-white/[0.2]"
                    )}>
                      {sel && <svg viewBox="0 0 10 10" className="w-full h-full p-[1.5px]"><polyline points="1.5,5 4,7.5 8.5,2.5" stroke="white" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                    </div>
                    <item.icon className={cn("h-3.5 w-3.5 flex-shrink-0", sel ? tint : "text-muted-foreground/40")} />
                    <span className="flex-1 truncate">{item.label}</span>
                  </button>
                );
              })}
              {filtered.length === 0 && (
                <p className="text-center text-[11px] text-muted-foreground/30 py-4">No items match</p>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-4 py-3 border-t border-white/[0.06]">
          <button onClick={handleClose}
            className="flex-1 px-3 py-2 text-[12px] font-medium rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-muted-foreground hover:text-foreground transition-colors">
            Cancel
          </button>
          <button onClick={handleCreate}
            disabled={!name.trim() || picked.size === 0}
            className="flex-1 px-3 py-2 text-[12px] font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
            Create Group
          </button>
        </div>
      </div>
    </div>
  );
}

export function LayoutShell({ children }: LayoutShellProps) {
  const [location]  = useLocation();
  const search      = useSearch();
  const { user, logout, role } = useAuth();
  const { theme, toggleTheme } = useTheme();
  useOrgScope();

  const [mobileOpen, setMobileOpen] = useState(false);

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(SIDEBAR_KEY) === 'true'; } catch { return false; }
  });

  // Smart default: open only the group that owns the current route
  const [groupsExpanded, setGroupsExpanded] = useState<Record<string, boolean>>(() => {
    try {
      const s = localStorage.getItem(GROUPS_LS_KEY);
      if (s) return JSON.parse(s);
    } catch { /* */ }
    const activeKey = getActiveGroupKey(window.location.pathname, window.location.search);
    const defaults: Record<string, boolean> = {};
    SIDEBAR_GROUPS.forEach(g => { defaults[g.key] = g.key === activeKey; });
    return defaults;
  });

  const [groupOrder, setGroupOrder] = useState<string[]>(() => {
    try {
      const s = localStorage.getItem(GROUPS_ORDER_KEY);
      if (s) {
        const p: string[] = JSON.parse(s);
        const known = new Set(p);
        const validP = p.filter(k => DEFAULT_GROUP_ORDER.includes(k));
        const newKeys = DEFAULT_GROUP_ORDER.filter(k => !known.has(k));
        if (newKeys.length === 0) return validP;
        // Insert each new key at its correct DEFAULT position rather than appending
        const result = [...validP];
        for (const newKey of newKeys) {
          const defaultIdx = DEFAULT_GROUP_ORDER.indexOf(newKey);
          let insertAt = result.length;
          for (let i = defaultIdx + 1; i < DEFAULT_GROUP_ORDER.length; i++) {
            const pos = result.indexOf(DEFAULT_GROUP_ORDER[i]);
            if (pos !== -1) { insertAt = pos; break; }
          }
          result.splice(insertAt, 0, newKey);
        }
        return result;
      }
    } catch { /* */ }
    return DEFAULT_GROUP_ORDER;
  });

  const [customGroups, setCustomGroups] = useState<CustomGroup[]>(() => {
    try {
      const s = localStorage.getItem(CUSTOM_GROUPS_LS_KEY);
      if (s) return JSON.parse(s);
    } catch { /* */ }
    return [];
  });

  const [groupPlusOpen, setGroupPlusOpen] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(CUSTOM_GROUPS_LS_KEY, JSON.stringify(customGroups)); } catch { /* */ }
  }, [customGroups]);

  function handleCreateCustomGroup(g: CustomGroup) {
    setCustomGroups(prev => [...prev, g]);
    setGroupsExpanded(prev => ({ ...prev, [g.id]: true }));
  }

  function handleDeleteCustomGroup(id: string) {
    setCustomGroups(prev => prev.filter(g => g.id !== id));
    setGroupsExpanded(prev => { const n = { ...prev }; delete n[id]; return n; });
  }

  const dragSrcKey  = useRef<string | null>(null);
  const dragOverKey = useRef<string | null>(null);

  function handleDragStart(key: string) { dragSrcKey.current = key; }
  function handleDragOver(e: React.DragEvent, key: string) { e.preventDefault(); dragOverKey.current = key; }
  function handleDrop(e: React.DragEvent, key: string) {
    e.preventDefault();
    const src = dragSrcKey.current;
    if (!src || src === key) return;
    setGroupOrder(prev => {
      const arr = [...prev];
      const fi = arr.indexOf(src), ti = arr.indexOf(key);
      if (fi === -1 || ti === -1) return prev;
      arr.splice(fi, 1); arr.splice(ti, 0, src);
      return arr;
    });
    dragSrcKey.current = dragOverKey.current = null;
  }
  function resetGroupOrder() { setGroupOrder(DEFAULT_GROUP_ORDER); }
  const isOrderCustomized = groupOrder.join(',') !== DEFAULT_GROUP_ORDER.join(',');
  const orderedGroups = groupOrder.map(k => SIDEBAR_GROUPS.find(g => g.key === k)).filter((g): g is NavGroup => !!g);

  useEffect(() => { try { localStorage.setItem(SIDEBAR_KEY, String(collapsed)); } catch { /* */ } }, [collapsed]);
  useEffect(() => { try { localStorage.setItem(GROUPS_LS_KEY, JSON.stringify(groupsExpanded)); } catch { /* */ } }, [groupsExpanded]);
  useEffect(() => { try { localStorage.setItem(GROUPS_ORDER_KEY, JSON.stringify(groupOrder)); } catch { /* */ } }, [groupOrder]);

  const isGroupOpen = (key: string) => groupsExpanded[key] !== false;
  const toggleGroup = (key: string) => setGroupsExpanded(prev => ({ ...prev, [key]: !isGroupOpen(key) }));

  // ── Active route helpers ──────────────────────────────────────────────────────
  const isCallsActive       = location.startsWith('/calls');
  const isMonitoringActive  = location.startsWith('/server-monitoring');
  const isBitseyeActive     = location.startsWith('/bitseye');
  const isCdrActive         = location.startsWith('/cdrs');
  const isSettingsActive    = location.startsWith('/settings');
  const isRateCardsActive   = location.startsWith('/rate-cards');
  const isToolsActive       = location.startsWith('/tools');
  const isRoutingMgrActive  = location.startsWith('/routing-manager');
  const isTestActive        = location.startsWith('/test-call') || location.startsWith('/test-campaigns');
  const isNotifActive       = location.startsWith('/notification-centre') || location.startsWith('/email-centre') || location.startsWith('/whatsapp-alerts');
  const isCompanyActive     = location.startsWith('/company');
  const isClientActive      = location.startsWith('/client');

  // ── Submenu expand states ─────────────────────────────────────────────────────
  const [callsExpanded,      setCallsExpanded]      = useState(isCallsActive);
  const [monitoringExpanded, setMonitoringExpanded] = useState(isMonitoringActive);
  const [bitseyeExpanded,    setBitseyeExpanded]    = useState(isBitseyeActive);
  const [cdrExpanded,        setCdrExpanded]        = useState(isCdrActive);
  const [settingsExpanded,   setSettingsExpanded]   = useState(isSettingsActive);
  const [rateCardsExpanded,  setRateCardsExpanded]  = useState(isRateCardsActive);
  const [toolsExpanded,      setToolsExpanded]      = useState(isToolsActive);
  const [routingMgrExpanded, setRoutingMgrExpanded] = useState(isRoutingMgrActive);
  const [testExpanded,       setTestExpanded]       = useState(isTestActive);
  const [notifExpanded,      setNotifExpanded]      = useState(isNotifActive);
  const [companyExpanded,    setCompanyExpanded]    = useState(isCompanyActive);
  const [clientExpanded,     setClientExpanded]     = useState(isClientActive);

  useEffect(() => { if (isCallsActive)      setCallsExpanded(true);      }, [isCallsActive]);
  useEffect(() => { if (isMonitoringActive) setMonitoringExpanded(true);  }, [isMonitoringActive]);
  useEffect(() => { if (isBitseyeActive)    setBitseyeExpanded(true);     }, [isBitseyeActive]);
  useEffect(() => { if (isCdrActive)        setCdrExpanded(true);         }, [isCdrActive]);
  useEffect(() => { if (isSettingsActive)   setSettingsExpanded(true);    }, [isSettingsActive]);
  useEffect(() => { if (isRateCardsActive)  setRateCardsExpanded(true);   }, [isRateCardsActive]);
  useEffect(() => { if (isToolsActive)      setToolsExpanded(true);       }, [isToolsActive]);
  useEffect(() => { if (isRoutingMgrActive) setRoutingMgrExpanded(true);  }, [isRoutingMgrActive]);
  useEffect(() => { if (isTestActive)       setTestExpanded(true);        }, [isTestActive]);
  useEffect(() => { if (isNotifActive)      setNotifExpanded(true);       }, [isNotifActive]);
  useEffect(() => { if (isCompanyActive)    setCompanyExpanded(true);     }, [isCompanyActive]);
  useEffect(() => { if (isClientActive)     setClientExpanded(true);      }, [isClientActive]);

  // Auto-expand the sidebar group that owns the navigated-to route
  useEffect(() => {
    const activeKey = getActiveGroupKey(location, search ? `?${search}` : '');
    if (activeKey) {
      setGroupsExpanded(prev => prev[activeKey] === true ? prev : { ...prev, [activeKey]: true });
    }
  }, [location, search]);

  // ── Data queries ──────────────────────────────────────────────────────────────
  const { data: kamList = [] } = useQuery<Kam[]>({
    queryKey: ['/api/kam'],
    enabled: (role === 'admin' || role === 'management') && bitseyeExpanded,
    staleTime: 120_000,
  });
  const { data: viewerKamData } = useQuery<{ kamId: number|null; kamName: string|null; accountIds: string[]; clientNames: string[] }>({
    queryKey: ['/api/user/assigned-accounts'],
    enabled: role === 'viewer' && bitseyeExpanded,
    staleTime: 60_000,
  });
  const { data: viewerAssignmentsData } = useQuery<{ items: string[] }>({
    queryKey: ['/api/user/monitoring-assignments'],
    enabled: role === 'viewer',
    staleTime: 60_000,
  });
  const assignedItemSet = new Set(viewerAssignmentsData?.items ?? []);

  const { data: pendingCountData } = useQuery<{ count: number }>({
    queryKey: ['/api/approvals/pending-count'],
    enabled: role === 'admin' || role === 'management' || role === 'super_admin' || role === 'team_lead',
    refetchInterval: 30_000, staleTime: 15_000,
  });
  const pendingApprovalCount = pendingCountData?.count ?? 0;

  const { data: mgmtPermsData } = useQuery<{ enabledFeatures: string[] }>({
    queryKey: ['/api/settings/mgmt-permissions'],
    enabled: role === 'management',
    staleTime: 60_000,
  });
  const mgmtEnabledFeatures: Set<string> | null = mgmtPermsData ? new Set(mgmtPermsData.enabledFeatures ?? []) : null;

  // Sidebar visibility config — admin-controlled hide list
  const { data: sidebarVisData } = useQuery<{ hiddenItems: string[] }>({
    queryKey: ['/api/settings/sidebar-visibility'],
    staleTime: 60_000,
  });
  const sidebarHiddenSet = new Set<string>(sidebarVisData?.hiddenItems ?? []);

  // ── KPI strip data ────────────────────────────────────────────────────────────
  const { data: liveCallsRaw } = useQuery<any>({
    queryKey: ['/api/sippy/live-calls'],
    refetchInterval: 60_000, staleTime: 30_000,
    enabled: role !== 'viewer',
  });
  const { data: incidentsRaw } = useQuery<any[]>({
    queryKey: ['/api/ai/incidents'],
    refetchInterval: 60_000, staleTime: 30_000,
    enabled: role !== 'viewer',
  });
  const { data: carrierScoresRaw } = useQuery<any[]>({
    queryKey: ['/api/carrier-scores'],
    refetchInterval: 120_000, staleTime: 60_000,
    enabled: role !== 'viewer',
  });

  const liveCallCount   = Array.isArray(liveCallsRaw) ? liveCallsRaw.length : (liveCallsRaw?.calls?.length ?? liveCallsRaw?.count ?? 0);
  const activeIncidents = Array.isArray(incidentsRaw) ? incidentsRaw.filter((i: any) => i.status === 'active' || !i.resolvedAt).length : 0;
  const avgAsr = Array.isArray(carrierScoresRaw) && carrierScoresRaw.length > 0
    ? carrierScoresRaw.reduce((s: number, c: any) => s + (c.rollingAsr ?? 0), 0) / carrierScoresRaw.length : null;
  const hasDegradedCarrier = Array.isArray(carrierScoresRaw) && carrierScoresRaw.some((c: any) => (c.stabilityScore ?? 100) < 45);

  // ── Visibility gate ───────────────────────────────────────────────────────────
  const VIEWER_ALWAYS_SHOW   = new Set(['/', '/account', '/chat']);
  // Items that can never be hidden by the admin config
  const SIDEBAR_ALWAYS_SHOW  = new Set(['/', '/account', '/chat', '/sidebar-settings']);

  const isItemVisible = (item: NavItem): boolean => {
    if (role === 'viewer') {
      if (VIEWER_ALWAYS_SHOW.has(item.href)) return true;
      return [...assignedItemSet].some(id => ITEM_NAV_MAP[id] === item.href);
    }
    if (!item.roles.includes(role)) return false;
    if (role === 'management' && mgmtEnabledFeatures !== null) {
      const routeBase = item.href.split('?')[0];
      const featureKey = MGMT_ROUTE_TO_KEY[routeBase];
      if (featureKey && !mgmtEnabledFeatures.has(featureKey)) return false;
    }
    // Admin sidebar visibility config filter
    if (!SIDEBAR_ALWAYS_SHOW.has(item.href) && sidebarHiddenSet.has(item.href)) return false;
    return true;
  };

  const visibleCallsSubitems = role === 'viewer'
    ? CALLS_SUBITEMS.filter(sub => assignedItemSet.has(sub.itemId))
    : CALLS_SUBITEMS;

  const badge       = ROLE_BADGE[role];
  const currentView = isCallsActive ? (new URLSearchParams(search).get('view') ?? 'summary') : null;

  // ── Active route check ────────────────────────────────────────────────────────
  const isNavItemActive = (href: string): boolean => {
    if (href === '/') return location === '/';
    const [hrefPath, hrefQuery] = href.split('?');
    if (!location.startsWith(hrefPath)) return false;
    if (!hrefQuery) return true;
    const hrefParams = new URLSearchParams(hrefQuery);
    const curParams  = new URLSearchParams(search);
    return [...hrefParams.entries()].every(([k, v]) => curParams.get(k) === v);
  };

  // ── Style helpers ─────────────────────────────────────────────────────────────
  const navItemCls = (active: boolean) => cn(
    "relative w-full flex items-center gap-2.5 px-3 py-[7px] rounded-lg text-[13px] font-medium transition-all duration-150 group select-none",
    active ? "bg-white/[0.08] text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-white/[0.05]"
  );
  const navIconCls = (active: boolean, groupKey?: string) => cn(
    "h-[15px] w-[15px] flex-shrink-0 transition-colors",
    active ? (groupKey ? GROUP_TINT[groupKey] : 'text-primary') : "text-muted-foreground/55 group-hover:text-muted-foreground"
  );
  const subItemCls = (active: boolean) => cn(
    "flex items-center gap-2 px-2.5 py-[5px] rounded-md text-[12px] font-medium transition-all duration-100",
    active ? "bg-white/[0.08] text-foreground" : "text-muted-foreground/65 hover:text-foreground hover:bg-white/[0.04]"
  );

  // Gradient left accent bar on active items
  const ActiveBar = () => (
    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-[65%] rounded-r-full bg-gradient-to-b from-violet-400 via-indigo-500 to-blue-500 opacity-90" />
  );

  // Pulse dot (green/amber/red)
  const PulseDot = ({ color }: { color: 'green'|'amber'|'red' }) => (
    <span className="relative flex h-2 w-2 flex-shrink-0">
      <span className={cn("animate-ping absolute inline-flex h-full w-full rounded-full opacity-60",
        color === 'green' ? 'bg-emerald-400' : color === 'amber' ? 'bg-amber-400' : 'bg-rose-400')} />
      <span className={cn("relative inline-flex h-2 w-2 rounded-full",
        color === 'green' ? 'bg-emerald-400' : color === 'amber' ? 'bg-amber-400' : 'bg-rose-400')} />
    </span>
  );

  // Count badge
  const CountBadge = ({ n, color }: { n: number; color: 'red'|'amber' }) => (
    <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center leading-none",
      color === 'red' ? 'bg-rose-500 text-white' : 'bg-amber-500 text-white')}>
      {n > 99 ? '99+' : n}
    </span>
  );

  // Spring-animated accordion panel
  const SubPanel = ({ open, children }: { open: boolean; children: React.ReactNode }) => (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div key="p" initial="closed" animate="open" exit="closed" variants={PANEL} className="overflow-hidden">
          <div className="mt-0.5 ml-[14px] pl-3 border-l border-white/[0.08] space-y-0.5 pb-1">
            {children}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  // Per-item right-side adornment
  const RightAdornment = ({ item, isActive }: { item: NavItem; isActive: boolean }) => {
    if (item.href === '/approvals' && pendingApprovalCount > 0) return <CountBadge n={pendingApprovalCount} color="amber" />;
    if (item.href === '/alerts' && activeIncidents > 0)         return <CountBadge n={activeIncidents} color="red" />;
    if (item.href === '/calls'   && liveCallCount > 0)          return <PulseDot color="green" />;
    if (item.href === '/ai-ops'  && activeIncidents > 0)        return <PulseDot color="red" />;
    if ((item.href === '/sbc-monitor' || item.href === '/carrier-scoring') && hasDegradedCarrier) return <PulseDot color="amber" />;
    if (item.status === 'live' && !isActive)   return <PulseDot color="green" />;
    if (item.isNew && !isActive)               return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-violet-500/20 text-violet-400 border border-violet-500/30 tracking-wide leading-none">New</span>;
    if (item.status === 'planned' && !isActive) return <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-muted/40 text-muted-foreground/50 border border-border/20 leading-none">Soon</span>;
    return null;
  };

  // ── Render a single nav item ──────────────────────────────────────────────────
  const renderNavItem = (item: NavItem, groupKey?: string) => {
    const active = isNavItemActive(item.href);

    /* Live Calls */
    if (item.hasSubmenu === 'calls') {
      if (role === 'viewer' && visibleCallsSubitems.length === 0) return null;
      return (
        <div key={item.href}>
          <button onClick={() => setCallsExpanded(o => !o)} className={navItemCls(active)}>
            {active && <ActiveBar />}
            <item.icon className={navIconCls(active, groupKey)} />
            <span className="flex-1 text-left">{item.label}</span>
            {liveCallCount > 0 && <PulseDot color="green" />}
            <ChevronDown className={cn("h-3 w-3 flex-shrink-0 text-muted-foreground/40 transition-transform duration-200", callsExpanded && "rotate-180")} />
          </button>
          <SubPanel open={callsExpanded}>
            {visibleCallsSubitems.map(sub => {
              const sa = active && currentView === sub.view;
              return (
                <Link key={sub.view} href={`/calls?view=${sub.view}`} className={subItemCls(sa)}>
                  <sub.icon className={cn("h-3.5 w-3.5 flex-shrink-0", sa ? "text-primary" : sub.iconColor)} />
                  {sub.label}
                </Link>
              );
            })}
          </SubPanel>
        </div>
      );
    }

    /* Routing Manager */
    if (item.hasSubmenu === 'routingmgr') {
      const curTab = isRoutingMgrActive ? (new URLSearchParams(search).get('tab') ?? 'routing-groups') : null;
      return (
        <div key={item.href}>
          <button onClick={() => setRoutingMgrExpanded(o => !o)} className={navItemCls(active)}>
            {active && <ActiveBar />}
            <item.icon className={navIconCls(active, groupKey)} />
            <span className="flex-1 text-left">{item.label}</span>
            <ChevronDown className={cn("h-3 w-3 flex-shrink-0 text-muted-foreground/40 transition-transform duration-200", routingMgrExpanded && "rotate-180")} />
          </button>
          <SubPanel open={routingMgrExpanded}>
            {ROUTING_MGR_SUBITEMS.map(sub => {
              const sa = isRoutingMgrActive && curTab === sub.tab;
              return (
                <Link key={sub.tab} href={`/routing-manager?tab=${sub.tab}`} className={subItemCls(sa)}>
                  <sub.icon className={cn("h-3.5 w-3.5 flex-shrink-0", sa ? "text-primary" : sub.iconColor)} />
                  {sub.label}
                </Link>
              );
            })}
          </SubPanel>
        </div>
      );
    }

    /* BitsEye */
    if (item.hasSubmenu === 'bitseye') {
      const bsView  = isBitseyeActive ? (new URLSearchParams(search).get('view') ?? 'clients') : null;
      const bsKamId = isBitseyeActive ? new URLSearchParams(search).get('kamId') : null;
      const kams    = role === 'viewer'
        ? (viewerKamData ? [{ id: viewerKamData.kamId!, name: viewerKamData.kamName ?? 'My Accounts', active: true }] : [])
        : kamList.filter(k => k.active);
      return (
        <div key={item.href}>
          <button onClick={() => setBitseyeExpanded(o => !o)} className={navItemCls(active)}>
            {active && <ActiveBar />}
            <item.icon className={navIconCls(active, groupKey)} />
            <span className="flex-1 text-left">{item.label}</span>
            <ChevronDown className={cn("h-3 w-3 flex-shrink-0 text-muted-foreground/40 transition-transform duration-200", bitseyeExpanded && "rotate-180")} />
          </button>
          <SubPanel open={bitseyeExpanded}>
            <Link href="/bitseye2" className={subItemCls(location === '/bitseye2')}>
              <span className={cn("h-2 w-2 rounded-full flex-shrink-0", location === '/bitseye2' ? "bg-primary" : "bg-blue-400")} />
              BitsEye 2 <span className="ml-auto text-[9px] font-semibold text-blue-400 bg-blue-50 dark:bg-blue-950 px-1 rounded">LIVE</span>
            </Link>
            <div className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/30 px-2.5 pt-1 pb-0.5">BitsEye v1</div>
            {BITSEYE_FIXED.map(sub => {
              const sa = isBitseyeActive && location !== '/bitseye2' && bsView === sub.view && !bsKamId;
              return (
                <Link key={sub.view} href={`/bitseye?view=${sub.view}`} className={subItemCls(sa)}>
                  <span className={cn("h-2 w-2 rounded-full flex-shrink-0", sa ? "bg-primary" : sub.iconColor.replace('text-','bg-'))} />
                  {sub.label}
                </Link>
              );
            })}
            {kams.length > 0 && (
              <>
                <div className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/30 px-2.5 pt-2 pb-0.5">KAM View</div>
                {kams.map(k => {
                  const sa = isBitseyeActive && bsKamId === String(k.id);
                  return (
                    <Link key={k.id} href={`/bitseye?view=clients&kamId=${k.id}`} className={subItemCls(sa)}>
                      <span className={cn("h-2 w-2 rounded-full flex-shrink-0", sa ? "bg-primary" : "bg-violet-400")} />
                      <span className="truncate">{k.name}</span>
                    </Link>
                  );
                })}
              </>
            )}
          </SubPanel>
        </div>
      );
    }

    /* CDR Viewer */
    if (item.hasSubmenu === 'cdr') {
      const cdrView = isCdrActive ? (new URLSearchParams(search).get('view') ?? 'client') : null;
      return (
        <div key={item.href}>
          <button onClick={() => setCdrExpanded(o => !o)} className={navItemCls(active)}>
            {active && <ActiveBar />}
            <item.icon className={navIconCls(active, groupKey)} />
            <span className="flex-1 text-left">{item.label}</span>
            <ChevronDown className={cn("h-3 w-3 flex-shrink-0 text-muted-foreground/40 transition-transform duration-200", cdrExpanded && "rotate-180")} />
          </button>
          <SubPanel open={cdrExpanded}>
            {CDR_SUBITEMS.map(sub => {
              const sa = isCdrActive && cdrView === sub.view;
              return (
                <Link key={sub.view} href={`/cdrs?view=${sub.view}`} className={subItemCls(sa)}>
                  <span className={cn("h-2 w-2 rounded-full flex-shrink-0", sa ? "bg-primary" : sub.iconColor.replace('text-','bg-'))} />
                  {sub.label}
                </Link>
              );
            })}
          </SubPanel>
        </div>
      );
    }

    /* Server Monitoring */
    if (item.hasSubmenu === 'monitoring') {
      const curTab = isMonitoringActive ? (new URLSearchParams(search).get('tab') ?? 'reachability') : null;
      return (
        <div key={item.href}>
          <button onClick={() => setMonitoringExpanded(o => !o)} className={navItemCls(active)}>
            {active && <ActiveBar />}
            <item.icon className={navIconCls(active, groupKey)} />
            <span className="flex-1 text-left">{item.label}</span>
            <ChevronDown className={cn("h-3 w-3 flex-shrink-0 text-muted-foreground/40 transition-transform duration-200", monitoringExpanded && "rotate-180")} />
          </button>
          <SubPanel open={monitoringExpanded}>
            {MONITORING_SUBITEMS.map(sub => {
              const sa = isMonitoringActive && curTab === sub.tab;
              return (
                <Link key={sub.tab} href={`/server-monitoring?tab=${sub.tab}`} className={subItemCls(sa)}>
                  <sub.icon className={cn("h-3.5 w-3.5 flex-shrink-0", sa ? "text-primary" : sub.iconColor)} />
                  {sub.label}
                </Link>
              );
            })}
          </SubPanel>
        </div>
      );
    }

    /* Rate Cards */
    if (item.hasSubmenu === 'ratecards') {
      const rcType = isRateCardsActive ? new URLSearchParams(search).get('type') : null;
      return (
        <div key={item.href}>
          <button onClick={() => setRateCardsExpanded(o => !o)} className={navItemCls(isRateCardsActive)}>
            {isRateCardsActive && <ActiveBar />}
            <item.icon className={navIconCls(isRateCardsActive, groupKey)} />
            <span className="flex-1 text-left">{item.label}</span>
            <ChevronDown className={cn("h-3 w-3 flex-shrink-0 text-muted-foreground/40 transition-transform duration-200", rateCardsExpanded && "rotate-180")} />
          </button>
          <SubPanel open={rateCardsExpanded}>
            {([
              { type: 'client', label: 'Client Rate Cards', icon: Building2, iconColor: 'text-amber-400' },
              { type: 'vendor', label: 'Vendor Rate Cards',  icon: Wallet,    iconColor: 'text-cyan-400'  },
            ] as const).map(sub => {
              const sa = isRateCardsActive && rcType === sub.type;
              return (
                <Link key={sub.type} href={`/rate-cards?type=${sub.type}`} className={subItemCls(sa)}>
                  <sub.icon className={cn("h-3.5 w-3.5 flex-shrink-0", sa ? "text-primary" : sub.iconColor)} />
                  {sub.label}
                </Link>
              );
            })}
          </SubPanel>
        </div>
      );
    }

    /* Settings */
    if (item.hasSubmenu === 'settings') {
      const section = isSettingsActive ? new URLSearchParams(search).get('section') : null;
      return (
        <div key={item.href}>
          <button onClick={() => setSettingsExpanded(o => !o)} className={navItemCls(isSettingsActive)}>
            {isSettingsActive && <ActiveBar />}
            <item.icon className={navIconCls(isSettingsActive, groupKey)} />
            <span className="flex-1 text-left">{item.label}</span>
            <ChevronDown className={cn("h-3 w-3 flex-shrink-0 text-muted-foreground/40 transition-transform duration-200", settingsExpanded && "rotate-180")} />
          </button>
          <SubPanel open={settingsExpanded}>
            {([
              { href: '/settings',                 label: 'General',       icon: Settings,  color: 'text-blue-400', section: null      },
              { href: '/settings?section=watcher', label: 'Sippy Watcher', icon: ScanSearch,color: 'text-cyan-400', section: 'watcher' },
            ]).map(sub => {
              const sa = isSettingsActive && section === sub.section;
              return (
                <Link key={sub.href} href={sub.href} className={subItemCls(sa)}>
                  <sub.icon className={cn("h-3.5 w-3.5 flex-shrink-0", sa ? "text-primary" : sub.color)} />
                  {sub.label}
                </Link>
              );
            })}
          </SubPanel>
        </div>
      );
    }

    /* Tools */
    if (item.hasSubmenu === 'tools') {
      const toolsTab = isToolsActive ? (new URLSearchParams(search).get('tab') ?? 'carrier') : null;
      return (
        <div key={item.href}>
          <button onClick={() => setToolsExpanded(o => !o)} className={navItemCls(isToolsActive)}>
            {isToolsActive && <ActiveBar />}
            <item.icon className={navIconCls(isToolsActive, groupKey)} />
            <span className="flex-1 text-left">{item.label}</span>
            <ChevronDown className={cn("h-3 w-3 flex-shrink-0 text-muted-foreground/40 transition-transform duration-200", toolsExpanded && "rotate-180")} />
          </button>
          <SubPanel open={toolsExpanded}>
            {TOOLS_SUBITEMS.map(sub => {
              const sa = isToolsActive && toolsTab === sub.tab;
              return (
                <Link key={sub.tab} href={`/tools?tab=${sub.tab}`} className={subItemCls(sa)}>
                  <sub.icon className={cn("h-3.5 w-3.5 flex-shrink-0", sa ? "text-primary" : sub.iconColor)} />
                  {sub.label}
                </Link>
              );
            })}
          </SubPanel>
        </div>
      );
    }

    /* Test Suite */
    if (item.hasSubmenu === 'testing') {
      return (
        <div key={item.href}>
          <button onClick={() => setTestExpanded(o => !o)} className={navItemCls(isTestActive)}>
            {isTestActive && <ActiveBar />}
            <item.icon className={navIconCls(isTestActive, groupKey)} />
            <span className="flex-1 text-left">{item.label}</span>
            <ChevronDown className={cn("h-3 w-3 flex-shrink-0 text-muted-foreground/40 transition-transform duration-200", testExpanded && "rotate-180")} />
          </button>
          <SubPanel open={testExpanded}>
            {TEST_SUBITEMS.map(sub => {
              const sa = location.startsWith(sub.href);
              return (
                <Link key={sub.href} href={sub.href} className={subItemCls(sa)}>
                  <sub.icon className={cn("h-3.5 w-3.5 flex-shrink-0", sa ? "text-primary" : sub.iconColor)} />
                  {sub.label}
                </Link>
              );
            })}
          </SubPanel>
        </div>
      );
    }

    /* Notifications */
    if (item.hasSubmenu === 'notifications') {
      return (
        <div key={item.href}>
          <button onClick={() => setNotifExpanded(o => !o)} className={navItemCls(isNotifActive)}>
            {isNotifActive && <ActiveBar />}
            <item.icon className={navIconCls(isNotifActive, groupKey)} />
            <span className="flex-1 text-left">{item.label}</span>
            <ChevronDown className={cn("h-3 w-3 flex-shrink-0 text-muted-foreground/40 transition-transform duration-200", notifExpanded && "rotate-180")} />
          </button>
          <SubPanel open={notifExpanded}>
            {NOTIF_SUBITEMS.map(sub => {
              const sa = location.startsWith(sub.href);
              return (
                <Link key={sub.href} href={sub.href} className={subItemCls(sa)}>
                  <sub.icon className={cn("h-3.5 w-3.5 flex-shrink-0", sa ? "text-primary" : sub.iconColor)} />
                  {sub.label}
                </Link>
              );
            })}
          </SubPanel>
        </div>
      );
    }

    /* Company Group */
    if (item.hasSubmenu === 'company_grp') {
      return (
        <div key={item.href}>
          <button onClick={() => setCompanyExpanded(o => !o)} className={navItemCls(isCompanyActive)}>
            {isCompanyActive && <ActiveBar />}
            <item.icon className={navIconCls(isCompanyActive, groupKey)} />
            <span className="flex-1 text-left">{item.label}</span>
            <ChevronDown className={cn("h-3 w-3 flex-shrink-0 text-muted-foreground/40 transition-transform duration-200", companyExpanded && "rotate-180")} />
          </button>
          <SubPanel open={companyExpanded}>
            {COMPANY_SUBITEMS.map(sub => {
              const sa = location === sub.href || location.startsWith(sub.href + '?');
              return (
                <Link key={sub.href} href={sub.href} className={subItemCls(sa)}>
                  <sub.icon className={cn("h-3.5 w-3.5 flex-shrink-0", sa ? "text-primary" : sub.iconColor)} />
                  {sub.label}
                </Link>
              );
            })}
          </SubPanel>
        </div>
      );
    }

    /* Client Group */
    if (item.hasSubmenu === 'client_grp') {
      const clientTab = search ? new URLSearchParams(search).get('tab') : null;
      return (
        <div key={item.href}>
          <button onClick={() => setClientExpanded(o => !o)} className={navItemCls(isClientActive)}>
            {isClientActive && <ActiveBar />}
            <item.icon className={navIconCls(isClientActive, groupKey)} />
            <span className="flex-1 text-left">{item.label}</span>
            <ChevronDown className={cn("h-3 w-3 flex-shrink-0 text-muted-foreground/40 transition-transform duration-200", clientExpanded && "rotate-180")} />
          </button>
          <SubPanel open={clientExpanded}>
            {CLIENT_SUBITEMS.map(sub => {
              const [subPath, subQuery] = sub.href.split('?');
              const subTab = subQuery ? new URLSearchParams(subQuery).get('tab') : null;
              const sa = location === subPath && (!subTab || clientTab === subTab) ||
                         (sub.href === '/client/wizard' && location === '/client/wizard');
              return (
                <Link key={sub.href} href={sub.href} className={subItemCls(sa)}>
                  <sub.icon className={cn("h-3.5 w-3.5 flex-shrink-0", sa ? "text-primary" : sub.iconColor)} />
                  <span className="flex-1 truncate">{sub.label}</span>
                  {'isNew' in sub && sub.isNew && !sa && (
                    <span className="text-[9px] font-bold px-1 py-0.5 rounded-full bg-violet-500/20 text-violet-400 border border-violet-500/30 leading-none">New</span>
                  )}
                </Link>
              );
            })}
          </SubPanel>
        </div>
      );
    }

    /* Plain item */
    return (
      <Link key={item.href + item.label} href={item.href} data-testid={`nav-${item.href.replace(/\//g,'-').slice(1)}`} className={navItemCls(active)}>
        {active && <ActiveBar />}
        <item.icon className={navIconCls(active, groupKey)} />
        <span className="flex-1 truncate leading-tight">{item.label}</span>
        <RightAdornment item={item} isActive={active} />
      </Link>
    );
  };

  // ── Collapsed icon-only list ──────────────────────────────────────────────────
  const allFlatItems: NavItem[] = [
    ...NAV_PINNED_TOP,
    ...SIDEBAR_GROUPS.flatMap(g => g.items),
    ...NAV_PINNED_BOTTOM,
  ];

  // ── KPI strip (shared) ────────────────────────────────────────────────────────
  const KpiStrip = () => role === 'viewer' ? null : (
    <div className="mx-3 mb-2 px-3 py-2 rounded-xl bg-white/[0.04] border border-white/[0.07]">
      <div className="flex items-center justify-between gap-1">
        {([
          { label: 'Calls',  val: liveCallCount,  color: liveCallCount > 0 ? 'text-emerald-400' : 'text-muted-foreground/50' },
          { label: 'Alerts', val: activeIncidents, color: activeIncidents > 0 ? 'text-rose-400' : 'text-muted-foreground/50'  },
          { label: 'ASR',    val: avgAsr != null ? `${avgAsr.toFixed(1)}%` : '—',
            color: avgAsr == null ? 'text-muted-foreground/50' : avgAsr >= 95 ? 'text-emerald-400' : avgAsr >= 85 ? 'text-amber-400' : 'text-rose-400' },
        ] as const).map(k => (
          <div key={k.label} className="flex-1 text-center">
            <div className={cn("text-[13px] font-bold tabular-nums leading-tight", k.color)}>{k.val}</div>
            <div className="text-[9px] text-muted-foreground/40 uppercase tracking-wider leading-tight">{k.label}</div>
          </div>
        ))}
      </div>
    </div>
  );

  // ── Sidebar nav content (shared desktop + mobile) ─────────────────────────────
  const NavContent = ({ mobile = false }: { mobile?: boolean }) => (
    <>
      <KpiStrip />

      {/* ⌘K search row */}
      <button
        onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))}
        className="mx-3 mb-3 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06] text-[12px] text-muted-foreground/50 hover:text-muted-foreground hover:bg-white/[0.06] transition-colors"
        data-testid="button-command-palette"
      >
        <Search className="h-3 w-3 flex-shrink-0" />
        <span className="flex-1 text-left">Search anything…</span>
        <span className="flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground/30">
          <Command className="h-2.5 w-2.5" />K
        </span>
      </button>

      <nav className={cn("flex-1 overflow-y-auto px-2 pb-2 space-y-0.5 [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-track]:transparent")}>
        {/* Pinned top */}
        {NAV_PINNED_TOP.filter(isItemVisible).map(item => {
          const active = item.href === '/' ? location === '/' : location.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href}
              onClick={mobile ? () => setMobileOpen(false) : undefined}
              className={navItemCls(active)}
            >
              {active && <ActiveBar />}
              <item.icon className={navIconCls(active)} />
              <span className="flex-1">{item.label}</span>
              {item.href === '/chat' && activeIncidents > 0 && <CountBadge n={activeIncidents} color="red" />}
            </Link>
          );
        })}

        <div className="my-2 border-t border-white/[0.05]" />

        {/* Groups */}
        {(mobile ? SIDEBAR_GROUPS : orderedGroups).map(group => {
          const visibleItems = group.items.filter(isItemVisible);
          if (visibleItems.length === 0) return null;
          const isOpen = mobile ? true : isGroupOpen(group.key);

          return (
            <div key={group.key} className="pt-1.5"
              draggable={!mobile}
              onDragStart={!mobile ? () => handleDragStart(group.key) : undefined}
              onDragOver={!mobile ? (e) => handleDragOver(e, group.key) : undefined}
              onDrop={!mobile ? (e) => handleDrop(e, group.key) : undefined}
            >
              {/* Section dropdown header */}
              <button
                data-testid={`sidebar-group-${group.key}`}
                onClick={!mobile ? () => toggleGroup(group.key) : undefined}
                className={cn(
                  "group/grp w-full flex items-center gap-2 px-2.5 py-1.5 mb-0.5 rounded-lg text-[11px] font-semibold uppercase tracking-[0.06em] transition-all duration-150",
                  isOpen
                    ? "bg-white/[0.06] text-foreground/65 border border-white/[0.08]"
                    : "text-muted-foreground/40 hover:text-muted-foreground/65 hover:bg-white/[0.04] border border-transparent"
                )}
              >
                {!mobile && <GripVertical className="h-3 w-3 flex-shrink-0 opacity-0 group-hover/grp:opacity-25 transition-opacity cursor-grab active:cursor-grabbing" />}
                <span className={cn(
                  "h-1.5 w-1.5 rounded-full flex-shrink-0 transition-opacity duration-150",
                  GROUP_DOT_BG[group.key] ?? 'bg-slate-400',
                  isOpen ? 'opacity-90' : 'opacity-35'
                )} />
                <span className="flex-1 text-left">{group.label}</span>
                {!mobile && (
                  <ChevronDown className={cn("h-3.5 w-3.5 flex-shrink-0 transition-transform duration-200 text-muted-foreground/40", isOpen && "rotate-180 text-muted-foreground/60")} />
                )}
              </button>

              {/* Items with spring animation */}
              <AnimatePresence initial={false}>
                {(mobile || isOpen) && (
                  <motion.div
                    key="items"
                    initial={mobile ? false : "closed"}
                    animate="open" exit="closed"
                    variants={PANEL}
                    className="overflow-hidden"
                  >
                    <div className="space-y-0.5">
                      {visibleItems.map(item => {
                        if (mobile) {
                          const active = item.href === '/' ? location === '/' : location.startsWith(item.href.split('?')[0]);
                          return (
                            <Link key={item.href} href={item.href} onClick={() => setMobileOpen(false)} className={navItemCls(active)}>
                              {active && <ActiveBar />}
                              <item.icon className={navIconCls(active, group.key)} />
                              <span className="flex-1 truncate">{item.label}</span>
                            </Link>
                          );
                        }
                        return renderNavItem(item, group.key);
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}

        {isOrderCustomized && !mobile && (
          <button onClick={resetGroupOrder}
            className="w-full flex items-center gap-1 px-2 py-0.5 mt-1 text-[9px] text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors">
            <RotateCcw className="h-2.5 w-2.5" /> Reset menu order
          </button>
        )}

        {/* Custom groups */}
        {customGroups.map(cg => {
          const cgItems = ALL_PICKABLE_ITEMS.filter(it => cg.itemHrefs.includes(it.href));
          const isOpen = mobile ? true : isGroupOpen(cg.id);
          return (
            <div key={cg.id} className="pt-1.5">
              <div className={cn(
                "group/cg w-full flex items-center gap-2 px-2.5 py-1.5 mb-0.5 rounded-lg text-[11px] font-semibold uppercase tracking-[0.06em] transition-all duration-150",
                isOpen
                  ? "bg-white/[0.06] text-foreground/65 border border-white/[0.08]"
                  : "text-muted-foreground/40 hover:text-muted-foreground/65 hover:bg-white/[0.04] border border-transparent"
              )}>
                <button className="flex-1 flex items-center gap-2 text-left" onClick={!mobile ? () => toggleGroup(cg.id) : undefined}>
                  <FolderPlus className={cn("h-3 w-3 flex-shrink-0 opacity-60", cg.tint)} />
                  <span className="flex-1">{cg.label}</span>
                </button>
                {!mobile && (
                  <>
                    <button onClick={() => handleDeleteCustomGroup(cg.id)}
                      className="opacity-0 group-hover/cg:opacity-100 p-0.5 rounded text-muted-foreground/40 hover:text-rose-400 transition-all"
                      title="Delete group">
                      <Trash2 className="h-3 w-3" />
                    </button>
                    <ChevronDown onClick={() => toggleGroup(cg.id)}
                      className={cn("h-3.5 w-3.5 flex-shrink-0 transition-transform duration-200 text-muted-foreground/40 cursor-pointer", isOpen && "rotate-180 text-muted-foreground/60")} />
                  </>
                )}
              </div>
              <AnimatePresence initial={false}>
                {(mobile || isOpen) && (
                  <motion.div key="items" initial={mobile ? false : "closed"} animate="open" exit="closed" variants={PANEL} className="overflow-hidden">
                    <div className="space-y-0.5">
                      {cgItems.map(item => {
                        const active = location.startsWith(item.href.split('?')[0]);
                        return (
                          <Link key={item.href} href={item.href}
                            onClick={mobile ? () => setMobileOpen(false) : undefined}
                            className={navItemCls(active)}>
                            {active && <ActiveBar />}
                            <item.icon className={navIconCls(active, cg.id)} />
                            <span className="flex-1 truncate">{item.label}</span>
                          </Link>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}

        {/* Group+ button */}
        {!mobile && role === 'admin' && (
          <button
            onClick={() => setGroupPlusOpen(true)}
            data-testid="button-group-plus"
            className="w-full flex items-center gap-2 px-2.5 py-1.5 mt-1 rounded-lg text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/30 hover:text-muted-foreground/60 hover:bg-white/[0.04] border border-dashed border-white/[0.06] hover:border-white/[0.14] transition-all duration-150"
          >
            <Plus className="h-3 w-3 flex-shrink-0" />
            <span>New Group</span>
          </button>
        )}

        {/* Pinned bottom */}
        <div className="mt-3 pt-2 border-t border-white/[0.05] space-y-0.5">
          {NAV_PINNED_BOTTOM.filter(isItemVisible).map(item => {
            const active = location.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href}
                onClick={mobile ? () => setMobileOpen(false) : undefined}
                className={navItemCls(active)}>
                {active && <ActiveBar />}
                <item.icon className={navIconCls(active)} />
                <span className="flex-1">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );

  // ── User footer ───────────────────────────────────────────────────────────────
  const UserFooter = ({ slim = false }: { slim?: boolean }) => !user ? null : (
    slim ? (
      <div className="flex flex-col items-center gap-2">
        <div title={`${user.firstName || user.email} — ${badge.label}`}
          className="h-7 w-7 rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-400 font-bold text-xs">
          {user.firstName?.[0] || user.email?.[0]?.toUpperCase() || "U"}
        </div>
        <button onClick={toggleTheme} title={theme === 'dark' ? 'Light' : 'Dark'} data-testid="button-theme-toggle-collapsed"
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-colors">
          {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
        </button>
        <button onClick={() => logout()}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-rose-400 hover:bg-rose-500/10 transition-colors">
          <LogOut className="h-3.5 w-3.5" />
        </button>
      </div>
    ) : (
      <div className="flex items-center gap-2.5 px-1">
        <div className="h-7 w-7 rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-400 font-bold text-xs flex-shrink-0">
          {user.firstName?.[0] || user.email?.[0]?.toUpperCase() || "U"}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-medium truncate leading-tight">{user.firstName || user.email}</p>
          <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded-full", badge.color)}>{badge.label}</span>
        </div>
        <div className="flex gap-0.5 flex-shrink-0">
          <button onClick={toggleTheme} title={theme === 'dark' ? 'Light' : 'Dark'} data-testid="button-theme-toggle"
            className="p-1.5 rounded-lg text-muted-foreground/50 hover:text-foreground hover:bg-white/[0.06] transition-colors">
            {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </button>
          <button onClick={() => logout()}
            className="p-1.5 rounded-lg text-muted-foreground/50 hover:text-rose-400 hover:bg-rose-500/10 transition-colors">
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    )
  );

  // ── Logo header ───────────────────────────────────────────────────────────────
  const Logo = () => (
    <div className="flex items-center gap-2.5">
      <div className="bg-indigo-600/25 p-1.5 rounded-lg flex-shrink-0 border border-indigo-500/20">
        <Activity className="h-4 w-4 text-indigo-400" />
      </div>
      <div>
        <h1 className="font-bold text-[13px] tracking-tight leading-tight">BITSAUTO</h1>
        <p className="text-[9px] text-muted-foreground/50 font-mono tracking-wide">NOC Platform</p>
      </div>
    </div>
  );

  // ── Shared sidebar CSS class ──────────────────────────────────────────────────
  const sidebarCls = "border-r border-white/[0.05] bg-[hsl(var(--background)/0.75)] backdrop-blur-xl";

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <AppNavShell />

      {/* ── Sidebar + content row ────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row flex-1 min-h-0 overflow-hidden">

      {/* ── Desktop Sidebar ─────────────────────────────────────────────────── */}
      <aside className={cn(
        "hidden md:flex flex-col flex-shrink-0 z-50 transition-all duration-300 overflow-hidden",
        sidebarCls,
        collapsed ? "w-[64px]" : "w-[240px]"
      )}>
        {/* Header */}
        <div className={cn(
          "border-b border-white/[0.05] flex items-center flex-shrink-0 transition-all duration-300",
          collapsed ? "p-3 justify-center" : "px-4 py-3"
        )}>
          {collapsed ? (
            <button onClick={() => setCollapsed(false)} title="Expand sidebar" data-testid="sidebar-expand-btn"
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-colors">
              <PanelLeftOpen className="h-5 w-5" />
            </button>
          ) : (
            <div className="flex items-center w-full">
              <div className="flex-1"><Logo /></div>
              <button onClick={() => setCollapsed(true)} title="Collapse sidebar" data-testid="sidebar-collapse-btn"
                className="p-1.5 rounded-lg text-muted-foreground/40 hover:text-foreground hover:bg-white/[0.06] transition-colors">
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>

        {/* Collapsed icon strip */}
        {collapsed && (
          <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
            {allFlatItems.filter(isItemVisible).map(item => {
              const active = item.href === '/' ? location === '/' : location.startsWith(item.href.split('?')[0]);
              return (
                <Link key={item.href} href={item.href} title={item.label}
                  className={cn(
                    "relative flex items-center justify-center w-full p-2.5 rounded-lg transition-all duration-150",
                    active ? "bg-white/[0.08] text-foreground" : "text-muted-foreground/55 hover:text-foreground hover:bg-white/[0.05]"
                  )}>
                  {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-[60%] rounded-r-full bg-gradient-to-b from-violet-400 to-indigo-500" />}
                  <item.icon className="h-[15px] w-[15px]" />
                </Link>
              );
            })}
          </nav>
        )}

        {/* Expanded nav */}
        {!collapsed && (
          <div className="flex flex-col flex-1 min-h-0 pt-3">
            <NavContent />
          </div>
        )}

        {/* Sippy health */}
        <div className={cn("border-t border-white/[0.05] flex-shrink-0", collapsed ? "px-2 py-1.5" : "px-3 py-1.5")}>
          <SippyHealthBadge collapsed={collapsed} />
        </div>

        {/* User footer */}
        <div className={cn("border-t border-white/[0.05] flex-shrink-0", collapsed ? "p-2" : "p-3")}>
          <UserFooter slim={collapsed} />
        </div>
      </aside>

      {/* ── Mobile ──────────────────────────────────────────────────────────── */}
      <div className="md:hidden flex flex-col flex-1 min-h-0">
        <header className="h-14 border-b border-border/40 flex items-center px-4 gap-3 bg-background/80 backdrop-blur-md sticky top-0 z-40">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <button className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors" aria-label="Open menu" data-testid="button-mobile-menu">
                <Menu className="h-5 w-5" />
              </button>
            </SheetTrigger>
            <SheetContent side="left" className={cn("w-[256px] p-0 flex flex-col", sidebarCls)}>
              <div className="flex items-center gap-2.5 px-4 py-3 border-b border-white/[0.05]">
                <Logo />
              </div>
              <div className="flex flex-col flex-1 min-h-0 pt-3">
                <NavContent mobile />
              </div>
              {user && (
                <div className="border-t border-white/[0.05] p-3">
                  <UserFooter />
                </div>
              )}
            </SheetContent>
          </Sheet>
          <Activity className="h-5 w-5 text-indigo-400" />
          <span className="font-bold flex-1 text-sm tracking-tight">BITSAUTO</span>
          <button onClick={toggleTheme} data-testid="button-theme-toggle-mobile"
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors">
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </header>
        <main className="flex-1 overflow-y-auto p-4 relative scroll-smooth">
          <div className="max-w-7xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {children}
          </div>
        </main>
      </div>

      {/* ── Desktop main content ─────────────────────────────────────────────── */}
      <main className="hidden md:flex flex-1 flex-col min-h-0 overflow-hidden">
        <div className="flex-1 overflow-y-auto p-6 md:p-8 relative scroll-smooth">
          <div className="max-w-7xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {children}
          </div>
        </div>
      </main>

      </div>{/* end sidebar + content row */}

      {/* ── Globals ──────────────────────────────────────────────────────────── */}
      <CommandBar />
      <FixButton />
      <GroupPlusDialog
        open={groupPlusOpen}
        onClose={() => setGroupPlusOpen(false)}
        onCreate={handleCreateCustomGroup}
      />
    </div>
  );
}
