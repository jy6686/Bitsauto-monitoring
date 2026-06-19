import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  ShieldCheck, AlertTriangle, XCircle, CheckCircle2,
  RefreshCw, Play, FileSearch, Info, TrendingDown,
  DollarSign, Zap,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface RatingVerification {
  id:                 number;
  cdrCallId?:         string;
  cdrStartTime?:      string;
  prefix?:            string;
  destination?:       string;
  iTariff?:           string;
  tariffVersionId?:   number;
  durationSecs?:      number;
  billedSecs?:        number;
  sippyActualCost?:   number;
  reproducedCost?:    number;
  deltaAmount?:       number;
  deltaPct?:          number;
  discrepancyType:    string;
  verificationStatus: string;
  severity:           string;
  verificationSource: string;
  notes?:             string;
  rateSnapshot?:      string;
  createdAt:          string;
}

interface DiscrepancySummary {
  total:          number;
  exact:          number;
  discrepancies:  number;
  totalDelta:     number;
  byType:         Record<string, number>;
  bySeverity:     Record<string, number>;
}

interface BatchResult {
  total:          number;
  verified:       number;
  discrepancies:  number;
  missing:        number;
  unrated:        number;
  totalDelta:     number;
  durationMs:     number;
}

interface SippyTariff {
  iTariff: string | number;
  name:    string;
}

// ── Badge helpers ──────────────────────────────────────────────────────────────

