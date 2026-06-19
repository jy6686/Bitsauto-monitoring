import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FlaskConical, Plus, Play, Trash2, RefreshCw, CheckCircle2, Clock, X,
  ChevronDown, ChevronUp, AlertTriangle, Timer, ToggleLeft, ToggleRight,
  Activity, TrendingDown, History, Zap, ArrowDown, BarChart3, Star,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

interface CampaignDestination { cld: string; cli?: string; label?: string; }
interface TestCampaign {
  id: number; name: string; destinations: string; scheduleType: string;
  scheduledAt: string | null; cronHour: number | null;
  intervalMinutes: number | null; nextRunAt: string | null;
  enabled: boolean; baselineAsr: number | null; baselinePdd: number | null;
  status: string; lastRunAt: string | null; createdAt: string;
}
interface CampaignResult {
  id: number; campaignId: number; runAt: string;
  cld: string; cli: string | null; label: string | null;
  outcome: string; sipCode: number | null; durationSec: number | null;
  pddMs: number | null; fasDetected: boolean; notes: string | null;
}
interface SyntheticTestRun {
  id: number; campaignId: number; startedAt: string; completedAt: string | null;
  totalCalls: number; connectedCalls: number; failedCalls: number;
  asr: number | null; avgPddMs: number | null; baselineAsrAtRun: number | null;
  anomalyFired: boolean; degradedVsLastRun: boolean; triggeredBy: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const INTERVAL_OPTIONS = [
  { value: "15",   label: "Every 15 min" },
  { value: "30",   label: "Every 30 min" },
  { value: "60",   label: "Every 1 hour" },
  { value: "120",  label: "Every 2 hours" },
  { value: "360",  label: "Every 6 hours" },
  { value: "720",  label: "Every 12 hours" },
  { value: "1440", label: "Every 24 hours" },
];

function intervalLabel(mins: number | null): string {
  if (!mins) return "";
  const opt = INTERVAL_OPTIONS.find(o => Number(o.value) === mins);
  return opt ? opt.label : `Every ${mins}m`;
}

function nextRunCountdown(nextRunAt: string | null): string {
  if (!nextRunAt) return "";
  const diff = new Date(nextRunAt).getTime() - Date.now();
  if (diff <= 0) return "Due now";
  const m = Math.floor(diff / 60_000);
  const h = Math.floor(m / 60);
  if (h > 0) return `in ${h}h ${m % 60}m`;
  return `in ${m}m`;
}

function asrColor(asr: number): string {
  if (asr >= 80) return "text-emerald-400";
  if (asr >= 60) return "text-amber-400";
  return "text-rose-400";
}

// ── Badges ────────────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, string> = {
    pending: "bg-muted/20 text-muted-foreground",
    running: "bg-blue-500/15 text-blue-400 border border-blue-500/25",
    done:    "bg-emerald-500/15 text-emerald-400 border border-emerald-500/25",
    failed:  "bg-rose-500/15 text-rose-400 border border-rose-500/25",
  };
  return (
    <span className={cn("inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold", cfg[status] ?? cfg.pending)}>
      {status}
    </span>
  );
}

function OutcomeBadge({ outcome, fas }: { outcome: string; fas: boolean }) {
  if (fas)
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-orange-500/15 text-orange-400 border border-orange-500/25"><AlertTriangle className="w-3 h-3" />FAS</span>;
  if (outcome === "connected")
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/25"><CheckCircle2 className="w-3 h-3" />Connected</span>;
  if (outcome === "timeout")
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/25"><Clock className="w-3 h-3" />Timeout</span>;
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/25"><X className="w-3 h-3" />Failed</span>;
}

