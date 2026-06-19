import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ArrowLeft, AlertTriangle, CheckCircle2, Clock, User, Zap,
  ShieldAlert, Activity, TrendingDown, Brain, ChevronDown, ChevronUp,
  BarChart3, Shield, GitBranch, FileText, DollarSign, Eye,
  MessageSquare, RefreshCw, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";

// ── Types ──────────────────────────────────────────────────────────────────────

interface RootCauseSignal {
  type: string;
  title: string;
  detail?: string[];
  confidence?: number;
  vendor?: string;
}

interface RootCause {
  primaryDriver?: string;
  signals?: RootCauseSignal[];
  summary?: string;
}

interface LifecycleEvent {
  id: number;
  fromState: string | null;
  toState: string;
  actor: string | null;
  note: string | null;
  createdAt: string | null;
}

interface CarrierScore {
  carrierId?: string;
  carrierName: string;
  stabilityScore: number | null;
  rollingAsr: number | null;
  avgPddMs: number | null;
  trend: string | null;
  windowHours: number;
}

interface FasEvent {
  id: number;
  vendor: string | null;
  caller: string | null;
  callee: string | null;
  pddSecs: number | null;
  billSecs: number | null;
  fraudScore: number | null;
  reason: string | null;
  detectedAt: string;
}

interface StabilitySnapshot {
  id: number;
  vendor: string;
  ts: string;
  qScore: number;
  asr: number | null;
  fasRate: number | null;
  stability: string;
  callCount: number;
}

interface Recommendation {
  accountId: string;
  accountName: string;
  type?: string;
  urgency?: string;
  title?: string;
  confidence?: number;
  ruleDescription?: string;
  updatedAt: string;
}

interface IncidentAction {
  type: string;
  actor?: string;
  note?: string;
  ts?: string;
  metrics?: Record<string, any>;
}

interface IncidentDetail {
  incident: {
    id: number;
    entityKey: string;
    entityLabel: string;
    severity: string;
    state: string;
    title: string;
    alerts: any[];
    rootCause: RootCause | null;
    actions: IncidentAction[];
    timeline: any[];
    metrics: any | null;
    estimatedImpactPerHr: number | null;
    linkedTicketId: number | null;
    startedAt: string;
    lastSeenAt: string;
    resolvedAt: string | null;
    acknowledgedBy: string | null;
    acknowledgedAt: string | null;
    acknowledgeNote: string | null;
    resolvedBy: string | null;
    resolutionNote: string | null;
    assignedTo: string | null;
    assignmentHistory: any[];
  };
  lifecycle: LifecycleEvent[];
  carrierScore: CarrierScore | null;
  fasEvents: FasEvent[];
  stabilityHistory: StabilitySnapshot[];
  recommendations: Recommendation[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${m}m`;
}

function relativeTime(ts: string): string {
  const ms = Date.now() - new Date(ts).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(ts: string): string {
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ── Sub-components ─────────────────────────────────────────────────────────────

const SEV_CONFIG: Record<string, { bg: string; border: string; dot: string; text: string; badge: string; label: string }> = {
  critical: { bg: 'bg-rose-500/8',    border: 'border-rose-500/30',   dot: 'bg-rose-500',   text: 'text-rose-400',   badge: 'bg-rose-500/20 text-rose-400 border-rose-500/25',   label: 'CRITICAL' },
  high:     { bg: 'bg-orange-500/8',  border: 'border-orange-500/30', dot: 'bg-orange-500', text: 'text-orange-400', badge: 'bg-orange-500/20 text-orange-400 border-orange-500/25', label: 'HIGH' },
  medium:   { bg: 'bg-amber-500/8',   border: 'border-amber-500/30',  dot: 'bg-amber-500',  text: 'text-amber-400',  badge: 'bg-amber-500/20 text-amber-400 border-amber-500/25',   label: 'MEDIUM' },
  low:      { bg: 'bg-blue-500/8',    border: 'border-blue-500/30',   dot: 'bg-blue-500',   text: 'text-blue-400',   badge: 'bg-blue-500/20 text-blue-400 border-blue-500/25',       label: 'LOW' },
};

const STATE_CONFIG: Record<string, { bg: string; text: string; label: string }> = {
  active:        { bg: 'bg-rose-500/20',    text: 'text-rose-400',    label: 'ACTIVE' },
  investigating: { bg: 'bg-amber-500/20',   text: 'text-amber-400',   label: 'INVESTIGATING' },
  acknowledged:  { bg: 'bg-indigo-500/20',  text: 'text-indigo-400',  label: 'ACKNOWLEDGED' },
  resolved:      { bg: 'bg-emerald-500/20', text: 'text-emerald-400', label: 'RESOLVED' },
};

function SectionCard({ title, icon: Icon, children, className }: {
  title: string; icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn("rounded-xl border border-white/[0.07] bg-white/[0.02] flex flex-col", className)}>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.05]">
        <Icon className="w-3.5 h-3.5 text-muted-foreground/50" />
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">{title}</span>
      </div>
      <div className="p-4 flex-1">{children}</div>
    </div>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  const color = value >= 80 ? 'bg-rose-500' : value >= 60 ? 'bg-amber-500' : 'bg-blue-500';
  return (
    <div className="flex items-center gap-2 flex-shrink-0">
      <div className="w-16 h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${value}%` }} />
      </div>
      <span className="text-[10px] font-mono tabular-nums text-muted-foreground/50 w-8">{value}%</span>
    </div>
  );
}

