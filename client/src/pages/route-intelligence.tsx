import { useState, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  GitBranch, TrendingDown, TrendingUp, Minus, AlertTriangle,
  Shield, Activity, BrainCircuit, RefreshCw, ChevronRight,
  Zap, Network, CheckCircle2, ArrowRight, Eye, X, Sparkles,
  ChevronDown, ChevronUp, BarChart2, AlertCircle, Info, Pin,
  ShieldAlert, PlayCircle, Loader2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";

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

interface FraudSignals {
  fasCount: number;
  irsfCount: number;
  avgFraudScore: number | null;
}

interface AiRouteRecommendation {
  id: string;
  action: string;
  confidence: number;
  reasons: string[];
  risk: "low" | "medium" | "high";
  expectedImpact: string;
  aiInsight?: string;
  currentVendor?: string;
  targetVendor?: string;
  destination?: string;
  fraudSignals?: FraudSignals;
  simulate: {
    asrDelta: number | null;
    stabilityDelta: number | null;
    projectedAsr: number | null;
    projectedStability: number | null;
  };
}

interface CopilotResult {
  generatedAt: string;
  mode: "ai_enhanced" | "rule_based_preview";
  warning?: string;
  recommendations: AiRouteRecommendation[];
  summary: {
    totalCarriers: number;
    degradedCarriers: number;
    criticalCarriers: number;
    fraudAlertCarriers: number;
    topSignal: string;
    analysisNote: string;
  };
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

const RISK_CONFIG = {
  low:    { label: "Low Risk",    cls: "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30" },
  medium: { label: "Medium Risk", cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30" },
  high:   { label: "High Risk",   cls: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30" },
};

function ConfidenceBar({ value }: { value: number }) {
  const color = value >= 80 ? "bg-green-500" : value >= 65 ? "bg-amber-500" : "bg-slate-400";
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden flex-shrink-0">
        <motion.div
          className={cn("h-full rounded-full", color)}
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>
      <span className="font-mono text-xs tabular-nums font-semibold text-muted-foreground">{value}%</span>
    </div>
  );
}

// ── Apply Approval Modal ───────────────────────────────────────────────────────

function ApplyModal({
  rec,
  onConfirm,
  onCancel,
  isPending,
}: {
  rec: AiRouteRecommendation;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const risk = RISK_CONFIG[rec.risk];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={!isPending ? onCancel : undefined}
      />
      {/* Panel */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ duration: 0.18 }}
        className="relative z-10 w-full max-w-md rounded-2xl border border-violet-500/30 bg-card shadow-2xl overflow-hidden"
        data-testid="apply-modal"
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-violet-500/10 to-cyan-500/5 border-b border-violet-500/20 px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-violet-500/20 border border-violet-500/30 flex items-center justify-center flex-shrink-0">
              <PlayCircle className="h-3.5 w-3.5 text-violet-400" />
            </div>
            <div>
              <h3 className="font-bold text-sm">Apply Recommendation</h3>
              <p className="text-[11px] text-muted-foreground">Review and confirm the proposed routing change</p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3">
          {/* Action summary */}
          <div className="rounded-lg bg-muted/50 border border-border px-3.5 py-3">
            <p className="text-xs font-semibold text-foreground leading-snug">{rec.action}</p>
            {rec.destination && (
              <p className="text-[11px] text-muted-foreground mt-0.5 font-mono">Destination: {rec.destination}</p>
            )}
          </div>

          {/* Vendor swap */}
          {rec.currentVendor && rec.targetVendor && (
            <div className="flex items-center gap-2 text-xs px-1">
              <span className="font-mono text-red-400/90 font-medium">{rec.currentVendor}</span>
              <ArrowRight className="h-3 w-3 text-muted-foreground/40" />
              <span className="font-mono text-green-400/90 font-medium">{rec.targetVendor}</span>
            </div>
          )}

          {/* Meta row */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn("text-[10px] font-bold uppercase font-mono px-2 py-0.5 rounded border", risk.cls)}>
              {risk.label}
            </span>
            <span className="text-[10px] text-muted-foreground font-mono">
              Confidence: <span className="font-semibold text-foreground">{rec.confidence}%</span>
            </span>
          </div>

          {/* Expected impact */}
          <div className="flex items-start gap-2 text-xs rounded-lg bg-cyan-500/5 border border-cyan-500/15 px-3 py-2">
            <BarChart2 className="h-3.5 w-3.5 text-cyan-500 flex-shrink-0 mt-0.5" />
            <span className="text-muted-foreground">{rec.expectedImpact}</span>
          </div>

          {/* Dry-run notice */}
          <div className="flex items-start gap-2 text-[11px] text-amber-600 dark:text-amber-400 bg-amber-500/8 border border-amber-500/20 rounded-lg px-3 py-2">
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
            <span>
              Action will be recorded in the audit ledger. Live Sippy write-back only fires when the execution gate is open.
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 pb-4 flex items-center justify-end gap-2.5">
          <button
            data-testid="apply-modal-cancel"
            onClick={onCancel}
            disabled={isPending}
            className="text-sm font-medium px-4 py-2 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            data-testid="apply-modal-confirm"
            onClick={onConfirm}
            disabled={isPending}
            className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <PlayCircle className="h-3.5 w-3.5" />
            )}
            {isPending ? "Applying…" : "Confirm & Apply"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ── AI Recommendation Card ─────────────────────────────────────────────────────

function AiRecCard({
  rec,
  index,
  pinned,
  applied,
  canApply,
  onDismiss,
  onPin,
  onApply,
}: {
  rec: AiRouteRecommendation;
  index: number;
  pinned: boolean;
  applied: boolean;
  canApply: boolean;
  onDismiss: (id: string) => void;
  onPin: (id: string) => void;
  onApply: (rec: AiRouteRecommendation) => void;
}) {
  const [expanded, setExpanded]   = useState(false);
  const [simulate, setSimulate]   = useState(false);
  const risk = RISK_CONFIG[rec.risk];
  const hasFraud = rec.fraudSignals && (rec.fraudSignals.fasCount + rec.fraudSignals.irsfCount) > 0;
  const hasSimulate = rec.simulate.asrDelta != null || rec.simulate.stabilityDelta != null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20, height: 0 }}
      transition={{ delay: index * 0.04, duration: 0.25 }}
      data-testid={`ai-rec-card-${index}`}
      className={cn(
        "rounded-xl border bg-card overflow-hidden",
        pinned && "ring-2 ring-violet-500/40",
        rec.risk === "high"   ? "border-red-500/30" :
        rec.risk === "medium" ? "border-amber-500/20" : "border-border",
      )}
    >
      {/* Pinned banner */}
      {pinned && (
        <div className="bg-violet-500/10 border-b border-violet-500/20 px-4 py-1 flex items-center gap-1.5">
          <Pin className="h-3 w-3 text-violet-400" />
          <span className="text-[10px] font-semibold text-violet-400 uppercase tracking-wide">Pinned</span>
        </div>
      )}

      {/* Card body */}
      <div className="px-4 pt-3.5 pb-3">
        <div className="flex items-start justify-between gap-3">
          {/* Rank badge */}
          <div className="flex-shrink-0 w-7 h-7 rounded-full bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mt-0.5">
            <span className="text-xs font-black text-violet-500 font-mono">#{index + 1}</span>
          </div>

          <div className="flex-1 min-w-0">
            <p data-testid={`ai-rec-action-${index}`} className="font-semibold text-sm leading-snug">
              {rec.action}
            </p>
            {rec.destination && (
              <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                Destination: {rec.destination}
              </p>
            )}

            {/* Badges row */}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className={cn("text-[10px] font-bold uppercase font-mono px-2 py-0.5 rounded border", risk.cls)}>
                {risk.label}
              </span>
              {rec.currentVendor && rec.targetVendor && (
                <span className="text-[10px] font-mono text-muted-foreground flex items-center gap-1">
                  <span className="text-red-400/80">{rec.currentVendor}</span>
                  <ArrowRight className="h-2.5 w-2.5 opacity-40" />
                  <span className="text-green-400/90">{rec.targetVendor}</span>
                </span>
              )}
              {hasFraud && (
                <span className="flex items-center gap-1 text-[10px] font-mono text-red-400/80 bg-red-500/8 border border-red-500/20 px-1.5 py-0.5 rounded">
                  <ShieldAlert className="h-2.5 w-2.5" />
                  {rec.fraudSignals!.fasCount + rec.fraudSignals!.irsfCount} fraud signals
                </span>
              )}
              {applied && (
                <span
                  data-testid={`ai-rec-applied-badge-${index}`}
                  className="flex items-center gap-1 text-[10px] font-bold uppercase font-mono text-green-500 bg-green-500/10 border border-green-500/30 px-1.5 py-0.5 rounded"
                >
                  <CheckCircle2 className="h-2.5 w-2.5" />
                  Applied
                </span>
              )}
            </div>

            {/* Confidence */}
            <div className="mt-2.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 font-medium">Confidence</p>
              <ConfidenceBar value={rec.confidence} />
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-col gap-1.5 flex-shrink-0">
            {canApply && !applied && (
              <button
                data-testid={`ai-rec-apply-${index}`}
                onClick={() => onApply(rec)}
                title="Apply this recommendation"
                className="p-1.5 rounded-md text-violet-400/60 hover:text-violet-400 hover:bg-violet-500/15 transition-colors"
              >
                <PlayCircle className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              data-testid={`ai-rec-pin-${index}`}
              onClick={() => onPin(rec.id)}
              title={pinned ? "Unpin" : "Pin this recommendation"}
              className={cn(
                "p-1.5 rounded-md transition-colors",
                pinned
                  ? "text-violet-400 bg-violet-500/15 hover:bg-violet-500/25"
                  : "text-muted-foreground/40 hover:text-muted-foreground hover:bg-muted/30",
              )}
            >
              <Pin className="h-3.5 w-3.5" />
            </button>
            <button
              data-testid={`ai-rec-dismiss-${index}`}
              onClick={() => onDismiss(rec.id)}
              className="p-1.5 rounded-md text-muted-foreground/40 hover:text-muted-foreground hover:bg-muted/30 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Expected impact */}
        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2">
          <BarChart2 className="h-3.5 w-3.5 flex-shrink-0 text-cyan-500" />
          <span>{rec.expectedImpact}</span>
        </div>

        {/* AI insight line (only present in ai_enhanced mode) */}
        {rec.aiInsight && (
          <div
            data-testid={`ai-rec-insight-${index}`}
            className="mt-2 flex items-start gap-2 text-xs rounded-lg bg-violet-500/8 border border-violet-500/20 px-3 py-2"
          >
            <Sparkles className="h-3 w-3 flex-shrink-0 text-violet-400 mt-0.5" />
            <span>
              <span className="font-semibold text-violet-400 mr-1">AI:</span>
              <span className="text-muted-foreground">{rec.aiInsight}</span>
            </span>
          </div>
        )}

        {/* Per-card simulate toggle */}
        {hasSimulate && (
          <div className="mt-2">
            <button
              data-testid={`ai-rec-simulate-toggle-${index}`}
              onClick={() => setSimulate(p => !p)}
              className={cn(
                "flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-md border transition-colors w-full justify-center",
                simulate
                  ? "bg-violet-500/15 border-violet-500/30 text-violet-400"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              <Eye className="h-3 w-3" />
              {simulate ? "Hide Projected Impact" : "Simulate Impact"}
            </button>

            <AnimatePresence>
              {simulate && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="mt-2 rounded-lg bg-violet-500/5 border border-violet-500/15 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-violet-400 font-semibold mb-1.5 flex items-center gap-1">
                      <Sparkles className="h-3 w-3" /> Projected Impact (if applied)
                    </p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      {rec.simulate.asrDelta != null && (
                        <div>
                          <span className="text-muted-foreground">ASR Δ: </span>
                          <span className={cn("font-mono font-bold", rec.simulate.asrDelta >= 0 ? "text-green-400" : "text-red-400")}>
                            {rec.simulate.asrDelta >= 0 ? "+" : ""}{rec.simulate.asrDelta.toFixed(1)}%
                          </span>
                          {rec.simulate.projectedAsr != null && (
                            <span className="text-muted-foreground/60"> → {rec.simulate.projectedAsr.toFixed(1)}%</span>
                          )}
                        </div>
                      )}
                      {rec.simulate.stabilityDelta != null && (
                        <div>
                          <span className="text-muted-foreground">Stability Δ: </span>
                          <span className={cn("font-mono font-bold", rec.simulate.stabilityDelta >= 0 ? "text-green-400" : "text-red-400")}>
                            {rec.simulate.stabilityDelta >= 0 ? "+" : ""}{rec.simulate.stabilityDelta.toFixed(0)} pts
                          </span>
                          {rec.simulate.projectedStability != null && (
                            <span className="text-muted-foreground/60"> → {rec.simulate.projectedStability.toFixed(0)}/100</span>
                          )}
                        </div>
                      )}
                      {rec.fraudSignals && (rec.fraudSignals.fasCount + rec.fraudSignals.irsfCount) > 0 && (
                        <div className="col-span-2 mt-0.5 text-muted-foreground">
                          Fraud exposure: {rec.fraudSignals.fasCount} FAS + {rec.fraudSignals.irsfCount} IRSF events would be reduced
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Expandable reasoning */}
      <div className="border-t border-border/60">
        <button
          data-testid={`ai-rec-expand-${index}`}
          onClick={() => setExpanded(p => !p)}
          className="w-full flex items-center justify-between px-4 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/20 transition-colors"
        >
          <span className="font-medium">{expanded ? "Hide" : "Show"} reasoning ({rec.reasons.length} signals)</span>
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <ul className="px-4 pb-3 space-y-1.5">
                {rec.reasons.map((r, ri) => (
                  <li key={ri} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <span className="mt-1 w-1.5 h-1.5 rounded-full bg-violet-400/60 flex-shrink-0" />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// ── AI Copilot Panel ───────────────────────────────────────────────────────────

function AiCopilotPanel() {
  const [dismissed,    setDismissed]    = useState<Set<string>>(new Set());
  const [pinned,       setPinned]       = useState<Set<string>>(new Set());
  const [applied,      setApplied]      = useState<Set<string>>(new Set());
  const [hasRun,       setHasRun]       = useState(false);
  const [modalRec,     setModalRec]     = useState<AiRouteRecommendation | null>(null);
  const { toast } = useToast();
  const { isManagement } = useAuth();

  // Fetch the last cached result on mount so the page doesn't start blank
  const { data: cachedData } = useQuery<{ success: boolean; data: CopilotResult; cached: boolean }>({
    queryKey: ["/api/ai/route-copilot/cached"],
    retry: false,
    staleTime: 30 * 60 * 1000,
  });

  // Mark hasRun when cache loads a valid result (only once, before any fresh run)
  useEffect(() => {
    if (cachedData?.success && cachedData.data && !hasRun && !copilotMutation.data) {
      setHasRun(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cachedData]);

  const copilotMutation = useMutation<{ success: boolean; data: CopilotResult }, Error>({
    mutationFn: () => apiRequest("POST", "/api/ai/route-recommendations").then(r => r.json()),
    onSuccess: () => setHasRun(true),
    onError: (err) => {
      toast({ title: "Copilot error", description: err.message, variant: "destructive" });
    },
  });

  const applyMutation = useMutation<{ success: boolean; actionId: number; mode: string; status: string; sippyNote: string }, Error, AiRouteRecommendation>({
    mutationFn: (rec) =>
      apiRequest("POST", "/api/ai/route-copilot/apply", { recommendation: rec })
        .then(r => r.json())
        .then(data => {
          if (!data.success) throw new Error(data.error ?? "Apply failed");
          return data;
        }),
    onSuccess: (data, rec) => {
      setApplied(prev => new Set([...prev, rec.id]));
      setModalRec(null);
      queryClient.invalidateQueries({ queryKey: ["/api/ai/route-copilot/summary"] });
      toast({
        title: data.mode === "executed" ? "Routing action applied" : "Action recorded (dry-run)",
        description: data.sippyNote ?? `Action #${data.actionId} logged to audit ledger.`,
      });
    },
    onError: (err) => {
      toast({ title: "Apply failed", description: err.message, variant: "destructive" });
    },
  });

  // Fresh mutation result takes precedence over the cached pre-load
  const result  = copilotMutation.data?.data ?? (cachedData?.success ? cachedData.data : undefined);
  const isCachedResult = !copilotMutation.data && !!cachedData?.cached && !!result;
  const allRecs = result?.recommendations ?? [];

  // Pinned first, then by original rank, dismissed excluded
  const visible = [
    ...allRecs.filter(r => pinned.has(r.id) && !dismissed.has(r.id)),
    ...allRecs.filter(r => !pinned.has(r.id) && !dismissed.has(r.id)),
  ];

  const handleDismiss = useCallback((id: string) => {
    setDismissed(prev => new Set([...prev, id]));
    setPinned(prev => { const n = new Set(prev); n.delete(id); return n; });
  }, []);

  const handlePin = useCallback((id: string) => {
    setPinned(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }, []);

  const handleApply = useCallback((rec: AiRouteRecommendation) => {
    setModalRec(rec);
  }, []);

  return (
    <div className="space-y-4">
      {/* Header panel */}
      <div className="rounded-xl border bg-gradient-to-br from-violet-500/5 via-card to-cyan-500/5 border-violet-500/20 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
                <Sparkles className="h-4 w-4 text-violet-400" />
              </div>
              <div>
                <h2 className="font-bold text-sm">AI Route Copilot</h2>
                <p className="text-xs text-muted-foreground">
                  Analyses carrier stability, fraud signals, Q-Scores & ASR telemetry
                </p>
              </div>
            </div>

            {result && (
              <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="mt-3 space-y-1">
                <p className="text-sm font-medium text-foreground/90">{result.summary.topSignal}</p>
                <p className="text-xs text-muted-foreground">{result.summary.analysisNote}</p>
                <div className="flex items-center gap-2 mt-1">
                  {result.mode === "ai_enhanced" ? (
                    <span className="text-[10px] font-bold uppercase tracking-wide text-violet-400 bg-violet-500/10 border border-violet-500/20 px-1.5 py-0.5 rounded">
                      AI Enhanced
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold uppercase tracking-wide text-amber-500 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded">
                      Rule-Based Preview
                    </span>
                  )}
                  {isCachedResult ? (() => {
                    const ageMs = Date.now() - new Date(result.generatedAt).getTime();
                    const ageMin = Math.floor(ageMs / 60000);
                    const ageLabel = ageMin < 1 ? "just now" : `${ageMin} min ago`;
                    const isStale = ageMin >= 20;
                    return (
                      <>
                        <span className="text-[10px] text-muted-foreground/50 font-mono">
                          {ageLabel}
                        </span>
                        <span className="text-[10px] font-medium text-sky-500 bg-sky-500/10 border border-sky-500/20 px-1.5 py-0.5 rounded">
                          from cache
                        </span>
                        {isStale && (
                          <span className="text-[10px] font-medium text-amber-500 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded">
                            may be stale
                          </span>
                        )}
                      </>
                    );
                  })() : (
                    <span className="text-[10px] text-muted-foreground/50 font-mono">
                      {new Date(result.generatedAt).toLocaleTimeString()}
                    </span>
                  )}
                </div>
              </motion.div>
            )}
          </div>

          <div className="flex flex-col items-end gap-2 flex-shrink-0">
            <Button
              data-testid="copilot-analyse-btn"
              size="sm"
              disabled={copilotMutation.isPending}
              onClick={() => copilotMutation.mutate()}
              className="gap-1.5 bg-violet-600 hover:bg-violet-700 text-white border-0"
            >
              {copilotMutation.isPending
                ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                : <Sparkles className="h-3.5 w-3.5" />}
              {copilotMutation.isPending ? "Analysing…" : hasRun ? "Re-analyse" : "Analyse Routes"}
            </Button>
          </div>
        </div>

        {/* Warning banner (rule-based preview mode) */}
        {result?.warning && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-3 flex items-start gap-2 text-xs rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-amber-700 dark:text-amber-400"
          >
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
            <span>{result.warning}</span>
          </motion.div>
        )}

        {/* Summary stats */}
        {result && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="grid grid-cols-4 gap-3 mt-4 pt-4 border-t border-violet-500/10"
          >
            {[
              { label: "Carriers",  value: result.summary.totalCarriers,       color: "text-foreground" },
              { label: "Degraded",  value: result.summary.degradedCarriers,    color: result.summary.degradedCarriers  > 0 ? "text-amber-500" : "text-green-500" },
              { label: "Critical",  value: result.summary.criticalCarriers,    color: result.summary.criticalCarriers  > 0 ? "text-red-500"   : "text-green-500" },
              { label: "Fraud Flags", value: result.summary.fraudAlertCarriers, color: result.summary.fraudAlertCarriers > 0 ? "text-red-400"   : "text-green-500" },
            ].map(({ label, value, color }) => (
              <div key={label} className="text-center">
                <p className={cn("text-2xl font-black tabular-nums font-mono", color)}>{value}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">{label}</p>
              </div>
            ))}
          </motion.div>
        )}
      </div>

      {/* Loading skeleton */}
      {copilotMutation.isPending && (
        <div className="space-y-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="rounded-xl border bg-card p-4 animate-pulse">
              <div className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-full bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-muted rounded w-3/4" />
                  <div className="h-3 bg-muted rounded w-1/2" />
                  <div className="h-2 bg-muted rounded w-1/3" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Error (includes 502 from AI contract failures) */}
      {copilotMutation.isError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-sm text-red-600 dark:text-red-400">Analysis failed</p>
            <p className="text-xs text-muted-foreground mt-0.5">{copilotMutation.error.message}</p>
          </div>
        </div>
      )}

      {/* Pre-run state */}
      {!hasRun && !copilotMutation.isPending && (
        <div className="rounded-xl border bg-card flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Sparkles className="h-10 w-10 mb-3 opacity-20" />
          <p className="text-sm font-medium">Ready to analyse your routes</p>
          <p className="text-xs mt-1 opacity-60">Click "Analyse Routes" to generate recommendations</p>
          <p className="text-xs mt-3 opacity-40 max-w-xs text-center">
            Uses carrier scores, fraud signals, Q-Score, ASR/ACD telemetry, and degradation indicators
          </p>
        </div>
      )}

      {/* Recommendations list */}
      {hasRun && !copilotMutation.isPending && visible.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground font-medium">
              {visible.length} recommendation{visible.length !== 1 ? "s" : ""}
              {pinned.size > 0 ? `, ${pinned.size} pinned` : ""}
              {applied.size > 0 ? ` · ${applied.size} applied` : ""}
              {dismissed.size > 0 ? ` · ${dismissed.size} dismissed` : ""}
            </p>
            {dismissed.size > 0 && (
              <button
                onClick={() => setDismissed(new Set())}
                className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
              >
                Restore dismissed
              </button>
            )}
          </div>
          <AnimatePresence>
            {visible.map((rec, i) => (
              <AiRecCard
                key={rec.id}
                rec={rec}
                index={i}
                pinned={pinned.has(rec.id)}
                applied={applied.has(rec.id)}
                canApply={isManagement}
                onDismiss={handleDismiss}
                onPin={handlePin}
                onApply={handleApply}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Empty after run */}
      {hasRun && !copilotMutation.isPending && result && visible.length === 0 && (
        <div className="rounded-xl border bg-card flex flex-col items-center justify-center py-12 text-muted-foreground">
          <CheckCircle2 className="h-8 w-8 mb-2 text-green-500/40" />
          <p className="text-sm">No route changes recommended</p>
          <p className="text-xs mt-1 opacity-60">
            {result.summary.totalCarriers > 0
              ? "All carriers performing within acceptable range"
              : "No carrier data available — recompute scores first"}
          </p>
        </div>
      )}

      {/* Phase 2 notice */}
      {hasRun && (
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground/50 px-1">
          <Info className="h-3 w-3 flex-shrink-0" />
          <span>
            {isManagement
              ? "Phase 2 — Apply recommendations via the ▶ button. Actions are logged to the audit ledger; live Sippy write-back requires the execution gate."
              : "Phase 2 — Apply actions available to admin/management roles only."}
          </span>
        </div>
      )}

      {/* Apply approval modal */}
      <AnimatePresence>
        {modalRec && (
          <ApplyModal
            rec={modalRec}
            isPending={applyMutation.isPending}
            onConfirm={() => applyMutation.mutate(modalRec)}
            onCancel={() => !applyMutation.isPending && setModalRec(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

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
  { key: "copilot",     label: "AI Copilot",         icon: Sparkles    },
  { key: "recs",        label: "Account Recs",       icon: BrainCircuit },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function RouteIntelligencePage() {
  const initialTab = new URLSearchParams(window.location.search).get("tab") ?? "overview";
  const [activeTab, setActiveTab] = useState(initialTab);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    if (tab) setActiveTab(tab);
  }, []);

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

  const healthy  = scores.filter(s => getHealthTier(s) === "healthy");
  const degraded = scores.filter(s => getHealthTier(s) === "degraded");
  const critical = scores.filter(s => getHealthTier(s) === "critical");
  const avgAsr   = scores.filter(s => s.rollingAsr != null).reduce((a, s, _, arr) => a + s.rollingAsr! / arr.length, 0);
  const avgPdd   = scores.filter(s => s.avgPddMs != null).reduce((a, s, _, arr) => a + s.avgPddMs! / arr.length, 0);

  const degradedPlusCritical = [...critical, ...degraded].sort((a, b) => (a.stabilityScore ?? 0) - (b.stabilityScore ?? 0));
  const activeRecs  = recommendations.filter(r => !dismissed.has(r.accountId));
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
            Carrier stability, degradation detection, and AI-powered route recommendations
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
        <SummaryCard label="Healthy"  value={healthy.length}  sub={`${scores.length} total`} color="text-green-600 dark:text-green-400"  icon={CheckCircle2} />
        <SummaryCard label="Degraded" value={degraded.length} sub="stability 45–70"          color="text-amber-600 dark:text-amber-400"  icon={AlertTriangle} />
        <SummaryCard label="Critical" value={critical.length} sub="stability < 45"           color="text-red-600 dark:text-red-400"      icon={Zap} />
        <SummaryCard
          label="Avg ASR"
          value={scores.length ? `${avgAsr.toFixed(1)}%` : "—"}
          sub={scores.length ? `Avg PDD ${avgPdd.toFixed(0)}ms` : "no data"}
          color={avgAsr < 40 ? "text-red-600 dark:text-red-400" : avgAsr < 60 ? "text-amber-600 dark:text-amber-400" : "text-green-600 dark:text-green-400"}
          icon={Activity}
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 dark:bg-slate-900 p-1 rounded-lg w-fit flex-wrap">
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
              tab.key === "copilot" && activeTab !== "copilot" && "text-violet-500 hover:text-violet-600",
            )}
          >
            <tab.icon className={cn("h-3.5 w-3.5", tab.key === "copilot" && "text-violet-400")} />
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
                      <th key={h} className="px-4 py-2.5 text-left text-[11px] uppercase tracking-wide text-muted-foreground font-medium">{h}</th>
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
                        <td className="px-4 py-2.5"><StatCell value={s.rollingAsr} unit="%" warn={50} crit={30} /></td>
                        <td className="px-4 py-2.5"><StatCell value={s.failureRate} unit="%" /></td>
                        <td className="px-4 py-2.5">
                          <span className={cn("font-mono tabular-nums font-semibold", (s.avgPddMs ?? 0) > 500 ? "text-amber-500" : "text-foreground")}>
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
                            <span className="font-mono text-xs tabular-nums font-semibold">{s.stabilityScore?.toFixed(0) ?? "—"}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground tabular-nums">{s.sampleCount.toLocaleString()}</td>
                        <td className="px-4 py-2.5"><TrendIcon trend={s.trend} /></td>
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
                className={cn("rounded-lg border p-4", tier === "critical" ? "bg-red-500/5 border-red-500/20" : "bg-amber-500/5 border-amber-500/20")}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className={cn("w-3 h-3 rounded-full mt-1 flex-shrink-0", cfg.dot)} />
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold">{s.carrierName}</p>
                        <span className={cn("text-[10px] font-bold uppercase font-mono px-1.5 py-0.5 rounded border", cfg.badge)}>{cfg.label}</span>
                      </div>
                      <div className="flex gap-4 mt-2 text-sm">
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Stability</p>
                          <p className={cn("font-mono font-bold", cfg.badge.split(" ")[1])}>{s.stabilityScore?.toFixed(0) ?? "—"}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">ASR</p>
                          <p className="font-mono font-bold">{s.rollingAsr != null ? `${s.rollingAsr.toFixed(1)}%` : "—"}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Fail Rate</p>
                          <p className="font-mono font-bold">{s.failureRate != null ? `${s.failureRate.toFixed(1)}%` : "—"}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Avg PDD</p>
                          <p className="font-mono font-bold">{s.avgPddMs != null ? `${s.avgPddMs.toFixed(0)}ms` : "—"}</p>
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
                      Below critical stability threshold — consider rerouting traffic immediately.
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
              <p className="text-xs text-muted-foreground mt-0.5">ASR, PDD, and stability over the last 24 hours</p>
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
                        <th key={h} className="px-4 py-2 text-left text-[11px] uppercase tracking-wide text-muted-foreground font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...scores].sort((a, b) => (b.rollingAsr ?? 0) - (a.rollingAsr ?? 0)).map((s, i) => {
                      const asr   = s.rollingAsr ?? 0;
                      const qBand = asr >= 65 ? "A" : asr >= 50 ? "B" : asr >= 35 ? "C" : "D";
                      const qColor = { A: "text-green-500", B: "text-blue-500", C: "text-amber-500", D: "text-red-500" }[qBand];
                      return (
                        <tr key={s.carrierId} data-testid={`qos-row-${s.carrierId}`} className="border-b border-slate-100 dark:border-slate-800 hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-2.5 font-medium">{s.carrierName}</td>
                          <td className="px-4 py-2.5"><StatCell value={s.rollingAsr} unit="%" warn={50} crit={30} /></td>
                          <td className="px-4 py-2.5"><StatCell value={s.failureRate} unit="%" /></td>
                          <td className="px-4 py-2.5">
                            <span className={cn("font-mono tabular-nums font-semibold", (s.avgPddMs ?? 0) > 500 ? "text-amber-500" : (s.avgPddMs ?? 0) > 350 ? "text-yellow-500" : "text-foreground")}>
                              {s.avgPddMs != null ? `${s.avgPddMs.toFixed(0)}ms` : "—"}
                            </span>
                          </td>
                          <td className="px-4 py-2.5"><span className={cn("text-xl font-black tabular-nums", qColor)}>{s.sampleCount < 5 ? "—" : qBand}</span></td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <div className="w-16 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                                <motion.div
                                  className={cn("h-full rounded-full", getHealthTier(s) === "healthy" ? "bg-green-500" : getHealthTier(s) === "degraded" ? "bg-amber-500" : "bg-red-500")}
                                  style={{ width: `${Math.min(s.stabilityScore ?? 0, 100)}%` }}
                                />
                              </div>
                              <span className="font-mono text-xs tabular-nums">{s.stabilityScore?.toFixed(0) ?? "—"}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5"><TrendIcon trend={s.trend} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* QoS Band Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            {["A", "B", "C", "D"].map(band => {
              const ranges = { A: [65, 100], B: [50, 65], C: [35, 50], D: [0, 35] }[band]!;
              const cnt = scores.filter(s => { const a = s.rollingAsr ?? 0; return a >= ranges[0] && a < ranges[1] && s.sampleCount >= 5; }).length;
              const colors = { A: "text-green-600 dark:text-green-400 bg-green-500/10 border-green-500/20", B: "text-blue-600 dark:text-blue-400 bg-blue-500/10 border-blue-500/20", C: "text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/20", D: "text-red-600 dark:text-red-400 bg-red-500/10 border-red-500/20" }[band];
              return (
                <div key={band} className={cn("rounded-lg border p-4", colors)}>
                  <p className="text-3xl font-black">{cnt}</p>
                  <p className="text-xs font-bold uppercase tracking-wide mt-1">Band {band}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">ASR {ranges[0]}–{ranges[1]}%</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── AI Copilot Tab ── */}
      {activeTab === "copilot" && <AiCopilotPanel />}

      {/* ── Account Recommendations Tab ── */}
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
                      {rec.action && <p className="text-sm text-muted-foreground mt-1">{rec.action}</p>}
                      {rec.dominantSignal && (
                        <p className="text-xs text-muted-foreground/60 mt-1 font-mono">Signal: {rec.dominantSignal.replace(/_/g, " ")}</p>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="ghost" size="sm"
                    className="h-7 text-xs flex-shrink-0"
                    data-testid={`ri-rec-dismiss-${i}`}
                    onClick={() => setDismissed(prev => new Set([...prev, rec.accountId]))}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
