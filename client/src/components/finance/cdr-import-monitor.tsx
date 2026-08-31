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
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { Database, Radio, AlertTriangle, CheckCircle2, Loader2, Power } from "lucide-react";

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
  /** Resolved server-side from companies.sippy_i_account. Null when the id
   *  matches nothing, or when it is SHARED — see customerClaimants. */
  customerName?: string | null;
  customerClaimants?: string[];
}

const num = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString());

/**
 * Who is being collected — the operator's question, in their words.
 *
 * "account 58" is an internal identifier and this panel was the last Finance
 * surface still leading with one. The id is kept as a subtitle because it is
 * what the job row, the log line and Sippy all use when something goes wrong.
 *
 * A SHARED account is named as shared rather than resolved to a guess: account
 * 76 belongs to both `Internal-ptcl` and `ptcl` in production, and printing
 * either one would attribute a collection run to a customer it may not concern.
 */
function customerLabel(j: SeedJobRow): { title: string; subtitle: string; ambiguous: boolean } {
  const acct = j.iAccount == null ? "no account" : `Account #${j.iAccount}`;
  const claimants = j.customerClaimants ?? [];
  if (claimants.length > 1) {
    return { title: claimants.join(" / "), subtitle: `${acct} — shared by ${claimants.length} companies`, ambiguous: true };
  }
  if (j.customerName) return { title: j.customerName, subtitle: acct, ambiguous: false };
  return { title: acct, subtitle: "no company linked to this account", ambiguous: false };
}

/** A missing tariff mirror is a normal state since collection was decoupled
 *  from it — but "tariff null" reads as a fault. Say what it means. */
