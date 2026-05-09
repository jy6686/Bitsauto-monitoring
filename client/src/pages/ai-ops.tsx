import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bot, AlertTriangle, CheckCircle2, TrendingDown, Zap, Search, RefreshCw, Info, ArrowRight, Brain, Lightbulb, Activity, Clock, Play, TrendingUp, BarChart3, CheckCheck, Layers, XCircle, ChevronDown, ChevronUp, ThumbsUp, ThumbsDown, BellOff, Sparkles, GitBranch, Volume2, VolumeX, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { AiCopilot } from "@/components/ai-copilot";
import { useAudioAlerts } from "@/hooks/use-audio-alerts";

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

interface AiOpsSignal {
  id: number;
  type: string;
  severity: string;
  message: string;
  entity: string | null;
  value: string | null;
  linkedExecId: string | null;
  source: string;
  createdAt: string;
}

interface AiOpsIncident {
  id: number;
  title: string;
  entity: string | null;
  severity: string;
  startTime: string;
  lastSeen: string;
  signalsCount: number;
  anomaliesCount: number;
  status: string;
  narrative: string | null;
  timelineJson: string | null;
  createdAt: string;
}

interface RoutingSuggestion {
  id: number;
  carrierName: string;
  entity: string | null;
  currentScore: number | null;
  suggestedAction: string;
  reason: string;
  confidence: number;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
}

interface TimelineEntry {
  ts: string;
  event: string;
  type: 'signal' | 'score_drop' | 'escalation' | 'resolution';
}

type FeedTab = 'all' | 'anomalies' | 'signals' | 'incidents';

