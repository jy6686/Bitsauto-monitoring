import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { usePortal } from "@/context/portal-context";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { useQuery } from "@tanstack/react-query";
import type { WorkspaceWithTabs } from "@shared/schema";
import {
  LayoutDashboard, Users, HeartPulse, Zap, Activity, BarChart3, FileText, Wallet,
  SendHorizonal, GitBranch, Megaphone, MessageSquare, BarChart2, ClipboardList, ReceiptText,
  Phone, Bell, Monitor, Radio, ShieldAlert, Settings, Layers, Key, Lock,
  Banknote, ArrowRightLeft, FileSpreadsheet, TrendingDown, TrendingUp, BrainCircuit, Brain,
  CreditCard, RefreshCw, BookOpen, AlertTriangle, Network, Receipt, Scale,
  LogOut, ChevronDown, Circle, LayoutGrid, SlidersHorizontal, Sun, Moon, X, Wrench,
} from "lucide-react";

// ── Icon registry ──────────────────────────────────────────────────────────────
const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  // kebab-case (portal module legacy keys)
  "layout-dashboard":   LayoutDashboard,
  "users":              Users,
  "heart-pulse":        HeartPulse,
  "zap":                Zap,
  "activity":           Activity,
  "bar-chart-3":        BarChart3,
  "file-text":          FileText,
  "wallet":             Wallet,
  "send-horizonal":     SendHorizonal,
  "git-branch":         GitBranch,
  "megaphone":          Megaphone,
  "message-square":     MessageSquare,
  "bar-chart-2":        BarChart2,
  "clipboard-list":     ClipboardList,
  "receipt-text":       ReceiptText,
  "phone":              Phone,
  "bell":               Bell,
  "monitor":            Monitor,
  "radio":              Radio,
  "shield-alert":       ShieldAlert,
  "shield-check":       ShieldAlert,
  "settings":           Settings,
  "layers":             Layers,
  "key":                Key,
  "lock":               Lock,
  "sliders-horizontal": SlidersHorizontal,
  "banknote":           Banknote,
  "arrow-right-left":   ArrowRightLeft,
  "file-spreadsheet":   FileSpreadsheet,
  "trending-down":      TrendingDown,
  "brain-circuit":      BrainCircuit,
  "wrench":             Wrench,
  "star":               LayoutGrid,
  // PascalCase — workspace seed icon names
  "Activity":           Activity,
  "AlertTriangle":      AlertTriangle,
  "BarChart2":          BarChart2,
  "BarChart3":          BarChart3,
  "BookOpen":           BookOpen,
  "Brain":              Brain,
  "CreditCard":         CreditCard,
  "FileText":           FileText,
  "Layers":             Layers,
  "Monitor":            Monitor,
  "Network":            Network,
  "Receipt":            Receipt,
  "ReceiptText":        ReceiptText,
  "RefreshCw":          RefreshCw,
  "Scale":              Scale,
  "Settings":           Settings,
  "ShieldAlert":        ShieldAlert,
  "TrendingUp":         TrendingUp,
  "TrendingDown":       TrendingDown,
  "Wallet":             Wallet,
};

function resolveIcon(iconKey?: string | null): React.ComponentType<{ className?: string }> {
  if (!iconKey) return Circle;
  return ICON_MAP[iconKey] ?? ICON_MAP[iconKey.toLowerCase()] ?? Circle;
}

// ── Per-theme accent colours ───────────────────────────────────────────────────
const THEME_ACCENT: Record<string, string> = {
  purple: "text-purple-400",
  blue:   "text-blue-400",
  green:  "text-emerald-400",
  indigo: "text-indigo-400",
  slate:  "text-slate-400",
  white:  "text-sky-400",
  neutral:"text-violet-400",
};

