import { useState, useCallback, useEffect, useRef, Fragment } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  GitBranch, TrendingDown, TrendingUp, Minus, AlertTriangle,
  Shield, Activity, BrainCircuit, RefreshCw, ChevronRight,
  Zap, Network, CheckCircle2, ArrowRight, Eye, X, Sparkles,
  ChevronDown, ChevronUp, BarChart2, AlertCircle, Info, Pin,
  ShieldAlert, PlayCircle, Loader2, RotateCcw, History, Clock,
  UserCheck, ShieldCheck, XCircle, Filter, ThumbsDown, Search,
  Download, CalendarDays, Bell, TimerOff, Radio, Waves, LayoutGrid,
  Database, BarChart3, ChevronUp as ChevUp, SlidersHorizontal,
  Settings, Save, LineChart as LineChartIcon, Layers,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  Tooltip, ResponsiveContainer, ReferenceLine, Legend, ComposedChart, Bar, Line, LineChart,
} from "recharts";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useNocWebSocket } from "@/hooks/use-noc-ws";

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

type ActionCategory = 'TRAFFIC_SHIFT' | 'VENDOR_QUARANTINE' | 'ROUTE_OPTIMISATION' | 'FRAUD_ALERT';

interface AiRouteRecommendation {
  id: string;
  action: string;
  confidence: number;
  reasons: string[];
  risk: "low" | "medium" | "high";
  expectedImpact: string;
  actionCategory?: ActionCategory;
  aiInsight?: string;
  currentVendor?: string;
  targetVendor?: string;
  destination?: string;
  autoTriggered?: boolean;
  fraudSignals?: FraudSignals;
  healthScoreEvidence?: {
    overallScore: number;
    trend: string;
    trendDelta: number;
    qualityScore: number;
    reliabilityScore: number;
    fraudScore: number;
    marginScore: number;
  };
  simulate: {
    asrDelta: number | null;
    stabilityDelta: number | null;
    projectedAsr: number | null;
    projectedStability: number | null;
  };
  sipErrorTrend?: {
    code: number;
    label: string;
    vendorName: string;
    rates: { min5: number; min15: number; min60: number };
  };
  likelyCause?: string;
  expectedAsrImpact?: string;
}

type CopilotMode = "ai_enhanced" | "rule_based_preview";

