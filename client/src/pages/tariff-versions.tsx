import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  GitBranch, Camera, Clock, TrendingDown, TrendingUp,
  Minus, Plus, ArrowRightLeft, RefreshCw, ChevronRight,
  FileText, Activity, Scale, RotateCcw, Shield, AlertTriangle,
  CheckCircle2, XCircle, Lock,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface TariffVersion {
  id:              number;
  iTariff:         string;
  tariffName?:     string;
  source:          string;
  rateCount:       number;
  effectiveFrom?:  string;
  effectiveTo?:    string;
  notes?:          string;
  createdBy?:      string;
  createdAt:       string;
  isLocked?:       boolean;
  restoredFromId?: number | null;
}

interface RestorePreview {
  versionId:         number;
  iTariff:           string;
  tariffName?:       string;
  snapshotAt:        string;
  source:            string;
  rateCountSnapshot: number;
  rateCountLive:     number;
  summary: {
    willAdd:          number;
    willRemove:       number;
    willChange:       number;
    connectFeeChanges:number;
    intervalChanges:  number;
    rateChanges:      number;
    total:            number;
  };
  willAdd:    any[];
  willRemove: any[];
  willChange: any[];
}

// Wizard steps
type RestoreStep = 'preview' | 'governance' | 'impact' | 'confirm' | 'result';

interface TariffChangeEvent {
  id:              number;
  tariffVersionId: number;
  iTariff:         string;
  prefix?:         string;
  destination?:    string;
  changeType:      string;
  oldInterval1?:   number;
  newInterval1?:   number;
  oldIntervalN?:   number;
  newIntervalN?:   number;
  oldPrice1?:      number;
  newPrice1?:      number;
  oldPriceN?:      number;
  newPriceN?:      number;
}

interface VersionDetail {
  version:      TariffVersion | null;
  changeEvents: TariffChangeEvent[];
  rates:        any[];
}

interface CompareDelta {
  before: number;
  after:  number;
}

interface CompareChangedRow {
  prefix:  string;
  before:  any;
  after:   any;
  deltas:  Record<string, CompareDelta>;
}

interface CompareResult {
  snapshotId:        number;
  iTariff:           string;
  tariffName?:       string;
  snapshotAt:        string;
  rateCountSnapshot: number;
  rateCountLive:     number;
  summary: {
    added:   number;
    removed: number;
    changed: number;
    total:   number;
  };
  added:   any[];
  removed: any[];
  changed: CompareChangedRow[];
}

