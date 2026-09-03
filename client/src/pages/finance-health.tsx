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
  AlertCircle, Info, Server, Gauge, ArrowDown, ArrowRight, ClipboardCheck,
} from "lucide-react";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { CdrImportMonitor } from "@/components/finance/cdr-import-monitor";

// ── Business Day Status ───────────────────────────────────────────────────────
// This replaces the "Data Freshness 55%" ring. A percentage cannot answer the
// only question it ever prompted — what is missing — because a score has
// nowhere to put that. The chain can: eight stages, each with a state and a
// reason, judged against the business day the platform owes.
//
// Grey is load-bearing here. Only a stage that actually FAILED, or one sitting
// downstream of a failure, is red; a stage that simply has not run yet is grey,
// because a board that turns red at 00:40 for work scheduled at 02:00 is a
// board nobody reads twice.
const TONE_STYLE: Record<string, { dot: string; text: string; mark: string }> = {
  good:   { dot: "bg-emerald-500", text: "text-emerald-400", mark: "✓" },
  active: { dot: "bg-amber-400 animate-pulse", text: "text-amber-400", mark: "◐" },
  bad:    { dot: "bg-red-500", text: "text-red-400", mark: "✖" },
  idle:   { dot: "bg-muted-foreground/40", text: "text-muted-foreground", mark: "○" },
};

const VERDICT_STYLE: Record<string, { label: string; cls: string }> = {
  complete:          { label: "Complete",           cls: "text-emerald-400" },
  awaiting_approval: { label: "Awaiting approval",  cls: "text-amber-400" },
  in_progress:       { label: "In progress",        cls: "text-amber-400" },
  not_due:           { label: "Not due yet",        cls: "text-muted-foreground" },
  // Nothing failed — a stage simply cannot be reported on. Saying "Incomplete"
  // would assert more than the evidence supports.
  unconfirmed:       { label: "Unconfirmed",        cls: "text-amber-400" },
  blocked:           { label: "Incomplete",         cls: "text-red-400" },
};

function fmtStageDur(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 90_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 5_400_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}
function fmtUtc(ts: string | null | undefined): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

