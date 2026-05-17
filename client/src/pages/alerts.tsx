import { useAlerts } from "@/hooks/use-alerts";
import {
  AlertTriangle, CheckCircle, Clock, Eye, ShieldCheck, XCircle,
  BrainCircuit, ArrowRight, Layers, TrendingDown, BarChart3, Wifi,
  Zap, Activity, Shield, ChevronRight,
} from "lucide-react";
import { FreshnessIndicator } from "@/components/freshness-indicator";
import { formatUTC } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import { useState, useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Alert } from "@shared/schema";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";

// ── Types ──────────────────────────────────────────────────────────────────────

type LifecycleFilter = "all" | "active" | "acknowledged" | "resolved";
type PageView = "list" | "intelligence";

interface AnomalyEvent {
  id: number; vendor: string | null; metric: string; severity: string;
  title: string; description: string; rootCause: string;
  recommendation: string; affectedEntities: string[];
  currentValue: number; baselineMean: number; deviationSigma: number;
  resolved: boolean; resolvedAt: string | null; detectedAt: string;
}

// ── Signal categories & causality map ─────────────────────────────────────────

type SignalCategory = "network_quality" | "service_quality" | "security" | "system" | "other";

const CATEGORY_META: Record<SignalCategory, {
  label: string; icon: React.ComponentType<{ className?: string }>; color: string; border: string; bg: string;
}> = {
  network_quality: { label: "Network Quality", icon: Wifi,          color: "text-sky-400",     border: "border-sky-500/20",  bg: "bg-sky-500/5"    },
  service_quality: { label: "Service Quality", icon: BarChart3,     color: "text-violet-400",  border: "border-violet-500/20", bg: "bg-violet-500/5" },
  security:        { label: "Security",        icon: Shield,        color: "text-rose-400",    border: "border-rose-500/20",  bg: "bg-rose-500/5"   },
  system:          { label: "System",          icon: Zap,           color: "text-amber-400",   border: "border-amber-500/20", bg: "bg-amber-500/5"  },
  other:           { label: "Other",           icon: AlertTriangle, color: "text-muted-foreground", border: "border-border", bg: "bg-muted/20"    },
};

function classifyType(type: string): SignalCategory {
  if (/approval_pending/i.test(type))                    return "system";
  if (/jitter|latency|packet|mos|rtd/i.test(type))      return "network_quality";
  if (/asr|acd|pdd|cdr|traffic|call/i.test(type))       return "service_quality";
  if (/fraud|blacklist|irsf|fas|spam/i.test(type))      return "security";
  if (/cpu|memory|disk|process|restart/i.test(type))    return "system";
  return "other";
}

// Causality rules: if alert types A and B both fire within a window, show chain
const CAUSALITY_CHAINS: Array<{ triggers: string[]; chain: string[]; explanation: string }> = [
  {
    triggers: ["high_jitter", "poor_mos"],
    chain: ["High Jitter", "→", "MOS Degradation"],
    explanation: "Excessive jitter disrupts voice packet ordering, directly reducing Mean Opinion Score.",
  },
  {
    triggers: ["packet_loss", "poor_mos"],
    chain: ["Packet Loss", "→", "MOS Degradation"],
    explanation: "Unrecovered packet loss causes audible gaps and perceptual quality drops.",
  },
  {
    triggers: ["high_latency", "high_pdd"],
    chain: ["High Latency", "→", "Elevated PDD"],
    explanation: "Network latency extends the post-dial delay visible to end users.",
  },
  {
    triggers: ["poor_mos", "low_asr"],
    chain: ["MOS Degradation", "→", "ASR Drop"],
    explanation: "Quality-driven early disconnects inflate failed call count, reducing ASR.",
  },
  {
    triggers: ["high_jitter", "packet_loss", "poor_mos"],
    chain: ["Jitter + Packet Loss", "→", "MOS Collapse"],
    explanation: "Combined jitter and loss create compounding impairments — likely upstream path issue.",
  },
  {
    triggers: ["low_asr", "low_acd"],
    chain: ["ASR Drop", "→", "ACD Decrease"],
    explanation: "Higher failure rate shortens average call duration as connections don't sustain.",
  },
];

