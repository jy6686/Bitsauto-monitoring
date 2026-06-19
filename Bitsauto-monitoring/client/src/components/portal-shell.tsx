import { Link, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, FileText, Shield, ReceiptText, BarChart2, LogOut, ShieldCheck, Menu, X,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

interface PortalSession {
  clientName: string;
  companyDisplayName?: string;
  logoUrl?: string;
}

const NAV = [
  { href: "/portal/dashboard",       label: "Dashboard",       icon: LayoutDashboard },
  { href: "/portal/invoices",        label: "Invoices",        icon: FileText        },
  { href: "/portal/disputes",        label: "Disputes",        icon: Shield          },
  { href: "/portal/credit-notes",    label: "Credit Notes",    icon: ReceiptText     },
  { href: "/portal/reconciliation",  label: "Reconciliation",  icon: BarChart2       },
];

export default function PortalShell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const { data: session } = useQuery<PortalSession>({
    queryKey: ["/api/portal/auth/session"],
    queryFn: () => apiRequest("GET", "/api/portal/auth/session").then(r => r.json()),
    retry: false,
  });

  const logoutMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/portal/auth/logout", {}).then(r => r.json()),
    onSuccess: () => {
      queryClient.clear();
      window.location.href = "/portal/login";
    },
  });

  const companyName = session?.companyDisplayName ?? session?.clientName ?? "Partner Portal";

  const NavLinks = () => (
    <nav className="space-y-0.5">
      {NAV.map(item => {
        const active = location === item.href;
        const Icon = item.icon;
        return (
          <Link key={item.href} href={item.href}>
            <a
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                active
                  ? "bg-primary text-primary-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
              )}
              onClick={() => setMobileOpen(false)}
              data-testid={`nav-${item.label.toLowerCase().replace(/\s/g, "-")}`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {item.label}
            </a>
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen bg-background flex">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-56 border-r bg-card/50 shrink-0">
        <div className="p-4 border-b">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
              <ShieldCheck className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold truncate">{companyName}</p>
              <p className="text-[10px] text-muted-foreground">Partner Portal</p>
            </div>
          </div>
        </div>

        <div className="flex-1 p-3 overflow-y-auto">
          <NavLinks />
        </div>

        <div className="p-3 border-t">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-muted-foreground hover:text-foreground gap-2"
            onClick={() => logoutMutation.mutate()}
            data-testid="button-portal-logout"
          >
            <LogOut className="h-4 w-4" />Sign Out
          </Button>
        </div>
      </aside>

      {/* Mobile Header */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 h-14 border-b bg-background/95 backdrop-blur flex items-center px-4 gap-3">
        <button onClick={() => setMobileOpen(!mobileOpen)} className="text-muted-foreground">
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold truncate">{companyName}</span>
        </div>
      </div>

      {/* Mobile Sidebar Overlay */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-40 bg-background/80 backdrop-blur-sm" onClick={() => setMobileOpen(false)}>
          <aside className="absolute left-0 top-14 bottom-0 w-56 border-r bg-card p-3 space-y-1" onClick={e => e.stopPropagation()}>
            <NavLinks />
            <div className="pt-2 border-t">
              <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-muted-foreground"
                onClick={() => logoutMutation.mutate()}>
                <LogOut className="h-4 w-4" />Sign Out
              </Button>
            </div>
          </aside>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 min-w-0 md:p-0 pt-14 md:pt-0 overflow-auto">
        {children}
      </main>
    </div>
  );
}
