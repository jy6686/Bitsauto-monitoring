import { Link, useLocation, useSearch } from "wouter";
import { LayoutDashboard, Phone, Bell, Settings, Activity, BarChart2, Users, Building2, UserCog, ShieldAlert, FileText, Wrench, Globe, Wallet, PhoneIncoming, ChevronDown, BarChart3, List, HeartPulse, History, Server, Wifi, TrendingDown, HardDrive, Radio, LineChart, Eye, ContactRound, ChevronRight, PanelLeftClose, PanelLeftOpen, LogOut, ScanSearch, CreditCard, TrendingUp, Sun, Moon, Menu, Key, Command, PhoneCall, GitBranch, Workflow, ShieldCheck, Lightbulb, Layers, MessageSquare, Package, FlaskConical, Shield, Lock, Mail, Star, Calculator, Zap, Route, ArrowRightLeft, Database, Network, Upload, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Role } from "@shared/schema";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { CommandBar } from "@/components/command-bar";
import { FixButton } from "@/components/fix-button";
import { SippyHealthBadge } from "@/components/sippy-health-badge";
import { useOrgScope } from "@/context/org-scope-context";

interface Kam { id: number; name: string; active: boolean; }

const BITSEYE_FIXED = [
  { view: 'clients',      label: 'Clients',      iconColor: 'text-amber-400'  },
  { view: 'vendors',      label: 'Vendors',       iconColor: 'text-cyan-400'   },
  { view: 'destinations', label: 'Destinations',  iconColor: 'text-emerald-400'},
  { view: 'countries',    label: 'Countries',     iconColor: 'text-sky-400'    },
] as const;

interface LayoutShellProps {
  children: React.ReactNode;
}

const ROLE_BADGE: Record<Role, { label: string; color: string }> = {
  admin:      { label: "Admin",      color: "text-rose-400 bg-rose-500/10"   },
  management: { label: "Management", color: "text-amber-400 bg-amber-500/10" },
  viewer:     { label: "Viewer",     color: "text-blue-400 bg-blue-500/10"   },
};

const CALLS_SUBITEMS = [
  { view: 'summary', label: 'Active Call Summary', icon: BarChart3,  iconColor: 'text-violet-400', itemId: 'live_summary'  },
  { view: 'details', label: 'Active Call Details',  icon: List,       iconColor: 'text-cyan-400',   itemId: 'live_details'  },
  { view: 'quality', label: 'Quality Monitoring',   icon: HeartPulse, iconColor: 'text-rose-400',   itemId: 'live_quality'  },
  { view: 'history', label: 'Call History',         icon: History,    iconColor: 'text-amber-400',  itemId: 'call_history'  },
] as const;

const CDR_SUBITEMS = [
  { view: 'client', label: 'Client CDRs',  iconColor: 'text-amber-400' },
  { view: 'vendor', label: 'Vendor CDRs',  iconColor: 'text-cyan-400'  },
] as const;

const MONITORING_SUBITEMS = [
  { tab: 'reachability',  label: 'Reachability / Outage', icon: Wifi,        iconColor: 'text-emerald-400' },
  { tab: 'bandwidth',     label: 'Bandwidth (RTP)',        icon: Activity,    iconColor: 'text-cyan-400'    },
  { tab: 'disk-memory',   label: 'Disk & Memory',         icon: HardDrive,   iconColor: 'text-amber-400'   },
  { tab: 'carrier-asr',   label: 'Carrier ASR Alerts',    icon: TrendingDown,iconColor: 'text-violet-400'  },
  { tab: 'alert-rules',   label: 'Email / Webhook Alerts',icon: Bell,        iconColor: 'text-blue-400'    },
  { tab: 'registrations', label: 'Reg Storm Detection',   icon: Radio,       iconColor: 'text-rose-400'    },
] as const;

const TOOLS_SUBITEMS = [
  { tab: 'carrier',     label: 'Carrier Quality',   icon: Star,          iconColor: 'text-amber-400'   },
  { tab: 'capacity',    label: 'SIP Capacity',       icon: Calculator,    iconColor: 'text-cyan-400'    },
  { tab: 'bandwidth',   label: 'Bandwidth Planner',  icon: Wifi,          iconColor: 'text-emerald-400' },
  { tab: 'burst',       label: 'Burst Simulator',    icon: Zap,           iconColor: 'text-yellow-400'  },
  { tab: 'route',       label: 'Route Tester',       icon: Route,         iconColor: 'text-violet-400'  },
  { tab: 'translation', label: 'Translation Tester', icon: ArrowRightLeft,iconColor: 'text-blue-400'    },
] as const;

const ITEM_NAV_MAP: Record<string, string> = {
  live_summary:      '/calls',
  live_details:      '/calls',
  live_quality:      '/calls',
  call_history:      '/calls',
  balance_monitor:   '/balance',
  alerts:            '/alerts',
  fraud_fas:         '/fraud',
  traffic_map:       '/traffic-map',
  graphs:            '/graphs',
  bitseye:           '/bitseye',
  server_monitoring: '/server-monitoring',
  cdr_viewer:        '/cdrs',
  reports:           '/reports',
  route_quality:     '/reports',
  did_management:    '/dids',
};

const SIDEBAR_KEY    = 'voip-sidebar-collapsed';
const GROUPS_LS_KEY  = 'voip-sidebar-groups';

type SubmenuType = 'calls' | 'bitseye' | 'cdr' | 'monitoring' | 'ratecards' | 'settings' | 'tools';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: Role[];
  hasSubmenu?: SubmenuType;
  status?: 'live' | 'partial' | 'planned';
}