function StabilitySparkline({ history }: { history: StabilitySnapshot[] }) {
  if (history.length === 0) return (
    <div className="flex items-center justify-center h-16 text-xs text-muted-foreground/40">No stability data</div>
  );

  const max = 100;
  const points = history.slice(-48);
  const w = 100 / (points.length - 1 || 1);

  const pathD = points.map((p, i) => {
    const x = i * w;
    const y = 100 - (p.qScore / max) * 100;
    return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');

  const lastQ = points[points.length - 1]?.qScore ?? 0;
  const color = lastQ >= 70 ? '#10b981' : lastQ >= 40 ? '#f59e0b' : '#f43f5e';
  const fillD = pathD + ` L ${((points.length - 1) * w).toFixed(1)} 100 L 0 100 Z`;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground/50">Q-score over time</span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-muted-foreground/50">current</span>
          <span className="text-sm font-bold font-mono" style={{ color }}>{lastQ}</span>
        </div>
      </div>
      <svg viewBox="0 0 100 60" className="w-full h-16 overflow-visible" preserveAspectRatio="none">
        <defs>
          <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={fillD} fill="url(#spark-fill)" />
        <path d={pathD} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="flex justify-between text-[9px] text-muted-foreground/30">
        <span>{points[0] ? formatTime(points[0].ts) : ''}</span>
        <span>now</span>
      </div>
    </div>
  );
}

// ── Operator action panel ──────────────────────────────────────────────────────

function OperatorPanel({ incident, onRefresh }: {
  incident: IncidentDetail['incident'];
  onRefresh: () => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [noteText, setNoteText] = useState('');
  const [showNote, setShowNote] = useState(false);

  const transitionMut = useMutation({
    mutationFn: ({ toState, note }: { toState: string; note?: string }) =>
      apiRequest('POST', `/api/console/incidents/${incident.id}/transition`, { toState, note }),
    onSuccess: () => { onRefresh(); toast({ title: 'State updated' }); },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const state = incident.state;
  const canAck     = state === 'active';
  const canInvest  = state === 'active' || state === 'acknowledged';
  const canResolve = state !== 'resolved';

  return (
    <div className="flex flex-col gap-3">
      {incident.acknowledgedBy && (
        <div className="flex items-start gap-2 rounded-lg bg-indigo-500/8 border border-indigo-500/20 px-3 py-2">
          <CheckCircle2 className="w-3.5 h-3.5 text-indigo-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-indigo-300">Acknowledged by {incident.acknowledgedBy}</p>
            {incident.acknowledgeNote && <p className="text-[11px] text-muted-foreground/60 mt-0.5">{incident.acknowledgeNote}</p>}
          </div>
          <span className="text-[10px] text-muted-foreground/40 flex-shrink-0">{incident.acknowledgedAt ? relativeTime(incident.acknowledgedAt) : ''}</span>
        </div>
      )}

      {incident.resolvedBy && (
        <div className="flex items-start gap-2 rounded-lg bg-emerald-500/8 border border-emerald-500/20 px-3 py-2">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-emerald-300">Resolved by {incident.resolvedBy}</p>
            {incident.resolutionNote && <p className="text-[11px] text-muted-foreground/60 mt-0.5">{incident.resolutionNote}</p>}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {canAck && (
          <button
            data-testid="btn-acknowledge"
            onClick={() => transitionMut.mutate({ toState: 'acknowledged', note: `Acknowledged by ${user?.firstName ?? user?.email ?? 'operator'}` })}
            disabled={transitionMut.isPending}
            className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold bg-indigo-500/15 border border-indigo-500/25 text-indigo-400 hover:bg-indigo-500/25 transition-colors disabled:opacity-50"
          >
            <CheckCircle2 className="w-3.5 h-3.5" /> Acknowledge
          </button>
        )}
        {canInvest && (
          <button
            data-testid="btn-investigating"
            onClick={() => transitionMut.mutate({ toState: 'investigating' })}
            disabled={transitionMut.isPending}
            className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold bg-amber-500/15 border border-amber-500/25 text-amber-400 hover:bg-amber-500/25 transition-colors disabled:opacity-50"
          >
            <Eye className="w-3.5 h-3.5" /> Investigating
          </button>
        )}
        {canResolve && (
          <button
            data-testid="btn-resolve"
            onClick={() => { setShowNote(!showNote); }}
            className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold bg-emerald-500/15 border border-emerald-500/25 text-emerald-400 hover:bg-emerald-500/25 transition-colors"
          >
            <CheckCircle2 className="w-3.5 h-3.5" /> Resolve
          </button>
        )}
        <Link
          href={`/vendor-rca?vendor=${encodeURIComponent(incident.entityLabel)}`}
          data-testid="btn-open-rca"
          className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold bg-white/[0.04] border border-white/[0.07] text-muted-foreground hover:text-foreground hover:bg-white/[0.08] transition-colors"
        >
          <Brain className="w-3.5 h-3.5" /> Open RCA
        </Link>
        <Link
          href={`/vendor-stability-timeline?vendor=${encodeURIComponent(incident.entityLabel)}`}
          data-testid="btn-stability"
          className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold bg-white/[0.04] border border-white/[0.07] text-muted-foreground hover:text-foreground hover:bg-white/[0.08] transition-colors"
        >
          <Activity className="w-3.5 h-3.5" /> Stability
        </Link>
      </div>

      {showNote && (
        <div className="flex flex-col gap-2 rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
          <p className="text-xs font-medium text-foreground/70">Resolution note (optional)</p>
          <textarea
            data-testid="input-resolve-note"
            value={noteText}
            onChange={e => setNoteText(e.target.value)}
            rows={2}
            placeholder="What was the root cause? What action was taken?"
            className="w-full bg-white/[0.03] border border-white/[0.07] rounded-lg px-3 py-2 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-indigo-500/40 placeholder:text-muted-foreground/30"
          />
          <div className="flex gap-2">
            <button
              data-testid="btn-confirm-resolve"
              onClick={() => {
                transitionMut.mutate({ toState: 'resolved', note: noteText || undefined });
                setShowNote(false);
                setNoteText('');
              }}
              disabled={transitionMut.isPending}
              className="h-7 px-3 rounded-md text-xs font-semibold bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/30 transition-colors disabled:opacity-50"
            >
              Confirm resolve
            </button>
            <button onClick={() => setShowNote(false)} className="h-7 px-3 rounded-md text-xs text-muted-foreground hover:text-foreground transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function IncidentDetailPage() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id ?? '', 10);
  const [lcExpanded, setLcExpanded] = useState(true);

  const {
    data, isLoading, isError, refetch,
  } = useQuery<IncidentDetail>({
    queryKey: ['/api/console/incidents', id, 'detail'],
    queryFn: async () => {
      const r = await fetch(`/api/console/incidents/${id}/detail`);
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    enabled: !isNaN(id),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  if (isNaN(id)) return <div className="p-8 text-sm text-muted-foreground">Invalid incident ID.</div>;

  if (isLoading) return (
    <div className="flex items-center justify-center h-64 gap-3 text-muted-foreground/50">
      <RefreshCw className="w-4 h-4 animate-spin" />
      <span className="text-sm">Loading investigation…</span>
    </div>
  );

  if (isError || !data) return (
    <div className="flex items-center justify-center h-64 gap-2 text-rose-400/60">
      <AlertTriangle className="w-4 h-4" />
      <span className="text-sm">Could not load incident #{id}</span>
    </div>
  );

  const { incident, lifecycle, carrierScore, fasEvents, stabilityHistory, recommendations } = data;
  const sev   = SEV_CONFIG[incident.severity]  ?? SEV_CONFIG.medium;
  const stCfg = STATE_CONFIG[incident.state]   ?? STATE_CONFIG.active;
  const durationMs = incident.resolvedAt
    ? new Date(incident.resolvedAt).getTime() - new Date(incident.startedAt).getTime()
    : Date.now() - new Date(incident.startedAt).getTime();

  const rcSignals: RootCauseSignal[] = incident.rootCause?.signals ?? [];
  const recentFas = fasEvents.slice(0, 8);
  const avgFraud = fasEvents.length > 0
    ? Math.round(fasEvents.reduce((s, e) => s + (e.fraudScore ?? 0), 0) / fasEvents.length)
    : null;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5 space-y-5">

        {/* ── Back nav + breadcrumb ── */}
        <div className="flex items-center gap-2">
          <Link
            href="/ops-console"
            data-testid="btn-back-incidents"
            className="flex items-center gap-1.5 text-xs text-muted-foreground/60 hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Incidents
          </Link>
          <span className="text-muted-foreground/30 text-xs">/</span>
          <span className="text-xs text-muted-foreground/50">#{incident.id}</span>
        </div>

        {/* ── Incident header ── */}
        <div className={cn("rounded-xl border p-5 space-y-3", sev.bg, sev.border)}>
          <div className="flex items-start gap-3 flex-wrap">
            {/* Severity pulse */}
            <span className="relative inline-flex mt-1 flex-shrink-0">
              {incident.state !== 'resolved' && (
                <span className={cn("absolute rounded-full animate-ping opacity-60", sev.dot)} style={{ width: 10, height: 10 }} />
              )}
              <span className={cn("relative rounded-full", sev.dot)} style={{ width: 10, height: 10 }} />
            </span>

            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={cn("text-[10px] font-bold tracking-widest px-2 py-0.5 rounded border", sev.badge)}>
                  {sev.label}
                </span>
                <span className={cn("text-[10px] font-bold tracking-widest px-2 py-0.5 rounded", stCfg.bg, stCfg.text)}>
                  {stCfg.label}
                </span>
                {incident.assignedTo && (
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground/50">
                    <User className="w-3 h-3" /> {incident.assignedTo}
                  </span>
                )}
              </div>
              <h1 className={cn("text-lg font-bold leading-tight", sev.text)} data-testid="text-incident-title">
                {incident.title}
              </h1>
              <p className="text-sm text-muted-foreground/70 font-medium">{incident.entityLabel}</p>
            </div>

            <button
              onClick={() => refetch()}
              data-testid="btn-refresh-incident"
              className="flex-shrink-0 p-1.5 rounded-lg text-muted-foreground/50 hover:text-foreground hover:bg-white/[0.06] transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Timing + impact row */}
          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground/60 pt-1">
            <span className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              Started {relativeTime(incident.startedAt)}
              <span className="text-muted-foreground/30">({formatDate(incident.startedAt)})</span>
            </span>
            <span className="flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5" />
              Duration: {formatDuration(durationMs)}
            </span>
            {incident.estimatedImpactPerHr != null && (
              <span className={cn("flex items-center gap-1.5 font-semibold", sev.text)}>
                <DollarSign className="w-3.5 h-3.5" />
                ~${incident.estimatedImpactPerHr.toFixed(2)}/hr estimated impact
              </span>
            )}
            {incident.linkedTicketId && (
              <span className="flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" />
                Ticket #{incident.linkedTicketId}
              </span>
            )}
          </div>
        </div>

        {/* ── Main grid ── */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">

          {/* ── Left column (primary) ── */}
          <div className="xl:col-span-2 space-y-5">

            {/* Evidence Chain */}
            <SectionCard title="RCA Evidence Chain" icon={Brain}>
              {incident.rootCause?.summary && (
                <p className="text-sm text-foreground/70 mb-3 leading-relaxed">{incident.rootCause.summary}</p>
              )}
              {rcSignals.length === 0 ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground/40 py-2">
                  <ShieldAlert className="w-4 h-4" />
                  Root cause analysis pending or unavailable
                </div>
              ) : (
                <div className="space-y-2">
                  {rcSignals.map((sig, i) => (
                    <div
                      key={i}
                      data-testid={`evidence-signal-${i}`}
                      className="flex items-start gap-3 rounded-lg bg-white/[0.02] border border-white/[0.05] px-3 py-2.5"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-foreground/90">{sig.title}</p>
                        {sig.detail && sig.detail.length > 0 && (
                          <p className="text-[11px] text-muted-foreground/55 mt-0.5 leading-relaxed">
                            {sig.detail.join(' · ')}
                          </p>
                        )}
                      </div>
                      {sig.confidence != null && (
                        <ConfidenceBar value={sig.confidence} />
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Alert count */}
              {incident.alerts.length > 0 && (
                <div className="mt-3 pt-3 border-t border-white/[0.05]">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground/40 mb-2">Contributing Alerts ({incident.alerts.length})</p>
                  <div className="space-y-1">
                    {incident.alerts.slice(0, 5).map((a: any, i: number) => (
                      <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground/60">
                        <span className={cn(
                          "w-1.5 h-1.5 rounded-full flex-shrink-0",
                          a.severity === 'critical' ? 'bg-rose-500' : a.severity === 'high' ? 'bg-orange-500' : 'bg-amber-500'
                        )} />
                        <span className="flex-1 truncate">{a.message ?? a.title ?? 'Alert'}</span>
                        {a.metric && <span className="font-mono text-[10px] text-muted-foreground/35 flex-shrink-0">{a.metric}</span>}
                      </div>
                    ))}
                    {incident.alerts.length > 5 && (
                      <p className="text-[10px] text-muted-foreground/35">+{incident.alerts.length - 5} more alerts</p>
                    )}
                  </div>
                </div>
              )}
            </SectionCard>

            {/* Degradation Timeline */}
            <SectionCard title="Degradation Timeline" icon={Activity}>
              {stabilityHistory.length > 0 ? (
                <div className="space-y-4">
                  <StabilitySparkline history={stabilityHistory} />

                  {/* Stability metadata row */}
                  {stabilityHistory.length > 0 && (() => {
                    const latest = stabilityHistory[stabilityHistory.length - 1];
                    return (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-white/[0.05]">
                        {[
                          { label: 'Stability', value: latest.stability ?? '—' },
                          { label: 'ASR',        value: latest.asr != null ? `${latest.asr.toFixed(1)}%` : '—' },
                          { label: 'FAS Rate',   value: latest.fasRate != null ? `${latest.fasRate.toFixed(1)}%` : '—' },
                          { label: 'Calls',      value: latest.callCount },
                        ].map(({ label, value }) => (
                          <div key={label} className="space-y-0.5">
                            <p className="text-[9px] uppercase tracking-widest text-muted-foreground/40">{label}</p>
                            <p className="text-sm font-semibold font-mono text-foreground/80">{value}</p>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              ) : carrierScore ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {[
                    { label: 'Stability Score', value: carrierScore.stabilityScore?.toFixed(0) ?? '—', highlight: (carrierScore.stabilityScore ?? 100) < 55 },
                    { label: 'Rolling ASR',     value: carrierScore.rollingAsr != null ? `${carrierScore.rollingAsr.toFixed(1)}%` : '—', highlight: (carrierScore.rollingAsr ?? 100) < 40 },
                    { label: 'Avg PDD',         value: carrierScore.avgPddMs != null ? `${carrierScore.avgPddMs}ms` : '—', highlight: (carrierScore.avgPddMs ?? 0) > 5000 },
                  ].map(({ label, value, highlight }) => (
                    <div key={label} className="space-y-0.5">
                      <p className="text-[9px] uppercase tracking-widest text-muted-foreground/40">{label}</p>
                      <p className={cn("text-lg font-bold font-mono", highlight ? 'text-rose-400' : 'text-foreground/80')}>{value}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-center py-6 text-xs text-muted-foreground/40">
                  No degradation data — carrier not in scoring system
                </div>
              )}
            </SectionCard>

            {/* Lifecycle Feed */}
            <SectionCard title="Lifecycle Feed" icon={GitBranch}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] text-muted-foreground/40">{lifecycle.length} event{lifecycle.length !== 1 ? 's' : ''}</span>
                <button onClick={() => setLcExpanded(e => !e)} className="text-muted-foreground/40 hover:text-foreground transition-colors">
                  {lcExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>
              </div>

              {lcExpanded && (
                <div className="relative">
                  {/* Vertical rail */}
                  <div className="absolute left-3 top-0 bottom-0 w-px bg-white/[0.06]" />
                  <div className="space-y-3 ml-0">
                    {/* Incident opened event */}
                    <div className="flex items-start gap-3 pl-7 relative">
                      <span className="absolute left-[7px] top-1.5 w-2.5 h-2.5 rounded-full bg-rose-500/80 ring-2 ring-background" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground/80">Incident opened</p>
                        <p className="text-[11px] text-muted-foreground/50">{formatDate(incident.startedAt)}</p>
                      </div>
                      <span className="text-[10px] text-muted-foreground/35 flex-shrink-0">{relativeTime(incident.startedAt)}</span>
                    </div>

                    {lifecycle.map(ev => {
                      const dotColor = ev.toState === 'resolved' ? 'bg-emerald-500' : ev.toState === 'acknowledged' ? 'bg-indigo-500' : 'bg-amber-500';
                      return (
                        <div key={ev.id} data-testid={`lifecycle-event-${ev.id}`} className="flex items-start gap-3 pl-7 relative">
                          <span className={cn("absolute left-[7px] top-1.5 w-2.5 h-2.5 rounded-full ring-2 ring-background", dotColor)} />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-foreground/80 capitalize">
                              {ev.fromState && <span className="text-muted-foreground/40">{ev.fromState} → </span>}
                              {ev.toState}
                              {ev.actor && <span className="text-muted-foreground/50 font-normal ml-1.5">by {ev.actor}</span>}
                            </p>
                            {ev.note && <p className="text-[11px] text-muted-foreground/55 mt-0.5">{ev.note}</p>}
                          </div>
                          {ev.createdAt && (
                            <span className="text-[10px] text-muted-foreground/35 flex-shrink-0">{relativeTime(ev.createdAt)}</span>
                          )}
                        </div>
                      );
                    })}

                    {incident.state === 'resolved' && incident.resolvedAt && (
                      <div className="flex items-start gap-3 pl-7 relative">
                        <span className="absolute left-[7px] top-1.5 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-background" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-emerald-400">Incident resolved</p>
                          {incident.resolutionNote && <p className="text-[11px] text-muted-foreground/55 mt-0.5">{incident.resolutionNote}</p>}
                        </div>
                        <span className="text-[10px] text-muted-foreground/35">{relativeTime(incident.resolvedAt)}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </SectionCard>

            {/* Action History */}
            {incident.actions.length > 0 && (
              <SectionCard title="Action History" icon={FileText}>
                <div className="space-y-2">
                  {incident.actions.map((a, i) => (
                    <div key={i} data-testid={`action-row-${i}`} className="flex items-start gap-3 rounded-lg bg-white/[0.02] border border-white/[0.05] px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground/80 capitalize">{a.type?.replace(/_/g, ' ') ?? 'Action'}</p>
                        {a.note && <p className="text-[11px] text-muted-foreground/55 mt-0.5">{a.note}</p>}
                        {a.actor && <p className="text-[10px] text-muted-foreground/40 mt-0.5">by {a.actor}</p>}
                      </div>
                      {a.ts && <span className="text-[10px] text-muted-foreground/35 flex-shrink-0">{relativeTime(a.ts)}</span>}
                    </div>
                  ))}
                </div>
              </SectionCard>
            )}
          </div>

          {/* ── Right column (context + actions) ── */}
          <div className="space-y-5">

            {/* Operator Panel */}
            <SectionCard title="Operator Actions" icon={Shield}>
              <OperatorPanel incident={incident} onRefresh={refetch} />
            </SectionCard>

            {/* Quick metrics */}
            <SectionCard title="Impact Metrics" icon={BarChart3}>
              <div className="space-y-3">
                {[
                  { label: 'Severity',    value: incident.severity.toUpperCase(),     color: sev.text },
                  { label: 'State',       value: incident.state.replace(/_/g,' ').toUpperCase(), color: stCfg.text },
                  { label: 'Duration',    value: formatDuration(durationMs) },
                  { label: 'Last seen',   value: relativeTime(incident.lastSeenAt) },
                  ...(incident.estimatedImpactPerHr != null ? [{ label: 'Impact/hr', value: `$${incident.estimatedImpactPerHr.toFixed(2)}`, color: sev.text }] : []),
                  ...(carrierScore?.stabilityScore != null ? [{ label: 'Q-score', value: carrierScore.stabilityScore.toFixed(0), color: (carrierScore.stabilityScore < 55 ? 'text-rose-400' : carrierScore.stabilityScore < 75 ? 'text-amber-400' : 'text-emerald-400') }] : []),
                ].map(({ label, value, color }) => (
                  <div key={label} className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground/50">{label}</span>
                    <span className={cn("text-xs font-semibold font-mono", color ?? 'text-foreground/80')}>{value}</span>
                  </div>
                ))}
              </div>
            </SectionCard>

            {/* FAS Activity */}
            <SectionCard title="FAS / Fraud Activity" icon={ShieldAlert}>
              {fasEvents.length === 0 ? (
                <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground/40">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500/50" />
                  No FAS events in last 7 days
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg bg-rose-500/8 border border-rose-500/20 px-3 py-2 text-center">
                      <p className="text-2xl font-bold font-mono text-rose-400">{fasEvents.length}</p>
                      <p className="text-[9px] uppercase tracking-widest text-muted-foreground/50 mt-0.5">events (7d)</p>
                    </div>
                    {avgFraud != null && (
                      <div className="rounded-lg bg-orange-500/8 border border-orange-500/20 px-3 py-2 text-center">
                        <p className="text-2xl font-bold font-mono text-orange-400">{avgFraud}</p>
                        <p className="text-[9px] uppercase tracking-widest text-muted-foreground/50 mt-0.5">avg score</p>
                      </div>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    {recentFas.map(ev => (
                      <div key={ev.id} data-testid={`fas-event-${ev.id}`} className="flex items-center gap-2 text-xs">
                        <span className={cn(
                          "w-1.5 h-1.5 rounded-full flex-shrink-0",
                          (ev.fraudScore ?? 0) >= 80 ? 'bg-rose-500' : (ev.fraudScore ?? 0) >= 50 ? 'bg-orange-500' : 'bg-amber-500'
                        )} />
                        <span className="flex-1 truncate text-muted-foreground/60 text-[11px]">
                          {ev.reason ?? 'FAS event'} — {ev.callee ?? '?'}
                        </span>
                        <span className="font-mono text-[10px] text-muted-foreground/35 flex-shrink-0">
                          {ev.fraudScore?.toFixed(0) ?? '?'}
                        </span>
                      </div>
                    ))}
                  </div>
                  <Link
                    href="/fraud"
                    data-testid="btn-view-fraud"
                    className="flex items-center justify-center gap-1.5 h-7 rounded-lg text-[11px] font-medium border border-white/[0.07] bg-white/[0.02] text-muted-foreground hover:text-foreground hover:bg-white/[0.05] transition-colors"
                  >
                    View Fraud Engine <X className="w-3 h-3 rotate-45" />
                  </Link>
                </div>
              )}
            </SectionCard>

            {/* Linked Recommendations */}
            <SectionCard title="Linked Recommendations" icon={TrendingDown}>
              {recommendations.length === 0 ? (
                <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground/40">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500/50" />
                  No recommendations for this entity
                </div>
              ) : (
                <div className="space-y-2">
                  {recommendations.slice(0, 4).map((rec, i) => (
                    <div key={i} data-testid={`recommendation-${i}`} className="rounded-lg bg-white/[0.02] border border-white/[0.05] px-3 py-2.5 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "text-[9px] font-bold tracking-widest px-1.5 py-0.5 rounded",
                          rec.urgency === 'immediate' ? 'bg-rose-500/20 text-rose-400' :
                          rec.urgency === 'today'     ? 'bg-amber-500/20 text-amber-400' :
                          'bg-blue-500/20 text-blue-400'
                        )}>{rec.type ?? 'REC'}</span>
                        {rec.confidence != null && <ConfidenceBar value={rec.confidence} />}
                      </div>
                      <p className="text-xs font-medium text-foreground/80">{rec.title ?? rec.accountName}</p>
                      {rec.ruleDescription && (
                        <p className="text-[10px] text-muted-foreground/45">{rec.ruleDescription}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>

          </div>
        </div>
      </div>
    </div>
  );
}
