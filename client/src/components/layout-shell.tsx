import { Link, useLocation, useSearch } from "wouter";
import { LayoutDashboard, Phone, Bell, Settings, Activity, BarChart2, Users, Building2, UserCog, ShieldAlert, FileText, Wrench, Globe, Wallet, PhoneIncoming, ChevronDown, BarChart3, List, HeartPulse, History, Server, Wifi, TrendingDown, HardDrive, Radio, LineChart, Eye, ContactRound, ChevronRight, PanelLeftClose, PanelLeftOpen, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Role } from "@shared/schema";

interface Kam { id: number; name: string; active: boolean; }

const BITSEYE_FIXED = [
  { view: 'clients',      label: 'Clients',      iconColor: 'text-amber-400'  },
  { view: 'vendors',      label: 'Vendors',       iconColor: 'text-cyan-400'   },
  { view: 'destinations', label: 'Destinations',  iconColor: 'text-emerald-400'},
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

const SIDEBAR_KEY = 'voip-sidebar-collapsed';

export function LayoutShell({ children }: LayoutShellProps) {
  const [location] = useLocation();
  const search = useSearch();
  const { user, logout, role, isAdmin, isManagement } = useAuth();

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(SIDEBAR_KEY) === 'true'; } catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem(SIDEBAR_KEY, String(collapsed)); } catch { /* ignore */ }
  }, [collapsed]);

  const isCallsActive      = location.startsWith('/calls');
  const isMonitoringActive = location.startsWith('/server-monitoring');
  const isBitseyeActive    = location.startsWith('/bitseye');
  const isCdrActive        = location.startsWith('/cdrs');
  const [callsExpanded,      setCallsExpanded]      = useState(isCallsActive);
  const [monitoringExpanded, setMonitoringExpanded] = useState(isMonitoringActive);
  const [bitseyeExpanded,    setBitseyeExpanded]    = useState(isBitseyeActive);
  const [cdrExpanded,        setCdrExpanded]        = useState(isCdrActive);

  useEffect(() => { if (isCallsActive)      setCallsExpanded(true);      }, [isCallsActive]);
  useEffect(() => { if (isMonitoringActive) setMonitoringExpanded(true);  }, [isMonitoringActive]);
  useEffect(() => { if (isBitseyeActive)    setBitseyeExpanded(true);     }, [isBitseyeActive]);
  useEffect(() => { if (isCdrActive)        setCdrExpanded(true);         }, [isCdrActive]);

  const { data: kamList = [] } = useQuery<Kam[]>({
    queryKey: ['/api/kam'],
    enabled: (role === 'admin' || role === 'management') && bitseyeExpanded,
    staleTime: 120_000,
  });

  // For viewers: fetch their own KAM to show only their entry in BitsEye submenu
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

  const allNavItems = [
    { href: "/",                  label: "Dashboard",        icon: LayoutDashboard, roles: ['admin','management','viewer'] as Role[] },
    { href: "/calls",             label: "Live Calls",        icon: Phone,           roles: ['admin','management','viewer'] as Role[], hasSubmenu: 'calls' as const },
    { href: "/clients",           label: "Client / Vendor",   icon: Building2,       roles: ['admin','management']          as Role[] },
    { href: "/balance",           label: "Balance Monitor",   icon: Wallet,          roles: ['admin','management']          as Role[] },
    { href: "/dids",              label: "DID Management",    icon: PhoneIncoming,   roles: ['admin','management']          as Role[] },
    { href: "/traffic-map",       label: "Traffic Map",       icon: Globe,           roles: ['admin','management']          as Role[] },
    { href: "/graphs",            label: "Graphs",            icon: LineChart,       roles: ['admin','management']          as Role[] },
    { href: "/bitseye",           label: "BitsEye",           icon: Eye,             roles: ['admin','management']          as Role[], hasSubmenu: 'bitseye' as const },
    { href: "/reports",           label: "Reports",           icon: BarChart2,       roles: ['admin','management']          as Role[] },
    { href: "/cdrs",              label: "CDR Viewer",        icon: FileText,        roles: ['admin','management']          as Role[], hasSubmenu: 'cdr' as const },
    { href: "/fraud",             label: "Fraud / FAS",       icon: ShieldAlert,     roles: ['admin','management']          as Role[] },
    { href: "/server-monitoring", label: "Server Monitoring", icon: Server,          roles: ['admin','management']          as Role[], hasSubmenu: 'monitoring' as const },
    { href: "/tools",             label: "Tools",             icon: Wrench,          roles: ['admin','management']          as Role[] },
    { href: "/settings",          label: "Settings",          icon: Settings,        roles: ['admin']                       as Role[] },
    { href: "/alerts",            label: "Alerts",            icon: Bell,            roles: ['admin','management']          as Role[] },
    { href: "/account",           label: "My Account",        icon: UserCog,         roles: ['admin','management','viewer'] as Role[] },
    { href: "/team",              label: "Team & KAM",        icon: Users,           roles: ['admin']                       as Role[] },
  ];

  const VIEWER_ALWAYS_SHOW = new Set(['/', '/account']);
  const navItems = (() => {
    if (role !== 'viewer') return allNavItems.filter(item => item.roles.includes(role));
    const unlockedHrefs = new Set([
      ...VIEWER_ALWAYS_SHOW,
      ...[...assignedItemSet].map(id => ITEM_NAV_MAP[id]).filter(Boolean),
    ]);
    return allNavItems.filter(item => unlockedHrefs.has(item.href));
  })();

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
                <h1 className="font-bold text-base tracking-tight leading-tight">VoIP Monitor</h1>
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
        <nav className={cn("flex-1 overflow-y-auto space-y-0.5 py-3", collapsed ? "px-2" : "px-3")}>
          {navItems.map((item) => {
            const isActive = item.href === '/'
              ? location === '/'
              : location.startsWith(item.href);

            /* ── Calls submenu ── */
            if (item.hasSubmenu === 'calls') {
              if (role === 'viewer' && visibleCallsSubitems.length === 0) return null;
              if (collapsed) {
                return (
                  <Link key={item.href} href={item.href} title={item.label}
                    className={navItemClass(isActive)}>
                    <item.icon className={navIconClass(isActive)} />
                  </Link>
                );
              }
              return (
                <div key={item.href}>
                  <button
                    onClick={() => setCallsExpanded(o => !o)}
                    className={navItemClass(isActive)}
                  >
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
                          <Link key={sub.view} href={`/calls?view=${sub.view}`}
                            className={cn("flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-150",
                              subActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/40")}>
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

              if (collapsed) {
                return (
                  <Link key={item.href} href={item.href} title={item.label}
                    className={navItemClass(isBitseyeActive)}>
                    <item.icon className={navIconClass(isBitseyeActive)} />
                  </Link>
                );
              }
              return (
                <div key={item.href}>
                  <button
                    onClick={() => setBitseyeExpanded(o => !o)}
                    className={navItemClass(isBitseyeActive)}
                  >
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
                          <Link key={sub.view} href={`/bitseye?view=${sub.view}`}
                            className={cn("flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-150",
                              subActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/40")}>
                            <BarChart3 className={cn("h-3.5 w-3.5 flex-shrink-0", subActive ? "text-primary" : sub.iconColor)} />
                            {sub.label}
                          </Link>
                        );
                      })}
                      {/* KAM section — admin/management see all; viewer sees only their own */}
                      <div className="flex items-center gap-2 pt-1 pb-0.5 px-2">
                        <ContactRound className="h-3 w-3 text-violet-400/60 flex-shrink-0" />
                        <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/35">KAM</span>
                      </div>
                      {role === 'viewer' ? (
                        /* Viewer: show only their own KAM entry */
                        viewerKamData?.kamId ? (() => {
                          const myKamActive = isBitseyeActive && bsView === 'kam' && bsKamId === String(viewerKamData.kamId);
                          return (
                            <Link href={`/bitseye?view=kam&kamId=${viewerKamData.kamId}`}
                              className={cn("flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150",
                                myKamActive ? "bg-violet-500/10 text-violet-300" : "text-muted-foreground/70 hover:text-foreground hover:bg-muted/40")}>
                              <ContactRound className={cn("h-3.5 w-3.5 flex-shrink-0", myKamActive ? "text-violet-300" : "text-violet-400/70")} />
                              <span className="flex-1 truncate">{viewerKamData.kamName ?? 'My Portfolio'}</span>
                            </Link>
                          );
                        })() : (
                          <p className="text-[10px] text-muted-foreground/30 px-3 py-1">No KAM assigned</p>
                        )
                      ) : (
                        /* Admin / Management: show All KAMs + individual list */
                        <>
                          {(() => {
                            const allKamActive = isBitseyeActive && bsView === 'kam' && !bsKamId;
                            return (
                              <Link href="/bitseye?view=kam"
                                className={cn("flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-150",
                                  allKamActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/40")}>
                                <ContactRound className={cn("h-3.5 w-3.5 flex-shrink-0", allKamActive ? "text-primary" : "text-violet-400/70")} />
                                All KAMs
                              </Link>
                            );
                          })()}
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
              if (collapsed) {
                return (
                  <Link key={item.href} href={item.href} title={item.label}
                    className={navItemClass(isCdrActive)}>
                    <item.icon className={navIconClass(isCdrActive)} />
                  </Link>
                );
              }
              return (
                <div key={item.href}>
                  <button
                    onClick={() => setCdrExpanded(o => !o)}
                    className={navItemClass(isCdrActive)}
                  >
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
                          <Link key={sub.view} href={`/cdrs?view=${sub.view}`}
                            className={cn("flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-150",
                              subActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/40")}>
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
              if (collapsed) {
                return (
                  <Link key={item.href} href={item.href} title={item.label}
                    className={navItemClass(isActive)}>
                    <item.icon className={navIconClass(isActive)} />
                  </Link>
                );
              }
              return (
                <div key={item.href}>
                  <button
                    onClick={() => setMonitoringExpanded(o => !o)}
                    className={navItemClass(isActive)}
                  >
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
                          <Link key={sub.tab} href={`/server-monitoring?tab=${sub.tab}`}
                            className={cn("flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-150",
                              subActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/40")}>
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
              <Link key={item.href} href={item.href} title={collapsed ? item.label : undefined}
                className={navItemClass(isActive)}>
                <item.icon className={navIconClass(isActive)} />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>

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
                  onClick={() => logout()}
                  title="Sign Out"
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3 px-2 py-2">
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
            )
          )}
        </div>
      </aside>

      {/* ── Mobile top bar (unchanged) ── */}
      <div className="md:hidden flex flex-col flex-1 min-h-0">
        <header className="h-14 border-b border-border/50 flex items-center px-6 bg-background/50 backdrop-blur-sm sticky top-0 z-40">
          <Activity className="h-5 w-5 text-primary mr-2" />
          <span className="font-bold">VoIP Monitor</span>
        </header>
        <main className="flex-1 overflow-y-auto p-4 relative scroll-smooth">
          <div className="max-w-7xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
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

    </div>
  );
}
