import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Activity, RefreshCw, TrendingUp, TrendingDown, Minus,
  ChevronDown, ChevronUp, XCircle, Clock, BarChart3, Wifi,
  Filter, ArrowDown, CheckCircle2, AlertTriangle, Sparkles, Play,
  ArrowUpDown, MoveUp, MoveDown,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ── Types ─────────────────────────────────────────────────────────────────────

type CarrierScore = {
  id: number;
  carrierId: string;
  carrierName: string;
  windowHours: number;
  sampleCount: number;
  connectedCount: number;
  failedCount: number;
  rollingAsr: number | null;
  avgPddMs: number | null;
  p95PddMs: number | null;
  failureRate: number | null;
  stabilityScore: number | null;
  trend: "improving" | "stable" | "degrading" | null;
  lastComputedAt: string;
};

type RouteTrace = {
  id: number;
  campaignId: number | null;
  runId: number | null;
  cld: string;
  cli: string | null;
  selectedCarrier: string | null;
  selectedCarrierId: number | null;
  candidateRoutes: string | null;
  decisionReason: string | null;
  outcome: string | null;
  sipCode: number | null;
  pddMs: number | null;
  durationSec: number | null;
  failureCategory: string | null;
  createdAt: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function stabilityColor(score: number | null) {
  if (score == null) return "text-muted-foreground";
  if (score >= 80) return "text-green-500";
  if (score >= 60) return "text-yellow-500";
  if (score >= 40) return "text-orange-500";
  return "text-red-500";
}

function stabilityBg(score: number | null) {
  if (score == null) return "bg-muted/30 border-border";
  if (score >= 80) return "bg-green-500/10 border-green-500/20";
  if (score >= 60) return "bg-yellow-500/10 border-yellow-500/20";
  if (score >= 40) return "bg-orange-500/10 border-orange-500/20";
  return "bg-red-500/10 border-red-500/20";
}

function stabilityBarColor(score: number | null) {
  if (score == null) return "bg-muted";
  if (score >= 80) return "bg-green-500";
  if (score >= 60) return "bg-yellow-500";
  if (score >= 40) return "bg-orange-500";
  return "bg-red-500";
}

function TrendIcon({ trend }: { trend: string | null }) {
  if (trend === "improving") return <TrendingUp className="h-4 w-4 text-green-500" />;
  if (trend === "degrading") return <TrendingDown className="h-4 w-4 text-red-500" />;
  return <Minus className="h-4 w-4 text-muted-foreground" />;
}

// ── Count-up hook ─────────────────────────────────────────────────────────────

function useCountUp(target: number, duration = 700): number {
  const [value, setValue] = useState(0);
  const raf = useRef<number>(0);
  useEffect(() => {
    const startTime = performance.now();
    const startVal = 0;
    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(startVal + eased * (target - startVal)));
      if (progress < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [target, duration]);
  return value;
}

// ── Animated stability bar ────────────────────────────────────────────────────

function StabilityBar({ score }: { score: number | null }) {
  const s = score ?? 0;
  return (
    <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
      <motion.div
        className={cn("h-full rounded-full", stabilityBarColor(score))}
        initial={{ width: 0 }}
        animate={{ width: `${s}%` }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      />
    </div>
  );
}

// ── Live pulse dot ────────────────────────────────────────────────────────────

function LivePulse({ color = "green", size = "sm" }: { color?: "green" | "amber" | "red"; size?: "sm" | "xs" }) {
  const base = { green: "bg-green-500", amber: "bg-amber-500", red: "bg-red-500" }[color];
  const ring = { green: "bg-green-400/30", amber: "bg-amber-400/30", red: "bg-red-400/30" }[color];
  const dim = size === "xs" ? "h-1.5 w-1.5" : "h-2 w-2";
  return (
    <span className="relative inline-flex">
      <motion.span
        className={cn("absolute inline-flex rounded-full", ring, size === "xs" ? "h-1.5 w-1.5" : "h-2 w-2")}
        animate={{ scale: [1, 2.2, 1], opacity: [0.6, 0, 0.6] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
      />
      <span className={cn("relative inline-flex rounded-full", base, dim)} />
    </span>
  );
}

// ── Outcome badge ─────────────────────────────────────────────────────────────

function OutcomeBadge({ outcome, sipCode }: { outcome: string | null; sipCode: number | null }) {
  if (outcome === "connected") return <Badge className="bg-green-500/15 text-green-500 border-green-500/20 text-xs">Connected</Badge>;
  if (sipCode) return <Badge className="bg-red-500/15 text-red-500 border-red-500/20 text-xs">SIP {sipCode}</Badge>;
  return <Badge className="bg-muted text-muted-foreground text-xs">Failed</Badge>;
}

// ── Route Decision Replay ─────────────────────────────────────────────────────

interface ReplayStep {
  label: string;
  detail: string;
  status: "info" | "success" | "error" | "warning";
}

function buildReplaySteps(t: RouteTrace): ReplayStep[] {
  const steps: ReplayStep[] = [];

  steps.push({
    label: "LCR Engine",
    detail: "Routing decision initiated — evaluating candidate carriers",
    status: "info",
  });

  // Candidate evaluation
  let candidates: string[] = [];
  if (t.candidateRoutes) {
    try {
      const parsed = JSON.parse(t.candidateRoutes);
      if (Array.isArray(parsed)) {
        candidates = parsed.map((c: any) => typeof c === "string" ? c : (c.name ?? c.carrierId ?? JSON.stringify(c)));
      }
    } catch { /* no-op */ }
  }
  if (candidates.length > 0) {
    steps.push({
      label: "Candidate Evaluation",
      detail: `${candidates.length} carrier${candidates.length === 1 ? "" : "s"} evaluated: ${candidates.slice(0, 4).join(", ")}${candidates.length > 4 ? " …" : ""}`,
      status: "info",
    });
  }

  // Carrier selection
  if (t.selectedCarrier) {
    steps.push({
      label: "Carrier Selected",
      detail: `${t.selectedCarrier}${t.decisionReason ? ` — ${t.decisionReason}` : ""}`,
      status: "info",
    });
  }

  // PDD step (if available)
  if (t.pddMs != null && t.pddMs > 0) {
    steps.push({
      label: "Post-Dial Delay",
      detail: `${t.pddMs.toFixed(0)} ms${t.pddMs > 5000 ? " ⚠ elevated" : ""}`,
      status: t.pddMs > 5000 ? "warning" : "info",
    });
  }

  // Outcome
  if (t.outcome === "connected") {
    steps.push({
      label: "Call Connected",
      detail: `Duration: ${t.durationSec != null && t.durationSec > 0 ? `${t.durationSec}s` : "—"}`,
      status: "success",
    });
  } else {
    const cat = t.failureCategory ? ` [${t.failureCategory}]` : "";
    steps.push({
      label: "Call Failed",
      detail: `SIP ${t.sipCode ?? "—"}${cat}`,
      status: "error",
    });
  }

  return steps;
}

const STEP_ICON: Record<string, React.ReactNode> = {
  info:    <div className="h-2 w-2 rounded-full bg-blue-400" />,
  success: <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />,
  error:   <XCircle className="h-3.5 w-3.5 text-red-400" />,
  warning: <AlertTriangle className="h-3.5 w-3.5 text-yellow-400" />,
};

const STEP_COLOR: Record<string, string> = {
  info:    "text-muted-foreground",
  success: "text-green-400",
  error:   "text-red-400",
  warning: "text-yellow-400",
};

function RouteDecisionReplay({ trace }: { trace: RouteTrace }) {
  const [playing, setPlaying] = useState(false);
  const [visibleCount, setVisibleCount] = useState(0);
  const steps = buildReplaySteps(trace);

  function play() {
    setPlaying(true);
    setVisibleCount(0);
    steps.forEach((_, i) => {
      setTimeout(() => setVisibleCount(i + 1), i * 320);
    });
    setTimeout(() => setPlaying(false), steps.length * 320 + 200);
  }

  return (
    <div className="mt-3 rounded-lg border border-violet-500/20 bg-violet-500/5 p-3">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-violet-400 flex items-center gap-1.5">
          <Sparkles className="h-3 w-3" /> Route Decision Replay
        </p>
        <button
          data-testid={`replay-btn-${trace.id}`}
          onClick={play}
          disabled={playing}
          className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-violet-500/30 bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 transition-colors disabled:opacity-50"
        >
          <Play className="h-2.5 w-2.5" />
          {playing ? "Replaying…" : "Replay"}
        </button>
      </div>
      <div className="space-y-0">
        {steps.map((step, i) => (
          <div key={i}>
            <motion.div
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: visibleCount > i ? 1 : 0.15, x: 0 }}
              transition={{ duration: 0.2 }}
              className="flex items-start gap-2.5"
            >
              <div className="flex flex-col items-center">
                <div className="mt-0.5">{STEP_ICON[step.status]}</div>
                {i < steps.length - 1 && <div className="w-px h-4 bg-border/40 mt-1" />}
              </div>
              <div className="flex-1 pb-2 min-w-0">
                <span className="text-[11px] font-semibold">{step.label}</span>
                <p className={cn("text-[10px] leading-snug mt-0.5", STEP_COLOR[step.status])}>{step.detail}</p>
              </div>
            </motion.div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Summary stat card with count-up ──────────────────────────────────────────

function StatCard({ label, numericValue, displayValue, icon: Icon, color }: {
  label: string;
  numericValue: number;
  displayValue: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}) {
  const counted = useCountUp(numericValue);
  const isFloat = displayValue.includes(".");
  return (
    <Card className="border-border/50">
      <CardContent className="pt-5 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <motion.p
              key={numericValue}
              initial={{ opacity: 0.4, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4 }}
              className={cn("text-2xl font-bold mt-0.5 tabular-nums", color)}
            >
              {displayValue === "—" ? "—" : isFloat ? displayValue : counted + (displayValue.replace(/[0-9.]/g, ""))}
            </motion.p>
          </div>
          <Icon className={cn("h-7 w-7 opacity-20", color)} />
        </div>
      </CardContent>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CarrierScoringPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [window24, setWindow24] = useState<24 | 168>(24);
  const [expandedCarrier, setExpandedCarrier] = useState<string | null>(null);
  const [expandedTrace, setExpandedTrace] = useState<number | null>(null);
  const [traceFilter, setTraceFilter] = useState<string>("");

  const { data: scores = [], isLoading: scoresLoading } = useQuery<CarrierScore[]>({
    queryKey: ["/api/carrier-scores", window24],
    queryFn: () => fetch(`/api/carrier-scores?window=${window24}`).then(r => r.json()),
    refetchInterval: 120_000,
  });

  const { data: traces = [], isLoading: tracesLoading } = useQuery<RouteTrace[]>({
    queryKey: ["/api/route-traces"],
    queryFn: () => fetch("/api/route-traces?limit=100").then(r => r.json()),
    refetchInterval: 60_000,
  });

  const [deltaOpen, setDeltaOpen] = useState(false);
  const { data: deltaData = [] } = useQuery<any[]>({
    queryKey: ["/api/carrier-scores/delta"],
    refetchInterval: 300_000,
    enabled: deltaOpen,
  });

  const recompute = useMutation({
    mutationFn: () => apiRequest("POST", "/api/carrier-scores/recompute"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/carrier-scores"] });
      toast({ title: "Carrier scores recomputed" });
    },
    onError: () => toast({ title: "Recompute failed", variant: "destructive" }),
  });

  const filteredTraces = traceFilter
    ? traces.filter(t =>
        t.selectedCarrier?.toLowerCase().includes(traceFilter.toLowerCase()) ||
        t.cld.includes(traceFilter) ||
        t.failureCategory?.toLowerCase().includes(traceFilter.toLowerCase())
      )
    : traces;

  const totalCalls   = traces.length;
  const connectedAll = traces.filter(t => t.outcome === "connected").length;
  const asrNum       = totalCalls > 0 ? (connectedAll / totalCalls) * 100 : 0;
  const overallAsr   = totalCalls > 0 ? asrNum.toFixed(1) : "—";
  const highPddCount = traces.filter(t => t.pddMs != null && t.pddMs > 5000).length;
  const failedCount  = traces.filter(t => t.outcome === "failed").length;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-indigo-400" />
            Carrier Quality Scoring
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-400 border border-violet-500/30 tracking-wide">New</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5 flex items-center gap-2">
            <LivePulse color="green" size="xs" />
            Animated scores, count-up metrics, route decision replay — updated in real time
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-border overflow-hidden text-sm">
            {([24, 168] as const).map(w => (
              <button
                key={w}
                data-testid={`window-${w}`}
                onClick={() => setWindow24(w)}
                className={cn("px-3 py-1.5 transition-colors", window24 === w ? "bg-indigo-500/20 text-indigo-400" : "text-muted-foreground hover:bg-muted/50")}
              >
                {w === 24 ? "24h" : "7d"}
              </button>
            ))}
          </div>
          <Button
            data-testid="btn-recompute"
            variant="outline"
            size="sm"
            onClick={() => recompute.mutate()}
            disabled={recompute.isPending}
            className="gap-1.5"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", recompute.isPending && "animate-spin")} />
            Recompute
          </Button>
        </div>
      </div>

      {/* Summary stats with count-up */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Overall ASR"      numericValue={asrNum}          displayValue={overallAsr === "—" ? "—" : `${overallAsr}%`} icon={Activity} color="text-green-400" />
        <StatCard label="High PDD (>5s)"   numericValue={highPddCount}    displayValue={String(highPddCount)}                         icon={Clock}     color="text-yellow-400" />
        <StatCard label="Failed Calls"     numericValue={failedCount}     displayValue={String(failedCount)}                          icon={XCircle}   color="text-red-400"    />
        <StatCard label="Carriers Scored"  numericValue={scores.length}   displayValue={String(scores.length)}                        icon={Wifi}      color="text-indigo-400" />
      </div>

      {/* Carrier Score Cards */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-indigo-400" />
            Carrier Rankings
            <span className="text-xs font-normal text-muted-foreground ml-1">
              — computed from synthetic test calls, window: {window24 === 24 ? "last 24h" : "last 7 days"}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {scoresLoading ? (
            <div className="space-y-3">
              {[1,2,3].map(i => <div key={i} className="h-16 bg-muted/20 rounded-lg animate-pulse" />)}
            </div>
          ) : scores.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">
              No carrier scores yet. Scores are computed 15s after startup and every 30 min thereafter.
            </div>
          ) : (
            <div className="space-y-3">
              <AnimatePresence initial={false}>
              {scores.map((s, i) => {
                const isExpanded = expandedCarrier === s.carrierId;
                const carrierTraces = traces.filter(t => t.selectedCarrier === s.carrierName).slice(0, 10);
                const pulseColor = (s.stabilityScore ?? 100) >= 70 ? "green" : (s.stabilityScore ?? 100) >= 45 ? "amber" : "red";
                return (
                  <motion.div
                    key={s.carrierId}
                    data-testid={`carrier-row-${s.id}`}
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, delay: i * 0.05 }}
                    className={cn("rounded-lg border transition-all", stabilityBg(s.stabilityScore))}
                  >
                    <div className="flex items-center gap-4 cursor-pointer p-4" onClick={() => setExpandedCarrier(isExpanded ? null : s.carrierId)}>
                      {/* Live pulse + rank */}
                      <div className="relative w-7 h-7 rounded-full bg-background/60 border border-border flex items-center justify-center text-xs font-semibold text-muted-foreground shrink-0">
                        {i + 1}
                        <span className="absolute -top-0.5 -right-0.5">
                          <LivePulse color={pulseColor} size="xs" />
                        </span>
                      </div>

                      {/* Name + trend */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">{s.carrierName}</span>
                          <TrendIcon trend={s.trend} />
                        </div>
                        <div className="text-xs text-muted-foreground">{s.sampleCount} calls sampled</div>
                      </div>

                      {/* Stability score with animated count-up */}
                      <div className="text-center shrink-0">
                        <motion.div
                          key={`score-${s.id}`}
                          initial={{ scale: 0.8, opacity: 0.4 }}
                          animate={{ scale: 1, opacity: 1 }}
                          transition={{ type: "spring", stiffness: 260, damping: 20 }}
                          className={cn("text-lg font-bold", stabilityColor(s.stabilityScore))}
                        >
                          {s.stabilityScore?.toFixed(0) ?? "—"}
                        </motion.div>
                        <div className="text-xs text-muted-foreground">stability</div>
                      </div>

                      {/* ASR */}
                      <div className="text-center shrink-0">
                        <div className="text-lg font-bold">{s.rollingAsr?.toFixed(1) ?? "—"}%</div>
                        <div className="text-xs text-muted-foreground">ASR</div>
                      </div>

                      {/* Avg PDD */}
                      <div className="text-center shrink-0">
                        <div className="text-base font-semibold">{s.avgPddMs != null ? `${s.avgPddMs.toFixed(0)}ms` : "—"}</div>
                        <div className="text-xs text-muted-foreground">avg PDD</div>
                      </div>

                      {/* Failure rate */}
                      <div className="text-center shrink-0">
                        <div className="text-base font-semibold">{s.failureRate != null ? `${s.failureRate.toFixed(1)}%` : "—"}</div>
                        <div className="text-xs text-muted-foreground">fail rate</div>
                      </div>

                      {/* Animated bar */}
                      <StabilityBar score={s.stabilityScore} />

                      {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
                    </div>

                    <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.22 }}
                        className="overflow-hidden border-t border-border/30"
                      >
                        <div className="p-4">
                          <div className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wide">Recent route decision traces</div>
                          {carrierTraces.length === 0 ? (
                            <div className="text-xs text-muted-foreground">No traces for this carrier yet</div>
                          ) : (
                            <div className="space-y-2">
                              {carrierTraces.map((t, ti) => (
                                <motion.div
                                  key={t.id}
                                  initial={{ opacity: 0, x: -4 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  transition={{ delay: ti * 0.04 }}
                                >
                                  <button
                                    data-testid={`carrier-trace-${t.id}`}
                                    onClick={() => setExpandedTrace(expandedTrace === t.id ? null : t.id)}
                                    className="w-full flex items-start gap-3 text-xs rounded-md bg-background/40 px-3 py-2 hover:bg-background/70 transition-colors text-left"
                                  >
                                    <OutcomeBadge outcome={t.outcome} sipCode={t.sipCode} />
                                    <div className="flex-1 min-w-0">
                                      <span className="font-mono text-muted-foreground">{t.cld}</span>
                                      {t.decisionReason && (
                                        <span className="text-muted-foreground/70 ml-2">— {t.decisionReason}</span>
                                      )}
                                    </div>
                                    {t.pddMs != null && t.pddMs > 0 && (
                                      <span className={cn("shrink-0", t.pddMs > 5000 ? "text-yellow-400" : "text-muted-foreground")}>
                                        {t.pddMs.toFixed(0)}ms
                                      </span>
                                    )}
                                    <span className="text-muted-foreground/60 shrink-0">{new Date(t.createdAt).toLocaleTimeString()}</span>
                                    <span className="text-muted-foreground/40">{expandedTrace === t.id ? "▲" : "▼"}</span>
                                  </button>
                                  <AnimatePresence>
                                  {expandedTrace === t.id && (
                                    <motion.div
                                      initial={{ height: 0, opacity: 0 }}
                                      animate={{ height: "auto", opacity: 1 }}
                                      exit={{ height: 0, opacity: 0 }}
                                      transition={{ duration: 0.18 }}
                                      className="overflow-hidden"
                                    >
                                      <RouteDecisionReplay trace={t} />
                                    </motion.div>
                                  )}
                                  </AnimatePresence>
                                </motion.div>
                              ))}
                            </div>
                          )}

                          {/* Metric sub-grid */}
                          <div className="grid grid-cols-3 gap-3 mt-4">
                            {[
                              { label: "Connected", value: s.connectedCount },
                              { label: "Failed",    value: s.failedCount    },
                            ].map(m => (
                              <div key={m.label} className="rounded-md bg-background/40 p-3 text-center">
                                <div className="text-lg font-bold">{m.value}</div>
                                <div className="text-xs text-muted-foreground">{m.label}</div>
                              </div>
                            ))}
                            <div className="rounded-md bg-background/40 p-3 text-center">
                              <div className="text-base font-bold">{s.p95PddMs != null ? `${s.p95PddMs.toFixed(0)}ms` : "—"}</div>
                              <div className="text-xs text-muted-foreground">P95 PDD</div>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
              </AnimatePresence>
            </div>
          )}
        </CardContent>
      </Card>

      {/* What Changed? Delta Panel */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <button
            data-testid="btn-delta-toggle"
            onClick={() => setDeltaOpen(v => !v)}
            className="flex items-center gap-2 w-full text-left"
          >
            <CardTitle className="text-base flex items-center gap-2">
              <ArrowUpDown className="h-4 w-4 text-violet-400" />
              What Changed?
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-400 border border-violet-500/30 tracking-wide">New</span>
              <span className="text-xs font-normal text-muted-foreground ml-1">— 24h vs 7d comparison per carrier</span>
            </CardTitle>
            <div className="flex-1" />
            {deltaOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </button>
        </CardHeader>
        <AnimatePresence>
          {deltaOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="overflow-hidden"
            >
              <CardContent>
                {deltaData.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    No delta data yet — scores require both 24h and 7d windows populated.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {/* Column headers */}
                    <div className="grid grid-cols-[1fr_repeat(4,minmax(80px,auto))] gap-3 px-2 text-[10px] uppercase tracking-widest text-muted-foreground/60 font-mono">
                      <span>Carrier</span>
                      <span className="text-center">Stability Δ</span>
                      <span className="text-center">ASR Δ</span>
                      <span className="text-center">PDD Δ</span>
                      <span className="text-center">Fail Rate Δ</span>
                    </div>
                    {deltaData.map((d: any) => {
                      function DeltaCell({ value, suffix = "", invert = false }: { value: number | null; suffix?: string; invert?: boolean }) {
                        if (value == null) return <span className="text-muted-foreground/40 text-xs text-center block">—</span>;
                        const improved = invert ? value < 0 : value > 0;
                        const degraded = invert ? value > 0 : value < 0;
                        const neutral  = Math.abs(value) < 0.5;
                        return (
                          <div className={cn("flex items-center justify-center gap-0.5 text-xs font-bold tabular-nums",
                            neutral  ? "text-muted-foreground"  :
                            improved ? "text-green-400"          : "text-red-400")}>
                            {!neutral && (improved
                              ? <MoveUp className="h-3 w-3" />
                              : <MoveDown className="h-3 w-3" />)}
                            {value > 0 ? "+" : ""}{value.toFixed(1)}{suffix}
                          </div>
                        );
                      }
                      return (
                        <motion.div
                          key={d.carrierId}
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="grid grid-cols-[1fr_repeat(4,minmax(80px,auto))] gap-3 items-center px-3 py-2.5 rounded-lg bg-muted/20 hover:bg-muted/30 transition-colors"
                        >
                          <div>
                            <p className="text-sm font-medium truncate">{d.carrierName}</p>
                            <p className="text-[10px] text-muted-foreground">
                              {d.stability24 != null ? `Now: ${d.stability24.toFixed(0)}` : "—"}
                              {d.stability168 != null ? ` / 7d avg: ${d.stability168.toFixed(0)}` : ""}
                            </p>
                          </div>
                          <DeltaCell value={d.stabilityDelta} />
                          <DeltaCell value={d.asrDelta} suffix="%" />
                          <DeltaCell value={d.pddDelta} suffix="ms" invert />
                          <DeltaCell value={d.failRateDelta} suffix="%" invert />
                        </motion.div>
                      );
                    })}
                    <p className="text-[10px] text-muted-foreground/50 text-right pt-1">
                      Δ = 24h window minus 7d window · green = improvement · red = degradation
                    </p>
                  </div>
                )}
              </CardContent>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>

      {/* Route Decision Trace Table */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-4">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4 text-violet-400" />
              Route Decision Traces
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-400 border border-violet-500/30 tracking-wide">New</span>
              <span className="text-xs font-normal text-muted-foreground ml-1">— last 100 synthetic calls · click row to replay</span>
            </CardTitle>
            <div className="flex items-center gap-2">
              <Filter className="h-3.5 w-3.5 text-muted-foreground" />
              <input
                data-testid="input-trace-filter"
                type="text"
                placeholder="Filter by carrier, CLD, failure…"
                value={traceFilter}
                onChange={e => setTraceFilter(e.target.value)}
                className="h-8 rounded-md border border-border bg-transparent px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring w-56"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {tracesLoading ? (
            <div className="space-y-2">
              {[1,2,3].map(i => <div key={i} className="h-10 bg-muted/20 rounded animate-pulse" />)}
            </div>
          ) : filteredTraces.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              No route traces yet. Traces are recorded automatically when scheduled test campaigns execute.
            </div>
          ) : (
            <div className="space-y-0.5">
              {filteredTraces.map((t, i) => {
                const isExpanded = expandedTrace === t.id;
                return (
                  <motion.div
                    key={t.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: Math.min(i * 0.015, 0.3) }}
                  >
                    <button
                      data-testid={`trace-row-${t.id}`}
                      onClick={() => setExpandedTrace(isExpanded ? null : t.id)}
                      className="w-full grid grid-cols-[auto_1fr_1fr_1fr_auto_auto_auto_auto] gap-3 items-center text-xs py-2.5 px-3 rounded-lg hover:bg-muted/30 transition-colors text-left border border-transparent hover:border-border/40"
                    >
                      <OutcomeBadge outcome={t.outcome} sipCode={t.sipCode} />
                      <span className="font-mono text-muted-foreground truncate">{t.cld}</span>
                      <span className="truncate">{t.selectedCarrier ?? <span className="text-muted-foreground/50">unknown</span>}</span>
                      <span className="text-muted-foreground truncate">{t.decisionReason ?? "—"}</span>
                      <span className={cn("tabular-nums", t.pddMs != null && t.pddMs > 5000 ? "text-yellow-400 font-medium" : "text-muted-foreground")}>
                        {t.pddMs != null && t.pddMs > 0 ? `${t.pddMs.toFixed(0)}ms` : "—"}
                      </span>
                      <span>
                        {t.failureCategory
                          ? <Badge variant="outline" className="text-xs">{t.failureCategory}</Badge>
                          : <span className="text-muted-foreground/40">—</span>}
                      </span>
                      <span className="text-muted-foreground/60 shrink-0">{new Date(t.createdAt).toLocaleTimeString()}</span>
                      <span className="text-muted-foreground/40 shrink-0">{isExpanded ? "▲" : "▼"}</span>
                    </button>
                    <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden px-3 pb-2"
                      >
                        <RouteDecisionReplay trace={t} />
                      </motion.div>
                    )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
