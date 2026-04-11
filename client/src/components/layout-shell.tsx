import { Link, useLocation } from "wouter";
import { LayoutDashboard, Phone, Bell, Settings, Activity, BarChart2, Users, Building2, UserCog, ShieldAlert, FileText, Wrench, Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import type { Role } from "@shared/schema";

interface LayoutShellProps {
  children: React.ReactNode;
}

const ROLE_BADGE: Record<Role, { label: string; color: string }> = {
  admin:      { label: "Admin",      color: "text-rose-400 bg-rose-500/10"   },
  management: { label: "Management", color: "text-amber-400 bg-amber-500/10" },
  viewer:     { label: "Viewer",     color: "text-blue-400 bg-blue-500/10"   },
};

export function LayoutShell({ children }: LayoutShellProps) {
  const [location] = useLocation();
  const { user, logout, role, isAdmin, isManagement } = useAuth();

  const allNavItems = [
    { href: "/",          label: "Dashboard",      icon: LayoutDashboard, roles: ['admin','management','viewer'] },
    { href: "/calls",     label: "Live Calls",     icon: Phone,           roles: ['admin','management','viewer'] },
    { href: "/clients",   label: "Client / Vendor",icon: Building2,       roles: ['admin','management']          },
    { href: "/traffic-map", label: "Traffic Map",  icon: Globe,           roles: ['admin','management']          },
    { href: "/reports",   label: "Reports",        icon: BarChart2,       roles: ['admin','management']          },
    { href: "/cdrs",      label: "CDR Viewer",     icon: FileText,        roles: ['admin','management']          },
    { href: "/fraud",     label: "Fraud / FAS",    icon: ShieldAlert,     roles: ['admin','management']          },
    { href: "/tools",     label: "Tools",          icon: Wrench,          roles: ['admin','management']          },
    { href: "/settings",  label: "Settings",       icon: Settings,        roles: ['admin']                       },
    { href: "/alerts",    label: "Alerts",         icon: Bell,            roles: ['admin','management']          },
    { href: "/account",   label: "My Account",     icon: UserCog,         roles: ['admin','management','viewer'] },
    { href: "/team",      label: "Team",           icon: Users,           roles: ['admin']                       },
  ];

  const navItems = allNavItems.filter(item => item.roles.includes(role));
  const badge = ROLE_BADGE[role];

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
            const isActive = location === item.href;
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