const tariffLabel = (t: string | null) => (t ? `tariff ${t}` : "no local tariff mapping");

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
  const acctJob = running[0] ?? recent[0] ?? null;
  const acct = acctJob?.iAccount ?? null;
  /** Same naming rule as the job rows — one resolver, so the header and the
   *  row beneath it can never disagree about who this is. */
  const acctLabel = acctJob ? customerLabel(acctJob).title +
    (customerLabel(acctJob).ambiguous || !acctJob.customerName ? "" : ` · #${acct}`) : `account ${acct}`;
  const nextDay = day ? new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10) : null;

  const completeness = useQuery<any>({
    queryKey: [`/api/finance/cdr-repository/completeness?iAccount=${acct}&from=${day}&to=${nextDay}`],
    enabled: !!day && !!acct && !!nextDay,
    refetchInterval: running.length > 0 ? ACTIVE_POLL_MS * 2 : IDLE_POLL_MS,
  });

  const cap = capture.data;

  /**
   * Arming, from the platform.
   *
   * It used to live only in process.env.FORWARD_CAPTURE. Ten republishes were
   * spent trying to set it and every one came back observe_only — on Replit a
   * deployment's secrets are a separate store from the workspace Secrets that
   * were being edited, so the deployed process never saw the value. Migration
   * 085 moved the switch to the audited platform_feature_flags row, re-read
   * every tick, and this is the button for it: no republish, no console, and
   * the change is recorded against whoever clicked it.
   */
  const qc = useQueryClient();
  const { toast } = useToast();
  const [pendingArm, setPendingArm] = useState(false);
  const armed = cap?.mode === "armed";
  // The env var can arm a process the flag cannot disarm. That is legitimate —
  // it needs deployment access — but it must never be a surprise, so the button
  // says so instead of pretending it is in control.
  const envOverrides = cap?.armedBy === "env" || cap?.armedBy === "both";

  const armMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await apiRequest("PATCH", "/api/platform/flags/forward_capture", {
        enabled,
        reason: enabled
          ? "Armed from the Finance Operations Center — unattended CDR collection ON."
          : "Disarmed from the Finance Operations Center — collection returns to observe-only.",
      });
      return res.json();
    },
    onSuccess: (_d, enabled) => {
      toast({
        title: enabled ? "Forward capture armed" : "Forward capture disarmed",
        // Honest about the delay rather than implying an instant effect: the
        // scheduler reads the flag on its own tick, up to ten minutes away.
        description: enabled
          ? "The collector picks this up on its next tick — within 10 minutes it starts fetching the oldest owed day."
          : "The collector returns to observe-only on its next tick.",
      });
      setPendingArm(false);
      qc.invalidateQueries({ queryKey: ["/api/finance/forward-capture"] });
    },
    onError: (e: any) => {
      setPendingArm(false);
      toast({
        variant: "destructive",
        title: "Could not change the flag",
        // 404 means migration 085 has not run on this deployment — a specific
        // cause with a specific fix, worth saying rather than "request failed".
        description: e?.status === 404
          ? "No forward_capture flag row — migration 085 has not run on this deployment yet."
          : e?.status === 403
            ? "This action needs an admin or super_admin role."
            : String(e?.message ?? e),
      });
    },
  });

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
              {/* Working, and saying so. A collection holds the tick for as
                  long as it runs — 23 minutes on 08-28 — and the clock cannot
                  advance meanwhile. Announcing that as a possible stoppage
                  raised an alarm at the exact moment it was working. */}
              {cap.collecting && (
                <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                  <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                  <span>
                    Collecting <span className="font-medium">{cap.collectingDate}</span> — started{" "}
                    {cap.collectingSince?.slice(11, 19)} UTC
                    {cap.ticksSkippedBusy > 0 && ` · ${cap.ticksSkippedBusy} tick(s) deferred while busy`}
                  </span>
                </div>
              )}
              {cap.mode !== "unregistered" && !cap.alive && (
                <div className="flex items-start gap-1 text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  {/* "No tick" and "every tick is dying" are different faults
                      with different fixes, and they used to print the same. */}
                  <span>
                    {cap.lastTickError
                      ? <>Ticks are failing ({cap.tickErrors} so far, latest {cap.lastTickErrorAt?.slice(11, 19)} UTC):{" "}
                        <span className="font-medium">{cap.lastTickError}</span></>
                      : <>No completed tick in over {Math.round((cap.checkIntervalMs * 2) / 60000)} minutes — the scheduler may have stopped.</>}
                  </span>
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
              {/* A day the scheduler stopped retrying is a HOLE in the billing
                  week. It must be impossible to miss, including when a later
                  day is collecting normally and everything else looks green. */}
              {cap.lastDecision?.exhaustedDates?.length > 0 && (
                <div className="flex items-start gap-1 rounded bg-destructive/10 p-2 text-destructive">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>
                    Gave up on {cap.lastDecision.exhaustedDates.join(", ")} — these days are
                    NOT collected. Re-run manually with a 10-minute slice override.
                  </span>
                </div>
              )}
              {/* SOURCE, stated rather than inferred. "Armed" alone does not
                  say who armed it, and six months from now the difference
                  between a flag someone set and an environment variable
                  nobody remembers is the whole question. An unreadable flag
                  is its own case and never prints as "off". */}
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground/70">Source</span>
                <span className={
                  cap.flagValueSeen?.startsWith("(could not read")
                    ? "font-medium text-amber-600 dark:text-amber-400"
                    : cap.flagValueSeen?.startsWith("(not read yet")
                      ? "font-medium text-muted-foreground"
                      : "font-medium text-foreground"
                }>
                  {cap.flagValueSeen?.startsWith("(could not read") ? "Database unreadable"
                    : cap.flagValueSeen?.startsWith("(not read yet") ? "Reading on first tick…"
                    : cap.armedBy === "flag" ? "Feature flag"
                    : cap.armedBy === "env"  ? "Environment variable"
                    : cap.armedBy === "both" ? "Feature flag + environment variable"
                    : "Not armed by either source"}
                </span>
                {cap.flagReadRetries > 0 && (
                  <span className="text-muted-foreground/70">
                    · {cap.flagReadRetries} flag-read {cap.flagReadRetries === 1 ? "retry" : "retries"}
                  </span>
                )}
              </div>
              <div>{cap.armHint}</div>
            </div>
          )}

          {/* ── Arm / disarm ──────────────────────────────────────────────
              Arming turns on unattended writes to the CDR repository, so it
              confirms once. Disarming is immediate — a stop must never be
              harder than a start. */}
          {cap && cap.mode !== "unregistered" && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
              {armed ? (
                <>
                  <Button
                    size="sm" variant="outline"
                    disabled={armMutation.isPending || envOverrides}
                    onClick={() => armMutation.mutate(false)}
                    data-testid="button-disarm-forward-capture"
                  >
                    {armMutation.isPending
                      ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      : <Power className="mr-1.5 h-3.5 w-3.5" />}
                    Disarm
                  </Button>
                  {envOverrides && (
                    <span className="text-xs text-amber-600 dark:text-amber-400">
                      Armed by the deployment environment — the flag cannot disarm it.
                    </span>
                  )}
                </>
              ) : pendingArm ? (
                <>
                  <span className="text-xs text-muted-foreground">
                    Start collecting {cap.lastDecision?.targetDate ?? "the oldest owed day"} and
                    everything owed after it?
                  </span>
                  <Button
                    size="sm" disabled={armMutation.isPending}
                    onClick={() => armMutation.mutate(true)}
                    data-testid="button-confirm-arm-forward-capture"
                  >
                    {armMutation.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                    Yes, arm it
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setPendingArm(false)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button
                  size="sm" onClick={() => setPendingArm(true)}
                  data-testid="button-arm-forward-capture"
                >
                  <Power className="mr-1.5 h-3.5 w-3.5" />
                  Arm collection
                </Button>
              )}
            </div>
          )}
        </div>

        {/* ── Active imports ──────────────────────────────────────────────────
            "No import running" is only true when the COLLECTOR is also idle.
            A run does more than fetch: after an account's CDRs land it rates
            and snapshots them, and that stage writes no seed_jobs row. On
            2026-08-29 account 315 that took eight minutes — 1,033 CDRs — during
            which this card said nothing was running while the process was fully
            occupied. It read as a stall twice before anyone checked.

            This panel knows about seed_jobs only, so work outside that table is
            silence, and silence reads as failure. The collector's own state
            says otherwise, so ask it. */}
        {running.length === 0 && (
          <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            {cap?.collecting
              ? <span className="flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Between accounts — rating and snapshotting the batch just fetched.
                  No CDRs are being downloaded right now.
                </span>
              : "No import running."}
          </div>
        )}

        {running.map(job => {
          const pct = job.totalSlices > 0
            ? Math.round((job.completedSlices / job.totalSlices) * 100) : 0;
          const remaining = eta(job);
          const who = customerLabel(job);
          return (
            <div key={job.jobId} className="rounded-md border p-3 space-y-3" data-testid={`import-${job.jobId}`}>
              <div className="flex items-start justify-between gap-2">
                {/* Customer first, identifier underneath. An operator asks WHO
                    is being collected; the id is what they need only once
                    something has gone wrong. */}
                <div>
                  <div className="text-sm font-medium">
                    {who.title}
                    {who.ambiguous && (
                      <span className="ml-1.5 text-xs font-normal text-amber-600 dark:text-amber-400">
                        ambiguous
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {job.periodStart}
                    {job.periodEnd !== job.periodStart && ` → ${job.periodEnd}`}
                    {" · "}{who.subtitle} · {tariffLabel(job.iTariff)} · {job.sliceMinutes}-min slices
                  </div>
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
                {acctLabel}
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
              {/* Every row said only the DATE, so a run over seven accounts on
                  one day rendered as seven identical lines. The customer is
                  what distinguishes them. */}
              {recent.map(job => {
                const who = customerLabel(job);
                return (
                  <div key={job.jobId} className="flex items-center justify-between gap-2 rounded border px-2 py-1.5 text-xs">
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{who.title}</span>
                      <span className="ml-1.5 text-muted-foreground tabular-nums">{job.periodStart}</span>
                    </span>
                    <span className="shrink-0 text-muted-foreground tabular-nums">
                      {job.completedSlices}/{job.totalSlices} · {num(job.storedTotal)} stored · {elapsed(job.startedAt, job.finishedAt)}
                    </span>
                    <StatusBadge status={job.status} />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