function BusinessDayPanel({ bd }: { bd: any }) {
  if (!bd) {
    return (
      <Card><CardContent className="pt-4 pb-4">
        <Skeleton className="h-6 w-72 mb-3" />
        <Skeleton className="h-40 w-full" />
      </CardContent></Card>
    );
  }
  const v = VERDICT_STYLE[bd.verdict] ?? VERDICT_STYLE.blocked;
  const stages: any[] = Array.isArray(bd.stages) ? bd.stages : [];
  const rd = bd.readiness ?? null;
  const cov = bd.coverage ?? null;
  // Three answers, not two. "Yes" and "No" are the ones worth having, but a
  // stage the platform cannot see supports neither — saying yes overclaims and
  // saying no asserts a failure that did not happen.
  const READY: Record<string, { label: string; cls: string; ring: string }> = {
    yes:         { label: "Yes", cls: "text-emerald-400", ring: "border-emerald-500/40 bg-emerald-500/5" },
    no:          { label: "No",  cls: "text-red-400",     ring: "border-red-500/40 bg-red-500/5" },
    unconfirmed: { label: "Cannot confirm", cls: "text-amber-400", ring: "border-amber-500/40 bg-amber-500/5" },
  };
  const r = READY[rd?.ready ?? "unconfirmed"];
  const unmeasured: string[] = Array.isArray(bd.unmeasured) ? bd.unmeasured : [];
  const business:  any[] = Array.isArray(bd.businessIssues)  ? bd.businessIssues  : [];
  const technical: any[] = Array.isArray(bd.technicalIssues) ? bd.technicalIssues : [];
  const human:     any[] = Array.isArray(bd.humanIssues)     ? bd.humanIssues     : [];

  return (
    <Card>
      {/* FINANCE READY TODAY — the first thing on the page.
          This is the question an executive asks within seconds of opening the
          dashboard, and everything below it exists to explain the answer. It
          sits above the stage chain because a reader who only takes one thing
          from this page should take this. */}
      {rd && (
        <div className={`border-b px-6 py-4 rounded-t-lg ${r.ring}`}>
          <div className="flex items-baseline gap-4 flex-wrap">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Finance ready today</p>
            <span className={`text-3xl font-bold leading-none ${r.cls}`}>{r.label}</span>
            {cov && cov.total > 0 && (
              <span className="text-sm font-mono tabular-nums text-muted-foreground ml-auto">
                Coverage {cov.done} / {cov.total} {cov.unit}
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1.5 max-w-4xl">{rd.reason}</p>
        </div>
      )}
      <CardHeader className="pb-2 pt-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Business Day Status</p>
            <div className="flex items-baseline gap-3 mt-1">
              <span className="text-2xl font-bold tabular-nums">{bd.targetDay}</span>
              <span className={`text-lg font-semibold ${v.cls}`}>{v.label}</span>
            </div>
            <p className="text-sm text-muted-foreground mt-1 max-w-3xl">{bd.headline}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Completed stages</p>
            <p className="text-2xl font-bold tabular-nums">
              {bd.completed}<span className="text-muted-foreground text-base"> / {bd.automatedTotal}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              pipeline starts {String(bd.scheduledHourUtc ?? 2).padStart(2, "0")}:00 UTC
            </p>
          </div>
        </div>

        {/* CURRENT BLOCKER, called out rather than left for the reader to find
            by scanning the chain. "Incomplete" on its own sent people looking;
            the stage AND the reason are the two things they were looking for. */}
        {bd.firstBlocker && (
          <div className={`mt-3 rounded-md border px-4 py-3 ${
            bd.firstBlocker.tone === "bad"
              ? "border-red-500/40 bg-red-500/5"
              : "border-amber-500/40 bg-amber-500/5"}`}>
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Current blocker</p>
                <p className="text-lg font-semibold leading-tight">{bd.firstBlocker.label}</p>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Reason</p>
                <p className="text-sm leading-tight break-words">
                  {bd.firstBlocker.reason ?? bd.firstBlocker.detail}
                </p>
              </div>
              {bd.firstBlocker.issueClass && (
                <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                  {bd.firstBlocker.issueClass === "technical" ? "Technical" : "Business"}
                </Badge>
              )}
              <Link href={bd.firstBlocker.href ?? "/finance/health"}>
                <Button size="sm" variant="outline" className="h-7 text-xs">Open</Button>
              </Link>
            </div>
          </div>
        )}
      </CardHeader>
      <CardContent className="pb-4">
        {/* The chain, drawn as a chain — each stage consumes what the one
            above produced, so the vertical rail is information, not ornament.
            Each row is a link: the board doubles as navigation into the stage
            that needs attention, which is where the reader was going anyway. */}
        <div className="relative">
          {stages.map((st, i) => {
            const t = TONE_STYLE[st.tone] ?? TONE_STYLE.idle;
            const last = i === stages.length - 1;
            const pg = st.progress;
            const pct = pg && pg.total > 0
              ? Math.round((pg.done / pg.total) * 100) : null;
            const when = fmtUtc(st.lastRunAt);
            const dur  = fmtStageDur(st.durationMs);
            return (
              <div key={st.key} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span className={`w-3 h-3 rounded-full mt-2 shrink-0 ${t.dot}`} />
                  {!last && <span className="w-px flex-1 bg-border my-1" />}
                </div>
                <Link href={st.href ?? "/finance/health"} className="flex-1 min-w-0">
                  <div className={`group rounded-md px-2 -mx-2 py-1 hover:bg-muted/50 transition-colors
                                   ${last ? "mb-0" : "mb-2"}`}>
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className={`font-mono text-xs ${t.text}`}>{t.mark}</span>
                      <span className="font-medium text-sm group-hover:underline">{st.label}</span>
                      <span className={`text-xs font-mono uppercase tracking-wide ${t.text}`}>
                        {String(st.state).replace(/_/g, " ")}
                      </span>
                      {/* Progress only where it was actually measured. A stage
                          with no counts shows none, rather than a bar implying
                          a measurement nobody took. */}
                      {pg && (
                        <span className="text-xs font-mono tabular-nums text-muted-foreground">
                          {pg.done} / {pg.total} {pg.unit}
                          {pct != null && <span className="ml-1.5">{pct}%</span>}
                        </span>
                      )}
                      {/* LAST SUCCESSFUL completion, which is not the last
                          run. A failed stage has a recent run and an older
                          success, and a timestamp under a red mark would imply
                          the stage did something it did not. So a completed
                          stage shows when it completed; anything else says so
                          and shows its last success separately. */}
                      <span className="ml-auto text-[11px] font-mono text-muted-foreground whitespace-nowrap">
                        {st.state === "complete"
                          ? <>{fmtUtc(st.lastSuccessAt ?? st.lastRunAt) ?? "—"}{dur ? ` · ${dur}` : ""}</>
                          : <span className={t.text}>Not completed</span>}
                      </span>
                    </div>
                    {pct != null && (
                      <div className="h-1 rounded bg-muted mt-1.5 overflow-hidden max-w-md">
                        <div className={`h-full ${st.tone === "bad" ? "bg-red-500"
                                        : st.tone === "good" ? "bg-emerald-500" : "bg-amber-400"}`}
                             style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground mt-0.5 break-words">
                      {st.detail}
                      {st.state !== "complete" && st.lastSuccessAt && (
                        <span className="text-muted-foreground/70">
                          {" "}&middot; last succeeded {fmtUtc(st.lastSuccessAt)}
                        </span>
                      )}
                      {st.state !== "complete" && !st.lastSuccessAt && when && (
                        <span className="text-muted-foreground/70">
                          {" "}&middot; last ran {when}{dur ? ` (${dur})` : ""}
                        </span>
                      )}
                    </p>
                  </div>
                </Link>
              </div>
            );
          })}
        </div>

        {/* THREE lists, by owner. Two was wrong: waiting for reference data
            and waiting for a named person to press approve have different
            owners and different remedies, and an engineer reading a merged
            list cannot tell whether to investigate infrastructure, chase data,
            or simply wait. Each column names its owner so the board needs no
            legend. */}
        {(technical.length > 0 || business.length > 0 || human.length > 0) && (
          <div className="grid sm:grid-cols-3 gap-4 mt-4 pt-4 border-t">
            {([
              { key: "technical", title: "Technical", owner: "Engineering",
                items: technical, cls: "text-red-400" },
              { key: "business",  title: "Business",  owner: "Finance operations",
                items: business,  cls: "text-amber-400" },
              { key: "human",     title: "Human",     owner: "Finance",
                items: human,     cls: "text-amber-400" },
            ] as const).map(col => (
              <div key={col.key}>
                <div className="flex items-baseline gap-2 mb-2">
                  <p className={`text-[11px] uppercase tracking-wide font-medium ${col.cls}`}>
                    {col.title}
                  </p>
                  <p className="text-[10px] text-muted-foreground">{col.owner}</p>
                </div>
                {col.items.length === 0
                  ? <p className="text-xs text-muted-foreground">Nothing outstanding.</p>
                  : col.items.map((st: any) => (
                      <div key={st.key} className="mb-2">
                        <p className="text-sm font-medium leading-tight">{st.label}</p>
                        <p className="text-xs text-muted-foreground leading-tight mt-0.5">
                          {st.reason ?? st.detail}
                        </p>
                      </div>
                    ))}
              </div>
            ))}
          </div>
        )}

        {unmeasured.length > 0 && (
          // "Not measured" and "not done" are different facts, and a grey dot
          // alone cannot tell them apart.
          <p className="text-xs text-muted-foreground mt-3 pt-3 border-t">
            Not measured this cycle: <span className="font-mono">{unmeasured.join(", ")}</span>
            {" "}— these probes returned nothing, so their stages show as waiting rather than done.
          </p>
        )}
      </CardContent>
    </Card>
  );
}


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

// ── Pipeline node card ────────────────────────────────────────────────────────
interface PipelineNodeProps {
  label: string;
  count: number | string;
  countLabel: string;
  latest: string | null;
  status: NodeStatus;
  icon: React.ElementType;
  missing?: boolean;
  /** Elapsed-time SLA, minutes — only for artefacts judged that way. */
  slaMinutes?: number;
  /** Coverage detail for artefacts judged by which business day they cover. */
  coverage?: { covers?: string | null; expected?: string | null; daysBehind?: number | null };
}

function PipelineNode({ label, count, countLabel, latest, status, icon: Icon, missing, slaMinutes, coverage }: PipelineNodeProps) {
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
              {/* A daily artefact is judged by which business day it covers,
                  so printing a minute count here would describe a rule that is
                  not the one being applied. */}
              {coverage?.expected
                ? <p className="text-[10px] text-muted-foreground">
                    {coverage.covers
                      ? `Covers ${coverage.covers} · owed ${coverage.expected}`
                      : `No data · owed ${coverage.expected}`}
                  </p>
                : slaMinutes
                  ? <p className="text-[10px] text-muted-foreground">
                      SLA: {slaMinutes >= 60 ? `${Math.round(slaMinutes / 60)}h` : `${slaMinutes}m`}
                    </p>
                  : null}
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
// Every warning carries the action that fixes it — Finance acts from this page
// instead of hunting for the right workflow elsewhere.
function WarningRow({ level, message, action, onAction, busy }: {
  level: "warn" | "error";
  message: string;
  action?: { kind: string; label: string };
  onAction?: (kind: string) => void;
  busy?: boolean;
}) {
  return (
    <div className={`flex items-center gap-2 py-1.5 ${level === "error" ? "text-red-400" : "text-amber-400"}`}>
      {level === "error"
        ? <XCircle className="w-3.5 h-3.5 shrink-0" />
        : <AlertTriangle className="w-3.5 h-3.5 shrink-0" />}
      <span className="text-sm flex-1">{message}</span>
      {action && (
        (action.kind === "open-invoices" || action.kind === "open-jobs") ? (
          <Link href={action.kind === "open-invoices" ? "/invoices" : "/invoice-jobs"}>
            <Button size="sm" variant="outline" className="text-xs h-7 shrink-0" data-testid={`warning-action-${action.kind}`}>
              {action.label}<ArrowRight className="w-3 h-3 ml-1" />
            </Button>
          </Link>
        ) : (
          <Button size="sm" variant="outline" className="text-xs h-7 shrink-0" disabled={busy}
            onClick={() => onAction?.(action.kind)} data-testid={`warning-action-${action.kind}`}>
            {busy ? <RefreshCw className="w-3 h-3 mr-1 animate-spin" /> : <Play className="w-3 h-3 mr-1" />}
            {action.label}
          </Button>
        )
      )}
    </div>
  );
}

// ── Invoice pipeline stage cell (clickable) ───────────────────────────────────
function PipelineStage({ label, value, sub, href, warn }: {
  label: string; value: number | string; sub?: string; href: string; warn?: boolean;
}) {
  return (
    <Link href={href}>
      <div
        className={`rounded-md border px-3 py-2 min-w-[92px] cursor-pointer transition-colors hover:bg-muted/50
          ${warn ? "border-amber-500/40 bg-amber-500/5" : "border-border/50"}`}
        data-testid={`invoice-stage-${label.toLowerCase().replace(/\s+/g, "-")}`}
      >
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
          {label}{warn && <AlertTriangle className="w-2.5 h-2.5 text-amber-400" />}
        </div>
        <div className="text-lg font-bold leading-tight">{value}</div>
        {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
      </div>
    </Link>
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
    // KEEP POLLING WHEN THE TAB IS NOT FOCUSED. React Query defaults this to
    // false, which pauses the interval the moment the window loses focus — so
    // a dashboard left open on a second monitor freezes at whatever it last
    // fetched and gives no sign that it has. That is precisely how an
    // operations screen is used: opened at 08:00 and glanced at all day.
    refetchIntervalInBackground: true,
  });

  // Billing-workflow counts for the clickable invoice pipeline strip
  const { data: businessDay } = useQuery<any>({
    queryKey: ["/api/finance/business-day"],
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
  });

  const { data: invPipe } = useQuery<any>({
    queryKey: ["/api/finance/pipeline-health"],
    queryFn: () => apiRequest("GET", "/api/finance/pipeline-health").then(r => r.json()),
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
  });

  const dmrMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/dmr/generate", { date: new Date().toISOString().slice(0, 10) }),
    onSuccess: () => {
      toast({ title: "DMR generation started", description: "Refresh in ~30s to see fresh rows." });
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ["/api/finance/health"] }), 30_000);
    },
    onError: (e: any) => toast({ title: "DMR run failed", description: e.message, variant: "destructive" }),
  });

  const handleWarningAction = (kind: string) => {
    if (kind === "materialize") materializeMut.mutate();
    if (kind === "run-dmr") dmrMut.mutate();
  };

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
              <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${
                build.environment === "production"
                  ? "bg-blue-500/10 text-blue-400 border-blue-500/30"
                  : "bg-amber-500/10 text-amber-400 border-amber-500/30"}`}>
                {build.environment === "production" ? "Production" : "Workspace"}
              </Badge>
              {build.database && (
                <span className="font-mono text-[10px] text-muted-foreground" title="Database this page is reading">
                  {build.database}
                </span>
              )}
            </div>
            <div className="w-px h-3 bg-border/60" />
            {/* The status bar says the same thing the panel says. A second,
                differently-derived number here is how two parts of one page
                end up disagreeing about the same day. */}
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">{businessDay?.targetDay ?? "Business day"}</span>
              <span className={`font-bold ${(VERDICT_STYLE[businessDay?.verdict] ?? VERDICT_STYLE.blocked).cls}`}>
                {businessDay ? (VERDICT_STYLE[businessDay.verdict] ?? VERDICT_STYLE.blocked).label : "—"}
              </span>
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

      {/* ── Business day, then infrastructure ──────────────────────────────
          Ordered deliberately: the first question is whether yesterday's
          finance is complete, not whether a service responded. Infrastructure
          is the diagnosis for a red stage, not the headline. */}
      <BusinessDayPanel bd={businessDay} />

      {/* ── Infrastructure ────────────────────────────────────────────────
          The other half of the split: these are continuous services, so they
          genuinely have an age and keep the heartbeat question. They are
          reported as STATES rather than percentages — "responding" and "78%"
          are not the same kind of claim, and only one of them is true. */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center gap-6 flex-wrap">
            <p className="text-xs text-muted-foreground uppercase tracking-wide w-full sm:w-auto">
              Infrastructure
            </p>
            {[
              { label: "API",       ok: (h.apiHealth ?? 0) >= 100,
                note: (h.apiHealth ?? 0) >= 100 ? "All queries responding"
                                                : "Some queries failing" },
              { label: "Scheduler", ok: schedulerStatus === "healthy",
                note: schedulerStatus === "healthy" ? "Last run succeeded"
                    : schedulerStatus === "failed"  ? "Last run failed"
                    : schedulerStatus === "idle"    ? "No run recorded yet"
                    : "Run history unreadable" },
              { label: "Database",  ok: !p.dmr?.missing && !p.snapshot?.missing,
                note: (!p.dmr?.missing && !p.snapshot?.missing)
                        ? "Readable" : "One or more tables unreadable" },
            ].map(x => (
              <div key={x.label} className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${x.ok ? "bg-emerald-500" : "bg-red-500"}`} />
                <div>
                  <p className="text-sm font-medium leading-tight">{x.label}</p>
                  <p className="text-xs text-muted-foreground leading-tight">{x.note}</p>
                </div>
              </div>
            ))}
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
                <WarningRow key={i} level={w.level} message={w.message} action={w.action}
                  onAction={handleWarningAction}
                  busy={(w.action?.kind === "materialize" && (materializeMut.isPending || !!jobStatus)) ||
                        (w.action?.kind === "run-dmr" && dmrMut.isPending)} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── CDR Import (ingestion is upstream of every stage below) ──────
          Replaces operating the importer through browser DevTools: job
          progress, scheduler mode and repository completeness were all
          reachable by endpoint but only readable by pasting fetch() calls. */}
      <CdrImportMonitor />

      {/* ── Invoice Pipeline (billing workflow, every stage clickable) ── */}
      {invPipe && (() => {
        const jobs = invPipe.jobs ?? {};
        const inv  = invPipe.invoices ?? {};
        const jobsTotal   = Object.values(jobs).reduce((a: number, b: any) => a + Number(b), 0);
        const sentDeliv   = (invPipe.deliveries ?? []).find((d: any) => d.status === "sent")?.n ?? 0;
        const failedDeliv = (invPipe.deliveries ?? []).find((d: any) => d.status === "failed")?.n ?? 0;
        const locked    = invPipe.snapshots?.locked ?? 0;
        const snapTotal = invPipe.snapshots?.total  ?? 0;
        const stages = [
          { label: "Schedules", value: `${invPipe.schedules?.active ?? 0}/${invPipe.schedules?.total ?? 0}`, sub: "active", href: "/invoice-jobs", warn: (invPipe.schedules?.active ?? 0) === 0 },
          { label: "Due Now",   value: invPipe.schedules?.due_now ?? 0, href: "/invoice-jobs" },
          { label: "Jobs",      value: jobsTotal, sub: `${jobs.REVIEW ?? 0} review`, href: "/invoice-jobs", warn: (invPipe.schedules?.due_now ?? 0) > 0 && jobsTotal === 0 },
          // Headline is the billable row count — what the generator reads.
          // `locked` is rating-verification state and does not gate billing.
          { label: "Snapshots", value: snapTotal, sub: locked ? `${locked} locked` : "billable rows", href: "/rating-snapshots", warn: jobsTotal > 0 && snapTotal === 0 },
          { label: "Draft",     value: inv.draft ?? 0, href: "/invoices" },
          { label: "Review",    value: jobs.REVIEW ?? 0, href: "/invoice-jobs" },
          { label: "Approved",  value: inv.approved ?? 0, href: "/invoices", warn: (inv.draft ?? 0) > 0 && (inv.approved ?? 0) === 0 && (inv.sent ?? 0) === 0 },
          { label: "Sent",      value: inv.sent ?? 0, sub: sentDeliv ? `${sentDeliv} deliveries` : undefined, href: "/invoices" },
          { label: "Failed",    value: failedDeliv, href: "/invoice-jobs", warn: failedDeliv > 0 },
        ];
        return (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5" /> Invoice Pipeline
              <span className="text-[10px] normal-case font-normal">— click a stage to open its queue</span>
            </h2>
            <div className="flex items-center gap-1.5 flex-wrap">
              {stages.map((s, i) => (
                <div key={s.label} className="flex items-center gap-1.5">
                  {i > 0 && <ArrowRight className="w-3 h-3 text-muted-foreground/50 shrink-0" />}
                  <PipelineStage {...s} />
                </div>
              ))}
            </div>
          </div>
        );
      })()}

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
            coverage={sla.dmr}
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
            slaMinutes={sla.snapshot?.slaMinutes}
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
                    {data.materialization.nextRunEta && (
                      <div className="flex justify-between">
                        <span>Next run (est.)</span>
                        <span className="font-medium text-foreground">
                          {new Date(data.materialization.nextRunEta).getTime() <= Date.now()
                            ? "imminent"
                            : fmtTs(data.materialization.nextRunEta)}
                        </span>
                      </div>
                    )}
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
                {(integrity.accounts?.length ?? 0) > 0 && (
                  <>
                    <Separator />
                    <div className="space-y-1 max-h-44 overflow-y-auto">
                      {[...integrity.accounts]
                        .sort((a: any, b: any) => Number(a.inSnapshot) - Number(b.inSnapshot))
                        .map((a: any) => (
                          <div key={a.accountId} className="flex items-center gap-2 text-xs">
                            {a.inSnapshot
                              ? <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                              : <XCircle className="w-3 h-3 text-red-400 shrink-0" />}
                            <span className={`truncate ${a.inSnapshot ? "text-muted-foreground" : "text-red-400 font-medium"}`}>
                              {a.name}
                            </span>
                          </div>
                        ))}
                    </div>
                    {integrity.accounts.some((a: any) => !a.inSnapshot) && (
                      <p className="text-[11px] text-amber-400">
                        Missing: {integrity.accounts.filter((a: any) => !a.inSnapshot).length} — run materialization to backfill.
                      </p>
                    )}
                  </>
                )}
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

      {/* ── Finance Production Readiness checklist ── */}
      {(data?.readiness?.length ?? 0) > 0 && (
        <Card>
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <ClipboardCheck className="w-4 h-4 text-primary" />
              Finance Production Readiness
              {data.readiness.every((r: any) => r.ok && !r.warn) ? (
                <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-400 border-emerald-500/30">All checks pass</Badge>
              ) : (
                <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-400 border-amber-500/30">
                  {data.readiness.filter((r: any) => !r.ok).length} blocking · {data.readiness.filter((r: any) => r.ok && r.warn).length} advisory
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2">
              {data.readiness.map((r: any) => (
                <div key={r.key} className="flex items-start gap-2" data-testid={`readiness-${r.key}`}>
                  {!r.ok
                    ? <XCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                    : r.warn
                      ? <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                      : <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />}
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-tight">{r.label}</p>
                    <p className={`text-xs ${!r.ok ? "text-red-400" : r.warn ? "text-amber-400" : "text-muted-foreground"}`}>{r.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

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
        {build.buildTime && (
          <div className="flex items-center gap-1.5">
            Built: <span className="font-mono text-foreground">{new Date(build.buildTime).toUTCString()}</span>
          </div>
        )}
        {build.buildSource === 'git' && (
          <div className="flex items-center gap-1.5 text-amber-400">
            running from source, not a published build
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