// ── Individual call results panel ─────────────────────────────────────────────
function ResultsPanel({ campaignId }: { campaignId: number }) {
  const { data: results = [], isLoading } = useQuery<CampaignResult[]>({
    queryKey: ["/api/campaigns", campaignId, "results"],
    queryFn: () => fetch(`/api/campaigns/${campaignId}/results`).then(r => r.json()),
  });

  if (isLoading) return <div className="text-xs text-muted-foreground p-4">Loading results…</div>;
  if (!results.length) return (
    <div className="text-xs text-muted-foreground p-4">No results yet. Run the campaign to see call outcomes.</div>
  );

  return (
    <div className="border-t border-border/30 overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-muted/10">
          <tr>
            {["Time","Destination","CLI","Outcome","SIP","Duration","PDD"].map(h => (
              <th key={h} className="px-3 py-2 text-left text-muted-foreground font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {results.map(r => (
            <tr key={r.id} className="border-t border-border/20 hover:bg-muted/10">
              <td className="px-3 py-2 text-muted-foreground">{new Date(r.runAt).toLocaleString()}</td>
              <td className="px-3 py-2 font-mono">{r.label ? `${r.label} (${r.cld})` : r.cld}</td>
              <td className="px-3 py-2 font-mono text-muted-foreground">{r.cli || "—"}</td>
              <td className="px-3 py-2"><OutcomeBadge outcome={r.outcome} fas={r.fasDetected} /></td>
              <td className="px-3 py-2 font-mono">{r.sipCode ?? "—"}</td>
              <td className="px-3 py-2 font-mono">{r.durationSec != null ? `${r.durationSec.toFixed(1)}s` : "—"}</td>
              <td className="px-3 py-2 font-mono">{r.pddMs != null ? `${r.pddMs.toFixed(0)}ms` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Scheduled run history panel ───────────────────────────────────────────────
function RunHistoryPanel({ campaignId, baseline }: { campaignId: number; baseline: number | null }) {
  const { data: runs = [], isLoading } = useQuery<SyntheticTestRun[]>({
    queryKey: ["/api/campaigns", campaignId, "runs"],
    queryFn: () => fetch(`/api/campaigns/${campaignId}/runs`).then(r => r.json()),
    refetchInterval: 30_000,
  });

  if (isLoading) return <div className="text-xs text-muted-foreground p-4">Loading run history…</div>;
  if (!runs.length) return (
    <div className="text-xs text-muted-foreground p-4 flex items-center gap-2">
      <History className="w-4 h-4 opacity-40" />
      No scheduled runs yet. The scheduler fires at your configured interval.
    </div>
  );

  return (
    <div className="border-t border-border/30">
      {baseline != null && (
        <div className="flex items-center gap-2 px-4 py-2 bg-muted/10 border-b border-border/20">
          <Activity className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-xs text-muted-foreground">Rolling baseline ASR:</span>
          <span className={cn("text-xs font-bold", asrColor(baseline))}>{baseline.toFixed(1)}%</span>
          <span className="text-xs text-muted-foreground ml-1">(avg of last 10 scheduled runs)</span>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/10">
            <tr>
              {["Fired","By","Calls","ASR","vs Baseline","Avg PDD","Anomaly"].map(h => (
                <th key={h} className="px-3 py-2 text-left text-muted-foreground font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {runs.map(r => {
              const vs = r.baselineAsrAtRun != null && r.asr != null ? r.asr - r.baselineAsrAtRun : null;
              const isProblematic = r.anomalyFired || r.degradedVsLastRun;
              return (
                <tr key={r.id} className={cn(
                  "border-t border-border/20 hover:bg-muted/10",
                  r.anomalyFired ? "bg-rose-500/5" : r.degradedVsLastRun ? "bg-amber-500/5" : ""
                )}>
                  <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                    {new Date(r.startedAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">
                    <span className={cn(
                      "inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold",
                      r.triggeredBy === "scheduler"
                        ? "bg-violet-500/15 text-violet-400"
                        : "bg-blue-500/15 text-blue-400"
                    )}>{r.triggeredBy}</span>
                  </td>
                  <td className="px-3 py-2 font-mono">{r.connectedCalls}/{r.totalCalls}</td>
                  <td className="px-3 py-2 font-mono">
                    {r.asr != null
                      ? <span className={asrColor(r.asr)}>{r.asr.toFixed(1)}%</span>
                      : "—"}
                  </td>
                  <td className="px-3 py-2 font-mono">
                    {vs != null
                      ? <span className={vs >= 0 ? "text-emerald-400" : "text-rose-400"}>
                          {vs >= 0 ? "+" : ""}{vs.toFixed(1)}pp
                        </span>
                      : "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-muted-foreground">
                    {r.avgPddMs != null ? `${r.avgPddMs.toFixed(0)}ms` : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col gap-0.5">
                      {r.anomalyFired && (
                        <span className="inline-flex items-center gap-1 text-rose-400 font-semibold text-[11px]">
                          <TrendingDown className="w-3 h-3" />ANOMALY
                        </span>
                      )}
                      {r.degradedVsLastRun && !r.anomalyFired && (
                        <span className="inline-flex items-center gap-1 text-amber-400 font-semibold text-[11px]">
                          <ArrowDown className="w-3 h-3" />DEGRADED
                        </span>
                      )}
                      {r.degradedVsLastRun && r.anomalyFired && (
                        <span className="inline-flex items-center gap-1 text-amber-400/70 text-[10px]">
                          <ArrowDown className="w-2.5 h-2.5" />vs last run
                        </span>
                      )}
                      {!isProblematic && (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Campaign card ─────────────────────────────────────────────────────────────
function CampaignCard({ campaign }: { campaign: TestCampaign }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<"calls" | "runs">("calls");

  // Fetch latest run to surface degradation at the card level
  const { data: latestRuns = [] } = useQuery<SyntheticTestRun[]>({
    queryKey: ["/api/campaigns", campaign.id, "runs"],
    queryFn: () => fetch(`/api/campaigns/${campaign.id}/runs`).then(r => r.json()),
    staleTime: 30_000,
    refetchInterval: 60_000,
    enabled: campaign.scheduleType === "interval" && !!campaign.intervalMinutes,
  });
  const latestRun = latestRuns[0] ?? null;
  const isDegradedLatest = latestRun?.degradedVsLastRun && !latestRun?.anomalyFired;
  const isAnomalyLatest  = latestRun?.anomalyFired;

  const dests: CampaignDestination[] = (() => {
    try { return JSON.parse(campaign.destinations); } catch { return []; }
  })();

  const isScheduled = campaign.scheduleType === "interval" && !!campaign.intervalMinutes;

  const runMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/campaigns/${campaign.id}/run`, {}),
    onSuccess: () => {
      toast({ title: "Campaign started", description: `${dests.length} test call(s) queued.` });
      qc.invalidateQueries({ queryKey: ["/api/campaigns"] });
      setTimeout(() => qc.invalidateQueries({ queryKey: ["/api/campaigns", campaign.id, "results"] }), 8000);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/campaigns/${campaign.id}`),
    onSuccess: () => {
      toast({ title: "Campaign deleted" });
      qc.invalidateQueries({ queryKey: ["/api/campaigns"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/campaigns/${campaign.id}/toggle`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/campaigns"] }),
    onError: (e: any) => toast({ title: "Toggle failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div
      className={cn(
        "rounded-xl border bg-card overflow-hidden transition-opacity",
        campaign.enabled ? "border-border/50" : "border-border/20 opacity-60"
      )}
      data-testid={`card-campaign-${campaign.id}`}
    >
      {/* Header row */}
      <div className="flex items-start gap-4 p-4">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-sm truncate" data-testid={`text-campaign-name-${campaign.id}`}>
              {campaign.name}
            </span>
            <StatusBadge status={campaign.status} />

            {isScheduled && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-violet-500/15 text-violet-400 border border-violet-500/25">
                <Zap className="w-2.5 h-2.5" />
                {intervalLabel(campaign.intervalMinutes)}
              </span>
            )}

            {campaign.baselineAsr != null && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
                <Activity className="w-2.5 h-2.5" />
                Baseline {campaign.baselineAsr.toFixed(1)}%
              </span>
            )}

            {isAnomalyLatest && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/20 border border-rose-500/40 text-rose-300 animate-pulse">
                <TrendingDown className="w-2.5 h-2.5" />
                ANOMALY — last run
              </span>
            )}
            {isDegradedLatest && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/15 border border-amber-500/30 text-amber-300">
                <ArrowDown className="w-2.5 h-2.5" />
                DEGRADED vs prev run
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-xs text-muted-foreground">
            <span>{dests.length} destination{dests.length !== 1 ? "s" : ""}</span>
            {campaign.lastRunAt && (
              <span>Last run: {new Date(campaign.lastRunAt).toLocaleString()}</span>
            )}
            {isScheduled && campaign.nextRunAt && campaign.enabled && (
              <span className="flex items-center gap-1 text-violet-400">
                <Timer className="w-3 h-3" />
                Next: {nextRunCountdown(campaign.nextRunAt)}
              </span>
            )}
            {!isScheduled && campaign.scheduleType === "daily" && (
              <span>Daily at {campaign.cronHour ?? 8}:00 UTC</span>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {isScheduled && (
            <button
              data-testid={`button-toggle-campaign-${campaign.id}`}
              onClick={() => toggleMutation.mutate()}
              disabled={toggleMutation.isPending}
              title={campaign.enabled ? "Pause scheduler" : "Resume scheduler"}
              className="p-1.5 rounded-lg hover:bg-muted/30 transition-colors"
            >
              {campaign.enabled
                ? <ToggleRight className="w-5 h-5 text-emerald-400" />
                : <ToggleLeft className="w-5 h-5 text-muted-foreground" />}
            </button>
          )}

          <Button
            size="sm"
            variant="outline"
            onClick={() => runMutation.mutate()}
            disabled={runMutation.isPending || campaign.status === "running"}
            data-testid={`button-run-campaign-${campaign.id}`}
            className="h-8 text-xs"
          >
            {runMutation.isPending
              ? <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              : <Play className="w-3.5 h-3.5 mr-1.5" />}
            {campaign.status === "running" ? "Running…" : "Run Now"}
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={() => { if (confirm("Delete this campaign and all its results?")) deleteMutation.mutate(); }}
            disabled={deleteMutation.isPending}
            data-testid={`button-delete-campaign-${campaign.id}`}
            className="h-8 w-8 p-0 text-muted-foreground hover:text-rose-400"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>

          <button
            onClick={() => setExpanded(v => !v)}
            data-testid={`button-expand-campaign-${campaign.id}`}
            className="p-1.5 rounded-lg hover:bg-muted/30 transition-colors text-muted-foreground"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Expanded section */}
      {expanded && (
        <>
          {/* Tab bar */}
          <div className="flex border-t border-border/30 bg-muted/5">
            <button
              onClick={() => setTab("calls")}
              className={cn(
                "px-4 py-2 text-xs font-medium border-b-2 transition-colors",
                tab === "calls"
                  ? "border-cyan-400 text-cyan-400"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              Individual Calls
            </button>
            {isScheduled && (
              <button
                onClick={() => setTab("runs")}
                className={cn(
                  "px-4 py-2 text-xs font-medium border-b-2 transition-colors",
                  tab === "runs"
                    ? "border-violet-400 text-violet-400"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                Scheduled Run History
              </button>
            )}
          </div>

          {tab === "calls" && <ResultsPanel campaignId={campaign.id} />}
          {tab === "runs"  && <RunHistoryPanel campaignId={campaign.id} baseline={campaign.baselineAsr} />}
        </>
      )}
    </div>
  );
}

// ── Carrier Quality Matrix ────────────────────────────────────────────────────

interface CarrierMatrixRow {
  carrier: string;
  total: number;
  connected: number;
  failed: number;
  asr: number | null;
  avgPddMs: number | null;
  avgDurSec: number | null;
  estimatedMos: number | null;
  grade: string;
  topErrors: { code: number; count: number }[];
}
interface CarrierMatrix { rows: CarrierMatrixRow[]; total: number; windowDays: number; }

function mosGradeColor(grade: string): string {
  return grade === 'A' ? 'text-emerald-400' : grade === 'B' ? 'text-cyan-400' :
    grade === 'C' ? 'text-amber-400' : grade === 'D' ? 'text-orange-400' :
    grade === 'F' ? 'text-rose-400' : 'text-muted-foreground';
}
function mosColor(m: number | null): string {
  if (m === null) return 'text-muted-foreground/50';
  return m >= 4.0 ? 'text-emerald-400' : m >= 3.5 ? 'text-cyan-400' : m >= 3.0 ? 'text-amber-400' : 'text-rose-400';
}

function CarrierMatrixPanel() {
  const [open, setOpen] = useState(true);
  const { data, isLoading } = useQuery<CarrierMatrix>({
    queryKey: ['/api/campaigns/carrier-matrix'],
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });

  return (
    <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-muted/5 transition-colors"
        onClick={() => setOpen(v => !v)}
        data-testid="button-toggle-carrier-matrix"
      >
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-cyan-400" />
          <h2 className="text-sm font-semibold">Carrier Quality Matrix</h2>
          <span className="text-[10px] text-muted-foreground/60">
            PESQ/MOS estimates from synthetic test results — last 30 days
          </span>
        </div>
        <div className="flex items-center gap-2">
          {data?.rows?.length ? (
            <span className="text-[10px] text-muted-foreground">{data.rows.length} carriers · {data.total} traces</span>
          ) : null}
          {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </div>
      </button>

      {open && (
        <>
          {isLoading ? (
            <div className="p-4 space-y-2 border-t border-border/30">
              <div className="h-6 bg-muted/20 rounded w-full animate-pulse" />
              <div className="h-6 bg-muted/20 rounded w-4/5 animate-pulse" />
              <div className="h-6 bg-muted/20 rounded w-3/5 animate-pulse" />
            </div>
          ) : !data?.rows?.length ? (
            <div className="border-t border-border/30 px-5 py-8 text-center">
              <Star className="h-8 w-8 mx-auto text-muted-foreground/20 mb-3" />
              <p className="text-sm text-muted-foreground">No carrier data yet.</p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                Run interval campaigns to populate the quality matrix. Each carrier is scored on MOS estimated from post-dial delay.
              </p>
            </div>
          ) : (
            <div className="border-t border-border/30 overflow-x-auto">
              {/* Info banner */}
              <div className="flex items-center gap-2 px-5 py-2 bg-cyan-500/5 border-b border-cyan-500/10 text-[11px] text-cyan-300/70">
                <Activity className="h-3 w-3 text-cyan-400 shrink-0" />
                MOS estimated via E-model from synthetic call PDD · Grade A ≥4.0 · B ≥3.5 · C ≥3.0 · D ≥2.5 · F &lt;2.5
              </div>
              <table className="w-full text-xs">
                <thead className="bg-muted/10">
                  <tr>
                    {["Grade","Carrier","Calls","ASR","Avg PDD","Avg Duration","Est. MOS","Top Errors"].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-muted-foreground font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/20">
                  {data.rows.map(row => (
                    <tr key={row.carrier} className="hover:bg-muted/5 transition-colors" data-testid={`row-carrier-matrix-${row.carrier}`}>
                      <td className="px-4 py-2.5">
                        <span className={cn("text-sm font-black", mosGradeColor(row.grade))}>
                          {row.grade}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-medium max-w-[160px] truncate">{row.carrier || 'Unknown'}</td>
                      <td className="px-4 py-2.5 font-mono text-muted-foreground">{row.total}</td>
                      <td className="px-4 py-2.5 font-mono font-semibold">
                        <span className={row.asr != null ? (row.asr >= 75 ? 'text-emerald-400' : row.asr >= 55 ? 'text-amber-400' : 'text-rose-400') : 'text-muted-foreground/40'}>
                          {row.asr != null ? `${row.asr.toFixed(1)}%` : '—'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-muted-foreground">
                        {row.avgPddMs != null ? `${row.avgPddMs.toFixed(0)}ms` : '—'}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-muted-foreground">
                        {row.avgDurSec != null ? `${row.avgDurSec.toFixed(1)}s` : '—'}
                      </td>
                      <td className="px-4 py-2.5 font-mono font-bold">
                        <span className={mosColor(row.estimatedMos)}>
                          {row.estimatedMos != null ? row.estimatedMos.toFixed(2) : '—'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex gap-1 flex-wrap">
                          {row.topErrors.map(e => (
                            <span key={e.code} className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-rose-500/10 text-rose-400 border border-rose-500/20">
                              {e.code}×{e.count}
                            </span>
                          ))}
                          {row.topErrors.length === 0 && <span className="text-muted-foreground/30">—</span>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Create campaign modal ─────────────────────────────────────────────────────
function CampaignModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [name, setName]               = useState("");
  const [scheduleType, setSched]      = useState("once");
  const [scheduledAt, setSchedAt]     = useState("");
  const [cronHour, setCronHour]       = useState("8");
  const [intervalMins, setIntervalMins] = useState("60");
  const [dests, setDests] = useState<CampaignDestination[]>([{ cld: "", cli: "", label: "" }]);

  const addDest    = () => setDests(d => [...d, { cld: "", cli: "", label: "" }]);
  const removeDest = (i: number) => setDests(d => d.filter((_, idx) => idx !== i));
  const setDest    = (i: number, k: keyof CampaignDestination, v: string) =>
    setDests(d => d.map((row, idx) => idx === i ? { ...row, [k]: v } : row));

  const mutation = useMutation({
    mutationFn: (body: any) => apiRequest("POST", "/api/campaigns", body),
    onSuccess: () => {
      toast({ title: "Campaign created" });
      qc.invalidateQueries({ queryKey: ["/api/campaigns"] });
      onClose();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function handleSubmit() {
    const validDests = dests.filter(d => d.cld.trim());
    if (!name.trim() || !validDests.length) {
      toast({ title: "Campaign name and at least one destination required", variant: "destructive" });
      return;
    }
    const body: any = { name: name.trim(), destinations: validDests, scheduleType };
    if (scheduleType === "once" && scheduledAt) body.scheduledAt = scheduledAt;
    if (scheduleType === "daily")    body.cronHour = Number(cronHour);
    if (scheduleType === "interval") {
      body.intervalMinutes = Number(intervalMins);
      // seed nextRunAt so scheduler picks it up on first tick
      body.nextRunAt = new Date(Date.now() + Number(intervalMins) * 60_000).toISOString();
    }
    mutation.mutate(body);
  }

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>New Test Campaign</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">

          <div>
            <Label className="text-xs mb-1 block">Campaign Name</Label>
            <Input
              data-testid="input-campaign-name"
              placeholder="e.g. Nigeria CLI check"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs mb-1 block">Schedule Type</Label>
              <Select value={scheduleType} onValueChange={setSched}>
                <SelectTrigger data-testid="select-campaign-schedule"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="once">Run once</SelectItem>
                  <SelectItem value="interval">Repeat on interval ⚡</SelectItem>
                  <SelectItem value="daily">Daily (cron hour)</SelectItem>
                  <SelectItem value="hourly">Hourly</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {scheduleType === "once" && (
              <div>
                <Label className="text-xs mb-1 block">Scheduled At (optional)</Label>
                <Input
                  type="datetime-local"
                  data-testid="input-campaign-at"
                  value={scheduledAt}
                  onChange={e => setSchedAt(e.target.value)}
                />
              </div>
            )}
            {scheduleType === "daily" && (
              <div>
                <Label className="text-xs mb-1 block">Hour (UTC 0–23)</Label>
                <Input
                  type="number" min="0" max="23"
                  data-testid="input-campaign-hour"
                  value={cronHour}
                  onChange={e => setCronHour(e.target.value)}
                />
              </div>
            )}
            {scheduleType === "interval" && (
              <div>
                <Label className="text-xs mb-1 block">Repeat Interval</Label>
                <Select value={intervalMins} onValueChange={setIntervalMins}>
                  <SelectTrigger data-testid="select-campaign-interval"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {INTERVAL_OPTIONS.map(o => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {scheduleType === "interval" && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-violet-500/10 border border-violet-500/20 text-xs text-violet-300">
              <Zap className="w-3.5 h-3.5 mt-0.5 shrink-0 text-violet-400" />
              <span>
                The server-side scheduler will run this campaign automatically at your chosen interval.
                After each run, ASR is compared to the rolling 10-run baseline — if it drops by ≥15 percentage-points,
                an <strong>AI Ops anomaly signal</strong> is fired automatically and surfaced on the AI Ops page.
              </span>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs">Destinations</Label>
              <Button variant="ghost" size="sm" className="text-xs h-7" onClick={addDest} data-testid="button-add-destination">
                <Plus className="w-3.5 h-3.5 mr-1" /> Add destination
              </Button>
            </div>
            <div className="space-y-2">
              {dests.map((dest, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center">
                  <Input placeholder="CLD e.g. +2348012345" data-testid={`input-cld-${i}`} value={dest.cld} onChange={e => setDest(i, "cld", e.target.value)} />
                  <Input placeholder="CLI (optional)" data-testid={`input-cli-${i}`} value={dest.cli ?? ""} onChange={e => setDest(i, "cli", e.target.value)} />
                  <Input placeholder="Label (optional)" data-testid={`input-label-${i}`} value={dest.label ?? ""} onChange={e => setDest(i, "label", e.target.value)} />
                  <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground" onClick={() => removeDest(i)} data-testid={`button-remove-dest-${i}`}>
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">CLD = destination number · CLI = caller ID · Label = friendly name</p>
          </div>

        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            <X className="w-4 h-4 mr-1" />Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={mutation.isPending} data-testid="button-submit-campaign">
            {mutation.isPending && <RefreshCw className="w-4 h-4 animate-spin mr-2" />}
            Create Campaign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Scheduler status bar ──────────────────────────────────────────────────────
function SchedulerStatusBar({ campaigns }: { campaigns: TestCampaign[] }) {
  const scheduled = campaigns.filter(c => c.scheduleType === "interval" && c.intervalMinutes);
  if (!scheduled.length) return null;

  const active  = scheduled.filter(c => c.enabled);
  const paused  = scheduled.filter(c => !c.enabled);
  const nextDue = active
    .filter(c => c.nextRunAt)
    .sort((a, b) => new Date(a.nextRunAt!).getTime() - new Date(b.nextRunAt!).getTime())[0];

  return (
    <div className="flex flex-wrap items-center gap-4 px-4 py-2.5 rounded-xl border border-violet-500/20 bg-violet-500/5 text-xs">
      <div className="flex items-center gap-2">
        <Zap className="w-3.5 h-3.5 text-violet-400" />
        <span className="font-semibold text-violet-300">Synthetic Scheduler</span>
        <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-emerald-500/15 text-emerald-400 font-semibold">active</span>
      </div>
      <div className="flex items-center gap-1 text-muted-foreground">
        <span className="text-emerald-400 font-semibold">{active.length}</span>&nbsp;running
        {paused.length > 0 && (
          <><span className="mx-1 opacity-40">·</span><span className="text-amber-400 font-semibold">{paused.length}</span>&nbsp;paused</>
        )}
      </div>
      {nextDue && (
        <div className="flex items-center gap-1 text-muted-foreground">
          <Timer className="w-3 h-3" />
          Next:&nbsp;<span className="text-violet-300 font-medium">{nextDue.name}</span>
          &nbsp;<span className="text-violet-400 font-semibold">{nextRunCountdown(nextDue.nextRunAt)}</span>
        </div>
      )}
      <div className="ml-auto flex items-center gap-1 text-muted-foreground/60 text-[10px]">
        <Activity className="w-3 h-3" />
        ASR drop ≥15pp → AI Ops signal
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function TestCampaignsPage() {
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);

  const { data: campaigns = [], isLoading } = useQuery<TestCampaign[]>({
    queryKey: ["/api/campaigns"],
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <FlaskConical className="w-6 h-6 text-cyan-400" />
            <h2 className="text-2xl font-bold tracking-tight">Test Call Campaigns</h2>
          </div>
          <p className="text-muted-foreground text-sm mt-1">
            Autonomous synthetic testing — interval scheduling, ASR baselining, and AI Ops integration
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline" size="sm"
            onClick={() => qc.invalidateQueries({ queryKey: ["/api/campaigns"] })}
            disabled={isLoading}
            data-testid="button-refresh-campaigns"
          >
            <RefreshCw className={cn("w-4 h-4 mr-2", isLoading && "animate-spin")} />Refresh
          </Button>
          <Button size="sm" onClick={() => setShowModal(true)} data-testid="button-new-campaign">
            <Plus className="w-4 h-4 mr-2" />New Campaign
          </Button>
        </div>
      </div>

      {!isLoading && <SchedulerStatusBar campaigns={campaigns} />}

      {/* Carrier Quality Matrix */}
      <CarrierMatrixPanel />

      {isLoading && (
        <div className="flex items-center justify-center h-32 text-muted-foreground">
          <RefreshCw className="w-5 h-5 animate-spin mr-2" />Loading…
        </div>
      )}

      {!isLoading && campaigns.length === 0 && (
        <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-3">
          <FlaskConical className="w-12 h-12 opacity-20" />
          <p className="text-sm">No campaigns yet.</p>
          <p className="text-xs opacity-60 text-center max-w-xs">
            Create your first campaign and choose <strong>Repeat on interval</strong> to enable the
            autonomous scheduler with AI Ops integration.
          </p>
        </div>
      )}

      {!isLoading && campaigns.map(c => <CampaignCard key={c.id} campaign={c} />)}

      {showModal && <CampaignModal onClose={() => setShowModal(false)} />}
    </div>
  );
}
