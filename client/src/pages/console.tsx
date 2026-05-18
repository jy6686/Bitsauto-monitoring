import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Activity, AlertTriangle, CheckCircle2, Clock, ShieldAlert, Zap,
  RefreshCw, ChevronRight, Ticket, Phone, Eye, Bell, ArrowRight,
  DollarSign, Users, XCircle, AlertCircle, Info, Target, GitBranch,
  TrendingDown, AlertOctagon, Search, Wrench, Flag,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

// ── Types ──────────────────────────────────────────────────────────────────────

type ConsoleSeverity = "critical" | "warning" | "info";
type IncidentState   = "active" | "acknowledged" | "investigating" | "mitigating" | "resolved";

interface ConsoleAlert {
  id: number; type: string; severity: string; message: string;
  vendor: string | null; connection: string | null;
  resolved: boolean; createdAt: string;
}

interface RootCause {
  entityType: "vendor" | "connection" | "account" | "system";
  entityId: string;
  entityLabel: string;
  confidence: number;
  reason: string;
  primarySignal: string;
}

interface TimelineEvent {
  id: string;
  kind: "incident_created" | "alert" | "state_transition" | "action" | "resolved";
  ts: string;
  offsetMs: number;
  label: string;
  detail?: string;
  actor?: string;
  severity?: string;
}

interface IncidentAction {
  id: string; type: string; actor: string; note?: string;
  metricSnapshot?: any; timestamp: string;
}

interface ConsoleIncident {
  id: number;
  entity: string; entityKey: string;
  severity: ConsoleSeverity;
  state: IncidentState;
  title: string;
  alerts: ConsoleAlert[];
  rootCause?: RootCause | null;
  timeline?: TimelineEvent[];
  actions?: IncidentAction[];
  linkedTicketId?: number | null; linkedTicketSubject?: string;
  startedAt: string; lastSeenAt: string;
  resolved: boolean; estimatedImpactPerHr: number | null;
  windowHash: string;
}

interface ConsoleResponse {
  incidents: ConsoleIncident[];
  summary: {
    active: number; critical: number;
    affectedEntities: number; estimatedImpactPerHr: number | null;
    lastUpdated: string;
  };
}

// ── State Machine Config ───────────────────────────────────────────────────────

const ALLOWED_TRANSITIONS: Record<IncidentState, IncidentState[]> = {
  active:        ["acknowledged", "investigating"],
  acknowledged:  ["investigating", "mitigating"],
  investigating: ["mitigating", "resolved"],
  mitigating:    ["resolved"],
  resolved:      ["active"],
};

