import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BrainCircuit, AlertTriangle, TrendingDown, TrendingUp, CheckCircle2,
  XCircle, Clock, RefreshCw, Play, ChevronDown, ChevronRight,
  Activity, Zap, Shield, BarChart3, Target, Info, Minus,
  HelpCircle, X, MapPin, Globe, ArrowRight, GitBranch, AlertCircle,
  FlaskConical,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useQuery as useExplainQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { getExplainabilityDepth } from "@/lib/governance";

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
  simulationValidatedAt: string | null;
  computedAt: string;
};

type SimPortfolioMetrics = {
  portfolioAsr: number; portfolioStability: number;
  portfolioFasRate: number; portfolioMargin: number;
};
type SimResult = {
  valid: boolean; reason?: string;
  current: SimPortfolioMetrics;
  simulated: SimPortfolioMetrics;
  delta: { asr: number; stability: number; fasRate: number; margin: number; concentration?: number };
};

type Summary = {
  totalCarriers: number; criticalCarriers: number; highCarriers: number;
  mediumCarriers: number; opportunityCarriers: number; healthyCarriers: number;
  actionableCount: number; generatedAt: string;
};

type RouteOptimisationData = { recommendations: RouteRec[]; summary: Summary };

type ExplainEvent = { type: string; ts: string; label: string; description?: string };

type ExplainData = {
  carrier: string;
  explainabilityDepth?: string;
  verdict: {
    urgency: string; primaryCause: string; confidence: number;
    window: string; trend: string; stabilityScore: number | null;
  };
  metrics: Record<string, { prev: number | null; current: number | null; window: string; label: string }>;
  blastRadius: {
    portfolioExposure: number; revenueExposure: number;
    vendorCalls: number; totalCalls: number;
    countries: string[];
    prefixBreakdown: Array<{ prefix: string; country: string; flag: string; callShare: number; revenueShare: number }>;
  };
  timeline: Array<{ ts: string; qScore: number; asr: number | null; fasRate: number | null; stability: string }>;
  projection: {
    action: string; asrGain: string; marginGain: string;
    fasReduction: string; stabilityGain: string; trafficShift: string;
  } | null;
  events?: ExplainEvent[];
  sampleCount: number;
  generatedAt: string;
};

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

const URGENCY_COLOR: Record<string, string> = {
  HIGH:   'text-red-400 bg-red-500/15 border-red-500/30',
  MEDIUM: 'text-orange-400 bg-orange-500/15 border-orange-500/30',
  LOW:    'text-emerald-400 bg-emerald-500/15 border-emerald-500/30',
  INFO:   'text-slate-400 bg-slate-500/15 border-slate-500/30',
};

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

// ── Delta cell ────────────────────────────────────────────────────────────────

function DeltaCell({ prev, current, invert = false }: { prev: number | null; current: number | null; invert?: boolean }) {
  if (prev == null || current == null) return <span className="text-muted-foreground/40 text-xs">—</span>;
  const delta = current - prev;
  const isPositive = invert ? delta < 0 : delta > 0;
  const isNeutral  = Math.abs(delta) < 0.5;
  const color = isNeutral ? 'text-slate-400' : isPositive ? 'text-emerald-400' : 'text-red-400';
  const arrow = isNeutral ? '' : delta > 0 ? '↑' : '↓';
  return (
    <span className={`text-xs font-mono font-semibold ${color}`}>
      {arrow}{Math.abs(delta).toFixed(1)}
    </span>
  );
}

// ── Explainability Drawer ─────────────────────────────────────────────────────

const DEPTH_LABEL: Record<string, string> = {
  full_evidence:     'Full Evidence',
  execution_impact:  'Execution Impact',
  executive_summary: 'Executive Summary',
  none:              'Hidden',
};

