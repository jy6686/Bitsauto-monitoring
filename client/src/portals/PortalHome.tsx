/**
 * PortalHome — the /:portal landing, rendered entirely from the Portal Configuration
 * Service (Model A). No portal-specific code: the same component renders NOC,
 * Commercial, Finance, and Admin — only the data differs. Every link stays inside the
 * portal namespace (/:portal/:moduleKey), so navigation never falls back to the main
 * platform.
 *
 * If the portal defines an isHome module, we redirect straight to it rather than
 * showing the module directory. This ensures /noc → /noc/noc-dashboard.
 */
import { Link, useLocation } from "wouter";
import { useEffect } from "react";
import { usePortal } from "@/context/portal-context";
import { usePortalConfig } from "@/portals/services/portal-config-service";
import {
  Circle, Phone, Activity, Map, Monitor, Terminal, LayoutGrid, Zap, ArrowRight,
} from "lucide-react";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  phone: Phone, activity: Activity, "trending-up": Activity, map: Map,
  monitor: Monitor, "layout-dashboard": Monitor, terminal: Terminal,
  "square-terminal": Terminal, "layout-grid": LayoutGrid, zap: Zap,
};
const icon = (k?: string) => ICONS[k ?? ""] ?? Circle;

export default function PortalHome() {
  const { activePortal } = usePortal();
  const vm = usePortalConfig(activePortal);
  const [location, navigate] = useLocation();

  // If this portal has a designated home module (isHome=true), redirect straight to it.
  // Ensures /noc → /noc/noc-dashboard instead of the module directory.
  useEffect(() => {
    if (!vm.isLoading && vm.home && location !== vm.home.href) {
      navigate(vm.home.href);
    }
  }, [vm.isLoading, vm.home?.href, location, navigate]);

  // Show spinner while loading or while redirect is about to fire.
  if (vm.isLoading || vm.home) {
    return <div className="p-8 text-sm text-muted-foreground">Loading portal…</div>;
  }

  return (
    <div className="p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{vm.name}</h1>
        <p className="text-sm text-muted-foreground">
          {vm.navigation.length} modules · portal home
        </p>
      </div>

      {vm.quickActions.length > 0 && (
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            Quick Actions
          </h2>
          <div className="flex flex-wrap gap-2">
            {vm.quickActions.map(m => {
              const I = icon(m.icon);
              return (
                <Link key={m.moduleKey} href={m.href}>
                  <button className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-accent transition-colors">
                    <I className="w-4 h-4" /> {m.label}
                  </button>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {vm.sections.map(section => (
        <div key={section.key}>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            {section.title}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {section.modules.map(m => {
              const I = icon(m.icon);
              return (
                <Link key={m.moduleKey} href={m.href}>
                  <div className="group flex items-center justify-between rounded-xl border border-border bg-card p-4 hover:border-primary/40 hover:bg-accent/40 transition-colors cursor-pointer">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <I className="w-4 h-4" />
                      </div>
                      <span className="font-medium">{m.label}</span>
                    </div>
                    <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      ))}

      {vm.navigation.length === 0 && (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No modules assigned to this portal yet. Assign modules in the Portal Assignment Manager.
        </div>
      )}
    </div>
  );
}
