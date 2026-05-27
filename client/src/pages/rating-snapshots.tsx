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
  Lock, ShieldCheck, AlertTriangle, CheckCircle2, RefreshCw,
  Database, DollarSign, Fingerprint, Layers, Play, TrendingUp,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

interface InvoiceCdrSnapshot {
  id:                     number;
  cdrId?:                 string;
  cdrStartTime?:          string;
  callee?:                string;
  durationSecs?:          number;
  iTariff?:               string;
  tariffVersionId?:       number;
  ratingVerificationId?:  number;
  reproducedCost:         number;
  actualCost?:            number;
  delta?:                 number;
  interval1Used?:         number;
  intervalNUsed?:         number;
  price1Used?:            number;
  priceNUsed?:            number;
  connectFeeUsed?:        number;
  gracePeriodUsed?:       number;
  freeSecondsUsed?:       number;
  postCallSurchargeUsed?: number;
  prefix?:                string;
  verificationStatus:     string;
  snapshotHash:           string;
  lockedAt:               string;
  createdAt:              string;
}

interface SnapshotSummary {
  total:           number;
  withDelta:       number;
  exact:           number;
  totalDelta:      number;
  totalReproduced: number;
  totalActual:     number;
  integrityErrors: number;
}

interface LockBatchResult {
  total:      number;
  created:    number;
  skipped:    number;
  errors:     number;
  durationMs: number;
}

interface IntegrityAuditResult {
  audited:  number;
  passed:   number;
  failed:   number;
  failures: Array<{ id: number; stored: string; computed: string }>;
}