interface NavGroup {
  key: string;
  label: string;
  roles: Role[];
  items: NavItem[];
}

const NAV_PINNED_TOP: NavItem[] = [
  { href: "/",      label: "Dashboard",  icon: LayoutDashboard, roles: ['admin','management','viewer'] },
  { href: "/chat",  label: "Team Chat",  icon: MessageSquare,   roles: ['admin','management','viewer'] },
];

const NAV_PINNED_BOTTOM: NavItem[] = [
  { href: "/account", label: "My Account", icon: UserCog, roles: ['admin','management','viewer'] },
];

const SIDEBAR_GROUPS: NavGroup[] = [
  {
    key: 'monitoring',
    label: 'Monitoring',
    roles: ['admin','management','viewer'],
    items: [
      { href: "/calls",             label: "Live Calls",        icon: Phone,     roles: ['admin','management','viewer'], hasSubmenu: 'calls'      },
      { href: "/alerts",            label: "Alerts",            icon: Bell,      roles: ['admin','management']                                    },
      { href: "/server-monitoring", label: "Server Monitoring", icon: Server,    roles: ['admin','management'],          hasSubmenu: 'monitoring' },
    ],
  },
  {
    key: 'operations',
    label: 'Operations',
    roles: ['admin','management'],
    items: [
      { href: "/dids",           label: "DID Management",    icon: PhoneIncoming, roles: ['admin','management'] },
      { href: "/traffic-map",    label: "Traffic Map",       icon: Globe,         roles: ['admin','management'] },
      { href: "/multi-switch",   label: "Multi-Switch View", icon: Layers,        roles: ['admin','management'] },
      { href: "/test-call",      label: "Test Call",         icon: PhoneCall,     roles: ['admin','management'] },
      { href: "/test-campaigns", label: "Test Campaigns",    icon: FlaskConical,  roles: ['admin','management'] },
    ],
  },
  {
    key: 'routing',
    label: 'Routing',
    roles: ['admin','management'],
    items: [
      { href: "/lcr-analyser",                          label: "LCR Analyser",            icon: GitBranch,     roles: ['admin','management']                    },
      { href: "/call-flow-simulator",                   label: "Call Flow Simulator",     icon: Workflow,      roles: ['admin','management']                    },
      // ── 9 tracked routing features ────────────────────────────────────────────
      { href: "/routing-manager?tab=routing-groups",   label: "Routing Group Manager",   icon: Database,      roles: ['admin','management'], status: 'live'     },
      { href: "/routing-manager?tab=destination-sets", label: "Destination Set Explorer",icon: Layers,        roles: ['admin','management'], status: 'live'     },
      { href: "/routing-manager?tab=qbr",              label: "QBR Dashboard",           icon: ShieldCheck,   roles: ['admin','management'] },
      { href: "/call-flow-simulator",                  label: "Routing Audit Trail",     icon: History,       roles: ['admin','management'], status: 'live'     },
      { href: "/routing-manager?tab=connections",      label: "Connection Coverage Map", icon: Network,       roles: ['admin','management'] },
      { href: "/rate-cards",                           label: "Bulk Rate / Route Upload",icon: Upload,        roles: ['admin','management']  },
      { href: "/routing-manager?tab=on-net",           label: "On-Net Routing Viewer",   icon: Wifi,          roles: ['admin','management'], status: 'planned'  },
      { href: "/routing-manager?tab=policy-sim",       label: "Routing Policy Simulator",icon: Calculator,    roles: ['admin','management'], status: 'planned'  },
      { href: "/tools?tab=route-tester",               label: "Prefix Coverage Checker", icon: Search,        roles: ['admin','management'], status: 'planned'  },
    ],
  },
  {
    key: 'analytics',
    label: 'Analytics & Reports',
    roles: ['admin','management'],
    items: [
      { href: "/graphs",      label: "Graphs",            icon: LineChart,  roles: ['admin','management']                        },
      { href: "/bitseye",     label: "BitsEye",           icon: Eye,        roles: ['admin','management'], hasSubmenu: 'bitseye' },
      { href: "/reports",     label: "Reports",           icon: BarChart2,  roles: ['admin','management']                        },
      { href: "/cdrs",        label: "CDR Viewer",        icon: FileText,   roles: ['admin','management'], hasSubmenu: 'cdr'     },
      { href: "/analytics",   label: "Revenue Analytics", icon: TrendingUp, roles: ['admin','management']                        },
      { href: "/qos-heatmap", label: "QoS Heatmap",       icon: Activity,   roles: ['admin','management']                        },
    ],
  },
  {
    key: 'products',
    label: 'Products',
    roles: ['admin','management'],
    items: [
      { href: "/products", label: "Product Classification", icon: Package, roles: ['admin','management'] },
    ],
  },
  {
    key: 'finance',
    label: 'Finance',
    roles: ['admin','management'],
    items: [
      { href: "/balance",           label: "Balance Monitor",   icon: Wallet,    roles: ['admin','management']                          },
      { href: "/rate-cards",        label: "Rate Cards",        icon: CreditCard,roles: ['admin','management'], hasSubmenu: 'ratecards' },
      { href: "/cost-optimisation", label: "Cost Optimisation", icon: Lightbulb, roles: ['admin','management']                          },
      { href: "/billing-disputes",  label: "Billing Disputes",  icon: FileText,  roles: ['admin','management']                          },
    ],
  },
  {
    key: 'security',
    label: 'Security & Fraud',
    roles: ['admin','management'],
    items: [
      { href: "/fraud",                label: "Fraud / FAS",  icon: ShieldAlert, roles: ['admin','management'] },
      { href: "/vendor-sla-scorecard", label: "Vendor SLA",   icon: ShieldCheck, roles: ['admin','management'] },
      { href: "/sla-breaches",         label: "SLA Breaches", icon: Bell,        roles: ['admin','management'] },
      { href: "/firewall",             label: "Firewall Mgr", icon: Shield,      roles: ['admin','management'] },
    ],
  },
  {
    key: 'clients_vendors',
    label: 'Client & Vendor',
    roles: ['admin','management'],
    items: [
      { href: "/clients", label: "Client / Vendor", icon: Building2, roles: ['admin','management'] },
      { href: "/tools",   label: "Tools",           icon: Wrench,    roles: ['admin','management'], hasSubmenu: 'tools' as SubmenuType },
    ],
  },
  {
    key: 'admin',
    label: 'Administration',
    roles: ['admin'],
    items: [
      { href: "/settings",        label: "Settings",        icon: Settings,      roles: ['admin'], hasSubmenu: 'settings' },
      { href: "/whatsapp-alerts", label: "WhatsApp Alerts", icon: MessageSquare, roles: ['admin']                        },
      { href: "/team",            label: "Team & KAM",      icon: Users,         roles: ['admin']                        },
      { href: "/account-names",   label: "Account Names",   icon: Building2,     roles: ['admin']                        },
      { href: "/api-keys",        label: "API Keys",        icon: Key,           roles: ['admin']                        },
      { href: "/vpn-config",      label: "VPN Config",      icon: Lock,          roles: ['admin']                        },
      { href: "/email-centre",    label: "Email Centre",    icon: Mail,          roles: ['admin']                        },
    ],
  },
];

