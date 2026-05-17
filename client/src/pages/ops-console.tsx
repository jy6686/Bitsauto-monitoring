import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Activity, AlertTriangle, CheckCircle2, XCircle, Shield, Zap,
  Phone, BrainCircuit, TrendingUp, TrendingDown, Minus, ArrowRight,
  RefreshCw, ChevronDown, Eye, ShieldCheck, DollarSign, BarChart2,
  Clock, GitMerge,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { FreshnessIndicator } from "@/components/freshness-indicator";
import { Alert } from "@shared/schema";

// ── Types ──────────────────────────────────────────────────────────────────────

interface CarrierScore {
  id?: number; carrierId: string; carrierName: string;
  stabilityScore: number | null; rollingAsr: number | null;
  avgPddMs: number | null; trend: string | null;
  sampleCount: number; failureRate: number | null;
}
interface VendorBalance { name: string; balance: number; }
interface VendorBalanceSnapshot { vendors: VendorBalance[]; ts: string | null; }
interface AiOpsIncident {
  id: number; severity: string; title: string; status: string;
  entityName: string | null; signalCount: number; createdAt: string;
}
interface AnomalyEvent {
  id: number; vendor: string | null; metric: string; severity: string;
  title: string; description: string; resolved: boolean;
  resolvedAt: string | null; detectedAt: string;
}
interface LiveCallsResponse {
  calls: Array<{ vendor?: string; connection?: string; callStatus?: string; }>;
  connected?: boolean; stale?: boolean;
}
interface BalancePoint { ts: number; balance: number; }
interface BalanceHistory { vendor: string; points: BalancePoint[]; count: number; }
interface CdrDestRow {
  prefix: string; calls: number; answered: number;
  asr: number; acd: number; minutes: number; avgPddMs: number; cost: number;
}
interface CdrVendorSummary { vendor: string; rows: CdrDestRow[]; totalCdrs: number; cacheSize: number; }
interface TimelineEvent {
  id: string; kind: 'alert' | 'anomaly' | 'incident';
  ts: string; title: string; severity: string;
  entity: string | null; status: string; detail?: string;
}
interface EntityTimeline { entity: string; events: TimelineEvent[]; total: number; }

// ── Verdict logic ──────────────────────────────────────────────────────────────

type VerdictLevel = "green" | "amber" | "red";

interface VerdictResult {
  level: VerdictLevel;
  score: number;
  reasons: string[];
}

