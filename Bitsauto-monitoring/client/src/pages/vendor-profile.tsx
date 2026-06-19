import { useState } from "react";
import { useRoute, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ArrowLeft, DollarSign, Activity, AlertTriangle, Clock,
  CheckCircle2, TrendingUp, BarChart3, Zap, BrainCircuit,
  ArrowRight, ExternalLink, RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { FreshnessIndicator } from "@/components/freshness-indicator";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Alert } from "@shared/schema";

// ── Types ──────────────────────────────────────────────────────────────────────

interface BalancePoint    { ts: number; balance: number; }
interface BalanceHistory  { vendor: string; points: BalancePoint[]; count: number; }
interface CdrDestRow      { prefix: string; calls: number; answered: number; asr: number; acd: number; minutes: number; avgPddMs: number; cost: number; }
interface CdrVendorSummary{ vendor: string; rows: CdrDestRow[]; totalCdrs: number; cacheSize: number; }
interface TimelineEvent   { id: string; kind: 'alert' | 'anomaly' | 'incident'; ts: string; title: string; severity: string; entity: string | null; status: string; detail?: string; }
interface EntityTimeline  { entity: string; events: TimelineEvent[]; total: number; windowH?: number; }
interface CarrierScore    { id?: number; carrierId: string; carrierName: string; stabilityScore: number | null; rollingAsr: number | null; avgPddMs: number | null; trend: string | null; sampleCount: number; failureRate: number | null; }
interface AiOpsIncident   { id: number; severity: string; title: string; status: string; entityName: string | null; signalCount: number; createdAt: string; }
interface AnomalyEvent    { id: number; vendor: string | null; metric: string; severity: string; title: string; description: string; resolved: boolean; resolvedAt: string | null; detectedAt: string; }

// ── Small helpers ──────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] uppercase tracking-widest text-muted-foreground/50 font-mono mb-2">{children}</p>;
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-white/[0.06] bg-white/[0.02] p-4", className)}>
      {children}
    </div>
  );
}

function FreshnessRow({ label, updatedAt, intervalMs, isFetching }: { label: string; updatedAt: number; intervalMs: number; isFetching?: boolean }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <SectionLabel>{label}</SectionLabel>
      <FreshnessIndicator updatedAt={updatedAt} intervalMs={intervalMs} isFetching={isFetching} />
    </div>
  );
}

// ── Inline SVG sparkline ───────────────────────────────────────────────────────

