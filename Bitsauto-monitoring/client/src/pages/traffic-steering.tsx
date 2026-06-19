import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightLeft, CheckCircle2, XCircle, Clock, RefreshCw, Play,
  TrendingDown, TrendingUp, Minus, Activity, AlertTriangle, Shield,
  ChevronRight, BarChart3, Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ── Types ─────────────────────────────────────────────────────────────────────

type Suggestion = {
  id: number; carrierName: string; entity: string;
  currentScore: number | null; suggestedAction: string;
  reason: string; confidence: number;
  status: 'pending' | 'approved' | 'rejected' | 'snoozed';
  createdAt: string; resolvedAt: string | null;
};

type CarrierScore = {
  carrierName: string; stabilityScore: number | null;
  rollingAsr: number | null; avgPddMs: number | null;
  failureRate: number | null; trend: string | null;
  sampleCount: number; lastComputedAt: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_TABS = [
  { key: 'pending',  label: 'Pending',  color: 'text-amber-400'  },
  { key: 'approved', label: 'Approved', color: 'text-emerald-400'},
  { key: 'rejected', label: 'Rejected', color: 'text-slate-400'  },
  { key: 'snoozed',  label: 'Snoozed',  color: 'text-slate-400'  },
];

const TREND_META = {
  degrading: { icon: TrendingDown, color: 'text-red-400',    label: 'Degrading' },
  stable:    { icon: Minus,        color: 'text-slate-400',  label: 'Stable'    },
  improving: { icon: TrendingUp,   color: 'text-emerald-400',label: 'Improving' },
};

function scoreColor(s: number | null) {
  if (s == null) return 'text-muted-foreground';
  if (s >= 80) return 'text-emerald-400';
  if (s >= 60) return 'text-yellow-400';
  if (s >= 40) return 'text-orange-400';
  return 'text-red-400';
}

function confidencePct(c: number) {
  return Math.round(c * 100);
}

function estimateImpact(sug: Suggestion, score: CarrierScore | undefined) {
  const stability = score?.stabilityScore ?? sug.currentScore ?? 50;
  const deficit   = Math.max(0, 80 - stability);
  const action    = sug.suggestedAction.toLowerCase();

  if (action.includes('20%')) {
    return { shift: '20%', asrGain: `+${Math.round(deficit * 0.45)}%`, marginGain: `+${Math.round(deficit * 0.30)}%`, fasRed: `-${Math.round(deficit * 1.8)}%` };
  }
  if (action.includes('10%')) {
    return { shift: '10%', asrGain: `+${Math.round(deficit * 0.20)}%`, marginGain: `+${Math.round(deficit * 0.14)}%`, fasRed: `-${Math.round(deficit * 0.9)}%` };
  }
  if (action.includes('restore') || action.includes('full priority')) {
    return { shift: '+15%', asrGain: `+${Math.round((stability - 60) * 0.15)}%`, marginGain: 'stable', fasRed: 'n/a' };
  }
  if (action.includes('investigate') || action.includes('failover')) {
    return { shift: '5%', asrGain: '+3–5%', marginGain: 'est. +2%', fasRed: '-10%' };
  }
  return { shift: '—', asrGain: '—', marginGain: '—', fasRed: '—' };
}

// ── Steering Card ─────────────────────────────────────────────────────────────

function SteeringCard({
  sug, score, onAction,
}: {
  sug: Suggestion;
  score: CarrierScore | undefined;
  onAction: (id: number, action: 'approve' | 'reject' | 'snooze') => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const confPct = confidencePct(sug.confidence);
  const impact  = estimateImpact(sug, score);
  const tMeta   = TREND_META[(score?.trend ?? 'stable') as keyof typeof TREND_META] ?? TREND_META.stable;
  const TIcon   = tMeta.icon;
  const stability = score?.stabilityScore ?? sug.currentScore;
  const asr       = score?.rollingAsr;
  const pdd       = score?.avgPddMs;

  const isActionable = sug.status === 'pending';

  return (
    <div
      data-testid={`steering-card-${sug.id}`}
      className={cn(
        'rounded-xl border overflow-hidden transition-all',
        sug.status === 'approved' ? 'border-emerald-500/25 bg-emerald-500/5'
        : sug.status === 'rejected' || sug.status === 'snoozed' ? 'border-border/20 bg-muted/10 opacity-60'
        : 'border-border/40 bg-card/40',
      )}
    >
      {/* Top row */}
      <div className="flex items-start gap-3 p-4">
        {/* Score ring */}
        <div className={cn(
          'w-12 h-12 rounded-full border-2 flex flex-col items-center justify-center shrink-0',
          stability != null && stability < 40 ? 'border-red-500/50' :
          stability != null && stability < 60 ? 'border-orange-500/50' :
          stability != null && stability < 80 ? 'border-yellow-500/50' : 'border-emerald-500/50',
        )}>
          <span className={`text-base font-bold font-mono leading-none ${scoreColor(stability ?? null)}`}>
            {stability != null ? Math.round(stability) : '—'}
          </span>
          <span className="text-[8px] text-muted-foreground/50 leading-none mt-0.5">Score</span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="font-semibold text-sm">{sug.carrierName}</span>
            <span className={`flex items-center gap-1 text-xs ${tMeta.color}`}>
              <TIcon className="w-3 h-3" />
              {tMeta.label}
            </span>
            {sug.status === 'approved' && (
              <span className="text-xs text-emerald-400 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Approved
              </span>
            )}
          </div>

          {/* Action statement */}
          <p className="text-xs font-medium text-foreground/90 mb-2">{sug.suggestedAction}</p>

          {/* Inline metrics */}
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            {asr  != null && <span>ASR <span className="text-foreground font-mono">{asr.toFixed(1)}%</span></span>}
            {pdd  != null && <span>PDD <span className="text-foreground font-mono">{(pdd / 1000).toFixed(2)}s</span></span>}
            {score?.failureRate != null && <span>Fail <span className="text-red-400 font-mono">{score.failureRate.toFixed(1)}%</span></span>}
            <span>{score?.sampleCount.toLocaleString() ?? '—'} samples</span>
          </div>
        </div>

        <div className="flex flex-col items-end gap-2 shrink-0">
          {/* Confidence */}
          <div className="w-24">
            <div className="text-[10px] text-muted-foreground mb-1 text-right">Confidence</div>
            <div className="flex items-center gap-1.5">
              <div className="flex-1 h-1.5 bg-muted/40 rounded-full overflow-hidden">
                <div
                  className={cn('h-full rounded-full', confPct >= 80 ? 'bg-emerald-500' : confPct >= 60 ? 'bg-yellow-500' : 'bg-orange-500')}
                  style={{ width: `${confPct}%` }}
                />
              </div>
              <span className="text-xs font-mono text-muted-foreground">{confPct}%</span>
            </div>
          </div>
          <button
            onClick={() => setExpanded(e => !e)}
            data-testid={`btn-expand-steering-${sug.id}`}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronRight className={cn('w-3 h-3 transition-transform', expanded && 'rotate-90')} />
            Details
          </button>
        </div>
      </div>

      {/* Expanded */}
      {expanded && (
        <div className="border-t border-border/20 px-4 pb-4 pt-3 space-y-4">
          {/* Evidence */}
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Evidence</div>
            <p className="text-xs text-foreground/75 leading-relaxed">{sug.reason}</p>
          </div>

          {/* Impact projection */}
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Expected Outcome</div>
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: 'Traffic Shift', value: impact.shift,     color: 'text-fuchsia-400' },
                { label: 'ASR Gain',      value: impact.asrGain,   color: 'text-emerald-400' },
                { label: 'Margin Gain',   value: impact.marginGain,color: 'text-blue-400'    },
                { label: 'FAS Reduction', value: impact.fasRed,    color: 'text-orange-400'  },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-background/30 rounded-lg px-2 py-2 text-center">
                  <div className="text-[10px] text-muted-foreground">{label}</div>
                  <div className={`text-sm font-bold font-mono ${color}`}>{value}</div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground/50 mt-2">
              Advisory projection. Actual impact depends on current traffic mix. Human approval required before any routing change.
            </p>
          </div>

          {/* Actions */}
          {isActionable && (
            <div className="flex gap-2">
              <button
                data-testid={`btn-approve-${sug.id}`}
                onClick={() => onAction(sug.id, 'approve')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25 text-xs font-medium transition-colors"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Approve
              </button>
              <button
                data-testid={`btn-snooze-${sug.id}`}
                onClick={() => onAction(sug.id, 'snooze')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted/30 border border-border/40 text-muted-foreground hover:text-foreground hover:bg-muted/50 text-xs font-medium transition-colors"
              >
                <Clock className="w-3.5 h-3.5" />
                Snooze 2h
              </button>
              <button
                data-testid={`btn-reject-${sug.id}`}
                onClick={() => onAction(sug.id, 'reject')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted/20 border border-border/30 text-muted-foreground hover:text-red-400 text-xs font-medium transition-colors"
              >
                <XCircle className="w-3.5 h-3.5" />
                Dismiss
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function TrafficSteeringPage() {
  const [tab, setTab] = useState<'pending' | 'approved' | 'rejected' | 'snoozed'>('pending');
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: suggestions = [], isLoading, isFetching, refetch } = useQuery<Suggestion[]>({
    queryKey: ['/api/routing-suggestions'],
    refetchInterval: 2 * 60 * 1000,
  });

  const { data: scoresRaw = [] } = useQuery<CarrierScore[]>({
    queryKey: ['/api/carrier-scores'],
    refetchInterval: 5 * 60 * 1000,
  });

  const scoresByCarrier = useMemo(() => {
    const m = new Map<string, CarrierScore>();
    for (const s of scoresRaw) m.set(s.carrierName, s);
    return m;
  }, [scoresRaw]);

  const generateMut = useMutation({
    mutationFn: () => apiRequest('POST', '/api/routing-suggestions/generate'),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['/api/routing-suggestions'] }); toast({ title: 'Steering analysis refreshed' }); },
    onError:   () => toast({ title: 'Generation failed', variant: 'destructive' }),
  });

  const actionMut = useMutation({
    mutationFn: ({ id, action }: { id: number; action: string }) =>
      apiRequest('POST', `/api/routing-suggestions/${id}/${action}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['/api/routing-suggestions'] }); toast({ title: 'Action recorded' }); },
    onError:   () => toast({ title: 'Action failed', variant: 'destructive' }),
  });

  const byStatus = useMemo(() => {
    const out: Record<string, Suggestion[]> = { pending: [], approved: [], rejected: [], snoozed: [] };
    for (const s of suggestions) { (out[s.status] ??= []).push(s); }
    return out;
  }, [suggestions]);

  const visibleSuggestions = byStatus[tab] ?? [];

  // Summary counts
  const pendingCount  = byStatus.pending?.length ?? 0;
  const approvedCount = byStatus.approved?.length ?? 0;

  return (
    <div className="flex flex-col h-full min-h-screen bg-background">

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 bg-card/40 shrink-0">
        <div className="flex items-center gap-3">
          <ArrowRightLeft className="w-5 h-5 text-fuchsia-400" />
          <div>
            <h1 className="text-base font-semibold flex items-center gap-2">
              Traffic Steering
              {pendingCount > 0 && (
                <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30">
                  {pendingCount} pending
                </span>
              )}
            </h1>
            <p className="text-xs text-muted-foreground">Carrier traffic shift suggestions · Human-approved only</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            data-testid="btn-generate-steering"
            onClick={() => generateMut.mutate()}
            disabled={generateMut.isPending}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-fuchsia-500/15 border border-fuchsia-500/30 text-fuchsia-400 hover:bg-fuchsia-500/25 text-xs font-medium transition-colors disabled:opacity-50"
          >
            {generateMut.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            Generate
          </button>
          <button
            data-testid="btn-refresh-steering"
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
          Approving a suggestion records your intent — it does not send commands to Sippy. Manual routing updates must be applied in the Routing Manager.
        </p>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-4 gap-px bg-border/20 border-b border-border/30 shrink-0">
        {[
          { label: 'Pending',  value: byStatus.pending?.length  ?? 0, color: 'text-amber-400'   },
          { label: 'Approved', value: byStatus.approved?.length ?? 0, color: 'text-emerald-400' },
          { label: 'Snoozed',  value: byStatus.snoozed?.length  ?? 0, color: 'text-slate-400'   },
          { label: 'Dismissed',value: byStatus.rejected?.length ?? 0, color: 'text-slate-400'   },
        ].map(k => (
          <div key={k.label} className="bg-card/40 px-4 py-3">
            <div className={`text-2xl font-bold font-mono ${k.color}`}>{k.value}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{k.label}</div>
          </div>
        ))}
      </div>

      {/* Status tabs */}
      <div className="flex items-center gap-1 px-6 py-3 border-b border-border/30 bg-card/20 shrink-0">
        {STATUS_TABS.map(t => (
          <button
            key={t.key}
            data-testid={`tab-${t.key}`}
            onClick={() => setTab(t.key as any)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
              tab === t.key
                ? `bg-fuchsia-500/20 ${t.color} border border-fuchsia-500/30`
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
            )}
          >
            {t.label}
            <span className="ml-1.5 opacity-60">{byStatus[t.key]?.length ?? 0}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <RefreshCw className="w-7 h-7 animate-spin text-muted-foreground/40" />
          </div>
        ) : visibleSuggestions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3 text-muted-foreground/50">
            {tab === 'pending' ? (
              <>
                <ArrowRightLeft className="w-10 h-10 opacity-30" />
                <div className="text-sm text-center">
                  <p>No pending steering suggestions.</p>
                  <p className="text-xs mt-1">Click Generate to run the engine against current carrier scores.</p>
                </div>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-10 h-10 opacity-30" />
                <p className="text-sm">No {tab} suggestions</p>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-3 max-w-3xl">
            {visibleSuggestions.map(sug => (
              <SteeringCard
                key={sug.id}
                sug={sug}
                score={scoresByCarrier.get(sug.carrierName)}
                onAction={(id, action) => actionMut.mutate({ id, action })}
              />
            ))}
          </div>
        )}
      </div>

      {/* Info footer */}
      <div className="flex items-center gap-2 px-6 py-2.5 border-t border-border/20 bg-card/20 shrink-0">
        <Info className="w-3 h-3 text-muted-foreground/40 shrink-0" />
        <p className="text-[10px] text-muted-foreground/40">
          Suggestions are generated from carrier stability scores, ASR trends, and PDD patterns. Suggestions expire after 2h if snoozed or superseded by new data.
        </p>
      </div>
    </div>
  );
}