const THEME_BADGE: Record<string, string> = {
  purple: "bg-purple-500/10 text-purple-300 border-purple-500/20",
  blue:   "bg-blue-500/10 text-blue-300 border-blue-500/20",
  green:  "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
  indigo: "bg-indigo-500/10 text-indigo-300 border-indigo-500/20",
  slate:  "bg-slate-500/10 text-slate-300 border-slate-500/20",
  white:  "bg-sky-500/10 text-sky-300 border-sky-500/20",
  neutral:"bg-violet-500/10 text-violet-300 border-violet-500/20",
};

const THEME_ACTIVE: Record<string, string> = {
  purple: "bg-purple-500/15 text-purple-200 border-l-2 border-purple-500",
  blue:   "bg-blue-500/15 text-blue-200 border-l-2 border-blue-500",
  green:  "bg-emerald-500/15 text-emerald-200 border-l-2 border-emerald-500",
  indigo: "bg-indigo-500/15 text-indigo-200 border-l-2 border-indigo-500",
  slate:  "bg-slate-500/15 text-slate-200 border-l-2 border-slate-500",
  white:  "bg-sky-500/15 text-sky-200 border-l-2 border-sky-500",
  neutral:"bg-violet-500/15 text-violet-200 border-l-2 border-violet-500",
};

