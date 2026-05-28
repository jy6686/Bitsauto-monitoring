import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Link } from "wouter";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ExternalLink, Settings2, Radio, Banknote, Users, Shield,
  Settings, Star, BarChart3, GitBranch, Monitor, ShieldAlert,
  LayoutDashboard, ChevronRight, AlertTriangle, Info,
  Eye, EyeOff, SlidersHorizontal, Layers,
} from "lucide-react";
import type { PortalDefinition } from "@shared/schema";

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  "users":         Users,
  "bar-chart-3":   BarChart3,
  "radio":         Radio,
  "banknote":      Banknote,
  "git-branch":    GitBranch,
  "settings":      Settings,
  "star":          Star,
  "shield-alert":  ShieldAlert,
  "layout-dashboard": LayoutDashboard,
  "monitor":       Monitor,
  "layers":        Layers,
};

function PortalIcon({ icon, className }: { icon: string; className?: string }) {
  const C = ICON_MAP[icon] ?? Settings2;
  return <C className={className} />;
}

const THEME_STYLES: Record<string, {
  dot: string; ring: string; label: string; accent: string; bg: string;
}> = {
  purple:  { dot: "bg-purple-400",  ring: "ring-purple-400/30",  label: "Purple",  accent: "text-purple-400",  bg: "bg-purple-500/8"  },
  blue:    { dot: "bg-blue-400",    ring: "ring-blue-400/30",    label: "Blue",    accent: "text-blue-400",    bg: "bg-blue-500/8"    },
  green:   { dot: "bg-emerald-400", ring: "ring-emerald-400/30", label: "Green",   accent: "text-emerald-400", bg: "bg-emerald-500/8" },
  indigo:  { dot: "bg-indigo-400",  ring: "ring-indigo-400/30",  label: "Indigo",  accent: "text-indigo-400",  bg: "bg-indigo-500/8"  },
  slate:   { dot: "bg-slate-400",   ring: "ring-slate-400/30",   label: "Slate",   accent: "text-slate-400",   bg: "bg-slate-500/8"   },
  neutral: { dot: "bg-violet-400",  ring: "ring-violet-400/30",  label: "Neutral", accent: "text-violet-400",  bg: "bg-violet-500/8"  },
};

const THEMES = Object.keys(THEME_STYLES);

function ThemePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {THEMES.map(t => {
        const s = THEME_STYLES[t] ?? THEME_STYLES.neutral;
        return (
          <button
            key={t}
            onClick={() => onChange(t)}
            title={s.label}
            data-testid={`theme-pick-${t}`}
            className={cn(
              "w-6 h-6 rounded-full ring-2 transition-all",
              s.dot,
              value === t ? s.ring + " ring-offset-2 ring-offset-background scale-110" : "ring-transparent opacity-50 hover:opacity-100"
            )}
          />
        );
      })}
    </div>
  );
}

