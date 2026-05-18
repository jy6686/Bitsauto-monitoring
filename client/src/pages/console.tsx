import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Activity, AlertTriangle, CheckCircle2, Clock, ShieldAlert, Zap,
  RefreshCw, ChevronRight, Ticket, Phone, Eye, Bell, ArrowRight,
  DollarSign, Users, XCircle, AlertCircle, Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

// ── Types ──────────────────────────────────────────────────────────────────────

type ConsoleSeverity = "critical" | "warning" | "info";

interface ConsoleAlert {
  id: number; type: string; severity: string; message: string;
  vendor: string | null; connection: string | null;
  resolved: boolean; createdAt: string;
}

interface ConsoleIncident {
  id: string; entity: string; entityKey: string;
  severity: ConsoleSeverity; title: string;
  alerts: ConsoleAlert[];
  linkedTicketId?: number; linkedTicketSubject?: string;
  startedAt: string; lastSeenAt: string;
  resolved: boolean; estimatedImpactPerHr: number | null;
}

interface ConsoleResponse {
  incidents: ConsoleIncident[];
  summary: {
    active: number; critical: number;
    affectedEntities: number; estimatedImpactPerHr: number | null;
    lastUpdated: string;
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const SEV_CFG = {
  critical: {
    icon: XCircle,
    dot:    "bg-red-400",
    ring:   "border-red-500/40 bg-red-500/5",
    badge:  "bg-red-500/20 text-red-400 border-red-500/30",
    text:   "text-red-400",
    label:  "CRITICAL",
  },
  warning: {
    icon: AlertTriangle,
    dot:    "bg-amber-400",
    ring:   "border-amber-500/40 bg-amber-500/5",
    badge:  "bg-amber-500/20 text-amber-400 border-amber-500/30",
    text:   "text-amber-400",
    label:  "WARNING",
  },
  info: {
    icon: Info,
    dot:    "bg-blue-400",
    ring:   "border-blue-500/40 bg-blue-500/5",
    badge:  "bg-blue-500/20 text-blue-400 border-blue-500/30",
    text:   "text-blue-400",
    label:  "INFO",
  },
};

function sevCfg(sev: string) {
  return SEV_CFG[(sev as ConsoleSeverity) in SEV_CFG ? sev as ConsoleSeverity : "info"];
}

function ageLabel(ts: string): string {
  const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60_000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function fmtImpact(v: number | null): string {
  if (v == null) return "—";
  return `$${v.toFixed(0)}/hr`;
}

// ── Incident Card ──────────────────────────────────────────────────────────────

function IncidentCard({
  inc, selected, onClick,
}: { inc: ConsoleIncident; selected: boolean; onClick: () => void }) {
  const cfg = sevCfg(inc.severity);
  const Icon = cfg.icon;
  return (
    <button
      onClick={onClick}
      data-testid={`incident-card-${inc.id}`}
      className={cn(
        "w-full text-left rounded-xl border p-3 transition-all",
        selected
          ? cn("border-blue-500/50 bg-blue-500/10", cfg.ring)
          : cn("border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/[0.12]"),
        inc.resolved && "opacity-50",
      )}
    >
      <div className="flex items-start gap-2.5">
        <div className="flex-shrink-0 mt-0.5">
          <span className="relative inline-flex">
            {!inc.resolved && (
              <span className={cn("absolute rounded-full animate-ping opacity-50", cfg.dot)} style={{ width: 8, height: 8 }} />
            )}
            <span className={cn("relative rounded-full", cfg.dot, inc.resolved && "bg-gray-500")} style={{ width: 8, height: 8 }} />
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1.5 mb-0.5">
            <span className={cn("text-[10px] font-bold font-mono tracking-wider", inc.resolved ? "text-gray-500" : cfg.text)}>
              {inc.resolved ? "RESOLVED" : cfg.label}
            </span>
            <span className="text-[10px] text-muted-foreground/50">{ageLabel(inc.lastSeenAt)}</span>
          </div>
          <p className="text-xs font-semibold text-foreground/90 truncate">{inc.entity}</p>
          <p className="text-[11px] text-muted-foreground truncate">{inc.title}</p>
          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-[10px] text-muted-foreground/50">
              <Bell className="inline h-2.5 w-2.5 mr-0.5" />{inc.alerts.length} signal{inc.alerts.length !== 1 ? "s" : ""}
            </span>
            {inc.estimatedImpactPerHr != null && (
              <span className="text-[10px] text-amber-400/80">
                <DollarSign className="inline h-2.5 w-2.5 mr-0.5" />
                ~{fmtImpact(inc.estimatedImpactPerHr)}
              </span>
            )}
            {inc.linkedTicketId && (
              <span className="text-[10px] text-blue-400/70">
                <Ticket className="inline h-2.5 w-2.5 mr-0.5" />ticket
              </span>
            )}
          </div>
        </div>
        <ChevronRight className={cn("h-3.5 w-3.5 flex-shrink-0 mt-1 text-muted-foreground/30", selected && "text-blue-400/70")} />
      </div>
    </button>
  );
}

// ── Detail Panel ───────────────────────────────────────────────────────────────

function IncidentDetail({ inc }: { inc: ConsoleIncident }) {
  const cfg = sevCfg(inc.severity);
  return (
    <div className="flex flex-col h-full gap-4 p-4 overflow-y-auto">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className={cn("text-[10px] font-bold font-mono tracking-widest px-1.5 py-0.5 rounded border", cfg.badge)}>
            {cfg.label}
          </span>
          {inc.resolved && (
            <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-1.5 py-0.5 rounded">
              RESOLVED
            </span>
          )}
        </div>
        <h2 className="text-base font-bold text-foreground">{inc.entity}</h2>
        <p className="text-sm text-muted-foreground">{inc.title}</p>
      </div>

      {/* Timeline KPIs */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "First seen",   value: ageLabel(inc.startedAt) },
          { label: "Last signal",  value: ageLabel(inc.lastSeenAt) },
          { label: "Signals",      value: String(inc.alerts.length) },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-3 text-center">
            <p className="text-[9px] uppercase tracking-widest text-muted-foreground/50 font-mono">{label}</p>
            <p className="text-sm font-bold text-foreground mt-1">{value}</p>
          </div>
        ))}
      </div>

      {/* Revenue impact */}
      {inc.estimatedImpactPerHr != null && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 flex items-center gap-3">
          <DollarSign className="h-5 w-5 text-amber-400 flex-shrink-0" />
          <div>
            <p className="text-xs font-semibold text-amber-400">Estimated exposure</p>
            <p className="text-xl font-bold text-amber-300">{fmtImpact(inc.estimatedImpactPerHr)}</p>
            <p className="text-[10px] text-muted-foreground/50">Based on recent CDR cost rate</p>
          </div>
        </div>
      )}