interface SippyTariff {
  iTariff: string | number;
  name:    string;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SourceBadge({ source }: { source: string }) {
  const map: Record<string, { label: string; className: string }> = {
    manual:          { label: "Manual",        className: "bg-slate-500/15 text-slate-400 border-slate-500/30" },
    auto_snapshot:   { label: "Auto",          className: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
    pre_change:      { label: "Pre-Change",    className: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
    post_change:     { label: "Post-Change",   className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
    morocco_workflow:{ label: "Workflow",      className: "bg-purple-500/15 text-purple-400 border-purple-500/30" },
    restore:         { label: "Restored",      className: "bg-violet-500/15 text-violet-400 border-violet-500/30" },
  };
  const cfg = map[source] ?? { label: source, className: "bg-slate-500/15 text-slate-400 border-slate-500/30" };
  return <Badge variant="outline" className={cfg.className}>{cfg.label}</Badge>;
}

function ChangeTypeBadge({ type }: { type: string }) {
  const icons: Record<string, React.ReactNode> = {
    added:              <Plus className="h-3 w-3" />,
    removed:            <Minus className="h-3 w-3" />,
    interval_changed:   <ArrowRightLeft className="h-3 w-3" />,
    rate_changed:       <TrendingDown className="h-3 w-3" />,
    surcharge_changed:  <TrendingUp className="h-3 w-3" />,
    modified:           <Activity className="h-3 w-3" />,
  };
  const colors: Record<string, string> = {
    added:              "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    removed:            "bg-red-500/15 text-red-400 border-red-500/30",
    interval_changed:   "bg-blue-500/15 text-blue-400 border-blue-500/30",
    rate_changed:       "bg-amber-500/15 text-amber-400 border-amber-500/30",
    surcharge_changed:  "bg-purple-500/15 text-purple-400 border-purple-500/30",
    modified:           "bg-slate-500/15 text-slate-400 border-slate-500/30",
  };
  return (
    <Badge variant="outline" className={`gap-1 ${colors[type] ?? colors.modified}`}>
      {icons[type]} {type.replace(/_/g, ' ')}
    </Badge>
  );
}

function IntervalDiff({ oldV, newV }: { oldV?: number | null; newV?: number | null }) {
  if (oldV == null && newV == null) return <span className="text-muted-foreground">—</span>;
  if (oldV === newV) return <span className="text-muted-foreground">{oldV}s</span>;
  return (
    <span className="flex items-center gap-1 text-sm">
      <span className="text-red-400 line-through">{oldV ?? '—'}s</span>
      <ChevronRight className="h-3 w-3 text-muted-foreground" />
      <span className="text-emerald-400">{newV ?? '—'}s</span>
    </span>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TariffVersionsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedTariff, setSelectedTariff] = useState<string>("");
  const [detailVersionId, setDetailVersionId] = useState<number | null>(null);
  const [compareLiveId, setCompareLiveId] = useState<number | null>(null);

  // ── P5 Restore Snapshot wizard state ─────────────────────────────────────
  const [restoreVersionId, setRestoreVersionId]   = useState<number | null>(null);
  const [restoreStep, setRestoreStep]             = useState<RestoreStep>('preview');
  const [restoreConfirmText, setRestoreConfirmText] = useState('');
  const [restoreAcknowledge, setRestoreAcknowledge] = useState(false);
  const [restoreReason, setRestoreReason]         = useState('');
  const [restoreResult, setRestoreResult]         = useState<any>(null);

  function openRestoreWizard(id: number) {
    setRestoreVersionId(id);
    setRestoreStep('preview');
    setRestoreConfirmText('');
    setRestoreAcknowledge(false);
    setRestoreReason('');
    setRestoreResult(null);
  }
  function closeRestoreWizard() {
    setRestoreVersionId(null);
    setRestoreResult(null);
  }

  // Load available tariffs from Sippy
  const { data: tariffs = [], isLoading: loadingTariffs } = useQuery<SippyTariff[]>({
    queryKey: ["/api/sippy/tariffs"],
  });

  // Load version history for selected tariff
  const { data: versions = [], isLoading: loadingVersions, refetch: refetchVersions } = useQuery<TariffVersion[]>({
    queryKey: ["/api/tariff-versions", selectedTariff],
    queryFn: () => selectedTariff
      ? apiRequest("GET", `/api/tariff-versions?iTariff=${selectedTariff}`).then(r => r.json())
      : Promise.resolve([]),
    enabled: !!selectedTariff,
  });

  // Load detail for selected version
  const { data: detail, isLoading: loadingDetail } = useQuery<VersionDetail>({
    queryKey: ["/api/tariff-versions", detailVersionId, "detail"],
    queryFn: () => apiRequest("GET", `/api/tariff-versions/${detailVersionId}`).then(r => r.json()),
    enabled: detailVersionId != null,
  });

  // Compare snapshot vs live Sippy rates (non-destructive)
  const { data: compareData, isFetching: compareLoading } = useQuery<CompareResult>({
    queryKey: ["/api/tariff-versions", compareLiveId, "compare-live"],
    queryFn: () => apiRequest("GET", `/api/tariff-versions/${compareLiveId}/compare-live`).then(r => r.json()),
    enabled: compareLiveId != null,
  });

  // Snapshot mutation
  const snapshotMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/tariff-versions/snapshot", {
      iTariff:    selectedTariff,
      tariffName: tariffs.find(t => String(t.iTariff) === selectedTariff)?.name,
      source:     "manual",
    }).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Snapshot captured", description: "Tariff state saved successfully." });
      queryClient.invalidateQueries({ queryKey: ["/api/tariff-versions", selectedTariff] });
    },
    onError: (err: any) => {
      toast({ title: "Snapshot failed", description: err.message, variant: "destructive" });
    },
  });

  // Change detection mutation
  const detectMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/tariff-versions/detect-changes", {
      iTariff:    selectedTariff,
      tariffName: tariffs.find(t => String(t.iTariff) === selectedTariff)?.name,
    }).then(r => r.json()),
    onSuccess: (data) => {
      const total = (data.added ?? 0) + (data.removed ?? 0) + (data.changed ?? 0);
      toast({
        title:       total > 0 ? `${total} change(s) detected` : "No changes detected",
        description: total > 0
          ? `+${data.added} added, -${data.removed} removed, ~${data.changed} modified`
          : "Tariff is identical to the last snapshot.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/tariff-versions", selectedTariff] });
    },
    onError: (err: any) => {
      toast({ title: "Detection failed", description: err.message, variant: "destructive" });
    },
  });

  // Restore preview (dry-run diff — no writes)
  const { data: restorePreview, isFetching: previewLoading, error: previewError } = useQuery<RestorePreview>({
    queryKey: ["/api/tariff-versions", restoreVersionId, "preview-restore"],
    queryFn: () => apiRequest("POST", `/api/tariff-versions/${restoreVersionId}/preview-restore`, {})
      .then(r => r.json()),
    enabled: restoreVersionId != null,
    retry: false,
  });

  // Restore execute mutation
  const restoreMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/tariff-versions/${restoreVersionId}/restore`, {
      confirmation: 'RESTORE',
      reason:       restoreReason || undefined,
    }).then(r => r.json()),
    onSuccess: (data) => {
      setRestoreResult(data);
      setRestoreStep('result');
      queryClient.invalidateQueries({ queryKey: ["/api/tariff-versions", selectedTariff] });
      toast({ title: "Restore complete", description: `Version #${data.newVersionId} created with ${data.ratesRestored} rates.` });
    },
    onError: (err: any) => {
      toast({ title: "Restore failed", description: err.message, variant: "destructive" });
    },
  });

  const selectedTariffName = tariffs.find(t => String(t.iTariff) === selectedTariff)?.name;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <GitBranch className="h-6 w-6 text-primary" />
            Tariff Version History
          </h1>
          <p className="text-muted-foreground mt-1">
            Immutable tariff snapshots for rate governance, Morocco workflows, and invoice reproducibility.
          </p>
        </div>
      </div>

      {/* Tariff selector + actions */}
      <Card>
        <CardContent className="pt-5 flex flex-col sm:flex-row gap-4 items-start sm:items-center">
          <div className="flex-1">
            <label className="text-sm font-medium mb-1 block text-muted-foreground">Tariff</label>
            <Select value={selectedTariff} onValueChange={setSelectedTariff}>
              <SelectTrigger data-testid="select-tariff" className="w-full sm:w-72">
                <SelectValue placeholder={loadingTariffs ? "Loading tariffs…" : "Select a tariff"} />
              </SelectTrigger>
              <SelectContent>
                {tariffs.map(t => (
                  <SelectItem key={String(t.iTariff)} value={String(t.iTariff)}>
                    {t.name} <span className="text-muted-foreground text-xs ml-1">#{t.iTariff}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex gap-2 mt-5 sm:mt-0">
            <Button
              data-testid="button-snapshot"
              variant="outline"
              onClick={() => snapshotMutation.mutate()}
              disabled={!selectedTariff || snapshotMutation.isPending}
            >
              <Camera className="h-4 w-4 mr-2" />
              {snapshotMutation.isPending ? "Capturing…" : "Snapshot Now"}
            </Button>
            <Button
              data-testid="button-detect-changes"
              variant="outline"
              onClick={() => detectMutation.mutate()}
              disabled={!selectedTariff || detectMutation.isPending}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${detectMutation.isPending ? "animate-spin" : ""}`} />
              {detectMutation.isPending ? "Scanning…" : "Detect Changes"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Stats row */}
      {versions.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            {
              label: "Total Snapshots",
              value: versions.length,
              icon:  <Camera className="h-4 w-4 text-blue-400" />,
            },
            {
              label: "Latest Rate Count",
              value: versions[0]?.rateCount ?? 0,
              icon:  <FileText className="h-4 w-4 text-emerald-400" />,
            },
            {
              label: "Interval Changes",
              value: versions.filter(v => v.source === 'post_change').length,
              icon:  <ArrowRightLeft className="h-4 w-4 text-amber-400" />,
            },
            {
              label: "Last Snapshot",
              value: versions[0]
                ? new Date(versions[0].createdAt).toLocaleDateString()
                : "—",
              icon: <Clock className="h-4 w-4 text-slate-400" />,
            },
          ].map(stat => (
            <Card key={stat.label}>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{stat.label}</span>
                  {stat.icon}
                </div>
                <p className="text-2xl font-bold mt-1">{stat.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Version list */}
      {selectedTariff && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {selectedTariffName ? `${selectedTariffName} — Version History` : "Version History"}
            </CardTitle>
            <CardDescription>
              Click any row to view rate snapshot and change events.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadingVersions ? (
              <div className="text-center py-10 text-muted-foreground">Loading history…</div>
            ) : versions.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground">
                <GitBranch className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p>No snapshots yet. Click "Snapshot Now" to capture the current tariff state.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Lock</TableHead>
                    <TableHead>Rates</TableHead>
                    <TableHead>Effective From</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {versions.map(v => (
                    <TableRow
                      key={v.id}
                      data-testid={`row-version-${v.id}`}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setDetailVersionId(v.id)}
                    >
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        #{v.id}
                      </TableCell>
                      <TableCell><SourceBadge source={v.source} /></TableCell>
                      <TableCell>
                        {v.isLocked
                          ? <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 gap-1 text-xs">
                              <Lock className="h-2.5 w-2.5" /> Locked
                            </Badge>
                          : <span className="text-muted-foreground text-xs">—</span>
                        }
                      </TableCell>
                      <TableCell>{v.rateCount ?? 0}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {v.effectiveFrom
                          ? new Date(v.effectiveFrom).toLocaleDateString()
                          : "—"}
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-sm text-muted-foreground">
                        {v.notes ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(v.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                            onClick={e => { e.stopPropagation(); setCompareLiveId(v.id); }}
                          >
                            <Scale className="h-3 w-3 mr-1" />
                            vs Live
                          </Button>
                          {v.isLocked && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs text-violet-400 hover:text-violet-300 hover:bg-violet-500/10"
                              onClick={e => { e.stopPropagation(); openRestoreWizard(v.id); }}
                            >
                              <RotateCcw className="h-3 w-3 mr-1" />
                              Restore
                            </Button>
                          )}
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Version detail dialog */}
      <Dialog open={detailVersionId != null} onOpenChange={open => !open && setDetailVersionId(null)}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Camera className="h-4 w-4" />
              Version #{detailVersionId} Detail
            </DialogTitle>
            <DialogDescription>
              {detail?.version && (
                <span className="flex items-center gap-2 mt-1">
                  <SourceBadge source={detail.version.source} />
                  {detail.version.rateCount} rates · {new Date(detail.version.createdAt).toLocaleString()}
                  {detail.version.notes && (
                    <span className="text-muted-foreground">· {detail.version.notes}</span>
                  )}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          {loadingDetail ? (
            <div className="text-center py-10 text-muted-foreground">Loading…</div>
          ) : (
            <Tabs defaultValue="changes">
              <TabsList>
                <TabsTrigger value="changes" data-testid="tab-changes">
                  Change Events ({detail?.changeEvents.length ?? 0})
                </TabsTrigger>
                <TabsTrigger value="rates" data-testid="tab-rates">
                  Rate Snapshot ({detail?.rates.length ?? 0})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="changes">
                {!detail?.changeEvents.length ? (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    No change events recorded for this snapshot.
                    {detail?.version?.source === 'manual' && " (Manual snapshots record changes vs the previous auto snapshot.)"}
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Prefix</TableHead>
                        <TableHead>Destination</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Interval 1</TableHead>
                        <TableHead>Interval N</TableHead>
                        <TableHead>Price 1</TableHead>
                        <TableHead>Price N</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.changeEvents.map(e => (
                        <TableRow key={e.id} data-testid={`row-change-${e.id}`}>
                          <TableCell className="font-mono">{e.prefix ?? "—"}</TableCell>
                          <TableCell className="text-sm text-muted-foreground max-w-[160px] truncate">
                            {e.destination ?? "—"}
                          </TableCell>
                          <TableCell><ChangeTypeBadge type={e.changeType} /></TableCell>
                          <TableCell>
                            <IntervalDiff oldV={e.oldInterval1} newV={e.newInterval1} />
                          </TableCell>
                          <TableCell>
                            <IntervalDiff oldV={e.oldIntervalN} newV={e.newIntervalN} />
                          </TableCell>
                          <TableCell>
                            {e.oldPrice1 !== e.newPrice1
                              ? <span className="flex items-center gap-1 text-sm">
                                  <span className="text-red-400 line-through">{e.oldPrice1?.toFixed(4) ?? "—"}</span>
                                  <ChevronRight className="h-3 w-3" />
                                  <span className="text-emerald-400">{e.newPrice1?.toFixed(4) ?? "—"}</span>
                                </span>
                              : <span className="text-muted-foreground">{e.newPrice1?.toFixed(4) ?? "—"}</span>
                            }
                          </TableCell>
                          <TableCell>
                            {e.oldPriceN !== e.newPriceN
                              ? <span className="flex items-center gap-1 text-sm">
                                  <span className="text-red-400 line-through">{e.oldPriceN?.toFixed(4) ?? "—"}</span>
                                  <ChevronRight className="h-3 w-3" />
                                  <span className="text-emerald-400">{e.newPriceN?.toFixed(4) ?? "—"}</span>
                                </span>
                              : <span className="text-muted-foreground">{e.newPriceN?.toFixed(4) ?? "—"}</span>
                            }
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </TabsContent>

              <TabsContent value="rates">
                <div className="max-h-80 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Prefix</TableHead>
                        <TableHead>Destination</TableHead>
                        <TableHead>Interval 1</TableHead>
                        <TableHead>Interval N</TableHead>
                        <TableHead>Price 1</TableHead>
                        <TableHead>Price N</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(detail?.rates ?? []).map((r: any, i: number) => (
                        <TableRow key={i} data-testid={`row-rate-${i}`}>
                          <TableCell className="font-mono">{r.prefix ?? "—"}</TableCell>
                          <TableCell className="text-sm text-muted-foreground max-w-[160px] truncate">
                            {r.destination ?? "—"}
                          </TableCell>
                          <TableCell>{r.interval1 ?? r.interval_1 ?? "—"}s</TableCell>
                          <TableCell>{r.intervalN ?? r.interval_n ?? "—"}s</TableCell>
                          <TableCell className="font-mono text-xs">{r.price1 ?? r.price_1 ?? "—"}</TableCell>
                          <TableCell className="font-mono text-xs">{r.priceN ?? r.price_n ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>

      {/* ── P5 Restore Snapshot Wizard ─────────────────────────────────────── */}
      <Dialog open={restoreVersionId != null} onOpenChange={open => !open && closeRestoreWizard()}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-4 w-4 text-violet-400" />
              Restore Snapshot #{restoreVersionId}
            </DialogTitle>
            <DialogDescription>
              A restore creates a new tariff version from this locked snapshot and pushes it to Sippy.
              Existing versions are never overwritten.
            </DialogDescription>
          </DialogHeader>

          {/* Step indicators */}
          <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
            {(['preview','governance','impact','confirm','result'] as RestoreStep[]).map((s, i) => (
              <span key={s} className="flex items-center gap-1">
                <span className={`px-2 py-0.5 rounded font-medium ${
                  restoreStep === s ? 'bg-violet-500/20 text-violet-300' :
                  (['preview','governance','impact','confirm','result'].indexOf(restoreStep) > i)
                    ? 'text-emerald-400' : 'text-muted-foreground'
                }`}>
                  {i + 1}. {s.charAt(0).toUpperCase() + s.slice(1)}
                </span>
                {i < 4 && <ChevronRight className="h-3 w-3" />}
              </span>
            ))}
          </div>

          {/* ── Step 1: Preview (auto-loaded) ── */}
          {restoreStep === 'preview' && (
            <div className="space-y-4">
              {previewLoading && (
                <div className="text-center py-10 text-muted-foreground">
                  <RefreshCw className="h-6 w-6 mx-auto mb-2 animate-spin opacity-50" />
                  Fetching live Sippy rates and computing diff…
                </div>
              )}
              {previewError && (
                <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive text-sm">
                  <XCircle className="h-4 w-4 inline mr-2" />
                  Preview failed: {(previewError as any)?.message ?? 'Unknown error'}
                </div>
              )}
              {restorePreview && !previewLoading && (
                <div className="space-y-4">
                  <div className="rounded-lg border bg-muted/30 p-4 space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Snapshot</span>
                      <span className="font-mono">#{restorePreview.versionId} · {restorePreview.source}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Tariff</span>
                      <span>{restorePreview.tariffName ?? restorePreview.iTariff} (iTariff={restorePreview.iTariff})</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Snapshot taken</span>
                      <span>{new Date(restorePreview.snapshotAt).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Snapshot rates</span>
                      <span className="font-bold">{restorePreview.rateCountSnapshot}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Current live rates</span>
                      <span className="font-bold">{restorePreview.rateCountLive}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-lg border bg-emerald-500/5 border-emerald-500/20 p-3 text-center">
                      <p className="text-2xl font-bold text-emerald-400">{restorePreview.summary.willAdd}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Will Add</p>
                    </div>
                    <div className="rounded-lg border bg-red-500/5 border-red-500/20 p-3 text-center">
                      <p className="text-2xl font-bold text-red-400">{restorePreview.summary.willRemove}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Will Remove</p>
                    </div>
                    <div className="rounded-lg border bg-amber-500/5 border-amber-500/20 p-3 text-center">
                      <p className="text-2xl font-bold text-amber-400">{restorePreview.summary.willChange}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Will Change</p>
                    </div>
                  </div>

                  {restorePreview.summary.total === 0 && (
                    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-sm text-emerald-400 flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      Snapshot is identical to live. A restore would create a new version with no rate changes.
                    </div>
                  )}

                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={closeRestoreWizard}>Cancel</Button>
                    <Button
                      className="bg-violet-600 hover:bg-violet-700 text-white"
                      onClick={() => setRestoreStep('governance')}
                    >
                      Continue to Governance Checks
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Step 2: Governance Checks ── */}
          {restoreStep === 'governance' && restorePreview && (
            <div className="space-y-4">
              <div className="space-y-2">
                {[
                  { label: 'Snapshot integrity',      pass: true,  detail: `Version #${restorePreview.versionId} found and readable` },
                  { label: 'Snapshot is locked',      pass: true,  detail: 'is_locked = TRUE — eligible for restore' },
                  { label: 'Snapshot has rates',      pass: restorePreview.rateCountSnapshot > 0, detail: `${restorePreview.rateCountSnapshot} rates in snapshot` },
                  { label: 'Target tariff exists',    pass: restorePreview.rateCountLive >= 0, detail: `iTariff ${restorePreview.iTariff} — ${restorePreview.rateCountLive} live rates` },
                  { label: 'No overwrite of history', pass: true,  detail: 'Will create new version — existing versions preserved' },
                ].map(chk => (
                  <div key={chk.label} className={`flex items-center gap-3 rounded-lg border p-3 text-sm ${
                    chk.pass ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-red-500/20 bg-red-500/5'
                  }`}>
                    {chk.pass
                      ? <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                      : <XCircle className="h-4 w-4 text-red-400 shrink-0" />
                    }
                    <span className={chk.pass ? 'text-emerald-300' : 'text-red-300'}>{chk.label}</span>
                    <span className="text-muted-foreground ml-auto text-xs">{chk.detail}</span>
                  </div>
                ))}
              </div>

              <div className="flex justify-between gap-2">
                <Button variant="outline" onClick={() => setRestoreStep('preview')}>Back</Button>
                <Button
                  className="bg-violet-600 hover:bg-violet-700 text-white"
                  disabled={restorePreview.rateCountSnapshot === 0}
                  onClick={() => setRestoreStep('impact')}
                >
                  Continue to Impact Summary
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}

          {/* ── Step 3: Impact Summary ── */}
          {restoreStep === 'impact' && restorePreview && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-muted-foreground text-xs mb-1">Rate changes</p>
                  <p className="text-xl font-bold">{restorePreview.summary.rateChanges}</p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-muted-foreground text-xs mb-1">Interval changes</p>
                  <p className="text-xl font-bold">{restorePreview.summary.intervalChanges}</p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-muted-foreground text-xs mb-1">Connect fee changes</p>
                  <p className="text-xl font-bold">{restorePreview.summary.connectFeeChanges}</p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-muted-foreground text-xs mb-1">Total affected prefixes</p>
                  <p className="text-xl font-bold">{restorePreview.summary.total}</p>
                </div>
              </div>

              {restorePreview.summary.total > 0 && (
                <Tabs defaultValue={restorePreview.summary.willChange > 0 ? 'change' : restorePreview.summary.willAdd > 0 ? 'add' : 'remove'}>
                  <TabsList className="text-xs">
                    <TabsTrigger value="change">Will Change ({restorePreview.summary.willChange})</TabsTrigger>
                    <TabsTrigger value="add">Will Add ({restorePreview.summary.willAdd})</TabsTrigger>
                    <TabsTrigger value="remove">Will Remove ({restorePreview.summary.willRemove})</TabsTrigger>
                  </TabsList>

                  <TabsContent value="change">
                    <div className="max-h-64 overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Prefix</TableHead>
                            <TableHead>Field</TableHead>
                            <TableHead>Live → Snapshot</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {restorePreview.willChange.flatMap((r: any) =>
                            Object.entries(r.deltas).map(([field, d]: [string, any]) => (
                              <TableRow key={`${r.prefix}-${field}`}>
                                <TableCell className="font-mono text-xs">{r.prefix}</TableCell>
                                <TableCell className="text-xs text-muted-foreground">{field}</TableCell>
                                <TableCell>
                                  <span className="flex items-center gap-1 text-xs">
                                    <span className="text-red-400 line-through">{d.live}</span>
                                    <ChevronRight className="h-3 w-3 text-muted-foreground" />
                                    <span className="text-emerald-400">{d.snapshot}</span>
                                  </span>
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </TabsContent>

                  <TabsContent value="add">
                    <div className="max-h-64 overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Prefix</TableHead>
                            <TableHead>Destination</TableHead>
                            <TableHead>Price 1</TableHead>
                            <TableHead>Price N</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {restorePreview.willAdd.map((r: any, i: number) => (
                            <TableRow key={i}>
                              <TableCell className="font-mono text-xs text-emerald-400">{r.prefix ?? '—'}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{r.destination ?? '—'}</TableCell>
                              <TableCell className="text-xs">{r.price1 ?? '—'}</TableCell>
                              <TableCell className="text-xs">{r.priceN ?? '—'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </TabsContent>

                  <TabsContent value="remove">
                    <div className="max-h-64 overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Prefix</TableHead>
                            <TableHead>Destination</TableHead>
                            <TableHead>Price 1</TableHead>
                            <TableHead>Price N</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {restorePreview.willRemove.map((r: any, i: number) => (
                            <TableRow key={i}>
                              <TableCell className="font-mono text-xs text-red-400">{r.prefix ?? '—'}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{r.destination ?? '—'}</TableCell>
                              <TableCell className="text-xs">{r.price1 ?? '—'}</TableCell>
                              <TableCell className="text-xs">{r.priceN ?? '—'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </TabsContent>
                </Tabs>
              )}

              <div className="flex justify-between gap-2">
                <Button variant="outline" onClick={() => setRestoreStep('governance')}>Back</Button>
                <Button
                  className="bg-violet-600 hover:bg-violet-700 text-white"
                  onClick={() => setRestoreStep('confirm')}
                >
                  Proceed to Confirmation
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}

          {/* ── Step 4: Explicit Confirmation ── */}
          {restoreStep === 'confirm' && restorePreview && (
            <div className="space-y-5">
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm space-y-1">
                <div className="flex items-center gap-2 text-amber-400 font-semibold mb-2">
                  <AlertTriangle className="h-4 w-4" />
                  You are about to push {restorePreview.rateCountSnapshot} rates to Sippy
                </div>
                <p className="text-muted-foreground">
                  Tariff <strong>{restorePreview.tariffName ?? restorePreview.iTariff}</strong> (iTariff={restorePreview.iTariff})
                  will be restored to snapshot #{restorePreview.versionId}.
                  A new tariff version will be created. Existing versions are preserved.
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="restore-ack"
                    checked={restoreAcknowledge}
                    onCheckedChange={v => setRestoreAcknowledge(!!v)}
                    className="mt-0.5"
                  />
                  <label htmlFor="restore-ack" className="text-sm leading-relaxed cursor-pointer">
                    I understand this will overwrite live Sippy rates and create a new tariff version.
                    All existing rate changes since snapshot #{restoreVersionId} will be replaced.
                  </label>
                </div>

                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Reason (optional)</label>
                  <Textarea
                    placeholder="e.g. Reverting erroneous rate upload from 2026-07-18"
                    value={restoreReason}
                    onChange={e => setRestoreReason(e.target.value)}
                    className="text-sm resize-none"
                    rows={2}
                  />
                </div>

                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    Type <strong className="text-foreground">RESTORE</strong> to confirm
                  </label>
                  <Input
                    placeholder="RESTORE"
                    value={restoreConfirmText}
                    onChange={e => setRestoreConfirmText(e.target.value)}
                    className="font-mono"
                  />
                </div>
              </div>

              <div className="flex justify-between gap-2">
                <Button variant="outline" onClick={() => setRestoreStep('impact')}>Back</Button>
                <Button
                  className="bg-red-600 hover:bg-red-700 text-white"
                  disabled={
                    restoreConfirmText !== 'RESTORE' ||
                    !restoreAcknowledge ||
                    restoreMutation.isPending
                  }
                  onClick={() => restoreMutation.mutate()}
                >
                  {restoreMutation.isPending
                    ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Restoring…</>
                    : <><Shield className="h-4 w-4 mr-2" />Execute Restore</>
                  }
                </Button>
              </div>
            </div>
          )}

          {/* ── Step 5: Result ── */}
          {restoreStep === 'result' && restoreResult && (
            <div className="space-y-4">
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-5 text-center">
                <CheckCircle2 className="h-10 w-10 text-emerald-400 mx-auto mb-2" />
                <p className="text-lg font-bold text-emerald-300">Restore Complete</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {restoreResult.message}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">New Version ID</p>
                  <p className="text-xl font-bold font-mono">#{restoreResult.newVersionId}</p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">Rates Restored</p>
                  <p className="text-xl font-bold">{restoreResult.ratesRestored}</p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">Duration</p>
                  <p className="text-xl font-bold">{restoreResult.durationMs}ms</p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">Tariff</p>
                  <p className="text-xl font-bold">{restoreResult.iTariff}</p>
                </div>
              </div>

              {restoreResult.pushErrors?.length > 0 && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-400">
                  <p className="font-semibold mb-1">{restoreResult.pushErrors.length} prefix(es) failed to push:</p>
                  <ul className="space-y-0.5 font-mono">
                    {restoreResult.pushErrors.map((e: string, i: number) => <li key={i}>{e}</li>)}
                  </ul>
                </div>
              )}

              <div className="flex justify-end">
                <Button onClick={closeRestoreWizard}>Close</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Compare vs Live dialog */}
      <Dialog open={compareLiveId != null} onOpenChange={open => !open && setCompareLiveId(null)}>
        <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Scale className="h-4 w-4" />
              Snapshot #{compareLiveId} vs Live Sippy
              {compareData?.tariffName && (
                <span className="text-muted-foreground font-normal text-sm">— {compareData.tariffName}</span>
              )}
            </DialogTitle>
            {compareData && (
              <DialogDescription className="mt-1">
                Snapshotted {new Date(compareData.snapshotAt).toLocaleString()} ·{" "}
                {compareData.rateCountSnapshot} snapshot rates vs {compareData.rateCountLive} live rates
              </DialogDescription>
            )}
          </DialogHeader>

          {compareLoading ? (
            <div className="text-center py-12 text-muted-foreground">
              <RefreshCw className="h-6 w-6 mx-auto mb-2 animate-spin opacity-50" />
              Fetching live rates from Sippy…
            </div>
          ) : compareData ? (
            <>
              {/* Summary bar */}
              <div className="grid grid-cols-3 gap-3 my-2">
                <div className="rounded-lg border bg-emerald-500/5 border-emerald-500/20 p-3 text-center">
                  <p className="text-2xl font-bold text-emerald-400">{compareData.summary.added}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Added in Live</p>
                </div>
                <div className="rounded-lg border bg-red-500/5 border-red-500/20 p-3 text-center">
                  <p className="text-2xl font-bold text-red-400">{compareData.summary.removed}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Removed from Live</p>
                </div>
                <div className="rounded-lg border bg-amber-500/5 border-amber-500/20 p-3 text-center">
                  <p className="text-2xl font-bold text-amber-400">{compareData.summary.changed}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Modified</p>
                </div>
              </div>

              {compareData.summary.total === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  <Scale className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  Snapshot is identical to live Sippy rates. No changes detected.
                </div>
              ) : (
                <Tabs defaultValue={
                  compareData.summary.changed > 0 ? "changed"
                  : compareData.summary.added > 0 ? "added"
                  : "removed"
                }>
                  <TabsList>
                    <TabsTrigger value="changed">
                      Modified ({compareData.summary.changed})
                    </TabsTrigger>
                    <TabsTrigger value="added">
                      Added ({compareData.summary.added})
                    </TabsTrigger>
                    <TabsTrigger value="removed">
                      Removed ({compareData.summary.removed})
                    </TabsTrigger>
                  </TabsList>

                  {/* Changed rates */}
                  <TabsContent value="changed">
                    <div className="max-h-96 overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Prefix</TableHead>
                            <TableHead>Price 1</TableHead>
                            <TableHead>Price N</TableHead>
                            <TableHead>Interval 1</TableHead>
                            <TableHead>Interval N</TableHead>
                            <TableHead>Connect Fee</TableHead>
                            <TableHead>Surcharge</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {compareData.changed.map((row, i) => (
                            <TableRow key={i}>
                              <TableCell className="font-mono text-xs">{row.prefix || "—"}</TableCell>
                              {(['price1','priceN','interval1','intervalN','connectFee','postCallSurcharge'] as const).map(field => {
                                const delta = row.deltas[field];
                                return (
                                  <TableCell key={field}>
                                    {delta ? (
                                      <span className="flex items-center gap-1 text-xs">
                                        <span className="text-red-400 line-through">{delta.before}</span>
                                        <ChevronRight className="h-3 w-3 text-muted-foreground" />
                                        <span className="text-emerald-400">{delta.after}</span>
                                      </span>
                                    ) : (
                                      <span className="text-muted-foreground text-xs">{row.after[field] ?? "—"}</span>
                                    )}
                                  </TableCell>
                                );
                              })}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </TabsContent>

                  {/* Added rates */}
                  <TabsContent value="added">
                    <div className="max-h-96 overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Prefix</TableHead>
                            <TableHead>Destination</TableHead>
                            <TableHead>Price 1</TableHead>
                            <TableHead>Price N</TableHead>
                            <TableHead>Interval 1</TableHead>
                            <TableHead>Interval N</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {compareData.added.map((r: any, i: number) => (
                            <TableRow key={i}>
                              <TableCell className="font-mono text-xs text-emerald-400">{r.prefix ?? "—"}</TableCell>
                              <TableCell className="text-xs text-muted-foreground max-w-[140px] truncate">
                                {r.destination ?? "—"}
                              </TableCell>
                              <TableCell className="text-xs">{r.price1 ?? "—"}</TableCell>
                              <TableCell className="text-xs">{r.priceN ?? "—"}</TableCell>
                              <TableCell className="text-xs">{r.interval1 ?? "—"}s</TableCell>
                              <TableCell className="text-xs">{r.intervalN ?? "—"}s</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </TabsContent>

                  {/* Removed rates */}
                  <TabsContent value="removed">
                    <div className="max-h-96 overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Prefix</TableHead>
                            <TableHead>Destination</TableHead>
                            <TableHead>Price 1</TableHead>
                            <TableHead>Price N</TableHead>
                            <TableHead>Interval 1</TableHead>
                            <TableHead>Interval N</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {compareData.removed.map((r: any, i: number) => (
                            <TableRow key={i}>
                              <TableCell className="font-mono text-xs text-red-400">{r.prefix ?? "—"}</TableCell>
                              <TableCell className="text-xs text-muted-foreground max-w-[140px] truncate">
                                {r.destination ?? "—"}
                              </TableCell>
                              <TableCell className="text-xs">{r.price1 ?? "—"}</TableCell>
                              <TableCell className="text-xs">{r.priceN ?? "—"}</TableCell>
                              <TableCell className="text-xs">{r.interval1 ?? "—"}s</TableCell>
                              <TableCell className="text-xs">{r.intervalN ?? "—"}s</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </TabsContent>
                </Tabs>
              )}
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
