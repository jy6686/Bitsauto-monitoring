import { useEffect, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { usePortal } from "@/context/portal-context";
import { cn } from "@/lib/utils";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput,
  CommandItem, CommandList, CommandSeparator,
} from "@/components/ui/command";
import {
  LayoutDashboard, Activity, Users, GitBranch, BarChart2,
  Wrench, ShieldAlert, Settings, Layers, Banknote, Brain,
  Star, FileText, Phone, Radio, Eye, Wallet, History,
  ArrowRight, TrendingDown, Monitor, Search, Zap,
} from "lucide-react";
import type { PortalDefinition, NavigationModule, UserFavorite } from "@shared/schema";

// ── Static page index (drawn from DOMAINS) ────────────────────────────────────
const PAGES: { label: string; route: string; group: string; icon: React.ComponentType<{ className?: string }> }[] = [
  // Live Network
  { label: "BitsEye 2",          route: "/bitseye2",                  group: "Live Network",    icon: Eye },
  { label: "Live Traffic",       route: "/live-traffic",              group: "Live Network",    icon: Activity },
  { label: "Live Calls",         route: "/calls",                     group: "Live Network",    icon: Phone },
  { label: "Alerts",             route: "/alerts",                    group: "Live Network",    icon: Zap },
  { label: "NOC Command",        route: "/noc-command",               group: "Live Network",    icon: Monitor },
  { label: "Graphs",             route: "/graphs",                    group: "Live Network",    icon: BarChart2 },
  { label: "Multi-Switch",       route: "/multi-switch",              group: "Live Network",    icon: Layers },
  // Company
  { label: "Accounts",           route: "/clients",                   group: "Company",         icon: Users },
  { label: "Company List",       route: "/company/list",              group: "Company",         icon: Users },
  { label: "DID Management",     route: "/dids",                      group: "Company",         icon: Phone },
  // Operations
  { label: "Vendor List",        route: "/vendors",                   group: "Operations",      icon: Radio },
  { label: "Routing Manager",    route: "/routing-manager",           group: "Operations",      icon: GitBranch },
  { label: "LCR Analyser",       route: "/lcr-analyser",              group: "Operations",      icon: TrendingDown },
  { label: "Balance Monitor",    route: "/balance",                   group: "Operations",      icon: Wallet },
  { label: "Test Call",          route: "/test-call",                 group: "Operations",      icon: Phone },
  // Analytics
  { label: "Traffic Analytics",  route: "/analytics",                 group: "Analytics",       icon: Activity },
  { label: "ASR / ACD",          route: "/asr-acd",                   group: "Analytics",       icon: BarChart2 },
  { label: "CDR Viewer",         route: "/cdrs",                      group: "Analytics",       icon: History },
  { label: "Revenue Heatmap",    route: "/revenue-heatmap",           group: "Analytics",       icon: BarChart2 },
  { label: "Reports",            route: "/reports",                   group: "Analytics",       icon: FileText },
  // Intelligence
  { label: "AI Ops Center",      route: "/ai-ops",                    group: "Intelligence",    icon: Brain },
  { label: "Intelligence Hub",   route: "/intelligence",              group: "Intelligence",    icon: Brain },
  { label: "Route Optimisation", route: "/route-optimisation",        group: "Intelligence",    icon: GitBranch },
  { label: "Vendor RCA",         route: "/vendor-rca",                group: "Intelligence",    icon: Search },
  // Security
  { label: "Fraud Engine",       route: "/fraud",                     group: "Security",        icon: ShieldAlert },
  { label: "Firewall",           route: "/firewall",                  group: "Security",        icon: ShieldAlert },
  { label: "Approval Queue",     route: "/approvals",                 group: "Security",        icon: FileText },
  { label: "Audit Log",          route: "/audit-log",                 group: "Security",        icon: FileText },
  // Finance
  { label: "Billing",            route: "/billing",                   group: "Finance",         icon: Banknote },
  { label: "Disputes",           route: "/billing-disputes",          group: "Finance",         icon: FileText },
  { label: "Products",           route: "/products",                  group: "Finance",         icon: Layers },
  { label: "Rate Cards",         route: "/rate-cards",                group: "Finance",         icon: FileText },
  { label: "Cost Optimisation",  route: "/cost-optimisation",         group: "Finance",         icon: TrendingDown },
  // Platform
  { label: "Platform Settings",  route: "/settings",                  group: "Platform",        icon: Settings },
  { label: "Team & KAM",         route: "/team",                      group: "Platform",        icon: Users },
  { label: "Navigation Manager", route: "/navigation-manager",          group: "Platform",        icon: Layers },
  { label: "Nav Governance",     route: "/navigation-governance",     group: "Platform",        icon: Layers },
  { label: "My Account",         route: "/account",                   group: "Platform",        icon: Users },
];

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  "layout-dashboard": LayoutDashboard, "users": Users, "activity": Activity,
  "bar-chart-3": BarChart2, "file-text": FileText, "wallet": Wallet,
  "git-branch": GitBranch, "settings": Settings, "layers": Layers,
  "banknote": Banknote, "brain-circuit": Brain, "shield-alert": ShieldAlert,
};
function ModIcon({ k, className }: { k?: string | null; className?: string }) {
  const C = ICON_MAP[k ?? ""] ?? Activity;
  return <C className={className} />;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { activePortal } = usePortal();

  const { data: portals = [] } = useQuery<PortalDefinition[]>({
    queryKey: ["/api/portal/definitions"],
    staleTime: 60_000,
    enabled: !!user,
  });

  const { data: navModules = [] } = useQuery<NavigationModule[]>({
    queryKey: ["/api/governance/modules"],
    staleTime: 60_000,
    enabled: !!user,
  });

  const { data: favorites = [] } = useQuery<UserFavorite[]>({
    queryKey: ["/api/favorites"],
    staleTime: 30_000,
    enabled: !!user,
  });

  const { data: clients = [] } = useQuery<any[]>({
    queryKey: ["/api/clients"],
    staleTime: 120_000,
    enabled: !!user && open,
  });

  const go = useCallback((route: string) => {
    navigate(route);
    onClose();
  }, [navigate, onClose]);

  return (
    <CommandDialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <CommandInput placeholder="Search anything — modules, clients, portals, pages..." data-testid="command-palette-input" />
      <CommandList className="max-h-[420px]">
        <CommandEmpty>
          <div className="flex flex-col items-center py-6 gap-2 text-muted-foreground">
            <Search className="h-8 w-8 opacity-20" />
            <p className="text-sm">No results found</p>
          </div>
        </CommandEmpty>

        {/* Favorites */}
        {favorites.length > 0 && (
          <CommandGroup heading="Pinned">
            {favorites.map(fav => (
              <CommandItem
                key={`fav-${fav.moduleKey}`}
                value={`pinned ${fav.label ?? fav.moduleKey}`}
                onSelect={() => go(fav.route)}
                data-testid={`cmd-fav-${fav.moduleKey}`}
              >
                <Star className="h-3.5 w-3.5 text-amber-400 flex-shrink-0" />
                <span>{fav.label ?? fav.moduleKey}</span>
                <span className="ml-auto text-[10px] text-muted-foreground/40 flex items-center gap-1">
                  {fav.route} <ArrowRight className="h-2.5 w-2.5" />
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* Portals */}
        <CommandGroup heading="Portals">
          {portals.filter(p => p.isActive).map(portal => (
            <CommandItem
              key={`portal-${portal.slug}`}
              value={`portal ${portal.name} ${portal.slug}`}
              onSelect={() => go(portal.defaultRoute)}
              data-testid={`cmd-portal-${portal.slug}`}
            >
              <Layers className="h-3.5 w-3.5 text-indigo-400 flex-shrink-0" />
              <span>{portal.name}</span>
              <span className="ml-auto text-[10px] text-muted-foreground/40">{portal.slug}</span>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        {/* Pages — grouped */}
        {Array.from(new Set(PAGES.map(p => p.group))).map(group => (
          <CommandGroup key={group} heading={group}>
            {PAGES.filter(p => p.group === group).map(page => (
              <CommandItem
                key={`page-${page.route}`}
                value={`page ${page.label} ${group}`}
                onSelect={() => go(page.route)}
                data-testid={`cmd-page-${page.route.replace(/\//g, "-")}`}
              >
                <page.icon className="h-3.5 w-3.5 text-muted-foreground/60 flex-shrink-0" />
                <span>{page.label}</span>
                <span className="ml-auto text-[10px] text-muted-foreground/30 flex items-center gap-1">
                  {page.route} <ArrowRight className="h-2.5 w-2.5" />
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}

        <CommandSeparator />

        {/* Navigation Modules from DB */}
        {navModules.length > 0 && (
          <CommandGroup heading="Module Registry">
            {navModules.map(mod => (
              <CommandItem
                key={`mod-${mod.id}`}
                value={`module ${mod.title} ${mod.moduleKey} ${mod.category}`}
                onSelect={() => go(mod.route)}
                data-testid={`cmd-module-${mod.moduleKey}`}
              >
                <ModIcon k={mod.icon} className="h-3.5 w-3.5 text-muted-foreground/60 flex-shrink-0" />
                <span>{mod.title}</span>
                <span className="ml-auto text-[10px] text-muted-foreground/30">{mod.category}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* Clients */}
        {clients.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Clients">
              {clients.slice(0, 20).map((client: any) => (
                <CommandItem
                  key={`client-${client.id}`}
                  value={`client ${client.name ?? client.companyName ?? ''} ${client.accountId ?? ''}`}
                  onSelect={() => go(`/clients`)}
                  data-testid={`cmd-client-${client.id}`}
                >
                  <Users className="h-3.5 w-3.5 text-muted-foreground/60 flex-shrink-0" />
                  <span>{client.name ?? client.companyName ?? `Client #${client.id}`}</span>
                  {client.accountId && (
                    <span className="ml-auto text-[10px] text-muted-foreground/30">{client.accountId}</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}

// Global keyboard handler hook
export function useCommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(v => !v);
      }
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  return { open, setOpen, close: () => setOpen(false) };
}