// ── PortalSidebar — workspace-driven contextual navigation ────────────────────
export function PortalSidebar({ collapsed }: { collapsed?: boolean }) {
  const [location] = useLocation();
  const { portalConfig, exitPortalMode, activePortal } = usePortal();
  const { logout, user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [expandedWs, setExpandedWs] = useState<Set<string>>(new Set());

  const { data: workspaces = [], isLoading } = useQuery<WorkspaceWithTabs[]>({
    queryKey: ['/api/workspaces/by-portal', activePortal],
    queryFn: async () => {
      if (!activePortal) return [];
      const res = await fetch(`/api/workspaces/by-portal/${activePortal}`, { credentials: 'include' });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!activePortal,
    staleTime: 5 * 60_000,
  });

  // Auto-expand workspace containing the current route
  useEffect(() => {
    if (!workspaces.length) return;
    for (const ws of workspaces) {
      const allRoutes = ws.tabs.flatMap(t => t.items.map(i => i.route));
      if (allRoutes.some(r => location === r || location.startsWith(r + '/') || location.startsWith(r + '?'))) {
        setExpandedWs(prev => new Set([...prev, ws.slug]));
        return;
      }
    }
  }, [location, workspaces]);

  if (!portalConfig || !activePortal) return null;

  const accent  = THEME_ACCENT[portalConfig.theme] ?? THEME_ACCENT.neutral;
  const badge   = THEME_BADGE[portalConfig.theme]  ?? THEME_BADGE.neutral;
  const activeC = THEME_ACTIVE[portalConfig.theme]  ?? THEME_ACTIVE.neutral;

  function isRouteActive(route: string): boolean {
    const base = route.split("?")[0];
    return location === base || location.startsWith(base + "?") || location.startsWith(base + "/");
  }

  function isWsActive(ws: WorkspaceWithTabs): boolean {
    return ws.tabs.flatMap(t => t.items).some(i => isRouteActive(i.route));
  }

  const userInitial = (user as any)?.firstName?.[0] || (user as any)?.email?.[0]?.toUpperCase() || "U";

  return (
    <div className="flex flex-col h-full">
      {/* Portal label header */}
      <div className="px-3 py-3 border-b border-white/[0.05] flex items-center justify-between gap-2 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className={cn("text-xs font-bold uppercase tracking-widest truncate", accent)}>
            {collapsed ? portalConfig.slug.slice(0, 1).toUpperCase() : portalConfig.name}
          </span>
          {!collapsed && (
            <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded border flex-shrink-0", badge)}>
              Portal
            </span>
          )}
        </div>
        {!collapsed && (
          <button
            onClick={exitPortalMode}
            data-testid="button-exit-portal"
            className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded flex-shrink-0"
            title="Exit portal mode"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Workspace-driven navigation */}
      <nav className="flex-1 overflow-y-auto py-2 [&::-webkit-scrollbar]:hidden">
        {isLoading && !collapsed && (
          <div className="px-4 py-8 text-center">
            <p className="text-xs text-muted-foreground/40">Loading...</p>
          </div>
        )}
        {!isLoading && workspaces.length === 0 && !collapsed && (
          <div className="px-4 py-8 text-center">
            <p className="text-xs text-muted-foreground/40">No workspaces configured</p>
          </div>
        )}

        {workspaces.map(ws => {
          const WsIcon   = resolveIcon(ws.icon);
          const wsActive = isWsActive(ws);
          const expanded = expandedWs.has(ws.slug) || wsActive;

          if (collapsed) {
            return (
              <div key={ws.slug} className="flex justify-center mb-0.5 px-1">
                <div
                  title={ws.label}
                  className={cn(
                    "p-2 rounded-lg transition-colors w-full flex justify-center",
                    wsActive
                      ? cn("bg-white/[0.07]", accent)
                      : "text-muted-foreground/40 hover:text-muted-foreground/70 hover:bg-white/[0.04]"
                  )}
                >
                  <WsIcon className="h-4 w-4" />
                </div>
              </div>
            );
          }

          return (
            <div key={ws.slug} className="mb-0.5">
              {/* Workspace section header — clickable to expand/collapse */}
              <button
                onClick={() => setExpandedWs(prev => {
                  const next = new Set(prev);
                  if (next.has(ws.slug)) next.delete(ws.slug);
                  else next.add(ws.slug);
                  return next;
                })}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-colors",
                  wsActive
                    ? accent
                    : "text-muted-foreground/45 hover:text-muted-foreground/70"
                )}
              >
                <WsIcon className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="truncate flex-1 text-left">{ws.label}</span>
                <ChevronDown className={cn(
                  "h-3 w-3 flex-shrink-0 transition-transform duration-150",
                  expanded && "rotate-180"
                )} />
              </button>

              {/* Workspace tabs rendered as sidebar nav items */}
              {expanded && (
                <div className="pb-1">
                  {ws.tabs.map(tab => {
                    const firstRoute = tab.items.find(i => !i.isContextual)?.route
                      ?? tab.items[0]?.route;
                    if (!firstRoute) return null;
                    const TabIcon   = resolveIcon(tab.icon);
                    const tabActive = tab.items.some(i => isRouteActive(i.route));
                    return (
                      <Link key={tab.slug} href={firstRoute} data-testid={`nav-portal-tab-${tab.slug}`}>
                        <div
                          className={cn(
                            "flex items-center gap-2.5 mx-2 py-[5px] px-2 rounded-lg text-[12px] cursor-pointer transition-all",
                            tabActive
                              ? cn("font-semibold", activeC)
                              : "text-muted-foreground/60 hover:text-foreground hover:bg-white/[0.04]",
                          )}
                        >
                          <TabIcon className={cn("h-3.5 w-3.5 flex-shrink-0", tabActive ? "" : "opacity-60")} />
                          <span className="truncate">{tab.label}</span>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* User footer */}
      <div className={cn(
        "border-t border-white/[0.05] p-2 flex items-center gap-2 flex-shrink-0",
        collapsed && "justify-center flex-col gap-1",
      )}>
        {!collapsed && (
          <div className="h-6 w-6 rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-400 font-bold text-[10px] flex-shrink-0">
            {userInitial}
          </div>
        )}
        <button
          onClick={toggleTheme}
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/[0.04] transition-colors flex-shrink-0"
          data-testid="button-portal-theme-toggle"
        >
          {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
        </button>
        <button
          onClick={logout}
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/[0.04] transition-colors flex-shrink-0"
          data-testid="button-portal-logout"
          title="Sign out"
        >
          <LogOut className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ── WorkspaceSwitcherPill ─────────────────────────────────────────────────────
export function WorkspaceSwitcherPill() {
  const { allowedPortals, activePortal, setPortal, portalConfig, exitPortalMode } = usePortal();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);

  if (allowedPortals.length === 0) return null;

  const badgeClass = THEME_BADGE[portalConfig?.theme ?? "neutral"] ?? THEME_BADGE.neutral;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        data-testid="button-workspace-pill"
        className={cn(
          "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all",
          activePortal
            ? cn(badgeClass, "hover:opacity-90")
            : "text-muted-foreground border-border/40 hover:text-foreground hover:border-border/80 bg-transparent",
        )}
      >
        <LayoutGrid className="h-3 w-3" />
        <span>{portalConfig?.name ?? "Portals"}</span>
        <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1.5 z-50 w-52 bg-background border border-border/60 rounded-xl shadow-2xl overflow-hidden">
            <div className="px-3 py-2 border-b border-border/40">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Switch Workspace
              </p>
            </div>
            <div className="py-1">
              {allowedPortals.map(p => (
                <button
                  key={p.slug}
                  onClick={() => {
                    setPortal(p.slug as any);
                    setOpen(false);
                    const target = (p as any).defaultRoute ?? '/';
                    navigate(target);
                  }}
                  data-testid={`button-switch-${p.slug}`}
                  className={cn(
                    "w-full flex items-center justify-between px-3 py-2 text-sm transition-colors hover:bg-white/[0.04]",
                    p.slug === activePortal
                      ? cn("font-semibold", THEME_ACCENT[p.theme ?? "neutral"])
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span>{p.name}</span>
                  {p.slug === activePortal && (
                    <span className="text-[10px] opacity-50 font-normal">active</span>
                  )}
                </button>
              ))}
            </div>
            {activePortal && (
              <div className="border-t border-border/40 py-1">
                <button
                  onClick={() => { exitPortalMode(); setOpen(false); }}
                  className="w-full flex items-center px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-white/[0.04] transition-colors"
                  data-testid="button-full-platform"
                >
                  ← Full Platform
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── PortalTopNav — kept for backward compatibility (sections nav) ───────────────
export function PortalTopNav() {
  const { sections, activeSection, setSection, portalConfig, modules } = usePortal();
  const [, navigate] = useLocation();

  if (!portalConfig || sections.length === 0) return null;

  const accent = THEME_ACCENT[portalConfig.theme] ?? THEME_ACCENT.neutral;

  return (
    <nav
      className="flex items-center gap-0.5 flex-1 min-w-0 overflow-x-auto [&::-webkit-scrollbar]:hidden"
      data-testid="portal-section-nav"
    >
      {sections.map(section => {
        const isActive = section.sectionKey === activeSection;
        const Icon = resolveIcon(section.icon);
        return (
          <button
            key={section.sectionKey}
            onClick={() => {
              setSection(section.sectionKey);
              const homeModule = modules.find((m: any) => m.section === section.sectionKey && m.isHome);
              const firstModule = modules.find((m: any) => m.section === section.sectionKey);
              const target = homeModule?.route ?? firstModule?.route;
              if (target) navigate(target);
            }}
            data-testid={`nav-section-${section.sectionKey}`}
            className={cn(
              "relative flex items-center gap-1.5 h-[36px] px-3 rounded-lg text-[11px] font-semibold transition-all duration-150 whitespace-nowrap flex-shrink-0",
              isActive
                ? "text-foreground bg-white/[0.08]"
                : "text-muted-foreground/60 hover:text-foreground hover:bg-white/[0.05]",
            )}
          >
            {isActive && (
              <span className={cn(
                "absolute bottom-0 left-2 right-2 h-[2px] rounded-full pointer-events-none",
                portalConfig.theme === "purple" ? "bg-gradient-to-r from-purple-400 to-indigo-500" :
                portalConfig.theme === "blue"   ? "bg-gradient-to-r from-blue-400 to-cyan-500" :
                portalConfig.theme === "green"  ? "bg-gradient-to-r from-emerald-400 to-teal-500" :
                portalConfig.theme === "indigo" ? "bg-gradient-to-r from-indigo-400 to-violet-500" :
                "bg-gradient-to-r from-violet-400 to-indigo-500"
              )} />
            )}
            <Icon className={cn("w-3.5 h-3.5", isActive ? accent : "")} />
            <span>{section.title}</span>
          </button>
        );
      })}
    </nav>
  );
}