function detectCausalityChains(types: string[]) {
  const typeSet = new Set(types.map(t => t.toLowerCase()));
  return CAUSALITY_CHAINS.filter(rule =>
    rule.triggers.every(t => typeSet.has(t))
  );
}

// Group alerts into clusters by category + time proximity (within 30 min windows)
interface AlertCluster {
  category: SignalCategory;
  alerts: Alert[];
  windowStart: Date;
  windowEnd: Date;
  chains: typeof CAUSALITY_CHAINS;
  relatedAnomalies: AnomalyEvent[];
}

function buildClusters(alerts: Alert[], anomalies: AnomalyEvent[]): AlertCluster[] {
  const active = alerts.filter(a => !a.resolved);
  if (!active.length) return [];

  // Group by category
  const byCategory: Record<string, Alert[]> = {};
  for (const a of active) {
    const cat = classifyType(a.type);
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(a);
  }

  const clusters: AlertCluster[] = [];

  for (const [cat, catAlerts] of Object.entries(byCategory)) {
    const sorted = [...catAlerts].sort((a, b) =>
      new Date(a.createdAt!).getTime() - new Date(b.createdAt!).getTime()
    );
    const windowStart = new Date(sorted[0].createdAt!);
    const windowEnd   = new Date(sorted[sorted.length - 1].createdAt!);

    const types   = catAlerts.map(a => a.type);
    const chains  = detectCausalityChains(types);

    // Find anomalies that overlap this time window (±30 min)
    const wStart = windowStart.getTime() - 30 * 60_000;
    const wEnd   = windowEnd.getTime()   + 30 * 60_000;
    const related = anomalies.filter(an => {
      const t = new Date(an.detectedAt).getTime();
      return t >= wStart && t <= wEnd && !an.resolved;
    });

    clusters.push({
      category: cat as SignalCategory,
      alerts: sorted,
      windowStart,
      windowEnd,
      chains,
      relatedAnomalies: related,
    });
  }

  return clusters.sort((a, b) => b.alerts.length - a.alerts.length);
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function alertStatus(a: Alert): "active" | "acknowledged" | "resolved" {
  if (a.resolved) return "resolved";
  if (a.acknowledgedAt) return "acknowledged";
  return "active";
}

const STATUS_META = {
  active: {
    label: "Active", icon: AlertTriangle,
    pill: "bg-rose-500/10 text-rose-500 border-rose-500/30",
    card: "bg-rose-500/5 border-rose-500/20 hover:border-rose-500/40",
    iconWrap: "bg-rose-500/10 text-rose-500",
  },
  acknowledged: {
    label: "Acknowledged", icon: Eye,
    pill: "bg-amber-500/10 text-amber-500 border-amber-500/30",
    card: "bg-amber-500/5 border-amber-500/20 hover:border-amber-500/40",
    iconWrap: "bg-amber-500/10 text-amber-500",
  },
  resolved: {
    label: "Resolved", icon: ShieldCheck,
    pill: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30",
    card: "bg-muted/30 border-border/50 hover:border-border",
    iconWrap: "bg-emerald-500/10 text-emerald-500",
  },
};

const SEV_META: Record<string, string> = {
  critical: "text-rose-500 border-rose-500/30",
  warning:  "text-amber-500 border-amber-500/30",
  info:     "text-sky-500 border-sky-500/30",
};

// ── Intelligence View ─────────────────────────────────────────────────────────

function IntelligenceView({ clusters }: { clusters: AlertCluster[] }) {
  if (!clusters.length) {
    return (
      <div className="text-center py-24 border border-dashed border-border rounded-xl">
        <BrainCircuit className="w-10 h-10 text-primary mx-auto mb-4 opacity-40" />
        <h3 className="text-lg font-medium">No Active Signal Clusters</h3>
        <p className="text-muted-foreground max-w-sm mx-auto mt-2">
          Alert intelligence activates when multiple active alerts are detected. All clear right now.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {clusters.map((cluster, ci) => {
        const meta = CATEGORY_META[cluster.category];
        const CIcon = meta.icon;
        const hasChains = cluster.chains.length > 0;

        return (
          <div
            key={`${cluster.category}-${ci}`}
            data-testid={`cluster-${cluster.category}`}
            className={cn("rounded-xl border p-5 space-y-4", meta.bg, meta.border)}
          >
            {/* Cluster header */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className={cn("p-2.5 rounded-xl border", meta.bg, meta.border)}>
                  <CIcon className={cn("w-5 h-5", meta.color)} />
                </div>
                <div>
                  <h3 className={cn("text-base font-bold", meta.color)}>{meta.label} Cluster</h3>
                  <p className="text-xs text-muted-foreground">
                    {cluster.alerts.length} signal{cluster.alerts.length !== 1 ? "s" : ""} ·{" "}
                    {formatUTC(cluster.windowStart, "MMM d, HH:mm")}
                    {cluster.alerts.length > 1 && ` — ${formatUTC(cluster.windowEnd, "HH:mm")}`}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 justify-end">
                {cluster.alerts.map(a => (
                  <span key={a.id} className={cn(
                    "text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border",
                    a.severity === "critical" ? SEV_META.critical : SEV_META.warning
                  )}>
                    {a.severity}
                  </span>
                ))}
              </div>
            </div>

            {/* Alert list */}
            <div className="space-y-2">
              {cluster.alerts.map(a => (
                <div key={a.id} className="flex items-start gap-2.5 text-sm">
                  <ChevronRight className={cn("w-4 h-4 mt-0.5 flex-shrink-0", meta.color)} />
                  <div className="min-w-0">
                    <span className="font-medium">{a.type.split("_").join(" ").toUpperCase()}</span>
                    <span className="text-muted-foreground ml-2">{a.message}</span>
                  </div>
                  {a.acknowledgedAt && (
                    <span className="flex-shrink-0 text-[10px] text-amber-500 border border-amber-500/30 px-1.5 py-0.5 rounded-full">ACK</span>
                  )}
                </div>
              ))}
            </div>

            {/* Causality chains */}
            {hasChains && (
              <div className="rounded-lg border border-border/50 bg-background/40 p-3 space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5" /> Causality Chain Analysis
                </p>
                {cluster.chains.map((chain, i) => (
                  <div key={i} className="space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      {chain.chain.map((node, ni) => (
                        <span key={ni} className={cn(
                          "text-xs font-bold",
                          node === "→" ? "text-muted-foreground/50" : meta.color
                        )}>
                          {node}
                        </span>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground pl-1 border-l-2 border-border/50">{chain.explanation}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Related anomalies */}
            {cluster.relatedAnomalies.length > 0 && (
              <div className="rounded-lg border border-border/50 bg-background/40 p-3 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <TrendingDown className="w-3.5 h-3.5" /> Correlated Anomalies
                  <span className="ml-auto text-[10px] font-normal normal-case text-muted-foreground/60">±30 min window</span>
                </p>
                {cluster.relatedAnomalies.map(an => (
                  <div key={an.id} className="space-y-1">
                    <div className="flex items-start gap-2 text-xs">
                      <span className={cn("font-bold uppercase px-1.5 py-0.5 rounded-full text-[10px] flex-shrink-0",
                        an.severity === "critical" ? "bg-rose-500/15 text-rose-400" :
                        an.severity === "high"     ? "bg-orange-500/15 text-orange-400" :
                                                     "bg-amber-500/15 text-amber-400"
                      )}>
                        {an.severity} {an.deviationSigma.toFixed(1)}σ
                      </span>
                      <div className="min-w-0">
                        <p className="font-medium">{an.title}</p>
                        {an.vendor && <p className="text-muted-foreground text-[11px]">Vendor: {an.vendor}</p>}
                        {an.affectedEntities?.length > 0 && (
                          <p className="text-muted-foreground text-[11px]">
                            Affects: {an.affectedEntities.slice(0, 3).join(", ")}
                            {an.affectedEntities.length > 3 && ` +${an.affectedEntities.length - 3} more`}
                          </p>
                        )}
                      </div>
                    </div>
                    {an.recommendation && (
                      <p className="text-[11px] text-emerald-500/80 flex items-start gap-1 pl-1 border-l-2 border-emerald-500/20">
                        <ArrowRight className="w-3 h-3 mt-0.5 flex-shrink-0" />
                        {an.recommendation}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AlertsPage() {
  const { role } = useAuth();
  const canResolve = role !== 'noc_operator';
  const { data: alerts, isLoading, dataUpdatedAt: alertsUpdatedAt, isFetching: alertsFetching } = useAlerts();
  const [filter, setFilter]     = useState<LifecycleFilter>("all");
  const [view, setView]         = useState<PageView>("list");

  const { data: anomalies = [] } = useQuery<AnomalyEvent[]>({
    queryKey: ["/api/anomalies"],
    refetchInterval: 60_000,
  });

  const acknowledgeMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/alerts/${id}/acknowledge`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/alerts"] }),
  });

  const resolveMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/alerts/${id}/resolve`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/alerts"] }),
  });

  const counts = {
    all:          alerts?.length ?? 0,
    active:       alerts?.filter(a => alertStatus(a) === "active").length ?? 0,
    acknowledged: alerts?.filter(a => alertStatus(a) === "acknowledged").length ?? 0,
    resolved:     alerts?.filter(a => alertStatus(a) === "resolved").length ?? 0,
  };

  const visible = (alerts ?? []).filter(a => {
    if (filter === "all") return true;
    return alertStatus(a) === filter;
  });

  const clusters = useMemo(
    () => buildClusters(alerts ?? [], anomalies),
    [alerts, anomalies]
  );

  const LIFECYCLE_TABS: { key: LifecycleFilter; label: string }[] = [
    { key: "all",          label: `All (${counts.all})`                   },
    { key: "active",       label: `Active (${counts.active})`             },
    { key: "acknowledged", label: `Acknowledged (${counts.acknowledged})` },
    { key: "resolved",     label: `Resolved (${counts.resolved})`         },
  ];

  const activeUnresolved = counts.active + counts.acknowledged;

  const bulkAckMutation = useMutation({
    mutationFn: () => Promise.all(
      (alerts ?? []).filter(a => alertStatus(a) === "active").map(a =>
        apiRequest("POST", `/api/alerts/${a.id}/acknowledge`)
      )
    ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/alerts"] }),
  });

  const bulkResolveMutation = useMutation({
    mutationFn: () => Promise.all(
      (alerts ?? []).filter(a => alertStatus(a) !== "resolved").map(a =>
        apiRequest("POST", `/api/alerts/${a.id}/resolve`)
      )
    ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/alerts"] }),
  });

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">System Alerts</h2>
          <p className="text-muted-foreground mt-1 flex items-center gap-3">
            Threshold breaches — acknowledge to indicate awareness, resolve when addressed.
            <FreshnessIndicator updatedAt={alertsUpdatedAt} intervalMs={10_000} isFetching={alertsFetching} />
          </p>
        </div>

        {/* View toggle */}
        <div className="flex items-center gap-1 border border-border rounded-xl p-1 bg-muted/30 flex-shrink-0">
          <button
            data-testid="toggle-view-list"
            onClick={() => setView("list")}
            className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all",
              view === "list" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
          >
            <Layers className="w-3.5 h-3.5" /> List
          </button>
          <button
            data-testid="toggle-view-intelligence"
            onClick={() => setView("intelligence")}
            className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all",
              view === "intelligence" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
          >
            <BrainCircuit className="w-3.5 h-3.5" /> Intelligence
            {clusters.length > 0 && (
              <span className="ml-0.5 text-[10px] bg-primary/15 text-primary px-1.5 py-0.5 rounded-full font-bold">
                {clusters.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Summary stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total",        value: counts.all,          icon: Layers,      color: "text-violet-400",  bg: "from-violet-500/10 to-violet-500/5",  border: "border-violet-500/20"  },
          { label: "Active",       value: counts.active,       icon: AlertTriangle,color: counts.active > 0 ? "text-rose-400" : "text-muted-foreground",   bg: "from-rose-500/10 to-rose-500/5",     border: counts.active > 0 ? "border-rose-500/30" : "border-border/30"   },
          { label: "Acknowledged", value: counts.acknowledged, icon: Eye,         color: counts.acknowledged > 0 ? "text-amber-400" : "text-muted-foreground", bg: "from-amber-500/10 to-amber-500/5", border: counts.acknowledged > 0 ? "border-amber-500/30" : "border-border/30" },
          { label: "Resolved",     value: counts.resolved,     icon: ShieldCheck,  color: counts.resolved > 0 ? "text-emerald-400" : "text-muted-foreground", bg: "from-emerald-500/10 to-emerald-500/5", border: counts.resolved > 0 ? "border-emerald-500/30" : "border-border/30" },
        ].map(({ label, value, icon: Icon, color, bg, border }) => (
          <div key={label} className={`rounded-xl border ${border} bg-gradient-to-br ${bg} p-4`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground font-medium">{label}</span>
              <Icon className={`w-4 h-4 ${color}`} />
            </div>
            <div className={`text-2xl font-bold ${color}`}>
              {isLoading ? <Clock className="w-5 h-5 animate-spin opacity-40" /> : value}
            </div>
          </div>
        ))}
      </div>

      {/* Bulk actions — only when there's something to act on */}
      {activeUnresolved > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">Bulk actions:</span>
          {counts.active > 0 && (
            <Button
              size="sm" variant="outline"
              data-testid="button-bulk-acknowledge"
              disabled={bulkAckMutation.isPending}
              onClick={() => bulkAckMutation.mutate()}
              className="text-amber-500 border-amber-500/30 hover:bg-amber-500/10 h-7 text-xs gap-1.5"
            >
              <Eye className="w-3.5 h-3.5" />
              Acknowledge all active ({counts.active})
            </Button>
          )}
          {canResolve && (
            <Button
              size="sm" variant="outline"
              data-testid="button-bulk-resolve"
              disabled={bulkResolveMutation.isPending}
              onClick={() => bulkResolveMutation.mutate()}
              className="text-emerald-500 border-emerald-500/30 hover:bg-emerald-500/10 h-7 text-xs gap-1.5"
            >
              <XCircle className="w-3.5 h-3.5" />
              Resolve all open ({activeUnresolved})
            </Button>
          )}
        </div>
      )}

      {view === "list" && (
        <>
          {/* Lifecycle filter tabs */}
          <div className="flex items-center gap-1 border border-border rounded-xl p-1 w-fit bg-muted/30">
            {LIFECYCLE_TABS.map(t => (
              <button
                key={t.key}
                data-testid={`tab-alert-${t.key}`}
                onClick={() => setFilter(t.key)}
                className={cn("px-4 py-1.5 rounded-lg text-sm font-medium transition-all",
                  filter === t.key
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground")}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Intelligence nudge */}
          {activeUnresolved > 1 && clusters.some(c => c.chains.length > 0) && (
            <div
              onClick={() => setView("intelligence")}
              className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-primary/20 bg-primary/5 cursor-pointer hover:bg-primary/10 transition-colors"
            >
              <BrainCircuit className="w-4 h-4 text-primary flex-shrink-0" />
              <p className="text-sm text-primary/90">
                <span className="font-semibold">Causality chains detected</span> — {clusters.filter(c => c.chains.length > 0).length} cluster{clusters.filter(c => c.chains.length > 0).length !== 1 ? "s" : ""} showing correlated signals.
              </p>
              <ArrowRight className="w-4 h-4 text-primary/60 ml-auto flex-shrink-0" />
            </div>
          )}

          {/* Alert list */}
          <div className="space-y-3">
            {isLoading ? (
              <div className="text-center py-12 text-muted-foreground">Loading alerts...</div>
            ) : visible.length === 0 ? (
              <div className="text-center py-24 border border-dashed border-border rounded-xl">
                <div className="bg-primary/5 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle className="w-8 h-8 text-primary" />
                </div>
                <h3 className="text-lg font-medium">
                  {filter === "all" ? "All Clear" : `No ${filter} alerts`}
                </h3>
                <p className="text-muted-foreground max-w-sm mx-auto mt-2">
                  {filter === "all"
                    ? "No alerts have been triggered recently. Your system is running smoothly."
                    : `There are currently no alerts in the "${filter}" state.`}
                </p>
              </div>
            ) : (
              visible.map((alert) => {
                const status  = alertStatus(alert);
                const meta    = STATUS_META[status];
                const SIcon   = meta.icon;
                const isPending = acknowledgeMutation.isPending || resolveMutation.isPending;

                return (
                  <div
                    key={alert.id}
                    data-testid={`card-alert-${alert.id}`}
                    className={cn("group relative overflow-hidden rounded-xl border p-5 transition-all duration-200 hover:shadow-lg", meta.card)}
                  >
                    <div className="flex items-start gap-4">
                      <div className={cn("p-3 rounded-full flex-shrink-0", meta.iconWrap)}>
                        <SIcon className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <h3 className="text-base font-semibold">{alert.type.split("_").join(" ").toUpperCase()}</h3>
                          <span className={cn("text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full border", SEV_META[alert.severity] ?? SEV_META.warning)}>
                            {alert.severity}
                          </span>
                          <span className={cn("text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full border", meta.pill)}>
                            {meta.label}
                          </span>
                          {(alert as any).vendor && (
                            <Link href={`/vendors/${encodeURIComponent((alert as any).vendor)}`}>
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full border bg-sky-500/10 text-sky-500 border-sky-500/30 hover:bg-sky-500/20 cursor-pointer transition-colors">
                                {(alert as any).vendor} →
                              </span>
                            </Link>
                          )}
                          {(alert as any).connection && !(alert as any).vendor && (
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full border bg-slate-500/10 text-slate-500 border-slate-500/30">
                              {(alert as any).connection}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">{alert.message}</p>
                        <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5" />
                            {alert.createdAt && formatUTC(new Date(alert.createdAt), "MMM d, yyyy HH:mm")}
                          </span>
                          {alert.acknowledgedAt && (
                            <span className="flex items-center gap-1.5 text-amber-500/80">
                              <Eye className="w-3.5 h-3.5" />
                              Acknowledged {formatUTC(new Date(alert.acknowledgedAt), "MMM d, HH:mm")}
                              {alert.acknowledgedBy && ` by ${alert.acknowledgedBy}`}
                            </span>
                          )}
                          {alert.resolvedAt && (
                            <span className="flex items-center gap-1.5 text-emerald-500/80">
                              <ShieldCheck className="w-3.5 h-3.5" />
                              Resolved {formatUTC(new Date(alert.resolvedAt), "MMM d, HH:mm")}
                            </span>
                          )}
                        </div>
                      </div>

                      {status !== "resolved" && (
                        <div className="flex flex-col gap-2 flex-shrink-0">
                          {status === "active" && (
                            <Button size="sm" variant="outline"
                              data-testid={`button-acknowledge-${alert.id}`}
                              disabled={isPending}
                              onClick={() => acknowledgeMutation.mutate(alert.id)}
                              className="text-amber-500 border-amber-500/30 hover:bg-amber-500/10 h-7 text-xs gap-1.5">
                              <Eye className="w-3.5 h-3.5" /> Acknowledge
                            </Button>
                          )}
                          {canResolve && (
                            <Button size="sm" variant="outline"
                              data-testid={`button-resolve-${alert.id}`}
                              disabled={isPending}
                              onClick={() => resolveMutation.mutate(alert.id)}
                              className="text-emerald-500 border-emerald-500/30 hover:bg-emerald-500/10 h-7 text-xs gap-1.5">
                              <XCircle className="w-3.5 h-3.5" /> Resolve
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

      {view === "intelligence" && (
        <IntelligenceView clusters={clusters} />
      )}
    </div>
  );
}
