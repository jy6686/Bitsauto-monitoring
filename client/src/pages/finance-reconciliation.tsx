import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowRightLeft, Brain, CheckCircle2, AlertTriangle, XCircle,
  RefreshCw, Clock, CalendarDays, Loader2, ChevronRight,
  ShieldCheck, Zap, TrendingDown, Users, Building2, BarChart3,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────
interface ReconRun {
  id: number;
  snapshot_run_id: number | null;
  started_at: string;
  completed_at: string | null;
  status: string;
  report_dates: string[];
  snapshot_dates?: string[];
  records_created: number | null;
  discrepancies: number | null;
  duration_ms: number | null;
  error: string | null;
}

interface ReconRecord {
  id: number;
  entity_type: string;
  entity_id: string | null;
  entity_name: string | null;
  metric: string;
  snapshot_value: string;
  expected_value: string;
  difference: string;
  difference_pct: string;
  status: string;
  reason_code: string;
  reason_detail: string;
  created_at: string;
}

interface AiFinding {
  id: number;
  finding_type: string;
  severity: string;
  entity_type: string | null;
  entity_name: string | null;
  metric: string | null;
  observed_value: string | null;
  confidence_score: string | null;
  explanation: string;
  report_date: string;
  created_at: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function statusBadge(status: string) {
  if (status === "success" || status === "matched") return (
    <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 gap-1">
      <CheckCircle2 className="h-3 w-3" />{status}
    </Badge>
  );
  if (status === "discrepancy" || status === "failed") return (
    <Badge className="bg-red-500/15 text-red-400 border-red-500/30 gap-1">
      <XCircle className="h-3 w-3" />{status}
    </Badge>
  );
  if (status === "running") return (
    <Badge className="bg-blue-500/15 text-blue-400 border-blue-500/30 gap-1 animate-pulse">
      <Loader2 className="h-3 w-3 animate-spin" />running
    </Badge>
  );
  return <Badge variant="outline">{status}</Badge>;
}

function severityBadge(severity: string) {
  if (severity === "critical") return (
    <Badge className="bg-red-500/15 text-red-400 border-red-500/30">{severity}</Badge>
  );
  if (severity === "warning") return (
    <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30">{severity}</Badge>
  );
  return <Badge className="bg-slate-500/15 text-slate-400 border-slate-500/30">{severity}</Badge>;
}

function entityIcon(type: string) {
  if (type === "client")    return <Users className="h-3.5 w-3.5 text-blue-400" />;
  if (type === "vendor")    return <Building2 className="h-3.5 w-3.5 text-purple-400" />;
  if (type === "aggregate") return <BarChart3 className="h-3.5 w-3.5 text-emerald-400" />;
  return null;
}

function fmt(v: string | number | null, prefix = "$"): string {
  if (v === null || v === undefined) return "—";
  const n = parseFloat(String(v));
  if (isNaN(n)) return "—";
  return `${prefix}${n.toFixed(4)}`;
}

function fmtMs(ms: number | null): string {
  if (!ms) return "—";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function relTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function FinanceReconciliationPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);

  const runsQ = useQuery<ReconRun[]>({
    queryKey: ["/api/finance/reconciliation/runs"],
    refetchInterval: 15000,
  });

  const recordsQ = useQuery<ReconRecord[]>({
    queryKey: ["/api/finance/reconciliation/records", selectedRunId],
    enabled: selectedRunId !== null,
    queryFn: () => fetch(`/api/finance/reconciliation/records/${selectedRunId}`, { credentials: "include" })
      .then(r => r.json()),
  });

  const findingsQ = useQuery<AiFinding[]>({
    queryKey: ["/api/finance/reconciliation/findings"],
    refetchInterval: 30000,
  });