function PortalCard({ portal, isSuper }: { portal: PortalDefinition; isSuper: boolean }) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<{ theme: string; isActive: boolean }>({
    theme: portal.theme ?? "neutral",
    isActive: portal.isActive ?? true,
  });
  const [dirty, setDirty] = useState(false);

  const saveMut = useMutation({
    mutationFn: (data: { theme: string; isActive: boolean }) =>
      apiRequest("PUT", `/api/governance/portals/${portal.slug}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portal/definitions"] });
      setDirty(false);
      toast({ title: "Workspace updated", description: `${portal.name} settings saved.` });
    },
    onError: () => toast({ title: "Save failed", variant: "destructive" }),
  });

  const theme = THEME_STYLES[draft.theme] ?? THEME_STYLES.neutral;
  const currentTheme = THEME_STYLES[portal.theme ?? "neutral"] ?? THEME_STYLES.neutral;

  const handleToggle = (val: boolean) => {
    setDraft(d => ({ ...d, isActive: val }));
    setDirty(true);
  };

  const handleTheme = (t: string) => {
    setDraft(d => ({ ...d, theme: t }));
    setDirty(true);
  };

  return (
    <div
      data-testid={`portal-card-${portal.slug}`}
      className={cn(
        "rounded-xl border transition-all duration-200",
        draft.isActive
          ? "border-white/[0.08] bg-white/[0.03]"
          : "border-white/[0.04] bg-black/[0.15] opacity-60"
      )}
    >
      <div className="flex items-center gap-3 p-4">
        <div className={cn(
          "w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ring-1",
          theme.bg, theme.ring
        )}>
          <PortalIcon icon={portal.icon ?? "settings"} className={cn("w-4 h-4", theme.accent)} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm text-foreground">{portal.name}</span>
            <span className="text-[10px] font-mono text-muted-foreground/40 uppercase">{portal.slug}</span>
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", currentTheme.dot)} />
            <span className="text-[11px] text-muted-foreground/60 truncate">
              {portal.defaultRoute ?? "/"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <Switch
            checked={draft.isActive}
            onCheckedChange={handleToggle}
            data-testid={`toggle-portal-${portal.slug}`}
          />
          <button
            onClick={() => setExpanded(e => !e)}
            data-testid={`expand-portal-${portal.slug}`}
            className="p-1.5 rounded-lg text-muted-foreground/40 hover:text-muted-foreground hover:bg-white/[0.05] transition-colors"
          >
            <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-90")} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 border-t border-white/[0.05] pt-3 space-y-3">
          <div>
            <p className="text-[11px] text-muted-foreground/50 uppercase tracking-wide mb-2">Theme Color</p>
            <ThemePicker value={draft.theme} onChange={handleTheme} />
          </div>
          <div className="flex items-center gap-2">
            <div className="text-[11px] text-muted-foreground/50">
              Roles: {(portal.allowedRoles ?? []).join(", ")}
            </div>
          </div>
          {isSuper && dirty && (
            <Button
              size="sm"
              onClick={() => saveMut.mutate(draft)}
              disabled={saveMut.isPending}
              data-testid={`save-portal-${portal.slug}`}
              className="h-7 text-xs"
            >
              {saveMut.isPending ? "Saving…" : "Save Changes"}
            </Button>
          )}
          {!isSuper && (
            <p className="text-[11px] text-muted-foreground/40">Contact a super-admin to change settings.</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function WorkspaceSettingsPage() {
  const { role } = useAuth();
  const isSuper = role === "super_admin" || role === "admin";

  const { data: portals = [], isLoading } = useQuery<PortalDefinition[]>({
    queryKey: ["/api/portal/definitions"],
  });

  const activePortals   = portals.filter(p => p.isActive);
  const inactivePortals = portals.filter(p => !p.isActive);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground" data-testid="ws-settings-heading">
            Workspace Configuration
          </h1>
          <p className="text-sm text-muted-foreground/60 mt-1">
            Manage portal workspaces, themes, and access visibility.
          </p>
        </div>
        {(role === "super_admin") && (
          <Link href="/governance">
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" data-testid="link-governance-console">
              <Settings2 className="h-3.5 w-3.5" />
              Governance Console
              <ExternalLink className="h-3 w-3 opacity-50" />
            </Button>
          </Link>
        )}
      </div>

      {role === "super_admin" && (
        <div className="flex items-start gap-2.5 p-3.5 rounded-lg bg-indigo-500/8 border border-indigo-500/15 text-sm">
          <Info className="h-4 w-4 text-indigo-400 flex-shrink-0 mt-0.5" />
          <div>
            <span className="text-indigo-300 font-medium">Advanced configuration</span>
            <span className="text-muted-foreground/60"> — module assignments, section ordering, and routing are managed in the </span>
            <Link href="/governance" className="text-indigo-400 hover:underline underline-offset-2">Governance Console</Link>.
          </div>
        </div>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground/80 uppercase tracking-wide">
            Active Workspaces
          </h2>
          <Badge variant="outline" className="text-[10px]">
            {activePortals.length} active
          </Badge>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[1,2,3,4].map(i => (
              <div key={i} className="h-20 rounded-xl bg-white/[0.03] border border-white/[0.06] animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {activePortals.map(p => (
              <PortalCard key={p.slug} portal={p} isSuper={isSuper} />
            ))}
          </div>
        )}
      </section>

      {inactivePortals.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground/40 uppercase tracking-wide">
              Inactive Workspaces
            </h2>
            <Badge variant="outline" className="text-[10px] opacity-50">
              {inactivePortals.length} hidden
            </Badge>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {inactivePortals.map(p => (
              <PortalCard key={p.slug} portal={p} isSuper={isSuper} />
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3 pt-2 border-t border-white/[0.05]">
        <h2 className="text-sm font-semibold text-foreground/80 uppercase tracking-wide">
          Full-Platform Navigation
        </h2>
        <p className="text-[13px] text-muted-foreground/60">
          The full-platform navigation (domain tabs and sidebar) is used when no portal workspace is active.
          Visibility of individual sidebar items is managed separately.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <Link href="/sidebar-settings">
            <div
              data-testid="link-sidebar-settings"
              className="flex items-center gap-3 p-4 rounded-xl border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05] transition-colors cursor-pointer group"
            >
              <div className="w-9 h-9 rounded-lg bg-slate-500/10 ring-1 ring-slate-500/20 flex items-center justify-center">
                <SlidersHorizontal className="h-4 w-4 text-slate-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">Sidebar Visibility</p>
                <p className="text-[11px] text-muted-foreground/50">Show or hide individual sidebar menu items</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors" />
            </div>
          </Link>

          {role === "super_admin" && (
            <Link href="/governance">
              <div
                data-testid="link-governance"
                className="flex items-center gap-3 p-4 rounded-xl border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05] transition-colors cursor-pointer group"
              >
                <div className="w-9 h-9 rounded-lg bg-violet-500/10 ring-1 ring-violet-500/20 flex items-center justify-center">
                  <Layers className="h-4 w-4 text-violet-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">Governance Console</p>
                  <p className="text-[11px] text-muted-foreground/50">Portal sections, module assignments, routing</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors" />
              </div>
            </Link>
          )}
        </div>
      </section>

      <div className="pb-8" />
    </div>
  );
}
