/**
 * PortalNavBar.tsx — Runtime navigation rendered from Navigation Governance config.
 *
 * Reads navigation.entries from the static PortalConfig (noc.config.ts et al.)
 * and renders it as the portal top-nav bar. This is the SINGLE runtime source
 * for portal navigation — no duplicate definitions, no hardcoded menu structures.
 *
 * Flow:
 *   Feature Assignment Matrix
 *       ↓
 *   Navigation Governance (portal config navigation.entries)
 *       ↓
 *   PortalNavBar (this file)
 *       ↓
 *   Rendered Navigation
 *
 * NavItem  → single tab button; navigates directly to entry.path.
 * NavGroup → tab button with chevron; opens a dropdown of child items.
 *
 * Fallback: if no static config exists for the active portal, renders
 * PortalTopNav (the DB-driven section nav) for backward compatibility.
 * This ensures portals not yet configured continue to work.
 *
 * Authorization: unchanged — existing PortalProvider / AuthorizationProvider
 * gates remain in place; this component only changes the rendering layer.
 */

import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { ChevronDown, Circle } from "lucide-react";
import {
  Phone, Activity, Map, Monitor, Terminal, LayoutGrid,
  Cpu, BarChart2, Shield, Wrench, FileText, TrendingUp,
  Zap, MessageCircle, Radio, Building2, Hash, HeartPulse,
  Clipboard, Handshake, GitBranch, Telescope, Eye, History,
  Brain, Search, Route, TrendingDown, Compass, ArrowRightLeft,
  ShieldAlert, CheckCircle, Mic, Lock, Globe, Users, Wifi,
  Server, HardDrive, Layers, Mail, MessageSquare, LayoutDashboard,
  SquareTerminal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePortal } from "@/context/portal-context";
import { getStaticPortalConfig } from "@/portals/configs/index";
import { isNavGroup } from "@/portals/types/portal-config.types";
import type { NavEntry, NavItem, NavGroup } from "@/portals/types/portal-config.types";
import { PortalTopNav } from "@/components/portal-sidebar";

// ── Icon registry ─────────────────────────────────────────────────────────────
const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  'phone':            Phone,
  'activity':         Activity,
  'map':              Map,
  'monitor':          Monitor,
  'terminal':         Terminal,
  'layout-grid':      LayoutGrid,
  'cpu':              Cpu,
  'bar-chart-2':      BarChart2,
  'shield':           Shield,
  'wrench':           Wrench,
  'file-text':        FileText,
  'trending-up':      TrendingUp,
  'zap':              Zap,
  'message-circle':   MessageCircle,
  'radio':            Radio,
  'building-2':       Building2,
  'hash':             Hash,
  'heart-pulse':      HeartPulse,
  'clipboard':        Clipboard,
  'handshake':        Handshake,
  'git-branch':       GitBranch,
  'telescope':        Telescope,
  'eye':              Eye,
  'history':          History,
  'brain':            Brain,
  'search':           Search,
  'route':            Route,
  'trending-down':    TrendingDown,
  'compass':          Compass,
  'arrow-right-left': ArrowRightLeft,
  'shield-alert':     ShieldAlert,
  'check-circle':     CheckCircle,
  'mic':              Mic,
  'lock':             Lock,
  'globe':            Globe,
  'users':            Users,
  'wifi':             Wifi,
  'server':           Server,
  'hard-drive':       HardDrive,
  'layers':           Layers,
  'mail':             Mail,
  'message-square':   MessageSquare,
  'layout-dashboard': LayoutDashboard,
  'square-terminal':  SquareTerminal,
};

function resolveIcon(name?: string): React.ComponentType<{ className?: string }> {
  if (!name) return Circle;
  return ICON_MAP[name] ?? ICON_MAP[name.toLowerCase()] ?? Circle;
}

// ── Per-theme accent colours (mirrors portal-sidebar THEME_ACCENT) ─────────────
const THEME_ACCENT: Record<string, string> = {
  purple:  'text-purple-400',
  blue:    'text-blue-400',
  green:   'text-emerald-400',
  indigo:  'text-indigo-400',
  neutral: 'text-violet-400',
};

const THEME_UNDERLINE: Record<string, string> = {
  purple:  'bg-gradient-to-r from-purple-400 to-indigo-500',
  blue:    'bg-gradient-to-r from-blue-400 to-cyan-500',
  green:   'bg-gradient-to-r from-emerald-400 to-teal-500',
  indigo:  'bg-gradient-to-r from-indigo-400 to-violet-500',
  neutral: 'bg-gradient-to-r from-violet-400 to-indigo-500',
};

// ── Path matching helpers ─────────────────────────────────────────────────────

function isPathActive(location: string, path: string): boolean {
  if (path === '/' ) return location === '/';
  return location === path || location.startsWith(path + '/');
}

function isGroupActive(location: string, entry: NavGroup): boolean {
  return entry.items.some(item => isPathActive(location, item.path));
}

// ── NavItemTab — renders a single flat NavItem as a tab ──────────────────────