interface CopilotResult {
  generatedAt: string;
  mode: "ai_enhanced" | "rule_based_preview";
  warning?: string;
  autoTriggered?: boolean;
  triggerReason?: string;
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

const CATEGORY_CONFIG: Record<ActionCategory, { label: string; cls: string }> = {
  TRAFFIC_SHIFT:      { label: "Traffic Shift",      cls: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30" },
  VENDOR_QUARANTINE:  { label: "Vendor Quarantine",  cls: "bg-red-600/10 text-red-700 dark:text-red-400 border-red-600/30" },
  ROUTE_OPTIMISATION: { label: "Route Optimisation", cls: "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/30" },
  FRAUD_ALERT:        { label: "Fraud Alert",         cls: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/30" },
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

// ── SIP Cell Sparkline (mini rate trajectory: 5min→15min→1hr) ──────────────────

function SipCellSparkline({ rates, code, label }: {
  rates: { min5: number; min15: number; min60: number };
  code: number;
  label: string;
}) {
  const vals = [rates.min5, rates.min15, rates.min60];
  const maxVal = Math.max(...vals, 1);
  const W = 52;
  const H = 18;
  const pts = vals.map((v, i) => ({
    x: (i / (vals.length - 1)) * W,
    y: H - (v / maxVal) * (H - 2) - 1,
  }));
  const color = rates.min15 >= 10 ? "#ef4444" : rates.min15 >= 2 ? "#f59e0b" : "#22c55e";
  const pathD = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const codeColor = code === 503
    ? "text-red-500 bg-red-500/10 border-red-500/25"
    : code === 404
    ? "text-blue-500 bg-blue-500/10 border-blue-500/25"
    : code === 480
    ? "text-orange-500 bg-orange-500/10 border-orange-500/25"
    : "text-purple-500 bg-purple-500/10 border-purple-500/25";

  return (
    <div className="flex items-center gap-2 mt-1.5 pl-0.5" data-testid="sip-error-sparkline">
      <span className={cn("text-[9px] font-bold font-mono px-1.5 py-0.5 rounded border flex-shrink-0", codeColor)}>
        {label}
      </span>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="flex-shrink-0">
        <path d={pathD} stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="2" fill={color} />
        ))}
      </svg>
      <div className="flex items-center gap-1 text-[9px] font-mono text-muted-foreground">
        <span title="5-min rate" className={cn(rates.min5 >= 10 ? "text-red-500" : rates.min5 >= 2 ? "text-amber-500" : "text-green-500")}>
          {rates.min5.toFixed(1)}%
        </span>
        <span className="opacity-40">→</span>
        <span title="15-min rate" className={cn(rates.min15 >= 10 ? "text-red-500" : rates.min15 >= 2 ? "text-amber-500" : "text-green-500")}>
          {rates.min15.toFixed(1)}%
        </span>
        <span className="opacity-40">→</span>
        <span title="1-hr rate" className={cn(rates.min60 >= 10 ? "text-red-500" : rates.min60 >= 2 ? "text-amber-500" : "text-green-500")}>
          {rates.min60.toFixed(1)}%
        </span>
      </div>
    </div>
  );
}

// ── Apply Approval Modal ───────────────────────────────────────────────────────

function SourceModeBadge({ mode }: { mode: CopilotMode }) {
  if (mode === "ai_enhanced") {
    return (
      <span
        data-testid="source-mode-badge-ai"
        className="flex items-center gap-1 text-[10px] font-bold uppercase font-mono px-2 py-0.5 rounded border bg-violet-500/10 text-violet-400 border-violet-500/30"
      >
        <Sparkles className="h-2.5 w-2.5" />
        AI
      </span>
    );
  }
  return (
    <span
      data-testid="source-mode-badge-rules"
      className="flex items-center gap-1 text-[10px] font-bold uppercase font-mono px-2 py-0.5 rounded border bg-amber-500/10 text-amber-500 border-amber-500/30"
    >
      <Network className="h-2.5 w-2.5" />
      Rules
    </span>
  );
}

function ApplyModal({
  rec,
  mode,
  onConfirm,
  onCancel,
  isPending,
  executionEnabled,
}: {
  rec: AiRouteRecommendation;
  mode: CopilotMode;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
  executionEnabled: boolean;
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
            <SourceModeBadge mode={mode} />
            <span className="text-[10px] text-muted-foreground font-mono">
              Confidence: <span className="font-semibold text-foreground">{rec.confidence}%</span>
            </span>
          </div>

          {/* Expected impact */}
          <div className="flex items-start gap-2 text-xs rounded-lg bg-cyan-500/5 border border-cyan-500/15 px-3 py-2">
            <BarChart2 className="h-3.5 w-3.5 text-cyan-500 flex-shrink-0 mt-0.5" />
            <span className="text-muted-foreground">{rec.expectedImpact}</span>
          </div>

          {/* Execution mode notice */}
          {executionEnabled && rec.risk === "high" ? (
            <div className="flex items-start gap-2 text-[11px] text-orange-600 dark:text-orange-400 bg-orange-500/8 border border-orange-500/20 rounded-lg px-3 py-2">
              <Clock className="h-3.5 w-3.5 flex-shrink-0 mt-0.5 text-orange-500" />
              <span>
                <span className="font-bold">Two-person rule:</span> This high-risk action will be queued for a second management-role operator to approve before writing to Sippy.
              </span>
            </div>
          ) : executionEnabled ? (
            <div className="flex items-center gap-2 text-[11px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/8 border border-emerald-500/20 rounded-lg px-3 py-2">
              <span className="font-bold uppercase tracking-widest text-[10px] bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 px-1.5 py-0.5 rounded font-mono flex-shrink-0">LIVE</span>
              <span>Execution gate is open. This action will write directly to Sippy and be confirmed by post-write re-read.</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-[11px] text-amber-600 dark:text-amber-400 bg-amber-500/8 border border-amber-500/20 rounded-lg px-3 py-2">
              <span className="font-bold uppercase tracking-widest text-[10px] bg-amber-500/20 border border-amber-500/30 text-amber-400 px-1.5 py-0.5 rounded font-mono flex-shrink-0">DRY-RUN</span>
              <span>Action recorded in audit ledger only. Set <code className="font-mono">C2_EXECUTION_ENABLED=true</code> to enable live writes.</span>
            </div>
          )}
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

// ── Undo / Rollback Modal ──────────────────────────────────────────────────────

function UndoModal({
  summary,
  onConfirm,
  onCancel,
  isPending,
}: {
  summary: UndoSummary;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [reason, setReason] = useState("");

  const formattedDate = summary.appliedAt
    ? new Date(summary.appliedAt).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={!isPending ? onCancel : undefined}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ duration: 0.18 }}
        className="relative z-10 w-full max-w-sm rounded-2xl border border-orange-500/30 bg-card shadow-2xl overflow-hidden"
        data-testid="undo-modal"
      >
        <div className="bg-gradient-to-r from-orange-500/10 to-red-500/5 border-b border-orange-500/20 px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-orange-500/20 border border-orange-500/30 flex items-center justify-center flex-shrink-0">
              <RotateCcw className="h-3.5 w-3.5 text-orange-400" />
            </div>
            <div>
              <h3 className="font-bold text-sm">Roll Back Action</h3>
              <p className="text-[11px] text-muted-foreground">This will reverse the live Sippy change</p>
            </div>
          </div>
        </div>

        {/* Action summary — prefilled from the original applied recommendation */}
        <div
          data-testid="undo-modal-summary"
          className="mx-5 mt-4 rounded-lg border border-orange-500/20 bg-orange-500/5 px-4 py-3 space-y-1.5"
        >
          <p className="text-[10px] uppercase tracking-wide font-semibold text-orange-400/80 mb-2">
            Action being reversed
          </p>
          <div className="flex items-start gap-2">
            <ArrowRight className="h-3 w-3 text-muted-foreground flex-shrink-0 mt-0.5" />
            <p
              data-testid="undo-modal-action-label"
              className="text-xs font-medium text-foreground leading-snug"
            >
              {summary.actionLabel}
            </p>
          </div>
          {(summary.currentVendor || summary.targetVendor) && (
            <div className="flex items-center gap-1.5 pl-5 text-[11px] font-mono text-muted-foreground">
              {summary.currentVendor && (
                <span className="text-red-400/80">{summary.currentVendor}</span>
              )}
              {summary.currentVendor && summary.targetVendor && (
                <ArrowRight className="h-2.5 w-2.5 opacity-40 flex-shrink-0" />
              )}
              {summary.targetVendor && (
                <span className="text-green-400/90">{summary.targetVendor}</span>
              )}
            </div>
          )}
          {summary.destination && (
            <p className="pl-5 text-[11px] font-mono text-muted-foreground">
              Destination: {summary.destination}
            </p>
          )}
          {formattedDate && (
            <div className="flex items-center gap-1.5 pl-5 text-[11px] text-muted-foreground/70">
              <Clock className="h-3 w-3 flex-shrink-0" />
              <span data-testid="undo-modal-applied-date">Applied {formattedDate}</span>
            </div>
          )}
        </div>

        {summary.noOriginalPlanWarning && (
          <div className="mx-5 mt-0 mb-0 flex items-start gap-2 text-[11px] text-amber-600 dark:text-amber-400 bg-amber-500/8 border border-amber-500/25 rounded-lg px-3 py-2.5">
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5 text-amber-500" />
            <span>
              <span className="font-bold">Original routing plan not recorded —</span> this action was applied before automatic capture was in place. Manual restore in Sippy may be required.
            </span>
          </div>
        )}

        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="text-xs font-semibold text-foreground mb-1.5 block">
              Reason <span className="text-muted-foreground font-normal">(optional but encouraged)</span>
            </label>
            <textarea
              data-testid="undo-reason-input"
              className="w-full text-sm rounded-lg border border-border bg-muted/40 px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-orange-500/50 placeholder:text-muted-foreground/50"
              rows={3}
              placeholder='e.g. "Wrong account", "Test only", "Reverting per incident report"'
              value={reason}
              onChange={e => setReason(e.target.value)}
              disabled={isPending}
            />
          </div>
          <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
            The reason will be stored in the audit trail and ledger note for this rollback entry.
          </p>
        </div>

        <div className="px-5 pb-4 flex items-center justify-end gap-2.5">
          <button
            data-testid="undo-modal-cancel"
            onClick={onCancel}
            disabled={isPending}
            className="text-sm font-medium px-4 py-2 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            data-testid="undo-modal-confirm"
            onClick={() => onConfirm(reason)}
            disabled={isPending}
            className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-700 text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" />
            )}
            {isPending ? "Rolling back…" : "Confirm Rollback"}
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
  appliedActionId,
  canUndo,
  canApply,
  appliedAt,
  hasOriginalPlanId,
  mode,
  onDismiss,
  onPin,
  onApply,
  onUndo,
}: {
  rec: AiRouteRecommendation;
  index: number;
  pinned: boolean;
  applied: boolean;
  appliedActionId?: number;
  canUndo: boolean;
  canApply: boolean;
  appliedAt?: string;
  hasOriginalPlanId?: boolean | null;
  mode: CopilotMode;
  onDismiss: (id: string) => void;
  onPin: (id: string) => void;
  onApply: (rec: AiRouteRecommendation) => void;
  onUndo: (recId: string, actionId: number, summary: UndoSummary) => void;
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
              {rec.actionCategory && CATEGORY_CONFIG[rec.actionCategory] && (
                <span
                  data-testid={`ai-rec-category-badge-${index}`}
                  className={cn("text-[10px] font-bold uppercase font-mono px-2 py-0.5 rounded border", CATEGORY_CONFIG[rec.actionCategory].cls)}
                >
                  {CATEGORY_CONFIG[rec.actionCategory].label}
                </span>
              )}
              <span className={cn("text-[10px] font-bold uppercase font-mono px-2 py-0.5 rounded border", risk.cls)}>
                {risk.label}
              </span>
              <SourceModeBadge mode={mode} />
              {rec.currentVendor && rec.targetVendor && (
                <span className="text-[10px] font-mono text-muted-foreground flex items-center gap-1">
                  <span className="text-red-400/80">{rec.currentVendor}</span>
                  <ArrowRight className="h-2.5 w-2.5 opacity-40" />
                  <span className="text-green-400/90">{rec.targetVendor}</span>
                </span>
              )}
              {rec.autoTriggered && (
                <span
                  data-testid={`ai-rec-auto-triggered-badge-${index}`}
                  className="flex items-center gap-1 text-[10px] font-bold uppercase font-mono text-cyan-500 bg-cyan-500/10 border border-cyan-500/30 px-1.5 py-0.5 rounded"
                  title="This recommendation was generated automatically in response to a sustained SIP 503 condition"
                >
                  <Zap className="h-2.5 w-2.5" />
                  Auto-Triggered
                </span>
              )}
              {rec.sipErrorTrend && (
                <span
                  data-testid={`ai-rec-sip-badge-${index}`}
                  className="flex items-center gap-1 text-[10px] font-bold uppercase font-mono text-cyan-600 dark:text-cyan-400 bg-cyan-500/10 border border-cyan-500/25 px-1.5 py-0.5 rounded"
                >
                  <Radio className="h-2.5 w-2.5" />
                  SIP Error
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
              {applied && canUndo && appliedActionId !== undefined && (
                <button
                  data-testid={`ai-rec-undo-${index}`}
                  onClick={() => onUndo(rec.id, appliedActionId, {
                    actionLabel:           rec.action,
                    destination:           rec.destination,
                    currentVendor:         rec.currentVendor,
                    targetVendor:          rec.targetVendor,
                    appliedAt,
                    noOriginalPlanWarning: hasOriginalPlanId === false,
                  })}
                  title="Undo this action"
                  className="flex items-center gap-1 text-[10px] font-bold uppercase font-mono text-amber-500 bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 rounded hover:bg-amber-500/20 transition-colors"
                >
                  <RotateCcw className="h-2.5 w-2.5" />
                  Undo
                </button>
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

        {/* Health Score Evidence block (when vendor health engine has scored this vendor) */}
        {rec.healthScoreEvidence && (
          <div
            data-testid={`ai-rec-health-evidence-${index}`}
            className="mt-2 rounded-lg bg-slate-500/5 border border-slate-500/15 px-3 py-2"
          >
            <p className="text-[9px] uppercase tracking-wide font-semibold text-muted-foreground/60 mb-1.5">
              Health Score Evidence
            </p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
              <span className="font-mono">
                Score:{" "}
                <span className={cn(
                  "font-bold",
                  rec.healthScoreEvidence.overallScore < 50 ? "text-red-400" :
                  rec.healthScoreEvidence.overallScore < 70 ? "text-amber-400" :
                  "text-emerald-400",
                )}>
                  {rec.healthScoreEvidence.overallScore.toFixed(0)}
                </span>
                <span className="text-muted-foreground">/100</span>
              </span>
              <span className="font-mono text-muted-foreground text-[10px]">
                Q={rec.healthScoreEvidence.qualityScore.toFixed(0)}{" "}
                R={rec.healthScoreEvidence.reliabilityScore.toFixed(0)}{" "}
                F={rec.healthScoreEvidence.fraudScore.toFixed(0)}{" "}
                M={rec.healthScoreEvidence.marginScore.toFixed(0)}
              </span>
              <span className={cn(
                "font-mono text-[10px] flex items-center gap-1",
                rec.healthScoreEvidence.trend === 'declining'  ? "text-red-400" :
                rec.healthScoreEvidence.trend === 'improving'  ? "text-emerald-400" :
                "text-muted-foreground",
              )}>
                {rec.healthScoreEvidence.trend === 'declining'  ? <TrendingDown className="h-2.5 w-2.5" /> :
                 rec.healthScoreEvidence.trend === 'improving'  ? <TrendingUp className="h-2.5 w-2.5" /> :
                 <Minus className="h-2.5 w-2.5" />}
                {rec.healthScoreEvidence.trend}
                {" "}({rec.healthScoreEvidence.trendDelta >= 0 ? "+" : ""}{rec.healthScoreEvidence.trendDelta.toFixed(1)} 6h)
              </span>
            </div>
          </div>
        )}

        {/* SIP Error trend sparkline + diagnosis (present only on SIP-error-triggered recs) */}
        {rec.sipErrorTrend && (
          <div
            data-testid={`ai-rec-sip-sparkline-${index}`}
            className="mt-2 rounded-lg bg-cyan-500/5 border border-cyan-500/15 px-3 py-2 space-y-2"
          >
            <p className="text-[9px] uppercase tracking-wide font-semibold text-cyan-500/70">
              Error Rate Trend (5 min → 15 min → 1 hr)
            </p>
            <SipCellSparkline
              rates={rec.sipErrorTrend.rates}
              code={rec.sipErrorTrend.code}
              label={rec.sipErrorTrend.label}
            />
            {(rec.likelyCause || rec.expectedAsrImpact) && (
              <div className="space-y-1 pt-1 border-t border-cyan-500/10">
                {rec.likelyCause && (
                  <div className="flex items-start gap-1.5 text-[10px]">
                    <span className="font-semibold text-cyan-500/80 shrink-0">Likely cause:</span>
                    <span className="text-muted-foreground">{rec.likelyCause}</span>
                  </div>
                )}
                {rec.expectedAsrImpact && (
                  <div className="flex items-start gap-1.5 text-[10px]">
                    <span className="font-semibold text-amber-500/80 shrink-0">ASR impact:</span>
                    <span className="text-muted-foreground">{rec.expectedAsrImpact}</span>
                  </div>
                )}
              </div>
            )}
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

// ── Pending Approval Panel ─────────────────────────────────────────────────────

interface PendingAction {
  id: number;
  account_id: string;
  account_name: string;
  action_type: string;
  primary_action: string;
  requested_by: string;
  requested_by_name: string;
  created_at: string;
  updated_at: string;
  expires_at: string;
  ttl_minutes: number;
  sippy_params: Record<string, unknown>;
}

function ApprovalCountdown({ expiresAt }: { expiresAt: string }) {
  const [remainingMs, setRemainingMs] = useState(() =>
    Math.max(0, new Date(expiresAt).getTime() - Date.now()),
  );

  useEffect(() => {
    const id = setInterval(() => {
      setRemainingMs(Math.max(0, new Date(expiresAt).getTime() - Date.now()));
    }, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  if (remainingMs === 0) {
    return (
      <span className="text-[11px] font-mono font-bold text-red-500 flex items-center gap-1">
        <Clock className="h-3 w-3" />
        Expiring…
      </span>
    );
  }

  const totalSec = Math.floor(remainingMs / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  const isUrgent = remainingMs < 5 * 60_000;
  const isWarning = remainingMs < 10 * 60_000;

  return (
    <span
      data-testid="approval-countdown"
      className={cn(
        "text-[11px] font-mono flex items-center gap-1",
        isUrgent  ? "font-bold text-red-500 animate-pulse"   :
        isWarning ? "font-semibold text-orange-400"           :
                    "text-muted-foreground/70",
      )}
    >
      <Clock className="h-3 w-3" />
      {mins}:{secs.toString().padStart(2, "0")} remaining
    </span>
  );
}

interface ExpiredAction {
  id: number;
  account_id: string;
  account_name: string;
  action_type: string;
  primary_action: string;
  requested_by: string;
  requested_by_name: string;
  rejection_reason: string;
  updated_at: string;
  created_at: string;
}

function PendingApprovalPanel() {
  const { toast } = useToast();
  const { user } = useAuth() as any;
  const currentUserId = String(user?.id ?? user?.userId ?? "");
  const [rejectTarget, setRejectTarget] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [expiredOpen, setExpiredOpen] = useState(false);

  const { data, isLoading, refetch } = useQuery<{ success: boolean; data: PendingAction[] }>({
    queryKey: ["/api/ai/actions/pending"],
    refetchInterval: 20_000,
  });

  const { data: expiredData, isLoading: expiredLoading, refetch: refetchExpired } =
    useQuery<{ success: boolean; data: ExpiredAction[] }>({
      queryKey: ["/api/ai/actions/expired"],
      refetchInterval: 60_000,
    });

  const { lastApprovalExpired } = useNocWebSocket();
  const seenExpiredRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!lastApprovalExpired) return;
    const key = `${lastApprovalExpired.actionId}-${lastApprovalExpired.expiredAt}`;
    if (seenExpiredRef.current.has(key)) return;
    seenExpiredRef.current.add(key);
    refetch();
    refetchExpired();
    queryClient.invalidateQueries({ queryKey: ["/api/ai/actions/pending"] });
    queryClient.invalidateQueries({ queryKey: ["/api/ai/actions/expired"] });
    toast({
      title: `Action #${lastApprovalExpired.actionId} auto-expired`,
      description: `No second operator acted in time — action for ${lastApprovalExpired.accountName} was automatically rejected after ${lastApprovalExpired.ttlMinutes}m.`,
      variant: "destructive",
    });
  }, [lastApprovalExpired]);

  const pending = data?.data ?? [];
  const expired = expiredData?.data ?? [];

  const approveMutation = useMutation<{ success: boolean; status: string; sippyNote: string }, Error, number>({
    mutationFn: (id) =>
      apiRequest("POST", `/api/ai/actions/${id}/approve`, { decision: "approve" })
        .then(r => r.json())
        .then(d => { if (!d.success) throw new Error(d.error ?? "Approval failed"); return d; }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai/actions/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai/route-copilot/summary"] });
      toast({
        title: data.status === "executed" ? "Action executed" : "Approval recorded",
        description: data.sippyNote ?? "Action processed successfully.",
      });
    },
    onError: (err) => toast({ title: "Approval failed", description: err.message, variant: "destructive" }),
  });

  const rejectMutation = useMutation<{ success: boolean }, Error, { id: number; reason: string }>({
    mutationFn: ({ id, reason }) =>
      apiRequest("POST", `/api/ai/actions/${id}/approve`, { decision: "reject", reason })
        .then(r => r.json())
        .then(d => { if (!d.success) throw new Error(d.error ?? "Rejection failed"); return d; }),
    onSuccess: () => {
      setRejectTarget(null);
      setRejectReason("");
      queryClient.invalidateQueries({ queryKey: ["/api/ai/actions/pending"] });
      toast({ title: "Action rejected", description: "The action has been rejected and will not be executed." });
    },
    onError: (err) => toast({ title: "Rejection failed", description: err.message, variant: "destructive" }),
  });

  if (isLoading && expiredLoading) return null;
  if (pending.length === 0 && expired.length === 0) return null;

  return (
    <div
      data-testid="pending-approval-panel"
      className="rounded-xl border border-orange-500/40 bg-orange-500/5 overflow-hidden"
    >
      {/* Header — only shown when there are pending items */}
      {pending.length > 0 && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-orange-500/20 bg-orange-500/10">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-orange-400" />
            <span className="text-sm font-bold text-orange-400">
              {pending.length} Action{pending.length !== 1 ? "s" : ""} Awaiting Second Approval
            </span>
            <span className="text-[10px] font-bold uppercase font-mono bg-orange-500/20 border border-orange-500/30 text-orange-400 px-1.5 py-0.5 rounded">
              FOUR-EYES RULE
            </span>
          </div>
          <button
            onClick={() => refetch()}
            className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
            data-testid="pending-panel-refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Actions list — only shown when there are pending items */}
      {pending.length > 0 && <div className="divide-y divide-orange-500/10">
        {pending.map((action) => {
          const isSelf = action.requested_by === currentUserId;
          return (
            <div
              key={action.id}
              data-testid={`pending-action-${action.id}`}
              className="px-4 py-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-orange-400 font-mono">#{action.id}</span>
                    <span className="text-[10px] font-bold uppercase font-mono bg-red-500/10 border border-red-500/20 text-red-400 px-1.5 py-0.5 rounded">
                      {action.action_type}
                    </span>
                    <span className="font-medium text-sm truncate">{action.account_name}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{action.primary_action}</p>
                  <div className="flex items-center gap-3 mt-0.5">
                    <p className="text-[11px] text-muted-foreground/60 font-mono">
                      Requested by {action.requested_by_name} · {new Date(action.created_at).toLocaleTimeString()}
                    </p>
                    {action.expires_at && (
                      <ApprovalCountdown expiresAt={action.expires_at} />
                    )}
                  </div>
                  {isSelf && (
                    <p className="text-[11px] text-orange-500 mt-1 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      You submitted this action — a different operator must approve it.
                    </p>
                  )}
                </div>

                {/* Approve / Reject */}
                {!isSelf && (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {rejectTarget === action.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          data-testid={`reject-reason-${action.id}`}
                          type="text"
                          placeholder="Reason (optional)"
                          value={rejectReason}
                          onChange={e => setRejectReason(e.target.value)}
                          className="text-xs border border-border rounded px-2 py-1 bg-background w-40"
                        />
                        <button
                          data-testid={`reject-confirm-${action.id}`}
                          onClick={() => rejectMutation.mutate({ id: action.id, reason: rejectReason })}
                          disabled={rejectMutation.isPending}
                          className="text-xs font-semibold px-2 py-1 rounded border border-red-500/40 text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                        >
                          {rejectMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Confirm Reject"}
                        </button>
                        <button
                          onClick={() => { setRejectTarget(null); setRejectReason(""); }}
                          className="text-xs text-muted-foreground hover:text-foreground"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          data-testid={`approve-action-${action.id}`}
                          onClick={() => approveMutation.mutate(action.id)}
                          disabled={approveMutation.isPending}
                          className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors disabled:opacity-50"
                        >
                          {approveMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserCheck className="h-3 w-3" />}
                          Approve
                        </button>
                        <button
                          data-testid={`reject-action-${action.id}`}
                          onClick={() => setRejectTarget(action.id)}
                          className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
                        >
                          <ThumbsDown className="h-3 w-3" />
                          Reject
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>}

      {/* Expired Approvals Section */}
      {expired.length > 0 && (
        <div
          data-testid="expired-approvals-section"
          className={pending.length > 0
            ? "border-t border-orange-500/20"
            : ""}
        >
          {/* Collapsed toggle header */}
          <button
            data-testid="expired-approvals-toggle"
            onClick={() => setExpiredOpen(o => !o)}
            className="w-full flex items-center justify-between px-4 py-3 bg-zinc-800/40 hover:bg-zinc-800/60 transition-colors"
          >
            <div className="flex items-center gap-2">
              <TimerOff className="h-4 w-4 text-zinc-400" />
              <span className="text-sm font-semibold text-zinc-300">
                Expired Approvals
              </span>
              <span className="text-[10px] font-bold font-mono bg-zinc-700/60 border border-zinc-600/40 text-zinc-400 px-1.5 py-0.5 rounded">
                {expired.length} record{expired.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                data-testid="expired-approvals-refresh"
                onClick={e => { e.stopPropagation(); refetchExpired(); }}
                className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
              {expiredOpen
                ? <ChevronUp className="h-4 w-4 text-zinc-500" />
                : <ChevronDown className="h-4 w-4 text-zinc-500" />}
            </div>
          </button>

          {/* Expanded list */}
          {expiredOpen && (
            <div
              data-testid="expired-approvals-list"
              className="divide-y divide-zinc-700/30 max-h-72 overflow-y-auto"
            >
              {expired.map(ea => (
                <div
                  key={ea.id}
                  data-testid={`expired-action-${ea.id}`}
                  className="px-4 py-3 flex items-start justify-between gap-3 hover:bg-zinc-800/20 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-zinc-400 font-mono">#{ea.id}</span>
                      <span className="text-[10px] font-bold uppercase font-mono bg-zinc-700/50 border border-zinc-600/30 text-zinc-400 px-1.5 py-0.5 rounded">
                        {ea.action_type}
                      </span>
                      <span className="font-medium text-sm text-zinc-300 truncate">{ea.account_name}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{ea.primary_action}</p>
                    <div className="flex items-center gap-3 mt-0.5">
                      <p className="text-[11px] text-muted-foreground/60 font-mono">
                        Requested by {ea.requested_by_name} · Created {new Date(ea.created_at).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <span className="text-[10px] font-semibold uppercase text-red-400/80 bg-red-500/10 border border-red-500/20 px-1.5 py-0.5 rounded font-mono">
                      EXPIRED
                    </span>
                    <p className="text-[10px] text-muted-foreground/50 font-mono mt-1">
                      {new Date(ea.updated_at).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── AI Copilot Panel ───────────────────────────────────────────────────────────

interface AppliedEntry {
  actionId: number;
  verificationState: string;
  appliedAt?: string;
  actionType?: string;
  hasOriginalPlanId?: boolean | null;
}

interface UndoSummary {
  actionLabel: string;
  destination?: string;
  currentVendor?: string;
  targetVendor?: string;
  appliedAt?: string;
  noOriginalPlanWarning?: boolean;
}

interface Copilot503Settings {
  threshold503Pct: number;
  sustainWindows: number;
  description?: string;
}

function CopilotSettingsPanel({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const { data: settingsData, isLoading } = useQuery<{ success: boolean; settings: Copilot503Settings; defaults: Copilot503Settings }>({
    queryKey: ["/api/ai/route-copilot/settings"],
    staleTime: 60_000,
  });

  const [threshold, setThreshold] = useState<number | "">("");
  const [windows,   setWindows]   = useState<number | "">("");

  useEffect(() => {
    if (settingsData?.settings) {
      setThreshold(settingsData.settings.threshold503Pct);
      setWindows(settingsData.settings.sustainWindows);
    }
  }, [settingsData]);

  const saveMutation = useMutation<{ success: boolean; settings: Copilot503Settings }, Error>({
    mutationFn: () =>
      apiRequest("PUT", "/api/ai/route-copilot/settings", {
        threshold503Pct: Number(threshold),
        sustainWindows:  Number(windows),
      }).then(r => r.json()).then(d => {
        if (!d.success) throw new Error(d.error ?? "Save failed");
        return d;
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai/route-copilot/settings"] });
      toast({ title: "Settings saved", description: data.settings.description });
      onClose();
    },
    onError: (err) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const defaults = settingsData?.defaults;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="rounded-xl border border-cyan-500/30 bg-card p-4 space-y-4"
      data-testid="copilot-settings-panel"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings className="h-4 w-4 text-cyan-400" />
          <h3 className="font-semibold text-sm">AI Copilot · Auto-Trigger Settings</h3>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-muted/40 transition-colors">
          <X className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">
        Configure when the copilot automatically re-analyses routes in response to a sustained SIP 503 condition from a vendor.
        Detection fires every CDR refresh cycle (~5 min).
      </p>

      {isLoading ? (
        <div className="space-y-2 animate-pulse">
          <div className="h-8 bg-muted rounded" />
          <div className="h-8 bg-muted rounded" />
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1.5">
              503 Rate Threshold (%)
            </label>
            <div className="flex items-center gap-2">
              <input
                data-testid="copilot-setting-threshold"
                type="number"
                min={1}
                max={100}
                value={threshold}
                onChange={e => setThreshold(e.target.value === "" ? "" : Number(e.target.value))}
                className="w-24 h-8 bg-muted/40 border border-border rounded-md px-3 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
              />
              <span className="text-xs text-muted-foreground">
                {defaults ? `Default: ${defaults.threshold503Pct}%` : ""}
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              Vendor must exceed this 503 rate in the 15-min window to count as a "high" window.
            </p>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1.5">
              Consecutive Windows Required
            </label>
            <div className="flex items-center gap-2">
              <input
                data-testid="copilot-setting-windows"
                type="number"
                min={1}
                max={10}
                value={windows}
                onChange={e => setWindows(e.target.value === "" ? "" : Number(e.target.value))}
                className="w-24 h-8 bg-muted/40 border border-border rounded-md px-3 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
              />
              <span className="text-xs text-muted-foreground">
                {defaults ? `Default: ${defaults.sustainWindows}` : ""}
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              Number of consecutive 15-min windows above threshold before auto-trigger fires.
            </p>
          </div>

          {settingsData?.settings?.description && (
            <div className="rounded-lg bg-cyan-500/8 border border-cyan-500/20 px-3 py-2 text-xs text-cyan-400/90">
              {settingsData.settings.description}
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              data-testid="copilot-settings-save"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || threshold === "" || windows === ""}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-semibold disabled:opacity-40 transition-colors"
            >
              {saveMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Save Settings
            </button>
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
}

function AiCopilotPanel() {
  const [dismissed,     setDismissed]    = useState<Set<string>>(new Set());
  const [pinned,        setPinned]       = useState<Set<string>>(new Set());
  const [applied,       setApplied]      = useState<Map<string, AppliedEntry>>(new Map());
  const [hasRun,        setHasRun]       = useState(false);
  const [modalRec,      setModalRec]     = useState<AiRouteRecommendation | null>(null);
  const [undoTarget,    setUndoTarget]   = useState<{ recId: string; actionId: number; summary: UndoSummary } | null>(null);
  const [settingsOpen,  setSettingsOpen] = useState(false);
  const { toast } = useToast();
  const { isManagement } = useAuth();

  // Fetch the last cached result on mount so the page doesn't start blank
  const { data: cachedData } = useQuery<{ success: boolean; data: CopilotResult; cached: boolean }>({
    queryKey: ["/api/ai/route-copilot/cached"],
    retry: false,
    staleTime: 30 * 60 * 1000,
  });

  // Hydrate Undo-eligible actions from the backend on load so Undo buttons
  // are visible for previously applied SUCCESS_CONFIRMED actions across reloads.
  const { data: appliedActionsData } = useQuery<{ success: boolean; actions: { actionId: number; recId: string; verificationState: string; actionType?: string; hasOriginalPlanId?: boolean | null; createdAt?: string }[] }>({
    queryKey: ["/api/ai/route-copilot/applied-actions"],
    staleTime: 60_000,
  });

  // Merge persisted applied actions into the applied map once on first load.
  // Fresh apply/rollback mutations always take precedence over stale server data.
  useEffect(() => {
    if (!appliedActionsData?.success || !appliedActionsData.actions.length) return;
    setApplied(prev => {
      const next = new Map(prev);
      for (const a of appliedActionsData.actions) {
        if (!next.has(a.recId)) {
          next.set(a.recId, {
            actionId:         a.actionId,
            verificationState: a.verificationState,
            appliedAt:        a.createdAt ?? undefined,
            actionType:       a.actionType,
            hasOriginalPlanId: a.hasOriginalPlanId,
          });
        }
      }
      return next;
    });
  // Only run once when the data first arrives
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedActionsData]);

  // Mark hasRun when cache loads a valid result (only once, before any fresh run)
  useEffect(() => {
    if (cachedData?.success && cachedData.data && !hasRun && !copilotMutation.data) {
      setHasRun(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cachedData]);

  const { data: execModeData } = useQuery<{ enabled: boolean; mode: string }>({
    queryKey: ["/api/ai/route-copilot/execution-mode"],
    staleTime: 30_000,
  });
  const executionEnabled = execModeData?.enabled ?? false;

  const copilotMutation = useMutation<{ success: boolean; data: CopilotResult }, Error>({
    mutationFn: () => apiRequest("POST", "/api/ai/route-recommendations").then(r => r.json()),
    onSuccess: () => setHasRun(true),
    onError: (err) => {
      toast({ title: "Copilot error", description: err.message, variant: "destructive" });
    },
  });

  const applyMutation = useMutation<{ success: boolean; actionId: number; mode: string; status: string; requiresSecondApproval?: boolean; sippyNote: string; verificationState: string }, Error, AiRouteRecommendation>({
    mutationFn: (rec) =>
      apiRequest("POST", "/api/ai/route-copilot/apply", {
        recommendation: rec,
        source_mode: result?.mode === "ai_enhanced" ? "ai_enhanced" : "rule_based",
      })
        .then(r => r.json())
        .then(data => {
          if (!data.success) throw new Error(data.error ?? "Apply failed");
          return data;
        }),
    onSuccess: (data, rec) => {
      setApplied(prev => new Map(prev).set(rec.id, { actionId: data.actionId, verificationState: data.verificationState ?? "UNKNOWN_PENDING", appliedAt: new Date().toISOString() }));
      setModalRec(null);
      queryClient.invalidateQueries({ queryKey: ["/api/ai/route-copilot/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai/route-copilot/applied-actions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai/actions/pending"] });
      if (data.requiresSecondApproval) {
        toast({
          title: "Awaiting second approval",
          description: `Action #${data.actionId} queued — a second management-role operator must approve before it writes to Sippy.`,
        });
      } else {
        toast({
          title: data.mode === "executed" ? "Routing action applied" : "Action recorded (dry-run)",
          description: data.sippyNote ?? `Action #${data.actionId} logged to audit ledger.`,
        });
      }
    },
    onError: (err) => {
      toast({ title: "Apply failed", description: err.message, variant: "destructive" });
    },
  });

  const rollbackMutation = useMutation<{ success: boolean; rollbackNote: string; verificationState: string; error?: string | null }, Error, { recId: string; actionId: number; reason?: string }>({
    mutationFn: ({ actionId, reason }) =>
      apiRequest("POST", `/api/ai/route-copilot/rollback/${actionId}`, reason ? { reason } : undefined)
        .then(r => r.json())
        .then(data => {
          if (!data.success) throw new Error(data.error ?? "Rollback failed");
          return data;
        }),
    onSuccess: (data, { recId }) => {
      setApplied(prev => { const n = new Map(prev); n.delete(recId); return n; });
      setUndoTarget(null);
      queryClient.invalidateQueries({ queryKey: ["/api/ai/route-copilot/applied-actions"] });
      toast({
        title: "Action rolled back",
        description: data.rollbackNote ?? "Rollback recorded in audit ledger.",
      });
    },
    onError: (err) => {
      setUndoTarget(null);
      toast({ title: "Rollback failed", description: err.message, variant: "destructive" });
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

  const handleUndo = useCallback((recId: string, actionId: number, summary: UndoSummary) => {
    setUndoTarget({ recId, actionId, summary });
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
            {isManagement && (
              <button
                data-testid="copilot-settings-btn"
                onClick={() => setSettingsOpen(p => !p)}
                title="Auto-trigger settings"
                className={cn(
                  "flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border transition-colors",
                  settingsOpen
                    ? "bg-cyan-500/15 border-cyan-500/30 text-cyan-400"
                    : "border-border text-muted-foreground hover:text-foreground hover:border-cyan-500/30",
                )}
              >
                <Settings className="h-3 w-3" />
                Settings
              </button>
            )}
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

      {/* Settings panel */}
      <AnimatePresence>
        {settingsOpen && isManagement && (
          <CopilotSettingsPanel onClose={() => setSettingsOpen(false)} />
        )}
      </AnimatePresence>

      {/* Auto-trigger notification banner */}
      {result?.autoTriggered && result.triggerReason && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-cyan-500/30 bg-cyan-500/5 px-4 py-3 flex items-start gap-3"
          data-testid="copilot-auto-trigger-banner"
        >
          <Zap className="h-4 w-4 text-cyan-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-cyan-400">Auto-triggered analysis</p>
            <p className="text-xs text-muted-foreground mt-0.5">{result.triggerReason}</p>
            <p className="text-[10px] text-muted-foreground/60 mt-1">
              Recommendations with a <span className="text-cyan-400 font-bold">AUTO-TRIGGERED</span> badge were generated specifically in response to this condition.
            </p>
          </div>
        </motion.div>
      )}

      {/* Pending approval panel — shown to management operators when actions await sign-off */}
      {isManagement && <PendingApprovalPanel />}

      {/* SIP Error Rates panel */}
      <SipErrorPanel />

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
            {visible.map((rec, i) => {
              const entry = applied.get(rec.id);
              const isSuccessConfirmed = entry?.verificationState === "SUCCESS_CONFIRMED";
              return (
                <AiRecCard
                  key={rec.id}
                  rec={rec}
                  index={i}
                  pinned={pinned.has(rec.id)}
                  applied={!!entry}
                  appliedActionId={entry?.actionId}
                  appliedAt={entry?.appliedAt}
                  hasOriginalPlanId={entry?.hasOriginalPlanId}
                  canUndo={isManagement && isSuccessConfirmed}
                  canApply={isManagement}
                  mode={result?.mode ?? "rule_based_preview"}
                  onDismiss={handleDismiss}
                  onPin={handlePin}
                  onApply={handleApply}
                  onUndo={handleUndo}
                />
              );
            })}
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
            mode={result?.mode ?? "rule_based_preview"}
            isPending={applyMutation.isPending}
            executionEnabled={executionEnabled}
            onConfirm={() => applyMutation.mutate(modalRec)}
            onCancel={() => !applyMutation.isPending && setModalRec(null)}
          />
        )}
      </AnimatePresence>

      {/* Undo / rollback modal */}
      <AnimatePresence>
        {undoTarget && (
          <UndoModal
            summary={undoTarget.summary}
            isPending={rollbackMutation.isPending}
            onConfirm={(reason) => rollbackMutation.mutate({ recId: undoTarget.recId, actionId: undoTarget.actionId, reason: reason || undefined })}
            onCancel={() => !rollbackMutation.isPending && setUndoTarget(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── SIP Error Panel ────────────────────────────────────────────────────────────

const SIP_CODES = [503, 486, 480, 408, 404, 403] as const;
const CODE_LABELS: Record<number, string> = {
  503: "503",
  486: "486",
  480: "480",
  408: "408",
  404: "404",
  403: "403",
};
const CODE_FULL: Record<number, string> = {
  503: "503 Unavailable",
  486: "486 Busy",
  480: "480 Temp. Unavail.",
  408: "408 Timeout",
  404: "404 Not Found",
  403: "403 Forbidden",
};

interface SipVendorSnapshot {
  vendorName: string;
  topCode: number | null;
  maxRate: number;
  hasCongestion: boolean;
  hasCliRejection: boolean;
  hasActiveAlert: boolean;
  windows: {
    [mins: number]: {
      [code: number]: { count: number; rate: number };
    };
  };
}

interface SipPrefixRow {
  destPrefix: string;
  vendorName: string;
  dominantCode: number;
  dominantRate: number;
  totalFailures: number;
}

interface SipErrorData {
  success: boolean;
  vendors: SipVendorSnapshot[];
  prefixRows: SipPrefixRow[];
  hasActiveAlert: boolean;
  computedAt: string;
}

interface SipHistoryPoint {
  timeBucket: string;
  rate: number;
}

interface SipVendorHistory {
  vendorName: string;
  windowMinutes: number;
  code: number;
  points: SipHistoryPoint[];
}

interface SipErrorHistoryData {
  success: boolean;
  history: SipVendorHistory[];
}

function rateColor(rate: number): string {
  if (rate >= 10) return "text-red-500 dark:text-red-400";
  if (rate >= 2)  return "text-amber-500 dark:text-amber-400";
  return "text-green-600 dark:text-green-400";
}

// ── Sparkline SVG component ────────────────────────────────────────────────────
// Renders a tiny polyline chart of up to 12 rate samples.
// Points are drawn as a filled area + stroke line.
// Tooltip (title attribute) is set on each circle point for hover detail.
function SipSparkline({
  points,
  width = 80,
  height = 22,
  code,
}: {
  points: SipHistoryPoint[];
  width?: number;
  height?: number;
  code: number;
}) {
  if (points.length < 2) {
    return (
      <span className="text-[9px] text-muted-foreground/30 font-mono select-none">
        {points.length === 1 ? `${points[0].rate.toFixed(1)}%` : "—"}
      </span>
    );
  }

  const maxRate = Math.max(...points.map(p => p.rate), 1);
  const pad = 2;
  const w = width - pad * 2;
  const h = height - pad * 2;

  const toX = (i: number) => pad + (i / (points.length - 1)) * w;
  const toY = (r: number) => pad + h - (r / maxRate) * h;

  const polyPoints = points.map((p, i) => `${toX(i)},${toY(p.rate)}`).join(' ');
  const areaPath = [
    `M ${toX(0)},${toY(points[0].rate)}`,
    ...points.slice(1).map((p, i) => `L ${toX(i + 1)},${toY(p.rate)}`),
    `L ${toX(points.length - 1)},${height}`,
    `L ${toX(0)},${height}`,
    'Z',
  ].join(' ');

  // Color based on max rate
  const maxVal = Math.max(...points.map(p => p.rate));
  const strokeColor = maxVal >= 10 ? '#ef4444' : maxVal >= 2 ? '#f59e0b' : '#22c55e';
  const fillColor = maxVal >= 10 ? 'rgba(239,68,68,0.12)' : maxVal >= 2 ? 'rgba(245,158,11,0.10)' : 'rgba(34,197,94,0.10)';

  const last = points[points.length - 1];
  const formatTs = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch { return iso; }
  };

  return (
    <div className="relative inline-flex items-center gap-1">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="overflow-visible"
        data-testid={`sparkline-${code}`}
      >
        <path d={areaPath} fill={fillColor} />
        <polyline
          points={polyPoints}
          fill="none"
          stroke={strokeColor}
          strokeWidth="1.2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={toX(i)}
            cy={toY(p.rate)}
            r={i === points.length - 1 ? 2 : 1.2}
            fill={strokeColor}
            opacity={i === points.length - 1 ? 1 : 0.4}
          >
            <title>{`${formatTs(p.timeBucket)} — ${p.rate.toFixed(1)}%`}</title>
          </circle>
        ))}
      </svg>
      <span className="text-[9px] font-mono tabular-nums" style={{ color: strokeColor }}>
        {last.rate.toFixed(1)}%
      </span>
    </div>
  );
}

function SipErrorPanel() {
  const [open,       setOpen]       = useState(false);
  const [activeWin,  setActiveWin]  = useState<5 | 15 | 60>(15);
  const [heatmap,    setHeatmap]    = useState(false);
  const [selectedCell, setSelectedCell] = useState<{ vendor: string; code: number } | null>(null);

  const { data, isLoading } = useQuery<SipErrorData>({
    queryKey: ["/api/copilot/sip-errors"],
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  const { data: histData } = useQuery<SipErrorHistoryData>({
    queryKey: ["/api/copilot/sip-error-history", activeWin],
    queryFn: () => fetch(`/api/copilot/sip-error-history?window=${activeWin}`).then(r => r.json()),
    enabled: open && !heatmap,
    staleTime: 5 * 60 * 1000,
    refetchInterval: open && !heatmap ? 5 * 60 * 1000 : false,
  });

  // Build lookup: vendorName → code → points
  const historyMap = new Map<string, Map<number, SipHistoryPoint[]>>();
  for (const h of histData?.history ?? []) {
    if (!historyMap.has(h.vendorName)) historyMap.set(h.vendorName, new Map());
    historyMap.get(h.vendorName)!.set(h.code, h.points);
  }

  const vendors = data?.vendors ?? [];
  const prefixRows = data?.prefixRows ?? [];
  const hasData = vendors.length > 0;
  const hasActiveAlert = data?.hasActiveAlert ?? false;

  const windowLabel: Record<number, string> = { 5: "5 min", 15: "15 min", 60: "1 hr" };

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
        onClick={() => setOpen(v => !v)}
        data-testid="sip-error-panel-toggle"
      >
        <div className="flex items-center gap-2">
          <Radio className="h-4 w-4 text-cyan-500" />
          <span className="font-semibold text-sm">SIP Error Rates</span>
          {hasData && !open && (
            <span className="text-[10px] font-mono text-muted-foreground/60">
              {vendors.length} vendor{vendors.length !== 1 ? "s" : ""} · {vendors.filter(v => v.maxRate > 10).length} flagged
            </span>
          )}
          {hasActiveAlert ? (
            <span
              data-testid="sip-error-active-alert-badge"
              className="text-[10px] font-bold uppercase tracking-wide text-red-500 bg-red-500/10 border border-red-500/30 px-1.5 py-0.5 rounded animate-pulse"
            >
              Active Alert
            </span>
          ) : vendors.some(v => v.hasCongestion || v.hasCliRejection) ? (
            <span
              data-testid="sip-error-alert-badge"
              className="text-[10px] font-bold uppercase tracking-wide text-amber-500 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded"
            >
              Alert
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </div>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden border-t border-border/50"
          >
            <div className="p-4 space-y-4">
              {/* Controls */}
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-0.5">
                  {([5, 15, 60] as const).map(w => (
                    <button
                      key={w}
                      data-testid={`sip-window-${w}`}
                      onClick={() => setActiveWin(w)}
                      className={cn(
                        "px-3 py-1 text-xs font-medium rounded-md transition-colors",
                        activeWin === w
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {windowLabel[w]}
                    </button>
                  ))}
                </div>
                <button
                  data-testid="sip-heatmap-toggle"
                  onClick={() => setHeatmap(v => !v)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors",
                    heatmap
                      ? "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border-cyan-500/30"
                      : "bg-muted/40 text-muted-foreground border-transparent hover:border-border"
                  )}
                >
                  <LayoutGrid className="h-3 w-3" />
                  Heatmap
                </button>
              </div>

              {isLoading && (
                <div className="py-8 flex items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )}

              {!isLoading && !hasData && (
                <div className="py-8 flex flex-col items-center justify-center text-muted-foreground">
                  <Radio className="h-6 w-6 mb-2 opacity-25" />
                  <p className="text-sm">No SIP error data yet</p>
                  <p className="text-xs mt-1 opacity-60">The aggregator runs every 5 min after startup</p>
                </div>
              )}

              {!isLoading && hasData && !heatmap && (
                /* Table view */
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border/50">
                        <th className="text-left py-2 px-2 text-muted-foreground font-medium">Vendor</th>
                        {SIP_CODES.map(c => (
                          <th key={c} className="text-right py-2 px-2 text-muted-foreground font-medium font-mono" title={CODE_FULL[c]}>
                            {CODE_LABELS[c]}
                          </th>
                        ))}
                        <th className="text-right py-2 px-2 text-muted-foreground font-medium">Signal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/30">
                      {vendors.map(v => {
                        const win = v.windows[activeWin] ?? {};
                        const vendorHist = historyMap.get(v.vendorName);
                        // Check if there are any sparkline points for this vendor
                        const hasSparklines = vendorHist && [...vendorHist.values()].some(pts => pts.length >= 2);
                        return (
                          <Fragment key={v.vendorName}>
                            <tr className="hover:bg-muted/20 transition-colors" data-testid={`sip-row-${v.vendorName}`}>
                            <td className="py-2 px-2 font-medium">{v.vendorName}</td>
                            {SIP_CODES.map(code => {
                              const entry = win[code] ?? { rate: 0, count: 0 };
                              return (
                                <td key={code} className="py-2 px-2 text-right tabular-nums">
                                  {entry.rate > 0 ? (
                                    <div className="flex flex-col items-end gap-0.5">
                                      <span className={cn("font-mono font-semibold text-[11px]", rateColor(entry.rate))}>
                                        {entry.rate.toFixed(1)}%
                                      </span>
                                      <span className="text-[9px] text-muted-foreground/60 font-mono">
                                        {entry.count}×
                                      </span>
                                    </div>
                                  ) : (
                                    <span className="text-muted-foreground/30 font-mono text-[11px]">—</span>
                                  )}
                                </td>
                              );
                            })}
                            <td className="py-2 px-2 text-right">
                              <div className="flex items-center justify-end gap-1 flex-wrap">
                                {v.hasCongestion && (
                                  <span className="text-[9px] font-bold uppercase text-red-500 bg-red-500/10 border border-red-500/20 px-1 py-0.5 rounded">
                                    Congestion
                                  </span>
                                )}
                                {v.hasCliRejection && (
                                  <span className="text-[9px] font-bold uppercase text-amber-500 bg-amber-500/10 border border-amber-500/20 px-1 py-0.5 rounded">
                                    CLI Rej.
                                  </span>
                                )}
                                {!v.hasCongestion && !v.hasCliRejection && v.maxRate < 2 && (
                                  <span className="text-[9px] text-green-500 opacity-60">ok</span>
                                )}
                              </div>
                            </td>
                          </tr>
                          {hasSparklines && (
                            <tr
                              className="bg-muted/10 border-b border-border/20"
                              data-testid={`sip-sparkline-row-${v.vendorName}`}
                            >
                              <td className="px-2 py-1.5">
                                <span className="text-[9px] text-muted-foreground/50 font-medium uppercase tracking-wide">Trend</span>
                              </td>
                              {SIP_CODES.map(code => {
                                const pts = vendorHist?.get(code) ?? [];
                                return (
                                  <td key={code} className="px-2 py-1.5 text-right">
                                    <div className="flex justify-end">
                                      <SipSparkline
                                        points={pts}
                                        code={code}
                                        width={76}
                                        height={20}
                                      />
                                    </div>
                                  </td>
                                );
                              })}
                              <td />
                            </tr>
                          )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border/30">
                    {[
                      { label: "< 2%",   color: "bg-green-500", text: "Normal" },
                      { label: "2–10%",  color: "bg-amber-500", text: "Elevated" },
                      { label: "> 10%",  color: "bg-red-500",   text: "Critical" },
                    ].map(({ label, color, text }) => (
                      <div key={text} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <div className={cn("w-2 h-2 rounded-full", color)} />
                        {label} — {text}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!isLoading && hasData && heatmap && (() => {
                /* Vendor × Error-Code matrix — rows: vendors; cols: SIP error codes */
                /* Cell shows rate for the selected window; click → sparkline detail panel */
                const CODES = SIP_CODES;

                function cellBg(rate: number): string {
                  if (rate >= 10) return "bg-red-500/75 text-white border-red-500/60";
                  if (rate >= 2)  return "bg-amber-500/55 text-white border-amber-500/50";
                  if (rate > 0)   return "bg-green-500/20 text-green-800 dark:text-green-200 border-green-500/20";
                  return "bg-muted/15 text-muted-foreground/25 border-transparent";
                }

                const selV = vendors.find(v => v.vendorName === selectedCell?.vendor);
                const selRate = selV && selectedCell
                  ? (selV.windows[activeWin]?.[selectedCell.code]?.rate ?? 0)
                  : 0;
                const selSparkRates = selV && selectedCell ? {
                  min5:  selV.windows[5]?.[selectedCell.code]?.rate  ?? 0,
                  min15: selV.windows[15]?.[selectedCell.code]?.rate ?? 0,
                  min60: selV.windows[60]?.[selectedCell.code]?.rate ?? 0,
                } : null;
                const codeDotColor: Record<number, string> = {
                  503: "bg-red-500",
                  486: "bg-amber-500",
                  480: "bg-orange-400",
                  408: "bg-yellow-500",
                  404: "bg-blue-500",
                  403: "bg-purple-500",
                };

                if (topPrefixes.length === 0) {
                  return (
                    <div className="py-8 flex flex-col items-center justify-center text-muted-foreground">
                      <LayoutGrid className="h-6 w-6 mb-2 opacity-25" />
                      <p className="text-sm">No prefix data yet</p>
                      <p className="text-xs mt-1 opacity-60">Prefix breakdown is computed from the 15-min window after CDR refresh</p>
                    </div>
                  );
                }

                return (
                  <div className="space-y-3">
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs border-separate border-spacing-0.5">
                        <thead>
                          <tr>
                            <th className="text-left py-2 px-2 text-muted-foreground font-medium min-w-[100px] text-[10px]">
                              Vendor
                            </th>
                            {CODES.map(code => (
                              <th key={code} className="py-2 px-1 text-muted-foreground font-medium text-center text-[10px] min-w-[64px]" title={CODE_FULL[code]}>
                                {CODE_LABELS[code]}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {vendors.map(v => (
                            <tr key={v.vendorName} data-testid={`sip-heatmap-row-${v.vendorName}`}>
                              <td className="py-1 px-2 font-medium text-[10px] truncate max-w-[120px]" title={v.vendorName}>
                                {v.vendorName.length > 14 ? v.vendorName.slice(0, 13) + "…" : v.vendorName}
                              </td>
                              {CODES.map(code => {
                                const entry = v.windows[activeWin]?.[code] ?? { rate: 0, count: 0 };
                                const isSelected = selectedCell?.vendor === v.vendorName && selectedCell?.code === code;
                                return (
                                  <td key={code} className="py-0.5 px-0.5">
                                    <button
                                      data-testid={`sip-heatmap-cell-${v.vendorName}-${code}`}
                                      onClick={() => setSelectedCell(isSelected ? null : { vendor: v.vendorName, code })}
                                      className={cn(
                                        "w-full h-9 rounded border flex flex-col items-center justify-center gap-0 transition-all",
                                        cellBg(entry.rate),
                                        isSelected && "ring-2 ring-cyan-400 ring-offset-1 ring-offset-background"
                                      )}
                                      title={entry.rate > 0 ? `${v.vendorName} ${CODE_FULL[code]}: ${entry.rate.toFixed(1)}% (${entry.count}×) — click for trend` : `${v.vendorName} ${CODE_FULL[code]}: no errors`}
                                    >
                                      {entry.rate > 0 ? (
                                        <>
                                          <span className="font-mono text-[9px] font-bold leading-tight">{entry.rate.toFixed(1)}%</span>
                                          <span className="text-[8px] leading-tight opacity-75">{entry.count}×</span>
                                        </>
                                      ) : (
                                        <span className="text-[9px] opacity-25">—</span>
                                      )}
                                    </button>
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Per-cell sparkline detail panel */}
                    {selectedCell && selV && selSparkRates && (
                      <div
                        data-testid="sip-heatmap-detail"
                        className="rounded-lg bg-cyan-500/5 border border-cyan-500/20 px-3 py-3 space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Radio className="h-3 w-3 text-cyan-500" />
                            <span className="text-xs font-semibold">{selectedCell.vendor}</span>
                            <span className="text-[10px] text-muted-foreground font-mono">·</span>
                            <span className="text-[10px] font-mono font-bold text-cyan-500">{CODE_LABELS[selectedCell.code]}</span>
                            <span className="text-[10px] text-muted-foreground">{CODE_FULL[selectedCell.code]}</span>
                          </div>
                          <button
                            data-testid="sip-heatmap-detail-close"
                            onClick={() => setSelectedCell(null)}
                            className="text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div>
                          <p className="text-[9px] uppercase tracking-wide font-semibold text-cyan-500/70 mb-1">
                            5 min → 15 min → 1 hr trajectory
                          </p>
                          <SipCellSparkline
                            rates={selSparkRates}
                            code={selectedCell.code}
                            label={CODE_LABELS[selectedCell.code] ?? String(selectedCell.code)}
                          />
                        </div>
                        <div className="grid grid-cols-3 gap-2 pt-1 border-t border-cyan-500/10">
                          {([5, 15, 60] as const).map(w => {
                            const r = selV.windows[w]?.[selectedCell.code]?.rate ?? 0;
                            const cnt = selV.windows[w]?.[selectedCell.code]?.count ?? 0;
                            return (
                              <div key={w} className="text-center">
                                <p className={cn("font-mono font-bold text-sm tabular-nums", rateColor(r))}>
                                  {r.toFixed(1)}%
                                </p>
                                <p className="text-[9px] text-muted-foreground">{windowLabel[w]}</p>
                                <p className="text-[9px] text-muted-foreground/60">{cnt}× errors</p>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className="flex items-center gap-3 pt-1 flex-wrap">
                      <span className="text-[10px] text-muted-foreground font-medium">
                        Vendor × error-code matrix ({windowLabel[activeWin]} window) · click any cell for 5/15/60 trend:
                      </span>
                      {[
                        { label: "< 2%",   color: "bg-green-500",  text: "Normal" },
                        { label: "2–10%",  color: "bg-amber-500",  text: "Elevated" },
                        { label: "> 10%",  color: "bg-red-500",    text: "Critical" },
                      ].map(({ label, color, text }) => (
                        <div key={text} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <div className={cn("w-2 h-2 rounded-sm", color, "opacity-70")} />
                          {label} — {text}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Prefix × Vendor Heatmap Grid ───────────────────────────────────────────────

const CODE_DOT_CLR: Record<number, string> = {
  503: "bg-red-500",
  486: "bg-amber-500",
  480: "bg-orange-400",
  408: "bg-yellow-500",
  404: "bg-blue-500",
  403: "bg-purple-500",
};

function prefixCellBg(code: number, rate: number): string {
  const tiers: Record<number, [string, string, string]> = {
    503: [
      "bg-red-500/18 border-red-500/20 dark:text-red-300 text-red-800",
      "bg-red-500/48 border-red-500/40 text-white",
      "bg-red-500/78 border-red-500/60 text-white",
    ],
    486: [
      "bg-amber-500/18 border-amber-500/20 dark:text-amber-300 text-amber-800",
      "bg-amber-500/48 border-amber-500/40 text-white",
      "bg-amber-500/78 border-amber-500/60 text-white",
    ],
    480: [
      "bg-orange-400/18 border-orange-400/20 dark:text-orange-300 text-orange-800",
      "bg-orange-400/48 border-orange-400/40 text-white",
      "bg-orange-400/78 border-orange-400/60 text-white",
    ],
    408: [
      "bg-yellow-500/18 border-yellow-500/20 dark:text-yellow-300 text-yellow-800",
      "bg-yellow-500/48 border-yellow-500/40 text-white",
      "bg-yellow-500/78 border-yellow-500/60 text-white",
    ],
    404: [
      "bg-blue-500/18 border-blue-500/20 dark:text-blue-300 text-blue-800",
      "bg-blue-500/48 border-blue-500/40 text-white",
      "bg-blue-500/78 border-blue-500/60 text-white",
    ],
    403: [
      "bg-purple-500/18 border-purple-500/20 dark:text-purple-300 text-purple-800",
      "bg-purple-500/48 border-purple-500/40 text-white",
      "bg-purple-500/78 border-purple-500/60 text-white",
    ],
  };
  const tier = rate >= 10 ? 2 : rate >= 2 ? 1 : 0;
  return (tiers[code] ?? [
    "bg-muted/15 border-transparent text-muted-foreground/50",
    "bg-muted/30 border-transparent text-muted-foreground",
    "bg-muted/50 border-transparent text-muted-foreground",
  ])[tier];
}

function SipPrefixHeatmapGrid({
  prefixRows,
  spikeVendorNames,
}: {
  prefixRows: SipPrefixRow[];
  spikeVendorNames: Set<string>;
}) {
  const [selectedCell, setSelectedCell] = useState<{ prefix: string; vendor: string } | null>(null);
  const [affectedOnly, setAffectedOnly] = useState(false);

  const allPrefixes = [...new Set(prefixRows.map(r => r.destPrefix))].sort();
  const vendors = [...new Set(prefixRows.map(r => r.vendorName))].sort((a, b) => {
    const as_ = spikeVendorNames.has(a) ? 0 : 1;
    const bs_ = spikeVendorNames.has(b) ? 0 : 1;
    if (as_ !== bs_) return as_ - bs_;
    return a.localeCompare(b);
  });

  const rowMap = new Map<string, SipPrefixRow>();
  for (const r of prefixRows) rowMap.set(`${r.destPrefix}|${r.vendorName}`, r);

  const affectedPrefixes = new Set(
    allPrefixes.filter(prefix =>
      vendors.some(v => {
        const row = rowMap.get(`${prefix}|${v}`);
        return row !== undefined && row.dominantRate >= 2;
      })
    )
  );

  const hasAffected = affectedPrefixes.size > 0;

  // Auto-reset filter when spike data clears so the grid never gets stuck empty
  useEffect(() => {
    if (!hasAffected && affectedOnly) setAffectedOnly(false);
  }, [hasAffected, affectedOnly]);

  // Guard against filtering when no affected rows exist (data may have refreshed)
  const prefixes = affectedOnly && hasAffected
    ? allPrefixes.filter(p => affectedPrefixes.has(p))
    : allPrefixes;

  if (allPrefixes.length === 0) {
    return (
      <div className="rounded-xl border bg-card flex flex-col items-center justify-center py-16 text-muted-foreground">
        <LayoutGrid className="h-8 w-8 mb-3 opacity-20" />
        <p className="text-sm font-medium">No prefix data available</p>
        <p className="text-xs mt-1 opacity-60">Prefix breakdown is computed after the CDR cache refreshes</p>
      </div>
    );
  }

  const selRow = selectedCell ? rowMap.get(`${selectedCell.prefix}|${selectedCell.vendor}`) : undefined;

  return (
    <div className="space-y-3">
      {/* Heatmap filter controls */}
      <div className="flex items-center gap-2 flex-wrap">
        {hasAffected && (
          <button
            data-testid="prefix-heatmap-affected-only-toggle"
            onClick={() => setAffectedOnly(v => !v)}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-lg border transition-colors",
              affectedOnly
                ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30"
                : "bg-muted/40 text-muted-foreground border-border/40 hover:border-border hover:text-foreground"
            )}
          >
            <AlertTriangle className="h-3 w-3" />
            Affected only
          </button>
        )}
        <span
          data-testid="prefix-heatmap-row-count"
          className="text-[11px] text-muted-foreground/60"
        >
          {affectedOnly
            ? `${prefixes.length} of ${allPrefixes.length} prefixes`
            : `${allPrefixes.length} prefix${allPrefixes.length !== 1 ? "es" : ""}`}
        </span>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="text-xs border-separate border-spacing-0.5 p-1.5">
            <thead>
              <tr>
                <th className="text-left py-2 px-3 text-muted-foreground font-medium text-[10px] min-w-[90px] sticky left-0 bg-card z-10">
                  Prefix
                </th>
                {vendors.map(v => (
                  <th
                    key={v}
                    className={cn(
                      "py-2 px-1.5 text-center text-[10px] font-medium min-w-[82px]",
                      spikeVendorNames.has(v) ? "text-amber-500" : "text-muted-foreground"
                    )}
                    title={spikeVendorNames.has(v) ? `${v} — spike active` : v}
                  >
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="truncate max-w-[72px]">
                        {v.length > 9 ? `${v.slice(0, 8)}…` : v}
                      </span>
                      {spikeVendorNames.has(v) && (
                        <span className="text-[8px] font-bold uppercase text-amber-500 bg-amber-500/10 border border-amber-500/20 px-1 py-0.5 rounded leading-none">
                          spike
                        </span>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {prefixes.map(prefix => (
                <tr key={prefix} data-testid={`prefix-heatmap-row-${prefix}`}>
                  <td className="py-1 px-3 font-mono text-[10px] font-semibold text-foreground/80 sticky left-0 bg-card z-10 whitespace-nowrap">
                    +{prefix}
                  </td>
                  {vendors.map(v => {
                    const row = rowMap.get(`${prefix}|${v}`);
                    const isSel = selectedCell?.prefix === prefix && selectedCell?.vendor === v;
                    return (
                      <td key={v} className="py-0.5 px-0.5">
                        {row ? (
                          <button
                            data-testid={`prefix-heatmap-cell-${prefix}-${v}`}
                            onClick={() => setSelectedCell(isSel ? null : { prefix, vendor: v })}
                            className={cn(
                              "w-full h-10 rounded border flex flex-col items-center justify-center gap-0.5 transition-all hover:opacity-90",
                              prefixCellBg(row.dominantCode, row.dominantRate),
                              isSel && "ring-2 ring-cyan-400 ring-offset-1 ring-offset-background"
                            )}
                            title={`+${prefix} via ${v}: ${CODE_FULL[row.dominantCode] ?? row.dominantCode} — ${row.dominantRate.toFixed(1)}% (${row.totalFailures} failures) — click for detail`}
                          >
                            <span className="font-mono text-[9px] font-bold leading-tight">
                              {CODE_LABELS[row.dominantCode] ?? row.dominantCode}
                            </span>
                            <span className="text-[8px] leading-tight opacity-80">
                              {row.dominantRate.toFixed(1)}%
                            </span>
                          </button>
                        ) : (
                          <div className="w-full h-10 rounded border border-transparent flex items-center justify-center">
                            <span className="text-[9px] text-muted-foreground/20">—</span>
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Cell detail panel */}
        {selectedCell && selRow && (
          <div
            data-testid="prefix-heatmap-detail"
            className="border-t border-border/40 px-4 py-3 bg-cyan-500/5 space-y-2"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 flex-wrap">
                <Radio className="h-3.5 w-3.5 text-cyan-500" />
                <span className="font-mono text-sm font-semibold">+{selectedCell.prefix}</span>
                <span className="text-[10px] text-muted-foreground/50">via</span>
                <span className="text-sm font-medium">{selectedCell.vendor}</span>
                {spikeVendorNames.has(selectedCell.vendor) && (
                  <span className="text-[9px] font-bold uppercase text-amber-500 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded">
                    spike vendor
                  </span>
                )}
              </div>
              <button
                data-testid="prefix-heatmap-detail-close"
                onClick={() => setSelectedCell(null)}
                className="text-muted-foreground/40 hover:text-muted-foreground transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="text-[10px] text-muted-foreground mb-0.5">Dominant Code</p>
                <p className="font-mono font-bold text-sm">{CODE_FULL[selRow.dominantCode] ?? selRow.dominantCode}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground mb-0.5">Error Rate</p>
                <p className={cn("font-mono font-bold text-sm", rateColor(selRow.dominantRate))}>
                  {selRow.dominantRate.toFixed(1)}%
                </p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground mb-0.5">Total Failures</p>
                <p className="font-mono font-bold text-sm">{selRow.totalFailures}</p>
              </div>
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="border-t border-border/30 px-4 py-2.5 bg-muted/10 flex items-center gap-3 flex-wrap">
          <span className="text-[10px] text-muted-foreground font-medium">Dominant SIP code per prefix × vendor:</span>
          {([503, 486, 480, 408, 404, 403] as const).map(code => (
            <div key={code} className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <div className={cn("w-2 h-2 rounded-sm", CODE_DOT_CLR[code])} />
              {CODE_FULL[code]}
            </div>
          ))}
          <span className="ml-auto text-[10px] text-muted-foreground/40 italic">
            intensity = rate (low / elevated / critical)
          </span>
        </div>
      </div>
    </div>
  );
}

// ── SIP Errors Tab ─────────────────────────────────────────────────────────────

interface SipSpikeFlag {
  code: number;
  currentRate: number;
  baselineRate: number;
  multiplier: number;
}

interface SipErrorVendorWithSpikes extends SipVendorSnapshot {
  spikes: SipSpikeFlag[];
  hasSpike: boolean;
}

interface SipErrorsTabData {
  success: boolean;
  vendors: SipErrorVendorWithSpikes[];
  spikeCount: number;
  computedAt: string;
}

interface SipHistoryEntry {
  date: string;
  rates: Record<number, number>;
  baselines: Record<number, number>;
}

function SipErrorHistoryChart({ vendorName }: { vendorName: string }) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const { data } = useQuery<{ success: boolean; history: SipHistoryEntry[] }>({
    queryKey: ["/api/route-intelligence/vendor", vendorName, "error-history"],
    queryFn: () => fetch(`/api/route-intelligence/vendor/${encodeURIComponent(vendorName)}/error-history?days=7`).then(r => r.json()),
    staleTime: 15 * 60 * 1000,
  });

  const history = data?.history ?? [];
  if (history.length === 0) return <span className="text-[10px] text-muted-foreground/40">No 7d data</span>;

  const codes = [503, 486, 480] as const;
  const colors = ["#ef4444", "#f59e0b", "#fb923c"] as const;

  const maxRate = Math.max(
    ...history.flatMap(h => [
      ...Object.values(h.rates),
      ...Object.values(h.baselines ?? {}),
    ]),
    5,
  );
  const H = 36, W = Math.max(history.length * 10, 70);
  const stepX = W / Math.max(history.length - 1, 1);

  const toY = (rate: number) => H - (rate / maxRate) * H;

  const hoveredEntry = hoveredIdx != null ? history[hoveredIdx] : null;

  return (
    <div className="flex flex-col gap-1">
      <div className="relative" style={{ width: W }}>
        <svg
          width={W}
          height={H}
          className="overflow-visible"
          data-testid={`sip-sparkline-${vendorName}`}
          onMouseLeave={() => setHoveredIdx(null)}
        >
          {codes.map((code, ci) => {
            const ratePts = history.map((h, i) => `${i * stepX},${toY(h.rates[code] ?? 0)}`);
            const basePts = history
              .map((h, i) => (h.baselines?.[code] != null ? `${i * stepX},${toY(h.baselines[code])}` : null))
              .filter(Boolean) as string[];

            return (
              <g key={code}>
                {ratePts.length >= 2 && (
                  <polyline
                    points={ratePts.join(" ")}
                    fill="none"
                    stroke={colors[ci]}
                    strokeWidth={1.3}
                    opacity={0.8}
                  />
                )}
                {basePts.length >= 2 && (
                  <polyline
                    points={basePts.join(" ")}
                    fill="none"
                    stroke={colors[ci]}
                    strokeWidth={1}
                    strokeDasharray="3 2"
                    opacity={0.45}
                  />
                )}
              </g>
            );
          })}

          {history.map((_, i) => (
            <rect
              key={i}
              x={i * stepX - stepX / 2}
              y={0}
              width={stepX}
              height={H}
              fill="transparent"
              onMouseEnter={() => setHoveredIdx(i)}
              style={{ cursor: "default" }}
            />
          ))}

          {hoveredIdx != null && (
            <line
              x1={hoveredIdx * stepX}
              y1={0}
              x2={hoveredIdx * stepX}
              y2={H}
              stroke="currentColor"
              strokeWidth={0.5}
              opacity={0.3}
              className="text-foreground"
            />
          )}
        </svg>

        {hoveredEntry && hoveredIdx != null && (
          <div
            className="absolute z-10 pointer-events-none bg-popover border border-border rounded shadow-md text-[10px] p-1.5 min-w-[110px]"
            style={{
              left: hoveredIdx * stepX > W / 2 ? undefined : hoveredIdx * stepX + 6,
              right: hoveredIdx * stepX > W / 2 ? W - hoveredIdx * stepX + 6 : undefined,
              top: 0,
            }}
            data-testid={`sip-tooltip-${vendorName}`}
          >
            <div className="font-medium text-muted-foreground mb-0.5">{hoveredEntry.date}</div>
            {codes.map((code, ci) => {
              const rate = hoveredEntry.rates[code];
              const base = hoveredEntry.baselines?.[code];
              if (rate == null && base == null) return null;
              return (
                <div key={code} className="flex items-center gap-1 leading-snug">
                  <span style={{ color: colors[ci] }} className="font-semibold">{code}</span>
                  <span className="text-foreground">{(rate ?? 0).toFixed(1)}%</span>
                  {base != null && (
                    <span className="text-muted-foreground/60">
                      / <span className="text-[9px]">base</span> {base.toFixed(1)}%
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex gap-2 text-[9px] text-muted-foreground/70">
        {codes.map((code, ci) => (
          <span key={code} className="flex items-center gap-0.5">
            <span style={{ background: colors[ci] }} className="inline-block w-2 h-0.5 rounded-full opacity-70" />
            {code}
          </span>
        ))}
        <span className="flex items-center gap-0.5 ml-1 opacity-60">
          <svg width="10" height="4" className="inline-block">
            <line x1="0" y1="2" x2="10" y2="2" stroke="currentColor" strokeWidth="1" strokeDasharray="2 1.5" />
          </svg>
          <span>base</span>
        </span>
      </div>
    </div>
  );
}

type SipExportPreset = 1 | 7 | 30 | "custom";

function SipErrorsTab() {
  const { user } = useAuth();
  const userId = user?.id ?? "guest";
  const lsVendorKey = `sip-errors-filter-vendor-${userId}`;
  const lsCodeKey = `sip-errors-filter-code-${userId}`;

  const [activeWin, setActiveWin] = useState<15 | 60 | 240>(60);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showPrefixHeatmap, setShowPrefixHeatmap] = useState(false);

  // Export date-range state
  const [exportPreset, setExportPreset] = useState<SipExportPreset>(7);
  const [exportFrom, setExportFrom] = useState<string>("");
  const [exportTo, setExportTo] = useState<string>("");
  const [showCustomRange, setShowCustomRange] = useState(false);

  // Export filter state — persisted to localStorage per user.
  // Start empty; a rehydration effect below populates from the correct user's keys
  // once the userId is known (useAuth resolves asynchronously).
  const [exportVendor, setExportVendor] = useState<string>("");
  const [exportCode, setExportCode] = useState<string>("");

  // Track which userId we last hydrated for to avoid re-running on unrelated renders
  // and to gate persistence so we never overwrite real-user keys with guest/empty state.
  const lastHydratedUserId = useRef<string | null>(null);

  // Rehydrate from localStorage whenever userId resolves or changes
  useEffect(() => {
    if (lastHydratedUserId.current === userId) return;
    lastHydratedUserId.current = userId;
    setExportVendor(localStorage.getItem(lsVendorKey) ?? "");
    setExportCode(localStorage.getItem(lsCodeKey) ?? "");
  }, [userId, lsVendorKey, lsCodeKey]);

  // Persist vendor filter — only after hydration for the current user is complete
  useEffect(() => {
    if (lastHydratedUserId.current !== userId) return;
    if (exportVendor) {
      localStorage.setItem(lsVendorKey, exportVendor);
    } else {
      localStorage.removeItem(lsVendorKey);
    }
  }, [exportVendor, lsVendorKey, userId]);

  // Persist code filter — only after hydration for the current user is complete
  useEffect(() => {
    if (lastHydratedUserId.current !== userId) return;
    if (exportCode) {
      localStorage.setItem(lsCodeKey, exportCode);
    } else {
      localStorage.removeItem(lsCodeKey);
    }
  }, [exportCode, lsCodeKey, userId]);

  const clearFilters = () => {
    setExportVendor("");
    setExportCode("");
  };

  const { data, isLoading, refetch, isFetching } = useQuery<SipErrorsTabData>({
    queryKey: ["/api/route-intelligence/sip-errors"],
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  const { data: copilotData, isLoading: prefixLoading } = useQuery<SipErrorData>({
    queryKey: ["/api/copilot/sip-errors"],
    enabled: showPrefixHeatmap,
    staleTime: 5 * 60 * 1000,
    refetchInterval: showPrefixHeatmap ? 5 * 60 * 1000 : false,
  });

  const vendors = data?.vendors ?? [];
  const spikeVendors = vendors.filter(v => v.hasSpike);
  const spikeVendorNames = new Set(spikeVendors.map(v => v.vendorName));
  const windowLabel: Record<number, string> = { 15: "15 min", 60: "1 hr", 240: "4 hr" };
  const prefixRows = copilotData?.prefixRows ?? [];

  const toggleExpand = (name: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });

  // Build the export URL from the current selection + optional filters
  const exportUrl = (() => {
    let base: string;
    if (exportPreset === "custom" && exportFrom && exportTo) {
      base = `/api/route-intelligence/sip-errors/export?from=${exportFrom}&to=${exportTo}`;
    } else if (exportPreset === "custom") {
      return null; // not ready yet
    } else {
      base = `/api/route-intelligence/sip-errors/export?days=${exportPreset}`;
    }
    if (exportVendor) base += `&vendor=${encodeURIComponent(exportVendor)}`;
    if (exportCode) base += `&code=${encodeURIComponent(exportCode)}`;
    return base;
  })();

  const handlePresetClick = (p: SipExportPreset) => {
    setExportPreset(p);
    setShowCustomRange(p === "custom");
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-semibold text-base flex items-center gap-2">
            <Radio className="h-4 w-4 text-cyan-500" />
            SIP Error Intelligence
            {spikeVendors.length > 0 && (
              <span className="text-[11px] font-bold uppercase tracking-wide text-amber-500 bg-amber-500/10 border border-amber-500/25 px-2 py-0.5 rounded-full">
                {spikeVendors.length} spike{spikeVendors.length > 1 ? "s" : ""} active
              </span>
            )}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {showPrefixHeatmap
              ? "Prefix × vendor heatmap — dominant SIP code per destination range per carrier"
              : "Error code distribution per vendor · Spike = ≥2× 24h baseline AND ≥2% absolute · 7-day history preserved"}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {(isLoading || isFetching || (showPrefixHeatmap && prefixLoading)) && (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          )}

          {/* Date-range selector */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* Preset buttons */}
            <div className="flex items-center bg-muted/50 rounded-md p-0.5 gap-0.5" data-testid="sip-export-preset-group">
              {([1, 7, 30, "custom"] as SipExportPreset[]).map(p => (
                <button
                  key={String(p)}
                  data-testid={`sip-export-preset-${p}`}
                  onClick={() => handlePresetClick(p)}
                  className={cn(
                    "px-2 py-1 text-xs font-medium rounded transition-colors",
                    exportPreset === p
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {p === "custom" ? "Custom" : `${p}d`}
                </button>
              ))}
            </div>

            {/* Custom date inputs */}
            {showCustomRange && (
              <div className="flex items-center gap-1" data-testid="sip-export-custom-range">
                <input
                  type="date"
                  data-testid="sip-export-from"
                  value={exportFrom}
                  onChange={e => setExportFrom(e.target.value)}
                  className="text-xs border border-border/60 rounded px-1.5 py-1 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <span className="text-xs text-muted-foreground">–</span>
                <input
                  type="date"
                  data-testid="sip-export-to"
                  value={exportTo}
                  onChange={e => setExportTo(e.target.value)}
                  min={exportFrom || undefined}
                  className="text-xs border border-border/60 rounded px-1.5 py-1 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            )}

            {/* Vendor filter */}
            <select
              data-testid="sip-export-vendor-filter"
              value={exportVendor}
              onChange={e => setExportVendor(e.target.value)}
              title="Filter export by vendor"
              className="text-xs border border-border/60 rounded px-1.5 py-1 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring max-w-[130px]"
            >
              <option value="">All vendors</option>
              {vendors.map(v => (
                <option key={v.vendorName} value={v.vendorName}>{v.vendorName}</option>
              ))}
            </select>

            {/* Error code filter */}
            <select
              data-testid="sip-export-code-filter"
              value={exportCode}
              onChange={e => setExportCode(e.target.value)}
              title="Filter export by SIP error code"
              className="text-xs border border-border/60 rounded px-1.5 py-1 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">All codes</option>
              {SIP_CODES.map(c => (
                <option key={c} value={String(c)}>{CODE_FULL[c]}</option>
              ))}
            </select>

            {/* Clear filters link — only shown when a filter is active */}
            {(exportVendor || exportCode) && (
              <button
                data-testid="sip-filter-clear"
                onClick={clearFilters}
                className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
              >
                Clear filters
              </button>
            )}

            {/* Export button */}
            {exportUrl ? (
              <a
                data-testid="sip-errors-export-csv"
                href={exportUrl}
                download
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md border border-border/40 hover:border-border"
              >
                <Download className="h-3.5 w-3.5" />
                Export CSV
              </a>
            ) : (
              <span
                data-testid="sip-errors-export-csv-disabled"
                className="flex items-center gap-1.5 text-xs text-muted-foreground/40 px-2 py-1 rounded-md border border-border/20 cursor-not-allowed select-none"
                title="Select a from and to date to export"
              >
                <Download className="h-3.5 w-3.5" />
                Export CSV
              </span>
            )}
          </div>
          <button
            data-testid="sip-errors-tab-refresh"
            onClick={() => refetch()}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md border border-border/40 hover:border-border"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {/* Spike Alert Banners */}
      {spikeVendors.length > 0 && (
        <div className="space-y-2" data-testid="sip-spike-banners">
          {spikeVendors.map(v => (
            <div key={v.vendorName} className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/8 px-4 py-3">
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">
                  {v.vendorName} — SIP Error Spike Detected
                </p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                  {v.spikes.map(spike => (
                    <span key={spike.code} className="text-xs text-muted-foreground" data-testid={`spike-${v.vendorName}-${spike.code}`}>
                      <span className="font-mono font-semibold text-amber-500">{CODE_FULL[spike.code] ?? spike.code}</span>
                      {" — "}
                      <span className="font-mono">{spike.currentRate.toFixed(1)}%</span>
                      {" vs "}
                      <span className="font-mono">{spike.baselineRate.toFixed(1)}%</span>
                      {" baseline ("}
                      <span className="font-semibold text-red-500">{spike.multiplier.toFixed(1)}×</span>
                      {")"}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Controls row: window selector + prefix heatmap toggle */}
      <div className="flex items-center gap-3 flex-wrap">
        {!showPrefixHeatmap && (
          <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-0.5">
            {([15, 60, 240] as const).map(w => (
              <button
                key={w}
                data-testid={`sip-tab-window-${w}`}
                onClick={() => setActiveWin(w)}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                  activeWin === w
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {windowLabel[w]}
              </button>
            ))}
          </div>
        )}
        <button
          data-testid="sip-prefix-heatmap-toggle"
          onClick={() => setShowPrefixHeatmap(v => !v)}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors",
            showPrefixHeatmap
              ? "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border-cyan-500/30"
              : "bg-muted/40 text-muted-foreground border-border/40 hover:border-border hover:text-foreground"
          )}
        >
          <LayoutGrid className="h-3.5 w-3.5" />
          Prefix Heatmap
        </button>
      </div>

      {/* Prefix heatmap view */}
      {showPrefixHeatmap && (
        prefixLoading ? (
          <div className="rounded-xl border bg-card flex items-center justify-center py-20">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <SipPrefixHeatmapGrid
            prefixRows={prefixRows}
            spikeVendorNames={spikeVendorNames}
          />
        )
      )}

      {/* Loading */}
      {!showPrefixHeatmap && isLoading && (
        <div className="rounded-xl border bg-card flex items-center justify-center py-20">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty */}
      {!showPrefixHeatmap && !isLoading && vendors.length === 0 && (
        <div className="rounded-xl border bg-card flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Radio className="h-8 w-8 mb-3 opacity-25" />
          <p className="text-sm font-medium">No SIP error data yet</p>
          <p className="text-xs mt-1 opacity-60">The aggregator runs every 5 min after the first CDR cache refresh</p>
        </div>
      )}

      {/* Vendor table */}
      {!showPrefixHeatmap && !isLoading && vendors.length > 0 && (
        <div className="rounded-xl border bg-card overflow-hidden">
          {/* Table header */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/50 bg-muted/30">
                  <th className="text-left py-2.5 px-4 text-muted-foreground font-medium min-w-[160px]">Vendor</th>
                  {SIP_CODES.map(c => (
                    <th key={c} className="text-right py-2.5 px-3 text-muted-foreground font-medium font-mono min-w-[72px]" title={CODE_FULL[c]}>
                      {CODE_LABELS[c]}
                    </th>
                  ))}
                  <th className="text-center py-2.5 px-3 text-muted-foreground font-medium min-w-[60px]">Status</th>
                  <th className="text-center py-2.5 px-3 text-muted-foreground font-medium min-w-[80px]">7d Trend</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {vendors.map(v => {
                  const win = v.windows[activeWin] ?? {};
                  const isOpen = expanded.has(v.vendorName);
                  return (
                    <>
                      <tr
                        key={v.vendorName}
                        className={cn(
                          "hover:bg-muted/20 transition-colors cursor-pointer",
                          v.hasSpike && "bg-amber-500/5"
                        )}
                        onClick={() => toggleExpand(v.vendorName)}
                        data-testid={`sip-errors-row-${v.vendorName}`}
                      >
                        <td className="py-2.5 px-4">
                          <div className="flex items-center gap-2">
                            {v.hasSpike && (
                              <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                            )}
                            <span className="font-medium truncate max-w-[140px]" title={v.vendorName}>
                              {v.vendorName}
                            </span>
                          </div>
                        </td>
                        {SIP_CODES.map(code => {
                          const entry = win[code] ?? { rate: 0, count: 0 };
                          const spike = v.spikes.find(s => s.code === code);
                          return (
                            <td key={code} className="py-2.5 px-3 text-right tabular-nums">
                              {entry.rate > 0 ? (
                                <div className="flex flex-col items-end gap-0.5">
                                  <div className="flex items-center gap-1">
                                    {spike && (
                                      <span className="text-[8px] font-bold text-amber-500 bg-amber-500/15 border border-amber-500/25 px-1 py-0.5 rounded leading-none" title={`${spike.multiplier.toFixed(1)}× spike`}>
                                        ↑{spike.multiplier.toFixed(1)}×
                                      </span>
                                    )}
                                    <span className={cn("font-mono font-semibold text-[11px]", rateColor(entry.rate))}>
                                      {entry.rate.toFixed(1)}%
                                    </span>
                                  </div>
                                  <span className="text-[9px] text-muted-foreground/60 font-mono">{entry.count}×</span>
                                </div>
                              ) : (
                                <span className="text-muted-foreground/25 font-mono text-[11px]">—</span>
                              )}
                            </td>
                          );
                        })}
                        <td className="py-2.5 px-3 text-center">
                          {v.hasSpike ? (
                            <span className="text-[9px] font-bold uppercase text-amber-500 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded">
                              Spike
                            </span>
                          ) : v.hasCongestion ? (
                            <span className="text-[9px] font-bold uppercase text-red-500 bg-red-500/10 border border-red-500/20 px-1.5 py-0.5 rounded">
                              Congestion
                            </span>
                          ) : v.hasCliRejection ? (
                            <span className="text-[9px] font-bold uppercase text-orange-500 bg-orange-500/10 border border-orange-500/20 px-1.5 py-0.5 rounded">
                              CLI Rej.
                            </span>
                          ) : (
                            <span className="text-[9px] text-green-500 opacity-60">ok</span>
                          )}
                        </td>
                        <td className="py-1.5 px-3">
                          {isOpen && <SipErrorHistoryChart vendorName={v.vendorName} />}
                          {!isOpen && <span className="text-[10px] text-muted-foreground/40">click</span>}
                        </td>
                        <td className="py-2.5 px-2 text-muted-foreground/50">
                          {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr key={`${v.vendorName}-detail`} className="bg-muted/10">
                          <td colSpan={SIP_CODES.length + 4} className="px-4 py-3">
                            <div className="space-y-3">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-semibold text-foreground">{v.vendorName} — 7-day SIP Error Trend</span>
                                <span className="text-[10px] text-muted-foreground">(503 red · 486 amber · 480 orange)</span>
                              </div>
                              <SipErrorHistoryChart vendorName={v.vendorName} />
                              {/* Show all window rates for this vendor */}
                              <div className="grid grid-cols-3 gap-3">
                                {([15, 60, 240] as const).map(w => {
                                  const wWin = v.windows[w] ?? {};
                                  return (
                                    <div key={w} className="rounded-lg bg-background border border-border/40 p-2.5">
                                      <p className="text-[10px] text-muted-foreground font-semibold mb-1.5">{windowLabel[w]} window</p>
                                      {SIP_CODES.filter(c => (wWin[c]?.rate ?? 0) > 0).map(c => (
                                        <div key={c} className="flex items-center justify-between text-[10px]">
                                          <span className="text-muted-foreground font-mono">{CODE_FULL[c]}</span>
                                          <span className={cn("font-mono font-semibold", rateColor(wWin[c]?.rate ?? 0))}>
                                            {(wWin[c]?.rate ?? 0).toFixed(1)}%
                                          </span>
                                        </div>
                                      ))}
                                      {SIP_CODES.filter(c => (wWin[c]?.rate ?? 0) > 0).length === 0 && (
                                        <p className="text-[10px] text-muted-foreground/40">No errors in window</p>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 px-4 py-2.5 border-t border-border/30 bg-muted/10">
            {[
              { label: "< 2%",   color: "bg-green-500", text: "Normal" },
              { label: "2–10%",  color: "bg-amber-500", text: "Elevated" },
              { label: "> 10%",  color: "bg-red-500",   text: "Critical" },
            ].map(({ label, color, text }) => (
              <div key={text} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <div className={cn("w-2 h-2 rounded-full", color)} />
                {label} — {text}
              </div>
            ))}
            <span className="ml-auto text-[10px] text-muted-foreground/50">
              Spike = ≥2× 24h avg AND ≥2% · Data: {data?.computedAt ? new Date(data.computedAt).toLocaleTimeString() : "—"}
            </span>
          </div>
        </div>
      )}
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

// ── RollbackHistoryPanel ──────────────────────────────────────────────────────

interface RollbackSibling {
  id: number;
  action_type: string;
  status: string;
  primary_action: string;
  requested_by: string;
  requested_by_name: string | null;
  verification_state: string;
  created_at: string;
  updated_at: string;
  recommendation_ref: Record<string, unknown> | null;
  sippy_result: Record<string, unknown> | null;
}

interface ActionHistoryRow {
  id: number;
  account_id: string;
  account_name: string;
  action_type: string;
  status: string;
  primary_action: string;
  requested_by: string;
  requested_by_name: string | null;
  approved_by: string | null;
  approved_by_name: string | null;
  verification_state: string;
  created_at: string;
  updated_at: string;
  recommendation_ref: Record<string, unknown> | null;
  rollbacks: RollbackSibling[];
}

function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return d.toLocaleDateString();
}

function fmtAbsolute(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString([], { dateStyle: "short", timeStyle: "short" });
}

const VSTATE_CFG: Record<string, { label: string; cls: string }> = {
  SUCCESS_CONFIRMED: { label: "Verified",     cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  FAILED_CONFIRMED:  { label: "Failed",       cls: "bg-rose-500/10 text-rose-400 border-rose-500/20"         },
  UNKNOWN_PENDING:   { label: "Unverified",   cls: "bg-amber-500/10 text-amber-400 border-amber-500/20"      },
  not_applicable:    { label: "N/A",          cls: "bg-muted/40 text-muted-foreground border-border"         },
};

const STATUS_CFG: Record<string, { label: string; cls: string; icon: any }> = {
  executed:         { label: "Executed",     cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", icon: CheckCircle2 },
  rolled_back:      { label: "Rolled Back",  cls: "bg-orange-500/10 text-orange-400 border-orange-500/20",   icon: RotateCcw    },
  dry_run_approved: { label: "Dry-Run",      cls: "bg-sky-500/10 text-sky-400 border-sky-500/20",            icon: Eye          },
  pending:          { label: "Pending",      cls: "bg-amber-500/10 text-amber-400 border-amber-500/20",      icon: Clock        },
  rejected:         { label: "Rejected",     cls: "bg-rose-500/10 text-rose-400 border-rose-500/20",         icon: XCircle      },
  failed:           { label: "Failed",       cls: "bg-rose-500/10 text-rose-400 border-rose-500/30",         icon: AlertTriangle },
  snoozed:          { label: "Snoozed",      cls: "bg-muted/40 text-muted-foreground border-border",         icon: Clock        },
};

function VerificationBadge({ state }: { state: string }) {
  const cfg = VSTATE_CFG[state] ?? VSTATE_CFG.not_applicable;
  return (
    <Badge variant="outline" className={cn("text-[10px] h-4 px-1.5", cfg.cls)}>
      {cfg.label}
    </Badge>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] ?? STATUS_CFG.pending;
  const Icon = cfg.icon;
  return (
    <Badge variant="outline" className={cn("text-[10px] h-4 px-1.5 gap-0.5", cfg.cls)}>
      <Icon className="h-2.5 w-2.5" />
      {cfg.label}
    </Badge>
  );
}

function RollbackSiblingRow({ rb }: { rb: RollbackSibling }) {
  const note = typeof rb.recommendation_ref === "object" && rb.recommendation_ref
    ? (rb.recommendation_ref.note as string | undefined) ?? rb.primary_action
    : rb.primary_action;
  return (
    <div className="flex items-start gap-2.5 py-2 pl-3 border-l-2 border-orange-500/40 ml-3 mt-1.5">
      <RotateCcw className="h-3.5 w-3.5 text-orange-400 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-orange-400">Rollback #{rb.id}</span>
          <VerificationBadge state={rb.verification_state} />
        </div>
        {note && (
          <p className="text-xs text-muted-foreground mt-0.5 truncate" title={note}>{note}</p>
        )}
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground/70">
            <UserCheck className="h-3 w-3" />
            {rb.requested_by_name ?? rb.requested_by}
          </span>
          <span className="text-[10px] text-muted-foreground/50" title={fmtAbsolute(rb.created_at)}>
            {fmtRelative(rb.created_at)}
          </span>
        </div>
      </div>
    </div>
  );
}

function ActionHistoryRowCard({ row }: { row: ActionHistoryRow }) {
  const [expanded, setExpanded] = useState(false);
  const hasRollbacks = row.rollbacks.length > 0;
  const ref = row.recommendation_ref as any;

  return (
    <div
      className={cn(
        "rounded-lg border bg-card transition-colors",
        hasRollbacks && row.status === "rolled_back" ? "border-orange-500/30" : "border-border",
      )}
      data-testid={`action-history-row-${row.id}`}
    >
      <div
        className="flex items-start gap-3 p-3 cursor-pointer hover:bg-muted/20"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono text-muted-foreground/60">#{row.id}</span>
            <span className="text-sm font-medium truncate max-w-[220px]" title={row.account_name}>
              {row.account_name}
            </span>
            <StatusBadge status={row.status} />
            <VerificationBadge state={row.verification_state} />
            {hasRollbacks && (
              <Badge variant="outline" className="text-[10px] h-4 px-1.5 bg-orange-500/10 text-orange-400 border-orange-500/20 gap-0.5">
                <RotateCcw className="h-2.5 w-2.5" />
                {row.rollbacks.length} rollback{row.rollbacks.length > 1 ? "s" : ""}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1 truncate" title={row.primary_action}>
            {row.primary_action}
          </p>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground/70">
              <UserCheck className="h-3 w-3" />
              Applied by: {row.approved_by_name ?? row.requested_by_name ?? row.requested_by}
            </span>
            <span className="text-[10px] text-muted-foreground/50" title={fmtAbsolute(row.created_at)}>
              {fmtRelative(row.created_at)}
            </span>
            {ref?.source_mode && (
              <span className={cn(
                "text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border",
                ref.source_mode === "ai_enhanced"
                  ? "bg-violet-500/10 text-violet-400 border-violet-500/20"
                  : "bg-amber-500/10 text-amber-400 border-amber-500/20",
              )}>
                {ref.source_mode === "ai_enhanced" ? "AI" : "Rule"}
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-muted-foreground">
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border/40 px-3 pb-3 pt-2 space-y-2">
          {/* Meta details */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <div>
              <span className="text-muted-foreground/60">Action type: </span>
              <span className="font-mono text-foreground/80">{row.action_type}</span>
            </div>
            <div>
              <span className="text-muted-foreground/60">Applied at: </span>
              <span>{fmtAbsolute(row.created_at)}</span>
            </div>
            <div>
              <span className="text-muted-foreground/60">Applied by: </span>
              <span>{row.approved_by_name ?? row.approved_by ?? row.requested_by_name ?? row.requested_by}</span>
            </div>
            <div>
              <span className="text-muted-foreground/60">Verification: </span>
              <span>{row.verification_state}</span>
            </div>
          </div>

          {/* Rollback trail */}
          {hasRollbacks ? (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                Rollback Trail
              </p>
              {row.rollbacks.map(rb => (
                <RollbackSiblingRow key={rb.id} rb={rb} />
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground/50 italic">No rollbacks recorded for this action.</p>
          )}
        </div>
      )}
    </div>
  );
}

type HistoryFilter = "all" | "active" | "rolled_back";

// ── CSV export helper ─────────────────────────────────────────────────────────

function escCsv(v: string | number | null | undefined): string {
  if (v == null) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function exportHistoryCsv(rows: ActionHistoryRow[]) {
  const headers = [
    "ID", "Account ID", "Account Name", "Action Type", "Status",
    "Applied By", "Applied At", "Rolled Back By", "Rolled Back At", "Verification State",
  ];
  const lines: string[] = [headers.join(",")];
  for (const r of rows) {
    const appliedBy = r.approved_by_name ?? r.approved_by ?? r.requested_by_name ?? r.requested_by;
    const rb = r.rollbacks[0] ?? null;
    const rbBy = rb ? (rb.requested_by_name ?? rb.requested_by) : null;
    const rbAt = rb ? rb.created_at : null;
    lines.push([
      r.id,
      escCsv(r.account_id),
      escCsv(r.account_name),
      escCsv(r.action_type),
      escCsv(r.status),
      escCsv(appliedBy),
      escCsv(r.created_at),
      escCsv(rbBy),
      escCsv(rbAt),
      escCsv(r.verification_state),
    ].join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `rollback-history-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── RollbackHistoryPanel ──────────────────────────────────────────────────────

function RollbackHistoryPanel() {
  const [filter, setFilter]     = useState<HistoryFilter>("all");
  const [search, setSearch]     = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo]     = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search]);

  const buildUrl = () => {
    const params = new URLSearchParams();
    if (filter !== "all") params.set("filter", filter);
    if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo)   params.set("dateTo", dateTo);
    const qs = params.toString();
    return qs ? `/api/ai/route-copilot/action-history?${qs}` : "/api/ai/route-copilot/action-history";
  };

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<{ success: boolean; actions: ActionHistoryRow[] }>({
    queryKey: ["/api/ai/route-copilot/action-history", filter, debouncedSearch, dateFrom, dateTo],
    queryFn: async () => {
      const res = await fetch(buildUrl(), { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const actions = data?.actions ?? [];
  const rolledBackCount = actions.filter(a => a.status === "rolled_back").length;
  const activeCount     = actions.filter(a => a.status === "executed").length;
  const hasActiveFilters = debouncedSearch.trim() !== "" || dateFrom !== "" || dateTo !== "";

  const FILTERS: { key: HistoryFilter; label: string }[] = [
    { key: "all",         label: `All (${actions.length})` },
    { key: "active",      label: `Active (${activeCount})` },
    { key: "rolled_back", label: `Rolled Back (${rolledBackCount})` },
  ];

  function clearFilters() {
    setSearch("");
    setDateFrom("");
    setDateTo("");
    setFilter("all");
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-xl border bg-gradient-to-br from-orange-500/5 via-card to-card border-orange-500/20 p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-orange-500/15 border border-orange-500/25 flex items-center justify-center">
              <History className="h-4 w-4 text-orange-400" />
            </div>
            <div>
              <h2 className="font-bold text-sm">Action Rollback History</h2>
              <p className="text-xs text-muted-foreground">
                Full rollback trail for every AI Copilot action applied to the ledger
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-8 text-xs"
              disabled={actions.length === 0}
              onClick={() => exportHistoryCsv(actions)}
              data-testid="history-export-csv-btn"
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-8 text-xs"
              disabled={isFetching}
              onClick={() => refetch()}
              data-testid="history-refresh-btn"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mt-4">
          {[
            { label: "Total Actions",  value: actions.length,      color: "text-foreground"  },
            { label: "Active",         value: activeCount,         color: "text-emerald-400" },
            { label: "Rolled Back",    value: rolledBackCount,     color: "text-orange-400"  },
          ].map(s => (
            <div key={s.label} className="rounded-lg bg-muted/30 border border-border/50 p-3 text-center">
              <p className={cn("text-2xl font-black tabular-nums font-mono", s.color)}>{s.value}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Search + Date Range */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        {/* Search input */}
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search by account, action type, or operator…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            data-testid="history-search-input"
            className="w-full h-8 pl-8 pr-3 text-xs rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-orange-500/40"
          />
        </div>
        {/* Date from */}
        <div className="relative">
          <CalendarDays className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            data-testid="history-date-from"
            title="From date"
            className="h-8 pl-8 pr-2 text-xs rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-orange-500/40 w-[140px]"
          />
        </div>
        <span className="text-xs text-muted-foreground hidden sm:inline">to</span>
        {/* Date to */}
        <div className="relative">
          <CalendarDays className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            data-testid="history-date-to"
            title="To date"
            className="h-8 pl-8 pr-2 text-xs rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-orange-500/40 w-[140px]"
          />
        </div>
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            data-testid="history-clear-filters-btn"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground border border-border rounded-md px-2.5 h-8 transition-colors"
          >
            <X className="h-3 w-3" />
            Clear
          </button>
        )}
      </div>

      {/* Status Filters */}
      <div className="flex items-center gap-2">
        <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            data-testid={`history-filter-${f.key}`}
            className={cn(
              "text-xs px-3 py-1 rounded-full border transition-colors",
              filter === f.key
                ? "bg-orange-500/15 text-orange-400 border-orange-500/30"
                : "text-muted-foreground border-border hover:bg-muted/40",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* List */}
      {isLoading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Loading action history…</span>
        </div>
      )}

      {isError && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-4 py-3 flex items-center gap-2 text-rose-400">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <p className="text-sm">{(error as Error).message}</p>
        </div>
      )}

      {!isLoading && !isError && actions.length === 0 && (
        <div className="rounded-lg border bg-card flex flex-col items-center justify-center py-16 text-muted-foreground">
          <History className="h-8 w-8 mb-2 opacity-30" />
          <p className="text-sm">
            {hasActiveFilters ? "No actions match your search criteria" : "No actions found for this filter"}
          </p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            {hasActiveFilters
              ? "Try adjusting your search terms or date range."
              : "Apply recommendations from the AI Copilot tab to see them here."}
          </p>
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="mt-3 text-xs text-orange-400 hover:text-orange-300 underline"
            >
              Clear all filters
            </button>
          )}
        </div>
      )}

      {!isLoading && !isError && actions.length > 0 && (
        <div className="space-y-2">
          {actions.map(a => (
            <ActionHistoryRowCard key={a.id} row={a} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── CDR Route Intelligence Analytics Panel ─────────────────────────────────────

type RiWindow = "1h" | "4h" | "24h";

interface VendorRow {
  vendorId: string;
  vendorName: string;
  windowHours: number;
  callCount: number;
  answeredCount: number;
  asr: number | null;
  acdSeconds: number | null;
  pddMs: number | null;
  totalCostUsd: number | null;
  revenueUsd: number | null;
  marginUsd: number | null;
  computedAt: string;
}

interface PrefixRow {
  prefix: string;
  callCount: number;
  answeredCount: number;
  asr: number | null;
  acdSeconds: number | null;
  pddMs: number | null;
  totalCostUsd: number | null;
  revenueUsd: number | null;
  marginUsd: number | null;
}

interface TrendPoint { hour: string; asr: number | null; callCount?: number }

// ── VendorChartPanel ─────────────────────────────────────────────────────────

function VendorChartPanel({
  vendorId,
  vendorName,
  onClose,
}: {
  vendorId: string;
  vendorName: string;
  onClose: () => void;
}) {
  const { data, isLoading } = useQuery<{ vendorId: string; trend: TrendPoint[] }>({
    queryKey: ["/api/route-intelligence/vendor", vendorId, "trend"],
    queryFn: () => fetch(`/api/route-intelligence/vendor/${vendorId}/trend`).then(r => r.json()),
    staleTime: 10 * 60 * 1000,
  });

  const trend = data?.trend ?? [];

  const chartData = trend.map(p => ({
    label: p.hour
      ? new Date(p.hour).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })
      : "—",
    calls: p.callCount ?? 0,
    asr: p.asr,
  }));

  const maxCalls = Math.max(...chartData.map(d => d.calls), 1);
  const hasData = chartData.length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.18 }}
      className="rounded-xl border bg-card shadow-sm overflow-hidden"
      data-testid="vendor-chart-panel"
    >
      {/* Panel header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <BarChart2 className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm text-foreground">{vendorName}</span>
          <span className="text-[11px] text-muted-foreground">— 24h call volume &amp; ASR trend</span>
        </div>
        <button
          data-testid="vendor-chart-close"
          onClick={onClose}
          className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Chart body */}
      <div className="px-4 py-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-48 gap-2 text-muted-foreground text-sm">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading trend data…
          </div>
        ) : !hasData ? (
          <div className="flex flex-col items-center justify-center h-48 text-muted-foreground text-sm gap-2">
            <Database className="h-8 w-8 opacity-20" />
            <span>No hourly data yet — run a snapshot to populate the trend.</span>
          </div>
        ) : (
          <div>
            {/* Legend row */}
            <div className="flex items-center gap-5 mb-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-sm bg-primary/40" />
                Call Volume
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-6 border-t-2 border-green-500" />
                ASR %
              </span>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <ComposedChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  yAxisId="calls"
                  orientation="left"
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                  domain={[0, maxCalls]}
                  width={36}
                  tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)}
                />
                <YAxis
                  yAxisId="asr"
                  orientation="right"
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                  domain={[0, 100]}
                  width={32}
                  tickFormatter={(v: number) => `${v}%`}
                />
                <RechartsTooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                    fontSize: "12px",
                    color: "hsl(var(--foreground))",
                  }}
                  formatter={(value: number, name: string) => {
                    if (name === "calls") return [value.toLocaleString(), "Calls"];
                    if (name === "asr") return [`${value != null ? value.toFixed(1) : "—"}%`, "ASR"];
                    return [value, name];
                  }}
                />
                <Bar
                  yAxisId="calls"
                  dataKey="calls"
                  fill="hsl(var(--primary) / 0.35)"
                  stroke="hsl(var(--primary) / 0.6)"
                  strokeWidth={1}
                  radius={[3, 3, 0, 0]}
                  maxBarSize={28}
                  data-testid="chart-bar-volume"
                />
                <Line
                  yAxisId="asr"
                  dataKey="asr"
                  stroke="#22c55e"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: "#22c55e" }}
                  connectNulls
                  data-testid="chart-line-asr"
                />
              </ComposedChart>
            </ResponsiveContainer>

            {/* Summary stats row */}
            {chartData.length > 0 && (() => {
              const validAsr = chartData.filter(d => d.asr != null).map(d => d.asr as number);
              const avgAsr = validAsr.length ? validAsr.reduce((s, v) => s + v, 0) / validAsr.length : null;
              const totalCalls = chartData.reduce((s, d) => s + d.calls, 0);
              const peakCalls = Math.max(...chartData.map(d => d.calls));
              return (
                <div className="flex items-center gap-6 mt-3 pt-3 border-t border-border/40 text-xs text-muted-foreground">
                  <span>
                    <span className="font-semibold text-foreground">{totalCalls.toLocaleString()}</span> total calls
                  </span>
                  <span>
                    <span className="font-semibold text-foreground">{peakCalls.toLocaleString()}</span> peak/hr
                  </span>
                  {avgAsr != null && (
                    <span>
                      Avg ASR:{" "}
                      <span className={cn(
                        "font-semibold",
                        avgAsr >= 65 ? "text-green-600 dark:text-green-400" : avgAsr >= 45 ? "text-amber-500" : "text-red-500"
                      )}>{avgAsr.toFixed(1)}%</span>
                    </span>
                  )}
                  <span className="text-muted-foreground/60">{chartData.length} hourly slots</span>
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </motion.div>
  );
}

function Sparkline({ points }: { points: { asr: number | null }[] }) {
  const vals = points.map(p => p.asr ?? 0);
  if (vals.length < 2) return <span className="text-muted-foreground/30 text-xs">—</span>;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const W = 72, H = 22;
  const stepX = W / (vals.length - 1);
  const points2 = vals.map((v, i) => `${i * stepX},${H - ((v - min) / range) * H}`).join(" ");
  const last = vals[vals.length - 1];
  const color = last >= 65 ? "#22c55e" : last >= 45 ? "#f59e0b" : "#ef4444";
  return (
    <svg width={W} height={H} className="overflow-visible">
      <polyline fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" points={points2} />
    </svg>
  );
}

function AsrBadge({ asr }: { asr: number | null }) {
  if (asr == null) return <span className="text-muted-foreground/40">—</span>;
  const cls = asr >= 65 ? "text-green-600 dark:text-green-400" : asr >= 45 ? "text-amber-500" : "text-red-500";
  return <span className={cn("font-mono font-bold tabular-nums", cls)}>{asr.toFixed(1)}%</span>;
}

function relTimeFromIso(iso: string | null) {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

// ── Vendor Compare Chart (multi-line ASR) ─────────────────────────────────────

const COMPARE_COLORS = [
  "#6366f1", "#22c55e", "#f59e0b", "#3b82f6",
  "#ec4899", "#14b8a6", "#f97316", "#8b5cf6",
  "#ef4444", "#06b6d4",
];

function VendorCompareChart({
  vendors,
  onClose,
}: {
  vendors: { vendorId: string; vendorName: string }[];
  onClose: () => void;
}) {
  const ids = vendors.map(v => v.vendorId);
  const idsParam = ids.join(",");

  const { data, isLoading } = useQuery<{
    trends: Record<string, { hour: string; asr: number | null; callCount: number }[]>;
  }>({
    queryKey: ["/api/route-intelligence/vendor-compare/trend", idsParam],
    queryFn: () =>
      fetch(`/api/route-intelligence/vendor-compare/trend?ids=${encodeURIComponent(idsParam)}`).then(r => r.json()),
    enabled: ids.length > 0,
    staleTime: 10 * 60 * 1000,
  });

  const trends = data?.trends ?? {};

  const allHours = [...new Set(
    Object.values(trends).flatMap(pts => pts.map(p => p.hour))
  )].sort();

  const chartData = allHours.map(hour => {
    const point: Record<string, string | number | null> = {
      label: new Date(hour).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }),
    };
    for (const v of vendors) {
      const pts = trends[v.vendorId] ?? [];
      const match = pts.find(p => p.hour === hour);
      point[v.vendorId] = match?.asr ?? null;
    }
    return point;
  });

  const hasData = chartData.length > 0;
  const activeVendors = vendors.filter(v => (trends[v.vendorId] ?? []).length > 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.18 }}
      className="rounded-xl border bg-card shadow-sm overflow-hidden"
      data-testid="vendor-compare-chart"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm text-foreground">Vendor ASR Comparison</span>
          <span className="text-[11px] text-muted-foreground">— 24h multi-vendor ASR overlay</span>
        </div>
        <button
          data-testid="vendor-compare-close"
          onClick={onClose}
          className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="px-4 py-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-56 gap-2 text-muted-foreground text-sm">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading comparison data…
          </div>
        ) : !hasData ? (
          <div className="flex flex-col items-center justify-center h-56 text-muted-foreground text-sm gap-2">
            <Database className="h-8 w-8 opacity-20" />
            <span>No hourly trend data yet — run a snapshot to populate the comparison.</span>
          </div>
        ) : (
          <div>
            {/* Color-coded legend */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mb-3 text-xs text-muted-foreground">
              {vendors.map((v, i) => (
                <span key={v.vendorId} className="flex items-center gap-1.5">
                  <span
                    className="inline-block w-5 border-t-2 rounded"
                    style={{ borderColor: COMPARE_COLORS[i % COMPARE_COLORS.length] }}
                  />
                  <span
                    className="font-medium"
                    style={{ color: COMPARE_COLORS[i % COMPARE_COLORS.length] }}
                    data-testid={`compare-legend-${i}`}
                  >
                    {v.vendorName}
                  </span>
                </span>
              ))}
            </div>

            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                  domain={[0, 100]}
                  width={32}
                  tickFormatter={(v: number) => `${v}%`}
                />
                <RechartsTooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                    fontSize: "12px",
                    color: "hsl(var(--foreground))",
                  }}
                  formatter={(value: number, name: string) => {
                    const vendor = vendors.find(v => v.vendorId === name);
                    return [
                      value != null ? `${Number(value).toFixed(1)}%` : "—",
                      vendor?.vendorName ?? name,
                    ];
                  }}
                />
                {vendors.map((v, i) => (
                  <Line
                    key={v.vendorId}
                    dataKey={v.vendorId}
                    stroke={COMPARE_COLORS[i % COMPARE_COLORS.length]}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, fill: COMPARE_COLORS[i % COMPARE_COLORS.length] }}
                    connectNulls
                    data-testid={`compare-line-${i}`}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>

            {/* Summary stats row */}
            {activeVendors.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mt-3 pt-3 border-t border-border/40 text-xs text-muted-foreground">
                {activeVendors.map((v, i) => {
                  const pts = trends[v.vendorId] ?? [];
                  const asrs = pts.map(p => p.asr).filter((a): a is number => a != null);
                  const avg = asrs.length ? asrs.reduce((s, a) => s + a, 0) / asrs.length : null;
                  return (
                    <span key={v.vendorId} className="flex items-center gap-1">
                      <span
                        className="inline-block w-2 h-2 rounded-full"
                        style={{ background: COMPARE_COLORS[i % COMPARE_COLORS.length] }}
                      />
                      <span className="font-medium text-foreground">{v.vendorName}</span>
                      {avg != null && (
                        <span className={cn(
                          "font-semibold",
                          avg >= 65 ? "text-green-600 dark:text-green-400" : avg >= 45 ? "text-amber-500" : "text-red-500",
                        )}>
                          avg {avg.toFixed(1)}%
                        </span>
                      )}
                    </span>
                  );
                })}
                <span className="text-muted-foreground/60 ml-auto">{allHours.length} hourly slots</span>
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

interface CdrAnomalyIncident {
  id: number;
  title: string;
  status: string;
  severity: string;
  entityName: string | null;
  openedAt: string;
}

function CdrAnalyticsPanel() {
  const [window, setWindow] = useState<RiWindow>("4h");
  const [expandedVendor, setExpandedVendor] = useState<string | null>(null);
  const [chartVendorId, setChartVendorId] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [sortKey, setSortKey] = useState<"callCount" | "asr" | "acdSeconds" | "pddMs" | "marginUsd" | "revenueUsd">("callCount");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const { lastIncidentUpdated } = useNocWebSocket();

  const { data: openIncidents = [] } = useQuery<CdrAnomalyIncident[]>({
    queryKey: ["/api/noc/incidents", "cdr_anomaly", "open"],
    queryFn: () => fetch("/api/noc/incidents?type=cdr_anomaly&status=open").then(r => r.json()),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!lastIncidentUpdated) return;
    if (["resolved", "mitigated"].includes(lastIncidentUpdated.status)) {
      queryClient.invalidateQueries({ queryKey: ["/api/noc/incidents", "cdr_anomaly", "open"] });
    }
  }, [lastIncidentUpdated]);

  const incidentsByVendor = new Map<string, CdrAnomalyIncident>();
  for (const inc of openIncidents) {
    if (inc.entityName) incidentsByVendor.set(inc.entityName, inc);
  }

  const { data: summaryData, isLoading, refetch, isFetching } = useQuery<{
    vendors: VendorRow[];
    windowHours: number;
    lastUpdatedAt: string | null;
  }>({
    queryKey: ["/api/route-intelligence/vendor-summary", window],
    queryFn: () => fetch(`/api/route-intelligence/vendor-summary?window=${window}`).then(r => r.json()),
    refetchInterval: 15 * 60 * 1000,
    staleTime: 5 * 60 * 1000,
  });

  const { data: prefixData, isLoading: prefixLoading } = useQuery<{
    prefixes: PrefixRow[];
    vendorId: string;
  }>({
    queryKey: ["/api/route-intelligence/vendor", expandedVendor, "prefixes", window],
    queryFn: () => fetch(`/api/route-intelligence/vendor/${expandedVendor}/prefixes?window=${window}`).then(r => r.json()),
    enabled: expandedVendor != null,
    staleTime: 5 * 60 * 1000,
  });

  const { data: trendData } = useQuery<{ trend: TrendPoint[] }>({
    queryKey: ["/api/route-intelligence/vendor", expandedVendor, "trend"],
    queryFn: () => fetch(`/api/route-intelligence/vendor/${expandedVendor}/trend`).then(r => r.json()),
    enabled: expandedVendor != null,
    staleTime: 10 * 60 * 1000,
  });

  const { data: lastUpdated } = useQuery<{ lastUpdatedAt: string | null }>({
    queryKey: ["/api/route-intelligence/last-updated"],
    queryFn: () => fetch("/api/route-intelligence/last-updated").then(r => r.json()),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const triggerMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/route-intelligence/trigger").then(r => r.json()),
    onSuccess: () => setTimeout(() => refetch(), 5000),
  });

  const vendors = summaryData?.vendors ?? [];
  const sorted = [...vendors].sort((a, b) => {
    const av = a[sortKey] ?? (sortDir === "desc" ? -Infinity : Infinity);
    const bv = b[sortKey] ?? (sortDir === "desc" ? -Infinity : Infinity);
    return sortDir === "desc" ? (bv as number) - (av as number) : (av as number) - (bv as number);
  });

  const chartVendor = vendors.find(v => v.vendorId === chartVendorId) ?? null;

  function toggleSort(key: typeof sortKey) {
    if (sortKey === key) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  const thCls = "px-3 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap select-none";
  const thClickCls = cn(thCls, "cursor-pointer hover:text-foreground transition-colors");

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/30 p-0.5">
            {(["1h", "4h", "24h"] as RiWindow[]).map(w => (
              <button
                key={w}
                data-testid={`ri-window-${w}`}
                onClick={() => setWindow(w)}
                className={cn(
                  "px-3 py-1 text-xs font-semibold rounded-md transition-all",
                  window === w
                    ? "bg-background shadow text-foreground border border-border"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >{w}</button>
            ))}
          </div>
          {lastUpdated?.lastUpdatedAt && (
            <span className="text-[11px] text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Updated {relTimeFromIso(lastUpdated.lastUpdatedAt)}
            </span>
          )}
          {!lastUpdated?.lastUpdatedAt && (
            <span className="text-[11px] text-amber-500 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              No snapshots yet
            </span>
          )}
          {incidentsByVendor.size > 0 && (
            <Link
              href={`/noc-incidents?type=cdr_anomaly`}
              data-testid="ri-open-incident-count-badge"
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30 hover:bg-red-500/25 transition-colors whitespace-nowrap"
            >
              <AlertCircle className="h-3 w-3" />
              {incidentsByVendor.size} vendor{incidentsByVendor.size !== 1 ? "s" : ""} with open incidents
            </Link>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            data-testid="ri-compare-toggle"
            onClick={() => {
              setCompareMode(m => !m);
              setChartVendorId(null);
            }}
            className={cn(
              "flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border transition-colors",
              compareMode
                ? "border-primary bg-primary/10 text-primary font-semibold"
                : "border-border text-muted-foreground hover:text-foreground hover:border-primary/30",
            )}
          >
            <Layers className="h-3 w-3" />
            Compare
          </button>
          <button
            data-testid="ri-refresh"
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
            Refresh
          </button>
          <button
            data-testid="ri-trigger"
            onClick={() => triggerMut.mutate()}
            disabled={triggerMut.isPending}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border border-primary/30 text-primary hover:bg-primary/10 transition-colors disabled:opacity-40"
          >
            {triggerMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Database className="h-3 w-3" />}
            Run Now
          </button>
        </div>
      </div>

      {/* Compare chart — all vendors side-by-side when compareMode is active */}
      <AnimatePresence>
        {compareMode && vendors.length > 0 && (
          <VendorCompareChart
            key="compare"
            vendors={sorted.map(v => ({ vendorId: v.vendorId, vendorName: v.vendorName }))}
            onClose={() => setCompareMode(false)}
          />
        )}
      </AnimatePresence>

      {/* Single-vendor chart panel — appears when a vendor row is focused (only in normal mode) */}
      <AnimatePresence>
        {!compareMode && chartVendor && (
          <VendorChartPanel
            key={chartVendor.vendorId}
            vendorId={chartVendor.vendorId}
            vendorName={chartVendor.vendorName}
            onClose={() => setChartVendorId(null)}
          />
        )}
      </AnimatePresence>

      {/* Main table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mr-3" />
          <span className="text-sm">Loading snapshots…</span>
        </div>
      ) : vendors.length === 0 ? (
        <div className="rounded-xl border bg-card flex flex-col items-center justify-center py-20 text-center">
          <Database className="h-10 w-10 mb-3 opacity-20" />
          <p className="font-semibold text-foreground">No snapshots available</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-xs">
            The aggregation engine runs every 15 minutes. Use "Run Now" to trigger an immediate snapshot, or wait for the next scheduled run.
          </p>
          <button
            onClick={() => triggerMut.mutate()}
            disabled={triggerMut.isPending}
            className="mt-4 flex items-center gap-2 text-sm px-4 py-2 rounded-lg border border-primary/40 text-primary hover:bg-primary/10 transition-colors"
            data-testid="ri-trigger-empty"
          >
            {triggerMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
            Generate First Snapshot
          </button>
        </div>
      ) : (
        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className={thCls}>Vendor</th>
                  <th
                    className={thClickCls}
                    onClick={() => toggleSort("callCount")}
                    data-testid="ri-sort-calls"
                  >
                    <span className="flex items-center gap-1">
                      Calls
                      {sortKey === "callCount" && (sortDir === "desc" ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />)}
                    </span>
                  </th>
                  <th
                    className={thClickCls}
                    onClick={() => toggleSort("asr")}
                    data-testid="ri-sort-asr"
                  >
                    <span className="flex items-center gap-1">
                      ASR
                      {sortKey === "asr" && (sortDir === "desc" ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />)}
                    </span>
                  </th>
                  <th
                    className={thClickCls}
                    onClick={() => toggleSort("acdSeconds")}
                    data-testid="ri-sort-acd"
                  >
                    <span className="flex items-center gap-1">
                      ACD (s)
                      {sortKey === "acdSeconds" && (sortDir === "desc" ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />)}
                    </span>
                  </th>
                  <th
                    className={thClickCls}
                    onClick={() => toggleSort("pddMs")}
                    data-testid="ri-sort-pdd"
                  >
                    <span className="flex items-center gap-1">
                      PDD (ms)
                      {sortKey === "pddMs" && (sortDir === "desc" ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />)}
                    </span>
                  </th>
                  <th className={thCls}>Cost (USD)</th>
                  <th
                    className={thClickCls}
                    onClick={() => toggleSort("marginUsd")}
                    data-testid="ri-sort-margin"
                  >
                    <span className="flex items-center gap-1">
                      Margin
                      {sortKey === "marginUsd" && (sortDir === "desc" ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />)}
                    </span>
                  </th>
                  <th className={thCls}>Trend (24h)</th>
                  <th className={thCls} />
                </tr>
              </thead>
              <tbody>
                {sorted.map((vendor, i) => {
                  const isExpanded = expandedVendor === vendor.vendorId;
                  const prefixes = isExpanded ? (prefixData?.prefixes ?? []) : [];
                  return [
                    <tr
                      key={vendor.vendorId}
                      data-testid={`ri-vendor-row-${i}`}
                      className={cn(
                        "border-b border-border/40 transition-colors cursor-pointer",
                        isExpanded ? "bg-primary/5" : "hover:bg-muted/30",
                      )}
                      onClick={() => {
                        setExpandedVendor(isExpanded ? null : vendor.vendorId);
                        setChartVendorId(vendor.vendorId);
                      }}
                    >
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-foreground">{vendor.vendorName}</span>
                          {incidentsByVendor.has(vendor.vendorName) && (
                            <a
                              href={`/noc-incidents?search=${encodeURIComponent(vendor.vendorName)}`}
                              onClick={e => e.stopPropagation()}
                              data-testid={`ri-vendor-incident-badge-${vendor.vendorName}`}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30 hover:bg-red-500/25 transition-colors whitespace-nowrap"
                            >
                              <AlertCircle className="h-2.5 w-2.5" />
                              Incident Open
                            </a>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground font-mono mt-0.5">{vendor.answeredCount}/{vendor.callCount} answered</div>
                      </td>
                      <td className="px-3 py-3">
                        <span className="font-mono tabular-nums">{vendor.callCount.toLocaleString()}</span>
                      </td>
                      <td className="px-3 py-3">
                        <AsrBadge asr={vendor.asr} />
                      </td>
                      <td className="px-3 py-3">
                        {vendor.acdSeconds != null
                          ? <span className="font-mono tabular-nums">{vendor.acdSeconds.toFixed(0)}s</span>
                          : <span className="text-muted-foreground/40">—</span>}
                      </td>
                      <td className="px-3 py-3">
                        {vendor.pddMs != null
                          ? <span className={cn("font-mono tabular-nums", vendor.pddMs > 3000 ? "text-amber-500" : "text-foreground")}>
                              {Math.round(vendor.pddMs)}ms
                            </span>
                          : <span className="text-muted-foreground/40">—</span>}
                      </td>
                      <td className="px-3 py-3">
                        {vendor.totalCostUsd != null
                          ? <span className="font-mono tabular-nums text-muted-foreground">${vendor.totalCostUsd.toFixed(2)}</span>
                          : <span className="text-muted-foreground/40">—</span>}
                      </td>
                      <td className="px-3 py-3">
                        {vendor.marginUsd != null
                          ? <span className={cn("font-mono tabular-nums", vendor.marginUsd >= 0 ? "text-green-600 dark:text-green-400" : "text-red-500")}>
                              {vendor.marginUsd >= 0 ? "+" : ""}${vendor.marginUsd.toFixed(2)}
                            </span>
                          : <span className="text-muted-foreground/40 text-xs italic">pending</span>}
                      </td>
                      <td className="px-3 py-3">
                        <VendorTrendCell vendorId={vendor.vendorId} expanded={isExpanded} />
                      </td>
                      <td className="px-3 py-3 text-right">
                        <ChevronRight className={cn("h-4 w-4 text-muted-foreground transition-transform", isExpanded && "rotate-90")} />
                      </td>
                    </tr>,
                    isExpanded && (
                      <tr key={`${vendor.vendorId}-prefixes`} className="bg-muted/10">
                        <td colSpan={9} className="px-3 py-0">
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden"
                          >
                            <div className="py-3">
                              {prefixLoading ? (
                                <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading prefix breakdown…
                                </div>
                              ) : prefixes.length === 0 ? (
                                <p className="text-xs text-muted-foreground py-2 italic">No prefix data available for this window.</p>
                              ) : (
                                <div>
                                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                                    Prefix Breakdown — {prefixes.length} destination prefixes
                                  </p>
                                  <div className="overflow-x-auto">
                                    <table className="w-full text-xs min-w-[500px]">
                                      <thead>
                                        <tr className="text-muted-foreground border-b border-border/30">
                                          <th className="text-left px-2 py-1.5 font-semibold">Prefix</th>
                                          <th className="text-left px-2 py-1.5 font-semibold">Calls</th>
                                          <th className="text-left px-2 py-1.5 font-semibold">ASR</th>
                                          <th className="text-left px-2 py-1.5 font-semibold">ACD</th>
                                          <th className="text-left px-2 py-1.5 font-semibold">PDD</th>
                                          <th className="text-left px-2 py-1.5 font-semibold">Cost</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {prefixes.slice(0, 20).map((p, pi) => (
                                          <tr key={p.prefix} className="border-b border-border/20 hover:bg-muted/20" data-testid={`ri-prefix-${pi}`}>
                                            <td className="px-2 py-1.5 font-mono font-bold text-primary">{p.prefix}</td>
                                            <td className="px-2 py-1.5 font-mono">{p.callCount}</td>
                                            <td className="px-2 py-1.5"><AsrBadge asr={p.asr} /></td>
                                            <td className="px-2 py-1.5 font-mono">
                                              {p.acdSeconds != null ? `${p.acdSeconds.toFixed(0)}s` : "—"}
                                            </td>
                                            <td className="px-2 py-1.5 font-mono">
                                              {p.pddMs != null ? `${Math.round(p.pddMs)}ms` : "—"}
                                            </td>
                                            <td className="px-2 py-1.5 font-mono text-muted-foreground">
                                              {p.totalCostUsd != null ? `$${p.totalCostUsd.toFixed(3)}` : "—"}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                  {trendData?.trend && trendData.trend.length > 0 && (
                                    <div className="mt-3 pt-3 border-t border-border/30">
                                      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">24h ASR Trend</p>
                                      <div className="flex items-end gap-1 h-10">
                                        <Sparkline points={trendData.trend} />
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </motion.div>
                        </td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Voice Quality Panel ───────────────────────────────────────────────────────

type QualityBadge = 'good' | 'degraded' | 'critical' | 'no_data';

interface HistoryVendorPoint {
  vendorId: string;
  avgMos: number | null;
  avgJitterMs: number | null;
  avgPktLossPct: number | null;
  sampleCount: number;
}

interface HistoryPoint {
  bucket: string;
  ts: number;
  vendors: HistoryVendorPoint[];
}

interface SlotCdr {
  cli: string;
  cld: string;
  connectTime: string | number | null;
  duration: number | null;
  mos: number | null;
  jitter: number | null;
  pktLoss: number | null;
  latency: number | null;
  vendor: string;
}

interface VendorWindow {
  windowMinutes: number;
  avgMos: number | null;
  p10Mos: number | null;
  avgJitterMs: number | null;
  avgPktLossPct: number | null;
  avgLatencyMs: number | null;
  sampleCount: number;
  computedAt: string;
  qualityBadge: QualityBadge;
}

interface VendorQualitySummary {
  vendorId: string;
  windows: VendorWindow[];
  prefixes?: {
    prefix: string;
    windows: {
      windowMinutes: number;
      avgMos: number | null;
      avgJitterMs: number | null;
      avgPktLossPct: number | null;
      avgLatencyMs: number | null;
      sampleCount: number;
      qualityBadge: QualityBadge;
    }[];
  }[];
}

const BADGE_COLOR: Record<QualityBadge, string> = {
  good:     "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
  degraded: "text-amber-400 border-amber-500/30 bg-amber-500/10",
  critical: "text-red-400 border-red-500/30 bg-red-500/10",
  no_data:  "text-muted-foreground border-border bg-muted/30",
};

const MOS_LABEL: Record<QualityBadge, string> = {
  good:     "Good",
  degraded: "Degraded",
  critical: "Critical",
  no_data:  "No Data",
};

function MosBar({ value }: { value: number | null }) {
  if (value == null) return <span className="text-xs text-muted-foreground font-mono">—</span>;
  const pct = Math.max(0, Math.min(100, ((value - 1) / 4) * 100));
  const color = value >= 3.5 ? "bg-emerald-500" : value >= 3.0 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono font-medium tabular-nums w-8 text-right">{value.toFixed(2)}</span>
    </div>
  );
}

/** SVG sparkline — shows MOS trend across 3 windows: 24h → 4h → 1h (oldest left) */
function MosSparkline({ windows }: { windows: VendorWindow[] }) {
  const ordered = [1440, 240, 60]
    .map(wm => windows.find(w => w.windowMinutes === wm) ?? null);
  const values = ordered.map(w => w?.avgMos ?? null);
  const hasData = values.some(v => v != null);
  if (!hasData) return <span className="text-xs text-muted-foreground">—</span>;

  const W = 80, H = 32, PAD = 4;
  const innerW = W - PAD * 2;
  const innerH = H - PAD * 2;
  const MOS_MIN = 1, MOS_MAX = 5;

  const pts = values.map((v, i) => ({
    x: PAD + (i / (values.length - 1)) * innerW,
    y: v == null ? null : PAD + innerH - ((v - MOS_MIN) / (MOS_MAX - MOS_MIN)) * innerH,
    v,
  }));

  const connected = pts.filter(p => p.y != null);
  const pathD = connected.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y!.toFixed(1)}`).join(' ');

  const latestMos = values[values.length - 1];
  const strokeColor = latestMos == null ? '#6b7280'
    : latestMos >= 3.5 ? '#34d399'
    : latestMos >= 3.0 ? '#fbbf24'
    : '#f87171';

  // Reference line at MOS 3.5
  const refY = PAD + innerH - ((3.5 - MOS_MIN) / (MOS_MAX - MOS_MIN)) * innerH;

  return (
    <svg width={W} height={H} className="overflow-visible">
      {/* Reference line at MOS 3.5 */}
      <line x1={PAD} y1={refY} x2={W - PAD} y2={refY} stroke="#6b7280" strokeWidth="0.5" strokeDasharray="2,2" />
      {/* Trend line */}
      {pathD && <path d={pathD} fill="none" stroke={strokeColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />}
      {/* Data points */}
      {connected.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y!} r="2" fill={strokeColor} />
      ))}
      {/* Labels: 24h, 4h, 1h */}
      {pts.map((p, i) => (
        <text key={i} x={p.x} y={H - 0.5} textAnchor="middle" fontSize="7" fill="#6b7280">
          {['24h','4h','1h'][i]}
        </text>
      ))}
    </svg>
  );
}

/** Mini bar chart showing jitter across 3 windows: 24h, 4h, 1h */
function JitterBars({ windows }: { windows: VendorWindow[] }) {
  const ordered = [1440, 240, 60]
    .map(wm => windows.find(w => w.windowMinutes === wm)?.avgJitterMs ?? null);
  const hasData = ordered.some(v => v != null);
  if (!hasData) return <span className="text-xs text-muted-foreground font-mono">—</span>;

  const maxVal = Math.max(...ordered.filter(v => v != null) as number[], 1);
  const W = 48, H = 24, barW = 12, gap = 4;
  const labels = ['24h','4h','1h'];

  return (
    <div className="flex flex-col items-center gap-0.5">
      <svg width={W} height={H}>
        {ordered.map((v, i) => {
          const barH = v == null ? 0 : Math.max(2, (v / maxVal) * (H - 8));
          const color = v == null ? '#374151'
            : v > 40 ? '#f87171'
            : v > 20 ? '#fbbf24'
            : '#34d399';
          return (
            <rect
              key={i}
              x={i * (barW + gap)}
              y={H - 8 - barH}
              width={barW}
              height={barH}
              rx="2"
              fill={color}
              opacity="0.8"
            />
          );
        })}
      </svg>
      <span className="text-[9px] text-muted-foreground font-mono">
        {ordered[2] != null ? `${ordered[2].toFixed(0)}ms` : '—'}
      </span>
    </div>
  );
}

// ── Colour palette for vendors in the trend chart ─────────────────────────────
const VENDOR_CHART_COLORS = [
  "#34d399", "#60a5fa", "#f472b6", "#fbbf24", "#a78bfa",
  "#fb923c", "#2dd4bf", "#e879f9", "#facc15", "#4ade80",
];

function vendorColor(vendorId: string, allVendors: string[]): string {
  const idx = allVendors.indexOf(vendorId);
  return VENDOR_CHART_COLORS[idx % VENDOR_CHART_COLORS.length] ?? "#94a3b8";
}

interface SlotSelection {
  ts: number;
  label: string;
  vendorId: string;
}

/** Recharts AreaChart showing per-vendor avg MOS over the last 24h (hourly buckets). */
function MosTrendChart({
  historyPoints,
  onSlotClick,
}: {
  historyPoints: HistoryPoint[];
  onSlotClick: (sel: SlotSelection) => void;
}) {
  if (historyPoints.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-muted-foreground/60 gap-2">
        <LineChartIcon className="h-8 w-8 opacity-20" />
        <p className="text-xs">No history yet — data accumulates as the aggregator runs</p>
        <p className="text-[10px] opacity-70">Runs every 5 minutes; first trend points appear after the initial run</p>
      </div>
    );
  }

  // Collect all unique vendor IDs
  const allVendors = Array.from(
    new Set(historyPoints.flatMap(p => p.vendors.map(v => v.vendorId))),
  ).sort();

  // Flatten to recharts row format: { label, ts, [vendorId]: mos, ... }
  type ChartRow = { label: string; ts: number; [k: string]: number | null | string };
  const chartData: ChartRow[] = historyPoints.map(pt => {
    const d = new Date(pt.ts);
    const label = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const row: ChartRow = { label, ts: pt.ts };
    for (const v of pt.vendors) {
      row[v.vendorId] = v.avgMos;
    }
    return row;
  });

  const handleClick = (data: any) => {
    if (!data?.activePayload?.length) return;
    const ts: number = data.activePayload[0]?.payload?.ts;
    const label: string = data.activePayload[0]?.payload?.label;
    const vendorId: string = data.activePayload[0]?.dataKey ?? allVendors[0];
    if (ts) onSlotClick({ ts, label, vendorId });
  };

  return (
    <div>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart
          data={chartData}
          margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
          onClick={handleClick}
          style={{ cursor: "pointer" }}
        >
          <defs>
            {allVendors.map(vid => {
              const color = vendorColor(vid, allVendors);
              return (
                <linearGradient key={vid} id={`grad-${vid.replace(/\W/g, "_")}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              );
            })}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: "#6b7280" }}
            interval="preserveStartEnd"
            tickLine={false}
          />
          <YAxis
            domain={[1, 5]}
            tick={{ fontSize: 10, fill: "#6b7280" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => v.toFixed(1)}
          />
          <ReferenceLine y={3.5} stroke="#34d399" strokeDasharray="4 2" strokeWidth={1} label={{ value: "3.5", fontSize: 9, fill: "#34d399" }} />
          <ReferenceLine y={3.0} stroke="#fbbf24" strokeDasharray="4 2" strokeWidth={1} label={{ value: "3.0", fontSize: 9, fill: "#fbbf24" }} />
          <RechartsTooltip
            contentStyle={{
              background: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 6,
              fontSize: 11,
              padding: "6px 10px",
            }}
            labelStyle={{ color: "hsl(var(--muted-foreground))", marginBottom: 4 }}
            formatter={(value: any, name: string) => [
              value != null ? `MOS ${Number(value).toFixed(2)}` : "—",
              name,
            ]}
          />
          <Legend
            iconType="circle"
            iconSize={7}
            wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
          />
          {allVendors.map(vid => (
            <Area
              key={vid}
              type="monotone"
              dataKey={vid}
              stroke={vendorColor(vid, allVendors)}
              strokeWidth={1.5}
              fill={`url(#grad-${vid.replace(/\W/g, "_")})`}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
      <p className="text-[10px] text-muted-foreground/50 text-right mt-1">
        Click a time point to see the CDRs that drove that MOS value
      </p>
    </div>
  );
}

/** Slide-in panel showing CDRs for a selected time slot. */
function SlotCdrPanel({
  selection,
  onClose,
}: {
  selection: SlotSelection;
  onClose: () => void;
}) {
  const { data, isLoading } = useQuery<{ success: boolean; data: SlotCdr[]; total: number }>({
    queryKey: ["/api/copilot/rtp-quality/slot-cdrs", selection.vendorId, selection.ts],
    queryFn: () =>
      fetch(`/api/copilot/rtp-quality/slot-cdrs?vendor=${encodeURIComponent(selection.vendorId)}&ts=${selection.ts}`)
        .then(r => r.json()),
    staleTime: 30_000,
  });

  const cdrs = data?.data ?? [];

  function mosBadge(mos: number | null) {
    if (mos == null) return null;
    if (mos >= 3.5) return "text-emerald-400";
    if (mos >= 3.0) return "text-amber-400";
    return "text-red-400";
  }

  return (
    <div
      className="rounded-lg border bg-card/60 backdrop-blur-sm"
      data-testid="slot-cdr-panel"
    >
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/50">
        <div className="flex items-center gap-2 text-sm">
          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-medium">{selection.vendorId}</span>
          <span className="text-muted-foreground">@ {selection.label}</span>
          {data?.total != null && (
            <span className="text-xs text-muted-foreground/60">({data.total} CDR{data.total !== 1 ? "s" : ""})</span>
          )}
        </div>
        <Button
          variant="ghost" size="icon"
          className="h-6 w-6"
          data-testid="slot-cdr-close"
          onClick={onClose}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : cdrs.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-muted-foreground">
          No CDR data found in the in-memory cache for this time window.
          <br />CDR data may have aged out of the cache.
        </div>
      ) : (
        <div className="overflow-auto max-h-64">
          <table className="w-full text-xs">
            <thead className="bg-muted/30 sticky top-0">
              <tr className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wide">
                <th className="px-3 py-2 text-left">CLI</th>
                <th className="px-3 py-2 text-left">CLD</th>
                <th className="px-3 py-2 text-left">Time</th>
                <th className="px-3 py-2 text-right">Dur</th>
                <th className="px-3 py-2 text-right">MOS</th>
                <th className="px-3 py-2 text-right">Jitter</th>
                <th className="px-3 py-2 text-right">PktLoss</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {cdrs.map((cdr, i) => {
                const t = cdr.connectTime ? new Date(cdr.connectTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";
                return (
                  <tr key={i} data-testid={`slot-cdr-row-${i}`} className="hover:bg-muted/20 transition-colors">
                    <td className="px-3 py-1.5 font-mono text-muted-foreground/80">{cdr.cli || "—"}</td>
                    <td className="px-3 py-1.5 font-mono">{cdr.cld || "—"}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{t}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{cdr.duration != null ? `${cdr.duration}s` : "—"}</td>
                    <td className={cn("px-3 py-1.5 text-right font-mono font-medium", mosBadge(cdr.mos) ?? "text-muted-foreground")}>
                      {cdr.mos != null ? cdr.mos.toFixed(2) : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{cdr.jitter != null ? `${cdr.jitter.toFixed(0)}ms` : "—"}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{cdr.pktLoss != null ? `${cdr.pktLoss.toFixed(2)}%` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function VoiceQualityCard() {
  const [open, setOpen] = useState(true);
  const [expandedVendors, setExpandedVendors] = useState<Set<string>>(new Set());
  const [chartOpen, setChartOpen] = useState(true);
  const [selectedSlot, setSelectedSlot] = useState<SlotSelection | null>(null);
  const { data, isLoading, isFetching, refetch } = useQuery<{ success: boolean; data: VendorQualitySummary[] }>({
    queryKey: ["/api/copilot/rtp-quality"],
    refetchInterval: 5 * 60_000,
  });
  const { data: historyData, isLoading: historyLoading } = useQuery<{ success: boolean; data: HistoryPoint[] }>({
    queryKey: ["/api/copilot/rtp-quality/history"],
    refetchInterval: 5 * 60_000,
  });
  const { toast } = useToast();

  const vendors: VendorQualitySummary[] = data?.data ?? [];

  const toggleVendorExpanded = (vendorId: string) => {
    setExpandedVendors(prev => {
      const next = new Set(prev);
      if (next.has(vendorId)) next.delete(vendorId);
      else next.add(vendorId);
      return next;
    });
  };

  const triggerMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/copilot/rtp-quality/trigger"),
    onSuccess: () => {
      toast({ title: "Aggregation triggered", description: "Voice quality data is being recomputed." });
      setTimeout(() => refetch(), 2500);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const windows1h  = (v: VendorQualitySummary) => v.windows.find(w => w.windowMinutes === 60);
  const windows4h  = (v: VendorQualitySummary) => v.windows.find(w => w.windowMinutes === 240);
  const windows24h = (v: VendorQualitySummary) => v.windows.find(w => w.windowMinutes === 1440);

  const criticalCount  = vendors.filter(v => windows1h(v)?.qualityBadge === "critical").length;
  const degradedCount  = vendors.filter(v => windows1h(v)?.qualityBadge === "degraded").length;
  const goodCount      = vendors.filter(v => windows1h(v)?.qualityBadge === "good").length;

  return (
    <div className="rounded-lg border bg-card" data-testid="voice-quality-card">
      {/* ── Collapsible header ── */}
      <button
        className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/20 transition-colors rounded-lg"
        data-testid="vq-collapse-toggle"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Waves className="h-4 w-4 text-sky-400" />
            <span className="text-sm font-semibold">RTP / MOS Quality Intelligence</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {criticalCount > 0 && (
              <span className="px-1.5 py-0.5 rounded border text-red-400 border-red-500/30 bg-red-500/10 font-bold">
                {criticalCount} Critical
              </span>
            )}
            {degradedCount > 0 && (
              <span className="px-1.5 py-0.5 rounded border text-amber-400 border-amber-500/30 bg-amber-500/10 font-bold">
                {degradedCount} Degraded
              </span>
            )}
            {goodCount > 0 && (
              <span className="px-1.5 py-0.5 rounded border text-emerald-400 border-emerald-500/30 bg-emerald-500/10">
                {goodCount} Good
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isFetching && <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          <Button
            variant="ghost" size="sm"
            className="h-7 text-xs gap-1.5"
            data-testid="vq-trigger-btn"
            disabled={triggerMutation.isPending}
            onClick={e => { e.stopPropagation(); triggerMutation.mutate(); }}
          >
            {triggerMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Recompute
          </Button>
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
        </div>
      </button>

      {/* ── Collapsible body ── */}
      {open && <div className="px-4 pb-4 space-y-4 border-t border-border/50 pt-3">

      {/* ── MOS legend ── */}
      <div className="rounded-lg border bg-muted/20 px-4 py-2 flex items-center gap-6 text-xs text-muted-foreground flex-wrap">
        <span className="font-semibold text-foreground/70">MOS thresholds:</span>
        <span><span className="text-emerald-400 font-bold">≥3.5</span> Good</span>
        <span><span className="text-amber-400 font-bold">3.0–3.5</span> Degraded</span>
        <span><span className="text-red-400 font-bold">&lt;3.0</span> Critical</span>
        <span className="ml-auto text-muted-foreground/60">Aggregated every 5 min from Sippy CDR VQ fields</span>
      </div>

      {/* ── 24h MOS trend chart ── */}
      <div className="rounded-lg border bg-card" data-testid="mos-trend-section">
        <button
          className="w-full flex items-center justify-between gap-2 px-4 py-2.5 hover:bg-muted/20 transition-colors rounded-lg text-left"
          data-testid="mos-trend-toggle"
          onClick={() => { setChartOpen(o => !o); setSelectedSlot(null); }}
        >
          <div className="flex items-center gap-2">
            <LineChartIcon className="h-3.5 w-3.5 text-sky-400" />
            <span className="text-xs font-semibold">24h MOS Trend</span>
            <span className="text-[10px] text-muted-foreground/60">per vendor · hourly buckets</span>
          </div>
          <div className="flex items-center gap-1.5">
            {historyLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
            {(historyData?.data?.length ?? 0) > 0 && (
              <span className="text-[10px] text-muted-foreground/60">
                {historyData!.data.length}h of data
              </span>
            )}
            <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", chartOpen && "rotate-180")} />
          </div>
        </button>

        {chartOpen && (
          <div className="px-4 pb-4 border-t border-border/50 pt-3 space-y-3">
            <MosTrendChart
              historyPoints={historyData?.data ?? []}
              onSlotClick={setSelectedSlot}
            />
            {selectedSlot && (
              <SlotCdrPanel
                selection={selectedSlot}
                onClose={() => setSelectedSlot(null)}
              />
            )}
          </div>
        )}
      </div>

      {/* ── Empty state ── */}
      {isLoading ? (
        <div className="rounded-lg border bg-card flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : vendors.length === 0 ? (
        <div className="rounded-lg border bg-card flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
          <Radio className="h-8 w-8 opacity-20" />
          <p className="text-sm">No voice quality data available</p>
          <p className="text-xs opacity-60 max-w-sm text-center">
            VQ data populates once Sippy CDRs with <code className="font-mono">i_vq_term_mos</code> or <code className="font-mono">i_vq_orig_mos</code> fields are processed.
            Ensure VQ reporting is enabled on your Sippy instance, then click Recompute.
          </p>
          <Button
            variant="outline" size="sm"
            data-testid="vq-trigger-empty-btn"
            disabled={triggerMutation.isPending}
            onClick={() => triggerMutation.mutate()}
            className="mt-1"
          >
            {triggerMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> : <RefreshCw className="h-3.5 w-3.5 mr-2" />}
            Run Aggregation Now
          </Button>
        </div>
      ) : (
        /* ── Vendor table ── */
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto_auto] gap-x-4 px-4 py-2 bg-muted/30 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground border-b">
            <span>Vendor</span>
            <span className="text-center w-20">Status (1h)</span>
            <span className="text-center w-24">MOS (1h)</span>
            <span className="text-center w-20">MOS Trend</span>
            <span className="text-center w-14">Jitter</span>
            <span className="text-center w-20">Pkt Loss</span>
            <span className="text-center w-20">Latency</span>
          </div>
          <div className="divide-y divide-border/50">
            {vendors
              .sort((a, b) => {
                const order = { critical: 0, degraded: 1, no_data: 2, good: 3 };
                return (order[windows1h(a)?.qualityBadge ?? "no_data"] ?? 2) -
                       (order[windows1h(b)?.qualityBadge ?? "no_data"] ?? 2);
              })
              .map((vendor, i) => {
                const w1  = windows1h(vendor);
                const badge = w1?.qualityBadge ?? "no_data";
                const hasPrefixes = (vendor.prefixes?.length ?? 0) > 0;
                const isExpanded = expandedVendors.has(vendor.vendorId);
                // Sort prefixes: worst MOS first (critical → degraded → no_data → good)
                const sortedPrefixes = hasPrefixes
                  ? [...vendor.prefixes!].sort((a, b) => {
                      const order = { critical: 0, degraded: 1, no_data: 2, good: 3 };
                      const ab = a.windows.find(w => w.windowMinutes === 60)?.qualityBadge ?? "no_data";
                      const bb = b.windows.find(w => w.windowMinutes === 60)?.qualityBadge ?? "no_data";
                      return (order[ab] ?? 2) - (order[bb] ?? 2);
                    })
                  : [];
                return (
                  <div key={vendor.vendorId}>
                    <motion.div
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.03 }}
                      data-testid={`vq-vendor-${i}`}
                      className={cn(
                        "grid grid-cols-[1fr_auto_auto_auto_auto_auto_auto] gap-x-4 px-4 py-3 items-center transition-colors",
                        hasPrefixes ? "cursor-pointer hover:bg-muted/30" : "hover:bg-muted/20",
                      )}
                      onClick={() => hasPrefixes && toggleVendorExpanded(vendor.vendorId)}
                    >
                      <div className="min-w-0 flex items-center gap-1.5">
                        {hasPrefixes && (
                          <ChevronRight className={cn(
                            "h-3.5 w-3.5 text-muted-foreground/50 flex-shrink-0 transition-transform duration-150",
                            isExpanded && "rotate-90",
                          )} />
                        )}
                        <div className="min-w-0">
                          <span className="text-sm font-medium truncate block">{vendor.vendorId}</span>
                          {hasPrefixes && (
                            <span className="text-[10px] text-muted-foreground/60">
                              {vendor.prefixes!.length} prefix{vendor.prefixes!.length !== 1 ? 'es' : ''} · click to {isExpanded ? 'collapse' : 'expand'}
                            </span>
                          )}
                        </div>
                      </div>
                      <span className={cn("text-[10px] font-bold uppercase border px-1.5 py-0.5 rounded text-center w-20", BADGE_COLOR[badge])}>
                        {MOS_LABEL[badge]}
                      </span>
                      <div className="w-24"><MosBar value={w1?.avgMos ?? null} /></div>
                      <div className="w-20 flex justify-center">
                        <MosSparkline windows={vendor.windows} />
                      </div>
                      <div className="w-14 flex justify-center">
                        <JitterBars windows={vendor.windows} />
                      </div>
                      <span className="text-xs font-mono text-center w-20">
                        {w1?.avgPktLossPct != null ? `${w1.avgPktLossPct.toFixed(2)}%` : "—"}
                      </span>
                      <span className="text-xs font-mono text-center w-20" data-testid={`vq-latency-${i}`}>
                        {w1?.avgLatencyMs != null ? `${w1.avgLatencyMs.toFixed(0)}ms` : "—"}
                      </span>
                    </motion.div>
                    {/* ── Per-prefix breakdown (shown when vendor row is expanded) ── */}
                    {hasPrefixes && isExpanded && (
                      <div className="bg-muted/10 border-t border-dashed border-border/40 divide-y divide-border/30">
                        {/* Sub-header */}
                        <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto_auto] gap-x-4 px-4 py-1 bg-muted/20 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground/60">
                          <span className="pl-5">Destination Prefix</span>
                          <span className="text-center w-20">Status</span>
                          <span className="text-center w-24">Avg MOS</span>
                          <span className="w-20" />
                          <span className="text-center w-14">Jitter</span>
                          <span className="text-center w-20">Pkt Loss</span>
                          <span className="text-center w-20">Latency</span>
                        </div>
                        {sortedPrefixes.slice(0, 12).map(pfx => {
                          const pw1 = pfx.windows.find(w => w.windowMinutes === 60);
                          const pb = pw1?.qualityBadge ?? "no_data";
                          return (
                            <div
                              key={pfx.prefix}
                              data-testid={`vq-prefix-${pfx.prefix}`}
                              className="grid grid-cols-[1fr_auto_auto_auto_auto_auto_auto] gap-x-4 px-4 py-1.5 items-center text-xs hover:bg-muted/20 transition-colors"
                            >
                              <span className="text-muted-foreground font-mono pl-5">
                                <span className="text-muted-foreground/40 mr-1">↳</span>
                                <span className="text-foreground/80 font-semibold">{pfx.prefix}</span>
                                <span className="text-muted-foreground/50">xxx</span>
                                <span className="ml-1.5 text-[10px] text-muted-foreground/40">
                                  ({pw1?.sampleCount ?? 0} CDRs)
                                </span>
                              </span>
                              <span className={cn("text-[9px] font-bold uppercase border px-1 rounded text-center w-20", BADGE_COLOR[pb])}>
                                {MOS_LABEL[pb]}
                              </span>
                              <div className="w-24"><MosBar value={pw1?.avgMos ?? null} /></div>
                              <div className="w-20" />
                              <div className="w-14 text-center font-mono text-muted-foreground/70">
                                {pw1?.avgJitterMs != null ? `${pw1.avgJitterMs.toFixed(0)}ms` : "—"}
                              </div>
                              <span className="w-20 text-center font-mono text-muted-foreground/70">
                                {pw1?.avgPktLossPct != null ? `${pw1.avgPktLossPct.toFixed(2)}%` : "—"}
                              </span>
                              <span className="w-20 text-center font-mono text-muted-foreground/70">
                                {pw1?.avgLatencyMs != null ? `${pw1.avgLatencyMs.toFixed(0)}ms` : "—"}
                              </span>
                            </div>
                          );
                        })}
                        {(vendor.prefixes?.length ?? 0) > 12 && (
                          <div className="px-8 py-1.5 text-[10px] text-muted-foreground/50">
                            +{vendor.prefixes!.length - 12} more prefixes (showing top 12 by severity)
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* ── Sample count note ── */}
      {vendors.length > 0 && (
        <p className="text-xs text-muted-foreground/50 text-right">
          {vendors.reduce((s, v) => s + (windows1h(v)?.sampleCount ?? 0), 0).toLocaleString()} CDRs in 1h window
          · Last computed {vendors[0]?.windows[0]?.computedAt
            ? new Date(vendors[0].windows[0].computedAt).toLocaleTimeString()
            : "—"}
        </p>
      )}
    </div>}
  </div>
);
}

function VendorTrendCell({ vendorId, expanded }: { vendorId: string; expanded: boolean }) {
  const { data } = useQuery<{ trend: TrendPoint[] }>({
    queryKey: ["/api/route-intelligence/vendor", vendorId, "trend"],
    queryFn: () => fetch(`/api/route-intelligence/vendor/${vendorId}/trend`).then(r => r.json()),
    enabled: true,
    staleTime: 10 * 60 * 1000,
  });

  if (!data?.trend?.length) return <span className="text-muted-foreground/30 text-xs">—</span>;
  return <Sparkline points={data.trend} />;
}

// ── Tab registry ───────────────────────────────────────────────────────────────

const TABS = [
  { key: "overview",       label: "Overview",           icon: Activity    },
  { key: "cdr-analytics",  label: "CDR Analytics",      icon: BarChart3   },
  { key: "degradation",    label: "Degradation Alert",  icon: TrendingDown },
  { key: "qos",            label: "QoS Analysis",       icon: Zap         },
  { key: "sip-errors",     label: "SIP Errors",          icon: Radio       },
  { key: "copilot",        label: "AI Copilot",          icon: Sparkles    },
  { key: "recs",           label: "Account Recs",        icon: BrainCircuit },
  { key: "history",        label: "Rollback History",    icon: History     },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function RouteIntelligencePage() {
  const initialTab = new URLSearchParams(window.location.search).get("tab") ?? "overview";
  const [activeTab, setActiveTab] = useState(initialTab);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const { toast } = useToast();
  const { isManagement } = useAuth();
  const { lastPendingApproval } = useNocWebSocket();
  const seenApprovalIds = useRef<Set<number>>(new Set());

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    if (tab) setActiveTab(tab);
  }, []);

  // ── WS: react to pending_approval_required push ───────────────────────────
  useEffect(() => {
    if (!lastPendingApproval || !isManagement) return;
    if (seenApprovalIds.current.has(lastPendingApproval.actionId)) return;
    seenApprovalIds.current.add(lastPendingApproval.actionId);

    queryClient.invalidateQueries({ queryKey: ["/api/ai/actions/pending"] });
    toast({
      title: "⚠️ Action Requires Your Approval",
      description: `${lastPendingApproval.requestedByName} submitted "${lastPendingApproval.primaryAction}" for ${lastPendingApproval.accountName}. Go to AI Copilot to review.`,
      duration: 10_000,
    });
  }, [lastPendingApproval, isManagement, toast]);

  const { data: pendingActionsData } = useQuery<{ success: boolean; data: { id: number }[] }>({
    queryKey: ["/api/ai/actions/pending"],
    refetchInterval: 30_000,
    enabled: !!isManagement,
  });
  const pendingCount = pendingActionsData?.data?.length ?? 0;

  const { data: scores = [], isFetching: scoresFetching } = useQuery<CarrierScore[]>({
    queryKey: ["/api/carrier-scores", 24],
    queryFn: () => fetch("/api/carrier-scores?window=24").then(r => r.json()),
    refetchInterval: 45_000,
  });

  const { data: recommendations = [], isFetching: recsFetching } = useQuery<Recommendation[]>({
    queryKey: ["/api/recommendations"],
    refetchInterval: 90_000,
  });

  const { data: rollbackSummary } = useQuery<{ success: boolean; count: number }>({
    queryKey: ["/api/ai/route-copilot/rollback-summary"],
    refetchInterval: 60_000,
  });
  const rollbackCount = rollbackSummary?.count ?? 0;

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
              "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all relative",
              activeTab === tab.key
                ? "bg-white dark:bg-slate-800 shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground",
              tab.key === "copilot" && activeTab !== "copilot" && "text-violet-500 hover:text-violet-600",
            )}
          >
            <tab.icon className={cn("h-3.5 w-3.5", tab.key === "copilot" && "text-violet-400")} />
            {tab.label}
            {tab.key === "history" && rollbackCount > 0 && (
              <span
                data-testid="rollback-count-badge"
                className="ml-0.5 min-w-[1.1rem] h-[1.1rem] flex items-center justify-center rounded-full bg-amber-500 text-white text-[10px] font-bold leading-none px-1"
              >
                {rollbackCount > 99 ? "99+" : rollbackCount}
              </span>
            )}
            {tab.key === "copilot" && isManagement && pendingCount > 0 && (
              <span
                data-testid="copilot-tab-pending-badge"
                className="ml-0.5 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold leading-none"
              >
                {pendingCount}
              </span>
            )}
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

      {/* ── CDR Analytics Tab ── */}
      {activeTab === "cdr-analytics" && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 mb-1">
            <BarChart3 className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">CDR Traffic Analytics</span>
            <span className="text-xs text-muted-foreground">— Per-vendor quality snapshots from 72h CDR cache · Refreshes every 15 min</span>
          </div>
          <CdrAnalyticsPanel />
        </div>
      )}

      {/* ── SIP Errors Tab ── */}
      {activeTab === "sip-errors" && <SipErrorsTab />}

      {/* ── Rollback History Tab ── */}
      {activeTab === "history" && <RollbackHistoryPanel />}

      {/* ── AI Copilot Tab — includes Voice Quality card ── */}
      {activeTab === "copilot" && (
        <div className="space-y-4">
          <VoiceQualityCard />
          <AiCopilotPanel />
        </div>
      )}

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
