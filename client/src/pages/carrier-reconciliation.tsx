import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  ArrowRightLeft, Play, AlertTriangle, CheckCircle2, TrendingDown,
  Eye, DollarSign, ShieldAlert, Info,
} from "lucide-react";

interface CarrierReconciliation {
  id:                        number;
  carrierName:               string;
  iTariff?:                  string;
  invoiceRef?:               string;
  invoiceDate?:              string;
  periodStart?:              string;
  periodEnd?:                string;
  carrierTotal?:             number;
  sippyTotal?:               number;
  reproducedTotal?:          number;
  snapshotTotal?:            number;
  deltaCarrierVsReproduced?: number;
  deltaCarrierVsSippy?:      number;
  discrepancyCount?:         number;
  status:                    string;
  notes?:                    string;
  createdAt:                 string;
}

interface ReconciliationResult {
  reconciliation: CarrierReconciliation;
  analysis: {
    deltaCarrierVsReproduced: number;
    deltaCarrierVsSippy:      number;
    deltaSippyVsReproduced:   number;
    discrepancyType:          string;
    severity:                 string;
    snapshotCount:            number;
    recommendations:          string[];
  };
}

interface SippyTariff { iTariff: string | number; name: string; }

function SeverityBadge({ severity }: { severity: string }) {
  const cfg: Record<string, string> = {
    none:     "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
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
    shadow:   "bg-slate-500/15 text-slate-400 border-slate-500/30",
    pending:  "bg-blue-500/15 text-blue-400 border-blue-500/30",
    reviewed: "bg-purple-500/15 text-purple-400 border-purple-500/30",
    resolved: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    disputed: "bg-red-500/15 text-red-400 border-red-500/30",
  };
  return (
    <Badge variant="outline" className={`capitalize text-xs ${cfg[status] ?? cfg.shadow}`}>
      {status === 'shadow' ? '🔍 Shadow' : status}
    </Badge>
  );
}

function DiscrepancyTypeLabel({ type }: { type: string }) {
  const map: Record<string, string> = {
    exact_match:               "Exact Match",
    overbilled_by_carrier:     "Carrier Overbilled",
    underbilled_by_carrier:    "Carrier Underbilled",
    sippy_vs_reproduced_drift: "Sippy/Reproduced Drift",
    large_discrepancy:         "Large Discrepancy",
    missing_snapshots:         "Missing Snapshots",
  };
  return <span>{map[type] ?? type}</span>;
}

