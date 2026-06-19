import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import type { WorkspaceWithTabs, WorkspaceTab } from "@shared/schema";
import {
  Receipt, TrendingUp, Scale, Monitor, BarChart2,
  FileText, CreditCard, RefreshCw, Brain, Settings,
  Network, ShieldAlert, Building2, Users, Activity,
  Layers, BookOpen, AlertTriangle, ChevronRight,
} from "lucide-react";

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Receipt, TrendingUp, Scale, Monitor, BarChart2,
  FileText, CreditCard, RefreshCw, Brain, Settings,
  Network, ShieldAlert, Building2, Users, Activity,
  Layers, BookOpen, AlertTriangle, ChevronRight,
};

function WorkspaceIcon({ name, className }: { name?: string | null; className?: string }) {
  const Icon = name ? (ICON_MAP[name] ?? Layers) : Layers;
  return <Icon className={cn("h-3.5 w-3.5", className)} />;
}

interface WorkspaceShellProps {
  workspaceSlug: string;
  children: React.ReactNode;
}

export function WorkspaceShell({ workspaceSlug, children }: WorkspaceShellProps) {
  const [location, navigate] = useLocation();

  const { data: workspace } = useQuery<WorkspaceWithTabs>({
    queryKey: ["/api/workspaces", workspaceSlug],
    staleTime: 5 * 60 * 1000,
  });

  if (!workspace) {
    return <>{children}</>;
  }

  const visibleTabs = workspace.tabs.filter(t => t.isVisible);

  const activeTab = visibleTabs.find(tab =>
    tab.items.some(item =>
      !item.isHidden &&
      (location === item.route || location.startsWith(item.route + "/"))
    )
  );

  function navigateToTab(tab: WorkspaceTab & { items: any[] }) {
    const first = tab.items.find(i => !i.isContextual && !i.isHidden);
    if (first) navigate(first.route);
  }

  return (
    <div className="h-full flex flex-col">
      <div
        data-testid={`workspace-tabbar-${workspaceSlug}`}
        className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur-sm flex-shrink-0"
      >
        <div className="flex items-center gap-0 px-4 h-11">
          <div className="flex items-center gap-1.5 mr-4 pr-4 border-r border-border/50 text-xs font-medium text-muted-foreground shrink-0">
            <WorkspaceIcon name={workspace.icon} className="text-primary/70" />
            <span className="hidden sm:inline">{workspace.label}</span>
          </div>
          <div className="flex items-center gap-0.5 overflow-x-auto scrollbar-none flex-1">
            {visibleTabs.map(tab => {
              const isActive = activeTab?.id === tab.id;
              return (
                <button
                  key={tab.id}
                  data-testid={`workspace-tab-${tab.slug}`}
                  onClick={() => navigateToTab(tab as any)}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                  )}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        {children}
      </div>
    </div>
  );
}