function Sparkline({ points, width = 260, height = 48 }: { points: BalancePoint[]; width?: number; height?: number }) {
  if (points.length < 2) return <div className="h-12 flex items-center justify-center text-xs text-muted-foreground/40">Not enough data</div>;
  const vals   = points.map(p => p.balance);
  const min    = Math.min(...vals);
  const max    = Math.max(...vals);
  const range  = max - min || 1;
  const xStep  = width / (points.length - 1);
  const pad    = 4;
  const toY    = (v: number) => pad + ((1 - (v - min) / range) * (height - pad * 2));
  const d      = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${(i * xStep).toFixed(1)},${toY(p.balance).toFixed(1)}`).join(' ');
  const fill   = `${d} L${((points.length - 1) * xStep).toFixed(1)},${height} L0,${height} Z`;
  const last   = vals[vals.length - 1];
  const trend  = vals.length > 1 ? last - vals[0] : 0;
  const color  = trend >= 0 ? "#34d399" : "#f87171";
  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }}>
        <defs>
          <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.18" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={fill} fill="url(#spark-fill)" />
        <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={(points.length - 1) * xStep} cy={toY(last)} r="3" fill={color} />
      </svg>
      <div className="flex justify-between text-[10px] font-mono text-muted-foreground/40 mt-1">
        <span>${min.toFixed(2)}</span>
        <span className={cn("font-semibold", trend >= 0 ? "text-emerald-400" : "text-red-400")}>
          {trend >= 0 ? "▲" : "▼"} ${Math.abs(trend).toFixed(2)}
        </span>
        <span>${max.toFixed(2)}</span>
      </div>
    </div>
  );
}

// ── Severity helpers ───────────────────────────────────────────────────────────

const sevBorder = (sev: string) =>
  sev === "critical" ? "border-red-500/30 bg-red-500/5" :
  sev === "high"     ? "border-orange-500/30 bg-orange-500/5" :
  sev === "warning"  ? "border-amber-500/30 bg-amber-500/5" :
                       "border-sky-500/30 bg-sky-500/5";
const sevText = (sev: string) =>
  sev === "critical" ? "text-red-400" : sev === "high" ? "text-orange-400" : sev === "warning" ? "text-amber-400" : "text-sky-400";

// ── Timeline sub-panel ─────────────────────────────────────────────────────────

function TimelinePanel({ entity }: { entity: string }) {
  const [win, setWin] = useState<'4' | '12' | '48'>('48');
  const windowMs = { '4': 4, '12': 12, '48': 48 }[win];

  const { data: tl, dataUpdatedAt, isFetching } = useQuery<EntityTimeline>({
    queryKey: ["/api/entity-timeline", entity, win],
    queryFn: () => fetch(`/api/entity-timeline?entity=${encodeURIComponent(entity)}&limit=40&window=${windowMs}`).then(r => r.json()),
    refetchInterval: 30_000,
  });

  const events = tl?.events ?? [];

  const kindMeta = {
    alert:    { icon: AlertTriangle, color: "text-rose-500",   bg: "bg-rose-500/[0.08] border-rose-500/20",    label: "ALERT"    },
    anomaly:  { icon: Zap,           color: "text-orange-500", bg: "bg-orange-500/[0.08] border-orange-500/20", label: "ANOMALY" },
    incident: { icon: BrainCircuit,  color: "text-violet-500", bg: "bg-violet-500/[0.08] border-violet-500/20", label: "INCIDENT"},
  } as const;

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <SectionLabel>System Health Timeline</SectionLabel>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-white/[0.06] overflow-hidden text-[9px] font-mono">
            {(['4', '12', '48'] as const).map(w => (
              <button key={w} onClick={() => setWin(w)}
                className={cn("px-2 py-0.5 transition-colors",
                  win === w ? "bg-white/10 text-white" : "text-muted-foreground/50 hover:text-muted-foreground")}>
                {w}h
              </button>
            ))}
          </div>
          <FreshnessIndicator updatedAt={dataUpdatedAt} intervalMs={30_000} isFetching={isFetching} />
        </div>
      </div>

      {!tl ? (
        <div className="flex items-center justify-center py-6 text-xs text-muted-foreground/40">Loading timeline…</div>
      ) : events.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-6 gap-2">
          <CheckCircle2 className="h-5 w-5 text-emerald-400/40" />
          <span className="text-xs text-muted-foreground/50">No events in the last {win}h for this entity</span>
        </div>
      ) : (
        <div className="space-y-1 max-h-80 overflow-y-auto pr-0.5">
          {events.map((ev, idx) => {
            const meta   = kindMeta[ev.kind];
            const KIcon  = meta.icon;
            const isLast = idx === events.length - 1;
            const tsDate = new Date(ev.ts);
            return (
              <div key={ev.id} className="flex gap-3">
                <div className="flex flex-col items-center flex-shrink-0 w-5">
                  <div className={cn("w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 border", meta.bg)}>
                    <KIcon className={cn("h-2.5 w-2.5", meta.color)} />
                  </div>
                  {!isLast && <div className="w-px flex-1 bg-white/[0.06] min-h-[8px] mt-0.5" />}
                </div>
                <div className="flex-1 pb-2 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={cn("text-[9px] font-bold uppercase tracking-widest font-mono", meta.color)}>{meta.label}</span>
                        <span className={cn("text-[9px] font-bold uppercase", sevText(ev.severity))}>{ev.severity}</span>
                        {ev.status !== "active" && (
                          <span className={cn("text-[9px] px-1 rounded font-mono",
                            ev.status === "resolved" ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400")}>
                            {ev.status}
                          </span>
                        )}
                      </div>
                      <p className="font-medium text-xs mt-0.5 leading-tight">{ev.title}</p>
                      {ev.detail && <p className="text-muted-foreground/60 text-[10px] truncate mt-0.5">{ev.detail}</p>}
                    </div>
                    <div className="flex-shrink-0 text-right">
                      <p className="text-[10px] font-mono text-muted-foreground/50 whitespace-nowrap">
                        {tsDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </p>
                      <p className="text-[9px] font-mono text-muted-foreground/30 whitespace-nowrap">
                        {tsDate.toLocaleDateString([], { month: "short", day: "numeric" })}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {tl.total > events.length && (
            <p className="text-[10px] text-muted-foreground/40 font-mono text-center pt-1">
              showing {events.length} of {tl.total} events
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

// ── Score bar ──────────────────────────────────────────────────────────────────

function ScoreBar({ value, max = 100 }: { value: number; max?: number }) {
  const pct   = Math.round((value / max) * 100);
  const color = pct >= 70 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono tabular-nums w-7 text-right">{value}</span>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function VendorProfilePage() {
  const [, params] = useRoute('/vendors/:name');
  const vendorName = decodeURIComponent(params?.name ?? '');
  const [pendingAlertId, setPendingAlertId] = useState<number | null>(null);

  const { data: balanceHistory, dataUpdatedAt: balUpdatedAt, isFetching: balFetching } = useQuery<BalanceHistory>({
    queryKey: ["/api/vendors/balance-history", vendorName],
    queryFn: () => fetch(`/api/vendors/balance-history?vendor=${encodeURIComponent(vendorName)}`).then(r => r.json()),
    refetchInterval: 60_000,
    enabled: !!vendorName,
  });

  const { data: cdrSummary, dataUpdatedAt: cdrUpdatedAt, isFetching: cdrFetching } = useQuery<CdrVendorSummary>({
    queryKey: ["/api/cdr-cache/vendor-summary", vendorName],
    queryFn: () => fetch(`/api/cdr-cache/vendor-summary?vendor=${encodeURIComponent(vendorName)}`).then(r => r.json()),
    refetchInterval: 120_000,
    enabled: !!vendorName,
  });

  const { data: alertsData = [], dataUpdatedAt: alertsUpdatedAt, isFetching: alertsFetching } = useQuery<Alert[]>({
    queryKey: ["/api/alerts"],
    refetchInterval: 20_000,
  });

  const { data: scores = [], dataUpdatedAt: scoresUpdatedAt, isFetching: scoresFetching } = useQuery<CarrierScore[]>({
    queryKey: ["/api/carrier-scores", 24],
    queryFn: () => fetch("/api/carrier-scores?window=24").then(r => r.json()),
    refetchInterval: 60_000,
  });

  const { data: anomalies = [] } = useQuery<AnomalyEvent[]>({
    queryKey: ["/api/anomalies"],
    refetchInterval: 30_000,
  });

  const { data: incidents = [], dataUpdatedAt: incUpdatedAt, isFetching: incFetching } = useQuery<AiOpsIncident[]>({
    queryKey: ["/api/aiops/incidents"],
    refetchInterval: 30_000,
  });

  const acknowledgeMutation = useMutation({
    mutationFn: (id: number) => { setPendingAlertId(id); return apiRequest("POST", `/api/alerts/${id}/acknowledge`); },
    onSettled: () => { setPendingAlertId(null); queryClient.invalidateQueries({ queryKey: ["/api/alerts"] }); },
  });
  const resolveMutation = useMutation({
    mutationFn: (id: number) => { setPendingAlertId(id); return apiRequest("POST", `/api/alerts/${id}/resolve`); },
    onSettled: () => { setPendingAlertId(null); queryClient.invalidateQueries({ queryKey: ["/api/alerts"] }); },
  });

  // Filter signals to this entity
  const matches = (f: string | null | undefined) =>
    !!f && (f.toLowerCase().includes(vendorName.toLowerCase()) || vendorName.toLowerCase().includes(f.toLowerCase()));

  const entityAlerts    = alertsData.filter(a => matches((a as any).vendor) || matches((a as any).connection) || matches(a.message));
  const openAlerts      = entityAlerts.filter(a => !a.resolved && !a.acknowledgedAt);
  const ackedAlerts     = entityAlerts.filter(a => !a.resolved && !!a.acknowledgedAt);
  const entityScore     = scores.find(s => matches(s.carrierName) || matches(s.carrierId));
  const entityIncidents = incidents.filter(i => matches(i.entityName));
  const entityAnomalies = anomalies.filter(a => matches(a.vendor) || matches(a.title));

  const activeIncidents = entityIncidents.filter(i => i.status === "active" || i.status === "open");
  const activeAnomalies = entityAnomalies.filter(a => !a.resolvedAt);

  // Health verdict
  let penalty = 0;
  if (entityScore) {
    const s = entityScore.stabilityScore ?? 0;
    if (s < 50) penalty += 40; else if (s < 75) penalty += 20;
    const asr = entityScore.rollingAsr ?? 0;
    if (asr < 30) penalty += 30; else if (asr < 50) penalty += 15;
  }
  penalty += Math.min(activeIncidents.filter(i => i.severity === "critical" || i.severity === "high").length * 35, 70);
  penalty += Math.min(openAlerts.length * 10, 30);
  penalty += Math.min(activeAnomalies.length * 8, 20);
  const healthScore = Math.max(0, 100 - penalty);
  const healthLevel = healthScore >= 70 ? "green" : healthScore >= 40 ? "amber" : "red";
  const healthCfg = {
    green: { bg: "bg-emerald-500/10 border-emerald-500/30", dot: "bg-emerald-400", text: "text-emerald-400", label: "HEALTHY" },
    amber: { bg: "bg-amber-500/10 border-amber-500/30",   dot: "bg-amber-400",   text: "text-amber-400",   label: "DEGRADED" },
    red:   { bg: "bg-red-500/10 border-red-500/30",       dot: "bg-red-400",     text: "text-red-400",     label: "CRITICAL" },
  }[healthLevel];

  if (!vendorName) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <p className="text-muted-foreground">No vendor specified.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5 max-w-5xl mx-auto">
      {/* Back nav */}
      <div className="flex items-center gap-3">
        <Link href="/ops-console">
          <a className="flex items-center gap-1.5 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors font-mono">
            <ArrowLeft className="h-3 w-3" /> Ops Console
          </a>
        </Link>
        <span className="text-muted-foreground/20 text-xs">/</span>
        <span className="text-xs font-mono text-muted-foreground/50">Vendor Profile</span>
      </div>

      {/* Entity header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{vendorName}</h1>
          <p className="text-xs text-muted-foreground/60 font-mono mt-0.5">vendor entity · real-time signal feed</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link href={`/ops-console?entity=${encodeURIComponent(vendorName)}`}>
            <a className="flex items-center gap-1.5 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors border border-white/[0.06] rounded-lg px-3 py-1.5">
              <ExternalLink className="h-3 w-3" /> Ops Console deep-dive
            </a>
          </Link>
          <Link href="/alerts">
            <a className="flex items-center gap-1.5 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors border border-white/[0.06] rounded-lg px-3 py-1.5">
              <AlertTriangle className="h-3 w-3" /> All Alerts
            </a>
          </Link>
        </div>
      </div>

      {/* Health verdict bar */}
      <div className={cn("rounded-xl border p-4 flex items-center gap-4", healthCfg.bg)}>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="relative inline-flex">
            <span className={cn("absolute rounded-full animate-ping opacity-60", healthCfg.dot)} style={{ width: 10, height: 10 }} />
            <span className={cn("relative rounded-full", healthCfg.dot)} style={{ width: 10, height: 10 }} />
          </span>
          <span className={cn("text-sm font-bold font-mono tracking-widest", healthCfg.text)}>{healthCfg.label}</span>
        </div>
        <div className="w-px h-6 bg-white/10 flex-shrink-0" />
        <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="text-center">
            <p className="text-[9px] uppercase tracking-widest text-muted-foreground/50 font-mono">Open Alerts</p>
            <p className={cn("text-lg font-bold font-mono tabular-nums", openAlerts.length > 0 ? "text-red-400" : "text-emerald-400")}>{openAlerts.length}</p>
          </div>
          <div className="text-center">
            <p className="text-[9px] uppercase tracking-widest text-muted-foreground/50 font-mono">Incidents</p>
            <p className={cn("text-lg font-bold font-mono tabular-nums", activeIncidents.length > 0 ? "text-orange-400" : "text-emerald-400")}>{activeIncidents.length}</p>
          </div>
          <div className="text-center">
            <p className="text-[9px] uppercase tracking-widest text-muted-foreground/50 font-mono">Anomalies</p>
            <p className={cn("text-lg font-bold font-mono tabular-nums", activeAnomalies.length > 0 ? "text-amber-400" : "text-emerald-400")}>{activeAnomalies.length}</p>
          </div>
          <div className="text-center">
            <p className="text-[9px] uppercase tracking-widest text-muted-foreground/50 font-mono">Health</p>
            <p className={cn("text-lg font-bold font-mono tabular-nums", healthCfg.text)}>{healthScore}</p>
          </div>
        </div>
      </div>

      {/* 2-column grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Balance sparkline */}
        <Card>
          <FreshnessRow label="Balance History" updatedAt={balUpdatedAt} intervalMs={60_000} isFetching={balFetching} />
          {!balanceHistory ? (
            <div className="h-12 flex items-center justify-center text-xs text-muted-foreground/40">Loading…</div>
          ) : balanceHistory.points.length === 0 ? (
            <div className="h-12 flex items-center justify-center text-xs text-muted-foreground/40">No balance history recorded yet</div>
          ) : (
            <>
              <Sparkline points={balanceHistory.points} />
              <div className="mt-2 flex items-center justify-between text-[10px] font-mono text-muted-foreground/40">
                <span>{balanceHistory.count} snapshots</span>
                <span>
                  Current: <span className={cn("font-bold",
                    (balanceHistory.points[balanceHistory.points.length - 1]?.balance ?? 0) < 10 ? "text-red-400" :
                    (balanceHistory.points[balanceHistory.points.length - 1]?.balance ?? 0) < 50 ? "text-amber-400" : "text-emerald-400")}>
                    ${(balanceHistory.points[balanceHistory.points.length - 1]?.balance ?? 0).toFixed(2)}
                  </span>
                </span>
              </div>
            </>
          )}
        </Card>

        {/* Carrier score */}
        <Card>
          <FreshnessRow label="Carrier Scoring" updatedAt={scoresUpdatedAt} intervalMs={60_000} isFetching={scoresFetching} />
          {!entityScore ? (
            <div className="flex items-center justify-center py-4 text-xs text-muted-foreground/40">No score data for this entity</div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-xs">
                {[
                  { label: "Stability Score", value: entityScore.stabilityScore ?? 0, isScore: true },
                  { label: "Rolling ASR",     value: entityScore.rollingAsr ?? 0,    isScore: false, suffix: "%" },
                ].map(({ label, value, isScore, suffix }) => (
                  <div key={label}>
                    <p className="text-[9px] uppercase tracking-widest text-muted-foreground/50 font-mono mb-1">{label}</p>
                    {isScore ? <ScoreBar value={Math.round(value)} /> : (
                      <p className={cn("font-bold tabular-nums font-mono text-sm",
                        value >= 70 ? "text-emerald-400" : value >= 40 ? "text-amber-400" : "text-red-400")}>
                        {value.toFixed(1)}{suffix}
                      </p>
                    )}
                  </div>
                ))}
                <div>
                  <p className="text-[9px] uppercase tracking-widest text-muted-foreground/50 font-mono mb-1">Avg PDD</p>
                  <p className="text-sm font-mono tabular-nums">{entityScore.avgPddMs != null ? `${entityScore.avgPddMs}ms` : "—"}</p>
                </div>
                <div>
                  <p className="text-[9px] uppercase tracking-widest text-muted-foreground/50 font-mono mb-1">Samples</p>
                  <p className="text-sm font-mono tabular-nums">{entityScore.sampleCount}</p>
                </div>
              </div>
              {entityScore.trend && (
                <div className="text-[10px] font-mono text-muted-foreground/40">
                  Trend: <span className={cn("font-semibold",
                    entityScore.trend === "up" ? "text-emerald-400" : entityScore.trend === "down" ? "text-red-400" : "text-muted-foreground/60")}>
                    {entityScore.trend}
                  </span>
                </div>
              )}
            </div>
          )}
        </Card>

        {/* CDR breakdown */}
        <Card>
          <FreshnessRow label="CDR Destination Breakdown" updatedAt={cdrUpdatedAt} intervalMs={120_000} isFetching={cdrFetching} />
          {!cdrSummary ? (
            <div className="text-xs text-muted-foreground/40 text-center py-4">Loading CDR cache…</div>
          ) : cdrSummary.rows.length === 0 ? (
            <div className="text-xs text-muted-foreground/40 text-center py-4">No CDRs found for this vendor</div>
          ) : (
            <div className="space-y-1">
              <div className="grid grid-cols-5 gap-1 text-[9px] uppercase tracking-wider text-muted-foreground/40 font-mono px-1 pb-1 border-b border-white/[0.04]">
                <span>Prefix</span><span className="text-right">Calls</span>
                <span className="text-right">ASR%</span><span className="text-right">ACD(s)</span>
                <span className="text-right">Mins</span>
              </div>
              <div className="space-y-0.5 max-h-48 overflow-y-auto">
                {cdrSummary.rows.map(row => (
                  <div key={row.prefix} className="grid grid-cols-5 gap-1 text-xs px-1 py-1 rounded hover:bg-white/[0.03] transition-colors">
                    <span className="font-mono text-muted-foreground">+{row.prefix}</span>
                    <span className="text-right tabular-nums">{row.calls}</span>
                    <span className={cn("text-right tabular-nums font-semibold",
                      row.asr >= 50 ? "text-emerald-400" : row.asr >= 30 ? "text-amber-400" : "text-red-400")}>
                      {row.asr}%
                    </span>
                    <span className="text-right tabular-nums text-muted-foreground">{row.acd}s</span>
                    <span className="text-right tabular-nums text-muted-foreground">{row.minutes}</span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground/30 font-mono pt-1">
                {cdrSummary.totalCdrs} CDR{cdrSummary.totalCdrs !== 1 ? "s" : ""} · cache {cdrSummary.cacheSize}
              </p>
            </div>
          )}
        </Card>

        {/* Active alerts */}
        <Card>
          <FreshnessRow label="Entity Alerts" updatedAt={alertsUpdatedAt} intervalMs={20_000} isFetching={alertsFetching} />
          {entityAlerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-4 gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-400/40" />
              <span className="text-xs text-muted-foreground/50">No alerts for this entity</span>
            </div>
          ) : (
            <div className="space-y-2 max-h-52 overflow-y-auto pr-0.5">
              {entityAlerts.filter(a => !a.resolved).map(alert => (
                <div key={alert.id} className={cn("rounded-lg border p-2.5 text-xs", sevBorder(alert.severity))}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={cn("text-[9px] font-bold uppercase tracking-widest font-mono", sevText(alert.severity))}>
                          {alert.severity}
                        </span>
                        {!!alert.acknowledgedAt && (
                          <span className="text-[9px] bg-amber-500/15 text-amber-400 px-1 rounded font-mono">acked</span>
                        )}
                      </div>
                      <p className="font-medium mt-0.5 leading-tight">{alert.type.split("_").join(" ").toUpperCase()}</p>
                      <p className="text-muted-foreground/60 text-[10px] truncate mt-0.5">{alert.message}</p>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      {!alert.acknowledgedAt && (
                        <button
                          data-testid={`vp-ack-${alert.id}`}
                          disabled={pendingAlertId === alert.id}
                          onClick={() => acknowledgeMutation.mutate(alert.id)}
                          className="p-1 rounded hover:bg-white/10 text-amber-400/70 hover:text-amber-400 disabled:opacity-40 transition-colors"
                          title="Acknowledge"
                        >
                          <Clock className="h-3 w-3" />
                        </button>
                      )}
                      <button
                        data-testid={`vp-resolve-${alert.id}`}
                        disabled={pendingAlertId === alert.id}
                        onClick={() => resolveMutation.mutate(alert.id)}
                        className="p-1 rounded hover:bg-white/10 text-emerald-400/70 hover:text-emerald-400 disabled:opacity-40 transition-colors"
                        title="Resolve"
                      >
                        <CheckCircle2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {(openAlerts.length > 0 || ackedAlerts.length > 0) && (
            <div className="flex items-center gap-3 pt-2 text-[10px] font-mono text-muted-foreground/40">
              {openAlerts.length > 0 && <span className="text-red-400">{openAlerts.length} open</span>}
              {ackedAlerts.length > 0 && <span className="text-amber-400">{ackedAlerts.length} acked</span>}
            </div>
          )}
        </Card>
      </div>

      {/* Full-width timeline */}
      <TimelinePanel entity={vendorName} />

      {/* Active incidents */}
      {activeIncidents.length > 0 && (
        <Card>
          <FreshnessRow label="Active AI Ops Incidents" updatedAt={incUpdatedAt} intervalMs={30_000} isFetching={incFetching} />
          <div className="space-y-2">
            {activeIncidents.map(inc => (
              <div key={inc.id} className={cn("rounded-lg border p-2.5 text-xs", sevBorder(inc.severity))}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className={cn("text-[9px] font-bold uppercase tracking-widest font-mono", sevText(inc.severity))}>{inc.severity}</span>
                    <p className="font-medium mt-0.5">{inc.title}</p>
                    {inc.entityName && <p className="text-muted-foreground/60 text-[10px] mt-0.5">{inc.entityName} · {inc.signalCount} signals</p>}
                  </div>
                  <span className="flex-shrink-0 text-[9px] font-mono bg-red-500/15 text-red-400 px-1.5 py-0.5 rounded">{inc.status}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Footer links */}
      <div className="flex flex-wrap gap-2 pt-1 border-t border-white/[0.04]">
        <span className="text-xs text-muted-foreground/40 font-mono mr-2">Related</span>
        {[
          { href: "/carrier-scoring",    label: "Carrier Scoring" },
          { href: "/carrier-intelligence", label: "Carrier Intelligence" },
          { href: "/cdrs",               label: "CDRs" },
          { href: "/ai-ops",             label: "AI Ops" },
          { href: "/alerts",             label: "All Alerts" },
        ].map(({ href, label }) => (
          <Link key={href} href={href}>
            <a className="text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors font-mono flex items-center gap-1">
              <ArrowRight className="h-2.5 w-2.5" />{label}
            </a>
          </Link>
        ))}
      </div>
    </div>
  );
}
