import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  GitBranch, TrendingDown, TrendingUp, Minus, AlertTriangle,
  Shield, Activity, BrainCircuit, RefreshCw, ChevronRight,
  Zap, Network, CheckCircle2, ArrowRight, Eye, X,
} from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";

// ── Types ──────────────────────────────────────────────────────────────────────

interface CarrierScore {
  id: number; carrierId: string; carrierName: string;
  stabilityScore: number | null; rollingAsr: number | null;
  avgPddMs: number | null; trend: string | null;
  sampleCount: number; failureRate: number | null;
}

interface Recommendation {
  accountId: string; accountName?: string; priority?: number;
  urgency?: string; action?: string; reason?: string; dominantSignal?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

type HealthTier = "healthy" | "degraded" | "critical" | "no_data";

function getHealthTier(s: CarrierScore): HealthTier {
  if (s.sampleCount < 5) return "no_data";
  if ((s.stabilityScore ?? 100) < 45 || (s.rollingAsr ?? 100) < 30) return "critical";
  if ((s.stabilityScore ?? 100) < 70 || (s.rollingAsr ?? 100) < 50) return "degraded";
  return "healthy";
}

const TIER_CONFIG: Record<HealthTier, { label: string; dot: string; row: string; badge: string }> = {
  healthy: {
    label: "Healthy",
    dot: "bg-green-500",
    row: "hover:bg-green-500/5",
    badge: "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30",
  },
  degraded: {
    label: "Degraded",
    dot: "bg-amber-500",
    row: "hover:bg-amber-500/5",
    badge: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
  },
  critical: {
    label: "Critical",
    dot: "bg-red-500",
    row: "bg-red-500/[0.03] hover:bg-red-500/[0.07]",
    badge: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30",
  },
  no_data: {
    label: "No Data",
    dot: "bg-slate-400",
    row: "hover:bg-slate-50 dark:hover:bg-slate-800/40",
    badge: "bg-slate-100 dark:bg-slate-800 text-muted-foreground border-slate-200 dark:border-slate-700",
  },
};

function TrendIcon({ trend }: { trend: string | null }) {
  if (trend === "improving") return <TrendingUp className="h-4 w-4 text-green-500" />;
  if (trend === "degrading")  return <TrendingDown className="h-4 w-4 text-red-500" />;
  return <Minus className="h-4 w-4 text-muted-foreground/40" />;
}

function StatCell({ value, unit, warn, crit }: {
  value: number | null; unit: string; warn?: number; crit?: number;
}) {
  if (value == null) return <span className="text-muted-foreground/40">—</span>;
  const isWarn = warn != null && value < warn;
  const isCrit = crit != null && value < crit;
  return (
    <span className={cn(
      "font-mono tabular-nums font-semibold",
      isCrit ? "text-red-500" : isWarn ? "text-amber-500" : "text-foreground",
    )}>
      {value.toFixed(value >= 100 ? 0 : 1)}{unit}
    </span>
  );
}

const URGENCY_COLOR: Record<string, string> = {
  immediate: "bg-red-500/10 text-red-500 border-red-500/30",
  today:     "bg-amber-500/10 text-amber-500 border-amber-500/30",
  monitor:   "bg-slate-100 dark:bg-slate-800 text-muted-foreground border-slate-200 dark:border-slate-700",
};

// ── Summary Cards ──────────────────────────────────────────────────────────────

function SummaryCard({ label, value, sub, color, icon: Icon }: {
  label: string; value: string | number; sub?: string;
  color: string; icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">{label}</p>
          <p className={cn("text-2xl font-black tabular-nums font-mono mt-1", color)}>{value}</p>
          {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
        </div>
        <Icon className={cn("h-5 w-5 mt-0.5", color, "opacity-60")} />
      </div>
    </div>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

const TABS = [
  { key: "overview",    label: "Overview",          icon: Activity    },
  { key: "degradation", label: "Degradation Alert", icon: TrendingDown },
  { key: "qos",         label: "QoS Analysis",      icon: Zap         },
  { key: "recs",        label: "Route Recommendations", icon: BrainCircuit },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function RouteIntelligencePage() {
  const [activeTab, setActiveTab] = useState("overview");
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  const { data: scores = [], isFetching: scoresFetching } = useQuery<CarrierScore[]>({
    queryKey: ["/api/carrier-scores", 24],
    queryFn: () => fetch("/api/carrier-scores?window=24").then(r => r.json()),
    refetchInterval: 45_000,
  });

  const { data: recommendations = [], isFetching: recsFetching } = useQuery<Recommendation[]>({
    queryKey: ["/api/recommendations"],
    refetchInterval: 90_000,
  });

  const recomputeMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/carrier-scores/recompute"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/carrier-scores"] });
      toast({ title: "Carrier scores recomputed" });
    },
  });

  // Derived
  const healthy  = scores.filter(s => getHealthTier(s) === "healthy");
  const degraded = scores.filter(s => getHealthTier(s) === "degraded");
  const critical = scores.filter(s => getHealthTier(s) === "critical");
  const noData   = scores.filter(s => getHealthTier(s) === "no_data");
  const avgAsr   = scores.filter(s => s.rollingAsr != null).reduce((a, s, _, arr) => a + s.rollingAsr! / arr.length, 0);
  const avgPdd   = scores.filter(s => s.avgPddMs != null).reduce((a, s, _, arr) => a + s.avgPddMs! / arr.length, 0);

  const degradedPlusCritical = [...critical, ...degraded].sort((a, b) => (a.stabilityScore ?? 0) - (b.stabilityScore ?? 0));

  const activeRecs = recommendations.filter(r => !dismissed.has(r.accountId));

  // Sort scores for overview: worst first
  const sortedScores = [...scores].sort((a, b) => (a.stabilityScore ?? 0) - (b.stabilityScore ?? 0));

  return (
    <div className="p-4 space-y-4 max-w-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2">
            <GitBranch className="h-5 w-5 text-cyan-500" />
            Route Intelligence Cockpit
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Carrier stability, degradation detection, and route recommendations
          </p>
        </div>
        <Button
          data-testid="ri-recompute-btn"
          variant="outline"
          size="sm"
          disabled={recomputeMutation.isPending}
          onClick={() => recomputeMutation.mutate()}
          className="gap-1.5"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", recomputeMutation.isPending && "animate-spin")} />
          Recompute Scores
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard label="Healthy Carriers"  value={healthy.length}  sub={`${scores.length} total`} color="text-green-600 dark:text-green-400" icon={CheckCircle2} />
        <SummaryCard label="Degraded"          value={degraded.length} sub="stability 45–70"          color="text-amber-600 dark:text-amber-400" icon={AlertTriangle} />
        <SummaryCard label="Critical"          value={critical.length} sub="stability < 45"           color="text-red-600 dark:text-red-400"     icon={Zap} />
        <SummaryCard
          label="Avg ASR"
          value={scores.length ? `${avgAsr.toFixed(1)}%` : "—"}
          sub={scores.length ? `Avg PDD ${avgPdd.toFixed(0)}ms` : "no data"}
          color={avgAsr < 40 ? "text-red-600 dark:text-red-400" : avgAsr < 60 ? "text-amber-600 dark:text-amber-400" : "text-green-600 dark:text-green-400"}
          icon={Activity}
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 dark:bg-slate-900 p-1 rounded-lg w-fit">
        {TABS.map(tab => (
          <button
            key={tab.key}
            data-testid={`ri-tab-${tab.key}`}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
              activeTab === tab.key
                ? "bg-white dark:bg-slate-800 shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <tab.icon className="h-3.5 w-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Overview Tab ── */}
      {activeTab === "overview" && (
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b">
            <p className="text-sm font-semibold">Carrier Health Matrix</p>
            {scoresFetching && <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </div>
          {sortedScores.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Network className="h-8 w-8 mb-2 opacity-30" />
              <p className="text-sm">No carrier data yet</p>
              <p className="text-xs mt-1">Run synthetic tests to populate scores</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 border-b">
                  <tr>
                    {["Carrier", "Status", "ASR %", "Fail %", "Avg PDD", "Stability", "Samples", "Trend"].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedScores.map((s, i) => {
                    const tier = getHealthTier(s);
                    const cfg  = TIER_CONFIG[tier];
                    return (
                      <motion.tr
                        key={s.carrierId}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.025 }}
                        data-testid={`ri-carrier-${s.carrierId}`}
                        className={cn("border-b border-slate-100 dark:border-slate-800 transition-colors", cfg.row)}
                      >
                        <td className="px-4 py-2.5 font-medium">
                          <div className="flex items-center gap-2">
                            <span className={cn("w-2 h-2 rounded-full flex-shrink-0", cfg.dot)} />
                            {s.carrierName}
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={cn("text-[10px] font-bold uppercase font-mono px-2 py-0.5 rounded border", cfg.badge)}>
                            {cfg.label}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <StatCell value={s.rollingAsr} unit="%" warn={50} crit={30} />
                        </td>
                        <td className="px-4 py-2.5">
                          <StatCell value={s.failureRate} unit="%" />
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={cn(
                            "font-mono tabular-nums font-semibold",
                            (s.avgPddMs ?? 0) > 500 ? "text-amber-500" : "text-foreground",
                          )}>
                            {s.avgPddMs != null ? `${s.avgPddMs.toFixed(0)}ms` : "—"}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="w-20 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                              <motion.div
                                className={cn("h-full rounded-full", cfg.dot)}
                                initial={{ width: 0 }}
                                animate={{ width: `${Math.min(s.stabilityScore ?? 0, 100)}%` }}
                                transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                              />
                            </div>
                            <span className="font-mono text-xs tabular-nums font-semibold">
                              {s.stabilityScore?.toFixed(0) ?? "—"}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground tabular-nums">
                          {s.sampleCount.toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5">
                          <TrendIcon trend={s.trend} />
                        </td>
                      </motion.tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Degradation Alert Tab ── */}
      {activeTab === "degradation" && (
        <div className="space-y-3">
          {degradedPlusCritical.length === 0 ? (
            <div className="rounded-lg border bg-card flex flex-col items-center justify-center py-16 text-muted-foreground">
              <CheckCircle2 className="h-8 w-8 mb-2 text-green-500/40" />
              <p className="text-sm">No degraded or critical carriers</p>
              <p className="text-xs mt-1 text-muted-foreground/60">All {scores.length} carriers are healthy</p>
            </div>
          ) : degradedPlusCritical.map((s, i) => {
            const tier = getHealthTier(s);
            const cfg  = TIER_CONFIG[tier];
            return (
              <motion.div
                key={s.carrierId}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                data-testid={`deg-carrier-${s.carrierId}`}
                className={cn("rounded-lg border p-4", tier === "critical"
                  ? "bg-red-500/5 border-red-500/20"
                  : "bg-amber-500/5 border-amber-500/20")}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className={cn("w-3 h-3 rounded-full mt-1 flex-shrink-0", cfg.dot)} />
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold">{s.carrierName}</p>
                        <span className={cn("text-[10px] font-bold uppercase font-mono px-1.5 py-0.5 rounded border", cfg.badge)}>
                          {cfg.label}
                        </span>
                      </div>
                      <div className="flex gap-4 mt-2 text-sm">
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Stability</p>
                          <p className={cn("font-mono font-bold", cfg.badge.split(" ")[1])}>
                            {s.stabilityScore?.toFixed(0) ?? "—"}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">ASR</p>
                          <p className="font-mono font-bold">
                            {s.rollingAsr != null ? `${s.rollingAsr.toFixed(1)}%` : "—"}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Fail Rate</p>
                          <p className="font-mono font-bold">
                            {s.failureRate != null ? `${s.failureRate.toFixed(1)}%` : "—"}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Avg PDD</p>
                          <p className="font-mono font-bold">
                            {s.avgPddMs != null ? `${s.avgPddMs.toFixed(0)}ms` : "—"}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <TrendIcon trend={s.trend} />
                    <p className="text-[11px] text-muted-foreground font-mono">{s.sampleCount} samples</p>
                  </div>
                </div>
                {tier === "critical" && (
                  <div className="mt-3 pt-3 border-t border-red-500/20">
                    <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Carrier is below critical stability threshold — consider rerouting traffic immediately.
                    </p>
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      )}

      {/* ── QoS Analysis Tab ── */}
      {activeTab === "qos" && (
        <div className="space-y-3">
          <div className="rounded-lg border bg-card overflow-hidden">
            <div className="px-4 py-2.5 border-b">
              <p className="text-sm font-semibold">QoS Metrics by Carrier</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                ASR, PDD, and stability over the last 24 hours
              </p>
            </div>
            {scores.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Activity className="h-8 w-8 mb-2 opacity-30" />
                <p className="text-sm">No QoS data yet</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 border-b">
                    <tr>
                      {["Carrier", "ASR", "Fail Rate", "Avg PDD", "Quality Band", "Stability Score", "Trend"].map(h => (
                        <th key={h} className="px-4 py-2 text-left text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...scores].sort((a, b) => (b.rollingAsr ?? 0) - (a.rollingAsr ?? 0)).map((s, i) => {
                      const asr    = s.rollingAsr ?? 0;
                      const qBand  = asr >= 65 ? "A" : asr >= 50 ? "B" : asr >= 35 ? "C" : "D";
                      const qColor = { A: "text-green-500", B: "text-blue-500", C: "text-amber-500", D: "text-red-500" }[qBand];
                      return (
                        <tr
                          key={s.carrierId}
                          data-testid={`qos-row-${s.carrierId}`}
                          className="border-b border-slate-100 dark:border-slate-800 hover:bg-muted/20 transition-colors"
                        >
                          <td className="px-4 py-2.5 font-medium">{s.carrierName}</td>
                          <td className="px-4 py-2.5">
                            <StatCell value={s.rollingAsr} unit="%" warn={50} crit={30} />
                          </td>
                          <td className="px-4 py-2.5">
                            <StatCell value={s.failureRate} unit="%" />
                          </td>
                          <td className="px-4 py-2.5">
                            <span className={cn(
                              "font-mono tabular-nums font-semibold",
                              (s.avgPddMs ?? 0) > 500 ? "text-amber-500" : (s.avgPddMs ?? 0) > 350 ? "text-yellow-500" : "text-foreground",
                            )}>
                              {s.avgPddMs != null ? `${s.avgPddMs.toFixed(0)}ms` : "—"}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className={cn("text-xl font-black tabular-nums", qColor)}>
                              {s.sampleCount < 5 ? "—" : qBand}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <div className="w-16 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                                <motion.div
                                  className={cn("h-full rounded-full", getHealthTier(s) === "healthy" ? "bg-green-500" : getHealthTier(s) === "degraded" ? "bg-amber-500" : "bg-red-500")}
                                  style={{ width: `${Math.min(s.stabilityScore ?? 0, 100)}%` }}
                                />
                              </div>
                              <span className="font-mono text-xs tabular-nums">
                                {s.stabilityScore?.toFixed(0) ?? "—"}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5">
                            <TrendIcon trend={s.trend} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* QoS Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            {["A", "B", "C", "D"].map(band => {
              const asr_ranges = { A: [65, 100], B: [50, 65], C: [35, 50], D: [0, 35] }[band]!;
              const cnt = scores.filter(s => {
                const a = s.rollingAsr ?? 0;
                return a >= asr_ranges[0] && a < asr_ranges[1] && s.sampleCount >= 5;
              }).length;
              const colors = { A: "text-green-600 dark:text-green-400 bg-green-500/10 border-green-500/20", B: "text-blue-600 dark:text-blue-400 bg-blue-500/10 border-blue-500/20", C: "text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/20", D: "text-red-600 dark:text-red-400 bg-red-500/10 border-red-500/20" }[band];
              return (
                <div key={band} className={cn("rounded-lg border p-4", colors)}>
                  <p className="text-3xl font-black">{cnt}</p>
                  <p className="text-xs font-bold uppercase tracking-wide mt-1">Band {band}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">ASR {asr_ranges[0]}–{asr_ranges[1]}%</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Route Recommendations Tab ── */}
      {activeTab === "recs" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {activeRecs.length} active recommendations, ranked by priority
            </p>
            {recsFetching && <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
          {activeRecs.length === 0 ? (
            <div className="rounded-lg border bg-card flex flex-col items-center justify-center py-16 text-muted-foreground">
              <BrainCircuit className="h-8 w-8 mb-2 opacity-30" />
              <p className="text-sm">No active recommendations</p>
            </div>
          ) : activeRecs.slice(0, 20).map((rec, i) => {
            const urgencyCls = URGENCY_COLOR[rec.urgency ?? "monitor"] ?? URGENCY_COLOR.monitor;
            return (
              <motion.div
                key={`${rec.accountId}-${i}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                data-testid={`ri-rec-${i}`}
                className="rounded-lg border bg-card p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-7 h-7 rounded-full bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
                      <span className="text-xs font-bold text-violet-500 font-mono">#{rec.priority ?? i + 1}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={cn("text-[10px] font-bold uppercase font-mono px-1.5 py-0.5 rounded border", urgencyCls)}>
                          {rec.urgency?.toUpperCase() ?? "MONITOR"}
                        </span>
                        <span className="font-medium truncate">{rec.accountName ?? rec.accountId}</span>
                      </div>
                      {rec.action && (
                        <p className="text-sm text-muted-foreground mt-1">{rec.action}</p>
                      )}
                      {rec.dominantSignal && (
                        <p className="text-xs text-muted-foreground/60 mt-1 font-mono">
                          Signal: {rec.dominantSignal.replace(/_/g, " ")}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      data-testid={`ri-rec-dismiss-${i}`}
                      onClick={() => setDismissed(prev => new Set([...prev, rec.accountId]))}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1"
                      data-testid={`ri-rec-view-${i}`}
                      onClick={() => window.location.href = `/clients/${rec.accountId}`}
                    >
                      View <ArrowRight className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
