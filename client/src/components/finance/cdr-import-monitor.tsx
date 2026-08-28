/**
 * cdr-import-monitor.tsx — operating the CDR importer without a console.
 *
 * Every number here was already reachable through an endpoint. For a week the
 * only way to read them was pasting fetch() into DevTools, which is a debugging
 * technique, not an operating model for a billing platform. This card consumes
 * what already exists:
 *
 *   GET /api/rating-snapshots/seed-jobs      durable job rows (migration 082)
 *   GET /api/finance/forward-capture         scheduler mode, liveness, decision
 *   GET /api/finance/cdr-repository/completeness   stage counts for one day
 *
 * No new capability, no new page — a panel on the Finance Operations Center.
 *
 * Polling is adaptive: fast while a job is running, slow when nothing is, so an
 * idle tab does not hammer an instance that has already shown it dislikes load.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Database, Radio, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

const ACTIVE_POLL_MS = 4_000;
const IDLE_POLL_MS   = 30_000;

interface SeedJobRow {
  jobId: string;
  iAccount: number | null;
  iTariff: string | null;
  periodStart: string;
  periodEnd: string;
  sliceMinutes: number;
  totalSlices: number;
  completedSlices: number;
  currentSlice: string | null;
  status: "running" | "done" | "error" | string;
  lastError: string | null;
  fetchedTotal: number;
  storedTotal: number;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

const num = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString());

function elapsed(fromIso: string, toIso?: string | null): string {
  const a = Date.parse(fromIso);
  const b = toIso ? Date.parse(toIso) : Date.now();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return "—";
  const s = Math.max(0, Math.round((b - a) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

/**
 * Remaining time from THIS run's own pace, not a constant. Withheld until a few
 * slices have completed — an estimate drawn from one sample is a guess wearing
 * a number's clothes.
 */
function eta(job: SeedJobRow): string | null {
  if (job.status !== "running" || job.completedSlices < 3) return null;
  const spent = Date.now() - Date.parse(job.startedAt);
  if (!Number.isFinite(spent) || spent <= 0) return null;
  const per = spent / job.completedSlices;
  const left = Math.max(0, job.totalSlices - job.completedSlices) * per;
  const m = Math.round(left / 60000);
  return m < 1 ? "under a minute" : m < 60 ? `≈ ${m} min` : `≈ ${(m / 60).toFixed(1)} h`;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "running") {
    return <Badge className="bg-blue-500/15 text-blue-600 dark:text-blue-400 gap-1">
      <Loader2 className="h-3 w-3 animate-spin" />Running</Badge>;
  }
  if (status === "done") {
    return <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 gap-1">
      <CheckCircle2 className="h-3 w-3" />Complete</Badge>;
  }
  return <Badge variant="destructive" className="gap-1">
    <AlertTriangle className="h-3 w-3" />Failed</Badge>;
}

