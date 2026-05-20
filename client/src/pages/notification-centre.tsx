import { useState, useMemo, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Bell, Mail, MessageSquare, AlertTriangle, CheckCircle2,
  Clock, ArrowRight, ShieldAlert, Activity, Info, Zap,
  BellOff, ExternalLink, RefreshCw, Search, ChevronDown,
  ChevronUp, User, Timer, FileText, X, CheckCheck, ShieldCheck,
  RotateCcw, Filter, Inbox,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatUTC } from "@/lib/date-utils";
import { useAlerts } from "@/hooks/use-alerts";
import { useAuth } from "@/hooks/use-auth";
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient } from "@/lib/queryClient";

// ── Types ─────────────────────────────────────────────────────────────────────

interface TimelineEvent {
  id: string; kind: string; ts: string;
  label: string; actor?: string; note?: string;
}

interface ConsoleIncident {
  id: number; entityKey: string; entity: string;
  severity: string; state: string; title: string;
  alerts: any[]; rootCause: any; timeline: TimelineEvent[];
  actions: any[]; startedAt: string; lastSeenAt: string;
  resolvedAt?: string; estimatedImpactPerHr?: number | null;
  acknowledgedBy?: string | null; acknowledgedAt?: string | null;
  acknowledgeNote?: string | null; resolvedBy?: string | null;
  resolutionNote?: string | null; nextEscalationMs?: number | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function severityColor(s: string) {
  if (s === "critical") return "text-rose-400 border-rose-500/30 bg-rose-500/10";
  if (s === "high")     return "text-amber-400 border-amber-500/30 bg-amber-500/10";
  if (s === "medium")   return "text-yellow-400 border-yellow-500/30 bg-yellow-500/10";
  return "text-sky-400 border-sky-500/30 bg-sky-500/10";
}

function severityBorder(s: string) {
  if (s === "critical") return "border-l-rose-500";
  if (s === "high")     return "border-l-amber-400";
  if (s === "medium")   return "border-l-yellow-400";
  return "border-l-sky-400";
}

function statePill(state: string) {
  if (state === "active")       return "bg-rose-500/15 text-rose-400 border border-rose-500/30";
  if (state === "acknowledged") return "bg-blue-500/15 text-blue-400 border border-blue-500/30";
  if (state === "resolved")     return "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30";
  return "bg-muted/30 text-muted-foreground border border-border";
}

function timeAgo(isoOrDate: string | Date | null | undefined): string {
  if (!isoOrDate) return "—";
  const ms = Date.now() - new Date(isoOrDate).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60)   return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60)   return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)   return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Escalation countdown (live ticker) ───────────────────────────────────────

