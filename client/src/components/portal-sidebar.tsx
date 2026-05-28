import { useState } from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { usePortal } from "@/context/portal-context";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import {
  LayoutDashboard, Users, HeartPulse, Zap, Activity, BarChart3, FileText, Wallet,
  SendHorizonal, GitBranch, Megaphone, MessageSquare, BarChart2, ClipboardList, ReceiptText,
  Phone, Bell, Monitor, Radio, ShieldAlert, Settings, Layers, Key, Lock,
  Banknote, ArrowRightLeft, FileSpreadsheet, TrendingDown, BrainCircuit,
  LogOut, ChevronDown, Circle, LayoutGrid, SlidersHorizontal, Sun, Moon, X, Wrench,
} from "lucide-react";
import type { PortalModuleWithMeta } from "@shared/schema";

// ── Icon registry ──────────────────────────────────────────────────────────────
const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
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
};

function resolveIcon(iconKey: string): React.ComponentType<{ className?: string }> {
  return ICON_MAP[iconKey] ?? Circle;
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

// ── PortalSidebar — contextual, shows only active section's modules ────────────
export function PortalSidebar({ collapsed }: { collapsed?: boolean }) {
  const [location] = useLocation();
  const { portalConfig, sectionModules, exitPortalMode, activePortal } = usePortal();
  const { logout, user } = useAuth();
  const { theme, toggleTheme } = useTheme();

  if (!portalConfig || !activePortal) return null;

  const accent  = THEME_ACCENT[portalConfig.theme] ?? THEME_ACCENT.neutral;
  const badge   = THEME_BADGE[portalConfig.theme]  ?? THEME_BADGE.neutral;
  const activeC = THEME_ACTIVE[portalConfig.theme]  ?? THEME_ACTIVE.neutral;

  function isActive(route: string): boolean {
    const base = route.split("?")[0];
    return location === base || location.startsWith(base + "?") || location.startsWith(base + "/");
  }

  const userInitial = (user as any)?.firstName?.[0] || (user as any)?.email?.[0]?.toUpperCase() || "U";

  return (
    <div className="flex flex-col h-full">
      {/* Portal label */}
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

      {/* Contextual module list — only active section's modules */}
      <nav className="flex-1 overflow-y-auto py-2 [&::-webkit-scrollbar]:hidden">
        {sectionModules.length === 0 ? (
          !collapsed && (
            <div className="px-4 py-6 text-center">
              <p className="text-xs text-muted-foreground/50">No modules in this section</p>
            </div>
          )
        ) : (
          <div>
            {sectionModules.map(mod => {
              const Icon   = resolveIcon(mod.icon);
              const label  = mod.displayLabel ?? mod.title;
              const active = isActive(mod.route);
              return (
                <Link key={mod.id} href={mod.route} data-testid={`nav-portal-${mod.moduleKey}`}>
                  <div
                    className={cn(
                      "flex items-center gap-2.5 mx-2 py-2 rounded-lg text-sm cursor-pointer transition-all",
                      collapsed ? "justify-center px-0 mx-1" : "px-2",
                      active
                        ? cn("font-medium", activeC)
                        : "text-muted-foreground hover:text-foreground hover:bg-white/[0.04]",
                    )}
                    title={collapsed ? label : undefined}
                  >
                    <Icon className={cn("h-4 w-4 flex-shrink-0", active ? "" : "opacity-70")} />
                    {!collapsed && (
                      <>
                        <span className="truncate leading-tight">{label}</span>
                        {mod.visibility === "read_only" && (
                          <span className="ml-auto text-[9px] text-muted-foreground/40 font-medium uppercase tracking-wide flex-shrink-0">
                            RO
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
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
                    // Navigate to the portal's dashboard route
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

// ── PortalTopNav — Level 2 domain section tabs rendered in the top bar ─────────
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
              // Navigate to the home module route for this section
              const homeModule = modules.find(m => m.section === section.sectionKey && m.isHome);
              const firstModule = modules.find(m => m.section === section.sectionKey);
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