function NavItemTab({
  entry,
  accentClass,
  underlineClass,
}: {
  entry: NavItem;
  accentClass: string;
  underlineClass: string;
}) {
  const [location, navigate] = useLocation();
  const active = isPathActive(location, entry.path);
  const Icon = resolveIcon(entry.icon);

  return (
    <button
      onClick={() => navigate(entry.path)}
      data-testid={`portal-nav-${entry.label.toLowerCase().replace(/\s+/g, '-')}`}
      className={cn(
        "relative flex items-center gap-1.5 h-[36px] px-3 rounded-lg text-[11px] font-semibold transition-all duration-150 whitespace-nowrap flex-shrink-0",
        active
          ? "text-foreground bg-white/[0.08]"
          : "text-muted-foreground/60 hover:text-foreground hover:bg-white/[0.05]",
      )}
    >
      {active && (
        <span className={cn(
          "absolute bottom-0 left-2 right-2 h-[2px] rounded-full pointer-events-none",
          underlineClass,
        )} />
      )}
      <Icon className={cn("w-3.5 h-3.5", active ? accentClass : "")} />
      <span>{entry.label}</span>
    </button>
  );
}

// ── NavGroupTab — renders a NavGroup as a tab with a dropdown ────────────────

function NavGroupTab({
  entry,
  accentClass,
  underlineClass,
}: {
  entry: NavGroup;
  accentClass: string;
  underlineClass: string;
}) {
  const [location, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = isGroupActive(location, entry);
  const Icon = resolveIcon(entry.icon);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        onClick={() => setOpen(o => !o)}
        data-testid={`portal-nav-${entry.label.toLowerCase().replace(/\s+/g, '-')}`}
        className={cn(
          "relative flex items-center gap-1.5 h-[36px] px-3 rounded-lg text-[11px] font-semibold transition-all duration-150 whitespace-nowrap",
          active || open
            ? "text-foreground bg-white/[0.08]"
            : "text-muted-foreground/60 hover:text-foreground hover:bg-white/[0.05]",
        )}
      >
        {active && !open && (
          <span className={cn(
            "absolute bottom-0 left-2 right-2 h-[2px] rounded-full pointer-events-none",
            underlineClass,
          )} />
        )}
        <Icon className={cn("w-3.5 h-3.5", active ? accentClass : "")} />
        <span>{entry.label}</span>
        <ChevronDown className={cn(
          "w-3 h-3 transition-transform duration-150",
          open ? "rotate-180" : "",
          active ? accentClass : "",
        )} />
      </button>

      {open && (
        <div className={cn(
          "absolute top-[calc(100%+4px)] left-0 z-50 min-w-[180px]",
          "bg-[#0d0d14] border border-white/[0.08] rounded-xl shadow-2xl py-1.5",
          "overflow-hidden",
        )}>
          {entry.items.map(item => {
            const ItemIcon = resolveIcon(item.icon);
            const itemActive = isPathActive(location, item.path);
            return (
              <button
                key={item.path}
                onClick={() => { navigate(item.path); setOpen(false); }}
                data-testid={`portal-nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3.5 py-2 text-[11px] font-medium transition-colors",
                  itemActive
                    ? "text-foreground bg-white/[0.06]"
                    : "text-muted-foreground/70 hover:text-foreground hover:bg-white/[0.04]",
                )}
              >
                <ItemIcon className={cn("w-3.5 h-3.5 flex-shrink-0", itemActive ? accentClass : "")} />
                <span>{item.label}</span>
                {itemActive && (
                  <span className={cn("ml-auto w-1.5 h-1.5 rounded-full flex-shrink-0", accentClass.replace('text-', 'bg-'))} />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── PortalNavBar — main export ────────────────────────────────────────────────

/**
 * Renders the portal top-nav bar from Navigation Governance configuration.
 * Replaces PortalTopNav in app-nav-shell when a static portal config exists.
 * Falls back to PortalTopNav (DB-driven) for portals not yet configured.
 */
export function PortalNavBar() {
  const { activePortal, portalConfig } = usePortal();

  const staticConfig = activePortal ? getStaticPortalConfig(activePortal) : null;

  if (!staticConfig) {
    return <PortalTopNav />;
  }

  const theme       = portalConfig?.theme ?? 'neutral';
  const accentClass = THEME_ACCENT[theme]    ?? THEME_ACCENT.neutral;
  const underClass  = THEME_UNDERLINE[theme] ?? THEME_UNDERLINE.neutral;

  return (
    <nav
      className="flex items-center gap-0.5 flex-1 min-w-0 overflow-x-auto [&::-webkit-scrollbar]:hidden"
      data-testid="portal-nav-bar"
      aria-label={`${staticConfig.name} navigation`}
    >
      {staticConfig.navigation.entries.map((entry: NavEntry) =>
        isNavGroup(entry) ? (
          <NavGroupTab
            key={entry.label}
            entry={entry}
            accentClass={accentClass}
            underlineClass={underClass}
          />
        ) : (
          <NavItemTab
            key={entry.label}
            entry={entry as NavItem}
            accentClass={accentClass}
            underlineClass={underClass}
          />
        )
      )}
    </nav>
  );
}
