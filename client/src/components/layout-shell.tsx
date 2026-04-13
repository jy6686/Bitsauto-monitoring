import { Link, useLocation, useSearch } from "wouter";
import { LayoutDashboard, Phone, Bell, Settings, Activity, BarChart2, Users, Building2, UserCog, ShieldAlert, FileText, Wrench, Globe, Wallet, PhoneIncoming, ChevronDown, BarChart3, List, HeartPulse, History, Server, Wifi, TrendingDown, HardDrive, Radio, LineChart } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useState, useEffect } from "react";
import type { Role } from "@shared/schema";

interface LayoutShellProps {
  children: React.ReactNode;
}

const ROLE_BADGE: Record<Role, { label: string; color: string }> = {
  admin:      { label: "Admin",      color: "text-rose-400 bg-rose-500/10"   },
  management: { label: "Management", color: "text-amber-400 bg-amber-500/10" },
  viewer:     { label: "Viewer",     color: "text-blue-400 bg-blue-500/10"   },
};

const CALLS_SUBITEMS = [
  { view: 'summary', label: 'Active Call Summary', icon: BarChart3,  iconColor: 'text-violet-400' },
  { view: 'details', label: 'Active Call Details',  icon: List,       iconColor: 'text-cyan-400'   },
  { view: 'quality', label: 'Quality Monitoring',   icon: HeartPulse, iconColor: 'text-rose-400'   },
  { view: 'history', label: 'Call History',         icon: History,    iconColor: 'text-amber-400'  },
] as const;

const MONITORING_SUBITEMS = [
  { tab: 'reachability',  label: 'Reachability / Outage', icon: Wifi,        iconColor: 'text-emerald-400' },
  { tab: 'bandwidth',     label: 'Bandwidth (RTP)',        icon: Activity,    iconColor: 'text-cyan-400'    },
  { tab: 'disk-memory',   label: 'Disk & Memory',         icon: HardDrive,   iconColor: 'text-amber-400'   },
  { tab: 'carrier-asr',   label: 'Carrier ASR Alerts',    icon: TrendingDown,iconColor: 'text-violet-400'  },
  { tab: 'alert-rules',   label: 'Email / Webhook Alerts',icon: Bell,        iconColor: 'text-blue-400'    },
  { tab: 'registrations', label: 'Reg Storm Detection',   icon: Radio,       iconColor: 'text-rose-400'    },
] as const;

