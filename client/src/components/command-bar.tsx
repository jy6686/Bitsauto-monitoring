import { useEffect, useState, useCallback } from "react";
import { useLocation } from "wouter";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  LayoutDashboard, Phone, Bell, Settings, BarChart2, Users, Building2,
  ShieldAlert, FileText, Wrench, Globe, Wallet, PhoneIncoming, Server,
  Eye, CreditCard, TrendingUp, LineChart, Search, Key, UserCog, MessageSquare,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

const NAV_ITEMS = [
  { href: "/",                  label: "Dashboard",           icon: LayoutDashboard, roles: ['admin','management','viewer'] },
  { href: "/calls",             label: "Live Calls",           icon: Phone,           roles: ['admin','management','viewer'] },
  { href: "/clients",           label: "Client / Vendor",      icon: Building2,       roles: ['admin','management'] },
  { href: "/balance",           label: "Balance Monitor",      icon: Wallet,          roles: ['admin','management'] },
  { href: "/dids",              label: "DID Management",       icon: PhoneIncoming,   roles: ['admin','management'] },
  { href: "/traffic-map",       label: "Traffic Map",          icon: Globe,           roles: ['admin','management'] },
  { href: "/graphs",            label: "Graphs",               icon: LineChart,       roles: ['admin','management'] },
  { href: "/bitseye",           label: "BitsEye",              icon: Eye,             roles: ['admin','management'] },
  { href: "/reports",           label: "Reports",              icon: BarChart2,       roles: ['admin','management'] },
  { href: "/cdrs",              label: "CDR Viewer",           icon: FileText,        roles: ['admin','management'] },
  { href: "/fraud",             label: "Fraud / FAS",          icon: ShieldAlert,     roles: ['admin','management'] },
  { href: "/rate-cards",        label: "Rate Cards",           icon: CreditCard,      roles: ['admin','management'] },
  { href: "/analytics",         label: "Revenue Analytics",    icon: TrendingUp,      roles: ['admin','management'] },
  { href: "/server-monitoring", label: "Server Monitoring",    icon: Server,          roles: ['admin','management'] },
  { href: "/tools",             label: "Tools & Calculators",  icon: Wrench,          roles: ['admin','management'] },
  { href: "/settings",          label: "Settings",             icon: Settings,        roles: ['admin'] },
  { href: "/alerts",            label: "Alerts",               icon: Bell,            roles: ['admin','management'] },
  { href: "/account",           label: "My Account",           icon: UserCog,         roles: ['admin','management','viewer'] },
  { href: "/team",              label: "Team & KAM",           icon: Users,           roles: ['admin'] },
  { href: "/api-keys",          label: "API Key Management",   icon: Key,             roles: ['admin'] },
  { href: "/whatsapp-alerts",   label: "WhatsApp Alerts",      icon: MessageSquare,   roles: ['admin'] },
] as const;

export function CommandBar() {
  const [open, setOpen] = useState(false);
  const [, setLocation] = useLocation();
  const { role } = useAuth();

  const toggle = useCallback(() => setOpen(o => !o), []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        toggle();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [toggle]);

  const navigate = (href: string) => {
    setOpen(false);
    setLocation(href);
  };

  const accessibleItems = NAV_ITEMS.filter(item =>
    (item.roles as readonly string[]).includes(role)
  );

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder="Search pages, actions…"
        data-testid="command-bar-input"
      />
      <CommandList>
        <CommandEmpty>
          <div className="flex flex-col items-center gap-2 py-4">
            <Search className="w-6 h-6 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No results found.</p>
          </div>
        </CommandEmpty>

        <CommandGroup heading="Navigation">
          {accessibleItems.map(item => (
            <CommandItem
              key={item.href}
              value={item.label}
              onSelect={() => navigate(item.href)}
              data-testid={`cmd-nav-${item.href.replace('/', '').replace('-', '_') || 'dashboard'}`}
            >
              <item.icon className="mr-2 h-4 w-4 text-muted-foreground" />
              {item.label}
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Quick Actions">
          <CommandItem
            value="search cdrs cdr viewer records"
            onSelect={() => navigate("/cdrs")}
          >
            <Search className="mr-2 h-4 w-4 text-muted-foreground" />
            Search CDRs
          </CommandItem>
          <CommandItem
            value="dial code lookup tools calculator"
            onSelect={() => navigate("/tools")}
          >
            <Wrench className="mr-2 h-4 w-4 text-muted-foreground" />
            Dial-Code Lookup / Tools
          </CommandItem>
          <CommandItem
            value="vendor balance account balance"
            onSelect={() => navigate("/balance")}
          >
            <Wallet className="mr-2 h-4 w-4 text-muted-foreground" />
            View Account Balances
          </CommandItem>
          <CommandItem
            value="generate api key integration external"
            onSelect={() => navigate("/api-keys")}
          >
            <Key className="mr-2 h-4 w-4 text-muted-foreground" />
            Manage API Keys
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