const EVENT_TYPE_META: Record<string, {
  icon: typeof AlertCircle; color: string; bg: string; border: string;
}> = {
  incident_high:           { icon: AlertTriangle,  color: 'text-red-400',     bg: 'bg-red-500/10',     border: 'border-red-500/30'     },
  incident_medium:         { icon: AlertCircle,    color: 'text-orange-400',  bg: 'bg-orange-500/10',  border: 'border-orange-500/30'  },
  resolved:                { icon: CheckCircle2,   color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' },
  recommendation_created:  { icon: GitBranch,      color: 'text-fuchsia-400', bg: 'bg-fuchsia-500/10', border: 'border-fuchsia-500/30' },
  recommendation_approved: { icon: CheckCircle2,   color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' },
  recommendation_rejected: { icon: XCircle,        color: 'text-slate-400',   bg: 'bg-slate-500/10',   border: 'border-slate-500/30'   },
  info:                    { icon: Info,            color: 'text-slate-400',   bg: 'bg-slate-500/10',   border: 'border-slate-500/30'   },
};

async function sendTelemetry(carrier: string, event: string, extra?: Record<string, unknown>) {
  try {
    await fetch('/api/explain/telemetry', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ carrier, event, ...extra }),
    });
  } catch { /* fire-and-forget — telemetry must never break the drawer */ }
}

