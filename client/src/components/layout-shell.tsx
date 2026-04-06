import { Link, useLocation } from "wouter";
import { LayoutDashboard, Phone, Bell, Settings, Activity, BarChart2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";

interface LayoutShellProps {
  children: React.ReactNode;
}

export function LayoutShell({ children }: LayoutShellProps) {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  const navItems = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/calls", label: "Active Calls", icon: Phone },
    { href: "/alerts", label: "Alerts", icon: Bell },
    { href: "/reports", label: "ASR/ACD Reports", icon: BarChart2 },
    { href: "/settings", label: "Settings", icon: Settings },
  ];

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
              <p className="text-xs text-muted-foreground font-mono">v2.4.0-stable</p>
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
              <div className="h-8 w-8 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-500 font-bold text-xs">
                 {user.firstName?.[0] || user.username?.[0] || "U"}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{user.firstName || user.username}</p>
                <button 
                  onClick={() => logout()}
                  className="text-xs text-muted-foreground hover:text-red-400 transition-colors"
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
        {/* Top Header - Mobile only mainly, or for breadcrumbs */}
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