export function LayoutShell({ children }: LayoutShellProps) {
  const [location] = useLocation();
  const search = useSearch();
  const { user, logout, role, isAdmin, isManagement } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const orgScope = useOrgScope();
  const [mobileOpen, setMobileOpen] = useState(false);

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(SIDEBAR_KEY) === 'true'; } catch { return false; }
  });

  const [groupsExpanded, setGroupsExpanded] = useState<Record<string, boolean>>(() => {
    try {
      const stored = localStorage.getItem(GROUPS_LS_KEY);
      if (stored) return JSON.parse(stored);
    } catch { /* ignore */ }
    return {};
  });

  useEffect(() => {
    try { localStorage.setItem(SIDEBAR_KEY, String(collapsed)); } catch { /* ignore */ }
  }, [collapsed]);

  useEffect(() => {
    try { localStorage.setItem(GROUPS_LS_KEY, JSON.stringify(groupsExpanded)); } catch { /* ignore */ }
  }, [groupsExpanded]);

  const isGroupOpen  = (key: string) => groupsExpanded[key] !== false;
  const toggleGroup  = (key: string) => setGroupsExpanded(prev => ({ ...prev, [key]: !isGroupOpen(key) }));

  const isCallsActive        = location.startsWith('/calls');
  const isMonitoringActive   = location.startsWith('/server-monitoring');
  const isBitseyeActive      = location.startsWith('/bitseye');
  const isCdrActive          = location.startsWith('/cdrs');
  const isSettingsActive     = location.startsWith('/settings');
  const isRateCardsActive    = location.startsWith('/rate-cards');
  const isToolsActive        = location.startsWith('/tools');

  const [callsExpanded,      setCallsExpanded]      = useState(isCallsActive);
  const [monitoringExpanded, setMonitoringExpanded] = useState(isMonitoringActive);
  const [bitseyeExpanded,    setBitseyeExpanded]    = useState(isBitseyeActive);
  const [cdrExpanded,        setCdrExpanded]        = useState(isCdrActive);
  const [settingsExpanded,   setSettingsExpanded]   = useState(isSettingsActive);
  const [rateCardsExpanded,  setRateCardsExpanded]  = useState(isRateCardsActive);
  const [toolsExpanded,      setToolsExpanded]      = useState(isToolsActive);

  useEffect(() => { if (isCallsActive)      setCallsExpanded(true);      }, [isCallsActive]);
  useEffect(() => { if (isMonitoringActive) setMonitoringExpanded(true);  }, [isMonitoringActive]);
  useEffect(() => { if (isBitseyeActive)    setBitseyeExpanded(true);     }, [isBitseyeActive]);
  useEffect(() => { if (isCdrActive)        setCdrExpanded(true);         }, [isCdrActive]);
  useEffect(() => { if (isSettingsActive)   setSettingsExpanded(true);    }, [isSettingsActive]);
  useEffect(() => { if (isRateCardsActive)  setRateCardsExpanded(true);   }, [isRateCardsActive]);
  useEffect(() => { if (isToolsActive)      setToolsExpanded(true);       }, [isToolsActive]);

  const { data: kamList = [] } = useQuery<Kam[]>({
    queryKey: ['/api/kam'],
    enabled: (role === 'admin' || role === 'management') && bitseyeExpanded,
    staleTime: 120_000,
  });

  const { data: viewerKamData } = useQuery<{ kamId: number | null; kamName: string | null; accountIds: string[]; clientNames: string[] }>({
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

  const VIEWER_ALWAYS_SHOW = new Set(['/', '/account', '/chat']);

  const isItemVisible = (item: NavItem): boolean => {
    if (role === 'viewer') {
      if (VIEWER_ALWAYS_SHOW.has(item.href)) return true;
      return [...assignedItemSet].some(id => ITEM_NAV_MAP[id] === item.href);
    }
    return item.roles.includes(role);
  };

  const visibleCallsSubitems = role === 'viewer'
    ? CALLS_SUBITEMS.filter(sub => assignedItemSet.has(sub.itemId))
    : CALLS_SUBITEMS;

  const badge = ROLE_BADGE[role];

  const currentView = isCallsActive
    ? (new URLSearchParams(search).get('view') ?? 'summary')
    : null;

  const navItemClass = (isActive: boolean) => cn(
    "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 group",
    collapsed && "justify-center px-0",
    isActive
      ? "bg-primary text-primary-foreground shadow-md shadow-primary/10"
      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
  );

  const navIconClass = (isActive: boolean) => cn(
    "h-4 w-4 transition-colors flex-shrink-0",
    isActive ? "text-primary-foreground" : "text-muted-foreground group-hover:text-foreground"
  );

  const subItemClass = (isActive: boolean) => cn(
    "flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-150",
    isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
  );

  // Compute active state for a nav item — supports ?param=value matching
  const isNavItemActive = (href: string): boolean => {
    if (href === '/') return location === '/';
    const [hrefPath, hrefQuery] = href.split('?');
    if (!location.startsWith(hrefPath)) return false;
    if (!hrefQuery) return true;
    const hrefParams = new URLSearchParams(hrefQuery);
    const curParams  = new URLSearchParams(search);
    return [...hrefParams.entries()].every(([k, v]) => curParams.get(k) === v);
  };

  // Render a single nav item with any applicable submenu (desktop expanded mode)
  const renderNavItem = (item: NavItem) => {
    const isActive = isNavItemActive(item.href);

    /* ── Live Calls submenu ── */
    if (item.hasSubmenu === 'calls') {
      if (role === 'viewer' && visibleCallsSubitems.length === 0) return null;
      return (
        <div key={item.href}>
          <button onClick={() => setCallsExpanded(o => !o)} className={navItemClass(isActive)}>
            <item.icon className={navIconClass(isActive)} />
            <span className="flex-1 text-left">{item.label}</span>
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-200 flex-shrink-0",
              callsExpanded ? "rotate-180" : "",
              isActive ? "text-primary-foreground/70" : "text-muted-foreground/50")} />
          </button>
          {callsExpanded && (
            <div className="mt-0.5 ml-4 pl-3 border-l border-border/40 space-y-0.5">
              {visibleCallsSubitems.map(sub => {
                const subActive = isActive && currentView === sub.view;
                return (
                  <Link key={sub.view} href={`/calls?view=${sub.view}`} className={subItemClass(subActive)}>
                    <sub.icon className={cn("h-3.5 w-3.5 flex-shrink-0", subActive ? "text-primary" : sub.iconColor)} />
                    {sub.label}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    /* ── BitsEye submenu ── */
    if (item.hasSubmenu === 'bitseye') {
      const bsParams = new URLSearchParams(search);
      const bsView   = isBitseyeActive ? (bsParams.get('view') ?? 'clients') : null;
      const bsKamId  = isBitseyeActive ? bsParams.get('kamId') : null;
      return (
        <div key={item.href}>
          <button onClick={() => setBitseyeExpanded(o => !o)} className={navItemClass(isBitseyeActive)}>
            <item.icon className={navIconClass(isBitseyeActive)} />
            <span className="flex-1 text-left">{item.label}</span>
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-200 flex-shrink-0",
              bitseyeExpanded ? "rotate-180" : "",
              isBitseyeActive ? "text-primary-foreground/70" : "text-muted-foreground/50")} />
          </button>
          {bitseyeExpanded && (
            <div className="mt-0.5 ml-4 pl-3 border-l border-border/40 space-y-0.5">
              {BITSEYE_FIXED.map(sub => {
                const subActive = isBitseyeActive && bsView === sub.view && !bsKamId;
                return (
                  <Link key={sub.view} href={`/bitseye?view=${sub.view}`} className={subItemClass(subActive)}>
                    <BarChart3 className={cn("h-3.5 w-3.5 flex-shrink-0", subActive ? "text-primary" : sub.iconColor)} />
                    {sub.label}
                  </Link>
                );
              })}
              <div className="flex items-center gap-2 pt-1 pb-0.5 px-2">
                <ContactRound className="h-3 w-3 text-violet-400/60 flex-shrink-0" />
                <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/35">KAM</span>
              </div>
              {/* Org-scoped users (SVP/VP/Manager/TeamLead/KAM) get a "My Portfolio" link */}
              {orgScope.isScoped && orgScope.kamId ? (
                <Link href={`/bitseye?view=kam&kamId=${orgScope.kamId}`}
                  className={cn("flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150",
                    (isBitseyeActive && bsView === 'kam' && bsKamId === String(orgScope.kamId)) ? "bg-violet-500/10 text-violet-300" : "text-muted-foreground/70 hover:text-foreground hover:bg-muted/40")}>
                  <ContactRound className={cn("h-3.5 w-3.5 flex-shrink-0", (isBitseyeActive && bsView === 'kam' && bsKamId === String(orgScope.kamId)) ? "text-violet-300" : "text-violet-400/70")} />
                  <span className="flex-1 truncate">
                    {orgScope.kamName ?? 'My Portfolio'}
                    {orgScope.orgRole && (
                      <span className="ml-1.5 text-[9px] opacity-60">({orgScope.orgRole})</span>
                    )}
                  </span>
                </Link>
              ) : role === 'viewer' ? (
                viewerKamData?.kamId ? (
                  <Link href={`/bitseye?view=kam&kamId=${viewerKamData.kamId}`}
                    className={cn("flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150",
                      (isBitseyeActive && bsView === 'kam' && bsKamId === String(viewerKamData.kamId)) ? "bg-violet-500/10 text-violet-300" : "text-muted-foreground/70 hover:text-foreground hover:bg-muted/40")}>
                    <ContactRound className={cn("h-3.5 w-3.5 flex-shrink-0", (isBitseyeActive && bsView === 'kam' && bsKamId === String(viewerKamData.kamId)) ? "text-violet-300" : "text-violet-400/70")} />
                    <span className="flex-1 truncate">{viewerKamData.kamName ?? 'My Portfolio'}</span>
                  </Link>
                ) : (
                  <p className="text-[10px] text-muted-foreground/30 px-3 py-1">No KAM assigned</p>
                )
              ) : (
                <>
                  <Link href="/bitseye?view=kam"
                    className={cn("flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-150",
                      (isBitseyeActive && bsView === 'kam' && !bsKamId) ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/40")}>
                    <ContactRound className={cn("h-3.5 w-3.5 flex-shrink-0", (isBitseyeActive && bsView === 'kam' && !bsKamId) ? "text-primary" : "text-violet-400/70")} />
                    All KAMs
                  </Link>
                  {kamList.map(kam => {
                    const kamActive = isBitseyeActive && bsView === 'kam' && bsKamId === String(kam.id);
                    return (
                      <Link key={kam.id} href={`/bitseye?view=kam&kamId=${kam.id}`}
                        className={cn("flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150",
                          kamActive ? "bg-violet-500/10 text-violet-300" : "text-muted-foreground/70 hover:text-foreground hover:bg-muted/40")}>
                        <ChevronRight className="h-2.5 w-2.5 flex-shrink-0 text-muted-foreground/30" />
                        <span className="flex-1 truncate">{kam.name}</span>
                      </Link>
                    );
                  })}
                </>
              )}
            </div>
          )}
        </div>
      );
    }

    /* ── CDR submenu ── */
    if (item.hasSubmenu === 'cdr') {
      const cdrView = isCdrActive ? (new URLSearchParams(search).get('view') ?? 'client') : null;
      return (
        <div key={item.href}>
          <button onClick={() => setCdrExpanded(o => !o)} className={navItemClass(isCdrActive)}>
            <item.icon className={navIconClass(isCdrActive)} />
            <span className="flex-1 text-left">{item.label}</span>
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-200 flex-shrink-0",
              cdrExpanded ? "rotate-180" : "",
              isCdrActive ? "text-primary-foreground/70" : "text-muted-foreground/50")} />
          </button>
          {cdrExpanded && (
            <div className="mt-0.5 ml-4 pl-3 border-l border-border/40 space-y-0.5">
              {CDR_SUBITEMS.map(sub => {
                const subActive = isCdrActive && cdrView === sub.view;
                return (
                  <Link key={sub.view} href={`/cdrs?view=${sub.view}`} className={subItemClass(subActive)}>
                    <FileText className={cn("h-3.5 w-3.5 flex-shrink-0", subActive ? "text-primary" : sub.iconColor)} />
                    {sub.label}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    /* ── Server Monitoring submenu ── */
    if (item.hasSubmenu === 'monitoring') {
      const currentMonTab = isMonitoringActive
        ? (new URLSearchParams(search).get('tab') ?? 'reachability')
        : null;
      return (
        <div key={item.href}>
          <button onClick={() => setMonitoringExpanded(o => !o)} className={navItemClass(isActive)}>
            <item.icon className={navIconClass(isActive)} />
            <span className="flex-1 text-left">{item.label}</span>
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-200 flex-shrink-0",
              monitoringExpanded ? "rotate-180" : "",
              isActive ? "text-primary-foreground/70" : "text-muted-foreground/50")} />
          </button>
          {monitoringExpanded && (
            <div className="mt-0.5 ml-4 pl-3 border-l border-border/40 space-y-0.5">
              {MONITORING_SUBITEMS.map(sub => {
                const subActive = isMonitoringActive && currentMonTab === sub.tab;
                return (
                  <Link key={sub.tab} href={`/server-monitoring?tab=${sub.tab}`} className={subItemClass(subActive)}>
                    <sub.icon className={cn("h-3.5 w-3.5 flex-shrink-0", subActive ? "text-primary" : sub.iconColor)} />
                    {sub.label}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    /* ── Rate Cards submenu ── */
    if (item.hasSubmenu === 'ratecards') {
      const rcType = isRateCardsActive ? new URLSearchParams(search).get('type') : null;
      return (
        <div key={item.href}>
          <button onClick={() => setRateCardsExpanded(o => !o)} className={navItemClass(isRateCardsActive)}>
            <item.icon className={navIconClass(isRateCardsActive)} />
            <span className="flex-1 text-left">{item.label}</span>
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-200 flex-shrink-0",
              rateCardsExpanded ? "rotate-180" : "",
              isRateCardsActive ? "text-primary-foreground/70" : "text-muted-foreground/50")} />
          </button>
          {rateCardsExpanded && (
            <div className="mt-0.5 ml-4 pl-3 border-l border-border/40 space-y-0.5">
              {([
                { type: 'client', label: 'Client Rate Cards',  icon: Building2, iconColor: 'text-amber-400' },
                { type: 'vendor', label: 'Vendor Rate Cards',   icon: Wallet,    iconColor: 'text-cyan-400'  },
              ] as const).map(sub => {
                const subActive = isRateCardsActive && rcType === sub.type;
                return (
                  <Link key={sub.type} href={`/rate-cards?type=${sub.type}`} className={subItemClass(subActive)}>
                    <sub.icon className={cn("h-3.5 w-3.5 flex-shrink-0", subActive ? "text-primary" : sub.iconColor)} />
                    {sub.label}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    /* ── Settings submenu ── */
    if (item.hasSubmenu === 'settings') {
      const settingsSearch = isSettingsActive ? new URLSearchParams(search).get('section') : null;
      return (
        <div key={item.href}>
          <button onClick={() => setSettingsExpanded(o => !o)} className={navItemClass(isSettingsActive)}>
            <item.icon className={navIconClass(isSettingsActive)} />
            <span className="flex-1 text-left">{item.label}</span>
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-200 flex-shrink-0",
              settingsExpanded ? "rotate-180" : "",
              isSettingsActive ? "text-primary-foreground/70" : "text-muted-foreground/50")} />
          </button>
          {settingsExpanded && (
            <div className="mt-0.5 ml-4 pl-3 border-l border-border/40 space-y-0.5">
              {[
                { href: '/settings',                 label: 'General Settings', icon: Settings,   color: 'text-blue-400', section: null      },
                { href: '/settings?section=watcher', label: 'Sippy Watcher',   icon: ScanSearch,  color: 'text-cyan-400', section: 'watcher' },
              ].map(sub => {
                const subActive = isSettingsActive && settingsSearch === sub.section;
                return (
                  <Link key={sub.href} href={sub.href} className={subItemClass(subActive)}>
                    <sub.icon className={cn("h-3.5 w-3.5 flex-shrink-0", subActive ? "text-primary" : sub.color)} />
                    {sub.label}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    /* ── Tools submenu ── */
    if (item.hasSubmenu === 'tools') {
      const toolsTab = isToolsActive ? (new URLSearchParams(search).get('tab') ?? 'carrier') : null;
      return (
        <div key={item.href}>
          <button onClick={() => setToolsExpanded(o => !o)} className={navItemClass(isToolsActive)}>
            <item.icon className={navIconClass(isToolsActive)} />
            <span className="flex-1 text-left">{item.label}</span>
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-200 flex-shrink-0",
              toolsExpanded ? "rotate-180" : "",
              isToolsActive ? "text-primary-foreground/70" : "text-muted-foreground/50")} />
          </button>
          {toolsExpanded && (
            <div className="mt-0.5 ml-4 pl-3 border-l border-border/40 space-y-0.5">
              {TOOLS_SUBITEMS.map(sub => {
                const subActive = isToolsActive && toolsTab === sub.tab;
                return (
                  <Link key={sub.tab} href={`/tools?tab=${sub.tab}`} className={subItemClass(subActive)}>
                    <sub.icon className={cn("h-3.5 w-3.5 flex-shrink-0", subActive ? "text-primary" : sub.iconColor)} />
                    {sub.label}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    /* ── Plain nav item ── */
    return (
      <Link key={item.href + (item.label)} href={item.href} className={navItemClass(isActive)}>
        <item.icon className={navIconClass(isActive)} />
        <span className="flex-1 leading-tight">{item.label}</span>
        {item.status === 'planned' && !isActive && (
          <span className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-muted/60 text-muted-foreground/60 border border-border/30 tracking-wide">
            Soon
          </span>
        )}
        {item.status === 'partial' && !isActive && (
          <span className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/25 tracking-wide">
            Partial
          </span>
        )}
      </Link>
    );
  };

  // All items as a flat list for collapsed (icon-only) mode
  const allFlatItems: NavItem[] = [
    ...NAV_PINNED_TOP,
    ...SIDEBAR_GROUPS.flatMap(g => g.items),
    ...NAV_PINNED_BOTTOM,
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">

      {/* ── Sidebar ──────────────────────────────────────────────────────────── */}
      <aside
        className={cn(
          "hidden md:flex flex-col border-r border-border bg-card/50 backdrop-blur-xl flex-shrink-0 z-50 transition-all duration-300 overflow-hidden",
          collapsed ? "w-[68px]" : "w-64"
        )}
      >
        {/* Header */}
        <div className={cn(
          "border-b border-border/50 flex items-center flex-shrink-0 transition-all duration-300",
          collapsed ? "p-3 justify-center" : "p-4"
        )}>
          {collapsed ? (
            <button
              onClick={() => setCollapsed(false)}
              title="Expand sidebar"
              data-testid="sidebar-expand-btn"
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              <PanelLeftOpen className="h-5 w-5" />
            </button>
          ) : (
            <div className="flex items-center gap-3 w-full">
              <div className="bg-blue-600/20 p-2 rounded-lg flex-shrink-0">
                <Activity className="h-5 w-5 text-blue-500" />
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="font-bold text-base tracking-tight leading-tight">Bitsauto Monitoring</h1>
                <p className="text-[10px] text-muted-foreground font-mono">v2.5.0-stable</p>
              </div>
              <button
                onClick={() => setCollapsed(true)}
                title="Collapse sidebar"
                data-testid="sidebar-collapse-btn"
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors flex-shrink-0"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className={cn("flex-1 overflow-y-auto py-3", collapsed ? "px-2 space-y-0.5" : "px-3")}>

          {/* ── COLLAPSED: flat icon list ── */}
          {collapsed && allFlatItems.filter(isItemVisible).map(item => {
            const isActive = isNavItemActive(item.href);
            return (
              <Link key={item.href} href={item.href} title={item.label} className={navItemClass(isActive)}>
                <item.icon className={navIconClass(isActive)} />
              </Link>
            );
          })}

          {/* ── EXPANDED: pinned top + collapsible groups + pinned bottom ── */}
          {!collapsed && (
            <>
              {/* Pinned top (Dashboard) */}
              <div className="space-y-0.5 mb-1">
                {NAV_PINNED_TOP.filter(isItemVisible).map(item => {
                  const isActive = location === '/';
                  return (
                    <Link key={item.href} href={item.href} className={navItemClass(isActive)}>
                      <item.icon className={navIconClass(isActive)} />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>

              {/* Collapsible groups */}
              {SIDEBAR_GROUPS.map(group => {
                const visibleItems = group.items.filter(isItemVisible);
                if (visibleItems.length === 0) return null;
                const isOpen = isGroupOpen(group.key);
                const isGroupActive = visibleItems.some(item => isNavItemActive(item.href));

                return (
                  <div key={group.key} className="mt-3">
                    {/* Group header */}
                    <button
                      data-testid={`sidebar-group-${group.key}`}
                      onClick={() => toggleGroup(group.key)}
                      className={cn(
                        "w-full flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-widest transition-colors",
                        isGroupActive
                          ? "text-muted-foreground/80 hover:text-muted-foreground"
                          : "text-muted-foreground/40 hover:text-muted-foreground/70"
                      )}
                    >
                      <span className="flex-1 text-left">{group.label}</span>
                      <ChevronRight className={cn(
                        "h-3 w-3 transition-transform duration-200 flex-shrink-0",
                        isOpen && "rotate-90"
                      )} />
                    </button>

                    {/* Group items */}
                    {isOpen && (
                      <div className="mt-0.5 space-y-0.5">
                        {visibleItems.map(item => renderNavItem(item))}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Pinned bottom (My Account) */}
              <div className="mt-3 space-y-0.5">
                {NAV_PINNED_BOTTOM.filter(isItemVisible).map(item => {
                  const isActive = location.startsWith(item.href);
                  return (
                    <Link key={item.href} href={item.href} className={navItemClass(isActive)}>
                      <item.icon className={navIconClass(isActive)} />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </>
          )}
        </nav>

        {/* Sippy API Health indicator — shown above user footer */}
        <div className={cn("border-t border-border/30 flex-shrink-0", collapsed ? "px-2 py-1.5" : "px-3 py-1.5")}>
          <SippyHealthBadge collapsed={collapsed} />
        </div>

        {/* User footer */}
        <div className={cn("border-t border-border/50 flex-shrink-0", collapsed ? "p-2" : "p-3")}>
          {user && (
            collapsed ? (
              <div className="flex flex-col items-center gap-2">
                <div
                  title={`${user.firstName || user.email} — ${badge.label}`}
                  className="h-8 w-8 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-500 font-bold text-xs flex-shrink-0 cursor-default"
                >
                  {user.firstName?.[0] || user.email?.[0]?.toUpperCase() || "U"}
                </div>
                <button
                  onClick={toggleTheme}
                  title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                  data-testid="button-theme-toggle-collapsed"
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                >
                  {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
                </button>
                <button
                  onClick={() => logout()}
                  title="Sign Out"
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2 px-2">
                  <button
                    onClick={toggleTheme}
                    title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                    data-testid="button-theme-toggle"
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted/50 transition-colors"
                  >
                    {theme === 'dark'
                      ? <><Sun className="h-3.5 w-3.5" /><span>Light</span></>
                      : <><Moon className="h-3.5 w-3.5" /><span>Dark</span></>
                    }
                  </button>
                  <div className="flex-1" />
                  <button
                    onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))}
                    title="Open command palette (Ctrl+K)"
                    data-testid="button-command-palette"
                    className="flex items-center gap-1 text-[10px] text-muted-foreground/60 hover:text-muted-foreground px-1.5 py-1 rounded hover:bg-muted/30 transition-colors font-mono"
                  >
                    <Command className="h-3 w-3" />
                    <span>K</span>
                  </button>
                </div>
                <div className="flex items-center gap-3 px-2 py-1">
                  <div className="h-8 w-8 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-500 font-bold text-xs flex-shrink-0">
                    {user.firstName?.[0] || user.email?.[0]?.toUpperCase() || "U"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{user.firstName || user.email}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={cn("text-xs font-medium px-1.5 py-0.5 rounded-full", badge.color)}>
                        {badge.label}
                      </span>
                      {role === 'viewer' && assignedItemSet.size > 0 && (
                        <span className="text-xs text-muted-foreground/60">{assignedItemSet.size} items</span>
                      )}
                    </div>
                    <button
                      onClick={() => logout()}
                      className="text-xs text-muted-foreground hover:text-red-400 transition-colors mt-0.5"
                    >
                      Sign Out
                    </button>
                  </div>
                </div>
              </div>
            )
          )}
        </div>
      </aside>

      {/* ── Mobile top bar + slide-out sidebar ── */}
      <div className="md:hidden flex flex-col flex-1 min-h-0">
        <header className="h-14 border-b border-border/50 flex items-center px-4 gap-3 bg-background/80 backdrop-blur-sm sticky top-0 z-40">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <button
                className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                aria-label="Open menu"
                data-testid="button-mobile-menu"
              >
                <Menu className="h-5 w-5" />
              </button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0 border-r border-border bg-card/95 backdrop-blur-xl">
              <div className="flex items-center gap-3 p-4 border-b border-border/50">
                <div className="bg-blue-600/20 p-2 rounded-lg flex-shrink-0">
                  <Activity className="h-5 w-5 text-blue-500" />
                </div>
                <div className="flex-1">
                  <h1 className="font-bold text-base tracking-tight">Bitsauto Monitoring</h1>
                  <p className="text-[10px] text-muted-foreground font-mono">v2.5.0-stable</p>
                </div>
              </div>
              <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
                {/* Mobile: pinned top */}
                {NAV_PINNED_TOP.filter(isItemVisible).map(item => {
                  const isActive = location === '/';
                  return (
                    <Link key={item.href} href={item.href} onClick={() => setMobileOpen(false)}
                      className={cn("w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all",
                        isActive ? "bg-primary text-primary-foreground shadow-md" : "text-muted-foreground hover:text-foreground hover:bg-muted/50")}>
                      <item.icon className="h-4 w-4 flex-shrink-0" />
                      {item.label}
                    </Link>
                  );
                })}

                {/* Mobile: groups with section labels */}
                {SIDEBAR_GROUPS.map(group => {
                  const visibleItems = group.items.filter(isItemVisible);
                  if (visibleItems.length === 0) return null;
                  return (
                    <div key={group.key} className="pt-3">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/40 px-3 pb-1">{group.label}</p>
                      {visibleItems.map(item => {
                        const isActive = item.href === '/' ? location === '/' : location.startsWith(item.href);
                        if (item.hasSubmenu === 'ratecards') {
                          return (
                            <div key={item.href}>
                              {([
                                { type: 'client', label: 'Client Rate Cards', icon: Building2, color: 'text-amber-400' },
                                { type: 'vendor', label: 'Vendor Rate Cards',  icon: Wallet,    color: 'text-cyan-400'  },
                              ] as const).map(sub => {
                                const subActive = isRateCardsActive && new URLSearchParams(search).get('type') === sub.type;
                                return (
                                  <Link key={sub.type} href={`/rate-cards?type=${sub.type}`}
                                    onClick={() => setMobileOpen(false)}
                                    className={cn("w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all",
                                      subActive ? "bg-primary text-primary-foreground shadow-md" : "text-muted-foreground hover:text-foreground hover:bg-muted/50")}>
                                    <sub.icon className="h-4 w-4 flex-shrink-0" />
                                    {sub.label}
                                  </Link>
                                );
                              })}
                            </div>
                          );
                        }
                        if (item.hasSubmenu && item.hasSubmenu !== 'ratecards') return null;
                        return (
                          <Link key={item.href} href={item.href} onClick={() => setMobileOpen(false)}
                            className={cn("w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all",
                              isActive ? "bg-primary text-primary-foreground shadow-md" : "text-muted-foreground hover:text-foreground hover:bg-muted/50")}>
                            <item.icon className="h-4 w-4 flex-shrink-0" />
                            {item.label}
                          </Link>
                        );
                      })}
                    </div>
                  );
                })}

                {/* Mobile: pinned bottom */}
                {NAV_PINNED_BOTTOM.filter(isItemVisible).map(item => {
                  const isActive = location.startsWith(item.href);
                  return (
                    <Link key={item.href} href={item.href} onClick={() => setMobileOpen(false)}
                      className={cn("w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all mt-2",
                        isActive ? "bg-primary text-primary-foreground shadow-md" : "text-muted-foreground hover:text-foreground hover:bg-muted/50")}>
                      <item.icon className="h-4 w-4 flex-shrink-0" />
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
              <div className="border-t border-border/50 p-3 space-y-2">
                <div className="flex items-center gap-2 px-2">
                  <button onClick={toggleTheme} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted/50 transition-colors">
                    {theme === 'dark' ? <><Sun className="h-3.5 w-3.5" /><span>Light mode</span></> : <><Moon className="h-3.5 w-3.5" /><span>Dark mode</span></>}
                  </button>
                </div>
                {user && (
                  <div className="flex items-center gap-3 px-2 py-1">
                    <div className="h-7 w-7 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-500 font-bold text-xs">
                      {user.firstName?.[0] || user.email?.[0]?.toUpperCase() || "U"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{user.firstName || user.email}</p>
                      <span className={cn("text-xs font-medium px-1.5 py-0.5 rounded-full", badge.color)}>{badge.label}</span>
                    </div>
                    <button onClick={() => logout()} className="text-xs text-muted-foreground hover:text-red-400 transition-colors">
                      <LogOut className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            </SheetContent>
          </Sheet>

          <Activity className="h-5 w-5 text-primary" />
          <span className="font-bold flex-1">Bitsauto Monitoring</span>

          <button
            onClick={toggleTheme}
            data-testid="button-theme-toggle-mobile"
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </header>
        <main className="flex-1 overflow-y-auto p-4 relative scroll-smooth">
          <div className="max-w-7xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {children}
          </div>
        </main>
      </div>

      {/* ── Desktop main content ── */}
      <main className="hidden md:flex flex-1 flex-col min-h-0 overflow-hidden">
        <div className="flex-1 overflow-y-auto p-6 md:p-8 relative scroll-smooth">
          <div className="max-w-7xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {children}
          </div>
        </div>
      </main>

      {/* ── Global Command Palette (Cmd+K / Ctrl+K) ── */}
      <CommandBar />

      {/* ── Global Fix Button (Admin + Management only — auto-hidden for Viewer) ── */}
      <FixButton />

    </div>
  );
}
