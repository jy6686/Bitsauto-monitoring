import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BrainCircuit, AlertTriangle, TrendingDown, TrendingUp, CheckCircle2,
  XCircle, Clock, RefreshCw, Play, ChevronDown, ChevronRight,
  Activity, Zap, Shield, BarChart3, Target, Info, Minus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ── Types ────────────────────────────────────────────────────────────────────

type ProjectedImpact = {
  asrGain: string; marginGain: string; fasReduction: string;
  trafficShift: string; basedOnSamples: number;
};

type RouteRec = {
  id: string; carrier: string; carrierId: string | null;
  priority: 'critical' | 'high' | 'medium' | 'opportunity' | 'healthy';
  status: string; suggestionId: number | null;
  action: string | null; trafficShift: number; confidence: number;
  stabilityScore: number; trend: string; rollingAsr: number;
  avgPddMs: number; failureRate: number; sampleCount: number;
  reasoning: Record<string, string>;
  projectedImpact: ProjectedImpact | null;
  computedAt: string;
};

type Summary = {
  totalCarriers: number; criticalCarriers: number; highCarriers: number;
  mediumCarriers: number; opportunityCarriers: number; healthyCarriers: number;
  actionableCount: number; generatedAt: string;
};

type RouteOptimisationData = { recommendations: RouteRec[]; summary: Summary };

// ── Priority meta ─────────────────────────────────────────────────────────────