function ExplainDrawer({ carrier, onClose }: { carrier: string; onClose: () => void }) {
  const { role } = useAuth();
  const depth = getExplainabilityDepth(role ?? 'viewer');
  const openedAt = useRef(Date.now());

  const { data, isLoading, isError } = useExplainQuery<ExplainData>({
    queryKey: ['/api/route-optimisation/explain', carrier],
    queryFn: () => fetch(`/api/route-optimisation/explain/${encodeURIComponent(carrier)}`, { credentials: 'include' }).then(r => r.json()),
    staleTime: 2 * 60_000,
  });

  useEffect(() => {
    if (depth === 'none') return;
    sendTelemetry(carrier, 'drawer_opened', { role: role ?? 'unknown', depth });
    return () => {
      sendTelemetry(carrier, 'drawer_closed', { decisionLatencyMs: Date.now() - openedAt.current });
    };
  }, [carrier]);

  if (depth === 'none') return null;

  const showConfidence   = depth === 'full_evidence';
  const showMetricsTable = depth !== 'executive_summary';
  const showPrefixDetail = depth === 'full_evidence';
  const showProjection   = depth !== 'executive_summary';
  const showTimeline     = depth === 'full_evidence';

  const depthBadgeClass =
    depth === 'full_evidence'     ? 'text-fuchsia-400 border-fuchsia-500/30 bg-fuchsia-500/10' :
    depth === 'execution_impact'  ? 'text-blue-400 border-blue-500/30 bg-blue-500/10' :
    depth === 'executive_summary' ? 'text-amber-400 border-amber-500/30 bg-amber-500/10' :
    'text-slate-400 border-slate-500/30 bg-slate-500/10';

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="relative z-10 w-full max-w-xl bg-card border-l border-border flex flex-col h-full shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/50 shrink-0">
          <div className="flex items-center gap-3">
            <HelpCircle className="w-4 h-4 text-fuchsia-400" />
            <div>
              <div className="text-sm font-semibold">Why this recommendation?</div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-muted-foreground font-mono">{carrier}</span>
                <span className={cn("text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full border", depthBadgeClass)}>
                  {DEPTH_LABEL[depth]}
                </span>
              </div>
            </div>
          </div>
          <button onClick={onClose} data-testid="btn-close-drawer"
            className="p-1.5 rounded-lg hover:bg-muted/40 transition-colors text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {isLoading && (
            <div className="flex items-center justify-center h-48">
              <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground/40" />
            </div>
          )}
          {isError && (
            <div className="flex items-center justify-center h-48 text-sm text-muted-foreground/60">
              Could not load explanation data.
            </div>
          )}
          {data && (
            <div className="divide-y divide-border/30">

              {/* Section 1 — Operational Briefing (all depths) */}
              <div className="px-5 py-5">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">Operational Briefing</div>
                <div className="flex items-start gap-3 mb-3">
                  <span className={`text-xs font-semibold px-2 py-1 rounded-full border shrink-0 ${URGENCY_COLOR[data.verdict.urgency] ?? URGENCY_COLOR.INFO}`}>
                    {data.verdict.urgency}
                  </span>
                  <p className="text-sm leading-relaxed text-foreground/90">{data.verdict.primaryCause}</p>
                </div>
                {showConfidence ? (
                  <div className="flex items-center gap-4 mt-3">
                    <div className="flex-1">
                      <div className="text-[10px] text-muted-foreground mb-1">Confidence</div>
                      <ConfidenceBar value={data.verdict.confidence} />
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[10px] text-muted-foreground">Comparison window</div>
                      <div className="text-xs text-foreground/70 mt-0.5">{data.verdict.window}</div>
                    </div>
                  </div>
                ) : (
                  <div className="text-right mt-2">
                    <div className="text-[10px] text-muted-foreground/60">{data.verdict.window}</div>
                  </div>
                )}
              </div>

              {/* Section 2 — What Changed? (full_evidence + execution_impact) */}
              {showMetricsTable && Object.keys(data.metrics).length > 0 && (
                <div className="px-5 py-5">
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">What changed?</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-muted-foreground/60">
                          <th className="text-left font-normal pb-2 pr-3">Metric</th>
                          <th className="text-right font-normal pb-2 pr-3">168h avg</th>
                          <th className="text-right font-normal pb-2 pr-3">24h current</th>
                          <th className="text-right font-normal pb-2">Change</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/20">
                        {Object.entries(data.metrics).map(([key, m]) => (
                          <tr key={key}>
                            <td className="py-2 pr-3 text-muted-foreground">{m.label}</td>
                            <td className="py-2 pr-3 text-right font-mono">{m.prev != null ? m.prev.toFixed(1) : '—'}</td>
                            <td className="py-2 pr-3 text-right font-mono text-foreground">{m.current != null ? m.current.toFixed(1) : '—'}</td>
                            <td className="py-2 text-right">
                              <DeltaCell prev={m.prev} current={m.current} invert={key === 'failRate' || key === 'pdd'} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {data.sampleCount > 0 && (
                    <p className="text-[10px] text-muted-foreground/50 mt-2">Based on {data.sampleCount.toLocaleString()} call samples</p>
                  )}
                </div>
              )}

              {/* Section 3 — Blast Radius (all depths, detail gated) */}
              <div className="px-5 py-5">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">Blast Radius</div>
                <div className="flex items-center gap-4 mb-4">
                  <div className={cn(
                    "bg-muted/20 border rounded-xl px-5 py-3 text-center",
                    data.blastRadius.portfolioExposure >= 30 ? 'border-red-500/30' :
                    data.blastRadius.portfolioExposure >= 15 ? 'border-orange-500/30' :
                    'border-border/40'
                  )}>
                    <div className={`text-3xl font-bold font-mono ${
                      data.blastRadius.portfolioExposure >= 30 ? 'text-red-400' :
                      data.blastRadius.portfolioExposure >= 15 ? 'text-orange-400' : 'text-yellow-400'
                    }`}>
                      {data.blastRadius.portfolioExposure}%
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">of active portfolio at risk</div>
                  </div>
                  <div className="flex-1 space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Revenue exposure</span>
                      <span className="font-mono">{data.blastRadius.revenueExposure}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Carrier calls</span>
                      <span className="font-mono">{data.blastRadius.vendorCalls.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total calls</span>
                      <span className="font-mono">{data.blastRadius.totalCalls.toLocaleString()}</span>
                    </div>
                  </div>
                </div>
                {data.blastRadius.countries.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap mb-3">
                    <Globe className="w-3 h-3 text-muted-foreground/50 shrink-0" />
                    {data.blastRadius.countries.map(c => (
                      <span key={c} className="text-xs bg-muted/30 px-2 py-0.5 rounded-full text-foreground/70">{c}</span>
                    ))}
                  </div>
                )}
                {showPrefixDetail && data.blastRadius.prefixBreakdown.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-[10px] text-muted-foreground/60 mb-2 flex items-center gap-1">
                      <MapPin className="w-3 h-3" /> Affected prefixes
                    </div>
                    {data.blastRadius.prefixBreakdown.slice(0, 5).map(p => (
                      <div key={p.prefix} className="flex items-center gap-2 text-xs">
                        <span className="text-base leading-none">{p.flag}</span>
                        <span className="font-mono text-foreground/80">+{p.prefix}</span>
                        <span className="text-muted-foreground flex-1">{p.country}</span>
                        <div className="flex items-center gap-1.5">
                          <div className="w-16 h-1 bg-muted/30 rounded-full overflow-hidden">
                            <div className="h-full bg-fuchsia-500/60 rounded-full" style={{ width: `${p.callShare}%` }} />
                          </div>
                          <span className="text-muted-foreground w-8 text-right">{p.callShare}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {data.blastRadius.portfolioExposure === 0 && data.blastRadius.vendorCalls === 0 && (
                  <p className="text-xs text-muted-foreground/50">No CDR data in cache — exposure estimated from quality score data only.</p>
                )}
              </div>

              {/* Section 4 — Projection Summary (full_evidence + execution_impact) */}
              {showProjection && data.projection && (
                <div className="px-5 py-5">
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">Projection Summary</div>
                  <p className="text-xs text-foreground/70 mb-3 flex items-center gap-1.5">
                    <ArrowRight className="w-3 h-3 text-fuchsia-400 shrink-0" />
                    {data.projection.action}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: 'ASR gain',      value: data.projection.asrGain,       color: 'text-emerald-400' },
                      { label: 'Margin gain',    value: data.projection.marginGain,    color: 'text-blue-400'    },
                      { label: 'FAS reduction',  value: data.projection.fasReduction,  color: 'text-orange-400'  },
                      { label: 'Stability gain', value: data.projection.stabilityGain, color: 'text-fuchsia-400' },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="bg-muted/20 border border-border/30 rounded-lg px-3 py-2.5">
                        <div className="text-[10px] text-muted-foreground">{label}</div>
                        <div className={`text-lg font-bold font-mono mt-0.5 ${color}`}>{value}</div>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground/40 mt-3">
                    Pre-computed advisory projection. Use the Simulation Sandbox to model custom traffic shifts.
                  </p>
                </div>
              )}

              {/* Section 5 — 48h Stability Sparkline (all depths) */}
              {data.timeline.length > 0 && (
                <div className="px-5 py-5">
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                    48h Stability Timeline ({data.timeline.length} snapshots)
                  </div>
                  <div className="flex items-end gap-0.5 h-16">
                    {data.timeline.map((t, i) => {
                      const h = Math.max(4, Math.round((t.qScore / 100) * 64));
                      const col = t.qScore >= 80 ? 'bg-emerald-500' : t.qScore >= 55 ? 'bg-yellow-500' : t.qScore >= 35 ? 'bg-orange-500' : 'bg-red-500';
                      return (
                        <div key={i}
                          title={`${new Date(t.ts).toLocaleTimeString()} — Q:${t.qScore}`}
                          className={`flex-1 rounded-t-sm opacity-80 hover:opacity-100 transition-opacity cursor-default ${col}`}
                          style={{ height: `${h}px` }} />
                      );
                    })}
                  </div>
                  <div className="flex justify-between text-[10px] text-muted-foreground/40 mt-1">
                    <span>48h ago</span><span>Now</span>
                  </div>
                </div>
              )}

              {/* Section 6 — Incident & Lifecycle Timeline (full_evidence only) */}
              {showTimeline && data.events && data.events.length > 0 && (
                <div className="px-5 py-5">
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-4">Incident Timeline</div>
                  <div className="relative">
                    <div className="absolute left-3 top-0 bottom-0 w-px bg-border/40" />
                    <div className="space-y-4">
                      {data.events.map((ev, i) => {
                        const meta = EVENT_TYPE_META[ev.type] ?? EVENT_TYPE_META.info;
                        const EvIcon = meta.icon;
                        return (
                          <div key={i} className="flex items-start gap-3 relative">
                            <div className={cn(
                              "w-6 h-6 rounded-full border flex items-center justify-center shrink-0 z-10 bg-card",
                              meta.border, meta.bg
                            )}>
                              <EvIcon className={cn("w-3 h-3", meta.color)} />
                            </div>
                            <div className="flex-1 min-w-0 pt-0.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={cn("text-xs font-medium", meta.color)}>{ev.label}</span>
                                <span className="text-[10px] text-muted-foreground/50 font-mono">
                                  {new Date(ev.ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                              {ev.description && (
                                <p className="text-xs text-muted-foreground/70 mt-0.5 leading-relaxed">{ev.description}</p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border/30 bg-card/50 shrink-0">
          <p className="text-[10px] text-muted-foreground/40 flex items-center gap-1">
            <Shield className="w-3 h-3 shrink-0" />
            Advisory only. No routing change happens without explicit human approval.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Simulation Panel ──────────────────────────────────────────────────────────

function SimulationPanel({ rec, allCarriers, onValidated }: {
  rec: RouteRec;
  allCarriers: string[];
  onValidated: (simulationValidatedAt: string) => void;
}) {
  const toOptions = allCarriers.filter(c => c !== rec.carrier);
  const [toCarrier, setToCarrier]     = useState(toOptions[0] ?? '');
  const [shiftPct, setShiftPct]       = useState(rec.trafficShift > 0 ? Math.min(rec.trafficShift, 50) : 10);
  const [simResult, setSimResult]     = useState<SimResult | null>(null);
  const [running, setRunning]         = useState(false);
  const [validating, setValidating]   = useState(false);
  const { toast } = useToast();

  async function runSim() {
    setRunning(true);
    setSimResult(null);
    try {
      const r = await apiRequest('POST', '/api/simulation', { fromCarrier: rec.carrier, toCarrier, shiftPercent: shiftPct });
      const d = await r.json();
      setSimResult(d);
    } catch (e: any) {
      toast({ title: 'Simulation failed', description: e.message ?? String(e), variant: 'destructive' });
    } finally { setRunning(false); }
  }

  async function confirmValidation() {
    if (!simResult || !rec.suggestionId) return;
    setValidating(true);
    try {
      const r = await apiRequest('POST', `/api/routing-suggestions/${rec.suggestionId}/simulate-validate`, {
        fromCarrier: rec.carrier, toCarrier, shiftPercent: shiftPct,
      });
      const d = await r.json();
      toast({ title: 'Simulation validated ✓', description: `Stamp recorded at ${new Date(d.simulationValidatedAt).toLocaleTimeString()}. You may now approve.` });
      onValidated(d.simulationValidatedAt);
    } catch (e: any) {
      toast({ title: 'Validation failed', description: e.message ?? String(e), variant: 'destructive' });
    } finally { setValidating(false); }
  }

  return (
    <div className="bg-blue-950/30 border border-blue-500/20 rounded-xl p-4 space-y-4">
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-blue-400">
        <FlaskConical className="w-3.5 h-3.5" />
        Simulation Sandbox
      </div>

      {/* Carrier selectors */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-[10px] text-muted-foreground mb-1.5">From Carrier</div>
          <div className="text-xs font-medium bg-muted/20 border border-border/30 rounded-lg px-3 py-2 text-foreground/80 truncate">{rec.carrier}</div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground mb-1.5">To Carrier</div>
          {toOptions.length > 0 ? (
            <select
              value={toCarrier}
              onChange={e => { setToCarrier(e.target.value); setSimResult(null); }}
              data-testid={`sim-to-carrier-${rec.carrier}`}
              className="w-full text-xs bg-muted/20 border border-border/30 rounded-lg px-3 py-2 text-foreground focus:outline-none focus:border-blue-500/50"
            >
              {toOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          ) : (
            <div className="text-xs text-muted-foreground/50 px-3 py-2 bg-muted/10 border border-border/20 rounded-lg">No other carriers</div>
          )}
        </div>
      </div>

      {/* Traffic shift slider */}
      <div>
        <div className="flex justify-between text-[10px] text-muted-foreground mb-2">
          <span>Traffic shift from {rec.carrier}</span>
          <span className="font-mono text-blue-400 font-semibold">{shiftPct}%</span>
        </div>
        <input
          type="range" min={1} max={50} value={shiftPct}
          data-testid={`sim-shift-${rec.carrier}`}
          onChange={e => { setShiftPct(Number(e.target.value)); setSimResult(null); }}
          className="w-full accent-blue-500"
        />
        <div className="flex justify-between text-[10px] text-muted-foreground/40 mt-0.5">
          <span>1%</span><span>50%</span>
        </div>
      </div>

      <button
        data-testid={`btn-run-sim-${rec.carrier}`}
        onClick={runSim}
        disabled={running || !toCarrier}
        className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-blue-500/15 border border-blue-500/30 text-blue-400 hover:bg-blue-500/25 text-xs font-medium transition-colors disabled:opacity-50"
      >
        {running ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
        {running ? 'Running simulation…' : 'Run Simulation'}
      </button>

      {/* Results */}
      {simResult && (
        <div className="space-y-3">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Portfolio Impact</div>
          <div className="overflow-x-auto -mx-1 px-1">
            <table className="w-full text-xs min-w-[280px]">
              <thead>
                <tr>
                  <th className="text-left text-muted-foreground/60 font-normal pb-2 pr-2">Metric</th>
                  <th className="text-right text-muted-foreground/60 font-normal pb-2 pr-2">Current</th>
                  <th className="text-right text-muted-foreground/60 font-normal pb-2 pr-2">Simulated</th>
                  <th className="text-right text-muted-foreground/60 font-normal pb-2">Delta</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {([
                  { label: 'Portfolio ASR',  cur: simResult.current.portfolioAsr,      sim: simResult.simulated.portfolioAsr,      d: simResult.delta.asr,       unit: '%', invert: false },
                  { label: 'Stability',      cur: simResult.current.portfolioStability, sim: simResult.simulated.portfolioStability, d: simResult.delta.stability,  unit: '',  invert: false },
                  { label: 'FAS Rate',       cur: simResult.current.portfolioFasRate,   sim: simResult.simulated.portfolioFasRate,   d: simResult.delta.fasRate,    unit: '%', invert: true  },
                  { label: 'Margin Index',   cur: simResult.current.portfolioMargin,    sim: simResult.simulated.portfolioMargin,    d: simResult.delta.margin,     unit: '',  invert: false },
                ] as { label: string; cur: number; sim: number; d: number; unit: string; invert: boolean }[]).map(row => {
                  const isGood  = row.invert ? row.d < 0 : row.d > 0;
                  const dColor  = Math.abs(row.d) < 0.05 ? 'text-slate-400' : isGood ? 'text-emerald-400' : 'text-red-400';
                  const prefix  = row.d > 0 ? '+' : '';
                  return (
                    <tr key={row.label}>
                      <td className="py-1.5 pr-2 text-muted-foreground">{row.label}</td>
                      <td className="py-1.5 pr-2 text-right font-mono">{row.cur.toFixed(1)}{row.unit}</td>
                      <td className="py-1.5 pr-2 text-right font-mono text-foreground">{row.sim.toFixed(1)}{row.unit}</td>
                      <td className={`py-1.5 text-right font-mono font-semibold ${dColor}`}>{prefix}{row.d.toFixed(1)}{row.unit}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {!simResult.valid && (
            <div className="flex items-start gap-2 text-xs text-orange-400 bg-orange-500/10 border border-orange-500/20 rounded-lg px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{simResult.reason ?? 'Simulation has warnings — review carefully before proceeding.'}</span>
            </div>
          )}

          <button
            data-testid={`btn-confirm-sim-${rec.carrier}`}
            onClick={confirmValidation}
            disabled={validating || !rec.suggestionId}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25 text-xs font-medium transition-colors disabled:opacity-50"
          >
            {validating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            {validating ? 'Recording validation…' : 'Confirm Simulation'}
          </button>

          <p className="text-[10px] text-muted-foreground/40 leading-relaxed">
            Confirming records this simulation as the pre-approval validation stamp. The actual routing change still requires a separate Approve decision.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Recommendation Card ───────────────────────────────────────────────────────

function RecCard({ rec, onAction, onExplain, allCarriers }: {
  rec: RouteRec;
  onAction: (id: number, action: 'approve' | 'reject' | 'snooze') => void;
  onExplain: (carrier: string) => void;
  allCarriers: string[];
}) {
  const [expanded, setExpanded]                       = useState(false);
  const [showSimPanel, setShowSimPanel]               = useState(false);
  const [localSimValidatedAt, setLocalSimValidatedAt] = useState<string | null>(null);

  // ── Simulation freshness ────────────────────────────────────────────────────
  const SIM_WARN_MS  = 25 * 60_000;
  const SIM_STALE_MS = 30 * 60_000;
  const simValidatedAt = localSimValidatedAt ?? rec.simulationValidatedAt ?? null;
  const simAgeMs   = simValidatedAt ? Date.now() - new Date(simValidatedAt).getTime() : null;
  const simFresh   = simAgeMs != null && simAgeMs < SIM_WARN_MS;
  const simWarning = simAgeMs != null && simAgeMs >= SIM_WARN_MS && simAgeMs < SIM_STALE_MS;
  const simExpired = simAgeMs != null && simAgeMs >= SIM_STALE_MS;
  const simMinAgo  = simAgeMs != null ? Math.round(simAgeMs / 60_000) : null;
  const simMinLeft = simAgeMs != null ? Math.max(0, Math.round((SIM_STALE_MS - simAgeMs) / 60_000)) : null;

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
          <div className="flex items-center gap-2 mb-1 flex-wrap">
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
          <div className="flex items-center gap-1 mt-1">
            {/* Why button */}
            <button
              data-testid={`btn-why-${rec.carrier}`}
              onClick={() => onExplain(rec.carrier)}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-muted-foreground hover:text-fuchsia-400 hover:bg-fuchsia-500/10 transition-colors border border-transparent hover:border-fuchsia-500/20"
            >
              <HelpCircle className="w-3 h-3" />
              Why?
            </button>
            {rec.action && (
              <button
                onClick={() => setExpanded(e => !e)}
                data-testid={`btn-expand-${rec.carrier}`}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                {expanded ? 'Less' : 'Details'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && rec.action && (
        <div className="border-t border-border/20 px-4 pb-4 pt-3 space-y-4">
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

          {rec.suggestionId && rec.status === 'pending' && (
            <div className="space-y-3">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Human Approval Required</div>

              {/* ── Simulation freshness badge ──────────────────────────── */}
              {simFresh && (
                <div className="flex items-center gap-1.5 text-xs text-emerald-400">
                  <CheckCircle2 className="w-3 h-3 shrink-0" />
                  Simulation validated {simMinAgo === 0 ? 'just now' : `${simMinAgo}m ago`}
                </div>
              )}
              {simWarning && (
                <div className="flex items-center gap-1.5 text-xs text-amber-400">
                  <Clock className="w-3 h-3 shrink-0" />
                  Simulation stale in ~{simMinLeft}m — consider re-validating
                </div>
              )}
              {simExpired && simValidatedAt && (
                <div className="flex items-center gap-1.5 text-xs text-red-400">
                  <AlertTriangle className="w-3 h-3 shrink-0" />
                  Simulation expired — re-validate before approving
                </div>
              )}

              {/* ── Simulate button ─────────────────────────────────────── */}
              <button
                data-testid={`btn-simulate-${rec.carrier}`}
                onClick={() => setShowSimPanel(p => !p)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border',
                  showSimPanel
                    ? 'bg-blue-500/20 border-blue-500/40 text-blue-300'
                    : 'bg-blue-500/10 border-blue-500/25 text-blue-400 hover:bg-blue-500/20'
                )}
              >
                <FlaskConical className="w-3.5 h-3.5" />
                {showSimPanel ? 'Hide Simulation' : simFresh ? 'Re-Simulate' : 'Simulate First'}
              </button>

              {/* ── Inline simulation panel ─────────────────────────────── */}
              {showSimPanel && (
                <SimulationPanel
                  rec={rec}
                  allCarriers={allCarriers}
                  onValidated={ts => {
                    setLocalSimValidatedAt(ts);
                    setShowSimPanel(false);
                  }}
                />
              )}

              {/* ── Action buttons ──────────────────────────────────────── */}
              <div className="flex gap-2 flex-wrap">
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
  const [filter, setFilter]         = useState('all');
  const [explainCarrier, setExplain] = useState<string | null>(null);
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

  const recs    = data?.recommendations ?? [];
  const summary = data?.summary;

  const filtered = useMemo(() =>
    filter === 'all' ? recs : recs.filter(r => r.priority === filter),
    [recs, filter]
  );

  const actionableCount = summary?.actionableCount ?? 0;

  return (
    <div className="flex flex-col h-full min-h-screen bg-background">

      {/* Explainability Drawer */}
      {explainCarrier && (
        <ExplainDrawer carrier={explainCarrier} onClose={() => setExplain(null)} />
      )}

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
          Click <span className="font-semibold">Why?</span> on any card to open the full evidence brief.
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
                onExplain={setExplain}
                allCarriers={recs.map(r => r.carrier)}
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
          Recommendations derive from carrier quality scores, rolling ASR, PDD, and stability trends. Click "Why?" for the full evidence brief including blast radius and metric timeline.
        </p>
      </div>
    </div>
  );
}
