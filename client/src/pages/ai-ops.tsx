import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bot, AlertTriangle, CheckCircle2, TrendingDown, Zap, Search, RefreshCw, Info, ArrowRight, Brain, Lightbulb, Activity, Clock, Play, TrendingUp, BarChart3, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AnomalyEvent {
  id: number;
  vendor: string | null;
  metric: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  rootCause: string;
  recommendation: string;
  affectedEntities: string[];
  currentValue: number;
  baselineMean: number;
  baselineStddev: number;
  deviationSigma: number;
  resolved: boolean;
  resolvedAt: string | null;
  detectedAt: string;
}

interface Prediction {
  id: string;
  type: string;
  entity: string;
  description: string;
  estimatedTime: string;
  confidence: number;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const SEVERITY_CONFIG = {
  critical: { color: 'text-rose-400',   bg: 'bg-rose-500/5 border-rose-500/30',     badge: 'bg-rose-500/15 text-rose-400 border-rose-500/30'   },
  high:     { color: 'text-orange-400', bg: 'bg-orange-500/5 border-orange-500/30', badge: 'bg-orange-500/15 text-orange-400 border-orange-500/30' },
  medium:   { color: 'text-amber-400',  bg: 'bg-amber-500/5 border-amber-500/30',   badge: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  low:      { color: 'text-blue-400',   bg: 'bg-blue-500/5 border-blue-500/20',     badge: 'bg-blue-500/15 text-blue-400 border-blue-500/30'   },
};

const METRIC_LABEL: Record<string, string> = {
  asr: 'ASR',
  acd: 'ACD',
  cps: 'Calls/hr',
};

const NLQ_EXAMPLES = [
  "Show me all failed calls to Pakistan in the last 2 hours",
  "Which carrier had the worst ASR today?",
  "How many calls did PUSHTOTALK make this week?",
  "What destinations saw the most FAS flags this month?",
];

// Generate predictive alerts from live anomalies
function buildPredictions(anomalies: AnomalyEvent[]): Prediction[] {
  const active = anomalies.filter(a => !a.resolved);
  const predictions: Prediction[] = [];

  // Capacity warning: high CPS anomaly vendors
  const cpsAnomaly = active.find(a => a.metric === 'cps' && a.currentValue > a.baselineMean);
  if (cpsAnomaly) {
    predictions.push({
      id: `pred-cps-${cpsAnomaly.id}`,
      type: 'capacity',
      entity: cpsAnomaly.vendor ?? 'Network',
      description: `At current traffic growth (${cpsAnomaly.deviationSigma.toFixed(1)}σ above baseline), ${cpsAnomaly.vendor} may exhaust concurrent call limits`,
      estimatedTime: '~30–60 minutes',
      confidence: Math.min(95, Math.round(50 + cpsAnomaly.deviationSigma * 10)),
    });
  }

  // Quality warning: ASR downtrend
  const asrAnomaly = active.find(a => a.metric === 'asr' && a.currentValue < a.baselineMean);
  if (asrAnomaly) {
    predictions.push({
      id: `pred-asr-${asrAnomaly.id}`,
      type: 'quality',
      entity: asrAnomaly.vendor ?? 'Network',
      description: `Continued ASR degradation on ${asrAnomaly.vendor} (${asrAnomaly.currentValue.toFixed(1)}% vs ${asrAnomaly.baselineMean.toFixed(1)}% baseline) may impact call quality scores`,
      estimatedTime: '~1–2 hours',
      confidence: Math.min(90, Math.round(45 + asrAnomaly.deviationSigma * 8)),
    });
  }

  return predictions;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AiOpsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [query, setQuery]           = useState('');
  const [queryResult, setQueryResult] = useState<string | null>(null);
  const [querying, setQuerying]     = useState(false);
  const [showOnlyActive, setShowOnlyActive] = useState(false);

  // ── Live anomaly feed ──────────────────────────────────────────────────────
  const { data: rawAnomalies = [], isLoading, dataUpdatedAt } = useQuery<AnomalyEvent[]>({
    queryKey: ['/api/anomalies'],
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const anomalies      = showOnlyActive ? rawAnomalies.filter(a => !a.resolved) : rawAnomalies;
  const activeCount    = rawAnomalies.filter(a => !a.resolved).length;
  const criticalCount  = rawAnomalies.filter(a => a.severity === 'critical' && !a.resolved).length;
  const predictions    = buildPredictions(rawAnomalies);

  // ── Resolve mutation ───────────────────────────────────────────────────────
  const resolveMutation = useMutation({
    mutationFn: (id: number) => apiRequest('POST', `/api/anomalies/${id}/resolve`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/anomalies'] });
      toast({ title: 'Anomaly resolved' });
    },
    onError: (e: any) => toast({ title: 'Failed to resolve', description: e.message, variant: 'destructive' }),
  });

  // ── Manual engine trigger ──────────────────────────────────────────────────
  const runMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/anomalies/run');
      return res.json();
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['/api/anomalies'] });
      if (data.detected > 0) {
        toast({ title: `${data.detected} new anomal${data.detected === 1 ? 'y' : 'ies'} detected`, description: `${data.baselines} baselines updated.` });
      } else {
        toast({ title: 'Engine ran — no new anomalies', description: `${data.baselines} baselines computed. Network looks normal.` });
      }
    },
    onError: (e: any) => toast({ title: 'Engine run failed', description: e.message, variant: 'destructive' }),
  });

  // ── NLQ (stub — future AI pipeline) ───────────────────────────────────────
  async function handleQuery(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setQuerying(true);
    setQueryResult(null);

    // Build a data-aware response from live anomalies
    await new Promise(r => setTimeout(r, 600));
    const lowerQ = query.toLowerCase();
    const mentionedVendor = rawAnomalies.find(a => a.vendor && lowerQ.includes(a.vendor.toLowerCase()));

    if (mentionedVendor) {
      setQueryResult(
        `Query: "${query}"\n\n` +
        `Live anomaly data for ${mentionedVendor.vendor}:\n` +
        `• ${mentionedVendor.title}\n` +
        `• Current ${METRIC_LABEL[mentionedVendor.metric] ?? mentionedVendor.metric}: ${mentionedVendor.currentValue.toFixed(2)} ` +
        `(baseline: ${mentionedVendor.baselineMean.toFixed(2)}, deviation: ${mentionedVendor.deviationSigma.toFixed(1)}σ)\n` +
        `• ${mentionedVendor.recommendation}`
      );
    } else if (lowerQ.includes('worst') || lowerQ.includes('asr') || lowerQ.includes('drop')) {
      const asrEvents = rawAnomalies.filter(a => a.metric === 'asr' && !a.resolved);
      if (asrEvents.length > 0) {
        const worst = asrEvents.sort((a, b) => a.deviationSigma - b.deviationSigma)[0];
        setQueryResult(
          `Query: "${query}"\n\n` +
          `Worst ASR anomaly in the last 48 hours:\n` +
          `• ${worst.vendor}: ${worst.currentValue.toFixed(1)}% ASR (baseline: ${worst.baselineMean.toFixed(1)}%, deviation: ${worst.deviationSigma.toFixed(1)}σ)\n` +
          `• Detected: ${new Date(worst.detectedAt).toLocaleString()}\n` +
          `• ${worst.recommendation}`
        );
      } else {
        setQueryResult(`Query: "${query}"\n\nNo ASR anomalies detected in the last 48 hours. All vendors are within normal baseline ranges.`);
      }
    } else {
      setQueryResult(
        `Query: "${query}"\n\nAI analysis running against your Sippy CDR data…\n\n` +
        `Live summary:\n` +
        `• ${activeCount} active anomal${activeCount === 1 ? 'y' : 'ies'} detected across all vendors\n` +
        `• ${rawAnomalies.filter(a => a.resolved).length} resolved in the last 48 hours\n` +
        `• Statistical baselines computed from rolling CDR cache\n\n` +
        `Natural language SQL translation against the full CDR warehouse requires connecting the AI pipeline (future feature).`
      );
    }
    setQuerying(false);
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-violet-500/10 border border-violet-500/20">
              <Bot className="h-5 w-5 text-violet-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold">AI Operations Center</h1>
              <p className="text-sm text-muted-foreground">Statistical anomaly detection with rolling baselines from live CDR data</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm" variant="outline"
              onClick={() => runMutation.mutate()}
              disabled={runMutation.isPending}
              data-testid="button-run-anomaly-engine"
              className="gap-1.5"
            >
              {runMutation.isPending
                ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                : <Play className="h-3.5 w-3.5" />}
              Run Engine
            </Button>
            <Button
              size="sm" variant="outline"
              onClick={() => qc.invalidateQueries({ queryKey: ['/api/anomalies'] })}
              data-testid="button-refresh-aiops"
              className="gap-1.5"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
          </div>
        </div>

        {/* Status banner */}
        {!isLoading && activeCount > 0 && (
          <div className={cn("rounded-xl border p-4 flex items-center gap-3", criticalCount > 0 ? "bg-rose-500/5 border-rose-500/30" : "bg-amber-500/5 border-amber-500/30")}>
            <AlertTriangle className={cn("h-5 w-5 shrink-0", criticalCount > 0 ? "text-rose-400" : "text-amber-400")} />
            <div className="flex-1">
              <p className={cn("text-sm font-semibold", criticalCount > 0 ? "text-rose-300" : "text-amber-300")}>
                {activeCount} active anomal{activeCount === 1 ? 'y' : 'ies'} detected
              </p>
              <p className="text-xs text-muted-foreground">Statistical engine has identified deviations ≥2σ from rolling baselines requiring attention.</p>
            </div>
          </div>
        )}

        {!isLoading && activeCount === 0 && rawAnomalies.length === 0 && (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-emerald-300">No anomalies detected</p>
              <p className="text-xs text-muted-foreground">
                {rawAnomalies.length === 0
                  ? 'Baselines are still being built from CDR cache. Run the engine manually to trigger the first analysis.'
                  : 'All vendor metrics are within normal statistical ranges.'}
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Anomaly feed */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <Activity className="h-4 w-4 text-rose-400" /> Anomaly Feed
                {dataUpdatedAt > 0 && (
                  <span className="text-[10px] text-muted-foreground/50 font-normal">
                    · updated {new Date(dataUpdatedAt).toLocaleTimeString()}
                  </span>
                )}
              </h2>
              <button
                onClick={() => setShowOnlyActive(s => !s)}
                className={cn("text-xs px-2 py-1 rounded-lg border transition-colors", showOnlyActive ? "bg-primary/10 border-primary/30 text-primary" : "border-border text-muted-foreground hover:text-foreground")}
                data-testid="button-toggle-active-only"
              >
                Active only
              </button>
            </div>

            {isLoading ? (
              <div className="space-y-3">
                {[1,2].map(i => (
                  <div key={i} className="bg-card border border-border rounded-xl p-5 animate-pulse">
                    <div className="h-4 bg-muted/40 rounded w-2/3 mb-2" />
                    <div className="h-3 bg-muted/30 rounded w-full" />
                  </div>
                ))}
              </div>
            ) : anomalies.length === 0 ? (
              <div className="bg-card border border-border rounded-xl p-12 text-center">
                <CheckCircle2 className="h-10 w-10 text-emerald-400/50 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">
                  {showOnlyActive ? 'No active anomalies' : 'No anomaly events in the last 48 hours'}
                </p>
                <p className="text-xs text-muted-foreground/60 mt-1">Network metrics are within normal statistical ranges</p>
              </div>
            ) : (
              <div className="space-y-3">
                {anomalies.map(a => {
                  const sev = (a.severity in SEVERITY_CONFIG ? a.severity : 'low') as keyof typeof SEVERITY_CONFIG;
                  const cfg = SEVERITY_CONFIG[sev];
                  const minAgo = Math.round((Date.now() - new Date(a.detectedAt).getTime()) / 60000);
                  return (
                    <div
                      key={a.id}
                      data-testid={`anomaly-card-${a.id}`}
                      className={cn("rounded-xl border p-5 space-y-3", a.resolved ? "opacity-60 bg-card border-border" : cfg.bg)}
                    >
                      <div className="flex items-start gap-3">
                        <AlertTriangle className={cn("h-4 w-4 shrink-0 mt-0.5", a.resolved ? "text-muted-foreground" : cfg.color)} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm">{a.title}</span>
                            <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-full border", cfg.badge)}>
                              {a.severity.toUpperCase()}
                            </span>
                            <span className="text-[10px] font-mono text-muted-foreground/60 bg-muted/30 px-1.5 py-0.5 rounded">
                              {a.deviationSigma.toFixed(1)}σ
                            </span>
                            <span className="text-[10px] text-muted-foreground/50 font-mono uppercase">
                              {METRIC_LABEL[a.metric] ?? a.metric}
                            </span>
                            {a.resolved && <span className="text-[10px] text-emerald-400 font-semibold flex items-center gap-0.5"><CheckCheck className="h-2.5 w-2.5" /> Resolved</span>}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">{a.description}</p>
                        </div>
                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                          <span className="text-[10px] text-muted-foreground/60 flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {minAgo < 60 ? `${minAgo}m ago` : `${Math.round(minAgo / 60)}h ago`}
                          </span>
                          {!a.resolved && (
                            <button
                              onClick={() => resolveMutation.mutate(a.id)}
                              disabled={resolveMutation.isPending}
                              data-testid={`button-resolve-anomaly-${a.id}`}
                              className="text-[10px] text-emerald-400/70 hover:text-emerald-300 border border-emerald-500/20 hover:border-emerald-500/40 rounded px-1.5 py-0.5 transition-colors"
                            >
                              Resolve
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Baseline comparison bar */}
                      <div className="rounded-lg bg-background/60 border border-border/50 p-3 space-y-2">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">Baseline vs Current</p>
                          <span className="text-[10px] font-mono text-muted-foreground/60">
                            {a.currentValue.toFixed(a.metric === 'asr' ? 1 : 0)}
                            {a.metric === 'asr' ? '%' : a.metric === 'acd' ? 's' : ''}
                            {' '}vs{' '}
                            {a.baselineMean.toFixed(a.metric === 'asr' ? 1 : 0)}
                            {a.metric === 'asr' ? '%' : a.metric === 'acd' ? 's' : ''} avg
                            {' '}±{a.baselineStddev.toFixed(1)}
                          </span>
                        </div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">Root Cause</p>
                        <p className="text-xs text-muted-foreground leading-relaxed">{a.rootCause}</p>
                      </div>

                      <div className="flex items-start gap-2">
                        <Lightbulb className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />
                        <p className="text-xs text-amber-300/80 leading-relaxed">{a.recommendation}</p>
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        {a.affectedEntities.map(e => (
                          <span key={e} className="text-[10px] px-2 py-0.5 rounded-full bg-muted/30 border border-border text-muted-foreground font-mono">{e}</span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Predictive Alerts — derived from live anomalies */}
            {predictions.length > 0 && (
              <>
                <h2 className="text-sm font-semibold flex items-center gap-2 pt-2">
                  <Brain className="h-4 w-4 text-violet-400" /> Predictive Alerts
                </h2>
                <div className="space-y-2">
                  {predictions.map(p => (
                    <div key={p.id} className="bg-card border border-border rounded-xl p-4 flex items-start gap-3">
                      <div className="p-1.5 rounded-lg bg-violet-500/10 border border-violet-500/20 shrink-0">
                        <Brain className="h-3.5 w-3.5 text-violet-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold">{p.entity}</span>
                          <span className="text-[10px] text-muted-foreground/60">in {p.estimatedTime}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{p.description}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-violet-400">{p.confidence}%</p>
                        <p className="text-[10px] text-muted-foreground">confidence</p>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* NLQ + Stats panel */}
          <div className="space-y-4">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Search className="h-4 w-4 text-cyan-400" /> Natural Language Query
            </h2>

            <div className="bg-card border border-border rounded-xl p-4 space-y-3">
              <form onSubmit={handleQuery} className="space-y-2">
                <Input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Ask anything about your network…"
                  className="text-sm"
                  data-testid="input-ai-query"
                />
                <Button type="submit" disabled={!query.trim() || querying} className="w-full" size="sm" data-testid="button-ai-query">
                  {querying ? "Analysing…" : <><Zap className="h-3.5 w-3.5 mr-1.5" /> Ask AI</>}
                </Button>
              </form>

              {queryResult && (
                <div className="rounded-lg border border-border bg-muted/20 p-3">
                  <pre className="text-[11px] text-muted-foreground whitespace-pre-wrap leading-relaxed">{queryResult}</pre>
                </div>
              )}

              <div className="space-y-1.5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">Example queries</p>
                {NLQ_EXAMPLES.map(ex => (
                  <button
                    key={ex}
                    onClick={() => setQuery(ex)}
                    className="w-full text-left text-[11px] text-muted-foreground/70 hover:text-foreground px-2 py-1.5 rounded hover:bg-muted/40 transition-colors leading-snug"
                  >
                    <ArrowRight className="h-2.5 w-2.5 inline mr-1.5 shrink-0" />{ex}
                  </button>
                ))}
              </div>
            </div>

            {/* Live stats summary */}
            <div className="bg-card border border-border rounded-xl p-4 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Detection Summary (48h)</p>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Active',   value: activeCount,                                      color: activeCount > 0 ? 'text-amber-400' : 'text-emerald-400' },
                  { label: 'Critical', value: criticalCount,                                    color: criticalCount > 0 ? 'text-rose-400' : 'text-muted-foreground' },
                  { label: 'Total',    value: rawAnomalies.length,                              color: 'text-foreground' },
                  { label: 'Resolved', value: rawAnomalies.filter(a => a.resolved).length,     color: 'text-emerald-400' },
                ].map(s => (
                  <div key={s.label} className="rounded-lg bg-muted/20 border border-border/40 p-2.5 text-center">
                    <p className={cn("text-xl font-bold", s.color)}>{isLoading ? '—' : s.value}</p>
                    <p className="text-[10px] text-muted-foreground">{s.label}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 flex items-start gap-2">
              <Info className="h-3.5 w-3.5 text-blue-400 mt-0.5 shrink-0" />
              <p className="text-[11px] text-muted-foreground">
                Baselines are computed per-vendor per-metric from hourly CDR buckets in the rolling cache.
                Deviations ≥2σ trigger anomaly records. The engine runs every 15 minutes automatically.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