const PRIORITY_META = {
  critical:    { label: 'Critical',    icon: AlertTriangle, color: 'text-red-400',     bg: 'bg-red-500/10',     border: 'border-red-500/30',     dot: 'bg-red-500'    },
  high:        { label: 'High',        icon: TrendingDown,  color: 'text-orange-400',  bg: 'bg-orange-500/10',  border: 'border-orange-500/30',  dot: 'bg-orange-500' },
  medium:      { label: 'Medium',      icon: Activity,      color: 'text-yellow-400',  bg: 'bg-yellow-500/10',  border: 'border-yellow-500/30',  dot: 'bg-yellow-500' },
  opportunity: { label: 'Opportunity', icon: TrendingUp,    color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', dot: 'bg-emerald-500'},
  healthy:     { label: 'Healthy',     icon: CheckCircle2,  color: 'text-slate-400',   bg: 'bg-slate-500/10',   border: 'border-slate-500/20',   dot: 'bg-slate-500'  },
};

const TREND_META = {
  degrading: { icon: TrendingDown, color: 'text-red-400',    label: 'Degrading' },
  stable:    { icon: Minus,        color: 'text-slate-400',  label: 'Stable'    },
  improving: { icon: TrendingUp,   color: 'text-emerald-400',label: 'Improving' },
};

const STATUS_META: Record<string, { label: string; icon: typeof CheckCircle2; color: string }> = {
  pending:  { label: 'Pending',  icon: Clock,        color: 'text-amber-400' },
  approved: { label: 'Approved', icon: CheckCircle2, color: 'text-emerald-400' },
  rejected: { label: 'Rejected', icon: XCircle,      color: 'text-slate-400' },
  snoozed:  { label: 'Snoozed',  icon: Clock,        color: 'text-slate-400' },
  none:     { label: 'Healthy',  icon: CheckCircle2, color: 'text-slate-400' },
};

const FILTER_TABS = [
  { key: 'all',         label: 'All' },
  { key: 'critical',    label: 'Critical' },
  { key: 'high',        label: 'High' },
  { key: 'opportunity', label: 'Opportunity' },
  { key: 'healthy',     label: 'Healthy' },
];

// ── Confidence bar ────────────────────────────────────────────────────────────

function ConfidenceBar({ value }: { value: number }) {
  const color = value >= 80 ? 'bg-emerald-500' : value >= 60 ? 'bg-yellow-500' : 'bg-orange-500';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted/40 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${value}%` }} />
      </div>
      <span className="text-xs font-mono text-muted-foreground w-7 text-right">{value}%</span>
    </div>
  );
}

// ── Stability gauge ───────────────────────────────────────────────────────────

function StabilityGauge({ score }: { score: number }) {
  const color = score >= 80 ? 'text-emerald-400' : score >= 60 ? 'text-yellow-400' : score >= 40 ? 'text-orange-400' : 'text-red-400';
  const ring  = score >= 80 ? 'border-emerald-500/40' : score >= 60 ? 'border-yellow-500/40' : score >= 40 ? 'border-orange-500/40' : 'border-red-500/40';
  return (
    <div className={`w-14 h-14 rounded-full border-2 ${ring} flex flex-col items-center justify-center shrink-0`}>
      <span className={`text-lg font-bold font-mono leading-none ${color}`}>{Math.round(score)}</span>
      <span className="text-[9px] text-muted-foreground/60 leading-none mt-0.5">Q-Score</span>
    </div>
  );
}

// ── Recommendation Card ───────────────────────────────────────────────────────

function RecCard({ rec, onAction }: { rec: RouteRec; onAction: (id: number, action: 'approve' | 'reject' | 'snooze') => void }) {
  const [expanded, setExpanded] = useState(false);
  const meta   = PRIORITY_META[rec.priority] ?? PRIORITY_META.healthy;
  const Icon   = meta.icon;
  const tMeta  = TREND_META[rec.trend as keyof typeof TREND_META] ?? TREND_META.stable;
  const TIcon  = tMeta.icon;
  const sMeta  = STATUS_META[rec.status] ?? STATUS_META.pending;
  const SIcon  = sMeta.icon;
  const reasonEntries = Object.entries(rec.reasoning);

  return (
    <div data-testid={`rec-card-${rec.carrier}`} className={`rounded-xl border ${meta.border} ${meta.bg} overflow-hidden transition-all`}>
      {/* Card header */}
      <div className="flex items-start gap-3 p-4">
        <StabilityGauge score={rec.stabilityScore} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-semibold text-sm truncate">{rec.carrier}</span>
            <span className={`flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded-full ${meta.bg} ${meta.color} border ${meta.border}`}>
              <Icon className="w-3 h-3" />
              {meta.label}
            </span>
            <span className={`flex items-center gap-1 text-xs ${tMeta.color}`}>
              <TIcon className="w-3 h-3" />
              {tMeta.label}
            </span>
          </div>

          {rec.action && (
            <p className="text-xs text-foreground/80 mb-2">{rec.action}</p>
          )}

          {/* Quick metrics */}
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span>ASR <span className="text-foreground font-mono">{rec.rollingAsr.toFixed(1)}%</span></span>
            {rec.avgPddMs > 0 && <span>PDD <span className="text-foreground font-mono">{(rec.avgPddMs / 1000).toFixed(2)}s</span></span>}
            {rec.failureRate > 0 && <span>Fail <span className="text-red-400 font-mono">{rec.failureRate.toFixed(1)}%</span></span>}
            <span>{rec.sampleCount.toLocaleString()} samples</span>
          </div>
        </div>

        <div className="flex flex-col items-end gap-2 shrink-0">
          {rec.confidence > 0 && (
            <div className="w-28">
              <div className="text-[10px] text-muted-foreground mb-1">Confidence</div>
              <ConfidenceBar value={rec.confidence} />
            </div>
          )}
          <span className={`flex items-center gap-1 text-xs ${sMeta.color}`}>
            <SIcon className="w-3 h-3" />
            {sMeta.label}
          </span>
          {rec.action && (
            <button
              onClick={() => setExpanded(e => !e)}
              data-testid={`btn-expand-${rec.carrier}`}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mt-1"
            >
              {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              {expanded ? 'Less' : 'Details'}
            </button>
          )}
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && rec.action && (
        <div className="border-t border-border/20 px-4 pb-4 pt-3 space-y-4">
          {/* Reasoning */}
          {reasonEntries.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Evidence</div>
              <div className="space-y-1.5">
                {reasonEntries.map(([k, v]) => (
                  <div key={k} className="flex items-start gap-2 text-xs">
                    <div className={`w-1.5 h-1.5 rounded-full mt-1 shrink-0 ${meta.dot}`} />
                    <span className="text-foreground/80">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Projected impact */}
          {rec.projectedImpact && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Projected Impact</div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'ASR Gain',      value: rec.projectedImpact.asrGain,      color: 'text-emerald-400' },
                  { label: 'Margin Gain',   value: rec.projectedImpact.marginGain,   color: 'text-blue-400'   },
                  { label: 'FAS Reduction', value: rec.projectedImpact.fasReduction, color: 'text-orange-400' },
                  { label: 'Traffic Shift', value: rec.projectedImpact.trafficShift, color: 'text-fuchsia-400'},
                ].map(({ label, value, color }) => (
                  <div key={label} className="bg-background/30 rounded-lg px-3 py-2">
                    <div className="text-[10px] text-muted-foreground">{label}</div>
                    <div className={`text-base font-bold font-mono ${color}`}>{value}</div>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground/60 mt-2">
                Based on {rec.projectedImpact.basedOnSamples.toLocaleString()} call samples. Advisory estimate — actual results may vary.
              </p>
            </div>
          )}

          {/* Actions */}
          {rec.suggestionId && rec.status === 'pending' && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Human Approval Required</div>
              <div className="flex gap-2">
                <button
                  data-testid={`btn-approve-${rec.carrier}`}
                  onClick={() => onAction(rec.suggestionId!, 'approve')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25 text-xs font-medium transition-colors"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Approve
                </button>
                <button
                  data-testid={`btn-snooze-${rec.carrier}`}
                  onClick={() => onAction(rec.suggestionId!, 'snooze')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted/30 border border-border/40 text-muted-foreground hover:text-foreground hover:bg-muted/50 text-xs font-medium transition-colors"
                >
                  <Clock className="w-3.5 h-3.5" />
                  Snooze
                </button>
                <button
                  data-testid={`btn-reject-${rec.carrier}`}
                  onClick={() => onAction(rec.suggestionId!, 'reject')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted/20 border border-border/30 text-muted-foreground hover:text-red-400 text-xs font-medium transition-colors"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  Dismiss
                </button>
              </div>
            </div>
          )}
          {rec.status === 'approved' && (
            <div className="flex items-center gap-2 text-xs text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Approved — queued for manual routing update
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Summary KPI strip ─────────────────────────────────────────────────────────

function SummaryStrip({ summary }: { summary: Summary }) {
  return (
    <div className="grid grid-cols-5 gap-px bg-border/20 border-b border-border/30 shrink-0">
      {[
        { label: 'Critical',    value: summary.criticalCarriers,    color: 'text-red-400'     },
        { label: 'High',        value: summary.highCarriers,        color: 'text-orange-400'  },
        { label: 'Medium',      value: summary.mediumCarriers,      color: 'text-yellow-400'  },
        { label: 'Opportunity', value: summary.opportunityCarriers, color: 'text-emerald-400' },
        { label: 'Healthy',     value: summary.healthyCarriers,     color: 'text-slate-400'   },
      ].map(k => (
        <div key={k.label} className="bg-card/40 px-4 py-3">
          <div className={`text-2xl font-bold font-mono ${k.color}`}>{k.value}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{k.label}</div>
        </div>
      ))}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function RouteOptimisationPage() {
  const [filter, setFilter] = useState('all');
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading, isFetching, refetch } = useQuery<RouteOptimisationData>({
    queryKey: ['/api/route-optimisation'],
    refetchInterval: 5 * 60 * 1000,
  });

  const generateMut = useMutation({
    mutationFn: () => apiRequest('POST', '/api/routing-suggestions/generate'),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['/api/route-optimisation'] }); toast({ title: 'Analysis refreshed', description: 'Carrier intelligence re-evaluated.' }); },
    onError:   () => toast({ title: 'Analysis failed', variant: 'destructive' }),
  });

  const actionMut = useMutation({
    mutationFn: ({ id, action }: { id: number; action: string }) =>
      apiRequest('POST', `/api/routing-suggestions/${id}/${action}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['/api/route-optimisation'] }); toast({ title: 'Action recorded' }); },
    onError:   () => toast({ title: 'Action failed', variant: 'destructive' }),
  });

  const recs = data?.recommendations ?? [];
  const summary = data?.summary;

  const filtered = useMemo(() =>
    filter === 'all' ? recs : recs.filter(r => r.priority === filter),
    [recs, filter]
  );

  const actionableCount = summary?.actionableCount ?? 0;

  return (
    <div className="flex flex-col h-full min-h-screen bg-background">

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 bg-card/40 shrink-0">
        <div className="flex items-center gap-3">
          <BrainCircuit className="w-5 h-5 text-fuchsia-400" />
          <div>
            <h1 className="text-base font-semibold flex items-center gap-2">
              Route Optimisation
              {actionableCount > 0 && (
                <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-fuchsia-500/20 text-fuchsia-400 border border-fuchsia-500/30">
                  {actionableCount} actionable
                </span>
              )}
            </h1>
            <p className="text-xs text-muted-foreground">Carrier-level intelligence recommendations · Advisory only</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            data-testid="btn-run-analysis"
            onClick={() => generateMut.mutate()}
            disabled={generateMut.isPending}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-fuchsia-500/15 border border-fuchsia-500/30 text-fuchsia-400 hover:bg-fuchsia-500/25 text-xs font-medium transition-colors disabled:opacity-50"
          >
            {generateMut.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            Run Analysis
          </button>
          <button
            data-testid="btn-refresh"
            onClick={() => refetch()}
            disabled={isFetching}
            className="p-2 rounded-lg hover:bg-muted/40 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Advisory banner */}
      <div className="flex items-center gap-2.5 px-6 py-2.5 bg-fuchsia-950/40 border-b border-fuchsia-500/20 shrink-0">
        <Shield className="w-3.5 h-3.5 text-fuchsia-400 shrink-0" />
        <p className="text-xs text-fuchsia-300/80">
          <span className="font-semibold text-fuchsia-300">Advisory mode.</span>{" "}
          This system recommends and explains — it does not auto-modify routing. Every change requires explicit human approval.
        </p>
      </div>

      {/* KPI strip */}
      {summary && <SummaryStrip summary={summary} />}

      {/* Filter tabs */}
      <div className="flex items-center gap-1 px-6 py-3 border-b border-border/30 bg-card/20 shrink-0 overflow-x-auto">
        {FILTER_TABS.map(tab => (
          <button
            key={tab.key}
            data-testid={`filter-${tab.key}`}
            onClick={() => setFilter(tab.key)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap',
              filter === tab.key
                ? 'bg-fuchsia-500/20 text-fuchsia-400 border border-fuchsia-500/30'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
            )}
          >
            {tab.label}
            {tab.key !== 'all' && (
              <span className="ml-1.5 opacity-60">
                {recs.filter(r => r.priority === tab.key).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <div className="flex flex-col items-center gap-3 text-muted-foreground/50">
              <RefreshCw className="w-8 h-8 animate-spin" />
              <span className="text-sm">Analysing carrier intelligence…</span>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3 text-muted-foreground/50">
            {filter === 'all' ? (
              <>
                <BrainCircuit className="w-10 h-10 opacity-30" />
                <div className="text-sm text-center">
                  <p>No carrier data yet.</p>
                  <p className="text-xs mt-1">Click "Run Analysis" to generate recommendations.</p>
                </div>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-10 h-10 opacity-30" />
                <p className="text-sm">No {filter} carriers</p>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-3 max-w-4xl">
            {filtered.map(rec => (
              <RecCard
                key={rec.id}
                rec={rec}
                onAction={(id, action) => actionMut.mutate({ id, action })}
              />
            ))}
            {summary?.generatedAt && (
              <p className="text-xs text-muted-foreground/40 pt-2 text-center">
                Last computed: {new Date(summary.generatedAt).toLocaleString()}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Info footer */}
      <div className="flex items-center gap-2 px-6 py-2.5 border-t border-border/20 bg-card/20 shrink-0">
        <Info className="w-3 h-3 text-muted-foreground/40 shrink-0" />
        <p className="text-[10px] text-muted-foreground/40">
          Recommendations are derived from carrier quality scores, rolling ASR, PDD, and stability trends. Confidence scores are based on signal volume and consistency.
        </p>
      </div>
    </div>
  );
}