export default function CarrierReconciliationPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [showForm, setShowForm]     = useState(false);
  const [detailId, setDetailId]     = useState<number | null>(null);
  const [lastResult, setLastResult] = useState<ReconciliationResult | null>(null);
  const [filterStatus, setFilterStatus] = useState("all");

  const [form, setForm] = useState({
    carrierName: "", iTariff: "", invoiceRef: "", invoiceDate: "",
    periodStart: "", periodEnd: "", carrierTotal: "", notes: "",
  });

  const { data: tariffs = [] } = useQuery<SippyTariff[]>({ queryKey: ["/api/sippy/tariffs"] });

  const { data: reconciliations = [], isLoading } = useQuery<CarrierReconciliation[]>({
    queryKey: ["/api/carrier-reconciliations", filterStatus],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filterStatus !== "all") params.set("status", filterStatus);
      return apiRequest("GET", `/api/carrier-reconciliations?${params}`).then(r => r.json());
    },
  });

  const { data: detail } = useQuery<CarrierReconciliation>({
    queryKey: ["/api/carrier-reconciliations", detailId],
    queryFn: () => apiRequest("GET", `/api/carrier-reconciliations/${detailId}`).then(r => r.json()),
    enabled: detailId != null,
  });

  const runMutation = useMutation({
    mutationFn: (data: Record<string, any>) =>
      apiRequest("POST", "/api/carrier-reconciliations/run", {
        ...data,
        carrierTotal: parseFloat(data.carrierTotal),
      }).then(r => r.json()),
    onSuccess: (data: ReconciliationResult) => {
      setLastResult(data);
      setShowForm(false);
      queryClient.invalidateQueries({ queryKey: ["/api/carrier-reconciliations"] });
      const delta = Math.abs(data.analysis.deltaCarrierVsReproduced ?? 0);
      toast({
        title: `Reconciliation complete — ${data.analysis.discrepancyType.replace(/_/g, ' ')}`,
        description: `Delta: $${delta.toFixed(4)} · Severity: ${data.analysis.severity} · ${data.analysis.snapshotCount} snapshots`,
        variant: data.analysis.severity === 'critical' ? 'destructive' : 'default',
      });
    },
    onError: (err: any) => {
      toast({ title: "Reconciliation failed", description: err.message, variant: "destructive" });
    },
  });

  const stats = {
    total:       reconciliations.length,
    withDelta:   reconciliations.filter(r => Math.abs(r.deltaCarrierVsReproduced ?? 0) > 0.5).length,
    critical:    reconciliations.filter(r => Math.abs(r.deltaCarrierVsReproduced ?? 0) >= 50).length,
    totalSaved:  reconciliations.reduce((s, r) => s + Math.max(0, -(r.deltaCarrierVsReproduced ?? 0)), 0),
  };

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ArrowRightLeft className="h-6 w-6 text-primary" />
            Carrier Invoice Reconciliation
          </h1>
          <p className="text-muted-foreground mt-1">
            Compare vendor invoices against Sippy actuals and BitsAuto reproduced costs. Shadow verification mode — intelligence only, no automatic accounting actions.
          </p>
        </div>
        <Button data-testid="button-run-reconciliation" onClick={() => setShowForm(true)}>
          <Play className="h-4 w-4 mr-2" />Run Reconciliation
        </Button>
      </div>

      {/* Shadow mode notice */}
      <div className="flex items-start gap-3 bg-slate-500/10 border border-slate-500/30 rounded-lg p-4">
        <ShieldAlert className="h-5 w-5 text-slate-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-slate-300">Shadow Verification Mode</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            All reconciliations run in shadow mode. Discrepancies are detected and reported as intelligence.
            No automatic accounting actions. Human review required before any financial adjustments.
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total Runs",     value: stats.total,       icon: <ArrowRightLeft className="h-4 w-4 text-blue-400" /> },
          { label: "With Δ >$0.50",  value: stats.withDelta,   icon: <AlertTriangle className="h-4 w-4 text-amber-400" /> },
          { label: "Critical",       value: stats.critical,    icon: <TrendingDown className="h-4 w-4 text-red-400" /> },
          { label: "Carrier Overbill Detected", value: `$${stats.totalSaved.toFixed(2)}`, icon: <DollarSign className="h-4 w-4 text-emerald-400" /> },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{s.label}</span>
                {s.icon}
              </div>
              <p className="text-2xl font-bold mt-1 font-mono">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Last result card */}
      {lastResult && (
        <Card className={`border-${lastResult.analysis.severity === 'critical' ? 'red' : lastResult.analysis.severity === 'major' ? 'orange' : 'emerald'}-500/30 bg-${lastResult.analysis.severity === 'critical' ? 'red' : lastResult.analysis.severity === 'major' ? 'orange' : 'emerald'}-500/5`}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <ArrowRightLeft className="h-4 w-4" />
              Latest Reconciliation — {lastResult.reconciliation.carrierName}
              <SeverityBadge severity={lastResult.analysis.severity} />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm mb-4">
              {[
                { label: "Carrier Total",      value: `$${(lastResult.reconciliation.carrierTotal ?? 0).toFixed(4)}` },
                { label: "Reproduced Total",   value: `$${(lastResult.analysis.reproducedTotal ?? 0).toFixed(4)}` },
                { label: "Δ Carrier vs BitsAuto", value: `$${(lastResult.analysis.deltaCarrierVsReproduced ?? 0).toFixed(4)}` },
                { label: "Snapshots Compared", value: lastResult.analysis.snapshotCount.toLocaleString() },
              ].map(s => (
                <div key={s.label}>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className="font-bold font-mono">{s.value}</p>
                </div>
              ))}
            </div>
            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Intelligence Recommendations</p>
              {lastResult.analysis.recommendations.length > 0
                ? lastResult.analysis.recommendations.map((r, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-blue-400" />
                      <span className="text-muted-foreground">{r}</span>
                    </div>
                  ))
                : <p className="text-sm text-emerald-400 flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4" />No discrepancies detected.</p>
              }
            </div>
          </CardContent>
        </Card>
      )}

      {/* Reconciliation list */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base">Reconciliation History</CardTitle>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger data-testid="select-filter-status" className="w-36 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["all","shadow","pending","reviewed","resolved","disputed"].map(s => (
                  <SelectItem key={s} value={s}>{s === "all" ? "All statuses" : s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <CardDescription className="text-xs">{reconciliations.length} reconciliation(s)</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading…</div>
          ) : reconciliations.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <ArrowRightLeft className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p>No reconciliations yet. Enter a carrier invoice to begin.</p>
              <p className="text-xs mt-1">Requires locked rating snapshots for the period.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Carrier</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Carrier Total</TableHead>
                    <TableHead>Reproduced</TableHead>
                    <TableHead>Δ</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reconciliations.map(r => (
                    <TableRow
                      key={r.id}
                      data-testid={`row-reconciliation-${r.id}`}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setDetailId(r.id)}
                    >
                      <TableCell className="font-medium text-sm">{r.carrierName}</TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono">
                        {r.periodStart ?? "—"} → {r.periodEnd ?? "—"}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {r.carrierTotal != null ? `$${r.carrierTotal.toFixed(4)}` : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {r.reproducedTotal != null ? `$${r.reproducedTotal.toFixed(4)}` : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {r.deltaCarrierVsReproduced != null ? (
                          <span className={Math.abs(r.deltaCarrierVsReproduced) < 0.5 ? "text-emerald-400" : Math.abs(r.deltaCarrierVsReproduced) < 5 ? "text-amber-400" : "text-red-400"}>
                            {r.deltaCarrierVsReproduced > 0 ? "+" : ""}{r.deltaCarrierVsReproduced.toFixed(4)}
                          </span>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        <DiscrepancyTypeLabel type="shadow" />
                      </TableCell>
                      <TableCell><StatusBadge status={r.status} /></TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(r.createdAt).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Run form dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Run Carrier Reconciliation</DialogTitle>
            <DialogDescription>
              Enter carrier invoice details. BitsAuto will compare against locked immutable snapshots.
              Shadow mode — no automatic actions.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1.5 block">Carrier Name *</Label>
                <Input
                  data-testid="input-carrier-name"
                  value={form.carrierName}
                  onChange={e => setForm(f => ({ ...f, carrierName: e.target.value }))}
                  placeholder="e.g. Tata Communications"
                />
              </div>
              <div>
                <Label className="text-xs mb-1.5 block">Invoice Reference</Label>
                <Input
                  data-testid="input-invoice-ref"
                  value={form.invoiceRef}
                  onChange={e => setForm(f => ({ ...f, invoiceRef: e.target.value }))}
                  placeholder="INV-2026-0042"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Tariff (optional)</Label>
              <Select value={form.iTariff} onValueChange={v => setForm(f => ({ ...f, iTariff: v }))}>
                <SelectTrigger data-testid="select-recon-tariff">
                  <SelectValue placeholder="All tariffs" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All tariffs</SelectItem>
                  {tariffs.map(t => (
                    <SelectItem key={String(t.iTariff)} value={String(t.iTariff)}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1.5 block">Period Start *</Label>
                <Input
                  data-testid="input-recon-period-start"
                  type="date"
                  value={form.periodStart}
                  onChange={e => setForm(f => ({ ...f, periodStart: e.target.value }))}
                />
              </div>
              <div>
                <Label className="text-xs mb-1.5 block">Period End *</Label>
                <Input
                  data-testid="input-recon-period-end"
                  type="date"
                  value={form.periodEnd}
                  onChange={e => setForm(f => ({ ...f, periodEnd: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Carrier Invoice Total ($) *</Label>
              <Input
                data-testid="input-carrier-total"
                type="number"
                step="0.000001"
                value={form.carrierTotal}
                onChange={e => setForm(f => ({ ...f, carrierTotal: e.target.value }))}
                placeholder="0.000000"
              />
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Notes</Label>
              <Textarea
                data-testid="input-recon-notes"
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Invoice date, currency, contact…"
                rows={2}
              />
            </div>
            <Button
              data-testid="button-confirm-run"
              className="w-full"
              onClick={() => runMutation.mutate(form)}
              disabled={runMutation.isPending || !form.carrierName || !form.periodStart || !form.periodEnd || !form.carrierTotal}
            >
              {runMutation.isPending ? "Running…" : "Run Reconciliation (Shadow Mode)"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Detail dialog */}
      <Dialog open={detailId != null} onOpenChange={open => !open && setDetailId(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowRightLeft className="h-4 w-4" />
              Reconciliation #{detailId}
            </DialogTitle>
            {detail && <StatusBadge status={detail.status} />}
          </DialogHeader>
          {detail && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><p className="text-xs text-muted-foreground">Carrier</p><p className="font-semibold">{detail.carrierName}</p></div>
                <div><p className="text-xs text-muted-foreground">Invoice Ref</p><p className="font-mono">{detail.invoiceRef ?? "—"}</p></div>
                <div><p className="text-xs text-muted-foreground">Period</p><p className="font-mono text-xs">{detail.periodStart} → {detail.periodEnd}</p></div>
                <div><p className="text-xs text-muted-foreground">Tariff</p><p>{detail.iTariff ?? "All"}</p></div>
              </div>
              <div className="bg-muted/20 rounded border border-border p-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Cost Comparison</p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {[
                    ["Carrier Total",     `$${(detail.carrierTotal ?? 0).toFixed(6)}`],
                    ["Sippy Total",       `$${(detail.sippyTotal ?? 0).toFixed(6)}`],
                    ["Reproduced Total",  `$${(detail.reproducedTotal ?? 0).toFixed(6)}`],
                    ["Snapshot Total",    `$${(detail.snapshotTotal ?? 0).toFixed(6)}`],
                    ["Δ Carrier vs BitsAuto", `$${(detail.deltaCarrierVsReproduced ?? 0).toFixed(6)}`],
                    ["Δ Carrier vs Sippy",    `$${(detail.deltaCarrierVsSippy ?? 0).toFixed(6)}`],
                  ].map(([label, val]) => (
                    <div key={label}>
                      <p className="text-muted-foreground">{label}</p>
                      <p className="font-mono font-semibold">{val}</p>
                    </div>
                  ))}
                </div>
              </div>
              {detail.notes && (
                <div><p className="text-xs text-muted-foreground">Notes</p><p className="text-muted-foreground">{detail.notes}</p></div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
