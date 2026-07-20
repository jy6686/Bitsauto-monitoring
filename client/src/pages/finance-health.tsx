import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  HeartPulse, AlertTriangle, CheckCircle2, XCircle, Clock,
  RefreshCw, Play, RotateCcw, Download,
  Database, Activity, FileText, Layers, TrendingUp,
  AlertCircle, Info, Server, Gauge, ArrowDown,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtAge(ts: string | null | undefined): string {
  if (!ts) return "—";
  const secs = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}
function fmtTs(ts: string | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function fmtDur(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
function fmtNum(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString();
}

// ── Status badge ──────────────────────────────────────────────────────────────
type NodeStatus = "healthy" | "stale" | "never" | "error" | "idle" | "failed";
function StatusBadge({ status }: { status: NodeStatus }) {
  const map: Record<NodeStatus, { label: string; cls: string; icon: React.ElementType }> = {
    healthy: { label: "Healthy",    cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30", icon: CheckCircle2 },
    stale:   { label: "Stale",      cls: "bg-amber-500/10  text-amber-400  border-amber-500/30",  icon: Clock },
    never:   { label: "Never Built",cls: "bg-slate-500/10  text-slate-400  border-slate-500/30",  icon: Database },
    error:   { label: "Error",      cls: "bg-red-500/10    text-red-400    border-red-500/30",    icon: XCircle },
    idle:    { label: "Idle",       cls: "bg-blue-500/10   text-blue-400   border-blue-500/30",   icon: Clock },
    failed:  { label: "Failed",     cls: "bg-red-500/10    text-red-400    border-red-500/30",    icon: XCircle },
  };
  const { label, cls, icon: Icon } = map[status] ?? map.never;
  return (
    <Badge variant="outline" className={`text-xs gap-1 ${cls}`}>
      <Icon className="w-2.5 h-2.5" />
      {label}
    </Badge>
  );
}

// ── Health score ring ─────────────────────────────────────────────────────────
function ScoreRing({ score, label, size = "lg" }: { score: number; label: string; size?: "sm" | "lg" }) {
  const color = score >= 80 ? "text-emerald-400" : score >= 50 ? "text-amber-400" : "text-red-400";
  const ringColor = score >= 80 ? "stroke-emerald-500" : score >= 50 ? "stroke-amber-500" : "stroke-red-500";
  const r = size === "lg" ? 42 : 28;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative">
        <svg width={size === "lg" ? 100 : 68} height={size === "lg" ? 100 : 68} className="-rotate-90">
          <circle cx={size === "lg" ? 50 : 34} cy={size === "lg" ? 50 : 34} r={r} fill="none"
            stroke="currentColor" strokeWidth={size === "lg" ? 7 : 5} className="text-muted/30" />
          <circle cx={size === "lg" ? 50 : 34} cy={size === "lg" ? 50 : 34} r={r} fill="none"
            strokeWidth={size === "lg" ? 7 : 5} strokeDasharray={`${dash} ${circ}`}
            strokeLinecap="round" className={ringColor} />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`font-bold ${size === "lg" ? "text-xl" : "text-sm"} ${color}`}>{score}%</span>
        </div>
      </div>
      <span className="text-xs text-muted-foreground text-center">{label}</span>
    </div>
  );
}

// ── Pipeline node card ────────────────────────────────────────────────────────
interface PipelineNodeProps {
  label: string;
  count: number | string;
  countLabel: string;
  latest: string | null;
  status: NodeStatus;
  icon: React.ElementType;
  missing?: boolean;
  slaMinutes?: number;
}
function PipelineNode({ label, count, countLabel, latest, status, icon: Icon, missing, slaMinutes }: PipelineNodeProps) {
  const borderCls = status === "healthy" ? "border-emerald-500/40"
    : status === "stale" ? "border-amber-500/40"
    : "border-slate-500/20";

  return (
    <Card className={`border ${borderCls} relative`} data-testid={`pipeline-node-${label.toLowerCase().replace(/\s+/g, '-')}`}>
      <CardContent className="pt-3 pb-3 px-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span className="text-sm font-medium truncate">{label}</span>
          </div>
          <StatusBadge status={status} />
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <div>
            <span className="text-xl font-bold">
              {missing ? <span className="text-muted-foreground text-sm">—</span> : fmtNum(typeof count === "number" ? count : undefined)}
            </span>
            <span className="text-xs text-muted-foreground ml-1">{countLabel}</span>
          </div>
          {latest && (
            <div className="text-right shrink-0">
              <p className="text-xs text-muted-foreground">{fmtAge(latest)}</p>
              {slaMinutes && <p className="text-[10px] text-muted-foreground">SLA: {slaMinutes}m</p>}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Connector arrow ───────────────────────────────────────────────────────────
function ConnectorArrow({ healthy }: { healthy: boolean }) {
  return (
    <div className="flex justify-center">
      <ArrowDown className={`w-4 h-4 ${healthy ? "text-emerald-500" : "text-slate-400"}`} />
    </div>
  );
}

// ── Warning row ───────────────────────────────────────────────────────────────
function WarningRow({ level, message }: { level: "warn" | "error"; message: string }) {
  return (
    <div className={`flex items-start gap-2 py-2 ${level === "error" ? "text-red-400" : "text-amber-400"}`}>
      {level === "error"
        ? <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        : <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
      <span className="text-sm">{message}</span>
    </div>
  );
}

// ── Materialization run row ───────────────────────────────────────────────────
function RunRow({ run, idx }: { run: any; idx: number }) {
  const isOk = run.status !== "failed";
  return (
    <div className="grid grid-cols-[3rem_1fr_5rem_5rem_5rem_5rem_4rem] gap-2 py-1.5 text-xs items-center border-b border-border/40 last:border-0">
      <span className="text-muted-foreground font-mono">#{idx + 1}</span>
      <span className={isOk ? "text-muted-foreground" : "text-red-400 truncate"}>
        {run.error ?? fmtTs(run.started_at)}
      </span>
      <span className="text-right text-muted-foreground">{fmtTs(run.completed_at)}</span>
      <span className="text-right">{fmtDur(run.duration_ms)}</span>
      <span className="text-right text-muted-foreground">{fmtNum(run.rows_written)}</span>
      <span className="text-right text-muted-foreground">{fmtNum(run.clients_processed)}</span>
      <div className="flex justify-end">
        <StatusBadge status={isOk ? "healthy" : "failed"} />
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function FinanceHealthPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [jobStatus, setJobStatus] = useState<string | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery<any>({
    queryKey: ["/api/finance/health"],
    refetchInterval: 60_000,
  });

  const materializeMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/finance/health/materialize-now"),
    onSuccess: (resp: any) => {
      setJobStatus("queued");
      toast({ title: "Materialization queued", description: resp?.message ?? "Refresh in 30s to see results." });
      setTimeout(() => {
        setJobStatus("running");
        setTimeout(() => {
          setJobStatus(null);
          queryClient.invalidateQueries({ queryKey: ["/api/finance/health"] });
        }, 30_000);
      }, 2_000);
    },
    onError: () => toast({ title: "Error", description: "Could not queue materialization.", variant: "destructive" }),
  });

  const downloadReport = () => {
    if (!data?.materialization?.runs?.length) return;
    const rows = data.materialization.runs;
    const header = ["run","started_at","completed_at","duration_ms","rows_written","clients_processed","vendors_processed","status","error","snapshot_version"];
    const csv = [header.join(","), ...rows.map((r: any, i: number) =>
      [i+1, r.started_at ?? "", r.completed_at ?? "", r.duration_ms ?? "", r.rows_written ?? "", r.clients_processed ?? "", r.vendors_processed ?? "", r.status ?? "", (r.error ?? "").replace(/,/g, ";"), r.snapshot_version ?? ""].join(",")
    )].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `materialization-report-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const h = data?.health ?? {};
  const p = data?.pipeline ?? {};
  const integrity = data?.integrity ?? {};
  const warnings: any[] = data?.warnings ?? [];
  const runs: any[] = data?.materialization?.runs ?? [];
  const schedulerStatus: NodeStatus = data?.materialization?.schedulerStatus ?? "never";
  const sla = data?.sla ?? {};
  const build = data?.build ?? {};

  const overallColor = (h.overall ?? 0) >= 80 ? "text-emerald-400" : (h.overall ?? 0) >= 50 ? "text-amber-400" : "text-red-400";
  const overallLabel = (h.overall ?? 0) >= 80 ? "🟢 Healthy" : (h.overall ?? 0) >= 50 ? "🟡 Degraded" : "🔴 Critical";

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-7xl mx-auto" data-testid="finance-health-page">

      {/* ── Status header bar ── */}
      <div className="rounded-lg border border-border/60 bg-card/60 backdrop-blur-sm px-4 py-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          {/* Left: identity */}
          <div className="flex items-center gap-3">
            <HeartPulse className="w-5 h-5 text-emerald-400 shrink-0" />
            <div>
              <h1 className="text-base font-semibold leading-tight">Finance Operations Center</h1>
              <p className="text-xs text-muted-foreground">Finance Data Platform — F0</p>
            </div>
          </div>
          {/* Center: context pills */}
          <div className="flex items-center gap-3 flex-wrap text-xs">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Server className="w-3 h-3" />
              <span>Build</span>
              <span className="font-mono font-medium text-foreground">{build.version ?? "—"}</span>
            </div>
            <div className="w-px h-3 bg-border/60" />
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <span>Environment</span>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-blue-500/10 text-blue-400 border-blue-500/30">Production</Badge>
            </div>
            <div className="w-px h-3 bg-border/60" />
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Health</span>
              <span className={`font-bold ${overallColor}`}>{h.overall ?? 0}%</span>
            </div>
            <div className="w-px h-3 bg-border/60" />
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Clock className="w-3 h-3" />
              <span>Updated {fmtAge(data?.generated_at)}</span>
            </div>
          </div>
          {/* Right: actions */}
          <div className="flex items-center gap-1.5 ml-auto">
            {jobStatus && (
              <Badge variant="outline" className="text-xs gap-1 bg-blue-500/10 text-blue-400 border-blue-500/30">
                <Activity className="w-2.5 h-2.5 animate-pulse" />
                {jobStatus === "queued" ? "Queued…" : "Running…"}
              </Badge>
            )}
            <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching} data-testid="btn-refresh-health">
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={() => materializeMut.mutate()}
              disabled={materializeMut.isPending || !!jobStatus} data-testid="btn-materialize-now">
              <Play className="w-3.5 h-3.5 mr-1.5" />
              Run Now
            </Button>
            <Button variant="ghost" size="sm" onClick={downloadReport}
              disabled={!runs.length} data-testid="btn-download-report">
              <Download className="w-3.5 h-3.5 mr-1.5" />
              Report
            </Button>
          </div>
        </div>
      </div>

      {/* ── Overall Health Score ── */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center gap-6 flex-wrap">
            {/* Overall */}
            <div className="flex items-center gap-4">
              <ScoreRing score={h.overall ?? 0} label="Overall" />
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Finance Health</p>
                <p className={`text-3xl font-bold ${overallColor}`}>{h.overall ?? 0}%</p>
                <p className="text-sm text-muted-foreground">{overallLabel}</p>
              </div>
            </div>
            <Separator orientation="vertical" className="h-20 hidden sm:block" />
            {/* Components */}
            <div className="flex gap-5 flex-wrap">
              <ScoreRing score={h.dataHealth ?? 0} label="Data Freshness" size="sm" />
              <ScoreRing score={h.schedulerHealth ?? 0} label="Scheduler" size="sm" />
              <ScoreRing score={h.consistency ?? 0} label="Consistency" size="sm" />
              <ScoreRing score={h.apiHealth ?? 0} label="API Health" size="sm" />
            </div>
            {/* Data lineage hint */}
            <div className="ml-auto text-right hidden lg:block">
              <p className="text-xs text-muted-foreground">Last checked</p>
              <p className="text-sm font-medium">{fmtTs(data?.generated_at)}</p>
              <p className="text-xs text-muted-foreground mt-1">
                Snapshot run #{runs.length > 0 ? (runs[0]?.id ?? "—") : "—"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Warnings panel ── */}
      {warnings.length > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardHeader className="pb-1 pt-3">
            <CardTitle className="text-sm flex items-center gap-2 text-amber-400">
              <AlertTriangle className="w-4 h-4" />
              {warnings.filter((w: any) => w.level === "error").length > 0 ? "Active Issues" : "Warnings"}
              <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-400 border-amber-500/30">{warnings.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-3 px-4">
            <div className="divide-y divide-border/30">
              {warnings.map((w: any, i: number) => (
                <WarningRow key={i} level={w.level} message={w.message} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* ── Left: Pipeline Graph ── */}
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5" /> Pipeline
          </h2>

          {/* CDRs */}
          <PipelineNode
            label="Sippy CDRs"
            count={p.cdr?.count ?? 0}
            countLabel="cached"
            latest={p.cdr?.latest ?? null}
            status={p.cdr?.count > 0 ? "healthy" : "stale"}
            icon={Server}
          />
          <ConnectorArrow healthy={p.cdr?.count > 0} />

          {/* DMR */}
          <PipelineNode
            label="Daily Minutes Report"
            count={p.dmr?.count ?? 0}
            countLabel="rows"
            latest={p.dmr?.latest}
            status={p.dmr?.status ?? "never"}
            icon={Activity}
            missing={p.dmr?.missing}
            slaMinutes={sla.dmr}
          />
          <ConnectorArrow healthy={p.dmr?.status === "healthy"} />

          {/* Financial Snapshot */}
          <PipelineNode
            label="Financial Snapshot"
            count={p.snapshot?.count ?? 0}
            countLabel="rows"
            latest={p.snapshot?.latest}
            status={p.snapshot?.status ?? "never"}
            icon={Database}
            missing={p.snapshot?.missing}
            slaMinutes={sla.snapshot}
          />

          {/* Consumer forks */}
          <div className="flex justify-center">
            <ArrowDown className={`w-4 h-4 ${p.snapshot?.status === "healthy" ? "text-emerald-500" : "text-slate-400"}`} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Card className="border-border/40">
              <CardContent className="pt-2 pb-2 px-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <TrendingUp className="w-3 h-3" />
                  <span>Margin</span>
                </div>
                <StatusBadge status={p.margin?.status ?? "never"} />
              </CardContent>
            </Card>
            <Card className="border-border/40">
              <CardContent className="pt-2 pb-2 px-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <FileText className="w-3 h-3" />
                  <span>Invoices</span>
                </div>
                <StatusBadge status={p.invoices?.total > 0 ? "healthy" : "stale"} />
              </CardContent>
            </Card>
            <Card className="border-border/40">
              <CardContent className="pt-2 pb-2 px-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Activity className="w-3 h-3" />
                  <span>AI Assurance</span>
                </div>
                <StatusBadge status={p.snapshot?.status === "healthy" ? "healthy" : "stale"} />
              </CardContent>
            </Card>
            <Card className="border-border/40">
              <CardContent className="pt-2 pb-2 px-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Gauge className="w-3 h-3" />
                  <span>Cockpit</span>
                </div>
                <StatusBadge status={p.snapshot?.status === "healthy" ? "healthy" : "stale"} />
              </CardContent>
            </Card>
          </div>
        </div>

        {/* ── Middle: Scheduler + Integrity ── */}
        <div className="space-y-4">
          {/* Scheduler status */}
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5 mb-2">
              <RefreshCw className="w-3.5 h-3.5" /> Scheduler
            </h2>
            <Card>
              <CardContent className="pt-4 pb-4 px-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Materialization</span>
                  <StatusBadge status={schedulerStatus} />
                </div>
                {data?.materialization?.lastRun ? (
                  <div className="space-y-1.5 text-xs text-muted-foreground">
                    <div className="flex justify-between">
                      <span>Last run</span>
                      <span className="font-medium text-foreground">{fmtTs(data.materialization.lastRun.started_at)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Duration</span>
                      <span>{fmtDur(data.materialization.lastRun.duration_ms)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Rows written</span>
                      <span>{fmtNum(data.materialization.lastRun.rows_written)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Clients</span>
                      <span>{fmtNum(data.materialization.lastRun.clients_processed)}</span>
                    </div>
                    {data.materialization.lastRun.snapshot_version != null && (
                      <div className="flex justify-between">
                        <span>Snapshot version</span>
                        <span className="font-mono">v{data.materialization.lastRun.snapshot_version}</span>
                      </div>
                    )}
                    {data.materialization.lastRun.error && (
                      <div className="text-red-400 bg-red-500/10 rounded px-2 py-1 mt-1">
                        {data.materialization.lastRun.error}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {data?.materialization?.missing
                      ? "Scheduler not yet configured — available after Sprint F1"
                      : "No runs recorded yet"}
                  </p>
                )}
                <div className="flex gap-2 pt-1">
                  <Button size="sm" variant="outline" className="flex-1 text-xs"
                    onClick={() => materializeMut.mutate()}
                    disabled={materializeMut.isPending || !!jobStatus}
                    data-testid="btn-scheduler-run-now">
                    <Play className="w-3 h-3 mr-1" />
                    Run Now
                  </Button>
                  <Button size="sm" variant="ghost" className="flex-1 text-xs"
                    disabled={schedulerStatus !== "failed"}
                    data-testid="btn-scheduler-retry">
                    <RotateCcw className="w-3 h-3 mr-1" />
                    Retry
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Snapshot integrity */}
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5 mb-2">
              <CheckCircle2 className="w-3.5 h-3.5" /> Snapshot Integrity
            </h2>
            <Card>
              <CardContent className="pt-4 pb-4 px-4 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">DMR Accounts</span>
                  <span className="font-medium">{fmtNum(integrity.dmrAccounts)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Snapshot Accounts</span>
                  <span className="font-medium">{fmtNum(integrity.snapshotAccounts)}</span>
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Status</span>
                  {integrity.consistent === false && integrity.snapshotAccounts > 0 ? (
                    <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-400 border-amber-500/30 gap-1">
                      <AlertTriangle className="w-2.5 h-2.5" />
                      Mismatch ({(integrity.dmrAccounts ?? 0) - (integrity.snapshotAccounts ?? 0)} diff)
                    </Badge>
                  ) : integrity.snapshotAccounts === 0 ? (
                    <Badge variant="outline" className="text-xs text-muted-foreground">Not built</Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-400 border-emerald-500/30 gap-1">
                      <CheckCircle2 className="w-2.5 h-2.5" />
                      Consistent
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Invoice summary */}
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5 mb-2">
              <FileText className="w-3.5 h-3.5" /> Invoices
            </h2>
            <Card>
              <CardContent className="pt-3 pb-3 px-4">
                {p.invoices?.missing ? (
                  <p className="text-xs text-muted-foreground py-2">Invoice table unavailable</p>
                ) : (
                  <div className="space-y-1.5">
                    {Object.entries(p.invoices?.byStatus ?? {}).map(([status, cnt]: [string, any]) => (
                      <div key={status} className="flex justify-between text-sm">
                        <span className="capitalize text-muted-foreground">{status}</span>
                        <span className="font-medium">{fmtNum(cnt)}</span>
                      </div>
                    ))}
                    {!Object.keys(p.invoices?.byStatus ?? {}).length && (
                      <p className="text-xs text-muted-foreground py-2">No invoices yet</p>
                    )}
                    <Separator className="my-1" />
                    <div className="flex justify-between text-sm font-medium">
                      <span>Total</span>
                      <span>{fmtNum(p.invoices?.total)}</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* ── Right: Materialization History ── */}
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" /> Run History
            {runs.length > 0 && <Badge variant="outline" className="text-xs ml-1">{runs.length}</Badge>}
          </h2>
          <Card className="overflow-hidden">
            {runs.length === 0 ? (
              <CardContent className="pt-8 pb-8 flex flex-col items-center gap-2 text-center">
                <Info className="w-8 h-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  {data?.materialization?.missing
                    ? "Scheduler not yet configured"
                    : "No runs recorded yet"}
                </p>
                <p className="text-xs text-muted-foreground max-w-48">
                  {data?.materialization?.missing
                    ? "Materialization history will appear here after Sprint F1 is implemented"
                    : "Click Run Now to trigger the first materialization"}
                </p>
              </CardContent>
            ) : (
              <div className="overflow-x-auto">
                <div className="px-4 pt-2 pb-0">
                  <div className="grid grid-cols-[3rem_1fr_5rem_5rem_5rem_5rem_4rem] gap-2 text-[10px] uppercase tracking-wide text-muted-foreground pb-1.5 border-b border-border/60">
                    <span>#</span>
                    <span>Started</span>
                    <span className="text-right">Completed</span>
                    <span className="text-right">Duration</span>
                    <span className="text-right">Rows</span>
                    <span className="text-right">Clients</span>
                    <span className="text-right">Status</span>
                  </div>
                </div>
                <div className="px-4 pb-2 max-h-[420px] overflow-y-auto">
                  {runs.map((run, i) => <RunRow key={i} run={run} idx={i} />)}
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* ── SLA Config reference ── */}
      <Card className="bg-muted/30">
        <CardContent className="pt-3 pb-3 px-4">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
              <AlertCircle className="w-3.5 h-3.5" />
              Freshness SLAs:
            </div>
            {Object.entries(sla).map(([k, v]: [string, any]) => (
              <div key={k} className="flex items-center gap-1 text-xs">
                <span className="capitalize text-foreground font-medium">{k.replace(/_/g, " ")}</span>
                <span className="text-muted-foreground">{v}m</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── Version footer ── */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground border-t border-border/40 pt-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Server className="w-3 h-3" />
          Finance Build: <span className="font-mono font-medium text-foreground">{build.version ?? "—"}</span>
        </div>
        {build.commit && (
          <div className="flex items-center gap-1.5">
            Commit: <span className="font-mono text-foreground">{build.commit}</span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          Schema: <span className="font-mono text-foreground">v{build.schemaVersion ?? "—"}</span>
        </div>
        <div className="ml-auto">
          Materialization platform — Sprint F1 pending
        </div>
      </div>
    </div>
  );
}