function computeVerdict(
  score: CarrierScore | undefined,
  openAlerts: Alert[],
  activeIncidents: AiOpsIncident[],
  activeAnomalies: AnomalyEvent[],
  liveCalls: number,
): VerdictResult {
  const reasons: string[] = [];
  let penalty = 0;

  if (score) {
    const s = score.stabilityScore ?? 0;
    if (s < 50)  { penalty += 40; reasons.push(`Stability score critical (${s})`); }
    else if (s < 75) { penalty += 20; reasons.push(`Stability score degraded (${s})`); }
    const asr = score.rollingAsr ?? 0;
    if (asr < 30)  { penalty += 30; reasons.push(`ASR very low (${asr}%)`); }
    else if (asr < 50) { penalty += 15; reasons.push(`ASR below threshold (${asr}%)`); }
  }

  const criticalIncidents = activeIncidents.filter(i => i.severity === "critical" || i.severity === "high");
  if (criticalIncidents.length > 0) {
    penalty += 35 * Math.min(criticalIncidents.length, 2);
    reasons.push(`${criticalIncidents.length} critical/high incident${criticalIncidents.length > 1 ? "s" : ""}`);
  } else if (activeIncidents.length > 0) {
    penalty += 15;
    reasons.push(`${activeIncidents.length} active incident${activeIncidents.length > 1 ? "s" : ""}`);
  }

  if (openAlerts.length > 0) {
    penalty += Math.min(openAlerts.length * 10, 30);
    reasons.push(`${openAlerts.length} open alert${openAlerts.length > 1 ? "s" : ""}`);
  }

  if (activeAnomalies.length > 0) {
    penalty += Math.min(activeAnomalies.length * 8, 20);
    reasons.push(`${activeAnomalies.length} active anomal${activeAnomalies.length > 1 ? "ies" : "y"}`);
  }

  const finalScore = Math.max(0, 100 - penalty);
  const level: VerdictLevel = finalScore >= 70 ? "green" : finalScore >= 40 ? "amber" : "red";

  if (reasons.length === 0) {
    if (liveCalls > 0) reasons.push(`${liveCalls} active call${liveCalls > 1 ? "s" : ""}, all signals clear`);
    else reasons.push("All signals clear — no active calls");
  }

  return { level, score: finalScore, reasons };
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function VerdictBar({ verdict, entity }: { verdict: VerdictResult; entity: string }) {
  const cfg = {
    green: { bg: "bg-emerald-500/10 border-emerald-500/30", dot: "bg-emerald-400", text: "text-emerald-400", label: "HEALTHY" },
    amber: { bg: "bg-amber-500/10 border-amber-500/30",   dot: "bg-amber-400",   text: "text-amber-400",   label: "DEGRADED" },
    red:   { bg: "bg-red-500/10 border-red-500/30",       dot: "bg-red-400",     text: "text-red-400",     label: "CRITICAL" },
  }[verdict.level];

  return (
    <div className={cn("rounded-xl border p-4 flex items-center gap-4", cfg.bg)}>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className={cn("relative inline-flex")}>
          <span className={cn("absolute rounded-full animate-ping opacity-60", cfg.dot)} style={{ width: 10, height: 10 }} />
          <span className={cn("relative rounded-full", cfg.dot)} style={{ width: 10, height: 10 }} />
        </span>
        <span className={cn("text-sm font-bold font-mono tracking-widest", cfg.text)}>{cfg.label}</span>
      </div>
      <div className="w-px h-6 bg-white/10 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className={cn("text-sm font-semibold truncate", cfg.text)}>
          {entity === "__all__" ? "System-wide" : entity}
          <span className="text-muted-foreground font-normal ml-2">— {verdict.reasons[0]}</span>
        </p>
        {verdict.reasons.length > 1 && (
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            Also: {verdict.reasons.slice(1).join(" · ")}
          </p>
        )}
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <span className="text-xs text-muted-foreground font-mono">Health</span>
        <span className={cn("text-lg font-bold font-mono tabular-nums", cfg.text)}>{verdict.score}</span>
      </div>
    </div>
  );
}

function SignalPanel({
  title, count, status, children, updatedAt, intervalMs, isFetching,
}: {
  title: string; count?: number; status?: "ok" | "warn" | "crit";
  children: React.ReactNode; updatedAt?: number; intervalMs?: number; isFetching?: boolean;
}) {
  const border = status === "crit" ? "border-red-500/30" : status === "warn" ? "border-amber-500/20" : "border-white/[0.06]";
  const countCls = status === "crit" ? "bg-red-500/20 text-red-400" : status === "warn" ? "bg-amber-500/20 text-amber-400" : "bg-emerald-500/20 text-emerald-400";
  return (
    <div className={cn("rounded-xl border bg-white/[0.02] p-4 flex flex-col gap-3", border)}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground/50">{title}</span>
        <div className="flex items-center gap-2">
          {count !== undefined && (
            <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-full", countCls)}>
              {count}
            </span>
          )}
          {updatedAt != null && intervalMs != null && (
            <FreshnessIndicator updatedAt={updatedAt} intervalMs={intervalMs} isFetching={isFetching} />
          )}
        </div>
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-6 gap-2">
      <CheckCircle2 className="h-6 w-6 text-emerald-400/40" />
      <span className="text-xs text-muted-foreground/50">{label}</span>
    </div>
  );
}

function ScoreBar({ value, max = 100 }: { value: number; max?: number }) {
  const pct = Math.round((value / max) * 100);
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

export default function OpsConsolePage() {
  const [selectedEntity, setSelectedEntity] = useState<string>("__all__");

  const { data: balances, dataUpdatedAt: balUpdatedAt, isFetching: balFetching } = useQuery<VendorBalanceSnapshot>({
    queryKey: ["/api/vendors/current-balances"],
    refetchInterval: 60_000,
  });

  const { data: scores = [], dataUpdatedAt: scoresUpdatedAt, isFetching: scoresFetching } = useQuery<CarrierScore[]>({
    queryKey: ["/api/carrier-scores", 24],
    queryFn: () => fetch("/api/carrier-scores?window=24").then(r => r.json()),
    refetchInterval: 60_000,
  });

  const { data: alertsData = [], dataUpdatedAt: alertsUpdatedAt, isFetching: alertsFetching } = useQuery<Alert[]>({
    queryKey: ["/api/alerts"],
    refetchInterval: 20_000,
  });

  const { data: anomalies = [], dataUpdatedAt: anomaliesUpdatedAt, isFetching: anomaliesFetching } = useQuery<AnomalyEvent[]>({
    queryKey: ["/api/anomalies"],
    refetchInterval: 30_000,
  });

  const { data: incidents = [], dataUpdatedAt: incidentsUpdatedAt, isFetching: incidentsFetching } = useQuery<AiOpsIncident[]>({
    queryKey: ["/api/aiops/incidents"],
    refetchInterval: 30_000,
  });

  const { data: liveData, dataUpdatedAt: liveUpdatedAt, isFetching: liveFetching } = useQuery<LiveCallsResponse>({
    queryKey: ["/api/sippy/live-calls"],
    refetchInterval: 15_000,
  });

  const { data: balanceHistory, dataUpdatedAt: balHistUpdatedAt, isFetching: balHistFetching } = useQuery<BalanceHistory>({
    queryKey: ["/api/vendors/balance-history", selectedEntity],
    queryFn: () => fetch(`/api/vendors/balance-history?vendor=${encodeURIComponent(selectedEntity)}`).then(r => r.json()),
    enabled: !isAll,
    refetchInterval: 60_000,
  });

  const { data: cdrSummary, dataUpdatedAt: cdrUpdatedAt, isFetching: cdrFetching } = useQuery<CdrVendorSummary>({
    queryKey: ["/api/cdr-cache/vendor-summary", selectedEntity],
    queryFn: () => fetch(`/api/cdr-cache/vendor-summary?vendor=${encodeURIComponent(selectedEntity)}`).then(r => r.json()),
    enabled: !isAll,
    refetchInterval: 120_000,
  });

  const { data: timeline, dataUpdatedAt: timelineUpdatedAt, isFetching: timelineFetching } = useQuery<EntityTimeline>({
    queryKey: ["/api/entity-timeline", selectedEntity],
    queryFn: () => fetch(`/api/entity-timeline?entity=${encodeURIComponent(selectedEntity)}&limit=40`).then(r => r.json()),
    enabled: !isAll,
    refetchInterval: 30_000,
  });

  const acknowledgeMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/alerts/${id}/acknowledge`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/alerts"] }),
  });
  const resolveMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/alerts/${id}/resolve`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/alerts"] }),
  });

  // Build entity list from vendor balances + carrier scores, deduplicated
  const entityList = useMemo(() => {
    const names = new Set<string>();
    (balances?.vendors ?? []).forEach(v => names.add(v.name));
    scores.forEach(s => { if (s.carrierName) names.add(s.carrierName); });
    return Array.from(names).sort();
  }, [balances, scores]);

  // Match helper — fuzzy case-insensitive
  const matches = (field: string | null | undefined, entity: string) => {
    if (!field) return false;
    return field.toLowerCase().includes(entity.toLowerCase()) ||
           entity.toLowerCase().includes(field.toLowerCase());
  };

  const isAll = selectedEntity === "__all__";

  // Filtered signal sets
  const liveCalls = useMemo(() => {
    const calls = liveData?.calls ?? [];
    if (isAll) return calls;
    return calls.filter(c => matches(c.vendor, selectedEntity) || matches(c.connection, selectedEntity));
  }, [liveData, selectedEntity, isAll]);

  // Alert match: prefer structured vendor/connection fields, fall back to message fuzzy
  const alertMatches = (a: Alert, entity: string) =>
    matches((a as any).vendor, entity) ||
    matches((a as any).connection, entity) ||
    matches(a.message, entity);

  const openAlerts = useMemo(() => {
    const open = alertsData.filter(a => !a.resolved && !a.acknowledgedAt);
    if (isAll) return open;
    return open.filter(a => alertMatches(a, selectedEntity));
  }, [alertsData, selectedEntity, isAll]);

  const ackedAlerts = useMemo(() => {
    const acked = alertsData.filter(a => !a.resolved && a.acknowledgedAt);
    if (isAll) return acked;
    return acked.filter(a => alertMatches(a, selectedEntity));
  }, [alertsData, selectedEntity, isAll]);

  const activeAnomalies = useMemo(() => {
    const active = anomalies.filter(a => !a.resolved);
    if (isAll) return active;
    return active.filter(a => matches(a.vendor, selectedEntity));
  }, [anomalies, selectedEntity, isAll]);

  const activeIncidents = useMemo(() => {
    const active = incidents.filter(i => i.status === "active" || i.status === "open");
    if (isAll) return active;
    return active.filter(i => matches(i.entityName, selectedEntity));
  }, [incidents, selectedEntity, isAll]);

  const entityScore = useMemo(() => {
    if (isAll) return undefined;
    return scores.find(s => matches(s.carrierName, selectedEntity) || matches(s.carrierId, selectedEntity));
  }, [scores, selectedEntity, isAll]);

  const entityBalance = useMemo(() => {
    if (isAll) return null;
    return balances?.vendors.find(v => v.name.toLowerCase() === selectedEntity.toLowerCase()) ?? null;
  }, [balances, selectedEntity, isAll]);

  const verdict = useMemo(() =>
    computeVerdict(entityScore, openAlerts, activeIncidents, activeAnomalies, liveCalls.length),
    [entityScore, openAlerts, activeIncidents, activeAnomalies, liveCalls]
  );

  const alertStatus = (a: Alert): "active" | "acknowledged" | "resolved" =>
    a.resolved ? "resolved" : a.acknowledgedAt ? "acknowledged" : "active";

  const connectedCalls = liveCalls.filter(c => c.callStatus === "connected" || c.ccState === "connected");

  return (
    <div className="space-y-5 max-w-[1400px]">
      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="h-6 w-6 text-cyan-400" />
            Ops Console
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Correlated signal view — all monitoring sources for a single entity in one place
          </p>
        </div>

        {/* Entity selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Entity</span>
          <div className="relative">
            <select
              data-testid="select-entity"
              value={selectedEntity}
              onChange={e => setSelectedEntity(e.target.value)}
              className="appearance-none bg-card border border-border rounded-lg pl-3 pr-8 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer min-w-[200px]"
            >
              <option value="__all__">All entities</option>
              {entityList.map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          </div>
          {!isAll && entityBalance && (
            <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-card text-xs">
              <span className="text-muted-foreground">Balance</span>
              <span className={cn("font-bold tabular-nums", entityBalance.balance < 10 ? "text-red-400" : entityBalance.balance < 50 ? "text-amber-400" : "text-emerald-400")}>
                ${entityBalance.balance.toFixed(2)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Verdict bar */}
      <VerdictBar verdict={verdict} entity={selectedEntity} />

      {/* Signal grid — 5 columns on large screens */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">

        {/* ── Live Traffic ── */}
        <SignalPanel
          title="Live Traffic"
          count={liveCalls.length}
          status={liveCalls.length > 0 ? "ok" : undefined}
          updatedAt={liveUpdatedAt}
          intervalMs={15_000}
          isFetching={liveFetching}
        >
          {liveCalls.length === 0 ? (
            <EmptyState label="No active calls" />
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "Active", value: liveCalls.length, color: "text-cyan-400" },
                  { label: "Connected", value: connectedCalls.length, color: "text-emerald-400" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="bg-white/[0.03] rounded-lg p-2.5 text-center">
                    <div className={cn("text-xl font-bold tabular-nums", color)}>{value}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{label}</div>
                  </div>
                ))}
              </div>
              {!isAll && (
                <div className="space-y-1 max-h-28 overflow-y-auto">
                  {liveCalls.slice(0, 6).map((c, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-[11px]">
                      <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0",
                        c.callStatus === "connected" || c.ccState === "connected" ? "bg-emerald-400" : "bg-amber-400")} />
                      <span className="text-muted-foreground truncate font-mono">{c.connection ?? c.vendor ?? "—"}</span>
                    </div>
                  ))}
                </div>
              )}
              <Link href="/live-traffic">
                <a className="flex items-center gap-1 text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors font-mono">
                  <ArrowRight className="h-3 w-3" /> Live Traffic
                </a>
              </Link>
            </div>
          )}
        </SignalPanel>

        {/* ── Open Alerts ── */}
        <SignalPanel
          title="Alerts"
          count={openAlerts.length + ackedAlerts.length}
          status={openAlerts.length > 0 ? "crit" : ackedAlerts.length > 0 ? "warn" : undefined}
          updatedAt={alertsUpdatedAt}
          intervalMs={20_000}
          isFetching={alertsFetching}
        >
          {openAlerts.length === 0 && ackedAlerts.length === 0 ? (
            <EmptyState label="No open alerts" />
          ) : (
            <div className="space-y-1.5 max-h-44 overflow-y-auto">
              {[...openAlerts, ...ackedAlerts].slice(0, 8).map(alert => {
                const st = alertStatus(alert);
                return (
                  <div key={alert.id}
                    className={cn("flex items-start gap-2 p-2 rounded-lg border text-xs",
                      st === "active" ? "bg-red-500/8 border-red-500/20" : "bg-amber-500/8 border-amber-500/20"
                    )}>
                    <AlertTriangle className={cn("h-3 w-3 flex-shrink-0 mt-0.5",
                      st === "active" ? "text-red-400" : "text-amber-400")} />
                    <p className="flex-1 text-muted-foreground leading-tight line-clamp-2">{alert.message}</p>
                    <div className="flex flex-col gap-1 flex-shrink-0">
                      {st === "active" && (
                        <button
                          data-testid={`ack-alert-${alert.id}`}
                          onClick={() => acknowledgeMutation.mutate(alert.id)}
                          className="text-[9px] text-amber-400 hover:text-amber-300 transition-colors font-mono uppercase"
                        >ACK</button>
                      )}
                      <button
                        data-testid={`resolve-alert-${alert.id}`}
                        onClick={() => resolveMutation.mutate(alert.id)}
                        className="text-[9px] text-emerald-400 hover:text-emerald-300 transition-colors font-mono uppercase"
                      >RESOLVE</button>
                    </div>
                  </div>
                );
              })}
              <Link href="/alerts">
                <a className="flex items-center gap-1 text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors font-mono mt-1">
                  <ArrowRight className="h-3 w-3" /> All alerts
                </a>
              </Link>
            </div>
          )}
        </SignalPanel>

        {/* ── Carrier Score ── */}
        <SignalPanel
          title="Carrier Score"
          count={isAll ? scores.length : entityScore ? 1 : undefined}
          status={entityScore ? (entityScore.stabilityScore ?? 0) >= 70 ? "ok" : (entityScore.stabilityScore ?? 0) >= 40 ? "warn" : "crit" : undefined}
          updatedAt={scoresUpdatedAt}
          intervalMs={60_000}
          isFetching={scoresFetching}
        >
          {isAll ? (
            <div className="space-y-2 max-h-44 overflow-y-auto">
              {scores.length === 0 ? <EmptyState label="No scores yet" /> : scores.slice(0, 6).map(s => (
                <div key={s.carrierId} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground truncate font-mono">{s.carrierName}</span>
                    <span className={cn("text-[10px] font-bold",
                      (s.stabilityScore ?? 0) >= 70 ? "text-emerald-400" : (s.stabilityScore ?? 0) >= 40 ? "text-amber-400" : "text-red-400")}>
                      {s.stabilityScore ?? "—"}
                    </span>
                  </div>
                  <ScoreBar value={s.stabilityScore ?? 0} />
                </div>
              ))}
            </div>
          ) : entityScore ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "Stability", value: entityScore.stabilityScore ?? 0, color: (entityScore.stabilityScore ?? 0) >= 70 ? "text-emerald-400" : (entityScore.stabilityScore ?? 0) >= 40 ? "text-amber-400" : "text-red-400" },
                  { label: "ASR %", value: entityScore.rollingAsr ?? 0, color: (entityScore.rollingAsr ?? 0) >= 50 ? "text-emerald-400" : (entityScore.rollingAsr ?? 0) >= 30 ? "text-amber-400" : "text-red-400" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="bg-white/[0.03] rounded-lg p-2.5 text-center">
                    <div className={cn("text-xl font-bold tabular-nums", color)}>{value}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{label}</div>
                  </div>
                ))}
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground mb-1">Stability score</div>
                <ScoreBar value={entityScore.stabilityScore ?? 0} />
              </div>
              {entityScore.avgPddMs && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Avg PDD</span>
                  <span className={cn("font-mono tabular-nums",
                    entityScore.avgPddMs > 5000 ? "text-red-400" : entityScore.avgPddMs > 2000 ? "text-amber-400" : "text-emerald-400")}>
                    {(entityScore.avgPddMs / 1000).toFixed(1)}s
                  </span>
                </div>
              )}
              {entityScore.trend && (
                <div className="flex items-center gap-1 text-xs">
                  {entityScore.trend === "up" ? <TrendingUp className="h-3 w-3 text-emerald-400" /> :
                   entityScore.trend === "down" ? <TrendingDown className="h-3 w-3 text-red-400" /> :
                   <Minus className="h-3 w-3 text-muted-foreground" />}
                  <span className="text-muted-foreground capitalize">{entityScore.trend} trend</span>
                </div>
              )}
              <Link href="/carrier-scoring">
                <a className="flex items-center gap-1 text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors font-mono">
                  <ArrowRight className="h-3 w-3" /> Carrier Scoring
                </a>
              </Link>
            </div>
          ) : (
            <EmptyState label="No score data for this entity" />
          )}
        </SignalPanel>

        {/* ── Anomalies ── */}
        <SignalPanel
          title="Anomalies"
          count={activeAnomalies.length}
          status={activeAnomalies.length > 0 ? (activeAnomalies.some(a => a.severity === "critical") ? "crit" : "warn") : undefined}
          updatedAt={anomaliesUpdatedAt}
          intervalMs={30_000}
          isFetching={anomaliesFetching}
        >
          {activeAnomalies.length === 0 ? (
            <EmptyState label="No active anomalies" />
          ) : (
            <div className="space-y-1.5 max-h-44 overflow-y-auto">
              {activeAnomalies.slice(0, 6).map(a => (
                <div key={a.id}
                  className={cn("p-2 rounded-lg border text-xs",
                    a.severity === "critical" ? "bg-red-500/8 border-red-500/20" :
                    a.severity === "high" ? "bg-orange-500/8 border-orange-500/20" :
                    "bg-yellow-500/8 border-yellow-500/20")}>
                  <p className="font-medium truncate">{a.title}</p>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-muted-foreground font-mono truncate">{a.metric}</span>
                    <span className={cn("text-[9px] font-bold uppercase",
                      a.severity === "critical" ? "text-red-400" : a.severity === "high" ? "text-orange-400" : "text-yellow-400")}>
                      {a.severity}
                    </span>
                  </div>
                </div>
              ))}
              <Link href="/ai-ops">
                <a className="flex items-center gap-1 text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors font-mono mt-1">
                  <ArrowRight className="h-3 w-3" /> AI Ops
                </a>
              </Link>
            </div>
          )}
        </SignalPanel>

        {/* ── AI Ops Incidents ── */}
        <SignalPanel
          title="AI Ops Incidents"
          count={activeIncidents.length}
          status={activeIncidents.length > 0 ? (activeIncidents.some(i => i.severity === "critical") ? "crit" : "warn") : undefined}
          updatedAt={incidentsUpdatedAt}
          intervalMs={30_000}
          isFetching={incidentsFetching}
        >
          {activeIncidents.length === 0 ? (
            <EmptyState label="No active incidents" />
          ) : (
            <div className="space-y-1.5 max-h-44 overflow-y-auto">
              {activeIncidents.slice(0, 5).map(inc => (
                <div key={inc.id}
                  className={cn("p-2 rounded-lg border text-xs",
                    inc.severity === "critical" ? "bg-red-500/8 border-red-500/20" :
                    inc.severity === "high" ? "bg-orange-500/8 border-orange-500/20" :
                    "bg-yellow-500/8 border-yellow-500/20")}>
                  <p className="font-medium truncate">{inc.title}</p>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-muted-foreground font-mono truncate text-[10px]">{inc.entityName ?? "—"}</span>
                    <span className={cn("text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full",
                      inc.severity === "critical" ? "bg-red-500/20 text-red-400" : inc.severity === "high" ? "bg-orange-500/20 text-orange-400" : "bg-yellow-500/20 text-yellow-400")}>
                      {inc.severity}
                    </span>
                  </div>
                  {inc.signalCount > 0 && (
                    <p className="text-[10px] text-muted-foreground/60 mt-0.5">{inc.signalCount} signal{inc.signalCount > 1 ? "s" : ""}</p>
                  )}
                </div>
              ))}
              <Link href="/ai-ops">
                <a className="flex items-center gap-1 text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors font-mono mt-1">
                  <ArrowRight className="h-3 w-3" /> AI Ops Center
                </a>
              </Link>
            </div>
          )}
        </SignalPanel>
      </div>

      {/* ── Deep-dive row — only shown when a specific entity is selected ── */}
      {!isAll && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">

          {/* Balance History sparkline */}
          <SignalPanel
            title="Balance History (2h)"
            updatedAt={balHistUpdatedAt}
            intervalMs={60_000}
            isFetching={balHistFetching}
          >
            {(() => {
              const pts = balanceHistory?.points ?? [];
              if (pts.length < 2) return <EmptyState label="Not enough snapshots yet — populates every 60s" />;
              const vals = pts.map(p => p.balance);
              const min = Math.min(...vals);
              const max = Math.max(...vals);
              const range = max - min || 0.01;
              const W = 320; const H = 60; const PAD = 4;
              const uw = (W - PAD * 2) / (pts.length - 1);
              const uh = (H - PAD * 2) / range;
              const toX = (i: number) => PAD + i * uw;
              const toY = (v: number) => H - PAD - (v - min) * uh;
              const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(p.balance).toFixed(1)}`).join(' ');
              const fill = `${d} L${toX(pts.length - 1).toFixed(1)},${H} L${toX(0).toFixed(1)},${H} Z`;
              const latest = pts[pts.length - 1];
              const earliest = pts[0];
              const delta = latest.balance - earliest.balance;
              const deltaColor = delta >= 0 ? "text-emerald-400" : "text-red-400";
              return (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Current</span>
                    <span className={cn("font-bold tabular-nums font-mono",
                      latest.balance < 10 ? "text-red-400" : latest.balance < 50 ? "text-amber-400" : "text-emerald-400")}>
                      ${latest.balance.toFixed(4)}
                    </span>
                  </div>
                  <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-14" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="balGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={delta >= 0 ? "#34d399" : "#f87171"} stopOpacity="0.3" />
                        <stop offset="100%" stopColor={delta >= 0 ? "#34d399" : "#f87171"} stopOpacity="0.02" />
                      </linearGradient>
                    </defs>
                    <path d={fill} fill="url(#balGrad)" />
                    <path d={d} fill="none" stroke={delta >= 0 ? "#34d399" : "#f87171"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    <circle cx={toX(pts.length - 1)} cy={toY(latest.balance)} r="3" fill={delta >= 0 ? "#34d399" : "#f87171"} />
                  </svg>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground/50 font-mono text-[10px]">{pts.length} snapshots</span>
                    <span className={cn("font-mono tabular-nums text-[11px] font-semibold", deltaColor)}>
                      {delta >= 0 ? "+" : ""}{delta.toFixed(4)} over window
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground/40 font-mono">
                    <span>{new Date(earliest.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                    <span>{new Date(latest.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                </div>
              );
            })()}
          </SignalPanel>

          {/* CDR Breakdown by destination prefix */}
          <SignalPanel
            title="CDR Breakdown by Destination"
            count={cdrSummary?.totalCdrs}
            updatedAt={cdrUpdatedAt}
            intervalMs={120_000}
            isFetching={cdrFetching}
          >
            {(() => {
              const rows = cdrSummary?.rows ?? [];
              if (rows.length === 0) {
                return <EmptyState label={cdrSummary ? "No CDRs found for this vendor" : "Loading CDR cache…"} />;
              }
              return (
                <div className="space-y-2">
                  <div className="grid grid-cols-5 gap-1 text-[9px] uppercase tracking-wider text-muted-foreground/40 font-mono px-1">
                    <span>Prefix</span><span className="text-right">Calls</span>
                    <span className="text-right">ASR%</span><span className="text-right">ACD(s)</span>
                    <span className="text-right">Mins</span>
                  </div>
                  <div className="space-y-1 max-h-52 overflow-y-auto">
                    {rows.map(row => (
                      <div key={row.prefix} className="grid grid-cols-5 gap-1 text-xs px-1 py-1 rounded-md hover:bg-white/[0.03] transition-colors">
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
                  {cdrSummary && (
                    <p className="text-[10px] text-muted-foreground/40 font-mono pt-1">
                      {cdrSummary.totalCdrs} CDR{cdrSummary.totalCdrs !== 1 ? "s" : ""} matched · cache size {cdrSummary.cacheSize}
                    </p>
                  )}
                </div>
              );
            })()}
          </SignalPanel>
        </div>
      )}

      {/* ── System Health Timeline — only shown when a specific entity is selected ── */}
      {!isAll && (
        <SignalPanel
          title="System Health Timeline"
          count={timeline?.total}
          updatedAt={timelineUpdatedAt}
          intervalMs={30_000}
          isFetching={timelineFetching}
        >
          {(() => {
            const events = timeline?.events ?? [];
            if (!timeline) return <EmptyState label="Loading timeline…" />;
            if (events.length === 0) return <EmptyState label="No events in the last 48h for this entity" />;

            const kindMeta = {
              alert:    { icon: AlertTriangle, color: "text-rose-500",   bg: "bg-rose-500/8 border-rose-500/20",   label: "ALERT"    },
              anomaly:  { icon: Zap,           color: "text-orange-500", bg: "bg-orange-500/8 border-orange-500/20", label: "ANOMALY" },
              incident: { icon: BrainCircuit,  color: "text-violet-500", bg: "bg-violet-500/8 border-violet-500/20", label: "INCIDENT"},
            } as const;

            const sevColor = (sev: string) =>
              sev === "critical" ? "text-red-400" : sev === "high" ? "text-orange-400" : sev === "warning" ? "text-amber-400" : "text-sky-400";

            return (
              <div className="space-y-1 max-h-80 overflow-y-auto pr-0.5">
                {events.map((ev, idx) => {
                  const meta  = kindMeta[ev.kind];
                  const KIcon = meta.icon;
                  const isLast = idx === events.length - 1;
                  const tsDate = new Date(ev.ts);
                  return (
                    <div key={ev.id} className="flex gap-3">
                      {/* Timeline spine */}
                      <div className="flex flex-col items-center flex-shrink-0 w-5">
                        <div className={cn("w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 border", meta.bg)}>
                          <KIcon className={cn("h-2.5 w-2.5", meta.color)} />
                        </div>
                        {!isLast && <div className="w-px flex-1 bg-white/[0.06] min-h-[8px] mt-0.5" />}
                      </div>
                      {/* Content */}
                      <div className={cn("flex-1 pb-2 text-xs", isLast ? "" : "")}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className={cn("text-[9px] font-bold uppercase tracking-widest font-mono", meta.color)}>{meta.label}</span>
                              <span className={cn("text-[9px] font-bold uppercase", sevColor(ev.severity))}>{ev.severity}</span>
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
                {timeline.total > events.length && (
                  <p className="text-[10px] text-muted-foreground/40 font-mono text-center pt-1">
                    showing {events.length} of {timeline.total} events
                  </p>
                )}
              </div>
            );
          })()}
        </SignalPanel>
      )}

      {/* Footer — cross-links */}
      <div className="flex flex-wrap gap-2 pt-1 border-t border-white/[0.04]">
        <span className="text-xs text-muted-foreground/40 font-mono mr-2">Related</span>
        {[
          { href: "/noc-command",        label: "NOC View" },
          { href: "/alerts",             label: "Alerts" },
          { href: "/carrier-scoring",    label: "Carrier Scoring" },
          { href: "/ai-ops",             label: "AI Ops" },
          { href: "/live-traffic",       label: "Live Traffic" },
          { href: "/carrier-intelligence", label: "Carrier Intelligence" },
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