function EscalationCountdown({ nextEscalationMs }: { nextEscalationMs: number | null | undefined }) {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (nextEscalationMs == null || nextEscalationMs <= 0) {
      setRemaining(null);
      return;
    }
    const deadline = Date.now() + nextEscalationMs;
    const tick = () => setRemaining(Math.max(0, deadline - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [nextEscalationMs]);

  if (remaining == null) return null;

  const mins = Math.floor(remaining / 60_000);
  const secs = Math.floor((remaining % 60_000) / 1000);
  const label = remaining <= 0 ? "Escalating…" : `${mins}m ${secs.toString().padStart(2, "0")}s`;
  const urgent = remaining < 2 * 60_000; // < 2 min

  return (
    <span className={cn(
      "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border tabular-nums",
      urgent
        ? "text-rose-300 border-rose-500/40 bg-rose-500/15 animate-pulse"
        : "text-amber-300 border-amber-500/30 bg-amber-500/10"
    )} data-testid="badge-escalation-countdown">
      <Timer className="w-3 h-3" />
      {label}
    </span>
  );
}

// ── Timeline view ─────────────────────────────────────────────────────────────

function TimelineView({ timeline, alerts }: { timeline: TimelineEvent[]; alerts: any[] }) {
  const events: { ts: string; icon: any; label: string; sub?: string; color: string }[] = [];

  // Seed with original alerts
  for (const a of (alerts ?? []).slice(0, 3)) {
    events.push({
      ts: a.createdAt ?? a.ts ?? "",
      icon: AlertTriangle,
      label: a.type?.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()) ?? "Alert",
      sub: a.message ?? undefined,
      color: "text-rose-400",
    });
  }

  // Lifecycle events from timeline
  for (const ev of (timeline ?? [])) {
    const isAck = ev.kind === "transition" && (ev.label?.toLowerCase().includes("acknowledged") || ev.label?.toLowerCase().includes("ack"));
    const isRes = ev.kind === "transition" && ev.label?.toLowerCase().includes("resolved");
    events.push({
      ts: ev.ts,
      icon: isRes ? CheckCircle2 : isAck ? CheckCheck : Activity,
      label: ev.label ?? ev.kind,
      sub: ev.actor ? `by ${ev.actor}` + (ev.note ? ` — ${ev.note}` : "") : ev.note ?? undefined,
      color: isRes ? "text-emerald-400" : isAck ? "text-blue-400" : "text-muted-foreground",
    });
  }

  // Sort by timestamp
  events.sort((a, b) => new Date(a.ts || 0).getTime() - new Date(b.ts || 0).getTime());

  if (events.length === 0) {
    return <p className="text-xs text-muted-foreground/50 py-2">No timeline events.</p>;
  }

  return (
    <div className="relative">
      <div className="absolute left-[11px] top-0 bottom-0 w-px bg-border/40" />
      <div className="space-y-3">
        {events.map((ev, i) => {
          const Icon = ev.icon;
          return (
            <div key={i} className="relative flex gap-3 pl-1">
              <div className="w-[22px] h-[22px] rounded-full bg-card border border-border/60 flex items-center justify-center flex-shrink-0 z-10">
                <Icon className={cn("w-3 h-3", ev.color)} />
              </div>
              <div className="flex-1 min-w-0 pb-0.5">
                <p className="text-xs font-medium leading-snug">{ev.label}</p>
                {ev.sub && <p className="text-[10px] text-muted-foreground/70 mt-0.5 leading-snug">{ev.sub}</p>}
                {ev.ts && (
                  <p className="text-[10px] text-muted-foreground/40 mt-0.5 font-mono">
                    {formatUTC(new Date(ev.ts), "MMM d HH:mm:ss")}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Note dialog (acknowledge / resolve) ───────────────────────────────────────

function NoteDialog({
  open, title, confirmLabel, confirmClass, note, onNoteChange, onConfirm, onCancel, isPending,
}: {
  open: boolean; title: string; confirmLabel: string; confirmClass: string;
  note: string; onNoteChange: (v: string) => void;
  onConfirm: () => void; onCancel: () => void; isPending: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative z-10 w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-2xl space-y-4"
           data-testid="dialog-note">
        <div className="flex items-center justify-between">
          <p className="font-semibold text-sm">{title}</p>
          <button onClick={onCancel} className="text-muted-foreground hover:text-foreground p-0.5 rounded" data-testid="button-dialog-close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div>
          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">
            Note (optional)
          </label>
          <textarea
            value={note}
            onChange={e => onNoteChange(e.target.value)}
            placeholder="Add a note for the audit log…"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none h-24 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            data-testid="input-note"
          />
        </div>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground border border-border hover:border-border/80 transition-colors"
            data-testid="button-cancel"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isPending}
            className={cn("px-4 py-1.5 rounded-lg text-sm font-semibold text-white transition-all disabled:opacity-50", confirmClass)}
            data-testid="button-confirm"
          >
            {isPending ? "Saving…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Incident row ──────────────────────────────────────────────────────────────

function IncidentRow({
  inc, isExpanded, onToggle, onAcknowledge, onResolve, onReopen,
}: {
  inc: ConsoleIncident;
  isExpanded: boolean;
  onToggle: () => void;
  onAcknowledge: (id: number) => void;
  onResolve: (id: number) => void;
  onReopen: (id: number) => void;
}) {
  const canAcknowledge = inc.state === "active";
  const canResolve     = inc.state === "active" || inc.state === "acknowledged";
  const canReopen      = inc.state === "resolved";

  return (
    <div
      className={cn(
        "rounded-xl border border-l-[3px] bg-card transition-all",
        severityBorder(inc.severity),
        inc.state === "resolved" ? "border-border/30 opacity-75" : "border-border/50",
      )}
      data-testid={`card-incident-${inc.id}`}
    >
      {/* ── Collapsed row ── */}
      <button
        onClick={onToggle}
        className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-muted/20 transition-colors rounded-xl"
        data-testid={`button-toggle-incident-${inc.id}`}
      >
        {/* Severity badge */}
        <span className={cn(
          "inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-widest border flex-shrink-0 mt-0.5",
          severityColor(inc.severity)
        )}>
          {inc.severity}
        </span>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-semibold text-muted-foreground/70 truncate max-w-[140px]">
              {inc.entity}
            </span>
            <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold", statePill(inc.state))}>
              {inc.state}
            </span>
            {inc.state === "acknowledged" && inc.acknowledgedBy && (
              <span className="inline-flex items-center gap-1 text-[10px] text-blue-400/80">
                <User className="w-3 h-3" />{inc.acknowledgedBy}
              </span>
            )}
          </div>
          <p className="text-sm font-medium leading-snug mt-0.5 text-foreground/90">{inc.title}</p>
          {inc.estimatedImpactPerHr != null && (
            <p className="text-[10px] text-rose-400/70 mt-0.5 font-mono">
              Est. impact: ${inc.estimatedImpactPerHr.toFixed(2)}/hr
            </p>
          )}
        </div>

        {/* Right side: age + escalation + chevron */}
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          <span className="text-[10px] text-muted-foreground/50 font-mono">{timeAgo(inc.startedAt)}</span>
          {inc.nextEscalationMs != null && inc.state === "active" && (
            <EscalationCountdown nextEscalationMs={inc.nextEscalationMs} />
          )}
          {isExpanded
            ? <ChevronUp className="w-4 h-4 text-muted-foreground/40 mt-1" />
            : <ChevronDown className="w-4 h-4 text-muted-foreground/40 mt-1" />
          }
        </div>
      </button>

      {/* ── Expanded detail ── */}
      {isExpanded && (
        <div className="border-t border-border/40 px-4 py-4 space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">

            {/* Timeline */}
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Clock className="w-3 h-3" /> Timeline
              </p>
              <TimelineView timeline={inc.timeline} alerts={inc.alerts} />
            </div>

            {/* Metadata */}
            <div className="space-y-3">

              {/* Acknowledge note */}
              {inc.acknowledgeNote && (
                <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
                  <p className="text-[10px] font-semibold text-blue-400 uppercase tracking-wider mb-1">Ack Note</p>
                  <p className="text-xs text-foreground/80">{inc.acknowledgeNote}</p>
                  {inc.acknowledgedAt && (
                    <p className="text-[10px] text-muted-foreground/50 mt-1 font-mono">
                      {formatUTC(new Date(inc.acknowledgedAt), "MMM d HH:mm")}
                    </p>
                  )}
                </div>
              )}

              {/* Resolution note */}
              {inc.resolutionNote && (
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                  <p className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider mb-1">Resolution</p>
                  <p className="text-xs text-foreground/80">{inc.resolutionNote}</p>
                  {inc.resolvedBy && (
                    <p className="text-[10px] text-muted-foreground/50 mt-1">by {inc.resolvedBy}</p>
                  )}
                </div>
              )}

              {/* Root cause */}
              {inc.rootCause && (
                <div className="rounded-lg border border-border/40 bg-muted/20 p-3">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1">
                    <FileText className="w-3 h-3" /> Root Cause
                  </p>
                  <p className="text-xs text-foreground/80">{inc.rootCause.summary ?? JSON.stringify(inc.rootCause)}</p>
                </div>
              )}

              {/* Alerts list */}
              {inc.alerts?.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                    Triggered By ({inc.alerts.length})
                  </p>
                  <div className="space-y-1">
                    {inc.alerts.slice(0, 4).map((a: any, i: number) => (
                      <div key={i} className="flex items-start gap-1.5 text-[11px]">
                        <AlertTriangle className={cn("w-3 h-3 flex-shrink-0 mt-0.5",
                          a.severity === "critical" ? "text-rose-400" : "text-amber-400")} />
                        <span className="text-foreground/70 leading-snug">{a.message ?? a.type}</span>
                      </div>
                    ))}
                    {inc.alerts.length > 4 && (
                      <p className="text-[10px] text-muted-foreground/50">+{inc.alerts.length - 4} more</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2 pt-1 border-t border-border/30">
            {canAcknowledge && (
              <button
                onClick={() => onAcknowledge(inc.id)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/30 hover:bg-blue-500/20 transition-colors"
                data-testid={`button-acknowledge-${inc.id}`}
              >
                <CheckCheck className="w-3.5 h-3.5" />
                Acknowledge
              </button>
            )}
            {canResolve && (
              <button
                onClick={() => onResolve(inc.id)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 transition-colors"
                data-testid={`button-resolve-${inc.id}`}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Resolve
              </button>
            )}
            {canReopen && (
              <button
                onClick={() => onReopen(inc.id)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-muted/30 text-muted-foreground border border-border/50 hover:bg-muted/50 transition-colors"
                data-testid={`button-reopen-${inc.id}`}
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reopen
              </button>
            )}
            <Link
              href="/ops-console"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-muted-foreground border border-border/40 hover:border-border hover:text-foreground transition-colors ml-auto"
              data-testid={`link-ops-console-${inc.id}`}
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Ops Console
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Channel card ─────────────────────────────────────────────────────────────

function ChannelCard({
  icon: Icon, iconColor, bgColor, borderColor, title, description, href, badge,
}: {
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string; bgColor: string; borderColor: string;
  title: string; description: string; href: string; badge?: number;
}) {
  return (
    <Link href={href}
      className={cn(
        "group flex items-start gap-3 rounded-xl border p-4 transition-all duration-200",
        "hover:-translate-y-0.5 hover:shadow-md cursor-pointer bg-card",
        borderColor,
      )}
      data-testid={`card-notif-channel-${title.toLowerCase().replace(/\s+/g, '-')}`}
    >
      <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0", bgColor)}>
        <Icon className={cn("w-4.5 h-4.5", iconColor)} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-semibold text-sm">{title}</p>
          {badge !== undefined && badge > 0 && (
            <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4">{badge}</Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
      </div>
      <ArrowRight className="w-4 h-4 text-muted-foreground/30 group-hover:text-muted-foreground group-hover:translate-x-0.5 transition-all flex-shrink-0 mt-0.5" />
    </Link>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type StateFilter = "all" | "active" | "acknowledged" | "resolved";

export default function NotificationCentrePage() {
  const { user } = useAuth();
  const actorName =
    [(user as any)?.firstName, (user as any)?.lastName].filter(Boolean).join(" ") ||
    (user as any)?.email || (user as any)?.id || "operator";

  const [stateFilter, setStateFilter]     = useState<StateFilter>("active");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [search, setSearch]               = useState("");
  const [expandedId, setExpandedId]       = useState<number | null>(null);

  const [ackDialog,     setAckDialog]     = useState({ open: false, incidentId: 0, note: "" });
  const [resolveDialog, setResolveDialog] = useState({ open: false, incidentId: 0, note: "" });

  // ── Data ──
  const { data, isLoading, refetch, isFetching } = useQuery<{ incidents: ConsoleIncident[]; summary: any }>({
    queryKey: ["/api/console/incidents"],
    refetchInterval: 30_000,
  });
  const { data: alerts } = useAlerts();

  const allIncidents = data?.incidents ?? [];
  const activeAlerts = (alerts ?? []).filter((a: any) => !a.resolved);

  // ── Counts for summary strip ──
  const activeCount   = allIncidents.filter(i => i.state === "active").length;
  const ackedCount    = allIncidents.filter(i => i.state === "acknowledged").length;
  const resolvedCount = allIncidents.filter(i => i.state === "resolved").length;
  const criticalCount = allIncidents.filter(i => i.severity === "critical" && i.state !== "resolved").length;

  // ── Filtered + sorted list ──
  const filtered = useMemo(() => {
    let list = [...allIncidents];
    if (stateFilter !== "all")     list = list.filter(i => i.state === stateFilter);
    if (severityFilter !== "all")  list = list.filter(i => i.severity === severityFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(i =>
        i.title.toLowerCase().includes(q) ||
        (i.entity ?? "").toLowerCase().includes(q)
      );
    }
    const stateOrder: Record<string, number>    = { active: 0, acknowledged: 1, resolved: 2 };
    const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    list.sort((a, b) => {
      const sd = (stateOrder[a.state] ?? 1) - (stateOrder[b.state] ?? 1);
      if (sd !== 0) return sd;
      return (severityOrder[a.severity] ?? 2) - (severityOrder[b.severity] ?? 2);
    });
    return list;
  }, [allIncidents, stateFilter, severityFilter, search]);

  // ── Mutations ──
  const transition = useMutation({
    mutationFn: ({ id, toState, note }: { id: number; toState: string; note?: string }) =>
      apiRequest(`/api/console/incidents/${id}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toState, actor: actorName, note,
          acknowledgedBy:  actorName, acknowledgeNote: note,
          resolvedBy:      actorName, resolutionNote:  note,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/console/incidents"] });
      setAckDialog(d => ({ ...d, open: false }));
      setResolveDialog(d => ({ ...d, open: false }));
    },
  });

  // ── Handlers ──
  const handleAcknowledge = useCallback((id: number) => {
    setAckDialog({ open: true, incidentId: id, note: "" });
  }, []);

  const handleResolve = useCallback((id: number) => {
    setResolveDialog({ open: true, incidentId: id, note: "" });
  }, []);

  const handleReopen = useCallback((id: number) => {
    transition.mutate({ id, toState: "active", note: "Reopened by operator" });
  }, [transition]);

  const toggleExpand = useCallback((id: number) => {
    setExpandedId(prev => prev === id ? null : id);
  }, []);

  // ── State filter tab def ──
  const stateTabs: { key: StateFilter; label: string; count?: number }[] = [
    { key: "all",          label: "All",          count: allIncidents.length },
    { key: "active",       label: "Active",       count: activeCount },
    { key: "acknowledged", label: "Acknowledged", count: ackedCount },
    { key: "resolved",     label: "Resolved",     count: resolvedCount },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-7">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold tracking-tight">Notification Centre</h2>
            {activeCount > 0 && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/25">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
                {activeCount} Active
              </span>
            )}
          </div>
          <p className="text-muted-foreground text-sm mt-1">
            Operational alert inbox — acknowledge, investigate, and resolve system incidents.
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-border/60 text-muted-foreground hover:text-foreground hover:border-border transition-colors disabled:opacity-50"
          data-testid="button-refresh-incidents"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", isFetching && "animate-spin")} />
          Refresh
        </button>
      </div>

      {/* ── Summary strip ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Active Incidents",  value: activeCount,   color: activeCount > 0   ? "text-rose-400"    : "text-muted-foreground", icon: ShieldAlert },
          { label: "Acknowledged",      value: ackedCount,    color: ackedCount > 0    ? "text-blue-400"    : "text-muted-foreground", icon: CheckCheck  },
          { label: "Resolved (24h)",    value: resolvedCount, color: resolvedCount > 0 ? "text-emerald-400" : "text-muted-foreground", icon: ShieldCheck },
          { label: "Critical Alerts",   value: activeAlerts.filter((a: any) => a.severity === "critical").length,
                                        color: criticalCount > 0 ? "text-rose-400" : "text-muted-foreground", icon: AlertTriangle },
        ].map(({ label, value, color, icon: Icon }) => (
          <div key={label} className="rounded-xl border border-border/50 bg-card p-4 space-y-1">
            <div className="flex items-center gap-1.5">
              <Icon className="w-3.5 h-3.5 text-muted-foreground/60" />
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
            </div>
            <p className={cn("text-2xl font-bold tabular-nums", color)}>{value}</p>
          </div>
        ))}
      </div>

      {/* ── Alert Inbox ── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Inbox className="w-4 h-4 text-muted-foreground/60" />
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Alert Inbox</h3>
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {/* State tabs */}
          <div className="flex rounded-lg border border-border/50 overflow-hidden text-xs font-medium">
            {stateTabs.map(({ key, label, count }) => (
              <button
                key={key}
                onClick={() => setStateFilter(key)}
                className={cn(
                  "px-3 py-1.5 transition-colors flex items-center gap-1.5",
                  stateFilter === key
                    ? "bg-indigo-500/15 text-indigo-400 border-x border-indigo-500/30"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                )}
                data-testid={`tab-filter-${key}`}
              >
                {label}
                {count !== undefined && count > 0 && (
                  <span className={cn(
                    "inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full text-[10px] font-bold px-1",
                    stateFilter === key ? "bg-indigo-500/30 text-indigo-300" : "bg-muted/50 text-muted-foreground"
                  )}>
                    {count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Severity filter */}
          <div className="relative">
            <Filter className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 pointer-events-none" />
            <select
              value={severityFilter}
              onChange={e => setSeverityFilter(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-border/50 bg-card text-muted-foreground appearance-none cursor-pointer hover:border-border focus:outline-none"
              data-testid="select-severity-filter"
            >
              <option value="all">All severities</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>

          {/* Search */}
          <div className="relative flex-1 min-w-[180px]">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search incidents…"
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-border/50 bg-card focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
              data-testid="input-incident-search"
            />
          </div>
        </div>

        {/* Incident list */}
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-20 rounded-xl border border-border/40 bg-card animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-border/40 bg-card/50 py-14 flex flex-col items-center gap-3 text-center">
            <BellOff className="w-8 h-8 text-muted-foreground/25" />
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                {allIncidents.length === 0 ? "No incidents yet" : "No incidents match filters"}
              </p>
              <p className="text-xs text-muted-foreground/50 mt-1">
                {allIncidents.length === 0
                  ? "System incidents will appear here when alerts are grouped."
                  : "Try adjusting the state or severity filter."}
              </p>
            </div>
            {allIncidents.length > 0 && (
              <button
                onClick={() => { setStateFilter("all"); setSeverityFilter("all"); setSearch(""); }}
                className="text-xs text-indigo-400 hover:text-indigo-300 underline-offset-2 hover:underline"
                data-testid="button-clear-filters"
              >
                Clear all filters
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(inc => (
              <IncidentRow
                key={inc.id}
                inc={inc}
                isExpanded={expandedId === inc.id}
                onToggle={() => toggleExpand(inc.id)}
                onAcknowledge={handleAcknowledge}
                onResolve={handleResolve}
                onReopen={handleReopen}
              />
            ))}
          </div>
        )}

        {/* Bulk action hint */}
        {filtered.length > 0 && (
          <p className="text-[11px] text-muted-foreground/40 mt-2 text-right">
            Showing {filtered.length} of {allIncidents.length} incidents
          </p>
        )}
      </div>

      {/* ── Notification Channels ── */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
          <Zap className="w-3.5 h-3.5" />
          Notification Channels
        </h3>
        <div className="grid sm:grid-cols-2 gap-3">
          <ChannelCard
            icon={Mail}
            iconColor="text-blue-400" bgColor="bg-blue-500/10"
            borderColor="border-blue-500/20 hover:border-blue-500/40"
            title="Email Notifications"
            description="Compose and send balance alerts, threshold warnings, and custom messages."
            href="/email-centre"
          />
          <ChannelCard
            icon={MessageSquare}
            iconColor="text-green-400" bgColor="bg-green-500/10"
            borderColor="border-green-500/20 hover:border-green-500/40"
            title="WhatsApp Alerts"
            description="Configure real-time WhatsApp notifications for critical events."
            href="/whatsapp-alerts"
          />
          <ChannelCard
            icon={Bell}
            iconColor="text-amber-400" bgColor="bg-amber-500/10"
            borderColor="border-amber-500/20 hover:border-amber-500/40"
            title="System Alerts"
            description="View all threshold breach alerts and system warnings."
            href="/alerts"
            badge={activeAlerts.length}
          />
          <ChannelCard
            icon={Activity}
            iconColor="text-violet-400" bgColor="bg-violet-500/10"
            borderColor="border-violet-500/20 hover:border-violet-500/40"
            title="Alert Rules & Monitoring"
            description="Configure monitoring rules and alert thresholds per switch."
            href="/server-monitoring?tab=alert-rules"
          />
        </div>
      </div>

      {/* ── Info banner ── */}
      <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-4 flex items-start gap-3">
        <Info className="w-4 h-4 text-indigo-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground">
          Incidents are auto-grouped from system alerts every 30 seconds. Acknowledging stops escalation reminders;
          resolving closes the incident and clears it from the active view.{" "}
          <Link href="/ops-console" className="text-indigo-400 hover:underline">Open Ops Console</Link>
          {" "}for deep-dive forensics and replay.
        </p>
      </div>

      {/* ── Acknowledge dialog ── */}
      <NoteDialog
        open={ackDialog.open}
        title="Acknowledge Incident"
        confirmLabel="Acknowledge"
        confirmClass="bg-blue-600 hover:bg-blue-500"
        note={ackDialog.note}
        onNoteChange={note => setAckDialog(d => ({ ...d, note }))}
        onConfirm={() => transition.mutate({ id: ackDialog.incidentId, toState: "acknowledged", note: ackDialog.note })}
        onCancel={() => setAckDialog(d => ({ ...d, open: false }))}
        isPending={transition.isPending}
      />

      {/* ── Resolve dialog ── */}
      <NoteDialog
        open={resolveDialog.open}
        title="Resolve Incident"
        confirmLabel="Mark Resolved"
        confirmClass="bg-emerald-600 hover:bg-emerald-500"
        note={resolveDialog.note}
        onNoteChange={note => setResolveDialog(d => ({ ...d, note }))}
        onConfirm={() => transition.mutate({ id: resolveDialog.incidentId, toState: "resolved", note: resolveDialog.note })}
        onCancel={() => setResolveDialog(d => ({ ...d, open: false }))}
        isPending={transition.isPending}
      />

    </div>
  );
}