const STATE_CFG: Record<IncidentState, { label: string; color: string; icon: any }> = {
  active:        { label: "Active",        color: "text-red-400 border-red-500/30 bg-red-500/10",      icon: AlertOctagon },
  acknowledged:  { label: "Acknowledged",  color: "text-amber-400 border-amber-500/30 bg-amber-500/10", icon: CheckCircle2 },
  investigating: { label: "Investigating", color: "text-blue-400 border-blue-500/30 bg-blue-500/10",   icon: Search },
  mitigating:    { label: "Mitigating",    color: "text-purple-400 border-purple-500/30 bg-purple-500/10", icon: Wrench },
  resolved:      { label: "Resolved",      color: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10", icon: Flag },
};

const TRANSITION_LABELS: Record<string, string> = {
  active:        "Reopen",
  acknowledged:  "Acknowledge",
  investigating: "Start Investigation",
  mitigating:    "Begin Mitigation",
  resolved:      "Mark Resolved",
};

// ── Severity Config ────────────────────────────────────────────────────────────

const SEV_CFG = {
  critical: { icon: XCircle,       dot: "bg-red-400",   ring: "border-red-500/40 bg-red-500/5",   badge: "bg-red-500/20 text-red-400 border-red-500/30",   text: "text-red-400",   label: "CRITICAL" },
  warning:  { icon: AlertTriangle, dot: "bg-amber-400", ring: "border-amber-500/40 bg-amber-500/5", badge: "bg-amber-500/20 text-amber-400 border-amber-500/30", text: "text-amber-400", label: "WARNING" },
  info:     { icon: Info,          dot: "bg-blue-400",  ring: "border-blue-500/40 bg-blue-500/5",  badge: "bg-blue-500/20 text-blue-400 border-blue-500/30",  text: "text-blue-400",  label: "INFO" },
};

function sevCfg(sev: string) {
  return SEV_CFG[(sev as ConsoleSeverity) in SEV_CFG ? sev as ConsoleSeverity : "info"];
}

function stateCfg(state: IncidentState) {
  return STATE_CFG[state] ?? STATE_CFG.active;
}

function ageLabel(ts: string): string {
  const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60_000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function offsetLabel(ms: number): string {
  if (ms < 60_000)   return `T+${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `T+${Math.round(ms / 60_000)}m`;
  return `T+${Math.round(ms / 3_600_000)}h`;
}

function fmtImpact(v: number | null): string {
  if (v == null) return "—";
  return `$${v.toFixed(0)}/hr`;
}

// ── Timeline event icon/color ─────────────────────────────────────────────────

const TL_KIND_CFG = {
  incident_created: { icon: AlertOctagon, color: "text-red-400",     bg: "bg-red-500/15 border-red-500/20" },
  alert:            { icon: Bell,          color: "text-amber-400",   bg: "bg-amber-500/10 border-amber-500/20" },
  state_transition: { icon: GitBranch,     color: "text-blue-400",    bg: "bg-blue-500/10 border-blue-500/20" },
  action:           { icon: Wrench,        color: "text-purple-400",  bg: "bg-purple-500/10 border-purple-500/20" },
  resolved:         { icon: Flag,          color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
};

// ── Incident Card ──────────────────────────────────────────────────────────────

function IncidentCard({ inc, selected, onClick }: { inc: ConsoleIncident; selected: boolean; onClick: () => void }) {
  const cfg  = sevCfg(inc.severity);
  const sCfg = stateCfg(inc.state);
  const StateIcon = sCfg.icon;
  return (
    <button
      onClick={onClick}
      data-testid={`incident-card-${inc.id}`}
      className={cn(
        "w-full text-left rounded-xl border p-3 transition-all",
        selected
          ? cn("border-blue-500/50 bg-blue-500/10", cfg.ring)
          : cn("border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/[0.12]"),
        inc.state === "resolved" && "opacity-50",
      )}
    >
      <div className="flex items-start gap-2.5">
        <div className="flex-shrink-0 mt-0.5">
          <span className="relative inline-flex">
            {inc.state !== "resolved" && (
              <span className={cn("absolute rounded-full animate-ping opacity-50", cfg.dot)} style={{ width: 8, height: 8 }} />
            )}
            <span className={cn("relative rounded-full", cfg.dot, inc.state === "resolved" && "!bg-gray-500")} style={{ width: 8, height: 8 }} />
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1.5 mb-1">
            <div className="flex items-center gap-1">
              <span className={cn("text-[9px] font-bold font-mono tracking-wider px-1 py-0.5 rounded border", cfg.badge)}>
                {cfg.label}
              </span>
              <span className={cn("text-[9px] font-mono tracking-wider px-1 py-0.5 rounded border flex items-center gap-0.5", sCfg.color)}>
                <StateIcon className="h-2 w-2" />
                {sCfg.label.toUpperCase()}
              </span>
            </div>
            <span className="text-[10px] text-muted-foreground/50 flex-shrink-0">{ageLabel(inc.lastSeenAt)}</span>
          </div>
          <p className="text-xs font-semibold text-foreground/90 truncate">{inc.entity}</p>
          <p className="text-[11px] text-muted-foreground truncate">{inc.title}</p>
          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-[10px] text-muted-foreground/50">
              <Bell className="inline h-2.5 w-2.5 mr-0.5" />{inc.alerts.length} signal{inc.alerts.length !== 1 ? "s" : ""}
            </span>
            {inc.estimatedImpactPerHr != null && (
              <span className="text-[10px] text-amber-400/80">
                <DollarSign className="inline h-2.5 w-2.5 mr-0.5" />~{fmtImpact(inc.estimatedImpactPerHr)}
              </span>
            )}
            {inc.linkedTicketId && (
              <span className="text-[10px] text-blue-400/70">
                <Ticket className="inline h-2.5 w-2.5 mr-0.5" />ticket
              </span>
            )}
            {inc.rootCause && (
              <span className="text-[10px] text-purple-400/70">
                <Target className="inline h-2.5 w-2.5 mr-0.5" />{Math.round(inc.rootCause.confidence)}%
              </span>
            )}
          </div>
        </div>
        <ChevronRight className={cn("h-3.5 w-3.5 flex-shrink-0 mt-1 text-muted-foreground/30", selected && "text-blue-400/70")} />
      </div>
    </button>
  );
}

// ── Root Cause Card ────────────────────────────────────────────────────────────

function RootCauseCard({ rc }: { rc: RootCause }) {
  const pct = rc.confidence;
  const color = pct >= 75 ? "text-red-400" : pct >= 50 ? "text-amber-400" : "text-blue-400";
  const barColor = pct >= 75 ? "bg-red-500" : pct >= 50 ? "bg-amber-500" : "bg-blue-500";
  return (
    <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-3.5">
      <div className="flex items-center gap-1.5 mb-2">
        <Target className="h-3.5 w-3.5 text-purple-400" />
        <span className="text-[10px] uppercase tracking-widest font-mono text-purple-400/70">Root Cause</span>
      </div>
      <div className="flex items-start justify-between gap-3 mb-2.5">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-foreground/90 truncate">{rc.entityLabel}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{rc.reason}</p>
        </div>
        <div className="flex-shrink-0 text-right">
          <p className={cn("text-xl font-bold font-mono tabular-nums leading-none", color)}>{pct}%</p>
          <p className="text-[9px] text-muted-foreground/40 font-mono">CONFIDENCE</p>
        </div>
      </div>
      <div className="h-1 rounded-full bg-white/[0.06]">
        <div className={cn("h-1 rounded-full transition-all", barColor)} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-[9px] text-muted-foreground/40 font-mono">
          primary: {rc.primarySignal.replace(/_/g, " ")}
        </span>
        <span className="text-[9px] text-muted-foreground/40 font-mono capitalize">{rc.entityType}</span>
      </div>
    </div>
  );
}

// ── Timeline View ──────────────────────────────────────────────────────────────

function TimelineView({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="flex items-center justify-center py-6">
        <p className="text-xs text-muted-foreground/40">No timeline events yet</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-0">
      {events.map((ev, i) => {
        const cfg = TL_KIND_CFG[ev.kind] ?? TL_KIND_CFG.alert;
        const Icon = cfg.icon;
        const isLast = i === events.length - 1;
        return (
          <div key={ev.id} data-testid={`timeline-event-${ev.id}`} className="flex gap-2.5">
            {/* Spine */}
            <div className="flex flex-col items-center flex-shrink-0" style={{ width: 20 }}>
              <div className={cn("rounded-full border flex items-center justify-center flex-shrink-0", cfg.bg)} style={{ width: 20, height: 20 }}>
                <Icon className={cn("h-2.5 w-2.5", cfg.color)} />
              </div>
              {!isLast && <div className="w-px flex-1 bg-white/[0.06] my-1" />}
            </div>
            {/* Content */}
            <div className={cn("flex-1 min-w-0 pb-3", isLast && "pb-0")}>
              <div className="flex items-baseline justify-between gap-1">
                <p className="text-[11px] font-medium text-foreground/85 leading-snug">{ev.label}</p>
                <span className="text-[9px] text-muted-foreground/40 font-mono flex-shrink-0">{offsetLabel(ev.offsetMs)}</span>
              </div>
              {ev.detail && <p className="text-[10px] text-muted-foreground/60 mt-0.5">{ev.detail}</p>}
              {ev.actor && <p className="text-[9px] text-muted-foreground/40 font-mono mt-0.5">by {ev.actor}</p>}
              {ev.severity && (
                <span className={cn("text-[9px] font-mono font-bold", sevCfg(ev.severity).text)}>
                  {ev.severity.toUpperCase()}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Detail Panel ───────────────────────────────────────────────────────────────

function IncidentDetail({ inc }: { inc: ConsoleIncident }) {
  const cfg  = sevCfg(inc.severity);
  const sCfg = stateCfg(inc.state);
  const StateIcon = sCfg.icon;
  const timeline = inc.timeline ?? [];

  return (
    <div className="flex flex-col h-full gap-4 p-4 overflow-y-auto">
      {/* Header */}
      <div>
        <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
          <span className={cn("text-[10px] font-bold font-mono tracking-widest px-1.5 py-0.5 rounded border", cfg.badge)}>
            {cfg.label}
          </span>
          <span className={cn("text-[10px] font-mono px-1.5 py-0.5 rounded border flex items-center gap-1", sCfg.color)}>
            <StateIcon className="h-2.5 w-2.5" />{sCfg.label}
          </span>
        </div>
        <h2 className="text-base font-bold text-foreground">{inc.entity}</h2>
        <p className="text-sm text-muted-foreground leading-snug">{inc.title}</p>
        <p className="text-[10px] text-muted-foreground/40 font-mono mt-0.5">INC-{String(inc.id).padStart(4, "0")}</p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "First seen",  value: ageLabel(inc.startedAt) },
          { label: "Last signal", value: ageLabel(inc.lastSeenAt) },
          { label: "Signals",     value: String(inc.alerts.length) },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-2.5 text-center">
            <p className="text-[9px] uppercase tracking-widest text-muted-foreground/50 font-mono">{label}</p>
            <p className="text-sm font-bold text-foreground mt-1">{value}</p>
          </div>
        ))}
      </div>

      {/* Root Cause */}
      {inc.rootCause && <RootCauseCard rc={inc.rootCause} />}

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

      {/* Timeline */}
      <div>
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground/50 font-mono mb-3">Incident Timeline</p>
        <TimelineView events={timeline} />
      </div>
    </div>
  );
}

// ── Action Panel ───────────────────────────────────────────────────────────────

function ActionPanel({ inc, onTransition, onAction, transitionPending, actionPending }: {
  inc: ConsoleIncident;
  onTransition: (toState: IncidentState, note: string) => void;
  onAction: (type: string, note: string) => void;
  transitionPending: boolean;
  actionPending: boolean;
}) {
  const [note, setNote] = useState("");
  const allowed = ALLOWED_TRANSITIONS[inc.state] ?? [];

  function handleTransition(toState: IncidentState) {
    onTransition(toState, note);
    setNote("");
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground/50 font-mono">Actions</p>

      {/* Current State */}
      <div className="rounded-lg bg-white/[0.02] border border-white/[0.06] p-3">
        <p className="text-[9px] uppercase tracking-widest text-muted-foreground/40 font-mono mb-1.5">Current State</p>
        <div className="flex items-center gap-1.5">
          {(() => {
            const sc = stateCfg(inc.state);
            const SI = sc.icon;
            return (
              <span className={cn("text-xs font-semibold flex items-center gap-1 px-2 py-1 rounded-lg border", sc.color)}>
                <SI className="h-3 w-3" />{sc.label}
              </span>
            );
          })()}
        </div>
      </div>

      {/* Note input */}
      <div>
        <p className="text-[9px] uppercase tracking-widest text-muted-foreground/40 font-mono mb-1.5">Note (optional)</p>
        <Textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Add context for the transition…"
          data-testid="input-transition-note"
          className="text-xs min-h-[60px] resize-none bg-white/[0.02] border-white/[0.08]"
        />
      </div>

      {/* Transition buttons */}
      {allowed.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-[9px] uppercase tracking-widest text-muted-foreground/40 font-mono">Advance State</p>
          {allowed.map(toState => {
            const sc = stateCfg(toState);
            const SI = sc.icon;
            return (
              <button
                key={toState}
                onClick={() => handleTransition(toState)}
                disabled={transitionPending}
                data-testid={`btn-transition-${toState}`}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2.5 rounded-lg border transition-colors text-xs font-medium disabled:opacity-50",
                  sc.color, "hover:opacity-90",
                )}
              >
                <SI className="h-3.5 w-3.5 flex-shrink-0" />
                {TRANSITION_LABELS[toState] ?? toState}
              </button>
            );
          })}
        </div>
      )}

      {allowed.length === 0 && (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-emerald-500/20 bg-emerald-500/5">
          <Flag className="h-3.5 w-3.5 text-emerald-400" />
          <span className="text-xs text-emerald-400">Incident resolved</span>
        </div>
      )}

      <hr className="border-white/[0.06]" />

      {/* Quick actions */}
      <div className="flex flex-col gap-2">
        <p className="text-[9px] uppercase tracking-widest text-muted-foreground/40 font-mono">Record Action</p>
        {[
          { type: "note",      label: "Add Note" },
          { type: "ticket",    label: "Log Ticket" },
        ].map(({ type, label }) => (
          <button
            key={type}
            onClick={() => { onAction(type, note); setNote(""); }}
            disabled={actionPending}
            data-testid={`btn-action-${type}`}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] transition-colors text-xs font-medium text-foreground/70 disabled:opacity-50"
          >
            {type === "note" ? <Bell className="h-3.5 w-3.5 text-blue-400" /> : <Ticket className="h-3.5 w-3.5 text-blue-400" />}
            {label}
          </button>
        ))}
      </div>

      <hr className="border-white/[0.06]" />

      {/* Drill-down links */}
      <div className="flex flex-col gap-1.5">
        <p className="text-[9px] uppercase tracking-widest text-muted-foreground/40 font-mono mb-1">Investigate</p>
        {[
          { href: "/alerts",      icon: Bell,     label: "Open Alerts",   tip: "Raw alert feed" },
          { href: "/calls",       icon: Phone,    label: "Live Calls",    tip: "Active traffic" },
          { href: "/ai-ops",      icon: Activity, label: "AI Ops Center", tip: "Anomaly analysis" },
          { href: "/vendors",     icon: Users,    label: "Vendors",       tip: "Vendor health" },
          { href: "/noc-command", icon: Eye,      label: "NOC View",      tip: "Operations screen" },
          ...(inc.linkedTicketId ? [{ href: "/client-portal", icon: Ticket, label: "Support Ticket", tip: `Ticket #${inc.linkedTicketId}` }] : []),
        ].map(({ href, icon: Icon, label }) => (
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
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filter, setFilter]         = useState<"all" | "active" | "critical">("all");

  const { data, isLoading, dataUpdatedAt, refetch, isFetching } = useQuery<ConsoleResponse>({
    queryKey: ["/api/console/incidents"],
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  const transitionMutation = useMutation({
    mutationFn: ({ id, toState, note }: { id: number; toState: string; note: string }) =>
      apiRequest("POST", `/api/console/incidents/${id}/transition`, { toState, actor: "operator", note: note || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/console/incidents"] });
      toast({ title: "State updated", description: "Incident lifecycle advanced." });
    },
    onError: (e: any) => toast({ title: "Transition failed", description: e.message, variant: "destructive" }),
  });

  const actionMutation = useMutation({
    mutationFn: ({ id, type, note }: { id: number; type: string; note: string }) =>
      apiRequest("POST", `/api/console/incidents/${id}/action`, { type, actor: "operator", note: note || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/console/incidents"] });
      toast({ title: "Action recorded" });
    },
    onError: (e: any) => toast({ title: "Action failed", description: e.message, variant: "destructive" }),
  });

  const incidents = data?.incidents ?? [];
  const summary   = data?.summary;

  const filtered = useMemo(() => {
    if (filter === "critical") return incidents.filter(i => i.severity === "critical");
    if (filter === "active")   return incidents.filter(i => i.state !== "resolved");
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
                { label: "ACTIVE",   value: summary.active,           color: summary.active > 0 ? "text-amber-400" : "text-emerald-400" },
                { label: "CRITICAL", value: summary.critical,         color: summary.critical > 0 ? "text-red-400" : "text-muted-foreground/40" },
                { label: "ENTITIES", value: summary.affectedEntities, color: "text-foreground" },
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
              ) : filtered.map(inc => (
                <IncidentCard
                  key={inc.id}
                  inc={inc}
                  selected={selected?.id === inc.id}
                  onClick={() => setSelectedId(inc.id)}
                />
              ))}
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
                <p className="text-xs text-muted-foreground/50">Signals grouped by entity · Root cause auto-inferred · Full audit trail</p>
              </div>
            )}
          </div>

          {/* RIGHT — Actions */}
          <div className="w-56 xl:w-64 flex-shrink-0 overflow-y-auto">
            {selected ? (
              <ActionPanel
                inc={selected}
                onTransition={(toState, note) =>
                  transitionMutation.mutate({ id: selected.id, toState, note })
                }
                onAction={(type, note) =>
                  actionMutation.mutate({ id: selected.id, type, note })
                }
                transitionPending={transitionMutation.isPending}
                actionPending={actionMutation.isPending}
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