  const runNow = useMutation({
    mutationFn: () => apiRequest("POST", "/api/finance/reconciliation/run-now", {}),
    onSuccess: () => {
      toast({ title: "Reconciliation queued", description: "Refresh in 10 seconds to see results." });
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ["/api/finance/reconciliation/runs"] });
        qc.invalidateQueries({ queryKey: ["/api/finance/reconciliation/findings"] });
      }, 12000);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const runs = runsQ.data ?? [];
  const latestRun = runs[0] ?? null;
  const records = recordsQ.data ?? [];
  const findings = findingsQ.data ?? [];

  const activeRunId = selectedRunId ?? latestRun?.id ?? null;
  const activeRecords = selectedRunId ? records : [];

  const criticalFindings = findings.filter(f => f.severity === "critical");
  const warningFindings  = findings.filter(f => f.severity === "warning");
  const totalDiscrepancies = runs.reduce((s, r) => s + (r.discrepancies ?? 0), 0);

  return (
    <TooltipProvider>
    <div className="min-h-screen bg-background p-6 space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <ArrowRightLeft className="h-5 w-5 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-foreground">Reconciliation & AI Evidence</h1>
            <p className="text-sm text-muted-foreground">F3 · Snapshot consistency verification and intelligent anomaly detection</p>
          </div>
        </div>
        <Button
          data-testid="button-run-now"
          onClick={() => runNow.mutate()}
          disabled={runNow.isPending}
          className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
        >
          {runNow.isPending
            ? <><Loader2 className="h-4 w-4 animate-spin" />Running…</>
            : <><RefreshCw className="h-4 w-4" />Run Now</>}
        </Button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-border/50">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <ShieldCheck className="h-3.5 w-3.5" />LAST RUN STATUS
            </div>
            <div data-testid="status-last-run" className="text-lg font-semibold">
              {runsQ.isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> :
                latestRun ? statusBadge(latestRun.status) : <span className="text-muted-foreground text-sm">No runs yet</span>}
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <CheckCircle2 className="h-3.5 w-3.5" />RECORDS CHECKED
            </div>
            <div data-testid="text-records-checked" className="text-2xl font-semibold text-foreground">
              {runsQ.isLoading ? "—" : (latestRun?.records_created ?? 0)}
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />DISCREPANCIES
            </div>
            <div data-testid="text-discrepancies" className={`text-2xl font-semibold ${(latestRun?.discrepancies ?? 0) > 0 ? "text-red-400" : "text-emerald-400"}`}>
              {runsQ.isLoading ? "—" : (latestRun?.discrepancies ?? 0)}
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <Brain className="h-3.5 w-3.5 text-violet-400" />AI FINDINGS
            </div>
            <div className="flex items-center gap-2">
              {criticalFindings.length > 0 && (
                <span data-testid="text-critical-findings" className="text-lg font-semibold text-red-400">{criticalFindings.length} critical</span>
              )}
              {warningFindings.length > 0 && (
                <span data-testid="text-warning-findings" className="text-lg font-semibold text-amber-400">{warningFindings.length} warning</span>
              )}
              {criticalFindings.length === 0 && warningFindings.length === 0 && (
                <span data-testid="text-no-findings" className="text-lg font-semibold text-emerald-400">
                  {findingsQ.isLoading ? "—" : "None"}
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main tabs */}
      <Tabs defaultValue="runs">
        <TabsList className="bg-muted/40">
          <TabsTrigger value="runs" data-testid="tab-runs">Run History</TabsTrigger>
          <TabsTrigger value="records" data-testid="tab-records">Reconciliation Records</TabsTrigger>
          <TabsTrigger value="findings" data-testid="tab-findings">
            AI Findings
            {criticalFindings.length > 0 && (
              <Badge className="ml-1.5 bg-red-500/20 text-red-400 border-red-500/30 text-xs py-0 px-1.5">
                {criticalFindings.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Tab: Run History ── */}
        <TabsContent value="runs" className="mt-4">
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Clock className="h-4 w-4" />Reconciliation runs (last 30)
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {runsQ.isLoading ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />Loading runs…
                </div>
              ) : runs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                  <ArrowRightLeft className="h-8 w-8 opacity-30" />
                  <p className="text-sm">No reconciliation runs yet.</p>
                  <p className="text-xs">Click <strong>Run Now</strong> to start the first reconciliation.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/50 hover:bg-transparent">
                      <TableHead className="text-muted-foreground text-xs">Run</TableHead>
                      <TableHead className="text-muted-foreground text-xs">Snapshot</TableHead>
                      <TableHead className="text-muted-foreground text-xs">Date(s)</TableHead>
                      <TableHead className="text-muted-foreground text-xs">Status</TableHead>
                      <TableHead className="text-muted-foreground text-xs text-right">Records</TableHead>
                      <TableHead className="text-muted-foreground text-xs text-right">Discrepancies</TableHead>
                      <TableHead className="text-muted-foreground text-xs text-right">Duration</TableHead>
                      <TableHead className="text-muted-foreground text-xs text-right">Started</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.map(run => (
                      <TableRow
                        key={run.id}
                        data-testid={`row-recon-run-${run.id}`}
                        className={`border-border/40 cursor-pointer transition-colors ${selectedRunId === run.id ? "bg-muted/50" : "hover:bg-muted/20"}`}
                        onClick={() => setSelectedRunId(run.id)}
                      >
                        <TableCell className="font-mono text-xs text-muted-foreground">#{run.id}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {run.snapshot_run_id ? `mat-${run.snapshot_run_id}` : "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {(run.snapshot_dates ?? run.report_dates ?? []).slice(0, 2).join(", ")}
                        </TableCell>
                        <TableCell>{statusBadge(run.status)}</TableCell>
                        <TableCell className="text-right text-sm">{run.records_created ?? "—"}</TableCell>
                        <TableCell className="text-right">
                          <span className={`text-sm font-medium ${(run.discrepancies ?? 0) > 0 ? "text-red-400" : "text-emerald-400"}`}>
                            {run.discrepancies ?? 0}
                          </span>
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">{fmtMs(run.duration_ms)}</TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">
                          <Tooltip>
                            <TooltipTrigger>{relTime(run.started_at)}</TooltipTrigger>
                            <TooltipContent>{new Date(run.started_at).toUTCString()}</TooltipContent>
                          </Tooltip>
                        </TableCell>
                        <TableCell>
                          <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${selectedRunId === run.id ? "rotate-90" : ""}`} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Tab: Reconciliation Records ── */}
        <TabsContent value="records" className="mt-4">
          {!selectedRunId ? (
            <Card className="border-border/50">
              <CardContent className="py-12">
                <div className="flex flex-col items-center gap-3 text-muted-foreground">
                  <CheckCircle2 className="h-8 w-8 opacity-30" />
                  <p className="text-sm">Select a run from the <strong>Run History</strong> tab to view records.</p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-border/50">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4" />Records for Run #{selectedRunId}
                  </CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => setSelectedRunId(null)} className="text-xs text-muted-foreground">
                    Clear selection
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {recordsQ.isLoading ? (
                  <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />Loading records…
                  </div>
                ) : records.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
                    <CheckCircle2 className="h-8 w-8 opacity-30" />
                    <p className="text-sm">No records found for this run.</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="border-border/50 hover:bg-transparent">
                        <TableHead className="text-muted-foreground text-xs">Entity</TableHead>
                        <TableHead className="text-muted-foreground text-xs">Name</TableHead>
                        <TableHead className="text-muted-foreground text-xs">Metric</TableHead>
                        <TableHead className="text-muted-foreground text-xs text-right">Snapshot</TableHead>
                        <TableHead className="text-muted-foreground text-xs text-right">Expected</TableHead>
                        <TableHead className="text-muted-foreground text-xs text-right">Diff</TableHead>
                        <TableHead className="text-muted-foreground text-xs">Status</TableHead>
                        <TableHead className="text-muted-foreground text-xs">Reason</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {records.map(rec => (
                        <TableRow
                          key={rec.id}
                          data-testid={`row-recon-record-${rec.id}`}
                          className={`border-border/40 ${rec.status === "discrepancy" ? "bg-red-500/5" : ""}`}
                        >
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              {entityIcon(rec.entity_type)}
                              <span className="text-xs text-muted-foreground capitalize">{rec.entity_type}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm">{rec.entity_name ?? "—"}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs font-mono">{rec.metric}</Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">{fmt(rec.snapshot_value)}</TableCell>
                          <TableCell className="text-right font-mono text-sm text-muted-foreground">{fmt(rec.expected_value)}</TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            <span className={Math.abs(parseFloat(rec.difference ?? "0")) > 0.001 ? "text-red-400" : "text-muted-foreground"}>
                              {fmt(rec.difference)}
                            </span>
                          </TableCell>
                          <TableCell>{statusBadge(rec.status)}</TableCell>
                          <TableCell>
                            <Tooltip>
                              <TooltipTrigger>
                                <Badge variant="outline" className="text-xs font-mono cursor-help">{rec.reason_code}</Badge>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs text-xs">{rec.reason_detail}</TooltipContent>
                            </Tooltip>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Tab: AI Findings ── */}
        <TabsContent value="findings" className="mt-4">
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Brain className="h-4 w-4 text-violet-400" />AI Evidence (immutable — all findings across all scans)
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {findingsQ.isLoading ? (
                <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />Loading findings…
                </div>
              ) : findings.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
                  <Brain className="h-8 w-8 opacity-30" />
                  <p className="text-sm">No AI findings yet. Run reconciliation to generate evidence.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/50 hover:bg-transparent">
                      <TableHead className="text-muted-foreground text-xs">Severity</TableHead>
                      <TableHead className="text-muted-foreground text-xs">Type</TableHead>
                      <TableHead className="text-muted-foreground text-xs">Entity</TableHead>
                      <TableHead className="text-muted-foreground text-xs">Metric</TableHead>
                      <TableHead className="text-muted-foreground text-xs text-right">Value</TableHead>
                      <TableHead className="text-muted-foreground text-xs text-right">Confidence</TableHead>
                      <TableHead className="text-muted-foreground text-xs">Explanation</TableHead>
                      <TableHead className="text-muted-foreground text-xs text-right">Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {findings.map(f => (
                      <TableRow
                        key={f.id}
                        data-testid={`row-ai-finding-${f.id}`}
                        className={`border-border/40 ${f.severity === "critical" ? "bg-red-500/5" : f.severity === "warning" ? "bg-amber-500/5" : ""}`}
                      >
                        <TableCell>{severityBadge(f.severity)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs font-mono">{f.finding_type}</Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          <div className="flex items-center gap-1.5">
                            {f.entity_type && entityIcon(f.entity_type)}
                            {f.entity_name ?? "—"}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{f.metric ?? "—"}</TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {f.observed_value ? `${parseFloat(f.observed_value).toFixed(2)}%` : "—"}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {f.confidence_score
                            ? <span className="text-emerald-400">{(parseFloat(f.confidence_score) * 100).toFixed(0)}%</span>
                            : "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-xs">
                          <Tooltip>
                            <TooltipTrigger className="text-left">
                              <span className="line-clamp-2">{f.explanation}</span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-sm text-xs">{f.explanation}</TooltipContent>
                          </Tooltip>
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">{f.report_date}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* SSOTR mapping footer */}
      <Card className="border-border/30 bg-muted/10">
        <CardContent className="py-3 px-4">
          <p className="text-xs text-muted-foreground flex items-center gap-2">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
            <span>
              <strong className="text-foreground/70">SSOTR compliance:</strong>{" "}
              All metrics sourced from <code className="text-xs bg-muted px-1 rounded">financial_snapshot</code>.
              Revenue → <code className="text-xs bg-muted px-1 rounded">sell_amount</code> ·
              Cost → <code className="text-xs bg-muted px-1 rounded">buy_amount</code> ·
              Margin → <code className="text-xs bg-muted px-1 rounded">margin_amount</code> ·
              MarginPct → <code className="text-xs bg-muted px-1 rounded">margin_percent</code>.
              F3 never reads <code className="text-xs bg-muted px-1 rounded">daily_minutes_reports</code> or <code className="text-xs bg-muted px-1 rounded">margin_analytics_daily</code>.
            </span>
          </p>
        </CardContent>
      </Card>
    </div>
    </TooltipProvider>
  );
}
