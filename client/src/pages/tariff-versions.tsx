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
import {
  GitBranch, Camera, Clock, TrendingDown, TrendingUp,
  Minus, Plus, ArrowRightLeft, RefreshCw, ChevronRight,
  FileText, Activity,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface TariffVersion {
  id:            number;
  iTariff:       string;
  tariffName?:   string;
  source:        string;
  rateCount:     number;
  effectiveFrom?: string;
  effectiveTo?:   string;
  notes?:        string;
  createdBy?:    string;
  createdAt:     string;
}

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
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
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
    </div>
  );
}