      {/* Linked ticket */}
      {inc.linkedTicketId && (
        <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 flex items-center gap-2">
          <Ticket className="h-4 w-4 text-blue-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-blue-400/70 uppercase tracking-wider font-mono">Linked Ticket #{inc.linkedTicketId}</p>
            <p className="text-xs text-foreground truncate">{inc.linkedTicketSubject}</p>
          </div>
        </div>
      )}

      {/* Signal timeline */}
      <div>
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground/50 font-mono mb-2">Signal Timeline</p>
        <div className="flex flex-col gap-2">
          {[...inc.alerts].reverse().map((a, i) => (
            <div
              key={a.id}
              className={cn(
                "flex items-start gap-2.5 p-2.5 rounded-lg border",
                a.resolved
                  ? "border-white/[0.04] bg-white/[0.01] opacity-60"
                  : sevCfg(a.severity).ring,
              )}
              data-testid={`signal-row-${a.id}`}
            >
              <div className="flex-shrink-0 mt-0.5">
                <span className={cn("block rounded-full", sevCfg(a.severity).dot, a.resolved && "bg-gray-500")} style={{ width: 6, height: 6 }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1">
                  <span className={cn("text-[10px] font-bold font-mono", sevCfg(a.severity).text)}>{a.severity.toUpperCase()}</span>
                  <span className="text-[10px] text-muted-foreground/40">{ageLabel(a.createdAt)}</span>
                </div>
                <p className="text-[11px] text-foreground/80 mt-0.5">{a.type.replace(/_/g, " ")}</p>
                {a.resolved && <p className="text-[10px] text-emerald-400/60 mt-0.5">resolved</p>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Action Panel ───────────────────────────────────────────────────────────────

function ActionPanel({ inc, onAck, ackPending }: {
  inc: ConsoleIncident;
  onAck: (alertId: number) => void;
  ackPending: boolean;
}) {
  const openAlerts = inc.alerts.filter(a => !a.resolved && !a.resolved);

  return (
    <div className="flex flex-col gap-4 p-4">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground/50 font-mono">Actions</p>

      {/* Acknowledge unresolved alerts */}
      <div className="flex flex-col gap-2">
        {openAlerts.length > 0 ? openAlerts.map(a => (
          <button
            key={a.id}
            onClick={() => onAck(a.id)}
            disabled={ackPending}
            data-testid={`btn-ack-alert-${a.id}`}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.07] transition-colors text-xs font-medium text-foreground/80 disabled:opacity-50"
          >
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 flex-shrink-0" />
            <span className="truncate">Acknowledge · {a.type.replace(/_/g, " ")}</span>
          </button>
        )) : (
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-emerald-500/20 bg-emerald-500/5">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-xs text-emerald-400">All signals acknowledged</span>
          </div>
        )}
      </div>

      <hr className="border-white/[0.06]" />

      {/* Drill-down links */}
      <div className="flex flex-col gap-1.5">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground/40 font-mono mb-1">Investigate</p>
        {[
          { href: "/alerts",       icon: Bell,        label: "Open Alerts",     tip: "Raw alert feed" },
          { href: "/calls",        icon: Phone,       label: "Live Calls",      tip: "Active traffic" },
          { href: "/ai-ops",       icon: Activity,    label: "AI Ops Center",   tip: "Anomaly analysis" },
          { href: "/vendors",      icon: Users,       label: "Vendors",         tip: "Vendor health" },
          { href: "/noc-command",  icon: Eye,         label: "NOC View",        tip: "Operations screen" },
          ...(inc.linkedTicketId ? [{ href: "/client-portal", icon: Ticket, label: "Support Ticket", tip: `Ticket #${inc.linkedTicketId}` }] : []),
        ].map(({ href, icon: Icon, label, tip }) => (
          <Link key={href} href={href}>
            <a
              data-testid={`drill-${label.toLowerCase().replace(/\s+/g, "-")}`}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-white/[0.05] bg-white/[0.02] hover:bg-white/[0.06] hover:border-white/[0.10] transition-colors group"
            >
              <Icon className="h-3.5 w-3.5 text-muted-foreground/60 flex-shrink-0 group-hover:text-blue-400 transition-colors" />
              <span className="text-xs text-foreground/70 group-hover:text-foreground transition-colors flex-1">{label}</span>
              <ArrowRight className="h-3 w-3 text-muted-foreground/30 group-hover:text-blue-400 transition-colors" />
            </a>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function ConsolePage() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter]         = useState<"all" | "active" | "critical">("all");

  const { data, isLoading, dataUpdatedAt, refetch, isFetching } = useQuery<ConsoleResponse>({
    queryKey: ["/api/console/incidents"],
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  const ackMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/alerts/${id}/acknowledge`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/console/incidents"] });
      qc.invalidateQueries({ queryKey: ["/api/alerts"] });
    },
  });

  const incidents = data?.incidents ?? [];
  const summary   = data?.summary;

  const filtered = useMemo(() => {
    if (filter === "critical") return incidents.filter(i => i.severity === "critical");
    if (filter === "active")   return incidents.filter(i => !i.resolved);
    return incidents;
  }, [incidents, filter]);

  const selected = filtered.find(i => i.id === selectedId) ?? filtered[0] ?? null;

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">

      {/* ── Top bar ────────────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 border-b border-white/[0.06] px-5 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="relative inline-flex">
                <span className="absolute rounded-full animate-ping opacity-40 bg-blue-400" style={{ width: 8, height: 8 }} />
                <span className="relative rounded-full bg-blue-400" style={{ width: 8, height: 8 }} />
              </span>
              <h1 className="text-sm font-bold text-foreground font-mono tracking-wide">UNIFIED CONSOLE</h1>
            </div>
            {dataUpdatedAt > 0 && (
              <span className="text-[10px] text-muted-foreground/40 font-mono hidden sm:block">
                UPDATED {new Date(dataUpdatedAt).toISOString().slice(11, 19)} UTC
              </span>
            )}
          </div>

          {/* Summary KPIs */}
          {summary && (
            <div className="flex items-center gap-4">
              {[
                { label: "ACTIVE",    value: summary.active,   color: summary.active > 0 ? "text-amber-400" : "text-emerald-400" },
                { label: "CRITICAL",  value: summary.critical, color: summary.critical > 0 ? "text-red-400" : "text-muted-foreground/40" },
                { label: "ENTITIES",  value: summary.affectedEntities, color: "text-foreground" },
              ].map(({ label, value, color }) => (
                <div key={label} className="text-center hidden sm:block">
                  <p className={cn("text-lg font-bold font-mono tabular-nums leading-none", color)}>{value}</p>
                  <p className="text-[9px] font-mono text-muted-foreground/40 tracking-widest">{label}</p>
                </div>
              ))}
              {summary.estimatedImpactPerHr != null && (
                <div className="text-center hidden md:block">
                  <p className="text-lg font-bold font-mono tabular-nums leading-none text-amber-400">
                    {fmtImpact(summary.estimatedImpactPerHr)}
                  </p>
                  <p className="text-[9px] font-mono text-muted-foreground/40 tracking-widest">EXPOSURE</p>
                </div>
              )}
            </div>
          )}

          <Button
            variant="ghost" size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="btn-refresh-console"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* ── Filter bar ─────────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center gap-2 px-5 py-2 border-b border-white/[0.04]">
        {(["all", "active", "critical"] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            data-testid={`filter-${f}`}
            className={cn(
              "text-[10px] font-mono uppercase tracking-widest px-2.5 py-1 rounded-md transition-colors",
              filter === f
                ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                : "text-muted-foreground/50 hover:text-muted-foreground border border-transparent",
            )}
          >
            {f}
          </button>
        ))}
        <span className="text-[10px] text-muted-foreground/30 ml-1">{filtered.length} incident{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      {/* ── 3-column body ──────────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <RefreshCw className="h-6 w-6 text-blue-400 animate-spin" />
            <p className="text-xs text-muted-foreground">Loading incident data…</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex min-h-0">

          {/* LEFT — Incident stream */}
          <div className="w-72 xl:w-80 flex-shrink-0 border-r border-white/[0.06] flex flex-col">
            <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <CheckCircle2 className="h-8 w-8 text-emerald-400/60" />
                  <p className="text-xs text-muted-foreground text-center">
                    {filter === "critical" ? "No critical incidents" : filter === "active" ? "No active incidents" : "No incidents detected"}
                  </p>
                </div>
              ) : (
                filtered.map(inc => (
                  <IncidentCard
                    key={inc.id}
                    inc={inc}
                    selected={selected?.id === inc.id}
                    onClick={() => setSelectedId(inc.id)}
                  />
                ))
              )}
            </div>
          </div>

          {/* CENTER — Detail */}
          <div className="flex-1 border-r border-white/[0.06] overflow-hidden">
            {selected ? (
              <IncidentDetail inc={selected} />
            ) : (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
                <Activity className="h-10 w-10 text-muted-foreground/20" />
                <p className="text-sm text-muted-foreground">Select an incident to view details</p>
                <p className="text-xs text-muted-foreground/50">All signals are grouped by entity and time window</p>
              </div>
            )}
          </div>

          {/* RIGHT — Actions */}
          <div className="w-56 xl:w-64 flex-shrink-0 overflow-y-auto">
            {selected ? (
              <ActionPanel
                inc={selected}
                onAck={id => ackMutation.mutate(id)}
                ackPending={ackMutation.isPending}
              />
            ) : (
              <div className="p-4">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground/30 font-mono">Actions</p>
                <p className="text-xs text-muted-foreground/40 mt-3">Select an incident</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