function Stat({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-sm font-medium tabular-nums ${muted ? "text-muted-foreground" : ""}`}>{value}</div>
    </div>
  );
}

export function CdrImportMonitor() {
  const jobsQ = useQuery<{ jobs: SeedJobRow[] }>({
    queryKey: ["/api/rating-snapshots/seed-jobs?limit=8"],
    refetchInterval: (q: any) => {
      const rows: SeedJobRow[] = q?.state?.data?.jobs ?? [];
      return rows.some(j => j.status === "running") ? ACTIVE_POLL_MS : IDLE_POLL_MS;
    },
  });

  const capture = useQuery<any>({
    queryKey: ["/api/finance/forward-capture"],
    refetchInterval: IDLE_POLL_MS,
  });

  const jobs    = jobsQ.data?.jobs ?? [];
  const running = useMemo(() => jobs.filter(j => j.status === "running"), [jobs]);
  const recent  = useMemo(() => jobs.filter(j => j.status !== "running").slice(0, 4), [jobs]);

  // Completeness for the day the active job is importing — the question an
  // operator actually has ("is this day whole yet"), answered without typing.
  const day = running[0]?.periodStart ?? recent[0]?.periodStart ?? null;
  const acct = running[0]?.iAccount ?? recent[0]?.iAccount ?? null;
  const nextDay = day ? new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10) : null;

  const completeness = useQuery<any>({
    queryKey: [`/api/finance/cdr-repository/completeness?iAccount=${acct}&from=${day}&to=${nextDay}`],
    enabled: !!day && !!acct && !!nextDay,
    refetchInterval: running.length > 0 ? ACTIVE_POLL_MS * 2 : IDLE_POLL_MS,
  });

  const cap = capture.data;

  return (
    <Card data-testid="card-cdr-import-monitor">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Database className="h-4 w-4" />
          CDR Import
          {running.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground">
              {running.length} active
            </span>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* ── Forward capture ─────────────────────────────────────────────── */}
        <div className="rounded-md border p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Radio className="h-3.5 w-3.5" />Forward capture
            </div>
            {cap?.mode === "armed"
              ? <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">Armed</Badge>
              : cap?.mode === "observe_only"
                ? <Badge variant="secondary">Observe only</Badge>
                : <Badge variant="outline">Unknown</Badge>}
          </div>

          {cap && (
            <div className="mt-2 space-y-1 text-xs text-muted-foreground">
              {/* A scheduler that stopped must not look like one that is idle. */}
              {cap.mode !== "unregistered" && !cap.alive && (
                <div className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-3 w-3" />
                  No tick in over {Math.round((cap.checkIntervalMs * 2) / 60000)} minutes — the scheduler may have stopped.
                </div>
              )}
              {cap.lastDecision && (
                <div>
                  {cap.lastDecision.due
                    ? <>Owes <span className="font-medium text-foreground">{cap.lastDecision.targetDate}</span>
                      {cap.lastDecision.backlog > 1 && ` (${cap.lastDecision.backlog} days behind)`}</>
                    : <>Nothing owed — {cap.lastDecision.reason}</>}
                </div>
              )}
              <div>{cap.armHint}</div>
            </div>
          )}
        </div>

        {/* ── Active imports ──────────────────────────────────────────────── */}
        {running.length === 0 && (
          <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            No import running.
          </div>
        )}

        {running.map(job => {
          const pct = job.totalSlices > 0
            ? Math.round((job.completedSlices / job.totalSlices) * 100) : 0;
          const remaining = eta(job);
          return (
            <div key={job.jobId} className="rounded-md border p-3 space-y-3" data-testid={`import-${job.jobId}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">
                  {job.periodStart}
                  {job.periodEnd !== job.periodStart && ` → ${job.periodEnd}`}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    account {job.iAccount} · tariff {job.iTariff} · {job.sliceMinutes}-min slices
                  </span>
                </div>
                <StatusBadge status={job.status} />
              </div>

              <div>
                <Progress value={pct} className="h-2" />
                <div className="mt-1 flex justify-between text-xs text-muted-foreground tabular-nums">
                  <span>{job.completedSlices} / {job.totalSlices} slices{job.currentSlice ? ` · ${job.currentSlice}` : ""}</span>
                  <span>{elapsed(job.startedAt)}{remaining ? ` · ${remaining} left` : ""}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Fetched" value={num(job.fetchedTotal)} />
                <Stat label="Stored" value={num(job.storedTotal)} />
                <Stat label="Job" value={job.jobId.replace(/^sj-\d+-/, "")} muted />
                <Stat label="Started" value={new Date(job.startedAt).toLocaleTimeString()} muted />
              </div>

              {job.lastError && (
                <div className="rounded bg-destructive/10 p-2 text-xs text-destructive break-words">
                  {job.lastError}
                </div>
              )}
            </div>
          );
        })}

        {/* ── Repository completeness for that day ────────────────────────── */}
        {completeness.data?.repository && (
          <div className="rounded-md border p-3">
            <div className="mb-2 text-sm font-medium">
              Repository · {day}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                account {acct}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Repository" value={num(completeness.data.repository.calls)} />
              <Stat label="Verified"    value={num(completeness.data.verified?.calls)} />
              <Stat label="Snapshotted" value={num(completeness.data.snapshotted?.calls)} />
            </div>
            {/*
              The stages are DERIVED from one another, so agreement proves only
              that nothing was lost after ingestion — never that everything the
              switch holds was imported. Said here so the panel cannot be read
              as a completeness guarantee it does not provide.
            */}
            <div className="mt-2 text-[11px] text-muted-foreground">
              Stages derive from the repository — agreement shows nothing was lost after
              ingestion, not that the import was complete. That needs a Sippy reference.
            </div>
          </div>
        )}

        {/* ── Recent jobs ─────────────────────────────────────────────────── */}
        {recent.length > 0 && (
          <div>
            <div className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">Recent</div>
            <div className="space-y-1">
              {recent.map(job => (
                <div key={job.jobId} className="flex items-center justify-between gap-2 rounded border px-2 py-1.5 text-xs">
                  <span className="font-medium tabular-nums">{job.periodStart}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {job.completedSlices}/{job.totalSlices} · {num(job.storedTotal)} stored · {elapsed(job.startedAt, job.finishedAt)}
                  </span>
                  <StatusBadge status={job.status} />
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