const SIGNAL_TYPE_CONFIG: Record<string, { label: string; icon: any; bg: string; badge: string; color: string }> = {
  ROUTING_FAILURE:          { label: 'Routing Failure',       icon: AlertTriangle, bg: 'bg-rose-500/5 border-rose-500/30',     badge: 'bg-rose-500/15 text-rose-400 border-rose-500/30',   color: 'text-rose-400'   },
  EXECUTION_LATENCY_HIGH:   { label: 'High Execution Latency', icon: Activity,      bg: 'bg-amber-500/5 border-amber-500/30',   badge: 'bg-amber-500/15 text-amber-400 border-amber-500/30', color: 'text-amber-400'  },
  VENDOR_DEGRADATION_SIGNAL:{ label: 'Vendor Degradation',    icon: TrendingDown,  bg: 'bg-orange-500/5 border-orange-500/30', badge: 'bg-orange-500/15 text-orange-400 border-orange-500/30', color: 'text-orange-400'},
};

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
  const [feedTab, setFeedTab] = useState<FeedTab>('all');
  const [expandedIncident, setExpandedIncident] = useState<number | null>(null);

  // ── Live anomaly feed (statistical telemetry plane) ───────────────────────
  const { data: rawAnomalies = [], isLoading, dataUpdatedAt } = useQuery<AnomalyEvent[]>({
    queryKey: ['/api/anomalies'],
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  // ── AI Ops execution signals (control plane) ───────────────────────────────
  const { data: rawSignals = [], isLoading: signalsLoading } = useQuery<AiOpsSignal[]>({
    queryKey: ['/api/aiops/signals'],
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  // ── Incidents (correlation layer) ─────────────────────────────────────────
  const { data: incidents = [], isLoading: incidentsLoading } = useQuery<AiOpsIncident[]>({
    queryKey: ['/api/aiops/incidents'],
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const runCorrelationMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/aiops/incidents/run'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/aiops/incidents'] });
      toast({ title: 'Correlation engine run complete' });
    },
    onError: () => toast({ title: 'Correlation engine error', variant: 'destructive' }),
  });

  // ── Routing Suggestions ────────────────────────────────────────────────────
  const { data: suggestions = [], isLoading: suggestionsLoading } = useQuery<RoutingSuggestion[]>({
    queryKey: ['/api/routing-suggestions'],
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  const generateSuggestionsMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/routing-suggestions/generate'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/routing-suggestions'] });
      toast({ title: 'Routing suggestions generated' });
    },
    onError: () => toast({ title: 'Failed to generate suggestions', variant: 'destructive' }),
  });

  const suggestionActionMutation = useMutation({
    mutationFn: ({ id, action }: { id: number; action: 'approve' | 'reject' | 'snooze' }) =>
      apiRequest('POST', `/api/routing-suggestions/${id}/${action}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/routing-suggestions'] });
    },
    onError: () => toast({ title: 'Action failed', variant: 'destructive' }),
  });

  const pendingSuggestions = suggestions.filter(s => s.status === 'pending');

  const anomalies      = rawAnomalies;
  const activeCount    = rawAnomalies.filter(a => !a.resolved).length;
  const criticalCount  = rawAnomalies.filter(a => a.severity === 'critical' && !a.resolved).length;
  const predictions    = buildPredictions(rawAnomalies);

  // ── Unified feed: merge both planes, sorted newest-first ──────────────────
  type FeedItem =
    | { source: 'anomaly'; data: AnomalyEvent; ts: number }
    | { source: 'signal';  data: AiOpsSignal;  ts: number };

  const anomalyItems: FeedItem[] = anomalies.map(a => ({ source: 'anomaly' as const, data: a, ts: new Date(a.detectedAt).getTime() }));
  const signalItems:  FeedItem[] = rawSignals.map(s => ({ source: 'signal'  as const, data: s, ts: new Date(s.createdAt).getTime()  }));

  const unifiedFeed: FeedItem[] = feedTab === 'anomalies'
    ? [...anomalyItems].sort((a, b) => b.ts - a.ts)
    : feedTab === 'signals'
    ? [...signalItems].sort((a, b) => b.ts - a.ts)
    : [...anomalyItems, ...signalItems].sort((a, b) => b.ts - a.ts);

  const activeIncidents = incidents.filter(i => i.status === 'active');

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
  const { enabled: audioEnabled, toggle: toggleAudio, play: playAlert } = useAudioAlerts();
  const [copilotOpen, setCopilotOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <AiCopilot open={copilotOpen} onClose={() => setCopilotOpen(false)} />
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
              size="sm"
              variant={copilotOpen ? "default" : "outline"}
              onClick={() => setCopilotOpen(v => !v)}
              data-testid="button-copilot-toggle"
              className={cn("gap-1.5", copilotOpen && "bg-violet-600 hover:bg-violet-700 border-violet-600 text-white")}
            >
              <MessageCircle className="h-3.5 w-3.5" />
              AI Copilot
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={toggleAudio}
              data-testid="button-audio-toggle"
              title={audioEnabled ? "Disable audio alerts" : "Enable audio alerts"}
              className={cn("gap-1.5", audioEnabled && "border-green-500/50 text-green-400 bg-green-500/8")}
            >
              {audioEnabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
            </Button>
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
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <Activity className="h-4 w-4 text-rose-400" /> Intelligence Feed
                {dataUpdatedAt > 0 && (
                  <span className="text-[10px] text-muted-foreground/50 font-normal">
                    · updated {new Date(dataUpdatedAt).toLocaleTimeString()}
                  </span>
                )}
              </h2>
              <div className="flex items-center gap-1">
                {([
                  { key: 'all',       label: 'All',       count: rawAnomalies.length + rawSignals.length },
                  { key: 'anomalies', label: 'Anomalies', count: rawAnomalies.length },
                  { key: 'signals',   label: 'Signals',   count: rawSignals.length },
                  { key: 'incidents', label: 'Incidents', count: incidents.length, active: activeIncidents.length },
                ] as Array<{ key: FeedTab; label: string; count: number; active?: number }>).map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setFeedTab(tab.key)}
                    data-testid={`button-feed-tab-${tab.key}`}
                    className={cn(
                      "text-xs px-2.5 py-1 rounded-lg border transition-colors flex items-center gap-1.5",
                      feedTab === tab.key
                        ? tab.key === 'incidents'
                          ? "bg-rose-500/10 border-rose-500/30 text-rose-400"
                          : "bg-primary/10 border-primary/30 text-primary"
                        : "border-border text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {tab.label}
                    {tab.key === 'incidents' && tab.active != null && tab.active > 0 && (
                      <span className="text-[9px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded-full px-1.5 py-0.5 leading-none">{tab.active}</span>
                    )}
                    {tab.key !== 'incidents' && tab.count > 0 && (
                      <span className="text-[9px] text-muted-foreground/60">{tab.count}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {feedTab === 'incidents' ? (
              // ── Incidents Tab ───────────────────────────────────────────────
              incidentsLoading ? (
                <div className="space-y-3">
                  {[1,2].map(i => (
                    <div key={i} className="bg-card border border-border rounded-xl p-5 animate-pulse">
                      <div className="h-4 bg-muted/40 rounded w-2/3 mb-2" />
                      <div className="h-3 bg-muted/30 rounded w-full" />
                    </div>
                  ))}
                </div>
              ) : incidents.length === 0 ? (
                <div className="bg-card border border-border rounded-xl p-12 text-center">
                  <CheckCircle2 className="h-10 w-10 text-emerald-400/50 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">No incidents detected</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">
                    The correlation engine groups signals + anomalies into root-cause incidents.
                    Run it manually or wait for the 5-minute scheduler.
                  </p>
                  <button
                    onClick={() => runCorrelationMutation.mutate()}
                    disabled={runCorrelationMutation.isPending}
                    data-testid="button-run-correlation"
                    className="mt-4 text-xs px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors flex items-center gap-1.5 mx-auto"
                  >
                    <Play className="h-3 w-3" />
                    {runCorrelationMutation.isPending ? 'Running…' : 'Run now'}
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground/50">
                      {activeIncidents.length} active · {incidents.length - activeIncidents.length} resolved
                    </span>
                    <button
                      onClick={() => runCorrelationMutation.mutate()}
                      disabled={runCorrelationMutation.isPending}
                      data-testid="button-run-correlation-refresh"
                      className="text-[10px] px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                    >
                      <RefreshCw className={cn("h-2.5 w-2.5", runCorrelationMutation.isPending && "animate-spin")} />
                      {runCorrelationMutation.isPending ? 'Running…' : 'Re-run'}
                    </button>
                  </div>
                  <AnimatePresence initial={false}>
                  {incidents.map((inc, idx) => {
                    const sev = (inc.severity in SEVERITY_CONFIG ? inc.severity : 'medium') as keyof typeof SEVERITY_CONFIG;
                    const cfg = SEVERITY_CONFIG[sev];
                    const isActive = inc.status === 'active';
                    const lastSeenMs = new Date(inc.lastSeen).getTime();
                    const minAgo = Math.round((Date.now() - lastSeenMs) / 60000);
                    const timeLabel = minAgo < 60 ? `${minAgo}m ago` : `${Math.round(minAgo / 60)}h ago`;
                    const durationMs = new Date(inc.lastSeen).getTime() - new Date(inc.startTime).getTime();
                    const durationLabel = durationMs < 60000 ? '<1m' : durationMs < 3600000 ? `${Math.round(durationMs / 60000)}m` : `${Math.round(durationMs / 3600000)}h`;
                    const isExpanded = expandedIncident === inc.id;
                    const timeline: TimelineEntry[] = inc.timelineJson ? (() => { try { return JSON.parse(inc.timelineJson); } catch { return []; } })() : [];
                    const typeColor: Record<string, string> = {
                      signal: 'text-violet-400',
                      score_drop: 'text-amber-400',
                      escalation: 'text-rose-400',
                      resolution: 'text-emerald-400',
                    };
                    return (
                      <motion.div
                        key={inc.id}
                        data-testid={`incident-card-${inc.id}`}
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: isActive ? 1 : 0.65, y: 0 }}
                        exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                        transition={{ duration: 0.25, delay: idx * 0.04 }}
                        className={cn(
                          "rounded-xl border space-y-3 overflow-hidden relative",
                          isActive ? cfg.bg : "bg-card border-border",
                          isActive && sev === 'critical' && "noc-glow-red",
                          isActive && sev === 'high'     && "noc-glow-amber",
                        )}
                      >
                        {/* Glass sheen + scanning line overlay */}
                        {isActive && (
                          <>
                            <div className="absolute inset-0 bg-gradient-to-br from-white/[0.025] via-transparent to-transparent pointer-events-none rounded-xl" />
                            <div className="absolute inset-0 overflow-hidden rounded-xl pointer-events-none">
                              <div
                                className={cn("absolute top-0 h-px w-20 opacity-20",
                                  sev === 'critical' ? "bg-rose-300" : "bg-amber-300"
                                )}
                                style={{ animation: `noc-scan ${3.8 + idx * 0.45}s linear infinite` }}
                              />
                            </div>
                          </>
                        )}

                        {/* Pulse bar on active critical/high */}
                        {isActive && (sev === 'critical' || sev === 'high') && (
                          <motion.div
                            className={cn("h-0.5 w-full", sev === 'critical' ? 'bg-rose-500/60' : 'bg-orange-500/50')}
                            animate={{ opacity: [0.4, 1, 0.4] }}
                            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                          />
                        )}

                        <div className="px-5 pt-4 pb-1">
                          <div className="flex items-start gap-3">
                            <Layers className={cn("h-4 w-4 shrink-0 mt-0.5", isActive ? cfg.color : "text-muted-foreground")} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full border bg-muted/30 text-muted-foreground border-border">INCIDENT</span>
                                <span className="font-semibold text-sm">{inc.title}</span>
                                <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-full border", cfg.badge)}>
                                  {inc.severity.toUpperCase()}
                                </span>
                                {isActive
                                  ? <span className="text-[10px] text-rose-400 font-semibold flex items-center gap-0.5"><Activity className="h-2.5 w-2.5" /> Active</span>
                                  : <span className="text-[10px] text-emerald-400 font-semibold flex items-center gap-0.5"><CheckCheck className="h-2.5 w-2.5" /> Resolved</span>
                                }
                              </div>
                              {inc.entity && (
                                <p className="text-xs text-muted-foreground mt-1">
                                  Entity: <span className="font-mono text-foreground/70">{inc.entity}</span>
                                </p>
                              )}
                            </div>
                            <div className="flex flex-col items-end gap-1.5 shrink-0">
                              <span className="text-[10px] text-muted-foreground/60 flex items-center gap-1">
                                <Clock className="h-3 w-3" />{timeLabel}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="px-5">
                          <div className="rounded-lg bg-background/60 border border-border/50 p-3 grid grid-cols-3 gap-3 text-center">
                            <div>
                              <p className="text-[10px] uppercase tracking-widest text-muted-foreground/60 mb-1">Signals</p>
                              <motion.p
                                key={`sig-${inc.id}-${inc.signalsCount}`}
                                initial={{ scale: 1.3, opacity: 0.5 }}
                                animate={{ scale: 1, opacity: 1 }}
                                transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                                className={cn("text-lg font-bold tabular-nums", inc.signalsCount > 0 ? cfg.color : "text-muted-foreground/40")}
                              >{inc.signalsCount}</motion.p>
                            </div>
                            <div>
                              <p className="text-[10px] uppercase tracking-widest text-muted-foreground/60 mb-1">Anomalies</p>
                              <p className={cn("text-lg font-bold tabular-nums", inc.anomaliesCount > 0 ? cfg.color : "text-muted-foreground/40")}>{inc.anomaliesCount}</p>
                            </div>
                            <div>
                              <p className="text-[10px] uppercase tracking-widest text-muted-foreground/60 mb-1">Duration</p>
                              <p className="text-lg font-bold tabular-nums text-muted-foreground">{durationLabel}</p>
                            </div>
                          </div>
                        </div>

                        {/* Expand / collapse toggle */}
                        <div className="px-5 pb-3">
                          <button
                            data-testid={`incident-expand-${inc.id}`}
                            onClick={() => setExpandedIncident(isExpanded ? null : inc.id)}
                            className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                          >
                            {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                            {isExpanded ? 'Hide details' : 'Show narrative & timeline'}
                          </button>
                        </div>

                        <AnimatePresence>
                        {isExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.22 }}
                            className="overflow-hidden border-t border-border/40"
                          >
                            <div className="px-5 py-4 space-y-4">
                              {/* Narrative */}
                              {inc.narrative ? (
                                <div className="space-y-1.5">
                                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 flex items-center gap-1.5">
                                    <Sparkles className="h-3 w-3" /> Narrative
                                  </p>
                                  <p className="text-[12px] text-muted-foreground leading-relaxed">{inc.narrative}</p>
                                </div>
                              ) : (
                                <p className="text-[11px] text-muted-foreground/50 italic">
                                  No narrative yet — run the correlation engine to generate one.
                                </p>
                              )}

                              {/* Root cause timeline */}
                              {timeline.length > 0 && (
                                <div className="space-y-1.5">
                                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 flex items-center gap-1.5">
                                    <GitBranch className="h-3 w-3" /> Root Cause Timeline
                                  </p>
                                  <div className="space-y-1">
                                    {timeline.map((entry, ti) => (
                                      <motion.div
                                        key={ti}
                                        initial={{ opacity: 0, x: -6 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{ delay: ti * 0.04 }}
                                        className="flex items-start gap-2.5"
                                      >
                                        <span className="text-[10px] tabular-nums text-muted-foreground/50 font-mono shrink-0 mt-0.5 w-10">{entry.ts}</span>
                                        <div className="h-1.5 w-1.5 rounded-full bg-border shrink-0 mt-1.5" />
                                        <span className={cn("text-[11px] leading-snug", typeColor[entry.type] ?? 'text-muted-foreground')}>
                                          {entry.event}
                                        </span>
                                      </motion.div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </motion.div>
                        )}
                        </AnimatePresence>
                      </motion.div>
                    );
                  })}
                  </AnimatePresence>
                </div>
              )
            ) : (isLoading || signalsLoading) ? (
              <div className="space-y-3">
                {[1,2].map(i => (
                  <div key={i} className="bg-card border border-border rounded-xl p-5 animate-pulse">
                    <div className="h-4 bg-muted/40 rounded w-2/3 mb-2" />
                    <div className="h-3 bg-muted/30 rounded w-full" />
                  </div>
                ))}
              </div>
            ) : unifiedFeed.length === 0 ? (
              <div className="bg-card border border-border rounded-xl p-12 text-center">
                <CheckCircle2 className="h-10 w-10 text-emerald-400/50 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No events in the last 48 hours</p>
                <p className="text-xs text-muted-foreground/60 mt-1">Network metrics are normal · No execution signals emitted</p>
              </div>
            ) : (
              <div className="space-y-3">
                {unifiedFeed.map(item => {
                  const minAgo = Math.round((Date.now() - item.ts) / 60000);
                  const timeLabel = minAgo < 60 ? `${minAgo}m ago` : `${Math.round(minAgo / 60)}h ago`;

                  if (item.source === 'anomaly') {
                    const a = item.data;
                    const sev = (a.severity in SEVERITY_CONFIG ? a.severity : 'low') as keyof typeof SEVERITY_CONFIG;
                    const cfg = SEVERITY_CONFIG[sev];
                    return (
                      <div
                        key={`anomaly-${a.id}`}
                        data-testid={`anomaly-card-${a.id}`}
                        className={cn("rounded-xl border p-5 space-y-3", a.resolved ? "opacity-60 bg-card border-border" : cfg.bg)}
                      >
                        <div className="flex items-start gap-3">
                          <AlertTriangle className={cn("h-4 w-4 shrink-0 mt-0.5", a.resolved ? "text-muted-foreground" : cfg.color)} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full border bg-muted/30 text-muted-foreground border-border">ANOMALY</span>
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
                              <Clock className="h-3 w-3" />{timeLabel}
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
                  }

                  // ── Execution Signal Card ─────────────────────────────────
                  const s = item.data;
                  const scfg = SIGNAL_TYPE_CONFIG[s.type] ?? SIGNAL_TYPE_CONFIG.ROUTING_FAILURE;
                  const SIcon = scfg.icon;
                  return (
                    <div
                      key={`signal-${s.id}`}
                      data-testid={`signal-card-${s.id}`}
                      className={cn("rounded-xl border p-4", scfg.bg)}
                    >
                      <div className="flex items-start gap-3">
                        <SIcon className={cn("h-4 w-4 shrink-0 mt-0.5", scfg.color)} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full border bg-indigo-500/10 text-indigo-400 border-indigo-500/30">SIGNAL</span>
                            <span className="font-semibold text-sm">{scfg.label}</span>
                            <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-full border", scfg.badge)}>
                              {s.severity.toUpperCase()}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">{s.message}</p>
                          <div className="flex items-center gap-3 mt-2 flex-wrap">
                            {s.entity && (
                              <span className="text-[10px] font-mono text-muted-foreground/60 bg-muted/30 px-1.5 py-0.5 rounded">{s.entity}</span>
                            )}
                            {s.linkedExecId && (
                              <span className="text-[10px] text-muted-foreground/50">approval #{s.linkedExecId}</span>
                            )}
                            {s.value && s.type === 'EXECUTION_LATENCY_HIGH' && (
                              <span className="text-[10px] font-mono text-amber-400/70">{parseInt(s.value).toLocaleString()}ms</span>
                            )}
                          </div>
                        </div>
                        <span className="text-[10px] text-muted-foreground/60 flex items-center gap-1 shrink-0">
                          <Clock className="h-3 w-3" />{timeLabel}
                        </span>
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
                  { label: 'Anomalies',value: rawAnomalies.length,                              color: 'text-foreground' },
                  { label: 'Resolved', value: rawAnomalies.filter(a => a.resolved).length,     color: 'text-emerald-400' },
                ].map(s => (
                  <div key={s.label} className="rounded-lg bg-muted/20 border border-border/40 p-2.5 text-center">
                    <p className={cn("text-xl font-bold", s.color)}>{isLoading ? '—' : s.value}</p>
                    <p className="text-[10px] text-muted-foreground">{s.label}</p>
                  </div>
                ))}
              </div>
              {rawSignals.length > 0 && (
                <div className="rounded-lg bg-indigo-500/5 border border-indigo-500/20 p-2.5 flex items-center justify-between">
                  <span className="text-[10px] text-indigo-400 font-semibold uppercase tracking-widest">Execution Signals</span>
                  <span className="text-sm font-bold text-indigo-400">{rawSignals.length}</span>
                </div>
              )}
            </div>

            {/* ── Routing Suggestions Panel ─────────────────────────────── */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1 rounded bg-amber-500/10 border border-amber-500/20">
                    <Lightbulb className="h-3.5 w-3.5 text-amber-400" />
                  </div>
                  <span className="text-xs font-semibold">Routing Suggestions</span>
                  {pendingSuggestions.length > 0 && (
                    <span className="text-[9px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-full px-1.5 py-0.5 leading-none">
                      {pendingSuggestions.length}
                    </span>
                  )}
                </div>
                <button
                  data-testid="button-generate-suggestions"
                  onClick={() => generateSuggestionsMutation.mutate()}
                  disabled={generateSuggestionsMutation.isPending}
                  className="text-[10px] px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                >
                  <RefreshCw className={cn("h-2.5 w-2.5", generateSuggestionsMutation.isPending && "animate-spin")} />
                  {generateSuggestionsMutation.isPending ? 'Running…' : 'Generate'}
                </button>
              </div>

              <div className="p-3 space-y-2.5">
                {suggestionsLoading ? (
                  <div className="space-y-2">
                    {[1,2].map(i => <div key={i} className="h-12 bg-muted/20 rounded-lg animate-pulse" />)}
                  </div>
                ) : pendingSuggestions.length === 0 ? (
                  <div className="py-4 text-center">
                    <CheckCircle2 className="h-6 w-6 text-emerald-400/40 mx-auto mb-1.5" />
                    <p className="text-[11px] text-muted-foreground/60">No pending suggestions</p>
                    <p className="text-[10px] text-muted-foreground/40 mt-0.5">
                      Run the engine to analyse carrier scores
                    </p>
                  </div>
                ) : (
                  <AnimatePresence>
                  {pendingSuggestions.map((s, i) => {
                    const conf = Math.round(s.confidence * 100);
                    const confColor = conf >= 85 ? 'text-rose-400' : conf >= 70 ? 'text-amber-400' : 'text-blue-400';
                    return (
                      <motion.div
                        key={s.id}
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, x: 20, height: 0 }}
                        transition={{ duration: 0.2, delay: i * 0.05 }}
                        data-testid={`suggestion-card-${s.id}`}
                        className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 space-y-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] font-semibold leading-snug">{s.suggestedAction}</p>
                            <p className="text-[10px] text-muted-foreground mt-1 leading-snug">{s.reason}</p>
                          </div>
                          <span className={cn("text-[10px] font-bold tabular-nums shrink-0", confColor)}>
                            {conf}%
                          </span>
                        </div>
                        {s.currentScore != null && (
                          <div className="flex items-center gap-1.5">
                            <span className="text-[9px] text-muted-foreground/50 uppercase tracking-widest">Score</span>
                            <div className="flex-1 h-1 rounded-full bg-muted/30 overflow-hidden">
                              <motion.div
                                className={cn("h-full rounded-full", s.currentScore < 35 ? 'bg-rose-500' : s.currentScore < 55 ? 'bg-amber-500' : 'bg-blue-500')}
                                initial={{ width: 0 }}
                                animate={{ width: `${s.currentScore}%` }}
                                transition={{ duration: 0.6, ease: 'easeOut' }}
                              />
                            </div>
                            <span className="text-[9px] tabular-nums text-muted-foreground/60">{s.currentScore.toFixed(0)}</span>
                          </div>
                        )}
                        <div className="flex gap-1.5 pt-0.5">
                          <button
                            data-testid={`suggestion-approve-${s.id}`}
                            onClick={() => suggestionActionMutation.mutate({ id: s.id, action: 'approve' })}
                            disabled={suggestionActionMutation.isPending}
                            className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                          >
                            <ThumbsUp className="h-2.5 w-2.5" /> Approve
                          </button>
                          <button
                            data-testid={`suggestion-reject-${s.id}`}
                            onClick={() => suggestionActionMutation.mutate({ id: s.id, action: 'reject' })}
                            disabled={suggestionActionMutation.isPending}
                            className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <ThumbsDown className="h-2.5 w-2.5" /> Reject
                          </button>
                          <button
                            data-testid={`suggestion-snooze-${s.id}`}
                            onClick={() => suggestionActionMutation.mutate({ id: s.id, action: 'snooze' })}
                            disabled={suggestionActionMutation.isPending}
                            className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <BellOff className="h-2.5 w-2.5" /> Snooze
                          </button>
                        </div>
                      </motion.div>
                    );
                  })}
                  </AnimatePresence>
                )}

                {suggestions.filter(s => s.status !== 'pending').length > 0 && (
                  <div className="pt-1 border-t border-border/40">
                    <p className="text-[10px] text-muted-foreground/40 uppercase tracking-widest mb-1.5">Resolved</p>
                    {suggestions.filter(s => s.status !== 'pending').slice(0, 3).map(s => (
                      <div key={s.id} className="flex items-center gap-2 py-1">
                        <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded-full border",
                          s.status === 'approved' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' :
                          s.status === 'rejected' ? 'bg-muted/20 text-muted-foreground border-border' :
                          'bg-amber-500/10 text-amber-400 border-amber-500/30'
                        )}>{s.status}</span>
                        <span className="text-[10px] text-muted-foreground/60 truncate">{s.suggestedAction}</span>
                      </div>
                    ))}
                  </div>
                )}
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