interface SippyTariff {
  iTariff: string | number;
  name:    string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

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

function HashChip({ hash }: { hash: string }) {
  return (
    <span
      className="font-mono text-xs text-muted-foreground bg-muted/40 rounded px-1.5 py-0.5 cursor-default"
      title={hash}
    >
      {hash.slice(0, 8)}…{hash.slice(-4)}
    </span>
  );
}

function DeltaCell({ delta }: { delta?: number }) {
  if (delta == null) return <span className="text-muted-foreground">—</span>;
  const abs = Math.abs(delta);
  const color = abs <= 0.0001
    ? "text-emerald-400"
    : delta > 0 ? "text-red-400" : "text-amber-400";
  return (
    <span className={`font-mono text-sm ${color}`}>
      {delta > 0 ? "+" : ""}{delta.toFixed(6)}
    </span>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function RatingSnapshotsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedTariff, setSelectedTariff] = useState<string>("");
  const [filterStatus, setFilterStatus]     = useState<string>("all");
  const [detailId, setDetailId]             = useState<number | null>(null);
  const [batchResult, setBatchResult]       = useState<LockBatchResult | null>(null);
  const [auditResult, setAuditResult]       = useState<IntegrityAuditResult | null>(null);

  const { data: tariffs = [], isLoading: loadingTariffs } = useQuery<SippyTariff[]>({
    queryKey: ["/api/sippy/tariffs"],
  });

  const { data: summary } = useQuery<SnapshotSummary>({
    queryKey: ["/api/rating-snapshots/summary", selectedTariff],
    queryFn: () =>
      apiRequest("GET", `/api/rating-snapshots/summary${selectedTariff ? `?iTariff=${selectedTariff}` : ""}`).then(r => r.json()),
    refetchInterval: 30000,
  });

  const { data: snapshots = [], isLoading: loadingList } = useQuery<InvoiceCdrSnapshot[]>({
    queryKey: ["/api/rating-snapshots", selectedTariff, filterStatus],
    queryFn: () => {
      const params = new URLSearchParams();
      if (selectedTariff) params.set("iTariff", selectedTariff);
      if (filterStatus !== "all") params.set("verificationStatus", filterStatus);
      params.set("limit", "200");
      return apiRequest("GET", `/api/rating-snapshots?${params}`).then(r => r.json());
    },
  });

  const { data: detail } = useQuery<InvoiceCdrSnapshot>({
    queryKey: ["/api/rating-snapshots", detailId],
    queryFn: () => apiRequest("GET", `/api/rating-snapshots/${detailId}`).then(r => r.json()),
    enabled:  detailId != null,
  });

  const lockMutation = useMutation({
    mutationFn: (opts: { iTariff?: string; limit: number }) =>
      apiRequest("POST", "/api/rating-snapshots/lock-batch", opts).then(r => r.json()),
    onSuccess: (data: LockBatchResult) => {
      setBatchResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/rating-snapshots"] });
      toast({
        title: `Snapshots locked — ${data.created} created, ${data.skipped} skipped`,
        description: `${data.errors} errors · ${(data.durationMs / 1000).toFixed(1)}s`,
      });
    },
    onError: (err: any) => {
      toast({ title: "Lock failed", description: err.message, variant: "destructive" });
    },
  });

  const auditMutation = useMutation({
    mutationFn: (opts: { iTariff?: string; limit: number }) =>
      apiRequest("POST", "/api/rating-snapshots/integrity-audit", opts).then(r => r.json()),
    onSuccess: (data: IntegrityAuditResult) => {
      setAuditResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/rating-snapshots"] });
      toast({
        title: data.failed === 0
          ? `Integrity OK — ${data.audited} snapshots verified`
          : `${data.failed} integrity failures detected`,
        variant: data.failed > 0 ? "destructive" : "default",
      });
    },
    onError: (err: any) => {
      toast({ title: "Audit failed", description: err.message, variant: "destructive" });
    },
  });

  const exactPct = summary && summary.total > 0
    ? Math.round((summary.exact / summary.total) * 100)
    : null;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Lock className="h-6 w-6 text-primary" />
            Immutable Rating Snapshots
          </h1>
          <p className="text-muted-foreground mt-1">
            Crystallized telecom finance truth — permanent, tamper-evident per-CDR economic records. Foundation for invoice delivery and carrier reconciliation.
          </p>
        </div>

        <div className="flex gap-2 items-center flex-wrap">
          <Select value={selectedTariff} onValueChange={setSelectedTariff}>
            <SelectTrigger data-testid="select-tariff" className="w-52">
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
            data-testid="button-lock-batch"
            onClick={() => lockMutation.mutate({ iTariff: selectedTariff || undefined, limit: 1000 })}
            disabled={lockMutation.isPending || auditMutation.isPending}
          >
            <Lock className={`h-4 w-4 mr-2 ${lockMutation.isPending ? "animate-pulse" : ""}`} />
            {lockMutation.isPending ? "Locking…" : "Lock Verified CDRs"}
          </Button>
          <Button
            data-testid="button-audit"
            variant="outline"
            onClick={() => auditMutation.mutate({ iTariff: selectedTariff || undefined, limit: 500 })}
            disabled={lockMutation.isPending || auditMutation.isPending}
          >
            <Fingerprint className={`h-4 w-4 mr-2 ${auditMutation.isPending ? "animate-pulse" : ""}`} />
            {auditMutation.isPending ? "Auditing…" : "Integrity Audit"}
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          {
            label: "Total Snapshots",
            value: summary?.total ?? 0,
            icon: <Database className="h-4 w-4 text-blue-400" />,
          },
          {
            label: "Exact Match",
            value: summary?.exact ?? 0,
            sub: exactPct != null ? `${exactPct}%` : undefined,
            icon: <CheckCircle2 className="h-4 w-4 text-emerald-400" />,
          },
          {
            label: "With Delta",
            value: summary?.withDelta ?? 0,
            icon: <AlertTriangle className="h-4 w-4 text-amber-400" />,
          },
          {
            label: "Reproduced Total",
            value: summary?.totalReproduced != null
              ? `$${summary.totalReproduced.toFixed(4)}`
              : "$0.00",
            sub: summary?.totalDelta != null && Math.abs(summary.totalDelta) > 0.0001
              ? `Δ $${summary.totalDelta.toFixed(4)}`
              : undefined,
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

      {/* Accuracy bar */}
      {exactPct != null && (
        <Card>
          <CardContent className="pt-4">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-muted-foreground">Snapshot accuracy (exact matches)</span>
              <span className={exactPct >= 99 ? "text-emerald-400" : exactPct >= 95 ? "text-amber-400" : "text-red-400"}>
                {exactPct}%
              </span>
            </div>
            <Progress value={exactPct} className="h-2" />
          </CardContent>
        </Card>
      )}

      {/* Batch result */}
      {batchResult && (
        <Card className="border-blue-500/30 bg-blue-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Lock className="h-4 w-4 text-blue-400" />
              Last Lock Run
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-4 text-sm">
              {[
                { label: "Total",    value: batchResult.total    },
                { label: "Created",  value: batchResult.created  },
                { label: "Skipped",  value: batchResult.skipped  },
                { label: "Errors",   value: batchResult.errors   },
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

      {/* Integrity audit result */}
      {auditResult && (
        <Card className={auditResult.failed > 0
          ? "border-red-500/40 bg-red-500/5"
          : "border-emerald-500/30 bg-emerald-500/5"}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Fingerprint className="h-4 w-4" />
              Integrity Audit
              {auditResult.failed === 0
                ? <Badge variant="outline" className="ml-2 text-xs bg-emerald-500/15 text-emerald-400 border-emerald-500/30">All OK</Badge>
                : <Badge variant="outline" className="ml-2 text-xs bg-red-500/15 text-red-400 border-red-500/30">{auditResult.failed} FAILURES</Badge>
              }
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4 text-sm">
              {[
                { label: "Audited", value: auditResult.audited },
                { label: "Passed",  value: auditResult.passed  },
                { label: "Failed",  value: auditResult.failed  },
              ].map(s => (
                <div key={s.label}>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className="font-bold font-mono">{s.value}</p>
                </div>
              ))}
            </div>
            {auditResult.failures.length > 0 && (
              <div className="mt-3 space-y-1">
                {auditResult.failures.map(f => (
                  <div key={f.id} className="text-xs font-mono text-red-400">
                    #{f.id}: stored {f.stored.slice(0, 12)}… ≠ computed {f.computed.slice(0, 12)}…
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Snapshots list */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Layers className="h-4 w-4" />
              Locked Snapshots
            </CardTitle>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger data-testid="select-filter-status" className="w-40 h-8 text-xs">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                {["all","verified","pending","disputed","flagged"].map(s => (
                  <SelectItem key={s} value={s}>{s === "all" ? "All statuses" : s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <CardDescription className="text-xs">{snapshots.length} snapshot(s) shown</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingList ? (
            <div className="text-center py-10 text-muted-foreground">Loading…</div>
          ) : snapshots.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <Lock className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p>No snapshots yet. Run "Lock Verified CDRs" to crystallize rating verifications.</p>
              <p className="text-xs mt-1">Requires completed rating verifications — visit Rating Verification first.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>CDR ID</TableHead>
                    <TableHead>Prefix</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Reproduced</TableHead>
                    <TableHead>Actual</TableHead>
                    <TableHead>Delta</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Hash</TableHead>
                    <TableHead>Locked</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {snapshots.map(s => (
                    <TableRow
                      key={s.id}
                      data-testid={`row-snapshot-${s.id}`}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setDetailId(s.id)}
                    >
                      <TableCell className="font-mono text-xs text-muted-foreground max-w-[100px] truncate">
                        {s.cdrId ?? "—"}
                      </TableCell>
                      <TableCell className="font-mono text-sm">{s.prefix ?? "—"}</TableCell>
                      <TableCell className="text-sm">{s.durationSecs != null ? `${s.durationSecs}s` : "—"}</TableCell>
                      <TableCell className="font-mono text-sm text-emerald-400">
                        ${s.reproducedCost.toFixed(6)}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {s.actualCost != null ? `$${s.actualCost.toFixed(6)}` : "—"}
                      </TableCell>
                      <TableCell><DeltaCell delta={s.delta} /></TableCell>
                      <TableCell><StatusBadge status={s.verificationStatus} /></TableCell>
                      <TableCell><HashChip hash={s.snapshotHash} /></TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(s.lockedAt).toLocaleString()}
                      </TableCell>
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
              <Lock className="h-4 w-4" />
              Snapshot #{detailId}
            </DialogTitle>
            {detail && (
              <DialogDescription className="flex items-center gap-2 mt-1">
                <StatusBadge status={detail.verificationStatus} />
                <span className="text-xs text-muted-foreground">Locked at {new Date(detail.lockedAt).toLocaleString()}</span>
              </DialogDescription>
            )}
          </DialogHeader>

          {detail && (
            <div className="space-y-4 text-sm">
              {/* Identity */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">CDR ID</p>
                  <p className="font-mono text-xs">{detail.cdrId ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Start Time</p>
                  <p>{detail.cdrStartTime ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Prefix / Callee</p>
                  <p className="font-mono">{detail.prefix ?? "—"} {detail.callee ? `→ ${detail.callee}` : ""}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Duration</p>
                  <p className="font-mono">{detail.durationSecs ?? "—"}s</p>
                </div>
              </div>

              {/* Economics */}
              <div className="bg-muted/20 rounded border border-border p-3 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Crystallized Economics</p>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Reproduced</p>
                    <p className="font-mono font-bold text-emerald-400">${detail.reproducedCost.toFixed(8)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Actual (Sippy)</p>
                    <p className="font-mono">{detail.actualCost != null ? `$${detail.actualCost.toFixed(8)}` : "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Delta</p>
                    <DeltaCell delta={detail.delta} />
                  </div>
                </div>
              </div>

              {/* Rate parameters */}
              <div className="bg-muted/20 rounded border border-border p-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Rate Parameters Used</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-xs">
                  {[
                    ["Interval 1", `${detail.interval1Used ?? "—"}s`],
                    ["Interval N", `${detail.intervalNUsed ?? "—"}s`],
                    ["Price 1",    detail.price1Used    != null ? detail.price1Used.toString()    : "—"],
                    ["Price N",    detail.priceNUsed    != null ? detail.priceNUsed.toString()    : "—"],
                    ["Connect Fee", detail.connectFeeUsed != null ? `$${detail.connectFeeUsed}` : "—"],
                    ["Grace",      `${detail.gracePeriodUsed ?? 0}s`],
                    ["Free Secs",  `${detail.freeSecondsUsed ?? 0}s`],
                    ["Surcharge",  detail.postCallSurchargeUsed != null ? `$${detail.postCallSurchargeUsed}` : "—"],
                  ].map(([label, val]) => (
                    <div key={label}>
                      <p className="text-muted-foreground">{label}</p>
                      <p className="text-foreground">{val}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Provenance */}
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Tariff Version</p>
                <p className="font-mono text-xs">#{detail.tariffVersionId ?? "—"}</p>
                <p className="text-xs text-muted-foreground mt-1">Rating Verification</p>
                <p className="font-mono text-xs">#{detail.ratingVerificationId ?? "—"}</p>
              </div>

              {/* Hash */}
              <div className="bg-slate-900/40 rounded border border-border p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Fingerprint className="h-3.5 w-3.5 text-muted-foreground" />
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Tamper-Evident Hash</p>
                </div>
                <p className="font-mono text-xs text-muted-foreground break-all">{detail.snapshotHash}</p>
                <p className="text-xs text-muted-foreground mt-1">SHA-256 of crystallized economic fields. Any modification to the data above would produce a different hash.</p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