function DiscrepancyBadge({ type }: { type: string }) {
  const cfg: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
    exact_match:           { label: "Exact Match",       className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", icon: <CheckCircle2 className="h-3 w-3" /> },
    overbilled:            { label: "Overbilled",        className: "bg-red-500/15 text-red-400 border-red-500/30",             icon: <TrendingDown className="h-3 w-3 rotate-180" /> },
    underbilled:           { label: "Underbilled",       className: "bg-amber-500/15 text-amber-400 border-amber-500/30",       icon: <TrendingDown className="h-3 w-3" /> },
    interval_mismatch:     { label: "Interval Mismatch", className: "bg-blue-500/15 text-blue-400 border-blue-500/30",           icon: <AlertTriangle className="h-3 w-3" /> },
    connect_fee_mismatch:  { label: "Connect Fee",       className: "bg-purple-500/15 text-purple-400 border-purple-500/30",    icon: <AlertTriangle className="h-3 w-3" /> },
    grace_period_mismatch: { label: "Grace Period",      className: "bg-orange-500/15 text-orange-400 border-orange-500/30",    icon: <AlertTriangle className="h-3 w-3" /> },
    surcharge_mismatch:    { label: "Surcharge",         className: "bg-pink-500/15 text-pink-400 border-pink-500/30",          icon: <AlertTriangle className="h-3 w-3" /> },
    missing_rate:          { label: "Missing Rate",      className: "bg-slate-500/15 text-slate-300 border-slate-500/30",       icon: <XCircle className="h-3 w-3" /> },
    unrated:               { label: "Unrated",           className: "bg-slate-500/10 text-slate-500 border-slate-500/20",       icon: <Info className="h-3 w-3" /> },
  };
  const c = cfg[type] ?? cfg.unrated;
  return (
    <Badge variant="outline" className={`gap-1 text-xs ${c.className}`}>
      {c.icon}{c.label}
    </Badge>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const cfg: Record<string, string> = {
    none:     "bg-slate-500/10 text-slate-500 border-slate-500/20",
    minor:    "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
    major:    "bg-orange-500/15 text-orange-400 border-orange-500/30",
    critical: "bg-red-500/20 text-red-400 border-red-500/40",
  };
  return (
    <Badge variant="outline" className={`capitalize text-xs ${cfg[severity] ?? cfg.none}`}>
      {severity}
    </Badge>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, string> = {
    verified: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    pending:  "bg-blue-500/15 text-blue-400 border-blue-500/30",
    disputed: "bg-red-500/15 text-red-400 border-red-500/30",
    flagged:  "bg-amber-500/15 text-amber-400 border-amber-500/30",
  };
  return (
    <Badge variant="outline" className={`capitalize text-xs ${cfg[status] ?? cfg.pending}`}>
      {status}
    </Badge>
  );
}

// ── Rate snapshot detail ───────────────────────────────────────────────────────

function RateSnapshotDetail({ rateSnapshot }: { rateSnapshot?: string }) {
  if (!rateSnapshot) return <span className="text-muted-foreground">—</span>;
  try {
    const r = JSON.parse(rateSnapshot);
    return (
      <div className="font-mono text-xs space-y-0.5 text-muted-foreground">
        <div>Prefix: <span className="text-foreground">{r.prefix}</span></div>
        <div>Int1/N: <span className="text-foreground">{r.interval1}s / {r.intervalN}s</span></div>
        <div>Price1/N: <span className="text-foreground">{r.price1} / {r.priceN}</span></div>
        {r.connectFee > 0 && <div>Connect fee: <span className="text-foreground">{r.connectFee}</span></div>}
        {r.grace > 0 && <div>Grace: <span className="text-foreground">{r.grace}s</span></div>}
        {r.freeSecs > 0 && <div>Free secs: <span className="text-foreground">{r.freeSecs}s</span></div>}
        {r.surcharge > 0 && <div>Surcharge: <span className="text-foreground">{r.surcharge}</span></div>}
        <div className="pt-1 text-blue-400">Formula: {r.formula}</div>
      </div>
    );
  } catch {
    return <span className="text-muted-foreground font-mono text-xs">{rateSnapshot}</span>;
  }
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function RatingVerificationPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedTariff, setSelectedTariff] = useState<string>("");
  const [filterType, setFilterType]         = useState<string>("all");
  const [filterSeverity, setFilterSeverity] = useState<string>("all");
  const [detailId, setDetailId]             = useState<number | null>(null);
  const [batchResult, setBatchResult]       = useState<BatchResult | null>(null);

  const { data: tariffs = [], isLoading: loadingTariffs } = useQuery<SippyTariff[]>({
    queryKey: ["/api/sippy/tariffs"],
  });

  const { data: summary } = useQuery<DiscrepancySummary>({
    queryKey: ["/api/rating-verifications/summary", selectedTariff],
    queryFn: () => apiRequest("GET", `/api/rating-verifications/summary${selectedTariff ? `?iTariff=${selectedTariff}` : ""}`).then(r => r.json()),
    refetchInterval: 30000,
  });

  const { data: verifications = [], isLoading: loadingList } = useQuery<RatingVerification[]>({
    queryKey: ["/api/rating-verifications", selectedTariff, filterType, filterSeverity],
    queryFn: () => {
      const params = new URLSearchParams();
      if (selectedTariff) params.set("iTariff", selectedTariff);
      if (filterType !== "all") params.set("discrepancyType", filterType);
      if (filterSeverity !== "all") params.set("severity", filterSeverity);
      params.set("limit", "200");
      return apiRequest("GET", `/api/rating-verifications?${params}`).then(r => r.json());
    },
  });

  const { data: detail } = useQuery<RatingVerification>({
    queryKey: ["/api/rating-verifications", detailId],
    queryFn: () => apiRequest("GET", `/api/rating-verifications/${detailId}`).then(r => r.json()),
    enabled: detailId != null,
  });

  const batchMutation = useMutation({
    mutationFn: (opts: { iTariff: string; limit: number }) =>
      apiRequest("POST", "/api/rating-verifications/run-batch", opts).then(r => r.json()),
    onSuccess: (data: BatchResult) => {
      setBatchResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/rating-verifications"] });
      toast({
        title: `Batch complete — ${data.total} CDRs processed`,
        description: `${data.verified} exact matches · ${data.discrepancies} discrepancies · ${data.missing} missing rates`,
      });
    },
    onError: (err: any) => {
      toast({ title: "Batch failed", description: err.message, variant: "destructive" });
    },
  });

  const matchPct = summary && summary.total > 0
    ? Math.round((summary.exact / summary.total) * 100)
    : null;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" />
            Rating Verification
          </h1>
          <p className="text-muted-foreground mt-1">
            Deterministic telecom cost reproduction — validates Sippy billing against historical tariff economics.
          </p>
        </div>

        <div className="flex gap-2 items-center flex-wrap">
          <Select value={selectedTariff} onValueChange={setSelectedTariff}>
            <SelectTrigger data-testid="select-tariff" className="w-56">
              <SelectValue placeholder={loadingTariffs ? "Loading…" : "All tariffs"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All tariffs</SelectItem>
              {tariffs.map(t => (
                <SelectItem key={String(t.iTariff)} value={String(t.iTariff)}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            data-testid="button-run-batch"
            onClick={() => batchMutation.mutate({ iTariff: selectedTariff, limit: 500 })}
            disabled={batchMutation.isPending}
          >
            <Play className={`h-4 w-4 mr-2 ${batchMutation.isPending ? "animate-pulse" : ""}`} />
            {batchMutation.isPending ? "Verifying…" : "Run Verification"}
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          {
            label: "Total Verified",
            value: summary?.total ?? 0,
            icon: <FileSearch className="h-4 w-4 text-blue-400" />,
          },
          {
            label: "Exact Matches",
            value: summary?.exact ?? 0,
            sub:   matchPct != null ? `${matchPct}%` : undefined,
            icon: <CheckCircle2 className="h-4 w-4 text-emerald-400" />,
          },
          {
            label: "Discrepancies",
            value: summary?.discrepancies ?? 0,
            icon: <AlertTriangle className="h-4 w-4 text-amber-400" />,
          },
          {
            label: "Total Delta",
            value: summary?.totalDelta != null
              ? `$${Math.abs(summary.totalDelta).toFixed(4)}`
              : "$0.00",
            sub:   summary?.totalDelta && summary.totalDelta > 0 ? "overbilled" : summary?.totalDelta && summary.totalDelta < 0 ? "underbilled" : undefined,
            icon: <DollarSign className="h-4 w-4 text-slate-400" />,
          },
        ].map(stat => (
          <Card key={stat.label}>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{stat.label}</span>
                {stat.icon}
              </div>
              <p className="text-2xl font-bold mt-1 font-mono">{stat.value}</p>
              {stat.sub && <p className="text-xs text-muted-foreground mt-0.5">{stat.sub}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Match rate progress */}
      {matchPct != null && (
        <Card>
          <CardContent className="pt-4">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-muted-foreground">Rating accuracy</span>
              <span className={matchPct >= 99 ? "text-emerald-400" : matchPct >= 95 ? "text-amber-400" : "text-red-400"}>
                {matchPct}% exact
              </span>
            </div>
            <Progress value={matchPct} className="h-2" />
            {matchPct < 99 && (
              <p className="text-xs text-muted-foreground mt-1">
                {(100 - matchPct).toFixed(1)}% of CDRs have billing discrepancies requiring investigation.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Batch result card */}
      {batchResult && (
        <Card className="border-blue-500/30 bg-blue-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Zap className="h-4 w-4 text-blue-400" />
              Last Batch Result
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-4 text-sm">
              {[
                { label: "Total", value: batchResult.total },
                { label: "Exact", value: batchResult.verified },
                { label: "Discrepancies", value: batchResult.discrepancies },
                { label: "Missing Rate", value: batchResult.missing },
                { label: "Unrated", value: batchResult.unrated },
                { label: "Duration", value: `${(batchResult.durationMs / 1000).toFixed(1)}s` },
              ].map(s => (
                <div key={s.label}>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className="font-bold font-mono">{s.value}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters + list */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle className="text-base">Verification Results</CardTitle>
            <div className="flex gap-2">
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger data-testid="select-filter-type" className="w-44 h-8 text-xs">
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  {["all","exact_match","overbilled","underbilled","interval_mismatch",
                    "connect_fee_mismatch","grace_period_mismatch","surcharge_mismatch",
                    "missing_rate","unrated"].map(t => (
                    <SelectItem key={t} value={t}>{t === "all" ? "All types" : t.replace(/_/g,' ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterSeverity} onValueChange={setFilterSeverity}>
                <SelectTrigger data-testid="select-filter-severity" className="w-36 h-8 text-xs">
                  <SelectValue placeholder="All severities" />
                </SelectTrigger>
                <SelectContent>
                  {["all","critical","major","minor","none"].map(s => (
                    <SelectItem key={s} value={s}>{s === "all" ? "All severities" : s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <CardDescription className="text-xs">
            {verifications.length} result(s) shown
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingList ? (
            <div className="text-center py-10 text-muted-foreground">Loading…</div>
          ) : verifications.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <ShieldCheck className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p>No verification results yet. Click "Run Verification" to begin.</p>
              <p className="text-xs mt-1">Requires at least one tariff snapshot — visit Tariff Versions to create one.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Call ID</TableHead>
                    <TableHead>Prefix</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Sippy Cost</TableHead>
                    <TableHead>Reproduced</TableHead>
                    <TableHead>Delta</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {verifications.map(v => (
                    <TableRow
                      key={v.id}
                      data-testid={`row-verification-${v.id}`}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setDetailId(v.id)}
                    >
                      <TableCell className="font-mono text-xs text-muted-foreground max-w-[100px] truncate">
                        {v.cdrCallId ?? "—"}
                      </TableCell>
                      <TableCell className="font-mono text-sm">{v.prefix ?? "—"}</TableCell>
                      <TableCell className="text-sm">{v.durationSecs != null ? `${v.durationSecs}s` : "—"}</TableCell>
                      <TableCell className="font-mono text-sm">
                        {v.sippyActualCost != null ? `$${v.sippyActualCost.toFixed(6)}` : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {v.reproducedCost != null ? `$${v.reproducedCost.toFixed(6)}` : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {v.deltaAmount != null ? (
                          <span className={v.deltaAmount > 0.0001 ? "text-red-400" : v.deltaAmount < -0.0001 ? "text-amber-400" : "text-emerald-400"}>
                            {v.deltaAmount > 0 ? "+" : ""}{v.deltaAmount.toFixed(6)}
                          </span>
                        ) : "—"}
                      </TableCell>
                      <TableCell><DiscrepancyBadge type={v.discrepancyType} /></TableCell>
                      <TableCell><SeverityBadge severity={v.severity} /></TableCell>
                      <TableCell><StatusBadge status={v.verificationStatus} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail dialog */}
      <Dialog open={detailId != null} onOpenChange={open => !open && setDetailId(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" />
              Verification Detail #{detailId}
            </DialogTitle>
            {detail && (
              <DialogDescription className="flex items-center gap-2 mt-1">
                <DiscrepancyBadge type={detail.discrepancyType} />
                <SeverityBadge severity={detail.severity} />
                <StatusBadge status={detail.verificationStatus} />
              </DialogDescription>
            )}
          </DialogHeader>

          {detail && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">CDR Call ID</p>
                  <p className="font-mono">{detail.cdrCallId ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Start Time</p>
                  <p>{detail.cdrStartTime ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Prefix / Destination</p>
                  <p className="font-mono">{detail.prefix ?? "—"} {detail.destination ? `(${detail.destination})` : ""}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Duration / Billed</p>
                  <p className="font-mono">{detail.durationSecs ?? "—"}s / {detail.billedSecs ?? "—"}s</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Sippy Actual</p>
                  <p className="font-mono text-red-400">${detail.sippyActualCost?.toFixed(8) ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Reproduced</p>
                  <p className="font-mono text-emerald-400">${detail.reproducedCost?.toFixed(8) ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Delta</p>
                  <p className={`font-mono font-bold ${(detail.deltaAmount ?? 0) > 0.0001 ? "text-red-400" : (detail.deltaAmount ?? 0) < -0.0001 ? "text-amber-400" : "text-emerald-400"}`}>
                    {detail.deltaAmount != null ? `${detail.deltaAmount > 0 ? "+" : ""}${detail.deltaAmount.toFixed(8)}` : "—"}
                    {detail.deltaPct != null ? ` (${detail.deltaPct.toFixed(2)}%)` : ""}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Tariff Version</p>
                  <p className="font-mono">#{detail.tariffVersionId ?? "—"}</p>
                </div>
              </div>

              {detail.notes && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Notes</p>
                  <p className="text-muted-foreground">{detail.notes}</p>
                </div>
              )}

              {detail.rateSnapshot && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Rate Used for Reproduction</p>
                  <div className="bg-muted/30 rounded p-3 border border-border">
                    <RateSnapshotDetail rateSnapshot={detail.rateSnapshot} />
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