export function LayoutShell({ children }: LayoutShellProps) {
  const [location] = useLocation();
  const search = useSearch();
  const { user, logout, role, isAdmin, isManagement } = useAuth();

  const isCallsActive      = location.startsWith('/calls');
  const isMonitoringActive = location.startsWith('/server-monitoring');
  const [callsExpanded,      setCallsExpanded]      = useState(isCallsActive);
  const [monitoringExpanded, setMonitoringExpanded] = useState(isMonitoringActive);

  useEffect(() => {
    if (isCallsActive) setCallsExpanded(true);
  }, [isCallsActive]);

  useEffect(() => {
    if (isMonitoringActive) setMonitoringExpanded(true);
  }, [isMonitoringActive]);

  const allNavItems = [
    { href: "/",                  label: "Dashboard",        icon: LayoutDashboard, roles: ['admin','management','viewer'] },
    { href: "/calls",             label: "Live Calls",        icon: Phone,           roles: ['admin','management','viewer'], hasSubmenu: 'calls' as const },
    { href: "/clients",           label: "Client / Vendor",   icon: Building2,       roles: ['admin','management']          },
    { href: "/balance",           label: "Balance Monitor",   icon: Wallet,          roles: ['admin','management']          },
    { href: "/dids",              label: "DID Management",    icon: PhoneIncoming,   roles: ['admin','management']          },
    { href: "/traffic-map",       label: "Traffic Map",       icon: Globe,           roles: ['admin','management']          },
    { href: "/graphs",            label: "Graphs",            icon: LineChart,       roles: ['admin','management']          },
    { href: "/reports",           label: "Reports",           icon: BarChart2,       roles: ['admin','management']          },
    { href: "/cdrs",              label: "CDR Viewer",        icon: FileText,        roles: ['admin','management']          },
    { href: "/fraud",             label: "Fraud / FAS",       icon: ShieldAlert,     roles: ['admin','management']          },
    { href: "/server-monitoring", label: "Server Monitoring", icon: Server,          roles: ['admin','management'], hasSubmenu: 'monitoring' as const },
    { href: "/tools",             label: "Tools",             icon: Wrench,          roles: ['admin','management']          },
    { href: "/settings",          label: "Settings",          icon: Settings,        roles: ['admin']                       },
    { href: "/alerts",            label: "Alerts",            icon: Bell,            roles: ['admin','management']          },
    { href: "/account",           label: "My Account",        icon: UserCog,         roles: ['admin','management','viewer'] },
    { href: "/team",              label: "Team & KAM",        icon: Users,           roles: ['admin']                       },
  ];

  const navItems = allNavItems.filter(item => item.roles.includes(role));
  const badge = ROLE_BADGE[role];

  const currentView = isCallsActive
    ? (new URLSearchParams(search).get('view') ?? 'summary')
    : null;

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">
      {/* Sidebar Navigation */}
      <aside className="w-full md:w-64 border-r border-border bg-card/50 backdrop-blur-xl flex-shrink-0 z-50">
        <div className="p-6 border-b border-border/50">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600/20 p-2 rounded-lg">
              <Activity className="h-6 w-6 text-blue-500" />
            </div>
            <div>
              <h1 className="font-bold text-lg tracking-tight">VoIP Monitor</h1>
              <p className="text-xs text-muted-foreground font-mono">v2.5.0-stable</p>
            </div>
          </div>
        </div>

        <nav className="p-4 space-y-1">
          {navItems.map((item) => {
            const isActive = item.href === '/'
              ? location === '/'
              : location.startsWith(item.href);

            if (item.hasSubmenu === 'calls') {
              return (
                <div key={item.href}>
                  <button
                    onClick={() => setCallsExpanded(o => !o)}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all duration-200 group",
                      isActive ? "bg-primary text-primary-foreground shadow-md shadow-primary/10" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    )}
                  >
                    <item.icon className={cn("h-4 w-4 transition-colors flex-shrink-0", isActive ? "text-primary-foreground" : "text-muted-foreground group-hover:text-foreground")} />
                    <span className="flex-1 text-left">{item.label}</span>
                    <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-200 flex-shrink-0", callsExpanded ? "rotate-180" : "", isActive ? "text-primary-foreground/70" : "text-muted-foreground/50")} />
                  </button>
                  {callsExpanded && (
                    <div className="mt-1 ml-4 pl-3 border-l border-border/40 space-y-0.5">
                      {CALLS_SUBITEMS.map(sub => {
                        const subActive = isActive && currentView === sub.view;
                        return (
                          <Link key={sub.view} href={`/calls?view=${sub.view}`} className={cn("flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-150", subActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/40")}>
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

            if (item.hasSubmenu === 'monitoring') {
              const currentMonTab = isMonitoringActive
                ? (new URLSearchParams(search).get('tab') ?? 'reachability')
                : null;
              return (
                <div key={item.href}>
                  <button
                    onClick={() => setMonitoringExpanded(o => !o)}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all duration-200 group",
                      isActive ? "bg-primary text-primary-foreground shadow-md shadow-primary/10" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    )}
                  >
                    <item.icon className={cn("h-4 w-4 transition-colors flex-shrink-0", isActive ? "text-primary-foreground" : "text-muted-foreground group-hover:text-foreground")} />
                    <span className="flex-1 text-left">{item.label}</span>
                    <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-200 flex-shrink-0", monitoringExpanded ? "rotate-180" : "", isActive ? "text-primary-foreground/70" : "text-muted-foreground/50")} />
                  </button>
                  {monitoringExpanded && (
                    <div className="mt-1 ml-4 pl-3 border-l border-border/40 space-y-0.5">
                      {MONITORING_SUBITEMS.map(sub => {
                        const subActive = isMonitoringActive && currentMonTab === sub.tab;
                        return (
                          <Link key={sub.tab} href={`/server-monitoring?tab=${sub.tab}`} className={cn("flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-150", subActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/40")}>
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

            return (
              <Link key={item.href} href={item.href} className={cn(
                "flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all duration-200 group",
                isActive
                  ? "bg-primary text-primary-foreground shadow-md shadow-primary/10"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}>
                <item.icon className={cn(
                  "h-4 w-4 transition-colors",
                  isActive ? "text-primary-foreground" : "text-muted-foreground group-hover:text-foreground"
                )} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 mt-auto border-t border-border/50">
          {user && (
            <div className="flex items-center gap-3 px-4 py-3">
              <div className="h-8 w-8 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-500 font-bold text-xs flex-shrink-0">
                {user.firstName?.[0] || user.email?.[0]?.toUpperCase() || "U"}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{user.firstName || user.email}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={cn("text-xs font-medium px-1.5 py-0.5 rounded-full", badge.color)}>
                    {badge.label}
                  </span>
                </div>
                <button
                  onClick={() => logout()}
                  className="text-xs text-muted-foreground hover:text-red-400 transition-colors mt-0.5"
                >
                  Sign Out
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <header className="h-14 border-b border-border/50 flex items-center px-6 bg-background/50 backdrop-blur-sm sticky top-0 z-40 md:hidden">
          <Activity className="h-5 w-5 text-primary mr-2" />
          <span className="font-bold">VoIP Monitor</span>
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-8 relative scroll-smooth">
          <div className="max-w-7xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
