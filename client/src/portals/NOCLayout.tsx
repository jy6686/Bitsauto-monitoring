/**
 * NOCLayout.tsx
 *
 * Portal-specific layout for the NOC Portal.
 * Replaces the main platform LayoutShell for all /noc/* sub-routes.
 *
 * Structure:
 *   [NOC badge] | Dashboard | Live Operations ▼ | Command Center ▼  …  ← Full Platform
 *   ─────────────────────────────────────────────────────────────────────
 *   <page component>
 *
 * Rules:
 *   - No main platform nav or sidebar is rendered.
 *   - Page components (CallsListPage, LiveTrafficPage, etc.) are unchanged.
 *   - Only the layout context changes.
 */

import { useState } from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import {
  Activity, Monitor, Phone, Map, TrendingUp,
  Terminal, LayoutGrid, ChevronDown, ArrowLeft,
} from "lucide-react";

interface NOCLayoutProps {
  children: React.ReactNode;
}

const LIVE_OPS_PATHS  = ['/noc/live-calls', '/noc/live-traffic', '/noc/traffic-map'];
const COMMAND_PATHS   = ['/noc/noc-dashboard', '/noc/noc-command', '/noc/ops-console'];

export function NOCLayout({ children }: NOCLayoutProps) {
  const [location] = useLocation();
  const [liveOpsOpen, setLiveOpsOpen] = useState(false);
  const [cmdOpen, setCmdOpen]         = useState(false);

  function closeAll() {
    setLiveOpsOpen(false);
    setCmdOpen(false);
  }

  return (
    <div className="flex flex-col min-h-screen bg-background">

      {/* ── NOC Portal Header ─────────────────────────────────────────────── */}
      <header className="h-11 border-b bg-background/95 backdrop-blur-sm flex items-center px-4 gap-3 sticky top-0 z-50 shrink-0">

        {/* Portal badge */}
        <Link href="/noc">
          <a className="shrink-0">
            <span className="text-[10px] font-bold tracking-widest uppercase text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 px-2 py-0.5 rounded">
              NOC
            </span>
          </a>
        </Link>

        <div className="h-4 w-px bg-border shrink-0" />

        {/* Navigation */}
        <nav className="flex items-center gap-0.5">

          {/* Dashboard */}
          <Link href="/noc">
            <a className={cn(
              "px-3 py-1.5 text-sm rounded-md transition-colors",
              location === '/noc'
                ? "text-foreground bg-muted font-medium"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
            )}>
              Dashboard
            </a>
          </Link>

          {/* Live Operations dropdown */}
          <div className="relative">
            <button
              onClick={() => { setLiveOpsOpen(v => !v); setCmdOpen(false); }}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors",
                LIVE_OPS_PATHS.includes(location)
                  ? "text-foreground bg-muted font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
              )}
            >
              <Activity className="h-3.5 w-3.5" />
              Live Operations
              <ChevronDown className={cn("h-3 w-3 transition-transform", liveOpsOpen && "rotate-180")} />
            </button>
            {liveOpsOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={closeAll} />
                <div className="absolute top-full left-0 mt-1 w-44 bg-popover border rounded-lg shadow-md py-1 z-50">
                  <Link href="/noc/live-calls">
                    <a className="flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-muted transition-colors" onClick={closeAll}>
                      <Phone className="h-3.5 w-3.5 text-muted-foreground" /> Live Calls
                    </a>
                  </Link>
                  <Link href="/noc/live-traffic">
                    <a className="flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-muted transition-colors" onClick={closeAll}>
                      <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" /> Live Traffic
                    </a>
                  </Link>
                  <Link href="/noc/traffic-map">
                    <a className="flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-muted transition-colors" onClick={closeAll}>
                      <Map className="h-3.5 w-3.5 text-muted-foreground" /> Traffic Map
                    </a>
                  </Link>
                </div>
              </>
            )}
          </div>

          {/* Command Center dropdown */}
          <div className="relative">
            <button
              onClick={() => { setCmdOpen(v => !v); setLiveOpsOpen(false); }}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors",
                COMMAND_PATHS.includes(location)
                  ? "text-foreground bg-muted font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
              )}
            >
              <Monitor className="h-3.5 w-3.5" />
              Command Center
              <ChevronDown className={cn("h-3 w-3 transition-transform", cmdOpen && "rotate-180")} />
            </button>
            {cmdOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={closeAll} />
                <div className="absolute top-full left-0 mt-1 w-44 bg-popover border rounded-lg shadow-md py-1 z-50">
                  <Link href="/noc/noc-dashboard">
                    <a className="flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-muted transition-colors" onClick={closeAll}>
                      <Monitor className="h-3.5 w-3.5 text-muted-foreground" /> NOC Dashboard
                    </a>
                  </Link>
                  <Link href="/noc/noc-command">
                    <a className="flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-muted transition-colors" onClick={closeAll}>
                      <Terminal className="h-3.5 w-3.5 text-muted-foreground" /> NOC Command
                    </a>
                  </Link>
                  <Link href="/noc/ops-console">
                    <a className="flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-muted transition-colors" onClick={closeAll}>
                      <LayoutGrid className="h-3.5 w-3.5 text-muted-foreground" /> Ops Console
                    </a>
                  </Link>
                </div>
              </>
            )}
          </div>

        </nav>

        {/* Exit portal */}
        <div className="ml-auto shrink-0">
          <Link href="/">
            <a className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="h-3 w-3" />
              Full Platform
            </a>
          </Link>
        </div>

      </header>

      {/* ── Page Content ──────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>

    </div>
  );
}
