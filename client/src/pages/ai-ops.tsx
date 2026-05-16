import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bot, AlertTriangle, CheckCircle2, TrendingDown, Zap, Search, RefreshCw, Info, ArrowRight, Brain, Lightbulb, Activity, Clock, Play, TrendingUp, BarChart3, CheckCheck, Layers, XCircle, ChevronDown, ChevronUp, ThumbsUp, ThumbsDown, BellOff, Sparkles, GitBranch, Volume2, VolumeX, MessageCircle, ShieldCheck, X, Loader2 } from "lucide-react";
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

type FeedTab = 'all' | 'anomalies' | 'signals' | 'incidents' | 'accounts' | 'actions';

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

// ─── MiniSparkline ────────────────────────────────────────────────────────────
function MiniSparkline({ values, color = '#6b7280', width = 52, height = 14 }: {
  values: number[]; color?: string; width?: number; height?: number;
}) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - ((v - min) / range) * height * 0.85 - height * 0.075;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg width={width} height={height} className="flex-shrink-0 overflow-visible">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity={0.75} />
    </svg>
  );
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

  // ── Account-level CDR anomalies (absorbed from Reports) ───────────────────
  interface AccountAnomalyRow {
    account: string; metric: string; label: string;
    baseline: number; observed: number; sigma: number;
    severity: string; direction: string;
  }
  const { data: accountAnomalyData, isLoading: accountAnomalyLoading, refetch: refetchAccountAnomalies } = useQuery<{
    anomalies: AccountAnomalyRow[]; accountsAnalysed: number; baselineAccounts: number; windowHours: number;
  }>({
    queryKey: ['/api/cdr-anomalies'],
    enabled: feedTab === 'accounts',
    staleTime: 120_000,
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

  // Account health state
  interface AcctState { accountId: string; accountName: string | null; state: string; healthScore: number; reasons: string[] | null; activeIncidentCount: number; trendDirection?: string | null; scoreDelta24h?: number | null; updatedAt?: string | null; authExposureScore?: number | null; exposureRiskLevel?: string | null; }
  const { data: acctStateList } = useQuery<AcctState[]>({
    queryKey: ['/api/account-state'],
    staleTime: 60_000,
  });
  const criticalAccounts = (acctStateList ?? []).filter(a => a.state !== 'healthy').sort((a, b) => a.healthScore - b.healthScore).slice(0, 5);

  // Account state history for sparklines
  const { data: stateHistory = {} } = useQuery<Record<string, { healthScore: number; state: string; snapshotAt: string }[]>>({
    queryKey: ['/api/account-state/history'],
    staleTime: 180_000,
    refetchInterval: 600_000,
  });

  // Normalized incident engine output (account health + FAS spike incidents)
  interface NormalizedIncident {
    id: number; entityType: string; entityId: string; entityName: string | null;
    incidentType: string; severity: string; confidence: number;
    title: string; summary: string | null; reasons: string[]; suggestedAction: string | null;
    status: string; source: string; openedAt: string; updatedAt: string; resolvedAt: string | null;
  }
  const { data: normalizedIncidents = [], isLoading: normIncLoading } = useQuery<NormalizedIncident[]>({
    queryKey: ['/api/incidents'],
    refetchInterval: 60_000,
    staleTime: 30_000,
    enabled: feedTab === 'incidents',
  });
  const activeNormIncidents = normalizedIncidents.filter(i => i.status === 'active');

  const runIncidentsMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/incidents/run'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/incidents'] });
      toast({ title: 'Incident engine run complete' });
    },
    onError: () => toast({ title: 'Incident engine error', variant: 'destructive' }),
  });

  // ── C1 Recommendations ────────────────────────────────────────────────────
  interface Recommendation {
    accountId: string; accountName: string | null;
    riskScore: number; priority: number;
    urgency: 'immediate' | 'today' | 'monitor';
    dominantSignal: 'exposure' | 'fraud' | 'health' | 'anomaly';
    primaryAction: string; actionReason: string[]; confidence: number;
    signalSummary: { healthScore: number; fraudRisk: number; authExposureScore: number; anomalyScore: number; activeIncidents: number };
    computedAt: string;
  }
  interface AccountAction {
    id: number; account_id: string; account_name: string | null;
    action_type: string; status: string; execution_mode: string;
    primary_action: string | null;
    sippy_params: Record<string, unknown> | null;
    sippy_result: Record<string, unknown> | null;
    requested_by_name: string | null; approved_by_name: string | null;
    rejected_by: string | null; rejection_reason: string | null;
    snoozed_until: string | null;
    audit_trail: Array<{ timestamp: string; event: string; userId?: string; userName?: string; details?: string }> | null;
    created_at: string; updated_at: string;
  }

  // ── C2 Action Ledger state ─────────────────────────────────────────────────
  const [actionModal, setActionModal] = useState<{ rec: Recommendation; intent: 'approve' | 'reject' | 'snooze' } | null>(null);
  const [rejectReason, setRejectReason]  = useState('');
  const [snoozeHours,  setSnoozeHours]   = useState(24);

  const { data: recommendations = [], isLoading: recsLoading, refetch: refetchRecs } = useQuery<Recommendation[]>({
    queryKey: ['/api/recommendations'],
    refetchInterval: 120_000,
    staleTime: 60_000,
    enabled: feedTab === 'actions',
  });
  const { data: existingActions = [] } = useQuery<AccountAction[]>({
    queryKey: ['/api/actions'],
    refetchInterval: 30_000,
    enabled: feedTab === 'actions',
  });
  // Index actions by accountId — most recent pending/approved per account
  const actionByAccountId = existingActions.reduce<Record<string, AccountAction>>((acc, a) => {
    if (!acc[a.account_id] || new Date(a.created_at) > new Date(acc[a.account_id].created_at)) {
      acc[a.account_id] = a;
    }
    return acc;
  }, {});

  const runRecsMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/recommendations/run'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/recommendations'] });
      toast({ title: 'Recommendation engine run complete' });
    },
    onError: () => toast({ title: 'Recommendation engine error', variant: 'destructive' }),
  });
  const runAllEnginesMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/engine/run-all'),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['/api/recommendations'] });
      qc.invalidateQueries({ queryKey: ['/api/actions'] });
      const ok    = data?.steps?.filter((s: any) => s.status === 'success').length ?? 0;
      const total = data?.steps?.length ?? 0;
      toast({ title: `Full pipeline run: ${ok}/${total} engines succeeded`, description: data?.runId });
    },
    onError: () => toast({ title: 'Engine run error', variant: 'destructive' }),
  });

  // Create action then take the intended action (approve / reject / snooze)
  const commitActionMutation = useMutation({
    mutationFn: async ({ rec, intent, reason, hours }: { rec: Recommendation; intent: 'approve' | 'reject' | 'snooze'; reason: string; hours: number }) => {
      // 1. Create the action record
      const action: AccountAction = await apiRequest('POST', '/api/actions', {
        accountId:         rec.accountId,
        accountName:       rec.accountName ?? rec.accountId,
        dominantSignal:    rec.dominantSignal,
        primaryAction:     rec.primaryAction,
        recommendationRef: { priority: rec.priority, riskScore: rec.riskScore, urgency: rec.urgency, dominantSignal: rec.dominantSignal, computedAt: rec.computedAt },
      });
      // 2. Take the action
      if (intent === 'approve') return apiRequest('POST', `/api/actions/${action.id}/approve`);
      if (intent === 'reject')  return apiRequest('POST', `/api/actions/${action.id}/reject`,  { reason });
      if (intent === 'snooze')  return apiRequest('POST', `/api/actions/${action.id}/snooze`,  { hours });
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['/api/actions'] });
      const label = vars.intent === 'approve' ? 'Approved (dry-run)' : vars.intent === 'reject' ? 'Rejected' : `Snoozed ${vars.hours}h`;
      toast({ title: `${label}: ${vars.rec.accountName ?? vars.rec.accountId}` });
      setActionModal(null);
      setRejectReason('');
    },
    onError: (e: any) => toast({ title: 'Action failed', description: e.message, variant: 'destructive' }),
  });
  const immediateRecs = recommendations.filter(r => r.urgency === 'immediate');
  const todayRecs     = recommendations.filter(r => r.urgency === 'today');
  const monitorRecs   = recommendations.filter(r => r.urgency === 'monitor');

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

  // ── NLQ — backed by /api/nlq CDR-cache pattern engine ────────────────────
  interface NlqResult {
    query: string;
    windowLabel: string;
    cdrsAnalyzed: number;
    answer: string;
    headers: string[];
    rows: Array<Record<string, string | number>>;
    updatedAt: string | null;
  }
  const [nlqResult, setNlqResult] = useState<NlqResult | null>(null);

  async function handleQuery(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setQuerying(true);
    setQueryResult(null);
    setNlqResult(null);
    try {
      const res = await fetch('/api/nlq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }));
        setQueryResult(`Error: ${err.error ?? 'Unknown error'}`);
      } else {
        const data: NlqResult = await res.json();
        setNlqResult(data);
        setQueryResult(data.answer);
      }
    } catch (err: any) {
      setQueryResult(`Error: ${err.message}`);
    } finally {
      setQuerying(false);
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  const { enabled: audioEnabled, toggle: toggleAudio, play: playAlert } = useAudioAlerts();
  const [copilotOpen, setCopilotOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <AiCopilot open={copilotOpen} onClose={() => setCopilotOpen(false)} />

      {/* ── C2 Action Confirmation Modal ─────────────────────────────────── */}
      <AnimatePresence>
        {actionModal && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm px-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl"
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              {/* Modal header */}
              <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-border/50">
                <div className="flex items-center gap-2">
                  {actionModal.intent === 'approve' && <ShieldCheck className="h-4 w-4 text-emerald-400" />}
                  {actionModal.intent === 'reject'  && <ThumbsDown className="h-4 w-4 text-muted-foreground" />}
                  {actionModal.intent === 'snooze'  && <BellOff className="h-4 w-4 text-violet-400" />}
                  <span className="text-sm font-semibold capitalize">{actionModal.intent} action</span>
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-amber-500/10 text-amber-400 border-amber-500/30 leading-none">DRY RUN</span>
                </div>
                <button onClick={() => setActionModal(null)} className="text-muted-foreground hover:text-foreground transition-colors">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Modal body */}
              <div className="px-5 py-4 space-y-4">
                {/* Account + risk */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold">{actionModal.rec.accountName ?? actionModal.rec.accountId}</p>
                    <p className="text-[10px] text-muted-foreground">Account ID: {actionModal.rec.accountId}</p>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-mono font-bold text-muted-foreground">Risk {actionModal.rec.riskScore}</div>
                    <div className="text-[9px] text-muted-foreground/60 capitalize">{actionModal.rec.urgency}</div>
                  </div>
                </div>

                {/* Primary action */}
                <div className="bg-muted/20 rounded-lg p-3 border border-border/40">
                  <p className="text-[10px] text-muted-foreground/70 uppercase tracking-widest mb-1">Recommended action</p>
                  <p className="text-xs leading-snug">{actionModal.rec.primaryAction}</p>
                </div>

                {/* What would be sent to Sippy */}
                {actionModal.intent === 'approve' && (
                  <div className="space-y-1.5">
                    <p className="text-[10px] text-muted-foreground/70 uppercase tracking-widest">Sippy call (dry-run — not sent)</p>
                    <div className="bg-muted/30 rounded-lg p-3 border border-border/30 font-mono text-[10px] leading-relaxed text-muted-foreground space-y-1">
                      {(() => {
                        const sig    = actionModal.rec.dominantSignal;
                        const typeMap: Record<string, string> = { fraud: 'RATE_LIMIT', exposure: 'EXPOSURE_RESTRICT', health: 'ROUTE_BLOCK', anomaly: 'ACCOUNT_FREEZE' };
                        const paramsMap: Record<string, string> = {
                          fraud:    `{ i_account: ${actionModal.rec.accountId}, max_calls: 10, max_cps: "0.5" }`,
                          exposure: `{ i_account: ${actionModal.rec.accountId}, ip_auth_enabled: 1 }`,
                          health:   `{ i_account: ${actionModal.rec.accountId}, routing_plan_id: null }`,
                          anomaly:  `{ i_account: ${actionModal.rec.accountId}, blocked: 1 }`,
                        };
                        return (
                          <>
                            <div><span className="text-muted-foreground/50">method:</span>  updateAccount</div>
                            <div><span className="text-muted-foreground/50">type:</span>    {typeMap[sig] ?? 'MANUAL'}</div>
                            <div><span className="text-muted-foreground/50">params:</span>  {paramsMap[sig] ?? '{ note: "manual review" }'}</div>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                )}

                {/* Reject reason input */}
                {actionModal.intent === 'reject' && (
                  <div className="space-y-1.5">
                    <label className="text-[10px] text-muted-foreground/70 uppercase tracking-widest">Reason (optional)</label>
                    <Input
                      data-testid="input-reject-reason"
                      value={rejectReason}
                      onChange={e => setRejectReason(e.target.value)}
                      placeholder="e.g. False positive — reviewed manually"
                      className="text-xs h-8"
                    />
                  </div>
                )}

                {/* Snooze hours input */}
                {actionModal.intent === 'snooze' && (
                  <div className="space-y-1.5">
                    <label className="text-[10px] text-muted-foreground/70 uppercase tracking-widest">Snooze duration (hours)</label>
                    <div className="flex gap-1.5">
                      {[4, 8, 24, 48].map(h => (
                        <button key={h}
                          onClick={() => setSnoozeHours(h)}
                          className={cn("text-[10px] px-2.5 py-1.5 rounded-lg border transition-colors",
                            snoozeHours === h
                              ? 'border-primary/40 bg-primary/10 text-primary'
                              : 'border-border text-muted-foreground hover:text-foreground'
                          )}
                        >{h}h</button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Modal footer */}
              <div className="flex items-center justify-end gap-2 px-5 pb-5">
                <button
                  onClick={() => setActionModal(null)}
                  className="text-xs px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
                <button
                  data-testid={`modal-confirm-${actionModal.intent}`}
                  disabled={commitActionMutation.isPending}
                  onClick={() => commitActionMutation.mutate({ rec: actionModal.rec, intent: actionModal.intent, reason: rejectReason, hours: snoozeHours })}
                  className={cn(
                    "flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-50",
                    actionModal.intent === 'approve' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20' :
                    actionModal.intent === 'reject'  ? 'border-border text-muted-foreground hover:text-foreground' :
                    'border-violet-500/30 bg-violet-500/10 text-violet-400 hover:bg-violet-500/20'
                  )}
                >
                  {commitActionMutation.isPending
                    ? <><Loader2 className="h-3 w-3 animate-spin" /> Processing…</>
                    : actionModal.intent === 'approve' ? <><ShieldCheck className="h-3 w-3" /> Confirm approval</>
                    : actionModal.intent === 'reject'  ? <><ThumbsDown className="h-3 w-3" /> Confirm rejection</>
                    : <><BellOff className="h-3 w-3" /> Snooze {snoozeHours}h</>
                  }
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
                  { key: 'incidents', label: 'Incidents', count: incidents.length + normalizedIncidents.length, active: activeIncidents.length + activeNormIncidents.length },
                  { key: 'accounts', label: 'Accounts',  count: accountAnomalyData?.anomalies.length ?? 0 },
                  { key: 'actions',  label: 'Actions',   count: recommendations.length, active: immediateRecs.length },
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
              ) : incidents.length === 0 && normalizedIncidents.length === 0 ? (
                <div className="bg-card border border-border rounded-xl p-12 text-center">
                  <CheckCircle2 className="h-10 w-10 text-emerald-400/50 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">No incidents detected</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">
                    The incident engine normalizes account health + fraud signals into incidents.
                    Run it manually or wait for the next cycle.
                  </p>
                  <div className="flex items-center gap-2 justify-center mt-4">
                    <button
                      onClick={() => runIncidentsMutation.mutate()}
                      disabled={runIncidentsMutation.isPending}
                      data-testid="button-run-incidents"
                      className="text-xs px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors flex items-center gap-1.5"
                    >
                      <Play className="h-3 w-3" />
                      {runIncidentsMutation.isPending ? 'Running…' : 'Run entities'}
                    </button>
                    <button
                      onClick={() => runCorrelationMutation.mutate()}
                      disabled={runCorrelationMutation.isPending}
                      data-testid="button-run-correlation"
                      className="text-xs px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors flex items-center gap-1.5"
                    >
                      <Play className="h-3 w-3" />
                      {runCorrelationMutation.isPending ? 'Running…' : 'Run correlation'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* ── Entity incidents (account health + FAS spike) ─────── */}
                  {normalizedIncidents.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider">Entity Incidents</span>
                        {activeNormIncidents.length > 0 && (
                          <span className="text-[9px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded-full px-1.5 py-0.5 leading-none">{activeNormIncidents.length}</span>
                        )}
                        <button
                          onClick={() => runIncidentsMutation.mutate()}
                          disabled={runIncidentsMutation.isPending}
                          data-testid="button-run-incidents-refresh"
                          className="ml-auto text-[10px] px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                        >
                          <RefreshCw className={cn("h-2.5 w-2.5", runIncidentsMutation.isPending && "animate-spin")} />
                          {runIncidentsMutation.isPending ? 'Running…' : 'Refresh'}
                        </button>
                      </div>
                      {normalizedIncidents.map(inc => {
                        const sev = (inc.severity in SEVERITY_CONFIG ? inc.severity : 'medium') as keyof typeof SEVERITY_CONFIG;
                        const cfg = SEVERITY_CONFIG[sev];
                        const isActive = inc.status === 'active';
                        const updatedMs = new Date(inc.updatedAt).getTime();
                        const minAgo = Math.round((Date.now() - updatedMs) / 60000);
                        const timeLabel = minAgo < 1 ? 'just now' : minAgo < 60 ? `${minAgo}m ago` : `${Math.round(minAgo / 60)}h ago`;
                        const incTypeLabel = inc.incidentType === 'ACCOUNT_HEALTH' ? 'Account Health'
                          : inc.incidentType === 'FAS_SPIKE' ? 'FAS Spike'
                          : inc.incidentType;
                        const sourceLabel = inc.source === 'account_state' ? 'State Engine'
                          : inc.source === 'fas_engine' ? 'Fraud Engine'
                          : inc.source;
                        return (
                          <div
                            key={inc.id}
                            className={cn("rounded-xl border p-4 transition-opacity", cfg.bg, !isActive && "opacity-50")}
                            data-testid={`incident-entity-${inc.id}`}
                          >
                            <div className="flex items-start justify-between gap-2 mb-1.5">
                              <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                                <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded border leading-none", cfg.badge)}>{cfg.label}</span>
                                <span className="text-[10px] text-muted-foreground/60 border border-border rounded px-1.5 py-0.5 leading-none">{incTypeLabel}</span>
                                <span className="text-[10px] text-muted-foreground/40 border border-border/40 rounded px-1.5 py-0.5 leading-none">{sourceLabel}</span>
                                {!isActive && <span className="text-[10px] text-emerald-400 border border-emerald-500/30 bg-emerald-500/10 rounded px-1.5 py-0.5 leading-none">Resolved</span>}
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span className="text-[9px] tabular-nums text-muted-foreground/40">{timeLabel}</span>
                                <span className="text-[10px] font-mono text-muted-foreground/40">{inc.confidence}%</span>
                              </div>
                            </div>
                            <p className="text-xs font-medium leading-snug">{inc.title}</p>
                            {inc.summary && <p className="text-[10px] text-muted-foreground/70 leading-snug mt-0.5">{inc.summary}</p>}
                            {inc.suggestedAction && isActive && (
                              <div className="mt-2 pt-2 border-t border-border/30">
                                <p className="text-[10px] text-muted-foreground/60 italic">
                                  <span className="font-semibold not-italic text-muted-foreground/70">Action: </span>{inc.suggestedAction}
                                </p>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {incidents.length > 0 && (
                        <div className="border-t border-border/30 pt-2">
                          <span className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider">Correlation Incidents</span>
                        </div>
                      )}
                    </div>
                  )}
                  {/* ── Correlation engine incidents ─────────────────────── */}
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
            ) : feedTab === 'actions' ? (
              // ── C1 Actions Panel — ranked operator queue ─────────────────────
              <div className="space-y-4">
                {/* Header bar */}
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Brain className="h-3.5 w-3.5 text-primary/70" />
                    {recsLoading
                      ? 'Computing ranked action queue…'
                      : recommendations.length === 0
                        ? 'No recommendations yet — run the engine to generate the queue'
                        : `${recommendations.length} accounts ranked · ${immediateRecs.length} immediate · ${todayRecs.length} today · ${monitorRecs.length} monitoring`
                    }
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => refetchRecs()}
                      disabled={recsLoading}
                      data-testid="button-refresh-recommendations"
                      className="flex items-center gap-1.5 text-[10px] px-2.5 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                    >
                      <RefreshCw className={cn("h-3 w-3", recsLoading && "animate-spin")} />
                      Refresh
                    </button>
                    <button
                      onClick={() => runRecsMutation.mutate()}
                      disabled={runRecsMutation.isPending}
                      data-testid="button-run-recommendations"
                      className="flex items-center gap-1.5 text-[10px] px-2.5 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                    >
                      <Play className="h-3 w-3" />
                      {runRecsMutation.isPending ? 'Running…' : 'Rankings'}
                    </button>
                    <button
                      onClick={() => runAllEnginesMutation.mutate()}
                      disabled={runAllEnginesMutation.isPending}
                      data-testid="button-run-all-engines"
                      className="flex items-center gap-1.5 text-[10px] px-2.5 py-1.5 rounded-lg border border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
                    >
                      {runAllEnginesMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                      {runAllEnginesMutation.isPending ? 'Running pipeline…' : 'Run full pipeline'}
                    </button>
                  </div>
                </div>

                {recsLoading ? (
                  <div className="space-y-2">
                    {[1,2,3].map(i => (
                      <div key={i} className="bg-card border border-border rounded-xl p-4 animate-pulse">
                        <div className="h-3 bg-muted/40 rounded w-1/3 mb-2" />
                        <div className="h-3 bg-muted/30 rounded w-full mb-1" />
                        <div className="h-3 bg-muted/20 rounded w-2/3" />
                      </div>
                    ))}
                  </div>
                ) : recommendations.length === 0 ? (
                  <div className="bg-card border border-border rounded-xl p-12 text-center">
                    <Brain className="h-10 w-10 text-primary/30 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">No ranked actions yet</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">
                      The recommendation engine ranks accounts by composite risk score.<br />
                      It runs automatically every 30 minutes, or trigger it manually.
                    </p>
                    <button
                      onClick={() => runRecsMutation.mutate()}
                      disabled={runRecsMutation.isPending}
                      data-testid="button-run-recommendations-empty"
                      className="mt-4 text-xs px-3 py-1.5 rounded-lg border border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 transition-colors flex items-center gap-1.5 mx-auto"
                    >
                      <Play className="h-3 w-3" />
                      {runRecsMutation.isPending ? 'Running…' : 'Generate action queue'}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-5">
                    {/* Summary pills */}
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { label: 'Immediate', count: immediateRecs.length, bg: 'bg-rose-500/5 border-rose-500/20', text: 'text-rose-400' },
                        { label: 'Today',     count: todayRecs.length,     bg: 'bg-amber-500/5 border-amber-500/20', text: 'text-amber-400' },
                        { label: 'Monitor',   count: monitorRecs.length,   bg: 'bg-muted/20 border-border',          text: 'text-muted-foreground' },
                      ].map(g => (
                        <div key={g.label} className={cn("rounded-xl border p-4", g.bg)}>
                          <div className={cn("text-3xl font-bold font-mono", g.text)}>{g.count}</div>
                          <div className="text-xs text-muted-foreground mt-1">{g.label}</div>
                        </div>
                      ))}
                    </div>

                    {/* Ranked queue grouped by urgency */}
                    {([
                      { urgency: 'immediate', items: immediateRecs, label: 'Immediate', dotColor: 'bg-rose-400',  ringColor: 'border-rose-500/20', badgeCls: 'bg-rose-500/15 text-rose-400 border-rose-500/30'   },
                      { urgency: 'today',     items: todayRecs,     label: 'Today',     dotColor: 'bg-amber-400', ringColor: 'border-amber-500/20', badgeCls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
                      { urgency: 'monitor',   items: monitorRecs,   label: 'Monitor',   dotColor: 'bg-muted-foreground/40', ringColor: 'border-border', badgeCls: 'bg-muted/20 text-muted-foreground border-border' },
                    ] as const).map(group => group.items.length === 0 ? null : (
                      <div key={group.urgency} className="space-y-2">
                        <div className="flex items-center gap-2">
                          <span className={cn("w-1.5 h-1.5 rounded-full", group.dotColor)} />
                          <span className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider">{group.label}</span>
                          <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded-full border leading-none", group.badgeCls)}>{group.items.length}</span>
                        </div>
                        <div className="space-y-2">
                          {group.items.map(rec => {
                            const signalCfg = {
                              exposure: { label: 'Auth Exposure', cls: 'bg-orange-500/15 text-orange-400 border-orange-500/30' },
                              fraud:    { label: 'Fraud Risk',    cls: 'bg-rose-500/15 text-rose-400 border-rose-500/30'       },
                              health:   { label: 'Health',        cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30'    },
                              anomaly:  { label: 'Anomaly',       cls: 'bg-violet-500/15 text-violet-400 border-violet-500/30' },
                            }[rec.dominantSignal];
                            return (
                              <div
                                key={rec.accountId}
                                className="bg-card border border-border rounded-xl p-4 space-y-3"
                                data-testid={`rec-card-${rec.accountId}`}
                              >
                                {/* Row 1: rank + name + risk score */}
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className="text-[10px] font-mono font-bold text-muted-foreground/50 shrink-0">#{rec.priority}</span>
                                    <span className="text-xs font-semibold truncate">{rec.accountName ?? rec.accountId}</span>
                                    <span className={cn("text-[9px] font-semibold px-1.5 py-0.5 rounded border leading-none shrink-0", signalCfg.cls)}>{signalCfg.label}</span>
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0">
                                    <div className="flex items-center gap-1">
                                      <div className="w-16 h-1.5 rounded-full bg-muted/40 overflow-hidden">
                                        <div
                                          className={cn("h-full rounded-full transition-all duration-700",
                                            rec.riskScore >= 70 ? 'bg-rose-400' : rec.riskScore >= 40 ? 'bg-amber-400' : 'bg-muted-foreground/40'
                                          )}
                                          style={{ width: `${rec.riskScore}%` }}
                                        />
                                      </div>
                                      <span className="text-[10px] font-mono font-bold tabular-nums text-muted-foreground">{rec.riskScore}</span>
                                    </div>
                                    <span className="text-[9px] text-muted-foreground/40 tabular-nums">{rec.confidence}% conf</span>
                                  </div>
                                </div>

                                {/* Row 2: primary action */}
                                <div className="flex items-start gap-2">
                                  <ArrowRight className="h-3 w-3 text-primary/60 mt-0.5 shrink-0" />
                                  <p className="text-xs leading-snug text-foreground/80">{rec.primaryAction}</p>
                                </div>

                                {/* Row 3: reasons */}
                                {rec.actionReason.length > 0 && (
                                  <div className="flex flex-wrap gap-1">
                                    {rec.actionReason.map((r, i) => (
                                      <span key={i} className="text-[9px] text-muted-foreground/60 bg-muted/20 border border-border/40 px-1.5 py-0.5 rounded">{r}</span>
                                    ))}
                                  </div>
                                )}

                                {/* Row 4: signal summary chips */}
                                <div className="flex flex-wrap gap-2 pt-1 border-t border-border/20">
                                  {[
                                    { label: 'Health',   value: rec.signalSummary.healthScore,       suffix: '' },
                                    { label: 'Fraud',    value: rec.signalSummary.fraudRisk,          suffix: '' },
                                    { label: 'Exposure', value: rec.signalSummary.authExposureScore,  suffix: '' },
                                    { label: 'Anomaly',  value: rec.signalSummary.anomalyScore,       suffix: '' },
                                    { label: 'Incidents',value: rec.signalSummary.activeIncidents,    suffix: '' },
                                  ].map(chip => (
                                    <span key={chip.label} className="text-[9px] text-muted-foreground/50 tabular-nums">
                                      <span className="text-muted-foreground/70 font-medium">{chip.label}:</span> {chip.value}{chip.suffix}
                                    </span>
                                  ))}
                                </div>

                                {/* Row 5: C2 action controls */}
                                {(() => {
                                  const existing = actionByAccountId[rec.accountId];
                                  const statusCfg: Record<string, { cls: string; label: string }> = {
                                    pending:      { cls: 'bg-amber-500/10 text-amber-400 border-amber-500/30',   label: 'Pending' },
                                    approved:     { cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30', label: 'Approved (dry-run)' },
                                    executed:     { cls: 'bg-blue-500/10 text-blue-400 border-blue-500/30',      label: 'Executed' },
                                    rejected:     { cls: 'bg-muted/20 text-muted-foreground border-border',      label: 'Rejected' },
                                    snoozed:      { cls: 'bg-violet-500/10 text-violet-400 border-violet-500/30', label: 'Snoozed' },
                                    rolled_back:  { cls: 'bg-muted/20 text-muted-foreground border-border',      label: 'Rolled back' },
                                  };
                                  const sc = existing ? statusCfg[existing.status] : null;
                                  const isActed = existing && !['pending','snoozed'].includes(existing.status);
                                  return (
                                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/20">
                                      {sc ? (
                                        <span className={cn("text-[9px] font-semibold px-1.5 py-0.5 rounded border leading-none", sc.cls)}>
                                          {sc.label}
                                        </span>
                                      ) : (
                                        <span className="text-[9px] text-muted-foreground/30">No action taken</span>
                                      )}
                                      {!isActed && (
                                        <div className="flex items-center gap-1.5">
                                          <button
                                            data-testid={`rec-approve-${rec.accountId}`}
                                            onClick={() => setActionModal({ rec, intent: 'approve' })}
                                            className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                                          >
                                            <ThumbsUp className="h-2.5 w-2.5" /> Approve
                                          </button>
                                          <button
                                            data-testid={`rec-reject-${rec.accountId}`}
                                            onClick={() => setActionModal({ rec, intent: 'reject' })}
                                            className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground transition-colors"
                                          >
                                            <ThumbsDown className="h-2.5 w-2.5" /> Reject
                                          </button>
                                          <button
                                            data-testid={`rec-snooze-${rec.accountId}`}
                                            onClick={() => setActionModal({ rec, intent: 'snooze' })}
                                            className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground transition-colors"
                                          >
                                            <BellOff className="h-2.5 w-2.5" /> Snooze
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })()}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : feedTab === 'accounts' ? (
              // ── Account-level CDR Anomalies Tab ─────────────────────────────
              <div className="space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                    {accountAnomalyLoading
                      ? 'Analysing account CDR data…'
                      : `Statistical σ-deviation · ${accountAnomalyData?.windowHours ?? 72}h window · ${accountAnomalyData?.accountsAnalysed ?? 0} accounts analysed · ${accountAnomalyData?.baselineAccounts ?? 0} with baseline`
                    }
                  </div>
                  <button
                    onClick={() => refetchAccountAnomalies()}
                    disabled={accountAnomalyLoading}
                    data-testid="button-refresh-account-anomalies"
                    className="flex items-center gap-1.5 text-[10px] px-2.5 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className={cn("h-3 w-3", accountAnomalyLoading && "animate-spin")} />
                    Re-run
                  </button>
                </div>

                {accountAnomalyLoading ? (
                  <div className="space-y-2">
                    {[1,2,3].map(i => (
                      <div key={i} className="bg-card border border-border rounded-xl p-4 animate-pulse">
                        <div className="h-3 bg-muted/40 rounded w-1/2 mb-2" />
                        <div className="h-3 bg-muted/30 rounded w-full" />
                      </div>
                    ))}
                  </div>
                ) : !accountAnomalyData || accountAnomalyData.anomalies.length === 0 ? (
                  <div className="bg-card border border-border rounded-xl p-12 text-center">
                    <CheckCircle2 className="h-10 w-10 text-emerald-400/50 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">No account-level anomalies detected</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">
                      {accountAnomalyData?.accountsAnalysed === 0
                        ? 'No CDR data in cache. Ensure Sippy is connected and CDRs are flowing.'
                        : 'All account metrics are within normal statistical ranges.'}
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-3 gap-3">
                      {(['critical','high','medium'] as const).map(sev => {
                        const count = accountAnomalyData.anomalies.filter(a => a.severity === sev).length;
                        const cfg = SEVERITY_CONFIG[sev];
                        return (
                          <div key={sev} className={cn("rounded-xl border p-4", cfg.bg)}>
                            <div className={cn("text-3xl font-bold font-mono", cfg.color)}>{count}</div>
                            <div className="text-xs text-muted-foreground mt-1 capitalize">{sev} severity</div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="rounded-xl border border-border/50 bg-card/60 overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead className="border-b border-border/50 bg-muted/20">
                            <tr>
                              <th className="px-4 py-3 text-left text-muted-foreground font-medium">Severity</th>
                              <th className="px-4 py-3 text-left text-muted-foreground font-medium">Account</th>
                              <th className="px-4 py-3 text-left text-muted-foreground font-medium">Metric</th>
                              <th className="px-4 py-3 text-right text-muted-foreground font-medium">Baseline</th>
                              <th className="px-4 py-3 text-right text-muted-foreground font-medium">Observed</th>
                              <th className="px-4 py-3 text-right text-muted-foreground font-medium">Deviation (σ)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {accountAnomalyData.anomalies.map((row, i) => {
                              const cfg = SEVERITY_CONFIG[(row.severity in SEVERITY_CONFIG ? row.severity : 'medium') as keyof typeof SEVERITY_CONFIG];
                              const fmtVal = (metric: string, val: number) => {
                                if (metric === 'avg_duration')  return `${val.toFixed(0)}s`;
                                if (metric === 'cost_per_min')  return `$${val.toFixed(4)}/min`;
                                if (metric === 'dest_entropy')  return val.toFixed(3);
                                return val.toFixed(3);
                              };
                              return (
                                <tr key={i} data-testid={`account-anomaly-row-${i}`}
                                  className="border-b border-border/20 hover:bg-muted/20 transition-colors">
                                  <td className="px-4 py-3">
                                    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wide", cfg.badge)}>
                                      {row.severity}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3 font-mono font-medium">{row.account}</td>
                                  <td className="px-4 py-3 text-muted-foreground">{row.label}</td>
                                  <td className="px-4 py-3 text-right font-mono text-muted-foreground">{fmtVal(row.metric, row.baseline)}</td>
                                  <td className="px-4 py-3 text-right font-mono font-bold">
                                    <span className={row.direction === 'up' ? 'text-amber-400' : 'text-blue-400'}>
                                      {fmtVal(row.metric, row.observed)}
                                      <span className="text-[9px] ml-1 opacity-70">{row.direction === 'up' ? '▲' : '▼'}</span>
                                    </span>
                                  </td>
                                  <td className="px-4 py-3 text-right font-mono">
                                    <span className={row.sigma >= 3 ? 'text-rose-400' : row.sigma >= 2.5 ? 'text-amber-400' : 'text-yellow-400'}>
                                      {row.sigma.toFixed(2)}σ
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 text-[11px] text-muted-foreground space-y-1">
                      <span className="font-medium text-foreground/70">How account detection works: </span>
                      Compares each account's last 24h CDR data against the 24–72h baseline window ·
                      Metrics: avg call duration · cost per minute · destination entropy ·
                      Thresholds: Medium ≥2σ · High ≥2.5σ · Critical ≥3σ
                    </div>
                  </>
                )}
              </div>
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

              {(queryResult || nlqResult) && (
                <div className="space-y-2">
                  <div className="rounded-lg border border-border bg-muted/20 p-3">
                    <pre className="text-[11px] text-muted-foreground whitespace-pre-wrap leading-relaxed">{queryResult}</pre>
                    {nlqResult && (
                      <div className="mt-2 pt-2 border-t border-border/40 flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] text-muted-foreground/50 font-mono">{nlqResult.cdrsAnalyzed} CDRs in {nlqResult.windowLabel}</span>
                        {nlqResult.updatedAt && (
                          <span className="text-[10px] text-muted-foreground/40">· cache {new Date(nlqResult.updatedAt).toLocaleTimeString()}</span>
                        )}
                      </div>
                    )}
                  </div>
                  {nlqResult && nlqResult.headers.length > 0 && nlqResult.rows.length > 0 && (
                    <div className="rounded-lg border border-border overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-[11px]">
                          <thead>
                            <tr className="border-b border-border/60 bg-muted/30">
                              {nlqResult.headers.map(h => (
                                <th key={h} className="text-left px-2.5 py-1.5 font-semibold text-muted-foreground uppercase tracking-wider text-[9px]">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {nlqResult.rows.map((row, i) => (
                              <tr key={i} className="border-b border-border/30 hover:bg-muted/20 transition-colors">
                                {nlqResult.headers.map(h => (
                                  <td key={h} className="px-2.5 py-1.5 text-muted-foreground font-mono">{row[h]}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
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

            {/* ── Critical Accounts Widget ──────────────────────────────── */}
            {criticalAccounts.length > 0 && (
              <div className="bg-card border border-border rounded-xl overflow-hidden" data-testid="widget-critical-accounts">
                <div className="px-4 py-3 border-b border-border/60 flex items-center gap-2">
                  <div className="p-1 rounded bg-rose-500/10 border border-rose-500/20">
                    <AlertTriangle className="h-3.5 w-3.5 text-rose-400" />
                  </div>
                  <span className="text-xs font-semibold">Account Health Alerts</span>
                  <span className="ml-auto text-[9px] font-bold bg-rose-500/15 text-rose-400 border border-rose-500/25 rounded-full px-1.5 py-0.5 leading-none">
                    {criticalAccounts.length}
                  </span>
                </div>
                <div className="divide-y divide-border/30">
                  {criticalAccounts.map(acct => {
                    const isCrit = acct.state === 'critical';
                    const barColor  = isCrit ? 'bg-rose-400'  : 'bg-amber-400';
                    const textColor = isCrit ? 'text-rose-400' : 'text-amber-400';
                    const dotColor  = isCrit ? 'bg-rose-400'  : 'bg-amber-400';
                    const trend = acct.trendDirection;
                    const trendEl = trend === 'improving'
                      ? <span className="text-emerald-400 text-[10px] font-bold leading-none" title="Improving">↑</span>
                      : trend === 'worsening'
                      ? <span className="text-rose-400 text-[10px] font-bold leading-none" title="Worsening">↓</span>
                      : <span className="text-muted-foreground/40 text-[10px] leading-none" title="Stable">→</span>;
                    const deltaLabel = acct.scoreDelta24h !== null && acct.scoreDelta24h !== 0
                      ? <span className={`text-[9px] font-mono ${(acct.scoreDelta24h ?? 0) > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {(acct.scoreDelta24h ?? 0) > 0 ? '+' : ''}{acct.scoreDelta24h}
                        </span>
                      : null;
                    return (
                      <div key={acct.accountId} className="px-4 py-2.5 flex items-start gap-3" data-testid={`row-acct-health-${acct.accountId}`}>
                        <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${dotColor}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-xs font-medium truncate">{acct.accountName ?? acct.accountId}</span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {acct.exposureRiskLevel && acct.exposureRiskLevel !== 'low' && (acct.authExposureScore ?? 0) > 0 && (
                                <span
                                  title={`Auth exposure: ${acct.authExposureScore}/100`}
                                  className={cn(
                                    "text-[9px] font-bold px-1 py-0.5 rounded leading-none",
                                    acct.exposureRiskLevel === 'critical' ? 'bg-rose-500/20 text-rose-400' :
                                    acct.exposureRiskLevel === 'high'     ? 'bg-orange-500/20 text-orange-400' :
                                                                            'bg-amber-500/20 text-amber-400'
                                  )}
                                >EXP</span>
                              )}
                              {trendEl}
                              {deltaLabel}
                              <span className={`text-[10px] font-bold tabular-nums ${textColor}`}>{acct.healthScore}</span>
                            </div>
                          </div>
                          <div className="mt-1.5 flex items-center gap-2">
                            <div className="flex-1 h-1 rounded-full bg-muted/40 overflow-hidden">
                              <div className={`h-full rounded-full ${barColor} opacity-70 transition-all duration-700`} style={{ width: `${acct.healthScore}%` }} />
                            </div>
                            {(stateHistory[acct.accountId] ?? []).length >= 2 && (
                              <MiniSparkline
                                values={(stateHistory[acct.accountId] ?? []).map(s => s.healthScore)}
                                color={isCrit ? '#f87171' : '#fbbf24'}
                              />
                            )}
                          </div>
                          {acct.reasons && acct.reasons.length > 0 && (
                            <p className="text-[10px] text-muted-foreground mt-1 truncate">{acct.reasons[0]}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="px-4 py-2 border-t border-border/30 bg-muted/10 flex items-center justify-between">
                  <p className="text-[10px] text-muted-foreground/60">↑ improving · → stable · ↓ worsening</p>
                  {criticalAccounts[0]?.updatedAt && (
                    <p className="text-[10px] text-muted-foreground/40">
                      {(() => {
                        const diff = Math.floor((Date.now() - new Date(criticalAccounts[0].updatedAt!).getTime()) / 60000);
                        return diff < 1 ? 'just now' : diff < 60 ? `${diff}m ago` : `${Math.floor(diff/60)}h ago`;
                      })()}
                    </p>
                  )}
                </div>
              </div>
            )}

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
